'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface AutoRefreshProps {
  intervalMs?: number;
}

export function AutoRefresh({ intervalMs = 5000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const handle = window.setInterval(() => {
      router.refresh();
    }, Math.max(1000, intervalMs));
    return () => {
      window.clearInterval(handle);
    };
  }, [intervalMs, router]);

  return null;
}

