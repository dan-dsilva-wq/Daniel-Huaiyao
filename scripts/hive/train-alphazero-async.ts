import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import type { HiveComputerDifficulty } from '../../lib/hive/ai';
import {
  HIVE_ACTION_FEATURE_NAMES,
  HIVE_DEFAULT_TOKEN_SLOTS,
  buildHiveTokenStateFeatureNames,
} from '../../lib/hive/ml';
import type { GameState } from '../../lib/hive/types';
import { getHiveHardwareProfile } from './hardware-profile';
import {
  aggregateRemoteWorkerSpecs,
  countRemoteWorkerSlots,
  formatRemoteWorkerSummary,
  makeRemoteWorkerSpecKey,
  parseRemoteWorkerSpec,
  type RemoteWorkerSpec,
} from './remote-worker';
import { publishHiveMetricsSnapshotSafely } from './sharedMetrics';

type ArenaGateMode = 'fixed' | 'sprt';
type AdaptiveBudgetPhase = 'bootstrap' | 'growth' | 'development' | 'refinement' | 'validation' | 'fixed';
type SelfPlaySampleOrigin = 'learner' | 'champion';
type LearnerRecoveryAction = 'none' | 'restore_best' | 'rebase_champion';
type SearchBackend = 'cpu' | 'gpu-batched';

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
  championSelfplayRatio: number;
  replayAnchorRatio: number;
  replayPath: string;
  replayMaxSamples: number;
  reanalyseFraction: number;
  reanalyseWorkers: number;
  trainIntervalSeconds: number;
  minReplaySamples: number;
  minNewSamples: number;
  minArenaReplaySamples: number;
  trainerPreset: string;
  tuningMode: boolean;
  epochs: number;
  batchSize: number;
  learningRate: number;
  weightDecay: number;
  policyTargetTemperature: number;
  labelSmoothing: number;
  hidden: string;
  learnerModelPath: string;
  candidateOutPath: string;
  bestLearnerModelPath: string;
  bestLearnerMetaPath: string;
  championModelPath: string;
  promoteOutPath: string;
  arenaSimulations: number | null;
  arenaGames: number;
  arenaThreshold: number;
  arenaGateMode: ArenaGateMode;
  arenaSprtAlpha: number;
  arenaSprtBeta: number;
  arenaSprtMargin: number;
  arenaConfidenceLevel: number;
  arenaWorkers: number;
  arenaRemoteWorkers: RemoteWorkerSpec[];
  selfplayRemoteWorkers: RemoteWorkerSpec[];
  arenaStage2Enabled: boolean;
  arenaStage2TriggerMargin: number;
  arenaStage2SimulationScale: number;
  arenaStage2GameScale: number;
  arenaIntervalStepsOverride: number | null;
  rebaseOnFailedArena: boolean;
  rebaseFailThreshold: number;
  rebaseFailureStreak: number;
  bestCheckpointScoreFloor: number;
  bestCheckpointRegressionTolerance: number;
  skipTraining: boolean;
  skipArena: boolean;
  deployOnPromotion: boolean;
  deployAfterArena: boolean;
  deployCommand: string;
  notifyArenaResults: boolean;
  continueOnError: boolean;
  adaptiveBudget: boolean;
  persistentTrainer: boolean;
  searchBackend: SearchBackend;
  gpuGamesInFlight: number;
  gpuWorkers: boolean;
  gpuBatchSize: number;
  gpuBatchDelayMs: number;
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

interface ReplayPayload {
  version: number;
  createdAt: string;
  updatedAt: string;
  stateFeatureNames: string[];
  actionFeatureNames: string[];
  samples: ReplaySample[];
}

interface ReplayShardManifestEntry {
  fileName: string;
  sampleCount: number;
}

interface ShardedReplayManifest {
  version: number;
  storage: 'sharded';
  createdAt: string;
  updatedAt: string;
  stateFeatureNames: string[];
  actionFeatureNames: string[];
  totalSamples: number;
  shards: ReplayShardManifestEntry[];
}

interface SelfPlayChunkOutput extends ReplayPayload {
  summary?: {
    games: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
    totalMoves: number;
    totalSimulations: number;
    sampleOrigin?: SelfPlaySampleOrigin;
  };
}

interface ReanalyseWorkerPayload {
  samples: Array<{
    index: number;
    stateSnapshot: GameState;
  }>;
  modelPath: string;
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

interface ReanalyseLogContext {
  step: number;
  trainerMode: TrainingStepResult['trainerMode'];
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
  transport: 'local' | 'remote';
  process: ChildProcess;
  outPath: string;
  remoteSlotId: string | null;
  remoteSpecKey: string | null;
  stderrTail: string;
  stoppingReason: string | null;
}

interface RemoteSelfPlaySlot {
  slotId: string;
  label: string;
  spec: RemoteWorkerSpec;
  specKey: string;
}

interface TrainingStepResult {
  trainerMode: 'persistent' | 'oneshot';
  shouldRunArena: boolean;
}

interface TrainerPreset {
  id: string;
  epochs: number;
  learningRate: number;
  minNewSamples: number;
  championSelfplayRatio: number;
  replayAnchorRatio: number;
  reanalyseFraction: number;
}

interface PersistentTrainerResponse {
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

interface PendingTrainerRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
}

class PersistentTrainerSyncError extends Error {
  constructor(
    message: string,
    readonly reanalysedSamples: number,
  ) {
    super(message);
    this.name = 'PersistentTrainerSyncError';
  }
}

interface PersistentTrainerRecoveryState {
  consecutiveStartFailures: number;
  nextRetryAt: number;
  lastFailureReason: string | null;
}

interface RebaseState {
  championHash: string | null;
  severeFailureStreak: number;
}

interface SelfPlayMixState {
  learnerStartedChunks: number;
  championStartedChunks: number;
  learnerMergedChunks: number;
  championMergedChunks: number;
  learnerMergedSamples: number;
  championMergedSamples: number;
}

interface ChampionStatus {
  hash: string | null;
  positionSamples: number;
  games: number;
  generatedAt: string | null;
}

interface ArenaHistorySnapshot {
  totalPromotions: number;
  championDefenses: number;
  recentScores: number[];
  recentBestScore: number | null;
  recentMeanScore: number | null;
}

interface TrainerPresetStat {
  presetId: string;
  runs: number;
  promotions: number;
  severeFailures: number;
  scoreSum: number;
  lowerBoundSum: number;
}

interface ArenaOutcome {
  promoted: boolean;
  score: number | null;
  decisionReason: string | null;
  completedGames: number | null;
  configuredGames: number | null;
  scoreCiLow: number | null;
  scoreCiHigh: number | null;
  stage: number;
  simulations: number | null;
  threshold: number | null;
}

interface ArenaSequenceOutcome {
  stage1: ArenaOutcome;
  stage2: ArenaOutcome | null;
  final: ArenaOutcome;
  stage2Triggered: boolean;
}

interface BestLearnerCheckpoint {
  championHash: string;
  arenaScore: number;
  savedAt: string;
  step: number;
  arenaDecisionReason: string | null;
}

interface ProcessLockRecord {
  pid: number;
  startedAt: string;
  command: string;
}

interface BudgetProfile {
  phase: Exclude<AdaptiveBudgetPhase, 'fixed'>;
  selfplayScale: number;
  fastScale: number;
  fastRatio: number;
  championSelfplayRatio: number;
  replayAnchorRatio: number;
  arenaScale: number;
  arenaGameScale: number;
  arenaIntervalSteps: number;
  presetIds: string[];
}

interface ResolvedBudget {
  phase: AdaptiveBudgetPhase;
  adaptiveScore: number | null;
  presetId: string;
  selfplaySimulations: number;
  fastSimulations: number;
  fastRatio: number;
  championSelfplayRatio: number;
  replayAnchorRatio: number;
  trainerEpochs: number;
  trainerLearningRate: number;
  trainerMinNewSamples: number;
  trainerBatchSize: number;
  trainerReanalyseFraction: number;
  arenaSimulations: number;
  arenaGames: number;
  arenaIntervalSteps: number;
  selfplaySimulationCap: number;
  fastSimulationCap: number;
  arenaSimulationCap: number;
  arenaGameCap: number;
  championHash: string | null;
  championPositionSamples: number;
  championGames: number;
  totalPromotions: number;
  championDefenses: number;
  recentBestScore: number | null;
  recentMeanScore: number | null;
  reasons: string[];
}

const HARDWARE_PROFILE = getHiveHardwareProfile();
const REANALYSE_WORKER_TIMEOUT_MIN_MS = 5 * 60 * 1000;
const REANALYSE_WORKER_TIMEOUT_PER_SAMPLE_MS = 2500;
const REANALYSE_WORKER_TIMEOUT_MAX_MS = 20 * 60 * 1000;
const REANALYSE_MAX_SAMPLES_PER_WORKER = 1200;
const PERSISTENT_TRAINER_INIT_TIMEOUT_MS = 3 * 60 * 1000;
const PERSISTENT_TRAINER_REPLAY_REPLACE_TIMEOUT_MIN_MS = 2 * 60 * 1000;
const PERSISTENT_TRAINER_REPLAY_REPLACE_TIMEOUT_MAX_MS = 12 * 60 * 1000;
const PERSISTENT_TRAINER_RESTART_BASE_DELAY_MS = 60 * 1000;
const PERSISTENT_TRAINER_RESTART_MAX_DELAY_MS = 15 * 60 * 1000;
const MAX_REPLAY_JSON_BYTES = 500 * 1024 * 1024;
const REPLAY_SHARD_SAMPLE_COUNT = 5_000;
const REPLAY_SHARD_DIR_SUFFIX = '.chunks';
const REPLAY_STREAM_READ_BYTES = 1024 * 1024;

const DEFAULT_OPTIONS: AsyncOptions = {
  durationMinutes: 0,
  selfplayWorkers: HARDWARE_PROFILE.selfPlayWorkers,
  chunkGames: HARDWARE_PROFILE.logicalCpuCount >= 16 ? 8 : HARDWARE_PROFILE.logicalCpuCount >= 8 ? 4 : 2,
  difficulty: 'extreme',
  maxTurns: 320,
  noCaptureDrawMoves: 100,
  simulations: 220,
  fastSimulations: 72,
  fastRatio: 0.55,
  championSelfplayRatio: 0.32,
  replayAnchorRatio: 0.24,
  replayPath: '.hive-cache/az-replay-buffer.json',
  replayMaxSamples: 220000,
  reanalyseFraction: 0.1,
  reanalyseWorkers: Math.max(
    1,
    Math.min(8, HARDWARE_PROFILE.logicalCpuCount - HARDWARE_PROFILE.selfPlayWorkers),
  ),
  trainIntervalSeconds: 180,
  minReplaySamples: 8192,
  minNewSamples: 1024,
  minArenaReplaySamples: 20000,
  trainerPreset: 'auto',
  tuningMode: false,
  epochs: 8,
  batchSize: Math.max(1024, HARDWARE_PROFILE.deepBatchSize),
  learningRate: 0.0015,
  weightDecay: 0.0001,
  policyTargetTemperature: 0.12,
  labelSmoothing: 0.02,
  hidden: '256,128',
  learnerModelPath: '.hive-cache/az-learner-model.json',
  candidateOutPath: '.hive-cache/az-candidate-model.json',
  bestLearnerModelPath: '.hive-cache/az-best-learner-model.json',
  bestLearnerMetaPath: '.hive-cache/az-best-learner-model.meta.json',
  championModelPath: 'lib/hive/trained-model.json',
  promoteOutPath: 'lib/hive/trained-model.json',
  arenaSimulations: null,
  arenaGames: 400,
  arenaThreshold: 0.55,
  arenaGateMode: 'sprt',
  arenaSprtAlpha: 0.05,
  arenaSprtBeta: 0.05,
  arenaSprtMargin: 0.05,
  arenaConfidenceLevel: 0.80,
  arenaWorkers: HARDWARE_PROFILE.evalWorkers,
  arenaRemoteWorkers: [],
  selfplayRemoteWorkers: [],
  arenaStage2Enabled: false,
  arenaStage2TriggerMargin: 0.05,
  arenaStage2SimulationScale: 1.2,
  arenaStage2GameScale: 1.5,
  arenaIntervalStepsOverride: null,
  rebaseOnFailedArena: true,
  rebaseFailThreshold: 0.25,
  rebaseFailureStreak: 2,
  bestCheckpointScoreFloor: 0.4,
  bestCheckpointRegressionTolerance: 0.12,
  skipTraining: false,
  skipArena: false,
  deployOnPromotion: false,
  deployAfterArena: false,
  deployCommand: 'vercel --prod --yes',
  notifyArenaResults: true,
  continueOnError: true,
  adaptiveBudget: true,
  persistentTrainer: true,
  searchBackend: 'gpu-batched',
  gpuGamesInFlight: HARDWARE_PROFILE.gpuSelfPlayGamesInFlight,
  gpuWorkers: true,
  gpuBatchSize: HARDWARE_PROFILE.gpuInferenceMaxBatchSize,
  gpuBatchDelayMs: HARDWARE_PROFILE.gpuInferenceBatchDelayMs,
  metricsLogPath: '.hive-cache/metrics/training-metrics.jsonl',
  chunkDir: '.hive-cache/async/chunks',
  tmpDir: '.hive-cache/async/tmp',
  verbose: false,
};

const DEFAULT_ARENA_SIMULATIONS_BY_DIFFICULTY: Record<HiveComputerDifficulty, number> = {
  medium: 64,
  hard: 140,
  extreme: 260,
};
const ARENA_SEARCH_BACKEND: SearchBackend = 'cpu';

const ADAPTIVE_BUDGET_PROFILES: BudgetProfile[] = [
  {
    phase: 'bootstrap',
    selfplayScale: 0.55,
    fastScale: 0.55,
    fastRatio: 0.6,
    championSelfplayRatio: 0.32,
    replayAnchorRatio: 0.24,
    arenaScale: 0.52,
    arenaGameScale: 0.2,
    arenaIntervalSteps: 6,
    presetIds: ['exploratory', 'balanced'],
  },
  {
    phase: 'growth',
    selfplayScale: 0.68,
    fastScale: 0.68,
    fastRatio: 0.5,
    championSelfplayRatio: 0.28,
    replayAnchorRatio: 0.2,
    arenaScale: 0.64,
    arenaGameScale: 0.35,
    arenaIntervalSteps: 5,
    presetIds: ['balanced', 'exploratory'],
  },
  {
    phase: 'development',
    selfplayScale: 0.8,
    fastScale: 0.8,
    fastRatio: 0.35,
    championSelfplayRatio: 0.24,
    replayAnchorRatio: 0.16,
    arenaScale: 0.78,
    arenaGameScale: 0.5,
    arenaIntervalSteps: 5,
    presetIds: ['balanced', 'conservative'],
  },
  {
    phase: 'refinement',
    selfplayScale: 0.9,
    fastScale: 0.9,
    fastRatio: 0.2,
    championSelfplayRatio: 0.2,
    replayAnchorRatio: 0.14,
    arenaScale: 0.9,
    arenaGameScale: 0.7,
    arenaIntervalSteps: 3,
    presetIds: ['conservative', 'late-validation'],
  },
  {
    phase: 'validation',
    selfplayScale: 1,
    fastScale: 1,
    fastRatio: 0,
    championSelfplayRatio: 0.16,
    replayAnchorRatio: 0.12,
    arenaScale: 1,
    arenaGameScale: 1,
    arenaIntervalSteps: 1,
    presetIds: ['late-validation', 'conservative'],
  },
];

const TRAINER_PRESET_CATALOG: Record<string, TrainerPreset> = {
  exploratory: {
    id: 'exploratory',
    epochs: 6,
    learningRate: 0.00135,
    minNewSamples: 896,
    championSelfplayRatio: 0.16,
    replayAnchorRatio: 0.1,
    reanalyseFraction: 0.08,
  },
  balanced: {
    id: 'balanced',
    epochs: 5,
    learningRate: 0.0011,
    minNewSamples: 1280,
    championSelfplayRatio: 0.22,
    replayAnchorRatio: 0.14,
    reanalyseFraction: 0.1,
  },
  conservative: {
    id: 'conservative',
    epochs: 4,
    learningRate: 0.0009,
    minNewSamples: 1792,
    championSelfplayRatio: 0.28,
    replayAnchorRatio: 0.2,
    reanalyseFraction: 0.12,
  },
  'late-validation': {
    id: 'late-validation',
    epochs: 3,
    learningRate: 0.0007,
    minNewSamples: 2560,
    championSelfplayRatio: 0.34,
    replayAnchorRatio: 0.24,
    reanalyseFraction: 0.15,
  },
};

class PersistentTrainerClient {
  private nextRequestId = 1;

  private readonly pending = new Map<string, PendingTrainerRequest>();

