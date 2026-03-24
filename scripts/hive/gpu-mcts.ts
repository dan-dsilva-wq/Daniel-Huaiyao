import {
  applyHiveMove,
  getLegalMovesForColor,
  type HiveMctsConfig,
} from '../../lib/hive/ai';
import {
  HIVE_DEFAULT_TOKEN_SLOTS,
  extractHiveActionFeatures,
  extractHiveTokenStateFeatures,
} from '../../lib/hive/ml';
import { moveToActionKey } from '../../lib/hive/actionEncoding';
import type { GameState, Move, PlayerColor } from '../../lib/hive/types';
import {
  type GpuInferenceClient,
  type GpuInferencePosition,
} from './gpu-inference-client';

interface MctsNode {
  state: GameState;
  stateHash: string;
  toPlay: PlayerColor;
  visitCount: number;
  valueSum: number;
  expanded: boolean;
  edges: Map<string, MctsEdge>;
  policyEntropy: number;
  pendingValue?: number;
}

interface MctsEdge {
  actionKey: string;
  move: Move;
  prior: number;
  visitCount: number;
  valueSum: number;
  virtualLoss: number;
  child?: MctsNode;
}

interface BatchedLeaf {
  node: MctsNode;
  pathNodes: MctsNode[];
  pathEdges: MctsEdge[];
  legalMoves: Move[];
}

export interface GpuMctsSearchResult {
  selectedMove: Move | null;
  policy: Array<{
    actionKey: string;
    move: Move;
    visits: number;
    rawVisits: number;
    probability: number;
    rawProbability: number;
    prior: number;
    qValue: number;
  }>;
  stats: {
    simulations: number;
    nodesExpanded: number;
    nodesPerSecond: number;
    averageSimulationDepth: number;
    policyEntropy: number;
    rootValue: number;
  };
}

export interface GpuMctsSearchInput {
  state: GameState;
  color: PlayerColor;
  gpuClient: GpuInferenceClient;
  mctsConfig?: Partial<HiveMctsConfig>;
  seed: number;
  leafBatchSize?: number;
  modelKey?: string;
  signal?: AbortSignal | null;
}

