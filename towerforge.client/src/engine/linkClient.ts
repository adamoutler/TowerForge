// ============================================================
//  TowerForge Companion — TowerForge Link client
//  Talks to TowerForge Link, the small Windows helper that reads the
//  game's data export (tool_export.json) off an Android emulator with
//  the emulator's own adb, off an Android phone over Wi-Fi with
//  Google's adb, or out of an iPhone backup on the PC (Link 0.3+;
//  TowerForge.Link/, docs/towerforge-link.md). With more than one
//  emulator or phone, the player picks where to import from (Link
//  0.4+: /sources), remembered per browser for Auto import too. The
//  helper only listens on this PC; the file goes from there to this
//  browser and is never uploaded.
// ============================================================

export const LINK_URL = 'http://localhost:47821';
export const LINK_DOWNLOAD = '/downloads/TowerForgeLink.exe';
export const LINK_DOWNLOAD_ANDROID = '/downloads/TowerForgeLink.apk';

// A phone with TowerForge Link for Android: the app opens the site with
// ?link=android, remembered per browser, so the Link buttons (hidden on
// touch screens) show on that phone. Phones without the app never ask
// for Link, so they never see the browser's "apps on this device" prompt.
const PHONE_KEY = 'tc_link_phone';

export function phoneLinkRemembered(): boolean {
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('link') === 'android') {
            localStorage.setItem(PHONE_KEY, '1');
            url.searchParams.delete('link');
            window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        }
        return localStorage.getItem(PHONE_KEY) === '1';
    } catch {
        return false;
    }
}

// TowerForge Link (0.5+) opens the site with ?link=import when it starts
// and no page is asking it yet; the Android app's "Open towerforge.net"
// adds ?link=android. Either way the player wants their data in, so the
// site imports on load (App.tsx). Read once, before phoneLinkRemembered()
// tidies the address.
const OPENED_BY_LINK = (() => {
    try {
        const v = new URLSearchParams(window.location.search).get('link');
        return v === 'import' || v === 'android';
    } catch {
        return false;
    }
})();

export const openedByLink = (): boolean => OPENED_BY_LINK;

export function forgetPhoneLink(): void {
    try { localStorage.removeItem(PHONE_KEY); } catch { /* not remembered anyway */ }
    document.documentElement.classList.remove('tf-phone-link');
}

export type LinkResult =
    | { ok: true; text: string; modified: number | null; source: string; sourceId: string | null }
    | { ok: false; reason: 'unreachable' }                         // helper not running (or blocked)
    | { ok: false; reason: 'unchanged'; modified: number | null }  // not newer than `newerThan` (Link 0.2+)
    | { ok: false; reason: 'problem'; code: string; message: string };

// Chrome and Edge ask once before a site may reach apps on this PC
// (Local Network Access); naming the target lets them ask. Other
// browsers ignore the option.
function linkFetch(path: string, timeoutMs: number, method: 'GET' | 'POST' = 'GET'): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const init = { method, signal: ctrl.signal, cache: 'no-store', targetAddressSpace: 'loopback' } as RequestInit;
    return fetch(`${LINK_URL}${path}`, init).finally(() => clearTimeout(timer));
}

// The export, or why not. Reading it can take a few seconds (adb).
// newerThan (the file time of an export already read, unix seconds): Link
// 0.2+ answers 204 without the file when there's nothing newer; older
// versions ignore it and send the file anyway.
// source: an id from linkSources() (older Links ignore it and send the newest).
export async function linkExport(newerThan?: number, source?: string | null): Promise<LinkResult> {
    const query = new URLSearchParams();
    if (newerThan) query.set('newerThan', String(Math.floor(newerThan)));
    if (source) query.set('source', source);
    const qs = query.toString();
    let res: Response;
    try {
        res = await linkFetch(`/export${qs ? `?${qs}` : ''}`, 90_000);
    } catch {
        return { ok: false, reason: 'unreachable' };
    }
    const modified = Number(res.headers.get('X-Export-Modified'));
    if (res.status === 204) {
        return { ok: false, reason: 'unchanged', modified: Number.isFinite(modified) && modified > 0 ? modified : null };
    }
    if (res.ok) {
        return {
            ok: true,
            text: await res.text(),
            modified: Number.isFinite(modified) && modified > 0 ? modified : null,
            source: res.headers.get('X-Export-Source') || 'your emulator',
            sourceId: res.headers.get('X-Export-Source-Id'),
        };
    }
    try {
        const body = await res.json() as { error?: string; message?: string };
        return { ok: false, reason: 'problem', code: body.error ?? 'failed', message: body.message ?? 'TowerForge Link couldn’t get your export.' };
    } catch {
        return { ok: false, reason: 'problem', code: 'failed', message: 'TowerForge Link couldn’t get your export.' };
    }
}

