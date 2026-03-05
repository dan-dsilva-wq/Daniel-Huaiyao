'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// VAPID public key - must match the one in environment variables
const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
const KNOWN_USERS = new Set(['daniel', 'huaiyao']);

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function normalizeUser(rawUser: string | null): string | null {
  if (!rawUser) return null;
  const normalized = rawUser.toLowerCase();
  return KNOWN_USERS.has(normalized) ? normalized : null;
}

function isStandaloneIOS(): boolean {
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isiOS = /iphone|ipad|ipod/.test(userAgent);
  if (!isiOS) return false;
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as { standalone?: boolean }).standalone === true;
}

function getSubscribeErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Notification permission denied by browser';
    }
    if (error.name === 'InvalidAccessError') {
      return 'Push setup invalid (VAPID key issue)';
    }
    if (error.name === 'InvalidStateError') {
      return 'Push service state is stale. Reopen the app and try again';
    }
    return `Browser push error: ${error.name}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown notification error';
}

export default function NotificationPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveSubscription = useCallback(async (subscription: PushSubscription, userName: string): Promise<void> => {
    const response = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        userName,
      }),
    });

    if (response.ok) return;

    let detail = 'Failed to save subscription';
    try {
      const body = await response.json() as { error?: string; details?: string };
      detail = body.details || body.error || detail;
    } catch {
      // Ignore JSON parse issues and use fallback message
    }

    throw new Error(detail);
  }, []);

  const checkSubscription = useCallback(async (user: string | null) => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        setIsSubscribed(true);
        if (user) {
          try {
            await saveSubscription(subscription, user);
          } catch (syncError) {
            console.error('Error syncing existing subscription:', syncError);
          }
        }
      } else {
        // Check if we've already asked (don't spam)
        const hasAsked = localStorage.getItem('notification_prompt_shown');
        const permission = Notification.permission;

        const shouldPrompt =
          permission === 'granted' ||
          (!hasAsked && permission === 'default');

        if (shouldPrompt) {
          // Show prompt after a short delay
          setTimeout(() => setShowPrompt(true), 2000);
        }
      }
    } catch (err) {
      console.error('Error checking subscription:', err);
    }
  }, [saveSubscription]);

  useEffect(() => {
    // Check if push notifications are supported
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }

    const user = normalizeUser(localStorage.getItem('currentUser'));
    setCurrentUser(user);

    // Check current subscription status
    void checkSubscription(user);
  }, [checkSubscription]);

  const subscribe = async () => {
    const selectedUser = normalizeUser(currentUser || localStorage.getItem('currentUser'));
    if (!selectedUser) {
      setError('Please select who you are first');
      return;
    }
    setCurrentUser(selectedUser);

    setIsLoading(true);
    setError(null);

    try {
      if (!VAPID_PUBLIC_KEY) {
        throw new Error('Notifications are not configured (missing VAPID key)');
      }

      if (Notification.permission === 'denied') {
        setError('Notifications are blocked in browser settings');
        setIsLoading(false);
        return;
      }

      if (!isStandaloneIOS() && /iphone|ipad|ipod/i.test(window.navigator.userAgent)) {
        setError('On iPhone/iPad, open the installed app from Home Screen to enable notifications');
        setIsLoading(false);
        return;
      }

      // Request notification permission
      const permission =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();

      if (permission !== 'granted') {
        setError('Notification permission denied');
        setIsLoading(false);
        localStorage.setItem('notification_prompt_shown', 'true');
        setShowPrompt(false);
        return;
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Reuse existing subscription if one survives reinstall/browser state changes.
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        });
      }

      await saveSubscription(subscription, selectedUser);

      setIsSubscribed(true);
      setShowPrompt(false);
      localStorage.setItem('notification_prompt_shown', 'true');
    } catch (err) {
      console.error('Subscription error:', err);
      setError(getSubscribeErrorMessage(err));
    }

    setIsLoading(false);
  };

  const dismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('notification_prompt_shown', 'true');
  };

  // Don't render anything if already subscribed or not supported
  if (isSubscribed || typeof window === 'undefined') {
    return null;
  }

  return (
    <AnimatePresence>
      {showPrompt && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto"
        >
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3">
              <div className="text-3xl">🔔</div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800 dark:text-white mb-1">
                  Enable notifications?
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  Get notified when {currentUser === 'daniel' ? 'Huaiyao' : 'Daniel'} adds something new
                </p>

                {error && (
                  <p className="text-sm text-red-500 mb-3">{error}</p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={subscribe}
                    disabled={isLoading}
                    className="flex-1 py-2 px-4 bg-indigo-500 text-white rounded-lg font-medium hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                  >
                    {isLoading ? 'Enabling...' : 'Enable'}
                  </button>
                  <button
                    onClick={dismiss}
                    disabled={isLoading}
                    className="py-2 px-4 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
