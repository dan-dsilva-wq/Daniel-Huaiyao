import {
  ENDLESS_SYMBOL_POOL,
  MORSE_ALPHABET,
  MORSE_CAMPAIGN_LEVELS,
  MORSE_POWER_CATALOG,
  MORSE_TOWER_CATALOG,
} from './content';
import { createEmptyTeamProgress, makeTransmissionId } from './core';
import type {
  MorseEnemy,
  MorseEnemyKind,
  MorseLevelConfig,
  MorsePlayer,
  MorsePower,
  MorsePowerType,
  MorseRunSnapshot,
  MorseTeamProgress,
  MorseTower,
  MorseTowerType,
  MorseWaveConfig,
} from './types';

const MAX_PROGRESS = 100;
const SHOP_PHASE_BONUS = 5;

function pickLaneWithFewestTowers(towers: MorseTower[]): number {
  const counts = [0, 0, 0];
  for (const tower of towers) {
    counts[tower.lane] += 1;
  }
  return counts.indexOf(Math.min(...counts));
}

function enemyCode(targetChar: string): string {
  return MORSE_ALPHABET[targetChar] ?? '.';
}

function createEnemy(blueprint: MorseWaveConfig['enemies'][number], index: number): MorseEnemy {
  return {
    id: `${blueprint.kind}-${index}-${blueprint.targetChar}-${Math.random().toString(36).slice(2, 6)}`,
    targetChar: blueprint.targetChar,
    code: enemyCode(blueprint.targetChar),
    lane: blueprint.lane,
    kind: blueprint.kind,
    health: blueprint.health,
    maxHealth: blueprint.health,
    progress: 0,
    speed: blueprint.speed,
    reward: blueprint.reward,
    damage: blueprint.damage,
    revealed: blueprint.revealed ?? false,
    comboPrimedBy: null,
    comboWindowUntil: null,
    lastHitAt: null,
  };
}

function baseSnapshot(mode: 'campaign' | 'endless', levelNumber: number, teamProgress: MorseTeamProgress, partnerJoined: boolean): MorseRunSnapshot {
  const maxCastleHealth = 10 + teamProgress.permanentUpgrades.startingHealth;
  return {
    id: null,
    mode,
    levelNumber,
    waveNumber: 1,
    phase: 'playing',
    castleHealth: maxCastleHealth,
    maxCastleHealth,
    resources: 10,
    metaReward: 0,
    score: 0,
    signalsUsed: 0,
    currentComboPrompt: null,
    enemies: [],
    towers: [
      {
        id: 'ballista-center',
        type: 'ballista',
        lane: 1,
        level: 1,
        cooldownUntil: 0,
      },
    ],
    powers: teamProgress.unlockedPowers.map((type) => ({
      type: type as MorsePowerType,
      charges: type === 'volley' ? 1 : 0,
      cooldownUntil: 0,
    })),
    shots: [],
    activeEffects: {
      freezeUntil: 0,
      revealUntil: 0,
    },
    pendingWave: null,
    lanePressure: [0, 0, 0],
    partnerJoined,
    partnerOnline: partnerJoined,
    recentEvents: ['The beacon is lit.'],
  };
}

function getCampaignLevel(levelNumber: number): MorseLevelConfig {
  return MORSE_CAMPAIGN_LEVELS[Math.max(0, Math.min(MORSE_CAMPAIGN_LEVELS.length - 1, levelNumber - 1))];
}

function buildEndlessWave(levelNumber: number, waveNumber: number): MorseWaveConfig {
  const count = 6 + waveNumber * 2;
  const enemies = Array.from({ length: count }, (_, index) => {
    const targetChar = ENDLESS_SYMBOL_POOL[(index * 5 + waveNumber * 3 + levelNumber) % ENDLESS_SYMBOL_POOL.length];
    const kind: MorseEnemyKind =
      waveNumber % 7 === 0 && index === count - 1
        ? 'boss'
        : waveNumber > 2 && index % 5 === 0
          ? 'elite'
          : waveNumber > 1 && index % 3 === 0
            ? 'armored'
            : 'runner';
    return {
      targetChar,
      lane: (index + waveNumber) % 3,
      kind,
      speed: 4.5 + waveNumber * 0.45,
      health: kind === 'boss' ? Math.max(3, Math.floor(waveNumber / 2)) : kind === 'elite' ? 2 : kind === 'armored' ? 2 : 1,
      reward: kind === 'boss' ? 25 + waveNumber : kind === 'elite' ? 7 : kind === 'armored' ? 4 : 3,
      damage: kind === 'boss' ? 3 : kind === 'elite' ? 2 : 1,
      revealed: waveNumber < 2,
    };
  });

  return {
    id: `endless-${levelNumber}-${waveNumber}`,
    spawnIntervalMs: Math.max(600, 1250 - waveNumber * 22),
    enemies,
  };
}

