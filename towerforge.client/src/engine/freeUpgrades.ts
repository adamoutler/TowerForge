// ============================================================
//  TowerForge Companion — Free upgrades
//  A workshop level is only where a run starts. Every wave rolls a free
//  upgrade for attack, defense and utility, and a roll never picks a maxed
//  stat, so a long run takes every stat with room to its max whatever the
//  workshop says. The models read a run's stats, so they read these levels: a
//  workshop level the run would reach anyway only counts for the waves before
//  it gets there.
//
//  Checked on the owner's runs (2026-11-01, game-export-format.md): long T18
//  runs read 299 / 0 / 267 free upgrades, exactly what that workshop has room
//  for, and long T20 and T21 runs read 598 / 1800 / 1227, exactly what the
//  tournament workshop has room for. In a run in progress, UpgradeLevel is the
//  workshop's level plus the free upgrades.
//  Black Hole Digestor keeps free upgrades off Range while it's equipped, a
//  perk the module's text doesn't mention (the owner, 2026-11-01): Range stayed
//  at 0 with 79 levels of room on those T18 runs, played with it. Read here as
//  any active Digestor; as an assist that's the code's assumption.
//  The code's assumptions: each roll picks evenly among the stats with room,
//  and rolls come at a steady pace through the run. Cash upgrades bought during
//  a run aren't counted (the site assumes AFK runs), nor are the extra levels
//  past the max from the Infinity Threshold module.
//  Pure functions — no store imports.
// ============================================================

import { WS_STATS } from '../constants/gameData';
import type { WSPreset, WsUnlocked } from '../types/gameTypes';
import type { BattleReport } from './battleReport';
import { workshopOpen } from './unlocks';
import type { WsSection } from './unlocks';

const SECTIONS: WsSection[] = ['attack', 'defense', 'utility'];
const RUN_FIELD: Record<WsSection, string> = {
    attack: 'FreeAttackUpgrades', defense: 'FreeDefenseUpgrades', utility: 'FreeUtilityUpgrades',
};
const CHANCE_STAT: Record<WsSection, string> = {
    attack: 'Free Atk Upgrade', defense: 'Free Def Upgrade', utility: 'Free Util Upgrade',
};
const CHANCE_PER_LEVEL = 0.005;   // 0.5% a level, before card, perk and enhancement
const MIN_WAVES = 50;             // shorter runs say little about the pace
const RANGE = 'Range';
const KEEPS_RANGE = 'Black Hole Digestor';
// Enemy levels are skipped wave by wave, so a run's skip follows the level
// across the whole run, not the level it ends on.
const WAVE_BY_WAVE = new Set(['Enemy Atk Level Skip', 'Enemy HP Level Skip']);

export interface FreeUpgradeRun {
    wave: number;                         // where the run ended
    perWave: Record<WsSection, number>;   // free upgrades a wave, were there always room
}

const countOf = (run: BattleReport, section: WsSection): number | null => {
    const v = run.raw?.[RUN_FIELD[section]];
    return typeof v === 'number' ? v : null;
};

// The chosen run's free upgrades, or null when the run doesn't record them.
// A long run's count stops at what its workshop had room for, so the pace comes
// from the best seen on the tier's runs, and never under what the workshop's
// chance alone gives.
export function freeUpgradeRun(run: BattleReport | null, runs: BattleReport[], ws: WSPreset | undefined): FreeUpgradeRun | null {
    if (!run || !(run.wave > 0)) return null;
    const alike = runs.filter(r => r.tier === run.tier && !!r.tournament === !!run.tournament && r.wave >= MIN_WAVES);
    const perWave = {} as Record<WsSection, number>;
    for (const section of SECTIONS) {
        const own = countOf(run, section);
        if (own === null) return null;
        const chanceIdx = WS_STATS.utility.findIndex(([n]) => n === CHANCE_STAT[section]);
        perWave[section] = Math.max(
            own / run.wave,
            CHANCE_PER_LEVEL * (ws?.utility[chanceIdx] ?? 0),
            ...alike.map(r => (countOf(r, section) ?? 0) / r.wave),
        );
    }
    return { wave: run.wave, perWave };
}

export interface StatInRun {
    section: WsSection;
    idx: number;
    stat: string;
    start: number;              // the workshop's level
    end: number;                // where the run leaves it
    filledAt: number | null;    // the wave it reaches its max; null if it doesn't
}

export interface RunLevelsInput {
    free?: FreeUpgradeRun;
    wsData?: WSPreset[];
    presetIdx?: number;
    wsUnlocked?: WsUnlocked;
    modBonuses?: { uniques?: Record<string, number> };
}

const rangeKept = (snap: RunLevelsInput) => snap.modBonuses?.uniques?.[KEEPS_RANGE] != null;

