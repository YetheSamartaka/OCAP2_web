import type { PlaybackEngine } from "../../playback/engine";
import { Unit } from "../../playback/entities/unit";
import type { Side } from "../../data/types";

/**
 * Distance and pace, summed from the recorded positions.
 *
 * Sampled every `step` frames rather than every frame, for two reasons: the cost
 * is linear in samples and a mission is thousands of frames, and summing every
 * frame accumulates the position jitter of a standing man into hundreds of
 * phantom metres. A few seconds between samples measures travel, not noise.
 */

export interface MovementStats {
  unitId: number;
  name: string;
  side: Side | null;
  /** Metres covered on foot. */
  onFoot: number;
  /** Metres covered as a vehicle occupant. */
  mounted: number;
  total: number;
  /** Frames spent riding, for the mounted share of their time. */
  mountedFrames: number;
  trackedFrames: number;
  /** Fastest sustained speed between two samples, m/s. */
  topSpeed: number;
}

/**
 * A jump further than this between samples is a teleport, not movement: Zeus
 * placement, a respawn, or a unit re-entering after being out of the loaded
 * range. Counting it would put a rifleman ahead of a helicopter.
 */
const MAX_STEP_METRES = 400;

export function buildMovementStats(
  engine: PlaybackEngine,
  options: { step?: number; playersOnly?: boolean } = {},
): MovementStats[] {
  const endFrame = engine.endFrame();
  if (endFrame <= 0) return [];

  const captureDelayMs = engine.captureDelayMs() || 1000;
  // Roughly five seconds between samples, at any capture delay.
  const step = options.step ?? Math.max(1, Math.round(5000 / captureDelayMs));
  const secondsPerStep = (step * captureDelayMs) / 1000;
  const playersOnly = options.playersOnly ?? true;

  const result: MovementStats[] = [];

  for (const entity of engine.entityManager.getAll()) {
    if (!(entity instanceof Unit)) continue;
    if (playersOnly && !entity.isPlayer) continue;

    let onFoot = 0;
    let mounted = 0;
    let mountedFrames = 0;
    let trackedFrames = 0;
    let topSpeed = 0;

    let previous: { x: number; y: number } | null = null;
    const last = Math.min(entity.endFrame, endFrame);

    for (let frame = entity.startFrame; frame <= last; frame += step) {
      const state = engine.getStateAt(entity.id, frame);
      if (!state) {
        // A gap in loaded data breaks the chain rather than bridging it, so an
        // unloaded stretch cannot masquerade as a long march.
        previous = null;
        continue;
      }

      trackedFrames += 1;
      if (state.isInVehicle) mountedFrames += 1;

      const position = { x: state.position[0], y: state.position[1] };
      if (previous) {
        const distance = Math.hypot(position.x - previous.x, position.y - previous.y);
        if (distance <= MAX_STEP_METRES) {
          if (state.isInVehicle) mounted += distance;
          else onFoot += distance;
          topSpeed = Math.max(topSpeed, distance / secondsPerStep);
        }
      }
      previous = position;
    }

    if (onFoot + mounted < 1) continue;

    result.push({
      unitId: entity.id,
      name: entity.name,
      side: entity.side,
      onFoot,
      mounted,
      total: onFoot + mounted,
      mountedFrames,
      trackedFrames,
      topSpeed,
    });
  }

  return result.sort((a, b) => b.total - a.total);
}

/** Metres as a compact "1.2 km" / "840 m". */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "-";
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}
