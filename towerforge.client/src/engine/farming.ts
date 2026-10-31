// ============================================================
//  TowerForge Companion — Farming (Econ) Coin Model
//  Scores upgrades by their effect on coins per hour.
//
//  Model (all coin multipliers multiply, but only on the SAME kill):
//    kill coins ∝ always-on multipliers × Π (1 + coverage × (mult − 1))
//  over the situational effects (Golden Tower, Black Hole, Spotlight,
//  Death Wave, Golden Bot, Orb mastery), where "coverage" is the share
//  of kills made while that effect is active/in range. On top of that:
//    • Golden Combo (GT+): GT-period income × ((1 + 0.0003(L+1))^kills − 1)
//    • Wave Skip: skipped waves pay the previous wave ×1.1
//    • Critical Coin and Coins/Wave as small additive streams
//    • Guardian (engine/guardian.ts): Bounty and Summon scale kill coins
//      (tagged kills × Multiplier, extra summoned kills); Fetch's coins are
//      their own stream, scaled by its finds per second; each owned skin
//      +0.6% coins
//
//  Calibration: a pasted Battle Report gives the real coverage of each
//  effect and how much Golden Combo / Wave Skip / Critical Coin / Coins
//  per Wave contribute. Without one, rough defaults are used. Upgrades
//  are scored by how they move coverage and multipliers relative to
//  the player's current setup (the "anchor"), so the anchor scores 1.0.
//
//  Pure functions — no store imports.
// ============================================================

import { WS_STATS, WS_ENH } from '../constants/gameData';
import { BOTS_CONFIG, isBotEntryOwned, vaultBotRange } from '../constants/botData';
import { labValue, WS_COIN_PER_KILL, WS_COIN_PER_WAVE } from '../constants/buildStatCurves';
import { uwStatValue, calcEffCD, getMultiverseNexusCombinedCD } from './uwdps';
import { calcModuleSlotMult } from './towerDamage';
import {
    blackHoleDigestorMult, gildedSniperChance, singularityHarnessRange, primordialCollapseExtraHoles,
} from './moduleEffects';
import { activeCard as activeCardIn, cardValue, labMult as labMultIn, masteredCardMult } from './statHelpers';
import type { BattleReport } from './battleReport';
import { dissonanceFactor } from './dissonance';
import type { OptimizerSnapshot } from './optimizer';
import { bountyExtra, fetchRate, summonExtra } from './guardian';
import { SKIN_COIN_BONUS } from '../constants/guardianData';

export const FARM_EFFECTS = ['gt', 'bh', 'sl', 'dw', 'gb', 'orb'] as const;
export type FarmEffect = typeof FARM_EFFECTS[number];

export const FARM_EFFECT_LABELS: Record<FarmEffect, string> = {
    gt: 'Golden Tower',
    bh: 'Black Hole',
    sl: 'Spotlight',
    dw: 'Death Wave',
    gb: 'Golden Bot',
    orb: 'Orbs',
};

export interface FarmInputs {
    base: number;                          // always-on kill-coin multiplier (only ratios matter)
    mult: Record<FarmEffect, number>;      // coin multiplier while each effect applies
    reach: Record<FarmEffect, number>;     // modeled driver of coverage (uptime × area); 0 = unavailable
    uptime: Record<FarmEffect, number>;    // share of time an area effect is active (Gilded Sniper); 0 = n/a
    gilded: number;                        // Gilded Sniper chance (0–1)
    gtDuration: number;                    // seconds, for Golden Combo kills per activation
    comboLevel: number | null;             // GT+ level, null when GT+ is locked
    critCoin: number;                      // relative Critical Coin output
    coinsPerWave: number;                  // relative Coins/Wave output
    waveSkip: number;                      // expected extra skipped waves per wave
    bounty: number;                        // Guardian Bounty: extra share of kill coins
    summon: number;                        // Guardian Summon: extra kills, as a share
    fetch: number;                         // Guardian Fetch: finds per second
}

