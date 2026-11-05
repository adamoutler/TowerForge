// Tests for the game export import (engine/gameExport.ts), on made-up exports.
// The numbers pinned here (lab 0 = Damage Lab, effect code 1 = Common Attack
// Speed, the code-block ends 80/154/216/326, …) were confirmed against a real
// account — see docs/game-export-format.md. If a test fails after a game
// update, the export format probably changed.

import { describe, expect, it } from 'vitest';
import { defaultBattleIndex, isGameExport, isRealRun, parseGameExport } from './gameExport';
import { MAX_STORED_BATTLES, mergeBattles } from './battleReport';
import { LABS, UWS, WS_ENH, WS_STATS } from '../constants/gameData';
import { GAME_CARDS, GAME_LABS, MASTERY_LAB_CARDS, MASTERY_LAB_START, CARD_PRESET_SLOTS } from '../constants/gameExportMaps';
import { SUB_EFFECTS, SUB_RARITIES } from '../constants/moduleData';
import { battle, gameModule, labIndex, makeExport, research, zeros } from '../test/makeExport';
import { useGameStore } from '../store/useGameStore';
import { BOTS_CONFIG, botsForPreset, vaultBotRange } from '../constants/botData';
import { echoingShotBullets } from './towerDamage';

const labMax = (name: string) => LABS.flatMap(c => c.l).find(([n]) => n === name)![1];

describe('isGameExport', () => {
    it('accepts the game file and rejects others', () => {
        expect(isGameExport(makeExport())).toBe(true);
        expect(isGameExport({ Coins: 1, Gems: 2 })).toBe(false);
        expect(isGameExport(null)).toBe(false);
        expect(isGameExport({ version: 2, profile: {} })).toBe(false);   // a TowerForge backup
    });
});

describe('currencies and tiers', () => {
    it('reads currencies and the player name', () => {
        const imp = parseGameExport(makeExport());
        expect(imp.currencies).toMatchObject({ coins: 1e15, gems: 500, stones: 1200, medals: 300, cells: 40, keys: 2 });
        expect(imp.userName).toBe('TestPlayer');
    });

    it('finds the highest unlocked and completed tiers', () => {
        // Tiers 1–3 past wave 100 (unlocks the next tier), tier 4 at wave 80.
        const imp = parseGameExport(makeExport({ HighestWaveThisTier: [0, 4000, 1200, 350, 80] }));
        expect(imp.tierWaves).toEqual({ 1: 4000, 2: 1200, 3: 350, 4: 80 });
        expect(imp.completedTier).toBe(3);
        expect(imp.highestTier).toBe(4);
    });

    it('needs wave 300 to complete tier 15 and up', () => {
        const waves = zeros(17);
        for (let t = 1; t <= 14; t++) waves[t] = 1000;
        waves[15] = 299;
        const imp = parseGameExport(makeExport({ HighestWaveThisTier: waves }));
        expect(imp.completedTier).toBe(14);
        expect(imp.highestTier).toBe(15);
    });
});

describe('workshop and enhancements', () => {
    const attackMax = WS_STATS.attack.map(([, max]) => max);

    it('reads the loaded workshop preset from the live arrays and others from the preset arrays', () => {
        const live = [5000, 99, 79, 0, 0, 0];
        const saved = zeros(100);
        saved[40] = 1234;                                     // workshop preset 2, first attack stat
        const imp = parseGameExport(makeExport({
            UpgradeWorkshopLevel: live,
            PresetUpgradeWorkshopLevel: saved,
            CurrentWorkshopPreset: 0,
            GlobalPresets: [{ WorkshopIndex: 0 }, { WorkshopIndex: 2 }],
        }));
        expect(imp.workshop).toHaveLength(5);
        expect(imp.workshop![0].attack.slice(0, 3)).toEqual([Math.min(5000, attackMax[0]), Math.min(99, attackMax[1]), Math.min(79, attackMax[2])]);
        expect(imp.workshop![1].attack[0]).toBe(Math.min(1234, attackMax[0]));   // app preset 2 → game workshop preset 3
        expect(imp.fivePresets).toBe(true);                                     // workshop preset 3 holds upgrades
    });

    it('clamps workshop levels to each stat max', () => {
        const imp = parseGameExport(makeExport({ UpgradeWorkshopLevel: [1e9] }));
        expect(imp.workshop![0].attack[0]).toBe(attackMax[0]);
    });

    it('maps enhancements from the game order (Rend Armor is 2nd in game)', () => {
        const imp = parseGameExport(makeExport({ EnhancementLevel: [10, 20, 0, 0, 0, 0], EnhancementTierUnlocked: [true] }));
        expect(WS_ENH.attack[5][0]).toMatch(/Rend Armor/);
        expect(imp.enhancements!.d.attack![0]).toBe(10);
        expect(imp.enhancements!.d.attack![5]).toBe(20);
        expect(imp.enhancements!.u!.attack![0]).toBe(true);    // first enhancement is free
        expect(imp.enhancements!.u!.attack![5]).toBe(true);    // bought (TierUnlocked[0])
    });
});

