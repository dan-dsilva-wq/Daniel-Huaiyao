import { NextResponse } from 'next/server';
import {
  hourInTimezone,
  sendPushToUsers,
  type KnownUser,
  getPreferredUserTimezones,
} from '@/lib/server/push';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';

const REMINDER_DAYS = new Set([7, 3, 1, 0]);
const TARGET_HOUR = 9;

type CountdownEvent = {
  id: string;
  title: string;
  emoji: string | null;
  days_until: number;
  next_occurrence: string;
};

function isDuplicateError(errorMessage: string) {
  return errorMessage.toLowerCase().includes('duplicate') || errorMessage.includes('23505');
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date();

    const { data, error } = await supabase.rpc('get_important_dates');
    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch important dates', details: error.message },
        { status: 500 }
      );
    }

    const candidates = ((data ?? []) as CountdownEvent[]).filter((event) =>
      REMINDER_DAYS.has(event.days_until)
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No countdown reminder candidates',
        dryRun,
      });
    }

    const timezones = await getPreferredUserTimezones();
    const users: KnownUser[] = ['daniel', 'huaiyao'];
    const usersAtSendHour = users.filter(
      (user) => hourInTimezone(now, timezones[user]) === TARGET_HOUR
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
      eventId: string;
      title: string;
      daysUntil: number;
      sent: boolean;
      skipped: boolean;
      reason?: string;
    }> = [];

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const user of usersAtSendHour) {
      for (const event of candidates) {
        const duplicateKey = {
          event_id: event.id,
          user_name: user,
          reminder_days: event.days_until,
          occurrence_date: event.next_occurrence,
        };

        if (!dryRun) {
          const { error: insertError } = await supabase
            .from('countdown_reminder_log')
            .insert(duplicateKey);
          if (insertError) {
            if (isDuplicateError(insertError.message)) {
              outcomes.push({
                user,
                eventId: event.id,
                title: event.title,
                daysUntil: event.days_until,
                sent: false,
                skipped: true,
                reason: 'already-sent',
              });
              skipped += 1;
              continue;
            }
            outcomes.push({
              user,
              eventId: event.id,
              title: event.title,
              daysUntil: event.days_until,
              sent: false,
              skipped: false,
              reason: `log-error:${insertError.message}`,
            });
            failed += 1;
            continue;
          }
        }

        const whenText =
          event.days_until === 0
            ? 'is today'
            : event.days_until === 1
            ? 'is tomorrow'
            : `is in ${event.days_until} days`;
        const icon = event.emoji ? `${event.emoji} ` : '';
        const pushResult = dryRun
          ? { success: true, sent: 1, failed: 0, skipped: false, reason: 'dry-run' }
          : await sendPushToUsers([user], {
              title: 'Countdown Reminder',
              body: `${icon}${event.title} ${whenText}`,
              icon: '/icons/icon-192.png',
              url: '/countdown',
              tag: `countdown-${event.id}-${event.days_until}`,
            });

        if (!pushResult.success) {
          outcomes.push({
            user,
            eventId: event.id,
            title: event.title,
            daysUntil: event.days_until,
            sent: false,
            skipped: false,
            reason: pushResult.reason ?? 'push-failed',
          });
          failed += 1;
          continue;
        }

        outcomes.push({
          user,
          eventId: event.id,
          title: event.title,
          daysUntil: event.days_until,
          sent: true,
          skipped: false,
          reason: pushResult.reason,
        });
        sent += pushResult.sent;
        failed += pushResult.failed;
        skipped += pushResult.skipped ? 1 : 0;
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      sent,
      failed,
      skipped,
      usersAtSendHour,
      timezones,
      candidates: candidates.length,
      outcomes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to process countdown reminders',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
