import { spawn } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ComputerDifficulty } from '../../lib/stratego/ai';
import {
  STRATEGO_FEATURE_NAMES,
  STRATEGO_LINEAR_MODEL_VERSION,
  getActiveStrategoModel,
  type StrategoLinearModel,
} from '../../lib/stratego/ml';
import {
  runSelfPlayBatch,
  type SelfPlayBatchResult,
  type SelfPlayGameSummary,
  type TrainingSample,
} from './training-core';

interface TrainOptions {
  games: number;
  epochs: number;
  difficulty: ComputerDifficulty;
  maxTurns: number;
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
  redWins: number;
  blueWins: number;
  draws: number;
}

interface WorkerAssignment {
  workerId: number;
  startGame: number;
  games: number;
  outPath: string;
}

interface WorkerProgressPayload {
  workerId: number;
  gameIndex: number;
  turnsPlayed: number;
  winner: 'red' | 'blue' | null;
  winReason: 'flag_captured' | 'no_moves' | 'resignation' | null;
  samplesAdded: number;
  durationMs: number;
}

interface WorkerDonePayload {
  workerId: number;
  outPath: string;
  games: number;
  samples: number;
}

interface WorkerOutputFile {
  workerId: number;
  startGame: number;
  games: number;
  redWins: number;
  blueWins: number;
  draws: number;
  summaries: SelfPlayGameSummary[];
  samples: SelfPlayBatchResult['samples'];
}

interface TrainingMetricsLogger {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
}

const DEFAULT_OPTIONS: TrainOptions = {
  games: 180,
  epochs: 12,
  difficulty: 'hard',
  maxTurns: 500,
  learningRate: 0.018,
  l2: 0.00035,
  verbose: false,
  traceTurns: false,
  progressEvery: 20,
  workers: Math.max(1, cpus().length - 1),
  datasetOut: null,
  skipFit: false,
};

const DEFAULT_METRICS_LOG_PATH = '.stratego-cache/metrics/training-metrics.jsonl';

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = performance.now();
  const logger = createTrainingMetricsLogger('linear');

  logStage(
    'setup',
    `Training Stratego model | games=${options.games} difficulty=${options.difficulty} epochs=${options.epochs} maxTurns=${options.maxTurns} workers=${options.workers}`,
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
  const selfPlay = await runSelfPlay(options, startedAt, logger);

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
      redWins: selfPlay.redWins,
      blueWins: selfPlay.blueWins,
      draws: selfPlay.draws,
    });
    return;
  }

  if (selfPlay.samples.length < 200) {
    throw new Error('Not enough samples were generated. Increase --games or --max-turns.');
  }

  logStage(
    'train',
    `Fitting value model on ${selfPlay.samples.length} samples (${options.epochs} epochs)...`,
  );
  const { trainedModel, trainMetrics, validationMetrics } = fitLinearModel(
    selfPlay.samples,
    options,
    logger,
  );

  logStage('save', 'Writing trained model to disk...');
  writeModelFile(trainedModel);

  const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(1);
  logStage('done', `Saved trained model to lib/stratego/trained-model.json in ${elapsedSec}s`);
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
    redWins: selfPlay.redWins,
    blueWins: selfPlay.blueWins,
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

async function runSelfPlay(
  options: TrainOptions,
  startedAtMs: number,
  logger: TrainingMetricsLogger,
): Promise<SelfPlayAggregate> {
  if (options.workers <= 1) {
    return runSelfPlaySingleProcess(options, startedAtMs, logger);
  }
  return runSelfPlayParallel(options, startedAtMs, logger);
}

