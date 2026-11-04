// The home page's meters and what's ticking: counted the way each tab
// counts (labs maxed of those open, workshop stats at max, 7★ cards, UWs
// and bots owned), the next lab to finish, the farthest wave. Made-up data.

import { describe, expect, it } from 'vitest';
import { accountMeters, farthestPoint, labsTicking } from './accountProgress';
import { CARDS, LABS, UWS, WS_STATS } from '../constants/gameData';
import { BOTS_CONFIG } from '../constants/botData';
import type { MeterInputs } from './accountProgress';
import type { LabRunning } from '../types/gameTypes';

const empty = (): MeterInputs => ({
    labData: {},
    wsData: [{ attack: [], defense: [], utility: [] }],
    presetIdx: 0,
    cardData: { data: {}, slots: 1, presets: {} },
    uwData: { data: {}, stones: 0 },
    botData: {},
    progress: { tierWaves: { 1: 26 }, completedTier: 0 },
});
const meter = (x: MeterInputs, id: string) => accountMeters(x).find(m => m.id === id)!;

describe('account meters', () => {
    it('counts nothing on a new account, and labs only once they open', () => {
        const x = empty();
        expect(accountMeters(x).map(m => [m.id, m.done])).toEqual([['labs', 0], ['workshop', 0], ['cards', 0], ['uws', 0], ['bots', 0]]);
        expect(meter(x, 'labs').total).toBe(0);   // the Labs open at Tier 1, wave 30
        expect(meter(x, 'workshop').total).toBe(Object.values(WS_STATS).flat().length);
        expect(meter(x, 'cards').total).toBe(CARDS.length);
    });

    it('counts maxed labs and workshop stats, 7★ cards, owned UWs and bots', () => {
        const x = empty();
        x.progress = { tierWaves: { 1: 4000, 2: 4000 }, completedTier: 20 };
        const [first, second] = LABS[0].l;
        x.labData = { [first[0]]: first[1], [second[0]]: second[1] - 1 };
        x.wsData[0].attack = WS_STATS.attack.map(([, max], i) => (i < 2 ? max : 1));
        x.cardData.data = { [CARDS[0][0]]: { s: 7, m: 0, mu: true }, [CARDS[1][0]]: { s: 6, m: 0 } };
        x.uwData.data = { [UWS[0].a]: { own: true, sv: [1, 1, 1], upOwn: true, upLvl: 0 } } as never;
        x.botData = { [BOTS_CONFIG[0].name]: { owned: true, medals: [0, 0, 0, 0] } } as never;
        expect(meter(x, 'labs').done).toBe(1);
        expect(meter(x, 'workshop').done).toBe(2);
        expect(meter(x, 'cards')).toMatchObject({ done: 1, note: '1 mastery' });
        expect(meter(x, 'uws')).toMatchObject({ done: 1, note: `UW+ 1 of ${UWS.length}` });
        expect(meter(x, 'bots')).toMatchObject({ done: 1, total: BOTS_CONFIG.length, note: undefined });
    });
});

describe('what is ticking', () => {
    const lab = (lab: string, doneAt: number | null): LabRunning =>
        ({ lab, labIndex: 0, doneAt, speedUp: 0, speedUpLeftSec: 0, exportedAt: 0 });

    it('finds the next lab to finish and the ones already done', () => {
        const t = labsTicking([lab('Damage Lab', 500), lab('Labs Speed', 200), lab('Range Lab', 50), lab('Game Speed', null)], 100);
        expect(t.running).toBe(4);
        expect(t.next).toEqual({ lab: expect.objectContaining({ lab: 'Labs Speed' }), at: 200 });
        expect(t.finished.map(l => l.lab)).toEqual(['Range Lab']);
        expect(labsTicking([], 100)).toEqual({ running: 0, next: null, finished: [] });
    });

    it('counts a speed-up, like the Labs tab: 1 h left at ×2 for all of it finishes in 30 min', () => {
        const hour = 3600_000;
        const r = { ...lab('Damage Lab', hour), exportedAt: 0, speedUp: 2, speedUpLeftSec: 3600 };
        expect(labsTicking([r], 0).next?.at).toBe(hour / 2);
        expect(labsTicking([r], hour * 0.75).finished).toHaveLength(1);
    });

    it('reads the farthest point: the best wave on the highest tier with one', () => {
        expect(farthestPoint({ 1: 4500, 18: 9704, 19: 0 } as never)).toEqual({ tier: 18, wave: 9704 });
        expect(farthestPoint({} as never)).toBeNull();
    });
});
