import { cpus, totalmem } from 'node:os';

export interface StrategoHardwareProfile {
  logicalCpuCount: number;
  totalMemoryGiB: number;
  selfPlayWorkers: number;
  evalWorkers: number;
  deepBatchSize: number;
}

const DEFAULT_RESERVED_CPU = 1;

export function getStrategoHardwareProfile(): StrategoHardwareProfile {
  const logicalCpuCount = Math.max(1, cpus().length || 1);
  const totalMemoryGiB = totalmem() / (1024 ** 3);

  const computedSelfPlayWorkers = Math.max(1, logicalCpuCount - DEFAULT_RESERVED_CPU);
  const computedEvalWorkers = Math.max(1, logicalCpuCount - DEFAULT_RESERVED_CPU);
  const computedDeepBatchSize = pickDeepBatchSize(totalMemoryGiB, logicalCpuCount);

  const selfPlayWorkers = clampInt(
    readEnvPositiveInt('STRATEGO_SELF_PLAY_WORKERS') ?? computedSelfPlayWorkers,
    1,
    logicalCpuCount,
  );
  const evalWorkers = clampInt(
    readEnvPositiveInt('STRATEGO_EVAL_WORKERS') ?? computedEvalWorkers,
    1,
    logicalCpuCount,
  );
  const deepBatchSize = Math.max(
    128,
    readEnvPositiveInt('STRATEGO_DEEP_BATCH_SIZE') ?? computedDeepBatchSize,
  );

  return {
    logicalCpuCount,
    totalMemoryGiB,
    selfPlayWorkers,
    evalWorkers,
    deepBatchSize,
  };
}

function pickDeepBatchSize(totalMemoryGiB: number, logicalCpuCount: number): number {
  if (totalMemoryGiB >= 48) return 4096;
  if (totalMemoryGiB >= 24) return 2048;
  if (totalMemoryGiB >= 12) return 1024;
  return logicalCpuCount >= 8 ? 1024 : 512;
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
