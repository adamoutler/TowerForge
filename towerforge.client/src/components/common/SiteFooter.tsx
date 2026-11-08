// ============================================================
//  TowerForge Companion — Site footer
//  At the end of every page and shared-stats link: that TowerForge is
//  fan-made and not Tech Tree Games' (whose game art it shows, with
//  their written permission — owner, 2026-11-08), and
//  links to Privacy, Terms, the open-source licenses
//  (third-party-licenses.txt, written at build by licensesPlugin.ts)
//  and the Discord. Added 2026-11-08 with the legal pages.
// ============================================================

import type { MouseEvent } from 'react';
import { DISCORD_URL } from '../../constants/community';
import { TAB_PATHS } from '../../routes';
import type { TabName } from '../../types/gameTypes';

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

// onOpen: open a page in place (the app); without it the links load the page.
export default function SiteFooter({ onOpen }: { onOpen?: (tab: TabName) => void }) {
    const page = (tab: TabName, label: string) => (
        <a href={TAB_PATHS[tab]}
            onClick={e => { if (onOpen && plainClick(e)) { e.preventDefault(); onOpen(tab); } }}>
            {label}
        </a>
    );
    return (
        <footer className="site-foot">
            <p>
                TowerForge is a free, fan-made companion for The Tower. It isn&apos;t affiliated with or endorsed by
                Tech Tree Games; The Tower and its game art belong to Tech Tree Games and are used with their permission.
            </p>
            <nav aria-label="About TowerForge">
                {page('privacy', 'Privacy')}
                {page('terms', 'Terms')}
                <a href="/third-party-licenses.txt" target="_blank" rel="noopener">Open-source licenses</a>
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a>
            </nav>
        </footer>
    );
}
