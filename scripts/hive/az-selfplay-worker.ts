import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyHiveMove,
  createLocalHiveGameState,
  getLegalMovesForColor,
  runHiveMctsSearch,
  type HiveComputerDifficulty,
} from '../../lib/hive/ai';
import {
  HIVE_ACTION_FEATURE_NAMES,
  HIVE_DEFAULT_TOKEN_SLOTS,
  buildHiveTokenStateFeatureNames,
  extractHiveActionFeatures,
  extractHiveTokenStateFeatures,
  parseHiveModel,
  type HiveModel,
} from '../../lib/hive/ml';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import type { GameState, PlayerColor } from '../../lib/hive/types';

type SelfPlaySampleOrigin = 'learner' | 'champion';

interface WorkerOptions {
  games: number;
  difficulty: HiveComputerDifficulty;
  maxTurns: number;
  noCaptureDrawMoves: number;
  simulations: number;
  fastSimulations: number;
  fastRatio: number;
  seed: number;
  modelPath: string | null;
  sampleOrigin: SelfPlaySampleOrigin;
  outPath: string;
}

interface PolicyTarget {
  actionKey: string;
  probability: number;
  visitCount: number;
  actionFeatures: number[];
}

interface SelfPlaySample {
  stateFeatures: number[];
  perspective: PlayerColor;
  sampleOrigin?: SelfPlaySampleOrigin;
  policyTargets: PolicyTarget[];
  valueTarget: number;
  auxTargets: {
    queenSurroundDelta: number;
    mobility: number;
    lengthBucket: number;
  };
  searchMeta: {
    simulations: number;
    nodesPerSecond: number;
    policyEntropy: number;
    averageDepth: number;
    dirichletAlpha: number;
    temperature: number;
    maxDepth: number;
    reanalysed: boolean;
  };
  stateSnapshot: GameState;
}

interface WorkerOutput {
  version: number;
  createdAt: string;
  updatedAt: string;
  stateFeatureNames: string[];
  actionFeatureNames: string[];
  samples: SelfPlaySample[];
  summary: {
    games: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
    totalMoves: number;
    totalSimulations: number;
    sampleOrigin: SelfPlaySampleOrigin;
  };
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const result = runSelfPlayChunk(options, loadWorkerModel(options.modelPath));
  const payload: WorkerOutput = {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stateFeatureNames: buildHiveTokenStateFeatureNames(HIVE_DEFAULT_TOKEN_SLOTS),
    actionFeatureNames: [...HIVE_ACTION_FEATURE_NAMES],
    samples: result.samples,
    summary: {
      games: options.games,
      whiteWins: result.whiteWins,
      blackWins: result.blackWins,
      draws: result.draws,
      totalMoves: result.totalMoves,
      totalSimulations: result.totalSimulations,
      sampleOrigin: options.sampleOrigin,
    },
  };

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function runSelfPlayChunk(
  options: WorkerOptions,
  modelOverride?: HiveModel,
): {
  samples: SelfPlaySample[];
  whiteWins: number;
  blackWins: number;
  draws: number;
  totalMoves: number;
  totalSimulations: number;
} {
  const all: SelfPlaySample[] = [];
  let whiteWins = 0;
  let blackWins = 0;
  let draws = 0;
  let totalMoves = 0;
  let totalSimulations = 0;

  for (let gameIndex = 1; gameIndex <= options.games; gameIndex += 1) {
    const rng = createRng(options.seed + gameIndex * 73);
    const perGame: SelfPlaySample[] = [];
    let state = createLocalHiveGameState({
      id: `azw-${Date.now()}-${gameIndex}`,
      shortCode: 'AZW',
      whitePlayerId: 'az-white',
      blackPlayerId: 'az-black',
    });

    let noProgress = 0;
    let prevPressure = queenPressure(state);

    while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
      const sims = rng() < options.fastRatio
        ? options.fastSimulations
        : options.simulations;

      // Temperature controls policy target sharpness:
      // - Higher temp (1.0) = softer distribution, more gradient signal for non-best moves
      // - Lower temp (0.12) = nearly one-hot, only best move gets gradient
      // We use higher temps to ensure the policy head actually learns
      const mctsConfig = {
        simulations: Math.max(4, sims),
        dirichletAlpha: state.turnNumber < 10 ? 0.35 : 0.22,
        temperature: state.turnNumber < 15 ? 1.0 : 0.5,
        maxDepth: options.maxTurns,
      };

      const search = runHiveMctsSearch(state, state.currentTurn, options.difficulty, {
        engine: 'alphazero',
        modelOverride,
        mctsConfig,
        randomSeed: options.seed + gameIndex * 197 + state.turnNumber * 11,
      });

      if (!search.selectedMove) {
        state = {
          ...state,
          status: 'finished',
          winner: state.currentTurn === 'white' ? 'black' : 'white',
        };
        break;
      }

      totalMoves += 1;
      totalSimulations += search.stats.simulations;
      const lengthBucket = state.turnNumber <= 60 ? 0 : state.turnNumber <= 120 ? 1 : 2;
      perGame.push({
        stateFeatures: extractHiveTokenStateFeatures(state, state.currentTurn, HIVE_DEFAULT_TOKEN_SLOTS),
        perspective: state.currentTurn,
        sampleOrigin: options.sampleOrigin,
        valueTarget: 0,
        policyTargets: search.policy.map((entry) => ({
          actionKey: entry.actionKey,
          probability: entry.rawProbability ?? entry.probability,
          visitCount: entry.rawVisits ?? entry.visits,
          actionFeatures: extractHiveActionFeatures(state, entry.move, state.currentTurn),
        })),
        auxTargets: {
          queenSurroundDelta: clamp(queenPressureSigned(state, state.currentTurn) / 6, -1, 1),
          mobility: estimateMobilityState(state, state.currentTurn),
          lengthBucket,
        },
        searchMeta: {
          simulations: search.stats.simulations,
          nodesPerSecond: search.stats.nodesPerSecond,
          policyEntropy: search.stats.policyEntropy,
          averageDepth: search.stats.averageSimulationDepth,
          dirichletAlpha: mctsConfig.dirichletAlpha,
          temperature: mctsConfig.temperature,
          maxDepth: mctsConfig.maxDepth,
          reanalysed: false,
        },
        stateSnapshot: cloneState(state),
      });

      state = applyHiveMove(state, search.selectedMove);
      const pressure = queenPressure(state);
      if (pressure === prevPressure) {
        noProgress += 1;
      } else {
        prevPressure = pressure;
        noProgress = 0;
      }

      if (options.noCaptureDrawMoves > 0 && noProgress >= options.noCaptureDrawMoves) {
        state = {
          ...state,
          status: 'finished',
          winner: 'draw',
        };
      }
    }

    if (state.status !== 'finished') {
      state = {
        ...state,
        status: 'finished',
        winner: 'draw',
      };
    }

    const winner = state.winner;
    if (winner === 'white') whiteWins += 1;
    else if (winner === 'black') blackWins += 1;
    else draws += 1;

    for (const sample of perGame) {
      sample.valueTarget = winner === 'draw' || !winner
        ? 0
        : winner === sample.perspective
          ? 1
          : -1;
    }

    all.push(...perGame);
  }