  private closed = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly logger: MetricsLogger,
  ) {
    const stdout = this.child.stdout;
    if (stdout) {
      stdout.setEncoding('utf8');
      const reader = createInterface({ input: stdout });
      reader.on('line', (line) => this.handleProtocolLine(line));
      reader.on('close', () => this.rejectAllPending(new Error('Persistent trainer stdout closed')));
    }

    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', (chunk: string) => {
      process.stdout.write(chunk);
    });

    this.child.on('error', (error) => {
      this.rejectAllPending(error instanceof Error ? error : new Error(String(error)));
    });
    this.child.on('close', (code, signal) => {
      if (this.closed) return;
      const reason = new Error(`Persistent trainer exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.rejectAllPending(reason);
    });
  }

  static async start(
    options: AsyncOptions,
    budget: ResolvedBudget,
    replayPath: string,
    logger: MetricsLogger,
  ): Promise<PersistentTrainerClient> {
    const scriptPath = path.resolve(process.cwd(), 'scripts/hive/train-alphazero-stream.py');
    const child = await spawnPythonProcessWithFallback([scriptPath]);
    const client = new PersistentTrainerClient(child, logger);
    const learnerModelPath = resolveLearnerModelPath(options);
    const response = await client.request('init', {
      replayPath,
      metricsLogPath: path.resolve(process.cwd(), options.metricsLogPath),
      learningRate: budget.trainerLearningRate,
      weightDecay: options.weightDecay,
      policyTargetTemperature: options.policyTargetTemperature,
      hidden: options.hidden,
      device: 'auto',
      seed: 42,
      initModelPath: learnerModelPath,
      validationRatio: 0.1,
    }, PERSISTENT_TRAINER_INIT_TIMEOUT_MS);

    logger.log('persistent_trainer', {
      status: 'started',
      pid: child.pid ?? null,
      replayPath,
      learnerModelPath,
      init: response,
    });
    log('trainer', `persistent trainer ready pid=${child.pid ?? 'unknown'} samples=${response.sampleCount ?? 'n/a'}`);
    return client;
  }

  async appendSamples(
    samples: ReplaySample[],
    replayMaxSamples: number,
    replayAnchorRatio: number,
  ): Promise<Record<string, unknown>> {
    if (samples.length === 0) {
      return { added: 0 };
    }
    return this.request('append_samples', {
      samples: samples.map((sample) => serializeTrainerSample(sample)),
      replayMaxSamples,
      replayAnchorRatio,
    }, 120_000);
  }

  async replaceReplayFromFile(
    replayPath: string,
    replayMaxSamples: number,
    replayAnchorRatio: number,
    policyTargetTemperature: number,
    sampleCount: number,
  ): Promise<Record<string, unknown>> {
    const timeoutMs = computePersistentReplayReplaceTimeoutMs(sampleCount);
    return this.request('replace_replay_from_file', {
      replayPath,
      replayMaxSamples,
      replayAnchorRatio,
      policyTargetTemperature,
    }, timeoutMs);
  }

  async train(
    step: number,
    options: AsyncOptions,
    budget: ResolvedBudget,
  ): Promise<Record<string, unknown>> {
    return this.request('train', {
      step,
      epochs: budget.trainerEpochs,
      batchSize: budget.trainerBatchSize,
      learningRate: budget.trainerLearningRate,
      weightDecay: options.weightDecay,
      outPath: resolveLearnerModelPath(options),
      emaDecay: 0.995,
      policyLossWeight: 2.0,
      valueLossWeight: 1.0,
      auxLossWeight: 0.2,
      labelSmoothing: options.labelSmoothing,
    });
  }

  async reloadModel(options: AsyncOptions, budget: ResolvedBudget): Promise<Record<string, unknown>> {
    return this.request('reload_model', {
      initModelPath: resolveLearnerModelPath(options),
      learningRate: budget.trainerLearningRate,
      weightDecay: options.weightDecay,
    }, 15_000);
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    try {
      await Promise.race([
        this.request('shutdown', {}),
        sleep(5000).then(() => {
          throw new Error('Persistent trainer shutdown timed out');
        }),
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log('persistent_trainer', {
        status: 'shutdown_timeout',
        error: message,
      });
    } finally {
      this.closed = true;
      this.child.kill();
    }
  }

  private handleProtocolLine(line: string): void {
    if (!line.trim()) return;
    let parsed: PersistentTrainerResponse;
    try {
      parsed = JSON.parse(line) as PersistentTrainerResponse;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.log('persistent_trainer', {
        status: 'protocol_error',
        line,
        error: message,
      });
      return;
    }

    const requestId = String(parsed.id ?? '');
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }
    if (!parsed.ok) {
      pending.reject(new Error(parsed.error ?? 'Persistent trainer request failed'));
      return;
    }
    pending.resolve(parsed.payload ?? {});
  }

  private rejectAllPending(error: Error): void {
    if (this.pending.size === 0) return;
    for (const pending of this.pending.values()) {
      if (pending.timeoutHandle) {
        clearTimeout(pending.timeoutHandle);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }

  private request(
    cmd: string,
    payload: Record<string, unknown>,
    timeoutMs = 0,
  ): Promise<Record<string, unknown>> {
    if (this.closed || this.child.stdin?.destroyed) {
      return Promise.reject(new Error('Persistent trainer is not available'));
    }

    const id = String(this.nextRequestId++);
    return new Promise((resolve, reject) => {
      const pending: PendingTrainerRequest = { resolve, reject };
      if (timeoutMs > 0) {
        pending.timeoutHandle = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Persistent trainer request timed out cmd=${cmd} timeoutMs=${timeoutMs}`));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
      const serialized = JSON.stringify({ id, cmd, payload });
      this.child.stdin?.write(`${serialized}\n`, 'utf8', (error) => {
        if (!error) return;
        const active = this.pending.get(id);
        if (active?.timeoutHandle) {
          clearTimeout(active.timeoutHandle);
        }
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}

function resetPersistentTrainerRecoveryState(state: PersistentTrainerRecoveryState): void {
  state.consecutiveStartFailures = 0;
  state.nextRetryAt = 0;
  state.lastFailureReason = null;
}

function schedulePersistentTrainerRestart(
  state: PersistentTrainerRecoveryState,
  reason: string,
): number {
  state.consecutiveStartFailures += 1;
  const backoffFactor = 2 ** Math.max(0, state.consecutiveStartFailures - 1);
  const delayMs = Math.min(
    PERSISTENT_TRAINER_RESTART_BASE_DELAY_MS * backoffFactor,
    PERSISTENT_TRAINER_RESTART_MAX_DELAY_MS,
  );
  state.nextRetryAt = Date.now() + delayMs;
  state.lastFailureReason = reason;
  return delayMs;
}

async function maybeStartPersistentTrainer(input: {
  options: AsyncOptions;
  budget: ResolvedBudget;
  replayPath: string;
  trainerHolder: { client: PersistentTrainerClient | null };
  recoveryState: PersistentTrainerRecoveryState;
  logger: MetricsLogger;
  trigger: 'startup' | 'pre_step_recovery' | 'restart_after_reload_failure';
  step?: number;
  ignoreCooldown?: boolean;
}): Promise<boolean> {
  const {
    options,
    budget,
    replayPath,
    trainerHolder,
    recoveryState,
    logger,
    trigger,
    step,
    ignoreCooldown = false,
  } = input;

  if (!options.persistentTrainer || options.skipTraining || trainerHolder.client) {
    return false;
  }

  const now = Date.now();
  if (!ignoreCooldown && recoveryState.nextRetryAt > now) {
    logger.log('persistent_trainer', {
      status: 'restart_deferred',
      trigger,
      step: step ?? null,
      retryDelayMs: recoveryState.nextRetryAt - now,
      nextRetryAt: new Date(recoveryState.nextRetryAt).toISOString(),
      consecutiveStartFailures: recoveryState.consecutiveStartFailures,
      lastFailureReason: recoveryState.lastFailureReason,
    });
    return false;
  }

  try {
    trainerHolder.client = await PersistentTrainerClient.start(options, budget, replayPath, logger);
    resetPersistentTrainerRecoveryState(recoveryState);
    logger.log('persistent_trainer', {
      status: trigger === 'startup' ? 'start_completed' : 'restart_completed',
      trigger,
      step: step ?? null,
      replayPath,
    });
    if (trigger !== 'startup') {
      log('trainer', `persistent trainer recovered trigger=${trigger} step=${step ?? 'n/a'}`);
    }
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const retryDelayMs = schedulePersistentTrainerRestart(recoveryState, message);
    logger.log('persistent_trainer', {
      status: trigger === 'startup' ? 'failed_to_start' : 'restart_failed',
      trigger,
      step: step ?? null,
      replayPath,
      error: message,
      retryDelayMs,
      nextRetryAt: new Date(recoveryState.nextRetryAt).toISOString(),
      consecutiveStartFailures: recoveryState.consecutiveStartFailures,
    });
    const restartLabel = trigger === 'startup'
      ? 'persistent trainer unavailable'
      : 'persistent trainer restart failed';
    log(
      'warn',
      `${restartLabel}; falling back to one-shot training: ${message} (next retry in ${formatDuration(retryDelayMs)})`,
    );
    trainerHolder.client = null;
    return false;
  }
}

let interrupted = false;

function requestInterrupt(reason: string): void {
  if (interrupted) return;
  interrupted = true;
  log('interrupt', `${reason}; stopping after active workers/train step`);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const releaseInstanceLock = acquireSingleInstanceLock(
    path.resolve(process.cwd(), '.hive-cache/async/az-async.lock'),
    'Hive async trainer',
  );
  process.on('exit', releaseInstanceLock);
  installSignalHandlers();
  const logger = createMetricsLogger(options.metricsLogPath);

  const chunkDir = path.resolve(process.cwd(), options.chunkDir);
  const tmpDir = path.resolve(process.cwd(), options.tmpDir);
  const replayPath = path.resolve(process.cwd(), options.replayPath);
  const learnerModelPath = path.resolve(process.cwd(), options.learnerModelPath);
  mkdirSync(chunkDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(path.dirname(replayPath), { recursive: true });
  mkdirSync(path.dirname(learnerModelPath), { recursive: true });
  seedLearnerModelIfMissing(options, logger);

  let replay = readReplayPayload(replayPath);
  if (!replay && existsSync(replayPath)) {
    const replaySize = safeReadFileSize(replayPath);
    if (replaySize > 0) {
      const archivedReplayPath = archiveUnreadableReplayFile(replayPath);
      logger.log('replay_recovery', {
        status: 'archived_unreadable_replay',
        replayPath,
        archivedReplayPath,
        replaySize,
      });
      log(
        'warn',
        `archived unreadable replay buffer (${Math.round(replaySize / (1024 * 1024))} MiB) to ${archivedReplayPath}; starting with a fresh replay`,
      );
    }
  }
  replay ??= createEmptyReplay();
  writeReplayPayload(replayPath, replay);
  let currentBudget = resolveBudget(options);
  const selfPlayMixState = createSelfPlayMixState(replay);
  const rebaseState: RebaseState = {
    championHash: currentBudget.championHash,
    severeFailureStreak: 0,
  };

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
    `workers=${options.selfplayWorkers} chunk_games=${options.chunkGames} adaptive=${options.adaptiveBudget ? 'on' : 'off'} persistent_trainer=${options.persistentTrainer ? 'on' : 'off'} caps=${options.simulations}/${options.fastSimulations}/${currentBudget.arenaSimulationCap} arena_games=${options.arenaGames} champion_mix<=${Math.round(currentBudget.championSelfplayRatio * 100)}% replay_anchor<=${Math.round(currentBudget.replayAnchorRatio * 100)}% train_interval=${options.trainIntervalSeconds}s min_replay=${options.minReplaySamples} min_new=${currentBudget.trainerMinNewSamples} preset=${currentBudget.presetId}`,
  );
  log(
    'setup',
    `search_backend=${options.searchBackend} gpu_games_in_flight=${options.gpuGamesInFlight} gpu_batch_size=${options.gpuBatchSize} gpu_batch_delay_ms=${options.gpuBatchDelayMs}`,
  );
  log('setup', `arena replay floor=${options.minArenaReplaySamples}`);
  log(
    'setup',
    `arena_workers=${options.arenaWorkers} arena_remote_slots=${countRemoteWorkerSlots(options.arenaRemoteWorkers)} arena_remote_hosts=${formatRemoteWorkerSummary(options.arenaRemoteWorkers)}`,
  );
  log(
    'setup',
    `selfplay_remote_slots=${countRemoteWorkerSlots(options.selfplayRemoteWorkers)} selfplay_remote_hosts=${formatRemoteWorkerSummary(options.selfplayRemoteWorkers)}`,
  );
  log(
    'setup',
    `learner=${path.resolve(process.cwd(), options.learnerModelPath)} champion=${path.resolve(process.cwd(), options.championModelPath)} snapshot=${path.resolve(process.cwd(), options.candidateOutPath)}`,
  );
  log('budget', formatBudget(currentBudget));
  logger.log('adaptive_budget', serializeBudget(currentBudget, { status: 'initial' }));
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
  const remoteSelfPlaySlots = createRemoteSelfPlaySlots(options.selfplayRemoteWorkers);
  const disabledRemoteSelfPlaySpecs = new Set<string>();
  const selfPlayActivityState = {
    activeLocalWorkers: -1,
    activeRemoteSlots: -1,
    localCap: -1,
    remoteCap: -1,
    configuredRemoteSlots: countRemoteWorkerSlots(options.selfplayRemoteWorkers),
    disabledRemoteSlots: -1,
  };
  const completedChunkPaths: string[] = [];
  const queuedChunkPaths = new Set<string>();
  const trainerHolder: { client: PersistentTrainerClient | null } = { client: null };
  const persistentTrainerRecoveryState: PersistentTrainerRecoveryState = {
    consecutiveStartFailures: 0,
    nextRetryAt: 0,
    lastFailureReason: null,
  };
  const trainerPendingSamples: ReplaySample[] = [];
  let nextWorkerId = 1;
  let trainingTask: Promise<void> | null = null;
  let arenaTask: Promise<void> | null = null;
  let lastTrainAt = 0;
  let lastReplayWriteAt = 0;
  let replayDirty = false;
  const REPLAY_WRITE_INTERVAL_MS = 30_000;
  let newSamplesSinceTrain = 0;
  let totalGenerated = 0;
  let totalChunks = 0;
  let trainStep = 0;
  let fatalError: Error | null = null;

  if (!options.skipTraining && options.persistentTrainer) {
    await maybeStartPersistentTrainer({
      options,
      budget: currentBudget,
      replayPath,
      trainerHolder,
      recoveryState: persistentTrainerRecoveryState,
      logger,
      trigger: 'startup',
    });
  }

  while (true) {
    if (fatalError) throw fatalError;

    const timeReached = deadline !== null && Date.now() >= deadline;
    const allowSpawn = !interrupted && !timeReached;
    const localSelfPlayWorkerCap = resolveSelfPlayWorkerCap(options, {
      arenaRunning: arenaTask !== null,
      trainingRunning: trainingTask !== null,
    });
    const remoteSelfPlayWorkerCap = resolveRemoteSelfPlayWorkerCap(remoteSelfPlaySlots, disabledRemoteSelfPlaySpecs, {
      arenaRunning: arenaTask !== null,
      trainingRunning: trainingTask !== null,
    });

    if (allowSpawn) {
      while (countActiveWorkersByTransport(activeWorkers, 'local') < localSelfPlayWorkerCap) {
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        const outPath = path.join(chunkDir, `chunk-${Date.now()}-${workerId}.json`);
        const selfPlaySource = selectSelfPlaySource(options, currentBudget, selfPlayMixState);
        const worker = spawnLocalSelfPlayWorker(
          workerId,
          options,
          selfPlaySource.modelPath,
          selfPlaySource.sampleOrigin,
          currentBudget,
          outPath,
          completedChunkPaths,
          queuedChunkPaths,
          activeWorkers,
          logger,
        );
        activeWorkers.set(workerId, worker);
      }
      while (countActiveWorkersByTransport(activeWorkers, 'remote') < remoteSelfPlayWorkerCap) {
        const slot = selectAvailableRemoteSelfPlaySlot(remoteSelfPlaySlots, activeWorkers, disabledRemoteSelfPlaySpecs);
        if (!slot) break;
        const workerId = nextWorkerId;
        nextWorkerId += 1;
        const outPath = path.join(chunkDir, `remote-chunk-${Date.now()}-${workerId}.json`);
        const selfPlaySource = selectSelfPlaySource(options, currentBudget, selfPlayMixState);
        const worker = spawnRemoteSelfPlayWorker(
          workerId,
          slot,
          options,
          selfPlaySource.modelPath,
          selfPlaySource.sampleOrigin,
          currentBudget,
          outPath,
          completedChunkPaths,
          queuedChunkPaths,
          activeWorkers,
          disabledRemoteSelfPlaySpecs,
          logger,
        );
        activeWorkers.set(workerId, worker);
      }
    }

    logActiveSelfPlayWorkers(activeWorkers, remoteSelfPlaySlots, disabledRemoteSelfPlaySpecs, {
      localCap: localSelfPlayWorkerCap,
      remoteCap: remoteSelfPlayWorkerCap,
    }, selfPlayActivityState);

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
      const chunkOrigin = inferChunkOrigin(parsed.samples, parsed.summary?.sampleOrigin);
      noteMergedChunk(selfPlayMixState, chunkOrigin, incoming);
      replay = mergeReplaySamples(replay, parsed.samples, options.replayMaxSamples, currentBudget.replayAnchorRatio);
      newSamplesSinceTrain += incoming;
      trainerPendingSamples.push(...parsed.samples);
      totalGenerated += incoming;
      totalChunks += 1;
      replayDirty = true;

      logger.log('async_selfplay_chunk', {
        chunkSamples: parsed.samples.length,
        replaySamples: replay.samples.length,
        newSamplesSinceTrain,
        totalGenerated,
        totalChunks,
        sampleOrigin: chunkOrigin,
        championMergedSamples: selfPlayMixState.championMergedSamples,
        learnerMergedSamples: selfPlayMixState.learnerMergedSamples,
        summary: parsed.summary ?? null,
      });
      const mergedChunks = selfPlayMixState.championMergedChunks + selfPlayMixState.learnerMergedChunks;
      const championChunkShare = mergedChunks > 0
        ? selfPlayMixState.championMergedChunks / mergedChunks
        : 0;
      const replayProgress = formatProgressBar(replay.samples.length / Math.max(1, options.minReplaySamples));
      const newProgress = formatProgressBar(newSamplesSinceTrain / Math.max(1, currentBudget.trainerMinNewSamples));
      const waitMs = Math.max(0, options.trainIntervalSeconds * 1000 - (Date.now() - lastTrainAt));
      log(
        'selfplay',
        `chunk merged origin=${chunkOrigin} samples=${parsed.samples.length} replay=${replay.samples.length} ${replayProgress} new_since_train=${newSamplesSinceTrain} ${newProgress} wait=${formatDuration(waitMs)} champion_share=${(championChunkShare * 100).toFixed(0)}%`,
      );
    }

    if (!trainingTask && !arenaTask && !options.skipTraining) {
      const intervalReady = Date.now() - lastTrainAt >= options.trainIntervalSeconds * 1000;
      const replayReady = replay.samples.length >= options.minReplaySamples;
      const newReady = newSamplesSinceTrain >= currentBudget.trainerMinNewSamples;

      if (intervalReady && replayReady && newReady) {
        // Flush replay to disk before training so persistent trainer reads fresh data
        if (replayDirty) {
          writeReplayPayload(replayPath, replay);
          lastReplayWriteAt = Date.now();
          replayDirty = false;
        }
        trainStep += 1;
        const step = trainStep;
        const snapshot = cloneReplayPayload(replay);
        const pendingTrainerSamples = trainerPendingSamples.slice();
        // Splice immediately so the main array can be GC'd while training runs,
        // instead of holding a duplicate until training completes.
        trainerPendingSamples.length = 0;
        const consumed = newSamplesSinceTrain;
        const budget = currentBudget;
        newSamplesSinceTrain = 0;
        lastTrainAt = Date.now();

        trimActiveSelfPlayWorkers(
          activeWorkers,
          {
            localWorkers: resolveSelfPlayWorkerCap(options, {
              arenaRunning: false,
              trainingRunning: true,
            }),
            remoteWorkers: resolveRemoteSelfPlayWorkerCap(remoteSelfPlaySlots, disabledRemoteSelfPlaySpecs, {
              arenaRunning: false,
              trainingRunning: true,
            }),
          },
          logger,
          'train_throttle',
        );

        trainingTask = runTrainingStep(
          step,
          snapshot,
          pendingTrainerSamples,
          options,
          budget,
          rebaseState,
          tmpDir,
          replayPath,
          trainerHolder,
          persistentTrainerRecoveryState,
          logger,
        )
          .then((result) => {
            logger.log('async_train_step', {
              step,
              status: 'completed',
              consumedNewSamples: consumed,
              replaySamplesSnapshot: snapshot.samples.length,
              trainerMode: result.trainerMode,
              budgetPhase: budget.phase,
              selfplaySimulations: budget.selfplaySimulations,
              fastSimulations: budget.fastSimulations,
              fastRatio: budget.fastRatio,
              championSelfplayRatio: budget.championSelfplayRatio,
              replayAnchorRatio: budget.replayAnchorRatio,
              arenaSimulations: budget.arenaSimulations,
              arenaGames: budget.arenaGames,
            });

            if (result.shouldRunArena) {
              trimActiveSelfPlayWorkers(
                activeWorkers,
                {
                  localWorkers: resolveSelfPlayWorkerCap(options, {
                    arenaRunning: true,
                    trainingRunning: false,
                  }),
                  remoteWorkers: resolveRemoteSelfPlayWorkerCap(remoteSelfPlaySlots, disabledRemoteSelfPlaySpecs, {
                    arenaRunning: true,
                    trainingRunning: false,
                  }),
                },
                logger,
                'arena_throttle',
              );
              arenaTask = runArenaStep(
                step,
                options,
                budget,
                rebaseState,
                result.trainerMode,
                trainerHolder,
                persistentTrainerRecoveryState,
                logger,
              )
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : String(error);
                  logger.log('async_arena_step', { step, status: 'failed', error: message });
                  if (!options.continueOnError) {
                    fatalError = error instanceof Error ? error : new Error(message);
                  } else {
                    log('warn', `arena step ${step} failed: ${message}`);
                  }
                })
                .finally(() => {
                  arenaTask = null;
                });
            }
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.log('async_train_step', {
              step,
              status: 'failed',
              error: message,
              budgetPhase: budget.phase,
            });
            if (!options.continueOnError) {
              fatalError = error instanceof Error ? error : new Error(message);
            } else {
              log('warn', `train step ${step} failed: ${message}`);
            }
          })
          .finally(() => {
            trainingTask = null;
            const nextBudget = resolveBudget(options);
            logger.log('adaptive_budget', serializeBudget(nextBudget, { status: 'recomputed', step }));
            if (!sameBudget(currentBudget, nextBudget)) {
              log('budget', formatBudget(nextBudget));
            } else if (options.verbose) {
              log('budget', `unchanged ${formatBudget(nextBudget)}`);
            }
            currentBudget = nextBudget;
          });
      }
    }

    // Debounced replay buffer persistence — flush every 30s instead of on
    // every chunk merge to avoid blocking the main loop with large writes.
    if (replayDirty && Date.now() - lastReplayWriteAt >= REPLAY_WRITE_INTERVAL_MS) {
      writeReplayPayload(replayPath, replay);
      lastReplayWriteAt = Date.now();
      replayDirty = false;
    }

    const noActive = activeWorkers.size === 0
      && completedChunkPaths.length === 0
      && trainingTask === null
      && arenaTask === null;
    if ((interrupted || timeReached) && noActive) {
      break;
    }

    await sleep(200);
  }

  // Final flush on exit
  if (replayDirty) {
    writeReplayPayload(replayPath, replay);
    replayDirty = false;
  }

  logger.log('async_run_end', {
    status: fatalError ? 'failed' : 'completed',
    elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    replaySamples: replay.samples.length,
    totalGenerated,
    totalChunks,
    trainSteps: trainStep,
  });

  if (trainerHolder.client) {
    await trainerHolder.client.shutdown();
  }

  await publishHiveMetricsSnapshotSafely(options.metricsLogPath);

  if (fatalError) throw fatalError;
  log('done', `elapsed=${formatDuration(Date.now() - startedAt)} replay_samples=${replay.samples.length} train_steps=${trainStep}`);
}

