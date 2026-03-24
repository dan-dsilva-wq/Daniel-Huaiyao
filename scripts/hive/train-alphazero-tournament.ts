import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { HiveComputerDifficulty, HiveSearchStats } from '../../lib/hive/ai';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  getLegalMovesForColor,
  oppositeColor,
} from '../../lib/hive/ai';
import {
  HIVE_ACTION_FEATURE_NAMES,
  HIVE_DEFAULT_TOKEN_SLOTS,
  buildHiveTokenStateFeatureNames,
  parseHiveModel,
  type HiveModel,
} from '../../lib/hive/ml';
import type { GameState, Move, PlayerColor } from '../../lib/hive/types';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import { getHiveHardwareProfile } from './hardware-profile';
import { GpuInferenceClient } from './gpu-inference-client';
import { runGpuMctsSearch } from './gpu-mcts';
import {
  aggregateRemoteWorkerSpecs,
  buildRemoteNodeTsxSshArgs,
  countRemoteWorkerSlots,
  formatRemoteWorkerSummary,
  parseRemoteWorkerSpec,
  type RemoteWorkerSpec,
} from './remote-worker';
import { publishHiveMetricsSnapshotSafely } from './sharedMetrics';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

type MatchSource = 'seed' | 'winner';
type MatchStatus = 'pending' | 'bye' | 'completed';
type ChallengeStatus = 'pending' | 'completed';
type TrainerBackend = 'multiprocess' | 'single-process';
type SearchBackend = 'cpu' | 'gpu-batched' | 'python-batched';

interface TournamentOptions {
  candidateCount: number;
  seedBase: number;
  tournamentSeed: number;
  splitSeed: number;
  runId: string | null;
  resume: boolean;
  finalistCount: number;
  drawReplayLimit: number;
  drawEscalationGames: number;
  drawEscalationMaxGames: number;
  trainerBackend: TrainerBackend;
  multiCandidateCount: number;
  checkpointEveryEpoch: boolean;
  targetGpuUtilization: number | null;
  searchBackend: SearchBackend;
  gpuArenaGamesInFlight: number;
  gpuInferenceMaxBatchSize: number;
  gpuInferenceBatchDelayMs: number;
  knockoutSimulations: number | null;
  knockoutWorkers: number;
  knockoutRemoteWorkers: RemoteWorkerSpec[];
  trainConcurrency: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
  initModelPath: string;
  championModelPath: string;
  replayPath: string;
  reanalyseFraction: number;
  reanalyseWorkers: number;
  reanalyseFastSimulations: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
  weightDecay: number;
  policyTargetTemperature: number;
  labelSmoothing: number;
  candidateTrainFraction: number;
  candidateLabelSmoothingJitter: number;
  candidateInitNoiseStd: number;
  hidden: string;
  trainerDevice: string;
  metricsLogPath: string;
  promoteOutPath: string;
  finalArenaArgs: string[];
  continuous: boolean;
  dryRun: boolean;
  verbose: boolean;
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

interface FrozenSnapshot {
  initModelSourcePath: string;
  championSourcePath: string;
  frozenInitModelPath: string;
  frozenChampionModelPath: string;
  frozenReplayPath: string;
  frozenDatasetPath: string;
  initModelHash: string;
  championModelHash: string;
  replaySampleCount: number;
  reanalysedSamples: number;
}

interface TournamentManifest {
  version: number;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'failed' | 'completed';
  workspacePath: string;
  config: TournamentOptions;
  frozenSnapshot: FrozenSnapshot | null;
  candidates: TournamentCandidate[];
  finalists: number[];
  winnerCandidateIndex: number | null;
  runnerUpCandidateIndex: number | null;
  bronzeCandidateIndex: number | null;
  championChallenges: ChampionChallenge[];
  promotedCandidateIndex: number | null;
  promotionApplied: boolean;
  lastError: string | null;
}

interface TournamentCandidate {
  index: number;
  seed: number;
  trainSampleFraction: number;
  trainSampleSeed: number;
  labelSmoothing: number;
  initNoiseStd: number;
  initNoiseSeed: number;
  outputPath: string;
  status: 'pending' | 'trained' | 'failed';
  runId: string | null;
  modelHash: string | null;
  trainCount: number | null;
  valCount: number | null;
  trainLoss: number | null;
  valLoss: number | null;
  elapsedSeconds: number | null;
  error: string | null;
  checkpointPath: string | null;
  epochsCompleted: number;
  checkpointUpdatedAt: string | null;
}

interface TournamentBracket {
  version: number;
  runId: string;
  slotCount: number;
  slots: Array<number | null>;
  rounds: TournamentRound[];
  bronzeMatch: TournamentMatch | null;
}

interface TournamentRound {
  roundNumber: number;
  name: string;
  matches: TournamentMatch[];
}

interface TournamentMatch {
  id: string;
  roundNumber: number;
  matchIndex: number;
  leftSource: ParticipantRef;
  rightSource: ParticipantRef;
  leftCandidateIndex: number | null;
  rightCandidateIndex: number | null;
  status: MatchStatus;
  winnerCandidateIndex: number | null;
  loserCandidateIndex: number | null;
  resolution: 'bye' | 'sudden_death' | 'mini_arena' | null;
  suddenDeathGames: SuddenDeathGameRecord[];
  escalationResults: EscalationRecord[];
  completedAt: string | null;
}

interface ParticipantRef {
  source: MatchSource;
  seedSlot?: number;
  matchId?: string;
}

interface SuddenDeathGameRecord {
  gameNumber: number;
  seed: number;
  leftCandidateColor: PlayerColor;
  winnerCandidateIndex: number | null;
  turns: number;
  draw: boolean;
}

interface EscalationRecord {
  games: number;
  seed: number;
  score: number;
  winnerCandidateIndex: number | null;
  completedGames: number | null;
  configuredGames: number | null;
  decisionReason: string | null;
  scoreCiLow: number | null;
  scoreCiHigh: number | null;
  logPath: string;
}

interface ChampionChallenge {
  order: number;
  candidateIndex: number;
  candidatePath: string;
  status: ChallengeStatus;
  promoted: boolean;
  promotionApplied: boolean;
  score: number | null;
  completedGames: number | null;
  configuredGames: number | null;
  decisionReason: string | null;
  scoreCiLow: number | null;
  scoreCiHigh: number | null;
  logPath: string;
  completedAt: string | null;
}

interface ReplayPolicyTarget {
  actionKey: string;
  probability: number;
  visitCount: number;
  actionFeatures: number[];
}

interface ReplaySample {
  stateFeatures: number[];
  perspective: 'white' | 'black';
  sampleOrigin?: 'learner' | 'champion';
  policyTargets: ReplayPolicyTarget[];
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
    policyTargets: ReplayPolicyTarget[];
    searchMeta: ReplaySample['searchMeta'];
  }>;
}

interface ReplayReanalysisOptions {
  difficulty: HiveComputerDifficulty;
  fastSimulations: number;
  maxTurns: number;
  reanalyseFraction: number;
  reanalyseWorkers: number;
  modelPath: string;
}

interface LoadedTournamentModel {
  absolutePath: string;
  hash: string;
  model: HiveModel;
}

interface BracketGpuContext {
  client: GpuInferenceClient;
  loadedModelKeys: Set<string>;
}

interface KnockoutWorkerTaskModelRef {
  hash: string;
  path?: string;
  raw?: string;
}

interface KnockoutWorkerTaskPayload {
  taskId: string;
  seed: number;
  leftCandidateColor: PlayerColor;
  leftModel: KnockoutWorkerTaskModelRef;
  rightModel: KnockoutWorkerTaskModelRef;
  difficulty: HiveComputerDifficulty;
  simulations: number | null;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
}

interface KnockoutWorkerResult {
  taskId: string;
  winnerSide: 'left' | 'right' | 'draw';
  turns: number;
  leftCandidateColor: PlayerColor;
  error?: string;
}

interface KnockoutWorkerPool {
  runGame: (input: KnockoutWorkerTaskInput) => Promise<HeadToHeadGameResult>;
  shutdown: () => Promise<void>;
  totalWorkers: number;
}

interface KnockoutWorkerTaskInput {
  seed: number;
  leftCandidateColor: PlayerColor;
  leftCandidatePath: string;
  leftCandidateHash: string;
  rightCandidatePath: string;
  rightCandidateHash: string;
  difficulty: HiveComputerDifficulty;
  simulations: number | null;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
}

interface KnockoutWorkerProcess {
  id: string;
  label: string;
  transport: 'local' | 'remote';
  process: ChildProcess;
  remoteHost: string | null;
  inFlightTaskId: string | null;
  inputClosed: boolean;
  exited: boolean;
  stderrTail: string;
  knownModelHashes: Set<string>;
}

interface HeadToHeadGameResult {
  winnerSide: 'left' | 'right' | 'draw';
  turns: number;
  leftCandidateColor: PlayerColor;
}

interface ArenaOutcome {
  promoted: boolean;
  score: number | null;
  decisionReason: string | null;
  completedGames: number | null;
  configuredGames: number | null;
  scoreCiLow: number | null;
  scoreCiHigh: number | null;
}

interface BatchCandidateResult {
  index: number;
  seed: number;
  status: 'completed' | 'failed';
  runId?: string;
  outputPath?: string;
  modelHash?: string;
  trainCount?: number;
  valCount?: number;
  trainLoss?: number;
  valLoss?: number;
  elapsedSeconds?: number;
  error?: string;
  checkpointPath?: string;
}

interface SingleProcessProgressRecord {
  event: 'slot_assigned' | 'checkpoint';
  index: number;
  seed: number;
  checkpointPath?: string;
  restored?: boolean;
  epoch?: number;
  batchCursor?: number;
  trainLoss?: number;
  valLoss?: number;
  runId?: string;
}

const HARDWARE_PROFILE = getHiveHardwareProfile();
const REANALYSE_WORKER_TIMEOUT_MIN_MS = 5 * 60 * 1000;
const REANALYSE_WORKER_TIMEOUT_PER_SAMPLE_MS = 2500;
const REANALYSE_WORKER_TIMEOUT_MAX_MS = 20 * 60 * 1000;
const REANALYSE_MAX_SAMPLES_PER_WORKER = 1200;
const REPLAY_SHARD_DIR_SUFFIX = '.chunks';
const DEFAULT_BATCH_SIZE = Math.max(1024, HARDWARE_PROFILE.deepBatchSize);
const DEFAULT_TRAIN_CONCURRENCY = HARDWARE_PROFILE.totalMemoryGiB >= 24 ? 2 : 1;
const DEFAULT_OPTIONS: TournamentOptions = {
  candidateCount: 0,
  seedBase: 1000,
  tournamentSeed: 20260322,
  splitSeed: 20260322,
  runId: null,
  resume: false,
  finalistCount: 3,
  drawReplayLimit: 3,
  drawEscalationGames: 8,
  drawEscalationMaxGames: 32,
  trainerBackend: 'single-process',
  multiCandidateCount: HARDWARE_PROFILE.totalMemoryGiB >= 24 ? 8 : 4,
  checkpointEveryEpoch: true,
  targetGpuUtilization: null,
  searchBackend: 'cpu',
  gpuArenaGamesInFlight: HARDWARE_PROFILE.gpuArenaGamesInFlight,
  gpuInferenceMaxBatchSize: HARDWARE_PROFILE.gpuInferenceMaxBatchSize,
  gpuInferenceBatchDelayMs: HARDWARE_PROFILE.gpuInferenceBatchDelayMs,
  knockoutSimulations: null,
  knockoutWorkers: HARDWARE_PROFILE.evalWorkers,
  knockoutRemoteWorkers: [],
  trainConcurrency: DEFAULT_TRAIN_CONCURRENCY,
  difficulty: 'extreme',
  maxTurns: 320,
  noCaptureDrawMoves: 100,
  openingRandomPlies: 4,
  initModelPath: '.hive-cache/az-learner-model.json',
  championModelPath: 'lib/hive/trained-model.json',
  replayPath: '.hive-cache/az-replay-buffer.json',
  reanalyseFraction: 0,
  reanalyseWorkers: Math.max(1, Math.min(8, HARDWARE_PROFILE.logicalCpuCount - HARDWARE_PROFILE.selfPlayWorkers)),
  reanalyseFastSimulations: 72,
  epochs: 8,
  batchSize: DEFAULT_BATCH_SIZE,
  learningRate: 0.0015,
  weightDecay: 0.0001,
  policyTargetTemperature: 0.12,
  labelSmoothing: 0.02,
  candidateTrainFraction: 0.9,
  candidateLabelSmoothingJitter: 0.01,
  candidateInitNoiseStd: 0.0015,
  hidden: '256,128',
  trainerDevice: 'auto',
  metricsLogPath: '.hive-cache/metrics/training-metrics.jsonl',
  promoteOutPath: 'lib/hive/trained-model.json',
  finalArenaArgs: [],
  continuous: false,
  dryRun: false,
  verbose: false,
};

