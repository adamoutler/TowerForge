// ============================================================
//  TowerForge Companion — Account API
//  Register / sign in / sign out, synced stats, the player's own
//  share codes, and passwords: a recovery code (shown once when it's
//  made) sets a new password when the old one is forgotten.
// ============================================================

import { ApiError, apiRequest } from './http';
import type { ShareClaim } from './shareApi';

const BASE = '/api/account';

// A full TowerForge export (same shape as exportData()).
export type AccountSave = Record<string, unknown>;

export interface AccountShare {
    code: string;
    sections: string[];
    createdAt: string;
    expiresAt: string;
}

// The signed-in account: its username, the preview parts of the site it
// can see (server's features.json), and whether it holds a recovery code.
export interface Me {
    username: string;
    features?: string[];
    recoveryCodeSet?: boolean;
}

// A recovery code, as the server hands it out (the only time it's readable).
export interface NewCode {
    recoveryCode: string;
}

// Returns the signed-in account, or null when not signed in.
export async function getMe(): Promise<Me | null> {
    try {
        return await apiRequest<Me>(`${BASE}/me`);
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
    }
}

export function register(username: string, password: string, save: AccountSave, claims: ShareClaim[]) {
    return apiRequest<Me & NewCode>(`${BASE}/register`, {
        method: 'POST',
        body: JSON.stringify({ username, password, save, claims }),
    }, 'Could not create the account.');
}

export function login(username: string, password: string) {
    return apiRequest<Me & { save: AccountSave | null; updatedAt: string | null }>(`${BASE}/login`, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
    }, 'Could not sign in.');
}

export function logout() {
    return apiRequest<void>(`${BASE}/logout`, { method: 'POST' });
}

// A new password with the account's recovery code: signs in like login,
// and hands out a fresh code (the old one is used up).
export function resetPassword(username: string, recoveryCode: string, newPassword: string) {
    return apiRequest<Me & NewCode & { save: AccountSave | null; updatedAt: string | null }>(`${BASE}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ username, recoveryCode, newPassword }),
    }, 'Could not reset the password.');
}

// Replaces the signed-in account's recovery code.
export function newRecoveryCode() {
    return apiRequest<NewCode>(`${BASE}/recovery-code`, { method: 'POST' }, 'Could not make a recovery code.');
}

// Deletes the signed-in account and everything tied to it (saved stats,
// recovery code, share links, Ask AI answers sent), then signs out.
export function deleteAccount(password: string) {
    return apiRequest<void>(`${BASE}/delete`, {
        method: 'POST',
        body: JSON.stringify({ password }),
    }, 'Could not delete the account.');
}

export function changePassword(currentPassword: string, newPassword: string) {
    return apiRequest<void>(`${BASE}/password`, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
    }, 'Could not change the password.');
}

export function getSave() {
    return apiRequest<{ save: AccountSave | null; updatedAt: string | null }>(`${BASE}/save`);
}

// keepalive lets the final save go out while the page is closing
// (browsers cap keepalive bodies at 64 KB; larger saves retry next visit).
export function putSave(save: AccountSave, keepalive = false) {
    return apiRequest<{ updatedAt: string }>(`${BASE}/save`, {
        method: 'PUT',
        body: JSON.stringify(save),
        keepalive,
    }, 'Could not save to your account.');
}

export function listShares() {
    return apiRequest<AccountShare[]>(`${BASE}/shares`, {}, 'Could not load your share codes.');
}
