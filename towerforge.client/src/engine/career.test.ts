// Career: the file's lifetime totals, yearly recap and research history, and
// income between imports. Made-up exports, with the owner's numbers where one
// was checked: T18's best cells and coins (export of 2026-11-01) are the most
// any of their saved T18 runs earned.

import { beforeEach, describe, expect, it } from 'vitest';
import { addIncomePoint, incomeSummary, labsByMonth, parseCareer, parseIncomePoint, runRecords, yearHighlights } from './career';
import type { CareerYear, IncomePoint } from './career';
import { SUBSTAT_NUMBERS } from '../constants/gameExportMaps';
import { parseGameExport } from './gameExport';
import { accountSummary } from '../ai/aiTools';
import { useGameStore } from '../store/useGameStore';
import { battle, makeExport } from '../test/makeExport';

const DAY = 86400000;
const AT = Date.parse('2026-11-01T12:00:00Z');
const file = (fields: Record<string, unknown> = {}, at = AT) => makeExport({
    ExportedAt: new Date(at).toISOString(),
    TotalCoinsEarned: 1e20, TotalGemsEarned: 1000, TotalStonesEarned: 500, TotalMedalsEarned: 300, TotalCellsEarned_v2: 7e8,
    TotalKeysEarned: 40, TotalTokensEarned: 90, TotalBitsEarned: 70,
    ...fields,
});
const point = (t: number, coins: number, stones = 500): IncomePoint => ({
    t, earned: { coins, gems: 0, stones, medals: 0, cells: 0, keys: 0, tokens: 0, bits: 0 },
});

