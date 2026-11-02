// Tests for the optimizer's stone ranking and the calibrated eDPS score,
// on made-up accounts. Costs and rules pinned here come from the game wiki
// (stone tables, card mastery, assist modules) — see the comments.

import { describe, expect, it } from 'vitest';
import { useGameStore } from '../store/useGameStore';
import { readActiveModuleBonuses } from './modBonuses';
import { runRatesFrom } from './runRates';
import { parseGameExport } from './gameExport';
import { buildCandidates, goalScore, groupPath, mergeRepeats, pathGain, shardTypeValues, simulateMedalPath, simulateStonePath } from './optimizer';
import { buildFarmCalibration } from './farming';
import { buildEhpCalibration } from './ehp';
import type { OptimizerSnapshot } from './optimizer';
import { buildEdpsCalibration, edpsParts, edpsScore, edpsSurvivalScore, smiteLog } from './edps';
import { UWS, UW_STAT_VALUES, UW_STONE_COSTS, WS_STATS } from '../constants/gameData';
import { GC_SCORING } from '../constants/optimizerConfig';
import type { BattleReport } from './battleReport';
import { battle, makeExport } from '../test/makeExport';
import { BOTS_CONFIG } from '../constants/botData';

// A made-up run: 1000 enemies, total damage 1000 split by source.
function run(fields: Record<string, unknown> = {}): BattleReport {
    return parseGameExport(makeExport({
        BattleHistory: [battle({
            TotalEnemies: 1000, GameTime: 10000, Wave: 500,
            DamageDealt: 1000, ChainLightningDamage: 100, BlackHoleDamage: 50, OrbDamage: 800,
            ProjectilesDamage: 10, SwampDamage: 5, SmartMissileDamage: 5,
            DestroyedInBlackhole: 900, ProjectilesCount: 10000, EnemiesHitByChainLightningThisRound: 500,
            ...fields,
        })],
    })).battles[0];
}

// Every UW owned at Damage 10 / second stat 3 / third stat 10, nothing else.
function snapshot(report: BattleReport | null = null, edit?: (s: OptimizerSnapshot) => void): OptimizerSnapshot {
    const st = useGameStore.getState();
    const snap: OptimizerSnapshot = {
        presetIdx: 0,
        wsData: JSON.parse(JSON.stringify(st.wsData)),
        enhData: JSON.parse(JSON.stringify(st.enhData)),
        labData: {},
        cardData: { data: {}, slots: 1, presets: { 0: [] } },
        perkData: { banned: [] },
        uwData: { stones: 0, data: Object.fromEntries(UWS.map(u => [u.a, { own: true, sv: [10, 3, 10], upOwn: false, upLvl: 0 }])) },
        relicData: {},
        modBonuses: readActiveModuleBonuses(st.moduleState, { banned: [] }, {}, { data: {}, slots: 1, presets: {} }, runRatesFrom(report)),
        moduleState: JSON.parse(JSON.stringify(st.moduleState)),
        botData: {},
        metric: 'edps',
    };
    edit?.(snap);
    return snap;
}

