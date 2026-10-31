// ============================================================
//  TowerForge Companion — Calibrated eDPS (Glass Cannon)
//  Scores upgrades by how much more damage the tower deals, weighted
//  by what actually dealt the damage in one of the player's runs.
//
//  The UW model (uwdps.ts) predicts how each damage source CHANGES with
//  an upgrade, but its absolute numbers aren't reliable (tower damage
//  and enemy health aren't modeled to scale). A battle report says how
//  much each source really dealt, so:
//    score = Σ source share × (modeled source now ÷ modeled at the anchor)
//          + wave-HP effects (Smite, Consume) + sources stones can't change
//  The anchor (the player's current setup) scores exactly 1.
//
//  • Chain Lightning, Smart Missiles (+ Spotlight Missiles), Death Wave,
//    Inner Land Mines and Poison Swamp scale with their modeled eDPS,
//    including core module UW damage, the Ultimate Damage relic,
//    Spotlight and damage-taken effects.
//  • Black Hole deals a share of enemy health, so it scales with its
//    reach (holes × uptime × size), not tower damage.
//  • Tower shots, rend armor and land mines scale with tower damage ×
//    crits × hits per second (attack speed × Multishot × Bounce Shot ×
//    Rapid Fire, towerDamage.calcProjectileFactors) × Spotlight; Chain
//    Lightning procs on those same hits. Echoing Shot (Amplify Bot+)
//    multiplies them by the bullets each tower bullet counts as.
//  • Flame Bot (from the run's FlameBotDamage): burns for its Damage
//    multiple of tower damage with crits (wiki), once per cooldown (Cooldown
//    stat − 1 s per Flame Bot Cooldown lab level), so per enemy pass it
//    scales with ×Damage × tower damage × crits × time in range ÷ cooldown.
//    Burn stacks and Wild Fire (Bot+) aren't modeled. Flat damage.
//  • Guardian Attack (the run's GuardianDamage — the Attack chip is the
//    Guardian's only damage): every cooldown it hits Targets of the most
//    hurt enemies for Percentage of the health they've lost (wiki). So it
//    scales with Percentage × Targets ÷ Cooldown, and with the health its
//    targets have lost, which the rest of the damage takes off: × the rest
//    of the score (eDPS), × the flat sources (run length). The code's
//    assumption: its targets are about as hurt as in the run.
//  • Orbs, thorns, Death Ray and everything else stay fixed.
//  • Tournament battle conditions (battleConditions.ts), against the ones
//    the run had: Enemy Speed shortens the time in range (above); More
//    Enemies, Orb / Death Ray Resistance and Tank's / Basic's Ultimate share
//    single-target fire (tower shots, Chain Lightning, Smart Missiles) with
//    more enemies; Armored Enemies blocks each enemy's first hits, out of
//    the hits an enemy took in the run (shots × bounces + Chain Lightning,
//    per enemy) — more hits a second make it matter less; Fast's Ultimate
//    brings slow enemies that end runs in at Fast speed (less time in range).
//  • Smite (CL+) and Consume (BH+) add a share of each enemy's health.
//    The run's total damage is about the total enemy health, so +x% of
//    every enemy's health is about +x% of total damage.
//    Smite: each Chain Lightning hit has the CL chance to smite, up to 100
//    times per enemy. Hits per enemy come from the run: shots fired ×
//    CL chance × chains ÷ enemies CL reached (the game counts each enemy
//    once). Farming runs land far fewer than 100; without shot counts the
//    cap is assumed.
//    Consume reaches the kills made inside a Black Hole.
//  • Everything is damage to an enemy on its way in. Cooldown UWs (SM, DW,
//    ILM, PS) already count their activations during an enemy's time in
//    range; Chain Lightning and tower shots hit every second, so they scale
//    with that time too (×TTT), and so do Smite procs (more CL hits per
//    enemy). That's how Chrono Field, Chrono Loop (CF+), Slow Aura and range
//    raise damage without dealing any themselves — the code's model: an
//    enemy takes damage for as long as it's in range.
//
//  Pure functions — no store imports.
// ============================================================