describe('ultimate weapons', () => {
    it('reads ownership and turns 0-based levels into app levels', () => {
        const imp = parseGameExport(makeExport({
            UltimateWeaponUnlocked: [true, false],
            UltimateWeaponLevel: [4, 0, 2],
        }));
        const first = imp.uws![UWS[0].a]!;
        expect(first.own).toBe(true);
        expect(first.sv).toEqual([5, 1, 3]);
        expect(imp.uws![UWS[1].a]!.own).toBe(false);
    });
});

describe('cards', () => {
    it('reads stars, mastery and the cards in each preset', () => {
        const coins = Number(Object.entries(GAME_CARDS).find(([, n]) => n === 'Coins')![0]);
        const levels = zeros(40);
        const unlocked = Array(40).fill(false);
        const mastery = Array(40).fill(false);
        levels[coins] = 9;            // clamps to 7 stars
        unlocked[coins] = true;
        mastery[coins] = true;
        unlocked[0] = true;           // Damage, 1 star (level 0 still counts as owned)

        const slots = zeros(CARD_PRESET_SLOTS * 2);
        const assigned = Array(CARD_PRESET_SLOTS * 2).fill(false);
        slots[CARD_PRESET_SLOTS] = coins;            // card preset 2, slot 1
        assigned[CARD_PRESET_SLOTS] = true;
        const active = Array(40).fill(false);
        active[0] = true;                            // loaded preset: Damage

        const imp = parseGameExport(makeExport({
            CardLevel: levels, CardUnlocked: unlocked, CardMasteryUnlocked: mastery,
            ResearchLevel: research({ [MASTERY_LAB_START + MASTERY_LAB_CARDS.indexOf('Coins')]: 4 }),
            SlotPresetCardInt: slots, SlotPresetCardAssignedBool: assigned, CardActive: active,
            CurrentPreset: 0, GlobalPresets: [{ CardsIndex: 0 }, { CardsIndex: 1 }],
        }));
        expect(imp.cards!.data.Coins).toEqual({ s: 7, m: 4, mu: true });
        expect(imp.cards!.data.Damage.s).toBe(1);
        expect(imp.cards!.data.Damage.mu).toBe(false);
        expect(imp.cards!.presets[0]).toEqual(['Damage']);
        expect(imp.cards!.presets[1]).toEqual(['Coins']);
    });

    // Cells' mastery lab is 251, outside the original 30-card run (the
    // owner's lab-number list and TheTowerSDK, 2026-11-05). It used to import as 0.
    it('reads Cells mastery from its own lab number', () => {
        const unlocked = Array(40).fill(false);
        const levels = zeros(40);
        unlocked[37] = true;
        levels[37] = 7;
        const imp = parseGameExport(makeExport({
            CardLevel: levels, CardUnlocked: unlocked, CardMasteryUnlocked: Array(40).fill(false),
            ResearchLevel: research({ 251: 6 }),
        }));
        expect(GAME_CARDS[37]).toBe('Cells');
        expect(imp.cards!.data.Cells.m).toBe(6);
    });
});

describe('perks, league, preset names', () => {
    it('maps banned perks it knows and skips the rest', () => {
        const imp = parseGameExport(makeExport({ BannedPerksIndex: [3, 10, 40, 99, -1] }));
        expect(imp.bannedPerks).toEqual(['coins', 'to_dmg']);
    });

    it('names the perks read off the owner\'s Auto Pick list (2026-11-02)', () => {
        // The list's first 12 against AutoPickOrder [10,3,12,24,27,28,25,22,8,47,2,0,…].
        const imp = parseGameExport(makeExport({ BannedPerksIndex: [8, 47, 2, 0, 22] }));
        expect(imp.bannedPerks).toEqual(['freeupg', 'to_regen', 'hregen', 'health', 'dw_wave']);
    });

    it('reads the league, and leaves it unknown when the file has none', () => {
        expect(parseGameExport(makeExport({ HighestLeague: 6 })).league).toBe('Mythic');
        expect(parseGameExport(makeExport({ HighestLeague: 0 })).league).toBe('Copper');
        expect(parseGameExport(makeExport()).league).toBe('');
    });

    it('names presets from the global or workshop preset, skipping defaults and repeats', () => {
        const imp = parseGameExport(makeExport({
            GlobalPresets: [
                { PresetName: 'Preset 1', WorkshopIndex: 0 },
                { PresetName: 'Tourney', WorkshopIndex: 1 },
                { PresetName: 'Preset 3', WorkshopIndex: 0 },   // same workshop name as preset 1
                { PresetName: 'tourney', WorkshopIndex: 3 },    // repeat of preset 2
            ],
            WorkshopPresetName: ['GC Farm', 'tournament', 'Preset 3', 'eHP', 'Preset 5'],
        }));
        expect(imp.presetNames).toEqual(['GC Farm', 'Tourney', '', '', '']);
    });
});

