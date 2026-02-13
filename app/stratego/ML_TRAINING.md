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
