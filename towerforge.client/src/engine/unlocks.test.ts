// What's open yet on a newer account: workshop groups bought, the Labs
// and each lab's milestone, enhancements. Shaped like the two accounts the
// rules were checked on (2026-10-26): a new one (Tier 1, best wave 26, the
// first attack and defense groups and two utility ones) and a maxed one.
// Made-up exports (src/test/makeExport.ts).

import { describe, expect, it } from 'vitest';
import { parseGameExport } from './gameExport';
import { cardMasteryOpen, enhancementsOpen, labOpen, labsOpen, lockedNotes, workshopOpen } from './unlocks';
import { makeExport } from '../test/makeExport';
import { UWS } from '../constants/gameData';
import { BOTS_CONFIG } from '../constants/botData';

const bits = (n: number) => Array.from({ length: 20 }, (_, i) => i < n);

describe('unlocks', () => {
    it('reads the workshop groups bought from the export', () => {
        const imp = parseGameExport(makeExport({
            UpgradeTierUnlocked: bits(1), UpgradeDefenseTierUnlocked: bits(1), UpgradeUtilityTierUnlocked: bits(2),
        }));
        expect(imp.wsUnlocked).toEqual({ attack: 1, defense: 1, utility: 2 });
        expect(parseGameExport(makeExport()).wsUnlocked).toBeNull();   // an older file: not known
    });

    it('opens a workshop stat with its group, or once it has levels', () => {
        const fresh = { attack: 1, defense: 1, utility: 2 };
        expect(workshopOpen('attack', 'Damage', 0, fresh)).toBe(true);            // free from the start
        expect(workshopOpen('attack', 'Range', 0, fresh)).toBe(true);             // group 1 (50 coins)
        expect(workshopOpen('attack', 'Multishot Chance', 0, fresh)).toBe(false); // group 2 (400 coins)
        expect(workshopOpen('defense', 'Defense Absolute', 0, fresh)).toBe(true);
        expect(workshopOpen('defense', 'Thorn Damage', 0, fresh)).toBe(false);
        expect(workshopOpen('utility', 'Coin/Wave', 0, fresh)).toBe(true);
        expect(workshopOpen('utility', 'Enemy HP Level Skip', 0, fresh)).toBe(false);
        expect(workshopOpen('attack', 'Multishot Chance', 5, fresh)).toBe(true);  // has levels
        expect(workshopOpen('attack', 'Rend Armor Mult', 0, { attack: 6, defense: 9, utility: 6 })).toBe(true);
        expect(workshopOpen('attack', 'Rend Armor Mult', 0, undefined)).toBe(true);   // not known
    });

    it('opens the Labs at Tier 1 wave 30, and each lab at its milestone', () => {
        const fresh = { tierWaves: { 1: 26 }, completedTier: 0 };
        expect(labsOpen(fresh)).toBe(false);
        expect(labOpen('Damage Lab', 0, fresh)).toBe(false);
        expect(labOpen('Damage Lab', 0, { tierWaves: { 1: 30 }, completedTier: 0 })).toBe(true);
        expect(labOpen('Labs Speed', 0, { tierWaves: { 1: 149 }, completedTier: 0 })).toBe(false);   // T1 W150
        expect(labOpen('WS Atk Discount', 0, { tierWaves: { 1: 500 }, completedTier: 0 })).toBe(false); // T2 W40
        expect(labOpen('WS Atk Discount', 0, { tierWaves: { 1: 500, 2: 40 }, completedTier: 1 })).toBe(true);
        expect(labOpen('Labs Speed', 3, fresh)).toBe(true);                       // has levels
        expect(labOpen('ILM-Chrono Jump', 0, { tierWaves: { 1: 500 }, completedTier: 0 }, false)).toBe(false);
        expect(labOpen('Labs Speed', 0, { tierWaves: {}, completedTier: 0 })).toBe(true);   // not known
    });

    it('opens enhancements with the Workshop Enhancement lab', () => {
        expect(enhancementsOpen({}, { d: {}, u: { attack: [true] } })).toBe(false);
        expect(enhancementsOpen({ 'Workshop Enhancement': 1 }, undefined)).toBe(true);
        expect(enhancementsOpen({}, { d: { attack: [12] }, u: {} })).toBe(true);
    });

    it('opens Card Mastery at Tier 16 wave 100, or once a mastery is bought', () => {
        const cards = (mu: boolean) => ({ data: { Damage: { s: 7, mu } }, slots: 1, presets: {} }) as never;
        const t16 = (wave: number) => ({ tierWaves: { 15: 4000, 16: wave }, completedTier: 15 });
        expect(cardMasteryOpen(cards(false), t16(99))).toBe(false);
        expect(cardMasteryOpen(cards(false), t16(100))).toBe(true);
        expect(cardMasteryOpen(cards(true), t16(99))).toBe(true);
        expect(cardMasteryOpen(cards(false), { tierWaves: {}, completedTier: 0 })).toBe(true);   // not known
        expect(lockedNotes({ labData: {}, cardData: cards(false), progress: t16(99) }).stones)
            .toBe('Card masteries open at Tier 16, wave 100, so none are listed yet.');
        expect(lockedNotes({ labData: {}, cardData: cards(false), progress: t16(100) }).stones).toBeUndefined();
    });

    it('says what a panel leaves out', () => {
        const notes = lockedNotes({
            progress: { tierWaves: { 1: 26 }, completedTier: 0 },
            wsUnlocked: { attack: 1, defense: 1, utility: 2 },
            labData: {},
        });
        expect(notes.workshop).toContain('Multishot (Attack), Thorn Damage (Defense), Free Upgrades (Utility)');
        expect(notes.labs).toBe('The Labs open at Tier 1, wave 30.');
        expect(notes.enhancements).toContain('Workshop Enhancement lab');
        expect(lockedNotes({ wsUnlocked: { attack: 6, defense: 9, utility: 6 }, labData: { 'Workshop Enhancement': 1 } }))
            .toEqual({});
    });

    it('says why a new account has no stones, modules, bots or Guardian panel yet', () => {
        const notes = lockedNotes({
            progress: { tierWaves: { 1: 26 }, completedTier: 0 },
            labData: {},
            uwData: { data: {}, stones: 0 },
            moduleState: { library: [], loadouts: [], assistData: {}, slotLevels: {} as never },
            botData: {},
            guardian: { unlocked: false } as never,
        });
        expect(notes.stones).toContain('No Ultimate Weapons yet');
        expect(notes.modules).toBe('Modules open at Tier 2, wave 90.');
        expect(notes.bots).toContain('No bots unlocked yet');
        expect(notes.guardian).toContain('Guardian isn’t unlocked');
        // The first of each, with its price.
        expect(notes.stones).toContain('your first costs 5 stones');
        expect(notes.bots).toContain('your first costs 150 medals');
    });

    it('says the next UW and bot aren\'t ranked, with their price against what\'s held', () => {
        const own = (n: number) => Object.fromEntries(UWS.map((u, i) => [u.a, { own: i < n, sv: [1, 1, 1] as [number, number, number], upOwn: false, upLvl: 0 }]));
        const bot = { owned: true, medals: [0, 0, 0, 0] };
        const notes = lockedNotes({ labData: {}, uwData: { data: own(1), stones: 0 }, botData: { 'Golden Bot': bot } as never },
            { stones: 160, medals: 120 });
        expect(notes.stones).toBe('Unlocking your next Ultimate Weapon isn’t ranked here: TowerForge measures what a UW adds from your runs, '
            + 'so it can only rank one you’ve run with. The next costs 50 stones (you hold 160, enough for it).');
        expect(notes.bots).toContain('The next costs 300 medals (you hold 120, 180 short).');
        // Everything owned: nothing to say.
        const all = lockedNotes({ labData: {}, uwData: { data: own(9), stones: 0 },
            botData: Object.fromEntries(BOTS_CONFIG.map(b => [b.name, bot])) as never });
        expect([all.stones, all.bots]).toEqual([undefined, undefined]);
    });
});
