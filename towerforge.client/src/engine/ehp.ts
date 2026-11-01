// ============================================================
//  TowerForge Companion — eHP (Survival) Model
//  Scores upgrades by how much raw enemy damage the tower can
//  absorb, for builds that don't rely on dealing damage (except thorns).
//
//  Survival = √(eHP × (eHP + SUSTAIN_WINDOW_S × eRegen)) × thorns factor
//    eHP    = (Pool / (1 − CF) + DefAbs) / (1 − Def%)        (wiki formula)
//             Pool = tower max health × Max Recovery (package overheal)
//                  + wall health (+ fortification)
//    eRegen = (Regen + Wall Regen + Packages/s) / ((1 − CF)(1 − Def%))
//    CF     = Chrono Field damage reduction × CF uptime
//  A tower dies two ways: one hit bigger than its effective HP, or a
//  minute of pressure bigger than its effective HP plus a minute of
//  effective healing. Survival is the geometric mean of the two, so a
//  regen-heavy tower still values health (and vice versa). Defense %
//  scales both, which matches how it works in game.
//
//  Thorns kill attackers, which cuts incoming damage — weighted by the
//  share of kills thorns actually makes (from the Battle Report).
//
//  Orbs destroy most enemies they touch before those reach the tower
//  (2026-10-23): the run's orb kills give the touches an enemy they can
//  touch expects (λ = −ln(1 − kills ÷ touchable), as in edps.ts), λ grows
//  with orbs × speed × size (engine/orbs.ts), and the enemies that reach
//  the tower — (1 − touchable) + touchable·e^−λ — hit it, so fewer of them
//  is that much more survival. The code's model.
//
//  Module unique effects that cut the damage the tower takes (Harmony
//  Conductor, Negative Mass Projector, Primordial Collapse) divide
//  both eHP and eRegen by the share of damage that still lands.
//
//  Lifesteal and Death Wave healing (they follow the tower's damage, not
//  its defenses) heal at the rate the chosen run shows, the same before
//  and after an upgrade — on eHP players' runs lifesteal was a fifth to a
//  third of all healing (2026-10-23).
//
//  Flame Bot and Chain Thunder (2026-10-23) cut the damage that's left
//  after Defense % and Chrono Field (the game's order, TheTowerSDK
//  damage-redux-layers). The run says how much each cut —
//  blocked ÷ what reached that layer — and that, against what the
//  upgrade gives now, is the share of hits it covers:
//    Flame Bot: Damage Reduction 20% + 3% a level (bot table), on the
//      enemies it has burned — coverage = cut ÷ reduction.
//    Chain Thunder (lab "CL-Chain Thunder"): min(CL's share of the
//      damage × 10% per 6%, 3% a level, 90%) — the lab's own wording,
//      coverage = cut ÷ that.
//  An upgrade moves the cut by its coverage. On eHP players' runs they
//  cut up to 47% and 19% (docs/run-simulation.md).
//
//  Not modeled: Death Defy, Energy Shield, Second Wind, knockback and
//  land mines.
//
//  Pure functions — no store imports.
// ============================================================

import { WS_STATS, WS_ENH } from '../constants/gameData';
import {
    DEFENSE_PCT_CAP, labValue,
    WS_HEALTH, WS_HEALTH_REGEN, WS_DEFENSE_ABSOLUTE, WS_DEFENSE_PCT, WS_THORNS, WS_WALL_HEALTH,
    WS_RECOVERY_AMOUNT, WS_MAX_RECOVERY,
} from '../constants/buildStatCurves';
import { calcCFUptime, packageChancePct } from './ttt';
import { calcModuleDamageMult, primaryMainMult, PRIMARY_EFF_LAB } from './towerDamage';
import { activeCard as activeCardIn, activeLoadout, cardValue, labMult as labMultIn, masteredCardMult } from './statHelpers';
import {
    uniq, sharpFortitudeMult, harmonyConductorReduction, negativeMassReduction, primordialCollapseReduction,
} from './moduleEffects';
import type { BattleReport } from './battleReport';
import { dissonanceFactor } from './dissonance';
import type { OptimizerSnapshot } from './optimizer';
import { runMix } from './battleConditions';
import { botStatValue, touchesOf } from './edps';
import { deathRayRate, orbStats } from './orbs';

