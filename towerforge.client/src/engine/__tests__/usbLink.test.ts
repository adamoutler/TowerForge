import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAutoImportOn, setAutoImportOn } from '../autoImport';
import usbLinkSource from '../usbLink.ts?raw';
import {
    CANDIDATE_EXPORT_PATHS,
    clearLastUsbConnectState,
    closeWebUsbSession,
    EphemeralMemoryCredentialStore,
    ExportFileNotFoundError,
    forgetUsbKeys,
    getActiveWebUsbDeviceName,
    getLastUsbConnectState,
    hasActiveWebUsbSession,
    MAX_EXPORT_BYTES,
    PayloadTooLargeError,
    pollWebUsbAutoExport,
    pullTowerForgeExportViaWebUsb,
    resolveUsbCredentialStore,
    TANGO_INDEXEDDB_NAME,
    USB_CONNECT_STAGES,
    UsbLinkStateMachine,
    type AdbClientLike,
    type AdbSyncClientLike,
    type AdbSyncStatLike,
    type ReadableByteStreamLike,
    type UsbConnectStage,
    type UsbDeviceInfoLike,
    type UsbDeviceManagerLike,
} from '../usbLink';
import type { TangoWebUsbBundle } from '../usbTangoLoader';

function createByteStream(chunks: Uint8Array[]): ReadableByteStreamLike & { cancelSpy: ReturnType<typeof vi.fn> } {
    let index = 0;
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    return {
        cancelSpy,
        getReader() {
            return {
                async read() {
                    if (index >= chunks.length) {
                        return { done: true, value: undefined };
                    }
                    const value = chunks[index];
                    index += 1;
                    return { done: false, value };
                },
                cancel: cancelSpy,
                releaseLock: vi.fn(),
            };
        },
    };
}

function encodeUtf8Chunks(raw: string, chunkSize = 64): Uint8Array[] {
    const bytes = new TextEncoder().encode(raw);
    const result: Uint8Array[] = [];
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        result.push(bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
    }
    return result;
}

interface MockHarness {
    device: UsbDeviceInfoLike;
    deviceManager: UsbDeviceManagerLike;
    sync: AdbSyncClientLike & {
        stat: ReturnType<typeof vi.fn>;
        read: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn>;
    };
    adb: AdbClientLike & {
        sync: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
    };
    tango: TangoWebUsbBundle;
    loadTango: () => Promise<TangoWebUsbBundle>;
    authenticateSpy: ReturnType<typeof vi.fn>;
    adbConstructorSpy: ReturnType<typeof vi.fn>;
    credentialManagerSpy: ReturnType<typeof vi.fn>;
}

function createMockHarness(
    statImpl: (path: string) => Promise<AdbSyncStatLike>,
    readImpl: (path: string) => ReadableByteStreamLike,
): MockHarness {
    const sync = {
        stat: vi.fn(statImpl),
        read: vi.fn(readImpl),
        dispose: vi.fn().mockResolvedValue(undefined),
    };

    const adb = {
        sync: vi.fn().mockResolvedValue(sync),
        close: vi.fn().mockResolvedValue(undefined),
    };

    const connection = { readable: {}, writable: {} };
    const device: UsbDeviceInfoLike = {
        serial: '54221FDAP0011M',
        name: 'Pixel 9 Pro',
        raw: {
            vendorId: 0x18d1,
            productId: 0x4ee7,
            productName: 'Pixel 9 Pro',
            serialNumber: '54221FDAP0011M',
        },
        connect: vi.fn().mockResolvedValue(connection),
    };

    const deviceManager: UsbDeviceManagerLike = {
        requestDevice: vi.fn().mockResolvedValue(device),
    };

    const fakeTransport = { serial: '54221FDAP0011M' };
    const authenticateSpy = vi.fn().mockResolvedValue(fakeTransport);
    const adbConstructorSpy = vi.fn(function FakeAdb() {
        return adb;
    });
    const credentialManagerSpy = vi.fn(function FakeCredentialStore() {
        return {
            generateKey: vi.fn(),
            iterateKeys: async function* () {
                // empty
            },
        };
    });

    const tango = {
        Adb: adbConstructorSpy,
        AdbDaemonTransport: {
            authenticate: authenticateSpy,
        },
        AdbDaemonWebUsbDeviceManager: {
            BROWSER: deviceManager,
        },
        AdbWebCryptoCredentialManager: credentialManagerSpy,
        AdbWebCredentialStore: credentialManagerSpy,
    } as unknown as TangoWebUsbBundle;

    return {
        device,
        deviceManager,
        sync,
        adb,
        tango,
        loadTango: () => Promise.resolve(tango),
        authenticateSpy,
        adbConstructorSpy,
        credentialManagerSpy,
    };
}

