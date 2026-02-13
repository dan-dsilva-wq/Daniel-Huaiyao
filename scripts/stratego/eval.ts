import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  applyStrategoMove,
  chooseStrategoMoveForColor,
  type ComputerDifficulty,
  type LocalStrategoState,
} from '../../lib/stratego/ai';
import { generateRandomSetup } from '../../lib/stratego/constants';
import { getActiveStrategoModel, parseStrategoModel, type StrategoModel } from '../../lib/stratego/ml';
import type { Piece, TeamColor, WinReason } from '../../lib/stratego/types';

type EvalSource = 'heuristic' | 'model';
type TerminalReason = WinReason | 'max_turns' | 'no_capture_streak';

interface EvalOptions {
  games: number;
  difficulty: ComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  progressEvery: number;
  verbose: boolean;
  modelPath: string | null;
  baselineModelPath: string | null;
  metricsLogPath: string;
}

interface GameSummary {
  gameIndex: number;
  candidateColor: TeamColor;
  turnsPlayed: number;
  winner: TeamColor | null;
  terminalReason: TerminalReason;
  captureCount: number;
  longestNoCaptureStreak: number;
  durationMs: number;
}

interface EvalAggregate {
  games: number;
  candidateWins: number;
  baselineWins: number;
  draws: number;
  totalTurns: number;
  totalCaptures: number;
  maxTurnsDraws: number;
  noCaptureDraws: number;
}

const DEFAULT_OPTIONS: EvalOptions = {
  games: 60,
  difficulty: 'extreme',
  maxTurns: 500,
  noCaptureDrawMoves: 160,
  progressEvery: 10,
  verbose: false,
  modelPath: null,
  baselineModelPath: null,
  metricsLogPath: '.stratego-cache/metrics/training-metrics.jsonl',
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const candidateModel = options.modelPath
    ? loadModelFromPath(options.modelPath)
    : getActiveStrategoModel();
  const baselineModel = options.baselineModelPath
    ? loadModelFromPath(options.baselineModelPath)
    : null;
  const baselineSource: EvalSource = baselineModel ? 'model' : 'heuristic';
  const logger = createMetricsLogger(options.metricsLogPath);
  const runStarted = performance.now();

  const candidateModelPath = options.modelPath
    ? path.resolve(process.cwd(), options.modelPath)
    : path.resolve(process.cwd(), 'lib/stratego/trained-model.json');
  const baselineModelPath = options.baselineModelPath
    ? path.resolve(process.cwd(), options.baselineModelPath)
    : null;

  console.log(
    `[eval:setup] games=${options.games} difficulty=${options.difficulty} maxTurns=${options.maxTurns} noCaptureDraw=${options.noCaptureDrawMoves} baseline=${baselineSource}`,
  );
  console.log(
    `[eval:setup] candidate=${describeModel(candidateModel)} path=${candidateModelPath}`,
  );
  if (baselineModelPath) {
    console.log(`[eval:setup] baseline=${describeModel(baselineModel)} path=${baselineModelPath}`);
  } else {
    console.log('[eval:setup] baseline=heuristic-only (model blend disabled)');
  }

  logger.log('run_start', {
    options: {
      games: options.games,
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      progressEvery: options.progressEvery,
      candidateModelPath,
      baselineModelPath,
      baselineSource,
    },
    candidateModel: summarizeModel(candidateModel),
    baselineModel: baselineModel ? summarizeModel(baselineModel) : null,
    pid: process.pid,
  });

  const aggregate: EvalAggregate = {
    games: 0,
    candidateWins: 0,
    baselineWins: 0,
    draws: 0,
    totalTurns: 0,
    totalCaptures: 0,
    maxTurnsDraws: 0,
    noCaptureDraws: 0,
  };

  for (let gameIndex = 1; gameIndex <= options.games; gameIndex += 1) {
    const summary = runEvalGame(gameIndex, {
      difficulty: options.difficulty,
      maxTurns: options.maxTurns,
      noCaptureDrawMoves: options.noCaptureDrawMoves,
      candidateModel,
      baselineModel,
    });
    applySummary(aggregate, summary);
    maybeLogProgress(options, aggregate, summary, runStarted);
  }

  const elapsedMs = performance.now() - runStarted;
  const candidateScore = (aggregate.candidateWins + aggregate.draws * 0.5) / aggregate.games;
  const avgTurns = aggregate.totalTurns / aggregate.games;
  const avgCaptures = aggregate.totalCaptures / aggregate.games;

  console.log(
    `[eval:done] games=${aggregate.games} score=${(candidateScore * 100).toFixed(1)}% W/L/D=${aggregate.candidateWins}/${aggregate.baselineWins}/${aggregate.draws} avg_turns=${avgTurns.toFixed(1)} avg_captures=${avgCaptures.toFixed(1)} elapsed=${formatDuration(elapsedMs)}`,
  );

  logger.log('benchmark_result', {
    games: aggregate.games,
    difficulty: options.difficulty,
    maxTurns: options.maxTurns,
    noCaptureDrawMoves: options.noCaptureDrawMoves,
    candidateWins: aggregate.candidateWins,
    baselineWins: aggregate.baselineWins,
    draws: aggregate.draws,
    candidateScore,
    winRate: aggregate.candidateWins / aggregate.games,
    drawRate: aggregate.draws / aggregate.games,
    lossRate: aggregate.baselineWins / aggregate.games,
    avgTurns,
    avgCaptures,
    maxTurnsDraws: aggregate.maxTurnsDraws,
    noCaptureDraws: aggregate.noCaptureDraws,
    baselineSource,
    candidateModel: summarizeModel(candidateModel),
    baselineModel: baselineModel ? summarizeModel(baselineModel) : null,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
  });

  logger.log('run_end', {
    status: 'completed',
    games: aggregate.games,
    candidateScore,
    candidateWins: aggregate.candidateWins,
    baselineWins: aggregate.baselineWins,
    draws: aggregate.draws,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(3)),
  });
}