// Seconds of sustained pressure the score weighs healing over.
export const SUSTAIN_WINDOW_S = 60;
// Default wave length when there's no Battle Report.
const DEFAULT_WAVE_S = 20;
// Default share of kills made by thorns when there's no Battle Report.
const DEFAULT_THORNS_SHARE = 0.3;

// One line of a stat's breakdown: a base value, a multiplier, or an addition.
export interface EhpFactor {
    label: string;
    value: number;
    op: 'base' | 'x' | '+';
    note?: string;
}

export interface EhpParts {
    health: EhpFactor[];
    regen: EhpFactor[];
    defAbs: EhpFactor[];
    defPct: EhpFactor[];   // percentage points, before the 98% cap
    damageTaken: EhpFactor[];   // share of enemy damage that still lands (base 1)
}

export interface EhpInputs {
    parts: EhpParts;
    health: number;          // tower max health (incl. Death Wave bonus at its cap)
    maxRecovery: number;     // packages overheal the tower up to this × max health (1 = no packages)
    armorMainMissing: boolean;  // an Armor module is equipped but its slot level isn't set
    wallPool: number;        // wall health (incl. fortification overheal)
    defAbs: number;
    defPct: number;          // 0–0.98
    defPctUncapped: number;  // before the 98% cap, for display
    cfReduction: number;     // Chrono Field reduction × uptime (0–1)
    regen: number;           // tower regen / s
    wallRegen: number;       // wall regen / s
    pkgChance: number;       // packages per wave (0–1)
    pkgAmount: number;       // fraction of max health healed per package
    thorns: number;          // fraction of the attacker's max health per hit
    damageTaken: number;     // share of enemy damage that still lands after module effects (0–1)
    orbRate?: number;        // orbs × speed × size (engine/orbs.ts)
    deathRayRate?: number;   // beam time × (1 + Double Death Ray chance)
    flameReduction?: number; // Flame Bot's Damage Reduction at its level (0 when not owned)
    chainThunderCap?: number; // Chain Thunder lab: 3% a level, at most 90%
}

export interface EhpCalibration {
    source: 'report' | 'estimate';
    anchor: EhpInputs;
    thornsShare: number;     // share of kills made by thorns
    packagesPerSec: number;  // observed package rate at the anchor
    waveSec: number;
    otherHealPerSec?: number; // lifesteal + Death Wave healing per second in the run
    // Orbs in the run: share of all enemies they destroyed, and the share
    // they can touch (not bosses, elites, fleets).
    orbKills?: number;
    deathRayKills?: number;
    touchable?: number;
    // Flame Bot and Chain Thunder: the share of the hits each covers
    // (the run's cut ÷ what the upgrade gave), and CL's share of the damage.
    flameCover?: number;
    chainThunderCover?: number;
    clShare?: number;
}

export interface EhpBreakdown {
    eHP: number;
    eRegen: number;          // effective healing per second
    survival: number;        // √(eHP × (eHP + window × eRegen)), before thorns
}

const productOf = (list: EhpFactor[]) => list.reduce((p, f) => (f.op === 'base' ? f.value : p * f.value), 0);