describe('WebUSB ADB State Machine, Ephemeral Key Store & Bounded Sync Pull (TOWERFORGE-3)', () => {
    const originalIndexedDB = globalThis.indexedDB;

    beforeEach(async () => {
        await forgetUsbKeys(null);
    });

    afterEach(() => {
        Object.defineProperty(globalThis, 'indexedDB', {
            value: originalIndexedDB,
            configurable: true,
            writable: true,
        });
    });

    it('1. progresses deterministically through idle -> requesting-device -> claiming-interface -> authenticating-rsa -> syncing-files -> validating-payload -> done and returns the byte-identical raw JSON string', async () => {
        // Deliberately include irregular whitespace, key ordering, and large integer literals
        // to prove zero-mutation passthrough after JSON.parse validation.
        const rawPayload =
            '{\n  "player":  "TowerForgePlayer" ,\r\n  "coins": 12345678901234567890,\n  "nested": { "b": 2, "a": 1 }\n}\n';
        const payloadBytes = new TextEncoder().encode(rawPayload);

        const harness = createMockHarness(
            async (path) => {
                expect(path).toBe(CANDIDATE_EXPORT_PATHS[0]);
                return { size: BigInt(payloadBytes.byteLength), mtime: 1_762_000_123n };
            },
            () => createByteStream(encodeUtf8Chunks(rawPayload, 17)),
        );

        const observedStages: UsbConnectStage[] = [];
        const stateMachine = new UsbLinkStateMachine();

        const result = await pullTowerForgeExportViaWebUsb({
            loadTango: harness.loadTango,
            stateMachine,
            onStageChange: (stage) => observedStages.push(stage),
        });

        expect(result).toBe(rawPayload);
        expect(observedStages).toEqual([
            'idle',
            'requesting-device',
            'claiming-interface',
            'authenticating-rsa',
            'syncing-files',
            'validating-payload',
            'done',
        ]);
        expect(stateMachine.stage).toBe('done');
        expect(stateMachine.history).toEqual([
            'idle',
            'requesting-device',
            'claiming-interface',
            'authenticating-rsa',
            'syncing-files',
            'validating-payload',
            'done',
        ]);
        expect(USB_CONNECT_STAGES).toEqual([
            'idle',
            'requesting-device',
            'claiming-interface',
            'authenticating-rsa',
            'syncing-files',
            'validating-payload',
            'done',
            'error',
        ]);
        expect(harness.sync.stat).toHaveBeenCalledTimes(1);
        expect(harness.sync.read).toHaveBeenCalledTimes(1);
        expect(harness.sync.dispose).toHaveBeenCalledTimes(1);
        expect(harness.adb.close).toHaveBeenCalledTimes(1);
    });

    it('2. falls back across candidate paths when path #1 throws ENOENT and path #2 (/files/tool_export.json) succeeds', async () => {
        const expectedJson = '{"version":26,"tier":15,"wave":4820}';
        const expectedBytes = new TextEncoder().encode(expectedJson);

        const harness = createMockHarness(
            async (path) => {
                if (path === CANDIDATE_EXPORT_PATHS[0]) {
                    const err = new Error('ENOENT');
                    err.name = 'ENOENT';
                    throw err;
                }
                if (path === CANDIDATE_EXPORT_PATHS[1]) {
                    return { size: BigInt(expectedBytes.byteLength), mtime: 1_762_000_999n };
                }
                throw new Error(`Unexpected path probed: ${path}`);
            },
            (path) => {
                expect(path).toBe('/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json');
                return createByteStream([expectedBytes]);
            },
        );

        let capturedPath = '';
        const raw = await pullTowerForgeExportViaWebUsb({
            loadTango: harness.loadTango,
            onMetadata: (meta) => {
                capturedPath = meta.path;
            },
        });

        expect(raw).toBe(expectedJson);
        expect(capturedPath).toBe('/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json');
        expect(harness.sync.stat).toHaveBeenCalledTimes(2);
        expect(harness.sync.stat).toHaveBeenNthCalledWith(
            1,
            '/sdcard/Android/data/com.TechTreeGames.TheTower/files/TheTower/tool_export.json',
        );
        expect(harness.sync.stat).toHaveBeenNthCalledWith(
            2,
            '/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json',
        );
        expect(harness.sync.read).toHaveBeenCalledTimes(1);
        expect(harness.sync.dispose).toHaveBeenCalledTimes(1);
        expect(harness.adb.close).toHaveBeenCalledTimes(1);
    });

    it('3a. rejects immediately with PayloadTooLargeError when sync.stat().size > 8_388_608 without calling sync.read()', async () => {
        const oversizedStatBytes = MAX_EXPORT_BYTES + 1; // 8_388_609 bytes
        const harness = createMockHarness(
            async () => ({ size: BigInt(oversizedStatBytes), mtime: 1_762_000_000n }),
            () => createByteStream([new Uint8Array(16)]),
        );

        const stages: UsbConnectStage[] = [];
        await expect(
            pullTowerForgeExportViaWebUsb({
                loadTango: harness.loadTango,
                onStageChange: (stage) => stages.push(stage),
            }),
        ).rejects.toThrow(PayloadTooLargeError);

        expect(harness.sync.stat).toHaveBeenCalledTimes(1);
        expect(harness.sync.read).not.toHaveBeenCalled();
        expect(harness.sync.dispose).toHaveBeenCalledTimes(1);
        expect(harness.adb.close).toHaveBeenCalledTimes(1);
        expect(stages[stages.length - 1]).toBe('error');
    });

    it('3b. rejects immediately with PayloadTooLargeError when streamed chunks exceed 8_388_608 bytes even if sync.stat().size reported smaller', async () => {
        const fourMiBChunk = new Uint8Array(4 * 1024 * 1024).fill(0x20);
        const overflowChunk = new Uint8Array(1024).fill(0x20);
        const stream = createByteStream([fourMiBChunk, fourMiBChunk, overflowChunk]);

        const harness = createMockHarness(
            // Device reports a benign 1024-byte stat size, but streams > 8 MiB
            async () => ({ size: 1024n, mtime: 1_762_000_000n }),
            () => stream,
        );

        await expect(
            pullTowerForgeExportViaWebUsb({
                loadTango: harness.loadTango,
            }),
        ).rejects.toThrow(PayloadTooLargeError);

        expect(stream.cancelSpy).toHaveBeenCalledTimes(1);
        expect(harness.sync.dispose).toHaveBeenCalledTimes(1);
        expect(harness.adb.close).toHaveBeenCalledTimes(1);
    });

    it('4. rejects with SyntaxError when payload is malformed JSON and still executes sync.dispose() and adb.close() in finally', async () => {
        const malformedPayload = '{"unterminated": [1, 2, 3';
        const malformedBytes = new TextEncoder().encode(malformedPayload);

        const harness = createMockHarness(
            async () => ({ size: BigInt(malformedBytes.byteLength), mtime: 1_762_000_500n }),
            () => createByteStream([malformedBytes]),
        );

        const stages: UsbConnectStage[] = [];
        await expect(
            pullTowerForgeExportViaWebUsb({
                loadTango: harness.loadTango,
                onStageChange: (stage) => stages.push(stage),
            }),
        ).rejects.toThrow(SyntaxError);

        expect(stages).toEqual([
            'idle',
            'requesting-device',
            'claiming-interface',
            'authenticating-rsa',
            'syncing-files',
            'validating-payload',
            'error',
        ]);
        expect(harness.sync.dispose).toHaveBeenCalledTimes(1);
        expect(harness.adb.close).toHaveBeenCalledTimes(1);
    });

    it('5. verifies EphemeralMemoryCredentialStore generates an RSA-2048 keypair in memory without touching indexedDB, and forgetUsbKeys() deletes persistent storage', async () => {
        const openSpy = vi.fn();
        const deleteDatabaseSpy = vi.fn(() => {
            const req: {
                onsuccess: (() => void) | null;
                onerror: (() => void) | null;
                onblocked: (() => void) | null;
            } = {
                onsuccess: null,
                onerror: null,
                onblocked: null,
            };
            queueMicrotask(() => {
                req.onsuccess?.();
            });
            return req as unknown as IDBOpenDBRequest;
        });

        const fakeIndexedDB = {
            open: openSpy,
            deleteDatabase: deleteDatabaseSpy,
        } as unknown as IDBFactory;

        Object.defineProperty(globalThis, 'indexedDB', {
            value: fakeIndexedDB,
            configurable: true,
            writable: true,
        });

        const ephemeralStore = new EphemeralMemoryCredentialStore('TowerForgeTest');
        const generatedKey = await ephemeralStore.generateKey();

        expect(openSpy).not.toHaveBeenCalled();
        expect(deleteDatabaseSpy).not.toHaveBeenCalled();
        expect(generatedKey.buffer).toBeInstanceOf(Uint8Array);
        expect(generatedKey.buffer.byteLength).toBeGreaterThan(1000);
        expect(generatedKey.name).toContain('TowerForgeTest@');

        const iteratedKeys = [];
        for await (const key of ephemeralStore.iterateKeys()) {
            iteratedKeys.push(key);
        }
        expect(iteratedKeys).toHaveLength(1);
        expect(iteratedKeys[0]?.buffer).toBe(generatedKey.buffer);

        // Verify forgetUsbKeys() wipes ephemeral buffers and deletes IndexedDB database
        await forgetUsbKeys(fakeIndexedDB);

        expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
        expect(deleteDatabaseSpy).toHaveBeenCalledWith(TANGO_INDEXEDDB_NAME);
        expect(ephemeralStore.getKeyCount()).toBe(0);
        expect(generatedKey.buffer.every((byte) => byte === 0)).toBe(true);
    });

    it('probes all 5 candidate paths in order and rejects with ExportFileNotFoundError when none exist', async () => {
        const harness = createMockHarness(
            async () => {
                throw new Error('ENOENT');
            },
            () => createByteStream([]),
        );

        await expect(
            pullTowerForgeExportViaWebUsb({
                loadTango: harness.loadTango,
            }),
        ).rejects.toThrow(ExportFileNotFoundError);

        expect(harness.sync.stat.mock.calls.map((c) => c[0])).toEqual([...CANDIDATE_EXPORT_PATHS]);
        expect(harness.sync.read).not.toHaveBeenCalled();
        expect(harness.sync.dispose).toHaveBeenCalledTimes(1);
        expect(harness.adb.close).toHaveBeenCalledTimes(1);
    });

    it('resolves persistent vs. ephemeral credential stores according to rememberDevice and contains zero shell/subprocess calls', () => {
        const harness = createMockHarness(
            async () => ({ size: 2n }),
            () => createByteStream([new Uint8Array([0x7b, 0x7d])]),
        );

        const ephemeral = resolveUsbCredentialStore(false, harness.tango);
        expect(ephemeral).toBeInstanceOf(EphemeralMemoryCredentialStore);
        expect(harness.credentialManagerSpy).not.toHaveBeenCalled();

        const persistent1 = resolveUsbCredentialStore(true, harness.tango);
        const persistent2 = resolveUsbCredentialStore(true, harness.tango);
        expect(harness.credentialManagerSpy).toHaveBeenCalledTimes(1);
        expect(persistent1).toBe(persistent2);

        expect(usbLinkSource).not.toMatch(/subprocess/i);
        expect(usbLinkSource).not.toMatch(/\bshell\b/i);
    });

    it('6. keeps the WebUSB Adb session open when keepConnectionOpen=true (holding USB interface lock) and closes it on closeWebUsbSession() or forgetUsbKeys() (TOWERFORGE-21)', async () => {
        const expectedJson = '{"version":26,"tier":14}';
        const expectedBytes = new TextEncoder().encode(expectedJson);

        const harness = createMockHarness(
            async () => ({ size: BigInt(expectedBytes.byteLength), mtime: 1_762_100_000n }),
            () => createByteStream([expectedBytes]),
        );

        expect(hasActiveWebUsbSession()).toBe(false);
        expect(getActiveWebUsbDeviceName()).toBeNull();

        const raw = await pullTowerForgeExportViaWebUsb({
            loadTango: harness.loadTango,
            keepConnectionOpen: true,
        });

        expect(raw).toBe(expectedJson);
        expect(harness.sync.dispose).toHaveBeenCalledTimes(1);
        expect(harness.adb.close).not.toHaveBeenCalled();
        expect(hasActiveWebUsbSession()).toBe(true);
        expect(getActiveWebUsbDeviceName()).toBe('Pixel 9 Pro');

        await closeWebUsbSession();
        expect(hasActiveWebUsbSession()).toBe(false);
        expect(getActiveWebUsbDeviceName()).toBeNull();
        expect(harness.adb.close).toHaveBeenCalledTimes(1);
    });

    it('7. pollWebUsbAutoExport reuses activeWebUsbSession, returns unchanged when mtime <= newerThan without calling sync.read(), and streams payload when mtime > newerThan (TOWERFORGE-21)', async () => {
        let currentMtime = 1_762_200_000n;
        let currentPayload = '{"version":26,"wave":1000}';

        const harness = createMockHarness(
            async () => ({
                size: BigInt(new TextEncoder().encode(currentPayload).byteLength),
                mtime: currentMtime,
            }),
            () => createByteStream([new TextEncoder().encode(currentPayload)]),
        );

        await pullTowerForgeExportViaWebUsb({
            loadTango: harness.loadTango,
            keepConnectionOpen: true,
        });
        expect(hasActiveWebUsbSession()).toBe(true);
        expect(harness.deviceManager.requestDevice).toHaveBeenCalledTimes(1);
        expect(harness.sync.read).toHaveBeenCalledTimes(1);

        // Poll with newerThan equal to currentMtime -> should return unchanged without calling sync.read()
        const unchangedRes = await pollWebUsbAutoExport(1_762_200_000, {
            loadTango: harness.loadTango,
        });
        expect(unchangedRes).toEqual({
            ok: false,
            reason: 'unchanged',
            modified: 1_762_200_000,
        });
        expect(harness.deviceManager.requestDevice).toHaveBeenCalledTimes(1);
        expect(harness.sync.read).toHaveBeenCalledTimes(1); // still 1 — no redundant stream read!
        expect(harness.sync.dispose).toHaveBeenCalledTimes(2);
        expect(harness.adb.close).not.toHaveBeenCalled();

        // Advance mtime on phone -> pollWebUsbAutoExport should stream new payload
        currentMtime = 1_762_200_030n;
        currentPayload = '{"version":26,"wave":1250}';
        const updatedRes = await pollWebUsbAutoExport(1_762_200_000, {
            loadTango: harness.loadTango,
        });
        expect(updatedRes).toEqual({
            ok: true,
            text: '{"version":26,"wave":1250}',
            modified: 1_762_200_030,
            source: 'Pixel 9 Pro (USB)',
            sourceId: 'webusb:54221FDAP0011M',
        });
        expect(harness.sync.read).toHaveBeenCalledTimes(2);
        expect(harness.adb.close).not.toHaveBeenCalled();
    });

    it('8. pollWebUsbAutoExport silently reconnects via deviceManager.getDevices() when no activeWebUsbSession is cached in memory (TOWERFORGE-21)', async () => {
        const expectedJson = '{"version":26,"wave":3400}';
        const expectedBytes = new TextEncoder().encode(expectedJson);

        const harness = createMockHarness(
            async () => ({ size: BigInt(expectedBytes.byteLength), mtime: 1_762_300_500n }),
            () => createByteStream([expectedBytes]),
        );
        const getDevicesSpy = vi.fn().mockResolvedValue([harness.device]);
        harness.deviceManager.getDevices = getDevicesSpy;

        expect(hasActiveWebUsbSession()).toBe(false);

        const res = await pollWebUsbAutoExport(1_762_300_000, {
            loadTango: harness.loadTango,
        });

        expect(getDevicesSpy).toHaveBeenCalledTimes(1);
        expect(harness.deviceManager.requestDevice).not.toHaveBeenCalled();
        expect(hasActiveWebUsbSession()).toBe(true);
        expect(res).toEqual({
            ok: true,
            text: expectedJson,
            modified: 1_762_300_500,
            source: 'Pixel 9 Pro (USB)',
            sourceId: 'webusb:54221FDAP0011M',
        });
    });

    it('9. turns Auto-Import ON and records lastFailed=false on WebUSB connect, and turns Auto-Import OFF on USB disconnect or failed connect (TOWERFORGE-22)', async () => {
        clearLastUsbConnectState();
        setAutoImportOn(false);

        const disconnectListeners: Array<(ev: unknown) => void> = [];
        vi.stubGlobal('navigator', {
            usb: {
                addEventListener: vi.fn((type: string, cb: (ev: unknown) => void) => {
                    if (type === 'disconnect') {
                        disconnectListeners.push(cb);
                    }
                }),
            },
        });

        const expectedJson = '{"version":26,"wave":900}';
        const expectedBytes = new TextEncoder().encode(expectedJson);
        const harness = createMockHarness(
            async () => ({ size: BigInt(expectedBytes.byteLength), mtime: 1_762_400_000n }),
            () => createByteStream([expectedBytes]),
        );

        expect(getAutoImportOn()).toBe(false);
        expect(getLastUsbConnectState()).toBeNull();

        await pullTowerForgeExportViaWebUsb({
            loadTango: harness.loadTango,
            keepConnectionOpen: true,
        });

        expect(getAutoImportOn()).toBe(true);
        expect(getLastUsbConnectState()).toEqual({
            method: 'webusb',
            lastFailed: false,
        });
        expect(hasActiveWebUsbSession()).toBe(true);
        expect(disconnectListeners.length).toBeGreaterThan(0);

        // Simulate hardware USB disconnect event -> should turn Auto-Import OFF and close session
        disconnectListeners[0]?.({ device: { serialNumber: '54221FDAP0011M' } });
        await Promise.resolve();

        expect(hasActiveWebUsbSession()).toBe(false);
        expect(getAutoImportOn()).toBe(false);
        expect(harness.adb.close).toHaveBeenCalledTimes(1);

        // Now simulate a failed connection -> should set lastFailed=true and keep Auto-Import OFF
        setAutoImportOn(true);
        const failingHarness = createMockHarness(
            async () => {
                throw new Error('ENOENT');
            },
            () => createByteStream([]),
        );
        await expect(
            pullTowerForgeExportViaWebUsb({
                loadTango: failingHarness.loadTango,
                keepConnectionOpen: true,
            }),
        ).rejects.toThrow(ExportFileNotFoundError);

        expect(getAutoImportOn()).toBe(false);
        expect(getLastUsbConnectState()).toEqual({
            method: 'webusb',
            lastFailed: true,
        });
    });
});
