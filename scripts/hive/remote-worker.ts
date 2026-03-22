import { spawn } from 'node:child_process';
import path from 'node:path';

export type RemoteWorkerPlatform = 'posix' | 'windows';

export interface RemoteWorkerSpec {
  host: string;
  repo: string;
  workers: number;
  platform: RemoteWorkerPlatform;
  raw: string;
}

export interface CommandExecutionResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const REMOTE_BOOTSTRAP_TIMEOUT_MS = 2 * 60 * 1000;

export function countRemoteWorkerSlots(remoteWorkers: RemoteWorkerSpec[]): number {
  return remoteWorkers.reduce((sum, entry) => sum + entry.workers, 0);
}

export function allocateRemoteWorkerSpecs(remoteWorkers: RemoteWorkerSpec[], maxSlots: number): RemoteWorkerSpec[] {
  let remaining = Math.max(0, maxSlots);
  if (remaining <= 0) return [];
  const allocated: RemoteWorkerSpec[] = [];
  for (const entry of remoteWorkers) {
    if (remaining <= 0) break;
    const workers = Math.min(entry.workers, remaining);
    if (workers <= 0) continue;
    allocated.push({ ...entry, workers });
    remaining -= workers;
  }
  return allocated;
}

export function formatRemoteWorkerSummary(remoteWorkers: RemoteWorkerSpec[]): string {
  if (remoteWorkers.length === 0) return 'none';
  return remoteWorkers
    .map((entry) => `${entry.host}x${entry.workers}`)
    .join(', ');
}

export function parseRemoteWorkerSpec(raw: string, flagName = '--remote-worker'): RemoteWorkerSpec {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`Invalid ${flagName} value: empty spec`);
  }

  let host = '';
  let repo = '';
  let workers = 0;
  for (const segment of trimmed.split(',')) {
    const [rawKey, ...rawValueParts] = segment.split('=');
    const key = rawKey.trim();
    const value = rawValueParts.join('=').trim();
    if (key.length === 0 || value.length === 0) {
      throw new Error(`Invalid ${flagName} value: ${raw}`);
    }
    switch (key) {
      case 'host':
        host = value;
        break;
      case 'repo':
        repo = value;
        break;
      case 'workers':
        workers = parsePositiveInt(value, `${flagName} workers`);
        break;
      default:
        throw new Error(`Invalid ${flagName} key: ${key}`);
    }
  }

  if (host.length === 0 || repo.length === 0 || workers <= 0) {
    throw new Error(`Invalid ${flagName} value: ${raw}`);
  }
  const platform = inferRemoteWorkerPlatform(repo);
  const normalizedRepo = normalizeRemoteWorkerRepoPath(repo, platform);

  return {
    host,
    repo: normalizedRepo,
    workers,
    platform,
    raw: serializeRemoteWorkerSpec({ host, repo: normalizedRepo, workers }),
  };
}

export function aggregateRemoteWorkerSpecs(remoteWorkers: RemoteWorkerSpec[]): RemoteWorkerSpec[] {
  const aggregated = new Map<string, RemoteWorkerSpec>();
  for (const entry of remoteWorkers) {
    const key = makeRemoteWorkerSpecKey(entry);
    const existing = aggregated.get(key);
    if (existing) {
      existing.workers += entry.workers;
      existing.raw = serializeRemoteWorkerSpec(existing);
      continue;
    }
    aggregated.set(key, { ...entry });
  }
  return Array.from(aggregated.values());
}

export function makeRemoteWorkerSpecKey(spec: Pick<RemoteWorkerSpec, 'host' | 'repo' | 'platform'>): string {
  return `${spec.host}::${spec.platform}::${spec.repo}`;
}

