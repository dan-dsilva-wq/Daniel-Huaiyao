import { generateRandomSetup, isLake } from './constants';
import {
  CombatResult,
  GameState,
  MoveHistoryEntry,
  Piece,
  PieceRank,
  TeamColor,
  WinReason,
} from './types';

export type ComputerDifficulty = 'medium' | 'hard' | 'extreme';

export interface LocalStrategoState {
  id: string;
  status: 'setup' | 'playing' | 'finished';
  currentTurn: TeamColor;
  turnNumber: number;
  redPieces: Piece[];
  bluePieces: Piece[];
  redCaptured: Piece[];
  blueCaptured: Piece[];
  moveHistory: MoveHistoryEntry[];
  winner: TeamColor | null;
  winReason: WinReason | null;
  createdAt: string;
  updatedAt: string;
}

export interface StrategicMove {
  pieceId: string;
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  attackerRank: PieceRank;
  defenderRank: PieceRank | null;
  isAttack: boolean;
}

interface AppliedMoveResult {
  state: LocalStrategoState;
  combatResult: CombatResult | null;
  attackerRank: PieceRank;
  defenderRank: PieceRank | null;
  gameOver: boolean;
  winner: TeamColor | null;
  winReason: WinReason | null;
}

interface SearchConfig {
  depth: number;
  rootBeamWidth: number;
  childBeamWidth: number;
  maxNodes: number;
  timeBudgetMs: number;
  exploreTopMoves: number;
  explorationChance: number;
}

interface SearchContext {
  config: SearchConfig;
  startedAtMs: number;
  nodesEvaluated: number;
}

const PIECE_VALUES: Record<PieceRank, number> = {
  0: 40000,
  1: 140,
  2: 120,
  3: 230,
  4: 300,
  5: 380,
  6: 470,
  7: 560,
  8: 680,
  9: 860,
  10: 1100,
  11: 190,
};

