import { NextResponse } from 'next/server';
import { schedulerBoards } from '@/lib/scheduler/boards';
import { isSchedulerConfigured, listParticipants } from '@/lib/scheduler/server';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';
import { listSurprisesForSearch, normalizeSearchPlayer } from '@/lib/server/surprises';

type SearchResult = {
  id: string;
  sourceApp: string;
  sourceLabel: string;
  title: string;
  snippet: string;
  route: string;
  matchedText: string;
  createdAt: string | null;
  isPrivate: boolean;
};

type RankedResult = SearchResult & {
  score: number;
  matchScore: number;
};

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function trimSnippet(value: string, max = 150) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}...`;
}

function scoreText(query: string, value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return 0;
  if (normalized === query) return 30;
  if (normalized.startsWith(query)) return 20;
  if (normalized.includes(query)) return 10;
  return 0;
}

function scoreCandidate(query: string, values: Array<string | null | undefined>) {
  let bestScore = 0;
  let matchedText = '';

  for (const value of values) {
    const score = scoreText(query, value);
    if (score > bestScore && value) {
      bestScore = score;
      matchedText = value;
    }
  }

  return { bestScore, matchedText };
}

function createdAtValue(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

function pushIfMatch(
  results: RankedResult[],
  query: string,
  result: SearchResult,
  fields: Array<string | null | undefined>
) {
  const { bestScore, matchedText } = scoreCandidate(query, fields);
  if (bestScore === 0) return;
  results.push({
    ...result,
    matchedText,
    score: bestScore * 1_000_000 + createdAtValue(result.createdAt),
    matchScore: bestScore,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const player = normalizeSearchPlayer(url.searchParams.get('player'));
  const rawQuery = url.searchParams.get('q')?.trim() ?? '';

  if (!player) {
    return NextResponse.json({ error: 'Missing or invalid player' }, { status: 400 });
  }

  if (rawQuery.length < 2) {
    return NextResponse.json({ query: rawQuery, results: [] });
  }

  const query = rawQuery.toLowerCase();

  try {
    const supabase = getSupabaseAdmin();
    const [todayPromptResult, promptHistoryResult, gratitudeResult, memoriesResult, mapResult, countdownResult, dateIdeasResult, bookResult, surpriseHistory] = await Promise.all([
      supabase.rpc('get_daily_prompt', { p_player: player }),
      supabase.rpc('get_prompt_history', { p_player: player, p_limit: 365 }),
      supabase
        .from('gratitude_notes')
        .select('id, note_text, created_at, from_player, to_player')
        .order('created_at', { ascending: false })
        .limit(250),
      supabase
        .from('memories')
        .select('id, title, description, memory_date, created_at')
        .order('memory_date', { ascending: false })
        .limit(250),
      supabase
        .from('map_places')
        .select('id, name, country, created_at')
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('important_dates')
        .select('id, title, event_date, created_at')
        .order('event_date', { ascending: false })
        .limit(200),
      supabase
        .from('date_ideas')
        .select('id, title, description, created_at')
        .order('created_at', { ascending: false })
        .limit(250),
      supabase
        .from('book_sentences')
        .select('id, content, writer, created_at')
        .order('created_at', { ascending: false })
        .limit(400),
      listSurprisesForSearch(player, 18),
    ]);

    const errors = [
      todayPromptResult.error,
      promptHistoryResult.error,
      gratitudeResult.error,
      memoriesResult.error,
      mapResult.error,
      countdownResult.error,
      dateIdeasResult.error,
      bookResult.error,
    ].filter(Boolean);

    if (errors.length > 0) {
      throw new Error(errors[0]?.message ?? 'Search data query failed');
    }

    const results: RankedResult[] = [];

    const promptItems = [
      ...((todayPromptResult.data ?? []) as Array<{
        daily_prompt_id: string;
        prompt_text: string;
        prompt_date: string;
        my_response: string | null;
        partner_response: string | null;
      }>),
      ...((promptHistoryResult.data ?? []) as Array<{
        daily_prompt_id: string;
        prompt_text: string;
        prompt_date: string;
        my_response: string | null;
        partner_response: string | null;
      }>),
    ];

    const promptSeen = new Set<string>();
    for (const prompt of promptItems) {
      if (promptSeen.has(prompt.daily_prompt_id)) continue;
      promptSeen.add(prompt.daily_prompt_id);
      pushIfMatch(results, query, {
        id: prompt.daily_prompt_id,
        sourceApp: 'prompts',
        sourceLabel: 'Daily Prompts',
        title: prompt.prompt_text,
        snippet: trimSnippet(prompt.my_response || prompt.partner_response || prompt.prompt_text),
        route: '/prompts',
        matchedText: '',
        createdAt: prompt.prompt_date,
        isPrivate: true,
      }, [prompt.prompt_text, prompt.my_response, prompt.partner_response]);
    }

    for (const note of (gratitudeResult.data ?? []) as Array<{
      id: string;
      note_text: string;
      created_at: string;
      from_player: string;
      to_player: string;
    }>) {
      if (note.from_player !== player && note.to_player !== player) continue;
      pushIfMatch(results, query, {
        id: note.id,
        sourceApp: 'gratitude',
        sourceLabel: 'Gratitude Wall',
        title: note.to_player === player ? 'Received note' : 'Sent note',
        snippet: trimSnippet(note.note_text),
        route: '/gratitude',
        matchedText: '',
        createdAt: note.created_at,
        isPrivate: true,
      }, [note.note_text]);
    }

    for (const memory of (memoriesResult.data ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
      memory_date: string;
      created_at: string;
    }>) {
      pushIfMatch(results, query, {
        id: memory.id,
        sourceApp: 'memories',
        sourceLabel: 'Memories',
        title: memory.title,
        snippet: trimSnippet(memory.description || memory.title),
        route: '/memories',
        matchedText: '',
        createdAt: memory.memory_date || memory.created_at,
        isPrivate: false,
      }, [memory.title, memory.description]);
    }

    for (const place of (mapResult.data ?? []) as Array<{
      id: string;
      name: string;
      country: string | null;
      created_at: string;
    }>) {
      const label = place.country ? `${place.name}, ${place.country}` : place.name;
      pushIfMatch(results, query, {
        id: place.id,
        sourceApp: 'map',
        sourceLabel: 'Map',
        title: place.name,
        snippet: trimSnippet(label),
        route: '/map',
        matchedText: '',
        createdAt: place.created_at,
        isPrivate: false,
      }, [place.name, place.country]);
    }

    for (const event of (countdownResult.data ?? []) as Array<{
      id: string;
      title: string;
      event_date: string;
      created_at: string;
    }>) {
      pushIfMatch(results, query, {
        id: event.id,
        sourceApp: 'countdown',
        sourceLabel: 'Countdown',
        title: event.title,
        snippet: trimSnippet(event.title),
        route: '/countdown',
        matchedText: '',
        createdAt: event.event_date || event.created_at,
        isPrivate: false,
      }, [event.title]);
    }

    for (const idea of (dateIdeasResult.data ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
      created_at: string;
    }>) {
      pushIfMatch(results, query, {
        id: idea.id,
        sourceApp: 'dates',
        sourceLabel: 'Date Ideas',
        title: idea.title,
        snippet: trimSnippet(idea.description || idea.title),
        route: '/dates',
        matchedText: '',
        createdAt: idea.created_at,
        isPrivate: false,
      }, [idea.title, idea.description]);
    }

    for (const sentence of (bookResult.data ?? []) as Array<{
      id: string;
      content: string;
      writer: string;
      created_at: string;
    }>) {
      pushIfMatch(results, query, {
        id: sentence.id,
        sourceApp: 'book',
        sourceLabel: 'Story Book',
        title: sentence.writer === 'daniel' ? 'Daniel wrote' : 'Huaiyao wrote',
        snippet: trimSnippet(sentence.content),
        route: '/book',
        matchedText: '',
        createdAt: sentence.created_at,
        isPrivate: false,
      }, [sentence.content]);
    }

    for (const surprise of surpriseHistory) {
      pushIfMatch(results, query, {
        id: surprise.id,
        sourceApp: 'surprises',
        sourceLabel: 'Surprise Generator',
        title: `Secret task for ${surprise.monthKey}`,
        snippet: trimSnippet(surprise.ideaText),
        route: '/surprises',
        matchedText: '',
        createdAt: surprise.generatedAt,
        isPrivate: true,
      }, [surprise.ideaText, surprise.category, surprise.monthKey]);
    }

    const schedulerParticipants = isSchedulerConfigured()
      ? await (async () => {
          try {
            const participants = await listParticipants();
            return participants.map((participant) => participant.name);
          } catch {
            return [] as string[];
          }
        })()
      : [];

    for (const board of schedulerBoards) {
      const boardFields = [
        board.title,
        board.summary,
        board.heroDescription,
        ...schedulerParticipants,
      ];
      pushIfMatch(results, query, {
        id: board.slug,
        sourceApp: 'scheduler',
        sourceLabel: 'Scheduler',
        title: board.title,
        snippet: trimSnippet(
          schedulerParticipants.length > 0
            ? `${board.summary} Participants: ${schedulerParticipants.join(', ')}`
            : board.summary
        ),
        route: board.href,
        matchedText: '',
        createdAt: null,
        isPrivate: false,
      }, boardFields);
    }

    const unique = new Map<string, RankedResult>();
    for (const result of results) {
      const key = `${result.sourceApp}:${result.id}`;
      const existing = unique.get(key);
      if (!existing || result.score > existing.score) {
        unique.set(key, result);
      }
    }

    const sorted = Array.from(unique.values())
      .sort((left, right) => {
        if (left.matchScore !== right.matchScore) {
          return right.matchScore - left.matchScore;
        }
        return right.score - left.score;
      })
      .slice(0, 30)
      .map((result) => ({
        id: result.id,
        sourceApp: result.sourceApp,
        sourceLabel: result.sourceLabel,
        title: result.title,
        snippet: result.snippet,
        route: result.route,
        matchedText: result.matchedText,
        createdAt: result.createdAt,
        isPrivate: result.isPrivate,
      }));

    return NextResponse.json({
      query: rawQuery,
      results: sorted,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to search app content',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
