import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { InspectViewer } from './InspectViewer';
import type { HiveInspectTrace } from '@/lib/hive/inspectTrace';

async function readTrace(): Promise<HiveInspectTrace | null> {
  try {
    const tracePath = path.resolve(process.cwd(), '.hive-cache/inspect/latest.json');
    const raw = await readFile(tracePath, 'utf8');
    return JSON.parse(raw) as HiveInspectTrace;
  } catch {
    return null;
  }
}

export default async function HiveInspectPage() {
  const trace = await readTrace();
  return <InspectViewer trace={trace} />;
}
