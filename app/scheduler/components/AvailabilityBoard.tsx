'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import type { SchedulerBoard } from '@/lib/scheduler/boards';
import {
  compareIsoDates,
  compressDateRanges,
  formatLongDate,
  formatMonthLabel,
  formatShortDate,
  getScheduleWindow,
  isSameMonth,
  listMonthsInWindow,
  parseIsoDate,
  toIsoDate,
} from '@/lib/scheduler/date-utils';
import type {
  ParticipantAvailability,
  PublicBoardResponse,
} from '@/lib/scheduler/types';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const panelClass =
  'rounded-[30px] border border-amber-200/60 bg-white/95 p-4 text-stone-950 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6';
const calendarPanelClass =
  'rounded-[30px] border border-amber-200/60 bg-white/95 p-3 text-stone-950 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur sm:p-6';
const mutedButtonClass =
  'rounded-full border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-stone-700 transition hover:border-amber-300 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-45';
const primaryButtonClass =
  'rounded-full bg-[linear-gradient(135deg,#f3d789,#d2a14d)] px-5 py-3 text-sm font-semibold text-stone-950 shadow-[0_14px_28px_rgba(201,150,49,0.2)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 disabled:shadow-none';

function defaultWindow() {
  const window = getScheduleWindow();

  return {
    start: toIsoDate(window.start),
    end: toIsoDate(window.end),
  };
}

function normalizeNameInput(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function extractMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    if ('error' in data && typeof data.error === 'string') {
      return data.error;
    }

    if ('message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }

  return fallback;
}

async function parseResponse<T>(
  response: Response
): Promise<{ ok: boolean; data: T | Record<string, unknown> }> {
  const text = await response.text();

  if (!text) {
    return { ok: response.ok, data: {} };
  }

  try {
    return { ok: response.ok, data: JSON.parse(text) as T };
  } catch {
    return { ok: response.ok, data: { error: text } };
  }
}

function toggleDate(current: string[], isoDate: string) {
  const next = new Set(current);

  if (next.has(isoDate)) {
    next.delete(isoDate);
  } else {
    next.add(isoDate);
  }

  return [...next].sort(compareIsoDates);
}

function buildAvailabilityIndex(participants: ParticipantAvailability[]) {
  const index = new Map<string, { count: number; names: string[] }>();

  for (const participant of participants) {
    for (const date of [...new Set(participant.dates)]) {
      const current = index.get(date) ?? { count: 0, names: [] };
      current.count += 1;
      current.names.push(participant.name);
      current.names.sort((left, right) => left.localeCompare(right));
      index.set(date, current);
    }
  }

  return index;
}

function findParticipantByName(
  participants: ParticipantAvailability[],
  name: string
) {
  const lookup = normalizeNameInput(name).toLocaleLowerCase();

  if (!lookup) {
    return null;
  }

  return (
    participants.find(
      (participant) =>
        normalizeNameInput(participant.name).toLocaleLowerCase() === lookup
    ) ?? null
  );
}

function isWeekendDate(isoDate: string) {
  const weekday = parseIsoDate(isoDate).getDay();

  return weekday === 0 || weekday === 5 || weekday === 6;
}

function buildMondayMonthGrid(monthStart: Date) {
  const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const gridStart = new Date(first);
  const mondayOffset = (first.getDay() + 6) % 7;

  gridStart.setDate(first.getDate() - mondayOffset);

  const days: Date[] = [];

  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    days.push(day);
  }

  return days;
}

