// ============================================================
//  TowerForge Companion — Module Data
//  Unique module effects and sub-effect values by rarity.
//  Shared by the Modules tab, the engine and the game import.
// ============================================================

import type { ModuleRarity, ModuleType } from '../types/gameTypes';

// ── Rarities ──────────────────────────────────────────────────
// Sub-effect rarities (what you can roll on a sub slot)
export const SUB_RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Ancestral'] as const;
export type SubRarity = typeof SUB_RARITIES[number];

// ── Unique Module Definitions ──────────────────────────────────
// [name, description, { Epic, Legendary, Mythic, Ancestral }, unit]
// null = value not known.
export type RarityProgression = { Epic: number | null; Legendary: number | null; Mythic: number | null; Ancestral: number | null };
export const UNIQUE_MODULES: Record<ModuleType, [string, string, RarityProgression, string][]> = {
    cannon: [
        ['Astral Deliverance', 'Bounce shot range +3% of tower range. Each bounce increases projectile damage by [x]%', { Epic: 20, Legendary: 40, Mythic: 60, Ancestral: 80 }, '%'],
        ['Being Annihilator', 'Super Crit chance increased by [x]%. When you super crit, your next 5 attacks are guaranteed super crits.', { Epic: 5, Legendary: 7, Mythic: 10, Ancestral: 14 }, '%'],
        ['Death Penalty', '[x]% chance to mark an enemy for death on spawn, causing first hit to destroy it.', { Epic: 5, Legendary: 8, Mythic: 11, Ancestral: 15 }, '%'],
        ['Havoc Bringer', '[x]% chance for rend armor to instantly go to max.', { Epic: 10, Legendary: 13, Mythic: 15, Ancestral: 20 }, '%'],
        ['Shrink Ray', 'Attacks have 1% chance to apply non-stacking effect decreasing enemy mass by [x]%', { Epic: 10, Legendary: 20, Mythic: 30, Ancestral: 40 }, '%'],
        ['Amplifying Strike', 'Killing a boss, elite, or Fleet increases Tower Damage by 5x for [x]s', { Epic: 5, Legendary: 11, Mythic: 18, Ancestral: 26 }, 's'],
        ['Gilded Sniper', 'On enemy death: [x]% chance to apply all active coin bonuses, even if not in range.', { Epic: 10, Legendary: 20, Mythic: 30, Ancestral: 40 }, '%'],
    ],
    armor: [
        ['Anti-Cube Portal', 'Enemies take [x]x damage for 7s after hit by shockwave.', { Epic: 10, Legendary: 15, Mythic: 20, Ancestral: 25 }, 'x'],
        ['Negative Mass Projector', 'If an orb doesn\'t kill the enemy it applies a stacking debuff reducing damage and speed by [x]% per hit (max 50%)', { Epic: 1.0, Legendary: 1.5, Mythic: 2.0, Ancestral: 2.5 }, '%'],
        ['Wormhole Redirector', 'Health Regen can heal up to [x]% of Package Max Recovery', { Epic: 25, Legendary: 50, Mythic: 75, Ancestral: 100 }, '%'],
        ['Space Displacer', 'Landmines have [x]% chance to spawn as Inner Land Mine instead.', { Epic: 15, Legendary: 20, Mythic: 25, Ancestral: 30 }, '%'],
        ['Sharp Fortitude', 'Increase Wall health and regen by x[x]. Enemies take +1% increased damage from wall thorns per subsequent hit.', { Epic: 1.25, Legendary: 1.5, Mythic: 2, Ancestral: 2.5 }, 'x'],
        ['Orbital Augment', 'Adds [x] orbiting Electrons. Each deals damage equal to 15% of enemy remaining health.', { Epic: 2, Legendary: 4, Mythic: 6, Ancestral: 8 }, 'electrons'],
        ['Sentry Protocol', 'Orb speed is reduced to zero. Orbs instead fire [x] mini orbs.', { Epic: 1, Legendary: 2, Mythic: 3, Ancestral: 4 }, 'mini orbs'],
    ],
    generator: [
        ['Singularity Harness', 'Increase range of each bot by +[x]m. Enemies hit by Flame Bot receive double damage.', { Epic: 5, Legendary: 8, Mythic: 11, Ancestral: 15 }, 'm'],
        ['Galaxy Compressor', 'Collecting a recovery package reduces cooldown of all UWs except Poison Swamp by [x]s.', { Epic: 10, Legendary: 13, Mythic: 17, Ancestral: 20 }, 's'],
        ['Pulsar Harvester', 'Each projectile hit has [x]% chance to reduce enemy Health and Attack level by 1.', { Epic: 1.0, Legendary: 1.5, Mythic: 2.0, Ancestral: 2.5 }, '%'],
        ['Black Hole Digestor', 'Temporarily get [x]% extra Coins/Kill Bonus for each free upgrade you got on the current wave. Free Upgrades can not increase Tower Range.', { Epic: 3, Legendary: 5, Mythic: 7, Ancestral: 10 }, '%'],
        ['Project Funding', 'Tower damage multiplied by [x]% of digits in current cash.', { Epic: 12.5, Legendary: 25, Mythic: 50, Ancestral: 100 }, '%'],
        ['Restorative Bonus', 'Packages grant 50% attack speed boost for [x]s, decaying over 60s.', { Epic: 15, Legendary: 20, Mythic: 25, Ancestral: 30 }, 's'],
        // Newer module, not on the wiki yet; values from the player (Legendary confirmed on a card).
        ['Infinity Threshold', 'Free Upgrades to Damage, Health, and Health Regen can exceed the in-run limit by [x] levels.', { Epic: 1000, Legendary: 2000, Mythic: 3000, Ancestral: 4000 }, ' levels'],
    ],
    core: [
        ['Om Chip', 'Spotlight rotates to focus boss. Bosses reflect light, increasing damage to nearby enemies by x[x].', { Epic: 2, Legendary: 4, Mythic: 7, Ancestral: 15 }, 'x'],
        ['Harmony Conductor', '[x]% chance of poisoned enemies to miss-attack (bosses halved).', { Epic: 15, Legendary: 20, Mythic: 25, Ancestral: 30 }, '%'],
        ['Dimension Core', 'CL has 60% chance to hit initial target. Shock chance/mult doubled. Shock stacks up to [x].', { Epic: 5, Legendary: 10, Mythic: 15, Ancestral: 20 }, 'stacks'],
        ['Multiverse Nexus', 'DW, GT and BH always activate together. Cooldown is average +/-[x]s.', { Epic: 20, Legendary: 10, Mythic: 1, Ancestral: -10 }, 's'],
        ['Magnetic Hook', '[x] Inner Land Mines fired at Bosses & Fleets (100% each) entering range. 25% of Elites also targeted.', { Epic: 1, Legendary: 2, Mythic: 3, Ancestral: 4 }, 'mines'],
        ['Primordial Collapse', 'Spawns one additional Black Hole. Damage from enemies within a BH decreased by [x]%', { Epic: 60, Legendary: 65, Mythic: 75, Ancestral: 90 }, '%'],
    ],
};

