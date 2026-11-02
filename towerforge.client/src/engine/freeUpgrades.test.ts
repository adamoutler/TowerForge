// Free upgrades take workshop stats to their max during a run. Anchors from the
// owner's runs (2026-11-01): the counts each workshop has room for, and how a
// run's in-run levels differ from the workshop's.

import { describe, expect, it } from 'vitest';
import { filledInRun, freeFillNote, freeUpgradeRun, inRunLevels, statsInRun } from './freeUpgrades';
import type { FreeUpgradeRun } from './freeUpgrades';
import { buildCandidates, skipChanceOf } from './optimizer';
import type { OptimizerSnapshot } from './optimizer';
import { useGameStore } from '../store/useGameStore';
import { healthSkipChance, skipSources } from './levelSkip';
import type { BattleReport } from './battleReport';
import type { WSPreset } from '../types/gameTypes';
import { readActiveModuleBonuses } from './modBonuses';
import { WS_ENH, WS_STATS } from '../constants/gameData';

// The owner's two workshops, by level.
const FARM: WSPreset = {
    attack: [6000, 99, 79, 150, 0, 200, 99, 7, 85, 99, 85, 7, 60, 100, 120, 299, 0],
    defense: [6000, 6000, 99, 5000, 99, 80, 80, 40, 38, 4, 35, 40, 50, 200, 50, 75, 1800, 300],
    utility: [149, 149, 149, 149, 99, 99, 99, 99, 300, 500, 60, 530, 601],
};
const TOURNAMENT: WSPreset = {
    attack: [6000, 99, 79, 150, 79, 200, 99, 7, 85, 99, 85, 7, 60, 100, 120, 0, 0],
    defense: [6000, 6000, 99, 5000, 99, 80, 80, 40, 38, 4, 35, 40, 50, 200, 50, 75, 0, 300],
    utility: [149, 149, 0, 149, 99, 99, 99, 99, 0, 0, 60, 560, 560],
};

const run = (tier: number, wave: number, attack: number, defense: number, utility: number, tournament = false) => ({
    tier, wave, tournament,
    raw: { FreeAttackUpgrades: attack, FreeDefenseUpgrades: defense, FreeUtilityUpgrades: utility },
}) as unknown as BattleReport;

const levelOf = (ws: WSPreset, section: keyof WSPreset, stat: string) =>
    ws[section][WS_STATS[section].findIndex(([n]) => n === stat)];

// A run's account: the farm workshop's runs were played with Black Hole Digestor.
const input = (ws: WSPreset, free: FreeUpgradeRun | null, digestor = false) => ({
    wsData: [ws], presetIdx: 0, free: free!,
    modBonuses: { uniques: (digestor ? { 'Black Hole Digestor': 10 } : {}) as Record<string, number> },
});

// Levels a run adds, by section.
const gained = (ws: WSPreset, r: BattleReport, digestor = false) => {
    const stats = statsInRun(input(ws, freeUpgradeRun(r, [], ws), digestor));
    const of = (section: string) => stats.filter(s => s.section === section).reduce((sum, s) => sum + s.end - s.start, 0);
    return [of('attack'), of('defense'), of('utility')];
};

