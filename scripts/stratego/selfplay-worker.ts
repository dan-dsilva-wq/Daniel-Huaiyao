import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ComputerDifficulty } from '../../lib/stratego/ai';
import { runSelfPlayBatch, type SelfPlayBatchResult, type SelfPlayGameSummary } from './training-core';

interface WorkerOptions {
  workerId: number;
  startGame: number;
  games: number;
  difficulty: ComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  traceTurns: boolean;
  outPath: string;
}

interface WorkerOutput {
  workerId: number;
  startGame: number;
  games: number;
  redWins: number;
  blueWins: number;
  draws: number;
  summaries: SelfPlayGameSummary[];
  samples: SelfPlayBatchResult['samples'];
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const batch = runSelfPlayBatch(
    options.startGame,
    options.games,
    {
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      traceTurns: options.traceTurns,
      traceLog: options.traceTurns
        ? (line) => emitTrace(options.workerId, line)
        : undefined,
    },
    (summary) => emitProgress(options.workerId, summary),
  );

  const output: WorkerOutput = {
    workerId: options.workerId,
    startGame: options.startGame,
    games: options.games,
    redWins: batch.redWins,
    blueWins: batch.blueWins,
    draws: batch.draws,
    summaries: batch.summaries,
    samples: batch.samples,
  };

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${JSON.stringify(output)}\n`, 'utf8');
  console.log(
    `@@DONE ${JSON.stringify({
      workerId: options.workerId,
      outPath: options.outPath,
      games: options.games,
      samples: batch.samples.length,
    })}`,
  );
}

function emitProgress(workerId: number, summary: SelfPlayGameSummary): void {
  console.log(`@@PROGRESS ${JSON.stringify({ workerId, ...summary })}`);
}

function emitTrace(workerId: number, line: string): void {
  console.log(`@@TRACE ${JSON.stringify({ workerId, line })}`);
}

function parseOptions(argv: string[]): WorkerOptions {
  let workerId = 0;
  let startGame = 1;
  let games = 1;
  let difficulty: ComputerDifficulty = 'hard';
  let maxTurns = 500;
  let noCaptureDrawMoves = 160;
  let traceTurns = false;
  let outPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    switch (arg) {
      case '--worker-id':
        workerId = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--start-game':
        startGame = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--games':
        games = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--difficulty':
        difficulty = parseDifficulty(nextValue);
        index += 1;
        break;
      case '--max-turns':
        maxTurns = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--no-capture-draw':
        noCaptureDrawMoves = parseNonNegativeInt(nextValue, arg);
        index += 1;
        break;
      case '--out':
        if (!nextValue) throw new Error('Missing value for --out');
        outPath = nextValue;
        index += 1;
        break;
      case '--trace-turns':
        traceTurns = true;
        break;
      default:
        throw new Error(`Unknown worker arg: ${arg}`);
    }
  }

  if (!outPath) throw new Error('Missing required --out value');

  return {
    workerId,
    startGame,
    games,
    difficulty,
    maxTurns,
    noCaptureDrawMoves,
    traceTurns,
    outPath,
  };
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

main();
