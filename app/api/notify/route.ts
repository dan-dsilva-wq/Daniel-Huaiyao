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

// Quiet hours: only send between 9 AM and 11 PM (Eastern Time)
const QUIET_HOURS_START = 23; // 11 PM
const QUIET_HOURS_END = 9;    // 9 AM
const TIMEZONE = 'America/New_York';

function isWithinAllowedHours(): boolean {
  const now = new Date();
  const hour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));
  return hour >= QUIET_HOURS_END && hour < QUIET_HOURS_START;
}

type ActionType = 'added' | 'removed' | 'completed' | 'uncompleted' | 'question_added' | 'question_answered' | 'place_added' | 'place_visited' | 'mystery_started' | 'mystery_waiting' | 'mystery_agreed' | 'memory_added' | 'gratitude_sent' | 'chat_message' | 'book_sentence';

const ACTION_MESSAGES: Record<ActionType, string> = {
  added: 'added a new date idea',
  removed: 'removed a date idea',
  completed: 'marked a date idea as done',
  uncompleted: 'unmarked a date idea',
  question_added: 'added a new quiz question',
  question_answered: 'answered your quiz question',
  place_added: 'added a new place to the map',
  place_visited: 'marked a place as visited',
  mystery_started: 'started a mystery game',
  mystery_waiting: 'is waiting for you to join a mystery',
  mystery_agreed: 'made a decision together in the mystery',
  memory_added: 'added a new memory',
  gratitude_sent: 'left you a note on the gratitude wall',
  chat_message: 'sent you a message',
  book_sentence: 'added to your story',
};

const ACTION_URLS: Record<string, string> = {
  added: '/dates',
  removed: '/dates',
  completed: '/dates',
  uncompleted: '/dates',
  question_added: '/quiz',
  question_answered: '/quiz',
  place_added: '/map',
  place_visited: '/map',
  mystery_started: '/mystery',
  mystery_waiting: '/mystery',
  mystery_agreed: '/mystery',
  memory_added: '/memories',
  gratitude_sent: '/gratitude',
  chat_message: '/',
  book_sentence: '/book',
};

export async function POST(request: Request) {
  try {
    const { action, title, user } = await request.json() as {
      action: ActionType;
      title: string;
      user: 'daniel' | 'huaiyao';
    };

    if (!action || !user) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Temporarily disable mystery notifications
    const isMystery = action === 'mystery_started' || action === 'mystery_waiting' || action === 'mystery_agreed';
    if (isMystery) {
      return NextResponse.json({ success: true, skipped: true, reason: 'Mystery notifications temporarily disabled' });
    }

    // Check if within allowed hours (9 AM - 11 PM Eastern)
    if (!isWithinAllowedHours()) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Outside allowed hours (9 AM - 11 PM Eastern)'
      });
    }

    // Notify the OTHER person
    const recipient = user === 'daniel' ? 'huaiyao' : 'daniel';
    const senderName = user === 'daniel' ? 'Daniel' : 'Huaiyao';

    // Get push subscriptions for the recipient
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_name', recipient);

    if (subError) {
      console.error('Error fetching subscriptions:', subError);
      return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No push subscriptions for recipient'
      });
    }

    // Prepare notification payload
    const notificationTitle = senderName;
    const actionMessage = ACTION_MESSAGES[action] || 'updated something';
    const message = title ? `${actionMessage}: ${title}` : actionMessage;
    const url = ACTION_URLS[action] || '/';

    const payload = JSON.stringify({
      title: notificationTitle,
      body: message,
      icon: '/icons/icon-192.png',
      url: url,
      tag: action, // Prevents duplicate notifications
    });

    // Send to all subscriptions for this user
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(pushSubscription, payload);
          return { success: true, endpoint: sub.endpoint };
        } catch (error: unknown) {
          // If subscription is invalid, remove it
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
      failed: failed
    });
  } catch (error) {
    console.error('Notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
