// ============================================================
//  TowerForge Companion — Run length (run simulator, step 2)
//  How far a run gets, and how many waves more damage (Glass Cannon) or
//  more survival (eHP), or more level skip, would buy.
//
//  A GC tower dies to the first enemy that reaches it (one hit takes
//  all its health; Death Defy, Energy Shield and the wall only absorb a
//  few). So a run ends at the wave where enemies are too tough to kill
//  before they arrive: enemy health ÷ the tower's damage crosses a fixed
//  point. Enemy speed is capped by then, so that point doesn't move —
//  more damage moves the death wave to where enemy health has grown by
//  the same factor.
//
//  - Enemy health at death: the basic enemy at the run's own stat level
//    (wave − health levels skipped), by the formula checked against the
//    game (engine/enemyStats.ts). Only ratios matter, so perks and labs
//    that scale every enemy the same cancel out.
//  - Your limit: the geometric mean of that health over your latest
//    deaths on one tier (each run is a little luckier or unluckier).
//  - Level skips are deterministic, so health level = wave × (1 − rate).
//  Attack levels don't matter here: any hit is lethal either way.
//
//  eHP (`stat: 'attack'`): an eHP tower takes the hits, so its run ends
//  where enemy ATTACK outgrows what it can take — health, healing and
//  defense (engine/ehp.ts). Same model, on the basic enemy's attack at
//  the run's attack level (wave − AttackLevelSkips) and Enemy Attack
//  Level Skip: more survival moves the death wave to where enemy attack
//  has grown by the same factor. Checked on eHP players' saved runs
//  (2026-10-23, docs/run-simulation.md): where damage taken ≈ healing,
//  the attack at death holds steady run to run and tier to tier (one
//  account: within ×1.6 from T7 to T12, while enemy health at death
//  differed by thousands of times). Campaign only — the tournament attack
//  curve isn't known.
//  Pure functions — no store imports.
// ============================================================

import type { BattleReport } from './battleReport';
import { isDissonantRun } from './battleReport';
import { baseEnemyDamage, baseEnemyHealth } from './enemyStats';
import type { EnemyType } from './enemyStats';

// What ended a run (the game's KilledBy number): its enemy-type order.
// −1, 99 and 255 mean nothing killed the tower — the player ended the run.
const KILLED_BY = ['Basic', 'Fast', 'Tank', 'Boss', 'Ranged', 'Protector', 'Vampire',
    'Scatter', 'Scatter', 'Ray', 'Saboteur', 'Commander', 'Overcharge'];

export function killedBy(run: BattleReport): string | null | undefined {
    const raw = run.raw?.KilledBy;
    if (typeof raw !== 'number') return undefined;         // not stored for this run
    return KILLED_BY[raw] ?? null;                          // null = quit
}

// Enemy levels skipped in a run, by whatever the game named the field
// (HealthLevelSkips / AttackLevelSkips in current exports).
export function runLevelSkips(run: BattleReport): { health: number; attack: number } | null {
    const raw = run.raw ?? {};
    const find = (stat: 'health' | 'attack') => {
        const key = Object.keys(raw).find(k => {
            const l = k.toLowerCase();
            return l.includes(stat) && l.includes('level') && l.includes('skip') && typeof raw[k] === 'number';
        });
        return key ? (raw[key] as number) : null;
    };
    const health = find('health');
    const attack = find('attack');
    return health !== null && attack !== null ? { health, attack } : null;
}

// What ends the runs: enemy health outgrowing the tower's damage (Glass
// Cannon) or enemy attack outgrowing its survival (eHP).
export type RunStat = 'health' | 'attack';

export interface RunEnd {
    index: number;            // into the runs passed in
    run: BattleReport;
    killer: string | null | undefined;   // enemy type; null = quit; undefined = not recorded
    healthLevel: number | null;
    enemyHealth: number | null;          // basic enemy at death (base formula)
    attackLevel: number | null;
    enemyAttack: number | null;          // basic enemy's attack at death (campaign only)
}

export function runEnds(runs: BattleReport[]): RunEnd[] {
    return runs.map((run, index) => {
        const skips = runLevelSkips(run);
        const healthLevel = skips ? Math.max(1, run.wave - skips.health) : null;
        const attackLevel = skips ? Math.max(1, run.wave - skips.attack) : null;
        return {
            index, run,
            killer: killedBy(run),
            healthLevel,
            enemyHealth: healthLevel !== null ? baseEnemyHealth(healthLevel, run.tier, run.tournament) : null,
            attackLevel,
            enemyAttack: attackLevel !== null && !run.tournament ? baseEnemyDamage(attackLevel, run.tier) : null,
        };
    });
}

