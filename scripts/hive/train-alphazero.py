#!/usr/bin/env python3
import argparse
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
        self.policy_state = nn.Linear(prev, 1, bias=False)
        self.policy_action = nn.Parameter(torch.zeros(action_size))
        self.policy_bias = nn.Parameter(torch.zeros(1))

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
        state_bias = self.policy_state(embedding).squeeze(-1)
        action_bias = action_features @ self.policy_action
        return state_bias + action_bias + self.policy_bias.squeeze(0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Hive AlphaZero-style policy-value model")
    parser.add_argument("--dataset", required=True, help="Dataset path from train-alphazero.ts")
    parser.add_argument("--out", default=".hive-cache/az-candidate-model.json", help="Output model path")
    parser.add_argument("--epochs", type=int, default=26, help="Training epochs")
    parser.add_argument("--batch-size", type=int, default=512, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.0015, help="Learning rate")
    parser.add_argument("--weight-decay", type=float, default=0.0001, help="AdamW weight decay")
    parser.add_argument("--hidden", default="128,64", help="Hidden layer sizes (csv)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--metrics-log", default=DEFAULT_METRICS_LOG_PATH, help="Metrics JSONL path")
    parser.add_argument("--device", default="auto", help="auto|cuda|cpu")
    parser.add_argument("--policy-loss-weight", type=float, default=1.0)
    parser.add_argument("--value-loss-weight", type=float, default=1.0)
    parser.add_argument("--aux-loss-weight", type=float, default=0.2)
    parser.add_argument("--ema-decay", type=float, default=0.995)
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


def read_dataset(path: str) -> Tuple[List[str], List[str], List[SampleRecord], Dict[str, Any]]:
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

        action_features: List[List[float]] = []
        action_probs: List[float] = []
        for target in policy_targets:
            if not isinstance(target, dict):
                continue
            feats = target.get("actionFeatures")
            prob = target.get("probability")
            if isinstance(feats, list) and isinstance(prob, (int, float)):
                action_features.append([float(v) for v in feats])
                action_probs.append(float(prob))

        if not action_features:
            continue

        prob_sum = sum(max(0.0, prob) for prob in action_probs)
        if prob_sum <= 0:
            action_probs = [1.0 / len(action_probs) for _ in action_probs]
        else:
            action_probs = [max(0.0, prob) / prob_sum for prob in action_probs]

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
    value_losses: List[torch.Tensor] = []
    policy_losses: List[torch.Tensor] = []
    queen_losses: List[torch.Tensor] = []
    mobility_losses: List[torch.Tensor] = []
    length_losses: List[torch.Tensor] = []
    entropies: List[float] = []

    mse = nn.MSELoss()
    ce = nn.CrossEntropyLoss()

    for sample in batch:
        state_tensor = torch.tensor(sample.state_features, dtype=torch.float32, device=device).unsqueeze(0)
        embedding = model.embed(state_tensor)

        value_pred = model.value(embedding).squeeze(0).squeeze(0)
        value_target = torch.tensor(sample.value_target, dtype=torch.float32, device=device)
        value_losses.append(mse(value_pred, value_target))

        action_tensor = torch.tensor(sample.action_features, dtype=torch.float32, device=device)
        target_probs = torch.tensor(sample.action_probs, dtype=torch.float32, device=device)
        logits = model.policy_logits(embedding, action_tensor)
        log_probs = torch.log_softmax(logits, dim=0)
        policy_losses.append(-(target_probs * log_probs).sum())

        probs = torch.softmax(logits, dim=0)
        entropy = -(probs * torch.log(torch.clamp(probs, min=1e-9))).sum().item()
        entropies.append(float(entropy))

        queen_target = torch.tensor(sample.queen_delta, dtype=torch.float32, device=device)
        queen_pred = torch.tanh(model.queen_head(embedding)).squeeze(0).squeeze(0)
        queen_losses.append(mse(queen_pred, queen_target))

        mobility_target = torch.tensor(sample.mobility, dtype=torch.float32, device=device)
        mobility_pred = torch.tanh(model.mobility_head(embedding)).squeeze(0).squeeze(0)
        mobility_losses.append(mse(mobility_pred, mobility_target))

        length_target = torch.tensor(sample.length_bucket, dtype=torch.long, device=device)
        length_logits = model.length_head(embedding).squeeze(0)
        length_losses.append(ce(length_logits.unsqueeze(0), length_target.unsqueeze(0)))

    value_loss = torch.stack(value_losses).mean()
    policy_loss = torch.stack(policy_losses).mean()
    queen_loss = torch.stack(queen_losses).mean()
    mobility_loss = torch.stack(mobility_losses).mean()
    length_loss = torch.stack(length_losses).mean()
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
        "version": 3,
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
            "stateWeights": model.policy_state.weight.detach().cpu().reshape(-1).tolist(),
            "actionWeights": model.policy_action.detach().cpu().reshape(-1).tolist(),
            "bias": float(model.policy_bias.detach().cpu().reshape(-1)[0].item()),
            "actionScale": 1.0,
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
    state_names, action_names, samples, dataset_meta = read_dataset(args.dataset)
    if len(samples) < 100:
        raise ValueError("Dataset too small; generate more self-play samples")

    train_samples, val_samples = split_dataset(samples, ratio=0.9)
    model = PolicyValueNet(len(state_names), len(action_names), hidden).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    ema_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}

    print(
        f"[az:setup] samples={len(samples)} train={len(train_samples)} val={len(val_samples)} "
        f"state_dim={len(state_names)} action_dim={len(action_names)} hidden={hidden} "
        f"epochs={args.epochs} batch={args.batch_size} lr={args.lr} wd={args.weight_decay} device={device.type}",
        flush=True,
    )

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
