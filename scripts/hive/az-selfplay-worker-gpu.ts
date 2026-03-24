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
import { GpuInferenceClient } from './gpu-inference-client';
import { clamp, createSeededRng, runGpuMctsSearch } from './gpu-mcts';

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
  gamesInFlight: number;
  batchDelayMs: number;
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

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  // Start GPU inference server
  const modelPath = options.modelPath ?? 'lib/hive/trained-model.json';
  console.error(`[gpu-worker] Starting GPU inference server with model: ${modelPath}`);

  const gpuClient = await GpuInferenceClient.start(modelPath, {
    batchDelayMs: options.batchDelayMs,
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
  let nextGameIndex = 1;

  const runSlot = async (slotIndex: number): Promise<void> => {
    while (true) {
      const gameIndex = nextGameIndex;
      nextGameIndex += 1;
      if (gameIndex > options.games) {
        return;
      }

      console.error(
        `[gpu-worker] slot=${slotIndex} starting game ${gameIndex}/${options.games}`,
      );
      const result = await runSelfPlayGame(options, gpuClient, gameIndex);
      whiteWins += result.winner === 'white' ? 1 : 0;
      blackWins += result.winner === 'black' ? 1 : 0;
      draws += result.winner === 'draw' || !result.winner ? 1 : 0;
      totalMoves += result.totalMoves;
      totalSimulations += result.totalSimulations;
      all.push(...result.samples);
      console.error(
        `[gpu-worker] slot=${slotIndex} finished game ${gameIndex}: ${result.winner}, ${result.samples.length} samples`,
      );
    }
  };

  const slotCount = Math.max(1, Math.min(options.gamesInFlight, options.games));
  await Promise.all(Array.from({ length: slotCount }, (_, index) => runSlot(index + 1)));

  return {
    samples: all,
    whiteWins,
    blackWins,
    draws,
    totalMoves,
    totalSimulations,
  };
}

async function runSelfPlayGame(
  options: WorkerOptions,
  gpuClient: GpuInferenceClient,
  gameIndex: number,
): Promise<{
  winner: 'white' | 'black' | 'draw' | null;
  samples: SelfPlaySample[];
  totalMoves: number;
  totalSimulations: number;
}> {
  const rng = createSeededRng(options.seed + gameIndex * 73);
  const perGame: SelfPlaySample[] = [];
  let totalMoves = 0;
  let totalSimulations = 0;
  let state = createLocalHiveGameState({
    id: `azgpu-${Date.now()}-${gameIndex}`,
    shortCode: 'AZGPU',
    whitePlayerId: 'az-white',
    blackPlayerId: 'az-black',
  });

  let noProgress = 0;
  let prevPressure = queenPressure(state);

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const sims = rng() < options.fastRatio ? options.fastSimulations : options.simulations;
    const search = await runGpuMctsSearch({
      state,
      color: state.currentTurn,
      gpuClient,
      seed: options.seed + gameIndex * 197 + state.turnNumber * 11,
      leafBatchSize: options.batchSize,
      mctsConfig: {
        simulations: Math.max(4, sims),
        dirichletAlpha: state.turnNumber < 10 ? 0.35 : 0.22,
        temperature: state.turnNumber < 15 ? 1.0 : 0.5,
        maxDepth: options.maxTurns,
      },
    });

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
        probability: entry.rawProbability,
        visitCount: entry.rawVisits,
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
        dirichletAlpha: state.turnNumber < 10 ? 0.35 : 0.22,
        temperature: state.turnNumber < 15 ? 1.0 : 0.5,
        maxDepth: options.maxTurns,
        reanalysed: false,
      },
      stateSnapshot: cloneState(state),
    });

    state = applyHiveMove(state, search.selectedMove);
    const pressure = queenPressure(state);
    if (pressure === prevPressure) noProgress += 1;
    else {
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

  for (const sample of perGame) {
    sample.valueTarget = state.winner === 'draw' || !state.winner
      ? 0
      : state.winner === sample.perspective
        ? 1
        : -1;
  }

  return {
    winner: state.winner,
    samples: perGame,
    totalMoves,
    totalSimulations,
  };
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
    gamesInFlight: 4,
    batchDelayMs: 1,
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
      case '--games-in-flight': options.gamesInFlight = parseInt(next, 10); i++; break;
      case '--batch-delay-ms': options.batchDelayMs = parseInt(next, 10); i++; break;
    }
  }

  options.outPath = path.resolve(process.cwd(), options.outPath);
  if (options.modelPath) {
    options.modelPath = path.resolve(process.cwd(), options.modelPath);
  }
  return options;
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

main().catch((error) => {
  console.error('[gpu-worker] Fatal error:', error);
  process.exit(1);
});
