'use client';

import {
  angleBetween,
  CASTLE_MOUNTS,
  getCastleArrowAnchor,
  getMountDefinition,
  getPathPoint,
  getPathSlowMultiplier,
  getTowerAnchor,
  interpolatePoint,
  SCENE_GROUND_Y,
  SCENE_HEIGHT,
  SCENE_PATH_END_X,
  SCENE_PATH_START_X,
  SCENE_WIDTH,
} from '@/lib/morse/scene';
import type {
  MorseEnemy,
  MorsePoint,
  MorseRunSnapshot,
  MorseShotAnimation,
  MorseTeamProgress,
  MorseTower,
  MorseTowerMountId,
} from '@/lib/morse/types';

function getEnemyScale(enemy: MorseEnemy): number {
  switch (enemy.kind) {
    case 'runner':
      return 0.96;
    case 'armored':
      return 1.08;
    case 'elite':
      return 1.18;
    case 'boss':
      return 1.42;
  }
}

function predictedEnemyProgress(enemy: MorseEnemy, snapshot: MorseRunSnapshot, clock: number) {
  if (snapshot.phase !== 'playing') return enemy.pathProgress;
  const elapsed = Math.max(0, Math.min(140, clock - snapshot.simulatedAt));
  const multiplier = getPathSlowMultiplier(snapshot, clock);
  return enemy.pathProgress + (enemy.speed * multiplier * elapsed) / 1000;
}

function projectilePoint(shot: MorseShotAnimation, clock: number): MorsePoint {
  const age = clock - shot.createdAt;
  const progress = Math.max(0, Math.min(1, age / shot.durationMs));
  return interpolatePoint(shot.origin, shot.target, progress);
}

function towerColor(tower: MorseTower) {
  switch (tower.type) {
    case 'catapult':
      return { fill: '#8b4518', glow: '#fdba74' };
    case 'mint':
      return { fill: '#166534', glow: '#6ee7b7' };
    case 'lantern':
      return { fill: '#7c4a19', glow: '#fbbf24' };
    case 'ballista':
      return { fill: '#1d4ed8', glow: '#bfdbfe' };
  }
}

