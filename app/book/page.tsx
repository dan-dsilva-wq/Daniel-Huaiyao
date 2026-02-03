'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { playPageFlip, playSubmit, playNotification } from '@/lib/bookSounds';
import { ThemeToggle } from '../components/ThemeToggle';

type Writer = 'daniel' | 'huaiyao';

interface Sentence {
  id: string;
  content: string;
  writer: Writer;
  page_number: number;
  created_at: string;
}

const SENTENCES_PER_PAGE = 8;

const getOtherWriter = (writer: Writer): Writer => writer === 'daniel' ? 'huaiyao' : 'daniel';
const formatWriterName = (writer: Writer): string => writer === 'daniel' ? 'Daniel' : 'Huaiyao';

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function StoryBookPage() {
  useMarkAppViewed('book');
  const [currentUser, setCurrentUser] = useState<Writer | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [content, setContent] = useState('');
  const [expandedSentence, setExpandedSentence] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const typingTimeoutRef = useCallback(() => ({ current: null as NodeJS.Timeout | null }), [])();

  // Get current user
  useEffect(() => {
    const user = localStorage.getItem('currentUser') as Writer | null;
    setCurrentUser(user);
  }, []);

  // Calculate current turn
  const currentTurn: Writer = sentences.length === 0
    ? 'huaiyao'
    : getOtherWriter(sentences[sentences.length - 1].writer);

  const isYourTurn = currentUser === currentTurn;

  // Group sentences into pages
  const pages: Sentence[][] = [];
  for (let i = 0; i < sentences.length; i += SENTENCES_PER_PAGE) {
    pages.push(sentences.slice(i, i + SENTENCES_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);
  const totalPages = pages.length;
  const currentPageSentences = pages[currentPage - 1] || [];

  // Fetch sentences
  const fetchSentences = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('book_sentences')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && data) {
      setSentences(data);
      const lastPage = Math.ceil(data.length / SENTENCES_PER_PAGE) || 1;
      setCurrentPage(lastPage);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSentences();
  }, [fetchSentences]);

  // Update typing status
  const updateTypingStatus = useCallback(async (isTyping: boolean) => {
    if (!currentUser || !isSupabaseConfigured) return;

    try {
      await supabase.rpc('set_typing_status', {
        p_player: currentUser,
        p_app_name: 'book',
        p_is_typing: isTyping,
      });
    } catch (err) {
      console.error('Error updating typing status:', err);
    }
  }, [currentUser]);

  // Handle typing indicator
  const handleTyping = useCallback(() => {
    updateTypingStatus(true);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set timeout to clear typing status after 2 seconds of no typing
    typingTimeoutRef.current = setTimeout(() => {
      updateTypingStatus(false);
    }, 2000);
  }, [updateTypingStatus, typingTimeoutRef]);

  // Realtime subscription
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUser) return;

    const partner = currentUser === 'daniel' ? 'huaiyao' : 'daniel';

    const sentenceChannel = supabase
      .channel('book-sentences')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'book_sentences' },
        (payload) => {
          const newSentence = payload.new as Sentence;
          setSentences(prev => {
            if (prev.some(s => s.id === newSentence.id)) return prev;
            const updated = [...prev, newSentence];
            const newTotalPages = Math.ceil(updated.length / SENTENCES_PER_PAGE);
            setCurrentPage(newTotalPages);
            return updated;
          });
          if (newSentence.writer !== currentUser) {
            playNotification();
          }
        }
      )
      .subscribe();

    // Subscribe to partner's typing status
    const typingChannel = supabase
      .channel('book-typing')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'typing_status', filter: `player=eq.${partner}` },
        (payload) => {
          const typingData = payload.new as { is_typing: boolean; app_name: string };
          setPartnerTyping(typingData.is_typing && typingData.app_name === 'book');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sentenceChannel);
      supabase.removeChannel(typingChannel);
      // Clear typing status when component unmounts
      updateTypingStatus(false);
    };
  }, [currentUser, updateTypingStatus]);

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    playPageFlip();
    setCurrentPage(page);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !currentUser || !isYourTurn || isSubmitting) return;

    setIsSubmitting(true);
    const { error } = await supabase.from('book_sentences').insert({
      content: content.trim(),
      writer: currentUser,
      page_number: totalPages,
    });

    if (!error) {
      playSubmit();
      setContent('');
      // Send notification
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'book_sentence',
          title: content.trim().length > 50 ? content.trim().substring(0, 50) + '...' : content.trim(),
          user: currentUser,
        }),
      }).catch(() => {});
    }
    setIsSubmitting(false);
  };

  // User selection
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950 dark:via-stone-900 dark:to-yellow-950 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <h1 className="text-3xl font-serif text-amber-800 dark:text-amber-200 mb-8">Who&apos;s writing?</h1>
          <div className="flex gap-4 justify-center">
            {(['daniel', 'huaiyao'] as Writer[]).map((writer) => (
              <button
                key={writer}
                onClick={() => {
                  localStorage.setItem('currentUser', writer);
                  setCurrentUser(writer);
                }}
                className={`px-8 py-4 rounded-xl font-medium transition-all ${
                  writer === 'daniel'
                    ? 'bg-blue-500 hover:bg-blue-600 text-white'
                    : 'bg-rose-500 hover:bg-rose-600 text-white'
                }`}
              >
                {formatWriterName(writer)}
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950 dark:via-stone-900 dark:to-yellow-950 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          className="w-12 h-12 border-4 border-amber-200 border-t-amber-600 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950 dark:via-stone-900 dark:to-yellow-950 py-6 px-4">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-6">
        <div className="flex items-center justify-between">
          <a href="/" className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200">
            ← Home
          </a>
          <ThemeToggle />
        </div>
      </div>

      {/* Title */}
      <motion.h1
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-3xl md:text-4xl font-serif text-amber-800 dark:text-amber-200 text-center mb-4"
      >
        Our Story
      </motion.h1>

      {/* Turn Indicator */}
      <div className="flex justify-center mb-6">
        <motion.div
          animate={isYourTurn ? { scale: [1, 1.03, 1] } : {}}
          transition={{ repeat: Infinity, duration: 2 }}
          className={`px-6 py-2 rounded-full font-medium ${
            isYourTurn
              ? currentUser === 'daniel'
                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-2 border-blue-400'
                : 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-2 border-rose-400'
              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
          }`}
        >
          {isYourTurn ? (
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
              Your turn!
            </span>
          ) : (
            `Waiting for ${formatWriterName(currentTurn)}...`
          )}
        </motion.div>
      </div>

      {/* Book */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-3xl mx-auto"
      >
        <div className="bg-gradient-to-b from-amber-700 to-amber-900 dark:from-amber-800 dark:to-amber-950 rounded-xl shadow-2xl p-1">
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-100 dark:to-orange-100 rounded-lg min-h-[400px] p-6 md:p-8">
            {/* Page Content */}
            <div className="space-y-4">
              {currentPageSentences.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-amber-400 dark:text-amber-600 font-serif italic">
                  {currentPage === 1 ? 'Begin your story...' : 'Continue writing...'}
                </div>
              ) : (
                currentPageSentences.map((sentence, index) => (
                  <motion.div
                    key={sentence.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setExpandedSentence(expandedSentence === sentence.id ? null : sentence.id)}
                    className={`py-2 px-4 rounded-lg cursor-pointer transition-colors ${
                      sentence.writer === 'daniel'
                        ? 'border-l-4 border-blue-500 bg-blue-50/50 dark:bg-blue-100/30'
                        : 'border-l-4 border-rose-500 bg-rose-50/50 dark:bg-rose-100/30'
                    }`}
                  >
                    <p className={`text-lg md:text-xl leading-relaxed ${
                      sentence.writer === 'daniel' ? 'text-blue-900' : 'text-rose-900'
                    }`} style={{ fontFamily: 'Georgia, serif' }}>
                      {sentence.content}
                    </p>
                    <AnimatePresence>
                      {expandedSentence === sentence.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-xs text-gray-500 dark:text-gray-600 mt-2"
                        >
                          {formatWriterName(sentence.writer)} • {formatTimestamp(sentence.created_at)}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))
              )}
            </div>

            {/* Page Number */}
            <div className="text-center mt-8 text-amber-400 dark:text-amber-600 font-serif text-sm">
              Page {currentPage}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-4 mt-6">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="p-3 rounded-full bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5 text-amber-700 dark:text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </motion.button>

          <span className="text-amber-600 dark:text-amber-400 font-serif min-w-[100px] text-center">
            {currentPage} of {totalPages}
          </span>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="p-3 rounded-full bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5 text-amber-700 dark:text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </motion.button>
        </div>
      </motion.div>

      {/* Write Input */}
      <div className="max-w-2xl mx-auto mt-8">
        <AnimatePresence mode="wait">
          {isYourTurn ? (
            <motion.form
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              <div className="relative">
                <textarea
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    handleTyping();
                  }}
                  onBlur={() => updateTypingStatus(false)}
                  placeholder="Continue the story..."
                  disabled={isSubmitting}
                  maxLength={500}
                  className="w-full p-4 rounded-xl bg-white/80 dark:bg-gray-800/80 border-2 border-dashed border-amber-300 dark:border-amber-600 min-h-[120px] resize-none focus:outline-none focus:border-amber-500 dark:focus:border-amber-400 text-gray-800 dark:text-gray-200"
                  style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}
                />
                <span className="absolute bottom-3 right-3 text-sm text-gray-400">
                  {content.length}/500
                </span>
              </div>
              <motion.button
                type="submit"
                disabled={!content.trim() || isSubmitting}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`w-full py-4 rounded-xl font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                  currentUser === 'daniel'
                    ? 'bg-blue-500 hover:bg-blue-600'
                    : 'bg-rose-500 hover:bg-rose-600'
                }`}
              >
                {isSubmitting ? 'Adding...' : 'Add to our story'}
              </motion.button>
            </motion.form>
          ) : (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center py-8 px-6 bg-amber-100/50 dark:bg-amber-900/30 rounded-xl"
            >
              {partnerTyping ? (
                <>
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="text-4xl mb-4"
                  >
                    ✍️
                  </motion.div>
                  <p className="text-amber-700 dark:text-amber-300 font-serif">
                    {formatWriterName(currentTurn)} is writing...
                  </p>
                  <div className="flex justify-center gap-1 mt-3">
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </>
              ) : (
                <>
                  <motion.div
                    animate={{ y: [0, -5, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="text-4xl mb-4"
                  >
                    ✨
                  </motion.div>
                  <p className="text-amber-700 dark:text-amber-300 font-serif">
                    It&apos;s {formatWriterName(currentTurn)}&apos;s turn to add to your story.
                  </p>
                  <p className="text-amber-500 dark:text-amber-500 text-sm mt-2">
                    You&apos;ll be able to write when they&apos;re done!
                  </p>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Writer badge */}
      <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-full text-sm font-medium shadow-lg ${
        currentUser === 'daniel'
          ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
          : 'bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300'
      }`}>
        {formatWriterName(currentUser)}
      </div>
    </div>
  );
}
