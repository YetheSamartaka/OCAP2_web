import { describe, expect, it } from "vitest";
import { applySnapshotDiff, isSnapshotDiff } from "../snapshotDiff";
import type { MedicalSnapshot, PlayerSnapshotDiff } from "../types";

const base = (): MedicalSnapshot => ({
  unitId: 3,
  playerUid: "76561198000000000",
  reason: "periodic",
  vanilla: { damage: 0, lifeState: "HEALTHY" },
  bodyParts: [{ part: "head", damage: 0, items: [] }],
  ace: { bloodVolume: 6, heartRate: 80, pain: 0 },
});

describe("isSnapshotDiff", () => {
  it("recognises a diff by its base frame", () => {
    expect(isSnapshotDiff({ unitId: 3, diffOf: 40, set: {} })).toBe(true);
  });

  it("treats a full snapshot as a full snapshot", () => {
    expect(isSnapshotDiff(base())).toBe(false);
  });
});

describe("applySnapshotDiff", () => {
  it("merges nested changes without touching untouched keys", () => {
    const diff: PlayerSnapshotDiff = {
      unitId: 3,
      diffOf: 40,
      set: { ace: { heartRate: 120 } },
    };

    const result = applySnapshotDiff(base(), diff) as MedicalSnapshot;

    expect(result.ace).toEqual({ bloodVolume: 6, heartRate: 120, pain: 0 });
    expect(result.vanilla).toEqual({ damage: 0, lifeState: "HEALTHY" });
    expect(result.playerUid).toBe("76561198000000000");
  });

  it("replaces arrays wholesale instead of merging them", () => {
    const diff: PlayerSnapshotDiff = {
      unitId: 3,
      diffOf: 40,
      set: {
        bodyParts: [
          { part: "head", damage: 0, items: [] },
          { part: "body", damage: 0.4, items: [{ kind: "bandage", name: "Bandaged wound", count: 2 }] },
        ],
      },
    };

    const result = applySnapshotDiff(base(), diff) as MedicalSnapshot;

    expect(result.bodyParts).toHaveLength(2);
    expect(result.bodyParts?.[1].items[0].name).toBe("Bandaged wound");
  });

  it("removes keys listed in unset, including nested paths", () => {
    const diff: PlayerSnapshotDiff = {
      unitId: 3,
      diffOf: 40,
      set: {},
      unset: ["ace.pain", "reason"],
    };

    const result = applySnapshotDiff(base(), diff) as MedicalSnapshot;

    expect(result.ace).toEqual({ bloodVolume: 6, heartRate: 80 });
    expect("reason" in result).toBe(false);
  });

  it("never mutates the snapshot it builds on", () => {
    const previous = base();
    const diff: PlayerSnapshotDiff = {
      unitId: 3,
      diffOf: 40,
      set: { ace: { pain: 0.8 } },
      unset: ["vanilla.lifeState"],
    };

    applySnapshotDiff(previous, diff);

    expect(previous.ace).toEqual({ bloodVolume: 6, heartRate: 80, pain: 0 });
    expect(previous.vanilla.lifeState).toBe("HEALTHY");
  });

  it("ignores unset paths that do not exist", () => {
    const result = applySnapshotDiff(base(), {
      unitId: 3,
      diffOf: 40,
      set: {},
      unset: ["kat.spo2", "ace.missing"],
    }) as MedicalSnapshot;

    expect(result.ace).toEqual({ bloodVolume: 6, heartRate: 80, pain: 0 });
  });
});
