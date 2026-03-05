#!/usr/bin/env python3
import argparse
import json
import os
import random
import sys
import time
from typing import Any, Dict, List, Tuple

try:
    import torch
    import torch.nn.functional as F
    from torch import nn
    from torch.utils.data import DataLoader, Dataset
except Exception:
    print(
        "PyTorch is required. Install with: pip install torch (and optionally pip install torch-directml for AMD GPU acceleration on Windows)",
        flush=True,
    )
    raise


DEFAULT_OUT = ".stratego-cache/policy-value-model.json"


class PolicyValueDataset(Dataset):
    def __init__(
        self,
        features: torch.Tensor,
        values: torch.Tensor,
        policy_indices: List[List[int]],
        policy_probs: List[List[float]],
        has_policy: torch.Tensor,
    ) -> None:
        self.features = features
        self.values = values
        self.policy_indices = policy_indices
        self.policy_probs = policy_probs
        self.has_policy = has_policy

    def __len__(self) -> int:
        return int(self.features.shape[0])

    def __getitem__(self, index: int):
        return (
            self.features[index],
            self.values[index],
            self.policy_indices[index],
            self.policy_probs[index],
            self.has_policy[index],
        )


class StrategoPolicyValueNet(nn.Module):
    def __init__(self, input_size: int, hidden_layers: List[int], action_space: int) -> None:
        super().__init__()
        trunk_layers: List[nn.Module] = []
        previous = input_size
        for width in hidden_layers:
            trunk_layers.append(nn.Linear(previous, width))
            trunk_layers.append(nn.Tanh())
            previous = width
        self.trunk = nn.Sequential(*trunk_layers)
        self.value_head = nn.Linear(previous, 1)
        self.policy_head = nn.Linear(previous, action_space)

    def forward(self, inputs: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        shared = self.trunk(inputs)
        value = torch.tanh(self.value_head(shared))
        policy_logits = self.policy_head(shared)
        return value, policy_logits


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train Stratego policy-value model from self-play dataset"
    )
    parser.add_argument("--dataset", required=True, help="Path to JSON dataset")
    parser.add_argument("--out", default=DEFAULT_OUT, help="Output model JSON path")
    parser.add_argument("--epochs", type=int, default=40, help="Epoch count")
    parser.add_argument("--batch-size", type=int, default=512, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.0012, help="Learning rate")
    parser.add_argument("--weight-decay", type=float, default=0.0001, help="AdamW weight decay")
    parser.add_argument(
        "--hidden",
        default="128,96",
        help="Comma-separated hidden sizes (default: 128,96)",
    )
    parser.add_argument(
        "--policy-weight",
        type=float,
        default=1.0,
        help="Relative weight for policy KL loss (default: 1.0)",
    )
    parser.add_argument(
        "--value-weight",
        type=float,
        default=1.0,
        help="Relative weight for value MSE loss (default: 1.0)",
    )
    parser.add_argument(
        "--device",
        default="auto",
        help="Training device: auto|cuda|mps|cpu (default: auto)",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    return parser.parse_args()


def parse_hidden(raw: str) -> List[int]:
    parts = [entry.strip() for entry in raw.split(",") if entry.strip()]
    if not parts:
        raise ValueError("--hidden requires at least one layer")
    hidden = [int(entry) for entry in parts]
    if any(width <= 0 for width in hidden):
        raise ValueError("--hidden layers must be positive")
    return hidden


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def resolve_device(raw_value: str):
    requested = raw_value.strip().lower()
    if requested not in {"auto", "cuda", "mps", "cpu"}:
        raise ValueError(f"Invalid --device value: {raw_value}")
    if requested in {"auto", "cuda"} and torch.cuda.is_available():
        return torch.device("cuda"), "cuda"
    if requested == "cuda":
        raise ValueError("--device cuda requested, but CUDA is not available")
    mps_backend = getattr(getattr(torch, "backends", None), "mps", None)
    mps_available = bool(mps_backend and torch.backends.mps.is_available())
    if requested in {"auto", "mps"} and mps_available:
        return torch.device("mps"), "mps"
    if requested == "mps":
        raise ValueError("--device mps requested, but MPS is not available")
    return torch.device("cpu"), "cpu"


def read_dataset(path: str):
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    feature_names = payload.get("featureNames")
    samples = payload.get("samples")
    if not isinstance(feature_names, list) or len(feature_names) == 0:
        raise ValueError("Dataset is missing featureNames")
    if not isinstance(samples, list) or len(samples) == 0:
        raise ValueError("Dataset contains no samples")

    # Current action encoding is from/to on a 10x10 board.
    action_space = 10000
    x_rows: List[List[float]] = []
    y_rows: List[float] = []
    policy_indices: List[List[int]] = []
    policy_probs: List[List[float]] = []
    has_policy_rows: List[float] = []

    for sample in samples:
        if not isinstance(sample, dict):
            continue
        features = sample.get("features")
        target = sample.get("target")
        if not isinstance(features, list) or not isinstance(target, (float, int)):
            continue
        if len(features) != len(feature_names):
            continue

        x_rows.append([float(value) for value in features])
        y_rows.append(float(target))

        raw_policy = sample.get("policyTargets")
        indices: List[int] = []
        probs: List[float] = []
        if isinstance(raw_policy, list):
            for entry in raw_policy:
                if not isinstance(entry, dict):
                    continue
                action = entry.get("action")
                probability = entry.get("probability")
                if not isinstance(action, int):
                    continue
                if not isinstance(probability, (float, int)):
                    continue
                if action < 0 or action >= action_space:
                    continue
                prob = float(probability)
                if not (prob > 0):
                    continue
                indices.append(action)
                probs.append(prob)

        if len(indices) > 0:
            total = sum(probs)
            probs = [value / total for value in probs]
            has_policy_rows.append(1.0)
        else:
            has_policy_rows.append(0.0)

        policy_indices.append(indices)
        policy_probs.append(probs)

    if len(x_rows) == 0:
        raise ValueError("Dataset has no valid samples after parsing")

    x_tensor = torch.tensor(x_rows, dtype=torch.float32)
    y_tensor = torch.tensor(y_rows, dtype=torch.float32).unsqueeze(1)
    has_policy_tensor = torch.tensor(has_policy_rows, dtype=torch.float32)

    return {
        "feature_names": feature_names,
        "meta": payload.get("meta", {}),
        "x": x_tensor,
        "y": y_tensor,
        "policy_indices": policy_indices,
        "policy_probs": policy_probs,
        "has_policy": has_policy_tensor,
        "action_space": action_space,
    }


def split_indices(sample_count: int):
    split = max(1, int(sample_count * 0.9))
    permutation = torch.randperm(sample_count)
    train_indices = permutation[:split]
    if split < sample_count:
        val_indices = permutation[split:]
    else:
        val_indices = permutation[:split]
    return train_indices, val_indices


def select_rows_list(values: List[List[Any]], indices: torch.Tensor) -> List[List[Any]]:
    return [values[int(index)] for index in indices.tolist()]


def collate_batch(batch):
    features = torch.stack([entry[0] for entry in batch], dim=0)
    values = torch.stack([entry[1] for entry in batch], dim=0)
    policy_indices = [entry[2] for entry in batch]
    policy_probs = [entry[3] for entry in batch]
    has_policy = torch.stack([entry[4] for entry in batch], dim=0)
    return features, values, policy_indices, policy_probs, has_policy


def compute_value_metrics(model: nn.Module, x: torch.Tensor, y: torch.Tensor, device):
    model.eval()
    with torch.no_grad():
        values, _ = model(x.to(device))
        predictions = values.cpu().squeeze(1)
        targets = y.squeeze(1)
        mse = torch.mean((predictions - targets) ** 2).item()
        mae = torch.mean(torch.abs(predictions - targets)).item()
    return mse, mae


def build_policy_target_tensor(
    batch_policy_indices: List[List[int]],
    batch_policy_probs: List[List[float]],
    action_space: int,
    device,
) -> torch.Tensor:
    batch_size = len(batch_policy_indices)
    target = torch.zeros((batch_size, action_space), dtype=torch.float32, device=device)
    for row, (indices, probs) in enumerate(zip(batch_policy_indices, batch_policy_probs)):
        if len(indices) == 0:
            continue
        idx_tensor = torch.tensor(indices, dtype=torch.int64, device=device)
        prob_tensor = torch.tensor(probs, dtype=torch.float32, device=device)
        target[row].index_add_(0, idx_tensor, prob_tensor)
    return target


def export_model_payload(
    model: StrategoPolicyValueNet,
    feature_names: List[str],
    hidden_layers: List[int],
    action_space: int,
    meta: Dict[str, Any],
    args: argparse.Namespace,
    epochs_completed: int,
    device_label: str,
    sample_count: int,
    policy_sample_count: int,
) -> Dict[str, Any]:
    trunk_layers = [module for module in model.trunk if isinstance(module, nn.Linear)]
    serialized_trunk = []
    for linear in trunk_layers:
        serialized_trunk.append(
            {
                "inputSize": int(linear.in_features),
                "outputSize": int(linear.out_features),
                "weights": linear.weight.detach().cpu().reshape(-1).tolist(),
                "bias": linear.bias.detach().cpu().tolist(),
                "activation": "tanh",
            }
        )

    value_head = model.value_head
    policy_head = model.policy_head

    difficulty = str(meta.get("difficulty", "mixed"))
    if difficulty not in {"medium", "hard", "extreme", "mixed"}:
        difficulty = "mixed"

    return {
        "version": 1,
        "kind": "policy_value_mlp",
        "featureNames": feature_names,
        "actionSpace": int(action_space),
        "trunk": serialized_trunk,
        "valueHead": {
            "inputSize": int(value_head.in_features),
            "outputSize": int(value_head.out_features),
            "weights": value_head.weight.detach().cpu().reshape(-1).tolist(),
            "bias": value_head.bias.detach().cpu().tolist(),
            "activation": "tanh",
        },
        "policyHead": {
            "inputSize": int(policy_head.in_features),
            "outputSize": int(policy_head.out_features),
            "weights": policy_head.weight.detach().cpu().reshape(-1).tolist(),
            "bias": policy_head.bias.detach().cpu().tolist(),
            "activation": "linear",
        },
        "training": {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "games": int(meta.get("games", 0)),
            "positionSamples": int(sample_count),
            "policySamples": int(policy_sample_count),
            "epochs": int(epochs_completed),
            "difficulty": difficulty,
            "framework": "pytorch",
            "device": device_label,
            "batchSize": int(args.batch_size),
            "learningRate": float(args.lr),
            "weightDecay": float(args.weight_decay),
            "hiddenLayers": hidden_layers,
            "policyWeight": float(args.policy_weight),
            "valueWeight": float(args.value_weight),
            "workers": int(meta.get("workers", 1)),
        },
    }


def ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def main() -> None:
    args = parse_args()
    if args.epochs <= 0:
        raise ValueError("--epochs must be > 0")
    if args.batch_size <= 0:
        raise ValueError("--batch-size must be > 0")
    if args.lr <= 0:
        raise ValueError("--lr must be > 0")
    if args.weight_decay < 0:
        raise ValueError("--weight-decay must be >= 0")
    if args.policy_weight < 0:
        raise ValueError("--policy-weight must be >= 0")
    if args.value_weight <= 0:
        raise ValueError("--value-weight must be > 0")

    hidden_layers = parse_hidden(args.hidden)
    set_seed(args.seed)

    dataset = read_dataset(args.dataset)
    x = dataset["x"]
    y = dataset["y"]
    policy_indices = dataset["policy_indices"]
    policy_probs = dataset["policy_probs"]
    has_policy = dataset["has_policy"]
    feature_names = dataset["feature_names"]
    meta = dataset["meta"] if isinstance(dataset["meta"], dict) else {}
    action_space = int(dataset["action_space"])
    sample_count = int(x.shape[0])
    policy_sample_count = int(torch.sum(has_policy).item())

    train_indices, val_indices = split_indices(sample_count)

    train_dataset = PolicyValueDataset(
        x[train_indices],
        y[train_indices],
        select_rows_list(policy_indices, train_indices),
        select_rows_list(policy_probs, train_indices),
        has_policy[train_indices],
    )
    val_x = x[val_indices]
    val_y = y[val_indices]

    device, device_label = resolve_device(args.device)
    loader = DataLoader(
        train_dataset,
        batch_size=min(args.batch_size, len(train_dataset)),
        shuffle=True,
        num_workers=0,
        collate_fn=collate_batch,
    )

    model = StrategoPolicyValueNet(len(feature_names), hidden_layers, action_space).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    print(
        (
            f"[pv:setup] device={device_label} samples={sample_count} train={len(train_dataset)} val={int(val_x.shape[0])} "
            f"policy_samples={policy_sample_count} hidden={hidden_layers} action_space={action_space} "
            f"epochs={args.epochs} batch={min(args.batch_size, len(train_dataset))}"
        ),
        flush=True,
    )

    train_started = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0.0
        total_value_loss = 0.0
        total_policy_loss = 0.0
        batch_count = 0
        policy_batch_count = 0

        for batch_features, batch_values, batch_policy_indices, batch_policy_probs, batch_has_policy in loader:
            batch_features = batch_features.to(device)
            batch_values = batch_values.to(device)
            batch_has_policy = batch_has_policy.to(device)

            pred_values, policy_logits = model(batch_features)
            value_loss = F.mse_loss(pred_values, batch_values)

            policy_mask = batch_has_policy > 0.5
            if torch.any(policy_mask):
                policy_target = build_policy_target_tensor(
                    batch_policy_indices=batch_policy_indices,
                    batch_policy_probs=batch_policy_probs,
                    action_space=action_space,
                    device=device,
                )
                log_probs = F.log_softmax(policy_logits, dim=1)
                per_row_kl = -(policy_target * log_probs).sum(dim=1)
                policy_loss = torch.mean(per_row_kl[policy_mask])
                policy_batch_count += 1
            else:
                policy_loss = torch.zeros((), dtype=torch.float32, device=device)

            loss = args.value_weight * value_loss + args.policy_weight * policy_loss

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

            total_loss += float(loss.item())
            total_value_loss += float(value_loss.item())
            total_policy_loss += float(policy_loss.item())
            batch_count += 1

        train_mse, train_mae = compute_value_metrics(model, x[train_indices], y[train_indices], device)
        val_mse, val_mae = compute_value_metrics(model, val_x, val_y, device)
        elapsed = time.time() - train_started
        eta = 0.0 if epoch == args.epochs else (elapsed / epoch) * (args.epochs - epoch)
        avg_loss = total_loss / max(1, batch_count)
        avg_value_loss = total_value_loss / max(1, batch_count)
        avg_policy_loss = total_policy_loss / max(1, policy_batch_count)
        print(
            (
                f"[pv] epoch {epoch}/{args.epochs} loss={avg_loss:.4f} value_loss={avg_value_loss:.4f} "
                f"policy_loss={avg_policy_loss:.4f} train_mse={train_mse:.4f} val_mse={val_mse:.4f} "
                f"elapsed={int(elapsed)}s eta={int(eta)}s"
            ),
            flush=True,
        )

    output_path = os.path.abspath(args.out)
    ensure_parent_dir(output_path)
    payload = export_model_payload(
        model=model,
        feature_names=feature_names,
        hidden_layers=hidden_layers,
        action_space=action_space,
        meta=meta,
        args=args,
        epochs_completed=args.epochs,
        device_label=device_label,
        sample_count=sample_count,
        policy_sample_count=policy_sample_count,
    )
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")

    print(f"[pv:done] saved={output_path}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("[pv:interrupt] interrupted", flush=True)
        sys.exit(130)
