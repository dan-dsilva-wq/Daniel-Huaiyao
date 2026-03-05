import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ComputerDifficulty } from '../../lib/stratego/ai';
import { getStrategoHardwareProfile } from './hardware-profile';

type GateMethod = 'ci' | 'sprt';
type SprtDecision = 'accept_h1' | 'reject_h1' | 'inconclusive';

interface GateOptions {
  candidatePath: string;
  incumbentPath: string;
  promote: boolean;
  promotePath: string;
  games: number;
  difficulty: ComputerDifficulty;
  workers: number;
  maxTurns: number;
  noCaptureDrawMoves: number;
  progressEvery: number;
  minScore: number;
  minLowerBound: number;
  zValue: number;
  metricsPath: string | null;
  keepMetrics: boolean;
  summaryOut: string;
  method: GateMethod;
  sprtElo0: number;
  sprtElo1: number;
  sprtAlpha: number;
  sprtBeta: number;
  sprtBatchGames: number;
  sprtCiFallback: boolean;
}

interface EvalBenchmarkResult {
  games: number;
  candidateScore: number;
  candidateWins: number;
  baselineWins: number;
  draws: number;
  avgTurns: number;
  avgCaptures: number;
  elapsedSeconds: number;
}

interface ScoreConfidence {
  mean: number;
  lower: number;
  upper: number;
  variance: number;
  standardError: number;
}

interface EvalTally {
  games: number;
  candidateWins: number;
  baselineWins: number;
  draws: number;
  totalTurns: number;
  totalCaptures: number;
  elapsedSeconds: number;
}

interface SprtSummary {
  decision: SprtDecision;
  rounds: number;
  llr: number;
  lowerBoundary: number;
  upperBoundary: number;
  elo0: number;
  elo1: number;
  alpha: number;
  beta: number;
  p0: number;
  p1: number;
  usedCiFallback: boolean;
}

interface GateEvaluationResult {
  passed: boolean;
  benchmark: EvalBenchmarkResult;
  confidence: ScoreConfidence;
  sprt: SprtSummary | null;
}

const HARDWARE_PROFILE = getStrategoHardwareProfile();

