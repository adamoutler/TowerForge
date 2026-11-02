// ============================================================
//  TowerForge Companion — What's unlocked yet
//  A newer account can't buy everything the site knows: workshop stats
//  open in groups bought with coins (constants/gameData
//  WS_UNLOCK_GROUPS), the Labs at Tier 1, wave 30, many labs at a later
//  milestone — a wave reached on a tier (the LABS table) — and workshop
//  enhancements with the Workshop Enhancement lab (itself Tier 12, wave
//  60). The Optimizer and its skip panel only offer what's open.
//  Not known (an account typed in by hand: no tier waves or completed
//  tiers, no workshop groups) counts as open, so nothing is hidden for
//  lack of data; anything that already has levels is open.
// ============================================================

import { LABS, UWS, UW_UNLOCK_COSTS, WS_UNLOCK_GROUPS } from '../constants/gameData';
import { BOT_UNLOCK_MEDALS, BOTS_CONFIG, isBotEntryOwned } from '../constants/botData';
import { milestoneReached } from './statHelpers';
import type { BotData, CardData, EnhData, GuardianData, LabData, ModuleState, TierWaves, UWData, WsUnlocked } from '../types/gameTypes';

export type WsSection = 'attack' | 'defense' | 'utility';

// How far the player has got: the best wave on each tier, the tiers beaten.
export interface Progress {
    tierWaves: TierWaves;
    completedTier: number;
}

// A workshop stat: open when its group is bought (group 0 is free).
export function workshopOpen(section: WsSection, stat: string, level: number, unlocked: WsUnlocked | undefined): boolean {
    if (!unlocked || level > 0) return true;
    const group = WS_UNLOCK_GROUPS[section].findIndex(g => g.stats.includes(stat));
    return group <= unlocked[section];   // -1 (in no group) is open
}

const progressKnown = (p: Progress | undefined): p is Progress =>
    !!p && (p.completedTier > 0 || Object.values(p.tierWaves).some(v => v > 0));

// A milestone (that wave on that tier) reached, or not known.
export const reached = (p: Progress | undefined, tier: number, wave: number): boolean =>
    !progressKnown(p) || milestoneReached(tier, wave, p.completedTier, p.tierWaves);

// The Labs open at Tier 1, wave 30 (the game's milestones).
export const labsOpen = (p: Progress | undefined): boolean => reached(p, 1, 30);

const LAB_AT = new Map(LABS.flatMap(g => g.l).map(([name, , tier, wave]) => [name, [tier, wave] as const]));

// One lab: the Labs open and its own milestone reached. Inner Land Mine's
// Chrono Jump also needs Inner Land Mine (TheTowerSDK's lab unlocks).
export function labOpen(name: string, level: number, p: Progress | undefined, ilmOwned = true): boolean {
    if (level > 0) return true;
    if (!labsOpen(p)) return false;
    if (name === 'ILM-Chrono Jump' && !ilmOwned) return false;
    const at = LAB_AT.get(name);
    return !at || reached(p, at[0], at[1]);
}

// Workshop enhancements need the Workshop Enhancement lab.
export function enhancementsOpen(labs: LabData, enh: EnhData | undefined): boolean {
    return (labs['Workshop Enhancement'] ?? 0) > 0
        || Object.values(enh?.d ?? {}).some(levels => levels.some(v => v > 0));
}

// Card Mastery opens at Tier 16, wave 100 (TheTowerSDK's milestone tracks and
// the wiki's Cards page agree, 2026-11-02); a mastery already bought means
// it's open. The wiki also wants 30 cards at 7★, which nothing else confirms,
// so it isn't checked.
export const CARD_MASTERY_AT = [16, 100] as const;
export function cardMasteryOpen(cards: CardData | undefined, p: Progress | undefined): boolean {
    return Object.values(cards?.data ?? {}).some(c => c?.mu) || reached(p, ...CARD_MASTERY_AT);
}

const SECTION_LABEL: Record<WsSection, string> = { attack: 'Attack', defense: 'Defense', utility: 'Utility' };

export type LockedNotes = Partial<Record<'workshop' | 'labs' | 'enhancements' | 'stones' | 'modules' | 'bots' | 'guardian', string>>;

