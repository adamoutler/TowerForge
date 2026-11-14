// ============================================================
//  TowerForge Companion — Reminders (lab finished, tournament day)
//  "Remind me" on Profile, so players come back between imports (owner,
//  2026-11-13: most visitors came one day only):
//    labs     a notification when each lab researching at the last
//             import finishes; sent again after every import, so
//             finished labs drop out and new ones come in.
//    tourney  one on each tournament day (the player's own tournament
//             weekdays, else the game's Wednesday and Saturday:
//             engine/thisWeek.ts), the next six weeks, sent again on
//             each visit.
//  The browser asks the player first; TowerForge's server then keeps
//  this browser's push address and the reminders' words and times until
//  each is sent (TowerForge.Server/Push, Privacy page). Each kind turns
//  on and off by itself; the push address goes once neither is on.
//  Works where Web Push does: Chrome, Edge, Firefox, Safari on a Mac,
//  and on an iPhone only once TowerForge is added to the home screen
//  (iOS 16.4+).
// ============================================================

import { useSyncExternalStore } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { exampleOn } from '../../store/exampleAccount';
import { labFinishAt } from '../../engine/labTimer';
import { upcomingTourneyDays } from '../../engine/thisWeek';
import { trackEvent } from '../../analytics';
import type { LabRunning, TourneyRecord } from '../../types/gameTypes';

export type ReminderKind = 'labs' | 'tourney';

const ON_KEY: Record<ReminderKind, string> = { labs: 'tf-lab-reminders', tourney: 'tf-tourney-reminders' };
const SENT_KEY = 'tf-tourney-reminders-sent';
const EVENT: Record<ReminderKind, string> = { labs: 'Lab reminders', tourney: 'Tournament reminders' };
const API = '/api/reminders';
const MAX = 12;
const MIN = 60_000;

export interface Reminder { title: string; body: string; url: string; at: number }

// The reminders for these labs: one per lab still researching (a minute out or more).
export function remindersFor(labs: LabRunning[], now: number): Reminder[] {
    return labs.flatMap(lab => {
        const at = labFinishAt(lab);
        if (at === null || at < now + MIN) return [];
        const name = `${lab.lab ?? `Lab #${lab.labIndex}`}${lab.toLevel ? ` Lv ${lab.toLevel}` : ''}`;
        return [{ title: `🔬 ${name} is done`, body: 'Collect it in The Tower, then import to see your next pick.', url: '/labs', at }];
    }).sort((a, b) => a.at - b.at).slice(0, MAX);
}

// Tournament days: five minutes after the start (00:00 UTC), unless that
// is the player's night (11 p.m.–7 a.m. local), then at 7 a.m. — at most
// 8 hours in. `offsetAt(t)`: the local zone's offset then, in minutes
// (Date.getTimezoneOffset: UTC − local), so summer time counts.
export function tourneyRemindersFor(records: TourneyRecord[], now: number,
    offsetAt: (t: number) => number = t => new Date(t).getTimezoneOffset()): Reminder[] {
    return upcomingTourneyDays(records, now, MAX + 1).flatMap(day => {
        let at = day + 5 * MIN;
        const local = (((Math.floor(at / MIN) - offsetAt(at)) % 1440) + 1440) % 1440;
        if (local >= 23 * 60) at += (1440 - local + 7 * 60) * MIN;
        else if (local < 7 * 60) at += (7 * 60 - local) * MIN;
        if (at < now + MIN) return [];
        return [{ title: '🏆 Tournament day in The Tower', body: 'Today’s tournament is open. See its battle conditions and the build for them.', url: '/tournament', at }];
    }).slice(0, MAX);
}

export const remindersSupported = (): boolean =>
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function readOn(kind: ReminderKind): boolean {
    try {
        return localStorage.getItem(ON_KEY[kind]) === '1' && remindersSupported() && Notification.permission === 'granted';
    } catch {
        return false;
    }
}

const on: Record<ReminderKind, boolean> = { labs: readOn('labs'), tourney: readOn('tourney') };
const listeners = new Set<() => void>();
function setOn(kind: ReminderKind, next: boolean) {
    on[kind] = next;
    try {
        if (next) localStorage.setItem(ON_KEY[kind], '1');
        else localStorage.removeItem(ON_KEY[kind]);
    } catch {
        // Not remembered.
    }
    listeners.forEach(l => l());
}

export function useRemindersOn(kind: ReminderKind): boolean {
    return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => on[kind], () => false);
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

function listFor(kind: ReminderKind): Reminder[] {
    const s = useGameStore.getState();
    return kind === 'labs' ? remindersFor(s.labsRunning, Date.now()) : tourneyRemindersFor(s.tourneyRecords, Date.now());
}

async function send(sub: PushSubscription, kind: ReminderKind): Promise<void> {
    const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, subscription: sub.toJSON(), reminders: listFor(kind) }),
    });
    if (!res.ok) throw new Error(`The server didn't take the reminders (${res.status}).`);
    if (kind === 'tourney') {
        try { localStorage.setItem(SENT_KEY, String(Date.now())); } catch { /* sent again next visit */ }
    }
}

export type TurnOnResult = 'on' | 'denied' | 'failed';

export async function turnOnReminders(kind: ReminderKind): Promise<TurnOnResult> {
    if (!remindersSupported()) return 'failed';
    try {
        if (await Notification.requestPermission() !== 'granted') {
            trackEvent(EVENT[kind], { step: 'denied' });
            return 'denied';
        }
        const sub = await subscription(true);
        if (!sub) return 'failed';
        await send(sub, kind);
        setOn(kind, true);
        trackEvent(EVENT[kind], { step: 'on' });
        return 'on';
    } catch {
        return 'failed';
    }
}

export async function turnOffReminders(kind: ReminderKind): Promise<void> {
    const others = (Object.keys(on) as ReminderKind[]).some(k => k !== kind && on[k]);
    try {
        const sub = await subscription(false);
        if (sub) {
            // The other kind still on: only this kind's go. Neither: the push address too.
            await fetch(`${API}/off`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(others ? { endpoint: sub.endpoint, kind } : { endpoint: sub.endpoint }),
            });
            if (!others) await sub.unsubscribe();
        }
    } catch {
        // The server forgets it anyway once the push service says it's gone.
    }
    setOn(kind, false);
    trackEvent(EVENT[kind], { step: 'off' });
}

function resend(kind: ReminderKind) {
    void (async () => {
        try {
            const sub = await subscription(false);
            if (sub) await send(sub, kind);
        } catch {
            // Tried again after the next import or visit.
        }
    })();
}

// Lab reminders after each import (labs changed); tournament days once a
// day on a visit, and when new tournaments come in. Not for the example.
let started = false;
export function keepRemindersInStep(): void {
    if (started) return;
    started = true;
    let sent = 0;
    try { sent = Number(localStorage.getItem(SENT_KEY)) || 0; } catch { /* sent now */ }
    if (on.tourney && !exampleOn() && Date.now() - sent > 86_400_000) resend('tourney');
    useGameStore.subscribe((s, prev) => {
        if (exampleOn()) return;
        if (on.labs && s.labsRunning !== prev.labsRunning) resend('labs');
        if (on.tourney && s.tourneyRecords !== prev.tourneyRecords) resend('tourney');
    });
}
