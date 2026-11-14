// ============================================================
//  TowerForge Companion — Moments
//  What an import shows the player has just done: a new tier, a best
//  wave, a promotion to a new tournament league, a best finish or a
//  best wave in a league, a new Ultimate Weapon or UW+. Each one gets a
//  share picture (common/Moments.tsx), so players show off what they
//  did, with towerforge.net on it (owner, 2026-11-14).
//
//  Found by comparing the account just before and just after an
//  import. The first import finds nothing (everything would be "new"),
//  nor does an older file (nothing went up). Tournament waves and ranks
//  are only compared within a league, as on the History page: each
//  league's enemies are a different strength. Rank 1 = top of the
//  30-player bracket, 0 = not placed yet (tourneyHistory.ts).
//  Pure functions — no store imports.
// ============================================================

import type { League, TabName, TierWaves, TourneyRecord, UWAbbr, UWData } from '../types/gameTypes';
import { LEAGUE_ORDER, placed } from './tourneyHistory';
import { UWS } from '../constants/gameData';

export type MomentKind = 'promoted' | 'rank' | 'tier' | 'tourneyWave' | 'wave' | 'uwPlus' | 'uw';

export interface Moment {
    id: string;          // the same feat keeps its id, so a later import replaces it
    kind: MomentKind;
    at: number;          // when the import found it (ms)
    title: string;       // "New best wave"
    label: string;       // the counter's small word: "wave on Tier 12"
    value: string;       // the counter's big one: "5,231"
    detail?: string;     // "Up from 4,980"
    league?: League;
    tab: TabName;        // the page it opens
}

// Each kind's mark on Profile and the trophy shelf.
export const MOMENT_ICON: Record<MomentKind, string> = {
    promoted: '🏅', rank: '🏆', tier: '⭐', tourneyWave: '🌊', wave: '🌊', uwPlus: '⚡', uw: '⚡',
};

// The parts of the account a moment can come from.
export interface MomentAccount {
    imported: boolean;           // an import had been done before this one
    highestTier: number;
    tierWaves: TierWaves;
    league: League;              // the highest league reached (profile)
    tourneyRecords: TourneyRecord[];
    uws: UWData['data'];
}

// Most worth sharing first; at most this many from one import.
const ORDER: MomentKind[] = ['promoted', 'rank', 'tier', 'tourneyWave', 'wave', 'uwPlus', 'uw'];
const MAX_MOMENTS = 4;

const n = (v: number) => v.toLocaleString('en-US');
const leagueIndex = (l: League) => (l ? LEAGUE_ORDER.indexOf(l) : -1);

// "1st", "2nd", "3rd", "11th", "22nd".
export function ordinal(rank: number): string {
    const tens = rank % 100;
    if (tens >= 11 && tens <= 13) return `${rank}th`;
    return `${rank}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] ?? 'th'}`;
}

function highestLeague(league: League, records: TourneyRecord[]): League {
    return [league, ...records.map(r => r.league)]
        .reduce<League>((top, l) => (leagueIndex(l) > leagueIndex(top) ? l : top), '');
}

function tierMoments(before: MomentAccount, after: MomentAccount, at: number): Moment[] {
    const out: Moment[] = [];
    if (before.highestTier > 0 && after.highestTier > before.highestTier) {
        out.push({
            id: `tier:${after.highestTier}`, kind: 'tier', at, tab: 'tiers',
            title: 'New tier unlocked', label: 'tier', value: String(after.highestTier),
            detail: `Up from Tier ${before.highestTier}`,
        });
    }
    // Best waves on tiers already played, highest tier first (two at most:
    // a long gap between imports can raise several).
    const waves = Object.entries(after.tierWaves)
        .map(([t, w]) => ({ tier: Number(t), wave: w ?? 0, was: before.tierWaves[Number(t)] ?? 0 }))
        .filter(x => x.was > 0 && x.wave > x.was)
        .sort((a, b) => b.tier - a.tier)
        .slice(0, 2);
    for (const x of waves) {
        out.push({
            id: `wave:${x.tier}:${x.wave}`, kind: 'wave', at, tab: 'tiers',
            title: 'New best wave', label: `wave on Tier ${x.tier}`, value: n(x.wave),
            detail: `Up from ${n(x.was)} (+${n(x.wave - x.was)})`,
        });
    }
    return out;
}

