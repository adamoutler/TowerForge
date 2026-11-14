// Moments from the player's own imports: two made-up exports, the second
// a week later with a better wave and a better tournament finish.

import { describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import { importWithMoments, closeMoment } from './moments';
import { parseGameExport } from '../engine/gameExport';
import { makeExport, zeros } from '../test/makeExport';

// Tests run without a browser: a small stand-in for localStorage.
const mem = new Map<string, string>();
Object.assign(globalThis, {
    localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => { mem.set(k, v); },
        removeItem: (k: string) => { mem.delete(k); },
        clear: () => mem.clear(),
    },
});

const waves = (byTier: Record<number, number>) => {
    const out = zeros(22);
    for (const [t, w] of Object.entries(byTier)) out[Number(t)] = w;
    return out;
};
const tourney = (n: number, iso: string, wave: number, rank: number) =>
    ({ TournamentNumber: n, Date: `${iso}T00:00:00Z`, LeagueID: 4, Wave: wave, Rank: rank });   // 4 = Champion

const first = makeExport({
    ExportedAt: '2026-11-07T12:00:00Z', TotalCoinsEarned: 1e18,
    HighestWaveThisTier: waves({ 10: 6000, 11: 5000, 12: 4980 }), HighestLeague: 4,
    TournamentRecords: [tourney(308, '2026-11-04', 640, 12), tourney(309, '2026-11-07', 650, 9)],
});
const second = makeExport({
    ExportedAt: '2026-11-14T12:00:00Z', TotalCoinsEarned: 2e18,
    HighestWaveThisTier: waves({ 10: 6000, 11: 5000, 12: 5231 }), HighestLeague: 4,
    TournamentRecords: [tourney(308, '2026-11-04', 640, 12), tourney(309, '2026-11-07', 650, 9), tourney(310, '2026-11-11', 700, 2)],
});

describe('moments from imports', () => {
    it('the first import finds none; the next finds what went up', () => {
        localStorage.clear();
        useGameStore.getState().resetAll();
        importWithMoments(parseGameExport(first));
        expect(JSON.parse(localStorage.getItem('tf-moments') ?? '[]')).toEqual([]);

        importWithMoments(parseGameExport(second));
        const kept = JSON.parse(localStorage.getItem('tf-moments')!) as { id: string; value: string }[];
        expect(kept.map(m => [m.id, m.value])).toEqual([
            ['rank:Champion:310', '2nd'],
            ['twave:Champion:310', '700'],
            ['wave:12:5231', '5,231'],
        ]);

        // The same file again: nothing new, nothing doubled.
        importWithMoments(parseGameExport(second));
        expect(JSON.parse(localStorage.getItem('tf-moments')!)).toHaveLength(3);

        closeMoment('wave:12:5231');
        expect((JSON.parse(localStorage.getItem('tf-moments')!) as { closed?: boolean }[]).filter(m => m.closed)).toHaveLength(1);
        useGameStore.getState().resetAll();
        localStorage.clear();
        delete (globalThis as { localStorage?: unknown }).localStorage;
    });
});
