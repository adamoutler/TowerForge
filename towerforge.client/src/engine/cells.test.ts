// Elite Cells on a run, and the Optimizer's "More Elite Cells" goal. Made-up
// runs; the rules are the wiki's Currencies page (cells.ts).

import { describe, expect, it } from 'vitest';
import { buildCellCalibration, cellParts, cellScore, cellsPerRun } from './cells';
import { applyGoal, runModels, snapshotFromState } from './accountModels';
import { buildCandidates, goalScore } from './optimizer';
import { parseGameExport } from './gameExport';
import { useGameStore } from '../store/useGameStore';
import { battle, makeExport } from '../test/makeExport';
import { BUILD_GOALS, GOAL_LABELS } from '../constants/optimizerConfig';
import { WS_ENH } from '../constants/gameData';
import type { BattleReport } from './battleReport';

const ENH = WS_ENH.utility.findIndex(([n]) => n === 'Cells/Kill Bonus');
const account = (enhancement: number, owned = true) => ({
    presetIdx: 0,
    enhData: {
        d: { utility: WS_ENH.utility.map((_, i) => (i === ENH ? enhancement : 0)) },
        u: { utility: WS_ENH.utility.map((_, i) => i === ENH && owned) },
    },
    cardData: { data: {}, slots: 1, presets: { 0: [] } },
}) as never;
const report = (cells: unknown, elites: unknown) => ({ raw: { CellsEarned: cells, TotalElites: elites } }) as unknown as BattleReport;

describe('elite cells on a run', () => {
    it('read k from the run and scale it by the enhancement', () => {
        // 1000 cells from 100 elites at ×1.5: k = 10 ÷ 1.5.
        const cal = buildCellCalibration(account(50), report(1000, 100))!;
        expect(cal.elites).toBe(100);
        expect(cal.k).toBeCloseTo(10 / 1.5, 9);
        expect(cellScore(account(50), cal)).toBeCloseTo(1000, 9);
        expect(cellScore(account(100), cal)).toBeCloseTo(1000 * 2 / 1.5, 9);
    });

    it('need a run that records cells and elites', () => {
        expect(buildCellCalibration(account(0), report(0, 100))).toBeNull();
        expect(buildCellCalibration(account(0), report(100, 0))).toBeNull();
        expect(buildCellCalibration(account(0), report('x', 5))).toBeNull();
        expect(buildCellCalibration(account(0), null)).toBeNull();
        expect(cellsPerRun(account(0), account(1), null)).toBeNull();
    });

    it('give What If the same numbers', () => {
        expect(cellsPerRun(account(50), account(100), report(1000, 100))).toEqual({
            from: 1000, to: cellScore(account(100), buildCellCalibration(account(50), report(1000, 100))!),
        });
    });

    it('count the enhancement as ×1 until it’s unlocked', () => {
        expect(cellParts(account(50, false)).enhancement).toBe(1);
        expect(cellParts(account(50)).enhancement).toBe(1.5);
    });
});

describe('the "More Elite Cells" goal', () => {
    const setUp = (fields: Record<string, unknown>) => {
        useGameStore.getState().resetAll();
        useGameStore.getState().applyGameImport(parseGameExport(makeExport({
            BattleHistory: [battle({ Wave: 5000, TotalElites: 2000, ...fields })],
        })));
        const s = useGameStore.getState();
        const run = s.importedBattles[0];
        const snap = snapshotFromState(s);
        applyGoal(snap, 'cells', 'Glass Cannon', run, runModels(s));
        return snap;
    };

    it('is on offer for every build that has goals', () => {
        expect(GOAL_LABELS.cells).toBe('More Elite Cells');
        for (const build of ['Glass Cannon', 'eHP', 'Farming'] as const) expect(BUILD_GOALS[build]).toContain('cells');
    });

    it('scores the cells on the chosen run', () => {
        const snap = setUp({ CellsEarned: 40000 });
        expect(snap.metric).toBe('cells');
        expect(goalScore(snap)).toBeCloseTo(40000, 6);
    });

    it('values nothing that doesn’t bring cells', () => {
        const snap = setUp({ CellsEarned: 40000 });
        expect(buildCandidates(snap, 'workshop').every(c => c.scorePct === 0)).toBe(true);
        expect(buildCandidates(snap, 'labs').every(c => c.scorePct === 0)).toBe(true);
    });

    it('offers nothing when the run doesn’t record cells', () => {
        const snap = setUp({ CellsEarned: 0 });
        expect(snap.cells).toBeUndefined();
        expect(goalScore(snap)).toBe(1);
    });
});
