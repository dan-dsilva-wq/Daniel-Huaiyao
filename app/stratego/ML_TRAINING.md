# Stratego Local ML Training

Train/update the Stratego computer AI model directly on your PC.

## Linear model (fast, CPU)

```bash
npm run stratego:train
```

Quick smoke test run:

```bash
npm run stratego:train:quick
```

Useful overrides:

```bash
npm run stratego:train -- --games 240 --epochs 16 --difficulty extreme --max-turns 240 --workers 8
```

Stall-control override (draw after N moves with no capture):

```bash
npm run stratego:train -- --games 240 --epochs 16 --difficulty extreme --no-capture-draw 160
```

Verbose stage/game progress with ETA:

```bash
npm run stratego:train -- --games 200 --epochs 12 --difficulty extreme --workers 8 --verbose
```

Deep turn-by-turn trace (very noisy):

```bash
npm run stratego:train -- --games 20 --epochs 4 --difficulty hard --workers 4 --trace-turns
```

Parallel preset:

```bash
npm run stratego:train:parallel
```

## Deep neural net (PyTorch, GPU if available)

Install PyTorch first:

```bash
pip install torch
```

Run deep training end-to-end (self-play dataset + MLP training):

```bash
npm run stratego:train:deep -- --games 300 --difficulty extreme --workers 8 --epochs 60 --early-stop-patience 6 --early-stop-min-delta 0.002 --early-stop-min-epochs 10
```

Current project default (`npm run stratego:train:deep`) already includes:

```bash
--games 300 --difficulty extreme --workers 8 --epochs 60 --save-every 1 --resume --warm-start --replay-max-runs 6 --replay-max-samples 400000 --no-capture-draw 160 --early-stop-patience 6 --early-stop-min-delta 0.002 --early-stop-min-epochs 10 --verbose
```

Use no-capture auto-draw to cut long stalemate games:

```bash
npm run stratego:train:deep -- --games 300 --difficulty extreme --workers 8 --epochs 60 --no-capture-draw 160
```

Continue training across runs (no reset):

```bash
npm run stratego:train:deep -- --games 300 --difficulty extreme --workers 8 --epochs 20 --resume --warm-start
```

Checkpoint every epoch so `Ctrl+C` can resume:

```bash
npm run stratego:train:deep -- --games 300 --difficulty hard --workers 8 --epochs 30 --save-every 1 --checkpoint .stratego-cache/deep-training.ckpt
```

Control deep runtime optimization explicitly:

```bash
npm run stratego:train:deep -- --games 300 --difficulty extreme --workers 8 --epochs 60 --amp auto --compile auto
```

Early stopping (default on in current setup):

```bash
--early-stop-patience 6      # stop after 6 non-improving epochs
--early-stop-min-delta 0.002 # minimum val_mse gain to count as improvement
--early-stop-min-epochs 10   # don't early-stop too early
```

Deep training now uses a rolling replay buffer by default, so each run trains on recent runs too (not just the latest run):

```bash
npm run stratego:train:deep -- --games 300 --difficulty extreme --workers 8 --epochs 20 --replay-max-runs 6 --replay-max-samples 400000
```

Replay controls:

```bash
--replay                 # default on
--no-replay              # train only on current run dataset
--replay-path <path>     # default: .stratego-cache/deep-replay-buffer.json
--replay-max-runs <n>    # keep latest N runs
--replay-max-samples <n> # cap total replay samples for speed/stability
--amp <m>                # auto|on|off for mixed precision (default: auto)
--compile <m>            # auto|on|off for torch.compile (default: auto)
--policy-targets         # include search-policy targets in dataset samples
--policy-temperature <n> # policy softmax temperature (default: 1.1)
--policy-top-k <n>       # keep top-K scored moves per policy sample (default: 12)
--value-target-mode <m>  # terminal|mixed|search (default: terminal)
--search-value-blend <n> # blend weight in mixed mode [0..1] (default: 0.35)
--bootstrap-steps <n>    # n-step lookahead for bootstrapped value target (default: 0 disabled)
--bootstrap-discount <n> # discount for bootstrap target [0..1] (default: 1.0)
--bootstrap-blend <n>    # blend weight for bootstrap target [0..1] (default: 0.0)
--league-models <csv>    # optional opponent pool model paths (comma/semicolon-separated)
--league-sample-prob <n> # per-side probability to sample from league pool [0..1] (default: 0)
--league-heuristic-prob <n> # per-side probability to force heuristic-only play [0..1] (default: 0)
--search-mode <m>        # minimax|puct-lite (default: minimax)
--puct-simulations <n>   # simulations per move for puct-lite
--puct-cpuct <n>         # exploration constant for puct-lite
--puct-rollout-depth <n> # depth cutoff for puct-lite value eval
--manifest-out <path>    # write latest deep-train run manifest JSON
--manifest-history <path> # append JSONL run history
--no-manifest-history    # disable JSONL history append
```

Train a dual-head policy+value model artifact from a generated dataset:

```bash
npm run stratego:train:policy-value -- --dataset .stratego-cache/tmp-policy-dataset.json --epochs 40 --batch-size 512 --hidden 128,96 --policy-weight 1.0 --value-weight 1.0
```

Default output path:

```bash
.stratego-cache/policy-value-model.json
```

