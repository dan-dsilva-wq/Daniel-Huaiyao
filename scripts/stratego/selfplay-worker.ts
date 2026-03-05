import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ComputerDifficulty, SearchAlgorithm } from '../../lib/stratego/ai';
import { parseStrategoModel } from '../../lib/stratego/ml';
import type { LeagueModelEntry, ValueTargetMode } from './training-core';
import { runSelfPlayBatch, type SelfPlayBatchResult, type SelfPlayGameSummary } from './training-core';

interface WorkerOptions {
  workerId: number;
  startGame: number;
  games: number;
  difficulty: ComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  traceTurns: boolean;
  includePolicyTargets: boolean;
  policyTemperature: number;
  policyTopK: number;
  valueTargetMode: ValueTargetMode;
  searchValueBlend: number;
  bootstrapSteps: number;
  bootstrapDiscount: number;
  bootstrapBlend: number;
  leagueModelPaths: string[];
  leagueSampleProb: number;
  leagueHeuristicProb: number;
  searchAlgorithm: SearchAlgorithm;
  puctSimulations: number;
  puctCpuct: number;
  puctRolloutDepth: number;
  outPath: string;
}

interface WorkerOutput {
  workerId: number;
  startGame: number;
  games: number;
  redWins: number;
  blueWins: number;
  draws: number;
  summaries: SelfPlayGameSummary[];
  samples: SelfPlayBatchResult['samples'];
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const leagueModels = loadLeagueModelPool(options.leagueModelPaths);
  const batch = runSelfPlayBatch(
    options.startGame,
    options.games,
    {
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      searchAlgorithm: options.searchAlgorithm,
      puctSimulations: options.puctSimulations,
      puctCpuct: options.puctCpuct,
      puctRolloutDepth: options.puctRolloutDepth,
      traceTurns: options.traceTurns,
      includePolicyTargets: options.includePolicyTargets,
      policyTemperature: options.policyTemperature,
      policyTopK: options.policyTopK,
      valueTargetMode: options.valueTargetMode,
      searchValueBlend: options.searchValueBlend,
      bootstrapSteps: options.bootstrapSteps,
      bootstrapDiscount: options.bootstrapDiscount,
      bootstrapBlend: options.bootstrapBlend,
      leagueModels,
      leagueSampleProb: options.leagueSampleProb,
      leagueHeuristicProb: options.leagueHeuristicProb,
      traceLog: options.traceTurns
        ? (line) => emitTrace(options.workerId, line)
        : undefined,
    },
    (summary) => emitProgress(options.workerId, summary),
  );

