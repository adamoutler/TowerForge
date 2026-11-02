// ============================================================
//  TowerForge Companion — eHP & Farming Stat Curves
//  Workshop value/cost tables for the defensive and coin stats,
//  plus the formulas the eHP and Farming optimizers will score on.
//  Source: player-supplied tables from the community wiki; Health, Regen and
//  Defense Absolute up to Lv 600 from the game's table in TheTowerSDK, closely
//  enough spaced that the low levels are right (2026-11-01: a straight line
//  from Lv 1 to Lv 100 read Lv 60 of Health 5.5 times too low).
//
//  Cost convention: cost[L] is the coin price of the upgrade that
//  takes the stat TO level L (so total spent at L = Σ cost[1..L]).
// ============================================================

// ── Number parsing for the wiki's "21.56K" style ──────────────
const SUFFIX: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, q: 1e15 };

function num(s: string): number {
    const m = s.trim().match(/^(-?[\d.]+)([KMBTq]?)$/);
    if (!m) throw new Error(`buildStatCurves: bad number "${s}"`);
    return parseFloat(m[1]) * (SUFFIX[m[2]] ?? 1);
}

// "level value cost | level value cost | ..." → sorted sample rows.
function samples(text: string): { level: number; value: number; cost: number }[] {
    return text.split('|').map(row => {
        const [level, value, cost] = row.trim().split(/\s+/);
        return { level: Number(level), value: num(value), cost: num(cost) };
    });
}

// Comma-separated per-level costs, index 0 = level 1.
function perLevel(text: string): number[] {
    return text.split(',').map(num);
}

// Geometric interpolation between sampled levels — these curves grow
// smoothly and multiplicatively, so a constant ratio per level inside a
// 100-level gap is a good approximation. Falls back to linear near 0.
function interpolate(rows: { level: number; v: number }[], level: number): number {
    if (level <= rows[0].level) return rows[0].v;
    const last = rows[rows.length - 1];
    if (level >= last.level) return last.v;
    let i = 1;
    while (rows[i].level < level) i++;
    const a = rows[i - 1], b = rows[i];
    const t = (level - a.level) / (b.level - a.level);
    if (a.v <= 0 || b.v <= 0) return a.v + (b.v - a.v) * t;
    return a.v * Math.pow(b.v / a.v, t);
}

export interface StatCurve {
    maxLevel: number;
    valueAt: (level: number) => number;   // stat value at a workshop level
    costAt: (level: number) => number;    // coin cost of the upgrade reaching `level`
}

function sampledCurve(text: string, maxLevel: number): StatCurve {
    const rows = samples(text);
    const values = rows.map(r => ({ level: r.level, v: r.value }));
    const costs = rows.map(r => ({ level: r.level, v: r.cost }));
    return {
        maxLevel,
        valueAt: lv => interpolate(values, lv),
        costAt: lv => interpolate(costs, lv),
    };
}

function linearCurve(valuePerLevel: number, base: number, costs: number[]): StatCurve {
    return {
        maxLevel: costs.length,
        valueAt: lv => base + valuePerLevel * lv,
        costAt: lv => costs[Math.min(Math.max(lv, 1), costs.length) - 1],
    };
}

// ── Defense workshop stats ────────────────────────────────────

