import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';
import {
  describeTogetherTime,
  ensureMonthlySurpriseForPlayer,
  normalizeSearchPlayer,
} from '@/lib/server/surprises';
import { normalizeTimezone } from '@/lib/server/push';

type EngagementRow = {
  flashbacks?: unknown[];
  partner_activity?: unknown[];
  shared_streak?: unknown;
  partner_presence?: unknown;
  partner_watching?: unknown[];
};

type CountdownRow = {
  id: string;
  title: string;
  emoji: string | null;
  days_until: number;
  next_occurrence: string;
  category?: string | null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const player = normalizeSearchPlayer(url.searchParams.get('player'));
  if (!player) {
    return NextResponse.json({ error: 'Missing or invalid player' }, { status: 400 });
  }

  const requestedTimezone = url.searchParams.get('timezone');

  try {
    const supabase = getSupabaseAdmin();
    const [
      engagementResult,
      promptResult,
      gratitudeResult,
      countdownResult,
      memoryResult,
      countriesResult,
      anniversaryResult,
      surpriseResult,
    ] = await Promise.all([
      supabase.rpc('get_home_engagement_data', { p_player: player }),
      supabase.rpc('get_daily_prompt', { p_player: player }),
      supabase
        .from('gratitude_notes')
        .select('id, note_text, created_at, from_player, emoji, category')
        .eq('to_player', player)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc('get_important_dates'),
      supabase
        .from('memories')
        .select('id, title, memory_date, created_at')
        .order('memory_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('map_places')
        .select('id', { count: 'exact', head: true })
        .eq('daniel_status', 'visited')
        .eq('huaiyao_status', 'visited'),
      supabase
        .from('important_dates')
        .select('id, title, event_date, emoji, created_at')
        .eq('category', 'anniversary')
        .order('event_date', { ascending: true })
        .limit(1)
        .maybeSingle(),
      ensureMonthlySurpriseForPlayer({
        player,
        preferredTimezone: requestedTimezone ? normalizeTimezone(requestedTimezone) : null,
      }),
    ]);

    if (engagementResult.error) {
      throw new Error(engagementResult.error.message);
    }
    if (promptResult.error) {
      throw new Error(promptResult.error.message);
    }
    if (countdownResult.error) {
      throw new Error(countdownResult.error.message);
    }
    if (gratitudeResult.error) {
      throw new Error(gratitudeResult.error.message);
    }
    if (memoryResult.error) {
      throw new Error(memoryResult.error.message);
    }
    if (countriesResult.error) {
      throw new Error(countriesResult.error.message);
    }
    if (anniversaryResult.error) {
      throw new Error(anniversaryResult.error.message);
    }

    const engagementRow = ((engagementResult.data ?? [])[0] ?? null) as EngagementRow | null;
    const promptRow = ((promptResult.data ?? [])[0] ?? null) as {
      daily_prompt_id: string;
      prompt_text: string;
      prompt_date: string;
      category_name: string;
      category_emoji: string;
    } | null;
    const nextEvent = ((countdownResult.data ?? []) as CountdownRow[])
      .filter((row) => row.days_until >= 0)
      .sort((left, right) => {
        if (left.days_until !== right.days_until) {
          return left.days_until - right.days_until;
        }
        return left.next_occurrence.localeCompare(right.next_occurrence);
      })[0] ?? null;
    const anniversary = anniversaryResult.data as {
      id: string;
      title: string;
      event_date: string;
      emoji: string | null;
      created_at: string;
    } | null;
    const togetherTime = anniversary ? describeTogetherTime(anniversary.event_date) : null;

    return NextResponse.json({
      player,
      timezone: surpriseResult.timezone,
      widgets: {
        dailyPrompt: promptRow
          ? {
              id: promptRow.daily_prompt_id,
              text: promptRow.prompt_text,
              promptDate: promptRow.prompt_date,
              categoryName: promptRow.category_name,
              categoryEmoji: promptRow.category_emoji,
              route: '/prompts',
            }
          : null,
        gratitudeNote: gratitudeResult.data
          ? {
              id: gratitudeResult.data.id,
              text: gratitudeResult.data.note_text,
              emoji: gratitudeResult.data.emoji,
              category: gratitudeResult.data.category,
              fromPlayer: gratitudeResult.data.from_player,
              createdAt: gratitudeResult.data.created_at,
              route: '/gratitude',
            }
          : null,
        nextEvent: nextEvent
          ? {
              id: nextEvent.id,
              title: nextEvent.title,
              emoji: nextEvent.emoji,
              daysUntil: nextEvent.days_until,
              nextOccurrence: nextEvent.next_occurrence,
              route: '/countdown',
            }
          : null,
        latestMemory: memoryResult.data
          ? {
              id: memoryResult.data.id,
              title: memoryResult.data.title,
              memoryDate: memoryResult.data.memory_date,
              createdAt: memoryResult.data.created_at,
              route: '/memories',
            }
          : null,
        countriesVisitedTogether: {
          count: countriesResult.count ?? 0,
          route: '/map',
        },
        togetherSince: anniversary
          ? {
              id: anniversary.id,
              title: anniversary.title,
              emoji: anniversary.emoji,
              eventDate: anniversary.event_date,
              totalDays: togetherTime?.totalDays ?? null,
              label: togetherTime?.label ?? null,
              route: '/countdown',
            }
          : null,
        surprise: surpriseResult.current
          ? {
              id: surpriseResult.current.id,
              monthKey: surpriseResult.current.monthKey,
              status: surpriseResult.current.status,
              ideaText: surpriseResult.current.ideaText,
              category: surpriseResult.current.category,
              route: '/surprises',
            }
          : null,
      },
      engagement: {
        flashbacks: engagementRow?.flashbacks ?? [],
        partner_activity: engagementRow?.partner_activity ?? [],
        shared_streak: engagementRow?.shared_streak ?? null,
        partner_presence: engagementRow?.partner_presence ?? null,
        partner_watching: engagementRow?.partner_watching ?? [],
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to build home dashboard',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
