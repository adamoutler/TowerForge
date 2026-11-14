// ============================================================
//  TowerForge Companion — Share pictures about the player's account
//  Drawn in the shared frame (BrandPoster) and saved through the Export
//  Images window (useSharePicture), so players post them with
//  towerforge.net on (owner, 2026-11-14):
//    MomentPicture   one moment (Profile, the trophy shelf), square
//    WeekPicture     This week on Profile: runs, best run, coins…
//    ShelfPicture    the trophy shelf
//    YearPicture     a year of the game's recap (Career → Year in Review)
//    ComparePicture  Me vs a friend (a share link's Compare)
//  Never the player's name.
// ============================================================

import type { Moment } from '../../engine/moments';
import type { WeekSummary } from '../../engine/thisWeek';
import type { Trophy } from '../../engine/trophies';
import type { YearHighlights } from '../../engine/career';
import type { Comparison } from '../../engine/compare';
import { formatGameNumber } from '../../engine/gameNumbers';
import { GAME_LEAGUES } from '../../constants/gameExportMaps';
import { ordinal } from '../../engine/moments';
import { BrandPoster, PosterCounter, PosterNote, PosterTiles, PosterTitle, PosterTower } from './BrandPoster';
import { SHARE_COLORS } from './shareTheme';

const P = SHARE_COLORS;
const DAY = 86_400_000;
const dateText = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const big = (v: number) => (v >= 1e5 ? formatGameNumber(v) : Math.round(v).toLocaleString('en-US'));
const hours = (sec: number) => {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h >= 100 ? `${h.toLocaleString('en-US')}h` : `${h}h ${m}m`;
};

export function MomentPicture({ moment }: { moment: Moment }) {
    return (
        <BrandPoster corner={dateText(moment.at)}>
            <PosterTower />
            <PosterTitle>{moment.title}</PosterTitle>
            <PosterCounter label={moment.label} value={moment.value} />
            {moment.detail && <PosterNote>{moment.detail}</PosterNote>}
        </BrandPoster>
    );
}

export function WeekPicture({ week, now }: { week: WeekSummary; now: number }) {
    const from = new Date(now - 6 * DAY).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const to = new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const t = week.tourney;
    // The six most worth showing, in this order.
    const tiles = [
        { label: 'Runs', value: String(week.runs) },
        { label: 'Coins earned', value: formatGameNumber(week.coins) },
        ...(t ? [{ label: `Tournament, ${t.league}`, value: t.rank > 0 ? `${ordinal(t.rank)}, W${t.wave.toLocaleString('en-US')}` : `W${t.wave.toLocaleString('en-US')}`, gold: t.rank > 0 && t.rank <= 3 }] : []),
        ...(week.playSec > 0 ? [{ label: 'Time in battle', value: hours(week.playSec) }] : []),
        ...(week.labsDone > 0 ? [{ label: 'Lab levels done', value: String(week.labsDone) }] : []),
        ...(week.enemies > 0 ? [{ label: 'Enemies destroyed', value: big(week.enemies) }] : []),
        { label: 'Waves played', value: big(week.waves) },
    ].slice(0, 6);
    return (
        <BrandPoster tall corner={`${from} – ${to}`}>
            <PosterTower width={190} />
            <PosterTitle>My week in The Tower</PosterTitle>
            {week.best && <PosterCounter label={`best run, Tier ${week.best.tier}`} value={week.best.wave.toLocaleString('en-US')} />}
            <PosterTiles tiles={tiles} />
        </BrandPoster>
    );
}

