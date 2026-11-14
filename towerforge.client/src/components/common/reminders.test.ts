// Reminders: one per lab still researching, at its finish time (with
// speed-ups counted), soonest first — made-up labs; and one per
// tournament day, kept out of the player's night.

import { describe, expect, it } from 'vitest';
import { remindersFor, tourneyRemindersFor } from './reminders';
import type { LabRunning } from '../../types/gameTypes';

const lab = (name: string | null, doneAt: number | null, toLevel?: number): LabRunning =>
    ({ lab: name, labIndex: 7, doneAt, speedUp: 0, speedUpLeftSec: 0, exportedAt: null, toLevel }) as LabRunning;

describe('lab reminders', () => {
    it('reminds once per lab still researching, soonest first', () => {
        const now = Date.parse('2026-11-13T20:00:00Z');
        const r = remindersFor([
            lab('Damage Lab', now + 5 * 3600_000, 21),
            lab('Coins/Wave Lab', now + 3600_000),
            lab('Attack Speed Lab', now - 60_000),     // finished already
            lab(null, now + 7200_000),                  // a lab the site can't name yet
            lab('Health Lab', null),                    // no time
        ], now);
        expect(r.map(x => x.title)).toEqual(['🔬 Coins/Wave Lab is done', '🔬 Lab #7 is done', '🔬 Damage Lab Lv 21 is done']);
        expect(r[0].at).toBe(now + 3600_000);
        expect(r.every(x => x.url === '/labs')).toBe(true);
    });
});

describe('tournament reminders', () => {
    const sat = Date.parse('2026-11-14T09:00:00Z');   // a Saturday, after its start
    const iso = (t: number) => new Date(t).toISOString().slice(0, 16);

    it('five minutes after the start where that is daytime or evening', () => {
        // New York (UTC−5): 00:05 UTC is 7:05 p.m. the evening before.
        const r = tourneyRemindersFor([], sat, () => 300);
        expect(r.slice(0, 3).map(x => iso(x.at))).toEqual(['2026-11-18T00:05', '2026-11-21T00:05', '2026-11-25T00:05']);
        expect(r).toHaveLength(11);   // six weeks ahead; today's has gone
        expect(r[0]).toMatchObject({ url: '/tournament', title: '🏆 Tournament day in The Tower' });
    });

    it('waits for 7 a.m. where the start falls in the night', () => {
        // Berlin (UTC+1): 01:05 local → 7:00 local = 06:00 UTC.
        expect(iso(tourneyRemindersFor([], sat, () => -60)[0].at)).toBe('2026-11-18T06:00');
        // Tokyo (UTC+9): 09:05 local, fine.
        expect(iso(tourneyRemindersFor([], sat, () => -540)[0].at)).toBe('2026-11-18T00:05');
        // Azores (UTC−1): 23:05 the night before → 7:00 local = 08:00 UTC, 8 hours in.
        expect(iso(tourneyRemindersFor([], sat, () => 60)[0].at)).toBe('2026-11-18T08:00');
    });

    it('today counts while its reminder is still ahead', () => {
        const early = Date.parse('2026-11-14T03:00:00Z');
        expect(iso(tourneyRemindersFor([], early, () => -60)[0].at)).toBe('2026-11-14T06:00');
    });
});
