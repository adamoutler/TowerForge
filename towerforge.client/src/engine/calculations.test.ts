// Tests for calculation helpers, anchored on numbers read off in-game
// screens (module cards, card values) so a formula change that breaks
// them shows up here.

import { describe, expect, it } from 'vitest';
import { calcCannonModuleMult, calcCritChance, calcModuleDamageMult, calcProjectileFactors, calcWorkshopDamageBase, primaryMainMult } from './towerDamage';
import { WS_DEFENSE_ABSOLUTE, WS_HEALTH, WS_HEALTH_REGEN } from '../constants/buildStatCurves';
import { activeLoadout, enhForPreset, masteredCardMult, milestoneReached, uniqueTier } from './statHelpers';
import { DEFAULT_RUN_RATES, runRatesFrom } from './runRates';
import { calcCFPlusHiddenSlow, calcCFSpeedReduction, calcCFUptime, calcEnemySpeedFactor, calcSlowAura } from './ttt';
import { baseEnemyDamage, baseEnemyHealth } from './enemyStats';
import { WS_MAX_RECOVERY } from '../constants/buildStatCurves';
import { parseGameExport } from './gameExport';
import { moduleMaxLevel } from '../constants/moduleRarities';
import { UNIQUE_MODULES } from '../constants/moduleData';
import type { CardData, Loadout, ModBonuses, ModuleEntry, ModuleRarity, ModuleState, ModuleType, UWData } from '../types/gameTypes';
import { battle, makeExport } from '../test/makeExport';
import { standardPerkValue } from './modBonuses';

const mod = (type: ModuleType, rarity: ModuleRarity, mainMult = 0): ModuleEntry =>
    ({ id: 'm', name: 'Test', type, rarity, subs: [], mainMult });

describe('module main effect (×value on the module card)', () => {
    // Real module cards: rarity + slot level → the ×value the card shows.
    it.each([
        ['cannon', 'A5', 217, 23.37],
        ['armor', 'A', 202, 16.24],
        ['generator', 'A5', 216, 2.476],
        ['core', 'A5', 216, 29.86],
    ] as const)('%s %s at Lv %i shows ×%f', (type, rarity, level, shown) => {
        expect(calcModuleDamageMult(mod(type, rarity), level)).toBeCloseTo(shown, 2);
    });

    it('stops at the rarity level cap', () => {
        const capped = calcModuleDamageMult(mod('cannon', 'A'), moduleMaxLevel('A'));
        expect(calcModuleDamageMult(mod('cannon', 'A'), moduleMaxLevel('A') + 50)).toBe(capped);
    });

    it('uses the ×value typed in from the card when there is one', () => {
        expect(calcModuleDamageMult(mod('cannon', 'L', 12.5), 100)).toBe(12.5);
        expect(calcModuleDamageMult(null, 100)).toBe(1);
    });
});

describe('module efficiency labs', () => {
    // Primary modules run at 100%; their lab (one per type, T23 W500) adds
    // 1% a level, up to 130%. Assist modules: 1% base, stones to 100%, +30% lab.
    const as = mod('cannon', 'A5');

    it('scale a primary module by 1 + (×value − 1) × (1 + lab%)', () => {
        const base = calcModuleDamageMult(as, 217);
        expect(primaryMainMult(as, 217, 'cannon', {})).toBe(base);
        expect(primaryMainMult(as, 217, 'cannon', { 'Primary-Cannon Mult': 30 })).toBeCloseTo(1 + (base - 1) * 1.3, 10);
        expect(primaryMainMult(as, 217, 'cannon', { 'Primary-Core Mult': 30 })).toBe(base);   // other type's lab
    });

    it("don't boost a ×value typed from the card (it already shows the lab)", () => {
        expect(primaryMainMult(mod('cannon', 'A5', 30), 217, 'cannon', { 'Primary-Cannon Mult': 30 })).toBe(30);
    });

    it('reach tower damage through the equipped cannon module', () => {
        const slots = { main: '', assist: '' };
        const state: ModuleState = {
            library: [{ ...as, id: 'p' }],
            loadouts: [{ id: 'l', name: 'l', slots: { cannon: { main: 'p', assist: '' }, armor: slots, generator: slots, core: slots } }],
            activeLoadout: 'l', assistData: {},
            slotLevels: { cannon: { main: 217, assist: 0 }, armor: { main: 0, assist: 0 }, generator: { main: 0, assist: 0 }, core: { main: 0, assist: 0 } },
        };
        const base = calcCannonModuleMult(state);
        expect(base).toBeCloseTo(23.37, 2);
        expect(calcCannonModuleMult(state, { 'Primary-Cannon Mult': 10 })).toBeCloseTo(1 + (base - 1) * 1.1, 10);
    });
});

