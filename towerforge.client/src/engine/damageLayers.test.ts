// What blocked the damage: the game's lines on the owner's runs (export of
// 2026-11-01, rounded to 4 figures), read with Defense % last, against their
// labs (Chrono Field 23%, Chain Thunder at most 24%). Then what the survival
// model takes from them, on made-up towers.

import { describe, expect, it } from 'vitest';
import { damageLayers } from './damageLayers';
import { enemiesReached, enemiesReachedText } from './battleReport';
import { buildEhpCalibration, chronoInRun, cutsRatio, defPctInRun, ehpScore } from './ehp';
import type { EhpInputs } from './ehp';
import { readActiveModuleBonuses } from './modBonuses';
import { parseGameExport } from './gameExport';
import { runsReport } from '../ai/aiTools';
import { battle, makeExport } from '../test/makeExport';
import { useGameStore } from '../store/useGameStore';
import { UW_STAT_VALUES, WS_STATS } from '../constants/gameData';
import type { OptimizerSnapshot } from './optimizer';

const run = (fields: Record<string, unknown>) => parseGameExport(makeExport({
    BattleHistory: [battle({ Wave: 5000, GameTime: 150000, TotalEnemies: 100000, ...fields })],
})).battles[0];

// T18 W9302: a farm run with every perk.
const FARM = {
    DefensePercentBlocked: 4.445e23, DefenseAbsoluteBlocked: 1e9, ChronoFieldBlocked: 1.12e23, ChainThunderBlocked: 1.012e23,
    DamageTaken: 1.303e22, DamageTakenWall: 6.274e21,
};
// A Tier 23 tournament, W245: no Defense % perk picked yet.
const TOURNEY = {
    DefensePercentBlocked: 1.025e33, ChronoFieldBlocked: 3.306e32, ChainThunderBlocked: 1.1e28, FlameBotBlocked: 3e27,
    DamageTaken: 3.174e32, DamageTakenWall: 1.846e28,
};

describe('the game\'s blocked lines', () => {
    it('fit the labs with Defense % last', () => {
        const farm = damageLayers(run(FARM))!;
        expect(farm.chrono).toBeCloseTo(0.1654, 3);       // under the lab's 23%
        expect(farm.chainThunder).toBeCloseTo(0.1791, 3); // under the lab's 24%
        expect(farm.defPct).toBeCloseTo(0.9584, 3);
        expect(farm.landed / farm.total).toBeCloseTo(0.0285, 3);
        // With Defense % first, the same lines would read Chrono Field 48% and Chain Thunder 84%.
        const lands = FARM.DamageTaken + FARM.DamageTakenWall;
        expect(FARM.ChainThunderBlocked / (FARM.ChainThunderBlocked + lands)).toBeGreaterThan(0.8);
    });

    it('show Defense % before any perk on Tier 23', () => {
        const t = damageLayers(run(TOURNEY))!;
        expect(t.defPct).toBeCloseTo(0.7635, 3);          // sources without a perk: 77.3
        expect(t.chrono).toBeCloseTo(0.1976, 3);
    });

    it('are null without damage or the lines', () => {
        expect(damageLayers(run({}))).toBeNull();
        expect(damageLayers({ raw: undefined })).toBeNull();
    });

    it('have no Defense % reading when no hit reached it', () => {
        expect(damageLayers(run({ DamageTaken: 1e12 }))!.defPct).toBeNull();
    });
});

