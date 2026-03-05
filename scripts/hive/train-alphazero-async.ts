import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { HiveComputerDifficulty } from '../../lib/hive/ai';
import {
  HIVE_ACTION_FEATURE_NAMES,
  HIVE_DEFAULT_TOKEN_SLOTS,
  buildHiveTokenStateFeatureNames,
} from '../../lib/hive/ml';
import type { GameState } from '../../lib/hive/types';
import { getHiveHardwareProfile } from './hardware-profile';

type ArenaGateMode = 'fixed' | 'sprt';

interface AsyncOptions {
  durationMinutes: number;
  selfplayWorkers: number;
  chunkGames: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  simulations: number;
  fastSimulations: number;
  fastRatio: number;
  replayPath: string;
  replayMaxSamples: number;
  reanalyseFraction: number;
  reanalyseWorkers: number;
  trainIntervalSeconds: number;
  minReplaySamples: number;
  minNewSamples: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
  weightDecay: number;
  hidden: string;
  candidateOutPath: string;
  championModelPath: string;
  promoteOutPath: string;
  arenaGames: number;
  arenaThreshold: number;
  arenaGateMode: ArenaGateMode;
  arenaSprtAlpha: number;
  arenaSprtBeta: number;
  arenaSprtMargin: number;
  arenaConfidenceLevel: number;
  skipTraining: boolean;
  skipArena: boolean;
  deployOnPromotion: boolean;
  deployAfterArena: boolean;
  deployCommand: string;
  continueOnError: boolean;
  metricsLogPath: string;
  chunkDir: string;
  tmpDir: string;
  verbose: boolean;
}

interface PolicyTarget {
  actionKey: string;
  probability: number;
  visitCount: number;
  actionFeatures: number[];
}

interface ReplaySample {
  stateFeatures: number[];
  perspective: 'white' | 'black';
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

interface ReplayPayload {
  version: number;
  createdAt: string;
  updatedAt: string;
  stateFeatureNames: string[];
  actionFeatureNames: string[];
  samples: ReplaySample[];
}

interface SelfPlayChunkOutput extends ReplayPayload {
  summary?: {
    games: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
    totalMoves: number;
    totalSimulations: number;
  };
}

interface ReanalyseWorkerPayload {
  samples: Array<{
    index: number;
    stateSnapshot: GameState;
  }>;
  championModelPath: string;
  difficulty: HiveComputerDifficulty;
  fastSimulations: number;
  maxTurns: number;
}

interface ReanalyseWorkerResult {
  updates: Array<{
    index: number;
    policyTargets: PolicyTarget[];
    searchMeta: ReplaySample['searchMeta'];
  }>;
}

interface MetricsLogger {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface ActiveWorker {
  id: number;
  process: ChildProcess;
  outPath: string;
}

const HARDWARE_PROFILE = getHiveHardwareProfile();

const DEFAULT_OPTIONS: AsyncOptions = {
  durationMinutes: 0,
  selfplayWorkers: Math.max(1, Math.min(4, HARDWARE_PROFILE.logicalCpuCount - 4)),
  chunkGames: 2,
  difficulty: 'extreme',
  maxTurns: 320,
  noCaptureDrawMoves: 100,
  simulations: 220,
  fastSimulations: 72,
  fastRatio: 0.55,
  replayPath: '.hive-cache/az-replay-buffer.json',
  replayMaxSamples: 220000,
  reanalyseFraction: 0.2,
  reanalyseWorkers: Math.max(1, Math.min(6, HARDWARE_PROFILE.logicalCpuCount - 2)),
  trainIntervalSeconds: 180,
  minReplaySamples: 1200,
  minNewSamples: 320,
  epochs: 8,
  batchSize: Math.max(256, Math.min(2048, HARDWARE_PROFILE.deepBatchSize)),
  learningRate: 0.0015,
  weightDecay: 0.0001,
  hidden: '128,64',
  candidateOutPath: '.hive-cache/az-candidate-model.json',
  championModelPath: 'lib/hive/trained-model.json',
  promoteOutPath: 'lib/hive/trained-model.json',
  arenaGames: 400,
  arenaThreshold: 0.55,
  arenaGateMode: 'sprt',
  arenaSprtAlpha: 0.05,
  arenaSprtBeta: 0.05,
  arenaSprtMargin: 0.05,
  arenaConfidenceLevel: 0.95,
  skipTraining: false,
  skipArena: false,
  deployOnPromotion: false,
  deployAfterArena: false,
  deployCommand: 'vercel --prod --yes',
  continueOnError: true,
  metricsLogPath: '.hive-cache/metrics/training-metrics.jsonl',
  chunkDir: '.hive-cache/async/chunks',
  tmpDir: '.hive-cache/async/tmp',
  verbose: false,
};

let interrupted = false;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  installSignalHandlers();
  const logger = createMetricsLogger(options.metricsLogPath);