import { calcTTT, calcTowerRange } from './ttt';
import {
    buildDamageContext, calcUWDPS, calcSpotlightMult, calcDamageTakenMult, calcSpotlightMissilesDPS,
    calcBlackHoleReach, calcConsumeFraction, calcSmitePerProc, calcCLChanceQty,
} from './uwdps';
import { calcDamageMeter, calcCoreUWDamageMult, echoingShotBullets } from './towerDamage';
import { attackRate, damageMeterFactor } from './guardian';
import { deathRayRate, orbStats } from './orbs';
import { armorKeep, crowdFactor, fastUltimateTime, runMix } from './battleConditions';
import type { RunMix } from './battleConditions';
import { HEALTH_MULT, SPEED_RATIO, healthLabCut } from './enemyStats';
import type { EnemyType } from './enemyStats';
import type { BattleReport } from './battleReport';
import { extraDamage } from './battleReport';
import { dissonanceFactor } from './dissonance';
import { BOTS_CONFIG } from '../constants/botData';
import type { OptimizerSnapshot } from './optimizer';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// A bot stat at a medal level (level 0 = the unlock value).
export function botStatValue(bot: string, stat: string, level: number): number {
    const s = BOTS_CONFIG.find(b => b.name === bot)?.stats.find(x => x.label === stat);
    if (!s) return 0;
    return parseFloat(level > 0 ? s.values[Math.min(level, s.values.length) - 1] : s.lv0) || 0;
}

// Flame Bot burn per enemy pass, in tower-damage units: ×Damage × time in
// range ÷ cooldown. 0 when the bot isn't owned.
function flameBotPerPass(snap: OptimizerSnapshot, hit: number, ttt: number): number {
    const bot = snap.botData?.['Flame Bot'];
    if (!bot?.owned) return 0;
    const medals = bot.medals ?? [];
    const mult = botStatValue('Flame Bot', 'Damage', medals[2] ?? 0);
    const cooldown = Math.max(1, botStatValue('Flame Bot', 'Cooldown', medals[1] ?? 0)
        - (snap.labData['Flame Bot Cooldown'] ?? 0));
    return (mult * hit * ttt) / cooldown;
}

// The damage sources stones can change, modeled in relative units.
export interface EdpsParts {
    cl: number;
    sm: number;
    dw: number;
    ilm: number;
    ps: number;
    bh: number;        // Black Hole reach
    tower: number;     // tower shots / rend / land mines
    smite: number;     // share of enemy health per Smite proc
    clChance: number;  // Chain Lightning chance (0–1)
    clQty: number;     // Chain Lightning chains per proc
    consume: number;   // share of enemy health Consume deals per hole
    flame: number;     // Flame Bot burn per enemy pass
    attack: number;    // Guardian Attack: share of lost health dealt per second
    ttt: number;       // seconds an enemy spends in range (time to tower)
    shotRate: number;  // enemy hits per second (Chain Lightning's chances to proc)
    hitsPerShot: number;   // hits per projectile (Bounce Shot)
    orbRate: number;   // orbs × speed × size (engine/orbs.ts): how often orbs pass an enemy
    deathRayRate: number;  // beam duration × (1 + Double Death Ray chance) (engine/orbs.ts)
}

export interface EdpsCalibration {
    anchor: EdpsParts;
    // Share of the run's total damage, after taking Smite and Consume out of
    // Chain Lightning and Black Hole. `fixed` = orbs, thorns and the rest.
    shares: Omit<EdpsParts, 'smite' | 'clChance' | 'clQty' | 'consume' | 'ttt' | 'shotRate' | 'attack' | 'hitsPerShot' | 'orbRate' | 'deathRayRate'>
        & { guardian: number; fixed: number };
    clReach: number;      // share of enemies Chain Lightning hits (Smite)
    smiteProcs: number;   // Smite procs per enemy reached, at the anchor (≤ 100)
    bhKills: number;      // share of kills made inside a Black Hole (Consume)
    // Battle conditions: the run's kills and enemy mix, the hits an enemy
    // took on its way in, and its crowd and Armored Enemies hits.
    mix: RunMix;
    hitsPerEnemy: number;
    crowd: number;
    armoredHits: number;
    fastUltimate: number;   // Fast's Ultimate the run had (up to N nearby; 0 = none)
    // Orb / Death Ray Resistance the run had: what a touch takes (1 = destroys).
    orbTouch: number;
    deathRayTouch: number;
}

