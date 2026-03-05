# Hive Local ML Training

Train and update the Hive computer AI model directly on your PC.

## Linear model (fast, CPU)

```bash
npm run hive:train
```

Quick smoke test run:

```bash
npm run hive:train:quick
```

Useful overrides:

```bash
npm run hive:train -- --games 220 --epochs 16 --difficulty extreme --max-turns 260 --workers 8
```

## Deep neural net (PyTorch)

Install PyTorch first:

```bash
pip install torch
```

Run deep training end-to-end:

```bash
npm run hive:train:deep -- --games 300 --difficulty extreme --workers 8 --epochs 60 --early-stop-patience 6 --early-stop-min-delta 0.002 --early-stop-min-epochs 10
```

## Benchmark Progress

```bash
npm run hive:eval -- --games 60 --difficulty extreme --max-turns 300 --no-capture-draw 100
```

Deterministic benchmark suites (defaults to frozen `baseline_v1`):

```bash
npm run hive:eval -- --suite baseline_v1 --seed 1337
npm run hive:eval -- --suite opening_diversity --engine alphazero --seed 1337
```

## AlphaZero-Style Policy/Value Training

Train with MCTS self-play, replay, reanalyse, and arena promotion gate:

```bash
npm run hive:train:az -- --games 240 --difficulty extreme --simulations 220 --epochs 26
npm run hive:train:az -- --reanalyse-fraction 0.2 --reanalyse-workers 4
npm run hive:train:az -- --arena-gate-mode sprt --arena-sprt-alpha 0.05 --arena-sprt-beta 0.05 --arena-sprt-margin 0.05 --arena-confidence-level 0.95
```

Async CPU self-play + GPU training pipeline (runs both concurrently):

```bash
npm run hive:train:az:async -- --duration-minutes 0 --selfplay-workers 3 --chunk-games 2 --train-interval-seconds 180 --min-replay-samples 1200 --min-new-samples 320 --continue-on-error
```

Train then run arena explicitly:

```bash
npm run hive:train:az:eval -- --games 240 --epochs 26 --arena --games 400 --pass-score 0.55
```

Manual arena gate only:

```bash
npm run hive:eval:arena -- --candidate-model .hive-cache/az-candidate-model.json --champion-model lib/hive/trained-model.json --games 400 --pass-score 0.55
npm run hive:eval:arena -- --gate-mode sprt --sprt-alpha 0.05 --sprt-beta 0.05 --sprt-margin 0.05
```

Performance + stability checks (latency tiers + memory ceiling + illegal-move regression):

```bash
npm run hive:test:perf -- --engine alphazero --difficulty extreme --memory-ceiling-mb 4096
npm run hive:test:perf -- --latency-max-200 200 --latency-max-500 500 --latency-max-1000 1000 --latency-p90-max-200 320 --latency-p90-max-500 800 --latency-p90-max-1000 1600
npm run hive:test:pipeline
```

## Deep Train + Eval in one command

```bash
npm run hive:train:deep:eval
```

## Continuous Autopilot

```bash
npm run hive:autopilot -- --mode deep-eval --generations 0 --pause-seconds 30 --deploy-command "vercel --prod --yes" --continue-on-error
```

AlphaZero autopilot mode:

```bash
npm run hive:autopilot -- --mode alphazero-eval --generations 0 --pause-seconds 30 --deploy-command "vercel --prod --yes" --continue-on-error
```

AlphaZero stability-gated autopilot (requires 3 consecutive promoted generations with non-overlapping CIs):

```bash
npm run hive:autopilot -- --mode alphazero-eval --require-stable-promotions --stability-window 3 --metrics-log .hive-cache/metrics/training-metrics.jsonl --generations 0 --pause-seconds 30 --continue-on-error
```

Useful flags:

```bash
--git-paths "lib/hive/trained-model.json,.hive-cache/deep-replay-buffer.json"
--commit-message "hive: gen {generation} {mode}"
```

## Visualize Training Curves

Metrics append to:

```bash
.hive-cache/metrics/training-metrics.jsonl
```

Open dashboard:

```bash
/hive/training
```
