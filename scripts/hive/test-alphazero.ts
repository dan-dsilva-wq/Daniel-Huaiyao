import { strict as assert } from 'node:assert';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  getLegalMovesForColor,
  runHiveMctsSearch,
} from '../../lib/hive/ai';
import {
  evaluatePolicyValue,
  getActiveHiveModel,
} from '../../lib/hive/ml';
import {
  buildActionLookup,
  moveToActionKey,
  parseActionKey,
  resolveActionKey,
} from '../../lib/hive/actionEncoding';

function main(): void {
  const state = createLocalHiveGameState({
    id: `test-${Date.now()}`,
    shortCode: 'TEST',
    whitePlayerId: 'w',
    blackPlayerId: 'b',
  });

  const legal = getLegalMovesForColor(state, 'white');
  assert(legal.length > 0, 'initial position should have legal moves');

  const lookup = buildActionLookup(legal);
  assert(lookup.size > 0, 'action lookup should not be empty');

  for (const move of legal) {
    const key = moveToActionKey(move);
    assert(parseActionKey(key) !== null, `action key should parse: ${key}`);
    const resolved = resolveActionKey(key, legal);
    assert(resolved !== null, `action key should resolve to legal move: ${key}`);
  }

  const policy = evaluatePolicyValue(state, legal, 'white', getActiveHiveModel());
  assert(Number.isFinite(policy.value), 'value prediction should be finite');
  for (const key of Object.keys(policy.actionLogitsByKey)) {
    assert(lookup.has(key), `policy should only emit legal keys, got ${key}`);
  }

  const mcts = runHiveMctsSearch(state, 'white', 'medium', {
    engine: 'alphazero',
    mctsConfig: {
      simulations: 12,
      maxDepth: 40,
    },
    randomSeed: 123,
  });

  assert(mcts.selectedMove !== null, 'MCTS should return a move');
  assertMoveIsLegal(state, 'white', mcts.selectedMove, 'MCTS selected move should be legal');
  assert(mcts.policy.length > 0, 'MCTS policy should not be empty');
  assertPolicyIsValid(mcts.policy);
  const probSum = mcts.policy.reduce((sum, entry) => sum + entry.probability, 0);
  assert(Math.abs(probSum - 1) < 1e-3, `policy probabilities must sum to 1 (got ${probSum})`);
  assert(mcts.stats.simulations === 12, 'stats should report configured simulations');

  const defaultClassic = chooseHiveMoveForColor(state, 'white', 'extreme');
  const explicitClassic = chooseHiveMoveForColor(state, 'white', 'extreme', {
    engine: 'classic',
  });
  assert(defaultClassic !== null && explicitClassic !== null, 'classic engine should produce a move');
  assertMoveIsLegal(state, 'white', defaultClassic, 'default classic move should be legal');
  assertMoveIsLegal(state, 'white', explicitClassic, 'explicit classic move should be legal');

  runOneSelfPlayGameIntegration();
  runIllegalMoveRegressionSweep();

  console.log('[test:az] all checks passed');
}

function runOneSelfPlayGameIntegration(): void {
  let state = createLocalHiveGameState({
    id: `test-selfplay-${Date.now()}`,
    shortCode: 'TSP',
    whitePlayerId: 'w',
    blackPlayerId: 'b',
  });
  let samples = 0;
  const maxTurns = 120;

  while (state.status === 'playing' && state.turnNumber <= maxTurns) {
    const color = state.currentTurn;
    const legal = getLegalMovesForColor(state, color);
    if (legal.length === 0) break;

    const search = runHiveMctsSearch(state, color, 'medium', {
      engine: 'alphazero',
      mctsConfig: {
        simulations: 18,
        maxDepth: maxTurns,
      },
      randomSeed: 3103 + state.turnNumber * 19,
    });
    assert(search.selectedMove !== null, 'self-play search should pick a move');
    assertMoveIsLegal(state, color, search.selectedMove, 'self-play picked illegal move');
    assertPolicyIsValid(search.policy);
    assert(search.policy.length > 0, 'self-play policy must be non-empty');
    assert(Number.isFinite(search.stats.rootValue), 'root value should be finite');
    assert(search.stats.averageSimulationDepth >= 0, 'average depth should be non-negative');
    samples += 1;

    state = applyHiveMove(state, search.selectedMove);
  }

  assert(samples > 0, 'self-play should generate at least one training sample');
}

function runIllegalMoveRegressionSweep(): void {
  let state = createLocalHiveGameState({
    id: `test-reg-${Date.now()}`,
    shortCode: 'TRG',
    whitePlayerId: 'w',
    blackPlayerId: 'b',
  });
  const maxPlies = 140;
  let plies = 0;

  while (state.status === 'playing' && plies < maxPlies) {
    const color = state.currentTurn;
    const engine = plies % 2 === 0 ? 'alphazero' : 'classic';
    const move = chooseHiveMoveForColor(state, color, 'hard', {
      engine,
      randomSeed: 5101 + plies * 13,
      mctsConfig: engine === 'classic' ? undefined : { simulations: 24, maxDepth: 120 },
    });
    assert(move !== null, `engine=${engine} should produce a move at ply=${plies}`);
    assertMoveIsLegal(state, color, move, `engine=${engine} produced illegal move`);
    state = applyHiveMove(state, move);
    plies += 1;
  }

  assert(plies > 20, 'regression sweep should play enough plies to be meaningful');
}

function assertMoveIsLegal(
  state: ReturnType<typeof createLocalHiveGameState>,
  color: 'white' | 'black',
  move: NonNullable<ReturnType<typeof chooseHiveMoveForColor>>,
  message: string,
): void {
  const legal = getLegalMovesForColor(state, color);
  const legalSet = new Set(legal.map((candidate) => moveToActionKey(candidate)));
  assert(legalSet.has(moveToActionKey(move)), message);
}

function assertPolicyIsValid(
  policy: Array<{ actionKey: string; probability: number; visits: number }>,
): void {
  const seen = new Set<string>();
  let sum = 0;
  for (const entry of policy) {
    assert(Number.isFinite(entry.probability) && entry.probability >= 0, 'policy probability must be finite and >= 0');
    assert(Number.isFinite(entry.visits) && entry.visits >= 0, 'policy visits must be finite and >= 0');
    assert(!seen.has(entry.actionKey), `duplicate action in policy: ${entry.actionKey}`);
    seen.add(entry.actionKey);
    sum += entry.probability;
  }
  assert(Math.abs(sum - 1) < 1e-3, `policy probabilities must sum to 1 (got ${sum})`);
}

main();
