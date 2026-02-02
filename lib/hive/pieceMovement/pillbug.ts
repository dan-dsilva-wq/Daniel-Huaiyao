// Pillbug Movement - Moves 1 space OR can move an adjacent piece to another adjacent space
import { HexCoord, PlacedPiece } from '../types';
import {
  getNeighbors,
  coordKey,
  getOccupiedCoords,
  getTopPieceAt,
  areNeighbors,
} from '../hexUtils';
import { wouldBreakHive, isAdjacentToHive } from '../hiveRules';
import { getValidSlideDestinations, isPinned } from '../freedomToMove';

export interface PillbugMoveResult {
  normalMoves: HexCoord[];
  specialAbility: {
    targetPiece: PlacedPiece;
    validDestinations: HexCoord[];
  }[];
}

export function getPillbugMoves(
  board: PlacedPiece[],
  piece: PlacedPiece,
  lastMovedPiece?: { pieceId: string; byPillbug: boolean } | null
): PillbugMoveResult {
  const result: PillbugMoveResult = {
    normalMoves: [],
    specialAbility: [],
  };

  // Normal movement: like queen (1 space)
  if (!wouldBreakHive(board, piece)) {
    result.normalMoves = getValidSlideDestinations(
      board,
      piece.position,
      piece.id
    );
  }

  // Special ability: move an adjacent piece to another adjacent empty space
  const neighbors = getNeighbors(piece.position);
  const occupied = getOccupiedCoords(board);

  // Find empty spaces adjacent to pillbug
  const emptyNeighbors = neighbors.filter((n) => !occupied.has(coordKey(n)));

  // Find pieces that can be moved
  for (const neighborCoord of neighbors) {
    const topPiece = getTopPieceAt(board, neighborCoord);

    if (!topPiece) continue;

    // Cannot move a piece that was just moved by a pillbug
    if (lastMovedPiece?.pieceId === topPiece.id && lastMovedPiece?.byPillbug) {
      continue;
    }

    // Cannot move pinned pieces (pieces with something on top)
    if (isPinned(board, topPiece)) {
      continue;
    }

    // Check if removing this piece would break the hive
    const boardWithoutTarget = board.filter((p) => p.id !== topPiece.id);
    if (boardWithoutTarget.length > 0) {
      // Check connectivity without the target piece
      const occupiedWithout = getOccupiedCoords(boardWithoutTarget);
      // Simple adjacency check for the pillbug
      const pillbugStillConnected = getNeighbors(piece.position).some(
        (n) =>
          coordKey(n) !== coordKey(topPiece.position) &&
          occupiedWithout.has(coordKey(n))
      );

      // Also check if removing target breaks hive connectivity
      if (!pillbugStillConnected && boardWithoutTarget.length > 0) {
        continue;
      }
    }

    // Find valid destinations for this piece (empty spaces adjacent to pillbug)
    const validDests: HexCoord[] = [];

    for (const emptyNeighbor of emptyNeighbors) {
      // The piece must be able to "fit" in the new position
      // This requires checking the gate between current position and destination
      // through the pillbug's position

      // Simplified check: destination must also be adjacent to the hive
      // (excluding the moving piece)
      if (isAdjacentToHive(boardWithoutTarget, emptyNeighbor)) {
        // Gate check: the piece goes "over" the pillbug, so gate doesn't apply
        // in the same way as sliding. The piece is lifted up and placed down.
        validDests.push(emptyNeighbor);
      }
    }

    if (validDests.length > 0) {
      result.specialAbility.push({
        targetPiece: topPiece,
        validDestinations: validDests,
      });
    }
  }

  return result;
}

// Execute pillbug special ability
export function executePillbugAbility(
  board: PlacedPiece[],
  targetPieceId: string,
  destination: HexCoord
): PlacedPiece[] {
  return board.map((piece) => {
    if (piece.id === targetPieceId) {
      return {
        ...piece,
        position: destination,
        stackOrder: 0, // Always ground level when moved by pillbug
      };
    }
    return piece;
  });
}