export function createInitialRunSnapshot(
  mode: 'campaign' | 'endless',
  levelNumber: number,
  teamProgress: MorseTeamProgress = createEmptyTeamProgress(),
  partnerJoined = false,
  startImmediately = true,
): MorseRunSnapshot {
  const snapshot = baseSnapshot(mode, levelNumber, teamProgress, partnerJoined);
  snapshot.pendingWave = mode === 'campaign'
    ? getCampaignLevel(levelNumber).waves[0]
    : buildEndlessWave(levelNumber, 1);
  if (!startImmediately) {
    return {
      ...snapshot,
      phase: 'waiting',
      recentEvents: ['Waiting for the second signaler to join.'],
    };
  }
  return startNextWave(snapshot, teamProgress);
}

export function startNextWave(snapshot: MorseRunSnapshot, teamProgress: MorseTeamProgress): MorseRunSnapshot {
  if (!snapshot.pendingWave) {
    return {
      ...snapshot,
      phase: 'victory',
      metaReward: snapshot.metaReward + 5,
      recentEvents: ['The walls hold for another night.', ...snapshot.recentEvents].slice(0, 6),
    };
  }

  const now = Date.now();
  const wave = snapshot.pendingWave;
  return {
    ...snapshot,
    towers: snapshot.towers.slice(0, teamProgress.permanentUpgrades.towerSlots + 1),
    enemies: wave.enemies.map((enemy, index) => createEnemy(enemy, index)),
    pendingWave: null,
    phase: 'playing',
    shots: [],
    currentComboPrompt: null,
    activeEffects: {
      ...snapshot.activeEffects,
      freezeUntil: Math.max(snapshot.activeEffects.freezeUntil, now),
    },
    recentEvents: [`Wave ${snapshot.waveNumber} is advancing.`, ...snapshot.recentEvents].slice(0, 6),
  };
}

function slowMultiplierForLane(snapshot: MorseRunSnapshot, lane: number): number {
  const lanterns = snapshot.towers.filter((tower) => tower.type === 'lantern' && tower.lane === lane).length;
  if (snapshot.activeEffects.freezeUntil > Date.now()) return 0;
  return lanterns > 0 ? Math.max(0.55, 1 - lanterns * 0.18) : 1;
}

function addShot(snapshot: MorseRunSnapshot, enemy: MorseEnemy): MorseRunSnapshot {
  return {
    ...snapshot,
    shots: [
      ...snapshot.shots,
      {
        id: makeTransmissionId('shot'),
        lane: enemy.lane,
        targetChar: enemy.targetChar,
        enemyId: enemy.id,
        createdAt: Date.now(),
      },
    ].slice(-10),
  };
}

function destroyEnemy(snapshot: MorseRunSnapshot, enemyId: string): MorseRunSnapshot {
  const enemy = snapshot.enemies.find((entry) => entry.id === enemyId);
  if (!enemy) return snapshot;
  const withoutEnemy = snapshot.enemies.filter((entry) => entry.id !== enemyId);
  const withShot = addShot(
    {
      ...snapshot,
      enemies: withoutEnemy,
      resources: snapshot.resources + enemy.reward,
      score: snapshot.score + enemy.reward * (enemy.kind === 'boss' ? 7 : enemy.kind === 'elite' ? 4 : 3),
    },
    enemy,
  );
  return {
    ...withShot,
    recentEvents: [`${enemy.targetChar} falls in lane ${enemy.lane + 1}.`, ...withShot.recentEvents].slice(0, 6),
  };
}

