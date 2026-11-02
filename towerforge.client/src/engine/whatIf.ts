// ============================================================
//  TowerForge Companion — What if
//  Change any levels (UWs, UW+, workshop, labs, enhancements, module
//  slots, bots) on a copy of the account and see what it does to every
//  model at once: all damage, waves reached, coins per hour, coins per
//  run and survival — and what the changes cost.
//
//  Every score is calibrated on the account as it is now (the chosen
//  Battle Report), then read on the changed copy, so "now" is always 1.
//  Waves and coins per run go through Run Length and Coins per Run.
//
//  Tournament mode (GoalModels.calibConditions / conditionsAt): calibrated
//  under the battle conditions the last tournament had, scored under this
//  week's, each read at the wave the run ends — settled, since a change
//  that goes further meets stronger conditions (engine/tournamentModel.ts).
//
//  Nothing acts alone, so the result also lists every link that moved on
//  the way (`chain`): range, slows and Chrono Loop → time each enemy spends
//  in range → each damage source per enemy (with its share of your damage)
//  → push → waves → coins per run and per hour, alongside the coin bonuses
//  an upgrade changes directly.
//  Pure functions — no store imports.
// ============================================================

import { LABS, UWS, UW_PLUS_DATA, UW_PLUS_UNLOCK_COSTS, UW_STONE_COSTS, WS_ENH, WS_STATS } from '../constants/gameData';
import { BOTS_CONFIG, isBotPlusOwned } from '../constants/botData';
import type { BuildType, ModuleType, OptCurrency } from '../types/gameTypes';
import type { OptimizerSnapshot } from './optimizer';
import { goalScore } from './optimizer';
import { applyGoal } from './accountModels';
import type { GoalModels } from './accountModels';
import type { OptGoal } from '../constants/optimizerConfig';
import type { BattleReport } from './battleReport';
import { readActiveModuleBonuses } from './modBonuses';
import { freeFillText, inRunLevels, statsInRun } from './freeUpgrades';
import { attackSkipSources, healthSkipChance, healthSkipSources } from './levelSkip';
import { readEhpInputs } from './ehp';
import { deathRayRate, orbStats } from './orbs';
import { cellsPerRun } from './cells';
import { activeChips, bountyExtra, damageMeterFactor, fetchRate, summonExtra, withChipLevel } from './guardian';
import { calcDamageMeter, echoingShotBullets } from './towerDamage';
import { CHIPS, statBits } from '../constants/guardianData';
import { conditioned, conditionedSkip } from './battleConditions';
import { settleGain } from './tournamentModel';
import { killerMix, pathRunGains, wavesSpread } from './runLength';
import { calcTTTDisplayStats } from './ttt';
import { buildDamageContext } from './uwdps';
import {
    attackRatio, buildEdpsCalibration, conditionRatios, edpsParts, edpsSurvivalScore, edpsWaves, flatDamageRatio, reachShares,
} from './edps';
import { buildFarmCalibration, coinFactors, FARM_EFFECTS, FARM_EFFECT_LABELS } from './farming';
import { attackLabCut, healthLabCut } from './enemyStats';
import { deathDefyChance, hitsSurvived, saverAverages } from './runSavers';
import type { EnemyType } from './enemyStats';
import {
    botMedalCost, botPlusMedalCost, enhancementCost, enhancementDiscount, labLevelCost, MODULE_SLOT_MAX, moduleSlotCost,
    workshopCost, workshopDiscount,
} from './upgradeCosts';

export type ChangeKind = 'uw' | 'uwp' | 'workshop' | 'lab' | 'enhancement' | 'module' | 'bot' | 'guardian';

// Something the page can set a level on.
export interface UpgradeTarget {
    kind: ChangeKind;
    key: string;          // what applyChange reads (e.g. "CL|0", "attack|0", "cannon|main")
    group: string;        // the picker's first list
    label: string;
    current: number;
    max: number;
}

export interface Change {
    kind: ChangeKind;
    key: string;
    level: number;
}

const SECTIONS = ['attack', 'defense', 'utility'] as const;
const MODULE_TYPES: ModuleType[] = ['cannon', 'armor', 'generator', 'core'];
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