async function main(): Promise<void> {
  const parsed = parseOptions(process.argv.slice(2));
  if (parsed.continuous && parsed.resume) {
    throw new Error('--continuous cannot be combined with --resume');
  }

  let cycle = 0;
  while (true) {
    cycle += 1;
    const cycleOptions = buildCycleOptions(parsed, cycle);
    if (parsed.continuous) {
      console.log(
        `[continuous] starting cycle ${cycle}${cycleOptions.runId ? ` run_id=${cycleOptions.runId}` : ''}`,
      );
    }
    await runTournamentCycle(cycleOptions);
    if (!parsed.continuous) {
      return;
    }
  }
}

async function runTournamentCycle(parsed: TournamentOptions): Promise<void> {
  const workspace = resolveWorkspace(parsed);
  const manifestPath = path.join(workspace, 'manifest.json');
  const bracketPath = path.join(workspace, 'bracket.json');
  const tmpDir = path.join(workspace, 'tmp');
  const logsDir = path.join(workspace, 'logs');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  let manifest = loadOrCreateManifest(parsed, workspace, manifestPath);
  const logger = createMetricsLogger(manifest.config.metricsLogPath, manifest.runId);
  let bracket = loadOrCreateBracket(manifest, bracketPath);

  try {
    manifest.status = 'running';
    manifest.lastError = null;
    saveManifest(manifestPath, manifest);
    saveBracket(bracketPath, bracket);
    console.log(
      `[tournament] cycle start run_id=${manifest.runId} workspace=${workspace} resume=${parsed.resume ? 'yes' : 'no'} `
      + `trained=${manifest.candidates.filter((candidate) => candidate.status === 'trained').length}/${manifest.config.candidateCount} `
      + `bracket_resolved=${countResolvedBracketMatches(bracket)}/${countTotalBracketMatches(bracket)}`,
    );

    logger.log('tournament_run_start', {
      workspace,
      candidateCount: manifest.config.candidateCount,
      resume: parsed.resume,
      dryRun: manifest.config.dryRun,
    });

    if (!manifest.frozenSnapshot) {
      console.log('[tournament] preparing frozen snapshot');
      manifest.frozenSnapshot = await prepareFrozenSnapshot(manifest, workspace, tmpDir, logger);
      saveManifest(manifestPath, manifest);
      console.log('[tournament] publishing shared metrics snapshot after snapshot prep');
      await publishHiveMetricsSnapshotSafely(manifest.config.metricsLogPath);
    }

    console.log('[tournament] candidate training stage');
    await trainCandidates(manifest, manifestPath, workspace, logger);
    console.log('[tournament] publishing shared metrics snapshot after training');
    await publishHiveMetricsSnapshotSafely(manifest.config.metricsLogPath);

    bracket = loadOrCreateBracket(manifest, bracketPath);
    console.log('[tournament] knockout bracket stage');
    await runBracket(manifest, bracket, manifestPath, bracketPath, workspace, logger);
    console.log('[tournament] publishing shared metrics snapshot after bracket');
    await publishHiveMetricsSnapshotSafely(manifest.config.metricsLogPath);

    console.log('[tournament] finalist selection stage');
    await selectFinalists(manifest, bracket, manifestPath, bracketPath, workspace, logger);
    console.log('[tournament] champion challenge stage');
    await challengeChampion(manifest, manifestPath, workspace, logger);
    console.log('[tournament] publishing shared metrics snapshot after champion gate');
    await publishHiveMetricsSnapshotSafely(manifest.config.metricsLogPath);

    manifest.status = 'completed';
    manifest.updatedAt = new Date().toISOString();
    saveManifest(manifestPath, manifest);
    logger.log('tournament_run_end', {
      status: 'completed',
      finalists: manifest.finalists,
      promotedCandidateIndex: manifest.promotedCandidateIndex,
      promotionApplied: manifest.promotionApplied,
    });
  } catch (error) {
    const message = formatErrorMessage(error);
    manifest.status = 'failed';
    manifest.lastError = message;
    manifest.updatedAt = new Date().toISOString();
    saveManifest(manifestPath, manifest);
    logger.log('tournament_run_end', {
      status: 'failed',
      error: message,
    });
    throw error;
  }
}

function buildCycleOptions(base: TournamentOptions, cycle: number): TournamentOptions {
  const next: TournamentOptions = {
    ...base,
    finalArenaArgs: [...base.finalArenaArgs],
    resume: cycle === 1 ? base.resume : false,
  };
  if (cycle <= 1) return next;
  next.runId = base.runId ? `${base.runId}-cycle-${cycle}` : null;
  return next;
}

function parseOptions(argv: string[]): TournamentOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelpAndExit();
  }

  const options: TournamentOptions = {
    ...DEFAULT_OPTIONS,
    finalArenaArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg.startsWith('--arena-')) {
      const converted = `--${arg.slice('--arena-'.length)}`;
      if (converted === '--candidate-model' || converted === '--champion-model') {
        index += next && !next.startsWith('--') ? 1 : 0;
        continue;
      }
      if (converted === '--promote-out') {
        if (!next) throw new Error('Missing value for --arena-promote-out');
        options.promoteOutPath = next;
        index += 1;
        continue;
      }
      options.finalArenaArgs.push(converted);
      if (next && !next.startsWith('--')) {
        options.finalArenaArgs.push(next);
        index += 1;
      }
      continue;
    }

    switch (arg) {
      case '--candidate-count':
        options.candidateCount = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--seed-base':
        options.seedBase = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--tournament-seed':
        options.tournamentSeed = parseNonNegativeInt(next, arg);
        options.splitSeed = options.tournamentSeed;
        index += 1;
        break;
      case '--run-id':
        if (!next) throw new Error('Missing value for --run-id');
        options.runId = next;
        index += 1;
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--finalist-count':
        options.finalistCount = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--draw-replay-limit':
        options.drawReplayLimit = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--draw-escalation-games':
        options.drawEscalationGames = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--draw-escalation-max-games':
        options.drawEscalationMaxGames = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--trainer-backend':
        options.trainerBackend = parseTrainerBackend(next);
        index += 1;
        break;
      case '--multi-candidate-count':
        options.multiCandidateCount = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--checkpoint-every-epoch':
        options.checkpointEveryEpoch = true;
        break;
      case '--no-checkpoint-every-epoch':
        options.checkpointEveryEpoch = false;
        break;
      case '--target-gpu-utilization':
        options.targetGpuUtilization = parseRatio(next, arg);
        index += 1;
        break;
      case '--search-backend':
        options.searchBackend = parseSearchBackend(next);
        index += 1;
        break;
      case '--gpu-games-in-flight':
        options.gpuArenaGamesInFlight = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gpu-batch-size':
        options.gpuInferenceMaxBatchSize = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gpu-batch-delay-ms':
        options.gpuInferenceBatchDelayMs = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--knockout-simulations':
        options.knockoutSimulations = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--knockout-workers':
        options.knockoutWorkers = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--knockout-remote-worker':
        if (!next) throw new Error('Missing value for --knockout-remote-worker');
        options.knockoutRemoteWorkers = [...options.knockoutRemoteWorkers, parseRemoteWorkerSpec(next, arg)];
        index += 1;
        break;
      case '--train-concurrency':
        options.trainConcurrency = parsePositiveInt(next, arg);
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
      case '--opening-random-plies':
        options.openingRandomPlies = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--init-model':
        if (!next) throw new Error('Missing value for --init-model');
        options.initModelPath = next;
        index += 1;
        break;
      case '--champion-model':
        if (!next) throw new Error('Missing value for --champion-model');
        options.championModelPath = next;
        index += 1;
        break;
      case '--replay-path':
        if (!next) throw new Error('Missing value for --replay-path');
        options.replayPath = next;
        index += 1;
        break;
      case '--reanalyse-fraction':
        options.reanalyseFraction = parseRatio(next, arg);
        index += 1;
        break;
      case '--reanalyse-workers':
        options.reanalyseWorkers = parsePositiveInt(next, arg);
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
      case '--learning-rate':
      case '--lr':
        options.learningRate = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--weight-decay':
        options.weightDecay = parsePositiveFloat(next, arg, true);
        index += 1;
        break;
      case '--policy-target-temperature':
        options.policyTargetTemperature = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--label-smoothing':
        options.labelSmoothing = parseRatioZeroOne(next, arg);
        index += 1;
        break;
      case '--candidate-train-fraction':
        options.candidateTrainFraction = parseRatio(next, arg);
        index += 1;
        break;
      case '--candidate-label-smoothing-jitter':
        options.candidateLabelSmoothingJitter = parseRatio(next, arg);
        index += 1;
        break;
      case '--candidate-init-noise-std':
        options.candidateInitNoiseStd = parsePositiveFloat(next, arg, true);
        index += 1;
        break;
      case '--hidden':
        if (!next) throw new Error('Missing value for --hidden');
        options.hidden = next;
        index += 1;
        break;
      case '--trainer-device':
      case '--device':
        if (!next) throw new Error(`Missing value for ${arg}`);
        options.trainerDevice = next;
        index += 1;
        break;
      case '--metrics-log':
        if (!next) throw new Error('Missing value for --metrics-log');
        options.metricsLogPath = next;
        index += 1;
        break;
      case '--promote-out':
        if (!next) throw new Error('Missing value for --promote-out');
        options.promoteOutPath = next;
        index += 1;
        break;
      case '--continuous':
        options.continuous = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.candidateCount <= 0) {
    throw new Error('Missing required --candidate-count <n>');
  }
  if (options.finalistCount > 3) {
    throw new Error('V1 tournament flow supports at most --finalist-count 3');
  }

  options.knockoutWorkers = Math.max(1, options.knockoutWorkers);
  options.knockoutRemoteWorkers = aggregateRemoteWorkerSpecs(options.knockoutRemoteWorkers);
  options.trainConcurrency = Math.max(1, options.trainConcurrency);
  options.multiCandidateCount = Math.max(1, options.multiCandidateCount);
  options.finalistCount = Math.min(options.finalistCount, options.candidateCount);
  return options;
}

