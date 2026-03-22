'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { HiveInspectTrace } from '@/lib/hive/inspectTrace';
import { axialToPixel, coordKey, getTopPieceAt } from '@/lib/hive/hexUtils';
import type { HexCoord, PlacedPiece } from '@/lib/hive/types';

const HEX_SIZE = 38;
const PIECE_EMOJIS: Record<string, string> = {
  queen: 'Q',
  beetle: 'B',
  grasshopper: 'G',
  spider: 'S',
  ant: 'A',
  ladybug: 'L',
  mosquito: 'M',
  pillbug: 'P',
};

export function InspectViewer({ trace }: { trace: HiveInspectTrace | null }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing || !trace || index >= trace.plies.length - 1) return undefined;
    const handle = window.setTimeout(() => setIndex((current) => Math.min(current + 1, trace.plies.length - 1)), 900);
    return () => window.clearTimeout(handle);
  }, [playing, trace, index]);

  useEffect(() => {
    if (!trace) return;
    setIndex(0);
    setPlaying(false);
  }, [trace]);

  const currentPly = trace?.plies[index] ?? null;
  const board = currentPly?.stateAfter.board ?? [];
  const boardState = useMemo(() => buildBoardState(board), [board]);

  if (!trace) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f5d0a9,transparent_35%),linear-gradient(180deg,#f6efe5,#e7ddcf)] px-6 py-10 text-stone-900">
        <div className="mx-auto max-w-4xl rounded-[2rem] border border-stone-300/70 bg-white/70 p-8 shadow-[0_30px_80px_rgba(90,56,24,0.15)] backdrop-blur">
          <p className="text-sm uppercase tracking-[0.28em] text-stone-500">Hive Inspect</p>
          <h1 className="mt-3 text-4xl font-semibold text-stone-900">No saved trace yet</h1>
          <p className="mt-4 max-w-2xl text-stone-700">
            Run `npm run hive:inspect:game` first. It now saves the latest game trace to `.hive-cache/inspect/latest.json`, and this page will visualize it.
          </p>
          <p className="mt-6 text-sm text-stone-600">
            Example: `npm run hive:inspect:game -- --candidate-model .hive-cache/az-learner-model.json --champion-model lib/hive/trained-model.json --seed 1337`
          </p>
          <div className="mt-8">
            <Link href="/hive" className="rounded-full border border-stone-400 px-4 py-2 text-sm text-stone-800 transition hover:bg-stone-100">
              Back To Hive
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#f5d0a9,transparent_35%),linear-gradient(180deg,#f6efe5,#e7ddcf)] px-4 py-6 text-stone-900 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Hive Inspect</p>
            <h1 className="mt-2 text-3xl font-semibold">Game Trace Viewer</h1>
            <p className="mt-2 text-sm text-stone-700">
              Seed {trace.seed} • candidate {trace.candidateColor} • {trace.engine} • winner {trace.winner ?? 'draw'}
            </p>
          </div>
          <Link href="/hive" className="rounded-full border border-stone-400 px-4 py-2 text-sm text-stone-800 transition hover:bg-stone-100">
            Open Hive
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_380px]">
          <section className="rounded-[2rem] border border-stone-300/70 bg-white/70 p-4 shadow-[0_30px_80px_rgba(90,56,24,0.15)] backdrop-blur sm:p-6">
            <div className="aspect-[1.15/1] overflow-hidden rounded-[1.5rem] bg-[radial-gradient(circle_at_top,#fff8ef,#efe2cf)]">
              <svg viewBox={`${boardState.minX} ${boardState.minY} ${boardState.width} ${boardState.height}`} className="h-full w-full">
                {boardState.coords.map((coord) => {
                  const piece = getTopPieceAt(board, coord);
                  return (
                    <HiveHex key={coordKey(coord)} coord={coord} piece={piece ?? undefined} />
                  );
                })}
              </svg>
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setIndex((current) => Math.max(0, current - 1));
                  }}
                  className="rounded-full border border-stone-400 px-4 py-2 text-sm transition hover:bg-stone-100"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (index >= trace.plies.length - 1) setIndex(0);
                    setPlaying((current) => !current);
                  }}
                  className="rounded-full bg-stone-900 px-4 py-2 text-sm text-stone-50 transition hover:bg-stone-700"
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setIndex((current) => Math.min(trace.plies.length - 1, current + 1));
                  }}
                  className="rounded-full border border-stone-400 px-4 py-2 text-sm transition hover:bg-stone-100"
                >
                  Next
                </button>
                <div className="text-sm text-stone-600">
                  Ply {currentPly?.ply ?? 0} / {trace.plies.length}
                </div>
              </div>

              <input
                type="range"
                min={0}
                max={Math.max(0, trace.plies.length - 1)}
                value={index}
                onChange={(event) => {
                  setPlaying(false);
                  setIndex(Number(event.target.value));
                }}
                className="w-full accent-stone-900"
              />
            </div>
          </section>

          <aside className="space-y-4">
            <motion.div layout className="rounded-[2rem] border border-stone-300/70 bg-white/70 p-5 shadow-[0_30px_80px_rgba(90,56,24,0.12)] backdrop-blur">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Current Move</p>
              <h2 className="mt-3 text-2xl font-semibold text-stone-900">{currentPly?.moveLabel ?? 'Start'}</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-stone-700">
                <Stat label="Player" value={currentPly?.player ?? '-'} />
                <Stat label="Color" value={currentPly?.color ?? '-'} />
                <Stat label="Turn" value={String(currentPly?.turn ?? 0)} />
                <Stat label="Mode" value={currentPly?.mode ?? '-'} />
                <Stat label="Legal Moves" value={String(currentPly?.legalMoves ?? 0)} />
                <Stat label="Board Pieces" value={String(board.length)} />
              </div>
            </motion.div>

            <div className="rounded-[2rem] border border-stone-300/70 bg-white/70 p-5 shadow-[0_30px_80px_rgba(90,56,24,0.12)] backdrop-blur">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Search Stats</p>
              {currentPly?.stats ? (
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-stone-700">
                  <Stat label="Simulations" value={String(currentPly.stats.simulations)} />
                  <Stat label="Nodes/sec" value={currentPly.stats.nodesPerSecond.toFixed(1)} />
                  <Stat label="Avg Depth" value={currentPly.stats.averageSimulationDepth.toFixed(2)} />
                  <Stat label="Entropy" value={currentPly.stats.policyEntropy.toFixed(3)} />
                  <Stat label="Root Value" value={currentPly.stats.rootValue.toFixed(3)} />
                  <Stat label="Trace Result" value={trace.candidateResult} />
                </div>
              ) : (
                <p className="mt-4 text-sm text-stone-600">Opening-random plies do not have search stats.</p>
              )}
            </div>

            <div className="rounded-[2rem] border border-stone-300/70 bg-white/70 p-5 shadow-[0_30px_80px_rgba(90,56,24,0.12)] backdrop-blur">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Pressure</p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-stone-700">
                <Stat label="White Queen" value={String(currentPly?.whiteQueenPressure ?? 0)} />
                <Stat label="Black Queen" value={String(currentPly?.blackQueenPressure ?? 0)} />
              </div>
            </div>

            <div className="rounded-[2rem] border border-stone-300/70 bg-white/70 p-5 shadow-[0_30px_80px_rgba(90,56,24,0.12)] backdrop-blur">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Models</p>
              <p className="mt-3 break-all text-sm text-stone-700">Candidate: {trace.candidateModelPath}</p>
              <p className="mt-2 break-all text-sm text-stone-700">Champion: {trace.championModelPath}</p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-stone-100/90 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{label}</div>
      <div className="mt-1 font-medium text-stone-900">{value}</div>
    </div>
  );
}

