// ============================================================
//  TowerForge Companion — Ask AI test bench: the questions
//  What players ask, in their words (typos, short names and slang too),
//  with the data each should be answered from: the tool step 1 should
//  pick and the fields that matter (currency, goal, runs, budget, tier,
//  the upgrades named). `accounts` limits a question to the accounts it
//  fits (Smite needs UW+); `followUp` asks it in the same chat right
//  after the one before. `mustNot` catches known misreadings ("PS" as
//  Power Stones). "The next tier" may be read from the tier farmed or
//  the highest reached (or left 0, which the site takes as the next). Grading: benchGrade.ts; runner: runBench.ts.
// ============================================================

import type { Route } from '../aiAssistant';

export type BenchAccountKey = 'early' | 'mid' | 'late';
type Tool = Route['tool'];

export interface BenchQuestion {
    id: string;
    q: string;
    accounts?: BenchAccountKey[];
    followUp?: boolean;
    expect: {
        tool: Tool | Tool[];               // any of these is right
        currency?: Route['currency'] | Route['currency'][];
        goal?: Route['goal'] | Route['goal'][];
        runs?: Route['runs'] | Route['runs'][];
        budget?: number;
        tier?: number | Partial<Record<BenchAccountKey, number[]>>;   // 0 = "the next tier" to the site
        upgrades?: string[];               // each named upgrade (any wording containing it)
        notUpgrades?: string[];            // upgrades it must have dropped ("… instead?")
    };
    mustNot?: RegExp[];
    // A question about what the account has now: the data's headline (a
    // recommendation) isn't what it asks for.
    noHeadline?: boolean;
}

