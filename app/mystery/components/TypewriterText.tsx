'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface TypewriterTextProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
  className?: string;
  autoSpeak?: boolean;
}

export default function TypewriterText({
  text,
  speed = 30,
  onComplete,
  className = '',
  autoSpeak = true, // Auto-speak with ElevenLabs
}: TypewriterTextProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasSpokenRef = useRef(false);
  const currentTextRef = useRef(text);

  // Reset when text changes
  useEffect(() => {
    setDisplayedText('');
    setCurrentIndex(0);
    setIsComplete(false);
    hasSpokenRef.current = false;
    currentTextRef.current = text;

    // Stop any ongoing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setIsLoading(false);
  }, [text]);

  // Typewriter effect
  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    } else if (!isComplete && text.length > 0) {
      setIsComplete(true);
      onComplete?.();
    }
  }, [currentIndex, text, speed, onComplete, isComplete]);

  // Auto-speak using ElevenLabs
  useEffect(() => {
    if (!autoSpeak || hasSpokenRef.current || !text) return;

    hasSpokenRef.current = true;

    // Small delay to let the UI render first
    const speakTimeout = setTimeout(() => {
      speakText(text);
    }, 500);

    return () => {
      clearTimeout(speakTimeout);
    };
  }, [text, autoSpeak]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const speakText = async (textToSpeak: string, isManual = false) => {
    // Stop any existing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setIsLoading(true);
    setIsSpeaking(false);

    try {
      const response = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSpeak }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate speech');
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // Check if text has changed while loading
      if (currentTextRef.current !== textToSpeak) {
        URL.revokeObjectURL(audioUrl);
        return;
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onplay = () => {
        setIsLoading(false);
        setIsSpeaking(true);
      };

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsLoading(false);
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        // Only use fallback if manually triggered, not auto-speak
        if (isManual) {
          fallbackSpeak(textToSpeak);
        }
      };

      await audio.play();
    } catch (error) {
      console.error('ElevenLabs error:', error);
      setIsLoading(false);
      // Only use fallback if manually triggered, not auto-speak
      if (isManual) {
        fallbackSpeak(textToSpeak);
      }
    }
  };

  const fallbackSpeak = (textToSpeak: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = 0.9;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const handleSkip = () => {
    setDisplayedText(text);
    setCurrentIndex(text.length);
    setIsComplete(true);
    onComplete?.();
  };

  const toggleSpeech = () => {
    if (isLoading) return;

    if (isSpeaking && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsSpeaking(false);
    } else {
      speakText(text, true); // Manual trigger - use fallback if needed
    }
  };

  return (
    <div className={`relative ${className}`}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="whitespace-pre-wrap cursor-pointer"
        onClick={handleSkip}
      >
        {displayedText}
        {!isComplete && (
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
            className="inline-block w-2 h-5 bg-amber-400 ml-1 align-middle"
          />
        )}
      </motion.div>

      <div className="flex items-center justify-between mt-3">
        {!isComplete && (
          <p className="text-xs text-gray-400">Tap to skip</p>
        )}
        {isComplete && <div />}

        <button
          onClick={toggleSpeech}
          disabled={isLoading}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
            isLoading
              ? 'bg-white/5 text-purple-400'
              : isSpeaking
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-white/10 text-purple-300 hover:text-white'
          }`}
        >
          {isLoading ? (
            <>
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                ⏳
              </motion.span>{' '}
              Loading...
            </>
          ) : isSpeaking ? (
            <>
              <span className="animate-pulse">🔊</span> Playing...
            </>
          ) : (
            <>🔈 Read aloud</>
          )}
        </button>
      </div>
    </div>
  );
}
