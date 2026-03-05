import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { HiveComputerDifficulty, HiveSearchEngine, HiveSearchStats } from '../../lib/hive/ai';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  getLegalMovesForColor,
  oppositeColor,
} from '../../lib/hive/ai';
import { getActiveHiveModel, parseHiveModel, type HiveModel } from '../../lib/hive/ml';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import { getHiveHardwareProfile } from './hardware-profile';
import type { Move, PlayerColor } from '../../lib/hive/types';

interface EvalOptions {
  games: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  progressEvery: number;
  workers: number;
  verbose: boolean;
  suite: BenchmarkSuiteName;
  seed: number;
  engine: HiveSearchEngine;
  modelPath: string | null;
  baselineModelPath: string | null;
  metricsLogPath: string;
}

interface EvalSummary {
  turnsPlayed: number;
  winner: PlayerColor | null;
  candidateColor: PlayerColor;
  terminalReason: 'queen_surrounded' | 'no_moves' | 'max_turns' | 'no_capture_streak';
  noProgressStreak: number;
  durationMs: number;
}

interface EvalAggregate {
  games: number;
  candidateWins: number;
  baselineWins: number;
  draws: number;
  totalTurns: number;
  maxTurnsDraws: number;
  noCaptureDraws: number;
  searchStats: {
    candidateMoves: number;
    candidateSimulations: number;
    candidateNodesPerSecondSum: number;
    candidatePolicyEntropySum: number;
  };
}

interface MetricsLogger {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
}

type BenchmarkSuiteName = 'baseline_v1' | 'opening_diversity' | 'long_stress' | 'no_progress_stress';

interface BenchmarkSuite {
  games: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
}

const HARDWARE_PROFILE = getHiveHardwareProfile();

const BENCHMARK_SUITES: Record<BenchmarkSuiteName, BenchmarkSuite> = {
  baseline_v1: {
    games: 60,
    difficulty: 'extreme',
    maxTurns: 300,
    noCaptureDrawMoves: 100,
    openingRandomPlies: 0,
  },
  opening_diversity: {
    games: 80,
    difficulty: 'hard',
    maxTurns: 280,
    noCaptureDrawMoves: 95,
    openingRandomPlies: 6,
  },
  long_stress: {
    games: 60,
    difficulty: 'extreme',
    maxTurns: 420,
    noCaptureDrawMoves: 150,
    openingRandomPlies: 0,
  },
  no_progress_stress: {
    games: 80,
    difficulty: 'hard',
    maxTurns: 320,
    noCaptureDrawMoves: 45,
    openingRandomPlies: 2,
  },
};

const DEFAULT_OPTIONS: EvalOptions = {
  games: BENCHMARK_SUITES.baseline_v1.games,
  difficulty: BENCHMARK_SUITES.baseline_v1.difficulty,
  maxTurns: BENCHMARK_SUITES.baseline_v1.maxTurns,
  noCaptureDrawMoves: BENCHMARK_SUITES.baseline_v1.noCaptureDrawMoves,
  progressEvery: 10,
  workers: HARDWARE_PROFILE.evalWorkers,
  verbose: false,
  suite: 'baseline_v1',
  seed: 1337,
  engine: 'classic',
  modelPath: null,
  baselineModelPath: null,
  metricsLogPath: '.hive-cache/metrics/training-metrics.jsonl',
};

