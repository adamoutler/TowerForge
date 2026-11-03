// ============================================================
//  TowerForge Companion — Enemy Stats Tab
//  The in-game Wave Info panel, recreated: every enemy's health,
//  attack, speed and spawn chance for a tier and wave, after level
//  skips, the player's enemy labs and the run's trade-off perks — so
//  it can be checked against the game screen by screen. The first
//  piece of the run simulator (docs/run-simulation.md).
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { activeBattleReport } from '../../engine/battleReport';
import { enemyPanel, NO_ENEMY_PERKS } from '../../engine/enemyStats';
import { runLevelSkips } from '../../engine/runLength';
import type { EnemyPerks, EnemyType } from '../../engine/enemyStats';
import { formatGameNumber } from '../../engine/gameNumbers';
import NumericInput from '../common/NumericInput';
import PageIntro from '../common/PageIntro';

// The trade-off perks that change enemies, in the game's words.
const PERKS: [keyof EnemyPerks, string][] = [
    ['enemyHealth', 'Enemies Have -50% Health, but Tower Health Regen and Lifesteal -90%'],
    ['enemySpeed', 'Enemies Speed -40%, but Enemies Damage x2.5'],
    ['enemyDamage', 'Enemies Damage -50%, but Tower Damage -50%'],
    ['rangedDamage', 'Ranged Enemies Attack Distance Reduced, but Ranged Enemies Damage x3'],
    ['bossHealthDown', 'Boss Health -70%, but Boss Speed +50%'],
    ['bossHealthUp', 'x1.50 Tower Damage, but Bosses Have 8x Health'],
];

// Shape and colour of each enemy's marker, as on the in-game panel.
const MARKER: Record<EnemyType, string> = {
    Basic: 'sq basic', Fast: 'sq fast', Tank: 'sq tank', Ranged: 'sq ranged', Boss: 'sq boss',
    Protector: 'sq protector', Vampire: 'tri vampire', Scatter: 'tri scatter', Ray: 'tri ray',
    Saboteur: 'pent saboteur', Commander: 'pent commander', Overcharge: 'pent overcharge',
};

interface PanelInputs {
    tier: number;
    wave: number;
    healthSkips: number;
    attackSkips: number;
    perks: EnemyPerks;
}

const STORAGE_KEY = 'tc_enemy_panel';   // the last inputs, per browser

function loadInputs(fallbackTier: number): PanelInputs {
    const blank = { tier: fallbackTier || 1, wave: 1000, healthSkips: 0, attackSkips: 0, perks: NO_ENEMY_PERKS };
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        return saved ? { ...blank, ...saved, perks: { ...NO_ENEMY_PERKS, ...saved.perks } } : blank;
    } catch {
        return blank;
    }
}

const fmt = (n: number) => (n === 0 ? '0' : formatGameNumber(n));
const pct = (n: number) => `${n % 1 === 0 ? n : n.toFixed(2)}%`;