function runSelfPlaySingleProcess(
  options: TrainOptions,
  startedAtMs: number,
  logger: TrainingMetricsLogger,
): SelfPlayAggregate {
  const aggregate: SelfPlayAggregate = {
    samples: [],
    sampleCount: 0,
    completedGames: 0,
    redWins: 0,
    blueWins: 0,
    draws: 0,
  };

  const batch = runSelfPlayBatch(
    1,
    options.games,
    {
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
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
  aggregate.redWins = batch.redWins;
  aggregate.blueWins = batch.blueWins;
  aggregate.draws = batch.draws;

  return aggregate;
}

async function runSelfPlayParallel(
  options: TrainOptions,
  startedAtMs: number,
  logger: TrainingMetricsLogger,
): Promise<SelfPlayAggregate> {
  const workerCount = Math.min(options.workers, options.games);
  const workerScriptPath = path.resolve(process.cwd(), 'scripts/stratego/selfplay-worker.ts');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'stratego-selfplay-'));
  const assignments = buildWorkerAssignments(options.games, workerCount, tempDir);

  const progressAggregate: SelfPlayAggregate = {
    samples: [],
    sampleCount: 0,
    completedGames: 0,
    redWins: 0,
    blueWins: 0,
    draws: 0,
  };

  try {
    const workerResults = await Promise.all(
      assignments.map((assignment) => runSelfPlayWorker(
        workerScriptPath,
        assignment,
        options,
        (summary, workerId) => {
          applySummaryToAggregate(progressAggregate, summary);
          maybeLogSelfPlayProgress(
            options,
            progressAggregate,
            summary,
            startedAtMs,
            logger,
            workerId,
          );
        },
      )),
    );

    const aggregate: SelfPlayAggregate = {
      samples: [],
      sampleCount: 0,
      completedGames: 0,
      redWins: 0,
      blueWins: 0,
      draws: 0,
    };

    for (const result of workerResults) {
      aggregate.samples.push(...result.samples);
      aggregate.completedGames += result.summaries.length;
      aggregate.redWins += result.redWins;
      aggregate.blueWins += result.blueWins;
      aggregate.draws += result.draws;
    }
    aggregate.sampleCount = aggregate.samples.length;

    return aggregate;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runSelfPlayWorker(
  workerScriptPath: string,
  assignment: WorkerAssignment,
  options: TrainOptions,
  onProgress: (summary: SelfPlayGameSummary, workerId: number) => void,
): Promise<WorkerOutputFile> {
  return new Promise((resolve, reject) => {
    const args = [
      '--import',
      'tsx',
      workerScriptPath,
      '--worker-id',
      String(assignment.workerId),
      '--start-game',
      String(assignment.startGame),
      '--games',
      String(assignment.games),
      '--difficulty',
      options.difficulty,
      '--max-turns',
      String(options.maxTurns),
      '--out',
      assignment.outPath,
    ];
    if (options.traceTurns) args.push('--trace-turns');

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let donePayload: WorkerDonePayload | null = null;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith('@@PROGRESS ')) {
        const payload = JSON.parse(trimmed.slice('@@PROGRESS '.length)) as WorkerProgressPayload;
        const summary: SelfPlayGameSummary = {
          gameIndex: payload.gameIndex,
          turnsPlayed: payload.turnsPlayed,
          winner: payload.winner,
          winReason: payload.winReason,
          samplesAdded: payload.samplesAdded,
          durationMs: payload.durationMs,
        };
        onProgress(summary, payload.workerId);
        return;
      }

      if (trimmed.startsWith('@@TRACE ')) {
        if (!options.traceTurns) return;
        const payload = JSON.parse(trimmed.slice('@@TRACE '.length)) as {
          workerId: number;
          line: string;
        };
        console.log(`  [trace:w${payload.workerId}] ${payload.line}`);
        return;
      }

      if (trimmed.startsWith('@@DONE ')) {
        donePayload = JSON.parse(trimmed.slice('@@DONE '.length)) as WorkerDonePayload;
        return;
      }

      if (options.verbose) {
        console.log(`[worker:${assignment.workerId}] ${trimmed}`);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      stdoutBuffer = processBufferedLines(stdoutBuffer, handleLine);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrBuffer += text;
      if (options.verbose) {
        process.stderr.write(`[worker:${assignment.workerId}] ${text}`);
      }
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (stdoutBuffer.trim().length > 0) {
        handleLine(stdoutBuffer);
      }

      if (code !== 0) {
        reject(
          new Error(
            `Self-play worker ${assignment.workerId} failed with code ${code}.\n${stderrBuffer.trim()}`,
          ),
        );
        return;
      }

      if (!donePayload) {
        reject(new Error(`Self-play worker ${assignment.workerId} exited without @@DONE payload.`));
        return;
      }

      if (donePayload.outPath !== assignment.outPath) {
        reject(new Error(`Worker ${assignment.workerId} returned unexpected output path.`));
        return;
      }

      const raw = readFileSync(assignment.outPath, 'utf8');
      const parsed = JSON.parse(raw) as WorkerOutputFile;
      resolve(parsed);
    });
  });
}

function buildWorkerAssignments(
  games: number,
  workerCount: number,
  tempDir: string,
): WorkerAssignment[] {
  const assignments: WorkerAssignment[] = [];
  const baseGames = Math.floor(games / workerCount);
  const extra = games % workerCount;
  let nextStartGame = 1;

  for (let workerId = 1; workerId <= workerCount; workerId += 1) {
    const batchSize = baseGames + (workerId <= extra ? 1 : 0);
    if (batchSize <= 0) continue;

    assignments.push({
      workerId,
      startGame: nextStartGame,
      games: batchSize,
      outPath: path.join(tempDir, `worker-${workerId}.json`),
    });
    nextStartGame += batchSize;
  }

  return assignments;
}

function applySummaryToAggregate(
  aggregate: SelfPlayAggregate,
  summary: SelfPlayGameSummary,
): void {
  aggregate.completedGames += 1;
  aggregate.sampleCount += summary.samplesAdded;
  if (summary.winner === 'red') aggregate.redWins += 1;
  else if (summary.winner === 'blue') aggregate.blueWins += 1;
  else aggregate.draws += 1;
}

