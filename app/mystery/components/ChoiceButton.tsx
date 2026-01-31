'use client';

import { motion } from 'framer-motion';
import type { Player, MysteryVote } from '@/lib/supabase';

interface ChoiceButtonProps {
  choiceId: string;
  text: string;
  votes: MysteryVote[];
  currentPlayer: Player;
  onVote: (choiceId: string) => void;
  disabled?: boolean;
}

export default function ChoiceButton({
  choiceId,
  text,
  votes,
  currentPlayer,
  onVote,
  disabled = false,
}: ChoiceButtonProps) {
  const danielVoted = votes.find(v => v.player === 'daniel' && v.choice_id === choiceId);
  const huaiyaoVoted = votes.find(v => v.player === 'huaiyao' && v.choice_id === choiceId);
  const currentPlayerVoted = votes.find(v => v.player === currentPlayer && v.choice_id === choiceId);

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      onClick={() => !disabled && onVote(choiceId)}
      disabled={disabled}
      className={`
        relative w-full p-4 rounded-xl text-left transition-all
        ${currentPlayerVoted
          ? 'bg-purple-600 text-white shadow-lg ring-2 ring-purple-400'
          : 'bg-purple-900/50 text-purple-100 hover:bg-purple-800/60'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span className="block pr-16">{text}</span>

      {/* Vote indicators */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
        {danielVoted && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white shadow-md"
            title="Daniel voted"
          >
            D
          </motion.div>
        )}
        {huaiyaoVoted && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-6 h-6 rounded-full bg-rose-500 flex items-center justify-center text-xs font-bold text-white shadow-md"
            title="Huaiyao voted"
          >
            H
          </motion.div>
        )}
      </div>
    </motion.button>
  );
}