describe('calibrated eDPS', () => {
    it('scores the current setup exactly 1', () => {
        const report = run();
        const snap = snapshot(report);
        const calib = buildEdpsCalibration(snap, report)!;
        expect(edpsScore(snap, calib)).toBeCloseTo(1, 10);
        expect(calib.shares.fixed).toBeCloseTo(0.83, 10);   // orbs 800 + 30 the report doesn't attribute
    });

    it('works without Chain Lightning (nothing to smite)', () => {
        const report = run({ ChainLightningDamage: 0, EnemiesHitByChainLightningThisRound: 0 });
        const snap = snapshot(report, s => { s.uwData.data = {}; });
        const calib = buildEdpsCalibration(snap, report)!;
        expect(calib.smiteProcs).toBe(0);
        expect(edpsScore(snap, calib)).toBeCloseTo(1, 10);
        expect(edpsSurvivalScore(snap, calib)).toBeCloseTo(1, 10);
    });

    it('counts a source by its share of the real damage', () => {
        // Chain Lightning Damage 10 → 11 is 85× → 113×; CL did 10% of the damage.
        const report = run();
        const snap = snapshot(report);
        const calib = buildEdpsCalibration(snap, report)!;
        const after = snapshot(report, s => { s.uwData.data.CL!.sv[0] = 11; });
        expect(UW_STAT_VALUES.CL[0].slice(9, 11)).toEqual(['85x', '113x']);
        expect(edpsScore(after, calib)).toBeCloseTo(1 + 0.1 * (113 / 85 - 1), 6);
    });

    it('adds Consume as a share of the health of kills inside Black Hole', () => {
        const report = run();
        const snap = snapshot(report);
        const calib = buildEdpsCalibration(snap, report)!;
        const after = snapshot(report, s => { s.uwData.data.BH!.upOwn = true; });   // Consume Lv 1 = 5%
        expect(edpsScore(after, calib)).toBeCloseTo(1 + 0.05 * 0.9, 6);
    });

    it("values Smite at the run's proc rate, not the 100-hit cap", () => {
        // CL chance Lv 10 = 18.5%, 3 chains: 10,000 shots × 0.185 × 3 ÷ 500
        // enemies reached = 11.1 hits each → 2.05 smites; CL reached 50%.
        const report = run();
        const snap = snapshot(report);
        const calib = buildEdpsCalibration(snap, report)!;
        expect(calib.smiteProcs).toBeCloseTo(11.1 * 0.185, 6);
        const after = snapshot(report, s => { s.uwData.data.CL!.upOwn = true; });   // Smite Lv 1 = 0.05%
        expect(edpsScore(after, calib)).toBeCloseTo(1 + 0.0005 * 11.1 * 0.185 * 0.5, 8);
    });

    it('counts Smite on the enemies that end runs as flat damage they no longer need', () => {
        // 2.05 smites per enemy reached at the run; a Ray (health ×1, speed 0.4)
        // stays 2.5× as long in range → 5.13 smites × 0.05% = 0.26% of its health;
        // a Commander (×20, speed 0.2) 10.3 smites, 0.026%.
        const report = run();
        const calib = buildEdpsCalibration(snapshot(report), report)!;
        const after = (killers: OptimizerSnapshot['killers']) => ({ ...snapshot(report, s => { s.uwData.data.CL!.upOwn = true; }), killers });
        const took = (killer: number, health: number) => 11.1 * 0.185 / killer * 0.0005 / health;
        const ray = after({ Ray: 1 });
        expect(smiteLog(ray, calib, edpsParts(ray))).toBeCloseTo(-Math.log(1 - took(0.4, 1)), 9);
        const mixed = after({ Ray: 0.5, Commander: 0.5 });
        expect(smiteLog(mixed, calib, edpsParts(mixed)))
            .toBeCloseTo(-0.5 * Math.log(1 - took(0.4, 1)) - 0.5 * Math.log(1 - took(0.2, 20)), 9);
        // Without CL+ there's nothing to smite.
        const none = { ...snapshot(report), killers: { Ray: 1 } };
        expect(smiteLog(none, calib, edpsParts(none))).toBe(0);
    });

    it('counts Flame Bot as flat damage, by its Damage stat and cooldown', () => {
        // Flame Bot did 100 of the 1000 damage: flat now CL 100 + SM 5 + PS 5 + shots 10 + flame 100.
        const report = run({ FlameBotDamage: 100 });
        const bot = (dmgLv: number) => snapshot(report, s => {
            s.botData = { 'Flame Bot': { owned: true, medals: [0, 0, dmgLv, 0], plusLv: 0 } };
        });
        const calib = buildEdpsCalibration(bot(5), report)!;
        expect(calib.shares.flame).toBeCloseTo(0.1, 9);
        // Damage Lv 5 → 6 is ×90 → ×98 (wiki, 50 + 8 a level).
        expect(edpsSurvivalScore(bot(6), calib)).toBeCloseTo(1 + (0.1 / 0.22) * (98 / 90 - 1), 6);
    });

    it('counts only flat damage for how far a Glass Cannon run gets', () => {
        // Flat sources in the run: CL 100, SM 5, PS 5, tower shots 10 = 0.12 of the damage.
        const report = run();
        const snap = snapshot(report);
        const calib = buildEdpsCalibration(snap, report)!;
        expect(edpsSurvivalScore(snap, calib)).toBeCloseTo(1, 10);
        const cl = snapshot(report, s => { s.uwData.data.CL!.sv[0] = 11; });
        expect(edpsSurvivalScore(cl, calib)).toBeCloseTo(1 + (0.1 / 0.12) * (113 / 85 - 1), 6);
        // Consume deals a share of enemy health: more eDPS, no extra waves.
        const consume = snapshot(report, s => { s.uwData.data.BH!.upOwn = true; });
        expect(edpsScore(consume, calib)).toBeGreaterThan(1);
        expect(edpsSurvivalScore(consume, calib)).toBeCloseTo(1, 10);
    });

    it('needs damage by source to calibrate', () => {
        const report = run({ DamageDealt: 0 });
        expect(buildEdpsCalibration(snapshot(report), report)).toBeNull();
        expect(buildEdpsCalibration(snapshot(), null)).toBeNull();
    });
});

