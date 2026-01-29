'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="text-center max-w-lg"
      >
        {/* Book illustration */}
        <motion.div
          initial={{ scale: 0.8, rotateY: -20 }}
          animate={{ scale: 1, rotateY: 0 }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="mb-8"
        >
          <div className="relative inline-block">
            <div className="book-cover rounded-xl p-12 shadow-book">
              <div className="text-white text-center">
                <motion.div
                  animate={{ y: [0, -5, 0] }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                  className="text-6xl mb-4"
                >
                  📖
                </motion.div>
                <h1 className="text-3xl font-serif mb-2">Our Story</h1>
                <p className="text-white/70 text-sm">Daniel & Huaiyao</p>
              </div>
            </div>
            {/* Book spine effect */}
            <div className="absolute left-0 top-0 w-4 h-full book-spine rounded-l-xl" />
          </div>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-2xl font-serif text-book-cover mb-4"
        >
          Welcome to your shared story book
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-foreground/60 mb-8"
        >
          Take turns writing sentences to build your unique story together.
          <br />
          Choose your link below to begin.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="flex flex-col sm:flex-row gap-4 justify-center"
        >
          <Link href="/daniel">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-daniel text-white font-medium shadow-lg hover:bg-daniel-dark transition-colors"
            >
              I&apos;m Daniel
            </motion.button>
          </Link>

          <Link href="/huaiyao">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-full sm:w-auto px-8 py-4 rounded-xl bg-huaiyao text-white font-medium shadow-lg hover:bg-huaiyao-dark transition-colors"
            >
              I&apos;m Huaiyao
            </motion.button>
          </Link>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-8 text-sm text-foreground/40"
        >
          Tip: Bookmark your personal link so you can come back easily!
        </motion.p>
      </motion.div>
    </div>
  );
}
