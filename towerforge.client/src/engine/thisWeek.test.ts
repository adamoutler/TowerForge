// This week on Profile: the last 7 days' runs and the next tournament day
// from the player's own tournament dates (made-up records).

import { describe, expect, it } from 'vitest';
import { thisWeek, tournamentWeekdays, tourneyDayText, upcomingTourneyDays } from './thisWeek';
import type { BattleReport } from './battleReport';
import type { TourneyRecord } from '../types/gameTypes';

const run = (time: number, tier: number, wave: number, coinsEarned = 1e12) => ({ time, tier, wave, coinsEarned }) as unknown as BattleReport;
const rec = (iso: string): TourneyRecord => ({ number: 0, date: Date.parse(`${iso}T00:00:00Z`), league: 'Gold', wave: 100, rank: 10 } as TourneyRecord);

// Wednesdays and Saturdays, like the game's (2026-10-17 Sat, 10-21 Wed…).
const RECORDS = ['2026-10-17', '2026-10-21', '2026-10-24', '2026-10-28', '2026-10-31', '2026-11-04', '2026-11-07', '2026-11-11'].map(rec);

describe('this week', () => {
    it('counts the last 7 days of runs, the best (highest tier first) and their coins', () => {
        const now = Date.parse('2026-11-13T20:00:00Z');
        const w = thisWeek([
            run(now - 9 * 86_400_000, 19, 9000),       // too old
            run(now - 2 * 86_400_000, 18, 8950, 3e15),
            run(now - 3600_000, 18, 9010, 2e15),
            run(now - 86_400_000, 12, 12000, 1e14),    // a lower tier, more waves
        ], RECORDS, now);
        expect(w.runs).toBe(3);
        expect(w.best).toEqual({ tier: 18, wave: 9010 });
        expect(w.coins).toBe(3e15 + 2e15 + 1e14);
    });

    it('adds up the week for its picture: waves, time, enemies, labs and the tournament', () => {
        const now = Date.parse('2026-11-14T20:00:00Z');
        const r = (time: number, wave: number, realTimeSec: number, totalEnemies: number) =>
            ({ time, tier: 18, wave, realTimeSec, totalEnemies, coinsEarned: 1 }) as unknown as BattleReport;
        const labs: [number, number, number][] = [
            [Date.parse('2026-11-01T00:00:00Z') / 1000, 3, 10],   // too old
            [Date.parse('2026-11-10T00:00:00Z') / 1000, 3, 11],
            [Date.parse('2026-11-13T00:00:00Z') / 1000, 7, 40],
        ];
        const tourneys = [
            { number: 309, date: Date.parse('2026-11-11T00:00:00Z'), league: 'Champion', wave: 700, rank: 2 },
            { number: 310, date: Date.parse('2026-11-14T00:00:00Z'), league: 'Champion', wave: 750, rank: 0 },   // still running
            { number: 308, date: Date.parse('2026-11-04T00:00:00Z'), league: 'Champion', wave: 900, rank: 1 },   // last week
        ] as TourneyRecord[];
        const w = thisWeek([r(now - 3600_000, 9000, 30_000, 120_000), r(now - 86_400_000, 8800, 28_000, 110_000)], tourneys, now, labs);
        expect([w.waves, w.playSec, w.enemies, w.labsDone]).toEqual([17800, 58_000, 230_000, 2]);
        expect(w.tourney?.number).toBe(309);
    });

    it('finds the next tournament day from the player\'s own tournament dates', () => {
        expect(tournamentWeekdays(RECORDS, Date.parse('2026-11-13T20:00:00Z'))).toEqual([3, 6]);   // Wednesday, Saturday
        const fri = Date.parse('2026-11-13T20:00:00Z');
        const next = thisWeek([], RECORDS, fri).nextTourney!;
        expect(new Date(next).toISOString()).toBe('2026-11-14T00:00:00.000Z');
        expect(tourneyDayText(next, fri)).toBe('Tomorrow');
        const sat = Date.parse('2026-11-14T09:00:00Z');
        expect(tourneyDayText(thisWeek([], RECORDS, sat).nextTourney!, sat)).toBe('Today');
        // No records (or only one on a day): the game's Wednesday and Saturday.
        expect(new Date(thisWeek([], [rec('2026-11-11')], fri).nextTourney!).toISOString()).toBe('2026-11-14T00:00:00.000Z');
        // A schedule the records show wins (made-up: Mondays and Thursdays).
        const moved = ['2026-10-26', '2026-10-29', '2026-11-02', '2026-11-05'].map(rec);
        expect(new Date(thisWeek([], moved, fri).nextTourney!).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    });

    it('lists the coming tournament days for reminders', () => {
        const sat = Date.parse('2026-11-14T09:00:00Z');
        expect(upcomingTourneyDays(RECORDS, sat, 4).map(d => new Date(d).toISOString().slice(0, 10)))
            .toEqual(['2026-11-14', '2026-11-18', '2026-11-21', '2026-11-25']);
        expect(upcomingTourneyDays([], sat, 20)).toHaveLength(12);   // six weeks at most
    });
});
