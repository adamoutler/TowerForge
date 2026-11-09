// Ask AI: the data the assistant reads — upgrades named in words, levels,
// the account summary, What If and the Optimizer's picks on a made-up
// account, and the game notes search.

import { describe, expect, it } from 'vitest';
import { useGameStore } from '../store/useGameStore';
import { parseGameExport } from '../engine/gameExport';
import { snapshotFromState } from '../engine/accountModels';
import { upgradeTargets } from '../engine/whatIf';
import { UWS } from '../constants/gameData';
import { battle, makeExport } from '../test/makeExport';
import {
    accountSummary, bestUpgrades, budgetIn, findTargets, levelFor, levelsOf, runsReport, tierOutlook, tournamentOutlook, whatIfChanges, wordsOf,
} from './aiTools';
import type { AiAccount } from './aiTools';
import { searchNotes } from './aiKnowledge';

// Five T18 deaths to Rays with damage by source (made up).
const runs = parseGameExport(makeExport({
    BattleHistory: [8100, 8200, 8402, 8500, 8501].map((wave, i) => battle({
        BattleDate: `2026-10-1${i}T12:00:00Z`, Wave: wave, KilledBy: 9,
        HealthLevelSkips: Math.floor(wave * 0.58), AttackLevelSkips: Math.floor(wave * 0.577),
        DamageDealt: 1000, ChainLightningDamage: 300, OrbDamage: 400, BlackHoleDamage: 200, ProjectilesDamage: 100,
        ProjectilesCount: 10000, EnemiesHitByChainLightningThisRound: 500, DestroyedInBlackhole: 900,
    })),
})).battles;

function account(): AiAccount {
    const st = useGameStore.getState();
    return {
        ...st,
        profile: { ...st.profile, build: 'Glass Cannon', highestTier: 18 },
        labData: { 'Damage Lab': 40 },
        uwData: { stones: 0, data: Object.fromEntries(UWS.map(u => [u.a, { own: true, sv: [10, 3, 10], upOwn: true, upLvl: 2 }])) },
        importedBattles: runs,
        battleReportChoice: runs.length - 1,
    };
}

describe('upgrades named in words', () => {
    const targets = upgradeTargets(snapshotFromState(account()));
    const labels = (q: string) => findTargets(targets, q).map(t => t.label);

    it('reads UW short names and UW+', () => {
        expect(wordsOf('max CF+')).toEqual(['+', 'chrono', 'field']);
        expect(labels('CL')).toEqual(['Chain Lightning — Damage', 'Chain Lightning — Quantity', 'Chain Lightning — Chance']);
        expect(labels('CL damage')).toEqual(['Chain Lightning — Damage']);
        expect(labels('CF+')).toEqual(['Chrono Field+ — Chrono Loop']);
        expect(labels('chrono loop')).toEqual(['Chrono Field+ — Chrono Loop']);
    });

    it('tells the workshop from labs', () => {
        expect(labels('damage')).toEqual(['Damage']);
        expect(findTargets(targets, 'damage')[0].kind).toBe('workshop');
        expect(labels('damage lab')).toEqual(['Damage Lab']);
    });

    // A player report (2026-11-09): "coin/wave lab" read as the workshop's Coin/Wave.
    it('reads one and many the same ("coin/wave lab" is the Coins/Wave Lab)', () => {
        expect(labels('coin/wave lab')).toEqual(['Coins/Wave Lab']);
        expect(labels('coins per wave lab')).toEqual(['Coins/Wave Lab']);
        expect(labels('coin/wave')).toEqual(['Coin/Wave']);
        expect(findTargets(targets, 'coin/wave')[0].kind).toBe('workshop');
    });

    it('finds nothing for words that match nothing', () => {
        expect(findTargets(targets, 'banana')).toEqual([]);
    });

    it('reads levels: max, more, next or a number (within the max)', () => {
        const t = { kind: 'uw' as const, key: 'CL|0', group: '', label: '', current: 10, max: 32 };
        expect(levelFor(t, 'max')).toBe(32);
        expect(levelFor(t, '+5')).toBe(15);
        expect(levelFor(t, '+50')).toBe(32);
        expect(levelFor(t, 'next')).toBe(11);
        expect(levelFor(t, 'level 20')).toBe(20);
        expect(levelFor(t, 'lots')).toBeNull();
    });
});