function HiveHex({ coord, piece }: { coord: HexCoord; piece?: PlacedPiece }) {
  const { x, y } = axialToPixel(coord, HEX_SIZE);
  return (
    <g transform={`translate(${x}, ${y})`}>
      <polygon
        points={getHexPoints(HEX_SIZE * 0.94)}
        fill={piece ? (piece.color === 'white' ? '#fff9ef' : '#2f241b') : 'rgba(255,255,255,0.28)'}
        stroke="rgba(92,60,34,0.35)"
        strokeWidth={2}
      />
      {piece ? (
        <>
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={HEX_SIZE * 0.52}
            fontWeight={700}
            fill={piece.color === 'white' ? '#352515' : '#f7efe2'}
          >
            {PIECE_EMOJIS[piece.type] ?? piece.type.slice(0, 1).toUpperCase()}
          </text>
          {piece.stackOrder > 0 ? (
            <text
              x={HEX_SIZE * 0.36}
              y={-HEX_SIZE * 0.38}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={HEX_SIZE * 0.22}
              fontWeight={700}
              fill={piece.color === 'white' ? '#7c2d12' : '#fde68a'}
            >
              {piece.stackOrder + 1}
            </text>
          ) : null}
        </>
      ) : null}
    </g>
  );
}

function getHexPoints(size: number): string {
  const points: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 3) * index - Math.PI / 6;
    points.push(`${size * Math.cos(angle)},${size * Math.sin(angle)}`);
  }
  return points.join(' ');
}

function buildBoardState(board: PlacedPiece[]) {
  const coordMap = new Map<string, HexCoord>();
  for (const piece of board) {
    coordMap.set(coordKey(piece.position), piece.position);
  }
  for (const piece of board) {
    const neighbors = [
      { q: piece.position.q + 1, r: piece.position.r },
      { q: piece.position.q - 1, r: piece.position.r },
      { q: piece.position.q, r: piece.position.r + 1 },
      { q: piece.position.q, r: piece.position.r - 1 },
      { q: piece.position.q + 1, r: piece.position.r - 1 },
      { q: piece.position.q - 1, r: piece.position.r + 1 },
    ];
    for (const neighbor of neighbors) {
      coordMap.set(coordKey(neighbor), neighbor);
    }
  }
  if (coordMap.size === 0) {
    coordMap.set('0,0', { q: 0, r: 0 });
  }
  const coords = [...coordMap.values()];
  const pixels = coords.map((coord) => axialToPixel(coord, HEX_SIZE));
  const minRawX = Math.min(...pixels.map((point) => point.x)) - HEX_SIZE * 1.8;
  const maxRawX = Math.max(...pixels.map((point) => point.x)) + HEX_SIZE * 1.8;
  const minRawY = Math.min(...pixels.map((point) => point.y)) - HEX_SIZE * 1.8;
  const maxRawY = Math.max(...pixels.map((point) => point.y)) + HEX_SIZE * 1.8;
  return {
    coords,
    minX: minRawX,
    minY: minRawY,
    width: maxRawX - minRawX,
    height: maxRawY - minRawY,
  };
}
