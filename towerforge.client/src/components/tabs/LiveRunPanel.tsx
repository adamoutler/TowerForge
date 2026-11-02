// ============================================================
//  TowerForge Companion — Run in Progress
//  The run the game was playing when it exported, beside how the player's
//  last finished runs on that tier ended. It's a snapshot: it moves on with
//  each import, which Auto import does by itself (engine/liveRun.ts).
// ============================================================

import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { coinSources } from '../../engine/coinSources';
import { damageLayers } from '../../engine/damageLayers';
import { lastFinishedOn } from '../../engine/gameExport';
import { formatGameNumber } from '../../engine/gameNumbers';
import { LIVE_RUN_MAX_AGE_MS } from '../../engine/liveRun';
import { runLevelSkips } from '../../engine/runLength';
import RunLines from '../common/RunLines';

const big = (n: number): string => (n >= 1e4 ? formatGameNumber(n) : Math.round(n).toLocaleString());
const hours = (sec: number): string => `${(sec / 3600).toFixed(1)} h`;
const pct = (n: number): string => `${Math.round(n * 100)}%`;

function agoText(ms: number): string {
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default function LiveRunPanel() {
    const live = useGameStore(s => s.liveRun);
    const battles = useGameStore(s => s.importedBattles);
    // Set on opening the page: a newer import only reads as "0 min ago", which is right.
    const [now] = useState(() => Date.now());
    const finished = useMemo(() => (live ? lastFinishedOn(battles, live.report.tier) : null), [live, battles]);
    if (!live || now - live.at > LIVE_RUN_MAX_AGE_MS) return null;
    const r = live.report;
    const cells = r.raw?.CellsEarned;
    const lines = coinSources(r);
    const layers = damageLayers(r);
    const skips = runLevelSkips(r);
    const skipPct = (n: number) => `${((n / r.wave) * 100).toFixed(1)}%`;
    const upgrades = live.upgrades ?? [];
    const picks = live.perkPicks;
    const pills: [string, string][] = [
        ['Reached', `T${r.tier} W${r.wave.toLocaleString()}`],
        ['Game time', hours(r.gameTimeSec)],
        ['Real time', hours(r.realTimeSec)],
        ['Coins', big(r.coinsEarned)],
        ['Coins/hour', big(r.coinsPerHour)],
        ...(typeof cells === 'number' ? [['Cells', big(cells)] as [string, string]] : []),
        ['Waves skipped', big(r.wavesSkipped)],
        ['Enemies destroyed', big(r.totalEnemies)],
        ['Perks picked', big(live.perks)],
        ...(skips ? [
            ['Enemy Health Level Skip', skipPct(skips.health)] as [string, string],
            ['Enemy Attack Level Skip', skipPct(skips.attack)] as [string, string],
        ] : []),
    ];
    return (
        <div className="section">
            <div className="section-head">
                <h3>Run in Progress</h3>
                <span className="s-badge">{agoText(now - live.at)}</span>
            </div>
            <div className="section-body">
                <div className="ttt-stats-grid">
                    {pills.map(([label, value]) => (
                        <div key={label} className="stat-pill">
                            <span className="stat-pill-label">{label}</span>
                            <span className="stat-pill-val">{value}</span>
                        </div>
                    ))}
                </div>
                {finished && (
                    <p className="car-note">
                        Your last {finished.runs === 1 ? 'finished run' : `${finished.runs} finished runs`} on T{r.tier} ended around
                        {' '}W{finished.wave.toLocaleString()} with {big(finished.coins)} coins ({big(finished.coinsPerHour)}/hour).
                    </p>
                )}
                {lines && (
                    <p className="car-note">
                        Coins so far: Golden Combo {pct(lines.combo / lines.total)}, Wave Skip {pct(lines.skip / lines.total)}, kill coins {pct(lines.kill / lines.total)}.
                    </p>
                )}
                {layers && layers.defPct !== null && (
                    <p className="car-note">
                        Damage blocked so far: Chrono Field {pct(layers.chrono)}, Chain Thunder {pct(layers.chainThunder)}, Defense % {pct(layers.defPct)}.
                    </p>
                )}
                {upgrades.length > 0 && (
                    <p className="car-note">
                        Raised during this run, mostly by free upgrades: {upgrades.map(u => `${u.stat} ${u.from} → ${u.to}`).join(', ')}.
                    </p>
                )}
                {picks && picks.named.length > 0 && (
                    <p className="car-note">
                        Perks so far: {picks.named.map(p => (p.count > 1 ? `${p.name} (${p.count})` : p.name)).join(', ')}
                        {picks.unnamed > 0 ? `, and ${picks.unnamed} more the file only gives as numbers` : ''}.
                    </p>
                )}
                <RunLines run={r} />
            </div>
        </div>
    );
}
