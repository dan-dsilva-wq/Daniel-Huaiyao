import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { HiveComputerDifficulty } from '../../lib/hive/ai';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  getLegalMovesForColor,
  oppositeColor,
} from '../../lib/hive/ai';
import { parseHiveModel, type HiveModel } from '../../lib/hive/ml';
import type { Move, PlayerColor } from '../../lib/hive/types';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';

interface WorkerModelRef {
  hash: string;
  path?: string;
  raw?: string;
}

interface WorkerTask {
  taskId: string;
  seed: number;
  leftCandidateColor: PlayerColor;
  leftModel: WorkerModelRef;
  rightModel: WorkerModelRef;
  difficulty: HiveComputerDifficulty;
  simulations: number | null;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
}

interface WorkerResult {
  taskId: string;
  winnerSide: 'left' | 'right' | 'draw';
  turns: number;
  leftCandidateColor: PlayerColor;
  error?: string;
}

const modelCache = new Map<string, HiveModel>();

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let task: WorkerTask;
    try {
      task = JSON.parse(trimmed) as WorkerTask;
      const result = runTask(task);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result: WorkerResult = {
        taskId: typeof task?.taskId === 'string' ? task.taskId : 'unknown',
        winnerSide: 'draw',
        turns: 0,
        leftCandidateColor: (task?.leftCandidateColor === 'black' ? 'black' : 'white'),
        error: message,
      };
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
  }
}

function runTask(task: WorkerTask): WorkerResult {
  const leftModel = loadWorkerModel(task.leftModel);
  const rightModel = loadWorkerModel(task.rightModel);
  const rng = createRng(task.seed);
  let state = createLocalHiveGameState({
    id: `tournament-${Date.now()}-${task.seed}`,
    shortCode: 'TRNY',
    whitePlayerId: task.leftCandidateColor === 'white' ? 'left' : 'right',
    blackPlayerId: task.leftCandidateColor === 'black' ? 'left' : 'right',
  });

  let noProgress = 0;
  let prevPressure = queenPressureTotal(state);
  let openingPly = 0;

  while (state.status === 'playing' && state.turnNumber <= task.maxTurns) {
    const activeColor = state.currentTurn;
    const isLeftTurn = activeColor === task.leftCandidateColor;
    let move: Move | null = null;

    if (openingPly < task.openingRandomPlies) {
      const legal = getLegalMovesForColor(state, activeColor);
      if (legal.length > 0) {
        move = legal[Math.floor(rng() * legal.length)];
      }
      openingPly += 1;
    } else {
      move = chooseHiveMoveForColor(
        state,
        activeColor,
        task.difficulty,
        {
          modelOverride: isLeftTurn ? leftModel : rightModel,
          engine: 'alphazero',
          mctsConfig: task.simulations ? { simulations: task.simulations } : undefined,
          randomSeed: task.seed + state.turnNumber * 163,
        },
      );
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
    if (task.noCaptureDrawMoves > 0 && noProgress >= task.noCaptureDrawMoves) {
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
    : state.winner === task.leftCandidateColor
      ? 'left'
      : 'right';

  return {
    taskId: task.taskId,
    winnerSide,
    turns: state.turnNumber,
    leftCandidateColor: task.leftCandidateColor,
  };
}

function loadWorkerModel(ref: WorkerModelRef): HiveModel {
  const cached = modelCache.get(ref.hash);
  if (cached) return cached;

  const raw = typeof ref.raw === 'string'
    ? ref.raw
    : typeof ref.path === 'string'
      ? readFileSync(ref.path, 'utf8')
      : null;
  if (!raw) {
    throw new Error(`Worker model payload missing for hash ${ref.hash}`);
  }
  const parsed = JSON.parse(raw) as unknown;
  const model = parseHiveModel(parsed);
  if (!model) {
    throw new Error(`Invalid Hive model payload for hash ${ref.hash}`);
  }
  modelCache.set(ref.hash, model);
  return model;
}

function queenPressureTotal(state: ReturnType<typeof createLocalHiveGameState>): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function createRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[knockout-worker] Fatal error: ${message}`);
  process.exitCode = 1;
});
