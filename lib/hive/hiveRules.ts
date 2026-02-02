// One Hive Rule - All pieces must remain connected as a single group
import { HexCoord, PlacedPiece } from './types';
import {
  coordKey,
  getNeighbors,
  coordsEqual,
  getOccupiedCoords,
  getTopPieceAt,
} from './hexUtils';

// Check if the hive is connected (BFS)
export function isHiveConnected(board: PlacedPiece[]): boolean {
  if (board.length <= 1) return true;

  // Get unique ground-level positions (excluding stacked beetles)
  const groundPositions = new Set<string>();
  for (const piece of board) {
    groundPositions.add(coordKey(piece.position));
  }

  if (groundPositions.size <= 1) return true;

  // BFS from first position
  const posArray = Array.from(groundPositions);
  const visited = new Set<string>();
  const queue: string[] = [posArray[0]];
  visited.add(posArray[0]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const [q, r] = current.split(',').map(Number);
    const coord: HexCoord = { q, r };

    for (const neighbor of getNeighbors(coord)) {
      const key = coordKey(neighbor);
      if (groundPositions.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(key);
      }
    }
  }

  return visited.size === groundPositions.size;
}

// Check if removing a piece would break the hive (One Hive Rule)
export function wouldBreakHive(board: PlacedPiece[], piece: PlacedPiece): boolean {
  // If piece is under another piece (beetle on top), it can't move
  const piecesAtPosition = board.filter((p) =>
    coordsEqual(p.position, piece.position)
  );
  if (piecesAtPosition.some((p) => p.stackOrder > piece.stackOrder)) {
    return true; // Piece is pinned
  }

  // Temporarily remove the piece
  const boardWithoutPiece = board.filter((p) => p.id !== piece.id);

  // If board is empty or has one piece, it's fine
  if (boardWithoutPiece.length <= 1) return false;

  // Check if remaining pieces are still connected
  return !isHiveConnected(boardWithoutPiece);
}

// Get pieces that are touching a coordinate
export function getAdjacentPieces(board: PlacedPiece[], coord: HexCoord): PlacedPiece[] {
  const neighbors = getNeighbors(coord);
  const adjacent: PlacedPiece[] = [];

  for (const neighbor of neighbors) {
    const topPiece = getTopPieceAt(board, neighbor);
    if (topPiece) {
      adjacent.push(topPiece);
    }
  }

  return adjacent;
}

// Check if a coordinate is adjacent to the hive
export function isAdjacentToHive(board: PlacedPiece[], coord: HexCoord): boolean {
  if (board.length === 0) return true;

  const neighbors = getNeighbors(coord);
  const occupied = getOccupiedCoords(board);

  return neighbors.some((n) => occupied.has(coordKey(n)));
}

// Get all empty spaces adjacent to the hive
export function getEmptyAdjacentSpaces(board: PlacedPiece[]): HexCoord[] {
  if (board.length === 0) {
    return [{ q: 0, r: 0 }]; // First piece goes at origin
  }

  const occupied = getOccupiedCoords(board);
  const emptyAdjacent = new Set<string>();

  for (const piece of board) {
    for (const neighbor of getNeighbors(piece.position)) {
      const key = coordKey(neighbor);
      if (!occupied.has(key)) {
        emptyAdjacent.add(key);
      }
    }
  }

  return Array.from(emptyAdjacent).map((key) => {
    const [q, r] = key.split(',').map(Number);
    return { q, r };
  });
}

// Check if moving from one position to another maintains hive connectivity during the move
// This is a more sophisticated check for sliding pieces
export function maintainsHiveConnectivityDuringMove(
  board: PlacedPiece[],
  piece: PlacedPiece,
  to: HexCoord
): boolean {
  // The piece being moved must stay connected to the hive at all times
  // For a simple sliding move, the destination must be adjacent to the hive
  // (excluding the moving piece itself)

  const boardWithoutPiece = board.filter((p) => p.id !== piece.id);

  // First check: can the piece leave its current position?
  if (!isHiveConnected(boardWithoutPiece) && boardWithoutPiece.length > 0) {
    return false;
  }

  // Second check: is the destination adjacent to the hive (without the moving piece)?
  if (boardWithoutPiece.length === 0) {
    return true; // Single piece can move anywhere
  }

  return isAdjacentToHive(boardWithoutPiece, to);
}
