// ============================================================
//  TowerForge Companion — Career
//  The game's lifetime totals, its yearly recap, best coins and cells per
//  tier, research history, and what a player earns between two imports.
//
//  The lifetime totals aren't a ledger: on the owner's export only Keys come out
//  at what's held (earned − spent), and they leave income out (bits 60 against
//  a real 260 over four days). The game's "this cycle" counters are one: between
//  the owner's exports of 10-17 and 10-21, earned − spent is exactly the change
//  in what's held for gems, stones, medals, keys, tokens, bits, all four module
//  shards and Reroll Shards. So income and spending come from those counters,
//  timed by each export's own date (ExportedAt). Coins and cells don't add up
//  there (coins 2.89e19 out, cells have no spent line), so they stay on the
//  lifetime totals. The counters restart every so often (about 10-26 on the
//  owner's account): across a restart, earned falls back on the totals, and
//  spending is only known from the restart on.
//  Pure functions — no store imports.
// ============================================================

import type { BattleReport } from './battleReport';

// Key, label, lifetime total, and the name in the cycle counters (null where
// those don't add up).
export const INCOME_CURRENCIES = [
    ['coins', 'Coins', 'TotalCoinsEarned', null],
    ['gems', 'Gems', 'TotalGemsEarned', 'gem'],
    ['stones', 'Stones', 'TotalStonesEarned', 'stone'],
    ['medals', 'Medals', 'TotalMedalsEarned', 'medal'],
    ['cells', 'Cells', 'TotalCellsEarned_v2', null],
    ['keys', 'Keys', 'TotalKeysEarned', 'keys'],
    ['tokens', 'Tokens', 'TotalTokensEarned', 'tokens'],
    ['bits', 'Bits', 'TotalBitsEarned', 'bits'],
    ['reroll', 'Reroll Shards', 'ModuleRerollCurrencyLifetime', 'module_reroll'],
    ['cannon', 'Cannon Shards', 'ModuleCannonShardsLifetime', 'cannon_shard'],
    ['armor', 'Armor Shards', 'ModuleArmorShardsLifetime', 'armor_shard'],
    ['generator', 'Generator Shards', 'ModuleGeneratorShardsLifetime', 'generator_shard'],
    ['core', 'Core Shards', 'ModuleCoreShardsLifetime', 'core_shard'],
] as const;

export type IncomeKey = typeof INCOME_CURRENCIES[number][0];

// The game's counters at one export.
export interface IncomePoint {
    t: number;       // the export's date, in ms
    earned: Partial<Record<IncomeKey, number>>;   // lifetime totals
    // "This cycle", by the game's names; omitted for a file without them.
    cycle?: { earned: Record<string, number>; spent: Record<string, number> };
}

// Epic pity and a pull's price (TheTowerSDK, from v29's ModuleManager).
export const EPIC_PITY_PULLS = 150;
export const GEMS_PER_PULL = 20;

export interface CareerModules {
    epicPity: number;      // pulls since the last Epic (ModulePity)
    common: number;        // modules pulled, by rarity
    rare: number;
    epic: number;
    rerolls: number;       // rerolls across every module owned
    mostRerolled: number;  // the most on one module
    slotCoins: number;     // spent levelling the four module slots
    slotShards: number;
    rerollShards: number;  // Reroll Shards ever earned
}

// One year of the game's recap: numbers by the game's own field names.
export type CareerYear = Record<string, number> & { Year: number };

export interface Career {
    started: number | null;           // GameStartedDate, in ms
    playSec: number;                  // PlayTime
    totals: Record<string, number>;   // Total… fields, without the "Total"
    years: CareerYear[];              // oldest first
    tierCoins: number[];              // best coins in a run, by tier number
    tierCells: number[];              // best cells in a run, by tier number
    labs: [number, number, number][]; // levels finished, oldest first: seconds, lab number, level
    modules?: CareerModules;
    researched?: number;              // every lab level ever finished; `labs` holds only the newer ones
    cardsBought?: number;
}

