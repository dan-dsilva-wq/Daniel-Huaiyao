#!/usr/bin/env python3
"""
GPU-accelerated MCTS for Hive AlphaZero training.

This module implements Monte Carlo Tree Search with batched neural network inference
on GPU, providing significant speedup over the single-position TypeScript implementation.

Key features:
- Batched leaf evaluation (50-200 positions per GPU call)
- PyTorch-based neural network inference
- Compatible with the existing model format
- Same MCTS algorithm as the TypeScript version
"""

import hashlib
import json
import math
import os
import random
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Set

try:
    import torch
    import torch.nn.functional as F
except ImportError:
    print("PyTorch is required. Install with: pip install torch", flush=True)
    raise


# =============================================================================
# Piece and Game State Types
# =============================================================================

PIECE_TYPES = ['queen', 'beetle', 'grasshopper', 'spider', 'ant', 'ladybug', 'mosquito', 'pillbug']
PIECE_TYPE_TO_INDEX = {t: i for i, t in enumerate(PIECE_TYPES)}


@dataclass
class HexCoord:
    q: int
    r: int

    def __hash__(self) -> int:
        return hash((self.q, self.r))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, HexCoord):
            return False
        return self.q == other.q and self.r == other.r

    def neighbors(self) -> List['HexCoord']:
        """Get all 6 neighboring hex coordinates."""
        directions = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
        return [HexCoord(self.q + dq, self.r + dr) for dq, dr in directions]


@dataclass
class Piece:
    id: str
    type: str
    color: str  # 'white' or 'black'


@dataclass
class PlacedPiece(Piece):
    position: HexCoord
    stack_order: int = 0


@dataclass
class Move:
    type: str  # 'place' or 'move'
    piece_id: str
    to: HexCoord
    from_pos: Optional[HexCoord] = None
    is_pillbug_ability: bool = False

    def to_action_key(self) -> str:
        """Convert move to a unique string key."""
        if self.type == 'place':
            return f"place:{self.piece_id}:{self.to.q},{self.to.r}"
        else:
            prefix = "pillbug:" if self.is_pillbug_ability else "move:"
            return f"{prefix}{self.piece_id}:{self.to.q},{self.to.r}"


@dataclass
class GameState:
    """Simplified game state for MCTS."""
    board: List[PlacedPiece]
    white_hand: List[Piece]
    black_hand: List[Piece]
    current_turn: str  # 'white' or 'black'
    turn_number: int
    status: str  # 'playing' or 'finished'
    winner: Optional[str] = None
    white_queen_placed: bool = False
    black_queen_placed: bool = False

    def clone(self) -> 'GameState':
        """Create a deep copy of the game state."""
        return GameState(
            board=[PlacedPiece(
                id=p.id, type=p.type, color=p.color,
                position=HexCoord(p.position.q, p.position.r),
                stack_order=p.stack_order
            ) for p in self.board],
            white_hand=[Piece(id=p.id, type=p.type, color=p.color) for p in self.white_hand],
            black_hand=[Piece(id=p.id, type=p.type, color=p.color) for p in self.black_hand],
            current_turn=self.current_turn,
            turn_number=self.turn_number,
            status=self.status,
            winner=self.winner,
            white_queen_placed=self.white_queen_placed,
            black_queen_placed=self.black_queen_placed,
        )


# =============================================================================
# Feature Extraction
# =============================================================================

DEFAULT_TOKEN_SLOTS = 32


def hex_distance(a: HexCoord, b: HexCoord) -> int:
    """Calculate hex grid distance between two coordinates."""
    return (abs(a.q - b.q) + abs(a.q + a.r - b.q - b.r) + abs(a.r - b.r)) // 2


def get_queen_surround_count(board: List[PlacedPiece], color: str) -> int:
    """Count how many pieces surround the queen of the given color."""
    queen = next((p for p in board if p.type == 'queen' and p.color == color), None)
    if queen is None:
        return 0

    occupied = {(p.position.q, p.position.r) for p in board}
    neighbors = queen.position.neighbors()
    return sum(1 for n in neighbors if (n.q, n.r) in occupied)


def clamp(value: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(max_val, value))