// ── Sub-Effect Definitions ────────────────────────────────────
// [effectName, unit, [Common, Rare, Epic, Legendary, Mythic, Ancestral]]
// null = not available at that rarity
export type SubEffectDef = [string, string, (number | string | null)[]];

export const SUB_EFFECTS: Record<ModuleType, SubEffectDef[]> = {
    cannon: [
        ['Attack Speed', 'x', [0.3, 0.5, 0.7, 1, 3, 5]],
        ['Crit Chance', '%', [2, 3, 4, 6, 8, 10]],
        ['Crit Factor', 'x', [2, 4, 6, 8, 12, 15]],
        ['Attack Range', 'm', [2, 4, 8, 12, 20, 30]],
        ['Damage/Meter', '', [0.005, 0.01, 0.025, 0.04, 0.075, 0.15]],
        ['Multishot Chance', '%', [null, 3, 5, 7, 10, 13]],
        ['Multishot Targets', '', [null, null, 1, 2, 3, 4]],
        ['Rapid Fire Chance', '%', [null, 2, 4, 6, 9, 12]],
        ['Rapid Fire Duration', 's', [null, 0.4, 0.8, 1.4, 2.5, 3.5]],
        ['Bounce Shot Chance', '%', [null, 2, 3, 5, 9, 12]],
        ['Bounce Shot Targets', '', [null, null, 1, 2, 3, 4]],
        ['Bounce Shot Range', 'm', [null, 0.5, 0.8, 1.2, 1.8, 2.0]],
        ['Super Crit Chance', '%', [null, null, 3, 5, 7, 10]],
        ['Super Crit Multi', 'x', [null, null, 2, 3, 5, 7]],
        ['Rend Armor Chance', '%', [null, null, null, 2, 5, 8]],
        ['Rend Armor Multi', '%', [null, null, null, 2, 5, 8]],
        ['Max Rend Armor Multi', '%', [null, null, null, 200, 300, 500]],
    ],
    armor: [
        ['Health Regen', '%', [20, 40, 60, 100, 200, 400]],
        ['Defense', '%', [1, 2, 3, 5, 6, 8]],
        ['Defense Absolute', '%', [15, 25, 40, 100, 500, 1000]],
        ['Thorns Damage', 'x', [null, null, 2, 4, 7, 10]],
        ['Lifesteal', '%', [null, null, 0.3, 0.5, 1.5, 2.0]],
        ['Knockback Chance', '%', [null, null, 2, 4, 6, 9]],
        ['Knockback Force', 'x', [null, null, 0.1, 0.4, 0.9, 1.5]],
        ['Orb Speed', 'x', [null, null, 1, 1.5, 2, 3]],
        ['Orbs', '', [null, null, null, null, 1, 2]],
        ['Shockwave Size', 'x', [null, null, 0.1, 0.3, 0.7, 1]],
        ['Shockwave Frequency', 's', [null, null, -1, -2, -3, -4]],
        ['Land Mine Damage', '%', [null, 30, 50, 150, 500, 800]],
        ['Land Mine Chance', '%', [null, 1.5, 3, 6, 9, 12]],
        ['Land Mine Radius', 'x', [null, 0.1, 0.15, 0.3, 0.75, 1]],
        ['Death Defy', '%', [null, null, null, 1.5, 3.5, 5]],
        ['Wall Health', '%', [null, null, 20, 40, 90, 120]],
        ['Wall Rebuild', 's', [null, null, -20, -40, -80, -100]],
    ],
    generator: [
        ['Cash Bonus', 'x', [0.1, 0.2, 0.3, 0.5, 1.2, 2.5]],
        ['Cash/Wave', '', [30, 50, 100, 200, 500, 1000]],
        ['Coins/Kill Bonus', 'x', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]],
        ['Coins/Wave', '', [20, 35, 60, 120, 200, 350]],
        ['Free Attack Upgrade', '%', [2, 4, 6, 8, 10, 12]],
        ['Free Defense Upgrade', '%', [2, 4, 6, 8, 10, 12]],
        ['Free Utility Upgrade', '%', [2, 4, 6, 8, 10, 12]],
        ['Interest/Wave', '%', [null, null, 2, 4, 6, 8]],
        ['Recovery Amount', '%', [null, null, 3, 5, 7, 10]],
        ['Max Recovery', 'x', [null, null, 0.4, 0.7, 1.0, 1.5]],
        ['Package Chance', '%', [null, null, 5, 8, 11, 15]],
        ['Enemy Atk Level Skip', '%', [null, null, 2, 4, 6, 8]],
        ['Enemy HP Level Skip', '%', [null, null, 2, 4, 6, 8]],
    ],
    core: [
        ['Golden Tower - Bonus', 'x', [null, null, 1, 2, 3, 4]],
        ['Golden Tower - Duration', 's', [null, null, null, 2, 4, 7]],
        ['Golden Tower - Cooldown', 's', [null, null, null, -5, -8, -12]],
        ['Black Hole - Size', 'm', [2, 4, 6, 8, 10, 12]],
        ['Black Hole - Duration', 's', [null, null, null, 2, 3, 4]],
        ['Black Hole - Cooldown', 's', [null, null, null, -2, -3, -4]],
        ['Spotlight - Bonus', 'x', [1.2, 2.5, 3.5, 10, 15, 20]],
        ['Spotlight - Angle', '°', [null, null, 3, 6, 11, 15]],
        ['Chrono Field - Duration', 's', [null, null, null, 4, 7, 10]],
        ['Chrono Field - Speed Red.', '%', [null, null, 3, 8, 11, 15]],
        ['Chrono Field - Cooldown', 's', [null, null, null, -4, -7, -10]],
        ['Death Wave - Damage', 'x', [8, 15, 25, 50, 100, 250]],
        ['Death Wave - Quantity', '', [null, null, null, 1, 2, 3]],
        ['Death Wave - Cooldown', 's', [null, null, null, -6, -10, -13]],
        ['Smart Missiles - Damage', 'x', [8, 15, 25, 50, 100, 250]],
        ['Smart Missiles - Quantity', '', [null, null, 1, 2, 4, 5]],
        ['Smart Missiles - Cooldown', 's', [null, null, null, -2, -4, -6]],
        ['ILM - Damage', 'x', [8, 15, 25, 50, 100, 250]],
        ['ILM - Quantity', '', [null, null, null, 1, 2, 3]],
        ['ILM - Cooldown', 's', [null, null, -5, -8, -10, -13]],
        ['Poison Swamp - Damage', 'x', [8, 15, 25, 50, 100, 250]],
        ['Poison Swamp - Duration', 's', [null, null, null, 2, 5, 10]],
        ['Poison Swamp - Cooldown', 's', [null, null, null, -2, null, null]],
        ['Chain Lightning - Damage', 'x', [8, 15, 25, 50, 100, 250]],
        ['Chain Lightning - Quantity', '', [null, null, 1, 2, 3, 4]],
        ['Chain Lightning - Chance', '%', [2, 4, 6, 9, 12, 15]],
    ],
};

