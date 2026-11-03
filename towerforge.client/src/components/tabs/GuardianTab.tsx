// ============================================================
//  TowerForge Companion — Guardian Tab
//  The Guardian (Guild → Guardian) drawn like the game's screen: its
//  presets, the Guardian with its chip slots around it (GuardianBoard),
//  the equipped chips' stats — each level, next cost and Bits to max,
//  and what the chip does in the models (engine/guardian.ts) — and the
//  Chips Inventory. Tap a slot to pick its chip, a chip to see and set
//  it. Filled by Import Game Data; every value can be set by hand.
// ============================================================

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../store/useGameStore';
import type { GuardianData, GuardianPreset } from '../../types/gameTypes';
import { GUARDIAN_MAX_SLOTS, RELEASED_CHIPS, SKIN_COIN_BONUS, statBits } from '../../constants/guardianData';
import type { ChipDef } from '../../constants/guardianData';
import { presetLabel } from '../../constants/gameData';
import {
    activeChips, attackRate, bountyExtra, damageMeterFactor, fetchRate, guardianPreset, summonExtra, withChipLevel,
} from '../../engine/guardian';
import { calcDamageMeter } from '../../engine/towerDamage';
import { calcTowerRange } from '../../engine/ttt';
import { runRatesFrom } from '../../engine/runRates';
import { activeBattleReport, extraDamage, rawField } from '../../engine/battleReport';
import GuardianBoard, { ChipTile } from '../common/GuardianBoard';
import NumericInput from '../common/NumericInput';
import GuardianShareCard from '../share/GuardianShareCard';
import { SHARE_OFFSCREEN_STYLE } from '../share/shareTheme';
import { openExportDialog } from '../share/exportImages';
import PageIntro from '../common/PageIntro';

