'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';

interface Achievement {
  title: string;
  emoji: string;
  description?: string;
  points?: number;
}

interface AchievementCelebrationProps {
  achievement: Achievement | null;
  onClose: () => void;
}

// Generate confetti particles
const generateConfetti = (count: number) => {
  const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: colors[Math.floor(Math.random() * colors.length)],
    delay: Math.random() * 0.5,
    rotation: Math.random() * 360,
    size: Math.random() * 8 + 4,
  }));
};

export default function AchievementCelebration({ achievement, onClose }: AchievementCelebrationProps) {
  const [confetti, setConfetti] = useState<ReturnType<typeof generateConfetti>>([]);

  useEffect(() => {
    if (achievement) {
      setConfetti(generateConfetti(50));
      // Auto-close after 5 seconds
      const timer = setTimeout(onClose, 5000);
      return () => clearTimeout(timer);
    }
  }, [achievement, onClose]);

  return (
    <AnimatePresence>
      {achievement && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          {/* Confetti */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {confetti.map((particle) => (
              <motion.div
                key={particle.id}
                initial={{
                  x: `${particle.x}vw`,
                  y: -20,
                  rotate: 0,
                  opacity: 1,
                }}
                animate={{
                  y: '120vh',
                  rotate: particle.rotation + 720,
                  opacity: [1, 1, 0],
                }}
                transition={{
                  duration: 3 + Math.random() * 2,
                  delay: particle.delay,
                  ease: 'easeIn',
                }}
                className="absolute"
                style={{
                  width: particle.size,
                  height: particle.size,
                  backgroundColor: particle.color,
                  borderRadius: Math.random() > 0.5 ? '50%' : '2px',
                }}
              />
            ))}
          </div>

          {/* Achievement Card */}
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 180 }}
            transition={{
              type: 'spring',
              stiffness: 200,
              damping: 15,
            }}
            className="relative bg-gradient-to-br from-amber-400 via-yellow-300 to-amber-500 rounded-3xl p-8 shadow-2xl max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glow effect */}
            <div className="absolute inset-0 rounded-3xl bg-yellow-200 blur-xl opacity-50" />

            {/* Content */}
            <div className="relative text-center">
              {/* Stars */}
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
                className="absolute -top-4 -left-4 text-2xl"
              >
                ✨
              </motion.div>
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4 }}
                className="absolute -top-4 -right-4 text-2xl"
              >
                ✨
              </motion.div>

              {/* Trophy Header */}
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className="text-6xl mb-4"
              >
                {achievement.emoji}
              </motion.div>

              {/* Title */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <h2 className="text-sm font-medium text-amber-800 uppercase tracking-wide mb-2">
                  Achievement Unlocked!
                </h2>
                <h3 className="text-2xl font-bold text-amber-900 mb-2">
                  {achievement.title}
                </h3>
                {achievement.description && (
                  <p className="text-amber-700 text-sm mb-4">
                    {achievement.description}
                  </p>
                )}
                {achievement.points && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.4, type: 'spring' }}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-amber-600 text-white rounded-full text-sm font-medium"
                  >
                    +{achievement.points} points
                  </motion.div>
                )}
              </motion.div>

              {/* Both names */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-6 pt-4 border-t border-amber-600/30"
              >
                <p className="text-amber-800 text-sm font-medium">
                  Daniel & Huaiyao
                </p>
                <p className="text-amber-700 text-xs mt-1">
                  Unlocked together!
                </p>
              </motion.div>
            </div>

            {/* Tap to close hint */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 1 }}
              className="absolute -bottom-8 left-0 right-0 text-center text-white text-xs"
            >
              Tap anywhere to close
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
