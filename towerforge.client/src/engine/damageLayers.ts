// ============================================================
//  TowerForge Companion — Damage layers
//  What each defense took out of the enemy damage in a run, from the Battle
//  Report's "blocked" lines.
//
//    Enemy damage → Chrono Field → Chain Thunder → Flame Bot → Primordial
//      Collapse → Negative Mass Projector → Defense % → what lands
//
//  Each cut = its line ÷ its line plus everything after it. Defense % goes
//  last, not first as TheTowerSDK has it: with it first the owner's runs cut
//  30–55% by Chrono Field at a 23% lab and up to 99% by Chain Thunder at a
//  24% cap, and a quarter of the damage would land where 1–3% does. With it
//  last, on 80 runs (exports of 2026-10-17 to 2026-11-01), Chrono Field never
//  passes 20.1% and Chain Thunder 22%, and Defense % reads 76.4–76.6% on
//  Tier 23 runs, what its sources add up to before any perk (77.3%). The
//  order above Defense % is the report's, which the lines can't settle.
//
//  The Defense % reading is blurred two ways. Some damage lands with no
//  blocked line at all (runs with every line at 0 still took some), and a hit
//  Energy Shield stops has its lines counted but never lands. The other cuts
//  don't depend on what lands, so they hold.
//  Pure functions — no store imports.
// ============================================================

import type { BattleReport } from './battleReport';

export interface DamageLayers {
    total: number;         // all the enemy damage, before any layer
    landed: number;        // on the tower and the wall
    chrono: number;        // each cut: the share it took of what reached it
    chainThunder: number;
    flame: number;
    primordial: number;
    negativeMass: number;
    defPct: number | null; // null when no hit reached Defense %
}

// Null for a run without the lines (a pasted Battle Report, an old save) or
// without damage.
export function damageLayers(run: Pick<BattleReport, 'raw'>): DamageLayers | null {
    const raw = run.raw ?? {};
    const n = (k: string) => (typeof raw[k] === 'number' ? raw[k] as number : 0);
    const landed = n('DamageTaken') + n('DamageTakenWall');
    const def = n('DefensePercentBlocked');
    const atDef = def + n('DefenseAbsoluteBlocked') + landed;
    const atNegative = atDef + n('MagicOrbBlocked');
    const atPrimordial = atNegative + n('PrimordialCollapseBlocked');
    const atFlame = atPrimordial + n('FlameBotBlocked');
    const atThunder = atFlame + n('ChainThunderBlocked');
    const total = atThunder + n('ChronoFieldBlocked');
    if (total <= 0) return null;
    const cut = (line: string, at: number) => (at > 0 ? n(line) / at : 0);
    return {
        total,
        landed,
        chrono: cut('ChronoFieldBlocked', total),
        chainThunder: cut('ChainThunderBlocked', atThunder),
        flame: cut('FlameBotBlocked', atFlame),
        primordial: cut('PrimordialCollapseBlocked', atPrimordial),
        negativeMass: cut('MagicOrbBlocked', atNegative),
        defPct: def > 0 ? def / atDef : null,
    };
}
