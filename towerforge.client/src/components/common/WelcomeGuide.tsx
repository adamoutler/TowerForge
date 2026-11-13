// ============================================================
//  TowerForge Companion — Welcome guide (home page)
//  For a first visit: what the site does and how to get the game's
//  data in. Shown on Profile until the player has data (a tier set or
//  runs imported) or hides it; hidden is remembered per browser
//  (localStorage tc_welcome). Waits for a signed-in account to load,
//  so its saved stats don't flash the guide.
//  The game's export (29.1.3+): Settings → External Tools Export, saved
//  as tool_export.json in the game's app folder (docs/towerforge-link.md).
//  Step 2 shows the ways in that work on this device first
//  (ImportWays, as in the Import help), each linking to its part of
//  the Import Guide.
// ============================================================

import { useState } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import ImportWays from './ImportWays';
import type { ImportDevice } from './importDevice';
import { useGameStore } from '../../store/useGameStore';
import { useAccountStore } from '../../store/useAccountStore';
import { TAB_PATHS } from '../../routes';
import type { TabName } from '../../types/gameTypes';
import DiscordLink from './DiscordLink';
import { openGuide } from '../../guideNav';

const KEY = 'tc_welcome';

function wasHidden(): boolean {
    try { return localStorage.getItem(KEY) === 'hidden'; } catch { return false; }
}

const TOOLS: { tab: TabName; name: string; what: string }[] = [
    { tab: 'optimizer', name: 'Optimizer', what: 'The best next buy for your coins, stones, lab time, medals, shards, gems and Bits.' },
    { tab: 'whatif', name: 'What If', what: 'What any upgrade would do to your waves and coins, before you buy it.' },
    { tab: 'tournament', name: 'Tournaments', what: "This week's battle conditions, how far your runs should get, and your tournament history." },
    { tab: 'modules', name: 'Modules & Bots', what: 'Your presets laid out like the game, with your assist slots and bot levels.' },
];

interface Props {
    device: ImportDevice;
    signedIn: boolean;
    onImportFile: (e: ChangeEvent<HTMLInputElement>) => void;
    onLink: () => void;
    onSignIn: () => void;
}

export default function WelcomeGuide({ device, signedIn, onImportFile, onLink, onSignIn }: Props) {
    const [hidden, setHidden] = useState(wasHidden);
    const hasData = useGameStore(s => s.importedBattles.length > 0 || !!s.profile.highestTier);
    const accountLoading = useAccountStore(s => s.status === 'loading');
    const setActiveTab = useGameStore(s => s.setActiveTab);

    if (hidden || hasData || accountLoading) return null;

    const hide = () => {
        try { localStorage.setItem(KEY, 'hidden'); } catch { /* not remembered */ }
        setHidden(true);
    };
    // Tab links open in place; a middle or modified click opens a new tab.
    const open = (tab: TabName) => (e: MouseEvent) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        setActiveTab(tab);
    };
    const guide = (part: string) => (e: MouseEvent) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openGuide(part);
    };
    const guideLink = (part: string, text: string) => <a href={`${TAB_PATHS.importguide}#${part}`} onClick={guide(part)}>{text}</a>;

    return (
        <section className="wlc" aria-labelledby="wlc-title">
            <div className="wlc-head">
                <div>
                    <h2 id="wlc-title" className="wlc-title">Welcome to <span>TowerForge</span></h2>
                    <p className="wlc-lead">
                        A companion for The Tower. Bring in your account and TowerForge works out your damage, how far
                        your runs get and your coins — then ranks every upgrade by what it gives for what it costs.
                    </p>
                </div>
                <button className="btn btn-dim wlc-hide" onClick={hide} title="Hide this guide">Hide</button>
            </div>

            <div className="wlc-tools">
                {TOOLS.map(t => (
                    <a key={t.tab} className="wlc-tool" href={TAB_PATHS[t.tab]} onClick={open(t.tab)}>
                        <strong>{t.name}</strong>
                        <span>{t.what}</span>
                    </a>
                ))}
            </div>

            <h3 className="wlc-sub">Get your game data in</h3>
            <ol className="wlc-steps">
                <li>
                    <strong>Export it from the game.</strong> In The Tower (update 29.1.3 or later): Settings →
                    External Tools Export. The game saves your data as <code>tool_export.json</code>.
                </li>
                <li>
                    <strong>Bring it here.</strong> Workshop, labs, cards, UWs, modules, bots, relics, Guardian, your
                    recent runs and tournaments all fill in at once.
                    <ImportWays
                        device={device}
                        signedIn={signedIn}
                        onImportFile={onImportFile}
                        onLink={onLink}
                        onGuide={openGuide}
                        onSignIn={onSignIn}
                        foot={false}
                    />
                    <span className="wlc-way">
                        On another device, or stuck? The {guideLink('igd-top', 'Import Guide')} walks through every way,
                        screen by screen.
                    </span>
                </li>
            </ol>

            <div className="wlc-foot">
                <p>
                    No file? Every tab can be filled in by hand — start below with your build and tier. Your data stays
                    in this browser; an account (optional) saves it online.
                </p>
                <DiscordLink />
            </div>
        </section>
    );
}
