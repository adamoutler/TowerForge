// ============================================================
//  TowerForge Companion — Tiers Tab
//  Track highest wave reached per tier, and the Dissonant Boosts per tier.
// ============================================================

import { useGameStore } from '../../store/useGameStore';
import NumericInput from '../common/NumericInput';
import { MAX_TIER } from '../../constants/gameData';
import DissonancePanel from './DissonancePanel';

export default function TiersTab() {
    const profile = useGameStore(s => s.profile);
    const tierWaves = useGameStore(s => s.tierWaves);
    const setTierWave = useGameStore(s => s.setTierWave);
    const updateProfile = useGameStore(s => s.updateProfile);

    const highestTier = profile.highestTier || 0;
    const completedTier = profile.completedTier || 0;

    // Count tiers with progress
    const tiersInProgress = Object.values(tierWaves).filter(w => w > 0).length;

    return (
        <div>

            {/* ── Tier Settings ── */}
            <div className="section">
                <div className="section-head">
                    <h3>Tier Settings</h3>
                </div>
                <div className="section-body">
                    <div className="profile-grid">

                        <div className="field-row">
                            <label className="field-label">Highest Tier Unlocked</label>
                            <select
                                value={highestTier || ''}
                                onChange={e => {
                                    const ht = parseInt(e.target.value) || 0;
                                    const ct = Math.min(completedTier, ht);
                                    updateProfile({ highestTier: ht, completedTier: ct });
                                }}
                            >
                                <option value="">—</option>
                                {Array.from({ length: MAX_TIER }, (_, i) => i + 1).map(t => (
                                    <option key={t} value={t}>T{t}</option>
                                ))}
                            </select>
                        </div>

                        <div className="field-row">
                            <label className="field-label">
                                Highest Completed
                                <span className="field-sub">Reached Wave 4500</span>
                            </label>
                            <select
                                value={completedTier}
                                onChange={e =>
                                    updateProfile({ completedTier: parseInt(e.target.value) || 0 })
                                }
                            >
                                <option value={0}>None</option>
                                {Array.from({ length: highestTier }, (_, i) => i + 1).map(t => (
                                    <option key={t} value={t}>T{t}</option>
                                ))}
                            </select>
                        </div>

                    </div>
                </div>
            </div>

            {/* ── Tier Progress ── */}
            <div className="section">
                <div className="section-head">
                    <h3>Tier Progress</h3>
                    <span className="s-badge">{tiersInProgress} active</span>
                </div>
                <div className="section-body">
                    {!highestTier ? (
                        <p style={{ color: 'var(--text-dim)', fontSize: '13px' }}>
                            Set your highest tier above.
                        </p>
                    ) : (
                        <div>
                            {Array.from({ length: highestTier }, (_, i) => i + 1).map(tier => {
                                const isCompleted = tier <= completedTier;
                                const wave = tierWaves[tier] ?? 0;
                                const pct = Math.min(100, Math.round((wave / 4500) * 100));
                                const isMaxed = pct >= 100;

                                if (isCompleted) {
                                    return (
                                        <div key={tier} className="tier-row">
                                            <span className="tier-num">T{tier}</span>
                                            <span className="field-label" style={{ color: 'var(--gold)' }}>
                                                Completed
                                            </span>
                                            <span style={{ color: 'var(--gold)', fontSize: '16px' }}>✓</span>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={tier} className="tier-row">
                                        <span className="tier-num">T{tier}</span>
                                        <div className="tier-wave-col">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <NumericInput
                                                    value={wave}
                                                    min={0}
                                                    max={4500}
                                                    onChange={v => setTierWave(tier, v)}
                                                />
                                                <span style={{
                                                    fontSize: '12px',
                                                    color: 'var(--text-dim)',
                                                    fontFamily: 'var(--font-mono)',
                                                }}>
                                                    / 4500
                                                </span>
                                            </div>
                                            <div className="pbar" style={{ marginTop: '4px', maxWidth: '200px' }}>
                                                <div
                                                    className={`pbar-fill ${isMaxed ? 'gold' : ''}`}
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                        <span style={{
                                            fontFamily: 'var(--font-mono)',
                                            fontSize: '12px',
                                            color: isMaxed ? 'var(--gold)' : 'var(--text-dim)',
                                            minWidth: '36px',
                                            textAlign: 'right',
                                        }}>
                                            {pct}%
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <DissonancePanel />

        </div>
    );
}