export async function runGpuMctsSearch(input: GpuMctsSearchInput): Promise<GpuMctsSearchResult> {
  const config = {
    simulations: input.mctsConfig?.simulations ?? 220,
    cPuct: input.mctsConfig?.cPuct ?? 1.18,
    dirichletAlpha: input.mctsConfig?.dirichletAlpha ?? 0.22,
    dirichletEpsilon: input.mctsConfig?.dirichletEpsilon ?? 0.06,
    temperature: input.mctsConfig?.temperature ?? 0.5,
    policyPruneTopK: input.mctsConfig?.policyPruneTopK ?? 14,
    policyPruneMinProb: input.mctsConfig?.policyPruneMinProb ?? 0.001,
    forcedPlayouts: input.mctsConfig?.forcedPlayouts ?? 3,
    maxDepth: input.mctsConfig?.maxDepth ?? 180,
  };

  const rng = createSeededRng(input.seed);
  const startedAt = Date.now();
  const transposition = new Map<string, MctsNode>();
  const modelKey = input.modelKey ?? 'default';
  const leafBatchSize = Math.max(1, input.leafBatchSize ?? 64);

  let nodesExpanded = 0;
  let depthSum = 0;

  const rootHash = hashHiveState(input.state);
  const root: MctsNode = {
    state: input.state,
    stateHash: rootHash,
    toPlay: input.color,
    visitCount: 0,
    valueSum: 0,
    expanded: false,
    edges: new Map(),
    policyEntropy: 0,
  };
  transposition.set(rootHash, root);

  await expandNodeGpu(root, true, config, rng, input.gpuClient, modelKey);
  nodesExpanded += 1;

  let simulationsDone = 0;
  while (simulationsDone < config.simulations) {
    if (input.signal?.aborted) {
      break;
    }

    const currentBatchSize = Math.min(leafBatchSize, config.simulations - simulationsDone);
    const leaves: BatchedLeaf[] = [];

    for (let index = 0; index < currentBatchSize; index += 1) {
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
        const edge = selectPuctEdge(node, config.cPuct);
        if (!edge) break;

        edge.virtualLoss += 1;
        pathEdges.push(edge);

        if (!edge.child) {
          const nextState = applyHiveMove(node.state, edge.move);
          const nextHash = hashHiveState(nextState);
          let child = transposition.get(nextHash);
          if (!child) {
            child = {
              state: nextState,
              stateHash: nextHash,
              toPlay: nextState.currentTurn,
              visitCount: 0,
              valueSum: 0,
              expanded: false,
              edges: new Map(),
              policyEntropy: 0,
            };
            transposition.set(nextHash, child);
          }
          edge.child = child;
        }

        node = edge.child;
        pathNodes.push(node);
        depth += 1;
      }

      if (node.state.status === 'finished') {
        const value = terminalValue(node.state, node.toPlay);
        backpropagate(pathNodes, pathEdges, value);
        depthSum += depth;
        simulationsDone += 1;
        continue;
      }

      if (depth >= config.maxDepth || node.expanded) {
        backpropagate(pathNodes, pathEdges, 0);
        depthSum += depth;
        simulationsDone += 1;
        continue;
      }

      const legalMoves = getLegalMovesForColor(node.state, node.toPlay);
      if (legalMoves.length === 0) {
        backpropagate(pathNodes, pathEdges, -1);
        depthSum += depth;
        simulationsDone += 1;
        continue;
      }

      leaves.push({ node, pathNodes, pathEdges, legalMoves });
    }

    if (leaves.length > 0) {
      await batchExpandLeaves(leaves, config, rng, input.gpuClient, modelKey);
      nodesExpanded += leaves.length;

      for (const leaf of leaves) {
        backpropagate(leaf.pathNodes, leaf.pathEdges, leaf.node.pendingValue ?? 0);
        depthSum += leaf.pathEdges.length;
        simulationsDone += 1;
      }
    }
  }

  const rootPolicies = [...root.edges.values()]
    .map((edge) => {
      const qValue = edge.visitCount > 0 ? edge.valueSum / edge.visitCount : 0;
      const forcedVisitFloor = Math.floor(config.forcedPlayouts * edge.prior * config.simulations);
      return {
        actionKey: edge.actionKey,
        move: edge.move,
        visits: Math.max(edge.visitCount, forcedVisitFloor),
        rawVisits: edge.visitCount,
        prior: edge.prior,
        qValue,
      };
    })
    .sort((left, right) => right.visits - left.visits || right.prior - left.prior);

  const totalVisits = Math.max(1, rootPolicies.reduce((sum, entry) => sum + entry.visits, 0));
  const totalRawVisits = Math.max(1, rootPolicies.reduce((sum, entry) => sum + Math.max(0, entry.rawVisits), 0));
  const temperature = Math.max(0.01, config.temperature);
  const weighted = rootPolicies.map((entry) => ({
    ...entry,
    weight: Math.pow(Math.max(1e-6, entry.visits / totalVisits), 1 / temperature),
  }));
  const weightSum = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  const policy = weighted.map((entry) => ({
    actionKey: entry.actionKey,
    move: entry.move,
    visits: entry.visits,
    rawVisits: entry.rawVisits,
    prior: entry.prior,
    qValue: entry.qValue,
    rawProbability: entry.rawVisits > 0 ? entry.rawVisits / totalRawVisits : 0,
    probability: weightSum > 0 ? entry.weight / weightSum : 1 / Math.max(1, weighted.length),
  }));

  const policyEntropy = softmaxEntropy(policy.map((entry) => entry.probability));
  const selectedMove = selectPolicyMove(policy, config.temperature, rng);
  const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);

  return {
    selectedMove,
    policy,
    stats: {
      simulations: simulationsDone,
      nodesExpanded,
      nodesPerSecond: nodesExpanded / elapsed,
      averageSimulationDepth: simulationsDone > 0 ? depthSum / simulationsDone : 0,
      policyEntropy,
      rootValue: root.visitCount > 0 ? root.valueSum / root.visitCount : 0,
    },
  };
}

