'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import Link from 'next/link';
import { ThemeToggle } from '../components/ThemeToggle';

interface GratitudeNote {
  id: string;
  from_player: 'daniel' | 'huaiyao';
  to_player: 'daniel' | 'huaiyao';
  note_text: string;
  category: string;
  emoji: string;
  is_read: boolean;
  created_at: string;
}

const CATEGORY_OPTIONS = [
  { value: 'love', emoji: '💕', label: 'Love' },
  { value: 'gratitude', emoji: '🙏', label: 'Gratitude' },
  { value: 'appreciation', emoji: '✨', label: 'Appreciation' },
  { value: 'encouragement', emoji: '💪', label: 'Encouragement' },
  { value: 'memory', emoji: '📸', label: 'Memory' },
];

export default function Gratitude() {
  useMarkAppViewed('gratitude');
  const [received, setReceived] = useState<GratitudeNote[]>([]);
  const [sent, setSent] = useState<GratitudeNote[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received');
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [showWriteModal, setShowWriteModal] = useState(false);
  const [newNote, setNewNote] = useState({
    text: '',
    category: 'love',
    emoji: '💕',
  });

  const fetchNotes = useCallback(async () => {
    if (!isSupabaseConfigured || !currentUser) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_gratitude_notes', {
        p_player: currentUser,
      });
      if (error) throw error;

      if (data && data.length > 0) {
        setReceived(data[0].received || []);
        setSent(data[0].sent || []);
        setUnreadCount(data[0].unread_count || 0);
      }
    } catch (error) {
      console.error('Error fetching notes:', error);
    }
    setIsLoading(false);
  }, [currentUser]);

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchNotes();
    }
  }, [currentUser, fetchNotes]);

  // Mark notes as read when viewing received tab
  useEffect(() => {
    const markRead = async () => {
      if (activeTab === 'received' && unreadCount > 0 && currentUser) {
        await supabase.rpc('mark_notes_read', { p_player: currentUser });
        setUnreadCount(0);
        setReceived((prev) => prev.map((note) => ({ ...note, is_read: true })));
      }
    };
    markRead();
  }, [activeTab, unreadCount, currentUser]);

  const sendNotification = async (title: string) => {
    if (!currentUser) return;
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gratitude_sent', title, user: currentUser }),
      });
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  const addNote = async () => {
    if (!newNote.text.trim() || !currentUser) return;

    const toPlayer = currentUser === 'daniel' ? 'huaiyao' : 'daniel';

    const { error } = await supabase.rpc('add_gratitude_note', {
      p_from_player: currentUser,
      p_to_player: toPlayer,
      p_note_text: newNote.text.trim(),
      p_category: newNote.category,
      p_emoji: newNote.emoji,
    });

    if (error) {
      console.error('Error adding note:', error);
      return;
    }

    sendNotification(newNote.text.trim().substring(0, 50));
    setNewNote({ text: '', category: 'love', emoji: '💕' });
    setShowWriteModal(false);
    fetchNotes();
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', user);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  // Check if user wrote today
  const today = new Date().toDateString();
  const wroteToday = sent.some((note) => new Date(note.created_at).toDateString() === today);
  const partnerWroteToday = received.some((note) => new Date(note.created_at).toDateString() === today);

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
            💝
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
            Who are you?
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            So we know who your notes are for
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
          className="w-8 h-8 border-4 border-rose-200 border-t-rose-500 rounded-full"
        />
      </div>
    );
  }

  const currentNotes = activeTab === 'received' ? received : sent;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-rose-100/30 dark:bg-rose-900/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-100/30 dark:bg-pink-900/20 rounded-full blur-3xl"
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
              className="px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:text-gray-800 transition-colors touch-manipulation"
            >
              ← Home
            </Link>
            <ThemeToggle />
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
            Gratitude Wall
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Little notes of appreciation
          </p>
        </motion.div>

        {/* Today's Status */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-2xl shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                wroteToday
                  ? 'bg-green-100 dark:bg-green-900/30'
                  : 'bg-gray-100 dark:bg-gray-700'
              }`}>
                <span className="text-lg">{wroteToday ? '✓' : '💭'}</span>
              </div>
              <div>
                <p className="font-medium text-gray-800 dark:text-gray-100">
                  {wroteToday ? "You've shared gratitude today" : "Write something today?"}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {partnerWroteToday
                    ? `${partnerName} left you a note today 💝`
                    : `${partnerName} hasn't written yet`}
                </p>
              </div>
            </div>
            {!wroteToday && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowWriteModal(true)}
                className="px-4 py-2 bg-rose-500 text-white rounded-lg text-sm font-medium"
              >
                Write
              </motion.button>
            )}
          </div>
        </motion.div>

        {/* Write note button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowWriteModal(true)}
          className="w-full mb-6 p-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white rounded-xl
                     font-medium shadow-lg hover:shadow-xl transition-shadow"
        >
          Write a note to {partnerName} 💝
        </motion.button>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('received')}
            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-colors relative ${
              activeTab === 'received'
                ? 'bg-white dark:bg-gray-800 shadow-sm text-gray-800 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Received
            {unreadCount > 0 && activeTab !== 'received' && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-xs rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('sent')}
            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-colors ${
              activeTab === 'sent'
                ? 'bg-white dark:bg-gray-800 shadow-sm text-gray-800 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Sent
          </button>
        </div>

        {/* Notes */}
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {currentNotes.length > 0 ? (
              currentNotes.map((note, index) => (
                <motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ delay: index * 0.05 }}
                  className={`relative p-5 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-2xl shadow-sm ${
                    !note.is_read && activeTab === 'received' ? 'ring-2 ring-rose-300' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{note.emoji}</span>
                    <div className="flex-1">
                      <p className="text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
                        {note.note_text}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-sm text-gray-400">
                        <span>
                          {activeTab === 'received' ? `From ${note.from_player === 'daniel' ? 'Daniel' : 'Huaiyao'}` : `To ${note.to_player === 'daniel' ? 'Daniel' : 'Huaiyao'}`}
                        </span>
                        <span>·</span>
                        <span>{formatDate(note.created_at)}</span>
                      </div>
                    </div>
                  </div>
                  {!note.is_read && activeTab === 'received' && (
                    <div className="absolute top-3 right-3 w-2 h-2 bg-rose-500 rounded-full" />
                  )}
                </motion.div>
              ))
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12 text-gray-400 dark:text-gray-500"
              >
                <div className="text-5xl mb-4">
                  {activeTab === 'received' ? '📭' : '✉️'}
                </div>
                <p>
                  {activeTab === 'received'
                    ? `No notes yet. Maybe ${partnerName} will write one soon!`
                    : `You haven't written any notes yet. Send some love!`}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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

      {/* Write Modal */}
      <AnimatePresence>
        {showWriteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setShowWriteModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
                Write to {partnerName}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Category
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORY_OPTIONS.map((cat) => (
                      <button
                        key={cat.value}
                        onClick={() => setNewNote({ ...newNote, category: cat.value, emoji: cat.emoji })}
                        className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                          newNote.category === cat.value
                            ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {cat.emoji} {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Your note
                  </label>
                  <textarea
                    value={newNote.text}
                    onChange={(e) => setNewNote({ ...newNote, text: e.target.value })}
                    placeholder={`Tell ${partnerName} something sweet...`}
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl
                               bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                               focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowWriteModal(false)}
                  className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800
                             dark:hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addNote}
                  disabled={!newNote.text.trim()}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-rose-500 to-pink-500 text-white
                             rounded-xl font-medium hover:from-rose-600 hover:to-pink-600
                             disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Send 💝
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
