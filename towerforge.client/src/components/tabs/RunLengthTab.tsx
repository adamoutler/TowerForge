// ============================================================
//  TowerForge Companion — Run Length Tab
//  Run simulator, step 2: what ended each saved run, where the tower stops
//  coping, and how many waves — and how many more coins per run — more
//  damage (Glass Cannon: enemy health decides the end) or more survival
//  (eHP: enemy attack decides it), or more level skip, would buy
//  (engine/runLength.ts, runCoins.ts). The view follows the profile's
//  build; the player can switch it.
// ============================================================

import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import {
    buildRunLengthModel, oneHitEnds, runEnds, wavesFromDamage, wavesFromSkip,
} from '../../engine/runLength';
import type { RunStat } from '../../engine/runLength';
import { effectiveBuild, runStatOf } from '../../engine/accountModels';
import { runSavers } from '../../engine/battleReport';
import type { BattleReport } from '../../engine/battleReport';
import { buildRunModel, projectRun, runSettingsFromCards } from '../../engine/runCoins';
import { defaultBattleIndex } from '../../engine/gameExport';
import PageIntro from '../common/PageIntro';

const GAIN_STEPS = [0.01, 0.05, 0.1, 0.25, 0.5, 1];
const SKIP_STEPS = [0.5, 1, 2, 5];

