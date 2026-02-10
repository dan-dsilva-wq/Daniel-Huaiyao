'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { PIECE_DEFINITIONS } from '@/lib/stratego/constants';

interface RulesProps {
  open: boolean;
  onClose: () => void;
}

export default function Rules({ open, onClose }: RulesProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full max-h-[85vh] overflow-y-auto shadow-2xl"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center z-10">
              <h2 className="text-xl font-bold dark:text-white">How to Play Stratego</h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-4 space-y-5 text-sm dark:text-gray-200">
              <section>
                <h3 className="font-bold text-base mb-2">Goal</h3>
                <p>Capture your opponent&apos;s <strong>Flag</strong>. You win by moving any of your pieces onto it.</p>
              </section>

              <section>
                <h3 className="font-bold text-base mb-2">Setup</h3>
                <p>Each player arranges 40 pieces on their 4 rows. Your opponent can&apos;t see your arrangement. Tap two pieces to swap them. When both players are ready, the game begins.</p>
              </section>

              <section>
                <h3 className="font-bold text-base mb-2">Moving</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Red moves first. Players alternate turns.</li>
                  <li>Move one piece per turn, one square up/down/left/right.</li>
                  <li><strong>Scouts (2)</strong> can move any number of squares in a straight line.</li>
                  <li><strong>Bombs</strong> and the <strong>Flag</strong> cannot move.</li>
                  <li>Pieces cannot enter the two lakes in the center.</li>
                </ul>
              </section>

              <section>
                <h3 className="font-bold text-base mb-2">Combat</h3>
                <p className="mb-2">Move onto an opponent&apos;s piece to attack. Both pieces reveal their ranks.</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Higher rank wins.</strong> The loser is removed.</li>
                  <li><strong>Equal rank:</strong> both pieces are removed.</li>
                  <li><strong>Spy (S) vs Marshal (10):</strong> Spy wins <em>only</em> when the Spy attacks.</li>
                  <li><strong>Miner (3) vs Bomb (B):</strong> Miner defuses the Bomb.</li>
                  <li>Any other piece attacking a Bomb is destroyed.</li>
                </ul>
              </section>

              <section>
                <h3 className="font-bold text-base mb-2">Winning</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Capture the opponent&apos;s Flag.</li>
                  <li>Opponent has no movable pieces left.</li>
                  <li>Opponent resigns.</li>
                </ul>
              </section>

              <section>
                <h3 className="font-bold text-base mb-2">Pieces</h3>
                <div className="space-y-1">
                  {PIECE_DEFINITIONS.map((p) => (
                    <div key={p.rank} className="flex items-center gap-2">
                      <span className="w-7 h-7 flex items-center justify-center rounded bg-gray-200 dark:bg-gray-700 font-mono font-bold text-xs">
                        {p.shortName}
                      </span>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-gray-500 dark:text-gray-400">&times;{p.count}</span>
                      {p.description && (
                        <span className="text-gray-400 dark:text-gray-500 text-xs ml-auto">{p.description}</span>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="font-bold text-base mb-2">Tips</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Protect your Flag with Bombs around it.</li>
                  <li>Keep Miners alive — they&apos;re your only way to clear Bombs.</li>
                  <li>Use Scouts to probe the opponent&apos;s setup.</li>
                  <li>Bluff! Place strong pieces where your opponent expects weak ones.</li>
                </ul>
              </section>
            </div>

            <div className="sticky bottom-0 bg-white dark:bg-gray-800 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={onClose}
                className="w-full py-2.5 bg-gradient-to-r from-red-500 to-blue-600 text-white rounded-xl font-semibold"
              >
                Got it!
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
