// ============================================================
//  TowerForge Companion — WebUSB ADB State Machine & Sync Pull Engine
//  Connects directly from a Chromium browser to a USB-attached Android
//  phone via @yume-chan/adb, manages IndexedDB vs. ephemeral in-memory
//  RSA-2048 credentials, and pulls tool_export.json strictly over the
//  ADB Sync file-transfer channel (stat + read) with an 8 MiB bound.
// ============================================================

import type { AdbCredentialStore, AdbPrivateKey } from '@yume-chan/adb';
import { setAutoImportOn } from './autoImport';
import { rememberedSource, type LinkResult } from './linkClient';
import { loadTangoWebUsb, type TangoWebUsbBundle } from './usbTangoLoader';

export const LAST_USB_CONNECT_KEY = 'tc_usb_last_connect';

export type LastUsbConnectMethod = 'webusb' | 'python' | 'link';

export interface LastUsbConnectState {
    method: LastUsbConnectMethod;
    lastFailed: boolean;
}

let memoryLastUsbConnectState: LastUsbConnectState | null = null;

export function getLastUsbConnectState(): LastUsbConnectState | null {
    try {
        const storage = globalThis.localStorage;
        if (storage && typeof storage.getItem === 'function') {
            const raw = storage.getItem(LAST_USB_CONNECT_KEY);
            if (!raw) {
                memoryLastUsbConnectState = null;
                return null;
            }
            const parsed = JSON.parse(raw) as Partial<LastUsbConnectState> | null;
            if (
                parsed &&
                typeof parsed === 'object' &&
                (parsed.method === 'webusb' || parsed.method === 'python' || parsed.method === 'link') &&
                typeof parsed.lastFailed === 'boolean'
            ) {
                memoryLastUsbConnectState = {
                    method: parsed.method,
                    lastFailed: parsed.lastFailed,
                };
                return { ...memoryLastUsbConnectState };
            }
            return null;
        }
    } catch {
        // Fall back to in-memory state when localStorage is unavailable or restricted
    }
    return memoryLastUsbConnectState ? { ...memoryLastUsbConnectState } : null;
}

export function saveLastUsbConnectState(state: LastUsbConnectState): void {
    const normalized: LastUsbConnectState = {
        method: state.method,
        lastFailed: Boolean(state.lastFailed),
    };
    memoryLastUsbConnectState = normalized;
    try {
        const storage = globalThis.localStorage;
        if (storage && typeof storage.setItem === 'function') {
            storage.setItem(LAST_USB_CONNECT_KEY, JSON.stringify(normalized));
        }
    } catch {
        // Ignore storage write errors in restricted environments
    }
}

export function clearLastUsbConnectState(): void {
    memoryLastUsbConnectState = null;
    try {
        const storage = globalThis.localStorage;
        if (storage && typeof storage.removeItem === 'function') {
            storage.removeItem(LAST_USB_CONNECT_KEY);
        }
    } catch {
        // Ignore storage remove errors in restricted environments
    }
}

/**
 * Hard 8 MiB ceiling enforced both at `sync.stat()` time and during
 * incremental chunk streaming (`REQ-P2-005`, `REQ-SEC-008`).
 */
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024; // 8_388_608 bytes

/**
 * IndexedDB database name used by `@yume-chan/adb-credential-web`.
 */
export const TANGO_INDEXEDDB_NAME = 'Tango';

/**
 * Default key label suffix sent in the ADB public key banner.
 */
export const TOWERFORGE_KEY_APP_NAME = 'TowerForge';

/**
 * Ordered candidate paths on Android external storage where The Tower
 * writes `tool_export.json` across Unity / Android versions (`REQ-P2-004`).
 */
export const CANDIDATE_EXPORT_PATHS = [
    '/sdcard/Android/data/com.TechTreeGames.TheTower/files/TheTower/tool_export.json',
    '/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json',
    '/storage/emulated/0/Android/data/com.TechTreeGames.TheTower/files/TheTower/tool_export.json',
    '/storage/emulated/0/Android/data/com.TechTreeGames.TheTower/files/tool_export.json',
    '/sdcard/Download/tool_export.json',
] as const;

