// ============================================================
//  TowerForge Companion — Farming & eHP Optimizer Panels
//  Battle Report input (calibrates both models), the coin
//  economy breakdown (Farming) and the survival breakdown (eHP).
// ============================================================

import { useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { extraDamage, activeBattleReport, parseBattleReport } from '../../engine/battleReport';
import RunLines from '../common/RunLines';
import type { BattleReport } from '../../engine/battleReport';
import { isRealRun } from '../../engine/gameExport';
import { formatGameNumber } from '../../engine/gameNumbers';
import { FARM_EFFECTS, FARM_EFFECT_LABELS } from '../../engine/farming';
import type { FarmCalibration } from '../../engine/farming';
import { chronoInRun, defPctInRun, ehpBreakdown, SUSTAIN_WINDOW_S } from '../../engine/ehp';
import type { EhpCalibration, EhpFactor } from '../../engine/ehp';

const fmtBig = (n: number): string => (n >= 1e3 ? formatGameNumber(n) : n.toFixed(0));

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// ── Battle Report input ───────────────────────────────────────
// One saved report calibrates both builds; `purpose` only changes the copy.
// Damage by source, biggest first, as "Orbs 88% · CL 8.9% · …".
function damageLine(report: BattleReport, d: NonNullable<BattleReport['damage']>): string {
    const x = extraDamage(report);
    const rows: [string, number][] = [
        ['Orbs', d.orbs], ['Chain Lightning', d.chainLightning], ['Black Hole', d.blackHole],
        ['Tower shots', d.projectiles], ['Thorns', d.thorns], ['Poison Swamp', d.poisonSwamp],
        ['Rend Armor', d.rendArmor], ['Smart Missiles', d.smartMissiles], ['Inner Land Mines', d.innerLandMines],
        ['Death Wave', d.deathWave], ['Land Mines', d.landMines], ['Flame Bot', x.flameBot], ['Death Ray', x.deathRay],
        ['Spotlight', x.spotlight], ['Electrons', x.electrons], ['Guardian', x.guardian], ['Attack chip', x.attackChip],
    ];
    const listed = rows.filter(([, v]) => v / d.total >= 0.001).sort((a, b) => b[1] - a[1]);
    const rest = 1 - listed.reduce((t, [, v]) => t + v / d.total, 0);
    return [...listed.map(([k, v]) => `${k} ${pct(v / d.total)}`), ...(rest >= 0.001 ? [`other ${pct(rest)}`] : [])].join(' · ');
}

export function BattleReportPanel({ purpose }: { purpose: 'farming' | 'ehp' | 'edps' }) {
    const text = useGameStore(s => s.battleReportText);
    const setText = useGameStore(s => s.setBattleReportText);
    const imported = useGameStore(s => s.importedBattles);
    const choice = useGameStore(s => s.battleReportChoice);
    const setChoice = useGameStore(s => s.setBattleReportChoice);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);

    const report = activeBattleReport(text, imported, choice);
    // Newest first; keep each run's index into importedBattles. Quick restarts
    // (wave 1) are hidden, but the current choice always stays listed.
    const runs = imported.map((b, i) => ({ b, i })).filter(({ b, i }) => isRealRun(b) || i === choice).reverse();

    function save() {
        if (!parseBattleReport(draft)) {
            setError('That doesn’t look like a Battle Report. Copy the whole report from the game’s run stats screen.');
            return;
        }
        setText(draft);
        setChoice(-1);   // a freshly pasted report takes over from imported runs
        setDraft('');
        setError(null);
        setEditing(false);
    }

    return (
        <div className="section" style={{ marginBottom: '12px' }}>
            <div className="section-head">
                <h3>Battle Report</h3>
                {report && (purpose !== 'edps' || report.damage) && <span className="s-badge">Calibrated</span>}
            </div>
            <div className="section-body" style={{ padding: '10px 14px' }}>
                {runs.length > 0 && !editing && (
                    <div className="flex-row" style={{ marginBottom: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>Calibrate from</span>
                        <select
                            value={choice}
                            onChange={e => setChoice(parseInt(e.target.value))}
                            style={{ fontSize: '13px', maxWidth: '100%' }}
                        >
                            {runs.map(({ b, i }) => (
                                <option key={i} value={i}>
                                    Imported run · {b.date} · T{b.tier} W{b.wave.toLocaleString()}{b.tournament ? ' · tournament' : ''}
                                </option>
                            ))}
                            <option value={-1}>{text ? 'Pasted Battle Report' : 'Pasted Battle Report (none yet)'}</option>
                        </select>
                        <span style={{ fontSize: '13px', color: 'var(--text-dim)', flexBasis: '100%' }}>
                            {imported.length} run{imported.length === 1 ? '' : 's'} saved — the game&apos;s file only
                            holds your last 5, so importing after a few runs keeps adding to this history.
                        </span>
                    </div>
                )}
                {report && !editing ? (
                    <>
                        <p style={{ fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                            Tier {report.tier} · Wave {report.wave.toLocaleString()} · {fmtBig(report.coinsPerHour)} coins/hour
                            {report.date ? ` · ${report.date}` : ''}
                        </p>
                        {purpose === 'edps' ? (
                            <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '6px', lineHeight: 1.6 }}>
                                {report.damage
                                    ? <>Damage dealt: {damageLine(report, report.damage)}</>
                                    : 'This report has no damage breakdown, so eDPS uses the model alone. Import your game data and pick one of its runs to rank by your real damage.'}
                            </p>
                        ) : purpose === 'ehp' ? (
                            <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '6px', lineHeight: 1.6 }}>
                                {report.recoveryPackages.toLocaleString()} recovery packages ·{' '}
                                thorns made {pct(report.totalEnemies > 0 ? report.thornsKills / report.totalEnemies : 0)} of kills
                            </p>
                        ) : (
                        <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '6px', lineHeight: 1.6 }}>
                            Kills covered:{' '}
                            {[
                                ['GT', report.killedWithEffect.goldenTower],
                                ['BH', report.killedWithEffect.blackHole],
                                ['SL', report.killedWithEffect.spotlight],
                                ['DW', report.killedWithEffect.deathWave],
                                ['Golden Bot', report.killedWithEffect.goldenBot],
                                ['Orbs', report.killedWithEffect.orbs],
                            ].filter(([, v]) => v != null).map(([k, v]) => `${k} ${pct(v as number)}`).join(' · ')}
                        </p>
                        )}
                        <RunLines run={report} />
                        <div className="flex-row" style={{ marginTop: '8px' }}>
                            <button className="btn btn-dim" onClick={() => { setDraft(text); setEditing(true); }}>
                                Replace Report
                            </button>
                            {choice < 0 && <button className="btn btn-dim" onClick={() => setText('')}>Remove</button>}
                        </div>
                    </>
                ) : (
                    <>
                        <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '8px', lineHeight: 1.6 }}>
                            {purpose === 'ehp'
                                ? 'Paste the Battle Report from a recent run (copy it from the game’s run stats when the run ends). It tells the optimizer how often you really get recovery packages and how much of the killing your thorns do.'
                                : purpose === 'edps'
                                    ? 'Import your game data and pick a run, or paste a Battle Report. The damage each source dealt in that run weights the eDPS ranking — e.g. if orbs did most of the damage, a Chain Lightning upgrade counts for less.'
                                    : 'Paste the Battle Report from a recent farming run (copy it from the game’s run stats when the run ends). It tells the optimizer how many of your kills each coin effect actually covers, and how much Golden Combo and Wave Skip add.'}
                            {' '}Without it, the results use rough estimates.
                        </p>
                        <textarea
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            placeholder={'Battle Report\nBattle Date\t…\nGame Time\t…'}
                            rows={6}
                            style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
                        />
                        {error && <p style={{ fontSize: '13px', color: 'var(--red, #e74c3c)', marginTop: '6px' }}>{error}</p>}
                        <div className="flex-row" style={{ marginTop: '8px' }}>
                            <button className="btn btn-accent" onClick={save} disabled={!draft.trim()}>Save Report</button>
                            {report && <button className="btn btn-dim" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Economy breakdown (after a run) ───────────────────────────
export function EconomyStats({ calib }: { calib: FarmCalibration }) {
    const a = calib.anchor;
    const skipShare = calib.waveSkipExtra / (1 + calib.waveSkipExtra);

    return (
        <div className="section" style={{ marginBottom: '12px' }}>
            <div className="section-head">
                <h3>Coin Economy</h3>
                <span className="s-badge">{calib.source === 'report' ? 'From your Battle Report' : 'Estimated'}</span>
            </div>
            <div className="section-body">
                <div className="ttt-stats-grid">
                    {calib.coinsPerHour != null && (
                        <div className="stat-pill">
                            <span className="stat-pill-label">Coins / Hour</span>
                            <span className="stat-pill-val gold" style={{ fontSize: '15px' }}>{fmtBig(calib.coinsPerHour)}</span>
                        </div>
                    )}
                    {FARM_EFFECTS.filter(e => a.mult[e] > 1 || calib.coverage[e] > 0).map(e => (
                        <div key={e} className="stat-pill" title={`${FARM_EFFECT_LABELS[e]}: ×${a.mult[e].toFixed(2)} coins on ${pct(calib.coverage[e])} of kills`}>
                            <span className="stat-pill-label">{FARM_EFFECT_LABELS[e]}</span>
                            <span className="stat-pill-val">
                                ×{a.mult[e].toFixed(2)}
                                <span style={{ color: 'var(--text-dim)', fontSize: '13px' }}> · {pct(calib.coverage[e])}</span>
                            </span>
                        </div>
                    ))}
                    <div className="stat-pill">
                        <span className="stat-pill-label">Golden Combo</span>
                        <span className="stat-pill-val">{pct(calib.comboShare * (1 - skipShare))}</span>
                    </div>
                    <div className="stat-pill">
                        <span className="stat-pill-label">Wave Skip</span>
                        <span className="stat-pill-val">{pct(skipShare)}</span>
                    </div>
                </div>
                <p className="ttt-explainer">
                    Each effect shows its coin multiplier and the share of kills it covers. Multipliers only
                    stack on the same kill, so raising coverage (duration, cooldown, size, angle) can be worth
                    as much as raising the multiplier. Golden Combo and Wave Skip show their share of all coins.
                    {calib.source === 'estimate' && ' Paste a Battle Report above for numbers from your real runs.'}
                </p>
            </div>
        </div>
    );
}

// One stat's factors, line by line, ending in its total.
function FactorList({ title, factors, total, percent }: {
    title: string;
    factors: EhpFactor[];
    total: string;
    percent?: boolean;
}) {
    const fmt = (f: EhpFactor) =>
        f.op === 'base' ? fmtBig(f.value)
            : f.op === '+' ? `${f.value < 0 ? '−' : '+'}${Math.abs(f.value).toFixed(2)}${percent ? '%' : ''}`
                : `×${f.value.toFixed(f.value < 10 ? 3 : 2)}`;
    return (
        <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{title}</div>
            {factors.map(f => (
                <div key={f.label} className="flex-row" style={{ fontSize: '13px', gap: '8px' }}>
                    <span style={{ flex: 1, color: 'var(--text-dim)' }}>
                        {f.label}
                        {f.note && <span style={{ fontSize: '13px' }}> — {f.note}</span>}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt(f)}</span>
                </div>
            ))}
            <div className="flex-row" style={{ fontSize: '13px', gap: '8px', borderTop: '1px solid var(--border)', marginTop: '3px', paddingTop: '3px' }}>
                <span style={{ flex: 1 }}>Total</span>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{total}</strong>
            </div>
        </div>
    );
}

