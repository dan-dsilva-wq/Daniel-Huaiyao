import { NextResponse } from 'next/server';

const PUSHOVER_API = 'https://api.pushover.net/1/messages.json';
const PUSHOVER_APP_TOKEN = 'awjs2cyd1q9m56vrpyruv52y4826m6';

const USER_KEYS = {
  daniel: 'uqiumw91z3zg8r4favueo6h3785po5',
  huaiyao: 'utu9t97tkvx5vvcookhhogqkh4axbf',
};

// Romantic notification titles
const TITLES_FOR_DANIEL = [
  "Huaiyao added to your story",
  "A new chapter awaits...",
  "Huaiyao is thinking of you",
  "Your story continues...",
  "Words from Huaiyao",
];

const TITLES_FOR_HUAIYAO = [
  "Daniel added to your story",
  "A new chapter awaits...",
  "Daniel is thinking of you",
  "Your story continues...",
  "Words from Daniel",
];

function getRandomTitle(forDaniel: boolean): string {
  const titles = forDaniel ? TITLES_FOR_DANIEL : TITLES_FOR_HUAIYAO;
  return titles[Math.floor(Math.random() * titles.length)];
}

export async function POST(request: Request) {
  try {
    const { writer, content } = await request.json();

    if (!writer || !content) {
      return NextResponse.json({ error: 'Missing writer or content' }, { status: 400 });
    }

    // Notify the OTHER person
    const notifyingDaniel = writer === 'huaiyao';
    const recipientKey = notifyingDaniel ? USER_KEYS.daniel : USER_KEYS.huaiyao;
    const title = getRandomTitle(notifyingDaniel);

    // Truncate content nicely
    let message = content;
    if (message.length > 120) {
      message = message.substring(0, 117) + '...';
    }

    const formData = new URLSearchParams({
      token: PUSHOVER_APP_TOKEN,
      user: recipientKey,
      title,
      message: `"${message}"`,
      sound: 'magic',
      priority: '0',
      url: notifyingDaniel
        ? 'https://daniel-huaiyao-book.vercel.app/daniel'
        : 'https://daniel-huaiyao-book.vercel.app/huaiyao',
      url_title: 'Continue the story',
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
