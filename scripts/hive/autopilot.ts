import { ChildProcess, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getHiveHardwareProfile } from './hardware-profile';

type RunMode = 'linear' | 'deep' | 'deep-eval' | 'alphazero-eval';

interface AutopilotOptions {
  mode: RunMode;
  generations: number;
  pauseSeconds: number;
  git: boolean;
  push: boolean;
  deploy: boolean;
  deployCommand: string;
  gitPaths: string[];
  commitMessage: string;
  continueOnError: boolean;
  metricsLogPath: string;
  requireStablePromotions: boolean | null;
  stabilityWindow: number;
  summaryPath: string;
  historyLogPath: string;
  generationArgs: string[];
}

interface ParsedArgs {
  options: AutopilotOptions;
  help: boolean;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RunCommandOptions {
  stdio?: 'inherit' | 'pipe';
  throwOnNonZero?: boolean;
}

interface SyncResult {
  stagedPaths: string[];
  committed: boolean;
  pushed: boolean;
  deployed: boolean;
  commitHash?: string;
}

interface StabilityGateResult {
  enabled: boolean;
  passed: boolean;
  reason: string;
  requiredWindow: number;
  consecutivePromoted: number;
  checkedRunIds: string[];
}

interface PromotionDecisionEvent {
  tsMs: number;
  runId: string;
  promoted: boolean;
  scoreCiLow: number | null;
  scoreCiHigh: number | null;
  gateDecisionReason: string | null;
}

const DEFAULT_OPTIONS: AutopilotOptions = {
  mode: 'deep-eval',
  generations: 0,
  pauseSeconds: 15,
  git: true,
  push: true,
  deploy: true,
  deployCommand: 'vercel --prod',
  gitPaths: [
    'lib/hive/trained-model.json',
    '.hive-cache/deep-replay-buffer.json',
    '.hive-cache/az-replay-buffer.json',
    '.hive-cache/az-candidate-model.json',
  ],
  commitMessage: 'hive: autopilot gen {generation} ({mode})',
  continueOnError: false,
  metricsLogPath: '.hive-cache/metrics/training-metrics.jsonl',
  requireStablePromotions: null,
  stabilityWindow: 3,
  summaryPath: '.hive-cache/tune/last-tune.json',
  historyLogPath: '.hive-cache/autopilot/history.jsonl',
  generationArgs: [],
};

const HARDWARE_PROFILE = getHiveHardwareProfile();
const DEFAULT_DEEP_TRAIN_ARGS = createDefaultDeepTrainArgs();
const DEFAULT_AZ_TRAIN_ARGS = createDefaultAzTrainArgs();

let interrupted = false;
let activeChild: ChildProcess | null = null;

async function main(): Promise<void> {
  const parsed = parseOptions(process.argv.slice(2));
  if (parsed.help) {
    printUsageAndExit();
  }

  const options = parsed.options;
  installSignalHandlers();
  const enforceStability = options.requireStablePromotions ?? (options.mode === 'alphazero-eval');

  if (!options.git) {
    options.push = false;
  }

  log(
    'setup',
    `mode=${options.mode} generations=${options.generations === 0 ? 'infinite' : options.generations} pause=${options.pauseSeconds}s git=${options.git ? 'on' : 'off'} push=${options.push ? 'on' : 'off'} deploy=${options.deploy ? 'on' : 'off'}`,
  );
  if (options.mode === 'alphazero-eval') {
    log(
      'setup',
      `stability_gate=${enforceStability ? 'on' : 'off'} window=${options.stabilityWindow} metrics=${path.resolve(process.cwd(), options.metricsLogPath)}`,
    );
  }
  log(
    'setup',
    `hardware cpu=${HARDWARE_PROFILE.logicalCpuCount} ram=${HARDWARE_PROFILE.totalMemoryGiB.toFixed(1)}GiB deep_workers=${HARDWARE_PROFILE.selfPlayWorkers} deep_batch=${HARDWARE_PROFILE.deepBatchSize}`,
  );
  log('setup', `history=${path.resolve(process.cwd(), options.historyLogPath)}`);
  if (options.generationArgs.length > 0) {
    log('setup', `generation args=${options.generationArgs.join(' ')}`);
  }

  let generation = 0;
  while (!interrupted && (options.generations === 0 || generation < options.generations)) {
    generation += 1;
    const generationLabel =
      options.generations > 0 ? `${generation}/${options.generations}` : `${generation}`;
    const generationStartedAt = Date.now();

    log('generation', `start ${generationLabel}`);
    appendHistoryEvent(options.historyLogPath, {
      ts: new Date().toISOString(),
      event: 'generation_start',
      generation,
      mode: options.mode,
    });

    try {
      await runGeneration(options, generation);
      const stability = evaluateStabilityGate(options, enforceStability);

      if (!stability.passed) {
        log(
          'gate',
          `blocked generation ${generationLabel}: ${stability.reason} (${stability.consecutivePromoted}/${stability.requiredWindow})`,
        );
      }
      appendHistoryEvent(options.historyLogPath, {
        ts: new Date().toISOString(),
        event: 'stability_gate',
        generation,
        mode: options.mode,
        enabled: stability.enabled,
        passed: stability.passed,
        reason: stability.reason,
        requiredWindow: stability.requiredWindow,
        consecutivePromoted: stability.consecutivePromoted,
        checkedRunIds: stability.checkedRunIds,
      });

      const syncResult = options.git && stability.passed
        ? await syncGenerationOutputs(options, generation)
        : { stagedPaths: [], committed: false, pushed: false, deployed: false };
      if (options.git && !stability.passed) {
        log('sync', 'skipped commit/push/deploy due to stability gate');
      }

      const elapsedSeconds = roundTo3((Date.now() - generationStartedAt) / 1000);

      log('generation', `done ${generationLabel} in ${formatDuration(elapsedSeconds * 1000)}`);
      appendHistoryEvent(options.historyLogPath, {
        ts: new Date().toISOString(),
        event: 'generation_end',
        status: 'completed',
        generation,
        mode: options.mode,
        elapsedSeconds,
        committed: syncResult.committed,
        pushed: syncResult.pushed,
        deployed: syncResult.deployed,
        commitHash: syncResult.commitHash ?? null,
        stagedPaths: syncResult.stagedPaths,
        stabilityGatePassed: stability.passed,
        stabilityGateReason: stability.reason,
        stabilityConsecutivePromoted: stability.consecutivePromoted,
        stabilityRequiredWindow: stability.requiredWindow,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', `generation ${generation} failed: ${message}`);
      appendHistoryEvent(options.historyLogPath, {
        ts: new Date().toISOString(),
        event: 'generation_end',
        status: 'failed',
        generation,
        mode: options.mode,
        error: message,
      });

      if (!options.continueOnError || interrupted) {
        throw error;
      }
      log('generation', 'continuing because --continue-on-error is set');
    }

    if (interrupted) {
      break;
    }

    const shouldRunAnother = options.generations === 0 || generation < options.generations;
    if (shouldRunAnother && options.pauseSeconds > 0) {
      log('wait', `sleeping ${options.pauseSeconds}s before next generation`);
      await sleepInterruptible(options.pauseSeconds * 1000);
    }
  }

  if (interrupted) {
    log('done', 'stopped by interrupt');
    process.exitCode = 130;
    return;
  }

  log('done', `completed ${generation} generation(s)`);
}

async function runGeneration(options: AutopilotOptions, generation: number): Promise<void> {
  const scriptPath =
    options.mode === 'linear'
      ? resolveScriptPath('scripts/hive/train-model.ts')
      : options.mode === 'deep'
        ? resolveScriptPath('scripts/hive/train-deep.ts')
        : options.mode === 'deep-eval'
          ? resolveScriptPath('scripts/hive/train-deep-eval.ts')
          : resolveScriptPath('scripts/hive/train-alphazero.ts');

  const maybeMetricsArg = shouldInjectMetricsLog(options.generationArgs, options.mode)
    ? ['--metrics-log', options.metricsLogPath]
    : [];

  const runArgs =
    options.mode === 'deep'
      ? ['--import', 'tsx', scriptPath, ...DEFAULT_DEEP_TRAIN_ARGS, ...options.generationArgs]
      : options.mode === 'alphazero-eval'
        ? [
            '--import',
            'tsx',
            scriptPath,
            ...DEFAULT_AZ_TRAIN_ARGS,
            ...maybeMetricsArg,
            '--generation-index',
            String(generation),
            ...options.generationArgs,
          ]
        : ['--import', 'tsx', scriptPath, ...options.generationArgs];

  await runCommand(process.execPath, runArgs, {
    stdio: 'inherit',
  });
}

function shouldInjectMetricsLog(generationArgs: string[], mode: RunMode): boolean {
  if (mode !== 'alphazero-eval') return false;
  for (let index = 0; index < generationArgs.length; index += 1) {
    const arg = generationArgs[index];
    if (arg === '--metrics-log') {
      return false;
    }
  }
  return true;
}

async function syncGenerationOutputs(
  options: AutopilotOptions,
  generation: number,
): Promise<SyncResult> {
  const insideRepo = await isInsideGitRepo();
  if (!insideRepo) {
    log('sync', 'not inside a git repo; skipping commit/push/deploy');
    return { stagedPaths: [], committed: false, pushed: false, deployed: false };
  }

  const stageablePaths = await resolveStageablePaths(options.gitPaths);
  if (stageablePaths.length === 0) {
    log('sync', 'no configured output files found to stage; skipping commit/push/deploy');
    return { stagedPaths: [], committed: false, pushed: false, deployed: false };
  }

  await runCommand('git', ['add', '-A', '--', ...stageablePaths], { stdio: 'inherit' });

  const stagedChanges = await hasStagedChanges();
  if (!stagedChanges) {
    log('sync', 'no staged changes detected; skipping commit/push/deploy');
    return { stagedPaths: stageablePaths, committed: false, pushed: false, deployed: false };
  }

  const commitMessage = formatCommitMessage(options.commitMessage, {
    generation,
    mode: options.mode,
  });
  await runCommand('git', ['commit', '-m', commitMessage], { stdio: 'inherit' });
  const commitHash = await readHeadCommitShort();

  let pushed = false;
  if (options.push) {
    await runCommand('git', ['push'], { stdio: 'inherit' });
    pushed = true;
  }

  let deployed = false;
  if (options.deploy) {
    await runDeployCommand(options.deployCommand);
    deployed = true;
  }

  return {
    stagedPaths: stageablePaths,
    committed: true,
    pushed,
    deployed,
    commitHash,
  };
}

async function resolveStageablePaths(paths: string[]): Promise<string[]> {
  const unique = [...new Set(paths.map((entry) => entry.trim()).filter(Boolean))];
  const stageable: string[] = [];

  for (const relativePath of unique) {
    const absolutePath = path.resolve(process.cwd(), relativePath);
    if (existsSync(absolutePath)) {
      stageable.push(relativePath);
      continue;
    }
    if (await isTrackedByGit(relativePath)) {
      stageable.push(relativePath);
    }
  }

  return stageable;
}

async function isInsideGitRepo(): Promise<boolean> {
  const result = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], {
    stdio: 'pipe',
    throwOnNonZero: false,
  });
  return result.code === 0 && result.stdout.trim() === 'true';
}

async function isTrackedByGit(relativePath: string): Promise<boolean> {
  const result = await runCommand('git', ['ls-files', '--error-unmatch', '--', relativePath], {
    stdio: 'pipe',
    throwOnNonZero: false,
  });
  return result.code === 0;
}

async function hasStagedChanges(): Promise<boolean> {
  const result = await runCommand('git', ['diff', '--cached', '--quiet'], {
    stdio: 'pipe',
    throwOnNonZero: false,
  });
  return result.code === 1;
}

async function readHeadCommitShort(): Promise<string | undefined> {
  const result = await runCommand('git', ['rev-parse', '--short', 'HEAD'], {
    stdio: 'pipe',
    throwOnNonZero: false,
  });
  if (result.code !== 0) return undefined;
  const hash = result.stdout.trim();
  return hash.length > 0 ? hash : undefined;
}

function formatCommitMessage(
  template: string,
  values: {
    generation: number;
    mode: RunMode;
  },
): string {
  const replaced = template
    .replaceAll('{generation}', String(values.generation))
    .replaceAll('{mode}', values.mode)
    .replaceAll('{best_arch}', 'n/a')
    .replaceAll('{best_score}', 'n/a')
    .replaceAll('{timestamp}', new Date().toISOString());

  return replaced.trim() || `hive: autopilot gen ${values.generation} (${values.mode})`;
}

function appendHistoryEvent(logPath: string, payload: Record<string, unknown>): void {
  const absolutePath = path.resolve(process.cwd(), logPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  appendFileSync(absolutePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function installSignalHandlers(): void {
  const onSignal = (signal: NodeJS.Signals): void => {
    if (interrupted) {
      process.exit(130);
      return;
    }
    interrupted = true;
    log('interrupt', `${signal} received; stopping after current step`);
    if (activeChild && activeChild.exitCode === null) {
      try {
        activeChild.kill(signal);
      } catch {
        // ignore forwarding errors
      }
    }
  };

  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}

async function sleepInterruptible(ms: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, ms);
  while (!interrupted && Date.now() < deadline) {
    const waitMs = Math.min(500, deadline - Date.now());
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function resolveScriptPath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}

async function runDeployCommand(rawCommand: string): Promise<void> {
  const trimmed = rawCommand.trim();
  if (trimmed.length === 0) {
    throw new Error('Invalid --deploy-command (empty command)');
  }

  if (process.platform === 'win32') {
    await runCommand('cmd.exe', ['/d', '/s', '/c', trimmed], { stdio: 'inherit' });
    return;
  }

  const deployParts = tokenizeCommand(trimmed);
  if (deployParts.length === 0) {
    throw new Error('Invalid --deploy-command (empty command)');
  }
  const [deployBinary, ...deployArgs] = deployParts;
  await runCommand(deployBinary, deployArgs, { stdio: 'inherit' });
}

function createDefaultDeepTrainArgs(): string[] {
  return [
    '--games',
    '300',
    '--difficulty',
    'extreme',
    '--workers',
    String(HARDWARE_PROFILE.selfPlayWorkers),
    '--epochs',
    '60',
    '--batch-size',
    String(HARDWARE_PROFILE.deepBatchSize),
    '--save-every',
    '1',
    '--resume',
    '--warm-start',
    '--replay-max-runs',
    '6',
    '--replay-max-samples',
    '400000',
    '--no-capture-draw',
    '90',
    '--early-stop-patience',
    '6',
    '--early-stop-min-delta',
    '0.002',
    '--early-stop-min-epochs',
    '10',
    '--verbose',
  ];
}

function createDefaultAzTrainArgs(): string[] {
  return [
    '--games',
    '240',
    '--difficulty',
    'extreme',
    '--simulations',
    '220',
    '--fast-simulations',
    '72',
    '--fast-ratio',
    '0.55',
    '--epochs',
    '26',
    '--batch-size',
    String(Math.max(256, Math.min(2048, HARDWARE_PROFILE.deepBatchSize))),
    '--replay-max-samples',
    '220000',
    '--reanalyse-fraction',
    '0.2',
    '--reanalyse-workers',
    String(Math.max(1, Math.min(6, HARDWARE_PROFILE.logicalCpuCount - 2))),
    '--arena-games',
    '400',
    '--arena-threshold',
    '0.55',
    '--arena-gate-mode',
    'sprt',
    '--arena-sprt-alpha',
    '0.05',
    '--arena-sprt-beta',
    '0.05',
    '--arena-sprt-margin',
    '0.05',
    '--arena-confidence-level',
    '0.95',
  ];
}

function tokenizeCommand(raw: string): string[] {
  const tokens: string[] = [];
  const matcher = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }

  return tokens;
}

function parseOptions(argv: string[]): ParsedArgs {
  const separatorIndex = argv.indexOf('--');
  const autopilotArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : [...argv];
  const generationArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];

  const options: AutopilotOptions = {
    ...DEFAULT_OPTIONS,
    gitPaths: [...DEFAULT_OPTIONS.gitPaths],
    generationArgs,
  };

  let help = false;

  for (let index = 0; index < autopilotArgs.length; index += 1) {
    const arg = autopilotArgs[index];
    const next = autopilotArgs[index + 1];

    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--mode':
        options.mode = parseMode(next);
        index += 1;
        break;
      case '--generations':
        options.generations = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--pause-seconds':
        options.pauseSeconds = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--git':
        options.git = true;
        break;
      case '--no-git':
        options.git = false;
        break;
      case '--push':
        options.push = true;
        break;
      case '--no-push':
        options.push = false;
        break;
      case '--deploy':
        options.deploy = true;
        break;
      case '--no-deploy':
        options.deploy = false;
        break;
      case '--deploy-command':
        if (!next) throw new Error('Missing value for --deploy-command');
        options.deployCommand = next;
        index += 1;
        break;
      case '--metrics-log':
        if (!next) throw new Error('Missing value for --metrics-log');
        options.metricsLogPath = next;
        index += 1;
        break;
      case '--git-paths':
        if (!next) throw new Error('Missing value for --git-paths');
        options.gitPaths = parsePathList(next);
        index += 1;
        break;
      case '--commit-message':
        if (!next) throw new Error('Missing value for --commit-message');
        options.commitMessage = next;
        index += 1;
        break;
      case '--summary-path':
        if (!next) throw new Error('Missing value for --summary-path');
        options.summaryPath = next;
        index += 1;
        break;
      case '--history-log':
        if (!next) throw new Error('Missing value for --history-log');
        options.historyLogPath = next;
        index += 1;
        break;
      case '--continue-on-error':
        options.continueOnError = true;
        break;
      case '--stop-on-error':
        options.continueOnError = false;
        break;
      case '--require-stable-promotions':
        options.requireStablePromotions = true;
        break;
      case '--no-require-stable-promotions':
        options.requireStablePromotions = false;
        break;
      case '--stability-window':
        options.stabilityWindow = parsePositiveInt(next, arg);
        index += 1;
        break;
      default:
        throw new Error(
          `Unknown argument: ${arg}. Use --help for usage. If this is for training/eval, pass it after --, e.g. npm run hive:autopilot -- --mode deep-eval -- --games 300`,
        );
    }
  }

  return { options, help };
}

function parseMode(value: string | undefined): RunMode {
  if (value === 'linear' || value === 'deep' || value === 'deep-eval' || value === 'alphazero-eval') {
    return value;
  }
  throw new Error(`Invalid --mode value: ${value}`);
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parsePathList(raw: string): string[] {
  const parts = raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Invalid value for --git-paths: expected one or more comma/semicolon-separated paths');
  }
  return [...new Set(parts)];
}

function evaluateStabilityGate(
  options: AutopilotOptions,
  enforceStability: boolean,
): StabilityGateResult {
  if (!enforceStability) {
    return {
      enabled: false,
      passed: true,
      reason: 'disabled',
      requiredWindow: options.stabilityWindow,
      consecutivePromoted: 0,
      checkedRunIds: [],
    };
  }
  if (options.mode !== 'alphazero-eval') {
    return {
      enabled: true,
      passed: true,
      reason: 'not_applicable_mode',
      requiredWindow: options.stabilityWindow,
      consecutivePromoted: 0,
      checkedRunIds: [],
    };
  }

  const decisions = readPromotionDecisions(options.metricsLogPath);
  if (decisions.length === 0) {
    return {
      enabled: true,
      passed: false,
      reason: 'no_promotion_decisions_found',
      requiredWindow: options.stabilityWindow,
      consecutivePromoted: 0,
      checkedRunIds: [],
    };
  }

  const promotedStreak: PromotionDecisionEvent[] = [];
  for (const decision of decisions) {
    if (!decision.promoted) {
      break;
    }
    promotedStreak.push(decision);
    if (promotedStreak.length >= options.stabilityWindow) break;
  }

  if (promotedStreak.length < options.stabilityWindow) {
    return {
      enabled: true,
      passed: false,
      reason: 'insufficient_consecutive_promotions',
      requiredWindow: options.stabilityWindow,
      consecutivePromoted: promotedStreak.length,
      checkedRunIds: promotedStreak.map((entry) => entry.runId),
    };
  }

  for (let index = 0; index < promotedStreak.length - 1; index += 1) {
    const latest = promotedStreak[index];
    const previous = promotedStreak[index + 1];
    if (latest.scoreCiLow === null || latest.scoreCiHigh === null) {
      return {
        enabled: true,
        passed: false,
        reason: 'missing_ci_on_latest',
        requiredWindow: options.stabilityWindow,
        consecutivePromoted: promotedStreak.length,
        checkedRunIds: promotedStreak.map((entry) => entry.runId),
      };
    }
    if (previous.scoreCiLow === null || previous.scoreCiHigh === null) {
      return {
        enabled: true,
        passed: false,
        reason: 'missing_ci_on_previous',
        requiredWindow: options.stabilityWindow,
        consecutivePromoted: promotedStreak.length,
        checkedRunIds: promotedStreak.map((entry) => entry.runId),
      };
    }
    if (latest.scoreCiLow <= previous.scoreCiHigh) {
      return {
        enabled: true,
        passed: false,
        reason: `ci_overlap_or_regression_between_${latest.runId}_and_${previous.runId}`,
        requiredWindow: options.stabilityWindow,
        consecutivePromoted: promotedStreak.length,
        checkedRunIds: promotedStreak.map((entry) => entry.runId),
      };
    }
  }

  return {
    enabled: true,
    passed: true,
    reason: 'passed_consecutive_non_overlapping_ci',
    requiredWindow: options.stabilityWindow,
    consecutivePromoted: promotedStreak.length,
    checkedRunIds: promotedStreak.map((entry) => entry.runId),
  };
}

function readPromotionDecisions(metricsLogPath: string): PromotionDecisionEvent[] {
  const absolutePath = path.resolve(process.cwd(), metricsLogPath);
  if (!existsSync(absolutePath)) return [];

  let raw = '';
  try {
    raw = readFileSync(absolutePath, 'utf8');
  } catch {
    return [];
  }

  const events: PromotionDecisionEvent[] = [];
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    if (parsed.eventType !== 'promotion_decision') continue;
    if (parsed.source !== 'eval') continue;
    const runId = typeof parsed.runId === 'string' ? parsed.runId : null;
    const ts = typeof parsed.ts === 'string' ? Date.parse(parsed.ts) : NaN;
    if (!runId || !Number.isFinite(ts)) continue;
    events.push({
      tsMs: ts,
      runId,
      promoted: parsed.promoted === true,
      scoreCiLow: asFiniteNumber(parsed.scoreCiLow),
      scoreCiHigh: asFiniteNumber(parsed.scoreCiHigh),
      gateDecisionReason: typeof parsed.gateDecisionReason === 'string' ? parsed.gateDecisionReason : null,
    });
  }

