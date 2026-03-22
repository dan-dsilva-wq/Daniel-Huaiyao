import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import {
  BUNDLED_HIVE_METRICS_SNAPSHOT_PATH,
  DEFAULT_HIVE_METRICS_LOG_PATH,
} from '@/lib/hive/metricsSnapshot';
import { readHiveTrainingMetricsSnapshot } from '@/lib/server/hive-training-metrics';
import { AutoRefresh } from './AutoRefresh';

export const dynamic = 'force-dynamic';

type MetricEvent = {
  ts?: string;
  source?: 'az' | 'eval' | 'deep' | 'linear';
  runId?: string;
  eventType?: string;
  [key: string]: unknown;
};

type MetricsLoadResult = {
  events: MetricEvent[];
  source: 'local_file' | 'shared_snapshot' | 'bundled_snapshot' | 'none';
  snapshotUpdatedAt: string | null;
  snapshotEventCount: number | null;
};

type TrainerEpoch = {
  epoch: number;
  totalEpochs: number | null;
  trainLoss: number | null;
  valLoss: number | null;
  trainValueLoss: number | null;
  valValueLoss: number | null;
  trainPolicyLoss: number | null;
  valPolicyLoss: number | null;
  trainAuxLoss: number | null;
  valAuxLoss: number | null;
  trainPolicyEntropy: number | null;
  valPolicyEntropy: number | null;
};

type TrainerRun = {
  runId: string;
  step: number | null;
  presetId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: string | null;
  sampleCount: number | null;
  batchSize: number | null;
  epochs: TrainerEpoch[];
};

type ArenaResult = {
  runId: string;
  ts: string | null;
  step: number | null;
  presetId: string | null;
  games: number | null;
  configuredGames: number | null;
  candidateScore: number | null;
  eloEstimate: number | null;
  scoreCiLow: number | null;
  scoreCiHigh: number | null;
  gateDecisionReason: string | null;
  candidateHash: string | null;
  championHash: string | null;
  promoted: boolean | null;
  stage2Triggered: boolean | null;
  stage1Score: number | null;
  stage2Score: number | null;
  severeFailure: boolean | null;
};

type AsyncSummary = {
  runId: string;
  lastTs: string | null;
  replaySamples: number | null;
  totalChunks: number | null;
  totalGenerated: number | null;
  latestTrainStep: number | null;
  latestArenaStep: number | null;
  bestCheckpointScore: number | null;
  latestPhase: string | null;
};

type ReplayPoint = {
  ts: string | null;
  replaySamples: number | null;
};

type ArenaPoint = {
  ts: string | null;
  candidateScore: number | null;
};

type StepRow = {
  step: number;
  presetId: string | null;
  replaySamples: number | null;
  reanalysedSamples: number | null;
  sampleCount: number | null;
  trainStatus: string | null;
  arenaScore: number | null;
  arenaPromoted: boolean | null;
  arenaReason: string | null;
};

type PresetSummary = {
  presetId: string;
  runs: number;
  promotions: number;
  severeFailures: number;
  avgScore: number | null;
  avgCiLow: number | null;
};

type OverfittingWarning = {
  severity: 'none' | 'watch' | 'high';
  message: string;
};

