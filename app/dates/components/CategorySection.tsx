'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DateIdea } from '@/lib/supabase';
import IdeaItem from './IdeaItem';

interface CategorySectionProps {
  id: string;
  name: string;
  emoji: string;
  ideas: DateIdea[];
  isExpanded: boolean;
  showCompleted: boolean;
  searchQuery: string;
  onToggleExpand: () => void;
  onToggleIdea: (idea: DateIdea) => void;
  onEditIdea: (idea: DateIdea) => void;
  onRemoveIdea: (idea: DateIdea) => void;
  onAddIdea: (categoryId: string, title: string, description: string) => Promise<void>;
  catIndex: number;
}

export default function CategorySection({
  id,
  name,
  emoji,
  ideas,
  isExpanded,
  showCompleted,
  searchQuery,
  onToggleExpand,
  onToggleIdea,
  onEditIdea,
  onRemoveIdea,
  onAddIdea,
  catIndex,
}: CategorySectionProps) {
  const [addingIdea, setAddingIdea] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const categoryCompleted = ideas.filter((i) => i.is_completed).length;
  const isSearching = searchQuery.trim().length > 0;

  // Filter by search query
  const searchFiltered = isSearching
    ? ideas.filter((i) =>
        i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : ideas;

  // Filter by completed visibility
  const visibleIdeas = showCompleted
    ? searchFiltered
    : searchFiltered.filter((i) => !i.is_completed);

  // Hide category if searching and no matches
  if (isSearching && searchFiltered.length === 0) {
    return null;
  }

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    await onAddIdea(id, newTitle.trim(), newDescription.trim());
    setNewTitle('');
    setNewDescription('');
    setAddingIdea(false);
  };

  const shouldExpand = isSearching || isExpanded;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: catIndex * 0.05 }}
      className="bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-xl shadow-sm overflow-hidden"
    >
      {/* Category header */}
      <button
        onClick={onToggleExpand}
        className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50/50 dark:hover:bg-gray-700/50 active:bg-gray-100/50 dark:active:bg-gray-600/50 transition-colors touch-manipulation"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{emoji}</span>
          <span className="font-medium text-gray-800 dark:text-gray-100 text-base">{name}</span>
          <span className="text-sm text-gray-400 dark:text-gray-500">
            {categoryCompleted}/{ideas.length}
          </span>
        </div>
        <motion.span
          animate={{ rotate: shouldExpand ? 180 : 0 }}
          className="text-gray-400"
        >
          ▼
        </motion.span>
      </button>

      {/* Ideas list */}
      <AnimatePresence>
        {shouldExpand && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-1">
              {visibleIdeas.map((idea) => (
                <IdeaItem
                  key={idea.id}
                  idea={idea}
                  onToggle={onToggleIdea}
                  onEdit={onEditIdea}
                  onRemove={onRemoveIdea}
                />
              ))}
              {visibleIdeas.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">
                  {isSearching ? 'No matches' : 'All done in this category! 🎉'}
                </p>
              )}

              {/* Inline add idea */}
              {addingIdea ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="pt-2 border-t border-gray-100 dark:border-gray-700 mt-2"
                >
                  <input
                    type="text"
                    placeholder="Idea title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) handleAdd(); }}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) handleAdd(); }}
                    className="w-full px-3 py-2 mt-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleAdd}
                      disabled={!newTitle.trim()}
                      className="flex-1 px-3 py-2 text-sm bg-purple-500 text-white rounded-lg
                                 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setAddingIdea(false);
                        setNewTitle('');
                        setNewDescription('');
                      }}
                      className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              ) : (
                <button
                  onClick={() => setAddingIdea(true)}
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
}