export const BENCH_QUESTIONS: BenchQuestion[] = [
    // ── What to buy ──────────────────────────────────────────────
    { id: 'stones', q: 'What should I spend my stones on?', expect: { tool: 'upgrades', currency: 'stones' } },
    { id: 'stones-slang', q: 'wat shud i upgrade nxt w/ my stonez', expect: { tool: 'upgrades', currency: 'stones' } },
    { id: 'coins-budget', q: 'I have 2.4B coins, what workshop upgrades should I buy?', accounts: ['early'], expect: { tool: 'upgrades', currency: 'coins', goal: ['default', 'waves'], budget: 2.4e9 } },
    { id: 'coins-budget-late', q: 'I have 4Q coins to spend, what should I buy in the workshop?', accounts: ['late'], expect: { tool: 'upgrades', currency: 'coins', goal: ['default', 'waves'], budget: 4e18 } },
    { id: 'stones-tourney', q: "I'm about to get 500 stones, what's the best way to do better in tournaments?", accounts: ['mid', 'late'], expect: { tool: 'upgrades', currency: 'stones', runs: 'tournament', budget: 500 } },
    { id: 'more-coins', q: 'How do I get more coins?', expect: { tool: 'upgrades', currency: ['any', 'coins'], goal: 'coins' } },
    { id: 'labs', q: 'What should I research next in the labs?', expect: { tool: 'upgrades', currency: 'research' } },
    { id: 'medals', q: 'where should my medals go', expect: { tool: 'upgrades', currency: 'medals' } },
    { id: 'shards', q: "what's the best use of my module shards", accounts: ['mid', 'late'], expect: { tool: ['shard_plan', 'upgrades'] } },
    { id: 'gems', q: 'Should I buy card slots with my gems?', expect: { tool: 'upgrades', currency: 'gems' } },
    { id: 'survive', q: 'How do I survive longer?', expect: { tool: 'upgrades', goal: 'survival' } },
    { id: 'push-cheap', q: "what's the cheapest way to push more waves", expect: { tool: 'upgrades', goal: 'waves' } },

    // ── What would an upgrade do ─────────────────────────────────
    { id: 'whatif-dw', q: 'How many waves would maxing Death Wave get me?', accounts: ['mid', 'late'], expect: { tool: 'what_if', upgrades: ['death wave|dw'] } },
    { id: 'whatif-cf-follow', q: 'and what about chrono field instead?', accounts: ['mid', 'late'], followUp: true, expect: { tool: 'what_if', upgrades: ['chrono|cf'], notUpgrades: ['death wave|dw'] } },
    { id: 'whatif-not-owned', q: 'How many waves would maxing Death Wave get me?', accounts: ['early'], expect: { tool: 'what_if', upgrades: ['death wave|dw'] } },
    { id: 'whatif-lab', q: 'Is 10 more levels of the damage lab worth it?', expect: { tool: 'what_if', upgrades: ['damage'] } },
    { id: 'whatif-level', q: 'what would CL damage 25 do for me', accounts: ['mid', 'late'], expect: { tool: 'what_if', upgrades: ['cl|chain'] } },
    { id: 'whatif-compare', q: 'Which is better: maxing black hole duration or golden tower multiplier?', accounts: ['mid', 'late'], expect: { tool: 'what_if', upgrades: ['black hole|bh', 'golden tower|gt'] } },
    { id: 'whatif-plus', q: 'what if I max Smite', accounts: ['late'], expect: { tool: 'what_if', upgrades: ['smite|cl\\+|chain'] } },

    // ── Lab boosts and the shard plan (their pages' plans) ───────
    { id: 'boost-labs', q: 'What speed should I boost my labs to?', accounts: ['mid', 'late'], expect: { tool: 'lab_boosts' } },
    { id: 'lab-time', q: 'How long until my damage lab is maxed?', accounts: ['mid', 'late'], expect: { tool: 'lab_boosts' } },
    { id: 'shard-armor', q: 'How should I spend my armor shards?', accounts: ['late'], expect: { tool: 'shard_plan' } },
    { id: 'shard-best', q: 'what are the best levels for all my cannon shards', accounts: ['mid', 'late'], expect: { tool: 'shard_plan' } },
    { id: 'whatif-tourney', q: 'How many tournament waves would maxing CL damage get me?', accounts: ['mid', 'late'], expect: { tool: 'what_if', runs: 'tournament', upgrades: ['cl|chain'] } },

    // ── Levels and the account ───────────────────────────────────
    { id: 'lab-level', q: 'What level is my super crit mult lab?', accounts: ['late'], expect: { tool: ['levels', 'none'] } },
    { id: 'vault', q: 'What have I bought in the vault?', accounts: ['late'], expect: { tool: ['none', 'levels'] } },
    { id: 'guardian-chips', q: 'Which guardian chips am I using?', accounts: ['late'], expect: { tool: ['none', 'levels', 'guardian'] }, noHeadline: true },
    { id: 'guardian-best', q: 'Which guardian chips should I use?', accounts: ['late'], expect: { tool: 'guardian' } },
    { id: 'level-gt', q: 'what level is my Golden Tower?', expect: { tool: ['levels', 'none'] } },
    { id: 'level-ws', q: "What's my workshop damage level?", expect: { tool: ['levels', 'none'] } },
    { id: 'my-tier', q: 'What tier am I on?', expect: { tool: ['none', 'levels'] } },

    // ── Runs ─────────────────────────────────────────────────────
    { id: 'runs-damage', q: 'Which UW does the most damage in my runs?', expect: { tool: 'runs', runs: ['any', 'campaign'] } },
    { id: 'runs-killed', q: 'What keeps killing me?', expect: { tool: 'runs', runs: ['any', 'campaign'] } },
    { id: 'runs-cl-tourney', q: 'Why is my chain lightning weak in tournaments?', accounts: ['mid', 'late'], expect: { tool: 'runs', runs: 'tournament' } },

    // ── Another tier ─────────────────────────────────────────────
    { id: 'tier-next', q: 'How far would I get on the next tier up?', expect: { tool: 'tier', tier: { early: [0, 6, 7], mid: [0, 11, 12, 13], late: [0, 19, 20] } } },
    { id: 'tier-named', q: 'how far could i farm T17', accounts: ['late'], expect: { tool: 'tier', tier: { late: [17] } } },
    { id: 'tier-named-mid', q: 'how far could i farm T11', accounts: ['mid'], expect: { tool: 'tier', tier: { mid: [11] } } },

    { id: 'farm-tier', q: 'Which tier should I farm for coins?', expect: { tool: 'farm_tier' } },

    // ── Tournaments ──────────────────────────────────────────────
    { id: 'tourney-week', q: "How will I do in this week's tournament?", accounts: ['mid', 'late'], expect: { tool: 'tournament' } },
    { id: 'tourney-league', q: 'Am I going to move up a league?', accounts: ['mid', 'late'], expect: { tool: 'tournament' } },
    { id: 'tourney-rank', q: "What's my best tournament rank?", accounts: ['late'], expect: { tool: 'tournament' } },
    { id: 'tourney-none', q: 'How do I do better in tournaments?', accounts: ['early'], expect: { tool: ['upgrades', 'tournament'] } },
    // From the first player report (2026-10-30): picks for farming, the farming Guardian chips.
    { id: 'tourney-keys', q: 'What should I do to perform better and get more keys in the Legend tournament?', accounts: ['mid', 'late'], expect: { tool: ['upgrades', 'tournament'], runs: 'tournament' }, mustNot: [/\bfarm/i] },

    // ── How the game works ───────────────────────────────────────
    { id: 'guide-cf', q: 'How does Chrono Field work?', accounts: ['late'], expect: { tool: 'guide' } },
    { id: 'guide-skip', q: 'What is enemy level skip?', accounts: ['late'], expect: { tool: 'guide' } },
    { id: 'guide-module', q: 'What does the Death Penalty module do?', accounts: ['late'], expect: { tool: 'guide' } },
    { id: 'guide-site', q: 'How does TowerForge work out the best upgrade?', accounts: ['late'], expect: { tool: 'guide' } },
    { id: 'guide-ps', q: 'is ps worth it', accounts: ['late'], expect: { tool: ['what_if', 'guide', 'levels'] }, mustNot: [/power stone/i] },

    // ── Player reports, 2026-11-09 ───────────────────────────────
    // Went to "none" and answered from the model's own memory: the notes
    // say what closes Black Hole's 12s gap without the perk.
    { id: 'bh-permanent', q: 'How do I get a permanent Black Hole in tournaments without perks and the Galaxy Compressor?', accounts: ['mid', 'late'], expect: { tool: 'guide' } },
    // Went to "none": the coin picks (and which tier, for "per hour").
    { id: 'coins-build', q: 'Could you recommend a total build set to maximize coins per hour?', expect: { tool: 'upgrades', goal: 'coins' } },
    // Got the coin picks, and "coin/wave lab" matched the workshop's
    // Coin/Wave: What If on the Coins/Wave Lab.
    { id: 'coin-wave-lab', q: 'My coin/wave workshop is maxed out so it gave the wrong information. I am asking specifically on the research lab not the workshop now anser', accounts: ['mid', 'late'], expect: { tool: 'what_if', upgrades: ['coins?/wave lab'] } },

    // Went to the notes and the 8B made up 3.72B each: What If on both skips.
    { id: 'skip-cost', q: 'How many coins will it cost to max out both of my Enemy level skips in my workshop?', accounts: ['mid', 'late'], expect: { tool: 'what_if', upgrades: ['enemy atk level skip', 'enemy hp level skip'] } },

    // ── Not about the account ────────────────────────────────────
    { id: 'hello', q: 'hi', accounts: ['mid'], expect: { tool: 'none' } },
    { id: 'off-topic', q: 'Write me a poem about towers', accounts: ['mid'], expect: { tool: 'none' } },
];