function resolveWorkspace(options: TournamentOptions): string {
  const baseDir = path.resolve(process.cwd(), '.hive-cache', 'tournament');
  mkdirSync(baseDir, { recursive: true });

  const runId = options.runId
    ?? (options.resume ? resolveLatestRunId(baseDir) : null)
    ?? `az-tournament-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  options.runId = runId;
  return path.join(baseDir, runId);
}

function resolveLatestRunId(baseDir: string): string | null {
  const entries = readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      mtimeMs: statSync(path.join(baseDir, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return entries[0]?.name ?? null;
}

function loadOrCreateManifest(options: TournamentOptions, workspace: string, manifestPath: string): TournamentManifest {
  if (options.resume && existsSync(manifestPath)) {
    const loaded = readJsonFile<TournamentManifest>(manifestPath);
    if (!loaded) {
      throw new Error(`Unable to read manifest at ${manifestPath}`);
    }
    const rawConfig = loaded.config ?? {};
    loaded.config = {
      ...DEFAULT_OPTIONS,
      ...rawConfig,
      finalArenaArgs: Array.isArray(loaded.config?.finalArenaArgs) ? loaded.config.finalArenaArgs : [],
    };
    if (!Object.prototype.hasOwnProperty.call(rawConfig, 'candidateTrainFraction')) {
      loaded.config.candidateTrainFraction = 1.0;
    }
    if (!Object.prototype.hasOwnProperty.call(rawConfig, 'candidateLabelSmoothingJitter')) {
      loaded.config.candidateLabelSmoothingJitter = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(rawConfig, 'candidateInitNoiseStd')) {
      loaded.config.candidateInitNoiseStd = 0;
    }
    for (const candidate of loaded.candidates) {
      if (candidate.trainSampleFraction === undefined) {
        candidate.trainSampleFraction = 1.0;
      }
      if (candidate.trainSampleSeed === undefined) {
        candidate.trainSampleSeed = candidate.seed + 17;
      }
      if (candidate.labelSmoothing === undefined) {
        candidate.labelSmoothing = loaded.config.labelSmoothing;
      }
      if (candidate.initNoiseStd === undefined) {
        candidate.initNoiseStd = 0;
      }
      if (candidate.initNoiseSeed === undefined) {
        candidate.initNoiseSeed = candidate.seed + 29;
      }
      if (candidate.checkpointPath === undefined) {
        candidate.checkpointPath = path.join(workspace, 'checkpoints', `candidate-${String(candidate.index + 1).padStart(String(loaded.config.candidateCount).length, '0')}.pt`);
      }
      if (candidate.epochsCompleted === undefined) {
        candidate.epochsCompleted = 0;
      }
      if (candidate.checkpointUpdatedAt === undefined) {
        candidate.checkpointUpdatedAt = null;
      }
    }
    return loaded;
  }

  const candidates = Array.from({ length: options.candidateCount }, (_, index) => ({
    index,
    seed: options.seedBase + index,
    ...buildCandidateDiversity(index, options),
    outputPath: path.join(workspace, 'candidates', `candidate-${String(index + 1).padStart(String(options.candidateCount).length, '0')}.json`),
    status: 'pending' as const,
    runId: null,
    modelHash: null,
    trainCount: null,
    valCount: null,
    trainLoss: null,
    valLoss: null,
    elapsedSeconds: null,
    error: null,
    checkpointPath: path.join(workspace, 'checkpoints', `candidate-${String(index + 1).padStart(String(options.candidateCount).length, '0')}.pt`),
    epochsCompleted: 0,
    checkpointUpdatedAt: null,
  }));

  const now = new Date().toISOString();
  return {
    version: 1,
    runId: options.runId ?? 'unknown',
    createdAt: now,
    updatedAt: now,
    status: 'running',
    workspacePath: workspace,
    config: { ...options },
    frozenSnapshot: null,
    candidates,
    finalists: [],
    winnerCandidateIndex: null,
    runnerUpCandidateIndex: null,
    bronzeCandidateIndex: null,
    championChallenges: [],
    promotedCandidateIndex: null,
    promotionApplied: false,
    lastError: null,
  };
}

function buildCandidateDiversity(index: number, options: TournamentOptions): Pick<
  TournamentCandidate,
  'trainSampleFraction' | 'trainSampleSeed' | 'labelSmoothing' | 'initNoiseStd' | 'initNoiseSeed'
> {
  const seed = options.seedBase + index;
  const smoothingRng = createRng(options.tournamentSeed + index * 104_729 + 17);
  const smoothingDelta = (smoothingRng() * 2 - 1) * options.candidateLabelSmoothingJitter;
  return {
    trainSampleFraction: options.candidateTrainFraction,
    trainSampleSeed: options.tournamentSeed + index * 65_537 + 17,
    labelSmoothing: clampNumber(options.labelSmoothing + smoothingDelta, 0, 0.25),
    initNoiseStd: options.candidateInitNoiseStd,
    initNoiseSeed: seed + 29,
  };
}

function loadOrCreateBracket(manifest: TournamentManifest, bracketPath: string): TournamentBracket {
  if (existsSync(bracketPath)) {
    const loaded = readJsonFile<TournamentBracket>(bracketPath);
    if (!loaded) throw new Error(`Unable to read bracket at ${bracketPath}`);
    return loaded;
  }
  return createInitialBracket(manifest.config.candidateCount, manifest.runId, manifest.config.tournamentSeed);
}

async function prepareFrozenSnapshot(
  manifest: TournamentManifest,
  workspace: string,
  tmpDir: string,
  logger: MetricsLogger,
): Promise<FrozenSnapshot> {
  const frozenDir = path.join(workspace, 'frozen');
  mkdirSync(frozenDir, { recursive: true });

  const initModelSourcePath = resolveInitModelSourcePath(manifest.config);
  const championSourcePath = resolveChampionModelSourcePath(manifest.config, workspace);
  const replaySourcePath = path.resolve(process.cwd(), manifest.config.replayPath);
  const frozenInitModelPath = path.join(frozenDir, 'init-model.json');
  const frozenChampionModelPath = path.join(frozenDir, 'champion-model.json');
  const frozenReplayPath = path.join(frozenDir, 'replay-buffer.json');
  const frozenDatasetPath = path.join(frozenDir, 'trainer-dataset.json');

  copyFileSync(initModelSourcePath, frozenInitModelPath);
  copyFileSync(championSourcePath, frozenChampionModelPath);
  freezeReplaySource(replaySourcePath, frozenReplayPath);

  const replay = readReplayPayload(frozenReplayPath);
  if (!replay) {
    throw new Error(`Unable to read frozen replay snapshot from ${frozenReplayPath}`);
  }
  const snapshot = cloneReplayPayload(replay);
  const reanalysedSamples = await reanalyseSnapshot(
    snapshot,
    {
      difficulty: manifest.config.difficulty,
      fastSimulations: manifest.config.reanalyseFastSimulations,
      maxTurns: manifest.config.maxTurns,
      reanalyseFraction: manifest.config.reanalyseFraction,
      reanalyseWorkers: manifest.config.reanalyseWorkers,
      modelPath: frozenInitModelPath,
    },
    tmpDir,
    logger,
  );
  writeTrainerDatasetPayload(frozenDatasetPath, snapshot);

  logger.log('tournament_snapshot_prepared', {
    initModelSourcePath,
    championSourcePath,
    replaySourcePath,
    replaySamples: snapshot.samples.length,
    reanalysedSamples,
  });

  return {
    initModelSourcePath,
    championSourcePath,
    frozenInitModelPath,
    frozenChampionModelPath,
    frozenReplayPath,
    frozenDatasetPath,
    initModelHash: hashFileShort(frozenInitModelPath),
    championModelHash: hashFileShort(frozenChampionModelPath),
    replaySampleCount: snapshot.samples.length,
    reanalysedSamples,
  };
}

function resolveInitModelSourcePath(options: TournamentOptions): string {
  const preferred = path.resolve(process.cwd(), options.initModelPath);
  if (existsSync(preferred)) return preferred;
  return path.resolve(process.cwd(), options.championModelPath);
}

function resolveChampionModelSourcePath(options: TournamentOptions, currentWorkspace: string): string {
  const preferred = path.resolve(process.cwd(), options.championModelPath);
  if (existsSync(preferred)) return preferred;

  const fallback = findLatestFrozenChampionModel(currentWorkspace);
  if (fallback) {
    console.warn(`[warn] Champion model missing at ${preferred}; falling back to ${fallback}`);
    return fallback;
  }

  const initFallback = path.resolve(process.cwd(), options.initModelPath);
  if (existsSync(initFallback)) {
    console.warn(`[warn] Champion model missing at ${preferred}; falling back to init model ${initFallback}`);
    return initFallback;
  }

  throw new Error(`Champion model not found: ${preferred}`);
}

function findLatestFrozenChampionModel(currentWorkspace: string): string | null {
  const tournamentDir = path.resolve(process.cwd(), '.hive-cache', 'tournament');
  if (!existsSync(tournamentDir)) return null;

  const entries = readdirSync(tournamentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tournamentDir, entry.name))
    .filter((workspacePath) => path.resolve(workspacePath) !== path.resolve(currentWorkspace))
    .map((workspacePath) => {
      const championPath = path.join(workspacePath, 'frozen', 'champion-model.json');
      return existsSync(championPath)
        ? {
            championPath,
            mtimeMs: statSync(championPath).mtimeMs,
          }
        : null;
    })
    .filter((entry): entry is { championPath: string; mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return entries[0]?.championPath ?? null;
}

function freezeReplaySource(sourcePath: string, destinationPath: string): void {
  if (!existsSync(sourcePath)) {
    throw new Error(`Replay path not found: ${sourcePath}`);
  }
  copyFileSync(sourcePath, destinationPath);
  const sourceChunks = `${sourcePath}${REPLAY_SHARD_DIR_SUFFIX}`;
  const destinationChunks = `${destinationPath}${REPLAY_SHARD_DIR_SUFFIX}`;
  if (existsSync(sourceChunks)) {
    rmSync(destinationChunks, { recursive: true, force: true });
    cpSync(sourceChunks, destinationChunks, { recursive: true });
  }
}

async function trainCandidates(
  manifest: TournamentManifest,
  manifestPath: string,
  workspace: string,
  logger: MetricsLogger,
): Promise<void> {
  const frozen = manifest.frozenSnapshot;
  if (!frozen) throw new Error('Frozen snapshot missing');

  const pending = manifest.candidates.filter((candidate) => !isCandidateReady(candidate));
  if (pending.length === 0) return;

    logger.log('tournament_trainer_backend_start', {
      backend: manifest.config.trainerBackend,
      pendingCandidates: pending.length,
      batchSize: manifest.config.batchSize,
      hidden: manifest.config.hidden,
      candidateTrainFraction: manifest.config.candidateTrainFraction,
      candidateLabelSmoothingJitter: manifest.config.candidateLabelSmoothingJitter,
      candidateInitNoiseStd: manifest.config.candidateInitNoiseStd,
    });

  if (manifest.config.trainerBackend === 'single-process') {
    await trainCandidatesSingleProcess(manifest, manifestPath, workspace, logger, pending, frozen);
    const unfinished = manifest.candidates.filter((candidate) => !isCandidateReady(candidate));
    if (unfinished.length > 0) {
      throw new Error(`Candidate training incomplete for ${unfinished.length} candidate(s)`);
    }
    logger.log('tournament_trainer_backend_end', {
      backend: manifest.config.trainerBackend,
      completedCandidates: manifest.candidates.filter((candidate) => isCandidateReady(candidate)).length,
    });
    return;
  }

  const concurrency = Math.min(manifest.config.trainConcurrency, pending.length);
  const chunks = chunkArray(pending, concurrency);
  const batchScript = path.resolve(process.cwd(), 'scripts/hive/train-alphazero-batch.py');
  const tmpDir = path.join(workspace, 'tmp');
  const logsDir = path.join(workspace, 'logs');
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });

  await Promise.all(chunks.map(async (chunk, chunkIndex) => {
    const specPath = path.join(tmpDir, `batch-spec-${chunkIndex + 1}.json`);
    const resultsPath = path.join(tmpDir, `batch-results-${chunkIndex + 1}.jsonl`);
    const logPath = path.join(logsDir, `train-batch-${chunkIndex + 1}.log`);
    writeJsonFile(specPath, chunk.map((candidate) => ({
      index: candidate.index,
      seed: candidate.seed,
      trainSampleFraction: candidate.trainSampleFraction,
      trainSampleSeed: candidate.trainSampleSeed,
      labelSmoothing: candidate.labelSmoothing,
      initNoiseStd: candidate.initNoiseStd,
      initNoiseSeed: candidate.initNoiseSeed,
      outputPath: candidate.outputPath,
    })));
    rmSync(resultsPath, { force: true });
    rmSync(logPath, { force: true });

    for (const candidate of chunk) {
      logger.log('tournament_candidate_train_start', {
        candidateIndex: candidate.index,
        seed: candidate.seed,
        outputPath: candidate.outputPath,
        batchIndex: chunkIndex + 1,
        trainSampleFraction: candidate.trainSampleFraction,
        labelSmoothing: candidate.labelSmoothing,
        initNoiseStd: candidate.initNoiseStd,
      });
    }

    let commandError: Error | null = null;
    try {
      await runPythonWithFallback([
        batchScript,
        '--dataset',
        frozen.frozenDatasetPath,
        '--candidate-spec',
        specPath,
        '--results-jsonl',
        resultsPath,
        '--init-model',
        frozen.frozenInitModelPath,
        '--metrics-log',
        manifest.config.metricsLogPath,
        '--hidden',
        manifest.config.hidden,
        '--epochs',
        String(manifest.config.epochs),
        '--batch-size',
        String(manifest.config.batchSize),
        '--lr',
        String(manifest.config.learningRate),
        '--weight-decay',
        String(manifest.config.weightDecay),
        '--device',
        manifest.config.trainerDevice,
        '--policy-target-temperature',
        String(manifest.config.policyTargetTemperature),
        '--label-smoothing',
        String(manifest.config.labelSmoothing),
        '--split-seed',
        String(manifest.config.splitSeed),
        '--batch-id',
        `batch-${chunkIndex + 1}`,
      ], {
        stdio: 'pipe',
        streamStdout: manifest.config.verbose,
        streamStderr: manifest.config.verbose,
        stdoutFilePath: logPath,
        stderrFilePath: logPath,
        captureLimit: 512 * 1024,
      });
    } catch (error) {
      commandError = error instanceof Error ? error : new Error(String(error));
    }

    const results = readBatchResults(resultsPath);
    for (const result of results) {
      applyBatchCandidateResult(manifest, result);
      logger.log('tournament_candidate_train_end', {
        candidateIndex: result.index,
        seed: result.seed,
        status: result.status,
        modelHash: result.modelHash ?? null,
        trainLoss: result.trainLoss ?? null,
        valLoss: result.valLoss ?? null,
        elapsedSeconds: result.elapsedSeconds ?? null,
        error: result.error ?? null,
      });
    }

    manifest.updatedAt = new Date().toISOString();
    saveManifest(manifestPath, manifest);

    if (commandError) {
      throw commandError;
    }
  }));

  const unfinished = manifest.candidates.filter((candidate) => !isCandidateReady(candidate));
  if (unfinished.length > 0) {
    throw new Error(`Candidate training incomplete for ${unfinished.length} candidate(s)`);
  }
  logger.log('tournament_trainer_backend_end', {
    backend: manifest.config.trainerBackend,
    completedCandidates: manifest.candidates.filter((candidate) => isCandidateReady(candidate)).length,
  });
}

async function trainCandidatesSingleProcess(
  manifest: TournamentManifest,
  manifestPath: string,
  workspace: string,
  logger: MetricsLogger,
  pending: TournamentCandidate[],
  frozen: FrozenSnapshot,
): Promise<void> {
  const trainerScript = path.resolve(process.cwd(), 'scripts/hive/train-alphazero-multi.py');
  const tmpDir = path.join(workspace, 'tmp');
  const logsDir = path.join(workspace, 'logs');
  const checkpointsDir = path.join(workspace, 'checkpoints');
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(checkpointsDir, { recursive: true });

  const specPath = path.join(tmpDir, 'single-process-spec.json');
  const resultsPath = path.join(tmpDir, 'single-process-results.jsonl');
  const progressPath = path.join(tmpDir, 'single-process-progress.jsonl');
  const logPath = path.join(logsDir, 'train-single-process.log');

  writeJsonFile(specPath, pending.map((candidate) => ({
    index: candidate.index,
    seed: candidate.seed,
    trainSampleFraction: candidate.trainSampleFraction,
    trainSampleSeed: candidate.trainSampleSeed,
    labelSmoothing: candidate.labelSmoothing,
    initNoiseStd: candidate.initNoiseStd,
    initNoiseSeed: candidate.initNoiseSeed,
    outputPath: candidate.outputPath,
    checkpointPath: candidate.checkpointPath ?? path.join(checkpointsDir, `candidate-${String(candidate.index + 1).padStart(String(manifest.config.candidateCount).length, '0')}.pt`),
  })));
  rmSync(resultsPath, { force: true });
  rmSync(progressPath, { force: true });
  rmSync(logPath, { force: true });

  for (const candidate of pending) {
    logger.log('tournament_candidate_train_start', {
      candidateIndex: candidate.index,
      seed: candidate.seed,
      outputPath: candidate.outputPath,
      backend: 'single-process',
      trainSampleFraction: candidate.trainSampleFraction,
      labelSmoothing: candidate.labelSmoothing,
      initNoiseStd: candidate.initNoiseStd,
    });
  }

  let commandError: Error | null = null;
  try {
    await runPythonWithFallback([
      trainerScript,
      '--dataset',
      frozen.frozenDatasetPath,
      '--candidate-spec',
      specPath,
      '--results-jsonl',
      resultsPath,
      '--progress-jsonl',
      progressPath,
      '--checkpoints-dir',
      checkpointsDir,
      '--init-model',
      frozen.frozenInitModelPath,
      '--metrics-log',
      manifest.config.metricsLogPath,
      '--hidden',
      manifest.config.hidden,
      '--epochs',
      String(manifest.config.epochs),
      '--batch-size',
      String(manifest.config.batchSize),
      '--lr',
      String(manifest.config.learningRate),
      '--weight-decay',
      String(manifest.config.weightDecay),
      '--device',
      manifest.config.trainerDevice,
      '--policy-target-temperature',
      String(manifest.config.policyTargetTemperature),
      '--label-smoothing',
      String(manifest.config.labelSmoothing),
      '--split-seed',
      String(manifest.config.splitSeed),
      '--batch-id',
      'single-process',
      '--tournament-run-id',
      manifest.runId,
      '--multi-candidate-count',
      String(manifest.config.multiCandidateCount),
      '--mixed-precision',
      '--compile-forward',
      ...(manifest.config.targetGpuUtilization !== null ? ['--target-gpu-utilization', String(manifest.config.targetGpuUtilization)] : []),
      ...(manifest.config.checkpointEveryEpoch ? ['--checkpoint-every-epoch'] : []),
    ], {
      stdio: 'pipe',
      streamStdout: manifest.config.verbose,
      streamStderr: manifest.config.verbose,
      stdoutFilePath: logPath,
      stderrFilePath: logPath,
      captureLimit: 1024 * 1024,
    });
  } catch (error) {
    commandError = error instanceof Error ? error : new Error(String(error));
  }

  const progressRecords = readSingleProcessProgress(progressPath);
  applySingleProcessProgress(manifest, progressRecords, logger);

  const results = readBatchResults(resultsPath);
  for (const result of results) {
    applyBatchCandidateResult(manifest, result);
    logger.log('tournament_candidate_train_end', {
      candidateIndex: result.index,
      seed: result.seed,
      status: result.status,
      modelHash: result.modelHash ?? null,
      trainLoss: result.trainLoss ?? null,
      valLoss: result.valLoss ?? null,
      elapsedSeconds: result.elapsedSeconds ?? null,
      error: result.error ?? null,
      backend: 'single-process',
    });
  }

  manifest.updatedAt = new Date().toISOString();
  saveManifest(manifestPath, manifest);

  if (commandError) {
    throw commandError;
  }
}

function isCandidateReady(candidate: TournamentCandidate): boolean {
  return candidate.status === 'trained'
    && !!candidate.outputPath
    && existsSync(candidate.outputPath)
    && !!candidate.modelHash;
}

function readBatchResults(resultsPath: string): BatchCandidateResult[] {
  if (!existsSync(resultsPath)) return [];
  return readFileSync(resultsPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as BatchCandidateResult);
}

function readSingleProcessProgress(progressPath: string): SingleProcessProgressRecord[] {
  if (!existsSync(progressPath)) return [];
  return readFileSync(progressPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SingleProcessProgressRecord);
}

function applyBatchCandidateResult(manifest: TournamentManifest, result: BatchCandidateResult): void {
  const candidate = manifest.candidates.find((entry) => entry.index === result.index);
  if (!candidate) return;
  if (result.status === 'completed') {
    candidate.status = 'trained';
    candidate.runId = result.runId ?? null;
    candidate.outputPath = result.outputPath ?? candidate.outputPath;
    candidate.modelHash = result.modelHash ?? (existsSync(candidate.outputPath) ? hashFileShort(candidate.outputPath) : null);
    candidate.trainCount = result.trainCount ?? null;
    candidate.valCount = result.valCount ?? null;
    candidate.trainLoss = result.trainLoss ?? null;
    candidate.valLoss = result.valLoss ?? null;
    candidate.elapsedSeconds = result.elapsedSeconds ?? null;
    candidate.error = null;
    candidate.checkpointPath = result.checkpointPath ?? candidate.checkpointPath;
    candidate.epochsCompleted = manifest.config.epochs;
    candidate.checkpointUpdatedAt = null;
    return;
  }

  candidate.status = 'failed';
  candidate.error = result.error ?? 'unknown training failure';
}

function applySingleProcessProgress(
  manifest: TournamentManifest,
  records: SingleProcessProgressRecord[],
  logger: MetricsLogger,
): void {
  for (const record of records) {
    const candidate = manifest.candidates.find((entry) => entry.index === record.index);
    if (!candidate) continue;
    if (record.checkpointPath) {
      candidate.checkpointPath = record.checkpointPath;
    }
    if (record.event === 'slot_assigned') {
      if (record.runId) candidate.runId = record.runId;
      if (typeof record.epoch === 'number') candidate.epochsCompleted = Math.max(candidate.epochsCompleted, Math.max(0, record.epoch - 1));
      if (record.restored) {
        logger.log('tournament_candidate_resume_loaded', {
          candidateIndex: candidate.index,
          seed: candidate.seed,
          checkpointPath: candidate.checkpointPath,
          epoch: record.epoch ?? null,
          batchCursor: record.batchCursor ?? null,
        });
      } else {
        logger.log('tournament_candidate_slot_assigned', {
          candidateIndex: candidate.index,
          seed: candidate.seed,
          checkpointPath: candidate.checkpointPath,
          epoch: record.epoch ?? null,
          batchCursor: record.batchCursor ?? null,
        });
      }
      continue;
    }

    if (record.event === 'checkpoint') {
      candidate.checkpointUpdatedAt = new Date().toISOString();
      if (typeof record.epoch === 'number') {
        candidate.epochsCompleted = Math.max(candidate.epochsCompleted, record.epoch);
      }
      if (typeof record.trainLoss === 'number') candidate.trainLoss = record.trainLoss;
      if (typeof record.valLoss === 'number') candidate.valLoss = record.valLoss;
      logger.log('tournament_candidate_checkpoint_saved', {
        candidateIndex: candidate.index,
        seed: candidate.seed,
        checkpointPath: candidate.checkpointPath,
        epoch: record.epoch ?? null,
        trainLoss: record.trainLoss ?? null,
        valLoss: record.valLoss ?? null,
      });
    }
  }
}

function countResolvedBracketMatches(bracket: TournamentBracket): number {
  let resolved = 0;
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      if (match.status === 'completed' || match.status === 'bye') {
        resolved += 1;
      }
    }
  }
  if (bracket.bronzeMatch && (bracket.bronzeMatch.status === 'completed' || bracket.bronzeMatch.status === 'bye')) {
    resolved += 1;
  }
  return resolved;
}

function countTotalBracketMatches(bracket: TournamentBracket): number {
  return bracket.rounds.reduce((total, round) => total + round.matches.length, 0)
    + (bracket.bronzeMatch ? 1 : 0);
}

function describeCandidateLabel(candidateIndex: number | null): string {
  return candidateIndex === null ? 'bye' : `candidate ${candidateIndex}`;
}

async function runBracket(
  manifest: TournamentManifest,
  bracket: TournamentBracket,
  manifestPath: string,
  bracketPath: string,
  workspace: string,
  logger: MetricsLogger,
): Promise<void> {
  const modelCache = new Map<number, LoadedTournamentModel>();
  const gpuContext = manifest.config.searchBackend === 'gpu-batched'
    ? await createBracketGpuContext(manifest)
    : null;
  const knockoutWorkerPool = manifest.config.searchBackend === 'cpu'
    ? await createKnockoutWorkerPool(manifest.config)
    : null;
  const totalMatches = countTotalBracketMatches(bracket);
  hydrateBracket(bracket);

  try {
    if (knockoutWorkerPool) {
      console.log(
        `[tournament] knockout worker pool local=${manifest.config.knockoutWorkers} `
        + `remote=${countRemoteWorkerSlots(manifest.config.knockoutRemoteWorkers)} `
        + `hosts=${formatRemoteWorkerSummary(manifest.config.knockoutRemoteWorkers)} `
        + `total=${knockoutWorkerPool.totalWorkers}`,
      );
    }
    for (const round of bracket.rounds) {
      const resolvedBeforeRound = countResolvedBracketMatches(bracket);
      console.log(
        `[tournament] ${round.name} starting (${resolvedBeforeRound}/${totalMatches} matches resolved)`,
      );
      const pendingMatches = round.matches.filter((match) => match.status !== 'completed' && match.status !== 'bye');
      const roundConcurrency = Math.max(
        1,
        Math.min(
          pendingMatches.length || 1,
          knockoutWorkerPool?.totalWorkers ?? 1,
        ),
      );
      if (pendingMatches.length > 1 && roundConcurrency > 1) {
        console.log(
          `[tournament] ${round.name} dispatching ${pendingMatches.length} matches across ${roundConcurrency} slots`,
        );
      }
      const inFlight = new Set<Promise<TournamentMatch>>();
      let nextIndex = 0;

      const launchNext = (): void => {
        while (nextIndex < pendingMatches.length && inFlight.size < roundConcurrency) {
          const match = pendingMatches[nextIndex];
          nextIndex += 1;
          console.log(
            `[tournament] ${round.name} ${match.matchIndex}/${round.matches.length} ${match.id}: `
            + `${describeCandidateLabel(match.leftCandidateIndex)} vs ${describeCandidateLabel(match.rightCandidateIndex)}`,
          );
          const task = completeMatch(
            manifest,
            bracket,
            match,
            bracketPath,
            workspace,
            modelCache,
            gpuContext,
            knockoutWorkerPool,
            logger,
          )
            .then(() => match)
            .finally(() => {
              inFlight.delete(task);
            });
          inFlight.add(task);
        }
      };

      launchNext();
      while (inFlight.size > 0) {
        const completedMatch = await Promise.race(inFlight);
        manifest.updatedAt = new Date().toISOString();
        saveManifest(manifestPath, manifest);
        saveBracket(bracketPath, bracket);
        const resolvedNow = countResolvedBracketMatches(bracket);
        console.log(
          `[tournament] ${completedMatch.id} done winner=${describeCandidateLabel(completedMatch.winnerCandidateIndex)} `
          + `resolution=${completedMatch.resolution ?? 'unknown'} (${resolvedNow}/${totalMatches})`,
        );
        launchNext();
      }
      hydrateBracket(bracket);
      console.log(
        `[tournament] ${round.name} finished (${countResolvedBracketMatches(bracket)}/${totalMatches} matches resolved)`,
      );
    }
  } finally {
    if (knockoutWorkerPool) {
      await knockoutWorkerPool.shutdown();
    }
    if (gpuContext) {
      await gpuContext.client.shutdown();
    }
  }
}

async function createKnockoutWorkerPool(config: TournamentOptions): Promise<KnockoutWorkerPool | null> {
  if (config.searchBackend !== 'cpu') return null;

  const localWorkerCount = Math.max(1, config.knockoutWorkers);
  const remoteSpecs = aggregateRemoteWorkerSpecs(config.knockoutRemoteWorkers);
  const totalWorkers = localWorkerCount + countRemoteWorkerSlots(remoteSpecs);
  if (totalWorkers <= 1) return null;

  const workers: KnockoutWorkerProcess[] = [];
  const pendingTasks: Array<{
    input: KnockoutWorkerTaskInput;
    resolve: (value: HeadToHeadGameResult) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  const inFlightTasks = new Map<string, {
    worker: KnockoutWorkerProcess;
    input: KnockoutWorkerTaskInput;
    resolve: (value: HeadToHeadGameResult) => void;
    reject: (reason?: unknown) => void;
  }>();
  let shuttingDown = false;
  let fatalError: Error | null = null;
  let nextWorkerId = 1;
  let nextTaskId = 1;

  const spawnWorker = (worker: KnockoutWorkerProcess): void => {
    workers.push(worker);

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
    });
    worker.process.on('close', (code, signal) => {
      handleWorkerExit(worker, `code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    });
  };

  for (let index = 0; index < localWorkerCount; index += 1) {
    spawnWorker(spawnLocalKnockoutWorker(nextWorkerId));
    nextWorkerId += 1;
  }

  for (const spec of remoteSpecs) {
    for (let remoteIndex = 0; remoteIndex < spec.workers; remoteIndex += 1) {
      spawnWorker(spawnRemoteKnockoutWorker(nextWorkerId, spec, remoteIndex + 1));
      nextWorkerId += 1;
    }
  }

  console.log(
    `[tournament] knockout workers ready local=${localWorkerCount} `
    + `remote=${countRemoteWorkerSlots(remoteSpecs)} hosts=${formatRemoteWorkerSummary(remoteSpecs)}`,
  );

  dispatchPendingTasks();

  return {
    totalWorkers,
    runGame: (input: KnockoutWorkerTaskInput) => new Promise<HeadToHeadGameResult>((resolve, reject) => {
      if (fatalError) {
        reject(fatalError);
        return;
      }
      pendingTasks.push({ input, resolve, reject });
      dispatchPendingTasks();
    }),
    shutdown: async () => {
      shuttingDown = true;
      for (const worker of workers) {
        if (worker.inputClosed) continue;
        worker.inputClosed = true;
        try {
          worker.process.stdin?.end();
        } catch {
          // ignore
        }
      }
      await sleep(50);
      for (const worker of workers) {
        if (worker.exited) continue;
        try {
          worker.process.kill();
        } catch {
          // ignore
        }
      }
    },
  };

  function dispatchPendingTasks(): void {
    if (shuttingDown || fatalError) return;
    for (const worker of workers) {
      if (worker.exited || worker.inputClosed || worker.inFlightTaskId !== null) continue;
      const nextTask = pendingTasks.shift();
      if (!nextTask) break;

      const taskId = `knockout-task-${nextTaskId}`;
      nextTaskId += 1;
      const payload = buildKnockoutWorkerTaskPayload(worker, taskId, nextTask.input);
      try {
        worker.process.stdin?.write(`${JSON.stringify(payload)}\n`);
        worker.inFlightTaskId = taskId;
        inFlightTasks.set(taskId, { worker, ...nextTask });
      } catch (error) {
        nextTask.reject(error);
      }
    }

    if (!fatalError && pendingTasks.length > 0 && workers.every((worker) => worker.exited || worker.inputClosed)) {
      fatalError = new Error('Knockout worker pool has no live workers remaining');
      rejectAllPending(fatalError);
    }
  }

  function handleWorkerOutput(worker: KnockoutWorkerProcess, line: string): void {
    if (shuttingDown || worker.exited) return;
    let parsed: KnockoutWorkerResult;
    try {
      parsed = JSON.parse(line) as KnockoutWorkerResult;
    } catch {
      if (config.verbose) {
        console.error(`[tournament] ${worker.label} non-json stdout: ${line}`);
      }
      return;
    }

    const taskId = parsed.taskId;
    if (!taskId) return;
    worker.inFlightTaskId = null;
    const task = inFlightTasks.get(taskId);
    inFlightTasks.delete(taskId);
    if (!task) {
      dispatchPendingTasks();
      return;
    }
    if (parsed.error) {
      task.reject(new Error(`${worker.label}: ${parsed.error}`));
      dispatchPendingTasks();
      return;
    }
    task.resolve({
      winnerSide: parsed.winnerSide,
      turns: parsed.turns,
      leftCandidateColor: parsed.leftCandidateColor,
    });
    dispatchPendingTasks();
  }

  function handleWorkerExit(worker: KnockoutWorkerProcess, reason: string): void {
    if (worker.exited) return;
    worker.exited = true;
    const taskId = worker.inFlightTaskId;
    worker.inFlightTaskId = null;

    if (!shuttingDown && taskId) {
      const task = inFlightTasks.get(taskId);
      if (task) {
        inFlightTasks.delete(taskId);
        pendingTasks.unshift({
          input: task.input,
          resolve: task.resolve,
          reject: task.reject,
        });
      }
      console.error(`[tournament] ${worker.label} exited during ${taskId}; requeued (${reason})`);
    } else if (!shuttingDown && config.verbose) {
      console.error(`[tournament] ${worker.label} exited (${reason})`);
    }

    if (!shuttingDown && !fatalError && workers.every((entry) => entry.exited || entry.inputClosed)) {
      fatalError = new Error(`Knockout worker pool exhausted (${reason})`);
      rejectAllPending(fatalError);
      return;
    }
    dispatchPendingTasks();
  }

  function rejectAllPending(error: Error): void {
    while (pendingTasks.length > 0) {
      const task = pendingTasks.shift();
      task?.reject(error);
    }
    for (const [taskId, task] of inFlightTasks.entries()) {
      inFlightTasks.delete(taskId);
      task.reject(error);
    }
  }
}

