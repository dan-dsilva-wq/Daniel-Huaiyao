import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

interface CheckpointOptions {
  label: string | null;
  includeMetrics: boolean;
}

interface BestLearnerCheckpoint {
  championHash: string;
  arenaScore: number;
  savedAt: string;
  step: number;
  arenaDecisionReason: string | null;
}

interface MetricsSummary {
  runId: string | null;
  budgetPhase: string | null;
  lastTrainStep: number | null;
  lastTrainStage: string | null;
  replaySamples: number | null;
  newSamplesSinceTrain: number | null;
  totalGenerated: number | null;
  totalChunks: number | null;
  championMergedSamples: number | null;
  learnerMergedSamples: number | null;
  lastEventTs: string | null;
}

interface ArtifactSummary {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

const REPO_ROOT = path.resolve(process.cwd());
const CHECKPOINTS_DIR = path.join(REPO_ROOT, '.hive-cache', 'checkpoints');
const DEFAULT_METRICS_LOG = path.join(REPO_ROOT, '.hive-cache', 'metrics', 'training-metrics.jsonl');

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '').replace('T', '-').replace('Z', 'Z');
  const slug = options.label ? `-${slugify(options.label)}` : '';
  const checkpointDir = path.join(CHECKPOINTS_DIR, `${timestamp}${slug}`);

  mkdirSync(checkpointDir, { recursive: true });

  const artifactsDir = path.join(checkpointDir, 'artifacts');
  const codeDir = path.join(checkpointDir, 'code');
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(codeDir, { recursive: true });

  cpSync(path.join(REPO_ROOT, 'scripts', 'hive'), path.join(codeDir, 'scripts', 'hive'), { recursive: true });
  copyIfExists(path.join(REPO_ROOT, 'lib', 'hive'), path.join(codeDir, 'lib', 'hive'));
  copyIfExists(path.join(REPO_ROOT, 'HIVE_ML_TRAINING.md'), path.join(codeDir, 'HIVE_ML_TRAINING.md'));
  copyIfExists(path.join(REPO_ROOT, 'package.json'), path.join(codeDir, 'package.json'));
  copyIfExists(path.join(REPO_ROOT, 'package-lock.json'), path.join(codeDir, 'package-lock.json'));

  copyIfExists(path.join(REPO_ROOT, 'lib', 'hive', 'trained-model.json'), path.join(artifactsDir, 'trained-model.json'));
  copyIfExists(path.join(REPO_ROOT, '.hive-cache', 'az-learner-model.json'), path.join(artifactsDir, 'az-learner-model.json'));
  copyIfExists(path.join(REPO_ROOT, '.hive-cache', 'az-candidate-model.json'), path.join(artifactsDir, 'az-candidate-model.json'));
  copyIfExists(path.join(REPO_ROOT, '.hive-cache', 'az-best-learner-model.json'), path.join(artifactsDir, 'az-best-learner-model.json'));
  copyIfExists(path.join(REPO_ROOT, '.hive-cache', 'az-best-learner-model.meta.json'), path.join(artifactsDir, 'az-best-learner-model.meta.json'));
  copyIfExists(path.join(REPO_ROOT, '.hive-cache', 'az-replay-buffer.json'), path.join(artifactsDir, 'az-replay-buffer.json'));

  if (options.includeMetrics) {
    copyIfExists(DEFAULT_METRICS_LOG, path.join(artifactsDir, 'training-metrics.jsonl'));
  }

  const gitStatus = safeGit(['status', '--short', '--branch']);
  const gitHead = safeGit(['rev-parse', 'HEAD']).trim() || null;
  const relevantDiff = safeGit([
    'diff',
    '--binary',
    '--',
    'scripts/hive',
    'lib/hive/trained-model.json',
    'HIVE_ML_TRAINING.md',
    'package.json',
    'package-lock.json',
  ]);

  writeFileSync(path.join(checkpointDir, 'git-status.txt'), gitStatus, 'utf8');
  writeFileSync(path.join(checkpointDir, 'git-diff.patch'), relevantDiff, 'utf8');

  const bestLearner = readBestLearnerCheckpoint(path.join(REPO_ROOT, '.hive-cache', 'az-best-learner-model.meta.json'));
  const metricsSummary = summarizeMetrics(options.includeMetrics ? path.join(artifactsDir, 'training-metrics.jsonl') : DEFAULT_METRICS_LOG);
  const artifactSummaries = collectArtifactSummaries(artifactsDir);

  const summary = {
    createdAt: new Date().toISOString(),
    label: options.label,
    checkpointDir,
    git: {
      head: gitHead,
      statusDirty: gitStatus.split('\n').some((line) => line.startsWith(' M') || line.startsWith('MM') || line.startsWith('A ') || line.startsWith('??') || line.startsWith(' D')),
    },
    bestLearner,
    metricsSummary,
    artifacts: artifactSummaries,
  };

  writeFileSync(path.join(checkpointDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(checkpointDir, 'README.md'), renderReadme(summary), 'utf8');

  console.log(`Hive training checkpoint created at ${checkpointDir}`);
}

