'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured, DateIdea, Category } from '@/lib/supabase';

interface LocalCategory {
  id: string;
  name: string;
  emoji: string;
  ideas: DateIdea[];
}

// Default categories for initial setup
const defaultCategories = [
  { name: 'Learn Things', emoji: '📚', sort_order: 1 },
  { name: 'Feeling Adventurous', emoji: '🏔️', sort_order: 2 },
  { name: 'Animals', emoji: '🦁', sort_order: 3 },
  { name: 'Something Chilled', emoji: '😌', sort_order: 4 },
  { name: 'Active & Fun', emoji: '🎯', sort_order: 5 },
  { name: 'Silly Ideas', emoji: '🤪', sort_order: 6 },
  { name: 'Other', emoji: '✨', sort_order: 7 },
];

// Default ideas to seed
const defaultIdeas: { category: string; title: string; description?: string; emoji?: string; completed?: boolean }[] = [
  // Learn Things
  { category: 'Learn Things', title: 'DND', description: 'Join a single season' },
  { category: 'Learn Things', title: 'Dancing', emoji: '🕺', description: 'Go to a dance lesson together' },
  { category: 'Learn Things', title: 'Archery', emoji: '🏹' },
  { category: 'Learn Things', title: 'Website Battle', description: 'First to £10 profit' },
  { category: 'Learn Things', title: 'Kalimba' },
  { category: 'Learn Things', title: 'Navigation', description: 'Map + compass' },
  { category: 'Learn Things', title: 'Memory Palaces' },
  { category: 'Learn Things', title: 'Calligraphy' },
  { category: 'Learn Things', title: 'Poker' },
  { category: 'Learn Things', title: 'Trust-building Exercises' },
  { category: 'Learn Things', title: 'Fire-making' },
  { category: 'Learn Things', title: 'Conflict Resolution Skills' },
  { category: 'Learn Things', title: 'Magic Trick' },
  { category: 'Learn Things', title: 'Chess Properly', description: 'Openings, not vibes' },
  { category: 'Learn Things', title: 'Foraging' },
  { category: 'Learn Things', title: 'First Aid' },
  { category: 'Learn Things', title: 'Negotiation Skills' },
  { category: 'Learn Things', title: 'Sign Language Basics' },
  { category: 'Learn Things', title: 'Morse Code', description: 'Ridiculous but fun' },
  { category: 'Learn Things', title: 'Memory Techniques' },
  { category: 'Learn Things', title: 'Car Maintenance Basics' },
  { category: 'Learn Things', title: 'Wilderness Survival Basics' },
  { category: 'Learn Things', title: 'Interrogation Skills' },
  { category: 'Learn Things', title: 'Wild Hunting' },
  { category: 'Learn Things', title: 'Solve Rubix Cube' },
  // Feeling Adventurous
  { category: 'Feeling Adventurous', title: 'Abseiling' },
  { category: 'Feeling Adventurous', title: 'Aqueduct' },
  { category: 'Feeling Adventurous', title: 'Coastal Foraging' },
  { category: 'Feeling Adventurous', title: 'Hilbre Island', description: 'Chicken edition' },
  { category: 'Feeling Adventurous', title: 'Waterfall Pool Swim' },
  { category: 'Feeling Adventurous', title: 'Swim in the Sea', emoji: '🦈' },
  { category: 'Feeling Adventurous', title: 'Beach Barbeque' },
  { category: 'Feeling Adventurous', title: 'Wild Camping' },
  { category: 'Feeling Adventurous', title: 'Hike up a Mountain' },
  { category: 'Feeling Adventurous', title: 'Treasure Hunting', emoji: '🧭' },
  { category: 'Feeling Adventurous', title: 'Sea Rock Walking' },
  { category: 'Feeling Adventurous', title: 'Adventure Hardmode', description: 'No GPS, no phones' },
  { category: 'Feeling Adventurous', title: 'Find the Aurora' },
  // Animals
  { category: 'Animals', title: 'Aquarium', emoji: '🐠' },
  { category: 'Animals', title: 'Animal Shelter', emoji: '🐶' },
  { category: 'Animals', title: 'Chester Zoo', emoji: '🦁' },
  { category: 'Animals', title: 'Safari', emoji: '🐘' },
  // Something Chilled
  { category: 'Something Chilled', title: 'Escape Room', completed: true },
  { category: 'Something Chilled', title: 'Plan a Start-up Together', emoji: '✨' },
  { category: 'Something Chilled', title: 'Build a Fort and Sleep in it', emoji: '🛌' },
  { category: 'Something Chilled', title: 'Board Game Cafe', description: 'Spiel des Jahres games' },
  { category: 'Something Chilled', title: "Films Daniel Hasn't Seen" },
  { category: 'Something Chilled', title: 'Dish Off', description: 'Compete to make the best meal' },
  // Active & Fun
  { category: 'Active & Fun', title: 'Sport Fantastic', emoji: '🏑', description: 'Try a new sport group together' },
  { category: 'Active & Fun', title: 'The Eden Project' },
  { category: 'Active & Fun', title: 'Trampoline Park', emoji: '🦘' },
  { category: 'Active & Fun', title: 'Real Go Karting', emoji: '🏎️' },
  { category: 'Active & Fun', title: 'Arcade', emoji: '🎟️', description: 'Old school ticket competition' },
  { category: 'Active & Fun', title: 'Paintball' },
  { category: 'Active & Fun', title: 'Laser Tag', emoji: '🔫' },
  { category: 'Active & Fun', title: 'Random European Country' },
  { category: 'Active & Fun', title: 'Go Ape', emoji: '🦧' },
  { category: 'Active & Fun', title: 'Ninja Warrior' },
  // Silly Ideas
  { category: 'Silly Ideas', title: 'PowerPoint V1', description: 'Most offensive' },
  { category: 'Silly Ideas', title: 'PowerPoint V2', description: 'Funny presentation about our lives' },
  { category: 'Silly Ideas', title: 'Fancy Dress', emoji: '🧓', description: 'Dress up as old people' },
  { category: 'Silly Ideas', title: 'Write a Book', description: 'Alternate sentences', completed: true },
  { category: 'Silly Ideas', title: 'Conspiracy', description: 'Find one you believe and convince the other' },
  { category: 'Silly Ideas', title: 'Who Are You?', description: 'Pretend we never met in public' },
  { category: 'Silly Ideas', title: 'Day of Sins', description: 'Complete the most sins in a day' },
  { category: 'Silly Ideas', title: 'PowerPoint V3', description: 'Zombie apocalypse plan' },
  { category: 'Silly Ideas', title: 'Sex Club' },
  { category: 'Silly Ideas', title: 'Post Mortem', description: 'Write a bibliography about each other' },
  { category: 'Silly Ideas', title: 'Stand Up', description: 'Write the best routine in 1-2 hours' },
  { category: 'Silly Ideas', title: 'Junky Hustling', description: 'Make £100 net profit first' },
  { category: 'Silly Ideas', title: 'Lightsaber Combat Academy' },
  // Other
  { category: 'Other', title: 'Ice Skating', emoji: '⛸️' },
  { category: 'Other', title: 'Jury Experience' },
];