async function main(): Promise<void> {
  const options = applySuiteDefaults(parseOptions(process.argv.slice(2)));
  const logger = createMetricsLogger(options.metricsLogPath);

  const candidateModel = options.modelPath
    ? loadHiveModelFromPath(options.modelPath)
    : getActiveHiveModel();
  const baselineModel = options.baselineModelPath
    ? loadHiveModelFromPath(options.baselineModelPath)
    : null;
  const baselineSource = baselineModel ? 'model' : 'heuristic';

  const candidateModelPath = options.modelPath
    ? path.resolve(process.cwd(), options.modelPath)
    : path.resolve(process.cwd(), 'lib/hive/trained-model.json');
  const baselineModelPath = options.baselineModelPath
    ? path.resolve(process.cwd(), options.baselineModelPath)
    : null;

  console.log(
    `[eval:setup] suite=${options.suite} seed=${options.seed} engine=${options.engine} games=${options.games} difficulty=${options.difficulty} maxTurns=${options.maxTurns} noProgressDraw=${options.noCaptureDrawMoves} baseline=${baselineSource}`,
  );
  console.log(`[eval:setup] candidate=${describeModel(candidateModel)} path=${candidateModelPath}`);
  if (baselineModelPath && baselineModel) {
    console.log(`[eval:setup] baseline=${describeModel(baselineModel)} path=${baselineModelPath}`);
  } else {
    console.log('[eval:setup] baseline=heuristic-only (model blend disabled)');
  }

  logger.log('run_start', {
    options: {
      games: options.games,
      difficulty: options.difficulty,
      workers: options.workers,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
        progressEvery: options.progressEvery,
        suite: options.suite,
        seed: options.seed,
        engine: options.engine,
        candidateModelPath,
        baselineModelPath,
        baselineSource,
      mode: 'single',
    },
    candidateModel: summarizeModel(candidateModel),
    baselineModel: baselineModel ? summarizeModel(baselineModel) : null,
    pid: process.pid,
  });

  const startedAt = performance.now();
  const aggregate: EvalAggregate = {
    games: options.games,
    candidateWins: 0,
    baselineWins: 0,
    draws: 0,
    totalTurns: 0,
    maxTurnsDraws: 0,
    noCaptureDraws: 0,
    searchStats: {
      candidateMoves: 0,
      candidateSimulations: 0,
      candidateNodesPerSecondSum: 0,
      candidatePolicyEntropySum: 0,
    },
  };

  for (let gameIndex = 1; gameIndex <= options.games; gameIndex += 1) {
    const summary = runEvalGame(gameIndex, options, candidateModel, baselineModel, aggregate);
    aggregate.totalTurns += summary.turnsPlayed;

    if (!summary.winner) {
      aggregate.draws += 1;
      if (summary.terminalReason === 'max_turns') aggregate.maxTurnsDraws += 1;
      if (summary.terminalReason === 'no_capture_streak') aggregate.noCaptureDraws += 1;
    } else if (summary.winner === summary.candidateColor) {
      aggregate.candidateWins += 1;
    } else {
      aggregate.baselineWins += 1;
    }

    if (options.verbose || gameIndex % options.progressEvery === 0 || gameIndex === options.games) {
      const elapsedMs = performance.now() - startedAt;
      const etaMs = estimateRemainingMs(elapsedMs, gameIndex, options.games);
      const candidateScore = (aggregate.candidateWins + aggregate.draws * 0.5) / gameIndex;
      console.log(
        `[eval] ${gameIndex}/${options.games} winner=${summary.winner ?? 'draw'} candidate_color=${summary.candidateColor} reason=${summary.terminalReason} turns=${summary.turnsPlayed} no_progress=${summary.noProgressStreak} score=${(candidateScore * 100).toFixed(1)}% W/L/D=${aggregate.candidateWins}/${aggregate.baselineWins}/${aggregate.draws} elapsed=${formatDuration(elapsedMs)} eta=${formatDuration(etaMs)}`,
      );
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const candidateScore = (aggregate.candidateWins + aggregate.draws * 0.5) / aggregate.games;
  const eloEstimate = scoreToElo(candidateScore);
  const avgTurns = aggregate.totalTurns / aggregate.games;
  const avgSimulationsPerMove = aggregate.searchStats.candidateMoves > 0
    ? aggregate.searchStats.candidateSimulations / aggregate.searchStats.candidateMoves
    : 0;
  const avgNodesPerSecond = aggregate.searchStats.candidateMoves > 0
    ? aggregate.searchStats.candidateNodesPerSecondSum / aggregate.searchStats.candidateMoves
    : 0;
  const avgPolicyEntropy = aggregate.searchStats.candidateMoves > 0
    ? aggregate.searchStats.candidatePolicyEntropySum / aggregate.searchStats.candidateMoves
    : 0;

  console.log(
    `[eval:done] games=${aggregate.games} score=${(candidateScore * 100).toFixed(1)}% elo=${eloEstimate.toFixed(1)} W/L/D=${aggregate.candidateWins}/${aggregate.baselineWins}/${aggregate.draws} avg_turns=${avgTurns.toFixed(1)} sims_per_move=${avgSimulationsPerMove.toFixed(2)} nodes_per_sec=${avgNodesPerSecond.toFixed(1)} elapsed=${formatDuration(elapsedMs)}`,
  );

  logger.log('benchmark_result', {
    games: aggregate.games,
    difficulty: options.difficulty,
    workers: options.workers,
    maxTurns: options.maxTurns,
    noCaptureDrawMoves: options.noCaptureDrawMoves,
    candidateWins: aggregate.candidateWins,
    baselineWins: aggregate.baselineWins,
    draws: aggregate.draws,
    candidateScore,
    eloEstimate,
    winRate: aggregate.candidateWins / aggregate.games,
    drawRate: aggregate.draws / aggregate.games,
    lossRate: aggregate.baselineWins / aggregate.games,
    avgTurns,
    maxTurnsDraws: aggregate.maxTurnsDraws,
    noCaptureDraws: aggregate.noCaptureDraws,
    avgSimulationsPerMove,
    searchNodesPerSec: avgNodesPerSecond,
    policyEntropy: avgPolicyEntropy,
    benchmarkSuite: options.suite,
    benchmarkSeed: options.seed,
    baselineVersion: 'baseline_v1',
    baselineSource,
    candidateModel: summarizeModel(candidateModel),
    baselineModel: baselineModel ? summarizeModel(baselineModel) : null,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
  });

  logger.log('elo_update', {
    benchmarkSuite: options.suite,
    candidateScore,
    eloEstimate,
    baselineVersion: 'baseline_v1',
  });

  logger.log('run_end', {
    status: 'completed',
    games: aggregate.games,
    candidateScore,
    candidateWins: aggregate.candidateWins,
    baselineWins: aggregate.baselineWins,
    draws: aggregate.draws,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
  });
}

function runEvalGame(
  gameIndex: number,
  options: EvalOptions,
  candidateModel: HiveModel,
  baselineModel: HiveModel | null,
  aggregate: EvalAggregate,
): EvalSummary {
  const startedAt = performance.now();
  const suite = BENCHMARK_SUITES[options.suite];
  const rng = createRng(options.seed + gameIndex * 97);
  let state = createLocalHiveGameState({
    id: `eval-${Date.now()}-${gameIndex}`,
    shortCode: 'EVAL',
    whitePlayerId: 'candidate',
    blackPlayerId: 'baseline',
  });

  const candidateColor: PlayerColor = gameIndex % 2 === 1 ? 'white' : 'black';
  let noProgressStreak = 0;
  let prevPressure = queenPressureTotal(state);
  let terminalReason: EvalSummary['terminalReason'] = 'max_turns';
  let openingPly = 0;

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const activeColor = state.currentTurn;
    const isCandidateTurn = activeColor === candidateColor;
    let move: Move | null = null;

    if (openingPly < suite.openingRandomPlies) {
      const legal = getLegalMovesForColor(state, activeColor);
      if (legal.length > 0) {
        move = legal[Math.floor(rng() * legal.length)];
      }
      openingPly += 1;
    } else {
      let capturedStats: HiveSearchStats | null = null;
      move = chooseHiveMoveForColor(
        state,
        activeColor,
        options.difficulty,
        isCandidateTurn
          ? {
              modelOverride: candidateModel,
              engine: options.engine,
              randomSeed: options.seed + gameIndex * 103 + state.turnNumber,
              onSearchStats: (stats) => {
                capturedStats = stats;
              },
            }
          : baselineModel
            ? {
                modelOverride: baselineModel,
                engine: options.engine,
                randomSeed: options.seed + gameIndex * 109 + state.turnNumber,
              }
            : {
                disableModelBlend: true,
                engine: 'classic',
              },
      );

      const statsSnapshot = capturedStats as HiveSearchStats | null;
      if (isCandidateTurn && statsSnapshot) {
        aggregate.searchStats.candidateMoves += 1;
        aggregate.searchStats.candidateSimulations += statsSnapshot.simulations;
        aggregate.searchStats.candidateNodesPerSecondSum += statsSnapshot.nodesPerSecond;
        aggregate.searchStats.candidatePolicyEntropySum += statsSnapshot.policyEntropy;
      }
    }

    if (!move) {
      state = {
        ...state,
        status: 'finished',
        winner: oppositeColor(activeColor),
      };
      terminalReason = 'no_moves';
      break;
    }

    state = applyHiveMove(state, move);

    const pressure = queenPressureTotal(state);
    if (pressure === prevPressure) {
      noProgressStreak += 1;
    } else {
      noProgressStreak = 0;
      prevPressure = pressure;
    }

    if (options.noCaptureDrawMoves > 0 && noProgressStreak >= options.noCaptureDrawMoves) {
      state = {
        ...state,
        status: 'finished',
        winner: 'draw',
      };
      terminalReason = 'no_capture_streak';
      break;
    }

    if (state.status === 'finished') {
      terminalReason = 'queen_surrounded';
      break;
    }
  }

  if (state.status === 'playing') {
    state = {
      ...state,
      status: 'finished',
      winner: 'draw',
    };
    terminalReason = 'max_turns';
  }

  const winner = state.winner === 'draw' ? null : state.winner;

  return {
    turnsPlayed: state.turnNumber,
    winner,
    candidateColor,
    terminalReason,
    noProgressStreak,
    durationMs: performance.now() - startedAt,
  };
}

function queenPressureTotal(state: ReturnType<typeof createLocalHiveGameState>): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function loadHiveModelFromPath(relativePath: string): HiveModel {
  const absolute = path.resolve(process.cwd(), relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`Model path not found: ${relativePath}`);
  }

  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
  const model = parseHiveModel(parsed);
  if (!model) {
    throw new Error(`Invalid Hive model file: ${relativePath}`);
  }
  return model;
}