// Everything the account can change, with its level now and its max.
export function upgradeTargets(snap: OptimizerSnapshot): UpgradeTarget[] {
    const out: UpgradeTarget[] = [];
    for (const uw of UWS) {
        const d = snap.uwData.data[uw.a];
        if (!d?.own) continue;
        uw.s.forEach(([stat, max], i) => out.push({
            kind: 'uw', key: `${uw.a}|${i}`, group: 'Ultimate Weapons', label: `${uw.n} — ${stat}`,
            current: d.sv[i] ?? 1, max,
        }));
        // Level n = upLvl n − 1 (0 = locked); upLvl runs 0 … upMax, so the
        // top level is upMax + 1 (Chrono Loop: 14 levels, 0.10 → 0.75).
        if (UW_PLUS_DATA[uw.a]) out.push({
            kind: 'uwp', key: uw.a, group: 'UW+', label: `${uw.n}+ — ${uw.up}`,
            current: d.upOwn ? (d.upLvl ?? 0) + 1 : 0, max: uw.upMax + 1,
        });
    }
    for (const sec of SECTIONS) {
        WS_STATS[sec].forEach(([name, max], i) => out.push({
            kind: 'workshop', key: `${sec}|${i}`, group: `Workshop — ${cap(sec)}`, label: name,
            current: snap.wsData[snap.presetIdx]?.[sec]?.[i] ?? 0, max,
        }));
    }
    for (const g of LABS) {
        for (const [name, max] of g.l) out.push({
            kind: 'lab', key: name, group: `Labs — ${g.c}`, label: name, current: snap.labData[name] ?? 0, max,
        });
    }
    for (const sec of SECTIONS) {
        WS_ENH[sec].forEach(([name, max], i) => {
            if (!snap.enhData.u?.[sec]?.[i]) return;
            out.push({
                kind: 'enhancement', key: `${sec}|${i}`, group: 'Enhancements', label: `${cap(sec)} — ${name}`,
                current: snap.enhData.d?.[sec]?.[i] ?? 0, max,
            });
        });
    }
    for (const type of MODULE_TYPES) {
        for (const pos of ['main', 'assist'] as const) out.push({
            kind: 'module', key: `${type}|${pos}`, group: 'Module slots', label: `${cap(type)} — ${cap(pos)} slot`,
            current: snap.moduleState.slotLevels?.[type]?.[pos] ?? 0, max: MODULE_SLOT_MAX,
        });
    }
    for (const bot of BOTS_CONFIG) {
        const e = snap.botData[bot.name];
        if (!e?.owned) continue;
        bot.stats.forEach((st, i) => out.push({
            kind: 'bot', key: `${bot.name}|${i}`, group: 'Bots', label: `${bot.name} — ${st.label}`,
            current: e.medals?.[i] ?? 0, max: st.values.length,
        }));
        // Bot+ levels once it's unlocked (the 1,250-stone unlock isn't offered).
        if (isBotPlusOwned(e)) out.push({
            kind: 'bot', key: `${bot.name}|plus`, group: 'Bots', label: `${bot.name}+ — ${bot.plus.label}`,
            current: e.plusLv ?? 0, max: bot.plusMax,
        });
    }
    // Guardian: the chips this preset's Guardian preset has equipped.
    for (const a of activeChips(snap.guardian, snap.presetIdx)) {
        a.chip.stats.forEach((st, k) => out.push({
            kind: 'guardian', key: `${a.chip.index}|${k}`, group: 'Guardian chips', label: `${a.chip.name} — ${st.name}`,
            current: a.levels[k], max: st.max,
        }));
    }
    return out;
}

// Sets one level on a snapshot (in place).
export function applyChange(snap: OptimizerSnapshot, c: Change): void {
    const [a, b] = c.key.split('|');
    switch (c.kind) {
        case 'uw': {
            const d = snap.uwData.data[a as keyof typeof snap.uwData.data];
            if (d) d.sv[Number(b)] = c.level;
            break;
        }
        case 'uwp': {
            const d = snap.uwData.data[a as keyof typeof snap.uwData.data];
            if (!d) break;
            d.upOwn = c.level > 0;
            d.upLvl = Math.max(0, c.level - 1);
            break;
        }
        case 'workshop': {
            const ws = snap.wsData[snap.presetIdx];
            if (ws) ws[a as typeof SECTIONS[number]][Number(b)] = c.level;
            break;
        }
        case 'lab':
            snap.labData[c.key] = c.level;
            break;
        case 'enhancement': {
            if (!snap.enhData.d[a]) snap.enhData.d[a] = [];
            snap.enhData.d[a][Number(b)] = c.level;
            break;
        }
        case 'module': {
            const levels = snap.moduleState.slotLevels ?? ({} as NonNullable<typeof snap.moduleState.slotLevels>);
            levels[a as ModuleType] = { ...(levels[a as ModuleType] ?? { main: 0, assist: 0 }), [b]: c.level };
            snap.moduleState.slotLevels = levels;
            break;
        }
        case 'bot': {
            const e = snap.botData[a];
            if (!e) break;
            if (b === 'plus') {
                snap.botData[a] = { ...e, plusLv: c.level };
                break;
            }
            const medals = [...(e.medals ?? [])];
            medals[Number(b)] = c.level;
            snap.botData[a] = { ...e, medals };
            break;
        }
        case 'guardian':
            if (snap.guardian) snap.guardian = withChipLevel(snap.guardian, snap.presetIdx, Number(a), Number(b), c.level);
            break;
    }
}

export type Costs = Partial<Record<OptCurrency, number>>;

