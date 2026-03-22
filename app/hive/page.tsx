'use client';

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
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
import { getActiveHiveModel, parseHiveModel, type HiveModel } from '@/lib/hive/ml';

const HEX_SIZE = 40;
const COMPUTER_COLOR: PlayerColor = 'black';
const MIN_BOARD_ZOOM = 0.45;
const MAX_BOARD_ZOOM = 2.5;
const BOARD_PADDING = HEX_SIZE * 3.5;
const DRAG_THRESHOLD = 8;

type MatchMode = 'hotseat' | 'computer';
type CameraMode = 'auto' | 'manual';
type ViewPoint = { x: number; y: number };

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

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pointsEqual(a: ViewPoint, b: ViewPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function getDistance(a: ViewPoint, b: ViewPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

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

function formatModelKind(model: HiveModel): string {
  return model.kind === 'mlp'
    ? `MLP ${model.layers.slice(0, -1).map((layer) => layer.outputSize).join('x')}`
    : model.kind === 'policy_value'
      ? `PolicyValue ${model.stateTrunk.map((layer) => layer.outputSize).join('x')}`
      : 'Linear';
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
  const [cameraMode, setCameraMode] = useState<CameraMode>('auto');
  const [cameraCenter, setCameraCenter] = useState<ViewPoint>({ x: 0, y: 0 });
  const [boardViewportSize, setBoardViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [awaitingComputerMove, setAwaitingComputerMove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearchStats, setLastSearchStats] = useState<HiveSearchStats | null>(null);
  const bundledModel = useMemo(() => getActiveHiveModel(), []);
  const [activeModel, setActiveModel] = useState<HiveModel>(bundledModel);
  const [activeModelHash, setActiveModelHash] = useState<string | null>(null);
  const [isLiveModelLoaded, setIsLiveModelLoaded] = useState(false);
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const cameraStateRef = useRef({ center: { x: 0, y: 0 }, zoom: 1 });
  const suppressBoardClickRef = useRef(false);
  const gestureStateRef = useRef<{
    pointers: Map<number, ViewPoint>;
    startPoint: ViewPoint | null;
    startCenter: ViewPoint;
    startZoom: number;
    startDistance: number | null;
    anchorWorld: ViewPoint | null;
    moved: boolean;
  }>({
    pointers: new Map<number, ViewPoint>(),
    startPoint: null,
    startCenter: { x: 0, y: 0 },
    startZoom: 1,
    startDistance: null,
    anchorWorld: null,
    moved: false,
  });

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

  useEffect(() => {
    let cancelled = false;

    const loadLiveModel = async () => {
      try {
        const response = await fetch('/api/hive/model', { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as {
          hash?: string;
          model?: unknown;
        };
        const parsedModel = parseHiveModel(payload.model);
        if (!parsedModel || cancelled) return;
        setActiveModel(parsedModel);
        setActiveModelHash(payload.hash ?? null);
        setIsLiveModelLoaded(true);
      } catch {
        // Keep using the bundled model if the live model endpoint is unavailable.
      }
    };

    void loadLiveModel();
    const intervalId = window.setInterval(() => {
      void loadLiveModel();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

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
    setCameraMode('auto');
    setCameraCenter({ x: 0, y: 0 });
    setZoom(1);
    cameraStateRef.current = {
      center: { x: 0, y: 0 },
      zoom: 1,
    };
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
    cameraStateRef.current = {
      center: cameraCenter,
      zoom,
    };
  }, [cameraCenter, zoom]);

  useEffect(() => {
    const viewport = boardViewportRef.current;
    if (!viewport) return;

    const syncSize = () => {
      setBoardViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(viewport);

    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', syncSize);
    visualViewport?.addEventListener('scroll', syncSize);

    return () => {
      observer.disconnect();
      visualViewport?.removeEventListener('resize', syncSize);
      visualViewport?.removeEventListener('scroll', syncSize);
    };
  }, []);

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
    if (suppressBoardClickRef.current) {
      suppressBoardClickRef.current = false;
      return;
    }

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

  const boardBounds = useMemo(() => {
    if (renderCoords.length === 0) {
      return {
        minX: -HEX_SIZE * 2,
        maxX: HEX_SIZE * 2,
        minY: -HEX_SIZE * 2,
        maxY: HEX_SIZE * 2,
        centerX: 0,
        centerY: 0,
        width: HEX_SIZE * 4,
        height: HEX_SIZE * 4,
      };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    renderCoords.forEach((coord) => {
      const { x, y } = axialToPixel(coord, HEX_SIZE);
      minX = Math.min(minX, x - HEX_SIZE);
      maxX = Math.max(maxX, x + HEX_SIZE);
      minY = Math.min(minY, y - HEX_SIZE);
      maxY = Math.max(maxY, y + HEX_SIZE);
    });

    return {
      minX,
      maxX,
      minY,
      maxY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [renderCoords]);

  const clampCameraCenter = useCallback((center: ViewPoint, targetZoom: number) => {
    if (!boardViewportSize.width || !boardViewportSize.height) {
      return center;
    }

    const visibleWidth = boardViewportSize.width / targetZoom;
    const visibleHeight = boardViewportSize.height / targetZoom;
    const minCenterX = boardBounds.minX - BOARD_PADDING + visibleWidth / 2;
    const maxCenterX = boardBounds.maxX + BOARD_PADDING - visibleWidth / 2;
    const minCenterY = boardBounds.minY - BOARD_PADDING + visibleHeight / 2;
    const maxCenterY = boardBounds.maxY + BOARD_PADDING - visibleHeight / 2;

    return {
      x:
        minCenterX <= maxCenterX
          ? clampValue(center.x, minCenterX, maxCenterX)
          : boardBounds.centerX,
      y:
        minCenterY <= maxCenterY
          ? clampValue(center.y, minCenterY, maxCenterY)
          : boardBounds.centerY,
    };
  }, [boardBounds, boardViewportSize]);

  useEffect(() => {
    if (!boardViewportSize.width || !boardViewportSize.height) return;

    const fitZoom = clampValue(
      Math.min(
        1,
        boardViewportSize.width / (boardBounds.width + BOARD_PADDING * 2),
        boardViewportSize.height / (boardBounds.height + BOARD_PADDING * 2),
      ),
      MIN_BOARD_ZOOM,
      1,
    );

    if (cameraMode === 'auto') {
      const nextCenter = clampCameraCenter(
        { x: boardBounds.centerX, y: boardBounds.centerY },
        fitZoom,
      );

      setCameraCenter((current) => (pointsEqual(current, nextCenter) ? current : nextCenter));
      setZoom((current) => (Math.abs(current - fitZoom) < 0.001 ? current : fitZoom));
      return;
    }

    setCameraCenter((current) => {
      const nextCenter = clampCameraCenter(current, zoom);
      return pointsEqual(current, nextCenter) ? current : nextCenter;
    });
  }, [boardBounds, boardViewportSize, cameraMode, clampCameraCenter, zoom]);

  const getLocalPoint = useCallback((clientX: number, clientY: number): ViewPoint | null => {
    const rect = boardViewportRef.current?.getBoundingClientRect();
    if (!rect) return null;

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const projectClientToWorld = useCallback((
    clientX: number,
    clientY: number,
    center: ViewPoint,
    targetZoom: number,
  ): ViewPoint | null => {
    const localPoint = getLocalPoint(clientX, clientY);
    if (!localPoint || !boardViewportSize.width || !boardViewportSize.height) {
      return null;
    }

    const visibleWidth = boardViewportSize.width / targetZoom;
    const visibleHeight = boardViewportSize.height / targetZoom;

    return {
      x: center.x - visibleWidth / 2 + localPoint.x / targetZoom,
      y: center.y - visibleHeight / 2 + localPoint.y / targetZoom,
    };
  }, [boardViewportSize, getLocalPoint]);

  const getCenterForAnchor = useCallback((
    anchorWorld: ViewPoint,
    clientX: number,
    clientY: number,
    targetZoom: number,
  ): ViewPoint => {
    const localPoint = getLocalPoint(clientX, clientY);
    if (!localPoint || !boardViewportSize.width || !boardViewportSize.height) {
      return clampCameraCenter(cameraStateRef.current.center, targetZoom);
    }

    return clampCameraCenter(
      {
        x: anchorWorld.x + (boardViewportSize.width / 2 - localPoint.x) / targetZoom,
        y: anchorWorld.y + (boardViewportSize.height / 2 - localPoint.y) / targetZoom,
      },
      targetZoom,
    );
  }, [boardViewportSize, clampCameraCenter, getLocalPoint]);

  const applyZoom = useCallback((
    targetZoom: number,
    anchor?: { clientX: number; clientY: number },
  ) => {
    const current = cameraStateRef.current;
    const nextZoom = clampValue(targetZoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
    if (Math.abs(nextZoom - current.zoom) < 0.001) return;

    let nextCenter = clampCameraCenter(current.center, nextZoom);

    if (anchor) {
      const anchorWorld = projectClientToWorld(
        anchor.clientX,
        anchor.clientY,
        current.center,
        current.zoom,
      );

      if (anchorWorld) {
        nextCenter = getCenterForAnchor(
          anchorWorld,
          anchor.clientX,
          anchor.clientY,
          nextZoom,
        );
      }
    }

    setCameraMode('manual');
    setZoom(nextZoom);
    setCameraCenter(nextCenter);
    cameraStateRef.current = {
      center: nextCenter,
      zoom: nextZoom,
    };
  }, [clampCameraCenter, getCenterForAnchor, projectClientToWorld]);

  const resetBoardView = useCallback(() => {
    setCameraMode('auto');
  }, []);

  const handleBoardWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    applyZoom(cameraStateRef.current.zoom * factor, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }, [applyZoom]);

  const handleBoardPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!boardViewportSize.width || !boardViewportSize.height) return;

    event.currentTarget.setPointerCapture(event.pointerId);

    const gesture = gestureStateRef.current;
    const point = { x: event.clientX, y: event.clientY };
    gesture.pointers.set(event.pointerId, point);
    suppressBoardClickRef.current = false;

    if (gesture.pointers.size === 1) {
      gesture.startPoint = point;
      gesture.startCenter = cameraStateRef.current.center;
      gesture.startZoom = cameraStateRef.current.zoom;
      gesture.startDistance = null;
      gesture.anchorWorld = projectClientToWorld(
        event.clientX,
        event.clientY,
        cameraStateRef.current.center,
        cameraStateRef.current.zoom,
      );
      gesture.moved = false;
      return;
    }

    if (gesture.pointers.size === 2) {
      const [first, second] = Array.from(gesture.pointers.values());
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };

      gesture.startPoint = midpoint;
      gesture.startCenter = cameraStateRef.current.center;
      gesture.startZoom = cameraStateRef.current.zoom;
      gesture.startDistance = Math.max(getDistance(first, second), 1);
      gesture.anchorWorld = projectClientToWorld(
        midpoint.x,
        midpoint.y,
        cameraStateRef.current.center,
        cameraStateRef.current.zoom,
      );
      gesture.moved = true;
      suppressBoardClickRef.current = true;
    }
  }, [boardViewportSize, projectClientToWorld]);

  const handleBoardPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureStateRef.current;
    if (!gesture.pointers.has(event.pointerId)) return;

    const point = { x: event.clientX, y: event.clientY };
    gesture.pointers.set(event.pointerId, point);

    if (gesture.pointers.size === 1 && gesture.startPoint) {
      const dx = point.x - gesture.startPoint.x;
      const dy = point.y - gesture.startPoint.y;

      if (!gesture.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
        gesture.moved = true;
        suppressBoardClickRef.current = true;
      }

      if (!gesture.moved) return;

      const currentZoom = cameraStateRef.current.zoom;
      const nextCenter = clampCameraCenter(
        {
          x: gesture.startCenter.x - dx / currentZoom,
          y: gesture.startCenter.y - dy / currentZoom,
        },
        currentZoom,
      );

      setCameraMode('manual');
      setCameraCenter(nextCenter);
      cameraStateRef.current = {
        center: nextCenter,
        zoom: currentZoom,
      };
      return;
    }

    if (gesture.pointers.size >= 2 && gesture.startDistance && gesture.anchorWorld) {
      const [first, second] = Array.from(gesture.pointers.values());
      const midpoint = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const nextZoom = clampValue(
        gesture.startZoom * (Math.max(getDistance(first, second), 1) / gesture.startDistance),
        MIN_BOARD_ZOOM,
        MAX_BOARD_ZOOM,
      );

      setCameraMode('manual');
      setZoom(nextZoom);
      const nextCenter = getCenterForAnchor(gesture.anchorWorld, midpoint.x, midpoint.y, nextZoom);
      setCameraCenter(nextCenter);
      cameraStateRef.current = {
        center: nextCenter,
        zoom: nextZoom,
      };
      suppressBoardClickRef.current = true;
    }
  }, [clampCameraCenter, getCenterForAnchor]);

  const handleBoardPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureStateRef.current;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    gesture.pointers.delete(event.pointerId);

    if (gesture.pointers.size === 1) {
      const [remainingPoint] = Array.from(gesture.pointers.values());
      gesture.startPoint = remainingPoint;
      gesture.startCenter = cameraStateRef.current.center;
      gesture.startZoom = cameraStateRef.current.zoom;
      gesture.startDistance = null;
      gesture.anchorWorld = projectClientToWorld(
        remainingPoint.x,
        remainingPoint.y,
        cameraStateRef.current.center,
        cameraStateRef.current.zoom,
      );
      gesture.moved = false;
      return;
    }

    if (gesture.pointers.size === 0) {
      gesture.startPoint = null;
      gesture.startDistance = null;
      gesture.anchorWorld = null;
      gesture.moved = false;
    }
  }, [projectClientToWorld]);

  const boardViewBox = useMemo(() => {
    if (!boardViewportSize.width || !boardViewportSize.height) {
      return {
        minX: -200,
        minY: -200,
        width: 400,
        height: 400,
      };
    }

    const width = boardViewportSize.width / zoom;
    const height = boardViewportSize.height / zoom;

    return {
      minX: cameraCenter.x - width / 2,
      minY: cameraCenter.y - height / 2,
      width,
      height,
    };
  }, [boardViewportSize, cameraCenter, zoom]);

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

  const modelKind = formatModelKind(activeModel);
  const modelTimestampLabel = activeModel.training.generatedAt;

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
            <span>{new Date(modelTimestampLabel).toLocaleString()}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-amber-900/70 dark:text-amber-200/70">
            <span>{activeModelHash ? `Champion ${activeModelHash}` : 'Champion bundled with app'}</span>
            <span>{isLiveModelLoaded ? 'Live model loaded' : 'Bundled fallback'}</span>
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

      <div className="p-4">
        <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-emerald-300/60 bg-white/60 p-2 shadow-sm dark:border-emerald-800/60 dark:bg-stone-950/40 sm:p-3">
          <div
            ref={boardViewportRef}
            className="relative h-[clamp(20rem,56vh,38rem)] w-full overflow-hidden rounded-[22px] bg-gradient-to-br from-green-100 via-lime-100 to-emerald-200 dark:from-green-950 dark:via-emerald-950 dark:to-stone-950"
            style={{ touchAction: 'none' }}
            onWheel={handleBoardWheel}
            onPointerDown={handleBoardPointerDown}
            onPointerMove={handleBoardPointerMove}
            onPointerUp={handleBoardPointerEnd}
            onPointerCancel={handleBoardPointerEnd}
          >
            <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.24em] text-emerald-900/70 dark:text-emerald-100/65">
              <span>Drag to pan</span>
              <span>Wheel or pinch to zoom</span>
            </div>

            <svg
              width="100%"
              height="100%"
              className="select-none"
              viewBox={`${boardViewBox.minX} ${boardViewBox.minY} ${boardViewBox.width} ${boardViewBox.height}`}
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

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50/90 px-3 py-2 text-sm text-emerald-950 dark:bg-stone-900/80 dark:text-emerald-100">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/70 dark:text-emerald-100/70">
              Zoom {Math.round(zoom * 100)}%
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => applyZoom(cameraStateRef.current.zoom - 0.2)}
                className="rounded-lg bg-white px-3 py-1.5 font-semibold shadow-sm transition hover:bg-emerald-100 dark:bg-stone-800 dark:hover:bg-stone-700"
                aria-label="Zoom out Hive board"
              >
                -
              </button>
              <button
                onClick={resetBoardView}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-white font-semibold shadow-sm transition hover:bg-emerald-700"
              >
                Reset view
              </button>
              <button
                onClick={() => applyZoom(cameraStateRef.current.zoom + 0.2)}
                className="rounded-lg bg-white px-3 py-1.5 font-semibold shadow-sm transition hover:bg-emerald-100 dark:bg-stone-800 dark:hover:bg-stone-700"
                aria-label="Zoom in Hive board"
              >
                +
              </button>
            </div>
          </div>
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
