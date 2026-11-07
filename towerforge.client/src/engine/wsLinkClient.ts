// ============================================================
//  TowerForge Companion — Local Companion WebSocket JSON-RPC Client
//  Connects to the restricted RFC 6455 loopback endpoint at
//  ws://127.0.0.1:47821/ws (towerforge_link/ws.py) with a 3000 ms
//  timeout and per-request correlation IDs (id). Supports allowlisted
//  JSON-RPC methods: status, sources, export, usb.owner, adb.kill_server.
// ============================================================

import type { UsbOwnerHolder } from './usbDiagnose';
import { clearLastUsbConnectState } from './usbLink';

/**
 * Default loopback WebSocket endpoint served by `towerforge-link.pyz` (`REQ-P3-009`).
 */
export const WS_LINK_DEFAULT_URL = 'ws://127.0.0.1:47821/ws';

/**
 * Default connection and RPC response timeout in milliseconds (`3000 ms`).
 */
export const WS_LINK_TIMEOUT_MS = 3000;

/**
 * Download path for the zero-dependency Python zipapp companion (`REQ-P3-010`).
 */
export const COMPANION_PYZ_DOWNLOAD_URL = '/downloads/towerforge-link.pyz';

/**
 * Download path for the standalone plain-text single-file Python companion (`TOWERFORGE-20`).
 */
export const COMPANION_PY_DOWNLOAD_URL = '/downloads/towerforge-link.py';

/**
 * Allowlisted WebSocket JSON-RPC method names supported by `towerforge_link/ws.py`.
 */
export type WsLinkMethod =
    | 'status'
    | 'sources'
    | 'export'
    | 'usb.owner'
    | 'adb.kill_server';

/**
 * Outbound JSON-RPC request frame sent over `ws://127.0.0.1:47821/ws`.
 */
export interface WsJsonRpcRequest<TParams = Record<string, unknown>> {
    id: string;
    method: WsLinkMethod | string;
    params?: TParams;
}

/**
 * Inbound JSON-RPC response frame received from `ws://127.0.0.1:47821/ws`.
 */
export interface WsJsonRpcResponseFrame {
    id?: string | null;
    ok?: boolean;
    error?: string | { code?: string | number; message?: string };
    message?: string;
    result?: Record<string, unknown>;
    [key: string]: unknown;
}

/**
 * Minimal WebSocket message event shape for browser and test environments.
 */
export interface WsMessageEventLike {
    data: unknown;
}

/**
 * Minimal WebSocket close event shape for browser and test environments.
 */
export interface WsCloseEventLike {
    code?: number;
    reason?: string;
    wasClean?: boolean;
}

/**
 * Structural WebSocket interface allowing deterministic unit test mocks without
 * opening real network sockets.
 */
export interface WebSocketLike {
    readonly readyState?: number;
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: WsMessageEventLike) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onclose: ((event: WsCloseEventLike) => void) | null;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener?(type: string, listener: (event: unknown) => void): void;
    removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WsLinkRequestOptions {
    /**
     * WebSocket endpoint URL (defaults to `ws://127.0.0.1:47821/ws`).
     */
    url?: string;
    /**
     * Connection and request timeout in milliseconds (defaults to `3000`).
     */
    timeoutMs?: number;
    /**
     * Explicit correlation ID override for deterministic testing.
     */
    id?: string;
    /**
     * Custom WebSocket factory for dependency injection in unit tests.
     */
    createWebSocket?: WebSocketFactory;
}

export interface WsStatusResponse {
    id: string;
    ok: true;
    version?: string;
    platform?: string;
    adbAvailable?: boolean;
    adb_available?: boolean;
    [key: string]: unknown;
}

export interface WsSourceEntry {
    id: string;
    name?: string;
    kind?: string;
    state?: string;
    modified?: number;
    message?: string;
    [key: string]: unknown;
}

export interface WsSourcesResponse {
    id: string;
    ok: true;
    sources: WsSourceEntry[];
    [key: string]: unknown;
}

export interface WsExportResponse {
    id: string;
    ok: true;
    /**
     * Exact, unmodified raw JSON string of `tool_export.json`.
     */
    data: string;
    source?: unknown;
    modified?: number | null;
    [key: string]: unknown;
}

export interface WsUsbOwnerResponse {
    id: string;
    ok: true;
    vid?: string | null;
    pid?: string | null;
    holders: UsbOwnerHolder[];
    recommended_action?: string | null;
    recommendedAction?: string | null;
    [key: string]: unknown;
}

