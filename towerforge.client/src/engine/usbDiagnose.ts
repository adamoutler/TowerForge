// ============================================================
//  TowerForge Companion — Cross-Platform USB Failure & Ownership Classifier
//  Classifies WebUSB & ADB Sync failures into 10 deterministic diagnostic
//  categories (UsbDiagnosisKind), enriches interface-claim conflicts via the
//  optional local companion probe (GET http://127.0.0.1:47821/usb/owner), and
//  produces OS-specific remedial commands for Linux, macOS, and Windows.
// ============================================================

import { ExportFileNotFoundError, PayloadTooLargeError } from './usbLink';

export { ExportFileNotFoundError, PayloadTooLargeError };

/**
 * Local companion endpoint used to inspect same-UID USB interface holders (`REQ-P2-008`).
 */
export const USB_OWNER_PROBE_URL = 'http://127.0.0.1:47821/usb/owner';

/**
 * Strict timeout (ms) for the optional `:47821/usb/owner` enrichment probe (`REQ-P2-008`).
 */
export const USB_OWNER_PROBE_TIMEOUT_MS = 1500;

/**
 * Static asset path for the hardened Linux systemd `uaccess` udev rules file (`REQ-P2-009`, `REQ-SEC-010`).
 */
export const LINUX_UDEV_RULE_URL = '/linux/51-android-adb-uaccess.rules';

/**
 * Filename of the hardened Linux udev rule.
 */
export const LINUX_UDEV_RULE_FILENAME = '51-android-adb-uaccess.rules';

/**
 * All 10 deterministic WebUSB diagnostic categories (`REQ-P2-007`).
 */
export const USB_DIAGNOSIS_KINDS = [
    'webusb-unsupported',
    'insecure-context',
    'picker-cancelled',
    'adb-server-owning-interface',
    'browser-tab-owning-interface',
    'linux-udev-permission-denied',
    'device-unauthorized-or-charge-only',
    'export-file-not-found',
    'payload-too-large',
    'unknown-usb-error',
] as const;

export type UsbDiagnosisKind = (typeof USB_DIAGNOSIS_KINDS)[number];

/**
 * Detected desktop/host operating system used for fallback remedial instructions.
 */
export type UsbHostOs = 'linux' | 'macos' | 'windows' | 'unknown';

/**
 * Process holder entry returned by `GET http://127.0.0.1:47821/usb/owner`.
 */
export interface UsbOwnerHolder {
    comm: string;
    pid: number;
    cmdline?: string;
    user?: string;
}

/**
 * JSON payload shape returned by `GET http://127.0.0.1:47821/usb/owner`.
 */
export interface UsbOwnerProbeResponse {
    ok?: boolean;
    platform?: string;
    vid?: string | null;
    pid?: string | null;
    busnum?: number | null;
    devnum?: number | null;
    devnode?: string | null;
    devnode_writable?: boolean | null;
    devnodeWritable?: boolean | null;
    holders: UsbOwnerHolder[];
    recommended_action?: string | null;
    recommendedAction?: string | null;
}

export interface UsbOwnerProbeOptions {
    vid?: number | string;
    pid?: number | string;
    vendorId?: number | string;
    productId?: number | string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}

export interface UsbDiagnoseOptions {
    vid?: number | string;
    pid?: number | string;
    vendorId?: number | string;
    productId?: number | string;
    userAgent?: string;
    isSecureContext?: boolean;
    hasWebUsb?: boolean;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}

/**
 * Structured diagnosis result returned by `diagnoseUsbError()` for rendering
 * remediation cards and copyable commands in `UsbLinkModal.tsx`.
 */
export interface UsbDiagnosis {
    kind: UsbDiagnosisKind;
    os: UsbHostOs;
    title: string;
    summary: string;
    message: string;
    remediation: string;
    commands: string[];
    steps: string[];
    holders: UsbOwnerHolder[];
    ownerHolder: UsbOwnerHolder | null;
    companionReachable: boolean;
    udevRuleUrl?: string;
    companionDownloadUrl?: string;
    canRetry: boolean;
}

const BROWSER_PROCESS_PATTERN = /\b(chrome|chromium|msedge|edge|brave|vivaldi|opera|arc)\b/i;
const ADB_PROCESS_PATTERN = /\b(adb|hd-adb|nox_adb)\b/i;

/**
 * Normalizes a numeric or string USB vendor/product ID into a 4-character lowercase hex string.
 */
