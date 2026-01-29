'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { playPageFlip, playBookOpen } from '@/lib/sounds';
import { Writer, formatWriterName } from '@/lib/supabase';

interface BookIntroProps {
  title: string;
  targetPage: number;
  currentTurn: Writer;
  currentWriter: Writer;
  onComplete: () => void;
}

export default function BookIntro({ title, targetPage, currentTurn, currentWriter, onComplete }: BookIntroProps) {
  const isYourTurn = currentTurn === currentWriter;
  const turnName = formatWriterName(currentTurn);
  const [phase, setPhase] = useState<'cover' | 'opening' | 'flipping' | 'done'>('cover');
  const [currentFlipPage, setCurrentFlipPage] = useState(0);
  const [showSpine, setShowSpine] = useState(false);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    // Phase 1: Show cover (1.2s)
    timers.push(setTimeout(() => {
      setPhase('opening');
      setShowSpine(true);
      playBookOpen();
    }, 1200));

    // Phase 2: Cover opens (0.8s animation)
    timers.push(setTimeout(() => {
      setPhase('flipping');
      playPageFlip();
    }, 2000));

    // Phase 3: Flip through pages
    const flipStartTime = 2200;
    const pagesCount = Math.min(targetPage, 10); // Cap visual flips at 10
    const flipDuration = 120;

    for (let i = 1; i <= pagesCount; i++) {
      timers.push(setTimeout(() => {
        setCurrentFlipPage(i);
        if (i < pagesCount) playPageFlip();
      }, flipStartTime + (i - 1) * flipDuration));
    }

    // Complete
    timers.push(setTimeout(() => {
      setPhase('done');
      onComplete();
    }, flipStartTime + pagesCount * flipDuration + 400));

    return () => timers.forEach(clearTimeout);
  }, [targetPage, onComplete]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-[#FDF8F3] via-[#F5EDE4] to-[#EDE4DA]">
      {/* Ambient light effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-200/20 rounded-full blur-3xl"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-rose-200/20 rounded-full blur-3xl"
          animate={{
            scale: [1.2, 1, 1.2],
            opacity: [0.3, 0.5, 0.3],
          }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div
        className="relative"
        style={{ perspective: '2000px', perspectiveOrigin: '50% 50%' }}
      >
        {/* Book container */}
        <motion.div
          initial={{ rotateX: 10, y: 50, opacity: 0 }}
          animate={{ rotateX: 0, y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="relative"
          style={{ transformStyle: 'preserve-3d' }}
        >
          {/* Back cover (always visible) */}
          <div
            className="absolute inset-0 rounded-r-lg bg-gradient-to-br from-[#6B5344] to-[#4A3A2E]"
            style={{
              transform: 'translateZ(-8px)',
              boxShadow: '0 25px 50px rgba(0,0,0,0.4)'
            }}
          />

          {/* Spine */}
          <AnimatePresence>
            {showSpine && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-[#4A3A2E] via-[#5A4436] to-[#6B5344] rounded-l-lg"
                style={{
                  transform: 'translateZ(-4px) rotateY(-10deg)',
                  transformOrigin: 'right center'
                }}
              />
            )}
          </AnimatePresence>

          {/* Pages stack */}
          <div
            className="absolute inset-1 right-2 bg-gradient-to-r from-[#F5F0E8] to-[#FFFEF7] rounded-r"
            style={{ transform: 'translateZ(-4px)' }}
          >
            {/* Page lines */}
            <div className="absolute right-0 top-2 bottom-2 w-1 flex flex-col justify-evenly">
              {[...Array(20)].map((_, i) => (
                <div key={i} className="h-px bg-[#D4C5B5]" />
              ))}
            </div>
          </div>

          {/* Flipping pages during flip phase */}
          <AnimatePresence>
            {phase === 'flipping' && (
              <>
                {[...Array(Math.min(targetPage, 10))].map((_, i) => (
                  <motion.div
                    key={`flip-${i}`}
                    initial={{ rotateY: 0 }}
                    animate={currentFlipPage > i ? { rotateY: -160 } : { rotateY: 0 }}
                    transition={{
                      duration: 0.15,
                      ease: 'easeIn'
                    }}
                    className="absolute inset-0 bg-gradient-to-r from-[#FFFEF7] to-[#F5F0E8] rounded-r-lg"
                    style={{
                      transformOrigin: 'left center',
                      transformStyle: 'preserve-3d',
                      zIndex: 10 - i,
                      boxShadow: currentFlipPage > i
                        ? '-5px 0 15px rgba(0,0,0,0.1)'
                        : '5px 0 15px rgba(0,0,0,0.05)'
                    }}
                  >
                    {/* Page content - just show page number */}
                    <div className="h-full flex items-center justify-center">
                      <span className="text-4xl sm:text-5xl font-serif text-[#D4C5B5]">
                        {i + 1}
                      </span>
                    </div>
                    {/* Back of page */}
                    <div
                      className="absolute inset-0 bg-gradient-to-l from-[#FFFEF7] to-[#F5F0E8] rounded-l-lg"
                      style={{
                        transform: 'rotateY(180deg)',
                        backfaceVisibility: 'hidden'
                      }}
                    />
                  </motion.div>
                ))}
              </>
            )}
          </AnimatePresence>

          {/* Front cover */}
          <motion.div
            animate={
              phase === 'cover'
                ? { rotateY: 0 }
                : phase === 'opening'
                ? { rotateY: -160 }
                : { rotateY: -170, opacity: 0 }
            }
            transition={{
              duration: phase === 'opening' ? 0.8 : 0.3,
              ease: phase === 'opening' ? [0.4, 0, 0.2, 1] : 'easeOut'
            }}
            className="relative rounded-lg overflow-hidden"
            style={{
              transformOrigin: 'left center',
              transformStyle: 'preserve-3d',
              zIndex: 20
            }}
          >
            {/* Cover front */}
            <div
              className="book-cover rounded-lg p-8 sm:p-12 min-w-[280px] sm:min-w-[340px] min-h-[380px] sm:min-h-[440px] flex flex-col items-center justify-center"
              style={{ backfaceVisibility: 'hidden' }}
            >
              {/* Decorative border */}
              <div className="absolute inset-4 border-2 border-amber-200/30 rounded-lg" />
              <div className="absolute inset-6 border border-amber-200/20 rounded-lg" />

              {/* Book icon */}
              <motion.div
                animate={{
                  y: [0, -8, 0],
                  rotateZ: [0, -2, 2, 0]
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'easeInOut'
                }}
                className="text-6xl sm:text-7xl mb-6 filter drop-shadow-lg"
              >
                📖
              </motion.div>

              {/* Title */}
              <motion.h1
                className="text-2xl sm:text-3xl font-serif text-amber-100 text-center mb-3"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                {title}
              </motion.h1>

              {/* Subtitle */}
              <motion.p
                className="text-amber-200/70 text-sm sm:text-base"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                Daniel & Huaiyao
              </motion.p>

              {/* Decorative flourish */}
              <motion.div
                className="mt-6 flex items-center gap-2 text-amber-200/40"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.7 }}
              >
                <div className="w-8 h-px bg-current" />
                <div className="text-lg">❦</div>
                <div className="w-8 h-px bg-current" />
              </motion.div>
            </div>

            {/* Cover back (inside) */}
            <div
              className="absolute inset-0 bg-gradient-to-r from-[#8B7355] to-[#6B5344] rounded-lg"
              style={{
                transform: 'rotateY(180deg)',
                backfaceVisibility: 'hidden'
              }}
            />
          </motion.div>
        </motion.div>

        {/* Turn indicator - shows immediately */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="absolute -top-20 left-1/2 -translate-x-1/2"
        >
          {isYourTurn ? (
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className={`
                px-5 py-2.5 rounded-full font-medium text-base shadow-lg
                ${currentTurn === 'daniel'
                  ? 'bg-blue-100 text-blue-800 border-2 border-blue-300'
                  : 'bg-rose-100 text-rose-800 border-2 border-rose-300'
                }
              `}
            >
              <span className="flex items-center gap-2">
                <motion.span
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="w-2 h-2 rounded-full bg-current"
                />
                Your turn to write!
              </span>
            </motion.div>
          ) : (
            <div className="px-5 py-2.5 rounded-full bg-white/70 text-[#8B7355] font-medium text-base shadow-lg border border-[#D4C5B5]">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-current opacity-50" />
                Waiting for {turnName}
              </span>
            </div>
          )}
        </motion.div>

        {/* Progress indicator */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="absolute -bottom-16 left-1/2 -translate-x-1/2 text-center"
        >
          {phase === 'cover' && (
            <motion.p
              className="text-sm text-[#8B7355]/60"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              Opening your story...
            </motion.p>
          )}
          {phase === 'flipping' && targetPage > 1 && (
            <p className="text-sm text-[#8B7355]/60">
              Turning to page {Math.min(currentFlipPage, targetPage)} of {targetPage}...
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
