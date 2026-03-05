import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { HiveComputerDifficulty } from '../../lib/hive/ai';
import {
  HIVE_FEATURE_NAMES,
  HIVE_LINEAR_MODEL_VERSION,
  getActiveHiveModel,
  type HiveLinearModel,
} from '../../lib/hive/ml';
import {
  runSelfPlayBatch,
  type SelfPlayGameSummary,
  type TrainingSample,
} from './training-core';
import { getHiveHardwareProfile } from './hardware-profile';

interface TrainOptions {
  games: number;
  epochs: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  learningRate: number;
  l2: number;
  verbose: boolean;
  traceTurns: boolean;
  progressEvery: number;
  workers: number;
  datasetOut: string | null;
  skipFit: boolean;
}

interface MetricSummary {
  mse: number;
  mae: number;
  signAccuracy: number;
}

interface SelfPlayAggregate {
  samples: TrainingSample[];
  sampleCount: number;
  completedGames: number;
  whiteWins: number;
  blackWins: number;
  draws: number;
}

interface TrainingMetricsLogger {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
}

const HARDWARE_PROFILE = getHiveHardwareProfile();

const DEFAULT_OPTIONS: TrainOptions = {
  games: 160,
  epochs: 12,
  difficulty: 'hard',
  maxTurns: 220,
  noCaptureDrawMoves: 80,
  learningRate: 0.016,
  l2: 0.00035,
  verbose: false,
  traceTurns: false,
  progressEvery: 20,
  workers: HARDWARE_PROFILE.selfPlayWorkers,
  datasetOut: null,
  skipFit: false,
};

const DEFAULT_METRICS_LOG_PATH = '.hive-cache/metrics/training-metrics.jsonl';

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = performance.now();
  const logger = createTrainingMetricsLogger('linear');

  logStage(
    'setup',
    `Training Hive model | games=${options.games} difficulty=${options.difficulty} epochs=${options.epochs} maxTurns=${options.maxTurns} noProgressDraw=${options.noCaptureDrawMoves} workers=${options.workers}`,
  );
  if (options.verbose) {
    logStage(
      'setup',
      `verbose=${options.verbose} traceTurns=${options.traceTurns} progressEvery=${options.progressEvery} skipFit=${options.skipFit}`,
    );
  }

  logger.log('run_start', {
    options,
    pid: process.pid,
  });

  logStage('self-play', 'Generating self-play games and training samples...');
  const selfPlay = runSelfPlay(options, startedAt, logger);

  if (options.datasetOut) {
    logStage('save', `Writing dataset to ${options.datasetOut}...`);
    writeDatasetFile(options.datasetOut, selfPlay.samples, options);
  }

  if (options.skipFit) {
    const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(1);
    logStage('done', `Self-play complete in ${elapsedSec}s (model fitting skipped)`);
    logger.log('run_end', {
      status: 'self_play_only',
      elapsedSeconds: Number(elapsedSec),
      games: selfPlay.completedGames,
      samples: selfPlay.sampleCount,
      whiteWins: selfPlay.whiteWins,
      blackWins: selfPlay.blackWins,
      draws: selfPlay.draws,
    });
    return;
  }

  if (selfPlay.samples.length < 200) {
    throw new Error('Not enough samples were generated. Increase --games or --max-turns.');
  }

  logStage('train', `Fitting value model on ${selfPlay.samples.length} samples (${options.epochs} epochs)...`);
  const { trainedModel, trainMetrics, validationMetrics } = fitLinearModel(
    selfPlay.samples,
    options,
    logger,
  );

  logStage('save', 'Writing trained model to disk...');
  writeModelFile(trainedModel);

  const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(1);
  logStage('done', `Saved trained model to lib/hive/trained-model.json in ${elapsedSec}s`);
  console.log(
    `[metrics:train] mse=${trainMetrics.mse.toFixed(4)} mae=${trainMetrics.mae.toFixed(4)} sign_acc=${(trainMetrics.signAccuracy * 100).toFixed(1)}%`,
  );
  console.log(
    `[metrics:valid] mse=${validationMetrics.mse.toFixed(4)} mae=${validationMetrics.mae.toFixed(4)} sign_acc=${(validationMetrics.signAccuracy * 100).toFixed(1)}%`,
  );

  logger.log('run_end', {
    status: 'completed',
    elapsedSeconds: Number(elapsedSec),
    games: selfPlay.completedGames,
    samples: selfPlay.sampleCount,
    whiteWins: selfPlay.whiteWins,
    blackWins: selfPlay.blackWins,
    draws: selfPlay.draws,
    trainMse: trainMetrics.mse,
    trainMae: trainMetrics.mae,
    trainAcc: trainMetrics.signAccuracy,
    valMse: validationMetrics.mse,
    valMae: validationMetrics.mae,
    valAcc: validationMetrics.signAccuracy,
  });

  logStage('done', 'Restart `npm run dev` (or rebuild) so the app picks up the new model.');
}

