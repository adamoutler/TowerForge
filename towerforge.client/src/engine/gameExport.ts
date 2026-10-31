// ============================================================
//  TowerForge Companion — Game Export Import
//  Reads the official data export from The Tower (TTG's
//  tool_export.json). Field-by-field notes: docs/game-export-format.md
//
//  Imported: currencies, tier progress, username, battle history, and
//  the numbered arrays whose index → stat mapping was confirmed against
//  a real account (workshop presets, enhancements, ultimate weapons,
//  cards, perk bans, most labs, modules, the Guardian — tables in
//  constants/gameExportMaps). From 29.1.3 exports (ExportVersion 1) also
//  bot and Bot+ levels per preset, labs being researched and the current
//  league. Relics and unconfirmed labs keep what players entered.
//
//  Pure functions — no store imports.
// ============================================================

import type { BattleField, BattleReport } from './battleReport';
import { isDissonantRun } from './battleReport';
import { MAX_TIER, WS_STATS, WS_ENH, UWS, LABS, RELICS } from '../constants/gameData';
import {
    GAME_CARDS, MASTERY_LAB_START, MASTERY_LAB_CARDS, CARD_PRESET_SLOTS, GAME_PERKS, GAME_LABS, GAME_LAB_GROUPS,
    GAME_MODULES, GAME_MODULE_RARITY, GAME_MODULE_EFFECT_RUNS, MODULE_EFFECT_SLOT_UNLOCK, isUniqueModule,
    GAME_LEAGUES,
} from '../constants/gameExportMaps';
import { SUB_EFFECTS, SUB_RARITIES } from '../constants/moduleData';
import type { SubRarity } from '../constants/moduleData';
import type {
    Currencies, TierWaves, WSPreset, WSCategory, EnhData, EnhCategoryData, UWData,
    CardData, CardEntry, LabData, ModuleState, ModuleEntry, ModuleType, ModuleRarity,
    SubSlot, Loadout, LoadoutSlots, AssistData, League, GuardianData, GuardianPreset,
    BotLoadouts, DissonanceWaves, LabProgress, LabRunning, TourneyRecord, WsUnlocked,
} from '../types/gameTypes';
import { BOTS_CONFIG } from '../constants/botData';
import { RELIC_CATALOG } from '../constants/relicCatalog';
import { CHIPS } from '../constants/guardianData';
import { vaultGroupKey } from '../constants/vaultData';
import { vaultCardSlots } from './vault';

type Raw = Record<string, unknown>;

export interface GameImport {
    gameVersion: number;
    dataVersion: number;
    currencies: Currencies;
    tierWaves: TierWaves;      // tier number → highest wave
    highestTier: number;       // highest tier unlocked (from progress)
    completedTier: number;     // highest tier whose unlock requirement is met
    userName: string;
    battles: BattleReport[];   // oldest → newest, as stored by the game
    workshop: WSPreset[] | null;       // app preset i ← the game's global preset i
    enhancements: EnhData | null;      // levels per app preset, ownership account-wide
    uws: UWData['data'] | null;
    cardSlots: number;                 // 0 when the file has no slot count
    fivePresets: boolean;              // workshop presets 3–5 hold upgrades (Harmony unlocked)
    cards: Pick<CardData, 'data' | 'presets'> | null;   // only cards whose game number is known
    bannedPerks: string[] | null;      // site perk ids
    labs: LabData | null;              // only labs whose game number is known
    modules: ModuleImport | null;
    league: League;                    // highest league reached ('' = unknown)
    wallUnlocked: boolean;             // a workshop preset has Wall Health
    wsUnlocked: WsUnlocked | null;     // workshop groups bought per section (Upgrade…TierUnlocked)
    presetNames: string[];             // per app preset ('' = keep the default name)
    guardian: GuardianData | null;     // null when the file has no Guardian fields
    // 29.1.3+ exports (ExportVersion 1) — null / '' on older files.
    exportVersion: number | null;
    exportedAt: number | null;         // ms, UTC
    currentLeague: League;             // LeagueID: the league you're in now
    bots: BotImport | null;            // bot levels and which are active, per preset
    labsRunning: LabRunning[] | null;
    labProgress: LabProgress | null;   // labs whose next level is under way or part done
    dissonance: DissonanceWaves | null;   // best Dissonant Run wave per tier on each track
    labSlots: number | null;           // lab slots owned: LabsUnlocked (bought) + the free one
    tourneyRecords: TourneyRecord[] | null;   // TournamentRecords (29.1.3+); null when the file has none
    relics: RelicImport | null;
    vault: Record<string, number> | null;     // Vault.UpgradesLevel: vault id → level
}

// Bot and Bot+ levels per site preset (from the bot preset its global
// preset uses) and the bots active in it.
export interface BotImport {
    owned: Record<string, boolean>;                     // unlocked in any preset
    medals: Record<string, Record<number, number[]>>;   // bot → site preset → medal levels
    plusOwned: Record<string, boolean>;                 // Bot+ unlocked in any preset
    plusLv: Record<string, Record<number, number>>;     // bot → site preset → Bot+ level
    unlocked: Record<string, Record<number, boolean>>;  // bot → site preset → unlocked there
    plusUnlocked: Record<string, Record<number, boolean>>;
    loadouts: BotLoadouts;
}

// The export format this importer was written for (TTG bumps ExportVersion
// when a field is renamed, removed or changes meaning; not for additions).
export const SUPPORTED_EXPORT_VERSION = 1;

export interface ModuleImport {
    state: ModuleState;                // library = unique modules the import can name
    unnamed: UnnamedModule[];          // unique modules whose game number isn't confirmed yet
}