function touchCombo(enemy: MorseEnemy, by: MorsePlayer, allowSolo: boolean): { enemy: MorseEnemy; damage: number; prompt: string | null } {
  const now = Date.now();
  if (enemy.kind === 'runner' || enemy.kind === 'armored') {
    return {
      enemy: {
        ...enemy,
        health: enemy.health - 1,
        lastHitAt: now,
        revealed: true,
      },
      damage: 1,
      prompt: null,
    };
  }

  const comboWindow = enemy.kind === 'boss' ? 2800 : 2200;
  const partnerHitSatisfied = allowSolo
    ? enemy.comboWindowUntil !== null && enemy.comboWindowUntil > now
    : enemy.comboWindowUntil !== null && enemy.comboWindowUntil > now && enemy.comboPrimedBy !== by;

  if (!partnerHitSatisfied) {
    return {
      enemy: {
        ...enemy,
        comboPrimedBy: by,
        comboWindowUntil: now + comboWindow,
        lastHitAt: now,
        revealed: true,
      },
      damage: 0,
      prompt: allowSolo ? `${enemy.targetChar} primed. Repeat quickly.` : `${enemy.targetChar} primed. Partner confirm needed.`,
    };
  }

  return {
    enemy: {
      ...enemy,
      health: enemy.health - 1,
      comboPrimedBy: null,
      comboWindowUntil: null,
      lastHitAt: now,
      revealed: true,
    },
    damage: 1,
    prompt: null,
  };
}

export function applyDefenseTransmission(
  snapshot: MorseRunSnapshot,
  decodedChar: string,
  by: MorsePlayer,
): MorseRunSnapshot {
  const normalized = decodedChar.toUpperCase().trim().charAt(0);
  if (!normalized || snapshot.phase !== 'playing') return snapshot;

  const candidates = snapshot.enemies
    .filter((enemy) => enemy.targetChar === normalized)
    .sort((left, right) => right.progress - left.progress);

  if (candidates.length === 0) {
    return {
      ...snapshot,
      signalsUsed: snapshot.signalsUsed + 1,
      currentComboPrompt: null,
      recentEvents: [`${normalized} had no target.`, ...snapshot.recentEvents].slice(0, 6),
    };
  }

  const target = candidates[0];
  const comboResult = touchCombo(target, by, !snapshot.partnerJoined);
  const updatedEnemies = snapshot.enemies.map((enemy) => (enemy.id === target.id ? comboResult.enemy : enemy));
  const next: MorseRunSnapshot = {
    ...snapshot,
    signalsUsed: snapshot.signalsUsed + 1,
    enemies: updatedEnemies,
    currentComboPrompt: comboResult.prompt,
  };

  if (comboResult.damage === 0) {
    return {
      ...next,
      recentEvents: [comboResult.prompt ?? `${normalized} primed.`, ...next.recentEvents].slice(0, 6),
    };
  }

  const updatedTarget = updatedEnemies.find((enemy) => enemy.id === target.id);
  if (!updatedTarget) return next;

  if (updatedTarget.health <= 0) {
    return destroyEnemy(next, updatedTarget.id);
  }

  return {
    ...next,
    recentEvents: [`${normalized} hit for ${comboResult.damage}.`, ...next.recentEvents].slice(0, 6),
  };
}

function towerCooldown(type: MorseTowerType): number {
  switch (type) {
    case 'ballista':
      return 1800;
    case 'lantern':
      return 2200;
    case 'mint':
      return 6000;
    case 'catapult':
      return 3200;
  }
}