export default function DateIdeas() {
  const [categories, setCategories] = useState<LocalCategory[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [newIdeaTitle, setNewIdeaTitle] = useState('');
  const [newIdeaDescription, setNewIdeaDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<'daniel' | 'huaiyao' | null>(null);

  // Fetch data from Supabase
  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    try {
      // Fetch categories
      const { data: catData, error: catError } = await supabase
        .from('date_categories')
        .select('*')
        .order('sort_order', { ascending: true });

      if (catError) throw catError;

      // Fetch all ideas
      const { data: ideasData, error: ideasError } = await supabase
        .from('date_ideas')
        .select('*')
        .order('created_at', { ascending: true });

      if (ideasError) throw ideasError;

      // If no categories exist, seed the database
      if (!catData || catData.length === 0) {
        await seedDatabase();
        return fetchData();
      }

      // Group ideas by category
      const groupedCategories: LocalCategory[] = (catData as Category[]).map((cat) => ({
        id: cat.id,
        name: cat.name,
        emoji: cat.emoji,
        ideas: (ideasData as DateIdea[]).filter((idea) => idea.category_id === cat.id),
      }));

      setCategories(groupedCategories);
    } catch (error) {
      console.error('Error fetching data:', error);
    }

    setIsLoading(false);
  }, []);

  // Seed the database with default data
  const seedDatabase = async () => {
    try {
      // Insert categories
      const { data: newCats, error: catError } = await supabase
        .from('date_categories')
        .insert(defaultCategories)
        .select();

      if (catError) throw catError;

      // Create a map of category names to IDs
      const catMap = new Map((newCats as Category[]).map((c) => [c.name, c.id]));

      // Insert ideas
      const ideasToInsert = defaultIdeas.map((idea) => ({
        category_id: catMap.get(idea.category),
        title: idea.title,
        description: idea.description || null,
        emoji: idea.emoji || null,
        is_completed: idea.completed || false,
      }));

      const { error: ideasError } = await supabase
        .from('date_ideas')
        .insert(ideasToInsert);

      if (ideasError) throw ideasError;
    } catch (error) {
      console.error('Error seeding database:', error);
    }
  };

  // Load data and set up realtime subscription
  useEffect(() => {
    // Check for saved user preference
    const savedUser = localStorage.getItem('date-ideas-user') as 'daniel' | 'huaiyao' | null;
    setCurrentUser(savedUser);

    fetchData();

    if (!isSupabaseConfigured) return;

    // Subscribe to realtime changes
    const channel = supabase
      .channel('date-ideas-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'date_ideas' },
        () => {
          fetchData();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'date_categories' },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchData]);

  // Send notification
  const sendNotification = async (action: 'added' | 'removed' | 'completed' | 'uncompleted', title: string) => {
    if (!currentUser) return;

    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, title, user: currentUser }),
      });
    } catch (error) {
      console.error('Notification error:', error);
    }
  };

  // Toggle completed status
  const toggleCompleted = async (idea: DateIdea) => {
    const newStatus = !idea.is_completed;

    const { error } = await supabase
      .from('date_ideas')
      .update({ is_completed: newStatus, updated_at: new Date().toISOString() })
      .eq('id', idea.id);

    if (error) {
      console.error('Error updating idea:', error);
      return;
    }

    sendNotification(newStatus ? 'completed' : 'uncompleted', idea.title);
    fetchData();
  };

  // Add a new idea
  const addIdea = async (categoryId: string) => {
    if (!newIdeaTitle.trim()) return;

    const { error } = await supabase.from('date_ideas').insert({
      category_id: categoryId,
      title: newIdeaTitle.trim(),
      description: newIdeaDescription.trim() || null,
      is_completed: false,
    });

    if (error) {
      console.error('Error adding idea:', error);
      return;
    }

    sendNotification('added', newIdeaTitle.trim());
    setNewIdeaTitle('');
    setNewIdeaDescription('');
    setAddingToCategory(null);
    fetchData();
  };

  // Remove an idea
  const removeIdea = async (idea: DateIdea) => {
    const { error } = await supabase
      .from('date_ideas')
      .delete()
      .eq('id', idea.id);

    if (error) {
      console.error('Error removing idea:', error);
      return;
    }

    sendNotification('removed', idea.title);
    fetchData();
  };

  // Select user
  const selectUser = (user: 'daniel' | 'huaiyao') => {
    setCurrentUser(user);
    localStorage.setItem('date-ideas-user', user);
  };

  const totalIdeas = categories.reduce((sum, cat) => sum + cat.ideas.length, 0);
  const completedCount = categories.reduce(
    (sum, cat) => sum + cat.ideas.filter((i) => i.is_completed).length,
    0
  );

  // User selection screen
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 flex items-center justify-center p-4">
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
            ✨
          </motion.div>
          <h1 className="text-3xl font-serif font-bold text-gray-800 mb-4">
            Who are you?
          </h1>
          <p className="text-gray-500 mb-8">
            So we know who to notify when you make changes
          </p>
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-8 h-8 border-4 border-purple-200 border-t-purple-500 rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-100/30 rounded-full blur-3xl"
          animate={{ scale: [1, 1.1, 1], x: [0, 20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-100/30 rounded-full blur-3xl"
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
          <a
            href="/"
            className="inline-block mb-4 px-4 py-2 -mx-4 text-gray-400 hover:text-gray-600 active:text-gray-800 transition-colors touch-manipulation"
          >
            ← Home
          </a>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-800 mb-2">
            Date Ideas
          </h1>
          <p className="text-gray-500">
            {completedCount} of {totalIdeas} completed
          </p>

          {/* Progress bar */}
          <div className="mt-4 h-2 bg-gray-200 rounded-full overflow-hidden max-w-xs mx-auto">
            <motion.div
              className="h-full bg-gradient-to-r from-purple-500 to-amber-500"
              initial={{ width: 0 }}
              animate={{ width: `${totalIdeas > 0 ? (completedCount / totalIdeas) * 100 : 0}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </motion.div>

        {/* Search bar */}
        <div className="mb-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search ideas..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white/70 backdrop-blur border border-gray-200 rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-transparent
                         text-gray-800 placeholder-gray-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Toggle completed visibility */}
        <div className="flex justify-center mb-6">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            {showCompleted ? 'Hide' : 'Show'} completed
          </button>
        </div>

        {/* Categories */}
        <div className="space-y-4">
          {categories.map((category, catIndex) => {
            const categoryCompleted = category.ideas.filter((i) => i.is_completed).length;
            const isSearching = searchQuery.trim().length > 0;
            const isExpanded = isSearching || expandedCategory === category.name;

            // Filter by search query
            const searchFiltered = isSearching
              ? category.ideas.filter((i) =>
                  i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  i.description?.toLowerCase().includes(searchQuery.toLowerCase())
                )
              : category.ideas;

            // Then filter by completed visibility
            const visibleIdeas = showCompleted
              ? searchFiltered
              : searchFiltered.filter((i) => !i.is_completed);

            // Hide category if searching and no matches
            if (isSearching && searchFiltered.length === 0) {
              return null;
            }

            return (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: catIndex * 0.05 }}
                className="bg-white/70 backdrop-blur rounded-xl shadow-sm overflow-hidden"
              >
                {/* Category header */}
                <button
                  onClick={() => setExpandedCategory(isExpanded ? null : category.name)}
                  className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50/50 active:bg-gray-100/50 transition-colors touch-manipulation"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl sm:text-2xl">{category.emoji}</span>
                    <span className="font-medium text-gray-800 text-base sm:text-base">{category.name}</span>
                    <span className="text-sm text-gray-400">
                      {categoryCompleted}/{category.ideas.length}
                    </span>
                  </div>
                  <motion.span
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    className="text-gray-400"
                  >
                    ▼
                  </motion.span>
                </button>

                {/* Ideas list */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-3 space-y-1">
                        {visibleIdeas.map((idea) => {
                          const isCompleted = idea.is_completed;
                          return (
                            <motion.div
                              key={idea.id}
                              layout
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className={`
                                group flex items-start gap-3 p-3 rounded-lg
                                hover:bg-gray-100/50 active:bg-gray-100 transition-colors touch-manipulation
                                ${isCompleted ? 'opacity-60' : ''}
                              `}
                            >
                              <div
                                className={`
                                  mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0
                                  transition-colors cursor-pointer
                                  ${isCompleted
                                    ? 'bg-green-500 border-green-500 text-white'
                                    : 'border-gray-300'
                                  }
                                `}
                                onClick={() => toggleCompleted(idea)}
                              >
                                {isCompleted && (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              <div
                                className="flex-1 min-w-0 cursor-pointer"
                                onClick={() => toggleCompleted(idea)}
                              >
                                <div className={`font-medium text-base ${isCompleted ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                                  {idea.emoji && <span className="mr-1">{idea.emoji}</span>}
                                  {idea.title}
                                </div>
                                {idea.description && (
                                  <div className="text-sm text-gray-500 mt-0.5">{idea.description}</div>
                                )}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeIdea(idea);
                                }}
                                className="opacity-0 group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100
                                           p-2 -mr-1 text-gray-400 hover:text-red-500 transition-all touch-manipulation
                                           active:opacity-100"
                                title="Remove idea"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </motion.div>
                          );
                        })}
                        {visibleIdeas.length === 0 && (
                          <p className="text-sm text-gray-400 text-center py-2">
                            All done in this category! 🎉
                          </p>
                        )}

                        {/* Add new idea section */}
                        {addingToCategory === category.id ? (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="pt-2 border-t border-gray-100 mt-2"
                          >
                            <input
                              type="text"
                              placeholder="Idea title"
                              value={newIdeaTitle}
                              onChange={(e) => setNewIdeaTitle(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                              autoFocus
                            />
                            <input
                              type="text"
                              placeholder="Description (optional)"
                              value={newIdeaDescription}
                              onChange={(e) => setNewIdeaDescription(e.target.value)}
                              className="w-full px-3 py-2 mt-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => addIdea(category.id)}
                                disabled={!newIdeaTitle.trim()}
                                className="flex-1 px-3 py-2 text-sm bg-purple-500 text-white rounded-lg
                                           hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                Add
                              </button>
                              <button
                                onClick={() => {
                                  setAddingToCategory(null);
                                  setNewIdeaTitle('');
                                  setNewIdeaDescription('');
                                }}
                                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </motion.div>
                        ) : (
                          <button
                            onClick={() => setAddingToCategory(category.id)}
                            className="w-full mt-2 py-2 text-sm text-gray-400 hover:text-purple-500
                                       border border-dashed border-gray-200 hover:border-purple-300
                                       rounded-lg transition-colors"
                          >
                            + Add idea
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {/* No results message */}
          {searchQuery.trim() && categories.every((cat) =>
            !cat.ideas.some((i) =>
              i.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              i.description?.toLowerCase().includes(searchQuery.toLowerCase())
            )
          ) && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-gray-400 py-8"
            >
              No ideas found for "{searchQuery}"
            </motion.p>
          )}
        </div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 text-sm"
        >
          <p>Tap to mark as done · Hover to remove</p>
          <p className="mt-2">
            Logged in as{' '}
            <span className={currentUser === 'daniel' ? 'text-blue-500' : 'text-rose-500'}>
              {currentUser === 'daniel' ? 'Daniel' : 'Huaiyao'}
            </span>
            {' · '}
            <button
              onClick={() => {
                localStorage.removeItem('date-ideas-user');
                setCurrentUser(null);
              }}
              className="underline hover:text-gray-600"
            >
              Switch
            </button>
          </p>
        </motion.footer>
      </main>
    </div>
  );
}
