import { blendHeuristicWithModel, evaluatePolicyValue, type HiveModel } from './ml';
import { getAllValidActions, executeMove } from './moveValidation';
import { getQueenSurroundCount } from './winCondition';
import { coordKey, getNeighbors, getTopPieceAt, hexDistance } from './hexUtils';
import { dedupeMovesByActionKey, moveToActionKey } from './actionEncoding';
import {
  createInitialHand,
  type GameState,
  type Move,
  type PlacedPiece,
  type PlayerColor,
} from './types';

export type HiveComputerDifficulty = 'medium' | 'hard' | 'extreme';
export type HiveSearchEngine = 'classic' | 'alphazero' | 'gumbel';

export interface HiveMctsConfig {
  simulations: number;
  cPuct: number;
  dirichletAlpha: number;
  dirichletEpsilon: number;
  temperature: number;
  policyPruneTopK: number;
  policyPruneMinProb: number;
  forcedPlayouts: number;
  maxDepth: number;
  useTranspositionTable: boolean;
  useGraphCache: boolean;
  graphBlend: number;
  graphNodeCap: number;
  graphEdgeCap: number;
}

export interface HiveSearchStats {
  engine: HiveSearchEngine;
  simulations: number;
  nodesExpanded: number;
  nodesPerSecond: number;
  averageSimulationDepth: number;
  policyEntropy: number;
  rootValue: number;
  graphNodeHits?: number;
  graphEdgeHits?: number;
  graphReuseRatio?: number;
}

interface MctsGraphCounter {
  visitCount: number;
  valueSum: number;
}

export interface HiveMctsGraphCache {
  nodeStats: Map<string, MctsGraphCounter>;
  edgeStats: Map<string, MctsGraphCounter>;
  nodeCap: number;
  edgeCap: number;
}

export interface HiveModelHandle {
  model?: HiveModel;
  graphCache?: HiveMctsGraphCache;
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
  modelOverride?: HiveModel;
  disableModelBlend?: boolean;
}

interface CandidateMove {
  move: Move;
  nextState: GameState;
  orderingScore: number;
}

export interface HiveMoveSelectionOptions {
  modelOverride?: HiveModel;
  disableModelBlend?: boolean;
  engine?: HiveSearchEngine;
  modelHandle?: HiveModelHandle;
  mctsConfig?: Partial<HiveMctsConfig>;
  randomSeed?: number;
  onSearchStats?: (stats: HiveSearchStats) => void;
}

const DIFFICULTY_CONFIG: Record<HiveComputerDifficulty, SearchConfig> = {
  medium: {
    depth: 1,
    rootBeamWidth: 18,
    childBeamWidth: 12,
    maxNodes: 1400,
    timeBudgetMs: 180,
    exploreTopMoves: 4,
    explorationChance: 0.32,
  },
  hard: {
    depth: 2,
    rootBeamWidth: 14,
    childBeamWidth: 10,
    maxNodes: 5500,
    timeBudgetMs: 700,
    exploreTopMoves: 3,
    explorationChance: 0.1,
  },
  extreme: {
    depth: 3,
    rootBeamWidth: 12,
    childBeamWidth: 8,
    maxNodes: 14000,
    timeBudgetMs: 1500,
    exploreTopMoves: 1,
    explorationChance: 0,
  },
};

const DEFAULT_MCTS_CONFIG_BY_DIFFICULTY: Record<HiveComputerDifficulty, HiveMctsConfig> = {
  medium: {
    simulations: 64,
    cPuct: 1.3,
    dirichletAlpha: 0.35,
    dirichletEpsilon: 0.22,
    temperature: 0.7,
    policyPruneTopK: 18,
    policyPruneMinProb: 0.004,
    forcedPlayouts: 2,
    maxDepth: 90,
    useTranspositionTable: true,
    useGraphCache: true,
    graphBlend: 0.14,
    graphNodeCap: 120000,
    graphEdgeCap: 600000,
  },
  hard: {
    simulations: 140,
    cPuct: 1.25,
    dirichletAlpha: 0.28,
    dirichletEpsilon: 0.12,
    temperature: 0.25,
    policyPruneTopK: 16,
    policyPruneMinProb: 0.002,
    forcedPlayouts: 2,
    maxDepth: 120,
    useTranspositionTable: true,
    useGraphCache: true,
    graphBlend: 0.2,
    graphNodeCap: 150000,
    graphEdgeCap: 750000,
  },
  extreme: {
    simulations: 260,
    cPuct: 1.18,
    dirichletAlpha: 0.22,
    dirichletEpsilon: 0.06,
    temperature: 0.02,
    policyPruneTopK: 14,
    policyPruneMinProb: 0.001,
    forcedPlayouts: 3,
    maxDepth: 180,
    useTranspositionTable: true,
    useGraphCache: true,
    graphBlend: 0.28,
    graphNodeCap: 200000,
    graphEdgeCap: 900000,
  },
};