describe('card mastery', () => {
    // Stones unlock a mastery at its first value; levels 1–9 come from labs.
    const withDamageCard = (mu: boolean) => snapshot(null, s => {
        s.cardData = { data: { Damage: { s: 7, m: 0, mu } }, slots: 1, presets: { 0: ['Damage'] } };
    });

    it('offers to unlock a locked mastery, at its lab level', () => {
        const [c] = buildCandidates(withDamageCard(false), 'mast');
        expect(c).toMatchObject({ label: 'Damage Mastery', fromLv: -1, toLv: 0, cost: 750 });
    });

    it('never offers to buy an unlocked mastery again', () => {
        expect(buildCandidates(withDamageCard(true), 'mast')).toHaveLength(0);
    });

    it('offers none before the Card Mastery milestone (Tier 16, wave 100)', () => {
        const at = (wave: number) => {
            const s = withDamageCard(false);
            s.progress = { tierWaves: { 15: 4000, 16: wave }, completedTier: 15 };
            return buildCandidates(s, 'mast');
        };
        expect(at(99)).toHaveLength(0);
        expect(at(100)).toHaveLength(1);
    });
});

describe('assist modules', () => {
    const assist = (multEff: number, subEff: number, labs: Record<string, number> = {}) => snapshot(null, s => {
        s.moduleState.assistData.cannon = { rarity: 'Epic', multEff, subEff };
        s.labData = labs;
    });
    const find = (snap: OptimizerSnapshot, what: string) =>
        buildCandidates(snap, 'assist').find(c => c.label === `Cannon Assist — ${what}`);

    it('costs 15 + 3 per stone level already bought', () => {
        // 48% = 1% base + 29 stone levels + 18 lab levels → the 30th costs 15 + 3 × 29.
        const snap = assist(48, 23, { 'Assist-Cannon Mult': 18, 'Assist-Cannon Substat': 9 });
        expect(find(snap, 'Mult Eff')!.cost).toBe(102);
        expect(find(snap, 'Substat Eff')!.cost).toBe(54);
    });

    it('stops Substat stones at 70% (labs add the last 30%)', () => {
        expect(find(assist(1, 70), 'Substat Eff')).toBeUndefined();
        expect(find(assist(1, 99, { 'Assist-Cannon Substat': 30 }), 'Substat Eff')).toBeDefined();
        expect(find(assist(1, 100, { 'Assist-Cannon Substat': 30 }), 'Substat Eff')).toBeUndefined();
    });

    it('lets Main Effect stones reach 100% (130% with the Assist Mult lab)', () => {
        expect(find(assist(99, 1), 'Mult Eff')).toBeDefined();
        expect(find(assist(100, 1), 'Mult Eff')).toBeUndefined();
        expect(find(assist(129, 1, { 'Assist-Cannon Mult': 30 }), 'Mult Eff')).toBeDefined();
        expect(find(assist(130, 1, { 'Assist-Cannon Mult': 30 }), 'Mult Eff')).toBeUndefined();
    });
});

describe('UW stone tables', () => {
    // From the wiki: Damage for SM / ILM / PS goes to Lv 36, Spotlight Bonus to
    // Lv 31 and Angle to Lv 61 (90°).
    const max = (a: string, stat: string) => UWS.find(u => u.a === a)!.s.find(([n]) => n === stat)![1];

    it('has every level the game has', () => {
        expect(max('SM', 'Damage')).toBe(36);
        expect(max('ILM', 'Damage')).toBe(36);
        expect(max('PS', 'Damage')).toBe(36);
        expect(max('SL', 'Bonus')).toBe(31);
        expect(max('SL', 'Angle')).toBe(61);
        expect(UW_STAT_VALUES.SM[0][35]).toBe('9219x');
        expect(UW_STONE_COSTS.SM[0].at(-1)).toBe(3166);
        expect(UW_STONE_COSTS.ILM[0].at(-1)).toBe(2228);
        expect(UW_STONE_COSTS.PS[0].at(-1)).toBe(3418);
        expect(UW_STONE_COSTS.SL[0].at(-1)).toBe(2900);
    });

    it('has one cost per level after the first, and one value per level', () => {
        for (const uw of UWS) {
            uw.s.forEach(([, maxLv], i) => {
                expect(UW_STAT_VALUES[uw.a][i].length, `${uw.a} ${i} values`).toBeGreaterThanOrEqual(maxLv);
                expect(UW_STONE_COSTS[uw.a][i].length, `${uw.a} ${i} costs`).toBeGreaterThanOrEqual(maxLv - 1);
            });
        }
    });
});

