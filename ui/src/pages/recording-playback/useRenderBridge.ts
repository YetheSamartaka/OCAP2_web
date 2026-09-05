import { createEffect } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  MarkerHandle,
  LineHandle,
  CrewInfo,
  BriefingMarkerHandle,
} from "../../renderers/renderer.types";
import { SIDE_COLORS_BRIGHT, SIDE_COLORS_DARK } from "../../config/sideColors";
import type { PlaybackEngine } from "../../playback/engine";
import type { MarkerManager } from "../../playback/markerManager";
import { Vehicle } from "../../playback/entities/vehicle";
import { Unit } from "../../playback/entities/unit";
import { HitKilledEvent } from "../../playback/events/hitKilledEvent";
import {
  groupZeusPings,
  zeusPingAlpha,
  zeusPingLifetimeFrames,
  type ZeusPingGroup,
} from "../../playback/zeus";
import { formatTime, type TimeMode } from "../../playback/time";
import type { Side } from "../../data/types";
import type { MapRenderer } from "../../renderers/renderer.interface";
import { leftPanelVisible, activeSide } from "./shortcuts";

/**
 * Build structured crew info for a vehicle.
 * The renderer decides how to format this for display.
 */
function getCrewInfo(
  vehicle: Vehicle,
  entityManager: PlaybackEngine["entityManager"],
): CrewInfo {
  const names: string[] = [];
  for (const id of vehicle.crew) {
    const member = entityManager.getEntity(id);
    if (member instanceof Unit && member.isPlayer) {
      names.push(member.name || `Unit ${id}`);
    }
  }
  return { count: vehicle.crew.length, names };
}

/** The label is interpolated into a divIcon's HTML, and `name` comes from the game. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Marker colour for a ping, as the bare hex the marker image route expects. */
function pingColor(side: string): string {
  const color = SIDE_COLORS_BRIGHT[side as Side] ?? "#ffcc00";
  return color.replace("#", "");
}

/**
 * The text drawn beside a ping icon: one timestamp per ping, newest first, so
 * repeat pings from the same player are distinguishable at a glance. The
 * player's name is only worth the width when several players have live pings.
 */
function pingLabel(
  group: ZeusPingGroup,
  showName: boolean,
  format: (frame: number) => string,
): string {
  const times = group.frames.map((frame) => escapeHtml(format(frame)));
  if (showName && group.name) {
    return [escapeHtml(group.name), ...times].join("<br>");
  }
  return times.join("<br>");
}

interface PingRender {
  icon: BriefingMarkerHandle;
  label: BriefingMarkerHandle;
  labelText: string;
}

/**
 * Syncs engine snapshots to renderer markers, updates briefing markers
 * per frame, and keeps the CSS left-offset in sync with panel visibility.
 */