const DEFAULT_OPTIONS: Omit<GateOptions, 'candidatePath'> = {
  incumbentPath: 'lib/stratego/trained-model.json',
  promote: false,
  promotePath: 'lib/stratego/trained-model.json',
  games: 120,
  difficulty: 'extreme',
  workers: HARDWARE_PROFILE.evalWorkers,
  maxTurns: 500,
  noCaptureDrawMoves: 160,
  progressEvery: 20,
  minScore: 0.53,
  minLowerBound: 0.5,
  zValue: 1.96,
  metricsPath: null,
  keepMetrics: false,
  summaryOut: '.stratego-cache/gate/last-gate.json',
  method: 'ci',
  sprtElo0: 0,
  sprtElo1: 35,
  sprtAlpha: 0.05,
  sprtBeta: 0.05,
  sprtBatchGames: 24,
  sprtCiFallback: true,
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const candidateAbs = path.resolve(process.cwd(), options.candidatePath);
  const incumbentAbs = path.resolve(process.cwd(), options.incumbentPath);
  const promoteAbs = path.resolve(process.cwd(), options.promotePath);

  if (!existsSync(candidateAbs)) {
    throw new Error(`Candidate model not found: ${candidateAbs}`);
  }
  if (!existsSync(incumbentAbs)) {
    throw new Error(`Incumbent model not found: ${incumbentAbs}`);
  }
  if (candidateAbs === incumbentAbs) {
    throw new Error('Candidate and incumbent paths are the same; gate would be meaningless.');
  }
  if (options.method === 'sprt' && options.sprtElo1 <= options.sprtElo0) {
    throw new Error('--sprt-elo1 must be greater than --sprt-elo0.');
  }

  const metricsPath = options.metricsPath
    ? path.resolve(process.cwd(), options.metricsPath)
    : path.resolve(process.cwd(), '.stratego-cache', 'gate', `eval-${Date.now()}.jsonl`);
  mkdirSync(path.dirname(metricsPath), { recursive: true });

  log(
    'setup',
    `candidate=${candidateAbs} incumbent=${incumbentAbs} method=${options.method} games=${options.games} difficulty=${options.difficulty} workers=${options.workers}`,
  );
  log(
    'setup',
    `thresholds score>=${options.minScore.toFixed(3)} lower>=${options.minLowerBound.toFixed(3)} z=${options.zValue.toFixed(2)} promote=${options.promote ? 'on' : 'off'}`,
  );
  if (options.method === 'sprt') {
    log(
      'setup',
      `sprt elo0=${options.sprtElo0.toFixed(1)} elo1=${options.sprtElo1.toFixed(1)} alpha=${options.sprtAlpha.toFixed(3)} beta=${options.sprtBeta.toFixed(3)} batch=${options.sprtBatchGames} ci_fallback=${options.sprtCiFallback ? 'on' : 'off'}`,
    );
  }

  const evaluation = options.method === 'sprt'
    ? await runSprtGate(options, candidateAbs, incumbentAbs, metricsPath)
    : await runCiGate(options, candidateAbs, incumbentAbs, metricsPath);

  log(
    'result',
    `score=${(evaluation.confidence.mean * 100).toFixed(2)}% ci=[${(evaluation.confidence.lower * 100).toFixed(2)}%, ${(evaluation.confidence.upper * 100).toFixed(2)}%] W/L/D=${evaluation.benchmark.candidateWins}/${evaluation.benchmark.baselineWins}/${evaluation.benchmark.draws} gate=${evaluation.passed ? 'PASS' : 'FAIL'}`,
  );
  if (evaluation.sprt) {
    log(
      'sprt',
      `decision=${evaluation.sprt.decision} llr=${evaluation.sprt.llr.toFixed(3)} bounds=[${evaluation.sprt.lowerBoundary.toFixed(3)}, ${evaluation.sprt.upperBoundary.toFixed(3)}] rounds=${evaluation.sprt.rounds}${evaluation.sprt.usedCiFallback ? ' fallback=ci' : ''}`,
    );
  }

  let promoted = false;
  if (evaluation.passed && options.promote) {
    mkdirSync(path.dirname(promoteAbs), { recursive: true });
    copyFileSync(candidateAbs, promoteAbs);
    promoted = true;
    log('promote', `copied candidate -> ${promoteAbs}`);
  }

  const summary = {
    ts: new Date().toISOString(),
    method: options.method,
    candidatePath: candidateAbs,
    incumbentPath: incumbentAbs,
    promotePath: promoteAbs,
    promoted,
    passed: evaluation.passed,
    thresholds: {
      minScore: options.minScore,
      minLowerBound: options.minLowerBound,
      zValue: options.zValue,
    },
    benchmark: evaluation.benchmark,
    confidence: evaluation.confidence,
    sprt: evaluation.sprt,
    eval: {
      games: options.games,
      difficulty: options.difficulty,
      workers: options.workers,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      progressEvery: options.progressEvery,
      metricsPath,
    },
  };

  const summaryAbs = path.resolve(process.cwd(), options.summaryOut);
  mkdirSync(path.dirname(summaryAbs), { recursive: true });
  writeFileSync(summaryAbs, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  log('summary', summaryAbs);

  if (!options.keepMetrics && !options.metricsPath) {
    rmSync(metricsPath, { force: true });
  }

  if (!evaluation.passed) {
    process.exitCode = 2;
  }
}

async function runCiGate(
  options: GateOptions,
  candidateAbs: string,
  incumbentAbs: string,
  metricsPath: string,
): Promise<GateEvaluationResult> {
  const benchmark = await runEvalBenchmark({
    candidatePath: candidateAbs,
    incumbentPath: incumbentAbs,
    games: options.games,
    difficulty: options.difficulty,
    workers: options.workers,
    maxTurns: options.maxTurns,
    noCaptureDrawMoves: options.noCaptureDrawMoves,
    progressEvery: options.progressEvery,
    metricsPath,
  });
  const confidence = computeScoreConfidence(
    benchmark.candidateWins,
    benchmark.baselineWins,
    benchmark.draws,
    options.zValue,
  );
  const passed = confidence.mean >= options.minScore && confidence.lower >= options.minLowerBound;
  return {
    passed,
    benchmark,
    confidence,
    sprt: null,
  };
}

async function runSprtGate(
  options: GateOptions,
  candidateAbs: string,
  incumbentAbs: string,
  metricsPath: string,
): Promise<GateEvaluationResult> {
  const p0 = expectedScoreFromElo(options.sprtElo0);
  const p1 = expectedScoreFromElo(options.sprtElo1);
  const upperBoundary = Math.log((1 - options.sprtBeta) / options.sprtAlpha);
  const lowerBoundary = Math.log(options.sprtBeta / (1 - options.sprtAlpha));
  const tally = createEmptyTally();

  let rounds = 0;
  let llr = 0;
  let decision: SprtDecision = 'inconclusive';

  while (tally.games < options.games) {
    rounds += 1;
    const remaining = options.games - tally.games;
    const batchGames = Math.min(options.sprtBatchGames, remaining);
    const batchWorkers = Math.min(options.workers, batchGames);
    const batchProgressEvery = Math.min(options.progressEvery, batchGames);

    log('sprt', `round=${rounds} running ${batchGames} games (total=${tally.games}/${options.games})`);
    const batch = await runEvalBenchmark({
      candidatePath: candidateAbs,
      incumbentPath: incumbentAbs,
      games: batchGames,
      difficulty: options.difficulty,
      workers: batchWorkers,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      progressEvery: batchProgressEvery,
      metricsPath,
    });
    mergeBenchmarkIntoTally(tally, batch);

    llr = computeSprtLogLikelihoodRatio(
      tally.candidateWins,
      tally.baselineWins,
      tally.draws,
      p0,
      p1,
    );
    if (llr >= upperBoundary) {
      decision = 'accept_h1';
    } else if (llr <= lowerBoundary) {
      decision = 'reject_h1';
    } else {
      decision = 'inconclusive';
    }

    const score = (tally.candidateWins + tally.draws * 0.5) / Math.max(1, tally.games);
    log(
      'sprt',
      `round=${rounds} W/L/D=${tally.candidateWins}/${tally.baselineWins}/${tally.draws} score=${(score * 100).toFixed(2)}% llr=${llr.toFixed(3)} bounds=[${lowerBoundary.toFixed(3)}, ${upperBoundary.toFixed(3)}] decision=${decision}`,
    );

    if (decision !== 'inconclusive') {
      break;
    }
  }

  const benchmark = tallyToBenchmarkResult(tally);
  const confidence = computeScoreConfidence(
    benchmark.candidateWins,
    benchmark.baselineWins,
    benchmark.draws,
    options.zValue,
  );

  let passed = decision === 'accept_h1';
  let usedCiFallback = false;
  if (decision === 'inconclusive') {
    if (options.sprtCiFallback) {
      usedCiFallback = true;
      passed = confidence.mean >= options.minScore && confidence.lower >= options.minLowerBound;
    } else {
      passed = false;
    }
  }

  return {
    passed,
    benchmark,
    confidence,
    sprt: {
      decision,
      rounds,
      llr,
      lowerBoundary,
      upperBoundary,
      elo0: options.sprtElo0,
      elo1: options.sprtElo1,
      alpha: options.sprtAlpha,
      beta: options.sprtBeta,
      p0,
      p1,
      usedCiFallback,
    },
  };
}

async function runEvalBenchmark(args: {
  candidatePath: string;
  incumbentPath: string;
  games: number;
  difficulty: ComputerDifficulty;
  workers: number;
  maxTurns: number;
  noCaptureDrawMoves: number;
  progressEvery: number;
  metricsPath: string;
}): Promise<EvalBenchmarkResult> {
  const evalScriptPath = path.resolve(process.cwd(), 'scripts/stratego/eval.ts');
  await runCommand(process.execPath, [
    '--import',
    'tsx',
    evalScriptPath,
    '--games',
    String(args.games),
    '--difficulty',
    args.difficulty,
    '--workers',
    String(args.workers),
    '--max-turns',
    String(args.maxTurns),
    '--no-capture-draw',
    String(args.noCaptureDrawMoves),
    '--progress-every',
    String(args.progressEvery),
    '--model',
    args.candidatePath,
    '--baseline-model',
    args.incumbentPath,
    '--metrics-log',
    args.metricsPath,
  ]);

  return readLatestBenchmarkResult(args.metricsPath);
}

function createEmptyTally(): EvalTally {
  return {
    games: 0,
    candidateWins: 0,
    baselineWins: 0,
    draws: 0,
    totalTurns: 0,
    totalCaptures: 0,
    elapsedSeconds: 0,
  };
}

function mergeBenchmarkIntoTally(tally: EvalTally, benchmark: EvalBenchmarkResult): void {
  tally.games += benchmark.games;
  tally.candidateWins += benchmark.candidateWins;
  tally.baselineWins += benchmark.baselineWins;
  tally.draws += benchmark.draws;
  tally.totalTurns += benchmark.avgTurns * benchmark.games;
  tally.totalCaptures += benchmark.avgCaptures * benchmark.games;
  tally.elapsedSeconds += benchmark.elapsedSeconds;
}

function tallyToBenchmarkResult(tally: EvalTally): EvalBenchmarkResult {
  const games = Math.max(1, tally.games);
  return {
    games: tally.games,
    candidateScore: (tally.candidateWins + tally.draws * 0.5) / games,
    candidateWins: tally.candidateWins,
    baselineWins: tally.baselineWins,
    draws: tally.draws,
    avgTurns: tally.totalTurns / games,
    avgCaptures: tally.totalCaptures / games,
    elapsedSeconds: tally.elapsedSeconds,
  };
}

function computeScoreConfidence(
  wins: number,
  losses: number,
  draws: number,
  zValue: number,
): ScoreConfidence {
  const totalGames = Math.max(1, wins + losses + draws);
  const mean = (wins + draws * 0.5) / totalGames;

  const variance = (
    wins * ((1 - mean) ** 2)
    + draws * ((0.5 - mean) ** 2)
    + losses * ((0 - mean) ** 2)
  ) / totalGames;
  const standardError = Math.sqrt(Math.max(0, variance) / totalGames);
  const margin = zValue * standardError;
  const lower = clamp(mean - margin, 0, 1);
  const upper = clamp(mean + margin, 0, 1);

  return {
    mean,
    lower,
    upper,
    variance,
    standardError,
  };
}

function expectedScoreFromElo(elo: number): number {
  const score = 1 / (1 + 10 ** (-elo / 400));
  return clamp(score, 1e-6, 1 - 1e-6);
}

function computeSprtLogLikelihoodRatio(
  wins: number,
  losses: number,
  draws: number,
  p0: number,
  p1: number,
): number {
  const totalGames = wins + losses + draws;
  if (totalGames <= 0) return 0;
  const points = wins + draws * 0.5;
  const misses = totalGames - points;
  return (
    points * Math.log(p1 / p0)
    + misses * Math.log((1 - p1) / (1 - p0))
  );
}

function readLatestBenchmarkResult(metricsPath: string): EvalBenchmarkResult {
  const raw = readFileSync(metricsPath, 'utf8');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.eventType !== 'benchmark_result') continue;

      const candidateWins = toInteger(event.candidateWins);
      const baselineWins = toInteger(event.baselineWins);
      const draws = toInteger(event.draws);
      const parsedGames = toInteger(event.games);
      const games = parsedGames > 0 ? parsedGames : candidateWins + baselineWins + draws;

      return {
        games,
        candidateScore: toNumber(event.candidateScore),
        candidateWins,
        baselineWins,
        draws,
        avgTurns: toNumber(event.avgTurns),
        avgCaptures: toNumber(event.avgCaptures),
        elapsedSeconds: toNumber(event.elapsedSeconds),
      };
    } catch {
      // ignore malformed log line
    }
  }
  throw new Error(`No benchmark_result found in ${metricsPath}`);
}