describe('Glass Cannon workshop and labs', () => {
    const calibrated = (edit?: (s: OptimizerSnapshot) => void) => {
        const report = run();
        const snap = snapshot(report, edit);
        snap.edps = buildEdpsCalibration(snap, report)!;
        return snap;
    };
    const ws = (snap: OptimizerSnapshot, stat: string) =>
        buildCandidates(snap, 'workshop').find(c => c.label.endsWith(`— ${stat}`));

    it('prices workshop steps in coins after the discount lab, and ranks by gain per coin', () => {
        const snap = calibrated(s => { s.labData = { 'WS Atk Discount': 99 }; });
        const as = ws(snap, 'Attack Speed')!;
        expect(as).toMatchObject({ fromLv: 0, toLv: 1, costKnown: true });
        expect(as.cost).toBeCloseTo(30 * 0.505, 6);                       // level 1 is 30 coins
        expect(as.scorePerCost).toBeCloseTo(as.scorePct / as.cost, 9);
        const dmg = ws(snap, 'Damage')!;
        expect(dmg.toLv - dmg.fromLv).toBe(10);                           // 6000-level stats move 10 at a time
    });

    // Some builds keep a stat low on purpose (an orb build's Range at 0).
    it('leaves out the workshop stats the player unticked', () => {
        const snap = calibrated(s => { s.excludedWorkshop = ['attack|Range', 'attack|Rend Armor Chance']; });
        expect(ws(snap, 'Range')).toBeUndefined();
        expect(ws(snap, 'Rend Armor Chance')).toBeUndefined();
        expect(ws(snap, 'Rend Armor Mult')).toBeDefined();
        expect(ws(calibrated(), 'Range')).toBeDefined();
    });

    it('counts Enemy Health Level Skip in waves mode, at what a point is worth', () => {
        const skip = (worth?: number) => ws(calibrated(s => {
            s.edpsMode = 'waves';
            s.skipWorth = worth;
            s.wsData[0].utility[12] = 100;                                // Enemy HP Level Skip
        }), 'Enemy HP Level Skip');
        expect(skip()).toBeDefined();
        expect(skip()!.scorePct).toBeCloseTo(0, 9);
        // Lv 100 → 110 adds 0.5 points: worth 0.6 a point → e^0.3 − 1.
        expect(skip(0.6)!.toLv).toBe(110);
        expect(skip(0.6)!.scorePct).toBeCloseTo((Math.exp(0.6 * 0.5) - 1) * 100, 6);
        expect(skip(0.6)!.skipPoints).toBeCloseTo(0.5, 9);           // so its waves count it as skip
        expect(skip()!.skipPoints).toBeUndefined();
    });

    // An assist module's substats work at Substat Efficiency, Enemy Health
    // Level Skip among them: each 1% of efficiency adds 1% of the substat.
    it('counts Enemy Health Level Skip from an assist module\'s substat (waves)', () => {
        const snap = calibrated(s => {
            s.edpsMode = 'waves';
            s.skipWorth = 0.6;
            s.moduleState.library = [{ id: 'gen', name: 'Made-up Generator', type: 'generator', rarity: 'A',
                subs: [{ effect: 'Enemy HP Level Skip', rar: 'Ancestral', val: '8%' }] }];
            const none = { main: '', assist: '' };
            s.moduleState.loadouts = [{ id: 'l', name: 'farm', slots: { cannon: none, armor: none, generator: { main: '', assist: 'gen' }, core: none } }];
            s.moduleState.assistData = { generator: { rarity: 'Epic', multEff: 1, subEff: 14 } };
            s.modBonuses = readActiveModuleBonuses(s.moduleState, s.perkData, s.labData, s.cardData, s.modBonuses.run);
        });
        const step = buildCandidates(snap, 'assist').find(c => c.label === 'Generator Assist — Substat Eff')!;
        // 14% → 15% of 8%: +0.08 points, at 0.6 a point.
        expect(step.skipPoints).toBeCloseTo(0.08, 9);
        expect(step.scorePct).toBeCloseTo((Math.exp(0.6 * 0.08) - 1) * 100, 6);
    });

    it('counts enemy health labs by how often that enemy ends a run (waves)', () => {
        const lab = (killers: OptimizerSnapshot['killers'], name: string) => buildCandidates(calibrated(s => {
            s.edpsMode = 'waves';
            s.killers = killers;
            s.labData = { [name]: 10 };
        }), 'labs').find(c => c.label === name);
        // Ray Health Lv 10 → 11: 96% → 95.6% of Ray health.
        expect(lab({ Ray: 1 }, 'Ray Health')!.scorePct).toBeCloseTo((0.96 / 0.956 - 1) * 100, 6);
        expect(lab({ Ray: 0.5, Tank: 0.5 }, 'Ray Health')!.scorePct).toBeCloseTo((Math.sqrt(0.96 / 0.956) - 1) * 100, 6);
        expect(lab({ Ray: 1 }, 'Tank Enemy Health')!.scorePct).toBeCloseTo(0, 9);   // Tanks never ended these runs
        expect(lab(undefined, 'Ray Health')!.scorePct).toBeCloseTo(0, 9);            // no killers recorded
    });

    it('ranks labs by gain per hour of research, with coins and time', () => {
        const snap = calibrated(s => { s.labData = { 'Damage Lab': 40 }; });
        const lab = buildCandidates(snap, 'labs').find(c => c.label === 'Damage Lab')!;
        expect(lab.coins).toBe(357390);                                   // level 41: 5d 19h 24m (wiki)
        expect(lab.hours).toBeCloseTo(139.4, 6);
        expect(lab.scorePct).toBeGreaterThan(0);
        expect(lab.scorePerCost).toBeCloseTo(lab.scorePct / Math.max(1 / 60, lab.hours!), 9);
    });

    it('merges back-to-back steps on one stat into one row', () => {
        const step = (from: number, gain: number, label = 'WS Attack — Damage') => ({
            category: 'workshop' as const, label, subLabel: '', fromLv: from, toLv: from + 10,
            cost: 100, costType: 'coins' as const, scorePct: gain, scorePerCost: gain / 100,
        });
        const rows = mergeRepeats([step(0, 1), step(10, 2), step(0, 5, 'WS Attack — Range'), step(20, 1)]);
        expect(rows.map(r => [r.label, r.fromLv, r.toLv, r.cost])).toEqual([
            ['WS Attack — Damage', 0, 20, 200], ['WS Attack — Range', 0, 10, 100], ['WS Attack — Damage', 20, 30, 100],
        ]);
        expect(rows[0].scorePct).toBeCloseTo((1.01 * 1.02 - 1) * 100, 9);
        expect(rows[0].subLabel).toBe('Lv 0 → 20');
    });

    it('reads merged assist efficiency steps in %', () => {
        const step = (from: number) => ({
            category: 'assist' as const, label: 'Generator Assist — Substat Eff', subLabel: '', fromLv: from, toLv: from + 1,
            cost: 54, costType: 'stones' as const, scorePct: 1, scorePerCost: 1 / 54,
        });
        expect(mergeRepeats([step(14), step(15)])[0].subLabel).toBe('14% → 16%');
    });

    it('reads a path in blocks, one row per stat in each', () => {
        const step = (label: string, from: number) => ({
            category: 'workshop' as const, label, subLabel: '', fromLv: from, toLv: from + 1,
            cost: 10, costType: 'coins' as const, scorePct: 1, scorePerCost: 0.1,
        });
        // CC, CF, CC, CF … for 12 steps: blocks of 10 and 2.
        const path = Array.from({ length: 12 }, (_, i) => step(i % 2 ? 'CF' : 'CC', 40 + Math.floor(i / 2)));
        const rows = groupPath(path);
        expect(rows.map(r => [r.label, r.fromLv, r.toLv])).toEqual([
            ['CC', 40, 45], ['CF', 40, 45], ['CC', 45, 46], ['CF', 45, 46],
        ]);
        expect(rows[0].cost).toBe(50);
    });
});

