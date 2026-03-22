/**
 * GPU-accelerated self-play worker for Hive AlphaZero.
 *
 * This worker uses the GPU inference server for neural network evaluation,
 * providing significant speedup over the CPU-only version.
 *
 * Key differences from az-selfplay-worker.ts:
 * - Starts a GPU inference server subprocess
 * - Batches neural network evaluations during MCTS
 * - Collects multiple leaf nodes before GPU inference
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyHiveMove,
  createLocalHiveGameState,
  getLegalMovesForColor,
  type HiveComputerDifficulty,
  type HiveMctsConfig,
} from '../../lib/hive/ai';
import {
  HIVE_ACTION_FEATURE_NAMES,
  HIVE_DEFAULT_TOKEN_SLOTS,
  buildHiveTokenStateFeatureNames,
  extractHiveActionFeatures,
  extractHiveTokenStateFeatures,
  parseHiveModel,
  type HiveModel,
} from '../../lib/hive/ml';
import { moveToActionKey } from '../../lib/hive/actionEncoding';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import type { GameState, Move, PlayerColor } from '../../lib/hive/types';
import {
  GpuInferenceClient,
  type GpuInferencePosition,
  type GpuInferenceResult,
} from './gpu-inference-client';

type SelfPlaySampleOrigin = 'learner' | 'champion';

interface WorkerOptions {
  games: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  simulations: number;
  fastSimulations: number;
  fastRatio: number;
  seed: number;
  modelPath: string | null;
  sampleOrigin: SelfPlaySampleOrigin;
  outPath: string;
  batchSize: number;
}

interface PolicyTarget {
  actionKey: string;
  probability: number;
  visitCount: number;
  actionFeatures: number[];
}

interface SelfPlaySample {
  stateFeatures: number[];
  perspective: PlayerColor;
  sampleOrigin?: SelfPlaySampleOrigin;
  policyTargets: PolicyTarget[];
  valueTarget: number;
  auxTargets: {
    queenSurroundDelta: number;
    mobility: number;
    lengthBucket: number;
  };
  searchMeta: {
    simulations: number;
    nodesPerSecond: number;
    policyEntropy: number;
    averageDepth: number;
    dirichletAlpha: number;
    temperature: number;
    maxDepth: number;
    reanalysed: boolean;
  };
  stateSnapshot: GameState;
}

interface WorkerOutput {
  version: number;
  createdAt: string;
  updatedAt: string;
  stateFeatureNames: string[];
  actionFeatureNames: string[];
  samples: SelfPlaySample[];
  summary: {
    games: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
    totalMoves: number;
    totalSimulations: number;
    sampleOrigin: SelfPlaySampleOrigin;
    gpuEnabled: boolean;
  };
}

// MCTS types
interface MctsNode {
  state: GameState;
  stateHash: string;
  toPlay: PlayerColor;
  visitCount: number;
  valueSum: number;
  expanded: boolean;
  edges: Map<string, MctsEdge>;
  policyEntropy: number;
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

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  // Start GPU inference server
  const modelPath = options.modelPath ?? 'lib/hive/trained-model.json';
  console.error(`[gpu-worker] Starting GPU inference server with model: ${modelPath}`);

  const gpuClient = await GpuInferenceClient.start(modelPath, {
    batchDelayMs: 1,
    maxBatchSize: options.batchSize,
  });

  try {
    const result = await runSelfPlayChunk(options, gpuClient);
    const payload: WorkerOutput = {
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stateFeatureNames: buildHiveTokenStateFeatureNames(HIVE_DEFAULT_TOKEN_SLOTS),
      actionFeatureNames: [...HIVE_ACTION_FEATURE_NAMES],
      samples: result.samples,
      summary: {
        games: options.games,
        whiteWins: result.whiteWins,
        blackWins: result.blackWins,
        draws: result.draws,
        totalMoves: result.totalMoves,
        totalSimulations: result.totalSimulations,
        sampleOrigin: options.sampleOrigin,
        gpuEnabled: true,
      },
    };

    mkdirSync(path.dirname(options.outPath), { recursive: true });
    writeFileSync(options.outPath, `${JSON.stringify(payload)}\n`, 'utf8');
    console.error(`[gpu-worker] Wrote ${result.samples.length} samples to ${options.outPath}`);
  } finally {
    await gpuClient.shutdown();
  }
}

async function runSelfPlayChunk(
  options: WorkerOptions,
  gpuClient: GpuInferenceClient,
): Promise<{
  samples: SelfPlaySample[];
  whiteWins: number;
  blackWins: number;
  draws: number;
  totalMoves: number;
  totalSimulations: number;
}> {
  const all: SelfPlaySample[] = [];
  let whiteWins = 0;
  let blackWins = 0;
  let draws = 0;
  let totalMoves = 0;
  let totalSimulations = 0;

  for (let gameIndex = 1; gameIndex <= options.games; gameIndex += 1) {
    console.error(`[gpu-worker] Starting game ${gameIndex}/${options.games}`);
    const rng = createRng(options.seed + gameIndex * 73);
    const perGame: SelfPlaySample[] = [];
    let state = createLocalHiveGameState({
      id: `azgpu-${Date.now()}-${gameIndex}`,
      shortCode: 'AZGPU',
      whitePlayerId: 'az-white',
      blackPlayerId: 'az-black',
    });

    let noProgress = 0;
    let prevPressure = queenPressure(state);

    while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
      const sims = rng() < options.fastRatio
        ? options.fastSimulations
        : options.simulations;

      const mctsConfig: Partial<HiveMctsConfig> = {
        simulations: Math.max(4, sims),
        dirichletAlpha: state.turnNumber < 10 ? 0.35 : 0.22,
        temperature: state.turnNumber < 15 ? 1.0 : 0.5,
        maxDepth: options.maxTurns,
      };

      const search = await runGpuMctsSearch(
        state,
        state.currentTurn,
        options.difficulty,
        gpuClient,
        mctsConfig,
        options.seed + gameIndex * 197 + state.turnNumber * 11,
        options.batchSize,
      );

      if (!search.selectedMove) {
        state = {
          ...state,
          status: 'finished',
          winner: state.currentTurn === 'white' ? 'black' : 'white',
        };
        break;
      }

      totalMoves += 1;
      totalSimulations += search.stats.simulations;
      const lengthBucket = state.turnNumber <= 60 ? 0 : state.turnNumber <= 120 ? 1 : 2;

      perGame.push({
        stateFeatures: extractHiveTokenStateFeatures(state, state.currentTurn, HIVE_DEFAULT_TOKEN_SLOTS),
        perspective: state.currentTurn,
        sampleOrigin: options.sampleOrigin,
        valueTarget: 0,
        policyTargets: search.policy.map((entry) => ({
          actionKey: entry.actionKey,
          probability: entry.rawProbability ?? entry.probability,
          visitCount: entry.rawVisits ?? entry.visits,
          actionFeatures: extractHiveActionFeatures(state, entry.move, state.currentTurn),
        })),
        auxTargets: {
          queenSurroundDelta: clamp(queenPressureSigned(state, state.currentTurn) / 6, -1, 1),
          mobility: estimateMobilityState(state, state.currentTurn),
          lengthBucket,
        },
        searchMeta: {
          simulations: search.stats.simulations,
          nodesPerSecond: search.stats.nodesPerSecond,
          policyEntropy: search.stats.policyEntropy,
          averageDepth: search.stats.averageSimulationDepth,
          dirichletAlpha: mctsConfig.dirichletAlpha ?? 0.22,
          temperature: mctsConfig.temperature ?? 0.5,
          maxDepth: mctsConfig.maxDepth ?? options.maxTurns,
          reanalysed: false,
        },
        stateSnapshot: cloneState(state),
      });

      state = applyHiveMove(state, search.selectedMove);
      const pressure = queenPressure(state);
      if (pressure === prevPressure) {
        noProgress += 1;
      } else {
        prevPressure = pressure;
        noProgress = 0;
      }

      if (options.noCaptureDrawMoves > 0 && noProgress >= options.noCaptureDrawMoves) {
        state = {
          ...state,
          status: 'finished',
          winner: 'draw',
        };
      }
    }

    if (state.status !== 'finished') {
      state = {
        ...state,
        status: 'finished',
        winner: 'draw',
      };
    }

    const winner = state.winner;
    if (winner === 'white') whiteWins += 1;
    else if (winner === 'black') blackWins += 1;
    else draws += 1;

    for (const sample of perGame) {
      sample.valueTarget = winner === 'draw' || !winner
        ? 0
        : winner === sample.perspective
          ? 1
          : -1;
    }

    all.push(...perGame);
    console.error(`[gpu-worker] Game ${gameIndex} finished: ${winner}, ${perGame.length} samples`);
  }

  return {
    samples: all,
    whiteWins,
    blackWins,
    draws,
    totalMoves,
    totalSimulations,
  };
}

interface GpuMctsSearchResult {
  selectedMove: Move | null;
  policy: Array<{
    actionKey: string;
    move: Move;
    visits: number;
    probability: number;
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

async function runGpuMctsSearch(
  state: GameState,
  color: PlayerColor,
  difficulty: HiveComputerDifficulty,
  gpuClient: GpuInferenceClient,
  mctsConfig: Partial<HiveMctsConfig>,
  seed: number,
  batchSize: number,
): Promise<GpuMctsSearchResult> {
  const config = {
    simulations: mctsConfig.simulations ?? 220,
    cPuct: mctsConfig.cPuct ?? 1.18,
    dirichletAlpha: mctsConfig.dirichletAlpha ?? 0.22,
    dirichletEpsilon: mctsConfig.dirichletEpsilon ?? 0.06,
    temperature: mctsConfig.temperature ?? 0.5,
    policyPruneTopK: mctsConfig.policyPruneTopK ?? 14,
    policyPruneMinProb: mctsConfig.policyPruneMinProb ?? 0.001,
    forcedPlayouts: mctsConfig.forcedPlayouts ?? 3,
    maxDepth: mctsConfig.maxDepth ?? 180,
  };

  const rng = createRng(seed);
  const startedAt = Date.now();
  const transposition = new Map<string, MctsNode>();

  let nodesExpanded = 0;
  let depthSum = 0;

  const rootHash = hashState(state);
  const root: MctsNode = {
    state,
    stateHash: rootHash,
    toPlay: color,
    visitCount: 0,
    valueSum: 0,
    expanded: false,
    edges: new Map(),
    policyEntropy: 0,
  };
  transposition.set(rootHash, root);

  // Expand root
  await expandNodeGpu(root, true, config, rng, gpuClient);
  nodesExpanded += 1;

  // Run simulations in batches
  let simulationsDone = 0;
  while (simulationsDone < config.simulations) {
    const currentBatchSize = Math.min(batchSize, config.simulations - simulationsDone);
    const leaves: BatchedLeaf[] = [];

    // Collect leaves
    for (let i = 0; i < currentBatchSize; i++) {
      const pathNodes: MctsNode[] = [root];
      const pathEdges: MctsEdge[] = [];
      let node = root;
      let depth = 0;

      // Selection
      while (
        node.expanded
        && node.edges.size > 0
        && node.state.status === 'playing'
        && depth < config.maxDepth
      ) {
        const edge = selectPuctEdge(node, config);
        if (!edge) break;

        edge.virtualLoss += 1;
        pathEdges.push(edge);

        if (!edge.child) {
          const nextState = applyHiveMove(node.state, edge.move);
          const nextHash = hashState(nextState);
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

      // Check terminal/max depth
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

      // Collect leaf for batch expansion
      const legalMoves = getLegalMovesForColor(node.state, node.toPlay);
      if (legalMoves.length === 0) {
        backpropagate(pathNodes, pathEdges, -1);
        depthSum += depth;
        simulationsDone += 1;
        continue;
      }

      leaves.push({ node, pathNodes, pathEdges, legalMoves });
    }

    // Batch expand leaves
    if (leaves.length > 0) {
      await batchExpandLeaves(leaves, config, rng, gpuClient);
      nodesExpanded += leaves.length;

      // Backpropagate
      for (const leaf of leaves) {
        const value = (leaf.node as MctsNode & { pendingValue?: number }).pendingValue ?? 0;
        backpropagate(leaf.pathNodes, leaf.pathEdges, value);
        depthSum += leaf.pathEdges.length;
        simulationsDone += 1;
      }
    }
  }

  // Build policy
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
    .sort((a, b) => b.visits - a.visits || b.prior - a.prior);

  const totalVisits = Math.max(1, rootPolicies.reduce((sum, e) => sum + e.visits, 0));
  const totalRawVisits = Math.max(1, rootPolicies.reduce((sum, e) => sum + Math.max(0, e.rawVisits), 0));
  const temp = Math.max(0.01, config.temperature);
  const weighted = rootPolicies.map((e) => ({
    ...e,
    weight: Math.pow(Math.max(1e-6, e.visits / totalVisits), 1 / temp),
  }));
  const weightSum = weighted.reduce((sum, e) => sum + e.weight, 0);

  const policy = weighted.map((e) => ({
    actionKey: e.actionKey,
    move: e.move,
    visits: e.visits,
    rawVisits: e.rawVisits,
    prior: e.prior,
    qValue: e.qValue,
    rawProbability: e.rawVisits > 0 ? e.rawVisits / totalRawVisits : 0,
    probability: weightSum > 0 ? e.weight / weightSum : 1 / weighted.length,
  }));

  const policyEntropy = softmaxEntropy(policy.map((e) => e.probability));
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
  config: { policyPruneTopK: number; policyPruneMinProb: number; dirichletAlpha: number; dirichletEpsilon: number },
  rng: () => number,
  gpuClient: GpuInferenceClient,
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

  // Prepare GPU inference request
  const position: GpuInferencePosition = {
    stateFeatures: extractHiveTokenStateFeatures(node.state, node.toPlay, HIVE_DEFAULT_TOKEN_SLOTS),
    actions: legalMoves.map((move) => ({
      actionKey: moveToActionKey(move),
      actionFeatures: extractHiveActionFeatures(node.state, move, node.toPlay),
    })),
  };

  const result = await gpuClient.infer(position);

  // Build priors from logits
  const candidates = legalMoves
    .map((move) => ({
      move,
      actionKey: moveToActionKey(move),
      logit: result.actionLogits[moveToActionKey(move)] ?? 0,
    }))
    .sort((a, b) => b.logit - a.logit);

  const topK = candidates.slice(0, config.policyPruneTopK);
  const priors = normalizeSoftmax(topK.map((c) => c.logit));

  let filteredPriors = topK
    .map((c, i) => ({ move: c.move, actionKey: c.actionKey, prior: priors[i] }))
    .filter((p) => p.prior >= config.policyPruneMinProb);

  if (filteredPriors.length === 0) {
    filteredPriors = [{ move: topK[0].move, actionKey: topK[0].actionKey, prior: 1 }];
  }

  // Apply Dirichlet noise at root
  if (isRoot && filteredPriors.length > 1 && config.dirichletEpsilon > 0) {
    const noise = sampleDirichlet(filteredPriors.length, config.dirichletAlpha, rng);
    filteredPriors = filteredPriors.map((p, i) => ({
      ...p,
      prior: p.prior * (1 - config.dirichletEpsilon) + noise[i] * config.dirichletEpsilon,
    }));
  }

  // Normalize and create edges
  const priorSum = Math.max(1e-9, filteredPriors.reduce((sum, p) => sum + p.prior, 0));
  node.edges = new Map();
  for (const p of filteredPriors) {
    node.edges.set(p.actionKey, {
      actionKey: p.actionKey,
      move: p.move,
      prior: p.prior / priorSum,
      visitCount: 0,
      valueSum: 0,
      virtualLoss: 0,
    });
  }

  node.policyEntropy = softmaxEntropy([...node.edges.values()].map((e) => e.prior));
  node.expanded = true;
  return clamp(result.value, -1, 1);
}

async function batchExpandLeaves(
  leaves: BatchedLeaf[],
  config: { policyPruneTopK: number; policyPruneMinProb: number; dirichletAlpha: number; dirichletEpsilon: number },
  rng: () => number,
  gpuClient: GpuInferenceClient,
): Promise<void> {
  // Prepare batch request
  const positions: GpuInferencePosition[] = leaves.map((leaf) => ({
    stateFeatures: extractHiveTokenStateFeatures(leaf.node.state, leaf.node.toPlay, HIVE_DEFAULT_TOKEN_SLOTS),
    actions: leaf.legalMoves.map((move) => ({
      actionKey: moveToActionKey(move),
      actionFeatures: extractHiveActionFeatures(leaf.node.state, move, leaf.node.toPlay),
    })),
  }));

  const results = await gpuClient.inferBatch(positions);

  // Process results
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    const result = results[i];
    const isRoot = leaf.pathEdges.length === 0;

    // Build priors
    const candidates = leaf.legalMoves
      .map((move) => ({
        move,
        actionKey: moveToActionKey(move),
        logit: result.actionLogits[moveToActionKey(move)] ?? 0,
      }))
      .sort((a, b) => b.logit - a.logit);

    const topK = candidates.slice(0, config.policyPruneTopK);
    const priors = normalizeSoftmax(topK.map((c) => c.logit));

    let filteredPriors = topK
      .map((c, j) => ({ move: c.move, actionKey: c.actionKey, prior: priors[j] }))
      .filter((p) => p.prior >= config.policyPruneMinProb);

    if (filteredPriors.length === 0) {
      filteredPriors = [{ move: topK[0].move, actionKey: topK[0].actionKey, prior: 1 }];
    }

    if (isRoot && filteredPriors.length > 1 && config.dirichletEpsilon > 0) {
      const noise = sampleDirichlet(filteredPriors.length, config.dirichletAlpha, rng);
      filteredPriors = filteredPriors.map((p, j) => ({
        ...p,
        prior: p.prior * (1 - config.dirichletEpsilon) + noise[j] * config.dirichletEpsilon,
      }));
    }

    const priorSum = Math.max(1e-9, filteredPriors.reduce((sum, p) => sum + p.prior, 0));
    leaf.node.edges = new Map();
    for (const p of filteredPriors) {
      leaf.node.edges.set(p.actionKey, {
        actionKey: p.actionKey,
        move: p.move,
        prior: p.prior / priorSum,
        visitCount: 0,
        valueSum: 0,
        virtualLoss: 0,
      });
    }

    leaf.node.policyEntropy = softmaxEntropy([...leaf.node.edges.values()].map((e) => e.prior));
    leaf.node.expanded = true;
    (leaf.node as MctsNode & { pendingValue: number }).pendingValue = clamp(result.value, -1, 1);
  }
}

function selectPuctEdge(
  node: MctsNode,
  config: { cPuct: number },
): MctsEdge | null {
  let bestEdge: MctsEdge | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const sqrtVisits = Math.sqrt(node.visitCount + 1);

  for (const edge of node.edges.values()) {
    const effectiveVisits = edge.visitCount + edge.virtualLoss;
    const qValue = effectiveVisits > 0 ? edge.valueSum / effectiveVisits : 0;
    const uValue = config.cPuct * edge.prior * sqrtVisits / (1 + effectiveVisits);
    const score = qValue + uValue;

    if (score > bestScore) {
      bestScore = score;
      bestEdge = edge;
    }
  }

  return bestEdge;
}

function backpropagate(
  pathNodes: MctsNode[],
  pathEdges: MctsEdge[],
  value: number,
): void {
  let backedValue = value;
  for (let i = pathNodes.length - 1; i >= 0; i--) {
    const node = pathNodes[i];
    node.visitCount += 1;
    node.valueSum += backedValue;

    if (i > 0) {
      const edge = pathEdges[i - 1];
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

// Utility functions
function parseOptions(argv: string[]): WorkerOptions {
  const options: WorkerOptions = {
    games: 2,
    difficulty: 'extreme',
    maxTurns: 320,
    noCaptureDrawMoves: 100,
    simulations: 220,
    fastSimulations: 72,
    fastRatio: 0.55,
    seed: 2026,
    modelPath: null,
    sampleOrigin: 'learner',
    outPath: '.hive-cache/async/chunks/chunk.json',
    batchSize: 64,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--games': options.games = parseInt(next, 10); i++; break;
      case '--difficulty': options.difficulty = next as HiveComputerDifficulty; i++; break;
      case '--max-turns': options.maxTurns = parseInt(next, 10); i++; break;
      case '--no-capture-draw': options.noCaptureDrawMoves = parseInt(next, 10); i++; break;
      case '--simulations': options.simulations = parseInt(next, 10); i++; break;
      case '--fast-simulations': options.fastSimulations = parseInt(next, 10); i++; break;
      case '--fast-ratio': options.fastRatio = parseFloat(next); i++; break;
      case '--seed': options.seed = parseInt(next, 10); i++; break;
      case '--model': options.modelPath = next; i++; break;
      case '--sample-origin': options.sampleOrigin = next as SelfPlaySampleOrigin; i++; break;
      case '--out': options.outPath = next; i++; break;
      case '--batch-size': options.batchSize = parseInt(next, 10); i++; break;
    }
  }

  options.outPath = path.resolve(process.cwd(), options.outPath);
  if (options.modelPath) {
    options.modelPath = path.resolve(process.cwd(), options.modelPath);
  }
  return options;
}

function hashState(state: GameState): string {
  const boardStr = state.board
    .map((p) => `${p.id}:${p.position.q},${p.position.r}:${p.stackOrder}`)
    .sort()
    .join('|');
  const key = `${boardStr}|${state.currentTurn}|${state.turnNumber}`;
  // Simple hash
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

function createRng(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state <= 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function queenPressure(state: GameState): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function queenPressureSigned(state: GameState, perspective: PlayerColor): number {
  const opp = perspective === 'white' ? 'black' : 'white';
  return getQueenSurroundCount(state.board, opp) - getQueenSurroundCount(state.board, perspective);
}

function estimateMobilityState(state: GameState, perspective: PlayerColor): number {
  const opp = perspective === 'white' ? 'black' : 'white';
  const myMoves = getLegalMovesForColor(state, perspective).length;
  const oppMoves = getLegalMovesForColor(state, opp).length;
  return clamp((myMoves - oppMoves) / 40, -1, 1);
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    settings: {
      ...state.settings,
      expansionPieces: { ...state.settings.expansionPieces },
    },
    board: state.board.map((p) => ({ ...p, position: { ...p.position } })),
    whiteHand: state.whiteHand.map((p) => ({ ...p })),
    blackHand: state.blackHand.map((p) => ({ ...p })),
    lastMovedPiece: state.lastMovedPiece
      ? {
          ...state.lastMovedPiece,
          from: state.lastMovedPiece.from ? { ...state.lastMovedPiece.from } : undefined,
          to: { ...state.lastMovedPiece.to },
        }
      : null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSoftmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const max = Math.max(...logits);
  const exp = logits.map((l) => Math.exp(l - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}

function softmaxEntropy(probs: number[]): number {
  let entropy = 0;
  for (const p of probs) {
    if (p > 1e-9) entropy -= p * Math.log(p);
  }
  return entropy;
}

function sampleDirichlet(n: number, alpha: number, rng: () => number): number[] {
  // Approximate gamma sampling using Marsaglia and Tsang's method
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    // Simple approximation for small alpha
    let sum = 0;
    for (let j = 0; j < Math.ceil(alpha * 10); j++) {
      sum -= Math.log(1 - rng());
    }
    samples.push(sum);
  }
  const total = samples.reduce((a, b) => a + b, 0);
  return samples.map((s) => s / total);
}

main().catch((error) => {
  console.error('[gpu-worker] Fatal error:', error);
  process.exit(1);
});