export interface UnnamedModule {
    infoIndex: number;
    type: ModuleType;
    rarity: ModuleRarity | null;
    effects: string[];                 // visible effects, e.g. "Ancestral Super Crit Chance"
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object';

const CATS: WSCategory[] = ['attack', 'defense', 'utility'];
const APP_PRESETS = 5;
const GAME_PRESET_STRIDE = 20;   // Preset* arrays hold 20 slots per workshop preset

// Live (currently loaded) and per-preset array names for each category.
const WS_FIELDS: Record<WSCategory, { live: string; preset: string }> = {
    attack: { live: 'UpgradeWorkshopLevel', preset: 'PresetUpgradeWorkshopLevel' },
    defense: { live: 'UpgradeWorkshopDefenseLevel', preset: 'PresetUpgradeWorkshopDefenseLevel' },
    utility: { live: 'UpgradeWorkshopUtilityLevel', preset: 'PresetUpgradeWorkshopUtilityLevel' },
};
const ENH_FIELDS: Record<WSCategory, { live: string; preset: string; unlocked: string }> = {
    attack: { live: 'EnhancementLevel', preset: 'PresetEnhancementLevel', unlocked: 'EnhancementTierUnlocked' },
    defense: { live: 'EnhancementDefenseLevel', preset: 'PresetEnhancementDefenseLevel', unlocked: 'EnhancementDefenseTierUnlocked' },
    utility: { live: 'EnhancementUtilityLevel', preset: 'PresetEnhancementUtilityLevel', unlocked: 'EnhancementUtilityTierUnlocked' },
};

// Workshop stats are stored in the same order as WS_STATS. Enhancements are
// not: ENH_GAME_ORDER[cat][gameIdx] is the WS_ENH index of the game's
// enhancement at that position (the game lists them in the wiki's order).
const ENH_GAME_ORDER: Record<WSCategory, number[]> = {
    attack: [0, 5, 1, 2, 3, 4],    // Damage, Rend Armor, Crit Factor, Damage/Meter, Super Crit Multi, Attack Speed
    defense: [0, 1, 4, 3, 2, 5],   // Health, Health Regen, Wall Health, Land Mine Damage, Defense Absolute, Orb Size
    utility: [0, 1, 2, 3, 4, 5],
};

// The game's workshop preset behind each app preset: app presets bundle
// workshop + cards + bots the way the game's global presets do.
function workshopIndexFor(raw: Raw, appPreset: number): number {
    const g = arr(raw.GlobalPresets)[appPreset];
    return isObj(g) && typeof g.WorkshopIndex === 'number' ? g.WorkshopIndex : appPreset;
}

// One category's levels for a game workshop preset. The loaded preset is read
// from the live array (it can have changes not yet saved to its preset slot).
function presetLevels(raw: Raw, fields: { live: string; preset: string }, wsPreset: number): number[] {
    if (wsPreset === num(raw.CurrentWorkshopPreset)) return arr(raw[fields.live]).map(num);
    const start = wsPreset * GAME_PRESET_STRIDE;
    return arr(raw[fields.preset]).slice(start, start + GAME_PRESET_STRIDE).map(num);
}

function parseWorkshop(raw: Raw): WSPreset[] | null {
    if (CATS.every(cat => arr(raw[WS_FIELDS[cat].live]).length === 0)) return null;
    return Array.from({ length: APP_PRESETS }, (_, appPreset) => {
        const ws = workshopIndexFor(raw, appPreset);
        const preset: WSPreset = { attack: [], defense: [], utility: [] };
        for (const cat of CATS) {
            const lv = presetLevels(raw, WS_FIELDS[cat], ws);
            preset[cat] = WS_STATS[cat].map(([, max], i) => clamp(lv[i] ?? 0, 0, max));
        }
        return preset;
    });
}

// Any workshop preset past the first two holds upgrades → 5 presets unlocked.
function usesFivePresets(raw: Raw): boolean {
    for (let ws = 2; ws < APP_PRESETS; ws++) {
        if (CATS.some(cat => presetLevels(raw, WS_FIELDS[cat], ws).some(v => v > 0))) return true;
    }
    return false;
}

// Workshop groups bought: UpgradeTierUnlocked (attack), UpgradeDefense… and
// UpgradeUtility…, [k] = group k + 1 (constants/gameData WS_UNLOCK_GROUPS).
function parseWsUnlocked(raw: Raw): WsUnlocked | null {
    const count = (v: unknown) => arr(v).filter(x => x === true).length;
    if (!Array.isArray(raw.UpgradeTierUnlocked)) return null;
    return {
        attack: count(raw.UpgradeTierUnlocked),
        defense: count(raw.UpgradeDefenseTierUnlocked),
        utility: count(raw.UpgradeUtilityTierUnlocked),
    };
}

function parseEnhancements(raw: Raw): EnhData | null {
    if (CATS.every(cat => arr(raw[ENH_FIELDS[cat].live]).length === 0)) return null;

    const levelsFor = (ws: number): EnhCategoryData => {
        const out: EnhCategoryData = {};
        for (const cat of CATS) {
            const lv = presetLevels(raw, ENH_FIELDS[cat], ws);
            const appLv = WS_ENH[cat].map(() => 0);
            ENH_GAME_ORDER[cat].forEach((appIdx, gameIdx) => {
                appLv[appIdx] = clamp(lv[gameIdx] ?? 0, 0, WS_ENH[cat][appIdx][1]);
            });
            out[cat] = appLv;
        }
        return out;
    };

    const p: { [presetIdx: number]: EnhCategoryData } = {};
    for (let appPreset = 0; appPreset < APP_PRESETS; appPreset++) {
        p[appPreset] = levelsFor(workshopIndexFor(raw, appPreset));
    }

    // The first enhancement in each category is free; TierUnlocked[k] means
    // the game's enhancement k + 1 has been bought. Any levels also prove ownership.
    const u: EnhData['u'] = {};
    for (const cat of CATS) {
        const unlocked = arr(raw[ENH_FIELDS[cat].unlocked]);
        const owned = WS_ENH[cat].map(() => false);
        ENH_GAME_ORDER[cat].forEach((appIdx, gameIdx) => {
            owned[appIdx] = gameIdx === 0 || unlocked[gameIdx - 1] === true
                || Object.values(p).some(levels => (levels[cat]?.[appIdx] ?? 0) > 0);
        });
        u[cat] = owned;
    }

    return { d: levelsFor(num(raw.CurrentWorkshopPreset)), u, p };
}

// UltimateWeaponLevel holds 3 stats per UW in UWS order, 0-based (app levels start at 1).
function parseUWs(raw: Raw): UWData['data'] | null {
    const owned = arr(raw.UltimateWeaponUnlocked);
    if (owned.length === 0) return null;
    const levels = arr(raw.UltimateWeaponLevel).map(num);
    const plusOwned = arr(raw.UltimateWeaponPlusUnlocked);
    const plusLevels = arr(raw.UltimateWeaponPlusLevel).map(num);

    const data: UWData['data'] = {};
    UWS.forEach((uw, i) => {
        const own = owned[i] === true;
        data[uw.a] = {
            own,
            sv: uw.s.map(([, max], j) => clamp((levels[i * 3 + j] ?? 0) + 1, 1, max)) as [number, number, number],
            upOwn: own && plusOwned[i] === true,
            upLvl: clamp(plusLevels[i] ?? 0, 0, uw.upMax),
        };
    });
    return data;
}

// Card stars (CardLevel is the star count), mastery (unlock flag + its lab's
// level) and the card presets behind each app preset (via GlobalPresets).
function parseCards(raw: Raw): Pick<CardData, 'data' | 'presets'> | null {
    const levels = arr(raw.CardLevel).map(num);
    if (levels.length === 0) return null;
    const unlocked = arr(raw.CardUnlocked);
    const masteryOn = arr(raw.CardMasteryUnlocked);
    const research = arr(raw.ResearchLevel).map(num);

    const data: CardData['data'] = {};
    for (const [n, name] of Object.entries(GAME_CARDS)) {
        const idx = Number(n);
        const stars = unlocked[idx] === true ? clamp(levels[idx] ?? 0, 1, 7) : 0;
        const labIdx = MASTERY_LAB_CARDS.indexOf(name);
        const entry: CardEntry = {
            s: stars,
            m: labIdx >= 0 ? clamp(research[MASTERY_LAB_START + labIdx] ?? 0, 0, 9) : 0,
            mu: stars >= 7 && masteryOn[idx] === true,
        };
        data[name] = entry;
    }

    // The loaded card preset is read from CardActive (it can have unsaved changes).
    const slots = arr(raw.SlotPresetCardInt).map(num);
    const assigned = arr(raw.SlotPresetCardAssignedBool);
    const active = arr(raw.CardActive);
    const cardsIn = (preset: number): string[] => {
        const nums = preset === num(raw.CurrentPreset)
            ? active.flatMap((on, i) => (on === true ? [i] : []))
            : slots.slice(preset * CARD_PRESET_SLOTS, (preset + 1) * CARD_PRESET_SLOTS)
                .filter((_, s) => assigned[preset * CARD_PRESET_SLOTS + s] === true);
        return nums.flatMap(c => (GAME_CARDS[c] ? [GAME_CARDS[c]] : []));
    };
    const presets: CardData['presets'] = {};
    for (let appPreset = 0; appPreset < APP_PRESETS; appPreset++) {
        const g = arr(raw.GlobalPresets)[appPreset];
        presets[appPreset] = cardsIn(isObj(g) && typeof g.CardsIndex === 'number' ? g.CardsIndex : appPreset);
    }
    return { data, presets };
}

function parseBannedPerks(raw: Raw): string[] | null {
    if (!Array.isArray(raw.BannedPerksIndex)) return null;
    return raw.BannedPerksIndex.map(num)
        .flatMap(i => (i >= 0 && GAME_PERKS[i] ? [GAME_PERKS[i] as string] : []));
}

const LAB_MAX: Record<string, number> = Object.fromEntries(
    LABS.flatMap(cat => cat.l.map(([name, max]) => [name, max] as const)),
);

function parseLabs(raw: Raw): LabData | null {
    const levels = arr(raw.ResearchLevel).map(num);
    if (levels.length === 0) return null;
    const labs: LabData = {};
    for (const [n, name] of Object.entries(GAME_LABS)) {
        labs[name] = clamp(levels[Number(n)] ?? 0, 0, LAB_MAX[name] ?? Infinity);
    }
    for (const group of GAME_LAB_GROUPS) {
        const lv = group.numbers.map(n => levels[n] ?? 0);
        if (lv.some(v => v !== lv[0])) continue;
        for (const name of group.labs) labs[name] = clamp(lv[0], 0, LAB_MAX[name] ?? Infinity);
    }
    return labs;
}

// ── Modules ───────────────────────────────────────────────────

const MODULE_TYPES: ModuleType[] = ['cannon', 'armor', 'generator', 'core'];
const TYPE_LABEL: Record<ModuleType, string> = { cannon: 'Cannon', armor: 'Armor', generator: 'Generator', core: 'Core' };

// Effects[] code → effect, built once from GAME_MODULE_EFFECT_RUNS.
interface DecodedEffect { type: ModuleType; effect: string; rar: SubRarity; val: string }
const EFFECT_CODES: Map<number, DecodedEffect | null> = (() => {
    const codes = new Map<number, DecodedEffect | null>();
    let code = 1;
    for (const [type, run] of GAME_MODULE_EFFECT_RUNS) {
        for (const entry of run) {
            if (typeof entry === 'number') {
                for (let i = 0; i < entry; i++) codes.set(code++, null);
                continue;
            }
            const def = SUB_EFFECTS[type].find(([name]) => name === entry);
            if (!def) continue;
            def[2].forEach((v, r) => {
                if (v === null) return;
                codes.set(code++, { type, effect: entry, rar: SUB_RARITIES[r], val: `${v}${def[1]}` });
            });
        }
    }
    return codes;
})();

// The type a module's effect codes belong to (blocks are contiguous by type).
function typeOfEffects(effects: number[]): ModuleType | null {
    for (const c of effects) {
        const e = EFFECT_CODES.get(c);
        if (e) return e.type;
    }
    return null;
}

// Effects the module has revealed: its pre-rolled slots whose unlock level it has reached.
function visibleEffects(m: Raw): number[] {
    const reached = num(m.MaxLevelReached);
    return arr(m.Effects).map(num)
        .filter((c, slot) => c > 0 && reached >= (MODULE_EFFECT_SLOT_UNLOCK[slot] ?? Infinity));
}

const ASSIST_RARITY: AssistData[string]['rarity'][] = ['Epic', 'Legendary', 'Mythic', 'Ancestral'];

// Unique modules (library), the equipped loadout and saved presets, assist
// slots and slot levels. Generic modules (no unique effect) are skipped.
function parseModules(raw: Raw, labs: LabData | null): ModuleImport | null {
    const equipped = arr(raw.ModuleEquipped);
    const assistSlots = arr(raw.AssistModuleSlots).filter(isObj);
    if (equipped.length === 0 && arr(raw.ModuleInventory).length === 0) return null;

    // Every module the player owns, once each.
    const owned = new Map<string, Raw>();
    for (const m of [...equipped, ...assistSlots.map(s => s.EquippedModule), ...arr(raw.ModuleInventory)]) {
        if (isObj(m) && typeof m.Guid === 'string' && !owned.has(m.Guid)) owned.set(m.Guid, m);
    }

    const library: ModuleEntry[] = [];
    const unnamed: UnnamedModule[] = [];
    for (const m of owned.values()) {
        const info = num(m.InfoIndex);
        if (!isUniqueModule(info)) continue;
        const codes = visibleEffects(m);
        const rarity = GAME_MODULE_RARITY[num(m.CurrentRarity)] ?? null;
        const def = GAME_MODULES[info];
        if (!def || !rarity) {
            const type = def?.type ?? typeOfEffects(arr(m.Effects).map(num));
            if (type) {
                unnamed.push({
                    infoIndex: info, type, rarity,
                    effects: codes.flatMap(c => { const e = EFFECT_CODES.get(c); return e ? [`${e.rar} ${e.effect}`] : []; }),
                });
            }
            continue;
        }
        const subs: SubSlot[] = codes.map(c => {
            const e = EFFECT_CODES.get(c);
            return e && e.type === def.type ? { effect: e.effect, rar: e.rar, val: e.val } : { effect: '', rar: 'Common', val: '' };
        });
        library.push({ id: String(m.Guid), name: def.name, type: def.type, rarity, subs });
    }

    // Loadouts reference library modules by Guid; unnamed modules leave the slot empty.
    const known = new Set(library.map(m => m.id));
    const ref = (g: unknown) => (typeof g === 'string' && known.has(g) ? g : '');
    const slotsFrom = (primary: unknown[], assist: unknown[]): LoadoutSlots => {
        const out = {} as LoadoutSlots;
        MODULE_TYPES.forEach((t, i) => { out[t] = { main: ref(primary[i]), assist: ref(assist[i]) }; });
        return out;
    };
    const presets = arr(raw.ModulePresets).filter(isObj);
    const current = num(raw.CurrentModulePreset);
    const assistByType = (i: number) => assistSlots.find(s => num(s.Type) === i);

    // Every game preset in the game's order (empty ones too, like the game's
    // tabs). The equipped one uses what's actually equipped (it can differ from
    // the saved preset) and is marked active — the calculators read it.
    const equippedSlots = slotsFrom(
        equipped.map(m => (isObj(m) ? m.Guid : null)),
        MODULE_TYPES.map((_, i) => { const e = assistByType(i)?.EquippedModule; return isObj(e) ? e.Guid : null; }),
    );
    const loadouts: Loadout[] = presets.map((p, i) => ({
        id: `game-${i}`,
        name: String(p.PresetName ?? `Preset ${i + 1}`),
        slots: i === current ? equippedSlots : slotsFrom(arr(p.PrimaryModuleGuids), arr(p.AssistModuleGuids)),
    }));
    if (!loadouts.some(l => l.id === `game-${current}`)) {
        loadouts.unshift({ id: `game-${current}`, name: 'Equipped', slots: equippedSlots });
    }

    // Assist slots: efficiency = 1% + stone upgrades + Assist Module labs.
    // Checked on a real account: cannon substats 1 + 7 + 9 = 17%, core 1 + 18 + 13 = 32%.
    const assistData: AssistData = {};
    const slotLevels = {} as ModuleState['slotLevels'];
    const primaryLevels = arr(raw.SlotLevels).map(num);
    MODULE_TYPES.forEach((t, i) => {
        const s = assistByType(i);
        const lab = (kind: 'Mult' | 'Substat') => labs?.[`Assist-${TYPE_LABEL[t]} ${kind}`] ?? 0;
        assistData[t] = s?.Unlocked === true
            ? {
                rarity: ASSIST_RARITY[clamp(num(s.UniqueEffectEfficiencyLevel), 0, 3)],
                multEff: 1 + num(s.MainEffectEfficiencyLevel) + lab('Mult'),
                subEff: 1 + num(s.SubstatEfficiencyLevel) + lab('Substat'),
            }
            : { rarity: 'locked', multEff: 0, subEff: 0 };
        slotLevels[t] = { main: primaryLevels[i] ?? 0, assist: s?.Unlocked === true ? num(s.Level) : 0 };
    });

    const loadoutFor = parseLoadoutFor(raw, loadouts);
    return {
        state: { library, loadouts, activeLoadout: `game-${current}`, ...(loadoutFor ? { loadoutFor } : {}), assistData, slotLevels },
        unnamed,
    };
}

// The loadout each site preset uses: GlobalPresets[i].ModulesIndex, like its
// workshop, cards, bots and Guardian. Owner's export: 0, 1, 2 on the first
// three, with module preset "farm" beside workshop preset "GC Farm". Rows all
// on one module preset don't tell presets apart (no Global Presets yet, or one
// set of modules for everything), so what's equipped stays. A row on an empty
// module preset keeps what's equipped too: an empty slot isn't a build.
function parseLoadoutFor(raw: Raw, loadouts: Loadout[]): string[] | null {
    const rows = arr(raw.GlobalPresets).filter(isObj).map(g => (typeof g.ModulesIndex === 'number' ? g.ModulesIndex : null));
    if (new Set(rows).size < 2 || rows.includes(null)) return null;
    const filled = new Set(loadouts
        .filter(l => MODULE_TYPES.some(t => l.slots[t].main || l.slots[t].assist))
        .map(l => l.id));
    const equipped = `game-${num(raw.CurrentModulePreset)}`;
    return Array.from({ length: APP_PRESETS }, (_, i) => {
        const id = `game-${rows[i] ?? 0}`;
        return filled.has(id) ? id : equipped;
    });
}

// Names for the app presets, from the game's presets: a global preset's own
// name if the player set one, else its workshop preset's name. A name already
// used by an earlier preset (or a default "Preset N") is left blank.
function parsePresetNames(raw: Raw): string[] {
    // "Preset1" too: a PDF that wrapped the line can drop the space.
    const isDefault = (n: string) => !n.trim() || /^preset ?\d+$/i.test(n.trim());
    const wsNames = arr(raw.WorkshopPresetName).map(n => String(n ?? ''));
    const used = new Set<string>();
    return Array.from({ length: APP_PRESETS }, (_, i) => {
        const g = arr(raw.GlobalPresets)[i];
        const own = isObj(g) ? String(g.PresetName ?? '') : '';
        const ws = wsNames[workshopIndexFor(raw, i)] ?? '';
        const name = !isDefault(own) ? own.trim() : !isDefault(ws) ? ws.trim() : '';
        if (!name || used.has(name.toLowerCase())) return '';
        used.add(name.toLowerCase());
        return name;
    });
}

// The export has these top-level keys; enough of them to be sure it's the game's file.
export function isGameExport(raw: unknown): raw is Raw {
    return !!raw && typeof raw === 'object'
        && 'VersionNumber' in raw && 'DataVersion' in raw && 'Coins' in raw && 'Gems' in raw;
}

// Waves needed on tier t to unlock tier t + 1 (300 from tier 15 on, per the wiki).
const wavesToUnlockNext = (tier: number) => (tier >= 15 ? 300 : 100);

function formatBattleDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });
}