export function formatUsbHexId(value: number | string | undefined, fallback: string): string {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value).toString(16).padStart(4, '0').toLowerCase();
    }
    if (typeof value === 'string') {
        const cleaned = value.trim().replace(/^0x/i, '').toLowerCase();
        if (/^[0-9a-f]{1,4}$/.test(cleaned)) {
            return cleaned.padStart(4, '0');
        }
    }
    return fallback;
}

/**
 * Detects the host operating system from a user-agent string (or `navigator.userAgent`).
 */
export function detectUsbHostOs(userAgentOverride?: string): UsbHostOs {
    const ua =
        userAgentOverride !== undefined
            ? userAgentOverride
            : typeof globalThis.navigator !== 'undefined' && typeof globalThis.navigator.userAgent === 'string'
                ? globalThis.navigator.userAgent
                : '';

    if (/windows|win32|win64|wow64/i.test(ua)) {
        return 'windows';
    }
    if (/macintosh|mac os x|macppc|macintel|darwin/i.test(ua)) {
        return 'macos';
    }
    if (/linux|x11|ubuntu|debian|fedora|arch|cros/i.test(ua)) {
        return 'linux';
    }

    if (typeof globalThis.navigator !== 'undefined' && typeof globalThis.navigator.platform === 'string') {
        const platform = globalThis.navigator.platform;
        if (/win/i.test(platform)) return 'windows';
        if (/mac/i.test(platform)) return 'macos';
        if (/linux|x11/i.test(platform)) return 'linux';
    }

    return 'unknown';
}

/**
 * Probes `GET http://127.0.0.1:47821/usb/owner?vid=<hex>&pid=<hex>` with a strict
 * `1500 ms` `AbortSignal.timeout` (`REQ-P2-008`).
 * Returns `null` if the local companion is not running, unreachable, or returns a non-OK response.
 */
export async function probeLocalUsbOwner(
    optionsOrVid?: UsbOwnerProbeOptions | number | string,
    pidArg?: number | string,
    timeoutMsArg?: number,
): Promise<UsbOwnerProbeResponse | null> {
    let rawVid: number | string | undefined;
    let rawPid: number | string | undefined;
    let timeoutMs = USB_OWNER_PROBE_TIMEOUT_MS;
    let fetchFn: typeof fetch | undefined;

    if (typeof optionsOrVid === 'object' && optionsOrVid !== null) {
        rawVid = optionsOrVid.vid ?? optionsOrVid.vendorId;
        rawPid = optionsOrVid.pid ?? optionsOrVid.productId;
        if (typeof optionsOrVid.timeoutMs === 'number' && optionsOrVid.timeoutMs > 0) {
            timeoutMs = optionsOrVid.timeoutMs;
        }
        fetchFn = optionsOrVid.fetchImpl;
    } else {
        rawVid = optionsOrVid;
        rawPid = pidArg;
        if (typeof timeoutMsArg === 'number' && timeoutMsArg > 0) {
            timeoutMs = timeoutMsArg;
        }
    }

    const resolvedFetch = fetchFn ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined);
    if (!resolvedFetch) {
        return null;
    }

    const vidHex = formatUsbHexId(rawVid, '18d1');
    const pidHex = formatUsbHexId(rawPid, '4ee2');
    const url = `${USB_OWNER_PROBE_URL}?vid=${encodeURIComponent(vidHex)}&pid=${encodeURIComponent(pidHex)}`;

    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const signal =
        typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(timeoutMs)
            : (() => {
                const ctrl = new AbortController();
                fallbackTimer = setTimeout(() => ctrl.abort(), timeoutMs);
                return ctrl.signal;
            })();

    try {
        const response = await resolvedFetch(url, {
            method: 'GET',
            signal,
            cache: 'no-store',
            targetAddressSpace: 'loopback',
        } as RequestInit);

        if (!response || !response.ok) {
            return null;
        }

        const body = (await response.json()) as Partial<UsbOwnerProbeResponse> | null;
        if (!body || typeof body !== 'object') {
            return null;
        }

        const holders: UsbOwnerHolder[] = Array.isArray(body.holders)
            ? body.holders
                .filter(
                    (h): h is UsbOwnerHolder =>
                        Boolean(h) &&
                        typeof h === 'object' &&
                        typeof h.comm === 'string' &&
                        typeof h.pid === 'number' &&
                        Number.isFinite(h.pid),
                )
                .map(h => ({
                    comm: h.comm.trim(),
                    pid: Math.trunc(h.pid),
                    ...(typeof h.cmdline === 'string' ? { cmdline: h.cmdline } : {}),
                    ...(typeof h.user === 'string' ? { user: h.user } : {}),
                }))
            : [];

        return {
            ...body,
            holders,
        };
    } catch {
        return null;
    } finally {
        if (fallbackTimer !== undefined) {
            clearTimeout(fallbackTimer);
        }
    }
}

