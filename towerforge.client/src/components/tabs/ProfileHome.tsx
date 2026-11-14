// ============================================================
//  TowerForge Companion — Profile home (the top of the home page)
//  Where the account stands, at a glance, once there's data (the
//  Welcome guide covers a first visit): the tower in its range ring
//  with enemies marching in, the player's tier and farthest wave in
//  the game's purple wave-counter style, meters for what's maxed
//  (each opens its tab), and what's ticking between imports — the next
//  lab to finish, the last tournament, how old the data is.
//  Counts: engine/accountProgress.ts. Styles: home- in tabs.css.
//  Added 2026-11-03 (owner: make the site livelier and more engaging).
// ============================================================

import { useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { TAB_PATHS } from '../../routes';
import { TowerShape } from '../common/TowerArt';
import { accountMeters, farthestPoint, labsTicking } from '../../engine/accountProgress';
import type { Meter } from '../../engine/accountProgress';
import type { TabName } from '../../types/gameTypes';
import { askImport } from '../../importNav';
import { thisWeek, tourneyDayText } from '../../engine/thisWeek';
import { formatGameNumber } from '../../engine/gameNumbers';
import InstallHint from '../common/InstallHint';
import { remindersSupported, turnOffReminders, turnOnReminders, useRemindersOn } from '../common/reminders';
import type { ReminderKind } from '../common/reminders';
import { useExampleOn } from '../../store/exampleAccount';
import Moments from '../common/Moments';
import { WhatsNewCard } from '../common/WhatsNew';

// Enemies walking in to the range ring and dying on it, in the game's
// shapes (squares and triangles): angle on the ring (degrees, 0 = right),
// shape, color, seconds to walk in, start delay.
const ENEMIES: [number, 'square' | 'triangle', string, number, number][] = [
    [205, 'square', 'var(--danger)', 7, 0],
    [330, 'triangle', 'var(--gold)', 5.5, 1.4],
    [62, 'square', 'var(--danger)', 8, 3],
    [125, 'triangle', 'var(--gold)', 6, 4.2],
    [265, 'square', 'var(--danger)', 7.5, 2.2],
    [18, 'square', 'var(--plus)', 9, 5.4],
];
const C = 130;          // the scene's center
const RANGE = 96;       // the range ring's radius
const WALK = 30;        // how far outside the ring an enemy starts (inside the frame)

function TowerScene() {
    return (
        <svg viewBox="0 0 260 260" className="home-scene" aria-hidden="true">
            <defs>
                <radialGradient id="home-glow">
                    <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.3 }} />
                    <stop offset="65%" style={{ stopColor: 'var(--accent-2)', stopOpacity: 0.08 }} />
                    <stop offset="100%" style={{ stopColor: 'var(--accent-2)', stopOpacity: 0 }} />
                </radialGradient>
            </defs>
            <circle cx={C} cy={C} r={RANGE} fill="url(#home-glow)" />
            <circle className="home-ring" cx={C} cy={C} r={RANGE} />
            <circle className="home-ring home-ring-inner" cx={C} cy={C} r={64} />
            {ENEMIES.map(([deg, shape, color, dur, delay], i) => {
                const a = (deg * Math.PI) / 180;
                const style = {
                    color,
                    '--dx': `${(WALK * Math.cos(a)).toFixed(1)}px`,
                    '--dy': `${(WALK * Math.sin(a)).toFixed(1)}px`,
                    animationDuration: `${dur}s`,
                    animationDelay: `${delay}s`,
                } as CSSProperties;
                return (
                    <g key={i} transform={`translate(${(C + RANGE * Math.cos(a)).toFixed(1)} ${(C + RANGE * Math.sin(a)).toFixed(1)})`}>
                        <g className="home-enemy" style={style}>
                            {shape === 'square'
                                ? <rect x="-6" y="-6" width="12" height="12" />
                                : <path d="M0 -7 L6.5 5.5 L-6.5 5.5 Z" />}
                        </g>
                    </g>
                );
            })}
            <g className="home-orbs">
                <circle cx={C} cy={C - 64} r="5" />
                <circle cx={C} cy={C + 64} r="5" />
            </g>
            <g transform={`translate(${C - 36} ${C - 57}) scale(0.6)`}>
                <TowerShape />
            </g>
        </svg>
    );
}

// The game's wave counter: a small word over a big number.
function Counter({ label, value }: { label: string; value: string }) {
    return (
        <div className="home-counter">
            <span className="home-counter-label">{label}</span>
            <span className="home-counter-val">{value}</span>
        </div>
    );
}

