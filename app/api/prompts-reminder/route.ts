import { NextResponse } from 'next/server';
import {
  getPreferredUserTimezones,
  hourInTimezone,
  sendPushToUsers,
  type KnownUser,
} from '@/lib/server/push';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';

type PromptReminderRow = {
  id: string;
  prompt_date: string;
  prompt_responses: Array<{ player: KnownUser }> | null;
};

function isDuplicateError(message: string) {
  return message.toLowerCase().includes('duplicate') || message.includes('23505');
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';

  try {
    const now = new Date();
    const supabase = getSupabaseAdmin();
    const thresholdDate = new Date(now);
    thresholdDate.setDate(thresholdDate.getDate() - 3);
    const threshold = thresholdDate.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('daily_prompts')
      .select('id, prompt_date, prompt_responses(player)')
      .lte('prompt_date', threshold)
      .order('prompt_date', { ascending: false })
      .limit(180);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch prompt backlog', details: error.message },
        { status: 500 }
      );
    }

    const pendingByUser: Record<KnownUser, PromptReminderRow[]> = {
      daniel: [],
      huaiyao: [],
    };

    for (const row of (data ?? []) as PromptReminderRow[]) {
      const responders = new Set((row.prompt_responses ?? []).map((response) => response.player));
      const danielAnswered = responders.has('daniel');
      const huaiyaoAnswered = responders.has('huaiyao');
      if (danielAnswered && !huaiyaoAnswered) {
        pendingByUser.huaiyao.push(row);
      } else if (huaiyaoAnswered && !danielAnswered) {
        pendingByUser.daniel.push(row);
      }
    }

    if (pendingByUser.daniel.length === 0 && pendingByUser.huaiyao.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No one-sided prompt responses older than 3 days',
        dryRun,
      });
    }

    const timezones = await getPreferredUserTimezones();
    const usersAtSendHour = (['daniel', 'huaiyao'] as KnownUser[]).filter(
      (user) => hourInTimezone(now, timezones[user]) === 9
    );

    if (usersAtSendHour.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No users are currently at local send hour',
        dryRun,
        timezones,
      });
    }

    const outcomes: Array<{
      user: KnownUser;
      sent: boolean;
      skipped: boolean;
      pendingCount: number;
      reason?: string;
    }> = [];

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const user of usersAtSendHour) {
      const pending = pendingByUser[user];
      if (pending.length === 0) {
        outcomes.push({
          user,
          sent: false,
          skipped: true,
          pendingCount: 0,
          reason: 'no-pending-prompts',
        });
        skipped += 1;
        continue;
      }

      const oldestPending = pending[pending.length - 1];
      if (!dryRun) {
        const { error: dedupeError } = await supabase.from('inactivity_reminder_log').insert({
          app_name: 'prompts',
          user_name: user,
          reference_key: oldestPending.id,
        });

        if (dedupeError) {
          if (isDuplicateError(dedupeError.message)) {
            outcomes.push({
              user,
              sent: false,
              skipped: true,
              pendingCount: pending.length,
              reason: 'already-sent-today',
            });
            skipped += 1;
            continue;
          }
          outcomes.push({
            user,
            sent: false,
            skipped: false,
            pendingCount: pending.length,
            reason: `dedupe-error:${dedupeError.message}`,
          });
          failed += 1;
          continue;
        }
      }

      const prettyDate = new Date(`${oldestPending.prompt_date}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      const pushResult = dryRun
        ? { success: true, sent: 1, failed: 0, skipped: false, reason: 'dry-run' }
        : await sendPushToUsers([user], {
            title: 'Daily Prompts',
            body: `You still have a prompt from ${prettyDate}. Answer to reveal both responses 💬`,
            icon: '/icons/icon-192.png',
            url: '/prompts',
            tag: 'prompts-inactivity-reminder',
          });

      if (!pushResult.success) {
        outcomes.push({
          user,
          sent: false,
          skipped: false,
          pendingCount: pending.length,
          reason: pushResult.reason ?? 'push-failed',
        });
        failed += 1;
        continue;
      }

      outcomes.push({
        user,
        sent: true,
        skipped: false,
        pendingCount: pending.length,
        reason: pushResult.reason,
      });
      sent += pushResult.sent;
      failed += pushResult.failed;
    }

    return NextResponse.json({
      success: true,
      dryRun,
      sent,
      failed,
      skipped,
      usersAtSendHour,
      pending: {
        daniel: pendingByUser.daniel.length,
        huaiyao: pendingByUser.huaiyao.length,
      },
      outcomes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to process prompts inactivity reminders',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
