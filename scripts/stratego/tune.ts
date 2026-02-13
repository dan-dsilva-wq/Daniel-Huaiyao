import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ComputerDifficulty } from '../../lib/stratego/ai';
import { getActiveStrategoModel } from '../../lib/stratego/ml';
import { getStrategoHardwareProfile } from './hardware-profile';

interface TuneOptions {
  architectures: string;
  games: number;
  difficulty: ComputerDifficulty;
  workers: number;
  maxTurns: number;
  noCaptureDrawMoves: number;
  progressEvery: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
  weightDecay: number;
  earlyStopPatience: number;
  earlyStopMinDelta: number;
  earlyStopMinEpochs: number;
  evalGames: number;
  evalDifficulty: ComputerDifficulty;
  evalWorkers: number;
  evalMaxTurns: number;
  evalNoCaptureDrawMoves: number;
  evalProgressEvery: number;
  summaryOut: string;
  keepArtifacts: boolean;
  verbose: boolean;
}

interface CandidateResult {
  architecture: string;
  modelPath: string;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  avgTurns: number;
  avgCaptures: number;
  elapsedSeconds: number;
}

interface TuneSummary {
  ts: string;
  durationSeconds: number;
  options: {
    games: number;
    difficulty: ComputerDifficulty;
    workers: number;
    maxTurns: number;
    noCaptureDrawMoves: number;
    epochs: number;
    batchSize: number;
    learningRate: number;
    weightDecay: number;
    earlyStopPatience: number;
    earlyStopMinDelta: number;
    earlyStopMinEpochs: number;
    evalGames: number;
    evalDifficulty: ComputerDifficulty;
    evalWorkers: number;
    evalMaxTurns: number;
    evalNoCaptureDrawMoves: number;
  };
  architecturesTried: string[];
  best: CandidateResult;
  candidates: CandidateResult[];
  selectedModelPath: string;
}

interface EvalBenchmarkResult {
  candidateScore: number;
  candidateWins: number;
  baselineWins: number;
  draws: number;
  avgTurns: number;
  avgCaptures: number;
  elapsedSeconds: number;
}

const HARDWARE_PROFILE = getStrategoHardwareProfile();

