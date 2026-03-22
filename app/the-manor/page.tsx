import { AvailabilityBoard } from '@/app/scheduler/components/AvailabilityBoard';
import { getSchedulerBoard } from '@/lib/scheduler/boards';

export const metadata = {
  title: 'The Great Gatsby Murder Mystery | Daniel & Huaiyao',
  description:
    'A shared date board for finding the one night the whole murder mystery cast can make.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function TheManorPage() {
  const board = getSchedulerBoard('murder-mystery');

  if (!board) {
    return null;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f8f4ea] text-stone-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_top,rgba(213,163,77,0.18),transparent_52%)]" />
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(191,145,63,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(191,145,63,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="absolute inset-x-8 top-6 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
        <section className="mb-6 rounded-[32px] border border-amber-200/60 bg-white/90 px-4 py-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:mb-8 sm:px-8 sm:py-8">
          <p className="text-sm font-semibold uppercase tracking-[0.32em] text-amber-700/70">
            {board.eyebrow}
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-none tracking-tight text-stone-950 sm:text-6xl">
            {board.heroTitle}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-stone-600 sm:text-lg">
            {board.heroDescription}
          </p>
          <div className="mt-5 h-px w-full bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />

          <div className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-3">
            {board.steps.map((step, index) => (
              <div
                key={step}
                className="rounded-[24px] border border-amber-200/60 bg-amber-50/60 px-4 py-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
                  Clue {index + 1}
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-700">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <AvailabilityBoard board={board} />
      </div>
    </main>
  );
}