// What raising a level costs (lowering refunds nothing here). Unknown
// prices are left out.
export function changeCost(snap: OptimizerSnapshot, t: UpgradeTarget, level: number): Costs {
    const from = t.current;
    if (level <= from) return {};
    const [a, b] = t.key.split('|');
    switch (t.kind) {
        case 'uw': {
            // Level 1 comes with the UW; reaching level L costs costs[L − 2].
            const costs = UW_STONE_COSTS[a as keyof typeof UW_STONE_COSTS]?.[Number(b)] ?? [];
            let stones = 0;
            for (let l = from + 1; l <= level; l++) stones += costs[l - 2] ?? 0;
            return { stones };
        }
        case 'uwp': {
            const plus = UW_PLUS_DATA[a as keyof typeof UW_PLUS_DATA];
            if (!plus) return {};
            let stones = 0;
            if (from === 0) {
                const unlocked = UWS.filter(u => snap.uwData.data[u.a]?.upOwn).length;
                stones += UW_PLUS_UNLOCK_COSTS[unlocked] ?? 0;
            }
            // UW+ level n (upLvl n − 1) → n + 1 costs costs[n − 1].
            for (let n = Math.max(1, from); n < level; n++) stones += plus.costs[n - 1] ?? 0;
            return { stones };
        }
        case 'workshop': {
            const coins = workshopCost(t.label, from, level, workshopDiscount(snap.labData, a as typeof SECTIONS[number]));
            return coins === null ? {} : { coins };
        }
        case 'lab': {
            let coins = 0;
            let research = 0;
            for (let l = from + 1; l <= level; l++) {
                const lv = labLevelCost(t.key, l, snap.labData, snap.relicData, snap.labProgress);
                if (!lv) return {};
                coins += lv.coins;
                research += lv.hours;
            }
            return { coins, research };
        }
        case 'enhancement': {
            const name = WS_ENH[a]?.[Number(b)]?.[0];
            const coins = name ? enhancementCost(name, from, level, enhancementDiscount(snap.labData, a as typeof SECTIONS[number])) : null;
            return coins === null ? {} : { coins };
        }
        case 'module': {
            const { shards, coins } = moduleSlotCost(from, level, snap.labData);
            return { shards, coins };
        }
        case 'bot': {
            if (b !== 'plus') return { medals: botMedalCost(from, level) };
            const bot = BOTS_CONFIG.find(x => x.name === a);
            return bot ? { medals: botPlusMedalCost(from, level, bot.plus.costStep) } : {};
        }
        case 'guardian': {
            const stat = CHIPS.find(c => c.index === Number(a))?.stats[Number(b)];
            return stat ? { bits: statBits(stat, from, level) } : {};
        }
    }
}

// One link in the chain: a quantity before and after. `kind` says how to
// show it; `share` is that damage source's share of the run's damage.
export interface ChainLink {
    group: 'Enemies in range' | 'Tower' | 'Damage to each enemy' | 'Survival' | 'Level skip' | 'Run savers' | 'Coin bonuses';
    label: string;
    before: number;
    after: number;
    kind: 'seconds' | 'meters' | 'percent' | 'times' | 'perSecond' | 'count' | 'points';
    share?: number;
    waves?: number;     // this link's part of the waves gained (damage sources, skip, enemy health labs)
}

// What the push gain is made of, to split the waves between the links:
// waves ∝ log of each part (flat damage, level skip, killers' health labs,
// run-ending enemies orbs and Death Ray stop).
interface WaveSplit {
    waves: number;
    damage: number;       // flat damage ratio, where the changed run ends
    damageStart: number;  // the same under the conditions where runs end now (tournaments: the rest is
                          // the stronger battle conditions further into the run)
    skipLog: number;      // skip points × skipWorth
    killerLog: number;    // log of the killers' health-lab factor
    reachLog: number;     // fewer run-ending enemies past orbs and Death Ray (edps.reachLog)
    smiteLog: number;     // Smite's share of the run-ending enemies' health (edps.smiteLog)
}

export interface WhatIfResult {
    damagePct: number;                 // all damage (calibrated eDPS when the report has damage by source)
    pushPct: number;                   // flat damage + skip as damage (what moves a Glass Cannon death wave)
    skipPoints: number;                // level skip points added: health (GC) or attack (eHP)
    skipKind: 'health' | 'attack';
    waves: { from: number; to: number; gained: number } | null;   // gained: unrounded (to = from + gained, rounded)
    coinsHourPct: number;              // coin income at the same wave (coin bonuses only)
    coinsRun: { from: number; to: number } | null;
    coinsHour: { from: number; to: number } | null;   // playing each run to its end
    cellsRun: { from: number; to: number } | null;    // elite cells on the chosen run, at the same waves (cells.ts)
    survivalPct: number | null;        // eHP (not Glass Cannon)
    chain: ChainLink[];
    perChange: { kind: ChangeKind; key: string; waves: number }[];   // each change on its own
    // Run to run: the waves gained from each recent death on its own, and
    // the waves those runs ended on.
    spread: { min: number; max: number; endedMin: number; endedMax: number; runs: number; tournament: boolean } | null;
    costs: Costs;
    freeNotes: string[];               // workshop stats changed that free upgrades take to their max anyway
}

const ratioPct = (after: number, before: number) => (before > 0 ? (after / before - 1) * 100 : 0);

// Score of `after` against `before` for one goal, both calibrated on `before`.
function goalPct(
    before: OptimizerSnapshot, after: OptimizerSnapshot, goal: OptGoal, build: BuildType,
    report: BattleReport | null, models: GoalModels,
): number {
    const b = JSON.parse(JSON.stringify(before)) as OptimizerSnapshot;
    applyGoal(b, goal, build, report, models);
    const a = { ...after, farm: b.farm, ehp: b.ehp, edps: b.edps, metric: b.metric, edpsMode: b.edpsMode,
        blend: b.blend, skipWorth: b.skipWorth, killers: b.killers, conditions: after.conditions ?? b.conditions };
    return ratioPct(goalScore(a), goalScore(b));
}