function applyTowerFire(snapshot: MorseRunSnapshot, tower: MorseTower, now: number): MorseRunSnapshot {
  if (tower.cooldownUntil > now) return snapshot;

  const towerIndex = snapshot.towers.findIndex((entry) => entry.id === tower.id);
  if (towerIndex === -1) return snapshot;
  const nextTowers = [...snapshot.towers];
  nextTowers[towerIndex] = {
    ...tower,
    cooldownUntil: now + towerCooldown(tower.type) - tower.level * 120,
  };

  let next: MorseRunSnapshot = {
    ...snapshot,
    towers: nextTowers,
  };

  if (tower.type === 'mint') {
    return {
      ...next,
      resources: next.resources + 2 + tower.level,
      recentEvents: ['Quartermaster adds supplies.', ...next.recentEvents].slice(0, 6),
    };
  }

  if (tower.type === 'lantern') {
    return {
      ...next,
      enemies: next.enemies.map((enemy) =>
        enemy.lane === tower.lane ? { ...enemy, revealed: true } : enemy
      ),
      recentEvents: [`Lane ${tower.lane + 1} is lit by lantern fire.`, ...next.recentEvents].slice(0, 6),
    };
  }

  const target = tower.type === 'catapult'
    ? next.enemies.find((enemy) => enemy.kind === 'boss' || enemy.kind === 'elite') ?? next.enemies[0]
    : next.enemies
        .filter((enemy) => enemy.lane === tower.lane)
        .sort((left, right) => right.progress - left.progress)[0];

  if (!target) return next;

  const damage = tower.type === 'catapult' ? 2 + tower.level : 1 + Math.floor((tower.level - 1) / 2);
  next = {
    ...next,
    enemies: next.enemies.map((enemy) =>
      enemy.id === target.id ? { ...enemy, health: enemy.health - damage, revealed: true } : enemy
    ),
  };

  const damagedTarget = next.enemies.find((enemy) => enemy.id === target.id);
  if (!damagedTarget) return next;
  if (damagedTarget.health <= 0) {
    return destroyEnemy(next, damagedTarget.id);
  }

  return next;
}

function refreshLanePressure(snapshot: MorseRunSnapshot): number[] {
  return [0, 1, 2].map((lane) =>
    snapshot.enemies
      .filter((enemy) => enemy.lane === lane)
      .reduce((sum, enemy) => sum + enemy.progress / MAX_PROGRESS + enemy.health * 0.6, 0)
  );
}

export function stepRunSnapshot(snapshot: MorseRunSnapshot, dtMs: number): MorseRunSnapshot {
  if (snapshot.phase !== 'playing') {
    return {
      ...snapshot,
      shots: snapshot.shots.filter((shot) => Date.now() - shot.createdAt < 450),
      lanePressure: refreshLanePressure(snapshot),
    };
  }

  const now = Date.now();
  let next: MorseRunSnapshot = {
    ...snapshot,
    shots: snapshot.shots.filter((shot) => now - shot.createdAt < 450),
  };

  for (const tower of next.towers) {
    next = applyTowerFire(next, tower, now);
  }

  const movedEnemies: MorseEnemy[] = [];
  let castleHealth = next.castleHealth;
  for (const enemy of next.enemies) {
    const multiplier = slowMultiplierForLane(next, enemy.lane);
    const progress = enemy.progress + (enemy.speed * multiplier * dtMs) / 1000;
    if (progress >= MAX_PROGRESS) {
      castleHealth -= enemy.damage;
      continue;
    }
    movedEnemies.push({
      ...enemy,
      progress,
      revealed: enemy.revealed || next.activeEffects.revealUntil > now,
      comboWindowUntil:
        enemy.comboWindowUntil && enemy.comboWindowUntil < now ? null : enemy.comboWindowUntil,
      comboPrimedBy:
        enemy.comboWindowUntil && enemy.comboWindowUntil < now ? null : enemy.comboPrimedBy,
    });
  }

  next = {
    ...next,
    castleHealth,
    enemies: movedEnemies,
    lanePressure: refreshLanePressure({ ...next, enemies: movedEnemies }),
  };

  if (castleHealth <= 0) {
    return {
      ...next,
      castleHealth: 0,
      phase: 'defeat',
      recentEvents: ['The keep has fallen.', ...next.recentEvents].slice(0, 6),
    };
  }

  if (movedEnemies.length === 0) {
    const nextWaveNumber = next.waveNumber + 1;
    const teamProgress = createEmptyTeamProgress();
    if (next.mode === 'campaign') {
      const level = getCampaignLevel(next.levelNumber);
      const pendingWave = level.waves[next.waveNumber] ?? null;
      if (!pendingWave) {
        return {
          ...next,
          phase: 'victory',
          metaReward: next.metaReward + level.reward,
          recentEvents: [`${level.title} cleared.`, ...next.recentEvents].slice(0, 6),
        };
      }
      return {
        ...next,
        phase: 'shop',
        resources: next.resources + SHOP_PHASE_BONUS,
        waveNumber: nextWaveNumber,
        pendingWave,
        recentEvents: [`Wave ${next.waveNumber} cleared. Refit the walls.`, ...next.recentEvents].slice(0, 6),
      };
    }

    return {
      ...next,
      phase: 'shop',
      resources: next.resources + SHOP_PHASE_BONUS + Math.floor(nextWaveNumber / 2),
      waveNumber: nextWaveNumber,
      pendingWave: buildEndlessWave(next.levelNumber, nextWaveNumber),
      recentEvents: [`Endless wave ${next.waveNumber} cleared.`, ...next.recentEvents].slice(0, 6),
      metaReward: next.metaReward + Math.max(3, Math.floor(nextWaveNumber / 2)),
      powers: next.powers.map((power) => ({
        ...power,
        charges: Math.min(power.charges + (power.type === 'volley' ? 1 : 0), teamProgress.permanentUpgrades.powerCapacity + 1),
      })),
    };
  }

  return next;
}

