// Grasshopper Movement - Jumps in straight line over at least one piece
import { HexCoord, PlacedPiece } from '../types';
import {
  coordKey,
  getNeighbor,
  getOccupiedCoords,
} from '../hexUtils';
import { wouldBreakHive } from '../hiveRules';

export function getGrasshopperMoves(
  board: PlacedPiece[],
  piece: PlacedPiece
): HexCoord[] {
  // Check One Hive Rule
  if (wouldBreakHive(board, piece)) {
    return [];
  }

  const occupied = getOccupiedCoords(board);
  occupied.delete(coordKey(piece.position)); // Remove self

  const validMoves: HexCoord[] = [];

  // Check each of the 6 directions
  for (let dir = 0; dir < 6; dir++) {
    let current = piece.position;
    let jumpedCount = 0;

    // Move in this direction until we find an empty space
    while (true) {
      current = getNeighbor(current, dir);

      if (occupied.has(coordKey(current))) {
        jumpedCount++;
      } else {
        // Found empty space
        if (jumpedCount > 0) {
          // Must jump over at least one piece
          validMoves.push(current);
        }
        break;
      }

      // Safety limit
      if (jumpedCount > 100) break;
    }
  }

  return validMoves;
}
