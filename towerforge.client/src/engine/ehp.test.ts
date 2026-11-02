// eHP: what the run says about Flame Bot and Chain Thunder (how much of
// the damage that reached them each cut), how much of the hits that covers,
// and what a higher Flame Bot level or Chain Thunder lab then cuts — plus
// lifesteal healing at the run's rate. Made-up runs.

import { describe, expect, it } from 'vitest';
import { useGameStore } from '../store/useGameStore';
import { readActiveModuleBonuses } from './modBonuses';
import { buildEhpCalibration, cutsRatio, ehpScore, readEhpInputs } from './ehp';
import type { EhpInputs } from './ehp';
import type { OptimizerSnapshot } from './optimizer';
import { parseGameExport } from './gameExport';
import { battle, makeExport } from '../test/makeExport';
import { WS_STATS } from '../constants/gameData';

const run = (fields: Record<string, unknown>) => parseGameExport(makeExport({
    BattleHistory: [battle({ Wave: 5000, GameTime: 150000, TotalEnemies: 100000, ...fields })],
})).battles[0];

function snapshot(edit?: (s: OptimizerSnapshot) => void): OptimizerSnapshot {
    const st = useGameStore.getState();
    const snap = {
        presetIdx: 0,
        wsData: JSON.parse(JSON.stringify(st.wsData)),
        enhData: JSON.parse(JSON.stringify(st.enhData)),
        labData: { 'CL-Chain Thunder': 5 },
        cardData: { data: {}, slots: 1, presets: { 0: [] } },
        perkData: { banned: [] },
        uwData: { stones: 0, data: {} },
        relicData: {},
        modBonuses: readActiveModuleBonuses(st.moduleState, { banned: [] }, {}, { data: {}, slots: 1, presets: {} }, undefined),
        moduleState: JSON.parse(JSON.stringify(st.moduleState)),
        botData: { 'Flame Bot': { owned: true, medals: [10, 0, 0, 0], plusLv: 0 } },
        metric: 'ehp',
    } as unknown as OptimizerSnapshot;
    snap.wsData[0].defense[WS_STATS.defense.findIndex(([n]) => n === 'Health')] = 500;
    edit?.(snap);
    return snap;
}

// 1000 reached Chain Thunder: it blocked 100 (10%); 900 reached Flame Bot,
// which blocked 450 (50%); 450 landed.
const cutRun = () => run({
    ChainThunderBlocked: 100, FlameBotBlocked: 450, DamageTaken: 400, DamageTakenWall: 50,
});

describe('Flame Bot and Chain Thunder (eHP)', () => {
    it('reads how much of the hits each covers from the run', () => {
        const calib = buildEhpCalibration(snapshot(), cutRun());
        // Flame Bot level 10: 50% reduction → its 50% cut covers all hits.
        expect(calib.anchor.flameReduction).toBeCloseTo(0.5, 10);
        expect(calib.flameCover).toBeCloseTo(1, 10);
        // Chain Thunder lab 5: cap 15%; the run's 10% cut covers two thirds of the hits.
        expect(calib.anchor.chainThunderCap).toBeCloseTo(0.15, 10);
        expect(calib.chainThunderCover).toBeCloseTo(0.1 / 0.15, 10);
    });

    it('turns a higher Flame Bot level or Chain Thunder lab into less damage landing', () => {
        const calib = buildEhpCalibration(snapshot(), cutRun());
        const flame20 = readEhpInputs(snapshot(s => { s.botData['Flame Bot']!.medals = [20, 0, 0, 0]; }));
        // 50% → 80% reduction on all hits: (1 − 0.8) ÷ (1 − 0.5) of the damage lands.
        expect(cutsRatio(flame20, calib)).toBeCloseTo(0.2 / 0.5, 10);
        const thunder10 = readEhpInputs(snapshot(s => { s.labData = { 'CL-Chain Thunder': 10 }; }));
        // Cap 30% × two-thirds coverage = 20% cut against the run's 10%.
        expect(cutsRatio(thunder10, calib)).toBeCloseTo(0.8 / 0.9, 10);
        expect(ehpScore(snapshot(s => { s.labData = { 'CL-Chain Thunder': 10 }; }), calib)).toBeCloseTo(0.9 / 0.8, 6);
    });

    it('changes nothing without a cut in the run', () => {
        const calib = buildEhpCalibration(snapshot(), run({ DamageTaken: 400 }));
        expect(calib.flameCover).toBe(0);
        expect(cutsRatio({ flameReduction: 0.95, chainThunderCap: 0.9 } as EhpInputs, calib)).toBe(1);
    });
});

describe('healing the run shows', () => {
    it('counts lifesteal and Death Wave healing per second of the run', () => {
        const calib = buildEhpCalibration(snapshot(), run({ Lifesteal: 3e6, HealthFromDeathWaveThisRound: 1.5e6 }));
        expect(calib.otherHealPerSec).toBeCloseTo(4.5e6 / 150000, 10);
    });
});

describe('perks in eHP', () => {
    it('counts the regen trade-off as the game shows it: x8.80 at Improve Tradeoff Perks 10', () => {
        const parts = readEhpInputs(snapshot(s => { s.labData['Improve Tradeoff Perks'] = 10; })).parts;
        expect(parts.regen.find(f => f.label.startsWith('Trade-off: Regen'))!.value).toBeCloseTo(8.8, 10);
        expect(parts.health.find(f => f.label.startsWith('Trade-off: Regen'))!.value).toBeCloseTo(0.4, 10);   // −60%
    });
});
