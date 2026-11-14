// ============================================================
//  TowerForge Companion — This week (Profile)
//  A reason to look in every week (owner, 2026-11-13: 85% of visitors
//  came on one day only): the runs of the last 7 days from the saved
//  battle history — how many, the best wave, the coins they earned —
//  and the next tournament day.
//
//  Tournament days come from the player's own TournamentRecords (each
//  record's Date is 00:00 UTC of its tournament day,
//  game-export-format.md): the weekdays they keep falling on (twice or
//  more in the last 12 weeks; #309 and #310 in the owner's export were a
//  Saturday and a Wednesday). No records, no guess.
// ============================================================

import type { BattleReport } from './battleReport';
import type { TourneyRecord } from '../types/gameTypes';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface WeekSummary {
    runs: number;                                   // runs played in the last 7 days
    best: { tier: number; wave: number } | null;    // highest tier, then wave, among them
    coins: number;                                  // coins those runs earned
    nextTourney: number | null;                     // 00:00 UTC of the next tournament day (today counts)
}

// The weekdays (0 = Sunday, UTC) tournaments keep falling on.
export function tournamentWeekdays(records: TourneyRecord[], now: number): number[] {
    const counts = new Map<number, number>();
    for (const r of records) {
        if (now - r.date > 12 * WEEK || r.date > now + DAY) continue;
        const day = new Date(r.date).getUTCDay();
        counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts].filter(([, n]) => n >= 2).map(([d]) => d).sort((a, b) => a - b);
}

export function thisWeek(battles: BattleReport[], records: TourneyRecord[], now: number): WeekSummary {
    const week = battles.filter(b => b.time !== undefined && now - b.time >= 0 && now - b.time < WEEK);
    const best = week.reduce<WeekSummary['best']>((top, b) => (!top || b.tier > top.tier || (b.tier === top.tier && b.wave > top.wave)
        ? { tier: b.tier, wave: b.wave } : top), null);
    const days = tournamentWeekdays(records, now);
    const today = Math.floor(now / DAY) * DAY;
    let nextTourney: number | null = null;
    for (let i = 0; i < 7 && days.length; i++) {
        const d = today + i * DAY;
        if (days.includes(new Date(d).getUTCDay())) { nextTourney = d; break; }
    }
    return { runs: week.length, best, coins: week.reduce((s, b) => s + (b.coinsEarned || 0), 0), nextTourney };
}

// "today", "tomorrow", "Saturday" (this week), in the player's own words.
export function tourneyDayText(dayStart: number, now: number): string {
    const days = Math.round((dayStart - Math.floor(now / DAY) * DAY) / DAY);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}
