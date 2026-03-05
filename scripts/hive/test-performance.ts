import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  getLegalMovesForColor,
  type HiveComputerDifficulty,
  type HiveSearchEngine,
} from '../../lib/hive/ai';
import { moveToActionKey } from '../../lib/hive/actionEncoding';
import { parseHiveModel, type HiveModel } from '../../lib/hive/ml';

interface PerfOptions {
  engine: HiveSearchEngine;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  movesPerBudget: number;
  latencyMax200Ms: number;
  latencyMax500Ms: number;
  latencyMax1000Ms: number;
  latencyP90Max200Ms: number;
  latencyP90Max500Ms: number;
  latencyP90Max1000Ms: number;
  memoryIterations: number;
  memoryCeilingMb: number;
  modelPath: string | null;
}

interface BudgetProfile {
  label: string;
  budgetMs: number;
  simulations: number;
  meanLimitMs: number;
  p90LimitMs: number;
}

const DEFAULT_OPTIONS: PerfOptions = {
  engine: 'alphazero',
  difficulty: 'extreme',
  maxTurns: 220,
  movesPerBudget: 40,
  latencyMax200Ms: 200,
  latencyMax500Ms: 500,
  latencyMax1000Ms: 1000,
  latencyP90Max200Ms: 320,
  latencyP90Max500Ms: 800,
  latencyP90Max1000Ms: 1600,
  memoryIterations: 240,
  memoryCeilingMb: 4096,
  modelPath: null,
};

function getBudgetProfiles(options: PerfOptions): BudgetProfile[] {
  return [
    {
      label: '200ms',
      budgetMs: 200,
      simulations: 48,
      meanLimitMs: options.latencyMax200Ms,
      p90LimitMs: options.latencyP90Max200Ms,
    },
    {
      label: '500ms',
      budgetMs: 500,
      simulations: 120,
      meanLimitMs: options.latencyMax500Ms,
      p90LimitMs: options.latencyP90Max500Ms,
    },
    {
      label: '1000ms',
      budgetMs: 1000,
      simulations: 260,
      meanLimitMs: options.latencyMax1000Ms,
      p90LimitMs: options.latencyP90Max1000Ms,
    },
  ];
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const model = loadModelOrNull(options.modelPath);
  const budgetProfiles = getBudgetProfiles(options);

  console.log(
    `[perf] engine=${options.engine} difficulty=${options.difficulty} maxTurns=${options.maxTurns} movesPerBudget=${options.movesPerBudget} memoryIters=${options.memoryIterations}`,
  );
  if (options.modelPath) {
    console.log(`[perf] model=${path.resolve(process.cwd(), options.modelPath)}`);
  }

  const latencyResults = budgetProfiles.map((profile, profileIndex) => {
    const result = runLatencyProfile(options, model, profile, profileIndex);
    console.log(
      `[perf] ${profile.label} sims=${profile.simulations} mean=${result.meanMs.toFixed(1)}ms p50=${result.p50Ms.toFixed(1)}ms p90=${result.p90Ms.toFixed(1)}ms limits(mean<=${profile.meanLimitMs.toFixed(0)} p90<=${profile.p90LimitMs.toFixed(0)}) pass=${result.latencyPass ? 'yes' : 'no'} illegal=${result.illegalMoves}/${result.totalMoves}`,
    );
    return result;
  });

  const memory = runMemoryProfile(options, model);
  console.log(
    `[perf] memory baseline=${memory.baselineMb.toFixed(1)}MB peak=${memory.peakMb.toFixed(1)}MB delta=${memory.deltaMb.toFixed(1)}MB ceiling=${options.memoryCeilingMb.toFixed(1)}MB pass=${memory.pass ? 'yes' : 'no'}`,
  );

  const illegalMoves = latencyResults.reduce((sum, result) => sum + result.illegalMoves, 0) + memory.illegalMoves;
  if (illegalMoves > 0) {
    throw new Error(`Illegal move regression detected (${illegalMoves} illegal moves)`);
  }
  const failingLatency = latencyResults.filter((result) => !result.latencyPass);
  if (failingLatency.length > 0) {
    const detail = failingLatency
      .map((result) => `${result.label}(mean=${result.meanMs.toFixed(1)}>${result.meanLimitMs.toFixed(1)} or p90=${result.p90Ms.toFixed(1)}>${result.p90LimitMs.toFixed(1)})`)
      .join(', ');
    throw new Error(`Latency threshold check failed: ${detail}`);
  }
  if (!memory.pass) {
    throw new Error(
      `Memory ceiling exceeded: peak ${memory.peakMb.toFixed(1)}MB > ${options.memoryCeilingMb.toFixed(1)}MB`,
    );
  }

  console.log('[perf] all checks passed');
}

