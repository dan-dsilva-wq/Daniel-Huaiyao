import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PUSHOVER_API = 'https://api.pushover.net/1/messages.json';
const PUSHOVER_APP_TOKEN = 'awjs2cyd1q9m56vrpyruv52y4826m6';

const USER_KEYS = {
  daniel: 'uqiumw91z3zg8r4favueo6h3785po5',
  huaiyao: 'utu9t97tkvx5vvcookhhogqkh4axbf',
};

// Rate limit: 10 minutes
const RATE_LIMIT_MS = 10 * 60 * 1000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

type ActionType = 'added' | 'removed' | 'completed' | 'uncompleted' | 'question_added' | 'question_answered' | 'place_added' | 'place_visited';

const ACTION_MESSAGES: Record<ActionType, string> = {
  added: 'added a new date idea',
  removed: 'removed a date idea',
  completed: 'marked a date idea as done',
  uncompleted: 'unmarked a date idea',
  question_added: 'added a new quiz question',
  question_answered: 'answered your quiz question',
  place_added: 'added a new place to the map',
  place_visited: 'marked a place as visited',
};

async function canSendNotification(logId: string): Promise<boolean> {
  const { data } = await supabase
    .from('notification_log')
    .select('last_sent')
    .eq('id', logId)
    .single();

  if (!data) return true;

  const lastSent = new Date(data.last_sent).getTime();
  const now = Date.now();

  return now - lastSent >= RATE_LIMIT_MS;
}

async function updateLastSent(logId: string): Promise<void> {
  await supabase
    .from('notification_log')
    .upsert({ id: logId, last_sent: new Date().toISOString() });
}

export async function POST(request: Request) {
  try {
    const { action, title, user } = await request.json() as {
      action: ActionType;
      title: string;
      user: 'daniel' | 'huaiyao';
    };

    if (!action || !title || !user) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Determine notification type
    const isQuiz = action === 'question_added' || action === 'question_answered';
    const isMap = action === 'place_added' || action === 'place_visited';
    const logId = isQuiz ? 'quiz' : isMap ? 'map' : 'date-ideas';

    // Check rate limit
    const canSend = await canSendNotification(logId);
    if (!canSend) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Rate limited (10 min cooldown)'
      });
    }

    // Notify the OTHER person
    const recipientKey = user === 'daniel' ? USER_KEYS.huaiyao : USER_KEYS.daniel;
    const senderName = user === 'daniel' ? 'Daniel' : 'Huaiyao';

    const notificationTitle = isQuiz ? 'Quiz Time' : isMap ? 'Our Map' : 'Date Ideas Updated';
    const message = `${senderName} ${ACTION_MESSAGES[action]}`;
    const notificationUrl = isQuiz
      ? 'https://daniel-huaiyao.vercel.app/quiz'
      : isMap
      ? 'https://daniel-huaiyao.vercel.app/map'
      : 'https://daniel-huaiyao.vercel.app/dates';
    const urlTitle = isQuiz ? 'Answer Quiz' : isMap ? 'View Map' : 'View Date Ideas';

    const formData = new URLSearchParams({
      token: PUSHOVER_APP_TOKEN,
      user: recipientKey,
      title: notificationTitle,
      message,
      sound: 'magic',
      priority: '0',
      url: notificationUrl,
      url_title: urlTitle,
    });

    const response = await fetch(PUSHOVER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Pushover error:', errorText);
      return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
    }

    // Update last sent time
    await updateLastSent(logId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
