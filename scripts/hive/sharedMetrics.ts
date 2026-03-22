import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_HIVE_METRICS_LOG_PATH,
  HIVE_METRICS_SNAPSHOT_NAME,
  HIVE_METRICS_SNAPSHOT_TABLE,
} from '../../lib/hive/metricsSnapshot';

type PublishResult =
  | {
      published: true;
      absolutePath: string;
      eventCount: number;
      contentSize: number;
    }
  | {
      published: false;
      reason: 'missing_env' | 'missing_file' | 'empty_file';
      absolutePath?: string;
    };

let didLoadEnv = false;

function ensureEnvLoaded(): void {
  if (didLoadEnv) return;
  loadEnvConfig(process.cwd());
  didLoadEnv = true;
}

export async function publishHiveMetricsSnapshot(
  configuredPath?: string,
): Promise<PublishResult> {
  ensureEnvLoaded();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { published: false, reason: 'missing_env' };
  }

  const relativePath = configuredPath || process.env.HIVE_METRICS_LOG_PATH || DEFAULT_HIVE_METRICS_LOG_PATH;
  const absolutePath = path.resolve(process.cwd(), relativePath);

  if (!existsSync(absolutePath)) {
    return { published: false, reason: 'missing_file', absolutePath };
  }

  const content = readFileSync(absolutePath, 'utf8');
  if (content.trim().length === 0) {
    return { published: false, reason: 'empty_file', absolutePath };
  }

  const eventCount = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .length;
  const contentSize = Buffer.byteLength(content, 'utf8');

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { error } = await supabase
    .from(HIVE_METRICS_SNAPSHOT_TABLE)
    .upsert(
      {
        name: HIVE_METRICS_SNAPSHOT_NAME,
        content,
        event_count: eventCount,
        content_size: contentSize,
        source_path: absolutePath,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'name' },
    );

  if (error) {
    throw new Error(error.message);
  }

  return {
    published: true,
    absolutePath,
    eventCount,
    contentSize,
  };
}

export async function publishHiveMetricsSnapshotSafely(
  configuredPath?: string,
): Promise<void> {
  try {
    const result = await publishHiveMetricsSnapshot(configuredPath);
    if (!result.published) return;

    console.log(
      `[metrics:publish] Shared Hive metrics snapshot updated from ${result.absolutePath} (${result.eventCount} events, ${result.contentSize} bytes)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[warn] Failed to publish shared Hive metrics snapshot: ${message}`);
  }
}
