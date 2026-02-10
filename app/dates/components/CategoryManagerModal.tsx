'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface CategoryInfo {
  id: string;
  name: string;
  emoji: string;
  ideaCount: number;
}

interface CategoryManagerModalProps {
  open: boolean;
  categories: CategoryInfo[];
  pageTitle: string;
  onRenameCategory: (categoryId: string, name: string, emoji: string) => Promise<void>;
  onAddCategory: (name: string, emoji: string) => Promise<void>;
  onDeleteCategory: (categoryId: string, moveToId: string) => Promise<void>;
  onSetPageTitle: (title: string) => Promise<void>;
  onClose: () => void;
}

export default function CategoryManagerModal({
  open,
  categories,
  pageTitle,
  onRenameCategory,
  onAddCategory,
  onDeleteCategory,
  onSetPageTitle,
  onClose,
}: CategoryManagerModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [moveToId, setMoveToId] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(pageTitle);

  if (!open) return null;

  const startEdit = (cat: CategoryInfo) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditEmoji(cat.emoji);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await onRenameCategory(editingId, editName.trim(), editEmoji.trim() || '📌');
    setEditingId(null);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await onAddCategory(newName.trim(), newEmoji.trim() || '📌');
    setNewName('');
    setNewEmoji('');
    setShowAddForm(false);
  };

  const startDelete = (cat: CategoryInfo) => {
    setDeletingId(cat.id);
    const other = categories.find((c) => c.id !== cat.id);
    setMoveToId(other?.id || '');
  };

  const confirmDelete = async () => {
    if (!deletingId || !moveToId) return;
    await onDeleteCategory(deletingId, moveToId);
    setDeletingId(null);
  };

  const saveTitle = async () => {
    if (!titleValue.trim()) return;
    await onSetPageTitle(titleValue.trim());
    setEditingTitle(false);
  };

  const deletingCategory = categories.find((c) => c.id === deletingId);

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
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto"
        >
          <h2 className="text-lg font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
            Manage Categories
          </h2>

          {/* Page title section */}
          <div className="mb-4 pb-4 border-b border-gray-100 dark:border-gray-700">
            <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 block">Page Title</label>
            {editingTitle ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); }}
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300 dark:focus:ring-purple-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                  autoFocus
                />
                <button onClick={saveTitle} className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors">Save</button>
                <button onClick={() => { setEditingTitle(false); setTitleValue(pageTitle); }} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="text-gray-800 dark:text-gray-100 hover:text-purple-500 dark:hover:text-purple-400 transition-colors text-sm"
              >
                {pageTitle} <span className="text-gray-400 text-xs ml-1">(tap to edit)</span>
              </button>
            )}
          </div>

          {/* Delete confirmation overlay */}
          {deletingCategory && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">
              <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
                Delete &quot;{deletingCategory.emoji} {deletingCategory.name}&quot;?
              </p>
              {deletingCategory.ideaCount > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-red-600 dark:text-red-300 mb-1">
                    Move {deletingCategory.ideaCount} idea{deletingCategory.ideaCount !== 1 ? 's' : ''} to:
                  </p>
                  <select
                    value={moveToId}
                    onChange={(e) => setMoveToId(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-red-200 dark:border-red-700 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                  >
                    {categories.filter((c) => c.id !== deletingId).map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.emoji} {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={confirmDelete}
                  disabled={!moveToId && deletingCategory.ideaCount > 0}
                  className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setDeletingId(null)}
                  className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Category list */}
          <div className="space-y-2">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                {editingId === cat.id ? (
                  <div className="flex-1 flex gap-2">
                    <input
                      type="text"
                      value={editEmoji}
                      onChange={(e) => setEditEmoji(e.target.value)}
                      className="w-12 px-2 py-1 text-sm text-center border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                      placeholder="📌"
                    />
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                      className="flex-1 px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                      autoFocus
                    />
                    <button onClick={saveEdit} className="px-2 py-1 text-xs bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
                  </div>
                ) : (
                  <>
                    <span className="text-lg">{cat.emoji}</span>
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-100">{cat.name}</span>
                    <span className="text-xs text-gray-400">{cat.ideaCount}</span>
                    <button
                      onClick={() => startEdit(cat)}
                      className="p-1 text-gray-400 hover:text-purple-500 transition-colors"
                      title="Rename"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    {categories.length > 1 && (
                      <button
                        onClick={() => startDelete(cat)}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Add category form */}
          {showAddForm ? (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newEmoji}
                onChange={(e) => setNewEmoji(e.target.value)}
                className="w-12 px-2 py-1.5 text-sm text-center border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                placeholder="📌"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) handleAdd(); }}
                className="flex-1 px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                placeholder="Category name"
                autoFocus
              />
              <button onClick={handleAdd} disabled={!newName.trim()} className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 transition-colors">Add</button>
              <button onClick={() => { setShowAddForm(false); setNewName(''); setNewEmoji(''); }} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full mt-3 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400
                         border border-dashed border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-500
                         rounded-lg transition-colors"
            >
              + Add category
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="w-full mt-4 py-2.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-medium transition-colors"
          >
            Done
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
