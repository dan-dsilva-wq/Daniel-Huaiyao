'use client';

import { motion } from 'framer-motion';
import { DateIdea } from '@/lib/supabase';

interface IdeaItemProps {
  idea: DateIdea;
  onToggle: (idea: DateIdea) => void;
  onEdit: (idea: DateIdea) => void;
  onRemove: (idea: DateIdea) => void;
}

export default function IdeaItem({ idea, onToggle, onEdit, onRemove }: IdeaItemProps) {
  const isCompleted = idea.is_completed;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className={`
        group flex items-start gap-3 p-3 rounded-lg
        hover:bg-gray-100/50 dark:hover:bg-gray-700/50 active:bg-gray-100 dark:active:bg-gray-700 transition-colors touch-manipulation
        ${isCompleted ? 'opacity-60' : ''}
      `}
    >
      {/* Checkbox */}
      <div
        className={`
          mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0
          transition-colors cursor-pointer
          ${isCompleted
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 dark:border-gray-600'
          }
        `}
        onClick={() => onToggle(idea)}
      >
        {isCompleted && (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>

      {/* Idea text - tap to edit */}
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onEdit(idea)}
      >
        <div className={`font-medium text-base ${isCompleted ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100'}`}>
          {idea.emoji && <span className="mr-1">{idea.emoji}</span>}
          {idea.title}
        </div>
        {idea.description && (
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{idea.description}</div>
        )}
      </div>

      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(idea);
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
}
