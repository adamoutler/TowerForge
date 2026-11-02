// ============================================================
//  TowerForge Companion — Game Export Index Maps
//  The game's export stores cards, perks, labs and modules as
//  numbered arrays. These tables turn those numbers into the
//  site's names.
//
//  Only numbers confirmed against a real account are listed —
//  anything missing is left as the player entered it. How each
//  block was confirmed: docs/game-export-format.md
// ============================================================

import type { ModuleRarity, ModuleType } from '../types/gameTypes';

// ── Modules ───────────────────────────────────────────────────
// InfoIndex → unique module. InfoIndex says WHICH module it is (the same
// number for every player); Guid identifies one particular copy. Numbers
// come in blocks of 10 per type (cannon 1–10, armor 11–20, generator
// 21–30, core 31–40): 3–6 of each block are the generic modules with no
// unique effect, 7–10 the original uniques; newer uniques come in waves
// from 41. Each was confirmed by matching a real module card's effects,
// in order, to that module's Effects[] codes (docs/game-export-format.md).
const CN: ModuleType = 'cannon', AR: ModuleType = 'armor', GN: ModuleType = 'generator', CR: ModuleType = 'core';
export const GAME_MODULES: Record<number, { name: string; type: ModuleType }> = {
    7: { name: 'Havoc Bringer', type: CN },
    8: { name: 'Death Penalty', type: CN },
    9: { name: 'Being Annihilator', type: CN },
    10: { name: 'Astral Deliverance', type: CN },
    17: { name: 'Wormhole Redirector', type: AR },
    18: { name: 'Negative Mass Projector', type: AR },
    19: { name: 'Space Displacer', type: AR },
    20: { name: 'Anti-Cube Portal', type: AR },
    27: { name: 'Black Hole Digestor', type: GN },
    28: { name: 'Pulsar Harvester', type: GN },
    29: { name: 'Galaxy Compressor', type: GN },
    30: { name: 'Singularity Harness', type: GN },
    37: { name: 'Multiverse Nexus', type: CR },
    38: { name: 'Dimension Core', type: CR },
    39: { name: 'Harmony Conductor', type: CR },
    40: { name: 'Om Chip', type: CR },
    41: { name: 'Shrink Ray', type: CN },
    42: { name: 'Sharp Fortitude', type: AR },
    43: { name: 'Project Funding', type: GN },
    44: { name: 'Magnetic Hook', type: CR },
    45: { name: 'Amplifying Strike', type: CN },
    46: { name: 'Orbital Augment', type: AR },
    47: { name: 'Restorative Bonus', type: GN },
    48: { name: 'Primordial Collapse', type: CR },
    50: { name: 'Sentry Protocol', type: AR },
    51: { name: 'Gilded Sniper', type: CN },
    53: { name: 'Infinity Threshold', type: GN },
    // 49 and 52 not seen yet.
};

// Modules with a unique effect (the ones worth importing).
export const isUniqueModule = (info: number): boolean =>
    info > 40 || (info >= 7 && [7, 8, 9, 0].includes(info % 10));

// CurrentRarity → site rarity. Ancestral (no stars) = 10 and ★1–★5 = 11–15
// (confirmed by max levels 200 / 300); below that the wiki's order.
export const GAME_MODULE_RARITY: Record<number, ModuleRarity> = {
    2: 'R', 3: 'Rp', 4: 'E', 5: 'Ep', 6: 'L', 7: 'Lp', 8: 'M', 9: 'Mp',
    10: 'A', 11: 'A1', 12: 'A2', 13: 'A3', 14: 'A4', 15: 'A5',
};

