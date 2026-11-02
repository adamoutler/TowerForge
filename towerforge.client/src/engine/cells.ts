// ============================================================
//  TowerForge Companion — Elite cells per run
//  Elites (Vampire, Ray, Scatter) drop cells; the wiki's Currencies page
//  (read 2026-10-23): the Cells/Kill Bonus enhancement multiplies them
//  (×1 + 0.01 a level, 200 levels, ×3), the Cells card adds 2 … 14 cells
//  to every elite kill AFTER the multipliers, and its mastery multiplies
//  elite cells further while the card is equipped.
//  Golden Bot+ Bonus Cells (wiki: Golden Bot, read 2026-11-02): "Elites
//  killed in Golden Bot range grant {0}x more Cells", ×1.25 at unlock and
//  +0.05 a level to ×2.50 at Lv 25 — one of the multipliers, so before the
//  card. It reaches the elites killed in Golden Bot's range while it's
//  active; the run's share of all kills there (DestroyedInGoldenBot) stands
//  in for its share of elites (the code's assumption), and that share grows
//  with Golden Bot's uptime × range like its coins do (engine/farming.ts).
//  So a run's cells per elite =
//    (k × (1 + share × (Bonus Cells − 1)) × enhancement + card) × mastery,
//  where k holds everything else — the tier's drop, Wave Skip's ×1.1, the
//  Death Wave cell lab, Bot Bot+'s Maximum Power on Bonus Cells (how it
//  boosts it isn't confirmed). k comes from the run; an upgrade then
//  changes the rest, at the same elites (the same waves). That's also the
//  Optimizer's "More Elite Cells" goal.
//  Pure functions — no store imports.
// ============================================================

import { WS_ENH } from '../constants/gameData';
import { botPlusValue, isBotPlusOwned } from '../constants/botData';
import { activeCard, cardValue } from './statHelpers';
import { goldenBotReach } from './farming';
import type { BattleReport } from './battleReport';
import type { OptimizerSnapshot } from './optimizer';

export interface CellParts {
    enhancement: number;   // Cells/Kill Bonus multiplier (1 = not unlocked)
    card: number;          // cells the Cells card adds per elite (0 = not equipped)
    mastery: number;       // the card's mastery multiplier (1 = none)
    bonusCells: number;    // Golden Bot+ Bonus Cells multiplier (1 = not unlocked)
    goldenBot: number;     // Golden Bot's uptime × range (0 = not owned)
}

type CellSnap = Pick<OptimizerSnapshot, 'presetIdx' | 'enhData' | 'cardData' | 'botData' | 'labData' | 'relicData' | 'vault' | 'modBonuses'>;

export function cellParts(snap: CellSnap): CellParts {
    const idx = WS_ENH.utility.findIndex(([n]) => n === 'Cells/Kill Bonus');
    const owned = snap.enhData?.u?.utility?.[idx] ?? false;
    const card = activeCard(snap.cardData, snap.presetIdx, 'Cells');
    const gb = goldenBotReach(snap);
    const entry = snap.botData?.['Golden Bot'];
    return {
        enhancement: owned ? 1 + 0.01 * (snap.enhData?.d?.utility?.[idx] ?? 0) : 1,
        card: card ? cardValue('Cells', card.stars) : 0,
        mastery: card?.mastery ?? 1,
        bonusCells: gb && isBotPlusOwned(entry) ? botPlusValue('Golden Bot', entry?.plusLv ?? 0) : 1,
        goldenBot: gb?.reach ?? 0,
    };
}

export interface CellCalibration {
    elites: number;     // elites in the run
    k: number;          // cells an elite, before Bonus Cells, the enhancement, card and mastery
    gbShare: number;    // share of the run's kills in Golden Bot's range
    gbReach: number;    // Golden Bot's uptime × range on the run's account
}

const bonusFactor = (share: number, bonusCells: number) => 1 + share * (bonusCells - 1);

// Null when the run doesn't record cells or elites.
export function buildCellCalibration(snap: CellSnap, report: BattleReport | null): CellCalibration | null {
    const raw = report?.raw ?? {};
    const cells = typeof raw.CellsEarned === 'number' ? raw.CellsEarned : 0;
    const elites = typeof raw.TotalElites === 'number' ? raw.TotalElites : 0;
    if (cells <= 0 || elites <= 0) return null;
    const a = cellParts(snap);
    const gbShare = a.goldenBot > 0 ? Math.min(1, Math.max(0, report?.killedWithEffect?.goldenBot ?? 0)) : 0;
    const k = (cells / (elites * a.mastery) - a.card) / a.enhancement / bonusFactor(gbShare, a.bonusCells);
    return { elites, k: Math.max(0, k), gbShare, gbReach: a.goldenBot };
}

// Cells on the calibration's run with this account's Bonus Cells, Golden Bot
// reach, enhancement, card and mastery.
export function cellScore(snap: CellSnap, cal: CellCalibration): number {
    const x = cellParts(snap);
    const share = cal.gbReach > 0 ? Math.min(1, cal.gbShare * x.goldenBot / cal.gbReach) : 0;
    return cal.elites * (cal.k * bonusFactor(share, x.bonusCells) * x.enhancement + x.card) * x.mastery;
}

// Cells the run earned, and what `after` would earn on the same run (the
// same elites); null when the run doesn't record cells or elites.
export function cellsPerRun(before: CellSnap, after: CellSnap, report: BattleReport | null): { from: number; to: number } | null {
    const cal = buildCellCalibration(before, report);
    return cal ? { from: report?.raw?.CellsEarned as number, to: cellScore(after, cal) } : null;
}
