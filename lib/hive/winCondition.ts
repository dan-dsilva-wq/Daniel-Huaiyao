// Win Condition - Check if a queen is surrounded
import { PlacedPiece, PlayerColor } from './types';
import { getNeighbors, coordKey, getOccupiedCoords } from './hexUtils';

// Check if a queen is completely surrounded
export function isQueenSurrounded(board: PlacedPiece[], queenColor: PlayerColor): boolean {
  const queen = board.find((p) => p.type === 'queen' && p.color === queenColor);

  if (!queen) {
    return false; // Queen not on board yet
  }

  const neighbors = getNeighbors(queen.position);
  const occupied = getOccupiedCoords(board);

  // Queen is surrounded if all 6 adjacent hexes are occupied
  return neighbors.every((n) => occupied.has(coordKey(n)));
}

// Check game end conditions
export function checkWinCondition(board: PlacedPiece[]): {
  gameOver: boolean;
  winner: PlayerColor | 'draw' | null;
} {
  const whiteSurrounded = isQueenSurrounded(board, 'white');
  const blackSurrounded = isQueenSurrounded(board, 'black');

  if (whiteSurrounded && blackSurrounded) {
    return { gameOver: true, winner: 'draw' };
  }

  if (whiteSurrounded) {
    return { gameOver: true, winner: 'black' };
  }

  if (blackSurrounded) {
    return { gameOver: true, winner: 'white' };
  }

  return { gameOver: false, winner: null };
}

// Get the number of hexes surrounding a queen (for scoring/display)
export function getQueenSurroundCount(board: PlacedPiece[], queenColor: PlayerColor): number {
  const queen = board.find((p) => p.type === 'queen' && p.color === queenColor);

  if (!queen) {
    return 0;
  }

  const neighbors = getNeighbors(queen.position);
  const occupied = getOccupiedCoords(board);

  return neighbors.filter((n) => occupied.has(coordKey(n))).length;
}
