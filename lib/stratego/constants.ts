import { PieceRank } from './types';

export const BOARD_SIZE = 10;

// Lakes: two 2x2 blocks in the center
export const LAKE_CELLS: [number, number][] = [
  [4, 2], [4, 3], [5, 2], [5, 3],
  [4, 6], [4, 7], [5, 6], [5, 7],
];

export function isLake(row: number, col: number): boolean {
  return LAKE_CELLS.some(([r, c]) => r === row && c === col);
}

export interface PieceDefinition {
  rank: PieceRank;
  name: string;
  shortName: string;
  count: number;
  description: string;
}

export const PIECE_DEFINITIONS: PieceDefinition[] = [
  { rank: 10, name: 'Marshal', shortName: '10', count: 1, description: 'Highest rank. Defeated only by Spy when attacked.' },
  { rank: 9, name: 'General', shortName: '9', count: 1, description: 'Second highest rank.' },
  { rank: 8, name: 'Colonel', shortName: '8', count: 2, description: '' },
  { rank: 7, name: 'Major', shortName: '7', count: 3, description: '' },
  { rank: 6, name: 'Captain', shortName: '6', count: 4, description: '' },
  { rank: 5, name: 'Lieutenant', shortName: '5', count: 4, description: '' },
  { rank: 4, name: 'Sergeant', shortName: '4', count: 4, description: '' },
  { rank: 3, name: 'Miner', shortName: '3', count: 5, description: 'Can defuse Bombs.' },
  { rank: 2, name: 'Scout', shortName: '2', count: 8, description: 'Moves any number of squares in a straight line.' },
  { rank: 1, name: 'Spy', shortName: 'S', count: 1, description: 'Defeats the Marshal when attacking it.' },
  { rank: 11, name: 'Bomb', shortName: 'B', count: 6, description: 'Cannot move. Destroys attackers (except Miners).' },
  { rank: 0, name: 'Flag', shortName: 'F', count: 1, description: 'Cannot move. Capture to win!' },
];

export function getPieceDefinition(rank: PieceRank): PieceDefinition {
  return PIECE_DEFINITIONS.find(p => p.rank === rank)!;
}

export function getPieceName(rank: PieceRank | -1): string {
  if (rank === -1) return '?';
  return getPieceDefinition(rank as PieceRank).name;
}

export function getPieceShortName(rank: PieceRank | -1): string {
  if (rank === -1) return '?';
  return getPieceDefinition(rank as PieceRank).shortName;
}

// Colors for piece display
export const TEAM_COLORS = {
  red: {
    bg: 'bg-red-600',
    bgLight: 'bg-red-500',
    text: 'text-white',
    border: 'border-red-700',
    ring: 'ring-red-400',
    gradient: 'from-red-600 to-red-700',
  },
  blue: {
    bg: 'bg-blue-600',
    bgLight: 'bg-blue-500',
    text: 'text-white',
    border: 'border-blue-700',
    ring: 'ring-blue-400',
    gradient: 'from-blue-600 to-blue-700',
  },
} as const;

// Red setup rows: 6-9 (bottom from red's perspective)
// Blue setup rows: 0-3 (top from red's perspective)
export const SETUP_ROWS = {
  red: { min: 6, max: 9 },
  blue: { min: 0, max: 3 },
} as const;

// Generate initial random piece placement for setup phase
export function generateRandomSetup(color: 'red' | 'blue'): { rank: PieceRank; row: number; col: number }[] {
  const pieces: { rank: PieceRank }[] = [];
  for (const def of PIECE_DEFINITIONS) {
    for (let i = 0; i < def.count; i++) {
      pieces.push({ rank: def.rank });
    }
  }

  // Shuffle pieces
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }

  const { min, max } = SETUP_ROWS[color];
  const positions: { rank: PieceRank; row: number; col: number }[] = [];
  let idx = 0;

  for (let row = min; row <= max; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      positions.push({ rank: pieces[idx].rank, row, col });
      idx++;
    }
  }

  return positions;
}