// What battle conditions do to flat damage, against the run's: the share
// of single-target fire each enemy still gets (`targeted`) and of hits that
// get past armor (`flat`). 1 and 1 when nothing changed.
export interface ConditionRatios {
    targeted: number;
    flat: number;
}
const SAME: ConditionRatios = { targeted: 1, flat: 1 };

// Hits an enemy takes on its way in, in model units (shots a second × time
// in range × Chain Lightning's extra hits).
const hitWeight = (p: EdpsParts) => p.shotRate * p.ttt * (1 + p.clChance * p.clQty);

// The enemies that end runs take more hits than the average one, in
// proportion to their health (bosses ×20, tanks ×5 …): their health
// against the run's average enemy, weighted by how often each ends runs.
export function killerHits(killers: Partial<Record<EnemyType, number>> | undefined, mix: RunMix): number {
    const entries = Object.entries(killers ?? {}) as [EnemyType, number][];
    const total = entries.reduce((s, [, share]) => s + share, 0);
    if (total <= 0 || mix.avgHealth <= 0) return 1;
    return entries.reduce((s, [type, share]) => s + share * (HEALTH_MULT[type] ?? 1), 0) / total / mix.avgHealth;
}

export function conditionRatios(snap: OptimizerSnapshot, calib: EdpsCalibration, x: EdpsParts): ConditionRatios {
    const c = snap.conditions;
    if (!c && calib.crowd === 1 && !calib.armoredHits && !calib.fastUltimate) return SAME;
    const crowd = crowdFactor(c, calib.mix);
    const a = calib.anchor;
    const toKill = killerHits(snap.killers, calib.mix);
    const hits = calib.hitsPerEnemy * toKill * (hitWeight(a) > 0 ? hitWeight(x) / hitWeight(a) : 1) * (calib.crowd / crowd);
    const keep0 = armorKeep(calib.armoredHits, calib.hitsPerEnemy * toKill);
    // Fast's Ultimate: the enemies that end runs get less time in range.
    const fast = fastUltimateTime(c?.fastUltimate, snap.killers) / fastUltimateTime(calib.fastUltimate, snap.killers);
    return { targeted: calib.crowd / crowd, flat: (armorKeep(c?.armoredHits, hits) / keep0) * fast };
}

const SMITE_CAP = 100;

// Smite procs per enemy: CL hits per enemy × CL chance, capped at 100.
// Scales from the anchor with CL chance² × chains (more procs and more
// chains) × attacks per second × time in range (more chances per enemy).
function smiteProcs(x: EdpsParts, a: EdpsParts, procs0: number): number {
    const w = (p: EdpsParts) => p.clChance * p.clChance * p.clQty * p.shotRate * p.ttt;
    return Math.min(SMITE_CAP, procs0 * (w(a) > 0 ? w(x) / w(a) : 1));
}

// Time in range now ÷ at the anchor: what per-second sources gain per enemy.
const timeRatio = (x: EdpsParts, a: EdpsParts) => (a.ttt > 0 ? x.ttt / a.ttt : 1);

const calcCLChanceQtyParts = (uwData: OptimizerSnapshot['uwData'], mb: OptimizerSnapshot['modBonuses']) => {
    const { chance, qty } = calcCLChanceQty(uwData, mb);
    return { clChance: chance, clQty: qty };
};

