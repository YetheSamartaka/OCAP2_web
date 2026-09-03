import type { ArmaCoord } from "../utils/coordinates";
import type { AcreRadioPropagation, TfarRadioPropagation } from "./radioPropagation";

/** Faction side. */
export type Side = "WEST" | "EAST" | "GUER" | "CIV";

/** Entity class used for icon/behavior selection. */
export type EntityType =
  | "man"
  | "car"
  | "tank"
  | "apc"
  | "truck"
  | "ship"
  | "heli"
  | "plane"
  | "parachute"
  | "staticWeapon"
  | "staticMortar"
  | "unknown";

/** 0 = dead, 1 = alive, 2 = unconscious */
export type AliveState = 0 | 1 | 2;

/** Static definition of an entity loaded from the manifest. */
export interface EntityDef {
  id: number;
  type: EntityType;
  name: string;
  side: Side;
  groupName: string;
  isPlayer: boolean;
  startFrame: number;
  endFrame: number;
  role?: string;
  framesFired?: Array<[number, ArmaCoord]>;
  /** Per-frame states, populated by JSON decoder (not used by streaming decoders). */
  positions?: EntityState[];
}

/** Per-frame state of an entity within a chunk. */
export interface EntityState {
  position: ArmaCoord;
  direction: number;
  alive: AliveState;
  name?: string;
  /** IDs of crew members (for vehicles). */
  crewIds?: number[];
  /** Vehicle ID this entity is riding in. */
  vehicleId?: number;
  /** Whether this entity is currently inside a vehicle. */
  isInVehicle?: boolean;
  /** Whether this entity is a player this frame. */
  isPlayer?: boolean;
  /** Per-frame group name (may change mid-mission). */
  groupName?: string;
  /** Per-frame side (may change mid-mission). */
  side?: Side;
}

// --------------- Event discriminated union ---------------

export interface HitKilledEventDef {
  type: "hit" | "killed";
  victimId: number;
  causedById: number;
  distance: number;
  weapon: string;
}

export interface ConnectEventDef {
  type: "connected" | "disconnected";
  unitName: string;
}

export interface CounterEventDef {
  type: "respawnTickets" | "counterInit" | "counterSet";
  data: number[];
}

export interface EndMissionEventDef {
  type: "endMission";
  side: string;
  message: string;
}

export interface GeneralEventDef {
  type: "generalEvent";
  message: string;
}

export interface CapturedEventDef {
  type: "captured" | "capturedFlag" | "contested";
  unitName: string;
  objectType: string;
  side?: string;
  position?: [number, number];
}

export interface TerminalHackEventDef {
  type: "terminalHackStarted" | "terminalHackCanceled";
  unitName: string;
}

export type PlayerSnapshotType =
  | "inventorySnapshot"
  | "medicalSnapshot"
  | "staminaSnapshot"
  | "radioSnapshot";

/** How the profile card groups an item. Absent means "items", the default. */
export type GearCategoryTag = "magazines" | "grenades" | "medical";

export interface GearItem {
  class: string;
  /**
   * The item's display name as the recorder read it from config, in English.
   * Absent when the config only had a stringtable reference, which cannot be
   * read in another language from SQF; `gearItemName` derives one from the class.
   */
  name?: string;
  count?: number;
  /**
   * Resolved by the recorder from config. Recordings used to carry the item's
   * `.paa` icon path so the UI could substring-match it into a group, which cost
   * megabytes for a path no browser can load. Only the lists the card groups —
   * container cargo and magazines — carry it.
   */
  cat?: GearCategoryTag;
}

export interface GearContainer extends GearItem {
  items: GearItem[];
}

export interface InventorySnapshot {
  unitId: number;
  playerUid?: string;
  reason?: "periodic" | "death" | string;
  /** Raw Arma mass units. */
  massUnits?: number;
  load: number;
  uniform: GearContainer;
  vest: GearContainer;
  backpack: GearContainer;
  headgear: GearItem;
  goggles: GearItem;
  weapons: Array<GearItem & { slot: string; attachments: GearItem[] }>;
  magazines: Array<GearItem & { totalRounds?: number; loadedCount?: number }>;
  assignedItems: GearItem[];
}

/**
 * Anything a medical mod attaches to, inserts into or injects at a body part.
 * Deliberately untyped beyond a label so a new treatment recorded by the addon
 * shows up without a UI change.
 */
export interface TreatmentItem {
  kind: string;
  /** An English label the recorder writes; never a localized config name. */
  name: string;
  count?: number;
  detail?: string;
}

export interface MedicalBodyPart {
  part: string;
  damage?: number;
  items: TreatmentItem[];
}

export interface MedicalLogEntry {
  time: string;
  text: string;
}

export interface MedicalSnapshot {
  unitId: number;
  playerUid?: string;
  reason?: "periodic" | "death" | string;
  vanilla: Record<string, unknown>;
  /** In ACE body part order: head, body, leftarm, rightarm, leftleg, rightleg. */
  bodyParts?: MedicalBodyPart[];
  /** Treatments that are not tied to a body part, such as medications in the system. */
  treatments?: TreatmentItem[];
  /** ACE activity log, already localized the way the medical menu prints it. */
  activity?: MedicalLogEntry[];
  /** ACE quick view (pulse, BP, response checks). */
  quickView?: MedicalLogEntry[];
  ace?: Record<string, unknown>;
  kat?: Record<string, unknown>;
}

export interface StaminaSnapshot {
  unitId: number;
  playerUid?: string;
  reason?: "periodic" | "death" | string;
  vanilla: Record<string, number>;
  ace?: Record<string, number>;
}

