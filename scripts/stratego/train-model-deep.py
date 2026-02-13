#!/usr/bin/env python3
import argparse
import json
import os
import random
import signal
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

try:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, TensorDataset
except Exception:
    print("PyTorch is required. Install with: pip install torch", flush=True)
    raise


class StrategoValueNet(nn.Module):
    def __init__(self, input_size: int, hidden_layers: List[int]) -> None:
        super().__init__()
        layers: List[nn.Module] = []
        previous = input_size

        for width in hidden_layers:
            layers.append(nn.Linear(previous, width))
            layers.append(nn.Tanh())
            previous = width

        layers.append(nn.Linear(previous, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return torch.tanh(self.net(inputs))


CHECKPOINT_VERSION = 1
DEFAULT_METRICS_LOG_PATH = ".stratego-cache/metrics/training-metrics.jsonl"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Stratego deep value model (PyTorch)")
    parser.add_argument("--dataset", required=True, help="Path to JSON dataset from train-model.ts --dataset-out")
    parser.add_argument("--out", default="lib/stratego/trained-model.json", help="Output model JSON path")
    parser.add_argument("--epochs", type=int, default=60, help="Epoch count")
    parser.add_argument("--batch-size", type=int, default=1024, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.0015, help="Learning rate")
    parser.add_argument("--weight-decay", type=float, default=0.0001, help="AdamW weight decay")
    parser.add_argument("--hidden", default="96,48", help="Comma-separated hidden layer sizes")
    parser.add_argument(
        "--checkpoint",
        default=".stratego-cache/deep-training.ckpt",
        help="Checkpoint path for resume/interrupt-safe training",
    )
    parser.add_argument(
        "--metrics-log",
        default=DEFAULT_METRICS_LOG_PATH,
        help="JSONL path for training metric events",
    )
    resume_group = parser.add_mutually_exclusive_group()
    resume_group.add_argument("--resume", dest="resume", action="store_true", help="Resume from checkpoint (default)")
    resume_group.add_argument("--no-resume", dest="resume", action="store_false", help="Disable checkpoint resume")
    warm_start_group = parser.add_mutually_exclusive_group()
    warm_start_group.add_argument(
        "--warm-start",
        dest="warm_start",
        action="store_true",
        help="Warm start from existing --out model when no checkpoint resume (default)",
    )
    warm_start_group.add_argument(
        "--no-warm-start",
        dest="warm_start",
        action="store_false",
        help="Disable warm start from existing --out model",
    )
    parser.add_argument("--save-every", type=int, default=1, help="Save checkpoint every N completed epochs")
    parser.add_argument(
        "--early-stop-patience",
        type=int,
        default=6,
        help="Stop after N epochs without sufficient validation improvement (0 disables)",
    )
    parser.add_argument(
        "--early-stop-min-delta",
        type=float,
        default=0.002,
        help="Minimum val_mse improvement required to reset early-stop patience",
    )
    parser.add_argument(
        "--early-stop-min-epochs",
        type=int,
        default=10,
        help="Do not trigger early stopping before this epoch",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.set_defaults(resume=True, warm_start=True)
    return parser.parse_args()


def parse_hidden_layers(value: str) -> List[int]:
    parts = [entry.strip() for entry in value.split(",") if entry.strip()]
    hidden = [int(entry) for entry in parts]
    if not hidden:
        raise ValueError("At least one hidden layer is required")
    if any(width <= 0 for width in hidden):
        raise ValueError("Hidden layer sizes must be positive integers")
    return hidden


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def compute_metrics(model: nn.Module, x: torch.Tensor, y: torch.Tensor, device: torch.device):
    model.eval()
    with torch.no_grad():
        predictions = model(x.to(device)).cpu().squeeze(1)
        targets = y.squeeze(1)
        mse = torch.mean((predictions - targets) ** 2).item()
        mae = torch.mean(torch.abs(predictions - targets)).item()

        predicted_class = torch.where(
            predictions > 0.15,
            torch.tensor(1.0),
            torch.where(predictions < -0.15, torch.tensor(-1.0), torch.tensor(0.0)),
        )
        target_class = torch.where(
            targets > 0.0,
            torch.tensor(1.0),
            torch.where(targets < 0.0, torch.tensor(-1.0), torch.tensor(0.0)),
        )
        sign_accuracy = torch.mean((predicted_class == target_class).float()).item()
    return mse, mae, sign_accuracy


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    remaining = seconds % 60
    if hours > 0:
        return f"{hours}h{minutes:02d}m{remaining:02d}s"
    if minutes > 0:
        return f"{minutes}m{remaining:02d}s"
    return f"{remaining}s"


def ensure_parent_dir(path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def append_metrics_log(
    metrics_path: str,
    run_id: str,
    event_type: str,
    payload: Dict[str, Any],
) -> None:
    try:
        ensure_parent_dir(metrics_path)
        event = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": "deep",
            "runId": run_id,
            "eventType": event_type,
        }
        event.update(payload)
        with open(metrics_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event))
            handle.write("\n")
    except Exception as error:
        print(f"[warn] failed to write metrics log: {error}", flush=True)


def linear_layers(model: StrategoValueNet) -> List[nn.Linear]:
    return [module for module in model.net if isinstance(module, nn.Linear)]


def clone_model_state(model: nn.Module) -> Dict[str, torch.Tensor]:
    return {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}


def build_output_payload(
    model: StrategoValueNet,
    feature_names: List[str],
    hidden_layers: List[int],
    meta: Dict[str, Any],
    sample_count: int,
    epochs_completed: int,
    args: argparse.Namespace,
    device: torch.device,
) -> Dict[str, Any]:
    exported_layers = []
    model_layers = linear_layers(model)
    for layer_index, linear in enumerate(model_layers):
        activation = "tanh" if layer_index < len(model_layers) - 1 else "linear"
        exported_layers.append(
            {
                "inputSize": int(linear.in_features),
                "outputSize": int(linear.out_features),
                "weights": linear.weight.detach().cpu().reshape(-1).tolist(),
                "bias": linear.bias.detach().cpu().tolist(),
                "activation": activation,
            }
        )

    difficulty = str(meta.get("difficulty", "mixed"))
    if difficulty not in {"medium", "hard", "extreme", "mixed"}:
        difficulty = "mixed"

    return {
        "version": 2,
        "kind": "mlp",
        "featureNames": feature_names,
        "layers": exported_layers,
        "outputActivation": "tanh",
        "training": {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "games": int(meta.get("games", 0)),
            "positionSamples": int(sample_count),
            "epochs": int(epochs_completed),
            "difficulty": difficulty,
            "framework": "pytorch",
            "device": device.type,
            "batchSize": int(args.batch_size),
            "learningRate": float(args.lr),
            "hiddenLayers": hidden_layers,
            "workers": int(meta.get("workers", 1)),
        },
    }


def write_exported_model(
    out_path: str,
    model: StrategoValueNet,
    feature_names: List[str],
    hidden_layers: List[int],
    meta: Dict[str, Any],
    sample_count: int,
    epochs_completed: int,
    args: argparse.Namespace,
    device: torch.device,
) -> None:
    ensure_parent_dir(out_path)
    payload = build_output_payload(
        model=model,
        feature_names=feature_names,
        hidden_layers=hidden_layers,
        meta=meta,
        sample_count=sample_count,
        epochs_completed=epochs_completed,
        args=args,
        device=device,
    )
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def load_weights_from_export(
    out_path: str,
    model: StrategoValueNet,
    feature_names: List[str],
) -> bool:
    if not os.path.exists(out_path):
        return False

    try:
        with open(out_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception as error:
        print(f"[deep:warm-start] skipping existing model ({error})", flush=True)
        return False

    if payload.get("kind") != "mlp":
        print("[deep:warm-start] existing model is not MLP, skipping", flush=True)
        return False

    if payload.get("featureNames") != feature_names:
        print("[deep:warm-start] feature schema mismatch, skipping", flush=True)
        return False

    source_layers = payload.get("layers")
    if not isinstance(source_layers, list):
        print("[deep:warm-start] invalid MLP layer payload, skipping", flush=True)
        return False

    target_layers = linear_layers(model)
    if len(source_layers) != len(target_layers):
        print("[deep:warm-start] layer count mismatch, skipping", flush=True)
        return False

    with torch.no_grad():
        for source, target in zip(source_layers, target_layers):
            if not isinstance(source, dict):
                print("[deep:warm-start] invalid layer format, skipping", flush=True)
                return False

            input_size = int(source.get("inputSize", -1))
            output_size = int(source.get("outputSize", -1))
            weights = source.get("weights")
            bias = source.get("bias")
            if input_size != target.in_features or output_size != target.out_features:
                print("[deep:warm-start] layer shape mismatch, skipping", flush=True)
                return False
            if not isinstance(weights, list) or len(weights) != input_size * output_size:
                print("[deep:warm-start] weight shape mismatch, skipping", flush=True)
                return False
            if not isinstance(bias, list) or len(bias) != output_size:
                print("[deep:warm-start] bias shape mismatch, skipping", flush=True)
                return False

            weight_tensor = torch.tensor(
                weights,
                dtype=target.weight.dtype,
                device=target.weight.device,
            ).reshape(output_size, input_size)
            bias_tensor = torch.tensor(
                bias,
                dtype=target.bias.dtype,
                device=target.bias.device,
            )
            target.weight.copy_(weight_tensor)
            target.bias.copy_(bias_tensor)

    return True


def save_checkpoint(
    checkpoint_path: str,
    model: StrategoValueNet,
    optimizer: torch.optim.Optimizer,
    epoch: int,
    feature_names: List[str],
    hidden_layers: List[int],
    sample_count: int,
) -> None:
    ensure_parent_dir(checkpoint_path)
    torch.save(
        {
            "version": CHECKPOINT_VERSION,
            "epoch": int(epoch),
            "feature_names": feature_names,
            "hidden_layers": hidden_layers,
            "sample_count": int(sample_count),
            "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model_state": model.state_dict(),
            "optimizer_state": optimizer.state_dict(),
        },
        checkpoint_path,
    )


def load_checkpoint(
    checkpoint_path: str,
    model: StrategoValueNet,
    optimizer: torch.optim.Optimizer,
    feature_names: List[str],
    hidden_layers: List[int],
    device: torch.device,
) -> Tuple[int, bool]:
    if not os.path.exists(checkpoint_path):
        return 1, False

    try:
        checkpoint = torch.load(checkpoint_path, map_location=device)
    except Exception as error:
        print(f"[deep:resume] failed to read checkpoint ({error}), starting from scratch", flush=True)
        return 1, False

    if not isinstance(checkpoint, dict):
        print("[deep:resume] invalid checkpoint format, starting from scratch", flush=True)
        return 1, False

    if int(checkpoint.get("version", 0)) != CHECKPOINT_VERSION:
        print("[deep:resume] checkpoint version mismatch, starting from scratch", flush=True)
        return 1, False
    if checkpoint.get("feature_names") != feature_names:
        print("[deep:resume] feature schema mismatch, starting from scratch", flush=True)
        return 1, False
    if checkpoint.get("hidden_layers") != hidden_layers:
        print("[deep:resume] hidden-layer mismatch, starting from scratch", flush=True)
        return 1, False

    model_state = checkpoint.get("model_state")
    optimizer_state = checkpoint.get("optimizer_state")
    if not model_state or not optimizer_state:
        print("[deep:resume] checkpoint is missing model/optimizer state", flush=True)
        return 1, False

    try:
        model.load_state_dict(model_state)
        optimizer.load_state_dict(optimizer_state)
    except Exception as error:
        print(f"[deep:resume] failed to restore checkpoint ({error}), starting from scratch", flush=True)
        return 1, False

    epoch = int(checkpoint.get("epoch", 0))
    start_epoch = max(1, epoch + 1)
    print(f"[deep:resume] resumed from {checkpoint_path} at epoch {epoch}", flush=True)
    return start_epoch, True


def main() -> None:
    args = parse_args()
    if args.save_every <= 0:
        raise ValueError("--save-every must be a positive integer")
    if args.early_stop_patience < 0:
        raise ValueError("--early-stop-patience must be >= 0")
    if args.early_stop_min_delta < 0:
        raise ValueError("--early-stop-min-delta must be >= 0")
    if args.early_stop_min_epochs < 0:
        raise ValueError("--early-stop-min-epochs must be >= 0")

    run_id = f"deep-{int(time.time() * 1000)}-{os.getpid()}"
    hidden_layers = parse_hidden_layers(args.hidden)
    set_seed(args.seed)

    with open(args.dataset, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    feature_names = payload.get("featureNames")
    samples = payload.get("samples")
    meta = payload.get("meta", {})

    if not isinstance(feature_names, list) or not feature_names:
        raise ValueError("Dataset is missing featureNames")
    if not isinstance(samples, list) or len(samples) == 0:
        raise ValueError("Dataset contains no samples")

    x_data = torch.tensor([sample["features"] for sample in samples], dtype=torch.float32)
    y_data = torch.tensor([sample["target"] for sample in samples], dtype=torch.float32).unsqueeze(1)

    if x_data.shape[1] != len(feature_names):
        raise ValueError("Dataset feature dimension mismatch")

    sample_count = x_data.shape[0]
    split_index = max(1, int(sample_count * 0.9))
    permutation = torch.randperm(sample_count)
    train_indices = permutation[:split_index]
    val_indices = permutation[split_index:] if split_index < sample_count else permutation[:split_index]

    x_train = x_data[train_indices]
    y_train = y_data[train_indices]
    x_val = x_data[val_indices]
    y_val = y_data[val_indices]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = StrategoValueNet(len(feature_names), hidden_layers).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    criterion = nn.MSELoss()
    loader = DataLoader(TensorDataset(x_train, y_train), batch_size=args.batch_size, shuffle=True)
    output_path = os.path.abspath(args.out)
    checkpoint_path = os.path.abspath(args.checkpoint)
    metrics_path = os.path.abspath(args.metrics_log)

    start_epoch = 1
    resumed_from_checkpoint = False
    if args.resume:
        start_epoch, resumed_from_checkpoint = load_checkpoint(
            checkpoint_path=checkpoint_path,
            model=model,
            optimizer=optimizer,
            feature_names=feature_names,
            hidden_layers=hidden_layers,
            device=device,
        )

    warm_started = False
    if not resumed_from_checkpoint and args.warm_start:
        warm_started = load_weights_from_export(
            out_path=output_path,
            model=model,
            feature_names=feature_names,
        )
        if warm_started:
            print(f"[deep:warm-start] loaded weights from {output_path}", flush=True)

    interrupted = False

    def request_interrupt(_: int, __: Optional[Any]) -> None:
        nonlocal interrupted
        if interrupted:
            return
        interrupted = True
        print("[deep:interrupt] interrupt received, saving checkpoint after current batch...", flush=True)

    signal.signal(signal.SIGINT, request_interrupt)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_interrupt)

    print(
        (
            f"[deep:setup] device={device.type} samples={sample_count} train={x_train.shape[0]} "
            f"val={x_val.shape[0]} hidden={hidden_layers} epochs={args.epochs} start_epoch={start_epoch} "
            f"resume={'on' if args.resume else 'off'} warm_start={'on' if args.warm_start else 'off'} "
            f"loaded_checkpoint={'yes' if resumed_from_checkpoint else 'no'} loaded_weights={'yes' if warm_started else 'no'} "
            f"early_stop_patience={args.early_stop_patience} early_stop_min_delta={args.early_stop_min_delta} "
            f"early_stop_min_epochs={args.early_stop_min_epochs}"
        ),
        flush=True,
    )
    print(f"[deep:setup] checkpoint={checkpoint_path}", flush=True)
    append_metrics_log(
        metrics_path=metrics_path,
        run_id=run_id,
        event_type="run_start",
        payload={
            "options": {
                "games": int(meta.get("games", 0)),
                "difficulty": str(meta.get("difficulty", "mixed")),
                "workers": int(meta.get("workers", 1)),
                "epochs": int(args.epochs),
                "batchSize": int(args.batch_size),
                "learningRate": float(args.lr),
                "weightDecay": float(args.weight_decay),
                "hiddenLayers": hidden_layers,
                "resume": bool(args.resume),
                "warmStart": bool(args.warm_start),
                "checkpoint": checkpoint_path,
                "earlyStopPatience": int(args.early_stop_patience),
                "earlyStopMinDelta": float(args.early_stop_min_delta),
                "earlyStopMinEpochs": int(args.early_stop_min_epochs),
            },
            "device": device.type,
            "sampleCount": int(sample_count),
            "resumedFromCheckpoint": resumed_from_checkpoint,
            "warmStarted": warm_started,
            "startEpoch": int(start_epoch),
        },
    )

    train_started_at = time.time()
    last_completed_epoch = start_epoch - 1
    last_epoch_with_updates = start_epoch - 1
    best_val_mse = float("inf")
    best_epoch = 0
    best_model_state: Optional[Dict[str, torch.Tensor]] = None
    early_stop_wait = 0
    early_stopped = False

    for epoch in range(start_epoch, args.epochs + 1):
        if interrupted:
            break

        model.train()
        running_loss = 0.0
        batch_count = 0

        for batch_inputs, batch_targets in loader:
            if interrupted:
                break

            batch_inputs = batch_inputs.to(device)
            batch_targets = batch_targets.to(device)

            optimizer.zero_grad(set_to_none=True)
            predictions = model(batch_inputs)
            loss = criterion(predictions, batch_targets)
            loss.backward()
            optimizer.step()

            running_loss += loss.item()
            batch_count += 1
            last_epoch_with_updates = epoch

        if interrupted:
            save_checkpoint(
                checkpoint_path=checkpoint_path,
                model=model,
                optimizer=optimizer,
                epoch=max(last_epoch_with_updates, last_completed_epoch),
                feature_names=feature_names,
                hidden_layers=hidden_layers,
                sample_count=sample_count,
            )
            write_exported_model(
                out_path=output_path,
                model=model,
                feature_names=feature_names,
                hidden_layers=hidden_layers,
                meta=meta,
                sample_count=sample_count,
                epochs_completed=max(last_epoch_with_updates, last_completed_epoch),
                args=args,
                device=device,
            )
            print(
                f"[deep:interrupt] checkpoint saved to {checkpoint_path}; partial model exported to {output_path}",
                flush=True,
            )
            print("[deep:interrupt] rerun with --resume to continue from this checkpoint", flush=True)
            append_metrics_log(
                metrics_path=metrics_path,
                run_id=run_id,
                event_type="run_end",
                payload={
                    "status": "interrupted",
                    "epochsCompleted": int(max(last_epoch_with_updates, last_completed_epoch)),
                    "sampleCount": int(sample_count),
                },
            )
            raise SystemExit(130)

        train_mse, train_mae, train_acc = compute_metrics(model, x_train, y_train, device)
        val_mse, val_mae, val_acc = compute_metrics(model, x_val, y_val, device)
        improved = best_epoch == 0 or (best_val_mse - val_mse) >= args.early_stop_min_delta
        if improved:
            best_val_mse = val_mse
            best_epoch = epoch
            best_model_state = clone_model_state(model)
            early_stop_wait = 0
        else:
            early_stop_wait += 1

        elapsed = time.time() - train_started_at
        eta = 0.0 if epoch == args.epochs else (elapsed / epoch) * (args.epochs - epoch)
        avg_loss = running_loss / max(1, batch_count)

        print(
            (
                f"[deep] epoch {epoch}/{args.epochs} loss={avg_loss:.4f} train_mse={train_mse:.4f} "
                f"val_mse={val_mse:.4f} val_acc={val_acc * 100:.1f}% best_val_mse={best_val_mse:.4f} "
                f"best_epoch={best_epoch} es_wait={early_stop_wait}/{args.early_stop_patience} "
                f"elapsed={format_duration(elapsed)} eta={format_duration(eta)}"
            ),
            flush=True,
        )
        append_metrics_log(
            metrics_path=metrics_path,
            run_id=run_id,
            event_type="epoch",
            payload={
                "epoch": int(epoch),
                "totalEpochs": int(args.epochs),
                "loss": float(avg_loss),
                "trainMse": float(train_mse),
                "trainMae": float(train_mae),
                "trainAcc": float(train_acc),
                "valMse": float(val_mse),
                "valMae": float(val_mae),
                "valAcc": float(val_acc),
                "elapsedSeconds": float(round(elapsed, 3)),
                "etaSeconds": float(round(eta, 3)),
                "sampleCount": int(sample_count),
                "bestValMse": float(best_val_mse),
                "bestEpoch": int(best_epoch),
                "earlyStopWait": int(early_stop_wait),
                "earlyStopPatience": int(args.early_stop_patience),
            },
        )
        last_completed_epoch = epoch

        if epoch % args.save_every == 0:
            save_checkpoint(
                checkpoint_path=checkpoint_path,
                model=model,
                optimizer=optimizer,
                epoch=epoch,
                feature_names=feature_names,
                hidden_layers=hidden_layers,
                sample_count=sample_count,
            )
            print(f"[deep:checkpoint] epoch={epoch} saved={checkpoint_path}", flush=True)

        if (
            args.early_stop_patience > 0
            and epoch >= args.early_stop_min_epochs
            and early_stop_wait >= args.early_stop_patience
        ):
            early_stopped = True
            print(
                (
                    f"[deep:early-stop] epoch={epoch} no val_mse improvement >= {args.early_stop_min_delta} "
                    f"for {args.early_stop_patience} epochs; best_epoch={best_epoch} best_val_mse={best_val_mse:.4f}"
                ),
                flush=True,
            )
            break

    final_epoch_for_metadata = max(last_completed_epoch, 0)
    selected_model_epoch = final_epoch_for_metadata
    if best_model_state is not None:
        model.load_state_dict(best_model_state)
        selected_model_epoch = best_epoch
        if early_stopped:
            print(
                f"[deep:early-stop] restored best epoch {best_epoch} weights before export",
                flush=True,
            )

    write_exported_model(
        out_path=output_path,
        model=model,
        feature_names=feature_names,
        hidden_layers=hidden_layers,
        meta=meta,
        sample_count=sample_count,
        epochs_completed=selected_model_epoch,
        args=args,
        device=device,
    )

    if os.path.exists(checkpoint_path):
        os.remove(checkpoint_path)
        print(f"[deep:checkpoint] removed={checkpoint_path}", flush=True)

    train_mse, train_mae, train_acc = compute_metrics(model, x_train, y_train, device)
    val_mse, val_mae, val_acc = compute_metrics(model, x_val, y_val, device)

    print(
        (
            f"[deep:done] saved={output_path} selected_epoch={selected_model_epoch} "
            f"completed_epochs={final_epoch_for_metadata} train_mse={train_mse:.4f} train_mae={train_mae:.4f} "
            f"train_acc={train_acc * 100:.1f}% val_mse={val_mse:.4f} val_mae={val_mae:.4f} val_acc={val_acc * 100:.1f}%"
        ),
        flush=True,
    )
    append_metrics_log(
        metrics_path=metrics_path,
        run_id=run_id,
        event_type="run_end",
        payload={
            "status": "early_stopped" if early_stopped else "completed",
            "epochsCompleted": int(final_epoch_for_metadata),
            "selectedEpoch": int(selected_model_epoch),
            "sampleCount": int(sample_count),
            "trainMse": float(train_mse),
            "trainMae": float(train_mae),
            "trainAcc": float(train_acc),
            "valMse": float(val_mse),
            "valMae": float(val_mae),
            "valAcc": float(val_acc),
            "bestValMse": float(best_val_mse if best_epoch > 0 else val_mse),
            "bestEpoch": int(best_epoch if best_epoch > 0 else selected_model_epoch),
            "earlyStopPatience": int(args.early_stop_patience),
            "earlyStopMinDelta": float(args.early_stop_min_delta),
            "earlyStopMinEpochs": int(args.early_stop_min_epochs),
            "earlyStopped": bool(early_stopped),
        },
    )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        print("[deep:interrupt] interrupted", flush=True)
        sys.exit(130)
