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
        expect(cellParts(snap(50, 7))).toEqual({ enhancement: 1.5, card: 14, mastery: 1 });
        expect(cellParts(snap(null))).toEqual({ enhancement: 1, card: 0, mastery: 1 });
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
        expect(cal).toEqual({ elites: 1000, k: 4 });
        expect(cellScore(snap(100, 7), cal)).toBeCloseTo(22000, 6);
        expect(buildCellCalibration(snap(50), null)).toBeNull();
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

    it('offers nothing when the run doesn’t record cells', () => {
        const scored = setUp({ CellsEarned: 0 });
        expect(scored.cells).toBeUndefined();
        expect(goalScore(scored)).toBe(1);
    });
});
