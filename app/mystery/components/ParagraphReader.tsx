'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';

interface ParagraphReaderProps {
  text: string;
  className?: string;
  autoStart?: boolean;
  onComplete?: () => void;
}

export default function ParagraphReader({ text, className = '', autoStart = false, onComplete }: ParagraphReaderProps) {
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [autoPlaying, setAutoPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayingRef = useRef(false);
  const hasAutoStartedRef = useRef(false);

  // Split text into paragraphs (by double newline or single newline)
  const paragraphs = text
    .split(/\n\n+|\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const speakParagraph = useCallback(async (index: number, paragraphText: string, continueAuto = false): Promise<boolean> => {
    // Stop any existing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
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

      return new Promise((resolve) => {
        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onplay = () => {
          setLoadingIndex(null);
          setPlayingIndex(index);
        };

        audio.onended = () => {
          setPlayingIndex(null);
          URL.revokeObjectURL(audioUrl);
          resolve(true);
        };

        audio.onerror = () => {
          setLoadingIndex(null);
          setPlayingIndex(null);
          URL.revokeObjectURL(audioUrl);
          resolve(false);
        };

        audio.play().catch(() => resolve(false));
      });
    } catch (error) {
      console.error('Speech error:', error);
      setLoadingIndex(null);
      setPlayingIndex(null);
      return false;
    }
  }, []);

  const handleParagraphClick = (index: number, paragraphText: string) => {
    // Stop auto-play if running
    if (autoPlaying) {
      stopAll();
      return;
    }

    if (playingIndex === index) {
      // Clicking same paragraph stops it
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingIndex(null);
      return;
    }

    speakParagraph(index, paragraphText);
  };

  const autoReadAll = async () => {
    setAutoPlaying(true);
    autoPlayingRef.current = true;

    for (let i = 0; i < paragraphs.length; i++) {
      if (!autoPlayingRef.current) break;
      const success = await speakParagraph(i, paragraphs[i], true);
      if (!success || !autoPlayingRef.current) break;
    }

    setAutoPlaying(false);
    autoPlayingRef.current = false;
    onComplete?.();
  };

  const stopAll = () => {
    autoPlayingRef.current = false;
    setAutoPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingIndex(null);
    setLoadingIndex(null);
  };

  // Auto-start reading when component mounts (if enabled)
  useEffect(() => {
    // Text is visible immediately, so notify parent
    onComplete?.();

    if (autoStart && !hasAutoStartedRef.current && paragraphs.length > 0) {
      hasAutoStartedRef.current = true;
      // Small delay to let UI render first
      const timeout = setTimeout(() => {
        autoReadAll();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [autoStart, paragraphs.length]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <div className={className}>
      {/* Auto-read all button */}
      <div className="flex justify-end mb-3">
        <button
          onClick={autoPlaying ? stopAll : autoReadAll}
          disabled={loadingIndex !== null && !autoPlaying}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
            autoPlaying
              ? 'bg-amber-500/30 text-amber-400'
              : 'bg-white/10 text-purple-300 hover:bg-white/20 hover:text-white'
          }`}
        >
          {autoPlaying ? (
            <>
              <span className="animate-pulse">⏹</span> Stop
            </>
          ) : (
            <>
              🔊 Read all
            </>
          )}
        </button>
      </div>

      {paragraphs.map((paragraph, index) => (
        <div key={index} className="group relative mb-4 last:mb-0">
          <p className={`text-purple-100 leading-relaxed text-lg pr-12 transition-colors ${
            playingIndex === index ? 'text-white' : ''
          }`}>
            {paragraph}
          </p>
          <button
            onClick={() => handleParagraphClick(index, paragraph)}
            disabled={loadingIndex !== null && loadingIndex !== index && !autoPlaying}
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
