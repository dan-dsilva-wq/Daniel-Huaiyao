import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type MetricEvent = {
  ts?: string;
  source?: 'linear' | 'deep' | 'eval';
  runId?: string;
  eventType?: string;
  [key: string]: unknown;
};

type TrainingRun = {
  runId: string;
  source: 'linear' | 'deep';
  startedAt: string | null;
  endedAt: string | null;
  status: string | null;
  options: Record<string, unknown> | null;
  epochs: EpochPoint[];
  selfPlay: SelfPlayPoint[];
  finalMetrics: Record<string, unknown> | null;
};

type EpochPoint = {
  epoch: number;
  trainMse: number | null;
  valMse: number | null;
  trainAcc: number | null;
  valAcc: number | null;
};

type SelfPlayPoint = {
  completedGames: number;
  redWins: number | null;
  blueWins: number | null;
  draws: number | null;
};

type CrossRunPoint = {
  runId: string;
  source: 'linear' | 'deep';
  startedAt: string | null;
  valMse: number | null;
  valAcc: number | null;
};

type BenchmarkPoint = {
  runId: string;
  ts: string | null;
  games: number;
  difficulty: string | null;
  candidateWins: number | null;
  baselineWins: number | null;
  draws: number | null;
  candidateScore: number | null;
  winRate: number | null;
  drawRate: number | null;
  lossRate: number | null;
  avgTurns: number | null;
  maxTurnsDraws: number | null;
  noCaptureDraws: number | null;
  baselineSource: string | null;
};

const DEFAULT_METRICS_LOG_PATH = '.stratego-cache/metrics/training-metrics.jsonl';

