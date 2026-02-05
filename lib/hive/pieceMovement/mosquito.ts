// Mosquito Movement - Copies movement ability of any adjacent piece
import { HexCoord, PlacedPiece, PieceType } from '../types';
import { getNeighbors, coordKey, getTopPieceAt } from '../hexUtils';
import { wouldBreakHive } from '../hiveRules';
import { getQueenMoves } from './queen';
import { getBeetleMoves } from './beetle';
import { getGrasshopperMoves } from './grasshopper';
import { getSpiderMoves } from './spider';
import { getAntMoves } from './ant';
import { getLadybugMoves } from './ladybug';
import { getPillbugMoves } from './pillbug';

export function getMosquitoMoves(
  board: PlacedPiece[],
  piece: PlacedPiece,
  lastMovedPiece?: { pieceId: string; byPillbug: boolean } | null
): HexCoord[] {
  // Check One Hive Rule
  if (piece.stackOrder === 0 && wouldBreakHive(board, piece)) {
    return [];
  }

  // Special case: if mosquito is on top of the hive (on another piece),
  // it can only move as a beetle
  if (piece.stackOrder > 0) {
    return getBeetleMoves(board, piece);
  }

  // Get adjacent pieces to copy their movement
  const neighbors = getNeighbors(piece.position);
  const adjacentTypes: Set<PieceType> = new Set();

  for (const neighbor of neighbors) {
    const topPiece = getTopPieceAt(board, neighbor);
    if (topPiece && topPiece.type !== 'mosquito') {
      // Can't copy another mosquito
      adjacentTypes.add(topPiece.type);
    }
  }

  // Collect all valid moves from copied piece types
  const allMoves: Set<string> = new Set();

  for (const type of adjacentTypes) {
    let moves: HexCoord[] = [];

    // Create a fake piece of that type for movement calculation
    const fakePiece: PlacedPiece = {
      ...piece,
      type,
    };

    switch (type) {
      case 'queen':
        moves = getQueenMoves(board, fakePiece);
        break;
      case 'beetle':
        moves = getBeetleMoves(board, fakePiece);
        break;
      case 'grasshopper':
        moves = getGrasshopperMoves(board, fakePiece);
        break;
      case 'spider':
        moves = getSpiderMoves(board, fakePiece);
        break;
      case 'ant':
        moves = getAntMoves(board, fakePiece);
        break;
      case 'ladybug':
        moves = getLadybugMoves(board, fakePiece);
        break;
      case 'pillbug':
        // Only get normal pillbug movement, not special ability
        moves = getPillbugMoves(board, fakePiece, lastMovedPiece).normalMoves;
        break;
    }

    for (const move of moves) {
      allMoves.add(coordKey(move));
    }
  }

  return Array.from(allMoves).map((key) => {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  });
}

// Check if mosquito can use pillbug ability (when adjacent to pillbug)
export function canMosquitoUsePillbugAbility(
  board: PlacedPiece[],
  mosquito: PlacedPiece
): boolean {
  if (mosquito.stackOrder > 0) return false; // On top of hive, acts as beetle

  const neighbors = getNeighbors(mosquito.position);

  for (const neighbor of neighbors) {
    const topPiece = getTopPieceAt(board, neighbor);
    if (topPiece && topPiece.type === 'pillbug') {
      return true;
    }
  }

  return false;
}
