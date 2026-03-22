'use client';

import type { ReactNode } from 'react';
import type { MorseSymbol } from '@/lib/morse/types';

export function MorseCombatKey({
  liveSymbols,
  resolvedCharacter,
  decodedPreview,
  unitMs,
  isHolding,
  disabled,
  sideControls,
  onStart,
  onStop,
}: {
  liveSymbols: MorseSymbol[];
  resolvedCharacter: string;
  decodedPreview: string;
  unitMs: number;
  isHolding: boolean;
  disabled: boolean;
  sideControls?: ReactNode;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <div className="rounded-[1.75rem] border border-amber-300/20 bg-black/55 px-3 py-3 shadow-[0_28px_80px_rgba(0,0,0,0.46)] backdrop-blur-xl sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.28em] text-amber-200/65">Morse Key</div>
          <div className="mt-1 truncate text-sm text-amber-100/70">Hold and release to attack.</div>
        </div>
        <div className="shrink-0 rounded-full bg-white/8 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-100/75">
          {unitMs}ms
        </div>
      </div>

      <div className="mt-3 flex items-stretch gap-3">
        <div className="min-w-0 flex-1 rounded-[1.2rem] border border-white/10 bg-white/6 px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-amber-100/60">Signal</div>
          <div className="mt-2 min-h-8 font-mono text-2xl tracking-[0.3em] text-amber-200 sm:text-3xl">
            {liveSymbols.length > 0 ? liveSymbols.join('') : '...'}
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-amber-100/60">Decoded</div>
              <div className="mt-1 text-3xl font-black text-white sm:text-4xl">
                {decodedPreview || resolvedCharacter || '?'}
              </div>
            </div>
            {sideControls && <div className="flex items-center gap-2">{sideControls}</div>}
          </div>
        </div>

        <button
          disabled={disabled}
          onPointerDown={onStart}
          onPointerUp={onStop}
          onPointerLeave={onStop}
          onPointerCancel={onStop}
          onTouchEnd={onStop}
          className={`flex min-h-[118px] w-[118px] shrink-0 items-center justify-center rounded-[1.5rem] border px-3 text-center transition sm:min-h-[132px] sm:w-[132px] ${
            disabled
              ? 'cursor-not-allowed border-white/10 bg-white/5 text-white/35'
              : isHolding
                ? 'border-amber-300/75 bg-amber-300/20 text-white shadow-[0_0_40px_rgba(245,158,11,0.28)]'
                : 'border-amber-300/20 bg-[radial-gradient(circle_at_top,#3f2a14,transparent_55%),linear-gradient(180deg,#1f140d,#110d0b)] text-white'
          }`}
        >
          <div>
            <div className="text-[10px] uppercase tracking-[0.26em] text-amber-200/70">Touch</div>
            <div className="mt-2 text-3xl font-black sm:text-4xl">{isHolding ? 'KEYING' : 'KEY'}</div>
          </div>
        </button>
      </div>
    </div>
  );
}
