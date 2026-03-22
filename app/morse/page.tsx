'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThemeToggle } from '../components/ThemeToggle';
import { useMarkAppViewed } from '@/lib/useMarkAppViewed';
import { getCurrentUser, setCurrentUser, type CurrentUser } from '@/lib/user-session';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { MorseToneManager } from '@/lib/morse/audio';
import { MORSE_CAMPAIGN_LEVELS, MORSE_LESSONS } from '@/lib/morse/content';
import {
  PLAYER_PROGRESS_STORAGE_PREFIX,
  TEAM_PROGRESS_STORAGE_KEY,
  calculateUnitMs,
  classifySymbol,
  computeAccuracy,
  createEmptyPlayerProgress,
  createEmptyTeamProgress,
  decodeSymbols,
  decodeTextFromMorse,
  encodeTextToMorse,
  generatePracticePrompt,
  makeTransmissionId,
  mergePlayerProgress,
  mergeTeamProgress,
  sanitizeSymbols,
  updatePlayerProgress,
} from '@/lib/morse/core';
import {
  applyDefenseTransmission,
  stepRunSnapshot,
  unlockArmoryUpgrade,
} from '@/lib/morse/game';
import type {
  MorseHelperSettings,
  MorsePlayer,
  MorsePlayerProgress,
  MorseRun,
  MorseRunSnapshot,
  MorseSymbol,
  MorseTab,
  MorseTeamProgress,
  MorseTransmission,
} from '@/lib/morse/types';

interface MorseMessageRow {
  id: string;
  from_user: MorsePlayer;
  room_name: string;
  kind: string;
  symbols: string[] | null;
  decoded_text: string;
  assist_text: string;
  created_at: string;
}

const DEFAULT_HELPERS: MorseHelperSettings = {
  showCheatSheet: true,
  liveDecode: true,
  autoSpacing: true,
  correctnessFeedback: true,
  demoPlayback: true,
};

const ARMORY_TOWER_UNLOCKS = [
  {
    category: 'tower' as const,
    id: 'mint',
    label: 'Quartermaster Crate',
    description: 'Unlock a resource engine tower for longer defense runs.',
    cost: 25,
  },
  {
    category: 'tower' as const,
    id: 'catapult',
    label: 'Bossbreaker Catapult',
    description: 'Unlock heavy siege fire for elites and bosses.',
    cost: 32,
  },
];

const ARMORY_POWER_UNLOCKS = [
  {
    category: 'power' as const,
    id: 'freeze',
    label: 'Frost Bell',
    description: 'Unlock a panic button that freezes the whole road.',
    cost: 22,
  },
  {
    category: 'power' as const,
    id: 'reveal',
    label: 'Reveal Rune',
    description: 'Unlock a power that lights every enemy code for a short window.',
    cost: 18,
  },
];