/**
 * Deterministic ordered stages of the WebUSB connection and sync lifecycle (`REQ-P2-002`).
 */
export const USB_CONNECT_STAGES = [
    'idle',
    'requesting-device',
    'claiming-interface',
    'authenticating-rsa',
    'syncing-files',
    'validating-payload',
    'done',
    'error',
] as const;

export type UsbConnectStage = (typeof USB_CONNECT_STAGES)[number];

/**
 * Thrown when `sync.stat(path).size` or accumulated `sync.read(path)` chunks
 * exceed `MAX_EXPORT_BYTES` (`8_388_608` bytes).
 */
export class PayloadTooLargeError extends Error {
    readonly actualBytes: number;
    readonly maxBytes: number;
    readonly path: string;
    readonly usbStage: UsbConnectStage = 'syncing-files';

    constructor(actualBytes: number, maxBytes: number = MAX_EXPORT_BYTES, path = '') {
        super(
            `Export payload size (${actualBytes} bytes) exceeds maximum allowed limit (${maxBytes} bytes)${path ? ` at ${path}` : ''}.`,
        );
        this.name = 'PayloadTooLargeError';
        this.actualBytes = actualBytes;
        this.maxBytes = maxBytes;
        this.path = path;
    }
}

/**
 * Thrown when none of the candidate paths on the connected Android device
 * contain a readable `tool_export.json` file.
 */
export class ExportFileNotFoundError extends Error {
    readonly probedPaths: readonly string[];
    readonly code = 'export-file-not-found';
    readonly usbStage: UsbConnectStage = 'syncing-files';

    constructor(probedPaths: readonly string[] = CANDIDATE_EXPORT_PATHS) {
        super(
            `tool_export.json was not found on the connected device after probing: ${probedPaths.join(', ')}`,
        );
        this.name = 'ExportFileNotFoundError';
        this.probedPaths = probedPaths;
    }
}

/**
 * Deterministic state machine tracking `UsbConnectStage` transitions and history.
 */
export class UsbLinkStateMachine {
    #stage: UsbConnectStage = 'idle';
    readonly #history: UsbConnectStage[] = ['idle'];
    readonly #listeners = new Set<(stage: UsbConnectStage) => void>();

    get stage(): UsbConnectStage {
        return this.#stage;
    }

    get history(): readonly UsbConnectStage[] {
        return [...this.#history];
    }

    transition(nextStage: UsbConnectStage): void {
        this.#stage = nextStage;
        if (this.#history[this.#history.length - 1] !== nextStage) {
            this.#history.push(nextStage);
        }
        for (const listener of this.#listeners) {
            listener(nextStage);
        }
    }

    reset(): void {
        this.#stage = 'idle';
        this.#history.length = 0;
        this.#history.push('idle');
    }

    subscribe(listener: (stage: UsbConnectStage) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }
}

interface ActiveWebUsbSession {
    adb: AdbClientLike;
    serial: string;
    deviceName: string;
    lastPath?: string;
    rawDevice?: unknown;
}

const activeEphemeralStores = new Set<EphemeralMemoryCredentialStore>();
let cachedPersistentCredentialStore: AdbCredentialStore | null = null;
let activeWebUsbSession: ActiveWebUsbSession | null = null;
const boundUsbManagers = new WeakSet<object>();

function bindUsbDisconnectListener(): void {
    const usb = (
        globalThis.navigator as
            | { usb?: { addEventListener?: (type: string, listener: (ev: unknown) => void) => void } }
            | undefined
    )?.usb;
    if (
        usb &&
        typeof usb === 'object' &&
        typeof usb.addEventListener === 'function' &&
        !boundUsbManagers.has(usb)
    ) {
        boundUsbManagers.add(usb);
        usb.addEventListener('disconnect', (ev: unknown) => {
            if (!activeWebUsbSession) {
                setAutoImportOn(false);
                return;
            }
            const disconnectedDevice = (ev as { device?: { serialNumber?: string } } | null)?.device;
            if (
                !disconnectedDevice ||
                !disconnectedDevice.serialNumber ||
                disconnectedDevice.serialNumber === activeWebUsbSession.serial ||
                disconnectedDevice === activeWebUsbSession.rawDevice
            ) {
                void closeWebUsbSession(true);
            }
        });
    }
}

/**
 * Ephemeral in-memory `AdbCredentialStore` (`rememberDevice=false`).
 * Generates a 2048-bit RSA keypair via WebCrypto and retains the key
 * exclusively in JS heap memory for the single session without touching
 * `indexedDB` or `localStorage` (`REQ-P2-003`, `REQ-SEC-009`).
 */
export class EphemeralMemoryCredentialStore implements AdbCredentialStore {
    readonly #appName: string;
    readonly #keys: AdbPrivateKey[] = [];

