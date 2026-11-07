import { beforeEach, describe, expect, it } from 'vitest';
import pkgRaw from '../../../package.json?raw';
import viteConfigRaw from '../../../vite.config.ts?raw';
import { loadTangoWebUsb, resetTangoWebUsbLoaderCache } from '../usbTangoLoader';

interface PackageJsonShape {
    dependencies?: Record<string, string>;
}

const EXACT_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

describe('Tango WebUSB ADB supply-chain pinning & lazy loader (TOWERFORGE-2)', () => {
    beforeEach(() => {
        resetTangoWebUsbLoaderCache();
    });

    it('pins @yume-chan/adb, @yume-chan/adb-daemon-webusb, and @yume-chan/adb-credential-web to exact 2.x stable semver strings with no ^ or ~ prefix', () => {
        const pkg = JSON.parse(pkgRaw) as PackageJsonShape;
        const deps = pkg.dependencies ?? {};

        expect(deps['@yume-chan/adb']).toBe('2.6.4');
        expect(deps['@yume-chan/adb-daemon-webusb']).toBe('2.3.2');
        expect(deps['@yume-chan/adb-credential-web']).toBe('2.1.0');

        for (const pkgName of [
            '@yume-chan/adb',
            '@yume-chan/adb-daemon-webusb',
            '@yume-chan/adb-credential-web',
        ]) {
            const version = deps[pkgName];
            expect(version).toBeDefined();
            expect(version?.startsWith('^')).toBe(false);
            expect(version?.startsWith('~')).toBe(false);
            expect(version).toMatch(EXACT_SEMVER_PATTERN);
        }
    });

    it('configures manualChunks in vite.config.ts to isolate @yume-chan/* into vendor-webusb', () => {
        expect(viteConfigRaw).toContain('manualChunks');
        expect(viteConfigRaw).toContain('node_modules/@yume-chan/');
        expect(viteConfigRaw).toContain('vendor-webusb');
    });

    it('resolves loadTangoWebUsb() and exposes Adb, AdbDaemonTransport, AdbDaemonWebUsbDeviceManager, and AdbWebCryptoCredentialManager', async () => {
        const tango = await loadTangoWebUsb();

        expect(tango).toBeDefined();
        expect(typeof tango.Adb).toBe('function');
        expect(typeof tango.AdbDaemonTransport).toBe('function');
        expect(typeof tango.AdbDaemonWebUsbDeviceManager).toBe('function');
        expect(typeof tango.AdbWebCryptoCredentialManager).toBe('function');
        expect(tango.AdbWebCredentialStore).toBe(tango.AdbWebCryptoCredentialManager);
    });

    it('caches the resolved bundle promise until resetTangoWebUsbLoaderCache() is called', async () => {
        const firstPromise = loadTangoWebUsb();
        const secondPromise = loadTangoWebUsb();
        expect(secondPromise).toBe(firstPromise);

        const firstBundle = await firstPromise;
        resetTangoWebUsbLoaderCache();

        const thirdBundle = await loadTangoWebUsb();
        expect(thirdBundle.Adb).toBe(firstBundle.Adb);
        expect(thirdBundle.AdbDaemonTransport).toBe(firstBundle.AdbDaemonTransport);
        expect(thirdBundle.AdbDaemonWebUsbDeviceManager).toBe(firstBundle.AdbDaemonWebUsbDeviceManager);
        expect(thirdBundle.AdbWebCryptoCredentialManager).toBe(firstBundle.AdbWebCryptoCredentialManager);
    });
});
