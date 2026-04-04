'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeToggle } from './components/ThemeToggle';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface AppCardProps {
  title: string;
  description: string;
  icon: string;
  href?: string;
  gradient: string;
  badge?: string;
  newCount?: number;
  onVisit?: () => void;
}

interface Section {
  title: string;
  caption: string;
  apps: AppCardProps[];
}

interface SearchResult {
  id: string;
  appTitle: string;
  title: string;
  description: string;
  href: string;
  icon: string;
}

interface ActivityItem {
  id: string;
  appTitle: string;
  summary: string;
  timestamp: string;
}

interface FeedItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  icon: string;
}

interface CountdownThemeEvent {
  id: string;
  title: string;
  event_date: string;
  is_recurring: boolean;
  emoji: string | null;
  category: string | null;
}

interface HomeTheme {
  id: string;
  icon: string;
  kicker: string;
  headline: string;
  subheading: string;
  pageGradient: string;
  glowPrimary: string;
  glowSecondary: string;
  heroCard: string;
  badge: string;
}

interface SeasonalMode {
  id: 'christmas' | 'halloween' | 'easter';
  icon: string;
  label: string;
  headline: string;
  subheading: string;
  pageGradient: string;
  glowPrimary: string;
  glowSecondary: string;
  heroCard: string;
  searchCard: string;
  sectionCard: string;
  decorations: string[];
  collectibleIcon: string;
  collectibleLabel: string;
  collectibleCount: number;
}

const sections: Section[] = [
  {
    title: 'Daily Connection',
    caption: 'Quick ways to check in with each other.',
    apps: [
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
    ],
  },
  {
    title: 'Planning',
    caption: 'Things to do and dates to look forward to.',
    apps: [
      {
        title: 'Date Ideas',
        description: 'Track your bucket list together',
        icon: '✨',
        href: '/dates',
        gradient: 'from-purple-500 to-amber-500',
      },
      {
        title: 'Count Down',
        description: 'Track important dates and anniversaries',
        icon: '⏰',
        href: '/countdown',
        gradient: 'from-amber-500 to-rose-500',
      },
    ],
  },
  {
    title: 'Games',
    caption: 'A tighter set of things to play together.',
    apps: [
      {
        title: 'Stratego',
        description: 'A home for the next battle',
        icon: '♟️',
        href: '/stratego',
        gradient: 'from-stone-700 to-slate-900',
        badge: 'New',
      },
      {
        title: 'Mystery Files',
        description: 'Solve mysteries together',
        icon: '🔍',
        href: '/mystery',
        gradient: 'from-purple-900 to-slate-900',
      },
      {
        title: 'Story Book',
        description: 'Writing a story together, one sentence at a time',
        icon: '📖',
        href: '/book',
        gradient: 'from-amber-600 to-orange-700',
      },
      {
        title: 'Hive',
        description: 'The buzzing strategy board game',
        icon: '🐝',
        href: '/hive',
        gradient: 'from-yellow-500 to-amber-600',
      },
      {
        title: 'Quiz Time',
        description: 'How well do you know each other?',
        icon: '🧠',
        href: '/quiz',
        gradient: 'from-indigo-500 to-purple-600',
      },
    ],
  },
  {
    title: 'Memories',
    caption: 'Places and moments worth keeping.',
    apps: [
      {
        title: 'Map',
        description: 'Places you want to go and have been',
        icon: '🗺️',
        href: '/map',
        gradient: 'from-sky-500 to-teal-500',
      },
      {
        title: 'Memories',
        description: 'A timeline of special moments',
        icon: '📸',
        href: '/memories',
        gradient: 'from-purple-500 to-pink-500',
      },
    ],
  },
];

const archivedApps = [
  'Two Truths and a Lie',
  'Media Tracker',
  'Morse Keep',
  'Scheduler',
  'Stats',
];

const THEME_KEYWORDS = {
  birthday: ['birthday', 'bday', 'turning', 'cake', 'born'],
  anniversary: ['anniversary', 'monthiversary', 'our day', 'together', 'dating', 'met', 'first date'],
  milestone: ['milestone', 'graduation', 'promotion', 'new job', 'visa', 'move', 'moving', 'launch', 'achievement', 'passed', 'pass', 'finished'],
  party: ['party', 'celebration', 'celebrate', 'dinner party', 'surprise party', 'toast'],
  gameNight: ['game night', 'board game', 'boardgames', 'cards night', 'quiz night', 'stratego', 'hive', 'mystery night'],
  weekend: ['weekend', 'brunch', 'saturday', 'sunday', 'staycation', 'picnic', 'movie night', 'date night', 'coffee date'],
  trip: ['trip', 'flight', 'holiday', 'vacation', 'travel', 'getaway', 'hotel', 'beach', 'train', 'airport'],
};

