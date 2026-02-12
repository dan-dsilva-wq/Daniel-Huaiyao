import type { LocalStrategoState } from './ai';
import type { Piece, PieceRank, TeamColor } from './types';
import trainedModelData from './trained-model.json';

export type StrategoDifficultyLabel = 'medium' | 'hard' | 'extreme' | 'mixed';

export interface StrategoModelTrainingInfo {
  generatedAt: string;
  games: number;
  positionSamples: number;
  epochs: number;
  difficulty: StrategoDifficultyLabel;
  framework?: string;
  device?: string;
  batchSize?: number;
  learningRate?: number;
  workers?: number;
  hiddenLayers?: number[];
}

export const STRATEGO_LINEAR_MODEL_VERSION = 1;
export const STRATEGO_MLP_MODEL_VERSION = 2;
export const STRATEGO_MODEL_VERSION = STRATEGO_LINEAR_MODEL_VERSION;

export interface StrategoLinearModel {
  version: typeof STRATEGO_LINEAR_MODEL_VERSION;
  kind?: 'linear';
  featureNames: readonly string[];
  weights: readonly number[];
  bias: number;
  training: StrategoModelTrainingInfo;
}

export type StrategoActivation = 'linear' | 'tanh' | 'relu';

export interface StrategoMlpLayer {
  inputSize: number;
  outputSize: number;
  weights: readonly number[];
  bias: readonly number[];
  activation: StrategoActivation;
}

export interface StrategoMlpModel {
  version: typeof STRATEGO_MLP_MODEL_VERSION;
  kind: 'mlp';
  featureNames: readonly string[];
  layers: readonly StrategoMlpLayer[];
  outputActivation?: StrategoActivation;
  training: StrategoModelTrainingInfo;
}

export type StrategoModel = StrategoLinearModel | StrategoMlpModel;

export const STRATEGO_FEATURE_NAMES = [
  'rank_balance_0',
  'rank_balance_1',
  'rank_balance_2',
  'rank_balance_3',
  'rank_balance_4',
  'rank_balance_5',
  'rank_balance_6',
  'rank_balance_7',
  'rank_balance_8',
  'rank_balance_9',
  'rank_balance_10',
  'rank_balance_11',
  'material_value_diff',
  'movable_piece_diff',
  'scout_diff',
  'miner_diff',
  'bomb_diff',
  'high_rank_diff',
  'revealed_ratio_diff',
  'hidden_high_rank_diff',
  'advancement_diff',
  'frontline_diff',
  'center_control_diff',
  'flag_guard_diff',
  'flag_pressure_diff',
  'turn_advantage',
  'game_phase',
] as const;

export type StrategoFeatureName = typeof STRATEGO_FEATURE_NAMES[number];

const PIECE_COUNTS_BY_RANK: Record<PieceRank, number> = {
  0: 1,
  1: 1,
  2: 8,
  3: 5,
  4: 4,
  5: 4,
  6: 4,
  7: 3,
  8: 2,
  9: 1,
  10: 1,
  11: 6,
};

const PIECE_VALUES: Record<PieceRank, number> = {
  0: 40000,
  1: 140,
  2: 120,
  3: 230,
  4: 300,
  5: 380,
  6: 470,
  7: 560,
  8: 680,
  9: 860,
  10: 1100,
  11: 190,
};