function spawnLocalSelfPlayWorker(
  workerId: number,
  options: AsyncOptions,
  modelPath: string,
  sampleOrigin: SelfPlaySampleOrigin,
  budget: ResolvedBudget,
  outPath: string,
  completedChunkPaths: string[],
  queuedChunkPaths: Set<string>,
  activeWorkers: Map<number, ActiveWorker>,
  logger: MetricsLogger,
): ActiveWorker {
  const useGpuBatched = options.searchBackend === 'gpu-batched';
  const scriptPath = useGpuBatched
    ? path.resolve(process.cwd(), 'scripts/hive/az-selfplay-worker-gpu.ts')
    : path.resolve(process.cwd(), 'scripts/hive/az-selfplay-worker.ts');
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
    String(budget.selfplaySimulations),
    '--fast-simulations',
    String(budget.fastSimulations),
    '--fast-ratio',
    String(budget.fastRatio),
    '--seed',
    String(Date.now() + workerId * 997),
    '--model',
    modelPath,
    '--sample-origin',
    sampleOrigin,
    '--out',
    outPath,
  ];
  // Add GPU-specific args
  if (useGpuBatched) {
    args.push('--batch-size', String(options.gpuBatchSize));
    args.push('--games-in-flight', String(options.gpuGamesInFlight));
    args.push('--batch-delay-ms', String(options.gpuBatchDelayMs));
  }
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: useGpuBatched ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    shell: false,
  });
  if (useGpuBatched) {
    captureSelfPlayWorkerStderr(child, workerId, options, 'local');
  }

  const worker: ActiveWorker = {
    id: workerId,
    transport: 'local',
    process: child,
    outPath,
    remoteSlotId: null,
    remoteSpecKey: null,
    stderrTail: '',
    stoppingReason: null,
  };

  child.on('close', (code, signal) => {
    activeWorkers.delete(workerId);
    if (worker.stoppingReason) {
      logger.log('async_selfplay_worker', {
        workerId,
        status: 'stopped',
        transport: 'local',
        reason: worker.stoppingReason,
        code: code ?? null,
        signal: signal ?? null,
        outPath,
      });
      rmSync(outPath, { force: true });
      return;
    }
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
      transport: 'local',
      code: code ?? null,
      signal: signal ?? null,
      outPath,
    });
    rmSync(outPath, { force: true });
  });
  child.on('error', (error) => {
    activeWorkers.delete(workerId);
    if (worker.stoppingReason) {
      logger.log('async_selfplay_worker', {
        workerId,
        status: 'stopped',
        transport: 'local',
        reason: worker.stoppingReason,
        error: error.message,
        outPath,
      });
      rmSync(outPath, { force: true });
      return;
    }
    logger.log('async_selfplay_worker', {
      workerId,
      status: 'error',
      transport: 'local',
      error: error.message,
      outPath,
    });
    rmSync(outPath, { force: true });
  });

  logger.log('async_selfplay_worker', {
    workerId,
    status: 'started',
    transport: 'local',
    chunkGames: options.chunkGames,
    simulations: budget.selfplaySimulations,
    fastSimulations: budget.fastSimulations,
    fastRatio: budget.fastRatio,
    modelPath,
    sampleOrigin,
    budgetPhase: budget.phase,
    outPath,
  });

  return worker;
}

function spawnRemoteSelfPlayWorker(
  workerId: number,
  slot: RemoteSelfPlaySlot,
  options: AsyncOptions,
  modelPath: string,
  sampleOrigin: SelfPlaySampleOrigin,
  budget: ResolvedBudget,
  outPath: string,
  completedChunkPaths: string[],
  queuedChunkPaths: Set<string>,
  activeWorkers: Map<number, ActiveWorker>,
  disabledRemoteSelfPlaySpecs: Set<string>,
  logger: MetricsLogger,
): ActiveWorker {
  const child = spawn(process.execPath, [
    '--import',
    'tsx',
    path.resolve(process.cwd(), 'scripts/hive/az-selfplay-remote-worker.ts'),
    '--remote-worker',
    slot.spec.raw,
    '--games',
    String(options.chunkGames),
    '--difficulty',
    options.difficulty,
    '--max-turns',
    String(options.maxTurns),
    '--no-capture-draw',
    String(options.noCaptureDrawMoves),
    '--simulations',
    String(budget.selfplaySimulations),
    '--fast-simulations',
    String(budget.fastSimulations),
    '--fast-ratio',
    String(budget.fastRatio),
    '--seed',
    String(Date.now() + workerId * 997),
    '--model',
    modelPath,
    '--sample-origin',
    sampleOrigin,
    '--out',
    outPath,
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'pipe'],
    shell: false,
  });

  const worker: ActiveWorker = {
    id: workerId,
    transport: 'remote',
    process: child,
    outPath,
    remoteSlotId: slot.slotId,
    remoteSpecKey: slot.specKey,
    stderrTail: '',
    stoppingReason: null,
  };
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    worker.stderrTail = appendCapturedOutput(worker.stderrTail, String(chunk), 16 * 1024);
  });

  child.on('close', (code, signal) => {
    activeWorkers.delete(workerId);
    if (worker.stoppingReason) {
      logger.log('async_selfplay_worker', {
        workerId,
        status: 'stopped',
        transport: 'remote',
        slot: slot.label,
        reason: worker.stoppingReason,
        code: code ?? null,
        signal: signal ?? null,
        outPath,
      });
      rmSync(outPath, { force: true });
      return;
    }
    if (code === 0 && existsSync(outPath)) {
      if (!queuedChunkPaths.has(outPath)) {
        queuedChunkPaths.add(outPath);
        completedChunkPaths.push(outPath);
      }
      if (worker.stderrTail.trim().length > 0) {
        logger.log('async_selfplay_remote', {
          workerId,
          status: 'warning',
          slot: slot.label,
          warning: worker.stderrTail.trim(),
        });
        if (options.verbose || /failed/i.test(worker.stderrTail)) {
          log('warn', `remote self-play ${slot.label}: ${worker.stderrTail.trim()}`);
        }
      }
      return;
    }
    disabledRemoteSelfPlaySpecs.add(slot.specKey);
    const errorMessage = worker.stderrTail.trim();
    logger.log('async_selfplay_worker', {
      workerId,
      status: 'failed',
      transport: 'remote',
      slot: slot.label,
      remoteHost: slot.spec.host,
      code: code ?? null,
      signal: signal ?? null,
      outPath,
      error: errorMessage || null,
    });
    log(
      'warn',
      `remote self-play disabled for ${slot.spec.host} (${slot.label}) after failure${errorMessage ? `: ${errorMessage}` : ''}`,
    );
    rmSync(outPath, { force: true });
  });
  child.on('error', (error) => {
    activeWorkers.delete(workerId);
    if (worker.stoppingReason) {
      logger.log('async_selfplay_worker', {
        workerId,
        status: 'stopped',
        transport: 'remote',
        slot: slot.label,
        reason: worker.stoppingReason,
        error: error.message,
        outPath,
      });
      rmSync(outPath, { force: true });
      return;
    }
    disabledRemoteSelfPlaySpecs.add(slot.specKey);
    logger.log('async_selfplay_worker', {
      workerId,
      status: 'error',
      transport: 'remote',
      slot: slot.label,
      remoteHost: slot.spec.host,
      error: error.message,
      outPath,
    });
    log('warn', `remote self-play disabled for ${slot.spec.host} (${slot.label}) after launch error: ${error.message}`);
    rmSync(outPath, { force: true });
  });

  logger.log('async_selfplay_worker', {
    workerId,
    status: 'started',
    transport: 'remote',
    slot: slot.label,
    remoteHost: slot.spec.host,
    chunkGames: options.chunkGames,
    simulations: budget.selfplaySimulations,
    fastSimulations: budget.fastSimulations,
    fastRatio: budget.fastRatio,
    modelPath,
    sampleOrigin,
    budgetPhase: budget.phase,
    outPath,
  });

  return worker;
}

function captureSelfPlayWorkerStderr(
  child: ChildProcess,
  workerId: number,
  options: AsyncOptions,
  transport: 'local' | 'remote',
): void {
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split('\n').filter(Boolean)) {
      if (options.verbose || line.includes('error') || line.includes('Error')) {
        console.error(`[worker-${transport}-${workerId}] ${line}`);
      }
    }
  });
}

function trimActiveSelfPlayWorkers(
  activeWorkers: Map<number, ActiveWorker>,
  targets: {
    localWorkers: number;
    remoteWorkers: number;
  },
  logger: MetricsLogger,
  reason: string,
): void {
  trimActiveSelfPlayWorkersByTransport(activeWorkers, 'remote', targets.remoteWorkers, logger, reason);
  trimActiveSelfPlayWorkersByTransport(activeWorkers, 'local', targets.localWorkers, logger, reason);
}

function trimActiveSelfPlayWorkersByTransport(
  activeWorkers: Map<number, ActiveWorker>,
  transport: 'local' | 'remote',
  targetWorkers: number,
  logger: MetricsLogger,
  reason: string,
): void {
  const activeEntries = Array.from(activeWorkers.entries())
    .filter(([, worker]) => worker.transport === transport);
  if (activeEntries.length <= targetWorkers) return;
  for (const [workerId, worker] of activeEntries.slice(targetWorkers)) {
    worker.stoppingReason = reason;
    logger.log('async_selfplay_worker', {
      workerId,
      status: 'stopping',
      transport,
      reason,
      outPath: worker.outPath,
      remoteSlotId: worker.remoteSlotId,
    });
    try {
      worker.process.kill();
    } catch {
      // Ignore worker shutdown errors and let close/error handlers clean up.
    }
  }
}

function resolveSelfPlayWorkerCap(
  options: AsyncOptions,
  state: {
    arenaRunning: boolean;
    trainingRunning: boolean;
  },
): number {
  if (options.searchBackend === 'gpu-batched') {
    return 1;
  }
  if (state.arenaRunning || state.trainingRunning) {
    return Math.max(1, Math.floor(options.selfplayWorkers * 0.25));
  }
  return options.selfplayWorkers;
}

function resolveRemoteSelfPlayWorkerCap(
  remoteSelfPlaySlots: RemoteSelfPlaySlot[],
  disabledRemoteSelfPlaySpecs: Set<string>,
  state: {
    arenaRunning: boolean;
    trainingRunning: boolean;
  },
): number {
  const availableSlots = countAvailableRemoteSelfPlaySlots(remoteSelfPlaySlots, disabledRemoteSelfPlaySpecs);
  if (availableSlots === 0) return 0;
  if (state.arenaRunning || state.trainingRunning) {
    return Math.min(availableSlots, 2);
  }
  return availableSlots;
}

