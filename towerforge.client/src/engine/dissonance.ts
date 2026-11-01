// ============================================================
//  TowerForge Companion — Dissonant Boosts
//  A Dissonant Run locks one workshop tab; how far it gets leaves a permanent
//  boost on that tier: Attack (damage), Defense (health), Utility (coins) or
//  Ultimate Weapons (UW damage). Dissonant Echo carries part of every other
//  tier's boost over, starting at 0.5% and +0.5% a lab level.
//
//    Boost = 1 + (top − 1) × (min(wave, 5000) ÷ 5000)^1.75     (top ×5, Utility ×3)
//    Echo  = (top − 1) × Echo % × Σ every other tier's (wave ÷ 5000)^1.75
//    Total = Boost + Echo
//
//  TheTowerSDK's formula, with the wiki's Boost and ×5 / ×3 tops. Checked on
//  the owner's Dissonant Boosts panel: all 59 boost cells on their screens of
//  2026-10-31 (anchors in dissonance.test.ts). In tournaments only Echo counts
//  (owner, 2026-11-01). Which stat each boost multiplies comes from the SDK and
//  TTG's v28 notes, not from a screen.
//  Pure functions — no store imports.
// ============================================================

import type { DissonanceTrack, DissonanceWaves, LabData } from '../types/gameTypes';

export const DISSONANCE_TRACKS: DissonanceTrack[] = ['attack', 'defense', 'utility', 'uw'];

export const TRACK_LABEL: Record<DissonanceTrack, string> = {
    attack: 'Attack', defense: 'Defense', utility: 'Utility', uw: 'UW',
};
export const TRACK_STAT: Record<DissonanceTrack, string> = {
    attack: 'damage', defense: 'health', utility: 'coins', uw: 'UW damage',
};
export const ECHO_LABS: Record<DissonanceTrack, string> = {
    attack: 'Dissonant Echo-Atk', defense: 'Dissonant Echo-Def', utility: 'Dissonant Echo-Util', uw: 'Dissonant Echo-UW',
};

const TOP: Record<DissonanceTrack, number> = { attack: 5, defense: 5, utility: 3, uw: 5 };

export const BOOST_FULL_WAVE = 5000;
// Echo starts when Dissonance unlocks; the labs open later, at T17 W60.
export const DISSONANCE_UNLOCK = { tier: 4, wave: 90 };

export const emptyDissonance = (): DissonanceWaves => ({ attack: [], defense: [], utility: [], uw: [] });

export const hasDissonance = (w: DissonanceWaves | undefined): w is DissonanceWaves =>
    !!w && DISSONANCE_TRACKS.some(t => (w[t] ?? []).some(v => v > 0));

const waveShare = (wave: number) => (Math.min(BOOST_FULL_WAVE, Math.max(0, wave)) / BOOST_FULL_WAVE) ** 1.75;

// Echo at a lab level, as a share: level 12 → 0.065 (6.5% on the panel).
export const echoShare = (labs: LabData, track: DissonanceTrack) => ((labs[ECHO_LABS[track]] ?? 0) + 1) * 0.005;

export interface TrackBoost {
    wave: number;
    boost: number;    // the panel's "Boost Only": 1 with no Dissonant Run on the tier
    echo: number;     // the panel's "Echo Only": added to Boost, so no 1 in it
    total: number;    // "Boost + Echo"
}

export function trackBoost(waves: DissonanceWaves, track: DissonanceTrack, tier: number, labs: LabData): TrackBoost {
    const list = waves[track] ?? [];
    const wave = list[tier] ?? 0;
    const here = waveShare(wave);
    const others = list.reduce((sum, w) => sum + waveShare(w), 0) - here;
    const boost = 1 + (TOP[track] - 1) * here;
    const echo = (TOP[track] - 1) * others * echoShare(labs, track);
    return { wave, boost, echo, total: boost + echo };
}

// Tournaments count Echo and no tier's own boost: tier 0 holds no run, so every
// real tier counts as "another tier" (that this includes the tier the tournament
// reports is the code's reading).
export const TOURNAMENT_TIER = 0;

// The tier a model's boost is read at.
export interface DissonanceAt {
    waves: DissonanceWaves;
    tier: number;
}

// What a snapshot's stat is multiplied by; 1 without Dissonance data. Models
// are calibrated on a run that already has the boost, so what counts is how
// this moves with an Echo lab level or another tier.
export function dissonanceFactor(s: { dissonance?: DissonanceAt; labData: LabData }, track: DissonanceTrack): number {
    return s.dissonance ? trackBoost(s.dissonance.waves, track, s.dissonance.tier, s.labData).total : 1;
}
