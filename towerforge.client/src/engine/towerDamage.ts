// ============================================================
//  TowerForge Companion — Tower Damage Stats Engine
//  Computes the player's actual Tower Damage, Crit Chance/Factor,
//  and Super Crit Chance/Multi after ALL multiplier sources.
//
//  These four values feed directly into every damage-dealing
//  UW's eDPS formula:
//    UW_eDPS = UWMult × CoreModuleMult × TowerDamage
//            × (1 + CritFactor×CritChance)
//            × (1 + SuperCritMult×SuperCritChance×CritChance)
//            × [UW-specific term]
//
//  Pure functions — no store imports.
// ============================================================

import { calcCardMasteryBonuses } from './modBonuses';
import { moduleMaxLevel } from '../constants/moduleRarities';
import { amplifyingStrikeMult, projectFundingMult, restorativeBonusASMult, beingAnnihilatorBonus, superCritShare } from './moduleEffects';
import { packageChancePct } from './ttt';
import { BOTS_CONFIG, botPlusValue, isBotPlusOwned } from '../constants/botData';

import {
    MODULE_BASE_STATS,
    MODULE_INCREMENT_BRACKETS,
    MODULE_MAX_LEVEL,
    MODULE_MAIN_EFFECT_TEMP_MULT,
    MODULE_STAR_SCALE,
} from '../constants/gameData';

import type {
    WSPreset,
    LabData,
    CardData,
    RelicData,
    EnhData,
    ModBonuses,
    ModuleEntry,
    ModuleState,
    ModuleRarity,
    ModuleType,
    BotData,
} from '../types/gameTypes';
import { activeCard, activeLoadout, cardValue, masteredCardMult } from './statHelpers';

// ── Bot Bonus Multiplier ─────────────────────────────────
// Amplify Bot provides the DPS bonus; Bot Bot multiplies it if within range.
// Formula: DPS boost = Amplify Bot bonus × Bot Bot bonus
// Bot Bot "increases the bonus of other bots in range" (wiki), so without
// Amplify Bot it adds nothing to the tower. It's counted as always in range;
// its coin side is in engine/farming.ts.
// Echoing Shot (Amplify Bot+) isn't damage: it multiplies tower bullets —
// see echoingShotBullets.
function getBotBonusMult(botData: BotData): number {
    if (!botData) return 1;
    const bonus = (name: string): number => {
        const entry = botData[name];
        const stat = BOTS_CONFIG.find(b => b.name === name)?.stats.find(st => st.label === 'Bonus');
        if (!entry?.owned || !stat) return 1;
        const lv = entry.medals?.[2] ?? 0;
        return parseFloat(lv > 0 ? stat.values[Math.min(lv, stat.values.length) - 1] : stat.lv0) || 1;
    };
    const amplify = bonus('Amplify Bot');
    return amplify > 1 ? amplify * bonus('Bot Bot') : 1;
}

// ── Echoing Shot (Amplify Bot+) ──────────────────────────────────
// "Tower bullets within range count as {n} bullets" — 3 at unlock, +1 a
// level to 12 (wiki: Amplify Bot; TheTowerSDK). Applied to tower shots only,
// always on like Amplify Bot's Bonus (the code's assumption: the bot's
// uptime and range aren't modeled). Not modeled: the 1/3 boost the wiki
// gives Ultimate Weapon projectiles, and Bot Bot+'s Maximum Power on it
// (whether it scales the whole ability or the part above 1 isn't confirmed).
// 1 when Amplify Bot+ isn't unlocked.
export function echoingShotBullets(botData: BotData | undefined): number {
    const amp = botData?.['Amplify Bot'];
    if (!amp?.owned || !isBotPlusOwned(amp)) return 1;
    return botPlusValue('Amplify Bot', amp.plusLv ?? 0);
}

