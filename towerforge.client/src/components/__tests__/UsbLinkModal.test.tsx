// ============================================================
//  TowerForge Companion — UsbLinkModal & Hardened Linux udev Rule Tests
//  Verifies idle state rendering, WebUSB pull -> onImport(rawJson),
//  adb-server-owning-interface diagnostic remediation card,
//  linux-udev-permission-denied diagnostic card with udev rule link,
//  and static security verification of public/linux/51-android-adb-uaccess.rules.
// ============================================================

import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import udevRuleRaw from '../../../public/linux/51-android-adb-uaccess.rules?raw';
import appSourceRaw from '../../App.tsx?raw';
import { getAutoImportOn, setAutoImportOn } from '../../engine/autoImport';
import {
    clearLastUsbConnectState,
    closeWebUsbSession,
    forgetUsbKeys,
    getLastUsbConnectState,
    hasActiveWebUsbSession,
    pullTowerForgeExportViaWebUsb,
    saveLastUsbConnectState,
    USB_CONNECT_STAGES,
} from '../../engine/usbLink';
import { wsExport } from '../../engine/wsLinkClient';
import UsbLinkModal, { type UsbLinkModalProps } from '../UsbLinkModal';

vi.mock('../../engine/usbLink', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../engine/usbLink')>();
    return {
        ...actual,
        pullTowerForgeExportViaWebUsb: vi.fn(actual.pullTowerForgeExportViaWebUsb),
        forgetUsbKeys: vi.fn(actual.forgetUsbKeys),
        hasActiveWebUsbSession: vi.fn(actual.hasActiveWebUsbSession),
    };
});

vi.mock('../../engine/wsLinkClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../engine/wsLinkClient')>();
    return {
        ...actual,
        wsExport: vi.fn(actual.wsExport),
    };
});