    constructor(appName: string = TOWERFORGE_KEY_APP_NAME) {
        this.#appName = appName;
        activeEphemeralStores.add(this);
    }

    async generateKey(): Promise<AdbPrivateKey> {
        const subtle = globalThis.crypto?.subtle;
        if (!subtle) {
            throw new Error('WebCrypto SubtleCrypto API is unavailable in this environment.');
        }

        const keyPair = await subtle.generateKey(
            {
                name: 'RSASSA-PKCS1-v1_5',
                modulusLength: 2048,
                publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
                hash: 'SHA-1',
            },
            true,
            ['sign', 'verify'],
        );

        const pkcs8Buffer = await subtle.exportKey('pkcs8', keyPair.privateKey);
        const privateKeyBytes = new Uint8Array(pkcs8Buffer);
        const hostname =
            typeof globalThis.location?.hostname === 'string' && globalThis.location.hostname.length > 0
                ? globalThis.location.hostname
                : 'localhost';

        const entry: AdbPrivateKey = {
            buffer: privateKeyBytes,
            name: `${this.#appName}@${hostname}`,
        };

        this.clear();
        this.#keys.push(entry);
        activeEphemeralStores.add(this);
        return entry;
    }

    async *iterateKeys(): AsyncGenerator<AdbPrivateKey, void, void> {
        for (const key of this.#keys) {
            yield key;
        }
    }

    /**
     * Zeroes out all in-memory PKCS#8 private key byte buffers and empties the store.
     */
    clear(): void {
        for (const key of this.#keys) {
            key.buffer.fill(0);
        }
        this.#keys.length = 0;
    }