describe('labs', () => {
    it('reads labs by game number and clamps to the lab max', () => {
        const imp = parseGameExport(makeExport({ ResearchLevel: research({ 0: 5, 10: 9999 }) }));
        expect(labIndex('Damage Lab')).toBe(0);
        expect(labIndex('Health Lab')).toBe(10);
        expect(imp.labs!['Damage Lab']).toBe(5);
        expect(imp.labs!['Health Lab']).toBe(labMax('Health Lab'));
    });

    // The owner's lab-number list (2026-11-05), agreeing with TheTowerSDK:
    // numbers the owner's account couldn't tell apart (equal levels, or 0).
    it('reads the labs the lab-number list placed', () => {
        const imp = parseGameExport(makeExport({
            ResearchLevel: research({
                19: 12, 99: 1, 147: 3, 148: 1, 149: 5, 133: 1, 132: 0, 150: 1, 151: 0,
                134: 4, 193: 6, 199: 9, 155: 40, 198: 2, 209: 3, 220: 11, 248: 30, 253: 12,
            }),
        }));
        expect(imp.labs!['Recovery Pkg Amount']).toBe(12);   // 19, not 99
        expect(imp.labs!['SM-Recharge Barrage']).toBe(3);
        expect(imp.labs!['Recharge Nuke']).toBe(5);
        expect(imp.labs!['Reroll Daily Missions']).toBe(1);
        expect(imp.labs!['BH-Disable Ranged(unlock)']).toBe(1);
        expect(imp.labs!['Light Speed Shots']).toBe(0);
        expect(imp.labs!['Workshop Enhancement']).toBe(1);
        expect(imp.labs!['Unmerge Module']).toBe(0);
        expect(imp.labs!['Common Drop Chance']).toBe(4);
        expect(imp.labs!['Garlic Thorns']).toBe(6);
        expect(imp.labs!['BC Reduction']).toBe(9);
        expect(imp.labs!['Enh Def Discount']).toBe(40);
        expect(imp.labs!['ILM-Chrono Jump']).toBe(2);
        expect(imp.labs!['EnemyLvlSkip Reduction']).toBe(3);
        expect(imp.labs!['Ray Attack']).toBe(11);
        expect(imp.labs!['Saboteur Attack Speed']).toBe(30);
        expect(imp.labs!['Primary-Cannon Mult']).toBe(12);
    });

    it('has one game number for every lab on the Labs tab', () => {
        const names = Object.values(GAME_LABS);
        expect(new Set(names).size).toBe(names.length);
        expect(LABS.flatMap(c => c.l).map(([n]) => n).filter(n => !names.includes(n))).toEqual([]);
        // The removed labs and Bastion's (not out yet) aren't site labs.
        for (const n of [86, 99, 135, 136, 137, 138, 249, 250]) expect(GAME_LABS[n]).toBeUndefined();
    });
});

