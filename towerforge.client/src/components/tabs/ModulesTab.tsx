// ============================================================
//  TowerForge Companion — Modules Tab
//  Laid out like the game's Modules screen: preset tabs, the tower
//  with its 4 primary and 4 assist slots around it (tap a slot to
//  change its module, level or assist settings), and an inventory
//  of every module to inspect, edit or equip.
//  All module names and sub-effects are predefined from game data.
// ============================================================

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useGameStore } from '../../store/useGameStore';
import type { ModuleEntry, ModuleType, ModuleRarity, Loadout } from '../../types/gameTypes';
import { MODULE_MAX_LEVEL, presetLabel } from '../../constants/gameData';
import NumericInput from '../common/NumericInput';
import ModuleBadge from '../common/ModuleBadge';
import TowerArt from '../common/TowerArt';
import { BOARD } from '../../constants/moduleBoard';
import type { SlotKey } from '../../constants/moduleBoard';
import { RARITIES, moduleMaxLevel, rarityColor, rarityStars } from '../../constants/moduleRarities';
import {
    SUB_RARITIES, UNIQUE_MODULES, SUB_EFFECTS, UNIQUE_EFFECT_MODEL, MAIN_EFFECT_LABELS, RARITY_TIER,
    subEffectValue as getSubEffectValue, uniqueDescription,
} from '../../constants/moduleData';
import type { SubRarity, SubEffectDef } from '../../constants/moduleData';
import { calcModuleDamageMult, primaryMainMult } from '../../engine/towerDamage';
import { activeLoadout, milestoneReached } from '../../engine/statHelpers';
import { assistPart, nextAssistTier } from '../../engine/assistModules';
import type { AssistPart } from '../../engine/assistModules';
import { CurrencyField } from '../common/CurrencyBar';
import ShardIcon from '../common/ShardIcon';
import ShardPlanPanel from './ShardPlanPanel';
import type { Currencies } from '../../types/gameTypes';

// ── Types ─────────────────────────────────────────────────────
const MODULE_TYPES: ModuleType[] = ['cannon', 'armor', 'generator', 'core'];

const TYPE_LABELS: Record<ModuleType, string> = {
    cannon: 'Cannon',
    armor: 'Armor',
    generator: 'Generator',
    core: 'Core',
};


const MAX_PRESETS = 5;

// ── Helpers ───────────────────────────────────────────────────
function genId(): string {
    return Math.random().toString(36).slice(2, 10);
}

function clearSlot(
    slot: { main: string; assist: string },
    id: string,
): { main: string; assist: string } {
    return {
        main: slot.main === id ? '' : slot.main,
        assist: slot.assist === id ? '' : slot.assist,
    };
}

const emptySlots = (): Loadout['slots'] => ({
    cannon: { main: '', assist: '' },
    armor: { main: '', assist: '' },
    generator: { main: '', assist: '' },
    core: { main: '', assist: '' },
});

// Get the rarity index (0=Common, 1=Rare, 2=Epic, 3=Legendary, 4=Mythic, 5=Ancestral)
function getSubRarityIdx(rar: SubRarity): number {
    return SUB_RARITIES.indexOf(rar);
}


// Get available sub-effects for a type at a given rarity
function getAvailableSubEffects(type: ModuleType, rar: SubRarity): SubEffectDef[] {
    const idx = getSubRarityIdx(rar);
    return SUB_EFFECTS[type]?.filter(def => def[2][idx] !== null) ?? [];
}


// Get unique effect value at module rarity
function getUniqueEffectValue(type: ModuleType, name: string, rar: ModuleRarity): string | null {
    const def = UNIQUE_MODULES[type]?.find(([n]) => n === name);
    if (!def) return null;
    const val = def[2][RARITY_TIER[rar] ?? 'Epic'];
    if (val === null || val === undefined) return null;
    return `${val}${def[3]}`;
}


const rarityLabel = (r: ModuleRarity) => RARITIES.find(x => x.k === r)?.label ?? r;
const fmtMult = (v: number) => (v >= 10 ? v.toFixed(2) : v.toFixed(3));

// ── Modal State ───────────────────────────────────────────────
interface SubSlotState {
    effect: string;
    rar: SubRarity;
}

interface ModalState {
    open: boolean;
    editId: string | null;
    type: ModuleType;
    name: string;
    rarity: ModuleRarity;
    mainMult: number;
    subs: SubSlotState[];
}

const defaultSubs = (): SubSlotState[] =>
    Array(8).fill(null).map(() => ({ effect: '', rar: 'Epic' }));

const defaultModal = (): ModalState => ({
    open: false,
    editId: null,
    type: 'cannon',
    name: UNIQUE_MODULES.cannon[0][0],
    rarity: 'E',
    mainMult: 0,
    subs: defaultSubs(),
});

// Assist modules unlock at Tier 19 Wave 40 — until then, each loadout
// slot only supports a single (main) module with no assist sub-slot.
const ASSIST_UNLOCK_TIER = 19;
const ASSIST_UNLOCK_WAVE = 40;


