// ============================================================
//  TowerForge Companion — AutoImport Lifecycle & Connect/Disconnect Sync Tests
//  Verifies that AutoImport turns ON when a connection is established,
//  polls over WebUSB / TowerForge Link, and automatically turns OFF
//  whenever the connection is lost or unreachable (TOWERFORGE-22).
// ============================================================

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkExport } from '../../engine/linkClient';
import { closeWebUsbSession, hasActiveWebUsbSession, pollWebUsbAutoExport } from '../../engine/usbLink';
import { makeExport } from '../../test/makeExport';
import AutoImport, {
    getAutoImportOn,
    resetAutoImportUiForTests,
    runAutoImportCheckOnce,
    setAutoImportOn,
} from '../common/AutoImport';

vi.mock('../../engine/linkClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../engine/linkClient')>();
    return {
        ...actual,
        linkExport: vi.fn(actual.linkExport),
    };
});

vi.mock('../../engine/usbLink', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../engine/usbLink')>();
    return {
        ...actual,
        hasActiveWebUsbSession: vi.fn(actual.hasActiveWebUsbSession),
        pollWebUsbAutoExport: vi.fn(actual.pollWebUsbAutoExport),
    };
});

describe('AutoImport Connect/Disconnect State Synchronization (TOWERFORGE-22)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await closeWebUsbSession();
        resetAutoImportUiForTests();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('1. synchronizes <AutoImport /> button state with setAutoImportOn(true) on connect and setAutoImportOn(false) on disconnect', () => {
        const onImport = vi.fn();
        const onNeedsLink = vi.fn();

        const renderToggle = () =>
            renderToStaticMarkup(createElement(AutoImport, { onImport, onNeedsLink }));

        expect(getAutoImportOn()).toBe(false);
        const initialHtml = renderToggle();
        expect(initialHtml).toContain('⟳ Auto import off');
        expect(initialHtml).toContain('aria-pressed="false"');

        // Turn ON upon device connect
        setAutoImportOn(true);
        expect(getAutoImportOn()).toBe(true);
        const connectedHtml = renderToggle();
        expect(connectedHtml).toContain('⟳ Auto import on');
        expect(connectedHtml).toContain('aria-pressed="true"');

        // Turn OFF upon device disconnect
        setAutoImportOn(false);
        expect(getAutoImportOn()).toBe(false);
        const disconnectedHtml = renderToggle();
        expect(disconnectedHtml).toContain('⟳ Auto import off');
        expect(disconnectedHtml).toContain('aria-pressed="false"');
    });

    it('2. imports fresh WebUSB export when connected and keeps Auto-Import ON', async () => {
        setAutoImportOn(true);
        vi.mocked(hasActiveWebUsbSession).mockReturnValue(true);

        const validExport = makeExport();
        vi.mocked(pollWebUsbAutoExport).mockResolvedValueOnce({
            ok: true,
            text: JSON.stringify(validExport),
            modified: 1_762_600_000,
            source: 'Pixel 9 Pro (USB)',
            sourceId: 'webusb:54221FDAP0011M',
        });

        const onImport = vi.fn();
        const onNeedsLink = vi.fn();

        await runAutoImportCheckOnce({ onImport, onNeedsLink }, { firstTry: true });

        expect(pollWebUsbAutoExport).toHaveBeenCalledTimes(1);
        expect(onImport).toHaveBeenCalledTimes(1);
        expect(getAutoImportOn()).toBe(true);

        const html = renderToStaticMarkup(createElement(AutoImport, { onImport, onNeedsLink }));
        expect(html).toContain('⟳ Auto import on');
        expect(html).toContain('Up to date with Pixel 9 Pro (USB)');
    });

    it('3. automatically turns Auto-Import OFF when polling detects disconnection (unreachable)', async () => {
        setAutoImportOn(true);
        vi.mocked(hasActiveWebUsbSession).mockReturnValue(false);
        vi.mocked(linkExport).mockResolvedValueOnce({ ok: false, reason: 'unreachable' });
        vi.mocked(pollWebUsbAutoExport).mockResolvedValueOnce({ ok: false, reason: 'unreachable' });

        const onImport = vi.fn();
        const onNeedsLink = vi.fn();

        expect(getAutoImportOn()).toBe(true);

        await runAutoImportCheckOnce({ onImport, onNeedsLink }, { firstTry: true });

        expect(getAutoImportOn()).toBe(false);
        expect(onNeedsLink).toHaveBeenCalledTimes(1);

        const html = renderToStaticMarkup(createElement(AutoImport, { onImport, onNeedsLink }));
        expect(html).toContain('⟳ Auto import off');
        expect(html).toContain('aria-pressed="false"');
    });
});