// What each defense took out of the enemy damage in the chosen run.
function BlockedInRun({ calib }: { calib: EhpCalibration }) {
    const l = calib.layers;
    if (!l) return null;
    const a = calib.anchor;
    const rows: [string, number | null, string?][] = [
        ['Chrono Field', l.chrono, a.cfReduction > 0 ? `lab × uptime ${pct(a.cfReduction)}` : undefined],
        ['Chain Thunder', l.chainThunder, (a.chainThunderCap ?? 0) > 0 ? `lab's most ${pct(a.chainThunderCap!)}` : undefined],
        ['Flame Bot', l.flame, (a.flameReduction ?? 0) > 0 ? `Damage Reduction ${pct(a.flameReduction!)}` : undefined],
        ['Primordial Collapse', l.primordial],
        ['Negative Mass Projector', l.negativeMass],
        ['Defense %', l.defPct],
    ];
    return (
        <div className="ehpl-blocked">
            <div className="ehpl-title">What blocked the damage in this run</div>
            {rows.filter(([, cut]) => cut).map(([label, cut, note]) => (
                <div key={label} className="ehpl-row">
                    <span>{label}{note && <span className="ehpl-note"> — {note}</span>}</span>
                    <strong>{(cut! * 100).toFixed(1)}%</strong>
                </div>
            ))}
            <div className="ehpl-row ehpl-landed">
                <span>Landed, of all the enemy damage</span>
                <strong>{(l.landed / l.total * 100).toFixed(1)}%</strong>
            </div>
            <p className="ehpl-note">Each is a share of the damage that reached it, from your Battle Report; Defense % is worked out last.</p>
        </div>
    );
}