// Modeled damage parts for a snapshot. `ttt` overrides the time-to-tower
// (Chrono Loop is scored through its effect on the path length).
export function edpsParts(snap: OptimizerSnapshot, ttt?: number): EdpsParts {
    const { presetIdx, wsData, labData, cardData, uwData, modBonuses, moduleState, relicData, enhData, botData } = snap;
    const refTTT = ttt ?? calcTTT(presetIdx, wsData, labData, cardData, uwData, modBonuses).ttt;
    const base = buildDamageContext(presetIdx, wsData, labData, cardData, relicData, enhData, modBonuses, moduleState, botData);
    // Dissonant Boosts: Attack on tower damage (and so what's built on it), UW
    // on every UW's damage (TheTowerSDK: eDamage's towerDamage and UW halves).
    const ctx = { ...base, towerDamage: base.towerDamage * dissonanceFactor(snap, 'attack') };
    const damageMeter = calcDamageMeter(presetIdx, wsData, labData, enhData, relicData);
    const range = calcTowerRange(presetIdx, wsData, labData, cardData);
    const sl = calcSpotlightMult(uwData, modBonuses, damageMeter, range);
    const taken = calcDamageTakenMult(uwData, modBonuses, refTTT, presetIdx, wsData, labData);
    const uwShared = calcCoreUWDamageMult(moduleState, labData) * (1 + (relicData['rUWDmg'] ?? 0) / 100) * sl * taken
        * dissonanceFactor(snap, 'uw');
    const uw = (abbr: 'CL' | 'SM' | 'DW' | 'ILM' | 'PS') =>
        calcUWDPS(abbr, uwData, modBonuses, refTTT, presetIdx, wsData, labData, cardData, ctx) * uwShared;
    const flame = flameBotPerPass(snap, ctx.towerDamage * ctx.critMult, refTTT) * sl * taken;
    const slMissiles = calcSpotlightMissilesDPS(
        uwData, modBonuses, refTTT, presetIdx, wsData, labData, cardData, moduleState, relicData, enhData, ctx,
    ) * taken;

    return {
        cl: uw('CL'),
        sm: uw('SM') + slMissiles,
        dw: uw('DW'),
        ilm: uw('ILM'),
        ps: uw('PS'),
        bh: calcBlackHoleReach(uwData, modBonuses, presetIdx, wsData, labData, cardData),
        // Damage/Meter (and Guardian Scout) on tower shots — engine/guardian.ts.
        tower: ctx.towerDamage * ctx.critMult * ctx.hitRate * sl * taken
            * damageMeterFactor(snap.guardian, presetIdx, damageMeter, range) * echoingShotBullets(botData),
        smite: calcSmitePerProc(uwData),
        ...calcCLChanceQtyParts(uwData, modBonuses),
        consume: calcConsumeFraction(uwData),
        flame,
        attack: attackRate(snap.guardian, presetIdx),
        ttt: refTTT,
        shotRate: ctx.hitRate,
        hitsPerShot: ctx.projectiles.bounce,
        orbRate: orbStats(snap).rate,
        deathRayRate: deathRayRate(snap),
    };
}

// Calibration from a run's damage by source; null when the report has none.
export function buildEdpsCalibration(snap: OptimizerSnapshot, report: BattleReport | null): EdpsCalibration | null {
    const d = report?.damage;
    if (!d || !(d.total > 0)) return null;
    const anchor = edpsParts(snap);
    const clReach = clamp01(snap.modBonuses.run?.clHitsPerEnemy ?? 0.5);
    const bhKills = clamp01(report?.killedWithEffect.blackHole ?? 0.3);
    const share = (v: number) => Math.max(0, v) / d.total;

    // CL hits per enemy reached = shots × chance × chains ÷ enemies reached.
    const shots = report?.projectileCount ?? 0;
    const reached = report?.clHits ?? 0;
    const hitsPerEnemy = shots > 0 && reached > 0 ? (shots * anchor.clChance * anchor.clQty) / reached : Infinity;
    // Without Chain Lightning there's nothing to smite (and ∞ × 0 would be NaN).
    const smiteProcs0 = anchor.clChance > 0 ? Math.min(SMITE_CAP, hitsPerEnemy * anchor.clChance) : 0;

    // Hits an enemy took on its way in (Armored Enemies): shots × bounces,
    // plus Chain Lightning's, per enemy; the model's own count without them.
    const enemies = report?.totalEnemies ?? 0;
    const perEnemy = shots > 0 && enemies > 0
        ? (shots * anchor.hitsPerShot * (1 + anchor.clChance * anchor.clQty)) / enemies
        : hitWeight(anchor);
    const mix = runMix(report);
    const crowd = crowdFactor(snap.conditions, mix);

    const smite0 = Math.min(1, anchor.smite * smiteProcs0) * clReach;
    const consume0 = anchor.consume * bhKills;
    const shares = {
        cl: Math.max(0, share(d.chainLightning) - smite0),
        sm: share(d.smartMissiles),
        dw: share(d.deathWave),
        ilm: share(d.innerLandMines),
        ps: share(d.poisonSwamp),
        bh: Math.max(0, share(d.blackHole) - consume0),
        tower: share(d.projectiles + d.rendArmor + d.landMines),
        flame: report ? share(extraDamage(report).flameBot) : 0,
        guardian: report ? share(extraDamage(report).guardian) : 0,
        fixed: 0,
    };
    const counted = shares.cl + shares.sm + shares.dw + shares.ilm + shares.ps + shares.bh + shares.tower + shares.flame
        + shares.guardian + smite0 + consume0;
    shares.fixed = Math.max(0, 1 - counted);
    return {
        anchor, shares, clReach, smiteProcs: smiteProcs0, bhKills,
        mix, hitsPerEnemy: perEnemy, crowd, armoredHits: snap.conditions?.armoredHits ?? 0,
        fastUltimate: snap.conditions?.fastUltimate ?? 0,
        orbTouch: touchOf(snap.conditions?.orbLeftPct), deathRayTouch: touchOf(snap.conditions?.deathRayLeftPct),
    };
}

