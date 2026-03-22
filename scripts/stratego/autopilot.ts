import { ChildProcess, spawn } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ComputerDifficulty } from '../../lib/stratego/ai';
import { getStrategoHardwareProfile } from './hardware-profile';

type RunMode = 'policy-value-eval' | 'tune' | 'deep' | 'deep-eval';
type GateMethod = 'ci' | 'sprt';

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
  gateEnabled: boolean;
  gateMethod: GateMethod;
  gateCandidatePath: string;
  gateSummaryPath: string;
  gateKeepMetrics: boolean;
  gateGames: number;
  gateDifficulty: ComputerDifficulty;
  gateWorkers: number;
  gateMaxTurns: number;
  gateNoCaptureDrawMoves: number;
  gateProgressEvery: number;
  gateMinScore: number;
  gateMinLowerBound: number;
  gateZValue: number;
  gateSprtElo0: number;
  gateSprtElo1: number;
  gateSprtAlpha: number;
  gateSprtBeta: number;
  gateSprtBatchGames: number;
  gateSprtCiFallback: boolean;
  gateSnapshotsDir: string;
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

interface GateResult {
  attempted: boolean;
  passed: boolean;
  summaryPath: string | null;
  summary: GateSummaryLite | null;
  candidatePath: string | null;
  incumbentSnapshotPath: string | null;
  restoredIncumbent: boolean;
}

interface GateSummaryLite {
  passed?: boolean;
  benchmark?: {
    candidateWins?: number;
    baselineWins?: number;
    draws?: number;
    candidateScore?: number;
  };
  confidence?: {
    mean?: number;
    lower?: number;
    upper?: number;
  };
  sprt?: {
    decision?: string;
    rounds?: number;
    llr?: number;
  } | null;
}

const HARDWARE_PROFILE = getStrategoHardwareProfile();

