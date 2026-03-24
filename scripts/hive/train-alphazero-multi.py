#!/usr/bin/env python3
import argparse
import contextlib
import hashlib
import importlib.util
import json
import math
import os
import random
import sys
import time
import traceback
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


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
build_adamw_optimizer = TRAIN.build_adamw_optimizer
compute_batch_loss = TRAIN.compute_batch_loss
compute_short_hash = TRAIN.compute_short_hash
create_grad_scaler = TRAIN.create_grad_scaler
enable_cuda_fast_math = TRAIN.enable_cuda_fast_math
export_model = TRAIN.export_model
load_initial_model = TRAIN.load_initial_model
parse_hidden = TRAIN.parse_hidden
read_dataset = TRAIN.read_dataset
resolve_device = TRAIN.resolve_device
set_seed = TRAIN.set_seed
torch = TRAIN.torch
update_ema = TRAIN.update_ema
functional_call = TRAIN.torch.func.functional_call
stack_module_state = TRAIN.torch.func.stack_module_state
vmap = TRAIN.torch.vmap
F = TRAIN.torch.nn.functional


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train many Hive AlphaZero candidates in one GPU process")
    parser.set_defaults(mixed_precision=None, compile_forward=False)
    parser.add_argument("--dataset", required=True, help="Frozen replay dataset JSON")
    parser.add_argument("--candidate-spec", required=True, help="JSON file with candidate definitions")
    parser.add_argument("--results-jsonl", required=True, help="Append-only per-candidate results log")
    parser.add_argument("--progress-jsonl", required=True, help="Append-only per-candidate progress log")
    parser.add_argument("--checkpoints-dir", required=True, help="Directory for per-candidate checkpoints")
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
    parser.add_argument("--batch-id", default="multi-0")
    parser.add_argument("--tournament-run-id", default="", help="Parent tournament run id for shared metrics")
    parser.add_argument("--multi-candidate-count", type=int, default=4, help="Active candidate models to keep resident")
    parser.add_argument("--checkpoint-every-epoch", action="store_true", help="Persist candidate state after each epoch")
    parser.add_argument("--memory-headroom-ratio", type=float, default=0.9, help="Max fraction of system RAM to estimate")
    parser.add_argument("--target-gpu-utilization", type=float, default=None, help="Advisory target only; logged but not enforced")
    parser.add_argument("--mixed-precision", dest="mixed_precision", action="store_true", help="Use CUDA autocast for candidate training")
    parser.add_argument("--no-mixed-precision", dest="mixed_precision", action="store_false", help="Disable CUDA autocast for candidate training")
    parser.add_argument("--compile-forward", action="store_true", help="Attempt torch.compile on the stacked parallel forward path")
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
        checkpoint_path = raw.get("checkpointPath")
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
        if checkpoint_path is not None and not isinstance(checkpoint_path, str):
            raise ValueError(f"Invalid checkpointPath for candidate {index}")
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
            "checkpointPath": checkpoint_path or "",
            "trainSampleFraction": float(train_sample_fraction),
            "trainSampleSeed": int(train_sample_seed),
            "labelSmoothing": float(label_smoothing) if label_smoothing is not None else None,
            "initNoiseStd": float(init_noise_std),
            "initNoiseSeed": int(init_noise_seed),
        })
    return candidates


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


