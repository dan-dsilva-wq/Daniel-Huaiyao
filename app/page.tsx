'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeToggle } from './components/ThemeToggle';
import { FeedbackChat } from './components/FeedbackChat';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface AppCardProps {
  title: string;
  description: string;
  icon: string;
  href: string;
  gradient: string;
  badge?: string;
  newCount?: number;
  onVisit?: () => void;
}

interface MemoryFlashback {
  id: string;
  title: string;
  description: string | null;
  memory_date: string;
  years_ago: number;
  photo_url: string | null;
  memory_type: string;
  location_name: string | null;
}

interface PartnerActivity {
  id: string;
  action_type: string;
  action_title: string | null;
  app_name: string;
  created_at: string;
}

interface SharedStreak {
  current_streak: number;
  longest_streak: number;
  last_both_active: string | null;
  daniel_checked_in_today: boolean;
  huaiyao_checked_in_today: boolean;
}

interface PartnerPresence {
  is_online: boolean;
  last_seen: string | null;
  current_app: string | null;
}

interface PartnerWatching {
  media_id: string;
  title: string;
  media_type: string;
  started_at: string;
}

interface EngagementData {
  flashbacks: MemoryFlashback[];
  partner_activity: PartnerActivity[];
  shared_streak: SharedStreak | null;
  partner_presence: PartnerPresence | null;
  partner_watching: PartnerWatching[];
}

function AppCard({ title, icon, href, gradient, newCount, onVisit }: AppCardProps) {
  const isExternal = href.startsWith('http');

  const handleClick = () => {
    onVisit?.();
  };

  return (
    <motion.a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      onClick={handleClick}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={`
        relative overflow-hidden rounded-2xl
        bg-gradient-to-br ${gradient}
        shadow-lg hover:shadow-xl transition-shadow
        flex flex-col items-center justify-center
        aspect-square
        active:scale-95 touch-manipulation
      `}
    >
      {/* New content indicator */}
      {(newCount ?? 0) > 0 && (
        <div className="absolute top-1.5 right-1.5">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
        </div>
      )}
      <motion.div
        className="text-4xl sm:text-5xl mb-2"
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {icon}
      </motion.div>
      <h2 className="text-sm sm:text-base font-medium text-white text-center px-2 leading-tight">
        {title}
      </h2>
    </motion.a>
  );
}

// Apps in logical order (not sorted by usage)
const apps: Omit<AppCardProps, 'visitCount' | 'onVisit'>[] = [
  // Daily connection
  {
    title: 'Quiz Time',
    description: 'How well do you know each other?',
    icon: '🧠',
    href: '/quiz',
    gradient: 'from-indigo-500 to-purple-600',
  },
  {
    title: 'Daily Prompts',
    description: 'Daily questions to connect deeper',
    icon: '💬',
    href: '/prompts',
    gradient: 'from-cyan-500 to-teal-500',
  },
  {
    title: 'Gratitude Wall',
    description: 'Leave little notes of appreciation',
    icon: '💝',
    href: '/gratitude',
    gradient: 'from-rose-400 to-pink-500',
  },
  // Planning & tracking
  {
    title: 'Date Ideas',
    description: 'Track our bucket list of things to do',
    icon: '✨',
    href: '/dates',
    gradient: 'from-purple-500 to-pink-500',
  },
  {
    title: 'Countdown',
    description: 'Track important dates and anniversaries',
    icon: '⏰',
    href: '/countdown',
    gradient: 'from-amber-500 to-rose-500',
  },
  {
    title: 'Memories',
    description: 'Our timeline of special moments',
    icon: '📸',
    href: '/memories',
    gradient: 'from-pink-500 to-rose-600',
  },
  {
    title: 'Our Map',
    description: 'Places we want to go and have been',
    icon: '🗺️',
    href: '/map',
    gradient: 'from-teal-500 to-cyan-500',
  },
  // Entertainment
  {
    title: 'Media Tracker',
    description: 'Movies, shows, books to enjoy together',
    icon: '🎬',
    href: '/media',
    gradient: 'from-violet-500 to-fuchsia-500',
  },
  {
    title: 'Story Book',
    description: 'Writing a story together, one sentence at a time',
    icon: '📖',
    href: '/book',
    gradient: 'from-amber-600 to-orange-700',
  },
  {
    title: 'Mystery Files',
    description: 'Solve mysteries together',
    icon: '🔍',
    href: '/mystery',
    gradient: 'from-purple-900 to-slate-900',
  },
  {
    title: 'Hive',
    description: 'The buzzing strategy board game',
    icon: '🐝',
    href: '/hive',
    gradient: 'from-yellow-500 to-amber-600',
  },
  // Together games
  {
    title: 'Two Truths & a Lie',
    description: 'Write two truths and one lie - spot the lie!',
    icon: '🤥',
    href: '/two-truths',
    gradient: 'from-violet-500 to-purple-600',
  },
  // Stats
  {
    title: 'Stats',
    description: 'Track your progress and unlock badges',
    icon: '🏆',
    href: '/stats',
    gradient: 'from-amber-500 to-orange-600',
  },
];