async function expandNodeGpu(
  node: MctsNode,
  isRoot: boolean,
  config: {
    policyPruneTopK: number;
    policyPruneMinProb: number;
    dirichletAlpha: number;
    dirichletEpsilon: number;
  },
  rng: () => number,
  gpuClient: GpuInferenceClient,
  modelKey: string,
): Promise<number> {
  if (node.state.status === 'finished') {
    node.expanded = true;
    return terminalValue(node.state, node.toPlay);
  }

  const legalMoves = getLegalMovesForColor(node.state, node.toPlay);
  if (legalMoves.length === 0) {
    node.expanded = true;
    return -1;
  }

  const position: GpuInferencePosition = {
    modelKey,
    stateFeatures: extractHiveTokenStateFeatures(node.state, node.toPlay, HIVE_DEFAULT_TOKEN_SLOTS),
    actions: legalMoves.map((move) => ({
      actionKey: moveToActionKey(move),
      actionFeatures: extractHiveActionFeatures(node.state, move, node.toPlay),
    })),
  };

  const result = await gpuClient.infer(position);
  const filteredPriors = buildFilteredPriors(
    legalMoves,
    result.actionLogits,
    config.policyPruneTopK,
    config.policyPruneMinProb,
    isRoot,
    config.dirichletAlpha,
    config.dirichletEpsilon,
    rng,
  );

  applyExpandedPriors(node, filteredPriors);
  return clamp(result.value, -1, 1);
}

async function batchExpandLeaves(
  leaves: BatchedLeaf[],
  config: {
    policyPruneTopK: number;
    policyPruneMinProb: number;
    dirichletAlpha: number;
    dirichletEpsilon: number;
  },
  rng: () => number,
  gpuClient: GpuInferenceClient,
  modelKey: string,
): Promise<void> {
  const positions: GpuInferencePosition[] = leaves.map((leaf) => ({
    modelKey,
    stateFeatures: extractHiveTokenStateFeatures(leaf.node.state, leaf.node.toPlay, HIVE_DEFAULT_TOKEN_SLOTS),
    actions: leaf.legalMoves.map((move) => ({
      actionKey: moveToActionKey(move),
      actionFeatures: extractHiveActionFeatures(leaf.node.state, move, leaf.node.toPlay),
    })),
  }));

  const results = await gpuClient.inferBatch(positions);

  for (let index = 0; index < leaves.length; index += 1) {
    const leaf = leaves[index];
    const result = results[index];
    const isRoot = leaf.pathEdges.length === 0;
    const filteredPriors = buildFilteredPriors(
      leaf.legalMoves,
      result.actionLogits,
      config.policyPruneTopK,
      config.policyPruneMinProb,
      isRoot,
      config.dirichletAlpha,
      config.dirichletEpsilon,
      rng,
    );
    applyExpandedPriors(leaf.node, filteredPriors);
    leaf.node.pendingValue = clamp(result.value, -1, 1);
  }
}

function buildFilteredPriors(
  legalMoves: Move[],
  actionLogits: Record<string, number>,
  policyPruneTopK: number,
  policyPruneMinProb: number,
  isRoot: boolean,
  dirichletAlpha: number,
  dirichletEpsilon: number,
  rng: () => number,
): Array<{ move: Move; actionKey: string; prior: number }> {
  const candidates = legalMoves
    .map((move) => {
      const actionKey = moveToActionKey(move);
      return {
        move,
        actionKey,
        logit: actionLogits[actionKey] ?? 0,
      };
    })
    .sort((left, right) => right.logit - left.logit);

  const topK = candidates.slice(0, policyPruneTopK);
  const priors = normalizeSoftmax(topK.map((entry) => entry.logit));

  let filtered = topK
    .map((entry, index) => ({ move: entry.move, actionKey: entry.actionKey, prior: priors[index] }))
    .filter((entry) => entry.prior >= policyPruneMinProb);

  if (filtered.length === 0 && topK.length > 0) {
    filtered = [{ move: topK[0].move, actionKey: topK[0].actionKey, prior: 1 }];
  }

  if (isRoot && filtered.length > 1 && dirichletEpsilon > 0) {
    const noise = sampleDirichlet(filtered.length, dirichletAlpha, rng);
    filtered = filtered.map((entry, index) => ({
      ...entry,
      prior: entry.prior * (1 - dirichletEpsilon) + noise[index] * dirichletEpsilon,
    }));
  }

  return filtered;
}