function describeModel(model: HiveModel): string {
  if (model.kind === 'policy_value') {
    const trunk = model.stateTrunk.map((layer) => layer.outputSize).join('x') || 'none';
    return `policy_value(trunk=${trunk}, state_features=${model.stateFeatureNames.length}, action_features=${model.actionFeatureNames.length}, samples=${model.training.positionSamples}, generated=${model.training.generatedAt})`;
  }
  if (model.kind === 'mlp') {
    const hidden = model.layers.slice(0, -1).map((layer) => layer.outputSize).join('x') || 'none';
    return `mlp(hidden=${hidden}, samples=${model.training.positionSamples}, generated=${model.training.generatedAt})`;
  }
  return `linear(features=${model.featureNames.length}, samples=${model.training.positionSamples}, generated=${model.training.generatedAt})`;
}

function summarizeModel(model: HiveModel): Record<string, unknown> {
  if (model.kind === 'policy_value') {
    return {
      kind: model.kind,
      version: model.version,
      featureCount: model.stateFeatureNames.length,
      actionFeatureCount: model.actionFeatureNames.length,
      positionSamples: model.training.positionSamples,
      generatedAt: model.training.generatedAt,
      epochs: model.training.epochs,
      difficulty: model.training.difficulty,
      framework: model.training.framework ?? null,
      hiddenLayers: model.stateTrunk.map((layer) => layer.outputSize),
    };
  }

  return {
    kind: model.kind ?? 'linear',
    version: model.version,
    featureCount: model.featureNames.length,
    positionSamples: model.training.positionSamples,
    generatedAt: model.training.generatedAt,
    epochs: model.training.epochs,
    difficulty: model.training.difficulty,
    framework: model.training.framework ?? null,
    hiddenLayers: model.kind === 'mlp'
      ? model.layers.slice(0, -1).map((layer) => layer.outputSize)
      : model.training.hiddenLayers ?? null,
  };
}

