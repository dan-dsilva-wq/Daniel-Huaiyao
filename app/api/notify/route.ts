import { NextResponse } from 'next/server';
import { normalizeKnownUser, sendPushToUsers } from '@/lib/server/push';
import { getSupabaseAdmin } from '@/lib/server/supabase-admin';
import { resolveActivityRoute } from '@/lib/activity-routes';

// Quiet hours: only send between 9 AM and 11 PM (Eastern Time)
const QUIET_HOURS_START = 23; // 11 PM
const QUIET_HOURS_END = 9;    // 9 AM
const TIMEZONE = 'America/New_York';

function isWithinAllowedHours(): boolean {
  const now = new Date();
  const hour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));
  return hour >= QUIET_HOURS_END && hour < QUIET_HOURS_START;
}

type ActionType = 'added' | 'removed' | 'completed' | 'uncompleted' | 'question_added' | 'question_answered' | 'place_added' | 'place_visited' | 'mystery_started' | 'mystery_waiting' | 'mystery_agreed' | 'memory_added' | 'gratitude_sent' | 'chat_message' | 'book_sentence' | 'date_added' | 'date_removed' | 'prompt_answered' | 'media_added' | 'stratego_new_game' | 'stratego_move' | 'date_idea_edited' | 'event_plan_updated';

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
  date_added: 'added a countdown event',
  date_removed: 'removed a countdown event',
  prompt_answered: 'answered today\'s prompt',
  media_added: 'added something to watch',
  stratego_new_game: 'started a Stratego game',
  stratego_move: 'made a move in Stratego',
  date_idea_edited: 'edited a date idea',
  event_plan_updated: 'updated plans for',
};

const ACTION_APP_NAMES: Record<string, string> = {
  added: 'dates',
  removed: 'dates',
  completed: 'dates',
  uncompleted: 'dates',
  question_added: 'quiz',
  question_answered: 'quiz',
  place_added: 'map',
  place_visited: 'map',
  mystery_started: 'mystery',
  mystery_waiting: 'mystery',
  mystery_agreed: 'mystery',
  memory_added: 'memories',
  gratitude_sent: 'gratitude',
  chat_message: 'chat',
  book_sentence: 'book',
  date_added: 'countdown',
  date_removed: 'countdown',
  prompt_answered: 'prompts',
  media_added: 'media',
  stratego_new_game: 'stratego',
  stratego_move: 'stratego',
  date_idea_edited: 'dates',
  event_plan_updated: 'countdown',
};

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();

    const { action, title, user } = await request.json() as {
      action: ActionType;
      title: string;
      user: 'daniel' | 'huaiyao';
    };

    if (!action || !user || !normalizeKnownUser(user)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Log activity (do this regardless of notification status)
    const appName = ACTION_APP_NAMES[action] || 'home';
    try {
      await supabase.rpc('log_activity', {
        p_player: user,
        p_action_type: action,
        p_app_name: appName,
        p_action_title: title || null,
      });
    } catch (activityError) {
      console.error('Error logging activity:', activityError);
      // Continue even if activity logging fails
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

    // Prepare notification payload
    const notificationTitle = senderName;
    const actionMessage = ACTION_MESSAGES[action] || 'updated something';
    const message = title ? `${actionMessage}: ${title}` : actionMessage;
    const url = resolveActivityRoute(action, ACTION_APP_NAMES[action]);
    const pushResult = await sendPushToUsers([recipient], {
      title: notificationTitle,
      body: message,
      icon: '/icons/icon-192.png',
      url,
      tag: action,
    });

    if (!pushResult.success) {
      return NextResponse.json(
        { error: 'Failed to send notifications', details: pushResult.reason },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      sent: pushResult.sent,
      failed: pushResult.failed,
      skipped: pushResult.skipped,
      reason: pushResult.reason,
    });
  } catch (error) {
    console.error('Notification error:', error);
    return NextResponse.json(
      { error: 'Failed to send notification', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