export function AvailabilityBoard({ board }: { board: SchedulerBoard }) {
  const apiBase = `/api/scheduler/${board.slug}`;
  const [boardState, setBoardState] = useState<PublicBoardResponse | null>(null);
  const [name, setName] = useState('');
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeMonthIndex, setActiveMonthIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [isPending, startTransition] = useTransition();

  const participants = useMemo(
    () => boardState?.participants ?? [],
    [boardState?.participants]
  );
  const normalizedName = useMemo(() => normalizeNameInput(name), [name]);
  const matchingParticipant = useMemo(
    () => findParticipantByName(participants, normalizedName),
    [participants, normalizedName]
  );
  const windowRange = boardState?.window ?? defaultWindow();
  const months = useMemo(
    () => listMonthsInWindow(windowRange.start, windowRange.end),
    [windowRange.end, windowRange.start]
  );

  useEffect(() => {
    let ignore = false;

    async function loadBoard() {
      setLoadingBoard(true);

      try {
        const response = await fetch(`${apiBase}/board`, { cache: 'no-store' });
        const result = await parseResponse<PublicBoardResponse>(response);

        if (!ignore) {
          setBoardState(result.data as PublicBoardResponse);
        }
      } catch {
        if (!ignore) {
          setError('Could not load the shared calendar.');
        }
      } finally {
        if (!ignore) {
          setLoadingBoard(false);
        }
      }
    }

    void loadBoard();

    return () => {
      ignore = true;
    };
  }, [apiBase]);

  useEffect(() => {
    if (!normalizedName) {
      setSelectedDates([]);
      return;
    }

    setSelectedDates(matchingParticipant?.dates ?? []);
  }, [matchingParticipant?.id, normalizedName]);

  useEffect(() => {
    if (months.length === 0) {
      return;
    }

    setActiveMonthIndex((current) => Math.min(current, months.length - 1));
  }, [months.length]);

  const draftParticipant = useMemo(() => {
    if (!normalizedName) {
      return null;
    }

    if (!matchingParticipant && selectedDates.length === 0) {
      return null;
    }

    return {
      id: matchingParticipant?.id ?? '__draft__',
      name: matchingParticipant?.name ?? normalizedName,
      updatedAt: matchingParticipant?.updatedAt ?? '',
      dates: selectedDates,
    } satisfies ParticipantAvailability;
  }, [matchingParticipant, normalizedName, selectedDates]);

  const displayParticipants = useMemo(() => {
    if (!draftParticipant) {
      return participants;
    }

    return [
      ...participants.filter((participant) => participant.id !== draftParticipant.id),
      draftParticipant,
    ].sort((left, right) => left.name.localeCompare(right.name));
  }, [draftParticipant, participants]);

  const selectedDateSet = useMemo(() => new Set(selectedDates), [selectedDates]);
  const selectedRanges = useMemo(
    () => compressDateRanges(selectedDates),
    [selectedDates]
  );
  const availability = useMemo(
    () => buildAvailabilityIndex(displayParticipants),
    [displayParticipants]
  );
  const bestDates = useMemo(
    () =>
      [...availability.entries()]
        .filter(([, summary]) => summary.count > 0)
        .sort(
          (left, right) =>
            right[1].count - left[1].count ||
            compareIsoDates(left[0], right[0])
        )
        .slice(0, 6),
    [availability]
  );
  const featuredDates = useMemo(() => {
    const weekendDates = bestDates.filter(([date]) => isWeekendDate(date));

    return (weekendDates.length > 0 ? weekendDates : bestDates).slice(0, 4);
  }, [bestDates]);
  const everyoneFreeDates = useMemo(
    () =>
      displayParticipants.length === 0
        ? []
        : [...availability.entries()]
            .filter(([, summary]) => summary.count === displayParticipants.length)
            .map(([date]) => date)
            .sort(compareIsoDates)
            .slice(0, 4),
    [availability, displayParticipants.length]
  );
  const hasUnsavedChanges = useMemo(() => {
    const baseline = matchingParticipant?.dates ?? [];

    if (baseline.length !== selectedDates.length) {
      return true;
    }

    return baseline.some((date, index) => date !== selectedDates[index]);
  }, [matchingParticipant?.dates, selectedDates]);
  const activeSummary = activeDate ? availability.get(activeDate) ?? null : null;
  const currentMonth = months[activeMonthIndex] ?? months[0] ?? new Date();

  async function refreshBoard() {
    const response = await fetch(`${apiBase}/board`, { cache: 'no-store' });
    const result = await parseResponse<PublicBoardResponse>(response);
    setBoardState(result.data as PublicBoardResponse);
  }

  function handleDayToggle(isoDate: string) {
    if (
      compareIsoDates(isoDate, windowRange.start) < 0 ||
      compareIsoDates(isoDate, windowRange.end) > 0
    ) {
      return;
    }

    setActiveDate(isoDate);

    if (!normalizedName) {
      setError('Type your name first, then tap the days you can do.');
      return;
    }

    setError(null);
    setNotice(null);
    setSelectedDates((current) => toggleDate(current, isoDate));
  }

  function handleReset() {
    setError(null);
    setNotice(null);
    setSelectedDates(matchingParticipant?.dates ?? []);
  }

  function handleClear() {
    setError(null);
    setNotice(null);
    setSelectedDates([]);
  }

  function handleSave() {
    if (!normalizedName) {
      setError('Please add your name first.');
      return;
    }

    if (!boardState?.configured) {
      setError('The scheduler database is not connected yet.');
      return;
    }

    setError(null);
    setNotice(null);

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch(`${apiBase}/participant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: matchingParticipant?.name ?? normalizedName,
              dates: selectedDates,
            }),
          });
          const result = await parseResponse<{
            participant: ParticipantAvailability;
          }>(response);

          if (!result.ok) {
            setError(extractMessage(result.data, 'Could not save these dates.'));
            return;
          }

          const payload = result.data as {
            participant: ParticipantAvailability;
          };

          setName(payload.participant.name);
          setSelectedDates(payload.participant.dates);
          await refreshBoard();
          setNotice(
            payload.participant.dates.length > 0
              ? `${payload.participant.name}'s availability is saved.`
              : `${payload.participant.name} now has no selected dates.`
          );
        } catch {
          setError('Could not save these dates.');
        }
      })();
    });
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <section className={calendarPanelClass}>
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700/70">
              Guest Ledger
            </p>
            <h2 className="mt-2 font-serif text-3xl tracking-tight text-stone-950 sm:text-4xl">
              Mark the nights you can make it
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600 sm:text-base">
              Add your name, tap the dates you are free, then save. Return with
              the same name later and your alibi will load back in for editing.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
            <label className="block sm:col-span-2 lg:col-span-1">
              <span className="mb-2 block text-sm font-semibold text-stone-700">
                Guest name
              </span>
              <input
                className="w-full rounded-2xl border border-amber-200/60 bg-white px-4 py-3 text-base text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-200/50"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Daisy Buchanan"
              />
            </label>

            <button
              className={mutedButtonClass}
              type="button"
              onClick={handleClear}
              disabled={selectedDates.length === 0}
            >
              Clear
            </button>

            <button
              className={mutedButtonClass}
              type="button"
              onClick={handleReset}
              disabled={!hasUnsavedChanges}
            >
              Reset
            </button>

            <button
              className={primaryButtonClass}
              type="button"
              onClick={handleSave}
              disabled={isPending || boardState?.configured === false}
            >
              {isPending ? 'Saving...' : 'Save availability'}
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[24px] border border-amber-200/60 bg-amber-50/60 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
                Your nights
              </p>
              <p className="mt-2 text-2xl font-semibold text-stone-950">
                {selectedDates.length}
              </p>
            </div>

            <div className="rounded-[24px] border border-amber-200/60 bg-amber-50/60 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
                Guests
              </p>
              <p className="mt-2 text-2xl font-semibold text-stone-950">
                {participants.length}
              </p>
            </div>

            <div className="rounded-[24px] border border-amber-200/60 bg-amber-50/60 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
                Best night
              </p>
              <p className="mt-2 text-lg font-semibold text-stone-950">
                {featuredDates[0] ? formatShortDate(featuredDates[0][0]) : 'Waiting'}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {featuredDates[0]
                  ? `${featuredDates[0][1].count} people can do it`
                  : 'No dates saved yet'}
              </p>
            </div>
          </div>

          {notice ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
        </div>
      </section>

      <section className={panelClass}>
        <div className="flex items-center justify-between gap-3">
          <button
            className={mutedButtonClass}
            type="button"
            onClick={() => setActiveMonthIndex((current) => Math.max(0, current - 1))}
            disabled={activeMonthIndex === 0}
          >
            ←
          </button>

          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
              Ballroom Calendar
            </p>
            <h3 className="mt-1 font-serif text-2xl tracking-tight text-stone-950 sm:text-3xl">
              {formatMonthLabel(currentMonth)}
            </h3>
            <p className="mt-2 text-sm text-stone-600">
              One month at a time for bigger, easier taps.
            </p>
          </div>

          <button
            className={mutedButtonClass}
            type="button"
            onClick={() =>
              setActiveMonthIndex((current) => Math.min(months.length - 1, current + 1))
            }
            disabled={activeMonthIndex >= months.length - 1}
          >
            →
          </button>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-1 text-center text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-stone-400 sm:gap-2 sm:text-[0.72rem]">
          {WEEKDAY_LABELS.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className={index >= 5 ? 'text-amber-700/80' : undefined}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 sm:gap-2">
          {buildMondayMonthGrid(currentMonth).map((day) => {
            const isoDate = toIsoDate(day);
            const inMonth = isSameMonth(day, currentMonth);
            const inWindow =
              compareIsoDates(isoDate, windowRange.start) >= 0 &&
              compareIsoDates(isoDate, windowRange.end) <= 0;
            const summary = availability.get(isoDate);
            const count = summary?.count ?? 0;
            const isSelected = selectedDateSet.has(isoDate);
            const isActive = activeDate === isoDate;
            const isPerfect =
              displayParticipants.length > 0 && count === displayParticipants.length;
            const isWeekend = isWeekendDate(isoDate);

            let dayClassName =
              'relative aspect-square rounded-[16px] border p-1.5 text-left transition sm:rounded-[20px] sm:p-3';

            if (!inMonth || !inWindow) {
              dayClassName +=
                ' cursor-default border-stone-100 bg-stone-100/70 text-stone-300 opacity-60';
            } else if (isSelected) {
              dayClassName +=
                ' border-rose-800 bg-[linear-gradient(180deg,#8b2332,#5b1721)] text-rose-50 shadow-[0_14px_34px_rgba(91,23,33,0.22)]';
            } else if (isPerfect) {
              dayClassName +=
                ' border-amber-300 bg-[linear-gradient(180deg,#fff5d9,#f0d58a)] text-stone-950 hover:border-amber-400';
            } else if (isWeekend) {
              dayClassName +=
                ' border-emerald-200 bg-emerald-50 text-stone-950 hover:border-emerald-300';
            } else {
              dayClassName +=
                ' border-amber-200/60 bg-white text-stone-950 hover:border-amber-300 hover:bg-amber-50/60';
            }

            if (isActive && inMonth && inWindow && !isSelected) {
              dayClassName += ' ring-2 ring-amber-200';
            }

            return (
              <button
                key={`${currentMonth.toISOString()}-${isoDate}`}
                type="button"
                disabled={!inMonth || !inWindow}
                onClick={() => handleDayToggle(isoDate)}
                title={
                  summary?.names.length
                    ? `${formatLongDate(isoDate)}: ${summary.names.join(', ')}`
                    : formatLongDate(isoDate)
                }
                className={dayClassName}
              >
                <span className="absolute left-1.5 top-1.5 text-sm font-semibold leading-none sm:left-3 sm:top-2.5 sm:text-lg">
                  {day.getDate()}
                </span>

                {isSelected ? (
                  <span className="absolute bottom-1.5 left-1.5 h-2 w-2 rounded-full bg-current/80 sm:bottom-3 sm:left-3 sm:h-2.5 sm:w-2.5" />
                ) : null}

                {count > 0 ? (
                  <span className="absolute bottom-1.5 right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-current/15 px-1 text-[0.65rem] font-semibold leading-none sm:bottom-3 sm:right-3 sm:h-6 sm:min-w-6 sm:text-[0.72rem]">
                    {count}
                  </span>
                ) : null}

                <div className="absolute inset-x-3 bottom-3 hidden items-center justify-between sm:flex">
                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] opacity-70">
                    {isSelected ? 'Yours' : isPerfect ? 'Full' : isWeekend ? 'Prime' : ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-stone-600">
          <span className="rounded-full border border-amber-200/60 bg-amber-50/60 px-3 py-2">
            Burgundy = your dates
          </span>
          <span className="rounded-full border border-amber-200/60 bg-amber-50/60 px-3 py-2">
            Gold = everyone is free
          </span>
          <span className="rounded-full border border-amber-200/60 bg-amber-50/60 px-3 py-2">
            Number = guests free that night
          </span>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className={panelClass}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
            Chosen Night
          </p>
          <h3 className="mt-2 font-serif text-2xl tracking-tight text-stone-950">
            Who is free on this day
          </h3>

          {activeDate ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-[24px] border border-amber-200/60 bg-amber-50/60 px-4 py-4">
                <p className="text-base font-semibold text-stone-950">
                  {formatLongDate(activeDate)}
                </p>
                <p className="mt-1 text-sm text-stone-600">
                  {activeSummary?.count ?? 0} people available
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {activeSummary?.names.length ? (
                  activeSummary.names.map((person) => (
                    <span
                      key={`${activeDate}-${person}`}
                      className="rounded-full border border-amber-200/60 bg-white px-3 py-2 text-sm text-stone-700"
                    >
                      {person}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-stone-500">
                    No one is marked free on this day yet.
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-[24px] border border-dashed border-amber-200/60 px-4 py-4 text-sm text-stone-500">
              Tap a day to see who is free.
            </div>
          )}

          <div className="mt-6 rounded-[24px] border border-amber-200/60 bg-amber-50/60 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
                  Your Alibi
                </p>
                <p className="mt-1 text-sm text-stone-600">
                  Press save when you are happy with these dates.
                </p>
              </div>
              {matchingParticipant ? (
                <span className="rounded-full border border-amber-200/60 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
                  Editing {matchingParticipant.name}
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {selectedRanges.length > 0 ? (
                selectedRanges.map((range) => (
                  <span
                    key={`${range.start}-${range.end}`}
                    className="rounded-full border border-amber-200/60 bg-white px-3 py-2 text-sm text-stone-700"
                  >
                    {range.label}
                  </span>
                ))
              ) : (
                <span className="text-sm text-stone-500">
                  No dates selected yet.
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className={panelClass}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
              Best Nights
            </p>
            <h3 className="mt-2 font-serif text-2xl tracking-tight text-stone-950">
              Strongest options
            </h3>

            {everyoneFreeDates.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                Everyone can do{' '}
                {everyoneFreeDates.map((date) => formatShortDate(date)).join(', ')}.
              </div>
            ) : null}

            <div className="mt-5 space-y-3">
              {featuredDates.length > 0 ? (
                featuredDates.map(([date, summary]) => (
                  <article
                    key={date}
                    className="rounded-[24px] border border-amber-200/60 bg-amber-50/60 px-4 py-4"
                  >
                    <p className="text-base font-semibold text-stone-950">
                      {formatLongDate(date)}
                    </p>
                    <p className="mt-1 text-sm text-stone-600">
                      {summary.count} of {displayParticipants.length} can do it
                    </p>
                    <p className="mt-2 text-sm text-stone-500">
                      {summary.names.join(', ')}
                    </p>
                  </article>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-amber-200/60 px-4 py-4 text-sm text-stone-500">
                  {loadingBoard
                    ? 'Loading replies...'
                    : 'The best dates will appear here once people save their availability.'}
                </div>
              )}
            </div>
          </div>

          <div className={panelClass}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
                  Guest List
                </p>
                <h3 className="mt-2 font-serif text-2xl tracking-tight text-stone-950">
                  Who has replied
                </h3>
              </div>
              <span className="rounded-full border border-amber-200/60 bg-amber-50/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
                {displayParticipants.length} total
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {displayParticipants.length > 0 ? (
                displayParticipants.map((participant) => {
                  const ranges = compressDateRanges(participant.dates);
                  const isCurrent =
                    normalizedName &&
                    normalizeNameInput(participant.name).toLocaleLowerCase() ===
                      normalizedName.toLocaleLowerCase();
                  const isDraft = participant.id === '__draft__';

                  return (
                    <article
                      key={participant.id}
                      className="rounded-[24px] border border-amber-200/60 bg-amber-50/60 px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-base font-semibold text-stone-950">
                            {participant.name}
                          </h4>
                          <p className="mt-1 text-sm text-stone-600">
                            {participant.dates.length} free day
                            {participant.dates.length === 1 ? '' : 's'}
                          </p>
                        </div>

                        {isDraft ? (
                          <span className="rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-amber-800">
                            Not saved
                          </span>
                        ) : isCurrent ? (
                          <span className="rounded-full border border-amber-200/60 bg-white px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-stone-600">
                            You
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {ranges.length > 0 ? (
                          ranges.map((range) => (
                            <span
                              key={`${participant.id}-${range.start}-${range.end}`}
                              className="rounded-full border border-amber-200/60 bg-white px-3 py-2 text-sm text-stone-700"
                            >
                              {range.label}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm text-stone-500">
                            No dates selected.
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-[24px] border border-dashed border-amber-200/60 px-4 py-4 text-sm text-stone-500">
                  No one has responded yet.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {!boardState?.configured ? (
        <section className={panelClass}>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700/70">
            Setup required
          </p>
          <h3 className="mt-2 font-serif text-2xl tracking-tight text-stone-950">
            Connect the scheduler database
          </h3>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            {boardState?.message ??
              'Add the scheduler Supabase URL and service role key to this app.'}
          </p>
        </section>
      ) : null}
    </div>
  );
}