    getKeyCount(): number {
        return this.#keys.length;
    }
}

/**
 * Resolves the appropriate `AdbCredentialStore` based on `rememberDevice`:
 * - `true` (default): IndexedDB-backed `AdbWebCryptoCredentialManager` (`@yume-chan/adb-credential-web`)
 * - `false`: RAM-only `EphemeralMemoryCredentialStore`
 */
export function resolveUsbCredentialStore(
    rememberDevice: boolean,
    tango: Pick<TangoWebUsbBundle, 'AdbWebCryptoCredentialManager'>,
    appName: string = TOWERFORGE_KEY_APP_NAME,
): AdbCredentialStore {
    if (!rememberDevice) {
        return new EphemeralMemoryCredentialStore(appName);
    }
    if (!cachedPersistentCredentialStore) {
        cachedPersistentCredentialStore = new tango.AdbWebCryptoCredentialManager(appName);
    }
    return cachedPersistentCredentialStore;
}

/**
 * Closes the active WebUSB ADB session (if any) and releases the USB interface (`REQ-P2-007`).
 * By default (`turnOffAutoImport = true`), also turns Auto-Import OFF when disconnected.
 */
export async function closeWebUsbSession(turnOffAutoImport = true): Promise<void> {
    const session = activeWebUsbSession;
    activeWebUsbSession = null;
    if (turnOffAutoImport) {
        setAutoImportOn(false);
    }
    if (session) {
        try {
            await session.adb.close();
        } catch {
            // Ensure transport close errors do not mask session teardown
        }
    }
}

/**
 * Returns `true` when an authenticated WebUSB ADB session is currently open (`REQ-P2-007`).
 */
export function hasActiveWebUsbSession(): boolean {
    return activeWebUsbSession !== null;
}

/**
 * Returns the display name of the currently connected WebUSB device, or `null`.
 */
export function getActiveWebUsbDeviceName(): string | null {
    return activeWebUsbSession?.deviceName ?? null;
}

/**
 * Deletes the persistent IndexedDB ADB credential database (`Tango`), closes any
 * active WebUSB session, and zeroes/clears all cached and ephemeral credential stores (`REQ-P2-003`, `REQ-SEC-009`).
 */
export async function forgetUsbKeys(
    idbFactory?: IDBFactory | null,
    databaseName: string = TANGO_INDEXEDDB_NAME,
): Promise<void> {
    await closeWebUsbSession(true);
    clearLastUsbConnectState();
    cachedPersistentCredentialStore = null;

    for (const store of activeEphemeralStores) {
        store.clear();
    }
    activeEphemeralStores.clear();

    const idb = idbFactory !== undefined ? idbFactory : globalThis.indexedDB;
    if (!idb || typeof idb.deleteDatabase !== 'function') {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        let request: IDBOpenDBRequest | undefined;
        try {
            request = idb.deleteDatabase(databaseName);
        } catch (err) {
            reject(err);
            return;
        }

        if (!request || typeof request !== 'object') {
            resolve();
            return;
        }

        let settled = false;
        const finish = (fn: () => void) => {
            if (!settled) {
                settled = true;
                fn();
            }
        };

        request.onsuccess = () => finish(resolve);
        request.onblocked = () => finish(resolve);
        request.onerror = () =>
            finish(() => reject(request?.error ?? new Error(`Failed to delete IndexedDB ${databaseName}`)));
    });
}

/**
 * Structural interfaces matching `@yume-chan/adb` sync and device primitives
 * so unit tests can inject deterministic fakes without hardware dependencies.
 */
export interface AdbSyncStatLike {
    size: bigint | number;
    mtime?: bigint | number;
    mode?: number;
    type?: number;
}

export interface ReadableChunkReaderLike {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel?(reason?: unknown): Promise<void>;
    releaseLock?(): void;
}

export interface ReadableByteStreamLike {
    getReader?(): ReadableChunkReaderLike;
    [Symbol.asyncIterator]?(): AsyncIterator<Uint8Array>;
}

export interface AdbSyncClientLike {
    stat(path: string): Promise<AdbSyncStatLike>;
    read(path: string): ReadableByteStreamLike;
    dispose(): Promise<void> | void;
}

export interface AdbClientLike {
    sync(): Promise<AdbSyncClientLike>;
    close(): Promise<void> | void;
}

export interface UsbDeviceInfoLike {
    serial?: string;
    name?: string;
    raw?: {
        vendorId?: number;
        productId?: number;
        productName?: string;
        serialNumber?: string;
    };
    connect(): Promise<unknown>;
}

export interface UsbDeviceManagerLike {
    requestDevice(options?: unknown): Promise<UsbDeviceInfoLike | undefined>;
    getDevices?(): Promise<UsbDeviceInfoLike[]>;
}

export interface UsbPullMetadata {
    path: string;
    byteLength: number;
    mtime: number | null;
    serial: string;
    deviceName: string;
}

