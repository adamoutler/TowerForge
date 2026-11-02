// ============================================================
//  TowerForge Companion — Module Bonuses & Perk Bonuses
//  Reads active module loadout + perk state and returns
//  the ModBonuses object consumed by every engine function.
//
//  Pure functions — no store imports.
// ============================================================

import {
    CARD_MASTERY_VALS,
} from '../constants/gameData';

import type {
    ModBonuses,
    PerkBonuses,
    CardMasteryBonuses,
    PerkData,
    LabData,
    CardData,
    ModuleState,
    ModuleEntry,
    UWAbbr,
    ActiveUnique,
    UniqueTier,
    RunRates,
} from '../types/gameTypes';

import { UNIQUE_MODULES } from '../constants/moduleData';
import { activeLoadout, uniqueTier } from './statHelpers';
import { DEFAULT_RUN_RATES } from './runRates';

// ── Get Active Modules from Loadout ──────────────────────────
// Returns flat list of ModuleEntry objects currently equipped
// across all slots in the first loadout.
// TODO: extend to support multiple loadout selection.
export function getActiveModules(moduleState: ModuleState): Array<{
    module: ModuleEntry;
    efficiency: number;
    assistRarity?: string;  // Only set for assist modules
}> {
    const results: Array<{ module: ModuleEntry; efficiency: number; assistRarity?: string }> = [];
    const library = moduleState.library;
    const loadout = activeLoadout(moduleState);

    if (loadout) {
        for (const type of ['cannon', 'armor', 'generator', 'core'] as const) {
            const slots = loadout.slots[type];

            // Main slot — full effect
            if (slots.main) {
                const mod = library.find(m => m.id === slots.main);
                if (mod) results.push({ module: mod, efficiency: 1.0 });
            }

            // Assist slot — sub-effects apply at Substat Efficiency (subEff).
            // (The assist module's MAIN effect is scaled separately by multEff:
            // cannon damage in calcCannonModuleMult.)
            if (slots.assist) {
                const mod = library.find(m => m.id === slots.assist);
                if (mod) {
                    const ad = moduleState.assistData[type];
                    const eff = ad ? Math.min(1, (ad.subEff ?? 0) / 100) : 0;
                    results.push({ module: mod, efficiency: eff, assistRarity: ad?.rarity });
                }
            }
        }
    }

    return results;
}

// ── Active Unique Effects ─────────────────────────────────────
// Each equipped module's unique effect at the tier it runs at: a primary
// module at its own rarity, an assist at the slot's unlocked tier (but never
// above the module's own). Checked on real cards: Being Annihilator as a
// Legendary assist shows 7%, Galaxy Compressor as a Mythic assist −17s.
const TIER_ORDER: UniqueTier[] = ['Epic', 'Legendary', 'Mythic', 'Ancestral'];

export function getActiveUniques(moduleState: ModuleState): ActiveUnique[] {
    const out: ActiveUnique[] = [];
    const loadout = activeLoadout(moduleState);
    if (!loadout) return out;
    for (const type of ['cannon', 'armor', 'generator', 'core'] as const) {
        for (const slot of ['main', 'assist'] as const) {
            const mod = moduleState.library.find(m => m.id === loadout.slots[type][slot]);
            const own = mod ? uniqueTier(mod.rarity) : null;
            if (!mod || !own) continue;
            let tier: UniqueTier = own;
            if (slot === 'assist') {
                const ad = moduleState.assistData[type];
                if (!ad || ad.rarity === 'locked') continue;
                tier = TIER_ORDER[Math.min(TIER_ORDER.indexOf(ad.rarity), TIER_ORDER.indexOf(own))];
            }
            const value = UNIQUE_MODULES[mod.type]?.find(([n]) => n === mod.name)?.[2][tier];
            if (value == null) continue;
            out.push({ name: mod.name, type: mod.type, slot, tier, value });
        }
    }
    return out;
}

// ── Read Active Module Bonuses ────────────────────────────────
// Scans the active loadout and builds the ModBonuses object: UW sub-effect
// bonuses, totals of every other sub-effect, and each unique effect's value.
// `run` carries how often things happen in the player's runs (Battle Report)
// for the effects that depend on it.
export function readActiveModuleBonuses(
    moduleState: ModuleState,
    perkData: PerkData,
    labData: LabData,
    cardData: CardData,
    run: RunRates = DEFAULT_RUN_RATES,
): ModBonuses {
    const uwBonus: ModBonuses['uwBonus'] = {};
    const subs: Record<string, number> = {};

    for (const { module: mod, efficiency } of getActiveModules(moduleState)) {
        for (const sub of mod.subs ?? []) {
            if (!sub.effect || !sub.val) continue;
            // sub.val is the card's display string, e.g. "15%", "-4s", "20x", "15°".
            const raw = (parseFloat(sub.val) || 0) * efficiency;
            subs[sub.effect] = (subs[sub.effect] ?? 0) + raw;

            // UW sub-effects, % values as fractions (e.g. CF slow 0.15).
            const uwMatch = matchUWSub(sub.effect);
            if (uwMatch) {
                const { abbr, statKey } = uwMatch;
                const val = sub.val.includes('%') ? raw / 100 : raw;
                if (!uwBonus[abbr]) uwBonus[abbr] = {};
                (uwBonus[abbr] as Record<string, number>)[statKey] =
                    ((uwBonus[abbr] as Record<string, number>)[statKey] ?? 0) + val;
            }
        }
    }

    const activeUniques = getActiveUniques(moduleState);
    const uniques: Record<string, number> = {};
    for (const u of activeUniques) uniques[u.name] = u.value;

    // Super Tower UW multiplier — calculated from card mastery
    const cardMastery = calcCardMasteryBonuses(0, cardData);
    const stUWMult = calcSuperTowerUWMult(cardMastery, labData);

    return {
        uwBonus,
        stUWMult,
        perks: calcPerkBonuses(perkData, labData),
        uniques,
        activeUniques,
        subs,
        run,
    };
}

