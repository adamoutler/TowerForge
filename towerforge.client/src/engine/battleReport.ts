// ============================================================
//  TowerForge Companion — Battle Report Parser
//  Reads the end-of-run "Battle Report" text players copy from the
//  game, so the optimizer can calibrate to their real runs.
//
//  The report is "Label<TAB>Value" lines grouped under section
//  headers (lines with no value). Labels repeat across sections
//  ("Golden Tower" is in Killed With Effect Active, Coins and Cash),
//  so values are stored per section.
// ============================================================

import { formatGameNumber, parseGameNumber } from './gameNumbers';

// "1d 14h 30m 17s" → seconds.
export function parseDuration(raw: string): number {
    let total = 0;
    for (const [, n, unit] of raw.matchAll(/(\d+)\s*([dhms])/g)) {
        total += Number(n) * { d: 86400, h: 3600, m: 60, s: 1 }[unit as 'd' | 'h' | 'm' | 's'];
    }
    return total;
}

// "1248681 [100.0%]" → 1.0
function parseBracketPct(raw: string): number | null {
    const m = raw.match(/\[([\d.]+)%\]/);
    return m ? parseFloat(m[1]) / 100 : null;
}

// Damage dealt in the run, by source (same units as the game's report).
export interface DamageBreakdown {
    total: number;
    chainLightning: number;
    smartMissiles: number;
    deathWave: number;
    innerLandMines: number;
    poisonSwamp: number;
    blackHole: number;
    orbs: number;
    projectiles: number;
    rendArmor: number;
    landMines: number;
    thorns: number;
}

export interface BattleReport {
    date: string;
    tier: number;
    wave: number;
    gameTimeSec: number;
    realTimeSec: number;
    coinsEarned: number;
    coinsPerHour: number;
    totalEnemies: number;
    wavesSkipped: number;
    largestGoldenCombo: number;
    recoveryPackages: number;   // packages received during the run (Utility)
    thornsKills: number;        // enemies destroyed by thorns
    // Share of kills made while each effect was active ("Killed With Effect Active").
    killedWithEffect: {
        goldenTower: number | null;
        deathWave: number | null;
        spotlight: number | null;
        goldenBot: number | null;
        blackHole: number | null;
        orbs: number | null;
    };
    // Coins section breakdown.
    coins: {
        goldenCombo: number;
        waveSkip: number;
        coinsPerWave: number;
        criticalCoin: number;
        fetched: number;
    };
    tournament?: boolean;       // set for runs imported from the game's battle history
    // From the game's battle history only (not in the pasted report) —
    // run rates for unique module effects (engine/runRates.ts).
    bossKills?: number;
    eliteKills?: number;        // Vampire + Ray + Scatter
    fleetKills?: number;        // Commander + Saboteur + Overcharge
    cashEarned?: number;
    projectileCount?: number;   // tower shots fired
    clHits?: number;            // enemies hit by Chain Lightning (each counted once)
    psHits?: number;            // enemies hit by Poison Swamp
    orbHits?: number;
    damage?: DamageBreakdown;   // damage by source (calibrates Glass Cannon)
    // Imported runs only: when the run was played (ms since 1970) and every
    // field the game stored for it (~150 run totals, `BattleHistory` names),
    // kept for calibration and the run simulator (docs/run-simulation.md).
    time?: number;
    raw?: Record<string, BattleField>;
}

export type BattleField = number | string | boolean | number[];

// The game's export only holds the last 5 runs, so each import adds its runs
// to the ones already kept instead of replacing them. A run seen again (same
// tier, wave and times) is replaced by the fresh copy, which has every field.
// Oldest → newest; runs kept before times were stored sort first. The newest
// MAX_STORED_BATTLES are kept (up to ~10 KB each: ~1 MB at the cap, under
// the server's 2 MB limit for a synced save).
export const MAX_STORED_BATTLES = 100;

// ── Raw fields by name ────────────────────────────────────────
// The export's battle fields beyond the ones parsed above aren't documented
// by name, so they're found by the words in the name (any casing):
// "FlameBotDamage" matches flame + bot + damage. Lifetime totals and
// records ("Total…", "Most…", "Largest…") are left out.
const wordsOf = (key: string) => key.toLowerCase();

