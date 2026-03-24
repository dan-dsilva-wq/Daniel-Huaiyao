#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
import random
import sys
import time
import traceback
from typing import Any, Dict, List, Tuple


def load_train_module() -> Any:
    script_path = os.path.join(os.path.dirname(__file__), "train-alphazero.py")
    spec = importlib.util.spec_from_file_location("hive_az_train_impl", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load trainer module: {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TRAIN = load_train_module()
PolicyValueNet = TRAIN.PolicyValueNet
append_metrics = TRAIN.append_metrics
batch_indices = TRAIN.batch_indices
compute_batch_loss = TRAIN.compute_batch_loss
compute_short_hash = TRAIN.compute_short_hash
evaluate_split = TRAIN.evaluate_split
export_model = TRAIN.export_model
load_initial_model = TRAIN.load_initial_model
parse_hidden = TRAIN.parse_hidden
read_dataset = TRAIN.read_dataset
resolve_device = TRAIN.resolve_device
set_seed = TRAIN.set_seed
torch = TRAIN.torch
update_ema = TRAIN.update_ema


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train many Hive AlphaZero candidates from one frozen dataset")
    parser.add_argument("--dataset", required=True, help="Frozen replay dataset JSON")
    parser.add_argument("--candidate-spec", required=True, help="JSON file with candidate definitions")
    parser.add_argument("--results-jsonl", required=True, help="Append-only per-candidate results log")
    parser.add_argument("--init-model", default="", help="Optional warm-start model")
    parser.add_argument("--metrics-log", default=TRAIN.DEFAULT_METRICS_LOG_PATH, help="Metrics JSONL path")
    parser.add_argument("--hidden", default="128,64", help="Hidden layer sizes (csv)")
    parser.add_argument("--epochs", type=int, default=8, help="Training epochs")
    parser.add_argument("--batch-size", type=int, default=1024, help="Batch size")
    parser.add_argument("--lr", type=float, default=0.0015, help="Learning rate")
    parser.add_argument("--weight-decay", type=float, default=0.0001, help="AdamW weight decay")
    parser.add_argument("--device", default="auto", help="auto|cuda|cpu")
    parser.add_argument("--policy-loss-weight", type=float, default=2.0)
    parser.add_argument("--value-loss-weight", type=float, default=1.0)
    parser.add_argument("--aux-loss-weight", type=float, default=0.2)
    parser.add_argument("--ema-decay", type=float, default=0.995)
    parser.add_argument("--label-smoothing", type=float, default=0.02)
    parser.add_argument("--policy-target-temperature", type=float, default=0.12)
    parser.add_argument("--validation-ratio", type=float, default=0.1)
    parser.add_argument("--split-seed", type=int, default=42)
    parser.add_argument("--batch-id", default="batch-0")
    return parser.parse_args()


def load_candidate_specs(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if not isinstance(payload, list):
        raise ValueError("Candidate spec must be a JSON array")

    candidates: List[Dict[str, Any]] = []
    for raw in payload:
        if not isinstance(raw, dict):
            raise ValueError("Candidate entry must be an object")
        index = raw.get("index")
        seed = raw.get("seed")
        output_path = raw.get("outputPath")
        train_sample_fraction = raw.get("trainSampleFraction", 1.0)
        train_sample_seed = raw.get("trainSampleSeed", int(seed) + 17 if isinstance(seed, int) else 17)
        label_smoothing = raw.get("labelSmoothing")
        init_noise_std = raw.get("initNoiseStd", 0.0)
        init_noise_seed = raw.get("initNoiseSeed", int(seed) + 29 if isinstance(seed, int) else 29)
        if not isinstance(index, int) or index < 0:
            raise ValueError(f"Invalid candidate index: {index}")
        if not isinstance(seed, int):
            raise ValueError(f"Invalid candidate seed for index {index}: {seed}")
        if not isinstance(output_path, str) or not output_path.strip():
            raise ValueError(f"Invalid outputPath for candidate {index}")
        if not isinstance(train_sample_fraction, (int, float)) or float(train_sample_fraction) <= 0 or float(train_sample_fraction) > 1:
            raise ValueError(f"Invalid trainSampleFraction for candidate {index}: {train_sample_fraction}")
        if not isinstance(train_sample_seed, int):
            raise ValueError(f"Invalid trainSampleSeed for candidate {index}: {train_sample_seed}")
        if label_smoothing is not None and (not isinstance(label_smoothing, (int, float)) or float(label_smoothing) < 0 or float(label_smoothing) >= 1):
            raise ValueError(f"Invalid labelSmoothing for candidate {index}: {label_smoothing}")
        if not isinstance(init_noise_std, (int, float)) or float(init_noise_std) < 0:
            raise ValueError(f"Invalid initNoiseStd for candidate {index}: {init_noise_std}")
        if not isinstance(init_noise_seed, int):
            raise ValueError(f"Invalid initNoiseSeed for candidate {index}: {init_noise_seed}")
        candidates.append({
            "index": index,
            "seed": seed,
            "outputPath": output_path,
            "trainSampleFraction": float(train_sample_fraction),
            "trainSampleSeed": int(train_sample_seed),
            "labelSmoothing": float(label_smoothing) if label_smoothing is not None else None,
            "initNoiseStd": float(init_noise_std),
            "initNoiseSeed": int(init_noise_seed),
        })

    return candidates


def split_dataset_fixed(samples: List[Any], ratio: float, split_seed: int) -> Tuple[List[Any], List[Any]]:
    shuffled = list(samples)
    rng = random.Random(split_seed)
    rng.shuffle(shuffled)
    if len(shuffled) <= 1:
        return shuffled, []
    val_count = max(1, min(len(shuffled) - 1, int(len(shuffled) * ratio)))
    train_count = len(shuffled) - val_count
    return shuffled[:train_count], shuffled[train_count:]


def select_train_subset(samples: List[Any], fraction: float, seed: int) -> List[Any]:
    if fraction >= 0.999999 or len(samples) <= 1:
        return list(samples)
    ordered = list(samples)
    random.Random(seed).shuffle(ordered)
    target_count = max(1, min(len(ordered), int(round(len(ordered) * fraction))))
    return ordered[:target_count]


def apply_init_noise(model: Any, std: float, seed: int) -> None:
    if std <= 0:
        return
    random_state = torch.random.get_rng_state()
    cuda_states = None
    if torch.cuda.is_available():
        cuda_states = torch.cuda.get_rng_state_all()
        torch.cuda.manual_seed_all(seed)
    torch.manual_seed(seed)
    try:
        with torch.no_grad():
            for parameter in model.parameters():
                parameter.add_(torch.randn_like(parameter) * float(std))
    finally:
        torch.random.set_rng_state(random_state)
        if cuda_states is not None:
            torch.cuda.set_rng_state_all(cuda_states)


def append_jsonl(path: str, payload: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload))
        handle.write("\n")


def build_train_args(config: argparse.Namespace) -> argparse.Namespace:
    return argparse.Namespace(
        batch_size=int(config.batch_size),
        policy_loss_weight=float(config.policy_loss_weight),
        value_loss_weight=float(config.value_loss_weight),
        aux_loss_weight=float(config.aux_loss_weight),
        ema_decay=float(config.ema_decay),
        label_smoothing=float(config.label_smoothing),
    )


def train_candidate(
    config: argparse.Namespace,
    train_config: argparse.Namespace,
    state_names: List[str],
    action_names: List[str],
    train_samples: List[Any],
    val_samples: List[Any],
    hidden: List[int],
    device: Any,
    candidate: Dict[str, Any],
) -> Dict[str, Any]:
    candidate_index = int(candidate["index"])
    candidate_seed = int(candidate["seed"])
    train_sample_fraction = float(candidate.get("trainSampleFraction", 1.0))
    train_sample_seed = int(candidate.get("trainSampleSeed", candidate_seed + 17))
    candidate_label_smoothing = candidate.get("labelSmoothing")
    init_noise_std = float(candidate.get("initNoiseStd", 0.0))
    init_noise_seed = int(candidate.get("initNoiseSeed", candidate_seed + 29))
    output_path = os.path.abspath(str(candidate["outputPath"]))
    candidate_train_samples = select_train_subset(train_samples, train_sample_fraction, train_sample_seed)
    candidate_train_config = build_train_args(config)
    if candidate_label_smoothing is not None:
        candidate_train_config.label_smoothing = float(candidate_label_smoothing)

    set_seed(candidate_seed)
    model = PolicyValueNet(len(state_names), len(action_names), hidden).to(device)
    init_result = load_initial_model(model, config.init_model, state_names, action_names, hidden)
    apply_init_noise(model, init_noise_std, init_noise_seed)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.lr, weight_decay=config.weight_decay)
    ema_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}
    run_id = f"az-tournament-train-{candidate_index}-{int(time.time())}-{random.randint(1000, 9999)}"

    append_metrics(
        config.metrics_log,
        run_id,
        "run_start",
        {
            "source": "az",
            "mode": "tournament",
            "candidateIndex": candidate_index,
            "candidateSeed": candidate_seed,
            "batchId": config.batch_id,
            "dataset": os.path.abspath(config.dataset),
            "sampleCount": len(candidate_train_samples) + len(val_samples),
            "trainCount": len(candidate_train_samples),
            "valCount": len(val_samples),
            "stateFeatureCount": len(state_names),
            "actionFeatureCount": len(action_names),
            "hidden": hidden,
            "epochs": int(config.epochs),
            "batchSize": int(config.batch_size),
            "learningRate": float(config.lr),
            "weightDecay": float(config.weight_decay),
            "device": device.type,
            "initModelPath": init_result["path"],
            "initModelHash": init_result["hash"],
            "initModelLoaded": bool(init_result["loaded"]),
            "initModelReason": init_result["reason"],
            "trainSampleFraction": train_sample_fraction,
            "trainSampleSeed": train_sample_seed,
            "candidateLabelSmoothing": float(candidate_train_config.label_smoothing),
            "candidateInitNoiseStd": init_noise_std,
        },
    )

    print(
        f"[batch] candidate={candidate_index} seed={candidate_seed} epochs={config.epochs} "
        f"train={len(candidate_train_samples)} val={len(val_samples)} frac={train_sample_fraction:.3f} "
        f"ls={float(candidate_train_config.label_smoothing):.4f} noise={init_noise_std:.4f} out={output_path}",
        flush=True,
    )

    started = time.time()
    final_train_stats: Dict[str, float] = {
        "loss": 0.0,
        "valueLoss": 0.0,
        "policyLoss": 0.0,
        "auxLoss": 0.0,
        "policyEntropy": 0.0,
    }
    final_val_stats: Dict[str, float] = {
        "loss": 0.0,
        "valueLoss": 0.0,
        "policyLoss": 0.0,
        "auxLoss": 0.0,
        "policyEntropy": 0.0,
    }

    for epoch in range(1, config.epochs + 1):
        model.train()
        train_batches = batch_indices(len(candidate_train_samples), max(1, config.batch_size))
        epoch_loss = 0.0
        epoch_value = 0.0
        epoch_policy = 0.0
        epoch_aux = 0.0
        epoch_entropy = 0.0

        for batch_ids in train_batches:
            batch = [candidate_train_samples[i] for i in batch_ids]
            optimizer.zero_grad()
            loss, metrics = compute_batch_loss(model, batch, device, candidate_train_config)
            loss.backward()
            optimizer.step()
            epoch_loss += float(loss.item())
            epoch_value += metrics["valueLoss"]
            epoch_policy += metrics["policyLoss"]
            epoch_aux += metrics["auxLoss"]
            epoch_entropy += metrics["policyEntropy"]

        update_ema(ema_state, model.state_dict(), config.ema_decay)
        batch_count = max(1, len(train_batches))
        final_train_stats = {
            "loss": epoch_loss / batch_count,
            "valueLoss": epoch_value / batch_count,
            "policyLoss": epoch_policy / batch_count,
            "auxLoss": epoch_aux / batch_count,
            "policyEntropy": epoch_entropy / batch_count,
        }
        final_val_stats = evaluate_split(model, val_samples, device, candidate_train_config)
        elapsed = time.time() - started
        eta = 0 if epoch == config.epochs else (elapsed / epoch) * (config.epochs - epoch)

        print(
            f"[batch] candidate={candidate_index} epoch {epoch}/{config.epochs} "
            f"train_loss={final_train_stats['loss']:.4f} val_loss={final_val_stats['loss']:.4f} "
            f"val_policy={final_val_stats['policyLoss']:.4f} elapsed={int(elapsed)}s eta={int(eta)}s",
            flush=True,
        )

        append_metrics(
            config.metrics_log,
            run_id,
            "epoch",
            {
                "source": "az",
                "mode": "tournament",
                "candidateIndex": candidate_index,
                "candidateSeed": candidate_seed,
                "batchId": config.batch_id,
                "epoch": int(epoch),
                "totalEpochs": int(config.epochs),
                "trainLoss": final_train_stats["loss"],
                "trainValueLoss": final_train_stats["valueLoss"],
                "trainPolicyLoss": final_train_stats["policyLoss"],
                "trainAuxLoss": final_train_stats["auxLoss"],
                "trainPolicyEntropy": final_train_stats["policyEntropy"],
                "valLoss": final_val_stats["loss"],
                "valValueLoss": final_val_stats["valueLoss"],
                "valPolicyLoss": final_val_stats["policyLoss"],
                "valAuxLoss": final_val_stats["auxLoss"],
                "valPolicyEntropy": final_val_stats["policyEntropy"],
            },
        )

    model.load_state_dict({name: tensor.to(device) for name, tensor in ema_state.items()})
    training_meta = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "games": len(candidate_train_samples) + len(val_samples),
        "positionSamples": len(candidate_train_samples) + len(val_samples),
        "epochs": int(config.epochs),
        "difficulty": "mixed",
        "framework": "pytorch-tournament",
        "device": device.type,
        "batchSize": int(config.batch_size),
        "learningRate": float(config.lr),
        "hiddenLayers": hidden,
        "policyLossWeight": float(config.policy_loss_weight),
        "valueLossWeight": float(config.value_loss_weight),
        "auxLossWeight": float(config.aux_loss_weight),
        "initializedFrom": init_result["path"],
        "initializedFromHash": init_result["hash"],
        "initializedFromLoaded": bool(init_result["loaded"]),
        "initializedFromReason": init_result["reason"],
        "candidateSeed": candidate_seed,
        "candidateIndex": candidate_index,
        "splitSeed": int(config.split_seed),
        "validationRatio": float(config.validation_ratio),
        "batchId": config.batch_id,
        "trainSampleFraction": train_sample_fraction,
        "trainSampleSeed": train_sample_seed,
        "labelSmoothing": float(candidate_train_config.label_smoothing),
        "initNoiseStd": init_noise_std,
    }

    export_model(output_path, model, state_names, action_names, hidden, training_meta)
    with open(output_path, "r", encoding="utf-8") as handle:
        raw_model = handle.read()
    model_hash = compute_short_hash(raw_model)
    elapsed_seconds = time.time() - started

    append_metrics(
        config.metrics_log,
        run_id,
        "run_end",
        {
            "source": "az",
            "mode": "tournament",
            "candidateIndex": candidate_index,
            "candidateSeed": candidate_seed,
            "batchId": config.batch_id,
            "status": "completed",
            "outputPath": output_path,
            "epochs": int(config.epochs),
            "sampleCount": len(candidate_train_samples) + len(val_samples),
            "trainCount": len(candidate_train_samples),
            "valCount": len(val_samples),
            "trainLoss": final_train_stats["loss"],
            "valLoss": final_val_stats["loss"],
            "modelHash": model_hash,
            "elapsedSeconds": round(elapsed_seconds, 3),
            "trainSampleFraction": train_sample_fraction,
            "labelSmoothing": float(candidate_train_config.label_smoothing),
            "initNoiseStd": init_noise_std,
        },
    )

    return {
        "index": candidate_index,
        "seed": candidate_seed,
        "status": "completed",
        "runId": run_id,
        "outputPath": output_path,
        "modelHash": model_hash,
        "sampleCount": len(candidate_train_samples) + len(val_samples),
        "trainCount": len(candidate_train_samples),
        "valCount": len(val_samples),
        "trainLoss": final_train_stats["loss"],
        "valLoss": final_val_stats["loss"],
        "elapsedSeconds": round(elapsed_seconds, 3),
        "trainSampleFraction": train_sample_fraction,
        "labelSmoothing": float(candidate_train_config.label_smoothing),
        "initNoiseStd": init_noise_std,
    }


