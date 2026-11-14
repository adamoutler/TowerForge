// The trophy shelf from a made-up account.

import { describe, expect, it } from 'vitest';
import { trophies } from './trophies';
import type { TourneyRecord } from '../types/gameTypes';

const rec = (number: number, iso: string, league: TourneyRecord['league'], wave: number, rank: number): TourneyRecord =>
    ({ number, date: Date.parse(`${iso}T00:00:00Z`), league, wave, rank });

describe('trophy shelf', () => {
    it('lists what the account has done', () => {
        const shelf = trophies({
            highestTier: 18,
            tierWaves: { 17: 9500, 18: 9010 },
            league: 'Champion',
            tourneyRecords: [
                rec(300, '2026-09-30', 'Platinum', 900, 1),
                rec(301, '2026-10-03', 'Champion', 600, 12),
                rec(302, '2026-10-07', 'Champion', 650, 3),
                rec(303, '2026-10-10', 'Champion', 640, 2),
                rec(304, '2026-10-14', 'Champion', 700, 0),
            ],
            uws: { CL: { own: true, sv: [1, 1, 1], upOwn: true, upLvl: 1 }, BH: { own: true, sv: [1, 1, 1], upOwn: false, upLvl: 0 } },
        });
        expect(shelf.map(t => [t.id, t.value, t.title, t.note])).toEqual([
            ['tier', 'T18', 'Highest tier', undefined],
            ['wave', '9,010', 'Best wave on Tier 18', undefined],
            ['league', 'Champion', 'Highest league', 'first reached Oct 3, 2026'],
            ['finish', '2nd', 'Best finish in Champion', 'Oct 10, 2026, wave 640'],
            ['twave', '700', 'Best wave in Champion', 'Oct 14, 2026'],
            ['firsts', '1×', 'First place', undefined],
            ['podiums', '3×', 'Top-3 finishes', undefined],
            ['promotions', '1×', 'Promotion', undefined],
            ['tourneys', '5', 'Tournaments played', undefined],
            ['uws', '2/9', 'Ultimate Weapons', undefined],
            ['uwplus', '1/9', 'UW+ unlocked', undefined],
        ]);
    });

    it('an account without tournaments or UWs still has its tier', () => {
        expect(trophies({ highestTier: 3, tierWaves: { 3: 120 }, league: '', tourneyRecords: [], uws: {} }).map(t => t.id)).toEqual(['tier', 'wave']);
    });
});
