import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { HiveComputerDifficulty, HiveSearchEngine, HiveSearchStats } from '../../lib/hive/ai';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  getLegalMovesForColor,
  oppositeColor,
} from '../../lib/hive/ai';
import { parseHiveModel, type HiveModel } from '../../lib/hive/ml';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import type { Move, PlayerColor } from '../../lib/hive/types';
import { getHiveHardwareProfile } from './hardware-profile';
import { GpuInferenceClient } from './gpu-inference-client';
import { runGpuMctsSearch } from './gpu-mcts';
import {
  aggregateRemoteWorkerSpecs,
  allocateRemoteWorkerSpecs,
  buildRemoteNodeTsxSshArgs,
  copyFileToRemote,
  countRemoteWorkerSlots,
  createRemoteDirectory,
  formatRemoteWorkerSummary,
  parseRemoteWorkerSpec,
  type RemoteWorkerSpec,
  removeRemoteDirectory,
  sanitizeRemotePathSegment,
} from './remote-worker';
import { publishHiveMetricsSnapshotSafely } from './sharedMetrics';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

type ArenaGateMode = 'fixed' | 'sprt';
type SearchBackend = 'cpu' | 'gpu-batched' | 'python-batched';

interface ArenaOptions {
  candidateModelPath: string;
  championModelPath: string;
  promoteOutPath: string;
  games: number;
  minGamesBeforeStop: number;
  passScore: number;
  gateMode: ArenaGateMode;
  sprtAlpha: number;
  sprtBeta: number;
  sprtMargin: number;
  confidenceLevel: number;
  ci80UpperStopBelow: number | null;
  difficulty: HiveComputerDifficulty;
  simulations: number | null;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
  seed: number;
  engine: HiveSearchEngine;
  searchBackend: SearchBackend;
  gpuGamesInFlight: number;
  gpuBatchSize: number;
  gpuBatchDelayMs: number;
  workers: number;
  remoteWorkers: RemoteWorkerSpec[];
  metricsLogPath: string;
  manualStopFile: string | null;
  verbose: boolean;
}

interface ArenaAggregate {
  candidateWins: number;
  championWins: number;
  draws: number;
  totalTurns: number;
  candidateMoves: number;
  candidateSimulations: number;
  nodesPerSecondSum: number;
  policyEntropySum: number;
}

interface MetricsLogger {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
}

interface GameResult {
  gameIndex: number;
  winner: 'white' | 'black' | 'draw' | null;
  candidateColor: PlayerColor;
  turns: number;
  candidateMoves: number;
  candidateSimulations: number;
  nodesPerSecondSum: number;
  policyEntropySum: number;
}

interface LoadedModel {
  model: HiveModel;
  absolutePath: string;
  hash: string;
}

interface ArenaWorker {
  id: string;
  label: string;
  transport: 'local' | 'remote';
  process: ChildProcess;
  inFlightGameIndex: number | null;
  inputClosed: boolean;
  exited: boolean;
  stderrTail: string;
  remoteHost: string | null;
}

interface PreparedRemoteHost {
  host: string;
  repo: string;
  workers: number;
  platform: 'posix' | 'windows';
  runDirRelativePath: string;
  runDirAbsolutePath: string;
  candidateModelPath: string;
  championModelPath: string;
}

interface GateEvaluation {
  promoted: boolean;
  score: number;
  eloEstimate: number;
  ciLow: number;
  ciHigh: number;
  confidenceLevel: number;
  decisionFinal: boolean;
  decisionReason: string;
  sprt: {
    llr: number;
    lower: number;
    upper: number;
    p0: number;
    p1: number;
    alpha: number;
    beta: number;
    inconclusive: boolean;
  } | null;
}

const EARLY_DECISION_CONFIDENCE_LEVEL = 0.9;
const EARLY_FINAL_SCORE_PROBABILITY = 0.9;

