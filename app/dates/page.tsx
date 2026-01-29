'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface DateIdea {
  id: string;
  title: string;
  description?: string;
  emoji?: string;
}

interface Category {
  name: string;
  emoji: string;
  ideas: DateIdea[];
}

const initialCategories: Category[] = [
  {
    name: 'Learn Things',
    emoji: '📚',
    ideas: [
      { id: 'dnd', title: 'DND', description: 'Join a single season' },
      { id: 'dancing', title: 'Dancing', emoji: '🕺', description: 'Go to a dance lesson together' },
      { id: 'archery', title: 'Archery', emoji: '🏹' },
      { id: 'website-battle', title: 'Website Battle', description: 'First to £10 profit' },
      { id: 'kalimba', title: 'Kalimba' },
      { id: 'navigation', title: 'Navigation', description: 'Map + compass' },
      { id: 'memory-palaces', title: 'Memory Palaces' },
      { id: 'calligraphy', title: 'Calligraphy' },
      { id: 'poker', title: 'Poker' },
      { id: 'trust-exercises', title: 'Trust-building Exercises' },
      { id: 'fire-making', title: 'Fire-making' },
      { id: 'conflict-resolution', title: 'Conflict Resolution Skills' },
      { id: 'magic-trick', title: 'Magic Trick' },
      { id: 'chess', title: 'Chess Properly', description: 'Openings, not vibes' },
      { id: 'foraging', title: 'Foraging' },
      { id: 'first-aid', title: 'First Aid' },
      { id: 'negotiation', title: 'Negotiation Skills' },
      { id: 'sign-language', title: 'Sign Language Basics' },
      { id: 'morse-code', title: 'Morse Code', description: 'Ridiculous but fun' },
      { id: 'memory-techniques', title: 'Memory Techniques' },
      { id: 'car-maintenance', title: 'Car Maintenance Basics' },
      { id: 'wilderness-survival', title: 'Wilderness Survival Basics' },
      { id: 'interrogation', title: 'Interrogation Skills' },
      { id: 'wild-hunting', title: 'Wild Hunting' },
      { id: 'rubix-cube', title: 'Solve Rubix Cube' },
    ],
  },
  {
    name: 'Feeling Adventurous',
    emoji: '🏔️',
    ideas: [
      { id: 'abseiling', title: 'Abseiling' },
      { id: 'aqueduct', title: 'Aqueduct' },
      { id: 'coastal-foraging', title: 'Coastal Foraging' },
      { id: 'hilbre-island', title: 'Hilbre Island', description: 'Chicken edition' },
      { id: 'waterfall-swim', title: 'Waterfall Pool Swim' },
      { id: 'sea-swim', title: 'Swim in the Sea', emoji: '🦈' },
      { id: 'beach-bbq', title: 'Beach Barbeque' },
      { id: 'wild-camping', title: 'Wild Camping' },
      { id: 'mountain-hike', title: 'Hike up a Mountain' },
      { id: 'treasure-hunt', title: 'Treasure Hunting', emoji: '🧭' },
      { id: 'sea-rock-walking', title: 'Sea Rock Walking' },
      { id: 'adventure-hardmode', title: 'Adventure Hardmode', description: 'No GPS, no phones' },
      { id: 'aurora', title: 'Find the Aurora' },
    ],
  },
  {
    name: 'Animals',
    emoji: '🦁',
    ideas: [
      { id: 'aquarium', title: 'Aquarium', emoji: '🐠' },
      { id: 'animal-shelter', title: 'Animal Shelter', emoji: '🐶' },
      { id: 'chester-zoo', title: 'Chester Zoo', emoji: '🦁' },
      { id: 'safari', title: 'Safari', emoji: '🐘' },
    ],
  },
  {
    name: 'Something Chilled',
    emoji: '😌',
    ideas: [
      { id: 'escape-room', title: 'Escape Room', description: '✓ Done!' },
      { id: 'startup', title: 'Plan a Start-up Together', emoji: '✨' },
      { id: 'fort', title: 'Build a Fort and Sleep in it', emoji: '🛌' },
      { id: 'board-game-cafe', title: 'Board Game Cafe', description: 'Spiel des Jahres games' },
      { id: 'films', title: "Films Daniel Hasn't Seen" },
      { id: 'dish-off', title: 'Dish Off', description: 'Compete to make the best meal' },
    ],
  },
  {
    name: 'Active & Fun',
    emoji: '🎯',
    ideas: [
      { id: 'sport', title: 'Sport Fantastic', emoji: '🏑', description: 'Try a new sport group together' },
      { id: 'eden-project', title: 'The Eden Project' },
      { id: 'trampoline', title: 'Trampoline Park', emoji: '🦘' },
      { id: 'go-karting', title: 'Real Go Karting', emoji: '🏎️' },
      { id: 'arcade', title: 'Arcade', emoji: '🎟️', description: 'Old school ticket competition' },
      { id: 'paintball', title: 'Paintball' },
      { id: 'laser-tag', title: 'Laser Tag', emoji: '🔫' },
      { id: 'random-country', title: 'Random European Country' },
      { id: 'go-ape', title: 'Go Ape', emoji: '🦧' },
      { id: 'ninja-warrior', title: 'Ninja Warrior' },
    ],
  },
  {
    name: 'Silly Ideas',
    emoji: '🤪',
    ideas: [
      { id: 'ppt-offensive', title: 'PowerPoint V1', description: 'Most offensive' },
      { id: 'ppt-lives', title: 'PowerPoint V2', description: 'Funny presentation about our lives' },
      { id: 'fancy-dress', title: 'Fancy Dress', emoji: '🧓', description: 'Dress up as old people' },
      { id: 'write-book', title: 'Write a Book', description: '✓ Done! Alternate sentences' },
      { id: 'conspiracy', title: 'Conspiracy', description: 'Find one you believe and convince the other' },
      { id: 'who-are-you', title: 'Who Are You?', description: 'Pretend we never met in public' },
      { id: 'day-of-sins', title: 'Day of Sins', description: 'Complete the most sins in a day' },
      { id: 'ppt-zombie', title: 'PowerPoint V3', description: 'Zombie apocalypse plan' },
      { id: 'sex-club', title: 'Sex Club' },
      { id: 'post-mortem', title: 'Post Mortem', description: 'Write a bibliography about each other' },
      { id: 'stand-up', title: 'Stand Up', description: 'Write the best routine in 1-2 hours' },
      { id: 'junky-hustling', title: 'Junky Hustling', description: 'Make £100 net profit first' },
      { id: 'lightsaber', title: 'Lightsaber Combat Academy' },
    ],
  },
  {
    name: 'Other',
    emoji: '✨',
    ideas: [
      { id: 'ice-skating', title: 'Ice Skating', emoji: '⛸️' },
      { id: 'jury-experience', title: 'Jury Experience' },
    ],
  },
];