interface ExtractedErrorDetails {
    name: string;
    message: string;
    code: string;
    usbStage: string;
    vendorId?: number | string;
    productId?: number | string;
}

function extractErrorDetails(error: unknown): ExtractedErrorDetails {
    if (!error) {
        return { name: '', message: '', code: '', usbStage: '' };
    }
    if (typeof error === 'string') {
        return { name: '', message: error, code: error, usbStage: '' };
    }
    if (typeof error === 'object') {
        const rec = error as Record<string, unknown>;
        const name = typeof rec.name === 'string' ? rec.name : '';
        const message = typeof rec.message === 'string' ? rec.message : '';
        const code =
            typeof rec.code === 'string'
                ? rec.code
                : typeof rec.kind === 'string'
                    ? rec.kind
                    : '';
        const usbStage = typeof rec.usbStage === 'string' ? rec.usbStage : '';
        const vendorId =
            typeof rec.vendorId === 'number' || typeof rec.vendorId === 'string'
                ? rec.vendorId
                : typeof rec.vid === 'number' || typeof rec.vid === 'string'
                    ? rec.vid
                    : undefined;
        const productId =
            typeof rec.productId === 'number' || typeof rec.productId === 'string'
                ? rec.productId
                : typeof rec.pid === 'number' || typeof rec.pid === 'string'
                    ? rec.pid
                    : undefined;
        return { name, message, code, usbStage, vendorId, productId };
    }
    return { name: '', message: String(error), code: '', usbStage: '' };
}

function checkSecureContext(options?: UsbDiagnoseOptions): boolean {
    if (typeof options?.isSecureContext === 'boolean') {
        return options.isSecureContext;
    }
    if (typeof globalThis.window !== 'undefined' && typeof globalThis.window.isSecureContext === 'boolean') {
        return globalThis.window.isSecureContext;
    }
    if (typeof globalThis.isSecureContext === 'boolean') {
        return globalThis.isSecureContext;
    }
    return true;
}

function checkWebUsbAvailable(options?: UsbDiagnoseOptions): boolean {
    if (typeof options?.hasWebUsb === 'boolean') {
        return options.hasWebUsb;
    }
    if (typeof globalThis.navigator === 'undefined' || globalThis.navigator === null) {
        return false;
    }
    if (!('usb' in globalThis.navigator)) {
        return false;
    }
    return Boolean((globalThis.navigator as Navigator & { usb?: unknown }).usb);
}

function buildDiagnosis(params: {
    kind: UsbDiagnosisKind;
    os: UsbHostOs;
    title: string;
    summary: string;
    remediation: string;
    commands?: string[];
    steps?: string[];
    holders?: UsbOwnerHolder[];
    ownerHolder?: UsbOwnerHolder | null;
    companionReachable?: boolean;
    udevRuleUrl?: string;
    companionDownloadUrl?: string;
    canRetry?: boolean;
}): UsbDiagnosis {
    const commands = params.commands ?? [];
    const steps = params.steps ?? [];
    const holders = params.holders ?? [];
    const ownerHolder = params.ownerHolder ?? (holders[0] ?? null);
    return {
        kind: params.kind,
        os: params.os,
        title: params.title,
        summary: params.summary,
        message: params.summary,
        remediation: params.remediation,
        commands,
        steps,
        holders,
        ownerHolder,
        companionReachable: params.companionReachable ?? false,
        ...(params.udevRuleUrl ? { udevRuleUrl: params.udevRuleUrl } : {}),
        ...(params.companionDownloadUrl ? { companionDownloadUrl: params.companionDownloadUrl } : {}),
        canRetry: params.canRetry ?? true,
    };
}