export interface UsbPullOptions {
    /**
     * When `true` (default), persists the RSA keypair in IndexedDB via `AdbWebCryptoCredentialManager`.
     * When `false`, uses `EphemeralMemoryCredentialStore` in JS heap only.
     */
    rememberDevice?: boolean;
    /**
     * When `true`, keeps the authenticated `Adb` client open in `activeWebUsbSession`
     * after a successful pull so `AutoImport` can poll over WebUSB and the browser
     * holds the USB interface lock against host daemons (`REQ-P2-007`).
     * Defaults to `false` for one-shot programmatic calls.
     */
    keepConnectionOpen?: boolean;
    /**
     * Optional callback invoked deterministically on every `UsbConnectStage` transition.
     */
    onStageChange?: (stage: UsbConnectStage) => void;
    /**
     * Optional callback receiving file/device metadata once the export is pulled.
     */
    onMetadata?: (metadata: UsbPullMetadata) => void;
    /**
     * Optional state machine instance to drive.
     */
    stateMachine?: UsbLinkStateMachine;
    /**
     * Optional override for candidate file paths to probe on the device.
     */
    candidatePaths?: readonly string[];
    /**
     * Optional override for maximum allowed byte size (defaults to `MAX_EXPORT_BYTES` = 8 MiB).
     */
    maxBytes?: number;
    /**
     * Optional custom credential store override.
     */
    credentialStore?: AdbCredentialStore;
    /**
     * Optional injected WebUSB device manager (for testing or custom filters).
     */
    deviceManager?: UsbDeviceManagerLike | null;
    /**
     * Optional injected Tango module loader (for testing).
     */
    loadTango?: () => Promise<TangoWebUsbBundle>;
    /**
     * Optional factory override for authenticating and constructing the `Adb` client.
     */
    authenticateAdb?: (params: {
        serial: string;
        connection: unknown;
        credentialStore: AdbCredentialStore;
        tango: TangoWebUsbBundle;
    }) => Promise<AdbClientLike>;
}

/**
 * Reads a `ReadableStream<Uint8Array>` (or async iterable of `Uint8Array`) while
 * strictly enforcing `maxBytes` prior to and during chunk accumulation.
 */
export async function readBoundedSyncStream(
    stream: ReadableByteStreamLike,
    maxBytes: number = MAX_EXPORT_BYTES,
    path = '',
): Promise<{ rawText: string; byteLength: number }> {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    if (typeof stream.getReader === 'function') {
        const reader = stream.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                if (value && value.byteLength > 0) {
                    totalBytes += value.byteLength;
                    if (totalBytes > maxBytes) {
                        await reader.cancel?.(new PayloadTooLargeError(totalBytes, maxBytes, path)).catch(() => undefined);
                        throw new PayloadTooLargeError(totalBytes, maxBytes, path);
                    }
                    chunks.push(value);
                }
            }
        } finally {
            reader.releaseLock?.();
        }
    } else if (typeof stream[Symbol.asyncIterator] === 'function') {
        for await (const chunk of stream as AsyncIterable<Uint8Array>) {
            if (chunk && chunk.byteLength > 0) {
                totalBytes += chunk.byteLength;
                if (totalBytes > maxBytes) {
                    throw new PayloadTooLargeError(totalBytes, maxBytes, path);
                }
                chunks.push(chunk);
            }
        }
    } else {
        throw new Error('Unsupported ADB sync read stream implementation.');
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }

    const decoder = new TextDecoder('utf-8');
    const rawText = decoder.decode(combined);
    return { rawText, byteLength: totalBytes };
}

function attachUsbErrorMetadata(
    err: unknown,
    stage: UsbConnectStage,
    device?: UsbDeviceInfoLike,
): unknown {
    if (err && typeof err === 'object') {
        const target = err as Record<string, unknown>;
        if (target.usbStage === undefined) {
            target.usbStage = stage;
        }
        if (device?.raw?.vendorId !== undefined && target.vendorId === undefined) {
            target.vendorId = device.raw.vendorId;
        }
        if (device?.raw?.productId !== undefined && target.productId === undefined) {
            target.productId = device.raw.productId;
        }
        if (device?.serial !== undefined && target.serial === undefined) {
            target.serial = device.serial;
        }
    }
    return err;
}

function isUsbTransportDisconnectError(err: unknown): boolean {
    if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
        return true;
    }
    const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
    return /disconnect|transfer(In|Out)|networkerror|device.*(lost|closed|unavailable)|interface.*claim/i.test(
        msg,
    );
}

/**
 * Connects to a USB-attached Android device via WebUSB ADB and pulls `tool_export.json`
 * strictly over the ADB Sync protocol (`stat` + `read`), validating the JSON payload
 * and returning the exact, unmodified raw JSON string (`REQ-P2-002`..`REQ-P2-007`).
 */
