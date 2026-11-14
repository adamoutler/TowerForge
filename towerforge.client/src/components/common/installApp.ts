// ============================================================
//  TowerForge Companion — Installing the site as an app
//  With public/manifest.webmanifest a phone can add TowerForge to its
//  home screen with its own icon, one tap back like an app (owner,
//  2026-11-13: 85% of visitors came on one day only). Chrome and Edge
//  offer an install prompt the page can open (beforeinstallprompt,
//  caught here at start so their own mini-bar doesn't pop up); Safari
//  and others install from their menu, so the hint says where.
//  An app opens at /?source=app, so the visit counts show app use.
// ============================================================

import { useSyncExternalStore } from 'react';
import { trackEvent } from '../../analytics';

interface InstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

export function listenForInstall(): void {
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferred = e as InstallPromptEvent;
        notify();
    });
    window.addEventListener('appinstalled', () => {
        deferred = null;
        trackEvent('Install app', { step: 'installed' });
        notify();
    });
}

// Open as the app already (home screen, or installed on a computer).
export const runningAsApp = (): boolean =>
    window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function useCanPromptInstall(): boolean {
    return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => deferred !== null, () => false);
}

export async function promptInstall(): Promise<boolean> {
    if (!deferred) return false;
    const e = deferred;
    deferred = null;
    notify();
    await e.prompt();
    const { outcome } = await e.userChoice;
    trackEvent('Install app', { step: outcome });
    return outcome === 'accepted';
}

const HIDE_KEY = 'tf-install-hint';

export function installHintHidden(): boolean {
    try {
        return localStorage.getItem(HIDE_KEY) === 'hidden';
    } catch {
        return false;
    }
}

export function hideInstallHint(): void {
    try {
        localStorage.setItem(HIDE_KEY, 'hidden');
    } catch {
        // Comes back next visit.
    }
}
