#!/usr/bin/env python3
import hashlib
import importlib.util
import json
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
SampleRecord = TRAIN.SampleRecord
PolicyValueNet = TRAIN.PolicyValueNet
append_metrics = TRAIN.append_metrics
batch_indices = TRAIN.batch_indices
autocast_context = TRAIN.autocast_context
build_adamw_optimizer = TRAIN.build_adamw_optimizer
clamp = getattr(TRAIN, "clamp", None)
compute_batch_loss = TRAIN.compute_batch_loss
create_grad_scaler = TRAIN.create_grad_scaler
enable_cuda_fast_math = TRAIN.enable_cuda_fast_math
evaluate_split = TRAIN.evaluate_split
export_model = TRAIN.export_model
load_initial_model = TRAIN.load_initial_model
parse_hidden = TRAIN.parse_hidden
resolve_device = TRAIN.resolve_device
set_seed = TRAIN.set_seed
update_ema = TRAIN.update_ema
torch = TRAIN.torch
use_mixed_precision = TRAIN.use_mixed_precision


DEFAULT_VALIDATION_RATIO = 0.1
DEFAULT_POLICY_TARGET_TEMPERATURE = 0.12


@dataclass
class ManagedSample:
    record: Any
    sample_origin: str
    is_validation: bool


def protocol_response(request_id: Any, ok: bool, payload: Optional[Dict[str, Any]] = None, error: Optional[str] = None) -> None:
    message: Dict[str, Any] = {
        "id": request_id,
        "ok": ok,
    }
    if payload is not None:
        message["payload"] = payload
    if error is not None:
        message["error"] = error
    sys.stdout.write(json.dumps(message))
    sys.stdout.write("\n")
    sys.stdout.flush()


def emit_log(message: str) -> None:
    clock = time.strftime("%H:%M:%S", time.localtime())
    print(f"[{clock}] {message}", file=sys.stderr, flush=True)


def format_progress_bar(done: int, total: int, width: int = 12) -> str:
    total = max(1, total)
    ratio = max(0.0, min(1.0, float(done) / float(total)))
    filled = int(round(ratio * width))
    return f"[{'#' * filled}{'-' * max(0, width - filled)}]{int(round(ratio * 100))}%"


