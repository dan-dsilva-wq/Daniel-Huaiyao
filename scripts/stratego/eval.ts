import { spawn } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { ComputerDifficulty } from '../../lib/stratego/ai';
import { getActiveStrategoModel, type StrategoModel } from '../../lib/stratego/ml';
import {
  applySummaryToEvalAggregate,
  createEmptyEvalAggregate,
  describeStrategoModel,
  loadStrategoModelFromPath,
  mergeEvalAggregates,
  runEvalBatch,
  summarizeStrategoModel,
  type EvalAggregate,
  type EvalGameSummary,
  type EvalSource,
  type EvalTerminalReason,
} from './eval-core';

interface EvalOptions {
  games: number;
  difficulty: ComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  progressEvery: number;
  workers: number;
  verbose: boolean;
  modelPath: string | null;
  baselineModelPath: string | null;
  metricsLogPath: string;
}

interface WorkerAssignment {
  workerId: number;
  startGame: number;
  games: number;
  outPath: string;
}

interface WorkerProgressPayload {
  workerId: number;
  gameIndex: number;
  candidateColor: 'red' | 'blue';
  turnsPlayed: number;
  winner: 'red' | 'blue' | null;
  terminalReason: EvalTerminalReason;
  captureCount: number;
  longestNoCaptureStreak: number;
  durationMs: number;
}

interface WorkerDonePayload {
  workerId: number;
  outPath: string;
  games: number;
}

interface WorkerOutputFile {
  workerId: number;
  startGame: number;
  games: number;
  summaries: EvalGameSummary[];
  aggregate: EvalAggregate;
}

const DEFAULT_OPTIONS: EvalOptions = {
  games: 60,
  difficulty: 'extreme',
  maxTurns: 500,
  noCaptureDrawMoves: 160,
  progressEvery: 10,
  workers: Math.max(1, Math.min(8, cpus().length - 1)),
  verbose: false,
  modelPath: null,
  baselineModelPath: null,
  metricsLogPath: '.stratego-cache/metrics/training-metrics.jsonl',
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const candidateModel = options.modelPath
    ? loadStrategoModelFromPath(options.modelPath)
    : getActiveStrategoModel();
  const baselineModel = options.baselineModelPath
    ? loadStrategoModelFromPath(options.baselineModelPath)
    : null;
  const baselineSource: EvalSource = baselineModel ? 'model' : 'heuristic';
  const logger = createMetricsLogger(options.metricsLogPath);
  const runStarted = performance.now();

  const candidateModelPath = options.modelPath
    ? path.resolve(process.cwd(), options.modelPath)
    : path.resolve(process.cwd(), 'lib/stratego/trained-model.json');
  const baselineModelPath = options.baselineModelPath
    ? path.resolve(process.cwd(), options.baselineModelPath)
    : null;
  const mode = options.workers > 1 ? 'parallel' : 'single';

  console.log(
    `[eval:setup] games=${options.games} difficulty=${options.difficulty} workers=${options.workers} mode=${mode} maxTurns=${options.maxTurns} noCaptureDraw=${options.noCaptureDrawMoves} baseline=${baselineSource}`,
  );
  console.log(
    `[eval:setup] candidate=${describeStrategoModel(candidateModel)} path=${candidateModelPath}`,
  );
  if (baselineModelPath) {
    console.log(`[eval:setup] baseline=${describeStrategoModel(baselineModel)} path=${baselineModelPath}`);
  } else {
    console.log('[eval:setup] baseline=heuristic-only (model blend disabled)');
  }

  logger.log('run_start', {
    options: {
      games: options.games,
      difficulty: options.difficulty,
      workers: options.workers,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      progressEvery: options.progressEvery,
      candidateModelPath,
      baselineModelPath,
      baselineSource,
      mode,
    },
    candidateModel: summarizeStrategoModel(candidateModel),
    baselineModel: baselineModel ? summarizeStrategoModel(baselineModel) : null,
    pid: process.pid,
  });

  const aggregate = await runEval(options, runStarted, {
    candidateModel,
    baselineModel,
    candidateModelPath: options.modelPath ? candidateModelPath : null,
    baselineModelPath: options.baselineModelPath ? baselineModelPath : null,
  });

  const elapsedMs = performance.now() - runStarted;
  const candidateScore = (aggregate.candidateWins + aggregate.draws * 0.5) / aggregate.games;
  const avgTurns = aggregate.totalTurns / aggregate.games;
  const avgCaptures = aggregate.totalCaptures / aggregate.games;

  console.log(
    `[eval:done] games=${aggregate.games} score=${(candidateScore * 100).toFixed(1)}% W/L/D=${aggregate.candidateWins}/${aggregate.baselineWins}/${aggregate.draws} avg_turns=${avgTurns.toFixed(1)} avg_captures=${avgCaptures.toFixed(1)} elapsed=${formatDuration(elapsedMs)}`,
  );

  logger.log('benchmark_result', {
    games: aggregate.games,
    difficulty: options.difficulty,
    workers: options.workers,
    maxTurns: options.maxTurns,
    noCaptureDrawMoves: options.noCaptureDrawMoves,
    candidateWins: aggregate.candidateWins,
    baselineWins: aggregate.baselineWins,
    draws: aggregate.draws,
    candidateScore,
    winRate: aggregate.candidateWins / aggregate.games,
    drawRate: aggregate.draws / aggregate.games,
    lossRate: aggregate.baselineWins / aggregate.games,
    avgTurns,
    avgCaptures,
    maxTurnsDraws: aggregate.maxTurnsDraws,
    noCaptureDraws: aggregate.noCaptureDraws,
    baselineSource,
    candidateModel: summarizeStrategoModel(candidateModel),
    baselineModel: baselineModel ? summarizeStrategoModel(baselineModel) : null,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
  });

  logger.log('run_end', {
    status: 'completed',
    games: aggregate.games,
    candidateScore,
    candidateWins: aggregate.candidateWins,
    baselineWins: aggregate.baselineWins,
    draws: aggregate.draws,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
  });
}

