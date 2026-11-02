// The run in progress: the game's counters read as a run, what's kept across
// imports, and a run's kills and cash lines. Made-up numbers, in the shape of
// the owner's export of 2026-11-01.

import { beforeEach, describe, expect, it } from 'vitest';
import { liveBattle, livePerks, liveUpgrades } from './liveRun';
import { lastFinishedOn, parseGameExport } from './gameExport';
import { coinSources } from './coinSources';
import { damageLayers } from './damageLayers';
import { enemiesReachedText, killsBySource, killsBySourceText, runCashText } from './battleReport';
import { runsReport } from '../ai/aiTools';
import { useGameStore } from '../store/useGameStore';
import { battle, makeExport } from '../test/makeExport';

const AT = '2026-11-01T14:29:16.105Z';
const LIVE = {
    ExportedAt: AT, RoundActiveBool: true, CurrentTier: 18, CurrentWave: 3141, PerksPickedCount: 52,
    GameplayTimeThisRound: 32151, RealTimeThisRound: 6446, CoinsEarnedThisRound: 1000, CellsEarnedThisRound: 357333,
    CoinsEarnedWaveSkipThisRound: 366, CoinsEarnedCPWThisRound: 1, GoldenTowerPlusCoinsThisRound: 453, GoldenTowerCoinsThisRound: 30,
    TotalEnemiesDestroyedThisRound: 1000, EnemiesDestroyedByOrbsThisRound: 428, EnemiesDestroyedByChainLightningThisRound: 379, EnemiesDestroyedByOtherThisRound: 193,
    EnemiesHitByBlackHoleThisRound: 970, OrbHitsThisRound: 860, WavesSkippedThisRound: 2075,
    DamageDealtThisRound: 1000, TotalDamageByChainLightningThisRound: 339, DamageByOrbsThisRound: 524,
    DefensePercentBlockedThisRound: 900, DamageTakenThisRound: 100, ChronoFieldBlockedThisRound: 250,
    CashEarnedThisRound: 9e11, CashEarnedFromInterestThisRound: 3e7, GoldenTowerCashThisRound: 2e11,
    FreeAttackUpgradesThisRound: 299, FreeDefenseUpgradesThisRound: 0, FreeUtilityUpgradesThisRound: 267,
};

describe('liveBattle', () => {
    it('is null without a run going', () => {
        expect(liveBattle({ ...LIVE, RoundActiveBool: false })).toBeNull();
        expect(liveBattle({})).toBeNull();
    });

    it('names the counters as a finished run names them', () => {
        const b = liveBattle(LIVE)!;
        expect(b.Tier).toBe(18);
        expect(b.Wave).toBe(3141);
        expect(b.GameTime).toBe(32151);
        expect(b.TotalEnemies).toBe(1000);
        expect(b.DestroyedByOrbs).toBe(428);
        expect(b.ChainLightningDamage).toBe(339);
        expect(b.CoinsFromGoldenTowerPlus).toBe(453);
        expect(b.CoinsEarned).toBe(1000);
        expect(b.EnemiesHitByBlackHoleThisRound).toBe(970);
        expect(b.CellsEarned).toBe(357333);
    });

    it('reads the run\'s level skips, which keep their own names', () => {
        const b = liveBattle({ ...LIVE, EnemyAttackLevelSkips: 1892, EnemyHealthLevelSkips: 1900 })!;
        expect(b.AttackLevelSkips).toBe(1892);
        expect(b.HealthLevelSkips).toBe(1900);
    });
});

describe('the run\'s levels and perks', () => {
    // T18 W3141: the differences are exactly its 299 attack and 267 utility free upgrades.
    const levels = {
        UpgradeWorkshopLevel: [6000, 99, 79, 150, 0, 200, 99, 7, 85, 99, 85, 7, 60, 100, 120, 299, 0, 0, 0, 0],
        UpgradeLevel: [6000, 99, 79, 150, 0, 200, 99, 7, 85, 99, 85, 7, 60, 100, 120, 299, 299, 0, 0, 0],
        UpgradeWorkshopDefenseLevel: [6000], UpgradeDefenseLevel: [6000],
        UpgradeWorkshopUtilityLevel: [149, 149, 149, 149, 99, 99, 99, 99, 300, 500, 60, 530, 601],
        UpgradeUtilityLevel: [149, 149, 149, 149, 99, 99, 99, 99, 300, 500, 60, 699, 699],
    };

    it('names the stats the run raised', () => {
        expect(liveUpgrades(levels)).toEqual([
            { stat: 'Rend Armor Mult', from: 0, to: 299 },
            { stat: 'Enemy Atk Level Skip', from: 530, to: 699 },
            { stat: 'Enemy HP Level Skip', from: 601, to: 699 },
        ]);
        const gained = liveUpgrades(levels).reduce((sum, u) => sum + u.to - u.from, 0);
        expect(gained).toBe(299 + 267);
    });

    it('is empty with no arrays or no difference', () => {
        expect(liveUpgrades({})).toEqual([]);
        expect(liveUpgrades({ UpgradeLevel: [5], UpgradeWorkshopLevel: [5] })).toEqual([]);
    });

    it('names the perks it can, and counts the rest', () => {
        const p = livePerks({ PerksPicked: [
            { Wave: 180, Perk: 10 }, { Wave: 270, Perk: 12 }, { Wave: 400, Perk: 3 }, { Wave: 530, Perk: 3 },
            { Wave: 660, Perk: 25 }, { Wave: 700, Perk: 0 }, { Wave: 800, Perk: 8 }, null,
        ] })!;
        expect(p.named).toEqual([
            { name: 'Perk Wave Requirement', count: 1 },
            { name: 'Max Game Speed', count: 1 },
            { name: 'All Coin Bonuses ×1.15', count: 2 },
            { name: 'CL Damage ×2', count: 1 },
        ]);
        expect(p.unnamed).toBe(3);
        expect(livePerks({})).toBeNull();
    });
});