// The game's module currencies (the row above its Inventory / Assist tabs).
const MODULE_CURRENCIES: { key: keyof Currencies; label: string; icon: 'reroll' | ModuleType }[] = [
    { key: 'rerollShards', label: 'Reroll Shards', icon: 'reroll' },
    { key: 'cannonShards', label: 'Cannon Shards', icon: 'cannon' },
    { key: 'armorShards', label: 'Armor Shards', icon: 'armor' },
    { key: 'generatorShards', label: 'Generator Shards', icon: 'generator' },
    { key: 'coreShards', label: 'Core Shards', icon: 'core' },
];

// Shards earned in total — spent and saved — from the game's lifetime
// counts (imported); spent is what was earned less what's saved now.
function ShardTotals({ currencies }: { currencies: Currencies }) {
    const rows = MODULE_CURRENCIES.map(c => {
        const earned = currencies[`${c.key}Lifetime` as keyof Currencies] ?? 0;
        const saved = currencies[c.key] ?? 0;
        return { ...c, earned, saved, spent: Math.max(0, earned - saved) };
    }).filter(r => r.earned > 0);
    if (rows.length === 0) return null;
    const shards = rows.filter(r => r.icon !== 'reroll');
    const all = shards.reduce((t, r) => ({ earned: t.earned + r.earned, saved: t.saved + r.saved, spent: t.spent + r.spent }),
        { earned: 0, saved: 0, spent: 0 });
    const n = (v: number) => Math.round(v).toLocaleString();
    return (
        <details className="modg-totals">
            <summary>
                Shards earned in total: <strong>{n(all.earned)}</strong>
                <span> (spent and saved, all four types)</span>
            </summary>
            <table>
                <thead><tr><th>Shards</th><th>Earned in total</th><th>Saved</th><th>Spent</th></tr></thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={r.key}>
                            <td><span className="modg-totals-name"><ShardIcon kind={r.icon} /> {r.label}</span></td>
                            <td>{n(r.earned)}</td><td>{n(r.saved)}</td><td>{n(r.spent)}</td>
                        </tr>
                    ))}
                    {shards.length > 1 && (
                        <tr className="modg-totals-sum">
                            <td>All module shards</td><td>{n(all.earned)}</td><td>{n(all.saved)}</td><td>{n(all.spent)}</td>
                        </tr>
                    )}
                </tbody>
            </table>
            <p>From the game&apos;s own lifetime counts (Import Game Data). Spent is everything they went on — slot levels and the rest.</p>
        </details>
    );
}

// An assist efficiency: its total, how much is stones and lab, and what
// the next stone level and the rest cost.
function AssistEffRow({ label, part, max, onChange }: {
    label: string; part: AssistPart; max: number; onChange: (v: number) => void;
}) {
    return (
        <div className="modg-assist-eff">
            <div className="field-row">
                <label className="field-label">{label}<span className="field-sub">1–{max}%</span></label>
                <NumericInput value={part.total} min={0} max={max} className="num-sm" onChange={onChange} />
                <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>%</span>
            </div>
            <div className="modg-assist-split">
                1% + stones {part.stones}/{part.maxStones} + lab {part.lab}/30
                <span>
                    {part.next !== null
                        ? `Next +1%: ${part.next.toLocaleString()} stones · ${part.toMax.toLocaleString()} to finish`
                        : 'Stones maxed'}
                </span>
            </div>
        </div>
    );
}