export interface FarmCalibration {
    source: 'report' | 'estimate';
    anchor: FarmInputs;
    coverage: Record<FarmEffect, number>;  // share of kills covered at the anchor (0–1)
    shares: { kill: number; crit: number; cpw: number; fetch: number };  // of non-wave-skip income, excluding Golden Combo
    comboShare: number;                    // Golden Combo share of non-wave-skip income
    comboKillsPerSec: number;              // kills per GT-second feeding Golden Combo
    waveSkipExtra: number;                 // wave-skip coins ÷ all other coins
    coinsPerHour: number | null;           // real-time coins/hour from the report
}

// ── Small readers ─────────────────────────────────────────────
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function botStat(values: string[], lv0: string, level: number): number {
    return parseFloat(level > 0 ? values[Math.min(level, values.length) - 1] : lv0) || 0;
}

const activeCard = (snap: OptimizerSnapshot, name: string) => activeCardIn(snap.cardData, snap.presetIdx, name);
const labMult = (snap: OptimizerSnapshot, name: string, neutral: number) => labMultIn(snap.labData, name, neutral);

// Effective cooldown, shared with the GC model (Multiverse Nexus, sub-effects, packages).
function effCooldown(snap: OptimizerSnapshot, abbr: 'GT' | 'BH' | 'DW', rawCD: number): number {
    const mb = snap.modBonuses;
    const mvn = getMultiverseNexusCombinedCD(snap.uwData, mb, snap.labData, snap.wsData, snap.cardData, snap.presetIdx);
    if (mvn > 0) return mvn;
    const b = mb.uwBonus[abbr] ?? {};
    return Math.max(1, calcEffCD(rawCD || 999, b.cd ?? 0, mb, snap.wsData, snap.labData, snap.cardData, true, snap.presetIdx));
}

// Free upgrades rolled per wave over Attack, Defense and Utility (for Black
// Hole Digestor). Each chance = 0.5% per workshop level + Free Upgrades card
// + perk + module sub-effects, × the Free Upgrades enhancement; over 100%
// gives a second upgrade (wiki). Wave Skip rolls again for each skipped wave.
function freeUpgradesPerWave(snap: OptimizerSnapshot, waveSkip: number): number {
    const ws = snap.wsData[snap.presetIdx];
    const wsLv = (name: string) => ws?.utility[WS_STATS.utility.findIndex(([n]) => n === name)] ?? 0;
    const card = activeCard(snap, 'Free Upgrades');
    const cardPct = card ? cardValue('Free Upgrades', card.stars) : 0;
    const banned = new Set(snap.perkData.banned ?? []);
    const spb = (snap.labData['Standard Perk Bonus'] ?? 0) / 100;
    const perkPct = banned.has('freeupg') ? 0 : 5 * 5 * (1 + spb);
    const enhIdx = WS_ENH.utility.findIndex(([n]) => n === 'Free Upgrades');
    const enh = snap.enhData?.u?.utility?.[enhIdx] ? 1 + 0.01 * (snap.enhData?.d?.utility?.[enhIdx] ?? 0) : 1;
    const subs = snap.modBonuses.subs ?? {};
    const chance = (wsName: string, subName: string) =>
        (0.5 * wsLv(wsName) + cardPct + perkPct + (subs[subName] ?? 0)) * enh / 100;
    return (chance('Free Atk Upgrade', 'Free Attack Upgrade')
        + chance('Free Def Upgrade', 'Free Defense Upgrade')
        + chance('Free Util Upgrade', 'Free Utility Upgrade')) * (1 + waveSkip);
}