describe('free upgrades in a run', () => {
    it('fill exactly what the workshop has room for on a long run', () => {
        // The counts on the owner's long runs of each workshop.
        expect(gained(FARM, run(18, 9302, 299, 0, 267), true)).toEqual([299, 0, 267]);
        expect(gained(TOURNAMENT, run(20, 4537, 598, 1800, 1227))).toEqual([598, 1800, 1227]);
        expect(gained(TOURNAMENT, run(21, 3328, 598, 1800, 1227))).toEqual([598, 1800, 1227]);
    });

    it('stay off Range while Black Hole Digestor is equipped', () => {
        // Range stayed at 0 with 79 levels of room on the owner's T18 runs, with
        // the module on (the owner, 2026-11-01).
        const free = freeUpgradeRun(run(18, 9302, 299, 0, 267), [], FARM);
        const kept = inRunLevels(input(FARM, free, true));
        expect(levelOf(kept.wsData[0], 'attack', 'Range')).toBe(0);
        expect(levelOf(kept.wsData[0], 'attack', 'Rend Armor Mult')).toBe(299);
    });

    it('fill Range like any other stat without it', () => {
        const free = freeUpgradeRun(run(18, 9302, 299, 0, 267), [], FARM);
        const filled = inRunLevels(input(FARM, free));
        expect(levelOf(filled.wsData[0], 'attack', 'Range')).toBe(79);
        expect(gained(FARM, run(18, 9302, 299, 0, 267))[0]).toBe(299 + 79);
    });

    it('stop where the run does, shared evenly among the stats with room', () => {
        // T21 W2161: Wall Health's 1800 levels of room were at 1584.
        const stop = statsInRun(input(TOURNAMENT, freeUpgradeRun(run(21, 2161, 598, 1584, 1227), [], TOURNAMENT)));
        expect(stop.find(s => s.stat === 'Wall Health')).toMatchObject({ end: 1584, filledAt: null });
        // T23 W275 tournament: 204 attack upgrades over Rend Chance and Mult,
        // 220 utility over five stats.
        const t23 = statsInRun(input(TOURNAMENT, freeUpgradeRun(run(23, 275, 204, 185, 220, true), [], TOURNAMENT)));
        expect(t23.find(s => s.stat === 'Rend Armor Chance')?.end).toBe(102);
        expect(t23.find(s => s.stat === 'Rend Armor Mult')?.end).toBe(102);
        expect(t23.find(s => s.stat === 'Enemy HP Level Skip')?.end).toBe(604);
        expect(t23.find(s => s.stat === 'Max Amount')?.end).toBe(44);
    });

    it('take the pace from the tier’s runs that still had room', () => {
        // T18 W170 read 208 utility upgrades: a long run's count says nothing,
        // since it stops at the room. HP skip (98 levels) fills first.
        const free = freeUpgradeRun(run(18, 9302, 299, 0, 267), [run(18, 170, 217, 0, 208), run(18, 340, 448, 0, 267)], FARM)!;
        expect(free.perWave.utility).toBeCloseTo(208 / 170, 5);
        const stats = statsInRun(input(FARM, free, true));
        expect(stats.find(s => s.stat === 'Enemy HP Level Skip')!.filledAt).toBeCloseTo(160, 0);
        expect(stats.find(s => s.stat === 'Enemy Atk Level Skip')!.filledAt).toBeCloseTo(218, 0);
    });

    it('never pace slower than the workshop’s own chance', () => {
        // Only long runs saved: 0.5% × level 99 of Free Util Upgrade.
        expect(freeUpgradeRun(run(18, 9302, 299, 0, 267), [], FARM)!.perWave.utility).toBeCloseTo(0.495, 5);
        // A tournament run isn't the pace of a campaign one, nor another tier's.
        const free = freeUpgradeRun(run(18, 9302, 299, 0, 267), [run(23, 100, 200, 200, 200, true), run(20, 100, 200, 200, 200)], FARM)!;
        expect(free.perWave.utility).toBeCloseTo(0.495, 5);
    });

    it('needs a run that records them', () => {
        expect(freeUpgradeRun(null, [], FARM)).toBeNull();
        expect(freeUpgradeRun({ tier: 18, wave: 100, raw: {} } as unknown as BattleReport, [], FARM)).toBeNull();
    });

    it('don’t reach a stat in a group not bought yet', () => {
        const fresh: WSPreset = { attack: Array(17).fill(0), defense: Array(18).fill(0), utility: Array(13).fill(0) };
        const free = freeUpgradeRun(run(1, 100, 50, 50, 50), [], fresh)!;
        const stats = statsInRun({ ...input(fresh, free), wsUnlocked: { attack: 0, defense: 0, utility: 0 } });
        expect(stats.some(s => s.stat === 'Rend Armor Mult')).toBe(false);
        expect(stats.find(s => s.stat === 'Damage')!.end).toBeGreaterThan(0);
    });

    it('apply once', () => {
        const once = inRunLevels(input(TOURNAMENT, freeUpgradeRun(run(23, 275, 204, 185, 220, true), [], TOURNAMENT)));
        expect(inRunLevels(once)).toBe(once);
        expect(once.free).toBeUndefined();
        expect(TOURNAMENT.attack[15]).toBe(0);   // the workshop itself isn't touched
    });

    it('say which stats they fill', () => {
        const free = freeUpgradeRun(run(18, 9302, 299, 0, 267), [run(18, 170, 217, 0, 208)], FARM)!;
        const filled = filledInRun(input(FARM, free, true))!;
        expect(filled.stats).toEqual(['Rend Armor Mult', 'Enemy Atk Level Skip', 'Enemy HP Level Skip']);
        expect(freeFillNote(filled)).toContain('Enemy HP Level Skip');
        expect(freeFillNote(filled)).toContain('Black Hole Digestor keeps free upgrades off Range');
        expect(freeFillNote(null)).toBeUndefined();
        // Without the module Range is one of them, and there's nothing to say about it.
        const without = filledInRun(input(FARM, free))!;
        expect(without.stats[0]).toBe('Range');
        expect(freeFillNote(without)).not.toContain('Digestor');
        // The module on, Range already at its max: nothing to say either.
        expect(freeFillNote(filledInRun(input(TOURNAMENT, free, true)))).not.toContain('Digestor');
    });

    it('still mention Range when it’s all there is to say', () => {
        const maxed: WSPreset = {
            attack: WS_STATS.attack.map(([n, max]) => (n === 'Range' ? 0 : max)),
            defense: WS_STATS.defense.map(([, max]) => max),
            utility: WS_STATS.utility.map(([, max]) => max),
        };
        const note = freeFillNote(filledInRun(input(maxed, freeUpgradeRun(run(18, 9302, 0, 0, 0), [], maxed), true)));
        expect(note).toBe('Black Hole Digestor keeps free upgrades off Range, so Range stays at its workshop level.');
    });
});