function applyExpandedPriors(
  node: MctsNode,
  priors: Array<{ move: Move; actionKey: string; prior: number }>,
): void {
  const priorSum = Math.max(1e-9, priors.reduce((sum, entry) => sum + entry.prior, 0));
  node.edges = new Map();
  for (const prior of priors) {
    node.edges.set(prior.actionKey, {
      actionKey: prior.actionKey,
      move: prior.move,
      prior: prior.prior / priorSum,
      visitCount: 0,
      valueSum: 0,
      virtualLoss: 0,
    });
  }
  node.policyEntropy = softmaxEntropy([...node.edges.values()].map((edge) => edge.prior));
  node.expanded = true;
}

function selectPuctEdge(node: MctsNode, cPuct: number): MctsEdge | null {
  let bestEdge: MctsEdge | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const sqrtVisits = Math.sqrt(node.visitCount + 1);

  for (const edge of node.edges.values()) {
    const effectiveVisits = edge.visitCount + edge.virtualLoss;
    const qValue = effectiveVisits > 0 ? edge.valueSum / effectiveVisits : 0;
    const uValue = cPuct * edge.prior * sqrtVisits / (1 + effectiveVisits);
    const score = qValue + uValue;

    if (score > bestScore) {
      bestScore = score;
      bestEdge = edge;
    }
  }

  return bestEdge;
}

function backpropagate(pathNodes: MctsNode[], pathEdges: MctsEdge[], value: number): void {
  let backedValue = value;
  for (let index = pathNodes.length - 1; index >= 0; index -= 1) {
    const node = pathNodes[index];
    node.visitCount += 1;
    node.valueSum += backedValue;

    if (index > 0) {
      const edge = pathEdges[index - 1];
      const parentValue = -backedValue;
      edge.visitCount += 1;
      edge.valueSum += parentValue;
      edge.virtualLoss = Math.max(0, edge.virtualLoss - 1);
      backedValue = parentValue;
    }
  }
}

function selectPolicyMove(
  policy: Array<{ move: Move; probability: number }>,
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

function terminalValue(state: GameState, perspective: PlayerColor): number {
  if (state.winner === 'draw') return 0;
  if (state.winner === perspective) return 1;
  if (state.winner) return -1;
  return 0;
}

export function hashHiveState(state: GameState): string {
  const boardStr = state.board
    .map((piece) => `${piece.id}:${piece.position.q},${piece.position.r}:${piece.stackOrder}`)
    .sort()
    .join('|');
  const key = `${boardStr}|${state.currentTurn}|${state.turnNumber}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  }
  return hash.toString(16);
}

export function createSeededRng(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state <= 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSoftmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const max = Math.max(...logits);
  const exp = logits.map((value) => Math.exp(value - max));
  const sum = exp.reduce((left, right) => left + right, 0);
  return exp.map((value) => value / sum);
}

function softmaxEntropy(probabilities: number[]): number {
  let entropy = 0;
  for (const probability of probabilities) {
    if (probability > 1e-9) entropy -= probability * Math.log(probability);
  }
  return entropy;
}

function sampleDirichlet(size: number, alpha: number, rng: () => number): number[] {
  const samples: number[] = [];
  for (let index = 0; index < size; index += 1) {
    let sum = 0;
    for (let gammaSample = 0; gammaSample < Math.ceil(alpha * 10); gammaSample += 1) {
      sum -= Math.log(1 - rng());
    }
    samples.push(sum);
  }
  const total = samples.reduce((left, right) => left + right, 0);
  return samples.map((value) => value / total);
}
