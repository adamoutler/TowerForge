// ============================================================
//  TowerForge Companion — What's new
//  A few lines in players' words for each release worth telling
//  returning visitors about, newest first (CHANGELOG.md has the whole
//  story). Profile shows the ones a visitor hasn't seen once, until
//  closed; the footer's "What's new" lists them all. A first visit
//  starts as seen, so new players aren't told about changes to a site
//  they haven't used. Add an entry for the version the deploy makes
//  (deploy.ps1 bumps the middle number for features).
// ============================================================

import type { TabName } from './types/gameTypes';

export interface WhatsNewEntry {
    version: string;
    date: string;      // YYYY-MM-DD
    items: { text: string; tab?: TabName; link?: string }[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
    {
        version: '2.12.0',
        date: '2026-11-14',
        items: [
            { text: 'Moments: a new tier, best wave, promotion or best tournament finish shows up after an import, with a picture to share.' },
            { text: 'Remind me: a notification when a lab finishes or a tournament starts.' },
            { text: 'Add TowerForge to your home screen to open it like an app.' },
            { text: 'Share links show your tier, best wave and league in Discord and Reddit.', tab: 'share', link: 'Share' },
            { text: 'Easier importing, an example account to look around, and Link imports by itself.', tab: 'importguide', link: 'Import Guide' },
        ],
    },
];

const SEEN_KEY = 'tf-seen-version';

const parts = (v: string) => v.split('.').map(n => Number(n) || 0);
export function compareVersions(a: string, b: string): number {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
}

// What a visitor who last saw `seen` hasn't been told, newest first (two releases at most).
export function unseen(entries: WhatsNewEntry[], seen: string | null, current: string): WhatsNewEntry[] {
    return entries
        .filter(e => compareVersions(e.version, current) <= 0 && (seen === null || compareVersions(e.version, seen) > 0))
        .sort((a, b) => compareVersions(b.version, a.version))
        .slice(0, seen === null ? 1 : 2);
}

export function seenVersion(): string | null {
    try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

export function markSeen(version = __APP_VERSION__): void {
    try { localStorage.setItem(SEEN_KEY, version); } catch { /* told again next visit */ }
}

// At startup: a browser with no TowerForge data yet is a first visit.
export function noteFirstVisit(): void {
    try {
        if (localStorage.getItem(SEEN_KEY) === null && localStorage.getItem('tc_profile') === null && localStorage.getItem('tc_tiers') === null) markSeen();
    } catch {
        // Storage off: nothing is shown either.
    }
}
