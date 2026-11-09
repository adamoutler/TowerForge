// Ask AI: the tools for the Labs page's Lab boosts, Modules → Shard plan,
// What If's tournament mode, the fuller account summary and what a
// tournament question looks at, on the test bench's made-up accounts
// (bench/benchAccounts.ts).

import { describe, expect, it } from 'vitest';
import { useGameStore } from '../store/useGameStore';
import { parseGameExport } from '../engine/gameExport';
import { BENCH_ACCOUNTS } from './bench/benchAccounts';
import { accountSummary, farmTiersReport, guardianReport, labBoostsReport, runsReport, shardPlanReport, whatIfChanges } from './aiTools';
import type { AiAccount, AiTourneySettings } from './aiTools';
import { lookUp } from './aiAssistant';
import type { RouteChoice } from './aiAssistant';

function load(key: 'early' | 'mid' | 'late'): AiAccount {
    const a = BENCH_ACCOUNTS.find(x => x.key === key)!;
    useGameStore.getState().resetAll();
    useGameStore.getState().applyGameImport(parseGameExport(a.raw));
    if (a.build) useGameStore.getState().updateProfile({ build: a.build });
    return useGameStore.getState();
}

describe('lab boosts', () => {
    it('gives the even boosts the cells keep up, and each lab researching at its boost', () => {
        const r = labBoostsReport(load('late'));
        // 210,000 cells an hour in a run, 6.8 hours a day → about 59,400 an hour.
        expect(r.text).toMatch(/^Headline: with about 59,\d{3} cells an hour, your 5 labs can all run at ×5, ×5, ×5, ×5, ×4/);
        expect(r.text).toMatch(/Labs researching .*Enemy HP Lvl Skip Lab Lv 17: 12d 1[12]h left, 2d \d+h at ×5/);
    });

    it('times a lab named in the question at each speed', () => {
        const r = labBoostsReport(load('mid'), 'how long until my damage lab is maxed');
        expect(r.text).toMatch(/Damage Lab \(level 20 of 100\): the next level takes .* unboosted, .* at ×2/);
    });

    it('says how much of a part-done lab is left', () => {
        const s = { ...load('mid'), labProgress: { 'Damage Lab': { toLevel: 21, done: 0.5 } } };
        const r = labBoostsReport(s, 'how long until my damage lab is maxed');
        expect(r.text).toMatch(/Damage Lab \(level 20 of 100\): the next level is 50% done and takes .* unboosted, .* more; all 80 levels left take /);
    });

    it('says so when it doesn\'t know the cells', () => {
        const s = load('mid');
        expect(labBoostsReport({ ...s, importedBattles: [] }).text).toMatch(/^Headline: TowerForge doesn't know how many cells you make yet/);
    });
});

describe('shard plan', () => {
    it('plans each type\'s own shards, the type asked for first', () => {
        const r = shardPlanReport(load('late'), 'how should I spend my armor shards');
        expect(r.title).toBe('Shard plan — armor');
        expect(r.text).toMatch(/^Headline: your armor shards: main slot \(Anti-Cube Portal\) Lv 220 \(no change\), assist slot \(Negative Mass Projector\) Lv 120 → \d+ — [\d,]+ shards/);
        expect(r.text).toMatch(/Best levels for all [\d,]+ armor shards .*Restore the main slot/);
        expect(r.text).not.toMatch(/\d\.\d armor shards/);   // whole shards
    });

    it('says a slot past its rarity cap adds nothing', () => {
        expect(shardPlanReport(load('mid')).text).toMatch(/The main slot is 10 levels past its module's rarity cap/);
    });
});

describe('What If for tournaments', () => {
    it('uses the tournament run and says so', () => {
        const r = whatIfChanges(load('late'), [{ upgrade: 'CL damage', level: 'max' }], { league: '', week: {}, recent: {} });
        expect(r.title).toBe('What If — tournament');
        expect(r.text).toMatch(/^Headline: maxing CL damage gives about \+[\d.]+ tournament waves this week \(runs end around W4\d\d now/);
    });

    it('falls back to campaign runs without a tournament run', () => {
        const r = whatIfChanges(load('early'), [{ upgrade: 'damage lab', level: '+10' }], { league: '', week: {}, recent: {} });
        expect(r.title).toBe('What If');
        expect(r.text).toMatch(/There are no tournament runs saved yet, so this is for campaign runs\./);
    });
});

describe('which tier to farm', () => {
    it('compares coins an hour on the tiers around the one farmed, up to the highest unlocked', () => {
        const r = farmTiersReport(load('late'));
        expect(r.text).toMatch(/^Headline: for coins an hour, T19 is your best tier to farm — about [\d.]+q coins an hour, \d+% more an hour than T18/);
        expect(r.text).toMatch(/^T18: runs end around W8,946, [\d.]+q coins a run in /m);
        expect(r.text).toMatch(/Tiers past T19 aren't unlocked yet\./);
        expect(farmTiersReport(load('mid')).text).toMatch(/^Headline: for coins an hour, T10 is your best tier to farm — .*the tier you farm now\./);
    });
});

describe('Guardian chips', () => {
    it('says the swap to make for the goal and for coins', () => {
        // Equipped: Attack, Bounty, Fetch. Ties list the fewest swaps first.
        const r = guardianReport(load('late'));
        expect(r.text).toMatch(/^Headline: for push further.*, swap Fetch for Scout \(\+[\d.]+%\), so you run Attack, Bounty, Scout\./m);
        expect(r.text).toMatch(/^For more coins \(econ\), swap Fetch for Summon \(\+[\d.]+%\)/m);
        expect(guardianReport(load('mid')).text).toMatch(/^Headline: the Guardian isn't unlocked/);
    });
});

describe('campaign against tournaments', () => {
    it('lists what the runs show differs, the only reasons an answer may give', () => {
        const r = runsReport(load('late'), 'tournament');
        expect(r.text).toMatch(/What TowerForge can see that differs between your campaign and tournament runs/);
        expect(r.text).toMatch(/- Enemies Chain Lightning reached: \d+% campaign, \d+% tournaments\./);
        expect(r.text).toMatch(/- What ended the runs: campaign Ray \d+%.*; tournaments /);
        expect(r.text).toMatch(/none ticked for your tournament runs/);
    });
});

describe('the account summary', () => {
    it('has the labs, the Vault and the Guardian chips', () => {
        const t = accountSummary(load('late'));
        expect(t).toMatch(/Labs: \d+ researched, \d+ maxed; Damage Lab 47\/100, /);
        expect(t).toMatch(/Vault: 5 upgrades bought \(2 maxed\), [\d,]+ keys spent: .*Ad Gem Stack 2\/4/);
        expect(t).toMatch(/Guardian chips equipped: Attack \(.*\); Bounty \(.*\); Fetch \(/);
    });
});

// The first player report (2026-10-30): picks for farming and the farming
// Guardian chips, for "more keys in the Legend tournament".
describe('a tournament question', () => {
    const tourney = { league: 'Legend', week: {}, recent: {} } as AiTourneySettings;
    const q = 'What should I do to perform better and get more keys in the Legend tournament?';
    const route: RouteChoice = { tool: 'upgrades', currency: 'any', goal: 'default', changes: [], search: '', runs: 'tournament', tier: 0, budget: 0 };

    // Six full Optimizer lookups, about 5 s while the other test files run: past
    // Vitest's default limit often enough to stop a deploy now and then.
    it('looks at the picks for tournament runs and where the player stands, whichever tool was picked', { timeout: 20_000 }, () => {
        const account = load('late');
        const titles = (r: RouteChoice) => lookUp(r, q, { account, tourney }).map(x => x.title);
        expect(titles(route)).toEqual(['Optimizer — stones, coins, lab research (tournaments)', 'Tournament']);
        expect(titles({ ...route, tool: 'tournament' })).toEqual(titles(route));
        // A currency or an amount to spend asks for its picks alone.
        expect(titles({ ...route, currency: 'stones', budget: 500 })).toEqual(['Optimizer — stones (tournaments, 500 to spend)']);
        // "How will I do this week" isn't asking what to buy.
        expect(lookUp({ ...route, tool: 'tournament' }, "How will I do in this week's tournament?", { account, tourney }).map(x => x.title)).toEqual(['Tournament', 'Your runs — tournament']);
        expect(lookUp(route, q, { account, tourney })[1].text).toMatch(/doesn't know the rewards for each rank \(keys and the rest\)/);
    });

    // A player report (2026-11-09): "a build to maximize coins per hour".
    it('adds which tier to farm to the coin picks for coins an hour', { timeout: 20_000 }, () => {
        const account = load('late');
        const coins: RouteChoice = { ...route, goal: 'coins', runs: 'any' };
        const titles = (q: string) => lookUp(coins, q, { account, tourney }).map(x => x.title.replace(/ \(.*/, ''));
        expect(titles('Could you recommend a total build set to maximize coins per hour?')).toEqual(['Optimizer — stones, coins, lab research', 'Which tier to farm']);
        expect(titles('How do I get more coins?')).toEqual(['Optimizer — stones, coins, lab research']);
    });

    it('sees the tournament build in the account summary', () => {
        const s = load('late');
        const two: AiAccount = { ...s, profile: { ...s.profile, presets: 2 }, cardData: { ...s.cardData, presets: [s.cardData.presets![0], ['Damage']] } };
        const t = accountSummary(two, Date.now(), { ...tourney, preset: 1 });
        expect(t).toMatch(/below are their tournament build, chosen on the Tournament page/);
        expect(t).toMatch(/Cards in [^:]+: Damage [^,]*\.\n/);
        expect(accountSummary(two, Date.now(), tourney)).toMatch(/No tournament build is chosen on the Tournament page/);
        expect(accountSummary(two)).not.toMatch(/tournament build/);
    });
});
