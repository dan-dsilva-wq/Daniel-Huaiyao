'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import Link from 'next/link';
import { ThemeToggle } from '../components/ThemeToggle';

interface DailyPrompt {
  daily_prompt_id: string;
  prompt_id: string;
  prompt_text: string;
  category_name: string;
  category_emoji: string;
  prompt_date: string;
  my_response: string | null;
  partner_response: string | null;
  my_response_time: string | null;
  partner_response_time: string | null;
}

interface PromptHistory {
  daily_prompt_id: string;
  prompt_text: string;
  category_emoji: string;
  prompt_date: string;
  my_response: string | null;
  partner_response: string | null;
  both_answered: boolean;
}

export default function PromptsPage() {
  useMarkAppViewed('prompts');
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [todayPrompt, setTodayPrompt] = useState<DailyPrompt | null>(null);
  const [history, setHistory] = useState<PromptHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'today' | 'history'>('today');
  const [response, setResponse] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPartnerResponse, setShowPartnerResponse] = useState(false);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured || !currentUser) {
      setIsLoading(false);
      return;
    }

    try {
      // Get today's prompt
      const { data: promptData, error: promptError } = await supabase.rpc('get_daily_prompt', {
        p_player: currentUser,
      });
      if (promptError) throw promptError;
      if (promptData && promptData.length > 0) {
        setTodayPrompt(promptData[0]);
        setResponse(promptData[0].my_response || '');
      }

      // Get history
      const { data: historyData, error: historyError } = await supabase.rpc('get_prompt_history', {
        p_player: currentUser,
        p_limit: 30,
      });
      if (historyError) throw historyError;
      setHistory(historyData || []);
    } catch (error) {
      console.error('Error fetching prompts:', error);
    }
    setIsLoading(false);
  }, [currentUser]);

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchData();
    }
  }, [currentUser, fetchData]);

  const sendNotification = async () => {
    if (!currentUser) return;
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prompt_answered', title: 'answered today\'s prompt', user: currentUser }),
      });
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  const submitResponse = async () => {
    if (!response.trim() || !todayPrompt || !currentUser) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('submit_prompt_response', {
        p_daily_prompt_id: todayPrompt.daily_prompt_id,
        p_player: currentUser,
        p_response_text: response.trim(),
      });

      if (error) throw error;
      sendNotification();
      fetchData();
    } catch (error) {
      console.error('Error submitting response:', error);
    }
    setIsSubmitting(false);
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', user);
  };

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  // User selection screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="text-6xl mb-6"
          >
            💬
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
            Who are you?
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            Daily connection prompts for you both
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectUser('daniel')}
              className="px-8 py-4 rounded-xl bg-blue-500 text-white font-medium shadow-lg hover:bg-blue-600 transition-colors"
            >
              I&apos;m Daniel
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectUser('huaiyao')}
              className="px-8 py-4 rounded-xl bg-rose-500 text-white font-medium shadow-lg hover:bg-rose-600 transition-colors"
            >
              I&apos;m Huaiyao
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-4 border-cyan-200 border-t-cyan-500 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-100/30 dark:bg-cyan-900/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-teal-100/30 dark:bg-teal-900/20 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6 sm:py-12 pb-safe">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6 sm:mb-8"
        >
          <div className="flex items-center justify-between mb-4">
            <Link
              href="/"
              className="px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:text-gray-800 transition-colors touch-manipulation"
            >
              ← Home
            </Link>
            <ThemeToggle />
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
            Daily Prompts
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            A new question each day to connect deeper
          </p>
        </motion.div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('today')}
            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
              activeTab === 'today'
                ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg'
                : 'bg-white/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
              activeTab === 'history'
                ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg'
                : 'bg-white/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800'
            }`}
          >
            History
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'today' && todayPrompt && (
            <motion.div
              key="today"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              {/* Today's Prompt Card */}
              <div className="bg-gradient-to-br from-cyan-500 to-teal-500 rounded-2xl p-6 text-white shadow-xl mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl">{todayPrompt.category_emoji}</span>
                  <span className="text-sm opacity-80 capitalize">{todayPrompt.category_name}</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-serif font-semibold mb-4">
                  {todayPrompt.prompt_text}
                </h2>
                <p className="text-sm opacity-70">
                  {new Date(todayPrompt.prompt_date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>

              {/* Response Section */}
              <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-2xl p-5 shadow-sm">
                {todayPrompt.my_response ? (
                  <div>
                    <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-3">Your response</h3>
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-4">
                      {todayPrompt.my_response}
                    </p>
                    <button
                      onClick={() => setResponse(todayPrompt.my_response || '')}
                      className="text-sm text-cyan-500 hover:text-cyan-600"
                    >
                      Edit response
                    </button>
                  </div>
                ) : (
                  <div>
                    <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-3">Your response</h3>
                    <textarea
                      value={response}
                      onChange={(e) => setResponse(e.target.value)}
                      placeholder="Share your thoughts..."
                      rows={4}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl
                                 text-gray-800 dark:text-gray-100 placeholder-gray-400
                                 focus:outline-none focus:ring-2 focus:ring-cyan-300 resize-none"
                    />
                    <button
                      onClick={submitResponse}
                      disabled={!response.trim() || isSubmitting}
                      className="mt-3 w-full py-3 bg-gradient-to-r from-cyan-500 to-teal-500 text-white
                                 rounded-xl font-medium hover:from-cyan-600 hover:to-teal-600
                                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSubmitting ? 'Submitting...' : 'Submit Response'}
                    </button>
                  </div>
                )}

                {/* Partner's Response */}
                {todayPrompt.my_response && (
                  <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                    <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-3">
                      {partnerName}&apos;s response
                    </h3>
                    {todayPrompt.partner_response ? (
                      showPartnerResponse ? (
                        <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                          {todayPrompt.partner_response}
                        </p>
                      ) : (
                        <button
                          onClick={() => setShowPartnerResponse(true)}
                          className="text-cyan-500 hover:text-cyan-600"
                        >
                          Reveal {partnerName}&apos;s response
                        </button>
                      )
                    ) : (
                      <p className="text-gray-400 dark:text-gray-500 italic">
                        {partnerName} hasn&apos;t responded yet
                      </p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              {history.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <div className="text-5xl mb-4">📅</div>
                  <p>No past prompts yet. Come back tomorrow!</p>
                </div>
              ) : (
                history.map((item) => (
                  <motion.div
                    key={item.daily_prompt_id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-xl p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{item.category_emoji}</span>
                      <div className="flex-1">
                        <p className="text-sm text-gray-400 dark:text-gray-500 mb-1">
                          {new Date(item.prompt_date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        <h3 className="font-medium text-gray-800 dark:text-gray-100 mb-2">
                          {item.prompt_text}
                        </h3>
                        {item.both_answered ? (
                          <div className="space-y-2 text-sm">
                            <p className="text-gray-600 dark:text-gray-300">
                              <strong>You:</strong> {item.my_response}
                            </p>
                            <p className="text-gray-600 dark:text-gray-300">
                              <strong>{partnerName}:</strong> {item.partner_response}
                            </p>
                          </div>
                        ) : (
                          <p className="text-gray-400 dark:text-gray-500 text-sm italic">
                            {item.my_response ? `${partnerName} didn't respond` : "You didn't respond"}
                          </p>
                        )}
                      </div>
                      {item.both_answered && (
                        <span className="text-green-500">✓</span>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 dark:text-gray-500 text-sm"
        >
          <p>
            Logged in as{' '}
            <span className={currentUser === 'daniel' ? 'text-blue-500' : 'text-rose-500'}>
              {currentUser === 'daniel' ? 'Daniel' : 'Huaiyao'}
            </span>
            {' · '}
            <button
              onClick={() => {
                localStorage.removeItem('currentUser');
                setCurrentUser(null);
              }}
              className="underline hover:text-gray-600 dark:hover:text-gray-300"
            >
              Switch
            </button>
          </p>
        </motion.footer>
      </main>
    </div>
  );
}
