import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

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

const QUIET_HOURS_START = 23;
const QUIET_HOURS_END = 9;
const TIMEZONE = 'America/New_York';

function isWithinAllowedHours() {
  const now = new Date();
  const hour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }), 10);
  return hour >= QUIET_HOURS_END && hour < QUIET_HOURS_START;
}

const cadenceLabel: Record<string, string> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
};

export async function GET() {
  try {
    if (!isWithinAllowedHours()) {
      return NextResponse.json({ success: true, skipped: true, reason: 'Outside allowed hours' });
    }

    const now = new Date().toISOString();
    const { data: tracks, error: tracksError } = await supabase
      .from('surprise_tracks')
      .select('id, user_name, cadence, next_available_at, last_notified_ready_at, last_generated_at')
      .not('last_generated_at', 'is', null)
      .lte('next_available_at', now);

    if (tracksError) {
      throw tracksError;
    }

    const dueTracks = (tracks || []).filter((track) => {
      if (!track.next_available_at) return false;
      if (!track.last_notified_ready_at) return true;
      return new Date(track.last_notified_ready_at).getTime() < new Date(track.next_available_at).getTime();
    });

    if (dueTracks.length === 0) {
      return NextResponse.json({ success: true, sent: 0 });
    }

    const groupedByUser = dueTracks.reduce<Record<string, typeof dueTracks>>((acc, track) => {
      acc[track.user_name] ||= [];
      acc[track.user_name].push(track);
      return acc;
    }, {});

    let sent = 0;

    for (const [userName, userTracks] of Object.entries(groupedByUser)) {
      const { data: subscriptions, error: subError } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_name', userName);

      if (subError || !subscriptions || subscriptions.length === 0) {
        continue;
      }

      const label = userTracks.length === 1
        ? `Your ${cadenceLabel[userTracks[0].cadence]} surprise is ready`
        : `${userTracks.length} surprise slots are ready`;

      const payload = JSON.stringify({
        title: 'Surprise Generator',
        body: label,
        icon: '/icons/icon-192.png',
        url: '/surprises',
        tag: `surprise-ready-${userName}`,
      });

      const results = await Promise.allSettled(
        subscriptions.map(async (subscription) => {
          const pushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          };

          try {
            await webpush.sendNotification(pushSubscription, payload);
          } catch (error: unknown) {
            const webPushError = error as { statusCode?: number };
            if (webPushError.statusCode === 410 || webPushError.statusCode === 404) {
              await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
            }
            throw error;
          }
        })
      );

      const anySucceeded = results.some((result) => result.status === 'fulfilled');
      if (anySucceeded) {
        sent += 1;
        await supabase
          .from('surprise_tracks')
          .update({ last_notified_ready_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .in('id', userTracks.map((track) => track.id));
      }
    }

    return NextResponse.json({ success: true, sent });
  } catch (error) {
    console.error('Surprise notification error:', error);
    return NextResponse.json({ error: 'Failed to send surprise notifications' }, { status: 500 });
  }
}