describe('Chrono Field', () => {
    // Wiki: Speed Reduction 20–75% (Lv 1–12), capped at 90% with substats;
    // Duration 5–40s (+1s per CF-Duration lab level, +5s perk); Cooldown
    // 180–60s; a new field doesn't stack, so uptime tops out at 100%.
    const cf = (sv: [number, number, number], upLvl = -1): UWData => ({
        stones: 0, data: { CF: { own: true, sv, upOwn: upLvl >= 0, upLvl: Math.max(0, upLvl) } },
    });
    const bonuses = (cfBonus: Record<string, number> = {}, cfExtraDur = 0) =>
        ({ uwBonus: { CF: cfBonus }, perks: { cfExtraDur }, subs: {} }) as unknown as ModBonuses;
    const noCards: CardData = { data: {}, slots: 1, presets: {} };

    it('caps Speed Reduction at 90% with module substats', () => {
        expect(calcCFSpeedReduction(bonuses(), cf([1, 12, 1]))).toBeCloseTo(0.75, 10);
        expect(calcCFSpeedReduction(bonuses({ slow: 0.15 }), cf([1, 12, 1]))).toBeCloseTo(0.9, 10);
        expect(calcCFSpeedReduction(bonuses({ slow: 0.15 }), cf([1, 11, 1]))).toBeCloseTo(0.85, 10);
    });

    it('adds the duration lab and perk, and tops uptime out at 100%', () => {
        // Duration Lv 1 = 5s + 10 lab + 5 perk = 20s; Cooldown Lv 1 = 180s.
        const up = calcCFUptime(bonuses({}, 5), cf([1, 1, 1]), [], { 'CF-Duration': 10 }, noCards);
        expect(up).toBeCloseTo(20 / 180, 10);
        expect(calcCFUptime(bonuses(), cf([36, 1, 13]), [], { 'CF-Duration': 30 }, noCards)).toBe(1);
    });

    it('multiplies Slow Aura on top of Chrono Field, past 90% combined', () => {
        // 90% field × 31% aura → enemies keep 0.1 × 0.69 of their speed.
        expect(calcEnemySpeedFactor(0.9, 1, 0.31, 0)).toBeCloseTo(0.069, 10);
    });

    it('only slows and spirals enemies while the field is up', () => {
        // Half uptime: half the time at 0.2 × 0.69 × (1 − 0.2), half at 0.69.
        expect(calcEnemySpeedFactor(0.8, 0.5, 0.31, 0.2)).toBeCloseTo(0.5 * 0.2 * 0.69 * 0.8 + 0.5 * 0.69, 10);
        expect(calcEnemySpeedFactor(0.8, 0, 0.31, 0.65)).toBeCloseTo(0.69, 10);   // Chrono Loop needs the field
    });

    it('slows by Chrono Loop’s hidden slow: 5% per CF+ level, 2.5% at the unlock', () => {
        // Wiki (AdvancedAnalysis, "CF+speed" by priesten / yournicknm):
        // newEnemySpeed = enemySpeed × (1 − 0.05 × CF+ level) for levels 1–13;
        // their measured table has 2.5% at level 0, where the formula gives 0.
        expect(calcCFPlusHiddenSlow(cf([1, 1, 1], 0))).toBeCloseTo(0.025, 10);
        for (let lv = 1; lv <= 13; lv++) expect(calcCFPlusHiddenSlow(cf([1, 1, 1], lv))).toBeCloseTo(0.05 * lv, 10);
        expect(calcCFPlusHiddenSlow(cf([1, 1, 1]))).toBe(0);                       // CF+ not unlocked
        // Their example: speed 10 at level 13 → 3.5 (185.7% more time to close in).
        expect(10 * calcEnemySpeedFactor(0, 1, 0, calcCFPlusHiddenSlow(cf([1, 1, 1], 13)))).toBeCloseTo(3.5, 10);
    });

    it('counts Slow Aura only when equipped, without its attack-speed mastery', () => {
        const cards = (presets: string[], mu: boolean): CardData =>
            ({ data: { 'Slow Aura': { s: 7, m: 9, mu } }, slots: 1, presets: { 0: presets } });
        expect(calcSlowAura(cards(['Slow Aura'], false), 0)).toBeCloseTo(0.31, 10);
        expect(calcSlowAura(cards(['Slow Aura'], true), 0)).toBeCloseTo(0.31, 10);
        expect(calcSlowAura(cards([], false), 0)).toBe(0);
    });
});