def extract_state_features(state: GameState, perspective: str, max_tokens: int = DEFAULT_TOKEN_SLOTS) -> List[float]:
    """Extract state features for the neural network."""
    my_queen = next((p for p in state.board if p.color == perspective and p.type == 'queen'), None)
    opp_queen = next((p for p in state.board if p.color != perspective and p.type == 'queen'), None)
    sorted_board = sorted(state.board, key=lambda p: p.id)

    features: List[float] = []

    # Token features (8 per token)
    for i in range(max_tokens):
        if i < len(sorted_board):
            piece = sorted_board[i]
            type_index = PIECE_TYPE_TO_INDEX.get(piece.type, 0)
            dist_center = hex_distance(piece.position, HexCoord(0, 0))
            dist_enemy_queen = hex_distance(piece.position, opp_queen.position) if opp_queen else 6
            dist_my_queen = hex_distance(piece.position, my_queen.position) if my_queen else 6

            features.extend([
                1 if piece.color == perspective else -1,  # mine
                clamp(type_index / (len(PIECE_TYPES) - 1), 0, 1),  # type
                math.tanh(piece.position.q / 5),  # q
                math.tanh(piece.position.r / 5),  # r
                clamp(piece.stack_order / 5, 0, 1),  # stack
                clamp(1 - dist_center / 10, -1, 1),  # dist_center
                clamp(1 - dist_enemy_queen / 8, -1, 1),  # dist_enemy_queen
                clamp(1 - dist_my_queen / 8, -1, 1),  # dist_my_queen
            ])
        else:
            features.extend([0, 0, 0, 0, 0, 0, 0, 0])

    # Global features (6)
    my_hand = len(state.white_hand) if perspective == 'white' else len(state.black_hand)
    opp_hand = len(state.black_hand) if perspective == 'white' else len(state.white_hand)
    opp_color = 'black' if perspective == 'white' else 'white'

    features.extend([
        1 if state.current_turn == perspective else -1,  # turn
        math.tanh((state.turn_number - 18) / 10),  # phase
        my_hand / 14,  # my_hand
        opp_hand / 14,  # opp_hand
        get_queen_surround_count(state.board, perspective) / 6,  # my_queen_surround
        get_queen_surround_count(state.board, opp_color) / 6,  # opp_queen_surround
    ])

    return [f if math.isfinite(f) else 0 for f in features]