// ── Where to import from (Link 0.4+) ─────────────────────────
// Every emulator, phone and iPhone backup Link sees, newest export first.
// state: ready (has an export) or what's in the way, with `message`.
export interface LinkSource {
    id: string;
    name: string;
    kind: 'emulator' | 'phone' | 'iphone';
    state: 'ready' | 'no_export' | 'no_game' | 'blocked' | 'offline' | 'unauthorized' | 'encrypted';
    modified?: number;
    message?: string;
}

// null: Link isn't running, or is older than 0.4 (no list — it takes the newest).
export async function linkSources(): Promise<LinkSource[] | null> {
    try {
        const res = await linkFetch('/sources', 60_000);
        if (!res.ok) return null;
        const body = await res.json() as { sources?: LinkSource[] };
        return Array.isArray(body.sources) ? body.sources : null;
    } catch {
        return null;
    }
}

const SOURCE_KEY = 'tc_link_source';

// The source the player picked last (Auto import reads from it too).
export function rememberedSource(): string | null {
    try { return localStorage.getItem(SOURCE_KEY); } catch { return null; }
}
export function rememberSource(id: string | null): void {
    try {
        if (id) localStorage.setItem(SOURCE_KEY, id);
        else localStorage.removeItem(SOURCE_KEY);
    } catch { /* not remembered */ }
}

// Which source to offer first: the remembered one when it has an export,
// else the newest export.
export function defaultSource(sources: LinkSource[], remembered: string | null): string | null {
    const ready = sources.filter(s => s.state === 'ready');
    return ready.find(s => s.id === remembered)?.id ?? ready.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))[0]?.id ?? null;
}

// "2 hours ago", for an export's file time (unix seconds).
export function exportAge(modified: number, now = Date.now()): string {
    const mins = Math.max(0, Math.floor((now / 1000 - modified) / 60));
    const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'} ago`;
    if (mins < 1) return 'just now';
    if (mins < 60) return unit(mins, 'minute');
    if (mins < 60 * 24) return unit(Math.floor(mins / 60), 'hour');
    return unit(Math.floor(mins / (60 * 24)), 'day');
}

// ── What Link found, and Android phones (Link 0.3+) ────────────
export interface LinkStatus {
    version: string;
    emulators: { name: string; running: boolean; adbEnabled: boolean | null }[];
    // Missing before Link 0.3 (no phones over Wi-Fi, no iPhone backups).
    phone?: { adbReady: boolean; adbVersion?: string; paired: number; connected: string[] };
    // iPhone backups on the PC, newest first (unix seconds).
    iphoneBackups?: { backedUp?: number; encrypted: boolean; hasExport: boolean; exportModified?: number }[];
    // TowerForge Link for Android (platform 'android'): Shizuku and the export.
    platform?: 'android';
    android?: {
        shizuku: 'ready' | 'not_installed' | 'not_running' | 'no_permission';
        export?: 'found' | 'none' | 'no_game' | 'unreadable' | 'unknown';
        exportModified?: number;
    };
}

// null: Link isn't running on this PC (or the browser blocked it).
export async function linkStatus(): Promise<LinkStatus | null> {
    try {
        const res = await linkFetch('/status', 15_000);
        return res.ok ? await res.json() as LinkStatus : null;
    } catch {
        return null;
    }
}

export type LinkAction =
    | { ok: true; message: string }
    | { ok: false; reason: 'unreachable' }
    | { ok: false; reason: 'problem'; code: string; message: string };

// adb: download Google's adb · pair: address + 6-digit code from the
// phone's pairing screen · connect: the address on Wireless debugging's
// main screen · forget: the phones paired through Link.
export async function linkPhone(
    action: 'adb' | 'pair' | 'connect' | 'forget', params: Record<string, string> = {},
): Promise<LinkAction> {
    const query = new URLSearchParams(params).toString();
    let res: Response;
    try {
        res = await linkFetch(`/phone/${action}${query ? `?${query}` : ''}`, 180_000, 'POST');
    } catch {
        return { ok: false, reason: 'unreachable' };
    }
    const old = { ok: false, reason: 'problem', code: 'old_link', message: 'This TowerForge Link is too old for phones: download the new one, close the old window and run the new one.' } as const;
    try {
        const body = await res.json() as { message?: string; error?: string };
        if (res.ok) return { ok: true, message: body.message ?? 'Done.' };
        // Link 0.2 and older only answer GET.
        if (body.error === 'method') return old;
        return { ok: false, reason: 'problem', code: body.error ?? 'failed', message: body.message ?? 'TowerForge Link couldn’t do that.' };
    } catch {
        return old;
    }
}
