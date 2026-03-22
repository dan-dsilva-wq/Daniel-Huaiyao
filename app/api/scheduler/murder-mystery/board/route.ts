import { NextResponse } from 'next/server';

import {
  compareIsoDates,
  getScheduleWindow,
  toIsoDate,
} from '@/lib/scheduler/date-utils';
import {
  isSchedulerConfigured,
  listAvailability,
  listParticipants,
} from '@/lib/scheduler/server';
import type {
  ParticipantAvailability,
  PublicBoardResponse,
} from '@/lib/scheduler/types';

function emptyBoard(message?: string): PublicBoardResponse {
  const window = getScheduleWindow();

  return {
    configured: false,
    message,
    participants: [],
    window: {
      start: toIsoDate(window.start),
      end: toIsoDate(window.end),
    },
  };
}

export async function GET() {
  if (!isSchedulerConfigured()) {
    return NextResponse.json(
      emptyBoard(
        'Add SCHEDULER_SUPABASE_URL and SCHEDULER_SUPABASE_SERVICE_ROLE_KEY to enable the scheduler.'
      )
    );
  }

  try {
    const [participants, availability] = await Promise.all([
      listParticipants(),
      listAvailability(),
    ]);

    const byId = new Map<string, ParticipantAvailability>();

    for (const participant of participants) {
      byId.set(participant.id, {
        id: participant.id,
        name: participant.name,
        updatedAt: participant.updated_at,
        dates: [],
      });
    }

    for (const slot of availability) {
      const participant = byId.get(slot.participant_id);

      if (participant) {
        participant.dates.push(slot.day);
      }
    }

    const window = getScheduleWindow();
    const merged = [...byId.values()]
      .map((participant) => ({
        ...participant,
        dates: [...new Set(participant.dates)].sort(compareIsoDates),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return NextResponse.json({
      configured: true,
      participants: merged,
      window: {
        start: toIsoDate(window.start),
        end: toIsoDate(window.end),
      },
    } satisfies PublicBoardResponse);
  } catch (error) {
    return NextResponse.json(
      emptyBoard(
        error instanceof Error ? error.message : 'Could not load the board.'
      ),
      { status: 500 }
    );
  }
}