def extract_action_features(state: GameState, move: Move, perspective: str) -> List[float]:
    """Extract action features for the neural network."""
    # Determine piece type
    if move.type == 'place':
        piece_type = move.piece_id.split('-')[0] if '-' in move.piece_id else 'queen'
    else:
        board_piece = next((p for p in state.board if p.id == move.piece_id), None)
        piece_type = board_piece.type if board_piece else 'queen'

    piece_bits = [1 if t == piece_type else 0 for t in PIECE_TYPES]
    my_queen = next((p for p in state.board if p.color == perspective and p.type == 'queen'), None)
    opp_color = 'black' if perspective == 'white' else 'white'
    opp_queen = next((p for p in state.board if p.color == opp_color and p.type == 'queen'), None)

    dist_center = hex_distance(move.to, HexCoord(0, 0))
    dist_enemy_queen = hex_distance(move.to, opp_queen.position) if opp_queen else 6
    dist_my_queen = hex_distance(move.to, my_queen.position) if my_queen else 6
    from_coord = move.from_pos if move.type == 'move' else None
    from_dist_center = hex_distance(from_coord, HexCoord(0, 0)) if from_coord else 0
    from_dist_enemy_queen = hex_distance(from_coord, opp_queen.position) if from_coord and opp_queen else 0
    from_dist_my_queen = hex_distance(from_coord, my_queen.position) if from_coord and my_queen else 0
    move_distance = hex_distance(from_coord, move.to) if from_coord else 0

    stacks_by_position: Dict[Tuple[int, int], Tuple[int, str, int]] = {}
    for piece in state.board:
        key = (piece.position.q, piece.position.r)
        count, top_color, top_order = stacks_by_position.get(key, (0, piece.color, -999))
        next_count = count + 1
        next_top_color = piece.color if piece.stack_order >= top_order else top_color
        next_top_order = max(top_order, piece.stack_order)
        stacks_by_position[key] = (next_count, next_top_color, next_top_order)

    to_neighbor_mine = 0
    to_neighbor_opp = 0
    to_neighbor_empty = 0
    for neighbor in move.to.neighbors():
        stack = stacks_by_position.get((neighbor.q, neighbor.r))
        if stack is None:
            to_neighbor_empty += 1
        elif stack[1] == perspective:
            to_neighbor_mine += 1
        else:
            to_neighbor_opp += 1

    to_stack_height = stacks_by_position.get((move.to.q, move.to.r), (0, perspective, 0))[0]
    to_adj_my_queen = 1 if my_queen and hex_distance(move.to, my_queen.position) == 1 else 0
    to_adj_opp_queen = 1 if opp_queen and hex_distance(move.to, opp_queen.position) == 1 else 0

    return [
        1 if move.type == 'place' else 0,  # is_place
        1 if move.type == 'move' else 0,  # is_move
        1 if move.is_pillbug_ability else 0,  # is_pillbug
        *piece_bits,  # piece type one-hot (8 values)
        math.tanh(move.to.q / 5),  # to_q
        math.tanh(move.to.r / 5),  # to_r
        clamp(1 - dist_center / 10, -1, 1),  # to_dist_origin
        clamp(1 - dist_enemy_queen / 8, -1, 1),  # to_dist_enemy_queen
        clamp(1 - dist_my_queen / 8, -1, 1),  # to_dist_my_queen
        get_queen_surround_count(state.board, perspective) / 6,  # my_queen_surround
        get_queen_surround_count(state.board, opp_color) / 6,  # opp_queen_surround
        math.tanh((state.turn_number - 18) / 10),  # turn_phase
        math.tanh(from_coord.q / 5) if from_coord else 0,  # from_q
        math.tanh(from_coord.r / 5) if from_coord else 0,  # from_r
        clamp(1 - from_dist_center / 10, -1, 1),  # from_dist_origin
        clamp(1 - from_dist_enemy_queen / 8, -1, 1),  # from_dist_enemy_queen
        clamp(1 - from_dist_my_queen / 8, -1, 1),  # from_dist_my_queen
        clamp(move_distance / 6, 0, 1),  # move_distance
        to_neighbor_mine / 6,  # to_neighbor_mine
        to_neighbor_opp / 6,  # to_neighbor_opp
        to_neighbor_empty / 6,  # to_neighbor_empty
        to_adj_my_queen,  # to_adj_my_queen
        to_adj_opp_queen,  # to_adj_opp_queen
        clamp(to_stack_height / 4, 0, 1),  # to_stack_height
    ]


def adapt_action_features(features: List[float], expected_size: int) -> List[float]:
    if len(features) >= expected_size:
        return features[:expected_size]
    return features + [0.0] * (expected_size - len(features))


# =============================================================================
# Neural Network Model
# =============================================================================

class PolicyValueNet(torch.nn.Module):
    """Policy-value network compatible with the existing model format."""

    def __init__(self, state_size: int, action_size: int, hidden: List[int]):
        super().__init__()
        layers: List[torch.nn.Module] = []
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

    def embed(self, state_tensor: torch.Tensor) -> torch.Tensor:
        return self.trunk(state_tensor)

    def value(self, embedding: torch.Tensor) -> torch.Tensor:
        return torch.tanh(self.value_head(embedding))

    def policy_logits(self, embedding: torch.Tensor, action_features: torch.Tensor) -> torch.Tensor:
        """Compute policy logits for a batch of actions."""
        joint = torch.cat([embedding, action_features], dim=-1)
        hidden = torch.tanh(self.policy_input_hidden(joint))
        hidden = torch.tanh(self.policy_hidden(hidden))
        logits = torch.matmul(hidden, self.policy_output_weights) + self.policy_bias
        return logits * self.policy_scale


def load_model(model_path: str, device: torch.device) -> Tuple[PolicyValueNet, int, int, List[int]]:
    """Load a model from JSON format."""
    with open(model_path, 'r', encoding='utf-8') as f:
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
    return model, state_size, action_size, hidden


# =============================================================================
# MCTS Implementation with GPU Batching
# =============================================================================

@dataclass
class MctsConfig:
    simulations: int = 220
    c_puct: float = 1.18
    dirichlet_alpha: float = 0.22
    dirichlet_epsilon: float = 0.06
    temperature: float = 0.5
    policy_prune_top_k: int = 14
    policy_prune_min_prob: float = 0.001
    forced_playouts: float = 3.0
    max_depth: int = 180
    virtual_loss: float = 1.0
    batch_size: int = 64  # Number of leaves to batch for GPU inference


