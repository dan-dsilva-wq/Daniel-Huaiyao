import { performance } from 'node:perf_hooks';
import {
  applyStrategoMove,
  chooseStrategoMoveForColor,
  type MoveSelectionOptions,
  createDeterminizedPerspectiveState,
  type SearchAlgorithm,
  type ScoredStrategoMove,
  scoreStrategoMovesForColor,
  type ComputerDifficulty,
  type LocalStrategoState,
} from '../../lib/stratego/ai';
import { generateRandomSetup } from '../../lib/stratego/constants';
import { extractStrategoFeatures, type StrategoModel } from '../../lib/stratego/ml';
import type { Piece, TeamColor, WinReason } from '../../lib/stratego/types';
import {
  buildPolicyTargetsFromScoredMoves,
  buildPolicyTargetsFromVisitCounts,
  type PolicyTargetEntry,
} from './policy';

export interface LeagueModelEntry {
  id: string;
  model: StrategoModel;
}

export interface TrainingSample {
  features: number[];
  target: number;
  policyTargets?: PolicyTargetEntry[];
}

interface PendingSample {
  features: number[];
  perspective: TeamColor;
  policyTargets?: PolicyTargetEntry[];
  searchValueTarget?: number;
  ply: number;
}

interface SideController {
  label: string;
  modelOverride?: StrategoModel;
  disableModelBlend: boolean;
}

export type ValueTargetMode = 'terminal' | 'mixed' | 'search';

export interface SelfPlayOptions {
  difficulty: ComputerDifficulty;
  searchAlgorithm?: SearchAlgorithm;
  puctSimulations?: number;
  puctCpuct?: number;
  puctRolloutDepth?: number;
  maxTurns: number;
  noCaptureDrawMoves: number;
  traceTurns: boolean;
  includePolicyTargets?: boolean;
  policyTemperature?: number;
  policyTopK?: number;
  valueTargetMode?: ValueTargetMode;
  searchValueBlend?: number;
  bootstrapSteps?: number;
  bootstrapDiscount?: number;
  bootstrapBlend?: number;
  leagueModels?: LeagueModelEntry[];
  leagueSampleProb?: number;
  leagueHeuristicProb?: number;
  traceLog?: (line: string) => void;
}

export type SelfPlayTerminalReason = WinReason | 'max_turns' | 'no_capture_streak';

export interface SelfPlayGameSummary {
  gameIndex: number;
  turnsPlayed: number;
  winner: TeamColor | null;
  winReason: WinReason | null;
  terminalReason: SelfPlayTerminalReason;
  samplesAdded: number;
  captureCount: number;
  longestNoCaptureStreak: number;
  durationMs: number;
  redController?: string;
  blueController?: string;
}

export interface SelfPlayGameResult {
  finalState: LocalStrategoState;
  samples: TrainingSample[];
  summary: SelfPlayGameSummary;
}

export interface SelfPlayBatchResult {
  samples: TrainingSample[];
  summaries: SelfPlayGameSummary[];
  redWins: number;
  blueWins: number;
  draws: number;
}

export function runSelfPlayBatch(
  startGameIndex: number,
  games: number,
  options: SelfPlayOptions,
  onGameComplete?: (summary: SelfPlayGameSummary) => void,
): SelfPlayBatchResult {
  const samples: TrainingSample[] = [];
  const summaries: SelfPlayGameSummary[] = [];
  let redWins = 0;
  let blueWins = 0;
  let draws = 0;

  for (let offset = 0; offset < games; offset += 1) {
    const gameIndex = startGameIndex + offset;
    const result = runSelfPlayGame(gameIndex, options);
    summaries.push(result.summary);
    samples.push(...result.samples);
    onGameComplete?.(result.summary);

    if (result.summary.winner === 'red') redWins += 1;
    else if (result.summary.winner === 'blue') blueWins += 1;
    else draws += 1;
  }

  return {
    samples,
    summaries,
    redWins,
    blueWins,
    draws,
  };
}

