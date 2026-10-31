// Dissonant Boosts: anchored on the owner's Dissonant Boosts panel (screens of
// 2026-10-31, all three views, T13–T17) with the wave tables of their export
// of 2026-10-21. Every wave on those screens matches that export. The UW Echo
// lab finished Lv 14 after it (the panel's 7.5%). Echo Only on Attack T13–T16
// and on Utility also read tiers above T17, which the screens don't show and
// which may have moved since, so those cells aren't pinned exactly.

import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '../store/useGameStore';
import { parseGameExport, defaultBattleIndex } from './gameExport';
import { buildCandidates } from './optimizer';
import type { OptimizerSnapshot } from './optimizer';
import { applyGoal, chosenReport, runModels, snapshotFromState } from './accountModels';
import { buildRunLengthModel } from './runLength';
import { buildRunModel, projectRun, runSettingsFromCards } from './runCoins';
import { hasDissonance, trackBoost } from './dissonance';
import { BENCH_ACCOUNTS } from '../ai/bench/benchAccounts';
import { accountSummary, farmTiersReport, tierOutlook } from '../ai/aiTools';
import type { AiAccount } from '../ai/aiTools';
import type { OptGoal } from '../constants/optimizerConfig';
import type { BuildType, DissonanceTrack, DissonanceWaves } from '../types/gameTypes';
import { battle, makeExport } from '../test/makeExport';

const WAVES: DissonanceWaves = {
    attack: [0, 5502, 7864, 5007, 5011, 5001, 5002, 5150, 5005, 5708, 5638, 5470, 5214, 6580, 5003, 6942, 5636, 3828, 2585],
    defense: [0, 5289, 6115, 6626, 6299, 9052, 6912, 5469, 5054, 5001, 5084, 5026, 8628, 5194, 5141, 0, 4918, 3466],
    utility: [0, 5550, 9642, 5067, 5126, 5222, 5005, 5120, 5002, 5034, 5625, 6423, 5668, 5112, 5012, 5231, 5003, 5153, 5289, 3785, 2496, 1027, 251],
    uw: [0, 6098, 4583, 5017, 5203, 5659, 5045, 5226, 5002, 5002, 5419, 5446, 5096, 6372, 4669, 3993, 2904, 1566, 333, 0, 11],
};
const LABS = { 'Dissonant Echo-Atk': 12, 'Dissonant Echo-Def': 8, 'Dissonant Echo-Util': 12, 'Dissonant Echo-UW': 14 };

describe('the Dissonant Boosts panel', () => {
    // Tier → Attack, Defense, Utility, UW.
    const BOOST_ONLY: Record<number, number[]> = {
        13: [5.00, 5.00, 3.00, 5.00],
        14: [5.00, 5.00, 3.00, 4.55],
        15: [5.00, 1.00, 3.00, 3.70],   // no Defense run on T15: "—" on the panel
        16: [5.00, 4.89, 3.00, 2.55],
        17: [3.51, 3.11, 3.00, 1.52],
    };
    const TRACKS: DissonanceTrack[] = ['attack', 'defense', 'utility', 'uw'];
    const at = (track: DissonanceTrack, tier: number) => trackBoost(WAVES, track, tier, LABS);

    it('reads Boost Only on every cell', () => {
        for (const [tier, row] of Object.entries(BOOST_ONLY)) {
            row.forEach((v, i) => expect(at(TRACKS[i], Number(tier)).boost).toBeCloseTo(v, 2));
        }
    });

    it('reads Echo Only on Defense and UW, and adds it to the boost', () => {
        const defense = { 13: [2.61, 7.61], 14: [2.61, 7.61], 15: [2.79, 3.79], 16: [2.61, 7.50], 17: [2.69, 5.80] };
        const uw = { 13: [4.18, 9.18], 14: [4.22, 8.77], 15: [4.28, 7.98], 16: [4.37, 6.91], 17: [4.44, 5.97] };
        for (const [track, table] of [['defense', defense], ['uw', uw]] as const) {
            for (const [tier, [echo, total]] of Object.entries(table)) {
                expect(at(track, Number(tier)).echo).toBeCloseTo(echo, 2);
                expect(at(track, Number(tier)).total).toBeCloseTo(total, 2);
            }
        }
    });

    it('reads Attack, within the rounding the tiers above T17 can move', () => {
        expect(at('attack', 17).echo).toBeCloseTo(4.24, 2);
        expect(at('attack', 17).total).toBeCloseTo(7.75, 2);
        // 9.15 and 4.15 on the panel; 4.1449 from the export's T18.
        expect(Math.abs(at('attack', 13).echo - 4.15)).toBeLessThan(0.006);
        expect(Math.abs(at('attack', 13).total - 9.15)).toBeLessThan(0.006);
    });

    it('matches the wiki\'s milestones: ×5 or ×3 at wave 5000, and past it nothing more', () => {
        const one = (wave: number, track: DissonanceTrack) => trackBoost({ attack: [], defense: [], utility: [], uw: [], [track]: [0, wave] }, track, 1, {}).boost;
        expect(one(1524, 'attack')).toBeCloseTo(1.5, 2);
        expect(one(2855, 'uw')).toBeCloseTo(2.5, 2);
        expect(one(3365, 'utility')).toBeCloseTo(2.0, 2);
        expect(one(5000, 'defense')).toBe(5);
        expect(one(9052, 'defense')).toBe(5);
        expect(one(9642, 'utility')).toBe(3);
    });

    it('starts Echo at 0.5% and adds 0.5% a lab level', () => {
        const waves = { attack: [0, 5000, 5000], defense: [], utility: [], uw: [] };
        expect(trackBoost(waves, 'attack', 1, {}).echo).toBeCloseTo(4 * 0.005, 9);
        expect(trackBoost(waves, 'attack', 1, { 'Dissonant Echo-Atk': 12 }).echo).toBeCloseTo(4 * 0.065, 9);
    });

    it('gives no boost without a Dissonant Run', () => {
        const none = { attack: [], defense: [], utility: [], uw: [] };
        expect(hasDissonance(none)).toBe(false);
        expect(hasDissonance(WAVES)).toBe(true);
        expect(trackBoost(none, 'attack', 18, { 'Dissonant Echo-Atk': 20 }).total).toBe(1);
    });
});