async function runTrainingStep(
  step: number,
  snapshot: ReplayPayload,
  pendingTrainerSamples: ReplaySample[],
  options: AsyncOptions,
  budget: ResolvedBudget,
  rebaseState: RebaseState,
  tmpDir: string,
  replayPath: string,
  trainerHolder: { client: PersistentTrainerClient | null },
  persistentTrainerRecoveryState: PersistentTrainerRecoveryState,
  logger: MetricsLogger,
): Promise<TrainingStepResult> {
  const learnerModelPath = path.resolve(process.cwd(), options.learnerModelPath);
  const candidateSnapshotPath = path.resolve(process.cwd(), options.candidateOutPath);
  const trainingModelPath = resolveTrainingModelPath(options);
  let trainerMode: TrainingStepResult['trainerMode'] = 'oneshot';
  let datasetPath: string | null = null;
  let shouldArena = false;
  let reanalysed = 0;
  let freshness = 0;
  let fallbackReuseReanalysis = false;

  try {
    if (!trainerHolder.client) {
      await maybeStartPersistentTrainer({
        options,
        budget,
        replayPath,
        trainerHolder,
        recoveryState: persistentTrainerRecoveryState,
        logger,
        trigger: 'pre_step_recovery',
        step,
      });
    }

    if (trainerHolder.client) {
      try {
        trainerMode = 'persistent';
        logger.log('async_train_stage', {
          step,
          stage: 'reanalysis_start',
          trainerMode,
          replaySamples: snapshot.samples.length,
          pendingTrainerSamples: pendingTrainerSamples.length,
          reanalyseFraction: budget.trainerReanalyseFraction,
        });
        reanalysed = await syncPersistentTrainerForStep(
          trainerHolder.client,
          step,
          snapshot,
          pendingTrainerSamples,
          { ...options, reanalyseFraction: budget.trainerReanalyseFraction },
          budget,
          tmpDir,
          replayPath,
          logger,
        );
        freshness = snapshot.samples.length > 0 ? reanalysed / snapshot.samples.length : 0;
        fallbackReuseReanalysis = true;
        logger.log('async_train_stage', {
          step,
          stage: 'reanalysis_complete',
          trainerMode,
          replaySamples: snapshot.samples.length,
          reanalysedSamples: reanalysed,
          replayFreshnessRatio: freshness,
        });
        logger.log('reanalyze_pass', {
          source: 'az',
          mode: 'persistent',
          replaySamples: snapshot.samples.length,
          reanalyseFraction: budget.trainerReanalyseFraction,
          reanalysedSamples: reanalysed,
          replayFreshnessRatio: freshness,
          asyncStep: step,
        });
        logger.log('async_train_trigger', {
          step,
          replaySamples: snapshot.samples.length,
          reanalysedSamples: reanalysed,
          replayFreshnessRatio: freshness,
          trainerMode,
          pendingTrainerSamples: pendingTrainerSamples.length,
          budgetPhase: budget.phase,
          presetId: budget.presetId,
          trainerEpochs: budget.trainerEpochs,
          trainerLearningRate: budget.trainerLearningRate,
          trainerMinNewSamples: budget.trainerMinNewSamples,
          trainerBatchSize: budget.trainerBatchSize,
          trainerReanalyseFraction: budget.trainerReanalyseFraction,
          selfplaySimulations: budget.selfplaySimulations,
          fastSimulations: budget.fastSimulations,
          fastRatio: budget.fastRatio,
          championSelfplayRatio: budget.championSelfplayRatio,
          replayAnchorRatio: budget.replayAnchorRatio,
          arenaSimulations: budget.arenaSimulations,
          arenaGames: budget.arenaGames,
          arenaIntervalSteps: budget.arenaIntervalSteps,
          trainingModelPath,
          learnerModelPath,
        });
        await trainerHolder.client.train(step, options, budget);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof PersistentTrainerSyncError) {
          reanalysed = error.reanalysedSamples;
          freshness = snapshot.samples.length > 0 ? reanalysed / snapshot.samples.length : 0;
          fallbackReuseReanalysis = true;
        }
        logger.log('persistent_trainer', {
          status: 'train_failed',
          step,
          error: message,
          reusedReanalysisForFallback: fallbackReuseReanalysis,
          reanalysedSamples: fallbackReuseReanalysis ? reanalysed : null,
        });
        const retryDelayMs = schedulePersistentTrainerRestart(persistentTrainerRecoveryState, message);
        log('warn', `persistent trainer failed at step ${step}; falling back to one-shot training: ${message}`);
        await trainerHolder.client.shutdown();
        trainerHolder.client = null;
        logger.log('persistent_trainer', {
          status: 'restart_scheduled_after_train_failure',
          step,
          error: message,
          retryDelayMs,
          nextRetryAt: new Date(persistentTrainerRecoveryState.nextRetryAt).toISOString(),
          consecutiveStartFailures: persistentTrainerRecoveryState.consecutiveStartFailures,
        });
        trainerMode = 'oneshot';
      }
    }

    if (trainerMode === 'oneshot') {
      if (!fallbackReuseReanalysis) {
        logger.log('async_train_stage', {
          step,
          stage: 'reanalysis_start',
          trainerMode,
          replaySamples: snapshot.samples.length,
          pendingTrainerSamples: pendingTrainerSamples.length,
          reanalyseFraction: budget.trainerReanalyseFraction,
        });
        reanalysed = await reanalyseSnapshot(
          snapshot,
          { ...options, reanalyseFraction: budget.trainerReanalyseFraction },
          tmpDir,
          logger,
          { step, trainerMode },
        );
        freshness = snapshot.samples.length > 0 ? reanalysed / snapshot.samples.length : 0;
        logger.log('async_train_stage', {
          step,
          stage: 'reanalysis_complete',
          trainerMode,
          replaySamples: snapshot.samples.length,
          reanalysedSamples: reanalysed,
          replayFreshnessRatio: freshness,
        });
      } else {
        logger.log('async_train_stage', {
          step,
          stage: 'reanalysis_reused_after_persistent_failure',
          trainerMode,
          replaySamples: snapshot.samples.length,
          reanalysedSamples: reanalysed,
          replayFreshnessRatio: freshness,
        });
        log(
          'warn',
          `persistent trainer fallback is reusing ${reanalysed} already-reanalysed samples for one-shot training`,
        );
      }
      logger.log('reanalyze_pass', {
        source: 'az',
        mode: 'oneshot',
        replaySamples: snapshot.samples.length,
        reanalyseFraction: budget.trainerReanalyseFraction,
        reanalysedSamples: reanalysed,
        replayFreshnessRatio: freshness,
        asyncStep: step,
      });

      datasetPath = path.join(tmpDir, `az-async-dataset-step-${step}-${Date.now()}.json`);
      writeTrainerDatasetPayload(datasetPath, snapshot);

        logger.log('async_train_trigger', {
        step,
        replaySamples: snapshot.samples.length,
        reanalysedSamples: reanalysed,
        replayFreshnessRatio: freshness,
          datasetPath,
          trainerMode,
          budgetPhase: budget.phase,
          presetId: budget.presetId,
          trainerEpochs: budget.trainerEpochs,
          trainerLearningRate: budget.trainerLearningRate,
          trainerMinNewSamples: budget.trainerMinNewSamples,
          trainerBatchSize: budget.trainerBatchSize,
          trainerReanalyseFraction: budget.trainerReanalyseFraction,
          selfplaySimulations: budget.selfplaySimulations,
        fastSimulations: budget.fastSimulations,
        fastRatio: budget.fastRatio,
        championSelfplayRatio: budget.championSelfplayRatio,
        replayAnchorRatio: budget.replayAnchorRatio,
        arenaSimulations: budget.arenaSimulations,
        arenaGames: budget.arenaGames,
        arenaIntervalSteps: budget.arenaIntervalSteps,
        trainingModelPath,
        learnerModelPath,
      });

      const pythonScript = path.resolve(process.cwd(), 'scripts/hive/train-alphazero.py');
      await runPythonWithFallback([
        pythonScript,
        '--dataset',
        datasetPath,
        '--out',
        learnerModelPath,
        '--init-model',
        trainingModelPath,
        '--epochs',
        String(budget.trainerEpochs),
        '--batch-size',
        String(budget.trainerBatchSize),
        '--lr',
        String(budget.trainerLearningRate),
        '--weight-decay',
        String(options.weightDecay),
        '--hidden',
        options.hidden,
        '--metrics-log',
        path.resolve(process.cwd(), options.metricsLogPath),
      ]);
    }

    writeArenaCandidateSnapshot(learnerModelPath, candidateSnapshotPath);
      logger.log('async_learner_update', {
        step,
        learnerModelPath,
        candidateSnapshotPath,
        initModelPath: trainingModelPath,
        trainerMode,
        presetId: budget.presetId,
      });

    const arenaReplayReady = snapshot.samples.length >= options.minArenaReplaySamples;
    shouldArena = !options.skipArena && arenaReplayReady && shouldRunArenaForStep(step, budget);
    if (!shouldArena && !options.skipArena) {
      const reason = arenaReplayReady ? 'interval_not_reached' : 'min_arena_replay_not_reached';
      logger.log('async_arena_skip', {
        step,
        budgetPhase: budget.phase,
        arenaIntervalSteps: budget.arenaIntervalSteps,
        reason,
        replaySamples: snapshot.samples.length,
        minArenaReplaySamples: options.minArenaReplaySamples,
      });
      if (options.verbose) {
        log(
          'arena',
          arenaReplayReady
            ? `step=${step} phase=${budget.phase} deferred until every ${budget.arenaIntervalSteps} train steps`
            : `step=${step} phase=${budget.phase} deferred until replay ${snapshot.samples.length}/${options.minArenaReplaySamples}`,
        );
      }
    }
  } finally {
    if (datasetPath) {
      rmSync(datasetPath, { force: true });
    }
  }

  return { trainerMode, shouldRunArena: shouldArena };
}

