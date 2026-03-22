/**
 * GPU Inference Client for Hive AlphaZero.
 *
 * This client communicates with the Python GPU inference server to provide
 * batched neural network inference. It collects inference requests and
 * sends them to the GPU in batches for better throughput.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import path from 'node:path';

export interface GpuInferenceAction {
  actionKey: string;
  actionFeatures: number[];
}

export interface GpuInferencePosition {
  stateFeatures: number[];
  actions: GpuInferenceAction[];
}

export interface GpuInferenceResult {
  value: number;
  actionLogits: Record<string, number>;
}

interface PendingRequest {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

interface ServerResponse {
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

export class GpuInferenceClient {
  private process: ChildProcess;
  private reader: Interface | null = null;
  private nextId = 1;
  private pending = new Map<string, PendingRequest>();
  private closed = false;
  private initPromise: Promise<Record<string, unknown>> | null = null;

  // Batching state
  private batchQueue: Array<{
    positions: GpuInferencePosition[];
    resolve: (results: GpuInferenceResult[]) => void;
    reject: (error: Error) => void;
  }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchDelayMs: number;
  private readonly maxBatchSize: number;

  private constructor(
    process: ChildProcess,
    options: { batchDelayMs?: number; maxBatchSize?: number } = {},
  ) {
    this.process = process;
    this.batchDelayMs = options.batchDelayMs ?? 2;
    this.maxBatchSize = options.maxBatchSize ?? 128;

    const stdout = process.stdout;
    if (stdout) {
      stdout.setEncoding('utf8');
      this.reader = createInterface({ input: stdout });
      this.reader.on('line', (line) => this.handleLine(line));
      this.reader.on('close', () => this.rejectAllPending(new Error('GPU server stdout closed')));
    }

    process.stderr?.setEncoding('utf8');
    process.stderr?.on('data', (chunk: string) => {
      process.stderr?.pipe(process.stderr);
      // Log GPU server messages to our stderr
      for (const line of chunk.split('\n').filter(Boolean)) {
        console.error(`[gpu] ${line}`);
      }
    });

    process.on('error', (error) => {
      this.rejectAllPending(error);
    });

    process.on('close', (code, signal) => {
      if (!this.closed) {
        this.rejectAllPending(
          new Error(`GPU server exited: code=${code ?? 'null'} signal=${signal ?? 'null'}`),
        );
      }
    });
  }

  /**
   * Start the GPU inference server and initialize with a model.
   */
  static async start(modelPath: string, options?: {
    device?: 'auto' | 'cuda' | 'cpu';
    batchDelayMs?: number;
    maxBatchSize?: number;
  }): Promise<GpuInferenceClient> {
    const scriptPath = path.resolve(process.cwd(), 'scripts/hive/gpu-inference-server.py');
    const pythonProcess = await spawnPythonWithFallback([scriptPath]);
    const client = new GpuInferenceClient(pythonProcess, options);

    // Initialize the model
    const initResult = await client.request('init', {
      modelPath: path.resolve(process.cwd(), modelPath),
      device: options?.device ?? 'auto',
    });

    client.initPromise = Promise.resolve(initResult);
    return client;
  }

  /**
   * Infer value and policy for a single position.
   * Requests are automatically batched for efficiency.
   */
  async infer(position: GpuInferencePosition): Promise<GpuInferenceResult> {
    const results = await this.inferBatch([position]);
    return results[0];
  }

  /**
   * Infer value and policy for multiple positions.
   */
  async inferBatch(positions: GpuInferencePosition[]): Promise<GpuInferenceResult[]> {
    if (positions.length === 0) {
      return [];
    }

    // For large batches, send directly
    if (positions.length >= this.maxBatchSize) {
      return this.inferDirect(positions);
    }

    // Queue for batching
    return new Promise((resolve, reject) => {
      this.batchQueue.push({ positions, resolve, reject });
      this.scheduleBatchFlush();
    });
  }

  /**
   * Send positions directly without batching.
   */
  private async inferDirect(positions: GpuInferencePosition[]): Promise<GpuInferenceResult[]> {
    const response = await this.request('infer', { positions });
    return (response.results as GpuInferenceResult[]) ?? [];
  }

  /**
   * Schedule batch flush after delay.
   */
  private scheduleBatchFlush(): void {
    if (this.batchTimer) return;

    // Check if we should flush immediately due to size
    const totalPositions = this.batchQueue.reduce((sum, req) => sum + req.positions.length, 0);
    if (totalPositions >= this.maxBatchSize) {
      this.flushBatch();
      return;
    }

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushBatch();
    }, this.batchDelayMs);
  }

  /**
   * Flush queued requests as a single batch.
   */
  private async flushBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const queue = this.batchQueue;
    this.batchQueue = [];

    // Combine all positions
    const allPositions: GpuInferencePosition[] = [];
    const offsets: number[] = [];
    for (const req of queue) {
      offsets.push(allPositions.length);
      allPositions.push(...req.positions);
    }

    try {
      const results = await this.inferDirect(allPositions);

      // Distribute results back to requesters
      for (let i = 0; i < queue.length; i++) {
        const req = queue[i];
        const start = offsets[i];
        const end = i < queue.length - 1 ? offsets[i + 1] : results.length;
        req.resolve(results.slice(start, end));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      for (const req of queue) {
        req.reject(err);
      }
    }
  }

  /**
   * Reload model from file.
   */
  async reload(modelPath: string): Promise<Record<string, unknown>> {
    return this.request('reload', {
      modelPath: path.resolve(process.cwd(), modelPath),
    });
  }

  /**
   * Get server statistics.
   */
  async stats(): Promise<Record<string, unknown>> {
    return this.request('stats', {});
  }

  /**
   * Gracefully shut down the server.
   */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    try {
      await Promise.race([
        this.request('shutdown', {}),
        sleep(3000).then(() => { throw new Error('Shutdown timeout'); }),
      ]);
    } catch {
      // Ignore shutdown errors
    } finally {
      this.process.kill();
    }
  }

  /**
   * Check if GPU is being used.
   */
  get isGpu(): boolean {
    return true; // Server handles this
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;

    let response: ServerResponse;
    try {
      response = JSON.parse(line) as ServerResponse;
    } catch {
      console.error(`[gpu] Invalid response: ${line}`);
      return;
    }

    const id = String(response.id ?? '');
    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    if (response.ok) {
      pending.resolve(response.payload ?? {});
    } else {
      pending.reject(new Error(response.error ?? 'GPU inference failed'));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();

    for (const req of this.batchQueue) {
      req.reject(error);
    }
    this.batchQueue = [];
  }

  private request(cmd: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.closed || !this.process.stdin) {
      return Promise.reject(new Error('GPU server not available'));
    }

    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ id, cmd, payload });
      this.process.stdin?.write(`${msg}\n`, 'utf8', (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }
}

/**
 * Try to spawn Python with multiple fallback paths.
 */
async function spawnPythonWithFallback(args: string[]): Promise<ChildProcess> {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const proc = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      // Wait a bit to see if process starts successfully
      await Promise.race([
        new Promise<void>((resolve) => {
          proc.on('spawn', resolve);
        }),
        new Promise<void>((_, reject) => {
          proc.on('error', reject);
        }),
        sleep(2000).then(() => {
          throw new Error(`Timeout starting ${cmd}`);
        }),
      ]);

      return proc;
    } catch {
      continue;
    }
  }

  throw new Error('Could not start Python. Install Python 3 with PyTorch.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Singleton GPU client for shared use across workers.
 */
let sharedClient: GpuInferenceClient | null = null;

export async function getSharedGpuClient(modelPath: string): Promise<GpuInferenceClient> {
  if (!sharedClient) {
    sharedClient = await GpuInferenceClient.start(modelPath);
  }
  return sharedClient;
}

export async function shutdownSharedGpuClient(): Promise<void> {
  if (sharedClient) {
    await sharedClient.shutdown();
    sharedClient = null;
  }
}
