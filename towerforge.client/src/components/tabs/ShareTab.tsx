// ============================================================
//  TowerForge Companion — Share Tab
//  Creates a read-only share link from selected stats, and
//  opens a share code someone else sent you. Never shares the player's
//  name (Profile shares the build, leagues, tiers and best waves).
// ============================================================

import { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { createShare, shareUrl } from '../../engine/shareApi';
import type { SharePayload, ShareSectionKey } from '../../engine/shareApi';
import { useAccountStore } from '../../store/useAccountStore';
import MySharesList from '../share/MySharesList';
import { activeLoadout } from '../../engine/statHelpers';

type SectionKey = ShareSectionKey;

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
    { key: 'profile', label: 'Profile', hint: 'Build, leagues, highest tier and best wave on each tier' },
    { key: 'uw', label: 'Ultimate Weapons', hint: 'Levels, UW+ status' },
    { key: 'cards', label: 'Cards', hint: 'Card loadout per preset, stars, mastery levels' },
    { key: 'bots', label: 'Bots', hint: 'Medal levels, Bot+ and active bots per preset' },
    { key: 'modules', label: 'Modules', hint: 'Presets, modules with their effects, assist tiers and efficiencies' },
    { key: 'workshop', label: 'Workshop', hint: 'Levels and enhancements per preset' },
    { key: 'labs', label: 'Labs', hint: 'Every lab you’ve researched' },
    { key: 'relics', label: 'Relics', hint: 'Your relics’ bonus totals' },
    { key: 'guardian', label: 'Guardian', hint: 'Chips equipped per preset, their levels, skins' },
    { key: 'vault', label: 'Vault', hint: 'The Vault upgrades you’ve bought and their levels' },
];

