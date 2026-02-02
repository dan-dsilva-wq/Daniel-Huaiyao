'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ThemeToggle } from './components/ThemeToggle';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface AppCardProps {
  title: string;
  description: string;
  icon: string;
  href: string;
  gradient: string;
  badge?: string;
  visitCount?: number;
  onVisit?: () => void;
}

function AppCard({ title, description, icon, href, gradient, badge, visitCount, onVisit }: AppCardProps) {
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02, y: -4 }}
      whileTap={{ scale: 0.98 }}
      className={`
        relative overflow-hidden rounded-2xl p-5 sm:p-8
        bg-gradient-to-br ${gradient}
        shadow-lg hover:shadow-xl transition-shadow
        flex flex-col gap-3 sm:gap-4 min-h-[160px] sm:min-h-[200px]
        active:scale-[0.98] touch-manipulation
      `}
    >
      {badge && (
        <div className="absolute top-3 right-3 px-2 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs font-medium text-white">
          {badge}
        </div>
      )}
      <motion.div
        className="text-5xl sm:text-6xl"
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {icon}
      </motion.div>
      <div>
        <h2 className="text-xl sm:text-2xl font-serif font-semibold text-white mb-2">
          {title}
        </h2>
        <p className="text-white/80 text-sm sm:text-base">
          {description}
        </p>
      </div>
      <div className="absolute bottom-4 right-4 text-white/40">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
      </div>
    </motion.a>
  );
}

const apps: Omit<AppCardProps, 'visitCount' | 'onVisit'>[] = [
  {
    title: 'Story Book',
    description: 'Writing a story together, one sentence at a time',
    icon: '📖',
    href: 'https://daniel-huaiyao-book.vercel.app',
    gradient: 'from-amber-600 to-orange-700',
  },
  {
    title: 'Date Ideas',
    description: 'Track our bucket list of things to do',
    icon: '✨',
    href: '/dates',
    gradient: 'from-purple-500 to-pink-500',
  },
  {
    title: 'Hive',
    description: 'The buzzing strategy board game',
    icon: '🐝',
    href: 'https://daniel-huaiyao-hive.vercel.app',
    gradient: 'from-yellow-500 to-amber-600',
  },
  {
    title: 'Quiz Time',
    description: 'How well do you know each other?',
    icon: '🧠',
    href: '/quiz',
    gradient: 'from-indigo-500 to-purple-600',
  },
  {
    title: 'Mystery Files',
    description: 'Solve mysteries together',
    icon: '🔍',
    href: '/mystery',
    gradient: 'from-purple-900 to-slate-900',
  },
  {
    title: 'Countdown',
    description: 'Track important dates and anniversaries',
    icon: '⏰',
    href: '/countdown',
    gradient: 'from-amber-500 to-rose-500',
  },
  {
    title: 'Gratitude Wall',
    description: 'Leave little notes of appreciation',
    icon: '💝',
    href: '/gratitude',
    gradient: 'from-rose-400 to-pink-500',
  },
  {
    title: 'Daily Prompts',
    description: 'Daily questions to connect deeper',
    icon: '💬',
    href: '/prompts',
    gradient: 'from-cyan-500 to-teal-500',
  },
  {
    title: 'Media Tracker',
    description: 'Movies, shows, books to enjoy together',
    icon: '🎬',
    href: '/media',
    gradient: 'from-violet-500 to-fuchsia-500',
  },
  {
    title: 'Memories',
    description: 'Our timeline of special moments',
    icon: '📸',
    href: '/memories',
    gradient: 'from-pink-500 to-rose-600',
  },
  {
    title: 'Stats & Achievements',
    description: 'Track your progress and unlock badges',
    icon: '🏆',
    href: '/stats',
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    title: 'Our Map',
    description: 'Places we want to go and have been',
    icon: '🗺️',
    href: '/map',
    gradient: 'from-teal-500 to-cyan-500',
  },
];

export default function Home() {
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  const [mounted, setMounted] = useState(false);
  const [showUnused, setShowUnused] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);

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
  }, []);

  // Separate apps into used (visited in last 30 days) and unused
  const { usedApps, unusedApps } = useMemo(() => {
    if (!mounted) return { usedApps: apps, unusedApps: [] };

    const used: typeof apps = [];
    const unused: typeof apps = [];

    apps.forEach(app => {
      if ((visitCounts[app.title] || 0) > 0) {
        used.push(app);
      } else {
        unused.push(app);
      }
    });

    // Sort used apps by visit count (descending)
    used.sort((a, b) => {
      const countA = visitCounts[a.title] || 0;
      const countB = visitCounts[b.title] || 0;
      return countB - countA;
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
        </motion.div>

        {/* Main Apps (used in last 30 days) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-6"
        >
          {(hasAnyVisits ? usedApps : apps).map((app, index) => (
            <motion.div
              key={app.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + index * 0.05 }}
              layout
            >
              <AppCard
                {...app}
                visitCount={visitCounts[app.title] || 0}
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
                className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4"
              >
                {unusedApps.map((app, index) => (
                  <motion.a
                    key={app.title}
                    href={app.href}
                    target={app.href.startsWith('http') ? '_blank' : undefined}
                    rel={app.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                    onClick={() => handleVisit(app.title)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-3 p-3 bg-gray-100 dark:bg-gray-800/50 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors opacity-60 hover:opacity-100"
                  >
                    <span className="text-2xl">{app.icon}</span>
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-400 truncate">
                      {app.title}
                    </span>
                  </motion.a>
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
    </div>
  );
}