// ── How each unique effect is counted in the calculations ──────
// Shown on the Modules tab. Formulas live in engine/moduleEffects.ts.
export const UNIQUE_EFFECT_MODEL: Record<string, { counted: string; how: string }> = {
    // Cannon
    'Astral Deliverance': { counted: 'Not counted', how: 'Boosts bounce-shot projectiles; the eDPS model scores Ultimate Weapon damage.' },
    'Being Annihilator': { counted: 'eDPS', how: 'Adds super crit chance, and each super crit makes the next 5 shots super crits.' },
    'Death Penalty': { counted: 'eDPS', how: 'Marked enemies die to one hit, so the rest of your damage clears enemies faster.' },
    'Havoc Bringer': { counted: 'Not counted', how: 'Rend armor isn’t modeled.' },
    'Shrink Ray': { counted: 'Not counted', how: 'Enemy mass (knockback) isn’t modeled.' },
    'Amplifying Strike': { counted: 'eDPS', how: '×5 tower damage, up while a boss, elite or fleet kill is recent — kill rates from your battle report.' },
    'Gilded Sniper': { counted: 'Coins', how: 'Kills outside Spotlight, Black Hole or Golden Bot can still get their coin bonus while it’s active.' },
    // Armor
    'Anti-Cube Portal': { counted: 'eDPS', how: 'Enemies take extra damage for 7s after each shockwave (every 20s − 0.15s per Frequency level, min 7s).' },
    'Negative Mass Projector': { counted: 'eHP', how: 'Orb hits cut enemy damage — orb hits per enemy from your battle report.' },
    'Wormhole Redirector': { counted: 'Not counted', how: 'eHP already assumes recovery packages keep you at Max Recovery.' },
    'Space Displacer': { counted: 'eDPS', how: 'Turns land mines into Inner Land Mines — land mine chance × kills per second.' },
    'Sharp Fortitude': { counted: 'eHP', how: 'Multiplies wall health and wall regen.' },
    'Orbital Augment': { counted: 'Not counted', how: 'Electrons deal a % of enemy health, which doesn’t scale with tower damage.' },
    'Sentry Protocol': { counted: 'Not counted', how: 'It stops the orbs and makes them fire mini orbs instead, which isn’t modeled.' },
    // Generator
    'Singularity Harness': { counted: 'Coins', how: 'Adds Golden Bot range (Flame Bot damage isn’t modeled).' },
    'Galaxy Compressor': { counted: 'eDPS · Coins', how: 'Each recovery package cuts every UW cooldown but Poison Swamp — package rate from your battle report.' },
    'Pulsar Harvester': { counted: 'Not counted', how: 'Enemy level reductions aren’t modeled.' },
    'Black Hole Digestor': { counted: 'Coins', how: 'Adds Coins/Kill for every free upgrade each wave (free upgrade chances from workshop, card, perk, modules and enhancement). It also keeps free upgrades off Range, in a main or assist slot: Range stays at its workshop level.' },
    'Project Funding': { counted: 'eDPS', how: 'Tower damage × digits of cash — cash from your battle report.' },
    'Restorative Bonus': { counted: 'eDPS', how: 'Packages boost attack speed, which drives Chain Lightning.' },
    'Infinity Threshold': { counted: 'Not counted', how: 'Upgrade values past the normal level cap aren’t known.' },
    // Core
    'Om Chip': { counted: 'eDPS', how: 'Enemies near a boss in the Spotlight take extra damage (assumes a quarter of enemies are near it while a boss is alive).' },
    'Harmony Conductor': { counted: 'eHP', how: 'Poisoned enemies miss attacks — share poisoned from your battle report.' },
    'Dimension Core': { counted: 'eDPS', how: 'Chain Lightning can hit its target; shock chance and bonus doubled and stacking — CL hits per enemy from your battle report.' },
    'Multiverse Nexus': { counted: 'eDPS · Coins', how: 'Death Wave, Golden Tower and Black Hole share one cooldown: the average of theirs, shifted by this value.' },
    'Magnetic Hook': { counted: 'eDPS', how: 'Fires Inner Land Mines at bosses, fleets and a quarter of elites — rates from your battle report.' },
    'Primordial Collapse': { counted: 'eDPS · eHP', how: 'An extra Black Hole, and enemies inside holes deal less damage.' },
};

