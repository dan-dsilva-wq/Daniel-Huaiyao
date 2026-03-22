#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import os
import random
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

try:
    import torch
    from torch import nn
except Exception:
    print("PyTorch is required. Install with: pip install torch", flush=True)
    raise


DEFAULT_METRICS_LOG_PATH = ".hive-cache/metrics/training-metrics.jsonl"
POLICY_VALUE_MODEL_VERSION = 6
POLICY_VALUE_MODEL_PREVIOUS_VERSION = 5
POLICY_VALUE_MODEL_LEGACY_VERSION = 4
POLICY_VALUE_MODEL_OLDEST_VERSION = 3
DEFAULT_POLICY_TARGET_TEMPERATURE = 0.12
DEFAULT_POLICY_HIDDEN_SIZE = 64


@dataclass
class SampleRecord:
    state_features: List[float]
    value_target: float
    queen_delta: float
    mobility: float
    length_bucket: int
    action_features: List[List[float]]
    action_probs: List[float]


class PolicyValueNet(nn.Module):
    def __init__(self, state_size: int, action_size: int, hidden: List[int]) -> None:
        super().__init__()
        layers: List[nn.Module] = []
        prev = state_size
        for width in hidden:
            layers.append(nn.Linear(prev, width))
            layers.append(nn.Tanh())
            prev = width
        self.trunk = nn.Sequential(*layers)
        self.embedding_size = prev

        self.value_head = nn.Linear(prev, 1)
        self.policy_input_size = prev + action_size
        self.policy_hidden_size = DEFAULT_POLICY_HIDDEN_SIZE
        self.policy_input_hidden = nn.Linear(self.policy_input_size, self.policy_hidden_size)
        self.policy_hidden = nn.Linear(self.policy_hidden_size, self.policy_hidden_size)
        self.policy_output_weights = nn.Parameter(torch.zeros(self.policy_hidden_size))
        self.policy_bias = nn.Parameter(torch.zeros(1))
        self.policy_log_scale = nn.Parameter(torch.zeros(1))

        self.queen_head = nn.Linear(prev, 1)
        self.mobility_head = nn.Linear(prev, 1)
        self.length_head = nn.Linear(prev, 3)

    def embed(self, state_tensor: torch.Tensor) -> torch.Tensor:
        if len(self.trunk) == 0:
            return state_tensor
        return self.trunk(state_tensor)

    def value(self, embedding: torch.Tensor) -> torch.Tensor:
        return torch.tanh(self.value_head(embedding))

    def policy_logits(self, embedding: torch.Tensor, action_features: torch.Tensor) -> torch.Tensor:
        joint = torch.cat([embedding, action_features], dim=1)
        hidden = torch.tanh(self.policy_input_hidden(joint))
        hidden = torch.tanh(self.policy_hidden(hidden))
        logits = hidden @ self.policy_output_weights + self.policy_bias.squeeze(0)
        return logits * torch.exp(self.policy_log_scale).clamp(min=0.25, max=32.0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Hive AlphaZero-style policy-value model")
    parser.add_argument("--dataset", required=True, help="Dataset path from train-alphazero.ts")
    parser.add_argument("--out", default=".hive-cache/az-candidate-model.json", help="Output model path")
    parser.add_argument("--init-model", default="", help="Optional policy-value model JSON to warm-start from")
    parser.add_argument("--epochs", type=int, default=26, help="Training epochs")
    parser.add_argument("--batch-size", type=int, default=512, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.0015, help="Learning rate")
    parser.add_argument("--weight-decay", type=float, default=0.0001, help="AdamW weight decay")
    parser.add_argument("--hidden", default="128,64", help="Hidden layer sizes (csv)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--metrics-log", default=DEFAULT_METRICS_LOG_PATH, help="Metrics JSONL path")
    parser.add_argument("--device", default="auto", help="auto|cuda|cpu")
    parser.add_argument("--policy-loss-weight", type=float, default=2.0)
    parser.add_argument("--value-loss-weight", type=float, default=1.0)
    parser.add_argument("--aux-loss-weight", type=float, default=0.2)
    parser.add_argument("--ema-decay", type=float, default=0.995)
    parser.add_argument("--label-smoothing", type=float, default=0.02, help="Smooth policy targets to prevent one-hot")
    parser.add_argument(
        "--policy-target-temperature",
        type=float,
        default=DEFAULT_POLICY_TARGET_TEMPERATURE,
        help="Sharpen replay policy targets using stored visit counts",
    )
    return parser.parse_args()


def parse_hidden(raw: str) -> List[int]:
    parsed = [int(part.strip()) for part in raw.split(",") if part.strip()]
    if not parsed:
        raise ValueError("At least one hidden layer is required")
    if any(width <= 0 for width in parsed):
        raise ValueError("Hidden layer sizes must be positive integers")
    return parsed


def resolve_device(raw: str) -> torch.device:
    value = raw.strip().lower()
    if value not in {"auto", "cuda", "cpu"}:
        raise ValueError(f"Invalid --device value: {raw}")
    if value in {"auto", "cuda"} and torch.cuda.is_available():
        return torch.device("cuda")
    if value == "cuda":
        raise ValueError("CUDA requested but unavailable")
    return torch.device("cpu")


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def append_metrics(metrics_path: str, run_id: str, event_type: str, payload: Dict[str, Any]) -> None:
    try:
        os.makedirs(os.path.dirname(metrics_path) or ".", exist_ok=True)
        event = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": "az",
            "runId": run_id,
            "eventType": event_type,
        }
        event.update(payload)
        with open(metrics_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event))
            handle.write("\n")
    except Exception as error:
        print(f"[warn] failed to append metrics: {error}", flush=True)


