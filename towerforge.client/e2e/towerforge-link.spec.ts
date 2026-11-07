import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');
const screenshotsDir = path.resolve(repoRoot, 'docs/qa/TOWERFORGE-16/screenshots');
const screenshotsDir19 = path.resolve(repoRoot, 'docs/qa/TOWERFORGE-19/screenshots');
const pyzBinaryPath = path.resolve(currentDir, '../public/downloads/towerforge-link.pyz');
const fixtureDir = '/tmp/tf-e2e-fixture-towerforge-16';
const fixtureExportPath = path.join(fixtureDir, 'tool_export.json');
const mockAdbPath = path.join(fixtureDir, 'mock-adb.py');

const SYNTHETIC_EXPORT_OBJECT = {
    VersionNumber: 291,
    DataVersion: 3,
    ExportVersion: 1,
    ExportedAt: '2026-11-06T18:30:00Z',
    UserName: 'TowerForgeQA',
    Coins: 4.6e18,
    Gems: 5200,
    Stones: 1850,
    Medals: 2700,
    Cells: 3100000,
    Keys: 40,
    Tokens: 120,
    Bits: 620,
    HighestLeague: 5,
    LeagueID: 5,
    HighestWaveThisTier: [
        0,
        22000, 20000, 18500, 17000, 16000, 15000,
        14500, 14000, 13500, 13000, 12500, 12000,
        11500, 11000, 10600, 10200, 9800, 9150,
    ],
    UltimateWeaponUnlocked: [true, true, true, true, true, true, true, true, true],
    UltimateWeaponLevel: Array.from({ length: 27 }, () => 10),
    UltimateWeaponPlusUnlocked: [true, true, true, true, true, true, true, true, true],
    UltimateWeaponPlusLevel: Array.from({ length: 9 }, () => 4),
    ResearchLevel: Array.from({ length: 260 }, () => 25),
    LabsUnlocked: 4,
    SlotsUnlocked: 18,
    UpgradeWorkshopLevel: [5500, 99, 79, 200, 120, 100],
    UpgradeWorkshopDefenseLevel: [5500, 5000, 99, 99, 200, 1500],
    UpgradeWorkshopUtilityLevel: [500, 500, 200, 100, 100, 100],
    BattleHistory: [
        {
            BattleDate: '2026-11-06T12:00:00Z',
            Tier: 18,
            Wave: 9150,
            GameTime: 42000,
            RealTime: 21000,
            CoinsEarned: 9.9e17,
            TotalEnemies: 320000,
            IsTournament: false,
        },
    ],
};

const SYNTHETIC_EXPORT_JSON = JSON.stringify(SYNTHETIC_EXPORT_OBJECT, null, 2);

const MOCK_ADB_SCRIPT = `#!/usr/bin/env python3
import shutil
import sys

args = sys.argv[1:]

if not args:
    sys.exit(0)

if args[0] == "version":
    print("Android Debug Bridge version 1.0.41")
    print("Version 35.0.2-towerforge-e2e")
    sys.exit(0)

if args[0] == "kill-server":
    print("ADB server stopped.")
    sys.exit(0)

if args[0] == "devices":
    print("List of devices attached")
    print("54221FDAP0011M         device usb:1-4.3 product:caiman model:Pixel_9_Pro device:caiman transport_id:1")
    print("192.168.240.112:5555   device product:waydroid_x86_64 model:Waydroid_x86_64 device:waydroid_x86_64 transport_id:2")
    sys.exit(0)

serial = None
rest = list(args)
if len(rest) >= 2 and rest[0] == "-s":
    serial = rest[1]
    rest = rest[2:]

if not rest:
    sys.exit(0)

cmd = rest[0]
if cmd == "ls":
    target_dir = rest[1] if len(rest) > 1 else ""
    if target_dir.rstrip("/") == "/sdcard/Android/data/com.TechTreeGames.TheTower/files":
        print("000041ed 00001000 690ce000 .")
        print("000041ed 00001000 690ce000 ..")
        print("000081b0 00001200 690ce000 tool_export.json")
        print("000081b0 00000800 690ce000 playerInfo.dat")
    sys.exit(0)

if cmd == "pull" and len(rest) >= 3:
    dest_path = rest[2]
    shutil.copyfile(${JSON.stringify(fixtureExportPath)}, dest_path)
    print(f"1 file pulled, 0 skipped.")
    sys.exit(0)

sys.exit(0)
`;