def hash_file_short(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()[:12]


def total_memory_bytes() -> int:
    try:
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        page_count = int(os.sysconf("SC_PHYS_PAGES"))
        return page_size * page_count
    except (ValueError, OSError, AttributeError):
        return 0


def estimate_required_memory_bytes(dataset_path: str, active_candidates: int) -> int:
    dataset_bytes = os.path.getsize(dataset_path)
    dataset_overhead = int(dataset_bytes * 8.5)
    candidate_overhead = active_candidates * 256 * 1024 * 1024
    fixed_overhead = 2 * 1024 * 1024 * 1024
    return dataset_overhead + candidate_overhead + fixed_overhead


def guard_memory_budget(config: argparse.Namespace) -> None:
    total_bytes = total_memory_bytes()
    if total_bytes <= 0:
        return
    estimated_bytes = estimate_required_memory_bytes(config.dataset, int(config.multi_candidate_count))
    limit_bytes = int(total_bytes * float(config.memory_headroom_ratio))
    if estimated_bytes > limit_bytes:
        raise ValueError(
            "Estimated RAM requirement is too high for single-process mode: "
            f"need~{estimated_bytes / (1024 ** 3):.1f}GiB limit~{limit_bytes / (1024 ** 3):.1f}GiB. "
            "Reduce --multi-candidate-count or batch size."
        )


def split_dataset_indices(sample_count: int, ratio: float, split_seed: int) -> Tuple[List[int], List[int]]:
    indices = list(range(sample_count))
    rng = random.Random(split_seed)
    rng.shuffle(indices)
    if len(indices) <= 1:
        return indices, []
    val_count = max(1, min(len(indices) - 1, int(len(indices) * ratio)))
    train_count = len(indices) - val_count
    return indices[:train_count], indices[train_count:]


def select_candidate_train_indices(train_indices: List[int], fraction: float, seed: int) -> List[int]:
    if fraction >= 0.999999 or len(train_indices) <= 1:
        return list(train_indices)
    ordered = list(train_indices)
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


def build_epoch_batches(indices: List[int], batch_size: int, seed: int) -> List[List[int]]:
    ordered = list(indices)
    random.Random(seed).shuffle(ordered)
    size = max(1, int(batch_size))
    return [ordered[offset:offset + size] for offset in range(0, len(ordered), size)]


def evaluate_split_indices(
    model: Any,
    samples: List[Any],
    indices: List[int],
    device: Any,
    args: argparse.Namespace,
) -> Dict[str, float]:
    if not indices:
        return {
            "loss": 0.0,
            "valueLoss": 0.0,
            "policyLoss": 0.0,
            "auxLoss": 0.0,
            "policyEntropy": 0.0,
        }
    model.eval()
    with torch.no_grad():
        total_loss = 0.0
        total_value = 0.0
        total_policy = 0.0
        total_aux = 0.0
        total_entropy = 0.0
        batches = [indices[offset:offset + max(1, args.batch_size)] for offset in range(0, len(indices), max(1, args.batch_size))]
        for batch_ids in batches:
            batch = [samples[i] for i in batch_ids]
            loss, metrics = compute_batch_loss(model, batch, device, args)
            total_loss += float(loss.item())
            total_value += metrics["valueLoss"]
            total_policy += metrics["policyLoss"]
            total_aux += metrics["auxLoss"]
            total_entropy += metrics["policyEntropy"]
    count = max(1, math.ceil(len(indices) / max(1, args.batch_size)))
    return {
        "loss": total_loss / count,
        "valueLoss": total_value / count,
        "policyLoss": total_policy / count,
        "auxLoss": total_aux / count,
        "policyEntropy": total_entropy / count,
    }


@dataclass
class TensorizedDataset:
    state_tensor: Any
    value_target: Any
    queen_target: Any
    mobility_target: Any
    length_target: Any
    action_features: Any
    action_probs: Any
    action_mask: Any
    action_count: Any
    action_dim: int
    max_actions: int


def maybe_pin(tensor: Any, device: Any) -> Any:
    if device.type == "cuda":
        return tensor.pin_memory()
    return tensor


def tensorize_dataset(samples: List[Any], device: Any) -> TensorizedDataset:
    if not samples:
        raise ValueError("No samples available to tensorize")

    action_dim = len(samples[0].action_features[0]) if samples[0].action_features else 0
    max_actions = max(len(sample.action_features) for sample in samples)
    action_features_tensor = torch.zeros(
        (len(samples), max_actions, max(1, action_dim)),
        dtype=torch.float32,
    )
    action_probs_tensor = torch.zeros(
        (len(samples), max_actions),
        dtype=torch.float32,
    )
    action_mask_tensor = torch.zeros(
        (len(samples), max_actions),
        dtype=torch.bool,
    )
    action_count_tensor = torch.zeros(
        len(samples),
        dtype=torch.long,
    )

    for sample_index, sample in enumerate(samples):
        n_actions = len(sample.action_features)
        action_count_tensor[sample_index] = n_actions
        if n_actions <= 0:
            continue
        action_features_tensor[sample_index, :n_actions] = torch.tensor(
            sample.action_features,
            dtype=torch.float32,
        )
        action_probs_tensor[sample_index, :n_actions] = torch.tensor(
            sample.action_probs,
            dtype=torch.float32,
        )
        action_mask_tensor[sample_index, :n_actions] = True

    return TensorizedDataset(
        state_tensor=maybe_pin(
            torch.tensor([sample.state_features for sample in samples], dtype=torch.float32),
            device,
        ),
        value_target=maybe_pin(
            torch.tensor([sample.value_target for sample in samples], dtype=torch.float32),
            device,
        ),
        queen_target=maybe_pin(
            torch.tensor([sample.queen_delta for sample in samples], dtype=torch.float32),
            device,
        ),
        mobility_target=maybe_pin(
            torch.tensor([sample.mobility for sample in samples], dtype=torch.float32),
            device,
        ),
        length_target=maybe_pin(
            torch.tensor([sample.length_bucket for sample in samples], dtype=torch.long),
            device,
        ),
        action_features=maybe_pin(action_features_tensor, device),
        action_probs=maybe_pin(action_probs_tensor, device),
        action_mask=maybe_pin(action_mask_tensor, device),
        action_count=maybe_pin(action_count_tensor, device),
        action_dim=action_dim,
        max_actions=max_actions,
    )


def gather_parallel_rows(source_tensor: Any, batch_indices_by_candidate: List[List[int]], device: Any) -> Any:
    rows: List[Any] = []
    for batch_ids in batch_indices_by_candidate:
        index_tensor = torch.tensor(batch_ids, dtype=torch.long)
        rows.append(source_tensor.index_select(0, index_tensor))
    return torch.stack(rows, dim=0).to(device, non_blocking=(device.type == "cuda"))


def build_parallel_training_batch(dataset: TensorizedDataset, batch_indices_by_candidate: List[List[int]], device: Any) -> Dict[str, Any]:
    return {
        "state": gather_parallel_rows(dataset.state_tensor, batch_indices_by_candidate, device),
        "valueTarget": gather_parallel_rows(dataset.value_target, batch_indices_by_candidate, device),
        "queenTarget": gather_parallel_rows(dataset.queen_target, batch_indices_by_candidate, device),
        "mobilityTarget": gather_parallel_rows(dataset.mobility_target, batch_indices_by_candidate, device),
        "lengthTarget": gather_parallel_rows(dataset.length_target, batch_indices_by_candidate, device),
        "actionFeatures": gather_parallel_rows(dataset.action_features, batch_indices_by_candidate, device),
        "actionProbs": gather_parallel_rows(dataset.action_probs, batch_indices_by_candidate, device),
        "actionMask": gather_parallel_rows(dataset.action_mask, batch_indices_by_candidate, device),
    }


def build_parallel_eval_batch(dataset: TensorizedDataset, batch_ids: List[int], candidate_count: int, device: Any) -> Dict[str, Any]:
    index_tensor = torch.tensor(batch_ids, dtype=torch.long)
    state_tensor = dataset.state_tensor.index_select(0, index_tensor).to(device, non_blocking=(device.type == "cuda"))
    value_target = dataset.value_target.index_select(0, index_tensor).to(device, non_blocking=(device.type == "cuda"))
    queen_target = dataset.queen_target.index_select(0, index_tensor).to(device, non_blocking=(device.type == "cuda"))
    mobility_target = dataset.mobility_target.index_select(0, index_tensor).to(device, non_blocking=(device.type == "cuda"))
    length_target = dataset.length_target.index_select(0, index_tensor).to(device, non_blocking=(device.type == "cuda"))
    action_features = dataset.action_features.index_select(0, index_tensor).to(device, non_blocking=(device.type == "cuda"))
    action_probs = dataset.action_probs.index_select(0, index_tensor).to(device, non_blocking=(device.type == "cuda"))
    action_mask = dataset.action_mask.index_select(0, index_tensor).to(device, non_blocking=(device.type == "cuda"))

    return {
        "state": state_tensor.unsqueeze(0).expand(candidate_count, -1, -1),
        "valueTarget": value_target.unsqueeze(0).expand(candidate_count, -1),
        "queenTarget": queen_target.unsqueeze(0).expand(candidate_count, -1),
        "mobilityTarget": mobility_target.unsqueeze(0).expand(candidate_count, -1),
        "lengthTarget": length_target.unsqueeze(0).expand(candidate_count, -1),
        "actionFeatures": action_features.unsqueeze(0).expand(candidate_count, -1, -1, -1),
        "actionProbs": action_probs.unsqueeze(0).expand(candidate_count, -1, -1),
        "actionMask": action_mask.unsqueeze(0).expand(candidate_count, -1, -1),
    }


def compute_parallel_loss_metrics(
    value_pred: Any,
    queen_pred: Any,
    mobility_pred: Any,
    length_logits: Any,
    all_logits: Any,
    batch: Dict[str, Any],
    args: argparse.Namespace,
    label_smoothing_values: Optional[Any] = None,
) -> Tuple[Any, List[Dict[str, float]]]:
    value_loss = ((value_pred - batch["valueTarget"]) ** 2).mean(dim=1)
    queen_loss = ((queen_pred - batch["queenTarget"]) ** 2).mean(dim=1)
    mobility_loss = ((mobility_pred - batch["mobilityTarget"]) ** 2).mean(dim=1)
    length_loss = F.cross_entropy(
        length_logits.reshape(-1, length_logits.shape[-1]),
        batch["lengthTarget"].reshape(-1),
        reduction="none",
    ).reshape(batch["lengthTarget"].shape).mean(dim=1)

    padded_probs = batch["actionProbs"]
    action_mask = batch["actionMask"]
    if label_smoothing_values is not None:
        smoothing = label_smoothing_values.to(padded_probs.device).view(-1, 1, 1).clamp(min=0.0, max=0.5)
        n_legal = action_mask.sum(dim=2, keepdim=True).float().clamp(min=1)
        uniform = action_mask.float() / n_legal
        padded_probs = (1 - smoothing) * padded_probs + smoothing * uniform
    elif hasattr(args, "label_smoothing") and args.label_smoothing > 0:
        smoothing = float(args.label_smoothing)
        n_legal = action_mask.sum(dim=2, keepdim=True).float().clamp(min=1)
        uniform = action_mask.float() / n_legal
        padded_probs = (1 - smoothing) * padded_probs + smoothing * uniform

    masked_logits = all_logits.masked_fill(~action_mask, -1e9)
    log_probs = torch.log_softmax(masked_logits, dim=2)
    policy_loss = -(padded_probs * log_probs).sum(dim=2).mean(dim=1)

    with torch.no_grad():
        probs = torch.softmax(masked_logits, dim=2)
        entropies = -(probs * torch.log(torch.clamp(probs, min=1e-9))).sum(dim=2).mean(dim=1)

    aux_loss = (queen_loss + mobility_loss + length_loss) / 3.0
    total = (
        float(args.value_loss_weight) * value_loss
        + float(args.policy_loss_weight) * policy_loss
        + float(args.aux_loss_weight) * aux_loss
    )

    metrics: List[Dict[str, float]] = []
    for index in range(total.shape[0]):
        metrics.append(
            {
                "valueLoss": float(value_loss[index].detach().cpu().item()),
                "policyLoss": float(policy_loss[index].detach().cpu().item()),
                "auxLoss": float(aux_loss[index].detach().cpu().item()),
                "policyEntropy": float(entropies[index].detach().cpu().item()),
                "loss": float(total[index].detach().cpu().item()),
            }
        )
    return total, metrics


def runtime_optimizer_state_by_name(runtime: Any) -> Dict[str, Dict[str, Any]]:
    state_by_name: Dict[str, Dict[str, Any]] = {}
    for name, parameter in runtime.model.named_parameters():
        state = runtime.optimizer.state.get(parameter)
        if not state:
            continue
        entry: Dict[str, Any] = {}
        step_value = state.get("step")
        if step_value is not None:
            if torch.is_tensor(step_value):
                entry["step"] = int(step_value.detach().cpu().item())
            else:
                entry["step"] = int(step_value)
        for key in ("exp_avg", "exp_avg_sq"):
            value = state.get(key)
            if torch.is_tensor(value):
                entry[key] = value.detach().clone()
        if entry:
            state_by_name[name] = entry
    return state_by_name


class ParallelActiveGroup:
    def __init__(self, runtimes: List[Any]) -> None:
        if not runtimes:
            raise ValueError("ParallelActiveGroup requires at least one runtime")

        self.runtimes = list(runtimes)
        self.device = self.runtimes[0].device
        self.config = self.runtimes[0].config
        self.train_config = self.runtimes[0].train_config
        self.base_model = PolicyValueNet(
            len(self.runtimes[0].state_names),
            len(self.runtimes[0].action_names),
            self.runtimes[0].hidden,
        ).to(self.device)
        self.params, self.buffers = stack_module_state([runtime.model for runtime in self.runtimes])
        self.optimizer = build_adamw_optimizer(
            list(self.params.values()),
            float(self.config.lr),
            float(self.config.weight_decay),
            self.device,
        )
        self.label_smoothing_values = torch.tensor(
            [runtime.label_smoothing for runtime in self.runtimes],
            dtype=torch.float32,
            device=self.device,
        )
        self.use_mixed_precision = bool(getattr(self.config, "mixed_precision", False) and self.device.type == "cuda")
        self.grad_scaler = create_grad_scaler(self.device, self.use_mixed_precision)
        self._base_forward_impl = self._make_forward_impl()
        self._forward_impl = self._base_forward_impl
        self._compiled_forward_enabled = False
        if bool(getattr(self.config, "compile_forward", False)) and hasattr(torch, "compile"):
            try:
                self._forward_impl = torch.compile(self._base_forward_impl, mode="reduce-overhead", fullgraph=False)
                self._compiled_forward_enabled = True
                print("[multi] compiled stacked forward path enabled", flush=True)
            except Exception as error:
                print(f"[multi] compile_forward unavailable, falling back: {error}", flush=True)
        self._restore_optimizer_state()
        self._validate_alignment()

    def _make_forward_impl(self):
        def call_model(params: Dict[str, Any], buffers: Dict[str, Any], state_batch: Any, action_batch: Any) -> Tuple[Any, Any, Any, Any, Any]:
            return functional_call(self.base_model, (params, buffers), (state_batch, action_batch))

        return call_model

    def _validate_alignment(self) -> None:
        epochs = {runtime.epoch for runtime in self.runtimes}
        cursors = {runtime.batch_cursor for runtime in self.runtimes}
        batch_counts = {len(runtime.train_batches) for runtime in self.runtimes}
        if len(epochs) != 1 or len(cursors) != 1 or len(batch_counts) != 1:
            raise ValueError("Active runtimes are not aligned for parallel training")

    def _restore_optimizer_state(self) -> None:
        runtime_states = [runtime_optimizer_state_by_name(runtime) for runtime in self.runtimes]
        for name, stacked_param in self.params.items():
            if not all(name in runtime_state for runtime_state in runtime_states):
                continue

            step_value = runtime_states[0][name].get("step", 0)
            exp_avg = torch.stack(
                [runtime_state[name]["exp_avg"].to(self.device) for runtime_state in runtime_states],
                dim=0,
            )
            exp_avg_sq = torch.stack(
                [runtime_state[name]["exp_avg_sq"].to(self.device) for runtime_state in runtime_states],
                dim=0,
            )
            self.optimizer.state[stacked_param] = {
                "step": torch.tensor(float(step_value), dtype=torch.float32, device=self.device),
                "exp_avg": exp_avg,
                "exp_avg_sq": exp_avg_sq,
            }

    def forward_batch(self, state_tensor: Any, action_tensor: Any) -> Tuple[Any, Any, Any, Any, Any]:
        try:
            return vmap(self._forward_impl, in_dims=(0, 0, 0, 0))(self.params, self.buffers, state_tensor, action_tensor)
        except Exception as error:
            if not self._compiled_forward_enabled:
                raise
            print(f"[multi] compiled forward failed, falling back to eager path: {error}", flush=True)
            self._compiled_forward_enabled = False
            self._forward_impl = self._base_forward_impl
            return vmap(self._forward_impl, in_dims=(0, 0, 0, 0))(self.params, self.buffers, state_tensor, action_tensor)

    def train_step(self, dataset: TensorizedDataset) -> None:
        batch_indices_by_candidate = [
            runtime.train_batches[runtime.batch_cursor]
            for runtime in self.runtimes
        ]
        batch = build_parallel_training_batch(dataset, batch_indices_by_candidate, self.device)
        self.optimizer.zero_grad(set_to_none=True)
        with autocast_context(self.device, self.use_mixed_precision):
            outputs = self.forward_batch(batch["state"], batch["actionFeatures"])
            total, metrics = compute_parallel_loss_metrics(
                *outputs,
                batch,
                self.train_config,
                self.label_smoothing_values,
            )
            loss = total.sum()
        if self.grad_scaler and self.use_mixed_precision:
            self.grad_scaler.scale(loss).backward()
            self.grad_scaler.step(self.optimizer)
            self.grad_scaler.update()
        else:
            loss.backward()
            self.optimizer.step()

        for runtime, metric in zip(self.runtimes, metrics):
            runtime.epoch_loss += metric["loss"]
            runtime.epoch_value += metric["valueLoss"]
            runtime.epoch_policy += metric["policyLoss"]
            runtime.epoch_aux += metric["auxLoss"]
            runtime.epoch_entropy += metric["policyEntropy"]
            runtime.batch_cursor += 1

    def evaluate(self, dataset: TensorizedDataset, indices: List[int]) -> List[Dict[str, float]]:
        totals = [
            {"loss": 0.0, "valueLoss": 0.0, "policyLoss": 0.0, "auxLoss": 0.0, "policyEntropy": 0.0}
            for _ in self.runtimes
        ]
        batches = [indices[offset:offset + max(1, self.config.batch_size)] for offset in range(0, len(indices), max(1, self.config.batch_size))]
        if not batches:
            return totals

        with torch.no_grad():
            for batch_ids in batches:
                batch = build_parallel_eval_batch(dataset, batch_ids, len(self.runtimes), self.device)
                with autocast_context(self.device, self.use_mixed_precision):
                    outputs = self.forward_batch(batch["state"], batch["actionFeatures"])
                    _, metrics = compute_parallel_loss_metrics(
                        *outputs,
                        batch,
                        self.train_config,
                        self.label_smoothing_values,
                    )
                for total, metric in zip(totals, metrics):
                    total["loss"] += metric["loss"]
                    total["valueLoss"] += metric["valueLoss"]
                    total["policyLoss"] += metric["policyLoss"]
                    total["auxLoss"] += metric["auxLoss"]
                    total["policyEntropy"] += metric["policyEntropy"]

        count = max(1, len(batches))
        return [
            {
                "loss": total["loss"] / count,
                "valueLoss": total["valueLoss"] / count,
                "policyLoss": total["policyLoss"] / count,
                "auxLoss": total["auxLoss"] / count,
                "policyEntropy": total["policyEntropy"] / count,
            }
            for total in totals
        ]

    def sync_to_runtimes(self) -> None:
        runtime_param_maps = [dict(runtime.model.named_parameters()) for runtime in self.runtimes]

        with torch.no_grad():
            for name, stacked_param in self.params.items():
                detached = stacked_param.detach()
                for index, runtime in enumerate(self.runtimes):
                    runtime_param_maps[index][name].copy_(detached[index])

        for runtime in self.runtimes:
            runtime.optimizer.state.clear()

        for name, stacked_param in self.params.items():
            state = self.optimizer.state.get(stacked_param)
            if not state:
                continue
            step_value = state.get("step", 0)
            if torch.is_tensor(step_value):
                step_scalar = float(step_value.detach().cpu().item())
            else:
                step_scalar = float(step_value)

            exp_avg = state.get("exp_avg")
            exp_avg_sq = state.get("exp_avg_sq")
            if exp_avg is None or exp_avg_sq is None:
                continue

            for index, runtime in enumerate(self.runtimes):
                runtime_param = runtime_param_maps[index][name]
                runtime.optimizer.state[runtime_param] = {
                    "step": torch.tensor(step_scalar, dtype=torch.float32, device=runtime.device),
                    "exp_avg": exp_avg[index].detach().clone().to(runtime.device),
                    "exp_avg_sq": exp_avg_sq[index].detach().clone().to(runtime.device),
                }


class CandidateRuntime:
    def __init__(
        self,
        config: argparse.Namespace,
        train_config: argparse.Namespace,
        state_names: List[str],
        action_names: List[str],
        hidden: List[int],
        device: Any,
        train_indices: List[int],
        candidate: Dict[str, Any],
        dataset_hash: str,
        init_model_hash: Optional[str],
    ) -> None:
        self.index = int(candidate["index"])
        self.seed = int(candidate["seed"])
        self.train_sample_fraction = float(candidate.get("trainSampleFraction", 1.0))
        self.train_sample_seed = int(candidate.get("trainSampleSeed", self.seed + 17))
        self.label_smoothing = float(candidate.get("labelSmoothing", config.label_smoothing))
        self.init_noise_std = float(candidate.get("initNoiseStd", 0.0))
        self.init_noise_seed = int(candidate.get("initNoiseSeed", self.seed + 29))
        self.output_path = os.path.abspath(str(candidate["outputPath"]))
        self.checkpoint_path = os.path.abspath(str(candidate["checkpointPath"]))
        self.run_id = f"az-tournament-train-{self.index}-{int(time.time())}-{random.randint(1000, 9999)}"
        self.config = config
        self.train_config = train_config
        self.state_names = state_names
        self.action_names = action_names
        self.hidden = hidden
        self.device = device
        self.train_indices = select_candidate_train_indices(
            train_indices,
            self.train_sample_fraction,
            self.train_sample_seed,
        )
        self.dataset_hash = dataset_hash
        self.init_model_hash = init_model_hash
        self.model = PolicyValueNet(len(state_names), len(action_names), hidden).to(device)
        self.init_result = load_initial_model(self.model, config.init_model, state_names, action_names, hidden)
        apply_init_noise(self.model, self.init_noise_std, self.init_noise_seed)
        self.optimizer = build_adamw_optimizer(self.model.parameters(), config.lr, config.weight_decay, device)
        self.ema_state = {name: tensor.detach().cpu().clone() for name, tensor in self.model.state_dict().items()}
        self.started = time.time()
        self.epoch = 1
        self.batch_cursor = 0
        self.train_batches: List[List[int]] = build_epoch_batches(self.train_indices, config.batch_size, self.seed + 1000)
        self.epoch_loss = 0.0
        self.epoch_value = 0.0
        self.epoch_policy = 0.0
        self.epoch_aux = 0.0
        self.epoch_entropy = 0.0
        self.final_train_stats = {"loss": 0.0, "valueLoss": 0.0, "policyLoss": 0.0, "auxLoss": 0.0, "policyEntropy": 0.0}
        self.final_val_stats = {"loss": 0.0, "valueLoss": 0.0, "policyLoss": 0.0, "auxLoss": 0.0, "policyEntropy": 0.0}

        append_metrics(
            config.metrics_log,
            self.run_id,
            "run_start",
            {
                "source": "az",
                "mode": "tournament_single_process",
                "candidateIndex": self.index,
                "candidateSeed": self.seed,
                "batchId": config.batch_id,
                "dataset": os.path.abspath(config.dataset),
                "sampleCount": len(self.train_indices),
                "trainCount": len(self.train_indices),
                "valCount": None,
                "stateFeatureCount": len(state_names),
                "actionFeatureCount": len(action_names),
                "hidden": hidden,
                "epochs": int(config.epochs),
                "batchSize": int(config.batch_size),
                "learningRate": float(config.lr),
                "weightDecay": float(config.weight_decay),
                "device": device.type,
                "initModelPath": self.init_result["path"],
                "initModelHash": self.init_result["hash"],
                "initModelLoaded": bool(self.init_result["loaded"]),
                "initModelReason": self.init_result["reason"],
                "trainSampleFraction": self.train_sample_fraction,
                "trainSampleSeed": self.train_sample_seed,
                "candidateLabelSmoothing": self.label_smoothing,
                "candidateInitNoiseStd": self.init_noise_std,
            },
        )

    def current_batch_count(self) -> int:
        return max(1, len(self.train_batches))

    def reset_epoch_state(self) -> None:
        self.batch_cursor = 0
        self.train_batches = build_epoch_batches(
            self.train_indices,
            self.config.batch_size,
            self.seed + (self.epoch * 104729),
        )
        self.epoch_loss = 0.0
        self.epoch_value = 0.0
        self.epoch_policy = 0.0
        self.epoch_aux = 0.0
        self.epoch_entropy = 0.0

    def checkpoint_payload(self) -> Dict[str, Any]:
        return {
            "version": 1,
            "candidateIndex": self.index,
            "candidateSeed": self.seed,
            "runId": self.run_id,
            "datasetHash": self.dataset_hash,
            "initModelHash": self.init_model_hash,
            "config": {
                "hidden": list(self.hidden),
                "epochs": int(self.config.epochs),
                "batchSize": int(self.config.batch_size),
                "learningRate": float(self.config.lr),
                "weightDecay": float(self.config.weight_decay),
                "labelSmoothing": float(self.label_smoothing),
                "policyTargetTemperature": float(self.config.policy_target_temperature),
                "trainSampleFraction": float(self.train_sample_fraction),
                "trainSampleSeed": int(self.train_sample_seed),
                "initNoiseStd": float(self.init_noise_std),
                "initNoiseSeed": int(self.init_noise_seed),
            },
            "epoch": int(self.epoch),
            "batchCursor": int(self.batch_cursor),
            "started": float(self.started),
            "finalTrainStats": self.final_train_stats,
            "finalValStats": self.final_val_stats,
            "trainBatches": self.train_batches,
            "epochState": {
                "loss": float(self.epoch_loss),
                "valueLoss": float(self.epoch_value),
                "policyLoss": float(self.epoch_policy),
                "auxLoss": float(self.epoch_aux),
                "policyEntropy": float(self.epoch_entropy),
            },
            "modelState": {name: tensor.detach().cpu() for name, tensor in self.model.state_dict().items()},
            "optimizerState": self.optimizer.state_dict(),
            "emaState": self.ema_state,
        }


def save_candidate_checkpoint(runtime: CandidateRuntime) -> None:
    os.makedirs(os.path.dirname(runtime.checkpoint_path), exist_ok=True)
    temp_path = f"{runtime.checkpoint_path}.tmp"
    torch.save(runtime.checkpoint_payload(), temp_path)
    os.replace(temp_path, runtime.checkpoint_path)


def validate_checkpoint_payload(payload: Dict[str, Any], runtime: CandidateRuntime) -> None:
    if int(payload.get("candidateIndex", -1)) != runtime.index:
        raise ValueError("checkpoint candidate index mismatch")
    if int(payload.get("candidateSeed", -1)) != runtime.seed:
        raise ValueError("checkpoint candidate seed mismatch")
    if str(payload.get("datasetHash", "")) != runtime.dataset_hash:
        raise ValueError("checkpoint dataset hash mismatch")
    if str(payload.get("initModelHash", "")) != str(runtime.init_model_hash):
        raise ValueError("checkpoint init model hash mismatch")
    config_payload = payload.get("config")
    if not isinstance(config_payload, dict):
        raise ValueError("checkpoint config missing")
    if list(config_payload.get("hidden", [])) != list(runtime.hidden):
        raise ValueError("checkpoint hidden mismatch")
    if int(config_payload.get("epochs", -1)) != int(runtime.config.epochs):
        raise ValueError("checkpoint epochs mismatch")
    if int(config_payload.get("batchSize", -1)) != int(runtime.config.batch_size):
        raise ValueError("checkpoint batch size mismatch")
    if float(config_payload.get("learningRate", -1.0)) != float(runtime.config.lr):
        raise ValueError("checkpoint learning rate mismatch")
    if float(config_payload.get("weightDecay", -1.0)) != float(runtime.config.weight_decay):
        raise ValueError("checkpoint weight decay mismatch")
    if float(config_payload.get("labelSmoothing", -1.0)) != float(runtime.label_smoothing):
        raise ValueError("checkpoint label smoothing mismatch")
    if float(config_payload.get("trainSampleFraction", -1.0)) != float(runtime.train_sample_fraction):
        raise ValueError("checkpoint train sample fraction mismatch")
    if int(config_payload.get("trainSampleSeed", -1)) != int(runtime.train_sample_seed):
        raise ValueError("checkpoint train sample seed mismatch")
    if float(config_payload.get("initNoiseStd", -1.0)) != float(runtime.init_noise_std):
        raise ValueError("checkpoint init noise std mismatch")
    if int(config_payload.get("initNoiseSeed", -1)) != int(runtime.init_noise_seed):
        raise ValueError("checkpoint init noise seed mismatch")


def restore_candidate_checkpoint(runtime: CandidateRuntime) -> bool:
    if not runtime.checkpoint_path or not os.path.exists(runtime.checkpoint_path):
        return False
    payload = torch.load(runtime.checkpoint_path, map_location=runtime.device)
    if not isinstance(payload, dict):
        raise ValueError(f"Checkpoint payload invalid for candidate {runtime.index}")
    validate_checkpoint_payload(payload, runtime)
    runtime.run_id = str(payload.get("runId") or runtime.run_id)
    runtime.epoch = int(payload.get("epoch", 1))
    runtime.batch_cursor = int(payload.get("batchCursor", 0))
    runtime.started = float(payload.get("started", runtime.started))
    train_batches = payload.get("trainBatches")
    runtime.train_batches = train_batches if isinstance(train_batches, list) else runtime.train_batches
    epoch_state = payload.get("epochState")
    if isinstance(epoch_state, dict):
        runtime.epoch_loss = float(epoch_state.get("loss", 0.0))
        runtime.epoch_value = float(epoch_state.get("valueLoss", 0.0))
        runtime.epoch_policy = float(epoch_state.get("policyLoss", 0.0))
        runtime.epoch_aux = float(epoch_state.get("auxLoss", 0.0))
        runtime.epoch_entropy = float(epoch_state.get("policyEntropy", 0.0))
    final_train = payload.get("finalTrainStats")
    final_val = payload.get("finalValStats")
    if isinstance(final_train, dict):
        runtime.final_train_stats = {key: float(final_train.get(key, 0.0)) for key in runtime.final_train_stats.keys()}
    if isinstance(final_val, dict):
        runtime.final_val_stats = {key: float(final_val.get(key, 0.0)) for key in runtime.final_val_stats.keys()}
    model_state = payload.get("modelState")
    optimizer_state = payload.get("optimizerState")
    ema_state = payload.get("emaState")
    if not isinstance(model_state, dict) or optimizer_state is None or not isinstance(ema_state, dict):
        raise ValueError(f"Checkpoint state missing for candidate {runtime.index}")
    runtime.model.load_state_dict(model_state)
    runtime.optimizer.load_state_dict(optimizer_state)
    for state in runtime.optimizer.state.values():
        if isinstance(state, dict):
            for key, value in state.items():
                if torch.is_tensor(value):
                    state[key] = value.to(runtime.device)
    runtime.ema_state = {str(name): tensor.detach().cpu().clone() for name, tensor in ema_state.items()}
    return True


def export_candidate(runtime: CandidateRuntime, train_count: int, val_count: int) -> Tuple[str, float]:
    runtime.model.load_state_dict({name: tensor.to(runtime.device) for name, tensor in runtime.ema_state.items()})
    training_meta = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "games": train_count + val_count,
        "positionSamples": train_count + val_count,
        "epochs": int(runtime.config.epochs),
        "difficulty": "mixed",
        "framework": "pytorch-tournament-single-process",
        "device": runtime.device.type,
        "batchSize": int(runtime.config.batch_size),
        "learningRate": float(runtime.config.lr),
        "hiddenLayers": runtime.hidden,
        "policyLossWeight": float(runtime.config.policy_loss_weight),
        "valueLossWeight": float(runtime.config.value_loss_weight),
        "auxLossWeight": float(runtime.config.aux_loss_weight),
        "initializedFrom": runtime.init_result["path"],
        "initializedFromHash": runtime.init_result["hash"],
        "initializedFromLoaded": bool(runtime.init_result["loaded"]),
        "initializedFromReason": runtime.init_result["reason"],
        "candidateSeed": runtime.seed,
        "candidateIndex": runtime.index,
        "splitSeed": int(runtime.config.split_seed),
        "validationRatio": float(runtime.config.validation_ratio),
        "batchId": runtime.config.batch_id,
        "trainSampleFraction": runtime.train_sample_fraction,
        "trainSampleSeed": runtime.train_sample_seed,
        "labelSmoothing": runtime.label_smoothing,
        "initNoiseStd": runtime.init_noise_std,
    }
    export_model(runtime.output_path, runtime.model, runtime.state_names, runtime.action_names, runtime.hidden, training_meta)
    with open(runtime.output_path, "r", encoding="utf-8") as handle:
        raw_model = handle.read()
    return compute_short_hash(raw_model), time.time() - runtime.started