export function buyTower(snapshot: MorseRunSnapshot, type: MorseTowerType, teamProgress: MorseTeamProgress): MorseRunSnapshot {
  const towerDef = MORSE_TOWER_CATALOG.find((tower) => tower.type === type);
  if (!towerDef) return snapshot;
  if (snapshot.resources < towerDef.cost) return snapshot;
  const towerLimit = teamProgress.permanentUpgrades.towerSlots + 1;
  if (snapshot.towers.length >= towerLimit) return snapshot;

  const lane = pickLaneWithFewestTowers(snapshot.towers);
  return {
    ...snapshot,
    resources: snapshot.resources - towerDef.cost,
    towers: [
      ...snapshot.towers,
      {
        id: `${type}-${lane}-${snapshot.towers.length}`,
        type,
        lane,
        level: 1,
        cooldownUntil: 0,
      },
    ],
    recentEvents: [`${towerDef.label} added to lane ${lane + 1}.`, ...snapshot.recentEvents].slice(0, 6),
  };
}

export function upgradeTower(snapshot: MorseRunSnapshot, towerId: string): MorseRunSnapshot {
  const tower = snapshot.towers.find((entry) => entry.id === towerId);
  if (!tower) return snapshot;
  const cost = 4 + tower.level * 3;
  if (snapshot.resources < cost) return snapshot;
  return {
    ...snapshot,
    resources: snapshot.resources - cost,
    towers: snapshot.towers.map((entry) =>
      entry.id === towerId ? { ...entry, level: entry.level + 1 } : entry
    ),
    recentEvents: [`${tower.type} upgraded to tier ${tower.level + 1}.`, ...snapshot.recentEvents].slice(0, 6),
  };
}

export function buyPowerCharge(snapshot: MorseRunSnapshot, type: MorsePowerType, teamProgress: MorseTeamProgress): MorseRunSnapshot {
  const powerDef = MORSE_POWER_CATALOG.find((power) => power.type === type);
  if (!powerDef) return snapshot;
  if (snapshot.resources < powerDef.cost) return snapshot;
  return {
    ...snapshot,
    resources: snapshot.resources - powerDef.cost,
    powers: snapshot.powers.map((power) =>
      power.type === type
        ? { ...power, charges: Math.min(power.charges + 1, teamProgress.permanentUpgrades.powerCapacity + 2) }
        : power
    ),
    recentEvents: [`${powerDef.label} readied.`, ...snapshot.recentEvents].slice(0, 6),
  };
}

