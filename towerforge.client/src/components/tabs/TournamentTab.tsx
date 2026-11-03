// ============================================================
//  TowerForge Companion — Tournament Tab
//  How your tournament runs end and what each had (you tick a run's
//  battle conditions once; the game's export doesn't record them); a run
//  simulated under this week's conditions, each as strong as the game
//  makes it at the wave the run ends (heat, engine/battleConditions.ts),
//  with what every condition does to it; and which of your modules to run
//  for the most tournament waves (engine/loadoutOptimizer.ts) — all with
//  the build you use for tournaments, measured against your own
//  tournament deaths on the tournament curve (engine/tournamentModel.ts).
// ============================================================

import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import type { BuildType, League, LoadoutSlots, ModuleType, TourneyLogEntry } from '../../types/gameTypes';
import type { AccountState } from '../../engine/accountModels';
import { effectiveBuild } from '../../engine/accountModels';
import { bestLoadout, loadoutScore } from '../../engine/loadoutOptimizer';
import type { LoadoutResult } from '../../engine/loadoutOptimizer';
import { killedBy, killerMix, wavesSpread } from '../../engine/runLength';
import { runKey, runSavers } from '../../engine/battleReport';
import type { BattleReport } from '../../engine/battleReport';
import { bcLabCut, heatAfterLabs, heatValue, leagueConditions } from '../../engine/battleConditions';
import { buildTournamentModel, heatOf, newestTournament, settleGain } from '../../engine/tournamentModel';
import { deathDefyChance, saverAverages, savedHits } from '../../engine/runSavers';
import { activeLoadout } from '../../engine/statHelpers';
import { presetLabel } from '../../constants/gameData';
import { RARITIES } from '../../constants/moduleRarities';
import {
    HEAT_CONDITIONS, LEAGUE_HEAT, LEGEND_OVERHEAT, RANDOM_CONDITIONS, SAVER_CONDITIONS,
} from '../../constants/tournamentData';
import type { HeatCondition, HeatKey } from '../../constants/tournamentData';
import { keysOf, loadTourneySim, saveTourneySim, ticksOf } from '../common/tourneySim';
import type { Ticks, TourneySim } from '../common/tourneySim';
import PageIntro from '../common/PageIntro';

const TYPES: ModuleType[] = ['cannon', 'armor', 'generator', 'core'];
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const wavesText = (w: number) => {
    const a = Math.abs(w);
    return `${w < 0 ? '−' : '+'}${a < 10 ? a.toFixed(1) : Math.round(a)} waves`;
};
// Big gains read better as a multiplier (a farming loadout moved to damage).
const gainText = (pct: number) => (pct >= 100
    ? `×${(1 + pct / 100).toLocaleString(undefined, { maximumFractionDigits: pct >= 1000 ? 0 : 2 })}`
    : `+${pct.toFixed(pct >= 10 ? 1 : 2)}%`);
const round1 = (v: number) => Math.round(v * 10) / 10;
const conditionByKey = (k: string) => HEAT_CONDITIONS.find(c => c.key === k);
const EFFECT_TAG: Record<HeatCondition['effect'], string | null> = { waves: null, savers: 'run savers', none: 'no effect on Glass Cannon' };

