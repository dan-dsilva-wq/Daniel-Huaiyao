import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  BUNDLED_HIVE_METRICS_SNAPSHOT_PATH,
  DEFAULT_HIVE_METRICS_LOG_PATH,
} from '../../lib/hive/metricsSnapshot';

function main(): void {
  const sourcePath = path.resolve(
    process.cwd(),
    process.env.HIVE_METRICS_LOG_PATH ?? DEFAULT_HIVE_METRICS_LOG_PATH,
  );
  const destinationPath = path.resolve(process.cwd(), BUNDLED_HIVE_METRICS_SNAPSHOT_PATH);

  if (!existsSync(sourcePath)) {
    throw new Error(`Local Hive metrics log not found at ${sourcePath}`);
  }

  mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
  console.log(`[metrics:snapshot] Exported Hive metrics snapshot to ${destinationPath}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
}