describe('what the assistant reads', () => {
    it('summarizes the account', () => {
        const text = accountSummary(account());
        expect(text).toContain('Build: Glass Cannon');
        expect(text).toContain('Chain Lightning (Damage 10/32, Quantity 3/5, Chance 10/16; Smite (UW+) 3/12)');
        expect(text).toContain('T18 W8,501, killed by Ray');
    });

    it('looks up current levels', () => {
        expect(levelsOf(account(), 'damage lab').text).toBe('Damage Lab (Labs — Attack Research): level 40 of 100');
    });

    it('works out What If for named upgrades, with costs and waves', () => {
        const r = whatIfChanges(account(), [{ upgrade: 'CL damage', level: '+5' }]);
        expect(r.text).toContain('Chain Lightning — Damage: 10 → 15 (max 32), costs');
        expect(r.text).toMatch(/^Headline: CL damage \+5 levels gives about \+[\d.]+ waves \(runs end around W[\d,]+ now, W[\d,]+ after\)\. It costs [\d,]+ stones\./);
        expect(r.text).toContain('Total cost:');
        expect(whatIfChanges(account(), [{ upgrade: 'banana', level: 'max' }]).text).toContain('Couldn\'t find "banana"');
    });

    it('lists the Optimizer\'s next stone picks', () => {
        const r = bestUpgrades(account(), 'stones');
        expect(r.text).toContain('Goal: Push further');
        expect(r.text).toMatch(/Next stones:\n1\. /);
    });
});

