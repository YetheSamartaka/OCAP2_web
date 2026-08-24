import type { GearItem } from "../../data/types";

export type GearCategory = "magazines" | "grenades" | "medical" | "items";

export const GEAR_CATEGORY_ORDER: GearCategory[] = ["magazines", "grenades", "medical", "items"];

export const GEAR_CATEGORY_LABEL_KEYS: Record<GearCategory, string> = {
  magazines: "profile_magazines",
  grenades: "profile_grenades",
  medical: "profile_medical_gear",
  items: "profile_items",
};

export interface CategorizedGear {
  magazines: GearItem[];
  grenades: GearItem[];
  medical: GearItem[];
  items: GearItem[];
}

const ACE_MEDICAL_CLASS =
  /^ace_(fielddressing|packingbandage|elasticbandage|quikclot|tourniquet|morphine|epinephrine|adenosine|splint|surgicalkit|personalaidkit|bodybag|salineiv|bloodiv|plasmaiv|painkillers|suture)/;

function classNameOf(item: GearItem): string {
  return (item.class || "").toLowerCase();
}

function displayNameOf(item: GearItem): string {
  return (item.name || "").toLowerCase();
}

function pictureOf(item: GearItem): string {
  return (item.picture || "").replace(/\\/g, "/").toLowerCase();
}

/** 40 mm / UGL grenade *shells* stay with magazines; they are ammo, not throwables. */
function isLauncherGrenadeAmmo(item: GearItem): boolean {
  const cls = classNameOf(item);
  return /\d+rnd/.test(cls) && /(shell|ugl|40mm|grenade_shell)/.test(cls);
}

export function isMedicalItem(item: GearItem): boolean {
  const cls = classNameOf(item);
  const picture = pictureOf(item);
  if (cls.startsWith("kat_")) return true;
  if (cls === "firstaidkit" || cls === "medikit") return true;
  if (ACE_MEDICAL_CLASS.test(cls)) return true;
  if (picture.includes("medical_treatment") || picture.includes("/kat/addons/")) return true;
  if (picture.includes("firstaid") || picture.includes("medikit")) return true;
  return false;
}

export function isGrenadeItem(item: GearItem): boolean {
  if (isLauncherGrenadeAmmo(item)) return false;
  if (isMedicalItem(item)) return false;
  const cls = classNameOf(item);
  const name = displayNameOf(item);
  const picture = pictureOf(item);
  if (/^(smokeshell|handgrenade|minigrenade)/.test(cls)) return true;
  if (/(chemlight|handflare|ir_grenade|flashbang|ace_m84|ace_cts9)/.test(cls)) return true;
  if (/rhs_mag_(m67|m18|an_m8|mk84|mk3a2|rgd5|rgn|rgo|rdg2|nspd|fakel|zarya)/.test(cls)) return true;
  if (picture.includes("smokegrenade") || picture.includes("chemlight")) return true;
  if (picture.includes("grenade") && !picture.includes("grenade_shell")) return true;
  if (/\bgrenade\b/.test(name) && !/(launcher|40\s*mm)/.test(name)) return true;
  if (/\bsmoke grenade\b/.test(name) || /\bchemlight\b/.test(name) || /\bstun grenade\b/.test(name)) return true;
  return false;
}

export function classifyGearItem(item: GearItem, magazineClasses: Set<string>): GearCategory {
  if (isMedicalItem(item)) return "medical";
  if (isGrenadeItem(item)) return "grenades";
  if (item.class && magazineClasses.has(item.class)) return "magazines";
  return "items";
}

export function sortGearItems(items: GearItem[]): GearItem[] {
  return [...items].sort((a, b) => {
    const byName = (a.name || a.class || "").localeCompare(b.name || b.class || "", undefined, {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    return (a.class || "").localeCompare(b.class || "");
  });
}

export function categorizeGearItems(
  items: GearItem[] | undefined,
  magazineClasses: Set<string>,
): CategorizedGear {
  const groups: CategorizedGear = { magazines: [], grenades: [], medical: [], items: [] };
  for (const item of items ?? []) {
    groups[classifyGearItem(item, magazineClasses)].push(item);
  }
  for (const key of GEAR_CATEGORY_ORDER) {
    groups[key] = sortGearItems(groups[key]);
  }
  return groups;
}

export function filledGearCategories(groups: CategorizedGear): GearCategory[] {
  return GEAR_CATEGORY_ORDER.filter((key) => groups[key].length > 0);
}

/** Items stays unlabeled when it is the only group; named groups always keep their heading. */
export function shouldLabelGearCategory(
  key: GearCategory,
  filled: GearCategory[],
  alwaysLabel = false,
): boolean {
  if (alwaysLabel) return true;
  if (key === "items") return filled.length > 1;
  return true;
}

export function magazineClassSet(magazines?: Array<{ class: string }>): Set<string> {
  return new Set((magazines ?? []).map((item) => item.class).filter(Boolean));
}

export function magazinesNotInContainers(gear: {
  magazines?: GearItem[];
  uniform?: { items?: GearItem[] };
  vest?: { items?: GearItem[] };
  backpack?: { items?: GearItem[] };
}): GearItem[] {
  const inContainers = new Set<string>();
  for (const container of [gear.uniform, gear.vest, gear.backpack]) {
    for (const item of container?.items ?? []) {
      if (item.class) inContainers.add(item.class);
    }
  }
  return (gear.magazines ?? []).filter((item) => item.class && !inContainers.has(item.class));
}

/** Sum remaining ammo in rifle/pistol magazines, skipping grenades and medical mags. */
export function carriedMagazineRounds(
  magazines?: Array<GearItem & { totalRounds?: number }>,
): number | undefined {
  const magClasses = magazineClassSet(magazines);
  let total = 0;
  let have = false;
  for (const mag of magazines ?? []) {
    if (classifyGearItem(mag, magClasses) !== "magazines") continue;
    if (typeof mag.totalRounds !== "number") continue;
    total += mag.totalRounds;
    have = true;
  }
  return have ? total : undefined;
}