describe('tournament enemy health', () => {
    it('grows ×1.65 at each hundred waves and ×1.004 a wave on top of the campaign bands', () => {
        const t = (w: number) => baseEnemyHealth(w, 18, true);
        expect(t(201) / t(200)).toBeGreaterThan(1.65);
        expect(t(150) / t(149)).toBeGreaterThan(1.004);
        expect(t(150) / t(149)).toBeLessThan(1.65);
    });

    it('leaves the campaign curve as it was', () => {
        expect(baseEnemyHealth(3360, 18)).toBe(baseEnemyHealth(3360, 18, false));
    });
});

describe('projectile hits per second', () => {
    const ws = (levels: Record<number, number>) => [{
        attack: Array.from({ length: 17 }, (_, i) => levels[i] ?? 0), defense: [], utility: [],
    }];
    const mods = { subs: {} } as unknown as ModBonuses;

    it('counts nothing extra without Multishot, Bounce Shot or Rapid Fire', () => {
        expect(calcProjectileFactors(0, ws({}), mods, 3)).toEqual({ multishot: 1, bounce: 1, rapid: 1 });
    });

    it('averages each chance at the workshop maxima (wiki values)', () => {
        // Multishot 49.5% for 9 targets; Bounce 68% up to 8 bounces; Rapid Fire 34% for 5.55 s.
        const f = calcProjectileFactors(0, ws({ 6: 99, 7: 7, 8: 85, 9: 99, 10: 85, 11: 7 }), mods, 3);
        expect(f.multishot).toBeCloseTo(1 + 0.495 * 8, 9);
        expect(f.bounce).toBeCloseTo((1 - 0.68 ** 9) / (1 - 0.68), 9);
        const rad = 0.34 * 3 * 5.55;
        expect(f.rapid).toBeCloseTo(1 + (3 * rad) / (1 + rad), 9);
        expect(f.rapid).toBeLessThan(4);                                    // ×4 at most, while it's up
    });

    it('adds module substats', () => {
        const withSubs = { subs: { 'Multishot Chance': 10, 'Multishot Targets': 2 } } as unknown as ModBonuses;
        expect(calcProjectileFactors(0, ws({ 7: 1 }), withSubs, 1).multishot).toBeCloseTo(1 + 0.1 * 4, 9);
    });
});

describe('Tier / Wave milestones', () => {
    // Labs, cards and assist slots unlock at "Tier X, Wave Y". Finishing a tier
    // only takes wave 100 (300 from Tier 15), so later milestones need the wave.
    const waves = { 5: 150, 19: 4527, 23: 197 };

    it('use the best wave reached on that tier', () => {
        expect(milestoneReached(5, 100, 22, waves)).toBe(true);
        expect(milestoneReached(5, 500, 22, waves)).toBe(false);    // Extra Black Hole: T5 W500
        expect(milestoneReached(19, 40, 22, waves)).toBe(true);     // assist modules: T19 W40
        expect(milestoneReached(23, 500, 22, waves)).toBe(false);   // primary module labs: T23 W500
        expect(milestoneReached(0, 0, 0, {})).toBe(true);
    });

    it('fall back to "tier completed" when no wave is recorded', () => {
        expect(milestoneReached(7, 900, 10, {})).toBe(true);
        expect(milestoneReached(11, 10, 10, {})).toBe(false);
    });
});

