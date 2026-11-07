// ============================================================
//  TowerForge Companion — WebSocket Relay Client & UsbLinkModal Companion Tests
//  Verifies wsLinkClient JSON-RPC framing (status, sources, export,
//  usb.owner, adb.kill_server), error/timeout handling, and UsbLinkModal
//  integration for 1-click "Stop Local ADB Server & Retry USB",
//  "/downloads/towerforge-link.pyz" download link, and
//  "Import via Python Companion (/ws)" fallback import.
// ============================================================

import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsbLinkModal, { type UsbLinkModalProps } from '../../components/UsbLinkModal';
import { pullTowerForgeExportViaWebUsb } from '../usbLink';
import {
    COMPANION_PYZ_DOWNLOAD_URL,
    configureWsLinkClient,
    resetWsLinkClientConfig,
    WS_LINK_DEFAULT_URL,
    WS_LINK_TIMEOUT_MS,
    wsExport,
    wsGetSources,
    wsGetStatus,
    wsGetUsbOwner,
    wsKillAdbServer,
    WsLinkClient,
    WsLinkError,
    type WebSocketLike,
    type WsCloseEventLike,
    type WsMessageEventLike,
} from '../wsLinkClient';

vi.mock('../usbLink', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../usbLink')>();
    return {
        ...actual,
        pullTowerForgeExportViaWebUsb: vi.fn(actual.pullTowerForgeExportViaWebUsb),
    };
});

const LINUX_CHROME_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const LINUX_FIREFOX_UA =
    'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';

class FakeWebSocket implements WebSocketLike {
    readonly url: string;
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: WsMessageEventLike) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: WsCloseEventLike) => void) | null = null;
    readonly sentFrames: string[] = [];
    closed = false;

    private readonly onSendCallback?: (
        rawFrame: string,
        parsedFrame: { id: string; method: string; params?: Record<string, unknown> },
        socket: FakeWebSocket,
    ) => void;

    constructor(
        url: string,
        options?: {
            autoOpen?: boolean;
            onSend?: (
                rawFrame: string,
                parsedFrame: { id: string; method: string; params?: Record<string, unknown> },
                socket: FakeWebSocket,
            ) => void;
        },
    ) {
        this.url = url;
        this.onSendCallback = options?.onSend;
        if (options?.autoOpen !== false) {
            queueMicrotask(() => {
                if (!this.closed) {
                    this.readyState = 1;
                    this.onopen?.({ type: 'open' });
                }
            });
        }
    }

    send(data: string): void {
        this.sentFrames.push(data);
        const parsed = JSON.parse(data) as {
            id: string;
            method: string;
            params?: Record<string, unknown>;
        };
        this.onSendCallback?.(data, parsed, this);
    }

    close(code = 1000, reason = ''): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.readyState = 3;
        this.onclose?.({ code, reason, wasClean: true });
    }

    emitServerFrame(payload: unknown): void {
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
        this.onmessage?.({ data: serialized });
    }

    emitError(message = 'Socket error'): void {
        this.onerror?.({ message });
    }
}

interface ElementMatch {
    type: string;
    props: Record<string, unknown>;
    text: string;
}

function extractText(node: ReactNode): string {
    if (node === null || node === undefined || typeof node === 'boolean') {
        return '';
    }
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(extractText).join('');
    }
    if (isValidElement(node)) {
        const el = node as ReactElement<{ children?: ReactNode }>;
        return extractText(el.props.children);
    }
    return '';
}

function collectElements(node: ReactNode, results: ElementMatch[] = []): ElementMatch[] {
    if (node === null || node === undefined || typeof node === 'boolean') {
        return results;
    }
    if (Array.isArray(node)) {
        for (const child of node) {
            collectElements(child, results);
        }
        return results;
    }
    if (isValidElement(node)) {
        const el = node as ReactElement<Record<string, unknown>>;
        if (typeof el.type === 'string') {
            results.push({
                type: el.type,
                props: el.props,
                text: extractText(el.props.children as ReactNode),
            });
        }
        collectElements(el.props.children as ReactNode, results);
    }
    return results;
}

function renderModalHarness(props: UsbLinkModalProps) {
    let lastTree: ReactElement | null = null;

    function Harness() {
        const tree = UsbLinkModal(props);
        lastTree = tree;
        return tree;
    }

    const render = () => {
        const html = renderToStaticMarkup(createElement(Harness));
        const elements = collectElements(lastTree);
        return { html, elements };
    };

    const clickButton = async (
        labelOrTestId: string,
    ): Promise<{ html: string; elements: ElementMatch[] }> => {
        const { elements } = render();
        const button = elements.find(
            (el) =>
                el.type === 'button' &&
                (el.text.includes(labelOrTestId) || el.props['data-testid'] === labelOrTestId),
        );
        if (!button) {
            throw new Error(`Button matching "${labelOrTestId}" was not found in UsbLinkModal.`);
        }
        const onClick = button.props.onClick as (() => Promise<void> | void) | undefined;
        if (typeof onClick !== 'function') {
            throw new Error(`Button "${labelOrTestId}" does not have an onClick handler.`);
        }
        await onClick();
        return render();
    };

    return { render, clickButton };
}

