import { spawn } from 'node:child_process';
import path from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ComputerDifficulty, SearchAlgorithm } from '../../lib/stratego/ai';
import { getStrategoHardwareProfile } from './hardware-profile';

type ValueTargetMode = 'terminal' | 'mixed' | 'search';
type RuntimeOptimizeMode = 'auto' | 'on' | 'off';

interface DeepTrainOptions {
  games: number;
  difficulty: ComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  workers: number;
  verbose: boolean;
  traceTurns: boolean;
  progressEvery: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
  weightDecay: number;
  hidden: string;
  keepDataset: boolean;
  datasetOut: string | null;
  checkpointPath: string;
  resume: boolean;
  warmStart: boolean;
  saveEvery: number;
  earlyStopPatience: number;
  earlyStopMinDelta: number;
  earlyStopMinEpochs: number;
  replayEnabled: boolean;
  replayPath: string;
  replayMaxRuns: number;
  replayMaxSamples: number;
  includePolicyTargets: boolean;
  policyTemperature: number;
  policyTopK: number;
  valueTargetMode: ValueTargetMode;
  searchValueBlend: number;
  bootstrapSteps: number;
  bootstrapDiscount: number;
  bootstrapBlend: number;
  leagueModelPaths: string[];
  leagueSampleProb: number;
  leagueHeuristicProb: number;
  searchAlgorithm: SearchAlgorithm;
  puctSimulations: number;
  puctCpuct: number;
  puctRolloutDepth: number;
  ampMode: RuntimeOptimizeMode;
  compileMode: RuntimeOptimizeMode;
  manifestOut: string;
  manifestHistoryPath: string | null;
}

interface TrainingSampleRecord {
  features: number[];
  target: number;
}

interface ReplayRunSummary {
  id: string;
  createdAt: string;
  sampleCount: number;
  source: 'self-play';
  games?: number;
  difficulty?: ComputerDifficulty;
  maxTurns?: number;
  workers?: number;
  trimmedHead?: number;
}

interface DatasetPayload {
  version: number;
  featureNames: string[];
  samples: TrainingSampleRecord[];
  meta?: Record<string, unknown>;
  replay?: {
    updatedAt: string;
    runs: ReplayRunSummary[];
  };
}

interface ReplayMergeResult {
  trainingDatasetPath: string;
  runCount: number;
  sampleCount: number;
  newSamples: number;
  droppedSamples: number;
}

interface DeepTrainRunManifest {
  runId: string;
  startedAt: string;
  finishedAt: string;
  elapsedSeconds: number;
  status: 'completed' | 'failed';
  error: string | null;
  options: DeepTrainOptions;
  hardwareProfile: {
    logicalCpuCount: number;
    totalMemoryGiB: number;
    selfPlayWorkers: number;
    deepBatchSize: number;
  };
  command: {
    argv: string[];
    selfPlay: {
      script: string;
      args: string[];
    };
    deepTrain: {
      script: string;
      args: string[];
      launcher: string | null;
    };
  };
  paths: {
    rawDatasetPath: string;
    trainingDatasetPath: string;
    replayPath: string | null;
    checkpointPath: string;
    modelOutPath: string;
    manifestOutPath: string;
    manifestHistoryPath: string | null;
  };
  replay: {
    enabled: boolean;
    merge: ReplayMergeResult | null;
  };
}

const HARDWARE_PROFILE = getStrategoHardwareProfile();

