'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Player, MysteryGameState, MysteryVote } from '@/lib/supabase';
import TypewriterText from '../components/TypewriterText';
import ChoiceButton from '../components/ChoiceButton';
import AgreementCelebration from '../components/AgreementCelebration';
import PartnerStatus from '../components/PartnerStatus';
import { PuzzleRenderer, MiniGameContainer } from '../components/puzzles';
import AIStoryMode from '../components/AIStoryMode';

export default function MysterySessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [currentUser, setCurrentUser] = useState<Player | null>(null);
  const [gameState, setGameState] = useState<MysteryGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showChoices, setShowChoices] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [isVoting, setIsVoting] = useState(false);
  const [puzzleSolved, setPuzzleSolved] = useState(false);
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null);
  const [textComplete, setTextComplete] = useState(false);
  const [isAIEpisode, setIsAIEpisode] = useState<boolean | null>(null);
  const votingRef = useRef(false); // Use ref to prevent race conditions
  const currentPuzzleIdRef = useRef<string | null>(null); // Track current puzzle to prevent stale callbacks

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  // Check if scene has a blocking puzzle that needs solving
  const hasPuzzle = gameState?.puzzle != null;
  const isBlockingPuzzle = hasPuzzle && gameState?.puzzle?.is_blocking;

  // Reset puzzleSolved when puzzle changes
  useEffect(() => {
    const newPuzzleId = gameState?.puzzle?.id || null;
    if (currentPuzzleIdRef.current !== null && newPuzzleId !== currentPuzzleIdRef.current) {
      // Puzzle changed - reset solved state
      setPuzzleSolved(false);
    }
    currentPuzzleIdRef.current = newPuzzleId;
  }, [gameState?.puzzle?.id]);
  // Show choices once text is complete OR showChoices is true (keep visible)
  const choicesReady = showChoices || textComplete;
  const shouldShowChoices = choicesReady && (!isBlockingPuzzle || puzzleSolved);

  const fetchGameState = useCallback(async (forceReset = false) => {
    if (!isSupabaseConfigured || !sessionId) return;

    try {
      const { data, error: fetchError } = await supabase.rpc('get_mystery_game_state', {
        p_session_id: sessionId,
      });

      if (fetchError) throw fetchError;
      if (!data) {
        setError('Session not found');
        return;
      }

      // Only reset choices/text when scene actually changes
      const sceneChanged = currentSceneId !== null && currentSceneId !== data.scene.id;

      if (sceneChanged || forceReset) {
        setShowChoices(false);
        setTextComplete(false);
        setPuzzleSolved(false);
      }

      setCurrentSceneId(data.scene.id);
      setGameState(data);
    } catch (err) {
      console.error('Error fetching game state:', err);
      setError('Failed to load game');
    }
    setIsLoading(false);
  }, [sessionId, currentSceneId]);

  // Initialize user
  useEffect(() => {
    const savedUser = localStorage.getItem('mystery-user') as Player | null;
    if (savedUser) {
      setCurrentUser(savedUser);
    } else {
      // Redirect to main page to select user
      router.push('/mystery');
    }
  }, [router]);

  // Fetch initial game state and join session
  useEffect(() => {
    if (currentUser && sessionId) {
      // Check if this is an AI episode first
      const checkEpisodeType = async () => {
        const { data } = await supabase.rpc('is_ai_episode', { p_session_id: sessionId });
        setIsAIEpisode(data === true);

        // Join the session
        await supabase.rpc('join_mystery_session', {
          p_session_id: sessionId,
          p_player: currentUser,
        });

        // If not AI episode, fetch regular game state
        if (data !== true) {
          fetchGameState(true); // Force reset on initial load
        }
      };
      checkEpisodeType();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, sessionId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!sessionId || !currentUser) return;

    // Subscribe to session changes
    const sessionChannel = supabase
      .channel(`mystery-session-game-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'mystery_sessions',
          filter: `id=eq.${sessionId}`,
        },
        async (payload) => {
          // Scene changed - show celebration and refetch
          const newSceneId = (payload.new as { current_scene_id: string }).current_scene_id;
          if (currentSceneId && newSceneId !== currentSceneId) {
            setShowCelebration(true);
            setShowChoices(false);
            setTextComplete(false);
            setPuzzleSolved(false);
          }
          // Fetch latest state
          const { data } = await supabase.rpc('get_mystery_game_state', { p_session_id: sessionId });
          if (data) {
            setCurrentSceneId(data.scene.id);
            setGameState(data);
          }
        }
      )
      .subscribe();

    // Subscribe to vote changes
    const votesChannel = supabase
      .channel(`mystery-votes-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mystery_votes',
          filter: `session_id=eq.${sessionId}`,
        },
        async () => {
          // Just update votes, don't reset anything
          const { data } = await supabase.rpc('get_mystery_game_state', { p_session_id: sessionId });
          if (data) setGameState(data);
        }
      )
      .subscribe();

    // Subscribe to puzzle answer changes (just refresh state, don't set puzzleSolved here)
    const puzzleChannel = supabase
      .channel(`mystery-puzzles-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mystery_puzzle_answers',
          filter: `session_id=eq.${sessionId}`,
        },
        async () => {
          // Just refresh game state - puzzleSolved is handled by PuzzleRenderer's onSolved callback
          const { data } = await supabase.rpc('get_mystery_game_state', { p_session_id: sessionId });
          if (data) setGameState(data);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(votesChannel);
      supabase.removeChannel(puzzleChannel);
    };
  }, [sessionId, currentUser, currentSceneId]);

  // Heartbeat to update presence
  useEffect(() => {
    if (!sessionId || !currentUser) return;

    const heartbeat = setInterval(async () => {
      await supabase.rpc('update_mystery_presence', {
        p_session_id: sessionId,
        p_player: currentUser,
      });
    }, 10000);

    return () => clearInterval(heartbeat);
  }, [sessionId, currentUser]);

  const handleVote = async (choiceId: string) => {
    // Use ref as primary guard (not affected by re-renders)
    if (votingRef.current) return;

    // Check if this player already voted for this choice
    const alreadyVoted = gameState?.votes?.some(v => v.player === currentUser && v.choice_id === choiceId);
    if (!currentUser || alreadyVoted) return;

    // Set both ref and state
    votingRef.current = true;
    setIsVoting(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('cast_mystery_vote', {
        p_session_id: sessionId,
        p_player: currentUser,
        p_choice_id: choiceId,
      });

      if (rpcError) throw rpcError;

      if (data?.agreed) {
        setShowCelebration(true);
        // Notify about agreement
        await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'mystery_agreed',
            title: 'made a decision together',
            user: currentUser,
          }),
        });
      }
    } catch (err) {
      console.error('Error voting:', err);
    }
    votingRef.current = false;
    setIsVoting(false);
  };

  const handleCelebrationComplete = () => {
    setShowCelebration(false);
    fetchGameState();
  };

  const handleTypewriterComplete = () => {
    setTextComplete(true);
    setShowChoices(true);
  };

  // Loading state (still determining episode type)
  if (isLoading || !currentUser || isAIEpisode === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-4 border-purple-200 border-t-purple-500 rounded-full"
        />
      </div>
    );
  }

  // AI Episode - use dedicated AI story mode
  if (isAIEpisode) {
    return (
      <AIStoryMode
        sessionId={sessionId}
        currentPlayer={currentUser}
        onBack={() => router.push('/mystery')}
      />
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-4xl mb-4">😵</div>
          <h1 className="text-xl font-bold text-white mb-2">{error}</h1>
          <button
            onClick={() => router.push('/mystery')}
            className="text-purple-300 hover:text-white transition-colors"
          >
            ← Back to mysteries
          </button>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return null;
  }

  const { session, episode, scene, choices, votes } = gameState;

  // Ending screen
  if (scene.is_ending) {
    const endingEmojis = {
      good: '🎉',
      neutral: '🤔',
      bad: '😱',
    };
    const endingMessages = {
      good: 'Congratulations, detectives!',
      neutral: 'The case remains open...',
      bad: 'Things didn\'t go as planned...',
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-lg"
        >
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-6xl mb-6"
          >
            {endingEmojis[scene.ending_type || 'neutral']}
          </motion.div>

          <h1 className="text-3xl font-serif font-bold text-white mb-4">
            {scene.title || 'The End'}
          </h1>

          <div className="bg-white/10 backdrop-blur rounded-xl p-6 mb-6">
            <p className="text-purple-100 leading-relaxed whitespace-pre-wrap">
              {scene.narrative_text}
            </p>
          </div>

          <p className="text-amber-400 font-medium mb-6">
            {endingMessages[scene.ending_type || 'neutral']}
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => router.push('/mystery')}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors"
            >
              Choose Another Mystery
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Waiting for partner
  if (session.status === 'waiting') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            className="text-6xl mb-6"
          >
            🔍
          </motion.div>
          <h1 className="text-2xl font-serif font-bold text-white mb-2">
            Waiting for {partnerName}...
          </h1>
          <p className="text-purple-200 mb-4">
            Share this page link with them to start!
          </p>
          <button
            onClick={() => router.push('/mystery')}
            className="text-purple-300 hover:text-white transition-colors text-sm"
          >
            ← Cancel and go back
          </button>
        </motion.div>
      </div>
    );
  }

  // Main game UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 overflow-x-hidden">
      {/* Agreement celebration overlay */}
      <AgreementCelebration show={showCelebration} onComplete={handleCelebrationComplete} />

      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-600/10 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6 pb-32">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <div>
            <p className="text-amber-400 text-sm font-medium">
              Episode {episode.episode_number}
            </p>
            <h1 className="text-xl font-serif font-bold text-white">
              {episode.title}
            </h1>
          </div>
          <PartnerStatus
            currentPlayer={currentUser}
            danielOnline={session.daniel_joined}
            huaiyaoOnline={session.huaiyao_joined}
            danielLastSeen={session.daniel_last_seen}
            huaiyaoLastSeen={session.huaiyao_last_seen}
          />
        </motion.header>

        {/* Scene content */}
        <motion.div
          key={scene.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 backdrop-blur border border-white/10 rounded-xl p-6 mb-6"
        >
          {scene.title && (
            <h2 className="text-lg font-serif font-semibold text-amber-400 mb-4">
              {scene.title}
            </h2>
          )}
          {/* If text already completed, show full text instantly. Otherwise use typewriter */}
          {textComplete ? (
            <p className="text-purple-100 leading-relaxed text-lg whitespace-pre-wrap">
              {scene.narrative_text}
            </p>
          ) : (
            <TypewriterText
              text={scene.narrative_text}
              speed={25}
              onComplete={handleTypewriterComplete}
              className="text-purple-100 leading-relaxed text-lg"
            />
          )}
        </motion.div>

        {/* Puzzle Section */}
        <AnimatePresence mode="wait">
          {showChoices && gameState.puzzle && !puzzleSolved && (
            <motion.div
              key={`puzzle-${gameState.puzzle.id}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-6"
            >
              {gameState.puzzle.puzzle_type === 'minigame' ? (
                <MiniGameContainer
                  puzzle={gameState.puzzle}
                  sessionId={sessionId}
                  currentPlayer={currentUser}
                  onComplete={(success) => {
                    // Only set solved if this puzzle is still the current one
                    if (success && currentPuzzleIdRef.current === gameState.puzzle?.id) {
                      setPuzzleSolved(true);
                      setShowCelebration(true);
                    }
                  }}
                />
              ) : (
                <PuzzleRenderer
                  puzzle={gameState.puzzle}
                  sessionId={sessionId}
                  currentPlayer={currentUser}
                  onSolved={() => {
                    // Only set solved if this puzzle is still the current one
                    if (currentPuzzleIdRef.current === gameState.puzzle?.id) {
                      setPuzzleSolved(true);
                      setShowCelebration(true);
                    }
                  }}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Puzzle solved indicator */}
        {puzzleSolved && gameState.puzzle && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-green-900/30 border border-green-500/50 rounded-xl p-4 mb-6 text-center"
          >
            <span className="text-2xl mr-2">🎉</span>
            <span className="text-green-300 font-medium">Puzzle Solved! Continue your investigation...</span>
          </motion.div>
        )}

        {/* Choices - always visible once text complete */}
        {shouldShowChoices && scene.is_decision_point && choices.length > 0 && (
          <div className="space-y-3 pb-8">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-purple-300">
                  What do you want to do?
                </h3>
                {votes.length === 1 && (
                  <p className="text-sm text-amber-400">
                    Waiting for {votes[0].player === currentUser ? partnerName : 'you'}...
                  </p>
                )}
              </div>

              {choices.map((choice) => (
                <div key={choice.id}>
                  <ChoiceButton
                    choiceId={choice.id}
                    text={choice.choice_text}
                    votes={votes}
                    currentPlayer={currentUser}
                    onVote={handleVote}
                    disabled={isVoting}
                  />
                </div>
              ))}

              {/* Vote status hint */}
              {votes.length === 2 && votes[0].choice_id !== votes[1].choice_id && (
                <p className="text-center text-amber-400 text-sm mt-4">
                  You have different choices! Discuss and try to agree.
                </p>
              )}
            </div>
          )}

        {/* Continue button for non-decision scenes */}
        {shouldShowChoices && !scene.is_decision_point && choices.length > 0 && (
          <div className="pb-8">
            <button
              onClick={() => handleVote(choices[0].id)}
              disabled={isVoting}
              className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-purple-950 rounded-xl font-semibold transition-colors disabled:opacity-50"
            >
              Continue →
            </button>
            {votes.length === 1 && (
              <p className="text-center text-amber-400 text-sm mt-3">
                Waiting for {votes[0].player === currentUser ? partnerName : 'you'} to continue...
              </p>
            )}
          </div>
        )}

        {/* Debug Panel - only shows in Test Lab (episode 99) */}
        {episode.episode_number === 99 && (
          <div className="mt-8 p-4 bg-black/40 border border-yellow-500/50 rounded-xl text-xs font-mono">
            <div className="text-yellow-400 font-bold mb-2">🔧 DEBUG (Test Lab Only)</div>
            <div className="grid grid-cols-2 gap-2 text-gray-300">
              <div>sceneId: <span className="text-cyan-400">{scene.id?.slice(-8)}</span></div>
              <div>sceneOrder: <span className="text-cyan-400">{scene.scene_order}</span></div>
              <div>puzzleSolved: <span className={puzzleSolved ? 'text-red-400' : 'text-green-400'}>{String(puzzleSolved)}</span></div>
              <div>showChoices: <span className="text-cyan-400">{String(showChoices)}</span></div>
              <div>textComplete: <span className="text-cyan-400">{String(textComplete)}</span></div>
              <div>hasPuzzle: <span className="text-cyan-400">{String(hasPuzzle)}</span></div>
              <div>isBlocking: <span className="text-cyan-400">{String(isBlockingPuzzle)}</span></div>
              <div>shouldShowChoices: <span className="text-cyan-400">{String(shouldShowChoices)}</span></div>
              <div>puzzleId: <span className="text-cyan-400">{gameState.puzzle?.id?.slice(-8) || 'none'}</span></div>
              <div>puzzleType: <span className="text-cyan-400">{gameState.puzzle?.puzzle_type || 'none'}</span></div>
              <div>votes: <span className="text-cyan-400">{votes.length}</span></div>
              <div>choices: <span className="text-cyan-400">{choices.length}</span></div>
            </div>
          </div>
        )}

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 text-purple-400 text-sm"
        >
          <p>
            Playing as{' '}
            <span className={currentUser === 'daniel' ? 'text-blue-400' : 'text-rose-400'}>
              {currentUser === 'daniel' ? 'Daniel' : 'Huaiyao'}
            </span>
          </p>
        </motion.footer>
      </main>
    </div>
  );
}