@dataclass
class MctsEdge:
    action_key: str
    move: Move
    prior: float
    visit_count: int = 0
    value_sum: float = 0.0
    virtual_loss_count: int = 0
    child: Optional['MctsNode'] = None


@dataclass
class MctsNode:
    state: GameState
    state_hash: str
    to_play: str
    visit_count: int = 0
    value_sum: float = 0.0
    expanded: bool = False
    edges: Dict[str, MctsEdge] = field(default_factory=dict)
    policy_entropy: float = 0.0


def hash_state(state: GameState) -> str:
    """Create a hash of the game state for transposition table."""
    board_str = '|'.join(
        f"{p.id}:{p.position.q},{p.position.r}:{p.stack_order}"
        for p in sorted(state.board, key=lambda x: x.id)
    )
    key = f"{board_str}|{state.current_turn}|{state.turn_number}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def terminal_value(state: GameState, perspective: str) -> float:
    """Return terminal value from perspective's view."""
    if state.winner == 'draw':
        return 0.0
    elif state.winner == perspective:
        return 1.0
    elif state.winner is not None:
        return -1.0
    return 0.0


def sample_dirichlet(n: int, alpha: float, rng: random.Random) -> List[float]:
    """Sample from Dirichlet distribution."""
    samples = [rng.gammavariate(alpha, 1.0) for _ in range(n)]
    total = sum(samples)
    return [s / total if total > 0 else 1.0 / n for s in samples]


def softmax(logits: List[float]) -> List[float]:
    """Compute softmax probabilities."""
    if not logits:
        return []
    max_logit = max(logits)
    exp_logits = [math.exp(l - max_logit) for l in logits]
    total = sum(exp_logits)
    return [e / total if total > 0 else 1.0 / len(logits) for e in exp_logits]


def softmax_entropy(probs: List[float]) -> float:
    """Compute entropy of a probability distribution."""
    entropy = 0.0
    for p in probs:
        if p > 1e-9:
            entropy -= p * math.log(p)
    return entropy


@dataclass
class BatchedLeaf:
    """Represents a leaf node waiting for neural network evaluation."""
    node: MctsNode
    path_nodes: List[MctsNode]
    path_edges: List[MctsEdge]
    legal_moves: List[Move]


