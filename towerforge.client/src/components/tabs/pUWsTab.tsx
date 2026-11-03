// ============================================================
//  TowerForge Companion — Permanent UWs (pUWs) Tab
//  Shows, for each duration-based UW, whether it can be kept
//  permanently active (duration ≥ effective cooldown after
//  Galaxy Compressor) and the cheapest stone path to get there.
// ============================================================

import { useGameStore } from '../../store/useGameStore';
import { readActiveModuleBonuses } from '../../engine/modBonuses';
import { uniq } from '../../engine/moduleEffects';
import { calcPermanentUWs } from '../../engine/permanentUW';
import stoneIcon from '../../assets/stone.png';

function s(n: number): string {
    // Trim trailing .0 for whole numbers, else 1 decimal.
    return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

export default function PUWsTab() {
    const uwData = useGameStore(st => st.uwData);
    const wsData = useGameStore(st => st.wsData);
    const labData = useGameStore(st => st.labData);
    const cardData = useGameStore(st => st.cardData);
    const perkData = useGameStore(st => st.perkData);
    const moduleState = useGameStore(st => st.moduleState);
    const activePreset = useGameStore(st => st.activePreset);

    const modBonuses = readActiveModuleBonuses(moduleState, perkData, labData, cardData);
    const results = calcPermanentUWs(uwData, modBonuses, wsData, labData, cardData, activePreset);
    const gcVal = uniq(modBonuses, 'Galaxy Compressor');

    return (
        <div style={{ padding: '14px' }}>
            {/* ── Intro ── */}
            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-body" style={{ padding: '10px 14px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                        A UW is <strong style={{ color: 'var(--accent)' }}>permanent</strong> when its
                        effective <strong>Duration ≥ effective Cooldown</strong> (cooldown after the
                        Galaxy Compressor reduction). Only duration-based UWs qualify — Chrono Field,
                        Golden Tower, Poison Swamp and Black Hole. The cost shown is the stones to
                        upgrade the Cooldown / Duration stats to reach permanence.
                        <strong> Poison Swamp is not affected by Galaxy Compressor</strong>, so its
                        cooldown relies on the Cooldown stat alone.
                    </p>
                    <p style={{ fontSize: '13px', marginTop: '6px', color: gcVal > 0 ? 'var(--gold)' : 'var(--text-dim)' }}>
                        Galaxy Compressor: {gcVal > 0
                            ? `equipped (−${gcVal}s per recovery package)`
                            : 'not equipped — cooldowns are not reduced'}
                    </p>
                </div>
            </div>

            {/* ── UW cards ── */}
            <div className="puw-grid">
                {results.map(r => {
                    const statusClass = !r.owned ? 'not-owned' : r.isPermanent ? 'permanent' : 'pending';
                    const statusText = !r.owned ? '✗ Not Owned' : r.isPermanent ? '✓ Permanent' : 'Not Permanent';

                    return (
                        <div key={r.abbr} className={`puw-card ${statusClass}`}>
                            <div className="puw-head">
                                <span className="puw-name">{r.name}</span>
                                <span className="puw-abbr">{r.abbr}</span>
                                <span className={`puw-status ${statusClass}`}>{statusText}</span>
                            </div>

                            {!r.owned ? (
                                <div className="puw-body puw-dim">Unlock this UW to evaluate permanence.</div>
                            ) : (
                                <div className="puw-body">
                                    {/* Current numbers */}
                                    <div className="puw-stats">
                                        <div><span className="puw-k">Duration</span><span className="puw-v">{s(r.duration)}s</span></div>
                                        <div><span className="puw-k">Cooldown</span><span className="puw-v">{s(r.rawCD)}s</span></div>
                                        <div>
                                            <span className="puw-k">GComp</span>
                                            <span className="puw-v" style={{ color: r.gcompApplies ? undefined : 'var(--text-dim)' }}>
                                                {r.gcompApplies ? `−${s(r.gcompReduction)}s` : 'N/A'}
                                            </span>
                                        </div>
                                        <div><span className="puw-k">Eff. CD</span><span className="puw-v" style={{ color: r.isPermanent ? 'var(--gold)' : 'var(--accent)' }}>{s(r.effCD)}s</span></div>
                                    </div>

                                    {r.isPermanent ? (
                                        <div className="puw-permanent">✓ Permanently active — duration ({s(r.duration)}s) ≥ effective cooldown ({s(r.effCD)}s).</div>
                                    ) : r.plan?.achievable ? (
                                        <div className="puw-plan">
                                            <div className="puw-plan-title">To make permanent:</div>
                                            <ul className="puw-plan-list">
                                                {r.plan.cdTo > r.plan.cdFrom && (
                                                    <li>
                                                        Cooldown <strong>Lv {r.plan.cdFrom} → {r.plan.cdTo}</strong>
                                                        <span className="puw-cost">{r.plan.cdCost.toLocaleString()}<img src={stoneIcon} alt="stones" className="cost-icon" /></span>
                                                    </li>
                                                )}
                                                {r.plan.durTo > r.plan.durFrom && (
                                                    <li>
                                                        Duration <strong>Lv {r.plan.durFrom} → {r.plan.durTo}</strong>
                                                        <span className="puw-cost">{r.plan.durCost.toLocaleString()}<img src={stoneIcon} alt="stones" className="cost-icon" /></span>
                                                    </li>
                                                )}
                                            </ul>
                                            <div className="puw-total">
                                                <span>Total</span>
                                                <span className="puw-cost puw-total-cost">
                                                    {r.plan.totalCost.toLocaleString()}<img src={stoneIcon} alt="stones" className="cost-icon" />
                                                </span>
                                            </div>
                                            <div className="puw-result">
                                                → Duration {s(r.plan.resultDuration)}s ≥ Eff. CD {s(r.plan.resultEffCD)}s
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="puw-impossible">
                                            ⚠ Not reachable with current Galaxy Compressor / perks / labs.
                                            Even maxed: max duration {s(r.maxDuration)}s &lt; min effective CD {s(r.minEffCD)}s.
                                            Equip / upgrade Galaxy Compressor or add duration sources (perk, lab, module sub-effect).
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