export async function pullTowerForgeExportViaWebUsb(
    options: UsbPullOptions = {},
): Promise<string> {
    const {
        rememberDevice = true,
        keepConnectionOpen = false,
        onStageChange,
        onMetadata,
        stateMachine = new UsbLinkStateMachine(),
        candidatePaths = CANDIDATE_EXPORT_PATHS,
        maxBytes = MAX_EXPORT_BYTES,
        credentialStore: customCredentialStore,
        deviceManager: injectedDeviceManager,
        loadTango = loadTangoWebUsb,
        authenticateAdb,
    } = options;

    let currentStage: UsbConnectStage = 'idle';
    const emitStage = (stage: UsbConnectStage) => {
        currentStage = stage;
        stateMachine.transition(stage);
        onStageChange?.(stage);
    };

    let selectedDevice: UsbDeviceInfoLike | undefined;
    let adb: AdbClientLike | null = null;
    let sync: AdbSyncClientLike | null = null;
    let retainedInSession = false;

    try {
        // Release any prior cached WebUSB session before requesting/opening a fresh connection
        if (activeWebUsbSession) {
            await closeWebUsbSession(false);
        }

        // Stage 1: idle -> requesting-device
        emitStage('idle');
        emitStage('requesting-device');

        if (typeof window !== 'undefined' && window.isSecureContext === false) {
            throw new DOMException(
                'WebUSB requires a secure context (HTTPS or localhost).',
                'SecurityError',
            );
        }

        const tango = await loadTango();
        const deviceManager: UsbDeviceManagerLike | undefined =
            injectedDeviceManager ??
            tango.AdbDaemonWebUsbDeviceManager.BROWSER ??
            (typeof globalThis.navigator !== 'undefined' && 'usb' in globalThis.navigator && globalThis.navigator.usb
                ? new tango.AdbDaemonWebUsbDeviceManager(globalThis.navigator.usb)
                : undefined);

        if (!deviceManager) {
            throw new Error('WebUSB is not supported in this browser.');
        }

        selectedDevice = await deviceManager.requestDevice();
        if (!selectedDevice) {
            throw new DOMException('No device selected', 'NotFoundError');
        }

        // Stage 2: claiming-interface
        emitStage('claiming-interface');
        const connection = await selectedDevice.connect();

        // Stage 3: authenticating-rsa
        emitStage('authenticating-rsa');
        const credentialStore =
            customCredentialStore ?? resolveUsbCredentialStore(rememberDevice, tango);
        const serial = selectedDevice.serial ?? selectedDevice.raw?.serialNumber ?? 'usb-device';

        if (authenticateAdb) {
            adb = await authenticateAdb({
                serial,
                connection,
                credentialStore,
                tango,
            });
        } else {
            const transport = await tango.AdbDaemonTransport.authenticate({
                serial,
                connection: connection as Parameters<
                    typeof tango.AdbDaemonTransport.authenticate
                >[0]['connection'],
                credentialStore,
            });
            adb = new tango.Adb(transport) as unknown as AdbClientLike;
        }

        // Stage 4: syncing-files
        emitStage('syncing-files');
        sync = await adb.sync();

        let pulledRawJson: string | null = null;
        let pulledPath = '';
        let pulledByteLength = 0;
        let pulledMtime: number | null = null;

        for (const candidatePath of candidatePaths) {
            let statResult: AdbSyncStatLike;
            try {
                statResult = await sync.stat(candidatePath);
            } catch (statErr) {
                if (statErr instanceof PayloadTooLargeError) {
                    throw statErr;
                }
                // File missing or inaccessible at this candidate path (e.g. ENOENT); probe next path.
                continue;
            }

            const reportedSize = Number(statResult.size);
            if (!Number.isFinite(reportedSize) || reportedSize > maxBytes) {
                throw new PayloadTooLargeError(reportedSize, maxBytes, candidatePath);
            }

            const readStream = sync.read(candidatePath);
            const { rawText, byteLength } = await readBoundedSyncStream(
                readStream,
                maxBytes,
                candidatePath,
            );

            pulledRawJson = rawText;
            pulledPath = candidatePath;
            pulledByteLength = byteLength;
            pulledMtime =
                statResult.mtime !== undefined && Number.isFinite(Number(statResult.mtime))
                    ? Number(statResult.mtime)
                    : null;
            break;
        }

        if (pulledRawJson === null) {
            throw new ExportFileNotFoundError(candidatePaths);
        }

        // Stage 5: validating-payload
        emitStage('validating-payload');
        JSON.parse(pulledRawJson);

        const deviceName =
            selectedDevice.name ??
            selectedDevice.raw?.productName ??
            'Android USB Device';

        onMetadata?.({
            path: pulledPath,
            byteLength: pulledByteLength,
            mtime: pulledMtime,
            serial,
            deviceName,
        });

        if (keepConnectionOpen && adb) {
            activeWebUsbSession = {
                adb,
                serial,
                deviceName,
                lastPath: pulledPath,
                rawDevice: selectedDevice.raw,
            };
            retainedInSession = true;
            bindUsbDisconnectListener();
        }

        saveLastUsbConnectState({ method: 'webusb', lastFailed: false });
        setAutoImportOn(true);

        // Stage 6: done
        emitStage('done');
        return pulledRawJson;
    } catch (err) {
        saveLastUsbConnectState({ method: 'webusb', lastFailed: true });
        setAutoImportOn(false);
        emitStage('error');
        throw attachUsbErrorMetadata(err, currentStage, selectedDevice);
    } finally {
        if (sync) {
            try {
                await sync.dispose();
            } catch {
                // Ensure sync disposal errors do not mask primary outcome or prevent adb.close()
            }
        }
        if (adb && !retainedInSession) {
            try {
                await adb.close();
            } catch {
                // Ensure transport close errors do not mask primary outcome
            }
        }
    }
}