const ARMORY_UPGRADES = [
  {
    category: 'upgrade' as const,
    id: 'towerSlots',
    label: 'Extra Tower Slot',
    description: 'Carry one more tower into each defense.',
    cost: 20,
  },
  {
    category: 'upgrade' as const,
    id: 'startingHealth',
    label: 'Thicker Walls',
    description: 'Start each run with one extra castle health.',
    cost: 16,
  },
  {
    category: 'upgrade' as const,
    id: 'revealAssistLevel',
    label: 'Sharper Scouts',
    description: 'Boost passive reveal help and keep hidden letters readable for longer.',
    cost: 14,
  },
  {
    category: 'upgrade' as const,
    id: 'powerCapacity',
    label: 'Power Reserve',
    description: 'Carry more power charges into long endless pushes.',
    cost: 18,
  },
];

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-amber-100 hover:bg-white/15'
      }`}
    >
      {label}
    </button>
  );
}

function IdentityGate({ onSelect }: { onSelect: (user: CurrentUser) => void }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#4f2f17,transparent_45%),linear-gradient(180deg,#1d120c,#0e0a08_52%,#080706)] text-amber-50">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl rounded-[2rem] border border-amber-300/15 bg-white/6 p-8 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">Morse Keep</p>
          <h1 className="mt-4 text-4xl font-serif font-bold">Who&apos;s manning the signal tower?</h1>
          <p className="mt-3 text-amber-100/80">
            Pick your side of the keep, then start learning, keying live, and defending the walls together.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <button
              onClick={() => onSelect('daniel')}
              className="rounded-3xl border border-sky-300/30 bg-sky-500/15 px-6 py-8 text-left"
            >
              <div className="text-sm uppercase tracking-[0.25em] text-sky-200/80">Blue Tower</div>
              <div className="mt-2 text-2xl font-bold text-white">Daniel</div>
            </button>
            <button
              onClick={() => onSelect('huaiyao')}
              className="rounded-3xl border border-rose-300/30 bg-rose-500/15 px-6 py-8 text-left"
            >
              <div className="text-sm uppercase tracking-[0.25em] text-rose-200/80">Rose Tower</div>
              <div className="mt-2 text-2xl font-bold text-white">Huaiyao</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalPad({
  title,
  subtitle,
  liveSymbols,
  liveOutput,
  decodedPreview,
  isHolding,
  unitMs,
  onStart,
  onStop,
  disabled = false,
}: {
  title: string;
  subtitle: string;
  liveSymbols: MorseSymbol[];
  liveOutput: string;
  decodedPreview: string;
  isHolding: boolean;
  unitMs: number;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-[2rem] border border-amber-300/15 bg-black/15 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="text-sm text-amber-100/70">{subtitle}</p>
        </div>
        <div className="rounded-full bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-200/80">
          {unitMs}ms dot
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <button
          disabled={disabled}
          onPointerDown={onStart}
          onPointerUp={onStop}
          onPointerLeave={onStop}
          onPointerCancel={onStop}
          onTouchEnd={onStop}
          className={`min-h-40 rounded-[2rem] border px-6 py-8 text-center transition ${
            disabled
              ? 'cursor-not-allowed border-white/10 bg-white/5 text-white/40'
              : isHolding
                ? 'border-amber-300/70 bg-amber-300/25 text-white'
                : 'border-amber-300/20 bg-gradient-to-br from-stone-950/70 to-amber-950/50 text-white'
          }`}
        >
          <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Press / Hold</div>
          <div className="mt-3 text-4xl font-black">{isHolding ? 'SIGNALING' : 'KEY'}</div>
          <div className="mt-3 text-sm text-amber-50/75">Touch or hold `Space` to sound Morse.</div>
        </button>
        <div className="rounded-[2rem] border border-white/10 bg-white/6 p-4">
          <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Live Readout</div>
          <div className="mt-3 rounded-2xl bg-black/25 p-4 font-mono text-3xl tracking-[0.3em] text-amber-200">
            {liveSymbols.length > 0 ? liveSymbols.join('') : '· · ·'}
          </div>
          <div className="mt-3 rounded-2xl bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.25em] text-amber-100/60">Decoded</div>
            <div className="mt-2 text-2xl font-semibold text-white">{decodedPreview || 'Waiting...'}</div>
            <div className="mt-3 text-sm text-amber-100/75">Output: {liveOutput || 'Start keying to build a word.'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MorsePage() {
  useMarkAppViewed('morse');
  const router = useRouter();

  const [currentUserState, setCurrentUserState] = useState<CurrentUser | null>(() =>
    typeof window === 'undefined' ? null : getCurrentUser()
  );
  const [activeTab, setActiveTab] = useState<MorseTab>('learn');
  const [helpers] = useState<MorseHelperSettings>(DEFAULT_HELPERS);
  const [wpm, setWpm] = useState(16);
  const [playerProgress, setPlayerProgress] = useState<MorsePlayerProgress | null>(null);
  const [teamProgress, setTeamProgress] = useState<MorseTeamProgress>(createEmptyTeamProgress());
  const [selectedLessonIndex, setSelectedLessonIndex] = useState(0);
  const [lessonPrompt, setLessonPrompt] = useState(MORSE_LESSONS[0].challengeWords[0]);
  const [lessonFeedback, setLessonFeedback] = useState('Press and hold the key to match the prompt.');
  const [practicePrompt, setPracticePrompt] = useState(generatePracticePrompt(MORSE_LESSONS[0].symbolPool, MORSE_LESSONS[0].challengeWords));
  const [practiceFeedback, setPracticeFeedback] = useState('Try to copy the prompt from memory or use the helper tools.');
  const [translatorText, setTranslatorText] = useState('HELLO KEEP');
  const [translatorMorse, setTranslatorMorse] = useState(encodeTextToMorse('HELLO KEEP'));
  const [liveSymbols, setLiveSymbols] = useState<MorseSymbol[]>([]);
  const [liveOutput, setLiveOutput] = useState('');
  const [decodedPreview, setDecodedPreview] = useState('');
  const [isHolding, setIsHolding] = useState(false);
  const [roomMessages, setRoomMessages] = useState<MorseTransmission[]>([]);
  const [roomStatus, setRoomStatus] = useState('Standby. The room will sync when both of you are here.');
  const [roomPresence, setRoomPresence] = useState<string | null>(null);
  const [partnerLiveSymbols, setPartnerLiveSymbols] = useState<MorseSymbol[]>([]);
  const [partnerIsHolding, setPartnerIsHolding] = useState(false);
  const [waitingRuns, setWaitingRuns] = useState<MorseRun[]>([]);
  const [recentRuns, setRecentRuns] = useState<MorseRun[]>([]);
  const [activeRun] = useState<MorseRun | null>(null);
  const [runSnapshot, setRunSnapshot] = useState<MorseRunSnapshot | null>(null);
  const [isRunHost] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [defenseStatus, setDefenseStatus] = useState('No active defense run.');

  const currentUser = currentUserState as MorsePlayer | null;
  const partnerName = currentUser === 'daniel' ? 'Huaiyao' : currentUser === 'huaiyao' ? 'Daniel' : 'your partner';
  const unitMs = useMemo(() => calculateUnitMs(wpm), [wpm]);
  const selectedLesson = MORSE_LESSONS[selectedLessonIndex] ?? MORSE_LESSONS[0];
  const storagePlayerKey = currentUser ? `${PLAYER_PROGRESS_STORAGE_PREFIX}${currentUser}` : null;
  const hasRunSnapshot = runSnapshot !== null;

  const toneRef = useRef<MorseToneManager | null>(null);
  const pressStartRef = useRef<number | null>(null);
  const charTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSymbolsRef = useRef<MorseSymbol[]>([]);
  const currentWordSymbolsRef = useRef<MorseSymbol[]>([]);
  const currentWordTextRef = useRef('');
  const activeTabRef = useRef<MorseTab>('learn');
  const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const runChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const runSnapshotRef = useRef<MorseRunSnapshot | null>(null);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    runSnapshotRef.current = runSnapshot;
  }, [runSnapshot]);

  const resetComposer = useCallback(() => {
    currentSymbolsRef.current = [];
    currentWordSymbolsRef.current = [];
    currentWordTextRef.current = '';
    setLiveSymbols([]);
    setLiveOutput('');
    setDecodedPreview('');
    if (charTimerRef.current) clearTimeout(charTimerRef.current);
    if (wordTimerRef.current) clearTimeout(wordTimerRef.current);
  }, []);

  const persistPlayer = useCallback(async (nextProgress: MorsePlayerProgress) => {
    if (storagePlayerKey && typeof window !== 'undefined') {
      window.localStorage.setItem(storagePlayerKey, JSON.stringify(nextProgress));
    }
    if (isSupabaseConfigured) {
      await supabase.from('morse_player_progress').upsert({
        player: nextProgress.player,
        unlocked_lesson_index: nextProgress.unlockedLessonIndex,
        total_transmissions: nextProgress.totalTransmissions,
        current_streak: nextProgress.currentStreak,
        best_streak: nextProgress.bestStreak,
        letters_mastered: nextProgress.lettersMastered,
        mastery: nextProgress.mastery,
        recent_mistakes: nextProgress.recentMistakes,
        updated_at: new Date().toISOString(),
      });
    }
  }, [storagePlayerKey]);

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

  const notifyPartner = useCallback(async (action: 'morse_room_invite' | 'morse_run_started', title: string) => {
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

  const loadRoomMessages = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { data, error } = await supabase
      .from('morse_messages')
      .select('*')
      .eq('room_name', 'morse-room')
      .order('created_at', { ascending: false })
      .limit(40);
    if (error || !data) return;
    const messages = [...(data as MorseMessageRow[])].reverse().map<MorseTransmission>((row) => ({
      id: row.id,
      user: row.from_user,
      symbols: sanitizeSymbols((row.symbols ?? []).join('')),
      decodedText: row.decoded_text,
      plainTextAssist: row.assist_text,
      kind: 'room',
      created_at: row.created_at,
    }));
    setRoomMessages(messages);
  }, []);

  const loadRuns = useCallback(async () => {
    if (!currentUser || !isSupabaseConfigured) return;
    const waitingRes = await supabase
      .from('morse_runs')
      .select('*')
      .eq('status', 'waiting')
      .neq('host_player', currentUser)
      .order('created_at', { ascending: false })
      .limit(6);
    if (!waitingRes.error && waitingRes.data) {
      setWaitingRuns(waitingRes.data as MorseRun[]);
    }
    const recentRes = await supabase
      .from('morse_runs')
      .select('*')
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(10);
    if (!recentRes.error && recentRes.data) {
      setRecentRuns(recentRes.data as MorseRun[]);
    }
  }, [currentUser]);

  useEffect(() => {
    if (typeof window === 'undefined' || !currentUser) return;
    const localPlayer = storagePlayerKey
      ? mergePlayerProgress(JSON.parse(window.localStorage.getItem(storagePlayerKey) ?? 'null') as Partial<MorsePlayerProgress> | null, currentUser)
      : createEmptyPlayerProgress(currentUser);
    const localTeam = mergeTeamProgress(JSON.parse(window.localStorage.getItem(TEAM_PROGRESS_STORAGE_KEY) ?? 'null') as Partial<MorseTeamProgress> | null);
    setPlayerProgress(localPlayer);
    setTeamProgress(localTeam);
    if (!isSupabaseConfigured) return;
    void (async () => {
      const [playerRes, teamRes] = await Promise.all([
        supabase.from('morse_player_progress').select('*').eq('player', currentUser).maybeSingle(),
        supabase.from('morse_team_progress').select('*').eq('id', 'main').maybeSingle(),
      ]);

      if (!playerRes.error && playerRes.data) {
        const row = playerRes.data as {
          unlocked_lesson_index: number;
          total_transmissions: number;
          current_streak: number;
          best_streak: number;
          letters_mastered: string[];
          mastery: MorsePlayerProgress['mastery'];
          recent_mistakes: string[];
        };
        setPlayerProgress(mergePlayerProgress({
          unlockedLessonIndex: row.unlocked_lesson_index,
          totalTransmissions: row.total_transmissions,
          currentStreak: row.current_streak,
          bestStreak: row.best_streak,
          lettersMastered: row.letters_mastered,
          mastery: row.mastery,
          recentMistakes: row.recent_mistakes,
        }, currentUser));
      }

      if (!teamRes.error && teamRes.data) {
        const row = teamRes.data as {
          unlocked_campaign_level: number;
          endless_unlocked: boolean;
          meta_currency: number;
          unlocked_towers: string[];
          unlocked_powers: string[];
          permanent_upgrades: MorseTeamProgress['permanentUpgrades'];
          records: MorseTeamProgress['records'];
        };
        setTeamProgress(mergeTeamProgress({
          unlockedCampaignLevel: row.unlocked_campaign_level,
          endlessUnlocked: row.endless_unlocked,
          metaCurrency: row.meta_currency,
          unlockedTowers: row.unlocked_towers,
          unlockedPowers: row.unlocked_powers,
          permanentUpgrades: row.permanent_upgrades,
          records: row.records,
        }));
      }

      await Promise.all([loadRoomMessages(), loadRuns()]);
    })();
  }, [currentUser, loadRoomMessages, loadRuns, storagePlayerKey]);

  useEffect(() => {
    if (!currentUser || !isSupabaseConfigured) return;
    void supabase.rpc('update_presence', {
      p_player: currentUser,
      p_is_online: true,
      p_current_app: 'morse',
    });
  }, [activeTab, currentUser]);

  useEffect(() => {
    if (!currentUser || !isSupabaseConfigured || (activeTab !== 'defense' && activeTab !== 'records')) return;
    void loadRuns();
    const refresh = window.setInterval(() => {
      void loadRuns();
    }, 10000);
    return () => {
      window.clearInterval(refresh);
    };
  }, [activeTab, currentUser, loadRuns]);

  const saveRoomMessage = useCallback(async (decodedText: string, signals: MorseSymbol[]) => {
    if (!currentUser) return;
    const entry: MorseTransmission = {
      id: makeTransmissionId('room'),
      user: currentUser,
      symbols: signals,
      decodedText,
      plainTextAssist: decodedText,
      kind: 'room',
      created_at: new Date().toISOString(),
    };
    setRoomMessages((prev) => [...prev.slice(-39), entry]);
    setRoomStatus(`Sent: ${decodedText}`);
    if (roomChannelRef.current) {
      await roomChannelRef.current.send({
        type: 'broadcast',
        event: 'message',
        payload: entry,
      });
    }
    if (isSupabaseConfigured) {
      await supabase.from('morse_messages').insert({
        id: entry.id,
        from_user: currentUser,
        room_name: 'morse-room',
        kind: 'room',
        symbols: signals,
        decoded_text: decodedText,
        assist_text: decodedText,
        created_at: entry.created_at,
      });
    }
  }, [currentUser]);

  const handleWord = useCallback(async (word: string, signals: MorseSymbol[]) => {
    if (!currentUser) return;

    if (activeTabRef.current === 'learn') {
      if (!playerProgress) return;
      const accuracy = computeAccuracy(lessonPrompt, word);
      const transmission: MorseTransmission = {
        id: makeTransmissionId('lesson'),
        user: currentUser,
        symbols: signals,
        decodedText: word,
        plainTextAssist: lessonPrompt,
        kind: 'learn',
        created_at: new Date().toISOString(),
        accuracy,
      };
      const updated = updatePlayerProgress(playerProgress, lessonPrompt, word, transmission);
      if (word.toUpperCase() === lessonPrompt.toUpperCase()) {
        updated.unlockedLessonIndex = Math.max(updated.unlockedLessonIndex, Math.min(MORSE_LESSONS.length - 1, selectedLesson.index + 1));
        setLessonFeedback(`Clean copy. ${selectedLesson.rewardLabel}`);
        setLessonPrompt(generatePracticePrompt(selectedLesson.symbolPool, selectedLesson.challengeWords));
      } else {
        setLessonFeedback(`Expected ${lessonPrompt}, heard ${word || 'silence'}.`);
      }
      setPlayerProgress(updated);
      await persistPlayer(updated);
      return;
    }

    if (activeTabRef.current === 'practice') {
      if (!playerProgress) return;
      const accuracy = computeAccuracy(practicePrompt, word);
      const transmission: MorseTransmission = {
        id: makeTransmissionId('practice'),
        user: currentUser,
        symbols: signals,
        decodedText: word,
        plainTextAssist: practicePrompt,
        kind: 'practice',
        created_at: new Date().toISOString(),
        accuracy,
      };
      const updated = updatePlayerProgress(playerProgress, practicePrompt, word, transmission);
      setPlayerProgress(updated);
      await persistPlayer(updated);
      if (word.toUpperCase() === practicePrompt.toUpperCase()) {
        setPracticeFeedback('Copied cleanly. Spin a harder prompt when ready.');
        setPracticePrompt(generatePracticePrompt(selectedLesson.symbolPool, selectedLesson.challengeWords));
      } else {
        setPracticeFeedback(`Close, but the prompt was ${practicePrompt}.`);
      }
      return;
    }

    if (activeTabRef.current === 'room') {
      await saveRoomMessage(word, signals);
    }
  }, [currentUser, lessonPrompt, persistPlayer, playerProgress, practicePrompt, saveRoomMessage, selectedLesson]);

  const handleCharacter = useCallback((character: string) => {
    if (activeTabRef.current !== 'defense' || !character) return;
    if (isRunHost) {
      setRunSnapshot((prev) => prev ? applyDefenseTransmission(prev, character, currentUser ?? 'daniel') : prev);
      return;
    }
    void runChannelRef.current?.send({
      type: 'broadcast',
      event: 'transmission',
      payload: {
        user: currentUser,
        decodedText: character,
      },
    });
  }, [currentUser, isRunHost]);

  const startRun = useCallback(async (mode: 'campaign' | 'endless', coOp: boolean) => {
    if (!currentUser) return;
    if (mode === 'endless' && !teamProgress.endlessUnlocked) {
      setDefenseStatus('Endless mode unlocks after clearing the campaign.');
      return;
    }

    router.push(`/morse/defense?mode=${mode}&level=${selectedLevel}&coop=${coOp ? '1' : '0'}`);
  }, [currentUser, router, selectedLevel, teamProgress.endlessUnlocked]);

  const joinRun = useCallback(async (run: MorseRun) => {
    router.push(`/morse/defense?run=${run.id}&join=1`);
  }, [router]);

  const finalizeCharacter = useCallback(() => {
    const symbols = [...currentSymbolsRef.current];
    if (symbols.length === 0) return;
    const decoded = decodeSymbols(symbols) ?? '?';
    currentWordSymbolsRef.current = [...currentWordSymbolsRef.current, ...symbols];
    currentWordTextRef.current = `${currentWordTextRef.current}${decoded}`;
    currentSymbolsRef.current = [];
    setLiveSymbols([]);
    setDecodedPreview(decoded);
    setLiveOutput(currentWordTextRef.current);
    handleCharacter(decoded);
  }, [handleCharacter]);

  const finalizeWord = useCallback(() => {
    if (currentSymbolsRef.current.length > 0) {
      finalizeCharacter();
    }
    const word = currentWordTextRef.current.trim();
    if (!word) return;
    const symbols = [...currentWordSymbolsRef.current];
    currentWordTextRef.current = '';
    currentWordSymbolsRef.current = [];
    setLiveOutput('');
    void handleWord(word, symbols);
  }, [finalizeCharacter, handleWord]);

  const startSignal = useCallback(async () => {
    if (isHolding) return;
    setIsHolding(true);
    pressStartRef.current = performance.now();
    toneRef.current ??= new MorseToneManager();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(8);
    }
    if (activeTabRef.current === 'room' && currentUser) {
      void roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'key_down',
        payload: { user: currentUser },
      });
    }
    await toneRef.current.start();
  }, [currentUser, isHolding]);

  const stopSignal = useCallback(async () => {
    if (!pressStartRef.current) return;
    const duration = performance.now() - pressStartRef.current;
    pressStartRef.current = null;
    setIsHolding(false);
    toneRef.current?.stop();
    const symbol = classifySymbol(duration, unitMs);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(5);
    }
    if (activeTabRef.current === 'room' && currentUser) {
      void roomChannelRef.current?.send({
        type: 'broadcast',
        event: 'key_up',
        payload: { user: currentUser, symbol, durationMs: Math.round(duration) },
      });
    }
    currentSymbolsRef.current = [...currentSymbolsRef.current, symbol];
    setLiveSymbols([...currentSymbolsRef.current]);
    setDecodedPreview(decodeSymbols(currentSymbolsRef.current) ?? currentSymbolsRef.current.join(''));
    if (charTimerRef.current) clearTimeout(charTimerRef.current);
    if (wordTimerRef.current) clearTimeout(wordTimerRef.current);
    charTimerRef.current = setTimeout(finalizeCharacter, Math.max(240, unitMs * 2.8));
    if (helpers.autoSpacing) {
      wordTimerRef.current = setTimeout(finalizeWord, Math.max(600, unitMs * 6.5));
    }
  }, [currentUser, finalizeCharacter, finalizeWord, helpers.autoSpacing, unitMs]);

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
      void stopSignal();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startSignal, stopSignal]);

  useEffect(() => {
    resetComposer();
    setLessonFeedback('Press and hold the key to match the prompt.');
    setPracticeFeedback('Try to copy the prompt from memory or use the helper tools.');
    setLessonPrompt(generatePracticePrompt(selectedLesson.symbolPool, selectedLesson.challengeWords));
    setPracticePrompt(generatePracticePrompt(selectedLesson.symbolPool, selectedLesson.challengeWords));
  }, [activeTab, resetComposer, selectedLesson]);

  useEffect(() => {
    if (!currentUser || activeTab !== 'room' || !isSupabaseConfigured) return;
    void loadRoomMessages();

    const channel = supabase.channel('morse-room');
    roomChannelRef.current = channel;

    channel
      .on('broadcast', { event: 'presence' }, ({ payload }) => {
        const data = payload as { user?: MorsePlayer };
        if (!data.user || data.user === currentUser) return;
        setRoomPresence(data.user === 'daniel' ? 'Daniel is in the room.' : 'Huaiyao is in the room.');
      })
      .on('broadcast', { event: 'key_down' }, ({ payload }) => {
        const data = payload as { user?: MorsePlayer };
        if (!data.user || data.user === currentUser) return;
        setPartnerIsHolding(true);
        setRoomPresence(data.user === 'daniel' ? 'Daniel is keying live.' : 'Huaiyao is keying live.');
      })
      .on('broadcast', { event: 'key_up' }, ({ payload }) => {
        const data = payload as { user?: MorsePlayer; symbol?: MorseSymbol };
        if (!data.user || data.user === currentUser || !data.symbol) return;
        const symbol = data.symbol;
        setPartnerIsHolding(false);
        setPartnerLiveSymbols((prev) => [...prev, symbol].slice(-12));
        if (partnerPulseTimerRef.current) clearTimeout(partnerPulseTimerRef.current);
        partnerPulseTimerRef.current = setTimeout(() => {
          setPartnerLiveSymbols([]);
        }, 2600);
      })
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const data = payload as MorseTransmission;
        if (!data.user || data.user === currentUser) return;
        setPartnerIsHolding(false);
        setPartnerLiveSymbols([]);
        setRoomMessages((prev) => [...prev.filter((entry) => entry.id !== data.id), data].slice(-40));
        setRoomStatus(`${partnerName} transmitted "${data.decodedText}".`);
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
    }, 5000);

    return () => {
      window.clearInterval(heartbeat);
      if (partnerPulseTimerRef.current) clearTimeout(partnerPulseTimerRef.current);
      supabase.removeChannel(channel);
      roomChannelRef.current = null;
    };
  }, [activeTab, currentUser, loadRoomMessages, partnerName]);

  useEffect(() => {
    if (!currentUser || !activeRun?.id || !isSupabaseConfigured) return;

    const channel = supabase.channel(`morse-run:${activeRun.id}`);
    runChannelRef.current = channel;

    channel
      .on('broadcast', { event: 'presence' }, ({ payload }) => {
        const data = payload as { user?: MorsePlayer };
        if (!data.user || data.user === currentUser) return;
        setRunSnapshot((prev) => prev ? { ...prev, partnerOnline: true, partnerJoined: true } : prev);
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
        setRunSnapshot((prev) => prev ? applyDefenseTransmission(prev, decodedText, sendingUser) : prev);
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
  }, [activeRun?.id, currentUser, isRunHost]);

  useEffect(() => {
    if (!hasRunSnapshot || !isRunHost) return;
    const tick = window.setInterval(() => {
      setRunSnapshot((prev) => prev ? stepRunSnapshot(prev, 180) : prev);
    }, 180);
    return () => {
      window.clearInterval(tick);
    };
  }, [hasRunSnapshot, isRunHost, runSnapshot?.phase]);

  useEffect(() => {
    if (!activeRun?.id || !runChannelRef.current || !isRunHost) return;
    const publish = window.setInterval(() => {
      const snapshot = runSnapshotRef.current;
      if (!snapshot) return;
      void runChannelRef.current?.send({
        type: 'broadcast',
        event: 'snapshot',
        payload: { snapshot },
      });
    }, 900);
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
    return () => {
      if (partnerPulseTimerRef.current) clearTimeout(partnerPulseTimerRef.current);
      toneRef.current?.cleanup();
    };
  }, []);

  if (!currentUser) {
    return <IdentityGate onSelect={(user) => { setCurrentUser(user); setCurrentUserState(user); }} />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#6b4b1b,transparent_35%),linear-gradient(180deg,#1f140d,#120d0c_45%,#090807)] text-amber-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-full border border-white/10 bg-white/6 px-3 py-2 text-sm text-amber-100/80">
              ← Home
            </Link>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">Morse Keep</p>
              <h1 className="text-3xl font-serif font-bold text-white sm:text-4xl">Learn the code. Light the wall.</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`rounded-full px-3 py-2 text-sm ${currentUser === 'daniel' ? 'bg-sky-500/15 text-sky-100' : 'bg-rose-500/15 text-rose-100'}`}>
              Signaling as {currentUser === 'daniel' ? 'Daniel' : 'Huaiyao'}
            </div>
            <ThemeToggle />
          </div>
        </div>

        <div className="mt-6 rounded-[2rem] border border-amber-300/15 bg-white/6 p-6 backdrop-blur">
          <div className="flex flex-wrap gap-2">
            <TabButton active={activeTab === 'learn'} label="Learn" onClick={() => setActiveTab('learn')} />
            <TabButton active={activeTab === 'practice'} label="Practice" onClick={() => setActiveTab('practice')} />
            <TabButton active={activeTab === 'room'} label="Morse Room" onClick={() => setActiveTab('room')} />
            <TabButton active={activeTab === 'defense'} label="Defense" onClick={() => setActiveTab('defense')} />
            <TabButton active={activeTab === 'armory'} label="Armory" onClick={() => setActiveTab('armory')} />
            <TabButton active={activeTab === 'records'} label="Records" onClick={() => setActiveTab('records')} />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[1.75rem] border border-white/10 bg-black/15 p-4">
              <div className="text-xs uppercase tracking-[0.28em] text-amber-200/70">Letters Mastered</div>
              <div className="mt-2 text-3xl font-black text-white">{playerProgress?.lettersMastered.length ?? 0}</div>
            </div>
            <div className="rounded-[1.75rem] border border-white/10 bg-black/15 p-4">
              <div className="text-xs uppercase tracking-[0.28em] text-amber-200/70">Best Streak</div>
              <div className="mt-2 text-3xl font-black text-white">{playerProgress?.bestStreak ?? 0}</div>
            </div>
            <div className="rounded-[1.75rem] border border-white/10 bg-black/15 p-4">
              <div className="text-xs uppercase tracking-[0.28em] text-amber-200/70">Meta Currency</div>
              <div className="mt-2 text-3xl font-black text-white">{teamProgress.metaCurrency}</div>
            </div>
            <div className="rounded-[1.75rem] border border-white/10 bg-black/15 p-4">
              <div className="text-xs uppercase tracking-[0.28em] text-amber-200/70">Best Endless Wave</div>
              <div className="mt-2 text-3xl font-black text-white">{teamProgress.records.bestEndlessWave}</div>
            </div>
          </div>

          <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-black/15 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Tempo</div>
                <div className="mt-2 text-sm text-amber-100/75">Slow enough to learn, fast enough to sting.</div>
              </div>
              <div className="text-sm text-amber-100/75">{wpm} WPM · {unitMs}ms dot</div>
            </div>
            <input
              type="range"
              min={8}
              max={24}
              value={wpm}
              onChange={(event) => setWpm(Number(event.target.value))}
              className="mt-4 w-full accent-amber-400"
            />
          </div>

          <div className="mt-6">
            {activeTab === 'learn' && (
              <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr]">
                <div className="space-y-4 rounded-[2rem] border border-white/10 bg-black/15 p-5">
                  <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Lessons</div>
                  {MORSE_LESSONS.map((lesson) => {
                    const locked = lesson.index > (playerProgress?.unlockedLessonIndex ?? 0);
                    return (
                      <button
                        key={lesson.id}
                        disabled={locked}
                        onClick={() => !locked && setSelectedLessonIndex(lesson.index)}
                        className={`w-full rounded-2xl border px-4 py-4 text-left ${
                          selectedLesson.index === lesson.index ? 'border-amber-300/30 bg-amber-400/10' : 'border-white/10 bg-white/5'
                        } ${locked ? 'opacity-45' : ''}`}
                      >
                        <div className="font-semibold text-white">{lesson.title}</div>
                        <div className="mt-1 text-sm text-amber-100/70">{lesson.focus.join(' · ')}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-4">
                  <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                    <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Lesson Prompt</div>
                    <div className="mt-3 text-4xl font-black tracking-[0.2em] text-white">{lessonPrompt}</div>
                    <div className="mt-2 font-mono text-sm text-amber-200">
                      {helpers.showCheatSheet ? encodeTextToMorse(lessonPrompt) : 'Hide helpers to test memory.'}
                    </div>
                    <div className="mt-4 rounded-[1.5rem] bg-white/6 p-4 text-sm text-amber-100/80">{lessonFeedback}</div>
                  </div>
                  <SignalPad
                    title="Guided Key"
                    subtitle="Use touch or Space. A quiet gap auto-submits your answer."
                    liveSymbols={liveSymbols}
                    liveOutput={liveOutput}
                    decodedPreview={decodedPreview}
                    isHolding={isHolding}
                    unitMs={unitMs}
                    onStart={() => void startSignal()}
                    onStop={() => void stopSignal()}
                  />
                </div>
              </div>
            )}

            {activeTab === 'practice' && (
              <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Copy Practice</div>
                        <div className="mt-2 text-3xl font-black tracking-[0.2em] text-white">{practicePrompt}</div>
                      </div>
                      <button
                        onClick={() => setPracticePrompt(generatePracticePrompt(selectedLesson.symbolPool, selectedLesson.challengeWords))}
                        className="rounded-full border border-amber-300/25 bg-white/6 px-4 py-2 text-sm text-amber-50"
                      >
                        Spin Prompt
                      </button>
                    </div>
                    <div className="mt-3 font-mono text-sm text-amber-200">{helpers.showCheatSheet ? encodeTextToMorse(practicePrompt) : 'Recall only'}</div>
                    <div className="mt-4 rounded-[1.5rem] bg-white/6 p-4 text-sm text-amber-100/80">{practiceFeedback}</div>
                  </div>
                  <SignalPad
                    title="Practice Key"
                    subtitle="This drill tracks streaks and common misses without locking the lesson flow."
                    liveSymbols={liveSymbols}
                    liveOutput={liveOutput}
                    decodedPreview={decodedPreview}
                    isHolding={isHolding}
                    unitMs={unitMs}
                    onStart={() => void startSignal()}
                    onStop={() => void stopSignal()}
                  />
                </div>
                <div className="space-y-4">
                  <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                    <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Translator</div>
                    <textarea
                      value={translatorText}
                      onChange={(event) => {
                        const value = event.target.value.toUpperCase();
                        setTranslatorText(value);
                        setTranslatorMorse(encodeTextToMorse(value));
                      }}
                      className="mt-4 min-h-28 w-full rounded-[1.5rem] border border-white/10 bg-white/6 px-4 py-3 text-white outline-none"
                    />
                    <textarea
                      value={translatorMorse}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTranslatorMorse(value);
                        setTranslatorText(decodeTextFromMorse(value));
                      }}
                      className="mt-3 min-h-28 w-full rounded-[1.5rem] border border-white/10 bg-white/6 px-4 py-3 font-mono text-amber-200 outline-none"
                    />
                  </div>
                  <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                    <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Recent Misses</div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(playerProgress?.recentMistakes.length ? playerProgress.recentMistakes : ['No misses saved yet']).map((entry) => (
                        <span key={entry} className="rounded-full bg-white/8 px-3 py-2 text-sm text-amber-100/80">
                          {entry}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'room' && (
              <div className="grid gap-4 xl:grid-cols-[1fr,1fr]">
                <div className="space-y-4">
                  <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Live Morse Room</div>
                      <button
                        onClick={async () => {
                          const sent = await notifyPartner('morse_room_invite', 'The signal room is open');
                          setRoomStatus(sent ? `Invite sent to ${partnerName}.` : 'Could not send the room invite.');
                        }}
                        className="rounded-full border border-amber-300/25 bg-white/6 px-4 py-2 text-sm text-amber-50"
                      >
                        Invite {partnerName}
                      </button>
                    </div>
                    <div className="mt-4 rounded-[1.5rem] bg-white/6 p-4 text-sm text-amber-100/80">
                      {roomStatus}
                      <div className="mt-2 text-xs uppercase tracking-[0.2em] text-amber-200/70">
                        {roomPresence ?? `${partnerName} not detected yet`}
                      </div>
                    </div>
                    <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Partner Pulse</div>
                        <div className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] ${partnerIsHolding ? 'bg-amber-400/20 text-amber-100' : 'bg-white/8 text-amber-100/65'}`}>
                          {partnerIsHolding ? 'Live' : 'Listening'}
                        </div>
                      </div>
                      <div className="mt-3 font-mono text-2xl tracking-[0.25em] text-amber-200">
                        {partnerLiveSymbols.length > 0 ? partnerLiveSymbols.join('') : '...'}
                      </div>
                      <div className="mt-2 text-sm text-amber-100/70">
                        {partnerIsHolding ? `${partnerName} is pressing the key right now.` : 'Each partner pulse appears here before the full word lands in the transcript.'}
                      </div>
                    </div>
                  </div>
                  <SignalPad
                    title="Room Key"
                    subtitle="Words auto-send after a quiet gap. The transcript stays team-readable by default."
                    liveSymbols={liveSymbols}
                    liveOutput={liveOutput}
                    decodedPreview={decodedPreview}
                    isHolding={isHolding}
                    unitMs={unitMs}
                    onStart={() => void startSignal()}
                    onStop={() => void stopSignal()}
                  />
                </div>
                <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                  <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Transcript</div>
                  <div className="mt-4 space-y-3">
                    {roomMessages.length === 0 && (
                      <div className="rounded-[1.5rem] bg-white/6 p-4 text-sm text-amber-100/70">
                        The room is quiet. First transmission wins the silence.
                      </div>
                    )}
                    {roomMessages.map((message) => {
                      const isMe = message.user === currentUser;
                      return (
                        <div key={message.id} className={`rounded-[1.5rem] border px-4 py-3 ${isMe ? 'border-sky-300/25 bg-sky-500/10' : 'border-rose-300/25 bg-rose-500/10'}`}>
                          <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">
                            {isMe ? 'You' : partnerName}
                          </div>
                          <div className="mt-2 text-xl font-semibold text-white">{message.decodedText}</div>
                          <div className="mt-1 font-mono text-sm text-amber-200">{message.symbols.join('')}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'defense' && (
              <div className="space-y-5">
                <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
                  <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                    <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Battle Launch</div>
                    <h3 className="mt-3 text-3xl font-serif font-bold text-white">Defend the keep on a real battlefield.</h3>
                    <p className="mt-3 text-sm text-amber-100/75">
                      Defense now opens in a full-screen side-view siege. Enemies march from the right toward your
                      castle, arrows visibly fire from the wall, and the Morse key stays pinned to the battle HUD.
                    </p>
                    <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/6 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Campaign Level</div>
                      <select
                        value={selectedLevel}
                        onChange={(event) => setSelectedLevel(Number(event.target.value))}
                        className="mt-3 w-full rounded-full border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none"
                      >
                        {MORSE_CAMPAIGN_LEVELS.map((level) => (
                          <option key={level.id} value={level.number}>
                            Level {level.number}: {level.title}
                          </option>
                        ))}
                      </select>
                      <div className="mt-3 text-sm text-amber-100/70">
                        {MORSE_CAMPAIGN_LEVELS[selectedLevel - 1]?.narrative}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <button onClick={() => void startRun('campaign', false)} className="rounded-[1.5rem] bg-gradient-to-r from-amber-400 to-orange-400 px-5 py-4 text-left text-sm font-black uppercase tracking-[0.2em] text-slate-950">
                        Solo Campaign
                      </button>
                      <button onClick={() => void startRun('campaign', true)} className="rounded-[1.5rem] border border-amber-300/25 bg-white/6 px-5 py-4 text-left text-sm font-semibold text-amber-50">
                        Co-op Campaign
                      </button>
                      <button onClick={() => void startRun('endless', false)} className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-4 text-left text-sm font-semibold text-amber-50">
                        Endless Solo
                      </button>
                      <button onClick={() => void startRun('endless', true)} className="rounded-[1.5rem] border border-white/10 bg-white/6 px-5 py-4 text-left text-sm font-semibold text-amber-50">
                        Endless Co-op
                      </button>
                    </div>
                    <div className="mt-4 rounded-[1.5rem] bg-white/6 p-4 text-sm text-amber-100/80">{defenseStatus}</div>
                    {waitingRuns.length > 0 && (
                      <div className="mt-5">
                        <div className="text-xs uppercase tracking-[0.24em] text-amber-200/70">Open Co-op Battles</div>
                        <div className="mt-3 space-y-2">
                          {waitingRuns.map((run) => (
                            <button
                              key={run.id}
                              onClick={() => void joinRun(run)}
                              className="w-full rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4 text-left transition hover:bg-white/10"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="font-semibold text-white">{run.mode === 'campaign' ? 'Campaign' : 'Endless'} level {run.level_number}</div>
                                <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">Join</div>
                              </div>
                              <div className="mt-1 text-sm text-amber-100/70">Host: {run.host_player === 'daniel' ? 'Daniel' : 'Huaiyao'}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="overflow-hidden rounded-[2rem] border border-amber-300/15 bg-[radial-gradient(circle_at_top,#805228,transparent_35%),linear-gradient(180deg,#22130d,#0f0a08_60%,#080706)] p-5">
                    <div className="relative min-h-[420px] overflow-hidden rounded-[1.6rem] border border-white/10 bg-black/20">
                      <div className="absolute inset-x-10 top-8 h-28 rounded-full bg-amber-300/10 blur-3xl" />
                      <div className="absolute left-[10%] top-[8%] h-[48%] w-[26%] rounded-[42%] bg-[linear-gradient(180deg,rgba(146,94,48,0.76),rgba(71,42,22,0.94))]" />
                      <div className="absolute left-1/2 top-[4%] h-[54%] w-[12%] -translate-x-1/2 rounded-[40%] bg-[linear-gradient(180deg,rgba(146,94,48,0.76),rgba(71,42,22,0.94))]" />
                      <div className="absolute right-[10%] top-[8%] h-[48%] w-[26%] rounded-[42%] bg-[linear-gradient(180deg,rgba(146,94,48,0.76),rgba(71,42,22,0.94))]" />
                      <div className="absolute left-1/2 top-[52%] h-32 w-64 -translate-x-1/2 rounded-[2rem_2rem_1rem_1rem] border border-amber-200/20 bg-[linear-gradient(180deg,rgba(132,76,37,0.92),rgba(62,35,19,0.98))]" />
                      <div className="absolute left-[25%] top-[57%] h-1 w-[24%] rotate-[27deg] rounded-full bg-amber-100/80 shadow-[0_0_18px_rgba(253,224,71,0.45)]" />
                      <div className="absolute left-[50%] top-[53%] h-1 w-[16%] -rotate-[34deg] rounded-full bg-amber-100/80 shadow-[0_0_18px_rgba(253,224,71,0.45)]" />
                      <div className="absolute left-[18%] top-[37%] h-12 w-12 rounded-full border-4 border-slate-200/80 bg-slate-700/80" />
                      <div className="absolute left-[56%] top-[22%] h-12 w-12 rounded-full border-4 border-slate-200/80 bg-slate-700/80" />
                      <div className="absolute right-[18%] top-[30%] h-16 w-16 rounded-full border-4 border-rose-200/80 bg-rose-900/70" />
                      <div className="relative z-10 max-w-md p-5">
                        <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-5 backdrop-blur">
                          <div className="text-xs uppercase tracking-[0.28em] text-amber-200/70">Battlefield Preview</div>
                          <h3 className="mt-3 text-3xl font-serif font-bold text-white">A side-view castle siege, not a dashboard.</h3>
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {[
                              'Animated marching enemies',
                              'Visible arrow and catapult shots',
                              'Shared co-op battlefield',
                              'Wave-break shop overlay',
                            ].map((feature) => (
                              <div key={feature} className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-amber-50/85">
                                {feature}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.02fr,0.98fr]">
                  <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                    <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Battle Systems</div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {[
                        ['Shared map', 'Both of you attack the same enemies on one battlefield.'],
                        ['Live Morse dock', 'Hold-to-tone input stays available during every wave.'],
                        ['Animated defenses', 'Correct letters trigger visible arrows and tower shots.'],
                        ['War economy', 'Spend supplies between waves on towers, upgrades, and powers.'],
                      ].map(([title, copy]) => (
                        <div key={title} className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4">
                          <div className="text-sm font-semibold text-white">{title}</div>
                          <div className="mt-2 text-sm text-amber-100/70">{copy}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">War Records</div>
                        <h3 className="mt-3 text-2xl font-bold text-white">Progression feeds every future siege.</h3>
                      </div>
                      <Link href="/morse/defense?mode=campaign&level=1&coop=0" className="rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-amber-100/80">
                        Open Battle Route
                      </Link>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[1.3rem] bg-white/6 p-4"><div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Best Campaign</div><div className="mt-2 text-3xl font-black text-white">{teamProgress.records.bestCampaignLevel}</div></div>
                      <div className="rounded-[1.3rem] bg-white/6 p-4"><div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Best Endless</div><div className="mt-2 text-3xl font-black text-white">{teamProgress.records.bestEndlessWave}</div></div>
                      <div className="rounded-[1.3rem] bg-white/6 p-4"><div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Best Score</div><div className="mt-2 text-3xl font-black text-white">{teamProgress.records.bestScore}</div></div>
                      <div className="rounded-[1.3rem] bg-white/6 p-4"><div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Signal Cache</div><div className="mt-2 text-3xl font-black text-amber-200">{teamProgress.metaCurrency}</div></div>
                    </div>
                    <div className="mt-5 space-y-2">
                      {recentRuns.length === 0 && (
                        <div className="rounded-[1.3rem] bg-white/6 px-4 py-4 text-sm text-amber-100/70">
                          No battles recorded yet. Launch one to start the record book.
                        </div>
                      )}
                      {recentRuns.slice(0, 4).map((run) => (
                        <div key={run.id} className="rounded-[1.3rem] border border-white/10 bg-white/6 px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-white">{run.mode === 'campaign' ? `Campaign ${run.level_number}` : `Endless wave ${run.endless_wave}`}</div>
                            <div className="text-sm text-amber-200">{run.score} pts</div>
                          </div>
                          <div className="mt-1 text-sm text-amber-100/70">
                            {run.host_player === 'daniel' ? 'Daniel' : 'Huaiyao'}
                            {run.guest_player ? ` + ${run.guest_player === 'daniel' ? 'Daniel' : 'Huaiyao'}` : ' solo'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'armory' && (
              <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Armory</div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="rounded-[1.5rem] bg-white/6 p-4">
                    <div className="text-sm font-semibold text-white">Permanent Signal Cache</div>
                    <div className="mt-2 text-3xl font-black text-amber-200">{teamProgress.metaCurrency}</div>
                    <div className="mt-2 text-sm text-amber-100/70">Spend rewards here to unlock more systems over time.</div>
                  </div>
                  <div className="rounded-[1.5rem] bg-white/6 p-4">
                    <div className="text-sm font-semibold text-white">Campaign Access</div>
                    <div className="mt-2 text-3xl font-black text-white">Level {teamProgress.unlockedCampaignLevel}</div>
                    <div className="mt-2 text-sm text-amber-100/70">{teamProgress.endlessUnlocked ? 'Endless mode unlocked' : 'Clear the full ladder to unlock endless mode.'}</div>
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-amber-200/70">Upgrades</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {ARMORY_UPGRADES.map((upgrade) => (
                        <button
                          key={upgrade.id}
                          onClick={() => {
                            const next = unlockArmoryUpgrade(teamProgress, upgrade.category, upgrade.id, upgrade.cost);
                            setTeamProgress(next);
                            void persistTeam(next);
                          }}
                          className="rounded-[1.5rem] border border-white/10 bg-white/6 px-4 py-4 text-left"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-white">{upgrade.label}</div>
                            <div className="text-sm text-amber-200">{upgrade.cost}</div>
                          </div>
                          <div className="mt-1 text-sm text-amber-100/70">{upgrade.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-amber-200/70">Tower Unlocks</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {ARMORY_TOWER_UNLOCKS.map((unlock) => {
                        const owned = teamProgress.unlockedTowers.includes(unlock.id);
                        return (
                          <button
                            key={unlock.id}
                            disabled={owned}
                            onClick={() => {
                              const next = unlockArmoryUpgrade(teamProgress, unlock.category, unlock.id, unlock.cost);
                              setTeamProgress(next);
                              void persistTeam(next);
                            }}
                            className={`rounded-[1.5rem] border px-4 py-4 text-left ${owned ? 'border-white/10 bg-white/4 text-white/45' : 'border-white/10 bg-white/6'}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold text-white">{unlock.label}</div>
                              <div className="text-sm text-amber-200">{owned ? 'Owned' : unlock.cost}</div>
                            </div>
                            <div className="mt-1 text-sm text-amber-100/70">{unlock.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.25em] text-amber-200/70">Power Unlocks</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {ARMORY_POWER_UNLOCKS.map((unlock) => {
                        const owned = teamProgress.unlockedPowers.includes(unlock.id);
                        return (
                          <button
                            key={unlock.id}
                            disabled={owned}
                            onClick={() => {
                              const next = unlockArmoryUpgrade(teamProgress, unlock.category, unlock.id, unlock.cost);
                              setTeamProgress(next);
                              void persistTeam(next);
                            }}
                            className={`rounded-[1.5rem] border px-4 py-4 text-left ${owned ? 'border-white/10 bg-white/4 text-white/45' : 'border-white/10 bg-white/6'}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-semibold text-white">{unlock.label}</div>
                              <div className="text-sm text-amber-200">{owned ? 'Owned' : unlock.cost}</div>
                            </div>
                            <div className="mt-1 text-sm text-amber-100/70">{unlock.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'records' && (
              <div className="grid gap-4 xl:grid-cols-[0.8fr,1.2fr]">
                <div className="space-y-4 rounded-[2rem] border border-white/10 bg-black/15 p-5">
                  <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Team Records</div>
                  <div className="rounded-[1.5rem] bg-white/6 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Best Campaign Clear</div>
                    <div className="mt-2 text-3xl font-black text-white">{teamProgress.records.bestCampaignLevel}</div>
                  </div>
                  <div className="rounded-[1.5rem] bg-white/6 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Best Endless Wave</div>
                    <div className="mt-2 text-3xl font-black text-white">{teamProgress.records.bestEndlessWave}</div>
                  </div>
                  <div className="rounded-[1.5rem] bg-white/6 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-amber-100/60">Total Signals</div>
                    <div className="mt-2 text-3xl font-black text-white">{teamProgress.records.totalSignals}</div>
                  </div>
                </div>
                <div className="rounded-[2rem] border border-white/10 bg-black/15 p-5">
                  <div className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Recent Runs</div>
                  <div className="mt-4 space-y-3">
                    {[...recentRuns, ...teamProgress.records.recentRuns.map((run) => ({
                      id: run.id,
                      mode: run.mode,
                      host_player: currentUser,
                      guest_player: null,
                      status: 'completed' as const,
                      level_number: run.levelNumber,
                      endless_wave: run.wave,
                      checkpoint: null,
                      score: run.score,
                      currency_earned: 0,
                      final_summary: { outcome: run.outcome },
                      created_at: run.completedAt,
                      updated_at: run.completedAt,
                      completed_at: run.completedAt,
                    }))].slice(0, 12).map((run) => (
                      <div key={run.id} className="rounded-[1.5rem] border border-white/10 bg-white/6 px-4 py-4">
                        <div className="font-semibold text-white">{run.mode === 'campaign' ? 'Campaign' : 'Endless'} level {run.level_number}</div>
                        <div className="mt-1 text-sm text-amber-100/70">Score {run.score} · Wave {run.endless_wave || run.level_number}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
