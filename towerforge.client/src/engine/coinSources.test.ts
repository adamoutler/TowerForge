// Coins by source: the game's coin lines against the coin model. Anchored on the
// owner's runs (export of 2026-11-01): T18 W9302 on their farm preset, Golden Bot
// Bonus ×8 with Bot Bot ×2 running beside it, and T20 W4537 on a preset with
// Golden Bot at its base ×2 and the same Bot Bot.

import { describe, expect, it } from 'vitest';
import { coinSources } from './coinSources';
import { buildFarmCalibration, coinFactors, coinRate } from './farming';
import { battleToReportForTest } from './coinSources.fixture';
import { calcTowerDamage } from './towerDamage';
import { snapshotFromState } from './accountModels';
import { useGameStore } from '../store/useGameStore';
import { BENCH_ACCOUNTS } from '../ai/bench/benchAccounts';
import { parseGameExport } from './gameExport';
import { runsReport } from '../ai/aiTools';
import type { OptimizerSnapshot } from './optimizer';

// T18 W9302, the lines rounded to 4 figures.
const farmRun = () => battleToReportForTest({
    CoinsEarned: 4.079e18, CoinsEarnedWaveSkip: 1.47e18, CoinsFromGoldenTowerPlus: 1.935e18,
    GuardianCoinsFetched: 4.457e15, CoinsEarnedCPW: 3.109e11, CoinsFromCritCoin: 1.71e16,
    CoinsFromGoldenTower: 6.499e17, CoinsFromDeathWave: 3.315e17, CoinsFromBlackHole: 6.074e17,
    CoinsFromSpotlight: 4.176e17, CoinsFromOrbs: 1.799e17, GoldenBotCoinsEarned: 5.785e17,
    TotalEnemies: 1.437e6, DestroyedInGoldenTower: 1.437e6, TaggedByDeathwave: 9.41e5, DestroyedInSpotlight: 1.198e6,
    DestroyedInGoldenBot: 7.241e5, DestroyedInBlackhole: 1.386e6, DestroyedInOrbs: 1.235e6,
});

// A kill share and a multiplier give an average × on kill coins.
const average = (share: number, mult: number) => 1 + share * (mult - 1);

describe('the game\'s coin lines', () => {
    it('split the coins into kill coins, Golden Combo, Wave Skip and Fetch', () => {
        const s = coinSources(farmRun())!;
        expect(s.kill / s.total).toBeCloseTo(0.164, 3);
        expect(s.combo / s.total).toBeCloseTo(0.474, 3);
        expect(s.skip / s.total).toBeCloseTo(0.360, 3);
    });

    it('land on the kill share × multiplier the coin model uses', () => {
        const f = coinSources(farmRun())!.factor;
        const run = farmRun();
        const k = run.killedWithEffect;
        // Death Wave ×2.5, Spotlight ×3, Black Hole ×11 on the owner's labs.
        expect(f.dw! / average(k.deathWave!, 2.5)).toBeCloseTo(1, 1);
        expect(f.sl! / average(k.spotlight!, 3)).toBeCloseTo(1, 1);
        expect(f.bh! / average(k.blackHole!, 11)).toBeCloseTo(1, 1);
        // Orbs read a little high, on a small line.
        expect(f.orb!).toBeGreaterThan(average(k.orbs!, 1.4));
    });

    it('pay Golden Bot more than its own bonus: Bot Bot boosts it', () => {
        const run = farmRun();
        const f = coinSources(run)!.factor.gb!;
        const paid = 1 + (f - 1) / run.killedWithEffect.goldenBot!;
        expect(paid).toBeCloseTo(13.7, 0);                                        // ×8 alone would be 8
        // The other preset: Golden Bot ×2 at base, Bot Bot ×2, and a small Golden Bot range inside Bot Bot's.
        const other = battleToReportForTest({
            CoinsEarned: 6.614e14, CoinsEarnedWaveSkip: 2.361e14, CoinsFromGoldenTowerPlus: 1.617e14, CoinsEarnedCPW: 3.496e10,
            CoinsFromGoldenTower: 1e13, GoldenBotCoinsEarned: 3.399e13, TotalEnemies: 2.533e5, DestroyedInGoldenBot: 1.427e4,
        });
        const paidOther = 1 + (coinSources(other)!.factor.gb! - 1) / other.killedWithEffect.goldenBot!;
        expect(paidOther).toBeGreaterThan(3);                                     // ×2 alone would be 2
        expect(paidOther).toBeLessThan(4.5);
    });

    it('are null for a run without them', () => {
        expect(coinSources(battleToReportForTest({ CoinsEarned: 1e15, TotalEnemies: 1000 }))).toBeNull();
    });
});

