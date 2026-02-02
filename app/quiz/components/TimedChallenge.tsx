'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';

interface ChallengeQuestion {
  id: string;
  question_text: string;
  correct_answer: string;
  question_order: number;
}

interface ChallengeAnswer {
  question_id: string;
  player: string;
  is_correct: boolean;
  answer_time_ms: number;
}

interface Challenge {
  id: string;
  status: string;
  question_count: number;
  time_limit_seconds: number;
  current_question_index: number;
  daniel_score: number;
  huaiyao_score: number;
  created_by: string;
  started_at: string;
  questions: ChallengeQuestion[];
  answers: ChallengeAnswer[] | null;
}

interface HistoryEntry {
  id: string;
  status: string;
  daniel_score: number;
  huaiyao_score: number;
  winner: string | null;
  question_count: number;
  completed_at: string;
}

interface TimedChallengeProps {
  currentUser: 'daniel' | 'huaiyao';
  onClose: () => void;
}

export function TimedChallenge({ currentUser, onClose }: TimedChallengeProps) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showResult, setShowResult] = useState<{ correct: boolean; points: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchChallenge = useCallback(async () => {
    try {
      const [challengeRes, historyRes] = await Promise.all([
        supabase.rpc('get_active_challenge'),
        supabase.rpc('get_challenge_history', { p_limit: 10 }),
      ]);

      if (challengeRes.error) throw challengeRes.error;
      if (historyRes.error) throw historyRes.error;

      setChallenge(challengeRes.data);
      setHistory(historyRes.data || []);

      if (challengeRes.data) {
        setTimeLeft(challengeRes.data.time_limit_seconds);
        startTimeRef.current = Date.now();
      }
    } catch (error) {
      console.error('Error fetching challenge:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChallenge();

    // Set up real-time subscription
    const channel = supabase
      .channel('challenge-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_challenge_answers' },
        () => fetchChallenge()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_challenges' },
        () => fetchChallenge()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchChallenge]);

  // Timer countdown
  useEffect(() => {
    if (challenge && challenge.status === 'active' && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => Math.max(0, prev - 1));
      }, 1000);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [challenge, timeLeft]);

  const handleCreateChallenge = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.rpc('create_quiz_challenge', {
        p_created_by: currentUser,
        p_question_count: 5,
        p_time_limit: 30,
      });

      if (error) throw error;
      fetchChallenge();
    } catch (error) {
      console.error('Error creating challenge:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!challenge || !answer.trim()) return;

    const currentQuestion = challenge.questions[challenge.current_question_index];
    if (!currentQuestion) return;

    setSubmitting(true);
    const answerTimeMs = Date.now() - startTimeRef.current;

    try {
      // Check if answer is correct (case-insensitive)
      const isCorrect =
        answer.trim().toLowerCase() === currentQuestion.correct_answer.trim().toLowerCase();

      const { data, error } = await supabase.rpc('submit_challenge_answer', {
        p_challenge_id: challenge.id,
        p_question_id: currentQuestion.id,
        p_player: currentUser,
        p_is_correct: isCorrect,
        p_answer_time_ms: answerTimeMs,
      });

      if (error) throw error;

      // Show result briefly
      setShowResult({
        correct: isCorrect,
        points: data.points_earned,
      });

      // Clear and prepare for next question
      setAnswer('');
      setTimeout(() => {
        setShowResult(null);
        fetchChallenge();
      }, 1500);
    } catch (error) {
      console.error('Error submitting answer:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTimeUp = async () => {
    if (!challenge) return;

    const currentQuestion = challenge.questions[challenge.current_question_index];
    if (!currentQuestion) return;

    // Auto-submit wrong answer when time runs out
    try {
      await supabase.rpc('submit_challenge_answer', {
        p_challenge_id: challenge.id,
        p_question_id: currentQuestion.id,
        p_player: currentUser,
        p_is_correct: false,
        p_answer_time_ms: challenge.time_limit_seconds * 1000,
      });

      setShowResult({ correct: false, points: 0 });
      setAnswer('');
      setTimeout(() => {
        setShowResult(null);
        fetchChallenge();
      }, 1500);
    } catch (error) {
      console.error('Error auto-submitting:', error);
    }
  };

  // Auto-submit when time runs out
  useEffect(() => {
    if (timeLeft === 0 && challenge && challenge.status === 'active') {
      const currentQuestion = challenge.questions[challenge.current_question_index];
      const hasAnswered = challenge.answers?.some(
        (a) => a.question_id === currentQuestion?.id && a.player === currentUser
      );

      if (!hasAnswered && currentQuestion) {
        handleTimeUp();
      }
    }
  }, [timeLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  const getCurrentQuestion = () => {
    if (!challenge) return null;
    return challenge.questions[challenge.current_question_index];
  };

  const hasAnsweredCurrent = () => {
    if (!challenge) return false;
    const currentQuestion = getCurrentQuestion();
    if (!currentQuestion) return false;
    return challenge.answers?.some(
      (a) => a.question_id === currentQuestion.id && a.player === currentUser
    );
  };

  const getOtherAnswered = () => {
    if (!challenge) return false;
    const currentQuestion = getCurrentQuestion();
    if (!currentQuestion) return false;
    const otherPlayer = currentUser === 'daniel' ? 'huaiyao' : 'daniel';
    return challenge.answers?.some(
      (a) => a.question_id === currentQuestion.id && a.player === otherPlayer
    );
  };

  const formatTime = (seconds: number) => {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Timed Challenge</h2>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {challenge && challenge.status === 'active' && (
            <div className="flex items-center justify-between mt-3">
              <div className="flex gap-4">
                <div className={`text-center ${currentUser === 'daniel' ? 'font-bold' : ''}`}>
                  <div className="text-xs opacity-80">Daniel</div>
                  <div className="text-lg">{Math.round(challenge.daniel_score)}</div>
                </div>
                <div className="text-2xl">vs</div>
                <div className={`text-center ${currentUser === 'huaiyao' ? 'font-bold' : ''}`}>
                  <div className="text-xs opacity-80">Huaiyao</div>
                  <div className="text-lg">{Math.round(challenge.huaiyao_score)}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs opacity-80">Question</div>
                <div className="text-lg">
                  {challenge.current_question_index + 1}/{challenge.question_count}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full"
              />
            </div>
          ) : challenge && challenge.status === 'active' ? (
            // Active Challenge
            <div>
              {/* Timer */}
              <div className="flex justify-center mb-6">
                <motion.div
                  className={`text-4xl font-bold ${
                    timeLeft <= 10 ? 'text-red-500' : 'text-indigo-600 dark:text-indigo-400'
                  }`}
                  animate={timeLeft <= 10 ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 0.5, repeat: timeLeft <= 10 ? Infinity : 0 }}
                >
                  {formatTime(timeLeft)}
                </motion.div>
              </div>

              {/* Question */}
              <div className="mb-6">
                <p className="text-lg text-gray-800 dark:text-gray-200 text-center">
                  {getCurrentQuestion()?.question_text}
                </p>
              </div>

              {/* Answer Input or Waiting */}
              {hasAnsweredCurrent() ? (
                <div className="text-center py-6">
                  <div className="text-5xl mb-3">⏳</div>
                  <p className="text-gray-600 dark:text-gray-400">
                    {getOtherAnswered()
                      ? 'Both answered! Moving to next question...'
                      : `Waiting for ${currentUser === 'daniel' ? 'Huaiyao' : 'Daniel'}...`}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitAnswer()}
                    placeholder="Type your answer..."
                    className="w-full px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:border-indigo-500 focus:ring-0 dark:bg-gray-700 dark:text-white"
                    disabled={submitting}
                    autoFocus
                  />
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSubmitAnswer}
                    disabled={submitting || !answer.trim()}
                    className="w-full py-3 bg-indigo-500 text-white rounded-xl font-medium text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Submitting...' : 'Submit Answer'}
                  </motion.button>
                </div>
              )}

              {/* Result Popup */}
              <AnimatePresence>
                {showResult && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
                  >
                    <div
                      className={`px-8 py-6 rounded-2xl ${
                        showResult.correct
                          ? 'bg-green-500 text-white'
                          : 'bg-red-500 text-white'
                      }`}
                    >
                      <div className="text-5xl text-center mb-2">
                        {showResult.correct ? '✓' : '✗'}
                      </div>
                      <div className="text-xl font-bold text-center">
                        {showResult.correct ? `+${Math.round(showResult.points)} pts` : 'Wrong!'}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : challenge && challenge.status === 'completed' ? (
            // Completed Challenge
            <div className="text-center py-6">
              <div className="text-6xl mb-4">
                {challenge.daniel_score > challenge.huaiyao_score
                  ? currentUser === 'daniel'
                    ? '🎉'
                    : '😢'
                  : challenge.huaiyao_score > challenge.daniel_score
                  ? currentUser === 'huaiyao'
                    ? '🎉'
                    : '😢'
                  : '🤝'}
              </div>
              <h3 className="text-2xl font-bold dark:text-white mb-2">
                {challenge.daniel_score > challenge.huaiyao_score
                  ? 'Daniel Wins!'
                  : challenge.huaiyao_score > challenge.daniel_score
                  ? 'Huaiyao Wins!'
                  : "It's a Tie!"}
              </h3>
              <div className="text-gray-600 dark:text-gray-400 mb-6">
                {Math.round(challenge.daniel_score)} - {Math.round(challenge.huaiyao_score)}
              </div>
              <button
                onClick={handleCreateChallenge}
                className="px-6 py-2 bg-indigo-500 text-white rounded-lg font-medium"
              >
                Play Again
              </button>
            </div>
          ) : (
            // No Active Challenge
            <div className="text-center py-6">
              <div className="text-6xl mb-4">⚡</div>
              <h3 className="text-xl font-bold dark:text-white mb-2">
                Ready for a Challenge?
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Race against each other to answer questions!<br />
                Faster correct answers = more points
              </p>
              <div className="space-y-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleCreateChallenge}
                  className="w-full py-3 bg-indigo-500 text-white rounded-xl font-medium text-lg"
                >
                  Start Challenge
                </motion.button>
                {history.length > 0 && (
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="text-indigo-500 dark:text-indigo-400 text-sm"
                  >
                    {showHistory ? 'Hide' : 'View'} History
                  </button>
                )}
              </div>

              {/* History */}
              <AnimatePresence>
                {showHistory && history.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4"
                  >
                    <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                      Recent Challenges
                    </h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {history.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm"
                        >
                          <span className="dark:text-gray-300">
                            {Math.round(entry.daniel_score)} - {Math.round(entry.huaiyao_score)}
                          </span>
                          <span
                            className={`font-medium ${
                              entry.winner === currentUser
                                ? 'text-green-600 dark:text-green-400'
                                : entry.winner === 'tie'
                                ? 'text-gray-600 dark:text-gray-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {entry.winner === currentUser
                              ? 'Won'
                              : entry.winner === 'tie'
                              ? 'Tie'
                              : 'Lost'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