const DEFAULT_OPTIONS: DeepTrainOptions = {
  games: 240,
  difficulty: 'hard',
  maxTurns: 500,
  noCaptureDrawMoves: 160,
  workers: HARDWARE_PROFILE.selfPlayWorkers,
  verbose: true,
  traceTurns: false,
  progressEvery: 20,
  epochs: 60,
  batchSize: HARDWARE_PROFILE.deepBatchSize,
  learningRate: 0.0015,
  weightDecay: 0.0001,
  hidden: '96,48',
  keepDataset: false,
  datasetOut: null,
  checkpointPath: '.stratego-cache/deep-training.ckpt',
  resume: true,
  warmStart: true,
  saveEvery: 1,
  earlyStopPatience: 6,
  earlyStopMinDelta: 0.002,
  earlyStopMinEpochs: 10,
  replayEnabled: true,
  replayPath: '.stratego-cache/deep-replay-buffer.json',
  replayMaxRuns: 6,
  replayMaxSamples: 400000,
  includePolicyTargets: false,
  policyTemperature: 1.1,
  policyTopK: 12,
  valueTargetMode: 'terminal',
  searchValueBlend: 0.35,
  bootstrapSteps: 0,
  bootstrapDiscount: 1,
  bootstrapBlend: 0,
  leagueModelPaths: [],
  leagueSampleProb: 0,
  leagueHeuristicProb: 0,
  searchAlgorithm: 'minimax',
  puctSimulations: 240,
  puctCpuct: 1.18,
  puctRolloutDepth: 18,
  ampMode: 'auto',
  compileMode: 'auto',
  manifestOut: '.stratego-cache/manifests/last-deep-train.json',
  manifestHistoryPath: '.stratego-cache/manifests/deep-train-history.jsonl',
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = Date.now();
  const runId = `deep-${startedAt}-${Math.random().toString(16).slice(2, 8)}`;
  const startedAtIso = new Date(startedAt).toISOString();
  const manifestOutPath = path.resolve(process.cwd(), options.manifestOut);
  const manifestHistoryPath = options.manifestHistoryPath
    ? path.resolve(process.cwd(), options.manifestHistoryPath)
    : null;
  const trainModelScript = path.resolve(process.cwd(), 'scripts/stratego/train-model.ts');
  const deepScriptPath = path.resolve(process.cwd(), 'scripts/stratego/train-model-deep.py');
  const outputModelPath = path.resolve(process.cwd(), 'lib/stratego/trained-model.json');
  const checkpointPath = path.resolve(process.cwd(), options.checkpointPath);
  const rawDatasetPath = options.datasetOut
    ? path.resolve(process.cwd(), options.datasetOut)
    : path.resolve(process.cwd(), '.stratego-cache', `deep-dataset-${Date.now()}.json`);
  let datasetForTrainingPath = rawDatasetPath;
  let replayMerge: ReplayMergeResult | null = null;
  let selfPlayArgs: string[] = [];
  let pythonArgs: string[] = [];
  let pythonLauncher: string | null = null;
  let status: 'completed' | 'failed' = 'failed';
  let failureMessage: string | null = null;

  try {
    logStage(
      'setup',
      `Hardware profile | cpu=${HARDWARE_PROFILE.logicalCpuCount} ram=${HARDWARE_PROFILE.totalMemoryGiB.toFixed(1)}GiB defaultWorkers=${HARDWARE_PROFILE.selfPlayWorkers} defaultBatch=${HARDWARE_PROFILE.deepBatchSize}`,
    );
    logStage('setup', `Deep training pipeline | games=${options.games} difficulty=${options.difficulty} workers=${options.workers} epochs=${options.epochs}`);
    logStage('setup', `Self-play limits | maxTurns=${options.maxTurns} noCaptureDraw=${options.noCaptureDrawMoves}`);
    logStage(
      'setup',
      `Early stop | patience=${options.earlyStopPatience} minDelta=${options.earlyStopMinDelta} minEpochs=${options.earlyStopMinEpochs}`,
    );
    if (options.replayEnabled) {
      logStage('setup', `Replay buffer enabled | path=${options.replayPath} maxRuns=${options.replayMaxRuns} maxSamples=${options.replayMaxSamples}`);
    }
    if (options.includePolicyTargets) {
      logStage(
        'setup',
        `Policy targets enabled | temperature=${options.policyTemperature} topK=${options.policyTopK}`,
      );
    }
    if (options.valueTargetMode !== 'terminal') {
      logStage(
        'setup',
        `Value targets mode=${options.valueTargetMode} searchBlend=${options.searchValueBlend}`,
      );
    }
    if (options.bootstrapSteps > 0 && options.bootstrapBlend > 0) {
      logStage(
        'setup',
        `N-step bootstrap steps=${options.bootstrapSteps} discount=${options.bootstrapDiscount} blend=${options.bootstrapBlend}`,
      );
    }
    if (
      options.leagueModelPaths.length > 0
      && (options.leagueSampleProb > 0 || options.leagueHeuristicProb > 0)
    ) {
      logStage(
        'setup',
        `League self-play pool=${options.leagueModelPaths.length} sampleProb=${options.leagueSampleProb} heuristicProb=${options.leagueHeuristicProb}`,
      );
    }
    if (options.searchAlgorithm === 'puct-lite') {
      logStage(
        'setup',
        `Search mode puct-lite | sims=${options.puctSimulations} cpuct=${options.puctCpuct} rolloutDepth=${options.puctRolloutDepth}`,
      );
    }
    logStage('setup', `Deep runtime | amp=${options.ampMode} compile=${options.compileMode}`);
    logStage(
      'setup',
      `Run manifest | out=${manifestOutPath}${manifestHistoryPath ? ` history=${manifestHistoryPath}` : ' history=disabled'}`,
    );
    logStage('self-play', 'Generating dataset with multi-process self-play...');

    selfPlayArgs = [
      '--import',
      'tsx',
      trainModelScript,
      '--games',
      String(options.games),
      '--difficulty',
      options.difficulty,
      '--max-turns',
      String(options.maxTurns),
      '--no-capture-draw',
      String(options.noCaptureDrawMoves),
      '--workers',
      String(options.workers),
      '--progress-every',
      String(options.progressEvery),
      '--dataset-out',
      rawDatasetPath,
      '--skip-fit',
    ];
    if (options.verbose) selfPlayArgs.push('--verbose');
    if (options.traceTurns) selfPlayArgs.push('--trace-turns');
    if (options.includePolicyTargets) {
      selfPlayArgs.push(
        '--policy-targets',
        '--policy-temperature',
        String(options.policyTemperature),
        '--policy-top-k',
        String(options.policyTopK),
      );
    }
    if (options.valueTargetMode !== 'terminal') {
      selfPlayArgs.push('--value-target-mode', options.valueTargetMode);
      selfPlayArgs.push('--search-value-blend', String(options.searchValueBlend));
    }
    if (options.bootstrapSteps > 0 && options.bootstrapBlend > 0) {
      selfPlayArgs.push('--bootstrap-steps', String(options.bootstrapSteps));
      selfPlayArgs.push('--bootstrap-discount', String(options.bootstrapDiscount));
      selfPlayArgs.push('--bootstrap-blend', String(options.bootstrapBlend));
    }
    if (options.leagueModelPaths.length > 0 || options.leagueHeuristicProb > 0) {
      if (options.leagueModelPaths.length > 0) {
        selfPlayArgs.push('--league-models', options.leagueModelPaths.join(','));
      }
      selfPlayArgs.push('--league-sample-prob', String(options.leagueSampleProb));
      selfPlayArgs.push('--league-heuristic-prob', String(options.leagueHeuristicProb));
    }
    if (options.searchAlgorithm === 'puct-lite') {
      selfPlayArgs.push('--search-mode', 'puct-lite');
      selfPlayArgs.push('--puct-simulations', String(options.puctSimulations));
      selfPlayArgs.push('--puct-cpuct', String(options.puctCpuct));
      selfPlayArgs.push('--puct-rollout-depth', String(options.puctRolloutDepth));
    }

    await runCommand(process.execPath, selfPlayArgs);

    if (options.replayEnabled) {
      replayMerge = mergeIntoReplayBuffer({
        replayPath: path.resolve(process.cwd(), options.replayPath),
        incomingDatasetPath: rawDatasetPath,
        options,
      });
      datasetForTrainingPath = replayMerge.trainingDatasetPath;
      logStage(
        'dataset',
        `Replay buffer ready | runs=${replayMerge.runCount} samples=${replayMerge.sampleCount} (+${replayMerge.newSamples}, dropped=${replayMerge.droppedSamples})`,
      );
    }

    logStage('deep-train', 'Training deep neural net (PyTorch, accelerator if available)...');
    pythonArgs = [
      deepScriptPath,
      '--dataset',
      datasetForTrainingPath,
      '--out',
      outputModelPath,
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
      '--checkpoint',
      checkpointPath,
      '--save-every',
      String(options.saveEvery),
      '--early-stop-patience',
      String(options.earlyStopPatience),
      '--early-stop-min-delta',
      String(options.earlyStopMinDelta),
      '--early-stop-min-epochs',
      String(options.earlyStopMinEpochs),
      '--amp',
      options.ampMode,
      '--compile',
      options.compileMode,
    ];
    pythonArgs.push(options.resume ? '--resume' : '--no-resume');
    pythonArgs.push(options.warmStart ? '--warm-start' : '--no-warm-start');

    pythonLauncher = await runPythonWithFallback(pythonArgs);

    if (!options.keepDataset && rawDatasetPath !== datasetForTrainingPath) {
      rmSync(rawDatasetPath, { force: true });
    } else if (!options.keepDataset && !options.replayEnabled) {
      rmSync(rawDatasetPath, { force: true });
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    logStage('done', `Deep model training complete in ${elapsedSeconds}s`);
    logStage('done', 'Restart `npm run dev` (or rebuild) so the app picks up the new model.');
    status = 'completed';
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error);
    status = 'failed';
    throw error;
  } finally {
    const finishedAt = Date.now();
    const manifest: DeepTrainRunManifest = {
      runId,
      startedAt: startedAtIso,
      finishedAt: new Date(finishedAt).toISOString(),
      elapsedSeconds: Number(((finishedAt - startedAt) / 1000).toFixed(3)),
      status,
      error: failureMessage,
      options: {
        ...options,
        leagueModelPaths: [...options.leagueModelPaths],
      },
      hardwareProfile: {
        logicalCpuCount: HARDWARE_PROFILE.logicalCpuCount,
        totalMemoryGiB: HARDWARE_PROFILE.totalMemoryGiB,
        selfPlayWorkers: HARDWARE_PROFILE.selfPlayWorkers,
        deepBatchSize: HARDWARE_PROFILE.deepBatchSize,
      },
      command: {
        argv: [...process.argv.slice(2)],
        selfPlay: {
          script: trainModelScript,
          args: [...selfPlayArgs],
        },
        deepTrain: {
          script: deepScriptPath,
          args: [...pythonArgs],
          launcher: pythonLauncher,
        },
      },
      paths: {
        rawDatasetPath,
        trainingDatasetPath: datasetForTrainingPath,
        replayPath: options.replayEnabled ? path.resolve(process.cwd(), options.replayPath) : null,
        checkpointPath,
        modelOutPath: outputModelPath,
        manifestOutPath,
        manifestHistoryPath,
      },
      replay: {
        enabled: options.replayEnabled,
        merge: replayMerge,
      },
    };
    writeDeepTrainManifest(manifestOutPath, manifestHistoryPath, manifest);
  }
}

