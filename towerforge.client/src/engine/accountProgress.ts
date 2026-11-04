// ============================================================
//  TowerForge Companion — Account progress (the home page)
//  How far each part of the account has got, for the meters on
//  Profile, counted the way each tab counts it: labs maxed of the labs
//  open (the Labs tab's rule, engine/unlocks.ts), workshop stats at
//  their max in the open preset, cards at 7★, Ultimate Weapons and bots
//  owned. Plus what's ticking between imports: the labs being
//  researched at the last import and when the next one finishes, and
//  the player's farthest point (best wave on their highest tier).
// ============================================================

import { CARDS, LABS, UWS, WS_STATS } from '../constants/gameData';
import { BOTS_CONFIG, isBotEntryOwned, isBotPlusOwned } from '../constants/botData';
import { labOpen, type Progress } from './unlocks';
import { labFinishAt } from './labTimer';
import type { BotData, CardData, LabData, LabRunning, TabName, TierWaves, UWData, WSPreset } from '../types/gameTypes';

export interface Meter {
    id: 'labs' | 'workshop' | 'cards' | 'uws' | 'bots';
    label: string;
    done: number;
    total: number;
    note?: string;      // a second count shown under the meter (UW+, Bot+, masteries)
    tab: TabName;
}

export interface MeterInputs {
    labData: LabData;
    wsData: WSPreset[];
    presetIdx: number;
    cardData: CardData;
    uwData: UWData;
    botData: BotData;
    progress: Progress;
}

export function accountMeters(x: MeterInputs): Meter[] {
    const ilmOwned = !!x.uwData.data.ILM?.own;
    const labs = LABS.flatMap(g => g.l).filter(([name]) => labOpen(name, x.labData[name] ?? 0, x.progress, ilmOwned));
    const ws = x.wsData[x.presetIdx];
    const wsStats = Object.entries(WS_STATS).flatMap(([cat, stats]) =>
        stats.map(([, max], i) => (ws?.[cat as keyof WSPreset]?.[i] ?? 0) >= max));
    const cards = CARDS.map(([name]) => x.cardData.data[name]);
    const uws = UWS.map(u => x.uwData.data[u.a]);
    const bots = BOTS_CONFIG.map(b => x.botData[b.name]);
    const count = <T,>(list: T[], test: (v: T) => boolean) => list.filter(test).length;
    const plusOwned = count(uws, u => !!u?.upOwn);
    const botPlus = count(bots, b => isBotPlusOwned(b));
    const masteries = count(cards, c => !!c?.mu);
    return [
        { id: 'labs', label: 'Labs maxed', done: count(labs, ([name, max]) => (x.labData[name] ?? 0) >= max), total: labs.length, tab: 'labs' },
        { id: 'workshop', label: 'Workshop maxed', done: count(wsStats, v => v), total: wsStats.length, tab: 'workshop' },
        {
            id: 'cards', label: 'Cards at 7★', done: count(cards, c => (c?.s ?? 0) >= 7), total: CARDS.length, tab: 'cards',
            note: masteries ? `${masteries} ${masteries === 1 ? 'mastery' : 'masteries'}` : undefined,
        },
        {
            id: 'uws', label: 'Ultimate Weapons', done: count(uws, u => !!u?.own), total: UWS.length, tab: 'uw',
            note: plusOwned ? `UW+ ${plusOwned} of ${UWS.length}` : undefined,
        },
        {
            id: 'bots', label: 'Bots', done: count(bots, b => isBotEntryOwned(b)), total: BOTS_CONFIG.length, tab: 'bots',
            note: botPlus ? `Bot+ ${botPlus} of ${BOTS_CONFIG.length}` : undefined,
        },
    ];
}

// The labs researching at the last import: the next to finish after `now`,
// and the ones whose time has already passed (done in the game, not in the
// site until the next import). Finish times count the speed-up, as the Labs
// tab does (engine/labTimer.ts).
export interface LabsTicking {
    running: number;
    next: { lab: LabRunning; at: number } | null;
    finished: LabRunning[];
}

export function labsTicking(labs: LabRunning[], now: number): LabsTicking {
    const timed = labs.flatMap(lab => {
        const at = labFinishAt(lab);
        return at === null ? [] : [{ lab, at }];
    });
    const finished = timed.filter(t => t.at <= now).map(t => t.lab);
    const next = timed.filter(t => t.at > now).sort((a, b) => a.at - b.at)[0] ?? null;
    return { running: labs.length, next, finished };
}

// The player's farthest point: the best wave on the highest tier that has
// one (a newly opened tier may have no wave yet).
export function farthestPoint(tierWaves: TierWaves): { tier: number; wave: number } | null {
    const tiers = Object.entries(tierWaves)
        .map(([t, w]) => ({ tier: Number(t), wave: w ?? 0 }))
        .filter(p => p.wave > 0)
        .sort((a, b) => b.tier - a.tier);
    return tiers[0] ?? null;
}
