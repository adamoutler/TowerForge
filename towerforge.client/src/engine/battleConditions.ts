// ============================================================
//  TowerForge Companion — Battle conditions in the model
//  Tournament battle conditions get stronger as a run goes on ("heat"):
//  each steps up at fixed waves to full strength at W1000
//  (constants/tournamentData.ts). Their strength where a run ends is what
//  decides it, so they're read at the death wave. What the model counts:
//   • Ultimate Weapon Durations −x s → Chrono Field, Golden Tower, Poison
//     Swamp and Black Hole, through the same bonus their duration
//     substats add to
//   • Boss's Ultimate +x%            → boss health, where bosses end runs
//   • Enemy Speed +x%                → enemy speed, so less time in range
//   • Armored Enemies x hits         → that share of the hits an enemy
//     takes on its way in does nothing (armorKeep)
//   • More Enemies, Orb / Death Ray Resistance, Tank's and Basic's
//     Ultimate → more enemies (or more health) for single-target fire to
//     cover (crowdFactor), from the run's own kills and enemy mix
//   • Fast's Ultimate up to x nearby → slow enemies that end runs come in
//     at Fast speed most of the time (fastUltimateTime)
//   • Death Defy Down, Energy Shields Down → run savers (runSavers.ts)
//   • Skip Reduction - Multiply ×x   → Enemy Health Level Skip chance
//   • Skip Decay 1% every N waves    → the skip chance, averaged over the run
//  The last two are fixed for the league and in every tournament. The
//  rest that a Glass Cannon run doesn't feel (or the model doesn't have)
//  say why in tournamentData.ts.
//  Battle-condition labs weaken them: BC Reduction 2% a level for all,
//  each condition's own lab 1% a level, added (TheTowerSDK
//  getTotalBcModifierFraction).
//  Pure functions — no store imports.
// ============================================================

import type { LabData, ModBonuses, UWAbbr } from '../types/gameTypes';
import { HEAT_CONDITIONS, HEAT_WAVES } from '../constants/tournamentData';
import type { HeatCondition, HeatKey, HeatRamp, LeagueHeat } from '../constants/tournamentData';
import type { BattleReport } from './battleReport';
import { inRunLevels } from './freeUpgrades';
import type { RunLevelsInput } from './freeUpgrades';
import { SPEED_RATIO } from './enemyStats';
import type { EnemyType } from './enemyStats';

export interface TourneyConditions {
    uwDurationSec?: number;     // seconds off CF, GT, PS and BH
    bossHealthPct?: number;     // bosses spawn with this % more health
    skipMultiply?: number;      // skip chance × this
    skipDecayFactor?: number;   // skip chance × this, Skip Decay averaged over the run
    enemySpeedPct?: number;     // Enemy Speed: enemies move this % faster
    armoredHits?: number;       // Armored Enemies: each enemy blocks its first N hits
    moreEnemiesPct?: number;    // More Enemies: this % more spawn
    orbLeftPct?: number;        // Orb Resistance: orbs take this % of health instead of destroying
    deathRayLeftPct?: number;   // Death Ray Resistance: the same for Death Ray
    tankUltimate?: boolean;     // Tank's Ultimate: tanks act like bosses (orb and Death Ray immune)
    basicUltimatePct?: number;  // Basic's Ultimate: basics spawn as each other type at this %
    fastUltimate?: number;      // Fast's Ultimate: Fasts buff up to this many nearby enemies to their speed
    deathDefyDownPct?: number;  // Death Defy Down: points off the Death Defy chance
    shieldsDownPct?: number;    // Energy Shields Down: recharge this % longer
}

const DURATION_UWS: UWAbbr[] = ['CF', 'GT', 'PS', 'BH'];

// The heat step a wave is in.
export function heatStep(wave: number): number {
    let i = 0;
    while (i + 1 < HEAT_WAVES.length && wave >= HEAT_WAVES[i + 1]) i++;
    return i;
}

