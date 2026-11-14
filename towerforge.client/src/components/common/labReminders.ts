// ============================================================
//  TowerForge Companion — Lab reminders
//  "Remind me" (Profile): a notification when each lab researching at
//  the last import finishes, so players come back to collect it and
//  import (owner, 2026-11-13: most visitors came one day only).
//  The browser asks the player first; TowerForge's server then keeps
//  this browser's push address and the labs' names and finish times
//  until each is sent (TowerForge.Server/Push, Privacy page). After
//  every import the list is sent again, so finished labs drop out and
//  new ones come in. Works where Web Push does: Chrome, Edge, Firefox,
//  Safari on a Mac, and on an iPhone only once TowerForge is added to
//  the home screen (iOS 16.4+).
// ============================================================

import { useSyncExternalStore } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { exampleOn } from '../../store/exampleAccount';
import { labFinishAt } from '../../engine/labTimer';
import { trackEvent } from '../../analytics';
import type { LabRunning } from '../../types/gameTypes';

const ON_KEY = 'tf-lab-reminders';
const API = '/api/reminders';

export interface LabReminder { title: string; body: string; url: string; at: number }

// The reminders for these labs: one per lab still researching (a minute out or more).
export function remindersFor(labs: LabRunning[], now: number): LabReminder[] {
    return labs.flatMap(lab => {
        const at = labFinishAt(lab);
        if (at === null || at < now + 60_000) return [];
        const name = `${lab.lab ?? `Lab #${lab.labIndex}`}${lab.toLevel ? ` Lv ${lab.toLevel}` : ''}`;
        return [{ title: `🔬 ${name} is done`, body: 'Collect it in The Tower, then import to see your next pick.', url: '/labs', at }];
    }).sort((a, b) => a.at - b.at).slice(0, 12);
}

export const remindersSupported = (): boolean =>
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function readOn(): boolean {
    try {
        return localStorage.getItem(ON_KEY) === '1' && remindersSupported() && Notification.permission === 'granted';
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
        else localStorage.removeItem(ON_KEY);
    } catch {
        // Not remembered.
    }
    listeners.forEach(l => l());
}

export function useRemindersOn(): boolean {
    return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => on, () => false);
}

const fromB64Url = (s: string) => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
    return Uint8Array.from(b, c => c.charCodeAt(0));
};

async function subscription(create: boolean): Promise<PushSubscription | null> {
    const reg = create ? await navigator.serviceWorker.register('/sw.js') : await navigator.serviceWorker.getRegistration('/');
    if (!reg) return null;
    await navigator.serviceWorker.ready;
    const had = await reg.pushManager.getSubscription();
    if (had || !create) return had;
    const { publicKey } = await (await fetch(`${API}/key`)).json() as { publicKey: string };
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64Url(publicKey) });
}

async function send(sub: PushSubscription, labs: LabRunning[]): Promise<void> {
    const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), reminders: remindersFor(labs, Date.now()) }),
    });
    if (!res.ok) throw new Error(`The server didn't take the reminders (${res.status}).`);
}

export type TurnOnResult = 'on' | 'denied' | 'failed';

export async function turnOnReminders(): Promise<TurnOnResult> {
    if (!remindersSupported()) return 'failed';
    try {
        if (await Notification.requestPermission() !== 'granted') {
            trackEvent('Lab reminders', { step: 'denied' });
            return 'denied';
        }
        const sub = await subscription(true);
        if (!sub) return 'failed';
        await send(sub, useGameStore.getState().labsRunning);
        setOn(true);
        trackEvent('Lab reminders', { step: 'on' });
        return 'on';
    } catch {
        return 'failed';
    }
}

export async function turnOffReminders(): Promise<void> {
    try {
        const sub = await subscription(false);
        if (sub) {
            await fetch(`${API}/off`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
            await sub.unsubscribe();
        }
    } catch {
        // The server forgets it anyway once the push service says it's gone.
    }
    setOn(false);
    trackEvent('Lab reminders', { step: 'off' });
}

// After each import (labs changed): send the new list. Not for the example account.
let started = false;
export function keepRemindersInStep(): void {
    if (started) return;
    started = true;
    useGameStore.subscribe((s, prev) => {
        if (!on || exampleOn() || s.labsRunning === prev.labsRunning) return;
        void (async () => {
            try {
                const sub = await subscription(false);
                if (sub) await send(sub, s.labsRunning);
            } catch {
                // Tried again after the next import.
            }
        })();
    });
}
