// ============================================================
//  TowerForge Companion — Coins per run (run simulator, step 1)
//  Plays a run wave by wave for kills and coins, tuned to one of the
//  player's saved runs, and checks itself against the others.
//
//  Per wave, after Intro Sprint (which pays nothing):
//    kills = spawn rate × (3.25 enemies per spawn tick × Enemy Balance ×
//            share of waves actually played) — the spawn rate steps up
//            with the wave (Wave Accelerator chart, TheTowerSDK, MIT); the
//            bracket is one number fitted to the tuning run's kills.
//    coins = kills × coins per kill
//          + Coins / Wave every wave
//          + Golden Combo and Critical Coin (shares of kill coins), Wave
//            Skip and Guardian fetch (shares of the rest), as the tuning
//            run shows them.
//  Coins per kill: the wiki gives each enemy a fixed coin value; the SDK
//  multiplies it by the wave number. Both are fitted, and the one that
//  predicts the player's other runs better is used.
//  Rates are relative to the tuning run, so what the model doesn't know
//  about the account (coin bonuses, enemy mix …) cancels out; what the
//  other runs test is how kills and coins grow with the wave. A run on
//  another tier scales every coin by the tier's coin multiplier.
//  Pure functions — no store imports.
// ============================================================

import type { BattleReport } from './battleReport';
import { isDissonantRun } from './battleReport';
import type { CardData } from '../types/gameTypes';
import { activeCard, cardValue } from './statHelpers';

// Coins multiplier by tier (wiki Tiers / Currency-Coins).
export const TIER_COIN_MULT = [0, 1, 1.8, 2.6, 3.4, 4.2, 5, 5.8, 6.6, 7.5, 8.7, 10.3, 12.2,
    14.7, 17.6, 21.3, 25.2, 29.1, 33, 40, 48, 60, 72, 86, 103];

// Wave Accelerator chart: spawn rate, and the wave it starts at with no
// mastery, then mastery level 0 … 9 (+10% … +100% spawn acceleration).
const SPAWN_RATE_ROWS: [rate: number, fromWave: number[]][] = [
    [37, [1000, 909, 833, 769, 714, 667, 625, 588, 556, 526, 500]],
    [39, [1500, 1364, 1250, 1154, 1071, 1000, 938, 882, 833, 789, 750]],
    [40, [2000, 1818, 1667, 1538, 1429, 1333, 1250, 1176, 1111, 1053, 1000]],
    [42, [2500, 2273, 2083, 1923, 1786, 1667, 1563, 1471, 1389, 1316, 1250]],
    [44, [3000, 2727, 2500, 2308, 2143, 2000, 1875, 1765, 1667, 1579, 1500]],
    [46, [3500, 3182, 2917, 2692, 2500, 2333, 2188, 2059, 1944, 1842, 1750]],
    [48, [4000, 3636, 3333, 3077, 2857, 2667, 2500, 2353, 2222, 2105, 2000]],
    [49, [4500, 4091, 3750, 3462, 3214, 3000, 2813, 2647, 2500, 2368, 2250]],
    [50, [5000, 4545, 4167, 3846, 3571, 3333, 3125, 2941, 2778, 2632, 2500]],
    [52, [5500, 5000, 4583, 4231, 3929, 3667, 3438, 3235, 3056, 2895, 2750]],
    [54, [6000, 5455, 5000, 4615, 4286, 4000, 3750, 3529, 3333, 3158, 3000]],
    [56, [6500, 5909, 5417, 5000, 4643, 4333, 4063, 3824, 3611, 3421, 3250]],
];

// Spawn rate at a wave; below the chart it climbs linearly toward 37.
export function spawnRate(wave: number, waMastery: number | null): number {
    const col = waMastery === null ? 0 : Math.min(9, Math.max(0, Math.floor(waMastery))) + 1;
    let rate = 0;
    for (const [r, from] of SPAWN_RATE_ROWS) if (wave >= from[col]) rate = r;
    if (rate > 0) return rate;
    return Math.max(1, Math.floor((36 * wave) / SPAWN_RATE_ROWS[0][1][col]));
}

export interface RunModelSettings {
    introSprintWaves: number;     // waves at the start that pay nothing (Intro Sprint)
    waMastery: number | null;     // Wave Accelerator mastery 0–9, null = not unlocked
}

// Intro Sprint waves and Wave Accelerator mastery from the cards in a preset
// (a run may have used another preset, so the pages let the player change them).
export function runSettingsFromCards(cardData: CardData, presetIdx: number): RunModelSettings {
    const sprint = activeCard(cardData, presetIdx, 'Intro Sprint');
    const wa = cardData.data['Wave Accelerator'];
    return {
        introSprintWaves: sprint ? Math.round(cardValue('Intro Sprint', sprint.stars) * (sprint.mastery ?? 1)) : 0,
        waMastery: activeCard(cardData, presetIdx, 'Wave Accelerator') && wa && wa.s >= 7 && wa.mu ? wa.m ?? 0 : null,
    };
}

export type CoinGrowth = 'flat' | 'wave';

// Σ over the paying waves of spawn rate (× the wave, if coins per kill grow with it).
function spawnSums(toWave: number, s: RunModelSettings) {
    let flat = 0;
    let weighted = 0;
    let waves = 0;
    for (let w = Math.max(1, Math.floor(s.introSprintWaves) + 1); w <= toWave; w++) {
        const r = spawnRate(w, s.waMastery);
        flat += r;
        weighted += r * w;
        waves++;
    }
    return { flat, weighted, waves };
}

