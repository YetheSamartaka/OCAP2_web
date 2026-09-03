import type { EntityManager } from "./entityManager";
import { Unit } from "./entities/unit";
import { Vehicle } from "./entities/vehicle";
import { GameEvent } from "./events/gameEvent";
import { HitKilledEvent } from "./events/hitKilledEvent";
import { PlayerSnapshotEvent } from "./events/playerSnapshotEvent";
import { ServerFpsEvent } from "./events/serverFpsEvent";
import {
  ZeusCameraEvent,
  ZeusEntityEvent,
  ZeusRemoteControlEvent,
} from "./events/zeusEvents";
import { applySnapshotDiff, isSnapshotDiff } from "../data/snapshotDiff";
import type { PlayerSnapshotPayload, PlayerSnapshotType } from "../data/types";
import type { ZeusCameraSample, ZeusEntityInfo, ZeusFrameState } from "./zeus";

/**
 * Manages all mission events for a playback session.
 * Indexes events by frame number for O(1) lookup.
 * Pure data -- NO DOM, NO Leaflet, NO map dependencies.
 */
export class EventManager {
  private events: GameEvent[] = [];
  private frameIndex: Map<number, GameEvent[]> = new Map();
  private playerSnapshots = new Map<number, Map<PlayerSnapshotType, PlayerSnapshotEvent[]>>();
  private serverFpsEvents: ServerFpsEvent[] = [];
  private zeusEntities = new Map<number, ZeusEntityInfo>();
  private zeusRemoteControl: ZeusRemoteControlEvent[] = [];
  private zeusCameras = new Map<number, ZeusCameraEvent[]>();

  /** Add an event and index it by frame number. */
  addEvent(event: GameEvent): void {
    if (event instanceof PlayerSnapshotEvent) {
      let unitSnapshots = this.playerSnapshots.get(event.unitId);
      if (!unitSnapshots) {
        unitSnapshots = new Map();
        this.playerSnapshots.set(event.unitId, unitSnapshots);
      }
      const type = event.type as PlayerSnapshotType;
      const series = unitSnapshots.get(type);
      if (series) series.push(event);
      else unitSnapshots.set(type, [event]);
      return;
    }
    if (event instanceof ServerFpsEvent) {
      this.serverFpsEvents.push(event);
      this.serverFpsEvents.sort((a, b) => a.frameNum - b.frameNum);
      return;
    }
    if (event instanceof ZeusEntityEvent) {
      this.zeusEntities.set(event.payload.curatorId, {
        curatorId: event.payload.curatorId,
        name: event.payload.name,
        playerUid: event.payload.playerUid,
        bodyUnitId: event.payload.bodyUnitId,
        startFrame: event.frameNum,
      });
      return;
    }
    if (event instanceof ZeusRemoteControlEvent) {
      this.zeusRemoteControl.push(event);
      this.zeusRemoteControl.sort((a, b) => a.frameNum - b.frameNum);
      return;
    }
    if (event instanceof ZeusCameraEvent) {
      const series = this.zeusCameras.get(event.payload.curatorId) ?? [];
      series.push(event);
      series.sort((a, b) => a.frameNum - b.frameNum);
      this.zeusCameras.set(event.payload.curatorId, series);
      return;
    }
    this.events.push(event);

    const existing = this.frameIndex.get(event.frameNum);
    if (existing) {
      existing.push(event);
    } else {
      this.frameIndex.set(event.frameNum, [event]);
    }
  }

  /** Return events that occur exactly at the given frame. O(1) lookup. */
  getEventsAtFrame(frame: number): GameEvent[] {
    return this.frameIndex.get(frame) ?? [];
  }

  /** Return all events where frameNum <= frame (for the event log), sorted ascending by frame. */
  getActiveEvents(frame: number): GameEvent[] {
    return this.events
      .filter((event) => event.frameNum <= frame)
      .sort((a, b) => a.frameNum - b.frameNum);
  }

  /** Return all registered events. */
  getAll(): GameEvent[] {
    return this.events;
  }

  /**
   * Rebuild every player snapshot that was recorded as a diff into a full snapshot.
   * Must run once after all events are added and before the card reads them.
   */
  reconstructPlayerSnapshots(): void {
    for (const unitId of this.playerSnapshots.keys()) {
      this.reconstructPlayerSnapshotsFor(unitId);
    }
  }