function runEvalGame(
  gameIndex: number,
  options: {
    difficulty: ComputerDifficulty;
    maxTurns: number;
    noCaptureDrawMoves: number;
    candidateModel: StrategoModel;
    baselineModel: StrategoModel | null;
  },
): GameSummary {
  const startedAt = performance.now();
  let state = createEvalState(gameIndex);
  let terminalReason: TerminalReason = 'max_turns';
  let captureCount = 0;
  let noCaptureStreak = 0;
  let longestNoCaptureStreak = 0;
  const candidateColor: TeamColor = gameIndex % 2 === 0 ? 'blue' : 'red';

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const activeColor = state.currentTurn;
    const candidateTurn = activeColor === candidateColor;
    const chosenMove = chooseStrategoMoveForColor(
      state,
      activeColor,
      options.difficulty,
      candidateTurn
        ? { modelOverride: options.candidateModel }
        : options.baselineModel
          ? { modelOverride: options.baselineModel }
          : { disableModelBlend: true },
    );

    if (!chosenMove) {
      state = finishNoMovesState(state, activeColor);
      terminalReason = 'no_moves';
      break;
    }

    const result = applyStrategoMove(state, activeColor, {
      pieceId: chosenMove.pieceId,
      toRow: chosenMove.toRow,
      toCol: chosenMove.toCol,
    });
    state = result.state;

    if (result.combatResult) {
      captureCount += 1;
      noCaptureStreak = 0;
    } else {
      noCaptureStreak += 1;
      longestNoCaptureStreak = Math.max(longestNoCaptureStreak, noCaptureStreak);
    }

    if (options.noCaptureDrawMoves > 0 && noCaptureStreak >= options.noCaptureDrawMoves) {
      terminalReason = 'no_capture_streak';
      state = {
        ...state,
        status: 'finished',
        winner: null,
        winReason: null,
        updatedAt: new Date().toISOString(),
      };
      break;
    }

    if (state.status === 'finished') {
      terminalReason = state.winReason ?? 'max_turns';
      break;
    }
  }

  if (state.status === 'playing') {
    terminalReason = 'max_turns';
    state = {
      ...state,
      status: 'finished',
      winner: null,
      winReason: null,
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    gameIndex,
    candidateColor,
    turnsPlayed: state.moveHistory.length,
    winner: state.winner,
    terminalReason,
    captureCount,
    longestNoCaptureStreak,
    durationMs: performance.now() - startedAt,
  };
}

