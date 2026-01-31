'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Player, MysteryEpisode, MysterySession } from '@/lib/supabase';

interface WaitingGame {
  session: MysterySession;
  episode: MysteryEpisode;
}

export default function MysteryPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<Player | null>(null);
  const [episodes, setEpisodes] = useState<MysteryEpisode[]>([]);
  const [waitingGames, setWaitingGames] = useState<WaitingGame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEpisode, setSelectedEpisode] = useState<MysteryEpisode | null>(null);
  const [waitingSession, setWaitingSession] = useState<MysterySession | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured || !currentUser) {
      setIsLoading(false);
      return;
    }

    try {
      // Fetch episodes
      const { data: episodesData, error: episodesError } = await supabase.rpc('get_mystery_episodes');
      if (episodesError) throw episodesError;
      setEpisodes(episodesData || []);

      // Fetch waiting sessions where partner is waiting for current user
      const partnerJoinedField = currentUser === 'daniel' ? 'huaiyao_joined' : 'daniel_joined';
      const currentUserJoinedField = currentUser === 'daniel' ? 'daniel_joined' : 'huaiyao_joined';

      const { data: sessionsData, error: sessionsError } = await supabase
        .from('mystery_sessions')
        .select('*, mystery_episodes(*)')
        .eq('status', 'waiting')
        .eq(partnerJoinedField, true)
        .eq(currentUserJoinedField, false);

      if (sessionsError) throw sessionsError;

      const games: WaitingGame[] = (sessionsData || []).map((s: any) => ({
        session: s,
        episode: s.mystery_episodes,
      }));
      setWaitingGames(games);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
    setIsLoading(false);
  }, [currentUser]);

  useEffect(() => {
    const savedUser = localStorage.getItem('mystery-user') as Player | null;
    setCurrentUser(savedUser);
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchData();
    }
  }, [currentUser, fetchData]);

  // Subscribe to new waiting sessions
  useEffect(() => {
    if (!currentUser) return;

    const channel = supabase
      .channel('mystery-waiting-sessions')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mystery_sessions',
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser, fetchData]);

  // Subscribe to session changes while waiting
  useEffect(() => {
    if (!waitingSession) return;

    const channel = supabase
      .channel(`mystery-session-${waitingSession.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'mystery_sessions',
          filter: `id=eq.${waitingSession.id}`,
        },
        (payload) => {
          const updated = payload.new as MysterySession;
          setWaitingSession(updated);

          // Both joined - navigate to game
          if (updated.daniel_joined && updated.huaiyao_joined) {
            router.push(`/mystery/${updated.id}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [waitingSession, router]);

  // Heartbeat while in waiting room
  useEffect(() => {
    if (!waitingSession || !currentUser) return;

    const heartbeat = setInterval(async () => {
      await supabase.rpc('update_mystery_presence', {
        p_session_id: waitingSession.id,
        p_player: currentUser,
      });
    }, 10000);

    return () => clearInterval(heartbeat);
  }, [waitingSession, currentUser]);

  const selectUser = (user: Player) => {
    setCurrentUser(user);
    localStorage.setItem('mystery-user', user);
  };

  const startGame = async (episode: MysteryEpisode) => {
    if (!currentUser) return;

    setIsCreatingSession(true);
    try {
      const { data, error } = await supabase.rpc('start_mystery_session', {
        p_episode_id: episode.id,
        p_player: currentUser,
      });

      if (error) throw error;

      setWaitingSession(data);
      setSelectedEpisode(episode);

      // Notify partner
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mystery_waiting',
          title: episode.title,
          user: currentUser,
        }),
      });
    } catch (error) {
      console.error('Error starting session:', error);
    }
    setIsCreatingSession(false);
  };

  const joinExistingSession = async (sessionId: string) => {
    if (!currentUser) return;

    setIsJoining(true);
    try {
      const { data, error } = await supabase.rpc('join_mystery_session', {
        p_session_id: sessionId,
        p_player: currentUser,
      });

      if (error) throw error;

      // Navigate to game regardless - the session page handles the rest
      router.push(`/mystery/${sessionId}`);
    } catch (error) {
      console.error('Error joining session:', error);
      setIsJoining(false);
    }
  };

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  // User selection screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <motion.div
            animate={{ y: [0, -5, 0], rotate: [0, 5, -5, 0] }}
            transition={{ duration: 4, repeat: Infinity }}
            className="text-6xl mb-6"
          >
            🔍
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-white mb-4">Who are you?</h1>
          <p className="text-purple-200 mb-8">Time to solve a mystery together!</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectUser('daniel')}
              className="px-8 py-4 rounded-xl bg-blue-500 text-white font-medium shadow-lg hover:bg-blue-600 transition-colors"
            >
              I'm Daniel
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectUser('huaiyao')}
              className="px-8 py-4 rounded-xl bg-rose-500 text-white font-medium shadow-lg hover:bg-rose-600 transition-colors"
            >
              I'm Huaiyao
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  // Waiting room
  if (waitingSession && selectedEpisode) {
    const partnerJoined = currentUser === 'daniel'
      ? waitingSession.huaiyao_joined
      : waitingSession.daniel_joined;

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md"
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
          <p className="text-purple-200 mb-6">
            Ready to play: <span className="text-amber-400">{selectedEpisode.title}</span>
          </p>

          <div className="bg-white/10 backdrop-blur rounded-xl p-6 mb-6">
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className={`w-12 h-12 rounded-full ${currentUser === 'daniel' ? 'bg-blue-500' : 'bg-rose-500'} flex items-center justify-center mx-auto mb-2`}>
                  <span className="text-white font-bold text-lg">
                    {currentUser === 'daniel' ? 'D' : 'H'}
                  </span>
                </div>
                <p className="text-white text-sm">You</p>
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="w-2 h-2 rounded-full bg-green-500 mx-auto mt-1"
                />
              </div>

              <motion.div
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-4xl"
              >
                ⋯
              </motion.div>

              <div className="text-center">
                <div className={`w-12 h-12 rounded-full ${currentUser === 'daniel' ? 'bg-rose-500' : 'bg-blue-500'} flex items-center justify-center mx-auto mb-2 ${!partnerJoined ? 'opacity-40' : ''}`}>
                  <span className="text-white font-bold text-lg">
                    {currentUser === 'daniel' ? 'H' : 'D'}
                  </span>
                </div>
                <p className="text-white text-sm">{partnerName}</p>
                {partnerJoined ? (
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-green-500 mx-auto mt-1"
                  />
                ) : (
                  <div className="w-2 h-2 rounded-full bg-gray-500 mx-auto mt-1" />
                )}
              </div>
            </div>
          </div>

          <p className="text-purple-300 text-sm mb-4">
            Share this link with {partnerName}:
          </p>
          <div className="bg-white/5 rounded-lg p-3 mb-6">
            <code className="text-amber-400 text-sm break-all">
              {typeof window !== 'undefined' ? `${window.location.origin}/mystery/${waitingSession.id}` : ''}
            </code>
          </div>

          <button
            onClick={() => {
              setWaitingSession(null);
              setSelectedEpisode(null);
            }}
            className="text-purple-300 hover:text-white transition-colors text-sm"
          >
            ← Cancel and go back
          </button>
        </motion.div>
      </div>
    );
  }

  // Loading
  if (isLoading) {
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

  // Episode selection
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-950 via-slate-900 to-purple-950">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
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

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6 sm:py-12 pb-safe">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <a
            href="/"
            className="inline-block mb-4 px-4 py-2 -mx-4 text-purple-300 hover:text-white active:text-amber-400 transition-colors touch-manipulation"
          >
            ← Home
          </a>
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="text-5xl mb-4"
          >
            🔍
          </motion.div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white mb-2">
            Mystery Files
          </h1>
          <p className="text-purple-200">Solve mysteries together, one choice at a time</p>
        </motion.div>

        {/* Waiting games from partner */}
        {waitingGames.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <h2 className="text-lg font-medium text-amber-400 mb-4">
              {partnerName} is waiting for you!
            </h2>
            <div className="space-y-3">
              {waitingGames.map((game) => (
                <motion.button
                  key={game.session.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => joinExistingSession(game.session.id)}
                  disabled={isJoining}
                  className="w-full text-left bg-amber-500/20 backdrop-blur border-2 border-amber-500/50 hover:border-amber-400 rounded-xl p-6 transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="text-3xl"
                    >
                      🎮
                    </motion.div>
                    <div className="flex-1">
                      <p className="text-amber-300 text-sm mb-1">
                        Join {partnerName}'s game
                      </p>
                      <h3 className="text-xl font-serif font-semibold text-white">
                        {game.episode.title}
                      </h3>
                    </div>
                    <div className="text-amber-400 font-medium">
                      Join →
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Episodes */}
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-purple-300 mb-4">
            {waitingGames.length > 0 ? 'Or start a new mystery' : 'Choose a Mystery'}
          </h2>

          {episodes.length === 0 ? (
            <div className="text-center py-12 text-purple-400">
              <div className="text-4xl mb-4">📁</div>
              <p>No mysteries available yet.</p>
              <p className="text-sm mt-2">Check back soon!</p>
            </div>
          ) : (
            <AnimatePresence>
              {episodes.map((episode, index) => (
                <motion.div
                  key={episode.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => startGame(episode)}
                    disabled={isCreatingSession}
                    className="w-full text-left bg-white/5 backdrop-blur border border-white/10 hover:border-amber-500/50 rounded-xl p-6 transition-all disabled:opacity-50"
                  >
                    <div className="flex items-start gap-4">
                      <div className="text-3xl">📖</div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-amber-400 font-medium">
                            Episode {episode.episode_number}
                          </span>
                        </div>
                        <h3 className="text-xl font-serif font-semibold text-white mb-2">
                          {episode.title}
                        </h3>
                        {episode.description && (
                          <p className="text-purple-200 text-sm">
                            {episode.description}
                          </p>
                        )}
                      </div>
                      <div className="text-purple-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </motion.button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

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
            {' · '}
            <button
              onClick={() => {
                localStorage.removeItem('mystery-user');
                setCurrentUser(null);
              }}
              className="underline hover:text-white transition-colors"
            >
              Switch
            </button>
          </p>
        </motion.footer>
      </main>
    </div>
  );
}