// ── UW Sub-Effect Matcher ─────────────────────────────────────
// Maps sub-effect names to their UW abbr and stat key.
// Returns null if the sub-effect is not a UW bonus.
function matchUWSub(
    effectName: string,
): { abbr: UWAbbr; statKey: string } | null {
    const map: Record<string, { abbr: UWAbbr; statKey: string }> = {
        // Chrono Field
        'Chrono Field - Speed Red.': { abbr: 'CF', statKey: 'slow' },
        'Chrono Field - Duration': { abbr: 'CF', statKey: 'dur' },
        'Chrono Field - Cooldown': { abbr: 'CF', statKey: 'cd' },
        // Smart Missiles
        'Smart Missiles - Damage': { abbr: 'SM', statKey: 'dmg' },
        'Smart Missiles - Cooldown': { abbr: 'SM', statKey: 'cd' },
        'Smart Missiles - Quantity': { abbr: 'SM', statKey: 'qty' },
        // Death Wave
        'Death Wave - Damage': { abbr: 'DW', statKey: 'dmg' },
        'Death Wave - Cooldown': { abbr: 'DW', statKey: 'cd' },
        'Death Wave - Quantity': { abbr: 'DW', statKey: 'qty' },
        // Inner Land Mines
        'ILM - Damage': { abbr: 'ILM', statKey: 'dmg' },
        'ILM - Cooldown': { abbr: 'ILM', statKey: 'cd' },
        'ILM - Quantity': { abbr: 'ILM', statKey: 'qty' },
        // Black Hole
        'Black Hole - Size': { abbr: 'BH', statKey: 'size' },
        'Black Hole - Duration': { abbr: 'BH', statKey: 'dur' },
        'Black Hole - Cooldown': { abbr: 'BH', statKey: 'cd' },
        // Poison Swamp
        'Poison Swamp - Damage': { abbr: 'PS', statKey: 'dmg' },
        'Poison Swamp - Duration': { abbr: 'PS', statKey: 'dur' },
        'Poison Swamp - Cooldown': { abbr: 'PS', statKey: 'cd' },
        // Golden Tower
        'Golden Tower - Bonus': { abbr: 'GT', statKey: 'bonus' },
        'Golden Tower - Duration': { abbr: 'GT', statKey: 'dur' },
        'Golden Tower - Cooldown': { abbr: 'GT', statKey: 'cd' },
        // Spotlight
        'Spotlight - Bonus': { abbr: 'SL', statKey: 'bonus' },
        'Spotlight - Angle': { abbr: 'SL', statKey: 'angle' },
        // Chain Lightning
        'Chain Lightning - Damage': { abbr: 'CL', statKey: 'dmg' },
        'Chain Lightning - Quantity': { abbr: 'CL', statKey: 'qty' },
        'Chain Lightning - Chance': { abbr: 'CL', statKey: 'chance' },
    };
    return map[effectName] ?? null;
}

// ── Perk Bonuses ──────────────────────────────────────────────
// A standard perk after some picks, with the Standard Perk Bonus lab (+1% a
// level): x-perks (1 + base × picks) × (1 + SPB), additive ones (Defense %,
// Free Upgrade Chance) base × picks × (1 + SPB) — TheTowerSDK's formula. At one
// pick and SPB 25 it gives what the game's Auto Pick list shows (owner,
// 2026-11-02): x1.44 All Coin Bonuses, x1.50 Max Health, x2.19 Health Regen,
// +6.25% Free Upgrade Chance.
export function standardPerkValue(base: number, picks: number, spbLevel: number, additive = false): number {
    const spb = 1 + spbLevel / 100;
    return additive ? base * picks * spb : (1 + base * picks) * spb;
}

