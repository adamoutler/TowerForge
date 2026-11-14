// ============================================================
//  TowerForge Companion — Compare with a friend
//  A share link opened by someone with their own account in the
//  browser: who's ahead, section by section (owner, 2026-11-14). Both
//  sides are read the same way, from a share's shape (engine/shareApi
//  SharePayload) — the viewer's own data is put in that shape in their
//  browser and never sent. Only sections both sides have are compared;
//  every row is "more is better". Waves are compared on one tier both
//  have played (the highest), since each tier's waves differ.
//  Pure functions — no store imports.
// ============================================================

import type { SharePayload } from './shareApi';
import { LABS, UWS, WS_STATS } from '../constants/gameData';
import { BOTS_CONFIG, isBotEntryOwned, isBotPlusOwned } from '../constants/botData';
import { LEAGUE_ORDER } from './tourneyHistory';
import type { League, WSPreset } from '../types/gameTypes';

export interface CompareRow {
    label: string;
    them: number;
    me: number;
    themText: string;
    meText: string;
}

export interface Comparison {
    rows: CompareRow[];
    meAhead: number;
    themAhead: number;
}

const n = (v: number) => v.toLocaleString('en-US');
const row = (label: string, them: number, me: number, text: (v: number) => string = n): CompareRow =>
    ({ label, them, me, themText: text(them), meText: text(me) });

const leagueText = (i: number) => (i >= 0 ? LEAGUE_ORDER[i] : '—');
const leagueIndex = (l: string | undefined) => (l ? LEAGUE_ORDER.indexOf(l as League) : -1);

function profileRows(a: NonNullable<SharePayload['profile']>, b: NonNullable<SharePayload['profile']>): CompareRow[] {
    const out = [row('Highest tier', a.highestTier ?? 0, b.highestTier ?? 0, v => (v ? `T${v}` : '—'))];
    const both = Object.keys(a.tierWaves ?? {}).map(Number)
        .filter(t => (a.tierWaves[t] ?? 0) > 0 && (b.tierWaves?.[t] ?? 0) > 0)
        .sort((x, y) => y - x)[0];
    if (both) out.push(row(`Best wave on Tier ${both}`, a.tierWaves[both], b.tierWaves[both]));
    const la = leagueIndex(a.league), lb = leagueIndex(b.league);
    if (la >= 0 || lb >= 0) out.push(row('Highest league', la, lb, leagueText));
    return out;
}

const LAB_LIST = LABS.flatMap(g => g.l);

function wsLevels(p: WSPreset | undefined): { levels: number; maxed: number } {
    let levels = 0, maxed = 0;
    for (const [cat, stats] of Object.entries(WS_STATS)) {
        stats.forEach(([, max], i) => {
            const lv = p?.[cat as keyof WSPreset]?.[i] ?? 0;
            levels += lv;
            if (lv >= max) maxed++;
        });
    }
    return { levels, maxed };
}

// Each side's numbers for one section, or null when it isn't shared.
function counts(p: SharePayload) {
    const uws = p.uw ? UWS.map(u => p.uw!.data[u.a]) : null;
    const cards = p.cards ? Object.values(p.cards.data ?? {}) : null;
    const bots = p.bots ? BOTS_CONFIG.map(b => p.bots!.current[b.name]) : null;
    const ws = p.workshop ? wsLevels(p.workshop.presets?.[0]) : null;
    const vault = p.vault ? Object.entries(p.vault.levels ?? {}).filter(([k]) => !k.startsWith('g')).map(([, v]) => v) : null;
    return {
        labLevels: p.labs ? LAB_LIST.reduce((s, [name]) => s + (p.labs!.levels[name] ?? 0), 0) : null,
        labsMaxed: p.labs ? LAB_LIST.filter(([name, max]) => (p.labs!.levels[name] ?? 0) >= max).length : null,
        wsLevels: ws?.levels ?? null,
        wsMaxed: ws?.maxed ?? null,
        uwOwned: uws ? uws.filter(u => u?.own).length : null,
        uwPlus: uws ? uws.filter(u => u?.upOwn).length : null,
        uwLevels: uws ? uws.reduce((s, u) => s + (u?.own ? u.sv.reduce((x, y) => x + y, 0) : 0), 0) : null,
        cards7: cards ? cards.filter(c => (c?.s ?? 0) >= 7).length : null,
        masteries: cards ? cards.filter(c => c?.mu).length : null,
        botsOwned: bots ? bots.filter(b => isBotEntryOwned(b)).length : null,
        botPlus: bots ? bots.filter(b => isBotPlusOwned(b)).length : null,
        ancestral: p.modules ? (p.modules.library ?? []).filter(m => m.rarity.startsWith('A')).length : null,
        vaultLevels: vault ? vault.reduce((s, v) => s + v, 0) : null,
    };
}

const SECTION_ROWS: [keyof ReturnType<typeof counts>, string][] = [
    ['labLevels', 'Lab levels'], ['labsMaxed', 'Labs maxed'],
    ['wsLevels', 'Workshop levels'], ['wsMaxed', 'Workshop stats maxed'],
    ['uwOwned', 'Ultimate Weapons'], ['uwPlus', 'UW+ unlocked'], ['uwLevels', 'UW upgrade levels'],
    ['cards7', 'Cards at 7★'], ['masteries', 'Card masteries'],
    ['botsOwned', 'Bots'], ['botPlus', 'Bot+ unlocked'],
    ['ancestral', 'Ancestral modules'],
    ['vaultLevels', 'Vault levels'],
];

export function compareAccounts(them: SharePayload, me: SharePayload): Comparison {
    const rows: CompareRow[] = them.profile && me.profile ? profileRows(them.profile, me.profile) : [];
    const a = counts(them), b = counts(me);
    for (const [key, label] of SECTION_ROWS) {
        const x = a[key], y = b[key];
        if (x !== null && y !== null && (x > 0 || y > 0)) rows.push(row(label, x, y));
    }
    return {
        rows,
        meAhead: rows.filter(r => r.me > r.them).length,
        themAhead: rows.filter(r => r.them > r.me).length,
    };
}
