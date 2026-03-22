#!/usr/bin/env python3
import argparse
import importlib.util
import json
import math
import os
import random
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:
    import torch
except Exception:
    print("PyTorch is required. Install with: pip install torch", flush=True)
    raise


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
compute_batch_loss = TRAIN.compute_batch_loss
load_initial_model = TRAIN.load_initial_model
parse_hidden = TRAIN.parse_hidden
read_dataset = TRAIN.read_dataset
resolve_device = TRAIN.resolve_device
set_seed = TRAIN.set_seed
split_dataset = TRAIN.split_dataset


@dataclass
class PolicyMetrics:
    samples: int
    mean_target_entropy: float
    mean_pred_entropy: float
    mean_target_max_prob: float
    mean_pred_max_prob: float
    top1_match: float
    mean_cross_entropy: float
    mean_kl: float
    mean_logit_std: float
    mean_action_count: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Diagnose Hive AlphaZero policy learning quality")
    parser.add_argument("--dataset", required=True, help="Replay/dataset JSON file")
    parser.add_argument("--model", required=True, help="Model to evaluate")
    parser.add_argument("--compare-model", default="", help="Optional second model to compare on same split")
    parser.add_argument("--hidden", default="128,64", help="Hidden layer sizes for loading the model")
    parser.add_argument("--device", default="auto", help="auto|cuda|cpu")
    parser.add_argument("--seed", type=int, default=42, help="Deterministic split seed")
    parser.add_argument("--split", choices=["train", "val", "all"], default="val", help="Split to evaluate")
    parser.add_argument("--sample-limit", type=int, default=0, help="Limit evaluated samples (0 = all)")
    parser.add_argument("--policy-target-temperature", type=float, default=0.25, help="Replay target sharpening temperature")
    parser.add_argument("--batch-size", type=int, default=512, help="Evaluation batch size for summary loss")
    return parser.parse_args()


def softmax_from_logits(logits: torch.Tensor) -> torch.Tensor:
    return torch.softmax(logits, dim=0)


def entropy(probs: Sequence[float]) -> float:
    return -sum(p * math.log(max(p, 1e-12)) for p in probs if p > 0)


def kl_divergence(target: Sequence[float], pred: Sequence[float]) -> float:
    total = 0.0
    for target_prob, pred_prob in zip(target, pred):
        if target_prob <= 0:
            continue
        total += target_prob * (math.log(max(target_prob, 1e-12)) - math.log(max(pred_prob, 1e-12)))
    return total


def select_split(samples: List[Any], split: str, seed: int) -> List[Any]:
    if split == "all":
        return list(samples)
    random.seed(seed)
    train_samples, val_samples = split_dataset(list(samples), ratio=0.9)
    return train_samples if split == "train" else val_samples


def load_model(
    model_path: str,
    state_names: List[str],
    action_names: List[str],
    hidden: List[int],
    device: torch.device,
) -> PolicyValueNet:
    model = PolicyValueNet(len(state_names), len(action_names), hidden).to(device)
    init_result = load_initial_model(model, model_path, state_names, action_names, hidden)
    if not init_result["loaded"]:
        raise RuntimeError(f"Failed to load model {model_path}: {init_result['reason']}")
    model.eval()
    return model


def compute_policy_metrics(
    model: PolicyValueNet,
    samples: Sequence[Any],
    device: torch.device,
    batch_size: int,
) -> Tuple[PolicyMetrics, Dict[str, float]]:
    target_entropies: List[float] = []
    pred_entropies: List[float] = []
    target_max_probs: List[float] = []
    pred_max_probs: List[float] = []
    top1_matches = 0
    cross_entropies: List[float] = []
    kls: List[float] = []
    logit_stds: List[float] = []
    action_counts: List[int] = []

    args = argparse.Namespace(
        value_loss_weight=1.0,
        policy_loss_weight=2.0,
        aux_loss_weight=0.2,
        label_smoothing=0.0,
    )

    batches = [samples[i:i + batch_size] for i in range(0, len(samples), batch_size)]
    total_loss = 0.0
    total_value_loss = 0.0
    total_policy_loss = 0.0
    total_aux_loss = 0.0
    batch_count = 0

    with torch.no_grad():
        for batch in batches:
            loss, metrics = compute_batch_loss(model, list(batch), device, args)
            total_loss += float(loss.item())
            total_value_loss += float(metrics["valueLoss"])
            total_policy_loss += float(metrics["policyLoss"])
            total_aux_loss += float(metrics["auxLoss"])
            batch_count += 1

            state_tensor = torch.tensor([sample.state_features for sample in batch], dtype=torch.float32, device=device)
            embeddings = model.embed(state_tensor)
            for index, sample in enumerate(batch):
                action_tensor = torch.tensor(sample.action_features, dtype=torch.float32, device=device)
                sample_embedding = embeddings[index:index + 1].expand(len(sample.action_features), -1)
                logits = model.policy_logits(sample_embedding, action_tensor).detach().cpu()
                probs = softmax_from_logits(logits).tolist()
                target = list(sample.action_probs)
                target_entropy = entropy(target)
                pred_entropy = entropy(probs)
                target_entropies.append(target_entropy)
                pred_entropies.append(pred_entropy)
                target_max_probs.append(max(target))
                pred_max_probs.append(max(probs))
                target_top1 = max(range(len(target)), key=lambda i: target[i])
                pred_top1 = max(range(len(probs)), key=lambda i: probs[i])
                if target_top1 == pred_top1:
                    top1_matches += 1
                cross_entropies.append(-sum(t * math.log(max(p, 1e-12)) for t, p in zip(target, probs)))
                kls.append(kl_divergence(target, probs))
                if len(logits) > 1:
                    mean = float(logits.mean().item())
                    variance = float(((logits - mean) ** 2).mean().item())
                    logit_stds.append(math.sqrt(max(0.0, variance)))
                else:
                    logit_stds.append(0.0)
                action_counts.append(len(sample.action_features))

    count = max(1, len(samples))
    summary = PolicyMetrics(
        samples=len(samples),
        mean_target_entropy=sum(target_entropies) / count,
        mean_pred_entropy=sum(pred_entropies) / count,
        mean_target_max_prob=sum(target_max_probs) / count,
        mean_pred_max_prob=sum(pred_max_probs) / count,
        top1_match=top1_matches / count,
        mean_cross_entropy=sum(cross_entropies) / count,
        mean_kl=sum(kls) / count,
        mean_logit_std=sum(logit_stds) / count,
        mean_action_count=sum(action_counts) / count,
    )
    losses = {
        "loss": total_loss / max(1, batch_count),
        "valueLoss": total_value_loss / max(1, batch_count),
        "policyLoss": total_policy_loss / max(1, batch_count),
        "auxLoss": total_aux_loss / max(1, batch_count),
    }
    return summary, losses


