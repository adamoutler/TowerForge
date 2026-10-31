// ============================================================
//  TowerForge Companion — Game State Store
//  Zustand store. Single source of truth for all game state.
//
//  Structure:
//    - State slices (one per tab)
//    - Actions (load, save, update per slice)
//    - Persistence (localStorage for now, DB-ready interface)
//
//  localStorage keys match v8 exactly for save compatibility.
// ============================================================

import { create } from 'zustand';
import type {
    AppState,
    Profile,
    PerkData,
    TierWaves,
    WSPreset,
    EnhData,
    LabData,
    CardData,
    CardEntry,
    UWData,
    RelicData,
    BotData,
    BotEntry,
    BotLevels,
    BotLoadouts,
    Currencies,
    ModuleState,
    ModuleType,
    SlotLevels,
    AssistEntry,
    TabName,
    DissonanceTrack, DissonanceWaves, GuardianData, LabProgress, LabRunning, TourneyLog, TourneyLogEntry, TourneyRecord,
} from '../types/gameTypes';
import { mergeBattles } from '../engine/battleReport';
import { loadoutForPreset } from '../engine/statHelpers';
import { emptyDissonance } from '../engine/dissonance';
import { mergeTourneyRecords } from '../engine/tourneyHistory';
import type { BattleReport } from '../engine/battleReport';
import { defaultBattleIndex } from '../engine/gameExport';
import type { GameImport } from '../engine/gameExport';
import { MAPPED_PERK_IDS } from '../constants/gameExportMaps';
import { botsForPreset, isBotEntryOwned, isBotPlusOwned } from '../constants/botData';
import { defaultGuardianData } from '../engine/guardian';

// A bot entry with one preset's levels replaced (ownership made explicit so
// a preset at all-Lv 0 can't make an old save read the bot as not owned).
function withPresetLevels(entry: BotEntry, presetIdx: number, levels: BotLevels): BotEntry {
    return {
        ...entry, owned: isBotEntryOwned(entry), plusOwned: isBotPlusOwned(entry),
        presets: { ...entry.presets, [presetIdx]: { ...entry.presets?.[presetIdx], ...levels } },
    };
}

// Bots unlock per preset in game. The first per-preset unlock or lock writes
// every preset's current state down, so the other presets keep theirs.
const BOT_PRESETS = 5;
function withPresetFlags(entry: BotEntry): BotEntry {
    const presets: Record<number, BotLevels> = {};
    for (let i = 0; i < BOT_PRESETS; i++) {
        const cur = botsForPreset({ bot: entry }, i).bot;
        presets[i] = { medals: cur.medals, plusLv: cur.plusLv, owned: !!cur.owned, plusOwned: !!cur.plusOwned };
    }
    return { ...entry, presets };
}
const anyPreset = (e: BotEntry, flag: 'owned' | 'plusOwned') => Object.values(e.presets ?? {}).some(p => p[flag]);

// ── localStorage Keys ─────────────────────────────────────────
// Matches v8 keys exactly — existing saves load without migration.
const KEYS = {
    profile: 'tc_profile',
    tiers: 'tc_tiers',
    workshop: 'tc_ws',
    enh: 'tc_enh',
    labs: 'tc_labs',
    cards: 'tc_cards',
    uw: 'tc_uw',
    relics: 'tc_relics',
    perks: 'tc_perks',
    bots: 'tc_bots',
    botLoadouts: 'tc_bot_loadouts',
    battleReport: 'tc_battle_report',
    currencies: 'tc_currencies',
    importedBattles: 'tc_imported_battles',
    battleReportChoice: 'tc_battle_choice',
    modules: 'tc_modules',
    guardian: 'tc_guardian',
    labsRunning: 'tc_labs_running',
    labProgress: 'tc_lab_progress',
    dissonance: 'tc_dissonance',
    tourneyLog: 'tc_tourney_log',
    tourneyRecords: 'tc_tourney_records',
    vault: 'tc_vault',
} as const;

// ── Default State ─────────────────────────────────────────────
const DEFAULT_CURRENCIES: Currencies = {
    coins: 0, gems: 0, stones: 0, medals: 0, cells: 0, keys: 0, tokens: 0, bits: 0,
};
const defaultProfile: Profile = {
    name: '',
    league: '',
    build: '',
    presets: 2,
    wall: false,
    highestTier: 0,
    completedTier: 0,
};

const defaultWSPreset = (): WSPreset => ({
    attack: [],
    defense: [],
    utility: [],
});

const defaultEnhData: EnhData = { d: {}, u: {} };

const defaultCardData: CardData = {
    data: {},
    slots: 1,
    presets: {},
};

// Migrate card mastery from the old single-field encoding (m=0 = not unlocked,
// m=1–10 = mastery levels, value indexed [m-1]) to the new model (mu = unlocked
// flag + m = in-game level 0–9, value indexed [m]). Detected per-entry by a
// missing `mu` field, so it's idempotent and only touches legacy data.
function migrateCardData(cardData: CardData): CardData {
    if (!cardData?.data) return cardData;
    const data: Record<string, CardEntry> = {};
    for (const [name, entry] of Object.entries(cardData.data)) {
        if (entry && entry.mu === undefined) {
            const oldM = entry.m ?? 0;
            data[name] = oldM > 0
                ? { ...entry, mu: true, m: Math.min(9, oldM - 1) } // unlocked → game Lv (oldM-1)
                : { ...entry, mu: false, m: 0 };                    // was "not unlocked"
        } else {
            data[name] = entry;
        }
    }
    return { ...cardData, data };
}