async function runEval(
  options: EvalOptions,
  startedAtMs: number,
  models: {
    candidateModel: StrategoModel;
    baselineModel: StrategoModel | null;
    candidateModelPath: string | null;
    baselineModelPath: string | null;
  },
): Promise<EvalAggregate> {
  if (options.workers <= 1) {
    return runEvalSingleProcess(options, startedAtMs, models.candidateModel, models.baselineModel);
  }
  return runEvalParallel(options, startedAtMs, models.candidateModelPath, models.baselineModelPath);
}

function runEvalSingleProcess(
  options: EvalOptions,
  startedAtMs: number,
  candidateModel: StrategoModel,
  baselineModel: StrategoModel | null,
): EvalAggregate {
  const aggregate = createEmptyEvalAggregate();
  runEvalBatch(
    1,
    options.games,
    {
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      candidateModel,
      baselineModel,
    },
    (summary) => {
      applySummaryToEvalAggregate(aggregate, summary);
      maybeLogProgress(options, aggregate, summary, startedAtMs);
    },
  );
  return aggregate;
}

async function runEvalParallel(
  options: EvalOptions,
  startedAtMs: number,
  candidateModelPath: string | null,
  baselineModelPath: string | null,
): Promise<EvalAggregate> {
  const workerCount = Math.min(options.workers, options.games);
  const workerScriptPath = path.resolve(process.cwd(), 'scripts/stratego/eval-worker.ts');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'stratego-eval-'));
  const assignments = buildWorkerAssignments(options.games, workerCount, tempDir);
  const progressAggregate = createEmptyEvalAggregate();

  try {
    const workerResults = await Promise.all(
      assignments.map((assignment) => runEvalWorker(
        workerScriptPath,
        assignment,
        options,
        candidateModelPath,
        baselineModelPath,
        (summary, workerId) => {
          applySummaryToEvalAggregate(progressAggregate, summary);
          maybeLogProgress(options, progressAggregate, summary, startedAtMs, workerId);
        },
      )),
    );

    const aggregate = createEmptyEvalAggregate();
    for (const result of workerResults) {
      mergeEvalAggregates(aggregate, result.aggregate);
    }
    return aggregate;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runEvalWorker(
  workerScriptPath: string,
  assignment: WorkerAssignment,
  options: EvalOptions,
  candidateModelPath: string | null,
  baselineModelPath: string | null,
  onProgress: (summary: EvalGameSummary, workerId: number) => void,
): Promise<WorkerOutputFile> {
  return new Promise((resolve, reject) => {
    const args = [
      '--import',
      'tsx',
      workerScriptPath,
      '--worker-id',
      String(assignment.workerId),
      '--start-game',
      String(assignment.startGame),
      '--games',
      String(assignment.games),
      '--difficulty',
      options.difficulty,
      '--max-turns',
      String(options.maxTurns),
      '--no-capture-draw',
      String(options.noCaptureDrawMoves),
      '--out',
      assignment.outPath,
    ];
    if (candidateModelPath) {
      args.push('--candidate-model', candidateModelPath);
    }
    if (baselineModelPath) {
      args.push('--baseline-model', baselineModelPath);
    }

    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let donePayload: WorkerDonePayload | null = null;

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith('@@PROGRESS ')) {
        const payload = JSON.parse(trimmed.slice('@@PROGRESS '.length)) as WorkerProgressPayload;
        const summary: EvalGameSummary = {
          gameIndex: payload.gameIndex,
          candidateColor: payload.candidateColor,
          turnsPlayed: payload.turnsPlayed,
          winner: payload.winner,
          terminalReason: payload.terminalReason,
          captureCount: payload.captureCount,
          longestNoCaptureStreak: payload.longestNoCaptureStreak,
          durationMs: payload.durationMs,
        };
        onProgress(summary, payload.workerId);
        return;
      }

      if (trimmed.startsWith('@@DONE ')) {
        donePayload = JSON.parse(trimmed.slice('@@DONE '.length)) as WorkerDonePayload;
        return;
      }

      if (options.verbose) {
        console.log(`[eval-worker:${assignment.workerId}] ${trimmed}`);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      stdoutBuffer = processBufferedLines(stdoutBuffer, handleLine);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrBuffer += text;
      if (options.verbose) {
        process.stderr.write(`[eval-worker:${assignment.workerId}] ${text}`);
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (stdoutBuffer.trim().length > 0) {
        handleLine(stdoutBuffer);
      }

      if (code !== 0) {
        reject(
          new Error(
            `Eval worker ${assignment.workerId} failed with code ${code}.\n${stderrBuffer.trim()}`,
          ),
        );
        return;
      }

      if (!donePayload) {
        reject(new Error(`Eval worker ${assignment.workerId} exited without @@DONE payload.`));
        return;
      }

      if (donePayload.outPath !== assignment.outPath) {
        reject(new Error(`Eval worker ${assignment.workerId} returned unexpected output path.`));
        return;
      }

      const raw = readFileSync(assignment.outPath, 'utf8');
      const parsed = JSON.parse(raw) as WorkerOutputFile;
      resolve(parsed);
    });
  });
}

