'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';

interface ParagraphReaderProps {
  text: string;
  className?: string;
}

export default function ParagraphReader({ text, className = '' }: ParagraphReaderProps) {
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Split text into paragraphs (by double newline or single newline)
  const paragraphs = text
    .split(/\n\n+|\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const speakParagraph = async (index: number, paragraphText: string) => {
    // Stop any existing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (playingIndex === index) {
      // Clicking same paragraph stops it
      setPlayingIndex(null);
      return;
    }

    setLoadingIndex(index);
    setPlayingIndex(null);

    try {
      const response = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: paragraphText }),
      });

      if (!response.ok) throw new Error('Failed to generate speech');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        setLoadingIndex(null);
        setPlayingIndex(index);
      };

      audio.onended = () => {
        setPlayingIndex(null);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setLoadingIndex(null);
        setPlayingIndex(null);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error('Speech error:', error);
      setLoadingIndex(null);
      setPlayingIndex(null);
    }
  };

  return (
    <div className={className}>
      {paragraphs.map((paragraph, index) => (
        <div key={index} className="group relative mb-4 last:mb-0">
          <p className="text-purple-100 leading-relaxed text-lg pr-12">
            {paragraph}
          </p>
          <button
            onClick={() => speakParagraph(index, paragraph)}
            disabled={loadingIndex !== null && loadingIndex !== index}
            className={`absolute top-0 right-0 p-2 rounded-lg transition-all ${
              playingIndex === index
                ? 'bg-amber-500/30 text-amber-400'
                : loadingIndex === index
                ? 'bg-purple-500/20 text-purple-400'
                : 'bg-white/5 text-purple-400 opacity-50 group-hover:opacity-100 hover:bg-white/10'
            }`}
            title={playingIndex === index ? 'Stop' : 'Read aloud'}
          >
            {loadingIndex === index ? (
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                className="inline-block"
              >
                ⏳
              </motion.span>
            ) : playingIndex === index ? (
              <span className="animate-pulse">🔊</span>
            ) : (
              '🔈'
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
