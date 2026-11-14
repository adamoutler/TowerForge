// ============================================================
//  TowerForge Companion — Auto import (header toggle)
//  Keeps the site up to date with the game's Auto export through
//  TowerForge Link while the page is open (engine/autoImport.ts for
//  when; engine/linkClient.ts for Link). Off until the player turns it
//  on; remembered per browser. Quiet: a short note when it imports, no
//  pop-ups. Checks again the moment the page comes back into view, so on
//  a phone (TowerForge Link for Android) switching from the game to the
//  browser brings the newest export in. Waits for the account to load first, so a signed-in
//  account's saved stats don't land on top of a fresh import.
// ============================================================

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../store/useGameStore';
import { useAccountStore } from '../../store/useAccountStore';
import { isGameExport } from '../../engine/gameExport';
import {
    exportAge,
    linkExport,
    rememberedSource,
    rememberSource,
    type LinkResult,
} from '../../engine/linkClient';
import { hasActiveWebUsbSession, pollWebUsbAutoExport } from '../../engine/usbLink';
import {
    askNewerThan,
    AUTO_OFF,
    AUTO_POLL_MS,
    getAutoImportOn,
    loadAutoImportState,
    newestRunInExport,
    saveAutoImportState,
    setAutoImportOn,
    shouldImport,
    subscribeAutoImportState,
} from '../../engine/autoImport';
import type { AutoImportState } from '../../engine/autoImport';
import { trackEvent } from '../../analytics';
import { AUTO_OFFER_EVENT } from '../../importNav';

export {
    getAutoImportOn,
    loadAutoImportState,
    saveAutoImportState,
    setAutoImportOn,
    subscribeAutoImportState,
};

// Auto imports are counted once a visit (one every 10 minutes would swamp the counts).
let countedThisVisit = false;

interface AutoImportUiSnapshot {
    on: boolean;
    status: string;
    note: string | null;
}

let uiStatus = '';
let uiNote: string | null = null;
const uiListeners = new Set<() => void>();

function notifyUiListeners(): void {
    for (const listener of uiListeners) {
        listener();
    }
}

subscribeAutoImportState((nextState) => {
    if (!nextState.on && uiStatus.startsWith('Up to date')) {
        uiStatus = 'Disconnected — Auto import turned off.';
    }
    notifyUiListeners();
});

function setStatus(nextStatus: string): void {
    uiStatus = nextStatus;
    notifyUiListeners();
}

function setNote(nextNote: string | null): void {
    uiNote = nextNote;
    notifyUiListeners();
}

function subscribeUi(listener: () => void): () => void {
    uiListeners.add(listener);
    return () => {
        uiListeners.delete(listener);
    };
}

function getUiSnapshot(): AutoImportUiSnapshot {
    return {
        on: loadAutoImportState().on,
        status: uiStatus,
        note: uiNote,
    };
}

export function resetAutoImportUiForTests(): void {
    uiStatus = '';
    uiNote = null;
    saveAutoImportState(AUTO_OFF);
}

interface Props {
    // Imports a game export (no message: the toggle shows its own note).
    onImport: (raw: Record<string, unknown>) => void;
    // TowerForge Link isn't running: show its setup dialog.
    onNeedsLink: () => void;
}

export async function runAutoImportCheckOnce(
    callbacks: Props,
    options: { firstTry?: boolean; isStopped?: () => boolean } = {},
): Promise<LinkResult | null> {
    if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') {
        return null;
    }
    const s = loadAutoImportState();
    const now = Date.now();
    const newerThan = askNewerThan(s, now);
    const source = rememberedSource();
    const preferWebUsb = hasActiveWebUsbSession() || (source?.startsWith('webusb:') ?? false);
    let r: LinkResult;
    if (preferWebUsb) {
        r = await pollWebUsbAutoExport(newerThan);
        if (!r.ok && r.reason === 'unreachable') {
            const fallbackSource = source?.startsWith('webusb:') ? null : source;
            const linkRes = await linkExport(newerThan, fallbackSource);
            if (linkRes.ok || linkRes.reason !== 'unreachable') {
                r = linkRes;
            }
        }
    } else {
        // From the emulator or phone picked last (with more than one), else the newest.
        r = await linkExport(newerThan, source);
        if (!r.ok && r.reason === 'unreachable') {
            const usbRes = await pollWebUsbAutoExport(newerThan);
            if (usbRes.ok || usbRes.reason !== 'unreachable') {
                r = usbRes;
            }
        }
    }
    if (options.isStopped?.()) return r;
    if (r.ok) {
        let raw: unknown = null;
        try { raw = JSON.parse(r.text); } catch { /* reported below */ }
        if (!isGameExport(raw)) {
            setStatus('The export file didn’t read as game data.');
        } else {
            if (r.sourceId) rememberSource(r.sourceId);
            const file = r.modified ?? Math.floor(now / 1000);
            const siteRun = useGameStore.getState().importedBattles.reduce((t, b) => Math.max(t, b.time ?? 0), 0);
            const next: AutoImportState = { ...s, on: true, seen: file };
            if (shouldImport(s, newestRunInExport(raw), siteRun, now)) {
                callbacks.onImport(raw);
                if (!countedThisVisit) {
                    countedThisVisit = true;
                    trackEvent('Import game data (auto)');
                }
                next.imported = file;
                next.importedAt = now;
                setNote(`✓ Auto import: your game data from ${r.source}, exported ${exportAge(file, now)}`);
            }
            saveAutoImportState(next);
            setStatus(`Up to date with ${r.source}.`);
        }
    } else if (r.reason === 'unchanged') {
        setStatus('Up to date — waiting for the game’s next export.');
    } else if (r.reason === 'unreachable') {
        setAutoImportOn(false);
        setStatus('Disconnected — Auto import turned off.');
        if (options.firstTry) callbacks.onNeedsLink();
    } else {
        setStatus(r.message);
    }
    return r;
}

