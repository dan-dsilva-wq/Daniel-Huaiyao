import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyHiveMove,
  chooseHiveMoveForColor,
  createLocalHiveGameState,
  getLegalMovesForColor,
  oppositeColor,
  type HiveComputerDifficulty,
  type HiveSearchEngine,
  type HiveSearchStats,
} from '../../lib/hive/ai';
import { parseHiveModel, type HiveModel } from '../../lib/hive/ml';
import { getQueenSurroundCount } from '../../lib/hive/winCondition';
import type { Move, PlayerColor } from '../../lib/hive/types';
import type { HiveInspectTrace, HiveInspectTracePly } from '../../lib/hive/inspectTrace';

interface InspectOptions {
  candidateModelPath: string;
  championModelPath: string;
  difficulty: HiveComputerDifficulty;
  engine: HiveSearchEngine;
  simulations: number | null;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
  seed: number;
  candidateColor: PlayerColor;
  outPath: string;
}

const DEFAULT_OPTIONS: InspectOptions = {
  candidateModelPath: '.hive-cache/az-candidate-model.json',
  championModelPath: 'lib/hive/trained-model.json',
  difficulty: 'extreme',
  engine: 'alphazero',
  simulations: 260,
  maxTurns: 320,
  noCaptureDrawMoves: 100,
  openingRandomPlies: 4,
  seed: 2026,
  candidateColor: 'white',
  outPath: '.hive-cache/inspect/latest.json',
};

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const candidateModel = loadHiveModel(options.candidateModelPath);
  const championModel = loadHiveModel(options.championModelPath);
  const rng = createRng(options.seed);

  let state = createLocalHiveGameState({
    id: `inspect-${Date.now()}`,
    shortCode: 'INSP',
    whitePlayerId: options.candidateColor === 'white' ? 'candidate' : 'champion',
    blackPlayerId: options.candidateColor === 'black' ? 'candidate' : 'champion',
  });

  console.log(
    `[inspect:setup] seed=${options.seed} candidate_color=${options.candidateColor} difficulty=${options.difficulty} engine=${options.engine} sims=${options.simulations ?? 'default'}`,
  );
  console.log(`[inspect:setup] candidate=${candidateModel.path}`);
  console.log(`[inspect:setup] champion=${championModel.path}`);

  let noProgress = 0;
  let prevPressure = queenPressureTotal(state);
  let openingPly = 0;
  let moveCount = 0;
  const plies: HiveInspectTracePly[] = [];

  while (state.status === 'playing' && state.turnNumber <= options.maxTurns) {
    const activeColor = state.currentTurn;
    const isCandidateTurn = activeColor === options.candidateColor;
    const modelLabel = isCandidateTurn ? 'candidate' : 'champion';
    const legalMoves = getLegalMovesForColor(state, activeColor);
    let move: Move | null = null;
    let stats: HiveSearchStats | null = null;
    let selectionMode = 'search';

    if (openingPly < options.openingRandomPlies) {
      selectionMode = 'opening_random';
      if (legalMoves.length > 0) {
        move = legalMoves[Math.floor(rng() * legalMoves.length)];
      }
      openingPly += 1;
    } else {
      move = chooseHiveMoveForColor(
        state,
        activeColor,
        options.difficulty,
        {
          modelOverride: isCandidateTurn ? candidateModel.model : championModel.model,
          engine: options.engine,
          mctsConfig: options.simulations ? { simulations: options.simulations } : undefined,
          randomSeed: options.seed + state.turnNumber * 7919,
          onSearchStats: (value) => {
            stats = value;
          },
        },
      );
    }

    if (!move) {
      console.log(
        `[inspect:turn] turn=${state.turnNumber} color=${activeColor} player=${modelLabel} legal=${legalMoves.length} no_move=true`,
      );
      state = {
        ...state,
        status: 'finished',
        winner: oppositeColor(activeColor),
      };
      break;
    }

    moveCount += 1;
    const moveLabel = formatMove(move);
    const statsSuffix = stats
      ? ` sims=${stats.simulations} nodes_per_sec=${stats.nodesPerSecond.toFixed(1)} depth=${stats.averageSimulationDepth.toFixed(2)} entropy=${stats.policyEntropy.toFixed(3)} value=${stats.rootValue.toFixed(3)}`
      : '';
    console.log(
      `[inspect:turn] ply=${moveCount} turn=${state.turnNumber} color=${activeColor} player=${modelLabel} mode=${selectionMode} legal=${legalMoves.length} move=${moveLabel}${statsSuffix}`,
    );

    state = applyHiveMove(state, move);
    const whiteQueenPressure = getQueenSurroundCount(state.board, 'white');
    const blackQueenPressure = getQueenSurroundCount(state.board, 'black');
    plies.push({
      ply: moveCount,
      turn: state.turnNumber - 1,
      color: activeColor,
      player: modelLabel,
      mode: selectionMode as 'opening_random' | 'search',
      legalMoves: legalMoves.length,
      moveLabel,
      stateAfter: state,
      whiteQueenPressure,
      blackQueenPressure,
      stats: stats
        ? {
            simulations: stats.simulations,
            nodesPerSecond: stats.nodesPerSecond,
            averageSimulationDepth: stats.averageSimulationDepth,
            policyEntropy: stats.policyEntropy,
            rootValue: stats.rootValue,
          }
        : null,
    });

    const pressure = queenPressureTotal(state);
    if (pressure === prevPressure) noProgress += 1;
    else {
      noProgress = 0;
      prevPressure = pressure;
    }

    console.log(
      `[inspect:board] ply=${moveCount} board=${state.board.length} white_q_pressure=${whiteQueenPressure} black_q_pressure=${blackQueenPressure} next=${state.currentTurn}`,
    );

    if (options.noCaptureDrawMoves > 0 && noProgress >= options.noCaptureDrawMoves) {
      state = {
        ...state,
        status: 'finished',
        winner: 'draw',
      };
      console.log(
        `[inspect:stop] reason=no_progress_draw threshold=${options.noCaptureDrawMoves} streak=${noProgress}`,
      );
      break;
    }
  }

  if (state.status === 'playing') {
    state = {
      ...state,
      status: 'finished',
      winner: 'draw',
    };
    console.log(`[inspect:stop] reason=max_turns limit=${options.maxTurns}`);
  }

  const winnerLabel = state.winner ?? 'draw';
  const candidateWon = winnerLabel === options.candidateColor;
  const trace: HiveInspectTrace = {
    createdAt: new Date().toISOString(),
    seed: options.seed,
    candidateColor: options.candidateColor,
    candidateModelPath: path.resolve(process.cwd(), options.candidateModelPath),
    championModelPath: path.resolve(process.cwd(), options.championModelPath),
    difficulty: options.difficulty,
    engine: options.engine,
    simulations: options.simulations,
    maxTurns: options.maxTurns,
    noCaptureDrawMoves: options.noCaptureDrawMoves,
    openingRandomPlies: options.openingRandomPlies,
    winner: winnerLabel,
    candidateResult: candidateWon ? 'win' : winnerLabel === 'draw' ? 'draw' : 'loss',
    finalTurn: state.turnNumber,
    plies,
  };
  const outPath = path.resolve(process.cwd(), options.outPath);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
  const htmlPath = outPath.replace(/\.json$/i, '.html');
  writeFileSync(htmlPath, renderTraceHtml(trace), 'utf8');
  console.log(`[inspect:trace] saved=${outPath}`);
  console.log(`[inspect:html] saved=${htmlPath}`);
  console.log(
    `[inspect:done] winner=${winnerLabel} candidate_result=${candidateWon ? 'win' : winnerLabel === 'draw' ? 'draw' : 'loss'} turns=${state.turnNumber} board=${state.board.length}`,
  );
}