function parseArgs(argv: string[]): CheckpointOptions {
  const options: CheckpointOptions = {
    label: null,
    includeMetrics: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--label':
      case '-l':
        if (!next) throw new Error(`Missing value for ${arg}`);
        options.label = next;
        index += 1;
        break;
      case '--no-metrics':
        options.includeMetrics = false;
        break;
      case '--help':
      case '-h':
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelpAndExit(): never {
  console.log('Usage: npm run hive:checkpoint -- [options]');
  console.log('  --label, -l <text>     Optional label appended to the checkpoint folder name');
  console.log('  --no-metrics           Skip copying the full training metrics log');
  process.exit(0);
}

function copyIfExists(sourcePath: string, destinationPath: string): void {
  if (!existsSync(sourcePath)) return;
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  const stats = statSync(sourcePath);
  if (stats.isDirectory()) {
    cpSync(sourcePath, destinationPath, { recursive: true });
    return;
  }
  copyFileSync(sourcePath, destinationPath);
}

function safeGit(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '') : '';
    return stderr;
  }
}

function readBestLearnerCheckpoint(metaPath: string): BestLearnerCheckpoint | null {
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<BestLearnerCheckpoint>;
    if (
      typeof parsed.championHash !== 'string'
      || typeof parsed.arenaScore !== 'number'
      || typeof parsed.savedAt !== 'string'
      || typeof parsed.step !== 'number'
    ) {
      return null;
    }
    return {
      championHash: parsed.championHash,
      arenaScore: parsed.arenaScore,
      savedAt: parsed.savedAt,
      step: parsed.step,
      arenaDecisionReason: typeof parsed.arenaDecisionReason === 'string' ? parsed.arenaDecisionReason : null,
    };
  } catch {
    return null;
  }
}

function summarizeMetrics(metricsPath: string): MetricsSummary | null {
  if (!existsSync(metricsPath)) return null;
  const lines = readFileSync(metricsPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const summary: MetricsSummary = {
    runId: null,
    budgetPhase: null,
    lastTrainStep: null,
    lastTrainStage: null,
    replaySamples: null,
    newSamplesSinceTrain: null,
    totalGenerated: null,
    totalChunks: null,
    championMergedSamples: null,
    learnerMergedSamples: null,
    lastEventTs: null,
  };

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (typeof parsed.runId === 'string') summary.runId = parsed.runId;
    if (typeof parsed.ts === 'string') summary.lastEventTs = parsed.ts;
    if (typeof parsed.budgetPhase === 'string') summary.budgetPhase = parsed.budgetPhase;
    if (typeof parsed.replaySamples === 'number') summary.replaySamples = parsed.replaySamples;
    if (typeof parsed.newSamplesSinceTrain === 'number') summary.newSamplesSinceTrain = parsed.newSamplesSinceTrain;
    if (typeof parsed.totalGenerated === 'number') summary.totalGenerated = parsed.totalGenerated;
    if (typeof parsed.totalChunks === 'number') summary.totalChunks = parsed.totalChunks;
    if (typeof parsed.championMergedSamples === 'number') summary.championMergedSamples = parsed.championMergedSamples;
    if (typeof parsed.learnerMergedSamples === 'number') summary.learnerMergedSamples = parsed.learnerMergedSamples;

    if (parsed.eventType === 'async_train_stage') {
      if (typeof parsed.step === 'number') summary.lastTrainStep = parsed.step;
      if (typeof parsed.stage === 'string') summary.lastTrainStage = parsed.stage;
    }
  }

  return summary;
}