const DEFAULT_OPTIONS: ArenaOptions = {
  candidateModelPath: '.hive-cache/az-candidate-model.json',
  championModelPath: 'lib/hive/trained-model.json',
  promoteOutPath: 'lib/hive/trained-model.json',
  games: 400,
  minGamesBeforeStop: 20,
  passScore: 0.55,
  gateMode: 'fixed',
  sprtAlpha: 0.05,
  sprtBeta: 0.05,
  sprtMargin: 0.05,
  confidenceLevel: 0.80,
  ci80UpperStopBelow: null,
  difficulty: 'extreme',
  simulations: null,
  maxTurns: 320,
  noCaptureDrawMoves: 100,
  openingRandomPlies: 4,
  seed: 2026,
  engine: 'alphazero',
  searchBackend: 'cpu',
  gpuGamesInFlight: getHiveHardwareProfile().gpuArenaGamesInFlight,
  gpuBatchSize: getHiveHardwareProfile().gpuInferenceMaxBatchSize,
  gpuBatchDelayMs: getHiveHardwareProfile().gpuInferenceBatchDelayMs,
  workers: getHiveHardwareProfile().evalWorkers,
  remoteWorkers: [],
  metricsLogPath: '.hive-cache/metrics/training-metrics.jsonl',
  manualStopFile: '.hive-cache/arena-stop',
  verbose: false,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Worker mode: child process plays assigned games and writes JSON results to stdout
  if (argv.includes('--worker-mode')) {
    await runWorkerMode(argv);
    return;
  }

  const options = parseOptions(argv);
  const logger = createMetricsLogger(options.metricsLogPath);

  const candidate = loadHiveModel(options.candidateModelPath);
  const champion = loadHiveModel(options.championModelPath);
  const effectiveLocalWorkers = Math.max(1, Math.min(options.workers, options.games));
  const allocatedRemoteWorkers = allocateRemoteWorkerSpecs(
    options.remoteWorkers,
    Math.max(0, options.games - effectiveLocalWorkers),
  );
  const configuredRemoteSlots = countRemoteWorkerSlots(options.remoteWorkers);
  const effectiveRemoteSlots = countRemoteWorkerSlots(allocatedRemoteWorkers);
  if (options.searchBackend === 'python-batched' && effectiveRemoteSlots > 0) {
    throw new Error('python-batched backend does not support remote workers yet');
  }
  const effectiveWorkerCount = (options.searchBackend === 'gpu-batched' || options.searchBackend === 'python-batched') && effectiveRemoteSlots === 0
    ? Math.max(1, Math.min(options.gpuGamesInFlight, options.games))
    : effectiveLocalWorkers + effectiveRemoteSlots;

  console.log(
    `[arena:setup] games=${options.games} min_games_before_stop=${options.minGamesBeforeStop} pass_score=${(options.passScore * 100).toFixed(1)}% gate=${options.gateMode} difficulty=${options.difficulty} engine=${options.engine} search_backend=${options.searchBackend} seed=${options.seed} sims=${options.simulations ?? 'default'} workers=${effectiveWorkerCount}`,
  );
  console.log(
    `[arena:setup] local_workers=${effectiveLocalWorkers} remote_slots=${effectiveRemoteSlots}/${configuredRemoteSlots} remote_hosts=${formatRemoteWorkerSummary(allocatedRemoteWorkers)}`,
  );
  if (options.searchBackend === 'gpu-batched' || options.searchBackend === 'python-batched') {
    console.log(
      `[arena:setup] gpu_games_in_flight=${options.gpuGamesInFlight} gpu_batch_size=${options.gpuBatchSize} gpu_batch_delay_ms=${options.gpuBatchDelayMs}`,
    );
  }
  if (options.manualStopFile) {
    console.log(`[arena:setup] manual_stop_file=${path.resolve(process.cwd(), options.manualStopFile)}`);
  }
  if (options.gateMode === 'sprt') {
    console.log(
      `[arena:setup] sprt alpha=${options.sprtAlpha.toFixed(3)} beta=${options.sprtBeta.toFixed(3)} margin=${options.sprtMargin.toFixed(3)}`,
    );
  }
  console.log(`[arena:setup] candidate=${candidate.absolutePath} hash=${candidate.hash}`);
  console.log(`[arena:setup] champion=${champion.absolutePath} hash=${champion.hash}`);

  logger.log('arena_match', {
    status: 'start',
    options: {
      games: options.games,
      minGamesBeforeStop: options.minGamesBeforeStop,
      passScore: options.passScore,
      gateMode: options.gateMode,
      sprtAlpha: options.sprtAlpha,
      sprtBeta: options.sprtBeta,
      sprtMargin: options.sprtMargin,
      confidenceLevel: options.confidenceLevel,
      ci80UpperStopBelow: options.ci80UpperStopBelow,
      difficulty: options.difficulty,
      simulations: options.simulations,
      engine: options.engine,
      searchBackend: options.searchBackend,
      gpuGamesInFlight: options.gpuGamesInFlight,
      gpuBatchSize: options.gpuBatchSize,
      gpuBatchDelayMs: options.gpuBatchDelayMs,
      seed: options.seed,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      openingRandomPlies: options.openingRandomPlies,
      workers: effectiveWorkerCount,
      localWorkers: effectiveLocalWorkers,
      remoteWorkers: allocatedRemoteWorkers,
      candidateModelPath: candidate.absolutePath,
      championModelPath: champion.absolutePath,
      candidateHash: candidate.hash,
      championHash: champion.hash,
    },
    runId: logger.runId,
  });

  const startedAt = performance.now();
  let aggregate: ArenaAggregate;
  let completedGames: number;
  let gate: GateEvaluation;
  let manualStopRequested = false;

  if (options.searchBackend === 'gpu-batched' && effectiveRemoteSlots === 0) {
    ({ aggregate, completedGames, gate, manualStopRequested } = await runArenaGpuBatched(
      options,
      candidate.absolutePath,
      champion.absolutePath,
      startedAt,
    ));
  } else if (options.searchBackend === 'python-batched' && effectiveRemoteSlots === 0) {
    ({ aggregate, completedGames, gate, manualStopRequested } = await runArenaPythonBatched(
      options,
      candidate.absolutePath,
      champion.absolutePath,
      startedAt,
    ));
  } else if (effectiveWorkerCount <= 1) {
    ({ aggregate, completedGames, gate, manualStopRequested } = runArenaSequential(options, candidate.model, champion.model, startedAt));
  } else {
    ({ aggregate, completedGames, gate, manualStopRequested } = await runArenaParallel(
      options,
      effectiveLocalWorkers,
      allocatedRemoteWorkers,
      startedAt,
      logger,
      logger.runId,
      {
        candidateModelPath: candidate.absolutePath,
        championModelPath: champion.absolutePath,
      },
    ));
  }

  const elapsedMs = performance.now() - startedAt;
  gate = evaluatePromotionGate(aggregate, completedGames, options);
  if (options.gateMode === 'sprt' && !gate.decisionFinal) {
    gate = {
      ...gate,
      promoted: gate.score >= options.passScore,
      decisionFinal: true,
      decisionReason: 'sprt_inconclusive_fallback_fixed',
      sprt: gate.sprt
        ? {
            ...gate.sprt,
            inconclusive: true,
          }
        : null,
    };
  }
  if (manualStopRequested) {
    gate = {
      ...gate,
      promoted: gate.score >= options.passScore,
      decisionFinal: true,
      decisionReason: 'manual_stop_requested',
    };
  }
  const score = gate.score;
  const promote = gate.promoted;
  const eloEstimate = gate.eloEstimate;
  const avgSimulationsPerMove = aggregate.candidateMoves > 0
    ? aggregate.candidateSimulations / aggregate.candidateMoves
    : 0;
  const avgNodesPerSecond = aggregate.candidateMoves > 0
    ? aggregate.nodesPerSecondSum / aggregate.candidateMoves
    : 0;
  const avgPolicyEntropy = aggregate.candidateMoves > 0
    ? aggregate.policyEntropySum / aggregate.candidateMoves
    : 0;

  if (promote) {
    const sourcePath = path.resolve(process.cwd(), options.candidateModelPath);
    const outPath = path.resolve(process.cwd(), options.promoteOutPath);
    mkdirSync(path.dirname(outPath), { recursive: true });
    copyFileSync(sourcePath, outPath);
    console.log(`[arena:promote] candidate promoted -> ${outPath}`);
  } else {
    console.log('[arena:promote] candidate did not pass gate');
  }

  console.log(
    `[arena:done] games=${completedGames}/${options.games} score=${(score * 100).toFixed(1)}% pass_delta=${formatSignedPercentagePoints(score - options.passScore, 2)} ci${Math.round(gate.confidenceLevel * 100)}=[${(gate.ciLow * 100).toFixed(1)}%,${(gate.ciHigh * 100).toFixed(1)}%] elo=${eloEstimate.toFixed(1)} threshold=${(options.passScore * 100).toFixed(1)}% promoted=${promote ? 'yes' : 'no'} reason=${gate.decisionReason} avg_turns=${(aggregate.totalTurns / Math.max(1, completedGames)).toFixed(1)} sims_per_move=${avgSimulationsPerMove.toFixed(2)} nodes_per_sec=${avgNodesPerSecond.toFixed(1)} elapsed=${formatDuration(elapsedMs)}`,
  );

  logger.log('arena_match', {
    status: 'completed',
    games: completedGames,
    configuredGames: options.games,
    candidateWins: aggregate.candidateWins,
    championWins: aggregate.championWins,
    draws: aggregate.draws,
    candidateScore: score,
    eloEstimate,
    scoreCiLow: gate.ciLow,
    scoreCiHigh: gate.ciHigh,
    confidenceLevel: gate.confidenceLevel,
    gateMode: options.gateMode,
    gateDecisionReason: gate.decisionReason,
    sprtLlr: gate.sprt?.llr ?? null,
    sprtLower: gate.sprt?.lower ?? null,
    sprtUpper: gate.sprt?.upper ?? null,
    sprtP0: gate.sprt?.p0 ?? null,
    sprtP1: gate.sprt?.p1 ?? null,
    sprtAlpha: gate.sprt?.alpha ?? null,
    sprtBeta: gate.sprt?.beta ?? null,
    sprtInconclusive: gate.sprt?.inconclusive ?? null,
    avgTurns: aggregate.totalTurns / Math.max(1, completedGames),
    avgSimulationsPerMove,
    searchNodesPerSec: avgNodesPerSecond,
    policyEntropy: avgPolicyEntropy,
    candidateHash: candidate.hash,
    championHash: champion.hash,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
  });

  logger.log('promotion_decision', {
    promoted: promote,
    threshold: options.passScore,
    candidateScore: score,
    eloEstimate,
    scoreCiLow: gate.ciLow,
    scoreCiHigh: gate.ciHigh,
    confidenceLevel: gate.confidenceLevel,
    gateMode: options.gateMode,
    gateDecisionReason: gate.decisionReason,
    sprtLlr: gate.sprt?.llr ?? null,
    sprtLower: gate.sprt?.lower ?? null,
    sprtUpper: gate.sprt?.upper ?? null,
    sprtP0: gate.sprt?.p0 ?? null,
    sprtP1: gate.sprt?.p1 ?? null,
    sprtAlpha: gate.sprt?.alpha ?? null,
    sprtBeta: gate.sprt?.beta ?? null,
    sprtInconclusive: gate.sprt?.inconclusive ?? null,
    candidateHash: candidate.hash,
    championHash: champion.hash,
    promoteOutPath: path.resolve(process.cwd(), options.promoteOutPath),
  });
  logger.log('promotion_result', {
    promoted: promote,
    threshold: options.passScore,
    candidateScore: score,
    eloEstimate,
    scoreCiLow: gate.ciLow,
    scoreCiHigh: gate.ciHigh,
    confidenceLevel: gate.confidenceLevel,
    gateMode: options.gateMode,
    gateDecisionReason: gate.decisionReason,
    sprtLlr: gate.sprt?.llr ?? null,
    sprtLower: gate.sprt?.lower ?? null,
    sprtUpper: gate.sprt?.upper ?? null,
    sprtP0: gate.sprt?.p0 ?? null,
    sprtP1: gate.sprt?.p1 ?? null,
    sprtAlpha: gate.sprt?.alpha ?? null,
    sprtBeta: gate.sprt?.beta ?? null,
    sprtInconclusive: gate.sprt?.inconclusive ?? null,
    candidateHash: candidate.hash,
    championHash: champion.hash,
  });

  await publishHiveMetricsSnapshotSafely(options.metricsLogPath);
}

function runArenaSequential(
  options: ArenaOptions,
  candidateModel: HiveModel,
  championModel: HiveModel,
  startedAt: number,
): { aggregate: ArenaAggregate; completedGames: number; gate: GateEvaluation; manualStopRequested: boolean } {
  const aggregate: ArenaAggregate = {
    candidateWins: 0, championWins: 0, draws: 0, totalTurns: 0,
    candidateMoves: 0, candidateSimulations: 0, nodesPerSecondSum: 0, policyEntropySum: 0,
  };
  let completedGames = 0;
  let gate = evaluatePromotionGate(aggregate, 1, options);
  let manualStopRequested = false;

  for (let gameIndex = 1; gameIndex <= options.games; gameIndex += 1) {
    if (isManualStopRequested(options)) {
      manualStopRequested = true;
      console.log(`[${formatClock()}] [arena] manual stop requested before game ${gameIndex}; finishing arena early`);
      break;
    }
    const summary = runArenaGame(gameIndex, options, candidateModel, championModel);
    applyGameResult(aggregate, summary);
    completedGames = gameIndex;
    gate = evaluatePromotionGate(aggregate, completedGames, options);
    if (options.verbose || gameIndex % 20 === 0 || gameIndex === options.games) {
      const elapsed = performance.now() - startedAt;
      const eta = estimateRemainingMs(elapsed, gameIndex, options.games);
      const thresholdMargin = formatThresholdMarginSummary(gate, gameIndex, options);
      const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
      console.log(
        `[${formatClock()}] [arena] ${gameIndex}/${options.games} ${formatProgressBar(gameIndex, options.games)} score=${(gate.score * 100).toFixed(1)}% pass_delta=${passDelta} ci${Math.round(gate.confidenceLevel * 100)}=[${(gate.ciLow * 100).toFixed(1)}%,${(gate.ciHigh * 100).toFixed(1)}%] ${thresholdMargin} W/L/D=${aggregate.candidateWins}/${aggregate.championWins}/${aggregate.draws} elapsed=${formatDuration(elapsed)} eta=${formatDuration(eta)}`,
      );
    }
    if (isManualStopRequested(options)) {
      manualStopRequested = true;
      const thresholdMargin = formatThresholdMarginSummary(gate, gameIndex, options);
      const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
      console.log(
        `[${formatClock()}] [arena] manual stop at ${gameIndex}/${options.games}: pass_delta=${passDelta} ${thresholdMargin}`,
      );
      break;
    }
    if (gate.decisionFinal && gameIndex < options.games) {
      const thresholdMargin = formatThresholdMarginSummary(gate, gameIndex, options);
      const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
      console.log(
        `[${formatClock()}] [arena] early stop at ${gameIndex}/${options.games}: ${gate.decisionReason} pass_delta=${passDelta} ${thresholdMargin} llr=${gate.sprt?.llr?.toFixed(3) ?? 'n/a'}`,
      );
      break;
    }
  }
  return { aggregate, completedGames, gate, manualStopRequested };
}