describe('Enemy Level Skip with free upgrades', () => {
    // The owner's skip sources (T18 W9302): lab 20, enhancement 47, 11.12% from
    // relics and substats, and 70.74% with the workshop at its max.
    const ENH_IDX = WS_ENH.utility.findIndex(([n]) => n === 'Enemy Level Skips');
    const snap = (ws: WSPreset, wave = 9302): OptimizerSnapshot => {
        const st = useGameStore.getState();
        const labData = { 'Enemy HP Lvl Skip Lab': 20, 'Enemy Atk Lvl Skip Lab': 20 };
        const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
        return {
            presetIdx: 0, wsData: [copy(ws)], labData,
            enhData: {
                d: { utility: WS_ENH.utility.map((_, i) => (i === ENH_IDX ? 47 : 0)) },
                u: { utility: WS_ENH.utility.map((_, i) => i === ENH_IDX) },
            },
            cardData: copy(st.cardData), perkData: copy(st.perkData), uwData: copy(st.uwData),
            relicData: { rEHPSkip: 11.12, rEAtkSkip: 11.12 },
            modBonuses: readActiveModuleBonuses(st.moduleState, st.perkData, labData, st.cardData),
            moduleState: copy(st.moduleState), botData: {},
            free: freeUpgradeRun(run(18, wave, 299, 0, 267), [run(18, 170, 217, 0, 208)], ws)!,
        } as unknown as OptimizerSnapshot;
    };

    it('reads about the max, not the workshop’s level', () => {
        const s = snap(FARM);
        const atMax = healthSkipChance({ ...skipSources('health', FARM, s.labData, s.enhData, s.relicData, {}), workshop: 699 });
        expect(atMax).toBeCloseTo(70.74, 2);
        // Health and attack read almost the same though their workshop levels
        // are 71 apart, as on the owner's T18 runs (60.65% and 60.56%).
        expect(skipChanceOf(s)).toBeCloseTo(atMax, 0);
        expect(skipChanceOf(s) - skipChanceOf(s, 'attack')).toBeGreaterThan(0);
        expect(skipChanceOf(s) - skipChanceOf(s, 'attack')).toBeLessThan(0.2);
    });

    it('makes ten workshop levels worth a sliver of what they would be', () => {
        const after = (ws: WSPreset) => ({ ...ws, utility: ws.utility.map((v, i) => (i === 12 ? v + 10 : v)) });
        const s = snap(FARM);
        const withFree = skipChanceOf(snap(after(FARM))) - skipChanceOf(s);
        const noFree = skipChanceOf({ ...snap(after(FARM)), free: undefined }) - skipChanceOf({ ...s, free: undefined });
        expect(noFree).toBeCloseTo(0.735, 3);
        expect(withFree).toBeGreaterThan(0);
        expect(withFree).toBeLessThan(0.03);
    });

    it('marks the Optimizer’s workshop row', () => {
        const s = snap(FARM);
        const rows = buildCandidates(s, 'workshop');
        expect(rows.find(r => r.label.includes('Enemy HP Level Skip'))?.freeFillsAt).toBeCloseTo(160, 0);
        expect(rows.find(r => r.label.includes('Range'))?.freeFillsAt).toBeGreaterThan(0);
        const digestor = { ...s, modBonuses: { ...s.modBonuses, uniques: { ...s.modBonuses.uniques, 'Black Hole Digestor': 10 } } };
        expect(buildCandidates(digestor, 'workshop').find(r => r.label.includes('Range'))?.freeFillsAt).toBeUndefined();
    });
});
