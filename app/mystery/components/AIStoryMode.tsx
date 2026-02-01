'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { Player } from '@/lib/supabase';
import TypewriterText from './TypewriterText';
import PartnerStatus from './PartnerStatus';

interface AIScene {
  id: string;
  scene_order: number;
  title: string | null;
  narrative_text: string;
  is_decision_point: boolean;
  is_ending: boolean;
  ending_type: 'good' | 'neutral' | 'bad' | null;
}

interface AIChoice {
  id: string;
  choice_order: number;
  choice_text: string;
  is_custom_input: boolean;
}

interface AIPuzzle {
  id: string;
  puzzle_type: string;
  difficulty: number;
  title: string;
  description: string;
  puzzle_data: Record<string, unknown>;
  hints: string[];
  max_hints: number;
}

interface AIGameState {
  session: {
    id: string;
    status: string;
    daniel_joined: boolean;
    huaiyao_joined: boolean;
    daniel_last_seen: string | null;
    huaiyao_last_seen: string | null;
    current_ai_scene_order: number;
  };
  episode: {
    id: string;
    title: string;
    episode_number: number;
    is_ai_driven: boolean;
  };
  scene: AIScene | null;
  choices: AIChoice[];
  puzzle: AIPuzzle | null;
  responses: Array<{ player: string; response_text: string }>;
  needs_generation: boolean;
}

interface AIStoryModeProps {
  sessionId: string;
  currentPlayer: Player;
  onBack: () => void;
}