const PIECE_RANKS: PieceRank[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const MAX_MATERIAL_PER_SIDE = PIECE_RANKS.reduce(
  (sum, rank) => sum + PIECE_VALUES[rank] * PIECE_COUNTS_BY_RANK[rank],
  0,
);

const DEFAULT_MODEL: StrategoLinearModel = {
  version: STRATEGO_LINEAR_MODEL_VERSION,
  kind: 'linear',
  featureNames: STRATEGO_FEATURE_NAMES,
  weights: Array.from({ length: STRATEGO_FEATURE_NAMES.length }, () => 0),
  bias: 0,
  training: {
    generatedAt: new Date(0).toISOString(),
    games: 0,
    positionSamples: 0,
    epochs: 0,
    difficulty: 'mixed',
    framework: 'typescript',
    device: 'cpu',
  },
};

const ACTIVE_MODEL = parseModel(trainedModelData) ?? DEFAULT_MODEL;

export function getActiveStrategoModel(): StrategoModel {
  return ACTIVE_MODEL;
}

export function extractStrategoFeatures(
  state: LocalStrategoState,
  perspective: TeamColor,
): number[] {
  const myPieces = getPieces(state, perspective);
  const oppPieces = getPieces(state, flipColor(perspective));

  const myCounts = rankCounts(myPieces);
  const oppCounts = rankCounts(oppPieces);

  const featureVector: number[] = [];

  for (const rank of PIECE_RANKS) {
    const maxCount = PIECE_COUNTS_BY_RANK[rank];
    featureVector.push((myCounts[rank] - oppCounts[rank]) / maxCount);
  }

  const myMaterial = pieceMaterial(myPieces);
  const oppMaterial = pieceMaterial(oppPieces);
  const myMovable = movablePieceCount(myPieces);
  const oppMovable = movablePieceCount(oppPieces);
  const myHighRanks = highRankCount(myPieces);
  const oppHighRanks = highRankCount(oppPieces);
  const myRevealedRatio = revealedRatio(myPieces);
  const oppRevealedRatio = revealedRatio(oppPieces);
  const myHiddenHighRanks = hiddenHighRankCount(myPieces);
  const oppHiddenHighRanks = hiddenHighRankCount(oppPieces);
  const myAdvancement = advancementScore(myPieces, perspective);
  const oppAdvancement = advancementScore(oppPieces, flipColor(perspective));
  const myFrontline = frontlinePresence(myPieces, perspective);
  const oppFrontline = frontlinePresence(oppPieces, flipColor(perspective));
  const myCenter = centerControlScore(myPieces);
  const oppCenter = centerControlScore(oppPieces);
  const myFlagGuard = flagGuardScore(myPieces);
  const oppFlagGuard = flagGuardScore(oppPieces);
  const myFlagPressure = flagPressureScore(myPieces, findFlag(oppPieces));
  const oppFlagPressure = flagPressureScore(oppPieces, findFlag(myPieces));

  featureVector.push((myMaterial - oppMaterial) / MAX_MATERIAL_PER_SIDE);
  featureVector.push((myMovable - oppMovable) / 33);
  featureVector.push((myCounts[2] - oppCounts[2]) / 8);
  featureVector.push((myCounts[3] - oppCounts[3]) / 5);
  featureVector.push((myCounts[11] - oppCounts[11]) / 6);
  featureVector.push((myHighRanks - oppHighRanks) / 4);
  featureVector.push(myRevealedRatio - oppRevealedRatio);
  featureVector.push((myHiddenHighRanks - oppHiddenHighRanks) / 4);
  featureVector.push(myAdvancement - oppAdvancement);
  featureVector.push((myFrontline - oppFrontline) / 20);
  featureVector.push((myCenter - oppCenter) / 30);
  featureVector.push((myFlagGuard - oppFlagGuard) / 8);
  featureVector.push(myFlagPressure - oppFlagPressure);
  featureVector.push(state.currentTurn === perspective ? 1 : -1);
  featureVector.push(gamePhaseFeature(state.turnNumber));

  return featureVector;
}

export function evaluateStrategoModel(
  state: LocalStrategoState,
  perspective: TeamColor,
  model: StrategoModel = ACTIVE_MODEL,
): number {
  const features = extractStrategoFeatures(state, perspective);
  if (isMlpModel(model)) {
    return evaluateMlp(features, model);
  }

  let sum = model.bias;
  for (let index = 0; index < features.length; index += 1) {
    sum += model.weights[index] * features[index];
  }
  return Math.tanh(sum);
}

export function blendHeuristicWithModel(
  state: LocalStrategoState,
  perspective: TeamColor,
  heuristicScore: number,
): number {
  const model = ACTIVE_MODEL;
  const sampleCount = model.training.positionSamples;
  if (sampleCount < 1500) return heuristicScore;

  const modelScore = evaluateStrategoModel(state, perspective, model) * 5200;
  const baseBlend = Math.min(0.55, 0.25 + Math.log10(sampleCount + 10) * 0.07);
  const blendWeight = isMlpModel(model)
    ? Math.min(0.68, baseBlend + 0.08)
    : baseBlend;

  return heuristicScore * (1 - blendWeight) + modelScore * blendWeight;
}

function evaluateMlp(features: number[], model: StrategoMlpModel): number {
  let activations = features;

  for (const layer of model.layers) {
    const next = new Array(layer.outputSize).fill(0);
    for (let outIndex = 0; outIndex < layer.outputSize; outIndex += 1) {
      let sum = layer.bias[outIndex];
      const weightOffset = outIndex * layer.inputSize;
      for (let inIndex = 0; inIndex < layer.inputSize; inIndex += 1) {
        sum += layer.weights[weightOffset + inIndex] * activations[inIndex];
      }
      next[outIndex] = applyActivation(sum, layer.activation);
    }
    activations = next;
  }

  const rawOutput = activations[0] ?? 0;
  const activated = applyActivation(rawOutput, model.outputActivation ?? 'tanh');
  if (!Number.isFinite(activated)) return 0;
  return Math.max(-1, Math.min(1, activated));
}

function applyActivation(value: number, activation: StrategoActivation): number {
  switch (activation) {
    case 'linear':
      return value;
    case 'relu':
      return Math.max(0, value);
    case 'tanh':
      return Math.tanh(value);
  }
}

function parseModel(input: unknown): StrategoModel | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Record<string, unknown>;

  if (candidate.kind === 'mlp' || candidate.version === STRATEGO_MLP_MODEL_VERSION) {
    return parseMlpModel(candidate);
  }

  return parseLinearModel(candidate);
}