export function runSelfPlayGame(
  gameIndex: number,
  options: SelfPlayOptions,
): SelfPlayGameResult {
  const startedAt = performance.now();
  let state = createSelfPlayState(gameIndex);
  const pending: PendingSample[] = [];
  let captureCount = 0;
  let noCaptureStreak = 0;
  let longestNoCaptureStreak = 0;
  let terminalReason: SelfPlayTerminalReason = 'max_turns';
  const leagueModels = options.leagueModels ?? [];
  const leagueSampleProb = clamp(options.leagueSampleProb ?? 0, 0, 1);
  const leagueHeuristicProb = clamp(options.leagueHeuristicProb ?? 0, 0, 1);
  const redController = sampleSideController(leagueModels, leagueSampleProb, leagueHeuristicProb);
  const blueController = sampleSideController(leagueModels, leagueSampleProb, leagueHeuristicProb);
  if (options.traceTurns && (redController.label !== 'active' || blueController.label !== 'active')) {
    options.traceLog?.(
      `game=${gameIndex} controllers red=${redController.label} blue=${blueController.label}`,
    );
  }

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const activeColor = state.currentTurn;
    const activeController = activeColor === 'red' ? redController : blueController;
    const moveSelectionOptions = buildMoveSelectionOptions(options, activeController);
    const ply = state.moveHistory.length;
    const valueTargetMode: ValueTargetMode = options.valueTargetMode ?? 'terminal';
    const needsScoredMoves = options.includePolicyTargets || valueTargetMode !== 'terminal';
    const scoredMoves: ScoredStrategoMove[] | undefined = needsScoredMoves
      ? scoreStrategoMovesForColor(
        state,
        activeColor,
        options.difficulty,
        moveSelectionOptions,
      )
      : undefined;
    const searchValueForActiveColor = valueTargetMode !== 'terminal'
      ? deriveSearchValueTarget(scoredMoves)
      : undefined;
    const useVisitPolicyTargets = options.searchAlgorithm === 'puct-lite'
      && Boolean(scoredMoves?.some((entry) => (entry.visits ?? 0) > 0));
    const policyTargetsForActiveColor = options.includePolicyTargets
      ? (
        useVisitPolicyTargets
          ? buildPolicyTargetsFromVisitCounts(
            scoredMoves ?? [],
            {
              topK: options.policyTopK ?? 12,
            },
          )
          : buildPolicyTargetsFromScoredMoves(
            scoredMoves ?? [],
            {
              temperature: options.policyTemperature ?? 1.1,
              topK: options.policyTopK ?? 12,
            },
          )
      )
      : undefined;

    const redPerspectiveState = createDeterminizedPerspectiveState(state, 'red');
    const bluePerspectiveState = createDeterminizedPerspectiveState(state, 'blue');

    pending.push({
      features: extractStrategoFeatures(redPerspectiveState, 'red'),
      perspective: 'red',
      policyTargets: activeColor === 'red' ? policyTargetsForActiveColor : undefined,
      searchValueTarget: activeColor === 'red' ? searchValueForActiveColor : undefined,
      ply,
    });
    pending.push({
      features: extractStrategoFeatures(bluePerspectiveState, 'blue'),
      perspective: 'blue',
      policyTargets: activeColor === 'blue' ? policyTargetsForActiveColor : undefined,
      searchValueTarget: activeColor === 'blue' ? searchValueForActiveColor : undefined,
      ply,
    });

    const chosenMove = chooseStrategoMoveForColor(
      state,
      activeColor,
      options.difficulty,
      moveSelectionOptions,
    );

    if (!chosenMove) {
      if (options.traceTurns) {
        options.traceLog?.(`game=${gameIndex} turn=${state.turnNumber} ${activeColor} has no legal moves`);
      }
      state = finishNoMovesState(state, activeColor);
      terminalReason = 'no_moves';
      break;
    }

    if (options.traceTurns) {
      const attackLabel = chosenMove.isAttack
        ? ` attack_vs=${chosenMove.defenderRank ?? '?'}`
        : '';
      options.traceLog?.(
        `game=${gameIndex} turn=${state.turnNumber} ${activeColor} ${chosenMove.pieceId} (${chosenMove.fromRow},${chosenMove.fromCol})->(${chosenMove.toRow},${chosenMove.toCol})${attackLabel}`,
      );
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
      if (options.traceTurns) {
        options.traceLog?.(
          `game=${gameIndex} reached no-capture draw threshold (${options.noCaptureDrawMoves}) -> draw`,
        );
      }
      state = {
        ...state,
        status: 'finished',
        winner: null,
        winReason: null,
        updatedAt: new Date().toISOString(),
      };
      break;
    }

    if (result.state.status === 'finished') {
      terminalReason = result.state.winReason ?? 'max_turns';
    }

    if (options.traceTurns && result.state.status === 'finished') {
      options.traceLog?.(
        `game=${gameIndex} finished winner=${result.state.winner ?? 'draw'} reason=${result.state.winReason ?? 'draw'}`,
      );
    }
  }

  if (state.status === 'playing') {
    terminalReason = 'max_turns';
    if (options.traceTurns) {
      options.traceLog?.(`game=${gameIndex} reached max turns (${options.maxTurns}) -> draw`);
    }
    state = {
      ...state,
      status: 'finished',
      winner: null,
      winReason: null,
      updatedAt: new Date().toISOString(),
    };
  }

  const redOutcome = state.winner === 'red' ? 1 : state.winner === 'blue' ? -1 : 0;
  const valueTargetMode: ValueTargetMode = options.valueTargetMode ?? 'terminal';
  const searchValueBlend = clamp(options.searchValueBlend ?? 0.35, 0, 1);
  const bootstrapSteps = clampInt(options.bootstrapSteps ?? 0, 0, 128);
  const bootstrapDiscount = clamp(options.bootstrapDiscount ?? 1, 0, 1);
  const bootstrapBlend = clamp(options.bootstrapBlend ?? 0, 0, 1);
  const futureSearchValueByPerspectivePly = bootstrapSteps > 0
    ? buildSearchTargetLookup(pending)
    : null;
  const samples = pending.map((sample) => ({
    features: sample.features,
    target: deriveFinalTarget(
      {
        terminalOutcome: sample.perspective === 'red' ? redOutcome : -redOutcome,
        searchValueTarget: sample.searchValueTarget,
        bootstrappedValueTarget: futureSearchValueByPerspectivePly
          ? deriveBootstrappedValueTarget(
            sample,
            futureSearchValueByPerspectivePly,
            bootstrapSteps,
            bootstrapDiscount,
          )
          : undefined,
        mode: valueTargetMode,
        blend: searchValueBlend,
        bootstrapBlend,
      },
    ),
    policyTargets: sample.policyTargets && sample.policyTargets.length > 0
      ? sample.policyTargets
      : undefined,
  }));

  const summary: SelfPlayGameSummary = {
    gameIndex,
    turnsPlayed: state.moveHistory.length,
    winner: state.winner,
    winReason: state.winReason,
    terminalReason,
    samplesAdded: samples.length,
    captureCount,
    longestNoCaptureStreak,
    durationMs: performance.now() - startedAt,
    redController: redController.label,
    blueController: blueController.label,
  };

  return {
    finalState: state,
    samples,
    summary,
  };
}