// Everything between a change and its result, for both snapshots; links
// that didn't move are left out.
function buildChain(
    rawBase: OptimizerSnapshot, rawAfter: OptimizerSnapshot, build: BuildType,
    report: BattleReport | null, models: GoalModels, split: WaveSplit | null,
): ChainLink[] {
    // The levels a run reaches, like the scores above.
    const base = inRunLevels(rawBase);
    const after = inRunLevels(rawAfter);
    // A part's share of the waves, by its log against the whole gain's.
    const totalLog = split ? Math.log(split.damage) + split.skipLog + split.killerLog + split.reachLog + split.smiteLog : 0;
    const wavesOf = (log: number) => (split && Math.abs(totalLog) > 1e-12 ? (split.waves * log) / totalLog : undefined);
    const links: ChainLink[] = [];
    const add = (l: ChainLink) => {
        const moved = l.kind === 'points' || l.kind === 'count'
            ? Math.abs(l.after - l.before) > 1e-6
            : l.before !== 0 ? Math.abs(l.after / l.before - 1) > 1e-5 : l.after !== 0;
        if (moved) links.push(l);
    };
    // Read under the battle conditions they're scored under (tournaments).
    const cond = (s: OptimizerSnapshot) => conditioned({ ...s, conditions: s.conditions ?? models.conditions });
    const tt = (s: OptimizerSnapshot) => calcTTTDisplayStats(s.presetIdx, s.wsData, s.labData, s.cardData, s.uwData, cond(s).modBonuses);
    const [t0, t1] = [tt(base), tt(after)];
    add({ group: 'Enemies in range', label: 'Tower range', before: t0.range, after: t1.range, kind: 'meters' });
    add({ group: 'Enemies in range', label: 'Chrono Field uptime', before: t0.cfUptime * 100, after: t1.cfUptime * 100, kind: 'percent' });
    add({ group: 'Enemies in range', label: 'Slow (Chrono Field + Slow Aura)', before: t0.cappedSlowPct, after: t1.cappedSlowPct, kind: 'percent' });
    add({ group: 'Enemies in range', label: 'Chrono Loop (CF+) extra path', before: t0.cfPathMult, after: t1.cfPathMult, kind: 'times' });
    add({ group: 'Enemies in range', label: 'Time each enemy is in range', before: t0.ttt, after: t1.ttt, kind: 'seconds' });
    // Orbs passing an enemy: orbs × rotations a minute × size (engine/orbs.ts).
    const [o0, o1] = [orbStats(base), orbStats(after)];
    add({ group: 'Enemies in range', label: 'Orbs', before: o0.orbs + o0.extraOrbs, after: o1.orbs + o1.extraOrbs, kind: 'count' });
    add({ group: 'Enemies in range', label: 'Orb speed (rotations a minute)', before: o0.speed, after: o1.speed, kind: 'count' });
    add({ group: 'Enemies in range', label: 'Orb size', before: o0.size, after: o1.size, kind: 'times' });
    add({ group: 'Enemies in range', label: 'Death Ray beam time × (1 + Double Death Ray chance)', before: deathRayRate(base), after: deathRayRate(after), kind: 'count' });

    const ctx = (s: OptimizerSnapshot) => buildDamageContext(s.presetIdx, s.wsData, s.labData, s.cardData, s.relicData,
        s.enhData, cond(s).modBonuses, s.moduleState, s.botData);
    const [c0, c1] = [ctx(base), ctx(after)];
    add({ group: 'Tower', label: 'Tower damage', before: 1, after: c1.towerDamage / c0.towerDamage, kind: 'times' });
    add({ group: 'Tower', label: 'Attacks per second', before: c0.attackSpeed, after: c1.attackSpeed, kind: 'perSecond' });
    add({ group: 'Tower', label: 'Crit multiplier (average)', before: c0.critMult, after: c1.critMult, kind: 'times' });
    // Damage/Meter on tower shots, Guardian Scout's longer distance included.
    const dm = (s: OptimizerSnapshot, range: number) => damageMeterFactor(s.guardian, s.presetIdx,
        calcDamageMeter(s.presetIdx, s.wsData, s.labData, s.enhData, s.relicData), range);
    add({ group: 'Tower', label: 'Damage/Meter bonus (Scout included)', before: dm(base, t0.range), after: dm(after, t1.range), kind: 'times' });
    add({ group: 'Tower', label: 'Projectiles per attack (Multishot)', before: c0.projectiles.multishot, after: c1.projectiles.multishot, kind: 'times' });
    add({ group: 'Tower', label: 'Hits per projectile (Bounce Shot)', before: c0.projectiles.bounce, after: c1.projectiles.bounce, kind: 'times' });
    add({ group: 'Tower', label: 'Fire rate from Rapid Fire', before: c0.projectiles.rapid, after: c1.projectiles.rapid, kind: 'times' });
    add({ group: 'Tower', label: 'Enemy hits per second', before: c0.hitRate, after: c1.hitRate, kind: 'perSecond' });
    add({ group: 'Tower', label: 'Bullets each tower bullet counts as (Echoing Shot)', before: echoingShotBullets(base.botData), after: echoingShotBullets(after.botData), kind: 'times' });

    // Damage to each enemy on its way in, by source, with its share of your damage.
    const calib = buildEdpsCalibration(conditioned({ ...base, conditions: models.calibConditions ?? cond(base).conditions }), report);
    if (calib) {
        const [p0, p1] = [edpsParts(cond(base)), edpsParts(cond(after))];
        const time = p0.ttt > 0 ? p1.ttt / p0.ttt : 1;
        const rel = (a: number, b: number, t = 1) => (b > 0 ? (a / b) * t : 1);
        // Battle conditions: fire shared with more enemies, hits lost to armor.
        const killers = models.run ? killerMix(models.run) : undefined;
        const [k0, k1] = [conditionRatios({ ...cond(base), killers }, calib, p0), conditionRatios({ ...cond(after), killers }, calib, p1)];
        const k = { targeted: k1.targeted / k0.targeted, flat: k1.flat / k0.flat };
        if ((cond(base).conditions?.armoredHits ?? 0) > 0) {
            add({ group: 'Damage to each enemy', label: 'Hits that get past Armored Enemies', before: 1, after: k.flat, kind: 'times' });
        }
        const src: [string, number, number][] = [
            ['Chain Lightning', rel(p1.cl, p0.cl, time) * k.targeted * k.flat, calib.shares.cl],
            ['Smart Missiles', rel(p1.sm, p0.sm) * k.targeted * k.flat, calib.shares.sm],
            ['Death Wave', rel(p1.dw, p0.dw) * k.flat, calib.shares.dw],
            ['Inner Land Mines', rel(p1.ilm, p0.ilm) * k.flat, calib.shares.ilm],
            ['Poison Swamp', rel(p1.ps, p0.ps) * k.flat, calib.shares.ps],
            ['Tower shots', rel(p1.tower, p0.tower, time) * k.targeted * k.flat, calib.shares.tower],
            ['Flame Bot', rel(p1.flame, p0.flame) * k.flat, calib.shares.flame],
            ['Guardian Attack', attackRatio(p1, p0, flatDamageRatio(p1, p0, calib.shares, k)), calib.shares.guardian],
            ['Black Hole reach', rel(p1.bh, p0.bh), calib.shares.bh],
        ];
        // Flat sources (and Attack, which follows them) split the flat-damage
        // part of the waves by what each added.
        const flat = calib.shares.cl + calib.shares.sm + calib.shares.dw + calib.shares.ilm + calib.shares.ps
            + calib.shares.tower + calib.shares.flame + calib.shares.guardian;
        // The changes' own effect, read where runs end now; in a tournament the
        // stronger conditions further into the run are a link of their own.
        const flatWaves = wavesOf(split ? Math.log(split.damageStart) : 0);
        const added = split ? split.damageStart - 1 : 0;
        if (split && Math.abs(Math.log(split.damage / split.damageStart)) > 1e-9) {
            add({ group: 'Damage to each enemy', label: 'Stronger battle conditions where the run now ends', before: 1,
                after: split.damage / split.damageStart, kind: 'times', waves: wavesOf(Math.log(split.damage / split.damageStart)) });
        }
        for (const [label, ratio, share] of src) {
            const own = label === 'Black Hole reach' || flat <= 0 ? 0 : (share * (ratio - 1)) / flat;
            add({
                group: 'Damage to each enemy', label, before: 1, after: ratio, kind: 'times', share,
                waves: flatWaves !== undefined && Math.abs(added) > 1e-12 && label !== 'Black Hole reach'
                    ? (flatWaves * own) / added : undefined,
            });
        }
        const procs = (p: typeof p0) => p.clChance * p.clChance * p.clQty * p.shotRate * p.ttt;
        const procs0 = calib.smiteProcs;
        if (p0.smite > 0 || p1.smite > 0) {     // Smite needs CL+
            add({ group: 'Damage to each enemy', label: 'Smite procs per enemy', before: procs0,
                after: Math.min(100, procs0 * rel(procs(p1), procs(p0))), kind: 'count' });
        }
        add({ group: 'Damage to each enemy', label: 'Smite (share of health per proc)', before: p0.smite * 100, after: p1.smite * 100, kind: 'percent',
            waves: wavesOf(split?.smiteLog ?? 0) });
        add({ group: 'Damage to each enemy', label: 'Consume (share of health)', before: p0.consume * 100, after: p1.consume * 100, kind: 'percent' });
        // Enemies that end runs and can be touched (Basic, Fast, Tank, Ranged):
        // the share orbs and Death Ray stop before they reach the tower.
        if (killers) {
            const [r0, r1] = [reachShares({ ...cond(base), killers }, calib, p0), reachShares({ ...cond(after), killers }, calib, p1)];
            add({ group: 'Damage to each enemy', label: 'Stopped by orbs and Death Ray (enemies they can touch)',
                before: r0.now * 100, after: r1.now * 100, kind: 'percent', waves: wavesOf(split?.reachLog ?? 0) });
        }
    }

    add({ group: 'Level skip', label: 'Enemy Health Level Skip', before: skipOf(base, models), after: skipOf(after, models), kind: 'points',
        waves: wavesOf(split?.skipLog ?? 0) });
    if (build === 'Glass Cannon' && models.run) {
        const killers = Object.entries(killerMix(models.run)) as [EnemyType, number][];
        for (const [type, share] of killers) {
            const [cut0, cut1] = [healthLabCut(base.labData, type), healthLabCut(after.labData, type)];
            add({ group: 'Level skip', label: `${type} health (lab)`, before: cut0 * 100, after: cut1 * 100,
                kind: 'percent', share, waves: wavesOf(share * Math.log(cut0 / cut1)) });
        }
    }
    if (build !== 'Glass Cannon') {
        // What an eHP tower takes and heals (engine/ehp.ts).
        const [e0, e1] = [readEhpInputs(base), readEhpInputs(after)];
        const rel = (a: number, b: number) => (b > 0 ? a / b : 1);
        add({ group: 'Survival', label: 'Max health', before: 1, after: rel(e1.health, e0.health), kind: 'times' });
        add({ group: 'Survival', label: 'Overheal from packages (Max Recovery)', before: e0.maxRecovery, after: e1.maxRecovery, kind: 'times' });
        add({ group: 'Survival', label: 'Wall health', before: 1, after: rel(e1.wallPool, e0.wallPool), kind: 'times' });
        add({ group: 'Survival', label: 'Health regen', before: 1, after: rel(e1.regen, e0.regen), kind: 'times' });
        add({ group: 'Survival', label: 'Wall regen', before: 1, after: rel(e1.wallRegen, e0.wallRegen), kind: 'times' });
        add({ group: 'Survival', label: 'Recovery package chance', before: e0.pkgChance * 100, after: e1.pkgChance * 100, kind: 'percent' });
        add({ group: 'Survival', label: 'Recovery package healing (share of max health)', before: e0.pkgAmount * 100, after: e1.pkgAmount * 100, kind: 'percent' });
        add({ group: 'Survival', label: 'Defense %', before: e0.defPct * 100, after: e1.defPct * 100, kind: 'percent' });
        add({ group: 'Survival', label: 'Defense Absolute', before: 1, after: rel(e1.defAbs, e0.defAbs), kind: 'times' });
        add({ group: 'Survival', label: 'Chrono Field damage cut (with its uptime)', before: e0.cfReduction * 100, after: e1.cfReduction * 100, kind: 'percent' });
        add({ group: 'Survival', label: 'Enemy damage that still lands (module effects)', before: e0.damageTaken * 100, after: e1.damageTaken * 100, kind: 'percent' });
        add({ group: 'Survival', label: 'Flame Bot damage reduction', before: (e0.flameReduction ?? 0) * 100, after: (e1.flameReduction ?? 0) * 100, kind: 'percent' });
        add({ group: 'Survival', label: 'Chain Thunder (most it can cut)', before: (e0.chainThunderCap ?? 0) * 100, after: (e1.chainThunderCap ?? 0) * 100, kind: 'percent' });
        add({ group: 'Survival', label: 'Thorns (share of the attacker’s health per hit)', before: e0.thorns * 100, after: e1.thorns * 100, kind: 'percent' });
        add({ group: 'Level skip', label: 'Enemy Attack Level Skip', before: attackSkipOf(base, models), after: attackSkipOf(after, models), kind: 'points' });
        if (models.run?.stat === 'attack') {
            for (const [type, share] of Object.entries(killerMix(models.run)) as [EnemyType, number][]) {
                add({ group: 'Level skip', label: `${type} attack (lab)`, before: attackLabCut(base.labData, type) * 100,
                    after: attackLabCut(after.labData, type) * 100, kind: 'percent', share });
            }
        }
    }

    // Run savers: Death Defy against the saves behind it in the player's runs.
    const [dd0, dd1] = [deathDefyChance(base), deathDefyChance(after)];
    const savers = saverAverages(models.run?.used.map(d => d.run) ?? []);
    add({ group: 'Run savers', label: 'Death Defy chance', before: dd0 * 100, after: dd1 * 100, kind: 'percent' });
    add({ group: 'Run savers', label: 'Killing hits survived per run', before: hitsSurvived(dd0, savers?.others ?? 0),
        after: hitsSurvived(dd1, savers?.others ?? 0), kind: 'count' });

    const farm = buildFarmCalibration(base, report);
    const [f0, f1] = [coinFactors(base, farm), coinFactors(after, farm)];
    add({ group: 'Coin bonuses', label: 'Always-on coin multiplier', before: 1, after: f1.base / f0.base, kind: 'times' });
    for (const e of FARM_EFFECTS) {
        add({ group: 'Coin bonuses', label: `${FARM_EFFECT_LABELS[e]} coin bonus (average)`, before: f0[e], after: f1[e], kind: 'times' });
    }
    // Guardian chips (engine/guardian.ts).
    const kps = (s: OptimizerSnapshot) => s.modBonuses.run?.killsPerSec ?? 8;
    add({ group: 'Coin bonuses', label: 'Guardian Bounty (average on kill coins)', kind: 'times',
        before: 1 + bountyExtra(base.guardian, base.presetIdx, kps(base)), after: 1 + bountyExtra(after.guardian, after.presetIdx, kps(after)) });
    add({ group: 'Coin bonuses', label: 'Guardian Summon (extra kills)', kind: 'times',
        before: 1 + summonExtra(base.guardian, base.presetIdx, kps(base)), after: 1 + summonExtra(after.guardian, after.presetIdx, kps(after)) });
    add({ group: 'Coin bonuses', label: 'Guardian Fetch finds per hour', kind: 'count',
        before: 3600 * fetchRate(base.guardian, base.presetIdx), after: 3600 * fetchRate(after.guardian, after.presetIdx) });
    return links;
}

