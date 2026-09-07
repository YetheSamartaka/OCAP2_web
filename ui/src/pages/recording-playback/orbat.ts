import type { PlaybackEngine } from "../../playback/engine";
import { Unit } from "../../playback/entities/unit";
import { Vehicle } from "../../playback/entities/vehicle";
import type { Side } from "../../data/types";

/**
 * Force structure read at a frame.
 *
 * Groups come from the *per-frame* group name, not the entity's starting group,
 * because units are reassigned mid-mission — a survivor folded into another
 * squad shows up where they actually ended up. `EntitySnapshot` drops that
 * field, which is why everything here goes through `engine.getStateAt`.
 */

export interface OrbatMember {
  unitId: number;
  name: string;
  role: string;
  isPlayer: boolean;
  alive: boolean;
  /** In a vehicle this frame, so the map icon is the vehicle, not them. */
  mounted: boolean;
  /** Current group differs from the one they started the mission in. */
  regrouped: boolean;
}

export interface OrbatGroup {
  name: string;
  members: OrbatMember[];
  alive: number;
}

/** Roles the recorder writes for a group leader, lowercased. */
const LEADER_ROLES = ["leader", "squadleader", "teamleader", "officer"];

function isLeader(role: string): boolean {
  const normalised = role.toLowerCase().replace(/[\s_-]/g, "");
  return LEADER_ROLES.some((candidate) => normalised.includes(candidate));
}

/**
 * Build the order of battle for one side at a frame.
 *
 * Leaders sort to the top of their group, then players, then the rest by name,
 * which is how a briefing would list them.
 *
 * Players only by default. An ORBAT is read to find out who was where and under
 * whom, and on a populated mission the AI outnumbers the players heavily enough
 * to bury exactly that: filler squads the players never interacted with become
 * most of the list. A group with no players in it drops out entirely rather than
 * appearing empty. Pass `playersOnly: false` for the full roster.
 */
export function buildOrbat(
  engine: PlaybackEngine,
  side: Side,
  frame: number,
  options: { playersOnly?: boolean } = {},
): OrbatGroup[] {
  const playersOnly = options.playersOnly ?? true;
  const groups = new Map<string, OrbatMember[]>();

  for (const entity of engine.entityManager.getAll()) {
    if (!(entity instanceof Unit)) continue;
    if (frame < entity.startFrame || frame > entity.endFrame) continue;

    const state = engine.getStateAt(entity.id, frame);
    if (!state) continue;
    if ((state.side ?? entity.side) !== side) continue;

    // Read from the frame rather than the entity: someone who took over an AI
    // slot mid-mission is a player from that point on.
    const isPlayer = state.isPlayer ?? entity.isPlayer;
    if (playersOnly && !isPlayer) continue;

    const groupName = state.groupName || entity.groupName || "";
    const member: OrbatMember = {
      unitId: entity.id,
      name: state.name || entity.name,
      role: state.role ?? "",
      isPlayer,
      alive: !!state.alive,
      mounted: state.isInVehicle === true,
      regrouped: !!entity.groupName && !!groupName && groupName !== entity.groupName,
    };

    const list = groups.get(groupName);
    if (list) list.push(member);
    else groups.set(groupName, [member]);
  }

  return [...groups.entries()]
    .map(([name, members]) => {
      members.sort((a, b) => {
        const leadDiff = Number(isLeader(b.role)) - Number(isLeader(a.role));
        if (leadDiff !== 0) return leadDiff;
        const playerDiff = Number(b.isPlayer) - Number(a.isPlayer);
        if (playerDiff !== 0) return playerDiff;
        return a.name.localeCompare(b.name);
      });
      return { name, members, alive: members.filter((m) => m.alive).length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { isLeader };

// ─── Vehicle occupancy ───

export interface CrewSample {
  frame: number;
  crewIds: number[];
}

export interface VehicleOccupancy {
  vehicleId: number;
  name: string;
  samples: CrewSample[];
  /** Highest crew count seen, which sizes the strip. */
  peak: number;
  /** True while anyone is aboard at the sampled frame nearest the playhead. */
  occupiedNow: boolean;
}

/**
 * Sample who was aboard each vehicle across the whole recording.
 *
 * Sampled rather than per-frame on purpose: a two-hour mission is thousands of
 * frames and the strip is a couple of hundred pixels wide, so reading every
 * frame would cost far more than it could ever show. A vehicle nobody ever
 * boarded is dropped — an empty strip says nothing.
 */
export function buildVehicleOccupancy(
  engine: PlaybackEngine,
  frame: number,
  sampleCount = 160,
): VehicleOccupancy[] {
  const endFrame = engine.endFrame();
  if (endFrame <= 0) return [];

  const step = Math.max(1, Math.floor(endFrame / sampleCount));
  const result: VehicleOccupancy[] = [];

  for (const entity of engine.entityManager.getAll()) {
    if (!(entity instanceof Vehicle)) continue;

    const samples: CrewSample[] = [];
    let peak = 0;
    let occupiedNow = false;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let f = entity.startFrame; f <= Math.min(entity.endFrame, endFrame); f += step) {
      const state = engine.getStateAt(entity.id, f);
      const crewIds = state?.crewIds ?? [];
      samples.push({ frame: f, crewIds });
      if (crewIds.length > peak) peak = crewIds.length;

      const distance = Math.abs(f - frame);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        occupiedNow = crewIds.length > 0;
      }
    }

    if (peak === 0) continue;
    result.push({ vehicleId: entity.id, name: entity.name, samples, peak, occupiedNow });
  }

  return result.sort((a, b) => b.peak - a.peak || a.name.localeCompare(b.name));
}