export interface RunCalibration {
    tier: number;
    wave: number;
    growth: CoinGrowth;
    killsPerUnit: number;     // kills per unit of spawn rate
    coinsPerUnit: number;     // kill coins per unit of spawn rate (× wave for 'wave')
    waveCoins: number;        // Coins / Wave paid each paying wave
    comboShare: number;       // Golden Combo ÷ kill coins
    critShare: number;        // Critical Coin ÷ kill coins
    skipShare: number;        // Wave Skip coins ÷ coins from kills and waves
    fetchShare: number;       // Guardian fetch ÷ everything else
    secondsPerWave: number;   // real time per wave
}

// Coins from kills in a run: everything not paid per wave, by skips, by Golden
// Combo, by Critical Coin or by the Guardian.
const killCoinsOf = (r: BattleReport) =>
    Math.max(0, r.coinsEarned - r.coins.coinsPerWave - r.coins.waveSkip - r.coins.goldenCombo
        - r.coins.criticalCoin - r.coins.fetched);

export function calibrateRun(run: BattleReport, s: RunModelSettings, growth: CoinGrowth): RunCalibration | null {
    const sums = spawnSums(run.wave, s);
    if (sums.waves <= 0 || sums.flat <= 0 || run.totalEnemies <= 0 || run.coinsEarned <= 0) return null;
    const kill = killCoinsOf(run);
    const fromKillsAndWaves = kill + run.coins.coinsPerWave + run.coins.goldenCombo + run.coins.criticalCoin;
    const beforeFetch = fromKillsAndWaves + run.coins.waveSkip;
    return {
        tier: run.tier,
        wave: run.wave,
        growth,
        killsPerUnit: run.totalEnemies / sums.flat,
        coinsPerUnit: kill / (growth === 'wave' ? sums.weighted : sums.flat),
        waveCoins: run.coins.coinsPerWave / sums.waves,
        comboShare: kill > 0 ? run.coins.goldenCombo / kill : 0,
        critShare: kill > 0 ? run.coins.criticalCoin / kill : 0,
        skipShare: fromKillsAndWaves > 0 ? run.coins.waveSkip / fromKillsAndWaves : 0,
        fetchShare: beforeFetch > 0 ? run.coins.fetched / beforeFetch : 0,
        secondsPerWave: run.wave > 0 ? run.realTimeSec / run.wave : 0,
    };
}

export interface RunProjection {
    wave: number;
    tier: number;
    kills: number;
    coins: number;
    hours: number;            // real time, at the tuning run's pace
    coinsPerHour: number;
}

// A run to `wave` on `tier`, by the calibrated model.
// `coinBoost`: the tier's Dissonant Boost on coins against the run's (1 on the same tier).
export function projectRun(c: RunCalibration, s: RunModelSettings, wave: number, tier: number, coinBoost = 1): RunProjection {
    const sums = spawnSums(wave, s);
    const tierRatio = (TIER_COIN_MULT[tier] ?? 1) / (TIER_COIN_MULT[c.tier] ?? 1) * coinBoost;
    const kill = c.coinsPerUnit * (c.growth === 'wave' ? sums.weighted : sums.flat) * tierRatio;
    const waves = c.waveCoins * sums.waves * tierRatio;
    const fromKillsAndWaves = kill * (1 + c.comboShare + c.critShare) + waves;
    const coins = fromKillsAndWaves * (1 + c.skipShare) * (1 + c.fetchShare);
    const hours = (wave * c.secondsPerWave) / 3600;
    return {
        wave, tier,
        kills: c.killsPerUnit * sums.flat,
        coins,
        hours,
        coinsPerHour: hours > 0 ? coins / hours : 0,
    };
}

export interface RunCheck {
    index: number;            // into the runs passed in
    run: BattleReport;
    predictedKills: number;
    predictedCoins: number;
    killError: number;        // (predicted − actual) ÷ actual
    coinError: number;
}

// The tuning run predicts every other campaign run it can (tournaments use a
// different enemy curve and timer, so they're left out).
export function checkRuns(c: RunCalibration, s: RunModelSettings, runs: BattleReport[], tuning: number): RunCheck[] {
    return runs.flatMap((run, index) => {
        if (index === tuning || run.tournament || isDissonantRun(run) || run.wave <= s.introSprintWaves || run.coinsEarned <= 0) return [];
        const p = projectRun(c, s, run.wave, run.tier);
        return [{
            index, run,
            predictedKills: p.kills,
            predictedCoins: p.coins,
            killError: run.totalEnemies > 0 ? p.kills / run.totalEnemies - 1 : 0,
            coinError: p.coins / run.coinsEarned - 1,
        }];
    });
}

const meanAbs = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + Math.abs(x), 0) / xs.length : 0);

export interface RunModel {
    calibration: RunCalibration;
    checks: RunCheck[];
    // Mean |coin error| on the other runs for each coins-per-kill rule
    // (null when there's no other run to test on).
    fit: Record<CoinGrowth, number | null>;
}

// Tunes on one run and picks the coins-per-kill rule that predicts the
// other runs best (the wiki's flat values when there's nothing to compare).
export function buildRunModel(runs: BattleReport[], tuning: number, s: RunModelSettings): RunModel | null {
    const run = runs[tuning];
    if (!run) return null;
    const flat = calibrateRun(run, s, 'flat');
    const wave = calibrateRun(run, s, 'wave');
    if (!flat || !wave) return null;
    const flatChecks = checkRuns(flat, s, runs, tuning);
    const waveChecks = checkRuns(wave, s, runs, tuning);
    const fit = {
        flat: flatChecks.length ? meanAbs(flatChecks.map(x => x.coinError)) : null,
        wave: waveChecks.length ? meanAbs(waveChecks.map(x => x.coinError)) : null,
    };
    const useWave = fit.wave !== null && fit.flat !== null && fit.wave < fit.flat;
    return useWave
        ? { calibration: wave, checks: waveChecks, fit }
        : { calibration: flat, checks: flatChecks, fit };
}