// Skip as the run gets it: in a tournament, after the league's Skip
// Reduction and Skip Decay.
const skipOf = (s: OptimizerSnapshot, models: GoalModels) => conditionedSkip(healthSkipChance(healthSkipSources(
    inRunLevels(s).wsData[s.presetIdx], s.labData, s.enhData, s.relicData, s.modBonuses.subs ?? {},
)), s.conditions ?? models.conditions);
const attackSkipOf = (s: OptimizerSnapshot, models: GoalModels) => conditionedSkip(healthSkipChance(attackSkipSources(
    inRunLevels(s).wsData[s.presetIdx], s.labData, s.enhData, s.relicData, s.modBonuses.subs ?? {},
)), s.conditions ?? models.conditions);

export function whatIf(
    base: OptimizerSnapshot, changes: Change[], targets: UpgradeTarget[], build: BuildType,
    report: BattleReport | null, models: GoalModels,
): WhatIfResult {
    const after = JSON.parse(JSON.stringify(base)) as OptimizerSnapshot;
    const costs: Costs = {};
    for (const c of changes) {
        const t = targets.find(x => x.kind === c.kind && x.key === c.key);
        if (t) {
            for (const [k, v] of Object.entries(changeCost(base, t, c.level)) as [OptCurrency, number][]) {
                costs[k] = (costs[k] ?? 0) + v;
            }
        }
        applyChange(after, c);
    }
    after.modBonuses = readActiveModuleBonuses(
        after.moduleState, after.perkData, after.labData, after.cardData, after.modBonuses.run,
    );

    const gc = build === 'Glass Cannon';
    const damagePct = goalPct(base, after, 'damage', build, report, models);
    const coinsHourPct = goalPct(base, after, 'coins', build, report, models);
    // Push and skip; in a tournament, under the conditions where the changed
    // run ends (a few rounds: they move the end, which moves them).
    const settle = (s: OptimizerSnapshot) => {
        let push = goalPct(base, s, 'waves', build, report, models);
        let skip = skipOf(s, models) - skipOf(base, models);
        const pushStart = push;   // the change itself, where runs end now
        let conditions = s.conditions;
        let reach: number | undefined;   // tournaments: how far the run gets before stronger conditions stop it
        if (gc && models.run && models.conditionsAt) {
            const run = models.run;
            const from = models.startWave ?? run.typicalWave;
            const read = (w: number) => {
                const at = { ...s, conditions: models.conditionsAt!(from + w) };
                return { at, push: goalPct(base, at, 'waves', build, report, models), skip: skipOf(at, models) - skipOf(base, models) };
            };
            const gain = (w: number) => {
                const r = read(w);
                return pathRunGains(run, [r.push], undefined, [Math.max(0, r.skip)], models.worth)[0].waves;
            };
            reach = settleGain(gain);
            const end = read(reach);
            ({ push, skip } = end);
            conditions = end.at.conditions;
        }
        return { push, skip, conditions, reach, pushStart };
    };
    // Waves for a settled change: no further than the conditions let it get.
    const settledWaves = (r: { push: number; skip: number; reach?: number }, wavesFor: (g: number, s: number) => number) => {
        const w = wavesFor(r.push, r.skip);
        return r.reach !== undefined && r.reach >= 0 ? Math.min(w, Math.max(r.reach, 0)) : w;
    };
    const settled = settle(after);
    // Shown: what the change itself does to the push (where runs end now);
    // the waves also count stronger conditions where the run then ends.
    const { pushStart: pushPct, push: pushAtEnd, skip: skipPoints } = settled;
    // The changed run is read where it ends from here on (waves, split); the
    // chain reads the changes themselves where runs end now (atStart).
    const atStart = { ...after };
    after.conditions = settled.conditions;

    let waves: WhatIfResult['waves'] = null;
    let coinsRun: WhatIfResult['coinsRun'] = null;
    let coinsHour: WhatIfResult['coinsHour'] = null;
    let split: WaveSplit | null = null;
    let spread: WhatIfResult['spread'] = null;
    const perChange: WhatIfResult['perChange'] = [];
    if (gc && models.run) {
        const run = models.run;
        const wavesFor = (gain: number, skip: number) =>
            pathRunGains(run, [gain], undefined, [Math.max(0, skip)], models.worth)[0].waves;
        const gained = settledWaves(settled, wavesFor);
        const from = models.startWave ?? run.typicalWave;
        const to = Math.round(from + gained);
        waves = { from, to, gained };
        for (const c of changes) {
            const one = JSON.parse(JSON.stringify(base)) as OptimizerSnapshot;
            applyChange(one, c);
            one.modBonuses = readActiveModuleBonuses(one.moduleState, one.perkData, one.labData, one.cardData, one.modBonuses.run);
            perChange.push({ kind: c.kind, key: c.key, waves: settledWaves(settle(one), wavesFor) });
        }
        const s = wavesSpread(run, pushAtEnd, skipPoints, models.worth);
        spread = {
            min: Math.min(...s.moves), max: Math.max(...s.moves),
            endedMin: Math.min(...s.ended), endedMax: Math.max(...s.ended), runs: s.ended.length,
            tournament: run.tournament,
        };
        const cond = (s: OptimizerSnapshot) => ({
            ...conditioned({ ...s, conditions: s.conditions ?? models.conditions }), killers: killerMix(run),
        });
        const calib = buildEdpsCalibration(conditioned({ ...base, conditions: models.calibConditions ?? cond(base).conditions }), report);
        if (calib) {
            const killers = Object.entries(killerMix(run)) as [EnemyType, number][];
            split = {
                waves: gained,
                damage: edpsSurvivalScore(cond(after), calib) / edpsSurvivalScore(cond(base), calib),
                damageStart: edpsSurvivalScore(cond(atStart), calib) / edpsSurvivalScore(cond(base), calib),
                skipLog: models.worth * skipPoints,
                killerLog: killers.reduce((sum, [type, share]) =>
                    sum + share * Math.log(healthLabCut(base.labData, type) / healthLabCut(after.labData, type)), 0),
                reachLog: edpsWaves(cond(after), calib).reach - edpsWaves(cond(base), calib).reach,
                smiteLog: edpsWaves(cond(after), calib).smite - edpsWaves(cond(base), calib).smite,
            };
        }
        // A longer run: coins for the extra waves, at the new coin bonuses;
        // per hour, the later waves pay more than the early ones.
        if (models.projectAt) {
            const [p0, p1] = [models.projectAt(from), models.projectAt(to)];
            const bonus = 1 + coinsHourPct / 100;
            coinsRun = { from: p0.coins, to: p1.coins * bonus };
            coinsHour = { from: p0.coinsPerHour, to: p1.coinsPerHour * bonus };
        }
    }
    const survivalPct = gc ? null : goalPct(base, after, 'survival', build, report, models);
    let attackSkip = 0;
    // eHP: survival (with Enemy Attack Level Skip at what it's worth) moves
    // the death wave on the enemy-attack model (runLength.ts).
    if (!gc && models.run?.stat === 'attack' && survivalPct !== null) {
        const run = models.run;
        const wavesFor = (gain: number, skip: number) =>
            pathRunGains(run, [gain], undefined, [Math.max(0, skip)], models.worth)[0].waves;
        attackSkip = attackSkipOf(after, models) - attackSkipOf(base, models);
        const gained = wavesFor(survivalPct, attackSkip);
        const from = run.typicalWave;
        const to = Math.round(from + gained);
        waves = { from, to, gained };
        for (const c of changes) {
            const one = JSON.parse(JSON.stringify(base)) as OptimizerSnapshot;
            applyChange(one, c);
            one.modBonuses = readActiveModuleBonuses(one.moduleState, one.perkData, one.labData, one.cardData, one.modBonuses.run);
            perChange.push({ kind: c.kind, key: c.key,
                waves: wavesFor(goalPct(base, one, 'survival', build, report, models), attackSkipOf(one, models) - attackSkipOf(base, models)) });
        }
        const s = wavesSpread(run, survivalPct, attackSkip, models.worth);
        spread = {
            min: Math.min(...s.moves), max: Math.max(...s.moves),
            endedMin: Math.min(...s.ended), endedMax: Math.max(...s.ended), runs: s.ended.length, tournament: false,
        };
        if (models.projectAt) {
            const [p0, p1] = [models.projectAt(from), models.projectAt(to)];
            const bonus = 1 + coinsHourPct / 100;
            coinsRun = { from: p0.coins, to: p1.coins * bonus };
            coinsHour = { from: p0.coinsPerHour, to: p1.coinsPerHour * bonus };
        }
    }
    return {
        damagePct, pushPct, waves, coinsHourPct, coinsRun, coinsHour, cellsRun: cellsPerRun(base, after, report),
        skipPoints: gc ? skipPoints : attackSkip,
        skipKind: gc ? 'health' : 'attack',
        survivalPct,
        chain: buildChain(base, atStart, build, report, models, split),
        perChange, spread,
        costs,
        freeNotes: changes.flatMap(c => {
            if (c.kind !== 'workshop') return [];
            const [section, idx] = c.key.split('|');
            const s = statsInRun(base).find(x => x.section === section && x.idx === Number(idx));
            return s?.filledAt != null ? [freeFillText(s.stat, s.filledAt)] : [];
        }),
    };
}