// Effects[] codes count up from 1 (0 = empty) through every (effect, rarity)
// pair in the game's order — workshop order for cannon/armor/generator, UW
// order for core — using one code per rarity the effect can roll (SUB_EFFECTS),
// lowest rarity first. Effects added to the game later are appended after
// core. A number is a run of codes whose effects aren't confirmed yet.
// Runs end at codes 80 / 154 / 216 / 326, matching a real account; checked
// effect-by-effect against 27 module cards.
export const GAME_MODULE_EFFECT_RUNS: [ModuleType, (string | number)[]][] = [
    ['cannon', [
        'Attack Speed', 'Crit Chance', 'Crit Factor', 'Attack Range', 'Damage/Meter',
        'Multishot Chance', 'Multishot Targets', 'Rapid Fire Chance', 'Rapid Fire Duration',
        'Bounce Shot Chance', 'Bounce Shot Targets', 'Bounce Shot Range',
        'Super Crit Chance', 'Super Crit Multi', 'Rend Armor Chance', 'Rend Armor Multi', 'Max Rend Armor Multi',
    ]],
    ['armor', [
        'Health Regen', 'Defense', 'Defense Absolute', 'Thorns Damage', 'Lifesteal',
        'Knockback Chance', 'Knockback Force', 'Orb Speed', 'Orbs', 'Shockwave Size', 'Shockwave Frequency',
        'Land Mine Chance', 'Land Mine Damage', 'Land Mine Radius', 'Death Defy', 'Wall Health', 'Wall Rebuild',
    ]],
    ['generator', [
        'Cash Bonus', 'Cash/Wave', 'Coins/Kill Bonus', 'Coins/Wave',
        'Free Attack Upgrade', 'Free Defense Upgrade', 'Free Utility Upgrade',
        'Interest/Wave',      // Epic = 197 (Pulsar Harvester card)
        'Recovery Amount',    // 201–204 by count
        'Package Chance', 'Enemy Atk Level Skip', 'Enemy HP Level Skip',
    ]],
    ['core', [
        'Chain Lightning - Damage', 'Chain Lightning - Quantity', 'Chain Lightning - Chance',
        'Smart Missiles - Damage', 'Smart Missiles - Quantity', 'Smart Missiles - Cooldown',
        'Death Wave - Damage', 'Death Wave - Quantity', 'Death Wave - Cooldown',
        'Chrono Field - Duration', 'Chrono Field - Speed Red.', 'Chrono Field - Cooldown',
        'ILM - Damage', 'ILM - Quantity', 'ILM - Cooldown',
        'Golden Tower - Bonus', 'Golden Tower - Duration', 'Golden Tower - Cooldown',
        'Poison Swamp - Damage', 8,   // 297–304: Poison Swamp Duration / Cooldown, split unconfirmed
        'Black Hole - Size', 'Black Hole - Duration', 'Black Hole - Cooldown',
        'Spotlight - Bonus', 'Spotlight - Angle',
    ]],
    // Added later: Max Recovery Epic = 328 (Singularity Harness card); 327 unconfirmed.
    ['generator', [1, 'Max Recovery']],
];

// Level each effect slot unlocks at, by slot. Every slot is pre-rolled; how
// many a module has depends on its rarity (6 Legendary/Ancestral, 7 at 1 star,
// 8 at 5 stars). The highest level ever reached counts, even after a Restore.
// From real cards: a never-levelled Legendary shows 3 (101/141/161 locked),
// Ancestral 1 star at 200 shows 7, 5 stars at 201+ shows 7 with 241 locked.
export const MODULE_EFFECT_SLOT_UNLOCK = [0, 0, 0, 101, 141, 161, 0, 241];

// ── Cards ─────────────────────────────────────────────────────
// CardLevel / CardUnlocked / CardMasteryUnlocked / SlotPresetCardInt index.
// The in-game inventory lists cards by rarity, then by this number.
// Numbers 8, 9, 14, 17, 24, 35, 36, 38, 39 hold no card on a full
// account; Area of Effect (newest epic) is one of 35/36/38/39 — unconfirmed.
export const GAME_CARDS: Record<number, string> = {
    0: 'Damage', 1: 'Attack Speed', 2: 'Health', 3: 'Health Regen',
    4: 'Range', 5: 'Cash', 6: 'Coins', 7: 'Slow Aura',
    10: 'Critical Chance', 11: 'Enemy Balance', 12: 'Extra Defense', 13: 'Fortress',
    15: 'Free Upgrades', 16: 'Extra Orb', 18: 'Plasma Cannon', 19: 'Critical Coin',
    20: 'Wave Skip', 21: 'Intro Sprint', 22: 'Land Mine Stun', 23: 'Recovery Pkg Chance',
    25: 'Death Ray', 26: 'Energy Net', 27: 'Super Tower', 28: 'Second Wind',
    29: 'Demon Mode', 30: 'Energy Shield', 31: 'Wave Accelerator', 32: 'Berserker',
    33: 'Ultimate Crit', 34: 'Nuke',
    37: 'Cells',
};

// Card mastery labs: one lab per card, starting at this ResearchLevel index,
// for the original 30 cards in game-number order (Cells' lab is elsewhere).
export const MASTERY_LAB_START = 160;
export const MASTERY_LAB_CARDS: string[] = Object.entries(GAME_CARDS)
    .map(([n, name]) => [Number(n), name] as const)
    .filter(([n]) => n < 35)
    .sort((a, b) => a[0] - b[0])
    .map(([, name]) => name);

export const CARD_PRESET_SLOTS = 28;   // SlotPresetCardInt holds 28 slots per card preset

