'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import type { Player, MysteryPuzzle, PuzzleSubmitResult, PuzzleStatus } from '@/lib/supabase';
import PuzzleInput from './PuzzleInput';
import HintPanel from './HintPanel';
import { renderMathInText } from './MathDisplay';

interface PuzzleRendererProps {
  puzzle: MysteryPuzzle;
  sessionId: string;
  currentPlayer: Player;
  onSolved?: () => void;
}

export default function PuzzleRenderer({
  puzzle,
  sessionId,
  currentPlayer,
  onSolved,
}: PuzzleRendererProps) {
  const [answerState, setAnswerState] = useState<{
    status: string;
    hints_revealed: number;
    my_submitted: boolean;
    partner_submitted: boolean;
  }>({
    status: 'pending',
    hints_revealed: 0,
    my_submitted: false,
    partner_submitted: false,
  });
  const [hints, setHints] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHint, setIsLoadingHint] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>('');

  // Fetch answer state and hints
  const fetchAnswerState = useCallback(async () => {
    // Get answer state from puzzle_answers table
    const { data: answerData } = await supabase
      .from('mystery_puzzle_answers')
      .select('*')
      .eq('session_id', sessionId)
      .eq('puzzle_id', puzzle.id)
      .single();

    if (answerData) {
      const mySubmitted = currentPlayer === 'daniel'
        ? answerData.daniel_answer_hash != null
        : answerData.huaiyao_answer_hash != null;
      const partnerSubmitted = currentPlayer === 'daniel'
        ? answerData.huaiyao_answer_hash != null
        : answerData.daniel_answer_hash != null;

      setAnswerState({
        status: answerData.status,
        hints_revealed: answerData.hints_revealed || 0,
        my_submitted: mySubmitted,
        partner_submitted: partnerSubmitted,
      });

      if (answerData.status === 'solved' && onSolved) {
        onSolved();
      }
    }

    // Get revealed hints
    const { data: hintsData } = await supabase.rpc('get_puzzle_hints', {
      p_session_id: sessionId,
      p_puzzle_id: puzzle.id,
    });

    if (hintsData?.hints) {
      // hintsData.hints is a JSONB array
      const hintsList = Array.isArray(hintsData.hints)
        ? hintsData.hints.flat().filter(Boolean)
        : [];
      setHints(hintsList);
    }
  }, [sessionId, puzzle.id, currentPlayer, onSolved]);

  useEffect(() => {
    fetchAnswerState();

    // Subscribe to puzzle answer changes
    const channel = supabase
      .channel(`puzzle-${sessionId}-${puzzle.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mystery_puzzle_answers',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          fetchAnswerState();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, puzzle.id, fetchAnswerState]);

  const handleSubmit = async (answer: string) => {
    setIsSubmitting(true);
    setLastMessage('');

    try {
      const { data, error } = await supabase.rpc('submit_puzzle_answer', {
        p_session_id: sessionId,
        p_puzzle_id: puzzle.id,
        p_player: currentPlayer,
        p_answer: answer,
      });

      if (error) throw error;

      const result = data as PuzzleSubmitResult;
      setLastMessage(result.message);

      if (result.status === 'solved' && onSolved) {
        onSolved();
      }

      await fetchAnswerState();
    } catch (err) {
      console.error('Error submitting answer:', err);
      setLastMessage('Failed to submit answer. Please try again.');
    }

    setIsSubmitting(false);
  };

  const handleRequestHint = async () => {
    setIsLoadingHint(true);

    try {
      const { data, error } = await supabase.rpc('request_puzzle_hint', {
        p_session_id: sessionId,
        p_puzzle_id: puzzle.id,
      });

      if (error) throw error;

      if (data?.success) {
        await fetchAnswerState();
      }
    } catch (err) {
      console.error('Error requesting hint:', err);
    }

    setIsLoadingHint(false);
  };

  const handleReset = async () => {
    try {
      await supabase.rpc('reset_puzzle_answers', {
        p_session_id: sessionId,
        p_puzzle_id: puzzle.id,
      });
      setLastMessage('');
      await fetchAnswerState();
    } catch (err) {
      console.error('Error resetting puzzle:', err);
    }
  };

  const hintsRevealed = answerState.hints_revealed;

  // Render puzzle content based on type
  const renderPuzzleContent = () => {
    const { puzzle_data, puzzle_type } = puzzle;

    switch (puzzle_type) {
      case 'number_theory':
        return (
          <div className="space-y-4">
            {puzzle_data.equations && (
              <div className="bg-slate-800/50 rounded-lg p-4 font-mono">
                {puzzle_data.equations.map((eq: string, i: number) => (
                  <div key={i} className="text-purple-200 text-lg py-1">
                    {renderMathInText(`$${eq}$`)}
                  </div>
                ))}
              </div>
            )}
            {puzzle_data.note && (
              <p className="text-purple-300 italic text-sm">{puzzle_data.note}</p>
            )}
          </div>
        );

      case 'cryptography':
        return (
          <div className="space-y-4">
            {puzzle_data.cipher_type && (
              <p className="text-amber-400 text-sm font-medium">
                Cipher Type: {puzzle_data.cipher_type}
              </p>
            )}
            {puzzle_data.ciphertext && (
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-purple-200 font-mono text-lg break-all">
                  {puzzle_data.ciphertext}
                </p>
              </div>
            )}
            {puzzle_data.context && (
              <p className="text-purple-300 text-sm">{puzzle_data.context}</p>
            )}
          </div>
        );

      case 'logic':
        return (
          <div className="space-y-4">
            {puzzle_data.rules && (
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-amber-400 text-sm font-medium mb-2">Rules:</p>
                <ul className="list-disc list-inside space-y-1">
                  {puzzle_data.rules.map((rule: string, i: number) => (
                    <li key={i} className="text-purple-200 text-sm">{rule}</li>
                  ))}
                </ul>
              </div>
            )}
            {puzzle_data.statements && (
              <div className="space-y-2">
                <p className="text-amber-400 text-sm font-medium">Statements:</p>
                {puzzle_data.statements.map((stmt: string, i: number) => (
                  <div key={i} className="bg-slate-800/30 rounded-lg p-3 border-l-4 border-purple-500">
                    <p className="text-purple-200">{stmt}</p>
                  </div>
                ))}
              </div>
            )}
            {puzzle_data.question && (
              <p className="text-white font-medium">{puzzle_data.question}</p>
            )}
          </div>
        );

      case 'geometry':
        return (
          <div className="space-y-4">
            {puzzle_data.figure_description && (
              <p className="text-purple-200">{puzzle_data.figure_description}</p>
            )}
            {puzzle_data.measurements && (
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-amber-400 text-sm font-medium mb-2">Measurements:</p>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(puzzle_data.measurements).map(([key, value]) => (
                    <div key={key} className="text-purple-200">
                      <span className="font-mono">{key}</span> = {String(value)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 'sequence':
        return (
          <div className="space-y-4">
            {puzzle_data.sequence && (
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-purple-200 font-mono text-xl text-center">
                  {puzzle_data.sequence.join(', ')}, ?
                </p>
              </div>
            )}
            {puzzle_data.find && (
              <p className="text-purple-300 text-sm">{puzzle_data.find}</p>
            )}
          </div>
        );

      case 'research':
        return (
          <div className="space-y-4">
            {puzzle_data.clue && (
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-purple-200">{puzzle_data.clue}</p>
              </div>
            )}
            {puzzle_data.sources_hint && (
              <p className="text-purple-300 text-sm italic">
                💡 {puzzle_data.sources_hint}
              </p>
            )}
          </div>
        );

      case 'word_puzzle': {
        const scrambledWords = Array.isArray(puzzle_data.scrambled_words) ? puzzle_data.scrambled_words as string[] : null;
        const wordBank = typeof puzzle_data.word_bank === 'string' ? puzzle_data.word_bank : null;
        const clue = typeof puzzle_data.clue === 'string' ? puzzle_data.clue : null;
        return (
          <div className="space-y-4">
            {scrambledWords && (
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-amber-400 text-sm font-medium mb-2">Unscramble these words:</p>
                <div className="flex flex-wrap gap-2">
                  {scrambledWords.map((word: string, i: number) => (
                    <span key={i} className="px-3 py-2 bg-purple-700/50 rounded-lg text-purple-200 font-mono text-lg">
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {wordBank && (
              <div className="bg-slate-800/30 rounded-lg p-4">
                <p className="text-purple-300 text-sm mb-2">Available letters:</p>
                <div className="flex flex-wrap gap-1">
                  {wordBank.split('').map((letter: string, i: number) => (
                    <span key={i} className="w-8 h-8 flex items-center justify-center bg-purple-600/50 rounded text-white font-mono">
                      {letter}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {clue && (
              <p className="text-purple-300 text-sm">{clue}</p>
            )}
          </div>
        );
      }

      case 'visual_puzzle': {
        const imageUrl = typeof puzzle_data.image_url === 'string' ? puzzle_data.image_url : null;
        const pattern = Array.isArray(puzzle_data.pattern) ? puzzle_data.pattern as string[] : null;
        const question = typeof puzzle_data.question === 'string' ? puzzle_data.question : null;
        return (
          <div className="space-y-4">
            {imageUrl && (
              <div className="bg-slate-800/50 rounded-lg p-4 flex justify-center">
                <img
                  src={imageUrl}
                  alt="Visual puzzle"
                  className="max-w-full max-h-64 rounded-lg"
                />
              </div>
            )}
            {pattern && (
              <div className="bg-slate-800/50 rounded-lg p-4">
                <p className="text-amber-400 text-sm font-medium mb-2">Find the pattern:</p>
                <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                  {pattern.map((item: string, i: number) => (
                    <div key={i} className="aspect-square flex items-center justify-center bg-purple-700/50 rounded-lg text-2xl">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {question && (
              <p className="text-white font-medium text-center">{question}</p>
            )}
          </div>
        );
      }

      case 'riddle': {
        const riddle = typeof puzzle_data.riddle === 'string' ? puzzle_data.riddle : null;
        const category = typeof puzzle_data.category === 'string' ? puzzle_data.category : null;
        return (
          <div className="space-y-4">
            <div className="bg-gradient-to-br from-purple-900/50 to-amber-900/30 rounded-lg p-6 text-center">
              <span className="text-4xl mb-4 block">🤔</span>
              {riddle && (
                <p className="text-purple-100 text-lg italic leading-relaxed">
                  &quot;{riddle}&quot;
                </p>
              )}
            </div>
            {category && (
              <p className="text-amber-400 text-sm text-center">
                Category: {category}
              </p>
            )}
          </div>
        );
      }

      case 'anagram': {
        const letters = typeof puzzle_data.letters === 'string' ? puzzle_data.letters : null;
        const hint = typeof puzzle_data.hint === 'string' ? puzzle_data.hint : null;
        const wordCount = typeof puzzle_data.word_count === 'number' ? puzzle_data.word_count : null;
        return (
          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-lg p-6 text-center">
              <p className="text-amber-400 text-sm font-medium mb-3">Rearrange these letters:</p>
              {letters && (
                <div className="flex justify-center gap-1 flex-wrap">
                  {letters.split('').map((letter: string, i: number) => (
                    <span key={i} className="w-10 h-10 flex items-center justify-center bg-purple-600 rounded-lg text-white font-mono text-xl font-bold shadow-lg">
                      {letter}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {hint && (
              <p className="text-purple-300 text-sm text-center italic">
                Hint: {hint}
              </p>
            )}
            {wordCount && (
              <p className="text-purple-400 text-xs text-center">
                {wordCount} word{wordCount > 1 ? 's' : ''}
              </p>
            )}
          </div>
        );
      }

      case 'crossword': {
        const acrossClues = puzzle_data.across as Record<string, string> | undefined;
        const downClues = puzzle_data.down as Record<string, string> | undefined;
        const answerFormat = puzzle_data.answer_format as string | undefined;
        return (
          <div className="space-y-4">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-amber-400 text-sm font-medium mb-3">Crossword Clues:</p>
              {acrossClues && (
                <div className="mb-4">
                  <p className="text-purple-400 text-xs font-medium mb-1">ACROSS:</p>
                  {Object.entries(acrossClues).map(([num, clue]) => (
                    <p key={num} className="text-purple-200 text-sm">
                      <span className="text-amber-400 font-mono">{num}.</span> {clue}
                    </p>
                  ))}
                </div>
              )}
              {downClues && (
                <div>
                  <p className="text-purple-400 text-xs font-medium mb-1">DOWN:</p>
                  {Object.entries(downClues).map(([num, clue]) => (
                    <p key={num} className="text-purple-200 text-sm">
                      <span className="text-amber-400 font-mono">{num}.</span> {clue}
                    </p>
                  ))}
                </div>
              )}
            </div>
            {answerFormat && (
              <p className="text-purple-300 text-xs text-center">
                Answer format: {answerFormat}
              </p>
            )}
          </div>
        );
      }

      default:
        // Generic puzzle display
        return (
          <div className="bg-slate-800/50 rounded-lg p-4">
            <pre className="text-purple-200 whitespace-pre-wrap text-sm">
              {JSON.stringify(puzzle_data, null, 2)}
            </pre>
          </div>
        );
    }
  };

  const getDifficultyStars = (difficulty: number) => {
    return '★'.repeat(difficulty) + '☆'.repeat(5 - difficulty);
  };

  const getPuzzleTypeEmoji = (type: string) => {
    const emojis: Record<string, string> = {
      number_theory: '🔢',
      cryptography: '🔐',
      logic: '🧠',
      geometry: '📐',
      sequence: '🔢',
      research: '📚',
      minigame: '🎮',
      word_puzzle: '📝',
      visual_puzzle: '👁️',
      riddle: '🤔',
      anagram: '🔤',
      crossword: '✏️',
    };
    return emojis[type] || '🧩';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Puzzle header */}
      <div className="bg-gradient-to-br from-purple-900/50 to-slate-900/50 border border-purple-500/30 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{getPuzzleTypeEmoji(puzzle.puzzle_type)}</span>
            <div>
              <h3 className="text-xl font-serif font-bold text-white">{puzzle.title}</h3>
              <p className="text-purple-300 text-sm capitalize">
                {puzzle.puzzle_type.replace('_', ' ')} Puzzle
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-amber-400 text-sm" title={`Difficulty: ${puzzle.difficulty}/5`}>
              {getDifficultyStars(puzzle.difficulty)}
            </p>
            {puzzle.is_blocking && (
              <p className="text-red-400 text-xs mt-1">🔒 Required to progress</p>
            )}
          </div>
        </div>

        {/* Puzzle description */}
        <p className="text-purple-100 leading-relaxed mb-6">{puzzle.description}</p>

        {/* Puzzle content */}
        {renderPuzzleContent()}
      </div>

      {/* Hint panel */}
      <HintPanel
        hints={hints}
        hintsRevealed={hintsRevealed}
        maxHints={puzzle.max_hints}
        onRequestHint={handleRequestHint}
        isLoading={isLoadingHint}
      />

      {/* Answer input */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        <h4 className="text-lg font-medium text-white mb-4">Your Answer</h4>
        <PuzzleInput
          puzzleId={puzzle.id}
          answerType={puzzle.answer_type}
          currentPlayer={currentPlayer}
          status={answerState.status as PuzzleStatus}
          mySubmitted={answerState.my_submitted || false}
          partnerSubmitted={answerState.partner_submitted || false}
          onSubmit={handleSubmit}
          onReset={handleReset}
          isSubmitting={isSubmitting}
          lastMessage={lastMessage}
        />
      </div>

      {/* Time limit warning */}
      {puzzle.time_limit_seconds && (
        <motion.div
          animate={{ opacity: [1, 0.7, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="bg-red-900/30 border border-red-500/50 rounded-xl p-4 text-center"
        >
          <p className="text-red-300">
            ⏱️ Time limit: {Math.floor(puzzle.time_limit_seconds / 60)}:{(puzzle.time_limit_seconds % 60).toString().padStart(2, '0')}
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
