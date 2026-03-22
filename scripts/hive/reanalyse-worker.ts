import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  getLegalMovesForColor,
  runHiveMctsSearch,
  type HiveComputerDifficulty,
} from '../../lib/hive/ai';
import {
  extractHiveActionFeatures,
  parseHiveModel,
} from '../../lib/hive/ml';
import type { GameState } from '../../lib/hive/types';

interface WorkerSample {
  index: number;
  stateSnapshot: GameState;
}

interface WorkerPayload {
  samples: WorkerSample[];
  modelPath: string;
  difficulty: HiveComputerDifficulty;
  fastSimulations: number;
  maxTurns: number;
}

interface WorkerPolicyTarget {
  actionKey: string;
  probability: number;
  visitCount: number;
  actionFeatures: number[];
}

interface WorkerSearchMeta {
  simulations: number;
  nodesPerSecond: number;
  policyEntropy: number;
  averageDepth: number;
  dirichletAlpha: number;
  temperature: number;
  maxDepth: number;
  reanalysed: boolean;
}

interface WorkerUpdate {
  index: number;
  policyTargets: WorkerPolicyTarget[];
  searchMeta: WorkerSearchMeta;
}

interface WorkerResult {
  updates: WorkerUpdate[];
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const payload = readPayload(options.inputPath);
  const model = readModel(payload.modelPath);
  const updates: WorkerUpdate[] = [];

  for (let index = 0; index < payload.samples.length; index += 1) {
    const sample = payload.samples[index];
    const state = sample.stateSnapshot;
    const legal = getLegalMovesForColor(state, state.currentTurn);
    if (legal.length === 0) continue;

    // Use higher temperature (0.5) for reanalysis to produce softer policy targets
    // that provide gradient signal to non-best moves
    const search = runHiveMctsSearch(state, state.currentTurn, payload.difficulty, {
      engine: 'alphazero',
      modelOverride: model,
      mctsConfig: {
        simulations: Math.max(48, Math.floor(payload.fastSimulations * 0.8)),
        temperature: 0.5,
      },
      randomSeed: 7701 + index * 31 + sample.index * 7,
    });
    if (search.policy.length === 0) continue;

    updates.push({
      index: sample.index,
      policyTargets: search.policy.map((entry) => ({
        actionKey: entry.actionKey,
        probability: entry.rawProbability ?? entry.probability,
        visitCount: entry.rawVisits ?? entry.visits,
        actionFeatures: extractHiveActionFeatures(state, entry.move, state.currentTurn),
      })),
      searchMeta: {
        simulations: search.stats.simulations,
        nodesPerSecond: search.stats.nodesPerSecond,
        policyEntropy: search.stats.policyEntropy,
        averageDepth: search.stats.averageSimulationDepth,
        dirichletAlpha: 0,
        temperature: 0,
        maxDepth: payload.maxTurns,
        reanalysed: true,
      },
    });
  }

  const result: WorkerResult = { updates };
  mkdirSync(path.dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(result)}\n`, 'utf8');
}

function readPayload(inputPath: string): WorkerPayload {
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }
  const raw = readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw) as WorkerPayload;
  if (!parsed || !Array.isArray(parsed.samples)) {
    throw new Error('Invalid worker payload');
  }
  return parsed;
}

function readModel(absolutePath: string) {
  if (!existsSync(absolutePath)) {
    throw new Error(`Model file not found: ${absolutePath}`);
  }
  const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  const model = parseHiveModel(parsed);
  if (!model) {
    throw new Error(`Invalid model file: ${absolutePath}`);
  }
  return model;
}

function parseOptions(argv: string[]): { inputPath: string; outputPath: string } {
  let inputPath: string | null = null;
  let outputPath: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--input') {
      if (!next) throw new Error('Missing value for --input');
      inputPath = next;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      if (!next) throw new Error('Missing value for --output');
      outputPath = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!inputPath || !outputPath) {
    throw new Error('Usage: tsx scripts/hive/reanalyse-worker.ts --input <path> --output <path>');
  }
  return {
    inputPath: path.resolve(process.cwd(), inputPath),
    outputPath: path.resolve(process.cwd(), outputPath),
  };
}

main();