// ── Orbs and Death Ray against the enemies that end runs ──────
// Both destroy what they touch — not bosses, elites, fleets or enemies a
// Protector shields (TheTowerSDK, wiki) — and that's most of what reaches
// them: on the owner's T18 run (W9,107) orbs made 70% of the kills, with
// about one orb hit per enemy they can touch. A run that ends to an enemy
// they can touch (Basic, Fast, Tank, Ranged — the owner's Ranged enemies
// come within the orbs) ends when enough get past them, and the pressure on
// the tower is how many get past × how long each lasts there. Adding up
// the pressure: the touchable killers' share w of the deaths shrinks with
// the share that gets past (L, against the run) and the rest stays, so it
// works like 1 ÷ (1 − w + w·L) more damage — the same as w·(fewer getting
// past) for small changes, and never more than 1 ÷ (1 − w): with none
// getting past, runs end to the other enemies.
// An enemy gets past with chance e^−λ, λ the touches it can expect: read
// from the run (−ln of the share they let past, of the enemies they can
// touch), and growing with the time each enemy is in range (Chrono Field,
// CF+, Slow Aura … — longer among the orbs and in Death Ray's path). Orb /
// Death Ray Resistance makes a touch take x% of health instead of all of
// it: λ × x. Tank's Ultimate makes tanks immune. Orbs' touches also grow
// with how often orbs pass an enemy — orbs × speed × size — and Death
// Ray's with its beam time × the Double Death Ray chance (engine/orbs.ts,
// 2026-10-23). The code's model, not checked against runs yet.
const TOUCHABLE: EnemyType[] = ['Basic', 'Fast', 'Tank', 'Ranged'];
const MAX_REACH = 0.95;   // λ ≤ 3: a run's last few % aren't a measurement

const touchOf = (leftPct: number | undefined) => (leftPct !== undefined ? leftPct / 100 : 1);

// Touches per enemy they can touch, from the share the run's orbs (or Death
// Ray) destroyed.
export function touchesOf(kills: number, touchable: number): number {
    if (kills <= 0 || touchable <= 0) return 0;
    return -Math.log(1 - Math.min(MAX_REACH, kills / touchable));
}

// The share of run-ending enemies orbs and Death Ray can touch.
function touchableKillers(snap: OptimizerSnapshot): number {
    const tankImmune = !!snap.conditions?.tankUltimate;
    return (Object.entries(snap.killers ?? {}) as [EnemyType, number][])
        .filter(([type]) => TOUCHABLE.includes(type) && !(tankImmune && type === 'Tank'))
        .reduce((s, [, share]) => s + share, 0);
}