function createMockVendorWebUsbModule(rawExportJson: string): string {
    return `
const EXPORT_BYTES = new TextEncoder().encode(${JSON.stringify(rawExportJson)});

class MockAdbDaemonWebUsbDevice {
    constructor(rawDevice) {
        this.raw = rawDevice;
        this.serial = rawDevice.serialNumber || '54221FDAP0011M';
        this.name = rawDevice.productName || 'Pixel 9 Pro';
    }
    async connect() {
        if (typeof this.raw.open === 'function') {
            await this.raw.open();
        }
        if (typeof this.raw.claimInterface === 'function') {
            await this.raw.claimInterface(1);
        }
        return { serial: this.serial, device: this.raw };
    }
}

class MockAdbDaemonWebUsbDeviceManager {
    static BROWSER = undefined;
    constructor(usb) {
        this.usb = usb || (typeof navigator !== 'undefined' ? navigator.usb : null);
    }
    async requestDevice() {
        const usb = this.usb || (typeof navigator !== 'undefined' ? navigator.usb : null);
        if (!usb || typeof usb.requestDevice !== 'function') {
            throw new Error('WebUSB is not supported in this browser.');
        }
        const rawDevice = await usb.requestDevice({ filters: [{ classCode: 0xff, subclassCode: 0x42, protocolCode: 1 }] });
        if (!rawDevice) {
            return undefined;
        }
        return new MockAdbDaemonWebUsbDevice(rawDevice);
    }
}

class MockAdbDaemonTransport {
    static async authenticate({ serial, connection, credentialStore }) {
        if (credentialStore && typeof credentialStore.generateKey === 'function') {
            try {
                await credentialStore.generateKey();
            } catch {
                // Ignore key generation errors in mock transport
            }
        }
        return { serial, connection };
    }
}

class MockAdb {
    constructor(transport) {
        this.transport = transport;
    }
    async sync() {
        return {
            async stat(remotePath) {
                if (remotePath.endsWith('tool_export.json')) {
                    return {
                        size: EXPORT_BYTES.byteLength,
                        mtime: Math.floor(Date.now() / 1000) - 45,
                        mode: 0o100644,
                    };
                }
                throw new Error('ENOENT: ' + remotePath);
            },
            read() {
                let emitted = false;
                return {
                    getReader() {
                        return {
                            async read() {
                                if (emitted) {
                                    return { done: true, value: undefined };
                                }
                                emitted = true;
                                return { done: false, value: EXPORT_BYTES };
                            },
                            releaseLock() {},
                            async cancel() {},
                        };
                    },
                };
            },
            async dispose() {},
        };
    }
    async close() {}
}

class MockAdbWebCryptoCredentialManager {
    constructor(appName = 'TowerForge') {
        this.appName = appName;
    }
    async generateKey() {
        return { buffer: new Uint8Array(32), name: this.appName + '@localhost' };
    }
    async *iterateKeys() {}
}

export const n = { Adb: MockAdb, AdbDaemonTransport: MockAdbDaemonTransport };
export const t = { AdbDaemonWebUsbDeviceManager: MockAdbDaemonWebUsbDeviceManager };
export const r = { default: MockAdbWebCryptoCredentialManager };
`;
}

async function waitForCompanionReady(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch('http://127.0.0.1:47821/status');
            if (res.ok) {
                return;
            }
        } catch {
            // Companion still starting up
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Timed out waiting for towerforge-link.pyz companion on 127.0.0.1:47821.');
}

async function installWebUsbMocks(page: Page, options: { failAttempts: number }): Promise<void> {
    await page.addInitScript(({ failCount }) => {
        let claimAttempts = 0;
        const mockUsb = {
            async getDevices() {
                return [];
            },
            async requestDevice() {
                return {
                    vendorId: 0x18d1,
                    productId: 0x4ee7,
                    productName: 'Pixel 9 Pro',
                    serialNumber: '54221FDAP0011M',
                    opened: false,
                    async open() {
                        this.opened = true;
                    },
                    async claimInterface() {
                        claimAttempts += 1;
                        if (claimAttempts <= failCount) {
                            throw new DOMException('Unable to claim interface', 'NetworkError');
                        }
                    },
                };
            },
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
                return true;
            },
        };
        Object.defineProperty(navigator, 'usb', {
            configurable: true,
            enumerable: true,
            get: () => mockUsb,
        });
    }, { failCount: options.failAttempts });

    await page.route('**/assets/vendor-webusb-*.js', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: createMockVendorWebUsbModule(SYNTHETIC_EXPORT_JSON),
        });
    });

    await page.route('http://127.0.0.1:47821/usb/owner*', async (route) => {
        const upstream = await route.fetch();
        const body = (await upstream.json()) as Record<string, unknown>;
        const enriched = {
            ...body,
            ok: true,
            platform: 'linux',
            vid: '18d1',
            pid: '4ee7',
            devnode_writable: true,
            busy: true,
            holders: [{ pid: 4812, comm: 'adb' }],
            recommended_action: 'adb kill-server',
        };
        await route.fulfill({
            status: 200,
            headers: {
                ...upstream.headers(),
                'content-type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(enriched),
        });
    });
}

