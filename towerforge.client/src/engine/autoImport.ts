// ============================================================
//  TowerForge Companion — Auto import (decisions)
//  The game (29.1.3+) can write its data export every time it saves
//  (Settings → External Tools Export → Auto). With Auto import on, the
//  site asks TowerForge Link every 30 seconds while it's open and reads
//  the newest export. The game saves often during a run, so an export is
//  imported:
//   • right away when it has a run the site doesn't have yet (a run
//     ended — new deaths, coins per run, damage by source);
//   • otherwise at most every 10 minutes (currencies, levels), so a
//     signed-in account isn't re-saved after every game save.
//  An export that was skipped is read again once the 10 minutes are up.
//  Pure functions — no store imports.
// ============================================================

export const AUTO_POLL_MS = 30_000;
export const AUTO_REFRESH_MS = 10 * 60_000;

// Remembered per browser (localStorage tc_link_auto).
export interface AutoImportState {
    on: boolean;
    seen: number;        // file time (unix s) of the newest export read
    imported: number;    // file time of the newest export imported
    importedAt: number;  // when that was (ms)
    justConnected?: boolean;
}

export const AUTO_OFF: AutoImportState = { on: false, seen: 0, imported: 0, importedAt: 0 };

export const AUTO_IMPORT_STORAGE_KEY = 'tc_link_auto';
export const AUTO_IMPORT_CHANGE_EVENT = 'tf:auto-import-change';

let memoryAutoImportState: AutoImportState = { ...AUTO_OFF };
const autoImportListeners = new Set<(state: AutoImportState) => void>();

export function loadAutoImportState(): AutoImportState {
    try {
        const storage = globalThis.localStorage;
        if (storage && typeof storage.getItem === 'function') {
            const raw = storage.getItem(AUTO_IMPORT_STORAGE_KEY);
            if (!raw) {
                memoryAutoImportState = { ...AUTO_OFF };
                return { ...AUTO_OFF };
            }
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                memoryAutoImportState = { ...AUTO_OFF, ...parsed };
                return { ...memoryAutoImportState };
            }
            return { ...AUTO_OFF };
        }
    } catch {
        // Fall back to in-memory state when localStorage is unavailable or restricted
    }
    return { ...memoryAutoImportState };
}

export function saveAutoImportState(s: AutoImportState): void {
    const normalized: AutoImportState = {
        ...AUTO_OFF,
        ...s,
        on: Boolean(s.on),
    };
    memoryAutoImportState = normalized;
    try {
        const storage = globalThis.localStorage;
        if (storage && typeof storage.setItem === 'function') {
            storage.setItem(AUTO_IMPORT_STORAGE_KEY, JSON.stringify(normalized));
        }
    } catch {
        // Ignore storage write errors in restricted environments
    }
    for (const listener of autoImportListeners) {
        try {
            listener(normalized);
        } catch {
            // Ignore subscriber errors
        }
    }
    try {
        if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            globalThis.dispatchEvent(new CustomEvent(AUTO_IMPORT_CHANGE_EVENT, { detail: normalized }));
        }
    } catch {
        // Ignore CustomEvent errors in non-DOM test environments
    }
}

export function getAutoImportOn(): boolean {
    return loadAutoImportState().on;
}

export function setAutoImportOn(on: boolean, markJustConnected = true): void {
    const current = loadAutoImportState();
    saveAutoImportState({
        ...current,
        on,
        justConnected: on ? markJustConnected : false,
    });
}

export function subscribeAutoImportState(listener: (state: AutoImportState) => void): () => void {
    autoImportListeners.add(listener);
    return () => {
        autoImportListeners.delete(listener);
    };
}

// The newest run in an export (ms; 0 when it has none).
export function newestRunInExport(raw: Record<string, unknown>): number {
    const runs = Array.isArray(raw.BattleHistory) ? raw.BattleHistory as Record<string, unknown>[] : [];
    return runs.reduce((t, r) => Math.max(t, typeof r?.BattleDate === 'string' ? Date.parse(r.BattleDate) || 0 : 0), 0);
}

// What to ask Link for: only a newer export (its file time), or the
// newest one again when a skipped export is due (undefined).
export function askNewerThan(s: AutoImportState, now: number): number | undefined {
    const pending = s.seen > s.imported;
    const due = now - s.importedAt >= AUTO_REFRESH_MS;
    return pending && due ? undefined : s.seen || undefined;
}

// Whether to import an export just read: the first one, one with a run
// the site doesn't have yet, or once the refresh time is up.
export function shouldImport(s: AutoImportState, fileNewestRun: number, siteNewestRun: number, now: number): boolean {
    return s.imported === 0 || fileNewestRun > siteNewestRun || now - s.importedAt >= AUTO_REFRESH_MS;
}