def normalize_policy_targets(
    policy_targets: List[Dict[str, Any]],
    target_temperature: float,
) -> Tuple[List[List[float]], List[float]]:
    action_features: List[List[float]] = []
    action_weights: List[float] = []
    temperature = max(0.05, float(target_temperature))

    for target in policy_targets:
        if not isinstance(target, dict):
            continue
        feats = target.get("actionFeatures")
        prob = target.get("probability")
        visit_count = target.get("visitCount")
        if not isinstance(feats, list):
            continue
        if not isinstance(prob, (int, float)) and not isinstance(visit_count, (int, float)):
            continue

        base_weight = float(visit_count) if isinstance(visit_count, (int, float)) and float(visit_count) > 0 else float(prob or 0.0)
        action_features.append([float(v) for v in feats])
        action_weights.append(math.pow(max(1e-6, base_weight), 1.0 / temperature))

    if not action_features:
        return [], []

    weight_sum = sum(max(0.0, weight) for weight in action_weights)
    if weight_sum <= 0:
        action_probs = [1.0 / len(action_weights) for _ in action_weights]
    else:
        action_probs = [max(0.0, weight) / weight_sum for weight in action_weights]
    return action_features, action_probs


def read_dataset(path: str, target_temperature: float) -> Tuple[List[str], List[str], List[SampleRecord], Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if not isinstance(payload, dict):
        raise ValueError("Dataset root must be object")
    state_names = payload.get("stateFeatureNames")
    action_names = payload.get("actionFeatureNames")
    samples_raw = payload.get("samples")
    if not isinstance(state_names, list) or not isinstance(action_names, list) or not isinstance(samples_raw, list):
        raise ValueError("Dataset missing required arrays")

    records: List[SampleRecord] = []
    for raw in samples_raw:
        if not isinstance(raw, dict):
            continue
        state_features = raw.get("stateFeatures")
        value_target = raw.get("valueTarget")
        policy_targets = raw.get("policyTargets")
        aux_targets = raw.get("auxTargets")
        if (
            not isinstance(state_features, list)
            or not isinstance(value_target, (int, float))
            or not isinstance(policy_targets, list)
            or not isinstance(aux_targets, dict)
        ):
            continue

        action_features, action_probs = normalize_policy_targets(policy_targets, target_temperature)
        if not action_features:
            continue

        length_bucket = int(aux_targets.get("lengthBucket", 1))
        if length_bucket < 0 or length_bucket > 2:
            length_bucket = 1

        records.append(
            SampleRecord(
                state_features=[float(v) for v in state_features],
                value_target=float(value_target),
                queen_delta=float(aux_targets.get("queenSurroundDelta", 0.0)),
                mobility=float(aux_targets.get("mobility", 0.0)),
                length_bucket=length_bucket,
                action_features=action_features,
                action_probs=action_probs,
            )
        )

    meta = {
        "version": payload.get("version", 0),
        "createdAt": payload.get("createdAt"),
        "updatedAt": payload.get("updatedAt"),
        "sampleCount": len(records),
    }

    return [str(v) for v in state_names], [str(v) for v in action_names], records, meta


def split_dataset(samples: List[SampleRecord], ratio: float = 0.9) -> Tuple[List[SampleRecord], List[SampleRecord]]:
    shuffled = list(samples)
    random.shuffle(shuffled)
    split = max(1, min(len(shuffled) - 1, int(len(shuffled) * ratio)))
    return shuffled[:split], shuffled[split:]


def batch_indices(length: int, batch_size: int) -> List[List[int]]:
    indices = list(range(length))
    random.shuffle(indices)
    batches: List[List[int]] = []
    for start in range(0, length, batch_size):
        batches.append(indices[start:start + batch_size])
    return batches


def compute_batch_loss(
    model: PolicyValueNet,
    batch: List[SampleRecord],
    device: torch.device,
    args: argparse.Namespace,
) -> Tuple[torch.Tensor, Dict[str, float]]:
    entropies: List[float] = []

    mse = nn.MSELoss()
    ce = nn.CrossEntropyLoss()

    state_tensor = torch.tensor(
        [sample.state_features for sample in batch],
        dtype=torch.float32,
        device=device,
    )
    embeddings = model.embed(state_tensor)

    value_pred = model.value(embeddings).squeeze(-1)
    value_target = torch.tensor(
        [sample.value_target for sample in batch],
        dtype=torch.float32,
        device=device,
    )
    value_loss = mse(value_pred, value_target)

    queen_target = torch.tensor(
        [sample.queen_delta for sample in batch],
        dtype=torch.float32,
        device=device,
    )
    queen_pred = torch.tanh(model.queen_head(embeddings)).squeeze(-1)
    queen_loss = mse(queen_pred, queen_target)

    mobility_target = torch.tensor(
        [sample.mobility for sample in batch],
        dtype=torch.float32,
        device=device,
    )
    mobility_pred = torch.tanh(model.mobility_head(embeddings)).squeeze(-1)
    mobility_loss = mse(mobility_pred, mobility_target)

    length_target = torch.tensor(
        [sample.length_bucket for sample in batch],
        dtype=torch.long,
        device=device,
    )
    length_logits = model.length_head(embeddings)
    length_loss = ce(length_logits, length_target)

    # Pad action features and target probs to uniform size for batched GPU computation
    max_actions = max(len(sample.action_features) for sample in batch)
    action_dim = len(batch[0].action_features[0]) if batch[0].action_features else 0
    padded_actions = torch.zeros(len(batch), max_actions, action_dim, dtype=torch.float32, device=device)
    padded_probs = torch.zeros(len(batch), max_actions, dtype=torch.float32, device=device)
    action_mask = torch.zeros(len(batch), max_actions, dtype=torch.bool, device=device)
    for index, sample in enumerate(batch):
        n_actions = len(sample.action_features)
        if n_actions > 0:
            padded_actions[index, :n_actions] = torch.tensor(sample.action_features, dtype=torch.float32)
            padded_probs[index, :n_actions] = torch.tensor(sample.action_probs, dtype=torch.float32)
            action_mask[index, :n_actions] = True

    # Apply label smoothing to policy targets to ensure gradient flow to all legal moves
    # This prevents one-hot targets from only providing gradient to the best move
    if hasattr(args, 'label_smoothing') and args.label_smoothing > 0:
        smoothing = args.label_smoothing
        # Count legal actions per sample
        n_legal = action_mask.sum(dim=1, keepdim=True).float().clamp(min=1)
        # Smooth: (1 - smoothing) * original + smoothing * uniform
        uniform = action_mask.float() / n_legal
        padded_probs = (1 - smoothing) * padded_probs + smoothing * uniform

    expanded_embeddings = embeddings.unsqueeze(1).expand(-1, max_actions, -1)
    joint = torch.cat([expanded_embeddings, padded_actions], dim=2)
    hidden = torch.tanh(model.policy_input_hidden(joint))
    hidden = torch.tanh(model.policy_hidden(hidden))
    all_logits = torch.matmul(hidden, model.policy_output_weights) + model.policy_bias.squeeze(0)
    all_logits = all_logits * torch.exp(model.policy_log_scale).clamp(min=0.25, max=32.0)
    # Mask out padding with large negative value before softmax
    all_logits = all_logits.masked_fill(~action_mask, -1e9)

    log_probs = torch.log_softmax(all_logits, dim=1)
    policy_loss = -(padded_probs * log_probs).sum(dim=1).mean()

    with torch.no_grad():
        probs = torch.softmax(all_logits, dim=1)
        ent = -(probs * torch.log(torch.clamp(probs, min=1e-9))).sum(dim=1)
        entropies = ent.tolist()
    aux_loss = (queen_loss + mobility_loss + length_loss) / 3.0

    total = (
        args.value_loss_weight * value_loss
        + args.policy_loss_weight * policy_loss
        + args.aux_loss_weight * aux_loss
    )

    metrics = {
        "valueLoss": float(value_loss.item()),
        "policyLoss": float(policy_loss.item()),
        "queenLoss": float(queen_loss.item()),
        "mobilityLoss": float(mobility_loss.item()),
        "lengthLoss": float(length_loss.item()),
        "auxLoss": float(aux_loss.item()),
        "policyEntropy": float(sum(entropies) / max(1, len(entropies))),
    }
    return total, metrics


def evaluate_split(
    model: PolicyValueNet,
    samples: List[SampleRecord],
    device: torch.device,
    args: argparse.Namespace,
) -> Dict[str, float]:
    model.eval()
    with torch.no_grad():
        total_loss = 0.0
        total_value = 0.0
        total_policy = 0.0
        total_aux = 0.0
        total_entropy = 0.0
        batches = batch_indices(len(samples), max(1, args.batch_size))
        for batch_ids in batches:
            batch = [samples[i] for i in batch_ids]
            loss, metrics = compute_batch_loss(model, batch, device, args)
            total_loss += float(loss.item())
            total_value += metrics["valueLoss"]
            total_policy += metrics["policyLoss"]
            total_aux += metrics["auxLoss"]
            total_entropy += metrics["policyEntropy"]

    count = max(1, len(batches))
    return {
        "loss": total_loss / count,
        "valueLoss": total_value / count,
        "policyLoss": total_policy / count,
        "auxLoss": total_aux / count,
        "policyEntropy": total_entropy / count,
    }


def update_ema(ema: Dict[str, torch.Tensor], state_dict: Dict[str, torch.Tensor], decay: float) -> None:
    for key, value in state_dict.items():
        ema[key].mul_(decay).add_(value.detach().cpu(), alpha=1 - decay)


def compute_short_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def build_feature_index_map(
    source_names: List[str],
    target_names: List[str],
) -> List[Tuple[int, int]]:
    target_by_name = {name: index for index, name in enumerate(target_names)}
    mapping: List[Tuple[int, int]] = []
    for source_index, name in enumerate(source_names):
        target_index = target_by_name.get(name)
        if target_index is not None:
            mapping.append((source_index, target_index))
    return mapping


def load_initial_model(
    model: PolicyValueNet,
    init_model_path: str,
    state_feature_names: List[str],
    action_feature_names: List[str],
    hidden: List[int],
) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "loaded": False,
        "path": None,
        "hash": None,
        "reason": "not_provided",
    }

    if not init_model_path.strip():
        return result

    absolute_path = os.path.abspath(init_model_path)
    result["path"] = absolute_path
    if not os.path.exists(absolute_path):
        result["reason"] = "missing_file"
        return result

    try:
        with open(absolute_path, "r", encoding="utf-8") as handle:
            raw = handle.read()
        payload = json.loads(raw)
    except Exception as error:
        result["reason"] = f"read_error:{error}"
        return result

    result["hash"] = compute_short_hash(raw)
    if not isinstance(payload, dict):
        result["reason"] = "invalid_payload"
        return result
    if payload.get("version") not in {
        POLICY_VALUE_MODEL_OLDEST_VERSION,
        POLICY_VALUE_MODEL_LEGACY_VERSION,
        POLICY_VALUE_MODEL_PREVIOUS_VERSION,
        POLICY_VALUE_MODEL_VERSION,
    } or payload.get("kind") != "policy_value":
        result["reason"] = "unsupported_model"
        return result

    payload_state_feature_names = payload.get("stateFeatureNames")
    payload_action_feature_names = payload.get("actionFeatureNames")
    if payload_state_feature_names != state_feature_names:
        result["reason"] = "state_features_mismatch"
        return result
    if (
        not isinstance(payload_action_feature_names, list)
        or not all(isinstance(entry, str) for entry in payload_action_feature_names)
    ):
        result["reason"] = "action_features_invalid"
        return result
    action_feature_map = build_feature_index_map([str(entry) for entry in payload_action_feature_names], action_feature_names)
    if len(action_feature_map) == 0:
        result["reason"] = "action_features_mismatch"
        return result

    trunk_layers = payload.get("stateTrunk")
    if not isinstance(trunk_layers, list):
        result["reason"] = "missing_trunk"
        return result

    model_trunk = [layer for layer in model.trunk if isinstance(layer, nn.Linear)]
    if len(trunk_layers) != len(model_trunk) or len(model_trunk) != len(hidden):
        result["reason"] = "hidden_layers_mismatch"
        return result

    try:
        with torch.no_grad():
            expected_in = len(state_feature_names)
            for index, linear in enumerate(model_trunk):
                layer_payload = trunk_layers[index]
                if not isinstance(layer_payload, dict):
                    result["reason"] = f"invalid_trunk_layer_{index}"
                    return result

                input_size = int(layer_payload.get("inputSize", -1))
                output_size = int(layer_payload.get("outputSize", -1))
                weights = layer_payload.get("weights")
                bias = layer_payload.get("bias")
                if (
                    input_size != expected_in
                    or output_size != linear.out_features
                    or not isinstance(weights, list)
                    or not isinstance(bias, list)
                    or len(weights) != input_size * output_size
                    or len(bias) != output_size
                ):
                    result["reason"] = f"trunk_shape_mismatch_{index}"
                    return result

                linear.weight.copy_(
                    torch.tensor(weights, dtype=torch.float32, device=linear.weight.device).reshape(output_size, input_size)
                )
                linear.bias.copy_(torch.tensor(bias, dtype=torch.float32, device=linear.bias.device))
                expected_in = output_size

            value_head = payload.get("valueHead")
            policy_head = payload.get("policyHead")
            if not isinstance(value_head, dict) or not isinstance(policy_head, dict):
                result["reason"] = "missing_heads"
                return result

            value_weights = value_head.get("weights")
            value_bias = value_head.get("bias")
            policy_action = policy_head.get("actionWeights")
            policy_context = policy_head.get("contextWeights")
            policy_state_hidden = policy_head.get("stateHiddenWeights")
            policy_action_hidden = policy_head.get("actionHiddenWeights")
            policy_hidden_bias = policy_head.get("hiddenBias")
            policy_input_weights = policy_head.get("inputWeights")
            policy_input_bias = policy_head.get("inputBias")
            policy_hidden_weights = policy_head.get("hiddenWeights")
            policy_output_weights = policy_head.get("outputWeights")
            policy_hidden_layer_bias = policy_head.get("hiddenLayerBias")
            policy_input_hidden_size = policy_head.get("inputHiddenSize")
            policy_hidden_size = policy_head.get("hiddenSize")
            legacy_state = policy_head.get("stateWeights")
            policy_bias = policy_head.get("bias")
            policy_scale = policy_head.get("actionScale")
            if (
                not isinstance(value_weights, list)
                or len(value_weights) != model.value_head.in_features
                or not isinstance(value_bias, (int, float))
                or not isinstance(policy_bias, (int, float))
                or (policy_scale is not None and (not isinstance(policy_scale, (int, float)) or float(policy_scale) <= 0))
            ):
                result["reason"] = "head_shape_mismatch"
                return result

            model.value_head.weight.copy_(
                torch.tensor(value_weights, dtype=torch.float32, device=model.value_head.weight.device).reshape(1, -1)
            )
            model.value_head.bias.copy_(
                torch.tensor([float(value_bias)], dtype=torch.float32, device=model.value_head.bias.device)
            )
            model.policy_bias.copy_(
                torch.tensor([float(policy_bias)], dtype=torch.float32, device=model.policy_bias.device)
            )
            if (
                isinstance(policy_input_hidden_size, int)
                and policy_input_hidden_size == model.policy_hidden_size
                and isinstance(policy_hidden_size, int)
                and policy_hidden_size == model.policy_hidden_size
                and isinstance(policy_input_weights, list)
                and len(policy_input_weights) == model.policy_input_hidden.in_features * model.policy_input_hidden.out_features
                and isinstance(policy_input_bias, list)
                and len(policy_input_bias) == model.policy_input_hidden.out_features
                and isinstance(policy_hidden_weights, list)
                and len(policy_hidden_weights) == model.policy_hidden.in_features * model.policy_hidden.out_features
                and isinstance(policy_hidden_layer_bias, list)
                and len(policy_hidden_layer_bias) == model.policy_hidden.out_features
                and isinstance(policy_output_weights, list)
                and len(policy_output_weights) == model.policy_hidden_size
            ):
                model.policy_input_hidden.weight.copy_(
                    torch.tensor(policy_input_weights, dtype=torch.float32, device=model.policy_input_hidden.weight.device).reshape(
                        model.policy_input_hidden.out_features,
                        model.policy_input_hidden.in_features,
                    )
                )
                model.policy_input_hidden.bias.copy_(
                    torch.tensor(policy_input_bias, dtype=torch.float32, device=model.policy_input_hidden.bias.device)
                )
                model.policy_hidden.weight.copy_(
                    torch.tensor(policy_hidden_weights, dtype=torch.float32, device=model.policy_hidden.weight.device).reshape(
                        model.policy_hidden.out_features,
                        model.policy_hidden.in_features,
                    )
                )
                model.policy_hidden.bias.copy_(
                    torch.tensor(policy_hidden_layer_bias, dtype=torch.float32, device=model.policy_hidden.bias.device)
                )
                model.policy_output_weights.copy_(
                    torch.tensor(policy_output_weights, dtype=torch.float32, device=model.policy_output_weights.device)
                )
            elif (
                isinstance(policy_hidden_size, int)
                and policy_hidden_size == model.policy_hidden_size
                and isinstance(policy_state_hidden, list)
                and len(policy_state_hidden) == model.embedding_size * model.policy_hidden_size
                and isinstance(policy_action_hidden, list)
                and len(policy_action_hidden) == len(payload_action_feature_names) * model.policy_hidden_size
                and isinstance(policy_hidden_bias, list)
                and len(policy_hidden_bias) == model.policy_hidden_size
                and isinstance(policy_output_weights, list)
                and len(policy_output_weights) == model.policy_hidden_size
            ):
                model.policy_input_hidden.weight.zero_()
                old_state_hidden = torch.tensor(
                    policy_state_hidden,
                    dtype=torch.float32,
                    device=model.policy_input_hidden.weight.device,
                ).reshape(model.policy_hidden_size, model.embedding_size)
                old_action_hidden = torch.tensor(
                    policy_action_hidden,
                    dtype=torch.float32,
                    device=model.policy_input_hidden.weight.device,
                ).reshape(model.policy_hidden_size, len(payload_action_feature_names))
                model.policy_input_hidden.weight[:, :model.embedding_size].copy_(old_state_hidden)
                for source_index, target_index in action_feature_map:
                    model.policy_input_hidden.weight[:, model.embedding_size + target_index].copy_(old_action_hidden[:, source_index])
                model.policy_input_hidden.bias.copy_(
                    torch.tensor(policy_hidden_bias, dtype=torch.float32, device=model.policy_input_hidden.bias.device)
                )
                model.policy_hidden.weight.zero_()
                model.policy_hidden.bias.zero_()
                eye = torch.eye(model.policy_hidden_size, dtype=torch.float32, device=model.policy_hidden.weight.device)
                model.policy_hidden.weight.copy_(eye)
                model.policy_output_weights.copy_(
                    torch.tensor(policy_output_weights, dtype=torch.float32, device=model.policy_output_weights.device)
                )
            else:
                model.policy_input_hidden.weight.zero_()
                model.policy_input_hidden.bias.zero_()
                model.policy_hidden.weight.zero_()
                model.policy_hidden.bias.zero_()
                model.policy_output_weights.zero_()
                if isinstance(policy_action, list) and len(policy_action) == len(payload_action_feature_names):
                    old_action = torch.tensor(policy_action, dtype=torch.float32, device=model.policy_input_hidden.weight.device)
                    for source_index, target_index in action_feature_map:
                        model.policy_input_hidden.weight[0, model.embedding_size + target_index] = old_action[source_index]
                if isinstance(legacy_state, list) and len(legacy_state) == model.embedding_size:
                    model.policy_input_hidden.weight[0, :model.embedding_size].copy_(
                        torch.tensor(legacy_state, dtype=torch.float32, device=model.policy_input_hidden.weight.device)
                    )
                elif isinstance(policy_context, list) and len(policy_context) > 0:
                    legacy_mean = sum(float(entry) for entry in policy_context) / len(policy_context)
                    model.policy_input_hidden.bias[0] = float(legacy_mean)
                model.policy_hidden.weight[0, 0] = 1.0
                model.policy_output_weights[0] = 1.0
            initial_policy_scale = float(policy_scale) if isinstance(policy_scale, (int, float)) and float(policy_scale) > 0 else 1.0
            if payload.get("version") in {POLICY_VALUE_MODEL_OLDEST_VERSION, POLICY_VALUE_MODEL_LEGACY_VERSION, POLICY_VALUE_MODEL_PREVIOUS_VERSION}:
                initial_policy_scale = max(initial_policy_scale, 6.0)
            model.policy_log_scale.copy_(
                torch.log(torch.tensor([initial_policy_scale], dtype=torch.float32, device=model.policy_log_scale.device))
            )

            auxiliary_heads = payload.get("auxiliaryHeads")
            if isinstance(auxiliary_heads, dict):
                queen_head = auxiliary_heads.get("queen")
                mobility_head = auxiliary_heads.get("mobility")
                length_head = auxiliary_heads.get("length")

                if isinstance(queen_head, dict):
                    queen_weights = queen_head.get("weights")
                    queen_bias = queen_head.get("bias")
                    if isinstance(queen_weights, list) and len(queen_weights) == model.queen_head.in_features and isinstance(queen_bias, (int, float)):
                        model.queen_head.weight.copy_(
                            torch.tensor(queen_weights, dtype=torch.float32, device=model.queen_head.weight.device).reshape(1, -1)
                        )
                        model.queen_head.bias.copy_(
                            torch.tensor([float(queen_bias)], dtype=torch.float32, device=model.queen_head.bias.device)
                        )

                if isinstance(mobility_head, dict):
                    mobility_weights = mobility_head.get("weights")
                    mobility_bias = mobility_head.get("bias")
                    if isinstance(mobility_weights, list) and len(mobility_weights) == model.mobility_head.in_features and isinstance(mobility_bias, (int, float)):
                        model.mobility_head.weight.copy_(
                            torch.tensor(mobility_weights, dtype=torch.float32, device=model.mobility_head.weight.device).reshape(1, -1)
                        )
                        model.mobility_head.bias.copy_(
                            torch.tensor([float(mobility_bias)], dtype=torch.float32, device=model.mobility_head.bias.device)
                        )

                if isinstance(length_head, dict):
                    length_weights = length_head.get("weights")
                    length_bias = length_head.get("bias")
                    if (
                        isinstance(length_weights, list)
                        and len(length_weights) == model.length_head.in_features * model.length_head.out_features
                        and isinstance(length_bias, list)
                        and len(length_bias) == model.length_head.out_features
                    ):
                        model.length_head.weight.copy_(
                            torch.tensor(length_weights, dtype=torch.float32, device=model.length_head.weight.device).reshape(
                                model.length_head.out_features,
                                model.length_head.in_features,
                            )
                        )
                        model.length_head.bias.copy_(
                            torch.tensor(length_bias, dtype=torch.float32, device=model.length_head.bias.device)
                        )
    except Exception as error:
        result["reason"] = f"load_error:{error}"
        return result

    result["loaded"] = True
    result["reason"] = "loaded"
    return result


