// ============================================================
//  TowerForge Companion — Relics Tab
//  Total bonus per category as the game's Relics → ⓘ screen shows it:
//  filled in by Import Game Data (the relics owned, engine/gameExport.ts),
//  or typed in.
// ============================================================

import { useGameStore } from '../../store/useGameStore';
import { RELICS } from '../../constants/gameData';
import NumericInput from '../common/NumericInput';
import PageIntro from '../common/PageIntro';

export default function RelicsTab() {
    const relicData = useGameStore(s => s.relicData);
    const setRelic = useGameStore(s => s.setRelic);

    // Count filled relics
    const filled = Object.values(RELICS)
        .flat()
        .filter(([key]) => (relicData[key] ?? 0) > 0).length;

    const total = Object.values(RELICS).flat().length;

    return (
        <div>
            {/* ── Note ── */}
            <PageIntro title="Relics">
                Relics come with <em>Import Game Data</em>: the totals of every relic you
                own. To enter them by hand, open Profile → Relics in the game and tap the ⓘ at the top
                left — it lists every relic bonus total in this same order, so copy them top to bottom.
                Relics newer than TowerForge&apos;s list are counted when you import; add their bonus here.
            </PageIntro>

            <div className="flex-row" style={{ marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
                    {filled} / {total} filled
                </span>
            </div>

            {/* ── Relic Categories ── */}
            {Object.entries(RELICS).map(([catName, fields]) => (
                <div key={catName} className="section" style={{ marginBottom: '10px' }}>
                    <div className="section-head">
                        <h3>{catName}</h3>
                        <span className="s-badge">
                            {fields.filter(([key]) => (relicData[key] ?? 0) > 0).length}
                            {' / '}
                            {fields.length} filled
                        </span>
                    </div>
                    <div className="section-body">
                        {fields.map(([key, label, , , unit]) => {
                            const val = relicData[key] ?? 0;

                            return (
                                <div key={key} className="field-row">
                                    <label className="field-label">{label}</label>
                                    <NumericInput
                                        value={val}
                                        min={0}
                                        step={unit === '%' ? 1 : 0.1}
                                        onChange={v => setRelic(key, v)}
                                    />
                                    <span className="relic-unit">{unit}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}