const DEFAULT_GLOBAL_GRAPH_CACHE: HiveMctsGraphCache = {
  nodeStats: new Map<string, MctsGraphCounter>(),
  edgeStats: new Map<string, MctsGraphCounter>(),
  nodeCap: 200000,
  edgeCap: 900000,
};

export function createHiveMctsGraphCache(options?: {
  nodeCap?: number;
  edgeCap?: number;
}): HiveMctsGraphCache {
  return {
    nodeStats: new Map<string, MctsGraphCounter>(),
    edgeStats: new Map<string, MctsGraphCounter>(),
    nodeCap: Math.max(1000, Math.floor(options?.nodeCap ?? 200000)),
    edgeCap: Math.max(2000, Math.floor(options?.edgeCap ?? 900000)),
  };
}

export function createLocalHiveGameState(options?: {
  id?: string;
  shortCode?: string;
  whitePlayerId?: string | null;
  blackPlayerId?: string | null;
}): GameState {
  const expansions = { ladybug: false, mosquito: false, pillbug: false };
  return {
    id: options?.id ?? `local-${Date.now()}`,
    shortCode: options?.shortCode ?? 'LOCAL',
    status: 'playing',
    whitePlayerId: options?.whitePlayerId ?? 'player-1',
    blackPlayerId: options?.blackPlayerId ?? 'player-2',
    currentTurn: 'white',
    turnNumber: 1,
    settings: {
      turnTimerMinutes: 0,
      expansionPieces: expansions,
    },
    board: [],
    whiteHand: createInitialHand('white', expansions),
    blackHand: createInitialHand('black', expansions),
    whiteQueenPlaced: false,
    blackQueenPlaced: false,
    lastMovedPiece: null,
    turnStartedAt: null,
    winner: null,
    createdAt: new Date().toISOString(),
  };
}

export function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    settings: {
      ...state.settings,
      expansionPieces: { ...state.settings.expansionPieces },
    },
    board: state.board.map((piece) => ({
      ...piece,
      position: { ...piece.position },
    })),
    whiteHand: state.whiteHand.map((piece) => ({ ...piece })),
    blackHand: state.blackHand.map((piece) => ({ ...piece })),
    lastMovedPiece: state.lastMovedPiece
      ? {
          ...state.lastMovedPiece,
          from: state.lastMovedPiece.from ? { ...state.lastMovedPiece.from } : undefined,
          to: { ...state.lastMovedPiece.to },
        }
      : null,
  };
}

export function applyHiveMove(state: GameState, move: Move): GameState {
  return executeMove(cloneGameState(state), move);
}

export function chooseHiveMove(
  state: GameState,
  difficulty: HiveComputerDifficulty,
  options?: HiveMoveSelectionOptions,
): Move | null {
  return chooseHiveMoveForColor(state, state.currentTurn, difficulty, options);
}

export function chooseHiveMoveForColor(
  state: GameState,
  color: PlayerColor,
  difficulty: HiveComputerDifficulty,
  options?: HiveMoveSelectionOptions,
): Move | null {
  if (state.status !== 'playing' || state.currentTurn !== color) {
    return null;
  }

  const engine = options?.engine ?? 'classic';
  if (engine !== 'classic') {
    const mctsResult = runHiveMctsSearch(state, color, difficulty, options);
    if (options?.onSearchStats) {
      options.onSearchStats(mctsResult.stats);
    }
    return mctsResult.selectedMove;
  }

  const config = DIFFICULTY_CONFIG[difficulty];
  const context: SearchContext = {
    config,
    startedAtMs: Date.now(),
    nodesEvaluated: 0,
    modelOverride: options?.modelOverride,
    disableModelBlend: options?.disableModelBlend === true,
  };

  const candidates = getOrderedCandidateMoves(state, color, color, context, config.rootBeamWidth);
  if (candidates.length === 0) return null;

  const scored = candidates.map((candidate) => ({
    move: candidate.move,
    score: minimax(
      candidate.nextState,
      config.depth - 1,
      color,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      context,
    ),
  }));

  scored.sort((left, right) => right.score - left.score);
  if (scored.length === 0) return null;

  if (
    config.exploreTopMoves > 1
    && config.explorationChance > 0
    && Math.random() < config.explorationChance
  ) {
    const optionsPool = scored.slice(0, config.exploreTopMoves);
    const topScore = optionsPool[0].score;
    const weights = optionsPool.map((entry) => Math.exp((entry.score - topScore) / 140));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const pick = Math.random() * totalWeight;

    let cumulative = 0;
    for (let index = 0; index < optionsPool.length; index += 1) {
      cumulative += weights[index];
      if (pick <= cumulative) {
        return optionsPool[index].move;
      }
    }
  }

  return scored[0].move;
}

