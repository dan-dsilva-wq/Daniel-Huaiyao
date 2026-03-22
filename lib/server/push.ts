import webpush from 'web-push';
import { getSupabaseAdmin } from './supabase-admin';

const KNOWN_USERS = new Set(['daniel', 'huaiyao']);
const INVALID_SUBSCRIPTION_CODES = new Set([404, 410]);
const DEFAULT_TIMEZONE = 'UTC';

let vapidConfigured = false;

export type KnownUser = 'daniel' | 'huaiyao';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  tag?: string;
};

export type StoredPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_name: KnownUser;
  timezone?: string | null;
  last_used_at?: string | null;
};

type PushSendFailure = {
  statusCode?: number;
  message: string;
};

export function normalizeKnownUser(value: unknown): KnownUser | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().trim();
  if (!KNOWN_USERS.has(normalized)) return null;
  return normalized as KnownUser;
}

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(value: unknown): string {
  if (isValidTimezone(value)) {
    return value.trim();
  }
  return DEFAULT_TIMEZONE;
}

export function hourInTimezone(date: Date, timezone: string): number {
  const hour = date.toLocaleString('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  });
  return Number.parseInt(hour, 10);
}

export function ensureVapidConfigured(): { ok: true } | { ok: false; reason: string } {
  if (vapidConfigured) {
    return { ok: true };
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return {
      ok: false,
      reason: 'Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY',
    };
  }

  webpush.setVapidDetails('mailto:notifications@daniel-huaiyao.vercel.app', publicKey, privateKey);
  vapidConfigured = true;
  return { ok: true };
}

export async function upsertPushSubscription(input: {
  userName: KnownUser;
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const payload = {
    user_name: input.userName,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    last_used_at: new Date().toISOString(),
    timezone: normalizeTimezone(input.timezone),
  };

  let { error } = await supabase.from('push_subscriptions').upsert(payload, { onConflict: 'endpoint' });

  if (error && error.message.toLowerCase().includes('timezone')) {
    const fallbackPayload = {
      user_name: input.userName,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      last_used_at: new Date().toISOString(),
    };
    ({ error } = await supabase
      .from('push_subscriptions')
      .upsert(fallbackPayload, { onConflict: 'endpoint' }));
  }

  return { error };
}

export async function deletePushSubscription(endpoint: string) {
  const supabase = getSupabaseAdmin();
  return supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

async function fetchSubscriptions(users: KnownUser[]): Promise<{
  data: StoredPushSubscription[] | null;
  error: { message: string } | null;
}> {
  const supabase = getSupabaseAdmin();
  let { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_name, timezone, last_used_at')
    .in('user_name', users);

  if (error && error.message.toLowerCase().includes('timezone')) {
    const fallback = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_name, last_used_at')
      .in('user_name', users);
    data =
      fallback.data?.map((row) => ({
        ...row,
        timezone: null,
      })) ?? null;
    error = fallback.error;
  }

  return { data: (data as StoredPushSubscription[] | null) ?? null, error };
}

export async function getSubscriptionsForUsers(users: KnownUser[]) {
  return fetchSubscriptions(users);
}

async function sendPushToSubscription(subscription: StoredPushSubscription, payload: PushPayload) {
  const encodedPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon ?? '/icons/icon-192.png',
    url: payload.url ?? '/',
    tag: payload.tag ?? 'default',
  });

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      encodedPayload
    );
    return { ok: true as const };
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && INVALID_SUBSCRIPTION_CODES.has(statusCode)) {
      await deletePushSubscription(subscription.endpoint);
    }
    return {
      ok: false as const,
      error: {
        statusCode,
        message: error instanceof Error ? error.message : 'Unknown push delivery error',
      } satisfies PushSendFailure,
    };
  }
}

async function countUnlinkedSubscriptions() {
  const supabase = getSupabaseAdmin();
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint', { count: 'exact', head: true })
    .is('user_name', null);

  if (error) {
    return { count: 0, error };
  }

  return { count: count ?? 0, error: null };
}

export async function sendPushToUsers(users: KnownUser[], payload: PushPayload) {
  const vapidStatus = ensureVapidConfigured();
  if (!vapidStatus.ok) {
    return {
      success: false,
      reason: vapidStatus.reason,
      sent: 0,
      failed: 0,
      skipped: true,
    };
  }

  const { data: subscriptions, error } = await fetchSubscriptions(users);
  if (error) {
    return {
      success: false,
      reason: error.message,
      sent: 0,
      failed: 0,
      skipped: true,
    };
  }

  if (!subscriptions || subscriptions.length === 0) {
    const { count: unlinkedCount } = await countUnlinkedSubscriptions();
    const reason =
      unlinkedCount > 0
        ? `No subscriptions found for recipients; found ${unlinkedCount} unlinked legacy subscription(s)`
        : 'No subscriptions found for recipients';
    return {
      success: true,
      reason,
      sent: 0,
      failed: 0,
      skipped: true,
    };
  }

  const results = await Promise.allSettled(
    subscriptions.map((subscription) => sendPushToSubscription(subscription, payload))
  );
  const sent = results.filter(
    (result) => result.status === 'fulfilled' && result.value.ok
  ).length;
  const failed = results.length - sent;
  const failureReasons = results
    .flatMap((result) => {
      if (result.status === 'rejected') {
        return [result.reason instanceof Error ? result.reason.message : 'Unknown push delivery error'];
      }
      if (!result.value.ok) {
        return [
          result.value.error.statusCode
            ? `${result.value.error.statusCode}: ${result.value.error.message}`
            : result.value.error.message,
        ];
      }
      return [];
    })
    .filter(Boolean);

  if (sent === 0 && failed > 0) {
    return {
      success: false,
      reason: failureReasons[0] ?? 'Push delivery failed for all subscriptions',
      sent,
      failed,
      skipped: false,
    };
  }

  return {
    success: true,
    sent,
    failed,
    skipped: false,
    reason: failureReasons[0],
  };
}

export async function getPreferredUserTimezones() {
  const users: KnownUser[] = ['daniel', 'huaiyao'];
  const { data, error } = await fetchSubscriptions(users);
  if (error || !data) {
    return {
      daniel: DEFAULT_TIMEZONE,
      huaiyao: DEFAULT_TIMEZONE,
    };
  }

  const output: Record<KnownUser, string> = {
    daniel: DEFAULT_TIMEZONE,
    huaiyao: DEFAULT_TIMEZONE,
  };

  for (const user of users) {
    const record = data
      .filter((subscription) => subscription.user_name === user)
      .sort((a, b) => {
        const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return bTime - aTime;
      })
      .find((subscription) => isValidTimezone(subscription.timezone));
    if (record?.timezone) {
      output[user] = record.timezone;
    }
  }

  return output;
}
