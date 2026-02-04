import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Lazy initialize to avoid build-time errors
let openai: OpenAI | null = null;
function getOpenAI() {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface FeedbackRequest {
  messages: ChatMessage[];
  action: 'chat' | 'summarize';
}

const SYSTEM_PROMPT = `You are helping Huaiyao communicate feedback about the couples website she shares with Daniel. Daniel built the website and wants to know what Huaiyao thinks could be improved, added, or changed.

Your job is to:
1. Listen to what Huaiyao wants (could be a feature request, bug report, design feedback, or any idea)
2. Ask clarifying questions to understand EXACTLY what she means
3. Be warm, friendly, and conversational - you're helping her communicate with her partner
4. Keep questions simple and one at a time
5. After 2-3 exchanges where you understand the request clearly, tell her you've got it and will send it to Daniel

Important:
- Don't be too formal - this is a casual conversation between friends
- If she mentions something vague like "make it better", ask what specifically
- If she mentions a specific page/feature, ask what about it she wants changed
- Keep your responses SHORT - 1-2 sentences max for questions
- When you understand, say something like "Got it! I'll let Daniel know you want [summary]. Anything else?"

Example good responses:
- "Oh that sounds annoying! What exactly happens when you try to do that?"
- "Got it! So you want the button to be bigger on the home page?"
- "I'll tell Daniel! Is there anything else you want me to pass on?"`;

const SUMMARY_PROMPT = `Based on this conversation, create a concise summary of what Huaiyao wants. Format it as a clear, actionable request that Daniel can understand and act on.

If the conversation was cut short or unclear, summarize what you understood so far and note that she may have more to add.

Keep it brief but include:
1. What she wants (feature/change/fix)
2. Why (if mentioned)
3. Any specific details she gave

Format: Start with a one-line summary, then bullet points for details if needed.`;

export async function POST(request: NextRequest) {
  try {
    const body: FeedbackRequest = await request.json();
    const { messages, action } = body;

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'Messages required' }, { status: 400 });
    }

    if (action === 'summarize') {
      // Generate summary and send to Daniel
      const summaryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: SUMMARY_PROMPT },
        ...messages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        })),
        { role: 'user', content: 'Please summarize what Huaiyao wants based on this conversation.' },
      ];

      const summaryResponse = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: summaryMessages,
      });

      const summary = summaryResponse.choices[0]?.message?.content || 'Huaiyao had feedback but the summary could not be generated.';

      // Send notification to Daniel
      await sendNotificationToDaniel(summary);

      return NextResponse.json({ summary });
    }

    // Regular chat flow
    const formattedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: formattedMessages,
    });

    const assistantMessage = response.choices[0]?.message?.content || '';

    // Check if the AI thinks the conversation is complete
    const isComplete = assistantMessage.toLowerCase().includes("i'll let daniel know") ||
                       assistantMessage.toLowerCase().includes("i'll tell daniel") ||
                       assistantMessage.toLowerCase().includes("got it!") && assistantMessage.toLowerCase().includes("daniel");

    return NextResponse.json({
      message: assistantMessage,
      isComplete,
    });
  } catch (error) {
    console.error('Feedback chat error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

async function sendNotificationToDaniel(summary: string) {
  try {
    // Get Daniel's push subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_name', 'daniel');

    if (subError || !subscriptions || subscriptions.length === 0) {
      console.log('No subscriptions found for Daniel');
      return;
    }

    // Dynamic import web-push to avoid build issues
    const webpush = await import('web-push');

    webpush.default.setVapidDetails(
      'mailto:notifications@daniel-huaiyao.vercel.app',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );

    const truncatedSummary = summary.length > 200 ? summary.substring(0, 200) + '...' : summary;

    const payload = JSON.stringify({
      title: 'Feedback from Huaiyao',
      body: truncatedSummary,
      icon: '/icons/icon-192.png',
      url: '/feedback',
      tag: 'huaiyao-feedback',
    });

    // Send to all of Daniel's subscriptions
    for (const sub of subscriptions) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.default.sendNotification(pushSubscription, payload);
      } catch (pushError: unknown) {
        const webPushError = pushError as { statusCode?: number };
        if (webPushError.statusCode === 410 || webPushError.statusCode === 404) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', sub.endpoint);
        }
        console.error('Push error:', pushError);
      }
    }

    // Also store the feedback in database for reference
    await supabase.from('feedback_requests').insert({
      from_user: 'huaiyao',
      summary: summary,
      created_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error sending notification to Daniel:', error);
  }
}