async function runArenaStep(
  step: number,
  options: AsyncOptions,
  budget: ResolvedBudget,
  rebaseState: RebaseState,
  trainerMode: TrainingStepResult['trainerMode'],
  trainerHolder: { client: PersistentTrainerClient | null },
  persistentTrainerRecoveryState: PersistentTrainerRecoveryState,
  logger: MetricsLogger,
): Promise<void> {
  const candidateSnapshotPath = path.resolve(process.cwd(), options.candidateOutPath);
  const learnerModelPath = path.resolve(process.cwd(), options.learnerModelPath);
  const arenaSequence = await runArenaSequence(step, options, budget, candidateSnapshotPath, logger);
  const arenaOutcome = arenaSequence.final;
  const learnerRecoveryAction = maybeRecoverLearnerAfterArena({
    step,
    options,
    rebaseState,
    learnerModelPath,
    candidateSnapshotPath,
    logger,
    arenaOutcome,
  });
  const learnerRecovered = learnerRecoveryAction !== 'none';
  const promoted = arenaOutcome.promoted;
  logger.log('async_arena_result', {
    step,
    promoted,
    budgetPhase: budget.phase,
    presetId: budget.presetId,
    arenaSimulations: arenaOutcome.simulations,
    arenaGames: arenaOutcome.configuredGames,
    championSelfplayRatio: budget.championSelfplayRatio,
    replayAnchorRatio: budget.replayAnchorRatio,
    arenaScore: arenaOutcome.score,
    arenaDecisionReason: arenaOutcome.decisionReason,
    finalScoreCiLow: arenaOutcome.scoreCiLow,
    finalScoreCiHigh: arenaOutcome.scoreCiHigh,
    finalSevereFailure: isSevereArenaFailure(options, arenaOutcome),
    stage2Triggered: arenaSequence.stage2Triggered,
    stage1Score: arenaSequence.stage1.score,
    stage1Reason: arenaSequence.stage1.decisionReason,
    stage1Games: arenaSequence.stage1.completedGames,
    stage1ConfiguredGames: arenaSequence.stage1.configuredGames,
    stage1ScoreCiLow: arenaSequence.stage1.scoreCiLow,
    stage1ScoreCiHigh: arenaSequence.stage1.scoreCiHigh,
    stage2Score: arenaSequence.stage2?.score ?? null,
    stage2Reason: arenaSequence.stage2?.decisionReason ?? null,
    stage2Games: arenaSequence.stage2?.completedGames ?? null,
    stage2ConfiguredGames: arenaSequence.stage2?.configuredGames ?? null,
    stage2ScoreCiLow: arenaSequence.stage2?.scoreCiLow ?? null,
    stage2ScoreCiHigh: arenaSequence.stage2?.scoreCiHigh ?? null,
    learnerRebased: learnerRecoveryAction === 'rebase_champion',
    learnerRestoredFromBest: learnerRecoveryAction === 'restore_best',
    learnerRecoveryAction,
    bestCheckpointScore: readBestLearnerCheckpoint(options)?.arenaScore ?? null,
    severeFailureStreak: rebaseState.severeFailureStreak,
    rebaseFailureStreakTarget: options.rebaseFailureStreak,
    rebaseFailThreshold: options.rebaseFailThreshold,
    trainerMode,
  });
  notifyArenaResult(options, {
    step,
    phase: budget.phase,
    promoted,
    score: arenaOutcome.score,
    decisionReason: arenaOutcome.decisionReason,
    recoveryAction: learnerRecoveryAction,
  });

  if (learnerRecovered && trainerHolder.client) {
    try {
      await trainerHolder.client.reloadModel(options, budget);
      logger.log('persistent_trainer', {
        status: 'reload_model_completed',
        step,
        learnerRecoveryAction,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.log('persistent_trainer', {
        status: 'reload_model_failed',
        step,
        learnerRecoveryAction,
        error: message,
      });
      await trainerHolder.client.shutdown();
      trainerHolder.client = null;
      const replayPath = path.resolve(process.cwd(), options.replayPath);
      const restarted = await maybeStartPersistentTrainer({
        options,
        budget,
        replayPath,
        trainerHolder,
        recoveryState: persistentTrainerRecoveryState,
        logger,
        trigger: 'restart_after_reload_failure',
        step,
        ignoreCooldown: true,
      });
      logger.log('persistent_trainer', {
        status: restarted
          ? 'restart_after_reload_failure_completed'
          : 'restart_after_reload_failure_deferred',
        step,
        learnerRecoveryAction,
        replayPath,
        nextRetryAt: restarted ? null : new Date(persistentTrainerRecoveryState.nextRetryAt).toISOString(),
      });
    }
  }

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

async function runArenaSequence(
  step: number,
  options: AsyncOptions,
  budget: ResolvedBudget,
  candidateSnapshotPath: string,
  logger: MetricsLogger,
): Promise<ArenaSequenceOutcome> {
  const stage1PromoteOutPath = options.arenaStage2Enabled
    ? path.resolve(process.cwd(), options.tmpDir, `az-stage1-promote-${step}.json`)
    : options.promoteOutPath;
  log(
    'arena',
    `step=${step} phase=${budget.phase} preset=${budget.presetId} stage=1 sims=${budget.arenaSimulations} games=${budget.arenaGames}${options.verbose ? ' verbose=on' : ''}`,
  );
  const stage1 = await runArenaMatch({
    step,
    stage: 1,
    simulations: budget.arenaSimulations,
    games: budget.arenaGames,
    promoteOutPath: stage1PromoteOutPath,
    candidateSnapshotPath,
    options,
    logger,
  });
  const stage2Triggered = shouldRunArenaStage2(options, stage1);
  if (!stage2Triggered) {
    finalizeArenaPromotionIfNeeded(stage1, stage1PromoteOutPath, candidateSnapshotPath, options, logger, step);
    return { stage1, stage2: null, final: stage1, stage2Triggered };
  }

  const stage2Simulations = Math.max(stage1.simulations ?? budget.arenaSimulations, Math.round(budget.arenaSimulations * options.arenaStage2SimulationScale));
  const stage2Games = Math.max(stage1.configuredGames ?? budget.arenaGames, Math.round(budget.arenaGames * options.arenaStage2GameScale));
  log(
    'arena',
    `step=${step} phase=${budget.phase} preset=${budget.presetId} stage=2 sims=${stage2Simulations} games=${stage2Games}${options.verbose ? ' verbose=on' : ''}`,
  );
  const stage2 = await runArenaMatch({
    step,
    stage: 2,
    simulations: stage2Simulations,
    games: stage2Games,
    promoteOutPath: options.promoteOutPath,
    candidateSnapshotPath,
    options,
    logger,
  });
  return { stage1, stage2, final: stage2, stage2Triggered };
}

function finalizeArenaPromotionIfNeeded(
  outcome: ArenaOutcome,
  promoteOutPath: string,
  candidateSnapshotPath: string,
  options: AsyncOptions,
  logger: MetricsLogger,
  step: number,
): void {
  if (!outcome.promoted || promoteOutPath === options.promoteOutPath) return;

  const resolvedPromoteOutPath = path.resolve(process.cwd(), options.promoteOutPath);
  mkdirSync(path.dirname(resolvedPromoteOutPath), { recursive: true });
  copyFileSync(candidateSnapshotPath, resolvedPromoteOutPath);
  logger.log('async_arena_promotion_finalized', {
    step,
    stage: outcome.stage,
    sourceModelPath: candidateSnapshotPath,
    promoteOutPath: resolvedPromoteOutPath,
    decisionReason: outcome.decisionReason,
    score: outcome.score,
  });
  log(
    'arena',
    `step=${step} finalized promoted champion -> ${resolvedPromoteOutPath} (stage=${outcome.stage} reason=${outcome.decisionReason ?? 'unknown'})`,
  );
}

async function runArenaMatch(input: {
  step: number;
  stage: number;
  simulations: number;
  games: number;
  promoteOutPath: string;
  candidateSnapshotPath: string;
  options: AsyncOptions;
  logger: MetricsLogger;
}): Promise<ArenaOutcome> {
  const {
    step,
    stage,
    simulations,
    games,
    promoteOutPath,
    candidateSnapshotPath,
    options,
    logger,
  } = input;
  const arenaResult = await runCommand(process.execPath, [
    '--import',
    'tsx',
    path.resolve(process.cwd(), 'scripts/hive/eval-arena.ts'),
    '--candidate-model',
    candidateSnapshotPath,
    '--champion-model',
    options.championModelPath,
    '--promote-out',
    promoteOutPath,
    '--simulations',
    String(simulations),
    '--games',
    String(games),
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
    '--search-backend',
    ARENA_SEARCH_BACKEND,
    '--max-turns',
    String(options.maxTurns),
    '--no-capture-draw',
    String(options.noCaptureDrawMoves),
    '--metrics-log',
    options.metricsLogPath,
    '--workers',
    String(options.arenaWorkers),
    ...options.arenaRemoteWorkers.flatMap((spec) => ['--remote-worker', spec.raw]),
    ...(options.verbose ? ['--verbose'] : []),
  ], {
    stdio: 'pipe',
    streamStdout: true,
    streamStderr: true,
  });
  const outcome = parseArenaOutcome(arenaResult.stdout, stage, simulations, options.arenaThreshold);
  if (stage !== 2 && promoteOutPath !== options.promoteOutPath) {
    rmSync(promoteOutPath, { force: true });
  }
  logger.log('async_arena_stage_result', {
    step,
    stage,
    promoted: outcome.promoted,
    arenaScore: outcome.score,
    arenaDecisionReason: outcome.decisionReason,
    scoreCiLow: outcome.scoreCiLow,
    scoreCiHigh: outcome.scoreCiHigh,
    completedGames: outcome.completedGames,
    configuredGames: outcome.configuredGames,
    simulations,
    threshold: options.arenaThreshold,
  });
  return outcome;
}

function didArenaPromote(stdout: string): boolean {
  if (/\[arena:promote\]\s+candidate promoted\b/i.test(stdout)) return true;
  if (/\[arena:done\][^\n]*promoted=yes/i.test(stdout)) return true;
  return false;
}

function parseArenaOutcome(stdout: string, stage: number, simulations: number, threshold: number): ArenaOutcome {
  const lines = stdout.split(/\r?\n/);
  let summaryLine: string | null = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes('[arena:done]')) {
      summaryLine = lines[index];
      break;
    }
  }
  const promoted = didArenaPromote(stdout);
  const scoreMatch = summaryLine?.match(/\bscore=([0-9]+(?:\.[0-9]+)?)%/i) ?? null;
  const ciMatch = summaryLine?.match(/\bci\d+=\[([0-9]+(?:\.[0-9]+)?)%,([0-9]+(?:\.[0-9]+)?)%\]/i) ?? null;
  const reasonMatch = summaryLine?.match(/\breason=([a-z0-9_]+)\b/i) ?? null;
  const gamesMatch = summaryLine?.match(/\bgames=(\d+)\/(\d+)\b/i) ?? null;
  return {
    promoted,
    score: scoreMatch ? Number.parseFloat(scoreMatch[1]) / 100 : null,
    decisionReason: reasonMatch?.[1] ?? null,
    completedGames: gamesMatch ? Number.parseInt(gamesMatch[1], 10) : null,
    configuredGames: gamesMatch ? Number.parseInt(gamesMatch[2], 10) : null,
    scoreCiLow: ciMatch ? Number.parseFloat(ciMatch[1]) / 100 : null,
    scoreCiHigh: ciMatch ? Number.parseFloat(ciMatch[2]) / 100 : null,
    stage,
    simulations,
    threshold,
  };
}

function shouldRunArenaStage2(options: AsyncOptions, stage1: ArenaOutcome): boolean {
  if (!options.arenaStage2Enabled) return false;
  if (stage1.score === null) return true;
  const margin = options.arenaStage2TriggerMargin;
  if (!stage1.promoted && stage1.score <= Math.max(0, options.rebaseFailThreshold)) {
    return false;
  }
  if (stage1.promoted && stage1.scoreCiLow !== null && stage1.scoreCiLow >= options.arenaThreshold + margin) {
    return false;
  }
  if (!stage1.promoted && stage1.scoreCiHigh !== null && stage1.scoreCiHigh < Math.max(0, options.arenaThreshold - margin)) {
    return false;
  }
  return Math.abs(stage1.score - options.arenaThreshold) <= margin
    || (stage1.scoreCiLow !== null && stage1.scoreCiHigh !== null && stage1.scoreCiLow <= options.arenaThreshold && stage1.scoreCiHigh >= options.arenaThreshold)
    || stage1.decisionReason === 'fixed_threshold_pending'
    || stage1.decisionReason === 'sprt_inconclusive_fallback_fixed';
}

async function syncPersistentTrainerForStep(
  trainerClient: PersistentTrainerClient,
  step: number,
  snapshot: ReplayPayload,
  pendingTrainerSamples: ReplaySample[],
  options: AsyncOptions,
  budget: ResolvedBudget,
  tmpDir: string,
  replayPath: string,
  logger: MetricsLogger,
): Promise<number> {
  if (budget.trainerReanalyseFraction > 0) {
    const reanalysed = await reanalyseSnapshot(
      snapshot,
      { ...options, reanalyseFraction: budget.trainerReanalyseFraction },
      tmpDir,
      logger,
      { step, trainerMode: 'persistent' },
    );
    const datasetPath = path.join(tmpDir, `az-async-stream-sync-step-${step}-${Date.now()}.json`);
    try {
      writeTrainerDatasetPayload(datasetPath, snapshot);
      try {
        await trainerClient.replaceReplayFromFile(
          datasetPath,
          options.replayMaxSamples,
          budget.replayAnchorRatio,
          options.policyTargetTemperature,
          snapshot.samples.length,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PersistentTrainerSyncError(message, reanalysed);
      }
    } finally {
      rmSync(datasetPath, { force: true });
    }
    logger.log('persistent_trainer', {
      status: 'replace_replay',
      step,
      replayPath,
      replaySamples: snapshot.samples.length,
      reanalysedSamples: reanalysed,
      presetId: budget.presetId,
    });
    return reanalysed;
  }

  const syncResult = await trainerClient.appendSamples(
    pendingTrainerSamples,
    options.replayMaxSamples,
    budget.replayAnchorRatio,
  );
  logger.log('persistent_trainer', {
    status: 'append_samples',
    step,
    pendingSamples: pendingTrainerSamples.length,
    syncResult,
    presetId: budget.presetId,
  });
  return 0;
}

function isSevereArenaFailure(options: AsyncOptions, arenaOutcome: ArenaOutcome): boolean {
  if (arenaOutcome.promoted) return false;
  return arenaOutcome.score !== null && arenaOutcome.score < options.rebaseFailThreshold;
}

function resolveBestCheckpointCandidateScoreFloor(options: AsyncOptions): number {
  return Math.max(options.bestCheckpointScoreFloor, options.arenaThreshold - 0.05);
}

function maybeSaveBestLearnerCheckpoint(input: {
  step: number;
  options: AsyncOptions;
  candidateSnapshotPath: string;
  logger: MetricsLogger;
  championHash: string | null;
  arenaOutcome: ArenaOutcome;
}): BestLearnerCheckpoint | null {
  const {
    step,
    options,
    candidateSnapshotPath,
    logger,
    championHash,
    arenaOutcome,
  } = input;
  const current = readBestLearnerCheckpoint(options);
  const candidateScoreFloor = resolveBestCheckpointCandidateScoreFloor(options);
  if (
    !championHash
    || arenaOutcome.score === null
    || !existsSync(candidateSnapshotPath)
  ) {
    return current;
  }

  const checkpointEligible = arenaOutcome.promoted || arenaOutcome.score > candidateScoreFloor;
  if (!checkpointEligible) {
    return current;
  }

  if (
    current
    && current.championHash === championHash
    && current.arenaScore >= arenaOutcome.score
  ) {
    return current;
  }

  const nextCheckpoint: BestLearnerCheckpoint = {
    championHash,
    arenaScore: arenaOutcome.score,
    savedAt: new Date().toISOString(),
    step,
    arenaDecisionReason: arenaOutcome.decisionReason,
  };
  writeBestLearnerCheckpoint(options, nextCheckpoint, candidateSnapshotPath);
  logger.log('learner_best_checkpoint_saved', {
    step,
    bestLearnerModelPath: resolveBestLearnerModelPath(options),
    bestLearnerMetaPath: resolveBestLearnerMetaPath(options),
    championHash,
    arenaScore: arenaOutcome.score,
    arenaDecisionReason: arenaOutcome.decisionReason,
    checkpointFloor: candidateScoreFloor,
    restoreFloor: options.bestCheckpointScoreFloor,
    promoted: arenaOutcome.promoted,
  });
  log(
    'arena',
    `step=${step} saved best learner checkpoint score=${formatMaybePercent(arenaOutcome.score)} reason=${arenaOutcome.decisionReason ?? 'unknown'}`,
  );
  return nextCheckpoint;
}

function shouldRestoreBestLearnerCheckpoint(
  options: AsyncOptions,
  checkpoint: BestLearnerCheckpoint | null,
  championHash: string | null,
  arenaOutcome: ArenaOutcome,
): boolean {
  if (!checkpoint || !championHash) return false;
  if (arenaOutcome.promoted || arenaOutcome.score === null) return false;
  if (checkpoint.championHash !== championHash) return false;
  return arenaOutcome.score < options.bestCheckpointScoreFloor;
}

function updateRebaseState(
  rebaseState: RebaseState,
  championHash: string | null,
  severeFailure: boolean,
  promoted: boolean,
): void {
  if (rebaseState.championHash !== championHash) {
    rebaseState.championHash = championHash;
    rebaseState.severeFailureStreak = 0;
  }

  if (promoted) {
    rebaseState.championHash = championHash;
    rebaseState.severeFailureStreak = 0;
    return;
  }

  if (severeFailure) {
    rebaseState.severeFailureStreak += 1;
    return;
  }

  rebaseState.severeFailureStreak = 0;
}

function shouldRebaseAfterArenaFailure(
  options: AsyncOptions,
  rebaseState: RebaseState,
  arenaOutcome: ArenaOutcome,
): boolean {
  if (!options.rebaseOnFailedArena || arenaOutcome.promoted) return false;
  return rebaseState.severeFailureStreak >= options.rebaseFailureStreak;
}

function formatRebaseFailureTrigger(rebaseFailureStreak: number): string {
  if (rebaseFailureStreak <= 1) {
    return 'after severe failure';
  }
  return `after ${rebaseFailureStreak} severe failures`;
}

function maybeRecoverLearnerAfterArena(input: {
  step: number;
  options: AsyncOptions;
  rebaseState: RebaseState;
  learnerModelPath: string;
  candidateSnapshotPath: string;
  logger: MetricsLogger;
  arenaOutcome: ArenaOutcome;
}): LearnerRecoveryAction {
  const {
    step,
    options,
    rebaseState,
    learnerModelPath,
    candidateSnapshotPath,
    logger,
    arenaOutcome,
  } = input;
  const championModelPath = resolveChampionModelPath(options);
  const championHash = readChampionStatus(options.championModelPath).hash;
  const bestCheckpoint = maybeSaveBestLearnerCheckpoint({
    step,
    options,
    candidateSnapshotPath,
    logger,
    championHash,
    arenaOutcome,
  });

  if (shouldRestoreBestLearnerCheckpoint(options, bestCheckpoint, championHash, arenaOutcome)) {
    const bestLearnerModelPath = resolveBestLearnerModelPath(options);
    if (!existsSync(bestLearnerModelPath)) {
      logger.log('learner_restore_from_best_skipped', {
        step,
        bestLearnerModelPath,
        championHash,
        arenaScore: arenaOutcome.score,
        bestCheckpointScore: bestCheckpoint?.arenaScore ?? null,
        reason: 'missing_best_checkpoint_model',
      });
    } else {
      mkdirSync(path.dirname(learnerModelPath), { recursive: true });
      copyFileSync(bestLearnerModelPath, learnerModelPath);
      writeArenaCandidateSnapshot(learnerModelPath, candidateSnapshotPath);
      rebaseState.championHash = championHash;
      rebaseState.severeFailureStreak = 0;
      logger.log('learner_restore_from_best', {
        step,
        learnerModelPath,
        candidateSnapshotPath,
        bestLearnerModelPath,
        bestLearnerMetaPath: resolveBestLearnerMetaPath(options),
        championHash,
        arenaScore: arenaOutcome.score,
        bestCheckpointScore: bestCheckpoint?.arenaScore ?? null,
        regressionTolerance: options.bestCheckpointRegressionTolerance,
        arenaDecisionReason: arenaOutcome.decisionReason,
      });
      log(
        'arena',
        `step=${step} restored learner from best checkpoint best=${formatMaybePercent(bestCheckpoint?.arenaScore ?? null)} current=${formatMaybePercent(arenaOutcome.score)} reason=${arenaOutcome.decisionReason ?? 'unknown'}`,
      );
      return 'restore_best';
    }
  }

  const severeFailure = isSevereArenaFailure(options, arenaOutcome);
  updateRebaseState(rebaseState, championHash, severeFailure, arenaOutcome.promoted);
  if (!shouldRebaseAfterArenaFailure(options, rebaseState, arenaOutcome)) {
    if (severeFailure && options.rebaseOnFailedArena) {
      logger.log('learner_rebase_deferred', {
        step,
        learnerModelPath,
        candidateSnapshotPath,
        championModelPath,
        championHash,
        arenaScore: arenaOutcome.score,
        arenaDecisionReason: arenaOutcome.decisionReason,
        completedGames: arenaOutcome.completedGames,
        configuredGames: arenaOutcome.configuredGames,
        severeFailureStreak: rebaseState.severeFailureStreak,
        rebaseFailureStreakTarget: options.rebaseFailureStreak,
        rebaseFailThreshold: options.rebaseFailThreshold,
      });
      log(
        'arena',
        `step=${step} severe failure noted score=${formatMaybePercent(arenaOutcome.score)} streak=${rebaseState.severeFailureStreak}/${options.rebaseFailureStreak} no rebase yet`,
      );
    }
    return 'none';
  }

  if (!existsSync(championModelPath)) {
    logger.log('learner_rebase_skipped', {
      step,
      learnerModelPath,
      candidateSnapshotPath,
      championModelPath,
      championHash,
      arenaScore: arenaOutcome.score,
      arenaDecisionReason: arenaOutcome.decisionReason,
      severeFailureStreak: rebaseState.severeFailureStreak,
      rebaseFailureStreakTarget: options.rebaseFailureStreak,
      rebaseFailThreshold: options.rebaseFailThreshold,
      reason: 'missing_champion_model',
    });
    log('warn', `step=${step} failed to rebase learner: champion model missing at ${championModelPath}`);
    return 'none';
  }

  mkdirSync(path.dirname(learnerModelPath), { recursive: true });
  copyFileSync(championModelPath, learnerModelPath);
  writeArenaCandidateSnapshot(learnerModelPath, candidateSnapshotPath);
  rebaseState.severeFailureStreak = 0;
  logger.log('learner_rebase', {
    step,
    learnerModelPath,
    candidateSnapshotPath,
    championModelPath,
    championHash,
    arenaScore: arenaOutcome.score,
    arenaDecisionReason: arenaOutcome.decisionReason,
    completedGames: arenaOutcome.completedGames,
    configuredGames: arenaOutcome.configuredGames,
    severeFailureStreak: options.rebaseFailureStreak,
    rebaseFailureStreakTarget: options.rebaseFailureStreak,
    rebaseFailThreshold: options.rebaseFailThreshold,
    trigger: 'repeated_severe_failures',
  });
  log(
    'arena',
    `step=${step} rebased learner from champion ${formatRebaseFailureTrigger(options.rebaseFailureStreak)} score=${formatMaybePercent(arenaOutcome.score)} reason=${arenaOutcome.decisionReason ?? 'unknown'}`,
  );
  return 'rebase_champion';
}

async function reanalyseSnapshot(
  snapshot: ReplayPayload,
  options: AsyncOptions,
  tmpDir: string,
  logger?: MetricsLogger,
  context?: ReanalyseLogContext,
): Promise<number> {
  if (options.reanalyseFraction <= 0) return 0;
  const modelPath = resolveTrainingModelPath(options);
  if (!existsSync(modelPath)) return 0;
  if (snapshot.samples.length === 0) return 0;

  const maxSelectedSamples = Math.max(1, options.reanalyseWorkers * REANALYSE_MAX_SAMPLES_PER_WORKER);
  const count = Math.min(
    snapshot.samples.length,
    Math.floor(snapshot.samples.length * options.reanalyseFraction),
    maxSelectedSamples,
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
      modelPath,
      difficulty: options.difficulty,
      fastSimulations: options.fastSimulations,
      maxTurns: options.maxTurns,
    };
    writeFileSync(inputPath, `${JSON.stringify(payload)}\n`, 'utf8');
    return { inputPath, outputPath, workerIndex, sampleCount: indices.length };
  });

  try {
    logger?.log('reanalyse_dispatch', {
      step: context?.step ?? null,
      trainerMode: context?.trainerMode ?? null,
      replaySamples: snapshot.samples.length,
      requestedSamples: Math.min(
        snapshot.samples.length,
        Math.floor(snapshot.samples.length * options.reanalyseFraction),
      ),
      selectedSamples: selected.length,
      cappedSamples: selected.length < Math.min(
        snapshot.samples.length,
        Math.floor(snapshot.samples.length * options.reanalyseFraction),
      )
        ? maxSelectedSamples
        : null,
      workers,
    });

    const results = await Promise.all(jobs.map(async (job) => {
      const timeoutMs = computeReanalyseWorkerTimeoutMs(job.sampleCount);
      try {
        await runCommand(process.execPath, [
          '--import',
          'tsx',
          path.resolve(process.cwd(), 'scripts/hive/reanalyse-worker.ts'),
          '--input',
          job.inputPath,
          '--output',
          job.outputPath,
        ], {
          stdio: 'ignore',
          timeoutMs,
        });
        return { ...job, status: 'completed' as const, timeoutMs, error: null };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.log('reanalyse_worker', {
          step: context?.step ?? null,
          trainerMode: context?.trainerMode ?? null,
          workerIndex: job.workerIndex,
          sampleCount: job.sampleCount,
          timeoutMs,
          status: 'failed',
          error: message,
        });
        return { ...job, status: 'failed' as const, timeoutMs, error: message };
      }
    }));

    for (const job of results) {
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

    const failedWorkers = results.filter((job) => job.status === 'failed').length;
    if (failedWorkers > 0) {
      logger?.log('reanalyse_dispatch', {
        step: context?.step ?? null,
        trainerMode: context?.trainerMode ?? null,
        replaySamples: snapshot.samples.length,
        selectedSamples: selected.length,
        workers,
        failedWorkers,
        updatedSamples: updated,
        status: 'partial_failure',
      });
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
    const fileSize = statSync(absolutePath).size;
    if (fileSize > MAX_REPLAY_JSON_BYTES) {
      return readLargeMonolithicReplayPayload(absolutePath);
    }
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as ReplayPayload | ShardedReplayManifest;
    return normalizeReplayPersistencePayload(absolutePath, parsed);
  } catch {
    return null;
  }
}

function archiveUnreadableReplayFile(absolutePath: string): string {
  const archiveDir = path.resolve(path.dirname(absolutePath), '_archive');
  mkdirSync(archiveDir, { recursive: true });
  const extension = path.extname(absolutePath);
  const basename = path.basename(absolutePath, extension);
  const timestamp = Date.now();
  const archivedPath = path.join(archiveDir, `${basename}-${timestamp}${extension}`);
  const shardDir = resolveReplayShardDir(absolutePath);
  if (existsSync(shardDir)) {
    const archivedShardDir = path.join(archiveDir, `${basename}-${timestamp}${REPLAY_SHARD_DIR_SUFFIX}`);
    renameSync(shardDir, archivedShardDir);
  }
  renameSync(absolutePath, archivedPath);
  return archivedPath;
}

function writeReplayPayload(absolutePath: string, payload: ReplayPayload): void {
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  payload.updatedAt = new Date().toISOString();
  writeShardedReplayPayload(absolutePath, payload);
}

function writeTrainerDatasetPayload(absolutePath: string, payload: ReplayPayload): void {
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeReplayPayloadFile(absolutePath, payload, serializeTrainerSample);
}

function mergeReplaySamples(
  replay: ReplayPayload,
  freshSamples: ReplaySample[],
  maxSamples: number,
  replayAnchorRatio: number,
): ReplayPayload {
  const merged = [...replay.samples, ...freshSamples];
  const trimmed = trimReplaySamples(merged, maxSamples, replayAnchorRatio);
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
  // Shallow-clone the samples array instead of structuredClone to avoid
  // doubling memory.  The main loop never mutates individual sample objects
  // (mergeReplaySamples creates new arrays), and reanalysis mutations
  // (policyTargets, searchMeta) propagating to the main replay are beneficial.
  return {
    ...payload,
    samples: payload.samples.slice(),
  };
}

function writeReplayPayloadFile(
  absolutePath: string,
  payload: ReplayPayload,
  serializeSample: (sample: ReplaySample) => Record<string, unknown>,
): void {
  const tempPath = `${absolutePath}.tmp`;
  let fd: number | null = null;

  try {
    fd = openSync(tempPath, 'w');
    writeSync(fd, '{"version":');
    writeSync(fd, JSON.stringify(payload.version));
    writeSync(fd, ',"createdAt":');
    writeSync(fd, JSON.stringify(payload.createdAt));
    writeSync(fd, ',"updatedAt":');
    writeSync(fd, JSON.stringify(payload.updatedAt));
    writeSync(fd, ',"stateFeatureNames":');
    writeSync(fd, JSON.stringify(payload.stateFeatureNames));
    writeSync(fd, ',"actionFeatureNames":');
    writeSync(fd, JSON.stringify(payload.actionFeatureNames));
    writeSync(fd, ',"samples":[');

    for (let index = 0; index < payload.samples.length; index += 1) {
      if (index > 0) {
        writeSync(fd, ',');
      }
      writeSync(fd, JSON.stringify(serializeSample(payload.samples[index])));
    }

    writeSync(fd, ']}\n');
    closeSync(fd);
    fd = null;
    renameSync(tempPath, absolutePath);
  } catch (error) {
    if (fd !== null) {
      closeSync(fd);
    }
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function normalizeReplayPersistencePayload(
  absolutePath: string,
  payload: ReplayPayload | ShardedReplayManifest,
): ReplayPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  if ('samples' in payload && Array.isArray(payload.samples)) {
    return {
      ...payload,
      samples: payload.samples.map((sample) => ({
        ...sample,
        stateSnapshot: inflatePersistedReplayState(sample.stateSnapshot),
      })),
    };
  }
  if (!('shards' in payload) || !Array.isArray(payload.shards)) {
    return null;
  }
  const samples: ReplaySample[] = [];
  const shardDir = resolveReplayShardDir(absolutePath);
  for (const shard of payload.shards) {
    if (!shard || typeof shard.fileName !== 'string') return null;
    const shardPath = path.join(shardDir, shard.fileName);
    if (!existsSync(shardPath)) return null;
    const rawShard = JSON.parse(readFileSync(shardPath, 'utf8')) as unknown;
    const shardSamples = Array.isArray(rawShard)
      ? rawShard
      : (rawShard && typeof rawShard === 'object' && Array.isArray((rawShard as { samples?: unknown[] }).samples))
        ? (rawShard as { samples: unknown[] }).samples
        : null;
    if (!shardSamples) return null;
    for (const rawSample of shardSamples) {
      if (!rawSample || typeof rawSample !== 'object') continue;
      const sample = rawSample as ReplaySample;
      samples.push({
        ...sample,
        stateSnapshot: inflatePersistedReplayState(sample.stateSnapshot),
      });
    }
  }
  return {
    version: payload.version,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    stateFeatureNames: payload.stateFeatureNames,
    actionFeatureNames: payload.actionFeatureNames,
    samples,
  };
}

function resolveReplayShardDir(absolutePath: string): string {
  return `${absolutePath}${REPLAY_SHARD_DIR_SUFFIX}`;
}

function writeShardedReplayPayload(absolutePath: string, payload: ReplayPayload): void {
  const manifestTempPath = `${absolutePath}.tmp`;
  const shardDir = resolveReplayShardDir(absolutePath);
  const tempShardDir = `${shardDir}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(tempShardDir, { recursive: true });

  try {
    const shards: ReplayShardManifestEntry[] = [];
    for (let index = 0; index < payload.samples.length; index += REPLAY_SHARD_SAMPLE_COUNT) {
      const shardSamples = payload.samples.slice(index, index + REPLAY_SHARD_SAMPLE_COUNT);
      const fileName = `part-${String(shards.length).padStart(5, '0')}.json`;
      const shardPath = path.join(tempShardDir, fileName);
      const serialized = shardSamples.map((sample) => serializeReplaySampleForPersistence(sample));
      writeFileSync(shardPath, `${JSON.stringify(serialized)}\n`, 'utf8');
      shards.push({
        fileName,
        sampleCount: shardSamples.length,
      });
    }

    const manifest: ShardedReplayManifest = {
      version: Math.max(payload.version, 3),
      storage: 'sharded',
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      stateFeatureNames: payload.stateFeatureNames,
      actionFeatureNames: payload.actionFeatureNames,
      totalSamples: payload.samples.length,
      shards,
    };
    writeFileSync(manifestTempPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    rmSync(shardDir, { recursive: true, force: true });
    renameSync(tempShardDir, shardDir);
    renameSync(manifestTempPath, absolutePath);
  } catch (error) {
    rmSync(manifestTempPath, { force: true });
    rmSync(tempShardDir, { recursive: true, force: true });
    throw error;
  }
}

function readLargeMonolithicReplayPayload(absolutePath: string): ReplayPayload | null {
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.alloc(REPLAY_STREAM_READ_BYTES);
  const samples: ReplaySample[] = [];
  let fd: number | null = null;
  let headerParsed = false;
  let header: Omit<ReplayPayload, 'samples'> | null = null;
  let headerBuffer = '';
  let pending = '';
  let currentSample = '';
  let depth = 0;
  let inString = false;
  let escape = false;

  try {
    fd = openSync(absolutePath, 'r');
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      if (!headerParsed) {
        headerBuffer += chunk;
        const match = headerBuffer.match(/"samples"\s*:\s*\[/);
        if (!match || match.index === undefined) {
          continue;
        }
        const prefix = headerBuffer.slice(0, match.index);
        const headerJson = `${prefix}"samples":[]}`;
        const parsedHeader = JSON.parse(headerJson) as ReplayPayload;
        const normalizedHeader = normalizeReplayPersistencePayload(absolutePath, parsedHeader);
        if (!normalizedHeader) return null;
        header = {
          version: normalizedHeader.version,
          createdAt: normalizedHeader.createdAt,
          updatedAt: normalizedHeader.updatedAt,
          stateFeatureNames: normalizedHeader.stateFeatureNames,
          actionFeatureNames: normalizedHeader.actionFeatureNames,
        };
        pending = headerBuffer.slice(match.index + match[0].length);
        headerParsed = true;
        headerBuffer = '';
      } else {
        pending += chunk;
      }

      if (!headerParsed) continue;
      const consumed = consumeReplaySampleStream(pending, samples, {
        currentSample,
        depth,
        inString,
        escape,
      });
      pending = consumed.remaining;
      currentSample = consumed.currentSample;
      depth = consumed.depth;
      inString = consumed.inString;
      escape = consumed.escape;
      if (consumed.done) {
        break;
      }
    }

    if (!headerParsed || !header) return null;
    pending += decoder.end();
    const consumed = consumeReplaySampleStream(pending, samples, {
      currentSample,
      depth,
      inString,
      escape,
    });
    if (!consumed.done && (consumed.currentSample || consumed.remaining.trim())) {
      return null;
    }
    return {
      ...header,
      samples,
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

function consumeReplaySampleStream(
  input: string,
  samples: ReplaySample[],
  state: {
    currentSample: string;
    depth: number;
    inString: boolean;
    escape: boolean;
  },
): {
  remaining: string;
  currentSample: string;
  depth: number;
  inString: boolean;
  escape: boolean;
  done: boolean;
} {
  let remaining = '';
  let currentSample = state.currentSample;
  let depth = state.depth;
  let inString = state.inString;
  let escape = state.escape;
  let collecting = currentSample.length > 0;
  let done = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (!collecting) {
      if (char === ']' && !currentSample) {
        done = true;
        remaining = input.slice(index + 1);
        break;
      }
      if (char === '{') {
        collecting = true;
        currentSample = '{';
        depth = 1;
        inString = false;
        escape = false;
      }
      continue;
    }

    if (!(depth === 1 && currentSample === '{' && char === '{')) {
      currentSample += char;
    }

    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const parsed = JSON.parse(currentSample) as ReplaySample;
        samples.push({
          ...parsed,
          stateSnapshot: inflatePersistedReplayState(parsed.stateSnapshot),
        });
        collecting = false;
        currentSample = '';
      }
    }
  }

  if (!done && !collecting) {
    remaining = '';
  } else if (!done && collecting) {
    remaining = '';
  }

  return {
    remaining,
    currentSample,
    depth,
    inString,
    escape,
    done,
  };
}

function serializeReplaySampleForPersistence(sample: ReplaySample): Record<string, unknown> {
  return {
    stateFeatures: sample.stateFeatures,
    perspective: sample.perspective,
    sampleOrigin: sample.sampleOrigin,
    policyTargets: sample.policyTargets,
    valueTarget: sample.valueTarget,
    auxTargets: sample.auxTargets,
    searchMeta: sample.searchMeta,
    stateSnapshot: compactReplayStateForPersistence(sample.stateSnapshot),
  };
}

function compactReplayStateForPersistence(state: GameState): Record<string, unknown> {
  return {
    status: state.status,
    currentTurn: state.currentTurn,
    turnNumber: state.turnNumber,
    settings: state.settings,
    board: state.board,
    whiteHand: state.whiteHand,
    blackHand: state.blackHand,
    whiteQueenPlaced: state.whiteQueenPlaced,
    blackQueenPlaced: state.blackQueenPlaced,
    lastMovedPiece: state.lastMovedPiece,
    winner: state.winner,
  };
}

function inflatePersistedReplayState(raw: GameState | Record<string, unknown>): GameState {
  const value = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const settings = (value.settings && typeof value.settings === 'object')
    ? value.settings as GameState['settings']
    : {
        turnTimerMinutes: 0,
        expansionPieces: {
          ladybug: false,
          mosquito: false,
          pillbug: false,
        },
      };

  return {
    id: typeof value.id === 'string' ? value.id : 'replay-state',
    shortCode: typeof value.shortCode === 'string' ? value.shortCode : 'RPLY',
    status: value.status === 'waiting' || value.status === 'finished' ? value.status : 'playing',
    whitePlayerId: typeof value.whitePlayerId === 'string' ? value.whitePlayerId : null,
    blackPlayerId: typeof value.blackPlayerId === 'string' ? value.blackPlayerId : null,
    currentTurn: value.currentTurn === 'black' ? 'black' : 'white',
    turnNumber: typeof value.turnNumber === 'number' ? value.turnNumber : 1,
    settings,
    board: Array.isArray(value.board) ? value.board as GameState['board'] : [],
    whiteHand: Array.isArray(value.whiteHand) ? value.whiteHand as GameState['whiteHand'] : [],
    blackHand: Array.isArray(value.blackHand) ? value.blackHand as GameState['blackHand'] : [],
    whiteQueenPlaced: value.whiteQueenPlaced === true,
    blackQueenPlaced: value.blackQueenPlaced === true,
    lastMovedPiece: value.lastMovedPiece && typeof value.lastMovedPiece === 'object'
      ? value.lastMovedPiece as GameState['lastMovedPiece']
      : null,
    turnStartedAt: typeof value.turnStartedAt === 'string' ? value.turnStartedAt : null,
    winner: value.winner === 'white' || value.winner === 'black' || value.winner === 'draw'
      ? value.winner
      : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '1970-01-01T00:00:00.000Z',
  };
}

function resolveLearnerModelPath(options: AsyncOptions): string {
  return path.resolve(process.cwd(), options.learnerModelPath);
}

function resolveBestLearnerModelPath(options: AsyncOptions): string {
  return path.resolve(process.cwd(), options.bestLearnerModelPath);
}

function resolveBestLearnerMetaPath(options: AsyncOptions): string {
  return path.resolve(process.cwd(), options.bestLearnerMetaPath);
}

function resolveChampionModelPath(options: AsyncOptions): string {
  return path.resolve(process.cwd(), options.championModelPath);
}

function resolveTrainingModelPath(options: AsyncOptions): string {
  const learnerPath = resolveLearnerModelPath(options);
  if (existsSync(learnerPath)) return learnerPath;
  return resolveChampionModelPath(options);
}

function resolveSelfPlayModelPath(options: AsyncOptions): string {
  return resolveTrainingModelPath(options);
}

function createSelfPlayMixState(replay: ReplayPayload): SelfPlayMixState {
  const counts = countSampleOrigins(replay.samples);
  return {
    learnerStartedChunks: 0,
    championStartedChunks: 0,
    learnerMergedChunks: 0,
    championMergedChunks: 0,
    learnerMergedSamples: counts.learner,
    championMergedSamples: counts.champion,
  };
}

function selectSelfPlaySource(
  options: AsyncOptions,
  budget: ResolvedBudget,
  mixState: SelfPlayMixState,
): { modelPath: string; sampleOrigin: SelfPlaySampleOrigin } {
  const learnerPath = resolveSelfPlayModelPath(options);
  const championPath = resolveChampionModelPath(options);
  if (budget.championSelfplayRatio <= 0 || !existsSync(championPath)) {
    mixState.learnerStartedChunks += 1;
    return { modelPath: learnerPath, sampleOrigin: 'learner' };
  }

  const startedTotal = mixState.learnerStartedChunks + mixState.championStartedChunks;
  const targetChampionStarts = (startedTotal + 1) * budget.championSelfplayRatio;
  if (mixState.championStartedChunks + 1 <= targetChampionStarts + 1e-9) {
    mixState.championStartedChunks += 1;
    return { modelPath: championPath, sampleOrigin: 'champion' };
  }

  mixState.learnerStartedChunks += 1;
  return { modelPath: learnerPath, sampleOrigin: 'learner' };
}

function inferChunkOrigin(
  samples: ReplaySample[],
  summaryOrigin?: SelfPlaySampleOrigin,
): SelfPlaySampleOrigin {
  if (summaryOrigin === 'champion' || summaryOrigin === 'learner') return summaryOrigin;
  for (const sample of samples) {
    if (sample.sampleOrigin === 'champion') return 'champion';
  }
  return 'learner';
}

function noteMergedChunk(
  mixState: SelfPlayMixState,
  sampleOrigin: SelfPlaySampleOrigin,
  incomingSamples: number,
): void {
  if (sampleOrigin === 'champion') {
    mixState.championMergedChunks += 1;
    mixState.championMergedSamples += incomingSamples;
    return;
  }
  mixState.learnerMergedChunks += 1;
  mixState.learnerMergedSamples += incomingSamples;
}

function getSampleOrigin(sample: ReplaySample): SelfPlaySampleOrigin {
  return sample.sampleOrigin === 'champion' ? 'champion' : 'learner';
}

function countSampleOrigins(samples: ReplaySample[]): Record<SelfPlaySampleOrigin, number> {
  let learner = 0;
  let champion = 0;
  for (const sample of samples) {
    if (getSampleOrigin(sample) === 'champion') champion += 1;
    else learner += 1;
  }
  return { learner, champion };
}

function trimReplaySamples(
  samples: ReplaySample[],
  maxSamples: number,
  replayAnchorRatio: number,
): ReplaySample[] {
  if (samples.length <= maxSamples) return samples;

  const anchorRatio = clamp(replayAnchorRatio, 0, 0.8);
  if (anchorRatio <= 0) {
    return samples.slice(Math.max(0, samples.length - maxSamples));
  }

  const indexed = samples.map((sample, index) => ({
    sample,
    index,
    sampleOrigin: getSampleOrigin(sample),
  }));
  const championIndexed = indexed.filter((entry) => entry.sampleOrigin === 'champion');
  const learnerIndexed = indexed.filter((entry) => entry.sampleOrigin === 'learner');
  const championTarget = Math.min(
    championIndexed.length,
    Math.round(maxSamples * anchorRatio),
  );
  const learnerTarget = Math.min(
    learnerIndexed.length,
    maxSamples - championTarget,
  );

  const chosen = [
    ...championIndexed.slice(-championTarget),
    ...learnerIndexed.slice(-learnerTarget),
  ];
  if (chosen.length < maxSamples) {
    const chosenIndexes = new Set(chosen.map((entry) => entry.index));
    const needed = maxSamples - chosen.length;
    const backfill = indexed.filter((entry) => !chosenIndexes.has(entry.index)).slice(-needed);
    chosen.push(...backfill);
  }

  chosen.sort((left, right) => left.index - right.index);
  return chosen.slice(-maxSamples).map((entry) => entry.sample);
}

function seedLearnerModelIfMissing(options: AsyncOptions, logger: MetricsLogger): void {
  const learnerPath = resolveLearnerModelPath(options);
  if (existsSync(learnerPath)) return;

  const championPath = resolveChampionModelPath(options);
  if (!existsSync(championPath)) return;

  mkdirSync(path.dirname(learnerPath), { recursive: true });
  copyFileSync(championPath, learnerPath);
  logger.log('learner_seed', {
    learnerModelPath: learnerPath,
    championModelPath: championPath,
  });
  log('setup', `seeded learner from champion -> ${learnerPath}`);
}

function writeArenaCandidateSnapshot(learnerModelPath: string, candidateSnapshotPath: string): void {
  if (learnerModelPath === candidateSnapshotPath) return;
  mkdirSync(path.dirname(candidateSnapshotPath), { recursive: true });
  copyFileSync(learnerModelPath, candidateSnapshotPath);
}

function readBestLearnerCheckpoint(options: AsyncOptions): BestLearnerCheckpoint | null {
  const metaPath = resolveBestLearnerMetaPath(options);
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as BestLearnerCheckpoint;
    if (
      !parsed
      || typeof parsed.championHash !== 'string'
      || typeof parsed.arenaScore !== 'number'
      || !Number.isFinite(parsed.arenaScore)
      || typeof parsed.savedAt !== 'string'
      || typeof parsed.step !== 'number'
    ) {
      return null;
    }
    return {
      championHash: parsed.championHash,
      arenaScore: parsed.arenaScore,
      savedAt: parsed.savedAt,
      step: parsed.step,
      arenaDecisionReason: typeof parsed.arenaDecisionReason === 'string'
        ? parsed.arenaDecisionReason
        : null,
    };
  } catch {
    return null;
  }
}

function writeBestLearnerCheckpoint(
  options: AsyncOptions,
  checkpoint: BestLearnerCheckpoint,
  sourceModelPath: string,
): void {
  const modelPath = resolveBestLearnerModelPath(options);
  const metaPath = resolveBestLearnerMetaPath(options);
  mkdirSync(path.dirname(modelPath), { recursive: true });
  mkdirSync(path.dirname(metaPath), { recursive: true });
  copyFileSync(sourceModelPath, modelPath);
  writeFileSync(metaPath, `${JSON.stringify(checkpoint)}\n`, 'utf8');
}

function shouldRunArenaForStep(step: number, budget: ResolvedBudget): boolean {
  return budget.arenaIntervalSteps <= 1 || step % budget.arenaIntervalSteps === 0;
}

function resolveBudget(options: AsyncOptions): ResolvedBudget {
  if (!options.adaptiveBudget) return createFixedBudget(options);
  return createAdaptiveBudget(options);
}

function createFixedBudget(options: AsyncOptions): ResolvedBudget {
  const arenaSimulationCap = resolveArenaSimulationCap(options);
  const arenaIntervalSteps = options.arenaIntervalStepsOverride ?? 1;
  const preset = resolveTrainerPreset(options, 'fixed', null, 0);
  return {
    phase: 'fixed',
    adaptiveScore: null,
    presetId: preset.id,
    selfplaySimulations: options.simulations,
    fastSimulations: Math.min(options.fastSimulations, options.simulations),
    fastRatio: options.fastRatio,
    championSelfplayRatio: Math.min(options.championSelfplayRatio, preset.championSelfplayRatio),
    replayAnchorRatio: Math.min(options.replayAnchorRatio, preset.replayAnchorRatio),
    trainerEpochs: preset.epochs,
    trainerLearningRate: preset.learningRate,
    trainerMinNewSamples: Math.max(options.minNewSamples, preset.minNewSamples),
    trainerBatchSize: options.batchSize,
    trainerReanalyseFraction: Math.min(options.reanalyseFraction, preset.reanalyseFraction),
    arenaSimulations: arenaSimulationCap,
    arenaGames: options.arenaGames,
    arenaIntervalSteps,
    selfplaySimulationCap: options.simulations,
    fastSimulationCap: options.fastSimulations,
    arenaSimulationCap,
    arenaGameCap: options.arenaGames,
    championHash: null,
    championPositionSamples: 0,
    championGames: 0,
    totalPromotions: 0,
    championDefenses: 0,
    recentBestScore: null,
    recentMeanScore: null,
    reasons: [`manual caps in use`, `preset=${preset.id}`],
  };
}

function createAdaptiveBudget(options: AsyncOptions): ResolvedBudget {
  const champion = readChampionStatus(options.championModelPath);
  const history = readArenaHistory(options.metricsLogPath, champion.hash);
  const presetStats = readTrainerPresetStats(options.metricsLogPath);
  const arenaSimulationCap = resolveArenaSimulationCap(options);
  const competitionSignal = history.recentScores.length > 0
    ? Math.max(
        history.recentMeanScore ?? 0,
        (history.recentBestScore ?? 0) * 0.85,
      )
    : 0;
  const promotionComponent = clamp(history.totalPromotions / 8, 0, 1) * 0.4;
  const sampleComponent = champion.positionSamples > 0 ? 0.15 : 0;
  const competitionComponent = clamp(
    competitionSignal / Math.max(0.01, options.arenaThreshold),
    0,
    1,
  ) * 0.35;
  const defenseComponent = clamp(history.championDefenses / 8, 0, 1) * 0.1;

  let adaptiveScore = promotionComponent + sampleComponent + competitionComponent + defenseComponent;
  if (
    history.recentBestScore !== null
    && history.recentBestScore >= options.arenaThreshold - 0.05
  ) {
    adaptiveScore += 0.05;
  }
  if (
    history.recentBestScore !== null
    && history.recentBestScore <= options.arenaThreshold - 0.22
    && history.championDefenses >= 3
  ) {
    adaptiveScore -= 0.05;
  }
  adaptiveScore = clamp(adaptiveScore, 0, 1);

  const profile = selectBudgetProfile(adaptiveScore);
  const arenaIntervalSteps = options.arenaIntervalStepsOverride ?? profile.arenaIntervalSteps;
  const preset = resolveTrainerPreset(options, profile.phase, presetStats, history.totalPromotions + history.championDefenses);
  return {
    phase: profile.phase,
    adaptiveScore,
    presetId: preset.id,
    selfplaySimulations: scaleBudget(options.simulations, profile.selfplayScale, 48),
    fastSimulations: Math.min(
      scaleBudget(options.fastSimulations, profile.fastScale, 16),
      scaleBudget(options.simulations, profile.selfplayScale, 48),
    ),
    fastRatio: Math.min(options.fastRatio, profile.fastRatio),
    championSelfplayRatio: Math.min(options.championSelfplayRatio, profile.championSelfplayRatio, preset.championSelfplayRatio),
    replayAnchorRatio: Math.min(options.replayAnchorRatio, profile.replayAnchorRatio, preset.replayAnchorRatio),
    trainerEpochs: preset.epochs,
    trainerLearningRate: preset.learningRate,
    trainerMinNewSamples: Math.max(options.minNewSamples, preset.minNewSamples),
    trainerBatchSize: options.batchSize,
    trainerReanalyseFraction: Math.min(options.reanalyseFraction, preset.reanalyseFraction),
    arenaSimulations: scaleBudget(arenaSimulationCap, profile.arenaScale, 64),
    arenaGames: scaleBudget(options.arenaGames, profile.arenaGameScale, 20),
    arenaIntervalSteps,
    selfplaySimulationCap: options.simulations,
    fastSimulationCap: options.fastSimulations,
    arenaSimulationCap,
    arenaGameCap: options.arenaGames,
    championHash: champion.hash,
    championPositionSamples: champion.positionSamples,
    championGames: champion.games,
    totalPromotions: history.totalPromotions,
    championDefenses: history.championDefenses,
    recentBestScore: history.recentBestScore,
    recentMeanScore: history.recentMeanScore,
    reasons: [
      `promotions=${history.totalPromotions}`,
      `champion_defenses=${history.championDefenses}`,
      `recent_best=${formatMaybePercent(history.recentBestScore)}`,
      `recent_mean=${formatMaybePercent(history.recentMeanScore)}`,
      `score=${adaptiveScore.toFixed(3)}`,
      `preset=${preset.id}`,
    ],
  };
}

function readChampionStatus(modelPath: string): ChampionStatus {
  const absolutePath = path.resolve(process.cwd(), modelPath);
  if (!existsSync(absolutePath)) {
    return {
      hash: null,
      positionSamples: 0,
      games: 0,
      generatedAt: null,
    };
  }

  try {
    const raw = readFileSync(absolutePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      training?: {
        positionSamples?: unknown;
        games?: unknown;
        generatedAt?: unknown;
      };
    };
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12);
    return {
      hash,
      positionSamples: asNonNegativeNumber(parsed.training?.positionSamples),
      games: asNonNegativeNumber(parsed.training?.games),
      generatedAt: typeof parsed.training?.generatedAt === 'string'
        ? parsed.training.generatedAt
        : null,
    };
  } catch {
    return {
      hash: null,
      positionSamples: 0,
      games: 0,
      generatedAt: null,
    };
  }
}

function acquireSingleInstanceLock(lockPath: string, label: string): () => void {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    try {
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as ProcessLockRecord;
      if (
        parsed
        && typeof parsed.pid === 'number'
        && Number.isFinite(parsed.pid)
        && parsed.pid > 0
        && isProcessAlive(parsed.pid)
      ) {
        throw new Error(`${label} is already running under pid=${parsed.pid}`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('already running')) {
        throw error;
      }
    }
    rmSync(lockPath, { force: true });
  }

  const record: ProcessLockRecord = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    command: process.argv.join(' '),
  };
  writeFileSync(lockPath, `${JSON.stringify(record)}\n`, 'utf8');

  let released = false;
  return () => {
    if (released) return;
    released = true;
    rmSync(lockPath, { force: true });
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readArenaHistory(metricsLogPath: string, championHash: string | null): ArenaHistorySnapshot {
  const absolutePath = path.resolve(process.cwd(), metricsLogPath);
  if (!existsSync(absolutePath)) {
    return {
      totalPromotions: 0,
      championDefenses: 0,
      recentScores: [],
      recentBestScore: null,
      recentMeanScore: null,
    };
  }

  let totalPromotions = 0;
  const scoresAgainstChampion: number[] = [];

  try {
    const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.eventType !== 'promotion_decision') continue;
      if (parsed.promoted === true) totalPromotions += 1;
      if (!championHash || parsed.championHash !== championHash) continue;
      const score = typeof parsed.candidateScore === 'number' ? parsed.candidateScore : null;
      if (score !== null) scoresAgainstChampion.push(score);
    }
  } catch {
    return {
      totalPromotions,
      championDefenses: 0,
      recentScores: [],
      recentBestScore: null,
      recentMeanScore: null,
    };
  }

  const recentScores = scoresAgainstChampion.slice(-6);
  const recentBestScore = recentScores.length > 0 ? Math.max(...recentScores) : null;
  const recentMeanScore = recentScores.length > 0
    ? recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length
    : null;

  return {
    totalPromotions,
    championDefenses: scoresAgainstChampion.length,
    recentScores,
    recentBestScore,
    recentMeanScore,
  };
}

function readTrainerPresetStats(metricsLogPath: string): Map<string, TrainerPresetStat> {
  const absolutePath = path.resolve(process.cwd(), metricsLogPath);
  const stats = new Map<string, TrainerPresetStat>();
  if (!existsSync(absolutePath)) return stats;

  try {
    const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.eventType !== 'async_arena_result') continue;
      const presetId = typeof parsed.presetId === 'string' ? parsed.presetId : null;
      if (!presetId) continue;
      const score = typeof parsed.arenaScore === 'number' ? parsed.arenaScore : null;
      const ciLow = typeof parsed.finalScoreCiLow === 'number' ? parsed.finalScoreCiLow : score;
      const severeFailure = parsed.finalSevereFailure === true;
      const promoted = parsed.promoted === true;
      const entry = stats.get(presetId) ?? {
        presetId,
        runs: 0,
        promotions: 0,
        severeFailures: 0,
        scoreSum: 0,
        lowerBoundSum: 0,
      };
      entry.runs += 1;
      if (promoted) entry.promotions += 1;
      if (severeFailure) entry.severeFailures += 1;
      if (score !== null) entry.scoreSum += score;
      if (ciLow !== null) entry.lowerBoundSum += ciLow;
      stats.set(presetId, entry);
    }
  } catch {
    return stats;
  }

  return stats;
}

function resolveTrainerPreset(
  options: AsyncOptions,
  phase: AdaptiveBudgetPhase,
  stats: Map<string, TrainerPresetStat> | null,
  rotationSeed: number,
): TrainerPreset {
  if (options.trainerPreset !== 'auto') {
    return TRAINER_PRESET_CATALOG[options.trainerPreset] ?? TRAINER_PRESET_CATALOG.balanced;
  }

  const profile = ADAPTIVE_BUDGET_PROFILES.find((entry) => entry.phase === phase) ?? null;
  const presetIds = profile?.presetIds ?? ['balanced'];
  if (!options.tuningMode || !stats || presetIds.length === 1) {
    const deterministicIndex = Math.abs(rotationSeed) % presetIds.length;
    return TRAINER_PRESET_CATALOG[presetIds[deterministicIndex]] ?? TRAINER_PRESET_CATALOG.balanced;
  }

  let bestPreset = TRAINER_PRESET_CATALOG[presetIds[0]] ?? TRAINER_PRESET_CATALOG.balanced;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const presetId of presetIds) {
    const preset = TRAINER_PRESET_CATALOG[presetId];
    if (!preset) continue;
    const entry = stats.get(presetId);
    if (!entry || entry.runs < 2) {
      const explorationScore = 0.25 - (entry?.runs ?? 0) * 0.05;
      if (explorationScore > bestScore) {
        bestPreset = preset;
        bestScore = explorationScore;
      }
      continue;
    }
    const promotionRate = entry.promotions / Math.max(1, entry.runs);
    const avgScore = entry.scoreSum / Math.max(1, entry.runs);
    const avgLowerBound = entry.lowerBoundSum / Math.max(1, entry.runs);
    const severeFailureRate = entry.severeFailures / Math.max(1, entry.runs);
    const weightedScore = promotionRate * 0.45 + avgScore * 0.2 + avgLowerBound * 0.3 - severeFailureRate * 0.55;
    if (weightedScore > bestScore) {
      bestPreset = preset;
      bestScore = weightedScore;
    }
  }
  return bestPreset;
}

function resolveArenaSimulationCap(options: AsyncOptions): number {
  return options.arenaSimulations ?? DEFAULT_ARENA_SIMULATIONS_BY_DIFFICULTY[options.difficulty];
}

function selectBudgetProfile(adaptiveScore: number): BudgetProfile {
  if (adaptiveScore < 0.18) return ADAPTIVE_BUDGET_PROFILES[0];
  if (adaptiveScore < 0.38) return ADAPTIVE_BUDGET_PROFILES[1];
  if (adaptiveScore < 0.64) return ADAPTIVE_BUDGET_PROFILES[2];
  if (adaptiveScore < 0.84) return ADAPTIVE_BUDGET_PROFILES[3];
  return ADAPTIVE_BUDGET_PROFILES[4];
}

function scaleBudget(cap: number, scale: number, floor: number): number {
  return Math.max(1, Math.min(cap, Math.max(Math.min(cap, floor), Math.round(cap * scale))));
}

function sameBudget(left: ResolvedBudget, right: ResolvedBudget): boolean {
  return left.phase === right.phase
    && left.presetId === right.presetId
    && left.selfplaySimulations === right.selfplaySimulations
    && left.fastSimulations === right.fastSimulations
    && left.fastRatio === right.fastRatio
    && left.championSelfplayRatio === right.championSelfplayRatio
    && left.replayAnchorRatio === right.replayAnchorRatio
    && left.trainerEpochs === right.trainerEpochs
    && left.trainerLearningRate === right.trainerLearningRate
    && left.trainerMinNewSamples === right.trainerMinNewSamples
    && left.trainerBatchSize === right.trainerBatchSize
    && left.trainerReanalyseFraction === right.trainerReanalyseFraction
    && left.arenaSimulations === right.arenaSimulations
    && left.arenaGames === right.arenaGames
    && left.arenaIntervalSteps === right.arenaIntervalSteps
    && left.championHash === right.championHash;
}

function serializeBudget(budget: ResolvedBudget, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ...extra,
    phase: budget.phase,
    adaptiveScore: budget.adaptiveScore,
    presetId: budget.presetId,
    selfplaySimulations: budget.selfplaySimulations,
    fastSimulations: budget.fastSimulations,
    fastRatio: budget.fastRatio,
    championSelfplayRatio: budget.championSelfplayRatio,
    replayAnchorRatio: budget.replayAnchorRatio,
    trainerEpochs: budget.trainerEpochs,
    trainerLearningRate: budget.trainerLearningRate,
    trainerMinNewSamples: budget.trainerMinNewSamples,
    trainerBatchSize: budget.trainerBatchSize,
    trainerReanalyseFraction: budget.trainerReanalyseFraction,
    arenaSimulations: budget.arenaSimulations,
    arenaGames: budget.arenaGames,
    arenaIntervalSteps: budget.arenaIntervalSteps,
    selfplaySimulationCap: budget.selfplaySimulationCap,
    fastSimulationCap: budget.fastSimulationCap,
    arenaSimulationCap: budget.arenaSimulationCap,
    arenaGameCap: budget.arenaGameCap,
    championHash: budget.championHash,
    championPositionSamples: budget.championPositionSamples,
    championGames: budget.championGames,
    totalPromotions: budget.totalPromotions,
    championDefenses: budget.championDefenses,
    recentBestScore: budget.recentBestScore,
    recentMeanScore: budget.recentMeanScore,
    reasons: budget.reasons,
  };
}

function formatBudget(budget: ResolvedBudget): string {
  const score = budget.adaptiveScore === null ? 'manual' : budget.adaptiveScore.toFixed(3);
  return `phase=${budget.phase} preset=${budget.presetId} score=${score} train=${budget.trainerEpochs}e@${budget.trainerLearningRate.toFixed(5)} min_new=${budget.trainerMinNewSamples} selfplay=${budget.selfplaySimulations}/${budget.fastSimulations}@${budget.fastRatio.toFixed(2)} champion_mix=${Math.round(budget.championSelfplayRatio * 100)}% replay_anchor=${Math.round(budget.replayAnchorRatio * 100)}% arena=${budget.arenaSimulations}x${budget.arenaGames}/every${budget.arenaIntervalSteps} reasons=${budget.reasons.join(' ')}`;
}

function asNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatMaybePercent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createRemoteSelfPlaySlots(remoteWorkers: RemoteWorkerSpec[]): RemoteSelfPlaySlot[] {
  const slots: RemoteSelfPlaySlot[] = [];
  for (const spec of remoteWorkers) {
    const specKey = makeRemoteWorkerSpecKey(spec);
    for (let index = 0; index < spec.workers; index += 1) {
      const slotNumber = index + 1;
      slots.push({
        slotId: `${specKey}::${slotNumber}`,
        label: `${spec.host}#${slotNumber}`,
        spec,
        specKey,
      });
    }
  }
  return slots;
}