describe('unique effect tiers', () => {
    it('maps rarities to the tier unique effects scale with', () => {
        expect(uniqueTier('Ep')).toBe('Epic');
        expect(uniqueTier('Lp')).toBe('Legendary');
        expect(uniqueTier('M')).toBe('Mythic');
        expect(uniqueTier('A3')).toBe('Ancestral');
        expect(uniqueTier('R')).toBeNull();
    });

    it('Infinity Threshold goes 1000 / 2000 / 3000 / 4000', () => {
        const it_ = UNIQUE_MODULES.generator.find(([n]) => n === 'Infinity Threshold')!;
        expect(it_[2]).toEqual({ Epic: 1000, Legendary: 2000, Mythic: 3000, Ancestral: 4000 });
    });
});

describe('card mastery', () => {
    it('scales the card bonus, not the whole multiplier', () => {
        // Coins card ×1.45 with mastery ×1.30 → +45% × 1.3 = +58.5%.
        expect(masteredCardMult(1.45, 1.3)).toBeCloseTo(1.585, 10);
        expect(masteredCardMult(1.45, null)).toBe(1.45);
        expect(masteredCardMult(0, 1.3)).toBe(1);
    });
});

describe('presets and loadouts', () => {
    const lo = (id: string): Loadout => ({
        id, name: id,
        slots: { cannon: { main: '', assist: '' }, armor: { main: '', assist: '' }, generator: { main: '', assist: '' }, core: { main: '', assist: '' } },
    });
    const state = (activeLoadoutId?: string): ModuleState =>
        ({ library: [], loadouts: [lo('a'), lo('b')], activeLoadout: activeLoadoutId, assistData: {}, slotLevels: {} as ModuleState['slotLevels'] });

    it('calculates with the equipped loadout, else the first', () => {
        expect(activeLoadout(state('b'))!.id).toBe('b');
        expect(activeLoadout(state())!.id).toBe('a');
        expect(activeLoadout(state('gone'))!.id).toBe('a');
    });

    it("uses a preset's own enhancement levels when it has them", () => {
        const enh = { d: { attack: [1] }, u: {}, p: { 1: { attack: [9] } } };
        expect(enhForPreset(enh, 1).d.attack).toEqual([9]);
        expect(enhForPreset(enh, 0).d.attack).toEqual([1]);
    });
});

describe('run rates from a battle report', () => {
    it('falls back to typical values without a report', () => {
        expect(runRatesFrom(null)).toBe(DEFAULT_RUN_RATES);
    });

    it('turns battle counts into per-second rates and shares', () => {
        const [report] = parseGameExport(makeExport({
            BattleHistory: [battle({
                GameTime: 1000, Wave: 50, TotalEnemies: 8000,
                TotalBoss: 5, TotalCommanders: 3, TotalElites: 70, RecoveryPackages: 30,
                CashEarned: 1e10, EnemiesHitByChainLightningThisRound: 4000,
                EnemiesHitByPoisonSwampThisRound: 20000, DestroyedInBlackhole: 2000, OrbHits: 8000,
            })],
        })).battles;
        const r = runRatesFrom(report);
        expect(r.source).toBe('report');
        expect(r.waveSec).toBe(20);
        expect(r.killsPerSec).toBe(8);
        expect(r.bossFleetPerSec).toBeCloseTo(0.008, 10);
        expect(r.elitePerSec).toBeCloseTo(0.07, 10);
        expect(r.packagesPerSec).toBeCloseTo(0.03, 10);
        expect(r.cashDigits).toBeCloseTo(10, 10);
        expect(r.clHitsPerEnemy).toBe(0.5);
        expect(r.poisonedShare).toBe(1);        // capped at every enemy
        expect(r.bhShare).toBe(0.25);
        expect(r.orbHitsPerEnemy).toBe(1);
    });
});

