// Career: the file's lifetime totals, yearly recap and research history, and
// income between imports. Made-up exports, with the owner's numbers where one
// was checked: T18's best cells and coins (export of 2026-11-01) are the most
// any of their saved T18 runs earned.

import { beforeEach, describe, expect, it } from 'vitest';
import { addIncomePoint, incomeSummary, labsByMonth, parseCareer, parseIncomePoint, runRecords } from './career';
import type { IncomePoint } from './career';
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
        expect(accountSummary(useGameStore.getState())).toMatch(/Earned per day over the last 2\.0 d \(the game's totals between imports\): .*Stones 50\./);
    });
});
