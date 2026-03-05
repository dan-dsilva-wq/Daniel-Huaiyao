import { spawn } from 'node:child_process';
import path from 'node:path';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelpAndExit();
  }

  const trainScript = resolveScript('scripts/hive/train-alphazero.ts');
  const arenaScript = resolveScript('scripts/hive/eval-arena.ts');

  await runCommand(process.execPath, ['--import', 'tsx', trainScript, ...parsed.trainArgs]);
  await runCommand(process.execPath, ['--import', 'tsx', arenaScript, ...parsed.arenaArgs]);
}

function parseArgs(argv: string[]): { trainArgs: string[]; arenaArgs: string[]; help: boolean } {
  const trainArgs: string[] = [];
  const arenaArgs: string[] = [];
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--arena') {
      arenaArgs.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--arena-')) {
      const converted = `--${arg.slice('--arena-'.length)}`;
      arenaArgs.push(converted);
      const maybeValue = argv[index + 1];
      if (maybeValue && !maybeValue.startsWith('--')) {
        arenaArgs.push(maybeValue);
        index += 1;
      }
      continue;
    }

    trainArgs.push(arg);
  }

  return { trainArgs, arenaArgs, help };
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) return resolve();
      if (signal) return reject(new Error(`${command} terminated by signal ${signal}`));
      return reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function resolveScript(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}

function printHelpAndExit(): never {
  console.log('Usage: npm run hive:train:az:eval -- [train args] [arena args]');
  console.log('');
  console.log('Behavior:');
  console.log('  1) Runs scripts/hive/train-alphazero.ts');
  console.log('  2) Runs scripts/hive/eval-arena.ts');
  console.log('');
  console.log('Argument routing:');
  console.log('  - Default: all args go to train-alphazero.ts');
  console.log('  - Prefix arena args with --arena-, e.g. --arena-games 400');
  console.log('  - Or use --arena separator to send remaining args to eval-arena.ts');
  process.exit(0);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