function createSelfPlayState(gameIndex: number): LocalStrategoState {
  const now = new Date().toISOString();
  return {
    id: `selfplay-${Date.now()}-${gameIndex}`,
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
  const setup = generateRandomSetup(color);
  return setup.map((piece, index) => ({
    id: `${color}_${gameIndex}_${index}`,
    rank: piece.rank,
    row: piece.row,
    col: piece.col,
    revealed: false,
  }));
}

function finishNoMovesState(
  state: LocalStrategoState,
  activeColor: TeamColor,
): LocalStrategoState {
  const winner = activeColor === 'red' ? 'blue' : 'red';
  return {
    ...state,
    status: 'finished',
    winner,
    winReason: 'no_moves',
    updatedAt: new Date().toISOString(),
  };
}

function sampleSideController(
  leagueModels: LeagueModelEntry[],
  leagueSampleProb: number,
  leagueHeuristicProb: number,
): SideController {
  if (leagueHeuristicProb > 0 && Math.random() < leagueHeuristicProb) {
    return {
      label: 'heuristic',
      disableModelBlend: true,
    };
  }

  if (leagueModels.length > 0 && leagueSampleProb > 0 && Math.random() < leagueSampleProb) {
    const picked = leagueModels[Math.floor(Math.random() * leagueModels.length)];
    return {
      label: `pool:${picked.id}`,
      modelOverride: picked.model,
      disableModelBlend: false,
    };
  }

  return {
    label: 'active',
    disableModelBlend: false,
  };
}

function buildMoveSelectionOptions(
  options: SelfPlayOptions,
  controller: SideController,
): MoveSelectionOptions | undefined {
  const base: MoveSelectionOptions = {};
  if (controller.modelOverride) {
    base.modelOverride = controller.modelOverride;
  }
  if (controller.disableModelBlend) {
    base.disableModelBlend = true;
  }
  if (options.searchAlgorithm === 'puct-lite') {
    base.searchAlgorithm = 'puct-lite';
    base.puctSimulations = options.puctSimulations;
    base.puctCpuct = options.puctCpuct;
    base.puctRolloutDepth = options.puctRolloutDepth;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

function deriveSearchValueTarget(scoredMoves: ScoredStrategoMove[] | undefined): number | undefined {
  if (!scoredMoves || scoredMoves.length === 0) return undefined;
  const bestScore = scoredMoves[0].score;
  if (!Number.isFinite(bestScore)) return undefined;
  return Math.tanh(bestScore / 5200);
}

function deriveFinalTarget(input: {
  terminalOutcome: number;
  searchValueTarget: number | undefined;
  bootstrappedValueTarget: number | undefined;
  mode: ValueTargetMode;
  blend: number;
  bootstrapBlend: number;
}): number {
  let target = input.terminalOutcome;
  if (input.mode === 'search') {
    target = clamp(input.searchValueTarget ?? input.terminalOutcome, -1, 1);
  } else if (input.mode === 'mixed') {
    const search = input.searchValueTarget ?? input.terminalOutcome;
    target = clamp((1 - input.blend) * input.terminalOutcome + input.blend * search, -1, 1);
  }

  if (input.bootstrappedValueTarget !== undefined && input.bootstrapBlend > 0) {
    target = clamp(
      (1 - input.bootstrapBlend) * target + input.bootstrapBlend * input.bootstrappedValueTarget,
      -1,
      1,
    );
  }

  return clamp(target, -1, 1);
}

function buildSearchTargetLookup(pending: PendingSample[]): Map<string, number> {
  const lookup = new Map<string, number>();
  for (const sample of pending) {
    if (sample.searchValueTarget === undefined || !Number.isFinite(sample.searchValueTarget)) {
      continue;
    }
    lookup.set(bootstrapKey(sample.perspective, sample.ply), sample.searchValueTarget);
  }
  return lookup;
}

function deriveBootstrappedValueTarget(
  sample: PendingSample,
  lookup: Map<string, number>,
  steps: number,
  discount: number,
): number | undefined {
  if (steps <= 0) return undefined;
  const key = bootstrapKey(sample.perspective, sample.ply + steps);
  const futureValue = lookup.get(key);
  if (futureValue === undefined || !Number.isFinite(futureValue)) return undefined;
  return clamp((discount ** steps) * futureValue, -1, 1);
}

function bootstrapKey(perspective: TeamColor, ply: number): string {
  return `${perspective}:${ply}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