export default async function HiveTrainingPage() {
  const logPath = resolveMetricsPath();
  const metrics = await loadMetricEvents(logPath);
  const azEvents = metrics.events.filter((event) => event.source === 'az' || event.source === 'eval');
  const trainerRuns = buildTrainerRuns(azEvents);
  const arenaResults = buildArenaResults(azEvents);
  const asyncRuns = buildAsyncSummaries(azEvents);
  const stepRows = buildStepRows(azEvents, trainerRuns);
  const presetSummaries = buildPresetSummaries(azEvents);
  const replayPoints = buildReplayPoints(azEvents);
  const arenaPoints = arenaResults
    .slice()
    .reverse()
    .map((result) => ({ ts: result.ts, candidateScore: result.candidateScore }));

  const latestTrainerRun = trainerRuns[0] ?? null;
  const latestArena = arenaResults[0] ?? null;
  const latestAsync = asyncRuns[0] ?? null;
  const overfittingWarning = latestTrainerRun ? getOverfittingWarning(latestTrainerRun) : null;
  const favoredPreset = presetSummaries[0]?.presetId ?? latestTrainerRun?.presetId ?? latestArena?.presetId ?? '-';
  const recentConfirmedPromotions = arenaResults.filter((result) => result.promoted).slice(0, 5).length;
  const recentSevereFailures = arenaResults.filter((result) => result.severeFailure).slice(0, 8).length;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <AutoRefresh intervalMs={5000} />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Hive AlphaZero Training</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Current async training, replay growth, trainer metrics, and promotion arenas.
            </p>
          </div>
          <Link
            href="/hive"
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          >
            Back To Game
          </Link>
        </div>

        <InfoCard metrics={metrics} logPath={logPath} />

        <div className="grid gap-4 lg:grid-cols-3">
          <SummaryCard
            title="Current Async Run"
            rows={[
              ['Run', latestAsync?.runId ?? '-'],
              ['Last Event', formatTimestamp(latestAsync?.lastTs)],
              ['Replay Samples', formatCount(latestAsync?.replaySamples)],
              ['Total Chunks', formatCount(latestAsync?.totalChunks)],
              ['Generated Samples', formatCount(latestAsync?.totalGenerated)],
              ['Latest Train Step', formatCount(latestAsync?.latestTrainStep)],
              ['Latest Arena Step', formatCount(latestAsync?.latestArenaStep)],
              ['Best Checkpoint', formatPercent(latestAsync?.bestCheckpointScore)],
              ['Current Phase', latestAsync?.latestPhase ?? '-'],
              ['Favored Preset', favoredPreset],
            ]}
          />
          <SummaryCard
            title="Latest Training Step"
            rows={[
              ['Run', latestTrainerRun?.runId ?? '-'],
              ['Step', formatCount(latestTrainerRun?.step)],
              ['Started', formatTimestamp(latestTrainerRun?.startedAt)],
              ['Ended', formatTimestamp(latestTrainerRun?.endedAt)],
              ['Status', latestTrainerRun?.status ?? '-'],
              ['Samples', formatCount(latestTrainerRun?.sampleCount)],
              ['Batch Size', formatCount(latestTrainerRun?.batchSize)],
              ['Epochs', formatCount(latestTrainerRun?.epochs.length ?? null)],
              ['Preset', latestTrainerRun?.presetId ?? '-'],
            ]}
          />
          <SummaryCard
            title="Latest Arena"
            rows={[
              ['Run', latestArena?.runId ?? '-'],
              ['Completed', formatTimestamp(latestArena?.ts)],
              ['Games', formatFraction(latestArena?.games, latestArena?.configuredGames)],
              ['Score', formatPercent(latestArena?.candidateScore)],
              ['Elo Vs Champion', formatMetric(latestArena?.eloEstimate, 1)],
              ['CI Low', formatPercent(latestArena?.scoreCiLow)],
              ['CI High', formatPercent(latestArena?.scoreCiHigh)],
              ['Stage 2', latestArena?.stage2Triggered === null ? '-' : latestArena.stage2Triggered ? 'yes' : 'no'],
              ['Result', latestArena?.promoted === null ? '-' : latestArena.promoted ? 'Promoted' : 'Rejected'],
            ]}
            footer={latestArena?.gateDecisionReason ? `Reason: ${latestArena.gateDecisionReason}` : null}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <SummaryCard
            title="Reliable Progress"
            rows={[
              ['Confirmed Promotions', String(recentConfirmedPromotions)],
              ['Severe Failures', String(recentSevereFailures)],
              ['Favored Preset', favoredPreset],
              ['Current Phase', latestAsync?.latestPhase ?? '-'],
            ]}
            footer="Arena outcomes matter more than replay loss. Use this panel to judge whether the loop is becoming more reliable."
          />
        </div>

        {overfittingWarning && overfittingWarning.severity !== 'none' ? (
          <WarningCard warning={overfittingWarning} />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <LineChart
            title="Replay Samples"
            valueSuffix=""
            series={[
              { label: 'replay samples', color: '#2563eb', values: replayPoints.map((point) => point.replaySamples) },
            ]}
          />
          <LineChart
            title="Arena Score"
            valueSuffix="%"
            valueScale={100}
            series={[
              { label: 'candidate score', color: '#16a34a', values: arenaPoints.map((point) => point.candidateScore) },
            ]}
          />
        </div>

        {latestTrainerRun ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <LineChart
              title="Latest Training Loss"
              series={[
                { label: 'train loss', color: '#0284c7', values: latestTrainerRun.epochs.map((epoch) => epoch.trainLoss) },
                { label: 'val loss', color: '#dc2626', values: latestTrainerRun.epochs.map((epoch) => epoch.valLoss) },
              ]}
            />
            <LineChart
              title="Latest Policy Signals"
              series={[
                { label: 'val policy loss', color: '#7c3aed', values: latestTrainerRun.epochs.map((epoch) => epoch.valPolicyLoss) },
                { label: 'val entropy', color: '#d97706', values: latestTrainerRun.epochs.map((epoch) => epoch.valPolicyEntropy) },
              ]}
            />
          </div>
        ) : (
          <EmptyCard label="No AlphaZero trainer run found yet." />
        )}

        <SectionTable
          title="Recent Steps"
          description="One row per async train/arena step. This is the main view for whether the loop is actually progressing."
          headers={['Step', 'Preset', 'Replay', 'Reanalysed', 'Train Samples', 'Train Status', 'Arena Score', 'Promoted', 'Arena Reason']}
          rows={stepRows.slice(0, 12).map((row) => [
            String(row.step),
            row.presetId ?? '-',
            formatCount(row.replaySamples),
            formatCount(row.reanalysedSamples),
            formatCount(row.sampleCount),
            row.trainStatus ?? '-',
            formatPercent(row.arenaScore),
            row.arenaPromoted === null ? '-' : row.arenaPromoted ? 'yes' : 'no',
            row.arenaReason ?? '-',
          ])}
          emptyLabel="No completed steps yet."
        />

        <SectionTable
          title="Recent Arenas"
          description="Arena stages confirm whether replay-fit improvements actually produce stronger play."
          headers={['Completed', 'Preset', 'Games', 'Score', 'Stage 2', 'Promoted', 'Reason', 'Candidate', 'Champion']}
          rows={arenaResults.slice(0, 12).map((result) => [
            formatTimestamp(result.ts),
            result.presetId ?? '-',
            formatFraction(result.games, result.configuredGames),
            formatPercent(result.candidateScore),
            result.stage2Triggered === null ? '-' : result.stage2Triggered ? 'yes' : 'no',
            result.promoted === null ? '-' : result.promoted ? 'yes' : 'no',
            result.gateDecisionReason ?? '-',
            result.candidateHash ?? '-',
            result.championHash ?? '-',
          ])}
          emptyLabel="No arena results yet."
        />

        <SectionTable
          title="Preset Experiments"
          description="Preset ranking uses repeated arena outcomes, promotion rate, confidence-aware score, and severe failure rate."
          headers={['Preset', 'Runs', 'Promotions', 'Severe Fails', 'Avg Score', 'Avg CI Low']}
          rows={presetSummaries.slice(0, 8).map((row) => [
            row.presetId,
            String(row.runs),
            String(row.promotions),
            String(row.severeFailures),
            formatPercent(row.avgScore),
            formatPercent(row.avgCiLow),
          ])}
          emptyLabel="No preset experiment data yet."
        />

        <SectionTable
          title="Recent Trainer Runs"
          description="Focused on the current AlphaZero trainer only."
          headers={['Step', 'Started', 'Status', 'Samples', 'Batch', 'Val Loss', 'Val Policy', 'Val Entropy']}
          rows={trainerRuns.slice(0, 12).map((run) => {
            const lastEpoch = run.epochs[run.epochs.length - 1];
            return [
              formatCount(run.step),
              formatTimestamp(run.startedAt),
              run.status ?? '-',
              formatCount(run.sampleCount),
              formatCount(run.batchSize),
              formatMetric(lastEpoch?.valLoss),
              formatMetric(lastEpoch?.valPolicyLoss),
              formatMetric(lastEpoch?.valPolicyEntropy),
            ];
          })}
          emptyLabel="No trainer runs yet."
        />
      </div>
    </main>
  );
}

