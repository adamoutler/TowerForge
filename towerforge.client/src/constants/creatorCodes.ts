// ============================================================
//  TowerForge Companion — Creator Codes
//  The Tower's content creators: the code players enter to support
//  them, the name they go by, what they're known for, and where to
//  find their content. A creator gets 3% of in-app purchases and 5%
//  of webstore purchases made with their code, at no extra cost to
//  the player (owner, 2026-11-09; the 5% / 8% shown before was
//  wrong); a code stays active for 30 days (wiki: Content Creator
//  Page).
//
//  Sources (all sent by the site owner, 2026-10-17):
//    - Codes, player names and IDs: the creator code list. Codes keep
//      that list's spelling (the second list writes a few differently,
//      e.g. "REND", "ScriptLord"). darknyxzz's ID has 15 digits, as
//      given. Creators only on the second list have no ID yet.
//    - Names, "known for" and links: the "Known Creators & Codes" list,
//      in the creators' own words (raw URLs moved to links, "|" shown
//      as "·"). Every Discord invite was checked to be live.
//    - Also kept from checking the creators' YouTube channels: jplays'
//      Twitch and Zaerdin's X (both listed on their own channels).
//  Only add a link that's confirmed — from the creator, or a page that
//  clearly belongs to them. Profile pictures: scripts/fetch-creator-avatars.mjs.
// ============================================================

export type CreatorSite = 'youtube' | 'twitch' | 'kick' | 'tiktok' | 'discord' | 'reddit' | 'x' | 'github' | 'website';

// Display names, in the order links are shown.
export const CREATOR_SITES: Record<CreatorSite, string> = {
    youtube: 'YouTube',
    twitch: 'Twitch',
    kick: 'Kick',
    tiktok: 'TikTok',
    discord: 'Discord',
    reddit: 'Reddit',
    x: 'X',
    github: 'GitHub',
    website: 'Website',
};

export interface CreatorLink {
    site: CreatorSite;
    url: string;
    label?: string;     // shown instead of the site name (websites default to their address)
}

export interface Creator {
    code: string;       // what players type in Settings or on the webstore
    name: string;       // what they go by in the community (their Discord name)
    player: string;     // player name on the code list (often their Discord username)
    playerId?: string;
    about?: string;     // what they're known for, in their words
    links: CreatorLink[];
}

// File name for a creator's picture: "TheDisasterFish" → thedisasterfish.
export const creatorSlug = (code: string): string =>
    code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const creatorLink = (creator: Creator, site: CreatorSite): string | undefined =>
    creator.links.find(l => l.site === site)?.url;

type L = [CreatorSite, string, string?];
const c = (code: string, name: string, player: string, playerId: string | null, about: string | null, links: L[] = []): Creator => ({
    code, name, player,
    ...(playerId ? { playerId } : {}),
    ...(about ? { about } : {}),
    links: links.map(([site, url, label]) => ({ site, url, ...(label ? { label } : {}) })),
});

const yt = (handle: string): L => ['youtube', `https://www.youtube.com/@${handle}`];
const dc = (invite: string): L => ['discord', `https://discord.gg/${invite}`];