  events.sort((left, right) => right.tsMs - left.tsMs);
  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function roundTo3(value: number): number {
  return Number(value.toFixed(3));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function log(stage: string, message: string): void {
  const clock = new Date().toISOString().slice(11, 19);
  console.log(`[${clock}] [${stage}] ${message}`);
}

function printUsageAndExit(): never {
  console.log('Usage: npm run hive:autopilot -- [autopilot options] -- [generation args]');
  console.log('');
  console.log('Behavior:');
  console.log('  Loops training generations continuously (or for N generations).');
  console.log('  After each generation it can: git add/commit, git push, and deploy (vercel).');
  console.log('');
  console.log('Autopilot options:');
  console.log('  --mode <linear|deep|deep-eval|alphazero-eval>  Generation command mode (default: deep-eval)');
  console.log('                                   deep mode applies hive:train:deep preset defaults before your overrides');
  console.log('                                   alphazero-eval mode applies hive:train:az preset defaults with arena gating');
  console.log('  --generations <n>                Number of generations (0 = infinite, default: 0)');
  console.log('  --pause-seconds <n>              Delay between generations (default: 15)');
  console.log('  --git / --no-git                 Enable/disable git stage+commit (default: enabled)');
  console.log('  --push / --no-push               Enable/disable git push (default: enabled)');
  console.log('  --deploy / --no-deploy           Enable/disable deploy step (default: enabled)');
  console.log('  --deploy-command <cmd>           Deploy command string (default: "vercel --prod")');
  console.log('  --metrics-log <path>             Metrics JSONL path for AZ gating (default: .hive-cache/metrics/training-metrics.jsonl)');
  console.log('  --git-paths <csv>                Paths to stage/commit, comma or semicolon separated');
  console.log('  --commit-message <text>          Commit template with placeholders:');
  console.log('                                   {generation} {mode} {timestamp}');
  console.log('  --history-log <path>             JSONL history log path (default: .hive-cache/autopilot/history.jsonl)');
  console.log('  --require-stable-promotions      Enforce AZ promotion stability gate');
  console.log('  --no-require-stable-promotions   Disable AZ promotion stability gate');
  console.log('  --stability-window <n>           Consecutive promoted generations required (default: 3)');
  console.log('  --continue-on-error              Keep looping if a generation/sync step fails');
  console.log('  --stop-on-error                  Stop on first error (default)');
  console.log('');
  console.log('Generation args:');
  console.log('  Pass train/eval args after the second -- separator.');
  console.log('  Example: npm run hive:autopilot -- --mode deep-eval -- --games 300 --epochs 60');
  console.log('  Example: npm run hive:autopilot -- --mode alphazero-eval -- --games 260 --epochs 30');
  process.exit(0);
}

function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const stdio = options.stdio ?? 'inherit';
  const throwOnNonZero = options.throwOnNonZero ?? true;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: stdio === 'inherit' ? 'inherit' : 'pipe',
      shell: false,
    });
    activeChild = child;

    let stdout = '';
    let stderr = '';

    if (stdio === 'pipe') {
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }

    child.on('error', (error) => {
      if (activeChild === child) activeChild = null;
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (activeChild === child) activeChild = null;
      const exitCode = code ?? (signal ? 130 : 1);
      const result: CommandResult = { code: exitCode, stdout, stderr };
      if (exitCode !== 0 && throwOnNonZero) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${exitCode}`));
        return;
      }
      resolve(result);
    });
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log('error', message);
  process.exit(1);
});
