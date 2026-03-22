'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { getCurrentUser, setCurrentUser, type CurrentUser } from '@/lib/user-session';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { MorseToneManager } from '@/lib/morse/audio';
import { MORSE_CAMPAIGN_LEVELS, MORSE_POWER_CATALOG, MORSE_TOWER_CATALOG } from '@/lib/morse/content';
import {
  TEAM_PROGRESS_STORAGE_KEY,
  calculateUnitMs,
  classifySymbol,
  createEmptyTeamProgress,
  decodeSymbols,
  makeTransmissionId,
  mergeTeamProgress,
} from '@/lib/morse/core';
import {
  activatePower,
  applyDefenseTransmission,
  buildRunSummary,
  buyPowerCharge,
  buyTower,
  createInitialRunSnapshot,
  startNextWave,
  stepRunSnapshot,
  upgradeTower,
} from '@/lib/morse/game';
import { CASTLE_MOUNT_ORDER, getMountDefinition } from '@/lib/morse/scene';
import { MorseBattlefieldScene } from './MorseBattlefieldScene';
import { MorseCombatKey } from './MorseCombatKey';
import type {
  MorsePlayer,
  MorsePowerType,
  MorseRun,
  MorseRunSnapshot,
  MorseSymbol,
  MorseTeamProgress,
  MorseTower,
  MorseTowerMountId,
  MorseTowerType,
} from '@/lib/morse/types';

type BattleMode = 'campaign' | 'endless';

type RunActionPayload = {
  user?: MorsePlayer;
  kind: 'launch' | 'buy-tower' | 'buy-power' | 'use-power' | 'upgrade-tower';
  towerType?: MorseTowerType;
  powerType?: MorsePowerType;
  towerId?: string;
  mountId?: MorseTowerMountId;
};

type TeamProgressRow = {
  id?: string;
  unlocked_campaign_level?: number;
  endless_unlocked?: boolean;
  meta_currency?: number;
  unlocked_towers?: string[];
  unlocked_powers?: string[];
  permanent_upgrades?: MorseTeamProgress['permanentUpgrades'];
  records?: MorseTeamProgress['records'];
};

const DEFAULT_WPM = 16;
const WAVE_BANNER_MS = 1700;
const TOAST_MS = 1800;