function buildAdbServerFallbackDiagnosis(os: UsbHostOs): UsbDiagnosis {
    if (os === 'linux') {
        const commands = ['adb kill-server'];
        const summary =
            'Unable to claim the Android USB ADB interface (0xFF/0x42/0x01) on Linux. A local adb server is likely holding the interface.';
        const remediation =
            'On Linux, stop the local ADB daemon with `adb kill-server` so the browser can claim interface 0xFF/0x42/0x01. If permission issues persist, install 51-android-adb-uaccess.rules.';
        return buildDiagnosis({
            kind: 'adb-server-owning-interface',
            os,
            title: 'USB Interface Claimed by Local ADB (Linux)',
            summary,
            remediation,
            commands,
            steps: [
                'Run `adb kill-server` in your Linux terminal to release the USB interface.',
                'Ensure Android Studio or scrcpy is not auto-restarting the ADB server.',
                'Click "Retry USB Connect" to reconnect.',
            ],
            companionDownloadUrl: '/downloads/towerforge-link.pyz',
            udevRuleUrl: LINUX_UDEV_RULE_URL,
        });
    }

    if (os === 'macos') {
        const commands = ['adb kill-server', 'killall adb'];
        const summary =
            'Unable to claim the Android USB ADB interface (0xFF/0x42/0x01) on macOS. A local adb server or Android Studio is holding exclusive access.';
        const remediation =
            'On macOS, stop the local ADB server by running `adb kill-server` (or `killall adb` in Terminal) and close Android Studio Device Manager before retrying.';
        return buildDiagnosis({
            kind: 'adb-server-owning-interface',
            os,
            title: 'USB Interface Claimed by Local ADB (macOS)',
            summary,
            remediation,
            commands,
            steps: [
                'Open Terminal on macOS and run `adb kill-server`.',
                'Close Android Studio or any other tool polling ADB over USB.',
                'Click "Retry USB Connect" to reconnect.',
            ],
            companionDownloadUrl: '/downloads/towerforge-link.pyz',
        });
    }

    if (os === 'windows') {
        const commands = ['adb kill-server', 'taskkill /F /IM adb.exe'];
        const summary =
            'Unable to claim the Android USB ADB interface (0xFF/0x42/0x01) on Windows. A local adb.exe server or emulator holds the USB device.';
        const remediation =
            'On Windows, stop the running ADB server with `adb kill-server` or `taskkill /F /IM adb.exe` in Command Prompt / PowerShell, then retry.';
        return buildDiagnosis({
            kind: 'adb-server-owning-interface',
            os,
            title: 'USB Interface Claimed by Local ADB (Windows)',
            summary,
            remediation,
            commands,
            steps: [
                'Open PowerShell or Command Prompt on Windows and run `adb kill-server`.',
                'If an emulator or platform-tools adb.exe restarts, run `taskkill /F /IM adb.exe`.',
                'Click "Retry USB Connect" to reconnect.',
            ],
            companionDownloadUrl: '/downloads/towerforge-link.pyz',
        });
    }

    const commands = ['adb kill-server'];
    const summary =
        'Unable to claim the Android USB ADB interface (0xFF/0x42/0x01). A local adb server is likely holding the USB interface.';
    const remediation =
        'Run `adb kill-server` in your terminal to release the USB ADB interface, then click "Retry USB Connect".';
    return buildDiagnosis({
        kind: 'adb-server-owning-interface',
        os,
        title: 'USB Interface Claimed by Local ADB',
        summary,
        remediation,
        commands,
        steps: [
            'Run `adb kill-server` in your terminal.',
            'Click "Retry USB Connect" to reconnect.',
        ],
        companionDownloadUrl: '/downloads/towerforge-link.pyz',
    });
}

function buildLinuxUdevDiagnosis(os: UsbHostOs): UsbDiagnosis {
    const installCmd = `sudo cp ${LINUX_UDEV_RULE_FILENAME} /etc/udev/rules.d/${LINUX_UDEV_RULE_FILENAME}`;
    const reloadCmd = 'sudo udevadm control --reload-rules && sudo udevadm trigger';
    const summary =
        'Linux udev permissions blocked access to the Android USB ADB interface (0xFF/0x42/0x01). Install the systemd uaccess udev rule (51-android-adb-uaccess.rules) to grant your logged-in desktop session access without mode 0666.';
    const remediation =
        `Download ${LINUX_UDEV_RULE_FILENAME} from ${LINUX_UDEV_RULE_URL}, install it to /etc/udev/rules.d/${LINUX_UDEV_RULE_FILENAME}, run \`${reloadCmd}\`, and replug your USB cable.`;
    return buildDiagnosis({
        kind: 'linux-udev-permission-denied',
        os: os === 'unknown' ? 'linux' : os,
        title: 'Linux USB Permission Denied (udev uaccess Rule Needed)',
        summary,
        remediation,
        commands: [installCmd, reloadCmd],
        steps: [
            `Download the hardened udev rule (${LINUX_UDEV_RULE_FILENAME}).`,
            `Copy it into /etc/udev/rules.d/: \`${installCmd}\``,
            `Reload udev rules: \`${reloadCmd}\``,
            'Unplug and reconnect your Android phone over USB, then click "Retry USB Connect".',
        ],
        udevRuleUrl: LINUX_UDEV_RULE_URL,
    });
}

