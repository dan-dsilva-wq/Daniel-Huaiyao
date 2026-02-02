// Soldier Ant Movement - Moves unlimited spaces around the edge of the hive
import { HexCoord, PlacedPiece } from '../types';
import { coordKey } from '../hexUtils';
import { getValidSlideDestinations } from '../freedomToMove';
import { wouldBreakHive } from '../hiveRules';

export function getAntMoves(
  board: PlacedPiece[],
  piece: PlacedPiece
): HexCoord[] {
  // Check One Hive Rule
  if (wouldBreakHive(board, piece)) {
    return [];
  }

  const boardWithoutPiece = board.filter((p) => p.id !== piece.id);
  const validDestinations: Set<string> = new Set();
  const visited: Set<string> = new Set();

  // BFS to find all reachable positions
  const queue: HexCoord[] = [piece.position];
  visited.add(coordKey(piece.position));

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Create temporary board with ant at current position
    const tempBoard = [
      ...boardWithoutPiece,
      { ...piece, position: current, stackOrder: 0 },
    ];

    const nextMoves = getValidSlideDestinations(tempBoard, current, piece.id);

    for (const next of nextMoves) {
      const nextKey = coordKey(next);

      if (!visited.has(nextKey)) {
        visited.add(nextKey);
        validDestinations.add(nextKey);
        queue.push(next);
      }
    }
  }

  // Remove starting position from valid destinations
  validDestinations.delete(coordKey(piece.position));

  return Array.from(validDestinations).map((key) => {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  });
}
