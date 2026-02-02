// Freedom to Move - Pieces must physically slide, checking for "gates"
import { HexCoord, PlacedPiece } from './types';
import {
  coordKey,
  getNeighbors,
  getDirection,
  areNeighbors,
  getOccupiedCoords,
  getPiecesAt,
} from './hexUtils';

// Check if a piece can physically slide from one hex to an adjacent hex
// A piece cannot slide if both adjacent common neighbors are occupied (gate)
export function canSlide(
  board: PlacedPiece[],
  from: HexCoord,
  to: HexCoord,
  excludePieceId?: string
): boolean {
  if (!areNeighbors(from, to)) {
    return false; // Not adjacent
  }

  // Get board positions excluding the moving piece
  const relevantBoard = excludePieceId
    ? board.filter((p) => p.id !== excludePieceId)
    : board;

  const occupied = getOccupiedCoords(relevantBoard);

  // Check if destination is occupied at ground level
  const piecesAtDest = getPiecesAt(relevantBoard, to);
  if (piecesAtDest.length > 0) {
    return false; // Can't slide into occupied space (climbing is different)
  }

  // Find the two common neighbors (the hexes adjacent to both from and to)
  const fromNeighbors = getNeighbors(from);
  const toNeighbors = getNeighbors(to);

  const commonNeighbors = fromNeighbors.filter((fn) =>
    toNeighbors.some((tn) => coordKey(fn) === coordKey(tn))
  );

  // Gate check: if both common neighbors are occupied, the piece can't slide through
  const occupiedCommonNeighbors = commonNeighbors.filter((n) =>
    occupied.has(coordKey(n))
  );

  return occupiedCommonNeighbors.length < 2;
}

// Check if a piece can climb onto another piece (for beetles)
export function canClimb(
  board: PlacedPiece[],
  from: HexCoord,
  to: HexCoord,
  climbingPieceId: string
): boolean {
  if (!areNeighbors(from, to)) {
    return false;
  }

  // Beetle can always climb if on top (no gate restrictions at elevation)
  const climbingPiece = board.find((p) => p.id === climbingPieceId);
  if (!climbingPiece) return false;

  // If beetle is on top of the hive (stackOrder > 0), it can move freely
  if (climbingPiece.stackOrder > 0) {
    return true;
  }

  // If at ground level and climbing up, need to check gate
  // But climbing relaxes the gate rule - only need to fit through OR be going up
  const boardWithoutPiece = board.filter((p) => p.id !== climbingPieceId);
  const destPieces = getPiecesAt(boardWithoutPiece, to);

  // If destination has pieces, we're climbing up - more lenient
  if (destPieces.length > 0) {
    // When climbing up, only one common neighbor needs to be free
    const fromNeighbors = getNeighbors(from);
    const toNeighbors = getNeighbors(to);
    const occupied = getOccupiedCoords(boardWithoutPiece);

    const commonNeighbors = fromNeighbors.filter((fn) =>
      toNeighbors.some((tn) => coordKey(fn) === coordKey(tn))
    );

    const occupiedCommonNeighbors = commonNeighbors.filter((n) =>
      occupied.has(coordKey(n))
    );

    // Beetle can climb if at least one common neighbor is free
    return occupiedCommonNeighbors.length < 2;
  }

  // Ground level move - regular slide rules
  return canSlide(board, from, to, climbingPieceId);
}

// Get all valid slide destinations from a position
export function getValidSlideDestinations(
  board: PlacedPiece[],
  from: HexCoord,
  pieceId: string
): HexCoord[] {
  const neighbors = getNeighbors(from);
  const boardWithoutPiece = board.filter((p) => p.id !== pieceId);
  const occupied = getOccupiedCoords(boardWithoutPiece);

  return neighbors.filter((n) => {
    // Must be empty
    if (occupied.has(coordKey(n))) return false;

    // Must pass gate check
    if (!canSlide(board, from, n, pieceId)) return false;

    // Must stay adjacent to hive (excluding self)
    const neighborNeighbors = getNeighbors(n);
    const isAdjacentToHive = neighborNeighbors.some((nn) =>
      occupied.has(coordKey(nn))
    );

    return isAdjacentToHive;
  });
}

// Find a valid sliding path from one hex to another (for ants and spiders)
// Returns the path if valid, null if no valid path exists
export function findSlidingPath(
  board: PlacedPiece[],
  from: HexCoord,
  to: HexCoord,
  pieceId: string,
  maxSteps?: number
): HexCoord[] | null {
  const boardWithoutPiece = board.filter((p) => p.id !== pieceId);
  const occupied = getOccupiedCoords(boardWithoutPiece);

  if (occupied.size === 0) {
    return null; // No hive to slide around
  }

  // BFS to find shortest path
  interface PathNode {
    coord: HexCoord;
    path: HexCoord[];
  }

  const visited = new Set<string>();
  const queue: PathNode[] = [{ coord: from, path: [] }];
  visited.add(coordKey(from));

  while (queue.length > 0) {
    const { coord, path } = queue.shift()!;

    if (maxSteps !== undefined && path.length >= maxSteps) {
      // Check if we reached destination at exactly max steps
      if (coordKey(coord) === coordKey(to) && path.length === maxSteps) {
        return path;
      }
      continue;
    }

    const validMoves = getValidSlideDestinations(
      boardWithoutPiece.concat([
        {
          id: pieceId,
          type: 'ant',
          color: 'white',
          position: coord,
          stackOrder: 0,
        },
      ]),
      coord,
      pieceId
    );

    for (const next of validMoves) {
      const key = coordKey(next);

      // For exact step count (spider), allow revisiting for different path lengths
      if (maxSteps !== undefined) {
        const pathKey = `${key}-${path.length + 1}`;
        if (visited.has(pathKey)) continue;
        visited.add(pathKey);
      } else {
        if (visited.has(key)) continue;
        visited.add(key);
      }

      const newPath = [...path, next];

      if (coordKey(next) === coordKey(to)) {
        if (maxSteps === undefined || newPath.length === maxSteps) {
          return newPath;
        }
      }

      queue.push({ coord: next, path: newPath });
    }
  }

  return null;
}

// Check if a piece is pinned (has another piece on top of it)
export function isPinned(board: PlacedPiece[], piece: PlacedPiece): boolean {
  const piecesAtPosition = getPiecesAt(board, piece.position);
  return piecesAtPosition.some((p) => p.stackOrder > piece.stackOrder);
}