const MAX_INCOME_POINTS = 200;
// Auto import can bring a new file every 10 minutes during a run. Older imports
// are kept this far apart, so 200 of them still cover the 30 days.
const MIN_POINT_GAP_MS = 6 * 3600000;
const MS_PER_HOUR = 3600000;
const INCOME_WINDOW_DAYS = 30;
const MS_PER_DAY = 86400000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.map(x => (typeof x === 'number' ? x : 0)) : []);
const dateMs = (v: unknown): number | null => {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isFinite(t) && t > 0 ? t : null;
};

// The recap writes its largest numbers as a Mantissa and an Exponent.
function yearFrom(raw: unknown): CareerYear | null {
    if (!isObj(raw) || typeof raw.Year !== 'number') return null;
    const year: Record<string, number> = {};
    for (const [key, v] of Object.entries(raw)) {
        if (typeof v === 'number') year[key] = v;
        else if (isObj(v) && typeof v.Mantissa === 'number' && typeof v.Exponent === 'number') year[key] = v.Mantissa * 10 ** v.Exponent;
    }
    return year as CareerYear;
}

function modulesFrom(raw: Record<string, unknown>): CareerModules {
    const n = (k: string) => (typeof raw[k] === 'number' ? raw[k] as number : 0);
    const list = (k: string) => (Array.isArray(raw[k]) ? raw[k] as unknown[] : []);
    const assist = list('AssistModuleSlots').map(s => (isObj(s) ? s.EquippedModule : null));
    const rerolls = [...list('ModuleInventory'), ...list('ModuleEquipped'), ...assist]
        .map(m => (isObj(m) && typeof m.RerollCounter === 'number' ? m.RerollCounter : 0));
    const total = (values: number[]) => values.reduce((sum, v) => sum + v, 0);
    // SlotCoinsSpent and SlotShardsSpent hold the four main slots only (level 213
    // cost 423,930 shards, an assist slot's level 211 cost 405,905 on the owner's).
    const assistSpent = (k: string) => total(list('AssistModuleSlots').map(s => (isObj(s) && typeof s[k] === 'number' ? s[k] as number : 0)));
    return {
        epicPity: n('ModulePity'),
        common: n('CommonModulesObtained'),
        rare: n('RareModulesObtained'),
        epic: n('EpicModulesObtained'),
        rerolls: total(rerolls),
        mostRerolled: rerolls.length ? Math.max(...rerolls) : 0,
        slotCoins: total(numbers(raw.SlotCoinsSpent)) + assistSpent('CoinsSpent'),
        slotShards: total(numbers(raw.SlotShardsSpent)) + assistSpent('ShardsSpent'),
        rerollShards: n('ModuleRerollCurrencyLifetime'),
    };
}

// Null for a file before the game kept these.
export function parseCareer(raw: Record<string, unknown>): Career | null {
    if (typeof raw.TotalCoinsEarned !== 'number') return null;
    const totals: Record<string, number> = {};
    for (const [key, v] of Object.entries(raw)) {
        if (key.startsWith('Total') && !key.endsWith('ThisRound') && typeof v === 'number') totals[key.slice(5)] = v;
    }
    const years = (Array.isArray(raw.WrappedStats) ? raw.WrappedStats : [])
        .map(yearFrom).filter((y): y is CareerYear => y !== null).sort((a, b) => a.Year - b.Year);
    const labs = (Array.isArray(raw.CompletedLabs) ? raw.CompletedLabs : []).flatMap((l): [number, number, number][] => {
        if (!isObj(l) || typeof l.labNumber !== 'number' || typeof l.level !== 'number') return [];
        const t = dateMs(l.dateCompleted);
        return t ? [[Math.round(t / 1000), l.labNumber, l.level]] : [];
    }).sort((a, b) => a[0] - b[0]);
    return {
        started: dateMs(raw.GameStartedDate),
        playSec: typeof raw.PlayTime === 'number' ? raw.PlayTime : 0,
        totals,
        years,
        tierCoins: numbers(raw.HighestCoinsEarnedThisTier),
        tierCells: numbers(raw.HighestCellsEarnedThisTier),
        labs,
        modules: modulesFrom(raw),
        researched: typeof raw.ResearchesComplete === 'number' ? raw.ResearchesComplete : undefined,
        cardsBought: typeof raw.CardsBoughtTotal === 'number' ? raw.CardsBoughtTotal : undefined,
    };
}

