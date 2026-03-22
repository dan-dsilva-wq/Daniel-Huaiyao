'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ThemeToggle } from '../components/ThemeToggle';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { getCurrentUser, setCurrentUser as persistCurrentUser, type CurrentUser } from '@/lib/user-session';

type SurpriseSummary = {
  id: string;
  monthKey: string;
  player: CurrentUser;
  status: 'pending' | 'done' | 'skipped';
  generatedAt: string;
  notifyAt: string | null;
  notifiedAt: string | null;
  completedAt: string | null;
  ideaId: string;
  ideaText: string;
  category: string;
};

type SurprisePageData = {
  timezone: string;
  current: SurpriseSummary | null;
  history: SurpriseSummary[];
  nextAssignment: {
    monthKey: string;
    date: string;
    label: string;
  };
};

function formatMonthKey(monthKey: string) {
  const [yearPart, monthPart] = monthKey.split('-');
  const year = Number.parseInt(yearPart, 10);
  const month = Number.parseInt(monthPart, 10);
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}

function statusClasses(status: SurpriseSummary['status']) {
  if (status === 'done') {
    return 'bg-emerald-500/12 text-emerald-200 ring-1 ring-emerald-400/20';
  }
  if (status === 'skipped') {
    return 'bg-slate-500/12 text-slate-200 ring-1 ring-slate-400/20';
  }
  return 'bg-sky-500/12 text-sky-100 ring-1 ring-sky-400/20';
}