function buildKnockoutWorkerTaskPayload(
  worker: KnockoutWorkerProcess,
  taskId: string,
  input: KnockoutWorkerTaskInput,
): KnockoutWorkerTaskPayload {
  const leftModel = buildKnockoutWorkerModelRef(worker, input.leftCandidatePath, input.leftCandidateHash);
  const rightModel = buildKnockoutWorkerModelRef(worker, input.rightCandidatePath, input.rightCandidateHash);
  return {
    taskId,
    seed: input.seed,
    leftCandidateColor: input.leftCandidateColor,
    leftModel,
    rightModel,
    difficulty: input.difficulty,
    simulations: input.simulations,
    maxTurns: input.maxTurns,
    noCaptureDrawMoves: input.noCaptureDrawMoves,
    openingRandomPlies: input.openingRandomPlies,
  };
}

function buildKnockoutWorkerModelRef(
  worker: KnockoutWorkerProcess,
  modelPath: string,
  modelHash: string,
): KnockoutWorkerTaskModelRef {
  if (worker.transport === 'local') {
    return {
      hash: modelHash,
      path: path.resolve(process.cwd(), modelPath),
    };
  }

  if (worker.knownModelHashes.has(modelHash)) {
    return { hash: modelHash };
  }
  const raw = readFileSync(path.resolve(process.cwd(), modelPath), 'utf8');
  worker.knownModelHashes.add(modelHash);
  return {
    hash: modelHash,
    raw,
  };
}

