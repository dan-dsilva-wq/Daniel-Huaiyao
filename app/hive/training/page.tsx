import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { AutoRefresh } from './AutoRefresh';

export const dynamic = 'force-dynamic';

type MetricEvent = {
  ts?: string;
  source?: 'linear' | 'deep' | 'az' | 'eval';
  runId?: string;
  eventType?: string;
  [key: string]: unknown;
};

type TrainingRun = {
  runId: string;
  source: 'linear' | 'deep' | 'az';
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
  trainValueLoss: number | null;
  valValueLoss: number | null;
  trainPolicyLoss: number | null;
  valPolicyLoss: number | null;
  trainAuxLoss: number | null;
  valAuxLoss: number | null;
  trainPolicyEntropy: number | null;
  valPolicyEntropy: number | null;
};

type SelfPlayPoint = {
  completedGames: number;
  whiteWins: number | null;
  blackWins: number | null;
  draws: number | null;
};

type CrossRunPoint = {
  runId: string;
  source: 'linear' | 'deep' | 'az';
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
  eloEstimate: number | null;
  avgSimulationsPerMove: number | null;
  searchNodesPerSec: number | null;
  policyEntropy: number | null;
  benchmarkSuite: string | null;
};

type PromotionPoint = {
  runId: string;
  ts: string | null;
  promoted: boolean;
  threshold: number | null;
  candidateScore: number | null;
  eloEstimate: number | null;
  scoreCiLow: number | null;
  scoreCiHigh: number | null;
  gateDecisionReason: string | null;
  promoteOutPath: string | null;
};

type GenerationRow = {
  runId: string;
  ts: string | null;
  candidateHash: string | null;
  championHash: string | null;
  candidateScore: number | null;
  eloEstimate: number | null;
  promoted: boolean | null;
  scoreDelta: number | null;
  eloDelta: number | null;
};

type AzEfficiencyPoint = {
  runId: string;
  ts: string | null;
  positionsPerSecond: number | null;
  avgSimulationsPerMove: number | null;
  replayFreshnessRatio: number | null;
  reanalysedSamples: number | null;
  replaySamples: number | null;
};

const DEFAULT_METRICS_LOG_PATH = '.hive-cache/metrics/training-metrics.jsonl';