function loadHiveModel(relativePath: string): { model: HiveModel; path: string } {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Model path not found: ${relativePath}`);
  }
  const raw = readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  const model = parseHiveModel(parsed);
  if (!model) {
    throw new Error(`Invalid model file: ${relativePath}`);
  }
  return { model, path: absolutePath };
}

function formatMove(move: Move): string {
  if (move.type === 'place') {
    return `place:${move.pieceId}@(${move.to.q},${move.to.r})`;
  }
  const from = move.from ? `(${move.from.q},${move.from.r})` : '(?,?)';
  const pillbug = move.isPillbugAbility ? ':pillbug' : '';
  const target = move.targetPieceId ? ` target=${move.targetPieceId}` : '';
  return `move${pillbug}:${move.pieceId} ${from}->(${move.to.q},${move.to.r})${target}`;
}

function queenPressureTotal(state: ReturnType<typeof createLocalHiveGameState>): number {
  return getQueenSurroundCount(state.board, 'white') + getQueenSurroundCount(state.board, 'black');
}

function createRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function parseOptions(argv: string[]): InspectOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelpAndExit();
  }

  const options: InspectOptions = { ...DEFAULT_OPTIONS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case '--candidate-model':
        if (!next) throw new Error('Missing value for --candidate-model');
        options.candidateModelPath = next;
        index += 1;
        break;
      case '--champion-model':
        if (!next) throw new Error('Missing value for --champion-model');
        options.championModelPath = next;
        index += 1;
        break;
      case '--difficulty':
        if (!isDifficulty(next)) throw new Error(`Invalid --difficulty value: ${next}`);
        options.difficulty = next;
        index += 1;
        break;
      case '--engine':
        if (!isEngine(next)) throw new Error(`Invalid --engine value: ${next}`);
        options.engine = next;
        index += 1;
        break;
      case '--simulations':
        options.simulations = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--max-turns':
        options.maxTurns = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--no-capture-draw':
        options.noCaptureDrawMoves = parsePositiveInt(next, arg);
        index += 1;
        break;
      case '--opening-random-plies':
        options.openingRandomPlies = parseNonNegativeInt(next, arg);
        index += 1;
        break;
      case '--seed':
        options.seed = parseInteger(next, arg);
        index += 1;
        break;
      case '--candidate-color':
        if (next !== 'white' && next !== 'black') {
          throw new Error(`Invalid --candidate-color value: ${next}`);
        }
        options.candidateColor = next;
        index += 1;
        break;
      case '--out':
        if (!next) throw new Error('Missing value for --out');
        options.outPath = next;
        index += 1;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown argument: ${arg}`);
        }
        break;
    }
  }
  return options;
}

