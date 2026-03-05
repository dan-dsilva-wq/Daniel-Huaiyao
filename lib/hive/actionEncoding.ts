import type { Move, PieceType } from './types';

export interface DecodedActionKey {
  kind: 'place' | 'move' | 'pillbug';
  pieceType?: PieceType;
  pieceId?: string;
  targetPieceId?: string;
  q: number;
  r: number;
}

const KNOWN_PIECE_TYPES: readonly PieceType[] = [
  'queen',
  'beetle',
  'grasshopper',
  'spider',
  'ant',
  'ladybug',
  'mosquito',
  'pillbug',
] as const;

export function moveToActionKey(move: Move): string {
  if (move.type === 'place') {
    const pieceType = pieceTypeFromPieceId(move.pieceId);
    return `place:${pieceType ?? move.pieceId}:${move.to.q}:${move.to.r}`;
  }

  if (move.isPillbugAbility && move.targetPieceId) {
    return `pillbug:${move.pieceId}:${move.targetPieceId}:${move.to.q}:${move.to.r}`;
  }

  return `move:${move.pieceId}:${move.to.q}:${move.to.r}`;
}

export function parseActionKey(actionKey: string): DecodedActionKey | null {
  if (typeof actionKey !== 'string' || actionKey.length === 0) return null;
  const parts = actionKey.split(':');
  if (parts.length < 4) return null;

  const q = Number.parseInt(parts[parts.length - 2], 10);
  const r = Number.parseInt(parts[parts.length - 1], 10);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;

  if (parts[0] === 'place' && parts.length === 4) {
    const maybeType = parts[1];
    return {
      kind: 'place',
      pieceType: isPieceType(maybeType) ? maybeType : undefined,
      q,
      r,
    };
  }

  if (parts[0] === 'move' && parts.length === 4) {
    return {
      kind: 'move',
      pieceId: parts[1],
      q,
      r,
    };
  }

  if (parts[0] === 'pillbug' && parts.length === 5) {
    return {
      kind: 'pillbug',
      pieceId: parts[1],
      targetPieceId: parts[2],
      q,
      r,
    };
  }

  return null;
}

export function resolveActionKey(actionKey: string, legalMoves: readonly Move[]): Move | null {
  const index = buildActionLookup(legalMoves);
  return index.get(actionKey) ?? null;
}

export function buildActionLookup(legalMoves: readonly Move[]): Map<string, Move> {
  const lookup = new Map<string, Move>();
  for (const move of legalMoves) {
    const key = moveToActionKey(move);
    if (!lookup.has(key)) {
      lookup.set(key, move);
    }
  }
  return lookup;
}

export function dedupeMovesByActionKey(legalMoves: readonly Move[]): Move[] {
  return [...buildActionLookup(legalMoves).values()];
}

export function pieceTypeFromPieceId(pieceId: string): PieceType | null {
  const chunks = pieceId.split('-');
  if (chunks.length < 2) return null;
  const maybeType = chunks[1];
  return isPieceType(maybeType) ? maybeType : null;
}

function isPieceType(value: string): value is PieceType {
  return KNOWN_PIECE_TYPES.includes(value as PieceType);
}
