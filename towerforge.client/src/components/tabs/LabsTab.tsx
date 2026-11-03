// ============================================================
//  TowerForge Companion — Labs Tab
//  179 labs across 11 categories with search and lock state, the labs
//  being researched at the last import (29.1.3+ exports), and the Elite
//  Cell boosts the player's runs keep up (LabBoostPanel).
// ============================================================

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { LABS } from '../../constants/gameData';
import NumericInput from '../common/NumericInput';
import { labOpen, labsOpen } from '../../engine/unlocks';
import type { LabRunning } from '../../types/gameTypes';
import { labFinishAt, labTimerLeft } from '../../engine/labTimer';
import { boostSettings, boostsForLabs, cellIncome, planLabBoosts } from '../../engine/labBoosts';
import LabBoostPanel from './LabBoostPanel';

const span = (sec: number) => {
    const m = Math.max(0, Math.round(sec / 60));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${min}m` : `${min}m`;
};

// The labs the game was researching when it exported, with the level
// being researched. The finish is the game's ResearchCompleteDate (normal
// speed) brought forward by the speed-up (engine/labTimer.ts); the game's
// own timer counts normal-speed time, so it reads longer while a speed-up
// runs — shown too, to match the Labs screen. With the Lab boosts plan,
// each lab's finish at its boost kept up (the fastest on the longest).
function LabsRunning({ labs, speeds }: { labs: LabRunning[]; speeds: number[] }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(t);
    }, []);
    const left = labs.map(r => labTimerLeft(r, now) ?? 0);
    const boosts = boostsForLabs(left, speeds);
    return (
        <div className="section" style={{ marginBottom: '10px' }}>
            <div className="section-head">
                <h3>Researching</h3>
                <span className="s-badge">at your last import</span>
            </div>
            <div className="section-body">
                {labs.map((r, i) => (
                    <div key={i} className="field-row lab-run">
                        <label className="field-label">
                            {r.lab ?? `Lab #${r.labIndex}`}{r.toLevel ? ` → Lv ${r.toLevel}` : ''}
                            {r.speedUp > 1 && r.speedUpLeftSec > 0 && (
                                <span className="field-sub">
                                    ×{r.speedUp} speed-up, {span(r.speedUpLeftSec)} left when exported
                                    {(labTimerLeft(r, now) ?? 0) > 0 && ` · game timer about ${span(labTimerLeft(r, now)!)}`}
                                </span>
                            )}
                        </label>
                        <span className="lab-run-time">
                            {(() => {
                                const done = labFinishAt(r);
                                if (done === null) return '—';
                                if (done <= now) return 'Done — collect it in the game';
                                const when = new Date(done).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                                return `Done in ${span((done - now) / 1000)} · ${when}`;
                            })()}
                            {boosts[i] > 1 && left[i] > 0 && (
                                <span className="lab-run-boost">At ×{boosts[i]} kept up: {span(left[i] / boosts[i])}</span>
                            )}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function LabsTab() {
    const [search, setSearch] = useState('');
    const profile = useGameStore(s => s.profile);
    const labData = useGameStore(s => s.labData);
    const tierWaves = useGameStore(s => s.tierWaves);
    const setLabLevel = useGameStore(s => s.setLabLevel);
    const setAllLabs = useGameStore(s => s.setAllLabs);
    const labsRunning = useGameStore(s => s.labsRunning);
    const labProgress = useGameStore(s => s.labProgress);
    const importedBattles = useGameStore(s => s.importedBattles);
    const cellsHeld = useGameStore(s => s.currencies.cells ?? 0);
    const relicData = useGameStore(s => s.relicData);
    const updateProfile = useGameStore(s => s.updateProfile);

    // Elite Cell boosts: what the runs earn, spread evenly over the lab slots.
    const income = useMemo(() => cellIncome(importedBattles), [importedBattles]);
    const settings = boostSettings(profile, income, labsRunning.length);
    const plan = useMemo(() => planLabBoosts(settings.budget, settings.slots), [settings.budget, settings.slots]);

    const completedTier = profile.completedTier || 0;

    // A lab is open once the Labs are (Tier 1, wave 30) and its own milestone
    // is reached, or it has levels (engine/unlocks.ts — the Optimizer's rule too).
    const progress = useMemo(() => ({ tierWaves, completedTier }), [tierWaves, completedTier]);
    const ilmOwned = useGameStore(s => !!s.uwData.data.ILM?.own);
    const isUnlocked = useCallback(
        (labName: string): boolean => labOpen(labName, labData[labName] ?? 0, progress, ilmOwned),
        [labData, progress, ilmOwned],
    );

    // Max all unlocked labs
    function maxAllUnlocked() {
        const next = { ...labData };
        for (const group of LABS) {
            for (const [labName, maxLv] of group.l) {
                if (isUnlocked(labName)) {
                    next[labName] = maxLv;
                }
            }
        }
        setAllLabs(next);
    }

    function clearAll() {
        setAllLabs({});
    }

    // Labs that can still be researched, for "How long a lab takes".
    const openLabs = useMemo(
        () => LABS.flatMap(g => g.l.filter(([n, max]) => isUnlocked(n) && (labData[n] ?? 0) < max).map(([n]) => n)),
        [labData, isUnlocked],
    );

    // Summary counts
    const { totalLabs, doneLabs } = useMemo(() => {
        let total = 0;
        let done = 0;
        for (const group of LABS) {
            for (const [labName, maxLv] of group.l) {
                if (!isUnlocked(labName)) continue;
                total++;
                if ((labData[labName] ?? 0) >= maxLv) done++;
            }
        }
        return { totalLabs: total, doneLabs: done };
    }, [labData, isUnlocked]);

    // Filtered groups based on search
    const filteredGroups = useMemo(() => {
        const q = search.toLowerCase();
        if (!q) return LABS;
        return LABS.map(group => ({
            ...group,
            l: group.l.filter(([labName]) => labName.toLowerCase().includes(q)),
        })).filter(group => group.l.length > 0);
    }, [search]);

    return (
        <div>
            {!labsOpen(progress) && (
                <div className="relics-note">
                    🔒 <strong>The Labs open at Tier 1, wave 30</strong> (a milestone). Reach it in a run, then
                    import again — each lab below opens at its own milestone after that.
                </div>
            )}

            {/* ── Search + Actions ── */}
            <input
                type="text"
                className="search-bar"
                placeholder="🔍  Search labs..."
                value={search}
                onChange={e => setSearch(e.target.value)}
            />

            <div className="flex-row" style={{ marginBottom: '12px' }}>
                <button className="btn btn-gold" onClick={maxAllUnlocked}>
                    ⚡ Max All Unlocked
                </button>
                <button className="btn btn-dim" onClick={clearAll}>
                    Clear All
                </button>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
                    {doneLabs} / {totalLabs} maxed
                </span>
            </div>

            {labsRunning.length > 0 && <LabsRunning labs={labsRunning} speeds={plan.best.speeds} />}

            {labsOpen(progress) && (
                <LabBoostPanel
                    settings={settings} income={income} plan={plan} profile={profile} cellsHeld={cellsHeld}
                    openLabs={openLabs} defaultLab={labsRunning.find(r => r.lab && openLabs.includes(r.lab))?.lab ?? undefined}
                    labData={labData} labProgress={labProgress} relicData={relicData} onProfile={updateProfile}
                />
            )}

            {/* ── Lab Groups ── */}
            {filteredGroups.filter(group =>
                group.l.some(([n]) => isUnlocked(n)),
            ).map(group => (
                <div key={group.c} className="section" style={{ marginBottom: '10px' }}>
                    <div className="section-head">
                        <h3>{group.c}</h3>
                        <span className="s-badge">
                            {group.l.filter(([n, max]) => isUnlocked(n) && (labData[n] ?? 0) >= max).length}
                            {' / '}
                            {group.l.filter(([n]) => isUnlocked(n)).length} maxed
                        </span>
                    </div>
                    <div className="section-body">
                        {group.l.filter(([n]) => isUnlocked(n)).map(([labName, maxLv, , , isUnlockLab]) => {
                            const curLv = labData[labName] ?? 0;
                            const isMaxed = curLv >= maxLv;
                            const pct = maxLv > 1
                                ? Math.min(100, Math.round((curLv / maxLv) * 100))
                                : curLv > 0 ? 100 : 0;

                            return (
                                <div key={labName} className="field-row">
                                    <label className="field-label">
                                        {labName}
                                        {isUnlockLab && (
                                            <span className="field-sub">Unlock lab</span>
                                        )}
                                    </label>

                                    {isUnlockLab ? (
                                        <input
                                            type="checkbox"
                                            checked={curLv > 0}
                                            onChange={e => setLabLevel(labName, e.target.checked ? 1 : 0)}
                                        />
                                    ) : (
                                        <>
                                                <NumericInput
                                                    value={curLv}
                                                    min={0}
                                                    max={maxLv}
                                                    onChange={v => setLabLevel(labName, v)}
                                                />
                                            <button
                                                className="btn btn-dim"
                                                style={{ fontSize: '12px', padding: '2px 7px' }}
                                                disabled={!isUnlocked || isMaxed}
                                                title={`Max ${labName}`}
                                                onClick={() => setLabLevel(labName, maxLv)}
                                            >
                                                {isMaxed ? '✓' : 'Max'}
                                            </button>
                                            <div className="pbar-wrap">
                                                <div className="pbar">
                                                    <div
                                                        className={`pbar-fill ${isMaxed ? 'gold' : ''}`}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                                <div className="pbar-pct">
                                                    {curLv} / {maxLv}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

        </div>
    );
}