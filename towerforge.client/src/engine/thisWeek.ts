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
//  more in the last 12 weeks), so a change in the game's schedule shows
//  up by itself. Without enough records: Wednesday and Saturday, 00:00
//  UTC (the wiki's Tournaments page, 2026-11-14; #309 and #310 in the
//  owner's export were a Saturday and a Wednesday).
// ============================================================

import type { BattleReport } from './battleReport';
import type { Career } from './career';
import type { TourneyRecord } from '../types/gameTypes';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export interface WeekSummary {
    runs: number;                                   // runs played in the last 7 days
    best: { tier: number; wave: number } | null;    // highest tier, then wave, among them
    coins: number;                                  // coins those runs earned
    nextTourney: number | null;                     // 00:00 UTC of the next tournament day (today counts)
    // For the week's share picture:
    waves: number;                                  // waves those runs reached, added up
    playSec: number;                                // their real time
    enemies: number;                                // enemies they destroyed
    labsDone: number;                               // lab levels finished (the game's lab history)
    tourney: TourneyRecord | null;                  // the week's tournament: the best placed, else the best wave
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

// The game's schedule (wiki): Wednesday and Saturday.
export const TOURNEY_WEEKDAYS: readonly number[] = [3, 6];

// The player's own tournament weekdays, else the game's schedule.
export const tourneyWeekdays = (records: TourneyRecord[], now: number): readonly number[] => {
    const own = tournamentWeekdays(records, now);
    return own.length ? own : TOURNEY_WEEKDAYS;
};

// 00:00 UTC of the next `count` tournament days, today first if it is one,
// within `days` days.
export function upcomingTourneyDays(records: TourneyRecord[], now: number, count: number, days = 42): number[] {
    const weekdays = tourneyWeekdays(records, now);
    const today = Math.floor(now / DAY) * DAY;
    const out: number[] = [];
    for (let i = 0; i < days && out.length < count; i++) {
        const d = today + i * DAY;
        if (weekdays.includes(new Date(d).getUTCDay())) out.push(d);
    }
    return out;
}

export function thisWeek(battles: BattleReport[], records: TourneyRecord[], now: number, labs: Career['labs'] = []): WeekSummary {
    const week = battles.filter(b => b.time !== undefined && now - b.time >= 0 && now - b.time < WEEK);
    const best = week.reduce<WeekSummary['best']>((top, b) => (!top || b.tier > top.tier || (b.tier === top.tier && b.wave > top.wave)
        ? { tier: b.tier, wave: b.wave } : top), null);
    const nextTourney = upcomingTourneyDays(records, now, 1, 7)[0] ?? null;
    const sum = (f: (b: BattleReport) => number) => week.reduce((s, b) => s + (f(b) || 0), 0);
    // A tournament day is 00:00 UTC, so "this week" for it is the last 7 days of days.
    const recent = records.filter(r => r.date <= now && now - r.date < WEEK);
    const tourney = [...recent].sort((a, b) => (a.rank > 0 ? a.rank : 99) - (b.rank > 0 ? b.rank : 99) || b.wave - a.wave)[0] ?? null;
    return {
        runs: week.length, best, coins: sum(b => b.coinsEarned), nextTourney,
        waves: sum(b => b.wave), playSec: sum(b => b.realTimeSec), enemies: sum(b => b.totalEnemies),
        labsDone: labs.filter(([sec]) => now - sec * 1000 >= 0 && now - sec * 1000 < WEEK).length,
        tourney,
    };
}

// "today", "tomorrow", "Saturday" (this week), in the player's own words.
export function tourneyDayText(dayStart: number, now: number): string {
    const days = Math.round((dayStart - Math.floor(now / DAY) * DAY) / DAY);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}
