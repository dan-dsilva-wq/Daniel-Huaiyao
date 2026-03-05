import { performance } from 'node:perf_hooks';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  oppositeColor,
  type HiveComputerDifficulty,
} from '../../lib/hive/ai';
import { extractHiveFeatures } from '../../lib/hive/ml';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import type { GameState, PlayerColor } from '../../lib/hive/types';

export interface TrainingSample {
  features: number[];
  target: number;
}

interface PendingSample {
  features: number[];
  perspective: PlayerColor;
}

export interface SelfPlayOptions {
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  traceTurns: boolean;
  traceLog?: (line: string) => void;
}

export type SelfPlayTerminalReason =
  | 'queen_surrounded'
  | 'no_moves'
  | 'max_turns'
  | 'no_capture_streak';

export interface SelfPlayGameSummary {
  gameIndex: number;
  turnsPlayed: number;
  winner: PlayerColor | null;
  terminalReason: SelfPlayTerminalReason;
  samplesAdded: number;
  noProgressStreak: number;
  durationMs: number;
}

export interface SelfPlayGameResult {
  finalState: GameState;
  samples: TrainingSample[];
  summary: SelfPlayGameSummary;
}

export interface SelfPlayBatchResult {
  samples: TrainingSample[];
  summaries: SelfPlayGameSummary[];
  whiteWins: number;
  blackWins: number;
  draws: number;
}

export function runSelfPlayBatch(
  startGameIndex: number,
  games: number,
  options: SelfPlayOptions,
  onGameComplete?: (summary: SelfPlayGameSummary) => void,
): SelfPlayBatchResult {
  const samples: TrainingSample[] = [];
  const summaries: SelfPlayGameSummary[] = [];
  let whiteWins = 0;
  let blackWins = 0;
  let draws = 0;

  for (let offset = 0; offset < games; offset += 1) {
    const gameIndex = startGameIndex + offset;
    const result = runSelfPlayGame(gameIndex, options);
    summaries.push(result.summary);
    samples.push(...result.samples);
    onGameComplete?.(result.summary);

    if (result.summary.winner === 'white') whiteWins += 1;
    else if (result.summary.winner === 'black') blackWins += 1;
    else draws += 1;
  }

  return {
    samples,
    summaries,
    whiteWins,
    blackWins,
    draws,
  };
}

export function runSelfPlayGame(gameIndex: number, options: SelfPlayOptions): SelfPlayGameResult {
  const startedAt = performance.now();
  let state = createSelfPlayState(gameIndex);
  const pending: PendingSample[] = [];
  let terminalReason: SelfPlayTerminalReason = 'max_turns';

  let noProgressStreak = 0;
  let prevPressure = queenPressureTotal(state);

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    pending.push({
      features: extractHiveFeatures(state, 'white'),
      perspective: 'white',
    });
    pending.push({
      features: extractHiveFeatures(state, 'black'),
      perspective: 'black',
    });

    const activeColor = state.currentTurn;
    const chosenMove = chooseHiveMoveForColor(state, activeColor, options.difficulty);

    if (!chosenMove) {
      if (options.traceTurns) {
        options.traceLog?.(`game=${gameIndex} turn=${state.turnNumber} ${activeColor} has no legal moves`);
      }
      state = finishNoMovesState(state, activeColor);
      terminalReason = 'no_moves';
      break;
    }

    if (options.traceTurns) {
      const moveLabel = chosenMove.type === 'place'
        ? `place:${chosenMove.pieceId} -> (${chosenMove.to.q},${chosenMove.to.r})`
        : `move:${chosenMove.pieceId} -> (${chosenMove.to.q},${chosenMove.to.r})`;
      options.traceLog?.(`game=${gameIndex} turn=${state.turnNumber} ${activeColor} ${moveLabel}`);
    }

    state = applyHiveMove(state, chosenMove);

    const currentPressure = queenPressureTotal(state);
    if (currentPressure !== prevPressure) {
      noProgressStreak = 0;
      prevPressure = currentPressure;
    } else {
      noProgressStreak += 1;
    }

    if (options.noCaptureDrawMoves > 0 && noProgressStreak >= options.noCaptureDrawMoves) {
      terminalReason = 'no_capture_streak';
      if (options.traceTurns) {
        options.traceLog?.(`game=${gameIndex} reached no-progress draw threshold (${options.noCaptureDrawMoves})`);
      }
      state = {
        ...state,
        status: 'finished',
        winner: 'draw',
      };
      break;
    }

    if (state.status === 'finished') {
      terminalReason = 'queen_surrounded';
    }
  }

  if (state.status === 'playing') {
    terminalReason = 'max_turns';
    state = {
      ...state,
      status: 'finished',
      winner: 'draw',
    };
  }

  const whiteOutcome = state.winner === 'white' ? 1 : state.winner === 'black' ? -1 : 0;
  const samples = pending.map((sample) => ({
    features: sample.features,
    target: sample.perspective === 'white' ? whiteOutcome : -whiteOutcome,
  }));

  const summary: SelfPlayGameSummary = {
    gameIndex,
    turnsPlayed: state.turnNumber,
    winner: state.winner === 'draw' ? null : state.winner,
    terminalReason,
    samplesAdded: samples.length,
    noProgressStreak,
    durationMs: performance.now() - startedAt,
  };

  return {
    finalState: state,
    samples,
    summary,
  };
}

function createSelfPlayState(gameIndex: number): GameState {
  return createLocalHiveGameState({
    id: `selfplay-${Date.now()}-${gameIndex}`,
    shortCode: 'SELF',
    whitePlayerId: 'selfplay-white',
    blackPlayerId: 'selfplay-black',
  });
}

function queenPressureTotal(state: GameState): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function finishNoMovesState(state: GameState, activeColor: PlayerColor): GameState {
  return {
    ...state,
    status: 'finished',
    winner: oppositeColor(activeColor),
  };
}
