import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import type { HiveComputerDifficulty, HiveSearchEngine, HiveSearchStats } from '../../lib/hive/ai';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  getLegalMovesForColor,
  oppositeColor,
} from '../../lib/hive/ai';
import { parseHiveModel, type HiveModel } from '../../lib/hive/ml';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import type { Move, PlayerColor } from '../../lib/hive/types';

type ArenaGateMode = 'fixed' | 'sprt';

interface ArenaOptions {
  candidateModelPath: string;
  championModelPath: string;
  promoteOutPath: string;
  games: number;
  passScore: number;
  gateMode: ArenaGateMode;
  sprtAlpha: number;
  sprtBeta: number;
  sprtMargin: number;
  confidenceLevel: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
  seed: number;
  engine: HiveSearchEngine;
  metricsLogPath: string;
  verbose: boolean;
}

interface ArenaAggregate {
  candidateWins: number;
  championWins: number;
  draws: number;
  totalTurns: number;
  candidateMoves: number;
  candidateSimulations: number;
  nodesPerSecondSum: number;
  policyEntropySum: number;
}

interface MetricsLogger {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
}

interface LoadedModel {
  model: HiveModel;
  absolutePath: string;
  hash: string;
}

interface GateEvaluation {
  promoted: boolean;
  score: number;
  eloEstimate: number;
  ciLow: number;
  ciHigh: number;
  confidenceLevel: number;
  decisionFinal: boolean;
  decisionReason: string;
  sprt: {
    llr: number;
    lower: number;
    upper: number;
    p0: number;
    p1: number;
    alpha: number;
    beta: number;
    inconclusive: boolean;
  } | null;
}