function collectArtifactSummaries(rootDir: string): ArtifactSummary[] {
  const targets = [
    'trained-model.json',
    'az-learner-model.json',
    'az-candidate-model.json',
    'az-best-learner-model.json',
    'az-best-learner-model.meta.json',
    'az-replay-buffer.json',
    'training-metrics.jsonl',
  ];

  return targets
    .map((relativePath) => path.join(rootDir, relativePath))
    .filter((absolutePath) => existsSync(absolutePath))
    .map((absolutePath) => ({
      relativePath: path.relative(rootDir, absolutePath),
      sizeBytes: statSync(absolutePath).size,
      sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex'),
    }));
}

function renderReadme(summary: {
  createdAt: string;
  label: string | null;
  checkpointDir: string;
  git: { head: string | null; statusDirty: boolean };
  bestLearner: BestLearnerCheckpoint | null;
  metricsSummary: MetricsSummary | null;
  artifacts: ArtifactSummary[];
}): string {
  const metrics = summary.metricsSummary;
  const bestLearner = summary.bestLearner;
  const lines = [
    '# Hive Training Checkpoint',
    '',
    `- Created at: ${summary.createdAt}`,
    `- Label: ${summary.label ?? '(none)'}`,
    `- Git HEAD: ${summary.git.head ?? '(unknown)'}`,
    `- Working tree dirty: ${summary.git.statusDirty ? 'yes' : 'no'}`,
    '',
    '## Training State',
    '',
    `- Latest run ID: ${metrics?.runId ?? '(unknown)'}`,
    `- Budget phase: ${metrics?.budgetPhase ?? '(unknown)'}`,
    `- Last train step: ${metrics?.lastTrainStep ?? '(unknown)'}`,
    `- Last train stage: ${metrics?.lastTrainStage ?? '(unknown)'}`,
    `- Replay samples: ${formatNumber(metrics?.replaySamples)}`,
    `- New samples since train: ${formatNumber(metrics?.newSamplesSinceTrain)}`,
    `- Total generated samples: ${formatNumber(metrics?.totalGenerated)}`,
    `- Total chunks: ${formatNumber(metrics?.totalChunks)}`,
    `- Champion merged samples: ${formatNumber(metrics?.championMergedSamples)}`,
    `- Learner merged samples: ${formatNumber(metrics?.learnerMergedSamples)}`,
    `- Latest metrics event: ${metrics?.lastEventTs ?? '(unknown)'}`,
    '',
    '## Best Learner',
    '',
    `- Champion hash: ${bestLearner?.championHash ?? '(none)'}`,
    `- Arena score: ${bestLearner?.arenaScore ?? '(none)'}`,
    `- Saved at: ${bestLearner?.savedAt ?? '(none)'}`,
    `- Step: ${bestLearner?.step ?? '(none)'}`,
    `- Reason: ${bestLearner?.arenaDecisionReason ?? '(none)'}`,
    '',
    '## Included Artifacts',
    '',
    ...summary.artifacts.map((artifact) => `- ${artifact.relativePath} (${artifact.sizeBytes} bytes, sha256 ${artifact.sha256.slice(0, 12)})`),
    '',
    '## Notes',
    '',
    '- `code/` contains the current Hive training code and docs snapshot.',
    '- `artifacts/` contains the current models, replay buffer, and metrics log copy.',
    '- `git-status.txt` and `git-diff.patch` capture the repo state for Hive-related files.',
  ];

  return `${lines.join('\n')}\n`;
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '(unknown)';
  return value.toLocaleString('en-US');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

main();