function runSelfPlay(
  options: TrainOptions,
  startedAtMs: number,
  logger: TrainingMetricsLogger,
): SelfPlayAggregate {
  const aggregate: SelfPlayAggregate = {
    samples: [],
    sampleCount: 0,
    completedGames: 0,
    whiteWins: 0,
    blackWins: 0,
    draws: 0,
  };

  const batch = runSelfPlayBatch(
    1,
    options.games,
    {
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      traceTurns: options.traceTurns,
      traceLog: options.traceTurns ? (line) => console.log(`  [trace] ${line}`) : undefined,
    },
    (summary) => {
      applySummaryToAggregate(aggregate, summary);
      maybeLogSelfPlayProgress(options, aggregate, summary, startedAtMs, logger);
    },
  );

  aggregate.samples = batch.samples;
  aggregate.sampleCount = batch.samples.length;
  aggregate.completedGames = batch.summaries.length;
  aggregate.whiteWins = batch.whiteWins;
  aggregate.blackWins = batch.blackWins;
  aggregate.draws = batch.draws;

  return aggregate;
}

function applySummaryToAggregate(
  aggregate: SelfPlayAggregate,
  summary: SelfPlayGameSummary,
): void {
  aggregate.completedGames += 1;
  aggregate.sampleCount += summary.samplesAdded;
  if (summary.winner === 'white') aggregate.whiteWins += 1;
  else if (summary.winner === 'black') aggregate.blackWins += 1;
  else aggregate.draws += 1;
}

function maybeLogSelfPlayProgress(
  options: TrainOptions,
  aggregate: SelfPlayAggregate,
  summary: SelfPlayGameSummary,
  startedAtMs: number,
  logger: TrainingMetricsLogger,
): void {
  const shouldLog = options.verbose
    || aggregate.completedGames % options.progressEvery === 0
    || aggregate.completedGames === options.games;
  if (!shouldLog) return;

  const elapsedMs = performance.now() - startedAtMs;
  const etaMs = estimateRemainingMs(elapsedMs, aggregate.completedGames, options.games);
  const winnerLabel = summary.winner ?? 'draw';
  const prefix = options.verbose ? '[self-play:game]' : '[self-play]';

  console.log(
    `${prefix} ${aggregate.completedGames}/${options.games} turns=${summary.turnsPlayed} winner=${winnerLabel} reason=${summary.terminalReason} no_progress=${summary.noProgressStreak} samples=${aggregate.sampleCount} game_time=${formatDuration(summary.durationMs)} elapsed=${formatDuration(elapsedMs)} eta=${formatDuration(etaMs)} W/B/D=${aggregate.whiteWins}/${aggregate.blackWins}/${aggregate.draws}`,
  );

  logger.log('self_play_progress', {
    completedGames: aggregate.completedGames,
    totalGames: options.games,
    turnsPlayed: summary.turnsPlayed,
    winner: summary.winner,
    terminalReason: summary.terminalReason,
    noProgressStreak: summary.noProgressStreak,
    sampleCount: aggregate.sampleCount,
    whiteWins: aggregate.whiteWins,
    blackWins: aggregate.blackWins,
    draws: aggregate.draws,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
    etaSeconds: Number((etaMs / 1000).toFixed(3)),
  });
}