export default function HiveTrainingPage() {
  const logPath = resolveMetricsPath();
  const events = readMetricEvents(logPath);
  const runs = buildRuns(events);
  const deepRuns = runs.filter((run) => run.source === 'deep');
  const linearRuns = runs.filter((run) => run.source === 'linear');
  const azRuns = runs.filter((run) => run.source === 'az');
  const crossRunPoints = buildCrossRunPoints(runs);
  const benchmarkPoints = buildBenchmarkPoints(events);
  const promotionPoints = buildPromotionPoints(events);
  const generationRows = buildGenerationRows(events);
  const azEfficiencyPoints = buildAzEfficiencyPoints(events);

  const latestDeep = deepRuns[0] ?? null;
  const latestLinear = linearRuns[0] ?? null;
  const latestAz = azRuns[0] ?? null;
  const latestGeneration = generationRows[0] ?? null;
  const previousGeneration = generationRows[1] ?? null;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <AutoRefresh intervalMs={5000} />
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Hive Training Curves</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Validation and training metrics from local runs.
            </p>
          </div>
          <Link
            href="/hive"
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
          <p><span className="font-semibold">Promotion decisions:</span> {promotionPoints.length}</p>
        </div>

        <BenchmarkSection points={benchmarkPoints} />
        <AzEfficiencySection points={azEfficiencyPoints} />
        <PromotionSection points={promotionPoints} />
        <GenerationSection rows={generationRows} />

        {latestGeneration && previousGeneration && (
          <GenerationCompareCard latest={latestGeneration} previous={previousGeneration} />
        )}

        <CrossRunSection points={crossRunPoints} />

        {latestDeep ? (
          <RunSection title="Latest Deep Run" run={latestDeep} />
        ) : (
          <EmptyCard label="No deep-training metrics found yet." />
        )}

        {latestAz ? (
          <RunSection title="Latest AlphaZero Run" run={latestAz} />
        ) : (
          <EmptyCard label="No AlphaZero metrics found yet." />
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
  const valValueLoss = epochs.map((entry) => entry.valValueLoss);
  const valPolicyLoss = epochs.map((entry) => entry.valPolicyLoss);
  const valAuxLoss = epochs.map((entry) => entry.valAuxLoss);
  const valPolicyEntropy = epochs.map((entry) => entry.valPolicyEntropy);
  const trainPolicyEntropy = epochs.map((entry) => entry.trainPolicyEntropy);
  const games = run.selfPlay.map((entry) => entry.completedGames);
  const whiteWins = run.selfPlay.map((entry) => entry.whiteWins);
  const blackWins = run.selfPlay.map((entry) => entry.blackWins);
  const draws = run.selfPlay.map((entry) => entry.draws);

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Run <code>{run.runId}</code> | started {formatTimestamp(run.startedAt)} | status {run.status ?? 'unknown'}
        </p>
      </div>

      {run.source === 'az' ? (
        <div className="grid md:grid-cols-2 gap-4">
          <LineChart
            title="Total Loss By Epoch"
            series={[
              { label: 'validation loss', color: '#e11d48', values: valMse },
              { label: 'train loss', color: '#0284c7', values: trainMse },
            ]}
          />
          <LineChart
            title="Policy Entropy By Epoch"
            series={[
              { label: 'validation entropy', color: '#16a34a', values: valPolicyEntropy },
              { label: 'train entropy', color: '#a855f7', values: trainPolicyEntropy },
            ]}
          />
          <LineChart
            title="Validation Head Losses"
            series={[
              { label: 'value loss', color: '#7c3aed', values: valValueLoss },
              { label: 'policy loss', color: '#0ea5e9', values: valPolicyLoss },
              { label: 'aux loss', color: '#d97706', values: valAuxLoss },
            ]}
          />
        </div>
      ) : (
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
      )}

      {games.length > 0 ? (
        <LineChart
          title="Self-Play W/L/D Over Games"
          series={[
            { label: 'games completed', color: '#2563eb', values: games },
            { label: 'white wins', color: '#9f1239', values: whiteWins },
            { label: 'black wins', color: '#1f2937', values: blackWins },
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
  const azValMse = points.map((point) => point.source === 'az' ? point.valMse : null);

  const allValAcc = points.map((point) => point.valAcc === null ? null : point.valAcc * 100);
  const deepValAcc = points.map((point) => (
    point.source === 'deep' && point.valAcc !== null ? point.valAcc * 100 : null
  ));
  const linearValAcc = points.map((point) => (
    point.source === 'linear' && point.valAcc !== null ? point.valAcc * 100 : null
  ));
  const azValAcc = points.map((point) => (
    point.source === 'az' && point.valAcc !== null ? point.valAcc * 100 : null
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
            { label: 'az runs', color: '#f59e0b', values: azValMse },
          ]}
        />
        <LineChart
          title="Validation Accuracy % Across Runs"
          series={[
            { label: 'all runs', color: '#16a34a', values: allValAcc },
            { label: 'deep runs', color: '#a855f7', values: deepValAcc },
            { label: 'linear runs', color: '#0ea5e9', values: linearValAcc },
            { label: 'az runs', color: '#d97706', values: azValAcc },
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
      <EmptyCard label="No benchmark eval data yet. Run `npm run hive:eval -- --games 60 --difficulty extreme` to add fixed-opponent progress points." />
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
  const eloSeries = points.map((point) => point.eloEstimate);
  const simsSeries = points.map((point) => point.avgSimulationsPerMove);
  const nodesSeries = points.map((point) => point.searchNodesPerSec);
  const entropySeries = points.map((point) => point.policyEntropy);

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Fixed Benchmark Curves</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Each point is one `hive:eval` run against the same baseline policy.
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
        <LineChart
          title="Elo Estimate Across Runs"
          series={[
            { label: 'elo estimate', color: '#f97316', values: eloSeries },
          ]}
        />
        <LineChart
          title="Search Quality Across Runs"
          series={[
            { label: 'avg sims/move', color: '#f59e0b', values: simsSeries },
            { label: 'nodes/sec', color: '#0ea5e9', values: nodesSeries },
            { label: 'policy entropy', color: '#a855f7', values: entropySeries },
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
              <th className="py-2 pr-3">Elo</th>
              <th className="py-2 pr-3">Sims/Move</th>
              <th className="py-2 pr-3">Draw Causes</th>
              <th className="py-2 pr-3">Suite</th>
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
                `no-progress=${point.noCaptureDraws ?? 0}`,
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
                  <td className="py-2 pr-3">{point.eloEstimate === null ? '-' : point.eloEstimate.toFixed(1)}</td>
                  <td className="py-2 pr-3">{point.avgSimulationsPerMove === null ? '-' : point.avgSimulationsPerMove.toFixed(2)}</td>
                  <td className="py-2 pr-3">{drawCause}</td>
                  <td className="py-2 pr-3">{point.benchmarkSuite ?? '-'}</td>
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

function AzEfficiencySection({ points }: { points: AzEfficiencyPoint[] }) {
  if (points.length === 0) {
    return <EmptyCard label="No AlphaZero efficiency metrics yet. Run `npm run hive:train:az` to log throughput and replay freshness." />;
  }

  const posSeries = points.map((point) => point.positionsPerSecond);
  const simsSeries = points.map((point) => point.avgSimulationsPerMove);
  const freshnessSeries = points.map((point) => (
    point.replayFreshnessRatio === null ? null : point.replayFreshnessRatio * 100
  ));

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">AlphaZero Efficiency + Replay Freshness</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Throughput and replay refresh quality by generation/run.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <LineChart
          title="Throughput Across AZ Runs"
          series={[
            { label: 'positions/sec', color: '#16a34a', values: posSeries },
            { label: 'avg sims/move', color: '#2563eb', values: simsSeries },
          ]}
        />
        <LineChart
          title="Replay Freshness % Across AZ Runs"
          series={[
            { label: 'reanalyzed ratio %', color: '#d97706', values: freshnessSeries },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-3">Run</th>
              <th className="py-2 pr-3">Timestamp</th>
              <th className="py-2 pr-3">Positions/Sec</th>
              <th className="py-2 pr-3">Sims/Move</th>
              <th className="py-2 pr-3">Replay Freshness</th>
              <th className="py-2 pr-3">Reanalyzed</th>
              <th className="py-2 pr-3">Replay Samples</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={`${point.runId}-${index}`} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 pr-3">#{index + 1}</td>
                <td className="py-2 pr-3">{formatTimestamp(point.ts)}</td>
                <td className="py-2 pr-3">{point.positionsPerSecond === null ? '-' : point.positionsPerSecond.toFixed(2)}</td>
                <td className="py-2 pr-3">{point.avgSimulationsPerMove === null ? '-' : point.avgSimulationsPerMove.toFixed(2)}</td>
                <td className="py-2 pr-3">{point.replayFreshnessRatio === null ? '-' : `${(point.replayFreshnessRatio * 100).toFixed(1)}%`}</td>
                <td className="py-2 pr-3">{point.reanalysedSamples === null ? '-' : point.reanalysedSamples}</td>
                <td className="py-2 pr-3">{point.replaySamples === null ? '-' : point.replaySamples}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PromotionSection({ points }: { points: PromotionPoint[] }) {
  if (points.length === 0) {
    return <EmptyCard label="No promotion decisions yet. Run `npm run hive:eval:arena` or `npm run hive:train:az`." />;
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Promotion Decisions</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Arena gate decisions (candidate vs champion).
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-3">Run</th>
              <th className="py-2 pr-3">Timestamp</th>
              <th className="py-2 pr-3">Promoted</th>
              <th className="py-2 pr-3">Score</th>
              <th className="py-2 pr-3">CI</th>
              <th className="py-2 pr-3">Threshold</th>
              <th className="py-2 pr-3">Elo</th>
              <th className="py-2 pr-3">Reason</th>
              <th className="py-2 pr-3">Output</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={`${point.runId}-${index}`} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 pr-3">#{index + 1}</td>
                <td className="py-2 pr-3">{formatTimestamp(point.ts)}</td>
                <td className="py-2 pr-3">{point.promoted ? 'yes' : 'no'}</td>
                <td className="py-2 pr-3">{point.candidateScore === null ? '-' : `${(point.candidateScore * 100).toFixed(1)}%`}</td>
                <td className="py-2 pr-3">
                  {point.scoreCiLow === null || point.scoreCiHigh === null
                    ? '-'
                    : `${(point.scoreCiLow * 100).toFixed(1)}%-${(point.scoreCiHigh * 100).toFixed(1)}%`}
                </td>
                <td className="py-2 pr-3">{point.threshold === null ? '-' : `${(point.threshold * 100).toFixed(1)}%`}</td>
                <td className="py-2 pr-3">{point.eloEstimate === null ? '-' : point.eloEstimate.toFixed(1)}</td>
                <td className="py-2 pr-3">{point.gateDecisionReason ?? '-'}</td>
                <td className="py-2 pr-3"><code>{point.promoteOutPath ?? '-'}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GenerationSection({ rows }: { rows: GenerationRow[] }) {
  if (rows.length === 0) {
    return <EmptyCard label="No generation arena rows yet. Run `hive:train:az` or `hive:eval:arena`." />;
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Generation Table</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Candidate/champion hashes, arena score, Elo, promotion, and deltas.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-gray-200 dark:border-gray-700">
              <th className="py-2 pr-3">Gen</th>
              <th className="py-2 pr-3">Timestamp</th>
              <th className="py-2 pr-3">Candidate Hash</th>
              <th className="py-2 pr-3">Champion Hash</th>
              <th className="py-2 pr-3">Score</th>
              <th className="py-2 pr-3">Elo</th>
              <th className="py-2 pr-3">Promoted</th>
              <th className="py-2 pr-3">Score Δ</th>
              <th className="py-2 pr-3">Elo Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.runId}-${index}`} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-2 pr-3">#{rows.length - index}</td>
                <td className="py-2 pr-3">{formatTimestamp(row.ts)}</td>
                <td className="py-2 pr-3"><code>{row.candidateHash ?? '-'}</code></td>
                <td className="py-2 pr-3"><code>{row.championHash ?? '-'}</code></td>
                <td className="py-2 pr-3">{row.candidateScore === null ? '-' : `${(row.candidateScore * 100).toFixed(1)}%`}</td>
                <td className="py-2 pr-3">{row.eloEstimate === null ? '-' : row.eloEstimate.toFixed(1)}</td>
                <td className="py-2 pr-3">{row.promoted === null ? '-' : row.promoted ? 'yes' : 'no'}</td>
                <td className="py-2 pr-3">{row.scoreDelta === null ? '-' : `${(row.scoreDelta * 100).toFixed(1)}%`}</td>
                <td className="py-2 pr-3">{row.eloDelta === null ? '-' : row.eloDelta.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GenerationCompareCard(
  { latest, previous }: { latest: GenerationRow; previous: GenerationRow },
) {
  const scoreDelta = latest.scoreDelta ?? (
    latest.candidateScore !== null && previous.candidateScore !== null
      ? latest.candidateScore - previous.candidateScore
      : null
  );
  const eloDelta = latest.eloDelta ?? (
    latest.eloEstimate !== null && previous.eloEstimate !== null
      ? latest.eloEstimate - previous.eloEstimate
      : null
  );

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2">
      <h2 className="text-lg font-semibold">Run Compare (Latest Vs Previous)</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Latest run <code>{latest.runId}</code> vs previous <code>{previous.runId}</code>.
      </p>
      <div className="grid md:grid-cols-4 gap-3 text-sm">
        <MetricPill label="Latest Score" value={latest.candidateScore === null ? '-' : `${(latest.candidateScore * 100).toFixed(1)}%`} />
        <MetricPill label="Previous Score" value={previous.candidateScore === null ? '-' : `${(previous.candidateScore * 100).toFixed(1)}%`} />
        <MetricPill label="Score Delta" value={scoreDelta === null ? '-' : `${(scoreDelta * 100).toFixed(1)}%`} />
        <MetricPill label="Elo Delta" value={eloDelta === null ? '-' : eloDelta.toFixed(1)} />
      </div>
    </section>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
      <p className="text-xs text-gray-600 dark:text-gray-300">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
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
  const configured = process.env.HIVE_METRICS_LOG_PATH ?? DEFAULT_METRICS_LOG_PATH;
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
    const source = event.source === 'deep' || event.source === 'linear' || event.source === 'az'
      ? event.source
      : null;
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
      const trainLoss = asNumber(event.trainMse) ?? asNumber(event.trainLoss);
      const valLoss = asNumber(event.valMse) ?? asNumber(event.valLoss);
      const trainEntropy = asNumber(event.trainPolicyEntropy);
      const valEntropy = asNumber(event.valPolicyEntropy);
      run.epochs.push({
        epoch,
        trainMse: trainLoss,
        valMse: valLoss,
        trainAcc: asNumber(event.trainAcc) ?? trainEntropy,
        valAcc: asNumber(event.valAcc) ?? valEntropy,
        trainValueLoss: asNumber(event.trainValueLoss),
        valValueLoss: asNumber(event.valValueLoss),
        trainPolicyLoss: asNumber(event.trainPolicyLoss),
        valPolicyLoss: asNumber(event.valPolicyLoss),
        trainAuxLoss: asNumber(event.trainAuxLoss),
        valAuxLoss: asNumber(event.valAuxLoss),
        trainPolicyEntropy: trainEntropy,
        valPolicyEntropy: valEntropy,
      });
      continue;
    }

    if (event.eventType === 'self_play_progress') {
      const completed = asNumber(event.completedGames);
      if (completed === null) continue;
      run.selfPlay.push({
        completedGames: completed,
        whiteWins: asNumber(event.whiteWins),
        blackWins: asNumber(event.blackWins),
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

  for (const run of map.values()) {
    if (run.startedAt && !run.endedAt && !run.status) {
      run.status = 'running';
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
      eloEstimate: asNumber(event.eloEstimate),
      avgSimulationsPerMove: asNumber(event.avgSimulationsPerMove),
      searchNodesPerSec: asNumber(event.searchNodesPerSec),
      policyEntropy: asNumber(event.policyEntropy),
      benchmarkSuite: typeof event.benchmarkSuite === 'string' ? event.benchmarkSuite : null,
    });
  }

  points.sort((left, right) => {
    const leftTs = left.ts ? Date.parse(left.ts) : 0;
    const rightTs = right.ts ? Date.parse(right.ts) : 0;
    return leftTs - rightTs;
  });
  return points;
}

function buildPromotionPoints(events: MetricEvent[]): PromotionPoint[] {
  const points: PromotionPoint[] = [];

  for (const event of events) {
    if (event.eventType !== 'promotion_decision' && event.eventType !== 'promotion_result') continue;
    const runId = typeof event.runId === 'string' ? event.runId : null;
    if (!runId) continue;

    points.push({
      runId,
      ts: typeof event.ts === 'string' ? event.ts : null,
      promoted: event.promoted === true,
      threshold: asNumber(event.threshold),
      candidateScore: asNumber(event.candidateScore),
      eloEstimate: asNumber(event.eloEstimate),
      scoreCiLow: asNumber(event.scoreCiLow),
      scoreCiHigh: asNumber(event.scoreCiHigh),
      gateDecisionReason: typeof event.gateDecisionReason === 'string' ? event.gateDecisionReason : null,
      promoteOutPath: typeof event.promoteOutPath === 'string' ? event.promoteOutPath : null,
    });
  }

  points.sort((left, right) => {
    const leftTs = left.ts ? Date.parse(left.ts) : 0;
    const rightTs = right.ts ? Date.parse(right.ts) : 0;
    return rightTs - leftTs;
  });

  return points;
}

function buildGenerationRows(events: MetricEvent[]): GenerationRow[] {
  const arenaCompleted = events.filter((event) => (
    event.source === 'eval'
    && event.eventType === 'arena_match'
    && event.status === 'completed'
    && typeof event.runId === 'string'
  ));
  arenaCompleted.sort((left, right) => {
    const leftTs = typeof left.ts === 'string' ? Date.parse(left.ts) : 0;
    const rightTs = typeof right.ts === 'string' ? Date.parse(right.ts) : 0;
    return rightTs - leftTs;
  });

  const promotionByRun = new Map<string, MetricEvent>();
  for (const event of events) {
    if (event.eventType !== 'promotion_decision') continue;
    if (typeof event.runId !== 'string') continue;
    promotionByRun.set(event.runId, event);
  }

  const rows: GenerationRow[] = arenaCompleted.map((event) => {
    const runId = event.runId as string;
    const promotion = promotionByRun.get(runId);
    return {
      runId,
      ts: typeof event.ts === 'string' ? event.ts : null,
      candidateHash: typeof event.candidateHash === 'string' ? event.candidateHash : null,
      championHash: typeof event.championHash === 'string' ? event.championHash : null,
      candidateScore: asNumber(event.candidateScore),
      eloEstimate: asNumber(event.eloEstimate),
      promoted: promotion?.promoted === true ? true : promotion?.promoted === false ? false : null,
      scoreDelta: null,
      eloDelta: null,
    };
  });

  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    const previous = rows[index + 1];
    if (!previous) continue;
    if (current.candidateScore !== null && previous.candidateScore !== null) {
      current.scoreDelta = current.candidateScore - previous.candidateScore;
    }
    if (current.eloEstimate !== null && previous.eloEstimate !== null) {
      current.eloDelta = current.eloEstimate - previous.eloEstimate;
    }
  }

  return rows;
}

function buildAzEfficiencyPoints(events: MetricEvent[]): AzEfficiencyPoint[] {
  const map = new Map<string, AzEfficiencyPoint>();

  const getPoint = (runId: string): AzEfficiencyPoint => {
    const existing = map.get(runId);
    if (existing) return existing;
    const created: AzEfficiencyPoint = {
      runId,
      ts: null,
      positionsPerSecond: null,
      avgSimulationsPerMove: null,
      replayFreshnessRatio: null,
      reanalysedSamples: null,
      replaySamples: null,
    };
    map.set(runId, created);
    return created;
  };

  for (const event of events) {
    if (event.source !== 'az') continue;
    if (typeof event.runId !== 'string') continue;

    const point = getPoint(event.runId);
    if (typeof event.ts === 'string') {
      point.ts = point.ts ?? event.ts;
    }

    if (event.eventType === 'self_play_summary') {
      point.positionsPerSecond = asNumber(event.positionsPerSecond) ?? point.positionsPerSecond;
      point.avgSimulationsPerMove = asNumber(event.avgSimulationsPerMove) ?? point.avgSimulationsPerMove;
      continue;
    }

    if (event.eventType === 'reanalyze_pass') {
      point.replayFreshnessRatio = asNumber(event.replayFreshnessRatio) ?? point.replayFreshnessRatio;
      point.reanalysedSamples = asNumber(event.reanalysedSamples) ?? point.reanalysedSamples;
      point.replaySamples = asNumber(event.replaySamples) ?? point.replaySamples;
      continue;
    }

    if (event.eventType === 'run_end') {
      point.positionsPerSecond = asNumber(event.positionsPerSecond) ?? point.positionsPerSecond;
      point.avgSimulationsPerMove = asNumber(event.avgSimulationsPerMove) ?? point.avgSimulationsPerMove;
      point.replayFreshnessRatio = asNumber(event.replayFreshnessRatio) ?? point.replayFreshnessRatio;
      point.reanalysedSamples = asNumber(event.reanalysedSamples) ?? point.reanalysedSamples;
      point.replaySamples = asNumber(event.replaySamples) ?? point.replaySamples;
    }
  }

  return [...map.values()].sort((left, right) => {
    const leftTs = left.ts ? Date.parse(left.ts) : 0;
    const rightTs = right.ts ? Date.parse(right.ts) : 0;
    return leftTs - rightTs;
  });
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
