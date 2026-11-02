// ============================================================
//  TowerForge Companion — What If Tab
//  Try changes on a copy of the account — any UW, UW+, workshop, lab,
//  enhancement, module slot or bot level — and see what they do to all
//  damage, waves reached, coins per hour, coins per run and survival,
//  and what they cost (engine/whatIf.ts). Nothing is saved.
//  Two modes: campaign runs (the Optimizer's Battle Report), or a
//  tournament — the build used for tournaments, against the tournament
//  deaths, under this week's battle conditions (engine/tournamentModel.ts;
//  settings shared with the Tournament page).
// ============================================================

import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import type { BuildType, League, OptCurrency } from '../../types/gameTypes';
import { chosenReport, effectiveBuild, runModels, snapshotFromState } from '../../engine/accountModels';
import type { AccountState } from '../../engine/accountModels';
import { changeCost, upgradeTargets, whatIf } from '../../engine/whatIf';
import type { ChainLink, Change, Costs } from '../../engine/whatIf';
import { formatGameNumber } from '../../engine/gameNumbers';
import { formatLabTime } from '../../engine/upgradeCosts';
import { MEDAL_SYMBOL, presetLabel } from '../../constants/gameData';
import { HEAT_CONDITIONS, LEAGUE_HEAT } from '../../constants/tournamentData';
import { buildTournamentModel, newestTournament, tournamentWhatIf } from '../../engine/tournamentModel';
import { runKey } from '../../engine/battleReport';
import { defaultBattleIndex } from '../../engine/gameExport';
import { activeLoadout } from '../../engine/statHelpers';
import { keysOf, loadTourneySim, saveTourneySim, ticksOf } from '../common/tourneySim';
import { takeWhatIfHandoff } from '../common/whatIfHandoff';
import type { TourneySim } from '../common/tourneySim';

type Mode = 'campaign' | 'tournament';
const MODE_KEY = 'tc_whatif_mode';
const loadMode = (): Mode => {
    try { return localStorage.getItem(MODE_KEY) === 'tournament' ? 'tournament' : 'campaign'; } catch { return 'campaign'; }
};

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;

const wavesText = (w: number) => {
    const n = Math.abs(w) < 10 ? Math.abs(w).toFixed(1) : Math.round(Math.abs(w)).toLocaleString();
    return `${w < 0 ? '−' : '+'}${n} waves`;
};

const CHAIN_GROUPS: ChainLink['group'][] = [
    'Enemies in range', 'Tower', 'Damage to each enemy', 'Survival', 'Level skip', 'Run savers', 'Coin bonuses',
];

// A link as "before → after (change)"; relative ones (×) as a % change.
function linkText(l: ChainLink): string {
    const change = l.before !== 0 ? pct((l.after / l.before - 1) * 100) : '';
    switch (l.kind) {
        case 'seconds': return `${l.before.toFixed(2)}s → ${l.after.toFixed(2)}s (${change})`;
        case 'meters': return `${l.before.toFixed(1)}m → ${l.after.toFixed(1)}m (${change})`;
        case 'percent': return `${l.before.toFixed(1)}% → ${l.after.toFixed(1)}%`;
        case 'perSecond': return `${l.before.toFixed(2)}/s → ${l.after.toFixed(2)}/s (${change})`;
        case 'count': return `${l.before.toFixed(2)} → ${l.after.toFixed(2)}`;
        case 'points': return `${l.before.toFixed(2)} → ${l.after.toFixed(2)} points`;
        case 'times': return l.before === 1 ? change : `×${l.before.toFixed(3)} → ×${l.after.toFixed(3)} (${change})`;
    }
}

const COST_LABEL: [OptCurrency, string, (v: number) => string][] = [
    ['coins', 'Coins', v => `${formatGameNumber(v < 1000 ? Math.round(v) : v)} 🪙`],
    ['stones', 'Stones', v => `${v.toLocaleString()} stones`],
    ['research', 'Lab time', v => `${formatLabTime(v)} 🔬`],
    ['medals', 'Medals', v => `${v.toLocaleString()} ${MEDAL_SYMBOL}`],
    ['shards', 'Module Shards', v => `${formatGameNumber(Math.round(v))} shards`],
    ['bits', 'Bits', v => `${v.toLocaleString()} bits`],
];

function CostLine({ costs }: { costs: Costs }) {
    const parts = COST_LABEL.filter(([k]) => (costs[k] ?? 0) > 0).map(([k, , fmt]) => fmt(costs[k]!));
    return <>{parts.length ? parts.join(' · ') : 'Free'}</>;
}

