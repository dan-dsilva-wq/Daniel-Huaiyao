'use client';

import { motion } from 'framer-motion';
import { Writer, formatWriterName } from '@/lib/supabase';

interface TurnIndicatorProps {
  currentTurn: Writer;
  currentWriter: Writer;
}

export default function TurnIndicator({ currentTurn, currentWriter }: TurnIndicatorProps) {
  const isYourTurn = currentTurn === currentWriter;
  const turnName = formatWriterName(currentTurn);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-center gap-3 mb-4 sm:mb-6"
    >
      {isYourTurn ? (
        <motion.div
          animate={{ scale: [1, 1.03, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className={`
            px-4 py-2 sm:px-6 sm:py-3 rounded-full font-medium text-sm sm:text-base
            ${currentTurn === 'daniel'
              ? 'bg-daniel-light text-daniel-dark border-2 border-daniel'
              : 'bg-huaiyao-light text-huaiyao-dark border-2 border-huaiyao'
            }
          `}
        >
          <span className="flex items-center gap-1.5 sm:gap-2">
            <motion.span
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-current"
            />
            Your turn!
          </span>
        </motion.div>
      ) : (
        <div className="px-4 py-2 sm:px-6 sm:py-3 rounded-full bg-book-shadow/30 text-foreground/60 font-medium text-sm sm:text-base">
          <span className="flex items-center gap-1.5 sm:gap-2">
            <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-current opacity-50" />
            Waiting for {turnName}...
          </span>
        </div>
      )}
    </motion.div>
  );
}