function isDifficulty(value: string | undefined): value is HiveComputerDifficulty {
  return value === 'medium' || value === 'hard' || value === 'extreme';
}

function isEngine(value: string | undefined): value is HiveSearchEngine {
  return value === 'classic' || value === 'alphazero' || value === 'gumbel';
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag} value: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag} value: ${value}`);
  }
  return parsed;
}

function parseInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${flag} value: ${value}`);
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log('Usage: tsx scripts/hive/inspect-game.ts [options]');
  console.log('  --candidate-model <path>     Candidate model path');
  console.log('  --champion-model <path>      Opponent/champion model path');
  console.log('  --candidate-color <white|black>');
  console.log('  --difficulty <medium|hard|extreme>');
  console.log('  --engine <classic|alphazero|gumbel>');
  console.log('  --simulations <n>');
  console.log('  --max-turns <n>');
  console.log('  --no-capture-draw <n>');
  console.log('  --opening-random-plies <n>');
  console.log('  --seed <n>');
  console.log('  --out <path>');
  process.exit(0);
}

function renderTraceHtml(trace: HiveInspectTrace): string {
  const payload = JSON.stringify(trace).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hive Inspect</title>
  <style>
    :root {
      --bg: #efe4d2;
      --panel: rgba(255,255,255,0.82);
      --line: rgba(80,54,31,0.18);
      --text: #2f241b;
      --muted: #766252;
      --accent: #1f2937;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top, #f6d6ad, transparent 30%),
        linear-gradient(180deg, #f6efe5, var(--bg));
    }
    .page {
      max-width: 1320px;
      margin: 0 auto;
      padding: 24px;
    }
    .hero { margin-bottom: 18px; }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.28em;
      text-transform: uppercase;
      color: var(--muted);
    }
    h1 {
      margin: 10px 0 8px;
      font-size: 38px;
      line-height: 1;
    }
    .subtitle {
      color: var(--muted);
      font-size: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) 360px;
      gap: 20px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 28px;
      box-shadow: 0 30px 80px rgba(90,56,24,0.14);
      backdrop-filter: blur(12px);
    }
    .board-panel { padding: 18px; }
    .side-panel { padding: 18px; }
    .board-wrap {
      width: 100%;
      aspect-ratio: 1.15 / 1;
      border-radius: 22px;
      overflow: hidden;
      background: radial-gradient(circle at top, #fff8ef, #efe2cf);
    }
    svg { width: 100%; height: 100%; display: block; }
    .controls {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    button {
      appearance: none;
      border: 1px solid #a38a72;
      background: white;
      color: var(--text);
      border-radius: 999px;
      padding: 10px 14px;
      font-size: 14px;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    input[type="range"] {
      width: 100%;
      margin-top: 12px;
      accent-color: var(--accent);
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 16px;
      background: rgba(255,255,255,0.72);
      margin-bottom: 14px;
    }
    .label {
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .value {
      margin-top: 8px;
      font-size: 28px;
      font-weight: 700;
      line-height: 1.1;
    }
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 14px;
    }
    .stat {
      background: rgba(245,241,236,0.95);
      border-radius: 18px;
      padding: 10px 12px;
    }
    .stat .k {
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .stat .v {
      margin-top: 6px;
      font-size: 14px;
      font-weight: 600;
    }
    .path {
      margin-top: 10px;
      word-break: break-all;
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <div class="eyebrow">Hive Inspect</div>
      <h1>Standalone Replay Viewer</h1>
      <div class="subtitle" id="subtitle"></div>
    </div>

    <div class="grid">
      <section class="panel board-panel">
        <div class="board-wrap">
          <svg id="board"></svg>
        </div>
        <div class="controls">
          <button id="prev">Prev</button>
          <button id="play" class="primary">Play</button>
          <button id="next">Next</button>
          <div id="counter" class="subtitle"></div>
        </div>
        <input id="slider" type="range" min="0" value="0" />
      </section>

      <aside class="panel side-panel">
        <div class="card">
          <div class="label">Current Move</div>
          <div class="value" id="moveLabel">Start</div>
          <div class="stats" id="metaStats"></div>
        </div>
        <div class="card">
          <div class="label">Search Stats</div>
          <div class="stats" id="searchStats"></div>
        </div>
        <div class="card">
          <div class="label">Models</div>
          <div class="path" id="candidatePath"></div>
          <div class="path" id="championPath"></div>
        </div>
      </aside>
    </div>
  </div>

  <script>
    const trace = ${payload};
    const HEX_SIZE = 38;
    const PIECE_LABELS = { queen: 'Q', beetle: 'B', grasshopper: 'G', spider: 'S', ant: 'A', ladybug: 'L', mosquito: 'M', pillbug: 'P' };
    const slider = document.getElementById('slider');
    const counter = document.getElementById('counter');
    const subtitle = document.getElementById('subtitle');
    const moveLabel = document.getElementById('moveLabel');
    const metaStats = document.getElementById('metaStats');
    const searchStats = document.getElementById('searchStats');
    const board = document.getElementById('board');
    const candidatePath = document.getElementById('candidatePath');
    const championPath = document.getElementById('championPath');
    const prevBtn = document.getElementById('prev');
    const nextBtn = document.getElementById('next');
    const playBtn = document.getElementById('play');
    let index = 0;
    let timer = null;

    subtitle.textContent = 'Seed ' + trace.seed + ' • candidate ' + trace.candidateColor + ' • ' + trace.engine + ' • winner ' + trace.winner;
    candidatePath.textContent = 'Candidate: ' + trace.candidateModelPath;
    championPath.textContent = 'Champion: ' + trace.championModelPath;
    slider.max = String(Math.max(0, trace.plies.length - 1));

    function coordKey(coord) {
      return coord.q + ',' + coord.r;
    }

    function axialToPixel(coord, size) {
      return { x: size * Math.sqrt(3) * (coord.q + coord.r / 2), y: size * 1.5 * coord.r };
    }

    function hexPoints(size) {
      const pts = [];
      for (let i = 0; i < 6; i += 1) {
        const angle = Math.PI / 3 * i - Math.PI / 6;
        pts.push((size * Math.cos(angle)) + ',' + (size * Math.sin(angle)));
      }
      return pts.join(' ');
    }

    function getTopPieceAt(boardState, coord) {
      let top = null;
      for (const piece of boardState) {
        if (piece.position.q === coord.q && piece.position.r === coord.r) {
          if (!top || piece.stackOrder > top.stackOrder) top = piece;
        }
      }
      return top;
    }

    function neighbors(coord) {
      return [
        { q: coord.q + 1, r: coord.r },
        { q: coord.q - 1, r: coord.r },
        { q: coord.q, r: coord.r + 1 },
        { q: coord.q, r: coord.r - 1 },
        { q: coord.q + 1, r: coord.r - 1 },
        { q: coord.q - 1, r: coord.r + 1 }
      ];
    }

    function buildCoords(boardState) {
      const map = new Map();
      if (!boardState.length) map.set('0,0', { q: 0, r: 0 });
      for (const piece of boardState) {
        map.set(coordKey(piece.position), piece.position);
        for (const n of neighbors(piece.position)) {
          map.set(coordKey(n), n);
        }
      }
      return Array.from(map.values());
    }

    function statCell(k, v) {
      return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
    }

    function render() {
      const ply = trace.plies[index] || null;
      const boardState = ply ? ply.stateAfter.board : [];
      const coords = buildCoords(boardState);
      const pixels = coords.map((coord) => axialToPixel(coord, HEX_SIZE));
      const minX = Math.min(...pixels.map((p) => p.x)) - HEX_SIZE * 1.8;
      const maxX = Math.max(...pixels.map((p) => p.x)) + HEX_SIZE * 1.8;
      const minY = Math.min(...pixels.map((p) => p.y)) - HEX_SIZE * 1.8;
      const maxY = Math.max(...pixels.map((p) => p.y)) + HEX_SIZE * 1.8;
      board.setAttribute('viewBox', [minX, minY, maxX - minX, maxY - minY].join(' '));

      let svg = '';
      for (const coord of coords) {
        const piece = getTopPieceAt(boardState, coord);
        const p = axialToPixel(coord, HEX_SIZE);
        const fill = piece ? (piece.color === 'white' ? '#fff9ef' : '#2f241b') : 'rgba(255,255,255,0.28)';
        const textFill = piece ? (piece.color === 'white' ? '#352515' : '#f7efe2') : '#000000';
        svg += '<g transform="translate(' + p.x + ',' + p.y + ')">';
        svg += '<polygon points="' + hexPoints(HEX_SIZE * 0.94) + '" fill="' + fill + '" stroke="rgba(92,60,34,0.35)" stroke-width="2"></polygon>';
        if (piece) {
          svg += '<text text-anchor="middle" dominant-baseline="central" font-size="' + (HEX_SIZE * 0.52) + '" font-weight="700" fill="' + textFill + '">' + (PIECE_LABELS[piece.type] || piece.type[0].toUpperCase()) + '</text>';
          if (piece.stackOrder > 0) {
            svg += '<text x="' + (HEX_SIZE * 0.36) + '" y="' + (-HEX_SIZE * 0.38) + '" text-anchor="middle" dominant-baseline="central" font-size="' + (HEX_SIZE * 0.22) + '" font-weight="700" fill="' + (piece.color === 'white' ? '#7c2d12' : '#fde68a') + '">' + (piece.stackOrder + 1) + '</text>';
          }
        }
        svg += '</g>';
      }
      board.innerHTML = svg;

      counter.textContent = 'Ply ' + (ply ? ply.ply : 0) + ' / ' + trace.plies.length;
      moveLabel.textContent = ply ? ply.moveLabel : 'Start';
      slider.value = String(index);

      if (ply) {
        metaStats.innerHTML =
          statCell('Player', ply.player) +
          statCell('Color', ply.color) +
          statCell('Turn', String(ply.turn)) +
          statCell('Mode', ply.mode) +
          statCell('Legal Moves', String(ply.legalMoves)) +
          statCell('White Pressure', String(ply.whiteQueenPressure)) +
          statCell('Black Pressure', String(ply.blackQueenPressure)) +
          statCell('Board Pieces', String(boardState.length));

        if (ply.stats) {
          searchStats.innerHTML =
            statCell('Simulations', String(ply.stats.simulations)) +
            statCell('Nodes/sec', ply.stats.nodesPerSecond.toFixed(1)) +
            statCell('Avg Depth', ply.stats.averageSimulationDepth.toFixed(2)) +
            statCell('Entropy', ply.stats.policyEntropy.toFixed(3)) +
            statCell('Root Value', ply.stats.rootValue.toFixed(3)) +
            statCell('Result', trace.candidateResult);
        } else {
          searchStats.innerHTML = '<div class="subtitle">Opening-random ply, no search stats.</div>';
        }
      }
    }

    function stop() {
      if (timer) window.clearInterval(timer);
      timer = null;
      playBtn.textContent = 'Play';
    }

    prevBtn.addEventListener('click', () => {
      stop();
      index = Math.max(0, index - 1);
      render();
    });
    nextBtn.addEventListener('click', () => {
      stop();
      index = Math.min(trace.plies.length - 1, index + 1);
      render();
    });
    slider.addEventListener('input', (event) => {
      stop();
      index = Number(event.target.value);
      render();
    });
    playBtn.addEventListener('click', () => {
      if (timer) {
        stop();
        return;
      }
      if (index >= trace.plies.length - 1) index = 0;
      playBtn.textContent = 'Pause';
      timer = window.setInterval(() => {
        if (index >= trace.plies.length - 1) {
          stop();
          return;
        }
        index += 1;
        render();
      }, 900);
    });

    render();
  </script>
</body>
</html>
`;
}

main();
