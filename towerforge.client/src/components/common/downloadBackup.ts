// ============================================================
//  TowerForge Companion — Download my data
//  Everything TowerForge holds for the player on this device (the
//  same file an account saves), as a JSON file. Import Game Data
//  takes it back. Privacy laws give players a copy of their data
//  (GDPR access and portability); the Account tab and the Privacy
//  page offer it.
// ============================================================

import { useGameStore } from '../../store/useGameStore';

export function downloadBackup(): void {
    const json = useGameStore.getState().exportData();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `towerforge-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
