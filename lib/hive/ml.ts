import type { GameState, Move, PieceType, PlacedPiece, PlayerColor } from './types';
import { coordKey, getNeighbors, hexDistance } from './hexUtils';
import { getQueenSurroundCount } from './winCondition';
import { moveToActionKey, pieceTypeFromPieceId } from './actionEncoding';

export type HiveDifficultyLabel = 'medium' | 'hard' | 'extreme' | 'mixed';

export interface HiveModelTrainingInfo {
  generatedAt: string;
  games: number;
  positionSamples: number;
  epochs: number;
  difficulty: HiveDifficultyLabel;
  framework?: string;
  device?: string;
  batchSize?: number;
  learningRate?: number;
  workers?: number;
  hiddenLayers?: number[];
  policyLossWeight?: number;
  valueLossWeight?: number;
  auxLossWeight?: number;
  reanalyseRatio?: number;
}

export const HIVE_LINEAR_MODEL_VERSION = 1;
export const HIVE_MLP_MODEL_VERSION = 2;
export const HIVE_POLICY_VALUE_MODEL_VERSION = 6;
export const HIVE_POLICY_VALUE_MODEL_PREVIOUS_VERSION = 5;
export const HIVE_POLICY_VALUE_MODEL_LEGACY_VERSION = 4;
export const HIVE_POLICY_VALUE_MODEL_OLDEST_VERSION = 3;

export type HiveActivation = 'linear' | 'tanh' | 'relu';

export interface HiveLinearModel {
  version: typeof HIVE_LINEAR_MODEL_VERSION;
  kind?: 'linear';
  featureNames: readonly string[];
  weights: readonly number[];
  bias: number;
  training: HiveModelTrainingInfo;
}

export interface HiveMlpLayer {
  inputSize: number;
  outputSize: number;
  weights: readonly number[];
  bias: readonly number[];
  activation: HiveActivation;
}

export interface HiveMlpModel {
  version: typeof HIVE_MLP_MODEL_VERSION;
  kind: 'mlp';
  featureNames: readonly string[];
  layers: readonly HiveMlpLayer[];
  outputActivation?: HiveActivation;
  training: HiveModelTrainingInfo;
}

export interface HivePolicyValueLinearHead {
  weights: readonly number[];
  bias: number;
  activation?: HiveActivation;
}

export interface HivePolicyHead {
  actionWeights?: readonly number[];
  contextWeights?: readonly number[];
  stateWeights?: readonly number[];
  inputHiddenSize?: number;
  hiddenSize?: number;
  inputWeights?: readonly number[];
  inputBias?: readonly number[];
  hiddenWeights?: readonly number[];
  hiddenLayerBias?: readonly number[];
  stateHiddenWeights?: readonly number[];
  actionHiddenWeights?: readonly number[];
  hiddenBias?: readonly number[];
  outputWeights?: readonly number[];
  bias: number;
  actionScale?: number;
}

export interface HivePolicyValueModel {
  version: number;
  kind: 'policy_value';
  stateFeatureNames: readonly string[];
  actionFeatureNames: readonly string[];
  stateTrunk: readonly HiveMlpLayer[];
  valueHead: HivePolicyValueLinearHead;
  policyHead: HivePolicyHead;
  training: HiveModelTrainingInfo;
}

export type HiveModel = HiveLinearModel | HiveMlpModel | HivePolicyValueModel;

export interface HivePolicyValueEvaluation {
  value: number;
  actionLogitsByKey: Record<string, number>;
  policyEntropy: number;
  auxiliary: {
    queenSurroundDelta: number;
    mobility: number;
    lengthBucketLogits: number[];
  };
}