// A tower with a small health pool, Chrono Field at the lab's 23%, Chain Thunder 24%, and a Defense % perk.
function snapshot(edit?: (s: OptimizerSnapshot) => void): OptimizerSnapshot {
    const st = useGameStore.getState();
    const snap = {
        presetIdx: 0,
        wsData: JSON.parse(JSON.stringify(st.wsData)),
        enhData: JSON.parse(JSON.stringify(st.enhData)),
        labData: { 'CL-Chain Thunder': 8, 'Standard Perk Bonus': 25, 'CF-Dmg Reduction(unlock)': 1, 'CF-Reduction %': 26 },
        cardData: { data: {}, slots: 1, presets: { 0: [] } },
        perkData: { banned: [] },
        uwData: { stones: 0, data: {} },
        relicData: { rDefPct: 52.3 },
        modBonuses: readActiveModuleBonuses(st.moduleState, { banned: [] }, {}, { data: {}, slots: 1, presets: {} }, undefined),
        moduleState: JSON.parse(JSON.stringify(st.moduleState)),
        botData: {},
        metric: 'ehp',
    } as unknown as OptimizerSnapshot;
    snap.wsData[0].defense[WS_STATS.defense.findIndex(([n]) => n === 'Health')] = 100;
    edit?.(snap);
    return snap;
}

// With relics at 52.3 and the perk's 25 the sources add up to 77.3, or 52.3 with no perk.
const def = (fields: Record<string, unknown>) => {
    const calib = buildEhpCalibration(snapshot(), run(fields));
    return { calib, inRun: defPctInRun(calib.anchor, calib) };
};
const blocked = (share: number) => ({ DefensePercentBlocked: share * 1e30, DamageTaken: (1 - share) * 1e30 });

describe('Defense % in the survival model', () => {
    it('counts the perk picks the run didn\'t have', () => {
        expect(def(blocked(0.52)).calib.defPicksShort).toBe(5);
        expect(def(blocked(0.52)).inRun).toBeCloseTo(0.523, 6);
        expect(def(blocked(0.625)).calib.defPicksShort).toBe(3);
        expect(def(blocked(0.625)).inRun).toBeCloseTo(0.623, 6);
    });

    it('leaves a gap under one pick to the reading\'s blur', () => {
        expect(def(blocked(0.74)).calib.defPicksShort).toBe(0);
        expect(def(blocked(0.74)).inRun).toBeCloseTo(0.773, 6);
    });

    it('takes nothing from a run whose damage never came near the tower\'s health', () => {
        expect(def({ DefensePercentBlocked: 1, DamageTaken: 3 }).calib.defPicksShort).toBe(0);
    });

    it('takes nothing from a run with the perk banned', () => {
        const calib = buildEhpCalibration(snapshot(s => { s.perkData = { banned: ['defpct'] }; }), run(blocked(0.2)));
        expect(calib.defPicksShort).toBe(0);
    });

    it('values a Defense % relic more when the run was far from the cap', () => {
        const better = snapshot(s => { s.relicData = { rDefPct: 53.3 }; });
        const short = buildEhpCalibration(snapshot(), run(blocked(0.52)));
        const full = buildEhpCalibration(snapshot(), run(blocked(0.77)));
        // 47.7% through → 46.7%, against 22.7% → 21.7%; the short run values the point less per hit.
        expect(ehpScore(better, short)).toBeCloseTo(0.477 / 0.467, 3);
        expect(ehpScore(better, full)).toBeCloseTo(0.227 / 0.217, 3);
    });
});

describe('Chrono Field in the survival model', () => {
    const withChrono = () => snapshot(s => { s.uwData = { stones: 0, data: { CF: { own: true, sv: [UW_STAT_VALUES.CF[0].length, 0, UW_STAT_VALUES.CF[2].length], lv: 0 } } } as unknown as OptimizerSnapshot['uwData']; });

    it('counts the share of hits it covered', () => {
        const calib = buildEhpCalibration(withChrono(), run({ ...blocked(0.8), ChronoFieldBlocked: 1e29 }));
        const a = calib.anchor;
        expect(a.cfReduction).toBeGreaterThan(0.1);
        expect(calib.chronoCover).toBeCloseTo((1 / 11) / a.cfReduction, 6);
        expect(chronoInRun(a, calib)).toBeCloseTo(1 / 11, 6);
    });

    it('takes the lab × uptime as it is from a run with no real damage', () => {
        const calib = buildEhpCalibration(withChrono(), run({ DefensePercentBlocked: 1, DamageTaken: 3, ChronoFieldBlocked: 0.1 }));
        expect(calib.chronoCover).toBeUndefined();
        expect(chronoInRun(calib.anchor, calib)).toBe(calib.anchor.cfReduction);
    });
});