describe('parseCareer', () => {
    it('reads the lifetime totals without the run in progress', () => {
        const c = parseCareer({ TotalCoinsEarned: 5, TotalWavesCompleted: 9, TotalDamageByBotThisRound: 3, GameStartedDate: '2023-03-05T18:32:06.000Z', PlayTime: 100 })!;
        expect(c.totals).toEqual({ CoinsEarned: 5, WavesCompleted: 9 });
        expect(c.started).toBe(Date.parse('2023-03-05T18:32:06.000Z'));
        expect(c.playSec).toBe(100);
    });

    it('reads each year of the recap, with its Mantissa and Exponent numbers, oldest first', () => {
        const c = parseCareer({
            TotalCoinsEarned: 5,
            WrappedStats: [
                { Year: 2026, TournamentAmount: 8, ChainLightningDamage: { Mantissa: 5.07, Exponent: 49 } },
                { Year: 2025, TournamentAmount: 0 },
            ],
        })!;
        expect(c.years.map(y => y.Year)).toEqual([2025, 2026]);
        expect(c.years[1].TournamentAmount).toBe(8);
        expect(c.years[1].ChainLightningDamage).toBeCloseTo(5.07e49, -47);
    });

    it('reads best coins and cells by tier number, as on the owner\'s T18', () => {
        const tiers = (t: number, v: number) => Array.from({ length: 40 }, (_, i) => (i === t ? v : 0));
        const c = parseCareer({ TotalCoinsEarned: 5, HighestCoinsEarnedThisTier: tiers(18, 4.551e18), HighestCellsEarnedThisTier: tiers(18, 2377780.5) })!;
        expect(c.tierCoins[18]).toBe(4.551e18);
        expect(c.tierCells[18]).toBe(2377780.5);
    });

    it('keeps research history small and in order', () => {
        const c = parseCareer({
            TotalCoinsEarned: 5,
            CompletedLabs: [
                { dateCompleted: '2026-11-01T03:26:02.591Z', labNumber: 236, level: 24 },
                { dateCompleted: '2024-10-18T14:59:31.164Z', labNumber: 11, level: 18 },
                { dateCompleted: 'not a date', labNumber: 12, level: 1 },
            ],
        })!;
        expect(c.labs.map(l => l.slice(1))).toEqual([[11, 18], [236, 24]]);
        expect(labsByMonth(c.labs)).toEqual([['2024-10', 1], ['2026-11', 1]]);
    });

    it('adds up the module extras', () => {
        const m = parseCareer({
            TotalCoinsEarned: 5, ModulePity: 75, CommonModulesObtained: 9, RareModulesObtained: 8, EpicModulesObtained: 7,
            SlotCoinsSpent: [1, 2, 3, 4], SlotShardsSpent: [10, 20], ModuleRerollCurrencyLifetime: 1000,
            ModuleInventory: [{ RerollCounter: 100 }, { RerollCounter: 0 }, { Guid: 'none' }],
            ModuleEquipped: [{ RerollCounter: 1142 }],
            AssistModuleSlots: [{ EquippedModule: { RerollCounter: 4659 } }, { EquippedModule: null }, {}],
        })!.modules!;
        expect(m).toEqual({ epicPity: 75, common: 9, rare: 8, epic: 7, rerolls: 5901, mostRerolled: 4659, slotCoins: 10, slotShards: 30, rerollShards: 1000 });
    });

    it('counts the assist slots\' spending with the main slots\'', () => {
        // The owner's export: 3,225,451 shards in all, not the main slots' 1,816,995.
        const m = parseCareer({
            TotalCoinsEarned: 5, SlotShardsSpent: [423930, 442655, 535580, 414830],
            SlotCoinsSpent: [1e17, 2e17, 3e17, 4e17],
            AssistModuleSlots: [{ ShardsSpent: 405905, CoinsSpent: 1e16 }, { ShardsSpent: 326280 }, { ShardsSpent: 279116 }, { ShardsSpent: 397155 }],
        })!.modules!;
        expect(m.slotShards).toBe(3225451);
        expect(m.slotCoins).toBe(1.01e18);
    });

    // The owner's export (2026-11-05): Core bans 51, 52, 53, 60 — the Core
    // Effect Bans screen showed the three Smart Missiles stats banned (2026-11-02).
    it('reads rare pity and the reroll settings by the game\'s substat numbers', () => {
        const m = parseCareer({
            TotalCoinsEarned: 5, ModuleRarePity: 5,
            CannonSubstatBans: [], ArmorSubstatBans: [], GeneratorSubstatBans: [], CoreSubstatBans: [51, 52, 53, 60],
            CannonAutoRerollSubstats: [3, 13], ArmorAutoRerollSubstats: [18], GeneratorAutoRerollSubstats: [47, 46], CoreAutoRerollSubstats: [67, 99],
        })!.modules!;
        expect(m.rarePity).toBe(5);
        expect(m.bans!.core).toEqual(['Smart Missiles - Damage', 'Smart Missiles - Quantity', 'Smart Missiles - Cooldown', 'ILM - Damage']);
        expect(m.bans!.cannon).toEqual([]);
        expect(m.autoReroll!.cannon).toEqual(['Crit Factor', 'Super Crit Chance']);
        expect(m.autoReroll!.armor).toEqual(['Health Regen']);
        expect(m.autoReroll!.generator).toEqual(['Max Recovery', 'Enemy HP Level Skip']);
        expect(m.autoReroll!.core).toEqual(['Poison Swamp - Duration']);   // 99 is past the list
        expect(parseCareer({ TotalCoinsEarned: 5 })!.modules!.bans).toBeUndefined();
    });

    it('numbers substats as the bans screen does', () => {
        expect(SUBSTAT_NUMBERS[0]).toEqual(['cannon', 'Attack Speed']);
        expect(SUBSTAT_NUMBERS[16]).toEqual(['cannon', 'Max Rend Armor Multi']);
        expect(SUBSTAT_NUMBERS[17]).toEqual(['armor', 'Health Regen']);
        expect(SUBSTAT_NUMBERS[34]).toEqual(['generator', 'Cash Bonus']);
        expect(SUBSTAT_NUMBERS[47]).toEqual(['core', 'Chain Lightning - Damage']);
        expect(SUBSTAT_NUMBERS[55]).toEqual(['core', 'Death Wave - Cooldown']);
        expect(SUBSTAT_NUMBERS.at(-1)).toEqual(['core', 'Spotlight - Angle']);
    });

    it('keeps all the levels ever researched and the cards bought', () => {
        const c = parseCareer({ TotalCoinsEarned: 5, ResearchesComplete: 3088, CardsBoughtTotal: 2480 })!;
        expect(c.researched).toBe(3088);
        expect(c.cardsBought).toBe(2480);
        expect(parseCareer({ TotalCoinsEarned: 5 })!.researched).toBeUndefined();
    });

    it('is null for a file before the game kept them', () => {
        expect(parseCareer({})).toBeNull();
    });
});

