// ============================================================
//  TowerForge Companion — Trophy shelf
//  What the account has done, as trophies on Profile with a share
//  picture (owner, 2026-11-14): the highest tier and best wave, the
//  highest league and when it was first reached, the best finish there,
//  first places and top-3 finishes, promotions, tournaments played, and
//  the Ultimate Weapons and UW+ owned. All of it comes from data that is
//  imported and synced (tier waves, TournamentRecords, UWs), so the shelf
//  is full on any device from the first import; the moments the imports
//  found are listed under it (store/moments.ts).
//  Pure functions — no store imports.
// ============================================================

import type { League, TierWaves, TourneyRecord, UWData } from '../types/gameTypes';
import { LEAGUE_ORDER, leagueMoves, placed } from './tourneyHistory';
import { farthestPoint } from './accountProgress';
import { ordinal } from './moments';
import { UWS } from '../constants/gameData';

export interface Trophy {
    id: string;
    icon: string;
    value: string;       // the big word: "T18", "Mythic", "2nd"
    title: string;       // what it is: "Highest tier"
    note?: string;       // "first reached Oct 17, 2026"
    league?: League;
}

export interface TrophyAccount {
    highestTier: number;
    tierWaves: TierWaves;
    league: League;              // highest league reached (profile)
    tourneyRecords: TourneyRecord[];
    uws: UWData['data'];
}

const n = (v: number) => v.toLocaleString('en-US');
const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const leagueIndex = (l: League) => (l ? LEAGUE_ORDER.indexOf(l) : -1);

export function trophies(a: TrophyAccount): Trophy[] {
    const out: Trophy[] = [];
    if (a.highestTier > 0) out.push({ id: 'tier', icon: '⭐', value: `T${a.highestTier}`, title: 'Highest tier' });
    const far = farthestPoint(a.tierWaves);
    if (far) out.push({ id: 'wave', icon: '🌊', value: n(far.wave), title: `Best wave on Tier ${far.tier}` });

    const recs = a.tourneyRecords;
    const top = [a.league, ...recs.map(r => r.league)].reduce<League>((best, l) => (leagueIndex(l) > leagueIndex(best) ? l : best), '');
    if (top) {
        const first = recs.find(r => r.league === top);
        out.push({ id: 'league', icon: '🏅', value: top, title: 'Highest league', note: first ? `first reached ${day(first.date)}` : undefined, league: top });
        const best = recs.filter(r => r.league === top && placed(r)).sort((x, y) => x.rank - y.rank || y.wave - x.wave)[0];
        if (best) out.push({ id: 'finish', icon: '🏆', value: ordinal(best.rank), title: `Best finish in ${top}`, note: `${day(best.date)}, wave ${n(best.wave)}`, league: top });
        const topWave = recs.filter(r => r.league === top).sort((x, y) => y.wave - x.wave)[0];
        if (topWave && topWave.wave > 0) out.push({ id: 'twave', icon: '🌊', value: n(topWave.wave), title: `Best wave in ${top}`, note: day(topWave.date), league: top });
    }
    const firsts = recs.filter(r => r.rank === 1).length;
    const podiums = recs.filter(r => r.rank >= 1 && r.rank <= 3).length;
    if (firsts) out.push({ id: 'firsts', icon: '🥇', value: `${firsts}×`, title: firsts === 1 ? 'First place' : 'First places' });
    if (podiums) out.push({ id: 'podiums', icon: '🥉', value: `${podiums}×`, title: 'Top-3 finishes' });
    const ups = leagueMoves(recs).filter(m => m.up).length;
    if (ups) out.push({ id: 'promotions', icon: '⬆️', value: `${ups}×`, title: ups === 1 ? 'Promotion' : 'Promotions' });
    if (recs.length) out.push({ id: 'tourneys', icon: '🎟️', value: n(recs.length), title: recs.length === 1 ? 'Tournament played' : 'Tournaments played' });

    const owned = UWS.filter(u => a.uws[u.a]?.own).length;
    const plus = UWS.filter(u => a.uws[u.a]?.upOwn).length;
    if (owned) out.push({ id: 'uws', icon: '⚡', value: `${owned}/${UWS.length}`, title: 'Ultimate Weapons' });
    if (plus) out.push({ id: 'uwplus', icon: '⚡', value: `${plus}/${UWS.length}`, title: 'UW+ unlocked' });
    return out;
}