// Keep Stratego-like labels for v1/v2 model compatibility.
export const HIVE_FEATURE_NAMES = [
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

export const HIVE_ACTION_FEATURE_NAMES = [
  'is_place',
  'is_move',
  'is_pillbug',
  'piece_queen',
  'piece_beetle',
  'piece_grasshopper',
  'piece_spider',
  'piece_ant',
  'piece_ladybug',
  'piece_mosquito',
  'piece_pillbug',
  'to_q',
  'to_r',
  'to_dist_origin',
  'to_dist_enemy_queen',
  'to_dist_my_queen',
  'my_queen_surround',
  'opp_queen_surround',
  'turn_phase',
  'from_q',
  'from_r',
  'from_dist_origin',
  'from_dist_enemy_queen',
  'from_dist_my_queen',
  'move_distance',
  'to_neighbor_mine',
  'to_neighbor_opp',
  'to_neighbor_empty',
  'to_adj_my_queen',
  'to_adj_opp_queen',
  'to_stack_height',
] as const;

export const HIVE_DEFAULT_TOKEN_SLOTS = 32;

const PIECE_TYPE_ORDER: PieceType[] = [
  'queen',
  'beetle',
  'grasshopper',
  'spider',
  'ant',
  'ladybug',
  'mosquito',
  'pillbug',
];

const DEFAULT_MODEL: HiveLinearModel = {
  version: HIVE_LINEAR_MODEL_VERSION,
  kind: 'linear',
  featureNames: HIVE_FEATURE_NAMES,
  weights: Array.from({ length: HIVE_FEATURE_NAMES.length }, () => 0),
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

const ACTIVE_MODEL = loadDefaultHiveModel();

export function getActiveHiveModel(): HiveModel {
  return ACTIVE_MODEL;
}

export function buildHiveTokenStateFeatureNames(maxTokens = HIVE_DEFAULT_TOKEN_SLOTS): string[] {
  const names: string[] = [];
  for (let index = 0; index < maxTokens; index += 1) {
    names.push(
      `token_${index}_mine`,
      `token_${index}_type`,
      `token_${index}_q`,
      `token_${index}_r`,
      `token_${index}_stack`,
      `token_${index}_dist_center`,
      `token_${index}_dist_enemy_queen`,
      `token_${index}_dist_my_queen`,
    );
  }
  names.push('turn', 'phase', 'my_hand', 'opp_hand', 'my_queen_surround', 'opp_queen_surround');
  return names;
}

const DEFAULT_TOKEN_FEATURE_NAMES = buildHiveTokenStateFeatureNames(HIVE_DEFAULT_TOKEN_SLOTS);

export function extractHiveTokenStateFeatures(
  state: GameState,
  perspective: PlayerColor,
  maxTokens = HIVE_DEFAULT_TOKEN_SLOTS,
): number[] {
  const myQueen = state.board.find((piece) => piece.color === perspective && piece.type === 'queen');
  const oppQueen = state.board.find((piece) => piece.color !== perspective && piece.type === 'queen');
  const sorted = [...state.board].sort((left, right) => left.id.localeCompare(right.id));
  const result: number[] = [];

  for (let index = 0; index < maxTokens; index += 1) {
    const piece = sorted[index];
    if (!piece) {
      result.push(0, 0, 0, 0, 0, 0, 0, 0);
      continue;
    }
    const typeIndex = PIECE_TYPE_ORDER.indexOf(piece.type);
    const distCenter = hexDistance(piece.position, { q: 0, r: 0 });
    const distEnemyQueen = oppQueen ? hexDistance(piece.position, oppQueen.position) : 6;
    const distMyQueen = myQueen ? hexDistance(piece.position, myQueen.position) : 6;
    result.push(
      piece.color === perspective ? 1 : -1,
      clamp(typeIndex / (PIECE_TYPE_ORDER.length - 1), 0, 1),
      Math.tanh(piece.position.q / 5),
      Math.tanh(piece.position.r / 5),
      clamp(piece.stackOrder / 5, 0, 1),
      clamp(1 - distCenter / 10, -1, 1),
      clamp(1 - distEnemyQueen / 8, -1, 1),
      clamp(1 - distMyQueen / 8, -1, 1),
    );
  }

  const myHand = perspective === 'white' ? state.whiteHand.length : state.blackHand.length;
  const oppHand = perspective === 'white' ? state.blackHand.length : state.whiteHand.length;

  result.push(
    state.currentTurn === perspective ? 1 : -1,
    Math.tanh((state.turnNumber - 18) / 10),
    myHand / 14,
    oppHand / 14,
    getQueenSurroundCount(state.board, perspective) / 6,
    getQueenSurroundCount(state.board, flipColor(perspective)) / 6,
  );

  return result.map((value) => (Number.isFinite(value) ? value : 0));
}

export function extractHiveActionFeatures(
  state: GameState,
  move: Move,
  perspective: PlayerColor,
): number[] {
  const pieceType = resolveMovePieceType(state, move);
  const pieceBits = PIECE_TYPE_ORDER.map((type) => (pieceType === type ? 1 : 0));
  const myQueen = state.board.find((piece) => piece.color === perspective && piece.type === 'queen');
  const oppQueen = state.board.find((piece) => piece.color !== perspective && piece.type === 'queen');
  const distCenter = hexDistance(move.to, { q: 0, r: 0 });
  const distEnemyQueen = oppQueen ? hexDistance(move.to, oppQueen.position) : 6;
  const distMyQueen = myQueen ? hexDistance(move.to, myQueen.position) : 6;
  const fromCoord = move.type === 'move' && move.from ? move.from : null;
  const fromDistCenter = fromCoord ? hexDistance(fromCoord, { q: 0, r: 0 }) : 0;
  const fromDistEnemyQueen = fromCoord && oppQueen ? hexDistance(fromCoord, oppQueen.position) : 0;
  const fromDistMyQueen = fromCoord && myQueen ? hexDistance(fromCoord, myQueen.position) : 0;
  const moveDistance = fromCoord ? hexDistance(fromCoord, move.to) : 0;
  const stacksByPosition = new Map<string, { count: number; topColor: PlayerColor }>();
  for (const piece of state.board) {
    const key = `${piece.position.q},${piece.position.r}`;
    const existing = stacksByPosition.get(key);
    if (!existing) {
      stacksByPosition.set(key, { count: 1, topColor: piece.color });
      continue;
    }
    existing.count += 1;
    if (piece.stackOrder >= existing.count - 1) {
      existing.topColor = piece.color;
    }
  }
  let toNeighborMine = 0;
  let toNeighborOpp = 0;
  let toNeighborEmpty = 0;
  for (const neighbor of getNeighbors(move.to)) {
    const stack = stacksByPosition.get(`${neighbor.q},${neighbor.r}`);
    if (!stack) {
      toNeighborEmpty += 1;
    } else if (stack.topColor === perspective) {
      toNeighborMine += 1;
    } else {
      toNeighborOpp += 1;
    }
  }
  const toStackHeight = stacksByPosition.get(`${move.to.q},${move.to.r}`)?.count ?? 0;
  const toAdjMyQueen = myQueen && hexDistance(move.to, myQueen.position) === 1 ? 1 : 0;
  const toAdjOppQueen = oppQueen && hexDistance(move.to, oppQueen.position) === 1 ? 1 : 0;

  return [
    move.type === 'place' ? 1 : 0,
    move.type === 'move' ? 1 : 0,
    move.isPillbugAbility ? 1 : 0,
    ...pieceBits,
    Math.tanh(move.to.q / 5),
    Math.tanh(move.to.r / 5),
    clamp(1 - distCenter / 10, -1, 1),
    clamp(1 - distEnemyQueen / 8, -1, 1),
    clamp(1 - distMyQueen / 8, -1, 1),
    getQueenSurroundCount(state.board, perspective) / 6,
    getQueenSurroundCount(state.board, flipColor(perspective)) / 6,
    Math.tanh((state.turnNumber - 18) / 10),
    fromCoord ? Math.tanh(fromCoord.q / 5) : 0,
    fromCoord ? Math.tanh(fromCoord.r / 5) : 0,
    clamp(1 - fromDistCenter / 10, -1, 1),
    clamp(1 - fromDistEnemyQueen / 8, -1, 1),
    clamp(1 - fromDistMyQueen / 8, -1, 1),
    clamp(moveDistance / 6, 0, 1),
    toNeighborMine / 6,
    toNeighborOpp / 6,
    toNeighborEmpty / 6,
    toAdjMyQueen,
    toAdjOppQueen,
    clamp(toStackHeight / 4, 0, 1),
  ];
}

export function evaluatePolicyValue(
  state: GameState,
  legalMoves: readonly Move[],
  perspective: PlayerColor,
  model: HiveModel = ACTIVE_MODEL,
): HivePolicyValueEvaluation {
  if (isPolicyValueModel(model)) {
    return evaluateV3PolicyValue(state, legalMoves, perspective, model);
  }

  const value = evaluateHiveModel(state, perspective, model);
  const logits: Record<string, number> = {};
  for (const move of legalMoves) {
    const features = extractHiveActionFeatures(state, move, perspective);
    const logit = (features[1] ?? 0) * 0.3 + (features[4] ?? 0) * 0.18 + (features[14] ?? 0) * 0.25;
    logits[moveToActionKey(move)] = logit;
  }

  return {
    value,
    actionLogitsByKey: logits,
    policyEntropy: softmaxEntropy(Object.values(logits)),
    auxiliary: {
      queenSurroundDelta: clamp(
        (getQueenSurroundCount(state.board, flipColor(perspective))
          - getQueenSurroundCount(state.board, perspective)) / 6,
        -1,
        1,
      ),
      mobility: estimateMobility(state, perspective),
      lengthBucketLogits: [0, 0, 0],
    },
  };
}

export function evaluateHiveModel(
  state: GameState,
  perspective: PlayerColor,
  model: HiveModel = ACTIVE_MODEL,
): number {
  if (isPolicyValueModel(model)) {
    return evaluateV3PolicyValue(state, [], perspective, model).value;
  }

  const features = extractHiveFeatures(state, perspective);
  if (isMlpModel(model)) {
    return evaluateMlp(features, model);
  }

  let sum = model.bias;
  for (let index = 0; index < features.length; index += 1) {
    sum += (model.weights[index] ?? 0) * features[index];
  }
  return Math.tanh(sum);
}

export function blendHeuristicWithModel(
  state: GameState,
  perspective: PlayerColor,
  heuristicScore: number,
  model: HiveModel = ACTIVE_MODEL,
): number {
  const sampleCount = model.training.positionSamples;
  if (sampleCount < 1200) return heuristicScore;

  const modelScore = evaluateHiveModel(state, perspective, model) * 1500;
  const baseBlend = Math.min(0.6, 0.25 + Math.log10(sampleCount + 10) * 0.08);
  const blendWeight = isMlpModel(model) || isPolicyValueModel(model)
    ? Math.min(0.72, baseBlend + 0.08)
    : baseBlend;

  return heuristicScore * (1 - blendWeight) + modelScore * blendWeight;
}

export function extractHiveFeatures(state: GameState, perspective: PlayerColor): number[] {
  const opponent = flipColor(perspective);
  const myPieces = state.board.filter((piece) => piece.color === perspective);
  const oppPieces = state.board.filter((piece) => piece.color === opponent);
  const myHand = perspective === 'white' ? state.whiteHand : state.blackHand;
  const oppHand = perspective === 'white' ? state.blackHand : state.whiteHand;

  const myCounts = pieceTypeCounts(myPieces);
  const oppCounts = pieceTypeCounts(oppPieces);
  const myQueenSurround = getQueenSurroundCount(state.board, perspective);
  const oppQueenSurround = getQueenSurroundCount(state.board, opponent);
  const mobilityDiff = estimateMobility(state, perspective);

  const featureVector: number[] = [];
  for (const type of PIECE_TYPE_ORDER) {
    featureVector.push(clamp((myCounts[type] - oppCounts[type]) / 3, -1, 1));
  }

  featureVector.push(
    clamp((myPieces.length - oppPieces.length) / 14, -1, 1),
    clamp((myHand.length - oppHand.length) / 14, -1, 1),
    mobilityDiff,
    0,
    clamp((oppQueenSurround - myQueenSurround) / 6, -1, 1),
    mobilityDiff,
    mobilityDiff,
    clamp((myPieces.length + oppPieces.length) / 24, 0, 1),
    clamp((oppQueenSurround - myQueenSurround) / 6, -1, 1),
    clamp((myPieces.length - oppPieces.length) / 14, -1, 1),
    0,
    0,
    clamp((myQueenSurround - oppQueenSurround) / 6, -1, 1),
    0,
    0,
    0,
    clamp((oppQueenSurround - myQueenSurround) / 6, -1, 1),
    state.currentTurn === perspective ? 1 : -1,
    Math.tanh((state.turnNumber - 14) / 10),
  );

  while (featureVector.length < HIVE_FEATURE_NAMES.length) featureVector.push(0);
  return featureVector.slice(0, HIVE_FEATURE_NAMES.length);
}

export function parseHiveModel(input: unknown): HiveModel | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Record<string, unknown>;

  if (
    candidate.kind === 'policy_value'
    || candidate.version === HIVE_POLICY_VALUE_MODEL_VERSION
    || candidate.version === HIVE_POLICY_VALUE_MODEL_PREVIOUS_VERSION
    || candidate.version === HIVE_POLICY_VALUE_MODEL_LEGACY_VERSION
    || candidate.version === HIVE_POLICY_VALUE_MODEL_OLDEST_VERSION
  ) {
    return parseV6(candidate) ?? parseV5(candidate) ?? parseV4(candidate) ?? parseV3(candidate);
  }
  if (candidate.kind === 'mlp' || candidate.version === HIVE_MLP_MODEL_VERSION) {
    return parseV2(candidate);
  }
  return parseV1(candidate);
}

function loadDefaultHiveModel(): HiveModel {
  const nodeRequire = getNodeRequire();
  if (!nodeRequire) {
    return DEFAULT_MODEL;
  }

  try {
    const fs = nodeRequire('node:fs') as { existsSync: (path: string) => boolean; readFileSync: (path: string, encoding: string) => string };
    const nodePath = nodeRequire('node:path') as { dirname: (value: string) => string; join: (...parts: string[]) => string };
    const nodeUrl = nodeRequire('node:url') as { fileURLToPath: (value: string | URL) => string };
    const currentDir = nodePath.dirname(nodeUrl.fileURLToPath(import.meta.url));
    const defaultModelPath = nodePath.join(currentDir, 'trained-model.json');
    if (!fs.existsSync(defaultModelPath)) {
      return DEFAULT_MODEL;
    }
    const raw = JSON.parse(fs.readFileSync(defaultModelPath, 'utf8')) as unknown;
    return parseHiveModel(raw) ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function getNodeRequire(): ((specifier: string) => unknown) | null {
  if (typeof window !== 'undefined') {
    return null;
  }
  try {
    return Function('return typeof require !== "undefined" ? require : null')() as ((specifier: string) => unknown) | null;
  } catch {
    return null;
  }
}

function parseV1(candidate: Record<string, unknown>): HiveLinearModel | null {
  if (candidate.version !== HIVE_LINEAR_MODEL_VERSION) return null;
  if (candidate.kind !== undefined && candidate.kind !== 'linear') return null;
  if (!Array.isArray(candidate.featureNames) || !Array.isArray(candidate.weights)) return null;
  if (typeof candidate.bias !== 'number' || !Number.isFinite(candidate.bias)) return null;

  if (candidate.featureNames.length !== HIVE_FEATURE_NAMES.length) return null;
  if (candidate.weights.length !== HIVE_FEATURE_NAMES.length) return null;
  if (!candidate.featureNames.every((entry) => typeof entry === 'string')) return null;
  if (!candidate.weights.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: HIVE_LINEAR_MODEL_VERSION,
    kind: 'linear',
    featureNames: [...candidate.featureNames] as string[],
    weights: [...candidate.weights] as number[],
    bias: candidate.bias,
    training,
  };
}

function parseV2(candidate: Record<string, unknown>): HiveMlpModel | null {
  if (candidate.version !== HIVE_MLP_MODEL_VERSION) return null;
  if (candidate.kind !== 'mlp') return null;
  if (!Array.isArray(candidate.featureNames) || !Array.isArray(candidate.layers)) return null;
  if (candidate.featureNames.length !== HIVE_FEATURE_NAMES.length) return null;
  if (!candidate.featureNames.every((entry) => typeof entry === 'string')) return null;

  const layers = parseLayers(candidate.layers, HIVE_FEATURE_NAMES.length);
  if (!layers || layers.length === 0) return null;
  if (layers[layers.length - 1].outputSize !== 1) return null;

  let outputActivation: HiveActivation | undefined;
  if (candidate.outputActivation !== undefined) {
    if (!isActivation(candidate.outputActivation)) return null;
    outputActivation = candidate.outputActivation;
  }

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: HIVE_MLP_MODEL_VERSION,
    kind: 'mlp',
    featureNames: [...candidate.featureNames] as string[],
    layers,
    outputActivation: outputActivation ?? 'tanh',
    training,
  };
}

function parseV3(candidate: Record<string, unknown>): HivePolicyValueModel | null {
  if (candidate.version !== HIVE_POLICY_VALUE_MODEL_OLDEST_VERSION) return null;
  if (candidate.kind !== 'policy_value') return null;
  if (!Array.isArray(candidate.stateFeatureNames)) return null;
  if (!Array.isArray(candidate.actionFeatureNames)) return null;
  if (!Array.isArray(candidate.stateTrunk)) return null;
  if (!candidate.valueHead || typeof candidate.valueHead !== 'object') return null;
  if (!candidate.policyHead || typeof candidate.policyHead !== 'object') return null;

  const stateFeatureNames = candidate.stateFeatureNames;
  const actionFeatureNames = candidate.actionFeatureNames;
  if (!stateFeatureNames.every((entry) => typeof entry === 'string')) return null;
  if (!actionFeatureNames.every((entry) => typeof entry === 'string')) return null;

  const trunk = parseLayers(candidate.stateTrunk, stateFeatureNames.length);
  if (!trunk || trunk.length === 0) return null;
  const embeddingSize = trunk[trunk.length - 1].outputSize;

  const valueHead = parseLinearHead(candidate.valueHead as Record<string, unknown>, embeddingSize);
  if (!valueHead) return null;

  const policyHeadRaw = candidate.policyHead as Record<string, unknown>;
  if (!Array.isArray(policyHeadRaw.stateWeights) || !Array.isArray(policyHeadRaw.actionWeights)) {
    return null;
  }
  if (policyHeadRaw.stateWeights.length !== embeddingSize) return null;
  if (policyHeadRaw.actionWeights.length !== actionFeatureNames.length) return null;
  if (typeof policyHeadRaw.bias !== 'number' || !Number.isFinite(policyHeadRaw.bias)) return null;
  if (!policyHeadRaw.stateWeights.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return null;
  }
  if (!policyHeadRaw.actionWeights.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return null;
  }

  let actionScale: number | undefined;
  if (policyHeadRaw.actionScale !== undefined) {
    if (typeof policyHeadRaw.actionScale !== 'number' || !Number.isFinite(policyHeadRaw.actionScale)) {
      return null;
    }
    actionScale = policyHeadRaw.actionScale;
  }

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: HIVE_POLICY_VALUE_MODEL_OLDEST_VERSION,
    kind: 'policy_value',
    stateFeatureNames: [...stateFeatureNames] as string[],
    actionFeatureNames: [...actionFeatureNames] as string[],
    stateTrunk: trunk,
    valueHead,
    policyHead: {
      stateWeights: [...policyHeadRaw.stateWeights] as number[],
      actionWeights: [...policyHeadRaw.actionWeights] as number[],
      bias: policyHeadRaw.bias,
      actionScale,
    },
    training,
  };
}

function parseV4(candidate: Record<string, unknown>): HivePolicyValueModel | null {
  if (candidate.version !== HIVE_POLICY_VALUE_MODEL_LEGACY_VERSION) return null;
  if (candidate.kind !== 'policy_value') return null;
  if (!Array.isArray(candidate.stateFeatureNames)) return null;
  if (!Array.isArray(candidate.actionFeatureNames)) return null;
  if (!Array.isArray(candidate.stateTrunk)) return null;
  if (!candidate.valueHead || typeof candidate.valueHead !== 'object') return null;
  if (!candidate.policyHead || typeof candidate.policyHead !== 'object') return null;

  const stateFeatureNames = candidate.stateFeatureNames;
  const actionFeatureNames = candidate.actionFeatureNames;
  if (!stateFeatureNames.every((entry) => typeof entry === 'string')) return null;
  if (!actionFeatureNames.every((entry) => typeof entry === 'string')) return null;

  const trunk = parseLayers(candidate.stateTrunk, stateFeatureNames.length);
  if (!trunk || trunk.length === 0) return null;
  const embeddingSize = trunk[trunk.length - 1].outputSize;

  const valueHead = parseLinearHead(candidate.valueHead as Record<string, unknown>, embeddingSize);
  if (!valueHead) return null;

  const policyHeadRaw = candidate.policyHead as Record<string, unknown>;
  if (!Array.isArray(policyHeadRaw.actionWeights) || !Array.isArray(policyHeadRaw.contextWeights)) {
    return null;
  }
  if (policyHeadRaw.actionWeights.length !== actionFeatureNames.length) return null;
  if (policyHeadRaw.contextWeights.length !== embeddingSize * actionFeatureNames.length) return null;
  if (typeof policyHeadRaw.bias !== 'number' || !Number.isFinite(policyHeadRaw.bias)) return null;
  if (!policyHeadRaw.actionWeights.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return null;
  }
  if (!policyHeadRaw.contextWeights.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return null;
  }

  let actionScale: number | undefined;
  if (policyHeadRaw.actionScale !== undefined) {
    if (typeof policyHeadRaw.actionScale !== 'number' || !Number.isFinite(policyHeadRaw.actionScale)) {
      return null;
    }
    actionScale = policyHeadRaw.actionScale;
  }

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: HIVE_POLICY_VALUE_MODEL_LEGACY_VERSION,
    kind: 'policy_value',
    stateFeatureNames: [...stateFeatureNames] as string[],
    actionFeatureNames: [...actionFeatureNames] as string[],
    stateTrunk: trunk,
    valueHead,
    policyHead: {
      actionWeights: [...policyHeadRaw.actionWeights] as number[],
      contextWeights: [...policyHeadRaw.contextWeights] as number[],
      bias: policyHeadRaw.bias,
      actionScale,
    },
    training,
  };
}

