// Compare with a friend: two made-up shares side by side.

import { describe, expect, it } from 'vitest';
import { compareAccounts } from './compare';
import type { SharePayload } from './shareApi';

const friend: SharePayload = {
    profile: { build: 'Hybrid', league: 'Legend', highestTier: 16, completedTier: 15, tierWaves: { 14: 7000, 15: 6000, 16: 300 } },
    labs: { levels: { 'Game Speed': 7, 'Starting Cash': 50 } },
    uw: { data: { CL: { own: true, sv: [10, 3, 5], upOwn: true, upLvl: 2 }, BH: { own: true, sv: [5, 5, 5], upOwn: false, upLvl: 0 } }, stones: 0 },
    cards: { data: { Damage: { s: 7, m: 3, mu: true }, Health: { s: 5, m: 0 } }, slots: 20, presets: {} },
};
const me: SharePayload = {
    profile: { build: 'eHP', league: 'Champion', highestTier: 15, completedTier: 14, tierWaves: { 14: 7400, 15: 5200 } },
    labs: { levels: { 'Game Speed': 7, 'Starting Cash': 61 } },
    uw: { data: { CL: { own: true, sv: [12, 3, 5], upOwn: false, upLvl: 0 } }, stones: 0 },
    modules: { loadouts: [], library: [], slotLevels: {} as never },
};

describe('compare with a friend', () => {
    it('compares the sections both have, waves on a tier both played', () => {
        const c = compareAccounts(friend, me);
        expect(c.rows.map(r => [r.label, r.themText, r.meText])).toEqual([
            ['Highest tier', 'T16', 'T15'],
            ['Best wave on Tier 15', '6,000', '5,200'],
            ['Highest league', 'Legend', 'Champion'],
            ['Lab levels', '57', '68'],
            ['Labs maxed', '1', '1'],
            ['Ultimate Weapons', '2', '1'],
            ['UW+ unlocked', '1', '0'],
            ['UW upgrade levels', '33', '20'],
        ]);
        // Cards and modules: only one side shared them.
        expect([c.meAhead, c.themAhead]).toEqual([1, 6]);
    });
});
