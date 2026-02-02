// Spider Movement - Moves exactly 3 spaces around the edge of the hive
import { HexCoord, PlacedPiece } from '../types';
import { coordKey } from '../hexUtils';
import { getValidSlideDestinations } from '../freedomToMove';
import { wouldBreakHive } from '../hiveRules';

export function getSpiderMoves(
  board: PlacedPiece[],
  piece: PlacedPiece
): HexCoord[] {
  // Check One Hive Rule
  if (wouldBreakHive(board, piece)) {
    return [];
  }

  // Spider moves exactly 3 spaces - use BFS to find all paths of length 3
  const validDestinations: Set<string> = new Set();

  // BFS with path tracking to ensure exactly 3 steps without backtracking
  interface PathState {
    position: HexCoord;
    visited: Set<string>; // Positions visited in this path
    steps: number;
  }

  const boardWithoutPiece = board.filter((p) => p.id !== piece.id);

  const queue: PathState[] = [
    {
      position: piece.position,
      visited: new Set([coordKey(piece.position)]),
      steps: 0,
    },
  ];

  while (queue.length > 0) {
    const { position, visited, steps } = queue.shift()!;

    if (steps === 3) {
      validDestinations.add(coordKey(position));
      continue;
    }

    // Get valid slides from current position
    // Create a temporary board with the piece at current position
    const tempBoard = [
      ...boardWithoutPiece,
      { ...piece, position, stackOrder: 0 },
    ];

    const nextMoves = getValidSlideDestinations(tempBoard, position, piece.id);

    for (const next of nextMoves) {
      const nextKey = coordKey(next);

      // Can't backtrack to previously visited positions in this path
      if (!visited.has(nextKey)) {
        const newVisited = new Set(visited);
        newVisited.add(nextKey);

        queue.push({
          position: next,
          visited: newVisited,
          steps: steps + 1,
        });
      }
    }
  }

  // Remove the starting position from valid destinations
  validDestinations.delete(coordKey(piece.position));

  return Array.from(validDestinations).map((key) => {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  });
}
