import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;

webpush.setVapidDetails(
  'mailto:notifications@daniel-huaiyao.vercel.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// This endpoint is called by a cron job at 8 PM Eastern
export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Check who wrote gratitude today
    const today = new Date().toISOString().split('T')[0];

    const { data: todayNotes, error: notesError } = await supabase
      .from('gratitude_notes')
      .select('from_player')
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59`);

    if (notesError) {
      console.error('Error checking gratitude notes:', notesError);
      return NextResponse.json({ error: 'Failed to check notes' }, { status: 500 });
    }

    // Who has already written today?
    const wroteToday = new Set(todayNotes?.map(n => n.from_player) || []);
    const needsReminder: string[] = [];

    if (!wroteToday.has('daniel')) needsReminder.push('daniel');
    if (!wroteToday.has('huaiyao')) needsReminder.push('huaiyao');

    if (needsReminder.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Both have written gratitude today'
      });
    }

    // Get subscriptions only for those who haven't written
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_name')
      .in('user_name', needsReminder);

    if (subError) {
      console.error('Error fetching subscriptions:', subError);
      return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No push subscriptions for users who need reminder',
        needsReminder
      });
    }

    // Send personalized reminders
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const partnerName = sub.user_name === 'daniel' ? 'Huaiyao' : 'Daniel';

        const payload = JSON.stringify({
          title: 'Gratitude Wall',
          body: `Take a moment to share gratitude with ${partnerName} 💝`,
          icon: '/icons/icon-192.png',
          url: '/gratitude',
          tag: 'gratitude-reminder',
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
      remindedUsers: needsReminder
    });
  } catch (error) {
    console.error('Gratitude reminder error:', error);
    return NextResponse.json({ error: 'Failed to send reminder' }, { status: 500 });
  }
}