// Every plain value of a BattleHistory entry (numbers, text, flags, short
// number lists), so fields the site doesn't read yet are still there later.
function battleFields(b: Raw): Record<string, BattleField> {
    const out: Record<string, BattleField> = {};
    for (const [key, v] of Object.entries(b)) {
        if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string' || typeof v === 'boolean') out[key] = v;
        else if (Array.isArray(v) && v.length <= 64 && v.every(x => typeof x === 'number')) out[key] = v as number[];
    }
    return out;
}

// One BattleHistory entry → the same shape a pasted Battle Report produces.
function battleToReport(b: Raw): BattleReport {
    const total = num(b.TotalEnemies);
    const share = (killed: unknown) => (total > 0 ? Math.min(1, num(killed) / total) : null);
    const realTime = num(b.RealTime);   // seconds
    return {
        date: formatBattleDate(String(b.BattleDate ?? '')),
        tier: num(b.Tier),
        wave: num(b.Wave),
        gameTimeSec: num(b.GameTime),    // seconds
        realTimeSec: realTime,
        coinsEarned: num(b.CoinsEarned),
        coinsPerHour: realTime > 0 ? num(b.CoinsEarned) / realTime * 3600 : 0,
        totalEnemies: total,
        wavesSkipped: num(b.WavesSkipped),
        largestGoldenCombo: num(b.LargestGoldenCombo),
        recoveryPackages: num(b.RecoveryPackages),
        thornsKills: num(b.DestroyedByThorns),
        killedWithEffect: {
            goldenTower: share(b.DestroyedInGoldenTower),
            deathWave: share(b.TaggedByDeathwave),
            spotlight: share(b.DestroyedInSpotlight),
            goldenBot: share(b.DestroyedInGoldenBot),
            blackHole: share(b.DestroyedInBlackhole),
            orbs: share(b.DestroyedInOrbs),
        },
        coins: {
            goldenCombo: num(b.CoinsFromGoldenTowerPlus),
            waveSkip: num(b.CoinsEarnedWaveSkip),
            coinsPerWave: num(b.CoinsEarnedCPW),
            criticalCoin: num(b.CoinsFromCritCoin),
            fetched: num(b.GuardianCoinsFetched),
        },
        tournament: b.IsTournament === true,
        bossKills: num(b.TotalBoss),
        eliteKills: num(b.TotalElites),
        fleetKills: num(b.TotalCommanders) + num(b.TotalSaboteurs) + num(b.TotalOvercharges),
        cashEarned: num(b.CashEarned),
        projectileCount: num(b.ProjectilesCount),
        clHits: num(b.EnemiesHitByChainLightningThisRound),
        psHits: num(b.EnemiesHitByPoisonSwampThisRound),
        orbHits: num(b.OrbHits),
        damage: num(b.DamageDealt) > 0 ? {
            total: num(b.DamageDealt),
            chainLightning: num(b.ChainLightningDamage),
            smartMissiles: num(b.SmartMissileDamage),
            deathWave: num(b.DeathWaveDamage),
            innerLandMines: num(b.InnerLandMineDamage),
            poisonSwamp: num(b.SwampDamage),
            blackHole: num(b.BlackHoleDamage),
            orbs: num(b.OrbDamage),
            projectiles: num(b.ProjectilesDamage),
            rendArmor: num(b.RendArmorDamage),
            landMines: num(b.LandMineDamage),
            thorns: num(b.ThornDamage),
        } : undefined,
        ...(Number.isFinite(Date.parse(String(b.BattleDate))) ? { time: Date.parse(String(b.BattleDate)) } : {}),
        raw: battleFields(b),
    };
}

