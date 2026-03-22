import type {
  MorseLesson,
  MorseLevelConfig,
  MorsePowerCatalogEntry,
  MorseSpawnBlueprint,
  MorseTowerCatalogEntry,
  MorseWaveConfig,
} from './types';

export const MORSE_ALPHABET: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  0: '-----',
  1: '.----',
  2: '..---',
  3: '...--',
  4: '....-',
  5: '.....',
  6: '-....',
  7: '--...',
  8: '---..',
  9: '----.',
};

export const LESSON_GROUPS: string[][] = [
  ['E', 'T', 'I', 'M'],
  ['A', 'N', 'S', 'O'],
  ['R', 'K', 'D', 'G'],
  ['U', 'W', 'H', 'V'],
  ['F', 'L', 'P', 'J'],
  ['B', 'X', 'C', 'Y'],
  ['Z', 'Q', '1', '2', '3', '4'],
  ['5', '6', '7', '8', '9', '0'],
];

const LESSON_WORDS = [
  ['TIME', 'MEET', 'TENT', 'ITEM'],
  ['SAND', 'MOON', 'TONE', 'SEAT'],
  ['RING', 'DARK', 'RANK', 'SEND'],
  ['WAVE', 'HUNT', 'VAULT', 'SOUTH'],
  ['FLAME', 'JUMP', 'PLUME', 'LEAF'],
  ['COZY', 'BAY', 'BOX', 'CYCLE'],
  ['ZONE', 'CODE', 'Q2', 'B3'],
  ['950', '780', '605', '409'],
];

const LESSON_REWARDS = [
  'Unlock sparrows at the tower wall',
  'Unlock shielded invaders',
  'Unlock castle armory upgrades',
  'Unlock slow-and-reveal lanterns',
  'Unlock teamwork elites',
  'Unlock boss catapults',
  'Unlock the number battlements',
  'Unlock endless challenge banners',
];

export const MORSE_LESSONS: MorseLesson[] = LESSON_GROUPS.map((focus, index) => ({
  id: `lesson-${index + 1}`,
  index,
  title: `Lesson ${index + 1}`,
  description:
    index === 0
      ? 'Start with the shortest, friendliest signals and build timing confidence.'
      : 'Add a few new symbols while still drilling everything you already know.',
  focus,
  symbolPool: LESSON_GROUPS.slice(0, index + 1).flat(),
  challengeWords: LESSON_WORDS[index],
  rewardLabel: LESSON_REWARDS[index],
}));

export const MORSE_TOWER_CATALOG: MorseTowerCatalogEntry[] = [
  {
    type: 'ballista',
    label: 'Ballista Nest',
    description: 'A castle-mounted archer platform that steadily softens the front line.',
    short: 'Steady wall damage',
    cost: 8,
  },
  {
    type: 'lantern',
    label: 'Signal Lantern',
    description: 'Bathes the road in signal-light, slowing the march and exposing harder codes.',
    short: 'Reveal + slow aura',
    cost: 10,
  },
  {
    type: 'mint',
    label: 'Quartermaster Crate',
    description: 'Supplies the battlements with extra resources for longer sieges.',
    short: 'Resource engine',
    cost: 12,
  },
  {
    type: 'catapult',
    label: 'Bossbreaker Catapult',
    description: 'A heavy castle engine built to crack elites and bosses before they breach the gate.',
    short: 'Elite damage',
    cost: 14,
  },
];

export const MORSE_POWER_CATALOG: MorsePowerCatalogEntry[] = [
  {
    type: 'volley',
    label: 'Arrow Volley',
    description: 'Loose a rapid storm of arrows across the entire battlefield.',
    cost: 5,
  },
  {
    type: 'freeze',
    label: 'Frost Bell',
    description: 'Stops the entire march long enough to recover from a dangerous push.',
    cost: 7,
  },
  {
    type: 'reveal',
    label: 'Reveal Rune',
    description: 'Temporarily projects clean Morse hints above every enemy.',
    cost: 6,
  },
];

