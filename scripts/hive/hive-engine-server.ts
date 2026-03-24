import { createInterface } from 'node:readline';
import {
  applyHiveMove,
  createLocalHiveGameState,
  getLegalMovesForColor,
} from '../../lib/hive/ai';
import {
  HIVE_DEFAULT_TOKEN_SLOTS,
  extractHiveActionFeatures,
  extractHiveTokenStateFeatures,
} from '../../lib/hive/ml';
import { moveToActionKey } from '../../lib/hive/actionEncoding';
import type { GameState, Move } from '../../lib/hive/types';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import { hashHiveState } from './gpu-mcts';

interface EngineRequest {
  id?: string | number | null;
  cmd?: string;
  payload?: Record<string, unknown>;
}

interface CreateGamePayload {
  games?: Array<{
    gameId?: string;
    shortCode?: string;
    whitePlayerId?: string | null;
    blackPlayerId?: string | null;
    stateId?: string;
  }>;
}

interface ApplyMovePayload {
  moves?: Array<{
    stateId?: string;
    nextStateId?: string;
    move?: Move;
  }>;
}

interface ExpandStatesPayload {
  stateIds?: string[];
}

interface ReleaseStatesPayload {
  stateIds?: string[];
}

const stateStore = new Map<string, GameState>();
let nextStateId = 1;

function emitResponse(
  id: string | number | null | undefined,
  ok: boolean,
  payload?: Record<string, unknown>,
  error?: string,
): void {
  const response: Record<string, unknown> = { id: id ?? null, ok };
  if (payload !== undefined) response.payload = payload;
  if (error) response.error = error;
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function log(message: string): void {
  process.stderr.write(`[hive-engine] ${message}\n`);
}

function allocateStateId(prefix = 'state'): string {
  const id = `${prefix}-${nextStateId}`;
  nextStateId += 1;
  return id;
}

function queenPressureTotal(state: GameState): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function ensureState(stateId: string): GameState {
  const state = stateStore.get(stateId);
  if (!state) {
    throw new Error(`Unknown stateId: ${stateId}`);
  }
  return state;
}

function summarizeStateBase(stateId: string, state: GameState): Record<string, unknown> {
  return {
    stateId,
    stateHash: hashHiveState(state),
    status: state.status,
    winner: state.winner,
    currentTurn: state.currentTurn,
    turnNumber: state.turnNumber,
    queenPressureTotal: queenPressureTotal(state),
  };
}

function expandState(stateId: string, state: GameState): Record<string, unknown> {
  const summary = summarizeStateBase(stateId, state);
  if (state.status !== 'playing') {
    return {
      ...summary,
      legalMoves: [],
      stateFeatures: [],
      actions: [],
    };
  }

  const perspective = state.currentTurn;
  const legalMoves = getLegalMovesForColor(state, perspective);
  return {
    ...summary,
    legalMoves,
    stateFeatures: extractHiveTokenStateFeatures(state, perspective, HIVE_DEFAULT_TOKEN_SLOTS),
    actions: legalMoves.map((move) => ({
      actionKey: moveToActionKey(move),
      move,
      actionFeatures: extractHiveActionFeatures(state, move, perspective),
    })),
  };
}

function handleCreateGames(payload: CreateGamePayload): Record<string, unknown> {
  const games = Array.isArray(payload.games) ? payload.games : [];
  const created = games.map((game, index) => {
    const state = createLocalHiveGameState({
      id: game.gameId ?? `engine-game-${Date.now()}-${index}`,
      shortCode: game.shortCode ?? 'ENGN',
      whitePlayerId: game.whitePlayerId ?? 'white',
      blackPlayerId: game.blackPlayerId ?? 'black',
    });
    const stateId = typeof game.stateId === 'string' && game.stateId.length > 0
      ? game.stateId
      : allocateStateId('game');
    stateStore.set(stateId, state);
    return summarizeStateBase(stateId, state);
  });
  return { states: created, stateCount: stateStore.size };
}

function handleExpandStates(payload: ExpandStatesPayload): Record<string, unknown> {
  const stateIds = Array.isArray(payload.stateIds) ? payload.stateIds : [];
  const states = stateIds.map((stateId) => expandState(stateId, ensureState(stateId)));
  return { states };
}

function handleApplyMoves(payload: ApplyMovePayload): Record<string, unknown> {
  const moves = Array.isArray(payload.moves) ? payload.moves : [];
  const results = moves.map((entry, index) => {
    const parentStateId = typeof entry.stateId === 'string' ? entry.stateId : '';
    const move = entry.move;
    if (!parentStateId || !move) {
      throw new Error(`Invalid apply_moves entry at index ${index}`);
    }
    const parentState = ensureState(parentStateId);
    const childState = applyHiveMove(parentState, move);
    const childStateId = typeof entry.nextStateId === 'string' && entry.nextStateId.length > 0
      ? entry.nextStateId
      : allocateStateId('state');
    stateStore.set(childStateId, childState);
    return {
      parentStateId,
      childStateId,
      ...summarizeStateBase(childStateId, childState),
    };
  });
  return { results, stateCount: stateStore.size };
}

function handleReleaseStates(payload: ReleaseStatesPayload): Record<string, unknown> {
  const stateIds = Array.isArray(payload.stateIds) ? payload.stateIds : [];
  let released = 0;
  for (const stateId of stateIds) {
    if (stateStore.delete(stateId)) {
      released += 1;
    }
  }
  return { released, stateCount: stateStore.size };
}

function handleStats(): Record<string, unknown> {
  return {
    stateCount: stateStore.size,
    nextStateId,
  };
}

async function main(): Promise<void> {
  const reader = createInterface({ input: process.stdin });
  log('ready');
  for await (const rawLine of reader) {
    const line = rawLine.trim();
    if (!line) continue;
    let request: EngineRequest;
    try {
      request = JSON.parse(line) as EngineRequest;
    } catch {
      emitResponse(null, false, undefined, 'Invalid JSON request');
      continue;
    }

    try {
      const payload = (request.payload ?? {}) as Record<string, unknown>;
      let result: Record<string, unknown>;
      switch (request.cmd) {
        case 'create_games':
          result = handleCreateGames(payload as CreateGamePayload);
          break;
        case 'expand_states':
          result = handleExpandStates(payload as ExpandStatesPayload);
          break;
        case 'apply_moves':
          result = handleApplyMoves(payload as ApplyMovePayload);
          break;
        case 'release_states':
          result = handleReleaseStates(payload as ReleaseStatesPayload);
          break;
        case 'stats':
          result = handleStats();
          break;
        case 'shutdown':
          emitResponse(request.id, true, { status: 'bye' });
          process.exit(0);
        default:
          throw new Error(`Unknown command: ${request.cmd ?? '<missing>'}`);
      }
      emitResponse(request.id, true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`error: ${message}`);
      emitResponse(request.id, false, undefined, message);
    }
  }
}

main().catch((error) => {
  log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