function parseOptions(argv: string[]): EvalOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsageAndExit();
  }

  const options: EvalOptions = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--games':
        options.games = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--difficulty':
        options.difficulty = parseDifficulty(next);
        index += 1;
        break;
      case '--suite':
        options.suite = parseSuite(next);
        {
          const suite = BENCHMARK_SUITES[options.suite];
          options.games = suite.games;
          options.difficulty = suite.difficulty;
          options.maxTurns = suite.maxTurns;
          options.noCaptureDrawMoves = suite.noCaptureDrawMoves;
        }
        index += 1;
        break;
      case '--seed':
        options.seed = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--engine':
        options.engine = parseEngine(next);
        index += 1;
        break;
      case '--max-turns':
        options.maxTurns = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--no-capture-draw':
        options.noCaptureDrawMoves = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--progress-every':
        options.progressEvery = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--workers':
        options.workers = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--model':
      case '--model-path':
        if (!next) throw new Error(`Missing value for ${arg}`);
        options.modelPath = next;
        index += 1;
        break;
      case '--baseline-model':
      case '--baseline-model-path':
        if (!next) throw new Error(`Missing value for ${arg}`);
        options.baselineModelPath = next;
        index += 1;
        break;
      case '--metrics-log':
        if (!next) throw new Error('Missing value for --metrics-log');
        options.metricsLogPath = next;
        index += 1;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  return options;
}