export function parseGameExport(raw: Raw): GameImport {
    const currencies: Currencies = {
        coins: num(raw.Coins),
        gems: num(raw.Gems),
        stones: num(raw.Stones),
        medals: num(raw.Medals),
        cells: num(raw.Cells),
        keys: num(raw.Keys),
        tokens: num(raw.Tokens),
        bits: num(raw.Bits),
        // Module currencies (the row on the game's Modules screen).
        ...(typeof raw.ModuleRerollCurrency === 'number' ? {
            rerollShards: num(raw.ModuleRerollCurrency),
            cannonShards: num(raw.ModuleCannonShards),
            armorShards: num(raw.ModuleArmorShards),
            generatorShards: num(raw.ModuleGeneratorShards),
            coreShards: num(raw.ModuleCoreShards),
        } : {}),
        // Earned in total — spent and saved (docs/game-export-format.md).
        ...(typeof raw.ModuleCannonShardsLifetime === 'number' ? {
            rerollShardsLifetime: num(raw.ModuleRerollCurrencyLifetime),
            cannonShardsLifetime: num(raw.ModuleCannonShardsLifetime),
            armorShardsLifetime: num(raw.ModuleArmorShardsLifetime),
            generatorShardsLifetime: num(raw.ModuleGeneratorShardsLifetime),
            coreShardsLifetime: num(raw.ModuleCoreShardsLifetime),
        } : {}),
    };

    // HighestWaveThisTier is indexed by tier number (index 0 is unused).
    const waves = arr(raw.HighestWaveThisTier).map(num);
    const rounds = arr(raw.RoundsStartedThisTier).map(num);
    const tierWaves: TierWaves = {};
    let playedTier = 0;
    let completedTier = 0;
    waves.forEach((w, tier) => {
        if (tier === 0) return;
        if (w > 0) tierWaves[tier] = w;
        if (w > 0 || (rounds[tier] ?? 0) > 0) playedTier = Math.max(playedTier, tier);
        if (w >= wavesToUnlockNext(tier)) completedTier = Math.max(completedTier, tier);
    });

    const labs = parseLabs(raw);
    const workshop = parseWorkshop(raw);
    const vault = parseVault(raw);

    return {
        gameVersion: num(raw.VersionNumber),
        dataVersion: num(raw.DataVersion),
        currencies,
        tierWaves,
        highestTier: Math.max(playedTier, Math.min(MAX_TIER, completedTier + 1)),
        completedTier,
        userName: typeof raw.UserName === 'string' ? raw.UserName : '',
        battles: arr(raw.BattleHistory).filter(isObj).map(battleToReport),
        workshop,
        enhancements: parseEnhancements(raw),
        uws: parseUWs(raw),
        // SlotsUnlocked is the slots bought with gems; the Vault adds up to 6.
        cardSlots: clamp(num(raw.SlotsUnlocked) + vaultCardSlots(vault ?? undefined), 0, 28),
        fivePresets: usesFivePresets(raw),
        cards: parseCards(raw),
        bannedPerks: parseBannedPerks(raw),
        labs,
        modules: parseModules(raw, labs),
        // A file without the field keeps the player's league ('' = unknown), not Copper.
        league: typeof raw.HighestLeague === 'number' ? GAME_LEAGUES[raw.HighestLeague] ?? '' : '',
        wallUnlocked: (workshop ?? []).some(p => (p.defense[WS_STATS.defense.findIndex(([n]) => n === 'Wall Health')] ?? 0) > 0),
        wsUnlocked: parseWsUnlocked(raw),
        presetNames: parsePresetNames(raw),
        guardian: parseGuardian(raw),
        exportVersion: typeof raw.ExportVersion === 'number' ? raw.ExportVersion : null,
        exportedAt: dateMs(raw.ExportedAt),
        currentLeague: typeof raw.LeagueID === 'number' ? GAME_LEAGUES[raw.LeagueID] ?? '' : '',
        bots: parseBots(raw),
        labsRunning: parseLabsRunning(raw),
        labProgress: parseLabProgress(raw),
        dissonance: parseDissonance(raw),
        // LabsUnlocked counts the slots bought with gems, not the free first one:
        // the owner's 4 with 5 labs running, a newer account's 2 with 3 (2026-10-28).
        labSlots: typeof raw.LabsUnlocked === 'number' ? clamp(raw.LabsUnlocked + 1, 1, 5) : null,
        tourneyRecords: parseTourneyRecords(raw),
        relics: parseRelics(raw),
        vault,
    };
}

