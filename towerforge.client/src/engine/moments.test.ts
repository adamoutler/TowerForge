// ============================================================
//  TowerForge Companion — Moments tests
//  Made-up accounts before and after an import.
// ============================================================

import { describe, expect, it } from 'vitest';
import { findMoments, ordinal } from './moments';
import type { MomentAccount } from './moments';
import type { TourneyRecord } from '../types/gameTypes';

const DAY = 86_400_000;
const rec = (number: number, league: TourneyRecord['league'], wave: number, rank: number): TourneyRecord =>
    ({ number, date: number * 3 * DAY, league, wave, rank });

const base = (): MomentAccount => ({
    imported: true,
    highestTier: 12,
    tierWaves: { 10: 6000, 11: 5000, 12: 4980 },
    league: 'Champion',
    tourneyRecords: [rec(300, 'Platinum', 900, 3), rec(301, 'Champion', 600, 12), rec(302, 'Champion', 650, 9)],
    uws: { CL: { own: true, sv: [1, 1, 1], upOwn: false, upLvl: 0 } },
});

describe('findMoments', () => {
    it('finds nothing on the first import, or when nothing went up', () => {
        const before = { ...base(), imported: false };
        const after = { ...base(), highestTier: 13, tierWaves: { 12: 5300 } };
        expect(findMoments(before, after, 1)).toEqual([]);
        expect(findMoments(base(), base(), 1)).toEqual([]);
        // An older file: lower waves.
        expect(findMoments(base(), { ...base(), tierWaves: { 12: 4000 } }, 1)).toEqual([]);
    });

    it('a best wave on a tier already played, and a new tier', () => {
        const after = { ...base(), highestTier: 13, tierWaves: { ...base().tierWaves, 12: 5231, 13: 120 } };
        const found = findMoments(base(), after, 5);
        expect(found.map(m => m.kind)).toEqual(['tier', 'wave']);
        expect(found[0]).toMatchObject({ value: '13', detail: 'Up from Tier 12' });
        // The first run on Tier 13 is the tier moment, not a "best wave".
        expect(found[1]).toMatchObject({ id: 'wave:12:5231', label: 'wave on Tier 12', value: '5,231', detail: 'Up from 4,980 (+251)', at: 5 });
    });

    it('a promotion to a league never reached before', () => {
        const after = { ...base(), league: 'Legend' as const, tourneyRecords: [...base().tourneyRecords, rec(303, 'Legend', 400, 20)] };
        const found = findMoments(base(), after, 1);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ kind: 'promoted', value: 'Legend', detail: 'First time in Legend league, up from Champion' });
    });

    it('a best finish and a best wave within one league', () => {
        const after = { ...base(), tourneyRecords: [...base().tourneyRecords, rec(303, 'Champion', 700, 2)] };
        const found = findMoments(base(), after, 1);
        expect(found.map(m => [m.kind, m.value, m.detail])).toEqual([
            ['rank', '2nd', 'Best before: 9th'],
            ['tourneyWave', '700', 'Up from 650 (+50)'],
        ]);
    });

    it('waves are compared within their league only', () => {
        // 800 is below Platinum's 900, but Champion's best was 650.
        const after = { ...base(), tourneyRecords: [...base().tourneyRecords, rec(303, 'Champion', 800, 0)] };
        expect(findMoments(base(), after, 1).map(m => [m.kind, m.detail])).toEqual([['tourneyWave', 'Up from 650 (+150)']]);
        const lower = { ...base(), tourneyRecords: [...base().tourneyRecords, rec(303, 'Champion', 640, 0)] };
        expect(findMoments(base(), lower, 1)).toEqual([]);
    });

    it('a tournament still running counts once it is placed', () => {
        const running = { ...base(), tourneyRecords: [...base().tourneyRecords, rec(303, 'Champion', 500, 0)] };
        const placedNow = { ...base(), tourneyRecords: [...base().tourneyRecords, rec(303, 'Champion', 500, 1)] };
        const found = findMoments(running, placedNow, 1);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ kind: 'rank', title: 'First place!', value: '1st' });
    });

    it('a new Ultimate Weapon and UW+, once UWs were known', () => {
        const after = {
            ...base(),
            uws: { CL: { own: true, sv: [1, 1, 1] as [number, number, number], upOwn: true, upLvl: 1 }, BH: { own: true, sv: [1, 1, 1] as [number, number, number], upOwn: false, upLvl: 0 } },
        };
        expect(findMoments(base(), after, 1).map(m => [m.kind, m.value])).toEqual([['uwPlus', 'Smite'], ['uw', 'Black Hole']]);
        // No UW known before (never entered): none.
        expect(findMoments({ ...base(), uws: {} }, after, 1)).toEqual([]);
    });

    it('most worth sharing first, four at most', () => {
        const after: MomentAccount = {
            ...base(),
            highestTier: 13,
            tierWaves: { 10: 6100, 11: 5100, 12: 5000, 13: 10 },
            league: 'Legend',
            tourneyRecords: [...base().tourneyRecords, rec(303, 'Champion', 700, 1), rec(304, 'Legend', 300, 25)],
        };
        expect(findMoments(base(), after, 1).map(m => m.kind)).toEqual(['promoted', 'rank', 'tier', 'tourneyWave']);
    });
});

describe('ordinal', () => {
    it('reads like a placing', () => {
        expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30].map(ordinal)).toEqual(
            ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th']);
    });
});
