'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Piece, TeamColor } from '@/lib/stratego/types';
import {
  BOARD_SIZE,
  isLake,
  getPieceShortName,
  TEAM_COLORS,
  SETUP_ROWS,
  generateRandomSetup,
  PIECE_DEFINITIONS,
} from '@/lib/stratego/constants';

interface SetupBoardProps {
  color: TeamColor;
  onSubmit: (pieces: Piece[]) => void;
  isSubmitting: boolean;
}

export default function SetupBoard({ color, onSubmit, isSubmitting }: SetupBoardProps) {
  const [pieces, setPieces] = useState<Piece[]>(() => {
    const setup = generateRandomSetup(color);
    return setup.map((p, i) => ({
      id: `${color}_${i}`,
      rank: p.rank,
      row: p.row,
      col: p.col,
      revealed: false,
    }));
  });
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [showReference, setShowReference] = useState(false);

  const { min: setupMin, max: setupMax } = SETUP_ROWS[color];

  // Whether the board should be flipped (blue sees their pieces at bottom)
  const flipBoard = color === 'blue';

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      const clickedIdx = pieces.findIndex((p) => p.row === row && p.col === col);

      if (selectedIdx === null) {
        // Select a piece
        if (clickedIdx !== -1) {
          setSelectedIdx(clickedIdx);
        }
      } else {
        if (clickedIdx === selectedIdx) {
          // Deselect
          setSelectedIdx(null);
        } else if (clickedIdx !== -1) {
          // Swap two pieces
          setPieces((prev) => {
            const next = [...prev];
            const tempRow = next[selectedIdx].row;
            const tempCol = next[selectedIdx].col;
            next[selectedIdx] = { ...next[selectedIdx], row: next[clickedIdx].row, col: next[clickedIdx].col };
            next[clickedIdx] = { ...next[clickedIdx], row: tempRow, col: tempCol };
            return next;
          });
          setSelectedIdx(null);
        } else {
          // Clicked empty cell in setup area — move selected piece there
          if (row >= setupMin && row <= setupMax) {
            setPieces((prev) => {
              const next = [...prev];
              next[selectedIdx] = { ...next[selectedIdx], row, col };
              return next;
            });
            setSelectedIdx(null);
          }
        }
      }
    },
    [pieces, selectedIdx, setupMin, setupMax],
  );

  const handleShuffle = () => {
    const setup = generateRandomSetup(color);
    setPieces((prev) =>
      prev.map((p, i) => ({
        ...p,
        rank: setup[i].rank,
        row: setup[i].row,
        col: setup[i].col,
      })),
    );
    setSelectedIdx(null);
  };

  const handleSubmit = () => {
    onSubmit(pieces);
  };

  const renderCell = (displayR: number, displayC: number) => {
    const row = flipBoard ? 9 - displayR : displayR;
    const col = flipBoard ? 9 - displayC : displayC;

    if (isLake(row, col)) {
      return (
        <div
          key={`${displayR}-${displayC}`}
          className="aspect-square bg-cyan-400/30 dark:bg-cyan-600/20 rounded-sm"
        />
      );
    }

    const isSetupArea = row >= setupMin && row <= setupMax;
    const pieceIdx = pieces.findIndex((p) => p.row === row && p.col === col);
    const piece = pieceIdx !== -1 ? pieces[pieceIdx] : null;
    const isSelected = pieceIdx !== -1 && pieceIdx === selectedIdx;

    return (
      <div
        key={`${displayR}-${displayC}`}
        className={`aspect-square rounded-sm flex items-center justify-center cursor-pointer
          ${isSetupArea ? 'bg-gray-100 dark:bg-gray-700/50' : 'bg-gray-200/50 dark:bg-gray-800/30'}
          ${isSelected ? 'ring-2 ring-yellow-400 ring-offset-1 dark:ring-offset-gray-900' : ''}
          ${!piece && isSetupArea && selectedIdx !== null ? 'bg-green-100 dark:bg-green-900/30' : ''}
        `}
        onClick={() => handleCellClick(row, col)}
      >
        {piece && (
          <motion.div
            layout
            className={`w-full h-full rounded-sm flex items-center justify-center
              bg-gradient-to-br ${TEAM_COLORS[color].gradient} ${TEAM_COLORS[color].text}
              ${isSelected ? 'scale-110 shadow-lg' : ''}
            `}
          >
            <span className="text-[10px] sm:text-xs font-bold leading-none">
              {getPieceShortName(piece.rank)}
            </span>
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-sm mx-auto">
      <div className="text-center">
        <h2 className="text-lg font-bold dark:text-white">Arrange Your Army</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Tap two pieces to swap them
        </p>
      </div>

      {/* Board */}
      <div className="w-full">
        <div
          className="grid gap-[1px] bg-gray-300 dark:bg-gray-600 rounded-lg overflow-hidden p-[1px]"
          style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}
        >
          {Array.from({ length: BOARD_SIZE }, (_, displayR) =>
            Array.from({ length: BOARD_SIZE }, (_, displayC) => renderCell(displayR, displayC)),
          )}
        </div>
      </div>

      {/* Piece reference toggle */}
      <button
        onClick={() => setShowReference(!showReference)}
        className="text-sm text-blue-500 dark:text-blue-400 underline"
      >
        {showReference ? 'Hide' : 'Show'} piece reference
      </button>

      {showReference && (
        <div className="w-full bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs space-y-1">
          {PIECE_DEFINITIONS.map((p) => (
            <div key={p.rank} className="flex items-center gap-2">
              <span className="w-6 h-6 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-700 font-mono font-bold">
                {p.shortName}
              </span>
              <span className="font-medium dark:text-gray-200">{p.name} &times;{p.count}</span>
              {p.description && (
                <span className="text-gray-400 ml-auto text-[11px]">{p.description}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 w-full">
        <button
          onClick={handleShuffle}
          className="flex-1 py-2.5 bg-gray-200 dark:bg-gray-700 rounded-xl font-semibold text-sm dark:text-white"
        >
          Shuffle
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex-1 py-2.5 bg-gradient-to-r from-red-500 to-blue-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50"
        >
          {isSubmitting ? 'Submitting...' : 'Ready!'}
        </button>
      </div>
    </div>
  );
}