describe('income between imports', () => {
    it('reads a point from the export\'s own date', () => {
        expect(parseIncomePoint(file() as Record<string, unknown>)?.t).toBe(AT);
        expect(parseIncomePoint({ TotalCoinsEarned: 1 })).toBeNull();
    });

    it('adds a newer export and ignores the same file or an older one', () => {
        const a = [point(AT, 100)];
        expect(addIncomePoint(a, point(AT, 100))).toBe(a);
        expect(addIncomePoint(a, point(AT - DAY, 50))).toBe(a);
        expect(addIncomePoint(a, point(AT + DAY, 120))).toHaveLength(2);
    });

    it('starts over when a total falls: another account or a fresh start', () => {
        expect(addIncomePoint([point(AT, 100)], point(AT + DAY, 5))).toEqual([point(AT + DAY, 5)]);
    });

    it('still covers a month with Auto import bringing a file every 10 minutes', () => {
        const MIN = 60000;
        let log = [point(AT, 0)];
        for (let i = 1; i <= 30 * 24 * 6; i++) log = addIncomePoint(log, point(AT + i * 10 * MIN, i));
        expect(log.length).toBeLessThanOrEqual(125);
        expect(log[0].t).toBe(AT);
        expect(log[log.length - 1].earned.coins).toBe(30 * 24 * 6);   // the newest is always kept
        const s = incomeSummary(log)!;
        expect(s.windowDays).toBeCloseTo(30, 6);
        expect(s.sinceLastDays).toBeGreaterThanOrEqual(1 / 24);        // never "the last 10 minutes"
        expect(s.rows[0].perDay).toBeCloseTo(24 * 6, 6);
    });

    it('gives what came in since the last import and per day', () => {
        const s = incomeSummary([point(AT, 100, 10), point(AT + 2 * DAY, 300, 14), point(AT + 4 * DAY, 500, 30)])!;
        const stones = s.rows.find(r => r.key === 'stones')!;
        expect(s.sinceLastDays).toBeCloseTo(2, 9);
        expect(s.windowDays).toBeCloseTo(4, 9);
        expect(stones).toMatchObject({ total: 30, sinceLast: 16, perDay: 5 });
    });

    it('measures per day over the last 30 days of imports', () => {
        const s = incomeSummary([point(AT, 0), point(AT + 40 * DAY, 4000), point(AT + 50 * DAY, 5000)])!;
        expect(s.windowDays).toBeCloseTo(10, 9);
        expect(s.rows[0].perDay).toBeCloseTo(100, 6);
    });

    it('has no rate from one import, or from two within the hour', () => {
        expect(incomeSummary([point(AT, 100)])!.rows[0]).toMatchObject({ total: 100, sinceLast: null, perDay: null });
        expect(incomeSummary([point(AT, 100), point(AT + 60000, 101)])!.windowDays).toBeNull();
        expect(incomeSummary([])).toBeNull();
    });
});