// ── Inputs from the tower state ───────────────────────────────
export function readFarmInputs(snap: OptimizerSnapshot): FarmInputs {
    const mb = snap.modBonuses;
    const pk = mb.perks;
    const ws = snap.wsData[snap.presetIdx];
    const subs = mb.subs ?? {};

    // Always-on: Coins/Kill (+ module sub-effects) × Coin Bonus enhancement (counted
    // twice) × Coins card × relic × generator modules' Coin Bonus main effect.
    const cpkIdx = WS_STATS.utility.findIndex(([n]) => n === 'Coin/Kill Bonus');
    const cpwIdx = WS_STATS.utility.findIndex(([n]) => n === 'Coin/Wave');
    const cpk = (WS_COIN_PER_KILL.valueAt(ws?.utility[cpkIdx] ?? 0) + (subs['Coins/Kill Bonus'] ?? 0))
        * labMult(snap, 'Coins/Kill Lab', 1);

    const enhIdx = WS_ENH.utility.findIndex(([n]) => n === 'Coin Bonus');
    const enhOwned = snap.enhData?.u?.utility?.[enhIdx] ?? false;
    const enhMult = enhOwned ? 1 + 0.01 * (snap.enhData?.d?.utility?.[enhIdx] ?? 0) : 1;

    const coins = activeCard(snap, 'Coins');
    // Mastery scales the card's bonus (×1.45 → +45% × mastery), not the whole ×value.
    const coinsCard = coins ? masteredCardMult(cardValue('Coins', coins.stars), coins.mastery) : 1;
    const relic = 1 + (snap.relicData['rCoins'] ?? 0) / 100;
    const generator = calcModuleSlotMult(snap.moduleState, 'generator', snap.labData);

    // Wave Skip: chance per wave × (1 + mastery chance of a double skip).
    const skip = activeCard(snap, 'Wave Skip');
    const waveSkip = skip ? (cardValue('Wave Skip', skip.stars) / 100) * (1 + (skip.mastery ?? 0) / 100) : 0;

    // Black Hole Digestor: +Coins/Kill per free upgrade each wave.
    const digestor = blackHoleDigestorMult(mb, freeUpgradesPerWave(snap, waveSkip));
    const base = cpk * enhMult * enhMult * coinsCard * relic * generator * digestor;

    const mult = { gt: 1, bh: 1, sl: 1, dw: 1, gb: 1, orb: 1 } as Record<FarmEffect, number>;
    const reach = { gt: 0, bh: 0, sl: 0, dw: 0, gb: 0, orb: 0 } as Record<FarmEffect, number>;
    const uptime = { gt: 0, bh: 0, sl: 0, dw: 0, gb: 0, orb: 0 } as Record<FarmEffect, number>;
    let gtDuration = 0;
    let comboLevel: number | null = null;

    // Golden Tower — every kill while active. The ×1.5 perk scales the UW
    // value (and lab), not the core sub-effect.
    const gt = snap.uwData.data.GT;
    if (gt?.own) {
        const b = mb.uwBonus.GT ?? {};
        mult.gt = (uwStatValue('GT', 0, gt.sv[0]) + labValue('GT-Bonus', snap.labData['GT-Bonus'] ?? 0))
            * (pk.gtBonusMult ?? 1) + (b.bonus ?? 0);
        gtDuration = uwStatValue('GT', 1, gt.sv[1]) + labValue('GT-Duration', snap.labData['GT-Duration'] ?? 0) + (b.dur ?? 0);
        reach.gt = Math.min(1, gtDuration / effCooldown(snap, 'GT', uwStatValue('GT', 2, gt.sv[2])));
        comboLevel = gt.upOwn ? (gt.upLvl ?? 0) : null;
    }

    // Black Hole — kills inside a hole while it's active (coins need the lab).
    const bh = snap.uwData.data.BH;
    if (bh?.own) {
        const b = mb.uwBonus.BH ?? {};
        mult.bh = labMult(snap, 'BH-Coin Bonus', 1);
        const size = uwStatValue('BH', 0, bh.sv[0]) + (b.size ?? 0);
        const dur = uwStatValue('BH', 1, bh.sv[1]) + (pk.bhExtraDur ?? 0) + (b.dur ?? 0);
        const holes = 1 + ((snap.labData['BH-Extra(unlock)'] ?? 0) >= 1 ? 1 : 0) + primordialCollapseExtraHoles(mb);
        uptime.bh = Math.min(1, dur / effCooldown(snap, 'BH', uwStatValue('BH', 2, bh.sv[2])));
        reach.bh = uptime.bh * size * holes;
    }

    // Spotlight — kills inside the light (always on); coverage grows with angle × beams.
    const sl = snap.uwData.data.SL;
    if (sl?.own) {
        const b = mb.uwBonus.SL ?? {};
        mult.sl = labMult(snap, 'SL-Coin Bonus', 1);
        reach.sl = (uwStatValue('SL', 1, sl.sv[1]) + (b.angle ?? 0)) * uwStatValue('SL', 2, sl.sv[2]);
        uptime.sl = 1;
    }

    // Death Wave — enemies hit by effect waves; more waves / shorter cooldown cover more.
    const dw = snap.uwData.data.DW;
    if (dw?.own) {
        const b = mb.uwBonus.DW ?? {};
        mult.dw = labMult(snap, 'DW-Coins Bonus', 1);
        const waves = uwStatValue('DW', 1, dw.sv[1]) + (pk.dwExtraWave ?? 0) + (b.qty ?? 0);
        reach.dw = waves / effCooldown(snap, 'DW', uwStatValue('DW', 2, dw.sv[2]));
    }

    // Golden Bot — kills in its range while active.
    const gbCfg = BOTS_CONFIG.find(bot => bot.name === 'Golden Bot');
    const gbEntry = snap.botData?.['Golden Bot'];
    if (gbCfg && isBotEntryOwned(gbEntry)) {
        const med = gbEntry?.medals ?? [];
        const [durS, cdS, bonusS, rangeS] = gbCfg.stats;
        const dur = botStat(durS.values, durS.lv0, med[0] ?? 0) + labValue('Golden Bot Duration', snap.labData['Golden Bot Duration'] ?? 0);
        const cd = botStat(cdS.values, cdS.lv0, med[1] ?? 0) + labValue('Golden Bot Cooldown', snap.labData['Golden Bot Cooldown'] ?? 0);
        mult.gb = botStat(bonusS.values, bonusS.lv0, med[2] ?? 0);
        const range = botStat(rangeS.values, rangeS.lv0, med[3] ?? 0) + (snap.relicData['rBotRange'] ?? 0)
            + vaultBotRange(snap.vault) + singularityHarnessRange(mb);
        uptime.gb = Math.min(1, dur / Math.max(1, cd));
        reach.gb = uptime.gb * range;
    }

    // Orbs — Extra Orb mastery adds an orb kill coin bonus.
    const orb = activeCard(snap, 'Extra Orb');
    mult.orb = orb?.mastery ?? 1;
    reach.orb = 1;

    // Critical Coin: chance × (1 + mastery chance of a double drop), worth one CPK each.
    const crit = activeCard(snap, 'Critical Coin');
    const critCoin = crit
        ? (cardValue('Critical Coin', crit.stars) / 100) * (1 + (crit.mastery ?? 0) / 100) * base
        : 0;

    const coinsPerWave = (WS_COIN_PER_WAVE.valueAt(ws?.utility[cpwIdx] ?? 0) + (subs['Coins/Wave'] ?? 0))
        * labMult(snap, 'Coins/Wave Lab', 1) * coinsCard * relic * generator;

    const kps = mb.run?.killsPerSec ?? 8;
    const skins = snap.guardian?.unlocked ? 1 + SKIN_COIN_BONUS * snap.guardian.skinsOwned : 1;
    return {
        // The Utility Dissonant Boost multiplies kill coins (TheTowerSDK: eEcon's Disco).
        base: base * skins * dissonanceFactor(snap, 'utility'), mult, reach, uptime, gilded: gildedSniperChance(mb), gtDuration, comboLevel, critCoin, coinsPerWave, waveSkip,
        bounty: bountyExtra(snap.guardian, snap.presetIdx, kps),
        summon: summonExtra(snap.guardian, snap.presetIdx, kps),
        fetch: fetchRate(snap.guardian, snap.presetIdx),
    };
}

