// ============================================================
//  TowerForge Companion — Coins per Run Tab
//  Run simulator, step 1: tunes the wave-by-wave coin model to one of
//  the player's saved runs, shows how well it predicts their other
//  runs, and projects coins for a run to any wave or tier
//  (engine/runCoins.ts, docs/run-simulation.md).
// ============================================================

import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { defaultBattleIndex, isRealRun } from '../../engine/gameExport';
import { isDissonantRun } from '../../engine/battleReport';
import { hasDissonance, trackBoost } from '../../engine/dissonance';
import { coinSources } from '../../engine/coinSources';
import { FARM_EFFECT_LABELS } from '../../engine/farming';
import type { FarmEffect } from '../../engine/farming';
import { buildRunModel, projectRun, runSettingsFromCards } from '../../engine/runCoins';
import type { RunModelSettings } from '../../engine/runCoins';
import { formatGameNumber } from '../../engine/gameNumbers';
import { runDrops } from '../../engine/battleReport';
import type { BattleReport } from '../../engine/battleReport';
import NumericInput from '../common/NumericInput';
import PageIntro from '../common/PageIntro';

const fmt = (n: number) => (n >= 1000 ? formatGameNumber(n) : Math.round(n).toLocaleString());
const signedPct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

export default function RunCoinsTab() {
    const battles = useGameStore(s => s.importedBattles);
    const cardData = useGameStore(s => s.cardData);
    const preset = useGameStore(s => s.activePreset);
    const dissonanceWaves = useGameStore(s => s.dissonanceWaves);
    const labData = useGameStore(s => s.labData);

    // Card defaults from the current preset; the run may have used another, so both are editable.
    const defaults = runSettingsFromCards(cardData, preset);

    const candidates = battles.map((b, i) => ({ b, i })).filter(({ b }) => isRealRun(b) && !b.tournament && !isDissonantRun(b));
    const [tuning, setTuning] = useState(() => defaultBattleIndex(battles));
    const [introSprint, setIntroSprint] = useState(defaults.introSprintWaves);
    const [waMastery, setWaMastery] = useState<number | null>(defaults.waMastery);
    const tuningRun = battles[tuning];
    const [target, setTarget] = useState({ tier: tuningRun?.tier ?? 1, wave: tuningRun?.wave ?? 1000 });

    const settings: RunModelSettings = useMemo(() => ({ introSprintWaves: introSprint, waMastery }), [introSprint, waMastery]);
    const model = useMemo(() => buildRunModel(battles, tuning, settings), [battles, tuning, settings]);
    // Another tier pays its own Dissonant Boost on coins.
    const coinBoost = model && hasDissonance(dissonanceWaves)
        ? trackBoost(dissonanceWaves, 'utility', target.tier, labData).total / trackBoost(dissonanceWaves, 'utility', model.calibration.tier, labData).total
        : 1;
    const projection = model ? projectRun(model.calibration, settings, target.wave, target.tier, coinBoost) : null;

    if (candidates.length === 0) {
        return (
            <div className="relics-note">
                <strong>Coins per Run</strong> needs your battle history. Use <em>Import Game Data</em> — each
                import adds your latest runs, and every run you add makes the predictions better to check.
            </div>
        );
    }

    const growth = model?.calibration.growth;
    const fit = model?.fit;

    return (
        <div>
            <PageIntro title="Run simulator, step 1 — coins">
                The model plays a run wave by wave (enemies per
                wave from the Wave Accelerator chart, coins per kill, Coins / Wave, Golden Combo, Wave Skip),
                tuned to one of your runs. Then it predicts your <em>other</em> runs: the closer those are, the
                more you can trust the projection below. Upgrades and how far a run gets come next.
            </PageIntro>

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head"><h3>Tune on</h3></div>
                <div className="section-body en-inputs">
                    <label className="en-field" style={{ flexBasis: '100%' }}>
                        <span>Run</span>
                        <select value={tuning} onChange={e => {
                            const i = parseInt(e.target.value);
                            setTuning(i);
                            if (battles[i]) setTarget({ tier: battles[i].tier, wave: battles[i].wave });
                        }}>
                            {candidates.slice().reverse().map(({ b, i }) => (
                                <option key={i} value={i}>{b.date} · T{b.tier} W{b.wave.toLocaleString()} · {fmt(b.coinsEarned)} coins</option>
                            ))}
                        </select>
                    </label>
                    <label className="en-field">
                        <span>Intro Sprint waves</span>
                        <NumericInput value={introSprint} min={0} step={10} onChange={v => setIntroSprint(Math.max(0, Math.floor(v)))} />
                    </label>
                    <label className="en-field">
                        <span>Wave Accelerator mastery</span>
                        <select value={waMastery ?? -1} onChange={e => { const v = parseInt(e.target.value); setWaMastery(v < 0 ? null : v); }}>
                            <option value={-1}>None</option>
                            {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>Level {i}</option>)}
                        </select>
                    </label>
                    <p className="en-note">
                        Both start from the cards in your current preset; set them to what the runs used.
                        Intro Sprint waves pay no coins.
                    </p>
                </div>
            </div>

            {!model ? (
                <div className="relics-note">That run can&apos;t be used — it ended inside Intro Sprint or has no coins.</div>
            ) : (
                <>
                    <div className="section" style={{ marginBottom: '12px' }}>
                        <div className="section-head">
                            <h3>Your other runs</h3>
                            {model.checks.length > 0 && (
                                <span className="s-badge">
                                    avg {(100 * (growth === 'wave' ? fit!.wave! : fit!.flat!)).toFixed(1)}% off
                                </span>
                            )}
                        </div>
                        <div className="section-body en-table-wrap">
                            {model.checks.length === 0 ? (
                                <p className="en-note">
                                    No other campaign run to check against yet. Import again after a few runs.
                                </p>
                            ) : (
                                <>
                                    <table className="en-table rc-table">
                                        <thead><tr><th>Run</th><th>Kills</th><th>Coins</th></tr></thead>
                                        <tbody>
                                            {model.checks.slice().reverse().map(c => (
                                                <tr key={c.index}>
                                                    <td>
                                                        T{c.run.tier} W{c.run.wave.toLocaleString()}
                                                        <span className="en-sub">{c.run.date}</span>
                                                    </td>
                                                    <td>
                                                        {fmt(c.run.totalEnemies)}
                                                        <span className="en-sub">model {fmt(c.predictedKills)} ({signedPct(c.killError)})</span>
                                                    </td>
                                                    <td>
                                                        {fmt(c.run.coinsEarned)}
                                                        <span className="en-sub">model {fmt(c.predictedCoins)} ({signedPct(c.coinError)})</span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <p className="en-note">
                                        Coins per kill: {growth === 'wave'
                                            ? 'growing with the wave fits your runs better'
                                            : 'a fixed value per enemy fits your runs better'}
                                        {' '}({(100 * fit!.flat!).toFixed(1)}% off with fixed values, {(100 * fit!.wave!).toFixed(1)}% growing with the wave).
                                    </p>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="section">
                        <div className="section-head"><h3>A run to wave …</h3></div>
                        <div className="section-body en-inputs">
                            <label className="en-field">
                                <span>Tier</span>
                                <select value={target.tier} onChange={e => setTarget({ ...target, tier: parseInt(e.target.value) })}>
                                    {Array.from({ length: 24 }, (_, i) => i + 1).map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </label>
                            <label className="en-field">
                                <span>Wave</span>
                                <NumericInput value={target.wave} min={1} step={100} onChange={v => setTarget({ ...target, wave: Math.max(1, Math.floor(v)) })} />
                            </label>
                            {projection && (
                                <div className="rc-result">
                                    <div><span>Coins</span><strong>{fmt(projection.coins)}</strong></div>
                                    <div><span>Coins / hour</span><strong>{fmt(projection.coinsPerHour)}</strong></div>
                                    <div><span>Kills</span><strong>{fmt(projection.kills)}</strong></div>
                                    <div><span>Time</span><strong>{projection.hours.toFixed(1)} h</strong></div>
                                </div>
                            )}
                            <p className="en-note">
                                At the tuning run&apos;s pace ({model.calibration.secondsPerWave.toFixed(1)} s a wave, real time) and
                                with the coin bonuses that run had. Another tier scales coins by its coin multiplier; it
                                doesn&apos;t yet change how far you&apos;d get.
                            </p>
                        </div>
                    </div>
                </>
            )}

            {tuningRun && <CoinLines run={tuningRun} />}
            <RunDrops runs={candidates.map(c => c.b)} />
        </div>
    );
}

// The Battle Report's coin lines for the tuning run (engine/coinSources.ts).
const EFFECT_ORDER: FarmEffect[] = ['gt', 'bh', 'gb', 'sl', 'dw', 'orb'];
const EFFECT_KILLS: Record<FarmEffect, keyof BattleReport['killedWithEffect']> = {
    gt: 'goldenTower', bh: 'blackHole', gb: 'goldenBot', sl: 'spotlight', dw: 'deathWave', orb: 'orbs',
};

function CoinLines({ run }: { run: BattleReport }) {
    const s = coinSources(run);
    if (!s) return null;
    const share = (v: number) => `${(v / s.total * 100).toFixed(1)}%`;
    const parts: [string, number][] = [
        ['Golden Combo', s.combo], ['Wave Skip', s.skip], ['Kill coins', s.kill], ['Guardian Fetch', s.fetched],
    ];
    const effects = EFFECT_ORDER.filter(e => s.coins[e] > 0);
    return (
        <div className="section" style={{ marginTop: '12px' }}>
            <div className="section-head"><h3>Where this run&apos;s coins came from</h3></div>
            <div className="section-body en-table-wrap">
                <table className="en-table">
                    <thead><tr><th>T{run.tier} W{run.wave.toLocaleString()}</th><th>Coins</th><th>Share</th></tr></thead>
                    <tbody>
                        {parts.filter(([, v]) => v / s.total >= 0.0005).map(([name, v]) => (
                            <tr key={name}><td>{name}</td><td>{fmt(v)}</td><td>{share(v)}</td></tr>
                        ))}
                    </tbody>
                </table>
                {effects.length > 0 && (
                    <table className="en-table" style={{ marginTop: '10px' }}>
                        <thead><tr><th>On kill coins</th><th>Kills covered</th><th>Average</th></tr></thead>
                        <tbody>
                            {effects.map(e => {
                                const kills = run.killedWithEffect[EFFECT_KILLS[e]];
                                const f = s.factor[e];
                                return (
                                    <tr key={e}>
                                        <td>{FARM_EFFECT_LABELS[e]}</td>
                                        <td>{kills === null ? '—' : `${Math.round(kills * 100)}%`}</td>
                                        <td>{f === null ? '—' : `×${f.toFixed(f >= 10 ? 1 : 2)}`}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
                <p className="en-note">
                    From the game&apos;s Battle Report. Each bonus multiplies the kill coins, so the average is what that
                    bonus did across the whole run, whichever kills it covered. Golden Bot&apos;s includes Bot Bot.
                </p>
            </div>
        </div>
    );
}

const DROP_RUNS = 10;
const pretty = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/This Round$/, '').trim();

// Cells, gems, medals, reroll and module shards: what your runs hand out
// besides coins, averaged per run and per hour over your newest runs.
function RunDrops({ runs }: { runs: BattleReport[] }) {
    const recent = runs.slice().sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, DROP_RUNS);
    const totals = new Map<string, { sum: number; hours: number; runs: number }>();
    for (const run of recent) {
        for (const [key, v] of runDrops(run)) {
            const t = totals.get(key) ?? { sum: 0, hours: 0, runs: 0 };
            totals.set(key, { sum: t.sum + v, hours: t.hours + run.realTimeSec / 3600, runs: t.runs + 1 });
        }
    }
    const rows = [...totals.entries()].filter(([, t]) => t.sum > 0);
    if (rows.length === 0) return null;
    return (
        <div className="section" style={{ marginTop: '12px' }}>
            <div className="section-head"><h3>Everything else your runs give</h3></div>
            <div className="section-body en-table-wrap">
                <table className="en-table">
                    <thead><tr><th>From your runs</th><th>Per run</th><th>Per hour</th></tr></thead>
                    <tbody>
                        {rows.map(([key, t]) => (
                            <tr key={key}>
                                <td>{pretty(key)}</td>
                                <td>{formatGameNumber(t.sum / t.runs)}</td>
                                <td>{t.hours > 0 ? formatGameNumber(t.sum / t.hours) : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="en-note">
                    Averaged over your newest {recent.length} runs (tournaments left out), straight from each
                    battle report — including what the Guardian fetched. Per hour is real time.
                </p>
            </div>
        </div>
    );
}
