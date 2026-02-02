// Hive Game Types

export type PlayerColor = 'white' | 'black';

export type PieceType =
  | 'queen'
  | 'beetle'
  | 'grasshopper'
  | 'spider'
  | 'ant'
  | 'ladybug'
  | 'mosquito'
  | 'pillbug';

export type ExpansionPiece = 'ladybug' | 'mosquito' | 'pillbug';

export interface HexCoord {
  q: number; // column (axial coordinate)
  r: number; // row (axial coordinate)
}

export interface Piece {
  id: string;
  type: PieceType;
  color: PlayerColor;
}

export interface PlacedPiece extends Piece {
  position: HexCoord;
  stackOrder: number; // 0 = bottom, higher = on top (for beetles)
}

export interface GameSettings {
  turnTimerMinutes: number;
  expansionPieces: {
    ladybug: boolean;
    mosquito: boolean;
    pillbug: boolean;
  };
}

export interface PlayerHand {
  pieces: Piece[];
}

export interface GameState {
  id: string;
  shortCode: string;
  status: 'waiting' | 'playing' | 'finished';

  whitePlayerId: string | null;
  blackPlayerId: string | null;
  currentTurn: PlayerColor;
  turnNumber: number;

  settings: GameSettings;

  board: PlacedPiece[];
  whiteHand: Piece[];
  blackHand: Piece[];

  whiteQueenPlaced: boolean;
  blackQueenPlaced: boolean;

  lastMovedPiece: { pieceId: string; byPillbug: boolean; from?: HexCoord; to: HexCoord; isPlacement: boolean } | null;

  turnStartedAt: string | null;
  winner: PlayerColor | 'draw' | null;
  createdAt: string;
}

export interface Move {
  type: 'place' | 'move';
  pieceId: string;
  from?: HexCoord; // For 'move' type
  to: HexCoord;
  isPillbugAbility?: boolean;
  targetPieceId?: string; // For pillbug moving another piece
}

// Standard piece counts per player
export const PIECE_COUNTS: Record<PieceType, number> = {
  queen: 1,
  beetle: 2,
  grasshopper: 3,
  spider: 2,
  ant: 3,
  ladybug: 1,
  mosquito: 1,
  pillbug: 1,
};

// Create initial hand for a player
export function createInitialHand(color: PlayerColor, expansions: GameSettings['expansionPieces']): Piece[] {
  const pieces: Piece[] = [];
  let idCounter = 0;

  const addPieces = (type: PieceType, count: number) => {
    for (let i = 0; i < count; i++) {
      pieces.push({
        id: `${color}-${type}-${idCounter++}`,
        type,
        color,
      });
    }
  };

  // Standard pieces
  addPieces('queen', 1);
  addPieces('beetle', 2);
  addPieces('grasshopper', 3);
  addPieces('spider', 2);
  addPieces('ant', 3);

  // Expansion pieces
  if (expansions.ladybug) addPieces('ladybug', 1);
  if (expansions.mosquito) addPieces('mosquito', 1);
  if (expansions.pillbug) addPieces('pillbug', 1);

  return pieces;
}