async function runArenaGpuBatched(
  options: ArenaOptions,
  candidateModelPath: string,
  championModelPath: string,
  startedAt: number,
): Promise<{ aggregate: ArenaAggregate; completedGames: number; gate: GateEvaluation; manualStopRequested: boolean }> {
  const aggregate: ArenaAggregate = {
    candidateWins: 0,
    championWins: 0,
    draws: 0,
    totalTurns: 0,
    candidateMoves: 0,
    candidateSimulations: 0,
    nodesPerSecondSum: 0,
    policyEntropySum: 0,
  };

  let completedGames = 0;
  let gate = evaluatePromotionGate(aggregate, 1, options);
  let manualStopRequested = false;
  let stopLaunching = false;
  let fatalError: Error | null = null;
  let nextGameIndex = 1;
  let stopLogged = false;

  const gpuClient = await GpuInferenceClient.start(candidateModelPath, {
    modelKey: 'candidate',
    batchDelayMs: options.gpuBatchDelayMs,
    maxBatchSize: options.gpuBatchSize,
  });
  await gpuClient.loadModel('champion', championModelPath);

  const inFlight = new Set<Promise<void>>();

  const maybeLogGateStop = (): void => {
    if (stopLogged || !gate.decisionFinal || completedGames >= options.games) return;
    stopLogged = true;
    const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
    const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
    console.log(
      `[${formatClock()}] [arena] stopping new launches at ${completedGames}/${options.games}: ${gate.decisionReason} pass_delta=${passDelta} ${thresholdMargin} llr=${gate.sprt?.llr?.toFixed(3) ?? 'n/a'}`,
    );
  };

  const maybeLogProgress = (): void => {
    if (!(options.verbose || completedGames <= 10 || completedGames % 10 === 0 || completedGames === options.games)) {
      return;
    }
    const elapsed = performance.now() - startedAt;
    const eta = estimateRemainingMs(elapsed, completedGames, options.games);
    const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
    const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
    console.log(
      `[${formatClock()}] [arena] ${completedGames}/${options.games} ${formatProgressBar(completedGames, options.games)} score=${(gate.score * 100).toFixed(1)}% pass_delta=${passDelta} ci${Math.round(gate.confidenceLevel * 100)}=[${(gate.ciLow * 100).toFixed(1)}%,${(gate.ciHigh * 100).toFixed(1)}%] ${thresholdMargin} W/L/D=${aggregate.candidateWins}/${aggregate.championWins}/${aggregate.draws} elapsed=${formatDuration(elapsed)} eta=${formatDuration(eta)} in_flight=${inFlight.size}`,
    );
  };

  const launchGame = (gameIndex: number): void => {
    const task = runArenaGameGpu(gameIndex, options, gpuClient)
      .then((summary) => {
        applyGameResult(aggregate, summary);
        completedGames += 1;
        gate = evaluatePromotionGate(aggregate, completedGames, options);
        maybeLogProgress();

        if (isManualStopRequested(options)) {
          manualStopRequested = true;
          stopLaunching = true;
          const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
          const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
          console.log(
            `[${formatClock()}] [arena] manual stop at ${completedGames}/${options.games}: pass_delta=${passDelta} ${thresholdMargin}`,
          );
          return;
        }

        if (gate.decisionFinal) {
          stopLaunching = true;
          maybeLogGateStop();
        }
      })
      .catch((error: unknown) => {
        fatalError = error instanceof Error ? error : new Error(String(error));
        stopLaunching = true;
      })
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  };

  try {
    while (true) {
      if (fatalError) {
        throw fatalError;
      }
      if (!manualStopRequested && isManualStopRequested(options)) {
        manualStopRequested = true;
        stopLaunching = true;
        console.log(`[${formatClock()}] [arena] manual stop requested before launching remaining games`);
      }

      while (
        !stopLaunching
        && nextGameIndex <= options.games
        && inFlight.size < Math.max(1, Math.min(options.gpuGamesInFlight, options.games))
      ) {
        launchGame(nextGameIndex);
        nextGameIndex += 1;
      }

      if (inFlight.size === 0) {
        break;
      }
      await Promise.race([...inFlight]);
    }
  } finally {
    await gpuClient.shutdown();
  }

  return { aggregate, completedGames, gate, manualStopRequested };
}

async function runArenaPythonBatched(
  options: ArenaOptions,
  candidateModelPath: string,
  championModelPath: string,
  startedAt: number,
): Promise<{ aggregate: ArenaAggregate; completedGames: number; gate: GateEvaluation; manualStopRequested: boolean }> {
  const aggregate: ArenaAggregate = {
    candidateWins: 0,
    championWins: 0,
    draws: 0,
    totalTurns: 0,
    candidateMoves: 0,
    candidateSimulations: 0,
    nodesPerSecondSum: 0,
    policyEntropySum: 0,
  };
  let completedGames = 0;
  let gate = evaluatePromotionGate(aggregate, 1, options);
  let manualStopRequested = false;
  let fatalError: Error | null = null;
  let stopLogged = false;
  let intentionallyStopped = false;
  let stderrTail = '';

  const scriptPath = path.join(SCRIPTS_DIR, 'python-batched-arena.py');
  const worker = await spawnPythonWithFallback([
    scriptPath,
    '--candidate-model', path.resolve(process.cwd(), candidateModelPath),
    '--champion-model', path.resolve(process.cwd(), championModelPath),
    '--games', String(options.games),
    '--games-in-flight', String(Math.max(1, Math.min(options.gpuGamesInFlight, options.games))),
    '--max-turns', String(options.maxTurns),
    '--no-capture-draw', String(options.noCaptureDrawMoves),
    '--opening-random-plies', String(options.openingRandomPlies),
    '--seed', String(options.seed),
    '--gpu-batch-size', String(options.gpuBatchSize),
    '--gpu-batch-delay-ms', String(options.gpuBatchDelayMs),
    '--device', 'auto',
    ...(options.simulations ? ['--simulations', String(options.simulations)] : []),
  ]);

  const stopWorker = (): void => {
    if (intentionallyStopped) return;
    intentionallyStopped = true;
    try {
      worker.stdin?.destroy();
    } catch {
      // ignore
    }
    try {
      worker.kill();
    } catch {
      // ignore
    }
  };

  const maybeLogGateStop = (): void => {
    if (stopLogged || !gate.decisionFinal || completedGames >= options.games) return;
    stopLogged = true;
    const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
    const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
    console.log(
      `[${formatClock()}] [arena] stopping python-batched worker at ${completedGames}/${options.games}: ${gate.decisionReason} pass_delta=${passDelta} ${thresholdMargin} llr=${gate.sprt?.llr?.toFixed(3) ?? 'n/a'}`,
    );
  };

  const maybeLogProgress = (): void => {
    if (!(options.verbose || completedGames <= 10 || completedGames % 10 === 0 || completedGames === options.games)) {
      return;
    }
    const elapsed = performance.now() - startedAt;
    const eta = estimateRemainingMs(elapsed, completedGames, options.games);
    const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
    const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
    console.log(
      `[${formatClock()}] [arena] ${completedGames}/${options.games} ${formatProgressBar(completedGames, options.games)} score=${(gate.score * 100).toFixed(1)}% pass_delta=${passDelta} ci${Math.round(gate.confidenceLevel * 100)}=[${(gate.ciLow * 100).toFixed(1)}%,${(gate.ciHigh * 100).toFixed(1)}%] ${thresholdMargin} W/L/D=${aggregate.candidateWins}/${aggregate.championWins}/${aggregate.draws} elapsed=${formatDuration(elapsed)} eta=${formatDuration(eta)} in_flight=${Math.max(0, Math.min(options.gpuGamesInFlight, options.games - completedGames))}`,
    );
  };

  const reader = worker.stdout
    ? createInterface({ input: worker.stdout })
    : null;

  worker.stderr?.setEncoding('utf8');
  worker.stderr?.on('data', (chunk: string | Buffer) => {
    stderrTail = appendCapturedOutput(stderrTail, String(chunk), 16 * 1024);
  });

  const workerDone = new Promise<void>((resolve) => {
    reader?.on('line', (line) => {
      let result: GameResult;
      try {
        result = JSON.parse(line) as GameResult;
      } catch {
        if (options.verbose) {
          console.error(`[${formatClock()}] [arena] python-batched non-json stdout: ${line}`);
        }
        return;
      }
      applyGameResult(aggregate, result);
      completedGames += 1;
      gate = evaluatePromotionGate(aggregate, completedGames, options);
      maybeLogProgress();

      if (isManualStopRequested(options)) {
        manualStopRequested = true;
        const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
        const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
        console.log(
          `[${formatClock()}] [arena] manual stop at ${completedGames}/${options.games}: pass_delta=${passDelta} ${thresholdMargin}`,
        );
        stopWorker();
        return;
      }

      if (gate.decisionFinal) {
        maybeLogGateStop();
        stopWorker();
      }
    });

    worker.on('error', (error) => {
      fatalError = error instanceof Error ? error : new Error(String(error));
      resolve();
    });

    worker.on('close', (code, signal) => {
      if (!intentionallyStopped && completedGames < options.games && !gate.decisionFinal && !manualStopRequested) {
        fatalError = new Error(
          `python-batched worker exited early: code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${stderrTail}`,
        );
      }
      resolve();
    });
  });

  while (!fatalError) {
    if (!manualStopRequested && isManualStopRequested(options)) {
      manualStopRequested = true;
      stopWorker();
    }
    const raceResult = await Promise.race([
      workerDone.then(() => 'done' as const),
      sleep(250).then(() => 'tick' as const),
    ]);
    if (raceResult === 'done') break;
    if (gate.decisionFinal && !intentionallyStopped) {
      maybeLogGateStop();
      stopWorker();
    }
  }

  if (fatalError) {
    stopWorker();
    throw fatalError;
  }

  return { aggregate, completedGames, gate, manualStopRequested };
}