function parseOptions(argv: string[]): GateOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsageAndExit();
  }

  let candidatePath: string | null = null;
  const options: GateOptions = {
    ...DEFAULT_OPTIONS,
    candidatePath: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--candidate':
        if (!next) throw new Error('Missing value for --candidate');
        candidatePath = next;
        index += 1;
        break;
      case '--incumbent':
        if (!next) throw new Error('Missing value for --incumbent');
        options.incumbentPath = next;
        index += 1;
        break;
      case '--promote':
        options.promote = true;
        break;
      case '--no-promote':
        options.promote = false;
        break;
      case '--promote-path':
        if (!next) throw new Error('Missing value for --promote-path');
        options.promotePath = next;
        index += 1;
        break;
      case '--games':
        options.games = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--difficulty':
        options.difficulty = parseDifficulty(next);
        index += 1;
        break;
      case '--workers':
        options.workers = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--max-turns':
        options.maxTurns = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--no-capture-draw':
        options.noCaptureDrawMoves = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--progress-every':
        options.progressEvery = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--min-score':
        options.minScore = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--min-lower-bound':
        options.minLowerBound = parseUnitInterval(next, arg);
        index += 1;
        break;
      case '--z':
        options.zValue = parsePositiveFloat(next, arg);
        index += 1;
        break;
      case '--method':
        options.method = parseMethod(next);
        index += 1;
        break;
      case '--sprt-elo0':
        options.sprtElo0 = parseFiniteFloat(next, arg);
        index += 1;
        break;
      case '--sprt-elo1':
        options.sprtElo1 = parseFiniteFloat(next, arg);
        index += 1;
        break;
      case '--sprt-alpha':
        options.sprtAlpha = parseOpenUnitInterval(next, arg);
        index += 1;
        break;
      case '--sprt-beta':
        options.sprtBeta = parseOpenUnitInterval(next, arg);
        index += 1;
        break;
      case '--sprt-batch-games':
        options.sprtBatchGames = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--sprt-ci-fallback':
        options.sprtCiFallback = true;
        break;
      case '--no-sprt-ci-fallback':
        options.sprtCiFallback = false;
        break;
      case '--metrics-log':
        if (!next) throw new Error('Missing value for --metrics-log');
        options.metricsPath = next;
        options.keepMetrics = true;
        index += 1;
        break;
      case '--keep-metrics':
        options.keepMetrics = true;
        break;
      case '--summary-out':
        if (!next) throw new Error('Missing value for --summary-out');
        options.summaryOut = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  if (!candidatePath) {
    throw new Error('Missing required --candidate path.');
  }
  options.candidatePath = candidatePath;

  if (options.workers > options.games) {
    options.workers = options.games;
  }
  if (options.progressEvery > options.games) {
    options.progressEvery = options.games;
  }
  if (options.sprtBatchGames > options.games) {
    options.sprtBatchGames = options.games;
  }

  return options;
}

