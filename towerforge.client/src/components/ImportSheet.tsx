// ============================================================
//  TowerForge Companion — Import help
//  What ⬆ Import opens until a file import has worked on this device
//  (then it goes straight to the file picker): the ways in that work
//  on this device, best first (common/ImportWays). Most players can't
//  just pick the file: the game keeps it where phones' file pickers
//  can't reach (owner, 2026-11-13: make importing as easy as possible).
// ============================================================

import { useEffect } from 'react';
import type { ChangeEvent } from 'react';
import ImportWays from './common/ImportWays';
import type { ImportDevice } from './common/importDevice';

interface Props {
    device: ImportDevice;
    signedIn: boolean;
    onImportFile: (e: ChangeEvent<HTMLInputElement>) => void;
    onLink: () => void;
    onGuide: (part: string) => void;
    onSignIn: () => void;
    onClose: () => void;
}

export default function ImportSheet({ onClose, onImportFile, onLink, onGuide, onSignIn, ...rest }: Props) {
    // Esc closes.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Each way closes the help first; the file is read after.
    const then = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { onClose(); f(...a); };

    return (
        <div className="lnk-overlay" role="dialog" aria-modal="true" aria-labelledby="imp-title" onClick={onClose}>
            <div className="lnk-modal imp-modal" onClick={e => e.stopPropagation()}>
                <div className="lnk-head">
                    <h2 id="imp-title">Bring in your game data</h2>
                    <button className="lnk-close" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className="lnk-body">
                    <p className="lnk-lead">
                        Your workshop, labs, cards, UWs, modules, bots, relics and recent runs, all at once. The game saves
                        them as <code>tool_export.json</code>; here&apos;s how to get it here from{' '}
                        {{ windows: 'this PC', mac: 'this Mac', android: 'this phone', ios: 'an iPhone', other: 'this device' }[rest.device]}:
                    </p>
                    <ImportWays
                        {...rest}
                        onImportFile={then(onImportFile)}
                        onLink={then(onLink)}
                        onGuide={then(onGuide)}
                        onSignIn={then(onSignIn)}
                    />
                </div>
            </div>
        </div>
    );
}