function countActiveWorkersByTransport(
  activeWorkers: Map<number, ActiveWorker>,
  transport: ActiveWorker['transport'],
): number {
  let count = 0;
  for (const worker of activeWorkers.values()) {
    if (worker.transport === transport) count += 1;
  }
  return count;
}

function countDisabledRemoteSelfPlaySlots(
  remoteSelfPlaySlots: RemoteSelfPlaySlot[],
  disabledRemoteSelfPlaySpecs: Set<string>,
): number {
  return remoteSelfPlaySlots.reduce(
    (sum, slot) => sum + (disabledRemoteSelfPlaySpecs.has(slot.specKey) ? 1 : 0),
    0,
  );
}

function countAvailableRemoteSelfPlaySlots(
  remoteSelfPlaySlots: RemoteSelfPlaySlot[],
  disabledRemoteSelfPlaySpecs: Set<string>,
): number {
  return remoteSelfPlaySlots.length - countDisabledRemoteSelfPlaySlots(remoteSelfPlaySlots, disabledRemoteSelfPlaySpecs);
}

function selectAvailableRemoteSelfPlaySlot(
  remoteSelfPlaySlots: RemoteSelfPlaySlot[],
  activeWorkers: Map<number, ActiveWorker>,
  disabledRemoteSelfPlaySpecs: Set<string>,
): RemoteSelfPlaySlot | null {
  const activeSlotIds = new Set(
    Array.from(activeWorkers.values())
      .map((worker) => worker.remoteSlotId)
      .filter((slotId): slotId is string => Boolean(slotId)),
  );
  for (const slot of remoteSelfPlaySlots) {
    if (disabledRemoteSelfPlaySpecs.has(slot.specKey)) continue;
    if (activeSlotIds.has(slot.slotId)) continue;
    return slot;
  }
  return null;
}

