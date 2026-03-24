import { cpus, totalmem } from 'node:os';

export interface HiveHardwareProfile {
  logicalCpuCount: number;
  totalMemoryGiB: number;
  selfPlayWorkers: number;
  evalWorkers: number;
  deepBatchSize: number;
  gpuSelfPlayGamesInFlight: number;
  gpuArenaGamesInFlight: number;
  gpuInferenceMaxBatchSize: number;
  gpuInferenceBatchDelayMs: number;
}

const DEFAULT_RESERVED_CPU = 1;
const DEFAULT_SELF_PLAY_CPU_FRACTION = 0.8;

export function getHiveHardwareProfile(): HiveHardwareProfile {
  const logicalCpuCount = Math.max(1, cpus().length || 1);
  const totalMemoryGiB = totalmem() / (1024 ** 3);

  const computedSelfPlayWorkers = computeCpuBudgetWorkers(
    logicalCpuCount,
    DEFAULT_SELF_PLAY_CPU_FRACTION,
  );
  const computedEvalWorkers = Math.max(1, logicalCpuCount - DEFAULT_RESERVED_CPU);
  const computedDeepBatchSize = pickDeepBatchSize(totalMemoryGiB, logicalCpuCount);
  const computedGpuSelfPlayGamesInFlight = pickGpuSelfPlayGamesInFlight(totalMemoryGiB, logicalCpuCount);
  const computedGpuArenaGamesInFlight = pickGpuArenaGamesInFlight(totalMemoryGiB, logicalCpuCount);
  const computedGpuInferenceMaxBatchSize = pickGpuInferenceMaxBatchSize(totalMemoryGiB, logicalCpuCount);
  const computedGpuInferenceBatchDelayMs = pickGpuInferenceBatchDelayMs(logicalCpuCount);

  const selfPlayWorkers = clampInt(
    readEnvPositiveInt('HIVE_SELF_PLAY_WORKERS') ?? computedSelfPlayWorkers,
    1,
    logicalCpuCount,
  );
  const evalWorkers = clampInt(
    readEnvPositiveInt('HIVE_EVAL_WORKERS') ?? computedEvalWorkers,
    1,
    logicalCpuCount,
  );
  const deepBatchSize = Math.max(
    128,
    readEnvPositiveInt('HIVE_DEEP_BATCH_SIZE') ?? computedDeepBatchSize,
  );
  const gpuSelfPlayGamesInFlight = Math.max(
    1,
    readEnvPositiveInt('HIVE_GPU_SELFPLAY_GAMES_IN_FLIGHT') ?? computedGpuSelfPlayGamesInFlight,
  );
  const gpuArenaGamesInFlight = Math.max(
    1,
    readEnvPositiveInt('HIVE_GPU_ARENA_GAMES_IN_FLIGHT') ?? computedGpuArenaGamesInFlight,
  );
  const gpuInferenceMaxBatchSize = Math.max(
    16,
    readEnvPositiveInt('HIVE_GPU_INFERENCE_MAX_BATCH_SIZE') ?? computedGpuInferenceMaxBatchSize,
  );
  const gpuInferenceBatchDelayMs = clampInt(
    readEnvPositiveInt('HIVE_GPU_INFERENCE_BATCH_DELAY_MS') ?? computedGpuInferenceBatchDelayMs,
    1,
    20,
  );

  return {
    logicalCpuCount,
    totalMemoryGiB,
    selfPlayWorkers,
    evalWorkers,
    deepBatchSize,
    gpuSelfPlayGamesInFlight,
    gpuArenaGamesInFlight,
    gpuInferenceMaxBatchSize,
    gpuInferenceBatchDelayMs,
  };
}

function pickDeepBatchSize(totalMemoryGiB: number, logicalCpuCount: number): number {
  if (totalMemoryGiB >= 48) return 8192;
  if (totalMemoryGiB >= 24) return 4096;
  if (totalMemoryGiB >= 16) return 2048;
  if (totalMemoryGiB >= 12) return 1024;
  return logicalCpuCount >= 8 ? 1024 : 512;
}

function pickGpuSelfPlayGamesInFlight(totalMemoryGiB: number, logicalCpuCount: number): number {
  if (totalMemoryGiB >= 48) return Math.max(8, Math.min(24, logicalCpuCount));
  if (totalMemoryGiB >= 24) return Math.max(6, Math.min(16, logicalCpuCount));
  if (totalMemoryGiB >= 16) return Math.max(4, Math.min(12, logicalCpuCount));
  return Math.max(2, Math.min(8, logicalCpuCount));
}

function pickGpuArenaGamesInFlight(totalMemoryGiB: number, logicalCpuCount: number): number {
  if (totalMemoryGiB >= 48) return Math.max(8, Math.min(24, logicalCpuCount));
  if (totalMemoryGiB >= 24) return Math.max(6, Math.min(16, logicalCpuCount));
  if (totalMemoryGiB >= 16) return Math.max(4, Math.min(12, logicalCpuCount));
  return Math.max(2, Math.min(8, logicalCpuCount));
}

function pickGpuInferenceMaxBatchSize(totalMemoryGiB: number, logicalCpuCount: number): number {
  if (totalMemoryGiB >= 48) return 1024;
  if (totalMemoryGiB >= 24) return 768;
  if (totalMemoryGiB >= 16) return 512;
  return logicalCpuCount >= 8 ? 256 : 128;
}

function pickGpuInferenceBatchDelayMs(logicalCpuCount: number): number {
  return logicalCpuCount >= 16 ? 1 : 2;
}

function readEnvPositiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function computeCpuBudgetWorkers(logicalCpuCount: number, cpuFraction: number): number {
  return Math.max(1, Math.min(logicalCpuCount, Math.floor(logicalCpuCount * cpuFraction)));
}
