// ============================================================
//  TowerForge Companion — Creators live now
//  Which creators are streaming The Tower, from TowerForge's own
//  server (GET /api/creators/live; the server asks Twitch and
//  YouTube, TowerForge.Server/LiveStreams). The browser never
//  contacts them until a player opens a stream. Asked again every
//  2 minutes while the page is open and visible; shared by the tab
//  bar's dot and Creator Codes. Without the server (a static preview)
//  nobody shows as live.
// ============================================================

import { useSyncExternalStore } from 'react';

export type LivePlatform = 'twitch' | 'youtube';

export interface LiveStream {
    code: string;
    platform: LivePlatform;
    url: string;
    title: string;
    startedAt: string;
    viewers: number | null;
}

const API = '/api/creators/live';
const EVERY_MS = 2 * 60_000;

// Only links to the stream itself on its own site; anything else is dropped.
const WATCH_URL: Record<LivePlatform, RegExp> = {
    twitch: /^https:\/\/www\.twitch\.tv\/[a-z0-9_]+$/,
    youtube: /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]+$/,
};

export function readLive(body: unknown): LiveStream[] {
    const live = (body as { live?: unknown })?.live;
    if (!Array.isArray(live)) return [];
    return live.flatMap((s): LiveStream[] => {
        if (!s || typeof s !== 'object') return [];
        const { code, platform, url, title, startedAt, viewers } = s as Record<string, unknown>;
        if (typeof code !== 'string' || (platform !== 'twitch' && platform !== 'youtube')) return [];
        if (typeof url !== 'string' || !WATCH_URL[platform].test(url)) return [];
        return [{
            code, platform, url,
            title: typeof title === 'string' ? title : '',
            startedAt: typeof startedAt === 'string' ? startedAt : '',
            viewers: typeof viewers === 'number' && Number.isFinite(viewers) ? viewers : null,
        }];
    });
}

// "1h 20m" since the stream started ("" when unknown).
export function liveFor(startedAt: string, now = Date.now()): string {
    const ms = now - Date.parse(startedAt);
    if (!Number.isFinite(ms) || ms < 0) return '';
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${Math.max(1, minutes)}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// ── One shared poll ────────────────────────────────────────────
const EMPTY: LiveStream[] = [];
let current: LiveStream[] = EMPTY;
let lastAsked = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

async function refresh() {
    if (document.visibilityState === 'hidden') return;
    lastAsked = Date.now();
    try {
        const res = await fetch(API, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const next = readLive(await res.json());
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        current = next.length ? next : EMPTY;
        listeners.forEach(l => l());
    } catch {
        // Offline or no server: keep what was shown.
    }
}

function onVisible() {
    if (document.visibilityState === 'visible' && Date.now() - lastAsked > EVERY_MS) void refresh();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
        if (Date.now() - lastAsked > 60_000) void refresh();
        timer = setInterval(refresh, EVERY_MS);
        document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            if (timer) clearInterval(timer);
            timer = null;
            document.removeEventListener('visibilitychange', onVisible);
        }
    };
}

export function useLiveCreators(): LiveStream[] {
    return useSyncExternalStore(subscribe, () => current, () => EMPTY);
}
