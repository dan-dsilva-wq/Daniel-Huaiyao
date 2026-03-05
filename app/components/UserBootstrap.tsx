'use client';

import { useEffect } from 'react';
import { getCurrentUser } from '@/lib/user-session';

export function UserBootstrap() {
  useEffect(() => {
    // Keep cookie/localStorage in sync so user identity survives app reinstalls better.
    getCurrentUser();
  }, []);

  return null;
}
