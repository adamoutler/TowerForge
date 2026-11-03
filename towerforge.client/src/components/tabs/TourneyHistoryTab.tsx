// ============================================================
//  TowerForge Companion — Tournaments → History
//  Every tournament played, from the game's TournamentRecords (29.1.3+
//  exports; kept across imports — engine/tourneyHistory.ts): waves and
//  rank over time, each league in its own color, the moves between
//  leagues, the numbers per league, and every tournament in a table.
//  Waves are only comparable within a league (each league's enemies are a
//  different strength), so the charts color by league and the tiles read
//  one league at a time.
// ============================================================

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { useGameStore } from '../../store/useGameStore';
import type { League, TourneyRecord } from '../../types/gameTypes';
import { leagueMoves, leagueStats, leagueStretches, leaguesPlayed, placed } from '../../engine/tourneyHistory';
import PageIntro from '../common/PageIntro';

// Fixed per league (the entity, never its place in a filtered list);
// validated as a set on the dark panel (dataviz validator, 2026-10-21).
const LEAGUE_COLOR: Record<Exclude<League, ''>, string> = {
    Copper: 'var(--tnh-copper)', Silver: 'var(--tnh-silver)', Gold: 'var(--tnh-gold)', Platinum: 'var(--tnh-platinum)',
    Champion: 'var(--tnh-champion)', Legend: 'var(--tnh-legend)', Mythic: 'var(--tnh-mythic)',
};
const colorOf = (l: League) => (l ? LEAGUE_COLOR[l] : 'var(--text-dim)');

// Tournament days are 00:00 UTC — shown as that day everywhere.
const dayText = (ms: number, year = true) =>
    new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
const fmt1 = (v: number | null) => (v === null ? '—' : v.toFixed(1));

type Range = 'all' | '12' | '6' | '3';
const RANGES: [Range, string][] = [['all', 'All time'], ['12', 'Last 12 months'], ['6', 'Last 6 months'], ['3', 'Last 3 months']];

// ── Width of a box (charts draw to it) ────────────────────────
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
    const ref = useRef<T>(null);
    const [w, setW] = useState(0);
    // Measured right away (a page drawn in the background gets no
    // ResizeObserver calls until it's shown), then on any change.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const measure = () => setW(Math.floor(el.getBoundingClientRect().width));
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        window.addEventListener('resize', measure);
        return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
    }, []);
    return [ref, w];
}

// Round tick steps (1, 2, 5 × 10^n).
function niceTicks(lo: number, hi: number, count: number): number[] {
    const span = Math.max(1, hi - lo);
    const raw = span / Math.max(1, count);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
    const out: number[] = [];
    // Up to the first tick at or above the highest value, so it has a label.
    for (let v = Math.ceil(lo / step) * step; v < hi + step - 1e-9; v += step) out.push(v);
    return out;
}

// Month ticks every 1, 2, 3, 6 or 12 months — as many as fit.
function monthTicks(from: number, to: number, maxTicks: number): number[] {
    const months = (new Date(to).getUTCFullYear() - new Date(from).getUTCFullYear()) * 12
        + new Date(to).getUTCMonth() - new Date(from).getUTCMonth() + 1;
    const every = [1, 2, 3, 6, 12, 24].find(n => months / n <= maxTicks) ?? 24;
    const out: number[] = [];
    const d = new Date(Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth() + 1, 1));
    while (d.getTime() <= to) {
        if (d.getUTCMonth() % every === 0 || every === 1) out.push(d.getTime());
        d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
}
const monthText = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', year: '2-digit', timeZone: 'UTC' });

// ── A chart over time, one line per stretch in a league ───────
interface ChartProps {
    recs: TourneyRecord[];
    value: (r: TourneyRecord) => number | null;
    invert?: boolean;       // rank: 1 at the top
    yMin?: number;
    describe: string;       // for screen readers
}

const H = 220, PAD_T = 12, PAD_B = 26, PAD_L = 44, PAD_R = 14;

