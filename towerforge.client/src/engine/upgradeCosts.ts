// ============================================================
//  TowerForge Companion — Workshop and lab upgrade costs
//  What the next workshop and lab levels cost the player, after their
//  discount labs, and how long a lab takes.
//
//  - Workshop: the game's cost table (constants/workshopCosts.ts), less
//    0.5% a level of that section's Workshop Discount lab (49.5% at 99).
//  - Labs: coins (constants/labCosts.ts) less 0.3% a level of Labs Coin
//    Discount; time ÷ (1 + 2% a level of Labs Speed) ÷ (1 + the Lab
//    Speed relic). Labs Speed doesn't speed up its own research (wiki,
//    Labs Speed); gem speed-ups aren't counted.
//  - Enhancements: the game's table (workshopCosts.ts), less 0.3% a level
//    of that section's Enhancement Coin Discount lab (30% at 100).
//  - Module slots: shards and coins a level (moduleCosts.ts), less 1% a
//    level of the Module Shard Cost / Module Coin Cost labs (30% at 30).
//  - Bots: every bot stat's level L costs 100 + 40 × (L − 1) medals (wiki
//    bot Cost pages: 100 for level 1, 1,260 for level 30). Bot+ level L
//    costs 100 + 50 × (L − 1), or 100 + 200 × (L − 1) for Amplify Bot's
//    Echoing Shot (wiki bot pages, TheTowerSDK; constants/botData.ts).
//  - Card slots (gems), Event Shop trades (medals) and Elite Cell lab
//    boosts: the wiki's Cards and Currencies pages.
//  Pure functions — no store imports.
// ============================================================

import { WS_ENH, WS_STATS } from '../constants/gameData';
import { ENH_COIN_COSTS, WS_COIN_COSTS } from '../constants/workshopCosts';
import { MODULE_SLOT_COINS, MODULE_SLOT_SHARDS } from '../constants/moduleCosts';
import { LAB_LEVEL_COSTS } from '../constants/labCosts';
import type { LabData, LabProgress } from '../types/gameTypes';

export type WorkshopSection = 'attack' | 'defense' | 'utility';

const WS_DISCOUNT_LAB: Record<WorkshopSection, string> = {
    attack: 'WS Atk Discount', defense: 'WS Def Discount', utility: 'WS Util Discount',
};
const ENH_DISCOUNT_LAB: Record<WorkshopSection, string> = {
    attack: 'Enh Atk Discount', defense: 'Enh Def Discount', utility: 'Enh Util Discount',
};

// Share of workshop coin costs the section's discount lab takes off (0–0.495).
export function workshopDiscount(labs: LabData, section: WorkshopSection): number {
    return Math.min(99, labs[WS_DISCOUNT_LAB[section]] ?? 0) * 0.005;
}

// Share of enhancement coin costs the section's discount lab takes off (0–0.3).
export function enhancementDiscount(labs: LabData, section: WorkshopSection): number {
    return Math.min(100, labs[ENH_DISCOUNT_LAB[section]] ?? 0) * 0.003;
}

const WS_MAX: Record<string, number> = Object.fromEntries(Object.values(WS_STATS).flat());
const ENH_MAX: Record<string, number> = Object.fromEntries(Object.values(WS_ENH).flat().map(([n, max]) => [n, max]));
const runningTotals = new Map<[number, number[]], number[]>();

// Coins spent on a stat to reach `level`, before discounts. Long stats list
// one total per 10 levels; inside one the levels are taken as equal.
function tableTotal(table: [number, number[]] | undefined, max: number | undefined, level: number): number | null {
    if (!table || max === undefined) return null;
    const [step, costs] = table;
    let sums = runningTotals.get(table);
    if (!sums) {
        sums = [0];
        for (const c of costs) sums.push(sums[sums.length - 1] + c);
        runningTotals.set(table, sums);
    }
    const l = Math.min(max, Math.max(0, level));
    const k = Math.min(costs.length - 1, Math.floor(l / step));
    const span = Math.min(step, max - k * step);
    return sums[k] + costs[k] * Math.min(1, (l - k * step) / span);
}

// Coins to take a workshop stat from one level to another, after `discount`.
export function workshopCost(stat: string, from: number, to: number, discount = 0): number | null {
    const a = tableTotal(WS_COIN_COSTS[stat], WS_MAX[stat], from);
    const b = tableTotal(WS_COIN_COSTS[stat], WS_MAX[stat], to);
    return a === null || b === null ? null : Math.max(0, b - a) * (1 - discount);
}