function spawnLocalKnockoutWorker(workerId: number): KnockoutWorkerProcess {
  const child = spawn(process.execPath, [
    '--import',
    'tsx',
    path.resolve(process.cwd(), 'scripts/hive/tournament-knockout-worker.ts'),
  ], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  return {
    id: `local-${workerId}`,
    label: `local-${workerId}`,
    transport: 'local',
    process: child,
    remoteHost: null,
    inFlightTaskId: null,
    inputClosed: false,
    exited: false,
    stderrTail: '',
    knownModelHashes: new Set<string>(),
  };
}

function spawnRemoteKnockoutWorker(
  workerId: number,
  spec: RemoteWorkerSpec,
  remoteIndex: number,
): KnockoutWorkerProcess {
  const child = spawn('ssh', buildRemoteNodeTsxSshArgs(spec, 'scripts/hive/tournament-knockout-worker.ts', []), {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  return {
    id: `remote-${workerId}`,
    label: `remote-${spec.host}-${remoteIndex}`,
    transport: 'remote',
    process: child,
    remoteHost: spec.host,
    inFlightTaskId: null,
    inputClosed: false,
    exited: false,
    stderrTail: '',
    knownModelHashes: new Set<string>(),
  };
}

function createInitialBracket(candidateCount: number, runId: string, tournamentSeed: number): TournamentBracket {
  const slotCount = nextPowerOfTwo(candidateCount);
  const slots: Array<number | null> = [
    ...Array.from({ length: candidateCount }, (_, index) => index),
    ...Array.from({ length: slotCount - candidateCount }, () => null),
  ];
  shuffleInPlace(slots, createRng(tournamentSeed));

  const rounds: TournamentRound[] = [];
  let matchCount = Math.max(1, slotCount / 2);
  const roundCount = Math.log2(slotCount);
  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const matches: TournamentMatch[] = [];
    for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
      const id = `round-${roundNumber}-match-${matchIndex + 1}`;
      const leftSource: ParticipantRef = roundNumber === 1
        ? { source: 'seed', seedSlot: matchIndex * 2 }
        : { source: 'winner', matchId: rounds[roundNumber - 2].matches[matchIndex * 2].id };
      const rightSource: ParticipantRef = roundNumber === 1
        ? { source: 'seed', seedSlot: matchIndex * 2 + 1 }
        : { source: 'winner', matchId: rounds[roundNumber - 2].matches[matchIndex * 2 + 1].id };
      matches.push({
        id,
        roundNumber,
        matchIndex: matchIndex + 1,
        leftSource,
        rightSource,
        leftCandidateIndex: roundNumber === 1 ? slots[matchIndex * 2] ?? null : null,
        rightCandidateIndex: roundNumber === 1 ? slots[matchIndex * 2 + 1] ?? null : null,
        status: 'pending',
        winnerCandidateIndex: null,
        loserCandidateIndex: null,
        resolution: null,
        suddenDeathGames: [],
        escalationResults: [],
        completedAt: null,
      });
    }
    rounds.push({
      roundNumber,
      name: roundName(roundNumber, roundCount),
      matches,
    });
    matchCount = Math.max(1, Math.floor(matchCount / 2));
  }

  return {
    version: 1,
    runId,
    slotCount,
    slots,
    rounds,
    bronzeMatch: null,
  };
}

function roundName(roundNumber: number, totalRounds: number): string {
  const remaining = totalRounds - roundNumber + 1;
  if (remaining === 1) return 'Final';
  if (remaining === 2) return 'Semifinal';
  if (remaining === 3) return 'Quarterfinal';
  return `Round ${roundNumber}`;
}

function hydrateBracket(bracket: TournamentBracket): void {
  const winners = new Map<string, number | null>();
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      winners.set(match.id, match.winnerCandidateIndex);
    }
  }

  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      if (match.status === 'completed' || match.status === 'bye') continue;
      match.leftCandidateIndex = resolveParticipant(match.leftSource, bracket, winners);
      match.rightCandidateIndex = resolveParticipant(match.rightSource, bracket, winners);
    }
  }
}

function resolveParticipant(
  ref: ParticipantRef,
  bracket: TournamentBracket,
  winners: Map<string, number | null>,
): number | null {
  if (ref.source === 'seed') {
    return typeof ref.seedSlot === 'number' ? bracket.slots[ref.seedSlot] ?? null : null;
  }
  if (!ref.matchId) return null;
  return winners.get(ref.matchId) ?? null;
}

