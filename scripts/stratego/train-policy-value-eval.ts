import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { getStrategoHardwareProfile } from './hardware-profile';

interface ParsedArgs {
  selfPlayArgs: string[];
  policyArgs: string[];
  evalArgs: string[];
  keepDataset: boolean;
  help: boolean;
}

type ArgTarget = 'selfplay' | 'policy' | 'eval';

const HARDWARE_PROFILE = getStrategoHardwareProfile();
const DEFAULT_DATASET_PATH = '.stratego-cache/policy-value-dataset.json';

const DEFAULT_SELF_PLAY_ARGS = [
  '--games',
  '300',
  '--difficulty',
  'extreme',
  '--workers',
  String(HARDWARE_PROFILE.selfPlayWorkers),
  '--max-turns',
  '500',
  '--no-capture-draw',
  '160',
  '--progress-every',
  '20',
  '--verbose',
  '--skip-fit',
  '--dataset-out',
  DEFAULT_DATASET_PATH,
  '--policy-targets',
  '--policy-temperature',
  '1.1',
  '--policy-top-k',
  '12',
  '--search-mode',
  'puct-lite',
  '--puct-simulations',
  '240',
  '--puct-cpuct',
  '1.18',
  '--puct-rollout-depth',
  '18',
  '--value-target-mode',
  'mixed',
  '--search-value-blend',
  '0.35',
  '--bootstrap-steps',
  '2',
  '--bootstrap-discount',
  '0.98',
  '--bootstrap-blend',
  '0.35',
];

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

  const selfPlayScript = resolveScriptPath('scripts/stratego/train-model.ts');
  const policyScript = resolveScriptPath('scripts/stratego/train-policy-value.ts');
  const evalScript = resolveScriptPath('scripts/stratego/eval.ts');

  const selfPlayArgs = [...DEFAULT_SELF_PLAY_ARGS, ...parsed.selfPlayArgs];
  await runTsxScript(selfPlayScript, selfPlayArgs);

  const datasetPathValue = readLastFlagValue(selfPlayArgs, '--dataset-out');
  if (!datasetPathValue) {
    throw new Error('Policy-value pipeline requires --dataset-out in self-play args.');
  }
  const datasetPath = path.resolve(process.cwd(), datasetPathValue);

  const defaultPolicyArgs = [
    '--dataset',
    datasetPath,
    '--out',
    path.resolve(process.cwd(), 'lib/stratego/trained-model.json'),
    '--epochs',
    '40',
    '--batch-size',
    '512',
    '--lr',
    '0.0012',
    '--weight-decay',
    '0.0001',
    '--hidden',
    '128,96',
    '--policy-weight',
    '1.0',
    '--value-weight',
    '1.0',
    '--device',
    'auto',
  ];
  const policyArgs = [...defaultPolicyArgs, ...parsed.policyArgs];
  await runTsxScript(policyScript, policyArgs);

  const evalArgs = [...DEFAULT_EVAL_ARGS, ...parsed.evalArgs];
  await runTsxScript(evalScript, evalArgs);

  if (!parsed.keepDataset && existsSync(datasetPath)) {
    rmSync(datasetPath, { force: true });
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    selfPlayArgs: [],
    policyArgs: [],
    evalArgs: [],
    keepDataset: false,
    help: false,
  };

  let target: ArgTarget = 'selfplay';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--keep-dataset') {
      parsed.keepDataset = true;
      continue;
    }
    if (arg === '--policy') {
      target = 'policy';
      continue;
    }
    if (arg === '--eval') {
      target = 'eval';
      continue;
    }

    const prefixedPolicy = convertPrefixedFlag(arg, 'policy');
    if (prefixedPolicy) {
      parsed.policyArgs.push(prefixedPolicy);
      if (!arg.includes('=') && next && !next.startsWith('-')) {
        parsed.policyArgs.push(next);
        index += 1;
      }
      continue;
    }

    const prefixedEval = convertPrefixedFlag(arg, 'eval');
    if (prefixedEval) {
      parsed.evalArgs.push(prefixedEval);
      if (!arg.includes('=') && next && !next.startsWith('-')) {
        parsed.evalArgs.push(next);
        index += 1;
      }
      continue;
    }

    if (target === 'policy') {
      parsed.policyArgs.push(arg);
      continue;
    }
    if (target === 'eval') {
      parsed.evalArgs.push(arg);
      continue;
    }
    parsed.selfPlayArgs.push(arg);
  }

  return parsed;
}

function convertPrefixedFlag(arg: string, prefix: 'policy' | 'eval'): string | null {
  const prefixToken = `--${prefix}-`;
  if (!arg.startsWith(prefixToken)) return null;
  return `--${arg.slice(prefixToken.length)}`;
}

function readLastFlagValue(args: string[], flag: string): string | null {
  let found: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === flag) {
      const value = args[index + 1];
      if (value && !value.startsWith('-')) {
        found = value;
      }
      continue;
    }
    if (current.startsWith(`${flag}=`)) {
      found = current.slice(flag.length + 1);
    }
  }
  return found;
}

function resolveScriptPath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
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

async function runTsxScript(scriptPath: string, args: string[]): Promise<void> {
  await runCommand(process.execPath, ['--import', 'tsx', scriptPath, ...args]);
}

function printHelpAndExit(): never {
  console.log('Usage: npm run stratego:train:policy-value:eval -- [self-play args] [policy args] [eval args]');
  console.log('');
  console.log('Behavior:');
  console.log('  1) Runs train-model.ts in self-play/data mode with policy-target defaults');
  console.log('  2) Trains a policy-value model into lib/stratego/trained-model.json');
  console.log('  3) Runs stratego:eval');
  console.log('');
  console.log('Default self-play args:');
  console.log(`  ${DEFAULT_SELF_PLAY_ARGS.join(' ')}`);
  console.log('');
  console.log('Default policy-train args:');
  console.log('  --epochs 40 --batch-size 512 --lr 0.0012 --weight-decay 0.0001 --hidden 128,96 --policy-weight 1.0 --value-weight 1.0 --device auto');
  console.log('');
  console.log('Default eval args:');
  console.log(`  ${DEFAULT_EVAL_ARGS.join(' ')}`);
  console.log('');
  console.log('Routing options:');
  console.log('  --policy-<arg> ...   Route a flag to policy trainer, e.g. --policy-epochs 60');
  console.log('  --eval-<arg> ...     Route a flag to eval, e.g. --eval-games 100');
  console.log('  --policy             Route all following args to policy trainer (until --eval)');
  console.log('  --eval               Route all following args to eval');
  console.log('  --keep-dataset       Keep generated dataset file');
  process.exit(0);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