describe('every currency', () => {
    const find = (snap: OptimizerSnapshot, cat: Parameters<typeof buildCandidates>[1], label: string) =>
        buildCandidates(snap, cat).find(c => c.label === label);

    it('prices bot levels in medals: 100 + 40 a level', () => {
        const snap = snapshot(run(), s => { s.botData = { 'Amplify Bot': { owned: true, medals: [0, 0, 5, 0], plusLv: 0 } }; });
        snap.edps = buildEdpsCalibration(snap, run())!;
        const bonus = find(snap, 'bots', 'Amplify Bot — Bonus')!;
        expect(bonus).toMatchObject({ fromLv: 5, toLv: 6, cost: 300, costType: 'medals' });
        expect(bonus.scorePct).toBeGreaterThan(0);           // ×5.9 → ×6.3 on tower damage
        expect(find(snap, 'bots', 'Amplify Bot — Duration')!.scorePct).toBeCloseTo(0, 9);   // not modeled
    });

    // Echoing Shot: tower bullets count as 3 + level bullets, so 5 → 6 is
    // +20% on tower shots — 1% of this run's damage. Bonus Cells counts only
    // for the More Elite Cells goal (cells.test.ts), so it shows no gain here.
    it('prices Bot+ levels in medals and scores Echoing Shot on tower shots', () => {
        const report = run();
        const plus = (s: OptimizerSnapshot, lv: number) => {
            s.botData = {
                'Amplify Bot': { owned: true, plusOwned: true, medals: [0, 0, 5, 0], plusLv: lv },
                'Golden Bot': { owned: true, plusOwned: true, medals: [0, 0, 0, 0], plusLv: 24 },
                'Bot Bot': { owned: true, plusOwned: false, medals: [0, 0, 0, 0], plusLv: 0 },
            };
        };
        const snap = snapshot(report, s => plus(s, 2));
        snap.edps = buildEdpsCalibration(snap, report)!;
        const echo = find(snap, 'bots', 'Amplify Bot+ — Echoing Shot')!;
        expect(echo).toMatchObject({ fromLv: 2, toLv: 3, cost: 500, costType: 'medals' });
        expect(edpsScore(snapshot(report, s => plus(s, 3)), snap.edps)).toBeCloseTo(1 + 0.01 * (6 / 5 - 1), 9);
        expect(echo.scorePct).toBeGreaterThan(0);
        const cells = find(snap, 'bots', 'Golden Bot+ — Bonus Cells')!;
        expect(cells).toMatchObject({ fromLv: 24, toLv: 25, cost: 1300 });
        expect(cells.scorePct).toBeCloseTo(0, 9);
        expect(find(snap, 'bots', 'Bot Bot+ — Maximum Power')).toBeUndefined();     // Bot+ not unlocked
        const maxed = snapshot(report, s => plus(s, 9));
        expect(find(maxed, 'bots', 'Amplify Bot+ — Echoing Shot')).toBeUndefined();
    });

    it('prices module slot levels in shards and coins (wiki Modules/Cost)', () => {
        const slot = find(snapshot(), 'modules', 'Cannon — Main slot')!;
        expect(slot).toMatchObject({ fromLv: 0, toLv: 5, cost: 35, coins: 50000, costType: 'shards' });
        const labbed = find(snapshot(null, s => { s.labData = { 'Module Shard Cost': 30 }; }), 'modules', 'Cannon — Main slot')!;
        expect(labbed.cost).toBeCloseTo(35 * 0.7, 9);
    });

    it('fills an empty card slot for free, then prices the next slot in gems', () => {
        const cards = (preset: string[]) => snapshot(run(), s => {
            s.cardData = { data: { Damage: { s: 7, m: 0 }, 'Attack Speed': { s: 3, m: 0 } }, slots: 2, presets: { 0: preset } };
        });
        const empty = buildCandidates(cards(['Damage']), 'cards');
        expect(empty.map(c => [c.label, c.cost])).toEqual([['Attack Speed Card', 0]]);
        // A card only counts while it's equipped (Critical Chance used to count anyway).
        const crit = (preset: string[]) => snapshot(null, s => {
            s.cardData = { data: { 'Critical Chance': { s: 4, m: 0 } }, slots: 1, presets: { 0: preset } };
        });
        expect(buildCandidates(crit([]), 'cards')[0].scorePct).toBeGreaterThan(0);
        const full = buildCandidates(cards(['Damage', 'Coins']), 'cards').find(c => c.label === 'Attack Speed Card')!;
        expect(full).toMatchObject({ cost: 100, costType: 'gems', toLv: 3 });  // slot 3 is 100 gems
    });

    it('prices enhancements from the game table, 10 levels a step on the 400-level ones', () => {
        const snap = snapshot(null, s => {
            s.enhData = { d: { attack: [0] }, u: { attack: [true] } };
            s.labData['Workshop Enhancement'] = 1;    // enhancements open with this lab
        });
        const dmg = find(snap, 'enhancements', 'Enh Attack — Damage')!;
        expect(dmg.toLv).toBe(10);
        expect(dmg.cost / 55.54e9).toBeCloseTo(1, 3);        // levels 1–10: 5B, 5.04B, … (wiki)
    });

    // A new account (engine/unlocks): only the workshop groups it bought, no
    // labs before Tier 1 wave 30, no enhancements before the lab.
    it('offers only what the account has unlocked', () => {
        const snap = snapshot(null, s => {
            s.enhData = { d: { attack: [0] }, u: { attack: [true] } };
            s.labData = {};
            s.wsData[s.presetIdx].attack = s.wsData[s.presetIdx].attack.map(() => 0);
        });
        snap.wsUnlocked = { attack: 1, defense: 1, utility: 2 };
        snap.progress = { tierWaves: { 1: 26 }, completedTier: 0 };
        const ws = buildCandidates(snap, 'workshop').filter(c => c.label.startsWith('WS Attack')).map(c => c.label.replace('WS Attack — ', ''));
        expect(ws).toContain('Range');
        expect(ws).not.toContain('Multishot Chance');
        expect(buildCandidates(snap, 'labs')).toEqual([]);
        expect(buildCandidates(snap, 'enhancements')).toEqual([]);
        snap.progress = { tierWaves: { 1: 30 }, completedTier: 0 };
        const labs = buildCandidates(snap, 'labs').map(c => c.label);
        expect(labs).toContain('Damage Lab');
        expect(labs).not.toContain('Labs Speed');              // Tier 1, wave 150
    });

    it('blends coins and push by the coin weight', () => {
        const report = run();
        const base = snapshot(report);
        base.farm = buildFarmCalibration(base, report);
        base.edps = buildEdpsCalibration(base, report)!;
        const after = snapshot(report, s => { s.uwData.data.CL!.sv[0] = 11; });
        Object.assign(after, { farm: base.farm, edps: base.edps });
        const score = (s: OptimizerSnapshot, coinWeight: number) =>
            goalScore({ ...s, blend: { push: 'waves', coinWeight } });
        const pushGain = score(after, 0) / score(base, 0);
        const coinGain = score(after, 1) / score(base, 1);
        expect(pushGain).toBeCloseTo(edpsSurvivalScore(after, base.edps) / edpsSurvivalScore(base, base.edps), 9);
        expect(score(after, 0.5) / score(base, 0.5)).toBeCloseTo(Math.sqrt(pushGain * coinGain), 9);
    });

    it('values a budget along a ranked path, part-paid steps in proportion', () => {
        const step = (cost: number, scorePct: number) => ({
            category: 'uw' as const, label: '', subLabel: '', fromLv: 0, toLv: 1,
            cost, costType: 'stones' as const, scorePct, scorePerCost: scorePct / cost,
        });
        const path = [step(10, 10), step(10, 10)];
        expect(pathGain(path, 0, 10)).toBeCloseTo(10, 9);
        expect(pathGain(path, 5, 10)).toBeCloseTo(10, 9);     // half of each step
        expect(pathGain(path, 0, 30)).toBeCloseTo(21, 9);     // the path runs out
    });

    it('spends medals on Event Shop trades when bots give nothing, dearer each trade', () => {
        const stonePath = Array.from({ length: 20 }, () => ({
            category: 'uw' as const, label: 'x', subLabel: '', fromLv: 0, toLv: 1,
            cost: 15, costType: 'stones' as const, scorePct: 1, scorePerCost: 1 / 15,
        }));
        const rows = simulateMedalPath(5, snapshot(), stonePath, 0, {});
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ label: 'Event Shop — 15 Stones', subLabel: 'Trades 1–5 this event' });
        expect(rows[0].cost).toBe(40 + 65 + 90 + 130 + 175);
    });

    // Shards come in the type picked, and the shards of it already held
    // go first: Armor's next 1,000 are worth less than Cannon's first.
    const shardStep = (cost: number, scorePct: number) => ({
        category: 'modules' as const, label: 'x', subLabel: '', fromLv: 0, toLv: 5,
        cost, costType: 'shards' as const, scorePct, scorePerCost: scorePct / cost,
    });
    const shardPaths = { cannon: [shardStep(1000, 5)], armor: [shardStep(1000, 5), shardStep(1000, 3)] };

    it('trades medals for the shard type worth most after the shards held', () => {
        const rows = simulateMedalPath(6, snapshot(), [], 0, shardPaths, { armor: 1000 });
        expect(rows.map(r => [r.label, r.subLabel])).toEqual([
            ['Event Shop — 250 Cannon Shards', 'Trades 1–4 this event'],
            ['Event Shop — 250 Armor Shards', 'Trades 5–6 this event'],
        ]);
        expect(rows[0].ref).toEqual(['trade', 'shards', 'cannon']);
    });

    it('values each type’s held shards and the next 1,000', () => {
        const values = shardTypeValues({ ...shardPaths, generator: [], core: [] }, { armor: 1000 });
        const armor = values.find(v => v.type === 'armor')!;
        expect(armor.held).toBe(1000);
        expect(armor.heldPct).toBeCloseTo(5, 9);
        expect(armor.next1kPct).toBeCloseTo(3, 9);
        expect(values.find(v => v.type === 'cannon')!.heldPct).toBe(0);
        expect(values.find(v => v.type === 'cannon')!.next1kPct).toBeCloseTo(5, 9);
        expect(values.find(v => v.type === 'core')!.next1kPct).toBe(0);
    });
});