async function completeMatch(
  manifest: TournamentManifest,
  bracket: TournamentBracket,
  match: TournamentMatch,
  bracketPath: string,
  workspace: string,
  modelCache: Map<number, LoadedTournamentModel>,
  gpuContext: BracketGpuContext | null,
  knockoutWorkerPool: KnockoutWorkerPool | null,
  logger: MetricsLogger,
): Promise<void> {
  const leftCandidateIndex = match.leftCandidateIndex;
  const rightCandidateIndex = match.rightCandidateIndex;

  if (leftCandidateIndex === null && rightCandidateIndex === null) {
    match.status = 'bye';
    match.resolution = 'bye';
    match.completedAt = new Date().toISOString();
    saveBracket(bracketPath, bracket);
    return;
  }

  if (leftCandidateIndex === null || rightCandidateIndex === null) {
    match.status = 'bye';
    match.resolution = 'bye';
    match.winnerCandidateIndex = leftCandidateIndex ?? rightCandidateIndex;
    match.loserCandidateIndex = leftCandidateIndex === null ? rightCandidateIndex : leftCandidateIndex;
    match.completedAt = new Date().toISOString();
    logger.log('tournament_match_end', {
      matchId: match.id,
      roundNumber: match.roundNumber,
      resolution: 'bye',
      winnerCandidateIndex: match.winnerCandidateIndex,
      loserCandidateIndex: match.loserCandidateIndex,
    });
    saveBracket(bracketPath, bracket);
    return;
  }

  const leftCandidate = manifest.candidates[leftCandidateIndex];
  const rightCandidate = manifest.candidates[rightCandidateIndex];
  if (!leftCandidate || !rightCandidate) {
    throw new Error(`Missing candidate for match ${match.id}`);
  }

  const useGpuBatchedSearch = manifest.config.searchBackend === 'gpu-batched';
  const usePythonBatchedSearch = manifest.config.searchBackend === 'python-batched';
  const leftModel = (useGpuBatchedSearch || usePythonBatchedSearch)
    ? null
    : loadTournamentModel(leftCandidate.outputPath, modelCache, leftCandidate.index);
  const rightModel = (useGpuBatchedSearch || usePythonBatchedSearch)
    ? null
    : loadTournamentModel(rightCandidate.outputPath, modelCache, rightCandidate.index);
  const baseSeed = manifest.config.tournamentSeed + match.roundNumber * 100_003 + match.matchIndex * 7_919;
  const coinFlip = createRng(baseSeed)() < 0.5;
  let leftCandidateColor: PlayerColor = coinFlip ? 'white' : 'black';
  const leftModelKey = useGpuBatchedSearch ? candidateModelKey(leftCandidate.index) : null;
  const rightModelKey = useGpuBatchedSearch ? candidateModelKey(rightCandidate.index) : null;

  if (gpuContext && leftModelKey) {
    await ensureBracketGpuModelLoaded(gpuContext, leftModelKey, leftCandidate.outputPath);
  }
  if (gpuContext && rightModelKey) {
    await ensureBracketGpuModelLoaded(gpuContext, rightModelKey, rightCandidate.outputPath);
  }

  for (let gameNumber = match.suddenDeathGames.length + 1; gameNumber <= manifest.config.drawReplayLimit; gameNumber += 1) {
    const suddenDeathSeed = baseSeed + gameNumber * 101;
    const result = manifest.config.searchBackend === 'cpu' && knockoutWorkerPool
      ? await knockoutWorkerPool.runGame({
          seed: suddenDeathSeed,
          leftCandidateColor,
          leftCandidatePath: leftCandidate.outputPath,
          leftCandidateHash: leftCandidate.modelHash ?? hashFileShort(leftCandidate.outputPath),
          rightCandidatePath: rightCandidate.outputPath,
          rightCandidateHash: rightCandidate.modelHash ?? hashFileShort(rightCandidate.outputPath),
          difficulty: manifest.config.difficulty,
          simulations: manifest.config.knockoutSimulations,
          maxTurns: manifest.config.maxTurns,
          noCaptureDrawMoves: manifest.config.noCaptureDrawMoves,
          openingRandomPlies: manifest.config.openingRandomPlies,
        })
      : await runHeadToHeadGame({
          searchBackend: manifest.config.searchBackend,
          seed: suddenDeathSeed,
          leftCandidateColor,
          leftModel: leftModel?.model ?? null,
          rightModel: rightModel?.model ?? null,
          leftModelPath: leftCandidate.outputPath,
          rightModelPath: rightCandidate.outputPath,
          gpuClient: gpuContext?.client ?? null,
          leftModelKey,
          rightModelKey,
          difficulty: manifest.config.difficulty,
          simulations: manifest.config.knockoutSimulations,
          maxTurns: manifest.config.maxTurns,
          noCaptureDrawMoves: manifest.config.noCaptureDrawMoves,
          openingRandomPlies: manifest.config.openingRandomPlies,
        });
    const winnerCandidateIndex = result.winnerSide === 'left'
      ? leftCandidateIndex
      : result.winnerSide === 'right'
        ? rightCandidateIndex
        : null;
    match.suddenDeathGames.push({
      gameNumber,
      seed: suddenDeathSeed,
      leftCandidateColor,
      winnerCandidateIndex,
      turns: result.turns,
      draw: result.winnerSide === 'draw',
    });
    console.log(
      `[tournament] ${match.id} sudden-death game ${gameNumber}/${manifest.config.drawReplayLimit} `
      + `winner=${describeCandidateLabel(winnerCandidateIndex)} draw=${result.winnerSide === 'draw'} turns=${result.turns}`,
    );
    if (result.winnerSide !== 'draw') {
      match.status = 'completed';
      match.resolution = 'sudden_death';
      match.winnerCandidateIndex = winnerCandidateIndex;
      match.loserCandidateIndex = winnerCandidateIndex === leftCandidateIndex ? rightCandidateIndex : leftCandidateIndex;
      match.completedAt = new Date().toISOString();
      logger.log('tournament_match_end', {
        matchId: match.id,
        roundNumber: match.roundNumber,
        resolution: 'sudden_death',
        suddenDeathGames: match.suddenDeathGames.length,
        winnerCandidateIndex: match.winnerCandidateIndex,
        loserCandidateIndex: match.loserCandidateIndex,
      });
      return;
    }
    leftCandidateColor = leftCandidateColor === 'white' ? 'black' : 'white';
  }

  let escalationGames = manifest.config.drawEscalationGames;
  let attempt = match.escalationResults.length + 1;
  while (true) {
    const logPath = path.join(workspace, 'logs', `${match.id}-arena-${escalationGames}-attempt-${attempt}.log`);
    console.log(
      `[tournament] ${match.id} escalating to mini-arena attempt ${attempt} with ${escalationGames} games`,
    );
    const outcome = await runEscalationArena({
      leftCandidate,
      rightCandidate,
      games: escalationGames,
      seed: baseSeed + 10_000 + attempt * 503,
      config: manifest.config,
      logPath,
    });
    const winnerCandidateIndex = outcome.score === null
      ? null
      : outcome.score > 0.5
        ? leftCandidateIndex
        : outcome.score < 0.5
          ? rightCandidateIndex
          : null;
    match.escalationResults.push({
      games: escalationGames,
      seed: baseSeed + 10_000 + attempt * 503,
      score: outcome.score ?? 0.5,
      winnerCandidateIndex,
      completedGames: outcome.completedGames,
      configuredGames: outcome.configuredGames,
      decisionReason: outcome.decisionReason,
      scoreCiLow: outcome.scoreCiLow,
      scoreCiHigh: outcome.scoreCiHigh,
      logPath,
    });
    console.log(
      `[tournament] ${match.id} mini-arena attempt ${attempt} score=${outcome.score ?? 0.5} `
      + `winner=${describeCandidateLabel(winnerCandidateIndex)} reason=${outcome.decisionReason ?? 'none'}`,
    );
    if (outcome.score !== null && outcome.score !== 0.5) {
      match.status = 'completed';
      match.resolution = 'mini_arena';
      match.winnerCandidateIndex = winnerCandidateIndex;
      match.loserCandidateIndex = winnerCandidateIndex === leftCandidateIndex ? rightCandidateIndex : leftCandidateIndex;
      match.completedAt = new Date().toISOString();
      logger.log('tournament_match_end', {
        matchId: match.id,
        roundNumber: match.roundNumber,
        resolution: 'mini_arena',
        suddenDeathGames: match.suddenDeathGames.length,
        escalationGames,
        winnerCandidateIndex: match.winnerCandidateIndex,
        loserCandidateIndex: match.loserCandidateIndex,
        score: outcome.score,
        decisionReason: outcome.decisionReason,
      });
      return;
    }
    escalationGames = Math.min(manifest.config.drawEscalationMaxGames, escalationGames * 2);
    attempt += 1;
  }
}

function loadTournamentModel(
  modelPath: string,
  cache: Map<number, LoadedTournamentModel>,
  cacheKey: number,
): LoadedTournamentModel {
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const absolutePath = path.resolve(process.cwd(), modelPath);
  const raw = readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const model = parseHiveModel(parsed);
  if (!model) {
    throw new Error(`Invalid Hive model: ${modelPath}`);
  }
  const loaded = {
    absolutePath,
    hash: hashText(raw),
    model,
  };
  cache.set(cacheKey, loaded);
  return loaded;
}

function candidateModelKey(candidateIndex: number): string {
  return `candidate-${candidateIndex}`;
}

async function createBracketGpuContext(manifest: TournamentManifest): Promise<BracketGpuContext> {
  const bootstrapCandidate = manifest.candidates.find((candidate) => isCandidateReady(candidate));
  if (!bootstrapCandidate) {
    throw new Error('No trained candidates available to initialize GPU bracket context');
  }
  const bootstrapKey = candidateModelKey(bootstrapCandidate.index);
  const client = await GpuInferenceClient.start(bootstrapCandidate.outputPath, {
    modelKey: bootstrapKey,
    batchDelayMs: manifest.config.gpuInferenceBatchDelayMs,
    maxBatchSize: manifest.config.gpuInferenceMaxBatchSize,
  });
  return {
    client,
    loadedModelKeys: new Set([bootstrapKey]),
  };
}

async function ensureBracketGpuModelLoaded(
  context: BracketGpuContext,
  modelKey: string,
  modelPath: string,
): Promise<void> {
  if (context.loadedModelKeys.has(modelKey)) return;
  await context.client.loadModel(modelKey, modelPath);
  context.loadedModelKeys.add(modelKey);
}

