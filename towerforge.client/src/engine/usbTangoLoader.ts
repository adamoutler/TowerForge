// ============================================================
//  TowerForge Companion — Lazy Loader for Tango WebUSB ADB (2.x)
//  Dynamically imports @yume-chan/adb, @yume-chan/adb-daemon-webusb,
//  and @yume-chan/adb-credential-web so the WebUSB transport stack
//  is isolated into the lazy `vendor-webusb` chunk and never loaded
//  until the user initiates a USB link action.
// ============================================================

export type TangoAdbModule = typeof import('@yume-chan/adb');
export type TangoWebUsbModule = typeof import('@yume-chan/adb-daemon-webusb');
export type TangoCredentialManagerConstructor = typeof import('@yume-chan/adb-credential-web').default;

export type TangoWebUsbBundle = TangoAdbModule &
    TangoWebUsbModule & {
        Adb: TangoAdbModule['Adb'];
        AdbDaemonTransport: TangoAdbModule['AdbDaemonTransport'];
        AdbDaemonWebUsbDeviceManager: TangoWebUsbModule['AdbDaemonWebUsbDeviceManager'];
        AdbWebCryptoCredentialManager: TangoCredentialManagerConstructor;
        AdbWebCredentialStore: TangoCredentialManagerConstructor;
    };

let cachedBundlePromise: Promise<TangoWebUsbBundle> | null = null;

/**
 * Lazily loads the pinned Tango 2.x WebUSB ADB libraries on demand.
 */
export function loadTangoWebUsb(): Promise<TangoWebUsbBundle> {
    if (!cachedBundlePromise) {
        cachedBundlePromise = Promise.all([
            import('@yume-chan/adb'),
            import('@yume-chan/adb-daemon-webusb'),
            import('@yume-chan/adb-credential-web'),
        ])
            .then(([adbModule, webUsbModule, credentialModule]) => {
                const CredentialManager = credentialModule.default;
                return {
                    ...adbModule,
                    ...webUsbModule,
                    Adb: adbModule.Adb,
                    AdbDaemonTransport: adbModule.AdbDaemonTransport,
                    AdbDaemonWebUsbDeviceManager: webUsbModule.AdbDaemonWebUsbDeviceManager,
                    AdbWebCryptoCredentialManager: CredentialManager,
                    AdbWebCredentialStore: CredentialManager,
                };
            })
            .catch((err: unknown) => {
                cachedBundlePromise = null;
                throw err;
            });
    }
    return cachedBundlePromise;
}

/**
 * Resets the cached loader promise (for isolated unit testing).
 */
export function resetTangoWebUsbLoaderCache(): void {
    cachedBundlePromise = null;
}