const LINUX_CHROME_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

    const clickButton = async (labelOrTestId: string): Promise<{ html: string; elements: ElementMatch[] }> => {
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

describe('UsbLinkModal Component & Linux udev Asset (TOWERFORGE-5)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await closeWebUsbSession();
        clearLastUsbConnectState();
        setAutoImportOn(false);
        vi.stubGlobal('navigator', {
            userAgent: LINUX_CHROME_UA,
            usb: {},
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('1. renders UsbLinkModal idle state with "Connect USB Phone" primary action, "Remember this computer" toggle, and "Forget USB Keys" action', () => {
        const onImport = vi.fn();
        const onClose = vi.fn();
        const harness = renderModalHarness({ onImport, onClose });
        const { html, elements } = harness.render();

        // Verify idle stage and progress stepper across UsbConnectStage
        expect(html).toContain('data-current-stage="idle"');
        for (const stage of USB_CONNECT_STAGES) {
            expect(html).toContain(`data-stage="${stage}"`);
        }

        // Verify primary "Connect USB Phone" button
        const connectBtn = elements.find(
            (el) => el.type === 'button' && el.text.includes('Connect USB Phone'),
        );
        expect(connectBtn).toBeDefined();
        expect(connectBtn?.props.disabled).toBe(false);

        // Verify "Remember this computer on my phone (IndexedDB)" checkbox (default true)
        expect(html).toContain('Remember this computer on my phone (IndexedDB)');
        const checkbox = elements.find(
            (el) =>
                el.type === 'input' &&
                el.props.type === 'checkbox' &&
                el.props['data-testid'] === 'remember-usb-device-checkbox',
        );
        expect(checkbox).toBeDefined();
        expect(checkbox?.props.checked).toBe(true);

        // Verify "Forget USB Keys" action button
        const forgetBtn = elements.find(
            (el) => el.type === 'button' && el.text.includes('Forget USB Keys'),
        );
        expect(forgetBtn).toBeDefined();

        // Also verify App.tsx retains untouched "Get from emulator or phone" alongside "🔌 Connect USB phone"
        expect(appSourceRaw).toContain('Get from emulator or phone');
        expect(appSourceRaw).toContain('🔌 Connect USB phone');
        expect(appSourceRaw).toContain('data-testid="connect-usb-phone-btn"');
    });

    it('2. clicking "Connect USB Phone" triggers pullTowerForgeExportViaWebUsb and calls onImport(rawJson) on success', async () => {
        const rawJson = '{"version":26,"player":"TowerForgeUsbUser","coins":987654321}';
        vi.mocked(pullTowerForgeExportViaWebUsb).mockImplementation(async (options) => {
            options?.onStageChange?.('requesting-device');
            options?.onStageChange?.('claiming-interface');
            options?.onStageChange?.('authenticating-rsa');
            options?.onStageChange?.('syncing-files');
            options?.onStageChange?.('validating-payload');
            options?.onStageChange?.('done');
            return rawJson;
        });

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });

        const { html } = await harness.clickButton('Connect USB Phone');

        expect(pullTowerForgeExportViaWebUsb).toHaveBeenCalledTimes(1);
        expect(pullTowerForgeExportViaWebUsb).toHaveBeenCalledWith(
            expect.objectContaining({
                rememberDevice: true,
                keepConnectionOpen: true,
                onStageChange: expect.any(Function),
            }),
        );
        expect(onImport).toHaveBeenCalledTimes(1);
        expect(onImport).toHaveBeenCalledWith(rawJson);
        expect(html).toContain('data-current-stage="done"');

        // Verify clicking "Forget USB Keys" invokes forgetUsbKeys()
        await harness.clickButton('Forget USB Keys');
        expect(forgetUsbKeys).toHaveBeenCalledTimes(1);
    });

    it('3. when pullTowerForgeExportViaWebUsb rejects with an adb-server-owning-interface error, displays the diagnostic card with adb kill-server and "Retry USB Connect"', async () => {
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
        vi.mocked(pullTowerForgeExportViaWebUsb).mockRejectedValueOnce(claimError);

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });

        const { html, elements } = await harness.clickButton('Connect USB Phone');

        expect(onImport).not.toHaveBeenCalled();
        expect(html).toContain('data-current-stage="error"');
        expect(html).toContain('data-testid="usb-diagnosis-card"');
        expect(html).toContain('data-diagnosis-kind="adb-server-owning-interface"');
        expect(html).toContain('adb kill-server');
        expect(html).toContain('4412');
        expect(html).toContain('Retry USB Connect');

        const retryBtn = elements.find(
            (el) => el.type === 'button' && el.text.includes('Retry USB Connect'),
        );
        expect(retryBtn).toBeDefined();
    });

    it('4. when pullTowerForgeExportViaWebUsb rejects with a linux-udev-permission-denied error, displays the link to /linux/51-android-adb-uaccess.rules and udevadm commands', async () => {
        const udevError = Object.assign(new DOMException('Access denied', 'SecurityError'), {
            kind: 'linux-udev-permission-denied',
        });
        vi.mocked(pullTowerForgeExportViaWebUsb).mockRejectedValueOnce(udevError);

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });

        const { html, elements } = await harness.clickButton('Connect USB Phone');

        expect(onImport).not.toHaveBeenCalled();
        expect(html).toContain('data-current-stage="error"');
        expect(html).toContain('data-diagnosis-kind="linux-udev-permission-denied"');
        expect(html).toContain('href="/linux/51-android-adb-uaccess.rules"');
        expect(html).toContain('51-android-adb-uaccess.rules');
        expect(html).toContain('sudo udevadm control --reload-rules &amp;&amp; sudo udevadm trigger');
        expect(html).toContain('Retry USB Connect');

        const udevLink = elements.find(
            (el) =>
                el.type === 'a' &&
                el.props.href === '/linux/51-android-adb-uaccess.rules',
        );
        expect(udevLink).toBeDefined();
    });

    it('5. static verification that public/linux/51-android-adb-uaccess.rules contains TAG+="uaccess" and does NOT contain 0666', () => {
        expect(udevRuleRaw).toContain('SUBSYSTEM=="usb"');
        expect(udevRuleRaw).toContain('ENV{DEVTYPE}=="usb_device"');
        expect(udevRuleRaw).toContain('ENV{ID_USB_INTERFACES}=="*:ff4201:*"');
        expect(udevRuleRaw).toContain('TAG+="uaccess"');
        expect(udevRuleRaw).not.toContain('0666');
    });

    it('6. handles rememberDevice toggle, metadata banner, command copy, guide link, and companion WS fallback actions', async () => {
        vi.stubGlobal('window', {
            dispatchEvent: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        });
        const onImport = vi.fn();
        const onClose = vi.fn();
        const harness = renderModalHarness({ onImport, onClose });
        const { elements } = harness.render();

        // Toggle "Remember this computer" checkbox
        const checkbox = elements.find(
            (el) => el.props['data-testid'] === 'remember-usb-device-checkbox',
        );
        const onChange = checkbox?.props.onChange as ((e: { target: { checked: boolean } }) => void) | undefined;
        onChange?.({ target: { checked: false } });
        expect(harness.render().html).toContain('Remember this computer');

        // Trigger modal container click stopPropagation and guide link click
        const modalDiv = elements.find((el) => el.props.className === 'lnk-modal');
        const stopPropagation = vi.fn();
        (modalDiv?.props.onClick as ((e: { stopPropagation: () => void }) => void) | undefined)?.({
            stopPropagation,
        });
        expect(stopPropagation).toHaveBeenCalledTimes(1);

        const guideLink = elements.find(
            (el) => el.type === 'a' && String(el.props.href || '').includes('#usb'),
        );
        const preventDefault = vi.fn();
        (guideLink?.props.onClick as ((e: Record<string, unknown>) => void) | undefined)?.({
            button: 0,
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            preventDefault,
        });
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);

        // Simulate metadata callback on pull
        vi.mocked(pullTowerForgeExportViaWebUsb).mockImplementationOnce(async (options) => {
            options?.onMetadata?.({
                deviceName: 'Pixel 9 Pro',
                serial: '54221FDAP0011M',
                byteLength: 4096,
                path: '/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json',
                mtime: 1700000000,
            });
            return '{"version":26}';
        });
        const afterMeta = await harness.clickButton('Connect USB Phone');
        expect(afterMeta.html).toContain('Pixel 9 Pro');

        // Simulate adb-server-owning-interface error, copy command, and try companion fallback buttons
        const claimError = Object.assign(new DOMException('Unable to claim interface.', 'NetworkError'), {
            kind: 'adb-server-owning-interface',
        });
        vi.mocked(pullTowerForgeExportViaWebUsb).mockRejectedValueOnce(claimError);
        await harness.clickButton('Connect USB Phone');

        const afterCopy = await harness.clickButton('copy-usb-cmd-btn-0');
        expect(afterCopy.html).toContain('✓ Copied');

        // Clicking companion actions when WS is unreachable sets status note gracefully
        const afterKill = await harness.clickButton('ws-kill-adb-retry-btn');
        expect(afterKill.html).toContain('Could not stop local ADB server');

        const afterWsExport = await harness.clickButton('ws-companion-export-btn');
        expect(afterWsExport.html).toContain('Could not import via Python Companion');
    });

    it('7. renders unified Get your data with [TowerForge Link] [WebUSB] [TowerForge Link Python] tabs and switches interactive guide panes cleanly (TOWERFORGE-19)', async () => {
        const onImport = vi.fn();
        const onClose = vi.fn();
        const onSwitchToLinkModal = vi.fn();
        const harness = renderModalHarness({ onImport, onClose, onSwitchToLinkModal });

        const initial = harness.render();
        expect(initial.html).toContain('Get your data with');
        expect(initial.html).toContain('data-testid="mode-tab-link"');
        expect(initial.html).toContain('data-testid="mode-tab-webusb"');
        expect(initial.html).toContain('data-testid="mode-tab-python"');
        expect(initial.html).toContain('data-testid="mode-pane-webusb"');
        expect(initial.html).toContain('data-testid="webusb-interactive-guide"');

        // Switch to [TowerForge Link Python] tab
        const pythonView = await harness.clickButton('mode-tab-python');
        expect(pythonView.html).toContain('data-testid="mode-pane-python"');
        expect(pythonView.html).toContain('data-testid="download-companion-py-link"');
        expect(pythonView.html).toContain('data-testid="download-companion-pyz-link"');
        expect(pythonView.html).toContain('python3 ~/Downloads/towerforge-link.py');
        expect(pythonView.html).toContain('python3 ~/Downloads/towerforge-link.pyz serve');
        expect(pythonView.html).toContain('data-testid="ws-companion-export-btn"');

        // Copy serve command and pull command
        const afterServeCopy = await harness.clickButton('copy-python-serve-cmd-btn');
        expect(afterServeCopy.html).toContain('✓ Copied');
        const afterPullCopy = await harness.clickButton('copy-python-pull-cmd-btn');
        expect(afterPullCopy.html).toContain('✓ Copied');

        // Switch to [TowerForge Link] tab and verify sub-tabs (Emulator, Android Wi-Fi / App, iPhone)
        const linkView = await harness.clickButton('mode-tab-link');
        expect(linkView.html).toContain('data-testid="mode-pane-link"');
        expect(linkView.html).toContain('data-testid="download-windows-link-btn"');

        const phoneSubView = await harness.clickButton('link-subtab-phone');
        expect(phoneSubView.html).toContain('data-testid="download-android-link-btn"');

        const iphoneSubView = await harness.clickButton('link-subtab-iphone');
        expect(iphoneSubView.html).toContain('Apple Devices');

        // Trigger full Link modal callback
        await harness.clickButton('open-full-link-modal-btn');
        expect(onSwitchToLinkModal).toHaveBeenCalledTimes(1);

        // Switch back to [WebUSB] tab
        const webusbView = await harness.clickButton('mode-tab-webusb');
        expect(webusbView.html).toContain('data-testid="mode-pane-webusb"');
    });

    it('8. auto-retries last successful WebUSB method once on open when not connected, turns Auto-Import ON, and stops auto-retrying after failure (TOWERFORGE-22)', async () => {
        saveLastUsbConnectState({ method: 'webusb', lastFailed: false });
        expect(getAutoImportOn()).toBe(false);

        const rawJson = '{"version":26,"player":"AutoRetryWebUsb"}';
        vi.mocked(pullTowerForgeExportViaWebUsb).mockResolvedValueOnce(rawJson);

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });
        harness.render();

        // Flush the queued microtask for single-attempt auto-retry
        await new Promise((r) => setTimeout(r, 0));

        expect(pullTowerForgeExportViaWebUsb).toHaveBeenCalledTimes(1);
        expect(onImport).toHaveBeenCalledTimes(1);
        expect(onImport).toHaveBeenCalledWith(rawJson);
        expect(getAutoImportOn()).toBe(true);
        expect(getLastUsbConnectState()).toEqual({ method: 'webusb', lastFailed: false });

        // Re-rendering the same modal session must NOT trigger a second retry
        harness.render();
        await new Promise((r) => setTimeout(r, 0));
        expect(pullTowerForgeExportViaWebUsb).toHaveBeenCalledTimes(1);

        // Now simulate opening a new modal session where the auto-retry fails
        vi.mocked(pullTowerForgeExportViaWebUsb).mockRejectedValueOnce(new Error('Device unplugged'));
        const onImportFail = vi.fn();
        const failingHarness = renderModalHarness({ onImport: onImportFail });
        failingHarness.render();
        await new Promise((r) => setTimeout(r, 0));

        expect(pullTowerForgeExportViaWebUsb).toHaveBeenCalledTimes(2);
        expect(onImportFail).not.toHaveBeenCalled();
        expect(getAutoImportOn()).toBe(false);
        expect(getLastUsbConnectState()).toEqual({ method: 'webusb', lastFailed: true });

        // Subsequent modal open after failure must NOT auto-retry!
        const onImportAfterFail = vi.fn();
        const noRetryHarness = renderModalHarness({ onImport: onImportAfterFail });
        noRetryHarness.render();
        await new Promise((r) => setTimeout(r, 0));
        expect(pullTowerForgeExportViaWebUsb).toHaveBeenCalledTimes(2); // still 2!
    });

    it('9. auto-retries last successful Python Companion (/ws) method once on open when not connected and turns Auto-Import ON (TOWERFORGE-22)', async () => {
        saveLastUsbConnectState({ method: 'python', lastFailed: false });
        expect(getAutoImportOn()).toBe(false);

        const rawJson = '{"version":26,"player":"AutoRetryPython"}';
        vi.mocked(wsExport).mockResolvedValueOnce({
            id: 'tf-ws-1',
            ok: true,
            data: rawJson,
            modified: 1_762_500_000,
            source: 'Pixel 9 Pro',
            sourceId: 'adb:54221FDAP0011M',
        });

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });
        const initialRender = harness.render();
        expect(initialRender.html).toContain('data-testid="mode-pane-python"');

        await new Promise((r) => setTimeout(r, 0));

        expect(wsExport).toHaveBeenCalledTimes(1);
        expect(onImport).toHaveBeenCalledTimes(1);
        expect(onImport).toHaveBeenCalledWith(rawJson);
        expect(getAutoImportOn()).toBe(true);
        expect(getLastUsbConnectState()).toEqual({ method: 'python', lastFailed: false });
    });

    it('10. does not auto-retry on open when already connected (hasActiveWebUsbSession() === true) (TOWERFORGE-22)', async () => {
        saveLastUsbConnectState({ method: 'webusb', lastFailed: false });
        vi.mocked(hasActiveWebUsbSession).mockReturnValue(true);

        const onImport = vi.fn();
        const harness = renderModalHarness({ onImport });
        const { html } = harness.render();
        await new Promise((r) => setTimeout(r, 0));

        expect(pullTowerForgeExportViaWebUsb).not.toHaveBeenCalled();
        expect(html).toContain('data-testid="usb-session-active-badge"');
        expect(html).toContain('data-testid="usb-disconnect-btn"');

        // Clicking Disconnect USB turns Auto-Import OFF
        setAutoImportOn(true);
        await harness.clickButton('usb-disconnect-btn');
        expect(getAutoImportOn()).toBe(false);
        vi.mocked(hasActiveWebUsbSession).mockReturnValue(false);
    });
});
