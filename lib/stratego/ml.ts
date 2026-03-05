import type { LocalStrategoState } from './ai';
import type { MoveHistoryEntry, Piece, PieceRank, TeamColor } from './types';
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
  policySamples?: number;
  weightDecay?: number;
  policyWeight?: number;
  valueWeight?: number;
}

export const STRATEGO_LINEAR_MODEL_VERSION = 1;
export const STRATEGO_MLP_MODEL_VERSION = 2;
export const STRATEGO_POLICY_VALUE_MODEL_VERSION = 3;
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

export interface StrategoPolicyValueHead {
  inputSize: number;
  outputSize: number;
  weights: readonly number[];
  bias: readonly number[];
  activation?: StrategoActivation;
}

export interface StrategoPolicyValueMlpModel {
  version: number;
  kind: 'policy_value_mlp';
  featureNames: readonly string[];
  actionSpace: number;
  trunk: readonly StrategoMlpLayer[];
  valueHead: StrategoPolicyValueHead;
  policyHead: StrategoPolicyValueHead;
  training: StrategoModelTrainingInfo;
}

export type StrategoModel = StrategoLinearModel | StrategoMlpModel | StrategoPolicyValueMlpModel;

export interface StrategoPolicyMove {
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
}

interface OpponentBeliefFeatures {
  unknownRatio: number;
  unknownMovedRatio: number;
  unknownBacklineUnmovedRatio: number;
  mustScoutRatio: number;
  recentLongMoveRate: number;
  recentAttackRate: number;
  unknownEntropy: number;
  unknownStrength: number;
  rankProbabilities: Record<PieceRank, number>;
}

