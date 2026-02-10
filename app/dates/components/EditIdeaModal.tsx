'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DateIdea } from '@/lib/supabase';

interface EditIdeaModalProps {
  idea: DateIdea;
  categories: { id: string; name: string; emoji: string }[];
  onSave: (ideaId: string, title: string, description: string | null, categoryId: string) => Promise<void>;
  onDelete: (idea: DateIdea) => void;
  onClose: () => void;
}

export default function EditIdeaModal({ idea, categories, onSave, onDelete, onClose }: EditIdeaModalProps) {
  const [title, setTitle] = useState(idea.title);
  const [description, setDescription] = useState(idea.description || '');
  const [categoryId, setCategoryId] = useState(idea.category_id);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(idea.id, title.trim(), description.trim() || null, categoryId);
    setSaving(false);
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-md"
        >
          <h2 className="text-lg font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
            Edit Idea
          </h2>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
                placeholder="Optional"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">Category</label>
              <select
                value={categoryId}
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
          </div>

          <div className="flex gap-2 mt-5">
            <button
              onClick={handleSave}
              disabled={!title.trim() || saving}
              className="flex-1 px-4 py-2.5 bg-purple-500 text-white font-medium rounded-xl
                         hover:bg-purple-600 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { onDelete(idea); onClose(); }}
              className="px-4 py-2.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium rounded-xl transition-colors"
            >
              Delete
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-medium rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