  /**
   * Rebuild one player's diff-encoded snapshots. Snapshots that arrive from a
   * sidecar land after load, so the fold has to be runnable per unit; a series
   * is self-contained, which is why sharding by unit keeps the chain intact.
   */
  reconstructPlayerSnapshotsFor(unitId: number): void {
    const byType = this.playerSnapshots.get(unitId);
    if (!byType) return;
    for (const series of byType.values()) {
      series.sort((a, b) => a.frameNum - b.frameNum);
      let previous: PlayerSnapshotPayload | undefined;
      for (const event of series) {
        if (isSnapshotDiff(event.raw)) {
          // Without a base the keyframe was lost, so the diff is all we know.
          event.payload = previous
            ? applySnapshotDiff(previous, event.raw)
            : ({ unitId: event.raw.unitId, ...event.raw.set } as PlayerSnapshotPayload);
        } else {
          event.payload = event.raw;
        }
        previous = event.payload;
      }
    }
  }

  /** Whether any snapshot has been indexed for a player. */
  hasPlayerSnapshots(unitId: number): boolean {
    return (this.playerSnapshots.get(unitId)?.size ?? 0) > 0;
  }

  /** Frame of a player's first snapshot of a type, so the UI can explain an empty card. */
  getFirstPlayerSnapshotFrame(unitId: number, type: PlayerSnapshotType): number | undefined {
    return this.playerSnapshots.get(unitId)?.get(type)?.[0]?.frameNum;
  }