function logActiveSelfPlayWorkers(
  activeWorkers: Map<number, ActiveWorker>,
  remoteSelfPlaySlots: RemoteSelfPlaySlot[],
  disabledRemoteSelfPlaySpecs: Set<string>,
  caps: {
    localCap: number;
    remoteCap: number;
  },
  previous: {
    activeLocalWorkers: number;
    activeRemoteSlots: number;
    localCap: number;
    remoteCap: number;
    configuredRemoteSlots: number;
    disabledRemoteSlots: number;
  },
): void {
  const activeLocalWorkers = countActiveWorkersByTransport(activeWorkers, 'local');
  const activeRemoteSlots = countActiveWorkersByTransport(activeWorkers, 'remote');
  const disabledRemoteSlots = countDisabledRemoteSelfPlaySlots(remoteSelfPlaySlots, disabledRemoteSelfPlaySpecs);
  if (
    previous.activeLocalWorkers === activeLocalWorkers
    && previous.activeRemoteSlots === activeRemoteSlots
    && previous.localCap === caps.localCap
    && previous.remoteCap === caps.remoteCap
    && previous.disabledRemoteSlots === disabledRemoteSlots
  ) {
    return;
  }
  previous.activeLocalWorkers = activeLocalWorkers;
  previous.activeRemoteSlots = activeRemoteSlots;
  previous.localCap = caps.localCap;
  previous.remoteCap = caps.remoteCap;
  previous.disabledRemoteSlots = disabledRemoteSlots;

  log(
    'selfplay',
    `active_local_workers=${activeLocalWorkers}/${caps.localCap} active_remote_slots=${activeRemoteSlots}/${caps.remoteCap} configured_remote_slots=${previous.configuredRemoteSlots} disabled_remote_slots=${disabledRemoteSlots}`,
  );
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
      case '--fast-ratio': options.fastRatio = parseRatioZeroOne(next, arg); index += 1; break;
      case '--champion-selfplay-ratio': options.championSelfplayRatio = parseRatioZeroOne(next, arg); index += 1; break;
      case '--replay-anchor-ratio': options.replayAnchorRatio = parseRatioZeroOne(next, arg); index += 1; break;
      case '--replay-path': if (!next) throw new Error('Missing value for --replay-path'); options.replayPath = next; index += 1; break;
      case '--replay-max-samples': options.replayMaxSamples = parsePositiveInt(next, arg); index += 1; break;
      case '--reanalyse-fraction': options.reanalyseFraction = parseRatioZeroOne(next, arg); index += 1; break;
      case '--reanalyse-workers': options.reanalyseWorkers = parsePositiveInt(next, arg); index += 1; break;
      case '--train-interval-seconds': options.trainIntervalSeconds = parsePositiveInt(next, arg); index += 1; break;
      case '--min-replay-samples': options.minReplaySamples = parsePositiveInt(next, arg); index += 1; break;
      case '--min-new-samples': options.minNewSamples = parsePositiveInt(next, arg); index += 1; break;
      case '--min-arena-replay-samples': options.minArenaReplaySamples = parsePositiveInt(next, arg); index += 1; break;
      case '--trainer-preset': if (!next) throw new Error('Missing value for --trainer-preset'); options.trainerPreset = next; index += 1; break;
      case '--tuning-mode': options.tuningMode = true; break;
      case '--no-tuning-mode': options.tuningMode = false; break;
      case '--epochs': options.epochs = parsePositiveInt(next, arg); index += 1; break;
      case '--batch-size': options.batchSize = parsePositiveInt(next, arg); index += 1; break;
      case '--lr': options.learningRate = parsePositiveFloat(next, arg); index += 1; break;
      case '--weight-decay': options.weightDecay = parseNonNegativeFloat(next, arg); index += 1; break;
      case '--policy-target-temperature': options.policyTargetTemperature = parseRange(next, arg, 0.01, 1); index += 1; break;
      case '--label-smoothing': options.labelSmoothing = parseRange(next, arg, 0, 0.5); index += 1; break;
      case '--hidden': if (!next) throw new Error('Missing value for --hidden'); options.hidden = next; index += 1; break;
      case '--learner-model': if (!next) throw new Error('Missing value for --learner-model'); options.learnerModelPath = next; index += 1; break;
      case '--candidate-out': if (!next) throw new Error('Missing value for --candidate-out'); options.candidateOutPath = next; index += 1; break;
      case '--champion-model': if (!next) throw new Error('Missing value for --champion-model'); options.championModelPath = next; index += 1; break;
      case '--promote-out': if (!next) throw new Error('Missing value for --promote-out'); options.promoteOutPath = next; index += 1; break;
      case '--arena-simulations': options.arenaSimulations = parsePositiveInt(next, arg); index += 1; break;
      case '--arena-games': options.arenaGames = parsePositiveInt(next, arg); index += 1; break;
      case '--arena-threshold': options.arenaThreshold = parseRatio(next, arg); index += 1; break;
      case '--arena-gate-mode': options.arenaGateMode = parseGateMode(next); index += 1; break;
      case '--arena-sprt-alpha': options.arenaSprtAlpha = parseRange(next, arg, 1e-6, 0.5); index += 1; break;
      case '--arena-sprt-beta': options.arenaSprtBeta = parseRange(next, arg, 1e-6, 0.5); index += 1; break;
      case '--arena-sprt-margin': options.arenaSprtMargin = parseRange(next, arg, 1e-3, 0.4); index += 1; break;
      case '--arena-confidence-level': options.arenaConfidenceLevel = parseRange(next, arg, 0.5, 0.999); index += 1; break;
      case '--arena-workers': options.arenaWorkers = parsePositiveInt(next, arg); index += 1; break;
      case '--arena-remote-worker':
        if (!next) throw new Error('Missing value for --arena-remote-worker');
        options.arenaRemoteWorkers = [...options.arenaRemoteWorkers, parseRemoteWorkerSpec(next, '--arena-remote-worker')];
        index += 1;
        break;
      case '--selfplay-remote-worker':
        if (!next) throw new Error('Missing value for --selfplay-remote-worker');
        options.selfplayRemoteWorkers = [...options.selfplayRemoteWorkers, parseRemoteWorkerSpec(next, '--selfplay-remote-worker')];
        index += 1;
        break;
      case '--arena-stage2': options.arenaStage2Enabled = true; break;
      case '--no-arena-stage2': options.arenaStage2Enabled = false; break;
      case '--arena-stage2-trigger-margin': options.arenaStage2TriggerMargin = parseRange(next, arg, 0.01, 0.2); index += 1; break;
      case '--arena-stage2-sim-scale': options.arenaStage2SimulationScale = parseRange(next, arg, 1, 4); index += 1; break;
      case '--arena-stage2-game-scale': options.arenaStage2GameScale = parseRange(next, arg, 1, 4); index += 1; break;
      case '--arena-interval-steps': options.arenaIntervalStepsOverride = parsePositiveInt(next, arg); index += 1; break;
      case '--rebase-on-failed-arena': options.rebaseOnFailedArena = true; break;
      case '--no-rebase-on-failed-arena': options.rebaseOnFailedArena = false; break;
      case '--rebase-fail-threshold': options.rebaseFailThreshold = parseRatio(next, arg); index += 1; break;
      case '--rebase-failure-streak': options.rebaseFailureStreak = parsePositiveInt(next, arg); index += 1; break;
      case '--best-checkpoint-score-floor': options.bestCheckpointScoreFloor = parseRatioZeroOne(next, arg); index += 1; break;
      case '--best-checkpoint-regression-tolerance': options.bestCheckpointRegressionTolerance = parseRatioZeroOne(next, arg); index += 1; break;
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
      case '--notify-arena': options.notifyArenaResults = true; break;
      case '--no-notify-arena': options.notifyArenaResults = false; break;
      case '--continue-on-error': options.continueOnError = true; break;
      case '--stop-on-error': options.continueOnError = false; break;
      case '--adaptive-budget': options.adaptiveBudget = true; break;
      case '--fixed-budget': options.adaptiveBudget = false; break;
      case '--persistent-trainer': options.persistentTrainer = true; break;
      case '--no-persistent-trainer': options.persistentTrainer = false; break;
      case '--search-backend':
        options.searchBackend = parseSearchBackend(next);
        index += 1;
        break;
      case '--gpu-games-in-flight':
        options.gpuGamesInFlight = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gpu-workers':
        options.searchBackend = 'gpu-batched';
        options.gpuWorkers = true;
        break;
      case '--no-gpu-workers':
        options.searchBackend = 'cpu';
        options.gpuWorkers = false;
        break;
      case '--gpu-batch-size': options.gpuBatchSize = parsePositiveInt(next, arg); index += 1; break;
      case '--gpu-batch-delay-ms': options.gpuBatchDelayMs = parsePositiveInt(next, arg); index += 1; break;
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
  options.arenaWorkers = Math.max(1, options.arenaWorkers);
  options.gpuGamesInFlight = Math.max(1, options.gpuGamesInFlight);
  options.gpuWorkers = options.searchBackend === 'gpu-batched';
  options.arenaRemoteWorkers = aggregateRemoteWorkerSpecs(options.arenaRemoteWorkers);
  options.selfplayRemoteWorkers = aggregateRemoteWorkerSpecs(options.selfplayRemoteWorkers);
  options.minArenaReplaySamples = Math.max(options.minReplaySamples, options.minArenaReplaySamples);
  if (options.trainerPreset !== 'auto' && !TRAINER_PRESET_CATALOG[options.trainerPreset]) {
    throw new Error(`Invalid --trainer-preset value: ${options.trainerPreset}`);
  }
  return options;
}