// Flat max health.
export const WS_HEALTH = sampledCurve(`
    0 5 0 | 1 10 30 | 2 15.077 55 | 3 20.097 87 | 5 32.676 176 |
    7 49.069 301 | 10 83.634 566 | 15 176.39 1233 | 20 328.17 2208 | 25 553.01 3513 |
    30 873.2 5167 | 40 1814.9 9581 | 50 3301.7 15555 | 60 5354 23867 | 70 8084.7 33481 |
    80 11690 47173 | 90 16061 61176 | 100 21563 77219 | 125 39475 136700 | 150 65402 229450 |
    175 99449 374860 | 200 143010 610350 | 250 262500 1002800 | 300 431240 1504900 | 350 656160 2121400 |
    400 943900 2856400 | 450 1300800 3713800 | 500 1733000 4696800 | 550 2246500 5808500 | 600 2847100 7051900 |
    700 4.33M 9.94M | 800 6.23M 13.39M | 900 8.59M 17.41M |
    1000 11.44M 22.03M | 1100 14.83M 27.24M | 1200 18.79M 33.08M | 1300 23.36M 39.54M | 1400 28.58M 46.64M |
    1500 34.48M 54.40M | 1600 41.10M 62.82M | 1700 48.48M 71.92M | 1800 56.63M 81.70M | 1900 65.61M 92.17M |
    2000 75.44M 103.33M | 2100 86.15M 115.21M | 2200 97.78M 127.81M | 2300 110.35M 141.13M | 2400 123.89M 155.18M |
    2500 138.45M 169.97M | 2600 154.04M 185.50M | 2700 170.70M 201.79M | 2800 188.46M 218.84M | 2900 207.34M 236.66M |
    3000 227.37M 255.24M | 3100 248.59M 274.61M | 3200 271.01M 294.75M | 3300 294.68M 315.69M | 3400 319.61M 337.42M |
    3500 345.84M 359.96M | 3600 373.39M 383.30M | 3700 402.29M 407.45M | 3800 432.56M 432.42M | 3900 464.24M 458.20M |
    4000 497.34M 484.82M | 4100 531.90M 512.27M | 4200 567.94M 540.55M | 4300 605.49M 569.67M | 4400 644.56M 599.64M |
    4500 685.20M 630.46M | 4600 727.42M 662.13M | 4700 771.25M 694.66M | 4800 816.72M 728.06M | 4900 863.84M 762.32M |
    5000 912.65M 797.45M | 5100 1.12B 1.67B | 5200 1.37B 3.48B | 5300 1.68B 7.26B | 5400 2.05B 15.15B |
    5500 2.50B 39.45B | 5600 3.05B 102.67B | 5700 3.72B 267.02B | 5800 4.53B 693.95B | 5900 5.52B 1.80T |
    6000 6.71B 4.68T`, 6000);

// Health regenerated per second.
export const WS_HEALTH_REGEN = sampledCurve(`
    0 0.0005 0 | 1 0.04 30 | 2 0.0885 55 | 3 0.15159 87 | 5 0.33963 176 |
    7 0.62983 301 | 10 1.2947 566 | 15 3.1246 1233 | 20 5.9979 2208 | 25 10.048 3513 |
    30 15.388 5167 | 40 30.323 9581 | 50 51.489 15555 | 60 79.469 23867 | 70 114.78 33481 |
    80 157.88 47173 | 90 209.19 61176 | 100 269.11 77219 | 125 458.91 136700 | 150 709.88 229450 |
    175 1026.6 374860 | 200 1413.1 610350 | 250 2410.6 1002800 | 300 3868.1 1504900 | 350 6039.5 2121400 |
    400 9021.4 2856400 | 450 12882 3713800 | 500 17675 4696800 | 550 24921 5808500 | 600 40559 7051900 |
    700 120.37K 9.94M | 800 300.09K 13.39M | 900 619.26K 17.41M |
    1000 1.12M 22.03M | 1100 1.82M 27.24M | 1200 2.78M 33.08M | 1300 4.02M 39.54M | 1400 5.58M 46.64M |
    1500 7.48M 54.40M | 1600 9.76M 62.82M | 1700 12.46M 71.92M | 1800 15.59M 81.70M | 1900 19.21M 92.17M |
    2000 23.32M 103.33M | 2100 27.98M 115.21M | 2200 33.19M 127.81M | 2300 39.01M 141.13M | 2400 45.44M 155.18M |
    2500 52.53M 169.97M | 2600 60.30M 185.50M | 2700 68.78M 201.79M | 2800 78.00M 218.84M | 2900 87.98M 236.66M |
    3000 98.77M 255.24M | 3100 110.37M 274.61M | 3200 122.82M 294.75M | 3300 136.16M 315.69M | 3400 150.40M 337.42M |
    3500 165.57M 359.96M | 3600 181.70M 383.30M | 3700 198.82M 407.45M | 3800 216.95M 432.42M | 3900 236.12M 458.20M |
    4000 256.36M 484.82M | 4100 277.70M 512.27M | 4200 300.15M 540.55M | 4300 323.75M 569.67M | 4400 348.53M 599.64M |
    4500 374.50M 630.46M | 4600 401.69M 662.13M | 4700 430.14M 694.66M | 4800 459.86M 728.06M | 4900 490.88M 762.32M |
    5000 523.23M 797.45M | 5100 707.80M 1.25B | 5200 956.20M 1.96B | 5300 1.29B 3.06B | 5400 1.74B 4.79B |
    5500 2.34B 9.99B | 5600 3.15B 20.79B | 5700 4.22B 43.26B | 5800 5.67B 89.94B | 5900 7.60B 186.86B |
    6000 10.17B 388.00B`, 6000);