  const chunkDir = path.resolve(process.cwd(), options.chunkDir);
  const tmpDir = path.resolve(process.cwd(), options.tmpDir);
  const replayPath = path.resolve(process.cwd(), options.replayPath);
  mkdirSync(chunkDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(path.dirname(replayPath), { recursive: true });

  let replay = readReplayPayload(replayPath) ?? createEmptyReplay();
  writeReplayPayload(replayPath, replay);

  const startedAt = Date.now();
  const deadline = options.durationMinutes > 0
    ? startedAt + options.durationMinutes * 60 * 1000
    : null;

  logger.log('async_run_start', {
    options,
    initialReplaySamples: replay.samples.length,
    pid: process.pid,
  });

  log(
    'setup',
    `workers=${options.selfplayWorkers} chunk_games=${options.chunkGames} sims=${options.simulations}/${options.fastSimulations} train_interval=${options.trainIntervalSeconds}s min_replay=${options.minReplaySamples} min_new=${options.minNewSamples}`,
  );
  if (deadline) {
    log('setup', `duration=${options.durationMinutes.toFixed(2)}m`);
  } else {
    log('setup', 'duration=infinite (ctrl+c to stop)');
  }
  if (options.deployOnPromotion || options.deployAfterArena) {
    log(
      'setup',
      `deploy_on_promotion=${options.deployOnPromotion ? 'on' : 'off'} deploy_after_arena=${options.deployAfterArena ? 'on' : 'off'} command="${options.deployCommand}"`,
    );
    if (options.skipArena) {
      log('warn', 'deploy is configured but --skip-arena is set');
    }
  } else {
    log('setup', 'deploy_on_promotion=off deploy_after_arena=off');
  }

  const activeWorkers = new Map<number, ActiveWorker>();
  const completedChunkPaths: string[] = [];
  const queuedChunkPaths = new Set<string>();
  let nextWorkerId = 1;
  let trainingTask: Promise<void> | null = null;
  let lastTrainAt = 0;
  let newSamplesSinceTrain = 0;
  let totalGenerated = 0;
  let totalChunks = 0;
  let trainStep = 0;
  let fatalError: Error | null = null;

  while (true) {
    if (fatalError) throw fatalError;

    const timeReached = deadline !== null && Date.now() >= deadline;
    const allowSpawn = !interrupted && !timeReached;

    if (allowSpawn) {
      while (activeWorkers.size < options.selfplayWorkers) {
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        const outPath = path.join(chunkDir, `chunk-${Date.now()}-${workerId}.json`);
        const worker = spawnSelfPlayWorker(
          workerId,
          options,
          outPath,
          completedChunkPaths,
          queuedChunkPaths,
          activeWorkers,
          logger,
        );
        activeWorkers.set(workerId, worker);
      }
    }

    while (completedChunkPaths.length > 0) {
      const chunkPath = completedChunkPaths.shift();
      if (!chunkPath) continue;
      queuedChunkPaths.delete(chunkPath);

      const parsed = readChunkOutput(chunkPath);
      try {
        rmSync(chunkPath, { force: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('ENOENT')) {
          throw error;
        }
      }
      if (!parsed) continue;

      // Count newly generated samples by chunk payload, not replay-size growth.
      // Replay may be at capacity, so size delta can be zero even though fresh
      // samples are still arriving and should advance training cadence.
      const incoming = parsed.samples.length;
      replay = mergeReplaySamples(replay, parsed.samples, options.replayMaxSamples);
      newSamplesSinceTrain += incoming;
      totalGenerated += incoming;
      totalChunks += 1;
      writeReplayPayload(replayPath, replay);

      logger.log('async_selfplay_chunk', {
        chunkSamples: parsed.samples.length,
        replaySamples: replay.samples.length,
        newSamplesSinceTrain,
        totalGenerated,
        totalChunks,
        summary: parsed.summary ?? null,
      });
      if (options.verbose) {
        log('selfplay', `chunk merged samples=${parsed.samples.length} replay=${replay.samples.length} new_since_train=${newSamplesSinceTrain}`);
      }
    }

    if (!trainingTask && !options.skipTraining) {
      const intervalReady = Date.now() - lastTrainAt >= options.trainIntervalSeconds * 1000;
      const replayReady = replay.samples.length >= options.minReplaySamples;
      const newReady = newSamplesSinceTrain >= options.minNewSamples;

      if (intervalReady && replayReady && newReady) {
        trainStep += 1;
        const snapshot = cloneReplayPayload(replay);
        const consumed = newSamplesSinceTrain;
        newSamplesSinceTrain = 0;
        lastTrainAt = Date.now();

        trainingTask = runTrainingStep(trainStep, snapshot, options, tmpDir, logger)
          .then(() => {
            logger.log('async_train_step', {
              step: trainStep,
              status: 'completed',
              consumedNewSamples: consumed,
              replaySamplesSnapshot: snapshot.samples.length,
            });
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.log('async_train_step', {
              step: trainStep,
              status: 'failed',
              error: message,
            });
            if (!options.continueOnError) {
              fatalError = error instanceof Error ? error : new Error(message);
            } else {
              log('warn', `train step ${trainStep} failed: ${message}`);
            }
          })
          .finally(() => {
            trainingTask = null;
          });
      }
    }

    const noActive = activeWorkers.size === 0
      && completedChunkPaths.length === 0
      && trainingTask === null;
    if ((interrupted || timeReached) && noActive) {
      break;
    }

    await sleep(1000);
  }

  logger.log('async_run_end', {
    status: fatalError ? 'failed' : 'completed',
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    replaySamples: replay.samples.length,
    totalGenerated,
    totalChunks,
    trainSteps: trainStep,
  });

  if (fatalError) throw fatalError;
  log('done', `elapsed=${formatDuration(Date.now() - startedAt)} replay_samples=${replay.samples.length} train_steps=${trainStep}`);
}

function spawnSelfPlayWorker(
  workerId: number,
  options: AsyncOptions,
  outPath: string,
  completedChunkPaths: string[],
  queuedChunkPaths: Set<string>,
  activeWorkers: Map<number, ActiveWorker>,
  logger: MetricsLogger,
): ActiveWorker {
  const scriptPath = path.resolve(process.cwd(), 'scripts/hive/az-selfplay-worker.ts');
  const args = [
    '--import',
    'tsx',
    scriptPath,
    '--games',
    String(options.chunkGames),
    '--difficulty',
    options.difficulty,
    '--max-turns',
    String(options.maxTurns),
    '--no-capture-draw',
    String(options.noCaptureDrawMoves),
    '--simulations',
    String(options.simulations),
    '--fast-simulations',
    String(options.fastSimulations),
    '--fast-ratio',
    String(options.fastRatio),
    '--seed',
    String(Date.now() + workerId * 997),
    '--out',
    outPath,
  ];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: 'ignore',
    shell: false,
  });