// ── Perks ─────────────────────────────────────────────────────
// BannedPerksIndex / AutoPickOrder / FirstPerkIndex values → site perk ids.
// Standard 0–14, UW 20–28, trade-off 40–49. UW and trade-off perks follow
// the wiki's order (every confirmed number matches it). Standard perks do
// NOT, so only the confirmed ones are listed; banned perks the file can't
// name keep what the player entered. null = a perk the site doesn't model.
// 0, 2 and 8 (and 22, 47) were read off the owner's Auto Pick list against
// AutoPickOrder (2026-11-02); 1, 4, 6, 7, 9, 11 and 13 sit further down it.
export const GAME_PERKS: Record<number, string | null> = {
    0: 'health',
    2: 'hregen',
    3: 'coins',
    5: 'interest',
    8: 'freeupg',
    10: null,   // Perk Wave Requirement
    12: null,   // Max Game Speed +1
    14: 'absdef',
    20: 'sm_qty', 21: 'ps_radius', 22: 'dw_wave',
    23: 'ilm_extra',   // Extra Set of Inner Mines (+6 mines)
    24: 'gt_bonus', 25: 'cl_dmg', 26: 'cf_dur', 27: 'bh_dur', 28: 'sl_bonus',
    40: 'to_dmg', 41: 'to_coins', 42: 'to_enemyhp', 43: 'to_enemydmg',
    44: 'to_rangeddistance', 45: 'to_espd', 46: 'to_cash', 47: 'to_regen',
    48: 'to_bosshp', 49: 'to_lifesteal',
};

// Site perk ids the export can identify — bans on any other perk are kept as entered.
export const MAPPED_PERK_IDS = new Set(
    Object.values(GAME_PERKS).filter((id): id is string => id !== null),
);

// ── Labs ──────────────────────────────────────────────────────
// ResearchLevel index → site lab name (LABS in gameData). The game numbers
// labs in blocks in the wiki's category order; labs added later got numbers
// further down. Each run below lines up level-for-level with a real account
// (most levels sitting exactly on that lab's max).
const labRun = (start: number, names: string[]): Record<number, string> =>
    Object.fromEntries(names.map((name, i) => [start + i, name]));

