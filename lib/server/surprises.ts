import { getPreferredUserTimezones, normalizeKnownUser, normalizeTimezone, sendPushToUsers, type KnownUser } from './push';
import { getSupabaseAdmin } from './supabase-admin';

type SurpriseStatus = 'pending' | 'done' | 'skipped';

type SurpriseIdeaRow = {
  id: string;
  idea_text: string;
  category: string;
  created_at?: string;
};

type MonthlySurpriseRow = {
  id: string;
  month_key: string;
  player: KnownUser;
  surprise_idea_id: string;
  status: SurpriseStatus;
  generated_at: string;
  notify_at: string | null;
  notified_at: string | null;
  completed_at: string | null;
};

export type SurpriseSummary = {
  id: string;
  monthKey: string;
  player: KnownUser;
  status: SurpriseStatus;
  generatedAt: string;
  notifyAt: string | null;
  notifiedAt: string | null;
  completedAt: string | null;
  ideaId: string;
  ideaText: string;
  category: string;
};

export type SurprisePageData = {
  timezone: string;
  current: SurpriseSummary | null;
  history: SurpriseSummary[];
  nextAssignment: {
    monthKey: string;
    date: string;
    label: string;
  };
};

export type SurpriseAssignmentCronResult = {
  success: boolean;
  dryRun: boolean;
  sent: number;
  failed: number;
  skipped: number;
  outcomes: Array<{
    user: KnownUser;
    timezone: string;
    action: 'sent' | 'skipped' | 'failed';
    reason: string;
    monthKey?: string;
    surpriseId?: string;
  }>;
};

const PLAYERS: KnownUser[] = ['daniel', 'huaiyao'];
const TARGET_HOUR = 9;

function getDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number.parseInt(values.year, 10),
    month: Number.parseInt(values.month, 10),
    day: Number.parseInt(values.day, 10),
    hour: Number.parseInt(values.hour, 10),
    minute: Number.parseInt(values.minute, 10),
  };
}

function padMonth(value: number) {
  return value.toString().padStart(2, '0');
}

function getMonthKey(year: number, month: number) {
  return `${year}-${padMonth(month)}`;
}

function parseMonthKey(monthKey: string) {
  const [yearPart, monthPart] = monthKey.split('-');
  return {
    year: Number.parseInt(yearPart, 10),
    month: Number.parseInt(monthPart, 10),
  };
}

function getLastSaturdayDay(year: number, month: number) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekday = new Date(Date.UTC(year, month - 1, daysInMonth)).getUTCDay();
  const distanceToSaturday = (weekday - 6 + 7) % 7;
  return daysInMonth - distanceToSaturday;
}

function hasReleaseStarted(date: Date, timeZone: string) {
  const parts = getDateParts(date, timeZone);
  const lastSaturday = getLastSaturdayDay(parts.year, parts.month);
  if (parts.day > lastSaturday) return true;
  if (parts.day < lastSaturday) return false;
  return parts.hour >= TARGET_HOUR;
}

function getNextReleaseParts(date: Date, timeZone: string) {
  const parts = getDateParts(date, timeZone);
  const releaseStarted = hasReleaseStarted(date, timeZone);
  const month = releaseStarted ? (parts.month === 12 ? 1 : parts.month + 1) : parts.month;
  const year = releaseStarted && parts.month === 12 ? parts.year + 1 : parts.year;
  const day = getLastSaturdayDay(year, month);

  return {
    year,
    month,
    day,
    monthKey: getMonthKey(year, month),
  };
}

function formatReleaseLabel(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function simpleHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isDuplicateError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('duplicate') || normalized.includes('23505');
}

function buildSummary(row: MonthlySurpriseRow, ideasById: Map<string, SurpriseIdeaRow>): SurpriseSummary | null {
  const idea = ideasById.get(row.surprise_idea_id);
  if (!idea) return null;

  return {
    id: row.id,
    monthKey: row.month_key,
    player: row.player,
    status: row.status,
    generatedAt: row.generated_at,
    notifyAt: row.notify_at,
    notifiedAt: row.notified_at,
    completedAt: row.completed_at,
    ideaId: row.surprise_idea_id,
    ideaText: idea.idea_text,
    category: idea.category,
  };
}

