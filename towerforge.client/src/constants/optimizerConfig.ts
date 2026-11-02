// ============================================================
//  TowerForge Companion — Optimizer Configuration
//  Scoring weights, category config, and optimizer constants.
//  All tuning lives here — nothing hardcoded in engine files.
// ============================================================

import type { BuildType, OptCategory, OptCurrency } from '../types/gameTypes';

// ── Build Type Support Status ─────────────────────────────────
// Glass Cannon scores eDPS; Farming scores coins/hour (engine/farming.ts);
// eHP scores survival (engine/ehp.ts). Farming and eHP are calibrated by a
// pasted Battle Report. Hybrid is scored as the build its runs behave like
// (accountModels.effectiveBuild: Glass Cannon or eHP).
export const BUILD_SUPPORT: Record<string, { ready: boolean; label: string }> = {
    'Glass Cannon': { ready: true, label: 'Glass Cannon' },
    'eHP': { ready: true, label: 'eHP / Thorns' },
    'Hybrid': { ready: true, label: 'Hybrid' },
    'Farming': { ready: true, label: 'Farming / Econ' },
};

// ── Goals ─────────────────────────────────────────────────────
// What the player wants from their next upgrades. Every panel ranks by it.
//   damage   — calibrated eDPS (all damage)
//   waves    — how far runs get: flat damage + Enemy Health Level Skip
//              (Glass Cannon; milestones and tournaments)
//   coins    — coins per hour (engine/farming.ts)
//   survival — eHP (engine/ehp.ts)
//   blend    — coins and push together: coins^w × push^(1 − w), push being
//              waves for Glass Cannon and survival otherwise
//   cells    — Elite Cells on the chosen run, at the same waves (engine/cells.ts)
export type OptGoal = 'damage' | 'waves' | 'coins' | 'survival' | 'blend' | 'cells';

export const GOAL_LABELS: Record<OptGoal, string> = {
    damage: 'More damage (eDPS)',
    waves: 'Push further — milestones and tournaments',
    coins: 'More coins (econ)',
    survival: 'Survive longer (eHP)',
    blend: 'Coins and push together',
    cells: 'More Elite Cells',
};

export const BUILD_GOALS: Record<BuildType, OptGoal[]> = {
    'Glass Cannon': ['waves', 'damage', 'coins', 'blend', 'cells'],
    'eHP': ['survival', 'coins', 'blend', 'cells'],
    'Farming': ['coins', 'survival', 'blend', 'cells'],
    'Hybrid': [],                       // never scored as itself (effectiveBuild)
};

// The push half of "coins and push" for a build.
export const pushGoalOf = (build: BuildType): 'waves' | 'survival' => (build === 'Glass Cannon' ? 'waves' : 'survival');

// Every currency's panels, in the order shown (stones are the row above).
export const CURRENCY_PANELS: { currency: OptCurrency; label: string; cats: OptCategory[] }[] = [
    { currency: 'coins', label: 'Coins', cats: ['workshop', 'enhancements'] },
    { currency: 'research', label: 'Lab research', cats: ['labs'] },
    { currency: 'shards', label: 'Module Shards', cats: ['modules'] },
    { currency: 'medals', label: 'Medals', cats: ['bots'] },
    { currency: 'gems', label: 'Gems', cats: ['cards'] },
    { currency: 'bits', label: 'Bits', cats: ['guardian'] },
];
export const CURRENCY_CATS: OptCategory[] = CURRENCY_PANELS.flatMap(p => p.cats);

// ── Optimizer Panel Definitions ───────────────────────────────
// Defines the 8 panels, their display labels, cost type,
// and which row they appear in on the optimizer tab.
export const OPT_PANELS: {
    cat: OptCategory;
    label: string;
    costType: OptCurrency;
    row: 1 | 2;
    maxSteps: number;
}[] = [
        // Row 1 — single ranked path across all stone-spending categories
        // (UW stats, UW+, Card Mastery, Assist) — see simulateStonePath.
        { cat: 'stones', label: 'Ranked Stone Upgrades', costType: 'stones', row: 1, maxSteps: 800 },
        // Row 2 — the other currencies (CURRENCY_PANELS groups them).
        { cat: 'workshop', label: 'Workshop', costType: 'coins', row: 2, maxSteps: 100 },
        { cat: 'enhancements', label: 'Enhancements', costType: 'coins', row: 2, maxSteps: 100 },
        { cat: 'labs', label: 'Labs', costType: 'research', row: 2, maxSteps: 100 },
        { cat: 'modules', label: 'Module slot levels', costType: 'shards', row: 2, maxSteps: 60 },
        { cat: 'bots', label: 'Bots and Event Shop trades', costType: 'medals', row: 2, maxSteps: 40 },
        { cat: 'cards', label: 'Card slots', costType: 'gems', row: 2, maxSteps: 21 },
        { cat: 'guardian', label: 'Guardian chips', costType: 'bits', row: 2, maxSteps: 60 },
    ];

