-- Store push notification subscriptions for each device
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name TEXT NOT NULL CHECK (user_name IN ('daniel', 'huaiyao')),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by user
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_name);
