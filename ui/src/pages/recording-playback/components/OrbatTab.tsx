import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";

import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { SIDE_COLORS_UI } from "../../../config/sideColors";
import { formatElapsedTime } from "../../../playback/time";
import { buildOrbat, buildVehicleOccupancy, isLeader } from "../orbat";
import { activeSide } from "../shortcuts";
import styles from "./OrbatTab.module.css";
import panel from "./SidePanel.module.css";

export function OrbatTab(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();

  const [chunksReady, setChunksReady] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const query = createMemo(() => search().trim().toLowerCase());

  // The vehicle strips span the whole mission, so a chunked recording has to
  // have every chunk in hand. Playback itself only ever loads the chunk under
  // the playhead, which is why this is asked for explicitly rather than assumed.
  createEffect(() => {
    void engine.ensureAllChunks().then(() => setChunksReady(true));
  });

  const allGroups = createMemo(() => buildOrbat(engine, activeSide(), engine.currentFrame()));

  /**
   * Groups narrowed by the search box. A hit on the group name keeps the whole
   * group — searching a callsign is how you ask who is in it — while a hit on a
   * member keeps that member alone. `alive` is recounted over what survives so
   * the strength readout describes the rows actually shown.
   */
  const groups = createMemo(() => {
    const q = query();
    if (!q) return allGroups();
    return allGroups().flatMap((group) => {
      if (group.name.toLowerCase().includes(q)) return [group];
      const members = group.members.filter(
        (m) => m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q),
      );
      if (members.length === 0) return [];
      return [{ ...group, members, alive: members.filter((m) => m.alive).length }];
    });
  });

  const allVehicles = createMemo(() => {
    chunksReady();
    engine.endFrame();
    return buildVehicleOccupancy(engine, engine.currentFrame());
  });

  /** Vehicles match on their own name or on anyone who ever crewed them. */
  const vehicles = createMemo(() => {
    const q = query();
    if (!q) return allVehicles();
    return allVehicles().filter((vehicle) => {
      if (vehicle.name.toLowerCase().includes(q)) return true;
      const crew = new Set<number>();
      for (const sample of vehicle.samples) {
        for (const id of sample.crewIds) crew.add(id);
      }
      for (const id of crew) {
        const name = engine.entityManager.getEntity(id)?.name ?? "";
        if (name.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  });

  const timeStr = (frame: number): string => formatElapsedTime(frame, engine.captureDelayMs());

  const sideColor = () => SIDE_COLORS_UI[activeSide()] ?? "#888";

  const crewNames = (crewIds: number[]): string =>
    crewIds
      .map((id) => engine.entityManager.getEntity(id)?.name ?? `#${id}`)
      .join(", ");

  /** Crew aboard at the sample nearest the playhead. */
  const currentCrew = (vehicleId: number): number[] => {
    const state = engine.getStateAt(vehicleId, engine.currentFrame());
    return state?.crewIds ?? [];
  };

  return (
    <>
      {/* Search: group, player or vehicle name */}
      <div class={panel.filterBar}>
        <input
          class={panel.filterInput}
          type="text"
          placeholder={t("search_orbat")}
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>

      <div class={panel.tabContent}>
      <div class={styles.section}>
        {t("orbat_groups")} · <span style={{ color: sideColor() }}>{activeSide()}</span>
      </div>

      <Show
        when={groups().length > 0}
        fallback={
          <div class={panel.placeholder}>
            {query() ? t("orbat_no_matches") : t("orbat_no_groups")}
          </div>
        }
      >
        <For each={groups()}>
          {(group) => (
            <div class={styles.group}>
              <div class={styles.groupHeader}>
                <span class={styles.groupName}>{group.name || t("ungrouped")}</span>
                <span class={styles.groupStrength}>
                  <span classList={{ [styles.strengthLow]: group.alive === 0 }}>
                    {group.alive}
                  </span>
                  <span class={styles.strengthSlash}>/</span>
                  {group.members.length}
                </span>
              </div>

              <For each={group.members}>
                {(member) => (
                  <button
                    class={styles.member}
                    classList={{ [styles.memberDead]: !member.alive }}
                    onClick={() => engine.followEntity(member.unitId)}
                  >
                    <span class={styles.memberName} style={{ color: sideColor() }}>
                      {member.name}
                    </span>
                    <Show when={isLeader(member.role)}>
                      <span class={styles.leaderBadge}>{t("orbat_leader")}</span>
                    </Show>
                    <Show when={member.regrouped}>
                      <span class={styles.regroupedBadge} title={t("orbat_regrouped")}>
                        ⇄
                      </span>
                    </Show>
                    <span class={styles.memberMeta}>
                      <Show when={member.mounted}>
                        <span class={styles.mounted}>{t("orbat_mounted")}</span>
                      </Show>
                      <span class={styles.memberRole}>{member.role}</span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>

      <div class={styles.section}>{t("orbat_vehicles")}</div>

      <Show
        when={chunksReady()}
        fallback={<div class={styles.note}>{t("orbat_loading_vehicles")}</div>}
      >
        <Show
          when={vehicles().length > 0}
          fallback={
            <div class={styles.note}>
              {query() ? t("orbat_no_vehicle_matches") : t("orbat_no_vehicles")}
            </div>
          }
        >
          <For each={vehicles()}>
            {(vehicle) => {
              const crew = () => currentCrew(vehicle.vehicleId);
              return (
                <div class={styles.vehicle}>
                  <button
                    class={styles.vehicleHeader}
                    onClick={() => engine.followEntity(vehicle.vehicleId)}
                  >
                    <span class={styles.vehicleName}>{vehicle.name}</span>
                    <span class={styles.vehicleMeta}>
                      <Show when={crew().length > 0} fallback={<span>{t("orbat_empty")}</span>}>
                        <span class={styles.crewCount}>{crew().length}</span>
                      </Show>
                    </span>
                  </button>

                  {/* Occupancy strip: one cell per sample, brighter with more
                      aboard, so boarding and dismount read as edges. */}
                  <div class={styles.strip}>
                    <For each={vehicle.samples}>
                      {(sample) => (
                        <div
                          class={styles.stripCell}
                          classList={{ [styles.stripCellEmpty]: sample.crewIds.length === 0 }}
                          style={{
                            opacity:
                              sample.crewIds.length === 0
                                ? 1
                                : 0.35 + 0.65 * (sample.crewIds.length / vehicle.peak),
                          }}
                          title={
                            sample.crewIds.length === 0
                              ? timeStr(sample.frame)
                              : `${timeStr(sample.frame)} — ${crewNames(sample.crewIds)}`
                          }
                          onClick={() => engine.seekTo(sample.frame)}
                        />
                      )}
                    </For>
                  </div>

                  <Show when={crew().length > 0}>
                    <div class={styles.crewList}>{crewNames(crew())}</div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </Show>
      </div>
    </>
  );
}