export function rawFields(run: BattleReport, words: string[], not: string[] = []): [string, number][] {
    return Object.entries(run.raw ?? {}).flatMap(([key, v]) => {
        const k = wordsOf(key);
        if (typeof v !== 'number' || !words.every(w => k.includes(w)) || not.some(w => k.includes(w))) return [];
        if (/^(total|most|largest|best)/.test(k)) return [];
        return [[key, v] as [string, number]];
    });
}

export const rawField = (run: BattleReport, words: string[], not: string[] = []): number | null =>
    rawFields(run, words, not)[0]?.[1] ?? null;

// Damage the parsed breakdown doesn't name (TheTowerSDK's run field list has
// all of these): Flame Bot, Death Ray, Spotlight, Electrons, the Guardian
// and its Attack chip.
export interface ExtraDamage {
    flameBot: number;
    deathRay: number;
    spotlight: number;
    electrons: number;
    guardian: number;
    attackChip: number;
}

export function extraDamage(run: BattleReport): ExtraDamage {
    const f = (words: string[], not: string[] = []) => Math.max(0, rawField(run, words, not) ?? 0);
    return {
        flameBot: f(['flame', 'bot', 'damage'], ['reduction']),
        deathRay: f(['death', 'ray', 'damage']),
        spotlight: f(['spotlight', 'damage']),
        electrons: f(['electron', 'damage']),
        guardian: f(['guardian', 'damage']),
        attackChip: f(['chip', 'damage']),
    };
}

// What kept a run going: Death Defy procs, Energy Shield hits, Second Wind,
// Nuke and Demon Mode uses (null = not in this run's fields).
export interface RunSavers {
    deathDefy: number | null;
    energyShield: number | null;
    secondWind: number | null;
    nuke: number | null;
    demonMode: number | null;
}

export function runSavers(run: BattleReport): RunSavers {
    return {
        deathDefy: rawField(run, ['death', 'defy'], ['down', 'chance']),
        energyShield: rawField(run, ['energy', 'shield']),
        secondWind: rawField(run, ['second', 'wind']),
        nuke: rawField(run, ['nuke']),
        demonMode: rawField(run, ['demon']),
    };
}

// Everything else a run hands out: cells, gems, medals, reroll and module
// shards, by field (earned, fetched by the Guardian, from ads…).
export function runDrops(run: BattleReport): [string, number][] {
    const keep = (words: string[]) => rawFields(run, words, ['hour', 'tapped', 'block']);
    return [
        ...keep(['cell']),
        ...keep(['gem']),
        ...keep(['medal']),
        ...keep(['shard']),
    ];
}

// A Dissonant Run plays with a workshop tab locked, so it says nothing about
// the build and stays out of calibration and run length. DissonanceType is 0
// on all 30 runs of the owner's export, none of them Dissonant (their wave
// tables didn't move); that anything else marks one is the code's assumption
// until an export holds a real Dissonant Run.
export const isDissonantRun = (run: BattleReport) => typeof run.raw?.DissonanceType === 'number' && run.raw.DissonanceType > 0;

// The share of a run's enemies each weapon touched, biggest first (under 0.5%
// left out). The game counts an enemy once per weapon: on the owner's runs
// these stop at about 100% however many hits a weapon lands, 103% at most.
const REACH_LINES: [string, string][] = [
    ['Orbs', 'OrbHits'], ['Chain Lightning', 'EnemiesHitByChainLightningThisRound'], ['Poison Swamp', 'EnemiesHitByPoisonSwampThisRound'],
    ['Smart Missiles', 'EnemiesHitBySmartMissilesThisRound'], ['Inner Land Mines', 'EnemiesHitByInnerLandMinesThisRound'],
    ['Black Hole', 'EnemiesHitByBlackHoleThisRound'], ['Chrono Field', 'EnemiesHitByChronoFieldThisRound'],
    ['Death Ray', 'EnemiesHitByDeathRayThisRound'], ['Tower shots', 'EnemiesHitByProjectilesThisRound'],
    ['Land Mines', 'EnemiesHitByLandMineThisRound'], ['Thorns', 'EnemiesHitByThornsThisRound'],
    ['Flame Bot', 'EnemiesHitByFlameBotThisRound'], ['Thunder Bot', 'EnemiesHitByThunderBotThisRound'],
    ['Attack chip', 'EnemiesHitByAttackChipThisRound'],
];
export function enemiesReached(run: BattleReport): [string, number][] {
    if (!(run.totalEnemies > 0)) return [];
    return REACH_LINES.flatMap(([name, key]): [string, number][] => {
        const hits = run.raw?.[key];
        const share = typeof hits === 'number' ? Math.min(1, hits / run.totalEnemies) : 0;
        return share >= 0.005 ? [[name, share]] : [];
    }).sort((a, b) => b[1] - a[1]);
}
export const enemiesReachedText = (run: BattleReport, joiner: string) =>
    enemiesReached(run).map(([name, share]) => `${name} ${Math.round(share * 100)}%`).join(joiner);

