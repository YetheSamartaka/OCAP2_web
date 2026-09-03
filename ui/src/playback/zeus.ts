import type { Side } from "../data/types";

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