function runLatencyProfile(
  options: PerfOptions,
  model: HiveModel | null,
  profile: BudgetProfile,
  profileIndex: number,
): {
  label: string;
  meanMs: number;
  p50Ms: number;
  p90Ms: number;
  meanLimitMs: number;
  p90LimitMs: number;
  latencyPass: boolean;
  illegalMoves: number;
  totalMoves: number;
} {
  const latencies: number[] = [];
  let illegalMoves = 0;
  let totalMoves = 0;
  let state = createLocalHiveGameState({
    id: `perf-lat-${Date.now()}-${profileIndex}`,
    shortCode: 'PERF',
    whitePlayerId: 'w',
    blackPlayerId: 'b',
  });

  for (let moveIndex = 0; moveIndex < options.movesPerBudget; moveIndex += 1) {
    if (state.status !== 'playing' || state.turnNumber > options.maxTurns) {
      state = createLocalHiveGameState({
        id: `perf-lat-reset-${Date.now()}-${moveIndex}`,
        shortCode: 'PERF',
        whitePlayerId: 'w',
        blackPlayerId: 'b',
      });
    }

    const legal = getLegalMovesForColor(state, state.currentTurn);
    if (legal.length === 0) {
      state = {
        ...state,
        status: 'finished',
        winner: state.currentTurn === 'white' ? 'black' : 'white',
      };
      continue;
    }

    const started = performance.now();
    const move = chooseHiveMoveForColor(state, state.currentTurn, options.difficulty, {
      modelOverride: model ?? undefined,
      engine: options.engine,
      randomSeed: 1401 + profileIndex * 1009 + moveIndex * 37,
      mctsConfig: options.engine === 'classic'
        ? undefined
        : {
            simulations: profile.simulations,
            maxDepth: options.maxTurns,
          },
    });
    const elapsed = performance.now() - started;
    latencies.push(elapsed);
    totalMoves += 1;

    if (!move) {
      illegalMoves += 1;
      continue;
    }

    const legalKeys = new Set(legal.map((candidate) => moveToActionKey(candidate)));
    if (!legalKeys.has(moveToActionKey(move))) {
      illegalMoves += 1;
      continue;
    }

    state = applyHiveMove(state, move);
  }

  const meanMs = mean(latencies);
  const p50Ms = percentile(latencies, 0.5);
  const p90Ms = percentile(latencies, 0.9);
  const latencyPass = meanMs <= profile.meanLimitMs && p90Ms <= profile.p90LimitMs;

  return {
    label: profile.label,
    meanMs,
    p50Ms,
    p90Ms,
    meanLimitMs: profile.meanLimitMs,
    p90LimitMs: profile.p90LimitMs,
    latencyPass,
    illegalMoves,
    totalMoves,
  };
}