const DEFAULT_OPTIONS: ArenaOptions = {
  candidateModelPath: '.hive-cache/az-candidate-model.json',
  championModelPath: 'lib/hive/trained-model.json',
  promoteOutPath: 'lib/hive/trained-model.json',
  games: 400,
  passScore: 0.55,
  gateMode: 'fixed',
  sprtAlpha: 0.05,
  sprtBeta: 0.05,
  sprtMargin: 0.05,
  confidenceLevel: 0.95,
  difficulty: 'extreme',
  maxTurns: 320,
  noCaptureDrawMoves: 100,
  openingRandomPlies: 4,
  seed: 2026,
  engine: 'alphazero',
  metricsLogPath: '.hive-cache/metrics/training-metrics.jsonl',
  verbose: false,
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const logger = createMetricsLogger(options.metricsLogPath);

  const candidate = loadHiveModel(options.candidateModelPath);
  const champion = loadHiveModel(options.championModelPath);

  console.log(
    `[arena:setup] games=${options.games} pass_score=${(options.passScore * 100).toFixed(1)}% gate=${options.gateMode} difficulty=${options.difficulty} engine=${options.engine} seed=${options.seed}`,
  );
  if (options.gateMode === 'sprt') {
    console.log(
      `[arena:setup] sprt alpha=${options.sprtAlpha.toFixed(3)} beta=${options.sprtBeta.toFixed(3)} margin=${options.sprtMargin.toFixed(3)}`,
    );
  }
  console.log(`[arena:setup] candidate=${candidate.absolutePath} hash=${candidate.hash}`);
  console.log(`[arena:setup] champion=${champion.absolutePath} hash=${champion.hash}`);

  logger.log('arena_match', {
    status: 'start',
    options: {
      games: options.games,
      passScore: options.passScore,
      gateMode: options.gateMode,
      sprtAlpha: options.sprtAlpha,
      sprtBeta: options.sprtBeta,
      sprtMargin: options.sprtMargin,
      confidenceLevel: options.confidenceLevel,
      difficulty: options.difficulty,
      engine: options.engine,
      seed: options.seed,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      openingRandomPlies: options.openingRandomPlies,
      candidateModelPath: candidate.absolutePath,
      championModelPath: champion.absolutePath,
      candidateHash: candidate.hash,
      championHash: champion.hash,
    },
    runId: logger.runId,
  });

  const startedAt = performance.now();
  const aggregate: ArenaAggregate = {
    candidateWins: 0,
    championWins: 0,
    draws: 0,
    totalTurns: 0,
    candidateMoves: 0,
    candidateSimulations: 0,
    nodesPerSecondSum: 0,
    policyEntropySum: 0,
  };
  let completedGames = 0;
  let gate = evaluatePromotionGate(aggregate, 1, options);

  for (let gameIndex = 1; gameIndex <= options.games; gameIndex += 1) {
    const summary = runArenaGame(gameIndex, options, candidate.model, champion.model, aggregate);
    aggregate.totalTurns += summary.turns;
    completedGames = gameIndex;

    if (summary.winner === null) aggregate.draws += 1;
    else if (summary.winner === summary.candidateColor) aggregate.candidateWins += 1;
    else aggregate.championWins += 1;

    gate = evaluatePromotionGate(aggregate, completedGames, options);
    if (options.verbose || gameIndex % 20 === 0 || gameIndex === options.games) {
      const elapsed = performance.now() - startedAt;
      const eta = estimateRemainingMs(elapsed, gameIndex, options.games);
      console.log(
        `[arena] ${gameIndex}/${options.games} score=${(gate.score * 100).toFixed(1)}% ci${Math.round(gate.confidenceLevel * 100)}=[${(gate.ciLow * 100).toFixed(1)}%,${(gate.ciHigh * 100).toFixed(1)}%] W/L/D=${aggregate.candidateWins}/${aggregate.championWins}/${aggregate.draws} elapsed=${formatDuration(elapsed)} eta=${formatDuration(eta)}`,
      );
    }

    if (options.gateMode === 'sprt' && gate.decisionFinal && gameIndex < options.games) {
      console.log(
        `[arena] early stop at ${gameIndex}/${options.games}: ${gate.decisionReason} llr=${gate.sprt?.llr?.toFixed(3) ?? 'n/a'}`,
      );
      break;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  gate = evaluatePromotionGate(aggregate, completedGames, options);
  if (options.gateMode === 'sprt' && !gate.decisionFinal) {
    gate = {
      ...gate,
      promoted: gate.score >= options.passScore,
      decisionFinal: true,
      decisionReason: 'sprt_inconclusive_fallback_fixed',
      sprt: gate.sprt
        ? {
            ...gate.sprt,
            inconclusive: true,
          }
        : null,
    };
  }
  const score = gate.score;
  const promote = gate.promoted;
  const eloEstimate = gate.eloEstimate;
  const avgSimulationsPerMove = aggregate.candidateMoves > 0
    ? aggregate.candidateSimulations / aggregate.candidateMoves
    : 0;
  const avgNodesPerSecond = aggregate.candidateMoves > 0
    ? aggregate.nodesPerSecondSum / aggregate.candidateMoves
    : 0;
  const avgPolicyEntropy = aggregate.candidateMoves > 0
    ? aggregate.policyEntropySum / aggregate.candidateMoves
    : 0;

  if (promote) {
    const sourcePath = path.resolve(process.cwd(), options.candidateModelPath);
    const outPath = path.resolve(process.cwd(), options.promoteOutPath);
    mkdirSync(path.dirname(outPath), { recursive: true });
    copyFileSync(sourcePath, outPath);
    console.log(`[arena:promote] candidate promoted -> ${outPath}`);
  } else {
    console.log('[arena:promote] candidate did not pass gate');
  }

  console.log(
    `[arena:done] games=${completedGames}/${options.games} score=${(score * 100).toFixed(1)}% ci${Math.round(gate.confidenceLevel * 100)}=[${(gate.ciLow * 100).toFixed(1)}%,${(gate.ciHigh * 100).toFixed(1)}%] elo=${eloEstimate.toFixed(1)} threshold=${(options.passScore * 100).toFixed(1)}% promoted=${promote ? 'yes' : 'no'} reason=${gate.decisionReason} avg_turns=${(aggregate.totalTurns / Math.max(1, completedGames)).toFixed(1)} sims_per_move=${avgSimulationsPerMove.toFixed(2)} nodes_per_sec=${avgNodesPerSecond.toFixed(1)} elapsed=${formatDuration(elapsedMs)}`,
  );

  logger.log('arena_match', {
    status: 'completed',
    games: completedGames,
    configuredGames: options.games,
    candidateWins: aggregate.candidateWins,
    championWins: aggregate.championWins,
    draws: aggregate.draws,
    candidateScore: score,
    eloEstimate,
    scoreCiLow: gate.ciLow,
    scoreCiHigh: gate.ciHigh,
    confidenceLevel: gate.confidenceLevel,
    gateMode: options.gateMode,
    gateDecisionReason: gate.decisionReason,
    sprtLlr: gate.sprt?.llr ?? null,
    sprtLower: gate.sprt?.lower ?? null,
    sprtUpper: gate.sprt?.upper ?? null,
    sprtP0: gate.sprt?.p0 ?? null,
    sprtP1: gate.sprt?.p1 ?? null,
    sprtAlpha: gate.sprt?.alpha ?? null,
    sprtBeta: gate.sprt?.beta ?? null,
    sprtInconclusive: gate.sprt?.inconclusive ?? null,
    avgTurns: aggregate.totalTurns / Math.max(1, completedGames),
    avgSimulationsPerMove,
    searchNodesPerSec: avgNodesPerSecond,
    policyEntropy: avgPolicyEntropy,
    candidateHash: candidate.hash,
    championHash: champion.hash,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
  });

  logger.log('promotion_decision', {
    promoted: promote,
    threshold: options.passScore,
    candidateScore: score,
    eloEstimate,
    scoreCiLow: gate.ciLow,
    scoreCiHigh: gate.ciHigh,
    confidenceLevel: gate.confidenceLevel,
    gateMode: options.gateMode,
    gateDecisionReason: gate.decisionReason,
    sprtLlr: gate.sprt?.llr ?? null,
    sprtLower: gate.sprt?.lower ?? null,
    sprtUpper: gate.sprt?.upper ?? null,
    sprtP0: gate.sprt?.p0 ?? null,
    sprtP1: gate.sprt?.p1 ?? null,
    sprtAlpha: gate.sprt?.alpha ?? null,
    sprtBeta: gate.sprt?.beta ?? null,
    sprtInconclusive: gate.sprt?.inconclusive ?? null,
    candidateHash: candidate.hash,
    championHash: champion.hash,
    promoteOutPath: path.resolve(process.cwd(), options.promoteOutPath),
  });
  logger.log('promotion_result', {
    promoted: promote,
    threshold: options.passScore,
    candidateScore: score,
    eloEstimate,
    scoreCiLow: gate.ciLow,
    scoreCiHigh: gate.ciHigh,
    confidenceLevel: gate.confidenceLevel,
    gateMode: options.gateMode,
    gateDecisionReason: gate.decisionReason,
    sprtLlr: gate.sprt?.llr ?? null,
    sprtLower: gate.sprt?.lower ?? null,
    sprtUpper: gate.sprt?.upper ?? null,
    sprtP0: gate.sprt?.p0 ?? null,
    sprtP1: gate.sprt?.p1 ?? null,
    sprtAlpha: gate.sprt?.alpha ?? null,
    sprtBeta: gate.sprt?.beta ?? null,
    sprtInconclusive: gate.sprt?.inconclusive ?? null,
    candidateHash: candidate.hash,
    championHash: champion.hash,
  });
}

function runArenaGame(
  gameIndex: number,
  options: ArenaOptions,
  candidateModel: HiveModel,
  championModel: HiveModel,
  aggregate: ArenaAggregate,
): { winner: PlayerColor | null; candidateColor: PlayerColor; turns: number } {
  const rng = createRng(options.seed + gameIndex * 131);
  const candidateColor: PlayerColor = gameIndex % 2 === 1 ? 'white' : 'black';
  let state = createLocalHiveGameState({
    id: `arena-${Date.now()}-${gameIndex}`,
    shortCode: 'ARNA',
    whitePlayerId: candidateColor === 'white' ? 'candidate' : 'champion',
    blackPlayerId: candidateColor === 'black' ? 'candidate' : 'champion',
  });

  let noProgress = 0;
  let prevPressure = queenPressureTotal(state);
  let openingPly = 0;

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const activeColor = state.currentTurn;
    const isCandidateTurn = activeColor === candidateColor;

    let move: Move | null = null;
    if (openingPly < options.openingRandomPlies) {
      const legal = getLegalMovesForColor(state, activeColor);
      if (legal.length > 0) {
        move = legal[Math.floor(rng() * legal.length)];
      }
      openingPly += 1;
    } else {
      let stats: HiveSearchStats | null = null;
      move = chooseHiveMoveForColor(
        state,
        activeColor,
        options.difficulty,
        {
          modelOverride: isCandidateTurn ? candidateModel : championModel,
          engine: options.engine,
          randomSeed: options.seed + gameIndex * 163 + state.turnNumber,
          onSearchStats: isCandidateTurn ? (value) => {
            stats = value;
          } : undefined,
        },
      );
      const statsSnapshot = stats as HiveSearchStats | null;
      if (isCandidateTurn && statsSnapshot) {
        aggregate.candidateMoves += 1;
        aggregate.candidateSimulations += statsSnapshot.simulations;
        aggregate.nodesPerSecondSum += statsSnapshot.nodesPerSecond;
        aggregate.policyEntropySum += statsSnapshot.policyEntropy;
      }
    }

    if (!move) {
      state = {
        ...state,
        status: 'finished',
        winner: oppositeColor(activeColor),
      };
      break;
    }

    state = applyHiveMove(state, move);
    const pressure = queenPressureTotal(state);
    if (pressure === prevPressure) noProgress += 1;
    else {
      noProgress = 0;
      prevPressure = pressure;
    }
    if (options.noCaptureDrawMoves > 0 && noProgress >= options.noCaptureDrawMoves) {
      state = {
        ...state,
        status: 'finished',
        winner: 'draw',
      };
      break;
    }
  }

  if (state.status === 'playing') {
    state = {
      ...state,
      status: 'finished',
      winner: 'draw',
    };
  }

  return {
    winner: state.winner === 'draw' ? null : state.winner,
    candidateColor,
    turns: state.turnNumber,
  };
}

function loadHiveModel(relativePath: string): LoadedModel {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Model path not found: ${relativePath}`);
  }
  const raw = readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const model = parseHiveModel(parsed);
  if (!model) {
    throw new Error(`Invalid model file: ${relativePath}`);
  }
  return {
    model,
    absolutePath,
    hash: hashText(raw),
  };
}

function hashText(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
}

function queenPressureTotal(state: ReturnType<typeof createLocalHiveGameState>): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function parseOptions(argv: string[]): ArenaOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelpAndExit();
  }

  const options: ArenaOptions = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--candidate-model':
        if (!next) throw new Error('Missing value for --candidate-model');
        options.candidateModelPath = next;
        index += 1;
        break;
      case '--champion-model':
        if (!next) throw new Error('Missing value for --champion-model');
        options.championModelPath = next;
        index += 1;
        break;
      case '--promote-out':
        if (!next) throw new Error('Missing value for --promote-out');
        options.promoteOutPath = next;
        index += 1;
        break;
      case '--games':
        options.games = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--pass-score':
        options.passScore = parseScore(next, arg);
        index += 1;
        break;
      case '--gate-mode':
        options.gateMode = parseGateMode(next);
        index += 1;
        break;
      case '--sprt-alpha':
        options.sprtAlpha = parseFloatInRange(next, arg, 1e-6, 0.5);
        index += 1;
        break;
      case '--sprt-beta':
        options.sprtBeta = parseFloatInRange(next, arg, 1e-6, 0.5);
        index += 1;
        break;
      case '--sprt-margin':
        options.sprtMargin = parseFloatInRange(next, arg, 1e-3, 0.4);
        index += 1;
        break;
      case '--confidence-level':
        options.confidenceLevel = parseFloatInRange(next, arg, 0.5, 0.999);
        index += 1;
        break;
      case '--difficulty':
        options.difficulty = parseDifficulty(next);
        index += 1;
        break;
      case '--engine':
        options.engine = parseEngine(next);
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
      case '--opening-random-plies':
        options.openingRandomPlies = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--seed':
        options.seed = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--metrics-log':
        if (!next) throw new Error('Missing value for --metrics-log');
        options.metricsLogPath = next;
        index += 1;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (!value) throw new Error('Missing value for --difficulty');
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseEngine(value: string | undefined): HiveSearchEngine {
  if (!value) throw new Error('Missing value for --engine');
  if (value === 'classic' || value === 'alphazero' || value === 'gumbel') return value;
  throw new Error(`Invalid --engine value: ${value}`);
}

function parseGateMode(value: string | undefined): ArenaGateMode {
  if (!value) throw new Error('Missing value for --gate-mode');
  if (value === 'fixed' || value === 'sprt') return value;
  throw new Error(`Invalid --gate-mode value: ${value}`);
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function parseScore(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseFloatInRange(value: string | undefined, flag: string, min: number, max: number): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function evaluatePromotionGate(
  aggregate: ArenaAggregate,
  completedGames: number,
  options: ArenaOptions,
): GateEvaluation {
  const games = Math.max(1, completedGames);
  const effectiveWins = aggregate.candidateWins + aggregate.draws * 0.5;
  const score = effectiveWins / games;
  const eloEstimate = scoreToElo(score);
  const ci = computeWilsonInterval(score, games, options.confidenceLevel);

  if (options.gateMode === 'fixed') {
    return {
      promoted: score >= options.passScore,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: score >= options.passScore ? 'fixed_threshold_pass' : 'fixed_threshold_fail',
      sprt: null,
    };
  }

  const p0 = clampProbability(options.passScore);
  const p1 = clampProbability(Math.min(0.99, options.passScore + options.sprtMargin));
  const llr = computeSprtLlr(effectiveWins, games, p0, p1);
  const upper = Math.log((1 - options.sprtBeta) / options.sprtAlpha);
  const lower = Math.log(options.sprtBeta / (1 - options.sprtAlpha));

  if (llr >= upper) {
    return {
      promoted: true,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'sprt_accept_h1',
      sprt: {
        llr,
        lower,
        upper,
        p0,
        p1,
        alpha: options.sprtAlpha,
        beta: options.sprtBeta,
        inconclusive: false,
      },
    };
  }

  if (llr <= lower) {
    return {
      promoted: false,
      score,
      eloEstimate,
      ciLow: ci.low,
      ciHigh: ci.high,
      confidenceLevel: options.confidenceLevel,
      decisionFinal: true,
      decisionReason: 'sprt_reject_h1',
      sprt: {
        llr,
        lower,
        upper,
        p0,
        p1,
        alpha: options.sprtAlpha,
        beta: options.sprtBeta,
        inconclusive: false,
      },
    };
  }

  return {
    promoted: score >= options.passScore,
    score,
    eloEstimate,
    ciLow: ci.low,
    ciHigh: ci.high,
    confidenceLevel: options.confidenceLevel,
    decisionFinal: false,
    decisionReason: 'sprt_inconclusive',
    sprt: {
      llr,
      lower,
      upper,
      p0,
      p1,
      alpha: options.sprtAlpha,
      beta: options.sprtBeta,
      inconclusive: true,
    },
  };
}

function computeSprtLlr(effectiveWins: number, games: number, p0: number, p1: number): number {
  const losses = Math.max(0, games - effectiveWins);
  return effectiveWins * Math.log(p1 / p0) + losses * Math.log((1 - p1) / (1 - p0));
}

function clampProbability(value: number): number {
  return Math.min(0.999, Math.max(0.001, value));
}

function normalCriticalValue(confidenceLevel: number): number {
  if (confidenceLevel >= 0.99) return 2.576;
  if (confidenceLevel >= 0.98) return 2.326;
  if (confidenceLevel >= 0.95) return 1.96;
  if (confidenceLevel >= 0.9) return 1.645;
  if (confidenceLevel >= 0.8) return 1.282;
  return 1;
}

function computeWilsonInterval(
  score: number,
  games: number,
  confidenceLevel: number,
): { low: number; high: number } {
  const n = Math.max(1, games);
  const p = clampProbability(score);
  const z = normalCriticalValue(confidenceLevel);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const spread = (z / denom) * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return {
    low: Math.max(0, center - spread),
    high: Math.min(1, center + spread),
  };
}

function printHelpAndExit(): never {
  console.log('Usage: npm run hive:eval:arena -- [options]');
  console.log('  --candidate-model <path>    Candidate model path (default: .hive-cache/az-candidate-model.json)');
  console.log('  --champion-model <path>     Champion model path (default: lib/hive/trained-model.json)');
  console.log('  --promote-out <path>        Promotion output path (default: lib/hive/trained-model.json)');
  console.log('  --games <n>                 Arena games (default: 400)');
  console.log('  --pass-score <float>        Promotion threshold in (0,1) (default: 0.55)');
  console.log('  --gate-mode <fixed|sprt>    Promotion gate mode (default: fixed)');
  console.log('  --sprt-alpha <float>        SPRT alpha error rate (default: 0.05)');
  console.log('  --sprt-beta <float>         SPRT beta error rate (default: 0.05)');
  console.log('  --sprt-margin <float>       SPRT p1 margin over threshold (default: 0.05)');
  console.log('  --confidence-level <float>  Score CI confidence in [0.5, 0.999] (default: 0.95)');
  console.log('  --difficulty <d>            medium|hard|extreme (default: extreme)');
  console.log('  --engine <e>                classic|alphazero|gumbel (default: alphazero)');
  console.log('  --max-turns <n>             Max turns per game (default: 320)');
  console.log('  --no-capture-draw <n>       Draw threshold for no queen-pressure progress (default: 100)');
  console.log('  --opening-random-plies <n>  Random opening plies for diversity (default: 4)');
  console.log('  --seed <n>                  Deterministic seed (default: 2026)');
  console.log('  --metrics-log <path>        Metrics JSONL output');
  console.log('  --verbose, -v               Verbose logging');
  process.exit(0);
}

function createRng(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state <= 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function scoreToElo(score: number): number {
  const clipped = Math.min(0.999, Math.max(0.001, score));
  return 400 * Math.log10(clipped / (1 - clipped));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function estimateRemainingMs(elapsedMs: number, done: number, total: number): number {
  if (done <= 0 || total <= done) return 0;
  return ((total - done) * elapsedMs) / done;
}

function createMetricsLogger(configuredPath: string): MetricsLogger {
  const runId = `arena-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const absolutePath = path.resolve(process.cwd(), configuredPath);
  let warned = false;

  const log = (eventType: string, payload: Record<string, unknown>): void => {
    try {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      appendFileSync(
        absolutePath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          source: 'eval',
          eventType,
          runId,
          ...payload,
        })}\n`,
        'utf8',
      );
    } catch (error) {
      if (warned) return;
      warned = true;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[warn] Failed to write metrics log: ${message}`);
    }
  };

  return { runId, log };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