// ── Cumulative Increment Lookup (memoized per type) ───────────
// Precomputes the running sum of per-level increments up to the level
// cap so calcModuleMainMult is an O(1) array read even though the
// optimizer evaluates module multipliers thousands of times.
const MODULE_CUM_CACHE: Partial<Record<ModuleType, number[]>> = {};

function moduleCumIncrements(type: ModuleType): number[] {
    const cached = MODULE_CUM_CACHE[type];
    if (cached) return cached;

    // Level 1 is the base value; each level after adds the increment of the
    // level before it, so cum[L] = Σ increment[1..L−1]. Checked against a real
    // card: Ancestral Armor (Sentry Protocol) at level 200 = ×16.24 exactly
    // (1.302 + 99 × 0.01149495 + 100 × 0.138).
    const brackets = MODULE_INCREMENT_BRACKETS[type] ?? [];
    const cum: number[] = [0];
    let total = 0;
    for (let lv = 1; lv <= MODULE_MAX_LEVEL; lv++) {
        cum[lv] = total;
        let rate = brackets[0]?.[1] ?? 0;
        for (const [threshold, r] of brackets) {
            if (lv >= threshold) rate = r;
            else break;
        }
        total += rate;
    }

    MODULE_CUM_CACHE[type] = cum;
    return cum;
}

// ── Module Main-Effect Multiplier ─────────────────────────────
//   mult(level) = BASE_STAT[rarity][type] + Σ increment[1..level−1] × starScale
// The per-level increment is bracketed and differs by module type, so
// a cannon (Tower Damage) and a core (UW Damage) of the same rarity/
// level produce different multipliers. Each Ancestral star scales the
// level gains by +4% (MODULE_STAR_SCALE). Checked against real cards:
// Ancestral armor L200 ×16.24, Ancestral ★5 cannon L217 ×23.37,
// generator L216 ×2.476, core L216 ×29.86.
export function calcModuleMainMult(
    rarity: ModuleRarity,
    type: ModuleType,
    level: number,
): number {
    const base = MODULE_BASE_STATS[rarity]?.[type];
    if (base == null) return 1;
    const lv = Math.max(0, Math.min(level, MODULE_MAX_LEVEL));
    const cum = moduleCumIncrements(type)[lv] ?? 0;
    return (base + cum * (MODULE_STAR_SCALE[rarity] ?? 1)) * MODULE_MAIN_EFFECT_TEMP_MULT;
}

// ── Module Damage Multiplier ──────────────────────────────────
// Auto-computes the module's main-effect ×value from its rarity, type, and
// the LEVEL OF THE SLOT it's placed in (level is a property of the loadout
// slot, not the module). A manually entered `mainMult` (read straight off
// the card) still takes precedence as an override when present.
export function calcModuleDamageMult(
    module: ModuleEntry | null | undefined,
    level: number,
): number {
    if (!module) return 1;
    if (module.mainMult && module.mainMult > 0) return module.mainMult; // manual override
    // A module can't level past its rarity's cap even in a higher slot
    // (Ancestral in a Lv 202 slot shows Lv 200/200).
    return calcModuleMainMult(module.rarity, module.type, Math.min(level, moduleMaxLevel(module.rarity)));
}
// ── Module Slot Main-Effect Multiplier ────────────────────────
// Primary module efficiency labs, one per type (T23 W500): +1% a level.
export const PRIMARY_EFF_LAB: Record<ModuleType, string> = {
    cannon: 'Primary-Cannon Mult',
    armor: 'Primary-Armor Mult',
    generator: 'Primary-Generator Mult',
    core: 'Primary-Core Mult',
};

// A primary module's main effect. Primary modules run at 100% efficiency;
// their lab adds 1% a level (130% max): 1 + (×value − 1) × (1 + lab%). A
// ×value typed from the module card already shows the boost.
export function primaryMainMult(
    mod: ModuleEntry | null | undefined,
    level: number,
    type: ModuleType,
    labData?: LabData,
): number {
    const value = calcModuleDamageMult(mod, level);
    if (!mod || (mod.mainMult ?? 0) > 0) return value;
    const lab = labData?.[PRIMARY_EFF_LAB[type]] ?? 0;
    return 1 + (value - 1) * (1 + lab / 100);
}

