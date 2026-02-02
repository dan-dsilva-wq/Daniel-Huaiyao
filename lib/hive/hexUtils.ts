// Hexagonal grid utilities using axial coordinate system
import { HexCoord, PlacedPiece } from './types';

// Six directions in axial coordinates (pointy-top hexagons)
export const HEX_DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },   // East
  { q: 1, r: -1 },  // Northeast
  { q: 0, r: -1 },  // Northwest
  { q: -1, r: 0 },  // West
  { q: -1, r: 1 },  // Southwest
  { q: 0, r: 1 },   // Southeast
];

// Get neighbor coordinate in a specific direction (0-5)
export function getNeighbor(coord: HexCoord, direction: number): HexCoord {
  const dir = HEX_DIRECTIONS[direction];
  return { q: coord.q + dir.q, r: coord.r + dir.r };
}

// Get all six neighbor coordinates
export function getNeighbors(coord: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map((dir) => ({
    q: coord.q + dir.q,
    r: coord.r + dir.r,
  }));
}

// Check if two coordinates are the same
export function coordsEqual(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

// Create a string key from coordinates (for Map/Set usage)
export function coordKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

// Parse a string key back to coordinates
export function parseCoordKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

// Calculate distance between two hex coordinates
export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

// Check if two coordinates are neighbors
export function areNeighbors(a: HexCoord, b: HexCoord): boolean {
  return hexDistance(a, b) === 1;
}

// Get the direction index from one hex to an adjacent hex
export function getDirection(from: HexCoord, to: HexCoord): number {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  return HEX_DIRECTIONS.findIndex((dir) => dir.q === dq && dir.r === dr);
}

// Convert axial to pixel coordinates (for rendering)
export function axialToPixel(coord: HexCoord, hexSize: number): { x: number; y: number } {
  const x = hexSize * (Math.sqrt(3) * coord.q + (Math.sqrt(3) / 2) * coord.r);
  const y = hexSize * ((3 / 2) * coord.r);
  return { x, y };
}

// Convert pixel to axial coordinates (for mouse interaction)
export function pixelToAxial(x: number, y: number, hexSize: number): HexCoord {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / hexSize;
  const r = ((2 / 3) * y) / hexSize;
  return hexRound({ q, r });
}

// Round fractional axial coordinates to nearest hex
export function hexRound(coord: { q: number; r: number }): HexCoord {
  const s = -coord.q - coord.r;

  let rq = Math.round(coord.q);
  let rr = Math.round(coord.r);
  const rs = Math.round(s);

  const qDiff = Math.abs(rq - coord.q);
  const rDiff = Math.abs(rr - coord.r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
}

// Get pieces at a specific coordinate (sorted by stack order)
export function getPiecesAt(board: PlacedPiece[], coord: HexCoord): PlacedPiece[] {
  return board
    .filter((p) => coordsEqual(p.position, coord))
    .sort((a, b) => a.stackOrder - b.stackOrder);
}

// Get the top piece at a coordinate
export function getTopPieceAt(board: PlacedPiece[], coord: HexCoord): PlacedPiece | null {
  const pieces = getPiecesAt(board, coord);
  return pieces.length > 0 ? pieces[pieces.length - 1] : null;
}

// Get all occupied coordinates
export function getOccupiedCoords(board: PlacedPiece[]): Set<string> {
  const coords = new Set<string>();
  for (const piece of board) {
    coords.add(coordKey(piece.position));
  }
  return coords;
}

// Get all unique coordinates in the board
export function getAllCoords(board: PlacedPiece[]): HexCoord[] {
  const coordSet = new Set<string>();
  board.forEach((p) => coordSet.add(coordKey(p.position)));
  return Array.from(coordSet).map(parseCoordKey);
}

// Get the bounding box of all pieces (for camera centering)
export function getBoundingBox(board: PlacedPiece[]): {
  minQ: number;
  maxQ: number;
  minR: number;
  maxR: number;
} {
  if (board.length === 0) {
    return { minQ: 0, maxQ: 0, minR: 0, maxR: 0 };
  }

  let minQ = Infinity,
    maxQ = -Infinity,
    minR = Infinity,
    maxR = -Infinity;

  for (const piece of board) {
    minQ = Math.min(minQ, piece.position.q);
    maxQ = Math.max(maxQ, piece.position.q);
    minR = Math.min(minR, piece.position.r);
    maxR = Math.max(maxR, piece.position.r);
  }

  return { minQ, maxQ, minR, maxR };
}

// Get ring of hexes at distance n from center
export function getHexRing(center: HexCoord, radius: number): HexCoord[] {
  if (radius === 0) return [center];

  const results: HexCoord[] = [];
  let hex = { q: center.q - radius, r: center.r + radius };

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      results.push({ ...hex });
      hex = getNeighbor(hex, i);
    }
  }

  return results;
}

// Get all hexes within distance n (inclusive)
export function getHexesWithinRange(center: HexCoord, range: number): HexCoord[] {
  const results: HexCoord[] = [];

  for (let q = -range; q <= range; q++) {
    for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
      results.push({ q: center.q + q, r: center.r + r });
    }
  }

  return results;
}

// Find a straight line path from one hex to another (for grasshopper)
export function getStraightLinePath(from: HexCoord, to: HexCoord): HexCoord[] | null {
  const direction = getDirection(from, { q: from.q + Math.sign(to.q - from.q), r: from.r + Math.sign(to.r - from.r) });

  // Check if they're aligned in one of the six directions
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const ds = -dq - dr;

  // In axial coordinates, a straight line means one of the three coordinates (q, r, or s=-q-r) stays constant
  // or they change proportionally
  let lineDirection: number = -1;

  if (dr === 0 && dq !== 0) {
    lineDirection = dq > 0 ? 0 : 3; // East or West
  } else if (dq === 0 && dr !== 0) {
    lineDirection = dr > 0 ? 5 : 2; // Southeast or Northwest
  } else if (ds === 0 && dq !== 0) {
    lineDirection = dq > 0 ? 1 : 4; // Northeast or Southwest
  } else {
    return null; // Not a straight line
  }

  // Build the path
  const path: HexCoord[] = [];
  let current = from;

  while (!coordsEqual(current, to)) {
    current = getNeighbor(current, lineDirection);
    path.push(current);

    // Safety check
    if (path.length > 100) return null;
  }

  return path;
}