async function runHeadToHeadGame(input: {
  searchBackend: SearchBackend;
  seed: number;
  leftCandidateColor: PlayerColor;
  leftModel: HiveModel | null;
  rightModel: HiveModel | null;
  leftModelPath: string;
  rightModelPath: string;
  gpuClient: GpuInferenceClient | null;
  leftModelKey: string | null;
  rightModelKey: string | null;
  difficulty: HiveComputerDifficulty;
  simulations: number | null;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
}): Promise<HeadToHeadGameResult> {
  if (input.searchBackend === 'python-batched') {
    return runHeadToHeadGamePythonBatched(input);
  }

  const rng = createRng(input.seed);
  let state = createLocalHiveGameState({
    id: `tournament-${Date.now()}-${input.seed}`,
    shortCode: 'TRNY',
    whitePlayerId: input.leftCandidateColor === 'white' ? 'left' : 'right',
    blackPlayerId: input.leftCandidateColor === 'black' ? 'left' : 'right',
  });

  let noProgress = 0;
  let prevPressure = queenPressureTotal(state);
  let openingPly = 0;

  while (state.status === 'playing' && state.turnNumber <= input.maxTurns) {
    const activeColor = state.currentTurn;
    const isLeftTurn = activeColor === input.leftCandidateColor;
    let move: Move | null = null;

    if (openingPly < input.openingRandomPlies) {
      const legal = getLegalMovesForColor(state, activeColor);
      if (legal.length > 0) {
        move = legal[Math.floor(rng() * legal.length)];
      }
      openingPly += 1;
    } else if (input.gpuClient) {
      const search = await runGpuMctsSearch({
        state,
        color: activeColor,
        gpuClient: input.gpuClient,
        modelKey: isLeftTurn ? (input.leftModelKey ?? 'left') : (input.rightModelKey ?? 'right'),
        seed: input.seed + state.turnNumber * 163,
        mctsConfig: input.simulations ? { simulations: input.simulations, maxDepth: input.maxTurns } : { maxDepth: input.maxTurns },
      });
      move = search.selectedMove;
    } else {
      let stats: HiveSearchStats | null = null;
      move = chooseHiveMoveForColor(
        state,
        activeColor,
        input.difficulty,
        {
          modelOverride: isLeftTurn ? input.leftModel ?? undefined : input.rightModel ?? undefined,
          engine: 'alphazero',
          mctsConfig: input.simulations ? { simulations: input.simulations } : undefined,
          randomSeed: input.seed + state.turnNumber * 163,
          onSearchStats: isLeftTurn ? (value) => {
            stats = value;
          } : undefined,
        },
      );
      void stats;
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
    if (input.noCaptureDrawMoves > 0 && noProgress >= input.noCaptureDrawMoves) {
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

  const winnerSide = state.winner === 'draw'
    ? 'draw'
    : state.winner === input.leftCandidateColor
      ? 'left'
      : 'right';
  return {
    winnerSide,
    turns: state.turnNumber,
    leftCandidateColor: input.leftCandidateColor,
  };
}

async function runHeadToHeadGamePythonBatched(input: {
  seed: number;
  leftCandidateColor: PlayerColor;
  leftModelPath: string;
  rightModelPath: string;
  simulations: number | null;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
}): Promise<HeadToHeadGameResult> {
  const scriptPath = path.join(SCRIPTS_DIR, 'python-batched-arena.py');
  const args = [
    scriptPath,
    '--candidate-model', path.resolve(process.cwd(), input.leftModelPath),
    '--champion-model', path.resolve(process.cwd(), input.rightModelPath),
    '--games', '1',
    '--games-in-flight', '1',
    '--candidate-color-mode', input.leftCandidateColor,
    '--max-turns', String(input.maxTurns),
    '--no-capture-draw', String(input.noCaptureDrawMoves),
    '--opening-random-plies', String(input.openingRandomPlies),
    '--seed', String(input.seed),
  ];
  if (input.simulations) {
    args.push('--simulations', String(input.simulations));
  }

  const result = await runPythonWithFallback(args, { stdio: 'pipe' });
  const lastJsonLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!lastJsonLine) {
    throw new Error(`python-batched head-to-head produced no JSON result: ${result.stdout}`);
  }
  const parsed = JSON.parse(lastJsonLine) as Partial<GameResult>;
  const winner = parsed.winner ?? null;
  const winnerSide = winner === null
    ? 'draw'
    : winner === input.leftCandidateColor
      ? 'left'
      : 'right';
  return {
    winnerSide,
    turns: Number(parsed.turns ?? 0),
    leftCandidateColor: input.leftCandidateColor,
  };
}

async function runEscalationArena(input: {
  leftCandidate: TournamentCandidate;
  rightCandidate: TournamentCandidate;
  games: number;
  seed: number;
  config: TournamentOptions;
  logPath: string;
}): Promise<ArenaOutcome> {
  const promoteOutPath = path.join(path.dirname(input.logPath), `${path.basename(input.logPath)}.promote.json`);
  rmSync(promoteOutPath, { force: true });
  const args = withDefaultArenaSearchArgs(input.config, [
    '--import',
    'tsx',
    path.resolve(process.cwd(), 'scripts/hive/eval-arena.ts'),
    '--candidate-model',
    input.leftCandidate.outputPath,
    '--champion-model',
    input.rightCandidate.outputPath,
    '--promote-out',
    promoteOutPath,
    '--games',
    String(input.games),
    '--pass-score',
    '0.500001',
    '--gate-mode',
    'fixed',
    '--difficulty',
    input.config.difficulty,
    '--engine',
    'alphazero',
    '--max-turns',
    String(input.config.maxTurns),
    '--no-capture-draw',
    String(input.config.noCaptureDrawMoves),
    '--opening-random-plies',
    String(input.config.openingRandomPlies),
    '--seed',
    String(input.seed),
    '--metrics-log',
    input.config.metricsLogPath,
    '--workers',
    String(input.config.knockoutWorkers),
    '--no-manual-stop-file',
  ]);
  if (input.config.knockoutSimulations) {
    args.push('--simulations', String(input.config.knockoutSimulations));
  }
  for (const spec of input.config.knockoutRemoteWorkers) {
    args.push('--remote-worker', spec.raw);
  }
  args.push('--verbose');

  const result = await runCommand(process.execPath, args, {
    stdio: 'pipe',
    streamStdout: true,
    streamStderr: true,
    stdoutFilePath: input.logPath,
    stderrFilePath: input.logPath,
    captureLimit: 256 * 1024,
  });
  rmSync(promoteOutPath, { force: true });
  return parseArenaOutcome(result.stdout);
}

function withDefaultArenaSearchArgs(config: TournamentOptions, args: string[]): string[] {
  const out = [...args];
  if (!out.includes('--search-backend')) {
    out.push('--search-backend', config.searchBackend);
  }
  if (!out.includes('--gpu-games-in-flight')) {
    out.push('--gpu-games-in-flight', String(config.gpuArenaGamesInFlight));
  }
  if (!out.includes('--gpu-batch-size')) {
    out.push('--gpu-batch-size', String(config.gpuInferenceMaxBatchSize));
  }
  if (!out.includes('--gpu-batch-delay-ms')) {
    out.push('--gpu-batch-delay-ms', String(config.gpuInferenceBatchDelayMs));
  }
  return out;
}

async function selectFinalists(
  manifest: TournamentManifest,
  bracket: TournamentBracket,
  manifestPath: string,
  bracketPath: string,
  workspace: string,
  logger: MetricsLogger,
): Promise<void> {
  if (manifest.finalists.length > 0) return;

  const totalRounds = bracket.rounds.length;
  if (totalRounds === 0) {
    manifest.winnerCandidateIndex = bracket.slots.find((entry) => entry !== null) ?? null;
    manifest.runnerUpCandidateIndex = null;
    manifest.bronzeCandidateIndex = null;
    manifest.finalists = manifest.winnerCandidateIndex !== null ? [manifest.winnerCandidateIndex] : [];
    saveFinalistsSummary(workspace, manifest);
    saveManifest(manifestPath, manifest);
    saveBracket(bracketPath, bracket);
    logger.log('tournament_finalists_selected', {
      finalists: manifest.finalists,
    });
    return;
  }

  const finalRound = bracket.rounds[totalRounds - 1];
  const finalMatch = finalRound.matches[0];
  manifest.winnerCandidateIndex = finalMatch.winnerCandidateIndex;
  manifest.runnerUpCandidateIndex = finalMatch.loserCandidateIndex;

  let bronzeCandidateIndex: number | null = null;
  if (manifest.config.finalistCount >= 3 && totalRounds >= 2) {
    const semifinalRound = bracket.rounds[totalRounds - 2];
    const semifinalLosers = semifinalRound.matches
      .map((match) => match.loserCandidateIndex)
      .filter((value): value is number => value !== null);
    if (semifinalLosers.length >= 2) {
      if (!bracket.bronzeMatch) {
        bracket.bronzeMatch = {
          id: 'bronze-match',
          roundNumber: semifinalRound.roundNumber,
          matchIndex: 1,
          leftSource: { source: 'seed', seedSlot: 0 },
          rightSource: { source: 'seed', seedSlot: 1 },
          leftCandidateIndex: semifinalLosers[0],
          rightCandidateIndex: semifinalLosers[1],
          status: 'pending',
          winnerCandidateIndex: null,
          loserCandidateIndex: null,
          resolution: null,
          suddenDeathGames: [],
          escalationResults: [],
          completedAt: null,
        };
      }
      const modelCache = new Map<number, LoadedTournamentModel>();
      const gpuContext = manifest.config.searchBackend === 'gpu-batched'
        ? await createBracketGpuContext(manifest)
        : null;
      const knockoutWorkerPool = manifest.config.searchBackend === 'cpu'
        ? await createKnockoutWorkerPool(manifest.config)
        : null;
      if (bracket.bronzeMatch.status !== 'completed' && bracket.bronzeMatch.status !== 'bye') {
        try {
          await completeMatch(
            manifest,
            bracket,
            bracket.bronzeMatch,
            bracketPath,
            workspace,
            modelCache,
            gpuContext,
            knockoutWorkerPool,
            logger,
          );
        } finally {
          if (knockoutWorkerPool) {
            await knockoutWorkerPool.shutdown();
          }
          if (gpuContext) {
            await gpuContext.client.shutdown();
          }
        }
      }
      bronzeCandidateIndex = bracket.bronzeMatch.winnerCandidateIndex;
    } else if (semifinalLosers.length === 1) {
      bronzeCandidateIndex = semifinalLosers[0];
    }
  }

  manifest.bronzeCandidateIndex = bronzeCandidateIndex;
  manifest.finalists = [
    manifest.winnerCandidateIndex,
    manifest.runnerUpCandidateIndex,
    manifest.bronzeCandidateIndex,
  ].filter((value): value is number => value !== null).slice(0, manifest.config.finalistCount);
  saveFinalistsSummary(workspace, manifest);
  saveManifest(manifestPath, manifest);
  saveBracket(bracketPath, bracket);
  logger.log('tournament_finalists_selected', {
    finalists: manifest.finalists,
    winnerCandidateIndex: manifest.winnerCandidateIndex,
    runnerUpCandidateIndex: manifest.runnerUpCandidateIndex,
    bronzeCandidateIndex: manifest.bronzeCandidateIndex,
  });
}

function saveFinalistsSummary(workspace: string, manifest: TournamentManifest): void {
  writeJsonFile(path.join(workspace, 'finalists.json'), {
    finalists: manifest.finalists,
    winnerCandidateIndex: manifest.winnerCandidateIndex,
    runnerUpCandidateIndex: manifest.runnerUpCandidateIndex,
    bronzeCandidateIndex: manifest.bronzeCandidateIndex,
  });
}

async function challengeChampion(
  manifest: TournamentManifest,
  manifestPath: string,
  workspace: string,
  logger: MetricsLogger,
): Promise<void> {
  const frozen = manifest.frozenSnapshot;
  if (!frozen) throw new Error('Frozen snapshot missing');
  if (manifest.finalists.length === 0) return;

  const challengeLogDir = path.join(workspace, 'logs');
  mkdirSync(challengeLogDir, { recursive: true });
  const hasManualStopOverride = manifest.config.finalArenaArgs.includes('--manual-stop-file')
    || manifest.config.finalArenaArgs.includes('--no-manual-stop-file');
  let currentChampionModelPath = frozen.frozenChampionModelPath;

  for (const existing of [...manifest.championChallenges].sort((left, right) => left.order - right.order)) {
    if (existing.status !== 'completed' || !existing.promoted) continue;
    currentChampionModelPath = resolvePromotedChampionPath(manifest, workspace, existing.candidateIndex);
    manifest.promotedCandidateIndex = existing.candidateIndex;
    manifest.promotionApplied = existing.promotionApplied;
  }

  for (let order = 0; order < manifest.finalists.length; order += 1) {
    const candidateIndex = manifest.finalists[order];
    const existing = manifest.championChallenges.find((entry) => entry.order === order + 1);
    if (existing?.status === 'completed') {
      if (existing.promoted) {
        currentChampionModelPath = resolvePromotedChampionPath(manifest, workspace, existing.candidateIndex);
        manifest.promotedCandidateIndex = existing.candidateIndex;
        manifest.promotionApplied = existing.promotionApplied;
      }
      continue;
    }

    const candidate = manifest.candidates[candidateIndex];
    if (!candidate) throw new Error(`Missing finalist candidate ${candidateIndex}`);
    const logPath = path.join(challengeLogDir, `champion-challenge-${order + 1}-candidate-${candidateIndex}.log`);
    const promoteOutPath = manifest.config.dryRun
      ? path.join(workspace, 'tmp', `dry-run-promote-${candidateIndex}.json`)
      : path.resolve(process.cwd(), manifest.config.promoteOutPath);
    rmSync(promoteOutPath, { force: true });

    logger.log('tournament_champion_challenge', {
      status: 'start',
      order: order + 1,
      candidateIndex,
      candidatePath: candidate.outputPath,
    });

    const result = await runCommand(process.execPath, [
      '--import',
      'tsx',
      path.resolve(process.cwd(), 'scripts/hive/eval-arena.ts'),
      '--candidate-model',
      candidate.outputPath,
      '--champion-model',
      currentChampionModelPath,
      '--promote-out',
      promoteOutPath,
      '--metrics-log',
      manifest.config.metricsLogPath,
      ...(hasManualStopOverride ? [] : ['--no-manual-stop-file']),
      '--verbose',
      ...withDefaultArenaSearchArgs(manifest.config, manifest.config.finalArenaArgs),
    ], {
      stdio: 'pipe',
      streamStdout: true,
      streamStderr: true,
      stdoutFilePath: logPath,
      stderrFilePath: logPath,
      captureLimit: 256 * 1024,
    });
    const outcome = parseArenaOutcome(result.stdout);
    const challenge: ChampionChallenge = {
      order: order + 1,
      candidateIndex,
      candidatePath: candidate.outputPath,
      status: 'completed',
      promoted: outcome.promoted,
      promotionApplied: outcome.promoted && !manifest.config.dryRun,
      score: outcome.score,
      completedGames: outcome.completedGames,
      configuredGames: outcome.configuredGames,
      decisionReason: outcome.decisionReason,
      scoreCiLow: outcome.scoreCiLow,
      scoreCiHigh: outcome.scoreCiHigh,
      logPath,
      completedAt: new Date().toISOString(),
    };
    manifest.championChallenges = manifest.championChallenges
      .filter((entry) => entry.order !== challenge.order)
      .concat([challenge])
      .sort((left, right) => left.order - right.order);

    logger.log('tournament_champion_challenge', {
      status: 'completed',
      order: challenge.order,
      candidateIndex,
      promoted: challenge.promoted,
      promotionApplied: challenge.promotionApplied,
      score: challenge.score,
      decisionReason: challenge.decisionReason,
    });

    manifest.updatedAt = new Date().toISOString();
    saveManifest(manifestPath, manifest);
    if (challenge.promoted) {
      manifest.promotedCandidateIndex = candidateIndex;
      manifest.promotionApplied = challenge.promotionApplied;
      currentChampionModelPath = promoteOutPath;
      saveManifest(manifestPath, manifest);
    }
  }
}

function resolvePromotedChampionPath(
  manifest: TournamentManifest,
  workspace: string,
  candidateIndex: number,
): string {
  if (manifest.config.dryRun) {
    return path.join(workspace, 'tmp', `dry-run-promote-${candidateIndex}.json`);
  }
  return path.resolve(process.cwd(), manifest.config.promoteOutPath);
}

function parseArenaOutcome(stdout: string): ArenaOutcome {
  const lines = stdout.split(/\r?\n/);
  let summaryLine: string | null = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes('[arena:done]')) {
      summaryLine = lines[index];
      break;
    }
  }
  const promoted = stdout.includes('[arena:promote] candidate promoted');
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
  };
}

function createMetricsLogger(configuredPath: string, runId: string): MetricsLogger {
  const absolutePath = path.resolve(process.cwd(), configuredPath);
  let warned = false;
  return {
    runId,
    log: (eventType: string, payload: Record<string, unknown>) => {
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
        console.warn(`[warn] failed metrics append: ${formatErrorMessage(error)}`);
      }
    },
  };
}

