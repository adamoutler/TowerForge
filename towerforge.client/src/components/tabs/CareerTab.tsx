// ============================================================
//  TowerForge Companion — Career Tab
//  What the game's file says about the whole account: what the player earns
//  between imports, lifetime totals, the game's yearly recap, best coins and
//  cells per tier, modules, research history and records from the saved runs
//  (engine/career.ts).
// ============================================================

import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { formatGameNumber } from '../../engine/gameNumbers';
import { EPIC_PITY_PULLS, GEMS_PER_PULL, incomeSummary, labsByMonth, runRecords } from '../../engine/career';
import type { Career, CareerYear } from '../../engine/career';
import { GAME_LABS, GAME_LEAGUES } from '../../constants/gameExportMaps';

const big = (n: number): string => (n >= 1e4 ? formatGameNumber(n) : Math.round(n).toLocaleString());
const days = (ms: number): string => `${Math.round(ms / 86400000).toLocaleString()} days`;
const dayText = (d: number): string => (d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${d < 10 ? d.toFixed(1) : Math.round(d)} d`);
const dateText = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

type Pill = [string, string];

function Pills({ pills }: { pills: Pill[] }) {
    return (
        <div className="ttt-stats-grid">
            {pills.map(([label, value]) => (
                <div key={label} className="stat-pill">
                    <span className="stat-pill-label">{label}</span>
                    <span className="stat-pill-val">{value}</span>
                </div>
            ))}
        </div>
    );
}

// A list of counts with bars, biggest first.
function Counts({ title, rows }: { title: string; rows: [string, number][] }) {
    const shown = rows.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!shown.length) return null;
    const top = shown[0][1];
    return (
        <div className="car-counts">
            <div className="car-sub">{title}</div>
            {shown.map(([label, v]) => (
                <div key={label} className="car-count">
                    <span className="car-count-label">{label}</span>
                    <span className="car-count-bar"><span style={{ width: `${(v / top) * 100}%` }} /></span>
                    <strong>{big(v)}</strong>
                </div>
            ))}
        </div>
    );
}

function Earned() {
    const log = useGameStore(s => s.incomeLog);
    const income = useMemo(() => incomeSummary(log), [log]);
    if (!income) return null;
    return (
        <div className="section">
            <div className="section-head"><h3>What You Earn</h3></div>
            <div className="section-body">
                <table className="car-table">
                    <thead>
                        <tr>
                            <th>Currency</th>
                            <th>Earned a day</th>
                            <th>Spent a day</th>
                            <th>Last {income.sinceLastDays !== null ? dayText(income.sinceLastDays) : 'import'}</th>
                            <th>All time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {income.rows.map(r => (
                            <tr key={r.key}>
                                <td>{r.label}</td>
                                <td>{r.perDay !== null ? big(r.perDay) : '—'}</td>
                                <td>{r.spentPerDay !== null ? big(r.spentPerDay) : '—'}</td>
                                <td>{r.sinceLast !== null ? big(r.sinceLast) : '—'}</td>
                                <td>{big(r.total)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="car-note">
                    {income.windowDays !== null
                        ? `From the game's own counters, compared between your imports over the last ${dayText(income.windowDays)}. Coins and cells only show what's earned: the game's numbers for them don't add up to what you hold.`
                        : 'Import your game data again later: comparing two imports shows what you earn and spend a day.'}
                </p>
                {income.spentFromRestart && (
                    <p className="car-note">The game restarted its spending counters between these imports, so spending only counts from then on. Import more often for a closer number.</p>
                )}
            </div>
        </div>
    );
}

function Lifetime({ career }: { career: Career }) {
    const t = career.totals;
    const n = (k: string) => t[k] ?? 0;
    const pills: Pill[] = [
        ...(career.started ? [['Playing since', dateText(career.started)] as Pill] : []),
        ['Waves completed', big(n('WavesCompleted'))],
        ['Waves skipped', big(n('WavesSkipped'))],
        ['Enemies destroyed', big(n('EnemiesDestroyed'))],
        ['Damage dealt', big(n('DamageDealt'))],
        ['Upgrades bought', big(n('UpgradesBought'))],
        ...(career.cardsBought !== undefined ? [['Cards bought', big(career.cardsBought)] as Pill] : []),
        ['Free upgrades', big(n('FreeAttackUpgrades') + n('FreeDefenseUpgrades') + n('FreeUtilityUpgrades'))],
        ['Death Defies', big(n('DeathDefyCount'))],
        ['Bot stuns', big(n('StunsByBot'))],
        ['Modules shattered', big(n('ModulesShattered'))],
    ];
    return (
        <div className="section">
            <div className="section-head"><h3>Lifetime</h3></div>
            <div className="section-body">
                <Pills pills={pills} />
                <div className="car-columns">
                    <Counts title="Coins from" rows={[
                        ['Kills', n('CoinsEarnedFromKills')], ['Ad bonus', n('CoinsEarnedFromAdBonus')], ['Golden Bot', n('CoinsByBot')],
                        ['Guardian', n('CoinsByGuardian')], ['Waves', n('CoinsEarnedFromWaves')],
                    ]} />
                    <Counts title="Coins spent on" rows={[
                        ['Enhancements', n('CoinsSpentEnhancements')], ['Labs', n('CoinsSpentOnResearch')], ['Workshop', n('CoinsSpentWorkshop')],
                    ]} />
                    <Counts title="Enemies destroyed" rows={[
                        ['Basic', n('EnemiesDestroyedNormal')], ['Fast', n('EnemiesDestroyedFast')], ['Tank', n('EnemiesDestroyedTank')],
                        ['Ranged', n('EnemiesDestroyedRanged')], ['Boss', n('EnemiesDestroyedBoss')], ['Protector', n('EnemiesDestroyedProtector')],
                    ]} />
                    <Counts title="Damage from" rows={[
                        ['Black Hole', n('DamageByBlackHole')], ['Thorns', n('DamageByThorn')], ['Chain Lightning', n('DamageByChainLightning')],
                        ['Guardian', n('DamageByGuardian')], ['Smart Missiles', n('DamageBySmartMissiles')], ['Poison Swamp', n('DamageBySwamp')],
                        ['Death Wave', n('DamageByDeathWave')], ['Land Mines', n('DamageByLandMines')], ['Bots', n('DamageByBot')],
                    ]} />
                </div>
            </div>
        </div>
    );
}

const ENEMIES: [string, string][] = [
    ['Basic', 'Basic'], ['Fast', 'Fast'], ['Tank', 'Tank'], ['Ranged', 'Ranged'], ['Boss', 'Boss'], ['Protector', 'Protector'],
    ['Vampire', 'Vampire'], ['Ray', 'Ray'], ['Scatter', 'ScatterMain'], ['Scatter split', 'ScatterChild'], ['Saboteur', 'Saboteur'],
    ['Commander', 'Commander'], ['Overcharge', 'Overcharge'],
];

function YearRecap({ year }: { year: CareerYear }) {
    const n = (k: string) => year[k] ?? 0;
    const league = GAME_LEAGUES[n('TournamentHighestLeague')];
    const pills: Pill[] = [
        ['Battles', big(n('GameBattlesStarted'))],
        ['Ended early', big(n('GameBattlesSurrendered'))],
        ['Waves cleared', big(n('GameWavesCleared'))],
        ['Waves skipped', big(n('GameWavesSkippedCard') + n('GameWavesSkippedIS'))],
        ['Game time in battle', days(n('GameTimeInBattle'))],
        ['Tournaments', big(n('TournamentAmount'))],
        ...(n('TournamentAmount') > 0 && league ? [['Best league', league] as Pill] : []),
        ['Promotions', big(n('TournamentPromotionsAmount'))],
        ['Demotions', big(n('TournamentDemotionsAmount'))],
        ['Death Defies', big(n('GameDeathDefyAmount'))],
        ['Second Winds', big(n('GameSecondWindAmount'))],
        ['Demon Modes', big(n('GameDemonModeAmount'))],
        ['Daily missions', big(n('DailyMissionsCompleted'))],
        ['Event missions', big(n('EventMissionsCompleted'))],
        ['Modules earned', big(n('ModulesEarnedAmount'))],
        ['Modules bought', big(n('ModulesBoughtAmount'))],
        ['Modules shattered', big(n('ModulesShattered'))],
        ['Cards pulled', big(n('CardsPulledAmount'))],
    ];
    const uws: [string, string, string][] = [
        ['Chain Lightning', big(n('ChainLightningAmount')), `${big(n('ChainLightningDamage'))} damage`],
        ['Smart Missiles', big(n('SmartMissilesAmount')), `${big(n('SmartMissilsDamage'))} damage`],
        ['Death Wave', big(n('DeathWaveAmount')), `${big(n('DeathWaveDamage'))} damage`],
        ['Inner Land Mines', big(n('InnerLandMinesAmount')), `${big(n('InnerLandMinesDamage'))} damage`],
        ['Poison Swamp', big(n('PoisonSwampAmount')), `${big(n('PoisonSwampDamage'))} damage`],
        ['Black Hole', big(n('BlackHoleAmount')), `${big(n('BlackHoleAffected'))} enemies`],
        ['Chrono Field', big(n('ChronoFieldAmount')), `${days(n('ChronoFieldDuration'))} up`],
        ['Golden Tower', days(n('GoldenTowerDuration')), `${big(n('GoldenTowerCoinAmount'))} coins`],
        ['Spotlight', '—', `${big(n('SpotlightDamage'))} damage`],
    ];
    return (
        <>
            <Pills pills={pills} />
            <div className="car-sub" style={{ marginTop: '14px' }}>Ultimate Weapons</div>
            <table className="car-table">
                <tbody>
                    {uws.map(([name, used, what]) => (
                        <tr key={name}><td>{name}</td><td>{used}</td><td>{what}</td></tr>
                    ))}
                </tbody>
            </table>
            <div className="car-columns">
                <Counts title="Ended by" rows={ENEMIES.map(([label, key]) => [label, n(`DiedTo${key}`)])} />
                <Counts title="Enemies destroyed" rows={ENEMIES.map(([label, key]) => [label, n(`Killed${key}`)])} />
            </div>
        </>
    );
}

function Years({ career }: { career: Career }) {
    const [picked, setPicked] = useState<number | null>(null);
    if (!career.years.length) return null;
    const year = career.years.find(y => y.Year === picked) ?? career.years[career.years.length - 1];
    return (
        <div className="section">
            <div className="section-head">
                <h3>Year in Review</h3>
                <div className="car-years">
                    {career.years.map(y => (
                        <button key={y.Year} className={`btn btn-dim${y.Year === year.Year ? ' active' : ''}`} onClick={() => setPicked(y.Year)}>{y.Year}</button>
                    ))}
                </div>
            </div>
            <div className="section-body"><YearRecap year={year} /></div>
        </div>
    );
}

function TierBests({ career }: { career: Career }) {
    const tierWaves = useGameStore(s => s.tierWaves);
    const tiers = career.tierCoins.map((_, tier) => tier)
        .filter(tier => tier > 0 && ((career.tierCoins[tier] ?? 0) > 0 || (career.tierCells[tier] ?? 0) > 0))
        .reverse();
    if (!tiers.length) return null;
    return (
        <div className="section">
            <div className="section-head"><h3>Best per Tier</h3></div>
            <div className="section-body">
                <table className="car-table">
                    <thead><tr><th>Tier</th><th>Wave</th><th>Coins</th><th>Cells</th></tr></thead>
                    <tbody>
                        {tiers.map(tier => (
                            <tr key={tier}>
                                <td>T{tier}</td>
                                <td>{tierWaves[tier] ? tierWaves[tier].toLocaleString() : '—'}</td>
                                <td>{big(career.tierCoins[tier] ?? 0)}</td>
                                <td>{big(career.tierCells[tier] ?? 0)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="car-note">The most in one run on each tier, as the game keeps them.</p>
            </div>
        </div>
    );
}

function Modules({ career }: { career: Career }) {
    const m = career.modules;
    if (!m) return null;
    const left = Math.max(0, EPIC_PITY_PULLS - m.epicPity);
    return (
        <div className="section">
            <div className="section-head"><h3>Modules</h3></div>
            <div className="section-body">
                <Pills pills={[
                    ['Epic pity', `${m.epicPity} of ${EPIC_PITY_PULLS} pulls`],
                    ['To a sure Epic', `${(left * GEMS_PER_PULL).toLocaleString()} gems`],
                    ['Common pulled', big(m.common)],
                    ['Rare pulled', big(m.rare)],
                    ['Epic pulled', big(m.epic)],
                    ['Gems on modules', big(career.totals.GemsSpentOnModules ?? 0)],
                    ['Rerolls', big(m.rerolls)],
                    ['Most on one module', big(m.mostRerolled)],
                    ['Reroll Shards earned', big(m.rerollShards)],
                    ['Slot coins', big(m.slotCoins)],
                    ['Slot shards', big(m.slotShards)],
                ]} />
            </div>
        </div>
    );
}

function Research({ career }: { career: Career }) {
    const months = useMemo(() => labsByMonth(career.labs), [career.labs]);
    if (!career.labs.length) return null;
    const recent = months.slice(-12);
    const top = Math.max(...recent.map(([, v]) => v));
    const latest = career.labs.slice(-10).reverse();
    return (
        <div className="section">
            <div className="section-head"><h3>Research History</h3></div>
            <div className="section-body">
                <Pills pills={[
                    ...(career.researched !== undefined ? [['Levels researched', career.researched.toLocaleString()] as Pill] : []),
                    ['In this history', career.labs.length.toLocaleString()],
                    ['Since', dateText(career.labs[0][0] * 1000)],
                ]} />
                <div className="car-sub" style={{ marginTop: '14px' }}>Levels finished each month</div>
                <div className="car-months">
                    {recent.map(([month, count]) => (
                        <div key={month} className="car-month" title={`${month}: ${count} levels`}>
                            <span className="car-month-count">{count}</span>
                            <span className="car-month-bar" style={{ height: `${(count / top) * 64}px` }} />
                            <span className="car-month-label">{new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'short' })}</span>
                        </div>
                    ))}
                </div>
                <div className="car-sub" style={{ marginTop: '14px' }}>Latest</div>
                <table className="car-table">
                    <tbody>
                        {latest.map(([sec, lab, level]) => (
                            <tr key={`${sec}-${lab}-${level}`}>
                                <td>{GAME_LABS[lab] ?? `Lab ${lab}`}</td>
                                <td>Lv {level}</td>
                                <td>{dateText(sec * 1000)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Records() {
    const battles = useGameStore(s => s.importedBattles);
    const records = useMemo(() => runRecords(battles), [battles]);
    if (!records.length) return null;
    return (
        <div className="section">
            <div className="section-head"><h3>Run Records</h3></div>
            <div className="section-body">
                <table className="car-table">
                    <tbody>
                        {records.map(r => (
                            <tr key={r.label}>
                                <td>{r.label}</td>
                                <td>{big(r.value)}</td>
                                <td>{r.run.tournament ? 'Tournament' : `T${r.run.tier}`} W{r.run.wave.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="car-note">The best among your {battles.length} saved {battles.length === 1 ? 'run' : 'runs'}.</p>
            </div>
        </div>
    );
}

export default function CareerTab() {
    const career = useGameStore(s => s.career);
    if (!career) {
        return (
            <div className="section">
                <div className="section-head"><h3>Career</h3></div>
                <div className="section-body">
                    <p className="car-note">Import your game data to see what you earn a day, your lifetime totals, your year in review, your best coins and cells on each tier, and your research history.</p>
                </div>
            </div>
        );
    }
    return (
        <div>
            <Earned />
            <Lifetime career={career} />
            <Years career={career} />
            <TierBests career={career} />
            <Modules career={career} />
            <Research career={career} />
            <Records />
        </div>
    );
}