function applySuiteDefaults(options: EvalOptions): EvalOptions {
  const suite = BENCHMARK_SUITES[options.suite];
  return {
    ...options,
    games: options.games || suite.games,
    difficulty: options.difficulty ?? suite.difficulty,
    maxTurns: options.maxTurns || suite.maxTurns,
    noCaptureDrawMoves: options.noCaptureDrawMoves || suite.noCaptureDrawMoves,
  };
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (!value) throw new Error('Missing value for --difficulty');
  if (value === 'medium' || value === 'hard' || value === 'extreme') {
    return value;
  }
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseSuite(value: string | undefined): BenchmarkSuiteName {
  if (!value) throw new Error('Missing value for --suite');
  if (
    value === 'baseline_v1'
    || value === 'opening_diversity'
    || value === 'long_stress'
    || value === 'no_progress_stress'
  ) {
    return value;
  }
  throw new Error(`Invalid --suite value: ${value}`);
}

function parseEngine(value: string | undefined): HiveSearchEngine {
  if (!value) throw new Error('Missing value for --engine');
  if (value === 'classic' || value === 'alphazero' || value === 'gumbel') {
    return value;
  }
  throw new Error(`Invalid --engine value: ${value}`);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function printUsageAndExit(): never {
  console.log('Usage: npm run hive:eval -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --games <n>              Number of benchmark games (default: 60)');
  console.log('  --difficulty <d>         medium|hard|extreme (default: extreme)');
  console.log('  --suite <name>           baseline_v1|opening_diversity|long_stress|no_progress_stress');
  console.log('  --seed <n>               Deterministic seed (default: 1337)');
  console.log('  --engine <name>          classic|alphazero|gumbel (default: classic)');
  console.log('  --max-turns <n>          Max turns per game before forced draw (default: 300)');
  console.log('  --no-capture-draw <n>    Draw after N moves with no queen-pressure progress (default: 100, 0 disables)');
  console.log('  --progress-every <n>     Progress print interval in games (default: 10)');
  console.log('  --model-path <path>      Candidate model path (default: lib/hive/trained-model.json)');
  console.log('  --baseline-model-path <path>  Optional baseline model path');
  console.log('  --metrics-log <path>     Benchmark metrics JSONL path (default: .hive-cache/metrics/training-metrics.jsonl)');
  console.log('  --verbose, -v            Verbose per-game output');
  process.exit(0);
}

function createRng(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state <= 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function scoreToElo(score: number): number {
  const clipped = Math.min(0.999, Math.max(0.001, score));
  return 400 * Math.log10(clipped / (1 - clipped));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function estimateRemainingMs(elapsedMs: number, completed: number, total: number): number {
  if (completed <= 0 || total <= completed) return 0;
  const averagePerUnit = elapsedMs / completed;
  return Math.max(0, Math.round((total - completed) * averagePerUnit));
}

function createMetricsLogger(configuredPath: string): MetricsLogger {
  const runId = `eval-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const metricsPath = path.resolve(process.cwd(), configuredPath);
  let warned = false;

  const log = (eventType: string, payload: Record<string, unknown>): void => {
    try {
      mkdirSync(path.dirname(metricsPath), { recursive: true });
      appendFileSync(
        metricsPath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          source: 'eval',
          eventType,
          runId,
          ...payload,
        })}\n`,
        'utf8',
      );
    } catch (error) {
      if (warned) return;
      warned = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[warn] Failed to write metrics log: ${message}`);
    }
  };

  return { runId, log };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
