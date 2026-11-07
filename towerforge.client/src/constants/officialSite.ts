// ============================================================
//  TowerForge Companion — The official site
//  TowerForge runs at towerforge.net only. A copy of the site on
//  another address (2026-11-07: someone hosted v2.6.0 on their own
//  domain) shows a note at the top saying it's a copy and linking
//  here (components/common/OfficialSiteNote). Local development,
//  previews and a PC's own network count as ours, so the note never
//  shows while working on the site.
// ============================================================

export const OFFICIAL_ORIGIN = 'https://towerforge.net';

const OFFICIAL_HOSTS = new Set([
    'towerforge.net',
    'www.towerforge.net',
    // Google Translate's page proxy ("translate this page" from
    // translate.google.com) serves towerforge.net under this name.
    'towerforge-net.translate.goog',
]);

// Hosts that only reach a PC or its own network: the dev server and
// preview (localhost), a phone testing against the PC's dev server
// (a private address), and test names (.localhost, .test).
function isLocalHost(host: string): boolean {
    if (host === 'localhost' || host === '[::1]' || host === '::1') return true;
    if (host.endsWith('.localhost') || host.endsWith('.test')) return true;
    const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
    if (!ip) return false;
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

// True when the page is towerforge.net itself or a local copy being
// worked on; false for a copy hosted anywhere else.
export function isOfficialHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return OFFICIAL_HOSTS.has(host) || isLocalHost(host);
}