// What the Optimizer leaves out for now, in a line per panel — and why a
// newer account's panel is empty (no UWs, modules, bots or Guardian yet).
// A price against what's held: "you hold 160, enough for it".
function priceText(cost: number, held: number | undefined, unit: string): string {
    if (held === undefined) return `${cost.toLocaleString()} ${unit}`;
    return `${cost.toLocaleString()} ${unit} (you hold ${held.toLocaleString()}, ${held >= cost ? 'enough for it' : `${(cost - held).toLocaleString()} short`})`;
}

// `held`: the stones and medals the player holds, to say whether the next
// UW or bot is in reach. A new UW or bot isn't ranked: the models measure
// what each adds from the player's runs (its damage share, its kills), so
// one never run with scores nothing (or, for Spotlight, which multiplies
// what's measured, far too much) — tried on made-up accounts 2026-10-28.
export function lockedNotes(s: {
    progress?: Progress; wsUnlocked?: WsUnlocked; labData: LabData; enhData?: EnhData;
    uwData?: UWData; moduleState?: ModuleState; botData?: BotData; guardian?: GuardianData; cardData?: CardData;
}, held: { stones?: number; medals?: number } = {}): LockedNotes {
    const notes: LockedNotes = {};
    if (s.uwData) {
        const owned = UWS.filter(u => s.uwData!.data[u.a]?.own).length;
        const next = UW_UNLOCK_COSTS[owned];
        if (owned === 0) {
            notes.stones = `No Ultimate Weapons yet — your first costs ${priceText(next, held.stones, 'stones')}; the stone ranking starts with it.`;
        } else if (next !== undefined) {
            notes.stones = `Unlocking your next Ultimate Weapon isn’t ranked here: TowerForge measures what a UW adds from your runs, so it can only rank one you’ve run with. The next costs ${priceText(next, held.stones, 'stones')}.`;
        }
    }
    if (s.cardData && !cardMasteryOpen(s.cardData, s.progress)) {
        const [tier, wave] = CARD_MASTERY_AT;
        notes.stones = [notes.stones, `Card masteries open at Tier ${tier}, wave ${wave}, so none are listed yet.`].filter(Boolean).join(' ');
    }
    if (s.moduleState && s.moduleState.library.length === 0) {
        notes.modules = reached(s.progress, 2, 90) ? 'No modules yet.' : 'Modules open at Tier 2, wave 90.';
    }
    if (s.botData) {
        const owned = BOTS_CONFIG.filter(b => isBotEntryOwned(s.botData![b.name])).length;
        const next = BOT_UNLOCK_MEDALS[owned];
        if (owned === 0) {
            notes.bots = `No bots unlocked yet — they’re bought with medals in the game’s Event Shop; your first costs ${priceText(next, held.medals, 'medals')}.`;
        } else if (next !== undefined) {
            notes.bots = `Buying another bot isn’t ranked here: TowerForge measures what a bot adds from your runs, so it can only rank one you’ve run with. The next costs ${priceText(next, held.medals, 'medals')}.`;
        }
    }
    if (s.guardian && !s.guardian.unlocked) {
        notes.guardian = 'The Guardian isn’t unlocked yet (the game’s Guild → Guardian).';
    }
    if (s.wsUnlocked) {
        const next = (['attack', 'defense', 'utility'] as const)
            .flatMap(sec => {
                const g = WS_UNLOCK_GROUPS[sec][s.wsUnlocked![sec] + 1];
                return g ? [`${g.label} (${SECTION_LABEL[sec]})`] : [];
            });
        if (next.length) {
            notes.workshop = `Not unlocked in your workshop yet, so not listed: ${next.join(', ')} and what comes after. `
                + 'Unlock them in the game’s workshop and import again.';
        }
    }
    if (!labsOpen(s.progress)) notes.labs = 'The Labs open at Tier 1, wave 30.';
    else if (LABS.some(g => g.l.some(([name]) => !labOpen(name, s.labData[name] ?? 0, s.progress)))) {
        notes.labs = 'Labs whose milestone you haven’t reached are left out — the Labs tab shows when each opens.';
    }
    if (!enhancementsOpen(s.labData, s.enhData)) {
        notes.enhancements = 'Workshop Enhancements open with the Workshop Enhancement lab (Tier 12, wave 60).';
    }
    return notes;
}
