'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeToggle } from '../components/ThemeToggle';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import {
  GameState,
  PlayerColor,
  Piece,
  PlacedPiece,
  HexCoord,
  createInitialHand,
} from '@/lib/hive/types';
import {
  axialToPixel,
  coordsEqual,
  coordKey,
  getNeighbors,
  getTopPieceAt,
} from '@/lib/hive/hexUtils';
import { getValidPlacements } from '@/lib/hive/placementRules';
import { getValidMoves, executeMove } from '@/lib/hive/moveValidation';
import { checkWinCondition } from '@/lib/hive/winCondition';

const HEX_SIZE = 40;
const PIECE_EMOJIS: Record<string, string> = {
  queen: '👑',
  beetle: '🪲',
  grasshopper: '🦗',
  spider: '🕷️',
  ant: '🐜',
  ladybug: '🐞',
  mosquito: '🦟',
  pillbug: '🐛',
};

function HexTile({
  coord,
  piece,
  isSelected,
  isValidMove,
  onClick,
  hexSize,
}: {
  coord: HexCoord;
  piece?: PlacedPiece;
  isSelected: boolean;
  isValidMove: boolean;
  onClick: () => void;
  hexSize: number;
}) {
  const { x, y } = axialToPixel(coord, hexSize);

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {/* Hex shape */}
      <polygon
        points={getHexPoints(hexSize * 0.95)}
        fill={
          isSelected
            ? '#fbbf24'
            : isValidMove
            ? '#86efac'
            : piece
            ? piece.color === 'white'
              ? '#f5f5f4'
              : '#292524'
            : 'transparent'
        }
        stroke={piece || isValidMove ? '#71717a' : 'transparent'}
        strokeWidth={2}
        className="transition-colors duration-200"
      />
      {/* Piece emoji */}
      {piece && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={hexSize * 0.8}
          style={{ pointerEvents: 'none' }}
        >
          {PIECE_EMOJIS[piece.type]}
        </text>
      )}
      {/* Valid move indicator */}
      {isValidMove && !piece && (
        <circle r={hexSize * 0.2} fill="#22c55e" opacity={0.6} />
      )}
    </g>
  );
}

function getHexPoints(size: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    points.push(`${size * Math.cos(angle)},${size * Math.sin(angle)}`);
  }
  return points.join(' ');
}

