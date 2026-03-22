export type MorsePlayer = 'daniel' | 'huaiyao';

export type MorseSymbol = '.' | '-';

export type MorseTab = 'learn' | 'practice' | 'room' | 'defense' | 'armory' | 'records';

export interface MorseLesson {
  id: string;
  index: number;
  title: string;
  description: string;
  focus: string[];
  symbolPool: string[];
  challengeWords: string[];
  rewardLabel: string;
}

export interface MorseCharacterMastery {
  attempts: number;
  correct: number;
  bestStreak: number;
  lastAccuracy: number;
}

export interface MorsePlayerProgress {
  player: MorsePlayer;
  unlockedLessonIndex: number;
  totalTransmissions: number;
  currentStreak: number;
  bestStreak: number;
  lettersMastered: string[];
  mastery: Record<string, MorseCharacterMastery>;
  recentMistakes: string[];
  updated_at?: string;
}

export interface MorseRecentRun {
  id: string;
  mode: 'campaign' | 'endless';
  levelNumber: number;
  wave: number;
  score: number;
  outcome: 'victory' | 'defeat';
  completedAt: string;
}

export interface MorseTeamRecordSummary {
  bestCampaignLevel: number;
  bestEndlessWave: number;
  bestScore: number;
  totalSignals: number;
  totalRuns: number;
  recentRuns: MorseRecentRun[];
}

export interface MorsePermanentUpgrades {
  towerSlots: number;
  startingHealth: number;
  revealAssistLevel: number;
  powerCapacity: number;
}

export interface MorseTeamProgress {
  id: string;
  unlockedCampaignLevel: number;
  endlessUnlocked: boolean;
  metaCurrency: number;
  unlockedTowers: string[];
  unlockedPowers: string[];
  permanentUpgrades: MorsePermanentUpgrades;
  records: MorseTeamRecordSummary;
  updated_at?: string;
}

export interface MorseTransmission {
  id: string;
  user: MorsePlayer;
  symbols: MorseSymbol[];
  decodedText: string;
  plainTextAssist: string;
  kind: 'learn' | 'practice' | 'room' | 'defense';
  created_at: string;
  startedAt?: string;
  accuracy?: number;
  durationMs?: number;
}

export type MorseEnemyKind = 'runner' | 'armored' | 'elite' | 'boss';

export interface MorseEnemy {
  id: string;
  targetChar: string;
  code: string;
  kind: MorseEnemyKind;
  health: number;
  maxHealth: number;
  pathProgress: number;
  speed: number;
  reward: number;
  damage: number;
  groundOffsetY: number;
  revealed: boolean;
  comboPrimedBy: MorsePlayer | null;
  comboWindowUntil: number | null;
  lastHitAt: number | null;
}

export type MorseTowerType = 'ballista' | 'lantern' | 'mint' | 'catapult';

export type MorseTowerMountId =
  | 'wall-north'
  | 'wall-center'
  | 'wall-south'
  | 'roof-north'
  | 'roof-center'
  | 'roof-south';

export interface MorseTower {
  id: string;
  type: MorseTowerType;
  mountId: MorseTowerMountId;
  level: number;
  cooldownUntil: number;
}

export type MorsePowerType = 'volley' | 'freeze' | 'reveal';

export interface MorsePower {
  type: MorsePowerType;
  charges: number;
  cooldownUntil: number;
}

export interface MorseSpawnBlueprint {
  targetChar: string;
  kind: MorseEnemyKind;
  speed: number;
  health: number;
  reward: number;
  damage: number;
  groundOffsetY: number;
  revealed?: boolean;
}

export interface MorseWaveConfig {
  id: string;
  spawnIntervalMs: number;
  enemies: MorseSpawnBlueprint[];
}

export interface MorseLevelConfig {
  id: string;
  number: number;
  title: string;
  narrative: string;
  unlockedChars: string[];
  symbolPool: string[];
  waves: MorseWaveConfig[];
  bossChars: string[];
  reward: number;
  difficultyLabel: string;
}

export interface MorsePoint {
  x: number;
  y: number;
}

export type MorseShotKind = 'castle-arrow' | 'tower-arrow' | 'catapult';

export interface MorseShotAnimation {
  id: string;
  targetChar: string;
  enemyId: string;
  kind: MorseShotKind;
  origin: MorsePoint;
  target: MorsePoint;
  durationMs: number;
  createdAt: number;
}

export interface MorseRunSnapshot {
  id: string | null;
  mode: 'campaign' | 'endless';
  levelNumber: number;
  waveNumber: number;
  phase: 'waiting' | 'playing' | 'shop' | 'victory' | 'defeat';
  castleHealth: number;
  maxCastleHealth: number;
  resources: number;
  metaReward: number;
  score: number;
  signalsUsed: number;
  currentComboPrompt: string | null;
  enemies: MorseEnemy[];
  towers: MorseTower[];
  powers: MorsePower[];
  shots: MorseShotAnimation[];
  activeEffects: {
    freezeUntil: number;
    revealUntil: number;
  };
  pendingWave: MorseWaveConfig | null;
  partnerJoined: boolean;
  partnerOnline: boolean;
  recentEvents: string[];
  simulatedAt: number;
}

export interface MorseRun {
  id: string;
  mode: 'campaign' | 'endless';
  host_player: MorsePlayer;
  guest_player: MorsePlayer | null;
  status: 'waiting' | 'active' | 'completed' | 'abandoned';
  level_number: number;
  endless_wave: number;
  checkpoint: MorseRunSnapshot | null;
  score: number;
  currency_earned: number;
  final_summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MorseRoomPresence {
  user: MorsePlayer;
  lastSeen: number;
  holding: boolean;
  activeTab: 'room' | 'defense';
}

export interface MorseHelperSettings {
  showCheatSheet: boolean;
  liveDecode: boolean;
  autoSpacing: boolean;
  correctnessFeedback: boolean;
  demoPlayback: boolean;
}

export interface MorseTowerCatalogEntry {
  type: MorseTowerType;
  label: string;
  description: string;
  short: string;
  cost: number;
}

export interface MorsePowerCatalogEntry {
  type: MorsePowerType;
  label: string;
  description: string;
  cost: number;
}
