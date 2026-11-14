// ============================================================
//  TowerForge Companion — Share pictures' frame
//  The pictures players post about their own account (a moment, their
//  week, the trophy shelf, a year, Me vs a friend) share one frame:
//  540 wide (saved at 2×, 1080), the wordmark and a date or subtitle at
//  the top, towerforge.net at the bottom, in the site's brand colors
//  rather than the theme's (shareTheme.ts) so every picture looks the
//  same. Square for a moment; 4:5 (540 × 675) for the longer ones, the
//  tallest Reddit shows whole. The pieces inside: the game's wave
//  counter, stat tiles and the tower in its range ring.
// ============================================================

import { forwardRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { SHARE_COLORS, SHARE_GRADIENT } from './shareTheme';
import { TowerShape } from '../common/TowerArt';

const P = SHARE_COLORS;

const frameStyle = (height: number) => ({
    width: 540,
    height,
    boxSizing: 'border-box',
    padding: '26px 30px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    color: P.text,
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    backgroundColor: P.bg,
    backgroundImage: [
        'radial-gradient(ellipse 75% 45% at 50% 34%, rgba(123, 109, 255, 0.2), transparent 70%)',
        'radial-gradient(ellipse 70% 35% at 50% 0%, rgba(255, 79, 163, 0.15), transparent 70%)',
    ].join(', '),
    // The tower's strokes (TowerArt) read these.
    '--accent': P.accent,
    '--accent-2': P.accent2,
}) as CSSProperties;

export const BrandPoster = forwardRef<HTMLDivElement, { tall?: boolean; corner?: string; children: ReactNode }>(
    function BrandPoster({ tall = false, corner, children }, ref) {
        return (
            <div ref={ref} style={frameStyle(tall ? 675 : 540)}>
                <div style={{ alignSelf: 'stretch', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>
                        TOWER<span style={{ color: P.accent }}>FORGE</span>
                    </span>
                    {corner && <span style={{ fontSize: 15, color: P.dim }}>{corner}</span>}
                </div>
                <div style={{ flex: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 0 }}>
                    {children}
                </div>
                <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 120, height: 3, borderRadius: 2, background: SHARE_GRADIENT }} />
                    <span style={{ fontSize: 21, fontWeight: 700, color: P.accent }}>towerforge.net</span>
                    <span style={{ fontSize: 14, color: P.dim }}>Companion for The Tower</span>
                </div>
            </div>
        );
    });

export function PosterTitle({ children }: { children: ReactNode }) {
    return <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.15, marginTop: 6 }}>{children}</div>;
}

export function PosterNote({ children }: { children: ReactNode }) {
    return <div style={{ fontSize: 18, color: P.dim, marginTop: 10 }}>{children}</div>;
}

// The game's wave counter, drawn bigger: a glossy violet badge with a light rim.
export function PosterCounter({ label, value }: { label: string; value: string }) {
    // A name ("Inner Land Mines") gets a smaller size than a number.
    const size = value.length > 12 ? 40 : value.length > 7 ? 50 : 64;
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 220, maxWidth: 470, marginTop: 14,
            padding: '6px 28px 10px', border: '3px solid #ece6ff', borderRadius: 22,
            background: 'linear-gradient(180deg, #8a7dff, #4a3fa8)',
            boxShadow: '0 0 34px rgba(123, 109, 255, 0.55), inset 0 2px 0 rgba(255, 255, 255, 0.3)',
        }}>
            <span style={{ fontSize: 19, fontWeight: 600, opacity: 0.92 }}>{label}</span>
            <span style={{ fontSize: size, fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    );
}

// Stat tiles, label over value, lit from the top.
export function PosterTiles({ tiles, columns = 3 }: { tiles: { label: string; value: string; gold?: boolean }[]; columns?: number }) {
    return (
        <div style={{ alignSelf: 'stretch', display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 10, marginTop: 18 }}>
            {tiles.map(t => (
                <div key={t.label} style={{
                    padding: '9px 8px 10px', borderRadius: 12, minWidth: 0,
                    background: `linear-gradient(180deg, ${P.panel}, ${P.panelLow})`,
                    border: `1px solid ${t.gold ? P.gold : P.border}`,
                }}>
                    <div style={{ fontSize: 13, color: P.dim, lineHeight: 1.25 }}>{t.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, marginTop: 3, color: t.gold ? P.gold : P.text, fontVariantNumeric: 'tabular-nums' }}>{t.value}</div>
                </div>
            ))}
        </div>
    );
}

// The tower in its range ring (TowerArt), `width` wide.
export function PosterTower({ width = 206 }: { width?: number }) {
    return (
        <svg viewBox="0 0 260 200" width={width} height={Math.round(width * 200 / 260)} aria-hidden="true" style={{ marginTop: 8 }}>
            <circle cx="130" cy="104" r="92" fill="none" stroke={P.accent2} strokeOpacity="0.55" strokeWidth="2" />
            <circle cx="130" cy="104" r="62" fill="none" stroke={P.accent2} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 6" />
            <g transform="translate(94 44) scale(0.6)"><TowerShape /></g>
        </svg>
    );
}