// A type's main effect: the primary module (with its efficiency lab) × the
// assist at its Mult Efficiency (cannon = Tower Damage, generator = Coin
// Bonus, core = UW Damage, armor = Tower Health).
export function calcModuleSlotMult(moduleState: ModuleState, type: ModuleType, labData?: LabData): number {
    const slots = activeLoadout(moduleState)?.slots[type] ?? { main: '', assist: '' };
    const lv = moduleState.slotLevels?.[type] ?? { main: 0, assist: 0 };
    const mainMod = moduleState.library.find(m => m.id === slots.main);
    const assistMod = moduleState.library.find(m => m.id === slots.assist);
    return primaryMainMult(mainMod, lv.main, type, labData)
        * assistMainContrib(assistMod, moduleState.assistData[type], lv.assist);
}

// One slot's part of its type's main effect if the slot were at `level`:
// the primary module with its efficiency lab, or the assist at its Mult
// Efficiency. 1 for an empty slot or a locked assist.
export function slotMainMult(
    moduleState: ModuleState,
    type: ModuleType,
    pos: 'main' | 'assist',
    level: number,
    labData?: LabData,
): number {
    const id = activeLoadout(moduleState)?.slots[type]?.[pos] ?? '';
    const mod = moduleState.library.find(m => m.id === id);
    return pos === 'main'
        ? primaryMainMult(mod, level, type, labData)
        : assistMainContrib(mod, moduleState.assistData[type], level);
}

// ── Combined Cannon Module Multiplier (2 equipped + 2 assist) ──
// Two equipped modules multiply at full effect.
// Two assist modules multiply at reduced efficiency:
//   AssistContribution = 1 + (ModuleDamageMult - 1) × efficiency
export function calcCannonModuleMult(
    moduleState: ModuleState,
    labData?: LabData,
): number {
    const { library, assistData } = moduleState;

    // Equipped cannon modules (the equipped loadout, both cannon slots)
    const loadout = activeLoadout(moduleState);
    const cannonSlots = loadout?.slots.cannon ?? { main: '', assist: '' };
    const lv = moduleState.slotLevels?.cannon ?? { main: 0, assist: 0 };

    // Main cannon module — full effect at the cannon-main slot level (+ its lab)
    const mainMod = library.find(m => m.id === cannonSlots.main);
    const mainMult = primaryMainMult(mainMod, lv.main, 'cannon', labData);

    // Assist cannon module — its own main effect at the assist slot level,
    // scaled by Mult Efficiency. Checked against a real card: Ancestral ★5
    // at assist Lv 201 (×19.53) with 48% Mult Efficiency shows ×9.893.
    const assistMod = library.find(m => m.id === cannonSlots.assist);
    return mainMult * assistMainContrib(assistMod, assistData['cannon'], lv.assist);
}

// Assist slot contribution to a module main effect: 1 + (×value − 1) × Mult
// Efficiency (multiplicative since v27.1). Assist efficiency starts at 1%;
// stones take it to 100% and the Assist Mult lab adds 30% (130% max).
function assistMainContrib(
    assistMod: ModuleEntry | undefined,
    ad: ModuleState['assistData'][string] | undefined,
    level: number,
): number {
    if (!assistMod || !ad || ad.rarity === 'locked') return 1;
    const eff = Math.min(1.3, (ad.multEff ?? 0) / 100);
    return 1 + (calcModuleDamageMult(assistMod, level) - 1) * eff;
}

