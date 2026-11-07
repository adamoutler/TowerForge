import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    detectUsbHostOs,
    diagnoseUsbError,
    ExportFileNotFoundError,
    PayloadTooLargeError,
    probeLocalUsbOwner,
    USB_DIAGNOSIS_KINDS,
    USB_OWNER_PROBE_TIMEOUT_MS,
    USB_OWNER_PROBE_URL,
} from '../usbDiagnose';

const LINUX_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MACOS_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WINDOWS_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

describe('Cross-Platform USB Failure & Ownership Classifier (TOWERFORGE-4)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('1. classifies webusb-unsupported when navigator.usb is undefined', async () => {
        vi.stubGlobal('navigator', {
            userAgent: LINUX_UA,
            usb: undefined,
        });

        const diagnosis = await diagnoseUsbError(new Error('WebUSB unavailable'));

        expect(diagnosis.kind).toBe('webusb-unsupported');
        expect(diagnosis.canRetry).toBe(false);
        expect(diagnosis.summary).toContain('WebUSB');
    });

    it('2. classifies picker-cancelled on DOMException("No device selected", "NotFoundError")', async () => {
        vi.stubGlobal('navigator', {
            userAgent: LINUX_UA,
            usb: {},
        });

        const err = new DOMException('No device selected', 'NotFoundError');
        const diagnosis = await diagnoseUsbError(err);

        expect(diagnosis.kind).toBe('picker-cancelled');
        expect(diagnosis.canRetry).toBe(true);
        expect(diagnosis.remediation).toContain('Retry USB Connect');
    });

    it('3. classifies adb-server-owning-interface when claimInterface throws NetworkError and :47821/usb/owner returns holders: [{ comm: "adb", pid: 4412 }]', async () => {
        vi.stubGlobal('navigator', {
            userAgent: LINUX_UA,
            usb: {},
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

        const claimErr = Object.assign(
            new DOMException('Unable to claim interface.', 'NetworkError'),
            { vendorId: 0x18d1, productId: 0x4ee2 },
        );

        const diagnosis = await diagnoseUsbError(claimErr);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(`${USB_OWNER_PROBE_URL}?vid=18d1&pid=4ee2`);
        expect(calledInit.method).toBe('GET');
        expect(calledInit.signal).toBeDefined();

        expect(diagnosis.kind).toBe('adb-server-owning-interface');
        expect(diagnosis.companionReachable).toBe(true);
        expect(diagnosis.ownerHolder).toEqual({ comm: 'adb', pid: 4412 });
        expect(diagnosis.summary).toContain('adb');
        expect(diagnosis.summary).toContain('4412');
        expect(diagnosis.remediation).toContain('4412');
        expect(diagnosis.remediation).toContain('adb kill-server');
        expect(diagnosis.commands).toContain('adb kill-server');
    });

    it('4. classifies browser-tab-owning-interface when mocked :47821/usb/owner returns holders: [{ comm: "chrome", pid: 9001 }]', async () => {
        vi.stubGlobal('navigator', {
            userAgent: LINUX_UA,
            usb: {},
        });

        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    ok: true,
                    holders: [{ comm: 'chrome', pid: 9001 }],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        );
        vi.stubGlobal('fetch', fetchMock);

        const claimErr = new DOMException('Unable to claim interface.', 'NetworkError');
        const diagnosis = await diagnoseUsbError(claimErr, { vid: '18d1', pid: '4ee2' });

        expect(diagnosis.kind).toBe('browser-tab-owning-interface');
        expect(diagnosis.companionReachable).toBe(true);
        expect(diagnosis.ownerHolder).toEqual({ comm: 'chrome', pid: 9001 });
        expect(diagnosis.summary).toContain('chrome');
        expect(diagnosis.summary).toContain('9001');
        expect(diagnosis.remediation).toContain('chrome');
        expect(diagnosis.remediation).toContain('9001');
    });

    it('5. falls back gracefully to OS-specific remediation when claimInterface throws NetworkError and :47821/usb/owner rejects with ECONNREFUSED on Linux, macOS, and Windows user agents', async () => {
        const econnRefused = Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ECONNREFUSED' },
        });
        const fetchMock = vi.fn().mockRejectedValue(econnRefused);
        vi.stubGlobal('fetch', fetchMock);

        const claimErr = new DOMException('Unable to claim interface.', 'NetworkError');

        // Linux user agent
        vi.stubGlobal('navigator', { userAgent: LINUX_UA, usb: {} });
        const linuxDiag = await diagnoseUsbError(claimErr);
        expect(linuxDiag.kind).toBe('adb-server-owning-interface');
        expect(linuxDiag.os).toBe('linux');
        expect(linuxDiag.companionReachable).toBe(false);
        expect(linuxDiag.commands).toContain('adb kill-server');
        expect(linuxDiag.remediation).toContain('Linux');
        expect(linuxDiag.remediation).toContain('adb kill-server');

        // macOS user agent
        vi.stubGlobal('navigator', { userAgent: MACOS_UA, usb: {} });
        const macDiag = await diagnoseUsbError(claimErr);
        expect(macDiag.kind).toBe('adb-server-owning-interface');
        expect(macDiag.os).toBe('macos');
        expect(macDiag.companionReachable).toBe(false);
        expect(macDiag.commands).toContain('adb kill-server');
        expect(macDiag.remediation).toContain('macOS');
        expect(macDiag.remediation).toContain('adb kill-server');

        // Windows user agent
        vi.stubGlobal('navigator', { userAgent: WINDOWS_UA, usb: {} });
        const winDiag = await diagnoseUsbError(claimErr);
        expect(winDiag.kind).toBe('adb-server-owning-interface');
        expect(winDiag.os).toBe('windows');
        expect(winDiag.companionReachable).toBe(false);
        expect(winDiag.commands).toContain('adb kill-server');
        expect(winDiag.remediation).toContain('Windows');
        expect(winDiag.remediation).toContain('adb kill-server');
    });

    it('6. classifies linux-udev-permission-denied on DOMException("Access denied", "SecurityError") on Linux user agent, returning 51-android-adb-uaccess.rules commands', async () => {
        vi.stubGlobal('navigator', {
            userAgent: LINUX_UA,
            usb: {},
        });

        const secErr = new DOMException('Access denied', 'SecurityError');
        const diagnosis = await diagnoseUsbError(secErr);

        expect(diagnosis.kind).toBe('linux-udev-permission-denied');
        expect(diagnosis.os).toBe('linux');
        expect(diagnosis.udevRuleUrl).toBe('/linux/51-android-adb-uaccess.rules');
        expect(diagnosis.remediation).toContain('51-android-adb-uaccess.rules');
        expect(diagnosis.commands.join('\n')).toContain('51-android-adb-uaccess.rules');
        expect(diagnosis.commands.join('\n')).toContain('udevadm control --reload-rules');
        expect(diagnosis.commands.join('\n')).toContain('udevadm trigger');
    });

    it('7. classifies insecure-context, device-unauthorized-or-charge-only, export-file-not-found, payload-too-large, and unknown-usb-error to cover all 10 UsbDiagnosisKind categories', async () => {
        expect(USB_DIAGNOSIS_KINDS).toHaveLength(10);

        vi.stubGlobal('navigator', {
            userAgent: LINUX_UA,
            usb: {},
        });

        const insecureDiag = await diagnoseUsbError(new Error('any'), {
            isSecureContext: false,
        });
        expect(insecureDiag.kind).toBe('insecure-context');
        expect(insecureDiag.canRetry).toBe(false);

        const unauthDiag = await diagnoseUsbError(
            new Error('No 0xFF/0x42/0x01 interface found or RSA authentication timed out'),
        );
        expect(unauthDiag.kind).toBe('device-unauthorized-or-charge-only');

        const missingFileDiag = await diagnoseUsbError(new ExportFileNotFoundError());
        expect(missingFileDiag.kind).toBe('export-file-not-found');

        const payloadLargeDiag = await diagnoseUsbError(
            new PayloadTooLargeError(9_000_000, 8_388_608, '/sdcard/Download/tool_export.json'),
        );
        expect(payloadLargeDiag.kind).toBe('payload-too-large');

        const unknownDiag = await diagnoseUsbError(new Error('Unexpected hardware stall'));
        expect(unknownDiag.kind).toBe('unknown-usb-error');

        expect(detectUsbHostOs(LINUX_UA)).toBe('linux');
        expect(detectUsbHostOs(MACOS_UA)).toBe('macos');
        expect(detectUsbHostOs(WINDOWS_UA)).toBe('windows');

        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
        const probeRes = await probeLocalUsbOwner({ vid: 0x18d1, pid: 0x4ee2 });
        expect(probeRes).toBeNull();
        expect(timeoutSpy).toHaveBeenCalledWith(USB_OWNER_PROBE_TIMEOUT_MS);
    });
});
