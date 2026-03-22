import Link from 'next/link';

import { schedulerBoards } from '@/lib/scheduler/boards';

export const metadata = {
  title: 'Scheduler | Daniel & Huaiyao',
  description: 'Shared scheduling tools for picking dates that work for everyone.',
};

export default function SchedulerHubPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(190,24,93,0.18),transparent_30%),linear-gradient(180deg,#12090d_0%,#1b1114_100%)] text-stone-50">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-80 w-80 rounded-full bg-rose-700/20 blur-3xl" />
        <div className="absolute right-0 top-24 h-72 w-72 rounded-full bg-amber-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-stone-100 transition hover:-translate-y-0.5 hover:bg-white/10"
          >
            Back home
          </Link>
          <span className="rounded-full border border-amber-200/15 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/80">
            Scheduler Hub
          </span>
        </div>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-300">
              Shared Planning
            </p>
            <h1 className="mt-4 font-serif text-5xl leading-none text-amber-50 sm:text-6xl lg:text-7xl">
              One place for “when can everyone do it?”
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300 sm:text-lg">
              This section is for lightweight scheduling tools. Each event can
              have its own feel, but the goal stays the same: make it obvious
              which dates actually work.
            </p>
          </div>

          <div className="rounded-[28px] border border-amber-200/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] p-6 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/75">
              Current option
            </p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
              <p>The first board is for the murder mystery event.</p>
              <p>More schedule formats can be added here later.</p>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {schedulerBoards.map((board) => (
            <Link
              key={board.slug}
              href={board.href}
              className="group rounded-[30px] border border-amber-200/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] transition hover:-translate-y-1 hover:border-amber-200/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">
                    {board.eyebrow}
                  </p>
                  <h2 className="mt-3 font-serif text-4xl leading-none text-amber-50">
                    {board.shortTitle}
                  </h2>
                </div>
                <span className="text-4xl transition group-hover:scale-110">
                  {board.icon}
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-stone-300">
                {board.summary}
              </p>
              <div className="mt-6 inline-flex items-center rounded-full border border-amber-200/15 bg-white/8 px-4 py-2 text-sm font-semibold text-amber-50">
                Open board
              </div>
            </Link>
          ))}

          <div className="rounded-[30px] border border-dashed border-amber-200/15 bg-white/3 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">
              Next slot
            </p>
            <h2 className="mt-3 font-serif text-4xl leading-none text-amber-50">
              More soon
            </h2>
            <p className="mt-4 text-sm leading-6 text-stone-300">
              If you want another event type later, this hub is where it goes.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
