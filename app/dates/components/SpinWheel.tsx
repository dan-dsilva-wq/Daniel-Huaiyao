'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DateIdea } from '@/lib/supabase';

interface SpinWheelProps {
  open: boolean;
  categories: { id: string; name: string; emoji: string; ideas: DateIdea[] }[];
  onClose: () => void;
}

const WHEEL_COLORS = [
  '#8B5CF6', '#F59E0B', '#EC4899', '#14B8A6',
  '#6366F1', '#F97316', '#06B6D4', '#EF4444',
];

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export default function SpinWheel({ open, categories, onClose }: SpinWheelProps) {
  const [filterCategoryId, setFilterCategoryId] = useState<string | null>(null);
  const [wheelIdeas, setWheelIdeas] = useState<DateIdea[]>([]);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [selectedIdea, setSelectedIdea] = useState<DateIdea | null>(null);
  const [initialized, setInitialized] = useState(false);
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getIncompleteIdeas = useCallback(() => {
    const filtered = filterCategoryId
      ? categories.filter((c) => c.id === filterCategoryId)
      : categories;
    return filtered.flatMap((cat) => cat.ideas.filter((i) => !i.is_completed));
  }, [categories, filterCategoryId]);

  const pickWheelIdeas = useCallback(() => {
    const incomplete = getIncompleteIdeas();
    if (incomplete.length === 0) return [];
    return shuffleArray(incomplete).slice(0, 8);
  }, [getIncompleteIdeas]);

  // Initialize wheel ideas when opened
  if (open && !initialized) {
    const picked = pickWheelIdeas();
    setWheelIdeas(picked);
    setSelectedIdea(null);
    setWheelRotation(0);
    setInitialized(true);
  }
  if (!open && initialized) {
    setInitialized(false);
  }

  const handleFilterChange = (catId: string | null) => {
    setFilterCategoryId(catId);
    const filtered = catId
      ? categories.filter((c) => c.id === catId)
      : categories;
    const incomplete = filtered.flatMap((cat) => cat.ideas.filter((i) => !i.is_completed));
    const picked = shuffleArray(incomplete).slice(0, 8);
    setWheelIdeas(picked);
    setSelectedIdea(null);
    setWheelRotation(0);
  };

  const spinWheel = () => {
    if (isSpinning || wheelIdeas.length === 0) return;
    setIsSpinning(true);
    setSelectedIdea(null);

    const winnerIndex = Math.floor(Math.random() * wheelIdeas.length);
    const segmentAngle = 360 / wheelIdeas.length;
    const segmentCenter = winnerIndex * segmentAngle + segmentAngle / 2;
    const targetAngle = 360 - segmentCenter;
    const fullSpins = 5 + Math.floor(Math.random() * 3);
    const newRotation = wheelRotation + fullSpins * 360 + ((targetAngle - (wheelRotation % 360)) + 360) % 360;

    setWheelRotation(newRotation);

    spinTimeoutRef.current = setTimeout(() => {
      setSelectedIdea(wheelIdeas[winnerIndex]);
      setIsSpinning(false);
    }, 4000);
  };

  const handleClose = () => {
    if (isSpinning) return;
    if (spinTimeoutRef.current) {
      clearTimeout(spinTimeoutRef.current);
      spinTimeoutRef.current = null;
    }
    onClose();
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full flex flex-col items-center gap-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-xl font-serif font-bold text-gray-800 dark:text-gray-100">
          Spin the Wheel!
        </h2>

        {/* Category filter pills */}
        <div className="flex flex-wrap gap-1.5 justify-center">
          <button
            onClick={() => handleFilterChange(null)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filterCategoryId === null
                ? 'bg-purple-500 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleFilterChange(cat.id)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filterCategoryId === cat.id
                  ? 'bg-purple-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
        </div>

        {wheelIdeas.length === 0 ? (
          <div className="text-gray-400 dark:text-gray-500 text-center py-8">
            No incomplete ideas in this category
          </div>
        ) : (
          <>
            {/* Wheel container */}
            <div className="relative w-72 h-72">
              {/* Pointer */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
                <svg width="24" height="20" viewBox="0 0 24 20">
                  <polygon points="12,20 0,0 24,0" fill="#1F2937" className="dark:fill-gray-200" />
                </svg>
              </div>

              {/* SVG Wheel */}
              <motion.svg
                viewBox="0 0 200 200"
                className="w-full h-full"
                animate={{ rotate: wheelRotation }}
                transition={wheelRotation === 0 ? { duration: 0 } : {
                  duration: 4,
                  ease: [0.2, 0.8, 0.3, 1],
                }}
              >
                {wheelIdeas.map((idea, i) => {
                  const count = wheelIdeas.length;
                  const angle = 360 / count;
                  const startAngle = i * angle - 90;
                  const endAngle = startAngle + angle;
                  const startRad = (startAngle * Math.PI) / 180;
                  const endRad = (endAngle * Math.PI) / 180;
                  const x1 = 100 + 95 * Math.cos(startRad);
                  const y1 = 100 + 95 * Math.sin(startRad);
                  const x2 = 100 + 95 * Math.cos(endRad);
                  const y2 = 100 + 95 * Math.sin(endRad);
                  const largeArc = angle > 180 ? 1 : 0;
                  const midAngle = ((startAngle + endAngle) / 2) * Math.PI / 180;
                  const textR = 62;
                  const tx = 100 + textR * Math.cos(midAngle);
                  const ty = 100 + textR * Math.sin(midAngle);
                  const textRotation = (startAngle + endAngle) / 2 + 90;
                  const label = idea.title.length > 12
                    ? idea.title.slice(0, 11) + '\u2026'
                    : idea.title;

                  return (
                    <g key={idea.id}>
                      <path
                        d={`M100,100 L${x1},${y1} A95,95 0 ${largeArc},1 ${x2},${y2} Z`}
                        fill={WHEEL_COLORS[i % WHEEL_COLORS.length]}
                        stroke="white"
                        strokeWidth="1"
                      />
                      <text
                        x={tx}
                        y={ty}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${textRotation}, ${tx}, ${ty})`}
                        fill="white"
                        fontSize={count <= 4 ? "7" : "6"}
                        fontWeight="600"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
                <circle cx="100" cy="100" r="18" fill="white" className="dark:fill-gray-700" stroke="#E5E7EB" strokeWidth="2" />
                <text x="100" y="102" textAnchor="middle" dominantBaseline="middle" fontSize="14">
                  🎲
                </text>
              </motion.svg>
            </div>

            {/* Result card */}
            <AnimatePresence mode="wait">
              {selectedIdea && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="w-full bg-gradient-to-r from-purple-50 to-amber-50 dark:from-purple-900/30 dark:to-amber-900/30 rounded-xl p-4 text-center"
                >
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">You should try...</p>
                  <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                    {selectedIdea.emoji && <span className="mr-1">{selectedIdea.emoji}</span>}
                    {selectedIdea.title}
                  </p>
                  {selectedIdea.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{selectedIdea.description}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* Buttons */}
        <div className="flex gap-3 w-full">
          {!selectedIdea ? (
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={spinWheel}
              disabled={isSpinning || wheelIdeas.length === 0}
              className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-amber-500 text-white font-semibold rounded-xl
                         hover:from-purple-600 hover:to-amber-600 disabled:opacity-60 transition-all"
            >
              {isSpinning ? 'Spinning...' : 'Spin!'}
            </motion.button>
          ) : (
            <>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={spinWheel}
                className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-amber-500 text-white font-semibold rounded-xl
                           hover:from-purple-600 hover:to-amber-600 transition-all"
              >
                Spin Again
              </motion.button>
              <button
                onClick={handleClose}
                className="px-5 py-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-medium transition-colors"
              >
                Close
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
