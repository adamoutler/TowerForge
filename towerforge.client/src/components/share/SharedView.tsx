// ============================================================
//  TowerForge Companion — Shared Stats Viewer
//  Full-page, read-only view opened from a ?share= link.
//  Replaces the app shell, so it never touches the viewer's data.
//  Each section is drawn to fit the screen (phones included); Export
//  Image saves it as the fixed-width poster kept off-screen next to
//  it, so an export looks the same from any screen (shareTheme) — a
//  long section as several Reddit-shaped images (PosterPages).
//  Cards, Bots, Modules, Workshop and Guardian switch between the
//  sender's presets, like their tabs. Cards, UWs, Guardian and Vault are
//  drawn like the game's own screens. Sections show in the order of
//  SHARE_SECTIONS; older shares just have fewer of them.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchShare } from '../../engine/shareApi';
import type { SharePayload } from '../../engine/shareApi';
import UWShareCard from './UWShareCard';
import CardsShareCard from './CardsShareCard';
import BotsShareCard from './BotsShareCard';
import ModulesShareCard from './ModulesShareCard';
import StatsShareCard from './StatsShareCard';
import type { StatGroup } from './StatsShareCard';
import GuardianShareCard from './GuardianShareCard';
import VaultShareCard from './VaultShareCard';
import { labsGroups, profileGroups, relicsGroups, workshopGroups } from './shareSections';
import { SHARE_OFFSCREEN_STYLE } from './shareTheme';
import { openExportDialog } from './exportImages';
import { BOTS_CONFIG, botsForPreset, getPresetBots, isBotEntryOwned } from '../../constants/botData';
import { presetLabel } from '../../constants/gameData';
import SiteFooter from '../common/SiteFooter';

interface Props {
    code: string;
}

// Export Image: the Export Images window for a section's poster.
const exportCard = (node: HTMLDivElement | null, file: string, label: string) =>
    openExportDialog(node, `towerforge-shared-${file}`, label);

// One section: its preset buttons, Export Image, the on-page card, and
// the off-screen poster that Export Image saves (`pages` images).
function ShareSection({ controls, onExport, poster, pages = 1, children }: {
    controls?: ReactNode;
    onExport: () => void;
    poster: ReactNode;
    pages?: number;
    children: ReactNode;
}) {
    return (
        <section className="shr-section">
            <div className="shr-toolbar">
                {controls}
                <span className="shr-spacer" />
                <button className="btn btn-accent" onClick={onExport}
                    title={pages > 1 ? 'Saves the section as one image per page, sized for a Reddit post' : undefined}>
                    📸 {pages > 1 ? `Export ${pages} Images` : 'Export Image'}
                </button>
            </div>
            {children}
            <div style={SHARE_OFFSCREEN_STYLE} aria-hidden="true">{poster}</div>
        </section>
    );
}

// The sender's presets as buttons (none for one preset).
function PresetButtons({ count, names, value, onChange }: {
    count: number; names?: string[]; value: number; onChange: (i: number) => void;
}) {
    if (count <= 1) return null;
    return (
        <div className="preset-tabs shr-presets">
            {Array.from({ length: count }, (_, idx) => (
                <button key={idx} className={`preset-btn ${value === idx ? 'active' : ''}`} onClick={() => onChange(idx)}>
                    {presetLabel(names, idx)}
                </button>
            ))}
        </div>
    );
}