// Flat damage removed from each hit — applied AFTER Defense %.
export const WS_DEFENSE_ABSOLUTE = sampledCurve(`
    0 0 0 | 1 0.505 50 | 2 1.5199 75 | 3 2.5556 107 | 5 4.7346 196 |
    7 7.1159 321 | 10 11.195 586 | 15 19.76 1253 | 20 31.114 2228 | 25 45.854 3533 |
    30 65.157 5187 | 40 116.73 9601 | 50 191.67 15575 | 60 290.57 23888 | 70 421.74 33502 |
    80 581.55 47194 | 90 783.07 61198 | 100 1016.3 77241 | 125 1796.2 136720 | 150 2856.1 229470 |
    175 4241.4 374890 | 200 5985.6 610390 | 250 10676 1002800 | 300 17164 1504900 | 350 26119 2121400 |
    400 38389 2856500 | 450 54328 3713800 | 500 74219 4696800 | 550 98313 5808600 | 600 126840 7051900 |
    700 198.06K 9.94M | 800 289.48K 13.39M | 900 402.57K 17.41M |
    1000 538.72K 22.03M | 1100 699.24K 27.24M | 1200 885.36K 33.08M | 1300 1.10M 39.54M | 1400 1.34M 46.64M |
    1500 1.62M 54.40M | 1600 1.94M 62.82M | 1700 2.30M 71.92M | 1800 2.70M 81.70M | 1900 3.14M 92.17M |
    2000 3.65M 103.33M | 2100 4.21M 115.21M | 2200 4.84M 127.81M | 2300 5.53M 141.13M | 2400 6.29M 155.18M |
    2500 7.13M 169.97M | 2600 8.04M 185.50M | 2700 9.07M 201.79M | 2800 10.22M 218.84M | 2900 11.50M 236.66M |
    3000 12.92M 255.24M | 3100 14.50M 274.61M | 3200 16.23M 294.75M | 3300 18.12M 315.69M | 3400 20.19M 337.42M |
    3500 22.43M 359.96M | 3600 24.85M 383.30M | 3700 27.45M 407.45M | 3800 30.25M 432.42M | 3900 33.24M 458.20M |
    4000 36.44M 484.82M | 4100 39.83M 512.27M | 4200 43.43M 540.55M | 4300 47.25M 569.67M | 4400 51.28M 599.64M |
    4500 55.53M 630.46M | 4600 60.01M 662.13M | 4700 64.71M 694.66M | 4800 69.64M 728.06M | 4900 74.81M 762.32M |
    5000 80.21M 797.45M`, 5000);

// Defense %: 0.5% per level (percent of each hit removed, applied BEFORE Defense Absolute).
export const WS_DEFENSE_PCT = linearCurve(0.5, 0, perLevel(`
    50, 76, 109, 151, 203, 266, 340, 426, 525, 636, 760, 898, 1.05K, 1.22K, 1.40K, 1.59K, 1.80K, 2.03K,
    2.27K, 2.52K, 2.79K, 3.08K, 3.39K, 3.71K, 4.04K, 4.40K, 4.77K, 5.16K, 5.56K, 5.99K, 6.43K, 6.89K,
    7.36K, 7.86K, 8.37K, 8.90K, 9.45K, 10.02K, 10.60K, 11.21K, 11.83K, 12.48K, 13.14K, 13.82K, 14.53K,
    15.25K, 15.99K, 16.75K, 17.53K, 18.33K, 19.72K, 20.59K, 21.48K, 22.38K, 23.31K, 24.26K, 25.24K,
    26.23K, 27.24K, 28.28K, 29.34K, 30.42K, 31.52K, 32.64K, 33.79K, 34.95K, 36.14K, 37.36K, 38.59K,
    39.85K, 41.13K, 42.43K, 43.75K, 45.10K, 46.47K, 50.26K, 51.74K, 53.26K, 54.79K, 56.35K, 57.93K,
    59.54K, 61.18K, 62.84K, 64.52K, 66.23K, 67.96K, 69.72K, 71.50K, 73.31K, 75.14K, 77.00K, 78.89K,
    80.80K, 82.73K, 84.69K, 86.68K, 88.69K, 90.73K`));

