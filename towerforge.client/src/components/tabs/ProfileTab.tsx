// ============================================================
//  TowerForge Companion — Profile Tab (the home page)
//  Where the account stands (ProfileHome), the run in progress, then
//  the profile settings: player name, league, build type, preset
//  count, wall, tiers. Import fills the settings in, so they fold away
//  once there's data and open by themselves on a new account.
// ============================================================

import { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import type { BuildType, League } from '../../types/gameTypes';
import { MAX_TIER, presetLabel } from '../../constants/gameData';
import LiveRunPanel from './LiveRunPanel';
import ProfileHome from './ProfileHome';
import './tabs.css';

export default function ProfileTab() {
    const profile = useGameStore(s => s.profile);
    const updateProfile = useGameStore(s => s.updateProfile);
    const hasData = useGameStore(s => s.importedBattles.length > 0 || !!s.profile.highestTier);
    const [settingsOpen, setSettingsOpen] = useState(!hasData);

    return (
        <div className="tab-pane-profile">

            <ProfileHome />

            <LiveRunPanel />

            {/* ── Profile settings ── */}
            <div className={`section${settingsOpen ? '' : ' collapsed'}`}>
                <div className="section-head" onClick={() => setSettingsOpen(o => !o)}
                    role="button" tabIndex={0} aria-expanded={settingsOpen}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSettingsOpen(o => !o); } }}>
                    <h3>Profile settings</h3>
                    <span className="field-sub">Name, league, build, presets, tiers</span>
                    <span className="chevron">▼</span>
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

                    <div className="divider" />
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

        </div>
    );
}