function maybeLogSelfPlayProgress(
  options: TrainOptions,
  aggregate: SelfPlayAggregate,
  summary: SelfPlayGameSummary,
  startedAtMs: number,
  logger: TrainingMetricsLogger,
  workerId?: number,
): void {
  const shouldLog = options.verbose
    || aggregate.completedGames % options.progressEvery === 0
    || aggregate.completedGames === options.games;
  if (!shouldLog) return;

  const elapsedMs = performance.now() - startedAtMs;
  const etaMs = estimateRemainingMs(elapsedMs, aggregate.completedGames, options.games);
  const winnerLabel = summary.winner ?? 'draw';
  const reasonLabel = summary.winReason ?? 'max_turns_or_draw';
  const workerLabel = workerId ? ` worker=${workerId}` : '';
  const prefix = options.verbose ? '[self-play:game]' : '[self-play]';

  console.log(
    `${prefix} ${aggregate.completedGames}/${options.games}${workerLabel} turns=${summary.turnsPlayed} winner=${winnerLabel} reason=${reasonLabel} samples=${aggregate.sampleCount} game_time=${formatDuration(summary.durationMs)} elapsed=${formatDuration(elapsedMs)} eta=${formatDuration(etaMs)} W/L/D=${aggregate.redWins}/${aggregate.blueWins}/${aggregate.draws}`,
  );
  logger.log('self_play_progress', {
    completedGames: aggregate.completedGames,
    totalGames: options.games,
    workerId: workerId ?? null,
    turnsPlayed: summary.turnsPlayed,
    winner: summary.winner,
    winReason: summary.winReason,
    sampleCount: aggregate.sampleCount,
    redWins: aggregate.redWins,
    blueWins: aggregate.blueWins,
    draws: aggregate.draws,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
    etaSeconds: Number((etaMs / 1000).toFixed(3)),
  });
}

function processBufferedLines(buffer: string, onLine: (line: string) => void): string {
  let nextNewline = buffer.indexOf('\n');
  while (nextNewline !== -1) {
    const line = buffer.slice(0, nextNewline);
    onLine(line);
    buffer = buffer.slice(nextNewline + 1);
    nextNewline = buffer.indexOf('\n');
  }
  return buffer;
}

function fitLinearModel(
  samples: TrainingSample[],
  options: TrainOptions,
  logger: TrainingMetricsLogger,
): {
  trainedModel: StrategoLinearModel;
  trainMetrics: MetricSummary;
  validationMetrics: MetricSummary;
} {
  const trainingStartedAt = performance.now();
  const shuffled = [...samples];
  shuffleInPlace(shuffled);

  const splitIndex = Math.max(1, Math.floor(shuffled.length * 0.9));
  const trainingSet = shuffled.slice(0, splitIndex);
  const validationSet = shuffled.slice(splitIndex);

  const featureCount = STRATEGO_FEATURE_NAMES.length;
  const priorModel = getActiveStrategoModel();
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

  const trainedModel: StrategoLinearModel = {
    version: STRATEGO_LINEAR_MODEL_VERSION,
    kind: 'linear',
    featureNames: [...STRATEGO_FEATURE_NAMES],
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

function writeModelFile(model: StrategoLinearModel): void {
  const outputPath = path.resolve(process.cwd(), 'lib/stratego/trained-model.json');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
}

function writeDatasetFile(
  outputPath: string,
  samples: TrainingSample[],
  options: TrainOptions,
): void {
  const payload = {
    version: 1,
    featureNames: [...STRATEGO_FEATURE_NAMES],
    samples,
    meta: {
      generatedAt: new Date().toISOString(),
      games: options.games,
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
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

function parseDifficulty(value: string | undefined): ComputerDifficulty {
  if (!value) {
    throw new Error('Missing value for --difficulty.');
  }
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

function printUsageAndExit(): never {
  console.log('Usage: npm run stratego:train -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --games <n>           Number of self-play games (default: 180)');
  console.log('  --epochs <n>          Number of SGD passes (default: 12)');
  console.log('  --difficulty <d>      AI strength for self-play: medium|hard|extreme (default: hard)');
  console.log('  --max-turns <n>       Max turns per game before draw (default: 500)');
  console.log('  --workers <n>         Worker processes for self-play (default: CPU cores - 1)');
  console.log('  --lr <n>              Learning rate (default: 0.018)');
  console.log('  --l2 <n>              L2 regularization (default: 0.00035)');
  console.log('  --progress-every <n>  Progress print interval in games (default: 20)');
  console.log('  --dataset-out <path>  Export generated dataset JSON to this path');
  console.log('  --skip-fit            Skip linear model fitting (self-play/data generation only)');
  console.log('  --verbose, -v         Print per-game progress details');
  console.log('  --trace-turns         Print every turn decision (implies --verbose)');
  process.exit(0);
}

function logStage(
  stage: 'setup' | 'self-play' | 'train' | 'save' | 'done',
  message: string,
): void {
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
  const configuredPath = process.env.STRATEGO_METRICS_LOG_PATH ?? DEFAULT_METRICS_LOG_PATH;
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