// ── Core Module Ultimate Weapon Damage Multiplier ─────────────
// Core modules' main effect is "Ultimate Weapon Damage" — a multiplier
// on the summed UW eDPS (separate from Tower Damage). The ×value is
// auto-computed from the core column of the module tables (or a manual
// mainMult override), exactly like the cannon path.
//   Main slot  = full ×value (+ its efficiency lab)
//   Assist slot = 1 + (×value − 1) × multEff
export function calcCoreUWDamageMult(moduleState: ModuleState, labData?: LabData): number {
    const { library, assistData } = moduleState;
    const loadout = activeLoadout(moduleState);
    const coreSlots = loadout?.slots.core ?? { main: '', assist: '' };

    const lv = moduleState.slotLevels?.core ?? { main: 0, assist: 0 };

    const mainMod = library.find(m => m.id === coreSlots.main);
    const mainMult = primaryMainMult(mainMod, lv.main, 'core', labData);

    const assistMod = library.find(m => m.id === coreSlots.assist);
    return mainMult * assistMainContrib(assistMod, assistData['core'], lv.assist);
}

// ── Enhancement Multiplier Helper ─────────────────────────────
// Returns (1 + level × step) for an owned enhancement, else 1.
function enhMult(
    enhData: EnhData,
    cat: 'attack' | 'defense' | 'utility',
    idx: number,
    step: number,
): number {
    const owned = enhData.u?.[cat]?.[idx] ?? false;
    if (!owned) return 1;
    const lv = enhData.d?.[cat]?.[idx] ?? 0;
    return 1 + lv * step;
}

// ── Berserker Bonus ────────────────────────────────────────────
// Berserker card: if active in preset, contributes the full
// +700% (7.0) cap. Star/mastery levels affect how FAST you reach
// the cap in-game, but the cap itself is universal — so for
// optimizer purposes, owning + active = full +700%.
function getBerserkerBonus(
    presetIdx: number,
    cardData: CardData,
): number {
    const activeNames = new Set(cardData.presets[presetIdx] ?? []);
    if (!activeNames.has('Berserker')) return 0;

    const entry = cardData.data['Berserker'];
    if (!entry || entry.s === 0) return 0;

    return 7.0; // +700% cap
}

// ── Damage Perk + Standard Perk Bonus Multiplier ──────────────
// PerkMult = (1 + 0.15 × dmgPerkQty) × (1 + SPB%)
// modBonuses.perks.totalDmgMult already encodes this exact
// formula from calcPerkBonuses — reuse directly.
function getPerkMult(modBonuses: ModBonuses): number {
    return modBonuses.perks.totalDmgMult ?? 1;
}

// ── Workshop Damage (base value) ──────────────────────────────
// Workshop Damage is NOT a multiplier — it's the base damage value itself. The
// game's table in closed form (TheTowerSDK workshop/damage.ts, checked there
// against all 6001 rows): a quadratic, plus a power term for each band the
// level has passed. A level adds 1.74% at Lv 100, 0.16% at Lv 2000 and 0.08% at
// Lv 6000. Until 2026-11-01 this was 1.054^level, right up to about Lv 100 and
// 30 to 70 times too steep past Lv 1000.
const DAMAGE_BANDS: [number, number, number][] = [
    [999, 2.10, 0.08], [1499, 2.12, 0.09], [1999, 2.18, 0.10], [2499, 2.25, 0.10],
    [2999, 2.30, 0.15], [3499, 2.33, 0.20], [3999, 2.34, 0.20],
];

export function calcWorkshopDamageBase(level: number): number {
    const L = Math.max(0, level);
    return DAMAGE_BANDS.reduce((sum, [from, power, c]) => (L > from ? sum + c * (L - from) ** power : sum), 3 + 2.8 * L + 0.077 * L * L);
}