function MeterDial({ m, open }: { m: Meter; open: (tab: TabName) => (e: MouseEvent) => void }) {
    const pct = m.total ? Math.min(100, (m.done / m.total) * 100) : 0;
    const max = m.total > 0 && m.done >= m.total;
    return (
        <a className={`home-meter${max ? ' is-max' : ''}${m.done === 0 ? ' is-empty' : ''}`} href={TAB_PATHS[m.tab]} onClick={open(m.tab)}>
            <span className="home-dial">
                <svg viewBox="0 0 64 64" aria-hidden="true">
                    <circle className="home-dial-track" cx="32" cy="32" r="27" />
                    <circle className="home-dial-arc" cx="32" cy="32" r="27" pathLength={100}
                        style={{ '--p': pct.toFixed(1) } as CSSProperties} />
                </svg>
                <span className="home-dial-num"><span>{m.done}<small>/{m.total}</small></span></span>
            </span>
            <span className="home-meter-label">{m.label}</span>
            {m.note && <span className="home-meter-note">{m.note}</span>}
        </a>
    );
}

const span = (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60000));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${min}m` : `${min}m`;
};

const DAY = 86_400_000;

export default function ProfileHome() {
    const profile = useGameStore(s => s.profile);
    const tierWaves = useGameStore(s => s.tierWaves);
    const labData = useGameStore(s => s.labData);
    const wsData = useGameStore(s => s.wsData);
    const activePreset = useGameStore(s => s.activePreset);
    const cardData = useGameStore(s => s.cardData);
    const uwData = useGameStore(s => s.uwData);
    const botData = useGameStore(s => s.botData);
    const labsRunning = useGameStore(s => s.labsRunning);
    const tourneyRecords = useGameStore(s => s.tourneyRecords);
    const incomeLog = useGameStore(s => s.incomeLog);
    const liveRun = useGameStore(s => s.liveRun);
    const importedBattles = useGameStore(s => s.importedBattles);
    const hasRuns = importedBattles.length > 0;
    const setActiveTab = useGameStore(s => s.setActiveTab);
    // Set on opening the page, like Run in Progress.
    const [now] = useState(() => Date.now());

    const meters = useMemo(() => accountMeters({
        labData, wsData, presetIdx: activePreset, cardData, uwData, botData,
        progress: { tierWaves, completedTier: profile.completedTier },
    }).filter(m => m.total > 0), [labData, wsData, activePreset, cardData, uwData, botData, tierWaves, profile.completedTier]);
    const far = farthestPoint(tierWaves);
    const labs = labsTicking(labsRunning, now);
    const example = useExampleOn();
    const week = useMemo(() => thisWeek(importedBattles, tourneyRecords, now), [importedBattles, tourneyRecords, now]);
    const importedAt = Math.max(incomeLog.at(-1)?.t ?? 0, liveRun?.at ?? 0, ...labsRunning.map(l => l.exportedAt ?? 0));
    const lastTourney = [...tourneyRecords].sort((a, b) => b.date - a.date)[0];

    if (!hasRuns && !profile.highestTier) return null;

    // Tab links open in place; a middle or modified click opens a new tab.
    const open = (tab: TabName) => (e: MouseEvent) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        setActiveTab(tab);
    };

    const facts = [profile.league && `${profile.league} league`, profile.build && `${profile.build} build`].filter(Boolean).join(', ');
    const rows: { icon: string; text: ReactNode; tab?: TabName; link?: string; again?: boolean; remind?: boolean }[] = [];
    // "Import again" rows are about the player's own data, not the made-up example.
    if (labs.finished.length && !example) {
        const names = labs.finished.map(l => l.lab ?? `Lab #${l.labIndex}`).join(', ');
        rows.push({
            icon: '🔬', again: true,
            text: <>{labs.finished.length === 1 ? 'A lab has' : `${labs.finished.length} labs have`} finished since your import ({names}). Collect {labs.finished.length === 1 ? 'it' : 'them'} in the game and import again.</>,
        });
    }
    if (labs.next) {
        const { lab, at } = labs.next;
        const stillRunning = labs.running - labs.finished.length;
        rows.push({
            icon: '⏳', tab: 'labs', link: 'Labs', remind: !example,
            text: <><strong>{lab.lab ?? `Lab #${lab.labIndex}`}{lab.toLevel ? ` Lv ${lab.toLevel}` : ''}</strong> finishes in {span(at - now)}{stillRunning > 1 ? `, the first of ${stillRunning} labs researching` : ''}.</>,
        });
    }
    if (lastTourney && lastTourney.wave > 0) {
        const date = new Date(lastTourney.date).toLocaleDateString([], { month: 'short', day: 'numeric' });
        rows.push({
            icon: '🏆', tab: 'tourneyhistory', link: 'History',
            text: <>Last tournament, {date}: <strong>wave {lastTourney.wave.toLocaleString()}</strong> in {lastTourney.league}{lastTourney.rank > 0 ? `, rank ${lastTourney.rank}` : ', not placed yet'}.</>,
        });
    }
    if (importedAt > 0 && now - importedAt > DAY && !example) {
        const days = Math.floor((now - importedAt) / DAY);
        rows.push({
            icon: '📥', again: true,
            text: <>Your game data is {days === 1 ? 'a day' : `${days} days`} old. Import again for today&apos;s numbers.</>,
        });
    }

    return (
        <>
            {!example && <WhatsNewCard onOpen={setActiveTab} />}

            <section className="home-hero">
                <TowerScene />
                <div className="home-id">
                    <h2 className="home-name">{profile.name || 'Your tower'}</h2>
                    <div className="home-counters">
                        {profile.highestTier > 0 && <Counter label="tier" value={String(profile.highestTier)} />}
                        {far && <Counter label={`best wave on T${far.tier}`} value={far.wave.toLocaleString()} />}
                    </div>
                    {facts && <p className="home-facts">{facts}</p>}
                    <a className="btn btn-primary home-cta" href={TAB_PATHS.optimizer} onClick={open('optimizer')}>
                        Rank my next upgrades
                    </a>
                </div>
            </section>

            {!example && <Moments />}

            {meters.length > 0 && (
                <nav className="home-meters" aria-label="How far your account has got">
                    {meters.map(m => <MeterDial key={m.id} m={m} open={open} />)}
                </nav>
            )}

            {(week.runs > 0 || week.nextTourney !== null) && (
                <section className="home-week" aria-labelledby="home-week-title">
                    <h3 id="home-week-title" className="home-week-title">This week</h3>
                    <div className="home-week-tiles">
                        <div className="stat-pill" title="Runs in the last 7 days, from your imports">
                            <span className="stat-pill-label">Runs</span>
                            <span className="stat-pill-val">{week.runs}</span>
                        </div>
                        {week.best && (
                            <div className="stat-pill">
                                <span className="stat-pill-label">Best run</span>
                                <span className="stat-pill-val">W{week.best.wave.toLocaleString()} · T{week.best.tier}</span>
                            </div>
                        )}
                        {week.runs > 0 && (
                            <div className="stat-pill">
                                <span className="stat-pill-label">Coins earned</span>
                                <span className="stat-pill-val">{formatGameNumber(week.coins)}</span>
                            </div>
                        )}
                        {week.nextTourney !== null && (
                            <a className="stat-pill home-week-link" href={TAB_PATHS.tournament} onClick={open('tournament')}
                                title="Wednesday and Saturday, from 00:00 UTC (or the days your past tournaments fell on)">
                                <span className="stat-pill-label">Next tournament</span>
                                <span className="stat-pill-val">{tourneyDayText(week.nextTourney, now)}</span>
                            </a>
                        )}
                    </div>
                    {week.nextTourney !== null && !example && (
                        <div className="home-week-remind"><RemindButton kind="tourney" /></div>
                    )}
                </section>
            )}

            {rows.length > 0 && (
                <ul className="home-now">
                    {rows.map((r, i) => (
                        <li key={i}>
                            <span className="home-now-icon" aria-hidden="true">{r.icon}</span>
                            <span className="home-now-text">{r.text}</span>
                            {r.tab && <a className="home-now-link" href={TAB_PATHS[r.tab]} onClick={open(r.tab)}>{r.link}</a>}
                            {r.again && <button type="button" className="home-now-link home-now-btn" onClick={askImport}>⬆ Import again</button>}
                            {r.remind && <RemindButton kind="labs" />}
                        </li>
                    ))}
                </ul>
            )}

            {!example && <InstallHint />}
        </>
    );
}

