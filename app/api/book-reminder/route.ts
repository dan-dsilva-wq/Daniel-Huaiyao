import { NextResponse } from 'next/server';
import {
  getPreferredUserTimezones,
  hourInTimezone,
  sendPushToUsers,
  type KnownUser,
} from '@/lib/server/push';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';

function isDuplicateError(message: string) {
  return message.toLowerCase().includes('duplicate') || message.includes('23505');
}

// This endpoint is called by a cron job to remind storybook contributors.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';

  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    // Get the most recent sentence
    const { data: lastSentence, error: sentenceError } = await supabase
      .from('book_sentences')
      .select('id, writer, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (sentenceError || !lastSentence) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No sentences yet'
      });
    }

    // Check if it's been 3+ days since the last sentence
    const lastWrittenAt = new Date(lastSentence.created_at);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - lastWrittenAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSince < 3) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `Only ${daysSince} day(s) since last sentence`
      });
    }

    // Determine whose turn it is (opposite of last writer)
    const whoseTurn: KnownUser = lastSentence.writer === 'daniel' ? 'huaiyao' : 'daniel';
    const partnerName = lastSentence.writer === 'daniel' ? 'Daniel' : 'Huaiyao';
    const timezones = await getPreferredUserTimezones();
    if (hourInTimezone(now, timezones[whoseTurn]) !== 9) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `${whoseTurn} is not at local 09:00 yet`,
        timezone: timezones[whoseTurn],
        dryRun,
      });
    }

    const referenceKey = `${lastSentence.id}:${lastSentence.created_at}`;
    if (!dryRun) {
      const { error: dedupeError } = await supabase.from('inactivity_reminder_log').insert({
        app_name: 'book',
        user_name: whoseTurn,
        reference_key: referenceKey,
      });

      if (dedupeError) {
        if (isDuplicateError(dedupeError.message)) {
          return NextResponse.json({
            success: true,
            skipped: true,
            reason: 'Book inactivity reminder already sent today',
            whoseTurn,
            daysSince,
          });
        }
        return NextResponse.json(
          {
            error: 'Failed to write inactivity reminder dedupe log',
            details: dedupeError.message,
          },
          { status: 500 }
        );
      }
    }

    const pushResult = dryRun
      ? { success: true, sent: 1, failed: 0, skipped: false, reason: 'dry-run' }
      : await sendPushToUsers([whoseTurn], {
          title: 'Story Book',
          body: `It's been ${daysSince} days — ${partnerName} is waiting for your next line`,
          icon: '/icons/icon-192.png',
          url: '/book',
          tag: 'book-turn-reminder',
        });

    if (!pushResult.success) {
      return NextResponse.json(
        {
          error: 'Failed to send reminder',
          details: pushResult.reason,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sent: pushResult.sent,
      failed: pushResult.failed,
      skipped: pushResult.skipped,
      reason: pushResult.reason,
      whoseTurn,
      daysSince,
      dryRun,
    });
  } catch (error) {
    console.error('Book reminder error:', error);
    return NextResponse.json({ error: 'Failed to send reminder' }, { status: 500 });
  }
}