class GpuMcts:
    """
    GPU-accelerated MCTS that batches leaf evaluations.

    Instead of evaluating one leaf at a time, this implementation:
    1. Collects multiple leaves during tree traversal
    2. Batches them together for GPU inference
    3. Distributes results back and backpropagates
    """

    def __init__(
        self,
        model: PolicyValueNet,
        device: torch.device,
        config: MctsConfig,
        legal_move_generator,  # Function: (GameState, str) -> List[Move]
        move_executor,  # Function: (GameState, Move) -> GameState
        seed: int = 42,
    ):
        self.model = model
        self.device = device
        self.config = config
        self.get_legal_moves = legal_move_generator
        self.execute_move = move_executor
        self.rng = random.Random(seed)
        self.transposition: Dict[str, MctsNode] = {}

    def search(self, state: GameState, perspective: str) -> Tuple[Move, List[Dict], Dict]:
        """
        Run MCTS search and return the selected move, policy, and stats.

        Returns:
            - selected_move: The chosen move
            - policy: List of {action_key, move, visits, probability, prior, q_value}
            - stats: Search statistics
        """
        start_time = time.time()
        self.transposition.clear()

        # Create root node
        root_hash = hash_state(state)
        root = MctsNode(
            state=state,
            state_hash=root_hash,
            to_play=perspective,
        )
        self.transposition[root_hash] = root

        # Expand root immediately
        self._expand_single(root, is_root=True)

        nodes_expanded = 1
        depth_sum = 0
        simulations_done = 0

        # Run simulations in batches
        while simulations_done < self.config.simulations:
            batch_size = min(self.config.batch_size, self.config.simulations - simulations_done)
            leaves = self._collect_leaves(root, batch_size)

            if not leaves:
                break

            # Batch evaluate leaves
            if leaves:
                self._batch_evaluate_and_expand(leaves)
                nodes_expanded += len(leaves)

            # Backpropagate
            for leaf in leaves:
                self._backpropagate(leaf)
                depth_sum += len(leaf.path_edges)
                simulations_done += 1

        # Build policy from root edges
        policy = self._build_policy(root)
        selected_move = self._select_move(policy)

        elapsed = time.time() - start_time
        stats = {
            'engine': 'alphazero-gpu',
            'simulations': simulations_done,
            'nodes_expanded': nodes_expanded,
            'nodes_per_second': nodes_expanded / max(0.001, elapsed),
            'average_simulation_depth': depth_sum / max(1, simulations_done),
            'policy_entropy': softmax_entropy([p['probability'] for p in policy]),
            'root_value': root.value_sum / max(1, root.visit_count),
            'batch_size': self.config.batch_size,
            'elapsed_seconds': elapsed,
        }

        return selected_move, policy, stats

    def _collect_leaves(self, root: MctsNode, batch_size: int) -> List[BatchedLeaf]:
        """Collect multiple leaf nodes for batched evaluation."""
        leaves: List[BatchedLeaf] = []

        for _ in range(batch_size):
            path_nodes = [root]
            path_edges: List[MctsEdge] = []
            node = root
            depth = 0

            # Selection: traverse tree to leaf
            while (
                node.expanded
                and node.edges
                and node.state.status == 'playing'
                and depth < self.config.max_depth
            ):
                edge = self._select_edge(node)
                if edge is None:
                    break

                # Apply virtual loss
                edge.virtual_loss_count += 1
                path_edges.append(edge)

                # Get or create child
                if edge.child is None:
                    next_state = self.execute_move(node.state.clone(), edge.move)
                    next_hash = hash_state(next_state)

                    if next_hash in self.transposition:
                        edge.child = self.transposition[next_hash]
                    else:
                        edge.child = MctsNode(
                            state=next_state,
                            state_hash=next_hash,
                            to_play=next_state.current_turn,
                        )
                        self.transposition[next_hash] = edge.child

                node = edge.child
                path_nodes.append(node)
                depth += 1

            # Check if this is a valid leaf to expand
            if node.state.status == 'finished':
                # Terminal node - backprop immediately
                value = terminal_value(node.state, node.to_play)
                self._backpropagate_value(path_nodes, path_edges, value)
                continue
            elif depth >= self.config.max_depth:
                # Max depth - use heuristic value
                value = 0.0  # Could add heuristic here
                self._backpropagate_value(path_nodes, path_edges, value)
                continue
            elif node.expanded:
                # Already expanded, shouldn't happen often
                continue

            # Get legal moves for this leaf
            legal_moves = self.get_legal_moves(node.state, node.to_play)
            if not legal_moves:
                self._backpropagate_value(path_nodes, path_edges, -1.0)
                continue

            leaves.append(BatchedLeaf(
                node=node,
                path_nodes=path_nodes,
                path_edges=path_edges,
                legal_moves=legal_moves,
            ))

        return leaves

    def _batch_evaluate_and_expand(self, leaves: List[BatchedLeaf]) -> None:
        """Evaluate multiple leaves in a single GPU batch."""
        if not leaves:
            return

        # Prepare state features batch
        state_features_list = []
        for leaf in leaves:
            features = extract_state_features(leaf.node.state, leaf.node.to_play)
            state_features_list.append(features)

        state_tensor = torch.tensor(state_features_list, dtype=torch.float32, device=self.device)

        # Forward pass for embeddings and values
        with torch.no_grad():
            embeddings = self.model.embed(state_tensor)
            values = self.model.value(embeddings).squeeze(-1).cpu().numpy()

        # For each leaf, compute policy logits and expand
        for i, leaf in enumerate(leaves):
            embedding = embeddings[i:i+1]
            value = float(values[i])
            self._expand_leaf(leaf, embedding, value)

    def _expand_leaf(self, leaf: BatchedLeaf, embedding: torch.Tensor, value: float) -> None:
        """Expand a single leaf node using precomputed embedding."""
        node = leaf.node
        legal_moves = leaf.legal_moves
        is_root = len(leaf.path_edges) == 0

        # Compute action features for all legal moves
        action_features_list = []
        for move in legal_moves:
            features = adapt_action_features(
                extract_action_features(node.state, move, node.to_play),
                self.model.policy_action_hidden.in_features,
            )
            action_features_list.append(features)

        action_tensor = torch.tensor(action_features_list, dtype=torch.float32, device=self.device)

        # Compute policy logits
        with torch.no_grad():
            # Expand embedding to match number of actions
            expanded_embedding = embedding.expand(len(legal_moves), -1)
            logits = self.model.policy_logits(expanded_embedding, action_tensor).cpu().numpy()

        # Build candidates sorted by logit
        candidates = sorted(
            [(move, logits[i]) for i, move in enumerate(legal_moves)],
            key=lambda x: x[1],
            reverse=True,
        )

        # Prune and normalize
        top_k = candidates[:self.config.policy_prune_top_k]
        priors = softmax([c[1] for c in top_k])
        priors = [(top_k[i][0], p) for i, p in enumerate(priors) if p >= self.config.policy_prune_min_prob]

        if not priors:
            priors = [(top_k[0][0], 1.0)]

        # Apply Dirichlet noise at root
        if is_root and len(priors) > 1 and self.config.dirichlet_epsilon > 0:
            noise = sample_dirichlet(len(priors), self.config.dirichlet_alpha, self.rng)
            eps = self.config.dirichlet_epsilon
            priors = [
                (move, prior * (1 - eps) + noise[i] * eps)
                for i, (move, prior) in enumerate(priors)
            ]

        # Normalize priors
        prior_sum = sum(p for _, p in priors)
        priors = [(move, p / prior_sum) for move, p in priors]

        # Create edges
        node.edges = {}
        for move, prior in priors:
            action_key = move.to_action_key()
            node.edges[action_key] = MctsEdge(
                action_key=action_key,
                move=move,
                prior=prior,
            )

        node.policy_entropy = softmax_entropy([p for _, p in priors])
        node.expanded = True

        # Store value for backpropagation
        leaf.node._pending_value = clamp(value, -1, 1)

    def _expand_single(self, node: MctsNode, is_root: bool = False) -> float:
        """Expand a single node (used for root expansion)."""
        legal_moves = self.get_legal_moves(node.state, node.to_play)
        if not legal_moves:
            node.expanded = True
            return -1.0

        # Extract features
        state_features = extract_state_features(node.state, node.to_play)
        state_tensor = torch.tensor([state_features], dtype=torch.float32, device=self.device)

        action_features_list = [
            adapt_action_features(
                extract_action_features(node.state, move, node.to_play),
                self.model.policy_action_hidden.in_features,
            )
            for move in legal_moves
        ]
        action_tensor = torch.tensor(action_features_list, dtype=torch.float32, device=self.device)

        # Forward pass
        with torch.no_grad():
            embedding = self.model.embed(state_tensor)
            value = float(self.model.value(embedding).item())

            expanded_embedding = embedding.expand(len(legal_moves), -1)
            logits = self.model.policy_logits(expanded_embedding, action_tensor).cpu().numpy()

        # Build candidates
        candidates = sorted(
            [(move, logits[i]) for i, move in enumerate(legal_moves)],
            key=lambda x: x[1],
            reverse=True,
        )

        top_k = candidates[:self.config.policy_prune_top_k]
        priors = softmax([c[1] for c in top_k])
        priors = [(top_k[i][0], p) for i, p in enumerate(priors) if p >= self.config.policy_prune_min_prob]

        if not priors:
            priors = [(top_k[0][0], 1.0)]

        if is_root and len(priors) > 1 and self.config.dirichlet_epsilon > 0:
            noise = sample_dirichlet(len(priors), self.config.dirichlet_alpha, self.rng)
            eps = self.config.dirichlet_epsilon
            priors = [
                (move, prior * (1 - eps) + noise[i] * eps)
                for i, (move, prior) in enumerate(priors)
            ]

        prior_sum = sum(p for _, p in priors)
        priors = [(move, p / prior_sum) for move, p in priors]

        node.edges = {}
        for move, prior in priors:
            action_key = move.to_action_key()
            node.edges[action_key] = MctsEdge(
                action_key=action_key,
                move=move,
                prior=prior,
            )

        node.policy_entropy = softmax_entropy([p for _, p in priors])
        node.expanded = True
        return clamp(value, -1, 1)

    def _select_edge(self, node: MctsNode) -> Optional[MctsEdge]:
        """Select edge using PUCT formula."""
        best_edge = None
        best_score = float('-inf')
        sqrt_visits = math.sqrt(node.visit_count + 1)

        for edge in node.edges.values():
            effective_visits = edge.visit_count + edge.virtual_loss_count
            q_value = edge.value_sum / effective_visits if effective_visits > 0 else 0
            u_value = self.config.c_puct * edge.prior * sqrt_visits / (1 + effective_visits)
            score = q_value + u_value

            if score > best_score:
                best_score = score
                best_edge = edge

        return best_edge

    def _backpropagate(self, leaf: BatchedLeaf) -> None:
        """Backpropagate value through the tree."""
        value = getattr(leaf.node, '_pending_value', 0.0)
        self._backpropagate_value(leaf.path_nodes, leaf.path_edges, value)

    def _backpropagate_value(
        self,
        path_nodes: List[MctsNode],
        path_edges: List[MctsEdge],
        value: float,
    ) -> None:
        """Backpropagate a value through the path."""
        backed_value = value

        for i in range(len(path_nodes) - 1, -1, -1):
            node = path_nodes[i]
            node.visit_count += 1
            node.value_sum += backed_value

            if i > 0:
                edge = path_edges[i - 1]
                parent_value = -backed_value
                edge.visit_count += 1
                edge.value_sum += parent_value
                edge.virtual_loss_count = max(0, edge.virtual_loss_count - 1)
                backed_value = parent_value

    def _build_policy(self, root: MctsNode) -> List[Dict]:
        """Build policy from root node edges."""
        policy_entries = []
        for action_key, edge in root.edges.items():
            forced_floor = int(self.config.forced_playouts * edge.prior * self.config.simulations)
            adjusted_visits = max(edge.visit_count, forced_floor)
            q_value = edge.value_sum / edge.visit_count if edge.visit_count > 0 else 0

            policy_entries.append({
                'action_key': action_key,
                'move': edge.move,
                'visits': adjusted_visits,
                'raw_visits': edge.visit_count,
                'prior': edge.prior,
                'q_value': q_value,
            })

        policy_entries.sort(key=lambda x: (x['visits'], x['prior']), reverse=True)

        # Apply temperature
        total_visits = sum(e['visits'] for e in policy_entries)
        temperature = max(0.01, self.config.temperature)

        weights = []
        for entry in policy_entries:
            w = math.pow(max(1e-6, entry['visits'] / max(1, total_visits)), 1 / temperature)
            weights.append(w)

        weight_sum = sum(weights)
        for i, entry in enumerate(policy_entries):
            entry['probability'] = weights[i] / weight_sum if weight_sum > 0 else 1.0 / len(policy_entries)

        return policy_entries

    def _select_move(self, policy: List[Dict]) -> Optional[Move]:
        """Select move from policy."""
        if not policy:
            return None

        if self.config.temperature <= 0.05:
            return policy[0]['move']

        pick = self.rng.random()
        cumulative = 0.0
        for entry in policy:
            cumulative += entry['probability']
            if pick <= cumulative:
                return entry['move']

        return policy[0]['move']