// Coins to take an enhancement from one level to another, after `discount`.
export function enhancementCost(name: string, from: number, to: number, discount = 0): number | null {
    const a = tableTotal(ENH_COIN_COSTS[name], ENH_MAX[name], from);
    const b = tableTotal(ENH_COIN_COSTS[name], ENH_MAX[name], to);
    return a === null || b === null ? null : Math.max(0, b - a) * (1 - discount);
}

export const MODULE_SLOT_MAX = MODULE_SLOT_SHARDS.length;

// Shards and coins to take a module slot from one level to another.
export function moduleSlotCost(from: number, to: number, labs: LabData): { shards: number; coins: number } {
    let shards = 0;
    let coins = 0;
    for (let l = Math.max(0, from); l < Math.min(MODULE_SLOT_MAX, to); l++) {
        shards += MODULE_SLOT_SHARDS[l];
        coins += MODULE_SLOT_COINS[l];
    }
    return {
        shards: shards * (1 - 0.01 * Math.min(30, labs['Module Shard Cost'] ?? 0)),
        coins: coins * (1 - 0.01 * Math.min(30, labs['Module Coin Cost'] ?? 0)),
    };
}

// Medals to take one bot stat from one level to another.
export function botMedalCost(from: number, to: number): number {
    let medals = 0;
    for (let l = from + 1; l <= to; l++) medals += 100 + 40 * (l - 1);
    return medals;
}

// Medals to take a Bot+ ability from one level to another (level 0 comes
// with the 1,250-stone unlock). `costStep` is the bot's, from BOTS_CONFIG.
export function botPlusMedalCost(from: number, to: number, costStep: number): number {
    let medals = 0;
    for (let l = Math.max(0, from) + 1; l <= to; l++) medals += 100 + costStep * (l - 1);
    return medals;
}

// Gems for card slot n (index n − 1; slot 1 is free, 22 can be bought).
export const CARD_SLOT_GEMS = [0, 50, 100, 200, 300, 400, 500, 600, 750, 1000, 1200, 1400, 1600, 1800,
    2500, 3500, 4500, 5500, 6500, 7500, 8500, 10000];

// Event Shop trades: medals for the 1st, 2nd … trade of one kind in an
// event (7th and later 380). Each gives 15 stones, 250 Module Shards
// of one type, or 150 Gems.
export const MEDAL_TRADE_PRICES = [40, 65, 90, 130, 175, 230, 380];
export const MEDAL_TRADE_GIVES = { stones: 15, shards: 250, gems: 150 };

// Elite Cell lab boosts: speed and cells per hour, for one lab slot.
export const CELL_BOOSTS: [number, number][] = [
    [1.5, 15], [2, 100], [3, 840], [4, 3360], [5, 11900], [6, 60000], [7, 250000], [8, 1e6],
];

export interface LabLevelCost {
    coins: number;
    hours: number;
}

// Total research speed: the Labs Speed lab × the Lab Speed relic.
export function labSpeed(labs: LabData, relics: Record<string, number>, lab?: string): number {
    const fromLab = lab === 'Labs Speed' ? 1 : 1 + 0.02 * (labs['Labs Speed'] ?? 0);
    return fromLab * (1 + (relics['rLabSpd'] ?? 0) / 100);
}

// Coins and research time for `level` (1 = the first level) of a lab; null
// when the catalog doesn't have that level. A level already under way costs
// the time it has left (`progress`). Its coins are paid while it's running;
// stopping a lab refunds them and restarting it buys it again (owner,
// 2026-10-31), so a stopped level keeps its price.
export function labLevelCost(
    lab: string, level: number, labs: LabData, relics: Record<string, number>, progress?: LabProgress,
): LabLevelCost | null {
    const row = LAB_LEVEL_COSTS[lab];
    const i = level - 1;
    if (!row || i < 0 || i >= row[0].length) return null;
    const under = progress?.[lab]?.toLevel === level ? progress[lab] : undefined;
    return {
        coins: under?.running ? 0 : row[1][i] * (1 - 0.003 * Math.min(99, labs['Labs Coin Discount'] ?? 0)),
        hours: row[0][i] / 60 / labSpeed(labs, relics, lab) * (1 - (under?.done ?? 0)),
    };
}

// Research time the way the game shows it: "7d 3h", "16h 39m", "6m".
export function formatLabTime(hours: number): string {
    const mins = Math.round(hours * 60);
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (d > 0) return `${d}d ${h}h`;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