// ── Tower Damage ───────────────────────────────────────────────
// TowerDamage = WorkshopDamageBase × DamageLab × DamageCard (mastery scales its bonus)
//             × (1+Relics) × (1+CannonModule%) × Enhancements
//             × PerkMult × (1 + BerserkerBonus)
export function calcTowerDamage(
    presetIdx: number,
    wsData: WSPreset[],
    labData: LabData,
    cardData: CardData,
    relicData: RelicData,
    enhData: EnhData,
    modBonuses: ModBonuses,
    moduleState: ModuleState,
    botData?: BotData,
): number {
    const wsDamageLv = wsData[presetIdx]?.attack[0] ?? 0;
    const wsBase = calcWorkshopDamageBase(wsDamageLv);

    const damageLabLv = labData['Damage Lab'] ?? 0;
    const labMult = 1 + damageLabLv * 0.01;

    // Damage card (equipped only). Its mastery "increases the card stat
    // multiplier" — it scales the card's bonus: ×4.00 at M9 ×5 → 1 + 3 × 5 = ×16.
    const dmgCard = activeCard(cardData, presetIdx, 'Damage');
    const cardMult = dmgCard ? masteredCardMult(cardValue('Damage', dmgCard.stars), dmgCard.mastery) : 1;

    const relicDmg = relicData['rDmg'] ?? 0;
    const relicMult = 1 + relicDmg / 100;

    // Cannon module damage multiplier — 2 equipped modules (full effect)
    // × 2 assist modules (reduced efficiency based on assist stone/lab levels)
    const cannonMult = calcCannonModuleMult(moduleState, labData);

    const enhDmgMult = enhMult(enhData, 'attack', 0, 0.01); // Damage enhancement, 1%/level

    const perkMult = getPerkMult(modBonuses);

    const berserker = getBerserkerBonus(presetIdx, cardData);
    const berserkerMult = 1 + berserker;

    // Unique effects: Amplifying Strike (×5 while a boss/elite/fleet kill is
    // recent) and Project Funding (digits of cash). See moduleEffects.ts.
    const uniqueMult = amplifyingStrikeMult(modBonuses) * projectFundingMult(modBonuses);

    // Bot bonus multipliers (Golden Bot, Amplify Bot, Bot Bot)
    const botBonusMult = getBotBonusMult(botData ?? {});

    return wsBase * labMult * cardMult * relicMult * cannonMult
        * enhDmgMult * perkMult * berserkerMult * uniqueMult * botBonusMult;
}

// ── Tower Attack Speed (fire rate, attacks/sec) ───────────────
// Only Chain Lightning scales with this — it procs once per tower shot,
// so its eDPS is multiplied by fire rate. Other UWs have independent
// cooldowns and do NOT use attack speed.
//
// Game formula:
//   Displayed AS = (Workshop × Lab × Card + ModuleSub) × Enhancement
//   fireRate     = Displayed AS × Relic
// The game has no Attack Speed perk (wiki Perks page, TheTowerSDK's perk
// table, and the export's 34-perk Auto Pick list; until 2026-11-02 the site
// counted one at ×2.19 with Standard Perk Bonus 25).
// where:
//   Workshop:    1.00 base, +0.05/level (max 5.95 @ lv99)
//   Lab:         1.00 base, +0.02/level (max 2.98 @ lv99)
//   Card:        star multiplier 1.25…2.15 when equipped; mastery scales its bonus
//   Enhancement: +0.01/level (max 1.75 @ lv75)
// ModuleSub = Attack Speed module sub-effects (assist at substat efficiency).

