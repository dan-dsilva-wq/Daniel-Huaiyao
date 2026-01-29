'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center max-w-md"
      >
        <motion.div
          animate={{ rotate: [0, -10, 10, -10, 0] }}
          transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          className="text-8xl mb-6"
        >
          📖
        </motion.div>

        <h1 className="text-3xl font-serif text-book-cover mb-4">
          Page Not Found
        </h1>

        <p className="text-foreground/60 mb-8">
          This page seems to have wandered off from our story book.
          Let&apos;s get you back to where you belong.
        </p>

        <Link href="/">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-8 py-4 rounded-xl bg-book-cover text-white font-medium shadow-lg hover:bg-book-spine transition-colors"
          >
            Return to the Book
          </motion.button>
        </Link>
      </motion.div>
    </div>
  );
}