function parseV5(candidate: Record<string, unknown>): HivePolicyValueModel | null {
  if (candidate.version !== HIVE_POLICY_VALUE_MODEL_PREVIOUS_VERSION) return null;
  if (candidate.kind !== 'policy_value') return null;
  if (!Array.isArray(candidate.stateFeatureNames)) return null;
  if (!Array.isArray(candidate.actionFeatureNames)) return null;
  if (!Array.isArray(candidate.stateTrunk)) return null;
  if (!candidate.valueHead || typeof candidate.valueHead !== 'object') return null;
  if (!candidate.policyHead || typeof candidate.policyHead !== 'object') return null;

  const stateFeatureNames = candidate.stateFeatureNames;
  const actionFeatureNames = candidate.actionFeatureNames;
  if (!stateFeatureNames.every((entry) => typeof entry === 'string')) return null;
  if (!actionFeatureNames.every((entry) => typeof entry === 'string')) return null;

  const trunk = parseLayers(candidate.stateTrunk, stateFeatureNames.length);
  if (!trunk || trunk.length === 0) return null;
  const embeddingSize = trunk[trunk.length - 1].outputSize;

  const valueHead = parseLinearHead(candidate.valueHead as Record<string, unknown>, embeddingSize);
  if (!valueHead) return null;

  const policyHeadRaw = candidate.policyHead as Record<string, unknown>;
  const hiddenSize = policyHeadRaw.hiddenSize;
  if (!Number.isInteger(hiddenSize) || (hiddenSize as number) <= 0) return null;
  if (!Array.isArray(policyHeadRaw.stateHiddenWeights) || !Array.isArray(policyHeadRaw.actionHiddenWeights)) return null;
  if (!Array.isArray(policyHeadRaw.hiddenBias) || !Array.isArray(policyHeadRaw.outputWeights)) return null;
  if ((policyHeadRaw.stateHiddenWeights as unknown[]).length !== embeddingSize * (hiddenSize as number)) return null;
  if ((policyHeadRaw.actionHiddenWeights as unknown[]).length !== actionFeatureNames.length * (hiddenSize as number)) return null;
  if ((policyHeadRaw.hiddenBias as unknown[]).length !== (hiddenSize as number)) return null;
  if ((policyHeadRaw.outputWeights as unknown[]).length !== (hiddenSize as number)) return null;
  if (typeof policyHeadRaw.bias !== 'number' || !Number.isFinite(policyHeadRaw.bias)) return null;
  if (!(policyHeadRaw.stateHiddenWeights as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  if (!(policyHeadRaw.actionHiddenWeights as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  if (!(policyHeadRaw.hiddenBias as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  if (!(policyHeadRaw.outputWeights as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;

  let actionScale: number | undefined;
  if (policyHeadRaw.actionScale !== undefined) {
    if (typeof policyHeadRaw.actionScale !== 'number' || !Number.isFinite(policyHeadRaw.actionScale)) {
      return null;
    }
    actionScale = policyHeadRaw.actionScale;
  }

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: HIVE_POLICY_VALUE_MODEL_PREVIOUS_VERSION,
    kind: 'policy_value',
    stateFeatureNames: [...stateFeatureNames] as string[],
    actionFeatureNames: [...actionFeatureNames] as string[],
    stateTrunk: trunk,
    valueHead,
    policyHead: {
      hiddenSize: hiddenSize as number,
      stateHiddenWeights: [...policyHeadRaw.stateHiddenWeights] as number[],
      actionHiddenWeights: [...policyHeadRaw.actionHiddenWeights] as number[],
      hiddenBias: [...policyHeadRaw.hiddenBias] as number[],
      outputWeights: [...policyHeadRaw.outputWeights] as number[],
      bias: policyHeadRaw.bias,
      actionScale,
    },
    training,
  };
}

function parseV6(candidate: Record<string, unknown>): HivePolicyValueModel | null {
  if (candidate.version !== HIVE_POLICY_VALUE_MODEL_VERSION) return null;
  if (candidate.kind !== 'policy_value') return null;
  if (!Array.isArray(candidate.stateFeatureNames)) return null;
  if (!Array.isArray(candidate.actionFeatureNames)) return null;
  if (!Array.isArray(candidate.stateTrunk)) return null;
  if (!candidate.valueHead || typeof candidate.valueHead !== 'object') return null;
  if (!candidate.policyHead || typeof candidate.policyHead !== 'object') return null;

  const stateFeatureNames = candidate.stateFeatureNames;
  const actionFeatureNames = candidate.actionFeatureNames;
  if (!stateFeatureNames.every((entry) => typeof entry === 'string')) return null;
  if (!actionFeatureNames.every((entry) => typeof entry === 'string')) return null;

  const trunk = parseLayers(candidate.stateTrunk, stateFeatureNames.length);
  if (!trunk || trunk.length === 0) return null;
  const embeddingSize = trunk[trunk.length - 1].outputSize;

  const valueHead = parseLinearHead(candidate.valueHead as Record<string, unknown>, embeddingSize);
  if (!valueHead) return null;

  const policyHeadRaw = candidate.policyHead as Record<string, unknown>;
  const inputHiddenSize = policyHeadRaw.inputHiddenSize;
  const hiddenSize = policyHeadRaw.hiddenSize;
  if (!Number.isInteger(inputHiddenSize) || (inputHiddenSize as number) <= 0) return null;
  if (!Number.isInteger(hiddenSize) || (hiddenSize as number) <= 0) return null;
  if (!Array.isArray(policyHeadRaw.inputWeights) || !Array.isArray(policyHeadRaw.inputBias)) return null;
  if (!Array.isArray(policyHeadRaw.hiddenWeights) || !Array.isArray(policyHeadRaw.hiddenLayerBias)) return null;
  if (!Array.isArray(policyHeadRaw.outputWeights)) return null;
  if ((policyHeadRaw.inputWeights as unknown[]).length !== (embeddingSize + actionFeatureNames.length) * (inputHiddenSize as number)) return null;
  if ((policyHeadRaw.inputBias as unknown[]).length !== (inputHiddenSize as number)) return null;
  if ((policyHeadRaw.hiddenWeights as unknown[]).length !== (inputHiddenSize as number) * (hiddenSize as number)) return null;
  if ((policyHeadRaw.hiddenLayerBias as unknown[]).length !== (hiddenSize as number)) return null;
  if ((policyHeadRaw.outputWeights as unknown[]).length !== (hiddenSize as number)) return null;
  if (typeof policyHeadRaw.bias !== 'number' || !Number.isFinite(policyHeadRaw.bias)) return null;
  if (!(policyHeadRaw.inputWeights as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  if (!(policyHeadRaw.inputBias as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  if (!(policyHeadRaw.hiddenWeights as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  if (!(policyHeadRaw.hiddenLayerBias as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  if (!(policyHeadRaw.outputWeights as unknown[]).every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;

  let actionScale: number | undefined;
  if (policyHeadRaw.actionScale !== undefined) {
    if (typeof policyHeadRaw.actionScale !== 'number' || !Number.isFinite(policyHeadRaw.actionScale)) {
      return null;
    }
    actionScale = policyHeadRaw.actionScale;
  }

  const training = parseTrainingInfo(candidate.training);
  if (!training) return null;

  return {
    version: HIVE_POLICY_VALUE_MODEL_VERSION,
    kind: 'policy_value',
    stateFeatureNames: [...stateFeatureNames] as string[],
    actionFeatureNames: [...actionFeatureNames] as string[],
    stateTrunk: trunk,
    valueHead,
    policyHead: {
      inputHiddenSize: inputHiddenSize as number,
      hiddenSize: hiddenSize as number,
      inputWeights: [...policyHeadRaw.inputWeights] as number[],
      inputBias: [...policyHeadRaw.inputBias] as number[],
      hiddenWeights: [...policyHeadRaw.hiddenWeights] as number[],
      hiddenLayerBias: [...policyHeadRaw.hiddenLayerBias] as number[],
      outputWeights: [...policyHeadRaw.outputWeights] as number[],
      bias: policyHeadRaw.bias,
      actionScale,
    },
    training,
  };
}

function parseLayers(rawLayers: unknown[], expectedInput: number): HiveMlpLayer[] | null {
  const layers: HiveMlpLayer[] = [];
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
    if (!layer.weights.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
    if (!layer.bias.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;

    layers.push({
      inputSize,
      outputSize,
      weights: [...layer.weights] as number[],
      bias: [...layer.bias] as number[],
      activation: layer.activation,
    });
    nextInput = outputSize;
  }

  return layers;
}

function parseLinearHead(raw: Record<string, unknown>, expectedInput: number): HivePolicyValueLinearHead | null {
  if (!Array.isArray(raw.weights)) return null;
  if (raw.weights.length !== expectedInput) return null;
  if (!raw.weights.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return null;
  if (typeof raw.bias !== 'number' || !Number.isFinite(raw.bias)) return null;

  let activation: HiveActivation | undefined;
  if (raw.activation !== undefined) {
    if (!isActivation(raw.activation)) return null;
    activation = raw.activation;
  }

  return {
    weights: [...raw.weights] as number[],
    bias: raw.bias,
    activation,
  };
}

function parseTrainingInfo(input: unknown): HiveModelTrainingInfo | null {
  if (!input || typeof input !== 'object') return null;
  const training = input as Record<string, unknown>;
  if (typeof training.generatedAt !== 'string') return null;
  if (typeof training.games !== 'number' || !Number.isFinite(training.games)) return null;
  if (typeof training.positionSamples !== 'number' || !Number.isFinite(training.positionSamples)) return null;
  if (typeof training.epochs !== 'number' || !Number.isFinite(training.epochs)) return null;
  if (!isDifficulty(training.difficulty)) return null;

  const parsed: HiveModelTrainingInfo = {
    generatedAt: training.generatedAt,
    games: training.games,
    positionSamples: training.positionSamples,
    epochs: training.epochs,
    difficulty: training.difficulty,
  };

  if (typeof training.framework === 'string') parsed.framework = training.framework;
  if (typeof training.device === 'string') parsed.device = training.device;
  if (typeof training.batchSize === 'number' && Number.isFinite(training.batchSize)) parsed.batchSize = training.batchSize;
  if (typeof training.learningRate === 'number' && Number.isFinite(training.learningRate)) parsed.learningRate = training.learningRate;
  if (typeof training.workers === 'number' && Number.isFinite(training.workers)) parsed.workers = training.workers;
  if (Array.isArray(training.hiddenLayers)) {
    parsed.hiddenLayers = training.hiddenLayers.filter(
      (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
    );
  }
  if (typeof training.policyLossWeight === 'number' && Number.isFinite(training.policyLossWeight)) {
    parsed.policyLossWeight = training.policyLossWeight;
  }
  if (typeof training.valueLossWeight === 'number' && Number.isFinite(training.valueLossWeight)) {
    parsed.valueLossWeight = training.valueLossWeight;
  }
  if (typeof training.auxLossWeight === 'number' && Number.isFinite(training.auxLossWeight)) {
    parsed.auxLossWeight = training.auxLossWeight;
  }
  if (typeof training.reanalyseRatio === 'number' && Number.isFinite(training.reanalyseRatio)) {
    parsed.reanalyseRatio = training.reanalyseRatio;
  }

  return parsed;
}

function evaluateV3PolicyValue(
  state: GameState,
  legalMoves: readonly Move[],
  perspective: PlayerColor,
  model: HivePolicyValueModel,
): HivePolicyValueEvaluation {
  const tokenSlots = inferTokenSlots(model.stateFeatureNames);
  const stateFeatures = extractHiveTokenStateFeatures(state, perspective, tokenSlots);
  let embedding = stateFeatures;
  for (const layer of model.stateTrunk) {
    embedding = runDenseLayer(embedding, layer);
  }

  const valueRaw = dot(model.valueHead.weights, embedding) + model.valueHead.bias;
  const value = clamp(applyActivation(valueRaw, model.valueHead.activation ?? 'tanh'), -1, 1);

  const logits: Record<string, number> = {};
  const inputHiddenSize = model.policyHead.inputHiddenSize;
  const hiddenSize = model.policyHead.hiddenSize;
  if (
    typeof inputHiddenSize === 'number'
    && typeof hiddenSize === 'number'
    && Array.isArray(model.policyHead.inputWeights)
    && Array.isArray(model.policyHead.inputBias)
    && Array.isArray(model.policyHead.hiddenWeights)
    && Array.isArray(model.policyHead.hiddenLayerBias)
    && Array.isArray(model.policyHead.outputWeights)
  ) {
    const inputWeights = model.policyHead.inputWeights;
    const inputBias = model.policyHead.inputBias;
    const hiddenWeights = model.policyHead.hiddenWeights;
    const hiddenLayerBias = model.policyHead.hiddenLayerBias;
    const outputWeights = model.policyHead.outputWeights;
    const actionScale = model.policyHead.actionScale ?? 1;
    for (const move of legalMoves) {
      const actionFeatures = extractHiveActionFeatures(state, move, perspective)
        .slice(0, model.actionFeatureNames.length);
      const joint = [...embedding, ...actionFeatures];
      const inputHidden = new Array(inputHiddenSize).fill(0);
      for (let hiddenIndex = 0; hiddenIndex < inputHiddenSize; hiddenIndex += 1) {
        let sum = inputBias[hiddenIndex] ?? 0;
        const offset = hiddenIndex * joint.length;
        for (let inputIndex = 0; inputIndex < joint.length; inputIndex += 1) {
          sum += (inputWeights[offset + inputIndex] ?? 0) * (joint[inputIndex] ?? 0);
        }
        inputHidden[hiddenIndex] = Math.tanh(sum);
      }
      const hidden = new Array(hiddenSize).fill(0);
      for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
        let sum = hiddenLayerBias[hiddenIndex] ?? 0;
        const offset = hiddenIndex * inputHidden.length;
        for (let inputIndex = 0; inputIndex < inputHidden.length; inputIndex += 1) {
          sum += (hiddenWeights[offset + inputIndex] ?? 0) * (inputHidden[inputIndex] ?? 0);
        }
        hidden[hiddenIndex] = Math.tanh(sum);
      }
      const logit = (dot(outputWeights, hidden) + model.policyHead.bias) * actionScale;
      logits[moveToActionKey(move)] = Number.isFinite(logit) ? logit : 0;
    }
    return {
      value,
      actionLogitsByKey: logits,
      policyEntropy: softmaxEntropy(Object.values(logits)),
      auxiliary: {
        queenSurroundDelta: clamp(
          (getQueenSurroundCount(state.board, flipColor(perspective))
            - getQueenSurroundCount(state.board, perspective)) / 6,
          -1,
          1,
        ),
        mobility: estimateMobility(state, perspective),
        lengthBucketLogits: [0, 0, 0],
      },
    };
  }

  if (
    typeof hiddenSize === 'number'
    && Array.isArray(model.policyHead.stateHiddenWeights)
    && Array.isArray(model.policyHead.actionHiddenWeights)
    && Array.isArray(model.policyHead.hiddenBias)
    && Array.isArray(model.policyHead.outputWeights)
  ) {
    const stateHiddenWeights = model.policyHead.stateHiddenWeights;
    const actionHiddenWeights = model.policyHead.actionHiddenWeights;
    const hiddenBias = model.policyHead.hiddenBias;
    const outputWeights = model.policyHead.outputWeights;
    const actionScale = model.policyHead.actionScale ?? 1;
    for (const move of legalMoves) {
      const actionFeatures = extractHiveActionFeatures(state, move, perspective)
        .slice(0, model.actionFeatureNames.length);
      const hidden = new Array(hiddenSize).fill(0);
      for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
        let sum = hiddenBias[hiddenIndex] ?? 0;
        const stateOffset = hiddenIndex * embedding.length;
        const actionOffset = hiddenIndex * actionFeatures.length;
        for (let embedIndex = 0; embedIndex < embedding.length; embedIndex += 1) {
          sum += (stateHiddenWeights[stateOffset + embedIndex] ?? 0) * (embedding[embedIndex] ?? 0);
        }
        for (let actionIndex = 0; actionIndex < actionFeatures.length; actionIndex += 1) {
          sum += (actionHiddenWeights[actionOffset + actionIndex] ?? 0) * (actionFeatures[actionIndex] ?? 0);
        }
        hidden[hiddenIndex] = Math.tanh(sum);
      }
      const logit = (dot(outputWeights, hidden) + model.policyHead.bias) * actionScale;
      logits[moveToActionKey(move)] = Number.isFinite(logit) ? logit : 0;
    }
    return {
      value,
      actionLogitsByKey: logits,
      policyEntropy: softmaxEntropy(Object.values(logits)),
      auxiliary: {
        queenSurroundDelta: clamp(
          (getQueenSurroundCount(state.board, flipColor(perspective))
            - getQueenSurroundCount(state.board, perspective)) / 6,
          -1,
          1,
        ),
        mobility: estimateMobility(state, perspective),
        lengthBucketLogits: [0, 0, 0],
      },
    };
  }

  const contextWeights = model.policyHead.contextWeights;
  const actionWeights = model.policyHead.actionWeights ?? [];
  const actionScale = model.policyHead.actionScale ?? 1;
  let dynamicActionWeights: number[] | null = null;
  if (Array.isArray(contextWeights) && contextWeights.length === embedding.length * model.actionFeatureNames.length) {
    dynamicActionWeights = new Array(model.actionFeatureNames.length).fill(0);
    for (let actionIndex = 0; actionIndex < model.actionFeatureNames.length; actionIndex += 1) {
      let sum = actionWeights[actionIndex] ?? 0;
      const offset = actionIndex * embedding.length;
      for (let embedIndex = 0; embedIndex < embedding.length; embedIndex += 1) {
        sum += (contextWeights[offset + embedIndex] ?? 0) * (embedding[embedIndex] ?? 0);
      }
      dynamicActionWeights[actionIndex] = sum;
    }
  }

  const legacyStateBias = Array.isArray(model.policyHead.stateWeights)
    ? dot(model.policyHead.stateWeights, embedding)
    : 0;
  for (const move of legalMoves) {
    const actionFeatures = extractHiveActionFeatures(state, move, perspective)
      .slice(0, model.actionFeatureNames.length);
    const actionBias = dynamicActionWeights
      ? dot(dynamicActionWeights, actionFeatures)
      : dot(actionWeights, actionFeatures) + legacyStateBias;
    const logit = (actionBias + model.policyHead.bias) * actionScale;
    logits[moveToActionKey(move)] = Number.isFinite(logit) ? logit : 0;
  }

  return {
    value,
    actionLogitsByKey: logits,
    policyEntropy: softmaxEntropy(Object.values(logits)),
    auxiliary: {
      queenSurroundDelta: clamp(
        (getQueenSurroundCount(state.board, flipColor(perspective))
          - getQueenSurroundCount(state.board, perspective)) / 6,
        -1,
        1,
      ),
      mobility: estimateMobility(state, perspective),
      lengthBucketLogits: [0, 0, 0],
    },
  };
}

function evaluateMlp(features: number[], model: HiveMlpModel): number {
  let activation = features;
  for (const layer of model.layers) {
    activation = runDenseLayer(activation, layer);
  }
  const raw = activation[0] ?? 0;
  return clamp(applyActivation(raw, model.outputActivation ?? 'tanh'), -1, 1);
}

function runDenseLayer(input: number[], layer: HiveMlpLayer): number[] {
  const output = new Array(layer.outputSize).fill(0);
  for (let outIndex = 0; outIndex < layer.outputSize; outIndex += 1) {
    let sum = layer.bias[outIndex] ?? 0;
    const offset = outIndex * layer.inputSize;
    for (let inIndex = 0; inIndex < layer.inputSize; inIndex += 1) {
      sum += (layer.weights[offset + inIndex] ?? 0) * (input[inIndex] ?? 0);
    }
    output[outIndex] = applyActivation(sum, layer.activation);
  }
  return output;
}

function pieceTypeCounts(pieces: PlacedPiece[]): Record<PieceType, number> {
  const counts: Record<PieceType, number> = {
    queen: 0,
    beetle: 0,
    grasshopper: 0,
    spider: 0,
    ant: 0,
    ladybug: 0,
    mosquito: 0,
    pillbug: 0,
  };
  for (const piece of pieces) counts[piece.type] += 1;
  return counts;
}

function resolveMovePieceType(state: GameState, move: Move): PieceType | null {
  if (move.type === 'place') return pieceTypeFromPieceId(move.pieceId);
  const boardPiece = state.board.find((piece) => piece.id === move.pieceId);
  return boardPiece?.type ?? pieceTypeFromPieceId(move.pieceId);
}

function estimateMobility(state: GameState, perspective: PlayerColor): number {
  const occupied = new Set(state.board.map((piece) => coordKey(piece.position)));
  let myFreedom = 0;
  let oppFreedom = 0;

  for (const piece of state.board) {
    for (const neighbor of getNeighbors(piece.position)) {
      if (occupied.has(coordKey(neighbor))) continue;
      if (piece.color === perspective) myFreedom += 1;
      else oppFreedom += 1;
    }
  }

  return clamp((myFreedom - oppFreedom) / 30, -1, 1);
}

function inferTokenSlots(featureNames: readonly string[]): number {
  const featureCount = featureNames.length - 6;
  const slots = Math.floor(featureCount / 8);
  return slots > 0 ? slots : HIVE_DEFAULT_TOKEN_SLOTS;
}

function softmaxEntropy(logits: number[]): number {
  if (logits.length === 0) return 0;
  const max = Math.max(...logits);
  const shifted = logits.map((logit) => Math.exp(logit - max));
  const sum = shifted.reduce((acc, value) => acc + value, 0);
  if (sum <= 0 || !Number.isFinite(sum)) return 0;
  let entropy = 0;
  for (const value of shifted) {
    const p = value / sum;
    if (p > 0) entropy -= p * Math.log(p);
  }
  return Number.isFinite(entropy) ? entropy : 0;
}

function dot(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let total = 0;
  for (let index = 0; index < length; index += 1) total += left[index] * right[index];
  return total;
}

function applyActivation(value: number, activation: HiveActivation): number {
  switch (activation) {
    case 'linear':
      return value;
    case 'relu':
      return Math.max(0, value);
    case 'tanh':
      return Math.tanh(value);
  }
}

function isDifficulty(value: unknown): value is HiveDifficultyLabel {
  return value === 'medium' || value === 'hard' || value === 'extreme' || value === 'mixed';
}

function isActivation(value: unknown): value is HiveActivation {
  return value === 'linear' || value === 'relu' || value === 'tanh';
}

function isMlpModel(model: HiveModel): model is HiveMlpModel {
  return model.kind === 'mlp';
}

function isPolicyValueModel(model: HiveModel): model is HivePolicyValueModel {
  return model.kind === 'policy_value';
}

function flipColor(color: PlayerColor): PlayerColor {
  return color === 'white' ? 'black' : 'white';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const HIVE_DEFAULT_POLICY_VALUE_MODEL_TEMPLATE: HivePolicyValueModel = {
  version: HIVE_POLICY_VALUE_MODEL_VERSION,
  kind: 'policy_value',
  stateFeatureNames: DEFAULT_TOKEN_FEATURE_NAMES,
  actionFeatureNames: [...HIVE_ACTION_FEATURE_NAMES],
  stateTrunk: [
    {
      inputSize: DEFAULT_TOKEN_FEATURE_NAMES.length,
      outputSize: 96,
      weights: Array.from({ length: DEFAULT_TOKEN_FEATURE_NAMES.length * 96 }, () => 0),
      bias: Array.from({ length: 96 }, () => 0),
      activation: 'tanh',
    },
    {
      inputSize: 96,
      outputSize: 48,
      weights: Array.from({ length: 96 * 48 }, () => 0),
      bias: Array.from({ length: 48 }, () => 0),
      activation: 'tanh',
    },
  ],
  valueHead: {
    weights: Array.from({ length: 48 }, () => 0),
    bias: 0,
    activation: 'tanh',
  },
  policyHead: {
    inputHiddenSize: 64,
    hiddenSize: 64,
    inputWeights: Array.from({ length: (48 + HIVE_ACTION_FEATURE_NAMES.length) * 64 }, () => 0),
    inputBias: Array.from({ length: 64 }, () => 0),
    hiddenWeights: Array.from({ length: 64 * 64 }, () => 0),
    hiddenLayerBias: Array.from({ length: 64 }, () => 0),
    outputWeights: Array.from({ length: 64 }, () => 0),
    bias: 0,
    actionScale: 1,
  },
  training: {
    generatedAt: new Date(0).toISOString(),
    games: 0,
    positionSamples: 0,
    epochs: 0,
    difficulty: 'mixed',
    framework: 'pytorch',
    device: 'cpu',
  },
};