const defaultUWData: UWData = {
    data: {},
    stones: 0,
};

const MODULE_TYPES: ModuleType[] = ['cannon', 'armor', 'generator', 'core'];

function defaultSlotLevels(): SlotLevels {
    return {
        cannon: { main: 0, assist: 0 },
        armor: { main: 0, assist: 0 },
        generator: { main: 0, assist: 0 },
        core: { main: 0, assist: 0 },
    };
}

const defaultModuleState: ModuleState = {
    library: [],
    loadouts: [],
    assistData: {},
    slotLevels: defaultSlotLevels(),
};

// Modules follow the preset when the game's Global Presets say which it uses
// (ModuleState.loadoutFor), so the calculators read the right loadout.
function withPresetLoadout(ms: ModuleState, preset: number): ModuleState {
    const id = loadoutForPreset(ms, preset);
    return id && id !== ms.activeLoadout ? { ...ms, activeLoadout: id } : ms;
}

// Migrate module state: level used to live on each library module; it now
// lives on the loadout SLOT (account-wide slotLevels). When slotLevels is
// absent, derive it from the first loadout's currently-equipped modules so the
// active setup keeps its effective levels. Idempotent (skips once present).
function migrateModuleState(raw: ModuleState): ModuleState {
    // Normalize loadout slot shape first ([main,assist] tuple → {main,assist}).
    const loadouts = (raw.loadouts ?? []).map(lo => ({
        ...lo,
        slots: {
            cannon: migrateSlot(lo.slots.cannon),
            armor: migrateSlot(lo.slots.armor),
            generator: migrateSlot(lo.slots.generator),
            core: migrateSlot(lo.slots.core),
        },
    }));

    const assistData = Object.fromEntries(
        Object.entries(raw.assistData ?? {}).map(([type, entry]) => [type, migrateAssistEntry(entry)]),
    );

    let slotLevels = raw.slotLevels;
    if (!slotLevels) {
        slotLevels = defaultSlotLevels();
        const lib = raw.library ?? [];
        // Legacy modules carried a `level` field — look it up by equipped id.
        const levelOf = (id: string) =>
            (lib.find(m => m.id === id) as (typeof lib[number] & { level?: number }) | undefined)?.level ?? 0;
        const lo0 = loadouts[0];
        if (lo0) {
            for (const type of MODULE_TYPES) {
                const slot = lo0.slots[type];
                slotLevels[type] = { main: levelOf(slot.main), assist: levelOf(slot.assist) };
            }
        }
    }

    return { ...raw, loadouts, assistData, slotLevels };
}

// ── Helpers ───────────────────────────────────────────────────
function loadKey<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function saveKey<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        console.warn(`TowerForge: failed to save ${key}`);
    }
}

// ── Store Interface ───────────────────────────────────────────
interface GameStore extends AppState {

    // ── UI Actions ──────────────────────────────────────────────
    setActiveTab: (tab: TabName) => void;
    setActivePreset: (idx: number) => void;

    // ── Load All (called once on app init) ──────────────────────
    loadAll: () => void;

    // ── Profile ─────────────────────────────────────────────────
    updateProfile: (patch: Partial<Profile>) => void;

    // ── Perks ────────────────────────────────────────────────────
    togglePerk: (perkId: string) => void;

    // ── Tiers ────────────────────────────────────────────────────
    setTierWave: (tier: number, wave: number) => void;
    setDissonanceWave: (track: DissonanceTrack, tier: number, wave: number) => void;

    // ── Workshop ─────────────────────────────────────────────────
    setWSStat: (presetIdx: number, cat: 'attack' | 'defense' | 'utility', statIdx: number, value: number) => void;
    setEnhLevel: (cat: string, idx: number, value: number) => void;
    setEnhOwned: (cat: string, idx: number, owned: boolean) => void;

    // ── Labs ─────────────────────────────────────────────────────
    setLabLevel: (labName: string, level: number) => void;
    setAllLabs: (data: LabData) => void;

    // ── Cards ────────────────────────────────────────────────────
    setCardStars: (cardName: string, stars: number) => void;
    setCardMastery: (cardName: string, mastery: number) => void;
    setCardMasteryUnlocked: (cardName: string, unlocked: boolean) => void;
    setCardSlots: (slots: number) => void;
    setCardPreset: (presetIdx: number, cards: string[]) => void;

    // ── UW ───────────────────────────────────────────────────────
    setUWStat: (abbr: string, statIdx: number, value: number) => void;
    setUWOwned: (abbr: string, owned: boolean) => void;
    setUWPlusOwned: (abbr: string, owned: boolean) => void;
    setUWPlusLevel: (abbr: string, level: number) => void;
    setStones: (stones: number) => void;

    // ── Relics ───────────────────────────────────────────────────
    setRelic: (key: string, value: number) => void;

    // ── Vault ────────────────────────────────────────────────────
    // An upgrade's level by vault id, or a section's unlock ("g<group>", 0/1).
    setVaultLevel: (key: string, value: number) => void;

