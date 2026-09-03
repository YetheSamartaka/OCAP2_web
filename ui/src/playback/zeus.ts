import type { Side } from "../data/types";

/**
 * Frames after a remote-control stop during which that unit's kills still
 * count for Zeus. Capture is typically 1 s, and `eh_killed` may wait on ACE
 * `lastDamageSource` after occupancy has already cleared.
 */
export const ZEUS_RC_KILL_GRACE_FRAMES = 30;

/** Convert Arma getObjectFOV (tan of half-angle) to horizontal degrees. */
export function armaFovToDegrees(fov: number): number {
  if (!Number.isFinite(fov) || fov <= 0) return 75;
  return (2 * Math.atan(fov) * 180) / Math.PI;
}

export interface ZeusEntityInfo {
  curatorId: number;
  name: string;
  playerUid: string;
  bodyUnitId: number;
  startFrame: number;
}

export interface ZeusCameraSample {
  x: number;
  y: number;
  dir: number;
  fov: number;
  pitch: number;
}

export interface ZeusFrameState {
  curatorId: number;
  name: string;
  controllingUnitId: number | null;
  controllingName: string | null;
  camera: ZeusCameraSample | null;
  side: Side;
}

export function isZeusSide(side: Side | string | null | undefined): boolean {
  return side === "VIRTUAL";
}