const DIFFICULTY_CONFIG: Record<ComputerDifficulty, SearchConfig> = {
  medium: {
    depth: 1,
    rootBeamWidth: 14,
    childBeamWidth: 10,
    maxNodes: 1000,
    timeBudgetMs: 180,
    exploreTopMoves: 4,
    explorationChance: 0.3,
  },
  hard: {
    depth: 2,
    rootBeamWidth: 18,
    childBeamWidth: 14,
    maxNodes: 5500,
    timeBudgetMs: 650,
    exploreTopMoves: 3,
    explorationChance: 0.1,
  },
  extreme: {
    depth: 3,
    rootBeamWidth: 24,
    childBeamWidth: 16,
    maxNodes: 14000,
    timeBudgetMs: 1500,
    exploreTopMoves: 1,
    explorationChance: 0,
  },
};

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function createComputerGameState(): LocalStrategoState {
  const now = new Date().toISOString();
  return {
    id: `local-${Date.now()}`,
    status: 'setup',
    currentTurn: 'red',
    turnNumber: 0,
    redPieces: [],
    bluePieces: [],
    redCaptured: [],
    blueCaptured: [],
    moveHistory: [],
    winner: null,
    winReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function startComputerGame(
  playerPieces: Piece[],
  difficulty: ComputerDifficulty,
): LocalStrategoState {
  const aiPieces = generateComputerSetup(difficulty);
  const now = new Date().toISOString();

  return {
    id: `local-${Date.now()}`,
    status: 'playing',
    currentTurn: 'red',
    turnNumber: 1,
    redPieces: playerPieces.map((piece) => ({
      ...piece,
      revealed: piece.revealed ?? false,
    })),
    bluePieces: aiPieces,
    redCaptured: [],
    blueCaptured: [],
    moveHistory: [],
    winner: null,
    winReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function toComputerGameView(
  localState: LocalStrategoState,
  currentUser: string | null,
): GameState {
  const safeUser = currentUser === 'huaiyao' ? 'huaiyao' : 'daniel';

  return {
    id: localState.id,
    status: localState.status,
    player_red: safeUser,
    player_blue: 'computer',
    my_color: 'red',
    current_turn: localState.currentTurn,
    turn_number: localState.turnNumber,
    red_setup_done: localState.redPieces.length === 40,
    blue_setup_done: localState.bluePieces.length === 40,
    my_pieces: localState.redPieces,
    opponent_pieces: localState.bluePieces.map((piece) => ({
      id: piece.id,
      rank: localState.status === 'finished' || piece.revealed ? piece.rank : -1,
      row: piece.row,
      col: piece.col,
      revealed: localState.status === 'finished' ? true : piece.revealed,
    })),
    red_captured: localState.redCaptured,
    blue_captured: localState.blueCaptured,
    move_history: localState.moveHistory,
    winner: localState.winner,
    win_reason: localState.winReason,
    created_at: localState.createdAt,
    updated_at: localState.updatedAt,
  };
}

export function chooseComputerMove(
  state: LocalStrategoState,
  difficulty: ComputerDifficulty,
): StrategicMove | null {
  if (state.status !== 'playing' || state.currentTurn !== 'blue') return null;

  const allMoves = generateMovesForColor(state, 'blue');
  if (allMoves.length === 0) return null;

  const config = DIFFICULTY_CONFIG[difficulty];
  const context: SearchContext = {
    config,
    startedAtMs: Date.now(),
    nodesEvaluated: 0,
  };

  const orderedMoves = orderMoves(state, allMoves, 'blue', 'blue')
    .slice(0, config.rootBeamWidth);

  const scoredMoves = orderedMoves.map((move) => {
    const result = applyStrategoMoveInternal(state, 'blue', move, false);
    const minimaxScore = minimax(
      result.state,
      config.depth - 1,
      'red',
      'blue',
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      context,
    );

    return {
      move,
      score: minimaxScore,
    };
  });

  scoredMoves.sort((left, right) => right.score - left.score);

  if (scoredMoves.length === 0) return allMoves[Math.floor(Math.random() * allMoves.length)] ?? null;

  if (
    config.exploreTopMoves > 1
    && config.explorationChance > 0
    && Math.random() < config.explorationChance
  ) {
    const options = scoredMoves.slice(0, config.exploreTopMoves);
    const bestScore = options[0].score;
    const weights = options.map((option) => Math.exp((option.score - bestScore) / 180));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const randomValue = Math.random() * totalWeight;
    let cumulative = 0;

    for (let index = 0; index < options.length; index += 1) {
      cumulative += weights[index];
      if (randomValue <= cumulative) {
        return options[index].move;
      }
    }
  }

  return scoredMoves[0].move;
}

export function applyStrategoMove(
  state: LocalStrategoState,
  color: TeamColor,
  move: Pick<StrategicMove, 'pieceId' | 'toRow' | 'toCol'>,
): AppliedMoveResult {
  const legalMoves = generateMovesForColor(state, color);
  const selectedMove = legalMoves.find((candidate) => (
    candidate.pieceId === move.pieceId
      && candidate.toRow === move.toRow
      && candidate.toCol === move.toCol
  ));

  if (!selectedMove) {
    throw new Error('Illegal Stratego move attempted');
  }

  return applyStrategoMoveInternal(state, color, selectedMove, true);
}

export function hasAnyMoves(state: LocalStrategoState, color: TeamColor): boolean {
  return generateMovesForColor(state, color).length > 0;
}

function minimax(
  state: LocalStrategoState,
  depth: number,
  activeColor: TeamColor,
  maximizingColor: TeamColor,
  alpha: number,
  beta: number,
  context: SearchContext,
): number {
  context.nodesEvaluated += 1;

  if (state.status === 'finished') {
    if (!state.winner) return 0;
    return state.winner === maximizingColor ? 80000 - depth : -80000 + depth;
  }

  if (depth <= 0 || shouldCutSearch(context)) {
    return evaluateState(state, maximizingColor);
  }

  const moves = generateMovesForColor(state, activeColor);
  if (moves.length === 0) {
    return activeColor === maximizingColor ? -70000 : 70000;
  }

  const orderedMoves = orderMoves(state, moves, activeColor, maximizingColor)
    .slice(0, context.config.childBeamWidth);

  if (activeColor === maximizingColor) {
    let value = Number.NEGATIVE_INFINITY;
    for (const move of orderedMoves) {
      const nextState = applyStrategoMoveInternal(state, activeColor, move, false).state;
      value = Math.max(
        value,
        minimax(nextState, depth - 1, flipColor(activeColor), maximizingColor, alpha, beta, context),
      );
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  }

  let value = Number.POSITIVE_INFINITY;
  for (const move of orderedMoves) {
    const nextState = applyStrategoMoveInternal(state, activeColor, move, false).state;
    value = Math.min(
      value,
      minimax(nextState, depth - 1, flipColor(activeColor), maximizingColor, alpha, beta, context),
    );
    beta = Math.min(beta, value);
    if (beta <= alpha) break;
  }
  return value;
}

function shouldCutSearch(context: SearchContext): boolean {
  if (context.nodesEvaluated >= context.config.maxNodes) return true;
  return Date.now() - context.startedAtMs >= context.config.timeBudgetMs;
}

function evaluateState(state: LocalStrategoState, perspective: TeamColor): number {
  const myPieces = getPieces(state, perspective);
  const oppPieces = getPieces(state, flipColor(perspective));

  const myFlag = myPieces.find((piece) => piece.rank === 0);
  const oppFlag = oppPieces.find((piece) => piece.rank === 0);

  let materialScore = 0;
  for (const piece of myPieces) {
    materialScore += PIECE_VALUES[piece.rank];
    if (!piece.revealed && piece.rank >= 8) materialScore += 8;
  }
  for (const piece of oppPieces) {
    materialScore -= PIECE_VALUES[piece.rank];
    if (!piece.revealed && piece.rank >= 8) materialScore -= 8;
  }

  const myMoves = generateMovesForColor(state, perspective).length;
  const oppMoves = generateMovesForColor(state, flipColor(perspective)).length;
  const mobilityScore = (myMoves - oppMoves) * 18;

  const myProgress = progressionScore(myPieces, perspective);
  const oppProgress = progressionScore(oppPieces, flipColor(perspective));

  const myCenter = centerControlScore(myPieces);
  const oppCenter = centerControlScore(oppPieces);

  const myFlagSafety = flagSafetyScore(myFlag, myPieces);
  const oppFlagSafety = flagSafetyScore(oppFlag, oppPieces);

  const pressureScore = flagPressureScore(myPieces, oppFlag, perspective)
    - flagPressureScore(oppPieces, myFlag, flipColor(perspective));

  const tacticalScore = immediateThreatScore(state, perspective);

  return (
    materialScore
    + mobilityScore
    + (myProgress - oppProgress) * 6
    + (myCenter - oppCenter) * 10
    + (myFlagSafety - oppFlagSafety) * 28
    + pressureScore * 22
    + tacticalScore
  );
}

function progressionScore(pieces: Piece[], color: TeamColor): number {
  return pieces.reduce((score, piece) => {
    if (piece.rank === 0 || piece.rank === 11) return score;
    const progress = color === 'red' ? 9 - piece.row : piece.row;
    const rankWeight = piece.rank <= 3 ? 1 : 0.65;
    return score + progress * rankWeight;
  }, 0);
}

function centerControlScore(pieces: Piece[]): number {
  return pieces.reduce((score, piece) => {
    const distance = Math.abs(4.5 - piece.row) + Math.abs(4.5 - piece.col);
    const contribution = Math.max(0, 4.8 - distance);
    if (piece.rank === 0 || piece.rank === 11) return score + contribution * 0.3;
    return score + contribution;
  }, 0);
}

function flagSafetyScore(flag: Piece | undefined, pieces: Piece[]): number {
  if (!flag) return -100;

  let score = 0;
  const occupied = new Map<string, Piece>();
  for (const piece of pieces) {
    occupied.set(cellKey(piece.row, piece.col), piece);
  }

  for (const [dr, dc] of DIRECTIONS) {
    const row = flag.row + dr;
    const col = flag.col + dc;
    if (!isInsideBoard(row, col)) continue;
    const adjacent = occupied.get(cellKey(row, col));
    if (!adjacent) continue;
    if (adjacent.rank === 11) score += 2.4;
    else if (adjacent.rank >= 7) score += 1.2;
    else if (adjacent.rank >= 4) score += 0.6;
  }

  if (flag.row === 0 || flag.row === 9) score += 0.9;
  if (flag.col === 0 || flag.col === 9) score += 0.7;

  return score;
}

function flagPressureScore(pieces: Piece[], enemyFlag: Piece | undefined, color: TeamColor): number {
  if (!enemyFlag) return 0;

  let bestDistance = Number.POSITIVE_INFINITY;
  let pressure = 0;

  for (const piece of pieces) {
    if (piece.rank === 0 || piece.rank === 11) continue;
    const distance = Math.abs(piece.row - enemyFlag.row) + Math.abs(piece.col - enemyFlag.col);
    bestDistance = Math.min(bestDistance, distance);

    if (distance <= 3) {
      pressure += piece.rank >= 6 ? 2.4 : 1.2;
    }

    if (color === 'red' && piece.row <= 3) pressure += 0.35;
    if (color === 'blue' && piece.row >= 6) pressure += 0.35;
  }

  if (!Number.isFinite(bestDistance)) return pressure;
  return pressure + Math.max(0, 9 - bestDistance) * 0.6;
}

function immediateThreatScore(state: LocalStrategoState, perspective: TeamColor): number {
  let score = 0;
  const myPieces = getPieces(state, perspective);
  const oppPieces = getPieces(state, flipColor(perspective));

  for (const myPiece of myPieces) {
    if (myPiece.rank === 0 || myPiece.rank === 11) continue;
    for (const [dr, dc] of DIRECTIONS) {
      const adjacentRow = myPiece.row + dr;
      const adjacentCol = myPiece.col + dc;
      const enemy = oppPieces.find(
        (piece) => piece.row === adjacentRow && piece.col === adjacentCol,
      );
      if (!enemy) continue;

      const outcome = resolveCombat(myPiece.rank, enemy.rank);
      if (outcome === 'attacker_wins') {
        score += PIECE_VALUES[enemy.rank] * 0.05;
      } else if (outcome === 'defender_wins' && enemy.rank >= 7) {
        score -= PIECE_VALUES[myPiece.rank] * 0.03;
      }
    }
  }

  return score;
}

function orderMoves(
  state: LocalStrategoState,
  moves: StrategicMove[],
  activeColor: TeamColor,
  maximizingColor: TeamColor,
): StrategicMove[] {
  const ordered = [...moves];

  ordered.sort((left, right) => {
    const rightScore = tacticalMoveScore(state, right, activeColor, maximizingColor);
    const leftScore = tacticalMoveScore(state, left, activeColor, maximizingColor);
    return rightScore - leftScore;
  });

  return ordered;
}

function tacticalMoveScore(
  state: LocalStrategoState,
  move: StrategicMove,
  activeColor: TeamColor,
  maximizingColor: TeamColor,
): number {
  let score = 0;

  if (move.isAttack && move.defenderRank !== null) {
    const outcome = resolveCombat(move.attackerRank, move.defenderRank);
    if (move.defenderRank === 0) {
      score += 120000;
    } else if (outcome === 'attacker_wins') {
      score += PIECE_VALUES[move.defenderRank] - PIECE_VALUES[move.attackerRank] * 0.2;
    } else if (outcome === 'both_die') {
      score += (PIECE_VALUES[move.defenderRank] - PIECE_VALUES[move.attackerRank]) * 0.45;
    } else {
      score -= PIECE_VALUES[move.attackerRank] * 0.95;
    }
  }

  const rowDelta = activeColor === 'red'
    ? move.fromRow - move.toRow
    : move.toRow - move.fromRow;
  score += rowDelta * (move.attackerRank <= 3 ? 4.2 : 2.7);

  const centerDistanceBefore = Math.abs(4.5 - move.fromRow) + Math.abs(4.5 - move.fromCol);
  const centerDistanceAfter = Math.abs(4.5 - move.toRow) + Math.abs(4.5 - move.toCol);
  score += (centerDistanceBefore - centerDistanceAfter) * 1.6;

  if (move.attackerRank >= 9 && isEdgeSquare(move.toRow, move.toCol)) {
    score -= 8;
  }

  if (move.attackerRank === 3 && move.isAttack && move.defenderRank === 11) {
    score += 32;
  }

  const immediateState = applyStrategoMoveInternal(state, activeColor, move, false).state;
  if (immediateState.status === 'finished' && immediateState.winner === activeColor) {
    score += 140000;
  }

  return activeColor === maximizingColor ? score : -score;
}

function generateMovesForColor(state: LocalStrategoState, color: TeamColor): StrategicMove[] {
  const myPieces = getPieces(state, color);
  const oppPieces = getPieces(state, flipColor(color));
  const moves: StrategicMove[] = [];

  const myPositions = new Set<string>();
  const oppByPosition = new Map<string, Piece>();

  for (const piece of myPieces) {
    myPositions.add(cellKey(piece.row, piece.col));
  }

  for (const piece of oppPieces) {
    oppByPosition.set(cellKey(piece.row, piece.col), piece);
  }

  for (const piece of myPieces) {
    if (piece.rank === 0 || piece.rank === 11) continue;

    if (piece.rank === 2) {
      for (const [dr, dc] of DIRECTIONS) {
        for (let distance = 1; distance < 10; distance += 1) {
          const row = piece.row + dr * distance;
          const col = piece.col + dc * distance;
          if (!isInsideBoard(row, col)) break;
          if (isLake(row, col)) break;

          const targetKey = cellKey(row, col);
          if (myPositions.has(targetKey)) break;

          const defender = oppByPosition.get(targetKey);
          moves.push({
            pieceId: piece.id,
            fromRow: piece.row,
            fromCol: piece.col,
            toRow: row,
            toCol: col,
            attackerRank: piece.rank,
            defenderRank: defender?.rank ?? null,
            isAttack: !!defender,
          });

          if (defender) break;
        }
      }
    } else {
      for (const [dr, dc] of DIRECTIONS) {
        const row = piece.row + dr;
        const col = piece.col + dc;
        if (!isInsideBoard(row, col)) continue;
        if (isLake(row, col)) continue;

        const targetKey = cellKey(row, col);
        if (myPositions.has(targetKey)) continue;

        const defender = oppByPosition.get(targetKey);
        moves.push({
          pieceId: piece.id,
          fromRow: piece.row,
          fromCol: piece.col,
          toRow: row,
          toCol: col,
          attackerRank: piece.rank,
          defenderRank: defender?.rank ?? null,
          isAttack: !!defender,
        });
      }
    }
  }

  return moves;
}

function applyStrategoMoveInternal(
  state: LocalStrategoState,
  color: TeamColor,
  move: StrategicMove,
  includeTimestampUpdate: boolean,
): AppliedMoveResult {
  const myPieces = [...getPieces(state, color)];
  const oppPieces = [...getPieces(state, flipColor(color))];

  const attackerIndex = myPieces.findIndex((piece) => piece.id === move.pieceId);
  if (attackerIndex === -1) {
    throw new Error('Attacking piece not found');
  }

  const attacker = myPieces[attackerIndex];
  const defenderIndex = oppPieces.findIndex(
    (piece) => piece.row === move.toRow && piece.col === move.toCol,
  );
  const defender = defenderIndex >= 0 ? oppPieces[defenderIndex] : null;

  const nextRedCaptured = [...state.redCaptured];
  const nextBlueCaptured = [...state.blueCaptured];

  let combatResult: CombatResult | null = null;
  let gameOver = false;
  let winner: TeamColor | null = null;
  let winReason: WinReason | null = null;

  if (defender) {
    combatResult = resolveCombat(attacker.rank, defender.rank);

    if (defender.rank === 0 && combatResult === 'attacker_wins') {
      gameOver = true;
      winner = color;
      winReason = 'flag_captured';
    }

    if (combatResult === 'attacker_wins') {
      myPieces[attackerIndex] = {
        ...attacker,
        row: move.toRow,
        col: move.toCol,
        revealed: true,
      };
      oppPieces.splice(defenderIndex, 1);

      if (color === 'red') {
        nextBlueCaptured.push(defender);
      } else {
        nextRedCaptured.push(defender);
      }
    } else if (combatResult === 'defender_wins') {
      myPieces.splice(attackerIndex, 1);
      oppPieces[defenderIndex] = { ...defender, revealed: true };

      if (color === 'red') {
        nextRedCaptured.push(attacker);
      } else {
        nextBlueCaptured.push(attacker);
      }
    } else {
      myPieces.splice(attackerIndex, 1);
      oppPieces.splice(defenderIndex, 1);

      if (color === 'red') {
        nextRedCaptured.push(attacker);
        nextBlueCaptured.push(defender);
      } else {
        nextBlueCaptured.push(attacker);
        nextRedCaptured.push(defender);
      }
    }
  } else {
    myPieces[attackerIndex] = {
      ...attacker,
      row: move.toRow,
      col: move.toCol,
    };
  }

  let nextState: LocalStrategoState = {
    ...state,
    redPieces: color === 'red' ? myPieces : oppPieces,
    bluePieces: color === 'blue' ? myPieces : oppPieces,
    redCaptured: nextRedCaptured,
    blueCaptured: nextBlueCaptured,
    moveHistory: [
      ...state.moveHistory,
      {
        turn: state.turnNumber,
        color,
        piece_id: move.pieceId,
        from_row: move.fromRow,
        from_col: move.fromCol,
        to_row: move.toRow,
        to_col: move.toCol,
        combat_result: combatResult,
        attacker_rank: move.attackerRank,
        defender_rank: defender?.rank ?? null,
      },
    ],
    updatedAt: includeTimestampUpdate ? new Date().toISOString() : state.updatedAt,
  };

  if (!gameOver) {
    const opponentColor = flipColor(color);
    const opponentHasMoves = hasAnyMoves(nextState, opponentColor);
    if (!opponentHasMoves) {
      gameOver = true;
      winner = color;
      winReason = 'no_moves';
    }
  }

  nextState = {
    ...nextState,
    status: gameOver ? 'finished' : 'playing',
    winner,
    winReason,
    currentTurn: gameOver ? color : flipColor(color),
    turnNumber: gameOver ? state.turnNumber : state.turnNumber + 1,
  };

  return {
    state: nextState,
    combatResult,
    attackerRank: move.attackerRank,
    defenderRank: defender?.rank ?? null,
    gameOver,
    winner,
    winReason,
  };
}

function generateComputerSetup(difficulty: ComputerDifficulty): Piece[] {
  if (difficulty === 'medium') {
    return normalizeGeneratedSetup(generateRandomSetup('blue'));
  }

  const piecesByRank: PieceRank[] = [];
  const counts: Record<PieceRank, number> = {
    0: 1,
    1: 1,
    2: 8,
    3: 5,
    4: 4,
    5: 4,
    6: 4,
    7: 3,
    8: 2,
    9: 1,
    10: 1,
    11: 6,
  };

  (Object.keys(counts) as unknown as PieceRank[]).forEach((rank) => {
    for (let index = 0; index < counts[rank]; index += 1) {
      piecesByRank.push(rank);
    }
  });

  const positions = createBlueSetupPositions();
  const assignment = new Map<string, PieceRank>();

  const flagTargets: Array<[number, number]> = difficulty === 'extreme'
    ? [[0, 0], [0, 9], [1, 1], [1, 8], [0, 4], [0, 5]]
    : [[0, 0], [0, 9], [0, 4], [0, 5], [1, 1], [1, 8]];

  const chosenFlagCell = pickRandom(flagTargets);
  setRankAt(assignment, chosenFlagCell[0], chosenFlagCell[1], 0, counts);

  const shieldCells = adjacentBlueCells(chosenFlagCell[0], chosenFlagCell[1])
    .filter(([row, col]) => row <= 3 && row >= 0 && col >= 0 && col <= 9);

  const bombShieldCount = difficulty === 'extreme' ? 4 : 3;
  shuffleInPlace(shieldCells);
  for (let index = 0; index < bombShieldCount && index < shieldCells.length; index += 1) {
    const [row, col] = shieldCells[index];
    if (!assignment.has(cellKey(row, col))) {
      setRankAt(assignment, row, col, 11, counts);
    }
  }

  if (difficulty === 'extreme') {
    const decoyBombTargets: Array<[number, number]> = [
      [0, 3], [0, 6], [1, 4], [1, 5], [2, 2], [2, 7],
    ];
    shuffleInPlace(decoyBombTargets);
    for (const [row, col] of decoyBombTargets) {
      if (counts[11] <= 0) break;
      if (!assignment.has(cellKey(row, col))) {
        setRankAt(assignment, row, col, 11, counts);
      }
    }
  }

  const scoutLanes: Array<[number, number]> = [
    [3, 0], [3, 1], [3, 2], [3, 3], [3, 6], [3, 7], [3, 8], [3, 9],
    [2, 4], [2, 5],
  ];
  shuffleInPlace(scoutLanes);
  while (counts[2] > 0 && scoutLanes.length > 0) {
    const position = scoutLanes.pop();
    if (!position) break;
    const [row, col] = position;
    if (!assignment.has(cellKey(row, col))) {
      setRankAt(assignment, row, col, 2, counts);
    }
  }

  const minerRows: Array<[number, number]> = [
    [2, 0], [2, 1], [2, 8], [2, 9], [1, 3], [1, 6], [2, 4], [2, 5],
  ];
  shuffleInPlace(minerRows);
  while (counts[3] > 0 && minerRows.length > 0) {
    const position = minerRows.pop();
    if (!position) break;
    const [row, col] = position;
    if (!assignment.has(cellKey(row, col))) {
      setRankAt(assignment, row, col, 3, counts);
    }
  }

  const rearStrongTargets: Array<[number, number]> = [
    [1, 4], [1, 5], [0, 2], [0, 7], [1, 2], [1, 7],
  ];
  const strongRanks: PieceRank[] = difficulty === 'extreme'
    ? [10, 9, 8, 8, 7]
    : [10, 9, 8, 7];

  shuffleInPlace(rearStrongTargets);
  for (const rank of strongRanks) {
    if (counts[rank] <= 0) continue;
    const slot = rearStrongTargets.pop();
    if (!slot) break;
    const [row, col] = slot;
    if (!assignment.has(cellKey(row, col))) {
      setRankAt(assignment, row, col, rank, counts);
    }
  }

  const remainingCells = positions.filter(([row, col]) => !assignment.has(cellKey(row, col)));
  shuffleInPlace(remainingCells);

  const remainingRanks = buildRemainingRanks(counts);
  shuffleInPlace(remainingRanks);

  for (let index = 0; index < remainingCells.length; index += 1) {
    const [row, col] = remainingCells[index];
    const rank = remainingRanks[index];
    assignment.set(cellKey(row, col), rank);
  }

  const setup = positions.map(([row, col], index) => ({
    id: `blue_ai_${index}`,
    rank: assignment.get(cellKey(row, col))!,
    row,
    col,
    revealed: false,
  }));

  return setup;
}

function normalizeGeneratedSetup(
  setup: Array<{ rank: PieceRank; row: number; col: number }>,
): Piece[] {
  return setup.map((piece, index) => ({
    id: `blue_ai_${index}`,
    rank: piece.rank,
    row: piece.row,
    col: piece.col,
    revealed: false,
  }));
}

function setRankAt(
  assignment: Map<string, PieceRank>,
  row: number,
  col: number,
  rank: PieceRank,
  counts: Record<PieceRank, number>,
): void {
  if (counts[rank] <= 0) return;
  assignment.set(cellKey(row, col), rank);
  counts[rank] -= 1;
}

function buildRemainingRanks(counts: Record<PieceRank, number>): PieceRank[] {
  const remaining: PieceRank[] = [];
  (Object.keys(counts) as unknown as PieceRank[]).forEach((rank) => {
    for (let index = 0; index < counts[rank]; index += 1) {
      remaining.push(rank);
    }
  });
  return remaining;
}

function createBlueSetupPositions(): Array<[number, number]> {
  const positions: Array<[number, number]> = [];
  for (let row = 0; row <= 3; row += 1) {
    for (let col = 0; col <= 9; col += 1) {
      positions.push([row, col]);
    }
  }
  return positions;
}

function adjacentBlueCells(row: number, col: number): Array<[number, number]> {
  return DIRECTIONS.map(([dr, dc]) => [row + dr, col + dc]);
}

function resolveCombat(attackerRank: PieceRank, defenderRank: PieceRank): CombatResult {
  if (defenderRank === 0) return 'attacker_wins';
  if (attackerRank === 1 && defenderRank === 10) return 'attacker_wins';

  if (defenderRank === 11) {
    return attackerRank === 3 ? 'attacker_wins' : 'defender_wins';
  }

  if (attackerRank > defenderRank) return 'attacker_wins';
  if (attackerRank === defenderRank) return 'both_die';
  return 'defender_wins';
}

function getPieces(state: LocalStrategoState, color: TeamColor): Piece[] {
  return color === 'red' ? state.redPieces : state.bluePieces;
}

function flipColor(color: TeamColor): TeamColor {
  return color === 'red' ? 'blue' : 'red';
}

function isInsideBoard(row: number, col: number): boolean {
  return row >= 0 && row <= 9 && col >= 0 && col <= 9;
}

function isEdgeSquare(row: number, col: number): boolean {
  return row === 0 || row === 9 || col === 0 || col === 9;
}

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffleInPlace<T>(items: T[]): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}