// ── Model pieces ──────────────────────────────────────────────
// Gilded Sniper gives a kill made outside an active area effect that effect's
// coin bonus with chance g: coverage c → c + (uptime − c) × g. `stripGilded`
// undoes it on observed coverage, so a change in g can be re-applied.
function addGilded(cov: number, uptime: number, g: number): number {
    return g > 0 && uptime > cov ? cov + (uptime - cov) * g : cov;
}
function stripGilded(cov: number, uptime: number, g: number): number {
    return g > 0 && g < 1 && uptime > cov ? clamp01((cov - uptime * g) / (1 - g)) : cov;
}

// Each coin effect's average factor on kill coins (1 + coverage × (bonus − 1))
// and the always-on multiplier, for a snapshot calibrated on `calib`.
export function coinFactors(snap: OptimizerSnapshot, calib: FarmCalibration): { base: number } & Record<FarmEffect, number> {
    const a = calib.anchor;
    const x = readFarmInputs(snap);
    const out = { base: x.base } as { base: number } & Record<FarmEffect, number>;
    for (const e of FARM_EFFECTS) {
        const ratio = a.reach[e] > 0 ? x.reach[e] / a.reach[e] : 1;
        const own = stripGilded(calib.coverage[e], a.uptime[e], a.gilded);
        const cov = addGilded(clamp01(own * ratio), x.uptime[e], x.gilded);
        out[e] = 1 + cov * (x.mult[e] - 1);
    }
    return out;
}