function buildWorkerAssignments(
  games: number,
  workerCount: number,
  tempDir: string,
): WorkerAssignment[] {
  const assignments: WorkerAssignment[] = [];
  const baseGames = Math.floor(games / workerCount);
  const extra = games % workerCount;
  let nextStartGame = 1;

  for (let workerId = 1; workerId <= workerCount; workerId += 1) {
    const batchSize = baseGames + (workerId <= extra ? 1 : 0);
    if (batchSize <= 0) continue;

    assignments.push({
      workerId,
      startGame: nextStartGame,
      games: batchSize,
      outPath: path.join(tempDir, `eval-worker-${workerId}.json`),
    });
    nextStartGame += batchSize;
  }

  return assignments;
}

function maybeLogProgress(
  options: EvalOptions,
  aggregate: EvalAggregate,
  summary: EvalGameSummary,
  startedAtMs: number,
  workerId?: number,
): void {
  const shouldLog = options.verbose
    || aggregate.games % options.progressEvery === 0
    || aggregate.games === options.games;
  if (!shouldLog) return;

  const elapsedMs = performance.now() - startedAtMs;
  const etaMs = estimateRemainingMs(elapsedMs, aggregate.games, options.games);
  const winnerLabel = summary.winner ?? 'draw';
  const score = aggregate.candidateWins + aggregate.draws * 0.5;
  const workerLabel = workerId ? ` worker=${workerId}` : '';
  const prefix = options.verbose ? '[eval:game]' : '[eval]';
  console.log(
    `${prefix} ${aggregate.games}/${options.games}${workerLabel} game=${summary.gameIndex} candidate=${summary.candidateColor} winner=${winnerLabel} reason=${summary.terminalReason} turns=${summary.turnsPlayed} captures=${summary.captureCount} max_no_cap=${summary.longestNoCaptureStreak} score=${score.toFixed(1)}/${aggregate.games} W/L/D=${aggregate.candidateWins}/${aggregate.baselineWins}/${aggregate.draws} elapsed=${formatDuration(elapsedMs)} eta=${formatDuration(etaMs)}`,
  );
}

