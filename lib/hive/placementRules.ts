// Placement Rules - Rules for placing new pieces on the board
import { HexCoord, PlacedPiece, PlayerColor, Piece, GameState } from './types';
import {
  coordKey,
  getNeighbors,
  getTopPieceAt,
} from './hexUtils';
import { getEmptyAdjacentSpaces } from './hiveRules';

// Check if a player must place their queen this turn
export function mustPlaceQueen(gameState: GameState, color: PlayerColor): boolean {
  const turnNumber = gameState.turnNumber;
  const queenPlaced =
    color === 'white' ? gameState.whiteQueenPlaced : gameState.blackQueenPlaced;

  // Must place queen by turn 4 (turn 7 or 8 in overall count, 4th move per player)
  // Turn numbers are: white=1, black=2, white=3, black=4, white=5, black=6, white=7, black=8
  // So white's 4th turn is turn 7, black's 4th turn is turn 8
  const playerTurnCount = Math.ceil(turnNumber / 2);

  // If it's the 4th turn for this player and queen not placed, must place
  return playerTurnCount >= 4 && !queenPlaced;
}

// Check if a player can move pieces (queen must be placed first)
export function canMovePieces(gameState: GameState, color: PlayerColor): boolean {
  const queenPlaced =
    color === 'white' ? gameState.whiteQueenPlaced : gameState.blackQueenPlaced;
  return queenPlaced;
}

// Get valid placement positions for a color
export function getValidPlacementPositions(
  board: PlacedPiece[],
  color: PlayerColor,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _turnNumber: number
): HexCoord[] {
  // First turn: place at origin
  if (board.length === 0) {
    return [{ q: 0, r: 0 }];
  }

  // Second turn (first piece for second player): can place adjacent to first piece
  if (board.length === 1) {
    return getNeighbors(board[0].position);
  }

  // After first turn per player: must place touching only own color
  const emptySpaces = getEmptyAdjacentSpaces(board);

  return emptySpaces.filter((space) => {
    const neighbors = getNeighbors(space);
    let touchesOwn = false;
    let touchesOpponent = false;

    for (const neighbor of neighbors) {
      const topPiece = getTopPieceAt(board, neighbor);
      if (topPiece) {
        if (topPiece.color === color) {
          touchesOwn = true;
        } else {
          touchesOpponent = true;
        }
      }
    }

    // Must touch at least one own piece and no opponent pieces
    return touchesOwn && !touchesOpponent;
  });
}

// Check if a specific placement is valid
export function isValidPlacement(
  board: PlacedPiece[],
  piece: Piece,
  position: HexCoord,
  gameState: GameState
): { valid: boolean; reason?: string } {
  const color = piece.color;
  const turnNumber = gameState.turnNumber;

  // Check if position is occupied
  const piecesAtPosition = board.filter(
    (p) => coordKey(p.position) === coordKey(position)
  );
  if (piecesAtPosition.length > 0) {
    return { valid: false, reason: 'Position is already occupied' };
  }

  // Check queen placement rule
  if (mustPlaceQueen(gameState, color) && piece.type !== 'queen') {
    return { valid: false, reason: 'Must place Queen Bee this turn' };
  }

  // Check valid placement positions
  const validPositions = getValidPlacementPositions(board, color, turnNumber);
  const isValidPosition = validPositions.some(
    (p) => coordKey(p) === coordKey(position)
  );

  if (!isValidPosition) {
    if (board.length >= 2) {
      return {
        valid: false,
        reason: 'Must place touching only your own pieces',
      };
    }
    return { valid: false, reason: 'Invalid placement position' };
  }

  return { valid: true };
}

// Get all pieces in a player's hand that can be placed
export function getPlaceablePieces(gameState: GameState, color: PlayerColor): Piece[] {
  const hand = color === 'white' ? gameState.whiteHand : gameState.blackHand;

  // If must place queen, only return queen
  if (mustPlaceQueen(gameState, color)) {
    return hand.filter((p) => p.type === 'queen');
  }

  return hand;
}