// A Stats card section (Profile, Workshop, Labs, Relics, Guardian);
// `columns`: tiles across on the poster.
function StatsSection({ title, subtitle, groups, file, empty, controls, columns }: {
    title: string; subtitle: string; groups: StatGroup[]; file: string; empty?: string; controls?: ReactNode; columns?: number;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [pages, setPages] = useState(1);
    return (
        <ShareSection
            controls={controls}
            pages={pages}
            onExport={() => exportCard(ref.current, file, title)}
            poster={<StatsShareCard ref={ref} title={title} subtitle={subtitle} groups={groups} empty={empty} columns={columns} onPages={setPages} poster />}
        >
            <StatsShareCard title={title} subtitle={subtitle} groups={groups} empty={empty} />
        </ShareSection>
    );
}

export default function SharedView({ code }: Props) {
    const [payload, setPayload] = useState<SharePayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [botPreset, setBotPreset] = useState(0);
    const [cardPreset, setCardPreset] = useState(0);
    const [wsPreset, setWsPreset] = useState(0);
    const [guardianPresetIdx, setGuardianPreset] = useState(0);
    const [loadoutId, setLoadoutId] = useState<string | null>(null);
    const uwRef = useRef<HTMLDivElement>(null);
    const guardianRef = useRef<HTMLDivElement>(null);
    const vaultRef = useRef<HTMLDivElement>(null);
    const [uwPages, setUwPages] = useState(1);
    const [guardianPages, setGuardianPages] = useState(1);
    const [vaultPages, setVaultPages] = useState(1);
    const cardsRef = useRef<HTMLDivElement>(null);
    const botsRef = useRef<HTMLDivElement>(null);
    const modulesRef = useRef<HTMLDivElement>(null);
    const [cardPages, setCardPages] = useState(1);
    const [modulePages, setModulePages] = useState(1);

    useEffect(() => {
        let cancelled = false;
        fetchShare(code)
            .then(data => { if (!cancelled) setPayload(data); })
            .catch(err => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this share.');
            });
        return () => { cancelled = true; };
    }, [code]);

    // Cards: each preset's loadout. Older shares carry the loadouts but not
    // the preset count — count the presets they hold.
    const sharedCards = payload?.cards;
    const cardPresetCount = sharedCards
        ? sharedCards.presetCount ?? Math.max(1, ...Object.keys(sharedCards.presets ?? {}).map(k => Number(k) + 1))
        : 0;

    // Bots: the sender's presets, each with its own levels and active bots.
    // Older shares without loadouts show one set of levels.
    const sharedBots = payload?.bots;
    const botPresetCount = sharedBots?.loadouts ? (sharedBots.presetCount ?? 2) : 0;
    const ownedBotNames = sharedBots
        ? BOTS_CONFIG.filter(b => isBotEntryOwned(sharedBots.current[b.name])).map(b => b.name)
        : [];
    const presetActiveBots = botPresetCount > 0
        ? getPresetBots(sharedBots?.loadouts, botPreset, ownedBotNames)
        : undefined;
    const botProps = sharedBots ? {
        bots: botsForPreset(sharedBots.current, botPreset),
        title: botPresetCount > 0 ? presetLabel(sharedBots.presetNames, botPreset) : 'Medal levels',
        activeBots: presetActiveBots,
    } : null;

    // Modules: one preset at a time, the equipped one first.
    const sharedModules = payload?.modules;
    const loadouts = sharedModules?.loadouts ?? [];
    const equippedId = sharedModules?.activeLoadout;
    const loadout = loadouts.find(l => l.id === loadoutId)
        ?? loadouts.find(l => l.id === equippedId) ?? loadouts[0];
    // Assist slots show when the sender uses them anywhere.
    const showAssists = loadouts.some(l => Object.values(l.slots).some(s => s?.assist))
        || Object.values(sharedModules?.slotLevels ?? {}).some(s => (s?.assist ?? 0) > 0)
        || Object.values(sharedModules?.assistData ?? {}).some(a => a && a.rarity !== 'locked');
    const moduleProps = sharedModules && loadout ? {
        loadout,
        library: sharedModules.library ?? [],
        slotLevels: sharedModules.slotLevels,
        assistData: sharedModules.assistData,
        equipped: loadout.id === equippedId,
        showAssists,
    } : null;

    const ws = payload?.workshop;
    const guardian = payload?.guardian;
    const labGroups = payload?.labs ? labsGroups(payload.labs) : [];
    const labCount = labGroups.reduce((s, g) => s + g.tiles.length, 0);

    return (
        <div className="shr-page">
            <header className="shr-top">
                <span className="app-logo shr-logo">Tower<span className="logo-forge">Forge</span></span>
                <span className="shr-code">Shared stats · code <strong>{code.toUpperCase()}</strong></span>
                <span className="shr-spacer" />
                <a className="btn btn-dim" href="/">Open TowerForge</a>
            </header>

            <main className="shr-body">
                {error && (
                    <div className="empty-state">
                        <div className="icon">🔗</div>
                        <h3>{error}</h3>
                        <p>Check the code and try again, or ask the sender for a new link.</p>
                    </div>
                )}

                {!error && !payload && <p className="shr-loading">Loading shared stats…</p>}

                {payload?.profile && (
                    <StatsSection title="Profile" file="profile"
                        subtitle={[payload.profile.build, payload.profile.highestTier ? `T${payload.profile.highestTier}` : ''].filter(Boolean).join(' · ') || 'Account'}
                        groups={profileGroups(payload.profile)} />
                )}

                {payload?.uw && (
                    <ShareSection
                        pages={uwPages}
                        onExport={() => exportCard(uwRef.current, 'uws', 'Ultimate Weapons')}
                        poster={<UWShareCard ref={uwRef} snapshot={payload.uw} onPages={setUwPages} poster />}
                    >
                        <UWShareCard snapshot={payload.uw} />
                    </ShareSection>
                )}

                {sharedCards && (
                    <ShareSection
                        controls={<PresetButtons count={cardPresetCount} names={sharedCards.presetNames} value={cardPreset} onChange={setCardPreset} />}
                        pages={cardPages}
                        onExport={() => exportCard(cardsRef.current, 'cards', 'Cards')}
                        poster={<CardsShareCard ref={cardsRef} snapshot={sharedCards} preset={cardPreset}
                            presetName={presetLabel(sharedCards.presetNames, cardPreset)} onPages={setCardPages} poster />}
                    >
                        <CardsShareCard snapshot={sharedCards} preset={cardPreset} presetName={presetLabel(sharedCards.presetNames, cardPreset)} />
                    </ShareSection>
                )}

                {botProps && (
                    <ShareSection
                        controls={<PresetButtons count={botPresetCount} names={sharedBots?.presetNames} value={botPreset} onChange={setBotPreset} />}
                        onExport={() => exportCard(botsRef.current, 'bots', 'Bots')}
                        poster={<BotsShareCard ref={botsRef} {...botProps} poster />}
                    >
                        <BotsShareCard {...botProps} />
                    </ShareSection>
                )}

                {moduleProps && (
                    <ShareSection
                        controls={loadouts.length > 1 && (
                            <div className="modg-presets shr-presets">
                                {loadouts.map(lo => (
                                    <button
                                        key={lo.id}
                                        className={`modg-preset ${lo.id === loadout?.id ? 'viewing' : ''} ${lo.id === equippedId ? 'equipped' : ''}`}
                                        onClick={() => setLoadoutId(lo.id)}
                                        title={lo.id === equippedId ? 'Equipped' : undefined}
                                    >
                                        {lo.name || 'Preset'}
                                    </button>
                                ))}
                            </div>
                        )}
                        pages={modulePages}
                        onExport={() => exportCard(modulesRef.current, 'modules', 'Modules')}
                        poster={<ModulesShareCard ref={modulesRef} {...moduleProps} onPages={setModulePages} poster />}
                    >
                        <ModulesShareCard {...moduleProps} />
                    </ShareSection>
                )}

                {ws && (
                    <StatsSection title="Workshop" file="workshop" subtitle={presetLabel(ws.presetNames, wsPreset)}
                        controls={<PresetButtons count={ws.presetCount} names={ws.presetNames} value={wsPreset} onChange={setWsPreset} />}
                        groups={workshopGroups(ws, wsPreset)} empty="No workshop upgrades yet." columns={5} />
                )}

                {payload?.labs && (
                    <StatsSection title="Labs" file="labs" subtitle={`${labCount} researched`} groups={labGroups} empty="No labs researched yet." />
                )}

                {payload?.relics && (
                    <StatsSection title="Relics" file="relics" subtitle="Bonus totals" groups={relicsGroups(payload.relics)} empty="No relic bonuses yet." />
                )}

                {guardian && (
                    <ShareSection
                        controls={<PresetButtons count={guardian.presetCount} names={guardian.presetNames} value={guardianPresetIdx} onChange={setGuardianPreset} />}
                        pages={guardianPages}
                        onExport={() => exportCard(guardianRef.current, 'guardian', 'Guardian')}
                        poster={<GuardianShareCard ref={guardianRef} guardian={guardian.guardian} preset={guardianPresetIdx}
                            presetName={presetLabel(guardian.presetNames, guardianPresetIdx)} onPages={setGuardianPages} poster />}
                    >
                        <GuardianShareCard guardian={guardian.guardian} preset={guardianPresetIdx} presetName={presetLabel(guardian.presetNames, guardianPresetIdx)} />
                    </ShareSection>
                )}

                {payload?.vault && (
                    <ShareSection
                        pages={vaultPages}
                        onExport={() => exportCard(vaultRef.current, 'vault', 'Vault')}
                        poster={<VaultShareCard ref={vaultRef} snapshot={payload.vault.levels} onPages={setVaultPages} poster />}
                    >
                        <VaultShareCard snapshot={payload.vault.levels} />
                    </ShareSection>
                )}
            </main>
            <SiteFooter />
        </div>
    );
}
