import { ENDLESS_SYMBOL_POOL, MORSE_ALPHABET } from './content';
import type {
  MorseCharacterMastery,
  MorsePlayerProgress,
  MorseSymbol,
  MorseTeamProgress,
  MorseTransmission,
} from './types';

export const PLAYER_PROGRESS_STORAGE_PREFIX = 'morse-player-progress:';
export const TEAM_PROGRESS_STORAGE_KEY = 'morse-team-progress';

const REVERSE_ALPHABET = Object.entries(MORSE_ALPHABET).reduce<Record<string, string>>((acc, [char, code]) => {
  acc[code] = char;
  return acc;
}, {});

export function calculateUnitMs(wpm: number): number {
  const safeWpm = Math.max(5, Math.min(40, wpm));
  return Math.round(1200 / safeWpm);
}

export function classifySymbol(durationMs: number, unitMs: number): MorseSymbol {
  return durationMs < unitMs * 2.15 ? '.' : '-';
}

export function decodeSymbols(symbols: MorseSymbol[]): string | null {
  if (symbols.length === 0) return null;
  return REVERSE_ALPHABET[symbols.join('')] ?? null;
}

export function encodeCharacter(char: string): string {
  return MORSE_ALPHABET[char.toUpperCase()] ?? '';
}

export function encodeTextToMorse(text: string): string {
  return text
    .toUpperCase()
    .split('')
    .map((char) => {
      if (char === ' ') return '/';
      return MORSE_ALPHABET[char] ?? '';
    })
    .filter(Boolean)
    .join(' ');
}

export function decodeTextFromMorse(input: string): string {
  return input
    .trim()
    .split('/')
    .map((word) =>
      word
        .trim()
        .split(/\s+/)
        .map((chunk) => REVERSE_ALPHABET[chunk] ?? '?')
        .join('')
    )
    .join(' ')
    .trim();
}

export function sanitizeSymbols(value: string): MorseSymbol[] {
  return value
    .split('')
    .filter((char): char is MorseSymbol => char === '.' || char === '-');
}

export function randomFromPool(pool: string[], count: number): string {
  const safePool = pool.length > 0 ? pool : ENDLESS_SYMBOL_POOL;
  let output = '';
  for (let index = 0; index < count; index += 1) {
    output += safePool[(index * 7 + count * 3 + safePool.length) % safePool.length];
  }
  return output;
}

export function generatePracticePrompt(pool: string[], wordBank: string[]): string {
  if (wordBank.length > 0) {
    return wordBank[Math.floor(Math.random() * wordBank.length)];
  }

  const length = pool.length < 6 ? 4 : 5;
  return Array.from({ length }, (_, index) => pool[(Date.now() + index * 13) % pool.length]).join('');
}

function getCharacterMastery(progress: MorsePlayerProgress, character: string): MorseCharacterMastery {
  return progress.mastery[character] ?? {
    attempts: 0,
    correct: 0,
    bestStreak: 0,
    lastAccuracy: 0,
  };
}

export function isCharacterMastered(mastery: MorseCharacterMastery | undefined): boolean {
  if (!mastery) return false;
  if (mastery.attempts < 4) return false;
  return mastery.correct / mastery.attempts >= 0.8;
}

export function updatePlayerProgress(
  progress: MorsePlayerProgress,
  targetText: string,
  attemptText: string,
  transmission: MorseTransmission,
): MorsePlayerProgress {
  const target = targetText.toUpperCase().trim();
  const attempt = attemptText.toUpperCase().trim();
  const next: MorsePlayerProgress = {
    ...progress,
    totalTransmissions: progress.totalTransmissions + 1,
    mastery: { ...progress.mastery },
    recentMistakes: [...progress.recentMistakes],
  };

  const isCorrect = target === attempt && target.length > 0;
  next.currentStreak = isCorrect ? progress.currentStreak + 1 : 0;
  next.bestStreak = Math.max(progress.bestStreak, next.currentStreak);

  for (const character of target.replace(/\s+/g, '')) {
    const mastery = getCharacterMastery(progress, character);
    const updated: MorseCharacterMastery = {
      attempts: mastery.attempts + 1,
      correct: mastery.correct + (attempt.includes(character) && isCorrect ? 1 : 0),
      bestStreak: isCorrect ? Math.max(mastery.bestStreak, progress.currentStreak + 1) : mastery.bestStreak,
      lastAccuracy: isCorrect ? 1 : Math.max(0, transmission.accuracy ?? 0),
    };
    next.mastery[character] = updated;
    if (isCharacterMastered(updated) && !next.lettersMastered.includes(character)) {
      next.lettersMastered = [...next.lettersMastered, character].sort();
    }
  }

  if (!isCorrect && target) {
    next.recentMistakes = [target, ...next.recentMistakes.filter((entry) => entry !== target)].slice(0, 8);
  }

  next.updated_at = new Date().toISOString();
  return next;
}

export function createEmptyPlayerProgress(player: MorsePlayerProgress['player']): MorsePlayerProgress {
  return {
    player,
    unlockedLessonIndex: 0,
    totalTransmissions: 0,
    currentStreak: 0,
    bestStreak: 0,
    lettersMastered: [],
    mastery: {},
    recentMistakes: [],
    updated_at: new Date().toISOString(),
  };
}

export function createEmptyTeamProgress(): MorseTeamProgress {
  return {
    id: 'main',
    unlockedCampaignLevel: 1,
    endlessUnlocked: false,
    metaCurrency: 0,
    unlockedTowers: ['ballista', 'lantern'],
    unlockedPowers: ['volley'],
    permanentUpgrades: {
      towerSlots: 2,
      startingHealth: 0,
      revealAssistLevel: 1,
      powerCapacity: 1,
    },
    records: {
      bestCampaignLevel: 0,
      bestEndlessWave: 0,
      bestScore: 0,
      totalSignals: 0,
      totalRuns: 0,
      recentRuns: [],
    },
    updated_at: new Date().toISOString(),
  };
}

export function mergePlayerProgress(value: Partial<MorsePlayerProgress> | null | undefined, player: MorsePlayerProgress['player']): MorsePlayerProgress {
  const fallback = createEmptyPlayerProgress(player);
  if (!value) return fallback;
  return {
    ...fallback,
    ...value,
    player,
    mastery: value.mastery ?? fallback.mastery,
    lettersMastered: value.lettersMastered ?? fallback.lettersMastered,
    recentMistakes: value.recentMistakes ?? fallback.recentMistakes,
  };
}

export function mergeTeamProgress(value: Partial<MorseTeamProgress> | null | undefined): MorseTeamProgress {
  const fallback = createEmptyTeamProgress();
  if (!value) return fallback;
  return {
    ...fallback,
    ...value,
    unlockedTowers: value.unlockedTowers ?? fallback.unlockedTowers,
    unlockedPowers: value.unlockedPowers ?? fallback.unlockedPowers,
    permanentUpgrades: {
      ...fallback.permanentUpgrades,
      ...(value.permanentUpgrades ?? {}),
    },
    records: {
      ...fallback.records,
      ...(value.records ?? {}),
      recentRuns: value.records?.recentRuns ?? fallback.records.recentRuns,
    },
  };
}

export function makeTransmissionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function computeAccuracy(targetText: string, attemptText: string): number {
  const target = targetText.toUpperCase();
  const attempt = attemptText.toUpperCase();
  if (!target) return 0;
  let matches = 0;
  for (let index = 0; index < Math.max(target.length, attempt.length); index += 1) {
    if (target[index] && target[index] === attempt[index]) {
      matches += 1;
    }
  }
  return matches / target.length;
}