const DEFAULT_OPTIONS: AutopilotOptions = {
  mode: 'policy-value-eval',
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
  gateEnabled: true,
  gateMethod: 'sprt',
  gateCandidatePath: 'lib/stratego/trained-model.json',
  gateSummaryPath: '.stratego-cache/gate/last-gate.json',
  gateKeepMetrics: false,
  gateGames: 120,
  gateDifficulty: 'extreme',
  gateWorkers: HARDWARE_PROFILE.evalWorkers,
  gateMaxTurns: 500,
  gateNoCaptureDrawMoves: 160,
  gateProgressEvery: 20,
  gateMinScore: 0.53,
  gateMinLowerBound: 0.5,
  gateZValue: 1.96,
  gateSprtElo0: 0,
  gateSprtElo1: 35,
  gateSprtAlpha: 0.05,
  gateSprtBeta: 0.05,
  gateSprtBatchGames: 24,
  gateSprtCiFallback: true,
  gateSnapshotsDir: '.stratego-cache/autopilot/gate-snapshots',
};

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
  if (options.gateEnabled) {
    log(
      'setup',
      `gate=on method=${options.gateMethod} candidate=${options.gateCandidatePath} games=${options.gateGames} difficulty=${options.gateDifficulty} workers=${options.gateWorkers}`,
    );
  } else {
    log('setup', 'gate=off');
  }
  if (options.generationArgs.length > 0) {
    log('setup', `generation args=${options.generationArgs.join(' ')}`);
  }

  let generation = 0;
  while (!interrupted && (options.generations === 0 || generation < options.generations)) {
    generation += 1;
    const generationLabel =
      options.generations > 0 ? `${generation}/${options.generations}` : `${generation}`;
    const generationStartedAt = Date.now();
    let gateSnapshotPath: string | null = null;

    log('generation', `start ${generationLabel}`);
    appendHistoryEvent(options.historyLogPath, {
      ts: new Date().toISOString(),
      event: 'generation_start',
      generation,
      mode: options.mode,
    });

    try {
      gateSnapshotPath = options.gateEnabled
        ? captureGateIncumbentSnapshot(options, generation)
        : null;
      await runGeneration(options);

      const tuneSummary = options.mode === 'tune' ? readTuneSummary(options.summaryPath) : null;
      const gateResult = options.gateEnabled
        ? await runPromotionGate(options, generation, gateSnapshotPath)
        : createSkippedGateResult();
      const gateOutcome = !gateResult.attempted
        ? 'skipped'
        : gateResult.passed
          ? 'passed'
          : 'rejected';

      let syncResult: SyncResult = {
        stagedPaths: [],
        committed: false,
        pushed: false,
        deployed: false,
      };
      let generationStatus: 'completed' | 'gated_out' = 'completed';
      if (gateResult.attempted && !gateResult.passed) {
        generationStatus = 'gated_out';
        log('gate', 'candidate rejected; skipping commit/push/deploy for this generation');
      } else {
        syncResult = options.git
          ? await syncGenerationOutputs(options, generation, tuneSummary)
          : { stagedPaths: [], committed: false, pushed: false, deployed: false };
      }

      const elapsedSeconds = roundTo3((Date.now() - generationStartedAt) / 1000);
      const bestArchitecture = tuneSummary?.best?.architecture ?? null;
      const bestScore = toFiniteNumber(tuneSummary?.best?.score);

      log(
        'generation',
        `done ${generationLabel} in ${formatDuration(elapsedSeconds * 1000)} status=${generationStatus} gate=${gateOutcome}${bestArchitecture ? ` best=${bestArchitecture}` : ''}`,
      );
      appendHistoryEvent(options.historyLogPath, {
        ts: new Date().toISOString(),
        event: 'generation_end',
        status: generationStatus,
        generation,
        mode: options.mode,
        elapsedSeconds,
        bestArchitecture,
        bestScore,
        gate: {
          attempted: gateResult.attempted,
          passed: gateResult.passed,
          summaryPath: gateResult.summaryPath,
          candidatePath: gateResult.candidatePath,
          incumbentSnapshotPath: gateResult.incumbentSnapshotPath,
          restoredIncumbent: gateResult.restoredIncumbent,
          score: toFiniteNumber(gateResult.summary?.confidence?.mean),
          lower: toFiniteNumber(gateResult.summary?.confidence?.lower),
          upper: toFiniteNumber(gateResult.summary?.confidence?.upper),
          candidateWins: toFiniteNumber(gateResult.summary?.benchmark?.candidateWins),
          baselineWins: toFiniteNumber(gateResult.summary?.benchmark?.baselineWins),
          draws: toFiniteNumber(gateResult.summary?.benchmark?.draws),
          sprtDecision: gateResult.summary?.sprt?.decision ?? null,
          sprtRounds: toFiniteNumber(gateResult.summary?.sprt?.rounds),
          sprtLlr: toFiniteNumber(gateResult.summary?.sprt?.llr),
        },
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
    } finally {
      if (gateSnapshotPath) {
        rmSync(gateSnapshotPath, { force: true });
      }
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
    options.mode === 'policy-value-eval'
      ? resolveScriptPath('scripts/stratego/train-policy-value-eval.ts')
      : options.mode === 'tune'
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

function createSkippedGateResult(): GateResult {
  return {
    attempted: false,
    passed: true,
    summaryPath: null,
    summary: null,
    candidatePath: null,
    incumbentSnapshotPath: null,
    restoredIncumbent: false,
  };
}

function captureGateIncumbentSnapshot(
  options: AutopilotOptions,
  generation: number,
): string | null {
  const candidateAbs = path.resolve(process.cwd(), options.gateCandidatePath);
  if (!existsSync(candidateAbs)) {
    log(
      'gate',
      `candidate path missing before generation (${candidateAbs}); gate will be skipped`,
    );
    return null;
  }

  const snapshotsDir = path.resolve(process.cwd(), options.gateSnapshotsDir);
  mkdirSync(snapshotsDir, { recursive: true });
  const snapshotPath = path.join(snapshotsDir, `incumbent-g${generation}-${Date.now()}.json`);
  copyFileSync(candidateAbs, snapshotPath);
  log('gate', `captured incumbent snapshot ${snapshotPath}`);
  return snapshotPath;
}

async function runPromotionGate(
  options: AutopilotOptions,
  generation: number,
  incumbentSnapshotPath: string | null,
): Promise<GateResult> {
  const candidateAbs = path.resolve(process.cwd(), options.gateCandidatePath);
  const summaryAbs = path.resolve(process.cwd(), options.gateSummaryPath);

  if (!incumbentSnapshotPath) {
    return {
      attempted: false,
      passed: true,
      summaryPath: summaryAbs,
      summary: null,
      candidatePath: candidateAbs,
      incumbentSnapshotPath: null,
      restoredIncumbent: false,
    };
  }

  if (!existsSync(candidateAbs)) {
    throw new Error(`Gate candidate model not found after generation: ${candidateAbs}`);
  }
  if (!existsSync(incumbentSnapshotPath)) {
    throw new Error(`Gate incumbent snapshot is missing: ${incumbentSnapshotPath}`);
  }

  const gateScriptPath = resolveScriptPath('scripts/stratego/gate.ts');
  const gateArgs = [
    '--import',
    'tsx',
    gateScriptPath,
    '--candidate',
    candidateAbs,
    '--incumbent',
    incumbentSnapshotPath,
    '--method',
    options.gateMethod,
    '--games',
    String(options.gateGames),
    '--difficulty',
    options.gateDifficulty,
    '--workers',
    String(options.gateWorkers),
    '--max-turns',
    String(options.gateMaxTurns),
    '--no-capture-draw',
    String(options.gateNoCaptureDrawMoves),
    '--progress-every',
    String(options.gateProgressEvery),
    '--min-score',
    String(options.gateMinScore),
    '--min-lower-bound',
    String(options.gateMinLowerBound),
    '--z',
    String(options.gateZValue),
    '--summary-out',
    summaryAbs,
  ];

  if (options.gateMethod === 'sprt') {
    gateArgs.push(
      '--sprt-elo0',
      String(options.gateSprtElo0),
      '--sprt-elo1',
      String(options.gateSprtElo1),
      '--sprt-alpha',
      String(options.gateSprtAlpha),
      '--sprt-beta',
      String(options.gateSprtBeta),
      '--sprt-batch-games',
      String(options.gateSprtBatchGames),
    );
    gateArgs.push(options.gateSprtCiFallback ? '--sprt-ci-fallback' : '--no-sprt-ci-fallback');
  }

  if (options.gateKeepMetrics) {
    gateArgs.push('--keep-metrics');
  }

  let restoredIncumbent = false;
  try {
    log(
      'gate',
      `generation=${generation} method=${options.gateMethod} games=${options.gateGames} candidate=${candidateAbs}`,
    );
    const gateCommandResult = await runCommand(process.execPath, gateArgs, {
      stdio: 'inherit',
      throwOnNonZero: false,
    });

    if (gateCommandResult.code !== 0 && gateCommandResult.code !== 2) {
      throw new Error(`Gate exited with code ${gateCommandResult.code}`);
    }

    const passed = gateCommandResult.code === 0;
    if (!passed) {
      copyFileSync(incumbentSnapshotPath, candidateAbs);
      restoredIncumbent = true;
      log('gate', `rejected: restored incumbent snapshot to ${candidateAbs}`);
    } else {
      log('gate', 'passed: candidate kept for sync/deploy');
    }

    return {
      attempted: true,
      passed,
      summaryPath: summaryAbs,
      summary: readGateSummary(summaryAbs),
      candidatePath: candidateAbs,
      incumbentSnapshotPath,
      restoredIncumbent,
    };
  } finally {
    rmSync(incumbentSnapshotPath, { force: true });
  }
}

function readGateSummary(summaryPath: string): GateSummaryLite | null {
  if (!existsSync(summaryPath)) {
    return null;
  }
  try {
    const raw = readFileSync(summaryPath, 'utf8');
    const parsed = JSON.parse(raw) as GateSummaryLite;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
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
      case '--gate':
        options.gateEnabled = true;
        break;
      case '--no-gate':
        options.gateEnabled = false;
        break;
      case '--gate-method':
        options.gateMethod = parseGateMethod(next);
        index += 1;
        break;
      case '--gate-candidate':
        if (!next) throw new Error('Missing value for --gate-candidate');
        options.gateCandidatePath = next;
        index += 1;
        break;
      case '--gate-summary':
        if (!next) throw new Error('Missing value for --gate-summary');
        options.gateSummaryPath = next;
        index += 1;
        break;
      case '--gate-snapshots-dir':
        if (!next) throw new Error('Missing value for --gate-snapshots-dir');
        options.gateSnapshotsDir = next;
        index += 1;
        break;
      case '--gate-keep-metrics':
        options.gateKeepMetrics = true;
        break;
      case '--gate-no-keep-metrics':
        options.gateKeepMetrics = false;
        break;
      case '--gate-games':
        options.gateGames = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gate-difficulty':
        options.gateDifficulty = parseDifficulty(next, arg);
        index += 1;
        break;
      case '--gate-workers':
        options.gateWorkers = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gate-max-turns':
        options.gateMaxTurns = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gate-no-capture-draw':
        options.gateNoCaptureDrawMoves = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--gate-progress-every':
        options.gateProgressEvery = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gate-min-score':
        options.gateMinScore = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--gate-min-lower-bound':
        options.gateMinLowerBound = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--gate-z':
        options.gateZValue = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--gate-sprt-elo0':
        options.gateSprtElo0 = parseFiniteFloat(next, arg);
        index += 1;
        break;
      case '--gate-sprt-elo1':
        options.gateSprtElo1 = parseFiniteFloat(next, arg);
        index += 1;
        break;
      case '--gate-sprt-alpha':
        options.gateSprtAlpha = parseOpenUnitInterval(next, arg);
        index += 1;
        break;
      case '--gate-sprt-beta':
        options.gateSprtBeta = parseOpenUnitInterval(next, arg);
        index += 1;
        break;
      case '--gate-sprt-batch-games':
        options.gateSprtBatchGames = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--gate-sprt-ci-fallback':
        options.gateSprtCiFallback = true;
        break;
      case '--gate-no-sprt-ci-fallback':
        options.gateSprtCiFallback = false;
        break;
      default:
        throw new Error(
          `Unknown argument: ${arg}. Use --help for usage. If this is for training/tune, pass it after --, e.g. npm run stratego:autopilot -- --mode tune -- --games 300`,
        );
    }
  }

  if (options.gateWorkers > options.gateGames) {
    options.gateWorkers = options.gateGames;
  }
  if (options.gateProgressEvery > options.gateGames) {
    options.gateProgressEvery = options.gateGames;
  }
  if (options.gateSprtBatchGames > options.gateGames) {
    options.gateSprtBatchGames = options.gateGames;
  }
  if (options.gateMethod === 'sprt' && options.gateSprtElo1 <= options.gateSprtElo0) {
    throw new Error('--gate-sprt-elo1 must be greater than --gate-sprt-elo0');
  }

  return { options, help };
}

function parseMode(value: string | undefined): RunMode {
  if (value === 'policy-value-eval' || value === 'tune' || value === 'deep' || value === 'deep-eval') {
    return value;
  }
  throw new Error(`Invalid --mode value: ${value}`);
}

function parseGateMethod(value: string | undefined): GateMethod {
  if (value === 'ci' || value === 'sprt') {
    return value;
  }
  throw new Error(`Invalid --gate-method value: ${value}`);
}

function parseDifficulty(
  value: string | undefined,
  flag: string,
): ComputerDifficulty {
  if (value === 'medium' || value === 'hard' || value === 'extreme') {
    return value;
  }
  throw new Error(`Invalid value for ${flag}: ${value}`);
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

function parsePositiveFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseFiniteFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseUnitInterval(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseOpenUnitInterval(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`Invalid value for ${flag}: ${value} (expected 0 < value < 1)`);
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
  console.log('  --mode <policy-value-eval|tune|deep|deep-eval>  Generation command mode (default: policy-value-eval)');
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
  console.log('Gate options (run after each generation, before sync/deploy):');
  console.log('  --gate / --no-gate            Enable/disable promotion gate (default: enabled)');
  console.log('  --gate-method <ci|sprt>       Gate mode (default: sprt)');
  console.log('  --gate-candidate <path>       Candidate model path to gate (default: lib/stratego/trained-model.json)');
  console.log('  --gate-summary <path>         Gate summary output path (default: .stratego-cache/gate/last-gate.json)');
  console.log('  --gate-snapshots-dir <path>   Temp incumbent snapshot directory');
  console.log('  --gate-games <n>              Gate eval games / max SPRT games (default: 120)');
  console.log('  --gate-difficulty <d>         medium|hard|extreme (default: extreme)');
  console.log(`  --gate-workers <n>            Gate eval workers (default: ${DEFAULT_OPTIONS.gateWorkers})`);
  console.log('  --gate-max-turns <n>          Gate max turns per game (default: 500)');
  console.log('  --gate-no-capture-draw <n>    Gate no-capture draw threshold (default: 160)');
  console.log('  --gate-progress-every <n>     Gate progress interval (default: 20)');
  console.log('  --gate-min-score <n>          CI gate minimum score [0..1] (default: 0.53)');
  console.log('  --gate-min-lower-bound <n>    CI gate minimum lower bound [0..1] (default: 0.50)');
  console.log('  --gate-z <n>                  CI gate z-score (default: 1.96)');
  console.log('  --gate-sprt-elo0 <n>          SPRT null-hypothesis Elo (default: 0)');
  console.log('  --gate-sprt-elo1 <n>          SPRT alternative Elo (default: 35)');
  console.log('  --gate-sprt-alpha <n>         SPRT type-I error in (0,1) (default: 0.05)');
  console.log('  --gate-sprt-beta <n>          SPRT type-II error in (0,1) (default: 0.05)');
  console.log('  --gate-sprt-batch-games <n>   SPRT games per sequential round (default: 24)');
  console.log('  --gate-sprt-ci-fallback       On inconclusive SPRT, fallback to CI thresholds (default)');
  console.log('  --gate-no-sprt-ci-fallback    On inconclusive SPRT, reject generation');
  console.log('  --gate-keep-metrics           Preserve gate metrics logs');
  console.log('  --gate-no-keep-metrics        Delete temporary gate metrics logs (default)');
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