// Thorns: 1% per level — each attacker takes this % of its MAX health
// (fleet enemies: % of CURRENT health, with 85% thorn resistance).
export const WS_THORNS = linearCurve(1, 0, perLevel(`
    60, 85, 117, 157, 206, 264, 331, 409, 497, 596, 706, 828, 961, 1.11K, 1.26K, 1.43K, 1.62K, 1.81K,
    2.02K, 2.24K, 2.47K, 2.72K, 2.98K, 3.26K, 3.54K, 3.85K, 4.16K, 4.49K, 4.84K, 5.20K, 5.57K, 5.96K,
    6.36K, 6.78K, 7.22K, 7.66K, 8.13K, 8.61K, 9.10K, 9.61K, 10.14K, 10.68K, 11.24K, 11.81K, 12.40K,
    13.00K, 13.62K, 14.26K, 14.92K, 15.59K, 16.76K, 17.48K, 18.22K, 18.98K, 19.76K, 20.55K, 21.36K,
    22.19K, 23.04K, 23.90K, 24.78K, 25.68K, 26.59K, 27.53K, 28.48K, 29.45K, 30.44K, 31.44K, 32.47K,
    33.51K, 34.57K, 35.65K, 36.75K, 37.87K, 39.00K, 42.16K, 43.39K, 44.64K, 45.92K, 47.21K, 48.52K,
    49.85K, 51.19K, 52.57K, 53.95K, 55.37K, 56.79K, 58.25K, 59.72K, 61.21K, 62.72K, 64.25K, 65.80K,
    67.38K, 68.97K, 70.59K, 72.22K, 73.88K, 75.55K`));

// Wall Health: 20% + 0.1% per level (% of tower health).
const WALL_HEALTH_COSTS = samples(`
    1 20.10 8.00M | 100 30 31.91M | 200 40 111.04M | 300 50 398.70M | 400 60 665.11M |
    500 70 2.09B | 600 80 3.14B | 700 90 9.02B | 800 100 12.52B | 900 110 33.73B |
    1000 120 44.29B | 1100 130 113.82B | 1200 140 143.51B | 1300 150 356.03B | 1400 160 435.37B |
    1500 170 1.58T | 1600 180 1.88T | 1700 190 6.68T | 1800 200 23.48T`).map(r => ({ level: r.level, v: r.cost }));

export const WS_WALL_HEALTH: StatCurve = {
    maxLevel: 1800,
    valueAt: lv => 20 + 0.1 * lv,
    costAt: lv => interpolate(WALL_HEALTH_COSTS, lv),
};

// ── Recovery package workshop stats (Utility) ─────────────────
// All three share one cost table (sampled every 10 levels).
const PACKAGE_COSTS = samples(`
    1 0 1.00K | 10 0 20.90K | 20 0 334.63K | 30 0 1.66M | 40 0 5.12M | 50 0 12.18M | 60 0 25.40M |
    70 0 46.05M | 80 0 80.87M | 90 0 127.20M | 100 0 190.64M | 110 0 296.78M | 120 0 414.28M |
    130 0 630.48M | 140 0 837.31M | 150 0 1.09B | 160 0 1.62B | 170 0 2.04B | 180 0 3.07B |
    190 0 3.78B | 200 0 4.60B | 210 0 5.54B | 220 0 6.61B | 230 0 7.84B | 240 0 9.22B |
    250 0 10.77B | 260 0 12.51B | 270 0 14.45B | 280 0 16.59B | 290 0 18.97B | 300 0 21.59B |
    310 0 24.46B | 320 0 27.61B | 330 0 31.05B | 340 0 34.79B | 350 0 38.85B | 360 0 43.25B |
    370 0 48.01B | 380 0 53.15B | 390 0 58.68B | 400 0 64.62B | 410 0 70.99B | 420 0 77.82B |
    430 0 85.12B | 440 0 92.90B | 450 0 101.21B | 460 0 110.04B | 470 0 119.43B | 480 0 129.40B |
    490 0 139.97B | 500 0 151.17B`).map(r => ({ level: r.level, v: r.cost }));

const packageCost = (lv: number) => interpolate(PACKAGE_COSTS, lv);