function mergeIntoReplayBuffer(input: {
  replayPath: string;
  incomingDatasetPath: string;
  options: DeepTrainOptions;
}): ReplayMergeResult {
  const incoming = readDatasetPayload(input.incomingDatasetPath);
  const existing = readDatasetPayloadIfPresent(input.replayPath);
  const nowIso = new Date().toISOString();

  let replayRuns: ReplayRunSummary[] = [];
  let replaySamples: TrainingSampleRecord[] = [];

  if (existing) {
    if (!featureNamesMatch(existing.featureNames, incoming.featureNames)) {
      logStage('dataset', 'Replay feature schema changed; starting a new replay buffer.');
    } else {
      replayRuns = normalizeReplayRuns(existing.replay?.runs, existing.samples.length, existing.meta);
      replaySamples = existing.samples;
    }
  }

  const incomingRun: ReplayRunSummary = {
    id: `run-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: nowIso,
    sampleCount: incoming.samples.length,
    source: 'self-play',
    games: readOptionalPositiveInt(incoming.meta?.games),
    difficulty: readOptionalDifficulty(incoming.meta?.difficulty),
    maxTurns: readOptionalPositiveInt(incoming.meta?.maxTurns),
    workers: readOptionalPositiveInt(incoming.meta?.workers),
  };

  let combinedRuns = [...replayRuns, incomingRun];
  let combinedSamples = [...replaySamples, ...incoming.samples];
  let droppedSamples = 0;

  if (combinedRuns.length > input.options.replayMaxRuns) {
    let runsToDrop = combinedRuns.length - input.options.replayMaxRuns;
    while (runsToDrop > 0 && combinedRuns.length > 0) {
      const droppedRun = combinedRuns.shift();
      if (droppedRun) {
        droppedSamples += droppedRun.sampleCount;
      }
      runsToDrop -= 1;
    }
  }

  if (droppedSamples > 0) {
    combinedSamples = combinedSamples.slice(droppedSamples);
  }

  if (combinedSamples.length > input.options.replayMaxSamples) {
    const overflow = combinedSamples.length - input.options.replayMaxSamples;
    combinedSamples = combinedSamples.slice(overflow);
    combinedRuns = trimRunsFromHead(combinedRuns, overflow);
    droppedSamples += overflow;
  }

  const replayPayload: DatasetPayload = {
    version: incoming.version,
    featureNames: [...incoming.featureNames],
    samples: combinedSamples,
    meta: {
      generatedAt: nowIso,
      replayEnabled: true,
      replayRuns: combinedRuns.length,
      replaySamples: combinedSamples.length,
      replayMaxRuns: input.options.replayMaxRuns,
      replayMaxSamples: input.options.replayMaxSamples,
      latestRunSamples: incoming.samples.length,
      latestRunGames: readOptionalPositiveInt(incoming.meta?.games),
      latestRunDifficulty: readOptionalDifficulty(incoming.meta?.difficulty),
      latestRunMaxTurns: readOptionalPositiveInt(incoming.meta?.maxTurns),
      latestRunWorkers: readOptionalPositiveInt(incoming.meta?.workers),
    },
    replay: {
      updatedAt: nowIso,
      runs: combinedRuns,
    },
  };

  writeDatasetPayload(input.replayPath, replayPayload);

  return {
    trainingDatasetPath: input.replayPath,
    runCount: combinedRuns.length,
    sampleCount: combinedSamples.length,
    newSamples: incoming.samples.length,
    droppedSamples,
  };
}

function normalizeReplayRuns(
  runs: ReplayRunSummary[] | undefined,
  sampleCount: number,
  meta: Record<string, unknown> | undefined,
): ReplayRunSummary[] {
  if (Array.isArray(runs) && runs.length > 0) {
    return runs
      .filter((run) => Number.isFinite(run.sampleCount) && run.sampleCount > 0)
      .map((run) => ({
        ...run,
        sampleCount: Math.floor(run.sampleCount),
        source: 'self-play',
      }));
  }

  if (sampleCount <= 0) {
    return [];
  }

  return [
    {
      id: 'legacy-replay',
      createdAt: typeof meta?.generatedAt === 'string' ? meta.generatedAt : new Date().toISOString(),
      sampleCount,
      source: 'self-play',
      games: readOptionalPositiveInt(meta?.games),
      difficulty: readOptionalDifficulty(meta?.difficulty),
      maxTurns: readOptionalPositiveInt(meta?.maxTurns),
      workers: readOptionalPositiveInt(meta?.workers),
    },
  ];
}

function trimRunsFromHead(runs: ReplayRunSummary[], dropSamples: number): ReplayRunSummary[] {
  let remainingToDrop = dropSamples;
  const nextRuns: ReplayRunSummary[] = [];

  for (const run of runs) {
    if (remainingToDrop <= 0) {
      nextRuns.push(run);
      continue;
    }
    if (run.sampleCount <= remainingToDrop) {
      remainingToDrop -= run.sampleCount;
      continue;
    }
    nextRuns.push({
      ...run,
      sampleCount: run.sampleCount - remainingToDrop,
      trimmedHead: (run.trimmedHead ?? 0) + remainingToDrop,
    });
    remainingToDrop = 0;
  }

  return nextRuns;
}

function readDatasetPayloadIfPresent(datasetPath: string): DatasetPayload | null {
  if (!existsSync(datasetPath)) {
    return null;
  }
  return readDatasetPayload(datasetPath);
}

function readDatasetPayload(datasetPath: string): DatasetPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(datasetPath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read dataset ${datasetPath}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Dataset ${datasetPath} is not a valid JSON object.`);
  }

  const payload = parsed as Partial<DatasetPayload>;
  if (!Array.isArray(payload.featureNames) || payload.featureNames.length === 0) {
    throw new Error(`Dataset ${datasetPath} is missing featureNames.`);
  }
  if (!Array.isArray(payload.samples) || payload.samples.length === 0) {
    throw new Error(`Dataset ${datasetPath} contains no samples.`);
  }

  return {
    version: typeof payload.version === 'number' ? payload.version : 1,
    featureNames: payload.featureNames.map((name) => String(name)),
    samples: payload.samples,
    meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : undefined,
    replay:
      payload.replay &&
      typeof payload.replay === 'object' &&
      Array.isArray((payload.replay as { runs?: unknown }).runs)
        ? {
            updatedAt:
              typeof (payload.replay as { updatedAt?: unknown }).updatedAt === 'string'
                ? String((payload.replay as { updatedAt?: unknown }).updatedAt)
                : new Date().toISOString(),
            runs: (payload.replay as { runs: ReplayRunSummary[] }).runs,
          }
        : undefined,
  };
}

