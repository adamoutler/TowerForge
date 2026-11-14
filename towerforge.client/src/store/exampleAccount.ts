// ============================================================
//  TowerForge Companion — Example account
//  "Try it with an example account": fills the site with a made-up
//  player so a visitor sees the Optimizer, What If and the rest working
//  before taking the trouble to import (owner, 2026-11-13: most visitors
//  never import, and a new visitor's pages are empty). The player is the
//  Ask AI test bench's late account (ai/bench/benchAccounts.ts: T18,
//  every UW and UW+, modules, Guardian, Vault, Legend tournaments; every
//  number made up), loaded through the same import as a game export.
//
//  What this browser had before is kept aside and comes back on Leave.
//  The player's own import ends the example (the made-up data goes
//  first), and so does signing in (the account's stats replace it).
//  Making an account is blocked while it's on: a new account uploads
//  what's on the device (useAccountStore).
// ============================================================

import { useSyncExternalStore } from 'react';
import { useGameStore } from './useGameStore';
import { parseGameExport } from '../engine/gameExport';
import { trackEvent } from '../analytics';

const ON_KEY = 'tf-example';
const BACKUP_KEY = 'tf-example-backup';
// Settings and links rather than game data: they stay as the player set them.
const NOT_GAME_DATA = /^tc_(theme|welcome|link_|account_|share_claims|cloud_save)/;
const gameKey = (k: string) => k.startsWith('tc_') && !NOT_GAME_DATA.test(k);

function readOn(): boolean {
    try {
        return localStorage.getItem(ON_KEY) === '1';
    } catch {
        return false;
    }
}

let on = readOn();
const listeners = new Set<() => void>();

function setOn(next: boolean) {
    on = next;
    try {
        if (next) localStorage.setItem(ON_KEY, '1');
        else {
            localStorage.removeItem(ON_KEY);
            localStorage.removeItem(BACKUP_KEY);
        }
    } catch {
        // Private browsing: it lasts until the page closes.
    }
    listeners.forEach(l => l());
}

export const exampleOn = (): boolean => on;

export function useExampleOn(): boolean {
    return useSyncExternalStore(
        l => { listeners.add(l); return () => { listeners.delete(l); }; },
        () => on,
        () => false,
    );
}

export async function tryExample(): Promise<void> {
    if (on) return;
    const { BENCH_ACCOUNTS } = await import('../ai/bench/benchAccounts');
    const account = BENCH_ACCOUNTS.find(a => a.key === 'late')!;
    try {
        const backup: Record<string, string> = {};
        for (const k of Object.keys(localStorage)) if (gameKey(k)) backup[k] = localStorage.getItem(k) ?? '';
        localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
    } catch {
        // Nothing to keep aside, or storage is off.
    }
    const store = useGameStore.getState();
    store.applyGameImport(parseGameExport({ ...account.raw, UserName: 'Example player' }));
    if (account.build) store.updateProfile({ build: account.build });
    trackEvent('Example account', { step: 'try' });
    setOn(true);
}

// Back to what this browser had before; the page reloads to read it.
export function leaveExample(): void {
    try {
        const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) ?? '{}') as Record<string, string>;
        for (const k of Object.keys(localStorage)) if (gameKey(k)) localStorage.removeItem(k);
        for (const [k, v] of Object.entries(backup)) if (gameKey(k)) localStorage.setItem(k, v);
    } catch {
        // Storage is off: the reload starts empty.
    }
    trackEvent('Example account', { step: 'leave' });
    setOn(false);
    window.location.reload();
}

// The player's own data is coming in: clear the made-up player first, so
// nothing of it (a build, a tournament) stays mixed in.
export function endExampleForImport(): void {
    if (!on) return;
    useGameStore.getState().resetAll();
    trackEvent('Example account', { step: 'import' });
    setOn(false);
}

// Signed in: the account's own stats have replaced the example.
export function endExampleQuietly(): void {
    if (on) setOn(false);
}