describe('modules', () => {
    // Effect codes count through (effect, rarity) pairs: cannon Attack Speed
    // Common = 1 … Ancestral = 6, Crit Chance 7–12, Crit Factor 13–18.
    const subsOf = (imp: ReturnType<typeof parseGameExport>, guid: string) =>
        imp.modules!.state.library.find(m => m.id === guid)!.subs.map(s => `${s.rar} ${s.effect}`);

    it('names unique modules, decodes rarity and effects, skips generic ones', () => {
        const imp = parseGameExport(makeExport({
            ModuleEquipped: [gameModule('as', 45, 15, [18, 6, 1])],     // Amplifying Strike, Ancestral 5★
            ModuleInventory: [
                gameModule('gen', 3, 10, [1, 2]),                        // generic cannon — not imported
                gameModule('sr', 41, 6, [13, 7, 1]),                     // Shrink Ray, Legendary
            ],
        }));
        const lib = imp.modules!.state.library;
        expect(lib.map(m => m.name).sort()).toEqual(['Amplifying Strike', 'Shrink Ray']);
        expect(lib.find(m => m.id === 'as')).toMatchObject({ type: 'cannon', rarity: 'A5' });
        expect(lib.find(m => m.id === 'sr')!.rarity).toBe('L');
        expect(subsOf(imp, 'as')).toEqual(['Ancestral Crit Factor', 'Ancestral Attack Speed', 'Common Attack Speed']);
        expect(lib.find(m => m.id === 'as')!.subs[0].val).toBe('15x');
    });

    it('pins the ends of each type block and the later Max Recovery code', () => {
        const top = (type: 'cannon' | 'armor' | 'generator' | 'core', name: string) => {
            const vals = SUB_EFFECTS[type].find(([n]) => n === name)![2];
            return `${SUB_RARITIES[vals.length - 1 - [...vals].reverse().findIndex(v => v !== null)]} ${name}`;
        };
        const imp = parseGameExport(makeExport({
            ModuleInventory: [
                gameModule('c80', 7, 10, [80]),
                gameModule('a154', 17, 10, [154]),
                gameModule('g216', 27, 10, [216]),
                gameModule('k326', 37, 10, [326]),
                gameModule('g328', 30, 10, [328]),
            ],
        }));
        expect(subsOf(imp, 'c80')).toEqual([top('cannon', 'Max Rend Armor Multi')]);
        expect(subsOf(imp, 'a154')).toEqual([top('armor', 'Wall Rebuild')]);
        expect(subsOf(imp, 'g216')).toEqual([top('generator', 'Enemy HP Level Skip')]);
        expect(subsOf(imp, 'k326')).toEqual([top('core', 'Spotlight - Angle')]);
        expect(subsOf(imp, 'g328')).toEqual(['Epic Max Recovery']);
    });

    it('only shows effects whose slot the module has unlocked', () => {
        // Slots 4–6 unlock at levels 101 / 141 / 161, slot 8 at 241.
        const effects = [1, 7, 13, 2, 8, 14, 3, 9];
        const imp = parseGameExport(makeExport({
            ModuleInventory: [gameModule('low', 45, 6, effects, 120), gameModule('max', 41, 15, effects, 250)],
        }));
        // Lv 120: slots 1–3, 4 (101) and 7 (always open) — not 5, 6 or 8.
        expect(subsOf(imp, 'low')).toEqual([
            'Common Attack Speed', 'Common Crit Chance', 'Common Crit Factor', 'Rare Attack Speed', 'Epic Attack Speed',
        ]);
        expect(subsOf(imp, 'max')).toHaveLength(8);
    });

    it('keeps unique modules it cannot name as unnamed, typed from their effects', () => {
        const imp = parseGameExport(makeExport({ ModuleInventory: [gameModule('x', 49, 10, [90, 95])] }));
        expect(imp.modules!.state.library).toHaveLength(0);
        expect(imp.modules!.unnamed).toEqual([expect.objectContaining({ infoIndex: 49, type: 'armor', rarity: 'A' })]);
    });

    it('brings presets in game order with the equipped one active', () => {
        const mods = [
            gameModule('c1', 45, 15, [1]), gameModule('c2', 41, 15, [1]),
            gameModule('a1', 42, 10, [90]), gameModule('g1', 43, 10, [160]), gameModule('k1', 44, 10, [220]),
        ];
        const imp = parseGameExport(makeExport({
            ModuleEquipped: [mods[1], mods[2], mods[3], mods[4]],     // differs from saved preset 2
            ModuleInventory: [mods[0]],
            ModulePresets: [
                { PresetName: 'farm', PrimaryModuleGuids: ['c1', 'a1', 'g1', 'k1'], AssistModuleGuids: ['', '', '', ''] },
                { PresetName: 'push', PrimaryModuleGuids: ['c1', 'a1', 'g1', 'k1'], AssistModuleGuids: ['nope', '', '', ''] },
                { PresetName: 'Preset 3', PrimaryModuleGuids: [], AssistModuleGuids: [] },
            ],
            CurrentModulePreset: 1,
            SlotLevels: [217, 202, 216, 216],
        }));
        const ms = imp.modules!.state;
        expect(ms.loadouts.map(l => `${l.id}:${l.name}`)).toEqual(['game-0:farm', 'game-1:push', 'game-2:Preset 3']);
        expect(ms.activeLoadout).toBe('game-1');
        expect(ms.loadouts[1].slots.cannon).toEqual({ main: 'c2', assist: '' });   // what's equipped, unknown Guid dropped
        expect(ms.loadouts[0].slots.cannon.main).toBe('c1');
        expect(ms.loadouts[2].slots.core.main).toBe('');
        expect(ms.slotLevels.cannon.main).toBe(217);
    });

    it('reads assist slots: tier, efficiency (1 + stone levels + labs) and level', () => {
        const imp = parseGameExport(makeExport({
            ModuleEquipped: [gameModule('c1', 45, 15, [1])],
            AssistModuleSlots: [{
                Type: 0, Unlocked: true, Level: 150,
                UniqueEffectEfficiencyLevel: 2, MainEffectEfficiencyLevel: 10, SubstatEfficiencyLevel: 7,
                EquippedModule: gameModule('c2', 41, 15, [1]),
            }],
            ResearchLevel: research({ [labIndex('Assist-Cannon Substat')]: 9 }),
        }));
        const ms = imp.modules!.state;
        expect(ms.assistData.cannon).toEqual({ rarity: 'Mythic', multEff: 11, subEff: 17 });
        expect(ms.assistData.armor.rarity).toBe('locked');
        expect(ms.slotLevels.cannon.assist).toBe(150);
        expect(ms.library.map(m => m.id).sort()).toEqual(['c1', 'c2']);
    });
});

describe('battle history', () => {
    it('turns a battle into a report', () => {
        const [r] = parseGameExport(makeExport({
            BattleHistory: [battle({
                TotalBoss: 40, TotalElites: 900, TotalCommanders: 5, TotalSaboteurs: 6, TotalOvercharges: 7,
                DestroyedInGoldenBot: 600000, RealTime: 3600, CoinsEarned: 2e14, IsTournament: true,
            })],
        })).battles;
        expect(r).toMatchObject({ tier: 18, wave: 8000, bossKills: 40, eliteKills: 900, fleetKills: 18, tournament: true });
        expect(r.coinsPerHour / 2e14).toBeCloseTo(1, 9);
        expect(r.killedWithEffect.goldenBot).toBe(1);    // share capped at 100%
    });

    it('picks the newest full run on the usual farming tier by default', () => {
        const { battles } = parseGameExport(makeExport({
            BattleHistory: [
                battle({ Tier: 18, Wave: 8000 }),
                battle({ Tier: 18, Wave: 8200 }),
                battle({ Tier: 18, Wave: 9000, IsTournament: true }),
                battle({ Tier: 18, Wave: 120 }),                     // quit early
                battle({ Tier: 20, Wave: 3000 }),
                battle({ Tier: 18, Wave: 1, TotalEnemies: 0 }),      // restart
            ],
        }));
        expect(isRealRun(battles[5])).toBe(false);
        expect(defaultBattleIndex(battles)).toBe(1);
        expect(defaultBattleIndex([])).toBe(-1);
    });

    it('keeps every field the game stored for a run, and when it was played', () => {
        const [r] = parseGameExport(makeExport({
            BattleHistory: [battle({ KilledBy: 3, DamageTakenWall: 5e15, SomeList: [1, 2], Nested: { a: 1 } })],
        })).battles;
        expect(r.time).toBe(Date.parse('2026-10-01T12:00:00Z'));
        expect(r.raw).toMatchObject({ KilledBy: 3, DamageTakenWall: 5e15, SomeList: [1, 2], Tier: 18, IsTournament: false });
        expect(r.raw).not.toHaveProperty('Nested');
    });
});

