// Part-done labs and each preset's modules, through the import and the real
// store (localStorage writes fail quietly outside a browser). Made-up exports;
// what was checked on a real one is in docs/game-export-format.md.

import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import { parseGameExport } from '../engine/gameExport';
import { labHours } from '../engine/labBoosts';
import { labLevelCost } from '../engine/upgradeCosts';
import { snapshotFromState } from '../engine/accountModels';
import { activeLoadout } from '../engine/statHelpers';
import { withTournamentBuild } from '../engine/tournamentModel';
import { buildCandidates } from '../engine/optimizer';
import { changeCost, upgradeTargets } from '../engine/whatIf';
import { gameModule, labIndex, makeExport, research, zeros } from '../test/makeExport';

const store = () => useGameStore.getState();
const DAMAGE = labIndex('Damage Lab');

function percent(values: Record<number, number>): number[] {
    const out = zeros(260);
    for (const [i, v] of Object.entries(values)) out[Number(i)] = v;
    return out;
}

describe('lab progress in the import', () => {
    it('reads the share done of the next level, and which labs are running', () => {
        const health = labIndex('Health Lab');
        const imp = parseGameExport(makeExport({
            ResearchLevel: research({ [DAMAGE]: 40, [health]: 60, [labIndex('Range Lab')]: 5 }),
            ResearchPercentComplete: percent({ [DAMAGE]: 0.25, [health]: 0.979 }),
            LabActiveBool: [true, true, false, false, false],
            LabResearchInt: [DAMAGE, labIndex('Range Lab'), health, 0, 0],
        }));
        expect(imp.labProgress).toEqual({
            'Damage Lab': { toLevel: 41, done: 0.25, running: true },
            // Stopped part way; the third slot's number is left over, its slot is off.
            'Health Lab': { toLevel: 61, done: 0.979 },
            // Just started: nothing done, but running.
            'Range Lab': { toLevel: 6, done: 0, running: true },
        });
    });

    it('is null for a file without it, and clears the last import\'s', () => {
        useGameStore.setState({ labProgress: { 'Damage Lab': { toLevel: 41, done: 0.5 } } });
        const imp = parseGameExport(makeExport({ ResearchLevel: research({}) }));
        expect(imp.labProgress).toBeNull();
        store().applyGameImport(imp);
        expect(store().labProgress).toEqual({});
    });

    // 132 and 134 had no single lab until the lab-number list placed them
    // (2026-11-05); 99 is a removed lab, not one on the site.
    it('reads progress on the labs the lab-number list placed, not on removed ones', () => {
        const imp = parseGameExport(makeExport({
            ResearchLevel: research({ 134: 3 }), ResearchPercentComplete: percent({ 132: 0.5, 134: 0.25, 99: 0.5 }),
        }));
        expect(imp.labProgress).toEqual({
            'Light Speed Shots': { toLevel: 1, done: 0.5 },
            'Common Drop Chance': { toLevel: 4, done: 0.25 },
        });
    });
});

describe('what a part-done lab costs', () => {
    const labs = { 'Damage Lab': 40 };
    const whole = labLevelCost('Damage Lab', 41, labs, {})!;

    it('charges the time left on that level only', () => {
        const progress = { 'Damage Lab': { toLevel: 41, done: 0.25 } };
        expect(labLevelCost('Damage Lab', 41, labs, {}, progress)!.hours).toBeCloseTo(whole.hours * 0.75, 9);
        expect(labLevelCost('Damage Lab', 42, labs, {}, progress)!.hours).toBeCloseTo(labLevelCost('Damage Lab', 42, labs, {})!.hours, 9);
    });

    // Stopping a lab refunds its coins and restarting buys it again (owner, 2026-10-31).
    it('keeps a stopped level\'s coins, and a running one\'s are paid', () => {
        expect(labLevelCost('Damage Lab', 41, labs, {}, { 'Damage Lab': { toLevel: 41, done: 0.25 } })!.coins).toBe(whole.coins);
        expect(labLevelCost('Damage Lab', 41, labs, {}, { 'Damage Lab': { toLevel: 41, done: 0.25, running: true } })!.coins).toBe(0);
    });

    it('stops counting once the lab\'s level has moved on', () => {
        const stale = { 'Damage Lab': { toLevel: 41, done: 0.9 } };
        const moved = { 'Damage Lab': 41 };
        expect(labHours('Damage Lab', moved, {}, stale)!.done).toBe(0);
        expect(labHours('Damage Lab', moved, {}, stale)!.next).toBeCloseTo(labHours('Damage Lab', moved, {})!.next!, 9);
    });

    it('counts it in the time to max', () => {
        const progress = { 'Damage Lab': { toLevel: 41, done: 0.5 } };
        const before = labHours('Damage Lab', labs, {})!;
        const after = labHours('Damage Lab', labs, {}, progress)!;
        expect(after.done).toBe(0.5);
        expect(after.next).toBeCloseTo(before.next! / 2, 9);
        expect(after.toMax).toBeCloseTo(before.toMax! - before.next! / 2, 6);
    });
});

