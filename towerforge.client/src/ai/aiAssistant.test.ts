// Ask AI: what the question itself settles over the model's route (the
// test bench's misses), and the answer's tidy-up.

import { describe, expect, it } from 'vitest';
import { quickRoute, readRoute, tidy } from './aiAssistant';
import { BENCH_QUESTIONS } from './bench/benchQuestions';
import { gradeRoute } from './bench/benchGrade';

const json = (r: Record<string, unknown>) => JSON.stringify({
    tool: 'none', currency: 'any', goal: 'default', changes: [], search: '', runs: 'any', tier: 0, budget: 0, ...r,
});

describe('the route, checked against the question', () => {
    it('takes a tier only from the question (none named = the next tier)', () => {
        expect(readRoute(json({ tool: 'tier', tier: 1 }), 'How far would I get on the next tier up?').tier).toBe(0);
        expect(readRoute(json({ tool: 'tier', tier: 18 }), 'how far could i farm T17').tier).toBe(17);
        expect(readRoute(json({ tool: 'tier', tier: 0 }), 'how far would I get on tier 12?').tier).toBe(12);
    });

    it('drops the earlier upgrade on "… instead?"', () => {
        const r = readRoute(json({ tool: 'what_if', changes: [{ upgrade: 'Death Wave', level: 'max' }, { upgrade: 'CF', level: 'max' }] }),
            'and what about chrono field instead?');
        expect(r.changes.map(c => c.upgrade)).toEqual(['CF']);
    });

    it('sends "what is X" about the game to the notes, not "what tier am I on"', () => {
        const r = readRoute(json({ tool: 'none' }), 'What is enemy level skip?');
        expect([r.tool, r.search]).toEqual(['guide', 'What is enemy level skip?']);
        expect(readRoute(json({ tool: 'none' }), 'What tier am I on?').tool).toBe('none');
    });

    it('sends module shards alone to the shard plan, and lab boosts to their own', () => {
        expect(readRoute(json({ tool: 'upgrades', currency: 'shards' }), 'best use of my module shards').tool).toBe('shard_plan');
        expect(readRoute(json({ tool: 'upgrades', currency: 'research' }), 'what boost should my labs run at').tool).toBe('lab_boosts');
        expect(readRoute('not json', 'how do I spend my armor shards').tool).toBe('shard_plan');
        expect(readRoute('not json', 'how fast can I boost my labs').tool).toBe('lab_boosts');
    });

    it('keeps lab boosts and the shard plan to their questions, and a named currency to its picks', () => {
        expect(readRoute(json({ tool: 'lab_boosts' }), 'What should I research next in the labs?'))
            .toMatchObject({ tool: 'upgrades', currency: 'research' });
        expect(readRoute(json({ tool: 'lab_boosts' }), 'How long until my damage lab is maxed?').tool).toBe('lab_boosts');
        expect(readRoute(json({ tool: 'shard_plan' }), 'Should I buy card slots with my gems?'))
            .toMatchObject({ tool: 'upgrades', currency: 'gems' });
        expect(readRoute(json({ tool: 'none' }), 'where should my medals go')).toMatchObject({ tool: 'upgrades', currency: 'medals' });
        expect(readRoute(json({ tool: 'upgrades', currency: 'any' }), 'What should I research next in the labs?').currency).toBe('research');
        // A currency picked already, or a goal question, stays.
        expect(readRoute(json({ tool: 'upgrades', currency: 'coins', goal: 'coins' }), 'how do I get more coins').currency).toBe('coins');
        expect(readRoute(json({ tool: 'what_if', changes: [{ upgrade: 'CL', level: 'max' }] }), 'is maxing CL worth my stones').tool).toBe('what_if');
    });

    it('sends which-tier-to-farm and Guardian chip questions to their tools', () => {
        expect(readRoute(json({ tool: 'tier', tier: 0 }), 'Which tier should I farm for coins?').tool).toBe('farm_tier');
        expect(readRoute(json({ tool: 'tier', tier: 19 }), 'is T19 better to farm than T18?').tool).toBe('tier');
        expect(readRoute(json({ tool: 'none' }), 'Which guardian chips should I use?').tool).toBe('guardian');
    });

    it('reads a league named as a tournament question, and the Tournament tool as tournament runs', () => {
        const q = 'What should I do to perform better and get more keys in the Legend tournament?';
        expect(readRoute(json({ tool: 'upgrades', runs: 'any' }), q).runs).toBe('tournament');
        expect(readRoute(json({ tool: 'upgrades', runs: 'any' }), 'How do I place higher in my Champion bracket?').runs).toBe('tournament');
        expect(readRoute(json({ tool: 'tournament', runs: 'any' }), 'Am I going to move up a league?').runs).toBe('tournament');
        // A rarity isn't a league.
        expect(readRoute(json({ tool: 'upgrades', runs: 'any' }), 'Which legendary module should I upgrade?').runs).toBe('any');
    });

    it('falls back to keywords when the JSON can\'t be read', () => {
        expect(readRoute('not json', 'How do I get more coins?')).toMatchObject({ tool: 'upgrades', goal: 'coins', guessed: true });
        expect(readRoute('not json', 'a build to maximize coins per hour')).toMatchObject({ tool: 'upgrades', goal: 'coins' });
    });

    // Player reports, 2026-11-09: the routes the model gave, and what they become.
    it('sends how-to questions about a game thing to the notes, not the model\'s memory', () => {
        const q = 'How do I get a permanent Black Hole in tournaments without perks and the Galaxy Compressor?';
        expect(readRoute(json({ tool: 'none' }), q)).toMatchObject({ tool: 'guide', search: q });
        expect(readRoute(json({ tool: 'none' }), 'hi').tool).toBe('none');
        expect(readRoute(json({ tool: 'none' }), 'Write me a poem about towers').tool).toBe('none');
    });

    it('reads earning coins said any way as the coin picks', () => {
        const q = 'Could you recommend a total build set to maximize coins per hour?';
        expect(readRoute(json({ tool: 'none' }), q)).toMatchObject({ tool: 'upgrades', goal: 'coins', currency: 'any' });
        // The 4B's own pick on the bench: the tiers alone, for a question that never says tier.
        expect(readRoute(json({ tool: 'farm_tier' }), q)).toMatchObject({ tool: 'upgrades', goal: 'coins' });
        expect(readRoute(json({ tool: 'farm_tier' }), 'Which tier should I farm for the most coins per hour?').tool).toBe('farm_tier');
    });

    it('sends a lab named in full to What If on that lab, unless it asks what to buy', () => {
        const q = 'My coin/wave workshop is maxed out so it gave the wrong information. I am asking specifically on the research lab not the workshop now anser';
        const r = readRoute(json({ tool: 'upgrades', currency: 'coins', goal: 'coins' }), q);
        expect([r.tool, r.changes]).toEqual(['what_if', [{ upgrade: 'Coins/Wave Lab', level: 'max' }]]);
        expect(readRoute(json({ tool: 'upgrades', currency: 'research' }), 'Should I research the coins/wave lab or the cash/wave lab next?').tool).toBe('upgrades');
        expect(readRoute(json({ tool: 'upgrades' }), 'How do I get more damage from labs?').tool).toBe('upgrades');
    });
});

