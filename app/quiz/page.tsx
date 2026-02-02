'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { ThemeToggle } from '../components/ThemeToggle';

interface QuizQuestion {
  id: string;
  author: 'daniel' | 'huaiyao';
  question_text: string;
  options: string[] | null;
  correct_answer_index: number | null;
  correct_answer_indices: number[] | null;
  is_multiple_choice?: boolean;
  category?: string;
  created_at: string;
  is_two_way?: boolean;
  linked_question_id?: string | null;
  pending_setup?: boolean;
  answer?: {
    selected_index: number;
    selected_indices: number[] | null;
    is_correct: boolean;
    answered_at: string;
  } | null;
  partner_answer?: {
    selected_index: number;
    selected_indices: number[] | null;
    is_correct: boolean;
    answered_at: string;
  } | null;
}

interface QuizCategory {
  name: string;
  emoji: string;
  description: string;
}

interface QuizData {
  questions_to_answer: QuizQuestion[];
  my_questions: QuizQuestion[];
}

type Tab = 'answer' | 'your-questions';

// Calculate score for a single question
// Regular questions: 1 if correct, 0 if wrong
// Multiple choice: (correct selected - wrong selected) / total correct, minimum 0
function calculateQuestionScore(question: QuizQuestion): number {
  if (!question.answer) return 0;

  if (question.is_multiple_choice && question.correct_answer_indices && question.answer.selected_indices) {
    const correctSet = new Set(question.correct_answer_indices);
    const selectedSet = new Set(question.answer.selected_indices);

    let correctSelected = 0;
    let wrongSelected = 0;

    for (const idx of selectedSet) {
      if (correctSet.has(idx)) {
        correctSelected++;
      } else {
        wrongSelected++;
      }
    }

    const score = Math.max(0, (correctSelected - wrongSelected) / correctSet.size);
    return score;
  }

  // Regular question: 1 or 0
  return question.answer.is_correct ? 1 : 0;
}

// Question inspiration suggestions
const questionSuggestions = {
  favorites: {
    emoji: '⭐',
    title: 'Favorites',
    questions: [
      "What's my favorite food?",
      "What's my favorite movie?",
      "What's my favorite song?",
      "What's my favorite color?",
      "What's my favorite season?",
      "What's my favorite holiday?",
      "What's my favorite book?",
      "What's my favorite TV show?",
      "What's my favorite dessert?",
      "What's my favorite drink?",
      "What's my favorite animal?",
      "What's my favorite sport to watch?",
      "What's my favorite way to relax?",
      "What's my favorite time of day?",
      "What's my favorite childhood memory?",
    ],
  },
  personality: {
    emoji: '🧠',
    title: 'Personality',
    questions: [
      "What's my biggest fear?",
      "What's my biggest pet peeve?",
      "Am I a morning person or night owl?",
      "How do I act when I'm stressed?",
      "What makes me laugh the most?",
      "What's my love language?",
      "How do I handle conflict?",
      "What's my guilty pleasure?",
      "What habit do I wish I could break?",
      "What makes me feel most loved?",
      "What's my most unpopular opinion?",
      "What's my biggest insecurity?",
      "How do I recharge after a long day?",
      "What do I value most in a friendship?",
      "What's my default mood?",
    ],
  },
  dreams: {
    emoji: '✨',
    title: 'Dreams & Goals',
    questions: [
      "What's my dream job?",
      "Where's my dream holiday destination?",
      "What's on my bucket list?",
      "What skill do I wish I had?",
      "Where do I want to live someday?",
      "What's my biggest life goal?",
      "If I could master any instrument, which one?",
      "What language would I love to learn?",
      "What's my dream car?",
      "What would I do if I won the lottery?",
    ],
  },
  hypotheticals: {
    emoji: '🤔',
    title: 'Hypotheticals',
    questions: [
      "If I could have dinner with anyone, who?",
      "If I could live in any era, which one?",
      "If I could have any superpower, what would it be?",
      "What would I bring to a desert island?",
      "If I could only eat one food forever, what?",
      "If I had to pick a new career tomorrow, what?",
      "What would I do on my perfect day off?",
      "If I could swap lives with someone for a day, who?",
      "What would my autobiography be called?",
      "If I could fix one world problem, which one?",
    ],
  },
  memories: {
    emoji: '💭',
    title: 'Memories & Us',
    questions: [
      "What was I wearing when we first met?",
      "Where was our first date?",
      "What's my most embarrassing moment?",
      "What's the funniest thing that happened to us?",
      "What's my favorite memory of us?",
      "What song reminds me of us?",
      "What was I most nervous about when we started dating?",
      "What's my favorite trip we've taken?",
      "What's the nicest thing you've done for me?",
      "What made me fall for you?",
    ],
  },
  thisOrThat: {
    emoji: '⚖️',
    title: 'This or That',
    questions: [
      "Beach or mountains?",
      "Sweet or savory?",
      "Call or text?",
      "Early bird or night owl?",
      "Books or movies?",
      "City or countryside?",
      "Summer or winter?",
      "Cats or dogs?",
      "Cooking or eating out?",
      "Adventure or relaxation?",
    ],
  },
  random: {
    emoji: '🎲',
    title: 'Random & Fun',
    questions: [
      "What's my go-to karaoke song?",
      "What's my comfort movie?",
      "What do I order at McDonald's?",
      "What's my signature dance move?",
      "What's the weirdest food I enjoy?",
      "What's my phone wallpaper?",
      "What do I do when I can't sleep?",
      "What's my most used emoji?",
      "What's my hidden talent?",
      "What would my patronus be?",
      "What's my Starbucks order?",
      "What celebrity do people say I look like?",
      "What's the last thing I googled?",
      "What would I name a boat?",
      "What's my spirit animal?",
    ],
  },
};