export interface HiveMctsPolicyEntry {
  actionKey: string;
  move: Move;
  visits: number;
  probability: number;
  prior: number;
  qValue: number;
}

export interface HiveMctsSearchResult {
  selectedMove: Move | null;
  policy: HiveMctsPolicyEntry[];
  stats: HiveSearchStats;
}

interface MctsNode {
  state: GameState;
  stateHash: string;
  toPlay: PlayerColor;
  graphVisitSeed: number;
  visitCount: number;
  valueSum: number;
  expanded: boolean;
  edges: Map<string, MctsEdge>;
  policyEntropy: number;
}

interface MctsEdge {
  edgeKey: string;
  actionKey: string;
  move: Move;
  prior: number;
  graphVisitSeed: number;
  graphValueSeed: number;
  visitCount: number;
  valueSum: number;
  child?: MctsNode;
}

export function runHiveMctsSearch(
  state: GameState,
  color: PlayerColor,
  difficulty: HiveComputerDifficulty,
  options?: HiveMoveSelectionOptions,
): HiveMctsSearchResult {
  const engine = options?.engine ?? 'alphazero';
  const config = {
    ...DEFAULT_MCTS_CONFIG_BY_DIFFICULTY[difficulty],
    ...options?.mctsConfig,
  };
  const graphBlend = clamp(config.graphBlend, 0, 1);

  const rng = createRng(options?.randomSeed);
  const startedAt = Date.now();
  const model = options?.modelHandle?.model ?? options?.modelOverride;
  const graphCache = resolveGraphCache(config, options?.modelHandle);
  const transposition = config.useTranspositionTable ? new Map<string, MctsNode>() : null;

  let nodesExpanded = 0;
  let depthSum = 0;
  let graphNodeHits = 0;
  let graphEdgeHits = 0;

  const rootHash = hashState(state);

  const root: MctsNode = {
    state,
    stateHash: rootHash,
    toPlay: color,
    graphVisitSeed: graphCache?.nodeStats.get(rootHash)?.visitCount ?? 0,
    visitCount: 0,
    valueSum: 0,
    expanded: false,
    edges: new Map<string, MctsEdge>(),
    policyEntropy: 0,
  };
  if (transposition) {
    transposition.set(rootHash, root);
  }

  for (let simulation = 0; simulation < config.simulations; simulation += 1) {
    const pathNodes: MctsNode[] = [root];
    const pathEdges: MctsEdge[] = [];
    let node = root;
    let depth = 0;

    while (
      node.expanded
      && node.edges.size > 0
      && node.state.status === 'playing'
      && depth < config.maxDepth
    ) {
      const chosenEdge = selectPuctEdge(
        node,
        config,
        engine,
        pathEdges.length === 0,
        rng,
        graphBlend,
      );
      if (!chosenEdge) break;
      pathEdges.push(chosenEdge);

      if (!chosenEdge.child) {
        const nextState = applyHiveMove(node.state, chosenEdge.move);
        const nextStateHash = hashState(nextState);
        let child: MctsNode | undefined;
        if (transposition) {
          child = transposition.get(nextStateHash);
        }
        if (!child) {
          child = {
            state: nextState,
            stateHash: nextStateHash,
            toPlay: nextState.currentTurn,
            graphVisitSeed: graphCache?.nodeStats.get(nextStateHash)?.visitCount ?? 0,
            visitCount: 0,
            valueSum: 0,
            expanded: false,
            edges: new Map<string, MctsEdge>(),
            policyEntropy: 0,
          };
          if (transposition) {
            transposition.set(nextStateHash, child);
          }
        }
        chosenEdge.child = child;
      }

      node = chosenEdge.child;
      pathNodes.push(node);
      depth += 1;
    }

    let leafValue = 0;
    if (node.state.status === 'finished') {
      leafValue = terminalValue(node.state, node.toPlay);
    } else if (depth >= config.maxDepth) {
      leafValue = evaluateState(node.state, node.toPlay, model, false) / 9000;
      leafValue = clamp(leafValue, -1, 1);
    } else {
      leafValue = expandNode(node, {
        isRoot: node === root,
        config,
        rng,
        model,
        graphCache,
      });
      nodesExpanded += 1;
    }

    depthSum += depth;

    let backedValue = leafValue;
    for (let index = pathNodes.length - 1; index >= 0; index -= 1) {
      const currentNode = pathNodes[index];
      currentNode.visitCount += 1;
      currentNode.valueSum += backedValue;
      if (graphCache) {
        mergeGraphCounter(graphCache.nodeStats, currentNode.stateHash, 1, backedValue, graphCache.nodeCap);
      }

      if (index > 0) {
        const parentEdge = pathEdges[index - 1];
        const parentPerspectiveValue = -backedValue;
        parentEdge.visitCount += 1;
        parentEdge.valueSum += parentPerspectiveValue;
        if (graphCache) {
          mergeGraphCounter(
            graphCache.edgeStats,
            parentEdge.edgeKey,
            1,
            parentPerspectiveValue,
            graphCache.edgeCap,
          );
        }
        backedValue = parentPerspectiveValue;
      }
    }
  }

  const rootPolicies = [...root.edges.values()]
    .map((edge) => {
      const qValue = edge.visitCount > 0 ? edge.valueSum / edge.visitCount : 0;
      const forcedVisitFloor = Math.floor(config.forcedPlayouts * edge.prior * config.simulations);
      const adjustedVisits = Math.max(edge.visitCount, forcedVisitFloor);
      return {
        actionKey: edge.actionKey,
        move: edge.move,
        visits: adjustedVisits,
        rawVisits: edge.visitCount,
        prior: edge.prior,
        qValue,
      };
    })
    .sort((left, right) => right.visits - left.visits || right.prior - left.prior);

  const totalVisits = Math.max(1, rootPolicies.reduce((sum, entry) => sum + entry.visits, 0));
  const temperature = Math.max(0.01, config.temperature);
  const weighted = rootPolicies.map((entry) => {
    const weight = Math.pow(Math.max(1e-6, entry.visits / totalVisits), 1 / temperature);
    return { ...entry, weight };
  });
  const weightSum = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  const policy: HiveMctsPolicyEntry[] = weighted.map((entry) => ({
    actionKey: entry.actionKey,
    move: entry.move,
    visits: entry.visits,
    prior: entry.prior,
    qValue: entry.qValue,
    probability: weightSum > 0 ? entry.weight / weightSum : 1 / Math.max(1, weighted.length),
  }));
  const policyEntropy = softmaxEntropy(policy.map((entry) => entry.probability));

  const selectedMove = selectPolicyMove(policy, config.temperature, rng);
  const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
  if (root.graphVisitSeed > 0) {
    graphNodeHits += 1;
  }
  if (root.edges.size > 0) {
    for (const edge of root.edges.values()) {
      if (edge.graphVisitSeed > 0) graphEdgeHits += 1;
    }
  }
  const stats: HiveSearchStats = {
    engine,
    simulations: config.simulations,
    nodesExpanded,
    nodesPerSecond: nodesExpanded / elapsedSeconds,
    averageSimulationDepth: config.simulations > 0 ? depthSum / config.simulations : 0,
    policyEntropy,
    rootValue: root.visitCount > 0 ? root.valueSum / root.visitCount : 0,
    graphNodeHits,
    graphEdgeHits,
    graphReuseRatio: config.simulations > 0
      ? (graphNodeHits + graphEdgeHits) / (config.simulations * 2)
      : 0,
  };

  return {
    selectedMove,
    policy,
    stats,
  };
}

