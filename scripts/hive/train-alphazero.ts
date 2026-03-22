import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { HiveComputerDifficulty } from '../../lib/hive/ai';
import {
  applyHiveMove,
  createLocalHiveGameState,
  getLegalMovesForColor,
  runHiveMctsSearch,
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
import { publishHiveMetricsSnapshotSafely } from './sharedMetrics';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import type { GameState, PlayerColor } from '../../lib/hive/types';
import { getHiveHardwareProfile } from './hardware-profile';

type ArenaGateMode = 'fixed' | 'sprt';

interface AlphaZeroOptions {
  generationIndex: number;
  games: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  simulations: number;
  fastSimulations: number;
  fastRatio: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
  weightDecay: number;
  hidden: string;
  replayPath: string;
  replayMaxSamples: number;
  reanalyseFraction: number;
  reanalyseWorkers: number;
  datasetOut: string | null;
  keepDataset: boolean;
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
  metricsLogPath: string;
  verbose: boolean;
}

interface PolicyTarget {
  actionKey: string;
  probability: number;
  visitCount: number;
  actionFeatures: number[];
}

interface AlphaZeroSample {
  stateFeatures: number[];
  perspective: PlayerColor;
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
  samples: AlphaZeroSample[];
}

interface ReanalyseWorkerSample {
  index: number;
  stateSnapshot: GameState;
}

interface ReanalyseWorkerPayload {
  samples: ReanalyseWorkerSample[];
  modelPath: string;
  difficulty: HiveComputerDifficulty;
  fastSimulations: number;
  maxTurns: number;
}

interface ReanalyseWorkerUpdate {
  index: number;
  policyTargets: PolicyTarget[];
  searchMeta: AlphaZeroSample['searchMeta'];
}

interface ReanalyseWorkerResult {
  updates: ReanalyseWorkerUpdate[];
}

interface MetricsLogger {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
}

interface ProgressiveSimulationSchedule {
  fullSimulations: number;
  fastSimulations: number;
}

interface SelfPlayResult {
  samples: AlphaZeroSample[];
  gamesPlayed: number;
  whiteWins: number;
  blackWins: number;
  draws: number;
  totalMoves: number;
  totalSimulations: number;
  averageSimulationsPerMove: number;
  positionsPerSecond: number;
  elapsedSeconds: number;
}

const HARDWARE_PROFILE = getHiveHardwareProfile();

const DEFAULT_OPTIONS: AlphaZeroOptions = {
  generationIndex: 1,
  games: 220,
  difficulty: 'extreme',
  maxTurns: 320,
  noCaptureDrawMoves: 100,
  simulations: 220,
  fastSimulations: 72,
  fastRatio: 0.55,
  epochs: 26,
  batchSize: Math.max(256, Math.min(1024, HARDWARE_PROFILE.deepBatchSize)),
  learningRate: 0.0015,
  weightDecay: 0.0001,
  hidden: '128,64',
  replayPath: '.hive-cache/az-replay-buffer.json',
  replayMaxSamples: 220000,
  reanalyseFraction: 0.2,
  reanalyseWorkers: Math.max(1, Math.min(6, HARDWARE_PROFILE.logicalCpuCount - 2)),
  datasetOut: null,
  keepDataset: false,
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
  metricsLogPath: '.hive-cache/metrics/training-metrics.jsonl',
  verbose: false,
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const logger = createMetricsLogger(options.metricsLogPath);
  const startedAt = performance.now();

  logger.log('run_start', {
    source: 'az',
    options,
    pid: process.pid,
  });

  const schedule = computeProgressiveSimulationSchedule(options);
  console.log(
    `[az:setup] generation=${options.generationIndex} games=${options.games} difficulty=${options.difficulty} sims=${schedule.fullSimulations} fast_sims=${schedule.fastSimulations} fast_ratio=${options.fastRatio.toFixed(2)} epochs=${options.epochs} batch=${options.batchSize}`,
  );

  const selfPlayStartedAt = performance.now();
  const selfPlayResult = runSelfPlay(options, schedule, logger);
  const selfPlaySamples = selfPlayResult.samples;
  console.log(
    `[az:self-play] generated ${selfPlaySamples.length} samples in ${formatDuration(performance.now() - selfPlayStartedAt)} (${selfPlayResult.positionsPerSecond.toFixed(2)} pos/s, sims/move=${selfPlayResult.averageSimulationsPerMove.toFixed(1)})`,
  );
  logger.log('self_play_summary', {
    source: 'az',
    generationIndex: options.generationIndex,
    games: selfPlayResult.gamesPlayed,
    whiteWins: selfPlayResult.whiteWins,
    blackWins: selfPlayResult.blackWins,
    draws: selfPlayResult.draws,
    sampleCount: selfPlaySamples.length,
    totalMoves: selfPlayResult.totalMoves,
    totalSimulations: selfPlayResult.totalSimulations,
    avgSimulationsPerMove: selfPlayResult.averageSimulationsPerMove,
    positionsPerSecond: selfPlayResult.positionsPerSecond,
    elapsedSeconds: selfPlayResult.elapsedSeconds,
  });

  const replayResult = mergeReplayBuffer(options, selfPlaySamples);
  const reanalysed = await reanalyseReplaySamples(options, replayResult.samples);
  const replayFreshnessRatio = replayResult.samples.length > 0
    ? reanalysed / replayResult.samples.length
    : 0;
  logger.log('reanalyze_pass', {
    source: 'az',
    generationIndex: options.generationIndex,
    replaySamples: replayResult.samples.length,
    reanalyseFraction: options.reanalyseFraction,
    reanalysedSamples: reanalysed,
    replayFreshnessRatio,
  });
  console.log(
    `[az:reanalyse] updated ${reanalysed} samples in replay buffer (fraction=${options.reanalyseFraction.toFixed(2)})`,
  );

  const datasetPath = options.datasetOut
    ? path.resolve(process.cwd(), options.datasetOut)
    : path.resolve(process.cwd(), '.hive-cache', `az-dataset-${Date.now()}.json`);
  writeDataset(datasetPath, replayResult);
  console.log(`[az:dataset] wrote ${replayResult.samples.length} samples -> ${datasetPath}`);

  if (!options.skipTraining) {
    await runPythonTraining(options, datasetPath);
  } else {
    console.log('[az:train] skipped (--skip-training)');
  }

  if (!options.skipArena && !options.skipTraining) {
    await runArenaGate(options);
  } else if (options.skipArena) {
    console.log('[az:arena] skipped (--skip-arena)');
  }

  if (!options.keepDataset) {
    rmSync(datasetPath, { force: true });
  }

  const elapsedMs = performance.now() - startedAt;
  logger.log('run_end', {
    source: 'az',
    status: 'completed',
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
    generatedSamples: selfPlaySamples.length,
    replaySamples: replayResult.samples.length,
    reanalysedSamples: reanalysed,
    replayFreshnessRatio,
    generationIndex: options.generationIndex,
    scheduledFullSimulations: schedule.fullSimulations,
    scheduledFastSimulations: schedule.fastSimulations,
    selfPlayGames: selfPlayResult.gamesPlayed,
    selfPlayTotalMoves: selfPlayResult.totalMoves,
    selfPlayTotalSimulations: selfPlayResult.totalSimulations,
    avgSimulationsPerMove: selfPlayResult.averageSimulationsPerMove,
    positionsPerSecond: selfPlayResult.positionsPerSecond,
    selfPlayElapsedSeconds: selfPlayResult.elapsedSeconds,
  });

  console.log(`[az:done] elapsed=${formatDuration(elapsedMs)}`);
  await publishHiveMetricsSnapshotSafely(options.metricsLogPath);
}

function runSelfPlay(
  options: AlphaZeroOptions,
  schedule: ProgressiveSimulationSchedule,
  logger: MetricsLogger,
): SelfPlayResult {
  const startedAt = performance.now();
  const all: AlphaZeroSample[] = [];
  let whiteWins = 0;
  let blackWins = 0;
  let draws = 0;
  let totalMoves = 0;
  let totalSimulations = 0;

  for (let gameIndex = 1; gameIndex <= options.games; gameIndex += 1) {
    const rng = createRng(2026 + gameIndex * 73);
    const perGameSamples: AlphaZeroSample[] = [];
    let state = createLocalHiveGameState({
      id: `az-selfplay-${Date.now()}-${gameIndex}`,
      shortCode: 'AZSP',
      whitePlayerId: 'az-white',
      blackPlayerId: 'az-black',
    });

    let noProgress = 0;
    let prevPressure = queenPressure(state);

    while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
      const simulations = rng() < options.fastRatio
        ? schedule.fastSimulations
        : schedule.fullSimulations;
      const mctsConfig = {
        simulations,
        dirichletAlpha: state.turnNumber < 10 ? 0.35 : 0.22,
        temperature: state.turnNumber < 20 ? 0.7 : 0.12,
        maxDepth: options.maxTurns,
      };
      const search = runHiveMctsSearch(state, state.currentTurn, options.difficulty, {
        engine: 'alphazero',
        mctsConfig,
        randomSeed: 9001 + gameIndex * 197 + state.turnNumber,
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
      perGameSamples.push({
        stateFeatures: extractHiveTokenStateFeatures(state, state.currentTurn, HIVE_DEFAULT_TOKEN_SLOTS),
        perspective: state.currentTurn,
        valueTarget: 0,
        policyTargets: search.policy.map((entry) => ({
          actionKey: entry.actionKey,
          probability: entry.rawProbability ?? entry.probability,
          visitCount: entry.rawVisits ?? entry.visits,
          actionFeatures: extractHiveActionFeatures(state, entry.move, state.currentTurn),
        })),
        auxTargets: {
          queenSurroundDelta: clamp((queenPressureSigned(state, state.currentTurn)) / 6, -1, 1),
          mobility: estimateMobilityState(state, state.currentTurn),
          lengthBucket,
        },
        searchMeta: {
          simulations: search.stats.simulations,
          nodesPerSecond: search.stats.nodesPerSecond,
          policyEntropy: search.stats.policyEntropy,
          averageDepth: search.stats.averageSimulationDepth,
          dirichletAlpha: mctsConfig.dirichletAlpha,
          temperature: mctsConfig.temperature,
          maxDepth: mctsConfig.maxDepth,
          reanalysed: false,
        },
        stateSnapshot: cloneState(state),
      });

      state = applyHiveMove(state, search.selectedMove);
      const pressure = queenPressure(state);
      if (pressure === prevPressure) noProgress += 1;
      else {
        noProgress = 0;
        prevPressure = pressure;
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

    for (const sample of perGameSamples) {
      sample.valueTarget = winner === 'draw' || !winner
        ? 0
        : winner === sample.perspective
          ? 1
          : -1;
    }
    all.push(...perGameSamples);

    if (options.verbose || gameIndex % 20 === 0 || gameIndex === options.games) {
      console.log(
        `[az:self-play] ${gameIndex}/${options.games} winner=${winner ?? 'draw'} samples=${all.length} W/B/D=${whiteWins}/${blackWins}/${draws}`,
      );
      logger.log('self_play_progress', {
        source: 'az',
        completedGames: gameIndex,
        totalGames: options.games,
        sampleCount: all.length,
        whiteWins,
        blackWins,
        draws,
      });
    }
  }

  const elapsedSeconds = Math.max(1e-6, (performance.now() - startedAt) / 1000);
  return {
    samples: all,
    gamesPlayed: options.games,
    whiteWins,
    blackWins,
    draws,
    totalMoves,
    totalSimulations,
    averageSimulationsPerMove: totalMoves > 0 ? totalSimulations / totalMoves : 0,
    positionsPerSecond: all.length / elapsedSeconds,
    elapsedSeconds,
  };
}

function mergeReplayBuffer(options: AlphaZeroOptions, freshSamples: AlphaZeroSample[]): ReplayPayload {
  const replayPath = path.resolve(process.cwd(), options.replayPath);
  const existing = readReplayPayload(replayPath);
  const now = new Date().toISOString();
  const merged = [...(existing?.samples ?? []), ...freshSamples];
  const trimmed = merged.slice(Math.max(0, merged.length - options.replayMaxSamples));

  const payload: ReplayPayload = {
    version: 2,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    stateFeatureNames: buildHiveTokenStateFeatureNames(HIVE_DEFAULT_TOKEN_SLOTS),
    actionFeatureNames: [...HIVE_ACTION_FEATURE_NAMES],
    samples: trimmed,
  };

  mkdirSync(path.dirname(replayPath), { recursive: true });
  writeFileSync(replayPath, `${JSON.stringify(payload)}\n`, 'utf8');
  return payload;
}

function readReplayPayload(absolutePath: string): ReplayPayload | null {
  if (!existsSync(absolutePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as ReplayPayload;
    if (!Array.isArray(parsed.samples)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function reanalyseReplaySamples(options: AlphaZeroOptions, samples: AlphaZeroSample[]): Promise<number> {
  if (samples.length === 0 || options.reanalyseFraction <= 0) return 0;
  const championModel = loadModelOrNull(options.championModelPath);
  if (!championModel) return 0;

  const count = Math.min(samples.length, Math.floor(samples.length * options.reanalyseFraction));
  if (count <= 0) return 0;
  const rng = createRng(4242 + samples.length);
  const selectedIndices = sampleUniqueIndices(samples.length, count, rng);
  const workerCount = Math.max(1, Math.min(options.reanalyseWorkers, selectedIndices.length));

  if (workerCount > 1) {
    const updated = await reanalyseReplaySamplesInWorkers(options, samples, selectedIndices, workerCount);
    if (updated > 0) return updated;
    console.warn('[az:reanalyse] worker reanalyse fallback to inline mode');
  }

  let updated = 0;
  for (let index = 0; index < selectedIndices.length; index += 1) {
    const sampleIndex = selectedIndices[index];
    const sample = samples[sampleIndex];
    const state = sample.stateSnapshot;
    const legal = getLegalMovesForColor(state, state.currentTurn);
    if (legal.length === 0) continue;
    const search = runHiveMctsSearch(state, state.currentTurn, options.difficulty, {
      engine: 'alphazero',
      modelOverride: championModel,
      mctsConfig: { simulations: Math.max(48, Math.floor(options.fastSimulations * 0.8)) },
      randomSeed: 7777 + index * 17,
    });
    if (search.policy.length === 0) continue;

    sample.policyTargets = search.policy.map((entry) => ({
      actionKey: entry.actionKey,
      probability: entry.rawProbability ?? entry.probability,
      visitCount: entry.rawVisits ?? entry.visits,
      actionFeatures: extractHiveActionFeatures(state, entry.move, state.currentTurn),
    }));
    sample.searchMeta = {
      simulations: search.stats.simulations,
      nodesPerSecond: search.stats.nodesPerSecond,
      policyEntropy: search.stats.policyEntropy,
      averageDepth: search.stats.averageSimulationDepth,
      dirichletAlpha: 0,
      temperature: 0,
      maxDepth: options.maxTurns,
      reanalysed: true,
    };
    updated += 1;
  }

  return updated;
}

async function reanalyseReplaySamplesInWorkers(
  options: AlphaZeroOptions,
  samples: AlphaZeroSample[],
  selectedIndices: number[],
  workerCount: number,
): Promise<number> {
  const workerScript = path.resolve(process.cwd(), 'scripts/hive/reanalyse-worker.ts');
  if (!existsSync(workerScript)) {
    return 0;
  }

  const tempRoot = path.resolve(process.cwd(), '.hive-cache', 'tmp', 'reanalyse');
  mkdirSync(tempRoot, { recursive: true });
  const timestamp = Date.now();
  const chunks = chunkIndices(selectedIndices, workerCount);
  if (chunks.length === 0) return 0;

  const jobs = chunks.map((chunk, workerIndex) => {
    const inputPath = path.join(tempRoot, `in-${timestamp}-${workerIndex}.json`);
    const outputPath = path.join(tempRoot, `out-${timestamp}-${workerIndex}.json`);
    const payload: ReanalyseWorkerPayload = {
      samples: chunk.map((sampleIndex) => ({
        index: sampleIndex,
        stateSnapshot: samples[sampleIndex].stateSnapshot,
      })),
      modelPath: path.resolve(process.cwd(), options.championModelPath),
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
      workerScript,
      '--input',
      job.inputPath,
      '--output',
      job.outputPath,
    ])));

    let updated = 0;
    for (const job of jobs) {
      if (!existsSync(job.outputPath)) continue;
      const parsed = JSON.parse(readFileSync(job.outputPath, 'utf8')) as ReanalyseWorkerResult;
      if (!parsed || !Array.isArray(parsed.updates)) continue;
      for (const update of parsed.updates) {
        const sample = samples[update.index];
        if (!sample) continue;
        sample.policyTargets = update.policyTargets;
        sample.searchMeta = update.searchMeta;
        updated += 1;
      }
    }
    return updated;
  } finally {
    for (const job of jobs) {
      rmSync(job.inputPath, { force: true });
      rmSync(job.outputPath, { force: true });
    }
  }
}

function writeDataset(datasetPath: string, payload: ReplayPayload): void {
  mkdirSync(path.dirname(datasetPath), { recursive: true });
  writeFileSync(datasetPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function runPythonTraining(options: AlphaZeroOptions, datasetPath: string): Promise<void> {
  const scriptPath = path.resolve(process.cwd(), 'scripts/hive/train-alphazero.py');
  const outPath = path.resolve(process.cwd(), options.candidateOutPath);
  mkdirSync(path.dirname(outPath), { recursive: true });

  const args = [
    scriptPath,
    '--dataset',
    datasetPath,
    '--out',
    outPath,
    '--init-model',
    path.resolve(process.cwd(), options.championModelPath),
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
  ];

  await runPythonWithFallback(args);
}

async function runArenaGate(options: AlphaZeroOptions): Promise<void> {
  const script = path.resolve(process.cwd(), 'scripts/hive/eval-arena.ts');
  const args = [
    '--import',
    'tsx',
    script,
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
  ];
  await runCommand(process.execPath, args);
}

function loadModelOrNull(relativePath: string): HiveModel | null {
  const absolute = path.resolve(process.cwd(), relativePath);
  if (!existsSync(absolute)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
    return parseHiveModel(parsed);
  } catch {
    return null;
  }
}

function parseOptions(argv: string[]): AlphaZeroOptions {
  const options: AlphaZeroOptions = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--generation-index': options.generationIndex = parsePositiveInt(next, arg); index += 1; break;
      case '--games': options.games = parsePositiveInt(next, arg); index += 1; break;
      case '--difficulty': options.difficulty = parseDifficulty(next); index += 1; break;
      case '--max-turns': options.maxTurns = parsePositiveInt(next, arg); index += 1; break;
      case '--no-capture-draw': options.noCaptureDrawMoves = parseNonNegativeInt(next, arg); index += 1; break;
      case '--simulations': options.simulations = parsePositiveInt(next, arg); index += 1; break;
      case '--fast-simulations': options.fastSimulations = parsePositiveInt(next, arg); index += 1; break;
      case '--fast-ratio': options.fastRatio = parseRatio(next, arg); index += 1; break;
      case '--epochs': options.epochs = parsePositiveInt(next, arg); index += 1; break;
      case '--batch-size': options.batchSize = parsePositiveInt(next, arg); index += 1; break;
      case '--lr': options.learningRate = parseFloatPositive(next, arg); index += 1; break;
      case '--weight-decay': options.weightDecay = parseFloatNonNegative(next, arg); index += 1; break;
      case '--hidden': if (!next) throw new Error('Missing value for --hidden'); options.hidden = next; index += 1; break;
      case '--replay-path': if (!next) throw new Error('Missing value for --replay-path'); options.replayPath = next; index += 1; break;
      case '--replay-max-samples': options.replayMaxSamples = parsePositiveInt(next, arg); index += 1; break;
      case '--reanalyse-fraction': options.reanalyseFraction = parseRatioZeroOne(next, arg); index += 1; break;
      case '--reanalyse-workers': options.reanalyseWorkers = parsePositiveInt(next, arg); index += 1; break;
      case '--dataset-out': if (!next) throw new Error('Missing value for --dataset-out'); options.datasetOut = next; index += 1; break;
      case '--keep-dataset': options.keepDataset = true; break;
      case '--candidate-out': if (!next) throw new Error('Missing value for --candidate-out'); options.candidateOutPath = next; index += 1; break;
      case '--champion-model': if (!next) throw new Error('Missing value for --champion-model'); options.championModelPath = next; index += 1; break;
      case '--promote-out': if (!next) throw new Error('Missing value for --promote-out'); options.promoteOutPath = next; index += 1; break;
      case '--arena-games': options.arenaGames = parsePositiveInt(next, arg); index += 1; break;
      case '--arena-threshold': options.arenaThreshold = parseRatio(next, arg); index += 1; break;
      case '--arena-gate-mode': options.arenaGateMode = parseArenaGateMode(next); index += 1; break;
      case '--arena-sprt-alpha': options.arenaSprtAlpha = parseFloatInRange(next, arg, 1e-6, 0.5); index += 1; break;
      case '--arena-sprt-beta': options.arenaSprtBeta = parseFloatInRange(next, arg, 1e-6, 0.5); index += 1; break;
      case '--arena-sprt-margin': options.arenaSprtMargin = parseFloatInRange(next, arg, 1e-3, 0.4); index += 1; break;
      case '--arena-confidence-level': options.arenaConfidenceLevel = parseFloatInRange(next, arg, 0.5, 0.999); index += 1; break;
      case '--metrics-log': if (!next) throw new Error('Missing value for --metrics-log'); options.metricsLogPath = next; index += 1; break;
      case '--skip-training': options.skipTraining = true; break;
      case '--skip-arena': options.skipArena = true; break;
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
  return options;
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseArenaGateMode(value: string | undefined): ArenaGateMode {
  if (value === 'fixed' || value === 'sprt') return value;
  throw new Error(`Invalid --arena-gate-mode value: ${value}`);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseFloatPositive(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseFloatNonNegative(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
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

function parseFloatInRange(value: string | undefined, flag: string, min: number, max: number): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function printUsageAndExit(): never {
  console.log('Usage: npm run hive:train:az -- [options]');
  console.log('  --generation-index <n> progressive simulation schedule index (default: 1)');
  console.log('  --games <n> --difficulty <medium|hard|extreme> --simulations <n>');
  console.log('  --fast-simulations <n> --fast-ratio <0..1>');
  console.log('  --epochs <n> --batch-size <n> --lr <float> --weight-decay <float> --hidden <csv>');
  console.log('  --replay-path <path> --replay-max-samples <n> --reanalyse-fraction <0..1> --reanalyse-workers <n>');
  console.log('  --candidate-out <path> --champion-model <path> --promote-out <path>');
  console.log('  --arena-games <n> --arena-threshold <0..1>');
  console.log('  --arena-gate-mode <fixed|sprt> --arena-sprt-alpha <v> --arena-sprt-beta <v>');
  console.log('  --arena-sprt-margin <v> --arena-confidence-level <v>');
  console.log('  --skip-training --skip-arena --verbose');
  process.exit(0);
}

function computeProgressiveSimulationSchedule(options: AlphaZeroOptions): ProgressiveSimulationSchedule {
  const g = Math.max(1, options.generationIndex);
  const scale = g < 4
    ? 0.7 + g * 0.1
    : 1 + (g - 4) * 0.03;

  return {
    fullSimulations: Math.max(8, Math.round(options.simulations * scale)),
    fastSimulations: Math.max(4, Math.round(options.fastSimulations * scale)),
  };
}

function createRng(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state <= 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function sampleUniqueIndices(length: number, count: number, rng: () => number): number[] {
  if (length <= 0 || count <= 0) return [];
  const target = Math.min(length, Math.max(0, Math.floor(count)));
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const tmp = indices[index];
    indices[index] = indices[swap];
    indices[swap] = tmp;
  }
  return indices.slice(0, target);
}

function chunkIndices(indices: number[], workerCount: number): number[][] {
  if (indices.length === 0 || workerCount <= 0) return [];
  const chunks = Array.from({ length: workerCount }, () => [] as number[]);
  for (let index = 0; index < indices.length; index += 1) {
    chunks[index % workerCount].push(indices[index]);
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

function queenPressure(state: GameState): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function queenPressureSigned(state: GameState, perspective: PlayerColor): number {
  return getQueenSurroundCount(state.board, flipColor(perspective))
    - getQueenSurroundCount(state.board, perspective);
}

function estimateMobilityState(state: GameState, perspective: PlayerColor): number {
  const myMoves = getLegalMovesForColor(state, perspective).length;
  const oppMoves = getLegalMovesForColor(state, flipColor(perspective)).length;
  return clamp((myMoves - oppMoves) / 40, -1, 1);
}

function flipColor(color: PlayerColor): PlayerColor {
  return color === 'white' ? 'black' : 'white';
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    settings: {
      ...state.settings,
      expansionPieces: { ...state.settings.expansionPieces },
    },
    board: state.board.map((piece) => ({ ...piece, position: { ...piece.position } })),
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

function createMetricsLogger(configuredPath: string): MetricsLogger {
  const runId = `az-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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
      console.warn(`[warn] Failed to write metrics log: ${message}`);
    }
  };
  return { runId, log };
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) return resolve();
      if (signal) return reject(new Error(`${command} terminated by ${signal}`));
      return reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function getPreferredPythonCommands(): string[] {
  const localVenvPython = path.resolve(
    process.cwd(),
    '.venv-hive',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const fallback = process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];
  return [localVenvPython, ...fallback];
}

function isMissingPythonCommandError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|not recognized/i.test(message);
}

async function runPythonWithFallback(args: string[]): Promise<void> {
  const pythonCommands = getPreferredPythonCommands();

  let lastMissingCommandError: Error | null = null;
  for (const command of pythonCommands) {
    try {
      await runCommand(command, args);
      return;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (!isMissingPythonCommandError(normalized)) {
        throw normalized;
      }
      lastMissingCommandError = normalized;
    }
  }

  throw lastMissingCommandError ?? new Error('Unable to locate a usable Python interpreter');
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
