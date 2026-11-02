// Elite cells per run: the run's cells per elite split into the part the
// Cells/Kill Bonus enhancement multiplies and the Cells card's flat cells
// (wiki Currencies page), so an upgrade changes the right part. Also the
// Optimizer's "More Elite Cells" goal, which scores the same sum.

import { describe, expect, it } from 'vitest';
import { buildCellCalibration, cellParts, cellScore, cellsPerRun } from './cells';
import { applyGoal, runModels, snapshotFromState } from './accountModels';
import { buildCandidates, goalScore } from './optimizer';
import type { OptimizerSnapshot } from './optimizer';
import { parseGameExport } from './gameExport';
import { useGameStore } from '../store/useGameStore';
import { battle, makeExport } from '../test/makeExport';
import { BUILD_GOALS, GOAL_LABELS } from '../constants/optimizerConfig';
import { WS_ENH } from '../constants/gameData';

const ENH = WS_ENH.utility.findIndex(([n]) => n === 'Cells/Kill Bonus');
const snap = (enhLv: number | null, cardStars = 0) => {
    const d: number[] = [];
    const u: boolean[] = [];
    if (enhLv !== null) { d[ENH] = enhLv; u[ENH] = true; }
    return {
        presetIdx: 0,
        enhData: { d: { utility: d }, u: { utility: u } },
        cardData: { data: cardStars ? { Cells: { s: cardStars } } : {}, slots: 1, presets: { 0: cardStars ? ['Cells'] : [] } },
    } as unknown as OptimizerSnapshot;
};
// 1,000 elites gave 20,000 cells.
const report = parseGameExport(makeExport({ BattleHistory: [battle({ CellsEarned: 20000, TotalElites: 1000 })] })).battles[0];

describe('elite cells per run', () => {
    it('reads the enhancement and the card', () => {
        expect(cellParts(snap(50, 7))).toEqual({ enhancement: 1.5, card: 14, mastery: 1, bonusCells: 1, goldenBot: 0 });
        expect(cellParts(snap(null))).toEqual({ enhancement: 1, card: 0, mastery: 1, bonusCells: 1, goldenBot: 0 });
    });

    it('scales the multiplied part with the enhancement and adds the card after it', () => {
        // 20 a elite = k × 1.5 + 14 → k = 4; at ×2: 4 × 2 + 14 = 22 a elite.
        expect(cellsPerRun(snap(50, 7), snap(100, 7), report)!.to).toBeCloseTo(22000, 6);
        // Without the card: 20 = k × 1.5 → k = 13.33; at ×2: 26.67 a elite.
        expect(cellsPerRun(snap(50), snap(100), report)!.to).toBeCloseTo(20000 * 2 / 1.5, 6);
        expect(cellsPerRun(snap(50), snap(50), report)!.to).toBeCloseTo(20000, 6);
    });

    it('says nothing without cells or elites in the run', () => {
        const empty = parseGameExport(makeExport({ BattleHistory: [battle({})] })).battles[0];
        expect(cellsPerRun(snap(50), snap(100), empty)).toBeNull();
        expect(cellsPerRun(snap(50), snap(100), null)).toBeNull();
    });

    it('reads the same k for the goal as for What If', () => {
        const cal = buildCellCalibration(snap(50, 7), report)!;
        expect(cal).toEqual({ elites: 1000, k: 4, gbShare: 0, gbReach: 0 });
        expect(cellScore(snap(100, 7), cal)).toBeCloseTo(22000, 6);
        expect(buildCellCalibration(snap(50), null)).toBeNull();
    });
});

