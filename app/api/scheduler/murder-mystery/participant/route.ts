import { NextResponse } from 'next/server';

import { compareIsoDates } from '@/lib/scheduler/date-utils';
import {
  generateEditorToken,
  hashEditorToken,
} from '@/lib/scheduler/editor-token';
import {
  createParticipant,
  deleteParticipant,
  getParticipantById,
  getParticipantByName,
  isSchedulerConfigured,
  replaceAvailability,
  updateParticipant,
} from '@/lib/scheduler/server';
import {
  normalizeDates,
  normalizeEditorToken,
  normalizeName,
  normalizeParticipantId,
} from '@/lib/scheduler/request-validation';
import type { ParticipantAvailability } from '@/lib/scheduler/types';

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function participantPayload(
  participant: { id: string; name: string; updated_at: string },
  dates: string[]
): ParticipantAvailability {
  return {
    id: participant.id,
    name: participant.name,
    updatedAt: participant.updated_at,
    dates: [...new Set(dates)].sort(compareIsoDates),
  };
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
    const name = normalizeName(body.name);
    const dates = normalizeDates(body.dates);
    const existingParticipant = await getParticipantByName(name);

    if (existingParticipant) {
      const updatedParticipant = await updateParticipant(existingParticipant.id, name);
      await replaceAvailability(existingParticipant.id, dates);

      return NextResponse.json({
        participant: participantPayload(updatedParticipant, dates),
      });
    }

    const editorTokenHash = hashEditorToken(generateEditorToken());

    let participant:
      | {
          id: string;
          name: string;
          updated_at: string;
        }
      | undefined;

    try {
      participant = await createParticipant(name, editorTokenHash);
      await replaceAvailability(participant.id, dates);
    } catch (error) {
      if (participant) {
        await deleteParticipant(participant.id).catch(() => undefined);
      }

      throw error;
    }

    if (!participant) {
      throw new Error('Could not save these dates.');
    }

    return NextResponse.json({
      participant: participantPayload(participant, dates),
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Could not save these dates.',
      400
    );
  }
}

export async function PUT(request: Request) {
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
    const name = normalizeName(body.name);
    const dates = normalizeDates(body.dates);
    const participant = await getParticipantById(participantId);

    if (
      !participant ||
      participant.editor_token_hash !== hashEditorToken(editorToken)
    ) {
      return errorResponse('That private edit link is invalid.', 403);
    }

    const updatedParticipant = await updateParticipant(participantId, name);
    await replaceAvailability(participantId, dates);

    return NextResponse.json({
      participant: participantPayload(updatedParticipant, dates),
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : 'Could not update this card.',
      400
    );
  }
}