export function calcAttackSpeed(
    presetIdx: number,
    wsData: WSPreset[],
    labData: LabData,
    cardData: CardData,
    enhData: EnhData,
    relicData: RelicData,
    modBonuses: ModBonuses,
): number {
    const wsLv = wsData[presetIdx]?.attack[1] ?? 0;
    const workshopVal = 1 + wsLv * 0.05;

    const labLv = labData['Attack Speed Lab'] ?? 0;
    const labMult = 1 + labLv * 0.02;

    // Attack Speed card (equipped only); its mastery scales the card's bonus.
    const asCard = activeCard(cardData, presetIdx, 'Attack Speed');
    const cardMult = asCard ? masteredCardMult(cardValue('Attack Speed', asCard.stars), asCard.mastery) : 1;

    const enhAS = enhMult(enhData, 'attack', 4, 0.01); // Attack Speed enhancement (index 4)

    const moduleSub = modBonuses.subs?.['Attack Speed'] ?? 0;
    const displayedAS = (workshopVal * labMult * cardMult + moduleSub) * enhAS;

    const relicMult = 1 + (relicData['rAtkSpd'] ?? 0) / 100;

    // Restorative Bonus: packages give +50% attack speed for a while.
    const restorative = restorativeBonusASMult(modBonuses, packageChancePct(presetIdx, wsData, labData, cardData, modBonuses));

    return displayedAS * relicMult * restorative;
}

// ── Projectile hits per second ────────────────────────────────
// Chain Lightning procs "on enemy hit" (wiki), so it — and tower shots —
// gain from every extra projectile hit, not just from attack speed. Each
// is a chance, counted at its average; every extra projectile and bounce is
// assumed to find an enemy (true near the end of a push, when the field is
// full):
//  • Multishot: chance m to fire T projectiles instead of 1 →
//    1 + m × (T − 1) per attack (workshop 0.5%/level, 2 + 1/level targets).
//  • Bounce Shot: after a hit, chance b to bounce on, up to N bounces →
//    1 + b + … + b^N hits per projectile (workshop 0.8%/level, 1 + 1/level).
//    That every bounce rolls the chance again is the code's assumption.
//  • Rapid Fire: chance r per attack to fire ×4 for D seconds (workshop
//    0.4%/level, 0.6 s + 0.05 s/level). Taken as not re-triggering while
//    active, so uptime U = rAD ÷ (1 + rAD) and the rate is ×(1 + 3U) — the
//    code's assumption; the ×4 is fixed (wiki).
// Module substats add to each.
export interface ProjectileFactors {
    multishot: number;   // projectiles per attack
    bounce: number;      // enemy hits per projectile
    rapid: number;       // average fire-rate factor from Rapid Fire
}

export function calcProjectileFactors(
    presetIdx: number,
    wsData: WSPreset[],
    modBonuses: ModBonuses,
    attackSpeed: number,
): ProjectileFactors {
    const ws = wsData[presetIdx]?.attack ?? [];
    const sub = (k: string) => modBonuses.subs?.[k] ?? 0;
    const msChance = Math.min(1, (0.5 * (ws[6] ?? 0) + sub('Multishot Chance')) / 100);
    const msTargets = 2 + (ws[7] ?? 0) + sub('Multishot Targets');
    const rfChance = Math.min(1, (0.4 * (ws[8] ?? 0) + sub('Rapid Fire Chance')) / 100);
    const rfSeconds = 0.6 + 0.05 * (ws[9] ?? 0) + sub('Rapid Fire Duration');
    const bChance = Math.min(1, (0.8 * (ws[10] ?? 0) + sub('Bounce Shot Chance')) / 100);
    const bounces = 1 + (ws[11] ?? 0) + sub('Bounce Shot Targets');
    let bounce = 0;
    for (let k = 0, p = 1; k <= bounces; k++, p *= bChance) bounce += p;
    const rad = rfChance * attackSpeed * rfSeconds;
    return {
        multishot: 1 + msChance * (msTargets - 1),
        bounce,
        rapid: 1 + (3 * rad) / (1 + rad),
    };
}

