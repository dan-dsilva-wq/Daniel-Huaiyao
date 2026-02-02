// Beetle Movement - Moves 1 space, can climb on top of other pieces
import { HexCoord, PlacedPiece } from '../types';
import { getNeighbors, coordKey, getPiecesAt } from '../hexUtils';
import { canClimb, canSlide, getValidSlideDestinations } from '../freedomToMove';
import { wouldBreakHive, isAdjacentToHive } from '../hiveRules';

export function getBeetleMoves(
  board: PlacedPiece[],
  piece: PlacedPiece
): HexCoord[] {
  // Check One Hive Rule (only if beetle is at ground level)
  if (piece.stackOrder === 0 && wouldBreakHive(board, piece)) {
    return [];
  }

  const neighbors = getNeighbors(piece.position);
  const validMoves: HexCoord[] = [];
  const boardWithoutPiece = board.filter((p) => p.id !== piece.id);

  for (const neighbor of neighbors) {
    const piecesAtDest = getPiecesAt(boardWithoutPiece, neighbor);

    if (piecesAtDest.length > 0) {
      // Can climb onto pieces - check if beetle can reach
      if (canClimb(board, piece.position, neighbor, piece.id)) {
        validMoves.push(neighbor);
      }
    } else {
      // Empty space - check if can slide there AND stays connected to hive
      if (piece.stackOrder > 0) {
        // Beetle on top can move more freely, just needs to stay adjacent
        if (isAdjacentToHive(boardWithoutPiece, neighbor)) {
          validMoves.push(neighbor);
        }
      } else if (canSlide(board, piece.position, neighbor, piece.id)) {
        // Ground level - need to pass gate check and stay adjacent
        if (isAdjacentToHive(boardWithoutPiece, neighbor)) {
          validMoves.push(neighbor);
        }
      }
    }
  }

  return validMoves;
}

// Calculate the stack order for a beetle moving to a position
export function getBeetleStackOrder(
  board: PlacedPiece[],
  beetleId: string,
  destination: HexCoord
): number {
  const piecesAtDest = board.filter(
    (p) => p.id !== beetleId && coordKey(p.position) === coordKey(destination)
  );

  if (piecesAtDest.length === 0) {
    return 0; // Ground level
  }

  return Math.max(...piecesAtDest.map((p) => p.stackOrder)) + 1;
}
