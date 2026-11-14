// ============================================================
//  TowerForge Companion — Example account bar
//  Under the page tabs while the example account is on
//  (store/exampleAccount.ts), on every page and not folding away, so
//  nobody mistakes the made-up player for their own: what it is, the
//  way to bring in their own data, and the way out.
// ============================================================

import { leaveExample, useExampleOn } from '../../store/exampleAccount';

export default function ExampleBar({ onImport }: { onImport: () => void }) {
    const on = useExampleOn();
    if (!on) return null;
    return (
        <aside className="exa-bar" aria-label="Example account">
            <span className="exa-text">
                <strong>👀 Example account</strong>
                <span className="exa-long">: a made-up player, so you can see what TowerForge does.</span>
                <span className="exa-short"> (a made-up player)</span>
            </span>
            <span className="exa-actions">
                <button type="button" className="btn btn-gold exa-btn" onClick={onImport}>⬆ Bring in yours</button>
                <button type="button" className="btn btn-dim exa-btn" onClick={leaveExample}>Leave example</button>
            </span>
        </aside>
    );
}