// ── Damage / Meter ────────────────────────────────────────────
// DPM% per meter of enemy distance. Only used by SL+ (Light Range),
// which boosts the Spotlight bonus by lrVal × (DPM × range).
//   Workshop: non-linear curve (base 0%); diminishing increments to lv70,
//             then a constant +0.0002/level up to 5.9% @ lv200.
//   Lab:         1.00 + level×0.02 (max 2.98 @ lv99) — multiplier
//   Enhancement: 1.00 + level×0.01 (max 5.0 @ lv400)
//   Relic:       +rDmgM% (max +71%)
// Workshop curve anchors (level → DPM fraction) from game data; values
// between anchors are linearly interpolated, and ≥lv70 uses the formula.
const DPM_WS_ANCHORS: [number, number][] = [
    [0, 0], [1, 0.00079], [10, 0.00742], [20, 0.01376], [30, 0.01913],
    [40, 0.02365], [50, 0.02741], [60, 0.0305], [70, 0.033],
];

function workshopDPM(level: number): number {
    if (level <= 0) return 0;
    if (level >= 70) return 0.033 + (level - 70) * 0.0002;
    for (let i = 1; i < DPM_WS_ANCHORS.length; i++) {
        const [l1, v1] = DPM_WS_ANCHORS[i];
        if (level <= l1) {
            const [l0, v0] = DPM_WS_ANCHORS[i - 1];
            return v0 + (v1 - v0) * ((level - l0) / (l1 - l0));
        }
    }
    return 0.033;
}

export function calcDamageMeter(
    presetIdx: number,
    wsData: WSPreset[],
    labData: LabData,
    enhData: EnhData,
    relicData: RelicData,
): number {
    const wsDPM = workshopDPM(wsData[presetIdx]?.attack[5] ?? 0);
    const labMult = 1 + (labData['Damage/Meter Lab'] ?? 0) * 0.02;
    const enhM = enhMult(enhData, 'attack', 2, 0.01); // Damage/Meter enhancement (index 2)
    const relicMult = 1 + (relicData['rDmgM'] ?? 0) / 100;
    return wsDPM * labMult * enhM * relicMult;
}

// ── Critical Chance ────────────────────────────────────────────
// CritChance% = Workshop level × 1% + Card bonus% + Mastery bonus% + Relic%
export function calcCritChance(
    presetIdx: number,
    wsData: WSPreset[],
    cardData: CardData,
    relicData: RelicData,
    modBonuses?: ModBonuses,
): number {
    const wsCrit = (wsData[presetIdx]?.attack[2] ?? 0) + 1; // 1% at Lv 0, +1% a level: 80% at Lv 79 (the game's table)
    // The card counts only while it's in the preset, like every card.
    const critCard = activeCard(cardData, presetIdx, 'Critical Chance');
    const critCardBonus = critCard ? [5, 6, 7, 8, 9, 10, 11][critCard.stars - 1] ?? 0 : 0;
    const cardMastery = calcCardMasteryBonuses(presetIdx, cardData);
    const relicCrit = relicData['rCrit'] ?? 0; // Crit Chance relic (max +9%, additive pts)
    const moduleSub = modBonuses?.subs?.['Crit Chance'] ?? 0;      // +% points
    return Math.min(1, (wsCrit + critCardBonus + (cardMastery.critMastAdd ?? 0) + relicCrit + moduleSub) / 100);
}

// ── Critical Factor ────────────────────────────────────────────
// Workshop value ≈ 1.2 + level × 0.1 (e.g. lv1=1.30x, lv150=16.20x)
// Lab is a MULTIPLIER on the workshop value: lv1=1.03, lv99=3.97
//   → approximated as 1 + labLevel × 0.03
// Enhancement adds +1%/level on top.
export function calcCritFactor(
    presetIdx: number,
    wsData: WSPreset[],
    labData: LabData,
    enhData: EnhData,
    relicData: RelicData,
    modBonuses?: ModBonuses,
): number {
    const wsLv = wsData[presetIdx]?.attack[3] ?? 0;
    // Crit Factor module sub-effects add to the workshop value (×15 → +15).
    const workshopVal = 1.2 + wsLv * 0.1 + (modBonuses?.subs?.['Crit Factor'] ?? 0);

    const labLv = labData['Critical Factor Lab'] ?? 0;
    const labMult = 1 + labLv * 0.03;

    const enhMultVal = enhMult(enhData, 'attack', 1, 0.01); // Critical Factor enhancement

    const relicMult = 1 + (relicData['rCritFac'] ?? 0) / 100; // Crit Factor relic (max +103%)

    return workshopVal * labMult * enhMultVal * relicMult;
}

