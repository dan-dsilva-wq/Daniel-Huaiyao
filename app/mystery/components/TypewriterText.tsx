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
  autoSpeak = true,
}: TypewriterTextProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const hasSpokenRef = useRef(false);

  // Reset when text changes
  useEffect(() => {
    setDisplayedText('');
    setCurrentIndex(0);
    setIsComplete(false);
    hasSpokenRef.current = false;

    // Cancel any ongoing speech
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
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

  // Auto-speak when text changes
  useEffect(() => {
    if (!autoSpeak || hasSpokenRef.current || !text) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    hasSpokenRef.current = true;

    // Small delay to let the UI render first
    const speakTimeout = setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;

      // Try to get a good voice
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(v =>
        v.name.includes('Samantha') ||
        v.name.includes('Google') ||
        v.name.includes('Microsoft Zira') ||
        v.lang.startsWith('en')
      );
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }, 300);

    return () => {
      clearTimeout(speakTimeout);
    };
  }, [text, autoSpeak]);

  // Cleanup speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSkip = () => {
    setDisplayedText(text);
    setCurrentIndex(text.length);
    setIsComplete(true);
    onComplete?.();
  };

  const toggleSpeech = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
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
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
            isSpeaking
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-white/10 text-purple-300 hover:text-white'
          }`}
        >
          {isSpeaking ? (
            <>
              <span className="animate-pulse">🔊</span> Speaking...
            </>
          ) : (
            <>
              🔈 Read aloud
            </>
          )}
        </button>
      </div>
    </div>
  );
}
