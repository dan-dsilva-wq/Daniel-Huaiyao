'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import type { Player, PuzzleAnswerType, PuzzleStatus } from '@/lib/supabase';

interface PuzzleInputProps {
  puzzleId: string;
  answerType: PuzzleAnswerType;
  currentPlayer: Player;
  status: PuzzleStatus;
  mySubmitted: boolean;
  partnerSubmitted: boolean;
  onSubmit: (answer: string) => Promise<void>;
  onReset?: () => Promise<void>;
  isSubmitting?: boolean;
  lastMessage?: string;
}

export default function PuzzleInput({
  answerType,
  currentPlayer,
  status,
  mySubmitted,
  partnerSubmitted,
  onSubmit,
  onReset,
  isSubmitting = false,
  lastMessage,
}: PuzzleInputProps) {
  const [answer, setAnswer] = useState('');
  const partnerName = currentPlayer === 'daniel' ? 'Huaiyao' : 'Daniel';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim() || isSubmitting) return;
    await onSubmit(answer.trim());
  };

  const getPlaceholder = () => {
    switch (answerType) {
      case 'numeric':
        return 'Enter a number...';
      case 'exact':
        return 'Enter your answer...';
      case 'set':
        return 'Enter values separated by commas...';
      case 'multiple_choice':
        return 'Enter your choice (A, B, C, etc.)...';
      default:
        return 'Enter your answer...';
    }
  };

  const getStatusDisplay = () => {
    if (status === 'solved') {
      return (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-green-900/30 border border-green-500/50 rounded-xl p-4 text-center"
        >
          <span className="text-3xl mb-2 block">🎉</span>
          <p className="text-green-300 font-medium">Puzzle Solved!</p>
        </motion.div>
      );
    }

    if (status === 'disagreed') {
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-orange-900/30 border border-orange-500/50 rounded-xl p-4"
        >
          <p className="text-orange-300 text-center">
            🤔 You have different answers! Discuss with {partnerName} and try again.
          </p>
          {onReset && (
            <button
              onClick={onReset}
              className="mt-3 w-full py-2 bg-orange-600/30 hover:bg-orange-600/50 border border-orange-500/50 rounded-lg text-orange-200 text-sm transition-colors"
            >
              Reset & Try Again
            </button>
          )}
        </motion.div>
      );
    }

    if (status === 'agreed' && lastMessage) {
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-red-900/30 border border-red-500/50 rounded-xl p-4"
        >
          <p className="text-red-300 text-center">
            ❌ {lastMessage}
          </p>
          {onReset && (
            <button
              onClick={onReset}
              className="mt-3 w-full py-2 bg-red-600/30 hover:bg-red-600/50 border border-red-500/50 rounded-lg text-red-200 text-sm transition-colors"
            >
              Try Again
            </button>
          )}
        </motion.div>
      );
    }

    return null;
  };

  const statusDisplay = getStatusDisplay();
  if (statusDisplay && status !== 'pending') {
    return statusDisplay;
  }

  return (
    <div className="space-y-4">
      {/* Partner status indicator */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${mySubmitted ? 'bg-green-500' : 'bg-gray-500'}`} />
          <span className={mySubmitted ? 'text-green-300' : 'text-gray-400'}>
            You: {mySubmitted ? 'Submitted' : 'Waiting'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={partnerSubmitted ? 'text-green-300' : 'text-gray-400'}>
            {partnerName}: {partnerSubmitted ? 'Submitted' : 'Waiting'}
          </span>
          <span className={`w-2 h-2 rounded-full ${partnerSubmitted ? 'bg-green-500' : 'bg-gray-500'}`} />
        </div>
      </div>

      {/* Answer input */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <input
            type={answerType === 'numeric' ? 'text' : 'text'}
            inputMode={answerType === 'numeric' ? 'numeric' : 'text'}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={getPlaceholder()}
            disabled={isSubmitting || mySubmitted}
            className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {mySubmitted && !partnerSubmitted && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400"
            >
              <motion.span
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                Waiting...
              </motion.span>
            </motion.div>
          )}
        </div>

        <button
          type="submit"
          disabled={!answer.trim() || isSubmitting || mySubmitted}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 text-white rounded-xl font-semibold transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="inline-block"
              >
                ⏳
              </motion.span>
              Submitting...
            </>
          ) : mySubmitted ? (
            <>
              <span>✓</span>
              Answer Submitted
            </>
          ) : (
            <>
              <span>📝</span>
              Submit Answer
            </>
          )}
        </button>
      </form>

      {/* Last message */}
      {lastMessage && status === 'pending' && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-purple-300 text-sm"
        >
          {lastMessage}
        </motion.p>
      )}

      {/* Collaboration hint */}
      {!mySubmitted && !partnerSubmitted && (
        <p className="text-center text-purple-300/60 text-xs">
          Both players must submit the same answer to solve the puzzle
        </p>
      )}
    </div>
  );
}
