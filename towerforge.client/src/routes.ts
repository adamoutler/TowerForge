// ============================================================
//  TowerForge Companion — Tab addresses
//  Every tab has its own address (towerforge.net/creators, /optimizer…)
//  so a tab can be linked to directly. The server answers every path
//  that isn't a file with index.html (nginx try_files on the VPS,
//  MapFallbackToFile in TowerForge.Server), and the app opens the tab
//  the path names. Profile is the home page, "/".
//  Paths are one level deep: the app's own links are absolute, but
//  keeping it flat means nothing relative can break.
// ============================================================

import type { TabName } from './types/gameTypes';

export const TAB_PATHS: Record<TabName, string> = {
    profile: '/',
    tiers: '/tiers',
    career: '/career',
    share: '/share',
    account: '/account',
    importguide: '/import-guide',
    workshop: '/workshop',
    labs: '/labs',
    cards: '/cards',
    perks: '/perks',
    vault: '/vault',
    uw: '/ultimate-weapons',
    puws: '/permanent-uws',
    modules: '/modules',
    bots: '/bots',
    guardian: '/guardian',
    relics: '/relics',
    optimizer: '/optimizer',
    whatif: '/what-if',
    tournament: '/tournament',
    tourneyhistory: '/tournament-history',
    enemies: '/enemy-stats',
    runcoins: '/coins-per-run',
    runlength: '/run-length',
    creators: '/creators',
    ai: '/ai',
};

// Other spellings that open a tab: the tab ids (the analytics' page names
// before tabs had addresses) and the long names.
const ALIASES: Record<string, TabName> = {
    '/profile': 'profile',
    '/uw': 'uw',
    '/uws': 'uw',
    '/puws': 'puws',
    '/whatif': 'whatif',
    '/enemies': 'enemies',
    '/runcoins': 'runcoins',
    '/runlength': 'runlength',
    '/creator-codes': 'creators',
    '/import': 'importguide',
    '/importguide': 'importguide',
};

// Paths the server uses for itself — a tab must never take one.
export const RESERVED_PATHS = ['/api', '/analytics', '/assets', '/downloads'];

// The tab an address names (any case, trailing slash or not); null when
// it names none.
export function tabFromPath(pathname: string): TabName | null {
    const p = `/${pathname.toLowerCase().replace(/^\/+|\/+$/g, '')}`;
    const hit = (Object.entries(TAB_PATHS) as [TabName, string][]).find(([, path]) => path === p);
    return hit?.[0] ?? ALIASES[p] ?? null;
}