function parseLinearModel(candidate: Record<string, unknown>): StrategoLinearModel | null {
  if (candidate.version !== STRATEGO_LINEAR_MODEL_VERSION) return null;
  if (candidate.kind && candidate.kind !== 'linear') return null;
  if (!Array.isArray(candidate.featureNames)) return null;
  if (!Array.isArray(candidate.weights)) return null;
  if (typeof candidate.bias !== 'number' || !Number.isFinite(candidate.bias)) return null;

  const featureNames = candidate.featureNames;
  const weights = candidate.weights;

  if (featureNames.length !== STRATEGO_FEATURE_NAMES.length) return null;
  if (weights.length !== STRATEGO_FEATURE_NAMES.length) return null;

  for (let index = 0; index < STRATEGO_FEATURE_NAMES.length; index += 1) {
    if (featureNames[index] !== STRATEGO_FEATURE_NAMES[index]) return null;
    const weight = weights[index];
    if (typeof weight !== 'number' || !Number.isFinite(weight)) return null;
  }

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: STRATEGO_LINEAR_MODEL_VERSION,
    kind: 'linear',
    featureNames: [...featureNames] as string[],
    weights: [...weights] as number[],
    bias: candidate.bias,
    training,
  };
}

function parseMlpModel(candidate: Record<string, unknown>): StrategoMlpModel | null {
  if (candidate.version !== STRATEGO_MLP_MODEL_VERSION) return null;
  if (candidate.kind !== 'mlp') return null;
  if (!Array.isArray(candidate.featureNames)) return null;
  if (!Array.isArray(candidate.layers)) return null;

  const featureNames = candidate.featureNames;
  if (featureNames.length !== STRATEGO_FEATURE_NAMES.length) return null;
  for (let index = 0; index < STRATEGO_FEATURE_NAMES.length; index += 1) {
    if (featureNames[index] !== STRATEGO_FEATURE_NAMES[index]) return null;
  }

  const layers: StrategoMlpLayer[] = [];
  let expectedInputSize = STRATEGO_FEATURE_NAMES.length;

  for (const rawLayer of candidate.layers) {
    if (!rawLayer || typeof rawLayer !== 'object') return null;
    const layer = rawLayer as Record<string, unknown>;

    if (!Number.isInteger(layer.inputSize) || !Number.isInteger(layer.outputSize)) return null;
    const inputSize = layer.inputSize as number;
    const outputSize = layer.outputSize as number;
    if (inputSize <= 0 || outputSize <= 0) return null;
    if (inputSize !== expectedInputSize) return null;
    expectedInputSize = outputSize;

    if (!Array.isArray(layer.weights) || !Array.isArray(layer.bias)) return null;
    if (layer.weights.length !== inputSize * outputSize) return null;
    if (layer.bias.length !== outputSize) return null;

    if (!isActivation(layer.activation)) return null;
    const weights = layer.weights as unknown[];
    const bias = layer.bias as unknown[];
    for (const value of weights) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    }
    for (const value of bias) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    }

    layers.push({
      inputSize,
      outputSize,
      weights: [...(layer.weights as number[])],
      bias: [...(layer.bias as number[])],
      activation: layer.activation,
    });
  }

  if (layers.length === 0) return null;
  if (layers[layers.length - 1].outputSize !== 1) return null;

  let outputActivation: StrategoActivation = 'tanh';
  if (candidate.outputActivation !== undefined) {
    if (!isActivation(candidate.outputActivation)) return null;
    outputActivation = candidate.outputActivation;
  }

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: STRATEGO_MLP_MODEL_VERSION,
    kind: 'mlp',
    featureNames: [...featureNames] as string[],
    layers,
    outputActivation,
    training,
  };
}