export function activatePower(snapshot: MorseRunSnapshot, type: MorsePowerType): MorseRunSnapshot {
  const power = snapshot.powers.find((entry) => entry.type === type);
  const now = Date.now();
  if (!power || power.charges <= 0 || power.cooldownUntil > now) return snapshot;

  const nextPowers: MorsePower[] = snapshot.powers.map((entry) =>
    entry.type === type
      ? { ...entry, charges: entry.charges - 1, cooldownUntil: now + 8000 }
      : entry
  );

  switch (type) {
    case 'volley':
      return {
        ...snapshot,
        powers: nextPowers,
        enemies: snapshot.enemies
          .map((enemy) => ({ ...enemy, health: enemy.health - 1, revealed: true }))
          .filter((enemy) => enemy.health > 0),
        score: snapshot.score + snapshot.enemies.length * 2,
        recentEvents: ['Arrow volley unleashed.', ...snapshot.recentEvents].slice(0, 6),
      };
    case 'freeze':
      return {
        ...snapshot,
        powers: nextPowers,
        activeEffects: {
          ...snapshot.activeEffects,
          freezeUntil: now + 4000,
        },
        recentEvents: ['A frost bell freezes the lanes.', ...snapshot.recentEvents].slice(0, 6),
      };
    case 'reveal':
      return {
        ...snapshot,
        powers: nextPowers,
        activeEffects: {
          ...snapshot.activeEffects,
          revealUntil: now + 9000,
        },
        enemies: snapshot.enemies.map((enemy) => ({ ...enemy, revealed: true })),
        recentEvents: ['Reveal runes expose every signal.', ...snapshot.recentEvents].slice(0, 6),
      };
  }
}

export function unlockArmoryUpgrade(teamProgress: MorseTeamProgress, category: 'tower' | 'power' | 'upgrade', id: string, cost: number): MorseTeamProgress {
  if (teamProgress.metaCurrency < cost) return teamProgress;

  if (category === 'tower') {
    if (teamProgress.unlockedTowers.includes(id)) return teamProgress;
    return {
      ...teamProgress,
      metaCurrency: teamProgress.metaCurrency - cost,
      unlockedTowers: [...teamProgress.unlockedTowers, id],
      updated_at: new Date().toISOString(),
    };
  }

  if (category === 'power') {
    if (teamProgress.unlockedPowers.includes(id)) return teamProgress;
    return {
      ...teamProgress,
      metaCurrency: teamProgress.metaCurrency - cost,
      unlockedPowers: [...teamProgress.unlockedPowers, id],
      updated_at: new Date().toISOString(),
    };
  }

  switch (id) {
    case 'towerSlots':
      return {
        ...teamProgress,
        metaCurrency: teamProgress.metaCurrency - cost,
        permanentUpgrades: {
          ...teamProgress.permanentUpgrades,
          towerSlots: teamProgress.permanentUpgrades.towerSlots + 1,
        },
        updated_at: new Date().toISOString(),
      };
    case 'startingHealth':
      return {
        ...teamProgress,
        metaCurrency: teamProgress.metaCurrency - cost,
        permanentUpgrades: {
          ...teamProgress.permanentUpgrades,
          startingHealth: teamProgress.permanentUpgrades.startingHealth + 1,
        },
        updated_at: new Date().toISOString(),
      };
    case 'revealAssistLevel':
      return {
        ...teamProgress,
        metaCurrency: teamProgress.metaCurrency - cost,
        permanentUpgrades: {
          ...teamProgress.permanentUpgrades,
          revealAssistLevel: teamProgress.permanentUpgrades.revealAssistLevel + 1,
        },
        updated_at: new Date().toISOString(),
      };
    case 'powerCapacity':
      return {
        ...teamProgress,
        metaCurrency: teamProgress.metaCurrency - cost,
        permanentUpgrades: {
          ...teamProgress.permanentUpgrades,
          powerCapacity: teamProgress.permanentUpgrades.powerCapacity + 1,
        },
        updated_at: new Date().toISOString(),
      };
    default:
      return teamProgress;
  }
}

export function buildRunSummary(snapshot: MorseRunSnapshot): Record<string, unknown> {
  return {
    mode: snapshot.mode,
    levelNumber: snapshot.levelNumber,
    waveNumber: snapshot.waveNumber,
    castleHealth: snapshot.castleHealth,
    maxCastleHealth: snapshot.maxCastleHealth,
    score: snapshot.score,
    metaReward: snapshot.metaReward,
    signalsUsed: snapshot.signalsUsed,
    outcome: snapshot.phase === 'victory' ? 'victory' : 'defeat',
  };
}
