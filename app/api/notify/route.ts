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

type ActionType = 'added' | 'removed' | 'completed' | 'uncompleted';

const ACTION_MESSAGES: Record<ActionType, string> = {
  added: 'added a new date idea',
  removed: 'removed a date idea',
  completed: 'marked a date idea as done',
  uncompleted: 'unmarked a date idea',
};

async function canSendNotification(): Promise<boolean> {
  const { data } = await supabase
    .from('notification_log')
    .select('last_sent')
    .eq('id', 'date-ideas')
    .single();

  if (!data) return true;

  const lastSent = new Date(data.last_sent).getTime();
  const now = Date.now();

  return now - lastSent >= RATE_LIMIT_MS;
}

async function updateLastSent(): Promise<void> {
  await supabase
    .from('notification_log')
    .upsert({ id: 'date-ideas', last_sent: new Date().toISOString() });
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

    // Check rate limit
    const canSend = await canSendNotification();
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

    const notificationTitle = `Date Ideas Updated`;
    const message = `${senderName} ${ACTION_MESSAGES[action]}: "${title}"`;

    const formData = new URLSearchParams({
      token: PUSHOVER_APP_TOKEN,
      user: recipientKey,
      title: notificationTitle,
      message,
      sound: 'magic',
      priority: '0',
      url: 'https://daniel-huaiyao.vercel.app/dates',
      url_title: 'View Date Ideas',
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
    await updateLastSent();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