export default function StrategoTrainingPage() {
  const logPath = resolveMetricsPath();
  const events = readMetricEvents(logPath);
  const runs = buildRuns(events);
  const deepRuns = runs.filter((run) => run.source === 'deep');
  const linearRuns = runs.filter((run) => run.source === 'linear');
  const crossRunPoints = buildCrossRunPoints(runs);
  const benchmarkPoints = buildBenchmarkPoints(events);

  const latestDeep = deepRuns[0] ?? null;
  const latestLinear = linearRuns[0] ?? null;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Stratego Training Curves</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Validation and training metrics from local runs.
            </p>
          </div>
          <Link
            href="/stratego"
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
          >
            Back To Game
          </Link>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 text-sm">
          <p><span className="font-semibold">Metrics file:</span> <code>{logPath}</code></p>
          <p><span className="font-semibold">Events loaded:</span> {events.length}</p>
          <p><span className="font-semibold">Runs tracked:</span> {runs.length}</p>
          <p><span className="font-semibold">Runs with validation metrics:</span> {crossRunPoints.length}</p>
          <p><span className="font-semibold">Benchmark eval runs:</span> {benchmarkPoints.length}</p>
        </div>

        <BenchmarkSection points={benchmarkPoints} />

        <CrossRunSection points={crossRunPoints} />

        {latestDeep ? (
          <RunSection title="Latest Deep Run" run={latestDeep} />
        ) : (
          <EmptyCard label="No deep-training metrics found yet." />
        )}

        {latestLinear ? (
          <RunSection title="Latest Linear Run" run={latestLinear} />
        ) : (
          <EmptyCard label="No linear-training metrics found yet." />
        )}

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h2 className="text-lg font-semibold mb-3">Recent Runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-200 dark:border-gray-700">
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Run ID</th>
                    <th className="py-2 pr-3">Started</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Epochs</th>
                    <th className="py-2 pr-3">Last Val MSE</th>
                    <th className="py-2 pr-3">Last Val Acc</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 20).map((run) => {
                    const lastEpoch = run.epochs[run.epochs.length - 1];
                    return (
                      <tr key={run.runId} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-2 pr-3">{run.source}</td>
                        <td className="py-2 pr-3"><code>{run.runId}</code></td>
                        <td className="py-2 pr-3">{formatTimestamp(run.startedAt)}</td>
                        <td className="py-2 pr-3">{run.status ?? '-'}</td>
                        <td className="py-2 pr-3">{run.epochs.length}</td>
                        <td className="py-2 pr-3">{formatMetric(lastEpoch?.valMse)}</td>
                        <td className="py-2 pr-3">{formatPercent(lastEpoch?.valAcc)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function RunSection({ title, run }: { title: string; run: TrainingRun }) {
  const epochs = [...run.epochs].sort((a, b) => a.epoch - b.epoch);
  const valMse = epochs.map((entry) => entry.valMse);
  const trainMse = epochs.map((entry) => entry.trainMse);
  const valAcc = epochs.map((entry) => entry.valAcc === null ? null : entry.valAcc * 100);
  const trainAcc = epochs.map((entry) => entry.trainAcc === null ? null : entry.trainAcc * 100);
  const games = run.selfPlay.map((entry) => entry.completedGames);
  const redWins = run.selfPlay.map((entry) => entry.redWins);
  const blueWins = run.selfPlay.map((entry) => entry.blueWins);
  const draws = run.selfPlay.map((entry) => entry.draws);

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Run <code>{run.runId}</code> | started {formatTimestamp(run.startedAt)} | status {run.status ?? 'unknown'}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <LineChart
          title="MSE By Epoch"
          series={[
            { label: 'validation mse', color: '#e11d48', values: valMse },
            { label: 'train mse', color: '#0284c7', values: trainMse },
          ]}
        />
        <LineChart
          title="Accuracy % By Epoch"
          series={[
            { label: 'validation acc', color: '#16a34a', values: valAcc },
            { label: 'train acc', color: '#a855f7', values: trainAcc },
          ]}
        />
      </div>

      {games.length > 0 ? (
        <LineChart
          title="Self-Play W/L/D Over Games"
          series={[
            { label: 'games completed', color: '#2563eb', values: games },
            { label: 'red wins', color: '#dc2626', values: redWins },
            { label: 'blue wins', color: '#1d4ed8', values: blueWins },
            { label: 'draws', color: '#6b7280', values: draws },
          ]}
        />
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-300">No self-play progress events logged for this run.</p>
      )}
    </section>
  );
}

function CrossRunSection({ points }: { points: CrossRunPoint[] }) {
  if (points.length === 0) {
    return <EmptyCard label="No cross-run curve data yet. Complete at least one run with epoch metrics." />;
  }

  const allValMse = points.map((point) => point.valMse);
  const deepValMse = points.map((point) => point.source === 'deep' ? point.valMse : null);
  const linearValMse = points.map((point) => point.source === 'linear' ? point.valMse : null);

  const allValAcc = points.map((point) => point.valAcc === null ? null : point.valAcc * 100);
  const deepValAcc = points.map((point) => (
    point.source === 'deep' && point.valAcc !== null ? point.valAcc * 100 : null
  ));
  const linearValAcc = points.map((point) => (
    point.source === 'linear' && point.valAcc !== null ? point.valAcc * 100 : null
  ));

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Overall Cross-Run Curves</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Tracks one point per run (oldest to newest), so you can see long-term trend.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <LineChart
          title="Validation MSE Across Runs"
          series={[
            { label: 'all runs', color: '#e11d48', values: allValMse },
            { label: 'deep runs', color: '#7c3aed', values: deepValMse },
            { label: 'linear runs', color: '#0284c7', values: linearValMse },
          ]}
        />
        <LineChart
          title="Validation Accuracy % Across Runs"
          series={[
            { label: 'all runs', color: '#16a34a', values: allValAcc },
            { label: 'deep runs', color: '#a855f7', values: deepValAcc },
            { label: 'linear runs', color: '#0ea5e9', values: linearValAcc },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-3">Run</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Started</th>
              <th className="py-2 pr-3">Val MSE</th>
              <th className="py-2 pr-3">Val Acc</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={point.runId} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 pr-3">#{index + 1}</td>
                <td className="py-2 pr-3">{point.source}</td>
                <td className="py-2 pr-3">{formatTimestamp(point.startedAt)}</td>
                <td className="py-2 pr-3">{formatMetric(point.valMse)}</td>
                <td className="py-2 pr-3">{formatPercent(point.valAcc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BenchmarkSection({ points }: { points: BenchmarkPoint[] }) {
  if (points.length === 0) {
    return (
      <EmptyCard label="No benchmark eval data yet. Run `npm run stratego:eval -- --games 60 --difficulty extreme` to add fixed-opponent progress points." />
    );
  }

  const scoreSeries = points.map((point) => (
    point.candidateScore === null ? null : point.candidateScore * 100
  ));
  const winRateSeries = points.map((point) => (
    point.winRate === null ? null : point.winRate * 100
  ));
  const drawRateSeries = points.map((point) => (
    point.drawRate === null ? null : point.drawRate * 100
  ));
  const lossRateSeries = points.map((point) => (
    point.lossRate === null ? null : point.lossRate * 100
  ));
  const avgTurnsSeries = points.map((point) => point.avgTurns);

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Fixed Benchmark Curves</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Each point is one `stratego:eval` run against the same baseline policy.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <LineChart
          title="Benchmark Score % Across Runs"
          series={[
            { label: 'candidate score %', color: '#16a34a', values: scoreSeries },
            { label: 'win rate %', color: '#1d4ed8', values: winRateSeries },
            { label: 'draw rate %', color: '#6b7280', values: drawRateSeries },
            { label: 'loss rate %', color: '#dc2626', values: lossRateSeries },
          ]}
        />
        <LineChart
          title="Average Turns Across Runs"
          series={[
            { label: 'avg turns', color: '#7c3aed', values: avgTurnsSeries },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-3">Run</th>
              <th className="py-2 pr-3">Started</th>
              <th className="py-2 pr-3">Games</th>
              <th className="py-2 pr-3">Difficulty</th>
              <th className="py-2 pr-3">Score</th>
              <th className="py-2 pr-3">W/D/L</th>
              <th className="py-2 pr-3">Avg Turns</th>
              <th className="py-2 pr-3">Draw Causes</th>
              <th className="py-2 pr-3">Baseline</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => {
              const wins = point.candidateWins ?? (
                point.winRate === null ? null : Math.round(point.winRate * point.games)
              );
              const draws = point.draws ?? (
                point.drawRate === null ? null : Math.round(point.drawRate * point.games)
              );
              const losses = point.baselineWins ?? (
                point.lossRate === null ? null : Math.round(point.lossRate * point.games)
              );
              const drawCause = [
                `max-turns=${point.maxTurnsDraws ?? 0}`,
                `no-capture=${point.noCaptureDraws ?? 0}`,
              ].join(' ');

              return (
                <tr key={point.runId} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 pr-3">#{index + 1}</td>
                  <td className="py-2 pr-3">{formatTimestamp(point.ts)}</td>
                  <td className="py-2 pr-3">{point.games}</td>
                  <td className="py-2 pr-3">{point.difficulty ?? '-'}</td>
                  <td className="py-2 pr-3">{point.candidateScore === null ? '-' : `${(point.candidateScore * 100).toFixed(1)}%`}</td>
                  <td className="py-2 pr-3">{wins === null || draws === null || losses === null ? '-' : `${wins}/${draws}/${losses}`}</td>
                  <td className="py-2 pr-3">{point.avgTurns === null ? '-' : point.avgTurns.toFixed(1)}</td>
                  <td className="py-2 pr-3">{drawCause}</td>
                  <td className="py-2 pr-3">{point.baselineSource ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <p className="text-sm text-gray-600 dark:text-gray-300">{label}</p>
    </div>
  );
}

function LineChart(
  {
    title,
    series,
  }: {
    title: string;
    series: Array<{ label: string; color: string; values: Array<number | null> }>;
  },
) {
  const maxLength = Math.max(0, ...series.map((line) => line.values.length));
  const finiteValues = series.flatMap((line) => line.values).filter((value): value is number => (
    typeof value === 'number' && Number.isFinite(value)
  ));

  if (maxLength < 2 || finiteValues.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
        <h3 className="font-semibold mb-2">{title}</h3>
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
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <h3 className="font-semibold mb-2">{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56 rounded bg-gray-50 dark:bg-gray-900">
        <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} stroke="#94a3b8" strokeWidth="1" />
        <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="#94a3b8" strokeWidth="1" />

        {series.map((line) => {
          const points = line.values
            .map((value, index) => {
              if (value === null || !Number.isFinite(value)) return null;
              return `${toX(index)},${toY(value)}`;
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
            <span className="inline-block w-3 h-0.5" style={{ background: line.color }} />
            <span>{line.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
        min={yMin.toFixed(4)} max={yMax.toFixed(4)} points={maxLength}
      </p>
    </div>
  );
}

function resolveMetricsPath(): string {
  const configured = process.env.STRATEGO_METRICS_LOG_PATH ?? DEFAULT_METRICS_LOG_PATH;
  return path.resolve(process.cwd(), configured);
}

function readMetricEvents(absolutePath: string): MetricEvent[] {
  if (!existsSync(absolutePath)) return [];
  const raw = readFileSync(absolutePath, 'utf8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const events: MetricEvent[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as MetricEvent;
      if (parsed.runId && parsed.source && parsed.eventType) {
        events.push(parsed);
      }
    } catch {
      // Skip malformed lines.
    }
  }

  return events;
}

function buildRuns(events: MetricEvent[]): TrainingRun[] {
  const map = new Map<string, TrainingRun>();

  for (const event of events) {
    const runId = typeof event.runId === 'string' ? event.runId : null;
    const source = event.source === 'deep' || event.source === 'linear' ? event.source : null;
    if (!runId || !source) continue;

    let run = map.get(runId);
    if (!run) {
      run = {
        runId,
        source,
        startedAt: null,
        endedAt: null,
        status: null,
        options: null,
        epochs: [],
        selfPlay: [],
        finalMetrics: null,
      };
      map.set(runId, run);
    }

    if (event.eventType === 'run_start') {
      run.startedAt = typeof event.ts === 'string' ? event.ts : run.startedAt;
      run.options = isRecord(event.options) ? event.options : run.options;
      continue;
    }

    if (event.eventType === 'epoch') {
      const epoch = asNumber(event.epoch);
      if (epoch === null) continue;
      run.epochs.push({
        epoch,
        trainMse: asNumber(event.trainMse),
        valMse: asNumber(event.valMse),
        trainAcc: asNumber(event.trainAcc),
        valAcc: asNumber(event.valAcc),
      });
      continue;
    }

    if (event.eventType === 'self_play_progress') {
      const completed = asNumber(event.completedGames);
      if (completed === null) continue;
      run.selfPlay.push({
        completedGames: completed,
        redWins: asNumber(event.redWins),
        blueWins: asNumber(event.blueWins),
        draws: asNumber(event.draws),
      });
      continue;
    }

    if (event.eventType === 'run_end') {
      run.endedAt = typeof event.ts === 'string' ? event.ts : run.endedAt;
      run.status = typeof event.status === 'string' ? event.status : run.status;
      run.finalMetrics = event;
    }
  }

  return [...map.values()].sort((left, right) => {
    const leftTs = left.startedAt ? Date.parse(left.startedAt) : 0;
    const rightTs = right.startedAt ? Date.parse(right.startedAt) : 0;
    return rightTs - leftTs;
  });
}

function buildCrossRunPoints(runs: TrainingRun[]): CrossRunPoint[] {
  const chronological = [...runs].sort((left, right) => {
    const leftTs = left.startedAt ? Date.parse(left.startedAt) : 0;
    const rightTs = right.startedAt ? Date.parse(right.startedAt) : 0;
    return leftTs - rightTs;
  });

  const points: CrossRunPoint[] = [];

  for (const run of chronological) {
    const sortedEpochs = [...run.epochs].sort((left, right) => left.epoch - right.epoch);
    const lastEpoch = sortedEpochs[sortedEpochs.length - 1];
    const endValMse = lastEpoch?.valMse ?? asNumber(run.finalMetrics?.valMse);
    const endValAcc = lastEpoch?.valAcc ?? asNumber(run.finalMetrics?.valAcc);
    if (endValMse === null && endValAcc === null) continue;

    points.push({
      runId: run.runId,
      source: run.source,
      startedAt: run.startedAt,
      valMse: endValMse,
      valAcc: endValAcc,
    });
  }

  return points;
}

function buildBenchmarkPoints(events: MetricEvent[]): BenchmarkPoint[] {
  const points: BenchmarkPoint[] = [];

  for (const event of events) {
    if (event.source !== 'eval') continue;
    if (event.eventType !== 'benchmark_result') continue;

    const runId = typeof event.runId === 'string' ? event.runId : null;
    if (!runId) continue;

    const games = asNumber(event.games);
    if (games === null || games <= 0) continue;

    points.push({
      runId,
      ts: typeof event.ts === 'string' ? event.ts : null,
      games,
      difficulty: typeof event.difficulty === 'string' ? event.difficulty : null,
      candidateWins: asNumber(event.candidateWins),
      baselineWins: asNumber(event.baselineWins),
      draws: asNumber(event.draws),
      candidateScore: asNumber(event.candidateScore),
      winRate: asNumber(event.winRate),
      drawRate: asNumber(event.drawRate),
      lossRate: asNumber(event.lossRate),
      avgTurns: asNumber(event.avgTurns),
      maxTurnsDraws: asNumber(event.maxTurnsDraws),
      noCaptureDraws: asNumber(event.noCaptureDraws),
      baselineSource: typeof event.baselineSource === 'string' ? event.baselineSource : null,
    });
  }

  points.sort((left, right) => {
    const leftTs = left.ts ? Date.parse(left.ts) : 0;
    const rightTs = right.ts ? Date.parse(right.ts) : 0;
    return leftTs - rightTs;
  });
  return points;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return value.toFixed(4);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${(value * 100).toFixed(1)}%`;
}
