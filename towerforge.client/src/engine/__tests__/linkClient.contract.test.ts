// ============================================================
//  TowerForge Companion — Path 1 LinkServer HTTP Wire Contract
//  & Parity Regression Suite (TOWERFORGE-1)
//
//  Locks the exact wire contract between src/engine/linkClient.ts
//  and TowerForge Link (127.0.0.1:47821 / http://localhost:47821)
//  across all 7 LinkServer HTTP operations and all 10 exported
//  functions in linkClient.ts without modifying Path 1 source files.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import openApiContract from '../../../../docs/contracts/link-v1-openapi.json';
import {
    defaultSource,
    exportAge,
    forgetPhoneLink,
    LINK_DOWNLOAD,
    LINK_DOWNLOAD_ANDROID,
    LINK_URL,
    linkExport,
    linkPhone,
    linkSources,
    linkStatus,
    phoneLinkRemembered,
    rememberedSource,
    rememberSource,
} from '../linkClient';
import type { LinkSource, LinkStatus } from '../linkClient';

describe('Path 1 LinkServer Wire Contract & Parity Suite (TOWERFORGE-1)', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe('0. OpenAPI 3.1 Contract Artifact & Exported Constants', () => {
        it('locks LINK_URL, LINK_DOWNLOAD, and LINK_DOWNLOAD_ANDROID constants', () => {
            expect(LINK_URL).toBe('http://localhost:47821');
            expect(LINK_DOWNLOAD).toBe('/downloads/TowerForgeLink.exe');
            expect(LINK_DOWNLOAD_ANDROID).toBe('/downloads/TowerForgeLink.apk');
        });

        it('validates docs/contracts/link-v1-openapi.json covers all LinkServer endpoints on 127.0.0.1:47821', () => {
            const spec = openApiContract as {
                openapi: string;
                servers: { url: string }[];
                paths: Record<string, Record<string, unknown>>;
                components: { schemas: Record<string, unknown> };
            };

            expect(spec.openapi).toBe('3.1.0');
            expect(spec.servers.map(s => s.url)).toContain('http://127.0.0.1:47821');
            expect(spec.servers.map(s => s.url)).toContain('http://localhost:47821');

            // Verify all required endpoints exist in the contract specification
            expect(spec.paths['/status']?.get).toBeDefined();
            expect(spec.paths['/sources']?.get).toBeDefined();
            expect(spec.paths['/export']?.get).toBeDefined();
            expect(spec.paths['/phone/adb']?.post).toBeDefined();
            expect(spec.paths['/phone/enable-wireless']?.post).toBeDefined();
            expect(spec.paths['/phone/pair']?.post).toBeDefined();
            expect(spec.paths['/phone/connect']?.post).toBeDefined();
            expect(spec.paths['/phone/forget']?.post).toBeDefined();
            expect(spec.paths['/phone/disconnect']?.post).toBeDefined();
        });
    });

    describe('1. checkStatus / linkStatus() — GET /status wire contract', () => {
        it('returns truthy LinkStatus on HTTP 200 {"ok":true,"adbAvailable":true} and full LinkStatus payload', async () => {
            const statusPayload: LinkStatus & { ok: boolean; adbAvailable: boolean } = {
                ok: true,
                adbAvailable: true,
                version: '0.4.2',
                emulators: [{ name: 'BlueStacks', running: true, adbEnabled: true }],
                phone: { adbReady: true, adbVersion: '1.0.41', paired: 1, connected: ['Pixel 8'] },
                iphoneBackups: [{ backedUp: 1792290000, encrypted: false, hasExport: true, exportModified: 1792289900 }],
            };

            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify(statusPayload), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            );

            const result = await linkStatus();
            expect(Boolean(result)).toBe(true);
            expect(result).toEqual(statusPayload);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { targetAddressSpace?: string }];
            expect(url).toBe('http://localhost:47821/status');
            expect(init.method).toBe('GET');
            expect(init.cache).toBe('no-store');
            expect(init.targetAddressSpace).toBe('loopback');
            expect(init.signal).toBeInstanceOf(AbortSignal);
        });

        it('returns null (falsy) on HTTP 403/500 error status or malformed JSON', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'forbidden', message: 'Unexpected host.' }), { status: 403 }),
            );
            expect(await linkStatus()).toBeNull();

            fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 200 }));
            expect(await linkStatus()).toBeNull();
        });

        it('returns null (falsy) on network error or 15,000ms abort timeout', async () => {
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
            expect(await linkStatus()).toBeNull();

            vi.useFakeTimers();
            fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
                return new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            });

            const pending = linkStatus();
            await vi.advanceTimersByTimeAsync(15_000);
            expect(await pending).toBeNull();
        });
    });

    describe('2. getSources / linkSources() — GET /sources wire contract', () => {
        it('parses SourceListResult (sources[], has_save_data, adb_available, error) on HTTP 200', async () => {
            const sources: LinkSource[] = [
                { id: 'bluestacks:5555', name: 'BlueStacks', kind: 'emulator', state: 'ready', modified: 1792290103 },
                { id: 'mumuplayer:16384', name: 'MuMu Player', kind: 'emulator', state: 'offline', message: 'ADB off' },
                { id: 'phone:192.168.1.23:41235', name: 'Pixel 8', kind: 'phone', state: 'no_export', message: 'No export yet' },
                { id: 'iphone-backup', name: 'iPhone Backup', kind: 'iphone', state: 'encrypted', message: 'Encrypted backup' },
            ];
            const wireBody = {
                sources,
                has_save_data: true,
                adb_available: true,
                error: null,
            };

            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify(wireBody), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            );

            const result = await linkSources();
            expect(result).toEqual(sources);

            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { targetAddressSpace?: string }];
            expect(url).toBe('http://localhost:47821/sources');
            expect(init.method).toBe('GET');
            expect(init.cache).toBe('no-store');
            expect(init.targetAddressSpace).toBe('loopback');
        });

        it('returns null when HTTP status is 404/500 or sources field is not an array', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'not_found', message: 'Nothing here.' }), { status: 404 }),
            );
            expect(await linkSources()).toBeNull();

            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'failed', message: 'Internal error' }), { status: 500 }),
            );
            expect(await linkSources()).toBeNull();

            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ sources: 'invalid' }), { status: 200 }),
            );
            expect(await linkSources()).toBeNull();
        });

        it('returns null on network error or 60,000ms abort timeout', async () => {
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
            expect(await linkSources()).toBeNull();

            vi.useFakeTimers();
            fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
                return new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            });

            const pending = linkSources();
            await vi.advanceTimersByTimeAsync(60_000);
            expect(await pending).toBeNull();
        });
    });

    describe('3. exportFromSource / linkExport() — GET /export wire contract', () => {
        it('returns ExportResult (ok: true, text data, modified, source, sourceId) on HTTP 200', async () => {
            const rawExport = JSON.stringify({ VersionNumber: 1, tier: 15 });
            fetchMock.mockResolvedValueOnce(
                new Response(rawExport, {
                    status: 200,
                    headers: {
                        'X-Export-Modified': '1792290103',
                        'X-Export-Source': 'BlueStacks',
                        'X-Export-Source-Id': 'bluestacks:5555',
                    },
                }),
            );

            const res = await linkExport(1792290000.9, 'bluestacks:5555');
            expect(res).toEqual({
                ok: true,
                text: rawExport,
                modified: 1792290103,
                source: 'BlueStacks',
                sourceId: 'bluestacks:5555',
            });

            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { targetAddressSpace?: string }];
            expect(url).toBe('http://localhost:47821/export?newerThan=1792290000&source=bluestacks%3A5555');
            expect(init.method).toBe('GET');
            expect(init.cache).toBe('no-store');
            expect(init.targetAddressSpace).toBe('loopback');
        });

        it('defaults source to "your emulator" and modified to null when headers are absent on HTTP 200', async () => {
            fetchMock.mockResolvedValueOnce(new Response('{"VersionNumber":1}', { status: 200 }));
            const res = await linkExport();
            expect(res).toEqual({
                ok: true,
                text: '{"VersionNumber":1}',
                modified: null,
                source: 'your emulator',
                sourceId: null,
            });
        });

        it('returns ok: false with reason "unchanged" on HTTP 204', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(null, {
                    status: 204,
                    headers: { 'X-Export-Modified': '1792290103' },
                }),
            );
            expect(await linkExport(1792290103)).toEqual({
                ok: false,
                reason: 'unchanged',
                modified: 1792290103,
            });

            fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
            expect(await linkExport(1792290103)).toEqual({
                ok: false,
                reason: 'unchanged',
                modified: null,
            });
        });

        it('maps HTTP 404, 409, and 500 JSON error bodies to ok: false with reason "problem"', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ error: 'not_found', message: 'Export file not found on device.' }),
                    { status: 404 },
                ),
            );
            expect(await linkExport()).toEqual({
                ok: false,
                reason: 'problem',
                code: 'not_found',
                message: 'Export file not found on device.',
            });

            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ error: 'no_export', message: 'The Tower has no data export yet.' }),
                    { status: 409 },
                ),
            );
            expect(await linkExport()).toEqual({
                ok: false,
                reason: 'problem',
                code: 'no_export',
                message: 'The Tower has no data export yet.',
            });

            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ error: 'failed', message: 'TowerForge Link hit an error: ADB crashed' }),
                    { status: 500 },
                ),
            );
            expect(await linkExport()).toEqual({
                ok: false,
                reason: 'problem',
                code: 'failed',
                message: 'TowerForge Link hit an error: ADB crashed',
            });

            // Non-JSON 500 fallback
            fetchMock.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));
            expect(await linkExport()).toEqual({
                ok: false,
                reason: 'problem',
                code: 'failed',
                message: 'TowerForge Link couldn’t get your export.',
            });
        });

        it('returns ok: false with reason "unreachable" on network error or 90,000ms timeout', async () => {
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
            expect(await linkExport()).toEqual({ ok: false, reason: 'unreachable' });

            vi.useFakeTimers();
            fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
                return new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            });

            const pending = linkExport();
            await vi.advanceTimersByTimeAsync(90_000);
            expect(await pending).toEqual({ ok: false, reason: 'unreachable' });
        });
    });

    describe('4. enableWirelessAdb, pairPhone, connectPhone, disconnectPhone / linkPhone() — POST /phone/* wire contract', () => {
        it('enableWirelessAdb / linkPhone("adb") sends POST /phone/adb and parses HTTP 200 response', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ ok: true, message: "Google's adb 1.0.41 is ready." }), { status: 200 }),
            );

            const res = await linkPhone('adb');
            expect(res).toEqual({ ok: true, message: "Google's adb 1.0.41 is ready." });

            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { targetAddressSpace?: string }];
            expect(url).toBe('http://localhost:47821/phone/adb');
            expect(init.method).toBe('POST');
            expect(init.cache).toBe('no-store');
            expect(init.targetAddressSpace).toBe('loopback');
        });

        it('pairPhone / linkPhone("pair") encodes address & code and handles HTTP 200 and 409 error responses', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ ok: true, message: 'Paired and connected to Pixel 8.' }), { status: 200 }),
            );

            const okRes = await linkPhone('pair', { address: '192.168.1.23:37415', code: '123456' });
            expect(okRes).toEqual({ ok: true, message: 'Paired and connected to Pixel 8.' });
            expect(fetchMock.mock.calls[0][0]).toBe(
                'http://localhost:47821/phone/pair?address=192.168.1.23%3A37415&code=123456',
            );
            expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');

            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        error: 'bad_code',
                        message: 'The pairing code is the 6 digits under "Wi-Fi pairing code" on the phone.',
                    }),
                    { status: 409 },
                ),
            );
            const errRes = await linkPhone('pair', { address: '192.168.1.23:37415', code: '000000' });
            expect(errRes).toEqual({
                ok: false,
                reason: 'problem',
                code: 'bad_code',
                message: 'The pairing code is the 6 digits under "Wi-Fi pairing code" on the phone.',
            });
        });

        it('connectPhone / linkPhone("connect") encodes address and handles HTTP 200 and 409/500 errors', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ ok: true, message: 'Connected to Pixel 8.' }), { status: 200 }),
            );

            const okRes = await linkPhone('connect', { address: '192.168.1.23:41235' });
            expect(okRes).toEqual({ ok: true, message: 'Connected to Pixel 8.' });
            expect(fetchMock.mock.calls[0][0]).toBe(
                'http://localhost:47821/phone/connect?address=192.168.1.23%3A41235',
            );
            expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');

            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ error: 'bad_address', message: 'Type the address the phone shows.' }),
                    { status: 409 },
                ),
            );
            expect(await linkPhone('connect', { address: 'invalid' })).toEqual({
                ok: false,
                reason: 'problem',
                code: 'bad_address',
                message: 'Type the address the phone shows.',
            });
        });

        it('disconnectPhone / linkPhone("forget") sends POST /phone/forget and handles HTTP 200, 405 old_link, and timeout', async () => {
            fetchMock.mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ ok: true, message: 'Forgotten. To use a phone again, pair it again.' }),
                    { status: 200 },
                ),
            );

            const okRes = await linkPhone('forget');
            expect(okRes).toEqual({ ok: true, message: 'Forgotten. To use a phone again, pair it again.' });
            expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:47821/phone/forget');
            expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');

            // Link 0.2 and older return 405 with error: "method"
            fetchMock.mockResolvedValueOnce(
                new Response(JSON.stringify({ error: 'method', message: 'Use GET.' }), { status: 405 }),
            );
            const oldRes = await linkPhone('forget');
            expect(oldRes).toEqual({
                ok: false,
                reason: 'problem',
                code: 'old_link',
                message:
                    'This TowerForge Link is too old for phones: download the new one, close the old window and run the new one.',
            });

            // Non-JSON response also maps to old_link
            fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));
            expect(await linkPhone('forget')).toEqual(oldRes);

            // Network error and 180,000ms timeout map to unreachable
            fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
            expect(await linkPhone('forget')).toEqual({ ok: false, reason: 'unreachable' });

            vi.useFakeTimers();
            fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
                return new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('The operation was aborted.', 'AbortError'));
                    });
                });
            });
            const pending = linkPhone('adb');
            await vi.advanceTimersByTimeAsync(180_000);
            expect(await pending).toEqual({ ok: false, reason: 'unreachable' });
        });
    });

    describe('5. LocalStorage & Helper Exports (phoneLinkRemembered, forgetPhoneLink, rememberedSource, rememberSource, defaultSource, exportAge)', () => {
        it('manages remembered source selection via localStorage', () => {
            const store = new Map<string, string>();
            vi.stubGlobal('localStorage', {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => store.set(k, v),
                removeItem: (k: string) => store.delete(k),
            });

            expect(rememberedSource()).toBeNull();
            rememberSource('bluestacks:5555');
            expect(rememberedSource()).toBe('bluestacks:5555');
            rememberSource(null);
            expect(rememberedSource()).toBeNull();
        });

        it('manages Android phone link remembrance and query parameter stripping', () => {
            const store = new Map<string, string>();
            const replaceState = vi.fn();
            const removeClass = vi.fn();

            vi.stubGlobal('localStorage', {
                getItem: (k: string) => store.get(k) ?? null,
                setItem: (k: string, v: string) => store.set(k, v),
                removeItem: (k: string) => store.delete(k),
            });
            vi.stubGlobal('window', {
                location: { href: 'https://towerforge.net/?link=android&foo=bar#top' },
                history: { replaceState },
            });
            vi.stubGlobal('document', {
                documentElement: { classList: { remove: removeClass } },
            });

            expect(phoneLinkRemembered()).toBe(true);
            expect(store.get('tc_link_phone')).toBe('1');
            expect(replaceState).toHaveBeenCalledWith(null, '', '/?foo=bar#top');

            forgetPhoneLink();
            expect(store.has('tc_link_phone')).toBe(false);
            expect(removeClass).toHaveBeenCalledWith('tf-phone-link');
        });

        it('selects defaultSource and formats exportAge across all time ranges', () => {
            const sources: LinkSource[] = [
                { id: 'emu:1', name: 'Emu 1', kind: 'emulator', state: 'ready', modified: 100 },
                { id: 'emu:2', name: 'Emu 2', kind: 'emulator', state: 'ready', modified: 500 },
                { id: 'emu:3', name: 'Emu 3', kind: 'emulator', state: 'offline' },
            ];
            expect(defaultSource(sources, null)).toBe('emu:2');
            expect(defaultSource(sources, 'emu:1')).toBe('emu:1');
            expect(defaultSource(sources, 'emu:3')).toBe('emu:2');

            const now = 1_800_000_000_000;
            expect(exportAge(now / 1000 + 30, now)).toBe('just now');
            expect(exportAge(now / 1000 - 45, now)).toBe('just now');
            expect(exportAge(now / 1000 - 60, now)).toBe('1 minute ago');
            expect(exportAge(now / 1000 - 120, now)).toBe('2 minutes ago');
            expect(exportAge(now / 1000 - 3600, now)).toBe('1 hour ago');
            expect(exportAge(now / 1000 - 7200, now)).toBe('2 hours ago');
            expect(exportAge(now / 1000 - 86400, now)).toBe('1 day ago');
            expect(exportAge(now / 1000 - 172800, now)).toBe('2 days ago');
        });
    });
});
