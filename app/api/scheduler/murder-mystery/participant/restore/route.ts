import { NextResponse } from 'next/server';

import { compareIsoDates } from '@/lib/scheduler/date-utils';
import { hashEditorToken } from '@/lib/scheduler/editor-token';
import {
  getAvailabilityForParticipant,
  getParticipantById,
  isSchedulerConfigured,
} from '@/lib/scheduler/server';
import {
  normalizeEditorToken,
  normalizeParticipantId,
} from '@/lib/scheduler/request-validation';

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!isSchedulerConfigured()) {
    return errorResponse('Scheduler Supabase is not configured yet.', 503);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse('Please send valid JSON.');
  }

  try {
    const body = payload as Record<string, unknown>;
    const participantId = normalizeParticipantId(body.participantId);
    const editorToken = normalizeEditorToken(body.editorToken);
    const participant = await getParticipantById(participantId);

    if (
      !participant ||
      participant.editor_token_hash !== hashEditorToken(editorToken)
    ) {
      return errorResponse('That private edit link is invalid.', 403);
    }

    const dates = await getAvailabilityForParticipant(participantId);

    return NextResponse.json({
      participant: {
        id: participant.id,
        name: participant.name,
        updatedAt: participant.updated_at,
        dates: [...new Set(dates)].sort(compareIsoDates),
      },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Could not restore this card.',
      400
    );
  }
}