export interface WsKillAdbResponse {
    id: string;
    ok: true;
    killed?: boolean;
    message?: string;
    [key: string]: unknown;
}

/**
 * Structured error thrown when a WebSocket JSON-RPC call fails, is rejected by
 * the server (`{"ok": false, "error": "..."}`), or exceeds the timeout.
 */
export class WsLinkError extends Error {
    readonly code: string;
    readonly method: string;
    readonly requestId: string;

    constructor(message: string, code: string, method = '', requestId = '') {
        super(message);
        this.name = 'WsLinkError';
        this.code = code;
        this.method = method;
        this.requestId = requestId;
    }
}

let requestSequence = 0;
let defaultClientConfig: WsLinkRequestOptions = {};

/**
 * Generates a unique per-request correlation ID (`id`).
 */
export function nextWsRequestId(): string {
    requestSequence += 1;
    return `tf-ws-${requestSequence}`;
}

/**
 * Configures default options (such as `createWebSocket`, `url`, or `timeoutMs`)
 * for module-level WebSocket helper calls (`wsGetStatus`, `wsExport`, etc.).
 */
export function configureWsLinkClient(config: WsLinkRequestOptions = {}): void {
    defaultClientConfig = { ...config };
}

/**
 * Resets module-level WebSocket client configuration and request counter.
 */
export function resetWsLinkClientConfig(): void {
    defaultClientConfig = {};
    requestSequence = 0;
    clearLastUsbConnectState();
}

function resolveWebSocketFactory(options?: WsLinkRequestOptions): WebSocketFactory {
    if (options?.createWebSocket) {
        return options.createWebSocket;
    }
    if (defaultClientConfig.createWebSocket) {
        return defaultClientConfig.createWebSocket;
    }
    return (url: string): WebSocketLike => {
        const WsCtor = (globalThis as { WebSocket?: new (u: string) => WebSocketLike }).WebSocket;
        if (typeof WsCtor !== 'function') {
            throw new WsLinkError(
                'WebSocket API is not available in this environment.',
                'websocket_unavailable',
            );
        }
        return new WsCtor(url);
    };
}

function decodeEventData(event: unknown): string | null {
    if (typeof event === 'string') {
        return event;
    }
    if (!event || typeof event !== 'object') {
        return null;
    }
    const rawData = (event as WsMessageEventLike).data;
    if (typeof rawData === 'string') {
        return rawData;
    }
    if (rawData instanceof Uint8Array) {
        return new TextDecoder('utf-8').decode(rawData);
    }
    if (typeof ArrayBuffer !== 'undefined' && rawData instanceof ArrayBuffer) {
        return new TextDecoder('utf-8').decode(new Uint8Array(rawData));
    }
    return null;
}

function extractRpcErrorDetails(frame: WsJsonRpcResponseFrame, method: string): {
    code: string;
    message: string;
} {
    const rawError = frame.error;
    const topMessage = typeof frame.message === 'string' ? frame.message.trim() : '';

    if (typeof rawError === 'string' && rawError.trim().length > 0) {
        const code = rawError.trim();
        const message = topMessage
            ? `WebSocket RPC "${method}" failed (${code}): ${topMessage}`
            : `WebSocket RPC "${method}" failed: ${code}`;
        return { code, message };
    }

    if (rawError && typeof rawError === 'object') {
        const errObj = rawError as { code?: string | number; message?: string };
        const code =
            errObj.code !== undefined && errObj.code !== null
                ? String(errObj.code)
                : 'rpc_error';
        const detail =
            typeof errObj.message === 'string' && errObj.message.trim().length > 0
                ? errObj.message.trim()
                : topMessage || code;
        return {
            code,
            message: `WebSocket RPC "${method}" failed (${code}): ${detail}`,
        };
    }

    const fallbackMsg = topMessage || `WebSocket RPC "${method}" returned ok=false.`;
    return {
        code: 'rpc_error',
        message: fallbackMsg,
    };
}

/**
 * Executes a single JSON-RPC call over `ws://127.0.0.1:47821/ws` with a strict
 * connection/response timeout (`3000 ms` by default) and correlation ID matching.
 */
export async function wsCallRpc<
    TResponse extends Record<string, unknown> = Record<string, unknown>,