function situational(x: FarmInputs, cov: Record<FarmEffect, number>): number {
    return FARM_EFFECTS.reduce((p, e) => p * (1 + cov[e] * (x.mult[e] - 1)), 1);
}

// Share of kill income that happens during Golden Tower.
function gtIncomeShare(x: FarmInputs, cov: Record<FarmEffect, number>): number {
    if (x.mult.gt <= 1 || cov.gt <= 0) return cov.gt;
    return (cov.gt * x.mult.gt) / (1 + cov.gt * (x.mult.gt - 1));
}

function comboBonus(x: FarmInputs, killsPerSec: number): number {
    if (x.comboLevel === null || x.gtDuration <= 0) return 0;
    const perKill = 1 + 0.0003 * (x.comboLevel + 1);
    return Math.pow(perKill, killsPerSec * x.gtDuration) - 1;
}

// Rough coverage when there's no Battle Report (BH/Golden Bot area and Death
// Wave reach are guesses; GT and Spotlight are geometric).
function estimateCoverage(x: FarmInputs, snap: OptimizerSnapshot): Record<FarmEffect, number> {
    const bh = snap.uwData.data.BH;
    const bhSize = bh?.own ? uwStatValue('BH', 0, bh.sv[0]) : 0;
    const est: Record<FarmEffect, number> = {
        gt: clamp01(x.reach.gt),
        bh: bhSize > 0 ? clamp01((x.reach.bh / bhSize) * 0.6) : 0,   // uptime × holes × ~60% of kills inside
        sl: clamp01(x.reach.sl / 360),
        dw: clamp01(x.reach.dw * 15),                                 // ~15s of kills tagged per effect wave
        gb: x.reach.gb > 0 ? 0.5 : 0,                                 // ~half of kills in range while active
        orb: x.mult.orb > 1 ? 0.5 : 0,
    };
    for (const e of FARM_EFFECTS) est[e] = addGilded(est[e], x.uptime[e], x.gilded);
    return est;
}