function expandNode(
  node: MctsNode,
  input: {
    isRoot: boolean;
    config: HiveMctsConfig;
    rng: () => number;
    model?: HiveModel;
    graphCache: HiveMctsGraphCache | null;
  },
): number {
  if (node.state.status === 'finished') {
    node.expanded = true;
    return terminalValue(node.state, node.toPlay);
  }

  const legalMoves = getLegalMovesForColor(node.state, node.toPlay);
  if (legalMoves.length === 0) {
    node.expanded = true;
    return -1;
  }

  const evaluation = evaluatePolicyValue(node.state, legalMoves, node.toPlay, input.model);
  const candidates = legalMoves.map((move) => ({
    move,
    actionKey: moveToActionKey(move),
    logit: evaluation.actionLogitsByKey[moveToActionKey(move)] ?? 0,
  }));
  candidates.sort((left, right) => right.logit - left.logit);

  const top = candidates.slice(0, Math.max(1, input.config.policyPruneTopK));
  const normalized = normalizeSoftmax(top.map((entry) => entry.logit));
  let priors = top.map((entry, index) => ({
    move: entry.move,
    actionKey: entry.actionKey,
    prior: normalized[index],
  })).filter((entry) => entry.prior >= input.config.policyPruneMinProb);

  if (priors.length === 0) {
    priors = [{ move: top[0].move, actionKey: top[0].actionKey, prior: 1 }];
  }

  if (input.isRoot && priors.length > 1 && input.config.dirichletEpsilon > 0) {
    const noise = sampleDirichlet(priors.length, input.config.dirichletAlpha, input.rng);
    priors = priors.map((entry, index) => ({
      ...entry,
      prior: entry.prior * (1 - input.config.dirichletEpsilon) + noise[index] * input.config.dirichletEpsilon,
    }));
  }

  const priorSum = Math.max(1e-9, priors.reduce((sum, entry) => sum + entry.prior, 0));
  node.edges = new Map<string, MctsEdge>();
  for (const entry of priors) {
    const edgeKey = `${node.stateHash}|${entry.actionKey}`;
    const graphSeed = input.graphCache?.edgeStats.get(edgeKey);
    node.edges.set(entry.actionKey, {
      edgeKey,
      actionKey: entry.actionKey,
      move: entry.move,
      prior: entry.prior / priorSum,
      graphVisitSeed: graphSeed?.visitCount ?? 0,
      graphValueSeed: graphSeed?.valueSum ?? 0,
      visitCount: 0,
      valueSum: 0,
    });
  }
  node.policyEntropy = softmaxEntropy([...node.edges.values()].map((edge) => edge.prior));
  node.expanded = true;
  if (input.graphCache) {
    mergeGraphCounter(
      input.graphCache.nodeStats,
      node.stateHash,
      0,
      0,
      input.graphCache.nodeCap,
    );
  }
  return clamp(evaluation.value, -1, 1);
}