// Touches per enemy at the run, and how many more now (orbs + Death Ray).
function touches(snap: OptimizerSnapshot, calib: EdpsCalibration, x: EdpsParts): { run: number; more: number } {
    const orb0 = touchesOf(calib.mix.orbKills, calib.mix.touchable);
    const dr0 = touchesOf(calib.mix.deathRayKills, calib.mix.touchable);
    if (orb0 + dr0 <= 0) return { run: 0, more: 0 };
    const c = snap.conditions;
    const fast = fastUltimateTime(c?.fastUltimate, snap.killers) / fastUltimateTime(calib.fastUltimate, snap.killers);
    const t = timeRatio(x, calib.anchor) * fast;
    const passes = calib.anchor.orbRate > 0 ? x.orbRate / calib.anchor.orbRate : 1;
    const beams = calib.anchor.deathRayRate > 0 ? x.deathRayRate / calib.anchor.deathRayRate : 1;
    const orb = orb0 * t * passes * (calib.orbTouch > 0 ? touchOf(c?.orbLeftPct) / calib.orbTouch : 1);
    const dr = dr0 * t * beams * (calib.deathRayTouch > 0 ? touchOf(c?.deathRayLeftPct) / calib.deathRayTouch : 1);
    return { run: orb0 + dr0, more: orb - orb0 + dr - dr0 };
}

// log(damage-equivalent factor) of fewer run-ending enemies getting past
// orbs and Death Ray, against the run (0 = no change).
export function reachLog(snap: OptimizerSnapshot, calib: EdpsCalibration, x: EdpsParts): number {
    const w = touchableKillers(snap);
    if (w <= 0) return 0;
    const { more } = touches(snap, calib, x);
    return -Math.log(1 - w + w * Math.exp(-more));
}

// The share of the enemies orbs and Death Ray can touch that they stop
// (What If's chain), now and at the run.
export function reachShares(snap: OptimizerSnapshot, calib: EdpsCalibration, x: EdpsParts): { now: number; run: number } {
    const { run, more } = touches(snap, calib, x);
    return { now: 1 - Math.exp(-(run + more)), run: 1 - Math.exp(-run) };
}

// Smite on the enemies that end runs, as log(damage-equivalent factor)
// against the run (0 = no change). Each proc takes its share of the wave's
// basic enemy health (0.05% → 0.6%, up to 100 procs an enemy), the same
// share at every wave, so it doesn't fall behind as health grows: flat
// damage only has to take the rest of a run-ending enemy's health. On type
// k, Smite takes h = procs × share ÷ (k's health multiple × its health lab),
// worth 1 ÷ (1 − h) more flat damage against it. Elites, bosses and fleets
// are immune to orbs, Death Ray, Shockwave and Black Hole, not to Chain
// Lightning (TheTowerSDK), so Smite reaches them. Procs on a run-ending
// enemy: the run's average per enemy CL reached × how much longer it stays
// in range (basic speed ÷ its speed) — it lives through all of it while
// most enemies die on the way; the code's assumption (2026-10-29: What If
// had maxing Smite at +36% damage and +0.0 waves).
export function smiteLog(snap: OptimizerSnapshot, calib: EdpsCalibration, x: EdpsParts): number {
    if (x.smite <= 0 && calib.anchor.smite <= 0) return 0;
    const avg = { now: smiteProcs(x, calib.anchor, calib.smiteProcs), then: calib.smiteProcs };
    let log = 0;
    for (const [type, share] of Object.entries(snap.killers ?? {}) as [EnemyType, number][]) {
        const health = HEALTH_MULT[type] * healthLabCut(snap.labData, type);
        const took = (procs: number, smite: number) =>
            Math.min(0.95, Math.min(SMITE_CAP, procs / SPEED_RATIO[type]) * smite / Math.max(0.01, health));
        log += share * Math.log((1 - took(avg.then, calib.anchor.smite)) / (1 - took(avg.now, x.smite)));
    }
    return log;
}

// The waves score's damage parts from one read of the account: flat damage
// (edpsSurvivalScore), the reach of orbs and Death Ray (reachLog) and Smite
// on the enemies that end runs (smiteLog).
export function edpsWaves(snap: OptimizerSnapshot, calib: EdpsCalibration): { flat: number; reach: number; smite: number } {
    const x = edpsParts(snap);
    return { flat: survivalFrom(snap, calib, x), reach: reachLog(snap, calib, x), smite: smiteLog(snap, calib, x) };
}