async function listIdeas() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('surprise_ideas')
    .select('id, idea_text, category, created_at')
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SurpriseIdeaRow[];
}

async function listMonthlyRows(player: KnownUser, limit = 18) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('monthly_surprises')
    .select('id, month_key, player, surprise_idea_id, status, generated_at, notify_at, notified_at, completed_at')
    .eq('player', player)
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as MonthlySurpriseRow[];
}

async function getMonthlyRow(player: KnownUser, monthKey: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('monthly_surprises')
    .select('id, month_key, player, surprise_idea_id, status, generated_at, notify_at, notified_at, completed_at')
    .eq('player', player)
    .eq('month_key', monthKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as MonthlySurpriseRow | null;
}

async function getIdeaMap(ideaIds?: string[]) {
  const ideas = ideaIds && ideaIds.length > 0
    ? await (async () => {
        const supabase = getSupabaseAdmin();
        const { data, error } = await supabase
          .from('surprise_ideas')
          .select('id, idea_text, category, created_at')
          .in('id', ideaIds);
        if (error) {
          throw new Error(error.message);
        }
        return (data ?? []) as SurpriseIdeaRow[];
      })()
    : await listIdeas();

  return new Map(ideas.map((idea) => [idea.id, idea]));
}

async function resolveTimezone(player: KnownUser, preferredTimezone?: string | null) {
  if (preferredTimezone) {
    return normalizeTimezone(preferredTimezone);
  }

  const timezones = await getPreferredUserTimezones();
  return timezones[player];
}

function pickIdea(ideas: SurpriseIdeaRow[], monthKey: string, player: KnownUser) {
  const ordered = [...ideas].sort((left, right) => left.idea_text.localeCompare(right.idea_text));
  if (ordered.length === 0) {
    return null;
  }
  const index = simpleHash(`${monthKey}:${player}`) % ordered.length;
  return ordered[index] ?? ordered[0];
}

async function chooseIdeaForPlayer(player: KnownUser, monthKey: string) {
  const supabase = getSupabaseAdmin();
  const [allIdeas, historyRows, otherPlayerRow] = await Promise.all([
    listIdeas(),
    listMonthlyRows(player, 240),
    supabase
      .from('monthly_surprises')
      .select('surprise_idea_id')
      .eq('month_key', monthKey)
      .neq('player', player)
      .limit(1)
      .maybeSingle(),
  ]);

  const usedIdeaIds = new Set(historyRows.map((row) => row.surprise_idea_id));
  let availableIdeas = allIdeas.filter((idea) => !usedIdeaIds.has(idea.id));
  if (availableIdeas.length === 0) {
    availableIdeas = allIdeas;
  }

  const partnerIdeaId = otherPlayerRow.data?.surprise_idea_id ?? null;
  if (partnerIdeaId && availableIdeas.length > 1) {
    const withoutPartnerIdea = availableIdeas.filter((idea) => idea.id !== partnerIdeaId);
    if (withoutPartnerIdea.length > 0) {
      availableIdeas = withoutPartnerIdea;
    }
  }

  const selectedIdea = pickIdea(availableIdeas, monthKey, player);
  if (!selectedIdea) {
    throw new Error('No surprise ideas are available');
  }

  return selectedIdea;
}

export async function ensureMonthlySurpriseForPlayer(options: {
  player: KnownUser;
  preferredTimezone?: string | null;
  now?: Date;
  forceCreate?: boolean;
}) {
  const now = options.now ?? new Date();
  const timezone = await resolveTimezone(options.player, options.preferredTimezone);
  const parts = getDateParts(now, timezone);
  const monthKey = getMonthKey(parts.year, parts.month);
  const existing = await getMonthlyRow(options.player, monthKey);

  if (existing) {
    const ideaMap = await getIdeaMap([existing.surprise_idea_id]);
    return {
      timezone,
      monthKey,
      current: buildSummary(existing, ideaMap),
    };
  }

  if (!options.forceCreate && !hasReleaseStarted(now, timezone)) {
    return {
      timezone,
      monthKey,
      current: null,
    };
  }

  const idea = await chooseIdeaForPlayer(options.player, monthKey);
  const supabase = getSupabaseAdmin();
  const insertPayload = {
    month_key: monthKey,
    player: options.player,
    surprise_idea_id: idea.id,
  };
  const { data, error } = await supabase
    .from('monthly_surprises')
    .insert(insertPayload)
    .select('id, month_key, player, surprise_idea_id, status, generated_at, notify_at, notified_at, completed_at')
    .single();

  if (error) {
    if (!isDuplicateError(error.message)) {
      throw new Error(error.message);
    }

    const duplicate = await getMonthlyRow(options.player, monthKey);
    if (!duplicate) {
      throw new Error(error.message);
    }

    const ideaMap = await getIdeaMap([duplicate.surprise_idea_id]);
    return {
      timezone,
      monthKey,
      current: buildSummary(duplicate, ideaMap),
    };
  }

  const row = data as MonthlySurpriseRow;
  return {
    timezone,
    monthKey,
    current: buildSummary(row, new Map([[idea.id, idea]])),
  };
}

export async function getSurprisePageData(player: KnownUser, preferredTimezone?: string | null) {
  const now = new Date();
  const ensured = await ensureMonthlySurpriseForPlayer({
    player,
    preferredTimezone,
    now,
  });
  const rows = await listMonthlyRows(player, 18);
  const ideaIds = Array.from(new Set(rows.map((row) => row.surprise_idea_id)));
  const ideaMap = await getIdeaMap(ideaIds);
  const history = rows
    .map((row) => buildSummary(row, ideaMap))
    .filter((row): row is SurpriseSummary => Boolean(row));

  const currentId = ensured.current?.id ?? null;
  const previous = currentId
    ? history.filter((entry) => entry.id !== currentId)
    : history;

  const nextRelease = getNextReleaseParts(now, ensured.timezone);

  return {
    timezone: ensured.timezone,
    current: ensured.current,
    history: previous,
    nextAssignment: {
      monthKey: nextRelease.monthKey,
      date: `${nextRelease.year}-${padMonth(nextRelease.month)}-${padMonth(nextRelease.day)}`,
      label: formatReleaseLabel(nextRelease.year, nextRelease.month, nextRelease.day),
    },
  } satisfies SurprisePageData;
}

export async function updateMonthlySurpriseStatus(options: {
  player: KnownUser;
  surpriseId: string;
  status: SurpriseStatus;
}) {
  const payload = {
    status: options.status,
    completed_at: options.status === 'done' ? new Date().toISOString() : null,
  };
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('monthly_surprises')
    .update(payload)
    .eq('id', options.surpriseId)
    .eq('player', options.player)
    .select('id, month_key, player, surprise_idea_id, status, generated_at, notify_at, notified_at, completed_at')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error('Surprise assignment not found');
  }

  const row = data as MonthlySurpriseRow;
  const ideaMap = await getIdeaMap([row.surprise_idea_id]);
  const summary = buildSummary(row, ideaMap);
  if (!summary) {
    throw new Error('Surprise assignment could not be hydrated');
  }

  return summary;
}