  /** Latest snapshot of each requested type for a player at the given frame. */
  getPlayerSnapshots(unitId: number, frame: number): Map<PlayerSnapshotType, PlayerSnapshotEvent> {
    const result = new Map<PlayerSnapshotType, PlayerSnapshotEvent>();
    const unitSnapshots = this.playerSnapshots.get(unitId);
    if (!unitSnapshots) return result;
    for (const [type, series] of unitSnapshots) {
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].frameNum <= frame) {
          result.set(type, series[i]);
          break;
        }
      }
    }
    return result;
  }

  /** Current and aggregate server FPS through the requested playback frame. */
  getServerFpsStats(frame: number): { current: number; average: number; median: number } | undefined {
    const samples = this.serverFpsEvents.filter((event) => event.frameNum <= frame);
    if (samples.length === 0) return undefined;

    const values = samples.map((event) => event.fps);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;

    return { current: samples[samples.length - 1].fps, average, median };
  }

  /** Zeus identities discovered in this recording, in curatorId order. */
  getZeusEntities(): ZeusEntityInfo[] {
    return [...this.zeusEntities.values()].sort((a, b) => a.curatorId - b.curatorId);
  }

  /** Occupancy + last camera for one Zeus at or before `frame`. */
  getZeusState(curatorId: number, frame: number): ZeusFrameState | null {
    const info = this.zeusEntities.get(curatorId);
    if (!info || frame < info.startFrame) return null;

    let controllingUnitId: number | null = null;
    let controllingName: string | null = null;
    for (const event of this.zeusRemoteControl) {
      if (event.frameNum > frame) break;
      if (event.payload.curatorId !== curatorId) continue;
      if (event.payload.active) {
        controllingUnitId = event.payload.unitId;
        controllingName = event.payload.playerName ?? info.name;
      } else if (event.payload.unitId === controllingUnitId) {
        controllingUnitId = null;
        controllingName = null;
      }
    }

    let camera: ZeusCameraSample | null = null;
    const series = this.zeusCameras.get(curatorId);
    if (series) {
      for (let i = series.length - 1; i >= 0; i--) {
        const sample = series[i];
        if (sample.frameNum <= frame) {
          camera = {
            x: sample.payload.x,
            y: sample.payload.y,
            dir: sample.payload.dir,
            fov: sample.payload.fov,
            pitch: sample.payload.pitch ?? 0,
          };
          break;
        }
      }
    }

    if (controllingUnitId === null && camera === null) return null;

    return {
      curatorId,
      name: info.name,
      controllingUnitId,
      controllingName,
      camera,
      side: "VIRTUAL",
    };
  }

  /** Curator who was remote-controlling `unitId` at `frame`, if any. */
  getZeusControllingUnit(unitId: number, frame: number): number | null {
    let curatorId: number | null = null;
    for (const event of this.zeusRemoteControl) {
      if (event.frameNum > frame) break;
      if (event.payload.unitId !== unitId) continue;
      curatorId = event.payload.active ? event.payload.curatorId : null;
    }
    return curatorId;
  }

  /**
   * Resolve entity references on HitKilledEvent instances.
   * Populates names, sides at the event frame, and computes kill counts.
   *
   * Kill score formula (matching old frontend):
   *   killCount - (teamKillCount * 2)
   * Only "killed" events with a Unit victim (not Vehicle) increment counts.
   */
  resolveReferences(entityManager: EntityManager): void {
    // First pass: resolve names/sides
    for (const event of this.events) {
      if (event instanceof HitKilledEvent) {
        const victim = entityManager.getEntity(event.victimId);
        if (victim) {
          event.victimName = victim.name;
          event.victimIsVehicle = victim instanceof Vehicle;
          if (victim instanceof Unit) {
            event.victimSide = victim.sideAtFrame(event.frameNum);
          }
        }

        const causer = entityManager.getEntity(event.causedById);
        if (causer) {
          event.causerName = causer.name;
          if (causer instanceof Unit) {
            event.causerSide = causer.sideAtFrame(event.frameNum);
          }
        }
      }
    }

    // Second pass: compute kill counts (events are already sorted by frame)
    for (const event of this.events) {
      if (!(event instanceof HitKilledEvent)) continue;
      if (event.type !== "killed") continue;

      const victim = entityManager.getEntity(event.victimId);
      const causer = entityManager.getEntity(event.causedById);

      // Only count kills on Unit victims (not vehicles), skip self-kills.
      // killCount tracks ALL non-self kills (including team kills).
      // teamKillCount additionally tracks same-side kills.
      // Score = killCount - teamKillCount * 2 (matching old frontend).
      if (victim instanceof Unit && causer instanceof Unit) {
        if (event.victimId !== event.causedById) {
          causer.killCount++;
          if (event.isFriendlyFire()) {
            causer.teamKillCount++;
          }
          const curatorId = this.getZeusControllingUnit(event.causedById, event.frameNum);
          if (curatorId !== null) {
            const zeus = entityManager.getEntity(curatorId);
            if (zeus instanceof Unit) {
              zeus.killCount++;
              if (event.isFriendlyFire()) zeus.teamKillCount++;
            }
          }
        }
        // Attach current score to the event (even for self-kills)
        event.causerKillScore = causer.killCount - causer.teamKillCount * 2;
      }

      // Increment death count for the victim
      if (victim instanceof Unit) {
        victim.deathCount++;
      }
    }
  }

  /**
   * Compute per-unit kill and death counts up to (and including) the given frame.
   * Only counts "killed" events on Unit victims (not vehicles), matching resolveReferences logic.
   */
  getKillDeathCounts(frame: number): {
    kills: Map<number, number>;
    deaths: Map<number, number>;
    vehicleKills: Map<number, number>;
    teamKills: Map<number, number>;
  } {
    const kills = new Map<number, number>();
    const deaths = new Map<number, number>();
    const vehicleKills = new Map<number, number>();
    const teamKills = new Map<number, number>();

    for (const event of this.events) {
      if (event.frameNum > frame) continue;
      if (!(event instanceof HitKilledEvent)) continue;
      if (event.type !== "killed") continue;

      if (event.victimIsVehicle) {
        // Vehicle kill for causer (non-self kills only)
        if (event.causedById !== event.victimId) {
          vehicleKills.set(event.causedById, (vehicleKills.get(event.causedById) ?? 0) + 1);
        }
        continue;
      }

      // Death for victim
      deaths.set(event.victimId, (deaths.get(event.victimId) ?? 0) + 1);

      // Kill for causer (non-self kills only)
      if (event.causedById !== event.victimId) {
        kills.set(event.causedById, (kills.get(event.causedById) ?? 0) + 1);
        if (event.isFriendlyFire()) {
          teamKills.set(event.causedById, (teamKills.get(event.causedById) ?? 0) + 1);
        }
        const curatorId = this.getZeusControllingUnit(event.causedById, event.frameNum);
        if (curatorId !== null) {
          kills.set(curatorId, (kills.get(curatorId) ?? 0) + 1);
          if (event.isFriendlyFire()) {
            teamKills.set(curatorId, (teamKills.get(curatorId) ?? 0) + 1);
          }
        }
      }
    }

    return { kills, deaths, vehicleKills, teamKills };
  }

  /** Remove all events and clear the frame index. */
  clear(): void {
    this.events = [];
    this.frameIndex = new Map();
    this.playerSnapshots = new Map();
    this.serverFpsEvents = [];
    this.zeusEntities = new Map();
    this.zeusRemoteControl = [];
    this.zeusCameras = new Map();
  }
}