    // ── Bots ─────────────────────────────────────────────────────
    setBotOwned: (botName: string, owned: boolean, presetIdx?: number) => void;
    setBotMedal: (botName: string, presetIdx: number, medalIdx: number, value: number) => void;
    setBotPlusLevel: (botName: string, presetIdx: number, level: number) => void;
    setBotPlusOwned: (botName: string, owned: boolean, presetIdx?: number) => void;
    setBotLoadout: (presetIdx: number, bots: string[]) => void;

    // ── Optimizer ────────────────────────────────────────────────
    setBattleReportText: (text: string) => void;
    setBattleReportChoice: (choice: number) => void;

    // ── Currencies & game data import ────────────────────────────
    setCurrency: (key: keyof Currencies, value: number) => void;
    applyGameImport: (imp: GameImport) => void;

    // ── Guardian ─────────────────────────────────────────────────
    setGuardianData: (patch: Partial<GuardianData>) => void;
    setTourneyLogEntry: (runKey: string, entry: TourneyLogEntry | null) => void;

    // ── Modules ──────────────────────────────────────────────────
    setModuleState: (patch: Partial<ModuleState>) => void;
    setSlotLevel: (type: ModuleType, position: 'main' | 'assist', level: number) => void;
    updateAssist: (type: string, key: keyof AssistEntry, value: number) => void;
    updateAssistRarity: (type: string, rarity: 'locked' | 'Epic' | 'Legendary' | 'Mythic' | 'Ancestral') => void;

    // ── Export / Import ──────────────────────────────────────────
    exportData: () => string;
    importData: (json: string) => boolean;
    // Wipes every saved stat from this device (used when signing out).
    resetAll: () => void;
}

// Migrates old [string, string] slot tuples to { main, assist }
function migrateSlot(slot: unknown): { main: string; assist: string } {
    if (Array.isArray(slot)) return { main: slot[0] ?? '', assist: slot[1] ?? '' };
    if (slot && typeof slot === 'object' && 'main' in slot) return slot as { main: string; assist: string };
    return { main: '', assist: '' };
}

// Migrates old { mainLabLv, subLabLv, mainStonePct, subStonePct, mainModuleId,
// subModuleId } assist entries to the simplified { multEff, subEff } shape.
function migrateAssistEntry(entry: unknown): AssistEntry {
    const e = (entry ?? {}) as Record<string, unknown>;
    const rarity = (typeof e.rarity === 'string' ? e.rarity : 'locked') as 'locked' | 'Epic' | 'Legendary' | 'Mythic' | 'Ancestral';
    if (typeof e.multEff === 'number' || typeof e.subEff === 'number') {
        return { rarity, multEff: (e.multEff as number) ?? 0, subEff: (e.subEff as number) ?? 0 };
    }
    const num = (v: unknown) => typeof v === 'number' ? v : 0;
    return {
        rarity,
        multEff: Math.min(100, num(e.mainLabLv) + num(e.mainStonePct)),
        subEff: Math.min(100, num(e.subLabLv) + num(e.subStonePct)),
    };
}