Runtime note: `lib/stratego/ai.ts` now understands `policy_value_mlp` artifacts and will use policy priors for minimax move ordering and PUCT-lite priors once promoted to `lib/stratego/trained-model.json` (or passed as `--candidate` in eval/gate flows).

Run self-play with PUCT-lite search (instead of minimax) for dataset generation:

```bash
npm run stratego:train -- --games 200 --difficulty hard --workers 8 --search-mode puct-lite --puct-simulations 240 --puct-cpuct 1.18 --puct-rollout-depth 18 --skip-fit --dataset-out .stratego-cache/puct-dataset.json
```

Add n-step bootstrapped value targets on top of search/terminal blending:

```bash
npm run stratego:train -- --games 200 --difficulty hard --workers 8 --search-mode puct-lite --value-target-mode mixed --search-value-blend 0.35 --bootstrap-steps 2 --bootstrap-discount 0.98 --bootstrap-blend 0.35 --skip-fit --dataset-out .stratego-cache/puct-bootstrap-dataset.json
```

League-style self-play (mix active model, pool checkpoints, and optional heuristic baseline):

```bash
npm run stratego:train -- --games 200 --difficulty hard --workers 8 --search-mode puct-lite --league-models ".stratego-cache/policy-value-model.json,lib/stratego/trained-model.json" --league-sample-prob 0.7 --league-heuristic-prob 0.1 --skip-fit --dataset-out .stratego-cache/league-dataset.json
```

Run a promotion gate before replacing incumbent model:

```bash
npm run stratego:gate -- --candidate .stratego-cache/policy-value-model.json --incumbent lib/stratego/trained-model.json --games 120 --min-score 0.53 --min-lower-bound 0.50
```

SPRT gate mode (sequential paired-match test with early accept/reject):

```bash
npm run stratego:gate -- --candidate .stratego-cache/policy-value-model.json --incumbent lib/stratego/trained-model.json --method sprt --games 160 --sprt-batch-games 24 --sprt-elo0 0 --sprt-elo1 35 --sprt-alpha 0.05 --sprt-beta 0.05
```

What this does:

1. Runs self-play locally using the same Stratego engine as gameplay.
2. Uses multiple worker processes when `--workers > 1` for higher CPU utilization.
3. Trains a linear value model with `npm run stratego:train`.
4. Or trains a deep MLP model via PyTorch with `npm run stratego:train:deep`.
5. Deep training supports checkpoint resume and warm-start from previous `lib/stratego/trained-model.json`.
6. Writes the trained model to `lib/stratego/trained-model.json`.

After training, restart `npm run dev` (or rebuild) so the app loads the updated model.

## Visualize Learning Curves

Training scripts now append metrics to:

```bash
.stratego-cache/metrics/training-metrics.jsonl
```

Open the dashboard in your app:

```bash
/stratego/training
```

It shows:

1. Validation/train MSE over epochs.
2. Validation/train accuracy over epochs.
3. Self-play progression for each run.
4. Overall cross-run validation trend (one point per run).
5. Fixed benchmark trend from `stratego:eval` runs.

## Fixed Benchmark Eval (recommended progress check)

Run the current model against a fixed baseline (heuristic-only search):

```bash
npm run stratego:eval -- --games 60 --difficulty extreme --max-turns 500 --no-capture-draw 160
```

Speed up benchmark by parallelizing games:

```bash
npm run stratego:eval -- --games 60 --difficulty extreme --workers 8
```

What this logs:

1. Candidate score % (`win + 0.5 * draw`) against the fixed baseline.
2. Win/draw/loss rates across runs.
3. Average game length and draw causes (`max_turns` vs `no_capture_streak`).

Optional custom baseline model:

```bash
npm run stratego:eval -- --games 60 --difficulty extreme --baseline-model .stratego-cache/baseline-model.json
```

Train + benchmark in one command:

```bash
npm run stratego:train:deep:eval
```

Policy+value train + benchmark in one command:

```bash
npm run stratego:train:policy-value:eval
```

## Auto-Tune Hidden Layers

Try multiple MLP shapes each generation, benchmark each one, and keep the best:

```bash
npm run stratego:tune -- --games 300 --epochs 60 --eval-games 60
```

Custom candidate list:

```bash
npm run stratego:tune -- --architectures "96,48|128,64|128,96,48" --games 300 --epochs 60 --eval-games 60
```

## Continuous Autopilot (Train -> Commit -> Push -> Deploy -> Repeat)

Run forever (`--generations 0`), auto-commit model outputs, push, and deploy after each generation:

```bash
npm run stratego:autopilot -- --generations 0 --pause-seconds 30
```

Autopilot default mode is now `policy-value-eval` (policy+value self-play/training/eval), and it runs a promotion gate before commit/push/deploy by default (SPRT mode). Rejected generations are automatically rolled back to the previous incumbent and skipped for deploy.

Example with explicit gate controls:

```bash
npm run stratego:autopilot -- --mode policy-value-eval --generations 0 --gate --gate-method sprt --gate-games 160 --gate-sprt-batch-games 24 --gate-sprt-elo0 0 --gate-sprt-elo1 35 --pause-seconds 30
```

If you want training only (no git push / no deploy):

```bash
npm run stratego:autopilot -- --no-push --no-deploy --generations 0
```

Useful autopilot flags:

```bash
--git-paths "lib/stratego/trained-model.json,.stratego-cache/tune/last-tune.json"
--commit-message "stratego: gen {generation} {mode} {best_arch}"
--continue-on-error
```