describe('battle history across imports', () => {
    // The file only holds the last 5 runs; each import adds to what's kept.
    const runs = (...fields: Record<string, unknown>[]) =>
        parseGameExport(makeExport({ BattleHistory: fields.map(f => battle(f)) })).battles;

    it('adds new runs, replaces runs seen again, and keeps them oldest first', () => {
        const first = runs(
            { BattleDate: '2026-10-01T00:00:00Z', Wave: 100 },
            { BattleDate: '2026-10-02T00:00:00Z', Wave: 200 },
        );
        const second = runs(
            { BattleDate: '2026-10-02T00:00:00Z', Wave: 200, KilledBy: 2 },   // same run, fresh copy
            { BattleDate: '2026-10-03T00:00:00Z', Wave: 300 },
        );
        const merged = mergeBattles(first, second);
        expect(merged.map(b => b.wave)).toEqual([100, 200, 300]);
        expect(merged[1].raw?.KilledBy).toBe(2);
        expect(mergeBattles(merged, second)).toEqual(merged);
    });

    it('puts runs kept before times were stored first, and caps the history', () => {
        const old = { ...runs({ Wave: 50 })[0], time: undefined, raw: undefined };
        const fresh = runs({ BattleDate: '2026-10-05T00:00:00Z', Wave: 60 });
        expect(mergeBattles(fresh, [old]).map(b => b.wave)).toEqual([50, 60]);

        const many = runs(...Array.from({ length: MAX_STORED_BATTLES + 7 }, (_, i) => ({
            BattleDate: new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString(), Wave: 1000 + i,
        })));
        const kept = mergeBattles([], many);
        expect(kept).toHaveLength(MAX_STORED_BATTLES);
        expect(kept[0].wave).toBe(1007);     // the oldest 7 drop off
    });
});

