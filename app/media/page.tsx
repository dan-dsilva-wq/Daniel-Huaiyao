'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { ThemeToggle } from '../components/ThemeToggle';

interface MediaItem {
  id: string;
  media_type: 'movie' | 'show' | 'book' | 'restaurant' | 'recipe';
  title: string;
  status: 'queue' | 'in_progress' | 'completed';
  added_by: 'daniel' | 'huaiyao';
  metadata: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  daniel_rating: number | null;
  daniel_review: string | null;
  huaiyao_rating: number | null;
  huaiyao_review: string | null;
  avg_rating: number | null;
}

const MEDIA_TYPES = [
  { value: 'movie', label: 'Movies', emoji: '🎬' },
  { value: 'show', label: 'Shows', emoji: '📺' },
  { value: 'book', label: 'Books', emoji: '📚' },
  { value: 'restaurant', label: 'Restaurants', emoji: '🍽️' },
  { value: 'recipe', label: 'Recipes', emoji: '👨‍🍳' },
];

const STATUS_LABELS = {
  queue: 'To Do',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export default function MediaPage() {
  useMarkAppViewed('media');
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeType, setActiveType] = useState<string>('movie');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState<MediaItem | null>(null);
  const [newItem, setNewItem] = useState({ title: '', notes: '' });
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_media_items', {
        p_media_type: activeType,
      });
      if (error) throw error;
      setMediaItems(data || []);
    } catch (error) {
      console.error('Error fetching media:', error);
    }
    setIsLoading(false);
  }, [activeType]);

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sendNotification = async (title: string) => {
    if (!currentUser) return;
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'media_added', title, user: currentUser }),
      });
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  const addItem = async () => {
    if (!newItem.title.trim() || !currentUser) return;

    try {
      const { error } = await supabase.rpc('add_media_item', {
        p_media_type: activeType,
        p_title: newItem.title.trim(),
        p_added_by: currentUser,
        p_notes: newItem.notes.trim() || null,
      });

      if (error) throw error;
      sendNotification(newItem.title.trim());
      setNewItem({ title: '', notes: '' });
      setShowAddModal(false);
      fetchData();
    } catch (error) {
      console.error('Error adding item:', error);
    }
  };

  const updateStatus = async (itemId: string, newStatus: string) => {
    try {
      const { error } = await supabase.rpc('update_media_status', {
        p_media_id: itemId,
        p_status: newStatus,
      });
      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const submitRating = async () => {
    if (!showRatingModal || !currentUser || rating === 0) return;

    try {
      const { error } = await supabase.rpc('rate_media', {
        p_media_id: showRatingModal.id,
        p_player: currentUser,
        p_rating: rating,
        p_review: review.trim() || null,
      });

      if (error) throw error;
      setShowRatingModal(null);
      setRating(0);
      setReview('');
      fetchData();
    } catch (error) {
      console.error('Error rating:', error);
    }
  };

  const deleteItem = async (itemId: string) => {
    try {
      const { error } = await supabase.rpc('delete_media_item', { p_media_id: itemId });
      if (error) throw error;
      fetchData();
    } catch (error) {
      console.error('Error deleting:', error);
    }
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', user);
  };

  const getMyRating = (item: MediaItem) => {
    return currentUser === 'daniel' ? item.daniel_rating : item.huaiyao_rating;
  };

  const currentTypeInfo = MEDIA_TYPES.find((t) => t.value === activeType)!;
  const queueItems = mediaItems.filter((m) => m.status === 'queue');
  const inProgressItems = mediaItems.filter((m) => m.status === 'in_progress');
  const completedItems = mediaItems.filter((m) => m.status === 'completed');

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
            🎬
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
            Who are you?
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            Track what to watch, read, and eat together
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
          className="w-8 h-8 border-4 border-violet-200 border-t-violet-500 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-100/30 dark:bg-violet-900/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-fuchsia-100/30 dark:bg-fuchsia-900/20 rounded-full blur-3xl"
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
              className="px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:text-gray-800 transition-colors touch-manipulation"
            >
              ← Home
            </a>
            <ThemeToggle />
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
            Media Tracker
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            What to watch, read, and try together
          </p>
        </motion.div>

        {/* Type tabs */}
        <div className="flex gap-1 mb-6 overflow-x-auto pb-2">
          {MEDIA_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => setActiveType(type.value)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl font-medium transition-all text-sm ${
                activeType === type.value
                  ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-lg'
                  : 'bg-white/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800'
              }`}
            >
              {type.emoji} {type.label}
            </button>
          ))}
        </div>

        {/* Add button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowAddModal(true)}
          className="w-full mb-6 p-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white rounded-xl
                     font-medium shadow-lg hover:shadow-xl transition-shadow"
        >
          + Add {currentTypeInfo.label.toLowerCase().slice(0, -1)}
        </motion.button>

        {/* Media sections */}
        {['queue', 'in_progress', 'completed'].map((status) => {
          const items = status === 'queue' ? queueItems : status === 'in_progress' ? inProgressItems : completedItems;
          if (items.length === 0) return null;

          return (
            <div key={status} className="mb-8">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 flex items-center gap-2">
                {STATUS_LABELS[status as keyof typeof STATUS_LABELS]}
                <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded-full text-xs">
                  {items.length}
                </span>
              </h2>
              <div className="space-y-3">
                {items.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-xl p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{currentTypeInfo.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-800 dark:text-gray-100 truncate">
                          {item.title}
                        </h3>
                        {item.notes && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {item.notes}
                          </p>
                        )}
                        {item.avg_rating && (
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-amber-400">
                              {'★'.repeat(Math.round(item.avg_rating))}
                              {'☆'.repeat(5 - Math.round(item.avg_rating))}
                            </span>
                            <span className="text-sm text-gray-400">
                              {item.avg_rating.toFixed(1)}
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          Added by {item.added_by === 'daniel' ? 'Daniel' : 'Huaiyao'}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        {status !== 'completed' && (
                          <button
                            onClick={() => updateStatus(item.id, status === 'queue' ? 'in_progress' : 'completed')}
                            className="px-3 py-1 text-xs bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 rounded-lg hover:bg-violet-200 dark:hover:bg-violet-900"
                          >
                            {status === 'queue' ? 'Start' : 'Done'}
                          </button>
                        )}
                        {(status === 'in_progress' || status === 'completed') && !getMyRating(item) && (
                          <button
                            onClick={() => {
                              setShowRatingModal(item);
                              setRating(0);
                              setReview('');
                            }}
                            className="px-3 py-1 text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900"
                          >
                            Rate
                          </button>
                        )}
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="opacity-0 group-hover:opacity-100 px-3 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-opacity"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}

        {mediaItems.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12 text-gray-400 dark:text-gray-500"
          >
            <div className="text-5xl mb-4">{currentTypeInfo.emoji}</div>
            <p>No {currentTypeInfo.label.toLowerCase()} yet.</p>
            <p className="text-sm mt-2">Add something to track!</p>
          </motion.div>
        )}

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 dark:text-gray-500 text-sm"
        >
          <p>
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
              className="underline hover:text-gray-600 dark:hover:text-gray-300"
            >
              Switch
            </button>
          </p>
        </motion.footer>
      </main>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
                Add {currentTypeInfo.emoji} {currentTypeInfo.label.slice(0, -1)}
              </h2>

              <div className="space-y-4">
                <input
                  type="text"
                  value={newItem.title}
                  onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                  placeholder="Title"
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl
                             bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                             focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
                <textarea
                  value={newItem.notes}
                  onChange={(e) => setNewItem({ ...newItem, notes: e.target.value })}
                  placeholder="Notes (optional)"
                  rows={2}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl
                             bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                             focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={addItem}
                  disabled={!newItem.title.trim()}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white
                             rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rating Modal */}
      <AnimatePresence>
        {showRatingModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setShowRatingModal(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
                Rate: {showRatingModal.title}
              </h2>

              <div className="space-y-4 mt-4">
                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setRating(star)}
                      className={`text-3xl transition-transform hover:scale-110 ${
                        star <= rating ? 'text-amber-400' : 'text-gray-300 dark:text-gray-600'
                      }`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <textarea
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  placeholder="Review (optional)"
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl
                             bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                             focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowRatingModal(null)}
                  className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={submitRating}
                  disabled={rating === 0}
                  className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-xl font-medium
                             disabled:opacity-50 disabled:cursor-not-allowed hover:bg-amber-600"
                >
                  Submit Rating
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