// A condition's value at a wave, before labs.
export function heatValue(c: HeatCondition, ramp: HeatRamp, wave: number): number {
    const values = ramp === 'gentle' && c.gentle ? c.gentle : c.steep;
    return values[heatStep(wave)];
}

// How much the battle-condition labs weaken a condition (0–1).
export function bcLabCut(labs: LabData, lab?: string): number {
    const global = 0.02 * Math.min(10, labs['BC Reduction'] ?? 0);
    const own = lab ? 0.01 * (labs[lab] ?? 0) : 0;
    return Math.min(1, global + own);
}

// Skip Decay takes 1% (less the labs' cut) of the chance off every `every`
// waves, so by wave w the chance is ×(1 − pct·⌊w/every⌋). Health levels
// skipped are the sum over the run, so this is that factor averaged over a
// run to `wave`. TheTowerSDK applies it as a multiplier (applySkipDecay);
// whether the game takes points off instead isn't confirmed.
export function skipDecayFactor(pct: number, every: number, wave: number): number {
    if (pct <= 0 || every <= 0 || wave <= 0) return 1;
    let sum = 0;
    for (let w = 1; w <= wave; w++) sum += Math.max(0, 1 - (pct / 100) * Math.floor(w / every));
    return sum / wave;
}

// The league's fixed conditions (in every tournament), for runs to `wave`.
export function leagueConditions(heat: LeagueHeat, wave: number, labs: LabData): TourneyConditions {
    const cut = bcLabCut(labs);
    const out: TourneyConditions = {};
    if (heat.skipMultiply < 1) out.skipMultiply = cut > 0 ? 1 - (1 - heat.skipMultiply) * (1 - cut) : heat.skipMultiply;
    if (heat.skipDecayEvery) out.skipDecayFactor = skipDecayFactor(1 - cut, heat.skipDecayEvery, wave);
    return out;
}

// A condition's strength at a wave after the labs. A resistance's value is
// what's left of the damage, so the labs weaken what it takes away.
export function heatAfterLabs(c: HeatCondition, ramp: HeatRamp, wave: number, labs: LabData): number {
    const raw = heatValue(c, ramp, wave);
    const cut = bcLabCut(labs, c.lab);
    return c.resistance ? 100 - (100 - raw) * (1 - cut) : raw * (1 - cut);
}

// The random conditions in `active` the model reads, at their strength at `wave`.
export function heatConditions(
    heat: LeagueHeat, active: Partial<Record<HeatKey, boolean>>, wave: number, labs: LabData,
): TourneyConditions {
    const out: TourneyConditions = {};
    if (!heat.ramp) return out;
    const at = (key: HeatKey) => heatAfterLabs(HEAT_CONDITIONS.find(x => x.key === key)!, heat.ramp!, wave, labs);
    if (active.uwDurations) out.uwDurationSec = at('uwDurations');
    if (active.bossUltimate) out.bossHealthPct = at('bossUltimate');
    if (active.enemySpeed) out.enemySpeedPct = at('enemySpeed');
    if (active.armored) out.armoredHits = at('armored');
    if (active.moreEnemies) out.moreEnemiesPct = at('moreEnemies');
    if (active.orb) out.orbLeftPct = at('orb');
    if (active.deathRay) out.deathRayLeftPct = at('deathRay');
    if (active.tankUltimate) out.tankUltimate = true;
    if (active.basicUltimate) out.basicUltimatePct = at('basicUltimate');
    if (active.fastUltimate) out.fastUltimate = at('fastUltimate');
    if (active.deathDefyDown) out.deathDefyDownPct = at('deathDefyDown');
    if (active.energyShieldsDown) out.shieldsDownPct = at('energyShieldsDown');
    return out;
}

