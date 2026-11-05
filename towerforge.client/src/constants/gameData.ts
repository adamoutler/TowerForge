// ============================================================
//  TowerForge Companion — Game Data Constants
//  All verified game data. No logic. No magic numbers anywhere
//  else in the codebase — everything imports from here.
// ============================================================

import type { UWAbbr, ModuleRarity, ModuleType } from '../types/gameTypes';

// ── Tiers ─────────────────────────────────────────────────────
// The highest tier: TheTowerSDK's enemy tables run to T24.
export const MAX_TIER = 24;

// ── Workshop Stats ────────────────────────────────────────────
// [statName, maxLevel]
export const WS_STATS: Record<string, [string, number][]> = {
    attack: [
        ['Damage', 6000],
        ['Attack Speed', 99],
        ['Critical Chance', 79],
        ['Critical Factor', 150],
        ['Range', 79],
        ['Damage/Meter', 200],
        ['Multishot Chance', 99],
        ['Multishot Targets', 7],
        ['Rapid Fire Chance', 85],
        ['Rapid Fire Duration', 99],
        ['Bounce Shot Chance', 85],
        ['Bounce Shot Targets', 7],
        ['Bounce Shot Range', 60],
        ['Super Critical Chance', 100],
        ['Super Critical Mult', 120],
        ['Rend Armor Chance', 299],
        ['Rend Armor Mult', 299],
    ],
    defense: [
        ['Health', 6000],
        ['Health Regen', 6000],
        ['Defense %', 99],
        ['Defense Absolute', 5000],
        ['Thorn Damage', 99],
        ['Lifesteal', 80],
        ['Knockback Chance', 80],
        ['Knockback Force', 40],
        ['Orb Speed', 38],
        ['Orbs', 4],
        ['Shockwave Size', 35],
        ['Shockwave Frequency', 40],
        ['Land Mine Chance', 50],
        ['Land Mine Damage', 200],
        ['Land Mine Radius', 50],
        ['Death Defy', 75],
        ['Wall Health', 1800],
        ['Wall Rebuild', 300],
    ],
    utility: [
        ['Cash Bonus', 149],
        ['Cash/Wave', 149],
        ['Coin/Kill Bonus', 149],
        ['Coin/Wave', 149],
        ['Free Atk Upgrade', 99],
        ['Free Def Upgrade', 99],
        ['Free Util Upgrade', 99],
        ['Interest/Wave', 99],
        ['Recovery Amount', 300],
        ['Max Amount', 500],
        ['Package Chance', 60],
        ['Enemy Atk Level Skip', 699],
        ['Enemy HP Level Skip', 699],
    ],
};

// The workshop opens its stats in groups, each bought once with coins after
// the one before; group 0 is free from the start (utility has none). The
// export's Upgrade(Defense|Utility)TierUnlocked flag [k] = group k + 1 is
// bought. Order and coins from the wiki's workshop pages: attack 50 / 400 /
// 1,500 / 10,000 / 100M / 500B; defense 75 / 500 / 2,000 / 5,000 / 15,000 /
// 100,000 / 400,000 / 1.5M / 500M; utility 40 / 100 / … / 5,000 (Interest) /
// 1.5M (Recovery Packages) / 1B (Enemy Level Skip). Checked on two accounts
// (2026-10-26): a maxed one has every flag on; a new one has the first
// attack and defense groups and two utility ones, and levels only in
// groups it has (Defense Absolute, Coins/Kill and Coins/Wave).
export const WS_UNLOCK_GROUPS: Record<'attack' | 'defense' | 'utility', { label: string; stats: string[] }[]> = {
    attack: [
        { label: 'the start', stats: ['Damage', 'Attack Speed', 'Critical Chance', 'Critical Factor'] },
        { label: 'Range and Damage/Meter', stats: ['Range', 'Damage/Meter'] },
        { label: 'Multishot', stats: ['Multishot Chance', 'Multishot Targets'] },
        { label: 'Rapid Fire', stats: ['Rapid Fire Chance', 'Rapid Fire Duration'] },
        { label: 'Bounce Shot', stats: ['Bounce Shot Chance', 'Bounce Shot Targets', 'Bounce Shot Range'] },
        { label: 'Super Critical', stats: ['Super Critical Chance', 'Super Critical Mult'] },
        { label: 'Rend Armor', stats: ['Rend Armor Chance', 'Rend Armor Mult'] },
    ],
    defense: [
        { label: 'the start', stats: ['Health', 'Health Regen'] },
        { label: 'Defense % and Defense Absolute', stats: ['Defense %', 'Defense Absolute'] },
        { label: 'Thorn Damage', stats: ['Thorn Damage'] },
        { label: 'Lifesteal', stats: ['Lifesteal'] },
        { label: 'Knockback', stats: ['Knockback Chance', 'Knockback Force'] },
        { label: 'Orbs', stats: ['Orb Speed', 'Orbs'] },
        { label: 'Shockwave', stats: ['Shockwave Size', 'Shockwave Frequency'] },
        { label: 'Land Mines', stats: ['Land Mine Chance', 'Land Mine Damage', 'Land Mine Radius'] },
        { label: 'Death Defy', stats: ['Death Defy'] },
        { label: 'Wall', stats: ['Wall Health', 'Wall Rebuild'] },
    ],
    utility: [
        { label: 'the start', stats: [] },
        { label: 'Cash', stats: ['Cash Bonus', 'Cash/Wave'] },
        { label: 'Coins', stats: ['Coin/Kill Bonus', 'Coin/Wave'] },
        { label: 'Free Upgrades', stats: ['Free Atk Upgrade', 'Free Def Upgrade', 'Free Util Upgrade'] },
        { label: 'Interest', stats: ['Interest/Wave'] },
        { label: 'Recovery Packages', stats: ['Recovery Amount', 'Max Amount', 'Package Chance'] },
        { label: 'Enemy Level Skip', stats: ['Enemy Atk Level Skip', 'Enemy HP Level Skip'] },
    ],
};

// ── Workshop Enhancements ─────────────────────────────────────
// [name, maxLevel, isFreeUnlock, stepPerLevel]
export const WS_ENH: Record<string, [string, number, boolean, number][]> = {
    attack: [
        ['Damage', 400, true, 0.01],
        ['Critical Factor', 400, false, 0.01],
        ['Damage/Meter', 400, false, 0.01],
        ['Super Crit Multi', 400, false, 0.01],
        ['Attack Speed', 75, false, 0.01],
        ['Rend Armor', 400, false, 0.01],
    ],
    defense: [
        ['Health', 400, true, 0.01],
        ['Health Regen', 400, false, 0.01],
        ['Defense Absolute', 400, false, 0.01],
        ['Land Mine Damage', 400, false, 0.06],
        ['Wall Health', 400, false, 0.01],
        ['Orb Size', 200, false, 0.01],
    ],
    utility: [
        ['Cash Bonus', 400, true, 0.01],
        ['Coin Bonus', 200, false, 0.01],
        ['Cells/Kill Bonus', 200, false, 0.01],
        ['Free Upgrades', 100, false, 0.01],
        ['Recovery Package', 300, false, 0.01],
        ['Enemy Level Skips', 60, false, 0.01],
    ],
};