// The Vault (v29): UpgradesLevel maps each vault id to its level (a JSON
// object in the export; key/value pairs in some saves), UnlockedGroups
// lists the sections unlocked, kept as "g<group>" = 1 beside the levels.
// Ids and groups: constants/vaultData.ts (the Vault tab, card slots, Bot Range).
function parseVault(raw: Raw): Record<string, number> | null {
    const v = raw.Vault;
    if (!isObj(v)) return null;
    const levels = v.UpgradesLevel;
    const out: Record<string, number> = {};
    if (Array.isArray(levels)) {
        for (const e of levels.filter(isObj)) {
            const k = e.Key ?? e.key, n = e.Value ?? e.value;
            if (k !== undefined && typeof n === 'number') out[String(k)] = n;
        }
    } else if (isObj(levels)) {
        for (const [k, n] of Object.entries(levels)) if (typeof n === 'number') out[k] = n;
    } else {
        return null;
    }
    for (const g of arr(v.UnlockedGroups)) if (typeof g === 'number') out[vaultGroupKey(g)] = 1;
    return out;
}

// Relics: RelicsUnlocked has one slot per relic, 2 = owned; each slot's
// relic and bonus from TheTowerSDK (constants/relicCatalog.ts). The totals
// are what the game's Relics → ⓘ screen shows: on the owner's account all
// 27 matched (docs/game-export-format.md). Owned slots the catalog doesn't
// know yet (relics newer than it) are counted, not guessed.
export interface RelicImport {
    totals: Record<string, number>;   // Relics tab keys → bonus total
    owned: number;
    unknown: number;                  // owned slots without a known relic
}

