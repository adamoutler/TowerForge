// Lab reminders: one per lab still researching, at its finish time (with
// speed-ups counted), soonest first — made-up labs.

import { describe, expect, it } from 'vitest';
import { remindersFor } from './labReminders';
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
