'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import Link from 'next/link';
import { ThemeToggle } from '../components/ThemeToggle';

type Player = 'daniel' | 'huaiyao';

interface Round {
  writer: Player;
  statements: [string, string, string];
  lieIndex: number;
  guessIndex: number | null;
  correct: boolean;
}

type Phase =
  | 'idle'
  | 'writing'
  | 'pass-phone'
  | 'guessing'
  | 'revealed'
  | 'history';

const PROMPTS = [
  'Something about your childhood',
  'A hidden talent or skill',
  'Something embarrassing that happened to you',
  'A food you secretly love or hate',
  'Something about your school days',
  'A fear or phobia you have',
  'Something about your family',
  'A place you\'ve been',
  'Something you\'ve never told anyone',
  'A strange habit you have',
  'Something about your first job',
  'A celebrity encounter or near-encounter',
  'Something you believed as a kid',
  'An unusual thing on your bucket list',
  'Something about your morning routine',
];

function getPlayerName(player: Player): string {
  return player === 'daniel' ? 'Daniel' : 'Huaiyao';
}

function getPartner(player: Player): Player {
  return player === 'daniel' ? 'huaiyao' : 'daniel';
}

export default function TwoTruthsPage() {
  useMarkAppViewed('two-truths');
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentWriter, setCurrentWriter] = useState<Player>('daniel');
  const [statements, setStatements] = useState(['', '', '']);
  const [lieIndex, setLieIndex] = useState<number | null>(null);
  const [shuffledOrder, setShuffledOrder] = useState<number[]>([0, 1, 2]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [prompt, setPrompt] = useState('');
  const inputRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  // Pick a random prompt for inspiration
  useEffect(() => {
    if (phase === 'writing') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);
    }
  }, [phase]);

  const startWriting = (writer: Player) => {
    setCurrentWriter(writer);
    setStatements(['', '', '']);
    setLieIndex(null);
    setPhase('writing');
  };

  const submitStatements = () => {
    if (lieIndex === null) return;
    if (statements.some(s => !s.trim())) return;

    // Shuffle the order so they appear randomized to the guesser
    const order = [0, 1, 2];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    setShuffledOrder(order);
    setPhase('pass-phone');
  };

  const handleGuess = (displayIndex: number) => {
    const actualIndex = shuffledOrder[displayIndex];
    const correct = actualIndex === lieIndex;

    const round: Round = {
      writer: currentWriter,
      statements: statements as [string, string, string],
      lieIndex: lieIndex!,
      guessIndex: actualIndex,
      correct,
    };

    setRounds(prev => [...prev, round]);
    setPhase('revealed');
  };

  const playAgain = () => {
    // Swap who writes next
    setCurrentWriter(getPartner(currentWriter));
    setStatements(['', '', '']);
    setLieIndex(null);
    setPhase('writing');
  };

  const guesser = getPartner(currentWriter);

  // Score calculation
  const danielCorrect = rounds.filter(r => r.writer === 'huaiyao' && r.correct).length;
  const huaiyaoCorrect = rounds.filter(r => r.writer === 'daniel' && r.correct).length;
  const totalRounds = rounds.length;
  const lastRound = rounds[rounds.length - 1];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-100/30 dark:bg-violet-900/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-100/30 dark:bg-amber-900/20 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6 sm:py-12 pb-safe">
        {/* Header - hidden during writing and guessing */}
        {phase !== 'writing' && phase !== 'guessing' && phase !== 'pass-phone' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-6 sm:mb-8"
          >
            <div className="flex items-center justify-between mb-4">
              <Link
                href="/"
                className="px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:text-gray-800 transition-colors touch-manipulation"
              >
                ← Home
              </Link>
              <ThemeToggle />
            </div>
            <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
              Two Truths & a Lie
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              Can you spot the lie?
            </p>

            {/* Score */}
            {totalRounds > 0 && phase !== 'history' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-3 inline-flex items-center gap-3 px-4 py-2 bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-full shadow-sm"
              >
                <span className="text-blue-500 font-semibold">Daniel {danielCorrect}</span>
                <span className="text-gray-300">-</span>
                <span className="text-rose-500 font-semibold">{huaiyaoCorrect} Huaiyao</span>
                <span className="text-gray-400 text-sm">({totalRounds} {totalRounds === 1 ? 'round' : 'rounds'})</span>
              </motion.div>
            )}
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {/* Idle - start screen */}
          {phase === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-2xl shadow-lg p-8 mb-6">
                <motion.div
                  animate={{ rotate: [0, -5, 5, 0] }}
                  transition={{ duration: 3, repeat: Infinity }}
                  className="text-5xl mb-4"
                >
                  🤥
                </motion.div>
                <p className="text-gray-600 dark:text-gray-300 mb-2">Write two truths and one lie about yourself.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
                  Your partner has to guess which one is the lie!
                </p>

                <div className="space-y-3">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Who goes first?</p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <motion.button
                      onClick={() => startWriting('daniel')}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-8 py-4 bg-blue-500 text-white rounded-xl font-medium shadow-lg hover:bg-blue-600 transition-colors"
                    >
                      Daniel writes
                    </motion.button>
                    <motion.button
                      onClick={() => startWriting('huaiyao')}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-8 py-4 bg-rose-500 text-white rounded-xl font-medium shadow-lg hover:bg-rose-600 transition-colors"
                    >
                      Huaiyao writes
                    </motion.button>
                  </div>
                </div>
              </div>

              {/* Previous rounds button */}
              {rounds.length > 0 && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => setPhase('history')}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors underline"
                >
                  View previous rounds ({rounds.length})
                </motion.button>
              )}
            </motion.div>
          )}

          {/* Writing phase */}
          {phase === 'writing' && (
            <motion.div
              key="writing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              {/* Who's writing */}
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className={`inline-block px-4 py-2 ${
                    currentWriter === 'daniel' ? 'bg-blue-500' : 'bg-rose-500'
                  } text-white rounded-full font-medium shadow-md`}
                >
                  {getPlayerName(currentWriter)}&apos;s turn to write
                </motion.div>
                <p className="text-sm text-gray-400 mt-2">
                  Don&apos;t let {getPlayerName(guesser)} see!
                </p>
              </div>

              {/* Inspiration prompt */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-center"
              >
                <span className="inline-block px-3 py-1.5 bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-full text-sm text-gray-500 dark:text-gray-400">
                  💡 Idea: {prompt}
                </span>
              </motion.div>

              {/* Statement inputs */}
              <div className="space-y-3">
                {[0, 1, 2].map((idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 * idx }}
                  >
                    <div className="flex items-start gap-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-xl shadow-sm p-4">
                      <button
                        onClick={() => setLieIndex(lieIndex === idx ? null : idx)}
                        className={`mt-1 flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                          lieIndex === idx
                            ? 'bg-red-500 border-red-500 text-white'
                            : 'border-gray-300 dark:border-gray-600 text-gray-400 hover:border-red-300 hover:text-red-400'
                        }`}
                        title={lieIndex === idx ? 'This is the lie' : 'Mark as the lie'}
                      >
                        {lieIndex === idx ? 'LIE' : idx + 1}
                      </button>
                      <textarea
                        ref={(el) => { inputRefs.current[idx] = el; }}
                        placeholder={idx === 0 ? 'First statement...' : idx === 1 ? 'Second statement...' : 'Third statement...'}
                        value={statements[idx]}
                        onChange={(e) => {
                          const next = [...statements];
                          next[idx] = e.target.value;
                          setStatements(next);
                        }}
                        rows={2}
                        maxLength={200}
                        className="flex-1 px-3 py-2 bg-transparent border-none focus:outline-none text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none text-sm sm:text-base"
                      />
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Lie indicator */}
              <div className="text-center text-sm text-gray-400">
                {lieIndex !== null ? (
                  <span>
                    Statement {lieIndex + 1} is marked as the <span className="text-red-500 font-medium">lie</span>
                  </span>
                ) : (
                  <span>Tap a number to mark which statement is the lie</span>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <motion.button
                  onClick={submitStatements}
                  disabled={lieIndex === null || statements.some(s => !s.trim())}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`flex-1 py-4 rounded-xl font-medium shadow-lg transition-all ${
                    currentWriter === 'daniel'
                      ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
                      : 'bg-gradient-to-r from-rose-500 to-pink-500'
                  } text-white disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Done - pass to {getPlayerName(guesser)}
                </motion.button>
                <button
                  onClick={() => {
                    setStatements(['', '', '']);
                    setLieIndex(null);
                    setPhase('idle');
                  }}
                  className="px-4 py-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {/* Pass phone screen */}
          {phase === 'pass-phone' && (
            <motion.div
              key="pass-phone"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="text-center"
            >
              <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-2xl shadow-lg p-8">
                <motion.div
                  animate={{ rotate: [0, 10, -10, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="text-5xl mb-4"
                >
                  📱
                </motion.div>
                <h2 className="text-2xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
                  Pass to {getPlayerName(guesser)}!
                </h2>
                <p className="text-gray-500 mb-2">
                  {getPlayerName(currentWriter)} has written their statements.
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
                  Hand the phone over - no peeking at which is the lie!
                </p>
                <motion.button
                  onClick={() => setPhase('guessing')}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`px-8 py-4 ${
                    guesser === 'daniel'
                      ? 'bg-blue-500 hover:bg-blue-600'
                      : 'bg-rose-500 hover:bg-rose-600'
                  } text-white rounded-xl font-medium shadow-lg transition-colors`}
                >
                  I&apos;m {getPlayerName(guesser)}, ready!
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Guessing phase */}
          {phase === 'guessing' && (
            <motion.div
              key="guessing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4"
            >
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className={`inline-block px-4 py-2 ${
                    guesser === 'daniel' ? 'bg-blue-500' : 'bg-rose-500'
                  } text-white rounded-full font-medium shadow-md`}
                >
                  {getPlayerName(guesser)}&apos;s turn to guess
                </motion.div>
              </div>

              <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100 text-center">
                Which one is the lie?
              </h2>
              <p className="text-center text-sm text-gray-400">
                {getPlayerName(currentWriter)} says all three of these are true... but one is a lie!
              </p>

              <div className="space-y-3">
                {shuffledOrder.map((actualIdx, displayIdx) => (
                  <motion.button
                    key={displayIdx}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 * displayIdx }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleGuess(displayIdx)}
                    className="w-full bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-xl shadow-sm p-5 transition-all hover:shadow-md active:bg-gray-50 dark:active:bg-gray-700 text-left"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-500 dark:text-gray-400">
                        {displayIdx + 1}
                      </span>
                      <p className="text-gray-800 text-sm sm:text-base leading-relaxed">
                        {statements[actualIdx]}
                      </p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Revealed */}
          {phase === 'revealed' && lastRound && (
            <motion.div
              key="revealed"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {/* Result banner */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 10 }}
                className="text-center"
              >
                <div className="text-6xl mb-3">
                  {lastRound.correct ? '🎉' : '😈'}
                </div>
                <h2 className="text-2xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-1">
                  {lastRound.correct
                    ? `${getPlayerName(guesser)} got it!`
                    : `${getPlayerName(currentWriter)} fooled you!`
                  }
                </h2>
                <p className="text-gray-500 text-sm">
                  {lastRound.correct
                    ? 'You spotted the lie!'
                    : `The lie was statement ${lastRound.lieIndex + 1}`
                  }
                </p>
              </motion.div>

              {/* Show all statements with reveal */}
              <div className="space-y-3">
                {shuffledOrder.map((actualIdx, displayIdx) => {
                  const isLie = actualIdx === lastRound.lieIndex;
                  const wasGuessed = actualIdx === lastRound.guessIndex;

                  return (
                    <motion.div
                      key={displayIdx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 * displayIdx }}
                      className={`rounded-xl p-5 transition-all ${
                        isLie
                          ? 'bg-red-50 dark:bg-red-900/30 border-2 border-red-200 dark:border-red-800'
                          : 'bg-green-50 dark:bg-green-900/30 border-2 border-green-200 dark:border-green-800'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span className={`flex-shrink-0 mt-0.5 text-lg ${isLie ? 'text-red-500' : 'text-green-500'}`}>
                          {isLie ? '🤥' : '✓'}
                        </span>
                        <div className="flex-1">
                          <p className={`text-sm sm:text-base leading-relaxed ${
                            isLie ? 'text-red-800' : 'text-green-800'
                          }`}>
                            {statements[actualIdx]}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              isLie
                                ? 'bg-red-200 text-red-700'
                                : 'bg-green-200 text-green-700'
                            }`}>
                              {isLie ? 'THE LIE' : 'TRUTH'}
                            </span>
                            {wasGuessed && !isLie && (
                              <span className="text-xs text-gray-400">
                                ← {getPlayerName(guesser)} guessed this
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Actions */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="space-y-3 pt-2"
              >
                <motion.button
                  onClick={playAgain}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`w-full py-4 rounded-xl font-medium shadow-lg text-white ${
                    guesser === 'daniel'
                      ? 'bg-gradient-to-r from-rose-500 to-pink-500'
                      : 'bg-gradient-to-r from-blue-500 to-indigo-500'
                  }`}
                >
                  {getPlayerName(getPartner(currentWriter))}&apos;s turn to write
                </motion.button>
                <button
                  onClick={() => setPhase('idle')}
                  className="w-full py-3 text-gray-400 hover:text-gray-600 transition-colors text-sm"
                >
                  Back to menu
                </button>
              </motion.div>
            </motion.div>
          )}

          {/* History */}
          {phase === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              <div className="text-center mb-4">
                <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100 mb-2">
                  All Rounds
                </h2>
                <div className="inline-flex items-center gap-3 px-4 py-2 bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-full shadow-sm text-sm">
                  <span className="text-blue-500 font-semibold">Daniel {danielCorrect}</span>
                  <span className="text-gray-300">-</span>
                  <span className="text-rose-500 font-semibold">{huaiyaoCorrect} Huaiyao</span>
                </div>
              </div>

              <div className="space-y-3">
                {rounds.map((round, i) => {
                  const guesserForRound = getPartner(round.writer);
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 * i }}
                      className={`bg-white/80 dark:bg-gray-800/80 backdrop-blur rounded-xl shadow-sm p-4 ${
                        round.correct ? 'border-l-4 border-green-400' : 'border-l-4 border-red-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Round {i + 1}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          round.correct
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {round.correct
                            ? `${getPlayerName(guesserForRound)} spotted it`
                            : `${getPlayerName(round.writer)} fooled them`
                          }
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {round.statements.map((stmt, j) => (
                          <div
                            key={j}
                            className={`text-sm flex items-start gap-2 ${
                              j === round.lieIndex ? 'text-red-600' : 'text-gray-600'
                            }`}
                          >
                            <span className="flex-shrink-0">
                              {j === round.lieIndex ? '🤥' : '✓'}
                            </span>
                            <span className={j === round.lieIndex ? 'line-through opacity-70' : ''}>
                              {stmt}
                            </span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <motion.button
                onClick={() => setPhase('idle')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-4 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-xl font-medium shadow-lg"
              >
                Play More
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        {phase !== 'writing' && phase !== 'guessing' && phase !== 'pass-phone' && (
          <motion.footer
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center mt-12 text-gray-400 dark:text-gray-500 text-sm"
          >
            <p>Best played together in person</p>
          </motion.footer>
        )}
      </main>
    </div>
  );
}