function InfoCard({ metrics, logPath }: { metrics: MetricsLoadResult; logPath: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-700 dark:bg-gray-800">
      <p><span className="font-semibold">Metrics file:</span> <code>{logPath}</code></p>
      <p><span className="font-semibold">Events loaded:</span> {metrics.events.length}</p>
      <p><span className="font-semibold">Data source:</span> {formatDataSource(metrics.source)}</p>
      {metrics.snapshotUpdatedAt && (
        <p><span className="font-semibold">Snapshot updated:</span> {formatTimestamp(metrics.snapshotUpdatedAt)}</p>
      )}
      {metrics.snapshotEventCount !== null && (
        <p><span className="font-semibold">Snapshot events:</span> {metrics.snapshotEventCount}</p>
      )}
    </div>
  );
}

function SummaryCard(
  {
    title,
    rows,
    footer,
  }: {
    title: string;
    rows: Array<[string, string]>;
    footer?: string | null;
  },
) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <span className="text-gray-600 dark:text-gray-300">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      </div>
      {footer ? <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{footer}</p> : null}
    </section>
  );
}

function SectionTable(
  {
    title,
    description,
    headers,
    rows,
    emptyLabel,
  }: {
    title: string;
    description: string;
    headers: string[];
    rows: string[][];
    emptyLabel: string;
  },
) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">{description}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                {headers.map((header) => (
                  <th key={header} className="py-2 pr-3">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${title}-${index}`} className="border-b border-gray-100 dark:border-gray-800">
                  {row.map((cell, cellIndex) => (
                    <td key={`${title}-${index}-${cellIndex}`} className="py-2 pr-3">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm text-gray-600 dark:text-gray-300">{label}</p>
    </div>
  );
}

function WarningCard({ warning }: { warning: OverfittingWarning }) {
  const className = warning.severity === 'high'
    ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100'
    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100';

  return (
    <section className={`rounded-xl border p-4 ${className}`}>
      <h2 className="text-lg font-semibold">Overfitting Warning</h2>
      <p className="mt-1 text-sm">{warning.message}</p>
    </section>
  );
}

function LineChart(
  {
    title,
    series,
    valueScale = 1,
    valueSuffix = '',
  }: {
    title: string;
    series: Array<{ label: string; color: string; values: Array<number | null> }>;
    valueScale?: number;
    valueSuffix?: string;
  },
) {
  const maxLength = Math.max(0, ...series.map((line) => line.values.length));
  const finiteValues = series
    .flatMap((line) => line.values)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .map((value) => value * valueScale);

  if (maxLength < 2 || finiteValues.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <h3 className="mb-2 font-semibold">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">Not enough data.</p>
      </div>
    );
  }

  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const pad = (maxValue - minValue) * 0.05 || 1;
  const yMin = minValue - pad;
  const yMax = maxValue + pad;

  const width = 920;
  const height = 220;
  const left = 40;
  const right = 20;
  const top = 20;
  const bottom = 30;

  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const toX = (index: number) => left + (index / (maxLength - 1)) * plotWidth;
  const toY = (value: number) => top + ((yMax - value) / (yMax - yMin)) * plotHeight;

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <h3 className="mb-2 font-semibold">{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full rounded bg-gray-50 dark:bg-gray-900">
        <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke="#94a3b8" strokeWidth="1" />
        <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="#94a3b8" strokeWidth="1" />
        {series.map((line) => {
          const points = line.values
            .map((value, index) => {
              if (value === null || !Number.isFinite(value)) return null;
              return `${toX(index)},${toY(value * valueScale)}`;
            })
            .filter((value): value is string => value !== null);
          if (points.length < 2) return null;
          return (
            <polyline
              key={line.label}
              fill="none"
              stroke={line.color}
              strokeWidth="2"
              points={points.join(' ')}
            />
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {series.map((line) => (
          <div key={line.label} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: line.color }} />
            <span>{line.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
        min={yMin.toFixed(2)}{valueSuffix} max={yMax.toFixed(2)}{valueSuffix} points={maxLength}
      </p>
    </div>
  );
}

function resolveMetricsPath(): string {
  const configured = process.env.HIVE_METRICS_LOG_PATH ?? DEFAULT_HIVE_METRICS_LOG_PATH;
  return path.resolve(process.cwd(), configured);
}

function resolveBundledSnapshotPath(): string {
  return path.resolve(process.cwd(), BUNDLED_HIVE_METRICS_SNAPSHOT_PATH);
}

async function loadMetricEvents(logPath: string): Promise<MetricsLoadResult> {
  const localEvents = readMetricEvents(logPath);
  if (localEvents.length > 0) {
    return {
      events: localEvents,
      source: 'local_file',
      snapshotUpdatedAt: null,
      snapshotEventCount: null,
    };
  }

  const snapshot = await readHiveTrainingMetricsSnapshot();
  if (snapshot) {
    return {
      events: parseMetricEvents(snapshot.content),
      source: 'shared_snapshot',
      snapshotUpdatedAt: snapshot.updated_at,
      snapshotEventCount: snapshot.event_count,
    };
  }

  const bundledSnapshotPath = resolveBundledSnapshotPath();
  const bundledEvents = readMetricEvents(bundledSnapshotPath);
  if (bundledEvents.length > 0) {
    return {
      events: bundledEvents,
      source: 'bundled_snapshot',
      snapshotUpdatedAt: readSnapshotUpdatedAt(bundledSnapshotPath),
      snapshotEventCount: bundledEvents.length,
    };
  }

  return {
    events: [],
    source: 'none',
    snapshotUpdatedAt: null,
    snapshotEventCount: null,
  };
}

function readSnapshotUpdatedAt(absolutePath: string): string | null {
  if (!existsSync(absolutePath)) return null;
  try {
    return statSync(absolutePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function readMetricEvents(absolutePath: string): MetricEvent[] {
  if (!existsSync(absolutePath)) return [];
  return parseMetricEvents(readFileSync(absolutePath, 'utf8'));
}

function parseMetricEvents(raw: string): MetricEvent[] {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const events: MetricEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as MetricEvent;
      if (parsed.runId && parsed.source && parsed.eventType) {
        events.push(parsed);
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  return events;
}

function buildTrainerRuns(events: MetricEvent[]): TrainerRun[] {
  const runs = new Map<string, TrainerRun>();

  for (const event of events) {
    if (event.source !== 'az' || typeof event.runId !== 'string') continue;
    if (!event.runId.startsWith('az-train-stream-') && event.eventType !== 'run_start' && event.eventType !== 'epoch' && event.eventType !== 'run_end') {
      continue;
    }

    let run = runs.get(event.runId);
    if (!run) {
      run = {
        runId: event.runId,
        step: null,
        presetId: null,
        startedAt: null,
        endedAt: null,
        status: null,
        sampleCount: null,
        batchSize: null,
        epochs: [],
      };
      runs.set(event.runId, run);
    }

    if (event.eventType === 'run_start') {
      run.startedAt = asString(event.ts);
      run.step = asNumber(event.step);
      run.presetId = asString(event.presetId) ?? run.presetId;
      run.sampleCount = asNumber(event.sampleCount);
      run.batchSize = asNumber(event.batchSize);
      continue;
    }

    if (event.eventType === 'epoch') {
      const epoch = asNumber(event.epoch);
      if (epoch === null) continue;
      run.step = run.step ?? asNumber(event.step);
      run.presetId = run.presetId ?? asString(event.presetId);
      run.epochs.push({
        epoch,
        totalEpochs: asNumber(event.totalEpochs),
        trainLoss: asNumber(event.trainLoss),
        valLoss: asNumber(event.valLoss),
        trainValueLoss: asNumber(event.trainValueLoss),
        valValueLoss: asNumber(event.valValueLoss),
        trainPolicyLoss: asNumber(event.trainPolicyLoss),
        valPolicyLoss: asNumber(event.valPolicyLoss),
        trainAuxLoss: asNumber(event.trainAuxLoss),
        valAuxLoss: asNumber(event.valAuxLoss),
        trainPolicyEntropy: asNumber(event.trainPolicyEntropy),
        valPolicyEntropy: asNumber(event.valPolicyEntropy),
      });
      continue;
    }

    if (event.eventType === 'run_end') {
      run.endedAt = asString(event.ts);
      run.status = asString(event.status);
      run.step = run.step ?? asNumber(event.step);
      run.sampleCount = run.sampleCount ?? asNumber(event.sampleCount);
      run.presetId = run.presetId ?? asString(event.presetId);
    }
  }

  return [...runs.values()].sort((left, right) => {
    const leftTs = left.startedAt ? Date.parse(left.startedAt) : 0;
    const rightTs = right.startedAt ? Date.parse(right.startedAt) : 0;
    return rightTs - leftTs;
  });
}

function buildArenaResults(events: MetricEvent[]): ArenaResult[] {
  const asyncRows = events
    .filter((event) => event.source === 'az' && event.eventType === 'async_arena_result' && typeof event.runId === 'string')
    .map((event) => ({
      runId: event.runId as string,
      ts: asString(event.ts),
      step: asNumber(event.step),
      presetId: asString(event.presetId),
      games: asNumber(event.stage2Games) ?? asNumber(event.stage1Games),
      configuredGames: asNumber(event.stage2ConfiguredGames) ?? asNumber(event.stage1ConfiguredGames),
      candidateScore: asNumber(event.arenaScore),
      eloEstimate: null,
      scoreCiLow: asNumber(event.finalScoreCiLow),
      scoreCiHigh: asNumber(event.finalScoreCiHigh),
      gateDecisionReason: asString(event.arenaDecisionReason),
      candidateHash: null,
      championHash: null,
      promoted: asBoolean(event.promoted),
      stage2Triggered: asBoolean(event.stage2Triggered),
      stage1Score: asNumber(event.stage1Score),
      stage2Score: asNumber(event.stage2Score),
      severeFailure: asBoolean(event.finalSevereFailure),
    }));

  const completed = events.filter((event) => (
    event.source === 'eval'
    && event.eventType === 'arena_match'
    && event.status === 'completed'
    && typeof event.runId === 'string'
  ));
  const promotionByRun = new Map<string, boolean>();
  for (const event of events) {
    if ((event.eventType === 'promotion_result' || event.eventType === 'promotion_decision') && typeof event.runId === 'string' && typeof event.promoted === 'boolean') {
      promotionByRun.set(event.runId, event.promoted);
    }
  }
  const evalRows = completed.map((event) => ({
    runId: event.runId as string,
    ts: asString(event.ts),
    step: null,
    presetId: null,
    games: asNumber(event.games),
    configuredGames: asNumber(event.configuredGames),
    candidateScore: asNumber(event.candidateScore),
    eloEstimate: asNumber(event.eloEstimate),
    scoreCiLow: asNumber(event.scoreCiLow),
    scoreCiHigh: asNumber(event.scoreCiHigh),
    gateDecisionReason: asString(event.gateDecisionReason),
    candidateHash: asString(event.candidateHash),
    championHash: asString(event.championHash),
    promoted: promotionByRun.get(event.runId as string) ?? null,
    stage2Triggered: null,
    stage1Score: null,
    stage2Score: null,
    severeFailure: null,
  }));
  const rows = [...asyncRows, ...evalRows];

  rows.sort((left, right) => {
    const leftTs = left.ts ? Date.parse(left.ts) : 0;
    const rightTs = right.ts ? Date.parse(right.ts) : 0;
    return rightTs - leftTs;
  });
  return rows;
}

function buildAsyncSummaries(events: MetricEvent[]): AsyncSummary[] {
  const map = new Map<string, AsyncSummary>();

  const getSummary = (runId: string): AsyncSummary => {
    const existing = map.get(runId);
    if (existing) return existing;
    const created: AsyncSummary = {
      runId,
      lastTs: null,
      replaySamples: null,
      totalChunks: null,
      totalGenerated: null,
        latestTrainStep: null,
        latestArenaStep: null,
        bestCheckpointScore: null,
        latestPhase: null,
      };
    map.set(runId, created);
    return created;
  };

  for (const event of events) {
    if (event.source !== 'az' || typeof event.runId !== 'string' || !event.runId.startsWith('az-async-')) continue;
    const summary = getSummary(event.runId);
    if (typeof event.ts === 'string') {
      if (!summary.lastTs || Date.parse(event.ts) >= Date.parse(summary.lastTs)) {
        summary.lastTs = event.ts;
      }
    }

    if (event.eventType === 'async_selfplay_chunk') {
      summary.replaySamples = asNumber(event.replaySamples) ?? summary.replaySamples;
      summary.totalChunks = asNumber(event.totalChunks) ?? summary.totalChunks;
      summary.totalGenerated = asNumber(event.totalGenerated) ?? summary.totalGenerated;
    } else if (event.eventType === 'async_train_step') {
      summary.latestTrainStep = asNumber(event.step) ?? summary.latestTrainStep;
      summary.latestPhase = asString(event.budgetPhase) ?? summary.latestPhase;
    } else if (event.eventType === 'async_arena_result') {
      summary.latestArenaStep = asNumber(event.step) ?? summary.latestArenaStep;
      summary.bestCheckpointScore = asNumber(event.bestCheckpointScore) ?? summary.bestCheckpointScore;
      summary.latestPhase = asString(event.budgetPhase) ?? summary.latestPhase;
    }
  }

  return [...map.values()].sort((left, right) => {
    const leftTs = left.lastTs ? Date.parse(left.lastTs) : 0;
    const rightTs = right.lastTs ? Date.parse(right.lastTs) : 0;
    return rightTs - leftTs;
  });
}

function buildReplayPoints(events: MetricEvent[]): ReplayPoint[] {
  return events
    .filter((event) => event.source === 'az' && event.eventType === 'async_selfplay_chunk')
    .map((event) => ({
      ts: asString(event.ts),
      replaySamples: asNumber(event.replaySamples),
    }))
    .sort((left, right) => {
      const leftTs = left.ts ? Date.parse(left.ts) : 0;
      const rightTs = right.ts ? Date.parse(right.ts) : 0;
      return leftTs - rightTs;
    });
}

function buildStepRows(events: MetricEvent[], trainerRuns: TrainerRun[]): StepRow[] {
  const rows = new Map<number, StepRow>();

  const getRow = (step: number): StepRow => {
    const existing = rows.get(step);
    if (existing) return existing;
    const created: StepRow = {
      step,
      presetId: null,
      replaySamples: null,
      reanalysedSamples: null,
      sampleCount: null,
      trainStatus: null,
      arenaScore: null,
      arenaPromoted: null,
      arenaReason: null,
    };
    rows.set(step, created);
    return created;
  };

  for (const event of events) {
    if (event.source !== 'az') continue;
    const step = asNumber(event.step);
    if (step === null) continue;
    const row = getRow(step);

    if (event.eventType === 'async_train_trigger') {
      row.presetId = asString(event.presetId) ?? row.presetId;
      row.replaySamples = asNumber(event.replaySamples) ?? row.replaySamples;
      row.reanalysedSamples = asNumber(event.reanalysedSamples) ?? row.reanalysedSamples;
    } else if (event.eventType === 'async_train_step') {
      row.trainStatus = asString(event.status) ?? row.trainStatus;
      row.replaySamples = asNumber(event.replaySamplesSnapshot) ?? row.replaySamples;
    } else if (event.eventType === 'async_arena_result') {
      row.presetId = asString(event.presetId) ?? row.presetId;
      row.arenaScore = asNumber(event.arenaScore) ?? row.arenaScore;
      row.arenaPromoted = typeof event.promoted === 'boolean' ? event.promoted : row.arenaPromoted;
      row.arenaReason = asString(event.arenaDecisionReason) ?? row.arenaReason;
    }
  }

  for (const run of trainerRuns) {
    if (run.step === null) continue;
    const row = getRow(run.step);
    row.presetId = row.presetId ?? run.presetId;
    row.sampleCount = run.sampleCount;
    row.trainStatus = run.status ?? row.trainStatus;
  }

  return [...rows.values()].sort((left, right) => right.step - left.step);
}

function buildPresetSummaries(events: MetricEvent[]): PresetSummary[] {
  const map = new Map<string, { runs: number; promotions: number; severeFailures: number; scoreSum: number; ciLowSum: number; scoredRuns: number; ciRuns: number }>();
  for (const event of events) {
    if (event.source !== 'az' || event.eventType !== 'async_arena_result') continue;
    const presetId = asString(event.presetId);
    if (!presetId) continue;
    const entry = map.get(presetId) ?? {
      runs: 0,
      promotions: 0,
      severeFailures: 0,
      scoreSum: 0,
      ciLowSum: 0,
      scoredRuns: 0,
      ciRuns: 0,
    };
    entry.runs += 1;
    if (event.promoted === true) entry.promotions += 1;
    if (event.finalSevereFailure === true) entry.severeFailures += 1;
    const score = asNumber(event.arenaScore);
    const ciLow = asNumber(event.finalScoreCiLow);
    if (score !== null) {
      entry.scoreSum += score;
      entry.scoredRuns += 1;
    }
    if (ciLow !== null) {
      entry.ciLowSum += ciLow;
      entry.ciRuns += 1;
    }
    map.set(presetId, entry);
  }

  return [...map.entries()].map(([presetId, entry]) => ({
    presetId,
    runs: entry.runs,
    promotions: entry.promotions,
    severeFailures: entry.severeFailures,
    avgScore: entry.scoredRuns > 0 ? entry.scoreSum / entry.scoredRuns : null,
    avgCiLow: entry.ciRuns > 0 ? entry.ciLowSum / entry.ciRuns : null,
  })).sort((left, right) => {
    const leftScore = (left.promotions / Math.max(1, left.runs)) * 0.45 + (left.avgScore ?? 0) * 0.2 + (left.avgCiLow ?? 0) * 0.3 - (left.severeFailures / Math.max(1, left.runs)) * 0.55;
    const rightScore = (right.promotions / Math.max(1, right.runs)) * 0.45 + (right.avgScore ?? 0) * 0.2 + (right.avgCiLow ?? 0) * 0.3 - (right.severeFailures / Math.max(1, right.runs)) * 0.55;
    return rightScore - leftScore;
  });
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function formatMetric(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined) return '-';
  return value.toFixed(decimals);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return Math.round(value).toLocaleString();
}

function formatFraction(left: number | null | undefined, right: number | null | undefined): string {
  if (left === null || left === undefined) return '-';
  if (right === null || right === undefined) return formatCount(left);
  return `${formatCount(left)}/${formatCount(right)}`;
}

function formatDataSource(value: MetricsLoadResult['source']): string {
  if (value === 'local_file') return 'Local metrics file';
  if (value === 'shared_snapshot') return 'Shared Supabase snapshot';
  if (value === 'bundled_snapshot') return 'Bundled deployment snapshot';
  return 'No metrics found';
}

function getOverfittingWarning(run: TrainerRun): OverfittingWarning {
  const lastEpoch = run.epochs[run.epochs.length - 1];
  if (!lastEpoch) {
    return { severity: 'none', message: '' };
  }

  const policyGap = difference(lastEpoch.valPolicyLoss, lastEpoch.trainPolicyLoss);
  const lossGap = difference(lastEpoch.valLoss, lastEpoch.trainLoss);
  const entropyGap = difference(lastEpoch.valPolicyEntropy, lastEpoch.trainPolicyEntropy);

  if (policyGap !== null && lossGap !== null && policyGap >= 0.08 && lossGap >= 0.08) {
    return {
      severity: 'high',
      message: `Replay-fit validation is lagging training on this step. Train-vs-val gaps are policy ${policyGap.toFixed(3)}, total loss ${lossGap.toFixed(3)}, entropy ${formatSigned(entropyGap)}. This means replay imitation may be overfitting; confirm with arena results before trusting the update.`,
    };
  }

  if (
    (policyGap !== null && policyGap >= 0.04)
    || (lossGap !== null && lossGap >= 0.04)
    || (entropyGap !== null && entropyGap >= 0.04)
  ) {
    return {
      severity: 'watch',
      message: `Training is pulling ahead of replay-fit validation. Current train-vs-val gaps are policy ${formatSigned(policyGap)}, total loss ${formatSigned(lossGap)}, entropy ${formatSigned(entropyGap)}. This is a replay-fit warning, not proof of weaker play; check staged arena outcomes before changing trainer aggressiveness.`,
    };
  }

  return {
    severity: 'none',
    message: '',
  };
}

function difference(later: number | null | undefined, earlier: number | null | undefined): number | null {
  if (later === null || later === undefined || earlier === null || earlier === undefined) return null;
  return later - earlier;
}

function formatSigned(value: number | null): string {
  if (value === null) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}