const RELIC_BY_SLOT = new Map(RELIC_CATALOG.map(([slot, , key, value]) => [slot, { key, value }]));
const RELIC_KEYS = Object.values(RELICS).flat().map(([key]) => key);

function parseRelics(raw: Raw): RelicImport | null {
    const slots = arr(raw.RelicsUnlocked);
    if (slots.length === 0) return null;
    const totals: Record<string, number> = Object.fromEntries(RELIC_KEYS.map(k => [k, 0]));
    let owned = 0, unknown = 0;
    slots.forEach((v, slot) => {
        if (v !== 2) return;
        owned++;
        const relic = RELIC_BY_SLOT.get(slot);
        if (!relic) { unknown++; return; }
        totals[relic.key] = Math.round(((totals[relic.key] ?? 0) + relic.value) * 100) / 100;
    });
    return { totals, owned, unknown };
}

// Every tournament played (TournamentRecords): number, day, league, wave,
// rank. Owner's export: #309 W135 rank 19 = the best tournament run that
// day in the battle history (docs/game-export-format.md).
function parseTourneyRecords(raw: Raw): TourneyRecord[] | null {
    if (!Array.isArray(raw.TournamentRecords)) return null;
    const out: TourneyRecord[] = [];
    for (const r of raw.TournamentRecords as Raw[]) {
        const date = dateMs(r?.Date);
        if (typeof r?.TournamentNumber !== 'number' || date === null) continue;
        out.push({
            number: r.TournamentNumber,
            date,
            league: typeof r.LeagueID === 'number' ? GAME_LEAGUES[r.LeagueID] ?? '' : '',
            wave: Math.max(0, num(r.Wave)),
            rank: Math.max(0, num(r.Rank)),
        });
    }
    return out.sort((a, b) => a.number - b.number);
}