const LEVEL_DEFS = [
  {
    title: 'Beacon Hill',
    narrative: 'The keep is quiet. Learn the signal drum before the first scouts arrive.',
    symbolPool: ['E', 'T', 'I', 'M'],
    bossChars: ['M'],
    reward: 18,
    difficultyLabel: 'Warmup',
  },
  {
    title: 'Pine Watch',
    narrative: 'The road grows busier, and longer patterns begin to mix together.',
    symbolPool: ['E', 'T', 'I', 'M', 'A', 'N', 'S', 'O'],
    bossChars: ['S', 'O'],
    reward: 22,
    difficultyLabel: 'Easy',
  },
  {
    title: 'Kite Gate',
    narrative: 'Armored raiders test whether you can repeat clean signals under pressure.',
    symbolPool: ['E', 'T', 'I', 'M', 'A', 'N', 'S', 'O', 'R', 'K', 'D', 'G'],
    bossChars: ['R', 'G'],
    reward: 26,
    difficultyLabel: 'Steady',
  },
  {
    title: 'Lantern Pass',
    narrative: 'Fast movers surge down the road and punish slow decoding.',
    symbolPool: ['E', 'T', 'I', 'M', 'A', 'N', 'S', 'O', 'R', 'K', 'D', 'G', 'U', 'W', 'H', 'V'],
    bossChars: ['V'],
    reward: 30,
    difficultyLabel: 'Spicy',
  },
  {
    title: 'Falcon Wall',
    narrative: 'The alphabet is almost complete, and the castle starts demanding teamwork.',
    symbolPool: ['E', 'T', 'I', 'M', 'A', 'N', 'S', 'O', 'R', 'K', 'D', 'G', 'U', 'W', 'H', 'V', 'F', 'L', 'P', 'J'],
    bossChars: ['P', 'J'],
    reward: 36,
    difficultyLabel: 'Hard',
  },
  {
    title: 'Cipher Orchard',
    narrative: 'Rare letters join the mix and elites begin chaining their pushes.',
    symbolPool: ['E', 'T', 'I', 'M', 'A', 'N', 'S', 'O', 'R', 'K', 'D', 'G', 'U', 'W', 'H', 'V', 'F', 'L', 'P', 'J', 'B', 'X', 'C', 'Y'],
    bossChars: ['X', 'Y'],
    reward: 44,
    difficultyLabel: 'Very Hard',
  },
  {
    title: 'Number Forge',
    narrative: 'The siege code starts mixing letters and numbers in one relentless march.',
    symbolPool: ['E', 'T', 'I', 'M', 'A', 'N', 'S', 'O', 'R', 'K', 'D', 'G', 'U', 'W', 'H', 'V', 'F', 'L', 'P', 'J', 'B', 'X', 'C', 'Y', 'Z', 'Q', '1', '2', '3', '4'],
    bossChars: ['4', 'Q'],
    reward: 54,
    difficultyLabel: 'Brutal',
  },
  {
    title: 'Impossible Sky',
    narrative: 'Full Morse set, layered bosses, and almost no safe breathing room.',
    symbolPool: Object.keys(MORSE_ALPHABET),
    bossChars: ['7', '9', 'Z'],
    reward: 70,
    difficultyLabel: 'Impossible',
  },
];

const GROUND_OFFSETS = [-28, -10, 10, 26];

function buildWave(id: string, levelNumber: number, symbolPool: string[], waveIndex: number, bossChar?: string): MorseWaveConfig {
  const baseCount = 4 + levelNumber + waveIndex * 2;
  const enemies: MorseSpawnBlueprint[] = Array.from({ length: baseCount }, (_, enemyIndex) => {
    const targetChar = symbolPool[(enemyIndex * 3 + waveIndex + levelNumber) % symbolPool.length];
    const armored = levelNumber >= 3 && enemyIndex % 3 === 0;
    const elite = levelNumber >= 5 && enemyIndex % 6 === 4;
    return {
      targetChar,
      kind: elite ? 'elite' as const : armored ? 'armored' as const : 'runner' as const,
      speed: 4 + levelNumber * 0.42 + waveIndex * 0.28,
      health: elite ? 2 : armored ? 2 : 1,
      reward: elite ? 6 : armored ? 4 : 3,
      damage: elite ? 2 : 1,
      groundOffsetY: GROUND_OFFSETS[(enemyIndex + waveIndex) % GROUND_OFFSETS.length],
      revealed: waveIndex < 1,
    };
  });

  if (bossChar) {
    enemies.push({
      targetChar: bossChar,
      kind: 'boss',
      speed: 2.35 + levelNumber * 0.18,
      health: Math.max(2, Math.floor(levelNumber / 2)),
      reward: 20 + levelNumber * 2,
      damage: 3,
      groundOffsetY: 0,
      revealed: true,
    });
  }

  return {
    id,
    spawnIntervalMs: Math.max(720, 1400 - levelNumber * 55 - waveIndex * 40),
    enemies,
  };
}

export const MORSE_CAMPAIGN_LEVELS: MorseLevelConfig[] = LEVEL_DEFS.map((level, index) => {
  const levelNumber = index + 1;
  return {
    id: `campaign-${levelNumber}`,
    number: levelNumber,
    title: level.title,
    narrative: level.narrative,
    unlockedChars: level.symbolPool,
    symbolPool: level.symbolPool,
    bossChars: level.bossChars,
    reward: level.reward,
    difficultyLabel: level.difficultyLabel,
    waves: [
      buildWave(`campaign-${levelNumber}-wave-1`, levelNumber, level.symbolPool, 0),
      buildWave(`campaign-${levelNumber}-wave-2`, levelNumber, level.symbolPool, 1),
      buildWave(`campaign-${levelNumber}-wave-3`, levelNumber, level.symbolPool, 2, level.bossChars[0]),
    ],
  };
});

export const ENDLESS_SYMBOL_POOL = Object.keys(MORSE_ALPHABET);