>(
    method: WsLinkMethod | string,
    params?: Record<string, unknown>,
    options?: WsLinkRequestOptions,
): Promise<TResponse> {
    const url = options?.url ?? defaultClientConfig.url ?? WS_LINK_DEFAULT_URL;
    const timeoutMs =
        options?.timeoutMs ?? defaultClientConfig.timeoutMs ?? WS_LINK_TIMEOUT_MS;
    const requestId = options?.id ?? nextWsRequestId();
    const createWebSocket = resolveWebSocketFactory(options);

    const requestFrame: WsJsonRpcRequest =
        params !== undefined
            ? { id: requestId, method, params }
            : { id: requestId, method };

    return new Promise<TResponse>((resolve, reject) => {
        let ws: WebSocketLike | null = null;
        let settled = false;
        let opened = false;

        const safeCloseSocket = () => {
            if (!ws) {
                return;
            }
            try {
                ws.close(1000, 'rpc_complete');
            } catch {
                // Ignore close errors during cleanup
            }
        };

        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            safeCloseSocket();
            reject(
                new WsLinkError(
                    `WebSocket RPC "${method}" to ${url} timed out after ${timeoutMs} ms.`,
                    'timeout',
                    method,
                    requestId,
                ),
            );
        }, timeoutMs);

        const settleResolve = (value: TResponse) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            safeCloseSocket();
            resolve(value);
        };

        const settleReject = (err: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            safeCloseSocket();
            reject(err);
        };

        const handleOpen = () => {
            if (opened || settled || !ws) {
                return;
            }
            opened = true;
            try {
                ws.send(JSON.stringify(requestFrame));
            } catch (sendErr) {
                const detail = sendErr instanceof Error ? sendErr.message : String(sendErr);
                settleReject(
                    new WsLinkError(
                        `Failed to send WebSocket RPC "${method}" frame: ${detail}`,
                        'send_error',
                        method,
                        requestId,
                    ),
                );
            }
        };

        const handleMessage = (event: unknown) => {
            if (settled) {
                return;
            }
            const rawText = decodeEventData(event);
            if (rawText === null) {
                return;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(rawText);
            } catch {
                settleReject(
                    new WsLinkError(
                        `Received malformed JSON frame from ${url} during "${method}".`,
                        'invalid_json',
                        method,
                        requestId,
                    ),
                );
                return;
            }

            if (!parsed || typeof parsed !== 'object') {
                return;
            }

            const frame = parsed as WsJsonRpcResponseFrame;
            if (
                frame.id !== undefined &&
                frame.id !== null &&
                String(frame.id) !== requestId
            ) {
                // Frame belongs to a different request correlation ID; ignore.
                return;
            }

            const hasError =
                frame.ok === false ||
                (frame.error !== undefined && frame.error !== null && frame.error !== '');
            if (hasError) {
                const { code, message } = extractRpcErrorDetails(frame, method);
                settleReject(new WsLinkError(message, code, method, requestId));
                return;
            }

            const nestedResult =
                frame.result && typeof frame.result === 'object'
                    ? (frame.result as Record<string, unknown>)
                    : {};

            const mergedPayload = {
                ...nestedResult,
                ...frame,
                id: typeof frame.id === 'string' ? frame.id : requestId,
                ok: true as const,
            } as unknown as TResponse;

            settleResolve(mergedPayload);
        };

        const handleError = (event: unknown) => {
            const detail =
                event &&
                typeof event === 'object' &&
                typeof (event as { message?: unknown }).message === 'string'
                    ? `: ${(event as { message: string }).message}`
                    : '';
            settleReject(
                new WsLinkError(
                    `WebSocket connection error on ${url} during "${method}"${detail}`,
                    'connection_error',
                    method,
                    requestId,
                ),
            );
        };

        const handleClose = (event: WsCloseEventLike | unknown) => {
            if (settled) {
                return;
            }
            const reason =
                event &&
                typeof event === 'object' &&
                typeof (event as WsCloseEventLike).reason === 'string' &&
                (event as WsCloseEventLike).reason
                    ? ` (${(event as WsCloseEventLike).reason})`
                    : '';
            settleReject(
                new WsLinkError(
                    `WebSocket connection to ${url} closed before "${method}" response was received${reason}.`,
                    'connection_closed',
                    method,
                    requestId,
                ),
            );
        };

        try {
            ws = createWebSocket(url);
        } catch (err) {
            clearTimeout(timer);
            const detail = err instanceof Error ? err.message : String(err);
            reject(
                new WsLinkError(
                    `Could not open WebSocket connection to ${url}: ${detail}`,
                    'connection_error',
                    method,
                    requestId,
                ),
            );
            return;
        }

        ws.onopen = handleOpen;
        ws.onmessage = handleMessage;
        ws.onerror = handleError;
        ws.onclose = handleClose;

        if (typeof ws.addEventListener === 'function') {
            ws.addEventListener('open', handleOpen);
            ws.addEventListener('message', handleMessage);
            ws.addEventListener('error', handleError);
            ws.addEventListener('close', handleClose);
        }

        if (ws.readyState === 1) {
            queueMicrotask(handleOpen);
        }
    });
}

