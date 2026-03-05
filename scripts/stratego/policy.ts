import type { ScoredStrategoMove, StrategicMove } from '../../lib/stratego/ai';

export const STRATEGO_POLICY_ACTION_SPACE = 10 * 10 * 10 * 10;
const MOVE_SCORE_SCALE = 180;

export interface PolicyTargetEntry {
  action: number;
  probability: number;
  score: number;
}

export interface PolicyTargetOptions {
  temperature: number;
  topK: number;
}

export interface PolicyVisitTargetOptions {
  topK: number;
}

export function encodeStrategoMoveToActionIndex(
  move: Pick<StrategicMove, 'fromRow' | 'fromCol' | 'toRow' | 'toCol'>,
): number {
  const from = move.fromRow * 10 + move.fromCol;
  const to = move.toRow * 10 + move.toCol;
  return from * 100 + to;
}

export function buildPolicyTargetsFromScoredMoves(
  scoredMoves: ScoredStrategoMove[],
  options: PolicyTargetOptions,
): PolicyTargetEntry[] {
  if (scoredMoves.length === 0) return [];

  const normalizedTemperature = clamp(options.temperature, 0.05, 8);
  const normalizedTopK = clampInt(options.topK, 1, scoredMoves.length);
  const candidates = scoredMoves.slice(0, normalizedTopK);
  const bestScore = candidates[0]?.score ?? 0;

  const logits = candidates.map((entry) => (entry.score - bestScore) / (MOVE_SCORE_SCALE * normalizedTemperature));
  const maxLogit = Math.max(...logits);
  const weights = logits.map((logit) => Math.exp(logit - maxLogit));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return [];

  const targets = candidates.map((entry, index) => ({
    action: encodeStrategoMoveToActionIndex(entry.move),
    probability: weights[index] / totalWeight,
    score: entry.score,
  }));

  return collapseDuplicateActions(targets);
}

export function buildPolicyTargetsFromVisitCounts(
  scoredMoves: ScoredStrategoMove[],
  options: PolicyVisitTargetOptions,
): PolicyTargetEntry[] {
  if (scoredMoves.length === 0) return [];

  const visitScored = scoredMoves
    .filter((entry) => Number.isFinite(entry.visits) && (entry.visits ?? 0) > 0)
    .sort((left, right) => (right.visits ?? 0) - (left.visits ?? 0));
  if (visitScored.length === 0) return [];

  const normalizedTopK = clampInt(options.topK, 1, visitScored.length);
  const selected = visitScored.slice(0, normalizedTopK);
  const totalVisits = selected.reduce((sum, entry) => sum + (entry.visits ?? 0), 0);
  if (!Number.isFinite(totalVisits) || totalVisits <= 0) return [];

  const targets = selected.map((entry) => ({
    action: encodeStrategoMoveToActionIndex(entry.move),
    probability: (entry.visits ?? 0) / totalVisits,
    score: entry.score,
  }));

  return collapseDuplicateActions(targets);
}

function collapseDuplicateActions(targets: PolicyTargetEntry[]): PolicyTargetEntry[] {
  const byAction = new Map<number, PolicyTargetEntry>();
  for (const target of targets) {
    const existing = byAction.get(target.action);
    if (!existing) {
      byAction.set(target.action, { ...target });
      continue;
    }
    existing.probability += target.probability;
    existing.score = Math.max(existing.score, target.score);
  }

  const combined = [...byAction.values()];
  const total = combined.reduce((sum, target) => sum + target.probability, 0);
  if (!Number.isFinite(total) || total <= 0) return [];

  for (const target of combined) {
    target.probability /= total;
  }
  combined.sort((left, right) => right.probability - left.probability);
  return combined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