function parseTrainingInfo(input: unknown): StrategoModelTrainingInfo | null {
  if (!input || typeof input !== 'object') return null;
  const training = input as Record<string, unknown>;

  if (typeof training.generatedAt !== 'string') return null;
  if (typeof training.games !== 'number' || !Number.isFinite(training.games)) return null;
  if (
    typeof training.positionSamples !== 'number'
    || !Number.isFinite(training.positionSamples)
  ) return null;
  if (typeof training.epochs !== 'number' || !Number.isFinite(training.epochs)) return null;
  if (!isDifficulty(training.difficulty)) return null;

  const parsed: StrategoModelTrainingInfo = {
    generatedAt: training.generatedAt,
    games: training.games,
    positionSamples: training.positionSamples,
    epochs: training.epochs,
    difficulty: training.difficulty,
  };

  if (typeof training.framework === 'string') parsed.framework = training.framework;
  if (typeof training.device === 'string') parsed.device = training.device;
  if (typeof training.batchSize === 'number' && Number.isFinite(training.batchSize)) {
    parsed.batchSize = training.batchSize;
  }
  if (typeof training.learningRate === 'number' && Number.isFinite(training.learningRate)) {
    parsed.learningRate = training.learningRate;
  }
  if (typeof training.workers === 'number' && Number.isFinite(training.workers)) {
    parsed.workers = training.workers;
  }
  if (Array.isArray(training.hiddenLayers)) {
    const hidden = training.hiddenLayers.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    );
    parsed.hiddenLayers = hidden;
  }

  return parsed;
}

function isDifficulty(value: unknown): value is StrategoDifficultyLabel {
  return value === 'medium' || value === 'hard' || value === 'extreme' || value === 'mixed';
}

function isActivation(value: unknown): value is StrategoActivation {
  return value === 'linear' || value === 'tanh' || value === 'relu';
}

function isMlpModel(model: StrategoModel): model is StrategoMlpModel {
  return model.kind === 'mlp';
}

function getPieces(state: LocalStrategoState, color: TeamColor): Piece[] {
  return color === 'red' ? state.redPieces : state.bluePieces;
}

function flipColor(color: TeamColor): TeamColor {
  return color === 'red' ? 'blue' : 'red';
}

function rankCounts(pieces: Piece[]): Record<PieceRank, number> {
  const counts: Record<PieceRank, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
    10: 0,
    11: 0,
  };

  for (const piece of pieces) {
    counts[piece.rank] += 1;
  }

  return counts;
}