export default function QuizPage() {
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('answer');
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [lastAnswerResult, setLastAnswerResult] = useState<{
    questionId: string;
    isCorrect: boolean;
    correctIndex: number;
  } | null>(null);

  // New question form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newOptions, setNewOptions] = useState(['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [correctIndices, setCorrectIndices] = useState<number[]>([]);
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false);
  const [isTwoWay, setIsTwoWay] = useState(false);
  const [isMultipleChoice, setIsMultipleChoice] = useState(false);
  const [showInspiration, setShowInspiration] = useState(false);
  const [newCategory, setNewCategory] = useState('general');

  // Category filter state
  const [categories, setCategories] = useState<QuizCategory[]>([]);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  // Setup two-way question state
  const [setupQuestion, setSetupQuestion] = useState<QuizQuestion | null>(null);
  const [setupOptions, setSetupOptions] = useState(['', '', '', '']);
  const [setupCorrectIndex, setSetupCorrectIndex] = useState<number | null>(null);
  const [setupCorrectIndices, setSetupCorrectIndices] = useState<number[]>([]);
  const [isSubmittingSetup, setIsSubmittingSetup] = useState(false);

  // Error state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Answer result popup state
  const [answerResultPopup, setAnswerResultPopup] = useState<{
    question: QuizQuestion;
    selectedIndex: number | null;
    selectedIndices: number[];
    isCorrect: boolean;
    score: number;
  } | null>(null);

  // Scoreboard state - both players' scores
  const [scores, setScores] = useState<{
    daniel: { correct: number; total: number };
    huaiyao: { correct: number; total: number };
  } | null>(null);

  // Streak tracking state
  const [streaks, setStreaks] = useState<{
    daniel: { current: number; longest: number };
    huaiyao: { current: number; longest: number };
  } | null>(null);

  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : 'Daniel';

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured || !currentUser) {
      setIsLoading(false);
      return;
    }

    try {
      const partner = currentUser === 'daniel' ? 'huaiyao' : 'daniel';

      // Fetch questions to answer (partner's questions)
      const { data: partnerQuestions, error: pqError } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('author', partner)
        .eq('pending_setup', false)
        .order('created_at', { ascending: false });

      if (pqError) throw pqError;

      // Fetch my questions
      const { data: myQuestions, error: mqError } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('author', currentUser)
        .order('created_at', { ascending: false });

      if (mqError) throw mqError;

      // Fetch all answers for these questions
      const allQuestionIds = [
        ...(partnerQuestions || []).map(q => q.id),
        ...(myQuestions || []).map(q => q.id),
      ];

      const { data: answers, error: aError } = await supabase
        .from('quiz_answers')
        .select('*')
        .in('question_id', allQuestionIds.length > 0 ? allQuestionIds : ['none']);

      if (aError) throw aError;

      // Map answers to questions
      const questionsToAnswer = (partnerQuestions || []).map(q => ({
        ...q,
        answer: (answers || []).find(a => a.question_id === q.id && a.player === currentUser) || null,
      }));

      const myQuestionsWithAnswers = (myQuestions || []).map(q => ({
        ...q,
        partner_answer: (answers || []).find(a => a.question_id === q.id && a.player === partner) || null,
      }));

      setQuizData({
        questions_to_answer: questionsToAnswer,
        my_questions: myQuestionsWithAnswers,
      });
    } catch (error) {
      console.error('Error fetching quiz data:', error);
    }

    setIsLoading(false);
  }, [currentUser]);

  // Fetch both players' scores for the scoreboard
  const fetchScores = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    try {
      // Get all answers with their question info
      const { data: answers, error: aError } = await supabase
        .from('quiz_answers')
        .select('player, is_correct, selected_indices, question_id');

      if (aError) throw aError;

      // Get all questions for multiple choice scoring
      const { data: questions, error: qError } = await supabase
        .from('quiz_questions')
        .select('id, is_multiple_choice, correct_answer_indices');

      if (qError) throw qError;

      const questionMap = new Map(questions?.map(q => [q.id, q]) || []);

      // Calculate scores for each player
      const danielAnswers = (answers || []).filter(a => a.player === 'daniel');
      const huaiyaoAnswers = (answers || []).filter(a => a.player === 'huaiyao');

      const calculatePlayerScore = (playerAnswers: typeof answers) => {
        let totalScore = 0;
        for (const answer of playerAnswers || []) {
          const question = questionMap.get(answer.question_id);
          if (question?.is_multiple_choice && question.correct_answer_indices && answer.selected_indices) {
            const correctSet = new Set(question.correct_answer_indices as number[]);
            const selectedSet = new Set(answer.selected_indices as number[]);
            let correctSelected = 0;
            let wrongSelected = 0;
            for (const idx of selectedSet) {
              if (correctSet.has(idx)) correctSelected++;
              else wrongSelected++;
            }
            totalScore += Math.max(0, (correctSelected - wrongSelected) / correctSet.size);
          } else {
            totalScore += answer.is_correct ? 1 : 0;
          }
        }
        return totalScore;
      };

      setScores({
        daniel: { correct: calculatePlayerScore(danielAnswers), total: danielAnswers.length },
        huaiyao: { correct: calculatePlayerScore(huaiyaoAnswers), total: huaiyaoAnswers.length },
      });
    } catch (error) {
      console.error('Error fetching scores:', error);
    }
  }, []);

  // Fetch streak data for both players
  const fetchStreaks = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    try {
      const { data, error } = await supabase
        .from('quiz_player_stats')
        .select('player, current_streak, longest_streak');

      if (error) throw error;

      const danielStats = data?.find(d => d.player === 'daniel');
      const huaiyaoStats = data?.find(d => d.player === 'huaiyao');

      setStreaks({
        daniel: { current: danielStats?.current_streak || 0, longest: danielStats?.longest_streak || 0 },
        huaiyao: { current: huaiyaoStats?.current_streak || 0, longest: huaiyaoStats?.longest_streak || 0 },
      });
    } catch (error) {
      console.error('Error fetching streaks:', error);
    }
  }, []);

  // Fetch quiz categories
  const fetchCategories = useCallback(async () => {
    if (!isSupabaseConfigured) return;

    try {
      const { data, error } = await supabase
        .from('quiz_categories')
        .select('name, emoji, description')
        .order('sort_order');

      if (error) throw error;
      setCategories(data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }, []);

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);
    fetchCategories(); // Fetch categories on mount
  }, [fetchCategories]);

  useEffect(() => {
    if (currentUser) {
      fetchData();
      fetchScores();
      fetchStreaks();
    }
  }, [currentUser, fetchData, fetchScores, fetchStreaks]);

  const sendNotification = async (action: 'question_added' | 'question_answered', detail: string) => {
    if (!currentUser) return;

    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, title: detail, user: currentUser }),
      });
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', user);
  };

  const handleAnswerSelect = (questionId: string, index: number, isMultiple: boolean) => {
    setAnsweringQuestion(questionId);
    if (isMultiple) {
      setSelectedAnswers((prev) =>
        prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
      );
    } else {
      setSelectedAnswer(index);
    }
  };

  const submitAnswer = async (question: QuizQuestion) => {
    const isMultiple = question.is_multiple_choice;
    if (isMultiple) {
      if (selectedAnswers.length === 0 || !currentUser) return;
    } else {
      if (selectedAnswer === null || !currentUser) return;
    }

    setSubmittingAnswer(true);

    try {
      // Check if correct
      let isCorrectAnswer = false;
      if (isMultiple && question.correct_answer_indices) {
        const correctSet = new Set(question.correct_answer_indices);
        const selectedSet = new Set(selectedAnswers);
        isCorrectAnswer = correctSet.size === selectedSet.size &&
          [...correctSet].every(idx => selectedSet.has(idx));
      } else {
        isCorrectAnswer = selectedAnswer === question.correct_answer_index;
      }

      // Insert answer directly
      const { error } = await supabase
        .from('quiz_answers')
        .insert({
          question_id: question.id,
          player: currentUser,
          selected_index: isMultiple ? 0 : selectedAnswer,
          selected_indices: isMultiple ? selectedAnswers : null,
          is_correct: isCorrectAnswer,
        });

      if (error) throw error;

      // Calculate score for popup
      let answerScore = isCorrectAnswer ? 1 : 0;
      if (isMultiple && question.correct_answer_indices) {
        const correctSet = new Set(question.correct_answer_indices);
        let correctSelected = 0;
        let wrongSelected = 0;
        for (const idx of selectedAnswers) {
          if (correctSet.has(idx)) correctSelected++;
          else wrongSelected++;
        }
        answerScore = Math.max(0, (correctSelected - wrongSelected) / correctSet.size);
      }

      // Show the answer result popup
      setAnswerResultPopup({
        question,
        selectedIndex: isMultiple ? null : selectedAnswer,
        selectedIndices: isMultiple ? selectedAnswers : [],
        isCorrect: isCorrectAnswer,
        score: answerScore,
      });

      setLastAnswerResult({
        questionId: question.id,
        isCorrect: isCorrectAnswer,
        correctIndex: question.correct_answer_index ?? 0,
      });

      sendNotification(
        'question_answered',
        `answered your question ${isCorrectAnswer ? 'correctly' : 'incorrectly'}`
      );

      // Update streak
      try {
        await supabase.rpc('update_quiz_streak', {
          p_player: currentUser,
          p_is_correct: isCorrectAnswer,
        });
      } catch (streakError) {
        console.error('Error updating streak:', streakError);
      }

      fetchData();
      fetchScores();
      fetchStreaks();
    } catch (error) {
      console.error('Error submitting answer:', error);
    }

    setSubmittingAnswer(false);
    setAnsweringQuestion(null);
    setSelectedAnswer(null);
    setSelectedAnswers([]);
  };

  const addQuestion = async () => {
    if (!newQuestion.trim() || !currentUser) return;
    const filledOptions = newOptions.filter((opt) => opt.trim());
    if (filledOptions.length < 2) return;

    if (isMultipleChoice) {
      if (correctIndices.length === 0) return;
    } else {
      if (correctIndex === null) return;
    }

    setIsSubmittingQuestion(true);
    setErrorMessage(null);

    try {
      // Direct insert instead of RPC
      const { data: newQ, error } = await supabase
        .from('quiz_questions')
        .insert({
          author: currentUser,
          question_text: newQuestion.trim(),
          options: filledOptions,
          correct_answer_index: isMultipleChoice ? 0 : correctIndex,
          is_two_way: isTwoWay,
          is_multiple_choice: isMultipleChoice,
          correct_answer_indices: isMultipleChoice ? correctIndices : null,
          category: newCategory,
          pending_setup: false,
        })
        .select()
        .single();

      if (error) {
        console.error('Insert error:', error);
        setErrorMessage(`Error: ${error.message}`);
        setIsSubmittingQuestion(false);
        return;
      }

      // If two-way, create partner's pending question
      if (isTwoWay && newQ) {
        const partner = currentUser === 'daniel' ? 'huaiyao' : 'daniel';
        const { data: partnerQ, error: partnerError } = await supabase
          .from('quiz_questions')
          .insert({
            author: partner,
            question_text: newQuestion.trim(),
            options: null,
            correct_answer_index: null,
            is_two_way: true,
            is_multiple_choice: isMultipleChoice,
            correct_answer_indices: null,
            category: newCategory,
            pending_setup: true,
            linked_question_id: newQ.id,
          })
          .select()
          .single();

        if (!partnerError && partnerQ) {
          // Link back
          await supabase
            .from('quiz_questions')
            .update({ linked_question_id: partnerQ.id })
            .eq('id', newQ.id);
        }
      }

      console.log('Question added:', newQ);
      sendNotification('question_added', `added a new quiz question`);

      setNewQuestion('');
      setNewOptions(['', '', '', '']);
      setCorrectIndex(null);
      setCorrectIndices([]);
      setIsTwoWay(false);
      setNewCategory('general');
      setIsMultipleChoice(false);
      setShowAddForm(false);
      fetchData();
    } catch (error) {
      console.error('Error adding question:', error);
      setErrorMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    setIsSubmittingQuestion(false);
  };

  const setupTwoWayQuestion = async () => {
    if (!setupQuestion || !currentUser) return;
    const filledOptions = setupOptions.filter((opt) => opt.trim());
    if (filledOptions.length < 2) return;

    const isMulti = setupQuestion.is_multiple_choice;
    if (isMulti) {
      if (setupCorrectIndices.length === 0) return;
    } else {
      if (setupCorrectIndex === null) return;
    }

    setIsSubmittingSetup(true);

    try {
      // Direct update instead of RPC
      const { error } = await supabase
        .from('quiz_questions')
        .update({
          options: filledOptions,
          correct_answer_index: isMulti ? 0 : setupCorrectIndex,
          correct_answer_indices: isMulti ? setupCorrectIndices : null,
          pending_setup: false,
        })
        .eq('id', setupQuestion.id)
        .eq('author', currentUser);

      if (error) throw error;

      setSetupQuestion(null);
      setSetupOptions(['', '', '', '']);
      setSetupCorrectIndex(null);
      setSetupCorrectIndices([]);
      fetchData();
    } catch (error) {
      console.error('Error setting up two-way question:', error);
    }

    setIsSubmittingSetup(false);
  };

  const deleteQuestion = async (questionId: string) => {
    if (!currentUser) return;

    try {
      // Get the question first to check for linked question
      const { data: question } = await supabase
        .from('quiz_questions')
        .select('linked_question_id')
        .eq('id', questionId)
        .eq('author', currentUser)
        .single();

      // Delete the question
      const { error } = await supabase
        .from('quiz_questions')
        .delete()
        .eq('id', questionId)
        .eq('author', currentUser);

      if (error) throw error;

      // Also delete linked question if exists
      if (question?.linked_question_id) {
        await supabase
          .from('quiz_questions')
          .delete()
          .eq('id', question.linked_question_id);
      }

      fetchData();
    } catch (error) {
      console.error('Error deleting question:', error);
    }
  };

  // Calculate score with partial credit for multiple choice
  const answeredQuestions = quizData?.questions_to_answer.filter((q) => q.answer) || [];
  const totalScore = answeredQuestions.reduce((sum, q) => sum + calculateQuestionScore(q), 0);
  const totalAnswered = answeredQuestions.length;
  const percentage = totalAnswered > 0 ? Math.round((totalScore / totalAnswered) * 100) : 0;

  // User selection screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md"
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="text-6xl mb-6"
          >
            🧠
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 dark:text-white mb-4">Who are you?</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-8">Let's see how well you know each other!</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectUser('daniel')}
              className="px-8 py-4 rounded-xl bg-blue-500 text-white font-medium shadow-lg hover:bg-blue-600 transition-colors"
            >
              I'm Daniel
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectUser('huaiyao')}
              className="px-8 py-4 rounded-xl bg-rose-500 text-white font-medium shadow-lg hover:bg-rose-600 transition-colors"
            >
              I'm Huaiyao
            </motion.button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-500 rounded-full"
        />
      </div>
    );
  }

  const questionsToAnswer = quizData?.questions_to_answer || [];
  const myQuestions = quizData?.my_questions || [];

  // Apply category filter
  const filteredQuestionsToAnswer = filterCategory
    ? questionsToAnswer.filter((q) => q.category === filterCategory)
    : questionsToAnswer;
  const filteredMyQuestions = filterCategory
    ? myQuestions.filter((q) => q.category === filterCategory)
    : myQuestions;

  const unansweredQuestions = filteredQuestionsToAnswer.filter((q) => !q.answer);
  const answeredQuestionsFiltered = filteredQuestionsToAnswer.filter((q) => q.answer);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-100/30 dark:bg-indigo-900/20 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-100/30 dark:bg-purple-900/20 rounded-full blur-3xl"
          animate={{ scale: [1.1, 1, 1.1], x: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-6 sm:py-12 pb-safe">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6 sm:mb-8"
        >
          <div className="flex items-center justify-between mb-4">
            <a
              href="/"
              className="px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 active:text-gray-800 transition-colors touch-manipulation"
            >
              ← Home
            </a>
            <ThemeToggle />
          </div>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 dark:text-white mb-2">
            Quiz Time
          </h1>
          <p className="text-gray-500 dark:text-gray-400">How well do you know each other?</p>

        </motion.div>

        {/* Competitive Scoreboard */}
        {scores && (scores.daniel.total > 0 || scores.huaiyao.total > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-4 shadow-lg text-white"
          >
            <div className="text-center mb-3">
              <span className="text-lg font-medium">🏆 Scoreboard 🏆</span>
            </div>
            <div className="flex justify-around items-center">
              {/* Daniel's Score */}
              <div className="text-center">
                <div className="text-sm opacity-80 mb-1">Daniel</div>
                <div className="text-2xl font-bold">
                  {scores.daniel.correct.toFixed(scores.daniel.correct % 1 === 0 ? 0 : 1)}/{scores.daniel.total}
                </div>
                <div className="text-sm opacity-80">
                  ({scores.daniel.total > 0 ? Math.round((scores.daniel.correct / scores.daniel.total) * 100) : 0}%)
                </div>
              </div>

              {/* VS Divider */}
              <div className="text-2xl font-bold opacity-50">vs</div>

              {/* Huaiyao's Score */}
              <div className="text-center">
                <div className="text-sm opacity-80 mb-1">Huaiyao</div>
                <div className="text-2xl font-bold">
                  {scores.huaiyao.correct.toFixed(scores.huaiyao.correct % 1 === 0 ? 0 : 1)}/{scores.huaiyao.total}
                </div>
                <div className="text-sm opacity-80">
                  ({scores.huaiyao.total > 0 ? Math.round((scores.huaiyao.correct / scores.huaiyao.total) * 100) : 0}%)
                </div>
              </div>
            </div>

            {/* Streak Display */}
            {streaks && (streaks.daniel.current > 0 || streaks.huaiyao.current > 0 || streaks.daniel.longest > 0 || streaks.huaiyao.longest > 0) && (
              <div className="flex justify-around items-center mt-3 pt-3 border-t border-white/20">
                <div className="text-center">
                  <div className="text-xs opacity-70">🔥 Streak</div>
                  <div className="font-bold">{streaks.daniel.current}</div>
                  <div className="text-xs opacity-60">Best: {streaks.daniel.longest}</div>
                </div>
                <div className="text-xs opacity-50">days</div>
                <div className="text-center">
                  <div className="text-xs opacity-70">🔥 Streak</div>
                  <div className="font-bold">{streaks.huaiyao.current}</div>
                  <div className="text-xs opacity-60">Best: {streaks.huaiyao.longest}</div>
                </div>
              </div>
            )}

            {/* Winner Message */}
            <div className="text-center mt-3 text-sm font-medium">
              {(() => {
                const danielPct = scores.daniel.total > 0 ? scores.daniel.correct / scores.daniel.total : 0;
                const huaiyaoPct = scores.huaiyao.total > 0 ? scores.huaiyao.correct / scores.huaiyao.total : 0;
                if (scores.daniel.total === 0 && scores.huaiyao.total === 0) {
                  return "Start answering questions!";
                } else if (scores.daniel.total === 0) {
                  return "Daniel hasn't answered any yet!";
                } else if (scores.huaiyao.total === 0) {
                  return "Huaiyao hasn't answered any yet!";
                } else if (Math.abs(danielPct - huaiyaoPct) < 0.01) {
                  return "🤝 It's a tie!";
                } else if (danielPct > huaiyaoPct) {
                  return "👑 Daniel is winning!";
                } else {
                  return "👑 Huaiyao is winning!";
                }
              })()}
            </div>
          </motion.div>
        )}

        {/* Answer Result Popup Modal */}
        <AnimatePresence>
          {answerResultPopup && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
              onClick={() => setAnswerResultPopup(null)}
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className={`bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl text-center ${
                  answerResultPopup.isCorrect ? '' : ''
                }`}
              >
                {/* Result Icon */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: [0, 1.3, 1] }}
                  transition={{ duration: 0.5, times: [0, 0.6, 1] }}
                  className="text-6xl mb-4"
                >
                  {answerResultPopup.isCorrect ? (
                    <span className="inline-block">✅</span>
                  ) : answerResultPopup.score > 0 ? (
                    <span className="inline-block">🤏</span>
                  ) : (
                    <span className="inline-block">❌</span>
                  )}
                </motion.div>

                {/* Result Text */}
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className={`text-2xl font-bold mb-4 ${
                    answerResultPopup.isCorrect
                      ? 'text-green-600'
                      : answerResultPopup.score > 0
                      ? 'text-yellow-600'
                      : 'text-red-500'
                  }`}
                >
                  {answerResultPopup.isCorrect
                    ? 'Correct!'
                    : answerResultPopup.score > 0
                    ? `Partially Correct (${Math.round(answerResultPopup.score * 100)}%)`
                    : 'Wrong!'}
                </motion.h2>

                {/* Question */}
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-gray-600 mb-4"
                >
                  {answerResultPopup.question.question_text}
                </motion.p>

                {/* Your Answer */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                  className={`p-3 rounded-lg mb-3 ${
                    answerResultPopup.isCorrect
                      ? 'bg-green-100 text-green-800'
                      : answerResultPopup.score > 0
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  <div className="text-sm opacity-70 mb-1">Your answer:</div>
                  <div className="font-medium">
                    {answerResultPopup.question.is_multiple_choice ? (
                      answerResultPopup.selectedIndices.length > 0 ? (
                        answerResultPopup.selectedIndices
                          .map((idx) => answerResultPopup.question.options?.[idx])
                          .join(', ')
                      ) : 'None selected'
                    ) : (
                      answerResultPopup.question.options?.[answerResultPopup.selectedIndex ?? 0]
                    )}{' '}
                    {answerResultPopup.isCorrect ? '✓' : answerResultPopup.score > 0 ? '~' : '✗'}
                  </div>
                </motion.div>

                {/* Correct Answer (if wrong) */}
                {!answerResultPopup.isCorrect && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 }}
                    className="p-3 rounded-lg bg-green-100 text-green-800"
                  >
                    <div className="text-sm opacity-70 mb-1">Correct answer:</div>
                    <div className="font-medium">
                      {answerResultPopup.question.is_multiple_choice && answerResultPopup.question.correct_answer_indices ? (
                        answerResultPopup.question.correct_answer_indices
                          .map((idx) => answerResultPopup.question.options?.[idx])
                          .join(', ')
                      ) : (
                        answerResultPopup.question.options?.[answerResultPopup.question.correct_answer_index ?? 0]
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Confetti effect for correct answers */}
                {answerResultPopup.isCorrect && (
                  <motion.div
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ delay: 1.5, duration: 0.5 }}
                    className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl"
                  >
                    {[...Array(20)].map((_, i) => (
                      <motion.div
                        key={i}
                        initial={{
                          x: '50%',
                          y: '50%',
                          scale: 0,
                        }}
                        animate={{
                          x: `${Math.random() * 100}%`,
                          y: `${Math.random() * 100}%`,
                          scale: [0, 1, 0.5],
                          rotate: Math.random() * 360,
                        }}
                        transition={{
                          duration: 1,
                          delay: i * 0.05,
                          ease: 'easeOut',
                        }}
                        className="absolute w-3 h-3"
                        style={{
                          background: ['#10B981', '#6366F1', '#F59E0B', '#EC4899', '#8B5CF6'][i % 5],
                          borderRadius: Math.random() > 0.5 ? '50%' : '0%',
                        }}
                      />
                    ))}
                  </motion.div>
                )}

                {/* Continue Button */}
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  onClick={() => setAnswerResultPopup(null)}
                  className="mt-6 w-full py-3 bg-indigo-500 text-white rounded-xl font-medium hover:bg-indigo-600 transition-colors"
                >
                  Continue
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('answer')}
            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
              activeTab === 'answer'
                ? 'bg-indigo-500 text-white shadow-lg'
                : 'bg-white/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'
            }`}
          >
            Answer Questions
            {unansweredQuestions.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-white/20 rounded-full text-sm">
                {unansweredQuestions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('your-questions')}
            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
              activeTab === 'your-questions'
                ? 'bg-indigo-500 text-white shadow-lg'
                : 'bg-white/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700'
            }`}
          >
            Your Questions
            <span className="ml-2 px-2 py-0.5 bg-white/20 rounded-full text-sm">
              {myQuestions.length}
            </span>
          </button>
        </div>

        {/* Answer Questions Tab */}
        <AnimatePresence mode="wait">
          {activeTab === 'answer' && (
            <motion.div
              key="answer"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-4"
            >
              <h2 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-4">
                How well do you know {partnerName}?
              </h2>

              {/* Category Filter */}
              {categories.length > 0 && questionsToAnswer.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4 -mx-1">
                  <button
                    onClick={() => setFilterCategory(null)}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      filterCategory === null
                        ? 'bg-indigo-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    All
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat.name}
                      onClick={() => setFilterCategory(cat.name)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        filterCategory === cat.name
                          ? 'bg-indigo-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {cat.emoji} {cat.name}
                    </button>
                  ))}
                </div>
              )}

              {filteredQuestionsToAnswer.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <div className="text-4xl mb-4">📝</div>
                  <p>{partnerName} hasn't added any questions yet.</p>
                  <p className="text-sm mt-2">Ask them to write some!</p>
                </div>
              ) : (
                <>
                  {/* Unanswered questions */}
                  {unansweredQuestions.length > 0 && (
                    <div className="space-y-4">
                      {unansweredQuestions.map((question) => (
                        <QuestionCard
                          key={question.id}
                          question={question}
                          isAnswering={answeringQuestion === question.id}
                          selectedAnswer={answeringQuestion === question.id ? selectedAnswer : null}
                          selectedAnswers={answeringQuestion === question.id ? selectedAnswers : []}
                          onSelectAnswer={(idx) => handleAnswerSelect(question.id, idx, question.is_multiple_choice || false)}
                          onSubmit={() => submitAnswer(question)}
                          isSubmitting={submittingAnswer}
                          lastResult={lastAnswerResult?.questionId === question.id ? lastAnswerResult : null}
                        />
                      ))}
                    </div>
                  )}

                  {/* Answered questions */}
                  {answeredQuestionsFiltered.length > 0 && (
                    <div className="mt-8">
                      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Already Answered</h3>
                      <div className="space-y-3">
                        {answeredQuestionsFiltered.map((question) => (
                          <AnsweredQuestionCard key={question.id} question={question} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Your Questions Tab */}
          {activeTab === 'your-questions' && (
            <motion.div
              key="your-questions"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h2 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-4">
                Questions you wrote about yourself
              </h2>

              {/* Pending setup questions (two-way questions from partner) */}
              {myQuestions.filter((q) => q.pending_setup).length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-amber-600 mb-3">Needs your answer</h3>
                  <div className="space-y-3">
                    {myQuestions
                      .filter((q) => q.pending_setup)
                      .map((question) => (
                        <PendingSetupCard
                          key={question.id}
                          question={question}
                          partnerName={partnerName}
                          onSetup={() => setSetupQuestion(question)}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Setup modal */}
              <AnimatePresence>
                {setupQuestion && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
                    onClick={() => setSetupQuestion(null)}
                  >
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto"
                    >
                      <h3 className="font-medium text-gray-800 mb-2">Set up your answer</h3>
                      <p className="text-sm text-gray-500 mb-4">
                        {partnerName} asked: "{setupQuestion.question_text}"
                        <br />
                        <span className="text-indigo-500">Now fill in YOUR answer options:</span>
                        {setupQuestion.is_multiple_choice && (
                          <span className="block mt-1 text-purple-500">
                            (Multiple choice - select all correct answers)
                          </span>
                        )}
                      </p>

                      <div className="space-y-2 mb-2">
                        {setupOptions.map((option, idx) => (
                          <div key={idx} className="relative flex gap-2">
                            <input
                              type="text"
                              placeholder={`Option ${idx + 1}`}
                              value={option}
                              onChange={(e) => {
                                const updated = [...setupOptions];
                                updated[idx] = e.target.value;
                                setSetupOptions(updated);
                              }}
                              className={`flex-1 px-4 py-3 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                                setupQuestion.is_multiple_choice
                                  ? setupCorrectIndices.includes(idx)
                                    ? 'bg-green-50 border-green-300'
                                    : 'bg-white border-gray-200'
                                  : setupCorrectIndex === idx
                                  ? 'bg-green-50 border-green-300'
                                  : 'bg-white border-gray-200'
                              }`}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (setupQuestion.is_multiple_choice) {
                                  setSetupCorrectIndices((prev) =>
                                    prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                                  );
                                } else {
                                  setSetupCorrectIndex(idx);
                                }
                              }}
                              className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                                setupQuestion.is_multiple_choice
                                  ? setupCorrectIndices.includes(idx)
                                    ? 'bg-green-500 border-green-500 text-white'
                                    : 'border-gray-300 hover:border-green-400'
                                  : setupCorrectIndex === idx
                                  ? 'bg-green-500 border-green-500 text-white'
                                  : 'border-gray-300 hover:border-green-400'
                              }`}
                            >
                              {((setupQuestion.is_multiple_choice && setupCorrectIndices.includes(idx)) ||
                                (!setupQuestion.is_multiple_choice && setupCorrectIndex === idx)) && (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                            {setupOptions.length > 2 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = setupOptions.filter((_, i) => i !== idx);
                                  setSetupOptions(updated);
                                  if (setupQuestion.is_multiple_choice) {
                                    setSetupCorrectIndices((prev) =>
                                      prev.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i))
                                    );
                                  } else if (setupCorrectIndex === idx) {
                                    setSetupCorrectIndex(null);
                                  } else if (setupCorrectIndex !== null && setupCorrectIndex > idx) {
                                    setSetupCorrectIndex(setupCorrectIndex - 1);
                                  }
                                }}
                                className="w-10 h-10 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors flex-shrink-0"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Add more options button */}
                      <button
                        type="button"
                        onClick={() => setSetupOptions([...setupOptions, ''])}
                        className="w-full py-2 mb-4 text-sm text-indigo-500 hover:text-indigo-700 border border-dashed border-indigo-300 hover:border-indigo-400 rounded-lg transition-colors"
                      >
                        + Add option
                      </button>

                      <div className="flex gap-2">
                        <button
                          onClick={setupTwoWayQuestion}
                          disabled={
                            setupOptions.filter((o) => o.trim()).length < 2 ||
                            (setupQuestion.is_multiple_choice
                              ? setupCorrectIndices.length === 0
                              : setupCorrectIndex === null) ||
                            isSubmittingSetup
                          }
                          className="flex-1 py-3 bg-indigo-500 text-white rounded-lg font-medium hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {isSubmittingSetup ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setSetupQuestion(null);
                            setSetupOptions(['', '', '', '']);
                            setSetupCorrectIndex(null);
                            setSetupCorrectIndices([]);
                          }}
                          className="px-4 py-3 text-gray-500 hover:text-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {myQuestions.filter((q) => !q.pending_setup).length === 0 && !showAddForm ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <div className="text-4xl mb-4">🤔</div>
                  <p>You haven't created any questions yet.</p>
                  <p className="text-sm mt-2">Add questions about yourself for {partnerName} to answer!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myQuestions
                    .filter((q) => !q.pending_setup)
                    .map((question) => (
                      <MyQuestionCard
                        key={question.id}
                        question={question}
                        partnerName={partnerName}
                        onDelete={() => deleteQuestion(question.id)}
                      />
                    ))}
                </div>
              )}

              {/* Add Question Form */}
              {showAddForm ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-xl p-4 shadow-sm"
                >
                  <h3 className="font-medium text-gray-800 dark:text-white mb-4">Add a question about yourself</h3>

                  <input
                    type="text"
                    placeholder="e.g., What's my favorite food?"
                    value={newQuestion}
                    onChange={(e) => setNewQuestion(e.target.value)}
                    className="w-full px-4 py-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:text-white mb-2"
                  />

                  {/* Inspiration button */}
                  <button
                    type="button"
                    onClick={() => setShowInspiration(true)}
                    className="mb-4 text-sm text-indigo-500 hover:text-indigo-700 flex items-center gap-1"
                  >
                    <span>💡</span> Need inspiration?
                  </button>

                  {/* Category selector */}
                  {categories.length > 0 && (
                    <div className="mb-4">
                      <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">Category:</label>
                      <div className="flex flex-wrap gap-2">
                        {categories.map((cat) => (
                          <button
                            key={cat.name}
                            type="button"
                            onClick={() => setNewCategory(cat.name)}
                            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                              newCategory === cat.name
                                ? 'bg-indigo-500 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {cat.emoji} {cat.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Inspiration Modal */}
                  <AnimatePresence>
                    {showInspiration && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
                        onClick={() => setShowInspiration(false)}
                      >
                        <motion.div
                          initial={{ scale: 0.9, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.9, opacity: 0 }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-white rounded-xl p-4 max-w-lg w-full shadow-xl max-h-[80vh] overflow-y-auto"
                        >
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="font-medium text-gray-800 text-lg">Question Ideas</h3>
                            <button
                              onClick={() => setShowInspiration(false)}
                              className="p-1 text-gray-400 hover:text-gray-600"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          <p className="text-sm text-gray-500 mb-4">Tap a question to use it</p>

                          <div className="space-y-4">
                            {Object.entries(questionSuggestions).map(([key, category]) => (
                              <div key={key}>
                                <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                                  <span>{category.emoji}</span> {category.title}
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                  {category.questions.map((q, idx) => (
                                    <button
                                      key={idx}
                                      onClick={() => {
                                        setNewQuestion(q);
                                        setShowInspiration(false);
                                      }}
                                      className="text-left text-sm px-3 py-2 bg-gray-100 hover:bg-indigo-100 hover:text-indigo-700 rounded-lg transition-colors"
                                    >
                                      {q}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Multiple choice toggle */}
                  <label className="flex items-center gap-3 mb-4 p-3 bg-purple-50 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isMultipleChoice}
                      onChange={(e) => {
                        setIsMultipleChoice(e.target.checked);
                        if (e.target.checked) {
                          setCorrectIndex(null);
                        } else {
                          setCorrectIndices([]);
                        }
                      }}
                      className="w-5 h-5 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                    />
                    <div>
                      <span className="font-medium text-gray-800">Multiple choice</span>
                      <p className="text-xs text-gray-500">
                        Multiple answers can be correct (select all that apply)
                      </p>
                    </div>
                  </label>

                  <p className="text-sm text-gray-500 mb-2">
                    Answer options (tap to mark correct{isMultipleChoice ? ' - select all correct answers' : ''}):
                  </p>
                  <div className="space-y-2 mb-2">
                    {newOptions.map((option, idx) => (
                      <div key={idx} className="relative flex gap-2">
                        <input
                          type="text"
                          placeholder={`Option ${idx + 1}`}
                          value={option}
                          onChange={(e) => {
                            const updated = [...newOptions];
                            updated[idx] = e.target.value;
                            setNewOptions(updated);
                          }}
                          className={`flex-1 px-4 py-3 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                            isMultipleChoice
                              ? correctIndices.includes(idx)
                                ? 'bg-green-50 border-green-300'
                                : 'bg-white border-gray-200'
                              : correctIndex === idx
                              ? 'bg-green-50 border-green-300'
                              : 'bg-white border-gray-200'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (isMultipleChoice) {
                              setCorrectIndices((prev) =>
                                prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
                              );
                            } else {
                              setCorrectIndex(idx);
                            }
                          }}
                          className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                            isMultipleChoice
                              ? correctIndices.includes(idx)
                                ? 'bg-green-500 border-green-500 text-white'
                                : 'border-gray-300 hover:border-green-400'
                              : correctIndex === idx
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-gray-300 hover:border-green-400'
                          }`}
                        >
                          {((isMultipleChoice && correctIndices.includes(idx)) ||
                            (!isMultipleChoice && correctIndex === idx)) && (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        {newOptions.length > 2 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = newOptions.filter((_, i) => i !== idx);
                              setNewOptions(updated);
                              if (isMultipleChoice) {
                                setCorrectIndices((prev) =>
                                  prev.filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i))
                                );
                              } else if (correctIndex === idx) {
                                setCorrectIndex(null);
                              } else if (correctIndex !== null && correctIndex > idx) {
                                setCorrectIndex(correctIndex - 1);
                              }
                            }}
                            className="w-10 h-10 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors flex-shrink-0"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Add more options button */}
                  <button
                    type="button"
                    onClick={() => setNewOptions([...newOptions, ''])}
                    className="w-full py-2 mb-4 text-sm text-indigo-500 hover:text-indigo-700 border border-dashed border-indigo-300 hover:border-indigo-400 rounded-lg transition-colors"
                  >
                    + Add option
                  </button>

                  {/* Two-way toggle */}
                  <label className="flex items-center gap-3 mb-4 p-3 bg-indigo-50 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isTwoWay}
                      onChange={(e) => setIsTwoWay(e.target.checked)}
                      className="w-5 h-5 rounded border-gray-300 text-indigo-500 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="font-medium text-gray-800">Two-way question</span>
                      <p className="text-xs text-gray-500">
                        {partnerName} will also answer this about themselves, and you'll guess their answer
                      </p>
                    </div>
                  </label>

                  {errorMessage && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                      {errorMessage}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={addQuestion}
                      disabled={
                        !newQuestion.trim() ||
                        newOptions.filter((o) => o.trim()).length < 2 ||
                        (isMultipleChoice ? correctIndices.length === 0 : correctIndex === null) ||
                        isSubmittingQuestion
                      }
                      className="flex-1 py-3 bg-indigo-500 text-white rounded-lg font-medium hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSubmittingQuestion ? 'Adding...' : 'Add Question'}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddForm(false);
                        setNewQuestion('');
                        setNewOptions(['', '', '', '']);
                        setCorrectIndex(null);
                        setCorrectIndices([]);
                        setIsTwoWay(false);
                        setIsMultipleChoice(false);
                        setErrorMessage(null);
                      }}
                      className="px-4 py-3 text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full py-4 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 rounded-xl text-gray-400 dark:text-gray-500 hover:text-indigo-500 transition-colors"
                >
                  + Add Question
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 dark:text-gray-500 text-sm"
        >
          <p>
            Logged in as{' '}
            <span className={currentUser === 'daniel' ? 'text-blue-500' : 'text-rose-500'}>
              {currentUser === 'daniel' ? 'Daniel' : 'Huaiyao'}
            </span>
            {' · '}
            <button
              onClick={() => {
                localStorage.removeItem('currentUser');
                setCurrentUser(null);
              }}
              className="underline hover:text-gray-600 dark:hover:text-gray-300"
            >
              Switch
            </button>
          </p>
        </motion.footer>
      </main>
    </div>
  );
}

// Question Card Component (for unanswered questions)
function QuestionCard({
  question,
  isAnswering,
  selectedAnswer,
  selectedAnswers,
  onSelectAnswer,
  onSubmit,
  isSubmitting,
  lastResult,
}: {
  question: QuizQuestion;
  isAnswering: boolean;
  selectedAnswer: number | null;
  selectedAnswers: number[];
  onSelectAnswer: (idx: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  lastResult: { isCorrect: boolean; correctIndex: number } | null;
}) {
  if (!question.options) return null;

  const isMultiple = question.is_multiple_choice;
  const hasSelection = isMultiple ? selectedAnswers.length > 0 : selectedAnswer !== null;

  return (
    <motion.div
      layout
      className="bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-xl p-4 shadow-sm"
    >
      <div className="flex flex-wrap gap-2 mb-2">
        {question.is_two_way && (
          <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs rounded-full">
            Two-way
          </span>
        )}
        {isMultiple && (
          <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded-full">
            Select all that apply
          </span>
        )}
      </div>
      <h3 className="font-medium text-gray-800 dark:text-white mb-4">{question.question_text}</h3>

      <div className={`grid gap-2 ${question.options.length > 4 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {question.options.map((option, idx) => {
          const isSelected = isMultiple ? selectedAnswers.includes(idx) : selectedAnswer === idx;
          return (
            <motion.button
              key={idx}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelectAnswer(idx)}
              className={`p-3 rounded-lg text-left transition-all ${
                isSelected
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {option}
            </motion.button>
          );
        })}
      </div>

      {isAnswering && hasSelection && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={onSubmit}
          disabled={isSubmitting}
          className="w-full mt-4 py-3 bg-indigo-500 text-white rounded-lg font-medium hover:bg-indigo-600 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? 'Submitting...' : 'Lock in Answer'}
        </motion.button>
      )}
    </motion.div>
  );
}

// Answered Question Card Component
function AnsweredQuestionCard({ question }: { question: QuizQuestion }) {
  const isMultiple = question.is_multiple_choice;
  const score = calculateQuestionScore(question);
  const scorePercent = Math.round(score * 100);
  const isPerfect = score === 1;
  const isZero = score === 0;

  if (!question.options) return null;

  const getSelectedText = () => {
    if (!question.options) return '';
    if (isMultiple && question.answer?.selected_indices) {
      return question.answer.selected_indices.map((idx) => question.options![idx]).join(', ');
    }
    return question.options[question.answer?.selected_index ?? 0];
  };

  const getCorrectText = () => {
    if (!question.options) return '';
    if (isMultiple && question.correct_answer_indices) {
      return question.correct_answer_indices.map((idx) => question.options![idx]).join(', ');
    }
    return question.options[question.correct_answer_index ?? 0];
  };

  // Border color based on score
  const borderColor = isPerfect
    ? 'border-green-500'
    : isZero
    ? 'border-red-400'
    : 'border-yellow-400';

  const scoreColor = isPerfect
    ? 'text-green-500'
    : isZero
    ? 'text-red-400'
    : 'text-yellow-500';

  return (
    <motion.div
      layout
      className={`bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-xl p-4 shadow-sm border-l-4 ${borderColor}`}
    >
      <div className="flex items-start gap-2">
        <span className={`text-lg ${scoreColor}`}>
          {isPerfect ? '✓' : isZero ? '✗' : '~'}
        </span>
        <div className="flex-1">
          <div className="flex flex-wrap gap-1 mb-1">
            {question.is_two_way && (
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs rounded-full">
                Two-way
              </span>
            )}
            {isMultiple && (
              <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                Multiple choice
              </span>
            )}
            {isMultiple && (
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                isPerfect ? 'bg-green-100 text-green-700' : isZero ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
              }`}>
                {scorePercent}%
              </span>
            )}
          </div>
          <h3 className="font-medium text-gray-800 dark:text-white">{question.question_text}</h3>

          <p className={`text-sm mt-2 ${isPerfect ? 'text-green-600' : isZero ? 'text-red-500' : 'text-yellow-600'}`}>
            You answered: {getSelectedText()} {isPerfect ? '✓' : isZero ? '✗' : `(${scorePercent}%)`}
          </p>

          {!isPerfect && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Correct answer{isMultiple ? 's' : ''}: {getCorrectText()}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Pending Setup Card Component (for two-way questions that need setup)
function PendingSetupCard({
  question,
  partnerName,
  onSetup,
}: {
  question: QuizQuestion;
  partnerName: string;
  onSetup: () => void;
}) {
  return (
    <motion.div
      layout
      className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex flex-wrap gap-1 mb-1">
            <span className="px-2 py-0.5 bg-amber-200 text-amber-800 text-xs rounded-full">
              Two-way
            </span>
            {question.is_multiple_choice && (
              <span className="px-2 py-0.5 bg-purple-200 text-purple-800 text-xs rounded-full">
                Multiple choice
              </span>
            )}
          </div>
          <h3 className="font-medium text-gray-800">{question.question_text}</h3>
          <p className="text-sm text-amber-600 mt-2">
            {partnerName} created this two-way question. Fill in YOUR answer options!
          </p>
        </div>
        <button
          onClick={onSetup}
          className="px-4 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors"
        >
          Set up
        </button>
      </div>
    </motion.div>
  );
}

// My Question Card Component
function MyQuestionCard({
  question,
  partnerName,
  onDelete,
}: {
  question: QuizQuestion;
  partnerName: string;
  onDelete: () => void;
}) {
  const hasPartnerAnswer = question.partner_answer;
  const isMultiple = question.is_multiple_choice;

  // Calculate partner's score for multiple choice
  const getPartnerScore = (): number => {
    if (!hasPartnerAnswer || !isMultiple || !question.correct_answer_indices || !question.partner_answer?.selected_indices) {
      return question.partner_answer?.is_correct ? 1 : 0;
    }
    const correctSet = new Set(question.correct_answer_indices);
    const selectedSet = new Set(question.partner_answer.selected_indices);
    let correctSelected = 0;
    let wrongSelected = 0;
    for (const idx of selectedSet) {
      if (correctSet.has(idx)) correctSelected++;
      else wrongSelected++;
    }
    return Math.max(0, (correctSelected - wrongSelected) / correctSet.size);
  };

  const partnerScore = getPartnerScore();
  const partnerScorePercent = Math.round(partnerScore * 100);
  const isPerfect = partnerScore === 1;
  const isZero = partnerScore === 0;

  const getCorrectText = () => {
    if (!question.options) return '';
    if (isMultiple && question.correct_answer_indices) {
      return question.correct_answer_indices.map((idx) => question.options![idx]).join(', ');
    }
    if (question.correct_answer_index !== null) {
      return question.options[question.correct_answer_index];
    }
    return '';
  };

  const getPartnerAnswerText = () => {
    if (!question.options || !question.partner_answer) return '';
    if (isMultiple && question.partner_answer.selected_indices) {
      return question.partner_answer.selected_indices.map((idx) => question.options![idx]).join(', ');
    }
    return question.options[question.partner_answer.selected_index];
  };

  const scoreColor = isPerfect ? 'text-green-600' : isZero ? 'text-red-500' : 'text-yellow-600';

  return (
    <motion.div layout className="bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-xl p-4 shadow-sm group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex flex-wrap gap-1 mb-1">
            {question.is_two_way && (
              <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs rounded-full">
                Two-way
              </span>
            )}
            {isMultiple && (
              <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs rounded-full">
                Multiple choice
              </span>
            )}
          </div>
          <h3 className="font-medium text-gray-800 dark:text-white">{question.question_text}</h3>

          {question.options && (question.correct_answer_index !== null || question.correct_answer_indices) && (
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="text-green-600">
                Correct: {getCorrectText()}
              </span>
            </div>
          )}

          {hasPartnerAnswer && question.options ? (
            <div className={`mt-2 text-sm ${scoreColor}`}>
              {partnerName} answered: {getPartnerAnswerText()}{' '}
              {isPerfect ? '✓' : isZero ? '✗' : `(${partnerScorePercent}%)`}
            </div>
          ) : (
            <div className="mt-2 text-sm text-gray-400 dark:text-gray-500">
              {partnerName} hasn't answered yet
            </div>
          )}
        </div>

        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 p-2 text-gray-400 hover:text-red-500 transition-all"
          title="Delete question"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
