'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

function getStandaloneMode() {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export default function AppLaunchSplash() {
  const [showSplash, setShowSplash] = useState(getStandaloneMode);

  useEffect(() => {
    if (!showSplash) return;
    const timer = window.setTimeout(() => setShowSplash(false), 950);

    return () => window.clearTimeout(timer);
  }, [showSplash]);

  return (
    <AnimatePresence>
      {showSplash && (
        <motion.div
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-rose-50 via-stone-50 to-amber-50 dark:from-gray-950 dark:via-slate-950 dark:to-zinc-950"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.04 }}
            className="flex flex-col items-center"
          >
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-[28px] bg-white shadow-2xl ring-1 ring-black/5 dark:bg-gray-900 dark:ring-white/10">
              <Image
                src="/icons/apple-touch-icon.png"
                alt="Daniel and Huaiyao"
                width={80}
                height={80}
                className="h-20 w-20 rounded-[22px] object-cover"
              />
            </div>
            <div className="mt-5 text-center">
              <p className="font-serif text-2xl font-semibold text-gray-800 dark:text-gray-100">
                Daniel & Huaiyao
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Opening your little world
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
