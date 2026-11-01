// ============================================================
//  TowerForge Companion — Career
//  The game's lifetime totals, its yearly recap, best coins and cells per
//  tier, research history, and what a player earns between two imports.
//
//  The totals aren't a ledger: on the owner's export only Keys come out at
//  what's held (earned − spent), and medals spent passes medals earned. So
//  income is only ever the change in Total…Earned from one export to the next,
//  timed by each export's own date (ExportedAt).
//  Pure functions — no store imports.
// ============================================================

import type { BattleReport } from './battleReport';

export const INCOME_CURRENCIES = [
    ['coins', 'Coins', 'TotalCoinsEarned'],
    ['gems', 'Gems', 'TotalGemsEarned'],
    ['stones', 'Stones', 'TotalStonesEarned'],
    ['medals', 'Medals', 'TotalMedalsEarned'],
    ['cells', 'Cells', 'TotalCellsEarned_v2'],
    ['keys', 'Keys', 'TotalKeysEarned'],
    ['tokens', 'Tokens', 'TotalTokensEarned'],
    ['bits', 'Bits', 'TotalBitsEarned'],
] as const;

export type IncomeKey = typeof INCOME_CURRENCIES[number][0];

// The game's lifetime earned totals at one export.
export interface IncomePoint {
    t: number;       // the export's date, in ms
    earned: Record<IncomeKey, number>;
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
}

const MAX_INCOME_POINTS = 200;
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
    };
}

// Null for a file without the totals or without a date.
export function parseIncomePoint(raw: Record<string, unknown>): IncomePoint | null {
    const t = dateMs(raw.ExportedAt);
    if (!t || typeof raw.TotalCoinsEarned !== 'number') return null;
    const earned = {} as Record<IncomeKey, number>;
    for (const [key, , field] of INCOME_CURRENCIES) earned[key] = typeof raw[field] === 'number' ? raw[field] as number : 0;
    return { t, earned };
}

// Adds an export to the log. The same file twice, or an older one, adds
// nothing. A total only ever grows, so one that fell means another account or
// a fresh start: its log starts over.
export function addIncomePoint(log: IncomePoint[], p: IncomePoint): IncomePoint[] {
    const last = log[log.length - 1];
    if (!last) return [p];
    if (p.t <= last.t) return log;
    if (INCOME_CURRENCIES.some(([key]) => p.earned[key] < last.earned[key])) return [p];
    return [...log, p].slice(-MAX_INCOME_POINTS);
}

export interface IncomeRow {
    key: IncomeKey;
    label: string;
    total: number;
    sinceLast: number | null;
    perDay: number | null;
}
export interface IncomeSummary {
    rows: IncomeRow[];
    lastAt: number;             // the newest export's date
    sinceLastDays: number | null;
    windowDays: number | null;  // the span "per day" is measured over
}

// What was earned since the import before, and per day over the last 30 days
// of imports. Under an hour between exports says too little for a daily rate.
export function incomeSummary(log: IncomePoint[]): IncomeSummary | null {
    const last = log[log.length - 1];
    if (!last) return null;
    const prev = log.length > 1 ? log[log.length - 2] : null;
    const first = log.find(p => last.t - p.t <= INCOME_WINDOW_DAYS * MS_PER_DAY) ?? last;
    const days = (last.t - first.t) / MS_PER_DAY;
    const windowDays = days >= 1 / 24 ? days : null;
    return {
        lastAt: last.t,
        sinceLastDays: prev ? (last.t - prev.t) / MS_PER_DAY : null,
        windowDays,
        rows: INCOME_CURRENCIES.map(([key, label]) => ({
            key,
            label,
            total: last.earned[key],
            sinceLast: prev ? last.earned[key] - prev.earned[key] : null,
            perDay: windowDays ? (last.earned[key] - first.earned[key]) / windowDays : null,
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
