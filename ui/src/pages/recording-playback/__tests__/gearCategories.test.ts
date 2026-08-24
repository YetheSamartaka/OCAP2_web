import { describe, expect, it } from "vitest";
import type { GearItem } from "../../../data/types";
import {
  categorizeGearItems,
  classifyGearItem,
  carriedMagazineRounds,
  filledGearCategories,
  isGrenadeItem,
  isMedicalItem,
  magazineClassSet,
  shouldLabelGearCategory,
  sortGearItems,
} from "../gearCategories";

const mag = (item: GearItem): GearItem => item;
const classes = (...names: string[]) => new Set(names);

describe("gearCategories", () => {
  it("treats ACE and KAT treatment items as medical even when they are magazines", () => {
    expect(isMedicalItem({ class: "ACE_packingBandage", name: "Bandage (Packing)" })).toBe(true);
    expect(isMedicalItem({ class: "ACE_salineIV_250", name: "Saline IV (250ml)" })).toBe(true);
    expect(isMedicalItem({ class: "kat_Painkiller", name: "Painkillers" })).toBe(true);
    expect(isMedicalItem({ class: "kat_chestSeal", name: "Chest Seal" })).toBe(true);
    expect(isMedicalItem({ class: "FirstAidKit", name: "First Aid Kit" })).toBe(true);
    expect(
      classifyGearItem({ class: "kat_Painkiller", name: "Painkillers" }, classes("kat_Painkiller")),
    ).toBe("medical");
  });

  it("does not treat ACE tools as medical", () => {
    expect(isMedicalItem({ class: "ACE_MapTools", name: "Map Tools" })).toBe(false);
    expect(isMedicalItem({ class: "ACE_CableTie", name: "Cable Tie" })).toBe(false);
    expect(isMedicalItem({ class: "ACE_EarPlugs", name: "Earplugs" })).toBe(false);
  });

  it("classifies hand grenades and smokes as grenades", () => {
    expect(isGrenadeItem({ class: "HandGrenade", name: "M67 Fragmentation Grenade" })).toBe(true);
    expect(isGrenadeItem({ class: "SmokeShell", name: "M83 Smoke Grenade (White)" })).toBe(true);
    expect(isGrenadeItem({ class: "SmokeShellRed", name: "M18 Smoke Grenade (Red)" })).toBe(true);
    expect(
      isGrenadeItem({
        class: "rhs_mag_m67",
        name: "M67 Frag",
        picture: "\\rhsusf\\addons\\rhsusf_weapons\\icons\\grenade.paa",
      }),
    ).toBe(true);
    expect(isGrenadeItem({ class: "ACE_Chemlight_HiWhite", name: "Chemlight (Hi White)" })).toBe(true);
  });

  it("keeps rifle magazines and UGL shells out of grenades", () => {
    expect(isGrenadeItem({ class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", name: "30rnd PMAG Mk318 Mod 0" })).toBe(
      false,
    );
    expect(isGrenadeItem({ class: "ACE_16Rnd_9x19_mag", name: "9x19 mm 16Rnd Mag" })).toBe(false);
    expect(isGrenadeItem({ class: "1Rnd_Smoke_Grenade_shell", name: "Smoke Grenade 40 mm" })).toBe(false);
  });

  it("splits a vest into magazines, grenades, medical and leftover items in that order", () => {
    const items: GearItem[] = [
      mag({ class: "ACE_CableTie", name: "Cable Tie", count: 2 }),
      mag({ class: "HandGrenade", name: "M67 Fragmentation Grenade", count: 1 }),
      mag({ class: "ACE_packingBandage", name: "Bandage (Packing)", count: 8 }),
      mag({ class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", name: "30rnd PMAG Mk318 Mod 0", count: 4 }),
      mag({ class: "SmokeShell", name: "M83 Smoke Grenade (White)", count: 2 }),
      mag({ class: "ACE_16Rnd_9x19_mag", name: "9x19 mm 16Rnd Mag", count: 2 }),
    ];
    const groups = categorizeGearItems(
      items,
      classes(
        "HandGrenade",
        "SmokeShell",
        "rhs_mag_30Rnd_556x45_Mk318_PMAG",
        "ACE_16Rnd_9x19_mag",
      ),
    );

    expect(filledGearCategories(groups)).toEqual(["magazines", "grenades", "medical", "items"]);
    expect(groups.magazines.map((item) => item.class)).toEqual([
      "rhs_mag_30Rnd_556x45_Mk318_PMAG",
      "ACE_16Rnd_9x19_mag",
    ]);
    expect(groups.grenades.map((item) => item.class)).toEqual(["HandGrenade", "SmokeShell"]);
    expect(groups.medical.map((item) => item.class)).toEqual(["ACE_packingBandage"]);
    expect(groups.items.map((item) => item.class)).toEqual(["ACE_CableTie"]);
  });

  it("sorts chips alphabetically by display name", () => {
    expect(
      sortGearItems([
        { class: "c", name: "Splint" },
        { class: "a", name: "Bandage (Packing)" },
        { class: "b", name: "Adenosine Autoinjector" },
      ]).map((item) => item.name),
    ).toEqual(["Adenosine Autoinjector", "Bandage (Packing)", "Splint"]);
  });

  it("only labels leftover items when another group is present", () => {
    expect(shouldLabelGearCategory("items", ["items"])).toBe(false);
    expect(shouldLabelGearCategory("items", ["magazines", "items"])).toBe(true);
    expect(shouldLabelGearCategory("magazines", ["magazines"])).toBe(true);
    expect(shouldLabelGearCategory("grenades", ["grenades"])).toBe(true);
  });

  it("sums totalRounds from ammo magazines and skips grenades and medical", () => {
    expect(
      carriedMagazineRounds([
        { class: "rhs_mag_30Rnd_556x45_Mk318_PMAG", name: "30rnd PMAG", totalRounds: 120 },
        { class: "ACE_16Rnd_9x19_mag", name: "9x19 mm 16Rnd Mag", totalRounds: 34 },
        { class: "HandGrenade", name: "M67 Fragmentation Grenade", totalRounds: 1 },
        { class: "kat_Painkiller", name: "Painkillers", totalRounds: 20 },
      ]),
    ).toBe(154);
    expect(carriedMagazineRounds([])).toBeUndefined();
    expect(
      carriedMagazineRounds([{ class: "SmokeShell", name: "M83 Smoke Grenade (White)", totalRounds: 2 }]),
    ).toBeUndefined();
  });
});