const COUNTERS = INCOME_CURRENCIES.flatMap(([, , , counter]) => (counter ? [counter as string] : []));

function cycleCounters(v: unknown): Record<string, number> | null {
    const all = isObj(v) && isObj(v.Currencies) ? v.Currencies : null;
    if (!all) return null;
    return Object.fromEntries(COUNTERS.map(c => [c, typeof all[c] === 'number' ? all[c] as number : 0]));
}

// Null for a file without the totals or without a date.
export function parseIncomePoint(raw: Record<string, unknown>): IncomePoint | null {
    const t = dateMs(raw.ExportedAt);
    if (!t || typeof raw.TotalCoinsEarned !== 'number') return null;
    const earned: IncomePoint['earned'] = {};
    for (const [key, , field] of INCOME_CURRENCIES) earned[key] = typeof raw[field] === 'number' ? raw[field] as number : 0;
    const [got, spent] = [cycleCounters(raw.CurrencyEarnedThisCycle), cycleCounters(raw.CurrencySpentThisCycle)];
    return got && spent ? { t, earned, cycle: { earned: got, spent } } : { t, earned };
}

// Adds an export to the log. The same file twice, or an older one, adds
// nothing. A total only ever grows, so one that fell means another account or
// a fresh start: its log starts over. A newer file replaces the newest one while
// that's still within the gap of the one before it.
export function addIncomePoint(log: IncomePoint[], p: IncomePoint): IncomePoint[] {
    const last = log[log.length - 1];
    if (!last) return [p];
    if (p.t <= last.t) return log;
    if (INCOME_CURRENCIES.some(([key]) => (p.earned[key] ?? 0) < (last.earned[key] ?? 0))) return [p];
    const before = log[log.length - 2];
    if (before && p.t - before.t < MIN_POINT_GAP_MS) return [...log.slice(0, -1), p];
    return [...log, p].slice(-MAX_INCOME_POINTS);
}

export interface IncomeRow {
    key: IncomeKey;
    label: string;
    total: number;
    sinceLast: number | null;
    perDay: number | null;
    spentPerDay: number | null;  // null where it isn't known (coins and cells, or no cycle counters)
}
export interface IncomeSummary {
    rows: IncomeRow[];
    lastAt: number;             // the newest export's date
    sinceLastDays: number | null;
    windowDays: number | null;  // the span "per day" is measured over
    spentFromRestart: boolean;  // spending only counted from a restart of the game's counters
}

// The cycle counters only ever grow until they restart, all together.
const restarted = (a: NonNullable<IncomePoint['cycle']>, b: NonNullable<IncomePoint['cycle']>) =>
    COUNTERS.some(c => (b.earned[c] ?? 0) < (a.earned[c] ?? 0) || (b.spent[c] ?? 0) < (a.spent[c] ?? 0));

// Earned between two exports: the cycle counters where they can say, else the
// change in the lifetime total. Across a restart they only hold what came after
// it, so the larger of that and the total's change.
function earnedBetween(a: IncomePoint, b: IncomePoint, key: IncomeKey, counter: string | null): number {
    const total = (b.earned[key] ?? 0) - (a.earned[key] ?? 0);
    if (!counter || !a.cycle || !b.cycle) return total;
    const after = b.cycle.earned[counter] ?? 0;
    return restarted(a.cycle, b.cycle) ? Math.max(total, after) : after - (a.cycle.earned[counter] ?? 0);
}