describe('part-done labs in the Optimizer and What If', () => {
    const account = (labProgress: Record<string, { toLevel: number; done: number; running?: boolean }>) => {
        useGameStore.setState({ labData: { 'Damage Lab': 40, 'Labs Speed': 10 }, labProgress });
        return snapshotFromState(store());
    };
    const damageLab = (labProgress: Parameters<typeof account>[0]) =>
        buildCandidates(account(labProgress), 'labs').find(c => c.label === 'Damage Lab')!;

    beforeEach(() => store().resetAll());

    it('ranks a part-done lab by the time it has left', () => {
        const whole = damageLab({});
        const part = damageLab({ 'Damage Lab': { toLevel: 41, done: 0.75 } });
        expect(part.hours).toBeCloseTo(whole.hours! / 4, 9);
        expect(part.scorePct).toBeCloseTo(whole.scorePct, 9);
        expect(part.scorePerCost).toBeCloseTo(whole.scorePerCost * 4, 6);
        expect(part.subLabel).toBe('Lv 40 → 41 · 75% done');
        expect(whole.subLabel).toBe('Lv 40 → 41');
    });

    it('offers the level after the one being researched, at its full time', () => {
        const next = damageLab({ 'Damage Lab': { toLevel: 41, done: 0.5, running: true } });
        expect([next.fromLv, next.toLv]).toEqual([41, 42]);
        expect(next.subLabel).toBe('Lv 41 → 42 · after the Lv 41 being researched');
        const plain = labLevelCost('Damage Lab', 42, { 'Labs Speed': 10 }, {})!;
        expect(next.hours).toBeCloseTo(plain.hours, 9);
        // Gain from 41 to 42, not from 40 to 42.
        useGameStore.setState({ labData: { 'Damage Lab': 41, 'Labs Speed': 10 }, labProgress: {} });
        const fromThere = buildCandidates(snapshotFromState(store()), 'labs').find(c => c.label === 'Damage Lab')!;
        expect(next.scorePct).toBeCloseTo(fromThere.scorePct, 9);
    });

    it('prices a What If from what\'s left', () => {
        const snap = account({ 'Damage Lab': { toLevel: 41, done: 0.5, running: true } });
        const target = upgradeTargets(snap).find(t => t.label === 'Damage Lab')!;
        const whole = labLevelCost('Damage Lab', 41, snap.labData, snap.relicData)!;
        const next = labLevelCost('Damage Lab', 42, snap.labData, snap.relicData)!;
        const cost = changeCost(snap, target, 42);
        expect(cost.research).toBeCloseTo(whole.hours / 2 + next.hours, 6);
        expect(cost.coins).toBeCloseTo(next.coins, 6);    // the running level is paid
    });
});