const DEFAULT_OPTIONS: TuneOptions = {
  architectures: 'auto',
  games: 120,
  difficulty: 'extreme',
  workers: HARDWARE_PROFILE.selfPlayWorkers,
  maxTurns: 500,
  noCaptureDrawMoves: 160,
  progressEvery: 20,
  epochs: 60,
  batchSize: HARDWARE_PROFILE.deepBatchSize,
  learningRate: 0.0015,
  weightDecay: 0.0001,
  earlyStopPatience: 6,
  earlyStopMinDelta: 0.002,
  earlyStopMinEpochs: 10,
  evalGames: 40,
  evalDifficulty: 'extreme',
  evalWorkers: HARDWARE_PROFILE.evalWorkers,
  evalMaxTurns: 500,
  evalNoCaptureDrawMoves: 160,
  evalProgressEvery: 10,
  summaryOut: '.stratego-cache/tune/last-tune.json',
  keepArtifacts: false,
  verbose: true,
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const architectures = resolveArchitectures(options.architectures);
  const startedAt = performance.now();
  const runDir = mkdtempSync(path.join(tmpdir(), 'stratego-tune-'));
  const datasetPath = path.join(runDir, 'dataset.json');
  const deepScriptPath = path.resolve(process.cwd(), 'scripts/stratego/train-model-deep.py');
  const trainModelScriptPath = path.resolve(process.cwd(), 'scripts/stratego/train-model.ts');
  const evalScriptPath = path.resolve(process.cwd(), 'scripts/stratego/eval.ts');
  const selectedModelPath = path.resolve(process.cwd(), 'lib/stratego/trained-model.json');

  try {
    console.log(`[tune:setup] architectures=${architectures.join(' | ')}`);
    console.log(
      `[tune:setup] hardware cpu=${HARDWARE_PROFILE.logicalCpuCount} ram=${HARDWARE_PROFILE.totalMemoryGiB.toFixed(1)}GiB default_workers=${HARDWARE_PROFILE.selfPlayWorkers} default_eval_workers=${HARDWARE_PROFILE.evalWorkers} default_batch=${HARDWARE_PROFILE.deepBatchSize}`,
    );
    console.log(
      `[tune:setup] self-play games=${options.games} difficulty=${options.difficulty} workers=${options.workers} maxTurns=${options.maxTurns} noCaptureDraw=${options.noCaptureDrawMoves}`,
    );
    console.log(
      `[tune:setup] deep epochs=${options.epochs} earlyStop=${options.earlyStopPatience}/${options.earlyStopMinDelta}/${options.earlyStopMinEpochs}`,
    );
    console.log(
      `[tune:setup] eval games=${options.evalGames} difficulty=${options.evalDifficulty} workers=${options.evalWorkers}`,
    );

    await runTsxScript(trainModelScriptPath, [
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
      datasetPath,
      '--skip-fit',
      ...(options.verbose ? ['--verbose'] : []),
    ]);

    const results: CandidateResult[] = [];
    for (const architecture of architectures) {
      const slug = architecture.replace(/[^0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const modelPath = path.join(runDir, `model-${slug || 'candidate'}.json`);
      const checkpointPath = path.join(runDir, `checkpoint-${slug || 'candidate'}.ckpt`);
      const trainMetricsPath = path.join(runDir, `train-metrics-${slug || 'candidate'}.jsonl`);
      const evalMetricsPath = path.join(runDir, `eval-metrics-${slug || 'candidate'}.jsonl`);

      console.log(`[tune:candidate] training hidden=${architecture}`);
      await runPythonWithFallback([
        deepScriptPath,
        '--dataset',
        datasetPath,
        '--out',
        modelPath,
        '--epochs',
        String(options.epochs),
        '--batch-size',
        String(options.batchSize),
        '--lr',
        String(options.learningRate),
        '--weight-decay',
        String(options.weightDecay),
        '--hidden',
        architecture,
        '--checkpoint',
        checkpointPath,
        '--save-every',
        '1',
        '--metrics-log',
        trainMetricsPath,
        '--no-resume',
        '--no-warm-start',
        '--early-stop-patience',
        String(options.earlyStopPatience),
        '--early-stop-min-delta',
        String(options.earlyStopMinDelta),
        '--early-stop-min-epochs',
        String(options.earlyStopMinEpochs),
      ]);

      console.log(`[tune:candidate] evaluating hidden=${architecture}`);
      await runTsxScript(evalScriptPath, [
        '--games',
        String(options.evalGames),
        '--difficulty',
        options.evalDifficulty,
        '--workers',
        String(options.evalWorkers),
        '--max-turns',
        String(options.evalMaxTurns),
        '--no-capture-draw',
        String(options.evalNoCaptureDrawMoves),
        '--progress-every',
        String(options.evalProgressEvery),
        '--model',
        modelPath,
        '--metrics-log',
        evalMetricsPath,
      ]);

      const benchmark = readLatestBenchmarkResult(evalMetricsPath);
      const result: CandidateResult = {
        architecture,
        modelPath,
        score: benchmark.candidateScore,
        wins: benchmark.candidateWins,
        losses: benchmark.baselineWins,
        draws: benchmark.draws,
        avgTurns: benchmark.avgTurns,
        avgCaptures: benchmark.avgCaptures,
        elapsedSeconds: benchmark.elapsedSeconds,
      };
      results.push(result);
      console.log(
        `[tune:candidate] hidden=${architecture} score=${(result.score * 100).toFixed(1)}% W/L/D=${result.wins}/${result.losses}/${result.draws} avg_turns=${result.avgTurns.toFixed(1)}`,
      );
    }

    const best = selectBestCandidate(results);
    copyFileSync(best.modelPath, selectedModelPath);

    const durationSeconds = Number(((performance.now() - startedAt) / 1000).toFixed(3));
    const summary: TuneSummary = {
      ts: new Date().toISOString(),
      durationSeconds,
      options: {
        games: options.games,
        difficulty: options.difficulty,
        workers: options.workers,
        maxTurns: options.maxTurns,
        noCaptureDrawMoves: options.noCaptureDrawMoves,
        epochs: options.epochs,
        batchSize: options.batchSize,
        learningRate: options.learningRate,
        weightDecay: options.weightDecay,
        earlyStopPatience: options.earlyStopPatience,
        earlyStopMinDelta: options.earlyStopMinDelta,
        earlyStopMinEpochs: options.earlyStopMinEpochs,
        evalGames: options.evalGames,
        evalDifficulty: options.evalDifficulty,
        evalWorkers: options.evalWorkers,
        evalMaxTurns: options.evalMaxTurns,
        evalNoCaptureDrawMoves: options.evalNoCaptureDrawMoves,
      },
      architecturesTried: architectures,
      best,
      candidates: results,
      selectedModelPath,
    };
    writeSummary(options.summaryOut, summary);

    console.log(
      `[tune:done] best hidden=${best.architecture} score=${(best.score * 100).toFixed(1)}% W/L/D=${best.wins}/${best.losses}/${best.draws} duration=${formatDuration(durationSeconds * 1000)}`,
    );
    console.log(`[tune:done] model selected -> ${selectedModelPath}`);
    console.log(`[tune:done] summary -> ${path.resolve(process.cwd(), options.summaryOut)}`);
  } finally {
    if (!options.keepArtifacts) {
      rmSync(runDir, { recursive: true, force: true });
    } else {
      console.log(`[tune] kept artifacts in ${runDir}`);
    }
  }
}

function resolveArchitectures(raw: string): string[] {
  if (raw.trim().toLowerCase() === 'auto') {
    return buildAutoArchitectures();
  }

  const parsed = raw
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeArchitecture)
    .filter((entry) => entry.length > 0)
    .map((entry) => entry.join(','));

  const unique = [...new Set(parsed)];
  if (unique.length === 0) {
    throw new Error('No valid architectures resolved from --architectures');
  }
  return unique;
}

function buildAutoArchitectures(): string[] {
  const model = getActiveStrategoModel();
  const base = model.kind === 'mlp'
    ? model.layers.slice(0, -1).map((layer) => layer.outputSize)
    : [96, 48];
  const normalizedBase = normalizeArchitecture(base.join(','));
  const smaller = normalizedBase.map((width) => Math.max(16, Math.round(width * 0.8)));
  const larger = normalizedBase.map((width) => Math.max(16, Math.round(width * 1.25)));
  const deeper = [...normalizedBase, Math.max(16, Math.round(normalizedBase[normalizedBase.length - 1] * 0.6))];
  const deeperLarge = [...larger, Math.max(16, Math.round(larger[larger.length - 1] * 0.6))];

  const candidates = [normalizedBase, smaller, larger, deeper, deeperLarge]
    .map((entry) => entry.join(','));
  return [...new Set(candidates)];
}

function normalizeArchitecture(value: string): number[] {
  return value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((width) => Number.isFinite(width) && width > 0)
    .map((width) => Math.max(8, width));
}

function readLatestBenchmarkResult(metricsPath: string): EvalBenchmarkResult {
  const raw = readFileSync(metricsPath, 'utf8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.eventType !== 'benchmark_result') continue;
      return {
        candidateScore: toNumber(event.candidateScore),
        candidateWins: toInteger(event.candidateWins),
        baselineWins: toInteger(event.baselineWins),
        draws: toInteger(event.draws),
        avgTurns: toNumber(event.avgTurns),
        avgCaptures: toNumber(event.avgCaptures),
        elapsedSeconds: toNumber(event.elapsedSeconds),
      };
    } catch {
      // ignore malformed line
    }
  }
  throw new Error(`No benchmark_result found in ${metricsPath}`);
}