function runMemoryProfile(
  options: PerfOptions,
  model: HiveModel | null,
): {
  baselineMb: number;
  peakMb: number;
  deltaMb: number;
  pass: boolean;
  illegalMoves: number;
} {
  const baselineMb = process.memoryUsage().rss / (1024 * 1024);
  let peakMb = baselineMb;
  let illegalMoves = 0;

  let state = createLocalHiveGameState({
    id: `perf-mem-${Date.now()}`,
    shortCode: 'PERF',
    whitePlayerId: 'w',
    blackPlayerId: 'b',
  });

  for (let index = 0; index < options.memoryIterations; index += 1) {
    if (state.status !== 'playing' || state.turnNumber > options.maxTurns) {
      state = createLocalHiveGameState({
        id: `perf-mem-reset-${Date.now()}-${index}`,
        shortCode: 'PERF',
        whitePlayerId: 'w',
        blackPlayerId: 'b',
      });
    }

    const legal = getLegalMovesForColor(state, state.currentTurn);
    if (legal.length === 0) {
      state = {
        ...state,
        status: 'finished',
        winner: state.currentTurn === 'white' ? 'black' : 'white',
      };
      continue;
    }

    const move = chooseHiveMoveForColor(state, state.currentTurn, options.difficulty, {
      modelOverride: model ?? undefined,
      engine: options.engine,
      randomSeed: 3907 + index * 23,
      mctsConfig: options.engine === 'classic'
        ? undefined
        : {
            simulations: 260,
            maxDepth: options.maxTurns,
          },
    });

    if (!move) {
      illegalMoves += 1;
      continue;
    }
    const legalKeys = new Set(legal.map((candidate) => moveToActionKey(candidate)));
    if (!legalKeys.has(moveToActionKey(move))) {
      illegalMoves += 1;
      continue;
    }

    state = applyHiveMove(state, move);

    if (index % 10 === 0 || index + 1 === options.memoryIterations) {
      const rssMb = process.memoryUsage().rss / (1024 * 1024);
      peakMb = Math.max(peakMb, rssMb);
    }
  }

  return {
    baselineMb,
    peakMb,
    deltaMb: Math.max(0, peakMb - baselineMb),
    pass: peakMb <= options.memoryCeilingMb,
    illegalMoves,
  };
}

function loadModelOrNull(modelPath: string | null): HiveModel | null {
  if (!modelPath) return null;
  const absolutePath = path.resolve(process.cwd(), modelPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Model path not found: ${modelPath}`);
  }
  const raw = readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const model = parseHiveModel(parsed);
  if (!model) {
    throw new Error(`Invalid model JSON: ${modelPath}`);
  }
  return model;
}

function parseOptions(argv: string[]): PerfOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsageAndExit();
  }

  const options: PerfOptions = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--engine':
        options.engine = parseEngine(next);
        index += 1;
        break;
      case '--difficulty':
        options.difficulty = parseDifficulty(next);
        index += 1;
        break;
      case '--max-turns':
        options.maxTurns = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--moves-per-budget':
        options.movesPerBudget = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--latency-max-200':
        options.latencyMax200Ms = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--latency-max-500':
        options.latencyMax500Ms = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--latency-max-1000':
        options.latencyMax1000Ms = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--latency-p90-max-200':
        options.latencyP90Max200Ms = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--latency-p90-max-500':
        options.latencyP90Max500Ms = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--latency-p90-max-1000':
        options.latencyP90Max1000Ms = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--memory-iterations':
        options.memoryIterations = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--memory-ceiling-mb':
        options.memoryCeilingMb = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--model':
      case '--model-path':
        if (!next) throw new Error(`Missing value for ${arg}`);
        options.modelPath = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseEngine(value: string | undefined): HiveSearchEngine {
  if (!value) throw new Error('Missing value for --engine');
  if (value === 'classic' || value === 'alphazero' || value === 'gumbel') return value;
  throw new Error(`Invalid --engine value: ${value}`);
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (!value) throw new Error('Missing value for --difficulty');
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parsePositiveFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function printUsageAndExit(): never {
  console.log('Usage: npm run hive:test:perf -- [options]');
  console.log('  --engine <classic|alphazero|gumbel>   Engine (default: alphazero)');
  console.log('  --difficulty <medium|hard|extreme>    Difficulty (default: extreme)');
  console.log('  --max-turns <n>                       Max turns per simulated game (default: 220)');
  console.log('  --moves-per-budget <n>                Move samples per latency tier (default: 40)');
  console.log('  --latency-max-200 <ms>                Mean latency max for 200ms tier (default: 200)');
  console.log('  --latency-max-500 <ms>                Mean latency max for 500ms tier (default: 500)');
  console.log('  --latency-max-1000 <ms>               Mean latency max for 1000ms tier (default: 1000)');
  console.log('  --latency-p90-max-200 <ms>            P90 latency max for 200ms tier (default: 320)');
  console.log('  --latency-p90-max-500 <ms>            P90 latency max for 500ms tier (default: 800)');
  console.log('  --latency-p90-max-1000 <ms>           P90 latency max for 1000ms tier (default: 1600)');
  console.log('  --memory-iterations <n>               Iterations for memory sweep (default: 240)');
  console.log('  --memory-ceiling-mb <float>           Max allowed RSS in MB (default: 4096)');
  console.log('  --model-path <path>                   Optional model override path');
  process.exit(0);
}

main();