export function ShelfPicture({ shelf, now }: { shelf: Trophy[]; now: number }) {
    return (
        <BrandPoster tall corner={dateText(now)}>
            {/* A short shelf leaves room for the tower. */}
            {shelf.length <= 6 && <PosterTower width={190} />}
            <PosterTitle>🏆 My trophy shelf</PosterTitle>
            <div style={{ alignSelf: 'stretch', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
                {shelf.slice(0, 10).map(t => (
                    <div key={t.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, textAlign: 'left', minWidth: 0,
                        background: `linear-gradient(180deg, ${P.panel}, ${P.panelLow})`, border: `1px solid ${P.border}`,
                    }}>
                        <span style={{ fontSize: 28 }}>{t.icon}</span>
                        <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 24, fontWeight: 800, lineHeight: 1.15 }}>{t.value}</span>
                            <span style={{ display: 'block', fontSize: 14, color: P.dim, lineHeight: 1.3 }}>{t.title}</span>
                        </span>
                    </div>
                ))}
            </div>
        </BrandPoster>
    );
}

export function YearPicture({ y, current }: { y: YearHighlights; current: boolean }) {
    const league = y.tournaments > 0 ? GAME_LEAGUES[y.bestLeague] : undefined;
    const tiles = [
        { label: 'Battles', value: big(y.battles) },
        { label: 'Time in battle', value: `${Math.round(y.battleMs / DAY).toLocaleString('en-US')} days` },
        { label: 'Enemies destroyed', value: big(y.enemies) },
        { label: 'Tournaments', value: big(y.tournaments) },
        ...(league ? [{ label: 'Best league', value: league, gold: true }] : []),
        { label: 'Promotions', value: big(y.promotions) },
        { label: 'Cards pulled', value: big(y.cardsPulled) },
        { label: 'Modules earned', value: big(y.modulesEarned) },
        { label: 'Missions', value: big(y.missions) },
    ].slice(0, 9);
    return (
        <BrandPoster tall corner={current ? `${y.year} so far` : String(y.year)}>
            <PosterTitle>My {y.year} in The Tower</PosterTitle>
            <PosterCounter label="waves cleared" value={y.waves < 1e7 ? Math.round(y.waves).toLocaleString('en-US') : big(y.waves)} />
            <PosterTiles tiles={tiles} />
            {(y.favoriteUw || y.endedMostBy) && (
                <div style={{ fontSize: 16, color: P.dim, marginTop: 14, lineHeight: 1.5 }}>
                    {y.favoriteUw && <div>Favorite Ultimate Weapon: <strong style={{ color: P.text }}>{y.favoriteUw.name}</strong> ({big(y.favoriteUw.uses)} times)</div>}
                    {y.endedMostBy && <div>Ended most often by: <strong style={{ color: P.text }}>{y.endedMostBy}</strong></div>}
                </div>
            )}
        </BrandPoster>
    );
}

export function ComparePicture({ c, now }: { c: Comparison; now: number }) {
    const rows = c.rows.slice(0, 11);
    const cell = { padding: '6px 8px', fontSize: 17, fontVariantNumeric: 'tabular-nums' as const, textAlign: 'right' as const };
    return (
        <BrandPoster tall corner={dateText(now)}>
            <PosterTitle>Me vs a friend</PosterTitle>
            <PosterNote>Ahead on {c.meAhead} of {c.rows.length}{c.themAhead ? `, behind on ${c.themAhead}` : ''}</PosterNote>
            <table style={{ alignSelf: 'stretch', marginTop: 14, borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ color: P.dim, fontSize: 14 }}>
                        <th style={{ ...cell, fontSize: 14, textAlign: 'left', fontWeight: 600 }}></th>
                        <th style={{ ...cell, fontSize: 14, fontWeight: 600 }}>Friend</th>
                        <th style={{ ...cell, fontSize: 14, fontWeight: 600, color: P.accent }}>Me</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.label} style={{ borderTop: `1px solid ${P.border}` }}>
                            <td style={{ ...cell, textAlign: 'left', color: P.dim, fontSize: 15 }}>{r.label}</td>
                            <td style={{ ...cell, color: r.them > r.me ? P.gold : P.text, fontWeight: r.them > r.me ? 800 : 500 }}>{r.themText}</td>
                            <td style={{ ...cell, color: r.me > r.them ? P.gold : P.text, fontWeight: r.me > r.them ? 800 : 500 }}>{r.meText}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </BrandPoster>
    );
}