function parseMethod(value: string | undefined): GateMethod {
  if (value === 'ci' || value === 'sprt') {
    return value;
  }
  throw new Error(`Invalid --method value: ${value}`);
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

function parseFiniteFloat(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
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

function parseOpenUnitInterval(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`Invalid value for ${flag}: ${value} (expected 0 < value < 1)`);
  }
  return parsed;
}

function toInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

function toNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function printUsageAndExit(): never {
  console.log('Usage: npm run stratego:gate -- --candidate <path> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --candidate <path>      Candidate model path (required)');
  console.log('  --incumbent <path>      Incumbent model path (default: lib/stratego/trained-model.json)');
  console.log('  --promote               Promote candidate to --promote-path on gate pass');
  console.log('  --no-promote            Disable promotion (default)');
  console.log('  --promote-path <path>   Promotion destination (default: lib/stratego/trained-model.json)');
  console.log('  --games <n>             Eval games; SPRT max games when --method sprt (default: 120)');
  console.log('  --difficulty <d>        medium|hard|extreme (default: extreme)');
  console.log(`  --workers <n>           Eval workers (default: ${DEFAULT_OPTIONS.workers})`);
  console.log('  --max-turns <n>         Max turns per game (default: 500)');
  console.log('  --no-capture-draw <n>   No-capture draw threshold (default: 160)');
  console.log('  --progress-every <n>    Eval progress interval (default: 20)');
  console.log('  --min-score <n>         Minimum required candidate score in [0..1] (default: 0.53)');
  console.log('  --min-lower-bound <n>   Minimum required lower CI bound [0..1] (default: 0.50)');
  console.log('  --z <n>                 Z-score for confidence interval (default: 1.96)');
  console.log('  --method <m>            ci|sprt (default: ci)');
  console.log('  --sprt-elo0 <n>         SPRT null-hypothesis Elo (default: 0)');
  console.log('  --sprt-elo1 <n>         SPRT alternative Elo (default: 35)');
  console.log('  --sprt-alpha <n>        SPRT type-I error in (0,1) (default: 0.05)');
  console.log('  --sprt-beta <n>         SPRT type-II error in (0,1) (default: 0.05)');
  console.log('  --sprt-batch-games <n>  SPRT games per sequential round (default: 24)');
  console.log('  --sprt-ci-fallback      On inconclusive SPRT, fallback to CI thresholds (default)');
  console.log('  --no-sprt-ci-fallback   On inconclusive SPRT, fail gate');
  console.log('  --metrics-log <path>    Persist eval metrics to this path');
  console.log('  --keep-metrics          Keep temporary metrics log');
  console.log('  --summary-out <path>    Gate summary output JSON (default: .stratego-cache/gate/last-gate.json)');
  process.exit(0);
}

function log(stage: string, message: string): void {
  const clock = new Date().toISOString().slice(11, 19);
  console.log(`[${clock}] [gate:${stage}] ${message}`);
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