// What made the kills, biggest first (under 0.5% left out). The lines add up
// to all the run's enemies on the owner's runs, finished or still going.
const KILL_LINES: [string, string][] = [
    ['Orbs', 'DestroyedByOrbs'], ['Chain Lightning', 'DestroyedByChainLightning'], ['Poison Swamp', 'DestroyedByPoisonSwamp'],
    ['Smart Missiles', 'DestroyedBySmartMissiles'], ['Inner Land Mines', 'DestroyedByInnerLandMines'], ['Tower shots', 'DestroyedByProjectiles'],
    ['Black Hole', 'DestroyedByBlackHole'], ['Death Wave', 'DestroyedByDeathWave'], ['Death Ray', 'DestroyedByDeathRay'], ['Land Mines', 'DestroyedByLandMine'],
    ['Thorns', 'DestroyedByThorns'], ['Flame Bot', 'DestroyedByFlameBot'], ['Death Penalty', 'DestroyedByDeathPenalty'], ['Other', 'DestroyedByOther'],
];
export function killsBySource(run: BattleReport): [string, number][] {
    if (!(run.totalEnemies > 0)) return [];
    return KILL_LINES.flatMap(([name, key]): [string, number][] => {
        const kills = run.raw?.[key];
        const share = typeof kills === 'number' ? kills / run.totalEnemies : 0;
        return share >= 0.005 ? [[name, share]] : [];
    }).sort((a, b) => b[1] - a[1]);
}
export const killsBySourceText = (run: BattleReport, joiner: string) =>
    killsBySource(run).map(([name, share]) => `${name} ${Math.round(share * 100)}%`).join(joiner);

// Cash in a run, and the free upgrades it rolled.
export function runCashText(run: BattleReport, joiner: string): string {
    const n = (key: string) => { const v = run.raw?.[key]; return typeof v === 'number' ? v : 0; };
    const parts: string[] = [];
    if (n('CashEarned') > 0) parts.push(formatGameNumber(n('CashEarned')));
    if (n('CashFromGoldenTower') > 0) parts.push(`Golden Tower ${formatGameNumber(n('CashFromGoldenTower'))}`);
    if (n('InterestEarned') > 0) parts.push(`interest ${formatGameNumber(n('InterestEarned'))}`);
    if (n('FreeAttackUpgrades') + n('FreeDefenseUpgrades') + n('FreeUtilityUpgrades') > 0) {
        parts.push(`free upgrades: ${n('FreeAttackUpgrades')} Attack, ${n('FreeDefenseUpgrades')} Defense, ${n('FreeUtilityUpgrades')} Utility`);
    }
    return parts.join(joiner);
}

// A run's identity across imports (also keys the tournament log).
export const runKey = (b: BattleReport) =>
    [b.tier, b.wave, Math.round(b.gameTimeSec), Math.round(b.realTimeSec), b.tournament ? 1 : 0].join('|');

export function mergeBattles(stored: BattleReport[], incoming: BattleReport[]): BattleReport[] {
    const byKey = new Map<string, BattleReport>();
    for (const b of stored) byKey.set(runKey(b), b);
    for (const b of incoming) byKey.set(runKey(b), b);
    return [...byKey.values()]
        .sort((x, y) => (x.time ?? -Infinity) - (y.time ?? -Infinity))
        .slice(-MAX_STORED_BATTLES);
}

type Sections = Record<string, Record<string, string>>;

function splitSections(text: string): Sections {
    const sections: Sections = {};
    let current = 'Battle Report';
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        let label: string;
        let value: string;
        const tab = rawLine.indexOf('\t');
        if (tab >= 0) {
            label = rawLine.slice(0, tab).trim();
            value = rawLine.slice(tab + 1).trim();
        } else {
            // Tabs can get lost when copying — fall back to "label <number…>".
            const m = line.match(/^(.*?[A-Za-z)])\s+([$\d].*)$/);
            if (!m) { current = line; continue; }   // no value → section header
            label = m[1].trim();
            value = m[2].trim();
        }
        if (!value) { current = label; continue; }
        (sections[current] ??= {})[label] = value;
    }
    return sections;
}