// Recovery Amount: % of max health healed per package (14% + 0.4%/level, max 134%).
export const WS_RECOVERY_AMOUNT: StatCurve = { maxLevel: 300, valueAt: lv => 14 + 0.4 * lv, costAt: packageCost };
// Max Recovery: packages can heal up to this × max health (×1.5 + 0.03/level, max ×16.5).
export const WS_MAX_RECOVERY: StatCurve = { maxLevel: 500, valueAt: lv => 1.5 + 0.03 * lv, costAt: packageCost };
// Package Chance: % chance per wave (6% + 0.4%/level, max 30%; 82% with lab, card and sub-effect).
export const WS_PACKAGE_CHANCE: StatCurve = { maxLevel: 60, valueAt: lv => 6 + 0.4 * lv, costAt: packageCost };

// ── Defense % sources and cap ─────────────────────────────────
// [source, value per improvement (%), improvements, max (%)]
// Sums to 126% at max, but Defense % is capped at 98%.
export const DEFENSE_PCT_SOURCES: [string, number, number, number][] = [
    ['Workshop', 0.5, 99, 49.5],
    ['Card', 1, 6, 11],          // 5% at 1★, +1% per star
    ['Mastery', 0.7, 9, 7],
    ['Lab', 0.2, 50, 10],
    ['Perk', 4, 5, 20],
    ['Perk Lab', 0.04, 25, 5],   // per perk
    ['Sub-Module', 1, 6, 8],
    ['Assist Module', 0.08, 100, 8],
    ['Relics', 1, 5, 6],
    ['Vault', 0.5, 2, 1.5],
];
export const DEFENSE_PCT_CAP = 98;

// ── Coin workshop stats ───────────────────────────────────────
// Coin/Kill and Coin/Wave share one cost table (sampled every 10 levels).
const COIN_STAT_COSTS = samples(`
    1 0 50 | 10 0 838 | 20 0 3.58K | 30 0 8.84K | 40 0 17.02K | 50 0 28.41K | 60 0 44.56K |
    70 0 63.66K | 80 0 91.10K | 90 0 119.75K | 100 0 152.97K | 110 0 206.19K | 120 0 252.45K |
    130 0 340.64K | 140 0 404.78K | 149 0 467.98K`).map(r => ({ level: r.level, v: r.cost }));

// Coin/Kill: ×1.00 base, +0.01 per level (max ×2.49).
export const WS_COIN_PER_KILL: StatCurve = {
    maxLevel: 149,
    valueAt: lv => 1 + 0.01 * lv,
    costAt: lv => interpolate(COIN_STAT_COSTS, lv),
};

// Coin/Wave: flat coins at the end of each wave (level + 1, max 150).
export const WS_COIN_PER_WAVE: StatCurve = {
    maxLevel: 149,
    valueAt: lv => (lv > 0 ? lv + 1 : 0),
    costAt: lv => interpolate(COIN_STAT_COSTS, lv),
};

// Coins/Kill (CPK), as shown in game:
//   CPK = (Workshop × CPK lab + CPK module effect)
//         × (1 + Coin Bonus enhancement)
//         × (1 + 0.15 × coin bonus perks taken)
//         × (trade-off perk 1.8 × (1 + trade-off lab))   ← use 1 if not unlocked
// Every other coin multiplier (tier bonus, Golden Tower, Golden Bot, skins,
// Black Hole, Spotlight, Death Wave …) multiplies on top of this. Note the
// enhancement is counted twice: once here and once inside the tier bonus.
// Compute without rounding — in-game display rounds.

// Tier coin bonus (multiplies all coins earned). Index 0 = Tier 1.
export const TIER_COIN_BONUS = [
    1.0, 1.8, 2.6, 3.4, 4.2, 5.0, 5.8, 6.6, 7.5, 8.7, 10.3, 12.2,
    14.7, 17.6, 21.3, 25.2, 29.1, 33.0, 40.0, 48.0, 60.0, 72.0, 86.0, 103.0,
];

// Coin decay: enemies alive for more than 3 waves lose 50% of their coin value.
export const COIN_DECAY_AFTER_WAVES = 3;
export const COIN_DECAY_MULT = 0.5;

// ============================================================
//  Researched from the community wiki (2026-10). Lab keys match
//  the names in LABS (constants/gameData.ts) so values can be read
//  straight from the player's labData.
// ============================================================

// ── eHP formula ───────────────────────────────────────────────
// The wiki's effective HP — the single hit needed to bring the tower to 0:
//   eHP = (Health / (1 − ChronoFieldReduction%) + Defense Absolute) / (1 − Defense %)
// With recovery packages, Health may be up to Max Recovery × max health
// (packages can heal past max; regen and lifesteal cannot).
// Defense % is capped at DEFENSE_PCT_CAP; Chrono Field reduction only
// applies while CF is active and is NOT part of the 98% cap.