async function reanalyseSnapshot(
  snapshot: ReplayPayload,
  options: ReplayReanalysisOptions,
  tmpDir: string,
  logger?: MetricsLogger,
): Promise<number> {
  if (options.reanalyseFraction <= 0) return 0;
  if (!existsSync(options.modelPath)) return 0;
  if (snapshot.samples.length === 0) return 0;

  const maxSelectedSamples = Math.max(1, options.reanalyseWorkers * REANALYSE_MAX_SAMPLES_PER_WORKER);
  const requested = Math.min(snapshot.samples.length, Math.floor(snapshot.samples.length * options.reanalyseFraction));
  const count = Math.min(snapshot.samples.length, requested, maxSelectedSamples);
  if (count <= 0) return 0;

  const selected = sampleUniqueIndices(snapshot.samples.length, count, createRng(4141 + snapshot.samples.length));
  const workers = Math.max(1, Math.min(options.reanalyseWorkers, selected.length));
  const chunks = chunkNumberArray(selected, workers);
  const jobs = chunks.map((indices, workerIndex) => {
    const inputPath = path.join(tmpDir, `reanalyze-in-${Date.now()}-${workerIndex}.json`);
    const outputPath = path.join(tmpDir, `reanalyze-out-${Date.now()}-${workerIndex}.json`);
    const payload: ReanalyseWorkerPayload = {
      samples: indices.map((index) => ({
        index,
        stateSnapshot: snapshot.samples[index].stateSnapshot,
      })),
      modelPath: options.modelPath,
      difficulty: options.difficulty,
      fastSimulations: options.fastSimulations,
      maxTurns: options.maxTurns,
    };
    writeFileSync(inputPath, `${JSON.stringify(payload)}\n`, 'utf8');
    return {
      inputPath,
      outputPath,
      workerIndex,
      sampleCount: indices.length,
    };
  });

  logger?.log('tournament_reanalyse_start', {
    replaySamples: snapshot.samples.length,
    requestedSamples: requested,
    selectedSamples: selected.length,
    workers,
  });

  let updated = 0;
  try {
    const results = await Promise.all(jobs.map(async (job) => {
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
          timeoutMs: clamp(
            job.sampleCount * REANALYSE_WORKER_TIMEOUT_PER_SAMPLE_MS,
            REANALYSE_WORKER_TIMEOUT_MIN_MS,
            REANALYSE_WORKER_TIMEOUT_MAX_MS,
          ),
        });
        return { ...job, error: null };
      } catch (error) {
        return {
          ...job,
          error: formatErrorMessage(error),
        };
      }
    }));

    for (const job of results) {
      if (job.error || !existsSync(job.outputPath)) continue;
      const parsed = JSON.parse(readFileSync(job.outputPath, 'utf8')) as ReanalyseWorkerResult;
      for (const update of parsed.updates) {
        const sample = snapshot.samples[update.index];
        if (!sample) continue;
        sample.policyTargets = update.policyTargets;
        sample.searchMeta = update.searchMeta;
        updated += 1;
      }
    }

    logger?.log('tournament_reanalyse_end', {
      replaySamples: snapshot.samples.length,
      requestedSamples: requested,
      updatedSamples: updated,
      failedWorkers: results.filter((job) => job.error).length,
    });
  } finally {
    for (const job of jobs) {
      rmSync(job.inputPath, { force: true });
      rmSync(job.outputPath, { force: true });
    }
  }

  return updated;
}

function readReplayPayload(absolutePath: string): ReplayPayload | null {
  if (!existsSync(absolutePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as ReplayPayload | ShardedReplayManifest;
    if ('samples' in parsed && Array.isArray(parsed.samples)) {
      return {
        ...parsed,
        samples: parsed.samples.map((sample) => ({
          ...sample,
          stateSnapshot: inflatePersistedReplayState(sample.stateSnapshot),
        })),
      };
    }
    if (!('shards' in parsed) || !Array.isArray(parsed.shards)) {
      return null;
    }
    const shardDir = `${absolutePath}${REPLAY_SHARD_DIR_SUFFIX}`;
    const samples: ReplaySample[] = [];
    for (const shard of parsed.shards) {
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
      version: parsed.version,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      stateFeatureNames: parsed.stateFeatureNames,
      actionFeatureNames: parsed.actionFeatureNames,
      samples,
    };
  } catch {
    return null;
  }
}

function cloneReplayPayload(payload: ReplayPayload): ReplayPayload {
  return {
    ...payload,
    samples: payload.samples.slice(),
  };
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

function writeTrainerDatasetPayload(absolutePath: string, payload: ReplayPayload): void {
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeReplayPayloadFile(absolutePath, payload, serializeTrainerSample);
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
      if (index > 0) writeSync(fd, ',');
      writeSync(fd, JSON.stringify(serializeSample(payload.samples[index])));
    }

    writeSync(fd, ']}\n');
    closeSync(fd);
    fd = null;
    renameSync(tempPath, absolutePath);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
    throw error;
  }
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

async function runPythonWithFallback(
  args: string[],
  options?: CommandRunOptions,
): Promise<CommandResult> {
  const commands = getPreferredPythonCommands();
  let lastMissingCommandError: Error | null = null;

  for (const command of commands) {
    try {
      return await runCommand(command, args, options);
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

interface CommandRunOptions {
  stdio?: 'inherit' | 'ignore' | 'pipe';
  streamStdout?: boolean;
  streamStderr?: boolean;
  captureLimit?: number;
  timeoutMs?: number;
  stdoutFilePath?: string;
  stderrFilePath?: string;
}

function runCommand(
  command: string,
  args: string[],
  options?: CommandRunOptions,
): Promise<CommandResult> {
  const stdio = options?.stdio ?? 'inherit';
  const captureLimit = Math.max(8 * 1024, options?.captureLimit ?? 256 * 1024);
  const stdoutFilePath = options?.stdoutFilePath;
  const stderrFilePath = options?.stderrFilePath;
  if (stdoutFilePath) {
    mkdirSync(path.dirname(stdoutFilePath), { recursive: true });
  }
  if (stderrFilePath) {
    mkdirSync(path.dirname(stderrFilePath), { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio,
      shell: false,
    });

    let settled = false;
    let stdout = '';
    let stderr = '';
    const timeoutMs = options?.timeoutMs ?? 0;
    const timeoutHandle = timeoutMs > 0 ? setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs) : null;

    if (stdio === 'pipe') {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout = appendCapturedOutput(stdout, chunk, captureLimit);
        if (stdoutFilePath) appendFileSyncSafe(stdoutFilePath, chunk);
        if (options?.streamStdout) process.stdout.write(chunk);
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr = appendCapturedOutput(stderr, chunk, captureLimit);
        if (stderrFilePath) appendFileSyncSafe(stderrFilePath, chunk);
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

function getPreferredPythonCommands(): string[] {
  const localVenvPython = path.resolve(
    process.cwd(),
    '.venv-hive',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  return process.platform === 'win32'
    ? [localVenvPython, 'python', 'py']
    : [localVenvPython, 'python3', 'python'];
}

function isMissingPythonCommandError(error: unknown): boolean {
  const message = formatErrorMessage(error);
  return /ENOENT|not recognized/i.test(message);
}

function appendFileSyncSafe(filePath: string, chunk: string): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  try {
    appendFileSync(filePath, chunk, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
    mkdirSync(directory, { recursive: true });
    appendFileSync(filePath, chunk, 'utf8');
  }
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
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const temp = indices[index];
    indices[index] = indices[swap];
    indices[swap] = temp;
  }
  return indices.slice(0, Math.min(length, Math.max(0, Math.floor(count))));
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const temp = items[index];
    items[index] = items[swap];
    items[swap] = temp;
  }
}

function chunkArray<T>(items: T[], chunks: number): T[][] {
  if (items.length === 0 || chunks <= 0) return [];
  const out = Array.from({ length: chunks }, () => [] as T[]);
  for (let index = 0; index < items.length; index += 1) {
    out[index % chunks].push(items[index]);
  }
  return out.filter((entries) => entries.length > 0);
}

function chunkNumberArray(items: number[], chunks: number): number[][] {
  return chunkArray(items, chunks);
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function hashFileShort(absolutePath: string): string {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex').slice(0, 12);
}

function hashText(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
}

function queenPressureTotal(state: ReturnType<typeof createLocalHiveGameState>): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function saveManifest(absolutePath: string, manifest: TournamentManifest): void {
  manifest.updatedAt = new Date().toISOString();
  writeJsonFile(absolutePath, manifest);
}

function saveBracket(absolutePath: string, bracket: TournamentBracket): void {
  writeJsonFile(absolutePath, bracket);
}

function writeJsonFile(absolutePath: string, payload: unknown): void {
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tempPath, absolutePath);
}

function readJsonFile<T>(absolutePath: string): T | null {
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function appendCapturedOutput(current: string, chunk: string, limit: number): string {
  if (chunk.length >= limit) return chunk.slice(-limit);
  const overflow = current.length + chunk.length - limit;
  if (overflow <= 0) return current + chunk;
  return current.slice(overflow) + chunk;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function parsePositiveFloat(value: string | undefined, flag: string, allowZero = false): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  const min = allowZero ? 0 : Number.EPSILON;
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseRatio(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseRatioZeroOne(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (!value) throw new Error('Missing value for --difficulty');
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseTrainerBackend(value: string | undefined): TrainerBackend {
  if (!value) throw new Error('Missing value for --trainer-backend');
  if (value === 'multiprocess' || value === 'single-process') return value;
  throw new Error(`Invalid --trainer-backend value: ${value}`);
}

function parseSearchBackend(value: string | undefined): SearchBackend {
  if (!value) throw new Error('Missing value for --search-backend');
  if (value === 'cpu' || value === 'gpu-batched' || value === 'python-batched') return value;
  throw new Error(`Invalid --search-backend value: ${value}`);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelpAndExit(): never {
  console.log('Usage: npm run hive:train:az:tournament -- --candidate-count <n> [options]');
  console.log('');
  console.log('Core:');
  console.log('  --candidate-count <n>          Required number of candidates to train');
  console.log('  --seed-base <n>                Candidate seed base (default: 1000)');
  console.log('  --tournament-seed <n>          Bracket + split seed (default: 20260322)');
  console.log('  --run-id <id>                  Reuse a specific tournament workspace');
  console.log('  --resume                       Resume the latest or specified workspace');
  console.log('  --finalist-count <n>           Number of finalists to champion gate (max 3, default: 3)');
  console.log('');
  console.log('Knockout:');
  console.log('  --draw-replay-limit <n>        Sudden-death draw replays before escalation (default: 3)');
  console.log('  --draw-escalation-games <n>    First mini-arena size after draw loop (default: 8)');
  console.log('  --draw-escalation-max-games <n> Maximum mini-arena size before repeating (default: 32)');
  console.log('  --knockout-simulations <n>     Optional simulations override for knockout games');
  console.log('  --knockout-workers <n>         Worker count for escalated mini-arenas');
  console.log('  --knockout-remote-worker <spec> Add SSH worker host=...,repo=...,workers=... for knockout matches');
  console.log('');
  console.log('Snapshot + Training:');
  console.log('  --init-model <path>            Initial learner model (fallback: champion)');
  console.log('  --champion-model <path>        Champion model to challenge');
  console.log('  --replay-path <path>           Replay buffer to freeze');
  console.log('  --reanalyse-fraction <0..1>    Optional one-time reanalysis ratio');
  console.log('  --reanalyse-workers <n>        Reanalysis worker count');
  console.log('  --trainer-backend <mode>       multiprocess|single-process (default: single-process)');
  console.log('  --multi-candidate-count <n>    Active candidates in single-process mode (default: auto, 8 on 24GiB+ hosts)');
  console.log('  --checkpoint-every-epoch       Save single-process checkpoints after each epoch');
  console.log('  --no-checkpoint-every-epoch    Disable epoch checkpoint saves');
  console.log('  --target-gpu-utilization <r>   Advisory single-process GPU target ratio (e.g. 0.90)');
  console.log('  --search-backend <mode>        cpu|gpu-batched|python-batched (default: cpu)');
  console.log('  --gpu-games-in-flight <n>      Local GPU arena/self-play concurrency for tournament search');
  console.log('  --gpu-batch-size <n>           Shared GPU inference max batch size');
  console.log('  --gpu-batch-delay-ms <n>       Shared GPU inference batch delay');
  console.log('  --train-concurrency <n>        Parallel batch trainer processes for multiprocess mode');
  console.log('  --epochs <n> --batch-size <n> --learning-rate <n> --weight-decay <n>');
  console.log('  --hidden <csv> --policy-target-temperature <n> --label-smoothing <n>');
  console.log('  --candidate-train-fraction <0..1>  Fixed per-candidate replay-train subset fraction (default: 0.9)');
  console.log('  --candidate-label-smoothing-jitter <0..1>  +/- label smoothing jitter per candidate (default: 0.01)');
  console.log('  --candidate-init-noise-std <n>     Tiny Gaussian init noise per candidate (default: 0.0015)');
  console.log('  --trainer-device <auto|cuda|cpu>');
  console.log('');
  console.log('Champion Gate:');
  console.log('  Forward any eval-arena option using --arena-*, for example:');
  console.log('    --arena-games 400 --arena-gate-mode sprt --arena-workers 6');
  console.log('  Use --arena-promote-out <path> or --promote-out <path> to override final promotion output');
  console.log('');
  console.log('Misc:');
  console.log('  --metrics-log <path>           Metrics JSONL path');
  console.log('  --continuous                   Start a fresh tournament cycle again after completion');
  console.log('  --dry-run                      Do not overwrite the real champion on promotion');
  console.log('  --verbose, -v                  Stream child process output');
  process.exit(0);
}

void main().catch((error) => {
  console.error(`[error] ${formatErrorMessage(error)}`);
  process.exit(1);
});