function MountPadActor({
  mountId,
  tower,
  selected,
  buildMode,
  onSelect,
}: {
  mountId: MorseTowerMountId;
  tower: MorseTower | undefined;
  selected: boolean;
  buildMode: boolean;
  onSelect?: (mountId: MorseTowerMountId) => void;
}) {
  const mount = getMountDefinition(mountId);
  const showPad = buildMode || selected || tower;
  if (!showPad) return null;

  return (
    <g
      onClick={() => onSelect?.(mountId)}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      <circle
        cx={mount.x}
        cy={mount.y}
        r={mount.padRadius + (selected ? 10 : 4)}
        fill={selected ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.06)'}
        stroke={selected ? 'rgba(251,191,36,0.92)' : 'rgba(255,255,255,0.18)'}
        strokeWidth={selected ? 4 : 2}
      />
      {buildMode && !tower && (
        <>
          <circle cx={mount.x} cy={mount.y} r={mount.padRadius + 18} fill="none" stroke="rgba(251,191,36,0.28)" strokeWidth="2" strokeDasharray="8 8" />
          <path d={`M ${mount.x - 8} ${mount.y} L ${mount.x + 8} ${mount.y} M ${mount.x} ${mount.y - 8} L ${mount.x} ${mount.y + 8}`} stroke="#fef3c7" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
    </g>
  );
}

function TowerActor({ tower, selected }: { tower: MorseTower; selected: boolean }) {
  const point = getTowerAnchor(tower);
  const mount = getMountDefinition(tower.mountId);
  const colors = towerColor(tower);

  return (
    <g>
      {selected && <circle cx={mount.x} cy={mount.y} r="38" fill="rgba(251,191,36,0.12)" stroke="rgba(251,191,36,0.45)" strokeWidth="3" />}
      <g transform={`translate(${point.x}, ${point.y})`}>
        <circle r="20" fill="rgba(15,23,42,0.24)" />
        <circle r="18" fill={colors.fill} stroke="#fff7ed" strokeWidth="2.4" />
        {tower.type === 'ballista' && (
          <>
            <path d="M -20 -7 L 18 -7" fill="none" stroke="#dbeafe" strokeWidth="4" strokeLinecap="round" />
            <path d="M -12 -16 L 10 6" fill="none" stroke="#dbeafe" strokeWidth="3.4" strokeLinecap="round" />
          </>
        )}
        {tower.type === 'lantern' && (
          <>
            <circle cy="-22" r="9" fill={colors.glow} />
            <circle cy="-22" r="22" fill={colors.glow} opacity="0.18" />
          </>
        )}
        {tower.type === 'mint' && (
          <>
            <path d="M -10 -8 L 10 -8 L 14 10 L -14 10 Z" fill="#bbf7d0" opacity="0.92" />
            <circle cx="0" cy="0" r="7" fill="#166534" opacity="0.9" />
          </>
        )}
        {tower.type === 'catapult' && (
          <>
            <path d="M -18 7 L 18 -14 L 12 13" fill="none" stroke="#fed7aa" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="10" cy="-12" r="4" fill="#fff7ed" />
          </>
        )}
      </g>
    </g>
  );
}

function EnemyActor({
  enemy,
  point,
  showCode,
  selected,
  clock,
  onSelect,
}: {
  enemy: MorseEnemy;
  point: MorsePoint;
  showCode: boolean;
  selected: boolean;
  clock: number;
  onSelect?: (enemyId: string) => void;
}) {
  const scale = getEnemyScale(enemy);
  const bob = Math.sin((clock / 150) + enemy.id.length) * 3;
  const recentlyHit = enemy.lastHitAt !== null && clock - enemy.lastHitAt < 220;
  const comboActive = enemy.comboWindowUntil !== null && enemy.comboWindowUntil > clock;
  const fill =
    enemy.kind === 'boss'
      ? '#7c2d12'
      : enemy.kind === 'elite'
        ? '#6d28d9'
        : enemy.kind === 'armored'
          ? '#475569'
          : '#1f2937';
  const stroke =
    enemy.kind === 'boss'
      ? '#fecaca'
      : enemy.kind === 'elite'
        ? '#ddd6fe'
        : enemy.kind === 'armored'
          ? '#e2e8f0'
          : '#fff7ed';

  return (
    <g
      transform={`translate(${point.x}, ${point.y + bob}) scale(${scale})`}
      onClick={() => onSelect?.(enemy.id)}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      {selected && <ellipse cx="0" cy="18" rx="38" ry="18" fill="rgba(251,191,36,0.18)" stroke="rgba(251,191,36,0.42)" strokeWidth="3" />}
      {comboActive && (
        <ellipse
          cx="0"
          cy="4"
          rx="42"
          ry="24"
          fill="none"
          stroke={enemy.comboPrimedBy === 'daniel' ? '#7dd3fc' : '#fda4af'}
          strokeWidth="3"
          strokeDasharray="7 7"
          opacity="0.9"
        />
      )}

      <ellipse cx="0" cy="24" rx="26" ry="10" fill="rgba(15,23,42,0.35)" />
      {enemy.kind === 'boss' ? (
        <>
          <path d="M 32 18 L 14 -32 L -16 -38 L -38 12 L -24 36 L 18 34 Z" fill={fill} stroke={stroke} strokeWidth="3.2" />
          <path d="M 8 -18 L 24 -34 L 28 -10 Z M -8 -16 L -28 -28 L -18 -6 Z" fill="#f59e0b" />
        </>
      ) : enemy.kind === 'elite' ? (
        <>
          <path d="M 28 18 L 10 -26 L -12 -30 L -30 10 L -18 30 L 16 28 Z" fill={fill} stroke={stroke} strokeWidth="2.8" />
          <path d="M 0 -34 L 10 -18 L -10 -18 Z" fill="#fbbf24" />
        </>
      ) : enemy.kind === 'armored' ? (
        <>
          <path d="M 26 14 L 12 -20 L -10 -24 L -28 8 L -16 26 L 14 24 Z" fill={fill} stroke={stroke} strokeWidth="2.8" />
          <path d="M -8 -12 L -28 -22 L -32 10 L -10 16 Z" fill="#94a3b8" stroke="#e2e8f0" strokeWidth="2" />
        </>
      ) : (
        <>
          <path d="M 22 10 L 8 -14 L -6 -18 L -20 6 L -10 20 L 12 18 Z" fill={fill} stroke={stroke} strokeWidth="2.4" />
          <path d="M -4 -12 L -20 -24 L -8 4" fill="none" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" />
        </>
      )}

      <rect x="-28" y="-56" width="56" height="8" rx="4" fill="rgba(15,23,42,0.6)" />
      <rect x="-28" y="-56" width={(56 * enemy.health) / enemy.maxHealth} height="8" rx="4" fill={enemy.kind === 'boss' ? '#fb923c' : '#f59e0b'} />
      <text x="0" y="-68" textAnchor="middle" fontSize="25" fontWeight="800" fill="#fff7ed">{enemy.targetChar}</text>
      {showCode && (
        <g transform="translate(0,-92)">
          <rect x="-42" y="-15" width="84" height="28" rx="14" fill="rgba(15,23,42,0.76)" stroke="rgba(251,191,36,0.35)" />
          <text x="0" y="4" textAnchor="middle" fontSize="15" fontFamily="monospace" fill="#fde68a">{enemy.code}</text>
        </g>
      )}
      {recentlyHit && <circle r="28" fill="#ffffff" opacity="0.28" />}
    </g>
  );
}

function ShotActor({ shot, clock }: { shot: MorseShotAnimation; clock: number }) {
  const age = clock - shot.createdAt;
  const progress = Math.max(0, Math.min(1, age / shot.durationMs));
  const point = projectilePoint(shot, clock);
  const angle = angleBetween(shot.origin, shot.target);
  const impact = progress > 0.9;
  const color = shot.kind === 'catapult' ? '#fb923c' : '#fde68a';

  return (
    <g>
      <line
        x1={shot.origin.x}
        y1={shot.origin.y}
        x2={point.x}
        y2={point.y}
        stroke={color}
        strokeWidth={shot.kind === 'catapult' ? 4.4 : 3}
        strokeOpacity="0.45"
        strokeLinecap="round"
      />
      <g transform={`translate(${point.x}, ${point.y}) rotate(${angle})`}>
        {shot.kind === 'catapult' ? (
          <circle r="9" fill="#ea580c" stroke="#ffedd5" strokeWidth="2.2" />
        ) : (
          <>
            <path d="M -16 0 L 8 0" stroke={color} strokeWidth="3" strokeLinecap="round" />
            <path d="M 8 0 L -1 -6 L -1 6 Z" fill={color} />
          </>
        )}
      </g>
      {impact && (
        <g transform={`translate(${shot.target.x}, ${shot.target.y})`}>
          <circle r="16" fill={shot.kind === 'catapult' ? '#fdba74' : '#fef08a'} opacity="0.26" />
          <circle r="8" fill="#fff7ed" opacity="0.52" />
        </g>
      )}
    </g>
  );
}

export function MorseBattlefieldScene({
  snapshot,
  teamProgress,
  clock,
  shakeAt,
  selectedMountId,
  hintedEnemyIds,
  buildMode,
  onMountSelect,
  onEnemySelect,
}: {
  snapshot: MorseRunSnapshot;
  teamProgress: MorseTeamProgress;
  clock: number;
  shakeAt: number | null;
  selectedMountId: MorseTowerMountId | null;
  hintedEnemyIds: string[];
  buildMode: boolean;
  onMountSelect?: (mountId: MorseTowerMountId) => void;
  onEnemySelect?: (enemyId: string) => void;
}) {
  const shakeAge = shakeAt === null ? Number.POSITIVE_INFINITY : clock - shakeAt;
  const shakeStrength = shakeAge < 360 ? Math.sin(shakeAge / 18) * 8 * (1 - shakeAge / 360) : 0;
  const showGlobalReveal = snapshot.activeEffects.revealUntil > clock;
  const freezeActive = snapshot.activeEffects.freezeUntil > clock;
  const hintSet = new Set(hintedEnemyIds);
  const enemies = snapshot.enemies
    .map((enemy) => ({
      enemy,
      point: getPathPoint(predictedEnemyProgress(enemy, snapshot, clock), enemy.groundOffsetY),
    }))
    .filter(({ point }) => point.x > -120)
    .sort((left, right) => left.point.y - right.point.y);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(180deg,#2a140d,#0f0b09_62%,#060505)]">
      <svg
        viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        style={{ transform: `translate(${shakeStrength}px, ${shakeStrength * 0.24}px)` }}
      >
        <defs>
          <linearGradient id="side-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9a5e25" />
            <stop offset="38%" stopColor="#4b2413" />
            <stop offset="100%" stopColor="#120c0a" />
          </linearGradient>
          <linearGradient id="road-band" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8b5e34" />
            <stop offset="60%" stopColor="#5b3218" />
            <stop offset="100%" stopColor="#41210f" />
          </linearGradient>
          <linearGradient id="wall-stone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b38555" />
            <stop offset="100%" stopColor="#5f3a22" />
          </linearGradient>
          <radialGradient id="forge-glow">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
          <filter id="castle-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#000000" floodOpacity="0.4" />
          </filter>
        </defs>

        <rect width={SCENE_WIDTH} height={SCENE_HEIGHT} fill="url(#side-sky)" />
        <circle cx="1240" cy="136" r="230" fill="rgba(251,191,36,0.06)" />
        <circle cx="836" cy="120" r="190" fill="rgba(251,191,36,0.04)" />
        <path d="M 0 450 C 220 360 420 360 640 430 C 880 500 1140 420 1600 330 L 1600 900 L 0 900 Z" fill="rgba(46,30,21,0.72)" />
        <path d="M 0 520 C 260 430 520 450 760 530 C 1010 620 1260 560 1600 470 L 1600 900 L 0 900 Z" fill="rgba(31,20,14,0.82)" />

        <rect x="0" y={SCENE_GROUND_Y - 64} width={SCENE_WIDTH} height="146" fill="url(#road-band)" />
        <rect x="0" y={SCENE_GROUND_Y + 56} width={SCENE_WIDTH} height="200" fill="#1d2918" />
        <path d={`M ${SCENE_PATH_END_X} ${SCENE_GROUND_Y - 8} L ${SCENE_PATH_START_X} ${SCENE_GROUND_Y - 8}`} stroke="rgba(255,241,214,0.18)" strokeWidth="4" strokeDasharray="18 16" />
        {freezeActive && <rect x={SCENE_PATH_END_X} y={SCENE_GROUND_Y - 72} width={SCENE_PATH_START_X - SCENE_PATH_END_X + 80} height="146" fill="rgba(147,197,253,0.12)" />}

        <g filter="url(#castle-shadow)">
          <rect x="18" y="278" width="300" height="392" rx="28" fill="#4d2d1b" />
          <rect x="46" y="332" width="240" height="338" rx="18" fill="url(#wall-stone)" stroke="#fde68a" strokeWidth="4" />
          <rect x="90" y="228" width="84" height="132" rx="20" fill="#8b5e34" stroke="#fde68a" strokeWidth="4" />
          <rect x="220" y="190" width="108" height="170" rx="22" fill="#8b5e34" stroke="#fde68a" strokeWidth="4" />
          <path d="M 78 332 L 112 280 L 148 332 Z M 206 332 L 254 258 L 304 332 Z" fill="#8a1c1c" />
          <rect x="152" y="508" width="88" height="162" rx="26" fill="#22130d" stroke="#fed7aa" strokeWidth="4" />
          <circle cx="222" cy="508" r="42" fill="url(#forge-glow)" />
          <circle cx="118" cy="454" r="26" fill="url(#forge-glow)" />
          <circle cx="286" cy="434" r="26" fill="url(#forge-glow)" />
          <rect x="18" y="652" width="360" height="30" rx="10" fill="#2f1e14" />
        </g>

        {CASTLE_MOUNTS.map((mount) => {
          const tower = snapshot.towers.find((entry) => entry.mountId === mount.id);
          return (
            <MountPadActor
              key={mount.id}
              mountId={mount.id}
              tower={tower}
              selected={selectedMountId === mount.id}
              buildMode={buildMode}
              onSelect={onMountSelect}
            />
          );
        })}

        {snapshot.towers.map((tower) => (
          <TowerActor
            key={tower.id}
            tower={tower}
            selected={selectedMountId === tower.mountId}
          />
        ))}

        <g>
          <circle cx={getCastleArrowAnchor().x} cy={getCastleArrowAnchor().y} r="12" fill="rgba(255,255,255,0.06)" />
        </g>

        {snapshot.shots.map((shot) => (
          <ShotActor key={shot.id} shot={shot} clock={clock} />
        ))}

        {enemies.map(({ enemy, point }) => (
          <EnemyActor
            key={enemy.id}
            enemy={enemy}
            point={point}
            showCode={
              showGlobalReveal
              || enemy.revealed
              || teamProgress.permanentUpgrades.revealAssistLevel > 1
              || hintSet.has(enemy.id)
            }
            selected={hintSet.has(enemy.id)}
            clock={clock}
            onSelect={onEnemySelect}
          />
        ))}

        {showGlobalReveal && <rect width={SCENE_WIDTH} height={SCENE_HEIGHT} fill="rgba(250,204,21,0.04)" />}
        {buildMode && <rect width={SCENE_WIDTH} height={SCENE_HEIGHT} fill="rgba(12,10,9,0.08)" />}
      </svg>
    </div>
  );
}