// ── Inputs from the tower state ───────────────────────────────
export function readEhpInputs(snap: OptimizerSnapshot): EhpInputs {
    const lab = snap.labData;
    const ws = snap.wsData[snap.presetIdx];
    const card = (name: string) => activeCardIn(snap.cardData, snap.presetIdx, name);
    const labMult = (name: string, neutral: number) => labMultIn(lab, name, neutral);
    const wsLv = (cat: 'defense' | 'utility', name: string) =>
        ws?.[cat]?.[WS_STATS[cat].findIndex(([n]) => n === name)] ?? 0;
    const enh = (cat: 'defense' | 'utility', name: string) => {
        const idx = WS_ENH[cat].findIndex(([n]) => n === name);
        const owned = snap.enhData?.u?.[cat]?.[idx] ?? false;
        return owned ? 1 + 0.01 * (snap.enhData?.d?.[cat]?.[idx] ?? 0) : 1;
    };
    const relic = (key: string) => snap.relicData[key] ?? 0;

    // Perks — like the rest of the app, every perk that isn't banned counts as taken.
    const banned = new Set(snap.perkData.banned ?? []);
    const spb = (lab['Standard Perk Bonus'] ?? 0) / 100;
    const tradeoffLab = (lab['Improve Tradeoff Perks'] ?? 0) / 100;
    const perkMult = (id: string, base: number) => (banned.has(id) ? 1 : (1 + base * 5) * (1 + spb));
    const taken = (id: string) => !banned.has(id);

    // Armor sub-effects (main slot at full value, assist at its substat efficiency).
    const mb = snap.modBonuses;
    const subs = mb.subs ?? {};
    const sub = {
        regenPct: subs['Health Regen'] ?? 0,
        defPts: subs['Defense'] ?? 0,
        defAbsPct: subs['Defense Absolute'] ?? 0,
        thornPts: subs['Thorns Damage'] ?? 0,
        wallPts: subs['Wall Health'] ?? 0,
    };
    const sharpFortitude = sharpFortitudeMult(mb);

    // Each stat records the factors it's built from, so the Survival panel
    // can show them line by line for comparison with the game.
    const parts: EhpParts = { health: [], regen: [], defAbs: [], defPct: [], damageTaken: [] };
    const mult = (list: EhpFactor[], label: string, value: number, note?: string) => {
        if (value !== 1) list.push({ label, value, op: 'x', note });
    };
    const add = (list: EhpFactor[], label: string, value: number, note?: string) => {
        if (value !== 0) list.push({ label, value, op: '+', note });
    };
    const lvNote = (name: string) => `Lv ${lab[name] ?? 0}`;
    const PERK_NOTE = 'counted at 5 picks unless banned on the Perks tab';
    const TRADEOFF_NOTE = 'counted unless banned on the Perks tab';

    // Health
    const hLv = wsLv('defense', 'Health');
    parts.health.push({ label: `Workshop Lv ${hLv}`, value: WS_HEALTH.valueAt(hLv), op: 'base' });
    mult(parts.health, 'Health Lab', labMult('Health Lab', 1), lvNote('Health Lab'));
    const hCard = card('Health');
    if (hCard) {
        const card = cardValue('Health', hCard.stars);
        mult(parts.health, `Health card ${hCard.stars}★`, card);
        if (hCard.mastery != null) {
            mult(parts.health, 'Health mastery', masteredCardMult(card, hCard.mastery) / card,
                `×${hCard.mastery} on the card's bonus → card ×${masteredCardMult(card, hCard.mastery).toFixed(2)}`);
        }
    }
    mult(parts.health, 'Health enhancement', enh('defense', 'Health'));
    mult(parts.health, 'Relics', 1 + relic('rHP') / 100);
    mult(parts.health, 'Dissonant Boost', dissonanceFactor(snap, 'defense'), snap.dissonance && (snap.dissonance.tier ? `Defense, Boost + Echo on T${snap.dissonance.tier}` : 'Defense, Echo only in tournaments'));
    mult(parts.health, 'Perk: Max Health ×1.20', perkMult('health', 0.2), PERK_NOTE);
    if (taken('to_regen')) mult(parts.health, 'Trade-off: Regen ×8 / Max Health −60%', 0.4, TRADEOFF_NOTE);
    if (taken('to_coins')) mult(parts.health, 'Trade-off: Coins ×1.8 / Max Health −70%', 0.3, TRADEOFF_NOTE);
    // Armor module main effect: ×Tower Health, auto-calculated from rarity and
    // the Armor slot level (Loadouts tab) like Cannon/Core, unless a ×value is
    // typed on the module. The assist slot gives 1 + (×value − 1) × its Mult
    // Efficiency (multiplicative since v27.1).
    const armorSlots = activeLoadout(snap.moduleState)?.slots.armor;
    const armorLv = snap.moduleState.slotLevels?.armor ?? { main: 0, assist: 0 };
    const armorMain = snap.moduleState.library.find(m => m.id === armorSlots?.main);
    const armorAssist = snap.moduleState.library.find(m => m.id === armorSlots?.assist);
    const lvLabel = (lv: number, override?: number) => (override ? 'from the module card' : `slot Lv ${lv}`);
    if (armorMain) {
        const effLab = snap.labData[PRIMARY_EFF_LAB.armor] ?? 0;
        const how = lvLabel(armorLv.main, armorMain.mainMult) + (effLab > 0 && !armorMain.mainMult ? `, +${effLab}% efficiency lab` : '');
        mult(parts.health, `Armor module: ${armorMain.name}`, primaryMainMult(armorMain, armorLv.main, 'armor', snap.labData), how);
    }
    const armorAd = snap.moduleState.assistData['armor'];
    if (armorAssist && armorAd && armorAd.rarity !== 'locked') {
        const eff = Math.min(1.3, (armorAd.multEff ?? 0) / 100);
        const assistMult = calcModuleDamageMult(armorAssist, armorLv.assist);
        mult(parts.health, `Armor assist: ${armorAssist.name}`, 1 + (assistMult - 1) * eff, `${armorAd.multEff ?? 0}% Mult Efficiency, ${lvLabel(armorLv.assist, armorAssist.mainMult)}`);
    }
    // Equipped but its slot level was never set (and no ×value typed) → likely undercounted.
    const armorMainMissing = !!armorMain && !armorMain.mainMult && armorLv.main <= 1;
    if (snap.uwData.data.DW?.own) {
        // The DW-Health lab value is the cap on the total multiplier (500% → ×5,
        // max 1250% → ×12.5), not a bonus on top.
        mult(parts.health, 'Death Wave health bonus', labMult('DW-Health', 500) / 100,
            'grows +0.05% per Death Wave kill — assumes it has reached its cap (×5, up to ×12.5 with the DW-Health lab), as in long runs');
    }
    const health = productOf(parts.health);

    // Regen
    const rLv = wsLv('defense', 'Health Regen');
    parts.regen.push({ label: `Workshop Lv ${rLv}`, value: WS_HEALTH_REGEN.valueAt(rLv), op: 'base' });
    mult(parts.regen, 'Health Regen Lab', labMult('Health Regen Lab', 1), lvNote('Health Regen Lab'));
    const rCard = card('Health Regen');
    if (rCard) {
        const card = cardValue('Health Regen', rCard.stars);
        mult(parts.regen, `Health Regen card ${rCard.stars}★`, card);
        if (rCard.mastery != null) {
            mult(parts.regen, 'Health Regen mastery', masteredCardMult(card, rCard.mastery) / card,
                `×${rCard.mastery} on the card's bonus → card ×${masteredCardMult(card, rCard.mastery).toFixed(2)}`);
        }
    }
    mult(parts.regen, 'Health Regen enhancement', enh('defense', 'Health Regen'));
    mult(parts.regen, 'Relics', 1 + relic('rRegen') / 100);
    mult(parts.regen, 'Perk: Health Regen ×1.75', perkMult('hregen', 0.75), PERK_NOTE);
    mult(parts.regen, 'Armor sub-effects', 1 + sub.regenPct / 100);
    if (taken('to_regen')) mult(parts.regen, 'Trade-off: Regen ×8 / Max Health −60%', 8 * (1 + tradeoffLab), TRADEOFF_NOTE);
    if (taken('to_enemyhp')) mult(parts.regen, 'Trade-off: Enemy HP −50% / Regen −90%', 0.1, TRADEOFF_NOTE);
    const regen = productOf(parts.regen);

    // Defense Absolute
    const daLv = wsLv('defense', 'Defense Absolute');
    parts.defAbs.push({ label: `Workshop Lv ${daLv}`, value: WS_DEFENSE_ABSOLUTE.valueAt(daLv), op: 'base' });
    mult(parts.defAbs, 'Defense Absolute Lab', labMult('Defense Absolute Lab', 1), lvNote('Defense Absolute Lab'));
    const fCard = card('Fortress');
    if (fCard) mult(parts.defAbs, `Fortress card ${fCard.stars}★`, cardValue('Fortress', fCard.stars));
    mult(parts.defAbs, 'Defense Absolute enhancement', enh('defense', 'Defense Absolute'));
    mult(parts.defAbs, 'Relics', 1 + relic('rDefAbs') / 100);
    // The game shows this perk at ×1.75 (5 picks) — Standard Perk Bonus doesn't boost it.
    mult(parts.defAbs, 'Perk: Defense Absolute ×1.15', banned.has('absdef') ? 1 : 1 + 0.15 * 5, 'counted at 5 picks unless banned on the Perks tab; Standard Perk Bonus doesn’t apply');
    mult(parts.defAbs, 'Armor sub-effects', 1 + sub.defAbsPct / 100);
    const defAbs = productOf(parts.defAbs);

    // Defense % (additive sources, capped at 98%)
    const defLv = wsLv('defense', 'Defense %');
    add(parts.defPct, `Workshop Lv ${defLv}`, defLv > 0 ? WS_DEFENSE_PCT.valueAt(defLv) : 0);
    add(parts.defPct, 'Defense % Lab', labValue('Defense % Lab', lab['Defense % Lab'] ?? 0), lvNote('Defense % Lab'));
    const dCard = card('Extra Defense');
    if (dCard) {
        add(parts.defPct, `Extra Defense card ${dCard.stars}★`, cardValue('Extra Defense', dCard.stars));
        if (dCard.mastery != null) add(parts.defPct, 'Extra Defense mastery', dCard.mastery);
    }
    if (taken('defpct')) add(parts.defPct, 'Perk: Defense % +4', 4 * 5 * (1 + spb), PERK_NOTE);
    add(parts.defPct, 'Armor sub-effects', sub.defPts);
    add(parts.defPct, 'Relics', relic('rDefPct'));
    const defPctUncapped = parts.defPct.reduce((sum, f) => sum + f.value, 0);
    const defPct = Math.min(DEFENSE_PCT_CAP, defPctUncapped) / 100;

    // Chrono Field damage reduction, only while CF is up.
    const cfUnlocked = (lab['CF-Dmg Reduction(unlock)'] ?? 0) >= 1;
    const cfReduction = cfUnlocked
        ? (labValue('CF-Reduction %', lab['CF-Reduction %'] ?? 0) / 100)
            * calcCFUptime(snap.modBonuses, snap.uwData, snap.wsData, snap.labData, snap.cardData, snap.presetIdx)
        : 0;

    // Wall: an extra pool of health (a % of tower health) in front of the tower.
    const wallLv = wsLv('defense', 'Wall Health');
    let wallPool = 0;
    let wallRegen = 0;
    if (wallLv > 0) {
        const wallFrac = (WS_WALL_HEALTH.valueAt(wallLv) + labValue('Wall Health Lab', lab['Wall Health Lab'] ?? 0) + sub.wallPts) / 100;
        const wallHealth = health * wallFrac * enh('defense', 'Wall Health') * sharpFortitude;
        wallRegen = regen * (labValue('Wall Regen', lab['Wall Regen'] ?? 0) / 100) * sharpFortitude;
        const fortification = wallRegen > 0 ? labValue('Wall Fortification', lab['Wall Fortification'] ?? 0) / 100 : 0;
        wallPool = wallHealth * (1 + fortification);
    }

    // Recovery packages (workshop, lab, card and Package Chance sub-effects)
    const pkgChance = packageChancePct(snap.presetIdx, snap.wsData, lab, snap.cardData, mb) / 100;
    const amountLv = wsLv('utility', 'Recovery Amount');
    const pkgAmount = ((amountLv > 0 ? WS_RECOVERY_AMOUNT.valueAt(amountLv) : 0)
        + labValue('Recovery Pkg Amount', lab['Recovery Pkg Amount'] ?? 0)) / 100
        * enh('utility', 'Recovery Package') * (1 + relic('rRecov') / 100);
    // Packages heal past max health up to Max Recovery × max health; regen
    // and lifesteal can't. Per the wiki, use that overhealed health for eHP
    // when packages keep you topped up.
    const maxLv = wsLv('utility', 'Max Amount');
    const maxRecovery = pkgChance > 0
        ? (maxLv > 0 ? WS_MAX_RECOVERY.valueAt(maxLv) : 1)
            * (1 + labValue('Recovery Pkg Max', lab['Recovery Pkg Max'] ?? 0) / 100)
            * enh('utility', 'Recovery Package')
        : 1;

    // Thorns: % of the attacker's max health per hit.
    const thornLv = wsLv('defense', 'Thorn Damage');
    const thorns = ((thornLv > 0 ? WS_THORNS.valueAt(thornLv) : 0) + sub.thornPts + relic('rThorns')) / 100;

    // Unique effects that cut the damage that lands (moduleEffects.ts).
    const cut = (label: string, reduction: number, note: string) => {
        if (reduction > 0) parts.damageTaken.push({ label, value: 1 - reduction, op: 'x', note });
    };
    cut('Harmony Conductor', harmonyConductorReduction(mb),
        `poisoned enemies miss ${uniq(mb, 'Harmony Conductor')}% of attacks × ${(mb.run.poisonedShare * 100).toFixed(0)}% of enemies poisoned`);
    cut('Negative Mass Projector', negativeMassReduction(mb),
        `−${uniq(mb, 'Negative Mass Projector')}% enemy damage per orb hit × ${mb.run.orbHitsPerEnemy.toFixed(2)} orb hits per enemy (max 50%)`);
    cut('Primordial Collapse', primordialCollapseReduction(mb),
        `enemies in a Black Hole deal ${uniq(mb, 'Primordial Collapse')}% less × ${(mb.run.bhShare * 100).toFixed(0)}% of kills inside holes`);
    const damageTaken = parts.damageTaken.reduce((p, f) => p * f.value, 1);

    // Flame Bot's Damage Reduction (stat 0) and the Chain Thunder lab's cap.
    const flame = snap.botData?.['Flame Bot'];
    const flameReduction = flame?.owned ? botStatValue('Flame Bot', 'Damage Reduction', flame.medals?.[0] ?? 0) / 100 : 0;
    const chainThunderCap = Math.min(CHAIN_THUNDER_MAX, 0.03 * (lab['CL-Chain Thunder'] ?? 0));

    return {
        parts, health, maxRecovery, armorMainMissing, wallPool, defAbs, defPct, defPctUncapped, cfReduction, regen, wallRegen,
        pkgChance, pkgAmount, thorns, damageTaken, orbRate: orbStats(snap).rate, deathRayRate: deathRayRate(snap),
        flameReduction, chainThunderCap,
    };
}