async function runArenaParallel(
  options: ArenaOptions,
  localWorkerCount: number,
  remoteWorkerSpecs: RemoteWorkerSpec[],
  startedAt: number,
  logger: MetricsLogger,
  runId: string,
  modelPaths: {
    candidateModelPath: string;
    championModelPath: string;
  },
): Promise<{ aggregate: ArenaAggregate; completedGames: number; gate: GateEvaluation; manualStopRequested: boolean }> {
  const aggregate: ArenaAggregate = {
    candidateWins: 0, championWins: 0, draws: 0, totalTurns: 0,
    candidateMoves: 0, candidateSimulations: 0, nodesPerSecondSum: 0, policyEntropySum: 0,
  };
  let completedGames = 0;
  let gate = evaluatePromotionGate(aggregate, 1, options);
  let stopped = false;
  let nextGameIndex = 1;
  let hardStopped = false;
  let manualStopRequested = false;
  const pendingGameIndices: number[] = [];
  const completedGameIndices = new Set<number>();
  const workers: ArenaWorker[] = [];
  const workerDone: Promise<void>[] = [];
  let nextWorkerId = 1;
  const localWorkerArgs = buildWorkerArgs(options);
  const preparedRemoteHosts = await prepareRemoteHosts();
  const startedRemoteSlots = countPreparedRemoteWorkerSlots(preparedRemoteHosts);

  const hardStopWorkers = (): void => {
    if (hardStopped) return;
    hardStopped = true;
    for (const worker of workers) {
      try { worker.process.stdin?.destroy(); } catch { /* ignore */ }
      try { worker.process.kill(); } catch { /* ignore */ }
    }
  };

  for (let index = 0; index < localWorkerCount; index += 1) {
    trackWorker(spawnLocalArenaWorker(nextWorkerId, localWorkerArgs));
    nextWorkerId += 1;
  }

  for (const preparedHost of preparedRemoteHosts) {
    const remoteWorkerArgs = buildWorkerArgs(options, {
      candidateModelPath: preparedHost.candidateModelPath,
      championModelPath: preparedHost.championModelPath,
    });
    for (let index = 0; index < preparedHost.workers; index += 1) {
      trackWorker(spawnRemoteArenaWorker(nextWorkerId, preparedHost, remoteWorkerArgs, index + 1));
      nextWorkerId += 1;
    }
  }

  console.log(
    `[arena:setup] active_local_workers=${localWorkerCount} active_remote_slots=${startedRemoteSlots} active_workers=${workers.length}`,
  );
  logger.log('arena_workers', {
    status: 'started',
    localWorkers: localWorkerCount,
    activeRemoteSlots: startedRemoteSlots,
    remoteHosts: preparedRemoteHosts.map((entry) => ({
      host: entry.host,
      repo: entry.repo,
      workers: entry.workers,
    })),
  });

  if (workers.length === 0) {
    throw new Error('Arena failed to start any local or remote workers');
  }

  dispatchPendingGames();
  await Promise.all(workerDone);
  await cleanupPreparedRemoteHosts(preparedRemoteHosts);

  if (!stopped && completedGames < options.games) {
    throw new Error(`Arena workers exited with ${options.games - completedGames} games still pending`);
  }
  return { aggregate, completedGames, gate, manualStopRequested };

  function trackWorker(worker: ArenaWorker): void {
    workers.push(worker);
    workerDone.push(createWorkerDonePromise(worker));
  }

  function createWorkerDonePromise(worker: ArenaWorker): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const resolveOnce = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };

      if (worker.process.stdout) {
        worker.process.stdout.setEncoding('utf8');
        const reader = createInterface({ input: worker.process.stdout });
        reader.on('line', (line) => {
          handleWorkerOutput(worker, line);
        });
      }

      worker.process.stderr?.setEncoding('utf8');
      worker.process.stderr?.on('data', (chunk: string | Buffer) => {
        worker.stderrTail = appendCapturedOutput(worker.stderrTail, String(chunk), 16 * 1024);
      });

      worker.process.on('error', (error) => {
        handleWorkerExit(worker, `error=${formatErrorMessage(error)}`);
        resolveOnce();
      });
      worker.process.on('close', (code, signal) => {
        handleWorkerExit(worker, `code=${code ?? 'null'} signal=${signal ?? 'null'}`);
        resolveOnce();
      });
    });
  }

  function handleWorkerOutput(worker: ArenaWorker, line: string): void {
    if (hardStopped) return;
    let result: GameResult;
    try {
      result = JSON.parse(line) as GameResult;
    } catch {
      if (options.verbose) {
        console.error(`[${formatClock()}] [arena] ${worker.label} non-json stdout: ${line}`);
      }
      return;
    }

    const assignedGameIndex = worker.inFlightGameIndex;
    worker.inFlightGameIndex = null;
    if (assignedGameIndex !== null && assignedGameIndex !== result.gameIndex && !completedGameIndices.has(assignedGameIndex)) {
      pendingGameIndices.unshift(assignedGameIndex);
    }

    if (completedGameIndices.has(result.gameIndex)) {
      dispatchPendingGames();
      return;
    }

    completedGameIndices.add(result.gameIndex);
    applyGameResult(aggregate, result);
    completedGames += 1;
    gate = evaluatePromotionGate(aggregate, completedGames, options);

    if (options.verbose || completedGames <= 10 || completedGames % 10 === 0) {
      const elapsed = performance.now() - startedAt;
      const eta = estimateRemainingMs(elapsed, completedGames, options.games);
      const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
      const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
      console.log(
        `[${formatClock()}] [arena] ${completedGames}/${options.games} ${formatProgressBar(completedGames, options.games)} score=${(gate.score * 100).toFixed(1)}% pass_delta=${passDelta} ci${Math.round(gate.confidenceLevel * 100)}=[${(gate.ciLow * 100).toFixed(1)}%,${(gate.ciHigh * 100).toFixed(1)}%] ${thresholdMargin} W/L/D=${aggregate.candidateWins}/${aggregate.championWins}/${aggregate.draws} elapsed=${formatDuration(elapsed)} eta=${formatDuration(eta)}`,
      );
    }

    if (completedGames >= options.games) {
      stopped = true;
      hardStopWorkers();
      return;
    }

    if (isManualStopRequested(options)) {
      if (!stopped) {
        stopped = true;
        manualStopRequested = true;
        const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
        const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
        console.log(
          `[${formatClock()}] [arena] manual stop at ${completedGames}/${options.games}: pass_delta=${passDelta} ${thresholdMargin}`,
        );
        hardStopWorkers();
      }
      return;
    }

    if (gate.decisionFinal && completedGames < options.games) {
      if (!stopped) {
        stopped = true;
        const thresholdMargin = formatThresholdMarginSummary(gate, completedGames, options);
        const passDelta = formatSignedPercentagePoints(gate.score - options.passScore, 2);
        console.log(
          `[${formatClock()}] [arena] early stop at ${completedGames}/${options.games}: ${gate.decisionReason} pass_delta=${passDelta} ${thresholdMargin} llr=${gate.sprt?.llr?.toFixed(3) ?? 'n/a'}`,
        );
        hardStopWorkers();
      }
      return;
    }

    dispatchPendingGames();
  }

  function handleWorkerExit(worker: ArenaWorker, reason: string): void {
    if (worker.exited) return;
    worker.exited = true;

    const unfinishedGame = worker.inFlightGameIndex;
    worker.inFlightGameIndex = null;
    if (!hardStopped && unfinishedGame !== null && !completedGameIndices.has(unfinishedGame)) {
      pendingGameIndices.unshift(unfinishedGame);
      console.error(
        `[${formatClock()}] [arena] ${worker.label} exited while running game ${unfinishedGame}; requeued (${reason})`,
      );
    } else if (!hardStopped && options.verbose) {
      console.error(`[${formatClock()}] [arena] ${worker.label} exited (${reason})`);
    }

    logger.log('arena_worker', {
      status: 'exited',
      workerId: worker.id,
      transport: worker.transport,
      remoteHost: worker.remoteHost,
      reason,
      unfinishedGame,
      stderrTail: worker.stderrTail || null,
    });

    if (!hardStopped && !stopped) {
      dispatchPendingGames();
    }
  }

  function dispatchPendingGames(): void {
    if (hardStopped || stopped) return;
    for (const worker of workers) {
      if (worker.exited || worker.inFlightGameIndex !== null || worker.inputClosed) continue;
      const nextIndex = getNextPendingGameIndex();
      if (nextIndex === null) {
        if (completedGameIndices.size >= options.games) {
          closeWorkerInput(worker);
        }
        continue;
      }
      try {
        worker.process.stdin?.write(`${nextIndex}\n`);
        worker.inFlightGameIndex = nextIndex;
      } catch (error) {
        pendingGameIndices.unshift(nextIndex);
        closeWorkerInput(worker);
        console.error(
          `[${formatClock()}] [arena] failed to assign game ${nextIndex} to ${worker.label}: ${formatErrorMessage(error)}`,
        );
      }
    }
  }

  function getNextPendingGameIndex(): number | null {
    if (pendingGameIndices.length > 0) {
      return pendingGameIndices.shift() ?? null;
    }
    if (nextGameIndex > options.games) return null;
    const gameIndex = nextGameIndex;
    nextGameIndex += 1;
    return gameIndex;
  }

  function closeWorkerInput(worker: ArenaWorker): void {
    if (worker.inputClosed) return;
    worker.inputClosed = true;
    try {
      worker.process.stdin?.end();
    } catch {
      // Ignore worker shutdown failures and let close handlers reconcile state.
    }
  }

  async function prepareRemoteHosts(): Promise<PreparedRemoteHost[]> {
    const prepared: PreparedRemoteHost[] = [];
    for (const spec of remoteWorkerSpecs) {
      const runDirRelativePath = spec.platform === 'windows'
        ? path.win32.join('.hive-cache', 'remote-arena', sanitizeRemotePathSegment(runId))
        : path.posix.join('.hive-cache', 'remote-arena', sanitizeRemotePathSegment(runId));
      const runDirAbsolutePath = spec.platform === 'windows'
        ? path.win32.join(spec.repo, runDirRelativePath)
        : path.posix.join(spec.repo, runDirRelativePath);
      const candidateModelPath = spec.platform === 'windows'
        ? path.win32.join(runDirAbsolutePath, 'candidate-model.json')
        : path.posix.join(runDirRelativePath, 'candidate-model.json');
      const championModelPath = spec.platform === 'windows'
        ? path.win32.join(runDirAbsolutePath, 'champion-model.json')
        : path.posix.join(runDirRelativePath, 'champion-model.json');
      const preparedHost: PreparedRemoteHost = {
        host: spec.host,
        repo: spec.repo,
        workers: spec.workers,
        platform: spec.platform,
        runDirRelativePath,
        runDirAbsolutePath,
        candidateModelPath,
        championModelPath,
      };

      try {
        await createRemoteDirectory(preparedHost, preparedHost.runDirAbsolutePath);
        await copyFileToRemote(preparedHost, modelPaths.candidateModelPath, preparedHost.candidateModelPath);
        await copyFileToRemote(preparedHost, modelPaths.championModelPath, preparedHost.championModelPath);
        prepared.push(preparedHost);
        logger.log('arena_remote_host', {
          status: 'ready',
          host: spec.host,
          repo: spec.repo,
          workers: spec.workers,
          platform: spec.platform,
          runDir: runDirRelativePath,
        });
      } catch (error) {
        const message = formatErrorMessage(error);
        console.error(`[${formatClock()}] [arena] remote host ${spec.host} bootstrap failed: ${message}`);
        logger.log('arena_remote_host', {
          status: 'bootstrap_failed',
          host: spec.host,
          repo: spec.repo,
          workers: spec.workers,
          platform: spec.platform,
          error: message,
        });
        await cleanupRemoteHost(preparedHost, false);
      }
    }
    return prepared;
  }

  async function cleanupPreparedRemoteHosts(preparedHosts: PreparedRemoteHost[]): Promise<void> {
    for (const preparedHost of preparedHosts) {
      await cleanupRemoteHost(preparedHost, true);
    }
  }

  async function cleanupRemoteHost(preparedHost: PreparedRemoteHost, warnOnFailure: boolean): Promise<void> {
    try {
      await removeRemoteDirectory(preparedHost, preparedHost.runDirAbsolutePath);
      logger.log('arena_remote_host', {
        status: 'cleaned',
        host: preparedHost.host,
        repo: preparedHost.repo,
        platform: preparedHost.platform,
        runDir: preparedHost.runDirRelativePath,
      });
    } catch (error) {
      if (warnOnFailure) {
        console.error(
          `[${formatClock()}] [arena] remote cleanup failed for ${preparedHost.host}: ${formatErrorMessage(error)}`,
        );
      }
      logger.log('arena_remote_host', {
        status: 'cleanup_failed',
        host: preparedHost.host,
        repo: preparedHost.repo,
        platform: preparedHost.platform,
        runDir: preparedHost.runDirRelativePath,
        error: formatErrorMessage(error),
      });
    }
  }
}