  return {
    samples: all,
    whiteWins,
    blackWins,
    draws,
    totalMoves,
    totalSimulations,
  };
}

function parseOptions(argv: string[]): WorkerOptions {
  const options: WorkerOptions = {
    games: 2,
    difficulty: 'extreme',
    maxTurns: 320,
    noCaptureDrawMoves: 100,
    simulations: 220,
    fastSimulations: 72,
    fastRatio: 0.55,
    seed: 2026,
    modelPath: null,
    sampleOrigin: 'learner',
    outPath: '.hive-cache/async/chunks/chunk.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--games': options.games = parsePositiveInt(next, arg); index += 1; break;
      case '--difficulty': options.difficulty = parseDifficulty(next); index += 1; break;
      case '--max-turns': options.maxTurns = parsePositiveInt(next, arg); index += 1; break;
      case '--no-capture-draw': options.noCaptureDrawMoves = parseNonNegativeInt(next, arg); index += 1; break;
      case '--simulations': options.simulations = parsePositiveInt(next, arg); index += 1; break;
      case '--fast-simulations': options.fastSimulations = parsePositiveInt(next, arg); index += 1; break;
      case '--fast-ratio': options.fastRatio = parseRatio(next, arg); index += 1; break;
      case '--seed': options.seed = parseNonNegativeInt(next, arg); index += 1; break;
      case '--model': if (!next) throw new Error('Missing value for --model'); options.modelPath = next; index += 1; break;
      case '--sample-origin': options.sampleOrigin = parseSampleOrigin(next, arg); index += 1; break;
      case '--out': if (!next) throw new Error('Missing value for --out'); options.outPath = next; index += 1; break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.outPath = path.resolve(process.cwd(), options.outPath);
  if (options.modelPath) {
    options.modelPath = path.resolve(process.cwd(), options.modelPath);
  }
  return options;
}

function loadWorkerModel(absolutePath: string | null): HiveModel | undefined {
  if (!absolutePath) return undefined;
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

function parseDifficulty(value: string | undefined): HiveComputerDifficulty {
  if (value === 'medium' || value === 'hard' || value === 'extreme') return value;
  throw new Error(`Invalid --difficulty value: ${value}`);
}

function parseSampleOrigin(value: string | undefined, flag: string): SelfPlaySampleOrigin {
  if (value === 'learner' || value === 'champion') return value;
  throw new Error(`Invalid value for ${flag}: ${value}`);
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

function parseRatio(value: string | undefined, flag: string): number {
  if (!value) throw new Error(`Missing value for ${flag}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function createRng(seed: number): () => number {
  let state = Math.floor(Math.abs(seed)) % 2147483647;
  if (state <= 0) state = 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function queenPressure(state: GameState): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function queenPressureSigned(state: GameState, perspective: PlayerColor): number {
  return getQueenSurroundCount(state.board, flipColor(perspective))
    - getQueenSurroundCount(state.board, perspective);
}

function estimateMobilityState(state: GameState, perspective: PlayerColor): number {
  const myMoves = getLegalMovesForColor(state, perspective).length;
  const oppMoves = getLegalMovesForColor(state, flipColor(perspective)).length;
  return clamp((myMoves - oppMoves) / 40, -1, 1);
}

function flipColor(color: PlayerColor): PlayerColor {
  return color === 'white' ? 'black' : 'white';
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    settings: {
      ...state.settings,
      expansionPieces: { ...state.settings.expansionPieces },
    },
    board: state.board.map((piece) => ({ ...piece, position: { ...piece.position } })),
    whiteHand: state.whiteHand.map((piece) => ({ ...piece })),
    blackHand: state.blackHand.map((piece) => ({ ...piece })),
    lastMovedPiece: state.lastMovedPiece
      ? {
          ...state.lastMovedPiece,
          from: state.lastMovedPiece.from ? { ...state.lastMovedPiece.from } : undefined,
          to: { ...state.lastMovedPiece.to },
        }
      : null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

main();
