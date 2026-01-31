'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import type { Player, MysteryPuzzle, MinigameState } from '@/lib/supabase';

interface MiniGameContainerProps {
  puzzle: MysteryPuzzle;
  sessionId: string;
  currentPlayer: Player;
  onComplete?: (success: boolean) => void;
}

// Safe Cracker Mini-Game
function SafeCrackerGame({
  gameState,
  myState,
  currentPlayer,
  onUpdateState,
  onSubmitCode,
}: {
  gameState: Record<string, unknown>;
  myState: Record<string, unknown>;
  currentPlayer: Player;
  onUpdateState: (shared: Record<string, unknown>, private_: Record<string, unknown>) => void;
  onSubmitCode: (code: string) => void;
}) {
  const [digits, setDigits] = useState<number[]>([0, 0, 0, 0]);
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';

  // Get clues from game state
  const myClues = (myState.clues as string[]) || [];
  const partnerReady = Boolean(gameState.partner_ready);
  const attempts = (gameState.attempts as number) || 0;
  const maxAttempts = 5;

  const handleDigitChange = (index: number, delta: number) => {
    const newDigits = [...digits];
    newDigits[index] = (newDigits[index] + delta + 10) % 10;
    setDigits(newDigits);

    // Sync current digit to shared state
    onUpdateState(
      { [`${currentPlayer}_digit_${index}`]: newDigits[index] },
      {}
    );
  };

  const handleSubmit = () => {
    const code = digits.join('');
    onSubmitCode(code);
  };

  return (
    <div className="space-y-6">
      {/* Clues section */}
      <div className="bg-slate-800/50 rounded-xl p-4">
        <h4 className="text-amber-400 font-medium mb-3">Your Clues:</h4>
        {myClues.length > 0 ? (
          <ul className="space-y-2">
            {myClues.map((clue, i) => (
              <li key={i} className="text-purple-200 text-sm flex items-start gap-2">
                <span className="text-amber-400">•</span>
                {clue}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-purple-300/60 text-sm italic">
            Waiting for game to initialize...
          </p>
        )}
        <p className="text-purple-300/60 text-xs mt-3">
          {partnerName} has different clues - communicate to solve!
        </p>
      </div>

      {/* Safe dial */}
      <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl p-6 border-4 border-slate-600">
        <div className="flex justify-center gap-4">
          {digits.map((digit, index) => (
            <div key={index} className="flex flex-col items-center">
              <button
                onClick={() => handleDigitChange(index, 1)}
                className="w-12 h-8 bg-slate-600 hover:bg-slate-500 rounded-t-lg text-white font-bold transition-colors"
              >
                ▲
              </button>
              <div className="w-12 h-16 bg-black flex items-center justify-center border-2 border-slate-500">
                <span className="text-green-400 font-mono text-3xl">{digit}</span>
              </div>
              <button
                onClick={() => handleDigitChange(index, -1)}
                className="w-12 h-8 bg-slate-600 hover:bg-slate-500 rounded-b-lg text-white font-bold transition-colors"
              >
                ▼
              </button>
            </div>
          ))}
        </div>

        {/* Attempts counter */}
        <p className="text-center text-slate-400 text-sm mt-4">
          Attempts: {attempts}/{maxAttempts}
        </p>
      </div>

      {/* Partner status */}
      <div className="flex items-center justify-center gap-2 text-sm">
        <span className={`w-2 h-2 rounded-full ${partnerReady ? 'bg-green-500' : 'bg-gray-500'}`} />
        <span className={partnerReady ? 'text-green-300' : 'text-gray-400'}>
          {partnerName} is {partnerReady ? 'ready' : 'setting their code'}
        </span>
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={attempts >= maxAttempts}
        className="w-full py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded-xl font-semibold transition-colors disabled:cursor-not-allowed"
      >
        {attempts >= maxAttempts ? 'No Attempts Left' : 'Try Code'}
      </button>
    </div>
  );
}

// Logic Grid Mini-Game
function LogicGridGame({
  gameState,
  currentPlayer,
  onUpdateState,
}: {
  gameState: Record<string, unknown>;
  myState: Record<string, unknown>;
  currentPlayer: Player;
  onUpdateState: (shared: Record<string, unknown>, private_: Record<string, unknown>) => void;
}) {
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';
  const gridSize = (gameState.grid_size as number) || 4;
  const categories = (gameState.categories as string[][]) || [['A', 'B', 'C', 'D'], ['1', '2', '3', '4']];

  // Grid state: 'empty' | 'yes' | 'no' | 'partner_yes' | 'partner_no'
  const grid = (gameState.grid as Record<string, string>) || {};

  const handleCellClick = (row: number, col: number) => {
    const key = `${row}-${col}`;
    const currentValue = grid[key] || 'empty';
    const myPrefix = currentPlayer === 'daniel' ? 'd' : 'h';

    // Cycle through: empty -> yes -> no -> empty
    let newValue: string;
    if (currentValue === 'empty' || currentValue.startsWith(currentPlayer === 'daniel' ? 'h' : 'd')) {
      newValue = `${myPrefix}_yes`;
    } else if (currentValue === `${myPrefix}_yes`) {
      newValue = `${myPrefix}_no`;
    } else {
      newValue = 'empty';
    }

    onUpdateState(
      { grid: { ...grid, [key]: newValue } },
      {}
    );
  };

  const getCellDisplay = (row: number, col: number) => {
    const key = `${row}-${col}`;
    const value = grid[key] || 'empty';

    if (value === 'empty') return '';
    if (value.endsWith('_yes')) {
      const isPartner = value.startsWith(currentPlayer === 'daniel' ? 'h' : 'd');
      return <span className={isPartner ? 'text-rose-400' : 'text-blue-400'}>✓</span>;
    }
    if (value.endsWith('_no')) {
      const isPartner = value.startsWith(currentPlayer === 'daniel' ? 'h' : 'd');
      return <span className={isPartner ? 'text-rose-400' : 'text-blue-400'}>✗</span>;
    }
    return '';
  };

  return (
    <div className="space-y-4">
      <p className="text-purple-300 text-sm text-center">
        Click cells to mark. <span className="text-blue-400">Blue = You</span>, <span className="text-rose-400">Pink = {partnerName}</span>
      </p>

      <div className="overflow-x-auto">
        <table className="mx-auto border-collapse">
          <thead>
            <tr>
              <th className="w-12 h-12"></th>
              {categories[1]?.map((cat, i) => (
                <th key={i} className="w-12 h-12 text-amber-400 text-sm font-medium">
                  {cat}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories[0]?.map((rowCat, row) => (
              <tr key={row}>
                <td className="text-amber-400 text-sm font-medium pr-2">{rowCat}</td>
                {categories[1]?.map((_, col) => (
                  <td key={col}>
                    <button
                      onClick={() => handleCellClick(row, col)}
                      className="w-12 h-12 border border-slate-600 hover:bg-slate-700/50 flex items-center justify-center text-xl transition-colors"
                    >
                      {getCellDisplay(row, col)}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MiniGameContainer({
  puzzle,
  sessionId,
  currentPlayer,
  onComplete,
}: MiniGameContainerProps) {
  const [gameState, setGameState] = useState<MinigameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchGameState = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_minigame_state', {
      p_session_id: sessionId,
      p_puzzle_id: puzzle.id,
      p_player: currentPlayer,
    });

    if (!error && data) {
      setGameState(data);
    }
    setIsLoading(false);
  }, [sessionId, puzzle.id, currentPlayer]);

  useEffect(() => {
    fetchGameState();

    // Subscribe to minigame state changes
    const channel = supabase
      .channel(`minigame-${sessionId}-${puzzle.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mystery_minigame_state',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          fetchGameState();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, puzzle.id, fetchGameState]);

  const handleUpdateState = async (shared: Record<string, unknown>, private_: Record<string, unknown>) => {
    await supabase.rpc('update_minigame_state', {
      p_session_id: sessionId,
      p_puzzle_id: puzzle.id,
      p_player: currentPlayer,
      p_shared_state: Object.keys(shared).length > 0 ? shared : null,
      p_private_state: Object.keys(private_).length > 0 ? private_ : null,
    });
  };

  const handleSubmitCode = async (code: string) => {
    // Submit as puzzle answer
    const { data } = await supabase.rpc('submit_puzzle_answer', {
      p_session_id: sessionId,
      p_puzzle_id: puzzle.id,
      p_player: currentPlayer,
      p_answer: code,
    });

    if (data?.status === 'solved' && onComplete) {
      onComplete(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1 }}
          className="w-8 h-8 border-4 border-purple-200 border-t-purple-500 rounded-full"
        />
      </div>
    );
  }

  const gameType = puzzle.puzzle_data.game_type;
  const sharedState = gameState?.game_state || {};
  const myState = gameState?.my_state || {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-purple-900/50 to-slate-900/50 border border-purple-500/30 rounded-xl p-6"
    >
      <div className="flex items-center gap-3 mb-6">
        <span className="text-3xl">🎮</span>
        <div>
          <h3 className="text-xl font-serif font-bold text-white">{puzzle.title}</h3>
          <p className="text-purple-300 text-sm">Collaborative Mini-Game</p>
        </div>
      </div>

      <p className="text-purple-100 mb-6">{puzzle.description}</p>

      {gameType === 'safe_cracker' && (
        <SafeCrackerGame
          gameState={sharedState}
          myState={myState}
          currentPlayer={currentPlayer}
          onUpdateState={handleUpdateState}
          onSubmitCode={handleSubmitCode}
        />
      )}

      {gameType === 'logic_grid' && (
        <LogicGridGame
          gameState={sharedState}
          myState={myState}
          currentPlayer={currentPlayer}
          onUpdateState={handleUpdateState}
        />
      )}

      {!gameType && (
        <p className="text-center text-purple-300/60">
          Unknown mini-game type. Please contact support.
        </p>
      )}
    </motion.div>
  );
}