function selectPuctEdge(
  node: MctsNode,
  config: HiveMctsConfig,
  engine: HiveSearchEngine,
  isRoot: boolean,
  rng: () => number,
  graphBlend: number,
): MctsEdge | null {
  let bestEdge: MctsEdge | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const base = Math.sqrt(node.visitCount + 1 + node.graphVisitSeed * graphBlend);

  for (const edge of node.edges.values()) {
    const blendedVisits = edge.visitCount + edge.graphVisitSeed * graphBlend;
    const blendedValueSum = edge.valueSum + edge.graphValueSeed * graphBlend;
    const qValue = blendedVisits > 0 ? blendedValueSum / blendedVisits : 0;
    const uValue = config.cPuct * edge.prior * (base / (1 + blendedVisits));
    const gumbel = engine === 'gumbel' && isRoot ? sampleGumbel(rng) * 0.2 : 0;
    const score = qValue + uValue + gumbel;

    if (score > bestScore) {
      bestScore = score;
      bestEdge = edge;
    }
  }

  return bestEdge;
}

function selectPolicyMove(
  policy: HiveMctsPolicyEntry[],
  temperature: number,
  rng: () => number,
): Move | null {
  if (policy.length === 0) return null;
  if (temperature <= 0.05) return policy[0].move;

  const pick = rng();
  let cumulative = 0;
  for (const entry of policy) {
    cumulative += entry.probability;
    if (pick <= cumulative) return entry.move;
  }
  return policy[0].move;
}