export default function AutoImport({ onImport, onNeedsLink }: Props) {
    const on = useSyncExternalStore(
        subscribeUi,
        () => getUiSnapshot().on,
        () => getUiSnapshot().on,
    );
    const status = useSyncExternalStore(
        subscribeUi,
        () => getUiSnapshot().status,
        () => getUiSnapshot().status,
    );
    const note = useSyncExternalStore(
        subscribeUi,
        () => getUiSnapshot().note,
        () => getUiSnapshot().note,
    );
    // After the first import through Link (importNav.offerAutoImport), once.
    const [offer, setOffer] = useState(false);
    const accountReady = useAccountStore(s => s.status !== 'loading');
    // Latest callbacks without restarting the loop.
    const props = useRef({ onImport, onNeedsLink });
    useEffect(() => { props.current = { onImport, onNeedsLink }; });

    useEffect(() => {
        if (!on || !accountReady) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let firstTry = true;
        let busy = false;
        const tick = async () => {
            if (busy) return;
            busy = true;
            clearTimeout(timer);
            try {
                await runAutoImportCheckOnce(props.current, {
                    firstTry,
                    isStopped: () => stopped,
                });
                firstTry = false;
            } finally {
                busy = false;
                if (!stopped && getAutoImportOn()) {
                    timer = setTimeout(() => void tick(), AUTO_POLL_MS);
                }
            }
        };
        const onShow = () => { if (document.visibilityState === 'visible') void tick(); };
        document.addEventListener('visibilitychange', onShow);
        const current = loadAutoImportState();
        if (current.justConnected) {
            saveAutoImportState({ ...current, justConnected: false });
            timer = setTimeout(() => void tick(), AUTO_POLL_MS);
        } else {
            void tick();
        }
        return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onShow); };
    }, [on, accountReady]);

    useEffect(() => {
        const onOffer = () => setOffer(true);
        window.addEventListener(AUTO_OFFER_EVENT, onOffer);
        return () => window.removeEventListener(AUTO_OFFER_EVENT, onOffer);
    }, []);

    // The note fades after a few seconds.
    useEffect(() => {
        if (!note) return;
        const t = setTimeout(() => setNote(null), 5000);
        return () => clearTimeout(t);
    }, [note]);

    const toggle = (from?: string) => {
        const next = !loadAutoImportState().on;
        setStatus('');
        setOffer(false);
        setAutoImportOn(next, false);
        if (typeof window !== 'undefined') {
            trackEvent(next ? 'Auto import on' : 'Auto import off', from ? { from } : undefined);
        }
    };

    // On, but something's in the way (Link not running, no export…).
    const warn = on && !!status && !status.startsWith('Up to date');
    const title = on
        ? `Auto import is on: the site reads your newest game data from the emulator while it's open. ${status}`
        : 'Read your game data by itself whenever the game exports it, from an emulator on this PC or an Android phone on the same Wi-Fi. In the game: Settings → tap your player ID 5 times → External Tools Export → Auto. Needs TowerForge Link running.';

    return (
        <>
            <button
                className={`btn btn-dim lnk-btn lnk-auto ${on ? 'on' : ''} ${warn ? 'warn' : ''}`}
                aria-pressed={on}
                onClick={() => toggle()}
                title={title}
            >
                ⟳ Auto import {on ? 'on' : 'off'}
            </button>
            {note && <div className="opt-apply-toast" role="status">{note}</div>}
            {/* On the page itself: the header it sits in folds away (and goes inert) when a page is scrolled. */}
            {offer && !on && createPortal(
                <div className="lnk-offer" role="dialog" aria-label="Turn on Auto import?">
                    <p>
                        <strong>Keep it up to date by itself?</strong> With Auto import on, the site picks up each new export
                        while it&apos;s open. Set the game&apos;s External Tools Export to <strong>Auto</strong> too.
                    </p>
                    <span className="lnk-offer-actions">
                        <button type="button" className="btn btn-primary" onClick={() => toggle('offer')}>⟳ Turn on Auto import</button>
                        <button type="button" className="btn btn-dim" onClick={() => setOffer(false)}>Not now</button>
                    </span>
                </div>,
                document.body,
            )}
        </>
    );
}