function pieceMaterial(pieces: Piece[]): number {
  let total = 0;
  for (const piece of pieces) {
    total += PIECE_VALUES[piece.rank];
    if (!piece.revealed && piece.rank >= 8) {
      total += 8;
    }
  }
  return total;
}

function movablePieceCount(pieces: Piece[]): number {
  let count = 0;
  for (const piece of pieces) {
    if (piece.rank !== 0 && piece.rank !== 11) count += 1;
  }
  return count;
}

function highRankCount(pieces: Piece[]): number {
  let count = 0;
  for (const piece of pieces) {
    if (piece.rank >= 8 && piece.rank <= 10) count += 1;
  }
  return count;
}

function hiddenHighRankCount(pieces: Piece[]): number {
  let count = 0;
  for (const piece of pieces) {
    if (!piece.revealed && piece.rank >= 8 && piece.rank <= 10) count += 1;
  }
  return count;
}

function revealedRatio(pieces: Piece[]): number {
  if (pieces.length === 0) return 0;
  let revealed = 0;
  for (const piece of pieces) {
    if (piece.revealed) revealed += 1;
  }
  return revealed / pieces.length;
}

function advancementScore(pieces: Piece[], color: TeamColor): number {
  const movable = pieces.filter((piece) => piece.rank !== 0 && piece.rank !== 11);
  if (movable.length === 0) return 0;

  let total = 0;
  for (const piece of movable) {
    const progress = color === 'red' ? (9 - piece.row) / 9 : piece.row / 9;
    const weight = piece.rank <= 3 ? 1 : 0.7;
    total += progress * weight;
  }

  return total / movable.length;
}

function frontlinePresence(pieces: Piece[], color: TeamColor): number {
  let count = 0;
  for (const piece of pieces) {
    if (piece.rank === 0 || piece.rank === 11) continue;
    if (color === 'red' && piece.row <= 4) count += 1;
    if (color === 'blue' && piece.row >= 5) count += 1;
  }
  return count;
}

function centerControlScore(pieces: Piece[]): number {
  let total = 0;
  for (const piece of pieces) {
    const distance = Math.abs(4.5 - piece.row) + Math.abs(4.5 - piece.col);
    const contribution = Math.max(0, 4.8 - distance);
    if (piece.rank === 0 || piece.rank === 11) {
      total += contribution * 0.3;
    } else {
      total += contribution;
    }
  }
  return total;
}

function findFlag(pieces: Piece[]): Piece | undefined {
  return pieces.find((piece) => piece.rank === 0);
}

function flagGuardScore(pieces: Piece[]): number {
  const flag = findFlag(pieces);
  if (!flag) return -2;

  let guard = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const row = flag.row + dr;
    const col = flag.col + dc;
    const piece = pieces.find((candidate) => candidate.row === row && candidate.col === col);
    if (!piece) continue;
    if (piece.rank === 11) guard += 2;
    else if (piece.rank >= 7) guard += 1.1;
    else if (piece.rank >= 4) guard += 0.6;
    else guard += 0.3;
  }

  if (flag.row === 0 || flag.row === 9) guard += 0.6;
  if (flag.col === 0 || flag.col === 9) guard += 0.4;
  return guard;
}

function flagPressureScore(pieces: Piece[], enemyFlag: Piece | undefined): number {
  if (!enemyFlag) return 0;

  const movable = pieces.filter((piece) => piece.rank !== 0 && piece.rank !== 11);
  if (movable.length === 0) return -1;

  let total = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const piece of movable) {
    const distance = Math.abs(piece.row - enemyFlag.row) + Math.abs(piece.col - enemyFlag.col);
    bestDistance = Math.min(bestDistance, distance);
    total += 1 / (distance + 1);
  }

  const averagePressure = total / movable.length;
  const closestPressure = 1 / (bestDistance + 1);
  return averagePressure * 0.6 + closestPressure * 0.4;
}

function gamePhaseFeature(turnNumber: number): number {
  return Math.tanh((turnNumber - 42) / 35);
}