describe('Chain Thunder in the survival model', () => {
    it('reads its coverage against the lab, whatever CL\'s share of the damage', () => {
        // A tournament on the owner's account: CL 0.046% of the damage, a 21% cut.
        const fields = { ...blocked(0.77), ChainThunderBlocked: 0.27e30, DamageDealt: 1e6, ChainLightningDamage: 460 };
        const calib = buildEhpCalibration(snapshot(), run(fields));
        expect(calib.layers!.chainThunder).toBeCloseTo(0.2126, 3);
        expect(calib.chainThunderCover).toBeCloseTo(0.2126 / 0.24, 3);
        // The next lab level moves the cut by that coverage.
        const next = { ...calib.anchor, chainThunderCap: 0.27 } as EhpInputs;
        const cover = calib.chainThunderCover!;
        expect(cutsRatio(next, calib)).toBeCloseTo((1 - cover * 0.27) / (1 - cover * 0.24), 6);
    });
});

// A Tier 23 tournament on the owner's account, W245.
const REACH = {
    TotalEnemies: 10100, EnemiesHitByChainLightningThisRound: 10000, EnemiesHitByBlackHoleThisRound: 7575, OrbHits: 7272,
    EnemiesHitByDeathRayThisRound: 4444, EnemiesHitByFlameBotThisRound: 404, EnemiesHitByThunderBotThisRound: 303,
    EnemiesHitByThornsThisRound: 10, ThunderBotStuns: 354,
};

describe('enemies reached', () => {
    it('lists each weapon\'s share of the enemies, biggest first, small ones left out', () => {
        expect(enemiesReached(run(REACH)).map(([n]) => n)).toEqual(['Chain Lightning', 'Black Hole', 'Orbs', 'Death Ray', 'Flame Bot', 'Thunder Bot']);
        expect(enemiesReachedText(run(REACH), ' · ')).toBe('Chain Lightning 99% · Black Hole 75% · Orbs 72% · Death Ray 44% · Flame Bot 4% · Thunder Bot 3%');
    });

    it('stops at everyone: short runs count a little over', () => {
        expect(enemiesReached(run({ TotalEnemies: 100, EnemiesHitByChronoFieldThisRound: 103 }))).toEqual([['Chrono Field', 1]]);
    });

    it('is empty without the lines or the enemies', () => {
        expect(enemiesReached(run({}))).toEqual([]);
        expect(enemiesReached(run({ TotalEnemies: 0, OrbHits: 5 }))).toEqual([]);
    });
});

describe('Ask AI', () => {
    it('reads what each weapon reached and Thunder Bot\'s stuns', () => {
        const s = useGameStore.getState();
        const text = runsReport({ ...s, importedBattles: [{ ...run(REACH), time: 1, wave: 245, tournament: true }] }).text;
        expect(text).toMatch(/Enemies each weapon reached on the newest tournament run \(W245\): Chain Lightning 99%, Black Hole 75%, Orbs 72%, Death Ray 44%, Flame Bot 4%, Thunder Bot 3%\. Thunder Bot stunned 354 times\./);
    });

    it('reads what blocked the damage', () => {
        const s = useGameStore.getState();
        const text = runsReport({ ...s, importedBattles: [{ ...run(FARM), time: 2, wave: 9302 }, { ...run(TOURNEY), time: 1, wave: 245, tournament: true }] }).text;
        expect(text).toMatch(/Damage blocked on the newest campaign run \(W9,302\), each a share of what reached it: Chrono Field 16\.5%, Chain Thunder 17\.9%, Defense % 95\.8%\. 2\.9% of all the enemy damage landed\./);
        expect(text).toMatch(/Damage blocked on the newest tournament run \(W245\), each a share of what reached it: Chrono Field 19\.8%, Defense % 76\.4%\. 19\.0% of all the enemy damage landed\./);
    });
});