const CHAIN_THUNDER_MAX = 0.9;
// "Enemy damage is reduced by 10% for every 6% of health lost from Chain
// Lightning" (lab text, TheTowerSDK chainThunderReduction).
const chainThunderAt = (cap: number, clShare: number) => Math.min((clShare / 0.06) * 0.1, cap, CHAIN_THUNDER_MAX);

// What each layer cut in the run: blocked ÷ what reached it. Layers run
// Defense % → Absolute → Chrono Field → Chain Thunder → Flame Bot →
// Primordial Collapse → Negative Mass Projector, so what reached a layer is
// what it blocked plus everything blocked after it and what still landed.
function runCuts(raw: Record<string, unknown>): { flame: number; chainThunder: number } {
    const n = (k: string) => (typeof raw[k] === 'number' ? raw[k] as number : 0);
    const landed = n('DamageTaken') + n('DamageTakenWall');
    const afterFlame = landed + n('PrimordialCollapseBlocked') + n('MagicOrbBlocked');
    const atFlame = afterFlame + n('FlameBotBlocked');
    const atThunder = atFlame + n('ChainThunderBlocked');
    return {
        flame: atFlame > 0 ? n('FlameBotBlocked') / atFlame : 0,
        chainThunder: atThunder > 0 ? n('ChainThunderBlocked') / atThunder : 0,
    };
}