function buildWorkerArgs(
  options: ArenaOptions,
  overrides?: {
    candidateModelPath?: string;
    championModelPath?: string;
  },
): string[] {
  const args: string[] = [
    '--candidate-model', overrides?.candidateModelPath ?? options.candidateModelPath,
    '--champion-model', overrides?.championModelPath ?? options.championModelPath,
    '--difficulty', options.difficulty,
    '--engine', options.engine,
    '--search-backend', 'cpu',
    '--max-turns', String(options.maxTurns),
    '--no-capture-draw', String(options.noCaptureDrawMoves),
    '--opening-random-plies', String(options.openingRandomPlies),
    '--seed', String(options.seed),
  ];
  if (options.simulations !== null) {
    args.push('--simulations', String(options.simulations));
  }
  return args;
}

function spawnLocalArenaWorker(workerId: number, workerArgs: string[]): ArenaWorker {
  const child = spawn(process.execPath, [
    '--import', 'tsx',
    path.resolve(process.cwd(), 'scripts/hive/eval-arena.ts'),
    '--worker-mode',
    ...workerArgs,
  ], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], shell: false });

  return {
    id: `local-${workerId}`,
    label: `local-${workerId}`,
    transport: 'local',
    process: child,
    inFlightGameIndex: null,
    inputClosed: false,
    exited: false,
    stderrTail: '',
    remoteHost: null,
  };
}

