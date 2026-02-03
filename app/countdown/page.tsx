'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { ThemeToggle } from '../components/ThemeToggle';

interface ImportantDate {
  id: string;
  title: string;
  event_date: string;
  is_recurring: boolean;
  category: 'anniversary' | 'birthday' | 'trip' | 'event';
  emoji: string;
  created_by: 'daniel' | 'huaiyao';
  created_at: string;
  days_until: number;
  next_occurrence: string;
}

interface PastEvent extends ImportantDate {
  actual_date: string; // The date that just passed
}

const CATEGORY_OPTIONS = [
  { value: 'anniversary', label: 'Anniversary', emoji: '💕' },
  { value: 'birthday', label: 'Birthday', emoji: '🎂' },
  { value: 'trip', label: 'Trip', emoji: '✈️' },
  { value: 'event', label: 'Event', emoji: '📅' },
];

export default function Countdown() {
  useMarkAppViewed('countdown');
  const [dates, setDates] = useState<ImportantDate[]>([]);
  const [pastEvents, setPastEvents] = useState<PastEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [savingEvent, setSavingEvent] = useState<PastEvent | null>(null);
  const [memoryDescription, setMemoryDescription] = useState('');
  const [memoryPhotos, setMemoryPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [savingMemory, setSavingMemory] = useState(false);
  const [newDate, setNewDate] = useState({
    title: '',
    event_date: '',
    is_recurring: false,
    category: 'event' as const,
    emoji: '📅',
  });

  const fetchDates = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_important_dates');
      if (error) throw error;

      // Separate upcoming events and recently passed events (for memory saving)
      const upcoming: ImportantDate[] = [];
      const past: PastEvent[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const date of (data || [])) {
        if (date.days_until < 0 && !date.is_recurring) {
          // Past non-recurring event - candidate for saving to memories
          past.push({
            ...date,
            actual_date: date.event_date,
          });
        } else if (date.is_recurring) {
          // For recurring events, check if this year's occurrence just passed
          const eventDate = new Date(date.event_date);
          const thisYearOccurrence = new Date(today.getFullYear(), eventDate.getMonth(), eventDate.getDate());

          // If this year's date hasn't happened yet, it's in the future
          if (thisYearOccurrence > today) {
            upcoming.push(date);
          } else {
            // This year's date has passed - check if it was within last 14 days
            const daysSincePassed = Math.floor((today.getTime() - thisYearOccurrence.getTime()) / (1000 * 60 * 60 * 24));

            if (daysSincePassed <= 14) {
              // Recently passed recurring event - prompt to save as memory
              past.push({
                ...date,
                actual_date: thisYearOccurrence.toISOString().split('T')[0],
              });
            }
            // Always show recurring events in upcoming (for next occurrence)
            upcoming.push(date);
          }
        } else {
          upcoming.push(date);
        }
      }

      setDates(upcoming);
      setPastEvents(past);
    } catch (error) {
      console.error('Error fetching dates:', error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);
    fetchDates();
  }, [fetchDates]);

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

  const addDate = async () => {
    if (!newDate.title.trim() || !newDate.event_date || !currentUser) return;

    const { error } = await supabase.rpc('add_important_date', {
      p_title: newDate.title.trim(),
      p_event_date: newDate.event_date,
      p_is_recurring: newDate.is_recurring,
      p_category: newDate.category,
      p_emoji: newDate.emoji,
      p_created_by: currentUser,
    });

    if (error) {
      console.error('Error adding date:', error);
      return;
    }

    sendNotification('date_added', newDate.title.trim());
    setNewDate({ title: '', event_date: '', is_recurring: false, category: 'event', emoji: '📅' });
    setShowAddModal(false);
    fetchDates();
  };

  const deleteDate = async (id: string, title: string) => {
    const { error } = await supabase.rpc('delete_important_date', { p_id: id });
    if (error) {
      console.error('Error deleting date:', error);
      return;
    }
    sendNotification('date_removed', title);
    fetchDates();
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newPhotos = [...memoryPhotos, ...files].slice(0, 5);
    setMemoryPhotos(newPhotos);

    const newPreviewUrls = newPhotos.map((file) => URL.createObjectURL(file));
    photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    setPhotoPreviewUrls(newPreviewUrls);
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photoPreviewUrls[index]);
    setMemoryPhotos(memoryPhotos.filter((_, i) => i !== index));
    setPhotoPreviewUrls(photoPreviewUrls.filter((_, i) => i !== index));
  };

  const openMemoryModal = (event: PastEvent) => {
    setSavingEvent(event);
    setMemoryDescription('');
    setMemoryPhotos([]);
    setPhotoPreviewUrls([]);
    setShowMemoryModal(true);
  };

  const saveToMemories = async () => {
    if (!savingEvent || !currentUser) return;

    setSavingMemory(true);
    try {
      // Create the memory
      const { data: memoryData, error } = await supabase.rpc('add_memory', {
        p_created_by: currentUser,
        p_memory_type: 'moment',
        p_title: `${savingEvent.emoji} ${savingEvent.title}`,
        p_description: memoryDescription.trim() || null,
        p_memory_date: savingEvent.actual_date,
        p_location_name: null,
        p_location_lat: null,
        p_location_lng: null,
        p_tags: [savingEvent.category],
      });

      if (error) throw error;

      // Upload photos if any
      if (memoryPhotos.length > 0 && memoryData?.id) {
        for (const file of memoryPhotos) {
          const fileExt = file.name.split('.').pop();
          const fileName = `${memoryData.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('memory-photos')
            .upload(fileName, file);

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage
              .from('memory-photos')
              .getPublicUrl(fileName);

            await supabase.from('memory_photos').insert({
              memory_id: memoryData.id,
              photo_url: publicUrl,
            });
          }
        }
      }

      // Delete the countdown event only if it's not recurring
      if (!savingEvent.is_recurring) {
        await supabase.rpc('delete_important_date', { p_id: savingEvent.id });
      }

      // Clean up
      photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
      setShowMemoryModal(false);
      setSavingEvent(null);
      setMemoryDescription('');
      setMemoryPhotos([]);
      setPhotoPreviewUrls([]);

      fetchDates();
      alert('Saved to memories! ✨');
    } catch (error) {
      console.error('Error saving to memories:', error);
      alert('Failed to save. Please try again.');
    } finally {
      setSavingMemory(false);
    }
  };

  const dismissPastEvent = async (event: PastEvent) => {
    if (event.is_recurring) {
      // For recurring events, just hide from the past list (don't delete)
      setPastEvents(pastEvents.filter((e) => e.id !== event.id));
    } else {
      if (!confirm('Remove this without saving to memories?')) return;
      await supabase.rpc('delete_important_date', { p_id: event.id });
      fetchDates();
    }
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', user);
  };

  const formatDaysUntil = (days: number) => {
    if (days === 0) return "Today!";
    if (days === 1) return "Tomorrow";
    if (days < 0) return `${Math.abs(days)} days ago`;
    return `${days} days`;
  };

  const heroDate = dates[0];

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
            ⏰
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-4">
            Who are you?
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            So we know who added each date
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
          className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-100/30 dark:bg-amber-900/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-rose-100/30 dark:bg-rose-900/20 rounded-full blur-3xl"
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
            Countdown
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Important dates to look forward to
          </p>
        </motion.div>

        {/* Hero countdown */}
        {heroDate && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-8 p-6 sm:p-8 bg-gradient-to-br from-amber-500 to-rose-500 rounded-2xl text-white shadow-xl"
          >
            <div className="text-center">
              <motion.div
                className="text-5xl sm:text-6xl mb-4"
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                {heroDate.emoji}
              </motion.div>
              <h2 className="text-xl sm:text-2xl font-serif font-semibold mb-2">
                {heroDate.title}
              </h2>
              <div className="text-4xl sm:text-5xl font-bold mb-2">
                {formatDaysUntil(heroDate.days_until)}
              </div>
              <p className="text-white/80 text-sm">
                {new Date(heroDate.next_occurrence).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
              {heroDate.is_recurring && (
                <span className="inline-block mt-2 px-2 py-1 bg-white/20 rounded-full text-xs">
                  Recurring yearly
                </span>
              )}
            </div>
          </motion.div>
        )}

        {/* Add date button */}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowAddModal(true)}
          className="w-full mb-6 p-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl
                     text-gray-500 dark:text-gray-400 hover:border-amber-400 hover:text-amber-500
                     dark:hover:border-amber-500 dark:hover:text-amber-400 transition-colors"
        >
          + Add important date
        </motion.button>

        {/* Date list */}
        <div className="space-y-3">
          {dates.slice(1).map((date, index) => (
            <motion.div
              key={date.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="group p-4 bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-xl shadow-sm
                         hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-4">
                <span className="text-3xl">{date.emoji}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-800 dark:text-gray-100 truncate">
                    {date.title}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {new Date(date.next_occurrence).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                    {date.is_recurring && ' · Yearly'}
                  </p>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-semibold ${
                    date.days_until <= 7 ? 'text-amber-500' : 'text-gray-600 dark:text-gray-300'
                  }`}>
                    {formatDaysUntil(date.days_until)}
                  </div>
                </div>
                <button
                  onClick={() => deleteDate(date.id, date.title)}
                  className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500
                             transition-all touch-manipulation"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {dates.length === 0 && pastEvents.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12 text-gray-400 dark:text-gray-500"
          >
            <div className="text-5xl mb-4">📅</div>
            <p>No dates yet. Add your first important date!</p>
          </motion.div>
        )}

        {/* Past Events - Save to Memories */}
        {pastEvents.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8"
          >
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
              <span>✨</span> Save These Memories
            </h2>
            <div className="space-y-3">
              {pastEvents.map((event) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="p-4 bg-gradient-to-r from-amber-50 to-rose-50 dark:from-amber-900/20 dark:to-rose-900/20
                             border border-amber-200 dark:border-amber-800 rounded-xl"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-2xl">{event.emoji}</span>
                    <div className="flex-1">
                      <h3 className="font-medium text-gray-800 dark:text-gray-100">
                        {event.title}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(event.actual_date).toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                    {event.is_recurring
                      ? "This year's event has passed! Would you like to save it as a memory?"
                      : "This event has passed! Would you like to save it as a memory?"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openMemoryModal(event)}
                      className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-lg font-medium
                                 hover:bg-amber-600 transition-colors flex items-center justify-center gap-2"
                    >
                      <span>📸</span> Save to Memories
                    </button>
                    <button
                      onClick={() => dismissPastEvent(event)}
                      className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300
                                 transition-colors"
                    >
                      {event.is_recurring ? 'Not this time' : 'Dismiss'}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
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
                Add Important Date
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    value={newDate.title}
                    onChange={(e) => setNewDate({ ...newDate, title: e.target.value })}
                    placeholder="e.g., Our Anniversary"
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl
                               bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                               focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={newDate.event_date}
                    onChange={(e) => setNewDate({ ...newDate, event_date: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl
                               bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                               focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Category
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {CATEGORY_OPTIONS.map((cat) => (
                      <button
                        key={cat.value}
                        onClick={() => setNewDate({ ...newDate, category: cat.value as typeof newDate.category, emoji: cat.emoji })}
                        className={`p-2 rounded-lg border-2 text-sm transition-colors ${
                          newDate.category === cat.value
                            ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/30'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                        }`}
                      >
                        <span className="mr-1">{cat.emoji}</span>
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newDate.is_recurring}
                    onChange={(e) => setNewDate({ ...newDate, is_recurring: e.target.checked })}
                    className="w-5 h-5 rounded border-gray-300 text-amber-500 focus:ring-amber-300"
                  />
                  <span className="text-gray-700 dark:text-gray-300">Repeats every year</span>
                </label>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800
                             dark:hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addDate}
                  disabled={!newDate.title.trim() || !newDate.event_date}
                  className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-xl font-medium
                             hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Add Date
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save to Memory Modal */}
      <AnimatePresence>
        {showMemoryModal && savingEvent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setShowMemoryModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
                Save to Memories
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {savingEvent.emoji} {savingEvent.title} • {new Date(savingEvent.actual_date).toLocaleDateString()}
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    How was it? (optional)
                  </label>
                  <textarea
                    value={memoryDescription}
                    onChange={(e) => setMemoryDescription(e.target.value)}
                    placeholder="Share your thoughts about this event..."
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl
                               bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100
                               focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Add Photos (optional)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoSelect}
                    className="hidden"
                    id="memory-photos"
                  />
                  <label
                    htmlFor="memory-photos"
                    className="block w-full p-4 border-2 border-dashed border-gray-300 dark:border-gray-600
                               rounded-xl text-center text-gray-500 dark:text-gray-400 cursor-pointer
                               hover:border-amber-400 hover:text-amber-500 transition-colors"
                  >
                    📷 Tap to add photos (max 5)
                  </label>

                  {photoPreviewUrls.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {photoPreviewUrls.map((url, index) => (
                        <div key={index} className="relative aspect-square">
                          <img
                            src={url}
                            alt={`Preview ${index + 1}`}
                            className="w-full h-full object-cover rounded-lg"
                          />
                          <button
                            onClick={() => removePhoto(index)}
                            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full
                                       text-sm flex items-center justify-center shadow-lg"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
                    setShowMemoryModal(false);
                    setSavingEvent(null);
                    setMemoryPhotos([]);
                    setPhotoPreviewUrls([]);
                  }}
                  className="flex-1 px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800
                             dark:hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveToMemories}
                  disabled={savingMemory}
                  className="flex-1 px-4 py-2 bg-amber-500 text-white rounded-xl font-medium
                             hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {savingMemory ? 'Saving...' : 'Save Memory ✨'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
