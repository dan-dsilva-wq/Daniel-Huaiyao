import { Piece, OpponentPiece, PieceRank } from './types';
import { BOARD_SIZE, isLake } from './constants';

interface ValidMove {
  row: number;
  col: number;
  isAttack: boolean;
}

/**
 * Get all valid moves for a piece (client-side, for highlighting).
 * Only considers visible board state — no hidden info exploits.
 */
export function getValidMoves(
  piece: Piece,
  myPieces: Piece[],
  opponentPieces: OpponentPiece[],
): ValidMove[] {
  const { rank, row, col } = piece;

  // Bombs and flags can't move
  if (rank === 0 || rank === 11) return [];

  const moves: ValidMove[] = [];

  if (rank === 2) {
    // Scout: moves any number of squares in a straight line
    const directions: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of directions) {
      for (let dist = 1; dist < BOARD_SIZE; dist++) {
        const nr = row + dr * dist;
        const nc = col + dc * dist;
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) break;
        if (isLake(nr, nc)) break;
        if (myPieces.some(p => p.row === nr && p.col === nc)) break;
        const opponentHere = opponentPieces.some(p => p.row === nr && p.col === nc);
        moves.push({ row: nr, col: nc, isAttack: opponentHere });
        if (opponentHere) break; // Can't move past opponent
      }
    }
  } else {
    // All other movable pieces: 1 square orthogonally
    const directions: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of directions) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
      if (isLake(nr, nc)) continue;
      if (myPieces.some(p => p.row === nr && p.col === nc)) continue;
      const opponentHere = opponentPieces.some(p => p.row === nr && p.col === nc);
      moves.push({ row: nr, col: nc, isAttack: opponentHere });
    }
  }

  return moves;
}

/**
 * Check if any movable pieces exist for a player.
 */
export function hasAnyMoves(
  myPieces: Piece[],
  opponentPieces: OpponentPiece[],
): boolean {
  for (const piece of myPieces) {
    if (piece.rank === 0 || piece.rank === 11) continue;
    const moves = getValidMoves(piece, myPieces, opponentPieces);
    if (moves.length > 0) return true;
  }
  return false;
}

/**
 * Predict combat outcome (client-side, for display after server resolves).
 * Only works when both ranks are known.
 */
export function predictCombat(
  attackerRank: PieceRank,
  defenderRank: PieceRank,
): 'attacker_wins' | 'defender_wins' | 'both_die' {
  // Flag captured
  if (defenderRank === 0) return 'attacker_wins';

  // Spy attacks Marshal
  if (attackerRank === 1 && defenderRank === 10) return 'attacker_wins';

  // Attacking a bomb
  if (defenderRank === 11) {
    return attackerRank === 3 ? 'attacker_wins' : 'defender_wins';
  }

  // Normal combat
  if (attackerRank > defenderRank) return 'attacker_wins';
  if (attackerRank === defenderRank) return 'both_die';
  return 'defender_wins';
}
