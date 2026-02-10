'use client';

import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { GameState, Piece, TeamColor, PieceRank } from '@/lib/stratego/types';
import { getValidMoves } from '@/lib/stratego/rules';
import {
  BOARD_SIZE,
  isLake,
  getPieceShortName,
  TEAM_COLORS,
} from '@/lib/stratego/constants';

interface BoardProps {
  gameState: GameState;
  isMyTurn: boolean;
  onMove: (pieceId: string, toRow: number, toCol: number) => void;
  isMoving: boolean;
}

export default function Board({ gameState, isMyTurn, onMove, isMoving }: BoardProps) {
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);

  const myColor = gameState.my_color;
  const flipBoard = myColor === 'blue';

  const selectedPiece = useMemo(
    () => (selectedPieceId ? gameState.my_pieces.find((p) => p.id === selectedPieceId) ?? null : null),
    [selectedPieceId, gameState.my_pieces],
  );

  const validMoves = useMemo(() => {
    if (!selectedPiece) return [];
    return getValidMoves(selectedPiece, gameState.my_pieces, gameState.opponent_pieces);
  }, [selectedPiece, gameState.my_pieces, gameState.opponent_pieces]);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (!isMyTurn || isMoving) return;

      // Check if clicking a valid move target
      if (selectedPieceId) {
        const move = validMoves.find((m) => m.row === row && m.col === col);
        if (move) {
          onMove(selectedPieceId, row, col);
          setSelectedPieceId(null);
          return;
        }
      }

      // Check if clicking own piece
      const myPiece = gameState.my_pieces.find((p) => p.row === row && p.col === col);
      if (myPiece) {
        if (myPiece.rank === 0 || myPiece.rank === 11) {
          // Immovable — don't select
          setSelectedPieceId(null);
          return;
        }
        setSelectedPieceId(myPiece.id === selectedPieceId ? null : myPiece.id);
        return;
      }

      // Clicked empty or opponent without valid move — deselect
      setSelectedPieceId(null);
    },
    [isMyTurn, isMoving, selectedPieceId, validMoves, onMove, gameState.my_pieces],
  );

  const renderCell = (displayR: number, displayC: number) => {
    const row = flipBoard ? 9 - displayR : displayR;
    const col = flipBoard ? 9 - displayC : displayC;

    if (isLake(row, col)) {
      return (
        <div
          key={`${displayR}-${displayC}`}
          className="aspect-square bg-cyan-500/40 dark:bg-cyan-700/30 rounded-sm flex items-center justify-center"
        >
          <span className="text-[8px] text-cyan-700/50 dark:text-cyan-400/30">~</span>
        </div>
      );
    }

    const myPiece = gameState.my_pieces.find((p) => p.row === row && p.col === col);
    const oppPiece = gameState.opponent_pieces.find((p) => p.row === row && p.col === col);
    const isSelected = myPiece?.id === selectedPieceId && selectedPieceId !== null;
    const moveTarget = validMoves.find((m) => m.row === row && m.col === col);
    const isValidMove = !!moveTarget && !moveTarget.isAttack;
    const isAttackTarget = !!moveTarget && moveTarget.isAttack;
    const oppColor = myColor === 'red' ? 'blue' : 'red';

    // Last move highlight
    const lastMove = gameState.move_history.length > 0 ? gameState.move_history[gameState.move_history.length - 1] : null;
    const isLastMoveFrom = lastMove && lastMove.from_row === row && lastMove.from_col === col;
    const isLastMoveTo = lastMove && lastMove.to_row === row && lastMove.to_col === col;

    return (
      <div
        key={`${displayR}-${displayC}`}
        className={`aspect-square rounded-sm flex items-center justify-center cursor-pointer relative
          ${isLastMoveFrom || isLastMoveTo ? 'bg-yellow-100/50 dark:bg-yellow-900/20' : 'bg-amber-50/50 dark:bg-gray-800/40'}
          ${isSelected ? 'ring-2 ring-yellow-400 z-10' : ''}
        `}
        onClick={() => handleCellClick(row, col)}
      >
        {/* Valid move indicator */}
        {isValidMove && (
          <div className="absolute w-3 h-3 rounded-full bg-green-500/50" />
        )}

        {/* Attack target pulse */}
        {isAttackTarget && !oppPiece && (
          <div className="absolute w-3 h-3 rounded-full bg-red-500/50" />
        )}

        {/* My piece */}
        {myPiece && (
          <motion.div
            layoutId={myPiece.id}
            className={`w-full h-full rounded-sm flex flex-col items-center justify-center
              bg-gradient-to-br ${TEAM_COLORS[myColor].gradient} ${TEAM_COLORS[myColor].text}
              ${isSelected ? 'shadow-lg scale-105' : ''}
              ${myPiece.rank === 0 || myPiece.rank === 11 ? 'opacity-90' : ''}
            `}
          >
            <span className="text-[10px] sm:text-xs font-bold leading-none">
              {getPieceShortName(myPiece.rank)}
            </span>
          </motion.div>
        )}

        {/* Opponent piece */}
        {oppPiece && (
          <motion.div
            layoutId={oppPiece.id}
            className={`w-full h-full rounded-sm flex flex-col items-center justify-center
              bg-gradient-to-br ${TEAM_COLORS[oppColor].gradient} ${TEAM_COLORS[oppColor].text}
              ${isAttackTarget ? 'ring-2 ring-red-400 animate-pulse' : ''}
            `}
          >
            <span className="text-[10px] sm:text-xs font-bold leading-none">
              {oppPiece.revealed ? getPieceShortName(oppPiece.rank) : '?'}
            </span>
          </motion.div>
        )}
      </div>
    );
  };

  // Captured pieces display
  const myCaptured = myColor === 'red' ? gameState.red_captured : gameState.blue_captured;
  const oppCaptured = myColor === 'red' ? gameState.blue_captured : gameState.red_captured;
  const oppColor = myColor === 'red' ? 'blue' : 'red';

  return (
    <div className="flex flex-col items-center gap-2 w-full max-w-sm mx-auto">
      {/* Opponent captured (pieces they lost) */}
      <CapturedPieces pieces={oppCaptured} color={oppColor} label="Their losses" />

      {/* Board */}
      <div className="w-full">
        <div
          className="grid gap-[1px] bg-amber-800/30 dark:bg-gray-600 rounded-lg overflow-hidden p-[1px]"
          style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}
        >
          {Array.from({ length: BOARD_SIZE }, (_, displayR) =>
            Array.from({ length: BOARD_SIZE }, (_, displayC) => renderCell(displayR, displayC)),
          )}
        </div>
      </div>

      {/* My captured (pieces I lost) */}
      <CapturedPieces pieces={myCaptured} color={myColor} label="Your losses" />
    </div>
  );
}

function CapturedPieces({
  pieces,
  color,
  label,
}: {
  pieces: Piece[];
  color: TeamColor;
  label: string;
}) {
  if (pieces.length === 0) return null;

  // Group by rank and count
  const grouped = pieces.reduce<Record<number, number>>((acc, p) => {
    acc[p.rank] = (acc[p.rank] || 0) + 1;
    return acc;
  }, {});

  // Sort by rank descending
  const sorted = Object.entries(grouped)
    .map(([rank, count]) => ({ rank: Number(rank) as PieceRank, count }))
    .sort((a, b) => b.rank - a.rank);

  return (
    <div className="w-full">
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
      <div className="flex flex-wrap gap-1">
        {sorted.map(({ rank, count }) => (
          <div
            key={rank}
            className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded
              bg-gradient-to-br ${TEAM_COLORS[color].gradient} ${TEAM_COLORS[color].text} opacity-60
            `}
          >
            <span className="text-[10px] font-bold">{getPieceShortName(rank)}</span>
            {count > 1 && <span className="text-[9px] opacity-75">&times;{count}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
