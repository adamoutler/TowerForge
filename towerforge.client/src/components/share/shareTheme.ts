// ============================================================
//  TowerForge Companion — Share Image Theme
//  Palette and poster sizing for the share images. Colors are
//  hardcoded (not CSS vars) so exports look the same in every theme.
//  Each card draws two ways: fluid on the shared-stats page (fits a
//  phone), and as a fixed-width poster kept off-screen for Export
//  Image, so an export looks the same from any screen. Cards are size
//  containers: inside them, cqw units and @container rules follow the
//  card's width, not the screen's. Long posters are cut into
//  Reddit-shaped pages (PosterPages); posterImages.ts turns them into
//  PNGs and the Export Images window (exportImages.ts) hands them over.
// ============================================================

import type { CSSProperties } from 'react';

export const SHARE_CARD_WIDTH = 1100;

// The site's own brand colors (the default Synthwave theme and the
// TowerForge logo: hot pink into violet on plum black), so a shared
// image reads as TowerForge whichever theme the sender uses.
export const SHARE_COLORS = {
    bg: '#0b0812',
    panel: '#211936',       // tile top (tiles shade down to panelLow)
    panelLow: '#150f22',
    border: '#3b3057',
    text: '#f8f3fe',
    dim: '#a89ebf',
    accent: '#ff4fa3',      // pink: the logo's FORGE, links
    accent2: '#7b6dff',     // violet: the other end of the brand gradient
    gold: '#ffc14d',
};

// The logo's pink → violet, for rules and heading marks.
export const SHARE_GRADIENT = `linear-gradient(90deg, ${SHARE_COLORS.accent}, ${SHARE_COLORS.accent2})`;

const FONT_STACK = "'Segoe UI', system-ui, -apple-system, sans-serif";

// Wrapper that holds the poster root. Positioned far off-screen so
// it is rendered (and measurable) but never visible to the user.
// Two soft glows (pink from the top, violet from the bottom corner)
// light the plum background, as the site's own pages are lit.
export const SHARE_CARD_ROOT_STYLE: CSSProperties = {
    width: SHARE_CARD_WIDTH,
    backgroundColor: SHARE_COLORS.bg,
    backgroundImage: [
        'radial-gradient(ellipse 70% 45% at 50% 0%, rgba(255, 79, 163, 0.13), transparent 70%)',
        'radial-gradient(ellipse 60% 50% at 100% 100%, rgba(123, 109, 255, 0.12), transparent 70%)',
    ].join(', '),
    color: SHARE_COLORS.text,
    fontFamily: FONT_STACK,
    padding: 40,
    boxSizing: 'border-box',
};

// The card's root: the poster (fixed width) or the on-page card (fluid).
export function shareRootStyle(poster = false): CSSProperties {
    return poster
        ? { ...SHARE_CARD_ROOT_STYLE, containerType: 'inline-size' }
        : {
            ...SHARE_CARD_ROOT_STYLE,
            containerType: 'inline-size',
            width: '100%',
            padding: 'clamp(12px, 3.5vw, 40px)',
            border: `1px solid ${SHARE_COLORS.border}`,
            borderRadius: 12,
            boxShadow: '0 12px 40px rgba(255, 79, 163, 0.07)',
        };
}

// A stat tile's box, as in StatsShareCard: lit from the top, and a
// maxed one ringed in gold.
export function shareTileStyle(maxed = false): CSSProperties {
    return {
        background: `linear-gradient(180deg, ${SHARE_COLORS.panel}, ${SHARE_COLORS.panelLow})`,
        border: `1px solid ${maxed ? SHARE_COLORS.gold : SHARE_COLORS.border}`,
        boxShadow: maxed
            ? 'inset 0 1px 0 rgba(255, 220, 150, 0.12), 0 0 14px rgba(255, 193, 77, 0.18)'
            : 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
        borderRadius: 10,
        minWidth: 0,
    };
}

export const SHARE_OFFSCREEN_STYLE: CSSProperties = {
    position: 'fixed',
    left: -10000,
    top: 0,
    pointerEvents: 'none',
};
