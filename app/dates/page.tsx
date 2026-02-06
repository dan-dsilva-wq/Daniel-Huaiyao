'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured, DateIdea } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { ThemeToggle } from '../components/ThemeToggle';

interface LocalCategory {
  id: string;
  name: string;
  emoji: string;
  ideas: DateIdea[];
}


export default function DateIdeas() {
  useMarkAppViewed('dates');
  const [categories, setCategories] = useState<LocalCategory[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [newIdeaTitle, setNewIdeaTitle] = useState('');
  const [newIdeaDescription, setNewIdeaDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);

  // Wheel spin state
  const [showWheel, setShowWheel] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [selectedIdea, setSelectedIdea] = useState<DateIdea | null>(null);
  const [wheelIdeas, setWheelIdeas] = useState<DateIdea[]>([]);
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch data from Supabase using RPC
  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      // Use RPC function to get all categories with ideas
      const { data, error } = await supabase.rpc('get_date_categories');

      if (error) {
        console.error('RPC error:', error);
        throw error;
      }

      // If no data, the function returns null
      if (!data || (Array.isArray(data) && data.length === 0)) {
        // Database is empty, but we can't seed via RPC without more functions
        // Show empty state
        setCategories([]);
        setIsLoading(false);
        return;
      }

      // Transform RPC response to LocalCategory format
      const groupedCategories: LocalCategory[] = (data as {
        id: string;
        name: string;
        emoji: string;
        sort_order: number;
        ideas: DateIdea[];
      }[]).map((cat) => ({
        id: cat.id,
        name: cat.name,
        emoji: cat.emoji,
        ideas: cat.ideas || [],
      }));

      setCategories(groupedCategories);
    } catch (error) {
      console.error('Error fetching data:', error);
    }

    setIsLoading(false);
  }, []);


  // Load data on mount
  useEffect(() => {
    // Check for saved user preference
    const savedUser = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);

    fetchData();
  }, [fetchData]);

  // Send notification
  const sendNotification = async (action: 'added' | 'removed' | 'completed' | 'uncompleted', title: string) => {
    if (!currentUser) return;

    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, title, user: currentUser }),
      });
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  // Toggle completed status using RPC
  const toggleCompleted = async (idea: DateIdea) => {
    const { data, error } = await supabase.rpc('toggle_date_idea', {
      p_idea_id: idea.id
    });

    if (error) {
      console.error('Error updating idea:', error);
      return;
    }

    const newStatus = data?.is_completed ?? !idea.is_completed;
    sendNotification(newStatus ? 'completed' : 'uncompleted', idea.title);
    fetchData();
  };

  // Add a new idea using RPC
  const addIdea = async (categoryId: string) => {
    if (!newIdeaTitle.trim()) return;

    const { error } = await supabase.rpc('add_date_idea', {
      p_category_id: categoryId,
      p_title: newIdeaTitle.trim(),
      p_description: newIdeaDescription.trim() || null,
      p_emoji: null
    });

    if (error) {
      console.error('Error adding idea:', error);
      return;
    }

    sendNotification('added', newIdeaTitle.trim());
    setNewIdeaTitle('');
    setNewIdeaDescription('');
    setAddingToCategory(null);
    fetchData();
  };

  // Remove an idea using RPC
  const removeIdea = async (idea: DateIdea) => {
    const { error } = await supabase.rpc('remove_date_idea', {
      p_idea_id: idea.id
    });

    if (error) {
      console.error('Error removing idea:', error);
      return;
    }

    sendNotification('removed', idea.title);
    fetchData();
  };

  // Select user
  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', user);
  };

  // Wheel spin helpers
  const WHEEL_COLORS = [
    '#8B5CF6', '#F59E0B', '#EC4899', '#14B8A6',
    '#6366F1', '#F97316', '#06B6D4', '#EF4444',
  ];

  const getIncompleteIdeas = () =>
    categories.flatMap((cat) => cat.ideas.filter((i) => !i.is_completed));

  const shuffleArray = <T,>(arr: T[]): T[] => {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const openWheel = () => {
    const incomplete = getIncompleteIdeas();
    if (incomplete.length === 0) return;
    const picked = shuffleArray(incomplete).slice(0, 8);
    setWheelIdeas(picked);
    setSelectedIdea(null);
    setWheelRotation(0);
    setShowWheel(true);
  };

  const spinWheel = () => {
    if (isSpinning || wheelIdeas.length === 0) return;
    setIsSpinning(true);
    setSelectedIdea(null);

    const winnerIndex = Math.floor(Math.random() * wheelIdeas.length);
    const segmentAngle = 360 / wheelIdeas.length;
    // The pointer is at the top (12 o'clock). Segment 0 starts at 12 o'clock going clockwise.
    // To land on winnerIndex, the center of that segment needs to align with the top.
    const segmentCenter = winnerIndex * segmentAngle + segmentAngle / 2;
    // We rotate clockwise, so we need (360 - segmentCenter) to bring that segment to top
    const targetAngle = 360 - segmentCenter;
    // Add multiple full rotations for dramatic effect
    const fullSpins = 5 + Math.floor(Math.random() * 3);
    const newRotation = wheelRotation + fullSpins * 360 + ((targetAngle - (wheelRotation % 360)) + 360) % 360;

    setWheelRotation(newRotation);

    spinTimeoutRef.current = setTimeout(() => {
      setSelectedIdea(wheelIdeas[winnerIndex]);
      setIsSpinning(false);
    }, 4000);
  };

  const closeWheel = () => {
    if (isSpinning) return;
    setShowWheel(false);
    if (spinTimeoutRef.current) {
      clearTimeout(spinTimeoutRef.current);
      spinTimeoutRef.current = null;
    }
  };

  const totalIdeas = categories.reduce((sum, cat) => sum + cat.ideas.length, 0);
  const completedCount = categories.reduce(
    (sum, cat) => sum + cat.ideas.filter((i) => i.is_completed).length,
    0
  );

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
            ✨
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
            Who are you?
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            So we know who to notify when you make changes
          </p>
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-4 border-purple-200 dark:border-purple-800 border-t-purple-500 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-100/30 dark:bg-purple-900/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-100/30 dark:bg-amber-900/20 rounded-full blur-3xl"
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
            <a
              href="/"
              className="px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:text-gray-800 dark:active:text-gray-100 transition-colors touch-manipulation"
            >
              ← Home
            </a>
            <ThemeToggle />
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
            Date Ideas
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            {completedCount} of {totalIdeas} completed
          </p>

          {/* Progress bar */}
          <div className="mt-4 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden max-w-xs mx-auto">
            <motion.div
              className="h-full bg-gradient-to-r from-purple-500 to-amber-500"
              initial={{ width: 0 }}
              animate={{ width: `${totalIdeas > 0 ? (completedCount / totalIdeas) * 100 : 0}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </motion.div>

        {/* Spin the Wheel button */}
        {getIncompleteIdeas().length > 0 && (
          <div className="flex justify-center mb-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={openWheel}
              className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-amber-500 text-white font-medium rounded-full shadow-lg
                         hover:from-purple-600 hover:to-amber-600 transition-all touch-manipulation flex items-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2v10l7 7" strokeLinecap="round" />
              </svg>
              Spin the Wheel
            </motion.button>
          </div>
        )}

        {/* Search bar */}
        <div className="mb-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search ideas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/70 dark:bg-gray-800/70 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 focus:border-transparent
                         text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Toggle completed visibility */}
        <div className="flex justify-center mb-6">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {showCompleted ? 'Hide' : 'Show'} completed
          </button>
        </div>

        {/* Categories */}
        <div className="space-y-4">
          {categories.map((category, catIndex) => {
            const categoryCompleted = category.ideas.filter((i) => i.is_completed).length;
            const isSearching = searchQuery.trim().length > 0;
            const isExpanded = isSearching || expandedCategory === category.name;

            // Filter by search query
            const searchFiltered = isSearching
              ? category.ideas.filter((i) =>
                  i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  i.description?.toLowerCase().includes(searchQuery.toLowerCase())
                )
              : category.ideas;

            // Then filter by completed visibility
            const visibleIdeas = showCompleted
              ? searchFiltered
              : searchFiltered.filter((i) => !i.is_completed);

            // Hide category if searching and no matches
            if (isSearching && searchFiltered.length === 0) {
              return null;
            }

            return (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: catIndex * 0.05 }}
                className="bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-xl shadow-sm overflow-hidden"
              >
                {/* Category header */}
                <button
                  onClick={() => setExpandedCategory(isExpanded ? null : category.name)}
                  className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-gray-700/50 active:bg-gray-100/50 dark:active:bg-gray-600/50 transition-colors touch-manipulation"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl sm:text-2xl">{category.emoji}</span>
                    <span className="font-medium text-gray-800 dark:text-gray-100 text-base sm:text-base">{category.name}</span>
                    <span className="text-sm text-gray-400 dark:text-gray-500">
                      {categoryCompleted}/{category.ideas.length}
                    </span>
                  </div>
                  <motion.span
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    className="text-gray-400"
                  >
                    ▼
                  </motion.span>
                </button>

                {/* Ideas list */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-3 space-y-1">
                        {visibleIdeas.map((idea) => {
                          const isCompleted = idea.is_completed;
                          return (
                            <motion.div
                              key={idea.id}
                              layout
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className={`
                                group flex items-start gap-3 p-3 rounded-lg
                                hover:bg-gray-100/50 dark:hover:bg-gray-700/50 active:bg-gray-100 dark:active:bg-gray-700 transition-colors touch-manipulation
                                ${isCompleted ? 'opacity-60' : ''}
                              `}
                            >
                              <div
                                className={`
                                  mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0
                                  transition-colors cursor-pointer
                                  ${isCompleted
                                    ? 'bg-green-500 border-green-500 text-white'
                                    : 'border-gray-300 dark:border-gray-600'
                                  }
                                `}
                                onClick={() => toggleCompleted(idea)}
                              >
                                {isCompleted && (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              <div
                                className="flex-1 min-w-0 cursor-pointer"
                                onClick={() => toggleCompleted(idea)}
                              >
                                <div className={`font-medium text-base ${isCompleted ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100'}`}>
                                  {idea.emoji && <span className="mr-1">{idea.emoji}</span>}
                                  {idea.title}
                                </div>
                                {idea.description && (
                                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{idea.description}</div>
                                )}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeIdea(idea);
                                }}
                                className="opacity-0 group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100
                                           p-2 -mr-1 text-gray-400 hover:text-red-500 transition-all touch-manipulation
                                           active:opacity-100"
                                title="Remove idea"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </motion.div>
                          );
                        })}
                        {visibleIdeas.length === 0 && (
                          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">
                            All done in this category! 🎉
                          </p>
                        )}

                        {/* Add new idea section */}
                        {addingToCategory === category.id ? (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="pt-2 border-t border-gray-100 dark:border-gray-700 mt-2"
                          >
                            <input
                              type="text"
                              placeholder="Idea title"
                              value={newIdeaTitle}
                              onChange={(e) => setNewIdeaTitle(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                              autoFocus
                            />
                            <input
                              type="text"
                              placeholder="Description (optional)"
                              value={newIdeaDescription}
                              onChange={(e) => setNewIdeaDescription(e.target.value)}
                              className="w-full px-3 py-2 mt-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => addIdea(category.id)}
                                disabled={!newIdeaTitle.trim()}
                                className="flex-1 px-3 py-2 text-sm bg-purple-500 text-white rounded-lg
                                           hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                Add
                              </button>
                              <button
                                onClick={() => {
                                  setAddingToCategory(null);
                                  setNewIdeaTitle('');
                                  setNewIdeaDescription('');
                                }}
                                className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </motion.div>
                        ) : (
                          <button
                            onClick={() => setAddingToCategory(category.id)}
                            className="w-full mt-2 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400
                                       border border-dashed border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-500
                                       rounded-lg transition-colors"
                          >
                            + Add idea
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {/* No results message */}
          {searchQuery.trim() && categories.every((cat) =>
            !cat.ideas.some((i) =>
              i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              i.description?.toLowerCase().includes(searchQuery.toLowerCase())
            )
          ) && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-gray-400 dark:text-gray-500 py-8"
            >
              No ideas found for &quot;{searchQuery}&quot;
            </motion.p>
          )}
        </div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 dark:text-gray-500 text-sm"
        >
          <p>Tap to mark as done · Hover to remove</p>
          <p className="mt-2">
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
              className="underline hover:text-gray-600 dark:hover:text-gray-400"
            >
              Switch
            </button>
          </p>
        </motion.footer>
      </main>

      {/* Wheel Spin Modal */}
      <AnimatePresence>
        {showWheel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={closeWheel}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full flex flex-col items-center gap-4"
            >
              <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100">
                Spin the Wheel!
              </h2>

              {/* Wheel container */}
              <div className="relative w-72 h-72">
                {/* Pointer triangle at top */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
                  <svg width="24" height="20" viewBox="0 0 24 20">
                    <polygon points="12,20 0,0 24,0" fill="#1F2937" className="dark:fill-gray-200" />
                  </svg>
                </div>

                {/* SVG Wheel */}
                <motion.svg
                  viewBox="0 0 200 200"
                  className="w-full h-full"
                  animate={{ rotate: wheelRotation }}
                  transition={wheelRotation === 0 ? { duration: 0 } : {
                    duration: 4,
                    ease: [0.2, 0.8, 0.3, 1],
                  }}
                >
                  {wheelIdeas.map((idea, i) => {
                    const count = wheelIdeas.length;
                    const angle = 360 / count;
                    const startAngle = i * angle - 90; // -90 so segment 0 starts at top
                    const endAngle = startAngle + angle;
                    const startRad = (startAngle * Math.PI) / 180;
                    const endRad = (endAngle * Math.PI) / 180;
                    const x1 = 100 + 95 * Math.cos(startRad);
                    const y1 = 100 + 95 * Math.sin(startRad);
                    const x2 = 100 + 95 * Math.cos(endRad);
                    const y2 = 100 + 95 * Math.sin(endRad);
                    const largeArc = angle > 180 ? 1 : 0;

                    // Text position at midpoint of segment
                    const midAngle = ((startAngle + endAngle) / 2) * Math.PI / 180;
                    const textR = 62;
                    const tx = 100 + textR * Math.cos(midAngle);
                    const ty = 100 + textR * Math.sin(midAngle);
                    const textRotation = (startAngle + endAngle) / 2 + 90;

                    const label = idea.title.length > 12
                      ? idea.title.slice(0, 11) + '\u2026'
                      : idea.title;

                    return (
                      <g key={idea.id}>
                        <path
                          d={`M100,100 L${x1},${y1} A95,95 0 ${largeArc},1 ${x2},${y2} Z`}
                          fill={WHEEL_COLORS[i % WHEEL_COLORS.length]}
                          stroke="white"
                          strokeWidth="1"
                        />
                        <text
                          x={tx}
                          y={ty}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          transform={`rotate(${textRotation}, ${tx}, ${ty})`}
                          fill="white"
                          fontSize={count <= 4 ? "7" : "6"}
                          fontWeight="600"
                        >
                          {label}
                        </text>
                      </g>
                    );
                  })}
                  {/* Center circle */}
                  <circle cx="100" cy="100" r="18" fill="white" className="dark:fill-gray-700" stroke="#E5E7EB" strokeWidth="2" />
                  <text x="100" y="102" textAnchor="middle" dominantBaseline="middle" fontSize="14">
                    🎲
                  </text>
                </motion.svg>
              </div>

              {/* Result card */}
              <AnimatePresence mode="wait">
                {selectedIdea && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="w-full bg-gradient-to-r from-purple-50 to-amber-50 dark:from-purple-900/30 dark:to-amber-900/30 rounded-xl p-4 text-center"
                  >
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">You should try...</p>
                    <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                      {selectedIdea.emoji && <span className="mr-1">{selectedIdea.emoji}</span>}
                      {selectedIdea.title}
                    </p>
                    {selectedIdea.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{selectedIdea.description}</p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Buttons */}
              <div className="flex gap-3 w-full">
                {!selectedIdea ? (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={spinWheel}
                    disabled={isSpinning}
                    className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-amber-500 text-white font-semibold rounded-xl
                               hover:from-purple-600 hover:to-amber-600 disabled:opacity-60 transition-all"
                  >
                    {isSpinning ? 'Spinning...' : 'Spin!'}
                  </motion.button>
                ) : (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={spinWheel}
                      className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-amber-500 text-white font-semibold rounded-xl
                                 hover:from-purple-600 hover:to-amber-600 transition-all"
                    >
                      Spin Again
                    </motion.button>
                    <button
                      onClick={closeWheel}
                      className="px-5 py-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-medium transition-colors"
                    >
                      Close
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
