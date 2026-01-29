'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Writer, formatWriterName } from '@/lib/supabase';
import { playSubmit } from '@/lib/sounds';

interface WriteInputProps {
  currentTurn: Writer;
  currentWriter: Writer;
  onSubmit: (content: string) => Promise<void>;
  isSubmitting: boolean;
}

export default function WriteInput({
  currentTurn,
  currentWriter,
  onSubmit,
  isSubmitting,
}: WriteInputProps) {
  const [content, setContent] = useState('');
  const isYourTurn = currentTurn === currentWriter;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !isYourTurn || isSubmitting) return;

    await onSubmit(content.trim());
    playSubmit();
    setContent('');
  };

  return (
    <div className="mt-4 sm:mt-8">
      <AnimatePresence mode="wait">
        {isYourTurn ? (
          <motion.form
            key="input-form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            onSubmit={handleSubmit}
            className="space-y-3 sm:space-y-4"
          >
            <div className="relative">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Continue the story..."
                disabled={isSubmitting}
                className={`
                  w-full p-3 sm:p-4 rounded-lg sm:rounded-xl write-input resize-none
                  min-h-[100px] sm:min-h-[120px] transition-all duration-300
                  text-base sm:text-lg
                  ${currentWriter === 'daniel'
                    ? 'focus:border-daniel'
                    : 'focus:border-huaiyao'
                  }
                `}
                maxLength={500}
              />
              <span className="absolute bottom-2 sm:bottom-3 right-2 sm:right-3 text-xs sm:text-sm text-foreground/40">
                {content.length}/500
              </span>
            </div>

            <motion.button
              type="submit"
              disabled={!content.trim() || isSubmitting}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`
                w-full py-3 sm:py-4 px-4 sm:px-6 rounded-lg sm:rounded-xl font-medium
                transition-all duration-300 disabled:opacity-50
                disabled:cursor-not-allowed text-sm sm:text-base
                active:scale-[0.98]
                ${currentWriter === 'daniel'
                  ? 'bg-daniel text-white hover:bg-daniel-dark active:bg-daniel-dark'
                  : 'bg-huaiyao text-white hover:bg-huaiyao-dark active:bg-huaiyao-dark'
                }
              `}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                    className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-white/30 border-t-white rounded-full"
                  />
                  Adding...
                </span>
              ) : (
                'Add to our story'
              )}
            </motion.button>
          </motion.form>
        ) : (
          <motion.div
            key="waiting-message"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="text-center py-6 sm:py-8 px-4 sm:px-6 bg-book-shadow/10 rounded-lg sm:rounded-xl"
          >
            <motion.div
              animate={{ y: [0, -5, 0] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="text-3xl sm:text-4xl mb-3 sm:mb-4"
            >
              ✨
            </motion.div>
            <p className="text-foreground/60 font-serif text-sm sm:text-base">
              It&apos;s {formatWriterName(currentTurn)}&apos;s turn to add to your story.
            </p>
            <p className="text-foreground/40 text-xs sm:text-sm mt-1.5 sm:mt-2">
              You&apos;ll be able to write when they&apos;re done!
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