// Golden Bot+ Bonus Cells (wiki: Golden Bot): ×1.25 at unlock, +0.05 a level,
// on the elites killed in Golden Bot's range — half the run's kills here.
describe('Golden Bot+ Bonus Cells', () => {
    const inGoldenBot = parseGameExport(makeExport({
        BattleHistory: [battle({ CellsEarned: 20000, TotalElites: 1000, TotalEnemies: 300000, DestroyedInGoldenBot: 150000 })],
    })).battles[0];
    const withBot = (s: OptimizerSnapshot, plusLv: number | null, medals: number[] = []) => ({
        ...s,
        labData: {}, relicData: {}, modBonuses: {},
        botData: { 'Golden Bot': { owned: true, plusOwned: plusLv !== null, medals, plusLv: plusLv ?? 0 } },
    }) as unknown as OptimizerSnapshot;

    it('reads the ability from the wiki ladder', () => {
        expect(cellParts(withBot(snap(null), 0)).bonusCells).toBeCloseTo(1.25, 9);
        expect(cellParts(withBot(snap(null), 25)).bonusCells).toBeCloseTo(2.5, 9);
        expect(cellParts(withBot(snap(null), null)).bonusCells).toBe(1);
        expect(cellParts(withBot(snap(null), 5)).goldenBot).toBeGreaterThan(0);
    });

    it('takes it out of k and multiplies only the elites in range', () => {
        // ×1.5 on half the elites: 20 a elite = k × 1.25 → k = 16. At ×2.5:
        // 16 × (1 + 0.5 × 1.5) = 28 a elite.
        const before = withBot(snap(null), 5);
        expect(buildCellCalibration(before, inGoldenBot)).toMatchObject({ k: 16, gbShare: 0.5 });
        expect(cellsPerRun(before, withBot(snap(null), 25), inGoldenBot)!.to).toBeCloseTo(28000, 6);
        // Unlocking Bot+ (×1.25) on half the elites: × 1.125.
        expect(cellsPerRun(withBot(snap(null), null), withBot(snap(null), 0), inGoldenBot)!.to).toBeCloseTo(22500, 6);
    });

    it('comes before the enhancement and the card', () => {
        // 20 = k × 1.25 × 1.5 + 14 → k = 3.2; at ×2.5: 3.2 × 1.75 × 1.5 + 14 = 22.4.
        expect(cellsPerRun(withBot(snap(50, 7), 5), withBot(snap(50, 7), 25), inGoldenBot)!.to).toBeCloseTo(22400, 6);
    });

    it('reaches more elites as Golden Bot reaches further, only with Bot+', () => {
        const longer = (plusLv: number | null) => cellsPerRun(withBot(snap(null), plusLv), withBot(snap(null), plusLv, [10]), inGoldenBot)!.to;
        expect(longer(5)).toBeGreaterThan(20000);
        expect(longer(null)).toBeCloseTo(20000, 6);
    });
});

describe('the "More Elite Cells" goal', () => {
    const setUp = (fields: Record<string, unknown>) => {
        useGameStore.getState().resetAll();
        useGameStore.getState().applyGameImport(parseGameExport(makeExport({
            BattleHistory: [battle({ Wave: 5000, TotalElites: 2000, ...fields })],
        })));
        const s = useGameStore.getState();
        const scored = snapshotFromState(s);
        applyGoal(scored, 'cells', 'Glass Cannon', s.importedBattles[0], runModels(s));
        return scored;
    };

    it('is on offer for every build that has goals', () => {
        expect(GOAL_LABELS.cells).toBe('More Elite Cells');
        for (const build of ['Glass Cannon', 'eHP', 'Farming'] as const) expect(BUILD_GOALS[build]).toContain('cells');
    });

    it('scores the cells on the chosen run', () => {
        const scored = setUp({ CellsEarned: 40000 });
        expect(scored.metric).toBe('cells');
        expect(goalScore(scored)).toBeCloseTo(40000, 6);
    });

    it('values nothing that doesn’t bring cells', () => {
        const scored = setUp({ CellsEarned: 40000 });
        expect(buildCandidates(scored, 'workshop').every(c => c.scorePct === 0)).toBe(true);
        expect(buildCandidates(scored, 'labs').every(c => c.scorePct === 0)).toBe(true);
    });

    it('scores Golden Bot+ Bonus Cells and Golden Bot’s reach, not its coin Bonus', () => {
        const scored = setUp({ CellsEarned: 40000, DestroyedInGoldenBot: 150000 });
        scored.botData = { ...scored.botData, 'Golden Bot': { owned: true, plusOwned: true, medals: [], plusLv: 5 } };
        scored.cells = buildCellCalibration(scored, useGameStore.getState().importedBattles[0])!;
        const bots = buildCandidates(scored, 'bots');
        const gain = (label: string) => bots.find(c => c.label === label)?.scorePct ?? 0;
        // ×1.5 → ×1.55 on half the elites: 1.275 / 1.25 = +2%.
        expect(gain('Golden Bot+ — Bonus Cells')).toBeCloseTo(2, 6);
        expect(gain('Golden Bot — Duration')).toBeGreaterThan(0);
        expect(gain('Golden Bot — Bonus')).toBe(0);
    });

    it('offers nothing when the run doesn’t record cells', () => {
        const scored = setUp({ CellsEarned: 0 });
        expect(scored.cells).toBeUndefined();
        expect(goalScore(scored)).toBe(1);
    });
});