const HOME_THEMES: Record<string, HomeTheme> = {
  default: {
    id: 'default',
    icon: '👋',
    kicker: 'Home',
    headline: 'Daniel & Huaiyao',
    subheading: 'A lighter home for the things you actually use.',
    pageGradient: 'bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900',
    glowPrimary: 'bg-amber-100/40 dark:bg-amber-900/20',
    glowSecondary: 'bg-slate-200/40 dark:bg-slate-700/20',
    heroCard: 'border-white/60 bg-white/72 dark:border-gray-700 dark:bg-gray-800/72',
    badge: 'A quiet day',
  },
  birthday: {
    id: 'birthday',
    icon: '🎂',
    kicker: 'Today',
    headline: 'Birthday Mode',
    subheading: 'The home screen shifts into something sweeter when there is a birthday today.',
    pageGradient: 'bg-gradient-to-br from-rose-50 via-amber-50 to-pink-100 dark:from-rose-950 dark:via-slate-900 dark:to-pink-950',
    glowPrimary: 'bg-pink-200/45 dark:bg-pink-800/25',
    glowSecondary: 'bg-amber-200/45 dark:bg-amber-800/20',
    heroCard: 'border-rose-200/70 bg-white/78 dark:border-rose-900/60 dark:bg-rose-950/30',
    badge: 'Birthday today',
  },
  anniversary: {
    id: 'anniversary',
    icon: '💞',
    kicker: 'Today',
    headline: 'Anniversary Energy',
    subheading: 'A softer home screen for a day that matters more than usual.',
    pageGradient: 'bg-gradient-to-br from-rose-50 via-pink-50 to-stone-100 dark:from-rose-950 dark:via-slate-900 dark:to-zinc-950',
    glowPrimary: 'bg-rose-200/40 dark:bg-rose-800/25',
    glowSecondary: 'bg-pink-200/35 dark:bg-pink-900/20',
    heroCard: 'border-rose-200/70 bg-white/78 dark:border-rose-900/60 dark:bg-rose-950/28',
    badge: 'Anniversary today',
  },
  milestone: {
    id: 'milestone',
    icon: '🏆',
    kicker: 'Today',
    headline: 'Milestone Day',
    subheading: 'A little more glow for something worth marking properly.',
    pageGradient: 'bg-gradient-to-br from-amber-50 via-stone-50 to-orange-100 dark:from-amber-950 dark:via-slate-900 dark:to-zinc-950',
    glowPrimary: 'bg-amber-200/45 dark:bg-amber-800/22',
    glowSecondary: 'bg-orange-200/35 dark:bg-orange-900/18',
    heroCard: 'border-amber-200/70 bg-white/78 dark:border-amber-900/60 dark:bg-amber-950/24',
    badge: 'Milestone today',
  },
  party: {
    id: 'party',
    icon: '🎉',
    kicker: 'Today',
    headline: 'Party Mood',
    subheading: 'A brighter home screen for celebration-heavy days.',
    pageGradient: 'bg-gradient-to-br from-fuchsia-50 via-amber-50 to-rose-100 dark:from-fuchsia-950 dark:via-slate-900 dark:to-rose-950',
    glowPrimary: 'bg-fuchsia-200/40 dark:bg-fuchsia-800/22',
    glowSecondary: 'bg-amber-200/40 dark:bg-amber-800/18',
    heroCard: 'border-fuchsia-200/70 bg-white/78 dark:border-fuchsia-900/60 dark:bg-fuchsia-950/24',
    badge: 'Celebration today',
  },
  gameNight: {
    id: 'gameNight',
    icon: '🎲',
    kicker: 'Today',
    headline: 'Game Night',
    subheading: 'The home screen leans playful when the plan is to stay in and compete a little.',
    pageGradient: 'bg-gradient-to-br from-indigo-50 via-slate-50 to-violet-100 dark:from-indigo-950 dark:via-slate-900 dark:to-violet-950',
    glowPrimary: 'bg-indigo-200/35 dark:bg-indigo-800/24',
    glowSecondary: 'bg-violet-200/35 dark:bg-violet-800/18',
    heroCard: 'border-indigo-200/70 bg-white/78 dark:border-indigo-900/60 dark:bg-indigo-950/28',
    badge: 'Game night today',
  },
  weekend: {
    id: 'weekend',
    icon: '☀️',
    kicker: 'Today',
    headline: 'Weekend Plans',
    subheading: 'A lighter tone for brunches, dates, movie nights, and easy plans.',
    pageGradient: 'bg-gradient-to-br from-sky-50 via-stone-50 to-emerald-100 dark:from-sky-950 dark:via-slate-900 dark:to-emerald-950',
    glowPrimary: 'bg-sky-200/35 dark:bg-sky-800/22',
    glowSecondary: 'bg-emerald-200/35 dark:bg-emerald-800/18',
    heroCard: 'border-sky-200/70 bg-white/78 dark:border-sky-900/60 dark:bg-sky-950/22',
    badge: 'Plan for today',
  },
  trip: {
    id: 'trip',
    icon: '✈️',
    kicker: 'Today',
    headline: 'Trip Day',
    subheading: 'The home screen shifts when the day is about going somewhere together.',
    pageGradient: 'bg-gradient-to-br from-cyan-50 via-slate-50 to-blue-100 dark:from-cyan-950 dark:via-slate-900 dark:to-blue-950',
    glowPrimary: 'bg-cyan-200/35 dark:bg-cyan-800/22',
    glowSecondary: 'bg-blue-200/35 dark:bg-blue-800/18',
    heroCard: 'border-cyan-200/70 bg-white/78 dark:border-cyan-900/60 dark:bg-cyan-950/22',
    badge: 'Trip today',
  },
  event: {
    id: 'event',
    icon: '✨',
    kicker: 'Today',
    headline: 'Today Has A Plan',
    subheading: 'The page picks up a little extra ceremony when something on the countdown lands today.',
    pageGradient: 'bg-gradient-to-br from-stone-50 via-amber-50 to-rose-50 dark:from-zinc-950 dark:via-slate-900 dark:to-stone-950',
    glowPrimary: 'bg-rose-200/30 dark:bg-rose-900/18',
    glowSecondary: 'bg-amber-200/35 dark:bg-amber-800/18',
    heroCard: 'border-stone-200/70 bg-white/78 dark:border-stone-800/70 dark:bg-zinc-900/60',
    badge: 'Event today',
  },
};

