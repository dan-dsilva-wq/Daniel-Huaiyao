'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sentence, formatWriterName } from '@/lib/supabase';

interface PageProps {
  sentences: Sentence[];
  pageNumber: number;
  isLeftPage?: boolean;
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SentenceItem({ sentence, index }: { sentence: Sentence; index: number }) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.05 }}
      className={`
        py-1 rounded-lg cursor-pointer relative
        ${sentence.writer === 'daniel' ? 'sentence-daniel' : 'sentence-huaiyao'}
      `}
      onClick={() => setShowInfo(!showInfo)}
    >
      <p className="handwriting text-base sm:text-lg md:text-xl">{sentence.content}</p>
      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[10px] sm:text-xs opacity-60 mt-1 overflow-hidden"
          >
            {formatWriterName(sentence.writer)} • {formatTimestamp(sentence.created_at)}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Page({ sentences, pageNumber, isLeftPage = false }: PageProps) {
  return (
    <div
      className={`
        relative w-full h-full p-4 sm:p-6 md:p-8 overflow-y-auto
        ${isLeftPage ? 'book-page-left' : 'book-page'}
        ${!isLeftPage ? 'page-curl' : ''}
      `}
    >
      {/* Page number */}
      <div className={`absolute bottom-2 sm:bottom-4 ${isLeftPage ? 'left-4 sm:left-6' : 'right-4 sm:right-6'} text-foreground/30 text-xs sm:text-sm font-serif`}>
        {pageNumber}
      </div>

      {/* Decorative corner flourish - hidden on small mobile */}
      <div className={`absolute top-2 sm:top-4 ${isLeftPage ? 'left-2 sm:left-4' : 'right-2 sm:right-4'} text-book-shadow/30 hidden sm:block`}>
        <svg width="24" height="24" viewBox="0 0 30 30" fill="currentColor" className="sm:w-[30px] sm:h-[30px]">
          <path d="M0 0 Q15 0 15 15 Q15 0 30 0 L30 30 Q15 30 15 15 Q15 30 0 30 Z" opacity="0.3" />
        </svg>
      </div>

      {/* Sentences */}
      <div className="space-y-2 sm:space-y-3 mt-4 sm:mt-6 pb-6">
        {sentences.length === 0 ? (
          <div className="flex items-center justify-center h-32 sm:h-48 text-foreground/30 font-serif italic text-sm sm:text-base">
            {pageNumber === 1 ? 'Begin your story...' : 'Continue writing...'}
          </div>
        ) : (
          sentences.map((sentence, index) => (
            <SentenceItem key={sentence.id} sentence={sentence} index={index} />
          ))
        )}
      </div>
    </div>
  );
}