function tourneyMoments(before: MomentAccount, after: MomentAccount, at: number): Moment[] {
    const out: Moment[] = [];
    const wasTop = highestLeague(before.league, before.tourneyRecords);
    const nowTop = highestLeague(after.league, after.tourneyRecords);
    if (wasTop && leagueIndex(nowTop) > leagueIndex(wasTop)) {
        out.push({
            id: `league:${nowTop}`, kind: 'promoted', at, tab: 'tourneyhistory', league: nowTop,
            title: 'Promoted!', label: 'league', value: nowTop, detail: `First time in ${nowTop} league, up from ${wasTop}`,
        });
    }

    // Tournaments this import added or changed (a running one fills in).
    const was = new Map(before.tourneyRecords.map(r => [r.number, r]));
    const changed = after.tourneyRecords.filter(r => {
        const w = was.get(r.number);
        return !w || w.wave !== r.wave || w.rank !== r.rank || w.league !== r.league;
    });
    const leagues = [...new Set(changed.map(r => r.league))].filter(Boolean);
    for (const league of leagues) {
        const fresh = changed.filter(r => r.league === league);
        const numbers = new Set(fresh.map(r => r.number));
        // Earlier tournaments in this league; none = the first one there,
        // which the promotion covers.
        const older = before.tourneyRecords.filter(r => r.league === league && !numbers.has(r.number));
        if (!older.length) continue;

        const olderPlaced = older.filter(placed);
        const best = fresh.filter(placed).sort((a, b) => a.rank - b.rank)[0];
        if (best && olderPlaced.length) {
            const prior = Math.min(...olderPlaced.map(r => r.rank));
            if (best.rank < prior) {
                out.push({
                    id: `rank:${league}:${best.number}`, kind: 'rank', at, tab: 'tourneyhistory', league,
                    title: best.rank === 1 ? 'First place!' : 'Best tournament finish',
                    label: `place in ${league}`, value: ordinal(best.rank), detail: `Best before: ${ordinal(prior)}`,
                });
            }
        }
        const top = [...fresh].sort((a, b) => b.wave - a.wave)[0];
        const priorWave = Math.max(...older.map(r => r.wave));
        if (top && priorWave > 0 && top.wave > priorWave) {
            out.push({
                id: `twave:${league}:${top.number}`, kind: 'tourneyWave', at, tab: 'tourneyhistory', league,
                title: 'Best tournament wave', label: `wave in ${league}`, value: n(top.wave),
                detail: `Up from ${n(priorWave)} (+${n(top.wave - priorWave)})`,
            });
        }
    }
    return out;
}

function uwMoments(before: MomentAccount, after: MomentAccount, at: number): Moment[] {
    // Only once an Ultimate Weapon was known: an account whose UWs were never
    // entered would get one for each.
    if (!Object.values(before.uws).some(u => u?.own)) return [];
    const out: Moment[] = [];
    for (const uw of UWS) {
        const a = uw.a as UWAbbr;
        const now = after.uws[a], then = before.uws[a];
        if (now?.own && !then?.own) {
            out.push({ id: `uw:${a}`, kind: 'uw', at, tab: 'uw', title: 'New Ultimate Weapon', label: 'unlocked', value: uw.n });
        }
        if (now?.upOwn && then?.own && !then.upOwn) {
            out.push({ id: `uwplus:${a}`, kind: 'uwPlus', at, tab: 'uw', title: 'UW+ unlocked', label: `${uw.n}+`, value: uw.up });
        }
    }
    return out;
}

// What this import did that's worth a picture, most worth sharing first.
export function findMoments(before: MomentAccount, after: MomentAccount, at: number): Moment[] {
    if (!before.imported) return [];
    return [...tourneyMoments(before, after, at), ...tierMoments(before, after, at), ...uwMoments(before, after, at)]
        .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
        .slice(0, MAX_MOMENTS);
}