// ── Calibration ───────────────────────────────────────────────
export function buildFarmCalibration(snap: OptimizerSnapshot, report: BattleReport | null): FarmCalibration {
    const anchor = readFarmInputs(snap);
    const est = estimateCoverage(anchor, snap);

    if (!report) {
        const comboKillsPerSec = 5;   // typical; refined by a Battle Report
        const coverage = est;
        const w = gtIncomeShare(anchor, coverage);
        const b = comboBonus(anchor, comboKillsPerSec);
        const crit = anchor.critCoin > 0 ? 0.005 : 0;
        const kill = (1 - crit) / (1 + w * b);
        return {
            source: 'estimate',
            anchor,
            coverage,
            shares: { kill, crit, cpw: 0, fetch: 0 },
            comboShare: kill * w * b,
            comboKillsPerSec,
            waveSkipExtra: 1.1 * anchor.waveSkip,
            coinsPerHour: null,
        };
    }

    const k = report.killedWithEffect;
    const coverage: Record<FarmEffect, number> = {
        gt: k.goldenTower ?? est.gt,
        bh: k.blackHole ?? est.bh,
        sl: k.spotlight ?? est.sl,
        dw: k.deathWave ?? est.dw,
        gb: k.goldenBot ?? est.gb,
        orb: k.orbs ?? est.orb,
    };

    const c = report.coins;
    const nonSkip = Math.max(1, report.coinsEarned - c.waveSkip);
    const crit = c.criticalCoin / nonSkip;
    const cpw = c.coinsPerWave / nonSkip;
    const comboShare = c.goldenCombo / nonSkip;
    const fetch = Math.min(0.9, (c.fetched ?? 0) / nonSkip);   // Guardian Fetch coins
    const kill = Math.max(0.01, 1 - crit - cpw - comboShare - fetch);

    // Back out the kills per GT-second that reproduce the observed Golden Combo.
    const killRate = report.totalEnemies > 0 ? report.totalEnemies / report.gameTimeSec : 5;
    let comboKillsPerSec = killRate;
    const w = gtIncomeShare(anchor, coverage);
    if (anchor.comboLevel !== null && anchor.gtDuration > 0 && comboShare > 0 && w > 0) {
        const bonus = comboShare / (kill * w);
        const perKill = 1 + 0.0003 * (anchor.comboLevel + 1);
        comboKillsPerSec = Math.log(1 + bonus) / Math.log(perKill) / anchor.gtDuration;
    }

    return {
        source: 'report',
        anchor,
        coverage,
        shares: { kill, crit, cpw, fetch },
        comboShare,
        comboKillsPerSec,
        waveSkipExtra: c.waveSkip / nonSkip,
        coinsPerHour: report.coinsPerHour || null,
    };
}

// ── Score ─────────────────────────────────────────────────────
// Relative coins per hour; the calibration anchor scores exactly 1.
export function coinRate(snap: OptimizerSnapshot, calib: FarmCalibration): number {
    const a = calib.anchor;
    const x = readFarmInputs(snap);

    const cov = {} as Record<FarmEffect, number>;
    for (const e of FARM_EFFECTS) {
        const ratio = a.reach[e] > 0 ? x.reach[e] / a.reach[e] : 1;
        const own = stripGilded(calib.coverage[e], a.uptime[e], a.gilded);
        cov[e] = addGilded(clamp01(own * ratio), x.uptime[e], x.gilded);
    }

    const ratioOr1 = (n: number, d: number) => (d > 0 ? n / d : 1);
    const sit0 = situational(a, calib.coverage);
    const sit1 = situational(x, cov);
    const guardian = ((1 + x.bounty) * (1 + x.summon)) / ((1 + a.bounty) * (1 + a.summon));
    const killRatio = ratioOr1(x.base, a.base) * ratioOr1(sit1, sit0) * guardian;

    const { kill, crit, cpw } = calib.shares;
    const fetch = calib.shares.fetch ?? 0;
    const w0 = gtIncomeShare(a, calib.coverage);
    const w1 = gtIncomeShare(x, cov);
    const combo0 = comboBonus(a, calib.comboKillsPerSec);
    const combo1 = comboBonus(x, calib.comboKillsPerSec);

    // Golden Combo keeps its observed share at the anchor, then scales with the model.
    const comboAt = (killR: number, w: number, b: number, b0: number) =>
        b0 > 0 ? calib.comboShare * killR * ratioOr1(w, w0) * (b / b0) : kill * killR * w * b;

    const before = kill + crit + cpw + fetch + comboAt(1, w0, combo0, combo0);
    const after = fetch * ratioOr1(x.fetch, a.fetch) + kill * killRatio
        + crit * ratioOr1(x.critCoin, a.critCoin) * ratioOr1(sit1, sit0)
        + cpw * ratioOr1(x.coinsPerWave, a.coinsPerWave)
        + comboAt(killRatio, w1, combo1, combo0);

    const skip0 = 1 + calib.waveSkipExtra;
    const skip1 = 1 + calib.waveSkipExtra * ratioOr1(x.waveSkip, a.waveSkip);

    return (after * skip1) / (before * skip0);
}
