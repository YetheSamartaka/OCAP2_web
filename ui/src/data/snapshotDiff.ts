import type { PlayerSnapshotDiff, PlayerSnapshotPayload, RawPlayerSnapshot } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A follow-up snapshot carries only what changed since the frame named by `diffOf`,
 * which is what keeps recordings small when a player's gear or radios sit unchanged
 * for the whole mission.
 */
export function isSnapshotDiff(payload: RawPlayerSnapshot): payload is PlayerSnapshotDiff {
  return typeof (payload as PlayerSnapshotDiff).diffOf === "number";
}

/** Deep merge, replacing arrays wholesale. Never mutates `target` or `patch`. */
function merged(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key];
    result[key] =
      isPlainObject(value) && isPlainObject(existing) ? merged(existing, value) : value;
  }
  return result;
}

/** Remove a dot-separated path, cloning every object on the way down. */
function withoutPath(
  target: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const [key, ...rest] = path.split(".");
  if (!(key in target)) return target;
  if (rest.length === 0) {
    const result = { ...target };
    delete result[key];
    return result;
  }
  const child = target[key];
  if (!isPlainObject(child)) return target;
  return { ...target, [key]: withoutPath(child, rest.join(".")) };
}

/** Rebuild a full snapshot by applying a diff on top of the previous full snapshot. */
export function applySnapshotDiff(
  base: PlayerSnapshotPayload,
  diff: PlayerSnapshotDiff,
): PlayerSnapshotPayload {
  let result = merged(
    base as unknown as Record<string, unknown>,
    diff.set ?? {},
  );
  for (const path of diff.unset ?? []) {
    result = withoutPath(result, path);
  }
  return result as unknown as PlayerSnapshotPayload;
}
