// ============================================================
//  TowerForge Companion — Enemy Level Skip upgrades
//  The coin upgrades that raise the chance to skip an enemy health level
//  (Glass Cannon) or attack level (eHP), and how many skip points each
//  one adds — each point moves the death wave a long way (runLength.ts).
//  Health and attack have their own workshop stat, lab, relic and module
//  substat; the Enemy Level Skips enhancement multiplies both
//  (TheTowerSDK mechanics/enemies/level-skip: one ELS+ field for both).
//
//  Skip chance = (workshop + lab + relic + module substats)
//                × the Enemy Level Skips enhancement, capped at 100%;
//  tier battle conditions then subtract a fixed amount, so an upgrade
//  adds to the chance a run actually gets exactly what it adds here.
//    - Workshop: 0.05% a level (699 levels, 35% at max).
//    - Lab: 0.1% a level (20 levels).
//    - Enhancement: ×1 + 0.01 a level (60 levels, ×1.6) — it multiplies
//      everything else, so one level is worth several workshop levels.
//  Costs: the workshop, lab and enhancement tables (engine/upgradeCosts.ts),
//  after the player's discount labs and lab speed.
//  Scores read the workshop level free upgrades take it to (freeUpgrades.ts).
//  Pure functions — no store imports.
// ============================================================

import type { EnhData, LabData, LabProgress, WSPreset } from '../types/gameTypes';
import { WS_ENH, WS_STATS } from '../constants/gameData';
import {
    enhancementCost, enhancementDiscount, formatLabTime, labLevelCost, workshopCost, workshopDiscount,
} from './upgradeCosts';

export type SkipKind = 'health' | 'attack';

// Each kind's workshop stat, lab, relic and module substat.
export const SKIP_NAMES: Record<SkipKind, { workshop: string; lab: string; relic: string; substat: string }> = {
    health: { workshop: 'Enemy HP Level Skip', lab: 'Enemy HP Lvl Skip Lab', relic: 'rEHPSkip', substat: 'Enemy HP Level Skip' },
    attack: { workshop: 'Enemy Atk Level Skip', lab: 'Enemy Atk Lvl Skip Lab', relic: 'rEAtkSkip', substat: 'Enemy Atk Level Skip' },
};
const WORKSHOP_MAX = 699;
const LAB_MAX = 20;
const ENH = 'Enemy Level Skips';
const ENH_MAX = 60;
const WORKSHOP_STEP = 10;     // offered in steps of 10 levels — one level is 0.05%

export interface SkipSources {
    kind?: SkipKind;          // default 'health'
    workshop: number;         // workshop level (0–699)
    lab: number;              // lab level (0–20)
    enhancement: number;      // enhancement level (0–60); 0 also when not unlocked
    enhancementOwned: boolean;
    otherPct: number;         // relic + module substats, in %
    // For the prices: the player's discount labs, lab speed and relics.
    // Omitted = no discounts.
    labs?: LabData;
    relics?: Record<string, number>;
    labProgress?: LabProgress;
    // Not bought or reached yet in the game (engine/unlocks.ts): not offered.
    closed?: { workshop?: boolean; lab?: boolean };
}

const wsIdx = (kind: SkipKind) => WS_STATS.utility.findIndex(([n]) => n === SKIP_NAMES[kind].workshop);
const ENH_IDX = WS_ENH.utility.findIndex(([n]) => n === ENH);

export function skipSources(
    kind: SkipKind, ws: WSPreset | undefined, labs: LabData, enh: EnhData, relics: Record<string, number>,
    subs: Record<string, number>,
): SkipSources {
    const names = SKIP_NAMES[kind];
    return {
        kind,
        workshop: ws?.utility[wsIdx(kind)] ?? 0,
        lab: labs[names.lab] ?? 0,
        enhancement: enh.d.utility?.[ENH_IDX] ?? 0,
        enhancementOwned: enh.u.utility?.[ENH_IDX] ?? false,
        otherPct: (relics[names.relic] ?? 0) + (subs[names.substat] ?? 0),
        labs, relics,
    };
}

export const healthSkipSources = (
    ws: WSPreset | undefined, labs: LabData, enh: EnhData, relics: Record<string, number>, subs: Record<string, number>,
) => skipSources('health', ws, labs, enh, relics, subs);

export const attackSkipSources = (
    ws: WSPreset | undefined, labs: LabData, enh: EnhData, relics: Record<string, number>, subs: Record<string, number>,
) => skipSources('attack', ws, labs, enh, relics, subs);

// Skip chance before tier battle conditions, in % (health or attack: same rules).
export function healthSkipChance(s: SkipSources): number {
    const base = (s.workshop > 0 ? 0.05 * (s.workshop + 1) : 0) + 0.1 * s.lab + s.otherPct;
    return Math.min(100, base * (s.enhancementOwned ? 1 + 0.01 * s.enhancement : 1));
}

export interface SkipUpgrade {
    source: 'workshop' | 'lab' | 'enhancement';
    from: number;
    to: number;
    points: number;           // skip-chance points added
    cost: number;             // coins
    time?: string;            // lab research time
}

// The next step of each source, from the given levels.
export function nextSkipUpgrades(s: SkipSources): SkipUpgrade[] {
    const now = healthSkipChance(s);
    const names = SKIP_NAMES[s.kind ?? 'health'];
    const labs = s.labs ?? {};
    const out: SkipUpgrade[] = [];
    if (s.workshop < WORKSHOP_MAX && !s.closed?.workshop) {
        const to = Math.min(WORKSHOP_MAX, s.workshop + WORKSHOP_STEP);
        out.push({
            source: 'workshop', from: s.workshop, to,
            points: healthSkipChance({ ...s, workshop: to }) - now,
            cost: workshopCost(names.workshop, s.workshop, to, workshopDiscount(labs, 'utility')) ?? 0,
        });
    }
    const lab = s.lab < LAB_MAX && !s.closed?.lab ? labLevelCost(names.lab, s.lab + 1, labs, s.relics ?? {}, s.labProgress) : null;
    if (lab) {
        out.push({
            source: 'lab', from: s.lab, to: s.lab + 1,
            points: healthSkipChance({ ...s, lab: s.lab + 1 }) - now,
            cost: lab.coins, time: formatLabTime(lab.hours),
        });
    }
    if (s.enhancementOwned && s.enhancement < ENH_MAX) {
        out.push({
            source: 'enhancement', from: s.enhancement, to: s.enhancement + 1,
            points: healthSkipChance({ ...s, enhancement: s.enhancement + 1 }) - now,
            cost: enhancementCost(ENH, s.enhancement, s.enhancement + 1, enhancementDiscount(labs, 'utility')) ?? 0,
        });
    }
    return out.filter(u => u.points > 0);
}

// A path of the most skip per coin, re-checked after each buy (the
// enhancement grows with every other source, and vice versa).
export function skipUpgradePath(s: SkipSources, steps: number): SkipUpgrade[] {
    const path: SkipUpgrade[] = [];
    let cur = { ...s };
    for (let i = 0; i < steps; i++) {
        const best = nextSkipUpgrades(cur).sort((a, b) => b.points / b.cost - a.points / a.cost)[0];
        if (!best) break;
        path.push(best);
        cur = { ...cur, [best.source]: best.to };
    }
    return path;
}