// "Death Defy 2 · Energy Shield 1", from the run's own counts.
function savedBy(run: BattleReport): string {
    const s = runSavers(run);
    const parts: [string, number | null][] = [
        ['Death Defy', s.deathDefy], ['Energy Shield', s.energyShield], ['Second Wind', s.secondWind],
        ['Demon Mode', s.demonMode], ['Nuke', s.nuke],
    ];
    return parts.filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${k} ${v}`).join(' · ');
}

const pctOf = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

export default function RunLengthTab() {
    const battles = useGameStore(s => s.importedBattles);
    const cardData = useGameStore(s => s.cardData);
    const preset = useGameStore(s => s.activePreset);
    const build = useGameStore(s => s.profile.build);

    // What ends the runs: enemy attack for eHP builds, enemy health for Glass
    // Cannon — the build's own unless the player switches.
    const [statPick, setStatPick] = useState<RunStat | null>(null);
    const stat = statPick ?? runStatOf(effectiveBuild(build, battles));
    const attack = stat === 'attack';

    // Campaign and tournament runs scale differently, so each has its own
    // model (enemy health only: the tournament attack curve isn't known).
    const [tourney, setTourney] = useState(false);
    const hasTourney = useMemo(() => !attack && buildRunLengthModel(battles, { tournament: true }) !== null, [battles, attack]);
    const showTourney = tourney && hasTourney;
    const model = useMemo(() => buildRunLengthModel(battles, { tournament: showTourney, stat }), [battles, showTourney, stat]);
    const ends = useMemo(
        () => runEnds(battles).filter(e => e.run.tournament === showTourney && e.run.wave > 1).reverse(),
        [battles, showTourney],
    );
    // Coins per run from step 1, tuned on the default run with the card settings.
    const coins = useMemo(() => {
        const settings = runSettingsFromCards(cardData, preset);
        const coinModel = buildRunModel(battles, defaultBattleIndex(battles), settings);
        return coinModel ? { cal: coinModel.calibration, settings } : null;
    }, [battles, cardData, preset]);

    const switcher = (
        <div className="rl-kind" role="group" aria-label="What ends your runs">
            <button className={`btn ${attack ? 'btn-accent' : 'btn-dim'}`} onClick={() => setStatPick('attack')}>
                Enemy attack (eHP)
            </button>
            <button className={`btn ${attack ? 'btn-dim' : 'btn-accent'}`} onClick={() => setStatPick('health')}>
                Enemy health (Glass Cannon)
            </button>
        </div>
    );

    if (!model) {
        return (
            <div>
                {switcher}
                <div className="relics-note">
                    <strong>Run Length</strong> needs runs that ended in a death, with their level skips — use
                    <em> Import Game Data</em> (runs imported before Oct 17 don&apos;t have them; importing again adds them).
                    {attack && ' The eHP view reads campaign runs only.'}
                </div>
            </div>
        );
    }

    const used = new Set(model.used.map(d => d.index));
    const oneHit = attack ? oneHitEnds(model) : null;
    // Tournaments pay differently; Coins per Run is campaign only.
    const coinsAt = (wave: number) =>
        coins && !model.tournament ? projectRun(coins.cal, coins.settings, wave, model.tier).coins : null;
    const baseCoins = coinsAt(model.typicalWave);
    const coinChange = (extraWaves: number) => {
        const at = coinsAt(model.typicalWave + extraWaves);
        return at !== null && baseCoins ? at / baseCoins - 1 : null;
    };
    const enemy = attack ? 'attack' : 'health';
    const gainWord = attack ? 'survival' : 'damage';

    return (
        <div>
            {switcher}
            <PageIntro title={`Run simulator, step 2 — how far a run gets (${attack ? 'eHP' : 'Glass Cannon'})`}>
                {attack ? (<>
                    An eHP tower takes the hits, so
                    a run lasts until enemies hit harder than it can take — its health, healing and defense (the
                    Optimizer&apos;s survival). Enemy attack at the wave you died (from the formula checked against the
                    game) tells us where that point is; more survival pushes it to where enemies hit that much harder.
                </>) : (<>
                    One hit ends a GC run, so
                    a run lasts until enemies are too tough to kill before they reach the tower. Enemy health at the
                    wave you died (from the formula checked against the game) tells us where that point is; more
                    damage pushes it to where enemies are that much tougher.
                </>)}
            </PageIntro>

            {oneHit && (
                <div className="relics-note rl-warn">
                    <strong>Your runs end to single hits.</strong> The damage your tower took in these runs is far more
                    than everything it healed — the last hit was much bigger than the tower could take, as in a Glass
                    Cannon run. Then enemies reaching the tower, not how hard they hit, decides the end, and survival
                    buys fewer waves than shown here: compare the Glass Cannon view.
                </div>
            )}

            {hasTourney && (
                <div className="rl-kind" role="group" aria-label="Which runs">
                    <button className={`btn ${showTourney ? 'btn-dim' : 'btn-accent'}`} onClick={() => setTourney(false)}>Campaign</button>
                    <button className={`btn ${showTourney ? 'btn-accent' : 'btn-dim'}`} onClick={() => setTourney(true)}>Tournament</button>
                </div>
            )}

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head">
                    <h3>Where your runs end</h3>
                    <span className="s-badge">{model.tournament ? 'Tournament' : `Tier ${model.tier}`}</span>
                </div>
                <div className="section-body en-inputs">
                    <div className="rc-result">
                        <div><span>Runs end around</span><strong>W{model.typicalWave.toLocaleString()}</strong></div>
                        <div><span>{attack ? 'Attack' : 'Health'} levels skipped</span><strong>{(model.skipRate * 100).toFixed(1)}%</strong></div>
                        <div><span>+10% {gainWord}</span><strong>+{Math.round(wavesFromDamage(model, 0.1))} waves</strong></div>
                    </div>
                    <p className="en-note">
                        From your {model.used.length} newest {model.tournament ? 'tournament ' : ''}death{model.used.length === 1 ? '' : 's'}
                        {model.tournament ? '' : ` on tier ${model.tier}`} (marked • below).
                        {attack && ' Runs that ended far short of the others (a try at another tier, another build) are left out.'}
                        {model.tournament && ' Tournament enemies get tougher much faster than on a campaign tier, so the same upgrade buys far fewer waves. '}
                        {' '}Enemy {enemy} jumps at some waves — a wall — so the same extra {gainWord} buys more waves in
                        some runs than others; the tables average your recent deaths.
                    </p>
                </div>
            </div>

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head"><h3>What more {gainWord} buys</h3></div>
                <div className="section-body en-table-wrap">
                    <table className="en-table">
                        <thead><tr><th>{attack ? 'Survival' : 'Damage'}</th><th>Waves</th><th>Run to</th><th>Coins / run</th></tr></thead>
                        <tbody>
                            {GAIN_STEPS.map(g => {
                                const w = Math.round(wavesFromDamage(model, g));
                                const c = coinChange(w);
                                return (
                                    <tr key={g}>
                                        <td>{g >= 1 ? `×${1 + g}` : `+${g * 100}%`}</td>
                                        <td>+{w}</td>
                                        <td>W{(model.typicalWave + w).toLocaleString()}</td>
                                        <td>{c === null ? '—' : pctOf(c)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="en-note">
                        {attack
                            ? <>&quot;Survival&quot; is the Optimizer&apos;s survival score — health, overheal, wall,
                                healing, Defense % and Absolute, Chrono Field and module damage cuts, thorns.</>
                            : <>&quot;Damage&quot; is everything that kills — the Optimizer&apos;s eDPS.</>}
                        {' '}Coins per run come from Coins per Run, tuned on your default run.
                    </p>
                </div>
            </div>

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head"><h3>What more Enemy {attack ? 'Attack' : 'Health'} Level Skip buys</h3></div>
                <div className="section-body en-table-wrap">
                    <table className="en-table">
                        <thead><tr><th>Skip</th><th>Waves</th><th>Run to</th><th>Coins / run</th></tr></thead>
                        <tbody>
                            {SKIP_STEPS.map(p => {
                                const w = Math.round(wavesFromSkip(model, p));
                                const c = coinChange(w);
                                return (
                                    <tr key={p}>
                                        <td>+{p}%</td>
                                        <td>+{w}</td>
                                        <td>W{(model.typicalWave + w).toLocaleString()}</td>
                                        <td>{c === null ? '—' : pctOf(c)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="en-note">
                        Percentage points of the skip chance you actually get on this tier (after its battle conditions).
                    </p>
                </div>
            </div>

            <div className="section">
                <div className="section-head"><h3>Your runs</h3></div>
                <div className="section-body en-table-wrap">
                    <table className="en-table rc-table">
                        <thead><tr><th>Run</th><th>Ended by</th><th>Enemy {enemy}</th></tr></thead>
                        <tbody>
                            {ends.map(e => {
                                const value = attack ? e.enemyAttack : e.enemyHealth;
                                return (
                                    <tr key={e.index}>
                                        <td>
                                            {used.has(e.index) ? '• ' : ''}T{e.run.tier} W{e.run.wave.toLocaleString()}
                                            <span className="en-sub">{e.run.date}</span>
                                        </td>
                                        <td>
                                            {e.killer === undefined ? <span className="en-dim">—</span> : e.killer ?? 'You (quit)'}
                                            {savedBy(e.run) && <span className="en-sub">Saved by {savedBy(e.run)}</span>}
                                        </td>
                                        <td>
                                            {value === null || !e.killer || e.run.tier !== model.tier
                                                ? <span className="en-dim">—</span>
                                                : pctOf(value / model.limit - 1)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="en-note">
                        &quot;Ended by&quot; is the game&apos;s Killed By (the enemy type that got through); &quot;Saved by&quot;
                        counts the killing hits Death Defy, Energy Shield, Second Wind, Demon Mode and Nuke took before
                        that. Enemy {enemy} is how {attack ? 'hard enemies hit' : 'tough enemies were'} at the end of the
                        run compared with where your runs usually end.
                    </p>
                </div>
            </div>
        </div>
    );
}