// Linear lab curves: value = base + perLevel × level (level 0 = not researched).
export interface LabCurve { base: number; perLevel: number; maxLevel: number }

export const LAB_CURVES: Record<string, LabCurve> = {
    // Defense research — ×multiplier on the workshop value
    'Health Lab':              { base: 1, perLevel: 0.03, maxLevel: 100 },   // ×4.00 max
    'Health Regen Lab':        { base: 1, perLevel: 0.03, maxLevel: 100 },   // ×4.00 max
    'Defense Absolute Lab':    { base: 1, perLevel: 0.03, maxLevel: 100 },   // ×4.00 max
    'Defense % Lab':           { base: 0, perLevel: 0.2,  maxLevel: 50 },    // +% (adds to workshop), +10% max
    'Wall Health Lab':         { base: 0, perLevel: 2,    maxLevel: 50 },    // +% of tower health
    'Wall Rebuild Lab':        { base: 0, perLevel: -10,  maxLevel: 20 },    // seconds (rebuild hard cap 150s)
    'Wall Regen':              { base: 0, perLevel: 10,   maxLevel: 30 },    // % of tower regen applied to wall
    'Wall Thorns':             { base: 0, perLevel: 1,    maxLevel: 20 },    // % of tower thorns dealt by the wall
    'Wall Invincibility':      { base: 0, perLevel: 1,    maxLevel: 10 },    // seconds after rebuild
    'Wall Fortification':      { base: 0, perLevel: 20,   maxLevel: 60 },    // % over max wall health
    'Recovery Pkg Amount':     { base: 0, perLevel: 0.4,  maxLevel: 20 },    // +% recovery amount
    'Recovery Pkg Max':        { base: 0, perLevel: 1,    maxLevel: 20 },    // +% max recovery
    'Recovery Pkg Chance':     { base: 0, perLevel: 0.2,  maxLevel: 20 },    // +% package chance
    'CF-Reduction %':          { base: 10, perLevel: 0.5, maxLevel: 30 },    // needs 'CF-Dmg Reduction(unlock)'; 10% → 25%
    'DW-Health':               { base: 500, perLevel: 25, maxLevel: 30 },   // cap on the DW health multiplier: 500% = ×5 → 1250% = ×12.5

    // Coin research — ×multiplier
    'Coins/Kill Lab':          { base: 1, perLevel: 0.02, maxLevel: 99 },    // ×2.98 max, multiplies the workshop value
    'Coins/Wave Lab':          { base: 1, perLevel: 0.02, maxLevel: 99 },    // ×2.98 max
    'BH-Coin Bonus':           { base: 1, perLevel: 0.5,  maxLevel: 20 },    // ×1.5 → ×11 for kills inside a Black Hole
    'SL-Coin Bonus':           { base: 1, perLevel: 0.1,  maxLevel: 20 },    // ×1.1 → ×3.0 for kills inside Spotlight
    'DW-Coins Bonus':          { base: 1.5, perLevel: 0.05, maxLevel: 20 },  // ×1.55 → ×2.5 for enemies hit by DW effect waves
    'GT-Bonus':                { base: 0, perLevel: 0.15, maxLevel: 25 },    // + to the GT multiplier (+3.75 max)
    'GT-Duration':             { base: 0, perLevel: 1,    maxLevel: 20 },    // +seconds
    'Golden Bot Cooldown':     { base: 0, perLevel: -1,   maxLevel: 25 },    // seconds
    'Golden Bot Duration':     { base: 0, perLevel: 0.5,  maxLevel: 20 },    // seconds

    // Perk research
    'Standard Perk Bonus':     { base: 0, perLevel: 1,    maxLevel: 25 },    // +% to standard perks
    'Improve Tradeoff Perks':  { base: 0, perLevel: 1,    maxLevel: 10 },    // +% to trade-off perk benefit
};

export function labValue(labName: string, level: number): number {
    const c = LAB_CURVES[labName];
    if (!c) return 0;
    return c.base + c.perLevel * Math.min(Math.max(level, 0), c.maxLevel);
}

// Workshop enhancements: ×(1 + 0.01 × level).
//   Health / Health Regen / Defense Absolute / Wall Health: 400 levels → ×5
//   Coin Bonus: 200 levels → ×3 — counted TWICE (in Coins/Kill and in the tier bonus)
//   Packages (Recovery Amount + Max Recovery): 300 levels → ×4