function load(key: 'early' | 'mid' | 'late', dissonanceWaves?: DissonanceWaves): AiAccount {
    const a = BENCH_ACCOUNTS.find(x => x.key === key)!;
    useGameStore.getState().resetAll();
    useGameStore.getState().applyGameImport(parseGameExport(a.raw));
    if (a.build) useGameStore.getState().updateProfile({ build: a.build });
    if (dissonanceWaves) useGameStore.setState({ dissonanceWaves });
    return useGameStore.getState();
}

describe('the Echo labs in the Optimizer', () => {
    const scored = (account: AiAccount, goal: OptGoal, build: BuildType = 'Glass Cannon'): OptimizerSnapshot => {
        const snap = snapshotFromState(account);
        applyGoal(snap, goal, build, chosenReport(account), runModels(account));
        return snap;
    };
    const gain = (snap: OptimizerSnapshot, lab: string) => buildCandidates(snap, 'labs').find(c => c.label === lab)?.scorePct ?? 0;

    it('are worth nothing without Dissonance data, as before', () => {
        const snap = scored(load('late'), 'waves');
        expect(snap.dissonance).toBeUndefined();
        for (const lab of ['Dissonant Echo-Atk', 'Dissonant Echo-UW', 'Dissonant Echo-Util', 'Dissonant Echo-Def']) {
            expect(gain(snap, lab)).toBeCloseTo(0, 9);
        }
    });

    it('raise damage through Attack and UW, on the farm tier', () => {
        const snap = scored(load('late', WAVES), 'damage');
        expect(snap.dissonance?.tier).toBe(chosenReport(load('late', WAVES))!.tier);
        const attack = gain(snap, 'Dissonant Echo-Atk');
        const uw = gain(snap, 'Dissonant Echo-UW');
        expect(attack).toBeGreaterThan(0);
        expect(uw).toBeGreaterThan(0);
        // Attack also lifts the UWs built on tower damage: never more than its own boost's rise.
        const b = (lv: number) => trackBoost(WAVES, 'attack', snap.dissonance!.tier, { ...snap.labData, 'Dissonant Echo-Atk': lv }).total;
        const lv = snap.labData['Dissonant Echo-Atk'] ?? 0;
        expect(attack).toBeLessThanOrEqual((b(lv + 1) / b(lv) - 1) * 100 + 1e-9);
        expect(gain(snap, 'Dissonant Echo-Util')).toBeCloseTo(0, 9);
        expect(gain(snap, 'Dissonant Echo-Def')).toBeCloseTo(0, 9);
    });

    it('raise coins through Utility', () => {
        const snap = scored(load('late', WAVES), 'coins', 'Farming');
        const util = gain(snap, 'Dissonant Echo-Util');
        const b = (lv: number) => trackBoost(WAVES, 'utility', snap.dissonance!.tier, { ...snap.labData, 'Dissonant Echo-Util': lv }).total;
        const lv = snap.labData['Dissonant Echo-Util'] ?? 0;
        expect(util).toBeGreaterThan(0);
        expect(util).toBeLessThanOrEqual((b(lv + 1) / b(lv) - 1) * 100 + 1e-9);
    });

    it('raise survival through Defense', () => {
        const snap = scored(load('late', WAVES), 'survival', 'eHP');
        expect(gain(snap, 'Dissonant Echo-Def')).toBeGreaterThan(0);
        expect(gain(snap, 'Dissonant Echo-Atk')).toBeCloseTo(0, 9);
    });

    it('stay out of tournament runs until that\'s confirmed', () => {
        const account = load('late', WAVES);
        const idx = account.importedBattles.findIndex(b => b.tournament);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(snapshotFromState({ ...account, battleReportText: '', battleReportChoice: idx }).dissonance).toBeUndefined();
    });
});