export default function AIStoryMode({ sessionId, currentPlayer, onBack }: AIStoryModeProps) {
  const [gameState, setGameState] = useState<AIGameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [textComplete, setTextComplete] = useState(false);
  const [puzzleAnswer, setPuzzleAnswer] = useState('');
  const [puzzleSolved, setPuzzleSolved] = useState(false);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';
  const myResponse = gameState?.responses?.find(r => r.player === currentPlayer);
  const partnerResponse = gameState?.responses?.find(r => r.player !== currentPlayer);
  const bothResponded = !!(myResponse && partnerResponse);
  const generationTriggeredRef = useRef(false);
  const currentSceneOrderRef = useRef<number>(0);

  // Fetch AI game state
  const fetchGameState = useCallback(async () => {
    console.log('[AI DEBUG] fetchGameState called');
    try {
      const { data, error } = await supabase.rpc('get_ai_game_state', {
        p_session_id: sessionId,
      });

      console.log('[AI DEBUG] get_ai_game_state result:', { data, error });

      if (error) {
        console.error('[AI DEBUG] RPC error:', error);
        throw error;
      }
      setGameState(data);

      console.log('[AI DEBUG] Checking generation conditions:', {
        needs_generation: data?.needs_generation,
        session_status: data?.session?.status,
        current_scene_order: data?.session?.current_ai_scene_order,
        isGenerating,
        currentPlayer,
      });

      // If we need to generate and both players are in, only DANIEL generates
      // Huaiyao polls and waits for the scene to appear
      if (data?.needs_generation && data?.session?.status === 'active') {
        if (currentPlayer === 'daniel') {
          console.log('[AI DEBUG] Daniel triggering scene generation...');
          generateNextScene(data.session.current_ai_scene_order || 1);
        } else {
          console.log('[AI DEBUG] Huaiyao waiting for Daniel to generate...');
          // Poll again in 2 seconds to check if scene is ready
          setTimeout(() => fetchGameState(), 2000);
        }
      }
    } catch (err) {
      console.error('[AI DEBUG] Error fetching AI game state:', err);
    }
    setIsLoading(false);
  }, [sessionId]);

  // Generate next scene
  const generateNextScene = async (sceneOrder: number, responses?: { daniel?: string; huaiyao?: string }) => {
    console.log('[AI DEBUG] generateNextScene called:', { sceneOrder, responses, isGenerating });

    // Note: isGenerating state is set by caller to stop polling immediately
    // We don't check it here since the ref guards against duplicate calls
    setIsGenerating(true);
    console.log('[AI DEBUG] Starting API call to /api/mystery-ai');
    try {
      const requestBody = {
        sessionId,
        sceneOrder,
        episodeNumber: gameState?.episode?.episode_number,
        previousResponses: responses,
      };
      console.log('[AI DEBUG] Request body:', requestBody);

      const response = await fetch('/api/mystery-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('[AI DEBUG] API response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[AI DEBUG] API error:', errorData);
        throw new Error(errorData.error || 'Failed to generate story');
      }

      const result = await response.json();
      console.log('[AI DEBUG] API success:', result);

      // Refresh game state after generation
      console.log('[AI DEBUG] Refreshing game state...');
      await fetchGameState();
      setTextComplete(false);
      setSelectedChoice(null);
      setCustomInput('');
      setPuzzleSolved(false);
      setHintsRevealed(0);
    } catch (err) {
      console.error('[AI DEBUG] Error generating scene:', err);
      setGenerateError(err instanceof Error ? err.message : 'Failed to generate story');
    }
    setIsGenerating(false);
    console.log('[AI DEBUG] generateNextScene complete');
  };

  // Submit player response
  const submitResponse = async (responseText: string) => {
    if (isSubmitting || !responseText.trim()) return;

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_ai_response', {
        p_session_id: sessionId,
        p_player: currentPlayer,
        p_response_text: responseText.trim(),
      });

      if (error) throw error;

      console.log('[AI DEBUG] submit_ai_response result:', data);

      // Refresh state to show responses
      await fetchGameState();

      // If both responded, only DANIEL triggers generation (to avoid duplicates)
      if (data?.both_responded && currentPlayer === 'daniel') {
        console.log('[AI DEBUG] Both responded immediately, Daniel generating next scene...');
        generationTriggeredRef.current = true; // Mark as triggered to avoid useEffect double-trigger
        setIsGenerating(true); // Set immediately to stop polling
        const nextOrder = (gameState?.session?.current_ai_scene_order || 1) + 1;
        // Note: store_ai_scene will set current_ai_scene_order, so we don't advance here
        await generateNextScene(nextOrder, {
          daniel: data.daniel_response,
          huaiyao: data.huaiyao_response,
        });
      } else if (data?.both_responded && currentPlayer === 'huaiyao') {
        console.log('[AI DEBUG] Both responded, Huaiyao waiting for Daniel to generate...');
        // Huaiyao will see the new scene via polling/subscription
      }
    } catch (err) {
      console.error('Error submitting response:', err);
    }
    setIsSubmitting(false);
  };

  // Check puzzle answer
  const checkPuzzleAnswer = async () => {
    if (!gameState?.puzzle || !puzzleAnswer.trim()) return;

    try {
      const { data, error } = await supabase.rpc('check_ai_puzzle_answer', {
        p_session_id: sessionId,
        p_puzzle_id: gameState.puzzle.id,
        p_answer: puzzleAnswer.trim(),
      });

      if (error) throw error;

      if (data) {
        setPuzzleSolved(true);
        setPuzzleError(null);
      } else {
        setPuzzleError('Incorrect answer. Try again!');
      }
    } catch (err) {
      console.error('Error checking puzzle:', err);
    }
  };

  // Initial load
  useEffect(() => {
    fetchGameState();
  }, [fetchGameState]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel(`ai-mystery-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mystery_ai_scenes',
          filter: `session_id=eq.${sessionId}`,
        },
        () => fetchGameState()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mystery_ai_responses',
          filter: `session_id=eq.${sessionId}`,
        },
        () => fetchGameState()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'mystery_sessions',
          filter: `id=eq.${sessionId}`,
        },
        () => fetchGameState()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, fetchGameState]);

  // Heartbeat
  useEffect(() => {
    const heartbeat = setInterval(async () => {
      await supabase.rpc('update_mystery_presence', {
        p_session_id: sessionId,
        p_player: currentPlayer,
      });
    }, 10000);

    return () => clearInterval(heartbeat);
  }, [sessionId, currentPlayer]);

  // Poll for partner response when waiting (fallback for real-time)
  useEffect(() => {
    // Only poll if: I've submitted, partner hasn't, and not generating
    const shouldPoll = myResponse && !partnerResponse && !isGenerating && !bothResponded;

    if (!shouldPoll) return;

    console.log('[AI DEBUG] Starting poll for partner response...');
    const pollInterval = setInterval(() => {
      console.log('[AI DEBUG] Polling for partner response...');
      fetchGameState();
    }, 3000);

    return () => {
      console.log('[AI DEBUG] Stopping poll for partner response');
      clearInterval(pollInterval);
    };
  }, [myResponse, partnerResponse, isGenerating, bothResponded, fetchGameState]);

  // Poll for next scene when both responded (Huaiyao waiting for Daniel to generate)
  useEffect(() => {
    // Only poll if: both responded, I'm Huaiyao, and Daniel should be generating
    const shouldPoll = bothResponded && currentPlayer === 'huaiyao' && !isGenerating;

    if (!shouldPoll) return;

    console.log('[AI DEBUG] Huaiyao polling for new scene...');
    const pollInterval = setInterval(() => {
      console.log('[AI DEBUG] Huaiyao checking for new scene...');
      fetchGameState();
    }, 2000);

    return () => {
      console.log('[AI DEBUG] Huaiyao stopping poll');
      clearInterval(pollInterval);
    };
  }, [bothResponded, currentPlayer, isGenerating, fetchGameState]);

  // Reset UI state when scene changes (for BOTH players)
  useEffect(() => {
    const currentOrder = gameState?.session?.current_ai_scene_order || 0;
    if (currentOrder !== currentSceneOrderRef.current && currentSceneOrderRef.current !== 0) {
      console.log('[AI DEBUG] Scene order changed, resetting UI state', {
        old: currentSceneOrderRef.current,
        new: currentOrder,
      });
      // Reset generation trigger
      generationTriggeredRef.current = false;
      // Reset UI state for new scene (important for non-generating player)
      setTextComplete(false);
      setSelectedChoice(null);
      setCustomInput('');
      setPuzzleSolved(false);
      setPuzzleAnswer('');
      setHintsRevealed(0);
    }
    currentSceneOrderRef.current = currentOrder;
  }, [gameState?.session?.current_ai_scene_order]);

  // Trigger generation when both responded (Daniel only)
  // This handles the case where Daniel submitted first and Huaiyao submits second
  useEffect(() => {
    console.log('[AI DEBUG] Generation trigger check:', {
      bothResponded,
      currentPlayer,
      isGenerating,
      alreadyTriggered: generationTriggeredRef.current,
      myResponse: myResponse?.response_text,
      partnerResponse: partnerResponse?.response_text,
    });

    if (bothResponded && currentPlayer === 'daniel' && !isGenerating && !generationTriggeredRef.current) {
      console.log('[AI DEBUG] Both responded detected via state update, Daniel triggering generation...');
      generationTriggeredRef.current = true;
      // Set isGenerating IMMEDIATELY to prevent race conditions with polling
      setIsGenerating(true);

      const nextOrder = (gameState?.session?.current_ai_scene_order || 1) + 1;
      const danielResponse = myResponse?.response_text;
      const huaiyaoResponse = partnerResponse?.response_text;

      // Generate next scene (store_ai_scene will update current_ai_scene_order)
      (async () => {
        try {
          await generateNextScene(nextOrder, {
            daniel: danielResponse,
            huaiyao: huaiyaoResponse,
          });
        } catch (err) {
          console.error('[AI DEBUG] Generation failed:', err);
          setIsGenerating(false);
          generationTriggeredRef.current = false;
        }
      })();
    }
  }, [bothResponded, currentPlayer, isGenerating, myResponse, partnerResponse, gameState?.session?.current_ai_scene_order, sessionId]);

  const router = useRouter();

  // Warn before leaving page
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (gameState?.session?.status === 'active') {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [gameState?.session?.status]);

  // Confirmation for navigation links
  const handleNavigation = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (gameState?.session?.status === 'active') {
      const confirmed = window.confirm(
        'Are you sure you want to leave? Your partner will be waiting for you. You can rejoin from the Episodes page.'
      );
      if (!confirmed) {
        e.preventDefault();
        return;
      }
    }
    router.push(href);
    e.preventDefault();
  };

  // DEBUG: Show state info
  const debugInfo = gameState ? {
    status: gameState.session?.status,
    daniel: gameState.session?.daniel_joined,
    huaiyao: gameState.session?.huaiyao_joined,
    scene: gameState.scene?.scene_order || 'none',
    needs_gen: gameState.needs_generation,
    generating: isGenerating,
    error: generateError,
  } : null;

  // Loading state
  if (isLoading) {
    console.log('[AI DEBUG] Rendering: Loading state');
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center">
        <div className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
            className="w-8 h-8 border-4 border-purple-200 border-t-purple-500 rounded-full mx-auto mb-4"
          />
          <p className="text-purple-300 text-sm">Loading game state...</p>
          <p className="text-purple-500 text-xs mt-2">Session: {sessionId.slice(0, 8)}...</p>
        </div>
      </div>
    );
  }

  if (!gameState) {
    console.log('[AI DEBUG] Rendering: No game state');
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-purple-200">Unable to load game state</p>
          <button onClick={onBack} className="text-purple-300 hover:text-white mt-4">
            ← Back to mysteries
          </button>
        </div>
      </div>
    );
  }

  const { session, episode, scene, choices, puzzle } = gameState;
  console.log('[AI DEBUG] Rendering main view:', {
    session_status: session.status,
    has_scene: !!scene,
    choices_count: choices?.length,
    textComplete,
    puzzle: !!puzzle,
    puzzleSolved,
    isGenerating
  });

  // Waiting for partner
  if (session.status === 'waiting') {
    console.log('[AI DEBUG] Rendering: Waiting for partner', { daniel_joined: session.daniel_joined, huaiyao_joined: session.huaiyao_joined });
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            className="text-6xl mb-6"
          >
            🤖
          </motion.div>
          <h1 className="text-2xl font-serif font-bold text-white mb-2">
            Waiting for {partnerName}...
          </h1>
          <p className="text-purple-200 mb-4">
            Once both detectives are here, the AI will generate your unique mystery!
          </p>
          {/* Debug info */}
          <p className="text-purple-500 text-xs mb-4">
            Debug: Daniel={session.daniel_joined?.toString()}, Huaiyao={session.huaiyao_joined?.toString()}, Status={session.status}
          </p>
          <button onClick={onBack} className="text-purple-300 hover:text-white text-sm">
            ← Cancel and go back
          </button>
        </motion.div>
      </div>
    );
  }

  // Generating state (only show if actually generating, or if needs_generation AND status is active)
  if (isGenerating || (gameState.needs_generation && session.status === 'active')) {
    console.log('[AI DEBUG] Rendering: Generating state', { isGenerating, needs_generation: gameState.needs_generation, status: session.status });
    const isWaiting = currentPlayer === 'huaiyao' && !isGenerating;
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center max-w-md">
          <motion.div
            animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-6xl mb-6"
          >
            {isWaiting ? '⏳' : '🧠'}
          </motion.div>
          <h1 className="text-2xl font-serif font-bold text-white mb-2">
            {isWaiting ? 'Waiting for story...' : 'AI is crafting your mystery...'}
          </h1>
          <p className="text-purple-200">
            {isWaiting ? 'Daniel is generating the scene' : 'Generating a unique story based on your choices'}
          </p>
          {generateError && (
            <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
              <p className="text-red-300 text-sm">Error: {generateError}</p>
              <button
                onClick={() => {
                  setGenerateError(null);
                  generateNextScene(session.current_ai_scene_order || 1);
                }}
                className="mt-2 px-4 py-1 bg-red-500/30 hover:bg-red-500/50 rounded text-white text-sm"
              >
                Retry
              </button>
            </div>
          )}
          {!generateError && (
            <motion.div
              className="mt-6 h-1 bg-purple-900 rounded-full overflow-hidden"
              initial={{ width: 200 }}
            >
              <motion.div
                className="h-full bg-purple-500"
                animate={{ x: [-200, 200] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                style={{ width: '50%' }}
              />
            </motion.div>
          )}
        </motion.div>
      </div>
    );
  }

  // Ending screen
  if (scene?.is_ending) {
    const endingEmojis = { good: '🎉', neutral: '🤔', bad: '😱' };
    const endingMessages = {
      good: 'Case closed brilliantly!',
      neutral: 'The truth revealed...',
      bad: 'A dark conclusion...',
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

          <div className="text-purple-300 text-sm mb-6">
            <p>Scenes played: {session.current_ai_scene_order}</p>
            <p className="mt-1 text-xs">Every playthrough is unique - try again for a different story!</p>
          </div>

          <button
            onClick={onBack}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors"
          >
            Choose Another Mystery
          </button>
        </motion.div>
      </div>
    );
  }

  // Main game UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 overflow-x-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6 pb-32">
        {/* Navigation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-4 mb-4"
        >
          <a
            href="/"
            onClick={(e) => handleNavigation(e, '/')}
            className="flex items-center gap-1 text-purple-300 hover:text-white transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Home
          </a>
          <a
            href="/mystery"
            onClick={(e) => handleNavigation(e, '/mystery')}
            className="flex items-center gap-1 text-purple-300 hover:text-white transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Episodes
          </a>
        </motion.div>

        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <div>
            <div className="flex items-center gap-2">
              <p className="text-amber-400 text-sm font-medium">
                Episode {episode.episode_number}
              </p>
              <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 text-xs rounded-full">
                AI-Driven
              </span>
            </div>
            <h1 className="text-xl font-serif font-bold text-white">
              {episode.title}
            </h1>
            <p className="text-purple-400 text-xs">Scene {session.current_ai_scene_order}</p>
          </div>
          <PartnerStatus
            currentPlayer={currentPlayer}
            danielOnline={session.daniel_joined}
            huaiyaoOnline={session.huaiyao_joined}
            danielLastSeen={session.daniel_last_seen}
            huaiyaoLastSeen={session.huaiyao_last_seen}
          />
        </motion.header>

        {/* Scene content */}
        {scene && (
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
            {textComplete ? (
              <p className="text-purple-100 leading-relaxed text-lg whitespace-pre-wrap">
                {scene.narrative_text}
              </p>
            ) : (
              <TypewriterText
                text={scene.narrative_text}
                speed={20}
                onComplete={() => setTextComplete(true)}
                className="text-purple-100 leading-relaxed text-lg"
              />
            )}
          </motion.div>
        )}

        {/* Puzzle section */}
        <AnimatePresence>
          {textComplete && puzzle && !puzzleSolved && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-cyan-900/20 border border-cyan-500/30 rounded-xl p-6 mb-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🧩</span>
                <h3 className="text-lg font-bold text-cyan-400">{puzzle.title}</h3>
                <span className="ml-auto text-xs text-cyan-500/70">
                  Difficulty: {'⭐'.repeat(puzzle.difficulty)}
                </span>
              </div>

              <p className="text-purple-100 mb-4 whitespace-pre-wrap">{puzzle.description}</p>

              {/* Puzzle data display */}
              {puzzle.puzzle_data && (
                <div className="bg-black/30 rounded-lg p-4 mb-4 font-mono text-sm">
                  {Array.isArray(puzzle.puzzle_data.equations) && (
                    <div className="space-y-1">
                      {(puzzle.puzzle_data.equations as string[]).map((eq, i) => (
                        <div key={i} className="text-cyan-300">{eq}</div>
                      ))}
                    </div>
                  )}
                  {typeof puzzle.puzzle_data.note === 'string' && (
                    <p className="text-purple-300 mt-2 italic">
                      {puzzle.puzzle_data.note}
                    </p>
                  )}
                </div>
              )}

              {/* Answer input */}
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={puzzleAnswer}
                  onChange={(e) => {
                    setPuzzleAnswer(e.target.value);
                    setPuzzleError(null);
                  }}
                  placeholder="Enter your answer..."
                  className="flex-1 px-4 py-2 bg-purple-900/50 border border-cyan-500/30 rounded-lg text-white placeholder-purple-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  onKeyDown={(e) => e.key === 'Enter' && checkPuzzleAnswer()}
                />
                <button
                  onClick={checkPuzzleAnswer}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors"
                >
                  Check
                </button>
              </div>

              {puzzleError && (
                <p className="text-red-400 text-sm mb-4">{puzzleError}</p>
              )}

              {/* Hints */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setHintsRevealed(Math.min(hintsRevealed + 1, puzzle.max_hints))}
                  disabled={hintsRevealed >= puzzle.max_hints}
                  className="text-sm text-purple-400 hover:text-purple-300 disabled:opacity-50"
                >
                  Show hint ({hintsRevealed}/{puzzle.max_hints})
                </button>
              </div>
              {hintsRevealed > 0 && (
                <div className="mt-2 space-y-1">
                  {puzzle.hints.slice(0, hintsRevealed).map((hint, i) => (
                    <p key={i} className="text-yellow-400/80 text-sm">
                      💡 {hint}
                    </p>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Puzzle solved */}
        {puzzleSolved && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-green-900/30 border border-green-500/50 rounded-xl p-4 mb-6 text-center"
          >
            <span className="text-2xl mr-2">🎉</span>
            <span className="text-green-300 font-medium">Puzzle Solved!</span>
          </motion.div>
        )}

        {/* Choices / Response section */}
        {textComplete && (!puzzle || puzzleSolved) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Show partner's response if they've already responded */}
            {partnerResponse && !myResponse && (
              <div className="bg-purple-900/30 border border-purple-500/30 rounded-xl p-4 mb-4">
                <p className="text-purple-300 text-sm mb-1">
                  {partnerName} decided:
                </p>
                <p className="text-purple-100 italic">&ldquo;{partnerResponse.response_text}&rdquo;</p>
              </div>
            )}

            {/* Already submitted */}
            {myResponse && (
              <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4">
                <p className="text-green-400 text-sm mb-1">Your decision:</p>
                <p className="text-green-100 italic">&ldquo;{myResponse.response_text}&rdquo;</p>
                {!partnerResponse && (
                  <p className="text-amber-400 text-sm mt-3">
                    Waiting for {partnerName} to decide...
                  </p>
                )}
              </div>
            )}

            {/* Debug: show choices count */}
            <p className="text-purple-500 text-xs mb-2">
              Debug: {choices?.length || 0} choices loaded, textComplete={textComplete.toString()}
            </p>

            {/* Choice buttons */}
            {!myResponse && choices && choices.length > 0 && (
              <>
                <h3 className="text-sm font-medium text-purple-300">What do you want to do?</h3>
                <div className="space-y-2">
                  {choices.filter(c => !c.is_custom_input).map((choice) => (
                    <button
                      key={choice.id}
                      onClick={() => {
                        setSelectedChoice(choice.id);
                        setCustomInput('');
                      }}
                      disabled={isSubmitting}
                      className={`w-full p-4 rounded-xl text-left transition-all ${
                        selectedChoice === choice.id
                          ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                          : 'bg-purple-900/50 text-purple-100 hover:bg-purple-800/60'
                      } ${isSubmitting ? 'opacity-50' : ''}`}
                    >
                      {choice.choice_text}
                    </button>
                  ))}
                </div>

                {/* Custom input option */}
                <div className="mt-4">
                  <p className="text-purple-300 text-sm mb-2">Or type your own action:</p>
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={customInput}
                      onChange={(e) => {
                        setCustomInput(e.target.value);
                        setSelectedChoice(null);
                      }}
                      placeholder="What do you want to do?"
                      className="flex-1 px-4 py-3 bg-purple-900/50 border border-purple-500/30 rounded-xl text-white placeholder-purple-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      disabled={isSubmitting}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customInput.trim()) {
                          submitResponse(customInput.trim());
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Submit button */}
                <button
                  onClick={() => {
                    if (customInput.trim()) {
                      submitResponse(customInput.trim());
                    } else if (selectedChoice) {
                      const choice = choices.find(c => c.id === selectedChoice);
                      if (choice) {
                        submitResponse(choice.choice_text);
                      }
                    }
                  }}
                  disabled={isSubmitting || (!selectedChoice && !customInput.trim())}
                  className="w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-600 text-purple-950 disabled:text-gray-400 rounded-xl font-semibold transition-colors"
                >
                  {isSubmitting ? 'Submitting...' : 'Confirm Decision'}
                </button>
              </>
            )}

            {/* Fallback if no choices */}
            {!myResponse && (!choices || choices.length === 0) && (
              <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-xl p-4">
                <p className="text-yellow-300 text-sm mb-2">No choices loaded. Type your own action:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    placeholder="What do you want to do?"
                    className="flex-1 px-4 py-3 bg-purple-900/50 border border-purple-500/30 rounded-xl text-white placeholder-purple-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    disabled={isSubmitting}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customInput.trim()) {
                        submitResponse(customInput.trim());
                      }
                    }}
                  />
                  <button
                    onClick={() => customInput.trim() && submitResponse(customInput.trim())}
                    disabled={isSubmitting || !customInput.trim()}
                    className="px-6 py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-600 text-purple-950 rounded-xl font-semibold"
                  >
                    Go
                  </button>
                </div>
              </div>
            )}

            {/* Both responded - trigger next scene */}
            {bothResponded && (
              <div className="text-center py-8">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  className="inline-block text-4xl mb-4"
                >
                  🧠
                </motion.div>
                <p className="text-purple-200">Generating next scene...</p>
              </div>
            )}
          </motion.div>
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
            <span className={currentPlayer === 'daniel' ? 'text-blue-400' : 'text-rose-400'}>
              {currentPlayer === 'daniel' ? 'Daniel' : 'Huaiyao'}
            </span>
          </p>
        </motion.footer>
      </main>
    </div>
  );
}