describe('the import', () => {
    const imp = parseGameExport(makeExport(LIVE));

    it('reads the run in progress as a report', () => {
        const r = imp.liveRun!.report;
        expect(imp.liveRun!.at).toBe(Date.parse(AT));
        expect(imp.liveRun!.perks).toBe(52);
        expect(r.tier).toBe(18);
        expect(r.wave).toBe(3141);
        expect(r.gameTimeSec).toBe(32151);
        expect(r.coinsPerHour).toBeCloseTo(1000 / 6446 * 3600, 6);
        expect(r.damage?.chainLightning).toBe(339);
    });

    it('feeds the same readers a finished run does', () => {
        const r = imp.liveRun!.report;
        expect(coinSources(r)?.combo).toBe(453);
        expect(damageLayers(r)?.defPct).toBeCloseTo(0.9, 9);
        expect(enemiesReachedText(r, ', ')).toMatch(/^Black Hole 97%, Orbs 86%/);
    });

    it('is null when no run is going', () => {
        expect(parseGameExport(makeExport({ ...LIVE, RoundActiveBool: false })).liveRun).toBeNull();
        expect(parseGameExport(makeExport({ RoundActiveBool: true })).liveRun).toBeNull();
    });
});

describe('a run\'s kills and cash', () => {
    const run = parseGameExport(makeExport({ BattleHistory: [battle({
        TotalEnemies: 1000, DestroyedByOrbs: 650, DestroyedByChainLightning: 300, DestroyedByThorns: 1, DestroyedByOther: 49,
        CashEarned: 1.6e13, InterestEarned: 3e7, CashFromGoldenTower: 2.5e12, FreeAttackUpgrades: 299, FreeDefenseUpgrades: 0, FreeUtilityUpgrades: 267,
    })] })).battles[0];

    it('lists what made the kills, biggest first, small ones left out', () => {
        expect(killsBySource(run).map(([n]) => n)).toEqual(['Orbs', 'Chain Lightning', 'Other']);
        expect(killsBySourceText(run, ' · ')).toBe('Orbs 65% · Chain Lightning 30% · Other 5%');
    });

    it('sums cash and free upgrades', () => {
        expect(runCashText(run, ' · ')).toMatch(/^16\.00T · Golden Tower 2\.50T · interest 30\.00M · free upgrades: 299 Attack, 0 Defense, 267 Utility$/);
    });

    it('says nothing without the lines', () => {
        const bare = parseGameExport(makeExport({ BattleHistory: [battle({})] })).battles[0];
        expect(killsBySourceText(bare, ' · ')).toBe('');
        expect(runCashText(bare, ' · ')).toBe('');
    });
});

describe('lastFinishedOn', () => {
    const runs = parseGameExport(makeExport({ BattleHistory: [
        battle({ Tier: 18, Wave: 9000, CoinsEarned: 4e18, RealTime: 30000 }),
        battle({ Tier: 18, Wave: 9500, CoinsEarned: 5e18, RealTime: 30000 }),
        battle({ Tier: 18, Wave: 9400, CoinsEarned: 4.5e18, RealTime: 30000 }),
        battle({ Tier: 18, Wave: 50, CoinsEarned: 1e10, RealTime: 100 }),
        battle({ Tier: 20, Wave: 4000, CoinsEarned: 1e15, RealTime: 20000 }),
        battle({ Tier: 18, Wave: 300, IsTournament: true }),
    ] })).battles;

    it('takes the middle of the recent long campaign runs on the tier', () => {
        const f = lastFinishedOn(runs, 18)!;
        expect(f).toMatchObject({ runs: 3, wave: 9400, coins: 4.5e18 });
        expect(f.coinsPerHour).toBeCloseTo(4.5e18 / 30000 * 3600, -14);
    });

    it('is null without one', () => {
        expect(lastFinishedOn(runs, 5)).toBeNull();
    });
});

describe('the store', () => {
    beforeEach(() => useGameStore.getState().resetAll());
    const store = () => useGameStore.getState();

    it('keeps the run in progress until a file says none is going', () => {
        store().applyGameImport(parseGameExport(makeExport(LIVE)));
        expect(store().liveRun?.report.wave).toBe(3141);
        store().applyGameImport(parseGameExport(makeExport({ ...LIVE, RoundActiveBool: false })));
        expect(store().liveRun).toBeNull();
    });

    it('goes through a backup', () => {
        store().applyGameImport(parseGameExport(makeExport(LIVE)));
        const backup = store().exportData();
        store().resetAll();
        expect(store().importData(backup)).toBe(true);
        expect(store().liveRun?.report.wave).toBe(3141);
    });
});

describe('Ask AI', () => {
    it('knows a run is going, and reads kills', () => {
        const s = useGameStore.getState();
        s.resetAll();
        const imp = parseGameExport(makeExport({ ...LIVE, BattleHistory: [battle({ Wave: 8000, BattleDate: '2026-10-31T10:00:00Z', DestroyedByOrbs: 200000, DestroyedByOther: 100000 })] }));
        useGameStore.getState().applyGameImport(imp);
        const text = runsReport(useGameStore.getState()).text;
        expect(text).toMatch(/A run was in progress at the last import: T18 W3,141, 8\.9 h of game time, [\d.]+\w* coins, 52 perks picked\./);
        expect(text).toMatch(/Kills on the newest campaign run \(W8,000\): Orbs 67%, Other 33%\./);
    });
});
