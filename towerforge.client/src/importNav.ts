// ============================================================
//  TowerForge Companion — Import from anywhere
//  A page asks for a fresh import (Profile's "Import again"): App runs
//  the quickest way this device has — TowerForge Link if an import came
//  through it here, else ⬆ Import (the file picker once a file import
//  has worked, the import help before that). And after the first import
//  through Link, the Auto import button offers itself once.
// ============================================================

export const IMPORT_EVENT = 'tf-import-now';
export const AUTO_OFFER_EVENT = 'tf-auto-import-offer';

// Call from a click: the file picker only opens inside one.
export function askImport(): void {
    window.dispatchEvent(new Event(IMPORT_EVENT));
}

const OFFERED_KEY = 'tf-auto-import-offered';

// Once per browser: the Auto import button shows its offer.
export function offerAutoImport(): void {
    try {
        if (localStorage.getItem(OFFERED_KEY) === '1') return;
        localStorage.setItem(OFFERED_KEY, '1');
    } catch {
        return;
    }
    window.dispatchEvent(new Event(AUTO_OFFER_EVENT));
}