describe('the game\'s cycle counters', () => {
    // The owner's exports of 10-17 and 10-21, 4 days apart: the lifetime total
    // says 60 bits and 702 medals, the counters 260 and 722. Earned − spent is the
    // change in what they held: bits −205, medals −118, gems +6.
    const at = (t: number, totalBits: number, totalMedals: number, totalCoins: number, earned: Record<string, number>, spent: Record<string, number>): IncomePoint => ({
        t, earned: { coins: totalCoins, bits: totalBits, medals: totalMedals },
        cycle: { earned, spent },
    });
    const a = at(AT, 1000, 5000, 1e20, { bits: 420, medal: 1839, gem: 3558, cannon_shard: 6118 }, { bits: 200, medal: 3120, gem: 3610, cannon_shard: 10000 });
    const b = at(AT + 4 * DAY, 1060, 5702, 1.38e20, { bits: 680, medal: 2561, gem: 5394, cannon_shard: 15742 }, { bits: 665, medal: 3960, gem: 5440, cannon_shard: 19975 });

    it('read from the file', () => {
        const p = parseIncomePoint({
            ExportedAt: new Date(AT).toISOString(), TotalCoinsEarned: 5, ModuleCannonShardsLifetime: 77,
            CurrencyEarnedThisCycle: { Currencies: { bits: 680, coin: 9, cells: 9 } },
            CurrencySpentThisCycle: { Currencies: { bits: 465 } },
        })!;
        expect(p.cycle?.earned.bits).toBe(680);
        expect(p.cycle?.spent.bits).toBe(465);
        expect(p.cycle?.earned.medal).toBe(0);
        expect(p.cycle?.earned.coin).toBeUndefined();      // coins don't add up there
        expect(p.earned.cannon).toBe(77);
        expect(parseIncomePoint({ ExportedAt: new Date(AT).toISOString(), TotalCoinsEarned: 5 })!.cycle).toBeUndefined();
    });

    it('give what the totals leave out, and what was spent', () => {
        const rows = incomeSummary([a, b])!.rows;
        const row = (key: string) => rows.find(r => r.key === key)!;
        expect(row('bits')).toMatchObject({ sinceLast: 260, perDay: 65, spentPerDay: 465 / 4 });
        expect(row('medals')).toMatchObject({ sinceLast: 722, spentPerDay: 840 / 4 });
        expect(row('cannon')).toMatchObject({ sinceLast: 9624, spentPerDay: 9975 / 4 });
    });

    it('leave coins and cells on the totals, with no spending', () => {
        const rows = incomeSummary([a, b])!.rows;
        const coins = rows.find(r => r.key === 'coins')!;
        expect(coins.sinceLast).toBeCloseTo(3.8e19, -15);
        expect(coins.spentPerDay).toBeNull();
    });

    it('fall back on the totals across a restart, and count spending only from it', () => {
        const after = at(AT + 15 * DAY, 1445, 7293, 2.4e20, { bits: 525, medal: 1368, gem: 3715, cannon_shard: 9121 }, { bits: 505, medal: 1700, gem: 3768, cannon_shard: 503555 });
        const s = incomeSummary([b, after])!;
        const row = (key: string) => s.rows.find(r => r.key === key)!;
        expect(row('bits').sinceLast).toBe(525);            // more than the total's 385
        expect(row('medals').sinceLast).toBe(1591);         // the total's change, more than 1368
        expect(row('bits').spentPerDay).toBeCloseTo(505 / 11, 6);
        expect(s.spentFromRestart).toBe(true);
    });

    it('count spending from whole spans when there are some', () => {
        const after = at(AT + 15 * DAY, 1445, 7293, 2.4e20, { bits: 525, medal: 1368, gem: 3715 }, { bits: 505, medal: 1700, gem: 3768 });
        const s = incomeSummary([a, b, after])!;
        expect(s.spentFromRestart).toBe(false);
        expect(s.rows.find(r => r.key === 'bits')!.spentPerDay).toBeCloseTo(465 / 4, 6);
    });

    it('have nothing to say with a log from before them', () => {
        const s = incomeSummary([point(AT, 100), point(AT + DAY, 300)])!;
        expect(s.rows.find(r => r.key === 'gems')!.spentPerDay).toBeNull();
        expect(s.spentFromRestart).toBe(false);
    });
});

