'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { ThemeToggle } from '../components/ThemeToggle';

interface Achievement {
  id: string;
  code: string;
  title: string;
  description: string;
  emoji: string;
  category: string;
  points: number;
  is_secret: boolean;
  unlocked: boolean;
  unlocked_at: string | null;
}

interface TeamStats {
  quiz_correct: number;
  gratitude_sent: number;
  memories_created: number;
  prompts_answered: number;
  places_visited: number;
}

interface RecentAchievement {
  title: string;
  emoji: string;
  unlocked_at: string;
}

interface StatsData {
  days_together: number;
  stats: {
    first_date: string | null;
    quiz_questions_answered: number;
    mysteries_completed: number;
    dates_completed: number;
    gratitude_notes_sent: number;
    memories_created: number;
    prompts_answered: number;
    media_completed: number;
    places_visited: number;
    book_sentences: number;
  };
  team_stats: TeamStats;
  recent_achievements: RecentAchievement[] | null;
}

interface AchievementsData {
  achievements: Achievement[];
  total_points: number;
  unlocked_count: number;
  total_count: number;
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  quiz: { label: 'Quiz', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  mystery: { label: 'Mystery', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  dates: { label: 'Dates', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300' },
  gratitude: { label: 'Gratitude', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  memories: { label: 'Memories', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  media: { label: 'Media', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  prompts: { label: 'Prompts', color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' },
  general: { label: 'General', color: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
};

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [achievements, setAchievements] = useState<AchievementsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'achievements'>('overview');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [showSetDate, setShowSetDate] = useState(false);
  const [firstDate, setFirstDate] = useState('');

  const fetchData = useCallback(async () => {
    try {
      // Fetch first_date
      const { data: relationshipData } = await supabase
        .from('relationship_stats')
        .select('first_date')
        .eq('id', 'main')
        .single();

      // Calculate days together
      let daysTogether = 0;
      if (relationshipData?.first_date) {
        const firstDate = new Date(relationshipData.first_date);
        const today = new Date();
        daysTogether = Math.floor((today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Fetch actual counts from tables (team totals)
      const [
        quizAnswersRes,
        quizCorrectRes,
        mysteriesRes,
        gratitudeRes,
        memoriesRes,
        promptsRes,
        mediaRes,
        placesRes,
        bookRes,
      ] = await Promise.all([
        supabase.from('quiz_answers').select('id', { count: 'exact', head: true }),
        supabase.from('quiz_answers').select('id', { count: 'exact', head: true }).eq('is_correct', true),
        supabase.from('mystery_sessions').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('gratitude_notes').select('id', { count: 'exact', head: true }),
        supabase.from('memories').select('id', { count: 'exact', head: true }),
        supabase.from('prompt_responses').select('id', { count: 'exact', head: true }),
        supabase.from('media_items').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('map_places').select('id', { count: 'exact', head: true }).or('daniel_status.eq.visited,huaiyao_status.eq.visited'),
        supabase.from('book_sentences').select('id', { count: 'exact', head: true }),
      ]);

      // Build stats object with team data
      const statsData: StatsData = {
        days_together: daysTogether,
        stats: {
          first_date: relationshipData?.first_date || null,
          quiz_questions_answered: quizAnswersRes.count || 0,
          mysteries_completed: mysteriesRes.count || 0,
          dates_completed: 0,
          gratitude_notes_sent: gratitudeRes.count || 0,
          memories_created: memoriesRes.count || 0,
          prompts_answered: promptsRes.count || 0,
          media_completed: mediaRes.count || 0,
          places_visited: placesRes.count || 0,
          book_sentences: bookRes.count || 0,
        },
        team_stats: {
          quiz_correct: quizCorrectRes.count || 0,
          gratitude_sent: gratitudeRes.count || 0,
          memories_created: memoriesRes.count || 0,
          prompts_answered: promptsRes.count || 0,
          places_visited: placesRes.count || 0,
        },
        recent_achievements: null,
      };

      setStats(statsData);

      // Try to get team achievements (may fail if RPC doesn't exist)
      try {
        const achievementsRes = await supabase.rpc('get_team_achievements');
        if (!achievementsRes.error) {
          setAchievements(achievementsRes.data);
        }
      } catch {
        // Achievements RPC not available
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const [savingDate, setSavingDate] = useState(false);

  const handleSetFirstDate = async () => {
    if (!firstDate) return;

    setSavingDate(true);

    try {
      const { error } = await supabase
        .from('relationship_stats')
        .upsert({ id: 'main', first_date: firstDate }, { onConflict: 'id' });

      if (error) {
        alert(`Failed to save: ${error.message}`);
        setSavingDate(false);
        return;
      }

      setShowSetDate(false);
      setSavingDate(false);
      fetchData();
    } catch (error) {
      alert(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setSavingDate(false);
    }
  };

  const formatDaysTogether = (days: number) => {
    if (days < 30) return `${days} days`;
    if (days < 365) {
      const months = Math.floor(days / 30);
      const remainingDays = days % 30;
      return `${months} month${months !== 1 ? 's' : ''}${remainingDays > 0 ? `, ${remainingDays} days` : ''}`;
    }
    const years = Math.floor(days / 365);
    const remainingDays = days % 365;
    const months = Math.floor(remainingDays / 30);
    return `${years} year${years !== 1 ? 's' : ''}${months > 0 ? `, ${months} month${months !== 1 ? 's' : ''}` : ''}`;
  };

  const filteredAchievements = achievements?.achievements.filter(
    (a) => !filterCategory || a.category === filterCategory
  );

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50 dark:from-gray-900 dark:to-amber-950 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-amber-50 dark:from-gray-900 dark:to-amber-950">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-gray-800/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <h1 className="text-2xl font-bold dark:text-white">Stats & Achievements</h1>
            </div>
            <ThemeToggle />
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'overview'
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('achievements')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'achievements'
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Achievements
              {achievements && (
                <span className="ml-2 text-sm opacity-70">
                  {achievements.unlocked_count}/{achievements.total_count}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' ? (
            <motion.div
              key="overview"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              {/* Days Together Hero */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-8 text-white text-center shadow-xl"
              >
                {stats?.stats.first_date ? (
                  <>
                    <div className="text-6xl font-bold mb-2">{stats.days_together}</div>
                    <div className="text-xl opacity-90">Days Together</div>
                    <div className="text-sm opacity-70 mt-2">
                      {formatDaysTogether(stats.days_together)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-4xl mb-4">💕</div>
                    <div className="text-xl mb-4">Set your first date to start counting!</div>
                    <button
                      onClick={() => setShowSetDate(true)}
                      className="px-6 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                    >
                      Set First Date
                    </button>
                  </>
                )}
              </motion.div>

              {/* Team Progress */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg"
              >
                <h3 className="text-lg font-bold dark:text-white mb-4 flex items-center gap-2">
                  <span>💕</span> Our Journey Together
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl">
                    <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                      {stats?.team_stats.quiz_correct || 0}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Quiz Questions Aced</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20 rounded-xl">
                    <div className="text-3xl font-bold text-rose-600 dark:text-rose-400">
                      {stats?.team_stats.gratitude_sent || 0}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Love Notes Shared</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl">
                    <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                      {stats?.team_stats.memories_created || 0}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Memories Captured</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-900/20 dark:to-cyan-900/20 rounded-xl">
                    <div className="text-3xl font-bold text-teal-600 dark:text-teal-400">
                      {stats?.team_stats.places_visited || 0}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">Places Explored</div>
                  </div>
                </div>
              </motion.div>

              {/* Recent Achievements */}
              {stats?.recent_achievements && stats.recent_achievements.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg"
                >
                  <h3 className="text-lg font-bold dark:text-white mb-4">Recent Achievements</h3>
                  <div className="space-y-3">
                    {stats.recent_achievements.map((achievement, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                      >
                        <span className="text-2xl">{achievement.emoji}</span>
                        <div className="flex-1">
                          <div className="font-medium dark:text-white">{achievement.title}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {new Date(achievement.unlocked_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Activity Stats Grid */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="grid grid-cols-2 sm:grid-cols-4 gap-4"
              >
                {[
                  { label: 'Quiz Q&As', value: stats?.stats.quiz_questions_answered || 0, emoji: '🧠' },
                  { label: 'Mysteries Solved', value: stats?.stats.mysteries_completed || 0, emoji: '🔍' },
                  { label: 'Prompts Answered', value: stats?.stats.prompts_answered || 0, emoji: '💬' },
                  { label: 'Story Sentences', value: stats?.stats.book_sentences || 0, emoji: '📖' },
                  { label: 'Media Finished', value: stats?.stats.media_completed || 0, emoji: '🎬' },
                  { label: 'Memories', value: stats?.stats.memories_created || 0, emoji: '📸' },
                  { label: 'Gratitude Notes', value: stats?.stats.gratitude_notes_sent || 0, emoji: '💝' },
                  { label: 'Places Visited', value: stats?.stats.places_visited || 0, emoji: '🗺️' },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow text-center"
                  >
                    <div className="text-2xl mb-1">{stat.emoji}</div>
                    <div className="text-2xl font-bold dark:text-white">{stat.value}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</div>
                  </div>
                ))}
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              key="achievements"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Team Points Summary */}
              <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl p-6 text-white text-center">
                <div className="text-4xl font-bold">{achievements?.total_points || 0}</div>
                <div className="opacity-90">Team Points</div>
                <div className="mt-2 text-sm opacity-70">
                  {achievements?.unlocked_count || 0} of {achievements?.total_count || 0} achievements unlocked together
                </div>
              </div>

              {/* Category Filters */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setFilterCategory(null)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    filterCategory === null
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  All
                </button>
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => setFilterCategory(key)}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      filterCategory === key
                        ? 'bg-amber-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {config.label}
                  </button>
                ))}
              </div>

              {/* Achievements List */}
              <div className="grid gap-3">
                {filteredAchievements?.map((achievement, index) => (
                  <motion.div
                    key={achievement.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow flex items-center gap-4 ${
                      !achievement.unlocked ? 'opacity-60' : ''
                    }`}
                  >
                    <div
                      className={`text-4xl ${
                        achievement.unlocked ? '' : 'grayscale'
                      }`}
                    >
                      {achievement.unlocked ? achievement.emoji : '🔒'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold dark:text-white">{achievement.title}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs ${CATEGORY_CONFIG[achievement.category]?.color}`}>
                          {CATEGORY_CONFIG[achievement.category]?.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {achievement.description}
                      </p>
                      {achievement.unlocked && achievement.unlocked_at && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          Unlocked {new Date(achievement.unlocked_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${achievement.unlocked ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}`}>
                        +{achievement.points}
                      </div>
                      <div className="text-xs text-gray-400">pts</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Set First Date Modal */}
      <AnimatePresence>
        {showSetDate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setShowSetDate(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6"
            >
              <h2 className="text-2xl font-bold mb-4 dark:text-white">Set Your First Date</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                When did your journey together begin?
              </p>
              <input
                type="date"
                value={firstDate}
                onChange={(e) => setFirstDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent dark:bg-gray-700 dark:text-white mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSetDate(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSetFirstDate}
                  disabled={!firstDate || savingDate}
                  className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg font-medium disabled:opacity-50 hover:bg-amber-600 transition-colors"
                >
                  {savingDate ? 'Saving...' : 'Save'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