describe('questions routed from their wording (no model)', () => {
    it('routes every bench question it takes the way the bench wants, and leaves What Ifs to the model', () => {
        let taken = 0;
        for (const qn of BENCH_QUESTIONS) {
            const r = quickRoute(qn.q);
            if (!r) continue;
            taken++;
            for (const acc of qn.accounts ?? ['early', 'mid', 'late'] as const) expect([qn.id, gradeRoute(qn, acc, r)]).toEqual([qn.id, []]);
        }
        expect(taken).toBeGreaterThanOrEqual(15);
        expect(quickRoute('how many waves would maxing CL get me')).toBeNull();
        expect(quickRoute('is ps worth it')).toBeNull();
        expect(quickRoute('how far would I get on T19')).toBeNull();
    });
});

describe('the answer', () => {
    it('drops "based on the data" (the player never sees it)', () => {
        expect(tidy('Based on the data provided, you would reach W2,366 on T11.')).toBe('You would reach W2,366 on T11.');
        expect(tidy('Yes, it is worth it based on the data. It costs 49.80K coins.')).toBe('Yes, it is worth it. It costs 49.80K coins.');
        expect(tidy('Runs end at W409.\nAccording to your data, Orbs do 18%.')).toBe('Runs end at W409.\nOrbs do 18%.');
        expect(tidy('Chain Lightning does 14%.')).toBe('Chain Lightning does 14%.');
        expect(tidy('Based on your current progress and the data provided, you would reach W363 on T6.')).toBe('You would reach W363 on T6.');
        expect(tidy('However, the data shows that maxing both does nothing.')).toBe('However, maxing both does nothing.');
        expect(tidy('CL is not weaker, but the data shows it contributes less.')).toBe('CL is not weaker, but TowerForge\'s numbers show it contributes less.');
    });

    it('reads "my runs" as the runs', () => {
        expect(readRoute(json({ tool: 'guide' }), 'Which UW does the most damage in my runs?')).toMatchObject({ tool: 'runs', runs: 'any' });
        expect(readRoute(json({ tool: 'none' }), 'What keeps killing me in tournaments?')).toMatchObject({ tool: 'runs', runs: 'tournament' });
        expect(readRoute(json({ tool: 'upgrades' }), 'what should I buy to improve my runs').tool).toBe('upgrades');
    });
});