function TimeChart({ recs, value, invert, yMin = 0, describe }: ChartProps) {
    const [boxRef, width] = useWidth<HTMLDivElement>();
    const [hover, setHover] = useState<number | null>(null);   // index into pts
    const pts = useMemo(() => recs.map(r => ({ r, v: value(r) })).filter((p): p is { r: TourneyRecord; v: number } => p.v !== null), [recs, value]);
    if (!pts.length) return <div className="tnh-chart" ref={boxRef}><div className="tnh-empty">Nothing to show for this selection.</div></div>;

    const w = Math.max(240, width || 600);
    const x0 = pts[0].r.date, x1 = pts[pts.length - 1].r.date;
    const span = Math.max(86400_000, x1 - x0);
    const x = (t: number) => PAD_L + ((t - x0) / span) * (w - PAD_L - PAD_R);
    const vMax = Math.max(...pts.map(p => p.v));
    const ticks = niceTicks(yMin, vMax, 4);
    if (invert && ticks[0] !== yMin) ticks.unshift(yMin);   // rank 1 labelled at the top
    const top = Math.max(vMax, ticks[ticks.length - 1] ?? vMax);
    const y = (v: number) => {
        const f = (v - yMin) / Math.max(1, top - yMin);
        return invert ? PAD_T + f * (H - PAD_T - PAD_B) : H - PAD_B - f * (H - PAD_T - PAD_B);
    };
    // Lines: each stretch in one league, broken where a value is missing.
    const lines = leagueStretches(recs).flatMap(s => {
        const runs: { league: League; pts: [number, number][] }[] = [];
        let cur: [number, number][] = [];
        for (const r of s.recs) {
            const v = value(r);
            if (v === null) { if (cur.length) runs.push({ league: s.league, pts: cur }); cur = []; continue; }
            cur.push([x(r.date), y(v)]);
        }
        if (cur.length) runs.push({ league: s.league, pts: cur });
        return runs;
    });
    const dots = pts.length <= 40;
    const months = monthTicks(x0, x1, Math.max(2, Math.floor((w - PAD_L) / 70)));
    const last = pts[pts.length - 1];
    const h = hover !== null ? pts[hover] : null;

    const nearest = (px: number) => {
        let best = 0;
        for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i].r.date) - px) < Math.abs(x(pts[best].r.date) - px)) best = i;
        return best;
    };
    const onMove = (e: PointerEvent<SVGSVGElement>) => {
        const box = e.currentTarget.getBoundingClientRect();
        setHover(nearest(((e.clientX - box.left) / box.width) * w));
    };
    const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const from = hover ?? (e.key === 'ArrowLeft' ? pts.length : -1);
            setHover(Math.max(0, Math.min(pts.length - 1, from + (e.key === 'ArrowLeft' ? -1 : 1))));
        } else if (e.key === 'Escape') setHover(null);
    };

    return (
        <div className="tnh-chart" ref={boxRef}>
            <svg
                width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={describe} tabIndex={0}
                onPointerMove={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}
            >
                {ticks.map(t => (
                    <g key={t}>
                        <line className="tnh-grid" x1={PAD_L} x2={w - PAD_R} y1={y(t)} y2={y(t)} />
                        <text className="tnh-axis" x={PAD_L - 6} y={y(t)} dy="0.32em" textAnchor="end">{t.toLocaleString()}</text>
                    </g>
                ))}
                {months.map(m => (
                    <text key={m} className="tnh-axis" x={x(m)} y={H - 8} textAnchor="middle">{monthText(m)}</text>
                ))}
                {lines.map((l, i) => l.pts.length > 1
                    ? <polyline key={i} points={l.pts.map(p => p.join(',')).join(' ')} fill="none" stroke={colorOf(l.league)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    : <circle key={i} cx={l.pts[0][0]} cy={l.pts[0][1]} r={4} fill={colorOf(l.league)} className="tnh-dot" />)}
                {dots && pts.map((p, i) => (
                    <circle key={i} cx={x(p.r.date)} cy={y(p.v)} r={3} fill={colorOf(p.r.league)} className="tnh-dot" />
                ))}
                {/* The latest tournament, labelled (the one value worth reading at a glance). */}
                <circle cx={x(last.r.date)} cy={y(last.v)} r={4} fill={colorOf(last.r.league)} className="tnh-dot" />
                {h && (
                    <g pointerEvents="none">
                        <line className="tnh-cross" x1={x(h.r.date)} x2={x(h.r.date)} y1={PAD_T} y2={H - PAD_B} />
                        <circle cx={x(h.r.date)} cy={y(h.v)} r={5} fill={colorOf(h.r.league)} className="tnh-dot" />
                    </g>
                )}
            </svg>
            {h && (
                // Beside the crosshair (never over the point): right of it,
                // or left when it's in the right half.
                <div className="tnh-tip" style={{ left: x(h.r.date) > w / 2 ? x(h.r.date) - 162 : x(h.r.date) + 12 }}>
                    <strong>{invert ? `Rank ${h.v}` : `W${h.v.toLocaleString()}`}</strong>
                    <span><i style={{ background: colorOf(h.r.league) }} />{h.r.league}</span>
                    <span>#{h.r.number} · {dayText(h.r.date)}</span>
                    <span>{invert ? `W${h.r.wave.toLocaleString()}` : placed(h.r) ? `Rank ${h.r.rank}` : 'Not placed yet'}</span>
                </div>
            )}
        </div>
    );
}