// Golden Bot at Bonus ×8 (Lv 30) on the bench account, with or without Bot Bot.
function account() {
    const a = BENCH_ACCOUNTS.find(x => x.key === 'late')!;
    useGameStore.getState().resetAll();
    useGameStore.getState().applyGameImport(parseGameExport(a.raw));
    return useGameStore.getState();
}
function snap(botBot: number | null): OptimizerSnapshot {
    const s = snapshotFromState(account());
    s.botData = {
        ...s.botData,
        'Amplify Bot': { owned: false, medals: [], plusLv: 0 },
        'Golden Bot': { owned: true, medals: [19, 15, 30, 20], plusLv: 0 },
        ...(botBot !== null ? { 'Bot Bot': { owned: true, medals: [18, 15, botBot, 20], plusLv: 0 } } : { 'Bot Bot': { owned: false, medals: [], plusLv: 0 } }),
    };
    return s;
}

describe('Bot Bot in the coin model', () => {
    it('measures how much of Golden Bot it reaches from the run', () => {
        const cal = buildFarmCalibration(snap(19), farmRun());
        expect(cal.botBotOverlap).toBeCloseTo(0.71, 1);
        expect(cal.anchor.mult.gb).toBeCloseTo(13.7, 0);
        // So the model's average × on kill coins is the game's.
        expect(coinFactors(snap(19), cal).gb / coinSources(farmRun())!.factor.gb!).toBeCloseTo(1, 2);
    });

    it('leaves Golden Bot alone without Bot Bot', () => {
        const cal = buildFarmCalibration(snap(null), farmRun());
        expect(cal.anchor.mult.gb).toBe(8);
    });

    it('takes a usual overlap when a run has no coin lines', () => {
        const pasted = { ...farmRun(), raw: undefined };
        expect(buildFarmCalibration(snap(19), pasted).botBotOverlap).toBeCloseTo(0.7, 9);
        expect(buildFarmCalibration(snap(19), null).botBotOverlap).toBeCloseTo(0.7, 9);
    });

    const withBot = (s: OptimizerSnapshot, name: string, medals: number[]) => ({
        ...s, botData: { ...s.botData, [name]: { owned: true, medals, plusLv: 0 } },
    });

    it('values Bot Bot\'s Bonus for coins, where it wasn\'t worth anything', () => {
        const base = snap(10);
        const cal = buildFarmCalibration(base, farmRun());
        expect(coinRate(base, cal)).toBeCloseTo(1, 6);
        expect(coinRate(withBot(base, 'Bot Bot', [18, 15, 11, 20]), cal)).toBeGreaterThan(1);
    });

    it('values its reach: more Bot Bot uptime or range covers more of Golden Bot', () => {
        const base = snap(19);
        const cal = buildFarmCalibration(base, farmRun());
        expect(coinRate(withBot(base, 'Bot Bot', [18, 15, 19, 10]), cal)).toBeLessThan(1);
    });
});

describe('Bot Bot and tower damage', () => {
    const damage = (s: OptimizerSnapshot) => calcTowerDamage(s.presetIdx, s.wsData, s.labData, s.cardData, s.relicData, s.enhData, s.modBonuses, s.moduleState, s.botData);

    // Wiki: "Increases the bonus of other bots in range". The old code gave the tower Bot Bot's
    // bonus with no Amplify Bot, from an old table.
    it('adds nothing without Amplify Bot', () => {
        const s = snap(19);
        const none = { ...s, botData: { ...s.botData, 'Bot Bot': { owned: false, medals: [], plusLv: 0 } } };
        expect(damage(s)).toBe(damage(none));
    });

    it('multiplies Amplify Bot, at the game\'s values', () => {
        const s = snap(null);
        const amp = { ...s, botData: { ...s.botData, 'Amplify Bot': { owned: true, medals: [0, 0, 30, 0], plusLv: 0 } } };
        const both = { ...amp, botData: { ...amp.botData, 'Bot Bot': { owned: true, medals: [0, 0, 19, 0], plusLv: 0 } } };
        expect(damage(amp) / damage(s)).toBeCloseTo(15.5, 6);
        expect(damage(both) / damage(amp)).toBeCloseTo(2, 6);
    });
});

describe('Ask AI', () => {
    it('reads where the coins came from', () => {
        const s = account();
        const run = { ...farmRun(), time: Date.now(), tier: 18, wave: 9302 };
        const text = runsReport({ ...s, importedBattles: [run] }).text;
        expect(text).toMatch(/Coins on the newest campaign run \(T18 W9,302\): Golden Combo 47%, Wave Skip 36%, kill coins 16%\./);
        expect(text).toMatch(/average × on kill coins: Golden Tower ×[\d.]+, Black Hole ×[\d.]+, Golden Bot ×[\d.]+, Spotlight ×[\d.]+, Death Wave ×[\d.]+, Orbs ×[\d.]+\./);
    });
});