  const output: WorkerOutput = {
    workerId: options.workerId,
    startGame: options.startGame,
    games: options.games,
    redWins: batch.redWins,
    blueWins: batch.blueWins,
    draws: batch.draws,
    summaries: batch.summaries,
    samples: batch.samples,
  };

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${JSON.stringify(output)}\n`, 'utf8');
  console.log(
    `@@DONE ${JSON.stringify({
      workerId: options.workerId,
      outPath: options.outPath,
      games: options.games,
      samples: batch.samples.length,
    })}`,
  );
}

function emitProgress(workerId: number, summary: SelfPlayGameSummary): void {
  console.log(`@@PROGRESS ${JSON.stringify({ workerId, ...summary })}`);
}

function emitTrace(workerId: number, line: string): void {
  console.log(`@@TRACE ${JSON.stringify({ workerId, line })}`);
}

function parseOptions(argv: string[]): WorkerOptions {
  let workerId = 0;
  let startGame = 1;
  let games = 1;
  let difficulty: ComputerDifficulty = 'hard';
  let maxTurns = 500;
  let noCaptureDrawMoves = 160;
  let traceTurns = false;
  let includePolicyTargets = false;
  let policyTemperature = 1.1;
  let policyTopK = 12;
  let valueTargetMode: ValueTargetMode = 'terminal';
  let searchValueBlend = 0.35;
  let bootstrapSteps = 0;
  let bootstrapDiscount = 1;
  let bootstrapBlend = 0;
  let leagueModelPaths: string[] = [];
  let leagueSampleProb = 0;
  let leagueHeuristicProb = 0;
  let searchAlgorithm: SearchAlgorithm = 'minimax';
  let puctSimulations = 240;
  let puctCpuct = 1.18;
  let puctRolloutDepth = 18;
  let outPath = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = argv[index + 1];

    switch (arg) {
      case '--worker-id':
        workerId = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--start-game':
        startGame = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--games':
        games = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--difficulty':
        difficulty = parseDifficulty(nextValue);
        index += 1;
        break;
      case '--max-turns':
        maxTurns = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--no-capture-draw':
        noCaptureDrawMoves = parseNonNegativeInt(nextValue, arg);
        index += 1;
        break;
      case '--out':
        if (!nextValue) throw new Error('Missing value for --out');
        outPath = nextValue;
        index += 1;
        break;
      case '--policy-targets':
        includePolicyTargets = true;
        break;
      case '--policy-temperature':
        policyTemperature = parsePositiveFloat(nextValue, arg);
        index += 1;
        break;
      case '--policy-top-k':
        policyTopK = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--value-target-mode':
        valueTargetMode = parseValueTargetMode(nextValue);
        index += 1;
        break;
      case '--search-value-blend':
        searchValueBlend = parseUnitInterval(nextValue, arg);
        index += 1;
        break;
      case '--bootstrap-steps':
        bootstrapSteps = parseNonNegativeInt(nextValue, arg);
        index += 1;
        break;
      case '--bootstrap-discount':
        bootstrapDiscount = parseUnitInterval(nextValue, arg);
        index += 1;
        break;
      case '--bootstrap-blend':
        bootstrapBlend = parseUnitInterval(nextValue, arg);
        index += 1;
        break;
      case '--league-models':
        leagueModelPaths = parsePathList(nextValue, arg);
        index += 1;
        break;
      case '--league-sample-prob':
        leagueSampleProb = parseUnitInterval(nextValue, arg);
        index += 1;
        break;
      case '--league-heuristic-prob':
        leagueHeuristicProb = parseUnitInterval(nextValue, arg);
        index += 1;
        break;
      case '--search-mode':
        searchAlgorithm = parseSearchAlgorithm(nextValue);
        index += 1;
        break;
      case '--puct-simulations':
        puctSimulations = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--puct-cpuct':
        puctCpuct = parsePositiveFloat(nextValue, arg);
        index += 1;
        break;
      case '--puct-rollout-depth':
        puctRolloutDepth = parsePositiveInt(nextValue, arg);
        index += 1;
        break;
      case '--trace-turns':
        traceTurns = true;
        break;
      default:
        throw new Error(`Unknown worker arg: ${arg}`);
    }
  }

  if (!outPath) throw new Error('Missing required --out value');

  return {
    workerId,
    startGame,
    games,
    difficulty,
    maxTurns,
    noCaptureDrawMoves,
    traceTurns,
    includePolicyTargets,
    policyTemperature,
    policyTopK,
    valueTargetMode,
    searchValueBlend,
    bootstrapSteps,
    bootstrapDiscount,
    bootstrapBlend,
    leagueModelPaths,
    leagueSampleProb,
    leagueHeuristicProb,
    searchAlgorithm,
    puctSimulations,
    puctCpuct,
    puctRolloutDepth,
    outPath,
  };
}

function parseDifficulty(value: string | undefined): ComputerDifficulty {
  if (value === 'medium' || value === 'hard' || value === 'extreme') {
    return value;
  }
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parsePositiveFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseUnitInterval(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parsePathList(value: string | undefined, flag: string): string[] {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const paths = value
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (paths.length === 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return paths;
}

function parseValueTargetMode(value: string | undefined): ValueTargetMode {
  if (value === 'terminal' || value === 'mixed' || value === 'search') {
    return value;
  }
  throw new Error(`Invalid --value-target-mode value: ${value}`);
}

function parseSearchAlgorithm(value: string | undefined): SearchAlgorithm {
  if (value === 'minimax' || value === 'puct-lite') {
    return value;
  }
  throw new Error(`Invalid --search-mode value: ${value}`);
}

function loadLeagueModelPool(modelPaths: string[]): LeagueModelEntry[] {
  if (modelPaths.length === 0) return [];

  const uniquePaths = [...new Set(modelPaths.map((entry) => path.resolve(process.cwd(), entry)))];
  const loaded: LeagueModelEntry[] = [];
  for (let index = 0; index < uniquePaths.length; index += 1) {
    const absolutePath = uniquePaths[index];
    const raw = readFileSync(absolutePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Failed to parse league model JSON at ${absolutePath}: ${(error as Error).message}`);
    }
    const model = parseStrategoModel(parsed);
    if (!model) {
      throw new Error(`Invalid Stratego model format at ${absolutePath}`);
    }
    loaded.push({
      id: `${index + 1}:${path.basename(absolutePath)}`,
      model,
    });
  }
  return loaded;
}

main();
