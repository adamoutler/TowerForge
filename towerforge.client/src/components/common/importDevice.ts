// ============================================================
//  TowerForge Companion — Which device is this, for importing
//  Each device has its own way to get the game's export out
//  (docs/towerforge-link.md): the game keeps tool_export.json in its
//  own app folder, which iOS never lets anything open and Android 11+
//  hides from file pickers, so "pick the file" alone rarely works on a
//  phone. The import help shows this device's way first (owner,
//  2026-11-13: 2% of iPhone visitors and 16% of Android ones imported,
//  against 25% on Windows, Umami, 30 days).
// ============================================================

export type ImportDevice = 'windows' | 'mac' | 'android' | 'ios' | 'other';

// iPadOS Safari says "Macintosh" like a Mac; only its touch points tell.
export function importDeviceOf(userAgent: string, maxTouchPoints = 0): ImportDevice {
    if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(userAgent)) return 'android';
    if (/CrOS/.test(userAgent)) return 'other';
    if (/Windows/.test(userAgent)) return 'windows';
    if (/Macintosh|Mac OS X/.test(userAgent)) return 'mac';
    return 'other';
}

export const thisImportDevice = (): ImportDevice =>
    importDeviceOf(navigator.userAgent, navigator.maxTouchPoints ?? 0);

// The Tower on an Apple-silicon Mac keeps its export in the app's
// container; this copies it to the Desktop (docs/towerforge-link.md).
export const MAC_EXPORT_COMMAND = 'cp "$(find ~/Library/Containers -name tool_export.json 2>/dev/null | head -1)" ~/Desktop/';

// Once a file import has worked on this device, ⬆ Import goes straight to
// the file picker; until then it opens the import help first.
const FILE_OK_KEY = 'tf-import-file-ok';

export function fileImportWorkedHere(): boolean {
    try {
        return localStorage.getItem(FILE_OK_KEY) === '1';
    } catch {
        return false;
    }
}

export function rememberFileImport(): void {
    try {
        localStorage.setItem(FILE_OK_KEY, '1');
    } catch {
        // Private browsing: the help just opens again next time.
    }
}