// "Remind me": a notification when each lab finishes, or on tournament days (reminders.ts).
const REMIND_WORDS: Record<ReminderKind, { off: string; on: string; title: string }> = {
    labs: { off: '🔔 Remind me', on: '🔔 Reminders on', title: 'a notification when each lab finishes' },
    tourney: { off: '🔔 Remind me on tournament days', on: '🔔 Tournament reminders on', title: 'a notification when each tournament starts' },
};

function RemindButton({ kind }: { kind: ReminderKind }) {
    const on = useRemindersOn(kind);
    const words = REMIND_WORDS[kind];
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    if (!remindersSupported()) return null;
    const click = async () => {
        setBusy(true);
        setNote(null);
        if (on) await turnOffReminders(kind);
        else {
            const r = await turnOnReminders(kind);
            if (r === 'denied') setNote('Notifications are blocked for TowerForge in this browser’s settings.');
            else if (r === 'failed') setNote('Reminders couldn’t be turned on here.');
        }
        setBusy(false);
    };
    return (
        <>
            <button type="button" className={`home-now-link home-now-btn ${on ? 'on' : ''}`} onClick={() => void click()} disabled={busy}
                title={on ? `You’ll get ${words.title}. Click to stop.` : `Get ${words.title}`}>
                {on ? words.on : words.off}
            </button>
            {note && <span className="home-now-note" role="status">{note}</span>}
        </>
    );
}