def validation_flag(seed: int, serial: int, ratio: float) -> bool:
    digest = hashlib.sha256(f"{seed}:{serial}".encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big") / float(2**64)
    return value < ratio


def sample_origin(raw: Dict[str, Any]) -> str:
    return "champion" if raw.get("sampleOrigin") == "champion" else "learner"


def normalize_policy_targets(policy_targets: List[Dict[str, Any]], target_temperature: float) -> Tuple[List[List[float]], List[float]]:
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
        action_weights.append(max(1e-6, base_weight) ** (1.0 / temperature))

    if not action_features:
        return [], []

    weight_sum = sum(max(0.0, weight) for weight in action_weights)
    if weight_sum <= 0:
        action_probs = [1.0 / len(action_weights) for _ in action_weights]
    else:
        action_probs = [max(0.0, weight) / weight_sum for weight in action_weights]
    return action_features, action_probs


def parse_single_sample(raw: Dict[str, Any], target_temperature: float) -> ManagedSample:
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
        raise ValueError("Invalid replay sample payload")

    action_features, action_probs = normalize_policy_targets(policy_targets, target_temperature)
    if not action_features:
        raise ValueError("Replay sample missing action features")

    length_bucket = int(aux_targets.get("lengthBucket", 1))
    if length_bucket < 0 or length_bucket > 2:
        length_bucket = 1

    record = SampleRecord(
        state_features=[float(v) for v in state_features],
        value_target=float(value_target),
        queen_delta=float(aux_targets.get("queenSurroundDelta", 0.0)),
        mobility=float(aux_targets.get("mobility", 0.0)),
        length_bucket=length_bucket,
        action_features=action_features,
        action_probs=action_probs,
    )
    return ManagedSample(record=record, sample_origin=sample_origin(raw), is_validation=False)


def parse_replay_payload(
    payload: Dict[str, Any],
    seed: int,
    validation_ratio: float,
    target_temperature: float,
) -> Tuple[List[str], List[str], List[ManagedSample]]:
    state_names = payload.get("stateFeatureNames")
    action_names = payload.get("actionFeatureNames")
    samples_raw = payload.get("samples")
    if not isinstance(state_names, list) or not isinstance(action_names, list) or not isinstance(samples_raw, list):
        raise ValueError("Replay payload missing required arrays")

    samples: List[ManagedSample] = []
    for index, raw in enumerate(samples_raw):
        if not isinstance(raw, dict):
            continue
        parsed = parse_single_sample(raw, target_temperature)
        parsed.is_validation = validation_flag(seed, index, validation_ratio)
        samples.append(parsed)

    return [str(v) for v in state_names], [str(v) for v in action_names], samples


def parse_replay_shards(
    manifest_path: str,
    payload: Dict[str, Any],
    seed: int,
    validation_ratio: float,
    target_temperature: float,
) -> Tuple[List[str], List[str], List[ManagedSample]]:
    state_names = payload.get("stateFeatureNames")
    action_names = payload.get("actionFeatureNames")
    shards = payload.get("shards")
    if not isinstance(state_names, list) or not isinstance(action_names, list) or not isinstance(shards, list):
        raise ValueError("Sharded replay payload missing required fields")

    shard_dir = f"{manifest_path}.chunks"
    samples: List[ManagedSample] = []
    sample_index = 0
    for shard in shards:
        if not isinstance(shard, dict):
            continue
        file_name = shard.get("fileName")
        if not isinstance(file_name, str):
            continue
        shard_path = os.path.join(shard_dir, file_name)
        with open(shard_path, "r", encoding="utf-8") as handle:
            shard_payload = json.load(handle)
        if isinstance(shard_payload, dict):
            shard_samples = shard_payload.get("samples")
        else:
            shard_samples = shard_payload
        if not isinstance(shard_samples, list):
            raise ValueError(f"Replay shard must contain a samples array: {shard_path}")
        for raw in shard_samples:
            if not isinstance(raw, dict):
                continue
            parsed = parse_single_sample(raw, target_temperature)
            parsed.is_validation = validation_flag(seed, sample_index, validation_ratio)
            samples.append(parsed)
            sample_index += 1

    return [str(v) for v in state_names], [str(v) for v in action_names], samples


def read_replay_file(
    absolute_path: str,
    seed: int,
    validation_ratio: float,
    target_temperature: float,
) -> Tuple[List[str], List[str], List[ManagedSample]]:
    with open(absolute_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Replay file root must be an object")
    if isinstance(payload.get("shards"), list) and "samples" not in payload:
        return parse_replay_shards(absolute_path, payload, seed, validation_ratio, target_temperature)
    return parse_replay_payload(payload, seed, validation_ratio, target_temperature)


def trim_samples(samples: List[ManagedSample], max_samples: int, replay_anchor_ratio: float) -> List[ManagedSample]:
    if len(samples) <= max_samples:
        return samples

    anchor_ratio = max(0.0, min(0.8, replay_anchor_ratio))
    if anchor_ratio <= 0:
        return samples[max(0, len(samples) - max_samples):]

    indexed = list(enumerate(samples))
    champion_indexed = [entry for entry in indexed if entry[1].sample_origin == "champion"]
    learner_indexed = [entry for entry in indexed if entry[1].sample_origin != "champion"]

    champion_target = min(len(champion_indexed), round(max_samples * anchor_ratio))
    learner_target = min(len(learner_indexed), max_samples - champion_target)

    chosen = champion_indexed[-champion_target:] + learner_indexed[-learner_target:]
    if len(chosen) < max_samples:
        chosen_indices = {entry[0] for entry in chosen}
        needed = max_samples - len(chosen)
        backfill = [entry for entry in indexed if entry[0] not in chosen_indices][-needed:]
        chosen.extend(backfill)

    chosen.sort(key=lambda entry: entry[0])
    return [entry[1] for entry in chosen[-max_samples:]]


def count_origins(samples: List[ManagedSample]) -> Dict[str, int]:
    learner = 0
    champion = 0
    validation = 0
    for sample in samples:
        if sample.sample_origin == "champion":
            champion += 1
        else:
            learner += 1
        if sample.is_validation:
            validation += 1
    return {
        "learner": learner,
        "champion": champion,
        "validation": validation,
    }


def clone_state_dict_cpu(model: Any) -> Dict[str, Any]:
    return {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}


class TrainerServer:
    def __init__(self) -> None:
        self.state_names: List[str] = []
        self.action_names: List[str] = []
        self.hidden: List[int] = []
        self.device = None
        self.model = None
        self.optimizer = None
        self.ema_state: Dict[str, Any] = {}
        self.metrics_log_path: str = TRAIN.DEFAULT_METRICS_LOG_PATH
        self.learning_rate = 0.0015
        self.weight_decay = 0.0001
        self.seed = 42
        self.validation_ratio = DEFAULT_VALIDATION_RATIO
        self.samples: List[ManagedSample] = []
        self.init_result: Dict[str, Any] = {
            "loaded": False,
            "path": None,
            "hash": None,
            "reason": "not_initialized",
        }
        self.mixed_precision = False
        self.grad_scaler = None

    def ensure_initialized(self) -> None:
        if self.model is None or self.optimizer is None or self.device is None:
            raise RuntimeError("Trainer has not been initialized")

    def rebuild_optimizer(self, learning_rate: float, weight_decay: float) -> None:
        if self.model is None:
            raise RuntimeError("Trainer model has not been initialized")
        self.learning_rate = learning_rate
        self.weight_decay = weight_decay
        self.optimizer = build_adamw_optimizer(
            self.model.parameters(),
            self.learning_rate,
            self.weight_decay,
            self.device,
        )
        self.grad_scaler = create_grad_scaler(self.device, self.mixed_precision)

    def configure_optimizer(self, learning_rate: float, weight_decay: float) -> None:
        self.ensure_initialized()
        if self.optimizer is None:
            self.rebuild_optimizer(learning_rate, weight_decay)
            return
        self.learning_rate = learning_rate
        self.weight_decay = weight_decay
        for group in self.optimizer.param_groups:
            group["lr"] = learning_rate
            group["weight_decay"] = weight_decay

    def init_from_replay_file(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        replay_path = os.path.abspath(str(payload["replayPath"]))
        self.metrics_log_path = os.path.abspath(str(payload.get("metricsLogPath", TRAIN.DEFAULT_METRICS_LOG_PATH)))
        self.learning_rate = float(payload.get("learningRate", self.learning_rate))
        self.weight_decay = float(payload.get("weightDecay", self.weight_decay))
        self.seed = int(payload.get("seed", self.seed))
        self.validation_ratio = float(payload.get("validationRatio", DEFAULT_VALIDATION_RATIO))
        self.policy_target_temperature = float(payload.get("policyTargetTemperature", DEFAULT_POLICY_TARGET_TEMPERATURE))
        self.hidden = parse_hidden(str(payload["hidden"]))
        self.device = resolve_device(str(payload.get("device", "auto")))
        enable_cuda_fast_math(self.device)
        set_seed(self.seed)
        self.mixed_precision = use_mixed_precision(type("InitArgs", (), {"mixed_precision": payload.get("mixedPrecision", None)})(), self.device)

        state_names, action_names, samples = read_replay_file(
            replay_path,
            self.seed,
            self.validation_ratio,
            self.policy_target_temperature,
        )
        self.state_names = state_names
        self.action_names = action_names
        self.samples = samples

        self.model = PolicyValueNet(len(self.state_names), len(self.action_names), self.hidden).to(self.device)
        init_model_path = str(payload.get("initModelPath", ""))
        self.init_result = load_initial_model(
            self.model,
            init_model_path,
            self.state_names,
            self.action_names,
            self.hidden,
        )
        self.rebuild_optimizer(self.learning_rate, self.weight_decay)
        self.ema_state = clone_state_dict_cpu(self.model)

        counts = count_origins(self.samples)
        emit_log(
            f"[az:setup] resident samples={len(self.samples)} "
            f"train={len(self.train_samples())} val={len(self.val_samples())} "
            f"state_dim={len(self.state_names)} action_dim={len(self.action_names)} hidden={self.hidden} device={self.device.type} mixed_precision={'on' if self.mixed_precision else 'off'}"
        )
        if self.init_result["loaded"]:
            emit_log(
                f"[az:init] warm-started from {self.init_result['path']} hash={self.init_result['hash']}"
            )
        elif self.init_result["path"]:
            emit_log(
                f"[az:init] using fresh weights ({self.init_result['reason']}) from {self.init_result['path']}"
            )
        else:
            emit_log("[az:init] using fresh weights (no init model provided)")

        return {
            "replayPath": replay_path,
            "sampleCount": len(self.samples),
            "trainCount": len(self.train_samples()),
            "valCount": len(self.val_samples()),
            "championSamples": counts["champion"],
            "learnerSamples": counts["learner"],
            "initModelPath": self.init_result["path"],
            "initModelHash": self.init_result["hash"],
            "initModelLoaded": bool(self.init_result["loaded"]),
            "initModelReason": self.init_result["reason"],
        }

    def append_samples(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self.ensure_initialized()
        samples_raw = payload.get("samples")
        if not isinstance(samples_raw, list):
            raise ValueError("append_samples requires a samples array")

        existing_count = len(self.samples)
        fresh: List[ManagedSample] = []
        for index, raw in enumerate(samples_raw):
            if not isinstance(raw, dict):
                continue
            parsed = parse_single_sample(raw, self.policy_target_temperature)
            parsed.is_validation = validation_flag(self.seed, existing_count + index, self.validation_ratio)
            fresh.append(parsed)

        self.samples = trim_samples(
            [*self.samples, *fresh],
            int(payload["replayMaxSamples"]),
            float(payload["replayAnchorRatio"]),
        )
        counts = count_origins(self.samples)
        return {
            "added": len(fresh),
            "sampleCount": len(self.samples),
            "trainCount": len(self.train_samples()),
            "valCount": len(self.val_samples()),
            "championSamples": counts["champion"],
            "learnerSamples": counts["learner"],
        }

    def replace_replay_from_file(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self.ensure_initialized()
        replay_path = os.path.abspath(str(payload["replayPath"]))
        state_names, action_names, samples = read_replay_file(
            replay_path,
            self.seed,
            self.validation_ratio,
            self.policy_target_temperature,
        )
        if state_names != self.state_names or action_names != self.action_names:
            raise ValueError("Replay schema mismatch during replace")
        self.samples = trim_samples(
            samples,
            int(payload["replayMaxSamples"]),
            float(payload["replayAnchorRatio"]),
        )
        counts = count_origins(self.samples)
        return {
            "replayPath": replay_path,
            "sampleCount": len(self.samples),
            "trainCount": len(self.train_samples()),
            "valCount": len(self.val_samples()),
            "championSamples": counts["champion"],
            "learnerSamples": counts["learner"],
        }

    def reload_model(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self.ensure_initialized()
        init_model_path = str(payload.get("initModelPath", ""))
        self.model = PolicyValueNet(len(self.state_names), len(self.action_names), self.hidden).to(self.device)
        self.init_result = load_initial_model(
            self.model,
            init_model_path,
            self.state_names,
            self.action_names,
            self.hidden,
        )
        self.rebuild_optimizer(
            float(payload.get("learningRate", self.learning_rate)),
            float(payload.get("weightDecay", self.weight_decay)),
        )
        self.ema_state = clone_state_dict_cpu(self.model)

        if self.init_result["loaded"]:
            emit_log(
                f"[az:init] warm-started from {self.init_result['path']} hash={self.init_result['hash']}"
            )
        elif self.init_result["path"]:
            emit_log(
                f"[az:init] using fresh weights ({self.init_result['reason']}) from {self.init_result['path']}"
            )
        else:
            emit_log("[az:init] using fresh weights (no init model provided)")

        return {
            "initModelPath": self.init_result["path"],
            "initModelHash": self.init_result["hash"],
            "initModelLoaded": bool(self.init_result["loaded"]),
            "initModelReason": self.init_result["reason"],
        }

    def train_samples(self) -> List[Any]:
        return [sample.record for sample in self.samples if not sample.is_validation]

    def val_samples(self) -> List[Any]:
        return [sample.record for sample in self.samples if sample.is_validation]

    def split_for_training(self) -> Tuple[List[Any], List[Any]]:
        train_samples = self.train_samples()
        val_samples = self.val_samples()
        if not train_samples and not val_samples:
            raise ValueError("Replay buffer is empty")
        if not train_samples:
            train_samples = [val_samples.pop()]
        if not val_samples:
            val_samples = [train_samples[-1]]
        return train_samples, val_samples

    def train(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self.ensure_initialized()
        train_samples, val_samples = self.split_for_training()
        sample_count = len(self.samples)
        if sample_count < 100:
            raise ValueError("Dataset too small; generate more self-play samples")

        epochs = int(payload["epochs"])
        batch_size = int(payload["batchSize"])
        learning_rate = float(payload["learningRate"])
        weight_decay = float(payload["weightDecay"])
        out_path = os.path.abspath(str(payload["outPath"]))
        ema_decay = float(payload.get("emaDecay", 0.995))
        policy_loss_weight = float(payload.get("policyLossWeight", 2.0))
        value_loss_weight = float(payload.get("valueLossWeight", 1.0))
        aux_loss_weight = float(payload.get("auxLossWeight", 0.2))
        label_smoothing = float(payload.get("labelSmoothing", 0.1))
        step = int(payload.get("step", 0))

        self.configure_optimizer(learning_rate, weight_decay)
        train_args = type("TrainArgs", (), {
            "batch_size": batch_size,
            "policy_loss_weight": policy_loss_weight,
            "value_loss_weight": value_loss_weight,
            "aux_loss_weight": aux_loss_weight,
            "label_smoothing": label_smoothing,
            "mixed_precision": self.mixed_precision,
        })()

        run_id = f"az-train-stream-{int(time.time())}-{random.randint(1000, 9999)}"
        emit_log(
            f"[az:resume] step={step} samples={sample_count} train={len(train_samples)} val={len(val_samples)} "
            f"epochs={epochs} batch={batch_size} lr={learning_rate} wd={weight_decay} device={self.device.type}"
        )
        append_metrics(
            self.metrics_log_path,
            run_id,
            "run_start",
            {
                "source": "az",
                "mode": "stream",
                "step": step,
                "sampleCount": sample_count,
                "trainCount": len(train_samples),
                "valCount": len(val_samples),
                "stateFeatureCount": len(self.state_names),
                "actionFeatureCount": len(self.action_names),
                "hidden": self.hidden,
                "epochs": epochs,
                "batchSize": batch_size,
                "learningRate": learning_rate,
                "weightDecay": weight_decay,
                "device": self.device.type,
                "initModelPath": self.init_result["path"],
                "initModelHash": self.init_result["hash"],
                "initModelLoaded": bool(self.init_result["loaded"]),
                "initModelReason": self.init_result["reason"],
            },
        )

        started = time.time()
        final_train_stats: Dict[str, float] = {}
        final_val_stats: Dict[str, float] = {}
        for epoch in range(1, epochs + 1):
            self.model.train()
            train_batches = batch_indices(len(train_samples), max(1, batch_size))
            epoch_loss = 0.0
            epoch_value = 0.0
            epoch_policy = 0.0
            epoch_aux = 0.0
            epoch_entropy = 0.0

            for batch_ids in train_batches:
                batch = [train_samples[i] for i in batch_ids]
                self.optimizer.zero_grad()
                with autocast_context(self.device, self.mixed_precision):
                    loss, metrics = compute_batch_loss(self.model, batch, self.device, train_args)
                if self.grad_scaler and self.mixed_precision:
                    self.grad_scaler.scale(loss).backward()
                    self.grad_scaler.step(self.optimizer)
                    self.grad_scaler.update()
                else:
                    loss.backward()
                    self.optimizer.step()
                epoch_loss += float(loss.item())
                epoch_value += metrics["valueLoss"]
                epoch_policy += metrics["policyLoss"]
                epoch_aux += metrics["auxLoss"]
                epoch_entropy += metrics["policyEntropy"]

            update_ema(self.ema_state, self.model.state_dict(), ema_decay)
            batch_count = max(1, len(train_batches))
            final_train_stats = {
                "loss": epoch_loss / batch_count,
                "valueLoss": epoch_value / batch_count,
                "policyLoss": epoch_policy / batch_count,
                "auxLoss": epoch_aux / batch_count,
                "policyEntropy": epoch_entropy / batch_count,
            }
            final_val_stats = evaluate_split(self.model, val_samples, self.device, train_args)
            elapsed = time.time() - started
            eta = 0 if epoch == epochs else (elapsed / epoch) * (epochs - epoch)
            progress = format_progress_bar(epoch, epochs)

            emit_log(
                f"[az] epoch {epoch}/{epochs} {progress} train_loss={final_train_stats['loss']:.4f} "
                f"val_loss={final_val_stats['loss']:.4f} val_value={final_val_stats['valueLoss']:.4f} "
                f"val_policy={final_val_stats['policyLoss']:.4f} val_aux={final_val_stats['auxLoss']:.4f} "
                f"entropy={final_val_stats['policyEntropy']:.4f} elapsed={int(elapsed)}s eta={int(eta)}s"
            )

            append_metrics(
                self.metrics_log_path,
                run_id,
                "epoch",
                {
                    "source": "az",
                    "mode": "stream",
                    "step": step,
                    "epoch": epoch,
                    "totalEpochs": epochs,
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

        self.model.load_state_dict({name: tensor.to(self.device) for name, tensor in self.ema_state.items()})
        training_meta = {
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "games": sample_count,
            "positionSamples": sample_count,
            "epochs": epochs,
            "difficulty": "mixed",
            "framework": "pytorch-stream",
            "device": self.device.type,
            "batchSize": batch_size,
            "learningRate": learning_rate,
            "hiddenLayers": self.hidden,
            "policyLossWeight": policy_loss_weight,
            "valueLossWeight": value_loss_weight,
            "auxLossWeight": aux_loss_weight,
            "initializedFrom": self.init_result["path"],
            "initializedFromHash": self.init_result["hash"],
            "initializedFromLoaded": bool(self.init_result["loaded"]),
            "initializedFromReason": self.init_result["reason"],
        }
        export_model(out_path, self.model, self.state_names, self.action_names, self.hidden, training_meta)
        emit_log(f"[az:done] saved={out_path}")

        append_metrics(
            self.metrics_log_path,
            run_id,
            "run_end",
            {
                "source": "az",
                "mode": "stream",
                "step": step,
                "status": "completed",
                "outputPath": out_path,
                "epochs": epochs,
                "sampleCount": sample_count,
            },
        )

        return {
            "outputPath": out_path,
            "sampleCount": sample_count,
            "trainCount": len(train_samples),
            "valCount": len(val_samples),
            "trainLoss": final_train_stats.get("loss"),
            "valLoss": final_val_stats.get("loss"),
        }


def main() -> None:
    server = TrainerServer()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Request must be a JSON object")
            request_id = request.get("id")
            command = request.get("cmd")
            payload = request.get("payload")
            if not isinstance(command, str):
                raise ValueError("Request missing cmd")
            if payload is None:
                payload = {}
            if not isinstance(payload, dict):
                raise ValueError("Request payload must be an object")

            if command == "init":
                response = server.init_from_replay_file(payload)
            elif command == "append_samples":
                response = server.append_samples(payload)
            elif command == "replace_replay_from_file":
                response = server.replace_replay_from_file(payload)
            elif command == "reload_model":
                response = server.reload_model(payload)
            elif command == "train":
                response = server.train(payload)
            elif command == "shutdown":
                protocol_response(request_id, True, {"status": "bye"})
                return
            else:
                raise ValueError(f"Unknown command: {command}")

            protocol_response(request_id, True, response)
        except Exception as error:
            emit_log(f"[az:error] {error}")
            traceback.print_exc(file=sys.stderr)
            protocol_response(request_id, False, error=str(error))


if __name__ == "__main__":
    main()
