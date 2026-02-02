// Ladybug Movement - Moves 2 spaces on top of the hive, then 1 space down
import { HexCoord, PlacedPiece } from '../types';
import { getNeighbors, coordKey, getOccupiedCoords } from '../hexUtils';
import { wouldBreakHive, isAdjacentToHive } from '../hiveRules';

export function getLadybugMoves(
  board: PlacedPiece[],
  piece: PlacedPiece
): HexCoord[] {
  // Check One Hive Rule
  if (wouldBreakHive(board, piece)) {
    return [];
  }

  const boardWithoutPiece = board.filter((p) => p.id !== piece.id);
  const occupied = getOccupiedCoords(boardWithoutPiece);
  const validDestinations: Set<string> = new Set();

  // Step 1: Must climb onto an adjacent piece
  const neighbors1 = getNeighbors(piece.position);
  const step1Positions = neighbors1.filter((n) => occupied.has(coordKey(n)));

  // Step 2: Must move to another piece on top of the hive
  for (const pos1 of step1Positions) {
    const neighbors2 = getNeighbors(pos1);
    const step2Positions = neighbors2.filter(
      (n) =>
        occupied.has(coordKey(n)) &&
        coordKey(n) !== coordKey(piece.position) // Can't go back to start
    );

    // Step 3: Must move down to an empty space
    for (const pos2 of step2Positions) {
      const neighbors3 = getNeighbors(pos2);
      const step3Positions = neighbors3.filter(
        (n) =>
          !occupied.has(coordKey(n)) && // Must be empty
          coordKey(n) !== coordKey(piece.position) && // Can't return to start
          coordKey(n) !== coordKey(pos1) && // Can't go back to first jump
          isAdjacentToHive(boardWithoutPiece, n) // Must stay connected
      );

      for (const dest of step3Positions) {
        validDestinations.add(coordKey(dest));
      }
    }
  }

  return Array.from(validDestinations).map((key) => {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  });
}
