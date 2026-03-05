import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  HIVE_ACTION_FEATURE_NAMES,
  HIVE_DEFAULT_TOKEN_SLOTS,
  buildHiveTokenStateFeatureNames,
} from '../../lib/hive/ml';
import { createLocalHiveGameState } from '../../lib/hive/ai';

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface MetricEvent {
  ts?: string;
  source?: string;
  runId?: string;
  eventType?: string;
  [key: string]: unknown;
}

interface SyntheticSample {
  stateFeatures: number[];
  perspective: 'white' | 'black';
  policyTargets: Array<{
    actionKey: string;
    probability: number;
    visitCount: number;
    actionFeatures: number[];
  }>;
  valueTarget: number;
  auxTargets: {
    queenSurroundDelta: number;
    mobility: number;
    lengthBucket: number;
  };
  searchMeta: {
    simulations: number;
    nodesPerSecond: number;
    policyEntropy: number;
    averageDepth: number;
    dirichletAlpha: number;
    temperature: number;
    maxDepth: number;
    reanalysed: boolean;
  };
  stateSnapshot: ReturnType<typeof createLocalHiveGameState>;
}

async function main(): Promise<void> {
  const tempRoot = path.resolve(process.cwd(), '.hive-cache', 'tmp', `pipeline-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });

  try {
    await runSyntheticTrainLossTest(tempRoot);
    await runReplayReanalyseSchemaTest(tempRoot);
    console.log('[test:pipeline] all checks passed');
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

async function runSyntheticTrainLossTest(tempRoot: string): Promise<void> {
  const stateFeatureNames = buildHiveTokenStateFeatureNames(HIVE_DEFAULT_TOKEN_SLOTS);
  const actionFeatureNames = [...HIVE_ACTION_FEATURE_NAMES];
  const datasetPath = path.join(tempRoot, 'synthetic-dataset.json');
  const metricsPath = path.join(tempRoot, 'synthetic-metrics.jsonl');
  const modelOut = path.join(tempRoot, 'synthetic-model.json');
  const samples: SyntheticSample[] = [];
  const stateTemplate = createLocalHiveGameState({
    id: `synthetic-${Date.now()}`,
    shortCode: 'SYN',
    whitePlayerId: 'w',
    blackPlayerId: 'b',
  });

  for (let index = 0; index < 192; index += 1) {
    const sign = index % 2 === 0 ? 1 : -1;
    const stateFeatures = stateFeatureNames.map((_, featureIndex) => {
      const base = featureIndex % 11 === 0 ? sign : 0;
      const wobble = (((index + 1) * (featureIndex + 3)) % 7 - 3) * 0.02;
      return clamp(base + wobble, -1, 1);
    });
    const a1 = actionFeatureNames.map((_, featureIndex) => (
      clamp(((featureIndex + index) % 5 - 2) * 0.15, -1, 1)
    ));
    const a2 = actionFeatureNames.map((_, featureIndex) => (
      clamp(((featureIndex + index + 2) % 5 - 2) * 0.12, -1, 1)
    ));
    const p1 = sign > 0 ? 0.78 : 0.22;
    const p2 = 1 - p1;
    const valueTarget = sign * 0.95;

    samples.push({
      stateFeatures,
      perspective: 'white',
      policyTargets: [
        {
          actionKey: `synthetic:a:${index}`,
          probability: p1,
          visitCount: Math.round(120 * p1),
          actionFeatures: a1,
        },
        {
          actionKey: `synthetic:b:${index}`,
          probability: p2,
          visitCount: Math.round(120 * p2),
          actionFeatures: a2,
        },
      ],
      valueTarget,
      auxTargets: {
        queenSurroundDelta: clamp(sign * 0.6 + ((index % 3) - 1) * 0.05, -1, 1),
        mobility: clamp(sign * 0.45 + ((index % 4) - 1.5) * 0.04, -1, 1),
        lengthBucket: index % 3,
      },
      searchMeta: {
        simulations: 96,
        nodesPerSecond: 1800,
        policyEntropy: 0.61,
        averageDepth: 8.5,
        dirichletAlpha: 0.25,
        temperature: 0.35,
        maxDepth: 120,
        reanalysed: false,
      },
      stateSnapshot: stateTemplate,
    });
  }

  writeFileSync(datasetPath, `${JSON.stringify({
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stateFeatureNames,
    actionFeatureNames,
    samples,
  })}\n`, 'utf8');

  const pythonScript = path.resolve(process.cwd(), 'scripts/hive/train-alphazero.py');
  await runPythonWithFallback([
    pythonScript,
    '--dataset',
    datasetPath,
    '--out',
    modelOut,
    '--epochs',
    '4',
    '--batch-size',
    '64',
    '--hidden',
    '64,32',
    '--seed',
    '7',
    '--metrics-log',
    metricsPath,
  ]);

  if (!existsSync(metricsPath)) {
    throw new Error('Synthetic train test failed: metrics file not produced');
  }

  const events = readMetricEvents(metricsPath);
  const runStart = [...events].reverse().find((event) => (
    event.source === 'az'
    && event.eventType === 'run_start'
    && typeof event.dataset === 'string'
    && path.resolve(event.dataset) === path.resolve(datasetPath)
  ));
  if (!runStart?.runId) {
    throw new Error('Synthetic train test failed: could not find run_start event');
  }

  const epochs = events.filter((event) => (
    event.runId === runStart.runId
    && event.source === 'az'
    && event.eventType === 'epoch'
  ));
  if (epochs.length < 2) {
    throw new Error('Synthetic train test failed: expected >=2 epoch events');
  }

  const firstTrainLoss = asFiniteNumber(epochs[0].trainLoss);
  const lastTrainLoss = asFiniteNumber(epochs[epochs.length - 1].trainLoss);
  if (firstTrainLoss === null || lastTrainLoss === null) {
    throw new Error('Synthetic train test failed: missing trainLoss in epoch metrics');
  }
  if (lastTrainLoss > firstTrainLoss * 1.05) {
    throw new Error(
      `Synthetic train test failed: trainLoss did not improve (${firstTrainLoss.toFixed(4)} -> ${lastTrainLoss.toFixed(4)})`,
    );
  }

  if (!existsSync(modelOut)) {
    throw new Error('Synthetic train test failed: output model missing');
  }
  console.log(
    `[test:pipeline] synthetic loss: ${firstTrainLoss.toFixed(4)} -> ${lastTrainLoss.toFixed(4)}`,
  );
}

async function runReplayReanalyseSchemaTest(tempRoot: string): Promise<void> {
  const datasetPath = path.join(tempRoot, 'pipeline-dataset.json');
  const replayPath = path.join(tempRoot, 'pipeline-replay.json');
  const metricsPath = path.join(tempRoot, 'pipeline-metrics.jsonl');

  await runNodeCommand([
    '--import',
    'tsx',
    path.resolve(process.cwd(), 'scripts/hive/train-alphazero.ts'),
    '--games',
    '1',
    '--difficulty',
    'medium',
    '--simulations',
    '8',
    '--fast-simulations',
    '4',
    '--epochs',
    '1',
    '--skip-training',
    '--skip-arena',
    '--max-turns',
    '30',
    '--no-capture-draw',
    '12',
    '--replay-path',
    replayPath,
    '--replay-max-samples',
    '220',
    '--reanalyse-fraction',
    '0.25',
    '--reanalyse-workers',
    '2',
    '--dataset-out',
    datasetPath,
    '--keep-dataset',
    '--metrics-log',
    metricsPath,
  ]);

  if (!existsSync(datasetPath)) {
    throw new Error('Replay schema test failed: dataset file not produced');
  }

  const payload = JSON.parse(readFileSync(datasetPath, 'utf8')) as {
    version?: number;
    samples?: Array<{
      policyTargets?: Array<{ actionKey?: string; probability?: number; visitCount?: number }>;
      searchMeta?: { reanalysed?: boolean; simulations?: number; averageDepth?: number };
    }>;
  };
  if (payload.version !== 2 || !Array.isArray(payload.samples) || payload.samples.length === 0) {
    throw new Error('Replay schema test failed: invalid dataset header or empty samples');
  }

  let reanalysedCount = 0;
  for (const sample of payload.samples) {
    if (!Array.isArray(sample.policyTargets) || sample.policyTargets.length === 0) {
      throw new Error('Replay schema test failed: sample missing policy targets');
    }
    let probabilitySum = 0;
    for (const target of sample.policyTargets) {
      if (typeof target.actionKey !== 'string' || target.actionKey.length === 0) {
        throw new Error('Replay schema test failed: policy target actionKey missing');
      }
      if (!Number.isFinite(target.probability ?? NaN) || (target.probability as number) < 0) {
        throw new Error('Replay schema test failed: invalid policy probability');
      }
      if (!Number.isFinite(target.visitCount ?? NaN) || (target.visitCount as number) < 0) {
        throw new Error('Replay schema test failed: invalid policy visitCount');
      }
      probabilitySum += target.probability as number;
    }
    if (Math.abs(probabilitySum - 1) > 0.05) {
      throw new Error(`Replay schema test failed: policy probabilities do not sum to ~1 (${probabilitySum.toFixed(3)})`);
    }
    if (!sample.searchMeta || !Number.isFinite(sample.searchMeta.simulations ?? NaN)) {
      throw new Error('Replay schema test failed: searchMeta missing simulations');
    }
    if (!Number.isFinite(sample.searchMeta.averageDepth ?? NaN)) {
      throw new Error('Replay schema test failed: searchMeta missing averageDepth');
    }
    if (sample.searchMeta.reanalysed) {
      reanalysedCount += 1;
    }
  }

  if (reanalysedCount <= 0) {
    throw new Error('Replay schema test failed: expected at least one reanalysed sample');
  }

  console.log(`[test:pipeline] replay schema valid, reanalysed=${reanalysedCount}`);
}

function readMetricEvents(metricsPath: string): MetricEvent[] {
  const raw = readFileSync(metricsPath, 'utf8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const events: MetricEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as MetricEvent;
      events.push(parsed);
    } catch {
      // ignore malformed lines
    }
  }
  return events;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

async function runNodeCommand(args: string[]): Promise<void> {
  const result = await runCommand(process.execPath, args);
  if (result.code !== 0) {
    throw new Error(`Command failed: node ${args.join(' ')}\n${result.stderr}`);
  }
}

async function runPythonWithFallback(args: string[]): Promise<void> {
  const py = await runCommand('python', args);
  if (py.code === 0) return;
  const pyLauncher = await runCommand('py', args);
  if (pyLauncher.code === 0) return;
  throw new Error(`Python command failed.\npython: ${py.stderr}\npy: ${pyLauncher.stderr}`);
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'pipe',
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
    child.on('error', (error) => {
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\n${error instanceof Error ? error.message : String(error)}`,
      });
    });
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[test:pipeline] failed: ${message}`);
  process.exit(1);
});