describe('end of a T18 push (owner’s recording, 2026-10-19)', () => {
    // The tower sat at 288.79–289.58T on a 17.53T max: packages overheal to
    // Max Recovery × max health, and the workshop's max level gives 16.5.
    it('overheals to 16.5 × max health with Max Recovery maxed', () => {
        expect(WS_MAX_RECOVERY.valueAt(WS_MAX_RECOVERY.maxLevel)).toBeCloseTo(16.5, 10);
        expect(17.53 * 16.5).toBeCloseTo(289.2, 1);
    });

    // Every hit is lethal for Glass Cannon there: a basic enemy's attack at
    // W8881 (at the ~58% attack skip of the owner's runs) dwarfs the
    // overhealed tower — which is why only the wall and run savers stop one.
    it('enemy hits dwarf the overhealed tower', () => {
        const attack = baseEnemyDamage(Math.floor(8881 * (1 - 0.577)), 18);
        expect(attack / 289.2e12).toBeGreaterThan(1e6);
    });
});

// The game's workshop table, by way of TheTowerSDK.
describe('workshop stats at the game\'s values', () => {
    it('Damage follows the table at every band', () => {
        const table: [number, number][] = [
            [0, 3], [1, 5.877], [100, 1053], [999, 79646.277], [1000, 79803.08], [1500, 214842.53],
            [2066, 580238.07], [3000, 2340393.71], [4195, 11343084.3], [5000, 29049032.56], [6000, 71114385.08],
        ];
        for (const [level, value] of table) expect(calcWorkshopDamageBase(level) / value).toBeCloseTo(1, 5);
    });

    it('Critical Chance is the level plus 1%', () => {
        const at = (level: number) => calcCritChance(0, [{ attack: [0, 0, level], defense: [], utility: [] }], { data: {}, slots: 1, presets: { 0: [] } } as never, {});
        expect(at(0)).toBeCloseTo(0.01, 9);
        expect(at(40)).toBeCloseTo(0.41, 9);
        expect(at(79)).toBeCloseTo(0.80, 9);
    });

    it('a Damage level adds about what the table says, not 5.4%', () => {
        const perLevel = (level: number) => calcWorkshopDamageBase(level + 1) / calcWorkshopDamageBase(level) - 1;
        expect(perLevel(100)).toBeCloseTo(0.0174, 3);
        expect(perLevel(2000)).toBeCloseTo(0.00163, 4);
        expect(perLevel(4000)).toBeCloseTo(0.00128, 4);
    });

    it('Health, Regen and Defense Absolute are right at low levels', () => {
        const close = (got: number, want: number) => expect(got / want).toBeCloseTo(1, 2);
        close(WS_HEALTH.valueAt(0), 5);
        close(WS_HEALTH.valueAt(60), 5354);
        close(WS_HEALTH.valueAt(150), 65402);
        close(WS_HEALTH.valueAt(6000), 6.709e9);
        close(WS_HEALTH_REGEN.valueAt(60), 79.469);
        close(WS_HEALTH_REGEN.valueAt(1), 0.04);
        close(WS_DEFENSE_ABSOLUTE.valueAt(50), 191.67);
        close(WS_DEFENSE_ABSOLUTE.valueAt(1), 0.505);
    });
});

describe('perk values (the game’s Auto Pick list, owner 2026-11-02)', () => {
    // One pick each at Standard Perk Bonus 25; the list rounds to 2 places.
    it.each([
        ['All Coin Bonuses', 0.15, 1.44],
        ['Max Health', 0.2, 1.5],
        ['Health Regen', 0.75, 2.19],
    ] as const)('x%s shows %f', (_, base, shown) => {
        expect(standardPerkValue(base, 1, 25)).toBeCloseTo(shown, 2);
    });

    it('scales the additive ones too: +6.25% free upgrades, +1.25 game speed', () => {
        expect(standardPerkValue(5, 1, 25, true)).toBeCloseTo(6.25, 10);
        expect(standardPerkValue(1, 1, 25, true)).toBeCloseTo(1.25, 10);
        expect(standardPerkValue(0.2, 1, 25, true)).toBeCloseTo(0.25, 10);   // Perk Wave Requirement −25%
    });
});
