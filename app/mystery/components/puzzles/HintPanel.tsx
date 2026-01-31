'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface HintPanelProps {
  hints: string[];
  hintsRevealed: number;
  maxHints: number;
  onRequestHint: () => Promise<void>;
  isLoading?: boolean;
}

export default function HintPanel({
  hints,
  hintsRevealed,
  maxHints,
  onRequestHint,
  isLoading = false,
}: HintPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const canRequestMore = hintsRevealed < maxHints;
  const hintsRemaining = maxHints - hintsRevealed;

  return (
    <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-amber-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">💡</span>
          <span className="font-medium text-amber-200">
            Hints {hintsRevealed > 0 && `(${hintsRevealed}/${maxHints} used)`}
          </span>
        </div>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          className="text-amber-400"
        >
          ▼
        </motion.span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {hints.length > 0 ? (
                <div className="space-y-2">
                  {hints.map((hint, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="bg-amber-950/50 rounded-lg p-3 border border-amber-500/20"
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-amber-400 font-bold text-sm">#{index + 1}</span>
                        <p className="text-amber-100 text-sm leading-relaxed">{hint}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <p className="text-amber-200/60 text-sm italic">
                  No hints revealed yet. Request a hint if you&apos;re stuck!
                </p>
              )}

              {canRequestMore ? (
                <button
                  onClick={onRequestHint}
                  disabled={isLoading}
                  className="w-full py-2 px-4 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/50 rounded-lg text-amber-200 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1 }}
                        className="inline-block"
                      >
                        ⏳
                      </motion.span>
                      Revealing...
                    </>
                  ) : (
                    <>
                      <span>🔓</span>
                      Reveal Hint ({hintsRemaining} remaining)
                    </>
                  )}
                </button>
              ) : (
                <p className="text-center text-amber-200/60 text-sm py-2">
                  All hints have been revealed. You&apos;re on your own now!
                </p>
              )}

              {hintsRevealed === 0 && (
                <p className="text-amber-200/40 text-xs text-center">
                  Try to solve it without hints first - it&apos;s more satisfying!
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