// ── Super Crit Chance ──────────────────────────────────────────
// EffectiveSuperCritChance% = WorkshopValue% + LabValue%
// Workshop: 0.2%/level. Lab: 0.1%/level.
export function calcSuperCritChance(
    presetIdx: number,
    wsData: WSPreset[],
    labData: LabData,
    relicData: RelicData,
    modBonuses?: ModBonuses,
): number {
    const wsLv = wsData[presetIdx]?.attack[13] ?? 0;
    const wsPct = wsLv * 0.2;

    const labLv = labData['Super Crit Chance Lab'] ?? 0;
    const labPct = labLv * 0.1;

    const relicPct = relicData['rSCrit'] ?? 0; // Super Crit Chance relic (max +6%, additive pts)

    const modulePct = (modBonuses?.subs?.['Super Crit Chance'] ?? 0) + (modBonuses ? beingAnnihilatorBonus(modBonuses) * 100 : 0);
    return (wsPct + labPct + relicPct + modulePct) / 100;
}

// ── Super Crit Multiplier ──────────────────────────────────────
// Workshop value ≈ 1.2 + level × 0.1 (e.g. lv1=1.30x, lv120=13.20x)
// Lab is a MULTIPLIER on the workshop value: lv1=1.02, lv40=1.80
//   → approximated as 1 + labLevel × 0.02
// Enhancement adds +1%/level on top.
export function calcSuperCritMult(
    presetIdx: number,
    wsData: WSPreset[],
    labData: LabData,
    enhData: EnhData,
    relicData: RelicData,
    modBonuses?: ModBonuses,
): number {
    const wsLv = wsData[presetIdx]?.attack[14] ?? 0;
    // Super Crit Multi module sub-effects add to the workshop value.
    const workshopVal = 1.2 + wsLv * 0.1 + (modBonuses?.subs?.['Super Crit Multi'] ?? 0);

    const labLv = labData['Super Crit Mult Lab'] ?? 0;
    const labMult = 1 + labLv * 0.02;

    const enhMultVal = enhMult(enhData, 'attack', 3, 0.01); // Super Crit Multi enhancement

    const relicMult = 1 + (relicData['rSCritM'] ?? 0) / 100; // Super Crit Mult relic (max +5%)

    return workshopVal * labMult * enhMultVal * relicMult;
}

// ── Combined Crit Multiplier ──────────────────────────────────
// CritMult = (1 + CritFactor × CritChance) × (1 + SuperCritMult × SuperCritChance × CritChance)
export function calcCritMult(
    presetIdx: number,
    wsData: WSPreset[],
    labData: LabData,
    cardData: CardData,
    enhData: EnhData,
    relicData: RelicData,
    modBonuses?: ModBonuses,
): number {
    const critChance = calcCritChance(presetIdx, wsData, cardData, relicData, modBonuses);
    const critFactor = calcCritFactor(presetIdx, wsData, labData, enhData, relicData, modBonuses);
    const superCritChance = calcSuperCritChance(presetIdx, wsData, labData, relicData, modBonuses);
    const superCritMult = calcSuperCritMult(presetIdx, wsData, labData, enhData, relicData, modBonuses);

    // Share of shots that super crit — Being Annihilator chains 5 more after each.
    const superCritShareOfShots = modBonuses
        ? superCritShare(superCritChance * critChance, modBonuses)
        : superCritChance * critChance;

    const term1 = 1 + critFactor * critChance;
    const term2 = 1 + superCritMult * superCritShareOfShots;
    return term1 * term2;
}