export default function EnemyStatsTab() {
    const highestTier = useGameStore(s => s.profile.highestTier);
    const labs = useGameStore(s => s.labData);
    const battles = useGameStore(s => s.importedBattles);
    const reportText = useGameStore(s => s.battleReportText);
    const choice = useGameStore(s => s.battleReportChoice);
    const [inputs, setInputs] = useState<PanelInputs>(() => loadInputs(highestTier));
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs)); } catch { /* storage unavailable */ }
    }, [inputs]);

    const improveTradeOff = labs['Improve Tradeoff Perks'] ?? 0;
    const panel = useMemo(
        () => enemyPanel({ ...inputs, improveTradeOff, labs }),
        [inputs, improveTradeOff, labs],
    );
    const set = (patch: Partial<PanelInputs>) => setInputs(prev => ({ ...prev, ...patch }));

    // Skips are deterministic, so the last run's skip rate predicts the
    // levels skipped by any wave on that tier.
    const lastRun = activeBattleReport(reportText, battles, choice) ?? battles.at(-1) ?? null;
    const lastSkips = lastRun ? runLevelSkips(lastRun) : null;
    function fillFromRun() {
        if (!lastRun || !lastSkips || lastRun.wave <= 0) return;
        const wave = inputs.tier === lastRun.tier ? inputs.wave : lastRun.wave;
        set({
            tier: lastRun.tier,
            wave,
            healthSkips: Math.floor(wave * lastSkips.health / lastRun.wave),
            attackSkips: Math.floor(wave * lastSkips.attack / lastRun.wave),
        });
        setNote(`From your T${lastRun.tier} run to wave ${lastRun.wave.toLocaleString()}: `
            + `${(100 * lastSkips.health / lastRun.wave).toFixed(1)}% health / `
            + `${(100 * lastSkips.attack / lastRun.wave).toFixed(1)}% attack levels skipped. `
            + 'The game’s own counts (bottom of Wave Info) are exact.');
    }

    return (
        <div>
            <PageIntro title="Wave Info, recreated">
                In a run, tap the wave counter and compare: enter the
                tier, the wave and the two <em>Level Skip</em> numbers from the bottom of that panel, tick the
                trade-off perks you have, and every enemy row should match the game. Your enemy labs come from
                the Labs tab. Tell us any row that doesn&apos;t match — this is the first piece of the run simulator.
            </PageIntro>

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head"><h3>Wave</h3></div>
                <div className="section-body en-inputs">
                    <label className="en-field">
                        <span>Tier</span>
                        <select value={inputs.tier} onChange={e => set({ tier: parseInt(e.target.value) })}>
                            {Array.from({ length: 24 }, (_, i) => i + 1).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </label>
                    <label className="en-field">
                        <span>Wave</span>
                        <NumericInput value={inputs.wave} min={1} step={1} onChange={v => set({ wave: Math.max(1, Math.floor(v)) })} />
                    </label>
                    <label className="en-field">
                        <span>Health levels skipped</span>
                        <NumericInput value={inputs.healthSkips} min={0} step={1} onChange={v => set({ healthSkips: Math.max(0, Math.floor(v)) })} />
                    </label>
                    <label className="en-field">
                        <span>Attack levels skipped</span>
                        <NumericInput value={inputs.attackSkips} min={0} step={1} onChange={v => set({ attackSkips: Math.max(0, Math.floor(v)) })} />
                    </label>
                    {lastRun && lastSkips && (
                        <button className="btn" onClick={fillFromRun}>Estimate skips from my last run</button>
                    )}
                    {note && <p className="en-note">{note}</p>}
                </div>
            </div>

            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-head">
                    <h3>Trade-off perks</h3>
                    <span className="s-badge" title="Improve Trade-Off Perks lab, from your Labs tab">Improve lab {improveTradeOff}</span>
                </div>
                <div className="section-body en-perks">
                    {PERKS.map(([key, label]) => (
                        <label key={key} className="en-perk">
                            <input
                                type="checkbox"
                                checked={inputs.perks[key]}
                                onChange={e => set({ perks: { ...inputs.perks, [key]: e.target.checked } })}
                            />
                            <span>{label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="section">
                <div className="section-head">
                    <h3>Tier {inputs.tier} – Wave {inputs.wave.toLocaleString()}</h3>
                </div>
                <div className="section-body en-table-wrap">
                    <table className="en-table">
                        <thead>
                            <tr><th>Enemy</th><th>Chance</th><th>Health</th><th>Attack</th><th>Speed</th></tr>
                        </thead>
                        <tbody>
                            {panel.rows.map(r => (
                                <tr key={r.type}>
                                    <td><span className={`en-mark ${MARKER[r.type]}`} />{r.type}</td>
                                    <td>
                                        {r.spawn === null ? <span className="en-dim">—</span> : pct(r.spawn)}
                                        {r.secondElite !== undefined && r.secondElite > 0 && r.spawn !== 100 && (
                                            <span className="en-sub">2nd {pct(r.secondElite)}</span>
                                        )}
                                    </td>
                                    <td>{fmt(r.health)}</td>
                                    <td>{fmt(r.attack)}</td>
                                    <td>{r.speed.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="en-note">
                        Enemies use their level, not the wave: health level {panel.healthLevel.toLocaleString()},
                        attack level {panel.attackLevel.toLocaleString()} (wave − levels skipped).
                        Chance for Basic–Protector isn&apos;t confirmed yet (—). Campaign tiers only; tournaments
                        use a different curve. Mass and the wave timers aren&apos;t shown yet.
                    </p>
                </div>
            </div>
        </div>
    );
}