describe('run records', () => {
    it('takes the best among the saved runs, and the run that set it', () => {
        const runs = parseGameExport(makeExport({ BattleHistory: [
            battle({ Wave: 8000, HighestCPM: 5e15, LargestGoldenCombo: 700 }),
            battle({ Wave: 9000, HighestCPM: 9e15, LargestGoldenCombo: 600, LargestILMCharge: 0 }),
        ] })).battles;
        const records = runRecords(runs);
        expect(records.map(r => [r.label, r.value, r.run.wave])).toEqual([
            ['Best coins a minute', 9e15, 9000],
            ['Largest Golden Combo', 700, 8000],
        ]);
    });
});

describe('the store', () => {
    beforeEach(() => useGameStore.getState().resetAll());
    const store = () => useGameStore.getState();
    const imp = (fields?: Record<string, unknown>, at?: number) => store().applyGameImport(parseGameExport(file(fields, at)));

    it('keeps the career and logs each import', () => {
        imp();
        expect(store().career?.totals.CoinsEarned).toBe(1e20);
        expect(store().incomeLog).toHaveLength(1);
        imp();
        expect(store().incomeLog).toHaveLength(1);
        imp({ TotalCoinsEarned: 2e20 }, AT + DAY);
        expect(store().incomeLog).toHaveLength(2);
    });

    it('goes through a backup', () => {
        imp();
        imp({ TotalCoinsEarned: 2e20 }, AT + DAY);
        const backup = store().exportData();
        store().resetAll();
        expect(store().career).toBeNull();
        expect(store().incomeLog).toEqual([]);
        store().importData(backup);
        expect(store().career?.totals.CoinsEarned).toBe(2e20);
        expect(store().incomeLog).toHaveLength(2);
    });

    it('keeps what it had from a file without them', () => {
        imp();
        store().applyGameImport(parseGameExport(makeExport({})));
        expect(store().career?.totals.CoinsEarned).toBe(1e20);
    });
});

describe('Ask AI', () => {
    it('knows what the player earns a day, once two imports allow it', () => {
        useGameStore.getState().resetAll();
        useGameStore.getState().applyGameImport(parseGameExport(file()));
        expect(accountSummary(useGameStore.getState())).not.toMatch(/Earned per day/);
        useGameStore.getState().applyGameImport(parseGameExport(file({ TotalStonesEarned: 600, TotalCoinsEarned: 3e20 }, AT + 2 * DAY)));
        expect(accountSummary(useGameStore.getState())).toMatch(/Earned per day over the last 2\.0 d \(the game's counters between imports\): .*Stones 50\./);
    });
});

describe('a year for its picture', () => {
    it('picks the headline numbers, the most-used UW and what ended the most runs', () => {
        const y = yearHighlights({
            Year: 2025, GameBattlesStarted: 2204, GameWavesCleared: 162849, GameTimeInBattle: 4.89e9, TournamentAmount: 96,
            TournamentHighestLeague: 5, TournamentPromotionsAmount: 4, KilledBasic: 1e8, KilledBoss: 2e5, CardsPulledAmount: 300,
            ModulesEarnedAmount: 50, DailyMissionsCompleted: 900, EventMissionsCompleted: 100,
            ChainLightningAmount: 10, BlackHoleAmount: 9000, DiedToBoss: 700, DiedToRay: 900,
        } as CareerYear);
        expect(y).toMatchObject({ year: 2025, battles: 2204, waves: 162849, enemies: 1e8 + 2e5, missions: 1000, bestLeague: 5 });
        expect(y.favoriteUw).toEqual({ name: 'Black Hole', uses: 9000 });
        expect(y.endedMostBy).toBe('Ray');
        expect(yearHighlights({ Year: 2024 } as CareerYear)).toMatchObject({ favoriteUw: null, endedMostBy: null, battles: 0 });
    });
});