function safeReadFileSize(absolutePath: string): number {
  try {
    return readFileSync(absolutePath).length;
  } catch {
    return 0;
  }
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseGateMode(value: string | undefined): ArenaGateMode {
  if (value === 'fixed' || value === 'sprt') return value;
  throw new Error(`Invalid --arena-gate-mode value: ${value}`);
}

function parseSearchBackend(value: string | undefined): SearchBackend {
  if (value === 'cpu' || value === 'gpu-batched') return value;
  throw new Error(`Invalid --search-backend value: ${value}`);
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
  console.log('  --champion-selfplay-ratio <0..1> --replay-anchor-ratio <0..1>');
  console.log('                                 With adaptive budgets on, sims are caps and fast-ratio is a ceiling');
  console.log('  --replay-path <path> --replay-max-samples <n>');
  console.log('  --reanalyse-fraction <0..1> --reanalyse-workers <n>');
  console.log('  --train-interval-seconds <n> --min-replay-samples <n> --min-new-samples <n>');
  console.log('  --trainer-preset <auto|exploratory|balanced|conservative|late-validation> --tuning-mode');
  console.log('  --epochs <n> --batch-size <n> --lr <v> --weight-decay <v> --hidden <csv>');
  console.log('  --learner-model <path> --candidate-out <path> --champion-model <path> --promote-out <path>');
  console.log('  --arena-simulations <n> --arena-games <n> --arena-threshold <0..1>');
  console.log('  --arena-workers <n> --arena-remote-worker <host=...,repo=...,workers=...>');
  console.log('  --selfplay-remote-worker <host=...,repo=...,workers=...>');
  console.log('  --arena-stage2 --no-arena-stage2 --arena-stage2-trigger-margin <0.01..0.2>');
  console.log('  --arena-stage2-sim-scale <1..4> --arena-stage2-game-scale <1..4>');
  console.log('  --arena-interval-steps <n>     Override train steps between arena checks');
  console.log('  --arena-gate-mode <fixed|sprt> --adaptive-budget --fixed-budget');
  console.log('  --rebase-on-failed-arena --no-rebase-on-failed-arena --rebase-fail-threshold <0..1>');
  console.log('  --rebase-failure-streak <n>    Severe failures before learner reset (default: 1)');
  console.log('  --best-checkpoint-score-floor <0..1> --best-checkpoint-regression-tolerance <0..1>');
  console.log('  --persistent-trainer --no-persistent-trainer');
  console.log('  --search-backend <cpu|gpu-batched>  Self-play backend (default: gpu-batched)');
  console.log('  --gpu-games-in-flight <n>          Concurrent GPU self-play games inside one local worker');
  console.log('  --gpu-workers --no-gpu-workers  Use GPU-accelerated self-play workers');
  console.log('  --gpu-batch-size <n>            Shared GPU inference max batch size (default: auto)');
  console.log('  --gpu-batch-delay-ms <n>        Shared GPU inference batch delay (default: auto)');
  console.log('  --deploy-on-promotion --no-deploy-on-promotion');
  console.log('  --deploy-after-arena --no-deploy-after-arena --deploy-command <cmd>');
  console.log('  --notify-arena --no-notify-arena');
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
    requestInterrupt('signal received');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const type = 'type' in message ? (message as { type?: unknown }).type : null;
    if (type === 'watch-restart') {
      requestInterrupt('watch restart requested');
    } else if (type === 'watch-shutdown') {
      requestInterrupt('watch shutdown requested');
    }
  });
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

function serializeTrainerSample(sample: ReplaySample): Record<string, unknown> {
  return {
    stateFeatures: sample.stateFeatures,
    perspective: sample.perspective,
    sampleOrigin: sample.sampleOrigin === 'champion' ? 'champion' : 'learner',
    policyTargets: sample.policyTargets.map((target) => ({
      probability: target.probability,
      actionFeatures: target.actionFeatures,
    })),
    valueTarget: sample.valueTarget,
    auxTargets: sample.auxTargets,
  };
}

function runCommand(
  command: string,
  args: string[],
  options?: {
    stdio?: 'inherit' | 'ignore' | 'pipe';
    streamStdout?: boolean;
    streamStderr?: boolean;
    captureLimit?: number;
    timeoutMs?: number;
  },
): Promise<CommandResult> {
  const stdio = options?.stdio ?? 'inherit';
  const captureLimit = Math.max(8 * 1024, options?.captureLimit ?? 256 * 1024);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio,
      shell: false,
    });
    let settled = false;
    const timeoutMs = options?.timeoutMs ?? 0;
    const timeoutHandle = timeoutMs > 0 ? setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs) : null;
    let stdout = '';
    let stderr = '';
    if (stdio === 'pipe') {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout = appendCapturedOutput(stdout, chunk, captureLimit);
        if (options?.streamStdout) process.stdout.write(chunk);
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr = appendCapturedOutput(stderr, chunk, captureLimit);
        if (options?.streamStderr) process.stderr.write(chunk);
      });
    }
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const result: CommandResult = {
        code: code ?? 1,
        stdout,
        stderr,
      };
      if (result.code !== 0) {
        const stderrTail = result.stderr.trim();
        const suffix = stderrTail.length > 0 ? `: ${stderrTail}` : '';
        reject(new Error(`${command} ${args.join(' ')} exited with code ${result.code}${suffix}`));
        return;
      }
      resolve(result);
    });
  });
}

function computeReanalyseWorkerTimeoutMs(sampleCount: number): number {
  return clamp(
    sampleCount * REANALYSE_WORKER_TIMEOUT_PER_SAMPLE_MS,
    REANALYSE_WORKER_TIMEOUT_MIN_MS,
    REANALYSE_WORKER_TIMEOUT_MAX_MS,
  );
}

function computePersistentReplayReplaceTimeoutMs(sampleCount: number): number {
  return clamp(
    Math.round(PERSISTENT_TRAINER_REPLAY_REPLACE_TIMEOUT_MIN_MS + sampleCount * 1.5),
    PERSISTENT_TRAINER_REPLAY_REPLACE_TIMEOUT_MIN_MS,
    PERSISTENT_TRAINER_REPLAY_REPLACE_TIMEOUT_MAX_MS,
  );
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

async function spawnPythonProcessWithFallback(args: string[]): Promise<ChildProcess> {
  const pythonCommands = getPreferredPythonCommands();

  let lastError: Error | null = null;
  for (const command of pythonCommands) {
    try {
      return await spawnProcess(command, args);
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const message = normalized.message;
      if (!/ENOENT/i.test(message) && !/not recognized/i.test(message)) {
        throw normalized;
      }
      lastError = normalized;
    }
  }

  if (process.platform === 'win32') {
    return spawnProcess('py', args);
  }

  throw lastError ?? new Error('Unable to locate a usable Python interpreter');
}

function spawnProcess(command: string, args: string[]): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });

    const onError = (error: Error): void => {
      reject(error);
    };

    child.once('error', onError);
    child.once('spawn', () => {
      child.off('error', onError);
      resolve(child);
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

function notifyArenaResult(
  options: AsyncOptions,
  input: {
    step: number;
    phase: AdaptiveBudgetPhase;
    promoted: boolean;
    score: number | null;
    decisionReason: string | null;
    recoveryAction: LearnerRecoveryAction;
  },
): void {
  if (!options.notifyArenaResults || process.platform !== 'win32') return;

  const title = input.promoted ? 'Hive Arena Success' : 'Hive Arena Failed';
  const scoreText = formatMaybePercent(input.score);
  const recoverySuffix = input.recoveryAction !== 'none'
    ? `, ${input.recoveryAction}`
    : '';
  const reason = input.decisionReason ?? 'unknown';
  const body = `Step ${input.step} ${input.promoted ? 'promoted' : 'failed'} at ${scoreText} in ${input.phase} (${reason}${recoverySuffix})`;
  const sound = input.promoted ? 'Asterisk' : 'Hand';
  const toolTipIcon = input.promoted ? 'Info' : 'Warning';
  const systemIcon = input.promoted ? 'Information' : 'Warning';

  const script = [
    'try {',
    'Add-Type -AssemblyName System.Windows.Forms;',
    'Add-Type -AssemblyName System.Drawing;',
    `[System.Media.SystemSounds]::${sound}.Play();`,
    '$notification = New-Object System.Windows.Forms.NotifyIcon;',
    `$notification.Icon = [System.Drawing.SystemIcons]::${systemIcon};`,
    `$notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::${toolTipIcon};`,
    `$notification.BalloonTipTitle = '${escapePowerShellSingleQuoted(title)}';`,
    `$notification.BalloonTipText = '${escapePowerShellSingleQuoted(body)}';`,
    '$notification.Visible = $true;',
    '$notification.ShowBalloonTip(5000);',
    'Start-Sleep -Milliseconds 5500;',
    '$notification.Dispose();',
    '} catch { }',
  ].join(' ');

  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encoded,
    ], {
      cwd: process.cwd(),
      stdio: 'ignore',
      detached: true,
      shell: false,
    });
    child.unref();
  } catch {
    // Ignore local notification failures and keep training.
  }
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
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

function formatProgressBar(ratio: number, width = 12): string {
  const clamped = clamp(ratio, 0, 1);
  const filled = Math.round(clamped * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}]${Math.round(clamped * 100)}%`;
}

function log(stage: string, message: string): void {
  const clock = new Date().toISOString().slice(11, 19);
  console.log(`[${clock}] [az-async:${stage}] ${message}`);
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