function createEvalState(gameIndex: number): LocalStrategoState {
  const now = new Date().toISOString();
  return {
    id: `eval-${Date.now()}-${gameIndex}`,
    status: 'playing',
    currentTurn: 'red',
    turnNumber: 1,
    redPieces: createSetupPieces('red', gameIndex),
    bluePieces: createSetupPieces('blue', gameIndex),
    redCaptured: [],
    blueCaptured: [],
    moveHistory: [],
    winner: null,
    winReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createSetupPieces(color: TeamColor, gameIndex: number): Piece[] {
  return generateRandomSetup(color).map((piece, index) => ({
    id: `${color}_eval_${gameIndex}_${index}`,
    rank: piece.rank,
    row: piece.row,
    col: piece.col,
    revealed: false,
  }));
}

function finishNoMovesState(state: LocalStrategoState, activeColor: TeamColor): LocalStrategoState {
  const winner = activeColor === 'red' ? 'blue' : 'red';
  return {
    ...state,
    status: 'finished',
    winner,
    winReason: 'no_moves',
    updatedAt: new Date().toISOString(),
  };
}

function applySummary(aggregate: EvalAggregate, summary: GameSummary): void {
  aggregate.games += 1;
  aggregate.totalTurns += summary.turnsPlayed;
  aggregate.totalCaptures += summary.captureCount;
  if (summary.terminalReason === 'max_turns') aggregate.maxTurnsDraws += 1;
  if (summary.terminalReason === 'no_capture_streak') aggregate.noCaptureDraws += 1;

  if (!summary.winner) {
    aggregate.draws += 1;
    return;
  }
  if (summary.winner === summary.candidateColor) {
    aggregate.candidateWins += 1;
  } else {
    aggregate.baselineWins += 1;
  }
}

function maybeLogProgress(
  options: EvalOptions,
  aggregate: EvalAggregate,
  summary: GameSummary,
  startedAtMs: number,
): void {
  const shouldLog = options.verbose
    || aggregate.games % options.progressEvery === 0
    || aggregate.games === options.games;
  if (!shouldLog) return;

  const elapsedMs = performance.now() - startedAtMs;
  const etaMs = estimateRemainingMs(elapsedMs, aggregate.games, options.games);
  const winnerLabel = summary.winner ?? 'draw';
  const score = aggregate.candidateWins + aggregate.draws * 0.5;
  console.log(
    `[eval] ${aggregate.games}/${options.games} game=${summary.gameIndex} candidate=${summary.candidateColor} winner=${winnerLabel} reason=${summary.terminalReason} turns=${summary.turnsPlayed} captures=${summary.captureCount} max_no_cap=${summary.longestNoCaptureStreak} score=${score.toFixed(1)}/${aggregate.games} W/L/D=${aggregate.candidateWins}/${aggregate.baselineWins}/${aggregate.draws} elapsed=${formatDuration(elapsedMs)} eta=${formatDuration(etaMs)}`,
  );
}

function loadModelFromPath(filePath: string): StrategoModel {
  const absolutePath = path.resolve(process.cwd(), filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read model from ${absolutePath}: ${message}`);
  }

  const model = parseStrategoModel(parsed);
  if (!model) {
    throw new Error(`Invalid model format: ${absolutePath}`);
  }
  return model;
}

function describeModel(model: StrategoModel | null): string {
  if (!model) return 'none';
  const kind = model.kind ?? 'linear';
  const samples = model.training.positionSamples;
  return `${kind} samples=${samples} generatedAt=${model.training.generatedAt}`;
}

function summarizeModel(model: StrategoModel) {
  return {
    kind: model.kind ?? 'linear',
    generatedAt: model.training.generatedAt,
    positionSamples: model.training.positionSamples,
    games: model.training.games,
    epochs: model.training.epochs,
    difficulty: model.training.difficulty,
    framework: model.training.framework ?? null,
    device: model.training.device ?? null,
  };
}

function parseOptions(argv: string[]): EvalOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsageAndExit();
  }

  const options: EvalOptions = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case '--games':
        options.games = parsePositiveInt(next, arg);
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
      case '--no-capture-draw':
        options.noCaptureDrawMoves = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--progress-every':
        options.progressEvery = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--model':
        if (!next) throw new Error('Missing value for --model');
        options.modelPath = next;
        index += 1;
        break;
      case '--baseline-model':
        if (!next) throw new Error('Missing value for --baseline-model');
        options.baselineModelPath = next;
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
        throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
    }
  }

  if (options.progressEvery > options.games) {
    options.progressEvery = options.games;
  }
  return options;
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

function printUsageAndExit(): never {
  console.log('Usage: npm run stratego:eval -- [options]');
  console.log('');
  console.log('Options:');
  console.log('  --games <n>            Number of benchmark games (default: 60)');
  console.log('  --difficulty <d>       medium|hard|extreme search strength (default: extreme)');
  console.log('  --max-turns <n>        Max turns before draw (default: 500)');
  console.log('  --no-capture-draw <n>  Draw when no capture occurs for N moves (default: 160, 0 disables)');
  console.log('  --progress-every <n>   Print interval in games (default: 10)');
  console.log('  --model <path>         Candidate model JSON path (default: lib/stratego/trained-model.json)');
  console.log('  --baseline-model <p>   Optional baseline model path (default: heuristic-only baseline)');
  console.log('  --metrics-log <path>   Metrics JSONL path (default: .stratego-cache/metrics/training-metrics.jsonl)');
  console.log('  --verbose, -v          Print every game');
  process.exit(0);
}

function estimateRemainingMs(elapsedMs: number, completed: number, total: number): number {
  if (completed <= 0 || total <= completed) return 0;
  return (elapsedMs / completed) * (total - completed);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

function createMetricsLogger(metricsLogPath: string): {
  runId: string;
  log: (eventType: string, payload: Record<string, unknown>) => void;
} {
  const runId = `eval-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const absolutePath = path.resolve(process.cwd(), metricsLogPath);
  let warned = false;

  const log = (eventType: string, payload: Record<string, unknown>) => {
    try {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      appendFileSync(
        absolutePath,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          source: 'eval',
          runId,
          eventType,
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