// Module and perk bonuses with the conditions in them: shorter UW
// durations, and Enemy Speed on the enemy speed the time in range uses.
export function withConditions(mb: ModBonuses, c: TourneyConditions | undefined): ModBonuses {
    if (!c?.uwDurationSec && !c?.enemySpeedPct) return mb;
    let out = mb;
    if (c.uwDurationSec) {
        const uwBonus = { ...mb.uwBonus };
        for (const a of DURATION_UWS) uwBonus[a] = { ...uwBonus[a], dur: (uwBonus[a]?.dur ?? 0) - c.uwDurationSec };
        out = { ...out, uwBonus };
    }
    if (c.enemySpeedPct) {
        out = { ...out, perks: { ...out.perks, enemySpdMult: (out.perks.enemySpdMult ?? 1) * (1 + c.enemySpeedPct / 100) } };
    }
    return out;
}

// ── What a run's enemies were made of ─────────────────────────
// From a battle report: the share of enemies orbs and Death Ray destroyed,
// the share of basics and tanks, and the average enemy's health in basic
// enemies (types' health multipliers, docs/run-simulation.md §2). Without
// the counts, TheTowerSDK's measured T21 mix (basic 19.9%, fast 28.3%,
// tank 26.7%, ranged 25.2%) stands in.
export interface RunMix {
    orbKills: number;
    deathRayKills: number;
    touchable: number;      // share of enemies orbs and Death Ray can destroy (not bosses, elites, fleets)
    basic: number;
    tank: number;
    avgHealth: number;
}

const TYPE_HEALTH: [string, number][] = [
    ['TotalBasic', 1], ['TotalFast', 1], ['TotalTank', 5], ['TotalRanged', 1], ['TotalBoss', 20],
    ['TotalProtector', 0.6], ['TotalVampires', 2], ['TotalRays', 1], ['TotalScatters', 2],
    ['TotalSaboteurs', 20], ['TotalCommanders', 20], ['TotalOvercharges', 20],
];
// Bosses, elites and fleets: immune to orbs and Death Ray (wiki, SDK).
const IMMUNE = ['TotalBoss', 'TotalVampires', 'TotalRays', 'TotalScatters', 'TotalSaboteurs', 'TotalCommanders', 'TotalOvercharges'];

const SDK_MIX: RunMix = {
    orbKills: 0, deathRayKills: 0, touchable: 1, basic: 0.199, tank: 0.267,
    avgHealth: 0.199 + 0.283 + 0.267 * 5 + 0.252,
};

export function runMix(report: BattleReport | null): RunMix {
    const raw = (report?.raw ?? {}) as Record<string, unknown>;
    const n = (k: string) => (typeof raw[k] === 'number' ? raw[k] as number : 0);
    const counts = TYPE_HEALTH.map(([k, h]) => [n(k), h] as const);
    const all = counts.reduce((s, [c]) => s + c, 0);
    const enemies = report?.totalEnemies || all;
    const share = (k: string) => (enemies > 0 ? Math.min(1, n(k) / enemies) : 0);
    const base = all > 0
        ? { basic: n('TotalBasic') / all, tank: n('TotalTank') / all, avgHealth: counts.reduce((s, [c, h]) => s + c * h, 0) / all }
        : { basic: SDK_MIX.basic, tank: SDK_MIX.tank, avgHealth: SDK_MIX.avgHealth };
    const immune = IMMUNE.reduce((s, k) => s + n(k), 0);
    return {
        ...base, orbKills: share('DestroyedByOrbs'), deathRayKills: share('DestroyedByDeathRay'),
        touchable: enemies > 0 && immune > 0 ? Math.max(0, 1 - immune / enemies) : 1,
    };
}

// Basic's Ultimate turns a basic into a fast, tank, ranged, boss or
// protector at x% each (wiki): extra health per basic, in basic enemies.
const BASIC_ULT_EXTRA = (1 - 1) + (5 - 1) + (1 - 1) + (20 - 1) + (0.6 - 1);