export default function DateIdeas() {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [newIdeaTitle, setNewIdeaTitle] = useState('');
  const [newIdeaDescription, setNewIdeaDescription] = useState('');

  // Load categories and completed from localStorage
  useEffect(() => {
    const savedCategories = localStorage.getItem('date-ideas-categories');
    if (savedCategories) {
      setCategories(JSON.parse(savedCategories));
    }
    const saved = localStorage.getItem('date-ideas-completed');
    if (saved) {
      setCompletedIds(new Set(JSON.parse(saved)));
    }
  }, []);

  // Save completed to localStorage
  const toggleCompleted = (id: string) => {
    setCompletedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      localStorage.setItem('date-ideas-completed', JSON.stringify([...newSet]));
      return newSet;
    });
  };

  // Add a new idea to a category
  const addIdea = (categoryName: string) => {
    if (!newIdeaTitle.trim()) return;

    const newIdea: DateIdea = {
      id: `custom-${Date.now()}`,
      title: newIdeaTitle.trim(),
      description: newIdeaDescription.trim() || undefined,
    };

    setCategories((prev) => {
      const updated = prev.map((cat) =>
        cat.name === categoryName
          ? { ...cat, ideas: [...cat.ideas, newIdea] }
          : cat
      );
      localStorage.setItem('date-ideas-categories', JSON.stringify(updated));
      return updated;
    });

    setNewIdeaTitle('');
    setNewIdeaDescription('');
    setAddingToCategory(null);
  };

  // Remove an idea from a category
  const removeIdea = (categoryName: string, ideaId: string) => {
    setCategories((prev) => {
      const updated = prev.map((cat) =>
        cat.name === categoryName
          ? { ...cat, ideas: cat.ideas.filter((i) => i.id !== ideaId) }
          : cat
      );
      localStorage.setItem('date-ideas-categories', JSON.stringify(updated));
      return updated;
    });

    // Also remove from completed if it was completed
    setCompletedIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(ideaId);
      localStorage.setItem('date-ideas-completed', JSON.stringify([...newSet]));
      return newSet;
    });
  };

  const totalIdeas = categories.reduce((sum, cat) => sum + cat.ideas.length, 0);
  const completedCount = completedIds.size;

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
            ← Back
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
              animate={{ width: `${(completedCount / totalIdeas) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </motion.div>

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
            const categoryCompleted = category.ideas.filter((i) => completedIds.has(i.id)).length;
            const isExpanded = expandedCategory === category.name;
            const visibleIdeas = showCompleted
              ? category.ideas
              : category.ideas.filter((i) => !completedIds.has(i.id));

            return (
              <motion.div
                key={category.name}
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
                          const isCompleted = completedIds.has(idea.id);
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
                                onClick={() => toggleCompleted(idea.id)}
                              >
                                {isCompleted && (
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              <div
                                className="flex-1 min-w-0 cursor-pointer"
                                onClick={() => toggleCompleted(idea.id)}
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
                                  removeIdea(category.name, idea.id);
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
                        {addingToCategory === category.name ? (
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
                                onClick={() => addIdea(category.name)}
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
                            onClick={() => setAddingToCategory(category.name)}
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
        </div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-12 text-gray-400 text-sm"
        >
          <p>Tap to mark as done · Hover to remove</p>
        </motion.footer>
      </main>
    </div>
  );
}
