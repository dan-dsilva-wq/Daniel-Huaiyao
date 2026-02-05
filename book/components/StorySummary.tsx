'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sentence } from '@/lib/supabase';
import { playSummaryAmbient } from '@/lib/sounds';

interface StorySummaryProps {
  sentences: Sentence[];
  onComplete: () => void;
}

export default function StorySummary({ sentences, onComplete }: StorySummaryProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [phase, setPhase] = useState<'loading' | 'showing' | 'fading'>('loading');
  const [showButton, setShowButton] = useState(false);

  const [particleData] = useState(() =>
    [...Array(20)].map(() => ({
      x: Math.random() * 1000,
      y: Math.random() * 800,
      duration: 5 + Math.random() * 5,
      delay: Math.random() * 5,
    }))
  );

  useEffect(() => {
    async function fetchSummary() {
      // Only fetch if there are sentences to summarize
      if (sentences.length < 2) {
        onComplete();
        return;
      }

      try {
        const response = await fetch('/api/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sentences: sentences.slice(-20) }), // Last 20 sentences for context
        });

        const data = await response.json();

        if (data.summary) {
          setSummary(data.summary);
          setPhase('showing');
          setIsLoading(false);
          playSummaryAmbient();
        } else {
          onComplete();
        }
      } catch (error) {
        console.error('Failed to fetch summary:', error);
        onComplete();
      }
    }

    fetchSummary();
  }, [sentences, onComplete]);

  // Show button after 8 seconds
  useEffect(() => {
    if (phase === 'showing') {
      const timer = setTimeout(() => {
        setShowButton(true);
      }, 8000);

      return () => clearTimeout(timer);
    }

    if (phase === 'fading') {
      const timer = setTimeout(() => {
        onComplete();
      }, 1500); // Fade out duration

      return () => clearTimeout(timer);
    }
  }, [phase, onComplete]);

  const handleContinue = () => {
    setPhase('fading');
  };

  return (
    <AnimatePresence>
      {phase !== 'fading' || isLoading ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.5 }}
          className="fixed inset-0 z-50 bg-black flex items-center justify-center p-6"
        >
          {/* Atmospheric background */}
          <div className="absolute inset-0 overflow-hidden">
            <motion.div
              className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-800 to-black"
              animate={{
                background: [
                  'linear-gradient(to bottom, #0f172a, #1e293b, #000)',
                  'linear-gradient(to bottom, #1e293b, #0f172a, #000)',
                  'linear-gradient(to bottom, #0f172a, #1e293b, #000)',
                ],
              }}
              transition={{ duration: 10, repeat: Infinity }}
            />
            {/* Subtle particles/dust effect */}
            {particleData.map((particle, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-1 bg-white/20 rounded-full"
                initial={{
                  x: particle.x,
                  y: particle.y,
                }}
                animate={{
                  y: [null, -100],
                  opacity: [0, 0.5, 0],
                }}
                transition={{
                  duration: particle.duration,
                  repeat: Infinity,
                  delay: particle.delay,
                }}
              />
            ))}
          </div>

          <div className="relative max-w-2xl w-full">
            {isLoading ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center"
              >
                <motion.p
                  className="text-amber-200/60 text-lg font-serif italic"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  Recalling your story...
                </motion.p>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, delay: 0.5 }}
              >
                {/* "Previously on" header */}
                <motion.p
                  initial={{ opacity: 0, letterSpacing: '0.5em' }}
                  animate={{ opacity: 1, letterSpacing: '0.2em' }}
                  transition={{ duration: 1.5 }}
                  className="text-amber-200/80 text-sm uppercase tracking-widest text-center mb-4"
                >
                  Previously on
                </motion.p>

                {/* Title */}
                <motion.h1
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 1, delay: 0.3 }}
                  className="text-3xl sm:text-4xl md:text-5xl font-serif text-amber-100 text-center mb-8"
                >
                  Death on a Desert Island
                </motion.h1>

                {/* Decorative line */}
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 1, delay: 0.6 }}
                  className="w-32 h-px bg-gradient-to-r from-transparent via-amber-200/50 to-transparent mx-auto mb-8"
                />

                {/* Summary text */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 1.5, delay: 1 }}
                  className="space-y-4"
                >
                  {summary?.split('\n\n').map((paragraph, i) => (
                    <motion.p
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 1, delay: 1.2 + i * 0.5 }}
                      className="text-gray-300 text-lg sm:text-xl leading-relaxed font-serif text-center italic"
                    >
                      {paragraph}
                    </motion.p>
                  ))}
                </motion.div>

              </motion.div>
            )}
          </div>

          {/* Continue button - appears after 8 seconds */}
          <AnimatePresence>
            {showButton && !isLoading && (
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                onClick={handleContinue}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 px-8 py-3 bg-amber-200/20 hover:bg-amber-200/30 border border-amber-200/40 rounded-full text-amber-100 font-serif text-lg transition-colors"
              >
                Continue to book →
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
