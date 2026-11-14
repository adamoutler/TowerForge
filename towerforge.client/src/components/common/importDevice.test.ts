// Which device the import help is written for, from real browsers'
// user agents.

import { describe, expect, it } from 'vitest';
import { importDeviceOf } from './importDevice';

describe('import device', () => {
    it('tells phones, PCs and Macs apart', () => {
        expect(importDeviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 5)).toBe('ios');
        // iPadOS Safari asks for desktop pages and says Macintosh; it has touch points.
        expect(importDeviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 5)).toBe('ios');
        expect(importDeviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 0)).toBe('mac');
        expect(importDeviceOf('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36', 5)).toBe('android');
        expect(importDeviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0', 0)).toBe('windows');
        expect(importDeviceOf('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 0)).toBe('other');
        expect(importDeviceOf('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 0)).toBe('other');
    });
});
