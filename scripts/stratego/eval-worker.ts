import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ComputerDifficulty } from '../../lib/stratego/ai';
import { getActiveStrategoModel, type StrategoModel } from '../../lib/stratego/ml';
import {
  loadStrategoModelFromPath,
  runEvalBatch,
  type EvalAggregate,
  type EvalGameSummary,
} from './eval-core';

interface WorkerOptions {
  workerId: number;
  startGame: number;
  games: number;
  difficulty: ComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  candidateModelPath: string | null;
  baselineModelPath: string | null;
  outPath: string;
}

interface WorkerOutput {
  workerId: number;
  startGame: number;
  games: number;
  summaries: EvalGameSummary[];
  aggregate: EvalAggregate;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const candidateModel = loadCandidateModel(options.candidateModelPath);
  const baselineModel = loadBaselineModel(options.baselineModelPath);

  const batch = runEvalBatch(
    options.startGame,
    options.games,
    {
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      candidateModel,
      baselineModel,
    },
    (summary) => emitProgress(options.workerId, summary),
  );

  const output: WorkerOutput = {
    workerId: options.workerId,
    startGame: options.startGame,
    games: options.games,
    summaries: batch.summaries,
    aggregate: batch.aggregate,
  };

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${JSON.stringify(output)}\n`, 'utf8');
  console.log(
    `@@DONE ${JSON.stringify({
      workerId: options.workerId,
      outPath: options.outPath,
      games: options.games,
      candidateWins: batch.aggregate.candidateWins,
      baselineWins: batch.aggregate.baselineWins,
      draws: batch.aggregate.draws,
    })}`,
  );
}

function emitProgress(workerId: number, summary: EvalGameSummary): void {
  console.log(`@@PROGRESS ${JSON.stringify({ workerId, ...summary })}`);
}

function loadCandidateModel(modelPath: string | null): StrategoModel {
  if (!modelPath) {
    return getActiveStrategoModel();
  }
  return loadStrategoModelFromPath(modelPath);
}

function loadBaselineModel(modelPath: string | null): StrategoModel | null {
  if (!modelPath) {
    return null;
  }
  return loadStrategoModelFromPath(modelPath);
}

function parseOptions(argv: string[]): WorkerOptions {
  let workerId = 0;
  let startGame = 1;
  let games = 1;
  let difficulty: ComputerDifficulty = 'hard';
  let maxTurns = 500;
  let noCaptureDrawMoves = 160;
  let candidateModelPath: string | null = null;
  let baselineModelPath: string | null = null;
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
      case '--candidate-model':
        if (!nextValue) throw new Error('Missing value for --candidate-model');
        candidateModelPath = nextValue;
        index += 1;
        break;
      case '--baseline-model':
        if (!nextValue) throw new Error('Missing value for --baseline-model');
        baselineModelPath = nextValue;
        index += 1;
        break;
      case '--out':
        if (!nextValue) throw new Error('Missing value for --out');
        outPath = nextValue;
        index += 1;
        break;
      default:
        throw new Error(`Unknown worker arg: ${arg}`);
    }
  }

  if (!outPath) throw new Error('Missing required --out value');
  if (workerId <= 0) throw new Error('Missing required --worker-id');

  return {
    workerId,
    startGame,
    games,
    difficulty,
    maxTurns,
    noCaptureDrawMoves,
    candidateModelPath,
    baselineModelPath,
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