export default function TournamentTab() {
    const state = useGameStore();
    const setModuleState = useGameStore(s => s.setModuleState);
    const setTourneyLogEntry = useGameStore(s => s.setTourneyLogEntry);
    const build = effectiveBuild(state.profile.build as BuildType, state.importedBattles);
    const isGC = build === 'Glass Cannon';

    const [sim, setSimState] = useState<TourneySim>(loadTourneySim);
    const [result, setResult] = useState<{ res: LoadoutResult; own: Record<string, number>; waves: number | null; weekWaves: number | null } | null>(null);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const setSim = (patch: Partial<TourneySim>) => {
        const next = { ...sim, ...patch };
        setSimState(next);
        saveTourneySim(next);
        setResult(null);
    };
    const league = sim.league || state.profile.currentLeague || state.profile.league || '';
    const heat = heatOf(league);

    // The newest tournament run calibrates; its ticked conditions are the
    // ones your deaths came with.
    const calibIdx = useMemo(() => newestTournament(state), [state]);
    const calibRun = calibIdx >= 0 ? state.importedBattles[calibIdx] : null;
    const lastKey = calibRun ? runKey(calibRun) : '';
    const lastEntry = lastKey ? state.tourneyLog[lastKey] : undefined;
    const last: Ticks = useMemo(() => (lastEntry ? ticksOf(lastEntry.conditions) : sim.recent),
        [lastEntry, sim.recent]);
    const lastLeague = (lastEntry?.league || league) as League;

    const account: AccountState = useMemo(() => ({
        activePreset: state.activePreset, profile: state.profile, perkData: state.perkData, wsData: state.wsData,
        enhData: state.enhData, labData: state.labData, cardData: state.cardData, uwData: state.uwData,
        relicData: state.relicData, botData: state.botData, moduleState: state.moduleState,
        battleReportText: '', importedBattles: state.importedBattles, battleReportChoice: calibIdx,
        guardianData: state.guardianData,
    }), [calibIdx, state.activePreset, state.profile, state.perkData, state.wsData, state.enhData, state.labData,
        state.cardData, state.uwData, state.relicData, state.botData, state.moduleState, state.importedBattles,
        state.guardianData]);

    const model = useMemo(() => buildTournamentModel(account, {
        league, week: sim.week, last, lastLeague, preset: sim.preset, loadout: sim.loadout,
    }, build), [account, league, sim.week, last, lastLeague, sim.preset, sim.loadout, build]);
    const run = model?.run ?? null;

    // This week against the last tournament, and each condition on its own.
    const view = useMemo(() => {
        if (!model?.settle || !run) return null;
        const zero = model.settle(last, heatOf(lastLeague));
        const week = model.settle(sim.week) - zero;
        const weekWave = run.typicalWave + week;
        const keys = [...RANDOM_CONDITIONS, ...SAVER_CONDITIONS]
            .filter(c => c.effect === 'waves' && (sim.week[c.key] || last[c.key]) && !(sim.week[c.key] && last[c.key]));
        const lastHere = model.settle(last);   // in this week's league
        const each = keys.map(c => ({ key: c.key, waves: model.settle!({ ...last, [c.key]: !!sim.week[c.key] }) - lastHere }));
        return { week, weekWave, each };
    }, [model, run, last, lastLeague, sim.week]);

    // Run savers this week against the last tournament's.
    const savers = useMemo(() => {
        if (!model || !run || !view) return null;
        const avg = saverAverages(run.used.map(d => d.run));
        const p = deathDefyChance(model.snap);
        const week = model.at(sim.week, view.weekWave);
        return {
            last: savedHits(p, avg, model.baseline, model.baseline),
            week: savedHits(p, avg, week, model.baseline),
            dd: [p - (model.baseline.deathDefyDownPct ?? 0) / 100, p - (week.deathDefyDownPct ?? 0) / 100],
        };
    }, [model, run, view, sim.week]);

    if (!model) {
        return (
            <div className="relics-note">
                <strong>Tournament</strong> needs tournament runs in your battle history — play one, then use
                <em> Import Game Data</em>. Each import adds your latest runs.
            </div>
        );
    }

    const tourneyRuns = state.importedBattles.filter(b => b.tournament)
        .sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 10);
    const spread = run ? wavesSpread(run, 0, 0, 0).ended : [];
    const anyWeek = keysOf(sim.week).length > 0;
    const endW = run?.typicalWave ?? 0;
    const labs = state.labData;
    const fixed = heat && run ? leagueConditions(heat, endW, labs) : null;
    const conditionList = [...RANDOM_CONDITIONS, ...(heat?.saverDown ? SAVER_CONDITIONS : [])];
    const presets = Array.from({ length: state.profile.presets || 2 }, (_, i) => i);
    const buildPreset = model.account.activePreset;
    const buildLoadout = activeLoadout(model.account.moduleState);

    // A condition's strength at a wave, after your labs.
    const strength = (c: HeatCondition, wave: number, h = heat) => {
        if (!h?.ramp) return null;
        return { raw: heatValue(c, h.ramp, wave), after: round1(heatAfterLabs(c, h.ramp, wave, labs)), cut: bcLabCut(labs, c.lab) };
    };

    // A run's log entry, written as you tick (the run keeps its league).
    function setRunConditions(b: BattleReport, key: HeatKey, on: boolean) {
        const k = runKey(b);
        const entry = state.tourneyLog[k];
        const now = new Set(entry?.conditions ?? (k === lastKey ? keysOf(last) : []));
        if (on) now.add(key); else now.delete(key);
        // The saver condition is one of the two each week.
        if (on && key === 'deathDefyDown') now.delete('energyShieldsDown');
        if (on && key === 'energyShieldsDown') now.delete('deathDefyDown');
        setTourneyLogEntry(k, { league: (entry?.league || league) as League, conditions: [...now] });
        setResult(null);
    }
    function setRunLeague(b: BattleReport, l: League) {
        const k = runKey(b);
        const entry: TourneyLogEntry = state.tourneyLog[k] ?? { league: l, conditions: k === lastKey ? keysOf(last) : [] };
        setTourneyLogEntry(k, { ...entry, league: l });
    }

    function findBest() {
        if (!model) return;
        setBusy(true);
        setSaved(false);
        setTimeout(() => {
            try {
                const wave = view?.weekWave ?? endW;
                const snap = { ...model.snap, conditions: model.wavesOf ? model.at(sim.week, wave) : model.snap.conditions };
                const res = bestLoadout(snap);
                const start = activeLoadout(snap.moduleState)?.slots;
                const wavesOf = model.wavesOf;
                const at = (slots: LoadoutSlots) => loadoutScore(snap, slots);
                const now = start ? at(start) : null;
                const own: Record<string, number> = {};
                let waves: number | null = null;
                let weekWaves: number | null = null;
                if (start && now && wavesOf) {
                    for (const c of res.changes) {
                        const one: LoadoutSlots = { ...start, [c.type]: { ...start[c.type], [c.position]: c.to } };
                        own[`${c.type}-${c.position}`] = wavesOf(at(one)) - wavesOf(now);
                    }
                    // A loadout that goes much further meets stronger conditions there.
                    weekWaves = settleGain(w => wavesOf(loadoutScore({ ...snap, conditions: model.at(sim.week, endW + w) }, res.slots)));
                    waves = weekWaves - wavesOf(now);
                }
                setResult({ res, own, waves, weekWaves });
            } finally {
                setBusy(false);
            }
        }, 30);
    }

    function saveLoadout() {
        if (!result) return;
        const loadouts = state.moduleState.loadouts.filter(l => l.id !== 'tourney-best');
        setModuleState({ loadouts: [...loadouts, { id: 'tourney-best', name: 'Best for tournaments', slots: result.res.slots }] });
        setSaved(true);
    }

    const moduleName = (id: string) => {
        const m = state.moduleState.library.find(x => x.id === id);
        if (!m) return 'Empty slot';
        return `${m.name} (${RARITIES.find(r => r.k === m.rarity)?.label ?? m.rarity})`;
    };
    const endWave = (change: number) => `W${Math.round(endW + change).toLocaleString()}`;

    // How your tournaments went with each condition: average end with it and without.
    const logged = tourneyRuns.map(b => ({ b, entry: state.tourneyLog[runKey(b)] })).filter(x => x.entry);
    const byCondition = HEAT_CONDITIONS.map(c => {
        const withIt = logged.filter(x => x.entry!.conditions.includes(c.key)).map(x => x.b.wave);
        const without = logged.filter(x => !x.entry!.conditions.includes(c.key)).map(x => x.b.wave);
        const avg = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
        return { c, with: avg(withIt), withN: withIt.length, without: avg(without), withoutN: without.length };
    }).filter(r => r.withN > 0);

    return (
        <div>
            <PageIntro title="Tournaments">
                Tournament enemies get tougher much faster than on a campaign tier, so
                everything here is measured against your own tournament deaths, on the tournament enemy curve, with the
                build you use for tournaments. What If (Tournament) tries any other change against the same runs.
            </PageIntro>

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head"><h3>Your tournament build</h3></div>
                <div className="section-body tn-build">
                    <label className="tn-field">
                        Preset (workshop, cards, bots, Guardian{state.moduleState.loadoutFor ? ', modules' : ''})
                        <select value={buildPreset} onChange={e => setSim({ preset: Number(e.target.value), ...(state.moduleState.loadoutFor ? { loadout: undefined } : {}) })}>
                            {presets.map(i => <option key={i} value={i}>{presetLabel(state.profile.presetNames, i)}</option>)}
                        </select>
                    </label>
                    <label className="tn-field">
                        Modules
                        <select value={buildLoadout?.id ?? ''} onChange={e => setSim({ loadout: e.target.value })}>
                            {state.moduleState.loadouts.map(l => <option key={l.id} value={l.id}>{l.name || 'Preset'}</option>)}
                        </select>
                    </label>
                    <p className="en-note">
                        The build your tournament runs were played with — the model is calibrated on it. Only used here
                        and in What If; your equipped preset and modules don&apos;t change.
                    </p>
                </div>
            </div>

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head"><h3>Your tournaments</h3></div>
                <div className="section-body">
                    {run ? (
                        <div className="rc-result">
                            <div><span>Runs end around</span><strong>W{run.typicalWave.toLocaleString()}</strong></div>
                            <div><span>Last {spread.length} deaths</span><strong>W{Math.min(...spread)}–W{Math.max(...spread)}</strong></div>
                            <div><span>Health levels skipped</span><strong>{(run.skipRate * 100).toFixed(1)}%</strong></div>
                        </div>
                    ) : (
                        <p className="en-note">
                            Your tournament runs don&apos;t have the level-skip counts waves need — import again to add them.
                        </p>
                    )}
                    <p className="en-note">
                        Tick each run&apos;s battle conditions once (the game shows them before you start; its data
                        file doesn&apos;t keep them) — they&apos;re saved with your stats. The newest run&apos;s are
                        the ones the model starts from.
                    </p>
                    <div className="tn-log">
                        {tourneyRuns.map(b => {
                            const k = runKey(b);
                            const entry = state.tourneyLog[k] ?? (k === lastKey && keysOf(last).length ? { league, conditions: keysOf(last) } : undefined);
                            const killer = killedBy(b);
                            const s = runSavers(b);
                            const saves = ([['Death Defy', s.deathDefy], ['Energy Shield', s.energyShield], ['Second Wind', s.secondWind]] as [string, number | null][])
                                .filter(([, v]) => (v ?? 0) > 0).map(([n, v]) => `${n} ${v}`).join(' · ');
                            const open = editing === k;
                            const runHeat = heatOf(entry?.league || league);
                            return (
                                <div key={k} className={`tn-log-row ${k === lastKey ? 'last' : ''}`}>
                                    <div className="tn-log-head">
                                        <span className="tn-log-wave">W{b.wave.toLocaleString()}</span>
                                        <span className="en-sub">
                                            {b.date}{entry?.league ? ` · ${entry.league}` : ''}
                                            {' · '}{killer === undefined ? 'ended by —' : killer ? `ended by ${killer}` : 'you quit'}
                                            {saves && ` · saved by ${saves}`}
                                        </span>
                                        <button className="btn btn-dim tn-log-edit" onClick={() => setEditing(open ? null : k)}>
                                            {open ? 'Done' : entry ? 'Edit' : 'Tick conditions'}
                                        </button>
                                    </div>
                                    <div className="tn-chips">
                                        {entry && entry.conditions.length > 0 ? entry.conditions.map(key => {
                                            const c = conditionByKey(key);
                                            if (!c) return null;
                                            const v = strength(c, b.wave, runHeat);
                                            return <span key={key} className="tn-chip">{c.name}{v ? ` ${c.fmt(v.after)}` : ''}</span>;
                                        }) : <span className="en-sub">{entry ? 'No random conditions' : 'Conditions not ticked yet'}</span>}
                                    </div>
                                    {open && (
                                        <div className="tn-log-edit-box">
                                            <label className="tn-field">
                                                League
                                                <select value={entry?.league || league}
                                                    onChange={e => setRunLeague(b, e.target.value as League)}>
                                                    {LEAGUE_HEAT.map(l => <option key={l.league} value={l.league}>{l.league}</option>)}
                                                </select>
                                            </label>
                                            <div className="tn-log-checks">
                                                {[...RANDOM_CONDITIONS, ...SAVER_CONDITIONS].map(c => (
                                                    <label key={c.key} className="tn-check">
                                                        <input type="checkbox" checked={!!entry?.conditions.includes(c.key)}
                                                            onChange={e => setRunConditions(b, c.key, e.target.checked)} />
                                                        {c.name}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {byCondition.length > 0 && (
                        <div className="wi-chain">
                            <div className="wi-chain-head">How your ticked tournaments went</div>
                            {byCondition.map(r => (
                                <div key={r.c.key} className="wi-chain-row">
                                    <span className="wi-v">{r.c.name}</span>
                                    <span className="wi-share">
                                        with it W{r.with?.toLocaleString()} ({r.withN} run{r.withN === 1 ? '' : 's'})
                                        {r.without !== null && ` · without W${r.without.toLocaleString()} (${r.withoutN})`}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {isGC && run && view && model.wavesOf && (
                <div className="section" style={{ marginBottom: '12px' }}>
                    <div className="section-head"><h3>This week&apos;s battle conditions</h3></div>
                    <div className="section-body">
                        <div className="tn-league">
                            <label htmlFor="tn-league">League</label>
                            <select id="tn-league" value={league} onChange={e => setSim({ league: e.target.value as League })}>
                                <option value="">—</option>
                                {LEAGUE_HEAT.map(l => <option key={l.league} value={l.league}>{l.league}</option>)}
                            </select>
                            {heat && (
                                <span className="en-sub">
                                    Tier {heat.tierPlus}+ enemies · {heat.randomConditions} random condition{heat.randomConditions === 1 ? '' : 's'} a week
                                    {heat.saverDown && ', plus Death Defy Down or Energy Shields Down'}
                                </span>
                            )}
                        </div>

                        {!heat ? (
                            <p className="en-note">Pick your league — each has its own fixed conditions and heat.</p>
                        ) : (
                            <>
                                <div className="wi-chain">
                                    <div className="wi-chain-head">Always on in {heat.league}</div>
                                    <div className="wi-chain-row"><span className="wi-v">More Bosses</span><span className="wi-share">a boss every {heat.bossEvery} waves</span></div>
                                    {fixed?.skipMultiply !== undefined && (
                                        <div className="wi-chain-row">
                                            <span className="wi-v">Skip Reduction - Multiply</span>
                                            <span className="wi-share">×{heat.skipMultiply}{fixed.skipMultiply !== heat.skipMultiply && ` (×${fixed.skipMultiply.toFixed(2)} after your labs)`}</span>
                                        </div>
                                    )}
                                    {heat.skipDecayEvery && fixed?.skipDecayFactor !== undefined && (
                                        <div className="wi-chain-row">
                                            <span className="wi-v">Skip Decay</span>
                                            <span className="wi-share">1% every {heat.skipDecayEvery} waves (×{fixed.skipDecayFactor.toFixed(2)} on average to W{endW})</span>
                                        </div>
                                    )}
                                    {heat.league === 'Legend' && LEGEND_OVERHEAT.map(o => (
                                        <div key={o.text} className="wi-chain-row">
                                            <span className="wi-v">{o.text}</span><span className="wi-share">from W{o.from.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                                <p className="en-note">
                                    Your deaths already have these, so they don&apos;t move this week&apos;s end — but they make
                                    each point of Enemy Health Level Skip worth less in a tournament, which the Optimizer, What If
                                    and the module search below count.
                                </p>

                                {heat.randomConditions > 0 && (
                                    <>
                                        <div className="wi-chain-head" style={{ marginTop: '12px' }}>Random conditions</div>
                                        <p className="en-note" style={{ marginTop: 0 }}>
                                            Tick this week&apos;s — the game shows them before you start. They get stronger as the
                                            run goes on (full strength at W1000); the strength shown is at the wave your runs end,
                                            after your battle-condition labs. &quot;Last tournament&quot; is your newest tournament
                                            run{calibRun && ` (W${calibRun.wave.toLocaleString()}, ${calibRun.date})`} — the
                                            conditions your deaths came with.
                                        </p>
                                        <div className="tn-bc">
                                            {conditionList.map(c => {
                                                const s = strength(c, endW);
                                                const tag = EFFECT_TAG[c.effect];
                                                const ticked = !!(sim.week[c.key] || last[c.key]);
                                                return (
                                                    <div key={c.key} className="tn-bc-row">
                                                        <div className="tn-bc-name">
                                                            <strong>{c.name}</strong>
                                                            <span className="en-sub">
                                                                {c.text} · at W{endW}: <span className="tn-heat">{s ? c.fmt(s.after) : '—'}</span>
                                                                {s && s.cut > 0 && ` (${c.fmt(s.raw)} before your labs)`}
                                                            </span>
                                                            {ticked && (c.how || c.why) && <span className="en-sub tn-why">{c.how ?? c.why}</span>}
                                                        </div>
                                                        <div className="tn-bc-inputs">
                                                            <label className="tn-check">
                                                                <input type="checkbox" checked={!!sim.week[c.key]}
                                                                    onChange={e => {
                                                                        const week = { ...sim.week, [c.key]: e.target.checked };
                                                                        if (e.target.checked && c.key === 'deathDefyDown') week.energyShieldsDown = false;
                                                                        if (e.target.checked && c.key === 'energyShieldsDown') week.deathDefyDown = false;
                                                                        setSim({ week });
                                                                    }} />
                                                                This week
                                                            </label>
                                                            {calibRun && (
                                                                <label className="tn-check">
                                                                    <input type="checkbox" checked={!!last[c.key]}
                                                                        onChange={e => setRunConditions(calibRun, c.key, e.target.checked)} />
                                                                    Last tournament
                                                                </label>
                                                            )}
                                                            {tag && <span className="tn-tag">{tag}</span>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div className="rc-result" style={{ marginTop: '12px' }}>
                                            <div><span>Your tournaments end</span><strong>W{endW.toLocaleString()}</strong></div>
                                            <div><span>This week</span><strong>{endWave(view.week)}</strong></div>
                                            <div><span>Change</span><strong>{wavesText(view.week)}</strong></div>
                                        </div>
                                        {(view.each.length > 0 || (savers && savers.week !== savers.last)) && (
                                            <div className="wi-chain">
                                                {view.each.map(e => {
                                                    const c = conditionByKey(e.key)!;
                                                    const s = strength(c, view.weekWave);
                                                    return (
                                                        <div key={e.key} className="wi-chain-row">
                                                            <span className="wi-v">
                                                                {c.name}{sim.week[e.key] ? (s ? ` (${c.fmt(s.after)} at W${Math.round(view.weekWave)})` : '') : ' (gone this week)'}
                                                            </span>
                                                            <span className="wi-share">
                                                                {e.key === 'bossUltimate' && !killerMix(run).Boss ? 'bosses haven’t ended your recent runs'
                                                                    : wavesText(e.waves)}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                                {savers && Math.abs(savers.week - savers.last) > 1e-9 && (
                                                    <div className="wi-chain-row">
                                                        <span className="wi-v">
                                                            Killing hits a run survives (Death Defy {(Math.max(0, savers.dd[0]) * 100).toFixed(1)}% → {(Math.max(0, savers.dd[1]) * 100).toFixed(1)}%)
                                                        </span>
                                                        <span className="wi-share">{savers.last.toFixed(2)} → {savers.week.toFixed(2)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <p className="en-note">
                                            Each condition moves the run by what it does at the wave the run ends, against your last
                                            tournament&apos;s — tick one to see how it&apos;s counted. Conditions in both don&apos;t
                                            move it (your deaths already have them). Run savers aren&apos;t in waves yet, so Death Defy
                                            Down and Energy Shields Down show the killing hits a run survives.
                                        </p>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head">
                    <h3>Best modules for {isGC ? (anyWeek ? 'this week' : 'tournament waves') : 'tournament survival'}</h3>
                </div>
                <div className="section-body">
                    <p className="en-note" style={{ marginTop: 0 }}>
                        Tries every module you own in each main and assist slot — main effect at the slot&apos;s level,
                        substats at its efficiency, the unique effects the model reads — and keeps the swaps that add
                        the most, round after round, so modules that work together are found together. Starts from your
                        tournament build&apos;s modules ({buildLoadout?.name || 'Preset'}).
                        {isGC && heat && ' Scored under your league’s conditions'}
                        {isGC && heat && (anyWeek ? ' and this week’s, so a module that answers one (Chrono Field duration against shorter UWs, say) counts for it.' : '.')}
                    </p>
                    <button className="btn btn-accent" onClick={findBest} disabled={busy}>
                        {busy ? '⏳ Trying your modules…' : '▶ Find the best loadout'}
                    </button>

                    {result && (
                        result.res.changes.length === 0 ? (
                            <p className="en-note">Your tournament modules are already the best of your modules for this.</p>
                        ) : (
                            <>
                                <div className="rc-result" style={{ marginTop: '12px' }}>
                                    <div><span>{isGC ? 'Flat damage + skip' : 'Survival'}</span><strong>{gainText(result.res.gainPct)}</strong></div>
                                    {result.waves !== null && (
                                        <div><span>Tournament waves</span><strong>{wavesText(result.waves)}</strong></div>
                                    )}
                                    {result.weekWaves !== null && (
                                        <div><span>{anyWeek ? 'This week with them' : 'Runs would end around'}</span><strong>{endWave(result.weekWaves)}</strong></div>
                                    )}
                                </div>
                                <div className="tn-swaps">
                                    {TYPES.filter(t => result.res.changes.some(c => c.type === t)).map(t => (
                                        <div key={t} className="tn-swap">
                                            <div className="tn-swap-head">{cap(t)}</div>
                                            {result.res.changes.filter(c => c.type === t).map(c => (
                                                <div key={c.position} className="tn-swap-row">
                                                    <span className="tn-pos">{cap(c.position)}</span>
                                                    <span className={c.from ? 'tn-from' : 'tn-pos'}>{moduleName(c.from)}</span>
                                                    <span className="tn-to">→ {moduleName(c.to)}</span>
                                                    {result.own[`${c.type}-${c.position}`] !== undefined && (
                                                        <span className="tn-waves">{wavesText(result.own[`${c.type}-${c.position}`])} on its own</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                                {TYPES.some(t => !result.res.changes.some(c => c.type === t)) && (
                                    <p className="en-note">
                                        Keep your {TYPES.filter(t => !result.res.changes.some(c => c.type === t)).map(cap).join(', ')}
                                        {' '}— none of your other modules there does more for this.
                                    </p>
                                )}
                                <button className="btn btn-dim" onClick={saveLoadout} style={{ marginTop: '10px' }}>
                                    {saved ? '✓ Saved — see Gear → Modules' : 'Save as a loadout'}
                                </button>
                                <p className="en-note">
                                    Swaps work on each other, so the waves on their own don&apos;t add up to the total.
                                    {!anyWeek && ' Without this week’s conditions, this is the best loadout for the conditions your last tournament had.'}
                                </p>
                            </>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
