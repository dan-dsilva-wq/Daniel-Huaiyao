// Move Validation - Orchestrates all movement rules
import { HexCoord, PlacedPiece, GameState, PlayerColor, Move } from './types';
import { coordKey } from './hexUtils';
import {
  getQueenMoves,
  getBeetleMoves,
  getBeetleStackOrder,
  getGrasshopperMoves,
  getSpiderMoves,
  getAntMoves,
  getLadybugMoves,
  getMosquitoMoves,
  getPillbugMoves,
} from './pieceMovement';
import {
  getValidPlacementPositions,
  isValidPlacement,
  canMovePieces,
  getPlaceablePieces,
} from './placementRules';
import { checkWinCondition } from './winCondition';

// Get all valid moves for a piece
export function getValidMoves(
  gameState: GameState,
  piece: PlacedPiece
): HexCoord[] {
  const currentPlayer = gameState.currentTurn;

  // Can't move opponent's pieces
  if (piece.color !== currentPlayer) {
    return [];
  }

  // Must have queen placed to move pieces
  if (!canMovePieces(gameState, currentPlayer)) {
    return [];
  }

  // Check if piece was moved by pillbug last turn (cannot move)
  if (
    gameState.lastMovedPiece?.pieceId === piece.id &&
    gameState.lastMovedPiece?.byPillbug
  ) {
    return [];
  }

  switch (piece.type) {
    case 'queen':
      return getQueenMoves(gameState.board, piece);
    case 'beetle':
      return getBeetleMoves(gameState.board, piece);
    case 'grasshopper':
      return getGrasshopperMoves(gameState.board, piece);
    case 'spider':
      return getSpiderMoves(gameState.board, piece);
    case 'ant':
      return getAntMoves(gameState.board, piece);
    case 'ladybug':
      return getLadybugMoves(gameState.board, piece);
    case 'mosquito':
      return getMosquitoMoves(gameState.board, piece, gameState.lastMovedPiece);
    case 'pillbug':
      return getPillbugMoves(gameState.board, piece, gameState.lastMovedPiece)
        .normalMoves;
    default:
      return [];
  }
}

// Get pillbug special ability targets
export function getPillbugAbilityTargets(
  gameState: GameState,
  pillbug: PlacedPiece
): { targetPiece: PlacedPiece; validDestinations: HexCoord[] }[] {
  if (pillbug.color !== gameState.currentTurn) {
    return [];
  }

  const result = getPillbugMoves(
    gameState.board,
    pillbug,
    gameState.lastMovedPiece
  );
  return result.specialAbility;
}

// Check if a move is valid
export function isValidMove(
  gameState: GameState,
  move: Move
): { valid: boolean; reason?: string } {
  if (move.type === 'place') {
    // Find piece in hand
    const hand =
      gameState.currentTurn === 'white'
        ? gameState.whiteHand
        : gameState.blackHand;
    const piece = hand.find((p) => p.id === move.pieceId);

    if (!piece) {
      return { valid: false, reason: 'Piece not in hand' };
    }

    return isValidPlacement(gameState.board, piece, move.to, gameState);
  }

  if (move.type === 'move') {
    // Find piece on board
    const piece = gameState.board.find((p) => p.id === move.pieceId);

    if (!piece) {
      return { valid: false, reason: 'Piece not on board' };
    }

    // Check for pillbug ability
    if (move.isPillbugAbility && move.targetPieceId) {
      const pillbug = gameState.board.find((p) => p.id === move.pieceId);
      if (!pillbug || (pillbug.type !== 'pillbug' && pillbug.type !== 'mosquito')) {
        return { valid: false, reason: 'Invalid pillbug ability' };
      }

      const targets = getPillbugAbilityTargets(gameState, pillbug);
      const target = targets.find((t) => t.targetPiece.id === move.targetPieceId);

      if (!target) {
        return { valid: false, reason: 'Cannot move that piece with pillbug' };
      }

      const validDest = target.validDestinations.some(
        (d) => coordKey(d) === coordKey(move.to)
      );

      if (!validDest) {
        return { valid: false, reason: 'Invalid destination for pillbug ability' };
      }

      return { valid: true };
    }

    const validMoves = getValidMoves(gameState, piece);
    const isValid = validMoves.some((m) => coordKey(m) === coordKey(move.to));

    if (!isValid) {
      return { valid: false, reason: 'Invalid move for this piece' };
    }

    return { valid: true };
  }

  return { valid: false, reason: 'Unknown move type' };
}

