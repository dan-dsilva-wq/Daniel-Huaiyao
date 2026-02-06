import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

let vapidConfigured = false;

function ensureVapidConfigured() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    webpush.setVapidDetails(
      'mailto:notifications@daniel-huaiyao.vercel.app',
      publicKey,
      privateKey
    );
    vapidConfigured = true;
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// This endpoint is called by a cron job daily to remind storybook contributors
export async function GET(request: Request) {
  ensureVapidConfigured();

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
    const whoseTurn = lastSentence.writer === 'daniel' ? 'huaiyao' : 'daniel';
    const partnerName = lastSentence.writer === 'daniel' ? 'Daniel' : 'Huaiyao';

    // Fetch push subscriptions for the person whose turn it is
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_name')
      .eq('user_name', whoseTurn);

    if (subError) {
      console.error('Error fetching subscriptions:', subError);
      return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `No push subscriptions for ${whoseTurn}`,
        whoseTurn
      });
    }

    // Send notifications
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const payload = JSON.stringify({
          title: 'Story Book',
          body: `It's been ${daysSince} days — ${partnerName} is waiting for your next line`,
          icon: '/icons/icon-192.png',
          url: '/book',
          tag: 'book-turn-reminder',
        });

        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(pushSubscription, payload);
          return { success: true, user: sub.user_name };
        } catch (error: unknown) {
          const webPushError = error as { statusCode?: number };
          if (webPushError.statusCode === 410 || webPushError.statusCode === 404) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', sub.endpoint);
          }
          throw error;
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return NextResponse.json({
      success: true,
      sent: successful,
      failed: failed,
      whoseTurn,
      daysSince
    });
  } catch (error) {
    console.error('Book reminder error:', error);
    return NextResponse.json({ error: 'Failed to send reminder' }, { status: 500 });
  }
}