// 29.1.3 adds bots, labs being researched, the current league and the
// export's own version and time (TTG's change notes; TTG's test export).
describe('29.1.3 exports (ExportVersion 1)', () => {
    // One bot preset row as the game writes it, levels in save order
    // [secondary, range, cooldown, primary].
    const row = (levels: number[], fields: Record<string, unknown> = {}) => ({
        Unlocked: true, Active: true, Levels: levels, SelectedLevels: zeros(4), PlusUnlocked: false, PlusLevel: 0, ...fields,
    });
    const off = row(zeros(4), { Unlocked: false, Active: false });
    const noBots = {
        FlameBotPresets: [off, off, off, off, off], ThunderBotPresets: [off, off, off, off, off],
        GoldenBotPresets: [off, off, off, off, off], AmplifyBotPresets: [off, off, off, off, off],
        BotBotPresets: [off, off, off, off, off],
    };

    it('reads the format version, export time and current league; older files leave them empty', () => {
        const imp = parseGameExport(makeExport({
            ExportVersion: 1, ExportedAt: '2026-10-19T14:02:11.123Z', LeagueID: 4, HighestLeague: 5,
        }));
        expect(imp.exportVersion).toBe(1);
        expect(imp.exportedAt).toBe(Date.UTC(2026, 9, 19, 14, 2, 11, 123));
        expect(imp.currentLeague).toBe('Champion');
        expect(imp.league).toBe('Legend');
        const old = parseGameExport(makeExport());
        expect([old.exportVersion, old.exportedAt, old.currentLeague, old.bots, old.labsRunning])
            .toEqual([null, null, '', null, null]);
    });

    it('reads bot levels in the game’s stat order, per preset through its global preset', () => {
        const imp = parseGameExport(makeExport({
            ...noBots,
            FlameBotPresets: [row([3, 4, 5, 6]), row([10, 0, 0, 1], { Active: false }), off, off, off],
            GlobalPresets: [{ BotsIndex: 0 }, { BotsIndex: 1 }, { BotsIndex: 0 }],
        }));
        const b = imp.bots!;
        // Flame Bot shows [Damage Reduction, Cooldown, Damage, Range] = save [3, 2, 0, 1].
        expect(b.medals['Flame Bot'][0]).toEqual([6, 5, 3, 4]);
        expect(b.medals['Flame Bot'][1]).toEqual([1, 0, 10, 0]);
        expect(b.medals['Flame Bot'][2]).toEqual([6, 5, 3, 4]);
        expect(b.owned).toMatchObject({ 'Flame Bot': true, 'Thunder Bot': false });
        expect(b.loadouts[0]).toEqual(['Flame Bot']);
        expect(b.loadouts[1]).toEqual([]);
    });

    // The owner's GC Farm preset (2026-10-22 Bots screen): only Golden Bot and
    // Bot Bot unlocked, the rest "UNLOCK BOT 600" — though other presets have
    // them. Save order [secondary, range, cooldown, primary].
    it('unlocks bots per preset, as each bot preset row says', () => {
        const imp = parseGameExport(makeExport({
            ...noBots,
            ThunderBotPresets: [off, row([20, 15, 15, 20])],
            GoldenBotPresets: [row([30, 20, 15, 19]), off],
            AmplifyBotPresets: [off, row([30, 18, 15, 11], { PlusUnlocked: true })],
            GlobalPresets: [{ BotsIndex: 0 }, { BotsIndex: 1 }],
        }));
        const b = imp.bots!;
        expect([b.unlocked['Thunder Bot'][0], b.unlocked['Thunder Bot'][1]]).toEqual([false, true]);
        expect(b.owned['Thunder Bot']).toBe(true);                         // unlocked somewhere
        expect(b.plusUnlocked['Amplify Bot'][0]).toBe(false);              // Bot+ only counts where the bot is
        expect(b.loadouts[0]).toEqual(['Golden Bot']);
        expect(b.loadouts[1]).toEqual(['Thunder Bot', 'Amplify Bot']);
        useGameStore.getState().applyGameImport(imp);
        const gcFarm = botsForPreset(useGameStore.getState().botData, 0);
        expect(gcFarm['Thunder Bot'].owned).toBe(false);
        expect(gcFarm['Golden Bot'].owned).toBe(true);
        expect(gcFarm['Amplify Bot'].plusOwned).toBe(false);
        expect(botsForPreset(useGameStore.getState().botData, 1)['Thunder Bot'].owned).toBe(true);
    });

    it('unlocking or locking a bot by hand changes that preset only, and edits keep the flags', () => {
        const st = useGameStore.getState();
        st.applyGameImport(parseGameExport(makeExport({
            ...noBots, GoldenBotPresets: [row([30, 20, 15, 19]), off], GlobalPresets: [{ BotsIndex: 0 }, { BotsIndex: 1 }],
        })));
        useGameStore.getState().setBotOwned('Golden Bot', true, 1);
        useGameStore.getState().setBotMedal('Golden Bot', 1, 0, 5);
        const bots = useGameStore.getState().botData;
        expect(botsForPreset(bots, 1)['Golden Bot'].owned).toBe(true);
        expect(botsForPreset(bots, 1)['Golden Bot'].medals[0]).toBe(5);    // the rest Lv 0 (unset)
        expect(botsForPreset(bots, 0)['Golden Bot']).toMatchObject({ owned: true, medals: [19, 15, 30, 20] });
        useGameStore.getState().setBotOwned('Golden Bot', false, 0);
        expect(botsForPreset(useGameStore.getState().botData, 0)['Golden Bot'].owned).toBe(false);
        expect(botsForPreset(useGameStore.getState().botData, 1)['Golden Bot'].owned).toBe(true);
    });

    // The owner's Bots screen: Bot Bot Bonus ×2.00 Max at level 19; Golden Bot
    // and Bot Bot Range 80 m Max at level 20 = 60 m + 12 m of Bot Range relics
    // + 8 m from the Vault's Bot Range (id 1810, level 4).
    it('matches the game’s Bot Bot table and Vault Bot Range', () => {
        const botBot = BOTS_CONFIG.find(b => b.name === 'Bot Bot')!;
        const [, , bonus, range] = botBot.stats;
        expect([bonus.lv0, bonus.values.length, bonus.values[18]]).toEqual(['1.05x', 19, '2.00x']);
        expect([range.lv0, range.values.length, range.values[19]]).toEqual(['20m', 20, '60m']);
        const vault = parseGameExport(makeExport({ Vault: { UpgradesLevel: { 1810: 4, 600: 5 } } })).vault!;
        expect(vault).toEqual({ 1810: 4, 600: 5 });
        expect(parseFloat(range.values[19]) + 12 + vaultBotRange(vault)).toBe(80);
        expect(vaultBotRange(parseGameExport(makeExport({ Vault: { UpgradesLevel: [{ Key: 1810, Value: 2 }] } })).vault!)).toBe(4);
        expect(parseGameExport(makeExport()).vault).toBeNull();
    });

    // The owner's export: SlotsUnlocked 21 and the Vault's Additional Card
    // Slot (1200) at level 4 — 25 slots, the 25 cards the loadout holds.
    it('adds the Vault’s card slots and keeps the unlocked sections', () => {
        const imp = parseGameExport(makeExport({
            SlotsUnlocked: 21,
            Vault: { UnlockedGroups: [100, 110, 1030], UpgradesLevel: { 1200: 4, 600: 5 } },
        }));
        expect(imp.cardSlots).toBe(25);
        expect(imp.vault).toEqual({ 1200: 4, 600: 5, g100: 1, g110: 1, g1030: 1 });
        expect(parseGameExport(makeExport({ SlotsUnlocked: 21 })).cardSlots).toBe(21);   // no Vault in the file
    });

    it('takes the higher of the bought and picked level, up to the stat’s max', () => {
        const imp = parseGameExport(makeExport({
            ...noBots,
            FlameBotPresets: [row([0, 0, 2, 99], { SelectedLevels: [0, 0, 7, 0] }), off, off, off, off],
        }));
        expect(imp.bots!.medals['Flame Bot'][0]).toEqual([25, 7, 0, 0]);
    });

    it('reads the labs being researched', () => {
        const dmg = labIndex('Damage Lab');
        const done = Array(260).fill('0001-01-01T00:00:00.000Z');
        done[dmg] = '2026-10-20T08:00:00.000Z';
        const imp = parseGameExport(makeExport({
            ExportedAt: '2026-10-19T14:00:00.000Z',
            LabActiveBool: [true, false, true, false, false],
            LabResearchInt: [dmg, 0, 999, 0, 0],
            LabSpeedUpSpeed: [2, 0, 0, 0, 0],
            LabSpeedUpRemainingSeconds: [3600, 0, 0, 0, 0],
            ResearchCompleteDate: done,
        }));
        const at = Date.UTC(2026, 9, 19, 14);
        expect(imp.labsRunning).toEqual([
            { lab: 'Damage Lab', labIndex: dmg, toLevel: 1, doneAt: Date.UTC(2026, 9, 20, 8), speedUp: 2, speedUpLeftSec: 3600, exportedAt: at },
            { lab: null, labIndex: 999, toLevel: 1, doneAt: null, speedUp: 0, speedUpLeftSec: 0, exportedAt: at },
        ]);
    });

    // Owner's Labs screen (2026-10-21): lab 169 is "Enemy Balance Mastery
    // Lv.6" with ResearchLevel 5 — a card mastery lab, and the level being
    // researched is the stored one + 1.
    it('names card mastery labs and gives the level being researched', () => {
        const eb = MASTERY_LAB_START + MASTERY_LAB_CARDS.indexOf('Enemy Balance');
        expect(eb).toBe(169);
        const imp = parseGameExport(makeExport({
            LabActiveBool: [true, false, false, false, false],
            LabResearchInt: [eb, 0, 0, 0, 0],
            ResearchLevel: research({ [eb]: 5 }),
        }));
        expect(imp.labsRunning![0]).toMatchObject({ lab: 'Enemy Balance Mastery', labIndex: 169, toLevel: 6 });
    });

    // LabsUnlocked is the slots bought, beside the free first one: the
    // owner's 4 with 5 labs running, a newer account's 2 with 3 (2026-10-28).
    it('reads the lab slots owned', () => {
        expect(parseGameExport(makeExport({ LabsUnlocked: 2 })).labSlots).toBe(3);
        expect(parseGameExport(makeExport({ LabsUnlocked: 4 })).labSlots).toBe(5);
        expect(parseGameExport(makeExport({})).labSlots).toBeNull();
    });

    // Slots from TheTowerSDK's catalog: 0 No Spoon (Defense Absolute 2%),
    // 1 Red Pill (Health 5%), 2 Copper Badge (Damage 3%), 318 Massive
    // Abduction (Cash 5%), 320 Alien Encounter (Bot Range 2 m).
    it('adds up the relics owned into the Relics totals, and counts slots it doesn’t know', () => {
        const slots = zeros(336);
        for (const i of [0, 1, 2, 318, 320, 330]) slots[i] = 2;
        const r = parseGameExport(makeExport({ RelicsUnlocked: slots })).relics!;
        expect(r.owned).toBe(6);
        expect(r.unknown).toBe(1);                                         // slot 330: newer than the catalog
        expect(r.totals).toMatchObject({ rDefAbs: 2, rHP: 5, rDmg: 3, rCash: 5, rBotRange: 2, rCoins: 0 });
        expect(Object.keys(r.totals)).toHaveLength(27);                    // every Relics stat, 0 when none owned
        expect(parseGameExport(makeExport()).relics).toBeNull();
    });

    it('imports the relic totals over what was typed in', () => {
        useGameStore.getState().setRelic('rDmg', 99);
        const raw = makeExport({ RelicsUnlocked: [0, 0, 2] });
        useGameStore.getState().applyGameImport(parseGameExport(raw));
        expect(useGameStore.getState().relicData.rDmg).toBe(3);
    });

    // The row on the game's Modules screen: Reroll Shards, then each type's shards.
    it('reads the module currencies', () => {
        const imp = parseGameExport(makeExport({
            ModuleRerollCurrency: 24065485, ModuleCannonShards: 510, ModuleArmorShards: 115500,
            ModuleGeneratorShards: 818, ModuleCoreShards: 716,
        }));
        expect(imp.currencies).toMatchObject({
            rerollShards: 24065485, cannonShards: 510, armorShards: 115500, generatorShards: 818, coreShards: 716,
        });
        expect(parseGameExport(makeExport()).currencies.rerollShards).toBeUndefined();
    });

    // Each one earned in total (Module…Lifetime): spent and saved together.
    it('reads the shards earned in total', () => {
        const imp = parseGameExport(makeExport({
            ModuleCannonShards: 9000, ModuleCannonShardsLifetime: 800000, ModuleArmorShardsLifetime: 760000,
            ModuleGeneratorShardsLifetime: 790000, ModuleCoreShardsLifetime: 780000, ModuleRerollCurrencyLifetime: 1e8,
        }));
        expect(imp.currencies).toMatchObject({
            cannonShardsLifetime: 800000, armorShardsLifetime: 760000, generatorShardsLifetime: 790000,
            coreShardsLifetime: 780000, rerollShardsLifetime: 1e8,
        });
        expect(parseGameExport(makeExport()).currencies.cannonShardsLifetime).toBeUndefined();   // older files
    });

    it('reads every tournament played', () => {
        const imp = parseGameExport(makeExport({
            TournamentRecords: [
                { TournamentNumber: 41, Date: '2026-10-21T00:00:00.000Z', LeagueID: 6, Wave: 1, Rank: 0 },
                { TournamentNumber: 40, Date: '2026-10-17T00:00:00.000Z', LeagueID: 6, Wave: 135, Rank: 19 },
                { TournamentNumber: 39, Date: 'not a date', LeagueID: 5, Wave: 300, Rank: 4 },
            ],
        }));
        expect(imp.tourneyRecords).toEqual([
            { number: 40, date: Date.UTC(2026, 9, 17), league: 'Mythic', wave: 135, rank: 19 },
            { number: 41, date: Date.UTC(2026, 9, 21), league: 'Mythic', wave: 1, rank: 0 },
        ]);
        expect(parseGameExport(makeExport()).tourneyRecords).toBeNull();
    });

    it('reads InGuild into the Guardian', () => {
        expect(parseGameExport(makeExport({ GuardianUnlocked: true, InGuild: false })).guardian!.inGuild).toBe(false);
        expect(parseGameExport(makeExport({ GuardianUnlocked: true })).guardian!.inGuild).toBeUndefined();
    });

    // PlusLevel is the level of the bot's one Bot+ ability, 0 = its unlock
    // value (TheTowerSDK readUserBotDataRow → clampBotPlusStatLevel, stat 0).
    it('reads Bot+ per preset: unlocked, and its level up to the ability’s max', () => {
        const imp = parseGameExport(makeExport({
            ...noBots,
            AmplifyBotPresets: [
                row(zeros(4), { PlusUnlocked: true, PlusLevel: 4 }),
                row(zeros(4), { PlusUnlocked: true, PlusLevel: 99 }),
                row(zeros(4), { PlusUnlocked: false, PlusLevel: 7 }),
                off, off,
            ],
            GoldenBotPresets: [row(zeros(4), { PlusUnlocked: true, PlusLevel: 25 }), off, off, off, off],
            ThunderBotPresets: [row(zeros(4), { PlusLevel: 3 }), off, off, off, off],
            GlobalPresets: [{ BotsIndex: 0 }, { BotsIndex: 1 }, { BotsIndex: 2 }],
        }));
        const b = imp.bots!;
        expect(b.plusOwned).toMatchObject({ 'Amplify Bot': true, 'Golden Bot': true, 'Thunder Bot': false, 'Flame Bot': false });
        expect([0, 1, 2].map(i => b.plusLv['Amplify Bot'][i])).toEqual([4, 9, 0]);   // 9 = Echoing Shot's max
        expect(b.plusLv['Golden Bot'][0]).toBe(25);
        expect(b.plusLv['Thunder Bot'][0]).toBe(0);                                     // not unlocked
    });

    it('importing sets medal and Bot+ levels, what is unlocked, and which bots run', () => {
        useGameStore.setState({
            // Entered before Bot+ was imported: the old Bot+ stat sat in medals[4].
            botData: { 'Amplify Bot': { owned: true, medals: [1, 1, 1, 1, 3], plusLv: 2 } },
            botLoadouts: { 0: [], 1: ['Amplify Bot'] },
        });
        const raw = makeExport({
            ...noBots,
            AmplifyBotPresets: [
                row([0, 0, 0, 5], { PlusUnlocked: true, PlusLevel: 6 }),
                row([0, 0, 0, 5], { Active: false, PlusUnlocked: true, PlusLevel: 0 }),
                off, off, off,
            ],
            GlobalPresets: [{ BotsIndex: 0 }, { BotsIndex: 1 }],
        });
        useGameStore.getState().applyGameImport(parseGameExport(raw));
        const s = useGameStore.getState();
        const p0 = botsForPreset(s.botData, 0);
        const p1 = botsForPreset(s.botData, 1);
        expect(p0['Amplify Bot']).toMatchObject({ owned: true, plusOwned: true, medals: [5, 0, 0, 0], plusLv: 6 });
        expect(p1['Amplify Bot']).toMatchObject({ plusOwned: true, plusLv: 0 });
        expect(echoingShotBullets(p0)).toBe(9);     // 3 at unlock + 6 levels
        expect(echoingShotBullets(p1)).toBe(3);
        expect(s.botLoadouts[0]).toEqual(['Amplify Bot']);
        expect(s.botLoadouts[1]).toEqual([]);
    });
});