test.describe('TOWERFORGE-16 — TowerForge Link E2E Suite & Visual Proof Capture', () => {
    let companionProcess: child_process.ChildProcess | null = null;

    test.beforeAll(async () => {
        fs.mkdirSync(screenshotsDir, { recursive: true });
        fs.mkdirSync(screenshotsDir19, { recursive: true });
        fs.mkdirSync(fixtureDir, { recursive: true });
        fs.writeFileSync(fixtureExportPath, SYNTHETIC_EXPORT_JSON, { encoding: 'utf-8', mode: 0o600 });
        fs.writeFileSync(mockAdbPath, MOCK_ADB_SCRIPT, { encoding: 'utf-8', mode: 0o755 });
        fs.chmodSync(mockAdbPath, 0o755);

        companionProcess = child_process.spawn(
            'python3',
            [
                pyzBinaryPath,
                '--adb-path',
                mockAdbPath,
                'serve',
                '--bind',
                '127.0.0.1',
                '--port',
                '47821',
            ],
            {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: {
                    ...env,
                    HOME: fixtureDir,
                },
            },
        );

        await waitForCompanionReady();
    });

    test.afterAll(async () => {
        if (companionProcess && companionProcess.exitCode === null) {
            companionProcess.kill('SIGTERM');
            await new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                    companionProcess?.kill('SIGKILL');
                    resolve();
                }, 3000);
                companionProcess?.once('exit', () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    });

    test('Test Case 1 — Responsive Captures (1920x1080, 768x1024, 375x667) with zero page errors', async ({ page }) => {
        const pageErrors: string[] = [];
        page.on('pageerror', (err) => {
            pageErrors.push(err.message);
        });

        // 1. Desktop (1920x1080)
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto('/', { waitUntil: 'networkidle' });
        await expect(page.locator('.app-header')).toBeVisible();
        await expect(page.locator('.app-header').getByRole('button', { name: /Get from emulator or phone/i })).toBeVisible();
        await expect(page.getByTestId('connect-usb-phone-btn')).toBeVisible();
        await page.screenshot({
            path: path.join(screenshotsDir, 'responsive-desktop.png'),
            fullPage: false,
        });

        // 2. Tablet (768x1024)
        await page.setViewportSize({ width: 768, height: 1024 });
        await expect(page.locator('.app-shell')).toBeVisible();
        await page.screenshot({
            path: path.join(screenshotsDir, 'responsive-tablet.png'),
            fullPage: false,
        });

        // 3. Mobile (375x667)
        await page.setViewportSize({ width: 375, height: 667 });
        await expect(page.locator('.app-shell')).toBeVisible();
        await page.screenshot({
            path: path.join(screenshotsDir, 'responsive-mobile.png'),
            fullPage: false,
        });

        expect(pageErrors).toEqual([]);
    });

    test('Test Case 2 — Path 1 E2E Journey ("🖥 Get from emulator or phone" via live towerforge-link.pyz)', async ({ page }) => {
        const dialogMessages: string[] = [];
        page.on('dialog', async (dialog) => {
            dialogMessages.push(dialog.message());
            await dialog.accept();
        });

        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'networkidle' });

        const getFromEmulatorBtn = page.locator('.app-header').getByRole('button', { name: /Get from emulator or phone/i });
        const connectUsbBtn = page.getByTestId('connect-usb-phone-btn');
        await expect(getFromEmulatorBtn).toBeVisible();
        await expect(connectUsbBtn).toBeVisible();
        await expect(page.locator('.summary-bar')).toContainText('—');

        // Capture before-click state showing both Path 1 and Path 2 buttons coexisting
        await page.screenshot({
            path: path.join(screenshotsDir, 'path1-before-click.png'),
            fullPage: false,
        });

        // Verify LinkModal.tsx (⚙ setup button) detects live towerforge-link.pyz on 127.0.0.1:47821
        await page.getByRole('button', { name: 'Set up TowerForge Link' }).click();
        const linkStatusBanner = page.locator('.lnk-modal .lnk-status.on');
        await expect(linkStatusBanner).toContainText('TowerForge Link 0.1.0 is running');
        await expect(linkStatusBanner).toContainText('Waydroid');
        await expect(linkStatusBanner).toContainText('Pixel 9 Pro (54221FDAP0011M)');
        await page.locator('.lnk-modal .lnk-close').click();

        // Click "🖥 Get from emulator or phone" to open the discovered sources picker from /sources
        await getFromEmulatorBtn.click();
        const sourcePickerDialog = page.getByRole('dialog', { name: 'Import from…' });
        await expect(sourcePickerDialog).toBeVisible();
        await expect(sourcePickerDialog).toContainText('Pixel 9 Pro (54221FDAP0011M)');
        await expect(sourcePickerDialog).toContainText('Waydroid');

        await page.screenshot({
            path: path.join(screenshotsDir, 'path1-modal-sources.png'),
            fullPage: false,
        });

        // Select Pixel 9 Pro source and trigger import of tool_export.json
        await sourcePickerDialog.getByText('Pixel 9 Pro (54221FDAP0011M)').click();
        await sourcePickerDialog.getByRole('button', { name: /Import/i }).click();

        // Verify import completes, dialog was accepted, and TowerForge state is populated
        await expect(sourcePickerDialog).toBeHidden();
        await expect(page.locator('.summary-bar')).toContainText('T19');
        await expect(page.locator('.summary-bar')).toContainText('Legend');
        await expect(page.locator('.summary-bar')).toContainText('9/9');
        await expect(page.locator('.summary-bar')).toContainText('198');
        expect(dialogMessages.some((m) => m.includes('Imported from your game data'))).toBe(true);

        await page.screenshot({
            path: path.join(screenshotsDir, 'path1-after-import.png'),
            fullPage: false,
        });
    });

    test('Test Case 3 — Path 2 E2E Journey ("🔌 Connect USB phone" — Conflict Diagnosis + WebUSB Sync Pull)', async ({ page }) => {
        const dialogMessages: string[] = [];
        page.on('dialog', async (dialog) => {
            dialogMessages.push(dialog.message());
            await dialog.accept();
        });

        await installWebUsbMocks(page, { failAttempts: 1 });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'networkidle' });

        // Open UsbLinkModal
        await page.getByTestId('connect-usb-phone-btn').click();
        const usbModal = page.getByTestId('usb-link-modal');
        await expect(usbModal).toBeVisible();
        await expect(page.getByTestId('mode-tab-link')).toBeVisible();
        await expect(page.getByTestId('mode-tab-webusb')).toBeVisible();
        await expect(page.getByTestId('mode-tab-python')).toBeVisible();
        await expect(page.getByTestId('usb-current-stage')).toHaveText('idle');
        await expect(page.getByTestId('remember-usb-device-checkbox')).toBeChecked();

        await page.screenshot({
            path: path.join(screenshotsDir, 'path2-modal-open.png'),
            fullPage: false,
        });
        await page.screenshot({
            path: path.join(screenshotsDir19, 'tab-webusb-compact.png'),
            fullPage: false,
        });

        // Switch to [TowerForge Link] tab and capture screenshot
        await page.getByTestId('mode-tab-link').click();
        await expect(page.getByTestId('mode-pane-link')).toBeVisible();
        await page.screenshot({
            path: path.join(screenshotsDir19, 'tab-towerforge-link.png'),
            fullPage: false,
        });

        // Switch to [TowerForge Link Python] tab and capture screenshot
        await page.getByTestId('mode-tab-python').click();
        await expect(page.getByTestId('mode-pane-python')).toBeVisible();
        await expect(page.getByTestId('copy-python-serve-cmd-btn')).toBeVisible();
        await page.screenshot({
            path: path.join(screenshotsDir19, 'tab-python-companion.png'),
            fullPage: false,
        });

        // Switch back to [WebUSB] tab
        await page.getByTestId('mode-tab-webusb').click();
        await expect(page.getByTestId('mode-pane-webusb')).toBeVisible();

        // First attempt: triggers claimInterface NetworkError + live :47821/usb/owner enrichment
        await page.getByTestId('usb-connect-primary-btn').click();
        const diagnosisCard = page.getByTestId('usb-diagnosis-card');
        await expect(diagnosisCard).toBeVisible();
        await expect(diagnosisCard).toHaveAttribute('data-diagnosis-kind', 'adb-server-owning-interface');
        await expect(page.getByTestId('usb-diagnosis-holder')).toContainText('adb');
        await expect(page.getByTestId('usb-diagnosis-holder')).toContainText('4812');
        await expect(page.getByTestId('usb-diagnosis-commands')).toContainText('adb kill-server');
        await expect(page.getByTestId('ws-kill-adb-retry-btn')).toBeVisible();
        await expect(page.getByTestId('retry-usb-connect-btn')).toBeVisible();

        // Scroll diagnosis card into view so all remediation controls are clearly visible
        await diagnosisCard.scrollIntoViewIfNeeded();
        await page.screenshot({
            path: path.join(screenshotsDir, 'path2-diagnosis-adb-owner.png'),
            fullPage: false,
        });
        await page.screenshot({
            path: path.join(screenshotsDir19, 'tab-webusb-diagnosis.png'),
            fullPage: false,
        });

        // Second attempt: click "Stop Local ADB Server & Retry USB", which invokes adb.kill_server
        // over ws://127.0.0.1:47821/ws and then completes the WebUSB sync pull of tool_export.json
        await page.getByTestId('ws-kill-adb-retry-btn').click();
        await expect(usbModal).toBeHidden();
        await expect(page.locator('.summary-bar')).toContainText('T19');
        await expect(page.locator('.summary-bar')).toContainText('Legend');
        await expect(page.locator('.summary-bar')).toContainText('9/9');
        await expect(page.locator('.summary-bar')).toContainText('198');
        expect(dialogMessages.some((m) => m.includes('Imported from your game data'))).toBe(true);

        await page.screenshot({
            path: path.join(screenshotsDir, 'path2-after-import.png'),
            fullPage: false,
        });
    });

    test('Test Case 4 — Path 3 WebSocket Companion Journey (/ws) & In-App Guide (#usb and #linux-macos)', async ({ page }) => {
        const dialogMessages: string[] = [];
        page.on('dialog', async (dialog) => {
            dialogMessages.push(dialog.message());
            await dialog.accept();
        });

        await installWebUsbMocks(page, { failAttempts: 2 });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'networkidle' });

        // Open UsbLinkModal and trigger the error card to reveal the Python Companion (/ws) actions
        await page.getByTestId('connect-usb-phone-btn').click();
        await page.getByTestId('usb-connect-primary-btn').click();

        const downloadPyzLink = page.getByTestId('download-companion-pyz-link');
        const wsExportBtn = page.getByTestId('ws-companion-export-btn');
        await expect(downloadPyzLink).toBeVisible();
        await expect(downloadPyzLink).toHaveAttribute('href', '/downloads/towerforge-link.pyz');
        await expect(wsExportBtn).toBeVisible();

        // Click "Import via Python Companion (/ws)" connected to live ws://127.0.0.1:47821/ws
        await wsExportBtn.click();
        await expect(page.getByTestId('usb-link-modal')).toBeHidden();
        await expect(page.locator('.summary-bar')).toContainText('T19');
        await expect(page.locator('.summary-bar')).toContainText('Legend');
        await expect(page.locator('.summary-bar')).toContainText('9/9');
        await expect(page.locator('.summary-bar')).toContainText('198');
        expect(dialogMessages.some((m) => m.includes('Imported from your game data'))).toBe(true);

        await page.screenshot({
            path: path.join(screenshotsDir, 'path3-ws-companion.png'),
            fullPage: false,
        });

        // Navigate to Import Guide tab (#usb and #linux-macos)
        await page.getByRole('link', { name: 'Import Guide' }).click();
        const usbGuideSection = page.locator('section#usb');
        const linuxMacosGuideSection = page.locator('section#linux-macos');

        await expect(usbGuideSection).toBeVisible();
        await expect(usbGuideSection).toContainText('Direct USB Connect — WebUSB');
        await expect(usbGuideSection).toContainText('/linux/51-android-adb-uaccess.rules');

        await expect(linuxMacosGuideSection).toBeVisible();
        await expect(linuxMacosGuideSection).toContainText('Python Companion — macOS & Linux (towerforge-link.pyz)');
        await expect(linuxMacosGuideSection).toContainText('/downloads/towerforge-link.py');
        await expect(linuxMacosGuideSection).toContainText('/downloads/towerforge-link.pyz');
        await expect(linuxMacosGuideSection).toContainText('python3 towerforge-link.pyz pull --pull-save');

        await page.setViewportSize({ width: 1440, height: 1800 });
        await page.evaluate(() => {
            const udevLink = document.querySelector('section#usb a[href="/linux/51-android-adb-uaccess.rules"]');
            const heading = udevLink?.closest('section')?.querySelectorAll('h4');
            const target = heading && heading.length > 0 ? heading[heading.length - 1] : udevLink;
            if (target) {
                target.scrollIntoView({ block: 'start' });
            }
        });
        await page.screenshot({
            path: path.join(screenshotsDir, 'guide-usb-linux-macos.png'),
            fullPage: false,
        });
    });
});
