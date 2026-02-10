'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { supabase, isSupabaseConfigured, DateIdea } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { ThemeToggle } from '../components/ThemeToggle';
import CategorySection from './components/CategorySection';
import EditIdeaModal from './components/EditIdeaModal';
import QuickAddModal from './components/QuickAddModal';
import SpinWheel from './components/SpinWheel';
import CategoryManagerModal from './components/CategoryManagerModal';

interface LocalCategory {
  id: string;
  name: string;
  emoji: string;
  ideas: DateIdea[];
}

type SortMode = 'recent' | 'az' | 'za';

export default function DateIdeas() {
  useMarkAppViewed('dates');
  const [categories, setCategories] = useState<LocalCategory[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [pageTitle, setPageTitle] = useState('Date Ideas');
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('dates_sort') as SortMode) || 'recent';
    }
    return 'recent';
  });

  // Modal state
  const [showWheel, setShowWheel] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [editingIdea, setEditingIdea] = useState<DateIdea | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const [categoriesResult, titleResult] = await Promise.all([
        supabase.rpc('get_date_categories'),
        supabase.rpc('get_dates_page_title'),
      ]);

      if (categoriesResult.error) throw categoriesResult.error;

      const data = categoriesResult.data;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        setCategories([]);
        setIsLoading(false);
        return;
      }

      const grouped: LocalCategory[] = (data as {
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

      setCategories(grouped);

      // Expand all categories by default on first load
      setExpandedCategories((prev) => {
        if (prev.size === 0) {
          return new Set(grouped.map((c) => c.id));
        }
        // Keep existing expansions but add any new categories
        const next = new Set(prev);
        for (const c of grouped) {
          if (!prev.has(c.id) && ![...prev].some(() => true)) {
            // Only auto-expand on first load
          }
        }
        return next;
      });

      if (titleResult.data) {
        setPageTitle(titleResult.data as string);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);
    fetchData();
  }, [fetchData]);

  // Sort ideas within categories
  const sortedCategories = categories.map((cat) => {
    const sorted = [...cat.ideas];
    if (sortMode === 'az') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === 'za') sorted.sort((a, b) => b.title.localeCompare(a.title));
    else sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return { ...cat, ideas: sorted };
  });

  const handleSortChange = (mode: SortMode) => {
    setSortMode(mode);
    localStorage.setItem('dates_sort', mode);
  };

  // Notification helper
  const sendNotification = async (action: string, title: string) => {
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

  // CRUD operations
  const toggleCompleted = async (idea: DateIdea) => {
    const { data, error } = await supabase.rpc('toggle_date_idea', { p_idea_id: idea.id });
    if (error) { console.error('Error:', error); return; }
    const newStatus = data?.is_completed ?? !idea.is_completed;
    sendNotification(newStatus ? 'completed' : 'uncompleted', idea.title);
    fetchData();
  };

  const addIdea = async (categoryId: string, title: string, description: string) => {
    const { error } = await supabase.rpc('add_date_idea', {
      p_category_id: categoryId,
      p_title: title,
      p_description: description || null,
      p_emoji: null,
      p_added_by: currentUser,
    });
    if (error) { console.error('Error:', error); return; }
    sendNotification('added', title);
    fetchData();
  };

  const removeIdea = async (idea: DateIdea) => {
    const { error } = await supabase.rpc('remove_date_idea', { p_idea_id: idea.id });
    if (error) { console.error('Error:', error); return; }
    sendNotification('removed', idea.title);
    fetchData();
  };

  const updateIdea = async (ideaId: string, title: string, description: string | null, categoryId: string) => {
    const { error } = await supabase.rpc('update_date_idea', {
      p_idea_id: ideaId,
      p_title: title,
      p_description: description,
      p_category_id: categoryId,
    });
    if (error) { console.error('Error:', error); return; }
    sendNotification('date_idea_edited', title);
    fetchData();
  };

  // Category management
  const addCategory = async (name: string, emoji: string) => {
    const { error } = await supabase.rpc('add_date_category', { p_name: name, p_emoji: emoji });
    if (error) { console.error('Error:', error); return; }
    fetchData();
  };

  const renameCategory = async (categoryId: string, name: string, emoji: string) => {
    const { error } = await supabase.rpc('rename_date_category', {
      p_category_id: categoryId, p_name: name, p_emoji: emoji,
    });
    if (error) { console.error('Error:', error); return; }
    fetchData();
  };

  const deleteCategory = async (categoryId: string, moveToId: string) => {
    const { error } = await supabase.rpc('remove_date_category', {
      p_category_id: categoryId, p_move_to_category_id: moveToId,
    });
    if (error) { console.error('Error:', error); return; }
    setExpandedCategories((prev) => { const next = new Set(prev); next.delete(categoryId); return next; });
    fetchData();
  };

  const setPageTitleDB = async (title: string) => {
    const { error } = await supabase.rpc('set_dates_page_title', { p_title: title });
    if (error) { console.error('Error:', error); return; }
    setPageTitle(title);
  };

  // Expand/collapse helpers
  const toggleExpand = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allExpanded = categories.length > 0 && categories.every((c) => expandedCategories.has(c.id));
  const toggleAllExpanded = () => {
    if (allExpanded) {
      setExpandedCategories(new Set());
    } else {
      setExpandedCategories(new Set(categories.map((c) => c.id)));
    }
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', user);
  };

  const totalIdeas = categories.reduce((sum, cat) => sum + cat.ideas.length, 0);
  const completedCount = categories.reduce(
    (sum, cat) => sum + cat.ideas.filter((i) => i.is_completed).length,
    0
  );
  const hasIncompleteIdeas = categories.some((cat) => cat.ideas.some((i) => !i.is_completed));

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
            <Link
              href="/"
              className="px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:text-gray-800 dark:active:text-gray-100 transition-colors touch-manipulation"
            >
              ← Home
            </Link>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCategoryManager(true)}
                className="p-2 text-gray-400 hover:text-purple-500 dark:hover:text-purple-400 transition-colors"
                title="Manage categories"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <ThemeToggle />
            </div>
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
            {pageTitle}
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
        {hasIncompleteIdeas && (
          <div className="flex justify-center mb-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowWheel(true)}
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

        {/* Search + sort + controls row */}
        <div className="mb-4 space-y-3">
          {/* Search bar */}
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

          {/* Controls row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <select
                value={sortMode}
                onChange={(e) => handleSortChange(e.target.value as SortMode)}
                className="text-sm px-2 py-1 bg-white/70 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700 rounded-lg
                           text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600"
              >
                <option value="recent">Recent</option>
                <option value="az">A-Z</option>
                <option value="za">Z-A</option>
              </select>
              <button
                onClick={toggleAllExpanded}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              {showCompleted ? 'Hide' : 'Show'} completed
            </button>
          </div>
        </div>

        {/* Categories */}
        <div className="space-y-4">
          {sortedCategories.map((category, catIndex) => (
            <CategorySection
              key={category.id}
              id={category.id}
              name={category.name}
              emoji={category.emoji}
              ideas={category.ideas}
              isExpanded={expandedCategories.has(category.id)}
              showCompleted={showCompleted}
              searchQuery={searchQuery}
              onToggleExpand={() => toggleExpand(category.id)}
              onToggleIdea={toggleCompleted}
              onEditIdea={setEditingIdea}
              onRemoveIdea={removeIdea}
              onAddIdea={addIdea}
              catIndex={catIndex}
            />
          ))}

          {/* No results */}
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
          <p>Checkbox = done · Tap text = edit</p>
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

      {/* FAB - Quick Add */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowQuickAdd(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-gradient-to-r from-purple-500 to-amber-500 text-white rounded-full shadow-lg
                   hover:from-purple-600 hover:to-amber-600 flex items-center justify-center transition-all"
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
      </motion.button>

      {/* Modals */}
      <SpinWheel
        open={showWheel}
        categories={sortedCategories}
        onClose={() => setShowWheel(false)}
      />

      <QuickAddModal
        open={showQuickAdd}
        categories={categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))}
        onAdd={addIdea}
        onClose={() => setShowQuickAdd(false)}
      />

      {editingIdea && (
        <EditIdeaModal
          key={editingIdea.id}
          idea={editingIdea}
          categories={categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }))}
          onSave={updateIdea}
          onDelete={removeIdea}
          onClose={() => setEditingIdea(null)}
        />
      )}

      <CategoryManagerModal
        open={showCategoryManager}
        categories={categories.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, ideaCount: c.ideas.length }))}
        pageTitle={pageTitle}
        onRenameCategory={renameCategory}
        onAddCategory={addCategory}
        onDeleteCategory={deleteCategory}
        onSetPageTitle={setPageTitleDB}
        onClose={() => setShowCategoryManager(false)}
      />
    </div>
  );
}
