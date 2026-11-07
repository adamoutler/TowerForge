// ============================================================
//  TowerForge Companion — App Shell
//  Renders the header, tab bar, and active tab pane.
//  All state is loaded here on mount via the store. Each tab has its
//  own address (routes.ts): the address follows the open tab, back and
//  forward follow the address, and the tab bar's entries are links.
// ============================================================

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from './store/useGameStore';
import type { TabName } from './types/gameTypes';
import { isGameExport, parseGameExport, SUPPORTED_EXPORT_VERSION } from './engine/gameExport';
import { trackEvent } from './analytics';
import { TAB_PATHS, tabFromPath } from './routes';
import { isPdfFile, jsonFromPdf, looksLikePdf } from './engine/pdfImport';
import CurrencyBar from './components/common/CurrencyBar';

// ── Tab Components (stubs for now — filled in one by one) ────
import ProfileTab from './components/tabs/ProfileTab';
import LinkModal from './components/LinkModal';
import LinkSourcePicker from './components/LinkSourcePicker';
import AutoImport from './components/common/AutoImport';
import ThemePicker from './components/common/ThemePicker';
import DiscordLink from './components/common/DiscordLink';
import OfficialSiteNote from './components/common/OfficialSiteNote';
import WelcomeGuide from './components/common/WelcomeGuide';
import { exportAge, linkExport, linkSources, phoneLinkRemembered, rememberSource } from './engine/linkClient';
import type { LinkSource } from './engine/linkClient';
import PerksTab from './components/tabs/PerksTab';
import TiersTab from './components/tabs/TiersTab';
import WorkshopTab from './components/tabs/WorkshopTab';
import LabsTab from './components/tabs/LabsTab';
import CardsTab from './components/tabs/CardsTab';
import UWTab from './components/tabs/UWTab';
import PUWsTab from './components/tabs/pUWsTab';
import RelicsTab from './components/tabs/RelicsTab';
import VaultTab from './components/tabs/VaultTab';
import BotsTab from './components/tabs/BotsTab';
import GuardianTab from './components/tabs/GuardianTab';
import ModulesTab from './components/tabs/ModulesTab';
import ShareTab from './components/tabs/ShareTab';
import AccountTab from './components/tabs/AccountTab';
import { useAccountStore } from './store/useAccountStore';
import SharedView from './components/share/SharedView';
import ErrorBoundary from './components/common/ErrorBoundary';

import './styles/app.css';

// Pages most visits never open load on first use, keeping the main bundle small.
const OptimizerTab = lazy(() => import('./components/tabs/OptimizerTab'));
const CareerTab = lazy(() => import('./components/tabs/CareerTab'));
const CreatorCodesTab = lazy(() => import('./components/tabs/CreatorCodesTab'));
const EnemyStatsTab = lazy(() => import('./components/tabs/EnemyStatsTab'));
const RunCoinsTab = lazy(() => import('./components/tabs/RunCoinsTab'));
const RunLengthTab = lazy(() => import('./components/tabs/RunLengthTab'));
const WhatIfTab = lazy(() => import('./components/tabs/WhatIfTab'));
const TournamentTab = lazy(() => import('./components/tabs/TournamentTab'));
const TourneyHistoryTab = lazy(() => import('./components/tabs/TourneyHistoryTab'));
const AiTab = lazy(() => import('./components/tabs/AiTab'));
const ImportGuideTab = lazy(() => import('./components/tabs/ImportGuideTab'));