export function useRenderBridge(
  engine: PlaybackEngine,
  renderer: MapRenderer,
  markerManager: MarkerManager,
  timeMode: Accessor<TimeMode> = () => "elapsed",
): void {
  const markerHandles = new Map<number, MarkerHandle>();
  let firelineHandles: LineHandle[] = [];

  // Entity snapshot → marker sync
  createEffect(() => {
    const snapshots = engine.entitySnapshots();
    const frame = engine.currentFrame();

    // Build set of entities hit on this exact frame.
    // The canvas layer handles the visual duration (wall-clock fade-out).
    const hitEntityIds = new Set<number>();
    for (const ev of engine.eventManager.getEventsAtFrame(frame)) {
      if (ev instanceof HitKilledEvent && ev.type === "hit") {
        hitEntityIds.add(ev.victimId);
      }
    }

    for (const handle of firelineHandles) {
      renderer.removeLine(handle);
    }
    firelineHandles = [];

    for (const [id, handle] of markerHandles) {
      if (!snapshots.has(id)) {
        renderer.removeEntityMarker(handle);
        markerHandles.delete(id);
      }
    }

    for (const [id, snap] of snapshots) {
      let isPlayer = snap.isPlayer;
      let crew: CrewInfo | undefined;
      const entity = engine.entityManager.getEntity(id);
      if (entity instanceof Vehicle) {
        crew = getCrewInfo(entity, engine.entityManager);
        // In "players" mode, show vehicle popup if any crew member is a player
        isPlayer = crew.names.length > 0;
      }

      let handle = markerHandles.get(id);
      if (!handle) {
        handle = renderer.createEntityMarker(id, {
          position: snap.position,
          direction: snap.direction,
          iconType: snap.iconType,
          side: snap.side,
          name: snap.name,
          isPlayer,
          crew,
          fov: snap.fov,
          pitch: snap.pitch,
        });
        markerHandles.set(id, handle);
      }
      renderer.updateEntityMarker(handle, {
        position: snap.position,
        direction: snap.direction,
        alive: snap.alive,
        side: snap.side,
        name: snap.name,
        iconType: snap.iconType,
        isPlayer,
        isInVehicle: snap.isInVehicle,
        hit: hitEntityIds.has(id),
        crew,
        fov: snap.fov,
        pitch: snap.pitch,
      });

      if (snap.firedTargets) {
        const color = snap.side ? SIDE_COLORS_DARK[snap.side] : "#FFFFFF";
        for (const target of snap.firedTargets) {
          firelineHandles.push(
            renderer.addLine(snap.position, target, {
              color,
              weight: 2,
              opacity: 0.4,
            }),
          );
        }
      }
    }
  });

  // Zeus pings → transient map overlay.
  // A ping is drawn for ZEUS_PING_MAP_SECONDS of playback time and then removed
  // from the map; the event itself stays in the event log forever. Recomputing
  // the active set from the frame means scrubbing backwards works for free.
  const pingRenders = new Map<string, PingRender>();

  createEffect(() => {
    const frame = engine.currentFrame();
    const mode = timeMode();
    const lifetime = zeusPingLifetimeFrames(engine.captureDelayMs());
    const groups = groupZeusPings(
      engine.eventManager.getActivePings(frame, lifetime),
    );

    const distinctUnits = new Set(groups.map((group) => group.unitId));
    const showName = distinctUnits.size > 1;
    const config = engine.timeConfig;
    const format = (f: number) => formatTime(f, mode, config);

    const live = new Set<string>();

    for (const group of groups) {
      live.add(group.key);
      const labelText = pingLabel(group, showName, format);
      const color = pingColor(group.side);

      let render = pingRenders.get(group.key);
      if (render && render.labelText !== labelText) {
        // The label is baked into the divIcon at creation, so a changed line
        // count (a second ping, or a different clock) needs a fresh marker.
        renderer.removeBriefingMarker(render.label);
        render.label = renderer.createBriefingMarker({
          shape: "ICON",
          type: "Empty",
          color,
          text: labelText,
          side: "GLOBAL",
          layer: "systemMarkers",
        });
        render.labelText = labelText;
      }

      if (!render) {
        render = {
          icon: renderer.createBriefingMarker({
            shape: "ICON",
            type: "hd_warning",
            color,
            side: "GLOBAL",
            layer: "systemMarkers",
          }),
          label: renderer.createBriefingMarker({
            shape: "ICON",
            type: "Empty",
            color,
            text: labelText,
            side: "GLOBAL",
            layer: "systemMarkers",
          }),
          labelText,
        };
        pingRenders.set(group.key, render);
      }

      const alpha = zeusPingAlpha(frame, group.latestFrame, lifetime);
      const state = { position: group.position, direction: 0, alpha };
      renderer.updateBriefingMarker(render.icon, state);
      renderer.updateBriefingMarker(render.label, state);
    }

    for (const [key, render] of pingRenders) {
      if (live.has(key)) continue;
      renderer.removeBriefingMarker(render.icon);
      renderer.removeBriefingMarker(render.label);
      pingRenders.delete(key);
    }
  });

  // Side filter → briefing markers
  createEffect(() => {
    markerManager.setSideFilter(activeSide());
  });

  // Frame → briefing markers
  createEffect(() => {
    const frame = engine.currentFrame();
    markerManager.updateFrame(frame);
  });

  // Auto-unfollow on map drag
  renderer.on("dragstart", () => {
    engine.unfollowEntity();
  });

  // Smoothing: enable sub-frame interpolation during playback. The interval
  // passed is the wall-clock gap between two position updates so the renderer
  // can size its tween to complete in exactly one frame interval.
  createEffect(() => {
    const playing = engine.isPlaying();
    const speed = engine.playbackSpeed();
    const captureDelayMs = engine.captureDelayMs();
    const frameIntervalSec = speed > 0 ? captureDelayMs / 1000 / speed : 1;
    renderer.setSmoothingEnabled(playing, frameIntervalSec);
  });

  // Side panel visibility → CSS custom property
  createEffect(() => {
    const offset = leftPanelVisible()
      ? "calc(var(--pb-panel-width) + 16px)"
      : "10px";
    document.documentElement.style.setProperty("--leaflet-left-offset", offset);
  });
}