// Relative eDPS: 1 at the calibration anchor.
export function edpsScore(snap: OptimizerSnapshot, calib: EdpsCalibration, ttt?: number): number {
    const x = edpsParts(snap, ttt);
    const a = calib.anchor;
    const s = calib.shares;
    const r = (now: number, then: number) => (then > 0 ? now / then : 1);
    const bhRatio = r(x.bh, a.bh);
    const t = timeRatio(x, a);
    const k = conditionRatios(snap, calib, x);
    const rest = (s.cl * r(x.cl, a.cl) * t * k.targeted
        + s.sm * r(x.sm, a.sm) * k.targeted
        + s.dw * r(x.dw, a.dw)
        + s.ilm * r(x.ilm, a.ilm)
        + s.ps * r(x.ps, a.ps)
        + s.tower * r(x.tower, a.tower) * t * k.targeted
        + s.flame * r(x.flame, a.flame)) * k.flat
        + s.bh * bhRatio
        + s.fixed
        + Math.min(1, x.smite * smiteProcs(x, a, calib.smiteProcs)) * calib.clReach
        + x.consume * clamp01(calib.bhKills * bhRatio);
    // Attack: its rate × the health the rest of the damage takes off.
    const lost = 1 - s.guardian > 0 ? rest / (1 - s.guardian) : 1;
    return rest + s.guardian * r(x.attack, a.attack) * lost;
}

// Guardian Attack's damage now ÷ at the anchor, given the flat damage's
// ratio (the health its targets have lost).
export const attackRatio = (x: EdpsParts, a: EdpsParts, flatRatio: number) =>
    (a.attack > 0 ? x.attack / a.attack : 1) * flatRatio;

// How far a Glass Cannon run gets depends only on FLAT damage — Chain
// Lightning, Smart Missiles, Death Wave, Inner Land Mines, Poison Swamp and
// tower shots. Orbs (on Orb Resistance tiers), Black Hole, Smite and Consume
// deal a share of an enemy's health, so they don't fall behind as enemies get
// tougher; and the enemies that end GC runs (elites, fleets, bosses) are
// immune to orbs and Black Hole anyway (docs/run-simulation.md). Guardian
// Attack deals a share of the health flat damage took off, so it keeps pace
// with flat damage and counts with it.
// Relative flat damage, 1 at the anchor; feeds runLength's waves gained.
export function edpsSurvivalScore(snap: OptimizerSnapshot, calib: EdpsCalibration, ttt?: number): number {
    return survivalFrom(snap, calib, edpsParts(snap, ttt));
}

function survivalFrom(snap: OptimizerSnapshot, calib: EdpsCalibration, x: EdpsParts): number {
    const a = calib.anchor;
    const s = calib.shares;
    const flat = s.cl + s.sm + s.dw + s.ilm + s.ps + s.tower + s.flame;
    if (flat <= 0) return 1;
    const f = flatDamageRatio(x, a, s, conditionRatios(snap, calib, x));
    return (flat * f + s.guardian * attackRatio(x, a, f)) / (flat + s.guardian);
}

// The flat sources' damage now ÷ at the anchor (Guardian Attack's targets'
// lost health; What If splits waves by it too).
export function flatDamageRatio(
    x: EdpsParts, a: EdpsParts, s: EdpsCalibration['shares'], k: ConditionRatios = SAME,
): number {
    const flat = s.cl + s.sm + s.dw + s.ilm + s.ps + s.tower + s.flame;
    if (flat <= 0) return 1;
    const r = (now: number, then: number) => (then > 0 ? now / then : 1);
    const t = timeRatio(x, a);
    return ((s.cl * r(x.cl, a.cl) * t + s.sm * r(x.sm, a.sm) + s.tower * r(x.tower, a.tower) * t) * k.targeted
        + s.dw * r(x.dw, a.dw) + s.ilm * r(x.ilm, a.ilm) + s.ps * r(x.ps, a.ps) + s.flame * r(x.flame, a.flame))
        * k.flat / flat;
}
