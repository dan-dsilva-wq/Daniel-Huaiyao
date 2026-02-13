import { spawn } from 'node:child_process';

interface ParsedArgs {
  trainArgs: string[];
  evalArgs: string[];
  help: boolean;
}

const DEFAULT_EVAL_ARGS = [
  '--games',
  '60',
  '--difficulty',
  'extreme',
  '--max-turns',
  '500',
  '--no-capture-draw',
  '160',
  '--progress-every',
  '10',
];

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelpAndExit();
  }

  const npmCmd = resolveNpmCommand();
  await runCommand(npmCmd, ['run', 'stratego:train:deep', '--', ...parsed.trainArgs]);
  await runCommand(npmCmd, ['run', 'stratego:eval', '--', ...DEFAULT_EVAL_ARGS, ...parsed.evalArgs]);
}

function parseArgs(argv: string[]): ParsedArgs {
  const trainArgs: string[] = [];
  const evalArgs: string[] = [];
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--eval') {
      evalArgs.push(...argv.slice(index + 1));
      break;
    }

    if (arg.startsWith('--eval-')) {
      const converted = `--${arg.slice('--eval-'.length)}`;
      evalArgs.push(converted);
      const maybeValue = argv[index + 1];
      if (maybeValue && !maybeValue.startsWith('--')) {
        evalArgs.push(maybeValue);
        index += 1;
      }
      continue;
    }

    trainArgs.push(arg);
  }

  return { trainArgs, evalArgs, help };
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
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`));
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function resolveNpmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function printHelpAndExit(): never {
  console.log('Usage: npm run stratego:train:deep:eval -- [train args] [eval args]');
  console.log('');
  console.log('Behavior:');
  console.log('  1) Runs stratego:train:deep with train args');
  console.log('  2) Runs stratego:eval with default eval args, plus eval overrides');
  console.log('');
  console.log('Train args:');
  console.log('  Any non --eval-* args are forwarded to stratego:train:deep');
  console.log('');
  console.log('Eval args (two ways):');
  console.log('  1) Prefix with --eval-, e.g. --eval-games 100 --eval-difficulty hard');
  console.log('  2) Use --eval separator, e.g. --games 100 --epochs 10 --eval --games 80');
  console.log('');
  console.log('Default eval args:');
  console.log(`  ${DEFAULT_EVAL_ARGS.join(' ')}`);
  process.exit(0);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
