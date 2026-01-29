'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, Sentence, Writer, getOtherWriter, isSupabaseConfigured } from '@/lib/supabase';
import { playPageFlip, playNotification } from '@/lib/sounds';
import Page from './Page';
import TurnIndicator from './TurnIndicator';
import WriteInput from './WriteInput';
import BookIntro from './BookIntro';
import StorySummary from './StorySummary';

interface BookProps {
  currentWriter: Writer;
  title?: string;
}

const SENTENCES_PER_PAGE = 8;

export default function Book({ currentWriter, title = 'To be seen...' }: BookProps) {
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [targetPage, setTargetPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [flipDirection, setFlipDirection] = useState<'left' | 'right'>('right');
  const [error, setError] = useState<string | null>(null);
  const [showTurnSplash, setShowTurnSplash] = useState(true);
  const [showIntro, setShowIntro] = useState(() => {
    // Only show intro once per week
    if (typeof window === 'undefined') return true;
    const lastIntro = localStorage.getItem('storybook-last-intro');
    if (!lastIntro) return true;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return parseInt(lastIntro, 10) < weekAgo;
  });
  const [showSummary, setShowSummary] = useState(false);
  const [summaryChecked, setSummaryChecked] = useState(false);

  // Calculate current turn based on last sentence
  const currentTurn: Writer = sentences.length === 0
    ? 'huaiyao'
    : getOtherWriter(sentences[sentences.length - 1].writer);

  // Group sentences into pages
  const pages: Sentence[][] = [];
  for (let i = 0; i < sentences.length; i += SENTENCES_PER_PAGE) {
    pages.push(sentences.slice(i, i + SENTENCES_PER_PAGE));
  }

  if (pages.length === 0) {
    pages.push([]);
  }

  const totalPages = pages.length;
  const currentPageSentences = pages[currentPage - 1] || [];

  // Fetch sentences
  const fetchSentences = useCallback(async (navigateToLatest = false) => {
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured. Please set up your environment variables.');
      setIsLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('sentences')
        .select('*')
        .order('created_at', { ascending: true });

      if (fetchError) {
        console.error('Error fetching sentences:', fetchError);
        setError('Could not connect to the database. Please check your Supabase configuration.');
        setIsLoading(false);
        return;
      }

      const fetchedSentences = data || [];
      setSentences(fetchedSentences);
      setError(null);

      if (navigateToLatest && fetchedSentences.length > 0) {
        const lastPage = Math.ceil(fetchedSentences.length / SENTENCES_PER_PAGE);
        setTargetPage(lastPage);
      }
    } catch (err) {
      console.error('Error:', err);
      setError('An unexpected error occurred.');
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSentences(true);
  }, [fetchSentences]);

  // Show turn splash briefly, then proceed
  useEffect(() => {
    if (!showTurnSplash || isLoading) return;
    const timer = setTimeout(() => {
      setShowTurnSplash(false);
    }, 1800);
    return () => clearTimeout(timer);
  }, [showTurnSplash, isLoading]);

  // When intro is skipped, navigate to target page
  useEffect(() => {
    if (!showTurnSplash && !showIntro && !showSummary && targetPage > 1) {
      setCurrentPage(targetPage);
    }
  }, [showTurnSplash, showIntro, showSummary, targetPage]);

  // Check if we should show summary (first visit of the day)
  useEffect(() => {
    if (isLoading || summaryChecked || sentences.length < 4) return;

    const today = new Date().toDateString();
    const lastVisit = localStorage.getItem('storybook-last-visit');

    if (lastVisit !== today) {
      // New day! Show summary
      localStorage.setItem('storybook-last-visit', today);
      setShowSummary(true);
    }

    setSummaryChecked(true);
  }, [isLoading, sentences.length, summaryChecked]);

  // Realtime subscription + polling fallback (only after intro)
  useEffect(() => {
    if (!isSupabaseConfigured || showIntro) return;

    const channel = supabase
      .channel('sentences-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sentences',
        },
        (payload) => {
          const newSentence = payload.new as Sentence;

          setSentences((prev) => {
            if (prev.some(s => s.id === newSentence.id)) {
              return prev;
            }

            const updated = [...prev, newSentence];
            const newTotalPages = Math.ceil(updated.length / SENTENCES_PER_PAGE);
            setCurrentPage(newTotalPages);

            return updated;
          });

          if (newSentence.writer !== currentWriter) {
            playNotification();
          }
        }
      )
      .subscribe();

    const pollInterval = setInterval(async () => {
      const { data } = await supabase
        .from('sentences')
        .select('*')
        .order('created_at', { ascending: true });

      if (data) {
        setSentences((prev) => {
          if (data.length > prev.length) {
            const newTotalPages = Math.ceil(data.length / SENTENCES_PER_PAGE);
            setCurrentPage(newTotalPages);

            const latestSentence = data[data.length - 1];
            if (latestSentence && latestSentence.writer !== currentWriter && data.length > prev.length) {
              playNotification();
            }

            return data;
          }
          return prev;
        });
      }
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [currentWriter, showIntro]);

  // Handle page navigation with nice animation
  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage || isFlipping) return;

    setFlipDirection(page > currentPage ? 'right' : 'left');
    setIsFlipping(true);
    playPageFlip();

    // Small delay to show the flip animation
    setTimeout(() => {
      setCurrentPage(page);
    }, 150);

    setTimeout(() => {
      setIsFlipping(false);
    }, 400);
  };

  // Handle sentence submission
  const handleSubmit = async (content: string) => {
    if (currentTurn !== currentWriter || !isSupabaseConfigured) return;

    setIsSubmitting(true);

    const { error: submitError } = await supabase.from('sentences').insert({
      content,
      writer: currentWriter,
      page_number: totalPages,
    });

    if (submitError) {
      console.error('Error submitting sentence:', submitError);
    } else {
      // Send push notification to partner
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writer: currentWriter, content }),
      }).catch(err => console.error('Notification error:', err));
    }

    setIsSubmitting(false);
  };

  const handleIntroComplete = () => {
    setCurrentPage(targetPage);
    setShowIntro(false);
    localStorage.setItem('storybook-last-intro', Date.now().toString());
  };

  const handleSummaryComplete = useCallback(() => {
    setShowSummary(false);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          className="w-10 h-10 sm:w-12 sm:h-12 border-4 border-[#D4C5B5] border-t-[#8B7355] rounded-full"
        />
      </div>
    );
  }

  // Show turn splash first
  if (showTurnSplash) {
    const isYourTurn = currentTurn === currentWriter;
    const turnName = currentTurn === 'daniel' ? 'Daniel' : 'Huaiyao';

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#FDF8F3] via-[#F5EDE4] to-[#EDE4DA]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.1 }}
          transition={{ duration: 0.4 }}
          className="text-center"
        >
          {isYourTurn ? (
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className="space-y-4"
            >
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="text-6xl sm:text-7xl"
              >
                ✨
              </motion.div>
              <h1 className={`text-3xl sm:text-4xl font-serif ${
                currentWriter === 'daniel' ? 'text-blue-600' : 'text-rose-600'
              }`}>
                Your turn!
              </h1>
              <p className="text-[#8B7355]/70 text-lg">Time to add to the story</p>
            </motion.div>
          ) : (
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className="space-y-4"
            >
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="text-6xl sm:text-7xl"
              >
                📖
              </motion.div>
              <h1 className="text-3xl sm:text-4xl font-serif text-[#8B7355]">
                Waiting for {turnName}
              </h1>
              <p className="text-[#8B7355]/70 text-lg">Check back soon...</p>
            </motion.div>
          )}
        </motion.div>

        {/* Home button */}
        <motion.a
          href="https://daniel-huaiyao.vercel.app"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="fixed top-4 left-4 px-4 py-2 rounded-full text-sm font-medium shadow-lg bg-white/80 text-gray-600 hover:bg-white transition-colors"
        >
          ← Home
        </motion.a>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-3 sm:p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md text-center bg-white/50 backdrop-blur rounded-2xl p-5 sm:p-8 shadow-lg"
        >
          <div className="text-5xl sm:text-6xl mb-4">⚠️</div>
          <h2 className="text-lg sm:text-xl font-serif text-[#8B7355] mb-4">Setup Required</h2>
          <p className="text-[#3D3D3D]/60 mb-6 text-sm sm:text-base">{error}</p>
          <div className="text-left bg-[#D4C5B5]/20 rounded-lg p-3 sm:p-4 text-xs sm:text-sm">
            <p className="font-medium mb-2">To get started:</p>
            <ol className="list-decimal list-inside space-y-1 text-[#3D3D3D]/70">
              <li>Create a Supabase project</li>
              <li>Run the SQL schema</li>
              <li>Add environment variables</li>
              <li>Restart the server</li>
            </ol>
          </div>
        </motion.div>
      </div>
    );
  }

  // Show "Previously on..." summary (first visit of the day)
  if (showSummary) {
    return (
      <StorySummary
        sentences={sentences}
        onComplete={handleSummaryComplete}
      />
    );
  }

  // Show intro animation
  if (showIntro) {
    return (
      <BookIntro
        title={title}
        targetPage={targetPage}
        currentTurn={currentTurn}
        currentWriter={currentWriter}
        onComplete={handleIntroComplete}
      />
    );
  }

  // Page flip variants for smoother animation
  const pageVariants = {
    enter: (direction: 'left' | 'right') => ({
      rotateY: direction === 'right' ? 90 : -90,
      opacity: 0,
      scale: 0.95,
    }),
    center: {
      rotateY: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (direction: 'left' | 'right') => ({
      rotateY: direction === 'right' ? -90 : 90,
      opacity: 0,
      scale: 0.95,
    }),
  };

  return (
    <div className="min-h-screen py-4 sm:py-8 px-2 sm:px-4 flex flex-col items-center">
      {/* Book Title */}
      <motion.h1
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl sm:text-3xl md:text-4xl font-serif text-[#8B7355] mb-4 sm:mb-8 text-center"
      >
        {title}
      </motion.h1>

      {/* Turn Indicator */}
      <TurnIndicator currentTurn={currentTurn} currentWriter={currentWriter} />

      {/* Book Container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-4xl"
        style={{ perspective: '2000px' }}
      >
        {/* Book */}
        <div className="relative book-cover rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden">
          {/* Spine - hidden on mobile */}
          <div className="absolute left-1/2 -translate-x-1/2 w-4 h-full book-spine z-10 hidden md:block" />

          {/* Pages Container */}
          <div className="flex min-h-[350px] sm:min-h-[450px] md:min-h-[550px]">
            {/* Left Page - hidden on mobile */}
            <div className="flex-1 hidden md:block relative" style={{ transformStyle: 'preserve-3d' }}>
              <AnimatePresence mode="wait" custom={flipDirection}>
                <motion.div
                  key={`left-${currentPage}`}
                  custom={flipDirection}
                  variants={pageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    duration: 0.4,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                  className="absolute inset-0"
                  style={{
                    transformOrigin: 'right center',
                    transformStyle: 'preserve-3d',
                  }}
                >
                  {currentPage > 1 ? (
                    <Page
                      sentences={pages[currentPage - 2] || []}
                      pageNumber={currentPage - 1}
                      isLeftPage
                    />
                  ) : (
                    <div className="book-page-left h-full flex items-center justify-center p-8">
                      <div className="text-center text-[#8B7355]/50">
                        <motion.div
                          animate={{ y: [0, -5, 0] }}
                          transition={{ duration: 3, repeat: Infinity }}
                          className="text-5xl mb-4"
                        >
                          📖
                        </motion.div>
                        <p className="font-serif italic text-sm">The beginning of your story</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Right Page */}
            <div className="flex-1 relative" style={{ transformStyle: 'preserve-3d' }}>
              <AnimatePresence mode="wait" custom={flipDirection}>
                <motion.div
                  key={`right-${currentPage}`}
                  custom={flipDirection}
                  variants={pageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    duration: 0.4,
                    ease: [0.4, 0, 0.2, 1],
                  }}
                  className="absolute inset-0"
                  style={{
                    transformOrigin: 'left center',
                    transformStyle: 'preserve-3d',
                  }}
                >
                  <Page
                    sentences={currentPageSentences}
                    pageNumber={currentPage}
                  />
                </motion.div>
              </AnimatePresence>

              {/* Page flip overlay effect */}
              <AnimatePresence>
                {isFlipping && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black pointer-events-none z-20"
                  />
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Page Navigation */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 mt-4 sm:mt-6">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1 || isFlipping}
            className="p-2.5 sm:p-3 rounded-full bg-[#D4C5B5]/30 hover:bg-[#D4C5B5]/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors active:bg-[#8B7355]/30"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-[#8B7355]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </motion.button>

          <span className="text-[#8B7355]/70 font-serif text-sm sm:text-base min-w-[100px] text-center">
            Page {currentPage} of {totalPages}
          </span>

          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages || isFlipping}
            className="p-2.5 sm:p-3 rounded-full bg-[#D4C5B5]/30 hover:bg-[#D4C5B5]/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors active:bg-[#8B7355]/30"
          >
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-[#8B7355]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </motion.button>
        </div>
      </motion.div>

      {/* Write Input */}
      <div className="w-full max-w-2xl mt-4 sm:mt-8 px-1">
        <WriteInput
          currentTurn={currentTurn}
          currentWriter={currentWriter}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
        />
      </div>

      {/* Home button */}
      <motion.a
        href="https://daniel-huaiyao.vercel.app"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed top-2 left-2 sm:top-4 sm:left-4 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium shadow-lg bg-white/80 text-gray-600 hover:bg-white transition-colors"
      >
        ← Home
      </motion.a>

      {/* Writer identity badge */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className={`
          fixed bottom-2 right-2 sm:bottom-4 sm:right-4 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium shadow-lg
          ${currentWriter === 'daniel'
            ? 'bg-blue-100 text-blue-800'
            : 'bg-rose-100 text-rose-800'
          }
        `}
      >
        {currentWriter === 'daniel' ? 'Daniel' : 'Huaiyao'}
      </motion.div>
    </div>
  );
}