export async function listSurprisesForSearch(player: KnownUser, limit = 18) {
  const rows = await listMonthlyRows(player, limit);
  const ideaIds = Array.from(new Set(rows.map((row) => row.surprise_idea_id)));
  const ideaMap = await getIdeaMap(ideaIds);
  return rows
    .map((row) => buildSummary(row, ideaMap))
    .filter((row): row is SurpriseSummary => Boolean(row));
}

export async function runMonthlySurpriseAssignments(options?: {
  dryRun?: boolean;
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const dryRun = options?.dryRun ?? false;
  const timezones = await getPreferredUserTimezones();
  const outcomes: SurpriseAssignmentCronResult['outcomes'] = [];

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const user of PLAYERS) {
    const timezone = timezones[user];
    const parts = getDateParts(now, timezone);
    const lastSaturday = getLastSaturdayDay(parts.year, parts.month);

    if (parts.day !== lastSaturday) {
      outcomes.push({
        user,
        timezone,
        action: 'skipped',
        reason: 'Not the last Saturday in this timezone',
      });
      skipped += 1;
      continue;
    }

    if (parts.hour < TARGET_HOUR) {
      outcomes.push({
        user,
        timezone,
        action: 'skipped',
        reason: 'Not local 09:00 yet',
      });
      skipped += 1;
      continue;
    }

    const ensured = await ensureMonthlySurpriseForPlayer({
      player: user,
      preferredTimezone: timezone,
      now,
    });

    if (!ensured.current) {
      outcomes.push({
        user,
        timezone,
        action: 'skipped',
        reason: 'No assignment available after release window',
        monthKey: ensured.monthKey,
      });
      skipped += 1;
      continue;
    }

    if (ensured.current.notifiedAt) {
      outcomes.push({
        user,
        timezone,
        action: 'skipped',
        reason: 'Already notified this month',
        monthKey: ensured.current.monthKey,
        surpriseId: ensured.current.id,
      });
      skipped += 1;
      continue;
    }

    if (dryRun) {
      outcomes.push({
        user,
        timezone,
        action: 'sent',
        reason: 'dry-run',
        monthKey: ensured.current.monthKey,
        surpriseId: ensured.current.id,
      });
      sent += 1;
      continue;
    }

    const pushResult = await sendPushToUsers([user], {
      title: 'Surprise Generator',
      body: 'Your monthly surprise is ready.',
      icon: '/icons/icon-192.png',
      url: '/surprises',
      tag: `surprises-${ensured.current.monthKey}-${user}`,
    });

    if (!pushResult.success) {
      outcomes.push({
        user,
        timezone,
        action: 'failed',
        reason: pushResult.reason ?? 'Push delivery failed',
        monthKey: ensured.current.monthKey,
        surpriseId: ensured.current.id,
      });
      failed += 1;
      continue;
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('monthly_surprises')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', ensured.current.id)
      .eq('player', user);

    if (error) {
      outcomes.push({
        user,
        timezone,
        action: 'failed',
        reason: error.message,
        monthKey: ensured.current.monthKey,
        surpriseId: ensured.current.id,
      });
      failed += 1;
      continue;
    }

    outcomes.push({
      user,
      timezone,
      action: 'sent',
      reason: pushResult.reason ?? 'sent',
      monthKey: ensured.current.monthKey,
      surpriseId: ensured.current.id,
    });
    sent += pushResult.sent;
    failed += pushResult.failed;
    if (pushResult.skipped) {
      skipped += 1;
    }
  }

  return {
    success: failed === 0,
    dryRun,
    sent,
    failed,
    skipped,
    outcomes,
  } satisfies SurpriseAssignmentCronResult;
}

export function normalizeSearchPlayer(value: string | null) {
  return value ? normalizeKnownUser(value) : null;
}

export function describeTogetherTime(eventDate: string, now = new Date()) {
  const start = new Date(`${eventDate}T00:00:00`);
  const diffMs = now.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return null;
  }

  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const years = Math.floor(totalDays / 365);
  const months = Math.floor((totalDays % 365) / 30);
  const days = totalDays - years * 365 - months * 30;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (parts.length === 0 || (parts.length < 2 && days > 0)) {
    parts.push(`${days}d`);
  }

  return {
    totalDays,
    label: parts.slice(0, 2).join(' '),
  };
}

export function getDisplayMonthLabel(monthKey: string) {
  const { year, month } = parseMonthKey(monthKey);
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)));
}
