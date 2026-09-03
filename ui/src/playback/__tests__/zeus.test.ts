import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventManager } from "../eventManager";
import { EntityManager } from "../entityManager";
import { PlaybackEngine } from "../engine";
import { HitKilledEvent } from "../events/hitKilledEvent";
import {
  ZeusCameraEvent,
  ZeusEntityEvent,
  ZeusRemoteControlEvent,
} from "../events/zeusEvents";
import { Unit } from "../entities/unit";
import { armaFovToDegrees } from "../zeus";
import { MockRenderer } from "../../renderers/mockRenderer";
import type { EntityDef, Manifest } from "../../data/types";

function unitDef(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    id: 1,
    type: "man",
    name: "Rifleman",
    side: "WEST",
    groupName: "Alpha",
    isPlayer: false,
    startFrame: 0,
    endFrame: 200,
    ...overrides,
  };
}

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    worldName: "Altis",
    missionName: "Zeus",
    endFrame: 200,
    chunkSize: 300,
    captureDelayMs: 1000,
    chunkCount: 1,
    entities: [],
    events: [],
    markers: [],
    times: [],
    ...overrides,
  };
}

describe("armaFovToDegrees", () => {
  it("converts the default Arma FOV of 0.75 to about 74 degrees", () => {
    expect(armaFovToDegrees(0.75)).toBeCloseTo(73.74, 1);
  });

  it("falls back when the value is unusable", () => {
    expect(armaFovToDegrees(0)).toBe(75);
    expect(armaFovToDegrees(Number.NaN)).toBe(75);
  });
});

describe("EventManager Zeus occupancy", () => {
  let mgr: EventManager;

  beforeEach(() => {
    mgr = new EventManager();
    mgr.addEvent(new ZeusEntityEvent(2, 1, {
      curatorId: 90,
      name: "Danny",
      playerUid: "7656",
      bodyUnitId: -1,
    }));
    mgr.addEvent(new ZeusRemoteControlEvent(10, 2, {
      curatorId: 90,
      unitId: 7,
      active: true,
      playerName: "Danny",
    }));
    mgr.addEvent(new ZeusRemoteControlEvent(40, 3, {
      curatorId: 90,
      unitId: 7,
      active: false,
    }));
    mgr.addEvent(new ZeusCameraEvent(5, 4, {
      curatorId: 90,
      x: 1000,
      y: 2000,
      dir: 90,
      fov: 0.75,
      pitch: 0.1,
    }));
  });

  it("lists discovered Zeus identities", () => {
    expect(mgr.getZeusEntities()).toEqual([
      expect.objectContaining({ curatorId: 90, name: "Danny", startFrame: 2 }),
    ]);
  });

  it("is hidden before the first entity event", () => {
    expect(mgr.getZeusState(90, 1)).toBeNull();
  });

  it("returns the camera while flying and not possessing", () => {
    const state = mgr.getZeusState(90, 8);
    expect(state?.camera).toEqual({ x: 1000, y: 2000, dir: 90, fov: 0.75, pitch: 0.1 });
    expect(state?.controllingUnitId).toBeNull();
  });

  it("tracks remote-control occupancy by frame", () => {
    expect(mgr.getZeusState(90, 10)?.controllingUnitId).toBe(7);
    expect(mgr.getZeusControllingUnit(7, 10)).toBe(90);
    expect(mgr.getZeusState(90, 40)?.controllingUnitId).toBeNull();
    expect(mgr.getZeusControllingUnit(7, 40)).toBeNull();
  });

  it("attributes possessed-unit kills to the Zeus entity", () => {
    const entities = new EntityManager();
    entities.addEntity(unitDef({ id: 7, name: "AI", side: "EAST" }));
    entities.addEntity(unitDef({ id: 8, name: "Victim", side: "WEST" }));
    entities.addEntity(unitDef({
      id: 90,
      type: "zeus",
      name: "Danny",
      side: "VIRTUAL",
      groupName: "Zeus",
      role: "Zeus",
    }));

    mgr.addEvent(new HitKilledEvent(20, "killed", 1, 8, 7, 40, "AK"));
    mgr.resolveReferences(entities);

    const zeus = entities.getEntity(90) as Unit;
    expect(zeus.killCount).toBe(1);
    expect(mgr.getKillDeathCounts(20).kills.get(90)).toBe(1);
    expect(mgr.getKillDeathCounts(9).kills.get(90)).toBeUndefined();
  });
});