// Each stat with room: rolls go evenly among the stats that still have room, so
// the ones with least room fill first.
export function statsInRun(snap: RunLevelsInput): StatInRun[] {
    const { free } = snap;
    const ws = snap.wsData?.[snap.presetIdx ?? 0];
    if (!free || !ws) return [];
    const kept = rangeKept(snap);
    return SECTIONS.flatMap(section => {
        const open = (WS_STATS[section] ?? []).flatMap(([stat, max], idx) => {
            const start = ws[section]?.[idx] ?? 0;
            return start < max && !(kept && stat === RANGE) && workshopOpen(section, stat, start, snap.wsUnlocked)
                ? [{ stat, idx, start, room: max - start }] : [];
        });
        const rooms = open.map(s => s.room).sort((a, b) => a - b);
        let left = Math.round(free.perWave[section] * free.wave);
        let each = 0;   // levels every stat with room has got when the run ends
        for (let i = 0; i < rooms.length && left > 0; i++) {
            const stats = rooms.length - i;
            const need = (rooms[i] - each) * stats;
            each = left >= need ? rooms[i] : each + left / stats;
            left = Math.max(0, left - need);
        }
        const rollsUntil = (room: number) => open.reduce((sum, s) => sum + Math.min(s.room, room), 0);
        return open.map(({ stat, idx, start, room }) => ({
            section, idx, stat, start,
            end: Math.floor(start + Math.min(room, each)),
            filledAt: room <= each ? rollsUntil(room) / free.perWave[section] : null,
        }));
    });
}

// The snapshot with the levels a run reaches. Once applied `free` is gone, so
// applying it again changes nothing.
export function inRunLevels<T extends RunLevelsInput>(snap: T): T {
    const { free, wsData, presetIdx } = snap;
    if (!free || !wsData || presetIdx === undefined) return snap;
    const ws = wsData[presetIdx];
    if (!ws) return { ...snap, free: undefined };
    const levels: WSPreset = { ...ws, attack: [...ws.attack], defense: [...ws.defense], utility: [...ws.utility] };
    for (const s of statsInRun(snap)) {
        const share = (s.filledAt ?? free.wave) / free.wave;
        levels[s.section][s.idx] = WAVE_BY_WAVE.has(s.stat) ? s.end - (s.end - s.start) * share / 2 : s.end;
    }
    const next = [...wsData];
    next[presetIdx] = levels;
    return { ...snap, wsData: next, free: undefined };
}

export interface FilledInRun {
    stats: string[];      // the stats a run takes to their max
    byWave: number;       // about when the last of them gets there
    rangeKept: boolean;   // Black Hole Digestor is keeping Range below its max
    stillFilling: boolean;   // some stat isn't full when the run ends
}

// For the Optimizer's note.
export function filledInRun(snap: RunLevelsInput): FilledInRun | null {
    const ws = snap.wsData?.[snap.presetIdx ?? 0];
    if (!snap.free || !ws) return null;
    const stats = statsInRun(snap);
    const filled = stats.filter(s => s.filledAt !== null);
    const rangeIdx = WS_STATS.attack.findIndex(([n]) => n === RANGE);
    const kept = rangeKept(snap) && (ws.attack[rangeIdx] ?? 0) < WS_STATS.attack[rangeIdx][1];
    if (!filled.length && !kept) return null;
    return { stats: filled.map(s => s.stat), byWave: Math.max(0, ...filled.map(s => s.filledAt!)), rangeKept: kept, stillFilling: stats.some(s => s.filledAt === null) };
}

// "about W220": the pace is an average, so round up to a clean wave.
export const aboutWave = (wave: number) => `W${(Math.ceil(wave / 10) * 10).toLocaleString()}`;

// A line on a stat the run takes to its max.
export const freeFillText = (stat: string, wave: number) =>
    `Free upgrades take ${stat} to its max by about ${aboutWave(wave)} in your chosen run, so workshop levels only help before that.`;

// The same for every such stat, for the top of the workshop panel.
export function freeFillNote(filled: FilledInRun | null): string | undefined {
    if (!filled) return undefined;
    const SHOWN = 6;
    const names = filled.stats.slice(0, SHOWN).join(', ');
    const more = filled.stats.length - SHOWN;
    const fills = filled.stats.length
        ? `Free upgrades take ${names}${more > 0 ? ` and ${more} more` : ''} to their max by about ${aboutWave(filled.byWave)} in your chosen run, so workshop levels on these only help before that${filled.stillFilling ? ', and by leaving one more free upgrade for the stats that aren’t full by the end' : ''}.`
        : '';
    const range = filled.rangeKept ? 'Black Hole Digestor keeps free upgrades off Range, so Range stays at its workshop level.' : '';
    return [fills, range].filter(Boolean).join(' ');
}