const STRATEGO_BASE_FEATURE_NAMES = [
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

const STRATEGO_BELIEF_FEATURE_NAMES = [
  'belief_opp_unknown_ratio',
  'belief_opp_unknown_moved_ratio',
  'belief_opp_unknown_backline_unmoved_ratio',
  'belief_opp_must_scout_ratio',
  'belief_opp_recent_long_move_rate',
  'belief_opp_recent_attack_rate',
  'belief_opp_unknown_entropy',
  'belief_opp_unknown_strength',
  'belief_opp_prob_rank_0',
  'belief_opp_prob_rank_1',
  'belief_opp_prob_rank_2',
  'belief_opp_prob_rank_3',
  'belief_opp_prob_rank_4',
  'belief_opp_prob_rank_5',
  'belief_opp_prob_rank_6',
  'belief_opp_prob_rank_7',
  'belief_opp_prob_rank_8',
  'belief_opp_prob_rank_9',
  'belief_opp_prob_rank_10',
  'belief_opp_prob_rank_11',
] as const;

export const STRATEGO_LEGACY_FEATURE_NAMES = STRATEGO_BASE_FEATURE_NAMES;
export const STRATEGO_FEATURE_NAMES = [
  ...STRATEGO_BASE_FEATURE_NAMES,
  ...STRATEGO_BELIEF_FEATURE_NAMES,
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
const MOVABLE_PIECE_RANKS: PieceRank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const HISTORY_FEATURE_WINDOW = 12;

const BELIEF_RANK_STRENGTH: Record<PieceRank, number> = {
  0: 0,
  1: 0.25,
  2: 0.2,
  3: 0.3,
  4: 0.4,
  5: 0.5,
  6: 0.6,
  7: 0.7,
  8: 0.8,
  9: 0.9,
  10: 1,
  11: 0.1,
};

const MAX_MATERIAL_PER_SIDE = PIECE_RANKS.reduce<number>(
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

const FEATURE_INDEX_BY_NAME = new Map<string, number>(
  STRATEGO_FEATURE_NAMES.map((name, index) => [name, index]),
);

const SUPPORTED_FEATURE_SCHEMAS: readonly (readonly string[])[] = [
  STRATEGO_LEGACY_FEATURE_NAMES,
  STRATEGO_FEATURE_NAMES,
];

const ACTIVE_MODEL = parseModel(trainedModelData) ?? DEFAULT_MODEL;

export function getActiveStrategoModel(): StrategoModel {
  return ACTIVE_MODEL;
}

export function parseStrategoModel(input: unknown): StrategoModel | null {
  return parseModel(input);
}

export function extractStrategoFeatures(
  state: LocalStrategoState,
  perspective: TeamColor,
): number[] {
  const opponentColor = flipColor(perspective);
  const myPieces = getPieces(state, perspective);
  const oppPieces = getPieces(state, opponentColor);

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
  const belief = buildOpponentBeliefFeatures(state, oppPieces, opponentColor);
  featureVector.push(belief.unknownRatio);
  featureVector.push(belief.unknownMovedRatio);
  featureVector.push(belief.unknownBacklineUnmovedRatio);
  featureVector.push(belief.mustScoutRatio);
  featureVector.push(belief.recentLongMoveRate);
  featureVector.push(belief.recentAttackRate);
  featureVector.push(belief.unknownEntropy);
  featureVector.push(belief.unknownStrength);
  for (const rank of PIECE_RANKS) {
    featureVector.push(belief.rankProbabilities[rank]);
  }

  return featureVector;
}

export function evaluateStrategoModel(
  state: LocalStrategoState,
  perspective: TeamColor,
  model: StrategoModel = ACTIVE_MODEL,
): number {
  const features = extractStrategoFeaturesForModel(state, perspective, model);
  if (isPolicyValueModel(model)) {
    return evaluatePolicyValueModel(features, model).value;
  }
  if (isMlpModel(model)) {
    return evaluateMlp(features, model);
  }

  let sum = model.bias;
  for (let index = 0; index < features.length; index += 1) {
    sum += model.weights[index] * features[index];
  }
  return Math.tanh(sum);
}

export function evaluateStrategoPolicyLogitsForMoves(
  state: LocalStrategoState,
  perspective: TeamColor,
  moves: readonly StrategoPolicyMove[],
  model: StrategoModel = ACTIVE_MODEL,
): number[] | null {
  if (!isPolicyValueModel(model)) return null;
  if (moves.length === 0) return [];

  const features = extractStrategoFeaturesForModel(state, perspective, model);
  const evaluation = evaluatePolicyValueModel(features, model);
  const trunk = evaluation.trunkActivations;
  const logits = new Array<number>(moves.length).fill(Number.NEGATIVE_INFINITY);
  let hasFiniteLogit = false;

  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    const actionIndex = encodeStrategoActionIndex(move);
    if (actionIndex < 0 || actionIndex >= model.actionSpace) continue;
    if (actionIndex >= model.policyHead.outputSize) continue;
    const rawLogit = evaluateHeadRow(trunk, model.policyHead, actionIndex);
    const activatedLogit = applyActivation(rawLogit, model.policyHead.activation ?? 'linear');
    if (!Number.isFinite(activatedLogit)) continue;
    logits[index] = activatedLogit;
    hasFiniteLogit = true;
  }

  return hasFiniteLogit ? logits : null;
}

export function blendHeuristicWithModel(
  state: LocalStrategoState,
  perspective: TeamColor,
  heuristicScore: number,
  model: StrategoModel = ACTIVE_MODEL,
): number {
  const sampleCount = model.training.positionSamples;
  if (sampleCount < 1500) return heuristicScore;

  const modelScore = evaluateStrategoModel(state, perspective, model) * 5200;
  const baseBlend = Math.min(0.55, 0.25 + Math.log10(sampleCount + 10) * 0.07);
  const blendWeight = isMlpModel(model) || isPolicyValueModel(model)
    ? Math.min(0.68, baseBlend + 0.08)
    : baseBlend;

  return heuristicScore * (1 - blendWeight) + modelScore * blendWeight;
}

function extractStrategoFeaturesForModel(
  state: LocalStrategoState,
  perspective: TeamColor,
  model: StrategoModel,
): number[] {
  const fullFeatureVector = extractStrategoFeatures(state, perspective);
  return mapFeatureVectorToSchema(fullFeatureVector, model.featureNames);
}

function mapFeatureVectorToSchema(
  fullFeatureVector: readonly number[],
  schema: readonly string[],
): number[] {
  if (
    schema.length === STRATEGO_FEATURE_NAMES.length
    && schema.every((name, index) => name === STRATEGO_FEATURE_NAMES[index])
  ) {
    return [...fullFeatureVector];
  }

  const features = new Array<number>(schema.length).fill(0);
  for (let index = 0; index < schema.length; index += 1) {
    const fullIndex = FEATURE_INDEX_BY_NAME.get(schema[index]);
    if (fullIndex === undefined) continue;
    features[index] = fullFeatureVector[fullIndex] ?? 0;
  }
  return features;
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

function evaluatePolicyValueModel(
  features: number[],
  model: StrategoPolicyValueMlpModel,
): { value: number; trunkActivations: number[] } {
  const trunkActivations = forwardLayers(features, model.trunk);
  const rawValue = evaluateHeadRow(trunkActivations, model.valueHead, 0);
  const activatedValue = applyActivation(rawValue, model.valueHead.activation ?? 'tanh');
  const clippedValue = Number.isFinite(activatedValue)
    ? Math.max(-1, Math.min(1, activatedValue))
    : 0;
  return {
    value: clippedValue,
    trunkActivations,
  };
}

function forwardLayers(features: number[], layers: readonly StrategoMlpLayer[]): number[] {
  let activations = features;
  for (const layer of layers) {
    const next = new Array<number>(layer.outputSize).fill(0);
    for (let outIndex = 0; outIndex < layer.outputSize; outIndex += 1) {
      let sum = layer.bias[outIndex] ?? 0;
      const offset = outIndex * layer.inputSize;
      for (let inIndex = 0; inIndex < layer.inputSize; inIndex += 1) {
        sum += (layer.weights[offset + inIndex] ?? 0) * (activations[inIndex] ?? 0);
      }
      next[outIndex] = applyActivation(sum, layer.activation);
    }
    activations = next;
  }
  return activations;
}

function evaluateHeadRow(
  input: readonly number[],
  head: StrategoPolicyValueHead,
  rowIndex: number,
): number {
  const inputSize = head.inputSize;
  const offset = rowIndex * inputSize;
  let sum = head.bias[rowIndex] ?? 0;
  for (let inIndex = 0; inIndex < inputSize; inIndex += 1) {
    sum += (head.weights[offset + inIndex] ?? 0) * (input[inIndex] ?? 0);
  }
  return sum;
}

function encodeStrategoActionIndex(
  move: { fromRow: number; fromCol: number; toRow: number; toCol: number },
): number {
  const from = move.fromRow * 10 + move.fromCol;
  const to = move.toRow * 10 + move.toCol;
  return from * 100 + to;
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

  if (candidate.kind === 'policy_value_mlp') {
    return parsePolicyValueModel(candidate);
  }

  if (candidate.kind === 'mlp' || candidate.version === STRATEGO_MLP_MODEL_VERSION) {
    return parseMlpModel(candidate);
  }

  return parseLinearModel(candidate);
}

function parseLinearModel(candidate: Record<string, unknown>): StrategoLinearModel | null {
  if (candidate.version !== STRATEGO_LINEAR_MODEL_VERSION) return null;
  if (candidate.kind && candidate.kind !== 'linear') return null;
  if (!Array.isArray(candidate.weights)) return null;
  if (typeof candidate.bias !== 'number' || !Number.isFinite(candidate.bias)) return null;

  const featureNames = parseFeatureNames(candidate.featureNames);
  if (!featureNames) return null;
  const weights = candidate.weights;

  if (weights.length !== featureNames.length) return null;

  for (let index = 0; index < weights.length; index += 1) {
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
  if (!Array.isArray(candidate.layers)) return null;

  const featureNames = parseFeatureNames(candidate.featureNames);
  if (!featureNames) return null;

  const layers = parseLayers(candidate.layers, featureNames.length);
  if (!layers) return null;

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

function parsePolicyValueModel(candidate: Record<string, unknown>): StrategoPolicyValueMlpModel | null {
  if (candidate.kind !== 'policy_value_mlp') return null;
  if (!Array.isArray(candidate.trunk)) return null;
  if (
    !Number.isInteger(candidate.actionSpace)
    || (candidate.actionSpace as number) <= 0
  ) {
    return null;
  }
  if (!candidate.valueHead || typeof candidate.valueHead !== 'object') return null;
  if (!candidate.policyHead || typeof candidate.policyHead !== 'object') return null;

  const featureNames = parseFeatureNames(candidate.featureNames);
  if (!featureNames) return null;

  const trunk = parseLayers(candidate.trunk, featureNames.length);
  if (!trunk || trunk.length === 0) return null;
  const trunkOutputSize = trunk[trunk.length - 1].outputSize;

  const valueHead = parsePolicyValueHead(candidate.valueHead as Record<string, unknown>, trunkOutputSize);
  if (!valueHead) return null;
  if (valueHead.outputSize !== 1) return null;

  const policyHead = parsePolicyValueHead(
    candidate.policyHead as Record<string, unknown>,
    trunkOutputSize,
  );
  if (!policyHead) return null;

  const actionSpace = candidate.actionSpace as number;
  if (policyHead.outputSize !== actionSpace) return null;

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: typeof candidate.version === 'number' ? candidate.version : STRATEGO_POLICY_VALUE_MODEL_VERSION,
    kind: 'policy_value_mlp',
    featureNames: [...featureNames] as string[],
    actionSpace,
    trunk,
    valueHead,
    policyHead,
    training,
  };
}

function parseFeatureNames(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const featureNames: string[] = [];
  for (const name of input) {
    if (typeof name !== 'string') return null;
    featureNames.push(name);
  }

  for (const schema of SUPPORTED_FEATURE_SCHEMAS) {
    if (schema.length !== featureNames.length) continue;
    let matches = true;
    for (let index = 0; index < schema.length; index += 1) {
      if (featureNames[index] !== schema[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return featureNames;
  }

  return null;
}

function parseLayers(rawLayers: unknown[], expectedInput: number): StrategoMlpLayer[] | null {
  const layers: StrategoMlpLayer[] = [];
  let nextInput = expectedInput;

  for (const rawLayer of rawLayers) {
    if (!rawLayer || typeof rawLayer !== 'object') return null;
    const layer = rawLayer as Record<string, unknown>;

    if (!Number.isInteger(layer.inputSize) || !Number.isInteger(layer.outputSize)) return null;
    if (!Array.isArray(layer.weights) || !Array.isArray(layer.bias)) return null;
    if (!isActivation(layer.activation)) return null;

    const inputSize = layer.inputSize as number;
    const outputSize = layer.outputSize as number;
    if (inputSize !== nextInput || inputSize <= 0 || outputSize <= 0) return null;
    if (layer.weights.length !== inputSize * outputSize) return null;
    if (layer.bias.length !== outputSize) return null;

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
    nextInput = outputSize;
  }

  return layers;
}

function parsePolicyValueHead(
  rawHead: Record<string, unknown>,
  expectedInputSize: number,
): StrategoPolicyValueHead | null {
  if (!Number.isInteger(rawHead.inputSize) || !Number.isInteger(rawHead.outputSize)) return null;
  if (!Array.isArray(rawHead.weights) || !Array.isArray(rawHead.bias)) return null;

  const inputSize = rawHead.inputSize as number;
  const outputSize = rawHead.outputSize as number;
  if (inputSize !== expectedInputSize || inputSize <= 0 || outputSize <= 0) return null;
  if (rawHead.weights.length !== inputSize * outputSize) return null;
  if (rawHead.bias.length !== outputSize) return null;
  if (!rawHead.weights.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  if (!rawHead.bias.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;

  let activation: StrategoActivation | undefined;
  if (rawHead.activation !== undefined) {
    if (!isActivation(rawHead.activation)) return null;
    activation = rawHead.activation;
  }

  return {
    inputSize,
    outputSize,
    weights: [...(rawHead.weights as number[])],
    bias: [...(rawHead.bias as number[])],
    activation,
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
  if (typeof training.weightDecay === 'number' && Number.isFinite(training.weightDecay)) {
    parsed.weightDecay = training.weightDecay;
  }
  if (typeof training.workers === 'number' && Number.isFinite(training.workers)) {
    parsed.workers = training.workers;
  }
  if (typeof training.policySamples === 'number' && Number.isFinite(training.policySamples)) {
    parsed.policySamples = training.policySamples;
  }
  if (typeof training.policyWeight === 'number' && Number.isFinite(training.policyWeight)) {
    parsed.policyWeight = training.policyWeight;
  }
  if (typeof training.valueWeight === 'number' && Number.isFinite(training.valueWeight)) {
    parsed.valueWeight = training.valueWeight;
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

function isPolicyValueModel(model: StrategoModel): model is StrategoPolicyValueMlpModel {
  return model.kind === 'policy_value_mlp';
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

function buildOpponentBeliefFeatures(
  state: LocalStrategoState,
  opponentPieces: Piece[],
  opponentColor: TeamColor,
): OpponentBeliefFeatures {
  const unknownPieces = opponentPieces.filter((piece) => !piece.revealed);
  const knowledgeByPiece = inferPieceKnowledgeFromHistory(state.moveHistory, opponentColor);
  const recentRates = collectRecentOpponentMoveRates(state.moveHistory, opponentColor);
  const remainingCounts = buildRemainingOpponentRankCounts(state, opponentPieces, opponentColor);

  const rankProbabilitySums: Record<PieceRank, number> = {
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

  let unknownMovedCount = 0;
  let unknownBacklineUnmovedCount = 0;
  let unknownMustScoutCount = 0;

  for (const piece of unknownPieces) {
    const knowledge = knowledgeByPiece.get(piece.id) ?? { hasMoved: false, mustBeScout: false };
    if (knowledge.hasMoved) unknownMovedCount += 1;
    if (!knowledge.hasMoved && isBacklineRowForColor(piece.row, opponentColor)) {
      unknownBacklineUnmovedCount += 1;
    }
    if (knowledge.mustBeScout) unknownMustScoutCount += 1;

    const pieceRankProbabilities = buildUnknownPieceRankProbabilities(knowledge, remainingCounts);
    for (const rank of PIECE_RANKS) {
      rankProbabilitySums[rank] += pieceRankProbabilities[rank];
    }
  }

  const unknownCount = unknownPieces.length;
  const rankProbabilities: Record<PieceRank, number> = {
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

  if (unknownCount > 0) {
    for (const rank of PIECE_RANKS) {
      rankProbabilities[rank] = clamp01(rankProbabilitySums[rank] / unknownCount);
    }
  }

  let unknownEntropy = 0;
  if (unknownCount > 0) {
    for (const rank of PIECE_RANKS) {
      const probability = rankProbabilities[rank];
      if (probability <= 0) continue;
      unknownEntropy -= probability * Math.log(probability);
    }
    const maxEntropy = Math.log(PIECE_RANKS.length);
    if (maxEntropy > 0) {
      unknownEntropy = clamp01(unknownEntropy / maxEntropy);
    } else {
      unknownEntropy = 0;
    }
  }

  let unknownStrength = 0;
  for (const rank of PIECE_RANKS) {
    unknownStrength += rankProbabilities[rank] * BELIEF_RANK_STRENGTH[rank];
  }

  const opponentPieceTotal = Math.max(1, opponentPieces.length);
  const denominator = Math.max(1, unknownCount);
  return {
    unknownRatio: clamp01(unknownCount / opponentPieceTotal),
    unknownMovedRatio: unknownCount > 0 ? clamp01(unknownMovedCount / denominator) : 0,
    unknownBacklineUnmovedRatio: unknownCount > 0 ? clamp01(unknownBacklineUnmovedCount / denominator) : 0,
    mustScoutRatio: unknownCount > 0 ? clamp01(unknownMustScoutCount / denominator) : 0,
    recentLongMoveRate: recentRates.longMoveRate,
    recentAttackRate: recentRates.attackRate,
    unknownEntropy,
    unknownStrength: clamp01(unknownStrength),
    rankProbabilities,
  };
}

function inferPieceKnowledgeFromHistory(
  history: readonly MoveHistoryEntry[],
  opponentColor: TeamColor,
): Map<string, { hasMoved: boolean; mustBeScout: boolean }> {
  const knowledge = new Map<string, { hasMoved: boolean; mustBeScout: boolean }>();

  for (const move of history) {
    if (move.color !== opponentColor) continue;

    const travelDistance = Math.abs(move.to_row - move.from_row) + Math.abs(move.to_col - move.from_col);
    if (travelDistance <= 0) continue;

    const current = knowledge.get(move.piece_id) ?? { hasMoved: false, mustBeScout: false };
    current.hasMoved = true;
    if (travelDistance > 1) current.mustBeScout = true;
    knowledge.set(move.piece_id, current);
  }

  return knowledge;
}

function collectRecentOpponentMoveRates(
  history: readonly MoveHistoryEntry[],
  opponentColor: TeamColor,
): { longMoveRate: number; attackRate: number } {
  const opponentMoves = history.filter((entry) => entry.color === opponentColor);
  const window = opponentMoves.slice(-HISTORY_FEATURE_WINDOW);
  if (window.length === 0) {
    return { longMoveRate: 0, attackRate: 0 };
  }

  let longMoveCount = 0;
  let attackCount = 0;
  for (const move of window) {
    const distance = Math.abs(move.to_row - move.from_row) + Math.abs(move.to_col - move.from_col);
    if (distance > 1) longMoveCount += 1;
    if (move.combat_result !== null) attackCount += 1;
  }

  return {
    longMoveRate: clamp01(longMoveCount / window.length),
    attackRate: clamp01(attackCount / window.length),
  };
}

function buildRemainingOpponentRankCounts(
  state: LocalStrategoState,
  opponentPieces: Piece[],
  opponentColor: TeamColor,
): Record<PieceRank, number> {
  const capturedOpponent = opponentColor === 'red'
    ? state.redCaptured
    : state.blueCaptured;

  const remainingCounts: Record<PieceRank, number> = {
    0: PIECE_COUNTS_BY_RANK[0],
    1: PIECE_COUNTS_BY_RANK[1],
    2: PIECE_COUNTS_BY_RANK[2],
    3: PIECE_COUNTS_BY_RANK[3],
    4: PIECE_COUNTS_BY_RANK[4],
    5: PIECE_COUNTS_BY_RANK[5],
    6: PIECE_COUNTS_BY_RANK[6],
    7: PIECE_COUNTS_BY_RANK[7],
    8: PIECE_COUNTS_BY_RANK[8],
    9: PIECE_COUNTS_BY_RANK[9],
    10: PIECE_COUNTS_BY_RANK[10],
    11: PIECE_COUNTS_BY_RANK[11],
  };

  for (const piece of capturedOpponent) {
    remainingCounts[piece.rank] = Math.max(0, remainingCounts[piece.rank] - 1);
  }

  for (const piece of opponentPieces) {
    if (!piece.revealed) continue;
    remainingCounts[piece.rank] = Math.max(0, remainingCounts[piece.rank] - 1);
  }

  const inferredKnowledge = inferPieceKnowledgeFromHistory(state.moveHistory, opponentColor);
  for (const piece of opponentPieces) {
    if (piece.revealed) continue;
    const knowledge = inferredKnowledge.get(piece.id);
    if (!knowledge?.mustBeScout) continue;
    remainingCounts[2] = Math.max(0, remainingCounts[2] - 1);
  }

  return remainingCounts;
}

function buildUnknownPieceRankProbabilities(
  knowledge: { hasMoved: boolean; mustBeScout: boolean },
  remainingCounts: Record<PieceRank, number>,
): Record<PieceRank, number> {
  const probabilities: Record<PieceRank, number> = {
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

  let candidates: PieceRank[] = PIECE_RANKS;
  if (knowledge.mustBeScout) {
    probabilities[2] = 1;
    return probabilities;
  }
  if (knowledge.hasMoved) {
    candidates = MOVABLE_PIECE_RANKS;
  }

  let totalWeight = 0;
  for (const rank of candidates) {
    totalWeight += Math.max(0, remainingCounts[rank]);
  }

  if (totalWeight <= 0) {
    const uniformProbability = 1 / candidates.length;
    for (const rank of candidates) {
      probabilities[rank] = uniformProbability;
    }
    return probabilities;
  }

  for (const rank of candidates) {
    probabilities[rank] = Math.max(0, remainingCounts[rank]) / totalWeight;
  }
  return probabilities;
}

function isBacklineRowForColor(row: number, color: TeamColor): boolean {
  if (color === 'red') return row >= 7;
  return row <= 2;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function gamePhaseFeature(turnNumber: number): number {
  return Math.tanh((turnNumber - 42) / 35);
}
