import { spawn } from 'node:child_process';
import path from 'node:path';

async function main(): Promise<void> {
  const scriptPath = path.resolve(process.cwd(), 'scripts/stratego/train-model-policy-value.py');
  const passthroughArgs = process.argv.slice(2);
  const attempts: Array<{ command: string; args: string[]; label: string }> = [
    { command: 'python', args: [scriptPath, ...passthroughArgs], label: 'python' },
    { command: 'py', args: ['-3', scriptPath, ...passthroughArgs], label: 'py -3' },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      console.log(`[policy-value] launching ${attempt.label}...`);
      await runCommand(attempt.command, attempt.args);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `Unable to launch policy-value trainer. Ensure Python + PyTorch are installed. Last error: ${lastError?.message ?? 'unknown'}`,
  );
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

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
