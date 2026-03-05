import { NextResponse } from 'next/server';
import { sendPushToUsers, type KnownUser } from '@/lib/server/push';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';

// This endpoint is called by a cron job daily to remind storybook contributors
export async function GET(request: Request) {
  const supabase = getSupabaseAdmin();

  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get the most recent sentence
    const { data: lastSentence, error: sentenceError } = await supabase
      .from('book_sentences')
      .select('writer, created_at')
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

    // Check if it's been 2+ days since the last sentence
    const lastWrittenAt = new Date(lastSentence.created_at);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - lastWrittenAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSince < 2) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `Only ${daysSince} day(s) since last sentence`
      });
    }

    // Determine whose turn it is (opposite of last writer)
    const whoseTurn: KnownUser = lastSentence.writer === 'daniel' ? 'huaiyao' : 'daniel';
    const partnerName = lastSentence.writer === 'daniel' ? 'Daniel' : 'Huaiyao';
    const pushResult = await sendPushToUsers([whoseTurn], {
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
      daysSince
    });
  } catch (error) {
    console.error('Book reminder error:', error);
    return NextResponse.json({ error: 'Failed to send reminder' }, { status: 500 });
  }
}