# =============================================================================
# Utility Functions
# =============================================================================

def get_device(device_str: str = 'auto') -> torch.device:
    """Resolve device string to torch.device."""
    if device_str == 'auto':
        return torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    return torch.device(device_str)


def create_mcts_config(
    difficulty: str = 'extreme',
    simulations: Optional[int] = None,
    temperature: Optional[float] = None,
) -> MctsConfig:
    """Create MCTS config based on difficulty."""
    configs = {
        'medium': MctsConfig(
            simulations=64, c_puct=1.3, dirichlet_alpha=0.35, dirichlet_epsilon=0.22,
            temperature=1.0, policy_prune_top_k=18, forced_playouts=2, max_depth=90,
        ),
        'hard': MctsConfig(
            simulations=140, c_puct=1.25, dirichlet_alpha=0.28, dirichlet_epsilon=0.12,
            temperature=0.5, policy_prune_top_k=16, forced_playouts=2, max_depth=120,
        ),
        'extreme': MctsConfig(
            simulations=260, c_puct=1.18, dirichlet_alpha=0.22, dirichlet_epsilon=0.06,
            temperature=0.5, policy_prune_top_k=14, forced_playouts=3, max_depth=180,
        ),
    }

    config = configs.get(difficulty, configs['extreme'])
    if simulations is not None:
        config.simulations = simulations
    if temperature is not None:
        config.temperature = temperature
    return config