function processBufferedLines(buffer: string, onLine: (line: string) => void): string {
  let nextNewline = buffer.indexOf('\n');
  while (nextNewline !== -1) {
    const line = buffer.slice(0, nextNewline);
    onLine(line);
    buffer = buffer.slice(nextNewline + 1);
    nextNewline = buffer.indexOf('\n');
  }
  return buffer;
}

function parseOptions(argv: string[]): EvalOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsageAndExit();
  }

  const options: EvalOptions = { ...DEFAULT_OPTIONS };
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
      case '--progress-every':
        options.progressEvery = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--workers':
        options.workers = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--model':
        if (!next) throw new Error('Missing value for --model');
        options.modelPath = next;
        index += 1;
        break;
      case '--baseline-model':
        if (!next) throw new Error('Missing value for --baseline-model');
        options.baselineModelPath = next;
        index += 1;
        break;
      case '--metrics-log':
        if (!next) throw new Error('Missing value for --metrics-log');
        options.metricsLogPath = next;
        index += 1;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  if (options.progressEvery > options.games) {
    options.progressEvery = options.games;
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

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function printUsageAndExit(): never {
  console.log('Usage: npm run stratego:eval -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --games <n>            Number of benchmark games (default: 60)');
  console.log('  --difficulty <d>       medium|hard|extreme search strength (default: extreme)');
  console.log('  --max-turns <n>        Max turns before draw (default: 500)');
  console.log('  --no-capture-draw <n>  Draw when no capture occurs for N moves (default: 160, 0 disables)');
  console.log('  --workers <n>          Parallel worker processes (default: min(8, CPU cores - 1))');
  console.log('  --progress-every <n>   Print interval in games (default: 10)');
  console.log('  --model <path>         Candidate model JSON path (default: lib/stratego/trained-model.json)');
  console.log('  --baseline-model <p>   Optional baseline model path (default: heuristic-only baseline)');
  console.log('  --metrics-log <path>   Metrics JSONL path (default: .stratego-cache/metrics/training-metrics.jsonl)');
  console.log('  --verbose, -v          Print every game');
  process.exit(0);
}

function estimateRemainingMs(elapsedMs: number, completed: number, total: number): number {
  if (completed <= 0 || total <= completed) return 0;
  return (elapsedMs / completed) * (total - completed);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

function createMetricsLogger(metricsLogPath: string): {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
} {
  const runId = `eval-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const absolutePath = path.resolve(process.cwd(), metricsLogPath);
  let warned = false;

  const log = (eventType: string, payload: Record<string, unknown>) => {
    try {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      appendFileSync(
        absolutePath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          source: 'eval',
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

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