describe('wsLinkClient & UsbLinkModal Companion Integration (TOWERFORGE-17)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetWsLinkClientConfig();
        vi.stubGlobal('navigator', {
            userAgent: LINUX_CHROME_UA,
            usb: {},
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    afterEach(() => {
        resetWsLinkClientConfig();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('1. sends valid JSON-RPC request frames (id, method, params) and resolves matching response frames for status, sources, export, usb.owner, and adb.kill_server', async () => {
        const createdSockets: FakeWebSocket[] = [];
        const rawExportJson = '{"version":26,"player":"WsRelayHero","coins":42424242,"whitespace":  true }';

        const createWebSocket = (url: string) => {
            const socket = new FakeWebSocket(url, {
                onSend: (_raw, frame, ws) => {
                    // Emit an unrelated correlation ID first to verify correlation filtering
                    ws.emitServerFrame({
                        id: 'unrelated-correlation-id',
                        ok: true,
                        ignored: true,
                    });

                    if (frame.method === 'status') {
                        ws.emitServerFrame({
                            id: frame.id,
                            ok: true,
                            version: '1.0.0',
                            platform: 'linux',
                            adb_available: true,
                        });
                    } else if (frame.method === 'sources') {
                        ws.emitServerFrame({
                            id: frame.id,
                            ok: true,
                            sources: [
                                {
                                    id: 'adb:pixel8',
                                    name: 'Pixel 8',
                                    kind: 'phone',
                                    state: 'ready',
                                    modified: 1730000000,
                                },
                            ],
                        });
                    } else if (frame.method === 'export') {
                        ws.emitServerFrame({
                            id: frame.id,
                            ok: true,
                            data: rawExportJson,
                            source: frame.params?.source ?? 'adb:pixel8',
                        });
                    } else if (frame.method === 'usb.owner') {
                        ws.emitServerFrame({
                            id: frame.id,
                            ok: true,
                            vid: frame.params?.vid,
                            pid: frame.params?.pid,
                            holders: [{ comm: 'adb', pid: 5150 }],
                            recommended_action: 'adb kill-server',
                        });
                    } else if (frame.method === 'adb.kill_server') {
                        ws.emitServerFrame({
                            id: frame.id,
                            ok: true,
                            killed: true,
                            message: 'Local ADB server stopped.',
                        });
                    }
                },
            });
            createdSockets.push(socket);
            return socket;
        };

        configureWsLinkClient({ createWebSocket });

        // 1) wsGetStatus()
        const statusRes = await wsGetStatus();
        expect(statusRes.ok).toBe(true);
        expect(statusRes.version).toBe('1.0.0');
        expect(statusRes.platform).toBe('linux');
        expect(createdSockets[0].url).toBe(WS_LINK_DEFAULT_URL);
        expect(JSON.parse(createdSockets[0].sentFrames[0])).toEqual({
            id: statusRes.id,
            method: 'status',
        });

        // 2) wsGetSources(true)
        const sourcesRes = await wsGetSources(true);
        expect(sourcesRes.ok).toBe(true);
        expect(sourcesRes.sources).toHaveLength(1);
        expect(sourcesRes.sources[0].id).toBe('adb:pixel8');
        expect(JSON.parse(createdSockets[1].sentFrames[0])).toEqual({
            id: sourcesRes.id,
            method: 'sources',
            params: { refresh: true },
        });

        // 3) wsExport('adb:pixel8') — preserves exact unmodified data string
        const exportRes = await wsExport('adb:pixel8');
        expect(exportRes.ok).toBe(true);
        expect(exportRes.data).toBe(rawExportJson);
        expect(exportRes.source).toBe('adb:pixel8');
        expect(JSON.parse(createdSockets[2].sentFrames[0])).toEqual({
            id: exportRes.id,
            method: 'export',
            params: { source: 'adb:pixel8' },
        });

        // 4) wsGetUsbOwner('18d1', '4ee2')
        const ownerRes = await wsGetUsbOwner('18d1', '4ee2');
        expect(ownerRes.ok).toBe(true);
        expect(ownerRes.holders).toEqual([{ comm: 'adb', pid: 5150 }]);
        expect(JSON.parse(createdSockets[3].sentFrames[0])).toEqual({
            id: ownerRes.id,
            method: 'usb.owner',
            params: { vid: '18d1', pid: '4ee2' },
        });

        // 5) wsKillAdbServer()
        const killRes = await wsKillAdbServer();
        expect(killRes.ok).toBe(true);
        expect(killRes.killed).toBe(true);
        expect(JSON.parse(createdSockets[4].sentFrames[0])).toEqual({
            id: killRes.id,
            method: 'adb.kill_server',
        });

        // Verify WsLinkClient class wrapper delegates with bound options
        const client = new WsLinkClient({ createWebSocket });
        const classStatus = await client.getStatus();
        expect(classStatus.ok).toBe(true);
        const classSources = await client.getSources(false);
        expect(classSources.sources).toHaveLength(1);
        const classExport = await client.export('adb:pixel8');
        expect(classExport.data).toBe(rawExportJson);
        const classOwner = await client.getUsbOwner('18d1', '4ee2');
        expect(classOwner.holders).toHaveLength(1);
        const classKill = await client.killAdbServer();
        expect(classKill.killed).toBe(true);
        expect(WS_LINK_TIMEOUT_MS).toBe(3000);
    });

    it('2. rejects with a descriptive error when the server returns {"ok": false, "error": "MethodNotAllowed"} or when the WebSocket connection times out', async () => {
        // Case A: Server returns {"ok": false, "error": "MethodNotAllowed"}
        const errorSocketFactory = (url: string) =>
            new FakeWebSocket(url, {
                onSend: (_raw, _frame, ws) => {
                    ws.emitServerFrame({
                        ok: false,
                        error: 'MethodNotAllowed',
                    });
                },
            });

        await expect(
            wsGetStatus({ createWebSocket: errorSocketFactory }),
        ).rejects.toThrowError(/MethodNotAllowed/);

        try {
            await wsGetStatus({ createWebSocket: errorSocketFactory });
        } catch (err) {
            expect(err).toBeInstanceOf(WsLinkError);
            expect((err as WsLinkError).code).toBe('MethodNotAllowed');
        }

        // Case B: WebSocket connection times out after 3000 ms
        vi.useFakeTimers();
        let hangingSocket: FakeWebSocket | null = null;
        const timeoutPromise = wsGetStatus({
            createWebSocket: (url) => {
                hangingSocket = new FakeWebSocket(url, { autoOpen: false });
                return hangingSocket;
            },
        });

        const assertion = expect(timeoutPromise).rejects.toThrowError(
            /timed out after 3000 ms/i,
        );
        await vi.advanceTimersByTimeAsync(WS_LINK_TIMEOUT_MS + 50);
        await assertion;
        expect(hangingSocket).not.toBeNull();
        expect((hangingSocket as FakeWebSocket | null)?.closed).toBe(true);
    });

    it('3. UsbLinkModal renders "Stop Local ADB Server & Retry USB" when adb-server-owning-interface is diagnosed and invokes wsKillAdbServer()', async () => {
        const sentWsMethods: string[] = [];
        configureWsLinkClient({
            createWebSocket: (url) =>
                new FakeWebSocket(url, {
                    onSend: (_raw, frame, ws) => {
                        sentWsMethods.push(frame.method);
                        ws.emitServerFrame({
                            id: frame.id,
                            ok: true,
                            killed: true,
                        });
                    },
                }),
        });

        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ok: true,
                    holders: [{ comm: 'adb', pid: 4412 }],
                    recommended_action: 'adb kill-server',
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        const claimError = Object.assign(
            new DOMException('Unable to claim interface.', 'NetworkError'),
            {
                kind: 'adb-server-owning-interface',
                vendorId: 0x18d1,
                productId: 0x4ee2,
            },
        );
        const recoveredJson = '{"version":26,"player":"RecoveredAfterKillServer","coins":777}';

        vi.mocked(pullTowerForgeExportViaWebUsb)
            .mockRejectedValueOnce(claimError)
            .mockResolvedValueOnce(recoveredJson);

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });

        // First attempt fails with adb-server-owning-interface
        const { html, elements } = await harness.clickButton('Connect USB Phone');
        expect(html).toContain('data-diagnosis-kind="adb-server-owning-interface"');
        expect(html).toContain('Stop Local ADB Server &amp; Retry USB');
        expect(html).toContain('data-testid="ws-kill-adb-retry-btn"');

        const killRetryBtn = elements.find(
            (el) =>
                el.type === 'button' &&
                el.props['data-testid'] === 'ws-kill-adb-retry-btn',
        );
        expect(killRetryBtn).toBeDefined();

        // Click "Stop Local ADB Server & Retry USB" -> invokes wsKillAdbServer() and retries WebUSB
        const afterKill = await harness.clickButton('ws-kill-adb-retry-btn');
        expect(sentWsMethods).toEqual(['adb.kill_server']);
        expect(pullTowerForgeExportViaWebUsb).toHaveBeenCalledTimes(2);
        expect(onImport).toHaveBeenCalledTimes(1);
        expect(onImport).toHaveBeenCalledWith(recoveredJson);
        expect(afterKill.html).toContain('data-current-stage="done"');
    });

    it('4. UsbLinkModal renders the /downloads/towerforge-link.pyz download link and "Import via Python Companion (/ws)" fallback action', async () => {
        vi.stubGlobal('navigator', {
            userAgent: LINUX_FIREFOX_UA,
        });

        const companionExportJson =
            '{"version":26,"player":"FirefoxCompanionUser","coins":123456789}';
        const sentWsFrames: Array<{ id: string; method: string; params?: Record<string, unknown> }> = [];

        configureWsLinkClient({
            createWebSocket: (url) =>
                new FakeWebSocket(url, {
                    onSend: (_raw, frame, ws) => {
                        sentWsFrames.push(frame);
                        ws.emitServerFrame({
                            id: frame.id,
                            ok: true,
                            data: companionExportJson,
                            source: 'adb:usb-1',
                        });
                    },
                }),
        });

        vi.mocked(pullTowerForgeExportViaWebUsb).mockRejectedValueOnce(
            new Error('WebUSB is not supported in this browser.'),
        );

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });

        // Trigger diagnosis for webusb-unsupported
        const { html, elements } = await harness.clickButton('Connect USB Phone');
        expect(html).toContain('data-diagnosis-kind="webusb-unsupported"');
        expect(html).toContain(`href="${COMPANION_PYZ_DOWNLOAD_URL}"`);
        expect(html).toContain('Download Python Companion (towerforge-link.pyz)');
        expect(html).toContain('data-testid="download-companion-pyz-link"');
        expect(html).toContain('Import via Python Companion (/ws)');
        expect(html).toContain('data-testid="ws-companion-export-btn"');

        const downloadLink = elements.find(
            (el) =>
                el.type === 'a' &&
                el.props['data-testid'] === 'download-companion-pyz-link' &&
                el.props.href === '/downloads/towerforge-link.pyz',
        );
        expect(downloadLink).toBeDefined();

        // Click "Import via Python Companion (/ws)" -> calls wsExport() and passes unmodified data to onImport
        const afterImport = await harness.clickButton('ws-companion-export-btn');
        expect(sentWsFrames).toHaveLength(1);
        expect(sentWsFrames[0].method).toBe('export');
        expect(onImport).toHaveBeenCalledTimes(1);
        expect(onImport).toHaveBeenCalledWith(companionExportJson);
        expect(afterImport.html).toContain('data-current-stage="done"');
    });

    it('5. handles WebSocket transport errors, missing export data, and companion failure notes in UsbLinkModal gracefully', async () => {
        // Missing string data in export response
        await expect(
            wsExport('adb:1', {
                createWebSocket: (url) =>
                    new FakeWebSocket(url, {
                        onSend: (_raw, frame, ws) => {
                            ws.emitServerFrame({ id: frame.id, ok: true, data: 12345 });
                        },
                    }),
            }),
        ).rejects.toThrowError(/did not include a string "data" payload/);

        // Socket error event
        await expect(
            wsGetStatus({
                createWebSocket: (url) =>
                    new FakeWebSocket(url, {
                        onSend: (_raw, _frame, ws) => {
                            ws.emitError('Connection refused');
                        },
                    }),
            }),
        ).rejects.toThrowError(/Connection refused/);

        // UsbLinkModal surfaces status note when companion /ws is unreachable on kill or export
        configureWsLinkClient({
            createWebSocket: (url) =>
                new FakeWebSocket(url, {
                    onSend: (_raw, _frame, ws) => {
                        ws.emitError('Companion offline');
                    },
                }),
        });

        const claimError = Object.assign(
            new DOMException('Unable to claim interface.', 'NetworkError'),
            { kind: 'adb-server-owning-interface' },
        );
        vi.mocked(pullTowerForgeExportViaWebUsb).mockRejectedValueOnce(claimError);

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });
        await harness.clickButton('Connect USB Phone');

        const afterFailedKill = await harness.clickButton('ws-kill-adb-retry-btn');
        expect(afterFailedKill.html).toContain('Could not stop local ADB server via Python Companion (/ws)');

        const afterFailedExport = await harness.clickButton('ws-companion-export-btn');
        expect(afterFailedExport.html).toContain('Could not import via Python Companion (/ws)');
        expect(onImport).not.toHaveBeenCalled();
    });
});
