import { createClient } from '@supabase/supabase-js';

type ParticipantRow = {
  id: string;
  name: string;
  updated_at: string;
  editor_token_hash?: string | null;
};

type AvailabilityRow = {
  participant_id: string;
  day: string;
};

function getConfig() {
  const supabaseUrl = process.env.SCHEDULER_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SCHEDULER_SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing SCHEDULER_SUPABASE_URL or SCHEDULER_SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

export function isSchedulerConfigured(): boolean {
  return Boolean(
    process.env.SCHEDULER_SUPABASE_URL &&
      process.env.SCHEDULER_SUPABASE_SERVICE_ROLE_KEY
  );
}

function createSchedulerClient() {
  const { supabaseUrl, serviceRoleKey } = getConfig();

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function listParticipants(): Promise<ParticipantRow[]> {
  const supabase = createSchedulerClient();
  const { data, error } = await supabase
    .from('participants')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ParticipantRow[];
}

export async function listAvailability(): Promise<AvailabilityRow[]> {
  const supabase = createSchedulerClient();
  const { data, error } = await supabase
    .from('availability')
    .select('participant_id, day')
    .order('day', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AvailabilityRow[];
}

export async function getParticipantById(
  participantId: string
): Promise<ParticipantRow | null> {
  const supabase = createSchedulerClient();
  const { data, error } = await supabase
    .from('participants')
    .select('id, name, updated_at, editor_token_hash')
    .eq('id', participantId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as ParticipantRow | null;
}

export async function getParticipantByName(
  name: string
): Promise<ParticipantRow | null> {
  const supabase = createSchedulerClient();
  const { data, error } = await supabase
    .from('participants')
    .select('id, name, updated_at, editor_token_hash')
    .eq('name', name)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as ParticipantRow | null;
}

export async function getAvailabilityForParticipant(
  participantId: string
): Promise<string[]> {
  const supabase = createSchedulerClient();
  const { data, error } = await supabase
    .from('availability')
    .select('day')
    .eq('participant_id', participantId)
    .order('day', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => row.day as string);
}

export async function createParticipant(
  name: string,
  editorTokenHash: string
): Promise<ParticipantRow> {
  const supabase = createSchedulerClient();
  const { data, error } = await supabase
    .from('participants')
    .insert({
      name,
      editor_token_hash: editorTokenHash,
    })
    .select('id, name, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ParticipantRow;
}

export async function updateParticipant(
  participantId: string,
  name: string
): Promise<ParticipantRow> {
  const supabase = createSchedulerClient();
  const { data, error } = await supabase
    .from('participants')
    .update({
      name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', participantId)
    .select('id, name, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ParticipantRow;
}

export async function replaceAvailability(
  participantId: string,
  dates: string[]
): Promise<void> {
  const supabase = createSchedulerClient();
  const { error: deleteError } = await supabase
    .from('availability')
    .delete()
    .eq('participant_id', participantId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (dates.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from('availability').insert(
    dates.map((date) => ({
      participant_id: participantId,
      day: date,
    }))
  );

  if (insertError) {
    throw new Error(insertError.message);
  }
}

export async function deleteParticipant(participantId: string): Promise<void> {
  const supabase = createSchedulerClient();
  const { error } = await supabase
    .from('participants')
    .delete()
    .eq('id', participantId);

  if (error) {
    throw new Error(error.message);
  }
}
