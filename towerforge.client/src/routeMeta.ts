// ============================================================
//  TowerForge Companion — Each page's title and description
//  What a search result or a link preview (Discord, Reddit, X) shows for
//  each address. Those bots don't run the app, so the build writes one
//  small HTML file per page with these in its head (routePagesPlugin.ts;
//  nginx serves /optimizer from optimizer.html), and the app sets the
//  same description when a page opens. Before 2026-11-13 every link
//  showed the home page's card. Plain words, under ~160 characters.
// ============================================================

import type { TabName } from './types/gameTypes';
import { TAB_PATHS } from './routes';

export const SITE_NAME = 'TowerForge';
export const HOME_TITLE = 'TowerForge — The Tower Companion';

export const ROUTE_META: Record<TabName, { title: string; description: string }> = {
    profile: { title: HOME_TITLE, description: 'Companion for The Tower (idle tower defense): import your account and see what to upgrade next, ranked by the waves and coins each upgrade gives for what it costs.' },
    tiers: { title: 'Tiers', description: 'Your best wave on every tier of The Tower, with the milestones still ahead and the Dissonant Boosts you\'ve filled.' },
    career: { title: 'Career', description: 'Your The Tower career: coins and resources earned between imports, lifetime totals, best runs per tier, module pulls and research history.' },
    share: { title: 'Share', description: 'Share your The Tower build as a link or as images sized for Reddit and Discord: workshop, labs, cards, UWs, modules and more.' },
    account: { title: 'Account', description: 'A free TowerForge account (no email) keeps your The Tower stats on every device you use.' },
    importguide: { title: 'Import Guide', description: 'How to bring your The Tower account into TowerForge from an emulator, an Android phone, an iPhone or a Mac — every step, screen by screen.' },
    workshop: { title: 'Workshop', description: 'Every Workshop upgrade in The Tower with its next cost and what it gives, imported from your game.' },
    labs: { title: 'Labs', description: 'Your labs in The Tower: what\'s researching, when each finishes, and which lab to research next.' },
    cards: { title: 'Cards', description: 'Your cards and card masteries in The Tower, drawn like the game\'s screen, with your card presets.' },
    perks: { title: 'Perks', description: 'The Tower\'s perks: your bans and picks, and what each perk is worth for your build.' },
    vault: { title: 'Vault', description: 'The Tower\'s Vault: every upgrade, its key cost and what it gives, with the keys you\'ve spent and have left.' },
    uw: { title: 'Ultimate Weapons', description: 'Your Ultimate Weapons and UW+ in The Tower: levels, damage and cooldowns, and which stat to upgrade next with stones.' },
    puws: { title: 'Permanent UWs', description: 'How close each Ultimate Weapon in The Tower is to permanent uptime, and what closes the gap.' },
    modules: { title: 'Modules', description: 'Your The Tower module presets laid out like the game, with assist slots, substats and where your shards should go.' },
    bots: { title: 'Bots', description: 'Your bots in The Tower: medal levels, Bot+ and which bots run in each preset.' },
    guardian: { title: 'Guardian', description: 'The Tower\'s Guardian: your chips and presets, and the swap that helps your runs or your coins most.' },
    relics: { title: 'Relics', description: 'Your relics in The Tower and the bonus totals they add up to.' },
    optimizer: { title: 'Optimizer', description: 'The best next upgrade for your The Tower account — coins, stones, lab time, medals, shards, gems and Bits — ranked by what it gives for what it costs.' },
    whatif: { title: 'What If', description: 'What any upgrade in The Tower would do to your waves and coins, before you buy it.' },
    tournament: { title: 'Tournament', description: 'This week\'s tournament in The Tower: the battle conditions, how far your runs should get, and the best build for it.' },
    tourneyhistory: { title: 'Tournament History', description: 'Every tournament you\'ve played in The Tower: waves and rank over time, by league.' },
    enemies: { title: 'Enemy Stats', description: 'The Tower\'s enemies at any wave and tier: health, damage and speed.' },
    runcoins: { title: 'Coins per Run', description: 'Coins, cells, gems and shards per run and per hour from your own The Tower runs.' },
    runlength: { title: 'Run Length', description: 'How far your runs in The Tower get, and what ends them.' },
    creators: { title: 'Creator Codes', description: 'Every The Tower content creator\'s code in one list — copy a code with one tap, and see who\'s live on Twitch and YouTube.' },
    ai: { title: 'Ask AI', description: 'Ask about your The Tower account in your own words. It runs in your browser and answers from TowerForge\'s numbers.' },
    privacy: { title: 'Privacy', description: 'What TowerForge keeps about you, where, for how long, and how to get it or remove it.' },
    terms: { title: 'Terms of use', description: 'TowerForge\'s terms of use: a free, fan-made companion for The Tower.' },
};

// "Optimizer — TowerForge"; the home page has its own.
export const pageTitle = (tab: TabName): string =>
    tab === 'profile' ? HOME_TITLE : `${ROUTE_META[tab].title} — ${SITE_NAME}`;

// The build's page files (routePagesPlugin.ts): index.html with one page's words.
const ORIGIN = 'https://towerforge.net';

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// index.html's head with one page's words; throws if a tag it changes is missing.
export function pageHtml(index: string, tab: TabName): string {
    const meta = ROUTE_META[tab];
    const title = escapeAttr(pageTitle(tab));
    const description = escapeAttr(meta.description);
    const url = `${ORIGIN}${TAB_PATHS[tab] === '/' ? '/' : TAB_PATHS[tab]}`;
    const swaps: [RegExp, string][] = [
        [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
        [/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${description}" />`],
        [/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${title}" />`],
        [/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${description}" />`],
        [/<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${url}" />`],
        [/<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${url}" />`],
        [/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${title}" />`],
        [/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${description}" />`],
    ];
    let html = index;
    for (const [find, put] of swaps) {
        if (!find.test(html)) throw new Error(`routePagesPlugin: index.html has no ${find.source}`);
        html = html.replace(find, () => put);   // a function: no "$" patterns in the words
    }
    return html;
}