// Damage that still lands after Flame Bot and Chain Thunder, now ÷ at the
// calibration run (1 = no change).
export function cutsRatio(x: EhpInputs, calib: EhpCalibration): number {
    const a = calib.anchor;
    const flame = (i: EhpInputs) => Math.min(0.95, (calib.flameCover ?? 0) * (i.flameReduction ?? 0));
    const thunder = (i: EhpInputs) => Math.min(0.95, (calib.chainThunderCover ?? 0) * chainThunderAt(i.chainThunderCap ?? 0, calib.clShare ?? 0));
    return ((1 - flame(x)) * (1 - thunder(x))) / ((1 - flame(a)) * (1 - thunder(a)));
}

// ── Calibration ───────────────────────────────────────────────
export function buildEhpCalibration(snap: OptimizerSnapshot, report: BattleReport | null): EhpCalibration {
    const anchor = readEhpInputs(snap);
    if (!report || !report.gameTimeSec) {
        return {
            source: 'estimate',
            anchor,
            thornsShare: DEFAULT_THORNS_SHARE,
            packagesPerSec: anchor.pkgChance / DEFAULT_WAVE_S,
            waveSec: DEFAULT_WAVE_S,
        };
    }
    const waveSec = report.wave > 0 ? report.gameTimeSec / report.wave : DEFAULT_WAVE_S;
    const raw = report.raw ?? {};
    const healed = (key: string) => (typeof raw[key] === 'number' ? (raw[key] as number) : 0);
    const mix = runMix(report);
    const cuts = runCuts(raw);
    const clShare = report.damage && report.damage.total > 0 ? report.damage.chainLightning / report.damage.total : 0;
    const thunderNow = chainThunderAt(anchor.chainThunderCap ?? 0, clShare);
    return {
        source: 'report',
        anchor,
        thornsShare: report.totalEnemies > 0 ? Math.min(1, report.thornsKills / report.totalEnemies) : DEFAULT_THORNS_SHARE,
        packagesPerSec: report.recoveryPackages > 0 ? report.recoveryPackages / report.gameTimeSec : anchor.pkgChance / waveSec,
        waveSec,
        otherHealPerSec: (healed('Lifesteal') + healed('HealthFromDeathWaveThisRound')) / report.gameTimeSec,
        orbKills: mix.orbKills,
        deathRayKills: mix.deathRayKills,
        touchable: mix.touchable,
        flameCover: (anchor.flameReduction ?? 0) > 0 ? Math.min(1, cuts.flame / anchor.flameReduction!) : 0,
        chainThunderCover: thunderNow > 0 ? Math.min(1, cuts.chainThunder / thunderNow) : 0,
        clShare,
    };
}

