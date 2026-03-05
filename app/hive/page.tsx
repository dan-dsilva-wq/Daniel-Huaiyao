'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
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
import { getValidPlacementPositions } from '@/lib/hive/placementRules';
import { getValidMoves, executeMove } from '@/lib/hive/moveValidation';
import { checkWinCondition } from '@/lib/hive/winCondition';
import {
  chooseHiveMoveForColor,
  createHiveMctsGraphCache,
  oppositeColor,
  type HiveComputerDifficulty,
  type HiveModelHandle,
  type HiveSearchEngine,
  type HiveSearchStats,
} from '@/lib/hive/ai';
import { getActiveHiveModel } from '@/lib/hive/ml';

const HEX_SIZE = 40;
const COMPUTER_COLOR: PlayerColor = 'black';

type MatchMode = 'hotseat' | 'computer';

const DIFFICULTY_LABELS: Record<HiveComputerDifficulty, string> = {
  medium: 'Medium',
  hard: 'Hard',
  extreme: 'Extreme',
};

const ENGINE_LABELS: Record<HiveSearchEngine, string> = {
  classic: 'Classic',
  alphazero: 'AlphaZero',
  gumbel: 'Gumbel',
};

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
    pieces.forEach((piece) => {
      if (!groups[piece.type]) groups[piece.type] = [];
      groups[piece.type].push(piece);
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

  const [matchMode, setMatchMode] = useState<MatchMode>('computer');
  const [computerDifficulty, setComputerDifficulty] = useState<HiveComputerDifficulty>('hard');
  const [computerEngine, setComputerEngine] = useState<HiveSearchEngine>('alphazero');

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedPiece, setSelectedPiece] = useState<{
    piece: Piece | PlacedPiece;
    source: 'hand' | 'board';
  } | null>(null);
  const [validMoves, setValidMoves] = useState<HexCoord[]>([]);
  const [viewOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [awaitingComputerMove, setAwaitingComputerMove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearchStats, setLastSearchStats] = useState<HiveSearchStats | null>(null);

  const activeModel = useMemo(() => getActiveHiveModel(), []);
  const computerModelHandle = useMemo<HiveModelHandle>(() => ({
    model: activeModel,
    graphCache: createHiveMctsGraphCache({
      nodeCap: 120000,
      edgeCap: 600000,
    }),
  }), [activeModel]);
  const modelProgressPercent = Math.min(
    100,
    Math.round((activeModel.training.positionSamples / 400000) * 100),
  );

  const startNewGame = useCallback((mode: MatchMode) => {
    const expansions = { ladybug: false, mosquito: false, pillbug: false };
    const newGame: GameState = {
      id: `local-${Date.now()}`,
      shortCode: 'LOCAL',
      status: 'playing',
      whitePlayerId: 'daniel',
      blackPlayerId: mode === 'computer' ? 'computer' : 'huaiyao',
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
    setAwaitingComputerMove(false);
    setLastSearchStats(null);
    setError(null);
  }, []);

  useEffect(() => {
    startNewGame(matchMode);
  }, [matchMode, startNewGame]);

  useEffect(() => {
    if (!gameState || !selectedPiece) {
      setValidMoves([]);
      return;
    }

    if (selectedPiece.source === 'hand') {
      const placements = getValidPlacementPositions(
        gameState.board,
        selectedPiece.piece.color,
        gameState.turnNumber,
      );
      setValidMoves(placements);
      return;
    }

    const moves = getValidMoves(gameState, selectedPiece.piece as PlacedPiece);
    setValidMoves(moves);
  }, [gameState, selectedPiece]);

  useEffect(() => {
    if (!gameState || matchMode !== 'computer') return;
    if (gameState.status !== 'playing' || gameState.currentTurn !== COMPUTER_COLOR) return;

    const thinkingDelay =
      computerDifficulty === 'extreme'
        ? 650
        : computerDifficulty === 'hard'
          ? 450
          : 320;

    setAwaitingComputerMove(true);
    const timer = window.setTimeout(() => {
      try {
        setGameState((prev) => {
          if (!prev || prev.status !== 'playing' || prev.currentTurn !== COMPUTER_COLOR) {
            return prev;
          }

          let capturedStats: HiveSearchStats | null = null;
          const aiMove = chooseHiveMoveForColor(
            prev,
            COMPUTER_COLOR,
            computerDifficulty,
            {
              engine: computerEngine,
              modelHandle: computerModelHandle,
              randomSeed: prev.turnNumber * 997 + Date.now(),
              onSearchStats: (stats) => {
                capturedStats = stats;
              },
            },
          );
          if (!aiMove) {
            return {
              ...prev,
              status: 'finished',
              winner: oppositeColor(COMPUTER_COLOR),
            };
          }

          if (capturedStats) {
            setLastSearchStats(capturedStats);
          }

          const nextState = executeMove(prev, aiMove);
          const result = checkWinCondition(nextState.board);
          if (result.gameOver) {
            nextState.status = 'finished';
            nextState.winner = result.winner;
          }
          return nextState;
        });
      } catch {
        setError('Computer move failed. Please start a new game.');
      } finally {
        setAwaitingComputerMove(false);
      }
    }, thinkingDelay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [computerDifficulty, computerEngine, computerModelHandle, gameState, matchMode]);

  const isHumanTurn =
    !!gameState
    && gameState.status === 'playing'
    && (matchMode === 'hotseat' || gameState.currentTurn !== COMPUTER_COLOR);

  const isColorControlledByHuman = useCallback(
    (color: PlayerColor) => matchMode === 'hotseat' || color !== COMPUTER_COLOR,
    [matchMode],
  );

  const handleHexClick = (coord: HexCoord) => {
    if (!gameState || gameState.status !== 'playing') return;
    if (matchMode === 'computer' && gameState.currentTurn === COMPUTER_COLOR) return;

    const topPiece = getTopPieceAt(gameState.board, coord);

    if (selectedPiece && validMoves.some((move) => coordsEqual(move, coord))) {
      const move = {
        type: selectedPiece.source === 'hand' ? 'place' : 'move',
        pieceId: selectedPiece.piece.id,
        from:
          selectedPiece.source === 'board'
            ? (selectedPiece.piece as PlacedPiece).position
            : undefined,
        to: coord,
      } as const;

      const nextState = executeMove(gameState, move);
      const result = checkWinCondition(nextState.board);
      if (result.gameOver) {
        nextState.status = 'finished';
        nextState.winner = result.winner;
      }

      setGameState(nextState);
      setSelectedPiece(null);
      setValidMoves([]);
      return;
    }

    if (
      topPiece
      && topPiece.color === gameState.currentTurn
      && isColorControlledByHuman(topPiece.color)
    ) {
      setSelectedPiece({ piece: topPiece, source: 'board' });
      return;
    }

    setSelectedPiece(null);
  };

  const handleHandPieceSelect = (piece: Piece) => {
    if (!gameState || !isHumanTurn) return;
    if (piece.color !== gameState.currentTurn) return;
    setSelectedPiece({ piece, source: 'hand' });
  };

  const renderCoords = useMemo(() => {
    if (!gameState) return [];

    const coordSet = new Set<string>();

    gameState.board.forEach((piece) => coordSet.add(coordKey(piece.position)));
    validMoves.forEach((move) => coordSet.add(coordKey(move)));

    gameState.board.forEach((piece) => {
      getNeighbors(piece.position).forEach((neighbor) => coordSet.add(coordKey(neighbor)));
    });

    if (coordSet.size === 0) {
      coordSet.add(coordKey({ q: 0, r: 0 }));
      getNeighbors({ q: 0, r: 0 }).forEach((neighbor) => coordSet.add(coordKey(neighbor)));
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

  const modelKind = activeModel.kind === 'mlp'
    ? `MLP ${activeModel.layers.slice(0, -1).map((layer) => layer.outputSize).join('x')}`
    : activeModel.kind === 'policy_value'
      ? `PolicyValue ${activeModel.stateTrunk.map((layer) => layer.outputSize).join('x')}`
      : 'Linear';

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-yellow-100 dark:from-stone-900 dark:to-amber-950">
      <div className="flex items-center justify-between p-4">
        <Link
          href="/"
          className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
        >
          ← Home
        </Link>
        <h1 className="text-2xl font-bold text-amber-800 dark:text-amber-200">🐝 Hive</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/hive/training"
            className="px-3 py-1 text-sm bg-stone-200 dark:bg-stone-700 text-stone-800 dark:text-stone-200 rounded-lg hover:bg-stone-300 dark:hover:bg-stone-600"
          >
            Training
          </Link>
          <button
            onClick={() => startNewGame(matchMode)}
            className="px-3 py-1 text-sm bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 rounded-lg hover:bg-amber-300 dark:hover:bg-amber-700"
          >
            New Game
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div className="px-4 pb-3 max-w-4xl mx-auto space-y-3">
        {error && (
          <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
          </div>
        )}

        <div className="flex items-center justify-center gap-2 p-1 rounded-xl bg-amber-100/80 dark:bg-stone-800/70">
          <button
            onClick={() => setMatchMode('computer')}
            className={`px-3 py-1.5 text-sm rounded-lg font-semibold transition ${
              matchMode === 'computer'
                ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-white shadow-sm'
                : 'text-stone-500 dark:text-stone-400'
            }`}
          >
            Vs Computer
          </button>
          <button
            onClick={() => setMatchMode('hotseat')}
            className={`px-3 py-1.5 text-sm rounded-lg font-semibold transition ${
              matchMode === 'hotseat'
                ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-white shadow-sm'
                : 'text-stone-500 dark:text-stone-400'
            }`}
          >
            Hotseat
          </button>
        </div>

        {matchMode === 'computer' && (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {(['medium', 'hard', 'extreme'] as HiveComputerDifficulty[]).map((difficulty) => (
                <button
                  key={difficulty}
                  onClick={() => setComputerDifficulty(difficulty)}
                  className={`px-3 py-1 text-xs rounded-full border font-semibold transition ${
                    computerDifficulty === difficulty
                      ? 'bg-stone-900 dark:bg-stone-100 border-stone-900 dark:border-stone-100 text-white dark:text-stone-900'
                      : 'bg-white/80 dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300'
                  }`}
                >
                  {DIFFICULTY_LABELS[difficulty]}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {(['classic', 'alphazero', 'gumbel'] as HiveSearchEngine[]).map((engine) => (
                <button
                  key={engine}
                  onClick={() => setComputerEngine(engine)}
                  className={`px-3 py-1 text-xs rounded-full border font-semibold transition ${
                    computerEngine === engine
                      ? 'bg-amber-500 border-amber-600 text-white'
                      : 'bg-white/80 dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300'
                  }`}
                >
                  {ENGINE_LABELS[engine]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-amber-300/70 dark:border-amber-800/70 bg-white/70 dark:bg-stone-900/50 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-amber-900 dark:text-amber-100">
              Model: {modelKind}
            </span>
            <span className="text-amber-800/80 dark:text-amber-200/80">
              Samples {activeModel.training.positionSamples.toLocaleString()} | Epochs {activeModel.training.epochs}
            </span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-amber-100 dark:bg-stone-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-lime-500"
              style={{ width: `${modelProgressPercent}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-amber-900/80 dark:text-amber-200/80">
            <span>Training Progress (samples target): {modelProgressPercent}%</span>
            <span>{new Date(activeModel.training.generatedAt).toLocaleString()}</span>
          </div>
          {lastSearchStats && (
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-amber-900/80 dark:text-amber-200/80">
              <span>Engine: {ENGINE_LABELS[lastSearchStats.engine]}</span>
              <span>Sims: {lastSearchStats.simulations}</span>
              <span>Nodes/s: {lastSearchStats.nodesPerSecond.toFixed(1)}</span>
              <span>Entropy: {lastSearchStats.policyEntropy.toFixed(3)}</span>
            </div>
          )}
        </div>
      </div>

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

      {matchMode === 'computer' && gameState.status === 'playing' && gameState.currentTurn === COMPUTER_COLOR && (
        <div className="text-center text-sm text-stone-600 dark:text-stone-300 py-1">
          {awaitingComputerMove ? 'Computer is thinking...' : 'Computer is choosing a move...'}
        </div>
      )}

      <div className="px-4">
        <PlayerHand
          pieces={gameState.whiteHand}
          color="white"
          isCurrentTurn={
            gameState.currentTurn === 'white'
            && gameState.status === 'playing'
            && isColorControlledByHuman('white')
          }
          selectedPiece={
            selectedPiece?.source === 'hand' && selectedPiece.piece.color === 'white'
              ? selectedPiece.piece
              : null
          }
          onSelectPiece={handleHandPieceSelect}
        />
      </div>

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
                selectedPiece?.source === 'board'
                && coordsEqual((selectedPiece.piece as PlacedPiece).position, coord);
              const isValidMove = validMoves.some((move) => coordsEqual(move, coord));

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

        <div className="flex justify-center gap-2 mt-2">
          <button
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
          >
            -
          </button>
          <span className="px-3 py-1">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
          >
            +
          </button>
        </div>
      </div>

      <div className="px-4 pb-4">
        <PlayerHand
          pieces={gameState.blackHand}
          color="black"
          isCurrentTurn={
            gameState.currentTurn === 'black'
            && gameState.status === 'playing'
            && isColorControlledByHuman('black')
          }
          selectedPiece={
            selectedPiece?.source === 'hand' && selectedPiece.piece.color === 'black'
              ? selectedPiece.piece
              : null
          }
          onSelectPiece={handleHandPieceSelect}
        />
      </div>

      <div className="fixed bottom-4 right-4 px-4 py-2 rounded-full bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 font-medium shadow-lg">
        Turn {gameState.turnNumber}:{' '}
        {gameState.currentTurn === 'white'
          ? 'White'
          : matchMode === 'computer'
            ? 'Computer (Black)'
            : 'Black'}
      </div>
    </div>
  );
}