describe('comparing tiers', () => {
    // On the bench account's T18, T19 sits lower on Attack and Utility.
    it('counts each tier\'s own boost on damage and coins', () => {
        const coinsOn = (r: { text: string }, tier: number) => r.text.match(new RegExp(`^T${tier}: runs end around W([\\d,]+)`, 'm'))![1];
        const plain = farmTiersReport(load('late'));
        const boosted = farmTiersReport(load('late', WAVES));
        expect(boosted.text).toMatch(/Each tier's own Dissonant Boosts are counted/);
        expect(plain.text).not.toMatch(/Dissonant Boosts/);
        // The farm tier's runs are what they are; the next tier's get shorter on a weaker boost.
        expect(coinsOn(boosted, 18)).toBe(coinsOn(plain, 18));
        const wave = (s: string) => Number(s.replace(/,/g, ''));
        expect(wave(coinsOn(boosted, 19))).toBeLessThan(wave(coinsOn(plain, 19)));
        const headline = (r: { text: string }) => wave(r.text.match(/^Headline: runs on T19 would end around W([\d,]+)/)![1]);
        expect(headline(tierOutlook(load('late', WAVES), 19))).toBeLessThan(headline(tierOutlook(load('late'), 19)));
    });

    it('pays the boost on coins in a projected run', () => {
        const account = load('late');
        const settings = runSettingsFromCards(account.cardData, account.activePreset);
        const model = buildRunModel(account.importedBattles, defaultBattleIndex(account.importedBattles), settings)!;
        const plain = projectRun(model.calibration, settings, 5000, 19);
        expect(projectRun(model.calibration, settings, 5000, 19, 0.9).coins).toBeCloseTo(plain.coins * 0.9, 3);
    });
});

describe('the account summary', () => {
    it('gives the farm tier\'s boosts for campaign questions only', () => {
        const account = load('late', WAVES);
        expect(accountSummary(account)).toMatch(/Dissonant Boosts on T18, where they farm: Attack ×[\d.]+ on damage, Defense ×[\d.]+ on health, Utility ×[\d.]+ on coins, UW ×[\d.]+ on UW damage; each tier has its own\./);
        expect(accountSummary(account, Date.now(), { league: '', week: {}, recent: {} })).not.toMatch(/Dissonant Boosts/);
        expect(accountSummary(load('late'))).not.toMatch(/Dissonant Boosts/);
    });
});

describe('Dissonant Runs', () => {
    const run = (fields: Record<string, unknown>) => battle({
        RealTime: 20000, Wave: 8000, KilledBy: 2, HealthLevelSkips: 4000, AttackLevelSkips: 4000, ...fields,
    });

    it('stay out of calibration and run length', () => {
        const imp = parseGameExport(makeExport({
            BattleHistory: [
                run({ BattleDate: '2026-10-01T12:00:00Z' }),
                run({ BattleDate: '2026-10-02T12:00:00Z', Wave: 7000, DissonanceType: 3 }),
            ],
        }));
        expect(defaultBattleIndex(imp.battles)).toBe(0);
        expect(buildRunLengthModel(imp.battles)!.used.map(d => d.run.wave)).toEqual([8000]);
    });
});

describe('Dissonance data', () => {
    beforeEach(() => useGameStore.getState().resetAll());

    it('imports each track by tier', () => {
        const imp = parseGameExport(makeExport({
            DissonanceDamageBoost: [0, 5502, 7864], DissonanceHealthBoost: [0, 5289], DissonanceCoinBoost: [0, 5550], DissonanceUltDamageBoost: [0, 6098],
        }));
        expect(imp.dissonance).toEqual({ attack: [0, 5502, 7864], defense: [0, 5289], utility: [0, 5550], uw: [0, 6098] });
        expect(parseGameExport(makeExport()).dissonance).toBeNull();
    });

    it('keeps what was typed when a file has none, and a file\'s replaces it', () => {
        const store = () => useGameStore.getState();
        store().setDissonanceWave('attack', 3, 1200);
        expect(store().dissonanceWaves.attack).toEqual([0, 0, 0, 1200]);
        store().applyGameImport(parseGameExport(makeExport()));
        expect(store().dissonanceWaves.attack[3]).toBe(1200);
        store().applyGameImport(parseGameExport(makeExport({
            DissonanceDamageBoost: [0, 5502], DissonanceHealthBoost: [], DissonanceCoinBoost: [], DissonanceUltDamageBoost: [],
        })));
        expect(store().dissonanceWaves.attack).toEqual([0, 5502]);
    });

    it('goes with a backup', () => {
        const store = () => useGameStore.getState();
        store().setDissonanceWave('uw', 2, 700);
        const backup = store().exportData();
        store().resetAll();
        expect(store().dissonanceWaves.uw).toEqual([]);
        expect(store().importData(backup)).toBe(true);
        expect(store().dissonanceWaves.uw[2]).toBe(700);
    });
});
