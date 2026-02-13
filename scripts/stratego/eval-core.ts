import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  applyStrategoMove,
  chooseStrategoMoveForColor,
  type ComputerDifficulty,
  type LocalStrategoState,
} from '../../lib/stratego/ai';
import { generateRandomSetup } from '../../lib/stratego/constants';
import { parseStrategoModel, type StrategoModel } from '../../lib/stratego/ml';
import type { Piece, TeamColor, WinReason } from '../../lib/stratego/types';

export type EvalSource = 'heuristic' | 'model';
export type EvalTerminalReason = WinReason | 'max_turns' | 'no_capture_streak';

export interface EvalGameOptions {
  difficulty: ComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  candidateModel: StrategoModel;
  baselineModel: StrategoModel | null;
}

export interface EvalGameSummary {
  gameIndex: number;
  candidateColor: TeamColor;
  turnsPlayed: number;
  winner: TeamColor | null;
  terminalReason: EvalTerminalReason;
  captureCount: number;
  longestNoCaptureStreak: number;
  durationMs: number;
}

export interface EvalAggregate {
  games: number;
  candidateWins: number;
  baselineWins: number;
  draws: number;
  totalTurns: number;
  totalCaptures: number;
  maxTurnsDraws: number;
  noCaptureDraws: number;
}

export interface EvalBatchResult {
  summaries: EvalGameSummary[];
  aggregate: EvalAggregate;
}

export function runEvalBatch(
  startGameIndex: number,
  games: number,
  options: EvalGameOptions,
  onGameComplete?: (summary: EvalGameSummary) => void,
): EvalBatchResult {
  const summaries: EvalGameSummary[] = [];
  const aggregate = createEmptyEvalAggregate();

  for (let offset = 0; offset < games; offset += 1) {
    const gameIndex = startGameIndex + offset;
    const summary = runEvalGame(gameIndex, options);
    summaries.push(summary);
    applySummaryToEvalAggregate(aggregate, summary);
    onGameComplete?.(summary);
  }

  return {
    summaries,
    aggregate,
  };
}

export function runEvalGame(gameIndex: number, options: EvalGameOptions): EvalGameSummary {
  const startedAt = performance.now();
  let state = createEvalState(gameIndex);
  let terminalReason: EvalTerminalReason = 'max_turns';
  let captureCount = 0;
  let noCaptureStreak = 0;
  let longestNoCaptureStreak = 0;
  const candidateColor: TeamColor = gameIndex % 2 === 0 ? 'blue' : 'red';

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const activeColor = state.currentTurn;
    const candidateTurn = activeColor === candidateColor;
    const chosenMove = chooseStrategoMoveForColor(
      state,
      activeColor,
      options.difficulty,
      candidateTurn
        ? { modelOverride: options.candidateModel }
        : options.baselineModel
          ? { modelOverride: options.baselineModel }
          : { disableModelBlend: true },
    );

    if (!chosenMove) {
      state = finishNoMovesState(state, activeColor);
      terminalReason = 'no_moves';
      break;
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
      state = {
        ...state,
        status: 'finished',
        winner: null,
        winReason: null,
        updatedAt: new Date().toISOString(),
      };
      break;
    }

    if (state.status === 'finished') {
      terminalReason = state.winReason ?? 'max_turns';
      break;
    }
  }

  if (state.status === 'playing') {
    terminalReason = 'max_turns';
    state = {
      ...state,
      status: 'finished',
      winner: null,
      winReason: null,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    gameIndex,
    candidateColor,
    turnsPlayed: state.moveHistory.length,
    winner: state.winner,
    terminalReason,
    captureCount,
    longestNoCaptureStreak,
    durationMs: performance.now() - startedAt,
  };
}

export function createEmptyEvalAggregate(): EvalAggregate {
  return {
    games: 0,
    candidateWins: 0,
    baselineWins: 0,
    draws: 0,
    totalTurns: 0,
    totalCaptures: 0,
    maxTurnsDraws: 0,
    noCaptureDraws: 0,
  };
}

export function applySummaryToEvalAggregate(
  aggregate: EvalAggregate,
  summary: EvalGameSummary,
): void {
  aggregate.games += 1;
  aggregate.totalTurns += summary.turnsPlayed;
  aggregate.totalCaptures += summary.captureCount;
  if (summary.terminalReason === 'max_turns') aggregate.maxTurnsDraws += 1;
  if (summary.terminalReason === 'no_capture_streak') aggregate.noCaptureDraws += 1;

  if (!summary.winner) {
    aggregate.draws += 1;
    return;
  }

  if (summary.winner === summary.candidateColor) {
    aggregate.candidateWins += 1;
  } else {
    aggregate.baselineWins += 1;
  }
}

export function mergeEvalAggregates(target: EvalAggregate, source: EvalAggregate): void {
  target.games += source.games;
  target.candidateWins += source.candidateWins;
  target.baselineWins += source.baselineWins;
  target.draws += source.draws;
  target.totalTurns += source.totalTurns;
  target.totalCaptures += source.totalCaptures;
  target.maxTurnsDraws += source.maxTurnsDraws;
  target.noCaptureDraws += source.noCaptureDraws;
}

export function loadStrategoModelFromPath(filePath: string): StrategoModel {
  const absolutePath = path.resolve(process.cwd(), filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read model from ${absolutePath}: ${message}`);
  }

  const model = parseStrategoModel(parsed);
  if (!model) {
    throw new Error(`Invalid model format: ${absolutePath}`);
  }

  return model;
}

export function describeStrategoModel(model: StrategoModel | null): string {
  if (!model) return 'none';
  const kind = model.kind ?? 'linear';
  return `${kind} samples=${model.training.positionSamples} generatedAt=${model.training.generatedAt}`;
}

export function summarizeStrategoModel(model: StrategoModel) {
  return {
    kind: model.kind ?? 'linear',
    generatedAt: model.training.generatedAt,
    positionSamples: model.training.positionSamples,
    games: model.training.games,
    epochs: model.training.epochs,
    difficulty: model.training.difficulty,
    framework: model.training.framework ?? null,
    device: model.training.device ?? null,
  };
}

function createEvalState(gameIndex: number): LocalStrategoState {
  const now = new Date().toISOString();
  return {
    id: `eval-${Date.now()}-${gameIndex}`,
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
  return generateRandomSetup(color).map((piece, index) => ({
    id: `${color}_eval_${gameIndex}_${index}`,
    rank: piece.rank,
    row: piece.row,
    col: piece.col,
    revealed: false,
  }));
}

function finishNoMovesState(state: LocalStrategoState, activeColor: TeamColor): LocalStrategoState {
  const winner = activeColor === 'red' ? 'blue' : 'red';
  return {
    ...state,
    status: 'finished',
    winner,
    winReason: 'no_moves',
    updatedAt: new Date().toISOString(),
  };
}
