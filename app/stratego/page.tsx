'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeToggle } from '../components/ThemeToggle';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  GameState,
  Piece,
  CombatAnimationData,
  MoveResult,
} from '@/lib/stratego/types';
import { getPieceName } from '@/lib/stratego/constants';
import {
  applyStrategoMove,
  chooseComputerMove,
  ComputerDifficulty,
  createComputerGameState,
  LocalStrategoState,
  startComputerGame,
  toComputerGameView,
} from '@/lib/stratego/ai';
import Board from './components/Board';
import SetupBoard from './components/SetupBoard';
import CombatOverlay from './components/CombatOverlay';
import Rules from './components/Rules';

type MatchMode = 'online' | 'computer';

const DIFFICULTY_LABELS: Record<ComputerDifficulty, string> = {
  medium: 'Medium',
  hard: 'Hard',
  extreme: 'Extreme',
};

export default function StrategoPage() {
  const [mounted, setMounted] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [matchMode, setMatchMode] = useState<MatchMode>('online');
  const [computerDifficulty, setComputerDifficulty] = useState<ComputerDifficulty>('hard');
  const [localGameState, setLocalGameState] = useState<LocalStrategoState | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [awaitingComputerMove, setAwaitingComputerMove] = useState(false);
  const [combatAnimation, setCombatAnimation] = useState<CombatAnimationData | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [creatingGame, setCreatingGame] = useState(false);
  const [gameHistory, setGameHistory] = useState<{ wins: number; losses: number }>({ wins: 0, losses: 0 });
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useMarkAppViewed('Stratego');

  // Initialize
  useEffect(() => {
    setMounted(true);
    const user = localStorage.getItem('currentUser');
    setCurrentUser(user);
  }, []);

  // Load active game on mount
  useEffect(() => {
    if (!mounted || !currentUser) return;

    if (matchMode === 'computer') {
      setLoading(false);
      setGameId(null);
      setGameState(null);
      setLocalGameState((prev) => prev ?? createComputerGameState());
      return;
    }

    setLocalGameState(null);
    if (!isSupabaseConfigured) return;

    loadActiveGame();
    loadHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, currentUser, matchMode]);

  const fetchGameState = useCallback(
    async (id: string) => {
      if (!currentUser || matchMode !== 'online') return;

      const { data, error: err } = await supabase.rpc('get_stratego_state', {
        p_game_id: id,
        p_user: currentUser,
      });

      if (err) {
        setError('Failed to load game state');
        return;
      }

      const state = data as GameState;
      if ('error' in state) {
        setError((state as unknown as { error: string }).error);
        return;
      }

      setGameState(state);
    },
    [currentUser, matchMode],
  );

  const loadActiveGame = useCallback(async () => {
    if (!currentUser || matchMode !== 'online') return;
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase.rpc('get_active_stratego_game', {
      p_user: currentUser,
    });

    if (err) {
      setError('Failed to load game');
      setLoading(false);
      return;
    }

    const result = data as { game_id: string | null };
    if (result.game_id) {
      setGameId(result.game_id);
      await fetchGameState(result.game_id);
    } else {
      setGameId(null);
      setGameState(null);
    }
    setLoading(false);
  }, [currentUser, fetchGameState, matchMode]);

  // Real-time subscription
  useEffect(() => {
    if (matchMode !== 'online' || !gameId || !isSupabaseConfigured) return;

    // Clean up previous subscription
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
    }

    const channel = supabase
      .channel(`stratego-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'stratego_games',
          filter: `id=eq.${gameId}`,
        },
        () => {
          // Re-fetch state on any update
          fetchGameState(gameId);
        },
      )
      .subscribe();

    subscriptionRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, fetchGameState, matchMode]);

  const loadHistory = useCallback(async () => {
    if (!currentUser || !isSupabaseConfigured || matchMode !== 'online') return;

    const { data } = await supabase
      .from('stratego_games')
      .select('player_red, player_blue, winner')
      .eq('status', 'finished');

    if (!data) return;

    let wins = 0;
    let losses = 0;
    for (const game of data) {
      const myColor = game.player_red === currentUser ? 'red' : 'blue';
      if (game.winner === myColor) wins++;
      else if (game.winner) losses++;
    }
    setGameHistory({ wins, losses });
  }, [currentUser, matchMode]);

  useEffect(() => {
    if (matchMode !== 'computer' || !localGameState) return;
    setGameState(toComputerGameView(localGameState, currentUser));
  }, [currentUser, localGameState, matchMode]);

  useEffect(() => {
    if (matchMode !== 'computer' || !localGameState) return;
    if (localGameState.status !== 'playing' || localGameState.currentTurn !== 'blue') return;

    const snapshot = localGameState;
    const thinkingDelay = computerDifficulty === 'extreme'
      ? 550
      : computerDifficulty === 'hard'
        ? 450
        : 320;

    setAwaitingComputerMove(true);
    const timer = window.setTimeout(() => {
      try {
        const aiMove = chooseComputerMove(snapshot, computerDifficulty);
        if (!aiMove) {
          setLocalGameState((prev) => (prev ? {
            ...prev,
            status: 'finished',
            winner: 'red',
            winReason: 'no_moves',
            updatedAt: new Date().toISOString(),
          } : prev));
          return;
        }

        const result = applyStrategoMove(snapshot, 'blue', {
          pieceId: aiMove.pieceId,
          toRow: aiMove.toRow,
          toCol: aiMove.toCol,
        });

        if (result.combatResult && result.defenderRank !== null) {
          setCombatAnimation({
            attacker_rank: result.attackerRank,
            defender_rank: result.defenderRank,
            result: result.combatResult,
            attacker_color: 'blue',
          });
        }

        setLocalGameState(result.state);
      } catch {
        setError('Computer move failed. Please try a new game.');
      } finally {
        setAwaitingComputerMove(false);
      }
    }, thinkingDelay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [computerDifficulty, localGameState, matchMode]);

  const handleCreateGame = async () => {
    if (!currentUser || matchMode !== 'online') return;
    setCreatingGame(true);
    setError(null);

    const { data, error: err } = await supabase.rpc('create_stratego_game', {
      p_creator: currentUser,
    });

    if (err) {
      setError('Failed to create game');
      setCreatingGame(false);
      return;
    }

    const result = data as { id: string; player_red: string; player_blue: string };
    setGameId(result.id);
    await fetchGameState(result.id);
    setCreatingGame(false);

    // Notify partner
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stratego_new_game',
          title: 'New Stratego game!',
          user: currentUser,
        }),
      });
    } catch {
      // Notification failure is non-critical
    }
  };

  const handleCreateComputerGame = () => {
    setError(null);
    setCombatAnimation(null);
    setAwaitingComputerMove(false);
    setIsMoving(false);
    setGameId(null);
    setLocalGameState(createComputerGameState());
  };

  const handleSubmitSetup = async (pieces: Piece[]) => {
    if (matchMode === 'computer') {
      setIsSubmittingSetup(true);
      setError(null);
      const state = startComputerGame(pieces, computerDifficulty);
      setLocalGameState(state);
      setIsSubmittingSetup(false);
      return;
    }

    if (!currentUser || !gameId) return;
    setIsSubmittingSetup(true);

    const { data, error: err } = await supabase.rpc('submit_stratego_setup', {
      p_game_id: gameId,
      p_user: currentUser,
      p_pieces: pieces,
    });

    if (err) {
      setError('Failed to submit setup');
      setIsSubmittingSetup(false);
      return;
    }

    const result = data as { success?: boolean; error?: string };
    if (result.error) {
      setError(result.error);
      setIsSubmittingSetup(false);
      return;
    }

    await fetchGameState(gameId);
    setIsSubmittingSetup(false);
  };

  const handleMove = async (pieceId: string, toRow: number, toCol: number) => {
    if (matchMode === 'computer') {
      if (!localGameState || localGameState.status !== 'playing' || localGameState.currentTurn !== 'red') return;

      setIsMoving(true);
      setError(null);
      try {
        const result = applyStrategoMove(localGameState, 'red', {
          pieceId,
          toRow,
          toCol,
        });

        if (result.combatResult && result.defenderRank !== null) {
          setCombatAnimation({
            attacker_rank: result.attackerRank,
            defender_rank: result.defenderRank,
            result: result.combatResult,
            attacker_color: 'red',
          });
        }

        setLocalGameState(result.state);
      } catch {
        setError('Invalid move');
      } finally {
        setIsMoving(false);
      }
      return;
    }

    if (!currentUser || !gameId) return;
    setIsMoving(true);

    const { data, error: err } = await supabase.rpc('make_stratego_move', {
      p_game_id: gameId,
      p_user: currentUser,
      p_piece_id: pieceId,
      p_to_row: toRow,
      p_to_col: toCol,
    });

    if (err) {
      setError('Failed to make move');
      setIsMoving(false);
      return;
    }

    const result = data as MoveResult;
    if (result.error) {
      setError(result.error);
      setIsMoving(false);
      return;
    }

    // Show combat animation if there was combat
    if (result.combat_result && result.attacker_rank !== null && result.defender_rank !== null) {
      setCombatAnimation({
        attacker_rank: result.attacker_rank,
        defender_rank: result.defender_rank,
        result: result.combat_result,
        attacker_color: gameState!.my_color,
      });
    }

    await fetchGameState(gameId);
    setIsMoving(false);

    // Notify partner about the move
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stratego_move',
          title: result.combat_result
            ? `${getPieceName(result.attacker_rank!)} attacked ${getPieceName(result.defender_rank!)}`
            : 'Your turn',
          user: currentUser,
        }),
      });
    } catch {
      // non-critical
    }
  };

  const handleResign = async () => {
    if (matchMode === 'computer') {
      if (!localGameState || localGameState.status === 'finished') return;
      if (!confirm('Are you sure you want to resign?')) return;

      setLocalGameState({
        ...localGameState,
        status: 'finished',
        winner: 'blue',
        winReason: 'resignation',
        updatedAt: new Date().toISOString(),
      });
      setAwaitingComputerMove(false);
      return;
    }

    if (!currentUser || !gameId) return;
    if (!confirm('Are you sure you want to resign?')) return;

    const { data, error: err } = await supabase.rpc('resign_stratego_game', {
      p_game_id: gameId,
      p_user: currentUser,
    });

    if (err || (data as { error?: string }).error) {
      setError('Failed to resign');
      return;
    }

    await fetchGameState(gameId);
  };

  const handleNewGame = () => {
    if (matchMode === 'computer') {
      setError(null);
      setCombatAnimation(null);
      setAwaitingComputerMove(false);
      setIsMoving(false);
      setLocalGameState(createComputerGameState());
      return;
    }

    setGameId(null);
    setGameState(null);
    loadHistory();
  };

  // ---- Render ----

  if (!mounted) return null;

  const partnerName = matchMode === 'computer'
    ? `Computer (${DIFFICULTY_LABELS[computerDifficulty]})`
    : currentUser === 'daniel'
      ? 'Huaiyao'
      : 'Daniel';

  const isComputerTurn = matchMode === 'computer' && !!gameState && gameState.current_turn === 'blue';
  const canSwitchMode = !gameState || gameState.status !== 'playing';
  const canChangeDifficulty = matchMode === 'computer' && (!gameState || gameState.status !== 'playing');

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      <ThemeToggle />

      {/* Header */}
      <div className="pt-4 pb-2 px-4 flex items-center justify-between max-w-lg mx-auto">
        <Link href="/" className="text-gray-400 dark:text-gray-500 hover:text-gray-600">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-xl font-bold bg-gradient-to-r from-red-500 to-blue-600 bg-clip-text text-transparent">
          Stratego
        </h1>
        <button
          onClick={() => setShowRules(true)}
          className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-sm font-medium"
        >
          Rules
        </button>
      </div>

      <div className="px-4 pb-8 max-w-lg mx-auto">
        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              className="mb-3 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-xl text-sm"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {error}
              <button onClick={() => setError(null)} className="ml-2 font-bold">&times;</button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-center gap-2 p-1 rounded-xl bg-gray-100 dark:bg-gray-800/70">
            <button
              onClick={() => {
                if (!canSwitchMode) return;
                setMatchMode('online');
                setAwaitingComputerMove(false);
                setLocalGameState(null);
              }}
              disabled={!canSwitchMode}
              className={`px-3 py-1.5 text-sm rounded-lg font-semibold transition ${
                matchMode === 'online'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              } ${!canSwitchMode ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Vs Partner
            </button>
            <button
              onClick={() => {
                if (!canSwitchMode) return;
                setMatchMode('computer');
                setError(null);
                setCombatAnimation(null);
                setAwaitingComputerMove(false);
                if (!localGameState || localGameState.status !== 'playing') {
                  setLocalGameState(createComputerGameState());
                  setGameState(null);
                  setGameId(null);
                }
              }}
              disabled={!canSwitchMode}
              className={`px-3 py-1.5 text-sm rounded-lg font-semibold transition ${
                matchMode === 'computer'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              } ${!canSwitchMode ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Vs Computer
            </button>
          </div>

          {matchMode === 'computer' && (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {(['medium', 'hard', 'extreme'] as ComputerDifficulty[]).map((difficulty) => (
                <button
                  key={difficulty}
                  onClick={() => setComputerDifficulty(difficulty)}
                  disabled={!canChangeDifficulty}
                  className={`px-3 py-1 text-xs rounded-full border font-semibold transition ${
                    computerDifficulty === difficulty
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                  } ${!canChangeDifficulty ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {DIFFICULTY_LABELS[difficulty]}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-4 border-gray-300 dark:border-gray-600 border-t-red-500 rounded-full animate-spin" />
          </div>
        ) : !gameState ? (
          /* ---- No Active Game ---- */
          <div className="text-center py-12 space-y-6">
            <div className="text-6xl">&#9876;&#65039;</div>
            <div>
              <h2 className="text-2xl font-bold dark:text-white mb-2">Stratego</h2>
              <p className="text-gray-500 dark:text-gray-400">
                {matchMode === 'computer'
                  ? `Challenge the ${DIFFICULTY_LABELS[computerDifficulty]} AI. Capture the computer's flag!`
                  : `Hidden army strategy game. Capture ${partnerName}'s flag!`}
              </p>
            </div>

            {matchMode === 'computer' ? (
              <button
                onClick={handleCreateComputerGame}
                className="px-8 py-3 bg-gradient-to-r from-red-500 to-blue-600 text-white rounded-2xl font-bold text-lg shadow-lg"
              >
                New AI Game ({DIFFICULTY_LABELS[computerDifficulty]})
              </button>
            ) : (
              <button
                onClick={handleCreateGame}
                disabled={creatingGame}
                className="px-8 py-3 bg-gradient-to-r from-red-500 to-blue-600 text-white rounded-2xl font-bold text-lg shadow-lg disabled:opacity-50"
              >
                {creatingGame ? 'Creating...' : 'New Game'}
              </button>
            )}

            {(gameHistory.wins > 0 || gameHistory.losses > 0) && (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Record: {gameHistory.wins}W - {gameHistory.losses}L
              </div>
            )}

            {matchMode === 'computer' && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                AI levels: Medium = smart tactical play, Hard = deeper look-ahead, Extreme = strongest strategic search.
              </div>
            )}
          </div>
        ) : gameState.status === 'setup' ? (
          /* ---- Setup Phase ---- */
          <div>
            {/* Has this player already submitted? */}
            {(gameState.my_color === 'red' && gameState.red_setup_done) ||
            (gameState.my_color === 'blue' && gameState.blue_setup_done) ? (
              <div className="text-center py-16 space-y-4">
                <motion.div
                  className="inline-block w-12 h-12 border-4 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                />
                <p className="text-lg font-medium dark:text-white">
                  Waiting for {partnerName} to arrange their pieces...
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  You&apos;re playing <span className={`font-bold ${gameState.my_color === 'red' ? 'text-red-500' : 'text-blue-500'}`}>
                    {gameState.my_color}
                  </span>
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-center text-sm text-gray-500 dark:text-gray-400">
                  You&apos;re playing <span className={`font-bold ${gameState.my_color === 'red' ? 'text-red-500' : 'text-blue-500'}`}>
                    {gameState.my_color}
                  </span>
                  {gameState.my_color === 'red' ? ' (moves first)' : ''}
                </div>
                <SetupBoard
                  color={gameState.my_color}
                  onSubmit={handleSubmitSetup}
                  isSubmitting={isSubmittingSetup}
                />
              </div>
            )}
          </div>
        ) : gameState.status === 'playing' ? (
          /* ---- Playing ---- */
          <div className="space-y-3">
            {/* Turn indicator */}
            <div className="text-center">
              <div
                className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold ${
                  gameState.current_turn === gameState.my_color
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}
              >
                {gameState.current_turn === gameState.my_color
                  ? 'Your turn'
                  : `${partnerName}'s turn`}
                <span className="ml-2 opacity-60">Turn {gameState.turn_number}</span>
              </div>
            </div>

            {isComputerTurn && (
              <div className="text-center text-xs text-gray-500 dark:text-gray-400">
                {awaitingComputerMove
                  ? `${partnerName} is thinking...`
                  : `${partnerName} is choosing a move`}
              </div>
            )}

            <Board
              gameState={gameState}
              isMyTurn={gameState.current_turn === gameState.my_color}
              onMove={handleMove}
              isMoving={isMoving}
            />

            {/* Resign button */}
            <div className="text-center pt-2">
              <button
                onClick={handleResign}
                className="text-sm text-gray-400 dark:text-gray-500 hover:text-red-500"
              >
                Resign
              </button>
            </div>
          </div>
        ) : gameState.status === 'finished' ? (
          /* ---- Game Over ---- */
          <div className="space-y-4">
            {/* Winner announcement */}
            <motion.div
              className="text-center py-6"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              <div className="text-4xl mb-2">
                {gameState.winner === gameState.my_color ? '🎉' : '😔'}
              </div>
              <h2 className="text-2xl font-bold dark:text-white">
                {gameState.winner === gameState.my_color ? 'You Won!' : `${partnerName} Won!`}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {gameState.win_reason === 'flag_captured' && 'Flag captured'}
                {gameState.win_reason === 'no_moves' && 'No movable pieces left'}
                {gameState.win_reason === 'resignation' && 'Resignation'}
                {' · '}Turn {gameState.turn_number}
              </p>
            </motion.div>

            {/* Show final board with all pieces revealed */}
            <Board
              gameState={gameState}
              isMyTurn={false}
              onMove={() => {}}
              isMoving={false}
            />

            <div className="text-center">
              <button
                onClick={handleNewGame}
                className="px-8 py-3 bg-gradient-to-r from-red-500 to-blue-600 text-white rounded-2xl font-bold shadow-lg"
              >
                {matchMode === 'computer'
                  ? `Play Again vs ${DIFFICULTY_LABELS[computerDifficulty]}`
                  : 'Play Again'}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Combat overlay */}
      <CombatOverlay
        data={combatAnimation}
        onDismiss={() => setCombatAnimation(null)}
      />

      {/* Rules modal */}
      <Rules open={showRules} onClose={() => setShowRules(false)} />
    </div>
  );
}
