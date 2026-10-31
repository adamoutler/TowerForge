// ============================================================
//  TowerForge Companion — Dissonant Boosts panel (Tiers tab)
//  Like the game's Dissonant Boosts screen: each tier's best Dissonant Run
//  wave and boost on every track, imported or typed in, plus what's left to
//  gain on the tier you farm (engine/dissonance.ts).
// ============================================================

import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { defaultBattleIndex } from '../../engine/gameExport';
import {
    BOOST_FULL_WAVE, DISSONANCE_TRACKS, DISSONANCE_UNLOCK, ECHO_LABS, TRACK_LABEL, TRACK_STAT, echoShare, trackBoost,
} from '../../engine/dissonance';
import { milestoneReached } from '../../engine/statHelpers';
import { LABS, MAX_TIER } from '../../constants/gameData';

type View = 'total' | 'boost' | 'echo';
const VIEWS: [View, string][] = [['total', 'Boost + Echo'], ['boost', 'Boost Only'], ['echo', 'Echo Only']];

const LAB_MAX = new Map(LABS.flatMap(g => g.l).map(([name, max]) => [name, max] as const));
const times = (v: number) => `×${v.toFixed(2)}`;

export default function DissonancePanel() {
    const waves = useGameStore(s => s.dissonanceWaves);
    const labData = useGameStore(s => s.labData);
    const profile = useGameStore(s => s.profile);
    const tierWaves = useGameStore(s => s.tierWaves);
    const battles = useGameStore(s => s.importedBattles);
    const setWave = useGameStore(s => s.setDissonanceWave);
    const [view, setView] = useState<View>('total');

    const highest = Math.min(MAX_TIER, profile.highestTier || 0);
    const usual = useMemo(() => battles[defaultBattleIndex(battles)]?.tier ?? 0, [battles]);
    const farm = usual || highest;
    const open = milestoneReached(DISSONANCE_UNLOCK.tier, DISSONANCE_UNLOCK.wave, profile.completedTier || 0, tierWaves);

    if (!open) {
        return (
            <div className="section">
                <div className="section-head"><h3>Dissonant Boosts</h3></div>
                <div className="section-body">
                    <p className="diss-note">Dissonance unlocks at Tier {DISSONANCE_UNLOCK.tier} Wave {DISSONANCE_UNLOCK.wave}.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="section">
            <div className="section-head">
                <h3>Dissonant Boosts</h3>
                {farm > 0 && <span className="s-badge">T{farm}</span>}
            </div>
            <div className="section-body">
                <div className="diss-echo">
                    <span className="diss-echo-title">Dissonant Echo</span>
                    {DISSONANCE_TRACKS.map(t => (
                        <span key={t} className="diss-echo-track">
                            {TRACK_LABEL[t]} <strong>{(echoShare(labData, t) * 100).toFixed(1)}%</strong>
                        </span>
                    ))}
                </div>

                {farm > 0 && (
                    <table className="diss-table diss-now">
                        <thead>
                            <tr>
                                <th>{usual ? `T${farm}, where you farm` : `T${farm}`}</th>
                                <th>Now</th>
                                <th>At W{BOOST_FULL_WAVE.toLocaleString()}</th>
                                <th>Next Echo level</th>
                            </tr>
                        </thead>
                        <tbody>
                            {DISSONANCE_TRACKS.map(t => {
                                const now = trackBoost(waves, t, farm, labData);
                                const filled = trackBoost(
                                    { ...waves, [t]: Object.assign([...(waves[t] ?? [])], { [farm]: BOOST_FULL_WAVE }) }, t, farm, labData,
                                );
                                const lab = ECHO_LABS[t];
                                const lv = labData[lab] ?? 0;
                                const next = trackBoost(waves, t, farm, { ...labData, [lab]: lv + 1 });
                                return (
                                    <tr key={t}>
                                        <td>{TRACK_LABEL[t]} <span className="diss-stat">{TRACK_STAT[t]}</span></td>
                                        <td>{times(now.total)}</td>
                                        <td>{now.wave >= BOOST_FULL_WAVE ? 'full' : times(filled.total)}</td>
                                        <td>{lv >= (LAB_MAX.get(lab) ?? 0) ? 'maxed' : `+${((next.total / now.total - 1) * 100).toFixed(1)}%`}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}

                <div className="diss-views">
                    {VIEWS.map(([key, label]) => (
                        <button key={key} className={`preset-btn ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>{label}</button>
                    ))}
                </div>

                {highest > 0 ? (
                    <table className="diss-table diss-tiers">
                        <thead>
                            <tr>
                                <th>Tier</th>
                                {DISSONANCE_TRACKS.map(t => <th key={t}>{TRACK_LABEL[t]}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: highest }, (_, i) => i + 1).map(tier => (
                                <tr key={tier} className={tier === farm ? 'now' : undefined}>
                                    <td>T{tier}</td>
                                    {DISSONANCE_TRACKS.map(t => {
                                        const b = trackBoost(waves, t, tier, labData);
                                        const shown = view === 'total' ? times(b.total)
                                            : view === 'echo' ? times(b.echo)
                                                : b.wave > 0 ? times(b.boost) : '—';
                                        return (
                                            <td key={t}>
                                                <input
                                                    className="diss-wave" type="number" inputMode="numeric" min={0} placeholder="—"
                                                    aria-label={`T${tier} ${TRACK_LABEL[t]} best wave`}
                                                    value={b.wave || ''}
                                                    onChange={e => setWave(t, tier, Math.max(0, parseInt(e.target.value) || 0))}
                                                />
                                                <span className="diss-boost">{shown}</span>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <p className="diss-note">Set your highest tier above.</p>
                )}

                <p className="diss-note">
                    Each box is that tier&apos;s best Dissonant Run wave. The boost on a tier counts when you play that
                    tier; Echo adds part of every other tier&apos;s. The Optimizer ranks the Echo labs from these, and
                    comparing tiers counts each tier&apos;s own boost. Tournaments don&apos;t count them yet: whether they
                    apply there isn&apos;t confirmed.
                </p>
            </div>
        </div>
    );
}
