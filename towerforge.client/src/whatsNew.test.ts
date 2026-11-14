// What's new: which releases a returning visitor is told about.

import { describe, expect, it } from 'vitest';
import { WHATS_NEW, compareVersions, unseen } from './whatsNew';
import type { WhatsNewEntry } from './whatsNew';

const e = (version: string): WhatsNewEntry => ({ version, date: '2026-11-14', items: [{ text: version }] });
const LIST = [e('2.14.0'), e('2.13.0'), e('2.12.0')];

describe("what's new", () => {
    it('compares versions part by part', () => {
        expect(compareVersions('2.12.0', '2.9.0')).toBeGreaterThan(0);
        expect(compareVersions('2.12.1', '2.12.1')).toBe(0);
        expect(compareVersions('1.34.1', '2.0.0')).toBeLessThan(0);
    });

    it('tells a returning visitor what came since their last visit, two releases at most', () => {
        expect(unseen(LIST, '2.12.0', '2.14.0').map(x => x.version)).toEqual(['2.14.0', '2.13.0']);
        expect(unseen(LIST, '2.11.0', '2.14.0').map(x => x.version)).toEqual(['2.14.0', '2.13.0']);
        expect(unseen(LIST, '2.14.0', '2.14.2')).toEqual([]);
        // An entry for a release not out yet stays hidden.
        expect(unseen(LIST, '2.12.0', '2.13.0').map(x => x.version)).toEqual(['2.13.0']);
        // Data from before What's new (never marked): the newest only.
        expect(unseen(LIST, null, '2.14.0').map(x => x.version)).toEqual(['2.14.0']);
    });

    it('lists releases newest first, each with something to say', () => {
        for (let i = 1; i < WHATS_NEW.length; i++) expect(compareVersions(WHATS_NEW[i - 1].version, WHATS_NEW[i].version)).toBeGreaterThan(0);
        for (const entry of WHATS_NEW) {
            expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
            expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(entry.items.length).toBeGreaterThan(0);
        }
    });
});
