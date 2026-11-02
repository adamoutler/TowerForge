// ============================================================
//  TowerForge Companion — Elite cells per run
//  Elites (Vampire, Ray, Scatter) drop cells; the wiki's Currencies page
//  (read 2026-10-23): the Cells/Kill Bonus enhancement multiplies them
//  (×1 + 0.01 a level, 200 levels, ×3), the Cells card adds 2 … 14 cells
//  to every elite kill AFTER the multipliers, and its mastery multiplies
//  elite cells further while the card is equipped.
//  So a run's cells per elite = (k × enhancement + card) × mastery, where
//  k holds everything else — the tier's drop, Wave Skip's ×1.1, Golden
//  Bot+, the Death Wave cell lab. k comes from the run; an upgrade then
//  changes the rest, at the same elites (the same waves). That's also the
//  Optimizer's "More Elite Cells" goal.
//  Pure functions — no store imports.
// ============================================================

import { WS_ENH } from '../constants/gameData';
import { activeCard, cardValue } from './statHelpers';
import type { BattleReport } from './battleReport';
import type { OptimizerSnapshot } from './optimizer';

export interface CellParts {
    enhancement: number;   // Cells/Kill Bonus multiplier (1 = not unlocked)
    card: number;          // cells the Cells card adds per elite (0 = not equipped)
    mastery: number;       // the card's mastery multiplier (1 = none)
}

type CellSnap = Pick<OptimizerSnapshot, 'presetIdx' | 'enhData' | 'cardData'>;

export function cellParts(snap: CellSnap): CellParts {
    const idx = WS_ENH.utility.findIndex(([n]) => n === 'Cells/Kill Bonus');
    const owned = snap.enhData?.u?.utility?.[idx] ?? false;
    const card = activeCard(snap.cardData, snap.presetIdx, 'Cells');
    return {
        enhancement: owned ? 1 + 0.01 * (snap.enhData?.d?.utility?.[idx] ?? 0) : 1,
        card: card ? cardValue('Cells', card.stars) : 0,
        mastery: card?.mastery ?? 1,
    };
}

export interface CellCalibration {
    elites: number;   // elites in the run
    k: number;        // cells an elite, before the enhancement, card and mastery
}

// Null when the run doesn't record cells or elites.
export function buildCellCalibration(snap: CellSnap, report: BattleReport | null): CellCalibration | null {
    const raw = report?.raw ?? {};
    const cells = typeof raw.CellsEarned === 'number' ? raw.CellsEarned : 0;
    const elites = typeof raw.TotalElites === 'number' ? raw.TotalElites : 0;
    if (cells <= 0 || elites <= 0) return null;
    const a = cellParts(snap);
    return { elites, k: Math.max(0, (cells / (elites * a.mastery) - a.card) / a.enhancement) };
}

// Cells on the calibration's run with this account's enhancement, card and mastery.
export function cellScore(snap: CellSnap, cal: CellCalibration): number {
    const x = cellParts(snap);
    return cal.elites * (cal.k * x.enhancement + x.card) * x.mastery;
}

// Cells the run earned, and what `after` would earn on the same run (the
// same elites); null when the run doesn't record cells or elites.
export function cellsPerRun(before: CellSnap, after: CellSnap, report: BattleReport | null): { from: number; to: number } | null {
    const cal = buildCellCalibration(before, report);
    return cal ? { from: report?.raw?.CellsEarned as number, to: cellScore(after, cal) } : null;
}