// ── Tab Definitions ───────────────────────────────────────────
// The tabs, grouped into sections so the menu fits a phone: the top row
// picks a section, the row under it picks the tab inside it (no second row
// for a section with one tab). A section with a long name has a short one
// for phones, and an icon (on phones the icon sits over the name). A
// preview section shows only for the accounts the server lists for it
// (features.json), and always in development.
interface TabGroup {
    id: string;
    label: string;
    icon: string;
    short?: string;
    tabs: { id: TabName; label: string; title?: string }[];   // title: the page title, when the label needs its section
    preview?: string;
}
const TAB_GROUPS: TabGroup[] = [
    {
        id: 'player', label: 'Player', icon: '👤', tabs: [
            { id: 'profile', label: 'Profile' },
            { id: 'tiers', label: 'Tiers' },
            { id: 'career', label: 'Career' },
            { id: 'share', label: 'Share' },
            { id: 'account', label: 'Account' },
            { id: 'importguide', label: 'Import Guide' },
        ],
    },
    {
        id: 'upgrades', label: 'Upgrades', icon: '⬆️', tabs: [
            { id: 'workshop', label: 'Workshop' },
            { id: 'labs', label: 'Labs' },
            { id: 'cards', label: 'Cards' },
            { id: 'perks', label: 'Perks' },
            { id: 'vault', label: 'Vault' },
        ],
    },
    {
        id: 'uws', label: 'UWs', icon: '⚡', tabs: [
            { id: 'uw', label: 'Ultimate Weapons' },
            { id: 'puws', label: 'Permanent UWs' },
        ],
    },
    {
        id: 'gear', label: 'Gear', icon: '⚙️', tabs: [
            { id: 'modules', label: 'Modules' },
            { id: 'bots', label: 'Bots' },
            { id: 'guardian', label: 'Guardian' },
            { id: 'relics', label: 'Relics' },
        ],
    },
    {
        id: 'optimizer', label: 'Optimizer', icon: '📈', tabs: [
            { id: 'optimizer', label: 'Optimizer' },
            { id: 'whatif', label: 'What If' },
            { id: 'enemies', label: 'Enemy Stats' },
            { id: 'runcoins', label: 'Coins per Run' },
            { id: 'runlength', label: 'Run Length' },
        ],
    },
    {
        id: 'tournaments', label: 'Tournaments', icon: '🏆', short: 'Tourney', tabs: [
            { id: 'tournament', label: 'This Week', title: 'Tournament' },
            { id: 'tourneyhistory', label: 'History', title: 'Tournament History' },
        ],
    },
    // Public since v2.0.0 (a preview for the owner's account before).
    { id: 'ai', label: 'Ask AI', icon: '✨', tabs: [{ id: 'ai', label: 'Ask AI' }] },
    { id: 'creators', label: 'Creator Codes', icon: '⭐', short: 'Creators', tabs: [{ id: 'creators', label: 'Creator Codes' }] },
];

const groupOf = (tab: TabName): TabGroup => TAB_GROUPS.find(g => g.tabs.some(t => t.id === tab)) ?? TAB_GROUPS[0];

const HOME_TITLE = 'TowerForge — The Tower Companion';
const titleOf = (tab: TabName) => (tab === 'profile'
    ? HOME_TITLE
    : `${(t => t?.title ?? t?.label)(groupOf(tab).tabs.find(t => t.id === tab)) ?? tab} — TowerForge`);

