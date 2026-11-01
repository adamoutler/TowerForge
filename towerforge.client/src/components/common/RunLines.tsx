// ============================================================
//  TowerForge Companion — More from a run
//  The lines of a run the Battle Report panels don't lead with: which enemies
//  each weapon reached, what made the kills, cash and free upgrades.
// ============================================================

import { enemiesReachedText, killsBySourceText, runCashText } from '../../engine/battleReport';
import type { BattleReport } from '../../engine/battleReport';

export default function RunLines({ run }: { run: BattleReport }) {
    const lines: [string, string][] = [
        ['Enemies reached', enemiesReachedText(run, ' · ')],
        ['Kills', killsBySourceText(run, ' · ')],
        ['Cash', runCashText(run, ' · ')],
    ];
    const shown = lines.filter(([, text]) => text);
    if (!shown.length) return null;
    return (
        <details className="runl">
            <summary>More from this run</summary>
            {shown.map(([label, text]) => <p key={label}><strong>{label}:</strong> {text}</p>)}
        </details>
    );
}
