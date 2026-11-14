// The example account: fills the site with the made-up player, clears
// out completely when the player's own data comes in, and is never
// uploaded to a new account.

import { describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import { useAccountStore } from './useAccountStore';
import { endExampleForImport, endExampleQuietly, exampleOn, tryExample } from './exampleAccount';

describe('example account', () => {
    it('fills the site with the made-up player, and steps aside for the player\'s own import', async () => {
        useGameStore.getState().resetAll();
        await tryExample();
        expect(exampleOn()).toBe(true);
        const s = useGameStore.getState();
        expect(s.profile.highestTier).toBe(19);
        expect(s.profile.build).toBe('Glass Cannon');
        expect(s.importedBattles.length).toBeGreaterThan(0);   // the Optimizer has runs to calibrate from

        endExampleForImport();
        expect(exampleOn()).toBe(false);
        // Nothing of the made-up player stays mixed into the player's own data.
        expect(useGameStore.getState().profile.build).toBe('');
        expect(useGameStore.getState().importedBattles).toEqual([]);
    });

    it('won\'t let a new account upload it', async () => {
        await tryExample();
        await expect(useAccountStore.getState().register('someone', 'made-up-password')).rejects.toThrow(/example account/);
        endExampleQuietly();
        expect(exampleOn()).toBe(false);
        useGameStore.getState().resetAll();
    });
});