function minimax(
  state: GameState,
  depth: number,
  maximizingColor: PlayerColor,
  alpha: number,
  beta: number,
  context: SearchContext,
): number {
  context.nodesEvaluated += 1;

  if (state.status === 'finished') {
    if (!state.winner || state.winner === 'draw') return 0;
    return state.winner === maximizingColor ? 90000 - depth : -90000 + depth;
  }

  if (depth <= 0 || shouldCutSearch(context)) {
    return evaluateState(
      state,
      maximizingColor,
      context.modelOverride,
      context.disableModelBlend === true,
    );
  }

  const activeColor = state.currentTurn;
  const ordered = getOrderedCandidateMoves(
    state,
    activeColor,
    maximizingColor,
    context,
    context.config.childBeamWidth,
  );

  if (ordered.length === 0) {
    return activeColor === maximizingColor ? -70000 : 70000;
  }

  if (activeColor === maximizingColor) {
    let value = Number.NEGATIVE_INFINITY;
    for (const candidate of ordered) {
      value = Math.max(
        value,
        minimax(candidate.nextState, depth - 1, maximizingColor, alpha, beta, context),
      );
      alpha = Math.max(alpha, value);
      if (beta <= alpha) break;
    }
    return value;
  }

  let value = Number.POSITIVE_INFINITY;
  for (const candidate of ordered) {
    value = Math.min(
      value,
      minimax(candidate.nextState, depth - 1, maximizingColor, alpha, beta, context),
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

function getOrderedCandidateMoves(
  state: GameState,
  activeColor: PlayerColor,
  maximizingColor: PlayerColor,
  context: SearchContext,
  beamWidth: number,
): CandidateMove[] {
  const legalMoves = getLegalMovesForColor(state, activeColor);
  if (legalMoves.length === 0) return [];

  const candidates = legalMoves.map((move) => {
    const nextState = applyHiveMove(state, move);
    const evalForOrder = evaluateState(nextState, maximizingColor, context.modelOverride, true);
    return {
      move,
      nextState,
      orderingScore: activeColor === maximizingColor ? evalForOrder : -evalForOrder,
    };
  });

  candidates.sort((left, right) => right.orderingScore - left.orderingScore);
  return candidates.slice(0, beamWidth);
}

export function getLegalMovesForColor(state: GameState, color: PlayerColor): Move[] {
  const turnState = state.currentTurn === color
    ? state
    : {
        ...state,
        currentTurn: color,
      };

  const actions = getAllValidActions(turnState);
  const moves: Move[] = [];

  const placementDedup = new Set<string>();

  for (const placement of actions.placements) {
    const hand = color === 'white' ? turnState.whiteHand : turnState.blackHand;
    const piece = hand.find((entry) => entry.id === placement.pieceId);
    if (!piece) continue;

    for (const destination of placement.positions) {
      const dedupeKey = `${piece.type}:${coordKey(destination)}`;
      if (placementDedup.has(dedupeKey)) continue;
      placementDedup.add(dedupeKey);

      moves.push({
        type: 'place',
        pieceId: placement.pieceId,
        to: destination,
      });
    }
  }

  for (const movement of actions.moves) {
    for (const destination of movement.destinations) {
      moves.push({
        type: 'move',
        pieceId: movement.pieceId,
        to: destination,
      });
    }
  }

  for (const ability of actions.pillbugAbilities) {
    for (const target of ability.targets) {
      for (const destination of target.destinations) {
        moves.push({
          type: 'move',
          pieceId: ability.pillbugId,
          to: destination,
          isPillbugAbility: true,
          targetPieceId: target.targetPieceId,
        });
      }
    }
  }

  return dedupeMovesByActionKey(moves);
}

function evaluateState(
  state: GameState,
  perspective: PlayerColor,
  modelOverride?: HiveModel,
  disableModelBlend = false,
): number {
  const heuristicScore = evaluateStateHeuristic(state, perspective);
  if (disableModelBlend) {
    return heuristicScore;
  }
  return blendHeuristicWithModel(state, perspective, heuristicScore, modelOverride);
}

function evaluateStateHeuristic(state: GameState, perspective: PlayerColor): number {
  const opponent = flipColor(perspective);

  if (state.status === 'finished') {
    if (!state.winner || state.winner === 'draw') return 0;
    return state.winner === perspective ? 85000 : -85000;
  }

  const myPieces = state.board.filter((piece) => piece.color === perspective);
  const oppPieces = state.board.filter((piece) => piece.color === opponent);

  const myTopPieces = topPiecesForColor(state.board, perspective);
  const oppTopPieces = topPiecesForColor(state.board, opponent);

  const occupied = new Set<string>();
  for (const piece of state.board) {
    occupied.add(coordKey(piece.position));
  }

  const myQueenSurround = getQueenSurroundCount(state.board, perspective);
  const oppQueenSurround = getQueenSurroundCount(state.board, opponent);

  const myQueenPlaced = perspective === 'white' ? state.whiteQueenPlaced : state.blackQueenPlaced;
  const oppQueenPlaced = perspective === 'white' ? state.blackQueenPlaced : state.whiteQueenPlaced;

  const myHand = perspective === 'white' ? state.whiteHand.length : state.blackHand.length;
  const oppHand = perspective === 'white' ? state.blackHand.length : state.whiteHand.length;

  const myMobility = freeNeighborScore(myTopPieces, occupied);
  const oppMobility = freeNeighborScore(oppTopPieces, occupied);

  const myCenter = centerControl(myTopPieces);
  const oppCenter = centerControl(oppTopPieces);

  const myStacks = stackControl(state.board, perspective);
  const oppStacks = stackControl(state.board, opponent);

  const myPressure = queenPressure(myTopPieces, oppPieces.find((piece) => piece.type === 'queen'));
  const oppPressure = queenPressure(oppTopPieces, myPieces.find((piece) => piece.type === 'queen'));

  const myQueenGuards = queenGuards(state.board, perspective);
  const oppQueenGuards = queenGuards(state.board, opponent);

  const phase = clamp((state.turnNumber - 1) / 36, 0, 1);

  const queenPressureScore = (oppQueenSurround - myQueenSurround) * lerp(360, 520, phase);
  const mobilityScore = (myMobility - oppMobility) * lerp(48, 28, phase);
  const centerScore = (myCenter - oppCenter) * lerp(24, 14, phase);
  const stackScore = (myStacks - oppStacks) * 34;
  const deploymentScore = (myPieces.length - oppPieces.length) * 18 + (oppHand - myHand) * 12;
  const queenPlacementScore = (myQueenPlaced ? 95 : -85) - (oppQueenPlaced ? 95 : -85);
  const pressureScore = (myPressure - oppPressure) * lerp(140, 220, phase);
  const guardScore = (myQueenGuards - oppQueenGuards) * 40;

  const dangerBonus = (oppQueenSurround >= 5 ? 1800 : 0) - (myQueenSurround >= 5 ? 1800 : 0);
  const lateStagnationPenalty = state.turnNumber > 96 && oppQueenSurround <= myQueenSurround
    ? (state.turnNumber - 96) * 4
    : 0;

  return (
    queenPressureScore
    + mobilityScore
    + centerScore
    + stackScore
    + deploymentScore
    + queenPlacementScore
    + pressureScore
    + guardScore
    + dangerBonus
    - lateStagnationPenalty
  );
}

function topPiecesForColor(board: PlacedPiece[], color: PlayerColor): PlacedPiece[] {
  const topByCell = new Map<string, PlacedPiece>();

  for (const piece of board) {
    const key = coordKey(piece.position);
    const current = topByCell.get(key);
    if (!current || piece.stackOrder > current.stackOrder) {
      topByCell.set(key, piece);
    }
  }

  return [...topByCell.values()].filter((piece) => piece.color === color);
}

function freeNeighborScore(pieces: PlacedPiece[], occupied: Set<string>): number {
  let score = 0;
  for (const piece of pieces) {
    let empties = 0;
    for (const neighbor of getNeighbors(piece.position)) {
      if (!occupied.has(coordKey(neighbor))) {
        empties += 1;
      }
    }
    score += empties;
  }
  return score;
}

function centerControl(pieces: PlacedPiece[]): number {
  let score = 0;
  for (const piece of pieces) {
    const distance = hexDistance(piece.position, { q: 0, r: 0 });
    score += Math.max(0, 5 - distance);
  }
  return score;
}

function stackControl(board: PlacedPiece[], color: PlayerColor): number {
  const heights = new Map<string, number>();
  for (const piece of board) {
    const key = coordKey(piece.position);
    heights.set(key, (heights.get(key) ?? 0) + 1);
  }

  let score = 0;
  for (const [key, height] of heights) {
    if (height <= 1) continue;
    const [q, r] = key.split(',').map(Number);
    const top = getTopPieceAt(board, { q, r });
    if (top?.color !== color) continue;
    score += height - 1;
  }

  return score;
}

function queenPressure(pieces: PlacedPiece[], enemyQueen: PlacedPiece | undefined): number {
  if (!enemyQueen) return 0;

  let bestDistance = Number.POSITIVE_INFINITY;
  let pressure = 0;

  for (const piece of pieces) {
    const distance = hexDistance(piece.position, enemyQueen.position);
    bestDistance = Math.min(bestDistance, distance);
    pressure += 1 / (distance + 1);
  }

  if (!Number.isFinite(bestDistance)) return pressure;
  return pressure + Math.max(0, 5 - bestDistance) * 1.7;
}

function queenGuards(board: PlacedPiece[], color: PlayerColor): number {
  const queen = board.find((piece) => piece.type === 'queen' && piece.color === color);
  if (!queen) return 0;

  let guard = 0;
  for (const neighbor of getNeighbors(queen.position)) {
    const top = getTopPieceAt(board, neighbor);
    if (!top || top.color !== color) continue;
    if (top.type === 'beetle' || top.type === 'pillbug') guard += 2;
    else if (top.type === 'ant' || top.type === 'spider') guard += 1.2;
    else guard += 1;
  }

  return guard;
}

function resolveGraphCache(
  config: HiveMctsConfig,
  modelHandle?: HiveModelHandle,
): HiveMctsGraphCache | null {
  if (!config.useGraphCache) return null;
  const existing = modelHandle?.graphCache;
  if (existing) {
    existing.nodeCap = Math.max(1000, Math.floor(config.graphNodeCap));
    existing.edgeCap = Math.max(2000, Math.floor(config.graphEdgeCap));
    return existing;
  }

  DEFAULT_GLOBAL_GRAPH_CACHE.nodeCap = Math.max(1000, Math.floor(config.graphNodeCap));
  DEFAULT_GLOBAL_GRAPH_CACHE.edgeCap = Math.max(2000, Math.floor(config.graphEdgeCap));
  if (modelHandle) {
    modelHandle.graphCache = DEFAULT_GLOBAL_GRAPH_CACHE;
  }
  return DEFAULT_GLOBAL_GRAPH_CACHE;
}

function mergeGraphCounter(
  table: Map<string, MctsGraphCounter>,
  key: string,
  visitDelta: number,
  valueDelta: number,
  cap: number,
): void {
  const existing = table.get(key);
  if (existing) {
    existing.visitCount += visitDelta;
    existing.valueSum += valueDelta;
    table.delete(key);
    table.set(key, existing);
  } else {
    table.set(key, {
      visitCount: visitDelta,
      valueSum: valueDelta,
    });
  }
  trimMapToCap(table, cap);
}

function trimMapToCap<T>(table: Map<string, T>, cap: number): void {
  const safeCap = Math.max(1, Math.floor(cap));
  while (table.size > safeCap) {
    const firstKey = table.keys().next().value;
    if (!firstKey) break;
    table.delete(firstKey);
  }
}

function normalizeSoftmax(values: number[]): number[] {
  if (values.length === 0) return [];
  const maxValue = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - maxValue));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  if (sum <= 0 || !Number.isFinite(sum)) {
    const uniform = 1 / values.length;
    return values.map(() => uniform);
  }
  return exps.map((value) => value / sum);
}

function sampleDirichlet(length: number, alpha: number, rng: () => number): number[] {
  if (length <= 0) return [];
  const safeAlpha = Math.max(1e-3, alpha);
  const values: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const u = Math.max(1e-9, 1 - rng());
    const sample = Math.pow(-Math.log(u), 1 / safeAlpha);
    values.push(sample);
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (sum <= 0 || !Number.isFinite(sum)) {
    const uniform = 1 / length;
    return values.map(() => uniform);
  }
  return values.map((value) => value / sum);
}

function softmaxEntropy(probabilities: number[]): number {
  if (probabilities.length === 0) return 0;
  const normalized = normalizeSoftmax(probabilities);
  let entropy = 0;
  for (const probability of normalized) {
    if (probability > 0) {
      entropy -= probability * Math.log(probability);
    }
  }
  return Number.isFinite(entropy) ? entropy : 0;
}

function sampleGumbel(rng: () => number): number {
  const uniform = Math.min(1 - 1e-9, Math.max(1e-9, rng()));
  return -Math.log(-Math.log(uniform));
}

function createRng(seed?: number): () => number {
  if (!Number.isFinite(seed)) {
    return () => Math.random();
  }

  let state = Math.floor(Math.abs(seed as number)) % 2147483647;
  if (state <= 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function terminalValue(state: GameState, perspective: PlayerColor): number {
  if (state.status !== 'finished') return 0;
  if (!state.winner || state.winner === 'draw') return 0;
  return state.winner === perspective ? 1 : -1;
}

function hashState(state: GameState): string {
  const boardSig = [...state.board]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((piece) => `${piece.id}:${piece.position.q},${piece.position.r},${piece.stackOrder}`)
    .join('|');
  const whiteHand = [...state.whiteHand].map((piece) => piece.id).sort().join(',');
  const blackHand = [...state.blackHand].map((piece) => piece.id).sort().join(',');
  return [
    state.currentTurn,
    state.turnNumber,
    state.whiteQueenPlaced ? '1' : '0',
    state.blackQueenPlaced ? '1' : '0',
    boardSig,
    whiteHand,
    blackHand,
  ].join('#');
}

function flipColor(color: PlayerColor): PlayerColor {
  return color === 'white' ? 'black' : 'white';
}

export function oppositeColor(color: PlayerColor): PlayerColor {
  return flipColor(color);
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