// Reads perkData.banned and returns all active perk multipliers.
// All non-banned perks are assumed active at max quantity.
export function calcPerkBonuses(
    perkData: PerkData,
    labData: LabData,
): PerkBonuses {
    const banned = new Set(perkData.banned ?? []);
    const spbLevel = labData['Standard Perk Bonus'] ?? 0;

    function stdMult(id: string, baseVal: number, maxQty: number): number {
        return banned.has(id) ? 1 : standardPerkValue(baseVal, maxQty, spbLevel);
    }

    // UW perk — flat mult, no SPB
    function uwActive(id: string): boolean {
        return !banned.has(id);
    }

    // Trade-off perk
    function toActive(id: string): boolean {
        return !banned.has(id);
    }

    return {
        totalDmgMult: stdMult('dmg', 0.15, 5),
        clDmgMult: uwActive('cl_dmg') ? 2.0 : 1.0,
        slBonusMult: uwActive('sl_bonus') ? 1.5 : 1.0,
        dwExtraWave: uwActive('dw_wave') ? 1 : 0,
        smExtraQty: uwActive('sm_qty') ? 4 : 0,
        bhExtraDur: uwActive('bh_dur') ? 12 : 0,
        cfExtraDur: uwActive('cf_dur') ? 5 : 0,
        ilmExtraQty: uwActive('ilm_extra') ? 6 : 0,
        gtBonusMult: uwActive('gt_bonus') ? 1.5 : 1.0,
        psRadMult: uwActive('ps_radius') ? 1.5 : 1.0,
        enemySpdMult: toActive('to_espd') ? 0.6 : 1.0,
        toDmgMult: toActive('to_dmg') ? 1.5 : 1.0,
    };
}

// ── Card Mastery Bonuses ──────────────────────────────────────
// Returns mastery bonuses from active cards in the given preset.
// Only cards that are 7★ AND active in the preset contribute.
export function calcCardMasteryBonuses(
    presetIdx: number,
    cardData: CardData,
): CardMasteryBonuses {
    const activeNames = new Set(cardData.presets[presetIdx] ?? []);

    // Returns the mastery value at the card's current level, or `neutral`
    // (1 for multipliers, 0 for additive bonuses) when it doesn't apply.
    // Mastery counts only when the card is 7★, active in the preset, AND
    // unlocked (mu). Level m maps directly to CARD_MASTERY_VALS index m
    // (m=0 = the just-unlocked value, e.g. Damage ×1.4; m=9 = ×5.0).
    function masteryValue(cardName: string, neutral: number): number {
        const entry = cardData.data[cardName];
        if (!entry || entry.s < 7) return neutral;       // must be 7★
        if (!activeNames.has(cardName)) return neutral;   // must be active in preset
        if (!entry.mu) return neutral;                    // mastery not unlocked
        const lv = entry.m ?? 0;                          // in-game level 0–9
        return CARD_MASTERY_VALS[cardName]?.[lv] ?? neutral;
    }

    return {
        dmgMastMult: masteryValue('Damage', 1),
        atkMastMult: masteryValue('Attack Speed', 1),
        critMastAdd: masteryValue('Critical Chance', 0),
        stMastCDRedux: masteryValue('Super Tower', 0),
        rangeMastMult: masteryValue('Range', 1),
        slowMastMult: masteryValue('Slow Aura', 1),
    };
}

// ── Super Tower UW Multiplier ─────────────────────────────────
// ST fires for 15s, then cooldown of 30s starts (CD doesn't overlap with duration).
// Card mastery reduces cooldown by 3s/level → at M9, cooldown reaches 0 (permanent).
// Each ST Bonus lab level = ×1.03 base (linear: 1 + 0.03×level).
// 35% of ST bonus applies to UWs.
export function calcSuperTowerUWMult(
    cardMastery: CardMasteryBonuses,
    labData: LabData,
): number {
    const ST_BASE_DURATION = 15;           // seconds
    const ST_BASE_COOLDOWN = 30;           // seconds (reduced by mastery)
    const ST_UW_BONUS_SHARE = 0.35;        // 35% of ST bonus → UWs
    const ST_LAB_PER_LEVEL = 0.03;         // Verified: +3% per level (Lv30 = 1.90x)

    const stCard = 0;                      // ST card mastery is CD-reduction only (no damage bonus)
    const stLabLv = labData['Super Tower Bonus'] ?? 0;
    const stMult = stCard + stLabLv * ST_LAB_PER_LEVEL;

    const stMastCDRedux = cardMastery.stMastCDRedux ?? 0;  // [3,6,9,12,15,18,21,24,27,30] per level
    const effectiveCD = Math.max(0.1, ST_BASE_COOLDOWN - stMastCDRedux);
    const stUptime = Math.min(1.0, ST_BASE_DURATION / effectiveCD);

    return 1 + (stMult - 1) * ST_UW_BONUS_SHARE * stUptime;
}

// ── Active Cards Helper ───────────────────────────────────────
// Returns the set of card names active in the given preset.
export function getActiveCards(
    presetIdx: number,
    cardData: CardData,
): Set<string> {
    return new Set(cardData.presets[presetIdx] ?? []);
}