const fmtX = (v: number) => `×${v < 10 ? v.toFixed(2) : v.toFixed(1)}`;
const pctText = (v: number) => `+${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

// Loot the Guardian fetched in a run, by the battle report's own fields.
const FETCH_FIELDS: [string, string[]][] = [
    ['Gems', ['guardian', 'gems']], ['Medals', ['guardian', 'medals']], ['Reroll Shards', ['guardian', 'reroll']],
    ['Cannon Shards', ['guardian', 'cannon']], ['Armor Shards', ['guardian', 'armor']],
    ['Generator Shards', ['guardian', 'generator']], ['Core Shards', ['guardian', 'core']],
    ['Common Modules', ['guardian', 'common']], ['Rare Modules', ['guardian', 'rare']],
];

export default function GuardianTab() {
    const g = useGameStore(s => s.guardianData);
    const setGuardianData = useGameStore(s => s.setGuardianData);
    const activePreset = useGameStore(s => s.activePreset);
    const profile = useGameStore(s => s.profile);
    const wsData = useGameStore(s => s.wsData);
    const labData = useGameStore(s => s.labData);
    const enhData = useGameStore(s => s.enhData);
    const relicData = useGameStore(s => s.relicData);
    const cardData = useGameStore(s => s.cardData);
    const bits = useGameStore(s => s.currencies.bits);
    const battleReportText = useGameStore(s => s.battleReportText);
    const importedBattles = useGameStore(s => s.importedBattles);
    const battleReportChoice = useGameStore(s => s.battleReportChoice);
    const [slotPick, setSlotPick] = useState<number | null>(null);
    const [chipOpen, setChipOpen] = useState<ChipDef | null>(null);
    const shareRef = useRef<HTMLDivElement>(null);

    const report = useMemo(
        () => activeBattleReport(battleReportText, importedBattles, battleReportChoice),
        [battleReportText, importedBattles, battleReportChoice],
    );
    const killsPerSec = runRatesFrom(report).killsPerSec;
    const dpm = calcDamageMeter(activePreset, wsData, labData, enhData, relicData);
    const range = calcTowerRange(activePreset, wsData, labData, cardData);

    const presetIdx = Math.min(Math.max(0, g.presetFor[activePreset] ?? 0), g.presets.length - 1);
    const preset = guardianPreset(g, activePreset);
    const chips = activeChips(g, activePreset);
    const open = 1 + Math.min(GUARDIAN_MAX_SLOTS - 1, Math.max(0, preset?.extraSlots ?? 0));

    const update = (patch: Partial<GuardianData>) => setGuardianData(patch);
    const updatePreset = (fn: (p: GuardianPreset) => GuardianPreset) =>
        update({ presets: g.presets.map((p, i) => (i === presetIdx ? fn(p) : p)) });
    // A chip sits in one slot only.
    const putChip = (slot: number, chipIndex: number) => updatePreset(p => {
        const next = [...p.chips];
        while (next.length < GUARDIAN_MAX_SLOTS) next.push(-1);
        for (let i = 0; i < next.length; i++) if (chipIndex >= 0 && next[i] === chipIndex) next[i] = -1;
        next[slot] = chipIndex;
        return { ...p, chips: next };
    });
    const levelsOf = (chip: ChipDef) => [0, 1, 2].map(k => Math.min(chip.stats[k].max, preset?.levels[chip.index * 3 + k] ?? 0));

    // What a chip does in the models, at its current levels.
    function effect(chip: ChipDef): string {
        switch (chip.id) {
            case 'scout': {
                const without = damageMeterFactor({ ...g, unlocked: false }, activePreset, dpm, range);
                const withIt = damageMeterFactor(g, activePreset, dpm, range);
                return dpm > 0
                    ? `Tower shots ${fmtX(withIt / without)} on average through Damage/Meter (${fmtX(without)} → ${fmtX(withIt)}).`
                    : 'Works through Damage/Meter, which is 0 on this preset — no effect.';
            }
            case 'bounty':
                return `${pctText(bountyExtra(g, activePreset, killsPerSec))} kill coins (tagged non-Common enemies × its Multiplier).`;
            case 'summon':
                return `${pctText(summonExtra(g, activePreset, killsPerSec))} kills, and their coins. Its Cash Bonus is in-run cash, not counted.`;
            case 'fetch':
                return `${(3600 * fetchRate(g, activePreset)).toFixed(1)} finds per hour of game time; its coins and loot scale with that.`;
            case 'attack': {
                const total = report?.damage?.total ?? 0;
                const share = report && total > 0 ? extraDamage(report).guardian / total : 0;
                const perMin = 60 * 100 * attackRate(g, activePreset);
                const rate = `${perMin.toFixed(perMin < 10 ? 1 : 0)}% of lost health a minute, over its targets`;
                return share > 0
                    ? `Did ${(share * 100).toPrecision(2)}% of the damage in your chosen run. Counted by its rate (${rate}) and by how much health your other damage takes off.`
                    : `Your chosen battle report has no Guardian damage, so Attack can't be scored — choose a run played with Attack equipped (${rate}).`;
            }
            case 'ally':
                return 'Not counted: how its Max Recovery combines with the usual overheal cap isn’t confirmed.';
            default:
                return '';
        }
    }

    // A chip's three stats: level, value, next cost and Bits to max.
    function stats(chip: ChipDef) {
        const levels = levelsOf(chip);
        return (
            <div className="grdg-stats">
                {chip.stats.map((st, k) => {
                    const lv = levels[k];
                    const maxed = lv >= st.max;
                    return (
                        <div key={st.name + k} className={`grdg-stat ${maxed ? 'max' : ''}`}>
                            <span className="grdg-stat-name">{st.name}</span>
                            <span className="grdg-stat-val">{st.fmt(st.value(lv))}</span>
                            <NumericInput value={lv} min={0} max={st.max} className="num-sm"
                                onChange={v => setGuardianData(withChipLevel(g, activePreset, chip.index, k, v))} />
                            <span className="grdg-stat-cost">
                                {maxed ? 'Max' : `Lv ${lv}/${st.max} · next ${st.fmt(st.value(lv + 1))} for ${st.cost(lv + 1)} bits · ${statBits(st, lv, st.max).toLocaleString()} to max`}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    }

    const fetched = report ? FETCH_FIELDS
        .map(([label, words]) => [label, rawField(report, words)] as [string, number | null])
        .filter(([, v]) => (v ?? 0) > 0) : [];
    const hours = report && report.realTimeSec > 0 ? report.realTimeSec / 3600 : 0;
    const toMax = chips.reduce((sum, a) => sum + a.chip.stats.reduce((t, st, k) => t + statBits(st, a.levels[k], st.max), 0), 0);
    const equippedIdx = (preset?.chips ?? []).slice(0, open);

    return (
        <div>
            <div style={SHARE_OFFSCREEN_STYLE} aria-hidden="true">
                <GuardianShareCard ref={shareRef} guardian={g} preset={activePreset} presetName={presetLabel(profile.presetNames, activePreset)} poster />
            </div>

            <PageIntro title="The Guardian">
                The Guardian (Guild → Guardian) fights next to the tower with its equipped chips; each
                chip has three stats bought with Bits. Import Game Data fills this in, by your presets. Here:
                <em> Scout</em> boosts tower shots through Damage/Meter, <em>Attack</em> adds its share of your run&apos;s
                damage, <em>Bounty</em> and <em>Summon</em> add coins, <em>Fetch</em> finds loot — the Optimizer ranks
                their upgrades per Bit.
            </PageIntro>

            {g.unlocked && g.inGuild === false && (
                <p className="en-note grd-warn">
                    Your last import says you weren&apos;t in a guild — the Guardian only fights while you&apos;re in one.
                    The game also says this when your guild hadn&apos;t loaded yet, so if you are in a guild, export again
                    and re-import. The models still count your chips.
                </p>
            )}

            <div className="grdg-bar">
                <label className="grd-check">
                    <input type="checkbox" checked={g.unlocked} onChange={e => update({ unlocked: e.target.checked })} />
                    Guardian unlocked
                </label>
                {g.unlocked && (
                    <label className="grdg-skins">
                        Skins owned
                        <NumericInput value={g.skinsOwned} min={1} max={40} onChange={v => update({ skinsOwned: v })} />
                        <span className="en-sub">{pctText(SKIN_COIN_BONUS * g.skinsOwned)} coins, always on</span>
                    </label>
                )}
                <span style={{ flex: 1 }} />
                {g.unlocked && (
                    <button className="btn btn-accent" onClick={() => openExportDialog(shareRef.current, 'towerforge-guardian', 'Guardian')}>
                        📸 Export Image
                    </button>
                )}
            </div>

            {g.unlocked && preset && (
                <div className="grdg-panel">
                    <div className="grdg-presets">
                        {g.presets.map((p, i) => (
                            <button key={i} className={`grdg-preset ${i === presetIdx ? 'active' : ''}`}
                                onClick={() => update({ presetFor: g.presetFor.map((v, j) => (j === activePreset ? i : v)) })}>
                                {p.name}
                            </button>
                        ))}
                    </div>
                    <p className="grdg-hint">
                        {presetLabel(profile.presetNames, activePreset)} uses the highlighted Guardian preset. Tap a slot to pick its chip.
                    </p>

                    <GuardianBoard chips={equippedIdx} open={open} title={preset.name} sub={`${bits.toLocaleString()} Bits`}
                        onSlot={setSlotPick}
                        onNewSlot={() => updatePreset(p => ({ ...p, extraSlots: Math.min(GUARDIAN_MAX_SLOTS - 1, p.extraSlots + 1) }))} />

                    {chips.length > 0 && (
                        <div className="grdg-equipped">
                            {chips.map(a => (
                                <div key={a.chip.id} className="grdg-chip-card">
                                    <div className="grdg-chip-card-head">
                                        <ChipTile chip={a.chip} />
                                        <span className="grdg-chip-text">{a.chip.text}</span>
                                    </div>
                                    {stats(a.chip)}
                                    <p className="grdg-effect">{effect(a.chip)}</p>
                                </div>
                            ))}
                        </div>
                    )}
                    {chips.length === 0 && <p className="grdg-hint">No chip equipped in this Guardian preset.</p>}

                    <div className="grdg-inv-head">Chips Inventory</div>
                    <div className="grdg-inv">
                        {RELEASED_CHIPS.map(c => (
                            <ChipTile key={c.id} chip={c} owned={!!g.chipsOwned[c.index]}
                                equipped={chips.some(a => a.chip.id === c.id)}
                                note={g.chipsOwned[c.index] ? undefined : 'Not owned'}
                                onClick={() => setChipOpen(c)} />
                        ))}
                    </div>

                    {toMax > 0 && (
                        <p className="grdg-hint">
                            {toMax.toLocaleString()} Bits to max every equipped chip. The Optimizer&apos;s Bits panel ranks which
                            stat to buy next for your goal.
                        </p>
                    )}
                    {fetched.length > 0 && (
                        <p className="grdg-hint">
                            Fetch in your chosen run: {fetched.map(([label, v]) =>
                                `${Math.round(v!).toLocaleString()} ${label}${hours > 0 ? ` (${(v! / hours).toFixed(1)}/h)` : ''}`).join(' · ')}.
                        </p>
                    )}
                </div>
            )}

            {slotPick !== null && preset && createPortal(
                <div className="modal-overlay" onClick={() => setSlotPick(null)}>
                    <div className="modal-box grdg-modal" onClick={e => e.stopPropagation()}>
                        <h3>Slot {slotPick + 1}</h3>
                        <div className="grdg-inv">
                            {RELEASED_CHIPS.filter(c => g.chipsOwned[c.index]).map(c => (
                                <ChipTile key={c.id} chip={c} equipped={equippedIdx[slotPick] === c.index}
                                    onClick={() => { putChip(slotPick, c.index); setSlotPick(null); }} />
                            ))}
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-dim" onClick={() => { putChip(slotPick, -1); setSlotPick(null); }}>Empty this slot</button>
                            {slotPick > 0 && slotPick === open - 1 && (
                                <button className="btn btn-dim" onClick={() => {
                                    putChip(slotPick, -1);
                                    updatePreset(p => ({ ...p, extraSlots: Math.max(0, p.extraSlots - 1) }));
                                    setSlotPick(null);
                                }}>Not bought</button>
                            )}
                            <button className="btn btn-dim" onClick={() => setSlotPick(null)}>Close</button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}

            {chipOpen && preset && createPortal(
                <div className="modal-overlay" onClick={() => setChipOpen(null)}>
                    <div className="modal-box grdg-modal" onClick={e => e.stopPropagation()}>
                        {(() => {
                            const c = chipOpen;
                            const owned = !!g.chipsOwned[c.index];
                            const slot = equippedIdx.indexOf(c.index);
                            const free = equippedIdx.findIndex((v, i) => i < open && (v ?? -1) < 0);
                            const firstFree = free >= 0 ? free : equippedIdx.length < open ? equippedIdx.length : -1;
                            return (
                                <>
                                    <div className="grdg-chip-card-head">
                                        <ChipTile chip={c} owned={owned} equipped={slot >= 0} />
                                        <span className="grdg-chip-text">{c.text}</span>
                                    </div>
                                    <label className="grd-check">
                                        <input type="checkbox" checked={owned}
                                            onChange={e => update({ chipsOwned: g.chipsOwned.map((v, i) => (i === c.index ? e.target.checked : v)) })} />
                                        Owned {c.id === 'attack' || c.id === 'ally' ? '(comes with the Guardian)' : '(Guild Store, Tokens)'}
                                    </label>
                                    {owned && stats(c)}
                                    {owned && slot >= 0 && <p className="grdg-effect">{effect(c)}</p>}
                                    <div className="modal-actions">
                                        {owned && (slot >= 0 ? (
                                            <button className="btn btn-dim" onClick={() => putChip(slot, -1)}>Unequip</button>
                                        ) : (
                                            <button className="btn btn-accent" disabled={firstFree < 0} onClick={() => putChip(firstFree, c.index)}>
                                                {firstFree < 0 ? 'Every slot is full — tap a slot to swap' : `Equip in slot ${firstFree + 1}`}
                                            </button>
                                        ))}
                                        <button className="btn btn-dim" onClick={() => setChipOpen(null)}>Done</button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
