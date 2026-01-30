import { NextResponse } from 'next/server';

const PUSHOVER_API = 'https://api.pushover.net/1/messages.json';
const PUSHOVER_APP_TOKEN = 'awjs2cyd1q9m56vrpyruv52y4826m6';

const USER_KEYS = {
  daniel: 'uqiumw91z3zg8r4favueo6h3785po5',
  huaiyao: 'utu9t97tkvx5vvcookhhogqkh4axbf',
};

// Quiet hours: only send between 9 AM and 11 PM (Eastern Time)
const QUIET_HOURS_START = 23; // 11 PM
const QUIET_HOURS_END = 9;    // 9 AM
const TIMEZONE = 'America/New_York';

function isWithinAllowedHours(): boolean {
  const now = new Date();
  const hour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));
  // Allowed: 9 AM (9) to 11 PM (23)
  // NOT allowed: 11 PM (23) to 9 AM (9)
  return hour >= QUIET_HOURS_END && hour < QUIET_HOURS_START;
}

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

    // Check if within allowed hours (9 AM - 11 PM Eastern)
    if (!isWithinAllowedHours()) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Outside allowed hours (9 AM - 11 PM Eastern)'
      });
    }

    // Determine notification type
    const isQuiz = action === 'question_added' || action === 'question_answered';
    const isMap = action === 'place_added' || action === 'place_visited';

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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
