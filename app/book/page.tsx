'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { playPageFlip, playSubmit, playNotification } from '@/lib/bookSounds';
import { getCurrentUser as getStoredUser, setCurrentUser as persistCurrentUser } from '@/lib/user-session';
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
  const [currentUser, setCurrentUser] = useState<Writer | null>(() => {
    if (typeof window === 'undefined') return null;
    const user = getStoredUser();
    return user === 'daniel' || user === 'huaiyao' ? user : null;
  });
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [content, setContent] = useState('');
  const [expandedSentence, setExpandedSentence] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    queueMicrotask(() => {
      void fetchSentences();
    });
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
  const handleTyping = () => {
    updateTypingStatus(true);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set timeout to clear typing status after 2 seconds of no typing
    typingTimeoutRef.current = setTimeout(() => {
      updateTypingStatus(false);
    }, 2000);
  };

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
      <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-sky-50 to-blue-100 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 flex items-center justify-center p-4">
        <div className="absolute inset-0 pointer-events-none">
          <motion.div
            className="absolute -top-20 -left-20 w-64 h-64 bg-sky-300/35 dark:bg-sky-500/15 rounded-full blur-3xl"
            animate={{ scale: [1, 1.2, 1], x: [0, 18, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute bottom-0 right-0 w-72 h-72 bg-blue-300/30 dark:bg-blue-500/12 rounded-full blur-3xl"
            animate={{ scale: [1.1, 1, 1.1], x: [0, -22, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="relative z-10 w-full max-w-md rounded-3xl border border-white/60 dark:border-white/10 bg-white/85 dark:bg-slate-950/80 backdrop-blur p-6 sm:p-8 shadow-2xl"
        >
          <h1 className="text-3xl font-serif text-slate-950 dark:text-sky-100 text-center">Story Book</h1>
          <p className="mt-2 text-center text-sm text-slate-600 dark:text-slate-300">
            Pick who is writing and continue your shared chapter.
          </p>

          <div className="mt-6 space-y-3">
            {(['daniel', 'huaiyao'] as Writer[]).map((writer) => (
              <motion.button
                key={writer}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  persistCurrentUser(writer);
                  setCurrentUser(writer);
                }}
                className={`w-full rounded-2xl px-5 py-4 text-left text-white shadow-md transition-colors ${
                  writer === 'daniel'
                    ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600'
                    : 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600'
                }`}
              >
                <div className="font-semibold text-lg">{formatWriterName(writer)}</div>
                <div className="text-xs text-white/85 mt-0.5">Enter as writer</div>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-sky-50 to-blue-100 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
          className="w-12 h-12 border-4 border-sky-200 border-t-sky-600 rounded-full"
        />
      </div>
    );
  }

  const writerTheme = currentUser === 'daniel'
    ? {
        chip: 'bg-blue-100 dark:bg-blue-900/45 text-blue-700 dark:text-blue-200 border-blue-300/80 dark:border-blue-700/70',
        turn: 'border-blue-300/80 dark:border-blue-700/70 bg-gradient-to-r from-blue-100/80 to-indigo-100/60 dark:from-blue-900/35 dark:to-indigo-900/25 text-blue-800 dark:text-blue-200',
        button: 'from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600',
      }
    : {
        chip: 'bg-rose-100 dark:bg-rose-900/45 text-rose-700 dark:text-rose-200 border-rose-300/80 dark:border-rose-700/70',
        turn: 'border-rose-300/80 dark:border-rose-700/70 bg-gradient-to-r from-rose-100/80 to-pink-100/60 dark:from-rose-900/35 dark:to-pink-900/25 text-rose-800 dark:text-rose-200',
        button: 'from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600',
      };

  const pageWindowStart = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const pageWindowEnd = Math.min(totalPages, pageWindowStart + 4);
  const visiblePages = Array.from(
    { length: pageWindowEnd - pageWindowStart + 1 },
    (_, index) => pageWindowStart + index
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-sky-50 to-blue-100 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950">
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          className="absolute top-8 left-8 w-56 h-56 bg-sky-300/30 dark:bg-sky-500/15 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], y: [0, -15, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-6 right-8 w-64 h-64 bg-blue-300/30 dark:bg-blue-500/12 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], y: [0, 18, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-16">
        <header className="rounded-3xl border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-950/75 backdrop-blur p-4 sm:p-6 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="text-sm text-sky-700 dark:text-sky-300 hover:text-sky-900 dark:hover:text-sky-100 transition-colors">
              Back home
            </Link>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full border text-xs font-medium ${writerTheme.chip}`}>
                Writing as {formatWriterName(currentUser)}
              </span>
              <ThemeToggle />
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-[0.3em] text-sky-600 dark:text-sky-300">Shared Writing</p>
            <h1 className="text-3xl sm:text-4xl font-serif text-slate-950 dark:text-sky-100 mt-2">Story Book</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
              One sentence each turn. Same story, same product family, better finish.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-4">
            <div className="rounded-xl bg-sky-50/90 dark:bg-sky-500/10 px-3 py-2 border border-sky-100 dark:border-sky-400/15">
              <div className="text-xs text-sky-700 dark:text-sky-200">Sentences</div>
              <div className="text-lg font-semibold text-slate-950 dark:text-white">{sentences.length}</div>
            </div>
            <div className="rounded-xl bg-slate-100/80 dark:bg-white/5 px-3 py-2 border border-slate-200/70 dark:border-white/10">
              <div className="text-xs text-slate-600 dark:text-slate-300">Current page</div>
              <div className="text-lg font-semibold text-slate-950 dark:text-white">{currentPage}</div>
            </div>
            <div className="rounded-xl bg-slate-100/80 dark:bg-white/5 px-3 py-2 border border-slate-200/70 dark:border-white/10">
              <div className="text-xs text-slate-600 dark:text-slate-300">Total pages</div>
              <div className="text-lg font-semibold text-slate-950 dark:text-white">{totalPages}</div>
            </div>
          </div>
        </header>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-6 rounded-2xl border px-4 py-3 sm:px-6 sm:py-4 ${isYourTurn ? writerTheme.turn : 'border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/[0.04] text-slate-700 dark:text-slate-200'}`}
        >
          {isYourTurn ? (
            <div className="flex items-center gap-2 font-medium">
              <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
              Your turn to write.
            </div>
          ) : (
            <div className="font-medium">Waiting for {formatWriterName(currentTurn)} to add the next sentence.</div>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-[28px] bg-gradient-to-b from-sky-500 via-blue-700 to-slate-950 p-1.5 shadow-2xl"
        >
          <div className="rounded-[24px] border border-sky-100/80 bg-slate-50 dark:bg-slate-100 min-h-[420px] p-4 sm:p-7">
            <div className="flex items-center justify-between mb-4 text-sm text-slate-600">
              <span className="font-serif">Page {currentPage}</span>
              <span>{currentPageSentences.length} sentence{currentPageSentences.length === 1 ? '' : 's'} on this page</span>
            </div>

            <div className="space-y-3 sm:space-y-4">
              {currentPageSentences.length === 0 ? (
                <div className="min-h-[280px] flex items-center justify-center text-center px-4">
                  <p className="font-serif italic text-lg text-slate-500">
                    {currentPage === 1 ? 'Begin your first sentence...' : 'This page is ready for the next sentence.'}
                  </p>
                </div>
              ) : (
                currentPageSentences.map((sentence, index) => (
                  <motion.button
                    key={sentence.id}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    onClick={() => setExpandedSentence(expandedSentence === sentence.id ? null : sentence.id)}
                    className={`w-full text-left rounded-2xl border px-4 py-3 transition-shadow hover:shadow-md ${
                      sentence.writer === 'daniel'
                        ? 'border-blue-200 bg-blue-50/85'
                        : 'border-rose-200 bg-rose-50/85'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
                      <span className={sentence.writer === 'daniel' ? 'text-blue-600' : 'text-rose-600'}>
                        {formatWriterName(sentence.writer)}
                      </span>
                      <span className="text-stone-500">
                        {expandedSentence === sentence.id ? 'Hide details' : 'Tap for details'}
                      </span>
                    </div>

                    <p
                      className={`mt-1 text-base sm:text-lg leading-relaxed ${
                        sentence.writer === 'daniel' ? 'text-blue-950' : 'text-rose-950'
                      }`}
                      style={{ fontFamily: 'Georgia, serif' }}
                    >
                      {sentence.content}
                    </p>

                    <AnimatePresence>
                      {expandedSentence === sentence.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2 text-xs text-stone-600"
                        >
                          {formatWriterName(sentence.writer)} - {formatTimestamp(sentence.created_at)}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.button>
                ))
              )}
            </div>
          </div>
        </motion.section>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="px-4 py-2 rounded-full border border-sky-200 bg-sky-50 text-sky-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Prev
          </motion.button>

          {visiblePages.map((page) => (
            <button
              key={page}
              onClick={() => goToPage(page)}
              className={`w-9 h-9 rounded-full text-sm font-medium transition-colors ${
                page === currentPage
                  ? 'bg-sky-700 text-white'
                  : 'bg-sky-50 text-sky-800 hover:bg-sky-100'
              }`}
            >
              {page}
            </button>
          ))}

          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="px-4 py-2 rounded-full border border-sky-200 bg-sky-50 text-sky-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </motion.button>
        </div>

        <section className="max-w-3xl mx-auto mt-8">
          <AnimatePresence mode="wait">
            {isYourTurn ? (
              <motion.form
                key="compose"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                onSubmit={handleSubmit}
                className="rounded-3xl border border-white/70 dark:border-white/10 bg-white/85 dark:bg-slate-950/80 backdrop-blur p-4 sm:p-6 shadow-lg"
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-slate-950 dark:text-sky-100">Write the next sentence</h2>
                  <span className="text-xs text-slate-500 dark:text-slate-300">{content.length}/500</span>
                </div>

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
                  className="w-full min-h-[130px] rounded-2xl border border-sky-100 dark:border-white/10 bg-slate-50 dark:bg-slate-900/70 p-4 resize-none focus:outline-none focus:ring-2 focus:ring-sky-400 text-slate-900 dark:text-slate-100"
                  style={{ fontFamily: 'Georgia, serif', fontSize: '1.05rem' }}
                />

                <motion.button
                  type="submit"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  disabled={!content.trim() || isSubmitting}
                  className={`mt-4 w-full py-3 rounded-2xl bg-gradient-to-r text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed ${writerTheme.button}`}
                >
                  {isSubmitting ? 'Adding...' : 'Add to story'}
                </motion.button>
              </motion.form>
            ) : (
              <motion.div
                key="waiting"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="rounded-3xl border border-white/70 dark:border-white/10 bg-white/80 dark:bg-slate-950/75 text-center p-6 shadow-lg"
              >
                {partnerTyping ? (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.08, 1] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                      className="text-4xl mb-3"
                    >
                      ✍️
                    </motion.div>
                    <p className="font-medium text-sky-900 dark:text-sky-100">
                      {formatWriterName(currentTurn)} is writing right now...
                    </p>
                    <div className="flex justify-center gap-1 mt-3">
                      <span className="w-2 h-2 bg-sky-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-sky-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-sky-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </>
                ) : (
                  <>
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                      className="text-4xl mb-3"
                    >
                      📚
                    </motion.div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      It&apos;s {formatWriterName(currentTurn)}&apos;s turn.
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      You can write again once they add a sentence.
                    </p>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>
    </div>
  );
}