function writeDatasetPayload(datasetPath: string, payload: DatasetPayload): void {
  mkdirSync(path.dirname(datasetPath), { recursive: true });
  writeFileSync(datasetPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function featureNamesMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function readOptionalDifficulty(value: unknown): ComputerDifficulty | undefined {
  if (value === 'medium' || value === 'hard' || value === 'extreme') {
    return value;
  }
  return undefined;
}

async function runPythonWithFallback(args: string[]): Promise<string> {
  const attempts: Array<{ command: string; commandArgs: string[]; label: string }> = [
    { command: 'python', commandArgs: args, label: 'python' },
    { command: 'py', commandArgs: ['-3', ...args], label: 'py -3' },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      logStage('deep-train', `Launching ${attempt.label}...`);
      await runCommand(attempt.command, attempt.commandArgs);
      return attempt.label;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `Unable to start Python trainer. Ensure Python and PyTorch are installed. Last error: ${lastError?.message ?? 'unknown'}`,
  );
}

function writeDeepTrainManifest(
  manifestOutPath: string,
  manifestHistoryPath: string | null,
  manifest: DeepTrainRunManifest,
): void {
  try {
    mkdirSync(path.dirname(manifestOutPath), { recursive: true });
    writeFileSync(manifestOutPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    if (manifestHistoryPath) {
      mkdirSync(path.dirname(manifestHistoryPath), { recursive: true });
      appendFileSync(manifestHistoryPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStage('warn', `Failed to persist manifest: ${message}`);
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    let finished = false;
    const onInterrupt = () => {
      if (finished) return;
      if (child.exitCode === null) {
        child.kill('SIGINT');
      }
    };
    const onTerminate = () => {
      if (finished) return;
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    };

    const cleanup = () => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    };

    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);

    child.on('error', (error) => {
      finished = true;
      cleanup();
      reject(error);
    });

    child.on('close', (code, signal) => {
      finished = true;
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`));
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function parseOptions(argv: string[]): DeepTrainOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsageAndExit();
  }

  const options: DeepTrainOptions = { ...DEFAULT_OPTIONS };

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
      case '--max-turns':
        options.maxTurns = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--no-capture-draw':
        options.noCaptureDrawMoves = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--workers':
        options.workers = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--progress-every':
        options.progressEvery = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--epochs':
        options.epochs = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--batch-size':
        options.batchSize = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--lr':
        options.learningRate = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--weight-decay':
        options.weightDecay = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--hidden':
        if (!next) throw new Error('Missing value for --hidden');
        options.hidden = next;
        index += 1;
        break;
      case '--dataset-out':
        if (!next) throw new Error('Missing value for --dataset-out');
        options.datasetOut = next;
        index += 1;
        break;
      case '--checkpoint':
        if (!next) throw new Error('Missing value for --checkpoint');
        options.checkpointPath = next;
        index += 1;
        break;
      case '--keep-dataset':
        options.keepDataset = true;
        break;
      case '--no-resume':
        options.resume = false;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--no-warm-start':
        options.warmStart = false;
        break;
      case '--warm-start':
        options.warmStart = true;
        break;
      case '--save-every':
        options.saveEvery = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--early-stop-patience':
        options.earlyStopPatience = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--early-stop-min-delta':
        options.earlyStopMinDelta = parseNonNegativeFloat(next, arg);
        index += 1;
        break;
      case '--early-stop-min-epochs':
        options.earlyStopMinEpochs = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--replay':
        options.replayEnabled = true;
        break;
      case '--no-replay':
        options.replayEnabled = false;
        break;
      case '--replay-path':
        if (!next) throw new Error('Missing value for --replay-path');
        options.replayPath = next;
        index += 1;
        break;
      case '--replay-max-runs':
        options.replayMaxRuns = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--replay-max-samples':
        options.replayMaxSamples = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--policy-targets':
        options.includePolicyTargets = true;
        break;
      case '--policy-temperature':
        options.policyTemperature = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--policy-top-k':
        options.policyTopK = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--value-target-mode':
        options.valueTargetMode = parseValueTargetMode(next);
        index += 1;
        break;
      case '--search-value-blend':
        options.searchValueBlend = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--bootstrap-steps':
        options.bootstrapSteps = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--bootstrap-discount':
        options.bootstrapDiscount = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--bootstrap-blend':
        options.bootstrapBlend = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--league-models':
        options.leagueModelPaths = parsePathList(next, arg);
        index += 1;
        break;
      case '--league-sample-prob':
        options.leagueSampleProb = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--league-heuristic-prob':
        options.leagueHeuristicProb = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--search-mode':
        options.searchAlgorithm = parseSearchAlgorithm(next);
        index += 1;
        break;
      case '--puct-simulations':
        options.puctSimulations = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--puct-cpuct':
        options.puctCpuct = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--puct-rollout-depth':
        options.puctRolloutDepth = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--amp':
        options.ampMode = parseRuntimeOptimizeMode(next, arg);
        index += 1;
        break;
      case '--compile':
        options.compileMode = parseRuntimeOptimizeMode(next, arg);
        index += 1;
        break;
      case '--manifest-out':
        if (!next) throw new Error('Missing value for --manifest-out');
        options.manifestOut = next;
        index += 1;
        break;
      case '--manifest-history':
        if (!next) throw new Error('Missing value for --manifest-history');
        options.manifestHistoryPath = next;
        index += 1;
        break;
      case '--no-manifest-history':
        options.manifestHistoryPath = null;
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
  if (value === 'medium' || value === 'hard' || value === 'extreme') {
    return value;
  }
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parsePositiveFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseNonNegativeFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
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

function parseUnitInterval(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parsePathList(value: string | undefined, flag: string): string[] {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const paths = value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (paths.length === 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return paths;
}

function parseValueTargetMode(value: string | undefined): ValueTargetMode {
  if (value === 'terminal' || value === 'mixed' || value === 'search') {
    return value;
  }
  throw new Error(`Invalid --value-target-mode value: ${value}`);
}

function parseSearchAlgorithm(value: string | undefined): SearchAlgorithm {
  if (value === 'minimax' || value === 'puct-lite') {
    return value;
  }
  throw new Error(`Invalid --search-mode value: ${value}`);
}

function parseRuntimeOptimizeMode(
  value: string | undefined,
  flag: string,
): RuntimeOptimizeMode {
  if (value === 'auto' || value === 'on' || value === 'off') {
    return value;
  }
  throw new Error(`Invalid value for ${flag}: ${value}. Expected auto|on|off`);
}

function printUsageAndExit(): never {
  console.log('Usage: npm run stratego:train:deep -- [options]');
  console.log('');
  console.log('Self-play options:');
  console.log('  --games <n>           Self-play game count (default: 240)');
  console.log('  --difficulty <d>      medium|hard|extreme (default: hard)');
  console.log('  --max-turns <n>       Max turns per game (default: 500)');
  console.log('  --no-capture-draw <n> Draw when no capture occurs for N moves (default: 160, 0 disables)');
  console.log(`  --workers <n>         Worker processes (default: ${DEFAULT_OPTIONS.workers})`);
  console.log('  --progress-every <n>  Self-play progress interval (default: 20)');
  console.log('  --verbose, -v         Verbose self-play logging');
  console.log('  --trace-turns         Turn-by-turn trace logging');
  console.log('');
  console.log('Deep model options:');
  console.log('  --epochs <n>          Deep training epochs (default: 60)');
  console.log(`  --batch-size <n>      Batch size (default: ${DEFAULT_OPTIONS.batchSize})`);
  console.log('  --lr <n>              Learning rate (default: 0.0015)');
  console.log('  --weight-decay <n>    Weight decay (default: 0.0001)');
  console.log('  --hidden <csv>        Hidden layers, e.g. "128,64" (default: 96,48)');
  console.log('  --amp <m>             AMP mode: auto|on|off (default: auto)');
  console.log('  --compile <m>         torch.compile mode: auto|on|off (default: auto)');
  console.log('  --checkpoint <path>   Checkpoint file for resume (default: .stratego-cache/deep-training.ckpt)');
  console.log('  --resume              Resume from checkpoint if present (default)');
  console.log('  --no-resume           Ignore checkpoint and start fresh');
  console.log('  --warm-start          Warm start from existing output model (default)');
  console.log('  --no-warm-start       Disable warm start from existing output model');
  console.log('  --save-every <n>      Save checkpoint every N epochs (default: 1)');
  console.log('  --early-stop-patience <n>  Stop after N non-improving epochs (default: 6, 0 disables)');
  console.log('  --early-stop-min-delta <n> Min val_mse improvement to reset patience (default: 0.002)');
  console.log('  --early-stop-min-epochs <n> Earliest epoch eligible for early stop (default: 10)');
  console.log('');
  console.log('Dataset options:');
  console.log('  --dataset-out <path>  Persist dataset at this path');
  console.log('  --keep-dataset        Do not delete dataset file after training');
  console.log('  --replay              Train on rolling replay buffer (default)');
  console.log('  --no-replay           Train only on the current run dataset');
  console.log('  --replay-path <path>  Replay buffer dataset path (default: .stratego-cache/deep-replay-buffer.json)');
  console.log('  --replay-max-runs <n> Max recent runs to retain in replay (default: 6)');
  console.log('  --replay-max-samples <n> Cap replay samples to keep training fast (default: 400000)');
  console.log('  --policy-targets      Include search-policy targets in generated dataset');
  console.log('  --policy-temperature <n> Policy softmax temperature (default: 1.1)');
  console.log('  --policy-top-k <n>    Keep top-K scored moves for policy targets (default: 12)');
  console.log('  --value-target-mode <m> terminal|mixed|search (default: terminal)');
  console.log('  --search-value-blend <n> Blend weight for search value in mixed mode [0..1] (default: 0.35)');
  console.log('  --bootstrap-steps <n> N-step lookahead for bootstrapped value target (default: 0, disabled)');
  console.log('  --bootstrap-discount <n> Discount for bootstrapped target in [0..1] (default: 1.0)');
  console.log('  --bootstrap-blend <n> Blend weight for bootstrapped target in [0..1] (default: 0.0)');
  console.log('  --league-models <csv> Optional league pool model paths (comma/semicolon-separated)');
  console.log('  --league-sample-prob <n> Per-side probability to sample from league pool [0..1] (default: 0)');
  console.log('  --league-heuristic-prob <n> Per-side probability to force heuristic-only play [0..1] (default: 0)');
  console.log('  --search-mode <m>     minimax|puct-lite (default: minimax)');
  console.log('  --puct-simulations <n> PUCT simulations when --search-mode puct-lite (default: 240)');
  console.log('  --puct-cpuct <n>      PUCT exploration constant (default: 1.18)');
  console.log('  --puct-rollout-depth <n> PUCT depth cutoff for value eval (default: 18)');
  console.log('');
  console.log('Run tracking options:');
  console.log('  --manifest-out <path>     Structured run manifest JSON output (default: .stratego-cache/manifests/last-deep-train.json)');
  console.log('  --manifest-history <path> Append JSONL run history (default: .stratego-cache/manifests/deep-train-history.jsonl)');
  console.log('  --no-manifest-history     Disable JSONL history append');
  process.exit(0);
}

function logStage(
  stage: 'setup' | 'self-play' | 'dataset' | 'deep-train' | 'done' | 'warn',
  message: string,
): void {
  const clock = new Date().toISOString().slice(11, 19);
  console.log(`[${clock}] [${stage}] ${message}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