def main() -> None:
    args = parse_args()
    hidden = parse_hidden(args.hidden)
    device = resolve_device(args.device)
    train_config = build_train_args(args)

    candidates = load_candidate_specs(args.candidate_spec)
    state_names, action_names, samples, _ = read_dataset(args.dataset, args.policy_target_temperature)
    if len(samples) == 0:
        raise ValueError("Dataset is empty; generate more self-play samples")
    train_samples, val_samples = split_dataset_fixed(samples, args.validation_ratio, args.split_seed)

    print(
        f"[batch] loaded samples={len(samples)} train={len(train_samples)} val={len(val_samples)} "
        f"candidates={len(candidates)} device={device.type}",
        flush=True,
    )

    for candidate in candidates:
        try:
            result = train_candidate(
                args,
                train_config,
                state_names,
                action_names,
                train_samples,
                val_samples,
                hidden,
                device,
                candidate,
            )
            append_jsonl(args.results_jsonl, result)
        except Exception as error:  # pragma: no cover - surfaced to caller
            failure = {
                "index": int(candidate["index"]),
                "seed": int(candidate["seed"]),
                "status": "failed",
                "outputPath": os.path.abspath(str(candidate["outputPath"])),
                "error": str(error),
                "traceback": traceback.format_exc(),
            }
            append_jsonl(args.results_jsonl, failure)
            raise


if __name__ == "__main__":
    main()
