import { performance } from 'node:perf_hooks';
import {
  applyStrategoMove,
  chooseStrategoMoveForColor,
  createDeterminizedPerspectiveState,
  type ComputerDifficulty,
  type LocalStrategoState,
} from '../../lib/stratego/ai';
import { generateRandomSetup } from '../../lib/stratego/constants';
import { extractStrategoFeatures } from '../../lib/stratego/ml';
import type { Piece, TeamColor, WinReason } from '../../lib/stratego/types';

export interface TrainingSample {
  features: number[];
  target: number;
}

interface PendingSample {
  features: number[];
  perspective: TeamColor;
}

export interface SelfPlayOptions {
  difficulty: ComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  traceTurns: boolean;
  traceLog?: (line: string) => void;
}

export type SelfPlayTerminalReason = WinReason | 'max_turns' | 'no_capture_streak';

export interface SelfPlayGameSummary {
  gameIndex: number;
  turnsPlayed: number;
  winner: TeamColor | null;
  winReason: WinReason | null;
  terminalReason: SelfPlayTerminalReason;
  samplesAdded: number;
  captureCount: number;
  longestNoCaptureStreak: number;
  durationMs: number;
}

export interface SelfPlayGameResult {
  finalState: LocalStrategoState;
  samples: TrainingSample[];
  summary: SelfPlayGameSummary;
}

export interface SelfPlayBatchResult {
  samples: TrainingSample[];
  summaries: SelfPlayGameSummary[];
  redWins: number;
  blueWins: number;
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
  let redWins = 0;
  let blueWins = 0;
  let draws = 0;

  for (let offset = 0; offset < games; offset += 1) {
    const gameIndex = startGameIndex + offset;
    const result = runSelfPlayGame(gameIndex, options);
    summaries.push(result.summary);
    samples.push(...result.samples);
    onGameComplete?.(result.summary);

    if (result.summary.winner === 'red') redWins += 1;
    else if (result.summary.winner === 'blue') blueWins += 1;
    else draws += 1;
  }

  return {
    samples,
    summaries,
    redWins,
    blueWins,
    draws,
  };
}

export function runSelfPlayGame(
  gameIndex: number,
  options: SelfPlayOptions,
): SelfPlayGameResult {
  const startedAt = performance.now();
  let state = createSelfPlayState(gameIndex);
  const pending: PendingSample[] = [];
  let captureCount = 0;
  let noCaptureStreak = 0;
  let longestNoCaptureStreak = 0;
  let terminalReason: SelfPlayTerminalReason = 'max_turns';

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const redPerspectiveState = createDeterminizedPerspectiveState(state, 'red');
    const bluePerspectiveState = createDeterminizedPerspectiveState(state, 'blue');

    pending.push({
      features: extractStrategoFeatures(redPerspectiveState, 'red'),
      perspective: 'red',
    });
    pending.push({
      features: extractStrategoFeatures(bluePerspectiveState, 'blue'),
      perspective: 'blue',
    });

    const activeColor = state.currentTurn;
    const chosenMove = chooseStrategoMoveForColor(state, activeColor, options.difficulty);

    if (!chosenMove) {
      if (options.traceTurns) {
        options.traceLog?.(`game=${gameIndex} turn=${state.turnNumber} ${activeColor} has no legal moves`);
      }
      state = finishNoMovesState(state, activeColor);
      terminalReason = 'no_moves';
      break;
    }

    if (options.traceTurns) {
      const attackLabel = chosenMove.isAttack
        ? ` attack_vs=${chosenMove.defenderRank ?? '?'}`
        : '';
      options.traceLog?.(
        `game=${gameIndex} turn=${state.turnNumber} ${activeColor} ${chosenMove.pieceId} (${chosenMove.fromRow},${chosenMove.fromCol})->(${chosenMove.toRow},${chosenMove.toCol})${attackLabel}`,
      );
    }

    const result = applyStrategoMove(state, activeColor, {
      pieceId: chosenMove.pieceId,
      toRow: chosenMove.toRow,
      toCol: chosenMove.toCol,
    });
    state = result.state;

    if (result.combatResult) {
      captureCount += 1;
      noCaptureStreak = 0;
    } else {
      noCaptureStreak += 1;
      longestNoCaptureStreak = Math.max(longestNoCaptureStreak, noCaptureStreak);
    }

    if (options.noCaptureDrawMoves > 0 && noCaptureStreak >= options.noCaptureDrawMoves) {
      terminalReason = 'no_capture_streak';
      if (options.traceTurns) {
        options.traceLog?.(
          `game=${gameIndex} reached no-capture draw threshold (${options.noCaptureDrawMoves}) -> draw`,
        );
      }
      state = {
        ...state,
        status: 'finished',
        winner: null,
        winReason: null,
        updatedAt: new Date().toISOString(),
      };
      break;
    }

    if (result.state.status === 'finished') {
      terminalReason = result.state.winReason ?? 'max_turns';
    }

    if (options.traceTurns && result.state.status === 'finished') {
      options.traceLog?.(
        `game=${gameIndex} finished winner=${result.state.winner ?? 'draw'} reason=${result.state.winReason ?? 'draw'}`,
      );
    }
  }

  if (state.status === 'playing') {
    terminalReason = 'max_turns';
    if (options.traceTurns) {
      options.traceLog?.(`game=${gameIndex} reached max turns (${options.maxTurns}) -> draw`);
    }
    state = {
      ...state,
      status: 'finished',
      winner: null,
      winReason: null,
      updatedAt: new Date().toISOString(),
    };
  }

  const redOutcome = state.winner === 'red' ? 1 : state.winner === 'blue' ? -1 : 0;
  const samples = pending.map((sample) => ({
    features: sample.features,
    target: sample.perspective === 'red' ? redOutcome : -redOutcome,
  }));

  const summary: SelfPlayGameSummary = {
    gameIndex,
    turnsPlayed: state.moveHistory.length,
    winner: state.winner,
    winReason: state.winReason,
    terminalReason,
    samplesAdded: samples.length,
    captureCount,
    longestNoCaptureStreak,
    durationMs: performance.now() - startedAt,
  };

  return {
    finalState: state,
    samples,
    summary,
  };
}

function createSelfPlayState(gameIndex: number): LocalStrategoState {
  const now = new Date().toISOString();
  return {
    id: `selfplay-${Date.now()}-${gameIndex}`,
    status: 'playing',
    currentTurn: 'red',
    turnNumber: 1,
    redPieces: createSetupPieces('red', gameIndex),
    bluePieces: createSetupPieces('blue', gameIndex),
    redCaptured: [],
    blueCaptured: [],
    moveHistory: [],
    winner: null,
    winReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createSetupPieces(color: TeamColor, gameIndex: number): Piece[] {
  const setup = generateRandomSetup(color);
  return setup.map((piece, index) => ({
    id: `${color}_${gameIndex}_${index}`,
    rank: piece.rank,
    row: piece.row,
    col: piece.col,
    revealed: false,
  }));
}

function finishNoMovesState(
  state: LocalStrategoState,
  activeColor: TeamColor,
): LocalStrategoState {
  const winner = activeColor === 'red' ? 'blue' : 'red';
  return {
    ...state,
    status: 'finished',
    winner,
    winReason: 'no_moves',
    updatedAt: new Date().toISOString(),
  };
}
