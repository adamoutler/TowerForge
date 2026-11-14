// ============================================================
//  TowerForge Companion — Moments kept on this device
//  The moments the player's own imports found (engine/moments.ts),
//  kept in this browser for two weeks so they can be shared later,
//  until the player closes them. Only the player's imports make them:
//  never the example account or a backup restore. Not part of the game
//  data (no tc_ key), so accounts and backups leave them out.
// ============================================================

import { useSyncExternalStore } from 'react';
import { findMoments } from '../engine/moments';
import type { Moment, MomentAccount } from '../engine/moments';
import type { GameImport } from '../engine/gameExport';
import { useGameStore } from './useGameStore';
import { endExampleForImport } from './exampleAccount';
import { trackEvent } from '../analytics';

const KEY = 'tf-moments';
const KEEP_MS = 14 * 86_400_000;
const MAX_KEPT = 12;

type Kept = Moment & { closed?: boolean };

function read(): Kept[] {
    try {
        const raw = localStorage.getItem(KEY);
        const list = raw ? (JSON.parse(raw) as Kept[]) : [];
        return Array.isArray(list) ? list.filter(m => m && typeof m.id === 'string' && Date.now() - m.at < KEEP_MS) : [];
    } catch {
        return [];
    }
}

let kept: Kept[] = read();
let shown: Moment[] = kept.filter(m => !m.closed);
const listeners = new Set<() => void>();

function write(next: Kept[]) {
    kept = next.slice(0, MAX_KEPT);
    shown = kept.filter(m => !m.closed);
    try {
        localStorage.setItem(KEY, JSON.stringify(kept));
    } catch {
        // Shown this visit only.
    }
    listeners.forEach(l => l());
}

// The account as moments read it.
export function momentAccount(): MomentAccount {
    const s = useGameStore.getState();
    return {
        imported: s.incomeLog.length > 0 || s.importedBattles.length > 0,
        highestTier: s.profile.highestTier,
        tierWaves: s.tierWaves,
        league: s.profile.league,
        tourneyRecords: s.tourneyRecords,
        uws: s.uwData.data,
    };
}

// Newest first; a moment found again (same feat) replaces the old one.
export function rememberMoments(found: Moment[]): void {
    if (!found.length) return;
    const ids = new Set(found.map(m => m.id));
    write([...found, ...kept.filter(m => !ids.has(m.id))]);
    for (const m of found) trackEvent('Moment', { step: 'found', kind: m.kind });
}

// The player's own import: ends the example account first, then keeps
// whatever the import did that's worth sharing.
export function importWithMoments(imp: GameImport): void {
    endExampleForImport();
    const before = momentAccount();
    useGameStore.getState().applyGameImport(imp);
    rememberMoments(findMoments(before, momentAccount(), Date.now()));
}

export function closeMoment(id: string): void {
    write(kept.map(m => (m.id === id ? { ...m, closed: true } : m)));
}

export function useMoments(): Moment[] {
    return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => shown, () => shown);
}
