// ============================================================
//  TowerForge Companion — Account Store
//  Sign-in state plus syncing the player's stats to their account.
//
//  Rules:
//   • Creating an account uploads everything already on this device.
//   • Signing in to an existing account loads the account's stats onto
//     this device (local stats are never pushed into an existing
//     account — except unsynced edits made while signed in to it).
//   • While signed in, every change is saved to the account.
//   • Signing out removes the stats from this device.
//   • A recovery code the server just made (new account, password reset,
//     or "make a new one") is kept here until the player says it's saved —
//     it can't be shown again.
// ============================================================

import { create } from 'zustand';
import { useGameStore } from './useGameStore';
import * as accountApi from '../engine/accountApi';
import type { AccountSave } from '../engine/accountApi';
import { ApiError } from '../engine/http';
import { clearShareClaims, getShareClaims } from '../engine/shareApi';

// Store slices that make up a player's saved stats (mirrors exportData()).
const SYNCED_SLICES = [
    'profile', 'perkData', 'tierWaves', 'wsData', 'enhData', 'labData', 'labProgress', 'dissonanceWaves', 'career', 'incomeLog', 'liveRun',
    'cardData', 'uwData', 'relicData', 'botData', 'botLoadouts', 'moduleState', 'battleReportText',
    'currencies', 'importedBattles', 'battleReportChoice', 'guardianData', 'tourneyLog', 'tourneyRecords', 'vaultLevels',
] as const;

const LINKED_USER_KEY = 'tc_account_user';   // account this device's stats belong to
const DIRTY_KEY = 'tc_account_dirty';        // local edits not yet saved to the account
const PUSH_DELAY_MS = 2000;

type Status = 'loading' | 'signedOut' | 'signedIn';
type SyncState = 'idle' | 'saving' | 'saved' | 'error';

interface AccountStore {
    status: Status;
    username: string | null;
    features: string[];             // preview parts of the site this account can see (e.g. "ai")
    syncState: SyncState;
    lastSyncedAt: number | null;
    notice: string | null;          // e.g. "session expired" shown on the Account tab
    sharesVersion: number;          // bump to make share lists refetch
    hasRecoveryCode: boolean;       // the account holds a recovery code
    recoveryCode: string | null;    // one just made, shown until the player has saved it

    init: () => Promise<void>;
    register: (username: string, password: string) => Promise<void>;
    login: (username: string, password: string) => Promise<void>;
    resetPassword: (username: string, recoveryCode: string, newPassword: string) => Promise<void>;
    newRecoveryCode: () => Promise<void>;
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    recoveryCodeSaved: () => void;
    logout: () => Promise<void>;
    sharesChanged: () => void;
}

// ── Local flags ───────────────────────────────────────────────
function readKey(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}
function writeKey(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch { /* storage unavailable */ }
}
const isDirty = () => readKey(DIRTY_KEY) === '1';
const sameUser = (a: string | null, b: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ── Sync engine ───────────────────────────────────────────────
let unsubscribe: (() => void) | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let applyingRemote = false;
let changeSeq = 0;

function currentSave(): AccountSave {
    return JSON.parse(useGameStore.getState().exportData());
}

// Replace this device's stats with the account's. resetAll first so keys
// missing from an older save don't keep stale local values.
function applyRemoteSave(save: AccountSave): void {
    applyingRemote = true;
    try {
        const game = useGameStore.getState();
        game.resetAll();
        game.importData(JSON.stringify(save));
    } finally {
        applyingRemote = false;
    }
    writeKey(DIRTY_KEY, null);
}

async function push(keepalive = false): Promise<void> {
    if (!isDirty()) return;
    const seq = changeSeq;
    useAccountStore.setState({ syncState: 'saving' });
    try {
        await accountApi.putSave(currentSave(), keepalive);
        // Only clear the flag if nothing changed while the request was in flight.
        if (seq === changeSeq) writeKey(DIRTY_KEY, null);
        useAccountStore.setState({ syncState: 'saved', lastSyncedAt: Date.now() });
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            // Session ended. Keep the local edits (still flagged dirty) so
            // signing back in to the same account uploads them.
            stopSync();
            useAccountStore.setState({
                status: 'signedOut', username: null, features: [], syncState: 'idle',
                notice: 'Your session expired. Sign in again to keep saving to your account.',
            });
            return;
        }
        useAccountStore.setState({ syncState: 'error' });
    }
}

function schedulePush(): void {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { void push(); }, PUSH_DELAY_MS);
}

function flushOnHide(): void {
    if (document.visibilityState === 'hidden' && isDirty()) {
        clearTimeout(pushTimer);
        void push(true);
    }
}

function startSync(): void {
    stopSync();
    unsubscribe = useGameStore.subscribe((state, prev) => {
        if (applyingRemote) return;
        if (!SYNCED_SLICES.some(key => state[key] !== prev[key])) return;
        changeSeq++;
        writeKey(DIRTY_KEY, '1');
        schedulePush();
    });
    document.addEventListener('visibilitychange', flushOnHide);
}

