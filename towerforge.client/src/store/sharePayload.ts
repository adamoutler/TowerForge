// ============================================================
//  TowerForge Companion — The player's stats in a share's shape
//  What a share link holds (engine/shareApi SharePayload), built from
//  this browser's data: the Share tab uploads the sections the player
//  picks, and Compare with my tower on a share link reads all of them
//  without sending anything (engine/compare.ts). Never the player's
//  name.
// ============================================================

import type { SharePayload, ShareSectionKey } from '../engine/shareApi';
import { SHARE_SECTIONS } from '../engine/shareApi';
import { activeLoadout } from '../engine/statHelpers';
import { useGameStore } from './useGameStore';

type State = ReturnType<typeof useGameStore.getState>;

export function sharePayloadFrom(s: State, sections: readonly ShareSectionKey[] = SHARE_SECTIONS): SharePayload {
    const want = new Set(sections);
    const presetCount = s.profile.presets || 2;
    const presetNames = s.profile.presetNames;
    const hasVault = Object.values(s.vaultLevels ?? {}).some(v => v > 0);
    const p: SharePayload = {};
    if (want.has('profile')) {
        p.profile = {
            build: s.profile.build, league: s.profile.league, currentLeague: s.profile.currentLeague,
            highestTier: s.profile.highestTier, completedTier: s.profile.completedTier, tierWaves: s.tierWaves,
        };
    }
    if (want.has('uw')) p.uw = s.uwData;
    if (want.has('cards')) p.cards = { ...s.cardData, presetCount, presetNames };
    if (want.has('bots')) p.bots = { current: s.botData, loadouts: s.botLoadouts, presetCount, presetNames };
    if (want.has('modules')) {
        p.modules = {
            loadouts: s.moduleState.loadouts,
            library: s.moduleState.library,
            slotLevels: s.moduleState.slotLevels,
            activeLoadout: activeLoadout(s.moduleState)?.id,
            assistData: s.moduleState.assistData,
        };
    }
    if (want.has('workshop')) p.workshop = { presets: s.wsData.slice(0, presetCount), enh: s.enhData, presetCount, presetNames };
    if (want.has('labs')) p.labs = { levels: s.labData };
    if (want.has('relics')) p.relics = { totals: s.relicData };
    if (want.has('guardian') && s.guardianData?.unlocked) p.guardian = { guardian: s.guardianData, presetCount, presetNames };
    if (want.has('vault') && hasVault) p.vault = { levels: s.vaultLevels };
    return p;
}

// This browser has an account of its own to compare (an import or typed-in stats).
export const hasOwnAccount = (s: State): boolean =>
    s.profile.highestTier > 0 || s.importedBattles.length > 0 || Object.values(s.labData).some(v => v > 0);

// A share link opened with no account here: kept, so Profile can offer it
// back once the player's own data is in (SharedView, ProfileHome).
export const COMPARE_KEY = 'tf-compare-code';

export function compareCodeWaiting(): string | null {
    try {
        const code = localStorage.getItem(COMPARE_KEY);
        return code && /^[A-Z2-9]{8}$/.test(code) ? code : null;
    } catch {
        return null;
    }
}