function selectBestCandidate(results: CandidateResult[]): CandidateResult {
  if (results.length === 0) throw new Error('No candidate results to select from.');
  const ordered = [...results].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftWinRate = left.wins / Math.max(1, left.wins + left.losses + left.draws);
    const rightWinRate = right.wins / Math.max(1, right.wins + right.losses + right.draws);
    if (rightWinRate !== leftWinRate) return rightWinRate - leftWinRate;
    return left.avgTurns - right.avgTurns;
  });
  return ordered[0];
}

function writeSummary(summaryPath: string, summary: TuneSummary): void {
  const absolutePath = path.resolve(process.cwd(), summaryPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function runPythonWithFallback(args: string[]): Promise<void> {
  const attempts: Array<{ command: string; commandArgs: string[]; label: string }> = [
    { command: 'python', commandArgs: args, label: 'python' },
    { command: 'py', commandArgs: ['-3', ...args], label: 'py -3' },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      await runCommand(attempt.command, attempt.commandArgs);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[tune] ${attempt.label} failed: ${lastError.message}`);
    }
  }

  throw new Error(
    `Unable to start Python trainer. Ensure Python and PyTorch are installed. Last error: ${lastError?.message ?? 'unknown'}`,
  );
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
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

async function runTsxScript(scriptPath: string, args: string[]): Promise<void> {
  await runCommand(process.execPath, ['--import', 'tsx', scriptPath, ...args]);
}

function parseOptions(argv: string[]): TuneOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsageAndExit();
  }

  const options: TuneOptions = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--architectures':
        if (!next) throw new Error('Missing value for --architectures');
        options.architectures = next;
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
      case '--workers':
        options.workers = parsePositiveInt(next, arg);
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
      case '--eval-games':
        options.evalGames = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--eval-difficulty':
        options.evalDifficulty = parseDifficulty(next);
        index += 1;
        break;
      case '--eval-workers':
        options.evalWorkers = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--eval-max-turns':
        options.evalMaxTurns = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--eval-no-capture-draw':
        options.evalNoCaptureDrawMoves = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--eval-progress-every':
        options.evalProgressEvery = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--summary-out':
        if (!next) throw new Error('Missing value for --summary-out');
        options.summaryOut = next;
        index += 1;
        break;
      case '--keep-artifacts':
        options.keepArtifacts = true;
        break;
      case '--no-verbose':
        options.verbose = false;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  if (options.workers > options.games) options.workers = options.games;
  if (options.evalWorkers > options.evalGames) options.evalWorkers = options.evalGames;

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

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
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

function toNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value;
}

function toInteger(value: unknown): number {
  return Math.trunc(toNumber(value));
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

function printUsageAndExit(): never {
  console.log('Usage: npm run stratego:tune -- [options]');
  console.log('');
  console.log('Architecture options:');
  console.log('  --architectures <list>     "auto" or pipe-separated list, e.g. "96,48|128,64,32|192,96,48"');
  console.log('');
  console.log('Self-play dataset options:');
  console.log('  --games <n>                Self-play game count (default: 120)');
  console.log('  --difficulty <d>           medium|hard|extreme (default: extreme)');
  console.log(`  --workers <n>              Self-play workers (default: ${DEFAULT_OPTIONS.workers})`);
  console.log('  --max-turns <n>            Max turns per game (default: 500)');
  console.log('  --no-capture-draw <n>      Draw on N no-capture moves (default: 160)');
  console.log('  --progress-every <n>       Self-play progress interval (default: 20)');
  console.log('');
  console.log('Deep train options per candidate:');
  console.log('  --epochs <n>               Epoch cap (default: 60)');
  console.log(`  --batch-size <n>           Batch size (default: ${DEFAULT_OPTIONS.batchSize})`);
  console.log('  --lr <n>                   Learning rate (default: 0.0015)');
  console.log('  --weight-decay <n>         Weight decay (default: 0.0001)');
  console.log('  --early-stop-patience <n>  Patience (default: 6, 0 disables)');
  console.log('  --early-stop-min-delta <n> Min val_mse gain (default: 0.002)');
  console.log('  --early-stop-min-epochs <n> Earliest early-stop epoch (default: 10)');
  console.log('');
  console.log('Benchmark eval options per candidate:');
  console.log('  --eval-games <n>           Eval games (default: 40)');
  console.log('  --eval-difficulty <d>      medium|hard|extreme (default: extreme)');
  console.log(`  --eval-workers <n>         Eval workers (default: ${DEFAULT_OPTIONS.evalWorkers})`);
  console.log('  --eval-max-turns <n>       Eval max turns (default: 500)');
  console.log('  --eval-no-capture-draw <n> Eval no-capture draw (default: 160)');
  console.log('  --eval-progress-every <n>  Eval progress interval (default: 10)');
  console.log('');
  console.log('Output options:');
  console.log('  --summary-out <path>       Tune summary JSON path (default: .stratego-cache/tune/last-tune.json)');
  console.log('  --keep-artifacts           Keep temporary dataset/model artifacts');
  console.log('  --verbose, -v              Verbose self-play generation (default on)');
  console.log('  --no-verbose               Disable verbose self-play generation');
  process.exit(0);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
