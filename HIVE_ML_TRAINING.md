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
npm run hive:train:az:async -- --duration-minutes 0 --selfplay-workers 4 --chunk-games 4 --train-interval-seconds 180 --min-replay-samples 1200 --min-new-samples 320 --continue-on-error
```

Async training with local arena workers overridden plus extra arena workers on a laptop over SSH:

```bash
npm run hive:train:az:async -- --arena-workers 6 --arena-remote-worker "host=daniel@laptop-wsl,repo=/home/daniel/Documents/Projects/daniel-huaiyao,workers=4"
```

Async training with remote arena workers plus remote self-play chunk workers on a laptop over SSH:

```bash
npm run hive:train:az:async -- --arena-workers 6 --arena-remote-worker "host=arena-laptop,repo=C:\\Users\\dan-d\\daniel-huaiyao-arena-worker,workers=6" --selfplay-remote-worker "host=arena-laptop,repo=C:\\Users\\dan-d\\daniel-huaiyao-arena-worker,workers=6"
```

More stable async preset with stronger champion anchoring, lighter reanalysis, and earlier best-checkpoint retention:

```bash
npm run hive:train:az:async:stable
```

The stable preset now requests laptop offload by default with `6` remote arena workers and `6` remote self-play workers. Remote self-play uses the full configured slots while idle and throttles down to `2` slots during arena or training overlap so the laptop stays responsive for arena work.

March 19 style async preset matching the strong fixed-budget run recipe that produced the two `80%` arena promotions:

```bash
npm run hive:train:az:async:march19
```

Back up the Hive training code to GitHub after changing the trainer:

```bash
npm run hive:backup:code -- --message "hive: tune march19 recipe"
```

Include the currently deployed Hive model in that backup too:

```bash
npm run hive:backup:code -- --with-model --message "hive: tune march19 recipe + model"
```

Train then run arena explicitly:

```bash
npm run hive:train:az:eval -- --games 240 --epochs 26 --arena --games 400 --pass-score 0.55
```

Manual arena gate only:

```bash
npm run hive:eval:arena -- --candidate-model .hive-cache/az-candidate-model.json --champion-model lib/hive/trained-model.json --games 400 --pass-score 0.55
npm run hive:eval:arena -- --gate-mode sprt --sprt-alpha 0.05 --sprt-beta 0.05 --sprt-margin 0.05
npm run hive:eval:arena -- --candidate-model .hive-cache/az-candidate-model.json --champion-model lib/hive/trained-model.json --games 400 --workers 6 --remote-worker "host=daniel@laptop-wsl,repo=/home/daniel/Documents/Projects/daniel-huaiyao,workers=4"
```

### Remote Arena + Self-Play Workers Over SSH

Arena evaluation and async self-play can offload extra worker processes to a laptop while keeping replay merging, promotion decisions, metrics, and model outputs on the PC.

Prerequisites:

- The PC can `ssh` and `scp` to the laptop with key-based auth.
- The laptop exposes a POSIX shell target, such as WSL on Windows.
- The laptop has this repo checked out at the `repo=` path and `npm install` has already been run there.
- The remote machine has `node` available on `PATH`.

Remote worker spec format:

```text
host=<ssh-target>,repo=<absolute-remote-repo-root>,workers=<n>
```

Behavior:

- If `repo=` is a POSIX path like `/home/daniel/...`, the PC launches the worker with `sh -lc ...`.
- If `repo=` is a Windows path like `C:\Users\dan-d\...` or `C:/Users/dan-d/...`, the PC launches the worker with Windows OpenSSH + PowerShell instead.

During arena startup the PC copies the current candidate and champion model to:

```text
<repo>/.hive-cache/remote-arena/<run-id>/
```

During async remote self-play the PC copies the selected learner or champion model to:

```text
<repo>/.hive-cache/remote-selfplay/<run-id>/
```

Then it launches `node --import tsx scripts/hive/az-selfplay-worker.ts ...` over SSH on the laptop, copies the generated chunk JSON back to the PC, merges it locally, and cleans up that remote temp directory.

During arena startup the PC copies the current candidate and champion model to:

```text
<repo>/.hive-cache/remote-arena/<run-id>/
```

Then it launches `node --import tsx scripts/hive/eval-arena.ts --worker-mode ...` over SSH on the laptop and cleans up that remote temp directory when the arena finishes.

Windows OpenSSH example:

```bash
npm run hive:eval:arena -- --candidate-model .hive-cache/az-candidate-model.json --champion-model lib/hive/trained-model.json --games 400 --workers 6 --remote-worker "host=arena-laptop,repo=C:\\Users\\dan-d\\daniel-huaiyao-arena-worker,workers=4"
```

Windows OpenSSH async self-play example:

```bash
npm run hive:train:az:async -- --selfplay-remote-worker "host=arena-laptop,repo=C:\\Users\\dan-d\\daniel-huaiyao-arena-worker,workers=6"
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