function fitLinearModel(
  samples: TrainingSample[],
  options: TrainOptions,
  logger: TrainingMetricsLogger,
): {
  trainedModel: HiveLinearModel;
  trainMetrics: MetricSummary;
  validationMetrics: MetricSummary;
} {
  const trainingStartedAt = performance.now();
  const shuffled = [...samples];
  shuffleInPlace(shuffled);

  const splitIndex = Math.max(1, Math.floor(shuffled.length * 0.9));
  const trainingSet = shuffled.slice(0, splitIndex);
  const validationSet = shuffled.slice(splitIndex);

  const featureCount = HIVE_FEATURE_NAMES.length;
  const priorModel = getActiveHiveModel();
  const canWarmStart = 'weights' in priorModel && priorModel.weights.length === featureCount;

  const weights = canWarmStart
    ? [...priorModel.weights]
    : Array.from({ length: featureCount }, () => 0);
  let bias = canWarmStart && 'bias' in priorModel ? priorModel.bias : 0;

  for (let epoch = 1; epoch <= options.epochs; epoch += 1) {
    shuffleInPlace(trainingSet);
    const epochLearningRate = options.learningRate * (1 - ((epoch - 1) / options.epochs) * 0.45);

    for (const sample of trainingSet) {
      const prediction = predictValue(sample.features, weights, bias);
      const error = prediction - sample.target;
      const gradientCore = 2 * error * (1 - prediction * prediction);

      bias -= epochLearningRate * gradientCore;

      for (let index = 0; index < featureCount; index += 1) {
        const grad = gradientCore * sample.features[index] + options.l2 * weights[index];
        weights[index] -= epochLearningRate * grad;
      }
    }

    const trainMetrics = evaluateSamples(trainingSet, weights, bias);
    const validMetrics = evaluateSamples(
      validationSet.length > 0 ? validationSet : trainingSet,
      weights,
      bias,
    );

    const elapsedMs = performance.now() - trainingStartedAt;
    const etaMs = estimateRemainingMs(elapsedMs, epoch, options.epochs);
    console.log(
      `[train] epoch ${epoch}/${options.epochs} lr=${epochLearningRate.toFixed(5)} train_mse=${trainMetrics.mse.toFixed(4)} valid_mse=${validMetrics.mse.toFixed(4)} valid_acc=${(validMetrics.signAccuracy * 100).toFixed(1)}% elapsed=${formatDuration(elapsedMs)} eta=${formatDuration(etaMs)}`,
    );

    logger.log('epoch', {
      epoch,
      totalEpochs: options.epochs,
      learningRate: epochLearningRate,
      trainMse: trainMetrics.mse,
      trainMae: trainMetrics.mae,
      trainAcc: trainMetrics.signAccuracy,
      valMse: validMetrics.mse,
      valMae: validMetrics.mae,
      valAcc: validMetrics.signAccuracy,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
      etaSeconds: Number((etaMs / 1000).toFixed(3)),
      sampleCount: samples.length,
    });
  }

  const trainedModel: HiveLinearModel = {
    version: HIVE_LINEAR_MODEL_VERSION,
    kind: 'linear',
    featureNames: [...HIVE_FEATURE_NAMES],
    weights: weights.map((weight) => roundNumber(weight, 8)),
    bias: roundNumber(bias, 8),
    training: {
      generatedAt: new Date().toISOString(),
      games: options.games,
      positionSamples: samples.length,
      epochs: options.epochs,
      difficulty: options.difficulty,
      framework: 'typescript',
      device: 'cpu',
      workers: options.workers,
      learningRate: options.learningRate,
    },
  };

  const trainMetrics = evaluateSamples(trainingSet, weights, bias);
  const validationMetrics = evaluateSamples(
    validationSet.length > 0 ? validationSet : trainingSet,
    weights,
    bias,
  );

  return { trainedModel, trainMetrics, validationMetrics };
}

function writeModelFile(model: HiveLinearModel): void {
  const outputPath = path.resolve(process.cwd(), 'lib/hive/trained-model.json');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
}