// ── Display helpers (Modules tab, share card) ─────────────────
// What each module type's main effect multiplies (the ×value on the card).
export const MAIN_EFFECT_LABELS: Record<ModuleType, string> = {
    cannon: 'Tower Damage',
    armor: 'Tower Health',
    generator: 'Coin Bonus',
    core: 'Ultimate Weapon Damage',
};

// Module rarity codes → the unique-effect tier they run at.
export const RARITY_TIER: Record<ModuleRarity, keyof RarityProgression> = {
    C: 'Epic', R: 'Epic', Rp: 'Epic',
    E: 'Epic', Ep: 'Epic', L: 'Legendary', Lp: 'Legendary', M: 'Mythic', Mp: 'Mythic',
    A: 'Ancestral', A1: 'Ancestral', A2: 'Ancestral', A3: 'Ancestral', A4: 'Ancestral', A5: 'Ancestral',
};

// A sub-effect's value at a rarity, with its unit ("+12%"-style text without
// the sign); null when that rarity can't roll it.
export function subEffectValue(type: ModuleType, effect: string, rar: SubRarity): string | null {
    const def = SUB_EFFECTS[type]?.find(([name]) => name === effect);
    if (!def) return null;
    const val = def[2][SUB_RARITIES.indexOf(rar)];
    if (val === null || val === undefined) return null;
    return `${val}${def[1]}`;
}

// The unique effect's description with its value filled in.
export function uniqueDescription(type: ModuleType, name: string, rar: ModuleRarity): string | null {
    const def = UNIQUE_MODULES[type]?.find(([n]) => n === name);
    if (!def) return null;
    const val = def[2][RARITY_TIER[rar] ?? 'Epic'];
    return def[1].replace('[x]', val == null ? '?' : String(val));
}