describe('each preset\'s modules', () => {
    const mods = [
        gameModule('c1', 45, 15, [1]), gameModule('c2', 41, 15, [1]), gameModule('a1', 42, 10, [90]),
    ];
    const presets = [
        { PresetName: 'farm', PrimaryModuleGuids: ['c1', 'a1', '', ''], AssistModuleGuids: [] },
        { PresetName: 'push', PrimaryModuleGuids: ['c2', 'a1', '', ''], AssistModuleGuids: [] },
        { PresetName: 'Preset 3', PrimaryModuleGuids: [], AssistModuleGuids: [] },
    ];
    const file = (modulesIndex: number[], fields: Record<string, unknown> = {}) => makeExport({
        ModuleEquipped: [mods[0], mods[2]], ModuleInventory: [mods[1]], ModulePresets: presets, CurrentModulePreset: 0,
        GlobalPresets: modulesIndex.map(ModulesIndex => ({ ModulesIndex })),
        ...fields,
    });

    beforeEach(() => store().resetAll());

    it('reads which module preset each global preset uses', () => {
        expect(parseGameExport(file([0, 1, 0, 0, 0, 0])).modules!.state.loadoutFor)
            .toEqual(['game-0', 'game-1', 'game-0', 'game-0', 'game-0']);
    });

    it('keeps what\'s equipped when the rows don\'t tell presets apart', () => {
        // No Global Presets yet, or one set of modules everywhere, with another
        // module preset loaded by hand: what's equipped is the build.
        const same = parseGameExport(file([0, 0, 0, 0, 0, 0], { CurrentModulePreset: 1 })).modules!.state;
        expect(same.loadoutFor).toBeUndefined();
        expect(same.activeLoadout).toBe('game-1');
        expect(parseGameExport(makeExport({ ModuleEquipped: [mods[0]], ModulePresets: presets })).modules!.state.loadoutFor).toBeUndefined();
    });

    it('keeps what\'s equipped for a row on an empty module preset', () => {
        expect(parseGameExport(file([1, 2, 0, 0, 0, 0])).modules!.state.loadoutFor?.slice(0, 2)).toEqual(['game-1', 'game-0']);
    });

    it('switches modules with the preset, and after an import', () => {
        store().setActivePreset(1);
        store().applyGameImport(parseGameExport(file([0, 1, 0, 0, 0, 0])));
        expect(activeLoadout(store().moduleState)?.name).toBe('push');
        store().setActivePreset(0);
        expect(activeLoadout(store().moduleState)?.name).toBe('farm');
        store().setActivePreset(1);
        expect(activeLoadout(store().moduleState)?.name).toBe('push');
        // The calculators read the same loadout.
        expect(activeLoadout(snapshotFromState(store()).moduleState)?.slots.cannon.main).toBe('c2');
    });

    it('leaves modules alone without the link', () => {
        store().applyGameImport(parseGameExport(file([0, 0, 0, 0, 0, 0], { CurrentModulePreset: 1 })));
        store().setActivePreset(1);
        expect(store().moduleState.activeLoadout).toBe('game-1');
        store().setActivePreset(0);
        expect(store().moduleState.activeLoadout).toBe('game-1');
    });

    it('survives a deleted loadout', () => {
        store().applyGameImport(parseGameExport(file([0, 1, 0, 0, 0, 0])));
        store().setActivePreset(0);
        store().setModuleState({ loadouts: store().moduleState.loadouts.filter(l => l.id !== 'game-1') });
        store().setActivePreset(1);
        expect(store().moduleState.activeLoadout).toBe('game-0');
    });

    it('opens on the first preset\'s modules, wherever the last visit ended', () => {
        store().applyGameImport(parseGameExport(file([0, 1, 0, 0, 0, 0])));
        store().setActivePreset(1);
        const backup = store().exportData();
        useGameStore.setState({ activePreset: 0 });
        expect(store().importData(backup)).toBe(true);
        expect(activeLoadout(store().moduleState)?.name).toBe('farm');
    });

    describe('the tournament build', () => {
        const state = () => {
            store().applyGameImport(parseGameExport(file([0, 1, 0, 0, 0, 0])));
            useGameStore.setState({ profile: { ...store().profile, presets: 5 } });
            return store();
        };

        it('brings the preset\'s own modules', () => {
            expect(activeLoadout(withTournamentBuild(state(), 1).moduleState)?.name).toBe('push');
        });

        it('lets modules picked for the build win', () => {
            expect(activeLoadout(withTournamentBuild(state(), 1, 'game-0').moduleState)?.name).toBe('farm');
        });

        it('falls back to the preset\'s when the picked loadout is gone', () => {
            expect(activeLoadout(withTournamentBuild(state(), 1, 'gone').moduleState)?.name).toBe('push');
        });
    });
});