  child.on('close', (code, signal) => {
    activeWorkers.delete(workerId);
    if (code === 0 && existsSync(outPath)) {
      if (!queuedChunkPaths.has(outPath)) {
        queuedChunkPaths.add(outPath);
        completedChunkPaths.push(outPath);
      }
      return;
    }
    logger.log('async_selfplay_worker', {
      workerId,
      status: 'failed',
      code: code ?? null,
      signal: signal ?? null,
      outPath,
    });
    rmSync(outPath, { force: true });
  });
  child.on('error', (error) => {
    activeWorkers.delete(workerId);
    logger.log('async_selfplay_worker', {
      workerId,
      status: 'error',
      error: error.message,
      outPath,
    });
    rmSync(outPath, { force: true });
  });

  logger.log('async_selfplay_worker', {
    workerId,
    status: 'started',
    chunkGames: options.chunkGames,
    outPath,
  });

  return {
    id: workerId,
    process: child,
    outPath,
  };
}

async function runTrainingStep(
  step: number,
  snapshot: ReplayPayload,
  options: AsyncOptions,
  tmpDir: string,
  logger: MetricsLogger,
): Promise<void> {
  const reanalysed = await reanalyseSnapshot(snapshot, options, tmpDir);
  const freshness = snapshot.samples.length > 0 ? reanalysed / snapshot.samples.length : 0;
  logger.log('reanalyze_pass', {
    source: 'az',
    replaySamples: snapshot.samples.length,
    reanalyseFraction: options.reanalyseFraction,
    reanalysedSamples: reanalysed,
    replayFreshnessRatio: freshness,
    asyncStep: step,
  });

  const datasetPath = path.join(tmpDir, `az-async-dataset-step-${step}-${Date.now()}.json`);
  writeFileSync(datasetPath, `${JSON.stringify(snapshot)}\n`, 'utf8');

  logger.log('async_train_trigger', {
    step,
    replaySamples: snapshot.samples.length,
    reanalysedSamples: reanalysed,
    replayFreshnessRatio: freshness,
    datasetPath,
  });

  try {
    const pythonScript = path.resolve(process.cwd(), 'scripts/hive/train-alphazero.py');
    await runPythonWithFallback([
      pythonScript,
      '--dataset',
      datasetPath,
      '--out',
      path.resolve(process.cwd(), options.candidateOutPath),
      '--epochs',
      String(options.epochs),
      '--batch-size',
      String(options.batchSize),
      '--lr',
      String(options.learningRate),
      '--weight-decay',
      String(options.weightDecay),
      '--hidden',
      options.hidden,
      '--metrics-log',
      path.resolve(process.cwd(), options.metricsLogPath),
    ]);

    if (!options.skipArena) {
      const arenaResult = await runCommand(process.execPath, [
        '--import',
        'tsx',
        path.resolve(process.cwd(), 'scripts/hive/eval-arena.ts'),
        '--candidate-model',
        options.candidateOutPath,
        '--champion-model',
        options.championModelPath,
        '--promote-out',
        options.promoteOutPath,
        '--games',
        String(options.arenaGames),
        '--pass-score',
        String(options.arenaThreshold),
        '--gate-mode',
        options.arenaGateMode,
        '--sprt-alpha',
        String(options.arenaSprtAlpha),
        '--sprt-beta',
        String(options.arenaSprtBeta),
        '--sprt-margin',
        String(options.arenaSprtMargin),
        '--confidence-level',
        String(options.arenaConfidenceLevel),
        '--difficulty',
        options.difficulty,
        '--engine',
        'alphazero',
        '--max-turns',
        String(options.maxTurns),
        '--no-capture-draw',
        String(options.noCaptureDrawMoves),
        '--metrics-log',
        options.metricsLogPath,
      ], { stdio: 'pipe' });

      if (arenaResult.stdout.length > 0) process.stdout.write(arenaResult.stdout);
      if (arenaResult.stderr.length > 0) process.stderr.write(arenaResult.stderr);

      const promoted = didArenaPromote(arenaResult.stdout);
      logger.log('async_arena_result', {
        step,
        promoted,
      });

      const deployReason = options.deployAfterArena
        ? 'after_arena'
        : promoted && options.deployOnPromotion
          ? 'promotion'
          : null;

      if (deployReason) {
        logger.log('async_deploy', {
          step,
          status: 'start',
          reason: deployReason,
          command: options.deployCommand,
          promoted,
        });
        log(
          'deploy',
          `${deployReason === 'promotion' ? 'promotion detected' : 'arena completed'}; running deploy command: ${options.deployCommand}`,
        );
        try {
          await runDeployCommand(options.deployCommand);
          logger.log('async_deploy', {
            step,
            status: 'completed',
            reason: deployReason,
            promoted,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          logger.log('async_deploy', {
            step,
            status: 'failed',
            reason: deployReason,
            promoted,
            error: message,
          });
          if (!options.continueOnError) {
            throw error;
          }
          log('warn', `deploy failed at step ${step}: ${message}`);
        }
      }
    }
  } finally {
    rmSync(datasetPath, { force: true });
  }
}

function didArenaPromote(stdout: string): boolean {
  if (/\[arena:promote\]\s+candidate promoted\b/i.test(stdout)) return true;
  if (/\[arena:done\][^\n]*promoted=yes/i.test(stdout)) return true;
  return false;
}

async function reanalyseSnapshot(
  snapshot: ReplayPayload,
  options: AsyncOptions,
  tmpDir: string,
): Promise<number> {
  if (options.reanalyseFraction <= 0) return 0;
  if (!existsSync(path.resolve(process.cwd(), options.championModelPath))) return 0;
  if (snapshot.samples.length === 0) return 0;

  const count = Math.min(
    snapshot.samples.length,
    Math.floor(snapshot.samples.length * options.reanalyseFraction),
  );
  if (count <= 0) return 0;

  const rng = createRng(4141 + snapshot.samples.length);
  const selected = sampleUniqueIndices(snapshot.samples.length, count, rng);
  const workers = Math.max(1, Math.min(options.reanalyseWorkers, selected.length));
  const chunks = chunkIndices(selected, workers);
  let updated = 0;

  const jobs = chunks.map((indices, workerIndex) => {
    const inputPath = path.join(tmpDir, `reanalyze-in-${Date.now()}-${workerIndex}.json`);
    const outputPath = path.join(tmpDir, `reanalyze-out-${Date.now()}-${workerIndex}.json`);
    const payload: ReanalyseWorkerPayload = {
      samples: indices.map((index) => ({
        index,
        stateSnapshot: snapshot.samples[index].stateSnapshot,
      })),
      championModelPath: path.resolve(process.cwd(), options.championModelPath),
      difficulty: options.difficulty,
      fastSimulations: options.fastSimulations,
      maxTurns: options.maxTurns,
    };
    writeFileSync(inputPath, `${JSON.stringify(payload)}\n`, 'utf8');
    return { inputPath, outputPath };
  });

  try {
    await Promise.all(jobs.map((job) => runCommand(process.execPath, [
      '--import',
      'tsx',
      path.resolve(process.cwd(), 'scripts/hive/reanalyse-worker.ts'),
      '--input',
      job.inputPath,
      '--output',
      job.outputPath,
    ], { stdio: 'ignore' })));

    for (const job of jobs) {
      if (!existsSync(job.outputPath)) continue;
      const parsed = JSON.parse(readFileSync(job.outputPath, 'utf8')) as ReanalyseWorkerResult;
      if (!parsed || !Array.isArray(parsed.updates)) continue;
      for (const update of parsed.updates) {
        const sample = snapshot.samples[update.index];
        if (!sample) continue;
        sample.policyTargets = update.policyTargets;
        sample.searchMeta = update.searchMeta;
        updated += 1;
      }
    }
  } finally {
    for (const job of jobs) {
      rmSync(job.inputPath, { force: true });
      rmSync(job.outputPath, { force: true });
    }
  }

  return updated;
}

function createEmptyReplay(): ReplayPayload {
  const now = new Date().toISOString();
  return {
    version: 2,
    createdAt: now,
    updatedAt: now,
    stateFeatureNames: buildHiveTokenStateFeatureNames(HIVE_DEFAULT_TOKEN_SLOTS),
    actionFeatureNames: [...HIVE_ACTION_FEATURE_NAMES],
    samples: [],
  };
}

function readReplayPayload(absolutePath: string): ReplayPayload | null {
  if (!existsSync(absolutePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as ReplayPayload;
    if (!parsed || !Array.isArray(parsed.samples)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeReplayPayload(absolutePath: string, payload: ReplayPayload): void {
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  payload.updatedAt = new Date().toISOString();
  writeFileSync(absolutePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function mergeReplaySamples(
  replay: ReplayPayload,
  freshSamples: ReplaySample[],
  maxSamples: number,
): ReplayPayload {
  const merged = [...replay.samples, ...freshSamples];
  const trimmed = merged.slice(Math.max(0, merged.length - maxSamples));
  return {
    ...replay,
    samples: trimmed,
    updatedAt: new Date().toISOString(),
  };
}

function readChunkOutput(chunkPath: string): SelfPlayChunkOutput | null {
  if (!existsSync(chunkPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(chunkPath, 'utf8')) as SelfPlayChunkOutput;
    if (!parsed || !Array.isArray(parsed.samples)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cloneReplayPayload(payload: ReplayPayload): ReplayPayload {
  return JSON.parse(JSON.stringify(payload)) as ReplayPayload;
}

function parseOptions(argv: string[]): AsyncOptions {
  const options: AsyncOptions = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--duration-minutes': options.durationMinutes = parseNonNegativeFloat(next, arg); index += 1; break;
      case '--selfplay-workers': options.selfplayWorkers = parsePositiveInt(next, arg); index += 1; break;
      case '--chunk-games':
      case '--games':
        options.chunkGames = parsePositiveInt(next, arg); index += 1; break;
      case '--difficulty': options.difficulty = parseDifficulty(next); index += 1; break;
      case '--max-turns': options.maxTurns = parsePositiveInt(next, arg); index += 1; break;
      case '--no-capture-draw': options.noCaptureDrawMoves = parseNonNegativeInt(next, arg); index += 1; break;
      case '--simulations': options.simulations = parsePositiveInt(next, arg); index += 1; break;
      case '--fast-simulations': options.fastSimulations = parsePositiveInt(next, arg); index += 1; break;
      case '--fast-ratio': options.fastRatio = parseRatio(next, arg); index += 1; break;
      case '--replay-path': if (!next) throw new Error('Missing value for --replay-path'); options.replayPath = next; index += 1; break;
      case '--replay-max-samples': options.replayMaxSamples = parsePositiveInt(next, arg); index += 1; break;
      case '--reanalyse-fraction': options.reanalyseFraction = parseRatioZeroOne(next, arg); index += 1; break;
      case '--reanalyse-workers': options.reanalyseWorkers = parsePositiveInt(next, arg); index += 1; break;
      case '--train-interval-seconds': options.trainIntervalSeconds = parsePositiveInt(next, arg); index += 1; break;
      case '--min-replay-samples': options.minReplaySamples = parsePositiveInt(next, arg); index += 1; break;
      case '--min-new-samples': options.minNewSamples = parsePositiveInt(next, arg); index += 1; break;
      case '--epochs': options.epochs = parsePositiveInt(next, arg); index += 1; break;
      case '--batch-size': options.batchSize = parsePositiveInt(next, arg); index += 1; break;
      case '--lr': options.learningRate = parsePositiveFloat(next, arg); index += 1; break;
      case '--weight-decay': options.weightDecay = parseNonNegativeFloat(next, arg); index += 1; break;
      case '--hidden': if (!next) throw new Error('Missing value for --hidden'); options.hidden = next; index += 1; break;
      case '--candidate-out': if (!next) throw new Error('Missing value for --candidate-out'); options.candidateOutPath = next; index += 1; break;
      case '--champion-model': if (!next) throw new Error('Missing value for --champion-model'); options.championModelPath = next; index += 1; break;
      case '--promote-out': if (!next) throw new Error('Missing value for --promote-out'); options.promoteOutPath = next; index += 1; break;
      case '--arena-games': options.arenaGames = parsePositiveInt(next, arg); index += 1; break;
      case '--arena-threshold': options.arenaThreshold = parseRatio(next, arg); index += 1; break;
      case '--arena-gate-mode': options.arenaGateMode = parseGateMode(next); index += 1; break;
      case '--arena-sprt-alpha': options.arenaSprtAlpha = parseRange(next, arg, 1e-6, 0.5); index += 1; break;
      case '--arena-sprt-beta': options.arenaSprtBeta = parseRange(next, arg, 1e-6, 0.5); index += 1; break;
      case '--arena-sprt-margin': options.arenaSprtMargin = parseRange(next, arg, 1e-3, 0.4); index += 1; break;
      case '--arena-confidence-level': options.arenaConfidenceLevel = parseRange(next, arg, 0.5, 0.999); index += 1; break;
      case '--metrics-log': if (!next) throw new Error('Missing value for --metrics-log'); options.metricsLogPath = next; index += 1; break;
      case '--chunk-dir': if (!next) throw new Error('Missing value for --chunk-dir'); options.chunkDir = next; index += 1; break;
      case '--tmp-dir': if (!next) throw new Error('Missing value for --tmp-dir'); options.tmpDir = next; index += 1; break;
      case '--skip-training': options.skipTraining = true; break;
      case '--skip-arena': options.skipArena = true; break;
      case '--deploy-on-promotion': options.deployOnPromotion = true; break;
      case '--no-deploy-on-promotion': options.deployOnPromotion = false; break;
      case '--deploy-after-arena': options.deployAfterArena = true; break;
      case '--no-deploy-after-arena': options.deployAfterArena = false; break;
      case '--deploy-command': if (!next) throw new Error('Missing value for --deploy-command'); options.deployCommand = next; index += 1; break;
      case '--continue-on-error': options.continueOnError = true; break;
      case '--stop-on-error': options.continueOnError = false; break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printUsageAndExit();
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.selfplayWorkers = Math.max(1, options.selfplayWorkers);
  options.reanalyseWorkers = Math.max(1, options.reanalyseWorkers);
  return options;
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseGateMode(value: string | undefined): ArenaGateMode {
  if (value === 'fixed' || value === 'sprt') return value;
  throw new Error(`Invalid --arena-gate-mode value: ${value}`);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parsePositiveFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseNonNegativeFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseRatio(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseRatioZeroOne(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseRange(value: string | undefined, flag: string, min: number, max: number): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function printUsageAndExit(): never {
  console.log('Usage: npm run hive:train:az:async -- [options]');
  console.log('  --duration-minutes <n>          Run length (0 = infinite, default: 0)');
  console.log('  --selfplay-workers <n>          Parallel self-play workers');
  console.log('  --chunk-games <n>               Games per worker chunk (alias: --games)');
  console.log('  --difficulty <medium|hard|extreme>');
  console.log('  --simulations <n> --fast-simulations <n> --fast-ratio <0..1>');
  console.log('  --replay-path <path> --replay-max-samples <n>');
  console.log('  --reanalyse-fraction <0..1> --reanalyse-workers <n>');
  console.log('  --train-interval-seconds <n> --min-replay-samples <n> --min-new-samples <n>');
  console.log('  --epochs <n> --batch-size <n> --lr <v> --weight-decay <v> --hidden <csv>');
  console.log('  --candidate-out <path> --champion-model <path> --promote-out <path>');
  console.log('  --arena-games <n> --arena-threshold <0..1> --arena-gate-mode <fixed|sprt>');
  console.log('  --deploy-on-promotion --no-deploy-on-promotion');
  console.log('  --deploy-after-arena --no-deploy-after-arena --deploy-command <cmd>');
  console.log('  --skip-training --skip-arena --continue-on-error --metrics-log <path>');
  process.exit(0);
}

function sampleUniqueIndices(length: number, count: number, rng: () => number): number[] {
  if (length <= 0 || count <= 0) return [];
  const target = Math.min(length, Math.max(0, Math.floor(count)));
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const temp = indices[index];
    indices[index] = indices[swap];
    indices[swap] = temp;
  }
  return indices.slice(0, target);
}

function chunkIndices(indices: number[], chunks: number): number[][] {
  if (indices.length === 0 || chunks <= 0) return [];
  const out = Array.from({ length: chunks }, () => [] as number[]);
  for (let index = 0; index < indices.length; index += 1) {
    out[index % chunks].push(indices[index]);
  }
  return out.filter((entries) => entries.length > 0);
}

function createRng(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state <= 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function installSignalHandlers(): void {
  const onSignal = (): void => {
    if (interrupted) return;
    interrupted = true;
    log('interrupt', 'signal received; stopping after active workers/train step');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

function createMetricsLogger(configuredPath: string): MetricsLogger {
  const runId = `az-async-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const absolutePath = path.resolve(process.cwd(), configuredPath);
  let warned = false;
  const log = (eventType: string, payload: Record<string, unknown>): void => {
    try {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      appendFileSync(
        absolutePath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          source: 'az',
          runId,
          eventType,
          ...payload,
        })}\n`,
        'utf8',
      );
    } catch (error) {
      if (warned) return;
      warned = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[warn] failed metrics append: ${message}`);
    }
  };
  return { runId, log };
}

function runCommand(
  command: string,
  args: string[],
  options?: { stdio?: 'inherit' | 'ignore' | 'pipe' },
): Promise<CommandResult> {
  const stdio = options?.stdio ?? 'inherit';
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    if (stdio === 'pipe') {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      const result: CommandResult = {
        code: code ?? 1,
        stdout,
        stderr,
      };
      if (result.code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${result.code}`));
        return;
      }
      resolve(result);
    });
  });
}

async function runDeployCommand(rawCommand: string): Promise<void> {
  const trimmed = rawCommand.trim();
  if (trimmed.length === 0) {
    throw new Error('Invalid --deploy-command (empty command)');
  }

  if (process.platform === 'win32') {
    await runCommand('cmd.exe', ['/d', '/s', '/c', trimmed]);
    return;
  }

  const deployParts = tokenizeCommand(trimmed);
  if (deployParts.length === 0) {
    throw new Error('Invalid --deploy-command (empty command)');
  }
  const [deployBinary, ...deployArgs] = deployParts;
  await runCommand(deployBinary, deployArgs);
}

function tokenizeCommand(raw: string): string[] {
  const tokens: string[] = [];
  const matcher = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }

  return tokens;
}

async function runPythonWithFallback(args: string[]): Promise<void> {
  try {
    await runCommand('python', args);
  } catch {
    await runCommand('py', args);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function log(stage: string, message: string): void {
  const clock = new Date().toISOString().slice(11, 19);
  console.log(`[${clock}] [az-async:${stage}] ${message}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