describe('stone path', () => {
    it('only recommends upgrades worth at least the minimum gain', () => {
        const report = run();
        const snap = snapshot(report);
        snap.edps = buildEdpsCalibration(snap, report)!;
        const path = simulateStonePath(60, snap);
        expect(path.length).toBeGreaterThan(0);
        for (const c of path) expect(c.scorePct).toBeGreaterThanOrEqual(GC_SCORING.minGainPct);
    });
});

// eHP: survival, with Enemy Attack Level Skip at the survival a point is
// worth in waves (runLength.skipWorth on the attack model), and the attack
// labs of the enemy types that end runs.
describe('survival score (eHP)', () => {
    const ehpSnap = (edit?: (s: OptimizerSnapshot) => void) => snapshot(null, s => {
        s.metric = 'ehp';
        s.wsData[0].defense[WS_STATS.defense.findIndex(([n]) => n === 'Health')] = 500;
        s.ehp = buildEhpCalibration(s, null);
        edit?.(s);
    });
    const atkIdx = WS_STATS.utility.findIndex(([n]) => n === 'Enemy Atk Level Skip');

    it('counts Enemy Attack Level Skip once it’s worth something', () => {
        const before = ehpSnap(s => { s.skipWorth = 0.2; });
        const after = ehpSnap(s => { s.skipWorth = 0.2; s.wsData[0].utility[atkIdx] = 99; });
        // 99 workshop levels: 0.05 × 100 = 5 points → e^(0.2 × 5)
        expect(goalScore(after) / goalScore(before)).toBeCloseTo(Math.exp(0.2 * 5), 6);
        const unscored = ehpSnap(s => { s.wsData[0].utility[atkIdx] = 99; });
        expect(goalScore(unscored) / goalScore(ehpSnap())).toBeCloseTo(1, 9);
    });

    it('counts the attack labs of the enemies that end runs, by their share', () => {
        const killers = { Ranged: 0.75, Basic: 0.25 };
        const before = ehpSnap(s => { s.killers = killers; });
        const after = ehpSnap(s => { s.killers = killers; s.labData = { 'Ranged Enemy Attack': 10 }; });
        // 10 levels take 4% off Ranged attack: (1 / 0.96)^0.75
        expect(goalScore(after) / goalScore(before)).toBeCloseTo((1 / 0.96) ** 0.75, 6);
    });

    it('ranks the attack skip workshop step when it’s scored', () => {
        const snap = ehpSnap(s => { s.skipWorth = 0.2; });
        const step = buildCandidates(snap, 'workshop').find(c => c.label.includes('Enemy Atk Level Skip'))!;
        expect(step.scorePct).toBeGreaterThan(0);
        expect(step.skipPoints).toBeGreaterThan(0);
    });
});