// ── Cards ─────────────────────────────────────────────────────
// [name, rarity(0=C,1=R,2=E), lockTier, lockWave, [vals lv1–7], unit]
export const CARDS: [string, number, number, number, number[], string][] = [
    ['Damage', 0, 0, 0, [1.5, 2, 2.4, 2.8, 3.2, 3.6, 4], 'x'],
    ['Attack Speed', 0, 0, 0, [1.25, 1.4, 1.55, 1.7, 1.85, 2, 2.15], 'x'],
    ['Health', 0, 0, 0, [1.5, 2, 2.4, 2.8, 3.2, 3.6, 4], 'x'],
    ['Health Regen', 0, 0, 0, [1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6], 'x'],
    ['Range', 0, 0, 0, [1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45], 'x'],
    ['Cash', 0, 0, 0, [1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4], 'x'],
    ['Coins', 0, 0, 0, [1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45], 'x'],
    ['Slow Aura', 0, 0, 0, [13, 16, 19, 22, 25, 28, 31], '%'],
    ['Critical Chance', 0, 0, 0, [5, 6, 7, 8, 9, 10, 11], '+%'],
    ['Enemy Balance', 0, 0, 0, [1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9], 'x'],
    ['Extra Defense', 0, 0, 0, [5, 6, 7, 8, 9, 10, 11], '+%'],
    ['Fortress', 0, 0, 0, [1.3, 1.45, 1.6, 1.75, 1.9, 2.05, 2.2], 'x'],
    ['Free Upgrades', 1, 0, 0, [4, 5, 6, 7, 8, 9, 10], '+%'],
    ['Extra Orb', 1, 0, 0, [.3, .4, .5, .6, .7, .8, .9], '+spd'],
    ['Plasma Cannon', 1, 0, 0, [30, 34, 38, 42, 46, 50, 54], '%hp'],
    ['Critical Coin', 1, 0, 0, [15, 18, 21, 24, 27, 30, 33], '%'],
    ['Wave Skip', 1, 0, 0, [9, 10, 11, 13, 15, 17, 19], '%'],
    ['Intro Sprint', 1, 0, 0, [20, 30, 40, 50, 60, 80, 100], 'waves'],
    ['Land Mine Stun', 1, 7, 250, [1.4, 1.8, 2.2, 2.6, 3, 3.4, 3.8], 'sec'],
    ['Recovery Pkg Chance', 1, 2, 750, [15, 18, 21, 24, 27, 30, 33], '+%'],
    ['Cells', 1, 4, 40, [2, 4, 6, 8, 10, 12, 14], ' cells'],   // Tier 4 milestone screen (owner, 2026-11-02)
    ['Death Ray', 2, 0, 0, [2.3, 2.7, 3.1, 3.5, 3.9, 4.4, 4.9], 'sec'],
    ['Energy Net', 2, 0, 0, [2.5, 2.8, 3.1, 3.4, 3.7, 4, 4.3], 'sec'],
    ['Super Tower', 2, 0, 0, [2.5, 2.9, 3.3, 3.7, 4.1, 4.5, 5], 'x'],
    ['Second Wind', 2, 0, 0, [10, 15, 20, 25, 30, 35, 40], 'sec'],
    ['Demon Mode', 2, 0, 0, [180, 200, 220, 240, 260, 280, 300], 'sec'],
    ['Energy Shield', 2, 0, 0, [20, 18, 16, 14, 12, 10, 8], 'min'],
    ['Wave Accelerator', 2, 0, 0, [30, 34, 38, 42, 46, 50, 54], '%'],
    ['Berserker', 2, 0, 0, [.8, .9, 1, 1.1, 1.2, 1.3, 1.4], '%'],
    ['Ultimate Crit', 2, 14, 50, [1, 1.33, 1.66, 2, 2.33, 2.66, 3], '%'],
    ['Nuke', 2, 11, 10, [25, 35, 45, 55, 65, 80, 100], '%'],
    ['Area of Effect', 2, 20, 80, [5, 8, 11, 14, 17, 20, 25], '+%'],
];

// ── Card Mastery Stone Costs ───────────────────────────────────
export const CARD_MASTERY_STONE_COSTS: Record<string, number> = {
    'Damage': 750, 'Attack Speed': 750, 'Health': 750,
    'Health Regen': 750, 'Range': 750, 'Cash': 500,
    'Coins': 1250, 'Slow Aura': 1000, 'Critical Chance': 750,
    'Enemy Balance': 1000, 'Extra Defense': 1000, 'Fortress': 750,
    'Free Upgrades': 500, 'Extra Orb': 750, 'Plasma Cannon': 1250,
    'Critical Coin': 1000, 'Wave Skip': 1000, 'Intro Sprint': 1250,
    'Land Mine Stun': 1000, 'Recovery Pkg Chance': 1000, 'Cells': 1000,
    'Death Ray': 750, 'Energy Net': 750, 'Super Tower': 1000,
    'Second Wind': 1000, 'Demon Mode': 1000, 'Energy Shield': 1000,
    'Wave Accelerator': 1000, 'Berserker': 750, 'Ultimate Crit': 750,
    'Nuke': 750, 'Area of Effect': 1000,
};