// The stat's level and value at a death.
const levelOf = (d: RunEnd, stat: RunStat) => (stat === 'attack' ? d.attackLevel : d.healthLevel);
const valueOf = (d: RunEnd, stat: RunStat) => (stat === 'attack' ? d.enemyAttack : d.enemyHealth);
const statAt = (level: number, tier: number, tournament: boolean, stat: RunStat) =>
    (stat === 'attack' ? baseEnemyDamage(level, tier) : baseEnemyHealth(level, tier, tournament));

// Waves until the basic enemy's health (or attack) reaches `limit`, skipping
// `skipRate` of its levels (both only rise with the wave, so a halving search works).
export function deathWave(limit: number, tier: number, skipRate: number, tournament = false, stat: RunStat = 'health'): number {
    const healthAt = (w: number) => statAt(Math.max(1, w - Math.floor(w * skipRate)), tier, tournament, stat);
    let lo = 1;
    let hi = 1;
    while (healthAt(hi) < limit && hi < 1e6) hi *= 2;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (healthAt(mid) >= limit) hi = mid; else lo = mid + 1;
    }
    return lo;
}

export interface RunLengthModel {
    stat: RunStat;            // what ends the runs: enemy health (GC) or attack (eHP)
    tier: number;
    tournament: boolean;      // built from tournament deaths, on the tournament curve
    used: RunEnd[];           // the deaths the model works from (newest first)
    limit: number;            // their typical basic-enemy health (or attack) at death (geometric mean)
    skipRate: number;         // health (or attack) levels skipped per wave (newest of those runs)
    typicalWave: number;      // the average wave they ended on
}

const RECENT_DEATHS = 5;

// Which deaths to learn from: campaign or tournament runs (they scale
// differently), and on campaign a tier — the chosen run's when it has
// deaths, else the tier you've played the most waves to a death on.
export interface RunPick {
    tournament?: boolean;
    tier?: number;
    stat?: RunStat;           // default 'health' (Glass Cannon)
}

// eHP histories hold many short runs that ended some other way (a try at
// a higher tier, another build): the eHP model leaves out deaths short of
// this share of the recent ones' median wave.
const SHORT_RUN = 0.6;