const SEASONAL_MODES: Record<SeasonalMode['id'], SeasonalMode> = {
  christmas: {
    id: 'christmas',
    icon: '🎄',
    label: 'Christmas',
    headline: 'Christmas At Home',
    subheading: 'The home screen gets a festive reset for the week around Christmas.',
    pageGradient: 'bg-gradient-to-br from-emerald-50 via-rose-50 to-stone-100 dark:from-emerald-950 dark:via-slate-950 dark:to-rose-950',
    glowPrimary: 'bg-emerald-200/40 dark:bg-emerald-800/24',
    glowSecondary: 'bg-rose-200/35 dark:bg-rose-800/20',
    heroCard: 'border-emerald-200/70 bg-white/82 dark:border-emerald-900/60 dark:bg-emerald-950/24',
    searchCard: 'border-emerald-100/70 bg-white/84 dark:border-emerald-900/60 dark:bg-slate-900/72',
    sectionCard: 'border-emerald-100/70 bg-white/82 dark:border-emerald-900/55 dark:bg-slate-900/62',
    decorations: ['❄️', '✨', '🎁', '🕯️'],
    collectibleIcon: '🎁',
    collectibleLabel: 'gifts',
    collectibleCount: 5,
  },
  halloween: {
    id: 'halloween',
    icon: '🎃',
    label: 'Halloween',
    headline: 'Halloween Mode',
    subheading: 'The home screen turns darker and more playful for Halloween week.',
    pageGradient: 'bg-gradient-to-br from-orange-50 via-stone-100 to-violet-100 dark:from-orange-950 dark:via-slate-950 dark:to-violet-950',
    glowPrimary: 'bg-orange-200/40 dark:bg-orange-800/24',
    glowSecondary: 'bg-violet-200/35 dark:bg-violet-800/22',
    heroCard: 'border-orange-200/70 bg-white/82 dark:border-orange-900/60 dark:bg-orange-950/24',
    searchCard: 'border-orange-100/70 bg-white/84 dark:border-orange-900/60 dark:bg-slate-900/72',
    sectionCard: 'border-orange-100/70 bg-white/82 dark:border-orange-900/55 dark:bg-slate-900/62',
    decorations: ['🎃', '🕸️', '🌙', '✨'],
    collectibleIcon: '🎃',
    collectibleLabel: 'pumpkins',
    collectibleCount: 5,
  },
  easter: {
    id: 'easter',
    icon: '🥚',
    label: 'Easter',
    headline: 'Easter Egg Hunt',
    subheading: 'The home screen softens for Easter and hides a few eggs to find.',
    pageGradient: 'bg-gradient-to-br from-amber-50 via-pink-50 to-sky-100 dark:from-amber-950 dark:via-slate-950 dark:to-sky-950',
    glowPrimary: 'bg-pink-200/38 dark:bg-pink-800/22',
    glowSecondary: 'bg-sky-200/38 dark:bg-sky-800/20',
    heroCard: 'border-pink-200/70 bg-white/82 dark:border-pink-900/60 dark:bg-pink-950/24',
    searchCard: 'border-pink-100/70 bg-white/84 dark:border-pink-900/60 dark:bg-slate-900/72',
    sectionCard: 'border-pink-100/70 bg-white/82 dark:border-pink-900/55 dark:bg-slate-900/62',
    decorations: ['🌼', '🥚', '🐇', '✨'],
    collectibleIcon: '🥚',
    collectibleLabel: 'eggs',
    collectibleCount: 6,
  },
};

const COLLECTIBLE_POSITIONS = [
  'left-[8%] top-[16%]',
  'right-[10%] top-[22%]',
  'left-[14%] bottom-[26%]',
  'right-[16%] bottom-[18%]',
  'left-[46%] top-[11%]',
  'right-[44%] bottom-[33%]',
];

function getEasterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDiffInDays(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / (1000 * 60 * 60 * 24));
}

