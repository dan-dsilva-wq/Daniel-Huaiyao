'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';

interface AgreementCelebrationProps {
  show: boolean;
  onComplete: () => void;
}

export default function AgreementCelebration({ show, onComplete }: AgreementCelebrationProps) {
  useEffect(() => {
    if (show) {
      const timeout = setTimeout(onComplete, 2000);
      return () => clearTimeout(timeout);
    }
  }, [show, onComplete]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          {/* Sparkles */}
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              initial={{
                scale: 0,
                x: 0,
                y: 0,
                rotate: 0
              }}
              animate={{
                scale: [0, 1, 0],
                x: Math.cos(i * 30 * Math.PI / 180) * 150,
                y: Math.sin(i * 30 * Math.PI / 180) * 150,
                rotate: 360
              }}
              transition={{
                duration: 1.5,
                ease: 'easeOut',
                delay: i * 0.05
              }}
              className="absolute w-4 h-4 text-2xl"
            >
              {i % 2 === 0 ? '✨' : '⭐'}
            </motion.div>
          ))}

          {/* Main celebration content */}
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 10 }}
            transition={{ type: 'spring', damping: 15 }}
            className="text-center"
          >
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 0.5, repeat: 2 }}
              className="text-6xl mb-4"
            >
              🤝
            </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-2xl font-serif font-bold text-white mb-2"
            >
              You Agree!
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-purple-200"
            >
              The story continues...
            </motion.p>
          </motion.div>

          {/* Rings */}
          <motion.div
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className="absolute w-32 h-32 border-4 border-amber-400 rounded-full"
          />
          <motion.div
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 3, opacity: 0 }}
            transition={{ duration: 1.5, ease: 'easeOut', delay: 0.2 }}
            className="absolute w-32 h-32 border-4 border-purple-400 rounded-full"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