// An ISO date in ms; null for missing or the game's empty date (year 1).
function dateMs(v: unknown): number | null {
    if (typeof v !== 'string') return null;
    const t = Date.parse(v);
    return Number.isFinite(t) && t > 0 ? t : null;
}

// ── Bots (29.1.3+ exports) ────────────────────────────────────
// One list per bot (FlameBotPresets …), one row per bot preset: Unlocked,
// Active, Levels, SelectedLevels, PlusUnlocked, PlusLevel; GlobalPresets[i]
// .BotsIndex picks the row for site preset i. The save keeps a bot's four
// levels as [secondary, range, cooldown, primary]; the game shows them — and
// the site keeps them — as [primary, cooldown, secondary, range]
// (TheTowerSDK remapBotLevelsFromGameSaveOrder, checked there against a real
// save). Each stat takes the higher of Levels and SelectedLevels, as the SDK
// does (a level can be picked below the one bought, e.g. Cooldown). Levels
// count from 0 = the base value, like the site's. PlusLevel is the level of
// the bot's one Bot+ ability, 0 = its unlock value, clamped to its max
// (TheTowerSDK readUserBotDataRow / clampBotPlusStatLevel: PlusLevel goes to
// Bot+ stat 0, the only one); it counts only where PlusUnlocked. Bots unlock
// per bot preset: the owner's GC Farm preset shows only Golden Bot and Bot
// Bot unlocked ("UNLOCK BOT 600" on the others), as its row's Unlocked says.
const BOT_LISTS: [string, string][] = [
    ['Flame Bot', 'FlameBotPresets'], ['Thunder Bot', 'ThunderBotPresets'], ['Golden Bot', 'GoldenBotPresets'],
    ['Amplify Bot', 'AmplifyBotPresets'], ['Bot Bot', 'BotBotPresets'],
];
const fromSaveOrder = (l: number[]) => [l[3] ?? 0, l[2] ?? 0, l[0] ?? 0, l[1] ?? 0];

function parseBots(raw: Raw): BotImport | null {
    if (!BOT_LISTS.some(([, key]) => Array.isArray(raw[key]))) return null;
    const out: BotImport = { owned: {}, medals: {}, plusOwned: {}, plusLv: {}, unlocked: {}, plusUnlocked: {}, loadouts: {} };
    for (const [name, key] of BOT_LISTS) {
        const rows = arr(raw[key]).filter(isObj);
        const config = BOTS_CONFIG.find(b => b.name === name);
        if (!config || rows.length === 0) continue;
        out.owned[name] = rows.some(r => r.Unlocked === true);
        out.plusOwned[name] = out.owned[name] && rows.some(r => r.PlusUnlocked === true);
        out.medals[name] = {};
        out.plusLv[name] = {};
        out.unlocked[name] = {};
        out.plusUnlocked[name] = {};
        for (let i = 0; i < APP_PRESETS; i++) {
            const g = arr(raw.GlobalPresets)[i];
            const idx = isObj(g) && typeof g.BotsIndex === 'number' ? g.BotsIndex : 0;
            const row = rows[clamp(idx, 0, rows.length - 1)];
            const bought = fromSaveOrder(arr(row.Levels).map(num));
            const picked = fromSaveOrder(arr(row.SelectedLevels).map(num));
            out.medals[name][i] = bought
                .map((v, k) => clamp(Math.max(v, picked[k]), 0, config.stats[k]?.values.length ?? 0));
            out.plusLv[name][i] = row.PlusUnlocked === true ? clamp(Math.floor(num(row.PlusLevel)), 0, config.plusMax) : 0;
            out.unlocked[name][i] = row.Unlocked === true;
            out.plusUnlocked[name][i] = row.Unlocked === true && row.PlusUnlocked === true;
            if (row.Active === true && row.Unlocked === true) (out.loadouts[i] ??= []).push(name);
        }
    }
    for (let i = 0; i < APP_PRESETS; i++) out.loadouts[i] ??= [];
    return out;
}

// ── Labs being researched (29.1.3+ exports) ───────────────────
// Per lab slot: LabActiveBool, LabResearchInt (the game's lab number),
// LabSpeedUpSpeed and LabSpeedUpRemainingSeconds (as of ExportedAt);
// ResearchCompleteDate is per lab number.
function parseLabsRunning(raw: Raw): LabRunning[] | null {
    const active = arr(raw.LabActiveBool);
    if (active.length === 0) return null;
    const exportedAt = dateMs(raw.ExportedAt);
    const out: LabRunning[] = [];
    active.forEach((on, slot) => {
        if (on !== true) return;
        const labIndex = num(arr(raw.LabResearchInt)[slot]);
        // Card mastery labs aren't in GAME_LABS: "Enemy Balance Mastery" (169,
        // owner's Labs screen 2026-10-21).
        const mastery = MASTERY_LAB_CARDS[labIndex - MASTERY_LAB_START];
        out.push({
            lab: GAME_LABS[labIndex] ?? (mastery ? `${mastery} Mastery` : null),
            labIndex,
            // ResearchLevel doesn't count the level being researched (owner's
            // Labs screen: stored 19 while researching Lv.20).
            toLevel: num(arr(raw.ResearchLevel)[labIndex]) + 1,
            doneAt: dateMs(arr(raw.ResearchCompleteDate)[labIndex]),
            speedUp: num(arr(raw.LabSpeedUpSpeed)[slot]),
            speedUpLeftSec: num(arr(raw.LabSpeedUpRemainingSeconds)[slot]),
            exportedAt,
        });
    });
    return out;
}

