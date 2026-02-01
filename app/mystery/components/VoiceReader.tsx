'use client';

import { useEffect, useRef } from 'react';

interface VoiceReaderProps {
  text: string;
}

export default function VoiceReader({ text }: VoiceReaderProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasStartedRef = useRef(false);
  const currentTextRef = useRef(text);

  // Split into paragraphs
  const paragraphs = text
    .split(/\n\n+|\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  useEffect(() => {
    currentTextRef.current = text;
    hasStartedRef.current = false;

    // Stop any existing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [text]);

  useEffect(() => {
    if (hasStartedRef.current || paragraphs.length === 0) return;
    hasStartedRef.current = true;

    let currentIndex = 0;
    let stopped = false;

    const readParagraph = async (index: number) => {
      if (stopped || index >= paragraphs.length) return;

      try {
        const response = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: paragraphs[index] }),
        });

        if (!response.ok || stopped) return;

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        if (stopped) {
          URL.revokeObjectURL(audioUrl);
          return;
        }

        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          if (!stopped) {
            readParagraph(index + 1);
          }
        };

        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
        };

        await audio.play();
      } catch (error) {
        console.error('Voice reader error:', error);
      }
    };

    // Small delay to let UI render
    const timeout = setTimeout(() => readParagraph(0), 300);

    return () => {
      stopped = true;
      clearTimeout(timeout);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [paragraphs]);

  // This component renders nothing - it just plays audio
  return null;
}
