// ============================================================
//  TowerForge Companion — Community links
//  The TowerForge Discord server: the header's Discord button, and
//  where players without a recovery code ask for help (Account tab).
//  The invite never expires (checked 2026-10-22, Discord's invite API).
//  The site maker's creator code (owner, 2026-11-05): shown on the
//  Profile page and pinned first on Creator Codes, quietly. It's on the
//  creator code list too (constants/creatorCodes.ts).
// ============================================================

export const DISCORD_URL = 'https://discord.gg/zsEAyYVQVY';
export const SITE_CREATOR_CODE = 'H3ll';

// ── Charity event (owner, 2026-11-09) ──────────────────────────
// "Waves of Kindness with The Tower": Tech Tree Games' Extra Life 2026
// team on Tiltify, raising money for Children's Miracle Network
// Hospitals. The links are the owner's own fundraiser on that team
// (checked on Tiltify 2026-11-09: the cause is Children's Miracle
// Network, Extra Life 2026, supporting techtreegames' Waves of Kindness
// with The Tower). The event runs to the end of Sunday, Nov 15; the
// banner (components/common/CharityBanner) and the code pledge go away
// on their own after that, at midnight US Eastern.
// The owner's own pledge: what code H3ll earns from Nov 9 through
// Sunday goes to the Cerebral Palsy Foundation once it's paid out.
export const CHARITY_EVENT = {
    id: '2026-11-waves-of-kindness',
    name: 'Waves of Kindness with The Tower',
    cause: "Children's Miracle Network Hospitals",
    program: 'Extra Life',
    until: 'Sunday, Nov 15',
    donateUrl: 'https://donate.tiltify.com/f5023da8-c35e-4648-9afe-3771bd45ff23',
    fundraiserUrl: 'https://tiltify.com/@h3llxspawnerx/fundraiser-for-extra-life-2026-benefiting-childrens-miracle-network',
    endsAt: Date.parse('2026-11-16T05:00:00Z'),
    pledgeCause: 'the Cerebral Palsy Foundation',
} as const;

export const charityEventOn = (now: number): boolean => now < CHARITY_EVENT.endsAt;