/**
 * Polls `tool_export.json` over an active WebUSB session (or silently reconnects via
 * `deviceManager.getDevices()` using stored IndexedDB RSA credentials when no user
 * gesture is required) for `AutoImport` (`REQ-P2-007`, `REQ-AUTO-001`).
 *
 * Uses `sync.stat(path).mtime` to return `{ ok: false, reason: 'unchanged' }` when
 * `mtime <= Math.floor(newerThan)` without streaming the file payload.
 */
export async function pollWebUsbAutoExport(
    newerThan?: number,
    options: UsbPullOptions = {},
): Promise<LinkResult> {
    if (!activeWebUsbSession) {
        if (typeof window !== 'undefined' && window.isSecureContext === false) {
            return { ok: false, reason: 'unreachable' };
        }

        let connectedAdb: AdbClientLike | null = null;
        try {
            const loadTango = options.loadTango ?? loadTangoWebUsb;
            const tango = await loadTango();
            const deviceManager: UsbDeviceManagerLike | undefined =
                options.deviceManager ??
                tango.AdbDaemonWebUsbDeviceManager.BROWSER ??
                (typeof globalThis.navigator !== 'undefined' &&
                'usb' in globalThis.navigator &&
                globalThis.navigator.usb
                    ? new tango.AdbDaemonWebUsbDeviceManager(globalThis.navigator.usb)
                    : undefined);

            if (!deviceManager || typeof deviceManager.getDevices !== 'function') {
                return { ok: false, reason: 'unreachable' };
            }

            const devices = await deviceManager.getDevices();
            if (!Array.isArray(devices) || devices.length === 0) {
                return { ok: false, reason: 'unreachable' };
            }

            const remembered = rememberedSource();
            const preferredSerial =
                remembered && remembered.startsWith('webusb:')
                    ? remembered.slice('webusb:'.length)
                    : null;
            const targetDevice =
                (preferredSerial
                    ? devices.find(
                          (d) => (d.serial ?? d.raw?.serialNumber) === preferredSerial,
                      )
                    : undefined) ?? devices[0];

            const connection = await targetDevice.connect();
            const credentialStore =
                options.credentialStore ??
                resolveUsbCredentialStore(options.rememberDevice ?? true, tango);
            const serial =
                targetDevice.serial ?? targetDevice.raw?.serialNumber ?? 'usb-device';
            const deviceName =
                targetDevice.name ??
                targetDevice.raw?.productName ??
                'Android USB Device';

            if (options.authenticateAdb) {
                connectedAdb = await options.authenticateAdb({
                    serial,
                    connection,
                    credentialStore,
                    tango,
                });
            } else {
                const transport = await tango.AdbDaemonTransport.authenticate({
                    serial,
                    connection: connection as Parameters<
                        typeof tango.AdbDaemonTransport.authenticate
                    >[0]['connection'],
                    credentialStore,
                });
                connectedAdb = new tango.Adb(transport) as unknown as AdbClientLike;
            }

            activeWebUsbSession = {
                adb: connectedAdb,
                serial,
                deviceName,
                rawDevice: targetDevice.raw,
            };
            bindUsbDisconnectListener();
        } catch {
            if (connectedAdb) {
                try {
                    await connectedAdb.close();
                } catch {
                    // Ignore close error on failed silent reconnect
                }
            }
            activeWebUsbSession = null;
            return { ok: false, reason: 'unreachable' };
        }
    }

    const session = activeWebUsbSession;
    const maxBytes = options.maxBytes ?? MAX_EXPORT_BYTES;
    const basePaths = options.candidatePaths ?? CANDIDATE_EXPORT_PATHS;
    const orderedPaths = session.lastPath
        ? [session.lastPath, ...basePaths.filter((p) => p !== session.lastPath)]
        : [...basePaths];

    let sync: AdbSyncClientLike | null = null;
    try {
        sync = await session.adb.sync();

        for (const candidatePath of orderedPaths) {
            let statResult: AdbSyncStatLike;
            try {
                statResult = await sync.stat(candidatePath);
            } catch (statErr) {
                if (
                    statErr instanceof PayloadTooLargeError ||
                    isUsbTransportDisconnectError(statErr)
                ) {
                    throw statErr;
                }
                continue;
            }

            const reportedSize = Number(statResult.size);
            if (!Number.isFinite(reportedSize) || reportedSize > maxBytes) {
                throw new PayloadTooLargeError(reportedSize, maxBytes, candidatePath);
            }

            const mtime =
                statResult.mtime !== undefined && Number.isFinite(Number(statResult.mtime))
                    ? Number(statResult.mtime)
                    : null;

            if (newerThan !== undefined && mtime !== null && mtime <= Math.floor(newerThan)) {
                session.lastPath = candidatePath;
                saveLastUsbConnectState({ method: 'webusb', lastFailed: false });
                setAutoImportOn(true);
                return {
                    ok: false,
                    reason: 'unchanged',
                    modified: mtime,
                };
            }

            const readStream = sync.read(candidatePath);
            const { rawText, byteLength } = await readBoundedSyncStream(
                readStream,
                maxBytes,
                candidatePath,
            );
            JSON.parse(rawText);

            session.lastPath = candidatePath;
            saveLastUsbConnectState({ method: 'webusb', lastFailed: false });
            setAutoImportOn(true);
            options.onMetadata?.({
                path: candidatePath,
                byteLength,
                mtime,
                serial: session.serial,
                deviceName: session.deviceName,
            });

            return {
                ok: true,
                text: rawText,
                modified: mtime,
                source: `${session.deviceName} (USB)`,
                sourceId: `webusb:${session.serial}`,
            };
        }

        return {
            ok: false,
            reason: 'problem',
            code: 'no_export',
            message: 'The Tower hasn’t exported your data yet on this USB phone.',
        };
    } catch (err) {
        if (err instanceof PayloadTooLargeError) {
            return {
                ok: false,
                reason: 'problem',
                code: 'too_large',
                message: err.message,
            };
        }
        if (err instanceof SyntaxError) {
            return {
                ok: false,
                reason: 'problem',
                code: 'invalid_json',
                message: 'The export file on your USB phone didn’t read as valid JSON.',
            };
        }
        await closeWebUsbSession();
        return { ok: false, reason: 'unreachable' };
    } finally {
        if (sync) {
            try {
                await sync.dispose();
            } catch {
                // Ignore sync dispose errors
            }
        }
    }
}
