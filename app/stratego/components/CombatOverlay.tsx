'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CombatAnimationData, CombatResult } from '@/lib/stratego/types';
import { getPieceName, getPieceShortName, TEAM_COLORS } from '@/lib/stratego/constants';

interface CombatOverlayProps {
  data: CombatAnimationData | null;
  onDismiss: () => void;
}

function resultLabel(result: CombatResult): string {
  switch (result) {
    case 'attacker_wins': return 'Attacker Wins!';
    case 'defender_wins': return 'Defender Wins!';
    case 'both_die': return 'Both Destroyed!';
  }
}

export default function CombatOverlay({ data, onDismiss }: CombatOverlayProps) {
  if (!data) return null;

  const defenderColor = data.attacker_color === 'red' ? 'blue' : 'red';

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onDismiss}
      >
        <motion.div
          className="flex flex-col items-center gap-6"
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0.5 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Combat label */}
          <motion.div
            className="text-white text-lg font-bold tracking-wider uppercase"
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            Combat!
          </motion.div>

          {/* Pieces side by side */}
          <div className="flex items-center gap-8">
            {/* Attacker */}
            <motion.div
              className="flex flex-col items-center gap-2"
              initial={{ x: -60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3, type: 'spring' }}
            >
              <div
                className={`w-20 h-20 rounded-xl bg-gradient-to-br ${TEAM_COLORS[data.attacker_color].gradient}
                  flex items-center justify-center shadow-2xl border-2 ${TEAM_COLORS[data.attacker_color].border}
                  ${data.result === 'defender_wins' || data.result === 'both_die' ? 'opacity-40' : ''}`}
              >
                <span className="text-white text-2xl font-bold">
                  {getPieceShortName(data.attacker_rank)}
                </span>
              </div>
              <span className="text-white text-sm font-medium">
                {getPieceName(data.attacker_rank)}
              </span>
              <span className="text-xs text-gray-400 uppercase">Attacker</span>
            </motion.div>

            {/* VS */}
            <motion.span
              className="text-3xl font-black text-yellow-400"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.5, type: 'spring' }}
            >
              VS
            </motion.span>

            {/* Defender */}
            <motion.div
              className="flex flex-col items-center gap-2"
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.3, type: 'spring' }}
            >
              <div
                className={`w-20 h-20 rounded-xl bg-gradient-to-br ${TEAM_COLORS[defenderColor].gradient}
                  flex items-center justify-center shadow-2xl border-2 ${TEAM_COLORS[defenderColor].border}
                  ${data.result === 'attacker_wins' || data.result === 'both_die' ? 'opacity-40' : ''}`}
              >
                <span className="text-white text-2xl font-bold">
                  {getPieceShortName(data.defender_rank)}
                </span>
              </div>
              <span className="text-white text-sm font-medium">
                {getPieceName(data.defender_rank)}
              </span>
              <span className="text-xs text-gray-400 uppercase">Defender</span>
            </motion.div>
          </div>

          {/* Result */}
          <motion.div
            className={`text-xl font-bold ${
              data.result === 'both_die'
                ? 'text-yellow-400'
                : data.result === 'attacker_wins'
                  ? `text-${data.attacker_color === 'red' ? 'red' : 'blue'}-400`
                  : `text-${defenderColor === 'red' ? 'red' : 'blue'}-400`
            }`}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            {resultLabel(data.result)}
          </motion.div>

          {/* Tap to dismiss */}
          <motion.p
            className="text-gray-400 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          >
            Tap anywhere to continue
          </motion.p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