// A plain click opens the tab here; Ctrl / ⌘ / Shift / middle click do
// what they do on any link (new tab or window).
const plainClick = (e: React.MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export default function App() {
    const [pdfBusy, setPdfBusy] = useState(false);
    // "Get from emulator or phone": TowerForge Link's setup dialog (with its message, if it answered).
    const [linkBusy, setLinkBusy] = useState(false);
    const [linkModal, setLinkModal] = useState<{ problem: string | null } | null>(null);
    const [linkChoices, setLinkChoices] = useState<LinkSource[] | null>(null);
    // The tab last opened in each section, so going back to a section returns to it.
    const [lastInGroup, setLastInGroup] = useState<Record<string, TabName>>(() => {
        const tab = useGameStore.getState().activeTab;
        return { [groupOf(tab).id]: tab };
    });
    // ?share=CODE opens the read-only viewer instead of the app shell.
    const [shareCode] = useState(() => new URLSearchParams(window.location.search).get('share'));
    const activeTab = useGameStore(s => s.activeTab);

    // The header and currency bar fold away once a page is scrolled, and
    // come back at its top (owner, 2026-11-03: the top bars took too much of
    // the screen). Only the page area scrolls, so folding makes it taller;
    // a page only folds when it's long enough to stay scrolled after that.
    // A new page opens at its top.
    const mainRef = useRef<HTMLElement>(null);
    const [compact, setCompact] = useState(false);
    const onMainScroll = useCallback(() => {
        const el = mainRef.current;
        if (!el) return;
        setCompact(c => (c ? el.scrollTop > 12 : el.scrollTop > 80 && el.scrollHeight - el.clientHeight > 320));
    }, []);
    useEffect(() => {
        mainRef.current?.scrollTo({ top: 0 });
    }, [activeTab]);
    const setActiveTab = useGameStore(s => s.setActiveTab);
    const loadAll = useGameStore(s => s.loadAll);
    const profile = useGameStore(s => s.profile);
    const uwData = useGameStore(s => s.uwData);
    const labData = useGameStore(s => s.labData);
    const applyGameImport = useGameStore(s => s.applyGameImport);
    const importData = useGameStore(s => s.importData);

    const accountUsername = useAccountStore(s => s.username);
    const accountStatus = useAccountStore(s => s.status);
    const features = useAccountStore(s => s.features);
    const canSee = (g: TabGroup) => !g.preview || import.meta.env.DEV || features.includes(g.preview);
    const hiddenTab = !canSee(groupOf(activeTab));

    // Load saved state on mount, then check the account (which may sync
    // stats down from the server). The shared-stats viewer skips the account.
    useEffect(() => {
        loadAll();
        if (!shareCode) void useAccountStore.getState().init();
    }, [loadAll, shareCode]);   // both stable — runs once on mount

    // A phone with TowerForge Link for Android shows the Link buttons.
    useEffect(() => {
        document.documentElement.classList.toggle('tf-phone-link', phoneLinkRemembered());
    }, []);

    // The address follows the open tab. A path that named another tab is a
    // step in history; a home, unknown or differently spelled one is just
    // corrected. Umami counts each address as a page view (analytics.ts).
    useEffect(() => {
        if (shareCode) return;
        const path = TAB_PATHS[activeTab];
        const { pathname, search, hash } = window.location;
        if (pathname !== path) {
            const shown = tabFromPath(pathname);
            if (shown !== null && shown !== activeTab) window.history.pushState(null, '', path);
            else window.history.replaceState(null, '', path + search + hash);
        }
        document.title = titleOf(activeTab);
    }, [activeTab, shareCode]);

    // A preview tab this account can't see (once the account is known)
    // opens the home page instead, without leaving the address in history.
    useEffect(() => {
        if (shareCode || !hiddenTab || accountStatus === 'loading') return;
        window.history.replaceState(null, '', TAB_PATHS.profile);
        setActiveTab('profile');
    }, [hiddenTab, accountStatus, shareCode, setActiveTab]);

    // Back and forward open the tab the address names.
    useEffect(() => {
        if (shareCode) return;
        const onPop = () => {
            const tab = tabFromPath(window.location.pathname) ?? 'profile';
            setActiveTab(tab);
            setLastInGroup(last => ({ ...last, [groupOf(tab).id]: tab }));
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, [setActiveTab, shareCode]);

    // ── Summary bar values ───────────────────────────────────────
    const ownedUWs = Object.values(uwData.data).filter(u => u?.own).length;
    const labsDone = Object.values(labData).filter(v => v > 0).length;

    // ── Import handler ───────────────────────────────────────────
    // Takes the game's own data export (tool_export.json). Older TowerForge
    // backup files still import too.
    function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (isPdfFile(file)) {
            void importPdf(file);
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            let json: unknown;
            try {
                json = JSON.parse(text);
            } catch {
                // A PDF saved with a .json name — offer to read it as a PDF.
                if (looksLikePdf(text)) void importPdf(file);
                else alert('Import failed — that file isn’t valid JSON.');
                return;
            }
            importJson(json, text, 'json');
        };
        reader.readAsText(file);
    }

    // The game's data file can end up as a PDF (printed or "saved as PDF" on
    // a phone). Warn, then try to read the JSON text back out of it.
    async function importPdf(file: File) {
        const tryIt = confirm(
            'This is a PDF file. Import is made for the game’s data file (tool_export.json), so reading a PDF might not work, or might miss some data.\n\n'
            + 'Try it anyway?',
        );
        if (!tryIt) return;
        setPdfBusy(true);
        try {
            const json = await jsonFromPdf(await file.arrayBuffer());
            importJson(json, JSON.stringify(json), 'pdf');
        } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            alert(
                'Couldn’t read your game data from that PDF.\n\n'
                + `${why}\n\n`
                + 'Tip: when you export from the game, save or share the file itself (tool_export.json) instead of printing it or saving it as a PDF.',
            );
        } finally {
            setPdfBusy(false);
        }
    }

    // The export straight off an emulator, through TowerForge Link (a
    // small helper on this PC — engine/linkClient.ts). With more than one
    // emulator or phone (Link 0.4+), the player picks one first; `source`
    // is that pick. If the helper isn't running or reports a problem, the
    // setup dialog says what to do.
    async function getFromEmulator(source?: string) {
        setLinkBusy(true);
        try {
            if (source === undefined) {
                const sources = await linkSources();
                if (sources && sources.length > 1) {
                    setLinkChoices(sources);
                    return;
                }
            }
            const r = await linkExport(undefined, source);
            if (r.ok) {
                if (r.sourceId) rememberSource(r.sourceId);
                let json: unknown;
                try {
                    json = JSON.parse(r.text);
                } catch {
                    setLinkModal({ problem: 'The export file didn’t read as game data. Export your data again in the game, then try again.' });
                    return;
                }
                setLinkModal(null);
                const when = r.modified ? `, exported ${exportAge(r.modified)}` : '';
                importJson(json, r.text, 'link', `Read from ${r.source}${when}. Export again in the game whenever you want fresh data.`);
                return;
            }
            if (r.reason === 'unchanged') return;   // only when asked for a newer export
            trackEvent(r.reason === 'unreachable' ? 'Emulator link not running' : `Emulator link: ${r.code}`);
            setLinkModal({ problem: r.reason === 'problem' ? r.message : null });
        } finally {
            setLinkBusy(false);
        }
    }

    // Imports parsed data: the game's export, else a TowerForge backup.
    function importJson(json: unknown, text: string, source: 'json' | 'pdf' | 'link', note?: string) {
        if (isGameExport(json)) {
            const imp = parseGameExport(json);
            applyGameImport(imp);
            trackEvent(source === 'pdf' ? 'Import game data (PDF)' : source === 'link' ? 'Import game data (emulator)' : 'Import game data');
            const lines = [
                '✓ Imported from your game data:',
                '• Currencies',
                `• Tier progress${imp.highestTier ? ` (up to Tier ${imp.highestTier})` : ''}`,
                ...(imp.userName ? [`• Player name${imp.league ? `, ${imp.league} league` : ''}${imp.currentLeague && imp.currentLeague !== imp.league ? ` (now in ${imp.currentLeague})` : ''}${imp.presetNames.some(n => n) ? ', preset names' : ''}`] : []),
                `• ${imp.battles.length} recent battles — used to calibrate the Farming and eHP optimizer`,
                ...(imp.workshop ? ['• Workshop upgrades for all 5 presets (matched to your game presets)'] : []),
                ...(imp.enhancements ? ['• Workshop enhancements (per preset)'] : []),
                ...(imp.uws ? ['• Ultimate weapons and UW+ levels'] : []),
                ...(imp.cards ? [`• Cards: stars, masteries and presets${imp.cardSlots > 0 ? ` (${imp.cardSlots} slots)` : ''}`] : []),
                ...(imp.bannedPerks ? ['• Banned perks'] : []),
                ...(imp.dissonance ? ['• Dissonant Boosts: your best wave per tier on each track'] : []),
                ...(imp.labs ? [`• ${Object.keys(imp.labs).length} labs${imp.labsRunning?.length ? `, ${imp.labsRunning.length} being researched` : ''}`] : []),
                ...(imp.modules ? [
                    `• Modules: ${imp.modules.state.library.length} unique modules, ${imp.modules.state.loadouts.length} presets, assist slots and slot levels`,
                ] : []),
                ...(imp.modules?.unnamed.length ? [
                    `  (${imp.modules.unnamed.length} more unique modules aren’t identified yet — those were skipped)`,
                ] : []),
                ...(imp.bots ? ['• Bots: medal and Bot+ levels and which bots run, per preset'] : []),
                ...(imp.relics ? [
                    `• Relics: ${imp.relics.owned} owned, their bonus totals${imp.relics.unknown
                        ? ` (${imp.relics.unknown} newer relic${imp.relics.unknown === 1 ? ' isn’t' : 's aren’t'} known to TowerForge yet — compare the Relics tab with the game’s ⓘ totals)`
                        : ''}`,
                ] : []),
                ...(imp.vault && Object.keys(imp.vault).some(k => !k.startsWith('g')) ? [
                    `• Vault: ${Object.keys(imp.vault).filter(k => !k.startsWith('g')).length} upgrades and the sections you've unlocked`,
                ] : []),
                ...(imp.guardian?.unlocked ? [
                    `• Guardian: chips, presets and skins${imp.guardian.inGuild === false
                        ? ' (the file says you weren’t in a guild — the Guardian only fights in one; the game also says this if your guild hadn’t loaded yet)'
                        : ''}`,
                ] : []),
                ...(imp.bots ? [] : [
                    '',
                    'Not imported yet: bots — they come with the game’s 29.1.3 export, so what you entered there was left as it is.',
                ]),
                ...(imp.exportVersion !== null && imp.exportVersion > SUPPORTED_EXPORT_VERSION ? [
                    '',
                    `⚠ This file is a newer export format (version ${imp.exportVersion}) than TowerForge reads (version ${SUPPORTED_EXPORT_VERSION}). Some fields may have changed — check your numbers.`,
                ] : []),
                ...(imp.exportedAt && source !== 'link' ? ['', `Exported ${exportAge(imp.exportedAt / 1000)}.`] : []),
                ...(source === 'pdf' ? ['', 'Read from a PDF — if something looks off, import the tool_export.json file itself.'] : []),
                ...(note ? ['', note] : []),
            ];
            alert(lines.join('\n'));
            return;
        }

        if (!importData(text)) alert('Import failed — this isn’t a game data export or a TowerForge backup.');
    }

    if (shareCode) return <ErrorBoundary><SharedView code={shareCode} /></ErrorBoundary>;

    const activeGroup = groupOf(activeTab);
    function openTab(tab: TabName) {
        setActiveTab(tab);
        setLastInGroup(last => ({ ...last, [groupOf(tab).id]: tab }));
    }

    // ── Active tab renderer ──────────────────────────────────────
    function renderTab() {
        switch (activeTab) {
            case 'profile': return (
                <>
                    <WelcomeGuide onImportFile={handleImport} onEmulator={() => void getFromEmulator()} emulatorBusy={linkBusy} />
                    <ProfileTab />
                </>
            );
            case 'perks': return <PerksTab />;
            case 'tiers': return <TiersTab />;
            case 'career': return <CareerTab />;
            case 'workshop': return <WorkshopTab />;
            case 'labs': return <LabsTab />;
            case 'cards': return <CardsTab />;
            case 'uw': return <UWTab />;
            case 'puws': return <PUWsTab />;
            case 'relics': return <RelicsTab />;
            case 'vault': return <VaultTab />;
            case 'bots': return <BotsTab />;
            case 'guardian': return <GuardianTab />;
            case 'modules': return <ModulesTab />;
            case 'optimizer': return <OptimizerTab />;
            case 'enemies': return <EnemyStatsTab />;
            case 'runcoins': return <RunCoinsTab />;
            case 'runlength': return <RunLengthTab />;
            case 'whatif': return <WhatIfTab />;
            case 'tournament': return <TournamentTab />;
            case 'tourneyhistory': return <TourneyHistoryTab />;
            case 'creators': return <CreatorCodesTab />;
            case 'share': return <ShareTab />;
            case 'account': return <AccountTab />;
            case 'importguide': return <ImportGuideTab />;
            case 'ai': return hiddenTab ? null : <AiTab />;
            default: return null;
        }
    }

    return (
        <div className={`app-shell${compact ? ' is-compact' : ''}`}>
            {pdfBusy && (
                <div className="opt-apply-toast" role="status">Reading the PDF… this can take a few seconds.</div>
            )}
            {linkBusy && !linkModal && (
                <div className="opt-apply-toast" role="status">Getting your data from the emulator…</div>
            )}
            {/* ── Header and currencies (fold away while a page is scrolled) ── */}
            <div className="app-top-full" inert={compact}>
                <div className="app-top-inner">
                    <OfficialSiteNote />
                    <header className="app-header">
                        <div className="app-logo">
                            Tower<span className="logo-forge">Forge</span>
                            <span className="logo-sub"> Companion</span>
                        </div>
                        <span className="app-version">v{__APP_VERSION__}</span>

                        <div className="header-actions">
                            <DiscordLink />
                            <ThemePicker />
                            <span className="lnk-pair">
                                <button
                                    className="btn btn-dim lnk-btn"
                                    onClick={() => void getFromEmulator()}
                                    disabled={linkBusy}
                                    title="Copy the game's data export straight from an emulator on this PC, or an Android phone on the same Wi-Fi (TowerForge Link)"
                                >
                                    🖥 Get from emulator or phone
                                </button>
                                <button
                                    className="btn btn-dim lnk-btn lnk-gear"
                                    onClick={() => setLinkModal({ problem: null })}
                                    title="Set up TowerForge Link: emulators and Android phones"
                                    aria-label="Set up TowerForge Link"
                                >
                                    ⚙
                                </button>
                            </span>
                            <AutoImport
                                onImport={raw => applyGameImport(parseGameExport(raw))}
                                onNeedsLink={() => setLinkModal({ problem: null })}
                            />
                            <label className="btn btn-gold" style={{ cursor: 'pointer' }} title="Import the data export from The Tower (tool_export.json)">
                                ⬆ Import Game Data
                                <input
                                    type="file"
                                    accept=".json,application/json,.pdf,application/pdf"
                                    style={{ display: 'none' }}
                                    onChange={handleImport}
                                />
                            </label>
                        </div>

                        <div className="summary-bar">
                            <div className="sum-item">
                                <span className="sum-label">Tier</span>
                                <span className="sum-val green">
                                    {profile.highestTier ? `T${profile.highestTier}` : '—'}
                                </span>
                            </div>
                            <div className="sum-item">
                                <span className="sum-label">League</span>
                                <span className="sum-val">{profile.league || '—'}</span>
                            </div>
                            <div className="sum-item">
                                <span className="sum-label">Build</span>
                                <span className="sum-val">{profile.build || '—'}</span>
                            </div>
                            <div className="sum-item">
                                <span className="sum-label">UWs</span>
                                <span className="sum-val">{ownedUWs}/9</span>
                            </div>
                            <div className="sum-item">
                                <span className="sum-label">Labs</span>
                                <span className="sum-val">{labsDone}</span>
                            </div>
                        </div>
                    </header>

                    {/* ── Currencies ── */}
                    <CurrencyBar />
                </div>
            </div>

            {/* ── Sections, then the tabs of the open section ── */}
            <nav className="tab-bar" aria-label="Sections">
                {TAB_GROUPS.filter(canSee).map(group => {
                    const tab = lastInGroup[group.id] ?? group.tabs[0].id;
                    return (
                        <a
                            key={group.id}
                            href={TAB_PATHS[tab]}
                            className={`tab-btn tab-group ${activeGroup.id === group.id ? 'active' : ''}`}
                            aria-current={activeGroup.id === group.id ? 'true' : undefined}
                            aria-label={group.label}
                            title={group.label}
                            onClick={e => { if (plainClick(e)) { e.preventDefault(); openTab(tab); } }}
                        >
                            <span className="tab-icon" aria-hidden="true">{group.icon}</span>
                            {group.short
                                ? <><span className="tab-long">{group.label}</span><span className="tab-short">{group.short}</span></>
                                : <span>{group.label}</span>}
                        </a>
                    );
                })}
            </nav>
            {activeGroup.tabs.length > 1 && (
                <nav className="tab-subbar" aria-label={activeGroup.label}>
                    {activeGroup.tabs.map(tab => (
                        <a
                            key={tab.id}
                            href={TAB_PATHS[tab.id]}
                            className={`tab-sub ${activeTab === tab.id ? 'active' : ''}`}
                            aria-current={activeTab === tab.id ? 'page' : undefined}
                            onClick={e => { if (plainClick(e)) { e.preventDefault(); openTab(tab.id); } }}
                        >
                            {tab.id === 'account' && accountUsername ? `👤 ${accountUsername}` : tab.label}
                        </a>
                    ))}
                </nav>
            )}

            {/* ── Content ── */}
            <main className="tab-content" ref={mainRef} onScroll={onMainScroll}>
                <ErrorBoundary key={activeTab}>
                    <Suspense fallback={null}>{renderTab()}</Suspense>
                </ErrorBoundary>
            </main>

            {linkChoices && (
                <LinkSourcePicker
                    sources={linkChoices}
                    onPick={id => {
                        rememberSource(id);
                        setLinkChoices(null);
                        void getFromEmulator(id);
                    }}
                    onClose={() => setLinkChoices(null)}
                />
            )}

            {linkModal && (
                <LinkModal
                    problem={linkModal.problem}
                    busy={linkBusy}
                    onRetry={() => void getFromEmulator()}
                    onClose={() => setLinkModal(null)}
                />
            )}


        </div>
    );
}