function spawnRemoteArenaWorker(
  workerId: number,
  preparedHost: PreparedRemoteHost,
  workerArgs: string[],
  remoteIndex: number,
): ArenaWorker {
  const child = spawn('ssh', buildRemoteArenaWorkerSshArgs(preparedHost, workerArgs), {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  return {
    id: `remote-${workerId}`,
    label: `remote-${preparedHost.host}-${remoteIndex}`,
    transport: 'remote',
    process: child,
    inFlightGameIndex: null,
    inputClosed: false,
    exited: false,
    stderrTail: '',
    remoteHost: preparedHost.host,
  };
}

function buildRemoteArenaWorkerSshArgs(preparedHost: PreparedRemoteHost, workerArgs: string[]): string[] {
  return buildRemoteNodeTsxSshArgs(preparedHost, 'scripts/hive/eval-arena.ts', [
    '--worker-mode',
    ...workerArgs,
  ]);
}

function countPreparedRemoteWorkerSlots(preparedHosts: PreparedRemoteHost[]): number {
  return preparedHosts.reduce((sum, entry) => sum + entry.workers, 0);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendCapturedOutput(current: string, chunk: string, limit: number): string {
  if (chunk.length >= limit) {
    return chunk.slice(-limit);
  }
  const overflow = current.length + chunk.length - limit;
  if (overflow <= 0) {
    return current + chunk;
  }
  return current.slice(overflow) + chunk;
}

async function runWorkerMode(argv: string[]): Promise<void> {
  // Parse options (--worker-mode is ignored by parseOptions since we filter it)
  const filtered = argv.filter((arg) => arg !== '--worker-mode');
  const options = parseOptions(filtered);
  const candidate = loadHiveModel(options.candidateModelPath);
  const champion = loadHiveModel(options.championModelPath);

  // Read game indices from stdin, play each game, write JSON result to stdout
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const gameIndex = Number.parseInt(line.trim(), 10);
    if (!Number.isFinite(gameIndex) || gameIndex <= 0) continue;
    const result = runArenaGame(gameIndex, options, candidate.model, champion.model);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

function applyGameResult(aggregate: ArenaAggregate, result: GameResult): void {
  aggregate.totalTurns += result.turns;
  aggregate.candidateMoves += result.candidateMoves;
  aggregate.candidateSimulations += result.candidateSimulations;
  aggregate.nodesPerSecondSum += result.nodesPerSecondSum;
  aggregate.policyEntropySum += result.policyEntropySum;
  if (result.winner === null) aggregate.draws += 1;
  else if (result.winner === result.candidateColor) aggregate.candidateWins += 1;
  else aggregate.championWins += 1;
}

async function runArenaGameGpu(
  gameIndex: number,
  options: ArenaOptions,
  gpuClient: GpuInferenceClient,
): Promise<GameResult> {
  const rng = createRng(options.seed + gameIndex * 131);
  const candidateColor: PlayerColor = gameIndex % 2 === 1 ? 'white' : 'black';
  let state = createLocalHiveGameState({
    id: `arena-gpu-${Date.now()}-${gameIndex}`,
    shortCode: 'AGPU',
    whitePlayerId: candidateColor === 'white' ? 'candidate' : 'champion',
    blackPlayerId: candidateColor === 'black' ? 'candidate' : 'champion',
  });

  let noProgress = 0;
  let prevPressure = queenPressureTotal(state);
  let openingPly = 0;
  let gameCandidateMoves = 0;
  let gameCandidateSimulations = 0;
  let gameNodesPerSecondSum = 0;
  let gamePolicyEntropySum = 0;

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const activeColor = state.currentTurn;
    const isCandidateTurn = activeColor === candidateColor;
    let move: Move | null = null;

    if (openingPly < options.openingRandomPlies) {
      const legal = getLegalMovesForColor(state, activeColor);
      if (legal.length > 0) {
        move = legal[Math.floor(rng() * legal.length)];
      }
      openingPly += 1;
    } else {
      const search = await runGpuMctsSearch({
        state,
        color: activeColor,
        gpuClient,
        seed: options.seed + gameIndex * 163 + state.turnNumber,
        leafBatchSize: options.gpuBatchSize,
        modelKey: isCandidateTurn ? 'candidate' : 'champion',
        mctsConfig: options.simulations ? { simulations: options.simulations, maxDepth: options.maxTurns } : { maxDepth: options.maxTurns },
      });
      move = search.selectedMove;
      if (isCandidateTurn) {
        gameCandidateMoves += 1;
        gameCandidateSimulations += search.stats.simulations;
        gameNodesPerSecondSum += search.stats.nodesPerSecond;
        gamePolicyEntropySum += search.stats.policyEntropy;
      }
    }

    if (!move) {
      state = {
        ...state,
        status: 'finished',
        winner: oppositeColor(activeColor),
      };
      break;
    }

    state = applyHiveMove(state, move);
    const pressure = queenPressureTotal(state);
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
      break;
    }
  }

  if (state.status === 'playing') {
    state = {
      ...state,
      status: 'finished',
      winner: 'draw',
    };
  }

  return {
    gameIndex,
    winner: state.winner === 'draw' ? null : state.winner,
    candidateColor,
    turns: state.turnNumber,
    candidateMoves: gameCandidateMoves,
    candidateSimulations: gameCandidateSimulations,
    nodesPerSecondSum: gameNodesPerSecondSum,
    policyEntropySum: gamePolicyEntropySum,
  };
}

function runArenaGame(
  gameIndex: number,
  options: ArenaOptions,
  candidateModel: HiveModel,
  championModel: HiveModel,
): GameResult {
  const rng = createRng(options.seed + gameIndex * 131);
  const candidateColor: PlayerColor = gameIndex % 2 === 1 ? 'white' : 'black';
  let state = createLocalHiveGameState({
    id: `arena-${Date.now()}-${gameIndex}`,
    shortCode: 'ARNA',
    whitePlayerId: candidateColor === 'white' ? 'candidate' : 'champion',
    blackPlayerId: candidateColor === 'black' ? 'candidate' : 'champion',
  });

  let noProgress = 0;
  let prevPressure = queenPressureTotal(state);
  let openingPly = 0;
  let gameCandidateMoves = 0;
  let gameCandidateSimulations = 0;
  let gameNodesPerSecondSum = 0;
  let gamePolicyEntropySum = 0;

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const activeColor = state.currentTurn;
    const isCandidateTurn = activeColor === candidateColor;

    let move: Move | null = null;
    if (openingPly < options.openingRandomPlies) {
      const legal = getLegalMovesForColor(state, activeColor);
      if (legal.length > 0) {
        move = legal[Math.floor(rng() * legal.length)];
      }
      openingPly += 1;
    } else {
      let stats: HiveSearchStats | null = null;
      move = chooseHiveMoveForColor(
        state,
        activeColor,
        options.difficulty,
        {
          modelOverride: isCandidateTurn ? candidateModel : championModel,
          engine: options.engine,
          mctsConfig: options.simulations ? { simulations: options.simulations } : undefined,
          randomSeed: options.seed + gameIndex * 163 + state.turnNumber,
          onSearchStats: isCandidateTurn ? (value) => {
            stats = value;
          } : undefined,
        },
      );
      const statsSnapshot = stats as HiveSearchStats | null;
      if (isCandidateTurn && statsSnapshot) {
        gameCandidateMoves += 1;
        gameCandidateSimulations += statsSnapshot.simulations;
        gameNodesPerSecondSum += statsSnapshot.nodesPerSecond;
        gamePolicyEntropySum += statsSnapshot.policyEntropy;
      }
    }

    if (!move) {
      state = {
        ...state,
        status: 'finished',
        winner: oppositeColor(activeColor),
      };
      break;
    }

    state = applyHiveMove(state, move);
    const pressure = queenPressureTotal(state);
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
      break;
    }
  }

  if (state.status === 'playing') {
    state = {
      ...state,
      status: 'finished',
      winner: 'draw',
    };
  }

  return {
    gameIndex,
    winner: state.winner === 'draw' ? null : state.winner,
    candidateColor,
    turns: state.turnNumber,
    candidateMoves: gameCandidateMoves,
    candidateSimulations: gameCandidateSimulations,
    nodesPerSecondSum: gameNodesPerSecondSum,
    policyEntropySum: gamePolicyEntropySum,
  };
}