// ── Survival breakdown (eHP, after a run) ─────────────────────
export function EhpStats({ calib }: { calib: EhpCalibration }) {
    const a = calib.anchor;
    const { eHP, eRegen } = ehpBreakdown(a, calib);
    const def = defPctInRun(a, calib);
    const picksShort = calib.defPicksShort ?? 0;
    const capped = a.defPctUncapped - picksShort * (a.defPerkPick ?? 0) > def * 100 + 0.001;
    const chrono = chronoInRun(a, calib);

    const pills: [string, string, string?][] = [
        ['Effective HP', fmtBig(eHP), 'Raw damage needed to kill the tower in one hit: (health × package overheal + wall) ÷ (1 − CF) + Def Abs, all ÷ (1 − Def %).'],
        ['Effective Regen', `${fmtBig(eRegen)}/s`, 'Raw damage per second your healing cancels out (regen, wall regen and packages, after Def % and Chrono Field).'],
        ['Max Health', fmtBig(a.health)],
        ...(a.maxRecovery > 1
            ? [['Package Overheal', `×${a.maxRecovery.toFixed(2)}`, 'Recovery packages can heal past max health up to this × max health — counted as your health pool.'] as [string, string, string]]
            : []),
        ['Defense %', `${(def * 100).toFixed(1)}%${capped ? ' (capped)' : ''}`, picksShort > 0
            ? `Your Battle Report blocked ${pct(calib.layers?.defPct ?? 0)}: this counts ${picksShort} Defense % perk ${picksShort === 1 ? 'pick' : 'picks'} fewer than the 5 it counts for a full run.`
            : capped ? `Your sources add up to ${a.defPctUncapped.toFixed(1)}%, but Defense % is capped at 98%.` : undefined],
        ['Defense Abs', fmtBig(a.defAbs)],
        ['Chrono Field', `${(chrono * 100).toFixed(1)}%`, calib.chronoCover !== undefined
            ? `Chrono Field damage reduction × its uptime (${pct(a.cfReduction)}), on the ${pct(calib.chronoCover)} of hits it covered in your Battle Report.`
            : 'Chrono Field damage reduction × its uptime.'],
    ];
    if (a.wallPool > 0) pills.push(['Wall Pool', fmtBig(a.wallPool)]);
    pills.push(['Regen', `${fmtBig(a.regen + a.wallRegen)}/s`, 'Tower regen plus wall regen.']);
    if (a.thorns > 0) pills.push(['Thorns', `${(a.thorns * 100).toFixed(0)}%`, `Thorns made ${pct(calib.thornsShare)} of kills.`]);

    return (
        <div className="section" style={{ marginBottom: '12px' }}>
            <div className="section-head">
                <h3>Survival</h3>
                <span className="s-badge">{calib.source === 'report' ? 'Calibrated by your Battle Report' : 'Estimated'}</span>
            </div>
            <div className="section-body">
                <div className="ttt-stats-grid">
                    {pills.map(([label, value, title]) => (
                        <div key={label} className="stat-pill" title={title}>
                            <span className="stat-pill-label">{label}</span>
                            <span className="stat-pill-val">{value}</span>
                        </div>
                    ))}
                </div>
                <BlockedInRun calib={calib} />
                <details style={{ marginTop: '10px' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '13px', color: 'var(--accent)' }}>
                        How these are calculated
                    </summary>
                    <div style={{ marginTop: '8px', maxWidth: '640px' }}>
                        <FactorList title="Max Health" factors={a.parts.health} total={fmtBig(a.health)} />
                        <FactorList title="Health Regen" factors={a.parts.regen} total={`${fmtBig(a.regen)}/s`} />
                        <FactorList title="Defense Absolute" factors={a.parts.defAbs} total={fmtBig(a.defAbs)} />
                        <FactorList
                            title="Defense %"
                            factors={picksShort > 0
                                ? [...a.parts.defPct, { label: `Perk picks this run didn't have: ${picksShort}`, value: -picksShort * (a.defPerkPick ?? 0), op: '+' }]
                                : a.parts.defPct}
                            total={`${(def * 100).toFixed(2)}%${capped ? ' (capped at 98%)' : ''}`}
                            percent
                        />
                        {(a.parts.damageTaken?.length ?? 0) > 0 && (
                            <FactorList
                                title="Damage that lands (module effects — eHP and regen ÷ this)"
                                factors={[{ label: 'All enemy damage', value: 1, op: 'base' }, ...a.parts.damageTaken]}
                                total={`${((a.damageTaken ?? 1) * 100).toFixed(1)}%`}
                            />
                        )}
                        {a.armorMainMissing && (
                            <p style={{ fontSize: '13px', color: 'var(--gold)', lineHeight: 1.6 }}>
                                Your Armor slot level isn&apos;t set, so your Armor module&apos;s ×Tower Health is
                                undercounted. Set it on Modules → Loadouts (slot levels), or type the ×value from the
                                module card into the module&apos;s Main effect.
                            </p>
                        )}
                        <p style={{ fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                            Perks count all-or-nothing: every perk you haven&apos;t banned is counted at 5 picks,
                            including trade-offs, except Defense %, which follows your Battle Report. Mid-run the game
                            only has the perks you&apos;ve picked so far, and
                            the Death Wave bonus grows during the run. The health pool also counts package overheal
                            (×{a.maxRecovery.toFixed(2)}).
                        </p>
                    </div>
                </details>
                <p className="ttt-explainer">
                    Upgrades are ranked by Survival, which balances the two ways a tower dies: one hit bigger
                    than its effective HP, and {SUSTAIN_WINDOW_S}s of pressure bigger than its effective HP plus
                    {' '}{SUSTAIN_WINDOW_S}s of effective regen. Defense % multiplies both, so it ranks highly until
                    it hits the 98% cap. Thorns count in proportion to the kills they make. Perks count unless
                    banned on the Perks tab.
                    {calib.source === 'estimate' && ' Paste a Battle Report above for your real package rate and thorn kills.'}
                </p>
            </div>
        </div>
    );
}