/**
 * Classifies a WebUSB / ADB connection or sync error into one of the 10
 * `UsbDiagnosisKind` categories, enriching `claimInterface` / `NetworkError`
 * failures via `probeLocalUsbOwner` (`:47821/usb/owner`) when reachable (`REQ-P2-007`..`REQ-P2-009`).
 */
export async function diagnoseUsbError(
    error?: unknown,
    options?: UsbDiagnoseOptions,
): Promise<UsbDiagnosis> {
    const os = detectUsbHostOs(options?.userAgent);
    const details = extractErrorDetails(error);
    const { name, message, code } = details;

    // 1. Insecure context check (!window.isSecureContext or explicit error message)
    if (
        !checkSecureContext(options) ||
        code === 'insecure-context' ||
        /insecure[-_\s]?context|requires a secure context|https.*required/i.test(message)
    ) {
        const summary =
            'WebUSB is blocked because this page is not running in a secure context (HTTPS or localhost).';
        return buildDiagnosis({
            kind: 'insecure-context',
            os,
            title: 'Secure Context (HTTPS) Required for WebUSB',
            summary,
            remediation:
                'Open TowerForge over https:// or http://localhost so the browser enables the WebUSB API.',
            steps: [
                'Reload TowerForge using https:// (or http://localhost for local development).',
                'Retry connecting your USB phone once on a secure origin.',
            ],
            canRetry: false,
        });
    }

    // 2. Explicit webusb-unsupported error / code
    if (
        code === 'webusb-unsupported' ||
        name === 'WebUsbUnsupportedError' ||
        /webusb is not supported|webusb.*unsupported|navigator\.usb.*undefined/i.test(message)
    ) {
        const summary =
            'Your current browser does not support the WebUSB API (navigator.usb is unavailable). Use a Chromium-based browser (Chrome, Edge, Brave) or the TowerForge Link companion.';
        return buildDiagnosis({
            kind: 'webusb-unsupported',
            os,
            title: 'WebUSB Not Supported in This Browser',
            summary,
            remediation:
                'Open TowerForge in Google Chrome, Microsoft Edge, or Brave on desktop, or use the TowerForge Link Python companion (towerforge-link.pyz) to import from Firefox/Safari.',
            steps: [
                'Switch to a desktop Chromium browser (Chrome, Edge, or Brave), OR',
                'Download and run `python3 towerforge-link.pyz` to import over the local companion.',
            ],
            companionDownloadUrl: '/downloads/towerforge-link.pyz',
            canRetry: false,
        });
    }

    // 3. Picker cancelled (DOMException.name === 'NotFoundError')
    if (
        name === 'NotFoundError' ||
        code === 'picker-cancelled' ||
        /no device selected|user cancelled|picker.*cancelled/i.test(message)
    ) {
        const summary =
            'The browser USB device chooser was closed without selecting a phone.';
        return buildDiagnosis({
            kind: 'picker-cancelled',
            os,
            title: 'No USB Device Selected',
            summary,
            remediation:
                'Unlock your Android phone, ensure USB debugging is enabled in Developer Options, click "Retry USB Connect", and select your phone in the browser chooser.',
            steps: [
                'Connect your Android phone to this computer with a data-capable USB cable.',
                'Enable Developer Options -> USB debugging on the phone.',
                'Click "Retry USB Connect" and choose your phone from the popup list.',
            ],
        });
    }

    // 4. PayloadTooLargeError (exceeds 8 MiB cap)
    if (
        error instanceof PayloadTooLargeError ||
        name === 'PayloadTooLargeError' ||
        code === 'payload-too-large' ||
        code === 'PAYLOAD_TOO_LARGE' ||
        /payload.*too.*large|exceeds maximum allowed limit|exceed.*8\s*mib/i.test(message)
    ) {
        const summary =
            message ||
            'The exported tool_export.json file on the device exceeds the maximum 8 MiB safety limit.';
        return buildDiagnosis({
            kind: 'payload-too-large',
            os,
            title: 'Export File Exceeds 8 MiB Safety Limit',
            summary,
            remediation:
                'Re-export your game data in The Tower (Settings -> External Tools Export) to generate a fresh, valid tool_export.json file under 8 MiB.',
            steps: [
                'Open The Tower on your phone and trigger a fresh External Tools Export.',
                'Click "Retry USB Connect" to pull the updated export file.',
            ],
        });
    }

    // 5. Export file not found at any candidate path
    if (
        error instanceof ExportFileNotFoundError ||
        name === 'ExportFileNotFoundError' ||
        code === 'export-file-not-found' ||
        code === 'ENOENT' ||
        /tool_export\.json.*not found|missing at all candidate paths|no such file or directory/i.test(
            message,
        )
    ) {
        const summary =
            'Connected to your Android device over USB, but tool_export.json was not found in any expected game folder.';
        return buildDiagnosis({
            kind: 'export-file-not-found',
            os,
            title: 'Game Export File (tool_export.json) Not Found',
            summary,
            remediation:
                'Open The Tower on your phone, go to Settings -> External Tools Export, tap Export (or enable Auto export), and then click "Retry USB Connect".',
            steps: [
                'Open The Tower on your Android phone.',
                'Navigate to Settings -> External Tools Export and export your game data.',
                'Click "Retry USB Connect" to import the newly created tool_export.json.',
            ],
        });
    }

    // 6. Linux udev permission denied (SecurityError / Access denied on Linux platform)
    const isSecurityOrAccessDenied =
        name === 'SecurityError' ||
        code === 'linux-udev-permission-denied' ||
        /access denied|permission denied|insufficient permissions|udev/i.test(message);

    if (
        code === 'linux-udev-permission-denied' ||
        (isSecurityOrAccessDenied && (os === 'linux' || /udev|51-android-adb-uaccess/i.test(message)))
    ) {
        return buildLinuxUdevDiagnosis(os);
    }

    // 7. NetworkError / claimInterface failure -> probe :47821/usb/owner
    const isClaimInterfaceOrNetworkError =
        name === 'NetworkError' ||
        code === 'adb-server-owning-interface' ||
        code === 'browser-tab-owning-interface' ||
        /unable to claim interface|claiminterface|interface.*busy|device.*busy|resource busy|libusb_error_busy/i.test(
            message,
        );

    if (isClaimInterfaceOrNetworkError) {
        const probeResult = await probeLocalUsbOwner({
            vid: options?.vid ?? options?.vendorId ?? details.vendorId,
            pid: options?.pid ?? options?.productId ?? details.productId,
            timeoutMs: options?.timeoutMs,
            fetchImpl: options?.fetchImpl,
        });

        if (probeResult) {
            const holders = probeResult.holders ?? [];
            const browserHolder = holders.find(h => BROWSER_PROCESS_PATTERN.test(h.comm));
            if (browserHolder || code === 'browser-tab-owning-interface') {
                const holder = browserHolder ?? holders[0] ?? { comm: 'chrome', pid: 0 };
                const summary = `Another browser tab or process (${holder.comm}, PID ${holder.pid}) currently holds the Android USB ADB interface (0xFF/0x42/0x01).`;
                const remediation = `Close other browser tabs or windows using WebUSB/ADB in ${holder.comm} (PID ${holder.pid}), then click "Retry USB Connect".`;
                return buildDiagnosis({
                    kind: 'browser-tab-owning-interface',
                    os,
                    title: 'USB Interface Claimed by Another Browser Tab',
                    summary,
                    remediation,
                    commands: [],
                    steps: [
                        `Locate any other open TowerForge or WebUSB tab in ${holder.comm} (PID ${holder.pid}) and close or disconnect it.`,
                        'Click "Retry USB Connect" in this tab.',
                    ],
                    holders,
                    ownerHolder: holder,
                    companionReachable: true,
                });
            }

            const adbHolder =
                holders.find(h => ADB_PROCESS_PATTERN.test(h.comm)) ?? holders[0] ?? null;
            if (adbHolder) {
                const summary = `Local ${adbHolder.comm} process (PID ${adbHolder.pid}) is holding the Android USB ADB interface (0xFF/0x42/0x01).`;
                const remediation = `Stop ${adbHolder.comm} (PID ${adbHolder.pid}) by running \`adb kill-server\` (or \`kill ${adbHolder.pid}\`), then click "Retry USB Connect".`;
                return buildDiagnosis({
                    kind: 'adb-server-owning-interface',
                    os,
                    title: 'USB Interface Claimed by Local ADB Server',
                    summary,
                    remediation,
                    commands: ['adb kill-server'],
                    steps: [
                        `Stop the local ${adbHolder.comm} process (PID ${adbHolder.pid}) with \`adb kill-server\`.`,
                        'Click "Retry USB Connect" once the interface is released.',
                    ],
                    holders,
                    ownerHolder: adbHolder,
                    companionReachable: true,
                    companionDownloadUrl: '/downloads/towerforge-link.pyz',
                });
            }

            const devnodeWritable =
                probeResult.devnode_writable ?? probeResult.devnodeWritable ?? true;
            if (devnodeWritable === false && os === 'linux') {
                const udevDiag = buildLinuxUdevDiagnosis(os);
                return {
                    ...udevDiag,
                    companionReachable: true,
                };
            }

            const fallbackDiag = buildAdbServerFallbackDiagnosis(os);
            return {
                ...fallbackDiag,
                companionReachable: true,
            };
        }

        // :47821/usb/owner unreachable -> graceful OS-specific fallback
        return buildAdbServerFallbackDiagnosis(os);
    }

    // 8. Device unauthorized or charge-only cable (missing 0xFF/0x42/0x01 interface or RSA auth timeout)
    if (
        name === 'UnauthorizedDeviceError' ||
        name === 'TimeoutError' ||
        code === 'device-unauthorized-or-charge-only' ||
        /unauthorized|charge[-_\s]?only|0xff\/0x42\/0x01|no adb interface|interface.*not found|rsa.*timeout|auth.*timed?\s*out|allow usb debugging/i.test(
            message,
        )
    ) {
        const summary =
            'The selected USB device did not expose the Android ADB interface (0xFF/0x42/0x01) or USB debugging authorization timed out on the phone.';
        return buildDiagnosis({
            kind: 'device-unauthorized-or-charge-only',
            os,
            title: 'Phone Unauthorized or Charge-Only USB Cable',
            summary,
            remediation:
                'Unlock your phone, switch USB mode to "File Transfer / MTP", enable "USB debugging" in Developer Options, and tap "Allow" on the RSA key prompt shown on your phone screen.',
            steps: [
                'Verify your USB cable supports data transfer (not a charge-only cable).',
                'On your phone, enable Settings -> Developer Options -> USB debugging.',
                'Unlock your phone screen and tap "Allow" on the "Allow USB debugging?" RSA fingerprint dialog.',
                'Click "Retry USB Connect".',
            ],
        });
    }

    // 9. Environment lacks WebUSB support (navigator.usb is undefined)
    if (!checkWebUsbAvailable(options)) {
        const summary =
            'Your current browser does not support the WebUSB API (navigator.usb is unavailable). Use a Chromium-based browser (Chrome, Edge, Brave) or the TowerForge Link companion.';
        return buildDiagnosis({
            kind: 'webusb-unsupported',
            os,
            title: 'WebUSB Not Supported in This Browser',
            summary,
            remediation:
                'Open TowerForge in Google Chrome, Microsoft Edge, or Brave on desktop, or use the TowerForge Link Python companion (towerforge-link.pyz).',
            steps: [
                'Switch to a desktop Chromium browser (Chrome, Edge, or Brave), OR',
                'Download and run `python3 towerforge-link.pyz` to import over the local companion.',
            ],
            companionDownloadUrl: '/downloads/towerforge-link.pyz',
            canRetry: false,
        });
    }

    // 10. Fallback unknown USB error
    const detailText = message ? `: ${message}` : '.';
    return buildDiagnosis({
        kind: 'unknown-usb-error',
        os,
        title: 'Unexpected USB Connection Error',
        summary: `An unexpected error occurred while communicating with your USB device${detailText}`,
        remediation:
            'Unplug and reconnect your USB cable, ensure your phone is unlocked with USB debugging enabled, and click "Retry USB Connect".',
        steps: [
            'Unplug and reconnect your Android phone USB cable.',
            'Confirm USB debugging is enabled on the phone.',
            'Click "Retry USB Connect".',
        ],
    });
}
