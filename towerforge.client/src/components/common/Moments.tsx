// ============================================================
//  TowerForge Companion — Moments on Profile
//  What the player's last imports did that's worth showing off (a new
//  tier, a best wave, a promotion, a best tournament finish or wave, a
//  new UW or UW+: engine/moments.ts), each with Share picture: a
//  square image in the game's wave-counter style with towerforge.net
//  on it, through the Export Images window (save, or the phone's share
//  menu → Reddit, Discord, Photos). Kept two weeks or until closed
//  (store/moments.ts). The picture uses the site's brand colors, not
//  the theme's, so it looks the same from every theme (shareTheme.ts).
// ============================================================

import { forwardRef, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Moment, MomentKind } from '../../engine/moments';
import { closeMoment, useMoments } from '../../store/moments';
import { openExportDialog } from '../share/exportImages';
import { SHARE_COLORS, SHARE_GRADIENT, SHARE_OFFSCREEN_STYLE } from '../share/shareTheme';
import { TowerShape } from './TowerArt';
import { trackEvent } from '../../analytics';

const ICON: Record<MomentKind, string> = {
    promoted: '🏅', rank: '🏆', tier: '⭐', tourneyWave: '🌊', wave: '🌊', uwPlus: '⚡', uw: '⚡',
};

const fileName = (m: Moment) => `towerforge-${m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export default function Moments() {
    const moments = useMoments();
    const [sharing, setSharing] = useState<{ m: Moment; n: number } | null>(null);
    const poster = useRef<HTMLDivElement>(null);

    // Once the picture's page is drawn off-screen, the window makes the PNG.
    useEffect(() => {
        if (!sharing || !poster.current) return;
        openExportDialog(poster.current, fileName(sharing.m), sharing.m.title);
        trackEvent('Moment', { step: 'share', kind: sharing.m.kind });
    }, [sharing]);

    if (!moments.length) return null;
    const share = (m: Moment) => setSharing(s => ({ m, n: (s?.n ?? 0) + 1 }));
    const [first, ...more] = moments;

    return (
        <section className="mom" aria-label="What your imports did">
            <div className="mom-main">
                <span className="mom-title"><span aria-hidden="true">{ICON[first.kind]}</span> {first.title}</span>
                <div className="mom-row">
                    <div className="home-counter mom-counter">
                        <span className="home-counter-label">{first.label}</span>
                        <span className="home-counter-val">{first.value}</span>
                    </div>
                    <div className="mom-side">
                        {first.detail && <span className="mom-detail">{first.detail}</span>}
                        <button type="button" className="btn btn-accent" onClick={() => share(first)}>📸 Share picture</button>
                    </div>
                </div>
                <button type="button" className="home-install-close mom-close" onClick={() => closeMoment(first.id)} aria-label={`Close: ${first.title}`}>✕</button>
            </div>
            {more.length > 0 && (
                <ul className="mom-more">
                    {more.map(m => (
                        <li key={m.id}>
                            <span aria-hidden="true">{ICON[m.kind]}</span>
                            <span className="mom-more-text"><strong>{m.title}</strong> {m.value} <span className="mom-detail">{m.label}{m.detail ? `, ${m.detail.charAt(0).toLowerCase()}${m.detail.slice(1)}` : ''}</span></span>
                            <button type="button" className="home-now-link home-now-btn" onClick={() => share(m)}>📸 Share</button>
                            <button type="button" className="home-install-close" onClick={() => closeMoment(m.id)} aria-label={`Close: ${m.title}`}>✕</button>
                        </li>
                    ))}
                </ul>
            )}
            {sharing && (
                <div style={SHARE_OFFSCREEN_STYLE} aria-hidden="true">
                    <MomentPoster ref={poster} moment={sharing.m} key={sharing.n} />
                </div>
            )}
        </section>
    );
}

// ── The picture: 540 × 540, saved at 2× (1080 × 1080) ─────────
const P = SHARE_COLORS;
const SIZE = 540;

const posterStyle = {
    width: SIZE,
    height: SIZE,
    boxSizing: 'border-box',
    padding: '28px 32px 26px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    color: P.text,
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    backgroundColor: P.bg,
    backgroundImage: [
        'radial-gradient(ellipse 75% 50% at 50% 38%, rgba(123, 109, 255, 0.22), transparent 70%)',
        'radial-gradient(ellipse 70% 40% at 50% 0%, rgba(255, 79, 163, 0.16), transparent 70%)',
    ].join(', '),
    // The tower's strokes (TowerArt) read these.
    '--accent': P.accent,
    '--accent-2': P.accent2,
} as CSSProperties;

// The game's wave counter, drawn bigger: a glossy violet badge with a light rim.
const counterStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: 220,
    maxWidth: 470,
    padding: '6px 28px 10px',
    border: '3px solid #ece6ff',
    borderRadius: 22,
    background: 'linear-gradient(180deg, #8a7dff, #4a3fa8)',
    boxShadow: '0 0 34px rgba(123, 109, 255, 0.55), inset 0 2px 0 rgba(255, 255, 255, 0.3)',
};

export const MomentPoster = forwardRef<HTMLDivElement, { moment: Moment }>(function MomentPoster({ moment }, ref) {
    const date = new Date(moment.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    // A name ("Inner Land Mines") gets a smaller size than a number.
    const valueSize = moment.value.length > 12 ? 40 : moment.value.length > 7 ? 50 : 64;
    return (
        <div ref={ref} style={posterStyle}>
            <div style={{ alignSelf: 'stretch', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>
                    TOWER<span style={{ color: P.accent }}>FORGE</span>
                </span>
                <span style={{ fontSize: 15, color: P.dim }}>{date}</span>
            </div>
            <svg viewBox="0 0 260 200" width={206} height={158} aria-hidden="true" style={{ marginTop: 8 }}>
                <circle cx="130" cy="104" r="92" fill="none" stroke={P.accent2} strokeOpacity="0.55" strokeWidth="2" />
                <circle cx="130" cy="104" r="62" fill="none" stroke={P.accent2} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 6" />
                <g transform="translate(94 44) scale(0.6)"><TowerShape /></g>
            </svg>
            <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, marginTop: 4 }}>{moment.title}</div>
            <div style={{ ...counterStyle, marginTop: 14 }}>
                <span style={{ fontSize: 19, fontWeight: 600, opacity: 0.92 }}>{moment.label}</span>
                <span style={{ fontSize: valueSize, fontWeight: 800, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{moment.value}</span>
            </div>
            {moment.detail && <div style={{ fontSize: 19, color: P.dim, marginTop: 14 }}>{moment.detail}</div>}
            <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 120, height: 3, borderRadius: 2, background: SHARE_GRADIENT }} />
                <span style={{ fontSize: 21, fontWeight: 700, color: P.accent }}>towerforge.net</span>
                <span style={{ fontSize: 14, color: P.dim }}>Companion for The Tower</span>
            </div>
        </div>
    );
});
