import { NextResponse } from 'next/server';
import {
  getSurprisePageData,
  normalizeSearchPlayer,
  updateMonthlySurpriseStatus,
} from '@/lib/server/surprises';
import { normalizeTimezone } from '@/lib/server/push';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const player = normalizeSearchPlayer(url.searchParams.get('player'));
  if (!player) {
    return NextResponse.json({ error: 'Missing or invalid player' }, { status: 400 });
  }

  const timezone = url.searchParams.get('timezone');

  try {
    const data = await getSurprisePageData(player, timezone ? normalizeTimezone(timezone) : null);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load surprises',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as {
      player?: string;
      surpriseId?: string;
      status?: 'pending' | 'done' | 'skipped';
    };
    const player = normalizeSearchPlayer(body.player ?? null);
    if (!player || !body.surpriseId || !body.status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const updated = await updateMonthlySurpriseStatus({
      player,
      surpriseId: body.surpriseId,
      status: body.status,
    });

    return NextResponse.json({ surprise: updated });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to update surprise status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