export default function Home() {
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  const [newCounts, setNewCounts] = useState<Record<string, number>>({});
  const [mounted, setMounted] = useState(false);
  const [showUnused, setShowUnused] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [engagementData, setEngagementData] = useState<EngagementData | null>(null);
  const [showActivityFeed, setShowActivityFeed] = useState(false);
  const [showFeedbackChat, setShowFeedbackChat] = useState(false);

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  // Fetch visit counts from Supabase
  const fetchVisitCounts = async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase.rpc('get_app_visit_counts');
      if (!error && data) {
        setVisitCounts(data as Record<string, number>);
      }
    } catch (err) {
      console.error('Error fetching visit counts:', err);
    }
  };

  // Fetch new item counts for badge display
  const fetchNewCounts = async (user: string) => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase.rpc('get_new_item_counts', { p_user_name: user });
      if (!error && data) {
        setNewCounts(data as Record<string, number>);
      }
    } catch (err) {
      console.error('Error fetching new counts:', err);
    }
  };

  // Fetch all engagement data
  const fetchEngagementData = useCallback(async (user: string) => {
    if (!isSupabaseConfigured) return;
    try {
      const { data, error } = await supabase.rpc('get_home_engagement_data', { p_player: user });
      if (!error && data && data[0]) {
        setEngagementData({
          flashbacks: data[0].flashbacks || [],
          partner_activity: data[0].partner_activity || [],
          shared_streak: data[0].shared_streak || null,
          partner_presence: data[0].partner_presence || null,
          partner_watching: data[0].partner_watching || [],
        });
      }
    } catch (err) {
      console.error('Error fetching engagement data:', err);
    }
  }, []);

  // Record check-in and update presence
  const recordCheckIn = useCallback(async (user: string) => {
    if (!isSupabaseConfigured) return;
    try {
      await supabase.rpc('record_check_in', { p_player: user });
      await supabase.rpc('update_presence', { p_player: user, p_is_online: true, p_current_app: 'home' });
    } catch (err) {
      console.error('Error recording check-in:', err);
    }
  }, []);

  // Record a visit to Supabase
  const recordVisit = async (appTitle: string) => {
    if (!isSupabaseConfigured) return;
    try {
      await supabase.rpc('record_app_visit', {
        p_app_name: appTitle,
        p_visited_by: currentUser || null,
      });
      // Optimistically update local count
      setVisitCounts(prev => ({
        ...prev,
        [appTitle]: (prev[appTitle] || 0) + 1,
      }));
    } catch (err) {
      console.error('Error recording visit:', err);
    }
  };

  useEffect(() => {
    setMounted(true);
    const savedUser = localStorage.getItem('currentUser');
    setCurrentUser(savedUser);
    fetchVisitCounts();
    if (savedUser) {
      fetchNewCounts(savedUser);
      fetchEngagementData(savedUser);
      recordCheckIn(savedUser);
    }
  }, [fetchEngagementData, recordCheckIn]);

  // Separate apps into used (visited in last 30 days) and unused - keep original order
  const { usedApps, unusedApps } = useMemo(() => {
    if (!mounted) return { usedApps: apps, unusedApps: [] };

    const used: typeof apps = [];
    const unused: typeof apps = [];

    // Maintain the original logical order from the apps array
    apps.forEach(app => {
      if ((visitCounts[app.title] || 0) > 0) {
        used.push(app);
      } else {
        unused.push(app);
      }
    });

    return { usedApps: used, unusedApps: unused };
  }, [visitCounts, mounted]);

  const handleVisit = (appTitle: string) => {
    recordVisit(appTitle);
  };

  // Check if any app has been visited
  const hasAnyVisits = usedApps.length > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      {/* Theme Toggle */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      {/* Subtle background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-100/40 dark:bg-amber-900/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.1, 1],
            x: [0, 20, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-slate-200/40 dark:bg-slate-700/20 rounded-full blur-3xl"
          animate={{
            scale: [1.1, 1, 1.1],
            x: [0, -20, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 sm:mb-16"
        >
          <motion.div
            className="text-5xl sm:text-6xl mb-6"
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          >
            👋
          </motion.div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
            Daniel & Huaiyao
          </h1>
          <p className="text-lg sm:text-xl text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Some fun stuff we made
          </p>

          {/* Partner Status Indicator */}
          {currentUser && engagementData?.partner_presence && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center justify-center gap-2"
            >
              <div className="flex items-center gap-2 px-4 py-2 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-full shadow-sm">
                <div className="relative">
                  <motion.div
                    animate={engagementData.partner_presence.is_online ? { scale: [1, 1.2, 1] } : {}}
                    transition={{ duration: 2, repeat: Infinity }}
                    className={`w-2.5 h-2.5 rounded-full ${
                      engagementData.partner_presence.is_online
                        ? 'bg-green-500'
                        : 'bg-gray-400'
                    }`}
                  />
                  {engagementData.partner_presence.is_online && (
                    <motion.div
                      animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-500"
                    />
                  )}
                </div>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {partnerName} is {engagementData.partner_presence.is_online ? 'online' : 'away'}
                  {engagementData.partner_presence.is_online && engagementData.partner_presence.current_app && (
                    <span className="text-gray-400 dark:text-gray-500"> ({engagementData.partner_presence.current_app})</span>
                  )}
                </span>
              </div>
            </motion.div>
          )}
        </motion.div>

        {/* Engagement Section */}
        {currentUser && engagementData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-8 space-y-4"
          >
            {/* Memory Flashbacks ("On This Day") */}
            {engagementData.flashbacks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl p-4 text-white shadow-lg"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">📸</span>
                  <span className="font-medium">On this day...</span>
                </div>
                <div className="space-y-2">
                  {engagementData.flashbacks.slice(0, 3).map((flashback) => (
                    <a
                      key={flashback.id}
                      href="/memories"
                      className="flex items-center gap-3 p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-colors"
                    >
                      {flashback.photo_url ? (
                        <img
                          src={flashback.photo_url}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center text-xl">
                          {flashback.memory_type === 'milestone' ? '🏆' : flashback.memory_type === 'photo' ? '📷' : '✨'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{flashback.title}</div>
                        <div className="text-sm opacity-80">{flashback.years_ago} year{flashback.years_ago !== 1 ? 's' : ''} ago</div>
                      </div>
                    </a>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Activity Feed Toggle */}
            {engagementData.partner_activity.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <button
                  onClick={() => setShowActivityFeed(!showActivityFeed)}
                  className="w-full flex items-center justify-between p-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-2xl shadow-sm hover:bg-white dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span>👀</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      What {partnerName}&apos;s been up to
                    </span>
                  </div>
                  <span className={`text-gray-400 transition-transform ${showActivityFeed ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </button>

                <AnimatePresence>
                  {showActivityFeed && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 space-y-2">
                        {engagementData.partner_activity.map((activity) => (
                          <a
                            key={activity.id}
                            href={`/${activity.app_name}`}
                            className="flex items-center gap-3 p-3 bg-white/60 dark:bg-gray-800/60 backdrop-blur rounded-xl hover:bg-white dark:hover:bg-gray-800 transition-colors"
                          >
                            <span className="text-xl">
                              {activity.action_type === 'gratitude_sent' ? '💝' :
                               activity.action_type === 'memory_added' ? '📸' :
                               activity.action_type === 'question_answered' ? '🧠' :
                               activity.action_type === 'book_sentence' ? '📖' :
                               activity.action_type === 'media_added' ? '🎬' :
                               activity.action_type === 'place_added' ? '🗺️' : '✨'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-800 dark:text-gray-200">
                                {activity.action_type === 'gratitude_sent' && 'Left you a note'}
                                {activity.action_type === 'memory_added' && `Added a memory${activity.action_title ? `: ${activity.action_title}` : ''}`}
                                {activity.action_type === 'question_answered' && 'Answered your quiz question'}
                                {activity.action_type === 'book_sentence' && 'Added to your story'}
                                {activity.action_type === 'media_added' && `Added ${activity.action_title || 'media'}`}
                                {activity.action_type === 'place_added' && `Added ${activity.action_title || 'a place'}`}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {new Date(activity.created_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit'
                                })}
                              </div>
                            </div>
                          </a>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Main Apps (used in last 30 days) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-3 sm:grid-cols-4 gap-3 sm:gap-4"
        >
          {(hasAnyVisits ? usedApps : apps).map((app, index) => (
            <motion.div
              key={app.title}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 + index * 0.03 }}
              layout
            >
              <AppCard
                {...app}
                newCount={newCounts[app.title]}
                onVisit={() => handleVisit(app.title)}
              />
            </motion.div>
          ))}
        </motion.div>

        {/* Unused Apps Section */}
        {hasAnyVisits && unusedApps.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-16"
          >
            <button
              onClick={() => setShowUnused(!showUnused)}
              className="w-full flex items-center justify-center gap-2 py-3 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
            >
              <span>{showUnused ? '▼' : '▶'}</span>
              <span>Unused apps ({unusedApps.length})</span>
            </button>

            {showUnused && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-3 sm:grid-cols-4 gap-3 sm:gap-4 mt-4"
              >
                {unusedApps.map((app, index) => (
                  <motion.div
                    key={app.title}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.03 }}
                    className="opacity-50 hover:opacity-100 transition-opacity"
                  >
                    <AppCard
                      {...app}
                      newCount={newCounts[app.title]}
                      onVisit={() => handleVisit(app.title)}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-center mt-16 text-gray-400 dark:text-gray-500 text-sm"
        >
          <p>Built for fun</p>
        </motion.footer>
      </main>

      {/* Feedback button - visible to both for now (normally just Huaiyao) */}
      {currentUser && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowFeedbackChat(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-full shadow-lg flex items-center justify-center hover:shadow-xl transition-shadow"
          title="Tell Daniel something"
        >
          <span className="text-2xl">💬</span>
        </motion.button>
      )}

      {/* Feedback Chat Modal */}
      <FeedbackChat isOpen={showFeedbackChat} onClose={() => setShowFeedbackChat(false)} />
    </div>
  );
}
