// Queen Bee Movement - Moves exactly 1 space
import { HexCoord, PlacedPiece } from '../types';
import { getValidSlideDestinations } from '../freedomToMove';
import { wouldBreakHive } from '../hiveRules';

export function getQueenMoves(
  board: PlacedPiece[],
  piece: PlacedPiece
): HexCoord[] {
  // Check One Hive Rule
  if (wouldBreakHive(board, piece)) {
    return [];
  }

  // Queen can slide to any adjacent empty space
  return getValidSlideDestinations(board, piece.position, piece.id);
}