function getSeasonalMode(today: Date): SeasonalMode | null {
  const month = today.getMonth();
  const day = today.getDate();

  if (month === 11 && day >= 20 && day <= 26) {
    return SEASONAL_MODES.christmas;
  }

  if (month === 9 && day >= 25) {
    return SEASONAL_MODES.halloween;
  }

  if (month === 10 && day <= 2) {
    return SEASONAL_MODES.halloween;
  }

  const easter = getEasterSunday(today.getFullYear());
  const diffToEaster = getDiffInDays(today, easter);
  if (diffToEaster >= -2 && diffToEaster <= 1) {
    return SEASONAL_MODES.easter;
  }

  return null;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

function isTodayEvent(eventDate: string, isRecurring: boolean) {
  const today = new Date();
  const target = new Date(`${eventDate}T00:00:00`);

  if (isRecurring) {
    return (
      today.getMonth() === target.getMonth() &&
      today.getDate() === target.getDate()
    );
  }

  return target.toDateString() === new Date(today.getFullYear(), today.getMonth(), today.getDate()).toDateString();
}

function getThemeKeyForEvent(event: CountdownThemeEvent) {
  const haystack = normalizeText(`${event.title} ${event.category || ''} ${event.emoji || ''}`);

  if (THEME_KEYWORDS.birthday.some((word) => haystack.includes(word)) || event.category === 'birthday') {
    return 'birthday';
  }
  if (THEME_KEYWORDS.anniversary.some((word) => haystack.includes(word)) || event.category === 'anniversary') {
    return 'anniversary';
  }
  if (THEME_KEYWORDS.milestone.some((word) => haystack.includes(word))) {
    return 'milestone';
  }
  if (THEME_KEYWORDS.party.some((word) => haystack.includes(word))) {
    return 'party';
  }
  if (THEME_KEYWORDS.gameNight.some((word) => haystack.includes(word))) {
    return 'gameNight';
  }
  if (THEME_KEYWORDS.weekend.some((word) => haystack.includes(word))) {
    return 'weekend';
  }
  if (THEME_KEYWORDS.trip.some((word) => haystack.includes(word)) || event.category === 'trip') {
    return 'trip';
  }
  return 'event';
}

function getHomeTheme(events: CountdownThemeEvent[]) {
  if (events.length === 0) return HOME_THEMES.default;

  const priority = ['birthday', 'anniversary', 'milestone', 'party', 'gameNight', 'weekend', 'trip', 'event'];
  const winner = priority.find((themeKey) =>
    events.some((event) => getThemeKeyForEvent(event) === themeKey)
  );

  return HOME_THEMES[winner || 'event'];
}

function AppCard({ title, icon, href, gradient, badge, newCount, onVisit }: AppCardProps) {
  const cardClasses = `
    relative overflow-hidden rounded-2xl
    bg-gradient-to-br ${gradient}
    shadow-lg hover:shadow-xl transition-all
    flex flex-col items-center justify-center
    aspect-square
    active:scale-[0.98] touch-manipulation
  `;

  const content = (
    <>
      {(newCount ?? 0) > 0 && (
        <div className="absolute top-2 right-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
        </div>
      )}
      {badge && (
        <div className="absolute top-2 left-2 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
          {badge}
        </div>
      )}
      <motion.div
        className="text-4xl sm:text-5xl mb-2"
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {icon}
      </motion.div>
      <h2 className="px-3 text-center text-sm font-medium leading-tight text-white sm:text-base">
        {title}
      </h2>
    </>
  );

  if (!href) {
    return <div className={`${cardClasses} opacity-60`}>{content}</div>;
  }

  return (
    <motion.a
      href={href}
      onClick={onVisit}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={cardClasses}
    >
      {content}
    </motion.a>
  );
}

function formatRelativeTime(timestamp: string) {
  const date = new Date(timestamp);
  const diffMs = date.getTime() - Date.now();
  const minutes = Math.round(diffMs / (1000 * 60));
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, 'minute');
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return formatter.format(hours, 'hour');
  }

  const days = Math.round(hours / 24);
  return formatter.format(days, 'day');
}

function formatActor(player: string | null | undefined) {
  if (player === 'daniel') return 'Daniel';
  if (player === 'huaiyao') return 'Huaiyao';
  return null;
}

function formatFeedDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getDaysUntil(dateString: string) {
  const today = new Date();
  const target = new Date(`${dateString}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function Home() {
  const [newCounts, setNewCounts] = useState<Record<string, number>>({});
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [daysTogether, setDaysTogether] = useState<number | null>(null);
  const [memoryFeed, setMemoryFeed] = useState<FeedItem[]>([]);
  const [placesFeed, setPlacesFeed] = useState<FeedItem[]>([]);
  const [countdownFeed, setCountdownFeed] = useState<FeedItem[]>([]);
  const [feedIndexes, setFeedIndexes] = useState({ memory: 0, places: 0, countdown: 0 });
  const [todayCountdownEvents, setTodayCountdownEvents] = useState<CountdownThemeEvent[]>([]);
  const [foundCollectibles, setFoundCollectibles] = useState<number[]>([]);

  const activeAppTitles = useMemo(
    () => sections.flatMap((section) => section.apps.map((app) => app.title)),
    []
  );
  const seasonalMode = useMemo(() => getSeasonalMode(new Date()), []);
  const homeTheme = useMemo(() => getHomeTheme(todayCountdownEvents), [todayCountdownEvents]);
  const activeTheme = seasonalMode || homeTheme;
  const todayThemeLabel = useMemo(() => {
    if (todayCountdownEvents.length === 0) return null;
    if (todayCountdownEvents.length === 1) return todayCountdownEvents[0].title;
    return `${todayCountdownEvents[0].title} +${todayCountdownEvents.length - 1} more`;
  }, [todayCountdownEvents]);
  const seasonalProgressLabel = useMemo(() => {
    if (!seasonalMode) return null;
    if (foundCollectibles.length >= seasonalMode.collectibleCount) {
      return `You found all ${seasonalMode.collectibleCount} ${seasonalMode.collectibleLabel}.`;
    }
    return `Find ${seasonalMode.collectibleCount - foundCollectibles.length} more ${seasonalMode.collectibleLabel}.`;
  }, [foundCollectibles.length, seasonalMode]);

  const revealCollectible = (index: number) => {
    setFoundCollectibles((prev) => (prev.includes(index) ? prev : [...prev, index]));
  };

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

  const fetchDaysTogether = async () => {
    if (!isSupabaseConfigured) return;

    try {
      const { data, error } = await supabase
        .from('relationship_stats')
        .select('first_date')
        .eq('id', 'main')
        .single();

      if (error || !data?.first_date) return;

      const start = new Date(`${data.first_date}T00:00:00`);
      const today = new Date();
      const diff = today.getTime() - start.getTime();
      setDaysTogether(Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24))));
    } catch (err) {
      console.error('Error fetching days together:', err);
    }
  };

  const fetchRecentActivity = async () => {
    if (!isSupabaseConfigured) return;

    try {
      const [
        gratitudeRes,
        memoryRes,
        countdownRes,
        promptRes,
        quizRes,
        dateIdeasRes,
        mapRes,
        storyRes,
      ] = await Promise.all([
        supabase.from('gratitude_notes').select('id, note_text, from_player, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('memories').select('id, title, created_by, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('important_dates').select('id, title, created_by, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('prompt_responses').select('id, player, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('quiz_questions').select('id, author, question_text, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('date_ideas').select('id, title, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('map_places').select('id, name, added_by, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('sentences').select('id, content, writer, created_at').order('created_at', { ascending: false }).limit(5),
      ]);

      const items: ActivityItem[] = [];

      gratitudeRes.data?.forEach((note) => {
        const actor = formatActor(note.from_player);
        items.push({
          id: `gratitude-${note.id}`,
          appTitle: 'Gratitude Wall',
          summary: `${actor ?? 'Someone'} added a gratitude note`,
          timestamp: note.created_at,
        });
      });

      memoryRes.data?.forEach((memory) => {
        const actor = formatActor(memory.created_by);
        items.push({
          id: `memory-${memory.id}`,
          appTitle: 'Memories',
          summary: `${actor ?? 'Someone'} added "${memory.title}"`,
          timestamp: memory.created_at,
        });
      });

      countdownRes.data?.forEach((date) => {
        const actor = formatActor(date.created_by);
        items.push({
          id: `countdown-${date.id}`,
          appTitle: 'Count Down',
          summary: `${actor ?? 'Someone'} added "${date.title}"`,
          timestamp: date.created_at,
        });
      });

      promptRes.data?.forEach((response) => {
        const actor = formatActor(response.player);
        items.push({
          id: `prompt-${response.id}`,
          appTitle: 'Daily Prompts',
          summary: `${actor ?? 'Someone'} answered the daily prompt`,
          timestamp: response.created_at,
        });
      });

      quizRes.data?.forEach((question) => {
        const actor = formatActor(question.author);
        items.push({
          id: `quiz-${question.id}`,
          appTitle: 'Quiz Time',
          summary: `${actor ?? 'Someone'} added a quiz question`,
          timestamp: question.created_at,
        });
      });

      dateIdeasRes.data?.forEach((idea) => {
        items.push({
          id: `dates-${idea.id}`,
          appTitle: 'Date Ideas',
          summary: `A new date idea was added: "${idea.title}"`,
          timestamp: idea.created_at,
        });
      });

      mapRes.data?.forEach((place) => {
        const actor = formatActor(place.added_by);
        items.push({
          id: `map-${place.id}`,
          appTitle: 'Map',
          summary: `${actor ?? 'Someone'} updated the map with "${place.name}"`,
          timestamp: place.created_at,
        });
      });

      storyRes.data?.forEach((sentence) => {
        const actor = formatActor(sentence.writer);
        items.push({
          id: `story-${sentence.id}`,
          appTitle: 'Story Book',
          summary: `${actor ?? 'Someone'} added to the story book`,
          timestamp: sentence.created_at,
        });
      });

      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setRecentActivity(items.slice(0, 5));
    } catch (err) {
      console.error('Error fetching recent activity:', err);
    }
  };

  const fetchLiveFeeds = async () => {
    if (!isSupabaseConfigured) return;

    try {
      const [memoriesRes, placesRes, countdownRes] = await Promise.all([
        supabase
          .from('memories')
          .select('id, title, description, memory_date, location_name')
          .order('memory_date', { ascending: false })
          .limit(18),
        supabase
          .from('map_places')
          .select('id, name, country, daniel_status, huaiyao_status, daniel_visit_date, huaiyao_visit_date, status, visit_date')
          .limit(40),
        supabase
          .from('important_dates')
          .select('id, title, event_date, is_recurring, emoji, category')
          .order('event_date', { ascending: true })
          .limit(40),
      ]);

      const memories = (memoriesRes.data || []).map((memory) => ({
        id: `memory-${memory.id}`,
        title: memory.title,
        detail: memory.location_name
          ? `${memory.location_name} · ${formatFeedDate(memory.memory_date)}`
          : formatFeedDate(memory.memory_date),
        href: '/memories',
        icon: '📸',
      }));

      const visitedPlaces = (placesRes.data || [])
        .filter((place) => {
          const visitedTogether =
            place.daniel_status === 'visited' && place.huaiyao_status === 'visited';
          const legacyVisited = place.status === 'visited';
          return visitedTogether || legacyVisited;
        })
        .map((place) => ({
          id: `place-${place.id}`,
          title: place.name,
          detail:
            place.country ||
            place.daniel_visit_date ||
            place.huaiyao_visit_date ||
            place.visit_date ||
            'Visited together',
          href: '/map',
          icon: '🗺️',
        }));

      const countdownItems = countdownRes.data || [];
      const todaysEvents = countdownItems.filter((item) => isTodayEvent(item.event_date, item.is_recurring));

      const upcomingDates = countdownItems
        .map((item) => {
          let nextDate = item.event_date;
          const daysUntil = getDaysUntil(nextDate);

          if (item.is_recurring && daysUntil < 0) {
            const original = new Date(`${item.event_date}T00:00:00`);
            const next = new Date(original);
            next.setFullYear(new Date().getFullYear() + 1);
            nextDate = next.toISOString().slice(0, 10);
          }

          return {
            id: `countdown-${item.id}`,
            title: item.title,
            detail: `${Math.max(getDaysUntil(nextDate), 0)} days · ${formatFeedDate(nextDate)}`,
            href: '/countdown',
            icon: item.emoji || '⏰',
            sortDays: Math.max(getDaysUntil(nextDate), 0),
          };
        })
        .sort((a, b) => a.sortDays - b.sortDays)
        .map((item) => ({
          id: item.id,
          title: item.title,
          detail: item.detail,
          href: item.href,
          icon: item.icon,
        }));

      setTodayCountdownEvents(
        todaysEvents.map((item) => ({
          id: item.id,
          title: item.title,
          event_date: item.event_date,
          is_recurring: item.is_recurring,
          emoji: item.emoji || null,
          category: item.category || null,
        }))
      );
      setMemoryFeed(memories.sort(() => Math.random() - 0.5).slice(0, 8));
      setPlacesFeed(visitedPlaces.sort(() => Math.random() - 0.5).slice(0, 8));
      setCountdownFeed(upcomingDates.slice(0, 8));
    } catch (err) {
      console.error('Error fetching live feeds:', err);
    }
  };

  const recordVisit = async (appTitle: string) => {
    if (!isSupabaseConfigured) return;

    try {
      await supabase.rpc('record_app_visit', {
        p_app_name: appTitle,
        p_visited_by: currentUser || null,
      });
    } catch (err) {
      console.error('Error recording visit:', err);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser');
    setCurrentUser(savedUser);

    if (savedUser) {
      fetchNewCounts(savedUser);
    }

    fetchDaysTogether();
    fetchRecentActivity();
    fetchLiveFeeds();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setFeedIndexes((prev) => ({
        memory: memoryFeed.length > 0 ? (prev.memory + 1) % memoryFeed.length : 0,
        places: placesFeed.length > 0 ? (prev.places + 1) % placesFeed.length : 0,
        countdown: countdownFeed.length > 0 ? (prev.countdown + 1) % countdownFeed.length : 0,
      }));
    }, 5500);

    return () => clearInterval(interval);
  }, [memoryFeed, placesFeed, countdownFeed]);

  useEffect(() => {
    const query = searchQuery.trim();

    if (!query) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    if (!isSupabaseConfigured) {
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      setIsSearching(true);

      try {
        const escapedQuery = query.replace(/[%_]/g, '');
        const like = `%${escapedQuery}%`;

        const [
          promptTextRes,
          promptResponseRes,
          gratitudeRes,
          dateIdeasRes,
          countdownRes,
          memoriesRes,
          mapRes,
          quizRes,
          storyRes,
          mysteryRes,
        ] = await Promise.all([
          supabase.from('prompts').select('id, prompt_text').ilike('prompt_text', like).limit(3),
          supabase.from('prompt_responses').select('id, response_text').ilike('response_text', like).limit(3),
          supabase.from('gratitude_notes').select('id, note_text, emoji').ilike('note_text', like).limit(3),
          supabase.from('date_ideas').select('id, title, description').or(`title.ilike.${like},description.ilike.${like}`).limit(3),
          supabase.from('important_dates').select('id, title, emoji').ilike('title', like).limit(3),
          supabase.from('memories').select('id, title, description, location_name').or(`title.ilike.${like},description.ilike.${like},location_name.ilike.${like}`).limit(3),
          supabase.from('map_places').select('id, name, country, notes').or(`name.ilike.${like},country.ilike.${like},notes.ilike.${like}`).limit(3),
          supabase.from('quiz_questions').select('id, question_text').ilike('question_text', like).limit(3),
          supabase.from('sentences').select('id, content').ilike('content', like).limit(3),
          supabase.from('mystery_episodes').select('id, title, description').or(`title.ilike.${like},description.ilike.${like}`).limit(3),
        ]);

        const results: SearchResult[] = [];

        promptTextRes.data?.forEach((item) => {
          results.push({
            id: `prompt-text-${item.id}`,
            appTitle: 'Daily Prompts',
            title: item.prompt_text,
            description: 'Prompt library',
            href: '/prompts',
            icon: '💬',
          });
        });

        promptResponseRes.data?.forEach((item) => {
          results.push({
            id: `prompt-response-${item.id}`,
            appTitle: 'Daily Prompts',
            title: item.response_text,
            description: 'Prompt response',
            href: '/prompts',
            icon: '💬',
          });
        });

        gratitudeRes.data?.forEach((item) => {
          results.push({
            id: `gratitude-${item.id}`,
            appTitle: 'Gratitude Wall',
            title: item.note_text,
            description: 'Gratitude note',
            href: '/gratitude',
            icon: item.emoji || '💝',
          });
        });

        dateIdeasRes.data?.forEach((item) => {
          results.push({
            id: `dates-${item.id}`,
            appTitle: 'Date Ideas',
            title: item.title,
            description: item.description || 'Date idea',
            href: '/dates',
            icon: '✨',
          });
        });

        countdownRes.data?.forEach((item) => {
          results.push({
            id: `countdown-${item.id}`,
            appTitle: 'Count Down',
            title: item.title,
            description: 'Important date',
            href: '/countdown',
            icon: item.emoji || '⏰',
          });
        });

        memoriesRes.data?.forEach((item) => {
          results.push({
            id: `memories-${item.id}`,
            appTitle: 'Memories',
            title: item.title,
            description: item.description || item.location_name || 'Memory',
            href: '/memories',
            icon: '📸',
          });
        });

        mapRes.data?.forEach((item) => {
          results.push({
            id: `map-${item.id}`,
            appTitle: 'Map',
            title: item.name,
            description: item.notes || item.country || 'Map place',
            href: '/map',
            icon: '🗺️',
          });
        });

        quizRes.data?.forEach((item) => {
          results.push({
            id: `quiz-${item.id}`,
            appTitle: 'Quiz Time',
            title: item.question_text,
            description: 'Quiz question',
            href: '/quiz',
            icon: '🧠',
          });
        });

        storyRes.data?.forEach((item) => {
          results.push({
            id: `story-${item.id}`,
            appTitle: 'Story Book',
            title: item.content,
            description: 'Story sentence',
            href: '/book',
            icon: '📖',
          });
        });

        mysteryRes.data?.forEach((item) => {
          results.push({
            id: `mystery-${item.id}`,
            appTitle: 'Mystery Files',
            title: item.title,
            description: item.description || 'Mystery episode',
            href: '/mystery',
            icon: '🔍',
          });
        });

        setSearchResults(results.slice(0, 8));
      } catch (err) {
        console.error('Error searching app content:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  return (
    <div className={`min-h-screen ${activeTheme.pageGradient}`}>
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setIsActivityOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-gray-600 shadow-lg backdrop-blur transition-colors hover:text-gray-900 dark:bg-gray-800/85 dark:text-gray-300 dark:hover:text-white"
            aria-label="Recent changes"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.4-1.4A2 2 0 0118 14.17V11a6 6 0 10-12 0v3.17c0 .53-.21 1.04-.59 1.43L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
            </svg>
          </button>

          <AnimatePresence>
            {isActivityOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                className="absolute right-0 mt-3 w-80 overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-2xl backdrop-blur dark:border-gray-700 dark:bg-gray-800/95"
              >
                <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Latest changes</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">The most recent updates across the app.</p>
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {recentActivity.length > 0 ? (
                    recentActivity.map((item) => (
                      <div
                        key={item.id}
                        className="border-b border-gray-100 px-4 py-3 last:border-b-0 dark:border-gray-700"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                              {item.appTitle}
                            </p>
                            <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">{item.summary}</p>
                          </div>
                          <span className="whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
                            {formatRelativeTime(item.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                      No recent changes yet.
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <ThemeToggle />
      </div>

      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className={`absolute left-1/4 top-1/4 h-96 w-96 rounded-full blur-3xl ${activeTheme.glowPrimary}`}
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className={`absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full blur-3xl ${activeTheme.glowSecondary}`}
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        {seasonalMode &&
          seasonalMode.decorations.map((item, index) => (
            <motion.div
              key={`${seasonalMode.id}-${item}-${index}`}
              className={`absolute text-2xl opacity-70 ${
                index % 2 === 0 ? 'left-[12%]' : 'right-[14%]'
              } ${index < 2 ? 'top-[18%]' : index < 3 ? 'top-[48%]' : 'bottom-[16%]'}`}
              animate={{ y: [0, -12, 0], rotate: [-4, 4, -4] }}
              transition={{ duration: 4 + index, repeat: Infinity, ease: 'easeInOut' }}
            >
              {item}
            </motion.div>
          ))}
      </div>

      {seasonalMode &&
        COLLECTIBLE_POSITIONS.slice(0, seasonalMode.collectibleCount).map((position, index) => {
          const found = foundCollectibles.includes(index);

          return (
            <button
              key={`${seasonalMode.id}-collectible-${index}`}
              onClick={() => revealCollectible(index)}
              className={`fixed z-20 hidden rounded-full transition-all md:block ${position} ${
                found ? 'pointer-events-none opacity-0 scale-75' : 'opacity-90 hover:scale-110'
              }`}
              aria-label={`Find ${seasonalMode.collectibleLabel}`}
              type="button"
            >
              <span className="block text-2xl drop-shadow-md">{seasonalMode.collectibleIcon}</span>
            </button>
          );
        })}

      <main className="relative z-10 mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-20">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto mb-10 max-w-2xl text-center sm:mb-12"
        >
          <div className="mb-4 flex justify-center">
            <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-gray-600 dark:text-gray-300 ${activeTheme.heroCard}`}>
              {seasonalMode ? seasonalMode.label : homeTheme.badge}
            </span>
          </div>
          <motion.div
            className="mb-6 text-5xl sm:text-6xl"
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          >
            {activeTheme.icon}
          </motion.div>
          <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100 sm:text-5xl md:text-6xl font-serif">
            {activeTheme.headline}
          </h1>
          <p className="mx-auto max-w-md text-lg text-gray-500 dark:text-gray-400 sm:text-xl">
            {activeTheme.subheading}
          </p>
          {seasonalMode && (
            <div className="mt-5 flex justify-center">
              <div className={`max-w-lg rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${seasonalMode.heroCard}`}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400 dark:text-gray-500">
                  Seasonal mode
                </p>
                <p className="mt-1 font-medium text-gray-800 dark:text-gray-100">
                  {seasonalProgressLabel}
                </p>
              </div>
            </div>
          )}
          {todayThemeLabel && (
            <div className="mt-5 flex justify-center">
              <div className={`max-w-lg rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${activeTheme.heroCard}`}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-gray-400 dark:text-gray-500">
                  {homeTheme.kicker}
                </p>
                <p className="mt-1 font-medium text-gray-800 dark:text-gray-100">
                  {todayThemeLabel}
                </p>
              </div>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mx-auto mb-8 max-w-2xl"
        >
          <div className={`overflow-hidden rounded-2xl border shadow-lg backdrop-blur ${seasonalMode ? seasonalMode.searchCard : 'border-white/60 bg-white/80 dark:border-gray-700 dark:bg-gray-800/75'}`}>
            <div className="relative">
              <svg
                className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search across prompts, gratitude, memories, plans, quiz and map"
                className="w-full bg-transparent py-4 pl-11 pr-12 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500 sm:text-base"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
                  aria-label="Clear search"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <AnimatePresence>
              {(searchQuery.trim() || isSearching) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-gray-100 dark:border-gray-700"
                >
                  {isSearching ? (
                    <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Searching…</div>
                  ) : searchResults.length > 0 ? (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {searchResults.map((result) => (
                        <a
                          key={result.id}
                          href={result.href}
                          onClick={() => recordVisit(result.appTitle)}
                          className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-700/40"
                        >
                          <span className="mt-0.5 text-xl">{result.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                                {result.title}
                              </span>
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                                {result.appTitle}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                              {result.description}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                      No matches for &quot;{searchQuery.trim()}&quot;.
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        <div className="space-y-8 sm:space-y-10">
          {sections.map((section, sectionIndex) => (
            <motion.section
              key={section.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + sectionIndex * 0.08 }}
            >
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 sm:text-xl">
                    {section.title}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {section.caption}
                  </p>
                </div>
              </div>

              <div className={`rounded-3xl border p-3 sm:p-4 ${seasonalMode ? seasonalMode.sectionCard : 'border-transparent'}`}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {section.apps.map((app, index) => (
                    <motion.div
                      key={app.title}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.24 + index * 0.03 }}
                    >
                      <AppCard
                        {...app}
                        badge={seasonalMode && index === 0 ? seasonalMode.label : app.badge}
                        newCount={activeAppTitles.includes(app.title) ? newCounts[app.title] : undefined}
                        onVisit={app.href ? () => recordVisit(app.title) : undefined}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.section>
          ))}
        </div>

        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="mt-12"
        >
          <button
            onClick={() => setShowArchived((value) => !value)}
            className="w-full rounded-2xl border border-dashed border-gray-300/80 px-4 py-3 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
          >
            {showArchived ? 'Hide archived apps' : `Show archived apps (${archivedApps.length})`}
          </button>

          <AnimatePresence>
            {showArchived && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-4 flex flex-wrap gap-2">
                  {archivedApps.map((app) => (
                    <span
                      key={app}
                      className="rounded-full bg-gray-200/70 px-3 py-1 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    >
                      {app}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-12"
        >
          <div className="mb-4 text-center">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 sm:text-xl">
              Live Feeds
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              A few nostalgic things behind you, and a few good things ahead.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                key: 'memory',
                label: 'Random Memory',
                empty: 'No memories yet.',
                item: memoryFeed[feedIndexes.memory],
              },
              {
                key: 'places',
                label: 'Visited Together',
                empty: 'No shared places yet.',
                item: placesFeed[feedIndexes.places],
              },
              {
                key: 'countdown',
                label: 'Looking Forward To',
                empty: 'No countdowns yet.',
                item: countdownFeed[feedIndexes.countdown],
              },
            ].map((feed) => (
              <div
                key={feed.key}
                className="overflow-hidden rounded-2xl border border-white/60 bg-white/80 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/75"
              >
                <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
                  <p className="text-xs uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                    {feed.label}
                  </p>
                </div>

                <div className="min-h-[124px] px-4 py-4">
                  <AnimatePresence mode="wait">
                    {feed.item ? (
                      <motion.a
                        key={feed.item.id}
                        href={feed.item.href}
                        onClick={() => recordVisit(feed.label === 'Visited Together' ? 'Map' : feed.label === 'Looking Forward To' ? 'Count Down' : 'Memories')}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="block"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 text-2xl">{feed.item.icon}</span>
                          <div>
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                              {feed.item.title}
                            </p>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                              {feed.item.detail}
                            </p>
                          </div>
                        </div>
                      </motion.a>
                    ) : (
                      <motion.div
                        key={`${feed.key}-empty`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-sm text-gray-500 dark:text-gray-400"
                      >
                        {feed.empty}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-12 text-center"
        >
          <div className="mx-auto max-w-sm rounded-3xl border border-white/60 bg-white/75 px-6 py-6 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/75">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">
              Days Together
            </p>
            <p className="mt-3 text-4xl font-bold text-gray-800 dark:text-gray-100">
              {daysTogether ?? '—'}
            </p>
          </div>
        </motion.div>

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.75 }}
          className="mt-10 text-center text-sm text-gray-400 dark:text-gray-500"
        >
          <p>Built for fun</p>
        </motion.footer>
      </main>
    </div>
  );
}