export default function ShareTab() {
    const uwData = useGameStore(s => s.uwData);
    const cardData = useGameStore(s => s.cardData);
    const botData = useGameStore(s => s.botData);
    const botLoadouts = useGameStore(s => s.botLoadouts);
    const presetCount = useGameStore(s => s.profile.presets || 2);
    const presetNames = useGameStore(s => s.profile.presetNames);
    const moduleState = useGameStore(s => s.moduleState);
    const profile = useGameStore(s => s.profile);
    const tierWaves = useGameStore(s => s.tierWaves);
    const wsData = useGameStore(s => s.wsData);
    const enhData = useGameStore(s => s.enhData);
    const labData = useGameStore(s => s.labData);
    const relicData = useGameStore(s => s.relicData);
    const guardianData = useGameStore(s => s.guardianData);
    const vaultLevels = useGameStore(s => s.vaultLevels);
    const accountStatus = useAccountStore(s => s.status);
    const sharesChanged = useAccountStore(s => s.sharesChanged);
    const setActiveTab = useGameStore(s => s.setActiveTab);

    const [selected, setSelected] = useState<Record<SectionKey, boolean>>({
        profile: true, uw: true, cards: true, bots: true, modules: true, workshop: true, labs: true, relics: true, guardian: true, vault: true,
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [code, setCode] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [openCode, setOpenCode] = useState('');

    const anySelected = SECTIONS.some(s => selected[s.key]);
    const hasVault = Object.values(vaultLevels ?? {}).some(v => v > 0);

    async function handleCreate() {
        const payload: SharePayload = {};
        if (selected.profile) {
            payload.profile = {
                build: profile.build, league: profile.league, currentLeague: profile.currentLeague,
                highestTier: profile.highestTier, completedTier: profile.completedTier, tierWaves,
            };
        }
        if (selected.uw) payload.uw = uwData;
        if (selected.cards) payload.cards = { ...cardData, presetCount, presetNames };
        if (selected.bots) payload.bots = { current: botData, loadouts: botLoadouts, presetCount, presetNames };
        if (selected.modules) {
            payload.modules = {
                loadouts: moduleState.loadouts,
                library: moduleState.library,
                slotLevels: moduleState.slotLevels,
                activeLoadout: activeLoadout(moduleState)?.id,
                assistData: moduleState.assistData,
            };
        }
        if (selected.workshop) payload.workshop = { presets: wsData.slice(0, presetCount), enh: enhData, presetCount, presetNames };
        if (selected.labs) payload.labs = { levels: labData };
        if (selected.relics) payload.relics = { totals: relicData };
        if (selected.guardian && guardianData?.unlocked) payload.guardian = { guardian: guardianData, presetCount, presetNames };
        if (selected.vault && hasVault) payload.vault = { levels: vaultLevels };

        setBusy(true);
        setError(null);
        setCopied(false);
        try {
            setCode(await createShare(payload));
            if (accountStatus === 'signedIn') sharesChanged();
        } catch (err) {
            setCode(null);
            setError(err instanceof Error ? err.message : 'Could not create the share link.');
        } finally {
            setBusy(false);
        }
    }

    // Phones: the share menu (Discord, Reddit, Messages…) with the link.
    const canShareLink = typeof navigator.share === 'function';
    async function handleShareLink() {
        if (!code) return;
        try {
            await navigator.share({ title: 'My The Tower build on TowerForge', url: shareUrl(code) });
        } catch {
            // Closed, or not allowed here: Copy Link still works.
        }
    }

    async function handleCopy() {
        if (!code) return;
        try {
            await navigator.clipboard.writeText(shareUrl(code));
            setCopied(true);
        } catch {
            setError('Copy failed. Select the link and copy it manually.');
        }
    }

    function handleOpen() {
        const trimmed = openCode.trim();
        if (!trimmed) return;
        window.location.href = `/s/${encodeURIComponent(trimmed.toUpperCase())}`;
    }

    return (
        <div>
            <div className="section" style={{ marginBottom: '10px' }}>
                <div className="section-head"><h3>Share My Stats</h3></div>
                <div className="section-body" style={{ padding: '10px 14px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '10px', lineHeight: 1.6 }}>
                        Creates a read-only snapshot of the sections you pick. Anyone with the link or code can view it.
                        Snapshots expire after 90 days. Your own data is never changed.
                    </p>
                    {accountStatus === 'signedOut' && (
                        <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '10px', lineHeight: 1.6 }}>
                            <button
                                className="btn btn-dim"
                                style={{ fontSize: '13px', padding: '2px 8px', marginRight: '6px' }}
                                onClick={() => setActiveTab('account')}
                            >
                                Create an account
                            </button>
                            to keep a list of your codes and delete them before they expire.
                        </p>
                    )}

                    {SECTIONS.filter(s => (s.key !== 'guardian' || guardianData?.unlocked) && (s.key !== 'vault' || hasVault)).map(s => (
                        <label key={s.key} className="field-row" style={{ cursor: 'pointer' }}>
                            <span className="field-label">
                                {s.label}
                                <span className="field-sub">{s.hint}</span>
                            </span>
                            <input
                                type="checkbox"
                                checked={selected[s.key]}
                                onChange={e => setSelected(prev => ({ ...prev, [s.key]: e.target.checked }))}
                            />
                        </label>
                    ))}

                    <div className="flex-row" style={{ marginTop: '10px' }}>
                        <button className="btn btn-accent" onClick={handleCreate} disabled={!anySelected || busy}>
                            {busy ? 'Creating…' : '🔗 Create Share Link'}
                        </button>
                    </div>

                    {error && (
                        <p style={{ fontSize: '13px', color: 'var(--red, #e74c3c)', marginTop: '8px' }}>{error}</p>
                    )}

                    {code && (
                        <div style={{ marginTop: '12px' }}>
                            <div className="field-label" style={{ marginBottom: '6px' }}>
                                Share code: <strong style={{ letterSpacing: '2px', fontSize: '16px' }}>{code}</strong>
                            </div>
                            <div className="flex-row">
                                <input
                                    readOnly
                                    value={shareUrl(code)}
                                    onFocus={e => e.target.select()}
                                    style={{ flex: 1, fontSize: '13px' }}
                                />
                                <button className="btn btn-dim" onClick={handleCopy}>
                                    {copied ? '✓ Copied' : 'Copy Link'}
                                </button>
                                {canShareLink && <button className="btn btn-accent" onClick={() => void handleShareLink()}>📤 Share</button>}
                            </div>
                            {selected.profile && (
                                <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '8px', lineHeight: 1.6 }}>
                                    Posted in Discord or Reddit, the link shows your tier, best wave and league.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {accountStatus === 'signedIn' && (
                <div className="section" style={{ marginBottom: '10px' }}>
                    <div className="section-head"><h3>My Share Codes</h3></div>
                    <div className="section-body" style={{ padding: '10px 14px' }}>
                        <MySharesList />
                    </div>
                </div>
            )}

            <div className="section">
                <div className="section-head"><h3>View Someone's Stats</h3></div>
                <div className="section-body" style={{ padding: '10px 14px' }}>
                    <div className="flex-row">
                        <input
                            placeholder="Enter share code"
                            value={openCode}
                            maxLength={12}
                            onChange={e => setOpenCode(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleOpen(); }}
                            style={{ flex: 1, textTransform: 'uppercase' }}
                        />
                        <button className="btn btn-accent" onClick={handleOpen} disabled={!openCode.trim()}>
                            Open
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