/**
 * Queries the companion `/ws` `status` method (`{"id": "<id>", "method": "status"}`).
 */
export async function wsGetStatus(
    options?: WsLinkRequestOptions,
): Promise<WsStatusResponse> {
    return wsCallRpc<WsStatusResponse>('status', undefined, options);
}

/**
 * Queries the companion `/ws` `sources` method (`{"id": "<id>", "method": "sources", "params": {"refresh": !!refresh}}`).
 */
export async function wsGetSources(
    refresh?: boolean,
    options?: WsLinkRequestOptions,
): Promise<WsSourcesResponse> {
    const response = await wsCallRpc<WsSourcesResponse>(
        'sources',
        { refresh: !!refresh },
        options,
    );
    return {
        ...response,
        sources: Array.isArray(response.sources) ? response.sources : [],
    };
}

/**
 * Pulls `tool_export.json` via the companion `/ws` `export` method
 * (`{"id": "<id>", "method": "export", "params": {"source": sourceId}}`)
 * and preserves the exact, unmodified `data` JSON string.
 */
export async function wsExport(
    sourceId?: string,
    options?: WsLinkRequestOptions,
): Promise<WsExportResponse> {
    const response = await wsCallRpc<Record<string, unknown>>(
        'export',
        { source: sourceId },
        options,
    );

    const rawData =
        typeof response.data === 'string'
            ? response.data
            : typeof response.text === 'string'
              ? response.text
              : null;

    if (rawData === null) {
        throw new WsLinkError(
            'WebSocket "export" response did not include a string "data" payload.',
            'invalid_payload',
            'export',
            String(response.id ?? ''),
        );
    }

    return {
        ...response,
        id: String(response.id ?? ''),
        ok: true,
        data: rawData,
        ...(response.source !== undefined ? { source: response.source } : {}),
    };
}

/**
 * Queries same-UID USB interface holders via the companion `/ws` `usb.owner` method
 * (`{"id": "<id>", "method": "usb.owner", "params": { vid, pid }}`).
 */
export async function wsGetUsbOwner(
    vid?: string,
    pid?: string,
    options?: WsLinkRequestOptions,
): Promise<WsUsbOwnerResponse> {
    const response = await wsCallRpc<WsUsbOwnerResponse>(
        'usb.owner',
        { vid, pid },
        options,
    );
    return {
        ...response,
        holders: Array.isArray(response.holders) ? response.holders : [],
    };
}

/**
 * Stops the local `adb` server via the companion `/ws` `adb.kill_server` method
 * (`{"id": "<id>", "method": "adb.kill_server"}`) so WebUSB can claim interface `0xFF/0x42/0x01`.
 */
export async function wsKillAdbServer(
    options?: WsLinkRequestOptions,
): Promise<WsKillAdbResponse> {
    return wsCallRpc<WsKillAdbResponse>('adb.kill_server', undefined, options);
}

/**
 * Object-oriented wrapper around the `/ws` JSON-RPC methods with bound configuration.
 */
export class WsLinkClient {
    readonly #options: WsLinkRequestOptions;

    constructor(options: WsLinkRequestOptions = {}) {
        this.#options = { ...options };
    }

    getStatus(overrides?: WsLinkRequestOptions): Promise<WsStatusResponse> {
        return wsGetStatus({ ...this.#options, ...overrides });
    }

    getSources(
        refresh?: boolean,
        overrides?: WsLinkRequestOptions,
    ): Promise<WsSourcesResponse> {
        return wsGetSources(refresh, { ...this.#options, ...overrides });
    }

    export(
        sourceId?: string,
        overrides?: WsLinkRequestOptions,
    ): Promise<WsExportResponse> {
        return wsExport(sourceId, { ...this.#options, ...overrides });
    }

    getUsbOwner(
        vid?: string,
        pid?: string,
        overrides?: WsLinkRequestOptions,
    ): Promise<WsUsbOwnerResponse> {
        return wsGetUsbOwner(vid, pid, { ...this.#options, ...overrides });
    }

    killAdbServer(overrides?: WsLinkRequestOptions): Promise<WsKillAdbResponse> {
        return wsKillAdbServer({ ...this.#options, ...overrides });
    }
}
