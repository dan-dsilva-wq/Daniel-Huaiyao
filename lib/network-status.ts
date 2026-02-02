'use client';

import { useState, useEffect, useCallback } from 'react';

interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  effectiveType: string | null;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    wasOffline: false,
    effectiveType: null,
  });

  const updateNetworkStatus = useCallback(() => {
    const isOnline = navigator.onLine;
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;

    setStatus((prev) => ({
      isOnline,
      wasOffline: prev.wasOffline || (!isOnline && prev.isOnline),
      effectiveType: connection?.effectiveType || null,
    }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Initial status
    updateNetworkStatus();

    // Listen for online/offline events
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Listen for connection changes if available
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (connection) {
      connection.addEventListener('change', updateNetworkStatus);
    }

    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
      if (connection) {
        connection.removeEventListener('change', updateNetworkStatus);
      }
    };
  }, [updateNetworkStatus]);

  return status;
}

// Reset the wasOffline flag (call after syncing)
export function useResetOfflineFlag(
  setStatus: React.Dispatch<React.SetStateAction<NetworkStatus>>
) {
  return useCallback(() => {
    setStatus((prev) => ({ ...prev, wasOffline: false }));
  }, [setStatus]);
}
