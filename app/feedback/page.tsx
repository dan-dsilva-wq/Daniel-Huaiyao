'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface FeedbackRequest {
  id: string;
  from_user: string;
  summary: string;
  is_read: boolean;
  created_at: string;
}

export default function FeedbackPage() {
  const [feedbackItems, setFeedbackItems] = useState<FeedbackRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [currentUser, setCurrentUser] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('currentUser');
    }
    return null;
  });

  const fetchFeedback = async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('feedback_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setFeedbackItems(data);
    }
    setLoading(false);
  };

  const markAsRead = async (ids: string[]) => {
    await supabase
      .from('feedback_requests')
      .update({ is_read: true })
      .in('id', ids);

    setFeedbackItems(prev =>
      prev.map(f => ids.includes(f.id) ? { ...f, is_read: true } : f)
    );
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFeedback();
  }, []);

  // Mark unread items as read when Daniel views the page
  useEffect(() => {
    if (currentUser === 'daniel' && feedbackItems.length > 0) {
      const unreadIds = feedbackItems.filter(f => !f.is_read).map(f => f.id);
      if (unreadIds.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        markAsRead(unreadIds);
      }
    }
  }, [currentUser, feedbackItems]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-stone-50 to-zinc-100 dark:from-gray-900 dark:via-slate-900 dark:to-zinc-900">
      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/"
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              Feedback from Huaiyao
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Ideas and requests from the chat
            </p>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-rose-300 border-t-rose-500 rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && feedbackItems.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">💬</div>
            <p className="text-gray-500 dark:text-gray-400">No feedback yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              When Huaiyao sends feedback through the chat, it&apos;ll show up here
            </p>
          </div>
        )}

        {/* Feedback list */}
        <div className="space-y-4">
          <AnimatePresence>
            {feedbackItems.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`relative p-5 rounded-2xl shadow-sm transition-colors ${
                  item.is_read
                    ? 'bg-white dark:bg-gray-800'
                    : 'bg-rose-50 dark:bg-rose-900/20 ring-1 ring-rose-200 dark:ring-rose-800'
                }`}
              >
                {/* Unread indicator */}
                {!item.is_read && (
                  <div className="absolute top-4 right-4">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
                    </span>
                  </div>
                )}

                {/* Timestamp */}
                <div className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                  {formatDate(item.created_at)}
                </div>

                {/* Summary content */}
                <div className="text-gray-800 dark:text-gray-200 text-sm whitespace-pre-wrap leading-relaxed">
                  {item.summary}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