export default function ModulesTab() {
    const [search, setSearch] = useState('');
    const [panel, setPanel] = useState<'inventory' | 'assist' | 'plan'>('inventory');
    const [typeFilter, setTypeFilter] = useState<ModuleType | ''>('');
    const [rarityFilter, setRarityFilter] = useState<'' | 'E' | 'L' | 'M' | 'A'>('');
    const [modal, setModal] = useState<ModalState>(defaultModal());
    const [viewId, setViewId] = useState<string | null>(null);
    const [inspectId, setInspectId] = useState<string | null>(null);
    const [slotEdit, setSlotEdit] = useState<{ type: ModuleType; slot: SlotKey } | null>(null);

    const profile = useGameStore(s => s.profile);
    const activePreset = useGameStore(s => s.activePreset);
    const tierWaves = useGameStore(s => s.tierWaves);
    const moduleState = useGameStore(s => s.moduleState);
    const labData = useGameStore(s => s.labData);
    const setModuleState = useGameStore(s => s.setModuleState);
    const setSlotLevel = useGameStore(s => s.setSlotLevel);
    const updateAssist = useGameStore(s => s.updateAssist);
    const updateAssistRarity = useGameStore(s => s.updateAssistRarity);
    const currencies = useGameStore(s => s.currencies);
    const setCurrency = useGameStore(s => s.setCurrency);

    const { library, loadouts, assistData, slotLevels } = moduleState;
    const equipped = activeLoadout(moduleState);
    const viewed = loadouts.find(l => l.id === viewId) ?? equipped;

    // Assist slots unlock at their Tier / Wave milestone (same rule as labs).
    const assistUnlocked = milestoneReached(ASSIST_UNLOCK_TIER, ASSIST_UNLOCK_WAVE, profile.completedTier || 0, tierWaves);

    const modById = (id: string | undefined) => (id ? library.find(m => m.id === id) ?? null : null);

    // Where a module sits in the equipped loadout, if anywhere.
    function equippedAs(id: string): SlotKey | null {
        if (!equipped) return null;
        for (const t of MODULE_TYPES) {
            if (equipped.slots[t].main === id) return 'main';
            if (equipped.slots[t].assist === id) return 'assist';
        }
        return null;
    }

    // ── Library helpers ───────────────────────────────────────
    function openAdd() {
        const firstType = typeFilter || 'cannon';
        setModal({
            open: true,
            editId: null,
            type: firstType,
            name: UNIQUE_MODULES[firstType][0][0],
            rarity: 'E',
            mainMult: 0,
            subs: defaultSubs(),
        });
    }

    function openEdit(m: ModuleEntry) {
        setInspectId(null);
        setModal({
            open: true,
            editId: m.id,
            type: m.type,
            name: m.name,
            rarity: m.rarity,
            mainMult: m.mainMult ?? 0,
            subs: Array(8).fill(null).map((_, i) => ({
                effect: m.subs?.[i]?.effect ?? '',
                rar: (m.subs?.[i]?.rar as SubRarity) ?? 'Epic',
            })),
        });
    }

    function saveModule() {
        if (!modal.name) return;
        const subs = modal.subs.map(s => ({
            effect: s.effect,
            rar: s.rar,
            val: s.effect ? (getSubEffectValue(modal.type, s.effect, s.rar) ?? '') : '',
        }));

        if (modal.editId) {
            setModuleState({
                library: library.map(m =>
                    m.id === modal.editId
                        ? { ...m, name: modal.name, type: modal.type, rarity: modal.rarity, mainMult: modal.mainMult, subs }
                        : m,
                ),
            });
        } else {
            if (library.find(m => m.name === modal.name)) {
                alert(`"${modal.name}" is already in your library.`);
                return;
            }
            const newMod: ModuleEntry = {
                id: genId(), name: modal.name, type: modal.type,
                rarity: modal.rarity, mainMult: modal.mainMult, subs,
            };
            setModuleState({ library: [...library, newMod] });
        }
        setModal(defaultModal());
    }

    function deleteModule(id: string) {
        if (!confirm('Delete this module?')) return;
        setInspectId(null);
        setModuleState({
            library: library.filter(m => m.id !== id),
            loadouts: loadouts.map(lo => ({
                ...lo,
                slots: {
                    cannon: clearSlot(lo.slots.cannon, id),
                    armor: clearSlot(lo.slots.armor, id),
                    generator: clearSlot(lo.slots.generator, id),
                    core: clearSlot(lo.slots.core, id),
                },
            })),
        });
    }

    // ── Modal helpers ─────────────────────────────────────────
    function onModalTypeChange(type: ModuleType) {
        setModal(m => ({
            ...m,
            type,
            name: UNIQUE_MODULES[type][0][0],
            subs: defaultSubs(),
        }));
    }

    function onModalSubEffectChange(slotIdx: number, effect: string) {
        setModal(m => {
            const subs = [...m.subs];
            subs[slotIdx] = { ...subs[slotIdx], effect };
            return { ...m, subs };
        });
    }

    function onModalSubRarityChange(slotIdx: number, rar: SubRarity) {
        setModal(m => {
            const subs = [...m.subs];
            subs[slotIdx] = { ...subs[slotIdx], rar };
            return { ...m, subs };
        });
    }

    // ── Preset helpers ────────────────────────────────────────
    function addPreset() {
        const lo: Loadout = { id: genId(), name: `Preset ${loadouts.length + 1}`, slots: emptySlots() };
        setModuleState({
            loadouts: [...loadouts, lo],
            ...(loadouts.length === 0 ? { activeLoadout: lo.id } : {}),
        });
        setViewId(lo.id);
    }

    function deletePreset(id: string) {
        if (!confirm('Delete this preset?')) return;
        const rest = loadouts.filter(l => l.id !== id);
        setModuleState({
            loadouts: rest,
            ...(moduleState.activeLoadout === id ? { activeLoadout: rest[0]?.id } : {}),
        });
        setViewId(null);
    }

    function renamePreset(id: string, name: string) {
        setModuleState({ loadouts: loadouts.map(l => (l.id === id ? { ...l, name } : l)) });
    }

    // Put a module in a slot of the viewed preset ('' empties it). A module
    // can't sit in both slots of its type.
    function setSlot(type: ModuleType, slot: SlotKey, modId: string) {
        if (!viewed) return;
        setModuleState({
            loadouts: loadouts.map(lo => {
                if (lo.id !== viewed.id) return lo;
                const cur = lo.slots[type];
                const other: SlotKey = slot === 'main' ? 'assist' : 'main';
                const next = { ...cur, [slot]: modId };
                if (modId && cur[other] === modId) next[other] = '';
                return { ...lo, slots: { ...lo.slots, [type]: next } };
            }),
        });
    }

    // ── Inventory ─────────────────────────────────────────────
    const q = search.toLowerCase();
    const inventory = library
        .filter(m => !typeFilter || m.type === typeFilter)
        .filter(m => !rarityFilter || m.rarity.startsWith(rarityFilter))
        .filter(m => !q || m.name.toLowerCase().includes(q))
        .sort((a, b) => MODULE_TYPES.indexOf(a.type) - MODULE_TYPES.indexOf(b.type)
            || RARITIES.findIndex(r => r.k === b.rarity) - RARITIES.findIndex(r => r.k === a.rarity)
            || a.name.localeCompare(b.name));

    const inspected = modById(inspectId ?? undefined);
    const slotEditMod = slotEdit && viewed ? modById(viewed.slots[slotEdit.type][slotEdit.slot]) : null;

    // Current unique effect value for modal preview
    const uniqueEffectVal = modal.name
        ? getUniqueEffectValue(modal.type, modal.name, modal.rarity)
        : null;

    // ── Board slot ────────────────────────────────────────────
    function renderSlot(type: ModuleType, slot: SlotKey) {
        const isAssist = slot === 'assist';
        if (isAssist && !assistUnlocked) return <span key={`${type}-${slot}`} className="modg-slot small" />;
        const mod = viewed ? modById(viewed.slots[type][slot]) : null;
        const slotLv = slotLevels?.[type]?.[slot] ?? 0;
        const cap = mod ? moduleMaxLevel(mod.rarity) : Infinity;
        const capped = slotLv > cap;
        return (
            <button
                key={`${type}-${slot}`}
                className={`modg-slot ${isAssist ? 'small' : 'big'}`}
                onClick={() => setSlotEdit({ type, slot })}
                title={`${TYPE_LABELS[type]} ${isAssist ? 'assist' : 'primary'}${mod ? ` — ${mod.name}` : ' — empty'}`}
            >
                <ModuleBadge type={type} module={mod} size={isAssist ? 'var(--slot-small)' : 'var(--slot-big)'} />
                <span className={`modg-slot-lv ${capped ? 'capped' : ''}`}>
                    Lv.{capped ? cap : slotLv}
                </span>
            </button>
        );
    }

    return (
        <div>
            {/* ══════════════════════════════════════
          LOADOUT BOARD
      ══════════════════════════════════════ */}
            <div className="modg-panel">
                <div className="modg-presets">
                    {loadouts.map(lo => (
                        <button
                            key={lo.id}
                            className={`modg-preset ${viewed?.id === lo.id ? 'viewing' : ''} ${equipped?.id === lo.id ? 'equipped' : ''}`}
                            onClick={() => setViewId(lo.id)}
                            title={equipped?.id === lo.id ? 'Equipped — the calculations use this preset' : 'Tap to view'}
                        >
                            {lo.name || 'Preset'}
                        </button>
                    ))}
                    {loadouts.length < MAX_PRESETS && (
                        <button className="modg-preset add" onClick={addPreset} title="New preset">+</button>
                    )}
                </div>

                {viewed ? (
                    <>
                        <div className="modg-preset-bar">
                            <input
                                className="modg-preset-name"
                                value={viewed.name}
                                onChange={e => renamePreset(viewed.id, e.target.value)}
                                placeholder="Preset name"
                            />
                            {equipped?.id === viewed.id ? (
                                <span className="modg-equipped-tag">
                                    ✓ Equipped{moduleState.loadoutFor && ` in ${presetLabel(profile.presetNames, activePreset)}`}
                                </span>
                            ) : (
                                <button className="btn btn-accent" style={{ fontSize: '13px', padding: '3px 10px' }}
                                    onClick={() => setModuleState({
                                        activeLoadout: viewed.id,
                                        // Equipping changes what this preset uses.
                                        ...(moduleState.loadoutFor
                                            ? { loadoutFor: moduleState.loadoutFor.map((id, i) => (i === activePreset ? viewed.id : id)) }
                                            : {}),
                                    })}>
                                    Equip
                                </button>
                            )}
                            <button className="btn btn-danger" style={{ fontSize: '12px', padding: '3px 8px' }}
                                onClick={() => deletePreset(viewed.id)}>✕</button>
                        </div>

                        <div className="modg-board">
                            <div className="modg-side">
                                <div className="modg-pair">{BOARD[0].map(([t, s]) => renderSlot(t, s))}</div>
                                <div className="modg-pair">{BOARD[2].map(([t, s]) => renderSlot(t, s))}</div>
                            </div>
                            <TowerArt />
                            <div className="modg-side">
                                <div className="modg-pair">{BOARD[1].map(([t, s]) => renderSlot(t, s))}</div>
                                <div className="modg-pair">{BOARD[3].map(([t, s]) => renderSlot(t, s))}</div>
                            </div>
                        </div>
                        <p className="modg-hint">
                            Tap a slot to change its module or level{assistUnlocked ? ', or the assist settings' : ''}.
                            Slot levels are shared by every preset, like in game.
                            {moduleState.loadoutFor && ' Your game’s Global Presets say which modules each preset uses, so switching preset on another page switches these too.'}
                            {!assistUnlocked && ` Assist slots unlock at Tier ${ASSIST_UNLOCK_TIER} Wave ${ASSIST_UNLOCK_WAVE}.`}
                        </p>
                    </>
                ) : (
                    <div className="empty-state" style={{ padding: '20px' }}>
                        <h3>No presets yet</h3>
                        <p>Tap + to make one, or use Import Game Data.</p>
                    </div>
                )}
            </div>

            {/* ══════════════════════════════════════
          MODULE CURRENCIES, then Inventory / Assist (like the game)
      ══════════════════════════════════════ */}
            <div className="modg-currencies">
                {MODULE_CURRENCIES.map(c => (
                    <label key={c.key} className="modg-cur" title={`${c.label} — click to edit`}>
                        <ShardIcon kind={c.icon} />
                        <CurrencyField label={c.label} value={currencies[c.key] ?? 0} onCommit={n => setCurrency(c.key, n)} />
                    </label>
                ))}
            </div>
            <ShardTotals currencies={currencies} />
            <div className="modg-tabs" role="tablist">
                <button role="tab" aria-selected={panel === 'inventory'} className={`modg-tab ${panel === 'inventory' ? 'active' : ''}`}
                    onClick={() => setPanel('inventory')}>Inventory</button>
                <button role="tab" aria-selected={panel === 'assist'} className={`modg-tab ${panel === 'assist' ? 'active' : ''}`}
                    onClick={() => setPanel('assist')}>Assist</button>
                <button role="tab" aria-selected={panel === 'plan'} className={`modg-tab ${panel === 'plan' ? 'active' : ''}`}
                    onClick={() => setPanel('plan')}>Shard plan</button>
            </div>

            {/* What each type's saved shards level best (main vs assist) */}
            {panel === 'plan' && <ShardPlanPanel moduleState={moduleState} labData={labData} currencies={currencies} />}

            {/* ══════════════════════════════════════
          ASSIST — each type's assist slot and its stone upgrades
      ══════════════════════════════════════ */}
            {panel === 'assist' && (
                <div className="modg-panel">
                    <div className="modg-inv-head">
                        <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
                            You have {(currencies.stones ?? 0).toLocaleString()} stones
                        </span>
                    </div>
                    {!assistUnlocked ? (
                        <p className="modg-hint">Assist slots unlock at Tier {ASSIST_UNLOCK_TIER} Wave {ASSIST_UNLOCK_WAVE}.</p>
                    ) : (
                        <div className="modg-assist-grid">
                            {MODULE_TYPES.map(type => {
                                const ad = assistData[type] ?? { rarity: 'locked' as const, multEff: 0, subEff: 0 };
                                const mod = modById(equipped?.slots[type].assist);
                                const tier = nextAssistTier(ad.rarity);
                                return (
                                    <div key={type} className="modg-assist-card">
                                        <div className="modg-assist-head">
                                            <button className="modg-assist-mod" onClick={() => setSlotEdit({ type, slot: 'assist' })}
                                                title="Change the assist module or its slot level">
                                                <ModuleBadge type={type} module={mod} size={46} />
                                            </button>
                                            <div className="modg-assist-title">
                                                <strong>{TYPE_LABELS[type]} assist</strong>
                                                <span style={mod ? { color: rarityColor(mod.rarity) } : undefined}>
                                                    {mod ? `${mod.name} · ${rarityLabel(mod.rarity)}` : 'No module equipped'}
                                                </span>
                                            </div>
                                            <span className="modg-assist-lv">Lv.{slotLevels?.[type]?.assist ?? 0}</span>
                                        </div>
                                        <div className="field-row">
                                            <label className="field-label">Unique effect tier</label>
                                            <select value={ad.rarity}
                                                onChange={e => updateAssistRarity(type, e.target.value as typeof ad.rarity)}>
                                                <option value="locked">Locked</option>
                                                <option value="Epic">Epic</option>
                                                <option value="Legendary">Legendary</option>
                                                <option value="Mythic">Mythic</option>
                                                <option value="Ancestral">Ancestral</option>
                                            </select>
                                        </div>
                                        <div className="modg-assist-split">
                                            <span>
                                                {tier
                                                    ? `${ad.rarity === 'locked' ? 'Unlock' : `Next: ${tier.tier}`} · ${tier.cost.toLocaleString()} stones`
                                                    : 'Highest tier'}
                                            </span>
                                        </div>
                                        {ad.rarity !== 'locked' && (
                                            <>
                                                <AssistEffRow label="Main effect" max={130}
                                                    part={assistPart(type, 'multEff', ad.multEff ?? 0, labData)}
                                                    onChange={v => updateAssist(type, 'multEff', v)} />
                                                <AssistEffRow label="Substats" max={100}
                                                    part={assistPart(type, 'subEff', ad.subEff ?? 0, labData)}
                                                    onChange={v => updateAssist(type, 'subEff', v)} />
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <p className="modg-hint">
                        Stones raise the Main effect to 100% and Substats to 70%; each type&apos;s Assist lab adds up
                        to 30% more. Tap a module to change it or its slot level.
                    </p>
                </div>
            )}

            {/* ══════════════════════════════════════
          INVENTORY
      ══════════════════════════════════════ */}
            {panel === 'inventory' && <div className="modg-panel">
                <div className="modg-inv-head">
                    <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>{library.length} modules</span>
                    <span style={{ flex: 1 }} />
                    <button className="btn btn-accent" onClick={openAdd}>+ Add Module</button>
                </div>
                <div className="modg-filters">
                    <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as ModuleType | '')}>
                        <option value="">All Types</option>
                        {MODULE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                    </select>
                    <select value={rarityFilter} onChange={e => setRarityFilter(e.target.value as typeof rarityFilter)}>
                        <option value="">All Rarities</option>
                        <option value="E">Epic</option>
                        <option value="L">Legendary</option>
                        <option value="M">Mythic</option>
                        <option value="A">Ancestral</option>
                    </select>
                    <input
                        type="text"
                        className="search-bar"
                        style={{ margin: 0, flex: 1, minWidth: '120px' }}
                        placeholder="🔍  Search..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                {library.length === 0 ? (
                    <div className="empty-state">
                        <div className="icon">📦</div>
                        <h3>No modules yet</h3>
                        <p>Use Import Game Data, or “+ Add Module” to build your inventory.</p>
                    </div>
                ) : (
                    <div className="modg-inv-grid">
                        {inventory.map(m => {
                            const where = equippedAs(m.id);
                            const stars = rarityStars(m.rarity);
                            return (
                                <button key={m.id} className="modg-inv-item" onClick={() => setInspectId(m.id)}
                                    title={`${m.name} — ${rarityLabel(m.rarity)}`}>
                                    <ModuleBadge type={m.type} module={m} size="var(--inv-badge)" />
                                    {where && <span className={`modg-inv-tag ${where}`}>{where === 'main' ? 'P' : 'A'}</span>}
                                    {stars > 0 && <span className="modg-inv-stars">{'★'.repeat(stars)}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>}

            {/* ══════════════════════════════════════
          INSPECT — the module's card, like in game
      ══════════════════════════════════════ */}
            {inspected && createPortal(
                <div className="modal-overlay" onClick={() => setInspectId(null)}>
                    <div className="modal-box modg-card" onClick={e => e.stopPropagation()}>
                        {(() => {
                            const m = inspected;
                            const where = equippedAs(m.id);
                            const lvl = slotLevels?.[m.type]?.[where ?? 'main'] ?? 0;
                            const cap = moduleMaxLevel(m.rarity);
                            const color = rarityColor(m.rarity);
                            const stars = rarityStars(m.rarity);
                            const desc = uniqueDescription(m.type, m.name, m.rarity);
                            const model = UNIQUE_EFFECT_MODEL[m.name];
                            // The ×value the calculations use, like the in-game card: a primary
                            // module with its efficiency lab, an assist at its Mult Efficiency.
                            const ad = assistData[m.type];
                            const shown = where === 'main'
                                ? primaryMainMult(m, lvl, m.type, labData)
                                : where === 'assist' && ad && ad.rarity !== 'locked'
                                    ? 1 + (calcModuleDamageMult(m, lvl) - 1) * Math.min(1.3, (ad.multEff ?? 0) / 100)
                                    : calcModuleDamageMult(m, lvl);
                            return (
                                <>
                                    <div className="modg-card-top">
                                        <ModuleBadge type={m.type} module={m} size={120} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div className="modg-card-rarity" style={{ color }}>
                                                {rarityLabel(m.rarity).replace(/ [IV]+$/, '').toUpperCase()}
                                            </div>
                                            {stars > 0 && <div className="modg-card-stars" style={{ color }}>{'★'.repeat(stars)}</div>}
                                            <div className="modg-card-name">{m.name}</div>
                                            <div className="modg-card-main">
                                                <strong style={{ color: 'var(--select)' }}>×{fmtMult(shown)}</strong>
                                                {' '}{MAIN_EFFECT_LABELS[m.type]}
                                            </div>
                                            <div className="modg-card-sub">
                                                {where ? `Equipped: ${where === 'main' ? 'Primary' : 'Assist'}` : 'Not equipped'}
                                                {' · '}Lv. {Math.min(lvl, cap)} /{cap}
                                            </div>
                                        </div>
                                        <button className="btn btn-dim" style={{ fontSize: '12px', alignSelf: 'flex-start' }}
                                            onClick={() => setInspectId(null)}>✕</button>
                                    </div>

                                    {desc && (
                                        <div className="modg-card-unique">
                                            <div className="modg-card-section">Unique Effect</div>
                                            <div className="modg-card-unique-text">{desc}</div>
                                            {model && (
                                                <div className="modg-card-model">
                                                    <strong>{model.counted}</strong> — {model.how}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="modg-card-section">Effects</div>
                                    <div className="modg-card-effects">
                                        {(m.subs ?? []).filter(s => s.effect).map((s, i) => {
                                            const rc = rarityColor((s.rar === 'Common' ? 'C' : s.rar === 'Rare' ? 'R' : s.rar[0]) as ModuleRarity);
                                            const val = getSubEffectValue(m.type, s.effect, s.rar as SubRarity) ?? s.val;
                                            return (
                                                <div key={i} className="modg-effect-row">
                                                    <span className="modg-effect-rar" style={{ color: rc, borderColor: rc }}>{s.rar}</span>
                                                    <span className="modg-effect-text" style={{ color: rc }}>
                                                        {val ? `+${val} ` : ''}{s.effect}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                        {!(m.subs ?? []).some(s => s.effect) && (
                                            <div style={{ fontSize: '13px', color: 'var(--text-dim)' }}>No effects entered.</div>
                                        )}
                                    </div>

                                    <div className="modal-actions" style={{ flexWrap: 'wrap' }}>
                                        <button className="btn btn-danger" onClick={() => deleteModule(m.id)}>Delete</button>
                                        <span style={{ flex: 1 }} />
                                        {viewed && (
                                            <>
                                                <button className="btn btn-dim" onClick={() => { setSlot(m.type, 'main', m.id); setInspectId(null); }}>
                                                    Equip as Primary
                                                </button>
                                                {assistUnlocked && (
                                                    <button className="btn btn-dim" onClick={() => { setSlot(m.type, 'assist', m.id); setInspectId(null); }}>
                                                        Equip as Assist
                                                    </button>
                                                )}
                                            </>
                                        )}
                                        <button className="btn btn-accent" onClick={() => openEdit(m)}>Edit</button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>,
                document.body,
            )}

            {/* ══════════════════════════════════════
          SLOT EDITOR — module, level, assist settings
      ══════════════════════════════════════ */}
            {slotEdit && viewed && createPortal(
                <div className="modal-overlay" onClick={() => setSlotEdit(null)}>
                    <div className="modal-box" onClick={e => e.stopPropagation()}>
                        {(() => {
                            const { type, slot } = slotEdit;
                            const isAssist = slot === 'assist';
                            const other: SlotKey = isAssist ? 'main' : 'assist';
                            const otherId = viewed.slots[type][other];
                            const lv = slotLevels?.[type]?.[slot] ?? 0;
                            const ad = assistData[type] ?? { rarity: 'locked', multEff: 0, subEff: 0 };
                            const cap = slotEditMod ? moduleMaxLevel(slotEditMod.rarity) : null;
                            return (
                                <>
                                    <div className="modal-head">
                                        <span className="modal-title">
                                            {TYPE_LABELS[type]} — {isAssist ? 'Assist' : 'Primary'} slot · {viewed.name}
                                        </span>
                                        <button className="btn btn-dim" style={{ fontSize: '12px' }}
                                            onClick={() => setSlotEdit(null)}>✕</button>
                                    </div>
                                    <div className="modal-body">
                                        <div className="field-row">
                                            <label className="field-label">
                                                Slot level
                                                <span className="field-sub">shared by every preset</span>
                                            </label>
                                            <NumericInput value={lv} min={0} max={MODULE_MAX_LEVEL} className="num-sm"
                                                onChange={v => setSlotLevel(type, slot, v)} />
                                            {cap !== null && lv > cap && (
                                                <span style={{ fontSize: '13px', color: 'var(--gold)' }}>
                                                    {slotEditMod!.name} caps at {cap}
                                                </span>
                                            )}
                                        </div>

                                        {isAssist && (
                                            <div className="modg-assist-box">
                                                <div className="field-row">
                                                    <label className="field-label">Unique effect tier</label>
                                                    <select value={ad.rarity}
                                                        onChange={e => updateAssistRarity(type, e.target.value as typeof ad.rarity)}>
                                                        <option value="locked">Locked</option>
                                                        <option value="Epic">Epic</option>
                                                        <option value="Legendary">Legendary</option>
                                                        <option value="Mythic">Mythic</option>
                                                        <option value="Ancestral">Ancestral</option>
                                                    </select>
                                                </div>
                                                {ad.rarity !== 'locked' && (
                                                    <>
                                                        <div className="field-row">
                                                            <label className="field-label">Main effect<span className="field-sub">1–130%</span></label>
                                                            <NumericInput value={ad.multEff ?? 0} min={0} max={130} className="num-sm"
                                                                onChange={v => updateAssist(type, 'multEff', v)} />
                                                            <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>%</span>
                                                        </div>
                                                        <div className="field-row">
                                                            <label className="field-label">Substats<span className="field-sub">1–100%</span></label>
                                                            <NumericInput value={ad.subEff ?? 0} min={0} max={100} className="num-sm"
                                                                onChange={v => updateAssist(type, 'subEff', v)} />
                                                            <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>%</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        )}

                                        <div className="modg-card-section" style={{ marginTop: '10px' }}>Module</div>
                                        <div className="modg-pick-list">
                                            <button className={`modg-pick ${!viewed.slots[type][slot] ? 'on' : ''}`}
                                                onClick={() => setSlot(type, slot, '')}>
                                                <ModuleBadge type={type} module={null} size={44} />
                                                <span>Empty</span>
                                            </button>
                                            {library.filter(m => m.type === type).map(m => (
                                                <button key={m.id}
                                                    className={`modg-pick ${viewed.slots[type][slot] === m.id ? 'on' : ''}`}
                                                    onClick={() => setSlot(type, slot, m.id)}
                                                    title={m.id === otherId ? `In the ${other === 'main' ? 'primary' : 'assist'} slot — picking it moves it here` : undefined}>
                                                    <ModuleBadge type={type} module={m} size={44} />
                                                    <span style={{ flex: 1, textAlign: 'left' }}>{m.name}</span>
                                                    <span style={{ fontSize: '13px', color: rarityColor(m.rarity) }}>{rarityLabel(m.rarity)}</span>
                                                    {m.id === otherId && <span className="modg-inv-tag static">{other === 'main' ? 'P' : 'A'}</span>}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>,
                document.body,
            )}

            {/* ══════════════════════════════════════
          ADD / EDIT MODAL — rendered via Portal
          to escape parent stacking context
      ══════════════════════════════════════ */}
            {modal.open && createPortal(
                <div className="modal-overlay" onClick={() => setModal(defaultModal())}>
                    <div className="modal-box modal-box-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-head">
                            <span className="modal-title">
                                {modal.editId ? 'Edit Module' : 'Add Module'}
                            </span>
                            <button className="btn btn-dim" style={{ fontSize: '12px' }}
                                onClick={() => setModal(defaultModal())}>✕</button>
                        </div>
                        <div className="modal-body">

                            {/* ── Module config ── */}
                            <div className="modal-grid">
                                <div>
                                    <label className="modal-label">Type</label>
                                    <select value={modal.type}
                                        onChange={e => onModalTypeChange(e.target.value as ModuleType)}
                                        style={{ width: '100%' }}>
                                        {MODULE_TYPES.map(t => (
                                            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="modal-label">Module Name</label>
                                    <select value={modal.name}
                                        onChange={e => setModal(m => ({ ...m, name: e.target.value }))}
                                        style={{ width: '100%' }}>
                                        {UNIQUE_MODULES[modal.type].map(([name]) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="modal-label">Rarity</label>
                                    <select value={modal.rarity}
                                        onChange={e => setModal(m => ({
                                            ...m,
                                            rarity: e.target.value as ModuleRarity,
                                        }))}
                                        style={{ width: '100%' }}>
                                        {RARITIES.map(r => (
                                            <option key={r.k} value={r.k}>{r.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* ── Main-effect ×value read off the module card ── */}
                            <div style={{ marginBottom: '14px' }}>
                                <label className="modal-label">
                                    Main effect — ×{MAIN_EFFECT_LABELS[modal.type]}
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={modal.mainMult || ''}
                                    placeholder="auto"
                                    onChange={e => setModal(m => ({ ...m, mainMult: parseFloat(e.target.value) || 0 }))}
                                    style={{ width: '140px' }}
                                />
                                <div style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '4px' }}>
                                    Optional — the number on the module card (e.g. ×16.24). Leave blank to calculate it
                                    from the rarity and the slot level.
                                </div>
                            </div>

                            {/* ── Unique effect preview ── */}
                            {uniqueEffectVal && (
                                <div className="mod-unique-effect" style={{ marginBottom: '14px' }}>
                                    <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                                        ✦ {modal.name}
                                    </span>
                                    <span style={{
                                        fontFamily: 'var(--font-mono)', fontSize: '14px',
                                        color: rarityColor(modal.rarity), fontWeight: 700,
                                        marginLeft: '8px',
                                    }}>
                                        {uniqueEffectVal}
                                    </span>
                                    <div style={{ fontSize: '13px', color: 'var(--text-dim)', marginTop: '4px' }}>
                                        {UNIQUE_MODULES[modal.type].find(([n]) => n === modal.name)?.[1]}
                                    </div>
                                </div>
                            )}

                            {/* ── Sub-effect slots ── */}
                            <div style={{
                                fontSize: '13px', fontWeight: 700, textTransform: 'uppercase',
                                letterSpacing: '.5px', color: 'var(--text-dim)', marginBottom: '8px',
                            }}>
                                Sub-Effect Slots (8)
                            </div>

                            <div className="sub-slots-grid">
                                {modal.subs.map((sub, si) => {
                                    const available = getAvailableSubEffects(modal.type, sub.rar);
                                    const curVal = sub.effect
                                        ? getSubEffectValue(modal.type, sub.effect, sub.rar)
                                        : null;
                                    const rarColor = sub.rar === 'Common' ? '#8a9ab5'
                                        : sub.rar === 'Rare' ? '#4fc3f7'
                                            : sub.rar === 'Epic' ? '#e040fb'
                                                : sub.rar === 'Legendary' ? '#ff9800'
                                                    : sub.rar === 'Mythic' ? '#f44336'
                                                        : '#00e676';

                                    return (
                                        <div key={si} className="sub-slot-card">
                                            <div className="sub-slot-header">
                                                <span className="sub-slot-num">Slot {si + 1}</span>
                                                {curVal && (
                                                    <span style={{
                                                        fontFamily: 'var(--font-mono)', fontSize: '13px',
                                                        color: rarColor, fontWeight: 700,
                                                    }}>
                                                        {curVal}
                                                    </span>
                                                )}
                                            </div>
                                            <select value={sub.rar}
                                                onChange={e => onModalSubRarityChange(si, e.target.value as SubRarity)}
                                                style={{
                                                    width: '100%', fontSize: '13px', marginBottom: '4px',
                                                    borderColor: rarColor, color: rarColor,
                                                }}>
                                                {SUB_RARITIES.map(r => (
                                                    <option key={r} value={r}>{r}</option>
                                                ))}
                                            </select>
                                            <select value={sub.effect}
                                                onChange={e => onModalSubEffectChange(si, e.target.value)}
                                                style={{ width: '100%', fontSize: '13px' }}>
                                                <option value="">— No effect —</option>
                                                {available.map(([name]) => (
                                                    <option key={name} value={name}>{name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="modal-actions">
                                <button className="btn btn-dim"
                                    onClick={() => setModal(defaultModal())}>Cancel</button>
                                <button className="btn btn-accent" onClick={saveModule}
                                    disabled={!modal.name}>
                                    {modal.editId ? 'Save Changes' : 'Add Module'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
