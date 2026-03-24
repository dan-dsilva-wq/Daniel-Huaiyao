#!/usr/bin/env python3

import argparse
import json
import math
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


ROOT_DIR = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT_DIR / "scripts" / "hive"
GPU_SERVER_PATH = SCRIPTS_DIR / "gpu-inference-server.py"
ENGINE_SERVER_PATH = SCRIPTS_DIR / "hive-engine-server.ts"


class SyncJsonLineProcessClient:
    def __init__(self, argv: List[str], cwd: Path, stderr_prefix: str):
        self.proc = subprocess.Popen(
            argv,
            cwd=str(cwd),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.stderr_prefix = stderr_prefix
        self.next_id = 1
        self.closed = False
        if self.proc.stderr is not None:
            self.stderr_thread = threading.Thread(target=self._pump_stderr, daemon=True)
            self.stderr_thread.start()
        else:
            self.stderr_thread = None

    def _pump_stderr(self) -> None:
        assert self.proc.stderr is not None
        for raw_line in self.proc.stderr:
            line = raw_line.rstrip("\n")
            if line:
                sys.stderr.write(f"[{self.stderr_prefix}] {line}\n")
                sys.stderr.flush()

    def request(self, cmd: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if self.closed or self.proc.stdin is None or self.proc.stdout is None:
            raise RuntimeError(f"{self.stderr_prefix} not available")
        request_id = str(self.next_id)
        self.next_id += 1
        message = json.dumps({"id": request_id, "cmd": cmd, "payload": payload})
        self.proc.stdin.write(message)
        self.proc.stdin.write("\n")
        self.proc.stdin.flush()

        while True:
            raw = self.proc.stdout.readline()
            if raw == "":
                raise RuntimeError(f"{self.stderr_prefix} closed while waiting for {cmd}")
            raw = raw.strip()
            if not raw:
                continue
            response = json.loads(raw)
            if str(response.get("id")) != request_id:
                continue
            if not response.get("ok"):
                raise RuntimeError(response.get("error") or f"{self.stderr_prefix} request failed")
            payload_out = response.get("payload")
            return payload_out if isinstance(payload_out, dict) else {}

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.request("shutdown", {})
        except Exception:
            pass
        try:
            self.proc.terminate()
            self.proc.wait(timeout=3)
        except Exception:
            self.proc.kill()


class EngineClient:
    def __init__(self) -> None:
        self.client = SyncJsonLineProcessClient(
            ["node", "--import", "tsx", str(ENGINE_SERVER_PATH)],
            ROOT_DIR,
            "engine",
        )

    def create_games(self, games: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        payload = self.client.request("create_games", {"games": games})
        return list(payload.get("states") or [])

    def expand_states(self, state_ids: List[str]) -> List[Dict[str, Any]]:
        payload = self.client.request("expand_states", {"stateIds": state_ids})
        return list(payload.get("states") or [])

    def apply_moves(self, moves: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        payload = self.client.request("apply_moves", {"moves": moves})
        return list(payload.get("results") or [])

    def release_states(self, state_ids: List[str]) -> None:
        if not state_ids:
            return
        self.client.request("release_states", {"stateIds": state_ids})

    def close(self) -> None:
        self.client.close()


class GpuClient:
    def __init__(self, candidate_model: str, champion_model: str, batch_size: int, batch_delay_ms: int, device: str) -> None:
        self.client = SyncJsonLineProcessClient(
            spawn_python_command(str(GPU_SERVER_PATH)),
            ROOT_DIR,
            "gpu",
        )
        self.client.request("init", {
            "modelPath": str(Path(candidate_model).resolve()),
            "device": device,
            "modelKey": "candidate",
        })
        self.client.request("load_model", {
            "modelPath": str(Path(champion_model).resolve()),
            "modelKey": "champion",
        })
        self.batch_size = batch_size
        self.batch_delay_ms = batch_delay_ms

    def infer(self, positions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not positions:
            return []
        results: List[Dict[str, Any]] = []
        step = max(1, self.batch_size)
        for offset in range(0, len(positions), step):
            chunk = positions[offset: offset + step]
            payload = self.client.request("infer", {"positions": chunk})
            results.extend(list(payload.get("results") or []))
            if self.batch_delay_ms > 0 and offset + step < len(positions):
                time.sleep(self.batch_delay_ms / 1000)
        return results

    def close(self) -> None:
        self.client.close()


def spawn_python_command(script_path: str) -> List[str]:
    local_venv = ROOT_DIR / ".venv-hive" / ("Scripts" if os_name() == "nt" else "bin") / ("python.exe" if os_name() == "nt" else "python")
    candidates = [
        str(local_venv),
        sys.executable,
        shutil.which("python3") or "",
        shutil.which("python") or "",
    ]
    seen = set()
    for candidate in candidates:
        if not candidate:
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        if candidate == sys.executable or Path(candidate).exists():
            return [candidate, script_path]
    raise RuntimeError("Unable to locate a usable Python interpreter")


def os_name() -> str:
    return "nt" if sys.platform.startswith("win") else "posix"


def clamp(value: float, lower: float, upper: float) -> float:
    return min(upper, max(lower, value))


def create_seeded_rng(seed: int):
    state = abs(int(seed)) % 2147483647
    if state <= 0:
        state = 1

    def rng() -> float:
        nonlocal state
        state = (state * 48271) % 2147483647
        return state / 2147483647

    return rng


def normalize_softmax(logits: List[float]) -> List[float]:
    if not logits:
        return []
    max_logit = max(logits)
    exps = [math.exp(value - max_logit) for value in logits]
    total = sum(exps)
    if total <= 0:
        return [1.0 / len(logits)] * len(logits)
    return [value / total for value in exps]


def softmax_entropy(probabilities: List[float]) -> float:
    entropy = 0.0
    for probability in probabilities:
        if probability > 1e-9:
            entropy -= probability * math.log(probability)
    return entropy


def sample_gamma(alpha: float, rng) -> float:
    if alpha <= 0:
        return 0.0
    if alpha < 1:
        sample = sample_gamma(alpha + 1, rng)
        return sample * (rng() ** (1 / alpha))

    d = alpha - 1 / 3
    c = 1 / math.sqrt(9 * d)
    while True:
        x = 0.0
        y = 0.0
        while True:
            x = rng() * 2 - 1
            y = rng() * 2 - 1
            s = x * x + y * y
            if 0 < s < 1:
                break
        standard = x * math.sqrt(-2 * math.log(s) / s)
        v = (1 + c * standard) ** 3
        if v <= 0:
            continue
        u = rng()
        if u < 1 - 0.0331 * (standard ** 4):
            return d * v
        if math.log(u) < 0.5 * standard * standard + d * (1 - v + math.log(v)):
            return d * v


def sample_dirichlet(size: int, alpha: float, rng) -> List[float]:
    samples = [sample_gamma(max(1e-4, alpha), rng) for _ in range(size)]
    total = sum(samples)
    if total <= 0:
        return [1.0 / max(1, size)] * size
    return [value / total for value in samples]


@dataclass
class Edge:
    action_key: str
    move: Dict[str, Any]
    prior: float
    visit_count: int = 0
    value_sum: float = 0.0
    virtual_loss: int = 0
    child: Optional["Node"] = None


@dataclass
class Node:
    state_id: str
    state_hash: str
    to_play: str
    status: str
    winner: Optional[str]
    turn_number: int
    queen_pressure_total: int
    visit_count: int = 0
    value_sum: float = 0.0
    expanded: bool = False
    edges: Dict[str, Edge] = field(default_factory=dict)
    policy_entropy: float = 0.0
    pending_value: Optional[float] = None


@dataclass
class SearchTask:
    game_index: int
    model_key: str
    root: Node
    seed: int
    simulations_target: int
    max_depth: int
    simulations_done: int = 0
    nodes_expanded: int = 0
    depth_sum: float = 0.0
    started_at: float = field(default_factory=time.perf_counter)
    transposition: Dict[str, Node] = field(default_factory=dict)
    rng: Any = None

    def __post_init__(self) -> None:
        if self.rng is None:
            self.rng = create_seeded_rng(self.seed)
        self.transposition[self.root.state_hash] = self.root


@dataclass
class CandidateSearchStats:
    candidate_moves: int = 0
    candidate_simulations: int = 0
    nodes_per_second_sum: float = 0.0
    policy_entropy_sum: float = 0.0


@dataclass
class ActiveGame:
    game_index: int
    candidate_color: str
    state_id: str
    current_turn: str
    turn_number: int
    status: str
    winner: Optional[str]
    queen_pressure_total: int
    no_progress: int = 0
    opening_ply: int = 0
    stats: CandidateSearchStats = field(default_factory=CandidateSearchStats)


DEFAULT_SEARCH_CONFIG = {
    "simulations": 220,
    "c_puct": 1.18,
    "dirichlet_alpha": 0.22,
    "dirichlet_epsilon": 0.06,
    "temperature": 0.5,
    "policy_prune_top_k": 14,
    "policy_prune_min_prob": 0.001,
    "forced_playouts": 3,
}


def terminal_value(winner: Optional[str], perspective: str) -> float:
    if winner == "draw" or winner is None:
        return 0.0
    return 1.0 if winner == perspective else -1.0


def apply_expanded_priors(node: Node, priors: List[Dict[str, Any]]) -> None:
    prior_sum = max(1e-9, sum(entry["prior"] for entry in priors))
    node.edges = {}
    for prior in priors:
        node.edges[prior["actionKey"]] = Edge(
            action_key=prior["actionKey"],
            move=prior["move"],
            prior=prior["prior"] / prior_sum,
        )
    node.policy_entropy = softmax_entropy([edge.prior for edge in node.edges.values()])
    node.expanded = True


def build_filtered_priors(
    legal_moves: List[Dict[str, Any]],
    actions: List[Dict[str, Any]],
    action_logits: Dict[str, float],
    is_root: bool,
    rng,
) -> List[Dict[str, Any]]:
    action_lookup = {str(action["actionKey"]): action for action in actions}
    candidates: List[Dict[str, Any]] = []
    for move in legal_moves:
        action = action_lookup.get(str(move.get("actionKey") or "")) if "actionKey" in move else None
        action_key = str(action["actionKey"]) if action else ""
        if not action_key:
            for maybe_action in actions:
                if maybe_action.get("move") == move:
                    action_key = str(maybe_action["actionKey"])
                    break
        candidates.append({
            "move": move,
            "actionKey": action_key,
            "logit": float(action_logits.get(action_key, 0.0)),
        })
    candidates.sort(key=lambda entry: entry["logit"], reverse=True)
    top_k = candidates[: DEFAULT_SEARCH_CONFIG["policy_prune_top_k"]]
    priors = normalize_softmax([entry["logit"] for entry in top_k])
    filtered = [
        {
            "move": entry["move"],
            "actionKey": entry["actionKey"],
            "prior": priors[index],
        }
        for index, entry in enumerate(top_k)
        if priors[index] >= DEFAULT_SEARCH_CONFIG["policy_prune_min_prob"]
    ]
    if not filtered and top_k:
        filtered = [{
            "move": top_k[0]["move"],
            "actionKey": top_k[0]["actionKey"],
            "prior": 1.0,
        }]
    if is_root and len(filtered) > 1 and DEFAULT_SEARCH_CONFIG["dirichlet_epsilon"] > 0:
        noise = sample_dirichlet(len(filtered), DEFAULT_SEARCH_CONFIG["dirichlet_alpha"], rng)
        filtered = [
            {
                **entry,
                "prior": entry["prior"] * (1 - DEFAULT_SEARCH_CONFIG["dirichlet_epsilon"])
                + noise[index] * DEFAULT_SEARCH_CONFIG["dirichlet_epsilon"],
            }
            for index, entry in enumerate(filtered)
        ]
    return filtered


def select_puct_edge(node: Node) -> Optional[Edge]:
    best_edge = None
    best_score = float("-inf")
    sqrt_visits = math.sqrt(node.visit_count + 1)
    for edge in node.edges.values():
        effective_visits = edge.visit_count + edge.virtual_loss
        q_value = edge.value_sum / effective_visits if effective_visits > 0 else 0.0
        u_value = DEFAULT_SEARCH_CONFIG["c_puct"] * edge.prior * sqrt_visits / (1 + effective_visits)
        score = q_value + u_value
        if score > best_score:
            best_score = score
            best_edge = edge
    return best_edge


def backpropagate(path_nodes: List[Node], path_edges: List[Edge], value: float) -> None:
    backed_value = value
    for index in range(len(path_nodes) - 1, -1, -1):
        node = path_nodes[index]
        node.visit_count += 1
        node.value_sum += backed_value
        if index > 0:
            edge = path_edges[index - 1]
            parent_value = -backed_value
            edge.visit_count += 1
            edge.value_sum += parent_value
            edge.virtual_loss = max(0, edge.virtual_loss - 1)
            backed_value = parent_value


def select_policy_move(policy: List[Dict[str, Any]], temperature: float, rng) -> Optional[Dict[str, Any]]:
    if not policy:
        return None
    if temperature <= 0.05:
        return policy[0]["move"]
    pick = rng()
    cumulative = 0.0
    for entry in policy:
        cumulative += entry["probability"]
        if pick <= cumulative:
            return entry["move"]
    return policy[0]["move"]


def build_root_policy(task: SearchTask) -> List[Dict[str, Any]]:
    root = task.root
    root_policies: List[Dict[str, Any]] = []
    for edge in root.edges.values():
        q_value = edge.value_sum / edge.visit_count if edge.visit_count > 0 else 0.0
        forced_floor = math.floor(
            DEFAULT_SEARCH_CONFIG["forced_playouts"] * edge.prior * task.simulations_target
        )
        root_policies.append({
            "actionKey": edge.action_key,
            "move": edge.move,
            "visits": max(edge.visit_count, forced_floor),
            "rawVisits": edge.visit_count,
            "prior": edge.prior,
            "qValue": q_value,
        })
    root_policies.sort(key=lambda entry: (-entry["visits"], -entry["prior"]))
    total_visits = max(1, sum(entry["visits"] for entry in root_policies))
    temperature = max(0.01, DEFAULT_SEARCH_CONFIG["temperature"])
    weighted = [
        {
            **entry,
            "weight": math.pow(max(1e-6, entry["visits"] / total_visits), 1 / temperature),
        }
        for entry in root_policies
    ]
    weight_sum = sum(entry["weight"] for entry in weighted)
    return [
        {
            **entry,
            "probability": entry["weight"] / weight_sum if weight_sum > 0 else 1 / max(1, len(weighted)),
        }
        for entry in weighted
    ]


def create_node_from_state(summary: Dict[str, Any]) -> Node:
    return Node(
        state_id=str(summary["stateId"]),
        state_hash=str(summary["stateHash"]),
        to_play=str(summary["currentTurn"]),
        status=str(summary["status"]),
        winner=summary.get("winner"),
        turn_number=int(summary["turnNumber"]),
        queen_pressure_total=int(summary["queenPressureTotal"]),
    )


def expand_nodes_with_inference(
    tasks: List[SearchTask],
    expansions: List[Dict[str, Any]],
    gpu: GpuClient,
    root_flags: List[bool],
) -> None:
    positions: List[Dict[str, Any]] = []
    infer_indices: List[int] = []
    for index, expansion in enumerate(expansions):
        legal_moves = list(expansion.get("legalMoves") or [])
        if expansion.get("status") != "playing" or not legal_moves:
            continue
        positions.append({
            "modelKey": tasks[index].model_key,
            "stateFeatures": expansion.get("stateFeatures") or [],
            "actions": [
                {
                    "actionKey": action["actionKey"],
                    "actionFeatures": action["actionFeatures"],
                }
                for action in expansion.get("actions") or []
            ],
        })
        infer_indices.append(index)

    infer_results = gpu.infer(positions) if positions else []
    infer_cursor = 0
    for index, expansion in enumerate(expansions):
        task = tasks[index]
        node = task.root if root_flags[index] else task.root
        legal_moves = list(expansion.get("legalMoves") or [])
        task.nodes_expanded += 1
        if expansion.get("status") != "playing":
            continue
        if not legal_moves:
            node.expanded = True
            continue
        if infer_cursor >= len(infer_results):
            continue
        result = infer_results[infer_cursor]
        infer_cursor += 1
        filtered = build_filtered_priors(
            legal_moves,
            list(expansion.get("actions") or []),
            dict(result.get("actionLogits") or {}),
            root_flags[index],
            task.rng,
        )
        apply_expanded_priors(node, filtered)
        node.pending_value = clamp(float(result.get("value", 0.0)), -1.0, 1.0)


def run_batched_searches(
    search_inputs: List[Dict[str, Any]],
    engine: EngineClient,
    gpu: GpuClient,
) -> List[Dict[str, Any]]:
    if not search_inputs:
        return []

    root_expansions = engine.expand_states([entry["stateId"] for entry in search_inputs])
    tasks: List[SearchTask] = []
    positions: List[Dict[str, Any]] = []
    root_map: List[Dict[str, Any]] = []
    for index, expansion in enumerate(root_expansions):
        root = create_node_from_state(expansion)
        task = SearchTask(
            game_index=int(search_inputs[index]["gameIndex"]),
            model_key=str(search_inputs[index]["modelKey"]),
            root=root,
            seed=int(search_inputs[index]["seed"]),
            simulations_target=int(search_inputs[index]["simulations"]),
            max_depth=int(search_inputs[index]["maxDepth"]),
        )
        tasks.append(task)
        legal_moves = list(expansion.get("legalMoves") or [])
        if expansion.get("status") == "playing" and legal_moves:
            positions.append({
                "modelKey": task.model_key,
                "stateFeatures": expansion.get("stateFeatures") or [],
                "actions": [
                    {
                        "actionKey": action["actionKey"],
                        "actionFeatures": action["actionFeatures"],
                    }
                    for action in expansion.get("actions") or []
                ],
            })
        else:
            positions.append(None)
        root_map.append(expansion)

    infer_positions = [entry for entry in positions if entry is not None]
    infer_results = gpu.infer(infer_positions) if infer_positions else []
    infer_cursor = 0
    for index, task in enumerate(tasks):
        expansion = root_map[index]
        legal_moves = list(expansion.get("legalMoves") or [])
        task.nodes_expanded += 1
        if expansion.get("status") != "playing" or not legal_moves:
            task.root.expanded = True
            continue
        result = infer_results[infer_cursor]
        infer_cursor += 1
        filtered = build_filtered_priors(
            legal_moves,
            list(expansion.get("actions") or []),
            dict(result.get("actionLogits") or {}),
            True,
            task.rng,
        )
        apply_expanded_priors(task.root, filtered)
        task.root.pending_value = clamp(float(result.get("value", 0.0)), -1.0, 1.0)

    while any(task.simulations_done < task.simulations_target for task in tasks):
        selection_contexts: List[Dict[str, Any]] = []
        pending_children: List[Dict[str, Any]] = []

        for task in tasks:
            if task.simulations_done >= task.simulations_target:
                continue
            path_nodes = [task.root]
            path_edges: List[Edge] = []
            node = task.root
            depth = 0
            pending_edge: Optional[Edge] = None

            while node.expanded and node.edges and node.status == "playing" and depth < task.max_depth:
                edge = select_puct_edge(node)
                if edge is None:
                    break
                edge.virtual_loss += 1
                path_edges.append(edge)
                if edge.child is None:
                    pending_edge = edge
                    break
                node = edge.child
                path_nodes.append(node)
                depth += 1

            context = {
                "task": task,
                "node": node,
                "pathNodes": path_nodes,
                "pathEdges": path_edges,
                "depth": depth,
                "pendingEdge": pending_edge,
            }
            if pending_edge is not None:
                pending_children.append({
                    "stateId": node.state_id,
                    "move": pending_edge.move,
                })
            selection_contexts.append(context)

        pending_results: List[Dict[str, Any]] = []
        if pending_children:
            pending_results = engine.apply_moves(pending_children)
        pending_cursor = 0

        leaf_contexts: List[Dict[str, Any]] = []
        for context in selection_contexts:
            task: SearchTask = context["task"]
            node: Node = context["node"]
            pending_edge: Optional[Edge] = context["pendingEdge"]
            if pending_edge is not None:
                result = pending_results[pending_cursor]
                pending_cursor += 1
                state_hash = str(result["stateHash"])
                child = task.transposition.get(state_hash)
                if child is None:
                    child = create_node_from_state(result)
                    task.transposition[state_hash] = child
                pending_edge.child = child
                context["node"] = child
                context["pathNodes"].append(child)
                context["depth"] += 1
                node = child

            if node.status == "finished":
                value = terminal_value(node.winner, node.to_play)
                backpropagate(context["pathNodes"], context["pathEdges"], value)
                task.depth_sum += context["depth"]
                task.simulations_done += 1
                continue

            if context["depth"] >= task.max_depth or node.expanded:
                backpropagate(context["pathNodes"], context["pathEdges"], 0.0)
                task.depth_sum += context["depth"]
                task.simulations_done += 1
                continue

            leaf_contexts.append(context)

        if leaf_contexts:
            expansions = engine.expand_states([context["node"].state_id for context in leaf_contexts])
            infer_positions = []
            infer_index_map: List[int] = []
            for index, context in enumerate(leaf_contexts):
                expansion = expansions[index]
                node: Node = context["node"]
                node.state_hash = str(expansion["stateHash"])
                node.status = str(expansion["status"])
                node.winner = expansion.get("winner")
                node.to_play = str(expansion["currentTurn"])
                node.turn_number = int(expansion["turnNumber"])
                node.queen_pressure_total = int(expansion["queenPressureTotal"])
                legal_moves = list(expansion.get("legalMoves") or [])
                task: SearchTask = context["task"]
                if expansion.get("status") == "playing" and legal_moves:
                    infer_positions.append({
                        "modelKey": task.model_key,
                        "stateFeatures": expansion.get("stateFeatures") or [],
                        "actions": [
                            {
                                "actionKey": action["actionKey"],
                                "actionFeatures": action["actionFeatures"],
                            }
                            for action in expansion.get("actions") or []
                        ],
                    })
                    infer_index_map.append(index)

            infer_results = gpu.infer(infer_positions) if infer_positions else []
            infer_cursor = 0
            for index, context in enumerate(leaf_contexts):
                task: SearchTask = context["task"]
                node: Node = context["node"]
                expansion = expansions[index]
                legal_moves = list(expansion.get("legalMoves") or [])
                task.nodes_expanded += 1
                if expansion.get("status") != "playing":
                    backpropagate(context["pathNodes"], context["pathEdges"], terminal_value(node.winner, node.to_play))
                    task.depth_sum += len(context["pathEdges"])
                    task.simulations_done += 1
                    continue
                if not legal_moves:
                    backpropagate(context["pathNodes"], context["pathEdges"], -1.0)
                    task.depth_sum += len(context["pathEdges"])
                    task.simulations_done += 1
                    continue
                result = infer_results[infer_cursor]
                infer_cursor += 1
                filtered = build_filtered_priors(
                    legal_moves,
                    list(expansion.get("actions") or []),
                    dict(result.get("actionLogits") or {}),
                    len(context["pathEdges"]) == 0,
                    task.rng,
                )
                apply_expanded_priors(node, filtered)
                node.pending_value = clamp(float(result.get("value", 0.0)), -1.0, 1.0)
                backpropagate(context["pathNodes"], context["pathEdges"], node.pending_value or 0.0)
                task.depth_sum += len(context["pathEdges"])
                task.simulations_done += 1

    results: List[Dict[str, Any]] = []
    for task in tasks:
        policy = build_root_policy(task)
        selected_move = select_policy_move(policy, DEFAULT_SEARCH_CONFIG["temperature"], task.rng)
        elapsed = max(1e-6, time.perf_counter() - task.started_at)
        results.append({
            "gameIndex": task.game_index,
            "selectedMove": selected_move,
            "stats": {
                "simulations": task.simulations_done,
                "nodesExpanded": task.nodes_expanded,
                "nodesPerSecond": task.nodes_expanded / elapsed,
                "averageSimulationDepth": task.depth_sum / task.simulations_done if task.simulations_done > 0 else 0.0,
                "policyEntropy": softmax_entropy([entry["probability"] for entry in policy]),
                "rootValue": task.root.value_sum / task.root.visit_count if task.root.visit_count > 0 else 0.0,
            },
            "releaseStateIds": list({node.state_id for node in task.transposition.values()}),
        })
    return results


def opposite_color(color: str) -> str:
    return "black" if color == "white" else "white"


def update_active_game_from_summary(game: ActiveGame, summary: Dict[str, Any]) -> None:
    game.state_id = str(summary["stateId"])
    game.current_turn = str(summary["currentTurn"])
    game.turn_number = int(summary["turnNumber"])
    game.status = str(summary["status"])
    game.winner = summary.get("winner")
    game.queen_pressure_total = int(summary["queenPressureTotal"])


def emit_game_result(game: ActiveGame) -> None:
    payload = {
        "gameIndex": game.game_index,
        "winner": None if game.winner == "draw" else game.winner,
        "candidateColor": game.candidate_color,
        "turns": game.turn_number,
        "candidateMoves": game.stats.candidate_moves,
        "candidateSimulations": game.stats.candidate_simulations,
        "nodesPerSecondSum": game.stats.nodes_per_second_sum,
        "policyEntropySum": game.stats.policy_entropy_sum,
    }
    sys.stdout.write(json.dumps(payload))
    sys.stdout.write("\n")
    sys.stdout.flush()


def maybe_finish_game(game: ActiveGame, no_capture_draw_moves: int, max_turns: int) -> bool:
    if game.status == "finished":
        return True
    if game.turn_number > max_turns:
        game.status = "finished"
        game.winner = "draw"
        return True
    if no_capture_draw_moves > 0 and game.no_progress >= no_capture_draw_moves:
        game.status = "finished"
        game.winner = "draw"
        return True
    return False


def choose_candidate_color(game_index: int, mode: str) -> str:
    if mode == "white":
        return "white"
    if mode == "black":
        return "black"
    return "white" if game_index % 2 == 1 else "black"


def run_arena(args: argparse.Namespace) -> None:
    engine = EngineClient()
    gpu = GpuClient(
        args.candidate_model,
        args.champion_model,
        args.gpu_batch_size,
        args.gpu_batch_delay_ms,
        args.device,
    )
    active_games: List[ActiveGame] = []
    next_game_index = 1

    try:
        while len(active_games) < min(args.games_in_flight, args.games) and next_game_index <= args.games:
            candidate_color = choose_candidate_color(next_game_index, args.candidate_color_mode)
            created = engine.create_games([{
                "gameId": f"python-arena-{next_game_index}",
                "shortCode": "PYAR",
                "whitePlayerId": "candidate" if candidate_color == "white" else "champion",
                "blackPlayerId": "candidate" if candidate_color == "black" else "champion",
            }])[0]
            active_games.append(ActiveGame(
                game_index=next_game_index,
                candidate_color=candidate_color,
                state_id=str(created["stateId"]),
                current_turn=str(created["currentTurn"]),
                turn_number=int(created["turnNumber"]),
                status=str(created["status"]),
                winner=created.get("winner"),
                queen_pressure_total=int(created["queenPressureTotal"]),
            ))
            next_game_index += 1

        while active_games:
            opening_games = [game for game in active_games if game.status == "playing" and game.opening_ply < args.opening_random_plies]
            if opening_games:
                expansions = engine.expand_states([game.state_id for game in opening_games])
                moves_to_apply: List[Dict[str, Any]] = []
                games_to_apply: List[ActiveGame] = []
                for game, expansion in zip(opening_games, expansions):
                    legal_moves = list(expansion.get("legalMoves") or [])
                    if not legal_moves:
                        game.status = "finished"
                        game.winner = opposite_color(game.current_turn)
                        continue
                    rng = create_seeded_rng(args.seed + game.game_index * 131 + game.opening_ply)
                    move = legal_moves[int(rng() * len(legal_moves))]
                    moves_to_apply.append({"stateId": game.state_id, "move": move})
                    games_to_apply.append(game)
                if moves_to_apply:
                    applied = engine.apply_moves(moves_to_apply)
                    release_ids = [game.state_id for game in games_to_apply]
                    for game, summary in zip(games_to_apply, applied):
                        pressure = int(summary["queenPressureTotal"])
                        if pressure == game.queen_pressure_total:
                            game.no_progress += 1
                        else:
                            game.no_progress = 0
                        update_active_game_from_summary(game, summary)
                        game.opening_ply += 1
                    engine.release_states(release_ids)

            search_games = [game for game in active_games if game.status == "playing" and game.opening_ply >= args.opening_random_plies and game.turn_number <= args.max_turns]
            if search_games:
                search_inputs = [{
                    "gameIndex": game.game_index,
                    "stateId": game.state_id,
                    "modelKey": "candidate" if game.current_turn == game.candidate_color else "champion",
                    "seed": args.seed + game.game_index * 163 + game.turn_number,
                    "simulations": args.simulations or DEFAULT_SEARCH_CONFIG["simulations"],
                    "maxDepth": args.max_turns,
                } for game in search_games]
                search_results = run_batched_searches(search_inputs, engine, gpu)
                moves_to_apply: List[Dict[str, Any]] = []
                games_to_apply: List[ActiveGame] = []
                release_ids: List[str] = []
                result_by_index = {int(result["gameIndex"]): result for result in search_results}
                for game in search_games:
                    result = result_by_index[game.game_index]
                    release_ids.extend(result.get("releaseStateIds") or [])
                    if game.current_turn == game.candidate_color:
                        stats = result["stats"]
                        game.stats.candidate_moves += 1
                        game.stats.candidate_simulations += int(stats["simulations"])
                        game.stats.nodes_per_second_sum += float(stats["nodesPerSecond"])
                        game.stats.policy_entropy_sum += float(stats["policyEntropy"])
                    move = result.get("selectedMove")
                    if move is None:
                        game.status = "finished"
                        game.winner = opposite_color(game.current_turn)
                        continue
                    moves_to_apply.append({"stateId": game.state_id, "move": move})
                    games_to_apply.append(game)
                if moves_to_apply:
                    applied = engine.apply_moves(moves_to_apply)
                    release_ids.extend(game.state_id for game in games_to_apply)
                    for game, summary in zip(games_to_apply, applied):
                        pressure = int(summary["queenPressureTotal"])
                        if pressure == game.queen_pressure_total:
                            game.no_progress += 1
                        else:
                            game.no_progress = 0
                        update_active_game_from_summary(game, summary)
                    engine.release_states(sorted(set(release_ids)))

            still_active: List[ActiveGame] = []
            for game in active_games:
                if maybe_finish_game(game, args.no_capture_draw, args.max_turns):
                    emit_game_result(game)
                    try:
                        engine.release_states([game.state_id])
                    except Exception:
                        pass
                    if next_game_index <= args.games:
                        candidate_color = choose_candidate_color(next_game_index, args.candidate_color_mode)
                        created = engine.create_games([{
                            "gameId": f"python-arena-{next_game_index}",
                            "shortCode": "PYAR",
                            "whitePlayerId": "candidate" if candidate_color == "white" else "champion",
                            "blackPlayerId": "candidate" if candidate_color == "black" else "champion",
                        }])[0]
                        still_active.append(ActiveGame(
                            game_index=next_game_index,
                            candidate_color=candidate_color,
                            state_id=str(created["stateId"]),
                            current_turn=str(created["currentTurn"]),
                            turn_number=int(created["turnNumber"]),
                            status=str(created["status"]),
                            winner=created.get("winner"),
                            queen_pressure_total=int(created["queenPressureTotal"]),
                        ))
                        next_game_index += 1
                else:
                    still_active.append(game)
            active_games = still_active
    finally:
        gpu.close()
        engine.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Python batched Hive arena worker")
    parser.add_argument("--candidate-model", required=True)
    parser.add_argument("--champion-model", required=True)
    parser.add_argument("--games", type=int, default=1)
    parser.add_argument("--games-in-flight", type=int, default=12)
    parser.add_argument("--simulations", type=int, default=0)
    parser.add_argument("--max-turns", type=int, default=320)
    parser.add_argument("--no-capture-draw", type=int, default=100)
    parser.add_argument("--opening-random-plies", type=int, default=4)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--gpu-batch-size", type=int, default=768)
    parser.add_argument("--gpu-batch-delay-ms", type=int, default=1)
    parser.add_argument("--candidate-color-mode", choices=["alternate", "white", "black"], default="alternate")
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_arena(args)


if __name__ == "__main__":
    main()