function writeDatasetFile(outputPath: string, samples: TrainingSample[], options: TrainOptions): void {
  const payload = {
    version: 1,
    featureNames: [...HIVE_FEATURE_NAMES],
    samples,
    meta: {
      generatedAt: new Date().toISOString(),
      games: options.games,
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      workers: options.workers,
    },
  };

  const absolutePath = path.resolve(process.cwd(), outputPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function evaluateSamples(samples: TrainingSample[], weights: number[], bias: number): MetricSummary {
  let squaredError = 0;
  let absoluteError = 0;
  let correctClassifications = 0;

  for (const sample of samples) {
    const prediction = predictValue(sample.features, weights, bias);
    const error = prediction - sample.target;
    squaredError += error * error;
    absoluteError += Math.abs(error);

    const predictedClass = prediction > 0.15 ? 1 : prediction < -0.15 ? -1 : 0;
    const targetClass = sample.target > 0 ? 1 : sample.target < 0 ? -1 : 0;
    if (predictedClass === targetClass) correctClassifications += 1;
  }

  const count = Math.max(1, samples.length);
  return {
    mse: squaredError / count,
    mae: absoluteError / count,
    signAccuracy: correctClassifications / count,
  };
}

function predictValue(features: number[], weights: number[], bias: number): number {
  let sum = bias;
  for (let index = 0; index < features.length; index += 1) {
    sum += features[index] * weights[index];
  }
  return Math.tanh(sum);
}

function parseOptions(argv: string[]): TrainOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsageAndExit();
  }

  const options: TrainOptions = { ...DEFAULT_OPTIONS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    switch (arg) {
      case '--games':
        options.games = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--epochs':
        options.epochs = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--difficulty':
        options.difficulty = parseDifficulty(nextValue);
        index += 1;
        break;
      case '--max-turns':
        options.maxTurns = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--no-capture-draw':
        options.noCaptureDrawMoves = parseNonNegativeInt(nextValue, arg);
        index += 1;
        break;
      case '--workers':
        options.workers = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--lr':
        options.learningRate = parsePositiveFloat(nextValue, arg);
        index += 1;
        break;
      case '--l2':
        options.l2 = parsePositiveFloat(nextValue, arg);
        index += 1;
        break;
      case '--progress-every':
        options.progressEvery = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--dataset-out':
        if (!nextValue) throw new Error('Missing value for --dataset-out');
        options.datasetOut = nextValue;
        index += 1;
        break;
      case '--skip-fit':
        options.skipFit = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--trace-turns':
        options.traceTurns = true;
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  if (options.workers > options.games) {
    options.workers = options.games;
  }

  return options;
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (!value) throw new Error('Missing value for --difficulty.');
  if (value === 'medium' || value === 'hard' || value === 'extreme') {
    return value;
  }
  throw new Error(`Invalid --difficulty value: ${value}. Expected medium|hard|extreme.`);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}. Expected a positive integer.`);
  }
  return parsed;
}

function parsePositiveFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}.`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}. Expected a positive number.`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flag}: ${value}. Expected a non-negative integer.`);
  }
  return parsed;
}

function printUsageAndExit(): never {
  console.log('Usage: npm run hive:train -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --games <n>           Number of self-play games (default: 160)');
  console.log('  --epochs <n>          Number of SGD passes (default: 12)');
  console.log('  --difficulty <d>      AI strength for self-play: medium|hard|extreme (default: hard)');
  console.log('  --max-turns <n>       Max turns per game before draw (default: 220)');
  console.log('  --no-capture-draw <n> Draw when no queen-pressure progress for N moves (default: 80)');
  console.log(`  --workers <n>         Reserved for compatibility (default: ${DEFAULT_OPTIONS.workers})`);
  console.log('  --lr <n>              Learning rate (default: 0.016)');
  console.log('  --l2 <n>              L2 regularization (default: 0.00035)');
  console.log('  --progress-every <n>  Progress print interval in games (default: 20)');
  console.log('  --dataset-out <path>  Export generated dataset JSON to this path');
  console.log('  --skip-fit            Skip linear model fitting (self-play/data generation only)');
  console.log('  --verbose, -v         Print per-game progress details');
  console.log('  --trace-turns         Print every turn decision (implies --verbose)');
  process.exit(0);
}

function logStage(stage: 'setup' | 'self-play' | 'train' | 'save' | 'done', message: string): void {
  const clock = new Date().toISOString().slice(11, 19);
  console.log(`[${clock}] [${stage}] ${message}`);
}

function estimateRemainingMs(elapsedMs: number, completed: number, total: number): number {
  if (completed <= 0 || total <= completed) return 0;
  const averagePerUnit = elapsedMs / completed;
  return Math.max(0, Math.round((total - completed) * averagePerUnit));
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

function shuffleInPlace<T>(items: T[]): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}

function roundNumber(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function createTrainingMetricsLogger(source: 'linear' | 'deep'): TrainingMetricsLogger {
  const runId = `${source}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const configuredPath = process.env.HIVE_METRICS_LOG_PATH ?? DEFAULT_METRICS_LOG_PATH;
  const metricsPath = path.resolve(process.cwd(), configuredPath);

  let warned = false;
  const log = (eventType: string, payload: Record<string, unknown>): void => {
    try {
      mkdirSync(path.dirname(metricsPath), { recursive: true });
      appendFileSync(
        metricsPath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          source,
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
