'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface QuickAddModalProps {
  open: boolean;
  categories: { id: string; name: string; emoji: string }[];
  onAdd: (categoryId: string, title: string, description: string) => Promise<void>;
  onClose: () => void;
}

export default function QuickAddModal({ open, categories, onAdd, onClose }: QuickAddModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [adding, setAdding] = useState(false);

  // Default to first category when opening
  const effectiveCategoryId = categoryId || (categories.length > 0 ? categories[0].id : '');

  const reset = () => {
    setTitle('');
    setDescription('');
    // Keep category selection for "Add & Another"
  };

  const handleAdd = async (addAnother: boolean) => {
    if (!title.trim() || !effectiveCategoryId) return;
    setAdding(true);
    await onAdd(effectiveCategoryId, title.trim(), description.trim());
    setAdding(false);
    if (addAnother) {
      setTitle('');
      setDescription('');
    } else {
      reset();
      onClose();
    }
  };

  const handleClose = () => {
    reset();
    setCategoryId('');
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-md"
          >
            <h2 className="text-lg font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
              Add Date Idea
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">Category</label>
                <select
                  value={effectiveCategoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.emoji} {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) handleAdd(false); }}
                  placeholder="e.g. Sunset picnic at the park"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) handleAdd(false); }}
                  placeholder="Optional details"
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => handleAdd(false)}
                disabled={!title.trim() || adding}
                className="flex-1 px-4 py-2.5 bg-purple-500 text-white font-medium rounded-xl
                           hover:bg-purple-600 disabled:opacity-50 transition-colors"
              >
                {adding ? 'Adding...' : 'Add'}
              </button>
              <button
                onClick={() => handleAdd(true)}
                disabled={!title.trim() || adding}
                className="px-4 py-2.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 font-medium rounded-xl
                           hover:bg-purple-200 dark:hover:bg-purple-900/50 disabled:opacity-50 transition-colors"
              >
                Add & Another
              </button>
              <button
                onClick={handleClose}
                className="px-4 py-2.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-medium rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
