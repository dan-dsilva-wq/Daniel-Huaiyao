import type { MorsePoint, MorseRunSnapshot, MorseTower, MorseTowerMountId } from './types';

export const SCENE_WIDTH = 1600;
export const SCENE_HEIGHT = 900;
export const SCENE_PATH_START_X = 1505;
export const SCENE_PATH_END_X = 298;
export const SCENE_GROUND_Y = 668;
export const SCENE_MAX_PROGRESS = 100;

export interface CastleMountDefinition {
  id: MorseTowerMountId;
  label: string;
  x: number;
  y: number;
  padRadius: number;
}

export const CASTLE_MOUNTS: CastleMountDefinition[] = [
  { id: 'roof-north', label: 'North Roof', x: 174, y: 286, padRadius: 22 },
  { id: 'roof-center', label: 'High Keep', x: 254, y: 246, padRadius: 24 },
  { id: 'roof-south', label: 'South Roof', x: 334, y: 300, padRadius: 22 },
  { id: 'wall-north', label: 'North Wall', x: 204, y: 470, padRadius: 22 },
  { id: 'wall-center', label: 'Gate Wall', x: 282, y: 520, padRadius: 24 },
  { id: 'wall-south', label: 'South Wall', x: 214, y: 598, padRadius: 22 },
];

export const CASTLE_MOUNT_ORDER: MorseTowerMountId[] = [
  'wall-center',
  'roof-center',
  'wall-north',
  'wall-south',
  'roof-north',
  'roof-south',
];

export function getMountDefinition(mountId: MorseTowerMountId): CastleMountDefinition {
  return CASTLE_MOUNTS.find((mount) => mount.id === mountId) ?? CASTLE_MOUNTS[0];
}

export function clampPathProgress(progress: number): number {
  return Math.max(-35, Math.min(SCENE_MAX_PROGRESS + 10, progress));
}

export function getPathPoint(pathProgress: number, groundOffsetY = 0): MorsePoint {
  const progress = clampPathProgress(pathProgress);
  const t = progress / SCENE_MAX_PROGRESS;
  const x = SCENE_PATH_START_X + (SCENE_PATH_END_X - SCENE_PATH_START_X) * t;
  const visibleT = Math.max(0, Math.min(1, t));
  const terrainLift = Math.sin(visibleT * Math.PI) * -20;
  return {
    x,
    y: SCENE_GROUND_Y + groundOffsetY + terrainLift,
  };
}

export function getCastleArrowAnchor(): MorsePoint {
  return { x: 326, y: 446 };
}

export function getTowerAnchor(tower: MorseTower): MorsePoint {
  const mount = getMountDefinition(tower.mountId);
  if (tower.type === 'catapult') {
    return { x: mount.x + 10, y: mount.y - 14 };
  }
  if (tower.type === 'mint') {
    return { x: mount.x - 8, y: mount.y + 12 };
  }
  if (tower.type === 'lantern') {
    return { x: mount.x, y: mount.y - 20 };
  }
  return { x: mount.x + 4, y: mount.y - 6 };
}

export function getPathSlowMultiplier(snapshot: MorseRunSnapshot, now: number): number {
  const lanternCount = snapshot.towers.filter((tower) => tower.type === 'lantern').length;
  if (snapshot.activeEffects.freezeUntil > now) return 0;
  return lanternCount > 0 ? Math.max(0.45, 1 - lanternCount * 0.12) : 1;
}

export function interpolatePoint(origin: MorsePoint, target: MorsePoint, progress: number): MorsePoint {
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: origin.x + (target.x - origin.x) * t,
    y: origin.y + (target.y - origin.y) * t,
  };
}

export function angleBetween(origin: MorsePoint, target: MorsePoint): number {
  return (Math.atan2(target.y - origin.y, target.x - origin.x) * 180) / Math.PI;
}
