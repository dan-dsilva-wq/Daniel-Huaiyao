import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildRemoteNodeTsxSshArgs,
  copyFileFromRemote,
  copyFileToRemote,
  createRemoteDirectory,
  parseRemoteWorkerSpec,
  removeRemoteDirectory,
  runSubprocess,
  sanitizeRemotePathSegment,
} from './remote-worker';

type SelfPlaySampleOrigin = 'learner' | 'champion';

interface WorkerOptions {
  remoteWorker: string;
  games: number;
  difficulty: 'medium' | 'hard' | 'extreme';
  maxTurns: number;
  noCaptureDrawMoves: number;
  simulations: number;
  fastSimulations: number;
  fastRatio: number;
  seed: number;
  modelPath: string;
  sampleOrigin: SelfPlaySampleOrigin;
  outPath: string;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const remoteSpec = parseRemoteWorkerSpec(options.remoteWorker, '--remote-worker');
  const runId = sanitizeRemotePathSegment(`remote-selfplay-${process.pid}-${Date.now()}-${options.seed}`);
  const runDirRelativePath = remoteSpec.platform === 'windows'
    ? path.win32.join('.hive-cache', 'remote-selfplay', runId)
    : path.posix.join('.hive-cache', 'remote-selfplay', runId);
  const runDirAbsolutePath = remoteSpec.platform === 'windows'
    ? path.win32.join(remoteSpec.repo, runDirRelativePath)
    : path.posix.join(remoteSpec.repo, runDirRelativePath);
  const remoteModelPath = remoteSpec.platform === 'windows'
    ? path.win32.join(runDirAbsolutePath, 'model.json')
    : path.posix.join(runDirAbsolutePath, 'model.json');
  const remoteOutPath = remoteSpec.platform === 'windows'
    ? path.win32.join(runDirAbsolutePath, 'chunk.json')
    : path.posix.join(runDirAbsolutePath, 'chunk.json');

  let remoteReady = false;
  try {
    await createRemoteDirectory(remoteSpec, runDirAbsolutePath);
    remoteReady = true;
  } catch (error) {
    logStageFailure('bootstrap', error);
    process.exitCode = 1;
    return;
  }

  try {
    await copyFileToRemote(remoteSpec, path.resolve(process.cwd(), options.modelPath), remoteModelPath);
  } catch (error) {
    logStageFailure('model copy', error);
    await cleanupRemoteRunDir(remoteSpec, runDirAbsolutePath);
    process.exitCode = 1;
    return;
  }

  try {
    await runSubprocess('ssh', buildRemoteNodeTsxSshArgs(
      remoteSpec,
      'scripts/hive/az-selfplay-worker.ts',
      [
        '--games', String(options.games),
        '--difficulty', options.difficulty,
        '--max-turns', String(options.maxTurns),
        '--no-capture-draw', String(options.noCaptureDrawMoves),
        '--simulations', String(options.simulations),
        '--fast-simulations', String(options.fastSimulations),
        '--fast-ratio', String(options.fastRatio),
        '--seed', String(options.seed),
        '--model', remoteModelPath,
        '--sample-origin', options.sampleOrigin,
        '--out', remoteOutPath,
      ],
    ));
  } catch (error) {
    logStageFailure('remote worker launch', error);
    await cleanupRemoteRunDir(remoteSpec, runDirAbsolutePath);
    process.exitCode = 1;
    return;
  }

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  try {
    await copyFileFromRemote(remoteSpec, remoteOutPath, path.resolve(process.cwd(), options.outPath));
  } catch (error) {
    logStageFailure('chunk copy-back', error);
    await cleanupRemoteRunDir(remoteSpec, runDirAbsolutePath);
    process.exitCode = 1;
    return;
  }

  if (remoteReady) {
    await cleanupRemoteRunDir(remoteSpec, runDirAbsolutePath);
  }
}

async function cleanupRemoteRunDir(
  remoteSpec: ReturnType<typeof parseRemoteWorkerSpec>,
  runDirAbsolutePath: string,
): Promise<void> {
  try {
    await removeRemoteDirectory(remoteSpec, runDirAbsolutePath);
  } catch (error) {
    logStageFailure('remote cleanup', error);
  }
}

function logStageFailure(stage: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[az-remote-selfplay] ${stage} failed: ${message}`);
}

function parseOptions(argv: string[]): WorkerOptions {
  const options: Partial<WorkerOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--remote-worker':
        options.remoteWorker = requireValue(next, arg);
        index += 1;
        break;
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
      case '--simulations':
        options.simulations = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--fast-simulations':
        options.fastSimulations = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--fast-ratio':
        options.fastRatio = parseRatioZeroOne(next, arg);
        index += 1;
        break;
      case '--seed':
        options.seed = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--model':
        options.modelPath = requireValue(next, arg);
        index += 1;
        break;
      case '--sample-origin':
        options.sampleOrigin = parseSampleOrigin(next, arg);
        index += 1;
        break;
      case '--out':
        options.outPath = requireValue(next, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    remoteWorker: requireValue(options.remoteWorker, '--remote-worker'),
    games: options.games ?? failMissing('--games'),
    difficulty: options.difficulty ?? failMissing('--difficulty'),
    maxTurns: options.maxTurns ?? failMissing('--max-turns'),
    noCaptureDrawMoves: options.noCaptureDrawMoves ?? 0,
    simulations: options.simulations ?? failMissing('--simulations'),
    fastSimulations: options.fastSimulations ?? failMissing('--fast-simulations'),
    fastRatio: options.fastRatio ?? failMissing('--fast-ratio'),
    seed: options.seed ?? failMissing('--seed'),
    modelPath: requireValue(options.modelPath, '--model'),
    sampleOrigin: options.sampleOrigin ?? failMissing('--sample-origin'),
    outPath: requireValue(options.outPath, '--out'),
  };
}

function parseDifficulty(value: string | undefined): WorkerOptions['difficulty'] {
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseSampleOrigin(value: string | undefined, flag: string): SelfPlaySampleOrigin {
  if (value === 'learner' || value === 'champion') return value;
  throw new Error(`Invalid value for ${flag}: ${value}`);
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

function parseRatioZeroOne(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function failMissing(flag: string): never {
  throw new Error(`Missing value for ${flag}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[az-remote-selfplay] fatal: ${message}`);
  process.exit(1);
});