function PlayerHand({
  pieces,
  color,
  isCurrentTurn,
  selectedPiece,
  onSelectPiece,
}: {
  pieces: Piece[];
  color: PlayerColor;
  isCurrentTurn: boolean;
  selectedPiece: Piece | null;
  onSelectPiece: (piece: Piece) => void;
}) {
  const groupedPieces = useMemo(() => {
    const groups: Record<string, Piece[]> = {};
    pieces.forEach((p) => {
      if (!groups[p.type]) groups[p.type] = [];
      groups[p.type].push(p);
    });
    return groups;
  }, [pieces]);

  return (
    <div
      className={`p-3 rounded-xl ${
        color === 'white'
          ? 'bg-stone-100 dark:bg-stone-800'
          : 'bg-stone-800 dark:bg-stone-200'
      } ${isCurrentTurn ? 'ring-2 ring-yellow-400' : 'opacity-60'}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-3 h-3 rounded-full ${
            color === 'white' ? 'bg-white border border-gray-300' : 'bg-black'
          }`}
        />
        <span
          className={`text-sm font-medium ${
            color === 'white'
              ? 'text-stone-800 dark:text-stone-200'
              : 'text-stone-200 dark:text-stone-800'
          }`}
        >
          {color === 'white' ? 'White' : 'Black'}
          {isCurrentTurn && ' (Your turn)'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(groupedPieces).map(([type, typePieces]) => (
          <button
            key={type}
            onClick={() => isCurrentTurn && onSelectPiece(typePieces[0])}
            disabled={!isCurrentTurn}
            className={`relative px-2 py-1 rounded-lg text-xl transition-all ${
              selectedPiece?.type === type && selectedPiece?.color === color
                ? 'bg-yellow-400 scale-110'
                : 'hover:bg-black/10 dark:hover:bg-white/10'
            } ${!isCurrentTurn ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {PIECE_EMOJIS[type]}
            {typePieces.length > 1 && (
              <span className="absolute -top-1 -right-1 text-xs bg-gray-500 text-white rounded-full w-4 h-4 flex items-center justify-center">
                {typePieces.length}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function HivePage() {
  useMarkAppViewed('hive');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedPiece, setSelectedPiece] = useState<{
    piece: Piece | PlacedPiece;
    source: 'hand' | 'board';
  } | null>(null);
  const [validMoves, setValidMoves] = useState<HexCoord[]>([]);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Initialize local game
  const startNewGame = useCallback(() => {
    const expansions = { ladybug: false, mosquito: false, pillbug: false };
    const newGame: GameState = {
      id: 'local',
      shortCode: 'LOCAL',
      status: 'playing',
      whitePlayerId: 'daniel',
      blackPlayerId: 'huaiyao',
      currentTurn: 'white',
      turnNumber: 1,
      settings: { turnTimerMinutes: 0, expansionPieces: expansions },
      board: [],
      whiteHand: createInitialHand('white', expansions),
      blackHand: createInitialHand('black', expansions),
      whiteQueenPlaced: false,
      blackQueenPlaced: false,
      lastMovedPiece: null,
      turnStartedAt: null,
      winner: null,
      createdAt: new Date().toISOString(),
    };
    setGameState(newGame);
    setSelectedPiece(null);
    setValidMoves([]);
  }, []);

  useEffect(() => {
    startNewGame();
  }, [startNewGame]);

  // Calculate valid moves when piece is selected
  useEffect(() => {
    if (!gameState || !selectedPiece) {
      setValidMoves([]);
      return;
    }

    if (selectedPiece.source === 'hand') {
      const placements = getValidPlacements(
        gameState.board,
        selectedPiece.piece.color,
        gameState.turnNumber
      );
      setValidMoves(placements);
    } else {
      const moves = getValidMoves(
        gameState.board,
        selectedPiece.piece as PlacedPiece,
        gameState
      );
      setValidMoves(moves);
    }
  }, [gameState, selectedPiece]);

  const handleHexClick = (coord: HexCoord) => {
    if (!gameState || gameState.status !== 'playing') return;

    const topPiece = getTopPieceAt(gameState.board, coord);

    // If clicking on a valid move destination
    if (
      selectedPiece &&
      validMoves.some((m) => coordsEqual(m, coord))
    ) {
      const move = {
        type: selectedPiece.source === 'hand' ? 'place' : 'move',
        pieceId: selectedPiece.piece.id,
        from:
          selectedPiece.source === 'board'
            ? (selectedPiece.piece as PlacedPiece).position
            : undefined,
        to: coord,
      } as const;

      const newState = executeMove(gameState, move);
      if (newState) {
        // Check win condition
        const winner = checkWinCondition(newState.board);
        if (winner) {
          newState.status = 'finished';
          newState.winner = winner;
        }
        setGameState(newState);
      }
      setSelectedPiece(null);
      setValidMoves([]);
      return;
    }

    // If clicking on own piece on board
    if (topPiece && topPiece.color === gameState.currentTurn) {
      setSelectedPiece({ piece: topPiece, source: 'board' });
      return;
    }

    // Deselect
    setSelectedPiece(null);
  };

  const handleHandPieceSelect = (piece: Piece) => {
    if (!gameState || piece.color !== gameState.currentTurn) return;
    setSelectedPiece({ piece, source: 'hand' });
  };

  // Get all coordinates to render (board pieces + valid moves + neighbors)
  const renderCoords = useMemo(() => {
    if (!gameState) return [];

    const coordSet = new Set<string>();

    // Add all board piece positions
    gameState.board.forEach((p) => coordSet.add(coordKey(p.position)));

    // Add valid moves
    validMoves.forEach((m) => coordSet.add(coordKey(m)));

    // Add neighbors of all pieces (for context)
    gameState.board.forEach((p) => {
      getNeighbors(p.position).forEach((n) => coordSet.add(coordKey(n)));
    });

    // If board is empty, show center
    if (coordSet.size === 0) {
      coordSet.add(coordKey({ q: 0, r: 0 }));
      getNeighbors({ q: 0, r: 0 }).forEach((n) => coordSet.add(coordKey(n)));
    }

    return Array.from(coordSet).map((key) => {
      const [q, r] = key.split(',').map(Number);
      return { q, r };
    });
  }, [gameState, validMoves]);

  if (!gameState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-stone-900 dark:to-amber-950 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="w-12 h-12 border-4 border-amber-300 border-t-amber-600 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-stone-900 dark:to-amber-950">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <a
          href="/"
          className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
        >
          ← Home
        </a>
        <h1 className="text-2xl font-bold text-amber-800 dark:text-amber-200">
          🐝 Hive
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={startNewGame}
            className="px-3 py-1 text-sm bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 rounded-lg hover:bg-amber-300 dark:hover:bg-amber-700"
          >
            New Game
          </button>
          <ThemeToggle />
        </div>
      </div>

      {/* Game Status */}
      {gameState.status === 'finished' && (
        <div className="text-center py-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="inline-block px-6 py-3 bg-yellow-400 dark:bg-yellow-600 rounded-xl text-xl font-bold"
          >
            {gameState.winner === 'draw'
              ? "It's a Draw!"
              : `${gameState.winner === 'white' ? 'White' : 'Black'} Wins!`}
          </motion.div>
        </div>
      )}

      {/* White Player Hand (Top) */}
      <div className="px-4">
        <PlayerHand
          pieces={gameState.whiteHand}
          color="white"
          isCurrentTurn={gameState.currentTurn === 'white' && gameState.status === 'playing'}
          selectedPiece={
            selectedPiece?.source === 'hand' && selectedPiece.piece.color === 'white'
              ? selectedPiece.piece
              : null
          }
          onSelectPiece={handleHandPieceSelect}
        />
      </div>

      {/* Game Board */}
      <div className="flex-1 overflow-hidden p-4">
        <div
          className="w-full h-[400px] bg-gradient-to-br from-green-100 to-emerald-200 dark:from-green-900 dark:to-emerald-950 rounded-xl overflow-hidden"
          style={{ touchAction: 'none' }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="-200 -200 400 400"
            style={{ transform: `scale(${zoom}) translate(${viewOffset.x}px, ${viewOffset.y}px)` }}
          >
            {renderCoords.map((coord) => {
              const topPiece = getTopPieceAt(gameState.board, coord);
              const isSelected =
                selectedPiece?.source === 'board' &&
                coordsEqual((selectedPiece.piece as PlacedPiece).position, coord);
              const isValidMove = validMoves.some((m) => coordsEqual(m, coord));

              return (
                <HexTile
                  key={coordKey(coord)}
                  coord={coord}
                  piece={topPiece || undefined}
                  isSelected={isSelected}
                  isValidMove={isValidMove}
                  onClick={() => handleHexClick(coord)}
                  hexSize={HEX_SIZE}
                />
              );
            })}
          </svg>
        </div>

        {/* Zoom controls */}
        <div className="flex justify-center gap-2 mt-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
          >
            -
          </button>
          <span className="px-3 py-1">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
          >
            +
          </button>
        </div>
      </div>

      {/* Black Player Hand (Bottom) */}
      <div className="px-4 pb-4">
        <PlayerHand
          pieces={gameState.blackHand}
          color="black"
          isCurrentTurn={gameState.currentTurn === 'black' && gameState.status === 'playing'}
          selectedPiece={
            selectedPiece?.source === 'hand' && selectedPiece.piece.color === 'black'
              ? selectedPiece.piece
              : null
          }
          onSelectPiece={handleHandPieceSelect}
        />
      </div>

      {/* Turn indicator */}
      <div className="fixed bottom-4 right-4 px-4 py-2 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 font-medium shadow-lg">
        Turn {gameState.turnNumber}: {gameState.currentTurn === 'white' ? 'White' : 'Black'}
      </div>
    </div>
  );
}