// Bot+ unlocks: 1,250 stones each once all five bots are owned; only an
// ability a model reads gains anything (Echoing Shot: tower shots × bullets).
describe('Bot+ unlocks in the stone path', () => {
    const allBots = Object.fromEntries(BOTS_CONFIG.map(b => [b.name, { owned: true, medals: [0, 0, 0, 0], plusLv: 0 }]));

    it('offers each locked Bot+ for 1,250 stones once every bot is owned', () => {
        const report = run({ ProjectilesDamage: 300, OrbDamage: 510 });
        const snap = snapshot(report, s => { s.botData = JSON.parse(JSON.stringify(allBots)); });
        snap.edps = buildEdpsCalibration(snap, report)!;
        const rows = buildCandidates(snap, 'botplus');
        expect(rows).toHaveLength(BOTS_CONFIG.length);
        expect(rows.every(r => r.cost === 1250 && r.costType === 'stones')).toBe(true);
        const echo = rows.find(r => r.label.startsWith('Amplify Bot+'))!;
        expect(echo.scorePct).toBeGreaterThan(0);      // tower shots count as 3 bullets
        expect(rows.find(r => r.label.startsWith('Golden Bot+'))!.scorePct).toBeCloseTo(0, 9);
    });

    it('offers none until all five bots are owned, or once unlocked', () => {
        const some = snapshot(null, s => { s.botData = { 'Amplify Bot': { owned: true, medals: [], plusLv: 0 } }; });
        expect(buildCandidates(some, 'botplus')).toEqual([]);
        const unlocked = snapshot(null, s => {
            s.botData = JSON.parse(JSON.stringify(allBots));
            s.botData['Amplify Bot'] = { ...s.botData['Amplify Bot'], plusOwned: true };
        });
        expect(buildCandidates(unlocked, 'botplus').map(r => r.ref?.[0])).not.toContain('Amplify Bot');
    });
});
