import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

const WATCHED_ROOTS = [
  'scripts/hive',
  'lib/hive',
];

const WATCHED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
]);

const RESTART_DEBOUNCE_MS = 750;
const TRAINER_SCRIPT = path.resolve(process.cwd(), 'scripts/hive/train-alphazero-async.ts');

let interrupted = false;
let child: ChildProcess | null = null;
let restartQueued = false;
let restartTimer: NodeJS.Timeout | null = null;
let pendingReason = 'initial start';
let initialLaunch = true;

function main(): void {
  const forwardedArgs = process.argv.slice(2);
  if (forwardedArgs.includes('--help') || forwardedArgs.includes('-h')) {
    printUsageAndExit();
  }

  const watchers = installWatchers((filePath) => {
    if (!shouldRestartForPath(filePath)) return;
    queueRestart(`code change detected in ${path.relative(process.cwd(), filePath)}`);
  });

  installSignalHandlers(watchers);
  spawnTrainer(forwardedArgs);
}

function spawnTrainer(forwardedArgs: string[]): void {
  if (interrupted || child) return;
  const args = [
    '--import',
    'tsx',
    TRAINER_SCRIPT,
    ...forwardedArgs,
  ];
  const reason = pendingReason;
  pendingReason = 'manual restart';
  restartQueued = false;

  log('watch', `${initialLaunch ? 'starting' : 'restarting'} trainer (${reason})`);
  initialLaunch = false;

  child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    shell: false,
  });

  child.on('error', (error) => {
    log('error', `trainer failed to start: ${error.message}`);
    child = null;
  });

  child.on('exit', (code, signal) => {
    const hadPendingRestart = restartQueued;
    child = null;
    log('watch', `trainer exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);

    if (interrupted) {
      process.exit(code ?? 0);
    }

    if (hadPendingRestart) {
      spawnTrainer(forwardedArgs);
      return;
    }

    log('watch', 'trainer stopped; waiting for file changes to restart');
  });
}

function queueRestart(reason: string): void {
  pendingReason = reason;
  restartQueued = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (interrupted) return;
    if (!child) {
      spawnTrainer(process.argv.slice(2));
      return;
    }
    log('watch', `${reason}; restart queued after current active step`);
    if (child.connected) {
      child.send({ type: 'watch-restart' });
    }
  }, RESTART_DEBOUNCE_MS);
}

function shouldRestartForPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return WATCHED_EXTENSIONS.has(extension);
}

function installWatchers(onChange: (filePath: string) => void): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  for (const root of WATCHED_ROOTS) {
    const absoluteRoot = path.resolve(process.cwd(), root);
    if (!existsSync(absoluteRoot)) continue;
    try {
      watchers.push(watch(absoluteRoot, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        onChange(path.resolve(absoluteRoot, filename.toString()));
      }));
      continue;
    } catch {
      // Fall back to one watcher per directory if recursive watch is unavailable.
    }

    for (const directory of collectDirectories(absoluteRoot)) {
      watchers.push(watch(directory, (_eventType, filename) => {
        if (!filename) return;
        onChange(path.resolve(directory, filename.toString()));
      }));
    }
  }
  return watchers;
}

function collectDirectories(root: string): string[] {
  const directories = [root];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const next = path.join(current, entry.name);
      directories.push(next);
      queue.push(next);
    }
  }

  return directories;
}

function installSignalHandlers(watchers: FSWatcher[]): void {
  const stop = (): void => {
    if (interrupted) return;
    interrupted = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    for (const watcher of watchers) {
      watcher.close();
    }
    if (!child) {
      process.exit(0);
      return;
    }
    log('watch', 'shutdown requested; waiting for current active step');
    if (child.connected) {
      child.send({ type: 'watch-shutdown' });
      return;
    }
    child.kill('SIGINT');
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function printUsageAndExit(): never {
  console.log('Usage: npm run hive:train:az:async:watch -- [async trainer options]');
  console.log('Watches scripts/hive and lib/hive for code changes and restarts the async trainer');
  console.log('after the current active step using the persisted learner/replay state.');
  process.exit(0);
}

function log(stage: string, message: string): void {
  const clock = new Date().toISOString().slice(11, 19);
  console.log(`[${clock}] [az-watch:${stage}] ${message}`);
}

main();