// ── Card Mastery Values (lv 0–9) ──────────────────────────────
export const CARD_MASTERY_VALS: Record<string, number[]> = {
    'Damage': [1.4, 1.8, 2.2, 2.6, 3.0, 3.4, 3.8, 4.2, 4.6, 5.0],
    'Attack Speed': [1.03, 1.06, 1.09, 1.12, 1.15, 1.18, 1.21, 1.24, 1.27, 1.3],
    'Critical Chance': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    'Range': [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0],
    'Slow Aura': [1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5],
    'Super Tower': [3, 6, 9, 12, 15, 18, 21, 24, 27, 30],
    'Health': [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0],
    'Health Regen': [1.4, 1.8, 2.2, 2.6, 3.0, 3.4, 3.8, 4.2, 4.6, 5.0],
    'Extra Defense': [0.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9, 5.6, 6.3, 7.0],
    'Coins': [1.03, 1.06, 1.09, 1.12, 1.15, 1.18, 1.21, 1.24, 1.27, 1.3],
    'Cash': [0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0],
    'Enemy Balance': [6, 12, 18, 24, 30, 36, 42, 48, 54, 60],
    'Extra Orb': [1.04, 1.08, 1.12, 1.16, 1.2, 1.24, 1.28, 1.32, 1.36, 1.4],
    'Critical Coin': [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    'Wave Skip': [10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
    'Land Mine Stun': [2.7, 5.4, 8.1, 10.8, 13.5, 16.2, 18.9, 21.6, 24.3, 27],
    'Recovery Pkg Chance': [0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0],
    'Cells': [1.05, 1.08, 1.11, 1.14, 1.17, 1.2, 1.23, 1.26, 1.29, 1.32],
    'Death Ray': [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    'Energy Net': [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
    'Second Wind': [1.9, 2.8, 3.7, 4.6, 5.5, 6.4, 7.3, 8.2, 9.1, 10],
    'Demon Mode': [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6],
    'Nuke': [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    'Ultimate Crit': [0.3, 0.7, 1.0, 1.3, 1.7, 2.0, 2.3, 2.7, 3.0, 3.3],
    'Area of Effect': [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25],
    'Berserker': [30, 60, 90, 120, 150, 180, 210, 240, 270, 300],
    'Free Upgrades': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    'Intro Sprint': [1.8, 3.6, 5.4, 7.2, 9, 10.8, 12.6, 14.4, 16.2, 18],
    'Wave Accelerator': [110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
    'Plasma Cannon': [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    'Energy Shield': [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
    'Fortress': [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
};

// ── UW Definitions ────────────────────────────────────────────
export const UWS: {
    n: string; a: UWAbbr;
    s: [string, number][];
    up: string; upMax: number;
}[] = [
        { n: 'Chain Lightning', a: 'CL', s: [['Damage', 32], ['Quantity', 5], ['Chance', 16]], up: 'Smite', upMax: 11 },
        { n: 'Smart Missiles', a: 'SM', s: [['Damage', 36], ['Quantity', 16], ['Cooldown', 17]], up: 'Cover Fire', upMax: 11 },
        { n: 'Death Wave', a: 'DW', s: [['Damage', 31], ['Effect Waves', 5], ['Cooldown', 26]], up: 'Kill Wall', upMax: 14 },
        { n: 'Chrono Field', a: 'CF', s: [['Duration', 36], ['Slow', 12], ['Cooldown', 13]], up: 'Chrono Loop', upMax: 13 },
        { n: 'Inner Land Mines', a: 'ILM', s: [['Damage', 36], ['Quantity', 4], ['Cooldown', 16]], up: 'Charged Mine', upMax: 14 },
        { n: 'Golden Tower', a: 'GT', s: [['Multiplier', 21], ['Duration', 39], ['Cooldown', 21]], up: 'Golden Combo', upMax: 14 },
        { n: 'Poison Swamp', a: 'PS', s: [['Damage', 36], ['Duration', 15], ['Cooldown', 16]], up: 'Death Creep', upMax: 14 },
        { n: 'Black Hole', a: 'BH', s: [['Size', 21], ['Duration', 24], ['Cooldown', 16]], up: 'Consume', upMax: 14 },
        { n: 'Spotlight', a: 'SL', s: [['Bonus', 31], ['Angle', 61], ['Quantity', 4]], up: 'Light Range', upMax: 14 },
    ];

// ── UW Stat Display Values ─────────────────────────────────────
export const UW_STAT_VALUES: Record<UWAbbr, string[][]> = {
    CL: [
        ['2x', '3x', '5x', '9x', '14x', '22x', '32x', '46x', '63x', '85x', '113x', '148x', '191x', '244x', '309x', '387x', '482x', '596x', '733x', '898x', '1094x', '1328x', '1607x', '1937x', '2329x', '2794x', '3342x', '3990x', '4755x', '5655x', '6715x', '7961x'],
        ['1', '2', '3', '4', '5'],
        ['5.0%', '6.5%', '8.0%', '9.5%', '11.0%', '12.5%', '14.0%', '15.5%', '17.0%', '18.5%', '20.0%', '21.5%', '23.0%', '24.5%', '26.0%', '27.5%'],
    ],
    SM: [
        ['10x', '11x', '13x', '16x', '20x', '26x', '34x', '43x', '55x', '69x', '87x', '108x', '134x', '164x', '200x', '243x', '293x', '352x', '421x', '502x', '597x', '708x', '838x', '989x', '1165x', '1370x', '1608x', '1886x', '2209x', '2585x', '3021x', '3776x', '4720x', '5900x', '7375x', '9219x'],
        ['5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'],
        ['180s', '170s', '160s', '150s', '140s', '130s', '120s', '110s', '100s', '90s', '80s', '70s', '60s', '50s', '40s', '30s', '20s'],
    ],
    DW: [
        ['2x', '3x', '5x', '9x', '14x', '22x', '32x', '46x', '63x', '85x', '113x', '148x', '191x', '244x', '309x', '387x', '482x', '596x', '723x', '877x', '1064x', '1290x', '1569x', '1916x', '2356x', '2919x', '3637x', '4544x', '5678x', '7078x', '9119x'],
        ['1', '2', '3', '4', '5'],
        ['300s', '290s', '280s', '270s', '260s', '250s', '240s', '230s', '220s', '210s', '200s', '190s', '180s', '170s', '160s', '150s', '140s', '130s', '120s', '110s', '100s', '90s', '80s', '70s', '60s', '50s'],
    ],
    CF: [
        ['5s', '6s', '7s', '8s', '9s', '10s', '11s', '12s', '13s', '14s', '15s', '16s', '17s', '18s', '19s', '20s', '21s', '22s', '23s', '24s', '25s', '26s', '27s', '28s', '29s', '30s', '31s', '32s', '33s', '34s', '35s', '36s', '37s', '38s', '39s', '40s'],
        ['20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%'],
        ['180s', '170s', '160s', '150s', '140s', '130s', '120s', '110s', '100s', '90s', '80s', '70s', '60s'],
    ],
    ILM: [
        ['10x', '11x', '13x', '16x', '20x', '26x', '34x', '43x', '55x', '69x', '87x', '108x', '134x', '164x', '200x', '243x', '293x', '352x', '421x', '502x', '597x', '708x', '838x', '989x', '1165x', '1370x', '1608x', '1886x', '2209x', '2585x', '3021x', '3776x', '4720x', '5900x', '7375x', '9219x'],
        ['3', '4', '5', '6'],
        ['200s', '190s', '180s', '170s', '160s', '150s', '140s', '130s', '120s', '110s', '100s', '90s', '80s', '70s', '60s', '50s'],
    ],
    GT: [
        ['5.0x', '5.8x', '6.6x', '7.4x', '8.2x', '9.0x', '9.8x', '10.6x', '11.4x', '12.2x', '13.0x', '13.8x', '14.6x', '15.4x', '16.2x', '17.0x', '17.8x', '18.6x', '19.4x', '20.2x', '21.0x'],
        ['15s', '16s', '17s', '18s', '19s', '20s', '21s', '22s', '23s', '24s', '25s', '26s', '27s', '28s', '29s', '30s', '31s', '32s', '33s', '34s', '35s', '36s', '37s', '38s', '39s', '40s', '41s', '42s', '43s', '44s', '45s', '46s', '47s', '48s', '49s', '50s', '51s', '52s', '53s'],
        ['300s', '290s', '280s', '270s', '260s', '250s', '240s', '230s', '220s', '210s', '200s', '190s', '180s', '170s', '160s', '150s', '140s', '130s', '120s', '110s', '100s'],
    ],
    PS: [
        ['10x', '11x', '13x', '16x', '20x', '26x', '34x', '43x', '55x', '69x', '87x', '108x', '134x', '164x', '200x', '243x', '293x', '352x', '421x', '502x', '597x', '708x', '838x', '989x', '1165x', '1370x', '1608x', '1886x', '2209x', '2585x', '3021x', '3776x', '4720x', '5900x', '7375x', '9219x'],
        ['30s', '35s', '40s', '45s', '50s', '55s', '60s', '65s', '70s', '75s', '80s', '85s', '90s', '95s', '100s'],
        ['125s', '120s', '115s', '110s', '105s', '100s', '95s', '90s', '85s', '80s', '75s', '70s', '65s', '60s', '55s', '50s'],
    ],
    BH: [
        ['30m', '32m', '34m', '36m', '38m', '40m', '42m', '44m', '46m', '48m', '50m', '52m', '54m', '56m', '58m', '60m', '62m', '64m', '66m', '68m', '70m'],
        ['15s', '16s', '17s', '18s', '19s', '20s', '21s', '22s', '23s', '24s', '25s', '26s', '27s', '28s', '29s', '30s', '31s', '32s', '33s', '34s', '35s', '36s', '37s', '38s'],
        ['200s', '190s', '180s', '170s', '160s', '150s', '140s', '130s', '120s', '110s', '100s', '90s', '80s', '70s', '60s', '50s'],
    ],
    SL: [
        ['8x', '9.4x', '10.8x', '12.2x', '13.6x', '15.0x', '16.4x', '17.8x', '19.2x', '20.6x', '22.0x', '23.4x', '24.8x', '26.2x', '27.6x', '29.0x', '30.4x', '31.8x', '33.2x', '34.6x', '36.0x', '37.4x', '38.8x', '40.2x', '41.6x', '43.0x', '44.4x', '45.8x', '47.2x', '48.6x', '50.0x'],
        ['30°', '31°', '32°', '33°', '34°', '35°', '36°', '37°', '38°', '39°', '40°', '41°', '42°', '43°', '44°', '45°', '46°', '47°', '48°', '49°', '50°', '51°', '52°', '53°', '54°', '55°', '56°', '57°', '58°', '59°', '60°', '61°', '62°', '63°', '64°', '65°', '66°', '67°', '68°', '69°', '70°', '71°', '72°', '73°', '74°', '75°', '76°', '77°', '78°', '79°', '80°', '81°', '82°', '83°', '84°', '85°', '86°', '87°', '88°', '89°', '90°'],
        ['1', '2', '3', '4'],
    ],
};

// A stat's values by level; the SL Angle stops at 60° — the table goes
// to 90°, but past 60° it adds nothing, so stones aren't spent on it.
export function uwStatValues(abbr: UWAbbr, statIdx: number): string[] {
    const vals = UW_STAT_VALUES[abbr]?.[statIdx] ?? [];
    return abbr === 'SL' && statIdx === 1 ? vals.filter(v => parseInt(v) <= 60) : vals;
}

// ── UW Stone Costs ─────────────────────────────────────────────
// FLAT cost per upgrade (not cumulative). Index = current level.
export const UW_STONE_COSTS: Record<UWAbbr, number[][]> = {
    CL: [
        [5, 11, 17, 23, 29, 35, 41, 47, 53, 61, 71, 84, 100, 120, 144, 174, 210, 252, 302, 362, 434, 525, 636, 767, 923, 1109, 1295, 1521, 1787, 2103, 2469],
        [30, 75, 150, 400],
        [8, 26, 44, 62, 80, 98, 116, 134, 152, 170, 188, 206, 224, 242, 260],
    ],
    SM: [
        [5, 11, 17, 23, 29, 35, 41, 47, 53, 61, 71, 84, 100, 120, 144, 174, 210, 252, 302, 362, 432, 528, 654, 810, 996, 1222, 1488, 1804, 2180, 2636, 2742, 2848, 2954, 3060, 3166],
        [4, 12, 35, 70, 120, 180, 275, 350, 420, 500, 600, 750, 950, 1200, 1500],
        [8, 24, 40, 56, 72, 88, 104, 120, 136, 152, 168, 184, 200, 216, 232, 750],
    ],
    DW: [
        [5, 11, 17, 23, 29, 35, 41, 47, 53, 61, 71, 84, 100, 120, 144, 174, 210, 254, 308, 374, 452, 558, 694, 880, 1126, 1432, 1813, 2269, 2800, 3406],
        [200, 500, 850, 1400],
        [8, 24, 40, 56, 72, 88, 104, 120, 136, 152, 168, 184, 200, 216, 232, 248, 264, 280, 346, 512, 688, 874, 1070, 1276, 1492],
    ],
    CF: [
        [5, 14, 23, 32, 41, 50, 59, 68, 77, 86, 95, 104, 113, 122, 131, 140, 149, 158, 167, 176, 185, 194, 203, 212, 221, 230, 239, 248, 257, 266, 275, 284, 293, 302, 311],
        [15, 25, 40, 60, 120, 150, 200, 300, 450, 650, 900],
        [10, 31, 52, 73, 94, 115, 136, 157, 178, 199, 220, 241],
    ],
    ILM: [
        [5, 11, 17, 23, 29, 35, 41, 47, 53, 61, 71, 84, 100, 120, 144, 174, 210, 254, 308, 374, 454, 540, 632, 730, 834, 944, 1060, 1182, 1312, 1448, 1592, 1742, 1898, 2060, 2228],
        [50, 125, 250],
        [8, 24, 40, 56, 72, 88, 104, 120, 136, 152, 168, 184, 200, 216, 232],
    ],
    GT: [
        [5, 13, 22, 32, 43, 55, 68, 82, 98, 116, 138, 162, 250, 350, 500, 700, 950, 1250, 1600, 2000],
        [5, 14, 23, 32, 41, 50, 59, 68, 77, 87, 98, 110, 123, 137, 152, 168, 185, 203, 222, 242, 263, 285, 308, 332, 356, 380, 404, 428, 452, 476, 530, 614, 728, 872, 1046, 1250, 1484, 1748],
        [10, 28, 46, 64, 82, 100, 118, 136, 154, 172, 190, 208, 226, 244, 262, 300, 368, 476, 644, 872],
    ],
    PS: [
        [5, 11, 17, 23, 29, 35, 41, 47, 53, 61, 71, 84, 100, 120, 144, 174, 210, 252, 302, 362, 434, 525, 636, 772, 938, 1134, 1360, 1616, 1902, 2228, 2594, 2800, 3006, 3212, 3418],
        [10, 20, 35, 55, 100, 120, 150, 200, 260, 330, 410, 500, 600, 710],
        [8, 26, 44, 62, 80, 98, 116, 134, 152, 170, 188, 206, 224, 242, 260],
    ],
    BH: [
        [5, 12, 19, 26, 34, 43, 53, 64, 76, 89, 103, 118, 134, 151, 169, 189, 211, 236, 264, 295],
        [5, 14, 23, 32, 41, 50, 59, 68, 77, 86, 95, 104, 113, 122, 131, 165, 224, 308, 417, 551, 710, 894, 1103],
        [10, 28, 46, 64, 82, 100, 118, 136, 154, 172, 190, 208, 226, 244, 262],
    ],
    SL: [
        [5, 13, 21, 30, 40, 52, 65, 80, 95, 112, 133, 150, 180, 220, 280, 320, 360, 420, 500, 600, 720, 850, 1000, 1175, 1400, 1650, 1925, 2225, 2550, 2900],
        [5, 16, 27, 38, 49, 60, 71, 82, 93, 104, 115, 126, 137, 148, 159, 170, 181, 192, 203, 214, 225, 236, 247, 258, 269, 280, 291, 302, 313, 324, 337, 352, 369, 388, 409, 432, 457, 484, 513, 544, 577, 612, 649, 688, 729, 772, 817, 864, 913, 964, 1017, 1072, 1129, 1188, 1249, 1312, 1377, 1444, 1513, 1584],
        [375, 850, 2500],
    ],
};

// ── UW+ Unlock Costs (sequential) ─────────────────────────────
export const UW_PLUS_UNLOCK_COSTS: number[] = [500, 625, 750, 975, 1250, 1650, 2200, 2900, 3800];

// Stone cost to unlock each successive BASE Ultimate Weapon. Single global
// sequence indexed by how many UWs you already own: index 0 = 1st UW,
// index 1 = 2nd, … index 8 = 9th. The UW tab shows the next entry while
// fewer than 9 are owned. (Verified in-game; total to unlock all 9 = 9,705.)
export const UW_UNLOCK_COSTS: number[] = [5, 50, 150, 300, 800, 1250, 1750, 2400, 3000];

// ── UW+ Data ──────────────────────────────────────────────────
export const UW_PLUS_DATA: Record<UWAbbr, {
    name: string; abbr: UWAbbr; desc: string;
    vals: string[]; unit: string; costs: number[];
}> = {
    CL: { name: 'Smite', abbr: 'CL', desc: 'Every CL hit has a {CL Chance}% chance to deal X% of current wave HP (max 100 hits/enemy)', vals: ['0.05%', '0.10%', '0.15%', '0.20%', '0.25%', '0.30%', '0.35%', '0.40%', '0.45%', '0.50%', '0.55%', '0.60%'], unit: '% wave HP', costs: [300, 375, 475, 600, 725, 925, 1150, 1450, 1800, 2200, 2650, 3150, 3700, 4300] },
    SM: { name: 'Cover Fire', abbr: 'SM', desc: 'Launch an additional Smart Missile every X seconds', vals: ['13s', '12s', '11s', '10s', '9s', '8s', '7s', '6s', '5s', '4s', '3s', '2s'], unit: 's interval', costs: [300, 375, 475, 600, 725, 925, 1150, 1450, 1800, 2200, 2650, 3150, 3700, 4300] },
    PS: { name: 'Death Creep', abbr: 'PS', desc: 'Every PS damage tick increases by X% of its base damage', vals: ['120%', '190%', '260%', '330%', '400%', '470%', '540%', '610%', '680%', '750%', '820%', '890%', '960%', '1030%', '1110%'], unit: '% base/tick', costs: [300, 375, 475, 600, 725, 925, 1150, 1450, 1800, 2200, 2650, 3150, 3700, 4300] },
    GT: { name: 'Golden Combo', abbr: 'GT', desc: 'After GT finishes, gain extra cash and coins of X% per enemy killed', vals: ['0.03%', '0.06%', '0.09%', '0.12%', '0.15%', '0.18%', '0.21%', '0.24%', '0.27%', '0.30%', '0.33%', '0.36%', '0.39%', '0.42%', '0.45%'], unit: '%/kill', costs: [300, 360, 430, 510, 620, 750, 900, 1100, 1350, 1650, 2050, 2600, 3300, 4150] },
    ILM: { name: 'Charged Mine', abbr: 'ILM', desc: 'ILM damage increases X times per second while alive', vals: ['0.50x', '1.5x', '2.9x', '4.7x', '6.9x', '9.5x', '12.5x', '15.9x', '19.7x', '23.9x', '28.5x', '33.5x', '38.9x', '44.7x', '50.9x'], unit: '×/s', costs: [300, 360, 430, 510, 620, 750, 900, 1100, 1350, 1650, 2050, 2600, 3300, 4150] },
    DW: { name: 'Kill Wall', abbr: 'DW', desc: 'Each Effect Wave hit amplifies the Death Wave damage store by X (additively)', vals: ['3x', '4x', '6x', '9x', '13x', '18x', '24x', '31x', '39x', '48x', '58x', '69x', '81x', '94x', '108x'], unit: '× amplifier', costs: [400, 500, 610, 730, 860, 1000, 1150, 1300, 1500, 1700, 1950, 2200, 2450, 2700] },
    BH: { name: 'Consume', abbr: 'BH', desc: 'Each Black Hole deals X% of current wave HP to every affected enemy at end', vals: ['5%', '10%', '15%', '20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%'], unit: '% wave HP', costs: [400, 500, 610, 730, 860, 1000, 1150, 1300, 1500, 1700, 1950, 2200, 2450, 2700] },
    CF: { name: 'Chrono Loop', abbr: 'CF', desc: 'Enemies in CF spiral toward tower at rotation rate X (adds hidden slow)', vals: ['0.10', '0.15', '0.20', '0.25', '0.30', '0.35', '0.40', '0.45', '0.50', '0.55', '0.60', '0.65', '0.70', '0.75'], unit: 'rotation rate', costs: [400, 500, 610, 730, 860, 1000, 1150, 1300, 1500, 1700, 1950, 2200, 2450, 2700] },
    SL: { name: 'Light Range', abbr: 'SL', desc: 'Spotlight damage bonus boosted by X × your Damage/Meter', vals: ['0.01x', '0.02x', '0.03x', '0.04x', '0.05x', '0.06x', '0.07x', '0.08x', '0.09x', '0.10x', '0.11x', '0.12x', '0.13x', '0.14x', '0.15x'], unit: '× dmg/meter', costs: [400, 500, 610, 730, 860, 1000, 1150, 1300, 1500, 1700, 1950, 2200, 2450, 2700] },
};

// ── Relics ─────────────────────────────────────────────────────
// [key, label, displayMax, numericMax, unit]
// Same order and grouping as the game's relic bonus screen (Relics → ⓘ), so
// players can copy it top to bottom. The third/fourth columns are the total of
// all relics known to the wiki (players with newer relics can exceed them).
export const RELICS: Record<string, [string, string, string, number, string][]> = {
    Attack: [
        ['rDmg', 'Damage', '121%', 121, '%'],
        ['rAtkSpd', 'Attack Speed', '19%', 19, '%'],
        ['rCrit', 'Crit Chance', '16%', 16, '%'],
        ['rCritFac', 'Crit Factor', '112%', 112, '%'],
        ['rDmgM', 'Damage/Meter', '83%', 83, '%'],
        ['rSCrit', 'Super Crit Chance', '6%', 6, '%'],
        ['rSCritM', 'Super Crit Factor', '5%', 5, '%'],
        ['rRend', 'Rend Armor Mult', '2%', 2, '%'],
    ],
    Defense: [
        ['rHP', 'Health', '116%', 116, '%'],
        ['rRegen', 'Health Regen', '39%', 39, '%'],
        ['rDefPct', 'Defense %', '6%', 6, '%'],
        ['rDefAbs', 'Defense Absolute', '76%', 76, '%'],
        ['rThorns', 'Thorn Damage', '14%', 14, '%'],
        ['rKB', 'Knockback Force', '33%', 33, '%'],
        ['rOrb', 'Orb Speed', '28%', 28, '%'],
        ['rWall', 'Wall Rebuild', '2s reduction', 2, 's'],
    ],
    Utility: [
        ['rCash', 'Cash', '39%', 39, '%'],
        ['rCoins', 'Coins', '90%', 90, '%'],
        ['rFAtk', 'Free Attack Upgrade', '16%', 16, '%'],
        ['rFDef', 'Free Defense Upgrade', '9%', 9, '%'],
        ['rFUtil', 'Free Utility Upgrade', '10%', 10, '%'],
        ['rRecov', 'Recovery Amount', '22%', 22, '%'],
        ['rEAtkSkip', 'Enemy Attack Level Skip', '2%', 2, '%'],
        ['rEHPSkip', 'Enemy Health Level Skip', '2%', 2, '%'],
    ],
    Other: [
        ['rUWDmg', 'Ultimate Damage', '50%', 50, '%'],
        ['rLabSpd', 'Lab Speed', '79%', 79, '%'],
        ['rBotRange', 'Bot Range', '12m', 12, 'm'],
    ],
};

// ── Perks ──────────────────────────────────────────────────────
export const PERKS: {
    id: string; name: string;
    type: 'standard' | 'uw' | 'tradeoff';
    stat: string;
    baseVal?: number; maxQty?: number; spbScales?: boolean; additive?: boolean;
    mult?: number; add?: number; uw?: UWAbbr;
    benefit?: Record<string, number>;
    penalty?: Record<string, number | boolean>;
}[] = [
        // Standard
        { id: 'dmg', name: 'Damage ×1.15', type: 'standard', stat: 'dmg', baseVal: 0.15, maxQty: 5, spbScales: true },
        { id: 'coins', name: 'All Coin Bonuses ×1.15', type: 'standard', stat: 'coins', baseVal: 0.15, maxQty: 5, spbScales: true },
        { id: 'cash', name: 'Cash Bonus ×1.15', type: 'standard', stat: 'cash', baseVal: 0.15, maxQty: 5, spbScales: true },
        { id: 'health', name: 'Max Health ×1.20', type: 'standard', stat: 'health', baseVal: 0.20, maxQty: 5, spbScales: true },
        { id: 'hregen', name: 'Health Regen ×1.75', type: 'standard', stat: 'hregen', baseVal: 0.75, maxQty: 5, spbScales: true },
        { id: 'interest', name: 'Interest ×1.50', type: 'standard', stat: 'interest', baseVal: 0.50, maxQty: 5, spbScales: true },
        { id: 'lmdmg', name: 'Land Mine Damage ×3.50', type: 'standard', stat: 'lmdmg', baseVal: 2.50, maxQty: 5, spbScales: true },
        { id: 'freeupg', name: 'Free Upgrade Chance +5%', type: 'standard', stat: 'freeupg', baseVal: 0.05, maxQty: 5, spbScales: true },
        { id: 'defpct', name: 'Defense % +4', type: 'standard', stat: 'defpct', baseVal: 4, maxQty: 5, spbScales: true, additive: true },
        { id: 'absdef', name: 'Defense Absolute x1.15', type: 'standard', stat: 'defabs', baseVal: .15, maxQty: 5, spbScales: true },
        // UW perks
        { id: 'cl_dmg', name: 'CL Damage ×2', type: 'uw', stat: 'cl_dmg', mult: 2.0, uw: 'CL' },
        { id: 'sl_bonus', name: 'SL Damage Bonus ×1.5', type: 'uw', stat: 'sl_bonus', mult: 1.5, uw: 'SL' },
        { id: 'dw_wave', name: 'DW +1 Effect Wave', type: 'uw', stat: 'dw_wave', add: 1, uw: 'DW' },
        { id: 'sm_qty', name: 'SM +4 Missiles', type: 'uw', stat: 'sm_qty', add: 4, uw: 'SM' },
        { id: 'bh_dur', name: 'BH Duration +12s', type: 'uw', stat: 'bh_dur', add: 12, uw: 'BH' },
        { id: 'cf_dur', name: 'CF Duration +5s', type: 'uw', stat: 'cf_dur', add: 5, uw: 'CF' },
        { id: 'ilm_extra', name: 'ILM +6 Mines', type: 'uw', stat: 'ilm_extra', add: 6, uw: 'ILM' },
        { id: 'gt_bonus', name: 'GT Bonus ×1.5', type: 'uw', stat: 'gt_bonus', mult: 1.5, uw: 'GT' },
        { id: 'ps_radius', name: 'PS Swamp Radius ×1.5', type: 'uw', stat: 'ps_radius', mult: 1.5, uw: 'PS' },
        // Trade-offs
        { id: 'to_dmg', name: 'Tower Dmg ×1.5 / Boss HP ×8', type: 'tradeoff', stat: 'to_dmg', benefit: { dmg: 0.5 }, penalty: { bossHp: 7 } },
        { id: 'to_coins', name: 'Coins ×1.8 / Tower HP -70%', type: 'tradeoff', stat: 'to_coins', benefit: { coins: 0.8 }, penalty: { towerHp: -0.7 } },
        { id: 'to_enemyhp', name: 'Enemy HP -50% / Regen -90%', type: 'tradeoff', stat: 'to_enemyhp', benefit: { enemyHp: -0.5 }, penalty: { regen: -0.9 } },
        { id: 'to_enemydmg', name: 'Enemy Dmg -50% / Tower Dmg -50%', type: 'tradeoff', stat: 'to_enemydmg', benefit: { enemyDmg: -0.5 }, penalty: { dmg: -0.5 } },
        { id: 'to_espd', name: 'Enemy Speed -40% / Enemy Dmg ×2.5', type: 'tradeoff', stat: 'to_espd', benefit: { enemySpd: -0.4 }, penalty: { enemyDmg: 1.5 } },
        { id: 'to_cash', name: 'Cash ×12 / Kills No Cash', type: 'tradeoff', stat: 'to_cash', benefit: { cash: 11 }, penalty: { killCash: true } },
        { id: 'to_regen', name: 'Health Regen ×8 / Max HP -60%', type: 'tradeoff', stat: 'to_regen', benefit: { hregen: 7 }, penalty: { towerHp: -0.6 } },
        { id: 'to_bosshp', name: 'Boss HP -70% / Boss Speed +50%', type: 'tradeoff', stat: 'to_bosshp', benefit: { bossHp: -0.7 }, penalty: { bossSpd: 0.5 } },
        { id: 'to_lifesteal', name: 'Lifesteal ×2.5 / Knockback -70%', type: 'tradeoff', stat: 'to_lifesteal', benefit: { lifesteal: 1.5 }, penalty: { knockback: -0.7 } },
        { id: 'to_rangeddistance', name: 'Range Enemy Attack Distance Reduced / Ranged Dmg ×3', type: 'tradeoff', stat: 'to_rangeddistance', benefit: { rangeEnemyAttackDistance: -0.5 }, penalty: { rangedDmg: 3.0 } },
    ];

// ── Enemy Base Speeds ──────────────────────────────────────────
// FIXED — do not scale with wave/tier above ~3500
export const ENEMY_BASE_SPEEDS: Record<string, number> = {
    Basic: 12.00,
    Fast: 56.00,
    Tank: 7.20,
    Ranged: 12.00,
    Boss: 7.20,
    Protector: 4.80,
    Vampire: 4.80,
    Scatter: 7.20,
    Ray: 4.80,
    Saboteur: 2.10,
    Commander: 0.60,
    Overcharge: 1.20,
};

// ── Engine Constants ───────────────────────────────────────────

// CF+ hidden slow — exact measured values from Priesten/yournicknm/Tremnen.
// NOT rotRate/2. CF+ is a PATH LENGTH mechanic, not a speed slow.
// Bypasses the 90% slow cap entirely.
export const CF_PLUS_HIDDEN_SLOW: number[] = [
    0.025, 0.05, 0.10, 0.15, 0.20, 0.25,
    0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65,
];

// DW normalization — required because DW damage stat is not
// comparable to other UW damage stats at face value.
export const DW_NORM = 0.012;

// Super Tower constants
export const ST_BASE_DURATION = 15;   // seconds
export const ST_BASE_COOLDOWN = 30;   // seconds
export const ST_UW_BONUS_SHARE = 0.35; // 35% of ST bonus applies to UWs
export const ST_LAB_PER_LEVEL = 0.1;  // ESTIMATED — verify in-game

// Assist module max stone efficiency per slot
export const ASSIST_MAX_STONE_PCT = 70;
export const ASSIST_MAX_LAB_LV = 30;
export const ASSIST_TOTAL_STONES = 8073;

// ── Module Main-Effect Multiplier Tables ──────────────────────
// Source: ModLevels.xlsx (user-verified game data).
// A module's MAIN effect (cannon → Tower Damage, core → Ultimate
// Weapon Damage, armor → Defense%, generator → economy) is a
// multiplier computed as:
//     mult(level) = BASE_STAT[rarity][type] + Σ increment[1..level]
// where the per-level increment is bracketed by level and differs
// per module type. Verified anchors: A5★ cannon ≈ ×3.34 @ L111,
// A3★ core ≈ ×4.82 @ L108 (matches in-game ×3.293 / ×4.770).
//
// Base stat is the level-0 value (already in 1.0x form, e.g. a Common
// cannon starts at ×1.012). Brackets list [startLevel, ratePerLevel];
// a rate applies from its startLevel until the next bracket. The 160+
// rate holds to the level cap (300).
export const MODULE_BASE_STATS: Record<ModuleRarity, Record<ModuleType, number>> = {
    C:  { cannon: 1.012, armor: 1.012, generator: 1.011, core: 1.04 },
    R:  { cannon: 1.032, armor: 1.032, generator: 1.013, core: 1.06 },
    Rp: { cannon: 1.052, armor: 1.052, generator: 1.016, core: 1.09 },
    E:  { cannon: 1.072, armor: 1.072, generator: 1.019, core: 1.13 },
    Ep: { cannon: 1.102, armor: 1.102, generator: 1.023, core: 1.16 },
    L:  { cannon: 1.132, armor: 1.132, generator: 1.026, core: 1.21 },
    Lp: { cannon: 1.162, armor: 1.162, generator: 1.029, core: 1.26 },
    M:  { cannon: 1.202, armor: 1.202, generator: 1.033, core: 1.31 },
    Mp: { cannon: 1.252, armor: 1.252, generator: 1.036, core: 1.36 },
    A:  { cannon: 1.302, armor: 1.302, generator: 1.041, core: 1.41 },
    A1: { cannon: 1.314, armor: 1.314, generator: 1.043, core: 1.426 },
    A2: { cannon: 1.326, armor: 1.326, generator: 1.044, core: 1.443 },
    A3: { cannon: 1.338, armor: 1.338, generator: 1.046, core: 1.459 },
    A4: { cannon: 1.350, armor: 1.350, generator: 1.048, core: 1.476 },
    A5: { cannon: 1.362, armor: 1.362, generator: 1.049, core: 1.492 },
};

// [startLevel, ratePerLevel] — increment added at each level >= startLevel
// until the next bracket. Verified from 14,400 real module data points (all 12
// rarities × 4 types × 300 levels from ModLevelsTrue.csv). Cannon and Armor
// share the same curve. Rates were constant through all 300 levels per bracket.
export const MODULE_INCREMENT_BRACKETS: Record<ModuleType, [number, number][]> = {
    cannon:    [[1, 0.01149495], [100, 0.138], [200, 0.2]],
    armor:     [[1, 0.01149495], [100, 0.138], [200, 0.2]],
    generator: [[1, 0.00251515], [100, 0.0078], [200, 0.01]],
    core:      [[1, 0.02666667], [100, 0.17], [200, 0.25]],
};

// Module level cap (highest level in the source table).
export const MODULE_MAX_LEVEL = 300;

// Kept at 1 — the old ×1.17 stopgap was really the star scaling below.
export const MODULE_MAIN_EFFECT_TEMP_MULT = 1;

// Each Ancestral star scales the level gains (and the base bonus — already in
// MODULE_BASE_STATS) by +4%: ★5 = ×1.2. Checked on real ★5 cards (cannon L217
// ×23.37, generator L216 ×2.476, core L216 ×29.86); ★1–★4 follow the same step
// the base values use.
export const MODULE_STAR_SCALE: Partial<Record<ModuleRarity, number>> = {
    A1: 1.04, A2: 1.08, A3: 1.12, A4: 1.16, A5: 1.2,
};


// Preset names
export const PRESET_NAMES: string[] = ['Farming', 'Tourney', 'Preset 3', 'Preset 4', 'Preset 5'];

// A preset's name: the player's own (game import or Profile tab), else the default.
export const presetLabel = (names: string[] | undefined, idx: number): string =>
    names?.[idx]?.trim() || PRESET_NAMES[idx] || `Preset ${idx + 1}`;

// ── UI Symbols ─────────────────────────────────────────────────
// Centralized so currency icons can be swapped in one place.
export const STONE_SYMBOL = '💎';
export const MEDAL_SYMBOL = '🎖️';

// ── Labs ───────────────────────────────────────────────────────
// Order matches in-game exactly.
// [labName, maxLevel, unlockTier, unlockWave, isUnlock?] — the milestone a
// lab opens at (that wave on that tier; 1/30 = when the Labs open). Checked
// against the game's milestone lists (TheTowerSDK data/milestones, 2026-10-26):
// WS Atk Discount T2, Reroll Daily Missions T4 W30, Ban Perks T5 W40, Wall
// Fortification W40, Swamp Rend W60, the bot Burn Stack / Duration labs W60,
// the enemy labs T9 W30–60 (Protector Dmg Reduction W400) and the fleet ones
// T22 W60 were corrected then. Bot Bot's labs aren't in those lists (kept).
// Auto Pick Perks at T4 W50 matches the owner's Tier 4 milestone screen (2026-11-02).
export const LABS: { c: string; l: [string, number, number, number, number?][] }[] = [
    {
        c: 'Main Research', l: [
            ['Game Speed', 7, 1, 30],
            ['Starting Cash', 99, 1, 30],
            ['WS Atk Discount', 99, 2, 40],
            ['WS Def Discount', 99, 2, 50],
            ['WS Util Discount', 99, 2, 60],
            ['Labs Coin Discount', 99, 1, 30],
            ['Labs Speed', 99, 1, 150],
            ['Buy Multiplier', 4, 2, 20],
            ['More Round Stats', 1, 1, 250, 1],
            ['Target Priority', 2, 4, 150],
            ['Card Presets', 5, 1, 400],
            ['Workshop Respec', 1, 4, 30, 1],
            ['Reroll Daily Missions', 1, 4, 30, 1],
            ['Workshop Enhancement', 1, 12, 60, 1],
            ['Enh Atk Discount', 100, 21, 60],
            ['Enh Def Discount', 100, 21, 60],
            ['Enh Util Discount', 100, 21, 60],
            ['Dissonant Echo-Atk', 20, 17, 60],
            ['Dissonant Echo-Def', 20, 17, 60],
            ['Dissonant Echo-Util', 20, 17, 60],
            ['Dissonant Echo-UW', 20, 17, 60],
            ['Global Presets', 1, 1, 0, 1],
        ]
    },
    {
        c: 'Attack Research', l: [
            ['Damage Lab', 100, 1, 30],
            ['Attack Speed Lab', 99, 1, 30],
            ['Critical Factor Lab', 99, 1, 30],
            ['Range Lab', 80, 2, 30],
            ['Damage/Meter Lab', 99, 3, 30],
            ['Super Crit Chance Lab', 50, 5, 200],
            ['Super Crit Mult Lab', 40, 5, 200],
            ['Rend Armor Max', 30, 13, 10],
            ['Light Speed Shots', 1, 7, 10, 1],
        ]
    },
    {
        c: 'Defense Research', l: [
            ['Health Lab', 100, 0, 0],
            ['Health Regen Lab', 100, 0, 0],
            ['Defense Absolute Lab', 100, 0, 0],
            ['Defense % Lab', 50, 5, 30],
            ['Orb Speed Lab', 20, 3, 80],
            ['Land Mine Dmg Lab', 20, 6, 30],
            ['Land Mine Decay', 35, 6, 30],
            ['Shockwave Size Lab', 20, 3, 50],
            ['Orb Boss Hit', 10, 6, 750],
            ['Wall Health Lab', 50, 8, 10],
            ['Wall Rebuild Lab', 20, 8, 10],
            ['Wall Regen', 30, 10, 70],
            ['Wall Thorns', 20, 10, 70],
            ['Wall Invincibility', 10, 12, 10],
            ['Wall Fortification', 60, 14, 40],
            ['Garlic Thorns', 10, 2, 1000],
        ]
    },
    {
        c: 'Utility Research', l: [
            ['Cash Bonus Lab', 99, 1, 30],
            ['Cash/Wave Lab', 99, 1, 30],
            ['Coins/Kill Lab', 99, 1, 30],
            ['Coins/Wave Lab', 99, 1, 30],
            ['Interest Lab', 99, 2, 80],
            ['Max Interest', 15, 2, 80],
            ['Package After Boss', 1, 3, 200, 1],
            ['Recovery Pkg Amount', 20, 6, 150],
            ['Recovery Pkg Max', 20, 6, 150],
            ['Recovery Pkg Chance', 20, 6, 150],
            ['Enemy Atk Lvl Skip Lab', 20, 11, 200],
            ['Enemy HP Lvl Skip Lab', 20, 11, 200],
        ]
    },
    {
        c: 'Ultimate Weapon Research', l: [
            ['SM-Despawn Time', 20, 7, 30],
            ['SM-Explosion(unlock)', 1, 7, 30, 1],
            ['SM-Radius', 20, 7, 30],
            ['CF-Duration', 30, 7, 90],
            ['CF-Dmg Reduction(unlock)', 1, 7, 90, 1],
            ['CF-Reduction %', 30, 7, 90],
            ['PS-Radius', 30, 7, 50],
            ['PS-Stun(unlock)', 1, 7, 50, 1],
            ['PS-Stun Chance', 30, 7, 50],
            ['PS-Stun Time', 30, 7, 50],
            ['GT-Bonus', 25, 4, 200],
            ['GT-Duration', 20, 4, 200],
            ['CL-Shock(unlock)', 1, 7, 60, 1],
            ['CL-Shock Chance', 30, 7, 60],
            ['CL-Shock Multiplier', 14, 7, 60],
            ['DW-Health', 30, 3, 250],
            ['DW-Coins Bonus', 20, 3, 250],
            ['ILM-Blast Radius', 20, 7, 40],
            ['ILM-Rotation Speed', 20, 7, 40],
            ['CF-Range', 20, 7, 90],
            ['SM-Amplifier', 25, 7, 30],
            ['SM-Barrage(unlock)', 1, 8, 50, 1],
            ['SM-Barrage Qty', 6, 8, 50],
            ['ILM-Stun(unlock)', 1, 7, 40, 1],
            ['BH-Damage', 10, 5, 150],
            ['BH-Extra(unlock)', 1, 5, 500, 1],
            ['BH-Coin Bonus', 20, 5, 150],
            ['SL-Coin Bonus', 20, 7, 80],
            ['SL-Missiles', 18, 3, 400],
            ['BH-Disable Ranged(unlock)', 1, 14, 20, 1],
            ['SM-Recharge Barrage', 7, 14, 60],
            ['PS-Swamp Rend', 30, 16, 60],
            ['PS-Swamp Rend Extra', 11, 16, 60],
            ['CL-Chain Thunder', 30, 16, 60],
            ['CL-Lightning Amp', 30, 16, 60],
            ['DW-Cell Bonus', 20, 3, 250],
            ['DW-Dmg Amplifier', 30, 3, 250],
            ['DW-Armor Stripping', 10, 3, 250],
            ['ILM-Chrono Jump', 10, 0, 0],
        ]
    },
    {
        c: 'Card Research', l: [
            ['SW Blast', 4, 3, 150],
            ['Double Death Ray', 30, 3, 300],
            ['Extra Orb Adjuster', 1, 6, 50, 1],
            ['Extra Extra Orbs', 2, 6, 80],
            ['Energy Shield Extra Hit', 2, 4, 300],
            ['Super Tower Bonus', 30, 8, 300],
            ['Recharge SW', 7, 14, 60],
            ['Recharge Demon Mode', 7, 14, 60],
            ['Recharge Nuke', 7, 14, 60],
            // NOTE: Card mastery is tracked in the Cards tab (cardData.m), not
            // here. The old "Mastery - <card>" labs were never read by the
            // engine and have been removed to avoid duplicate/no-op entries.
        ]
    },
    {
        c: 'Perk Research', l: [
            ['Unlock Perks', 1, 2, 150, 1],
            ['Waves Required', 100, 2, 150],
            ['Auto Pick Perks', 1, 4, 50, 1],
            ['Standard Perk Bonus', 25, 2, 150],
            ['Perk Option Qty', 2, 4, 80],
            ['First Perk Choice', 1, 2, 250, 1],
            ['Ban Perks', 8, 5, 40],
            ['Improve Tradeoff Perks', 10, 2, 400],
            ['Auto Pick Ranking', 32, 6, 10],
        ]
    },
    {
        c: 'Bot Research', l: [
            ['Flame Bot Cooldown', 25, 5, 60],
            ['Thunder Bot Cooldown', 25, 5, 70],
            ['Golden Bot Cooldown', 25, 5, 80],
            ['Amplify Bot Cooldown', 25, 5, 90],
            ['Bot Bot Cooldown', 25, 6, 90],
            ['Flame Bot Burn Stack', 5, 10, 60],
            ['Thunder Bot Linger', 20, 10, 60],
            ['Golden Bot Duration', 20, 10, 60],
            ['Amplify Bot Duration', 20, 10, 60],
            ['Bot Bot Duration', 20, 6, 90],
        ]
    },
    {
        c: 'Enemies Research', l: [
            ['Common Enemy Health', 30, 9, 10],
            ['Common Enemy Attack', 30, 9, 10],
            ['Fast Enemy Health', 30, 9, 20],
            ['Fast Enemy Attack', 30, 9, 20],
            ['Fast Enemy Speed', 30, 9, 300],
            ['Tank Enemy Health', 30, 9, 30],
            ['Tank Enemy Attack', 30, 9, 30],
            ['Ranged Enemy Health', 30, 9, 40],
            ['Ranged Enemy Attack', 30, 9, 40],
            ['Boss Health', 30, 9, 50],
            ['Boss Attack', 30, 9, 50],
            ['Protector Health', 30, 9, 60],
            ['Protector Radius', 30, 9, 60],
            ['Protector Dmg Reduction', 20, 9, 400],
            ['Ranged Enemy Range', 30, 13, 80],
            ['Vampire Attack', 30, 19, 60],
            ['Vampire Health', 30, 19, 60],
            ['Ray Attack', 30, 19, 60],
            ['Ray Health', 30, 19, 60],
            ['Scatter Attack', 30, 19, 60],
            ['Scatter Health', 30, 19, 60],
            // Newer enemy labs — not on the wiki yet. Max level 30 matches the
            // owner's full lab list (2026-11-05); the unlock tier is approximate.
            ['Overcharge Enemy Health', 30, 22, 60],
            ['Overcharge Enemy Damage', 30, 22, 60],
            ['Commander Enemy Health', 30, 22, 60],
            ['Saboteur Enemy Health', 30, 22, 60],
            ['Overcharge Exponent Reducer', 30, 22, 60],
            ['Commander Radius', 30, 22, 60],
            ['Saboteur Attack Speed', 30, 22, 60],
        ]
    },
    {
        c: 'Module Research', l: [
            ['Common Drop Chance', 10, 4, 70],
            ['Reroll Shards', 100, 4, 70],
            ['Daily Mission Shards', 50, 4, 70],
            ['Module Shard Cost', 30, 10, 40],
            ['Module Coin Cost', 30, 10, 40],
            ['Rare Drop Chance', 10, 10, 40],
            ['Unmerge Module', 1, 8, 20, 1],
            ['Shatter Shards', 5, 16, 40],
            ['Cannon Effect Bans', 4, 10, 40],
            ['Armor Effect Bans', 4, 10, 40],
            ['Generator Effect Bans', 3, 10, 40],
            ['Core Effect Bans', 7, 10, 40],
            ['Assist-Cannon Mult', 30, 19, 50],
            ['Assist-Cannon Substat', 30, 19, 50],
            ['Assist-Armor Mult', 30, 19, 50],
            ['Assist-Armor Substat', 30, 19, 50],
            ['Assist-Generator Mult', 30, 19, 50],
            ['Assist-Generator Substat', 30, 19, 50],
            ['Assist-Core Mult', 30, 19, 50],
            ['Assist-Core Substat', 30, 19, 50],
            // Primary modules run at 100% efficiency; each of these adds 1% a
            // level to that type's primary module (130% max): the game's
            // Primary Module Bonus labs. Imported from game numbers 253–256 (the
            // owner's lab-number list and TheTowerSDK, 2026-11-05) — not yet
            // seen on an account with a level.
            ['Primary-Cannon Mult', 30, 23, 500],
            ['Primary-Armor Mult', 30, 23, 500],
            ['Primary-Generator Mult', 30, 23, 500],
            ['Primary-Core Mult', 30, 23, 500],
        ]
    },
    {
        c: 'Battle Condition', l: [
            ['BC Reduction', 10, 18, 1000],
            ['Knockback Resist', 20, 19, 100],
            ['Thorns Resist', 20, 19, 100],
            ['Orb Resist', 20, 19, 100],
            ['Plasma Cannon Resist', 20, 19, 100],
            ['Death Ray Resist', 20, 19, 100],
            ['Armored Enemies BC', 20, 20, 60],
            ['Enemy Speed BC', 20, 20, 60],
            ['More Enemies BC', 20, 20, 60],
            ['Enemy Atk Speed BC', 20, 20, 60],
            ["Fast's Ultimate", 10, 19, 500],
            ["Ranged Ultimate", 10, 19, 500],
            ["Boss's Ultimate", 10, 19, 500],
            ["Basic's Ultimate", 10, 19, 500],
            ["Tank's Ultimate", 10, 19, 500],
            ["Protector's Ultimate", 10, 19, 500],
            ['UW Durations BC', 10, 21, 1000],
            ['Death Defy Down BC', 10, 21, 1000],
            ['Energy Shields Down BC', 10, 21, 1000],
            ['EnemyLvlSkip Reduction', 10, 21, 1000],
        ]
    },
];