// ── GC Scoring ────────────────────────────────────────────────
// All stone panels score on: eDPS_delta_pct / stoneCost
// No fallback score — pure eDPS/stone for GC build.
// These flags document the intentional design, not toggle switches.
export const GC_SCORING = {
    useEdpsPerStone: true,
    noFallbackScore: true,   // never fall back to weight-based for GC stone panels
    altMinScoreRatio: 0.80,   // alts must score >= 80% of top pick to be shown
    altMaxCount: 3,      // max alternative suggestions per step
    comboBudgetTopN: 8,      // top-N singles considered for 2-upgrade combos
    minGainPct: 0.001,       // paths stop at upgrades worth less than this (% of the build's metric)
} as const;

// ── Non-GC Optimizer Weights ──────────────────────────────────
// Used for eHP, Hybrid, and Farming builds.
// Keys map to stat categories scored by the weight-based path.
export const OPT_WEIGHTS: Record<string, Record<string, number>> = {
    ehp: {
        health: 1.0,
        healthRegen: 0.8,
        defenseAbs: 0.9,
        defensePct: 0.7,
        thorn: 0.4,
        wall: 0.3,
    },
    hybrid: {
        damage: 0.7,
        health: 0.6,
        defenseAbs: 0.5,
        attackSpeed: 0.5,
        healthRegen: 0.4,
    },
    farming: {
        cash: 1.0,
        coins: 0.9,
        interest: 0.8,
        freeUpgrade: 0.5,
    },
};

// ── UW+ Impact Ranking ────────────────────────────────────────
// Relative impact order used as tiebreaker when eDPS delta
// is equal between two UW+ candidates. Higher = more impactful.
export const UW_PLUS_IMPACT: Record<string, number> = {
    CF: 10,   // path length — uncapped, highest ceiling
    DW: 9,   // kill wall amplifier
    BH: 8,   // consume % wave HP
    ILM: 7,   // charged mine ramp
    PS: 6,   // death creep stacking
    SM: 5,   // cover fire extra missile
    SL: 4,   // light range D/M scaling
    CL: 3,   // smite % wave HP
    GT: 2,   // golden combo — economic, not eDPS
};

// ── Workshop Stat Weights ─────────────────────────────────────
// Used only for non-GC builds. GC ignores these entirely.
export const WS_WEIGHT_MAP: Record<string, number> = {
    'Damage': 1.00,
    'Attack Speed': 0.90,
    'Critical Chance': 0.60,
    'Critical Factor': 0.65,
    'Range': 0.70,
    'Damage/Meter': 0.55,
    'Health': 0.80,
    'Health Regen': 0.75,
    'Defense %': 0.70,
    'Defense Absolute': 0.85,
    'Thorn Damage': 0.40,
    'Cash Bonus': 0.60,
    'Cash/Wave': 0.55,
    'Coin/Kill Bonus': 0.50,
    'Coin/Wave': 0.50,
    'Interest/Wave': 0.45,
    'Package Chance': 0.30,
};

// ── Lab Weight Map ────────────────────────────────────────────
// Used only for non-GC builds.
export const LAB_WEIGHT_MAP: Record<string, number> = {
    'Damage Lab': 1.00,
    'Attack Speed Lab': 0.90,
    'Critical Factor Lab': 0.65,
    'Damage/Meter Lab': 0.55,
    'Range Lab': 0.70,
    'Health Lab': 0.80,
    'Health Regen Lab': 0.75,
    'Defense Absolute Lab': 0.85,
    'Defense % Lab': 0.70,
    'Cash Bonus Lab': 0.60,
    'Cash/Wave Lab': 0.55,
    'Standard Perk Bonus': 0.50,
    'GT Bonus': 0.45,
    'GT Duration': 0.40,
    'CF Duration': 0.60,
};

// ── Card Weight Map ───────────────────────────────────────────
// Used only for non-GC builds.
export const CARD_WEIGHT_MAP: Record<string, number> = {
    'Damage': 1.00,
    'Attack Speed': 0.90,
    'Range': 0.70,
    'Slow Aura': 0.65,
    'Critical Chance': 0.60,
    'Super Tower': 0.55,
    'Health': 0.80,
    'Health Regen': 0.75,
    'Extra Defense': 0.70,
    'Ultimate Crit': 0.50,
    'Area of Effect': 0.45,
};

// ── Display Config ────────────────────────────────────────────
// Thresholds for color-coding eDPS gain in the optimizer UI.
export const OPT_GAIN_THRESHOLDS = {
    high: 1.0,    // >= 1.0% eDPS gain → green
    med: 0.25,   // >= 0.25% eDPS gain → orange
    // below 0.25% → blue (diminishing returns)
} as const;

// Default steps shown per panel before "show more"
export const OPT_DEFAULT_SHOW = 5;