function loadHiveModel(relativePath: string): LoadedModel {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Model path not found: ${relativePath}`);
  }
  const raw = readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const model = parseHiveModel(parsed);
  if (!model) {
    throw new Error(`Invalid model file: ${relativePath}`);
  }
  return {
    model,
    absolutePath,
    hash: hashText(raw),
  };
}

function hashText(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
}

function queenPressureTotal(state: ReturnType<typeof createLocalHiveGameState>): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function parseOptions(argv: string[]): ArenaOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelpAndExit();
  }

  const options: ArenaOptions = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--candidate-model':
        if (!next) throw new Error('Missing value for --candidate-model');
        options.candidateModelPath = next;
        index += 1;
        break;
      case '--champion-model':
        if (!next) throw new Error('Missing value for --champion-model');
        options.championModelPath = next;
        index += 1;
        break;
      case '--promote-out':
        if (!next) throw new Error('Missing value for --promote-out');
        options.promoteOutPath = next;
        index += 1;
        break;
      case '--games':
        options.games = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--min-games-before-stop':
        options.minGamesBeforeStop = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--pass-score':
        options.passScore = parseScore(next, arg);
        index += 1;
        break;
      case '--gate-mode':
        options.gateMode = parseGateMode(next);
        index += 1;
        break;
      case '--sprt-alpha':
        options.sprtAlpha = parseFloatInRange(next, arg, 1e-6, 0.5);
        index += 1;
        break;
      case '--sprt-beta':
        options.sprtBeta = parseFloatInRange(next, arg, 1e-6, 0.5);
        index += 1;
        break;
      case '--sprt-margin':
        options.sprtMargin = parseFloatInRange(next, arg, 1e-3, 0.4);
        index += 1;
        break;
      case '--confidence-level':
        options.confidenceLevel = parseFloatInRange(next, arg, 0.5, 0.999);
        index += 1;
        break;
      case '--ci80-upper-stop-below':
        options.ci80UpperStopBelow = parseFloatInRange(next, arg, 0.01, 0.99);
        index += 1;
        break;
      case '--no-ci80-upper-stop':
        options.ci80UpperStopBelow = null;
        break;
      case '--difficulty':
        options.difficulty = parseDifficulty(next);
        index += 1;
        break;
      case '--simulations':
        options.simulations = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--engine':
        options.engine = parseEngine(next);
        index += 1;
        break;
      case '--search-backend':
        options.searchBackend = parseSearchBackend(next);
        index += 1;
        break;
      case '--gpu-games-in-flight':
        options.gpuGamesInFlight = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gpu-batch-size':
        options.gpuBatchSize = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gpu-batch-delay-ms':
        options.gpuBatchDelayMs = parsePositiveInt(next, arg);
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
      case '--opening-random-plies':
        options.openingRandomPlies = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--seed':
        options.seed = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--metrics-log':
        if (!next) throw new Error('Missing value for --metrics-log');
        options.metricsLogPath = next;
        index += 1;
        break;
      case '--manual-stop-file':
        if (!next) throw new Error('Missing value for --manual-stop-file');
        options.manualStopFile = next;
        index += 1;
        break;
      case '--no-manual-stop-file':
        options.manualStopFile = null;
        break;
      case '--workers':
        options.workers = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--remote-worker':
        if (!next) throw new Error('Missing value for --remote-worker');
        options.remoteWorkers = [...options.remoteWorkers, parseRemoteWorkerSpec(next)];
        index += 1;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.remoteWorkers = aggregateRemoteWorkerSpecs(options.remoteWorkers);
  return options;
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (!value) throw new Error('Missing value for --difficulty');
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseEngine(value: string | undefined): HiveSearchEngine {
  if (!value) throw new Error('Missing value for --engine');
  if (value === 'classic' || value === 'alphazero' || value === 'gumbel') return value;
  throw new Error(`Invalid --engine value: ${value}`);
}

function parseSearchBackend(value: string | undefined): SearchBackend {
  if (!value) throw new Error('Missing value for --search-backend');
  if (value === 'cpu' || value === 'gpu-batched' || value === 'python-batched') return value;
  throw new Error(`Invalid --search-backend value: ${value}`);
}

function parseGateMode(value: string | undefined): ArenaGateMode {
  if (!value) throw new Error('Missing value for --gate-mode');
  if (value === 'fixed' || value === 'sprt') return value;
  throw new Error(`Invalid --gate-mode value: ${value}`);
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

function parseScore(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseFloatInRange(value: string | undefined, flag: string, min: number, max: number): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function evaluatePromotionGate(
  aggregate: ArenaAggregate,
  completedGames: number,
  options: ArenaOptions,
): GateEvaluation {
  const games = Math.max(1, completedGames);
  const minGamesBeforeStop = Math.max(1, Math.min(options.minGamesBeforeStop, options.games));
  const allowEarlyDecision = games >= minGamesBeforeStop;
  const effectiveWins = aggregate.candidateWins + aggregate.draws * 0.5;
  const score = effectiveWins / games;
  const eloEstimate = scoreToElo(score);
  const ci = computeWilsonInterval(score, games, options.confidenceLevel);
  const ci80UpperStopBelow = options.ci80UpperStopBelow;
  const ci80 = computeWilsonInterval(score, games, 0.8);
  const ci90 = computeWilsonInterval(score, games, EARLY_DECISION_CONFIDENCE_LEVEL);
  const scoreBounds = computeFinalScoreBounds(effectiveWins, games, options.games);
  const optimisticFinalPassProbability = computeFinalPassProbability(
    effectiveWins,
    games,
    options.games,
    Math.max(score, ci80.high),
    options.passScore,
  );
  const conservativeFinalPassProbability = computeFinalPassProbability(
    effectiveWins,
    games,
    options.games,
    Math.min(score, ci80.low),
    options.passScore,
  );

  // Early reject: ci80 upper band below explicit stop threshold (legacy)
  if (allowEarlyDecision && ci80 && ci80UpperStopBelow !== null && games < options.games && ci80.high < ci80UpperStopBelow) {
    return {
      promoted: false,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'ci80_upper_below_stop_threshold',
      sprt: null,
    };
  }

  // Early reject: main CI upper band below pass score — candidate cannot
  // plausibly be strong enough even at the optimistic end of the interval.
  if (allowEarlyDecision && games < options.games && ci.high < options.passScore) {
    return {
      promoted: false,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'ci_upper_below_pass_score',
      sprt: null,
    };
  }

  if (allowEarlyDecision && games < options.games && ci90.low > options.passScore) {
    return {
      promoted: true,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'ci90_lower_above_pass_score',
      sprt: null,
    };
  }

  if (allowEarlyDecision && games < options.games && ci90.high < options.passScore) {
    return {
      promoted: false,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'ci90_upper_below_pass_score',
      sprt: null,
    };
  }

  if (allowEarlyDecision && games < options.games && conservativeFinalPassProbability >= EARLY_FINAL_SCORE_PROBABILITY) {
    return {
      promoted: true,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'final_score_pass_probability_ge_90',
      sprt: null,
    };
  }

  if (allowEarlyDecision && games < options.games && optimisticFinalPassProbability <= 1 - EARLY_FINAL_SCORE_PROBABILITY) {
    return {
      promoted: false,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'final_score_pass_probability_le_10',
      sprt: null,
    };
  }

  if (options.gateMode === 'fixed') {
    if (allowEarlyDecision && scoreBounds.minFinalScore >= options.passScore) {
      return {
        promoted: true,
        score,
        eloEstimate,
        ciLow: ci.low,
        ciHigh: ci.high,
        confidenceLevel: options.confidenceLevel,
        decisionFinal: true,
        decisionReason: 'fixed_threshold_guaranteed_pass',
        sprt: null,
      };
    }

    if (allowEarlyDecision && scoreBounds.maxFinalScore < options.passScore) {
      return {
        promoted: false,
        score,
        eloEstimate,
        ciLow: ci.low,
        ciHigh: ci.high,
        confidenceLevel: options.confidenceLevel,
        decisionFinal: true,
        decisionReason: 'fixed_threshold_cannot_pass',
        sprt: null,
      };
    }

    if (games < options.games) {
      return {
        promoted: score >= options.passScore,
        score,
        eloEstimate,
        ciLow: ci.low,
        ciHigh: ci.high,
        confidenceLevel: options.confidenceLevel,
        decisionFinal: false,
        decisionReason: 'fixed_threshold_pending',
        sprt: null,
      };
    }

    return {
      promoted: score >= options.passScore,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: score >= options.passScore ? 'fixed_threshold_pass' : 'fixed_threshold_fail',
      sprt: null,
    };
  }

  if (allowEarlyDecision && scoreBounds.minFinalScore >= options.passScore) {
    return {
      promoted: true,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'score_bound_guaranteed_pass',
      sprt: null,
    };
  }

  if (allowEarlyDecision && scoreBounds.maxFinalScore < options.passScore) {
    return {
      promoted: false,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'score_bound_cannot_pass',
      sprt: null,
    };
  }

  const p0 = clampProbability(options.passScore);
  const p1 = clampProbability(Math.min(0.99, options.passScore + options.sprtMargin));
  const llr = computeSprtLlr(effectiveWins, games, p0, p1);
  const upper = Math.log((1 - options.sprtBeta) / options.sprtAlpha);
  const lower = Math.log(options.sprtBeta / (1 - options.sprtAlpha));

  if (allowEarlyDecision && llr >= upper) {
    return {
      promoted: true,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'sprt_accept_h1',
      sprt: {
        llr,
        lower,
        upper,
        p0,
        p1,
        alpha: options.sprtAlpha,
        beta: options.sprtBeta,
        inconclusive: false,
      },
    };
  }

  if (allowEarlyDecision && llr <= lower) {
    return {
      promoted: false,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'sprt_reject_h1',
      sprt: {
        llr,
        lower,
        upper,
        p0,
        p1,
        alpha: options.sprtAlpha,
        beta: options.sprtBeta,
        inconclusive: false,
      },
    };
  }

  return {
    promoted: score >= options.passScore,
    score,
    eloEstimate,
    ciLow: ci.low,
    ciHigh: ci.high,
    confidenceLevel: options.confidenceLevel,
    decisionFinal: false,
    decisionReason: 'sprt_inconclusive',
    sprt: {
      llr,
      lower,
      upper,
      p0,
      p1,
      alpha: options.sprtAlpha,
      beta: options.sprtBeta,
      inconclusive: true,
    },
  };
}

function formatThresholdMarginSummary(
  gate: GateEvaluation,
  completedGames: number,
  options: ArenaOptions,
): string {
  const margins = computeThresholdMargins(gate, completedGames, options);
  return `thr_upper=${formatSignedFixed(margins.upper, 2)} thr_lower=${formatSignedFixed(margins.lower, 2)}`;
}

function computeThresholdMargins(
  gate: GateEvaluation,
  completedGames: number,
  options: ArenaOptions,
): { upper: number; lower: number } {
  const safeCompletedGames = Math.max(0, Math.min(completedGames, options.games));
  const remainingGames = Math.max(0, options.games - safeCompletedGames);
  const thresholdTarget = options.passScore * options.games;
  return {
    upper: gate.ciHigh * remainingGames + gate.score * safeCompletedGames - thresholdTarget,
    lower: gate.ciLow * remainingGames + gate.score * safeCompletedGames - thresholdTarget,
  };
}

function formatSignedFixed(value: number, digits: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatSignedPercentagePoints(value: number, digits: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}pp`;
}