describe("PlaybackEngine Zeus synthesis", () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new PlaybackEngine(new MockRenderer());
  });

  it("creates a VIRTUAL Zeus unit and follows camera then the possessed unit", () => {
    engine.loadRecording(makeManifest({
      entities: [
        unitDef({
          id: 7,
          name: "Rifleman",
          side: "EAST",
          positions: [
            { position: [0, 0], direction: 0, alive: 1 },
            { position: [10, 20], direction: 45, alive: 1 },
          ],
        }),
      ],
      events: [
        {
          frameNum: 0,
          type: "zeusEntity",
          payload: { curatorId: 90, name: "Danny", playerUid: "7656", bodyUnitId: -1 },
        },
        {
          frameNum: 0,
          type: "zeusCamera",
          payload: { curatorId: 90, x: 500, y: 600, dir: 180, fov: 0.75, pitch: 0 },
        },
        {
          frameNum: 1,
          type: "zeusRemoteControl",
          payload: { curatorId: 90, unitId: 7, active: true, playerName: "Danny" },
        },
      ],
    }));

    const zeus = engine.entityManager.getEntity(90);
    expect(zeus).toBeInstanceOf(Unit);
    expect(zeus?.side).toBe("VIRTUAL");
    expect(engine.entityManager.getBySide("VIRTUAL")).toHaveLength(1);

    engine.seekTo(0);
    const flying = engine.entitySnapshots().get(90);
    expect(flying?.position).toEqual([500, 600]);
    expect(flying?.iconType).toBe("zeus");
    expect(flying?.fov).toBe(0.75);
    expect(flying?.side).toBe("VIRTUAL");

    engine.seekTo(1);
    const possessing = engine.entitySnapshots().get(90);
    expect(possessing?.position).toEqual([10, 20]);
    expect(possessing?.side).toBe("EAST");
    expect(possessing?.controllingUnitId).toBe(7);
    expect(possessing?.name).toContain("controlling");
    expect(possessing?.fov).toBeUndefined();
  });

  it("synthesizes VIRTUAL Zeus when curatorId 0 is an empty entity hole", () => {
    engine.loadRecording(makeManifest({
      entities: [
        unitDef({
          id: 0,
          name: "",
          type: "unknown",
          side: "CIV",
        }),
        unitDef({
          id: 1,
          name: "Horacek",
          side: "WEST",
        }),
      ],
      events: [
        {
          frameNum: 1,
          type: "zeusEntity",
          payload: { curatorId: 0, name: "YetheSamartaka", playerUid: "7656", bodyUnitId: -1 },
        },
        {
          frameNum: 1,
          type: "zeusCamera",
          payload: { curatorId: 0, x: 8504, y: -902, dir: 0, fov: 1 },
        },
      ],
    }));

    const zeus = engine.entityManager.getEntity(0);
    expect(zeus).toBeInstanceOf(Unit);
    expect(zeus?.type).toBe("zeus");
    expect(zeus?.side).toBe("VIRTUAL");
    expect(zeus?.name).toBe("YetheSamartaka");
    expect(engine.entityManager.getBySide("VIRTUAL")).toHaveLength(1);

    engine.seekTo(1);
    expect(engine.entitySnapshots().get(0)?.iconType).toBe("zeus");
    expect(engine.entitySnapshots().get(0)?.position).toEqual([8504, -902]);
  });
});