// Returns null when the text doesn't look like a Battle Report.
export function parseBattleReport(text: string): BattleReport | null {
    const s = splitSections(text);
    const top = s['Battle Report'] ?? {};
    const coins = s['Coins'] ?? {};
    const effect = s['Killed With Effect Active'] ?? {};
    const records = s['Records'] ?? {};
    const counts = s['Counts'] ?? {};
    const enemies = s['Total Enemies'] ?? {};
    const utility = s['Utility'] ?? {};
    const destroyed = s['Enemies Destroyed By'] ?? {};

    const gameTimeSec = parseDuration(top['Game Time'] ?? '');
    const coinsEarned = parseGameNumber(top['Coins Earned'] ?? coins['Coins Earned'] ?? '');
    if (!gameTimeSec || !Number.isFinite(coinsEarned)) return null;

    const num = (v: string | undefined) => {
        const n = v ? parseGameNumber(v) : NaN;
        return Number.isFinite(n) ? n : 0;
    };
    const pct = (key: string) => (effect[key] ? parseBracketPct(effect[key]) : null);

    // Damage lines can sit in any section; match their labels loosely
    // ("Chain Lightning Damage", "Chain Lightning" under a Damage header…).
    const all = Object.entries(s).flatMap(([sec, rows]) => Object.entries(rows).map(([k, v]) => [`${sec} ${k}`.toLowerCase(), k.toLowerCase(), v] as const));
    const dmg = (...names: string[]) => {
        const hit = all.find(([full, label]) => names.some(n => label === n || (full.includes('damage') && label === n.replace(/ damage$/, ''))));
        return hit ? num(hit[2]) : 0;
    };
    const total = dmg('damage dealt');
    const damage = total > 0 ? {
        total,
        chainLightning: dmg('chain lightning damage'),
        smartMissiles: dmg('smart missile damage', 'smart missiles damage'),
        deathWave: dmg('death wave damage'),
        innerLandMines: dmg('inner land mine damage', 'inner land mines damage'),
        poisonSwamp: dmg('swamp damage', 'poison swamp damage'),
        blackHole: dmg('black hole damage'),
        orbs: dmg('orb damage'),
        projectiles: dmg('projectiles damage'),
        rendArmor: dmg('rend armor damage'),
        landMines: dmg('land mine damage'),
        thorns: dmg('thorn damage'),
    } : undefined;

    return {
        date: top['Battle Date'] ?? '',
        tier: num(top['Tier']),
        wave: num(top['Wave']),
        gameTimeSec,
        realTimeSec: parseDuration(top['Real Time'] ?? ''),
        coinsEarned,
        coinsPerHour: num(top['Coins Per Hour']),
        totalEnemies: num(enemies['Total Enemies']),
        wavesSkipped: num(counts['Waves Skipped']),
        largestGoldenCombo: num(records['Largest Golden Combo']),
        recoveryPackages: num(utility['Recovery Packages']),
        thornsKills: num(destroyed['Thorns']),
        killedWithEffect: {
            goldenTower: pct('Golden Tower'),
            deathWave: pct('Death Wave'),
            spotlight: pct('Spotlight'),
            goldenBot: pct('Golden Bot'),
            blackHole: pct('Black Hole'),
            orbs: pct('Orbs'),
        },
        coins: {
            goldenCombo: num(coins['Golden Combo']),
            waveSkip: num(coins['Wave Skip']),
            coinsPerWave: num(coins['Coins / Wave']),
            criticalCoin: num(coins['Critical Coin']),
            fetched: num(coins['Coins Fetched']),
        },
        damage,
        projectileCount: dmg('projectiles count') || undefined,
    };
}

// The report the optimizer calibrates from: a run picked from the imported
// game data (choice ≥ 0), otherwise the pasted Battle Report text.
export function activeBattleReport(text: string, imported: BattleReport[], choice: number): BattleReport | null {
    if (choice >= 0 && imported[choice]) return imported[choice];
    return text ? parseBattleReport(text) : null;
}