function isManualStopRequested(options: ArenaOptions): boolean {
  if (!options.manualStopFile) return false;
  return existsSync(path.resolve(process.cwd(), options.manualStopFile));
}

function computeSprtLlr(effectiveWins: number, games: number, p0: number, p1: number): number {
  const losses = Math.max(0, games - effectiveWins);
  return effectiveWins * Math.log(p1 / p0) + losses * Math.log((1 - p1) / (1 - p0));
}

function clampProbability(value: number): number {
  return Math.min(0.999, Math.max(0.001, value));
}

function computeFinalScoreBounds(
  effectiveWins: number,
  completedGames: number,
  configuredGames: number,
): {
  minFinalScore: number;
  maxFinalScore: number;
} {
  const totalGames = Math.max(1, configuredGames);
  const remainingGames = Math.max(0, totalGames - Math.max(0, completedGames));
  return {
    minFinalScore: effectiveWins / totalGames,
    maxFinalScore: (effectiveWins + remainingGames) / totalGames,
  };
}

function computeFinalPassProbability(
  effectiveWins: number,
  completedGames: number,
  configuredGames: number,
  assumedScore: number,
  passScore: number,
): number {
  const totalGames = Math.max(1, configuredGames);
  const remainingGames = Math.max(0, totalGames - Math.max(0, completedGames));
  const requiredScore = passScore * totalGames;
  if (effectiveWins >= requiredScore) {
    return 1;
  }
  if (remainingGames <= 0) {
    return 0;
  }

  const requiredAdditionalWins = Math.ceil(requiredScore - effectiveWins - 1e-12);
  if (requiredAdditionalWins <= 0) {
    return 1;
  }
  if (requiredAdditionalWins > remainingGames) {
    return 0;
  }

  return computeBinomialTailProbability(
    remainingGames,
    requiredAdditionalWins,
    clampProbability(assumedScore),
  );
}

function computeBinomialTailProbability(
  trials: number,
  requiredSuccesses: number,
  successProbability: number,
): number {
  if (requiredSuccesses <= 0) return 1;
  if (requiredSuccesses > trials) return 0;
  if (successProbability <= 0) return 0;
  if (successProbability >= 1) return 1;

  const p = clampProbability(successProbability);
  const q = 1 - p;
  let logProbabilityMass = computeLogBinomialPmf(trials, requiredSuccesses, p);
  let maxLogProbability = logProbabilityMass;
  const logTailTerms = [logProbabilityMass];

  for (let successes = requiredSuccesses + 1; successes <= trials; successes += 1) {
    logProbabilityMass += Math.log(trials - successes + 1) - Math.log(successes) + Math.log(p) - Math.log(q);
    logTailTerms.push(logProbabilityMass);
    if (logProbabilityMass > maxLogProbability) {
      maxLogProbability = logProbabilityMass;
    }
  }

  let normalizedTailSum = 0;
  for (const logTerm of logTailTerms) {
    normalizedTailSum += Math.exp(logTerm - maxLogProbability);
  }

  return Math.min(1, Math.max(0, Math.exp(maxLogProbability) * normalizedTailSum));
}

function computeLogBinomialPmf(
  trials: number,
  successes: number,
  successProbability: number,
): number {
  const failures = trials - successes;
  let logCoefficient = 0;
  const coefficientTerms = Math.min(successes, failures);
  for (let index = 1; index <= coefficientTerms; index += 1) {
    logCoefficient += Math.log(trials - coefficientTerms + index) - Math.log(index);
  }
  return logCoefficient + successes * Math.log(successProbability) + failures * Math.log(1 - successProbability);
}

function normalCriticalValue(confidenceLevel: number): number {
  if (confidenceLevel >= 0.99) return 2.576;
  if (confidenceLevel >= 0.98) return 2.326;
  if (confidenceLevel >= 0.95) return 1.96;
  if (confidenceLevel >= 0.9) return 1.645;
  if (confidenceLevel >= 0.8) return 1.282;
  return 1;
}

function computeWilsonInterval(
  score: number,
  games: number,
  confidenceLevel: number,
): { low: number; high: number } {
  const n = Math.max(1, games);
  const p = clampProbability(score);
  const z = normalCriticalValue(confidenceLevel);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const spread = (z / denom) * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return {
    low: Math.max(0, center - spread),
    high: Math.min(1, center + spread),
  };
}

function printHelpAndExit(): never {
  console.log('Usage: npm run hive:eval:arena -- [options]');
  console.log('  --candidate-model <path>    Candidate model path (default: .hive-cache/az-candidate-model.json)');
  console.log('  --champion-model <path>     Champion model path (default: lib/hive/trained-model.json)');
  console.log('  --promote-out <path>        Promotion output path (default: lib/hive/trained-model.json)');
  console.log('  --games <n>                 Arena games (default: 400)');
  console.log('  --pass-score <float>        Promotion threshold in (0,1) (default: 0.55)');
  console.log('  --gate-mode <fixed|sprt>    Promotion gate mode (default: fixed)');
  console.log('  --sprt-alpha <float>        SPRT alpha error rate (default: 0.05)');
  console.log('  --sprt-beta <float>         SPRT beta error rate (default: 0.05)');
  console.log('  --sprt-margin <float>       SPRT p1 margin over threshold (default: 0.05)');
  console.log('  --confidence-level <float>  Score CI confidence in [0.5, 0.999] (default: 0.80)');
  console.log('  --ci80-upper-stop-below <float>  Early reject when ci80 upper band falls below this score (default: off)');
  console.log('  --no-ci80-upper-stop        Disable the ci80 upper-band early reject rule');
  console.log('  --difficulty <d>            medium|hard|extreme (default: extreme)');
  console.log('  --simulations <n>           Override MCTS simulations for both sides');
  console.log('  --engine <e>                classic|alphazero|gumbel (default: alphazero)');
  console.log('  --search-backend <mode>     cpu|gpu-batched|python-batched (default: cpu)');
  console.log('  --gpu-games-in-flight <n>   Concurrent local GPU arena games (default: auto)');
  console.log('  --gpu-batch-size <n>        Shared GPU inference max batch size (default: auto)');
  console.log('  --gpu-batch-delay-ms <n>    Shared GPU inference batch delay (default: auto)');
  console.log('  --max-turns <n>             Max turns per game (default: 320)');
  console.log('  --no-capture-draw <n>       Draw threshold for no queen-pressure progress (default: 100)');
  console.log('  --opening-random-plies <n>  Random opening plies for diversity (default: 4)');
  console.log('  --seed <n>                  Deterministic seed (default: 2026)');
  console.log('  --workers <n>               Parallel game workers (default: auto based on CPU count)');
  console.log('  --remote-worker <spec>      Add SSH worker host=...,repo=...,workers=... (repeatable)');
  console.log('                              POSIX repo paths use sh; Windows repo paths use PowerShell');
  console.log('  --metrics-log <path>        Metrics JSONL output');
  console.log('  --manual-stop-file <path>   Stop early if this file exists (default: .hive-cache/arena-stop)');
  console.log('  --no-manual-stop-file       Disable manual file-triggered early stop');
  console.log('  --verbose, -v               Verbose logging');
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

async function spawnPythonWithFallback(args: string[]): Promise<ChildProcess> {
  const localVenvPython = path.resolve(
    process.cwd(),
    '.venv-hive',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const candidates = process.platform === 'win32'
    ? [localVenvPython, 'python', 'python3', 'py']
    : [localVenvPython, 'python3', 'python'];

  for (const cmd of candidates) {
    try {
      const proc = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      await Promise.race([
        new Promise<void>((resolve) => {
          proc.on('spawn', resolve);
        }),
        new Promise<void>((_, reject) => {
          proc.on('error', reject);
        }),
        sleep(2000).then(() => {
          throw new Error(`Timeout starting ${cmd}`);
        }),
      ]);

      return proc;
    } catch {
      continue;
    }
  }

  throw new Error('Could not start Python 3 worker');
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

function formatProgressBar(done: number, total: number, width = 12): string {
  const safeTotal = Math.max(1, total);
  const ratio = Math.min(1, Math.max(0, done / safeTotal));
  const filled = Math.round(ratio * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}]${Math.round(ratio * 100)}%`;
}

function formatClock(): string {
  return new Date().toISOString().slice(11, 19);
}

function estimateRemainingMs(elapsedMs: number, done: number, total: number): number {
  if (done <= 0 || total <= done) return 0;
  return ((total - done) * elapsedMs) / done;
}

function createMetricsLogger(configuredPath: string): MetricsLogger {
  const runId = `arena-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const absolutePath = path.resolve(process.cwd(), configuredPath);
  let warned = false;

  const log = (eventType: string, payload: Record<string, unknown>): void => {
    try {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      appendFileSync(
        absolutePath,
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
  const stack = error instanceof Error ? error.stack : null;
  if (stack && stack.trim().length > 0) {
    console.error(stack);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[error] ${message}`);
  }
  process.exit(1);
});
