import {
  HIVE_METRICS_SNAPSHOT_NAME,
  HIVE_METRICS_SNAPSHOT_TABLE,
} from '../hive/metricsSnapshot';
import { getSupabaseAdmin } from './supabase-admin';

export type HiveTrainingMetricsSnapshot = {
  name: string;
  content: string;
  event_count: number;
  content_size: number;
  source_path: string | null;
  updated_at: string;
};

export async function readHiveTrainingMetricsSnapshot(): Promise<HiveTrainingMetricsSnapshot | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(HIVE_METRICS_SNAPSHOT_TABLE)
      .select('name, content, event_count, content_size, source_path, updated_at')
      .eq('name', HIVE_METRICS_SNAPSHOT_NAME)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data || typeof data.content !== 'string' || data.content.trim().length === 0) {
      return null;
    }

    return data as HiveTrainingMetricsSnapshot;
  } catch {
    return null;
  }
}