export function sanitizeRemotePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function quotePosixShellArg(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function createRemoteDirectory(
  target: Pick<RemoteWorkerSpec, 'host' | 'platform'>,
  runDirAbsolutePath: string,
  timeoutMs = REMOTE_BOOTSTRAP_TIMEOUT_MS,
): Promise<void> {
  if (target.platform === 'windows') {
    await runSubprocess('ssh', [
      ...buildSshClientArgs(target.host),
      buildWindowsSshCommand(
        `$null = New-Item -ItemType Directory -Force -Path ${quotePowerShellArg(runDirAbsolutePath)}`,
      ),
    ], { timeoutMs });
    return;
  }
  await runSubprocess('ssh', [
    ...buildSshClientArgs(target.host),
    'sh',
    '-lc',
    `mkdir -p ${quotePosixShellArg(runDirAbsolutePath)}`,
  ], { timeoutMs });
}

export async function removeRemoteDirectory(
  target: Pick<RemoteWorkerSpec, 'host' | 'platform'>,
  runDirAbsolutePath: string,
  timeoutMs = REMOTE_BOOTSTRAP_TIMEOUT_MS,
): Promise<void> {
  if (target.platform === 'windows') {
    await runSubprocess('ssh', [
      ...buildSshClientArgs(target.host),
      buildWindowsSshCommand(
        `if (Test-Path -LiteralPath ${quotePowerShellArg(runDirAbsolutePath)}) { Remove-Item -LiteralPath ${quotePowerShellArg(runDirAbsolutePath)} -Recurse -Force }`,
      ),
    ], { timeoutMs });
    return;
  }
  await runSubprocess('ssh', [
    ...buildSshClientArgs(target.host),
    'sh',
    '-lc',
    `rm -rf ${quotePosixShellArg(runDirAbsolutePath)}`,
  ], { timeoutMs });
}

export async function copyFileToRemote(
  target: Pick<RemoteWorkerSpec, 'host' | 'platform'>,
  localAbsolutePath: string,
  remoteAbsolutePath: string,
  timeoutMs = REMOTE_BOOTSTRAP_TIMEOUT_MS,
): Promise<void> {
  if (target.platform === 'windows') {
    await runSubprocess('scp', [
      ...buildScpClientArgs(),
      localAbsolutePath,
      `${target.host}:${toWindowsScpRemotePath(remoteAbsolutePath)}`,
    ], { timeoutMs });
    return;
  }
  await runSubprocess('scp', [
    ...buildScpClientArgs(),
    localAbsolutePath,
    `${target.host}:${quotePosixShellArg(remoteAbsolutePath)}`,
  ], { timeoutMs });
}

export async function copyFileFromRemote(
  target: Pick<RemoteWorkerSpec, 'host' | 'platform'>,
  remoteAbsolutePath: string,
  localAbsolutePath: string,
  timeoutMs = REMOTE_BOOTSTRAP_TIMEOUT_MS,
): Promise<void> {
  if (target.platform === 'windows') {
    await runSubprocess('scp', [
      ...buildScpClientArgs(),
      `${target.host}:${toWindowsScpRemotePath(remoteAbsolutePath)}`,
      localAbsolutePath,
    ], { timeoutMs });
    return;
  }
  await runSubprocess('scp', [
    ...buildScpClientArgs(),
    `${target.host}:${quotePosixShellArg(remoteAbsolutePath)}`,
    localAbsolutePath,
  ], { timeoutMs });
}

export function buildRemoteNodeTsxSshArgs(
  target: Pick<RemoteWorkerSpec, 'host' | 'platform' | 'repo'>,
  scriptRelativePath: string,
  scriptArgs: string[],
): string[] {
  const sshPrefix = buildSshClientArgs(target.host);
  if (target.platform === 'windows') {
    return [
      ...sshPrefix,
      buildWindowsSshCommand(buildRemoteNodeTsxWindowsCommand(target.repo, scriptRelativePath, scriptArgs)),
    ];
  }
  return [
    ...sshPrefix,
    'sh',
    '-lc',
    buildRemoteNodeTsxPosixCommand(target.repo, scriptRelativePath, scriptArgs),
  ];
}

function buildRemoteNodeTsxPosixCommand(repo: string, scriptRelativePath: string, scriptArgs: string[]): string {
  const args = [
    'node',
    '--import',
    'tsx',
    scriptRelativePath,
    ...scriptArgs,
  ].map((value) => quotePosixShellArg(value)).join(' ');
  return `cd ${quotePosixShellArg(repo)} && ${args}`;
}

function buildRemoteNodeTsxWindowsCommand(repo: string, scriptRelativePath: string, scriptArgs: string[]): string {
  const args = [
    'node',
    '--import',
    'tsx',
    scriptRelativePath,
    ...scriptArgs,
  ].map((value) => quotePowerShellArg(value)).join(' ');
  return `Set-Location -LiteralPath ${quotePowerShellArg(repo)}; & ${args}`;
}

export function inferRemoteWorkerPlatform(repo: string): RemoteWorkerPlatform {
  if (isWindowsAbsolutePath(repo)) return 'windows';
  if (path.posix.isAbsolute(repo)) return 'posix';
  throw new Error(`Invalid --remote-worker repo path (must be absolute): ${repo}`);
}

export function normalizeRemoteWorkerRepoPath(repo: string, platform: RemoteWorkerPlatform): string {
  if (platform === 'windows') {
    return trimTrailingWindowsSeparators(path.win32.normalize(repo));
  }
  return repo.replace(/\/+$/, '') || '/';
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function trimTrailingWindowsSeparators(value: string): string {
  const root = path.win32.parse(value).root;
  if (value === root) return value;
  return value.replace(/[\\/]+$/, '');
}

export function toWindowsScpRemotePath(remoteAbsolutePath: string): string {
  const forwardSlashPath = remoteAbsolutePath.replace(/\\/g, '/');
  return forwardSlashPath.startsWith('/') ? forwardSlashPath : `/${forwardSlashPath}`;
}

export function buildWindowsSshCommand(powerShellCommand: string): string {
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodePowerShellCommand(powerShellCommand)}`;
}

export function buildSshClientArgs(host: string): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    host,
  ];
}

export function buildScpClientArgs(): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
  ];
}

function encodePowerShellCommand(value: string): string {
  return Buffer.from(value, 'utf16le').toString('base64');
}

export function runSubprocess(
  command: string,
  args: string[],
  options?: {
    stdinData?: Buffer;
    timeoutMs?: number;
  },
): Promise<CommandExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: [options?.stdinData ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = options?.timeoutMs ?? 0;
    const timeoutHandle = timeoutMs > 0 ? setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // Ignore shutdown failures and reject with the timeout error below.
      }
      reject(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs) : null;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = appendCapturedOutput(stdout, chunk, 32 * 1024);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = appendCapturedOutput(stderr, chunk, 32 * 1024);
    });
    if (options?.stdinData) {
      child.stdin?.on('error', () => {
        // Ignore broken pipe errors; the process close path reports the real failure.
      });
      child.stdin?.end(options.stdinData);
    }
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const result: CommandExecutionResult = {
        code: code ?? 1,
        stdout,
        stderr,
      };
      if (result.code !== 0) {
        const stderrTail = result.stderr.trim();
        const suffix = stderrTail.length > 0 ? `: ${stderrTail}` : '';
        reject(new Error(`${command} ${args.join(' ')} exited with code ${result.code}${suffix}`));
        return;
      }
      resolve(result);
    });
  });
}

function appendCapturedOutput(current: string, chunk: string, limit: number): string {
  if (chunk.length >= limit) {
    return chunk.slice(-limit);
  }
  const overflow = current.length + chunk.length - limit;
  if (overflow <= 0) {
    return current + chunk;
  }
  return current.slice(overflow) + chunk;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function serializeRemoteWorkerSpec(spec: Pick<RemoteWorkerSpec, 'host' | 'repo' | 'workers'>): string {
  return `host=${spec.host},repo=${spec.repo},workers=${spec.workers}`;
}