// ── Store Implementation ──────────────────────────────────────
export const useGameStore = create<GameStore>((set, get) => ({

    // ── Initial State ────────────────────────────────────────────
    activeTab: 'profile',
    activePreset: 0,
    profile: defaultProfile,
    perkData: { banned: [] },
    tierWaves: {},
    wsData: Array.from({ length: 5 }, defaultWSPreset),
    enhData: defaultEnhData,
    labData: {},
    cardData: defaultCardData,
    uwData: defaultUWData,
    relicData: {},
    botData: {},
    botLoadouts: {},
    moduleState: defaultModuleState,
    battleReportText: '',
    currencies: { ...DEFAULT_CURRENCIES },
    importedBattles: [],
    battleReportChoice: -1,
    guardianData: defaultGuardianData(),
    labsRunning: [],
    labProgress: {},
    dissonanceWaves: emptyDissonance(),
    tourneyLog: {},
    tourneyRecords: [],
    vaultLevels: {},

    // ── UI Actions ────────────────────────────────────────────────
    setActiveTab: (tab) => set({ activeTab: tab }),

    setActivePreset: (idx) => {
        const before = get().moduleState;
        const moduleState = withPresetLoadout(before, idx);
        set({ activePreset: idx, moduleState });
        if (moduleState !== before) saveKey(KEYS.modules, moduleState);
    },



    // ── Load All ──────────────────────────────────────────────────
    loadAll: () => {
        // Imports kept a second copy of the whole game file here until
        // 2026-10-23 (nothing read it): free the space.
        try { localStorage.removeItem('tc_cloud_save'); } catch { /* storage blocked */ }
        const profile = loadKey<Profile>(KEYS.profile, defaultProfile);
        const tierWaves = loadKey<TierWaves>(KEYS.tiers, {});
        const wsData = loadKey<WSPreset[]>(KEYS.workshop, Array.from({ length: 5 }, defaultWSPreset));
        const enhData = loadKey<EnhData>(KEYS.enh, defaultEnhData);
        const labData = loadKey<LabData>(KEYS.labs, {});
        const cardData = migrateCardData(loadKey<CardData>(KEYS.cards, defaultCardData));
        const uwData = loadKey<UWData>(KEYS.uw, defaultUWData);
        const relicData = loadKey<RelicData>(KEYS.relics, {});
        const perkData = loadKey<PerkData>(KEYS.perks, { banned: [] });
        const botData = loadKey<BotData>(KEYS.bots, {});
        const botLoadouts = loadKey<BotLoadouts>(KEYS.botLoadouts, {});
        const battleReportText = loadKey<string>(KEYS.battleReport, '');
        const currencies = { ...DEFAULT_CURRENCIES, ...loadKey<Partial<Currencies>>(KEYS.currencies, {}) };
        const importedBattles = loadKey<BattleReport[]>(KEYS.importedBattles, []);
        const battleReportChoice = loadKey<number>(KEYS.battleReportChoice, -1);
        // The site opens on its first preset, so its modules go with it.
        const moduleState = withPresetLoadout(migrateModuleState(loadKey<ModuleState>(KEYS.modules, defaultModuleState)), get().activePreset);
        const guardianData = { ...defaultGuardianData(), ...loadKey<Partial<GuardianData>>(KEYS.guardian, {}) };
        const labsRunning = loadKey<LabRunning[]>(KEYS.labsRunning, []);
        const labProgress = loadKey<LabProgress>(KEYS.labProgress, {});
        const dissonanceWaves = loadKey<DissonanceWaves>(KEYS.dissonance, emptyDissonance());
        const tourneyLog = loadKey<TourneyLog>(KEYS.tourneyLog, {});
        const tourneyRecords = loadKey<TourneyRecord[]>(KEYS.tourneyRecords, []);
        const vaultLevels = loadKey<Record<string, number>>(KEYS.vault, {});

        set({
            profile, tierWaves, wsData, enhData,
            labData, cardData, uwData, relicData,
            perkData, botData, botLoadouts, moduleState, battleReportText, currencies, importedBattles, battleReportChoice,
            guardianData, labsRunning, labProgress, dissonanceWaves, tourneyLog, tourneyRecords, vaultLevels,
        });
    },

    // ── Bot Loadouts ──────────────────────────────────────────────
    setBotLoadout: (presetIdx, bots) => {
        const next = { ...get().botLoadouts, [presetIdx]: bots };
        set({ botLoadouts: next });
        saveKey(KEYS.botLoadouts, next);
    },

    // ── Optimizer ─────────────────────────────────────────────────
    setBattleReportText: (text) => {
        set({ battleReportText: text });
        saveKey(KEYS.battleReport, text);
    },

    setBattleReportChoice: (choice) => {
        set({ battleReportChoice: choice });
        saveKey(KEYS.battleReportChoice, choice);
    },

    // ── Currencies & game data import ─────────────────────────────
    setCurrency: (key, value) => {
        const currencies = { ...get().currencies, [key]: value };
        set({ currencies });
        saveKey(KEYS.currencies, currencies);
    },

    // Applies the parts of the game's export we can read with confidence.
    applyGameImport: (imp) => {
        const s = get();
        const tierWaves = { ...s.tierWaves, ...imp.tierWaves };
        const profile: Profile = {
            ...s.profile,
            ...(imp.userName ? { name: imp.userName } : {}),
            ...(imp.highestTier > 0 ? { highestTier: imp.highestTier, completedTier: imp.completedTier } : {}),
            ...(imp.fivePresets ? { presets: 5 as const } : {}),
            ...(imp.league ? { league: imp.league } : {}),
            ...(imp.currentLeague ? { currentLeague: imp.currentLeague } : {}),
            ...(imp.wallUnlocked ? { wall: true } : {}),
            ...(imp.wsUnlocked ? { wsUnlocked: imp.wsUnlocked } : {}),
            ...(imp.labSlots ? { labSlots: imp.labSlots } : {}),
            ...(imp.presetNames.some(n => n) ? { presetNames: imp.presetNames } : {}),
        };
        // Runs add to the history already kept (the file only has the last 5).
        const battles = mergeBattles(s.importedBattles, imp.battles);
        const choice = defaultBattleIndex(battles);
        const wsData = imp.workshop ?? s.wsData;
        const enhData = imp.enhancements ?? s.enhData;
        const uwData = imp.uws ? { ...s.uwData, data: imp.uws } : s.uwData;
        // Cards and labs the game file can't name (unconfirmed numbers) keep their entered values.
        const cardData: CardData = {
            ...s.cardData,
            ...(imp.cardSlots > 0 ? { slots: imp.cardSlots } : {}),
            ...(imp.cards ? {
                data: { ...s.cardData.data, ...imp.cards.data },
                presets: { ...s.cardData.presets, ...imp.cards.presets },
            } : {}),
        };
        const perkData = imp.bannedPerks
            ? { banned: [...imp.bannedPerks, ...s.perkData.banned.filter(id => !MAPPED_PERK_IDS.has(id))] }
            : s.perkData;
        const labData = imp.labs ? { ...s.labData, ...imp.labs } : s.labData;
        // Modules: the game's loadouts, assist slots and slot levels replace the
        // site's; imported modules replace same-named library entries, and
        // entered modules the file can't name yet are kept.
        const importedNames = new Set(imp.modules?.state.library.map(m => m.name));
        const moduleState: ModuleState = imp.modules
            ? withPresetLoadout({
                ...imp.modules.state,
                library: [
                    ...imp.modules.state.library,
                    ...s.moduleState.library.filter(m => !importedNames.has(m.name)),
                ],
            }, s.activePreset)
            : s.moduleState;
        const guardianData = imp.guardian ?? s.guardianData;
        // Bots (29.1.3+ files): medal and Bot+ levels per preset, which bots
        // and Bot+ are unlocked, and which bots run.
        let botData = s.botData;
        let botLoadouts = s.botLoadouts;
        if (imp.bots) {
            botData = { ...s.botData };
            for (const [name, byPreset] of Object.entries(imp.bots.medals)) {
                const entry = s.botData[name] ?? { medals: [], plusLv: 0 };
                const presets: Record<number, BotLevels> = { ...entry.presets };
                for (const [i, medals] of Object.entries(byPreset)) {
                    const p = Number(i);
                    presets[p] = {
                        medals: [...medals], plusLv: imp.bots.plusLv[name]?.[p] ?? 0,
                        owned: imp.bots.unlocked[name]?.[p] ?? false, plusOwned: imp.bots.plusUnlocked[name]?.[p] ?? false,
                    };
                }
                botData[name] = {
                    ...entry, owned: imp.bots.owned[name] ?? false, plusOwned: imp.bots.plusOwned[name] ?? false, presets,
                };
            }
            botLoadouts = { ...s.botLoadouts, ...imp.bots.loadouts };
        }
        // A snapshot: an older file (no lab timers) clears the last one's.
        const labsRunning = imp.labsRunning ?? [];
        const labProgress = imp.labProgress ?? {};
        const dissonanceWaves = imp.dissonance ?? s.dissonanceWaves;
        // Relics: the totals of the relics owned (older saves typed them in).
        const relicData = imp.relics ? imp.relics.totals : s.relicData;
        // Every tournament: kept across imports (older files don't have them).
        const tourneyRecords = imp.tourneyRecords ? mergeTourneyRecords(s.tourneyRecords, imp.tourneyRecords) : s.tourneyRecords;
        set({
            currencies: imp.currencies,
            tierWaves,
            profile,
            importedBattles: battles,
            battleReportChoice: choice,
            wsData, enhData, uwData, cardData, perkData, labData, moduleState, guardianData, botData, botLoadouts, labsRunning, labProgress, dissonanceWaves,
            tourneyRecords, relicData, vaultLevels: imp.vault ?? s.vaultLevels,
        });
        saveKey(KEYS.tourneyRecords, tourneyRecords);
        saveKey(KEYS.vault, imp.vault ?? s.vaultLevels);
        saveKey(KEYS.relics, relicData);
        saveKey(KEYS.guardian, guardianData);
        saveKey(KEYS.bots, botData);
        saveKey(KEYS.botLoadouts, botLoadouts);
        saveKey(KEYS.labsRunning, labsRunning);
        saveKey(KEYS.labProgress, labProgress);
        saveKey(KEYS.dissonance, dissonanceWaves);
        saveKey(KEYS.currencies, imp.currencies);
        saveKey(KEYS.tiers, tierWaves);
        saveKey(KEYS.profile, profile);
        saveKey(KEYS.importedBattles, battles);
        saveKey(KEYS.battleReportChoice, choice);
        saveKey(KEYS.workshop, wsData);
        saveKey(KEYS.enh, enhData);
        saveKey(KEYS.uw, uwData);
        saveKey(KEYS.cards, cardData);
        saveKey(KEYS.perks, perkData);
        saveKey(KEYS.labs, labData);
        saveKey(KEYS.modules, moduleState);
    },

    // ── Profile ───────────────────────────────────────────────────
    updateProfile: (patch) => {
        const profile = { ...get().profile, ...patch };
        set({ profile });
        saveKey(KEYS.profile, profile);
    },

    // ── Perks ─────────────────────────────────────────────────────
    togglePerk: (perkId) => {
        const banned = [...(get().perkData.banned ?? [])];
        const idx = banned.indexOf(perkId);
        if (idx >= 0) banned.splice(idx, 1);
        else banned.push(perkId);
        const perkData = { banned };
        set({ perkData });
        saveKey(KEYS.perks, perkData);
    },

    // ── Tiers ─────────────────────────────────────────────────────
    setTierWave: (tier, wave) => {
        const tierWaves = { ...get().tierWaves, [tier]: wave };
        set({ tierWaves });
        saveKey(KEYS.tiers, tierWaves);
    },

    setDissonanceWave: (track, tier, wave) => {
        const list = [...(get().dissonanceWaves[track] ?? [])];
        for (let i = list.length; i < tier; i++) list[i] = 0;
        list[tier] = wave;
        const dissonanceWaves = { ...get().dissonanceWaves, [track]: list };
        set({ dissonanceWaves });
        saveKey(KEYS.dissonance, dissonanceWaves);
    },

    // ── Workshop ──────────────────────────────────────────────────
    setWSStat: (presetIdx, cat, statIdx, value) => {
        const wsData = get().wsData.map((p, i) => {
            if (i !== presetIdx) return p;
            const updated = [...(p[cat] ?? [])];
            updated[statIdx] = value;
            return { ...p, [cat]: updated };
        });
        set({ wsData });
        saveKey(KEYS.workshop, wsData);
    },

    // Writes to the active preset's own levels once presets have them.
    setEnhLevel: (cat, idx, value) => {
        const { enhData, activePreset } = get();
        const levels = enhData.p ? (enhData.p[activePreset] ?? enhData.d) : enhData.d;
        const d = { ...levels };
        if (!d[cat]) d[cat] = [];
        d[cat] = [...d[cat]];
        d[cat][idx] = value;
        const next = enhData.p
            ? { ...enhData, p: { ...enhData.p, [activePreset]: d } }
            : { ...enhData, d };
        set({ enhData: next });
        saveKey(KEYS.enh, next);
    },

    setEnhOwned: (cat, idx, owned) => {
        const enhData = get().enhData;
        const u = { ...enhData.u };
        if (!u[cat]) u[cat] = [];
        u[cat] = [...u[cat]];
        u[cat][idx] = owned;
        const next = { ...enhData, u };
        set({ enhData: next });
        saveKey(KEYS.enh, next);
    },

    // ── Labs ──────────────────────────────────────────────────────
    setLabLevel: (labName, level) => {
        const labData = { ...get().labData, [labName]: level };
        set({ labData });
        saveKey(KEYS.labs, labData);
    },

    setAllLabs: (data) => {
        set({ labData: data });
        saveKey(KEYS.labs, data);
    },

    // ── Cards ─────────────────────────────────────────────────────
    setCardStars: (cardName, stars) => {
        const cardData = get().cardData;
        const entry = cardData.data[cardName] ?? { s: 0, m: 0 };
        const next = {
            ...cardData,
            data: { ...cardData.data, [cardName]: { ...entry, s: stars } },
        };
        set({ cardData: next });
        saveKey(KEYS.cards, next);
    },

    setCardMastery: (cardName, mastery) => {
        const cardData = get().cardData;
        const entry = cardData.data[cardName] ?? { s: 0, m: 0 };
        const next = {
            ...cardData,
            data: { ...cardData.data, [cardName]: { ...entry, m: mastery } },
        };
        set({ cardData: next });
        saveKey(KEYS.cards, next);
    },

    setCardMasteryUnlocked: (cardName, unlocked) => {
        const cardData = get().cardData;
        const entry = cardData.data[cardName] ?? { s: 0, m: 0 };
        const next = {
            ...cardData,
            data: { ...cardData.data, [cardName]: { ...entry, mu: unlocked } },
        };
        set({ cardData: next });
        saveKey(KEYS.cards, next);
    },

    setCardSlots: (slots) => {
        const cardData = { ...get().cardData, slots };
        set({ cardData });
        saveKey(KEYS.cards, cardData);
    },

    setCardPreset: (presetIdx, cards) => {
        const cardData = get().cardData;
        const next = {
            ...cardData,
            presets: { ...cardData.presets, [presetIdx]: cards },
        };
        set({ cardData: next });
        saveKey(KEYS.cards, next);
    },

    // ── UW ────────────────────────────────────────────────────────
    setUWStat: (abbr, statIdx, value) => {
        const uwData = get().uwData;
        const entry = uwData.data[abbr as keyof typeof uwData.data];
        if (!entry) return;
        const sv = [...entry.sv] as [number, number, number];
        sv[statIdx] = value;
        const next = {
            ...uwData,
            data: { ...uwData.data, [abbr]: { ...entry, sv } },
        };
        set({ uwData: next });
        saveKey(KEYS.uw, next);
    },

    setUWOwned: (abbr, owned) => {
        const uwData = get().uwData;
        const existing = uwData.data[abbr as keyof typeof uwData.data];
        // When marking owned for the first time initialize stats to lv 1
        const entry = existing ?? {
            own: false,
            sv: [1, 1, 1] as [number, number, number],
            upOwn: false,
            upLvl: 0,
        };
        // If already existed but sv was [0,0,0] bump to [1,1,1]
        const sv = owned
            ? entry.sv.map(v => Math.max(1, v)) as [number, number, number]
            : entry.sv;
        const next = {
            ...uwData,
            data: { ...uwData.data, [abbr]: { ...entry, own: owned, sv } },
        };
        set({ uwData: next });
        saveKey(KEYS.uw, next);
    },

    setUWPlusOwned: (abbr, owned) => {
        const uwData = get().uwData;
        const entry = uwData.data[abbr as keyof typeof uwData.data];
        if (!entry) return;
        const next = {
            ...uwData,
            data: { ...uwData.data, [abbr]: { ...entry, upOwn: owned } },
        };
        set({ uwData: next });
        saveKey(KEYS.uw, next);
    },

    setUWPlusLevel: (abbr, level) => {
        const uwData = get().uwData;
        const entry = uwData.data[abbr as keyof typeof uwData.data];
        if (!entry) return;
        const next = {
            ...uwData,
            data: { ...uwData.data, [abbr]: { ...entry, upLvl: level } },
        };
        set({ uwData: next });
        saveKey(KEYS.uw, next);
    },

    setStones: (stones) => {
        const uwData = { ...get().uwData, stones };
        set({ uwData });
        saveKey(KEYS.uw, uwData);
    },

    // ── Relics ────────────────────────────────────────────────────
    setRelic: (key, value) => {
        const relicData = { ...get().relicData, [key]: value };
        set({ relicData });
        saveKey(KEYS.relics, relicData);
    },

    // ── Vault ─────────────────────────────────────────────────────
    setVaultLevel: (key, value) => {
        const vaultLevels = { ...get().vaultLevels };
        if (value > 0) vaultLevels[key] = value;
        else delete vaultLevels[key];
        set({ vaultLevels });
        saveKey(KEYS.vault, vaultLevels);
    },

    // ── Bots ──────────────────────────────────────────────────────
    setBotOwned: (botName, owned, presetIdx) => {
        // Unlocking a bot starts its stats at Lv 0 (base unlock); locking it
        // clears its levels and Bot+. Bots unlock per preset in game, so with
        // a preset only that one changes; without, every preset.
        const botData = get().botData;
        const entry = botData[botName] ?? { medals: [], plusLv: 0 };
        let bot: BotEntry;
        if (presetIdx === undefined) {
            bot = { ...entry, owned, plusOwned: false, medals: [], plusLv: 0, presets: {} };
        } else {
            const e = withPresetFlags(entry);
            e.presets![presetIdx] = { medals: [], plusLv: 0, owned, plusOwned: false };
            bot = { ...e, owned: anyPreset(e, 'owned'), plusOwned: anyPreset(e, 'plusOwned') };
        }
        const next = { ...botData, [botName]: bot };
        set({ botData: next });
        saveKey(KEYS.bots, next);
    },

    // Medal and Bot+ levels belong to one preset (like in game); the first
    // edit copies the levels that preset was showing.
    setBotMedal: (botName, presetIdx, medalIdx, value) => {
        const botData = get().botData;
        const entry = botData[botName] ?? { medals: [], plusLv: 0 };
        const cur = botsForPreset({ [botName]: entry }, presetIdx)[botName];
        const medals = [...cur.medals];
        medals[medalIdx] = value;
        const next = { ...botData, [botName]: withPresetLevels(entry, presetIdx, { medals, plusLv: cur.plusLv }) };
        set({ botData: next });
        saveKey(KEYS.bots, next);
    },

    setBotPlusLevel: (botName, presetIdx, level) => {
        const botData = get().botData;
        const entry = botData[botName] ?? { medals: [], plusLv: 0 };
        const cur = botsForPreset({ [botName]: entry }, presetIdx)[botName];
        const next = { ...botData, [botName]: withPresetLevels(entry, presetIdx, { medals: cur.medals, plusLv: level }) };
        set({ botData: next });
        saveKey(KEYS.bots, next);
    },

    // Unlocking Bot+ starts it at Lv 0; locking it clears its level. With a
    // preset only that one (Bot+ unlocks per preset in game), else every one.
    setBotPlusOwned: (botName, owned, presetIdx) => {
        const botData = get().botData;
        const entry = botData[botName] ?? { medals: [], plusLv: 0 };
        let bot: BotEntry;
        if (presetIdx === undefined) {
            const presets = Object.fromEntries(Object.entries(entry.presets ?? {})
                .map(([i, p]) => [i, { ...p, plusLv: 0, ...(p.owned !== undefined ? { plusOwned: owned && p.owned } : {}) }]));
            bot = { ...entry, owned: isBotEntryOwned(entry), plusOwned: owned, plusLv: 0, presets };
        } else {
            const e = withPresetFlags(entry);
            const p = e.presets![presetIdx];
            e.presets![presetIdx] = { ...p, plusLv: 0, plusOwned: owned && !!p.owned };
            bot = { ...e, owned: anyPreset(e, 'owned'), plusOwned: anyPreset(e, 'plusOwned') };
        }
        const next = { ...botData, [botName]: bot };
        set({ botData: next });
        saveKey(KEYS.bots, next);
    },

    // ── Modules ───────────────────────────────────────────────────
    setTourneyLogEntry: (runKey, entry) => {
        const tourneyLog = { ...get().tourneyLog };
        if (entry) tourneyLog[runKey] = entry;
        else delete tourneyLog[runKey];
        set({ tourneyLog });
        saveKey(KEYS.tourneyLog, tourneyLog);
    },

    setGuardianData: (patch) => {
        const guardianData = { ...get().guardianData, ...patch };
        set({ guardianData });
        saveKey(KEYS.guardian, guardianData);
    },

    setModuleState: (patch) => {
        const moduleState = { ...get().moduleState, ...patch };
        set({ moduleState });
        saveKey(KEYS.modules, moduleState);
    },

    setSlotLevel: (type, position, level) => {
        const moduleState = get().moduleState;
        const slotLevels = { ...(moduleState.slotLevels ?? defaultSlotLevels()) };
        const cur = slotLevels[type] ?? { main: 0, assist: 0 };
        slotLevels[type] = { ...cur, [position]: Math.max(0, level) };
        const next = { ...moduleState, slotLevels };
        set({ moduleState: next });
        saveKey(KEYS.modules, next);
    },

    updateAssist: (type, key, value) => {
        const moduleState = get().moduleState;
        const assistData = { ...moduleState.assistData };
        const entry = assistData[type] ?? { rarity: 'locked', multEff: 0, subEff: 0 };
        // Multiplier Efficiency: stones to 100% + 30% lab = 130%; Substat Efficiency
        // stays at 100%.
        const cap = key === 'multEff' ? 130 : 100;
        const numericValue = Math.min(cap, Math.max(0, value));
        assistData[type] = { ...entry, [key]: numericValue };
        const next = { ...moduleState, assistData };
        set({ moduleState: next });
        saveKey(KEYS.modules, next);
    },

    updateAssistRarity: (type, rarity) => {
        const moduleState = get().moduleState;
        const assistData = { ...moduleState.assistData };
        const entry = assistData[type] ?? { rarity: 'locked', multEff: 0, subEff: 0 };
        assistData[type] = { ...entry, rarity };
        const next = { ...moduleState, assistData };
        set({ moduleState: next });
        saveKey(KEYS.modules, next);
    },

    // ── Export / Import ───────────────────────────────────────────
    resetAll: () => {
        Object.values(KEYS).forEach(key => {
            try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
        });
        set({
            profile: defaultProfile,
            perkData: { banned: [] },
            tierWaves: {},
            wsData: Array.from({ length: 5 }, defaultWSPreset),
            enhData: defaultEnhData,
            labData: {},
            cardData: defaultCardData,
            uwData: defaultUWData,
            relicData: {},
            botData: {},
            botLoadouts: {},
            moduleState: defaultModuleState,
            battleReportText: '',
            currencies: { ...DEFAULT_CURRENCIES },
            importedBattles: [],
            battleReportChoice: -1,
            guardianData: defaultGuardianData(),
            labsRunning: [],
            labProgress: {},
            dissonanceWaves: emptyDissonance(),
            tourneyLog: {},
            tourneyRecords: [],
            vaultLevels: {},
        });
    },

    exportData: () => {
        const s = get();
        const payload = {
            version: 2,
            exportedAt: new Date().toISOString(),
            profile: s.profile,
            perkData: s.perkData,
            tierWaves: s.tierWaves,
            wsData: s.wsData,
            enhData: s.enhData,
            labData: s.labData,
            labProgress: s.labProgress,
            dissonanceWaves: s.dissonanceWaves,
            cardData: s.cardData,
            uwData: s.uwData,
            relicData: s.relicData,
            botData: s.botData,
            botLoadouts: s.botLoadouts,
            moduleState: s.moduleState,
            battleReportText: s.battleReportText,
            currencies: s.currencies,
            importedBattles: s.importedBattles,
            battleReportChoice: s.battleReportChoice,
            guardianData: s.guardianData,
            tourneyLog: s.tourneyLog,
            tourneyRecords: s.tourneyRecords,
            vaultLevels: s.vaultLevels,
        };
        return JSON.stringify(payload, null, 2);
    },

    importData: (json) => {
        try {
            const data = JSON.parse(json);
            const cardData = migrateCardData(data.cardData ?? defaultCardData);
            const moduleState = withPresetLoadout(migrateModuleState(data.moduleState ?? defaultModuleState), get().activePreset);
            set({
                profile: data.profile ?? defaultProfile,
                perkData: data.perkData ?? { banned: [] },
                tierWaves: data.tierWaves ?? {},
                wsData: data.wsData ?? Array.from({ length: 5 }, defaultWSPreset),
                enhData: data.enhData ?? defaultEnhData,
                labData: data.labData ?? {},
                labProgress: data.labProgress ?? {},
                dissonanceWaves: data.dissonanceWaves ?? emptyDissonance(),
                cardData,
                uwData: data.uwData ?? defaultUWData,
                relicData: data.relicData ?? {},
                botData: data.botData ?? {},
                botLoadouts: data.botLoadouts ?? {},
                moduleState,
                battleReportText: data.battleReportText ?? '',
                currencies: { ...DEFAULT_CURRENCIES, ...(data.currencies ?? {}) },
                importedBattles: data.importedBattles ?? [],
                battleReportChoice: data.battleReportChoice ?? -1,
                guardianData: { ...defaultGuardianData(), ...(data.guardianData ?? {}) },
                tourneyLog: data.tourneyLog ?? {},
                tourneyRecords: data.tourneyRecords ?? [],
                vaultLevels: data.vaultLevels ?? {},
            });
            // Persist everything
            Object.entries(KEYS).forEach(([, storageKey]) => {
                const keyMap: Record<string, unknown> = {
                    tc_profile: data.profile,
                    tc_tiers: data.tierWaves,
                    tc_ws: data.wsData,
                    tc_enh: data.enhData,
                    tc_labs: data.labData,
                    tc_lab_progress: data.labProgress ?? {},
                    tc_dissonance: data.dissonanceWaves ?? emptyDissonance(),
                    tc_cards: cardData,
                    tc_uw: data.uwData,
                    tc_relics: data.relicData,
                    tc_perks: data.perkData,
                    tc_bots: data.botData,
                    tc_bot_loadouts: data.botLoadouts ?? {},
                    tc_battle_report: data.battleReportText ?? '',
                    tc_currencies: data.currencies,
                    tc_imported_battles: data.importedBattles,
                    tc_battle_choice: data.battleReportChoice,
                    tc_modules: moduleState,
                    tc_guardian: data.guardianData,
                    tc_tourney_log: data.tourneyLog,
                    tc_tourney_records: data.tourneyRecords,
                    tc_vault: data.vaultLevels,
                };
                if (keyMap[storageKey] != null) saveKey(storageKey, keyMap[storageKey]);
            });
            return true;
        } catch {
            return false;
        }
    },
}));