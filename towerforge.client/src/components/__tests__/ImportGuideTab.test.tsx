// ============================================================
//  TowerForge Companion — ImportGuideTab & CLAUDE.md Tests
//  Verifies #usb (Direct USB Connect — WebUSB), #linux-macos (Python
//  Companion — macOS & Linux), CLAUDE.md architecture & security
//  documentation, and zero GEMINI.md files in the repository tree.
// ============================================================

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import claudeContent from '../../../../CLAUDE.md?raw';
import ImportGuideTab, { LINK_PY_DOWNLOAD, LINK_PYZ_DOWNLOAD, USB_UDEV_RULES_HREF } from '../ImportGuideTab';
import TabsImportGuideTab from '../tabs/ImportGuideTab';

function extractSectionHtml(fullHtml: string, sectionId: string): string {
    const marker = `<section id="${sectionId}"`;
    const start = fullHtml.indexOf(marker);
    if (start === -1) return '';
    const end = fullHtml.indexOf('</section>', start);
    return end === -1 ? fullHtml.slice(start) : fullHtml.slice(start, end + '</section>'.length);
}

describe('ImportGuideTab (#usb & #linux-macos guides) and CLAUDE.md hygiene', () => {
    it('renders the #usb section containing WebUSB instructions, adb kill-server, and the /linux/51-android-adb-uaccess.rules link', () => {
        for (const Component of [ImportGuideTab, TabsImportGuideTab]) {
            const html = renderToStaticMarkup(createElement(Component));

            // Top quick-choice navigation link to #usb
            expect(html).toContain('href="#usb"');

            // Extract the #usb section specifically
            const usbSection = extractSectionHtml(html, 'usb');
            expect(usbSection).not.toBe('');
            expect(usbSection).toContain('Direct USB Connect — WebUSB');

            // Browser support matrix: Chromium browsers vs Firefox/Safari fallback
            expect(usbSection).toContain('Chrome, Edge, Brave, Opera, Vivaldi');
            expect(usbSection).toContain('Firefox');
            expect(usbSection).toContain('Safari');
            expect(usbSection).toContain('href="#linux-macos"');

            // USB debugging setup: Developer options, File Transfer / MTP, RSA key fingerprint
            expect(usbSection).toContain('Developer options');
            expect(usbSection).toContain('USB debugging');
            expect(usbSection).toContain('File Transfer / MTP');
            expect(usbSection).toContain('RSA key fingerprint');

            // Conflict resolution when local adb or Android Studio claims the interface
            expect(usbSection).toContain('adb kill-server');
            expect(usbSection).toContain('Android Studio');

            // Linux udev rule download link and reload command
            expect(USB_UDEV_RULES_HREF).toBe('/linux/51-android-adb-uaccess.rules');
            expect(usbSection).toContain('href="/linux/51-android-adb-uaccess.rules"');
            expect(usbSection).toContain('sudo udevadm control --reload-rules &amp;&amp; sudo udevadm trigger');
        }
    });

    it('renders the #linux-macos section containing towerforge-link.pyz download link, python3 towerforge-link.pyz serve, and --pull-save instructions', () => {
        for (const Component of [ImportGuideTab, TabsImportGuideTab]) {
            const html = renderToStaticMarkup(createElement(Component));

            // Top quick-choice navigation link to #linux-macos
            expect(html).toContain('href="#linux-macos"');

            // Extract the #linux-macos section specifically
            const posixSection = extractSectionHtml(html, 'linux-macos');
            expect(posixSection).not.toBe('');
            expect(posixSection).toContain('Python Companion — macOS &amp; Linux');

            // Download link, SHA-256 verification, and serve command
            expect(LINK_PY_DOWNLOAD).toBe('/downloads/towerforge-link.py');
            expect(LINK_PYZ_DOWNLOAD).toBe('/downloads/towerforge-link.pyz');
            expect(posixSection).toContain('href="/downloads/towerforge-link.py"');
            expect(posixSection).toContain('href="/downloads/towerforge-link.pyz"');
            expect(posixSection).toContain('sha256sum towerforge-link.py');
            expect(posixSection).toContain('sha256sum towerforge-link.pyz');
            expect(posixSection).toContain('shasum -a 256 towerforge-link.pyz');
            expect(posixSection).toContain('python3 ~/Downloads/towerforge-link.py');
            expect(posixSection).toContain('python3 towerforge-link.pyz serve');

            // Supported POSIX targets
            expect(posixSection).toContain('Waydroid');
            expect(posixSection).toContain('Android Studio AVD');
            expect(posixSection).toContain('Genymotion');
            expect(posixSection).toContain('BlueStacks Air');
            expect(posixSection).toContain('macOS Apple Silicon native container');

            // CLI commands including --pull-save for playerInfo.dat, doctor, and udev-rules
            expect(posixSection).toContain('python3 towerforge-link.pyz pull --pull-save');
            expect(posixSection).toContain('playerInfo.dat');
            expect(posixSection).toContain('python3 towerforge-link.pyz doctor');
            expect(posixSection).toContain('python3 towerforge-link.pyz udev-rules');
        }
    });

    it('verifies CLAUDE.md documents all 3 paths and security controls and zero GEMINI.md files exist in the repository tree', () => {
        // All 3 paths and required module names documented in CLAUDE.md
        expect(claudeContent).toContain('Path 1');
        expect(claudeContent).toContain('Path 2');
        expect(claudeContent).toContain('Path 3');
        expect(claudeContent).toContain('linkClient.ts');
        expect(claudeContent).toContain('usbLink.ts');
        expect(claudeContent).toContain('usbDiagnose.ts');
        expect(claudeContent).toContain('wsLinkClient.ts');
        expect(claudeContent).toContain('UsbLinkModal.tsx');
        expect(claudeContent).toContain('towerforge-link-py');
        expect(claudeContent).toContain('51-android-adb-uaccess.rules');
        expect(claudeContent).toContain('towerforge-link.pyz');

        // Security controls and containerized test commands documented
        expect(claudeContent).toContain('Access-Control-Allow-Private-Network');
        expect(claudeContent).toContain('/proc/net/tcp');
        expect(claudeContent).toContain('shell=False');
        expect(claudeContent).toContain('SERIAL_RE');
        expect(claudeContent).toContain('8 MiB');
        expect(claudeContent).toContain('Permissions-Policy: usb=(self)');
        expect(claudeContent).toContain('docker-compose.dev.yml');

        // Zero GEMINI.md files anywhere in the repository tree
        const geminiModules = import.meta.glob('../../../../**/GEMINI.md');
        expect(Object.keys(geminiModules)).toEqual([]);
    });

    it('exercises interactive navigation, scrollTo, and download click handlers in ImportGuideTab', () => {
        const scrollIntoView = () => undefined;
        const origDoc = globalThis.document;
        const origWin = globalThis.window;
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                getElementById: () => ({ scrollIntoView }),
            },
        });
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {},
        });
        try {
            function walkAndClick(node: unknown): void {
                if (!node || typeof node !== 'object') return;
                if (Array.isArray(node)) {
                    for (const child of node) walkAndClick(child);
                    return;
                }
                const el = node as {
                    type?: unknown;
                    props?: Record<string, unknown>;
                };
                if (typeof el.type === 'function') {
                    walkAndClick((el.type as (p: unknown) => unknown)(el.props ?? {}));
                    return;
                }
                if (el.props) {
                    if (typeof el.props.onClick === 'function') {
                        (el.props.onClick as (e: { preventDefault: () => void }) => void)({
                            preventDefault: () => undefined,
                        });
                    }
                    walkAndClick(el.props.children);
                }
            }

            for (const Comp of [ImportGuideTab, TabsImportGuideTab]) {
                let capturedTree: unknown = null;
                function Wrapper() {
                    const tree = Comp();
                    capturedTree = tree;
                    return tree;
                }
                renderToStaticMarkup(createElement(Wrapper));
                walkAndClick(capturedTree);
            }
        } finally {
            Object.defineProperty(globalThis, 'document', {
                configurable: true,
                value: origDoc,
            });
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: origWin,
            });
        }
    });
});