def export_model(
    out_path: str,
    model: PolicyValueNet,
    state_feature_names: List[str],
    action_feature_names: List[str],
    hidden: List[int],
    training_meta: Dict[str, Any],
) -> None:
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    trunk_layers = [layer for layer in model.trunk if isinstance(layer, nn.Linear)]
    exported_layers: List[Dict[str, Any]] = []
    for layer in trunk_layers:
        exported_layers.append(
            {
                "inputSize": int(layer.in_features),
                "outputSize": int(layer.out_features),
                "weights": layer.weight.detach().cpu().reshape(-1).tolist(),
                "bias": layer.bias.detach().cpu().tolist(),
                "activation": "tanh",
            }
        )

    payload = {
        "version": POLICY_VALUE_MODEL_VERSION,
        "kind": "policy_value",
        "stateFeatureNames": state_feature_names,
        "actionFeatureNames": action_feature_names,
        "stateTrunk": exported_layers,
        "valueHead": {
            "weights": model.value_head.weight.detach().cpu().reshape(-1).tolist(),
            "bias": float(model.value_head.bias.detach().cpu().reshape(-1)[0].item()),
            "activation": "tanh",
        },
        "policyHead": {
            "inputHiddenSize": model.policy_hidden_size,
            "hiddenSize": model.policy_hidden_size,
            "inputWeights": model.policy_input_hidden.weight.detach().cpu().reshape(-1).tolist(),
            "inputBias": model.policy_input_hidden.bias.detach().cpu().reshape(-1).tolist(),
            "hiddenWeights": model.policy_hidden.weight.detach().cpu().reshape(-1).tolist(),
            "hiddenLayerBias": model.policy_hidden.bias.detach().cpu().reshape(-1).tolist(),
            "outputWeights": model.policy_output_weights.detach().cpu().reshape(-1).tolist(),
            "bias": float(model.policy_bias.detach().cpu().reshape(-1)[0].item()),
            "actionScale": float(torch.exp(model.policy_log_scale.detach().cpu().reshape(-1)[0]).item()),
        },
        "auxiliaryHeads": {
            "queen": {
                "weights": model.queen_head.weight.detach().cpu().reshape(-1).tolist(),
                "bias": float(model.queen_head.bias.detach().cpu().reshape(-1)[0].item()),
                "activation": "tanh",
            },
            "mobility": {
                "weights": model.mobility_head.weight.detach().cpu().reshape(-1).tolist(),
                "bias": float(model.mobility_head.bias.detach().cpu().reshape(-1)[0].item()),
                "activation": "tanh",
            },
            "length": {
                "weights": model.length_head.weight.detach().cpu().reshape(-1).tolist(),
                "bias": model.length_head.bias.detach().cpu().tolist(),
                "activation": "linear",
            },
        },
        "training": training_meta,
    }

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    device = resolve_device(args.device)
    hidden = parse_hidden(args.hidden)

    run_id = f"az-train-{int(time.time())}-{random.randint(1000, 9999)}"
    state_names, action_names, samples, dataset_meta = read_dataset(args.dataset, args.policy_target_temperature)
    if len(samples) < 100:
        raise ValueError("Dataset too small; generate more self-play samples")

    train_samples, val_samples = split_dataset(samples, ratio=0.9)
    model = PolicyValueNet(len(state_names), len(action_names), hidden).to(device)
    init_result = load_initial_model(model, args.init_model, state_names, action_names, hidden)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    ema_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}

    print(
        f"[az:setup] samples={len(samples)} train={len(train_samples)} val={len(val_samples)} "
        f"state_dim={len(state_names)} action_dim={len(action_names)} hidden={hidden} "
        f"epochs={args.epochs} batch={args.batch_size} lr={args.lr} wd={args.weight_decay} device={device.type}",
        flush=True,
    )
    if init_result["loaded"]:
        print(
            f"[az:init] warm-started from {init_result['path']} hash={init_result['hash']}",
            flush=True,
        )
        ema_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}
    elif init_result["path"]:
        print(
            f"[az:init] using fresh weights ({init_result['reason']}) from {init_result['path']}",
            flush=True,
        )
    else:
        print("[az:init] using fresh weights (no init model provided)", flush=True)

    append_metrics(
        args.metrics_log,
        run_id,
        "run_start",
        {
            "source": "az",
            "dataset": os.path.abspath(args.dataset),
            "sampleCount": len(samples),
            "trainCount": len(train_samples),
            "valCount": len(val_samples),
            "stateFeatureCount": len(state_names),
            "actionFeatureCount": len(action_names),
            "hidden": hidden,
            "epochs": int(args.epochs),
            "batchSize": int(args.batch_size),
            "learningRate": float(args.lr),
            "weightDecay": float(args.weight_decay),
            "device": device.type,
            "initModelPath": init_result["path"],
            "initModelHash": init_result["hash"],
            "initModelLoaded": bool(init_result["loaded"]),
            "initModelReason": init_result["reason"],
        },
    )

    started = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_batches = batch_indices(len(train_samples), max(1, args.batch_size))
        epoch_loss = 0.0
        epoch_value = 0.0
        epoch_policy = 0.0
        epoch_aux = 0.0
        epoch_entropy = 0.0

        for batch_ids in train_batches:
            batch = [train_samples[i] for i in batch_ids]
            optimizer.zero_grad()
            loss, metrics = compute_batch_loss(model, batch, device, args)
            loss.backward()
            optimizer.step()
            epoch_loss += float(loss.item())
            epoch_value += metrics["valueLoss"]
            epoch_policy += metrics["policyLoss"]
            epoch_aux += metrics["auxLoss"]
            epoch_entropy += metrics["policyEntropy"]

        update_ema(ema_state, model.state_dict(), args.ema_decay)
        batch_count = max(1, len(train_batches))
        train_stats = {
            "loss": epoch_loss / batch_count,
            "valueLoss": epoch_value / batch_count,
            "policyLoss": epoch_policy / batch_count,
            "auxLoss": epoch_aux / batch_count,
            "policyEntropy": epoch_entropy / batch_count,
        }
        val_stats = evaluate_split(model, val_samples, device, args)
        elapsed = time.time() - started
        eta = 0 if epoch == args.epochs else (elapsed / epoch) * (args.epochs - epoch)

        print(
            f"[az] epoch {epoch}/{args.epochs} train_loss={train_stats['loss']:.4f} "
            f"val_loss={val_stats['loss']:.4f} val_value={val_stats['valueLoss']:.4f} "
            f"val_policy={val_stats['policyLoss']:.4f} val_aux={val_stats['auxLoss']:.4f} "
            f"entropy={val_stats['policyEntropy']:.4f} elapsed={int(elapsed)}s eta={int(eta)}s",
            flush=True,
        )

        append_metrics(
            args.metrics_log,
            run_id,
            "epoch",
            {
                "source": "az",
                "epoch": int(epoch),
                "totalEpochs": int(args.epochs),
                "trainLoss": train_stats["loss"],
                "trainValueLoss": train_stats["valueLoss"],
                "trainPolicyLoss": train_stats["policyLoss"],
                "trainAuxLoss": train_stats["auxLoss"],
                "trainPolicyEntropy": train_stats["policyEntropy"],
                "valLoss": val_stats["loss"],
                "valValueLoss": val_stats["valueLoss"],
                "valPolicyLoss": val_stats["policyLoss"],
                "valAuxLoss": val_stats["auxLoss"],
                "valPolicyEntropy": val_stats["policyEntropy"],
            },
        )

    # Export EMA-averaged weights.
    model.load_state_dict({name: tensor.to(device) for name, tensor in ema_state.items()})
    training_meta = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "games": int(dataset_meta.get("sampleCount", 0)),
        "positionSamples": int(len(samples)),
        "epochs": int(args.epochs),
        "difficulty": "mixed",
        "framework": "pytorch",
        "device": device.type,
        "batchSize": int(args.batch_size),
        "learningRate": float(args.lr),
        "hiddenLayers": hidden,
        "policyLossWeight": float(args.policy_loss_weight),
        "valueLossWeight": float(args.value_loss_weight),
        "auxLossWeight": float(args.aux_loss_weight),
        "initializedFrom": init_result["path"],
        "initializedFromHash": init_result["hash"],
        "initializedFromLoaded": bool(init_result["loaded"]),
        "initializedFromReason": init_result["reason"],
    }
    export_model(args.out, model, state_names, action_names, hidden, training_meta)
    print(f"[az:done] saved={os.path.abspath(args.out)}", flush=True)

    append_metrics(
        args.metrics_log,
        run_id,
        "run_end",
        {
            "source": "az",
            "status": "completed",
            "outputPath": os.path.abspath(args.out),
            "epochs": int(args.epochs),
            "sampleCount": len(samples),
        },
    )


if __name__ == "__main__":
    main()