// Enemies that reach the tower, now ÷ at the calibration run, as orbs
// destroy more or fewer of the ones they can touch (1 = no change).
export function orbReachRatio(x: EhpInputs, calib: EhpCalibration): number {
    const touchable = calib.touchable ?? 1;
    if (touchable <= 0) return 1;
    // Orbs' and Death Ray's touches, each scaled by its own rate.
    const part = (kills: number | undefined, now: number | undefined, then: number | undefined) => {
        const l0 = (kills ?? 0) > 0 && (then ?? 0) > 0 ? touchesOf(kills!, touchable) : 0;
        return { l0, l: l0 > 0 ? l0 * (now ?? 0) / then! : 0 };
    };
    const orb = part(calib.orbKills, x.orbRate, calib.anchor.orbRate);
    const ray = part(calib.deathRayKills, x.deathRayRate, calib.anchor.deathRayRate);
    if (orb.l0 + ray.l0 <= 0) return 1;
    const reach = (l: number) => (1 - touchable) + touchable * Math.exp(-l);
    return reach(orb.l + ray.l) / reach(orb.l0 + ray.l0);
}

// ── Score ─────────────────────────────────────────────────────
export function ehpBreakdown(x: EhpInputs, calib: EhpCalibration): EhpBreakdown {
    const throughDef = 1 - x.defPct;
    const throughCF = 1 - x.cfReduction;
    const lands = Math.max(0.01, x.damageTaken ?? 1);
    const eHP = ((x.health * x.maxRecovery + x.wallPool) / throughCF + x.defAbs) / throughDef / lands;

    // Package rate follows the observed rate, scaled by any change in package chance.
    const a = calib.anchor;
    const pkgRate = a.pkgChance > 0 ? calib.packagesPerSec * (x.pkgChance / a.pkgChance) : x.pkgChance / calib.waveSec;
    const healing = x.regen + x.wallRegen + pkgRate * x.pkgAmount * x.health + (calib.otherHealPerSec ?? 0);
    const eRegen = healing / (throughCF * throughDef * lands);

    return { eHP, eRegen, survival: Math.sqrt(eHP * (eHP + SUSTAIN_WINDOW_S * eRegen)) };
}

// Relative survival; the calibration anchor scores exactly 1.
export function ehpScore(snap: OptimizerSnapshot, calib: EhpCalibration): number {
    const x = readEhpInputs(snap);
    const a = calib.anchor;
    const before = ehpBreakdown(a, calib).survival;
    const after = ehpBreakdown(x, calib).survival;
    // Thorns cut incoming damage in proportion to the kills they make.
    const thornsFactor = a.thorns > 0
        ? (1 - calib.thornsShare) + calib.thornsShare * (x.thorns / a.thorns)
        : 1 + calib.thornsShare * x.thorns;
    // Fewer enemies past the orbs: fewer hits on the tower; and less of
    // each hit through Flame Bot and Chain Thunder.
    const orbFactor = 1 / Math.max(0.01, orbReachRatio(x, calib));
    const cutFactor = 1 / Math.max(0.01, cutsRatio(x, calib));
    return (before > 0 ? after / before : 1) * thornsFactor * orbFactor * cutFactor;
}