// What was earned since the import before, and earned and spent per day over
// the last 30 days of imports. Under an hour between exports says too little
// for a daily rate.
export function incomeSummary(log: IncomePoint[]): IncomeSummary | null {
    const last = log[log.length - 1];
    if (!last) return null;
    // "Since the last import" reaches back at least an hour where it can: the
    // newest two can be minutes apart with Auto import on.
    const older = log.slice(0, -1).reverse();
    const prev = older.find(p => last.t - p.t >= MS_PER_HOUR) ?? older[0] ?? null;
    const firstAt = log.findIndex(p => last.t - p.t <= INCOME_WINDOW_DAYS * MS_PER_DAY);
    const inWindow = log.slice(Math.max(0, firstAt));
    const spans = inWindow.slice(1).map((b, i) => ({ a: inWindow[i], b, days: (b.t - inWindow[i].t) / MS_PER_DAY }));
    const days = spans.reduce((sum, s) => sum + s.days, 0);
    const windowDays = days >= 1 / 24 ? days : null;
    // Spending: the spans inside one cycle. With none, what's been spent since
    // the restart is all that's known.
    const counted = spans.filter(s => s.a.cycle && s.b.cycle);
    const whole = counted.filter(s => !restarted(s.a.cycle!, s.b.cycle!));
    const spentFromRestart = !!windowDays && !whole.length && counted.length > 0;
    const spentPerDay = (counter: string | null): number | null => {
        if (!windowDays || !counter || !counted.length) return null;
        const from = whole.length ? whole : counted;
        const total = from.reduce((sum, s) => sum + (s.b.cycle!.spent[counter] ?? 0) - (whole.length ? s.a.cycle!.spent[counter] ?? 0 : 0), 0);
        const over = from.reduce((sum, s) => sum + s.days, 0);
        return over > 0 ? total / over : null;
    };
    return {
        lastAt: last.t,
        sinceLastDays: prev ? (last.t - prev.t) / MS_PER_DAY : null,
        windowDays,
        spentFromRestart,
        rows: INCOME_CURRENCIES.map(([key, label, , counter]) => ({
            key,
            label,
            total: last.earned[key] ?? 0,
            sinceLast: prev ? earnedBetween(prev, last, key, counter) : null,
            perDay: windowDays ? spans.reduce((sum, s) => sum + earnedBetween(s.a, s.b, key, counter), 0) / windowDays : null,
            spentPerDay: spentPerDay(counter),
        })),
    };
}

// Levels finished each month, oldest first.
export function labsByMonth(labs: Career['labs']): [string, number][] {
    const months = new Map<string, number>();
    for (const [sec] of labs) {
        const month = new Date(sec * 1000).toISOString().slice(0, 7);
        months.set(month, (months.get(month) ?? 0) + 1);
    }
    return [...months].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const RECORDS: [string, string][] = [
    ['HighestCPM', 'Best coins a minute'],
    ['MostCoinsFromWaveSkip', 'Most coins from a Wave Skip'],
    ['MostCellsFromWaveSkip', 'Most cells from a Wave Skip'],
    ['MostCoinsFromGoldenCombo', 'Most coins from a Golden Combo'],
    ['LargestWaveSkip', 'Largest Wave Skip'],
    ['LargestGoldenCombo', 'Largest Golden Combo'],
    ['LargestSmartMissileStack', 'Largest Smart Missile stack'],
    ['LargestILMCharge', 'Largest Inner Land Mine charge'],
];

export interface RunRecord {
    label: string;
    value: number;
    run: BattleReport;
}

// The best of each record among the saved runs, and the run that set it.
export function runRecords(runs: BattleReport[]): RunRecord[] {
    return RECORDS.flatMap(([field, label]) => {
        let best: RunRecord | null = null;
        for (const run of runs) {
            const v = run.raw?.[field];
            if (typeof v === 'number' && v > 0 && (!best || v > best.value)) best = { label, value: v, run };
        }
        return best ? [best] : [];
    });
}
