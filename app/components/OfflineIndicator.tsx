'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNetworkStatus } from '@/lib/network-status';
import { syncPendingActions, getPendingActionCount } from '@/lib/sync-manager';

export function OfflineIndicator() {
  const { isOnline, wasOffline } = useNetworkStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Check pending actions count
  useEffect(() => {
    const checkPending = async () => {
      const count = await getPendingActionCount();
      setPendingCount(count);
    };

    checkPending();
    const interval = setInterval(checkPending, 5000);
    return () => clearInterval(interval);
  }, []);

  // Show banner when offline or when we have pending actions
  useEffect(() => {
    setShowBanner(!isOnline || pendingCount > 0);
  }, [isOnline, pendingCount]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && wasOffline && pendingCount > 0) {
      handleSync();
    }
  }, [isOnline, wasOffline, pendingCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSync = async () => {
    if (isSyncing || !isOnline) return;

    setIsSyncing(true);
    setSyncMessage('Syncing...');

    try {
      const result = await syncPendingActions();

      if (result.success && result.synced > 0) {
        setSyncMessage(`Synced ${result.synced} action${result.synced > 1 ? 's' : ''}`);
      } else if (result.failed > 0) {
        setSyncMessage(`${result.failed} action${result.failed > 1 ? 's' : ''} failed to sync`);
      } else if (result.synced === 0) {
        setSyncMessage('All synced!');
      }

      // Refresh pending count
      const count = await getPendingActionCount();
      setPendingCount(count);

      // Clear message after a delay
      setTimeout(() => setSyncMessage(null), 3000);
    } catch (error) {
      console.error('Sync failed:', error);
      setSyncMessage('Sync failed');
      setTimeout(() => setSyncMessage(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          className={`fixed top-0 left-0 right-0 z-[100] ${
            isOnline
              ? 'bg-amber-500'
              : 'bg-gray-800'
          }`}
        >
          <div className="max-w-4xl mx-auto px-4 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white text-sm">
                {!isOnline ? (
                  <>
                    <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                    <span>You&apos;re offline</span>
                    {pendingCount > 0 && (
                      <span className="text-white/70">
                        ({pendingCount} pending)
                      </span>
                    )}
                  </>
                ) : pendingCount > 0 ? (
                  <>
                    <span className="w-2 h-2 bg-white rounded-full" />
                    <span>
                      {syncMessage || `${pendingCount} action${pendingCount > 1 ? 's' : ''} to sync`}
                    </span>
                  </>
                ) : syncMessage ? (
                  <>
                    <span className="w-2 h-2 bg-green-300 rounded-full" />
                    <span>{syncMessage}</span>
                  </>
                ) : null}
              </div>

              {isOnline && pendingCount > 0 && !isSyncing && (
                <button
                  onClick={handleSync}
                  className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-white text-sm transition-colors"
                >
                  Sync Now
                </button>
              )}

              {isSyncing && (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                />
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