export interface RadioSnapshotEntry extends GearItem {
  mod: string;
  type: "SW" | "LR" | "SR" | string;
  channel: number;
  frequency: number;
  code: string;
  /** Read from the radio's own config where the mod publishes one. */
  rangeMeters: number;
  additional: boolean;
  /** ACRE models propagation instead of a range, so it reports transmit power. */
  powerMilliwatts?: number;
  active?: boolean;
}

export interface RadioSnapshot {
  unitId: number;
  playerUid?: string;
  reason?: "periodic" | "death" | string;
  radios: RadioSnapshotEntry[];
}

export type PlayerSnapshotPayload =
  | InventorySnapshot
  | MedicalSnapshot
  | StaminaSnapshot
  | RadioSnapshot;

/**
 * Follow-up snapshots record only what changed since the same player's previous
 * snapshot of that kind, identified by its frame number.
 */
export interface PlayerSnapshotDiff {
  unitId: number;
  diffOf: number;
  set: Record<string, unknown>;
  unset?: string[];
}

/**
 * An array patched entry by entry instead of replaced. `$key` names the field
 * that identifies an entry, `put` upserts (merging onto the entry already there)
 * and `del` removes. Entries the patch does not mention keep their place.
 */
export interface KeyedArrayPatch {
  $key: string;
  put?: Array<Record<string, unknown>>;
  del?: string[];
  /** Present only when put and del alone would leave the entries out of order. */
  ord?: string[];
}

export type RawPlayerSnapshot = PlayerSnapshotPayload | PlayerSnapshotDiff;

export interface PlayerSnapshotEventDef {
  type: PlayerSnapshotType;
  payload: RawPlayerSnapshot;
}

export interface TfarSettingsEventDef {
  type: "tfarSettings";
  payload: TfarRadioPropagation;
}

export interface AcreSettingsEventDef {
  type: "acreSettings";
  payload: AcreRadioPropagation;
}

export interface ServerFpsEventDef {
  type: "serverFps";
  fps: number;
}

export type EventDef = { frameNum: number } & (
  | HitKilledEventDef
  | ConnectEventDef
  | CounterEventDef
  | EndMissionEventDef
  | GeneralEventDef
  | CapturedEventDef
  | TerminalHackEventDef
  | PlayerSnapshotEventDef
  | TfarSettingsEventDef
  | AcreSettingsEventDef
  | ServerFpsEventDef
);

// --------------- Markers ---------------

/** Sentinel: marker persists until mission end. Decoders must normalize to this value. */
export const FRAME_FOREVER = -1;

export interface MarkerDef {
  shape: "ICON" | "ELLIPSE" | "RECTANGLE" | "POLYLINE" | "POLYGON";
  type: string;
  text?: string;
  side: string;
  color: string;
  size?: [number, number];
  positions: Array<[number, ...any]>;
  player: number;
  alpha: number;
  brush?: string;
  startFrame: number;
  endFrame: number;
}

// --------------- Top-level structures ---------------

export interface Manifest {
  version: number;
  worldName: string;
  missionName: string;
  missionAuthor?: string;
  endFrame: number;
  chunkSize: number;
  captureDelayMs: number;
  chunkCount: number;
  entities: EntityDef[];
  events: EventDef[];
  markers: MarkerDef[];
  times: Array<{ frameNum: number; systemTimeUtc: string; date?: string; timeMultiplier?: number }>;
  extensionVersion?: string;
  addonVersion?: string;
  /** TFAR coverage settings stamped by the recorder, or omitted on older files. */
  radioPropagation?: TfarRadioPropagation;
  /** ACRE coverage settings stamped by the recorder, or omitted on older files. */
  acrePropagation?: AcreRadioPropagation;
  /**
   * Units whose player snapshots live in their own file rather than in `events`.
   * Only chunked protobuf recordings converted since the sidecars existed set
   * this; everywhere else the snapshots are in `events` and this stays empty.
   */
  snapshotUnitIds?: number[];
}

/** A decoded chunk: entity ID -> array of states for this chunk's frames. */
export interface ChunkData {
  entities: Map<number, EntityState[]>;
}

/** Summary row returned by the recordings list API. */
export interface Recording {
  id: string;
  worldName: string;
  missionName: string;
  missionDuration: number;
  date: string;
  tag?: string;
  filename?: string;
  storageFormat?: string;
  conversionStatus?: string;
  schemaVersion?: number;
  chunkCount?: number;
  playerCount?: number;
  killCount?: number;
  playerKillCount?: number;
  sideComposition?: Record<string, { players: number; units: number; dead: number; kills: number }>;
  focusStart?: number;
  focusEnd?: number;
}

/** Per-world map configuration (from map.json). */
export interface WorldConfig {
  worldName: string;
  worldSize: number;
  imageSize?: number;
  maxZoom: number;
  minZoom: number;
  tileSize?: number;
  multiplier?: number;
  /** True when MapLibre + PMTiles rendering is available for this world. */
  maplibre?: boolean;
  /** Base URL for tile assets (set during probing). */
  tileBaseUrl?: string;
  /** Raster layer availability flags (from map.json). */
  hasTopo?: boolean;
  hasTopoDark?: boolean;
  hasTopoRelief?: boolean;
  hasColorRelief?: boolean;
  hasHeightmap?: boolean;
  hasDem?: boolean;
  attribution?: string;
}

/** Installed map world with display name resolved from meta.json / map.json. */
export interface WorldInfo {
  name: string;
  displayName: string;
}