export default function WhatIfTab() {
    const activePreset = useGameStore(s => s.activePreset);
    const profile = useGameStore(s => s.profile);
    const perkData = useGameStore(s => s.perkData);
    const wsData = useGameStore(s => s.wsData);
    const enhData = useGameStore(s => s.enhData);
    const labData = useGameStore(s => s.labData);
    const cardData = useGameStore(s => s.cardData);
    const uwData = useGameStore(s => s.uwData);
    const relicData = useGameStore(s => s.relicData);
    const botData = useGameStore(s => s.botData);
    const labProgress = useGameStore(s => s.labProgress);
    const dissonanceWaves = useGameStore(s => s.dissonanceWaves);
    const moduleState = useGameStore(s => s.moduleState);
    const battleReportText = useGameStore(s => s.battleReportText);
    const importedBattles = useGameStore(s => s.importedBattles);
    const battleReportChoice = useGameStore(s => s.battleReportChoice);
    const guardianData = useGameStore(s => s.guardianData);
    const tourneyLog = useGameStore(s => s.tourneyLog);
    const setActiveTab = useGameStore(s => s.setActiveTab);

    const account: AccountState = useMemo(() => ({
        activePreset, profile, perkData, wsData, enhData, labData, cardData, uwData, relicData, botData,
        moduleState, battleReportText, importedBattles, battleReportChoice, guardianData, labProgress, dissonanceWaves,
    }), [activePreset, profile, perkData, wsData, enhData, labData, cardData, uwData, relicData, botData,
        moduleState, battleReportText, importedBattles, battleReportChoice, guardianData, labProgress, dissonanceWaves]);

    // Hybrid reads as the build its runs behave like (accountModels.effectiveBuild).
    const build = useMemo(() => effectiveBuild(profile.build as BuildType, importedBattles), [profile.build, importedBattles]);

    // Campaign runs, or a tournament with the tournament build and this
    // week's conditions (settings shared with the Tournament page).
    // Changes handed over by another page (Ask AI's "Open in What If"), once.
    const [handoff] = useState(takeWhatIfHandoff);
    const [mode, setModeState] = useState<Mode>(() => (handoff ? (handoff.tournament ? 'tournament' : 'campaign') : loadMode()));
    const [sim, setSimState] = useState<TourneySim>(loadTourneySim);
    const setMode = (m: Mode) => {
        setModeState(m);
        setSimState(loadTourneySim());   // pick up changes made on the Tournament page
        try { localStorage.setItem(MODE_KEY, m); } catch { /* not remembered */ }
    };
    const setSim = (patch: Partial<TourneySim>) => {
        const next = { ...sim, ...patch };
        setSimState(next);
        saveTourneySim(next);
    };
    const tIdx = useMemo(() => newestTournament(account), [account]);
    const tRun = tIdx >= 0 ? importedBattles[tIdx] : null;
    const tEntry = tRun ? tourneyLog[runKey(tRun)] : undefined;
    const tLeague = (sim.league || profile.currentLeague || profile.league || '') as League;
    const tLast = useMemo(() => (tEntry ? ticksOf(tEntry.conditions) : sim.recent), [tEntry, sim.recent]);
    const tModel = useMemo(() => (mode === 'tournament'
        ? buildTournamentModel(account, {
            league: tLeague, week: sim.week, last: tLast, lastLeague: (tEntry?.league || tLeague) as League,
            preset: sim.preset, loadout: sim.loadout,
        }, build)
        : null), [mode, account, tLeague, sim.week, tLast, tEntry, sim.preset, sim.loadout, build]);

    const setup = useMemo(() => {
        if (mode === 'tournament' && tModel) {
            return tournamentWhatIf(tModel, sim.week, tLast, (tEntry?.league || tLeague) as League);
        }
        // Campaign: the Optimizer's Battle Report, or your usual campaign run
        // when that's a tournament run (Tournament mode is for those).
        const campaign: AccountState = chosenReport(account)?.tournament
            ? { ...account, battleReportText: '', battleReportChoice: defaultBattleIndex(importedBattles) }
            : account;
        return { base: snapshotFromState(campaign), models: runModels(campaign), report: chosenReport(campaign) };
    }, [mode, tModel, account, sim.week, tLast, tEntry, tLeague, importedBattles]);
    const { base, models } = setup;
    const targets = useMemo(() => upgradeTargets(base), [base]);
    const groups = useMemo(() => [...new Set(targets.map(t => t.group))], [targets]);

    const [group, setGroup] = useState<string>('');
    const [pick, setPick] = useState<string>('');
    const [level, setLevel] = useState<string>('');
    const [changes, setChanges] = useState<Change[]>(() => handoff?.changes ?? []);

    const activeGroup = groups.includes(group) ? group : groups[0] ?? '';
    const inGroup = targets.filter(t => t.group === activeGroup);
    const target = inGroup.find(t => `${t.kind}:${t.key}` === pick) ?? inGroup[0];
    const wanted = Number(level);
    const validLevel = target && level !== '' && Number.isInteger(wanted) && wanted >= 0 && wanted <= target.max;

    const result = useMemo(
        () => (changes.length ? whatIf(base, changes, targets, build, setup.report, models) : null),
        [base, changes, targets, build, setup, models],
    );

    const own = (c: Change) => result?.perChange.find(x => x.kind === c.kind && x.key === c.key)?.waves;

    function add() {
        if (!target || !validLevel) return;
        setChanges(cs => [...cs.filter(c => !(c.kind === target.kind && c.key === target.key)),
            { kind: target.kind, key: target.key, level: wanted }]);
        setLevel('');
    }

    const gc = build === 'Glass Cannon';
    const tourney = mode === 'tournament';
    const weekNames = keysOf(sim.week).map(k => HEAT_CONDITIONS.find(c => c.key === k)?.name).filter(Boolean);

    return (
        <div>
            <div className="relics-note">
                <strong>What if I…?</strong> Pick any upgrade and a level, add as many as you like, and see what
                they do to your damage, how far your runs get, your coins and your survival — and what they
                cost. Campaign: calibrated on your chosen Battle Report (Optimizer page), waves and coins per run
                from Run Length and Coins per Run. Tournament: your tournament build against your tournament
                deaths, under this week&apos;s battle conditions. Nothing here changes your saved account.
            </div>

            <div className="preset-tabs wi-mode">
                <button className={`preset-btn ${!tourney ? 'active' : ''}`} onClick={() => setMode('campaign')}>Campaign runs</button>
                <button className={`preset-btn ${tourney ? 'active' : ''}`} onClick={() => setMode('tournament')}>Tournament</button>
            </div>

            {tourney && (tModel ? (
                <div className="section" style={{ marginBottom: '12px' }}>
                    <div className="section-head"><h3>Tournament</h3></div>
                    <div className="section-body tn-build">
                        <label className="tn-field">
                            League
                            <select value={tLeague} onChange={e => setSim({ league: e.target.value as League })}>
                                <option value="">—</option>
                                {LEAGUE_HEAT.map(l => <option key={l.league} value={l.league}>{l.league}</option>)}
                            </select>
                        </label>
                        <label className="tn-field">
                            Preset
                            <select value={tModel.account.activePreset} onChange={e => setSim({ preset: Number(e.target.value), ...(moduleState.loadoutFor ? { loadout: undefined } : {}) })}>
                                {Array.from({ length: profile.presets || 2 }, (_, i) => (
                                    <option key={i} value={i}>{presetLabel(profile.presetNames, i)}</option>
                                ))}
                            </select>
                        </label>
                        <label className="tn-field">
                            Modules
                            <select value={activeLoadout(tModel.account.moduleState)?.id ?? ''} onChange={e => setSim({ loadout: e.target.value })}>
                                {moduleState.loadouts.map(l => <option key={l.id} value={l.id}>{l.name || 'Preset'}</option>)}
                            </select>
                        </label>
                        <p className="en-note">
                            This week: {weekNames.length ? weekNames.join(', ') : 'no random conditions ticked'} — set them
                            on the <a href="/tournament" onClick={e => { e.preventDefault(); setActiveTab('tournament'); }}>Tournament
                            page</a>. Calibrated on your last tournament run{tRun && ` (W${tRun.wave.toLocaleString()}, ${tRun.date})`}
                            {tEntry ? ' under the conditions you ticked for it' : ' (tick its conditions on the Tournament page)'};
                            each change is read at the wave its run would end, where the conditions are stronger.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="relics-note">
                    Tournament mode needs a tournament run in your battle history — play one, then use
                    <em> Import Game Data</em>.
                </div>
            ))}

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head"><h3>Change</h3></div>
                <div className="section-body">
                    <div className="wi-picker">
                        <select value={activeGroup} onChange={e => { setGroup(e.target.value); setPick(''); }}>
                            {groups.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <select
                            value={target ? `${target.kind}:${target.key}` : ''}
                            onChange={e => { setPick(e.target.value); setLevel(''); }}
                        >
                            {inGroup.map(t => (
                                <option key={`${t.kind}:${t.key}`} value={`${t.kind}:${t.key}`}>
                                    {t.label} (Lv {t.current}/{t.max})
                                </option>
                            ))}
                        </select>
                        {target && (
                            <div className="wi-level">
                                <input
                                    type="number" min={0} max={target.max} inputMode="numeric"
                                    placeholder={`Lv ${target.current}`} value={level}
                                    onChange={e => setLevel(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') add(); }}
                                    aria-label="New level"
                                />
                                <button className="btn btn-dim" onClick={() => setLevel(String(Math.min(target.max, target.current + 1)))}>+1</button>
                                <button className="btn btn-dim" onClick={() => setLevel(String(Math.min(target.max, target.current + 10)))}>+10</button>
                                <button className="btn btn-dim" onClick={() => setLevel(String(target.max))}>Max</button>
                                <button className="btn btn-accent" onClick={add} disabled={!validLevel}>Add</button>
                            </div>
                        )}
                    </div>
                    {target && validLevel && wanted > target.current && (
                        <p className="wi-hint">
                            Lv {target.current} → {wanted}: <CostLine costs={changeCost(base, target, wanted)} />
                        </p>
                    )}

                    {changes.length > 0 && (
                        <div className="wi-list">
                            {changes.map(c => {
                                const t = targets.find(x => x.kind === c.kind && x.key === c.key);
                                if (!t) return null;
                                return (
                                    <div key={`${c.kind}:${c.key}`} className="wi-item">
                                        <span className="wi-item-name">{t.label}</span>
                                        <span className="wi-item-lv">
                                            Lv {t.current} → {c.level}
                                            {Math.abs(own(c) ?? 0) >= 0.05 && <span className="wi-item-waves">{wavesText(own(c)!)}</span>}
                                        </span>
                                        <button
                                            className="btn btn-dim wi-remove"
                                            onClick={() => setChanges(cs => cs.filter(x => x !== c))}
                                            aria-label={`Remove ${t.label}`}
                                        >✕</button>
                                    </div>
                                );
                            })}
                            {result && result.perChange.length > 1 && (
                                <p className="wi-hint" style={{ marginTop: 0 }}>
                                    Waves next to each change are what it adds on its own. Together they can add more
                                    or less, as each works on the others.
                                </p>
                            )}
                            <button className="btn btn-dim" onClick={() => setChanges([])}>Clear all</button>
                        </div>
                    )}
                </div>
            </div>

            {result && (
                <div className="section">
                    <div className="section-head"><h3>What happens</h3></div>
                    <div className="section-body">
                        <div className="wi-results">
                            <span className="wi-k">All damage (eDPS)</span>
                            <span className="wi-v">{pct(result.damagePct)}</span>
                            {gc && (<>
                                <span className="wi-k" title="Flat damage, with Enemy Health Level Skip counted as the damage that gains the same waves">
                                    Push (flat damage + skip)
                                </span>
                                <span className="wi-v">{pct(result.pushPct)}</span>
                            </>)}
                            {result.skipPoints !== 0 && (<>
                                <span className="wi-k">Enemy {result.skipKind === 'attack' ? 'Attack' : 'Health'} Level Skip</span>
                                <span className="wi-v">{result.skipPoints > 0 ? '+' : ''}{result.skipPoints.toFixed(2)} points</span>
                            </>)}
                            {result.waves && (<>
                                <span className="wi-k wi-strong">Waves gained</span>
                                <span className="wi-v wi-strong">
                                    {wavesText(result.waves.gained)}
                                </span>
                                {result.spread && (<>
                                    <span className="wi-k" title="Each of your recent deaths moved on its own: how much the gain changes from run to run">
                                        From run to run
                                    </span>
                                    <span className="wi-v">
                                        {wavesText(result.spread.min).replace(' waves', '')} to {wavesText(result.spread.max)}
                                    </span>
                                </>)}
                                <span className="wi-k">{tourney ? 'Tournament waves this week' : 'Waves reached'}</span>
                                <span className="wi-v">
                                    W{result.waves.from.toLocaleString()} → W{result.waves.to.toLocaleString()}
                                </span>
                            </>)}
                            {result.coinsRun && (<>
                                <span className="wi-k">Coins per run</span>
                                <span className="wi-v">
                                    {formatGameNumber(result.coinsRun.from)} → {formatGameNumber(result.coinsRun.to)}
                                    {' '}({pct((result.coinsRun.to / result.coinsRun.from - 1) * 100)})
                                </span>
                            </>)}
                            {result.coinsHour && (<>
                                <span className="wi-k" title="Playing each run to its end: the extra waves pay more than the early ones">
                                    Coins per hour
                                </span>
                                <span className="wi-v">
                                    {formatGameNumber(result.coinsHour.from)} → {formatGameNumber(result.coinsHour.to)}
                                    {' '}({pct((result.coinsHour.to / result.coinsHour.from - 1) * 100)})
                                </span>
                            </>)}
                            {result.cellsRun && Math.abs(result.cellsRun.to / result.cellsRun.from - 1) > 1e-9 && (<>
                                <span className="wi-k" title="Elite cells on your chosen run: Cells/Kill Bonus, the Cells card and its mastery, at the same waves">
                                    Elite cells per run
                                </span>
                                <span className="wi-v">
                                    {formatGameNumber(result.cellsRun.from)} → {formatGameNumber(result.cellsRun.to)}
                                    {' '}({pct((result.cellsRun.to / result.cellsRun.from - 1) * 100)})
                                </span>
                            </>)}
                            <span className="wi-k" title="Coin bonuses only: what the same waves would pay">
                                Coin income at the same wave
                            </span>
                            <span className="wi-v">{pct(result.coinsHourPct)}</span>
                            {result.survivalPct !== null && (<>
                                <span className="wi-k">Survival (eHP)</span>
                                <span className="wi-v">{pct(result.survivalPct)}</span>
                            </>)}
                            <span className="wi-k">Cost</span>
                            <span className="wi-v"><CostLine costs={result.costs} /></span>
                        </div>
                        {result.spread && (
                            <p className="wi-hint">
                                Your last {result.spread.runs} {result.spread.tournament ? 'tournament deaths' : 'deaths'} ended between W{result.spread.endedMin.toLocaleString()} and
                                W{result.spread.endedMax.toLocaleString()} — runs already vary by{' '}
                                {(result.spread.endedMax - result.spread.endedMin).toLocaleString()} waves, so a gain smaller than
                                that shows over several runs, not one.
                            </p>
                        )}
                        {result.freeNotes.map(note => <p key={note} className="wi-hint">{note}</p>)}
                        {!models.run && (!tourney || gc) && (
                            <p className="wi-hint">
                                Waves and coins per run need runs that ended in a death — use Import Game Data.
                            </p>
                        )}
                        {!gc && models.run && !tourney && (
                            <p className="wi-hint">
                                eHP: your runs end where enemy attack outgrows what your tower can take, so more
                                survival moves the end to where enemies hit that much harder (Run Length).
                            </p>
                        )}
                        <p className="wi-hint">
                            Coins per run and per hour include the longer run; income at the same wave is the coin
                            bonuses alone. Waves far past where your runs end now are rough.
                        </p>
                    </div>
                </div>
            )}

            {result && result.chain.length > 0 && (
                <div className="section" style={{ marginTop: '12px' }}>
                    <div className="section-head"><h3>How it adds up</h3></div>
                    <div className="section-body">
                        <p className="wi-hint" style={{ marginTop: 0 }}>
                            Everything that moved on the way. An upgrade that deals no damage itself — Chrono
                            Field, Chrono Loop (CF+), range — works by keeping enemies in range longer, so every
                            source gets more time on each enemy; Multishot, Bounce Shot and Rapid Fire give Chain
                            Lightning more hits to proc on. The percentage after a source is its share of your
                            run&apos;s damage; the waves after it are its part of the waves gained.
                        </p>
                        {CHAIN_GROUPS.filter(g => result.chain.some(l => l.group === g)).map(g => (
                            <div key={g} className="wi-chain">
                                <div className="wi-chain-head">{g}</div>
                                {result.chain.filter(l => l.group === g).map(l => (
                                    <div key={l.label} className="wi-chain-row">
                                        <span className="wi-k">
                                            {l.label}
                                            {l.share !== undefined && <span className="wi-share"> {(l.share * 100).toFixed(1)}%</span>}
                                        </span>
                                        <span className="wi-v">
                                            {linkText(l)}
                                            {l.waves !== undefined && Math.abs(l.waves) >= 0.05 && (
                                                <span className="wi-link-waves">≈ {wavesText(l.waves)}</span>
                                            )}
                                        </span>
                                    </div>
                                ))}
                                {g === 'Run savers' && (
                                    <p className="wi-hint" style={{ marginTop: 4 }}>
                                        Death Defy ignores a killing hit with its chance before Energy Shield, Second Wind,
                                        Demon Mode or Nuke take one, so each saver behind it makes it worth more. Not
                                        turned into waves yet: that needs how often killing hits come near the end of
                                        a run.
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
