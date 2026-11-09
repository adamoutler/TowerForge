// ============================================================
//  TowerForge Companion — Workshop Tab
//  Stats across 5 presets + Enhancements.
// ============================================================

import { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { WS_STATS, WS_ENH, presetLabel } from '../../constants/gameData';
import NumericInput from '../common/NumericInput';
import { enhForPreset } from '../../engine/statHelpers';
import { workshopOpen } from '../../engine/unlocks';

type WSCat = 'attack' | 'defense' | 'utility';

const CAT_LABELS: Record<WSCat, string> = {
    attack: 'Attack',
    defense: 'Defense',
    utility: 'Utility',
};

export default function WorkshopTab() {
    const [activeSub, setActiveSub] = useState<'stats' | 'enhancements'>('stats');
    const profile = useGameStore(s => s.profile);
    const activePreset = useGameStore(s => s.activePreset);
    const setActivePreset = useGameStore(s => s.setActivePreset);
    const wsData = useGameStore(s => s.wsData);
    const enhData = useGameStore(s => s.enhData);
    const setWSStat = useGameStore(s => s.setWSStat);
    const setEnhLevel = useGameStore(s => s.setEnhLevel);
    const setEnhOwned = useGameStore(s => s.setEnhOwned);

    const presetCount = profile.presets || 2;
    const presets = Array.from({ length: presetCount }, (_, i) => i);

    // ── Max / Clear all stats for current preset ──
    function maxAll() {
        const cats: WSCat[] = ['attack', 'defense', 'utility'];
        cats.forEach(cat => {
            WS_STATS[cat].forEach(([, maxLv], idx) => {
                setWSStat(activePreset, cat, idx, maxLv);
            });
        });
    }

    function clearAll() {
        const cats: WSCat[] = ['attack', 'defense', 'utility'];
        cats.forEach(cat => {
            WS_STATS[cat].forEach((_, idx) => {
                setWSStat(activePreset, cat, idx, 0);
            });
        });
    }

    function copyToNext() {
        const nextIdx = (activePreset + 1) % presetCount;
        const cats: WSCat[] = ['attack', 'defense', 'utility'];
        cats.forEach(cat => {
            WS_STATS[cat].forEach((_, idx) => {
                const val = wsData[activePreset]?.[cat]?.[idx] ?? 0;
                setWSStat(nextIdx, cat, idx, val);
            });
        });
    }

    // Preset selector — also shown on Enhancements once levels are per preset (game import).
    const presetTabs = (
        <div className="preset-tabs">
            {presets.map(i => (
                <button
                    key={i}
                    className={`preset-btn ${activePreset === i ? 'active' : ''}`}
                    onClick={() => setActivePreset(i)}
                >
                    {presetLabel(profile.presetNames, i)}
                </button>
            ))}
        </div>
    );
    const enhLevels = enhForPreset(enhData, activePreset).d;

    return (
        <div>
            {/* ── Sub-tab bar ── */}
            <div className="sub-tab-bar">
                <button
                    className={`sub-tab-btn ${activeSub === 'stats' ? 'active' : ''}`}
                    onClick={() => setActiveSub('stats')}
                >
                    Stats
                </button>
                <button
                    className={`sub-tab-btn ${activeSub === 'enhancements' ? 'active' : ''}`}
                    onClick={() => setActiveSub('enhancements')}
                >
                    Enhancements
                </button>
            </div>

            {/* ── Stats Sub-tab ── */}
            {activeSub === 'stats' && (
                <div>
                    {presetTabs}

                    {/* Actions */}
                    <div className="row-actions">
                        <button className="btn btn-accent" onClick={maxAll}>Max All</button>
                        <button className="btn btn-dim" onClick={clearAll}>Clear All</button>
                        <button className="btn btn-dim" onClick={copyToNext}>Copy → Next</button>
                    </div>

                    {/* Stat categories */}
                    {(['attack', 'defense', 'utility'] as WSCat[]).map(cat => (
                        <div key={cat} className="section" style={{ marginBottom: '10px' }}>
                            <div className="section-head">
                                <h3>{CAT_LABELS[cat]}</h3>
                                <span className="s-badge">
                                    {WS_STATS[cat].filter((_, idx) => {
                                        const lv = wsData[activePreset]?.[cat]?.[idx] ?? 0;
                                        return lv > 0;
                                    }).length} / {WS_STATS[cat].length} upgraded
                                </span>
                            </div>
                            <div className="section-body">
                                {WS_STATS[cat].map(([statName, maxLv], idx) => {
                                    const curLv = wsData[activePreset]?.[cat]?.[idx] ?? 0;
                                    const pct = Math.min(100, Math.round((curLv / maxLv) * 100));
                                    // Not bought in the game's workshop yet (Import Game Data says).
                                    const locked = !workshopOpen(cat, statName, curLv, profile.wsUnlocked);
                                    return (
                                        <div key={statName} className="field-row">
                                            <label className="field-label">
                                                {statName}
                                                <span className="field-sub">
                                                    {locked ? '🔒 Not unlocked in your workshop yet' : `Max ${maxLv.toLocaleString()}`}
                                                </span>
                                            </label>
                                            <div className="ws-stat-input">
                                                <NumericInput
                                                    value={curLv}
                                                    min={0}
                                                    max={maxLv}
                                                    onChange={v => setWSStat(activePreset, cat, idx, v)}
                                                />
                                                <button
                                                    className="btn btn-dim btn-max"
                                                    title={`Max ${statName}`}
                                                    onClick={() => setWSStat(activePreset, cat, idx, maxLv)}
                                                >
                                                    Max
                                                </button>
                                                <div className="pbar-wrap">
                                                    <div className="pbar">
                                                        <div
                                                            className={`pbar-fill ${pct >= 100 ? 'gold' : ''}`}
                                                            style={{ width: `${pct}%` }}
                                                        />
                                                    </div>
                                                    <div className="pbar-pct">{pct}%</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Enhancements Sub-tab ── */}
            {activeSub === 'enhancements' && (
                <div>
                    {enhData.p && presetTabs}
                    {(['attack', 'defense', 'utility'] as WSCat[]).map(cat => (
                        <div key={cat} className="section" style={{ marginBottom: '10px' }}>
                            <div className="section-head">
                                <h3>{CAT_LABELS[cat]} Enhancements</h3>
                            </div>
                            <div className="section-body">
                                {WS_ENH[cat].map(([enhName, maxLv, isFree, step], idx) => {
                                    const owned = enhData.u?.[cat]?.[idx] ?? isFree;
                                    const curLv = enhLevels[cat]?.[idx] ?? 0;
                                    const mult = (1 + curLv * step).toFixed(2);
                                    return (
                                        <div
                                            key={enhName}
                                            className={`enh-row ${!owned ? 'enh-locked' : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={!!owned}
                                                disabled={isFree}
                                                onChange={e => setEnhOwned(cat, idx, e.target.checked)}
                                                title={isFree ? 'Free unlock' : 'Mark as owned'}
                                            />
                                            <label className="field-label">
                                                {enhName}
                                                <span className="field-sub">
                                                    Max {maxLv} · {(step * 100).toFixed(0)}% per level
                                                </span>
                                            </label>
                                            <NumericInput
                                                value={curLv}
                                                min={0}
                                                max={maxLv}
                                                disabled={!owned}
                                                onChange={v => setEnhLevel(cat, idx, v)}
                                            />
                                            <span className="enh-mult" style={{
                                                color: owned ? 'var(--accent)' : 'var(--text-dim)',
                                            }}>
                                                {owned ? `${mult}x` : '—'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

        </div>
    );
}