function Legend({ leagues }: { leagues: League[] }) {
    if (leagues.length < 2) return null;
    return (
        <div className="tnh-legend">
            {leagues.map(l => <span key={l}><i style={{ background: colorOf(l) }} />{l}</span>)}
        </div>
    );
}

export default function TourneyHistoryTab() {
    const records = useGameStore(s => s.tourneyRecords);
    const profile = useGameStore(s => s.profile);
    const played = useMemo(() => leaguesPlayed(records), [records]);
    const [league, setLeague] = useState<League | 'all'>('all');
    const [range, setRange] = useState<Range>('all');
    const [showAll, setShowAll] = useState(false);
    const [showMoves, setShowMoves] = useState(false);
    const [now] = useState(() => Date.now());

    const shown = useMemo(() => {
        const since = range === 'all' ? 0 : now - Number(range) * 30.44 * 86400_000;
        return records.filter(r => r.date >= since && (league === 'all' || r.league === league));
    }, [records, league, range, now]);

    if (!records.length) {
        return (
            <div className="relics-note">
                <strong>Tournament history</strong> shows every tournament you&apos;ve played — waves and rank over
                time, league by league. It needs a data export from the game&apos;s 29.1.3 update or later: use
                <em> Import Game Data</em> (or <em>Get from emulator</em>).
            </div>
        );
    }

    // The tiles read one league: the one picked, else the one you're in now.
    const current = (profile.currentLeague || records[records.length - 1].league) as League;
    const focus = league === 'all' ? current : league;
    const stats = leagueStats(records);
    const inRange = shown.filter(r => r.league === focus);
    const ranked = inRange.filter(placed);
    const moves = leagueMoves(records).slice().reverse();
    const shownLeagues = leaguesPlayed(shown);
    const table = [...shown].reverse();

    return (
        <div className="tnh">
            <PageIntro title="Tournament history">
                Every tournament you&apos;ve played, from your game data (each
                import adds the newest). Waves only compare within a league: each league&apos;s enemies are a
                different strength, so each league has its own color. Rank 1 is the top of your bracket. A
                tournament still running when the game exported isn&apos;t placed yet, so it&apos;s only in the table.
            </PageIntro>

            <div className="tnh-filters">
                <label>League
                    <select value={league} onChange={e => setLeague(e.target.value as League | 'all')}>
                        <option value="all">All leagues</option>
                        {played.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                </label>
                <label>Time
                    <select value={range} onChange={e => setRange(e.target.value as Range)}>
                        {RANGES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                </label>
            </div>

            <div className="tnh-tiles">
                <div className="tnh-tile"><span>Tournaments</span><strong>{shown.length.toLocaleString()}</strong></div>
                <div className="tnh-tile"><span>{league === 'all' ? 'League now' : 'League'}</span><strong><i style={{ background: colorOf(focus) }} />{focus || '—'}</strong></div>
                <div className="tnh-tile"><span>Best wave{inRange.length ? ` in ${focus}` : ''}</span><strong>{inRange.length ? `W${Math.max(...inRange.map(r => r.wave)).toLocaleString()}` : '—'}</strong></div>
                <div className="tnh-tile"><span>Best rank</span><strong>{ranked.length ? Math.min(...ranked.map(r => r.rank)) : '—'}</strong></div>
                <div className="tnh-tile"><span>Average rank, last 10</span><strong>{ranked.length ? fmt1(ranked.slice(-10).reduce((a, r) => a + r.rank, 0) / Math.min(10, ranked.length)) : '—'}</strong></div>
            </div>

            <div className="section">
                <div className="section-head"><h3>Waves</h3></div>
                <div className="section-body">
                    <Legend leagues={shownLeagues} />
                    <TimeChart recs={shown} value={r => (placed(r) ? r.wave : null)} describe="Wave reached in each tournament over time, colored by league" />
                </div>
            </div>

            <div className="section">
                <div className="section-head"><h3>Rank</h3></div>
                <div className="section-body">
                    <Legend leagues={shownLeagues} />
                    <TimeChart recs={shown} value={r => (placed(r) ? r.rank : null)} invert yMin={1} describe="Rank in each tournament over time, 1 at the top, colored by league" />
                </div>
            </div>

            {moves.length > 0 && (
                <div className="section">
                    <div className="section-head"><h3>League moves</h3></div>
                    <div className="section-body tnh-moves">
                        {moves.slice(0, showMoves ? undefined : 8).map(m => (
                            <div key={m.number}>
                                <span className={m.up ? 'tnh-up' : 'tnh-down'}>{m.up ? '▲ Up' : '▼ Down'}</span>
                                <i style={{ background: colorOf(m.to) }} />{m.to}
                                <span className="tnh-dim"> from {m.from} · #{m.number}, {dayText(m.date)}</span>
                            </div>
                        ))}
                        {moves.length > 8 && (
                            <button className="btn btn-dim tnh-more" onClick={() => setShowMoves(v => !v)}>
                                {showMoves ? 'Show fewer' : `Show all ${moves.length}`}
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div className="section">
                <div className="section-head"><h3>By league</h3></div>
                <div className="section-body tnh-leagues">
                    {stats.slice().reverse().map(s => (
                        <div key={s.league} className="tnh-league">
                            <div className="tnh-league-head">
                                <strong><i style={{ background: colorOf(s.league) }} />{s.league}</strong>
                                <span>{s.count} tournament{s.count === 1 ? '' : 's'} · {dayText(s.first)} – {dayText(s.last)}</span>
                            </div>
                            <dl>
                                <dt>Best wave</dt><dd>W{s.bestWave.toLocaleString()}</dd>
                                <dt>Average wave, last 10</dt><dd>{s.recentWave === null ? '—' : `W${Math.round(s.recentWave).toLocaleString()}`}</dd>
                                <dt>Best rank</dt><dd>{s.bestRank ?? '—'}</dd>
                                <dt>Average rank</dt><dd>{fmt1(s.avgRank)}</dd>
                                <dt>Average rank, last 10</dt><dd>{fmt1(s.recentRank)}</dd>
                            </dl>
                        </div>
                    ))}
                </div>
            </div>

            <div className="section">
                <div className="section-head"><h3>Every tournament</h3></div>
                <div className="section-body tnh-scroll">
                    <table className="tnh-table">
                        <thead><tr><th>#</th><th>Day</th><th>League</th><th>Wave</th><th>Rank</th></tr></thead>
                        <tbody>
                            {table.slice(0, showAll ? undefined : 15).map(r => (
                                <tr key={r.number}>
                                    <td>{r.number}</td>
                                    <td>{dayText(r.date)}</td>
                                    <td><i style={{ background: colorOf(r.league) }} />{r.league}</td>
                                    <td>W{r.wave.toLocaleString()}</td>
                                    <td>{placed(r) ? r.rank : <span className="tnh-dim">not placed yet</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {table.length > 15 && (
                        <button className="btn btn-dim tnh-more" onClick={() => setShowAll(v => !v)}>
                            {showAll ? 'Show fewer' : `Show all ${table.length}`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
