import { ChildProcess, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getStrategoHardwareProfile } from './hardware-profile';

type RunMode = 'tune' | 'deep' | 'deep-eval';

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
  summaryPath: string;
  historyLogPath: string;
  generationArgs: string[];
}

interface ParsedArgs {
  options: AutopilotOptions;
  help: boolean;
}

interface TuneSummaryLite {
  ts?: string;
  best?: {
    architecture?: string;
    score?: number;
  };
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

const DEFAULT_OPTIONS: AutopilotOptions = {
  mode: 'tune',
  generations: 0,
  pauseSeconds: 15,
  git: true,
  push: true,
  deploy: true,
  deployCommand: 'vercel --prod',
  gitPaths: ['lib/stratego/trained-model.json', '.stratego-cache/tune/last-tune.json'],
  commitMessage: 'stratego: autopilot gen {generation} ({mode}) {best_arch}',
  continueOnError: false,
  summaryPath: '.stratego-cache/tune/last-tune.json',
  historyLogPath: '.stratego-cache/autopilot/history.jsonl',
  generationArgs: [],
};

const HARDWARE_PROFILE = getStrategoHardwareProfile();

const DEFAULT_DEEP_TRAIN_ARGS = createDefaultDeepTrainArgs();

let interrupted = false;
let activeChild: ChildProcess | null = null;

async function main(): Promise<void> {
  const parsed = parseOptions(process.argv.slice(2));
  if (parsed.help) {
    printUsageAndExit();
  }

  const options = parsed.options;
  installSignalHandlers();

  if (!options.git) {
    options.push = false;
  }

  log(
    'setup',
    `mode=${options.mode} generations=${options.generations === 0 ? 'infinite' : options.generations} pause=${options.pauseSeconds}s git=${options.git ? 'on' : 'off'} push=${options.push ? 'on' : 'off'} deploy=${options.deploy ? 'on' : 'off'}`,
  );
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
      await runGeneration(options);

      const tuneSummary = options.mode === 'tune' ? readTuneSummary(options.summaryPath) : null;
      const syncResult = options.git
        ? await syncGenerationOutputs(options, generation, tuneSummary)
        : { stagedPaths: [], committed: false, pushed: false, deployed: false };

      const elapsedSeconds = roundTo3((Date.now() - generationStartedAt) / 1000);
      const bestArchitecture = tuneSummary?.best?.architecture ?? null;
      const bestScore = toFiniteNumber(tuneSummary?.best?.score);

      log(
        'generation',
        `done ${generationLabel} in ${formatDuration(elapsedSeconds * 1000)}${bestArchitecture ? ` best=${bestArchitecture}` : ''}`,
      );
      appendHistoryEvent(options.historyLogPath, {
        ts: new Date().toISOString(),
        event: 'generation_end',
        status: 'completed',
        generation,
        mode: options.mode,
        elapsedSeconds,
        bestArchitecture,
        bestScore,
        committed: syncResult.committed,
        pushed: syncResult.pushed,
        deployed: syncResult.deployed,
        commitHash: syncResult.commitHash ?? null,
        stagedPaths: syncResult.stagedPaths,
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

    const shouldRunAnother =
      options.generations === 0 || generation < options.generations;
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

async function runGeneration(options: AutopilotOptions): Promise<void> {
  const scriptPath =
    options.mode === 'tune'
      ? resolveScriptPath('scripts/stratego/tune.ts')
      : options.mode === 'deep'
        ? resolveScriptPath('scripts/stratego/train-deep.ts')
        : resolveScriptPath('scripts/stratego/train-deep-eval.ts');

  const runArgs =
    options.mode === 'deep'
      ? ['--import', 'tsx', scriptPath, ...DEFAULT_DEEP_TRAIN_ARGS, ...options.generationArgs]
      : ['--import', 'tsx', scriptPath, ...options.generationArgs];

  await runCommand(process.execPath, runArgs, {
    stdio: 'inherit',
  });
}

async function syncGenerationOutputs(
  options: AutopilotOptions,
  generation: number,
  tuneSummary: TuneSummaryLite | null,
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
    bestArchitecture: tuneSummary?.best?.architecture ?? '',
    bestScore: toFiniteNumber(tuneSummary?.best?.score),
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
    const deployParts = tokenizeCommand(options.deployCommand);
    if (deployParts.length === 0) {
      throw new Error('Invalid --deploy-command (empty command)');
    }
    const [deployBinary, ...deployArgs] = deployParts;
    await runCommand(deployBinary, deployArgs, { stdio: 'inherit' });
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

function readTuneSummary(summaryPath: string): TuneSummaryLite | null {
  const absolutePath = path.resolve(process.cwd(), summaryPath);
  if (!existsSync(absolutePath)) {
    return null;
  }

  try {
    const raw = readFileSync(absolutePath, 'utf8');
    const parsed = JSON.parse(raw) as TuneSummaryLite;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function formatCommitMessage(
  template: string,
  values: {
    generation: number;
    mode: RunMode;
    bestArchitecture: string;
    bestScore: number;
  },
): string {
  const replaced = template
    .replaceAll('{generation}', String(values.generation))
    .replaceAll('{mode}', values.mode)
    .replaceAll('{best_arch}', values.bestArchitecture || 'n/a')
    .replaceAll('{best_score}', Number.isFinite(values.bestScore) ? values.bestScore.toFixed(4) : 'n/a')
    .replaceAll('{timestamp}', new Date().toISOString());

  return replaced.trim() || `stratego: autopilot gen ${values.generation} (${values.mode})`;
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
    '160',
    '--early-stop-patience',
    '6',
    '--early-stop-min-delta',
    '0.002',
    '--early-stop-min-epochs',
    '10',
    '--verbose',
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
      default:
        throw new Error(
          `Unknown argument: ${arg}. Use --help for usage. If this is for training/tune, pass it after --, e.g. npm run stratego:autopilot -- --mode tune -- --games 300`,
        );
    }
  }

  return { options, help };
}

function parseMode(value: string | undefined): RunMode {
  if (value === 'tune' || value === 'deep' || value === 'deep-eval') {
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

function roundTo3(value: number): number {
  return Number(value.toFixed(3));
}

function toFiniteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Number.NaN;
  return value;
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
  console.log('Usage: npm run stratego:autopilot -- [autopilot options] -- [generation args]');
  console.log('');
  console.log('Behavior:');
  console.log('  Loops training generations continuously (or for N generations).');
  console.log('  After each generation it can: git add/commit, git push, and deploy (vercel).');
  console.log('');
  console.log('Autopilot options:');
  console.log('  --mode <tune|deep|deep-eval>  Generation command mode (default: tune)');
  console.log('                                deep mode applies stratego:train:deep preset defaults before your overrides');
  console.log('  --generations <n>             Number of generations (0 = infinite, default: 0)');
  console.log('  --pause-seconds <n>           Delay between generations (default: 15)');
  console.log('  --git / --no-git              Enable/disable git stage+commit (default: enabled)');
  console.log('  --push / --no-push            Enable/disable git push (default: enabled)');
  console.log('  --deploy / --no-deploy        Enable/disable deploy step (default: enabled)');
  console.log('  --deploy-command <cmd>        Deploy command string (default: "vercel --prod")');
  console.log('  --git-paths <csv>             Paths to stage/commit, comma or semicolon separated');
  console.log('  --commit-message <text>       Commit template with placeholders:');
  console.log('                                {generation} {mode} {best_arch} {best_score} {timestamp}');
  console.log('  --summary-path <path>         Tune summary path used for {best_arch} (default: .stratego-cache/tune/last-tune.json)');
  console.log('  --history-log <path>          JSONL history log path (default: .stratego-cache/autopilot/history.jsonl)');
  console.log('  --continue-on-error           Keep looping if a generation/sync step fails');
  console.log('  --stop-on-error               Stop on first error (default)');
  console.log('');
  console.log('Generation args:');
  console.log('  Pass train/tune args after the second -- separator.');
  console.log('  Example: npm run stratego:autopilot -- --mode tune -- --games 300 --epochs 60');
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