def compare_models(
    baseline: PolicyValueNet,
    candidate: PolicyValueNet,
    samples: Sequence[Any],
    device: torch.device,
) -> Dict[str, float]:
    top1_changed = 0
    top1_better = 0
    ce_delta_sum = 0.0
    entropy_delta_sum = 0.0
    pred_max_delta_sum = 0.0

    with torch.no_grad():
        for sample in samples:
            action_tensor = torch.tensor(sample.action_features, dtype=torch.float32, device=device)
            state_tensor = torch.tensor([sample.state_features], dtype=torch.float32, device=device)
            base_embedding = baseline.embed(state_tensor).expand(len(sample.action_features), -1)
            cand_embedding = candidate.embed(state_tensor).expand(len(sample.action_features), -1)
            base_probs = softmax_from_logits(baseline.policy_logits(base_embedding, action_tensor).detach().cpu()).tolist()
            cand_probs = softmax_from_logits(candidate.policy_logits(cand_embedding, action_tensor).detach().cpu()).tolist()
            target = list(sample.action_probs)
            base_top1 = max(range(len(base_probs)), key=lambda i: base_probs[i])
            cand_top1 = max(range(len(cand_probs)), key=lambda i: cand_probs[i])
            target_top1 = max(range(len(target)), key=lambda i: target[i])
            if base_top1 != cand_top1:
                top1_changed += 1
            if int(cand_top1 == target_top1) > int(base_top1 == target_top1):
                top1_better += 1
            base_ce = -sum(t * math.log(max(p, 1e-12)) for t, p in zip(target, base_probs))
            cand_ce = -sum(t * math.log(max(p, 1e-12)) for t, p in zip(target, cand_probs))
            ce_delta_sum += cand_ce - base_ce
            entropy_delta_sum += entropy(cand_probs) - entropy(base_probs)
            pred_max_delta_sum += max(cand_probs) - max(base_probs)

    count = max(1, len(samples))
    return {
        "samples": len(samples),
        "top1ChangedRate": top1_changed / count,
        "top1ImprovedRate": top1_better / count,
        "meanCrossEntropyDelta": ce_delta_sum / count,
        "meanPredEntropyDelta": entropy_delta_sum / count,
        "meanPredMaxProbDelta": pred_max_delta_sum / count,
    }


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    hidden = parse_hidden(args.hidden)
    device = resolve_device(args.device)

    state_names, action_names, samples, dataset_meta = read_dataset(args.dataset, args.policy_target_temperature)
    selected = select_split(samples, args.split, args.seed)
    if args.sample_limit and args.sample_limit > 0:
        selected = selected[:args.sample_limit]
    if not selected:
        raise RuntimeError("No samples available for requested split")

    model = load_model(args.model, state_names, action_names, hidden, device)
    summary, losses = compute_policy_metrics(model, selected, device, args.batch_size)

    result: Dict[str, Any] = {
        "dataset": os.path.abspath(args.dataset),
        "datasetMeta": dataset_meta,
        "model": os.path.abspath(args.model),
        "split": args.split,
        "sampleCount": len(selected),
        "device": device.type,
        "policyTargetTemperature": args.policy_target_temperature,
        "losses": losses,
        "policy": summary.__dict__,
    }

    if args.compare_model.strip():
        compare_model = load_model(args.compare_model, state_names, action_names, hidden, device)
        result["comparison"] = {
            "baselineModel": os.path.abspath(args.compare_model),
            "candidateModel": os.path.abspath(args.model),
            **compare_models(compare_model, model, selected, device),
        }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
