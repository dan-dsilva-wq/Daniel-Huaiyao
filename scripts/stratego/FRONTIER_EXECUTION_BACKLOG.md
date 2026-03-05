# Stratego Frontier Execution Backlog

## Goal
Build a staged path from the current value-only/minimax system to a stronger policy+value search stack, with measurable Elo gains and safe rollout gates.

## Current Baseline (as of this change)
- Engine: determinized alpha-beta/minimax with beam limits.
- Model: value-only linear/MLP blended with heuristic evaluator.
- Dataset: self-play features + terminal value labels.

## Phase 1: Policy+Value Foundation (in progress)

### 1) Search policy targets in dataset (implemented)
- `lib/stratego/ai.ts`
  - Added exported move scoring API: `scoreStrategoMovesForColor(...)`.
  - Refactored move selection to reuse scored-move sampling helper.
- `scripts/stratego/policy.ts`
  - Added fixed action encoding (10k action space via from/to squares).
  - Added policy target builder from scored moves (`temperature`, `topK`).
- `scripts/stratego/training-core.ts`
  - Added optional per-sample `policyTargets`.
  - Added self-play options for `includePolicyTargets`, `policyTemperature`, `policyTopK`.
  - Emits policy targets for side-to-move samples.
  - In `puct-lite` mode, policy targets now come from root visit counts (AlphaZero-style) instead of score-softmax.
- `scripts/stratego/selfplay-worker.ts`
  - Added worker CLI/pass-through for policy target options.
- `scripts/stratego/train-model.ts`
  - Added CLI options:
    - `--policy-targets`
    - `--policy-temperature <n>`
    - `--policy-top-k <n>`
  - Dataset meta includes policy target settings.
- `scripts/stratego/train-deep.ts`
  - Added same policy CLI options and forwarding to self-play generation.
- `scripts/stratego/training-core.ts`
  - Added value target modes:
    - `terminal` (legacy behavior)
    - `mixed` (blend terminal outcome with root search value target)
    - `search` (search value target only when available)
  - Added optional n-step bootstrapped target blending:
    - `--bootstrap-steps <n>`
    - `--bootstrap-discount <n>`
    - `--bootstrap-blend <n>`

### 2) Dual-head trainer (implemented baseline)
- `scripts/stratego/train-model-policy-value.py`
  - Input: dataset with `features`, `target`, optional sparse `policyTargets`.
  - Model: shared trunk + value head + policy head.
  - Loss: `value_mse + lambda_policy * policy_kl`.
  - Output: policy+value model artifact in `.stratego-cache` by default.
- `scripts/stratego/train-policy-value.ts`
  - Python launcher with `python` / `py -3` fallback.
- `package.json`
  - Added `npm run stratego:train:policy-value`.

### 3) Engine policy integration (implemented baseline)
- `lib/stratego/ml.ts`
  - Added parser/evaluator support for `policy_value_mlp` artifacts.
  - Added policy-logit inference API for legal move sets.
- `lib/stratego/ai.ts`
  - Uses policy priors for minimax move ordering (root + children) when a policy head exists.
  - Uses blended policy+tactical priors in PUCT-lite edge expansion.
  - Keeps tactical/heuristic fallback for older value-only models.

### 3b) PUCT-lite self-play search (implemented baseline)
- `lib/stratego/ai.ts`
  - Added optional `puct-lite` search algorithm in move selection.
  - Configurable simulations / cpuct / rollout depth.
  - Default remains minimax unless `searchAlgorithm` is explicitly set.
- `scripts/stratego/train-model.ts`, `scripts/stratego/train-deep.ts`, `scripts/stratego/selfplay-worker.ts`
  - Added CLI flags:
    - `--search-mode minimax|puct-lite`
    - `--puct-simulations <n>`
    - `--puct-cpuct <n>`
    - `--puct-rollout-depth <n>`

### 4) Acceptance gate (implemented)
- `scripts/stratego/gate.ts` (implemented advanced baseline)
  - Runs paired eval (`candidate` vs `incumbent`) using existing eval harness.
  - Supports both fixed-size CI gating and sequential SPRT gating:
    - `--method ci` (legacy confidence-interval threshold gate)
    - `--method sprt` (Elo-based sequential accept/reject with early stopping)
  - Added SPRT controls:
    - `--sprt-elo0`, `--sprt-elo1`
    - `--sprt-alpha`, `--sprt-beta`
    - `--sprt-batch-games`
    - optional CI fallback on inconclusive SPRT (`--sprt-ci-fallback` / `--no-sprt-ci-fallback`)
  - Optional promotion copies candidate to target path only on pass.
  - Script: `npm run stratego:gate`.
- `scripts/stratego/autopilot.ts`
  - Integrated per-generation gate enforcement before sync/deploy.
  - Autopilot now snapshots incumbent before training, gates candidate after training, and auto-restores incumbent on gate reject.
  - Commit/push/deploy are skipped automatically on rejected generations.
  - Added policy+value default generation path:
    - new mode `policy-value-eval`
    - new pipeline script `scripts/stratego/train-policy-value-eval.ts`
    - autopilot default mode now uses policy+value loop unless overridden.

### 5) Systems optimization (implemented baseline)
- `scripts/stratego/train-model-deep.py`
  - Added AMP controls: `--amp auto|on|off` with CUDA-safe fallback.
  - Added optional `torch.compile` controls: `--compile auto|on|off`.
  - Exposes these settings in setup logs + exported model training metadata.
- `scripts/stratego/train-deep.ts`
  - Added pass-through CLI flags for `--amp` and `--compile`.
  - Added structured run-manifest tracking:
    - `--manifest-out <path>` writes latest full run manifest JSON
    - `--manifest-history <path>` appends JSONL run history
    - `--no-manifest-history` disables history append
  - Manifest captures resolved paths, effective options, hardware profile, launch args, replay merge info, status, and errors.

## Phase 2: Stronger Search + Belief Modeling
- Replace beam-minimax core with PUCT/IS-MCTS variant.
- Add belief-aware state features for hidden information.
  - Implemented baseline hidden-information feature channels in `lib/stratego/ml.ts`:
    - opponent unknown/moved/backline ratios
    - must-be-scout ratio + recent long-move/attack rates from move history
    - unknown-rank entropy/strength summary
    - per-rank opponent belief probabilities (`belief_opp_prob_rank_*`)
  - Added model feature-schema compatibility support for both:
    - legacy 27-feature models
    - new expanded belief-aware feature schema
- League self-play (incumbent + recent + exploiters).
  - Implemented baseline league sampling controls in self-play:
    - `--league-models <csv>`
    - `--league-sample-prob <n>`
    - `--league-heuristic-prob <n>`
  - Works in both single-process and worker-parallel dataset generation.

## Phase 3: Frontier Track
- ReBeL/SoG-style public-belief search or MuZero-style latent planning.
- Distillation path for low-latency app runtime.

## Verification Checklist
- `npx eslint lib/stratego/ai.ts scripts/stratego/train-model.ts scripts/stratego/train-deep.ts scripts/stratego/training-core.ts scripts/stratego/selfplay-worker.ts scripts/stratego/policy.ts`
- `npm run stratego:train -- --games 1 --difficulty medium --max-turns 20 --workers 1 --skip-fit --policy-targets --policy-top-k 4 --dataset-out .stratego-cache/tmp-policy-dataset.json`

## Notes
- This change intentionally preserves backward compatibility for existing training commands.
- Full-repo `npm run lint` is currently failing on pre-existing unrelated files; the Stratego-modified files lint clean.