// How many enemies' worth single-target fire (tower shots, Chain Lightning,
// Smart Missiles) has to cover, against a run without these conditions (1):
// More Enemies adds its %; Orb and Death Ray Resistance leave the enemies
// they used to destroy with the rest of their health; Tank's Ultimate makes
// tanks immune to both (boss immunities); Basic's Ultimate adds health. The
// code's model — the enemies that end a run get less of the tower's fire
// when there's more on the field to shoot.
export function crowdFactor(c: TourneyConditions | undefined, mix: RunMix): number {
    if (!c) return 1;
    const orbLeft = c.orbLeftPct !== undefined ? c.orbLeftPct / 100 : 1;
    const drLeft = c.deathRayLeftPct !== undefined ? c.deathRayLeftPct / 100 : 1;
    let load = (c.moreEnemiesPct ?? 0) / 100;
    if (c.orbLeftPct !== undefined) load += mix.orbKills * (1 - orbLeft);
    if (c.deathRayLeftPct !== undefined) load += mix.deathRayKills * (1 - drLeft);
    if (c.tankUltimate) load += mix.tank * (mix.orbKills * orbLeft + mix.deathRayKills * drLeft);
    if (c.basicUltimatePct) load += (mix.basic * (c.basicUltimatePct / 100) * BASIC_ULT_EXTRA) / Math.max(1, mix.avgHealth);
    return 1 + Math.max(0, load);
}

// Fast's Ultimate: Fasts buff up to x nearby enemies to their speed. A slow
// enemy that ends runs (Overcharge, bosses, tanks …) that's buffed comes in
// at Fast speed, so it spends speed ÷ Fast's speed of its usual time in your
// range, and everything that damages it over time does that much less.
// How often it's buffed isn't documented: the owner sees it happen "most of
// the time" (2026-10-21), so 1 − 0.4^x — 60% at up to 1, 84% at 2, 94% at 3
// (the code's estimate). Weighted over how often each type ends the runs,
// as the share of its usual time in range it still gets (1 = no change).
const FAST_SPEED = SPEED_RATIO.Fast;

export function fastBuffShare(x: number | undefined): number {
    return x && x > 0 ? 1 - Math.pow(0.4, x) : 0;
}

export function fastUltimateTime(x: number | undefined, killers: Partial<Record<EnemyType, number>> | undefined): number {
    const p = fastBuffShare(x);
    const entries = Object.entries(killers ?? {}) as [EnemyType, number][];
    const total = entries.reduce((s, [, share]) => s + share, 0);
    if (p <= 0 || total <= 0) return 1;
    // Geometric over the killers, like their health labs (a share of log damage each).
    const log = entries.reduce((s, [type, share]) => {
        const keep = Math.min(1, (SPEED_RATIO[type] ?? 1) / FAST_SPEED);
        return s + (share / total) * Math.log(1 - p + p * keep);
    }, 0);
    return Math.exp(log);
}

// Armored Enemies: each enemy ignores its first `blocked` hits, so for an
// enemy that takes `hits` on its way in, this share of the flat damage
// still lands (at least 5%).
export function armorKeep(blocked: number | undefined, hits: number): number {
    if (!blocked || blocked <= 0) return 1;
    return Math.max(0.05, 1 - blocked / Math.max(1, hits));
}

// A snapshot scored under its conditions.
export function conditioned<T extends { modBonuses: ModBonuses; conditions?: TourneyConditions } & RunLevelsInput>(raw: T): T {
    const snap = inRunLevels(raw);
    return snap.conditions ? { ...snap, modBonuses: withConditions(snap.modBonuses, snap.conditions) } : snap;
}

// Enemy Health Level Skip chance (points) under the conditions: × Skip
// Reduction, then × Skip Decay (TheTowerSDK's order).
export function conditionedSkip(chance: number, c: TourneyConditions | undefined): number {
    if (!c) return chance;
    return Math.max(0, chance * (c.skipMultiply ?? 1) * (c.skipDecayFactor ?? 1));
}

// Health multiplier on an enemy type from the conditions.
export function conditionHealth(type: string, c: TourneyConditions | undefined): number {
    return type === 'Boss' && c?.bossHealthPct ? 1 + c.bossHealthPct / 100 : 1;
}