export default function SurprisesPage() {
  useMarkAppViewed('surprises');
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() =>
    typeof window === 'undefined' ? null : getCurrentUser()
  );
  const [data, setData] = useState<SurprisePageData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSurprises = useCallback(async (user: CurrentUser) => {
    setIsLoading(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const response = await fetch(`/api/surprises?player=${user}&timezone=${encodeURIComponent(timezone)}`);
      if (!response.ok) {
        throw new Error('Failed to load surprises');
      }
      const payload = await response.json() as SurprisePageData;
      setData(payload);
    } catch (loadError) {
      console.error('Error loading surprises:', loadError);
      setError('Could not load Surprise Generator right now.');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      void loadSurprises(currentUser);
    } else {
      setIsLoading(false);
    }
  }, [currentUser, loadSurprises]);

  const selectUser = (user: CurrentUser) => {
    persistCurrentUser(user);
    setCurrentUser(user);
  };

  const updateStatus = async (status: SurpriseSummary['status']) => {
    if (!currentUser || !data?.current || isUpdating) return;

    setIsUpdating(true);
    setError(null);
    try {
      const response = await fetch('/api/surprises', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player: currentUser,
          surpriseId: data.current.id,
          status,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update surprise status');
      }

      await loadSurprises(currentUser);
    } catch (updateError) {
      console.error('Error updating surprise status:', updateError);
      setError('Could not update this surprise right now.');
    } finally {
      setIsUpdating(false);
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.2),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.16),_transparent_30%),linear-gradient(135deg,_#020617_0%,_#0f172a_45%,_#111827_100%)] px-4 py-10 text-white">
        <div className="mx-auto max-w-md rounded-[32px] border border-white/10 bg-slate-950/60 p-8 text-center shadow-[0_32px_80px_-40px_rgba(14,165,233,0.55)] backdrop-blur-xl">
          <div className="text-6xl">🎁</div>
          <h1 className="mt-5 text-3xl font-semibold">Surprise Generator</h1>
          <p className="mt-3 text-sm leading-7 text-slate-300">
            This app stays private. Choose who you are so only your own monthly surprise appears.
          </p>
          <div className="mt-6 space-y-3">
            {(['daniel', 'huaiyao'] as CurrentUser[]).map((user) => (
              <button
                key={user}
                type="button"
                onClick={() => selectUser(user)}
                className={`w-full rounded-2xl px-5 py-4 text-left text-white shadow-lg transition-colors ${
                  user === 'daniel'
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'
                    : 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600'
                }`}
              >
                <div className="text-lg font-semibold">{user === 'daniel' ? 'Daniel' : 'Huaiyao'}</div>
                <div className="text-xs text-white/85">Show my private monthly surprise</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.18),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.18),_transparent_30%),linear-gradient(135deg,_#020617_0%,_#0f172a_45%,_#111827_100%)] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <motion.div
          className="absolute left-[10%] top-10 h-72 w-72 rounded-full bg-sky-500/15 blur-3xl"
          animate={{ scale: [1, 1.08, 1], y: [0, -18, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-10 right-[10%] h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl"
          animate={{ scale: [1.08, 1, 1.08], y: [0, 18, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <main className="relative z-10 mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="rounded-[32px] border border-white/10 bg-slate-950/60 p-5 shadow-[0_28px_70px_-38px_rgba(14,165,233,0.55)] backdrop-blur-xl sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="text-sm text-sky-200 transition-colors hover:text-white">
              Back home
            </Link>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${currentUser === 'daniel' ? 'bg-blue-500/15 text-blue-100' : 'bg-rose-500/15 text-rose-100'}`}>
                Viewing as {currentUser === 'daniel' ? 'Daniel' : 'Huaiyao'}
              </span>
              <ThemeToggle />
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-sky-300">Secret Monthly App</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Surprise Generator</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                Once a month, on the last Saturday, each of you gets a different private mission. The other person does not see it in the app, in search, or on home.
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">Next release</p>
              <p className="mt-2 text-lg font-semibold text-white">{data?.nextAssignment.label ?? 'Loading...'}</p>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                New missions appear at 09:00 in your local timezone. If cron missed the window, opening this page still creates your assignment.
              </p>
            </div>
          </div>
        </header>

        {isLoading ? (
          <div className="mt-6 flex min-h-[18rem] items-center justify-center rounded-[32px] border border-white/10 bg-slate-950/45">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
              className="h-10 w-10 rounded-full border-4 border-sky-200/30 border-t-sky-400"
            />
          </div>
        ) : error ? (
          <div className="mt-6 rounded-[28px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-100">
            {error}
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[32px] border border-white/10 bg-slate-950/55 p-5 shadow-[0_28px_70px_-38px_rgba(14,165,233,0.45)] backdrop-blur-xl sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">This month</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    {data?.current ? formatMonthKey(data.current.monthKey) : 'Not released yet'}
                  </h2>
                </div>
                {data?.current && (
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusClasses(data.current.status)}`}>
                    {data.current.status}
                  </span>
                )}
              </div>

              {data?.current ? (
                <>
                  <div className="mt-5 rounded-[28px] border border-sky-400/20 bg-gradient-to-br from-sky-500/15 via-blue-500/10 to-cyan-500/10 p-5">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-sky-200">For your eyes only</p>
                    <p className="mt-4 text-2xl font-semibold leading-9 text-white">{data.current.ideaText}</p>
                    <p className="mt-4 text-sm text-slate-300">
                      Category: <span className="capitalize text-white">{data.current.category.replace(/_/g, ' ')}</span>
                    </p>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => updateStatus('done')}
                      className="rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 font-medium text-white shadow-lg transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isUpdating ? 'Updating...' : 'Mark done'}
                    </button>
                    <button
                      type="button"
                      disabled={isUpdating}
                      onClick={() => updateStatus('skipped')}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-medium text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Skip this one
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-5 rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm leading-7 text-slate-300">
                  Your next assignment opens on <span className="font-semibold text-white">{data?.nextAssignment.label}</span>.
                </div>
              )}
            </section>

            <section className="rounded-[32px] border border-white/10 bg-slate-950/55 p-5 shadow-[0_28px_70px_-38px_rgba(14,165,233,0.45)] backdrop-blur-xl sm:p-6">
              <p className="text-[11px] uppercase tracking-[0.26em] text-slate-500">Private history</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Previous surprises</h2>
              <div className="mt-4 space-y-3">
                {(data?.history ?? []).length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                    No previous surprises yet.
                  </div>
                ) : (
                  data?.history.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{formatMonthKey(item.monthKey)}</p>
                          <p className="mt-2 text-sm leading-6 text-white">{item.ideaText}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(item.status)}`}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
