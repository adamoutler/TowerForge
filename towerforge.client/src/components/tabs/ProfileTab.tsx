// ============================================================
//  TowerForge Companion — Profile Tab
//  Player name, league, build type, preset count, wall toggle.
// ============================================================

import { useGameStore } from '../../store/useGameStore';
import type { BuildType, League } from '../../types/gameTypes';
import { MAX_TIER, presetLabel } from '../../constants/gameData';
import LiveRunPanel from './LiveRunPanel';
import './tabs.css';

export default function ProfileTab() {
    const profile = useGameStore(s => s.profile);
    const updateProfile = useGameStore(s => s.updateProfile);

    return (
        <div className="tab-pane-profile">

            <LiveRunPanel />

            {/* ── Player Info ── */}
            <div className="section">
                <div className="section-head">
                    <h3>Player Profile</h3>
                </div>
                <div className="section-body">
                    <div className="profile-grid">

                        {/* Left column */}
                        <div>
                            <div className="field-row">
                                <label className="field-label">Player Name</label>
                                <input
                                    type="text"
                                    value={profile.name}
                                    placeholder="Enter name"
                                    onChange={e => updateProfile({ name: e.target.value })}
                                />
                            </div>

                            <div className="field-row">
                                <label className="field-label">Tournament League</label>
                                <select
                                    value={profile.league}
                                    onChange={e => updateProfile({ league: e.target.value as League })}
                                >
                                    <option value="">— Select —</option>
                                    <option>Copper</option>
                                    <option>Silver</option>
                                    <option>Gold</option>
                                    <option>Platinum</option>
                                    <option>Champion</option>
                                    <option>Legend</option>
                                    <option>Mythic</option>
                                </select>
                            </div>

                            <div className="field-row">
                                <label className="field-label">Build Type</label>
                                <select
                                    value={profile.build}
                                    onChange={e => updateProfile({ build: e.target.value as BuildType })}
                                >
                                    <option value="">— Select —</option>
                                    <option>Glass Cannon</option>
                                    <option>eHP</option>
                                    <option>Hybrid</option>
                                    <option>Farming</option>
                                </select>
                            </div>
                        </div>

                        {/* Right column */}
                        <div>
                            <div className="field-row">
                                <label className="field-label">
                                    Workshop Presets
                                    <span className="field-sub">
                                        Enable 5 if Harmony tech tree unlocked
                                    </span>
                                </label>
                                <select
                                    value={profile.presets}
                                    onChange={e =>
                                        updateProfile({ presets: parseInt(e.target.value) as 2 | 5 })
                                    }
                                >
                                    <option value={2}>2 (Default)</option>
                                    <option value={5}>5 (Harmony)</option>
                                </select>
                            </div>

                            <div className="field-row" style={{ alignItems: 'flex-start' }}>
                                <label className="field-label">
                                    Preset Names
                                    <span className="field-sub">Filled in by Import Game Data</span>
                                </label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {Array.from({ length: profile.presets || 2 }, (_, i) => (
                                        <input
                                            key={i}
                                            type="text"
                                            maxLength={24}
                                            value={profile.presetNames?.[i] ?? ''}
                                            placeholder={presetLabel(undefined, i)}
                                            onChange={e => {
                                                const names = [...(profile.presetNames ?? [])];
                                                names[i] = e.target.value;
                                                updateProfile({ presetNames: names });
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="field-row">
                                <label className="field-label">Wall Unlocked</label>
                                <input
                                    type="checkbox"
                                    checked={!!profile.wall}
                                    onChange={e => updateProfile({ wall: e.target.checked })}
                                />
                            </div>
                        </div>

                    </div>
                </div>
            </div>

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
                                value={profile.highestTier || ''}
                                onChange={e => {
                                    const ht = parseInt(e.target.value) || 0;
                                    const ct = Math.min(profile.completedTier || 0, ht);
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
                                value={profile.completedTier || 0}
                                onChange={e =>
                                    updateProfile({ completedTier: parseInt(e.target.value) || 0 })
                                }
                            >
                                <option value={0}>None</option>
                                {Array.from(
                                    { length: profile.highestTier || 0 },
                                    (_, i) => i + 1,
                                ).map(t => (
                                    <option key={t} value={t}>T{t}</option>
                                ))}
                            </select>
                        </div>

                    </div>
                </div>
            </div>

            {/* ── Build Summary ── */}
            {profile.build && (
                <div className="section">
                    <div className="section-head">
                        <h3>Build Summary</h3>
                    </div>
                    <div className="section-body">
                        <div className="profile-summary-grid">

                            <div className="profile-stat-pill">
                                <span className="stat-pill-label">Player</span>
                                <span className="stat-pill-val">
                                    {profile.name || '—'}
                                </span>
                            </div>

                            <div className="profile-stat-pill">
                                <span className="stat-pill-label">League</span>
                                <span className="stat-pill-val">
                                    {profile.league || '—'}
                                </span>
                            </div>

                            <div className="profile-stat-pill">
                                <span className="stat-pill-label">Build</span>
                                <span className="stat-pill-val" style={{ color: 'var(--accent)' }}>
                                    {profile.build || '—'}
                                </span>
                            </div>

                            <div className="profile-stat-pill">
                                <span className="stat-pill-label">Presets</span>
                                <span className="stat-pill-val">{profile.presets}</span>
                            </div>

                            <div className="profile-stat-pill">
                                <span className="stat-pill-label">Highest Tier</span>
                                <span className="stat-pill-val" style={{ color: 'var(--gold)' }}>
                                    {profile.highestTier ? `T${profile.highestTier}` : '—'}
                                </span>
                            </div>

                            <div className="profile-stat-pill">
                                <span className="stat-pill-label">Completed</span>
                                <span className="stat-pill-val">
                                    {profile.completedTier ? `T${profile.completedTier}` : 'None'}
                                </span>
                            </div>

                            <div className="profile-stat-pill">
                                <span className="stat-pill-label">Wall</span>
                                <span
                                    className="stat-pill-val"
                                    style={{ color: profile.wall ? 'var(--accent)' : 'var(--text-dim)' }}
                                >
                                    {profile.wall ? 'Unlocked' : 'Locked'}
                                </span>
                            </div>

                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}