function IdentityGate({ onSelect }: { onSelect: (user: CurrentUser) => void }) {
  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top,#4f2f17,transparent_45%),linear-gradient(180deg,#1d120c,#0e0a08_52%,#080706)] text-amber-50">
      <div className="mx-auto flex min-h-[100dvh] max-w-4xl items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl rounded-[2rem] border border-amber-300/15 bg-white/6 p-8 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">Morse Keep</p>
          <h1 className="mt-4 text-4xl font-serif font-bold">Who takes the wall?</h1>
          <p className="mt-3 text-amber-100/80">Pick your tower before the siege begins.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <button onClick={() => onSelect('daniel')} className="rounded-3xl border border-sky-300/30 bg-sky-500/15 px-6 py-8 text-left">
              <div className="text-sm uppercase tracking-[0.25em] text-sky-200/80">Blue Tower</div>
              <div className="mt-2 text-2xl font-bold text-white">Daniel</div>
            </button>
            <button onClick={() => onSelect('huaiyao')} className="rounded-3xl border border-rose-300/30 bg-rose-500/15 px-6 py-8 text-left">
              <div className="text-sm uppercase tracking-[0.25em] text-rose-200/80">Rose Tower</div>
              <div className="mt-2 text-2xl font-bold text-white">Huaiyao</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseMode(value: string | null): BattleMode | null {
  if (value === 'campaign' || value === 'endless') return value;
  return null;
}

function clampLevel(input: number): number {
  if (!Number.isFinite(input)) return 1;
  return Math.max(1, Math.min(MORSE_CAMPAIGN_LEVELS.length, Math.floor(input)));
}

function modeLabel(mode: BattleMode): string {
  return mode === 'campaign' ? 'Campaign' : 'Endless';
}

function roleLabel(tower: MorseTower): string {
  switch (tower.type) {
    case 'ballista':
      return 'Ballista';
    case 'lantern':
      return 'Lantern';
    case 'mint':
      return 'Quartermaster';
    case 'catapult':
      return 'Catapult';
  }
}

function useAnimationClock(active: boolean) {
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => {
      setClock(Date.now());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [active]);

  return clock;
}

function useViewportProfile() {
  const [profile, setProfile] = useState({
    isLandscape: false,
    requiresLandscape: false,
  });

  useEffect(() => {
    const update = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const touchCapable = 'ontouchstart' in window
        || navigator.maxTouchPoints > 0
        || window.matchMedia('(pointer: coarse)').matches;
      const mobileSized = Math.max(width, height) <= 1100;
      setProfile({
        isLandscape: width > height,
        requiresLandscape: touchCapable && mobileSized,
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return profile;
}

function requestBattleFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();

  const root = document.documentElement as HTMLElement & {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => void | Promise<void>;
    msRequestFullscreen?: () => void | Promise<void>;
  };

  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };

  if (doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement) {
    return Promise.resolve();
  }

  if (typeof root.requestFullscreen === 'function') {
    return root.requestFullscreen().catch(() => undefined);
  }

  if (typeof root.webkitRequestFullscreen === 'function') {
    return Promise.resolve(root.webkitRequestFullscreen()).then(() => undefined);
  }

  if (typeof root.msRequestFullscreen === 'function') {
    return Promise.resolve(root.msRequestFullscreen()).then(() => undefined);
  }

  return Promise.resolve();
}

function isModernSnapshot(value: unknown): value is MorseRunSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { enemies?: Array<{ pathProgress?: number }>; towers?: Array<{ mountId?: string }> };
  const enemiesOkay = Array.isArray(candidate.enemies)
    && (candidate.enemies.length === 0 || typeof candidate.enemies[0]?.pathProgress === 'number');
  const towersOkay = Array.isArray(candidate.towers)
    && (candidate.towers.length === 0 || typeof candidate.towers[0]?.mountId === 'string');
  return enemiesOkay && towersOkay;
}

function getUnlockedMountIds(teamProgress: MorseTeamProgress): MorseTowerMountId[] {
  return CASTLE_MOUNT_ORDER.slice(0, Math.min(CASTLE_MOUNT_ORDER.length, teamProgress.permanentUpgrades.towerSlots + 1));
}

function getSuggestedMountId(snapshot: MorseRunSnapshot, teamProgress: MorseTeamProgress): MorseTowerMountId | null {
  const unlockedMounts = getUnlockedMountIds(teamProgress);
  const emptyMount = unlockedMounts.find((mountId) => !snapshot.towers.some((tower) => tower.mountId === mountId));
  return emptyMount ?? snapshot.towers[0]?.mountId ?? unlockedMounts[0] ?? null;
}

function powerShortLabel(powerType: MorsePowerType): string {
  switch (powerType) {
    case 'volley':
      return 'VOL';
    case 'freeze':
      return 'ICE';
    case 'reveal':
      return 'RVE';
  }
}

function teamProgressFromRow(row: TeamProgressRow | null | undefined): MorseTeamProgress {
  if (!row) return createEmptyTeamProgress();
  return mergeTeamProgress({
    id: row.id ?? 'main',
    unlockedCampaignLevel: row.unlocked_campaign_level,
    endlessUnlocked: row.endless_unlocked,
    metaCurrency: row.meta_currency,
    unlockedTowers: row.unlocked_towers,
    unlockedPowers: row.unlocked_powers,
    permanentUpgrades: row.permanent_upgrades,
    records: row.records,
  });
}

function applyRunRewardsToTeam(previous: MorseTeamProgress, snapshot: MorseRunSnapshot): MorseTeamProgress {
  const outcome: 'victory' | 'defeat' = snapshot.phase === 'victory' ? 'victory' : 'defeat';
  const bestCampaignLevel = snapshot.mode === 'campaign' && outcome === 'victory'
    ? Math.max(previous.records.bestCampaignLevel, snapshot.levelNumber)
    : previous.records.bestCampaignLevel;
  const bestEndlessWave = snapshot.mode === 'endless'
    ? Math.max(previous.records.bestEndlessWave, snapshot.waveNumber)
    : previous.records.bestEndlessWave;
  const recentRun = {
    id: snapshot.id ?? makeTransmissionId('run'),
    mode: snapshot.mode,
    levelNumber: snapshot.levelNumber,
    wave: snapshot.mode === 'endless' ? snapshot.waveNumber : snapshot.levelNumber,
    score: snapshot.score,
    outcome,
    completedAt: new Date().toISOString(),
  };

  return mergeTeamProgress({
    ...previous,
    unlockedCampaignLevel: snapshot.mode === 'campaign' && outcome === 'victory'
      ? Math.max(previous.unlockedCampaignLevel, Math.min(MORSE_CAMPAIGN_LEVELS.length, snapshot.levelNumber + 1))
      : previous.unlockedCampaignLevel,
    endlessUnlocked: previous.endlessUnlocked || (snapshot.mode === 'campaign' && snapshot.levelNumber >= MORSE_CAMPAIGN_LEVELS.length && outcome === 'victory'),
    metaCurrency: previous.metaCurrency + snapshot.metaReward,
    records: {
      bestCampaignLevel,
      bestEndlessWave,
      bestScore: Math.max(previous.records.bestScore, snapshot.score),
      totalSignals: previous.records.totalSignals + snapshot.signalsUsed,
      totalRuns: previous.records.totalRuns + 1,
      recentRuns: [recentRun, ...previous.records.recentRuns].slice(0, 8),
    },
  });
}

export function MorseDefenseBattle() {
  useMarkAppViewed('morse');

  const router = useRouter();
  const searchParams = useSearchParams();
  const battleMode = parseMode(searchParams.get('mode'));
  const levelNumber = clampLevel(Number.parseInt(searchParams.get('level') ?? '1', 10));
  const isCoOpRequest = searchParams.get('coop') === '1';
  const runId = searchParams.get('run');
  const joinRequested = searchParams.get('join') === '1';

  const [currentUserState, setCurrentUserState] = useState<CurrentUser | null>(() => (typeof window === 'undefined' ? null : getCurrentUser()));
  const [teamProgress, setTeamProgress] = useState<MorseTeamProgress>(createEmptyTeamProgress());
  const [teamLoaded, setTeamLoaded] = useState(false);
  const [activeRun, setActiveRun] = useState<MorseRun | null>(null);
  const [runSnapshot, setRunSnapshot] = useState<MorseRunSnapshot | null>(null);
  const [isRunHost, setIsRunHost] = useState(false);
  const [battleStatus, setBattleStatus] = useState('Preparing the battleground.');
  const [liveSymbols, setLiveSymbols] = useState<MorseSymbol[]>([]);
  const [decodedPreview, setDecodedPreview] = useState('');
  const [resolvedCharacter, setResolvedCharacter] = useState('');
  const [isHolding, setIsHolding] = useState(false);
  const [waveBanner, setWaveBanner] = useState('');
  const [shakeAt, setShakeAt] = useState<number | null>(null);
  const [selectedMountId, setSelectedMountId] = useState<MorseTowerMountId | null>(null);
  const [manualHintEnemyId, setManualHintEnemyId] = useState<string | null>(null);
  const [manualHintUntil, setManualHintUntil] = useState(0);
  const [smartHintUntil, setSmartHintUntil] = useState(0);
  const [toastMessage, setToastMessage] = useState('');
  const [toastToken, setToastToken] = useState(0);
  const [hasPressedStart, setHasPressedStart] = useState(false);

  const currentUser = currentUserState as MorsePlayer | null;
  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : currentUser === 'huaiyao' ? 'Daniel' : 'your partner';
  const unitMs = useMemo(() => calculateUnitMs(DEFAULT_WPM), []);
  const clock = useAnimationClock(Boolean(runSnapshot));
  const { isLandscape, requiresLandscape } = useViewportProfile();
  const orientationLockedOut = requiresLandscape && !isLandscape;
  const unlockedTowerCatalog = useMemo(() => MORSE_TOWER_CATALOG.filter((tower) => teamProgress.unlockedTowers.includes(tower.type)), [teamProgress.unlockedTowers]);
  const buildMode = runSnapshot?.phase === 'waiting' || runSnapshot?.phase === 'shop';
  const canManageRun = isRunHost || !activeRun;
  const controlsDisabled = !runSnapshot || runSnapshot.phase !== 'playing' || orientationLockedOut || !hasPressedStart;
  const waitingForPartner = Boolean(activeRun && runSnapshot?.phase === 'waiting' && !runSnapshot.partnerJoined);

  const toneRef = useRef<MorseToneManager | null>(null);
  const pressStartRef = useRef<number | null>(null);
  const charTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSymbolsRef = useRef<MorseSymbol[]>([]);
  const runChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const runSnapshotRef = useRef<MorseRunSnapshot | null>(null);
  const bootSignatureRef = useRef<string | null>(null);
  const previousWaveRef = useRef<number | null>(null);
  const previousCastleHealthRef = useRef<number | null>(null);
  const latestEventRef = useRef<string | null>(null);
  const lastSignalAtRef = useRef(Date.now());
  const completionHandledRef = useRef<string | null>(null);
  const latestHeavyShotRef = useRef<string | null>(null);

  useEffect(() => {
    runSnapshotRef.current = runSnapshot;
  }, [runSnapshot]);

  useEffect(() => {
    setHasPressedStart(false);
    setActiveRun(null);
    setRunSnapshot(null);
    setIsRunHost(false);
    setSelectedMountId(null);
    setBattleStatus('Prepare the battleground.');
    bootSignatureRef.current = null;
    completionHandledRef.current = null;
  }, [battleMode, currentUser, isCoOpRequest, joinRequested, levelNumber, runId]);

  const persistTeam = useCallback(async (nextTeam: MorseTeamProgress) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TEAM_PROGRESS_STORAGE_KEY, JSON.stringify(nextTeam));
    }
    if (isSupabaseConfigured) {
      await supabase.from('morse_team_progress').upsert({
        id: 'main',
        unlocked_campaign_level: nextTeam.unlockedCampaignLevel,
        endless_unlocked: nextTeam.endlessUnlocked,
        meta_currency: nextTeam.metaCurrency,
        unlocked_towers: nextTeam.unlockedTowers,
        unlocked_powers: nextTeam.unlockedPowers,
        permanent_upgrades: nextTeam.permanentUpgrades,
        records: nextTeam.records,
        updated_at: new Date().toISOString(),
      });
    }
  }, []);

  const notifyPartner = useCallback(async (action: 'morse_run_started', title: string) => {
    if (!currentUser) return false;
    try {
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          title,
          user: currentUser,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }, [currentUser]);

  const applyLocalTeamReward = useCallback((snapshot: MorseRunSnapshot) => {
    setTeamProgress((previous) => {
      const next = applyRunRewardsToTeam(previous, snapshot);
      void persistTeam(next);
      return next;
    });
  }, [persistTeam]);

  useEffect(() => {
    if (typeof window === 'undefined' || !currentUser) return;

    const localTeam = mergeTeamProgress(JSON.parse(window.localStorage.getItem(TEAM_PROGRESS_STORAGE_KEY) ?? 'null') as Partial<MorseTeamProgress> | null);
    setTeamProgress(localTeam);
    setTeamLoaded(true);

    if (!isSupabaseConfigured) return;

    void (async () => {
      const { data, error } = await supabase.from('morse_team_progress').select('*').eq('id', 'main').maybeSingle();
      if (error || !data) return;
      setTeamProgress(teamProgressFromRow(data as TeamProgressRow));
    })();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !isSupabaseConfigured) return;

    const ping = () => supabase.rpc('update_presence', {
      p_player: currentUser,
      p_is_online: true,
      p_current_app: 'morse',
    });

    void ping();
    const interval = window.setInterval(() => {
      void ping();
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !teamLoaded || !hasPressedStart) return;

    const signature = [
      currentUser,
      runId ?? 'new',
      battleMode ?? 'none',
      levelNumber,
      isCoOpRequest ? 'coop' : 'solo',
      joinRequested ? 'join' : 'direct',
    ].join('|');

    if (bootSignatureRef.current === signature) return;
    bootSignatureRef.current = signature;
    completionHandledRef.current = null;

    let cancelled = false;
    setBattleStatus(runId ? 'Loading the wall...' : 'Raising the keep...');
    setActiveRun(null);
    setRunSnapshot(null);
    setIsRunHost(false);

    void (async () => {
      if (runId) {
        if (!isSupabaseConfigured) {
          if (!cancelled) setBattleStatus('This shared battle needs Supabase to sync.');
          return;
        }

        const { data, error } = await supabase.from('morse_runs').select('*').eq('id', runId).maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setBattleStatus('That battle could not be found.');
          return;
        }

        let runRow = data as MorseRun;
        if (joinRequested && runRow.guest_player === null && runRow.host_player !== currentUser) {
          const joinRes = await supabase.rpc('join_morse_run', {
            p_run_id: runId,
            p_guest_player: currentUser,
          });
          if (!joinRes.error && joinRes.data) {
            runRow = joinRes.data as MorseRun;
          }
        }

        const amHost = runRow.host_player === currentUser;
        const partnerJoined = Boolean(runRow.guest_player);
        const checkpoint = isModernSnapshot(runRow.checkpoint) ? runRow.checkpoint : null;
        const snapshot = checkpoint
          ? {
              ...checkpoint,
              id: runRow.id,
              partnerJoined: checkpoint.partnerJoined || partnerJoined,
              partnerOnline: checkpoint.partnerOnline || partnerJoined,
            }
          : {
              ...createInitialRunSnapshot(runRow.mode, runRow.level_number, teamProgress, partnerJoined, runRow.status !== 'waiting'),
              id: runRow.id,
            };

        setActiveRun(runRow);
        setRunSnapshot(snapshot);
        setIsRunHost(amHost);
        setSelectedMountId(getSuggestedMountId(snapshot, teamProgress));
        setBattleStatus(amHost
          ? (snapshot.phase === 'waiting' ? 'Waiting for your partner to take the wall.' : 'The keep stands ready.')
          : 'You have joined the defense.');
        return;
      }

      if (!battleMode) {
        setBattleStatus('Open a battle from the Defense tab in Morse Keep.');
        return;
      }

      if (battleMode === 'endless' && !teamProgress.endlessUnlocked) {
        setBattleStatus('Endless mode unlocks after clearing the campaign.');
        return;
      }

      if (isCoOpRequest && isSupabaseConfigured) {
        const startRes = await supabase.rpc('start_morse_run', {
          p_host_player: currentUser,
          p_mode: battleMode,
          p_level_number: levelNumber,
          p_expect_partner: true,
          p_checkpoint: null,
        });

        if (cancelled) return;

        if (!startRes.error && startRes.data) {
          const runRow = startRes.data as MorseRun;
          const snapshot = {
            ...createInitialRunSnapshot(battleMode, levelNumber, teamProgress, false, false),
            id: runRow.id,
          };
          setActiveRun(runRow);
          setRunSnapshot(snapshot);
          setIsRunHost(true);
          setSelectedMountId(getSuggestedMountId(snapshot, teamProgress));
          setBattleStatus('Signal sent. Waiting for your partner to join the wall.');
          void notifyPartner('morse_run_started', 'A Morse Keep defense is waiting.');
          return;
        }

        setBattleStatus('Could not open a shared battle. Starting solo instead.');
      }

      const snapshot = createInitialRunSnapshot(battleMode, levelNumber, teamProgress, false, true);
      setActiveRun(null);
      setRunSnapshot(snapshot);
      setIsRunHost(true);
      setSelectedMountId(getSuggestedMountId(snapshot, teamProgress));
      setBattleStatus('Solo defense underway.');
    })();

    return () => {
      cancelled = true;
    };
  }, [battleMode, currentUser, hasPressedStart, isCoOpRequest, joinRequested, levelNumber, notifyPartner, runId, teamLoaded, teamProgress]);

  useEffect(() => {
    if (!currentUser || !activeRun?.id || !isSupabaseConfigured) return;

    const channel = supabase.channel(`morse-run:${activeRun.id}`);
    runChannelRef.current = channel;

    channel
      .on('broadcast', { event: 'presence' }, ({ payload }) => {
        const data = payload as { user?: MorsePlayer };
        if (!data.user || data.user === currentUser) return;
        setRunSnapshot((previous) => previous ? { ...previous, partnerOnline: true, partnerJoined: true } : previous);
      })
      .on('broadcast', { event: 'snapshot' }, ({ payload }) => {
        if (isRunHost) return;
        const data = payload as { snapshot?: MorseRunSnapshot };
        if (data.snapshot) {
          setRunSnapshot(data.snapshot);
        }
      })
      .on('broadcast', { event: 'transmission' }, ({ payload }) => {
        if (!isRunHost) return;
        const data = payload as { user?: MorsePlayer; decodedText?: string };
        if (!data.user || !data.decodedText) return;
        const sendingUser = data.user;
        const decodedText = data.decodedText;
        setRunSnapshot((previous) => previous ? applyDefenseTransmission(previous, decodedText, sendingUser) : previous);
      })
      .on('broadcast', { event: 'action' }, ({ payload }) => {
        if (!isRunHost) return;
        const data = payload as RunActionPayload;
        setRunSnapshot((previous) => {
          if (!previous) return previous;
          switch (data.kind) {
            case 'launch':
              return previous.pendingWave ? startNextWave(previous, teamProgress) : previous;
            case 'buy-tower':
              return data.towerType && data.mountId ? buyTower(previous, data.towerType, data.mountId, teamProgress) : previous;
            case 'buy-power':
              return data.powerType ? buyPowerCharge(previous, data.powerType, teamProgress) : previous;
            case 'use-power':
              return data.powerType ? activatePower(previous, data.powerType) : previous;
            case 'upgrade-tower':
              return data.towerId ? upgradeTower(previous, data.towerId) : previous;
            default:
              return previous;
          }
        });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.send({
            type: 'broadcast',
            event: 'presence',
            payload: { user: currentUser },
          });
        }
      });

    const heartbeat = window.setInterval(() => {
      void channel.send({
        type: 'broadcast',
        event: 'presence',
        payload: { user: currentUser },
      });
    }, 4000);

    return () => {
      window.clearInterval(heartbeat);
      supabase.removeChannel(channel);
      runChannelRef.current = null;
    };
  }, [activeRun?.id, currentUser, isRunHost, teamProgress]);

  useEffect(() => {
    if (!runSnapshot || !isRunHost || runSnapshot.phase !== 'playing' || orientationLockedOut) return;
    const tick = window.setInterval(() => {
      setRunSnapshot((previous) => previous ? stepRunSnapshot(previous, 100) : previous);
    }, 100);
    return () => {
      window.clearInterval(tick);
    };
  }, [isRunHost, orientationLockedOut, runSnapshot?.phase, runSnapshot]);

  useEffect(() => {
    if (!activeRun?.id || !isRunHost || !runChannelRef.current) return;
    const publish = window.setInterval(() => {
      const snapshot = runSnapshotRef.current;
      if (!snapshot) return;
      void runChannelRef.current?.send({
        type: 'broadcast',
        event: 'snapshot',
        payload: { snapshot },
      });
    }, 280);
    return () => {
      window.clearInterval(publish);
    };
  }, [activeRun?.id, isRunHost]);

  useEffect(() => {
    if (!activeRun?.id || !isRunHost || !isSupabaseConfigured) return;
    const persist = window.setInterval(() => {
      const snapshot = runSnapshotRef.current;
      if (!snapshot || snapshot.phase === 'victory' || snapshot.phase === 'defeat') return;
      void supabase
        .from('morse_runs')
        .update({
          checkpoint: snapshot,
          status: snapshot.phase === 'waiting' ? 'waiting' : 'active',
          endless_wave: snapshot.mode === 'endless' ? snapshot.waveNumber : 0,
          score: snapshot.score,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeRun.id);
    }, 5000);
    return () => {
      window.clearInterval(persist);
    };
  }, [activeRun?.id, isRunHost]);

  useEffect(() => {
    if (!runSnapshot) return;
    if (previousWaveRef.current === null) {
      previousWaveRef.current = runSnapshot.waveNumber;
      if (runSnapshot.phase === 'playing') setWaveBanner(`Wave ${runSnapshot.waveNumber}`);
      return;
    }
    if (runSnapshot.waveNumber !== previousWaveRef.current) {
      previousWaveRef.current = runSnapshot.waveNumber;
      setWaveBanner(runSnapshot.mode === 'endless' ? `Wave ${runSnapshot.waveNumber}` : `Stage ${runSnapshot.waveNumber}`);
    }
  }, [runSnapshot]);

  useEffect(() => {
    if (!waveBanner) return;
    const timer = window.setTimeout(() => {
      setWaveBanner('');
    }, WAVE_BANNER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [waveBanner]);

  useEffect(() => {
    if (!runSnapshot) return;
    if (previousCastleHealthRef.current === null) {
      previousCastleHealthRef.current = runSnapshot.castleHealth;
      return;
    }
    if (runSnapshot.castleHealth < previousCastleHealthRef.current) {
      setShakeAt(Date.now());
    }
    previousCastleHealthRef.current = runSnapshot.castleHealth;
  }, [runSnapshot]);

  useEffect(() => {
    const latestHeavyShot = runSnapshot?.shots.filter((shot) => shot.kind === 'catapult').at(-1);
    if (!latestHeavyShot) return;
    if (latestHeavyShotRef.current === latestHeavyShot.id) return;
    latestHeavyShotRef.current = latestHeavyShot.id;
    setShakeAt(latestHeavyShot.createdAt);
  }, [runSnapshot?.shots]);

  useEffect(() => {
    const latestEvent = runSnapshot?.recentEvents[0];
    if (!latestEvent || latestEventRef.current === latestEvent) return;
    latestEventRef.current = latestEvent;
    setToastMessage(latestEvent);
    setToastToken((value) => value + 1);
    setBattleStatus(latestEvent);
  }, [runSnapshot?.recentEvents]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => {
      setToastMessage('');
    }, TOAST_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toastMessage]);

  useEffect(() => {
    if (!resolvedCharacter) return;
    const timer = window.setTimeout(() => {
      setResolvedCharacter('');
    }, 900);
    return () => {
      window.clearTimeout(timer);
    };
  }, [resolvedCharacter]);

  useEffect(() => {
    if (!runSnapshot || !buildMode) return;
    if (!selectedMountId || !getUnlockedMountIds(teamProgress).includes(selectedMountId)) {
      setSelectedMountId(getSuggestedMountId(runSnapshot, teamProgress));
    }
  }, [buildMode, runSnapshot, selectedMountId, teamProgress]);

  const frontEnemy = useMemo(() => {
    if (!runSnapshot) return null;
    return runSnapshot.enemies
      .filter((enemy) => enemy.pathProgress > 0)
      .sort((left, right) => right.pathProgress - left.pathProgress)[0] ?? null;
  }, [runSnapshot]);

  useEffect(() => {
    if (!runSnapshot || runSnapshot.phase !== 'playing' || !frontEnemy) return;
    if (smartHintUntil > clock) return;
    const hesitationMs = clock - lastSignalAtRef.current;
    const dangerThreshold = 58 - teamProgress.permanentUpgrades.revealAssistLevel * 4;
    if (hesitationMs > 2600 && frontEnemy.pathProgress >= dangerThreshold) {
      setSmartHintUntil(clock + 2200);
    }
  }, [clock, frontEnemy, runSnapshot, smartHintUntil, teamProgress.permanentUpgrades.revealAssistLevel]);

  const finishRun = useCallback(async (snapshot: MorseRunSnapshot) => {
    const completionKey = `${activeRun?.id ?? 'local'}:${snapshot.phase}:${snapshot.waveNumber}:${snapshot.score}`;
    if (completionHandledRef.current === completionKey) return;
    completionHandledRef.current = completionKey;

    const summary = buildRunSummary(snapshot);
    const waveValue = snapshot.mode === 'endless' ? snapshot.waveNumber : 0;

    if (activeRun?.id && isSupabaseConfigured) {
      const result = await supabase.rpc('complete_morse_run', {
        p_run_id: activeRun.id,
        p_completed_by: currentUser,
        p_score: snapshot.score,
        p_wave: waveValue,
        p_currency_earned: snapshot.metaReward,
        p_summary: summary,
      });

      if (!result.error && result.data) {
        const data = result.data as { team_progress?: TeamProgressRow };
        if (data.team_progress) {
          const nextTeam = teamProgressFromRow(data.team_progress);
          setTeamProgress(nextTeam);
          await persistTeam(nextTeam);
        } else {
          applyLocalTeamReward(snapshot);
        }
      } else {
        applyLocalTeamReward(snapshot);
      }

      setActiveRun((previous) => previous ? { ...previous, status: 'completed' } : previous);
      return;
    }

    applyLocalTeamReward(snapshot);
  }, [activeRun?.id, applyLocalTeamReward, currentUser, persistTeam]);

  useEffect(() => {
    if (!runSnapshot) return;
    if (runSnapshot.phase !== 'victory' && runSnapshot.phase !== 'defeat') return;
    void finishRun(runSnapshot);
  }, [finishRun, runSnapshot]);

  const broadcastAction = useCallback(async (payload: Omit<RunActionPayload, 'user'>) => {
    if (!activeRun?.id || !runChannelRef.current || !currentUser) return;
    await runChannelRef.current.send({
      type: 'broadcast',
      event: 'action',
      payload: {
        ...payload,
        user: currentUser,
      } satisfies RunActionPayload,
    });
  }, [activeRun?.id, currentUser]);

  const handleCombatCharacter = useCallback((character: string) => {
    if (!currentUser || !character || character === '?') return;
    lastSignalAtRef.current = Date.now();
    setResolvedCharacter(character);
    if (!runSnapshotRef.current || runSnapshotRef.current.phase !== 'playing') return;

    if (activeRun?.id && !isRunHost) {
      void runChannelRef.current?.send({
        type: 'broadcast',
        event: 'transmission',
        payload: {
          user: currentUser,
          decodedText: character,
        },
      });
      return;
    }

    setRunSnapshot((previous) => previous ? applyDefenseTransmission(previous, character, currentUser) : previous);
  }, [activeRun?.id, currentUser, isRunHost]);

  const finalizeCharacter = useCallback(() => {
    const symbols = [...currentSymbolsRef.current];
    if (symbols.length === 0) return;
    const decoded = decodeSymbols(symbols) ?? '?';
    currentSymbolsRef.current = [];
    setLiveSymbols([]);
    setDecodedPreview(decoded);
    handleCombatCharacter(decoded);
  }, [handleCombatCharacter]);

  const startSignal = useCallback(async () => {
    if (controlsDisabled || isHolding) return;
    setIsHolding(true);
    pressStartRef.current = performance.now();
    toneRef.current ??= new MorseToneManager();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(8);
    }
    await toneRef.current.start();
  }, [controlsDisabled, isHolding]);

  const stopSignal = useCallback(() => {
    if (!pressStartRef.current) return;
    const duration = performance.now() - pressStartRef.current;
    pressStartRef.current = null;
    setIsHolding(false);
    toneRef.current?.stop();
    const symbol = classifySymbol(duration, unitMs);
    lastSignalAtRef.current = Date.now();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(5);
    }
    currentSymbolsRef.current = [...currentSymbolsRef.current, symbol];
    setLiveSymbols([...currentSymbolsRef.current]);
    setDecodedPreview(decodeSymbols(currentSymbolsRef.current) ?? currentSymbolsRef.current.join(''));
    if (charTimerRef.current) clearTimeout(charTimerRef.current);
    charTimerRef.current = setTimeout(finalizeCharacter, Math.max(220, unitMs * 2.7));
  }, [finalizeCharacter, unitMs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const tagName = (event.target as HTMLElement | null)?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;
      if (event.code !== 'Space' || event.repeat) return;
      event.preventDefault();
      void startSignal();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const tagName = (event.target as HTMLElement | null)?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;
      if (event.code !== 'Space') return;
      event.preventDefault();
      stopSignal();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startSignal, stopSignal]);

  const launchWave = useCallback(() => {
    if (!runSnapshot?.pendingWave || !canManageRun || waitingForPartner) return;
    lastSignalAtRef.current = Date.now();
    if (activeRun?.id && !isRunHost) return;
    if (activeRun?.id && isRunHost) {
      void broadcastAction({ kind: 'launch' });
    }
    setRunSnapshot((previous) => previous?.pendingWave ? startNextWave(previous, teamProgress) : previous);
  }, [activeRun?.id, broadcastAction, canManageRun, isRunHost, runSnapshot?.pendingWave, teamProgress, waitingForPartner]);

  const handleTowerPurchase = useCallback((towerType: MorseTowerType, mountId: MorseTowerMountId) => {
    if (!runSnapshot) return;
    if (activeRun?.id && !isRunHost) {
      void broadcastAction({ kind: 'buy-tower', towerType, mountId });
      setBattleStatus('Build request sent to the host.');
      return;
    }
    setRunSnapshot((previous) => previous ? buyTower(previous, towerType, mountId, teamProgress) : previous);
  }, [activeRun?.id, broadcastAction, isRunHost, runSnapshot, teamProgress]);

  const handlePowerBuy = useCallback((powerType: MorsePowerType) => {
    if (!runSnapshot) return;
    if (activeRun?.id && !isRunHost) {
      void broadcastAction({ kind: 'buy-power', powerType });
      setBattleStatus('Supply request sent to the host.');
      return;
    }
    setRunSnapshot((previous) => previous ? buyPowerCharge(previous, powerType, teamProgress) : previous);
  }, [activeRun?.id, broadcastAction, isRunHost, runSnapshot, teamProgress]);

  const handlePowerUse = useCallback((powerType: MorsePowerType) => {
    if (!runSnapshot || runSnapshot.phase !== 'playing') return;
    if (activeRun?.id && !isRunHost) {
      void broadcastAction({ kind: 'use-power', powerType });
      return;
    }
    setRunSnapshot((previous) => previous ? activatePower(previous, powerType) : previous);
  }, [activeRun?.id, broadcastAction, isRunHost, runSnapshot]);

  const handleTowerUpgrade = useCallback((towerId: string) => {
    if (!runSnapshot) return;
    if (activeRun?.id && !isRunHost) {
      void broadcastAction({ kind: 'upgrade-tower', towerId });
      setBattleStatus('Upgrade request sent to the host.');
      return;
    }
    setRunSnapshot((previous) => previous ? upgradeTower(previous, towerId) : previous);
  }, [activeRun?.id, broadcastAction, isRunHost, runSnapshot]);

  const handleStartBattle = useCallback(async () => {
    if (orientationLockedOut) return;
    try {
      await requestBattleFullscreen();
      const maybeOrientation = (screen as Screen & { orientation?: { lock?: (orientation: string) => Promise<void> } }).orientation;
      if (requiresLandscape && typeof maybeOrientation?.lock === 'function') {
        await maybeOrientation.lock('landscape').catch(() => undefined);
      }
    } catch {
      // Ignore unsupported orientation lock attempts.
    }
    setBattleStatus('Battle ready.');
    setHasPressedStart(true);
  }, [orientationLockedOut, requiresLandscape]);

  useEffect(() => {
    return () => {
      if (charTimerRef.current) clearTimeout(charTimerRef.current);
      toneRef.current?.cleanup();
    };
  }, []);

  const modeForView = runSnapshot?.mode ?? battleMode ?? 'campaign';
  const levelForView = runSnapshot?.levelNumber ?? levelNumber;
  const levelConfig = modeForView === 'campaign' ? MORSE_CAMPAIGN_LEVELS[levelForView - 1] : null;
  const mountIds = getUnlockedMountIds(teamProgress);
  const selectedMount = selectedMountId ? getMountDefinition(selectedMountId) : null;
  const selectedTower = selectedMountId ? runSnapshot?.towers.find((tower) => tower.mountId === selectedMountId) ?? null : null;
  const hintedEnemyIds = useMemo(() => {
    const ids = new Set<string>();
    if (manualHintEnemyId && manualHintUntil > clock) ids.add(manualHintEnemyId);
    if (frontEnemy && smartHintUntil > clock) ids.add(frontEnemy.id);
    return [...ids];
  }, [clock, frontEnemy, manualHintEnemyId, manualHintUntil, smartHintUntil]);

  const dockControls = runSnapshot?.powers.map((power) => {
    const powerDef = MORSE_POWER_CATALOG.find((entry) => entry.type === power.type);
    if (!powerDef) return null;
    const cooling = power.cooldownUntil > clock;
    const disabled = buildMode
      ? runSnapshot.resources < powerDef.cost
      : power.charges <= 0 || cooling || runSnapshot.phase !== 'playing';

    return (
      <button
        key={power.type}
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (buildMode) {
            handlePowerBuy(power.type);
            return;
          }
          handlePowerUse(power.type);
        }}
        className={`rounded-full border px-3 py-2 text-[11px] font-black uppercase tracking-[0.22em] transition ${
          disabled
            ? 'border-white/8 bg-white/5 text-white/35'
            : 'border-amber-300/25 bg-amber-200/10 text-amber-100 hover:bg-amber-200/16'
        }`}
        title={buildMode ? `${powerDef.label} · ${powerDef.cost} supplies` : powerDef.label}
      >
        <div>{powerShortLabel(power.type)}</div>
        <div className="mt-1 text-[10px] tracking-[0.12em]">
          {buildMode ? powerDef.cost : power.charges}
        </div>
      </button>
    );
  }) ?? null;

  if (!currentUser) {
    return <IdentityGate onSelect={(user) => { setCurrentUser(user); setCurrentUserState(user); }} />;
  }

  if (!teamLoaded) {
    return (
      <div className="relative min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_top,#5b3519,transparent_38%),linear-gradient(180deg,#1b110b,#0a0807_62%,#050505)] text-amber-50">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.08),transparent_34%)]" />
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4">
          <div className="w-full max-w-xl rounded-[2rem] border border-amber-300/15 bg-black/30 p-8 text-center backdrop-blur-xl">
            <div className="mx-auto h-16 w-16 rounded-full border border-amber-200/20 bg-amber-200/10" />
            <p className="mt-6 text-xs uppercase tracking-[0.32em] text-amber-300/70">Morse Keep</p>
            <h1 className="mt-3 text-3xl font-serif font-bold text-white">Rallying the wall</h1>
            <p className="mt-4 text-amber-100/75">{battleStatus}</p>
            <div className="mt-8">
              <Link href="/morse" className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-amber-100/80">
                Back to Morse Keep
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hasPressedStart) {
    return (
      <div className="relative min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_top,#6a4019,transparent_35%),linear-gradient(180deg,#1f140d,#0d0908_64%,#050505)] text-amber-50">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.1),transparent_30%)]" />
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-8">
          <div className="w-full max-w-2xl rounded-[2.25rem] border border-amber-300/15 bg-black/35 p-8 text-center shadow-[0_30px_120px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <div className="text-xs uppercase tracking-[0.34em] text-amber-300/70">Morse Keep Defense</div>
            <h1 className="mt-4 text-4xl font-serif font-bold text-white">
              {orientationLockedOut ? 'Rotate your phone to begin.' : 'Battle staged.'}
            </h1>
            <p className="mt-4 text-base text-amber-100/78">
              {requiresLandscape
                ? 'This battle is locked to landscape on phones. Rotate your phone sideways, then start the siege.'
                : 'The battlefield waits for your signal. Press start when you are ready to enter the wall.'}
            </p>

            <div className="mt-8 rounded-[1.8rem] border border-white/10 bg-white/6 p-5">
              <div className="text-xs uppercase tracking-[0.24em] text-amber-100/65">Loadout</div>
              <div className="mt-3 text-2xl font-bold text-white">
                {modeLabel(modeForView)} {levelForView}
                {modeForView === 'campaign' && levelConfig ? ` · ${levelConfig.title}` : ''}
              </div>
              <div className="mt-3 text-sm text-amber-100/72">
                {requiresLandscape
                  ? (isLandscape ? 'Landscape confirmed. The start button is now live.' : 'Portrait detected. Rotate to unlock the start button.')
                  : 'Desktop and tablet play can start immediately.'}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/morse" className="rounded-full border border-white/10 bg-white/6 px-5 py-3 text-sm font-semibold text-amber-50">
                Back to Morse Keep
              </Link>
              <button
                type="button"
                onClick={() => {
                  void handleStartBattle();
                }}
                disabled={orientationLockedOut}
                className={`rounded-full px-6 py-3 text-sm font-black uppercase tracking-[0.22em] transition ${
                  orientationLockedOut
                    ? 'bg-white/8 text-white/35'
                    : 'bg-gradient-to-r from-amber-300 to-orange-300 text-slate-950 shadow-[0_12px_40px_rgba(245,158,11,0.24)]'
                }`}
              >
                Start Battle
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!runSnapshot) {
    return (
      <div className="relative min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_top,#5b3519,transparent_38%),linear-gradient(180deg,#1b110b,#0a0807_62%,#050505)] text-amber-50">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.08),transparent_34%)]" />
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4">
          <div className="w-full max-w-xl rounded-[2rem] border border-amber-300/15 bg-black/30 p-8 text-center backdrop-blur-xl">
            <div className="mx-auto h-16 w-16 rounded-full border border-amber-200/20 bg-amber-200/10" />
            <p className="mt-6 text-xs uppercase tracking-[0.32em] text-amber-300/70">Morse Keep</p>
            <h1 className="mt-3 text-3xl font-serif font-bold text-white">Opening the wall</h1>
            <p className="mt-4 text-amber-100/75">{battleStatus}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-black text-amber-50">
      <MorseBattlefieldScene
        snapshot={runSnapshot}
        teamProgress={teamProgress}
        clock={clock}
        shakeAt={shakeAt}
        selectedMountId={selectedMountId}
        hintedEnemyIds={hintedEnemyIds}
        buildMode={Boolean(buildMode)}
        onMountSelect={(mountId) => setSelectedMountId(mountId)}
        onEnemySelect={(enemyId) => {
          setManualHintEnemyId(enemyId);
          setManualHintUntil(Date.now() + 2600);
        }}
      />

      <AnimatePresence>
        {orientationLockedOut && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/78 px-5 text-center backdrop-blur-md"
          >
            <div className="max-w-lg rounded-[2rem] border border-amber-300/15 bg-black/55 p-8 shadow-[0_30px_120px_rgba(0,0,0,0.5)]">
              <div className="text-xs uppercase tracking-[0.34em] text-amber-300/72">Landscape Required</div>
              <h2 className="mt-4 text-4xl font-serif font-bold text-white">Rotate your phone.</h2>
              <p className="mt-4 text-base text-amber-100/78">
                Morse Keep Defense only runs in landscape on phones. Turn your phone sideways to resume the battle.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-3 sm:p-4">
        <div className="pointer-events-auto flex items-start gap-2">
          <Link href="/morse" className="rounded-full border border-white/10 bg-black/40 px-3 py-2 text-xs uppercase tracking-[0.18em] text-amber-100/85 backdrop-blur">
            Back
          </Link>
          <div className="max-w-[15rem] rounded-full border border-white/10 bg-black/35 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-amber-100/72 backdrop-blur sm:max-w-none">
            {battleStatus}
          </div>
        </div>

        <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
          <div className="rounded-full border border-rose-200/15 bg-black/35 px-3 py-2 text-xs uppercase tracking-[0.18em] text-rose-100/90 backdrop-blur">
            HP {runSnapshot.castleHealth}/{runSnapshot.maxCastleHealth}
          </div>
          <div className="rounded-full border border-amber-200/15 bg-black/35 px-3 py-2 text-xs uppercase tracking-[0.18em] text-amber-100/90 backdrop-blur">
            Supplies {runSnapshot.resources}
          </div>
          <div className="rounded-full border border-sky-200/15 bg-black/35 px-3 py-2 text-xs uppercase tracking-[0.18em] text-sky-100/90 backdrop-blur">
            Score {runSnapshot.score}
          </div>
          <div className="rounded-full border border-white/10 bg-black/35 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/80 backdrop-blur">
            {activeRun
              ? runSnapshot.partnerOnline
                ? `${partnerName} online`
                : runSnapshot.partnerJoined
                  ? `${partnerName} joined`
                  : 'Awaiting partner'
              : 'Solo watch'}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4">
        <div className="rounded-full border border-amber-300/18 bg-black/35 px-4 py-2 text-xs uppercase tracking-[0.28em] text-amber-100/90 backdrop-blur">
          {modeLabel(modeForView)} {levelForView}
          {modeForView === 'campaign' && levelConfig ? ` · ${levelConfig.title}` : ''}
          {isLandscape ? ' · Landscape' : ' · Portrait'}
        </div>
      </div>

      <AnimatePresence>
        {waveBanner && (
          <motion.div
            key={waveBanner}
            initial={{ opacity: 0, y: -28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            className="pointer-events-none absolute inset-x-0 top-28 z-30 flex justify-center px-4"
          >
            <div className="rounded-full border border-amber-200/20 bg-black/55 px-5 py-3 text-sm font-black uppercase tracking-[0.36em] text-amber-100 shadow-[0_18px_60px_rgba(0,0,0,0.34)] backdrop-blur">
              {waveBanner}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {runSnapshot.currentComboPrompt && runSnapshot.phase === 'playing' && (
          <motion.div
            key={runSnapshot.currentComboPrompt}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="pointer-events-none absolute inset-x-0 top-44 z-30 flex justify-center px-5"
          >
            <div className="rounded-[1.4rem] border border-sky-200/18 bg-slate-950/75 px-5 py-4 text-center text-sm text-sky-100 shadow-[0_18px_60px_rgba(2,6,23,0.42)] backdrop-blur">
              {runSnapshot.currentComboPrompt}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {waitingForPartner && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 top-1/3 z-30 flex justify-center px-6"
          >
            <div className="max-w-md rounded-[1.8rem] border border-amber-200/15 bg-black/65 px-6 py-6 text-center shadow-[0_28px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="text-xs uppercase tracking-[0.32em] text-amber-300/70">Shared Defense</div>
              <div className="mt-3 text-2xl font-serif font-bold text-white">The wall is set.</div>
              <div className="mt-3 text-sm text-amber-100/78">
                Waiting for {partnerName} to join before the first march begins.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {buildMode && selectedMount && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            className="absolute inset-x-0 z-30 flex justify-center px-3 sm:px-6"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 10.2rem)' }}
          >
            <div className="pointer-events-auto w-full max-w-5xl rounded-[1.8rem] border border-white/10 bg-black/62 p-4 shadow-[0_26px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.28em] text-amber-300/70">{selectedMount.label}</div>
                  <div className="mt-2 text-xl font-bold text-white">
                    {selectedTower ? `${roleLabel(selectedTower)} · Tier ${selectedTower.level}` : 'Empty emplacement'}
                  </div>
                  <div className="mt-1 text-sm text-amber-100/72">
                    {selectedTower
                      ? 'Upgrade this mount or tap a different pad on the wall.'
                      : 'Tap a wall pad to move, then mount a defense directly on the castle.'}
                  </div>
                  {activeRun?.id && !isRunHost && (
                    <div className="mt-2 text-xs uppercase tracking-[0.2em] text-amber-200/65">
                      Requests sync through the host
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {mountIds.map((mountId) => (
                    <button
                      key={mountId}
                      type="button"
                      onClick={() => setSelectedMountId(mountId)}
                      className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
                        selectedMountId === mountId
                          ? 'border-amber-300/40 bg-amber-200/12 text-amber-50'
                          : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                      }`}
                    >
                      {getMountDefinition(mountId).label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {selectedTower ? (
                    <button
                      type="button"
                      onClick={() => handleTowerUpgrade(selectedTower.id)}
                      disabled={runSnapshot.resources < 4 + selectedTower.level * 3}
                      className={`rounded-[1.2rem] border px-4 py-3 text-left transition ${
                        runSnapshot.resources < 4 + selectedTower.level * 3
                          ? 'border-white/10 bg-white/5 text-white/35'
                          : 'border-amber-300/20 bg-white/6 text-amber-50 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-xs uppercase tracking-[0.22em] text-amber-200/70">Upgrade</div>
                      <div className="mt-1 text-sm font-semibold">{4 + selectedTower.level * 3} supplies</div>
                    </button>
                  ) : (
                    unlockedTowerCatalog.map((tower) => (
                      <button
                        key={tower.type}
                        type="button"
                        onClick={() => selectedMountId && handleTowerPurchase(tower.type, selectedMountId)}
                        disabled={!selectedMountId || runSnapshot.resources < tower.cost}
                        className={`rounded-[1.2rem] border px-4 py-3 text-left transition ${
                          !selectedMountId || runSnapshot.resources < tower.cost
                            ? 'border-white/10 bg-white/5 text-white/35'
                            : 'border-white/10 bg-white/6 text-amber-50 hover:bg-white/10'
                        }`}
                      >
                        <div className="text-xs uppercase tracking-[0.22em] text-amber-200/70">{tower.short}</div>
                        <div className="mt-1 text-sm font-semibold">{tower.label}</div>
                        <div className="mt-1 text-xs text-amber-100/62">{tower.cost} supplies</div>
                      </button>
                    ))
                  )}
                </div>

                {runSnapshot.pendingWave && (
                  <button
                    type="button"
                    onClick={launchWave}
                    disabled={!canManageRun || waitingForPartner}
                    className={`rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.22em] transition ${
                      !canManageRun || waitingForPartner
                        ? 'bg-white/8 text-white/38'
                        : 'bg-gradient-to-r from-amber-300 to-orange-300 text-slate-950 shadow-[0_10px_40px_rgba(245,158,11,0.24)]'
                    }`}
                  >
                    {runSnapshot.phase === 'waiting' ? 'Start Siege' : 'Launch Next Wave'}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toastMessage && (
          <motion.div
            key={toastToken}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 8.6rem)' }}
          >
            <div className="rounded-full border border-white/10 bg-black/58 px-4 py-2 text-sm text-amber-100 shadow-[0_18px_60px_rgba(0,0,0,0.36)] backdrop-blur">
              {toastMessage}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-x-0 bottom-0 z-20 px-3 pt-4 sm:px-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}>
        <div className="mx-auto flex max-w-5xl justify-center">
          <MorseCombatKey
            liveSymbols={liveSymbols}
            resolvedCharacter={resolvedCharacter}
            decodedPreview={decodedPreview}
            unitMs={unitMs}
            isHolding={isHolding}
            disabled={controlsDisabled}
            sideControls={dockControls}
            onStart={() => {
              void startSignal();
            }}
            onStop={stopSignal}
          />
        </div>
      </div>

      <AnimatePresence>
        {(runSnapshot.phase === 'victory' || runSnapshot.phase === 'defeat') && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          >
            <div className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,#7a471d,transparent_30%),linear-gradient(180deg,#22120b,#120d0b)] p-7 shadow-[0_30px_120px_rgba(0,0,0,0.55)]">
              <div className="text-xs uppercase tracking-[0.32em] text-amber-300/70">{modeLabel(modeForView)}</div>
              <h2 className="mt-3 text-4xl font-serif font-bold text-white">
                {runSnapshot.phase === 'victory' ? 'The wall holds.' : 'The gate fell.'}
              </h2>
              <p className="mt-3 text-amber-100/75">
                {runSnapshot.phase === 'victory'
                  ? 'The enemy march broke against your signals and the castle still stands.'
                  : 'The next watch can return stronger with sharper timing and better emplacements.'}
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-[1.4rem] bg-white/6 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Score</div>
                  <div className="mt-2 text-3xl font-black text-white">{runSnapshot.score}</div>
                </div>
                <div className="rounded-[1.4rem] bg-white/6 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Reward</div>
                  <div className="mt-2 text-3xl font-black text-amber-200">{runSnapshot.metaReward}</div>
                </div>
                <div className="rounded-[1.4rem] bg-white/6 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Signals</div>
                  <div className="mt-2 text-3xl font-black text-white">{runSnapshot.signalsUsed}</div>
                </div>
                <div className="rounded-[1.4rem] bg-white/6 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Castle</div>
                  <div className="mt-2 text-3xl font-black text-white">{runSnapshot.castleHealth}</div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/morse" className="rounded-full border border-white/10 bg-white/6 px-5 py-3 text-sm font-semibold text-amber-50">
                  Return to Keep
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setHasPressedStart(false);
                    setActiveRun(null);
                    setRunSnapshot(null);
                    setIsRunHost(false);
                    setSelectedMountId(null);
                    setBattleStatus('Prepare the battleground.');
                    const coopValue = activeRun ? (runSnapshot.partnerJoined ? '1' : '0') : (isCoOpRequest ? '1' : '0');
                    router.replace(`/morse/defense?mode=${modeForView}&level=${levelForView}&coop=${coopValue}`);
                  }}
                  className="rounded-full bg-gradient-to-r from-amber-300 to-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-slate-950"
                >
                  Play Again
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