describe('runs and other tiers', () => {
    it('lists the runs with damage by source', () => {
        const r = runsReport(account());
        expect(r.text).toContain('Saved runs: 5 (5 campaign, 0 tournament)');
        expect(r.text).toContain('Damage by source, last campaign runs on T18: Orbs 40%, Chain Lightning 30%, Black Hole 20%, Tower shots 10%.');
        expect(r.text).toContain('T18 W8,501, killed by Ray');
    });

    it('moves each death to another tier by the enemy health it ended at', () => {
        // The same tier gives the same waves back, give or take the 2–3
        // waves a health level lasts at 58% level skip (it's the first wave
        // that reaches that health).
        const same = tierOutlook(account(), 18).text;
        for (const w of [8100, 8200, 8402, 8500, 8501]) {
            const hit = new RegExp(`T18 W${w.toLocaleString()} → T18 W([\\d,]+)`).exec(same);
            expect(Math.abs(Number(hit![1].replace(/,/g, '')) - w)).toBeLessThanOrEqual(3);
        }
        // Tougher enemies on T19: fewer waves for the same damage.
        const next = tierOutlook(account(), 19).text;
        const wave = Number(/Headline: runs on T19 would end around W([\d,]+)\./.exec(next)![1].replace(/,/g, ''));
        expect(wave).toBeGreaterThan(1000);
        expect(wave).toBeLessThan(8341);
    });

    it('says what can be bought now, adding the costs up in the Optimizer\'s order', () => {
        const a = account();
        const none = bestUpgrades({ ...a, currencies: { ...a.currencies, stones: 0 } }, 'stones');
        expect(none.text).toMatch(/The 0 stones you hold don't cover the best next buy yet: it needs [\d,]+ more\./);
        // Enough for the first pick and not the second: only the first is bought.
        const first = /^1\. .* — .*; costs ([\d,]+) stones$/m.exec(none.text)!;
        const cost = Number(first[1].replace(/,/g, ''));
        const one = bestUpgrades({ ...a, currencies: { ...a.currencies, stones: cost } }, 'stones');
        expect(one.text).toMatch(new RegExp(`With the ${cost.toLocaleString()} stones you hold now: buy [^;]+ — ${cost.toLocaleString()} stones, leaving 0\\. The next one, .+, needs [\\d,]+ more\\.`));
    });

    it('says why there is nothing to buy', () => {
        const a = account();
        const uwData = { ...a.uwData, data: Object.fromEntries(UWS.map(u => [u.a, { own: u.a === 'GT', sv: [3, 5, 3], upOwn: false, upLvl: 0 }])) };
        const r = bestUpgrades({ ...a, uwData }, 'stones', 'waves');
        // The Optimizer page's own note (engine/unlocks.ts).
        expect(r.text).toMatch(/nothing the Optimizer can score for this goal\.\nUnlocking your next Ultimate Weapon isn’t ranked here: .* The next costs 50 stones/);
    });

    it('shows waves, not a compounded percentage, when pushing waves', () => {
        const r = bestUpgrades(account(), 'stones', 'waves');
        expect(r.text).toMatch(/Next stones:\n1\. .* — [+−][\d.]+ waves/);
        expect(r.text).not.toMatch(/Next stones:\n1\. .* — [+−][\d.]+%/);
    });
});

describe('things a small model gets wrong on its own', () => {
    it('says a UW isn\'t owned instead of trying a lab with its name', () => {
        const a = account();
        const uwData = { ...a.uwData, data: { ...a.uwData.data, DW: { own: false, sv: [1, 1, 1] as [number, number, number], upOwn: false, upLvl: 0 } } };
        const r = whatIfChanges({ ...a, uwData }, [{ upgrade: 'Death Wave', level: 'max' }]);
        expect(r.text).toMatch(/^Headline: Death Wave isn't unlocked on this account yet/);
        expect(r.text).not.toMatch(/DW-Health/);
        expect(whatIfChanges({ ...a, uwData }, [{ upgrade: 'Kill Wall', level: 'max' }]).text).toMatch(/Kill Wall \(Death Wave's UW\+\) isn't unlocked/);
        // A lab named with the UW's words is still a lab.
        expect(whatIfChanges({ ...a, uwData }, [{ upgrade: 'death wave health lab', level: '+1' }]).text).not.toMatch(/isn't unlocked/);
    });

    it('works out the change in coins itself', () => {
        const r = whatIfChanges(account(), [{ upgrade: 'damage lab', level: '+10' }]);
        const m = /Coins per hour: ([\d.]+\w?) → ([\d.]+\w?) \(([+−])([\d.]+\w?)\)/.exec(r.text);
        if (m) expect(m[3]).toBe('+');
    });

    it('puts campaign and tournament damage side by side', () => {
        const a = account();
        const tourney = parseGameExport(makeExport({
            BattleHistory: [battle({ BattleDate: '2026-10-20T12:00:00Z', Wave: 400, IsTournament: true, KilledBy: 4, DamageDealt: 100, ChainLightningDamage: 10, OrbDamage: 90 })],
        })).battles;
        const r = runsReport({ ...a, importedBattles: [...a.importedBattles, ...tourney] }, 'any');
        expect(r.text).toMatch(/Chain Lightning 30% campaign, 10% tournaments/);
        expect(r.text).toMatch(/Ultimate Weapons you own that deal no damage of their own: Chrono Field \(it slows enemies\), Golden Tower/);
    });

    it('spells out the league order and the best rank', () => {
        const a = account();
        const tourneyRecords = [
            { number: 1, date: Date.parse('2026-09-03T12:00:00Z'), league: 'Champion' as const, wave: 1900, rank: 3 },
            { number: 2, date: Date.parse('2026-09-21T12:00:00Z'), league: 'Champion' as const, wave: 2080, rank: 1 },
            { number: 3, date: Date.parse('2026-10-02T12:00:00Z'), league: 'Legend' as const, wave: 410, rank: 18 },
        ];
        const tourney = parseGameExport(makeExport({
            BattleHistory: [battle({ BattleDate: '2026-10-20T12:00:00Z', Wave: 400, IsTournament: true, KilledBy: 4 })],
        })).battles;
        const r = tournamentOutlook({ ...a, importedBattles: [...a.importedBattles, ...tourney], tourneyRecords },
            { league: 'Legend', week: {}, recent: {} });
        expect(r.text).toMatch(/Leagues from lowest to highest: Copper, .*, Champion, Legend, Mythic; the next one up is Mythic, so Legend isn't the highest\./);
        expect(r.text).toMatch(/Best rank ever: 1, in Champion on 2026-09-21 \(W2,080\)\./);
        expect(r.text).toMatch(/none are ticked on the Tournament page yet/);
    });
});

describe('a budget named in the question', () => {
    it('reads the amount', () => {
        expect(budgetIn('I am about to get 1500 stones, what should I buy')).toBe(1500);
        expect(budgetIn('I have 1,500 stones')).toBe(1500);
        expect(budgetIn('with 1.5k stones')).toBe(1500);
        expect(budgetIn('10T coins to spend')).toBe(1e13);
        expect(budgetIn('2q coins')).toBe(2e15);
        expect(budgetIn('2Q coins')).toBe(2e18);
        expect(budgetIn('what should I buy next')).toBe(0);
    });

    it('cuts the Optimizer\'s stone path where the stones run out', () => {
        const r = bestUpgrades(account(), 'stones', 'waves', { budget: 1500 });
        expect(r.title).toBe('Optimizer — stones (1,500 to spend)');
        const plan = /Plan for 1,500 stones .*:\n((?:\d+\. .*\n?)+)/.exec(r.text);
        expect(plan).not.toBeNull();
        const costs = [...plan![1].matchAll(/; costs ([\d.,]+K?) stones$/gm)].map(m => (m[1].endsWith('K') ? parseFloat(m[1]) * 1000 : Number(m[1].replace(/,/g, ''))));
        expect(costs.length).toBeGreaterThan(0);
        expect(costs.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1500 + 10 * costs.length);   // K rounding
        const spent = Number(/— ([\d,]+) stones in all/.exec(r.text)![1].replace(/,/g, ''));
        expect(spent).toBeLessThanOrEqual(1500);
        expect(r.text).toMatch(/stones in all, about [+−][\d.]+ waves\./);
    });

    it('says when nothing fits', () => {
        const r = bestUpgrades(account(), 'stones', 'waves', { budget: 1 });
        expect(r.text).toMatch(/Plan for 1 stones: nothing fits — the best next stones buy, .*, costs /);
    });
});

describe('upgrades for tournaments', () => {
    it('scores on the tournament runs when asked', () => {
        const a = account();
        const tourney = parseGameExport(makeExport({
            BattleHistory: [battle({ BattleDate: '2026-10-20T12:00:00Z', Wave: 300, KilledBy: 9, IsTournament: true, DamageDealt: 1000, OrbDamage: 600, ChainLightningDamage: 400 })],
        })).battles;
        const r = bestUpgrades({ ...a, importedBattles: [...a.importedBattles, ...tourney] }, 'stones', 'waves', { runs: 'tournament' });
        expect(r.title).toBe('Optimizer — stones (tournaments)');
        expect(r.text).toContain('Scored for tournaments: on your tournament runs (newest: W300)');
    });

    it('says so when there are no tournament runs', () => {
        const r = bestUpgrades(account(), 'stones', 'waves', { runs: 'tournament' });
        expect(r.text).toContain('There are no tournament runs saved yet');
    });
});

describe('game notes search', () => {
    it('finds a battle condition by name', () => {
        const hits = searchNotes('How does Fast’s Ultimate work?');
        expect(hits[0].heading).toBe('Fast’s Ultimate');
    });

    // A player report (2026-11-09); the answer is in the Black Hole notes.
    it('finds Black Hole first for a permanent Black Hole', () => {
        const hits = searchNotes('How do I get a permanent Black Hole in tournaments without perks and the Galaxy Compressor?');
        expect(hits[0].heading).toMatch(/Black Hole \(BH\)$/);
        expect(hits[0].text).toMatch(/Permanent Black Hole/);
    });

    it('finds UW notes and stays within the budget', () => {
        const hits = searchNotes('chrono field slow duration', 3, 3200);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.some(h => /chrono/i.test(h.heading + h.text))).toBe(true);
        expect(hits.reduce((a, h) => a + h.text.length, 0)).toBeLessThanOrEqual(3200);
    });
});
