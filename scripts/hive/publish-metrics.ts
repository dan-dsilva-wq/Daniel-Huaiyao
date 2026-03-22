import { DEFAULT_HIVE_METRICS_LOG_PATH } from '../../lib/hive/metricsSnapshot';
import { publishHiveMetricsSnapshot } from './sharedMetrics';

async function main(): Promise<void> {
  const result = await publishHiveMetricsSnapshot();

  if (!result.published) {
    const target = result.absolutePath ?? DEFAULT_HIVE_METRICS_LOG_PATH;

    switch (result.reason) {
      case 'missing_env':
        console.log('[metrics:publish] Supabase environment variables are not configured.');
        return;
      case 'missing_file':
        console.log(`[metrics:publish] No local metrics file found at ${target}.`);
        return;
      case 'empty_file':
        console.log(`[metrics:publish] Metrics file at ${target} is empty.`);
        return;
      default:
        return;
    }
  }

  console.log(
    `[metrics:publish] Published ${result.eventCount} Hive metric events from ${result.absolutePath}.`,
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