// The newest deaths of the picked kind.
export function buildRunLengthModel(runs: BattleReport[], pick: RunPick = {}): RunLengthModel | null {
    const tournament = !!pick.tournament;
    const stat = pick.stat ?? 'health';
    if (stat === 'attack' && tournament) return null;
    const deaths = runEnds(runs).filter(e =>
        e.killer !== null && valueOf(e, stat) !== null && e.run.tournament === tournament && e.run.wave > 1 && !isDissonantRun(e.run));
    if (deaths.length === 0) return null;
    // The usual tier: the most waves played to a death, so a string of quick
    // tries at a higher tier doesn't outweigh the runs you really play.
    const byTier = new Map<number, number>();
    for (const d of deaths) byTier.set(d.run.tier, (byTier.get(d.run.tier) ?? 0) + d.run.wave);
    const tier = pick.tier !== undefined && byTier.has(pick.tier)
        ? pick.tier
        : [...byTier.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    let onTier = deaths.filter(d => d.run.tier === tier)
        .sort((a, b) => (b.run.time ?? b.index) - (a.run.time ?? a.index));
    if (stat === 'attack') {
        const waves = onTier.slice(0, RECENT_DEATHS).map(d => d.run.wave).sort((a, b) => a - b);
        const median = waves[Math.floor(waves.length / 2)];
        onTier = onTier.filter(d => d.run.wave >= SHORT_RUN * median);
    }
    const used = onTier.slice(0, RECENT_DEATHS);
    const limit = Math.exp(used.reduce((s, d) => s + Math.log(valueOf(d, stat)!), 0) / used.length);
    return {
        stat, tier, tournament, used, limit,
        skipRate: 1 - levelOf(used[0], stat)! / used[0].run.wave,
        typicalWave: Math.round(used.reduce((s, d) => s + d.run.wave, 0) / used.length),
    };
}

// Do the model's runs end to single hits far beyond what the tower can take?
// The game counts each hit in full, the killing one too, so when damage
// taken is many times the run's whole healing, one hit did it — as in a
// Glass Cannon run, where enemy health decides the end, not attack. On
// eHP players' runs (2026-10-23) it was ~1× where hits wore the tower
// down, ~10⁶× and more where single hits ended runs. null = not recorded.
const ONE_HIT = 100;

export function oneHitEnds(m: RunLengthModel): boolean | null {
    const ratios = m.used.flatMap(d => {
        const raw = d.run.raw ?? {};
        const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
        if (typeof raw.DamageTaken !== 'number') return [];
        const healed = n('TowerHealthRegen') + n('WallHealthRegen') + n('RecoveryPackagesRegen') + n('Lifesteal')
            + n('HealthFromDeathWaveThisRound');
        return healed > 0 ? [n('DamageTaken') / healed] : [];
    }).sort((a, b) => a - b);
    return ratios.length ? ratios[Math.floor(ratios.length / 2)] > ONE_HIT : null;
}

// The enemies that ended the model's runs, as shares (Scatter split counts
// as Scatter); deaths without a recorded killer are left out.
export function killerMix(m: RunLengthModel): Partial<Record<EnemyType, number>> {
    const killers = m.used.map(d => d.killer).filter((k): k is string => typeof k === 'string');
    const mix: Partial<Record<EnemyType, number>> = {};
    for (const k of killers) mix[k as EnemyType] = (mix[k as EnemyType] ?? 0) + 1 / killers.length;
    return mix;
}

// Enemy health doesn't rise smoothly: at some levels several of the
// formula's steps land together and it jumps 30–40% in one wave (a wall).
// So each death is moved from where it really was, at that run's own skip
// rate, and the moves are averaged — rather than from one averaged limit,
// which could sit right on a wall.
const startWaves = new WeakMap<RunLengthModel, number[]>();

// A death's own skip rate for the model's stat.
const rateOf = (m: RunLengthModel, d: RunEnd) => 1 - levelOf(d, m.stat)! / d.run.wave;
// Where a death lands with its limit × `factor`, at a skip rate.
const landsAt = (m: RunLengthModel, d: RunEnd, factor: number, rate: number) =>
    deathWave(valueOf(d, m.stat)! * factor, m.tier, Math.max(0, Math.min(0.99, rate)), m.tournament, m.stat);

function averageMove(m: RunLengthModel, healthFactor: number, extraSkip: number): number {
    let from = startWaves.get(m);
    if (!from) {
        from = m.used.map(d => landsAt(m, d, 1, rateOf(m, d)));
        startWaves.set(m, from);
    }
    const moves = m.used.map((d, i) => landsAt(m, d, healthFactor, rateOf(m, d) + extraSkip) - from[i]);
    return moves.reduce((a, b) => a + b, 0) / moves.length;
}

// Waves gained if the tower's damage (eHP: survival) rose by `gain` (0.1 = +10%).
export function wavesFromDamage(m: RunLengthModel, gain: number): number {
    return averageMove(m, 1 + gain, 0);
}

// Waves gained if `points` more percent of health (eHP: attack) levels were skipped.
export function wavesFromSkip(m: RunLengthModel, points: number): number {
    return averageMove(m, 1, points / 100);
}

// What one point of Enemy Health Level Skip is worth in flat damage: the log
// of the damage factor that gains the same waves. Both move the death wave,
// so this puts skip and damage upgrades on one scale (the optimizer ranks
// workshop and labs by it). On the attack model (eHP): a point of Enemy
// Attack Level Skip, in survival. Measured over +50% damage and 2 skip points, so
// single health walls don't swing it.
const WORTH_DAMAGE = 0.5;
const WORTH_SKIP = 2;

export function skipWorth(m: RunLengthModel): number {
    const perLogDamage = wavesFromDamage(m, WORTH_DAMAGE) / Math.log(1 + WORTH_DAMAGE);
    return perLogDamage > 0 ? wavesFromSkip(m, WORTH_SKIP) / WORTH_SKIP / perLogDamage : 0;
}

// A run's limit varies a little with luck, so along an upgrade path the
// death wave is averaged over ±10% damage (9 points): a single step then
// shows its share of the waves, not 0 short of a wall and a whole wall once
// across it. A whole path's total barely changes.
const LUCK = Math.log(1.1);
const LUCK_POINTS = 9;

function luckyWaves(m: RunLengthModel, logGain: number, points: number): number {
    let sum = 0;
    for (let k = 0; k < LUCK_POINTS; k++) {
        const spread = -LUCK + (2 * LUCK * k) / (LUCK_POINTS - 1);
        sum += averageMove(m, Math.exp(logGain + spread), points / 100);
    }
    return sum / LUCK_POINTS;
}

// The waves a gain buys from each recent death on its own (luck-averaged
// like the path rows; their mean is what pathRunGains shows), and the waves
// those runs ended on — how much an upgrade varies from run to run, and
// how much runs vary anyway. Inputs as pathRunGains: the gain in % with any
// skip already counted in it at `worth`, and the skip points.
export function wavesSpread(
    m: RunLengthModel, gainPct: number, skipPoints: number, worth: number,
): { moves: number[]; ended: number[] } {
    const points = Math.max(0, skipPoints);
    const logGain = Math.max(0, Math.log(1 + Math.max(0, gainPct) / 100) - worth * points);
    const moves = m.used.map(d => {
        const rate = rateOf(m, d);
        let moved = 0;
        let start = 0;
        for (let k = 0; k < LUCK_POINTS; k++) {
            const spread = -LUCK + (2 * LUCK * k) / (LUCK_POINTS - 1);
            moved += landsAt(m, d, Math.exp(logGain + spread), rate + points / 100);
            start += landsAt(m, d, Math.exp(spread), rate);
        }
        return (moved - start) / LUCK_POINTS;
    });
    return { moves, ended: m.used.map(d => d.run.wave) };
}

// Waves gained (or lost, below 0) from a change that can go either way —
// battle conditions: `logDamage` is the log of the flat-damage factor
// (less damage < 0), `points` skip points (less skip < 0). Luck-averaged
// like the path rows.
export function runWavesChange(m: RunLengthModel, logDamage: number, points: number): number {
    return luckyWaves(m, logDamage, points) - luckyWaves(m, 0, 0);
}

// Waves (and coins per run, when `coinsAt` gives coins for a run to a wave)
// each step of an upgrade path adds. `gainsPct` are the steps' flat-damage
// gains in %, each on top of the steps before it, so they compound.
// A step that also adds skip (`skipPoints`) had it counted in its gain at
// `worth` (skipWorth); that part comes back out and moves the death wave as
// skip, so it shows the same waves as in the level skip path.
export interface StepRunGain {
    waves: number;
    coins: number | null;     // fractional change in coins per run
}

export function pathRunGains(
    m: RunLengthModel, gainsPct: number[], coinsAt?: (wave: number) => number,
    skipPoints: number[] = [], worth = 0,
): StepRunGain[] {
    let logGain = 0;
    let points = 0;
    const start = luckyWaves(m, 0, 0);
    let prevWaves = 0;
    let prevCoins = coinsAt ? coinsAt(m.typicalWave) : 0;
    return gainsPct.map((g, i) => {
        const skip = Math.max(0, skipPoints[i] ?? 0);
        logGain += Math.max(0, Math.log(1 + Math.max(0, g) / 100) - worth * skip);
        points += skip;
        const waves = luckyWaves(m, logGain, points) - start;
        const coins = coinsAt ? coinsAt(m.typicalWave + Math.round(waves)) : 0;
        const step = {
            waves: waves - prevWaves,
            coins: coinsAt && prevCoins > 0 ? coins / prevCoins - 1 : null,
        };
        prevWaves = waves;
        prevCoins = coins;
        return step;
    });
}

// The same for a path of Enemy Health Level Skip upgrades: `pointsPerStep`
// are skip-chance points, which add up along the path.
export function pathSkipGains(
    m: RunLengthModel, pointsPerStep: number[], coinsAt?: (wave: number) => number,
): StepRunGain[] {
    let points = 0;
    let prevWaves = 0;
    let prevCoins = coinsAt ? coinsAt(m.typicalWave) : 0;
    return pointsPerStep.map(p => {
        points += Math.max(0, p);
        const waves = wavesFromSkip(m, points);
        const coins = coinsAt ? coinsAt(m.typicalWave + Math.round(waves)) : 0;
        const step = { waves: waves - prevWaves, coins: coinsAt && prevCoins > 0 ? coins / prevCoins - 1 : null };
        prevWaves = waves;
        prevCoins = coins;
        return step;
    });
}
