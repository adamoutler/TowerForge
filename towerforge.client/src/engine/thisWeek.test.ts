// This week on Profile: the last 7 days' runs and the next tournament day
// from the player's own tournament dates (made-up records).

import { describe, expect, it } from 'vitest';
import { thisWeek, tournamentWeekdays, tourneyDayText } from './thisWeek';
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

    it('finds the next tournament day from the player\'s own tournament dates', () => {
        expect(tournamentWeekdays(RECORDS, Date.parse('2026-11-13T20:00:00Z'))).toEqual([3, 6]);   // Wednesday, Saturday
        const fri = Date.parse('2026-11-13T20:00:00Z');
        const next = thisWeek([], RECORDS, fri).nextTourney!;
        expect(new Date(next).toISOString()).toBe('2026-11-14T00:00:00.000Z');
        expect(tourneyDayText(next, fri)).toBe('Tomorrow');
        const sat = Date.parse('2026-11-14T09:00:00Z');
        expect(tourneyDayText(thisWeek([], RECORDS, sat).nextTourney!, sat)).toBe('Today');
        // No records (or only one on a day): no guess.
        expect(thisWeek([], [rec('2026-11-11')], fri).nextTourney).toBeNull();
    });
});
