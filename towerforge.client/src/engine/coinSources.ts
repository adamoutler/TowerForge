// ============================================================
//  TowerForge Companion — Coins by source
//  What the game's Battle Report says each coin effect brought in.
//
//    Coins = kill coins + Golden Combo + Wave Skip + Guardian Fetch + Coins/Wave
//    Each effect's line = kill coins × (1 − 1 ÷ its average ×)
//
//  So a line is what kill coins would lose without that effect, which is why
//  they overlap and add up to more than all the coins. The reading is the
//  code's, checked on the owner's 18 long campaign runs (2026-11-01): the kill
//  share and multiplier the coin model uses land on the game's Death Wave,
//  Golden Tower, Black Hole and Spotlight lines to within 1% (median). Orbs run
//  5% over. Golden Bot is far over until Bot Bot is counted (engine/farming.ts).
//  Pure functions — no store imports.
// ============================================================

import type { BattleReport } from './battleReport';
import type { FarmEffect } from './farming';

const LINES: Record<FarmEffect, string> = {
    gt: 'CoinsFromGoldenTower',
    bh: 'CoinsFromBlackHole',
    sl: 'CoinsFromSpotlight',
    dw: 'CoinsFromDeathWave',
    gb: 'GoldenBotCoinsEarned',
    orb: 'CoinsFromOrbs',
};

export interface CoinSources {
    total: number;
    kill: number;      // kill coins, with Critical Coin in them
    combo: number;     // Golden Combo
    skip: number;      // Wave Skip
    fetched: number;   // Guardian Fetch
    perWave: number;   // Coins/Wave
    coins: Record<FarmEffect, number>;           // each effect's line
    factor: Record<FarmEffect, number | null>;   // the average × it implies; null when it can't be read
}

// Null for a run without the lines (a pasted Battle Report, an old save).
export function coinSources(run: BattleReport): CoinSources | null {
    const raw = run.raw ?? {};
    if (typeof raw[LINES.gt] !== 'number') return null;
    const { waveSkip: skip, goldenCombo: combo, coinsPerWave: perWave } = run.coins;
    const fetched = run.coins.fetched ?? 0;
    const kill = run.coinsEarned - skip - combo - fetched - perWave;
    if (kill <= 0) return null;
    const coins = {} as CoinSources['coins'];
    const factor = {} as CoinSources['factor'];
    for (const e of Object.keys(LINES) as FarmEffect[]) {
        const line = raw[LINES[e]];
        coins[e] = typeof line === 'number' ? line : 0;
        factor[e] = coins[e] > 0 && coins[e] < kill ? 1 / (1 - coins[e] / kill) : null;
    }
    return { total: run.coinsEarned, kill, combo, skip, fetched, perWave, coins, factor };
}