// ── Coin multipliers (all multiply together, per kill) ────────
// Always on: tier bonus × Coins card (× its mastery) × Coins/Kill (formula above)
//            × coin relics × generator main effect × themes/packs.
// Situational — only kills that happen while/where the effect is active:
//   Golden Tower  ×(UW multiplier + 'GT-Bonus' lab [+ core sub-effect]) while active
//                 (GT Bonus x1.5 perk multiplies the UW part, not the sub-effect)
//   Black Hole    ×'BH-Coin Bonus' for kills inside a black hole while it's active
//                 ('BH-Extra(unlock)' adds a 2nd hole on the opposite side)
//   Spotlight     ×'SL-Coin Bonus' for kills inside the light (angle × quantity of 360°)
//   Death Wave    ×'DW-Coins Bonus' for enemies hit by an effect wave or killed by DW
//   Golden Bot    ×(2.0 + 0.2 × bonus level, max 8.0) for kills in bot range while active
//                 duration 20s + 0.5s/lvl (+lab), cooldown 120s − 3s/lvl (−lab)
// Multipliers only stack on the SAME kill, so syncing GT/BH/DW cooldowns
// (equal or whole multiples) matters a lot.
//
// Golden Combo (GT+): after GT ends, income × ((1 + 0.0003 × (GT+ level + 1))^kills − 1)
// extra, counting only enemies spawned during that activation.

// ── Coin cards & perks ────────────────────────────────────────
//   Coins card:        ×1.15–1.45 on all coins (also Coins/Wave); mastery scales the card's
//                      bonus: 1 + (card − 1) × mastery (×1.45 at M9 ×1.3 → ×1.585)
//   Critical Coin:     basic enemies (normally 0 coins) drop 1 coin × CPK with 15–33%
//                      chance when killed by anything but a non-crit bullet;
//                      mastery: 10–100% chance that drop is 2 coins
//   Enemy Balance:     ~1.8× enemies spawned (more kills); its multiplier is cash-only
//   Wave Skip:         skipped wave pays the previous wave's income ×1.1 (×1.1^n in a row)
//   Wave Accelerator:  shorter gaps between waves (more waves per hour)
//   Intro Sprint:      no coins earned during the sprint
//   Extra Orb mastery: orb kill coin bonus ×1.04–1.4
//   Perk "All Coin Bonuses" ×1.15, up to 5: (1 + 0.15 × qty) × (1 + Standard Perk Bonus)
//   Trade-off "x1.80 coins, but max health −70%": 1.8 × (1 + Improve Tradeoff Perks)

// ── Defense cards, perks & other sources ──────────────────────
//   Health card ×1.5–4.0, Health Regen card ×1.4–2.6; their masteries (×1.2–3.0 / ×1.4–5) scale
//   the card's bonus: 1 + (card − 1) × mastery
//   Fortress card ×1.30–2.20 Defense Absolute (mastery: wall rebuild −10s…−100s)
//   Extra Defense card +5–11% Defense % (mastery +0.7…+7%)
//   Perks (multiplicative ones use (1 + base × qty) × (1 + SPB); additive ones base × qty × (1 + SPB)):
//     ×1.20 Max Health ×5, ×1.15 Defense Absolute ×5, ×1.75 Health Regen ×5 (multiplicative)
//     +4% Defense Percent ×5 (additive)
//     Trade-offs: Health Regen ×8 but max health −60%; coins ×1.8 but max health −70%
//   Death Wave: each enemy hit and then killed adds +0.05% max health; the total multiplier caps at
//               'DW-Health' ÷ 100 (×5 base, ×12.5 at max lab)
//   Thorns: % of the attacker's MAX health per hit (50% vs bosses, protectors −60%,
//           fleets take % of CURRENT health with 85% resistance; T14+ battle conditions
//           add thorn resistance). Thorns do not trigger lifesteal.
//   Lifesteal: 0.1%→4.46% (80 levels) of tower projectile damage dealt; can't overheal.
//   Death Defy: 0.4%/level (75 levels) chance to ignore a lethal hit; hard cap 50%.
//   Recovery packages: amount 14% + 0.4%/lvl (max 134%), max recovery ×1 + 0.031/lvl
//           (max ×16.5), chance 6% + 0.4%/lvl (max 30%; 82% with lab+card+substat).