function stopSync(): void {
    unsubscribe?.();
    unsubscribe = null;
    clearTimeout(pushTimer);
    document.removeEventListener('visibilitychange', flushOnHide);
}

function signedIn(username: string, features?: string[]): void {
    writeKey(LINKED_USER_KEY, username);
    useAccountStore.setState({ status: 'signedIn', username, notice: null, ...(features ? { features } : {}) });
    startSync();
}

// After signing in (password or recovery code): the account's stats onto
// this device — unless this device holds unsaved edits for that same
// account from an expired session, which then finish uploading.
async function loadSignedIn(res: accountApi.Me & { save: AccountSave | null }): Promise<void> {
    if (sameUser(readKey(LINKED_USER_KEY), res.username) && isDirty()) {
        signedIn(res.username, res.features ?? []);
        await push();
        return;
    }
    if (res.save) applyRemoteSave(res.save);
    else writeKey(DIRTY_KEY, '1');
    useAccountStore.setState({ syncState: 'saved', lastSyncedAt: Date.now() });
    signedIn(res.username, res.features ?? []);
    await push();
}

// ── Store ─────────────────────────────────────────────────────
export const useAccountStore = create<AccountStore>((set) => ({
    status: 'loading',
    username: null,
    features: [],
    syncState: 'idle',
    lastSyncedAt: null,
    notice: null,
    sharesVersion: 0,
    hasRecoveryCode: false,
    recoveryCode: null,

    // Runs once on app load, after the local stats are loaded.
    init: async () => {
        const linked = readKey(LINKED_USER_KEY);
        let me: accountApi.Me | null;
        try {
            me = await accountApi.getMe();
        } catch {
            // Offline: keep tracking edits for the linked account so they upload later.
            if (linked) signedIn(linked);
            else set({ status: 'signedOut' });
            return;
        }

        if (!me) {
            set({
                status: 'signedOut',
                notice: linked ? 'Your session expired. Sign in again to keep saving to your account.' : null,
            });
            return;
        }

        try {
            if (sameUser(linked, me.username) && isDirty()) {
                await push();                       // unsynced edits from this device win
            } else {
                const { save } = await accountApi.getSave();
                if (save) applyRemoteSave(save);
                else writeKey(DIRTY_KEY, '1');      // account has no stats yet — upload ours
            }
        } catch {
            set({ syncState: 'error' });
        }
        set({ hasRecoveryCode: !!me.recoveryCodeSet });
        signedIn(me.username, me.features ?? []);
        await push();
    },

    // Creating an account moves everything on this device into it,
    // including share codes made here before signing up.
    register: async (username, password) => {
        const res = await accountApi.register(username, password, currentSave(), getShareClaims());
        clearShareClaims();
        writeKey(DIRTY_KEY, null);
        set({ syncState: 'saved', lastSyncedAt: Date.now(), hasRecoveryCode: true, recoveryCode: res.recoveryCode ?? null });
        signedIn(res.username, res.features ?? []);
    },

    // Signing in loads the account's stats onto this device.
    login: async (username, password) => {
        const res = await accountApi.login(username, password);
        set({ hasRecoveryCode: !!res.recoveryCodeSet });
        await loadSignedIn(res);
    },

    // A forgotten password: the recovery code sets a new one and signs in
    // like login; the server hands out a fresh code to keep.
    resetPassword: async (username, recoveryCode, newPassword) => {
        const res = await accountApi.resetPassword(username, recoveryCode, newPassword);
        set({ hasRecoveryCode: true, recoveryCode: res.recoveryCode });
        await loadSignedIn(res);
    },

    newRecoveryCode: async () => {
        const res = await accountApi.newRecoveryCode();
        set({ hasRecoveryCode: true, recoveryCode: res.recoveryCode });
    },

    changePassword: async (currentPassword, newPassword) => {
        await accountApi.changePassword(currentPassword, newPassword);
    },

    recoveryCodeSaved: () => set({ recoveryCode: null }),

    // Saves any pending edits, ends the session, and clears this device.
    // Refuses (throws) if the latest edits couldn't be saved, so nothing is lost.
    logout: async () => {
        clearTimeout(pushTimer);
        await push();
        if (isDirty()) {
            throw new Error('Could not save your latest changes to your account. Check your connection and try again.');
        }
        stopSync();
        try { await accountApi.logout(); } catch { /* cookie expires on its own */ }
        applyingRemote = true;
        try { useGameStore.getState().resetAll(); } finally { applyingRemote = false; }
        writeKey(LINKED_USER_KEY, null);
        writeKey(DIRTY_KEY, null);
        set({
            status: 'signedOut', username: null, features: [], syncState: 'idle', lastSyncedAt: null, notice: null,
            hasRecoveryCode: false, recoveryCode: null,
        });
    },

    sharesChanged: () => set(s => ({ sharesVersion: s.sharesVersion + 1 })),
}));