export const GAME_LABS: Record<number, string> = {
    ...labRun(0, [
        'Damage Lab', 'Attack Speed Lab', 'Critical Factor Lab', 'Range Lab',
        'Damage/Meter Lab', 'Super Crit Chance Lab', 'Super Crit Mult Lab',
    ]),
    ...labRun(10, [   // confirmed from the in-game Defense Research screen
        'Health Lab', 'Health Regen Lab', 'Defense Absolute Lab', 'Defense % Lab',
        'Orb Speed Lab', 'Land Mine Dmg Lab', 'Land Mine Decay', 'Shockwave Size Lab', 'Orb Boss Hit',
    ]),
    ...labRun(20, [   // confirmed from the in-game Utility Research screen
        'Cash Bonus Lab', 'Cash/Wave Lab', 'Coins/Kill Lab', 'Coins/Wave Lab',
        'Interest Lab', 'Max Interest', 'Package After Boss',
    ]),
    ...labRun(30, [   // confirmed from the in-game Main Research screen
        'Game Speed', 'Starting Cash', 'WS Atk Discount', 'WS Def Discount', 'WS Util Discount',
        'Labs Coin Discount', 'Labs Speed', 'Buy Multiplier', 'More Round Stats', 'Target Priority',
        'Card Presets', 'Workshop Respec',
    ]),
    ...labRun(50, [
        'SM-Despawn Time', 'SM-Explosion(unlock)', 'SM-Radius',
        'CF-Duration', 'CF-Dmg Reduction(unlock)', 'CF-Reduction %',
        'PS-Radius', 'PS-Stun(unlock)', 'PS-Stun Chance', 'PS-Stun Time',
        'GT-Bonus', 'GT-Duration',
        'CL-Shock(unlock)', 'CL-Shock Chance', 'CL-Shock Multiplier',
        'DW-Health', 'DW-Coins Bonus', 'ILM-Blast Radius', 'ILM-Rotation Speed', 'CF-Range',
    ]),
    ...labRun(70, [
        'SW Blast', 'Double Death Ray', 'Extra Orb Adjuster', 'Extra Extra Orbs',
        'Energy Shield Extra Hit', 'Super Tower Bonus',
    ]),
    ...labRun(80, [
        'Unlock Perks', 'Waves Required', 'Auto Pick Perks', 'Standard Perk Bonus',
        'Perk Option Qty', 'First Perk Choice',
    ]),
    87: 'Ban Perks',
    88: 'Improve Tradeoff Perks',
    ...labRun(90, [
        'SM-Amplifier', 'SM-Barrage(unlock)', 'SM-Barrage Qty', 'ILM-Stun(unlock)',
        'BH-Damage', 'BH-Extra(unlock)', 'BH-Coin Bonus', 'SL-Coin Bonus', 'SL-Missiles',
    ]),
    // 99–125 confirmed from the in-game Utility, Bots and Enemies screens.
    ...labRun(99, ['Recovery Pkg Amount', 'Recovery Pkg Max', 'Recovery Pkg Chance']),
    ...labRun(102, [
        'Flame Bot Cooldown', 'Thunder Bot Cooldown', 'Golden Bot Cooldown', 'Amplify Bot Cooldown',
        'Flame Bot Burn Stack', 'Thunder Bot Linger', 'Golden Bot Duration', 'Amplify Bot Duration',
    ]),
    ...labRun(110, [
        'Common Enemy Health', 'Common Enemy Attack', 'Fast Enemy Health', 'Fast Enemy Attack',
        'Fast Enemy Speed', 'Tank Enemy Health', 'Tank Enemy Attack', 'Ranged Enemy Health',
        'Ranged Enemy Attack', 'Boss Health', 'Boss Attack', 'Protector Health', 'Protector Radius',
        'Protector Dmg Reduction',
    ]),
    124: 'Enemy Atk Lvl Skip Lab',
    125: 'Enemy HP Lvl Skip Lab',
    ...labRun(126, [
        'Wall Health Lab', 'Wall Rebuild Lab', 'Wall Regen', 'Wall Thorns', 'Wall Invincibility',
        'Rend Armor Max',
    ]),
    ...labRun(139, [
        'Reroll Shards', 'Daily Mission Shards', 'Module Shard Cost', 'Module Coin Cost', 'Rare Drop Chance',
    ]),
    144: 'Wall Fortification',
    ...labRun(145, [
        'Recharge SW', 'Recharge Demon Mode', 'Recharge Nuke',
        'BH-Disable Ranged(unlock)', 'SM-Recharge Barrage',
    ]),
    ...labRun(152, ['Shatter Shards', 'Auto Pick Ranking', 'Enh Atk Discount']),
    ...labRun(156, ['PS-Swamp Rend', 'PS-Swamp Rend Extra', 'CL-Chain Thunder', 'CL-Lightning Amp']),
    // Confirmed from the in-game Ultimate Weapon Research screen (ILM Chrono
    // Jump is at level 0 there, so its number isn't known).
    ...labRun(190, ['DW-Cell Bonus', 'DW-Dmg Amplifier', 'DW-Armor Stripping']),
    ...labRun(194, ['Cannon Effect Bans', 'Armor Effect Bans', 'Generator Effect Bans', 'Core Effect Bans']),
    226: 'Ranged Enemy Range',   // the only remaining lab at its on-screen level
    227: 'Enh Util Discount',
    228: 'Bot Bot Cooldown',     // Bot Bot came later than the other bots
    229: 'Bot Bot Duration',
    ...labRun(230, [
        'Assist-Cannon Substat', 'Assist-Armor Substat', 'Assist-Generator Substat', 'Assist-Core Substat',
        'Assist-Cannon Mult', 'Assist-Armor Mult', 'Assist-Generator Mult', 'Assist-Core Mult',
    ]),
    // Not in the on-screen order: the three level-12 echoes were told apart by
    // their research progress (Attack 19% done, Ultimate Weapons researching).
    ...labRun(238, ['Dissonant Echo-Util', 'Dissonant Echo-Atk', 'Dissonant Echo-Def', 'Dissonant Echo-UW']),
    242: 'Overcharge Enemy Health',  // the only remaining lab at its on-screen level
    252: 'Global Presets',           // researched the day the game added it
};

// Labs known to occupy a set of numbers in an unknown order. A set is only
// imported when every number in it holds the same level — then the order
// can't change the result.
export const GAME_LAB_GROUPS: { labs: string[]; numbers: number[] }[] = [
    {
        // The one-level unlocks left after Workshop Respec (41) and Global Presets (252).
        labs: ['Reroll Daily Missions', 'Workshop Enhancement', 'Light Speed Shots', 'Unmerge Module'],
        numbers: [132, 133, 150, 151],
    },
    {
        // The three maxed level-10 labs left after every other level-10 lab was placed.
        labs: ['Common Drop Chance', 'Garlic Thorns', 'BC Reduction'],
        numbers: [134, 193, 199],
    },
];

// HighestLeague → league name (the game's 7 leagues, lowest first).
export const GAME_LEAGUES = ['Copper', 'Silver', 'Gold', 'Platinum', 'Champion', 'Legend', 'Mythic'] as const;