// Execute a move and return the new game state
export function executeMove(gameState: GameState, move: Move): GameState {
  const newState = { ...gameState };

  if (move.type === 'place') {
    // Remove piece from hand
    if (newState.currentTurn === 'white') {
      newState.whiteHand = newState.whiteHand.filter(
        (p) => p.id !== move.pieceId
      );
    } else {
      newState.blackHand = newState.blackHand.filter(
        (p) => p.id !== move.pieceId
      );
    }

    // Find the piece
    const hand =
      gameState.currentTurn === 'white'
        ? gameState.whiteHand
        : gameState.blackHand;
    const piece = hand.find((p) => p.id === move.pieceId)!;

    // Add to board
    const placedPiece: PlacedPiece = {
      ...piece,
      position: move.to,
      stackOrder: 0,
    };
    newState.board = [...newState.board, placedPiece];

    // Track queen placement
    if (piece.type === 'queen') {
      if (piece.color === 'white') {
        newState.whiteQueenPlaced = true;
      } else {
        newState.blackQueenPlaced = true;
      }
    }

    // Track last placed piece so it can be highlighted
    newState.lastMovedPiece = { pieceId: move.pieceId, byPillbug: false, to: move.to, isPlacement: true };
  } else if (move.type === 'move') {
    if (move.isPillbugAbility && move.targetPieceId) {
      // Pillbug moving another piece
      const targetPiece = gameState.board.find((p) => p.id === move.targetPieceId);
      const fromPosition = targetPiece?.position;
      newState.board = newState.board.map((p) => {
        if (p.id === move.targetPieceId) {
          return { ...p, position: move.to, stackOrder: 0 };
        }
        return p;
      });
      newState.lastMovedPiece = { pieceId: move.targetPieceId, byPillbug: true, from: fromPosition, to: move.to, isPlacement: false };
    } else {
      // Regular move
      const piece = newState.board.find((p) => p.id === move.pieceId)!;
      const fromPosition = piece.position;
      const newStackOrder =
        piece.type === 'beetle'
          ? getBeetleStackOrder(newState.board, piece.id, move.to)
          : 0;

      newState.board = newState.board.map((p) => {
        if (p.id === move.pieceId) {
          return { ...p, position: move.to, stackOrder: newStackOrder };
        }
        return p;
      });
      newState.lastMovedPiece = { pieceId: move.pieceId, byPillbug: false, from: fromPosition, to: move.to, isPlacement: false };
    }
  }

  // Check win condition
  const winResult = checkWinCondition(newState.board);
  if (winResult.gameOver) {
    newState.status = 'finished';
    newState.winner = winResult.winner;
  }

  // Switch turns
  newState.currentTurn = newState.currentTurn === 'white' ? 'black' : 'white';
  newState.turnNumber += 1;
  newState.turnStartedAt = new Date().toISOString();

  return newState;
}

// Get all valid actions for the current player
export function getAllValidActions(gameState: GameState): {
  placements: { pieceId: string; positions: HexCoord[] }[];
  moves: { pieceId: string; destinations: HexCoord[] }[];
  pillbugAbilities: {
    pillbugId: string;
    targets: { targetPieceId: string; destinations: HexCoord[] }[];
  }[];
} {
  const currentPlayer = gameState.currentTurn;

  // Get valid placements
  const placeablePieces = getPlaceablePieces(gameState, currentPlayer);
  const placementPositions = getValidPlacementPositions(
    gameState.board,
    currentPlayer,
    gameState.turnNumber
  );

  const placements = placeablePieces.map((piece) => ({
    pieceId: piece.id,
    positions: placementPositions,
  }));

  // Get valid moves
  const playerPieces = gameState.board.filter(
    (p) => p.color === currentPlayer
  );
  const moves: { pieceId: string; destinations: HexCoord[] }[] = [];
  const pillbugAbilities: {
    pillbugId: string;
    targets: { targetPieceId: string; destinations: HexCoord[] }[];
  }[] = [];

  for (const piece of playerPieces) {
    const validMoves = getValidMoves(gameState, piece);
    if (validMoves.length > 0) {
      moves.push({ pieceId: piece.id, destinations: validMoves });
    }

    // Check for pillbug abilities
    if (piece.type === 'pillbug' || piece.type === 'mosquito') {
      const abilities = getPillbugAbilityTargets(gameState, piece);
      if (abilities.length > 0) {
        pillbugAbilities.push({
          pillbugId: piece.id,
          targets: abilities.map((a) => ({
            targetPieceId: a.targetPiece.id,
            destinations: a.validDestinations,
          })),
        });
      }
    }
  }

  return { placements, moves, pillbugAbilities };
}

// Check if the current player has any valid actions
export function hasValidActions(gameState: GameState): boolean {
  const actions = getAllValidActions(gameState);
  return (
    actions.placements.some((p) => p.positions.length > 0) ||
    actions.moves.length > 0 ||
    actions.pillbugAbilities.length > 0
  );
}
