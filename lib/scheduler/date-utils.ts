export const SCHEDULE_MONTH_COUNT = 6;

export type DateRangeSummary = {
  start: string;
  end: string;
  label: string;
  days: number;
};

const monthFormatter = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
});

const shortDateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
});

const longDateFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const fullDateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function firstDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function lastDayOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function getScheduleWindow(reference = new Date()) {
  const start = startOfLocalDay(reference);
  const end = lastDayOfMonth(addMonths(start, SCHEDULE_MONTH_COUNT - 1));

  return { start, end };
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function parseIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = parseIsoDate(value);

  return toIsoDate(date) === value;
}

export function compareIsoDates(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export function enumerateDates(startIso: string, endIso: string): string[] {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  const dates: string[] = [];

  if (start > end) {
    return dates;
  }

  const cursor = new Date(start);

  while (cursor <= end) {
    dates.push(toIsoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export function buildMonthGrid(monthStart: Date): Date[] {
  const first = firstDayOfMonth(monthStart);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  const days: Date[] = [];

  for (let index = 0; index < 42; index += 1) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    days.push(day);
  }

  return days;
}

export function listMonthsInWindow(startIso: string, endIso: string): Date[] {
  const months: Date[] = [];
  const end = firstDayOfMonth(parseIsoDate(endIso));
  let current = firstDayOfMonth(parseIsoDate(startIso));

  while (current <= end) {
    months.push(new Date(current));
    current = addMonths(current, 1);
  }

  return months;
}

export function isSameMonth(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth()
  );
}

export function formatMonthLabel(date: Date): string {
  return monthFormatter.format(date);
}

export function formatLongDate(isoDate: string): string {
  return longDateFormatter.format(parseIsoDate(isoDate));
}

export function formatShortDate(isoDate: string): string {
  return shortDateFormatter.format(parseIsoDate(isoDate));
}

export function formatRangeLabel(startIso: string, endIso: string): string {
  if (startIso === endIso) {
    return formatLongDate(startIso);
  }

  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);

  if (start.getFullYear() !== end.getFullYear()) {
    return `${fullDateFormatter.format(start)} - ${fullDateFormatter.format(end)}`;
  }

  if (start.getMonth() === end.getMonth()) {
    return `${shortDateFormatter.format(start)} - ${end.getDate()}`;
  }

  return `${shortDateFormatter.format(start)} - ${shortDateFormatter.format(end)}`;
}

export function compressDateRanges(dates: string[]): DateRangeSummary[] {
  const unique = [...new Set(dates)].sort(compareIsoDates);

  if (unique.length === 0) {
    return [];
  }

  const summaries: DateRangeSummary[] = [];
  let rangeStart = unique[0];
  let previous = unique[0];

  for (const current of unique.slice(1)) {
    const nextExpected = parseIsoDate(previous);
    nextExpected.setDate(nextExpected.getDate() + 1);

    if (toIsoDate(nextExpected) === current) {
      previous = current;
      continue;
    }

    summaries.push({
      start: rangeStart,
      end: previous,
      label: formatRangeLabel(rangeStart, previous),
      days: enumerateDates(rangeStart, previous).length,
    });

    rangeStart = current;
    previous = current;
  }

  summaries.push({
    start: rangeStart,
    end: previous,
    label: formatRangeLabel(rangeStart, previous),
    days: enumerateDates(rangeStart, previous).length,
  });

  return summaries;
}