// Dissonant Boosts: each track's best wave, indexed by tier number. Checked on
// the owner's Dissonant Boosts panel (2026-10-31): T13–T17 on all four tracks
// match the export (a tier without a run reads 0, "—" on the panel).
function parseDissonance(raw: Raw): DissonanceWaves | null {
    if (!Array.isArray(raw.DissonanceDamageBoost)) return null;
    return {
        attack: arr(raw.DissonanceDamageBoost).map(num),
        defense: arr(raw.DissonanceHealthBoost).map(num),
        utility: arr(raw.DissonanceCoinBoost).map(num),
        uw: arr(raw.DissonanceUltDamageBoost).map(num),
    };
}

// How far each lab's next level has got: ResearchPercentComplete by lab
// number, kept when a lab is stopped; ResearchLevel doesn't count that level.
// Checked on the owner's export (2026-10-21): on all 4 running labs with a
// table time, time left ÷ (table time × (1 − percent)) gave one lab speed, the
// ×5.036 the Labs Speed lab and relics give (anchor in upgradeCosts.test.ts).
// Labs sharing a number in an unknown order (GAME_LAB_GROUPS) are left out.
function parseLabProgress(raw: Raw): LabProgress | null {
    if (!Array.isArray(raw.ResearchPercentComplete)) return null;
    const percent = arr(raw.ResearchPercentComplete).map(num);
    const levels = arr(raw.ResearchLevel).map(num);
    const active = arr(raw.LabActiveBool);
    const running = new Set(arr(raw.LabResearchInt).map(num).filter((_, slot) => active[slot] === true));
    const out: LabProgress = {};
    for (const [n, name] of Object.entries(GAME_LABS)) {
        const lab = Number(n);
        const done = clamp(percent[lab] ?? 0, 0, 1);
        if (done > 0 || running.has(lab)) {
            out[name] = { toLevel: (levels[lab] ?? 0) + 1, done, ...(running.has(lab) ? { running: true } : {}) };
        }
    }
    return out;
}

// The Guardian: owned chips, the game's Guardian presets (slots bought,
// equipped chips, 3 levels per chip — chips by save index, see
// constants/guardianData.ts) and which one each site preset uses
// (GlobalPresets[i].GuardiansIndex). The live fields are the current
// preset's. Checked on a real account (docs/game-export-format.md).
function parseGuardian(raw: Raw): GuardianData | null {
    if (typeof raw.GuardianUnlocked !== 'boolean' && !Array.isArray(raw.GuardianChipLevel)) return null;
    const levels = (v: unknown) => CHIPS.flatMap((c, i) =>
        [0, 1, 2].map(k => clamp(num(arr(v)[i * 3 + k]), 0, c.stats[k].max)));
    const chips = (v: unknown) => [0, 1, 2].map(i => {
        const n = num(arr(v)[i] ?? -1);
        return Number.isInteger(n) && n >= 0 && n < CHIPS.length ? n : -1;
    });
    const live: GuardianPreset = {
        name: 'Preset 1',
        extraSlots: clamp(num(raw.GuardianSlotsUnlocked), 0, 2),
        chips: chips(raw.GuardianChipSlot),
        levels: levels(raw.GuardianChipLevel),
    };
    const presets: GuardianPreset[] = arr(raw.GuardianPresets).filter(isObj).map((p, i) => ({
        name: typeof p.PresetName === 'string' && p.PresetName.trim() ? p.PresetName : `Preset ${i + 1}`,
        extraSlots: clamp(num(p.SlotsUnlocked), 0, 2),
        chips: chips(p.ChipSlot),
        levels: levels(p.ChipLevel),
    }));
    const current = clamp(num(raw.CurrentGuardianPreset), 0, Math.max(0, presets.length - 1));
    if (presets.length === 0) presets.push(live);
    else presets[current] = { ...live, name: presets[current].name };
    const presetFor = Array.from({ length: APP_PRESETS }, (_, i) => {
        const g = arr(raw.GlobalPresets)[i];
        const idx = isObj(g) && typeof g.GuardiansIndex === 'number' ? g.GuardiansIndex : current;
        return clamp(idx, 0, presets.length - 1);
    });
    return {
        ...(typeof raw.InGuild === 'boolean' ? { inGuild: raw.InGuild } : {}),
        unlocked: raw.GuardianUnlocked === true,
        chipsOwned: CHIPS.map((_, i) => arr(raw.GuardianChipUnlocked)[i] === true),
        skinsOwned: Math.max(1, arr(raw.GuardianSkinUnlocked).filter(v => v === true).length),
        presets,
        presetFor,
    };
}

// A run worth listing: it got past wave 1 (not a quick restart).
export const isRealRun = (b: BattleReport) => b.wave > 1 && b.totalEnemies > 0;

// The battle the optimizer should calibrate from by default: the newest
// full-length run on the player's usual farming tier (the non-tournament
// tier they run most), so short test starts and tournaments are skipped.
// Battle history is stored oldest → newest. -1 when nothing qualifies.
export function defaultBattleIndex(battles: BattleReport[]): number {
    const runs = battles.map((b, i) => ({ b, i })).filter(({ b }) => !b.tournament && !isDissonantRun(b) && isRealRun(b));
    if (runs.length === 0) return -1;

    const countByTier = new Map<number, number>();
    for (const { b } of runs) countByTier.set(b.tier, (countByTier.get(b.tier) ?? 0) + 1);
    const farmTier = [...countByTier.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];

    const onTier = runs.filter(({ b }) => b.tier === farmTier);
    const bestWave = Math.max(...onTier.map(({ b }) => b.wave));
    const full = onTier.filter(({ b }) => b.wave >= 0.9 * bestWave);
    return (full.length ? full : onTier)[(full.length ? full : onTier).length - 1].i;
}
