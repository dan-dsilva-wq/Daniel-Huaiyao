#!/usr/bin/env python3
"""
GPU Inference Server for Hive AlphaZero.

This server provides GPU-accelerated neural network inference for the TypeScript
MCTS implementation. It accepts batched requests over stdin/stdout and returns
policy + value predictions.

Protocol:
- Input: JSON lines with {id, cmd, payload}
- Output: JSON lines with {id, ok, payload/error}

Commands:
- init: Initialize or replace a model from file
- load_model: Load a model under a registry key
- infer: Batch inference for state + action features
- reload: Reload a model for a registry key
- stats: Return evaluator stats
- shutdown: Graceful shutdown
"""

import contextlib
import json
import os
import sys
import time
import traceback
from typing import Any, Dict, List, Optional, Tuple

try:
    import torch
    import torch.nn.functional as F
except ImportError:
    print("PyTorch required. Install: pip install torch", file=sys.stderr, flush=True)
    sys.exit(1)


class PolicyValueNet(torch.nn.Module):
    """Policy-value network matching the TypeScript model format."""

    def __init__(self, state_size: int, action_size: int, hidden: List[int]):
        super().__init__()
        layers = []
        prev = state_size
        for width in hidden:
            layers.append(torch.nn.Linear(prev, width))
            layers.append(torch.nn.Tanh())
            prev = width
        self.trunk = torch.nn.Sequential(*layers)
        self.embedding_size = prev

        self.value_head = torch.nn.Linear(prev, 1)
        self.policy_input_size = prev + action_size
        self.policy_hidden_size = 64
        self.policy_input_hidden = torch.nn.Linear(self.policy_input_size, self.policy_hidden_size)
        self.policy_hidden = torch.nn.Linear(self.policy_hidden_size, self.policy_hidden_size)
        self.policy_output_weights = torch.nn.Parameter(torch.zeros(self.policy_hidden_size))
        self.policy_bias = torch.nn.Parameter(torch.zeros(1))
        self.policy_scale = torch.nn.Parameter(torch.ones(1), requires_grad=False)

    def forward_batch(
        self,
        state_features: torch.Tensor,
        action_features: torch.Tensor,
        action_counts: List[int],
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Batch forward pass for multiple positions with variable action counts.

        Args:
            state_features: (B, state_dim) tensor of state features
            action_features: (total_actions, action_dim) tensor of all action features
            action_counts: List of action counts per position

        Returns:
            values: (B,) tensor of value predictions
            logits: (total_actions,) tensor of policy logits
        """
        # Compute embeddings
        embeddings = self.trunk(state_features)  # (B, hidden)
        values = torch.tanh(self.value_head(embeddings)).squeeze(-1)  # (B,)

        # Compute policy logits for all actions
        # We need to repeat embeddings based on action counts
        expanded_embeddings = torch.repeat_interleave(
            embeddings,
            torch.tensor(action_counts, device=embeddings.device),
            dim=0,
        )  # (total_actions, hidden)

        joint = torch.cat([expanded_embeddings, action_features], dim=1)
        hidden = torch.tanh(self.policy_input_hidden(joint))
        hidden = torch.tanh(self.policy_hidden(hidden))
        logits = (hidden @ self.policy_output_weights + self.policy_bias) * self.policy_scale  # (total_actions,)

        return values, logits


def load_model(path: str, device: torch.device) -> Tuple[PolicyValueNet, Dict[str, Any]]:
    """Load model from JSON file."""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    state_size = len(data.get('stateFeatureNames', []))
    action_size = len(data.get('actionFeatureNames', []))
    trunk_layers = data.get('stateTrunk', [])
    hidden = [layer['outputSize'] for layer in trunk_layers]

    model = PolicyValueNet(state_size, action_size, hidden).to(device)

    # Load trunk weights
    trunk_linears = [m for m in model.trunk if isinstance(m, torch.nn.Linear)]
    for i, linear in enumerate(trunk_linears):
        layer_data = trunk_layers[i]
        weights = torch.tensor(layer_data['weights'], dtype=torch.float32)
        bias = torch.tensor(layer_data['bias'], dtype=torch.float32)
        with torch.no_grad():
            linear.weight.copy_(weights.reshape(layer_data['outputSize'], layer_data['inputSize']))
            linear.bias.copy_(bias)

    # Load value head
    value_head = data.get('valueHead', {})
    with torch.no_grad():
        model.value_head.weight.copy_(
            torch.tensor(value_head['weights'], dtype=torch.float32).reshape(1, -1)
        )
        model.value_head.bias.copy_(
            torch.tensor([value_head['bias']], dtype=torch.float32)
        )

    # Load policy head
    policy_head = data.get('policyHead', {})
    with torch.no_grad():
        model.policy_bias.copy_(
            torch.tensor([policy_head['bias']], dtype=torch.float32)
        )
        model.policy_scale.copy_(
            torch.tensor([float(policy_head.get('actionScale', 1.0))], dtype=torch.float32)
        )
        state_hidden_weights = policy_head.get('stateHiddenWeights')
        action_hidden_weights = policy_head.get('actionHiddenWeights')
        hidden_bias = policy_head.get('hiddenBias')
        input_weights = policy_head.get('inputWeights')
        input_bias = policy_head.get('inputBias')
        hidden_weights = policy_head.get('hiddenWeights')
        hidden_layer_bias = policy_head.get('hiddenLayerBias')
        input_hidden_size = policy_head.get('inputHiddenSize')
        output_weights = policy_head.get('outputWeights')
        hidden_size = policy_head.get('hiddenSize')
        legacy_action_weights = policy_head.get('actionWeights')
        legacy_context_weights = policy_head.get('contextWeights')
        legacy_state_weights = policy_head.get('stateWeights')

        if (
            isinstance(input_hidden_size, int)
            and input_hidden_size == model.policy_hidden_size
            and isinstance(hidden_size, int)
            and hidden_size == model.policy_hidden_size
            and isinstance(input_weights, list)
            and len(input_weights) == model.policy_input_hidden.in_features * model.policy_input_hidden.out_features
            and isinstance(input_bias, list)
            and len(input_bias) == model.policy_input_hidden.out_features
            and isinstance(hidden_weights, list)
            and len(hidden_weights) == model.policy_hidden.in_features * model.policy_hidden.out_features
            and isinstance(hidden_layer_bias, list)
            and len(hidden_layer_bias) == model.policy_hidden.out_features
            and isinstance(output_weights, list)
            and len(output_weights) == model.policy_hidden_size
        ):
            model.policy_input_hidden.weight.copy_(
                torch.tensor(input_weights, dtype=torch.float32).reshape(
                    model.policy_input_hidden.out_features,
                    model.policy_input_hidden.in_features,
                )
            )
            model.policy_input_hidden.bias.copy_(torch.tensor(input_bias, dtype=torch.float32))
            model.policy_hidden.weight.copy_(
                torch.tensor(hidden_weights, dtype=torch.float32).reshape(
                    model.policy_hidden.out_features,
                    model.policy_hidden.in_features,
                )
            )
            model.policy_hidden.bias.copy_(torch.tensor(hidden_layer_bias, dtype=torch.float32))
            model.policy_output_weights.copy_(torch.tensor(output_weights, dtype=torch.float32))
        elif (
            isinstance(hidden_size, int)
            and hidden_size == model.policy_hidden_size
            and isinstance(state_hidden_weights, list)
            and len(state_hidden_weights) == model.embedding_size * model.policy_hidden_size
            and isinstance(action_hidden_weights, list)
            and len(action_hidden_weights) == action_size * model.policy_hidden_size
            and isinstance(hidden_bias, list)
            and len(hidden_bias) == model.policy_hidden_size
            and isinstance(output_weights, list)
            and len(output_weights) == model.policy_hidden_size
        ):
            model.policy_input_hidden.weight.zero_()
            model.policy_input_hidden.weight[:, :model.embedding_size].copy_(
                torch.tensor(state_hidden_weights, dtype=torch.float32).reshape(model.policy_hidden_size, model.embedding_size)
            )
            model.policy_input_hidden.weight[:, model.embedding_size:].copy_(
                torch.tensor(action_hidden_weights, dtype=torch.float32).reshape(model.policy_hidden_size, action_size)
            )
            model.policy_input_hidden.bias.copy_(torch.tensor(hidden_bias, dtype=torch.float32))
            model.policy_hidden.weight.zero_()
            model.policy_hidden.bias.zero_()
            model.policy_hidden.weight.copy_(torch.eye(model.policy_hidden_size, dtype=torch.float32))
            model.policy_output_weights.copy_(torch.tensor(output_weights, dtype=torch.float32))
        else:
            model.policy_input_hidden.weight.zero_()
            model.policy_input_hidden.bias.zero_()
            model.policy_hidden.weight.zero_()
            model.policy_hidden.bias.zero_()
            model.policy_output_weights.zero_()
            if isinstance(legacy_action_weights, list) and len(legacy_action_weights) == action_size:
                model.policy_input_hidden.weight[0, model.embedding_size:].copy_(torch.tensor(legacy_action_weights, dtype=torch.float32))
            if isinstance(legacy_state_weights, list) and len(legacy_state_weights) > 0:
                model.policy_input_hidden.bias[0] = float(sum(float(v) for v in legacy_state_weights) / len(legacy_state_weights))
            elif isinstance(legacy_context_weights, list) and len(legacy_context_weights) > 0:
                model.policy_input_hidden.bias[0] = float(sum(float(v) for v in legacy_context_weights) / len(legacy_context_weights))
            model.policy_hidden.weight[0, 0] = 1.0
            model.policy_output_weights[0] = 1.0

    model.eval()

    meta = {
        'state_size': state_size,
        'action_size': action_size,
        'hidden': hidden,
        'device': str(device),
    }
    return model, meta


def emit_response(request_id: Any, ok: bool, payload: Optional[Dict] = None, error: Optional[str] = None):
    """Send response to stdout."""
    msg = {'id': request_id, 'ok': ok}
    if payload is not None:
        msg['payload'] = payload
    if error is not None:
        msg['error'] = error
    sys.stdout.write(json.dumps(msg))
    sys.stdout.write('\n')
    sys.stdout.flush()


def emit_log(message: str):
    """Log to stderr."""
    print(f"[gpu-server] {message}", file=sys.stderr, flush=True)


def adapt_action_features(features: List[float], expected_size: int) -> List[float]:
    if len(features) >= expected_size:
        return features[:expected_size]
    return features + [0.0] * (expected_size - len(features))


class InferenceServer:
    """GPU inference server for batched neural network evaluation."""

    def __init__(self):
        self.models: Dict[str, PolicyValueNet] = {}
        self.model_meta: Dict[str, Dict[str, Any]] = {}
        self.device: Optional[torch.device] = None
        self.inference_count = 0
        self.total_positions = 0
        self.total_actions = 0
        self.total_batches = 0
        self.max_batch_size_seen = 0
        self.per_model_request_count: Dict[str, int] = {}
        self.per_model_position_count: Dict[str, int] = {}

    def handle_init(self, payload: Dict) -> Dict:
        """Initialize model from file."""
        device_str = payload.get('device', 'auto')
        if device_str == 'auto':
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        else:
            self.device = torch.device(device_str)

        return self._load_model(payload, replace=True)

    def handle_load_model(self, payload: Dict) -> Dict:
        """Load a model under a registry key."""
        return self._load_model(payload, replace=False)

    def _load_model(self, payload: Dict, replace: bool) -> Dict:
        if self.device is None:
            device_str = payload.get('device', 'auto')
            if device_str == 'auto':
                self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            else:
                self.device = torch.device(device_str)

        model_path = payload.get('modelPath')
        if not model_path:
            raise ValueError("modelPath required")
        model_key = str(payload.get('modelKey') or 'default')
        if not replace and model_key in self.models:
            raise ValueError(f"Model key already loaded: {model_key}")

        model, meta = load_model(model_path, self.device)
        self.models[model_key] = model
        self.model_meta[model_key] = meta
        self.per_model_request_count.setdefault(model_key, 0)
        self.per_model_position_count.setdefault(model_key, 0)

        emit_log(
            f"Loaded model[{model_key}]: state={meta['state_size']} action={meta['action_size']} "
            f"hidden={meta['hidden']} device={self.device}"
        )

        return {
            'status': 'ready',
            'modelKey': model_key,
            'device': str(self.device),
            'cuda_available': torch.cuda.is_available(),
            'loadedModelKeys': sorted(self.models.keys()),
            **meta,
        }

    def handle_infer(self, payload: Dict) -> Dict:
        """
        Batch inference for multiple positions.

        Input payload:
        {
            "positions": [
                {
                    "stateFeatures": [...],
                    "actions": [
                        {"actionKey": "...", "actionFeatures": [...]},
                        ...
                    ]
                },
                ...
            ]
        }

        Output:
        {
            "results": [
                {
                    "modelKey": "candidate",
                    "value": 0.5,
                    "actionLogits": {"actionKey1": 0.3, "actionKey2": -0.1, ...}
                },
                ...
            ]
        }
        """
        if not self.models:
            raise RuntimeError("Model not initialized")

        positions = payload.get('positions', [])
        if not positions:
            return {'results': []}

        default_model_key = str(payload.get('modelKey') or 'default')
        indexed_positions_by_key: Dict[str, List[Tuple[int, Dict[str, Any]]]] = {}
        for index, pos in enumerate(positions):
            model_key = str(pos.get('modelKey') or default_model_key)
            if model_key not in self.models:
                raise ValueError(f"Unknown model key: {model_key}")
            indexed_positions_by_key.setdefault(model_key, []).append((index, pos))

        results: List[Optional[Dict[str, Any]]] = [None] * len(positions)
        queue_depth = len(positions)
        batch_groups = 0

        for model_key, indexed_positions in indexed_positions_by_key.items():
            model = self.models[model_key]
            meta = self.model_meta[model_key]

            state_features_list = []
            action_features_list = []
            action_keys_list = []
            action_counts = []

            for _, pos in indexed_positions:
                state_features_list.append(pos['stateFeatures'])
                actions = pos.get('actions', [])
                action_counts.append(len(actions))
                keys = []
                for action in actions:
                    action_features_list.append(
                        adapt_action_features(action['actionFeatures'], meta['action_size'])
                    )
                    keys.append(action['actionKey'])
                action_keys_list.append(keys)

            state_tensor = torch.tensor(state_features_list, dtype=torch.float32, device=self.device)
            action_tensor = torch.tensor(action_features_list, dtype=torch.float32, device=self.device) \
                if action_features_list else torch.empty(0, meta['action_size'], device=self.device)

            with torch.inference_mode():
                with self._autocast_context():
                    values, logits = model.forward_batch(state_tensor, action_tensor, action_counts)
                values = values.float().cpu().numpy()
                logits = logits.float().cpu().numpy() if len(logits) > 0 else []

            logit_offset = 0
            for batch_index, (original_index, _) in enumerate(indexed_positions):
                count = action_counts[batch_index]
                action_logits = {}
                for action_index, key in enumerate(action_keys_list[batch_index]):
                    action_logits[key] = float(logits[logit_offset + action_index])
                logit_offset += count

                results[original_index] = {
                    'modelKey': model_key,
                    'value': float(values[batch_index]),
                    'actionLogits': action_logits,
                }

            batch_groups += 1
            self.per_model_request_count[model_key] = self.per_model_request_count.get(model_key, 0) + 1
            self.per_model_position_count[model_key] = self.per_model_position_count.get(model_key, 0) + len(indexed_positions)

        self.inference_count += 1
        self.total_positions += len(positions)
        self.total_actions += sum(len(pos.get('actions', [])) for pos in positions)
        self.total_batches += batch_groups
        self.max_batch_size_seen = max(self.max_batch_size_seen, len(positions))

        return {
            'results': [result for result in results if result is not None],
            'stats': {
                'queueDepth': queue_depth,
                'groupCount': batch_groups,
                'loadedModelKeys': sorted(self.models.keys()),
            },
        }

    def handle_reload(self, payload: Dict) -> Dict:
        """Reload model from file."""
        return self._load_model(payload, replace=True)

    def handle_stats(self, payload: Dict) -> Dict:
        """Return server statistics."""
        average_batch_size = self.total_positions / self.inference_count if self.inference_count > 0 else 0.0
        return {
            'inferenceCount': self.inference_count,
            'totalPositions': self.total_positions,
            'totalActions': self.total_actions,
            'totalBatches': self.total_batches,
            'averageBatchSize': average_batch_size,
            'maxBatchSizeSeen': self.max_batch_size_seen,
            'device': str(self.device) if self.device else None,
            'cudaAvailable': torch.cuda.is_available(),
            'cudaDeviceName': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            'loadedModelKeys': sorted(self.models.keys()),
            'perModelRequestCount': self.per_model_request_count,
            'perModelPositionCount': self.per_model_position_count,
        }

    def _autocast_context(self):
        if self.device is not None and self.device.type == 'cuda':
            return torch.autocast(device_type='cuda', dtype=torch.float16)
        return contextlib.nullcontext()


def main():
    server = InferenceServer()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get('id')
            cmd = request.get('cmd')
            payload = request.get('payload', {})

            if cmd == 'init':
                result = server.handle_init(payload)
            elif cmd == 'load_model':
                result = server.handle_load_model(payload)
            elif cmd == 'infer':
                result = server.handle_infer(payload)
            elif cmd == 'reload':
                result = server.handle_reload(payload)
            elif cmd == 'stats':
                result = server.handle_stats(payload)
            elif cmd == 'shutdown':
                emit_response(request_id, True, {'status': 'bye'})
                return
            else:
                raise ValueError(f"Unknown command: {cmd}")

            emit_response(request_id, True, result)

        except Exception as e:
            emit_log(f"Error: {e}")
            traceback.print_exc(file=sys.stderr)
            emit_response(request_id, False, error=str(e))


if __name__ == '__main__':
    main()