export const CREATORS: Creator[] = [
    c('1410c', '1410c | Bubble Guard ♡', '1410c', '322BA26372C2A288', 'Moderating · Sheets & Tools'),
    c('250', 'spadace50', 'spadace50', '77D417A14B704EE4', null),
    c('300', 'Spartan', 'spartontyler', '40283260A0DE5178', null, [yt('SpartanTheTower'), dc('3yjCH32pWc')]),
    c('AV8er', 'AV8er', 'av8er', 'F3BE4A63BCD60AC3', 'Legends tournament videos and guides',
        [yt('iAV8er'), ['twitch', 'https://www.twitch.tv/av8er']]),
    c('bilinz', 'bilinz', 'bilinz', '990A6EEA63FA8AD6', null),
    c('Bonzo', 'Bonzo', 'bonzo.samm', 'BB696E5B4936CA8A', null, [yt('BonzosTower')]),
    c('cloud', 'All Clouded', 'buffythetuffy', null, null, [yt('AllClouded')]),
    c('crowrocks', 'Crowbarzero', 'Crowbarzero', 'CBB75D5FE540266E', null, [yt('crowbarzero'), dc('Fzryrc7')]),
    c('cruoton', 'Cruoton', 'cruoton', 'B7217B63CE2DDF80', 'Moderating · Extensive Game Knowledge · Mentoring'),
    c('CTK', 'coreytae', 'coreytae', '51C1CB681E0A58B2', null),
    c('darknyxzz', 'Dark', 'idadarknezzi', '23EB3A7EA332398', 'Moderating · Sheets'),
    c('duckirons', 'ꕷ𝓲𝖗 ÐûçҜ 🦆', 'Duck 🦆', '977C5917940B511A', 'Moderating'),
    c('ebats', 'ebats', 'ebats', '74C98C2D65825E6A', 'Always playing, probably on four accounts',
        [yt('ebatstower'), dc('PqTSjkRhfv')]),
    c('EconSquirrel', 'quietfanta', 'quietfanta', '2FB4DB043F9F7B37', null),
    c('EthanDX', 'EthanDX🌴', 'ethandx', '2BD4ADBB9A560204', null, [yt('EthanDX'), dc('FGk8TpACER')]),
    c('flipstar', 'Flipstar', 'mrflipstar', '188EAC641A3EBC7A', null, [yt('MrFlipstar')]),
    c('Greeny', 'Greeny', 'Greeny', 'CE2B716E1DEB338C', 'Making YouTube videos for The Tower', [yt('GreenyTower')]),
    c('H3ll', 'h3llxspawnerx', 'h3llxspawnerx', '7DA5D423F1CF6B75', null),
    c('hiro29', 'hiro29', 'heren4185', null, 'Tower write-ups on note',
        [['website', 'https://note.com/hiro29_tower', 'Blog']]),
    c('IceQuasars', 'IceQuasars', 'icequasars', 'D9C208F3AC83DA84', 'Discord Moderator & Mentor'),
    c('icetae', 'IceTaeto | KaiserKartoffel', 'IceTae', 'B0640853C95F89F2', 'Moderating · TDC co-founder'),
    c('Inthebooks', 'StudyMage', 'cautiouslyoptimistic1440', null,
        'Occasional tournament and farming streams, advice for newer players.', [yt('StudyMage1440p')]),
    c('Iver', 'Iver', 'iver_frog', '31B1B27F7AA2FDDD', 'Moderating'),
    c('Jaido', 'jaido_92', 'jaido_92', '91413B0758BC4AE7', null),
    c('jamn', 'jamn4evr', 'jamn4evr', '5327C8E2D857695B', 'Build breakdowns, module pulls and tower reviews',
        [yt('jamn4evr'), dc('kG2taa9sXk')]),
    c('jdevo', 'Chairman Meow | Jimodthy', 'tmrxjd', '26AD84D6B32DC87B',
        'Moderating · The Tower Run Tracker · Discord Bots · Server Events',
        [['github', 'https://github.com/TmRxJD/TheTowerSDK'], ['website', 'https://the-tower-run-tracker.com/']]),
    c('JGU', 'Taggz', '_taggz', '184C7DE105306865', 'I dunno, I\'m just guessing.', [yt('taggzJGU'), dc('FHejXjWa9Z')]),
    c('JP978', 'JP978', 'beyond882001', '8F9EC4F8D06525FC', 'Known fish connoisseur.', [yt('Jp978gaming')]),
    c('jplays', 'J Plays', 'JPlays', 'A714DA83E2F3826A', null, [
        yt('JPlays1'), ['twitch', 'https://www.twitch.tv/jplaysone'], dc('qb4PdSE6vA'),
        ['website', 'https://the-tower.notion.site', 'Tower Knowledge Hub'],
    ]),
    c('Kohyal', 'Kohyal', 'kohyal', 'B489726B4AD50A72', null, [yt('KohyalStudios'), dc('qXrYMTEVUX')]),
    c('Milamber33', 'Milamber33', 'Milamber33', '4A98A60A5D9E4E25', 'Moderating'),
    c('minion', 'minionek247', 'minionek247', 'C5BA98964102874D',
        'Guides and infographics on the Tower Knowledge Hub (Lab Tier List, perk trade-off advice)'),
    c('NanaSeiYuri', 'NanaSeiYuri', 'NanaSeiYuri', 'A0710535553C4FA8', 'Moderating · Making Sheets & Infographics'),
    c('NERD', 'Kryntos', 'kryntos', 'DFD247A4D7729ECF',
        'Ultimate Coin Farming Guide, Disco Guides for Average EHP Tower & Tower Roasts', [yt('KryntosGames')]),
    c('nickavii', 'nick_avii ♂', 'nick_avii', null, 'Moderating'),
    c('Panda', 'Tequila Man', 'tequilaman007', '55DFD12DDC7BA40B', 'Just a panda man playing some games', [yt('tequilaman7')]),
    c('pandu', 'pandu.eth', 'pandu.eth', 'C934EE0BE5BF437B', null),
    c('PogTheMightyOne', 'PogTheMightyOne', 'PogTheMightyOne', null, 'Moderating · Discord Bots'),
    c('Professor', 'brunos833', 'brunos833', '6F319C6C87BF70CA', null),
    c('RacingTower', 'clarotus', 'clarotus', '7F75E73AE5949CC4', null),
    c('Rend', 'Dizzy (Project Rend Dev)', 'dizzyloki', 'AA5E111FDBC3B157', 'Project Rend, the stats tracker for The Tower',
        [yt('dizzy-project-rend'), dc('ZumkRe5jbm'), ['website', 'https://www.projectrend.com']]),
    c('ronmv', 'RonMV', 'ronmv', 'EF06EE8B000DC9EE', 'Moderating'),
    c('SCRIPTLORD', 'Bisse', 'bisse123', 'B54B2EAF779842C2',
        'I maintain the script for updating and importing data to Effective Paths and IDS sheets.'),
    c('Shado', 'ShadoSabre', 'uncas', null, null, [yt('ShadoSabre'), dc('zEJYeAFq37')]),
    c('sheetlord', 'Mattew the Sheetlord', 'matteweon', 'B9BDCA52E3D8005A', 'Moderating · #effective-paths'),
    c('Shion', 'Princess Shion👑', 'Actualize', 'A028C858FDE79076', 'Moderating'),
    c('shuck', 'Shuckle', 'Shuckle', 'F5F0C35DEF5D37A1', null),
    c('skye', 'Meow meow meow | i got a code!', 'Skye', '3AF60D885181322C', 'mytower.app and lots of other tools and guides',
        [['website', 'https://mytower.app/'], ['website', 'https://thetower.tools']]),
    c('Sleek', 'Sleek', 'thesleek', '28A79BF856E46363', 'Tower Tours', [yt('Sleekish')]),
    c('Strom', 'Strom', 'kfungi', null, 'Tower progression series', [yt('StromTower')]),
    c('TheDisasterFish', 'TheDisasterFish', 'thedisasterfish', 'C249A98DEA598A8D', 'Moderating · thetower.lol · Discord Bots',
        [['website', 'https://thetower.lol/']]),
    c('TheFlock', 'Xepher Gamez', 'xephergamez', null, null, [yt('xephergamez'), dc('ZQ9dRwkrt4')]),
    c('VCMomo', '𝓥𝓒𝓜𝓸𝓶𝓸', 'VCMomo', 'A8E0B1E6AE9CB991', 'Moderating'),
    c('Wisco212', 'Wisco212', '2fastw212_61902', null, 'Mythic tournament streams', [yt('Wisco212')]),
    c('Zaerdin', 'Zaerdin', 'zaerdin', '58F51AFB93920119', null,
        [yt('ZaerdinGaming'), dc('TCcb5EFRgs'), ['x', 'https://x.com/Zaerdin']]),
    c('zanny', 'use code ZANNY', 'zanny37', '901D5FE2204AD58D', 'Zanny\'s Tools · Guides in the main Tower Discord'),
    c('Zeus', 'Zeus-Hail Coin Gun-Little fishy', 'insomnia115', '2F89EA7FCEC47530', 'Mod Mentor'),
];

// The official webstore, where a code also counts (5% there).
export const WEBSTORE_URL = 'https://store.techtreegames.com/thetower/';
