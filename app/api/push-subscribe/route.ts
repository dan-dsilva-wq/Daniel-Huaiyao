import { NextRequest, NextResponse } from 'next/server';
import {
  deletePushSubscription,
  isValidTimezone,
  normalizeKnownUser,
  upsertPushSubscription,
} from '@/lib/server/push';

type PushSubscriptionPayload = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

function getFriendlySubscriptionErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('null value in column "user_id"') &&
    normalized.includes('push_subscription')
  ) {
    return 'Push subscription schema is still on the legacy user_id-based shape. Apply the latest push subscription migration, then try enabling notifications again.';
  }
  return message;
}

export async function POST(request: NextRequest) {
  try {
    const { subscription, userName, timezone } = await request.json();

    if (!subscription || !userName) {
      return NextResponse.json({ error: 'Missing subscription or userName' }, { status: 400 });
    }

    const normalizedUserName = normalizeKnownUser(userName);
    if (!normalizedUserName) {
      return NextResponse.json(
        { error: 'Invalid userName', details: 'Expected daniel or huaiyao' },
        { status: 400 }
      );
    }

    const typedSubscription = subscription as PushSubscriptionPayload;
    const endpoint = typedSubscription.endpoint?.trim();
    const p256dh = typedSubscription.keys?.p256dh?.trim();
    const auth = typedSubscription.keys?.auth?.trim();

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: 'Invalid subscription payload', details: 'Missing endpoint or keys' },
        { status: 400 }
      );
    }

    const normalizedTimezone = isValidTimezone(timezone) ? timezone : null;
    const { error } = await upsertPushSubscription({
      userName: normalizedUserName,
      endpoint,
      p256dh,
      auth,
      timezone: normalizedTimezone,
    });

    if (error) {
      console.error('Error saving subscription:', error);
      return NextResponse.json(
        {
          error: 'Failed to save subscription',
          details: getFriendlySubscriptionErrorMessage(error.message),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push subscribe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { endpoint } = await request.json();

    if (!endpoint) {
      return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });
    }

    const { error } = await deletePushSubscription(endpoint);

    if (error) {
      console.error('Error removing subscription:', error);
      return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Push unsubscribe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