def append_progress(path: str, payload: Dict[str, Any]) -> None:
    append_jsonl(path, payload)


def maybe_log_tournament_event(config: argparse.Namespace, event_type: str, payload: Dict[str, Any]) -> None:
    if not config.tournament_run_id:
        return
    append_metrics(config.metrics_log, config.tournament_run_id, event_type, payload)


def autocast_context(device: Any, enabled: bool):
    if enabled and device.type == "cuda":
        return torch.autocast(device_type="cuda", dtype=torch.float16)
    return contextlib.nullcontext()


def main() -> None:
    args = parse_args()
    hidden = parse_hidden(args.hidden)
    device = resolve_device(args.device)
    enable_cuda_fast_math(device)
    if args.mixed_precision is None:
        args.mixed_precision = device.type == "cuda"
    if device.type == "cuda":
        try:
            torch.set_float32_matmul_precision("high")
        except Exception:
            pass
        if hasattr(torch.backends, "cuda") and hasattr(torch.backends.cuda, "matmul"):
            torch.backends.cuda.matmul.allow_tf32 = True
        if hasattr(torch.backends, "cudnn"):
            torch.backends.cudnn.allow_tf32 = True
    train_config = build_train_args(args)
    guard_memory_budget(args)

    candidates = load_candidate_specs(args.candidate_spec)
    if len(candidates) == 0:
        raise ValueError("Candidate spec is empty")

    dataset_hash = hash_file_short(args.dataset)
    init_model_hash = hash_file_short(args.init_model) if args.init_model and os.path.exists(args.init_model) else None
    state_names, action_names, samples, _ = read_dataset(args.dataset, args.policy_target_temperature)
    if len(samples) == 0:
        raise ValueError("Dataset is empty; generate more self-play samples")
    train_indices, val_indices = split_dataset_indices(len(samples), args.validation_ratio, args.split_seed)
    tensorized_dataset = tensorize_dataset(samples, device)
    average_actions = float(tensorized_dataset.action_count.float().mean().item())
    mean_candidate_train_fraction = sum(float(candidate.get("trainSampleFraction", 1.0)) for candidate in candidates) / max(1, len(candidates))

    print(
        f"[multi] loaded samples={len(samples)} train={len(train_indices)} val={len(val_indices)} "
        f"candidates={len(candidates)} active={args.multi_candidate_count} device={device.type} "
        f"max_actions={tensorized_dataset.max_actions} mean_actions={average_actions:.1f} "
        f"candidate_train_fraction={mean_candidate_train_fraction:.3f} "
        f"mixed_precision={'on' if args.mixed_precision else 'off'} "
        f"compile_forward={'on' if args.compile_forward else 'off'} "
        f"target_gpu={args.target_gpu_utilization if args.target_gpu_utilization is not None else 'n/a'}",
        flush=True,
    )
    maybe_log_tournament_event(
        args,
        "tournament_trainer_backend_start",
        {
            "backend": "single-process",
            "candidateCount": len(candidates),
            "activeCandidateCount": int(args.multi_candidate_count),
            "sampleCount": len(samples),
            "trainCount": len(train_indices),
            "valCount": len(val_indices),
            "batchSize": int(args.batch_size),
            "hidden": hidden,
            "device": device.type,
            "candidateTrainFraction": mean_candidate_train_fraction,
        },
    )

    pending = list(candidates)
    active: Dict[int, CandidateRuntime] = {}
    active_group: Optional[ParallelActiveGroup] = None
    completed = 0
    last_epoch_banner: Tuple[int, Tuple[int, ...]] | None = None

    def activate_candidates() -> None:
        nonlocal pending
        while pending and len(active) < max(1, int(args.multi_candidate_count)):
            candidate = pending.pop(0)
            runtime = CandidateRuntime(
                args,
                train_config,
                state_names,
                action_names,
                hidden,
                device,
                train_indices,
                candidate,
                dataset_hash,
                init_model_hash,
            )
            restored = restore_candidate_checkpoint(runtime)
            active[runtime.index] = runtime
            print(
                f"[multi] slot candidate={runtime.index} seed={runtime.seed} "
                f"epoch={runtime.epoch}/{args.epochs} restored={'yes' if restored else 'no'} "
                f"frac={runtime.train_sample_fraction:.3f} ls={runtime.label_smoothing:.4f} noise={runtime.init_noise_std:.4f}",
                flush=True,
            )
            append_progress(
                args.progress_jsonl,
                {
                    "event": "slot_assigned",
                    "index": runtime.index,
                    "seed": runtime.seed,
                    "checkpointPath": runtime.checkpoint_path,
                    "restored": restored,
                    "epoch": runtime.epoch,
                    "batchCursor": runtime.batch_cursor,
                    "runId": runtime.run_id,
                    "trainSampleFraction": runtime.train_sample_fraction,
                    "labelSmoothing": runtime.label_smoothing,
                    "initNoiseStd": runtime.init_noise_std,
                },
            )
            maybe_log_tournament_event(
                args,
                "tournament_candidate_slot_assigned",
                {
                    "backend": "single-process",
                    "candidateIndex": runtime.index,
                    "seed": runtime.seed,
                    "checkpointPath": runtime.checkpoint_path,
                    "restored": restored,
                    "epoch": runtime.epoch,
                    "batchCursor": runtime.batch_cursor,
                    "trainSampleFraction": runtime.train_sample_fraction,
                    "labelSmoothing": runtime.label_smoothing,
                    "initNoiseStd": runtime.init_noise_std,
                },
            )
            if restored:
                maybe_log_tournament_event(
                    args,
                    "tournament_candidate_resume_loaded",
                    {
                        "backend": "single-process",
                        "candidateIndex": runtime.index,
                        "seed": runtime.seed,
                        "checkpointPath": runtime.checkpoint_path,
                        "epoch": runtime.epoch,
                        "batchCursor": runtime.batch_cursor,
                    },
                )

    activate_candidates()
    if active:
        active_group = ParallelActiveGroup([active[index] for index in sorted(active.keys())])

    while active:
        if active_group is None:
            active_group = ParallelActiveGroup([active[index] for index in sorted(active.keys())])

        active_runtimes = active_group.runtimes
        first_runtime = active_runtimes[0]
        epoch_banner = (int(first_runtime.epoch), tuple(sorted(active.keys())))
        if last_epoch_banner != epoch_banner and first_runtime.epoch <= args.epochs:
            train_batches = len(first_runtime.train_batches)
            val_batches = max(1, math.ceil(len(val_indices) / max(1, args.batch_size))) if val_indices else 0
            print(
                f"[multi] epoch-start epoch {first_runtime.epoch}/{args.epochs} "
                f"active={len(active_runtimes)} train_batches={train_batches} val_batches={val_batches}",
                flush=True,
            )
            last_epoch_banner = epoch_banner

        if first_runtime.epoch > args.epochs:
            active_group.sync_to_runtimes()
            completed_indexes: List[int] = []
            for runtime in active_runtimes:
                model_hash, elapsed_seconds = export_candidate(runtime, len(train_indices), len(val_indices))
                append_metrics(
                    args.metrics_log,
                    runtime.run_id,
                    "run_end",
                    {
                        "source": "az",
                        "mode": "tournament_single_process",
                        "candidateIndex": runtime.index,
                        "candidateSeed": runtime.seed,
                        "batchId": args.batch_id,
                        "status": "completed",
                        "outputPath": runtime.output_path,
                        "epochs": int(args.epochs),
                        "sampleCount": len(runtime.train_indices) + len(val_indices),
                        "trainCount": len(runtime.train_indices),
                        "valCount": len(val_indices),
                        "trainLoss": runtime.final_train_stats["loss"],
                        "valLoss": runtime.final_val_stats["loss"],
                        "modelHash": model_hash,
                        "elapsedSeconds": round(elapsed_seconds, 3),
                        "trainSampleFraction": runtime.train_sample_fraction,
                        "trainSampleSeed": runtime.train_sample_seed,
                        "labelSmoothing": runtime.label_smoothing,
                        "initNoiseStd": runtime.init_noise_std,
                        "initNoiseSeed": runtime.init_noise_seed,
                    },
                )
                append_jsonl(
                    args.results_jsonl,
                    {
                        "index": runtime.index,
                        "seed": runtime.seed,
                        "status": "completed",
                        "runId": runtime.run_id,
                        "outputPath": runtime.output_path,
                        "modelHash": model_hash,
                        "sampleCount": len(runtime.train_indices) + len(val_indices),
                        "trainCount": len(runtime.train_indices),
                        "valCount": len(val_indices),
                        "trainLoss": runtime.final_train_stats["loss"],
                        "valLoss": runtime.final_val_stats["loss"],
                        "elapsedSeconds": round(elapsed_seconds, 3),
                        "checkpointPath": runtime.checkpoint_path,
                        "trainSampleFraction": runtime.train_sample_fraction,
                        "trainSampleSeed": runtime.train_sample_seed,
                        "labelSmoothing": runtime.label_smoothing,
                        "initNoiseStd": runtime.init_noise_std,
                        "initNoiseSeed": runtime.init_noise_seed,
                    },
                )
                if runtime.checkpoint_path and os.path.exists(runtime.checkpoint_path):
                    os.remove(runtime.checkpoint_path)
                completed += 1
                print(
                    f"[multi] completed {completed}/{len(candidates)} candidate={runtime.index} "
                    f"train_loss={runtime.final_train_stats['loss']:.4f} val_loss={runtime.final_val_stats['loss']:.4f}",
                    flush=True,
                )
                completed_indexes.append(runtime.index)

            for candidate_index in completed_indexes:
                active.pop(candidate_index, None)
            activate_candidates()
            active_group = ParallelActiveGroup([active[index] for index in sorted(active.keys())]) if active else None
            continue

        if first_runtime.batch_cursor >= len(first_runtime.train_batches):
            val_stats = active_group.evaluate(tensorized_dataset, val_indices)
            active_group.sync_to_runtimes()
            for runtime, runtime_val_stats in zip(active_runtimes, val_stats):
                update_ema(runtime.ema_state, runtime.model.state_dict(), args.ema_decay)
                batch_count = runtime.current_batch_count()
                runtime.final_train_stats = {
                    "loss": runtime.epoch_loss / batch_count,
                    "valueLoss": runtime.epoch_value / batch_count,
                    "policyLoss": runtime.epoch_policy / batch_count,
                    "auxLoss": runtime.epoch_aux / batch_count,
                    "policyEntropy": runtime.epoch_entropy / batch_count,
                }
                runtime.final_val_stats = runtime_val_stats
                elapsed = time.time() - runtime.started
                eta = 0 if runtime.epoch == args.epochs else (elapsed / runtime.epoch) * (args.epochs - runtime.epoch)
                print(
                    f"[multi] candidate={runtime.index} epoch {runtime.epoch}/{args.epochs} "
                    f"train_loss={runtime.final_train_stats['loss']:.4f} val_loss={runtime.final_val_stats['loss']:.4f} "
                    f"val_policy={runtime.final_val_stats['policyLoss']:.4f} elapsed={int(elapsed)}s eta={int(eta)}s",
                    flush=True,
                )
                append_metrics(
                    args.metrics_log,
                    runtime.run_id,
                    "epoch",
                    {
                        "source": "az",
                        "mode": "tournament_single_process",
                        "candidateIndex": runtime.index,
                        "candidateSeed": runtime.seed,
                        "batchId": args.batch_id,
                        "epoch": int(runtime.epoch),
                        "totalEpochs": int(args.epochs),
                        "trainLoss": runtime.final_train_stats["loss"],
                        "trainValueLoss": runtime.final_train_stats["valueLoss"],
                        "trainPolicyLoss": runtime.final_train_stats["policyLoss"],
                        "trainAuxLoss": runtime.final_train_stats["auxLoss"],
                        "trainPolicyEntropy": runtime.final_train_stats["policyEntropy"],
                        "valLoss": runtime.final_val_stats["loss"],
                        "valValueLoss": runtime.final_val_stats["valueLoss"],
                        "valPolicyLoss": runtime.final_val_stats["policyLoss"],
                        "valAuxLoss": runtime.final_val_stats["auxLoss"],
                        "valPolicyEntropy": runtime.final_val_stats["policyEntropy"],
                    },
                )
                maybe_log_tournament_event(
                    args,
                    "tournament_candidate_epoch_end",
                    {
                        "backend": "single-process",
                        "candidateIndex": runtime.index,
                        "seed": runtime.seed,
                        "epoch": int(runtime.epoch),
                        "totalEpochs": int(args.epochs),
                        "trainLoss": runtime.final_train_stats["loss"],
                        "valLoss": runtime.final_val_stats["loss"],
                    },
                )
                if args.checkpoint_every_epoch:
                    save_candidate_checkpoint(runtime)
                    append_progress(
                        args.progress_jsonl,
                        {
                            "event": "checkpoint",
                            "index": runtime.index,
                            "seed": runtime.seed,
                            "checkpointPath": runtime.checkpoint_path,
                            "epoch": runtime.epoch,
                            "batchCursor": runtime.batch_cursor,
                            "trainLoss": runtime.final_train_stats["loss"],
                            "valLoss": runtime.final_val_stats["loss"],
                            "trainSampleFraction": runtime.train_sample_fraction,
                            "labelSmoothing": runtime.label_smoothing,
                            "initNoiseStd": runtime.init_noise_std,
                        },
                    )
                    maybe_log_tournament_event(
                        args,
                        "tournament_candidate_checkpoint_saved",
                        {
                            "backend": "single-process",
                            "candidateIndex": runtime.index,
                            "seed": runtime.seed,
                            "checkpointPath": runtime.checkpoint_path,
                            "epoch": runtime.epoch,
                            "trainSampleFraction": runtime.train_sample_fraction,
                            "labelSmoothing": runtime.label_smoothing,
                            "initNoiseStd": runtime.init_noise_std,
                        },
                    )
                runtime.epoch += 1
                runtime.reset_epoch_state()
            continue

        active_group.train_step(tensorized_dataset)
        cursor = first_runtime.batch_cursor
        batch_count = len(first_runtime.train_batches)
        progress_interval = max(1, batch_count // 4)
        if cursor == 1 or cursor == batch_count or cursor % progress_interval == 0:
            percent = int(round((cursor / max(1, batch_count)) * 100))
            print(
                f"[multi] epoch-progress epoch {first_runtime.epoch}/{args.epochs} "
                f"batch {cursor}/{batch_count} active={len(active_runtimes)} {percent}%",
                flush=True,
            )

    maybe_log_tournament_event(
        args,
        "tournament_trainer_backend_end",
        {
            "backend": "single-process",
            "completedCandidates": completed,
            "candidateCount": len(candidates),
        },
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"[multi:error] {error}", file=sys.stderr, flush=True)
        traceback.print_exc()
        sys.exit(1)
