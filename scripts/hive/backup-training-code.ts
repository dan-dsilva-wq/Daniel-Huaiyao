import { execFileSync } from 'node:child_process';

interface BackupOptions {
  withModel: boolean;
  message: string;
}

const DEFAULT_MESSAGE = 'hive: backup training code';

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const paths = [
    'scripts/hive',
    'package.json',
    'package-lock.json',
    'HIVE_ML_TRAINING.md',
  ];

  if (options.withModel) {
    paths.push('lib/hive/trained-model.json');
  }

  runGit(['add', '--', ...paths]);

  if (!hasStagedChanges()) {
    console.log('No staged Hive training changes to commit.');
    return;
  }

  runGit(['commit', '-m', options.message]);
  runGit(['push', 'origin', 'HEAD']);
  console.log(`Pushed Hive training backup: ${options.message}`);
}

function parseArgs(argv: string[]): BackupOptions {
  const options: BackupOptions = {
    withModel: false,
    message: DEFAULT_MESSAGE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--with-model':
        options.withModel = true;
        break;
      case '--message':
      case '-m':
        if (!next) {
          throw new Error(`Missing value for ${arg}`);
        }
        options.message = next;
        index += 1;
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

function runGit(args: string[]): void {
  execFileSync('git', args, { stdio: 'inherit' });
}

function hasStagedChanges(): boolean {
  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function printHelpAndExit(): never {
  console.log('Usage: npm run hive:backup:code -- [options]');
  console.log('  --message, -m <text>   Commit message (default: hive: backup training code)');
  console.log('  --with-model           Include lib/hive/trained-model.json in the backup');
  process.exit(0);
}

main();
