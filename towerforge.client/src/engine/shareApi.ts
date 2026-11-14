// ============================================================
//  TowerForge Companion — Share API
//  Creates and loads read-only share snapshots on the server.
//  Snapshots are copies: creating or opening one never writes
//  to anyone else's saved data.
// ============================================================

import type {
    AssistData, BotData, BotLoadouts, CardData, EnhData, GuardianData, LabData, Loadout, ModuleEntry, RelicData, SlotLevels,
    TierWaves, UWData, WSPreset,
} from '../types/gameTypes';
import { apiRequest } from './http';

// Keep in sync with SharesController.MaxPayloadBytes on the server.
export const MAX_SHARE_BYTES = 512 * 1024;

const API_BASE = '/api/shares';

// Bots: medal levels plus which bots are active in each preset, so viewers
// can flip through the sender's presets the same way the Bots tab does.
// presetNames: the sender's preset names (shares from 2026-10-20 on).
export interface SharedBots {
    current: BotData;
    loadouts?: BotLoadouts;
    presetCount?: number;
    presetNames?: string[];
}

// Modules: loadouts are the module "presets"; the library is included so
// viewers can resolve the module IDs stored in each loadout slot.
// activeLoadout: the equipped preset (shares from 2026-10-20 on).
export interface SharedModules {
    loadouts: Loadout[];
    library: ModuleEntry[];
    slotLevels: SlotLevels;
    activeLoadout?: string;
    assistData?: AssistData;    // each type's assist tier and efficiencies (shares from 1.25+)
}

// Cards: the library plus each preset's card loadout (CardData.presets and
// slots); the preset count and names so viewers can flip through them
// (shares from 2026-10-24 on).
export interface SharedCards extends CardData {
    presetCount?: number;
    presetNames?: string[];
}

// Shares from 2026-10-24 on can also hold these. Never the player's name.
export interface SharedProfile {
    build: string;
    league: string;
    currentLeague?: string;
    highestTier: number;
    completedTier: number;
    tierWaves: TierWaves;
}

// Workshop levels and enhancements, per preset like in game.
export interface SharedWorkshop {
    presets: WSPreset[];
    enh: EnhData;
    presetCount: number;
    presetNames?: string[];
}

export interface SharedLabs {
    levels: LabData;
}

export interface SharedRelics {
    totals: RelicData;      // each bonus's total (the Relics tab)
}

export interface SharedGuardian {
    guardian: GuardianData;
    presetCount: number;
    presetNames?: string[];
}

export interface SharedVault {
    levels: Record<string, number>;   // by vault id, plus g<group> for unlocked sections
}

export interface SharePayload {
    profile?: SharedProfile;
    uw?: UWData;
    cards?: SharedCards;
    bots?: SharedBots;
    modules?: SharedModules;
    workshop?: SharedWorkshop;
    labs?: SharedLabs;
    relics?: SharedRelics;
    guardian?: SharedGuardian;
    vault?: SharedVault;
}

// Payload keys in the order the viewer shows them (the server keeps the
// same list, ShareStore.KnownSections).
export const SHARE_SECTIONS = ['profile', 'uw', 'cards', 'bots', 'modules', 'workshop', 'labs', 'relics', 'guardian', 'vault'] as const;
export type ShareSectionKey = typeof SHARE_SECTIONS[number];

// Anonymous shares come back with a claim token. We keep them on this
// device so they can be attached to an account when the player signs up.
const CLAIMS_KEY = 'tc_share_claims';

export interface ShareClaim {
    code: string;
    token: string;
}

export function getShareClaims(): ShareClaim[] {
    try {
        const raw = localStorage.getItem(CLAIMS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function clearShareClaims(): void {
    try { localStorage.removeItem(CLAIMS_KEY); } catch { /* storage unavailable */ }
}

function rememberShareClaim(claim: ShareClaim): void {
    try {
        localStorage.setItem(CLAIMS_KEY, JSON.stringify([...getShareClaims(), claim]));
    } catch { /* storage unavailable — the share still works, it just can't be claimed */ }
}

// Uploads a snapshot and returns its short code. Signed-in players own the
// share automatically; anonymous ones get a claim token stored locally.
export async function createShare(payload: SharePayload): Promise<string> {
    const body = JSON.stringify(payload);
    if (new Blob([body]).size > MAX_SHARE_BYTES) {
        throw new Error('This share is too large to upload.');
    }

    const json = await apiRequest<{ code: string; claimToken?: string }>(API_BASE, {
        method: 'POST',
        body,
    }, 'Could not create the share link.');

    if (json.claimToken) rememberShareClaim({ code: json.code, token: json.claimToken });
    return json.code;
}

// Loads a snapshot by code. Throws with a user-facing message on failure.
export function fetchShare(code: string): Promise<SharePayload> {
    return apiRequest<SharePayload>(
        `${API_BASE}/${encodeURIComponent(code.trim().toUpperCase())}`, {}, 'Share not found.');
}

// Deletes one of the signed-in player's shares before it expires.
export function deleteShare(code: string): Promise<void> {
    return apiRequest<void>(`${API_BASE}/${encodeURIComponent(code)}`, { method: 'DELETE' },
        'Could not delete the share.');
}

// towerforge.net/s/CODE: the server fills in the link's preview with the
// shared tier and best wave (SharePagesController). Older ?share=CODE
// links still open (shareCodeFrom).
export function shareUrl(code: string): string {
    return `${window.location.origin}/s/${code}`;
}

// The share a page address opens: /s/CODE, or ?share=CODE.
export function shareCodeFrom(pathname: string, search: string): string | null {
    const m = /^\/s\/([A-Za-z0-9]{4,12})\/?$/.exec(pathname);
    return m ? m[1].toUpperCase() : new URLSearchParams(search).get('share');
}
