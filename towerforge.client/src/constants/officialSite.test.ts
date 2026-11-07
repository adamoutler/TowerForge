// ============================================================
//  TowerForge Companion — Official site check tests
//  The "this is a copy" note shows on any address but towerforge.net
//  and local development.
// ============================================================

import { describe, expect, it } from 'vitest';
import { isOfficialHost } from './officialSite';

describe('isOfficialHost', () => {
    it('counts towerforge.net and its www name', () => {
        expect(isOfficialHost('towerforge.net')).toBe(true);
        expect(isOfficialHost('www.towerforge.net')).toBe(true);
        expect(isOfficialHost('TowerForge.net.')).toBe(true);
        expect(isOfficialHost('towerforge-net.translate.goog')).toBe(true);
    });

    it('counts local development and a PC’s own network', () => {
        for (const host of ['localhost', '127.0.0.1', '[::1]', 'app.localhost', 'towerforge.test', '192.168.1.20', '10.0.0.5', '172.20.3.4']) {
            expect(isOfficialHost(host), host).toBe(true);
        }
    });

    it('flags a copy on any other address', () => {
        for (const host of ['towerforge.example.com', 'towerforge.net.example.com', 'faketowerforge.net', 'towerforge.com', '203.0.113.7', '172.32.0.1', 'localhost.example.com', '']) {
            expect(isOfficialHost(host), host).toBe(false);
        }
    });
});
