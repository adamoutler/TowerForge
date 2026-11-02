// ============================================================
//  TowerForge Companion — Optimizer Tab
//  Stats panel (TTT breakdown) + 8-panel ranked upgrade paths.
//  Currently scores Glass Cannon builds via eDPS/stone.
//  eHP/Hybrid/Farming are placeholder until formulas are built.
// ============================================================

import { Fragment, useState, useCallback, useEffect, useMemo } from 'react';
import { useGameStore } from '../../store/useGameStore';
import {
    OPT_PANELS, OPT_GAIN_THRESHOLDS, OPT_DEFAULT_SHOW, BUILD_SUPPORT, BUILD_GOALS, GOAL_LABELS,
    CURRENCY_PANELS, CURRENCY_CATS, pushGoalOf,
} from '../../constants/optimizerConfig';
import type { OptGoal } from '../../constants/optimizerConfig';
import { presetLabel, UWS, WS_STATS, WS_ENH, MEDAL_SYMBOL } from '../../constants/gameData';
import stoneIcon from '../../assets/stone.png';
import { simulateStonePath, simulateCategoryPath, simulateMedalPath, simulateShardPaths, shardTypeValues, attachParts, workshopKey, bestGuardianChips } from '../../engine/optimizer';
import type { ChipSet, ShardTypeValue } from '../../engine/optimizer';
import ShardIcon from '../common/ShardIcon';
import { chipById } from '../../constants/guardianData';
import { guardianPreset } from '../../engine/guardian';
import { calcTTT, calcTTTDisplayStats } from '../../engine/ttt';
import { calcTowerEDPS, calcSmiteWaveHPFraction } from '../../engine/uwdps';
import type { OptCandidate, OptCategory, OptCurrency, BuildType, ModuleType } from '../../types/gameTypes';
import type { OptimizerSnapshot } from '../../engine/optimizer';
import type { TTTDisplayStats } from '../../engine/ttt';
import type { FarmCalibration } from '../../engine/farming';
import type { EhpCalibration } from '../../engine/ehp';
import type { EdpsCalibration } from '../../engine/edps';
import { applyGoal, chosenReport, effectiveBuild, runModels, snapshotFromState } from '../../engine/accountModels';
import { CELL_BOOSTS } from '../../engine/upgradeCosts';
import { BattleReportPanel, EconomyStats, EhpStats } from './BuildPanels';
import { buildRunLengthModel, pathRunGains, pathSkipGains } from '../../engine/runLength';
import { conditionedSkip } from '../../engine/battleConditions';
import { formatLabTime } from '../../engine/upgradeCosts';
import { aboutWave, filledInRun, freeFillNote, freeFillText, statsInRun } from '../../engine/freeUpgrades';
import { SKIP_NAMES, skipSources, skipUpgradePath } from '../../engine/levelSkip';
import { labOpen, lockedNotes, workshopOpen } from '../../engine/unlocks';
import type { LockedNotes } from '../../engine/unlocks';
import type { SkipKind, SkipUpgrade } from '../../engine/levelSkip';
import { formatGameNumber } from '../../engine/gameNumbers';
import type { StepRunGain } from '../../engine/runLength';
import { withChipLevel } from '../../engine/guardian';

// The goal every panel ranks by, and how much coins count in "coins and
// push". Remembered per browser (the old Rank by "waves" carries over).
const GOAL_KEY = 'tc_opt_goal';
const WEIGHT_KEY = 'tc_opt_coin_weight';
const loadGoal = (): OptGoal | null => {
    try {
        const g = localStorage.getItem(GOAL_KEY);
        if (g && g in GOAL_LABELS) return g as OptGoal;
        return localStorage.getItem('tc_opt_rank') === 'waves' ? 'waves' : null;
    } catch { return null; }
};
const loadWeight = (): number => {
    try {
        const v = localStorage.getItem(WEIGHT_KEY);
        return v !== null && Number(v) >= 0 && Number(v) <= 1 ? Number(v) : 0.5;
    } catch { return 0.5; }
};

const EMPTY_RESULTS: Record<OptCategory, OptCandidate[]> = {
    uw: [], uwp: [], mast: [], assist: [], botplus: [], stones: [],
    workshop: [], labs: [], cards: [], enhancements: [], bots: [], modules: [], guardian: [],
};

const EMPTY_SHOW_MORE: Record<OptCategory, boolean> = {
    uw: false, uwp: false, mast: false, assist: false, botplus: false, stones: false,
    workshop: false, labs: false, cards: false, enhancements: false, bots: false, modules: false, guardian: false,
};

export default function OptimizerTab() {
    const [results, setResults] = useState<Record<OptCategory, OptCandidate[]>>(EMPTY_RESULTS);
    const [running, setRunning] = useState(false);
    const [showMore, setShowMore] = useState<Record<OptCategory, boolean>>(EMPTY_SHOW_MORE);
    const [currentEDPS, setCurrentEDPS] = useState<number | null>(null);
    const [ttStats, setTTStats] = useState<TTTDisplayStats | null>(null);
    const [smitePct, setSmitePct] = useState<number>(0);
    const [showUWFilter, setShowUWFilter] = useState(false);
    const [appliedMsg, setAppliedMsg] = useState<string | null>(null);
    const [undoStack, setUndoStack] = useState<OptCandidate[]>([]);
    const [farmCalib, setFarmCalib] = useState<FarmCalibration | null>(null);
    const [ehpCalib, setEhpCalib] = useState<EhpCalibration | null>(null);
    const [edpsCalib, setEdpsCalib] = useState<EdpsCalibration | null>(null);

    useEffect(() => {
        if (!appliedMsg) return;
        const t = setTimeout(() => setAppliedMsg(null), 2800);
        return () => clearTimeout(t);
    }, [appliedMsg]);

    const profile = useGameStore(s => s.profile);
    const updateProfile = useGameStore(s => s.updateProfile);
    const importedBattles = useGameStore(s => s.importedBattles);
    const cardData = useGameStore(s => s.cardData);
    const labData = useGameStore(s => s.labData);
    const currencies = useGameStore(s => s.currencies);
    const [savedGoal, setSavedGoal] = useState<OptGoal | null>(loadGoal);
    const [coinWeight, setCoinWeight] = useState<number>(loadWeight);
    const [resultsGoal, setResultsGoal] = useState<OptGoal | null>(null);
    const [skipPath, setSkipPath] = useState<SkipUpgrade[]>([]);
    // Free upgrades reach these in the chosen run: a note on the workshop and skip panels.
    const [freeNote, setFreeNote] = useState<string>();
    const [skipFreeNote, setSkipFreeNote] = useState<string>();
    // What's left out for now (not unlocked in the game yet) — a note per panel.
    const [locked, setLocked] = useState<LockedNotes>({});
    const [chipSets, setChipSets] = useState<ChipSet[]>([]);
    const [shardValues, setShardValues] = useState<ShardTypeValue[]>([]);
    useEffect(() => {
        try {
            if (savedGoal) localStorage.setItem(GOAL_KEY, savedGoal);
            localStorage.setItem(WEIGHT_KEY, String(coinWeight));
        } catch { /* storage unavailable */ }
    }, [savedGoal, coinWeight]);
    const activePreset = useGameStore(s => s.activePreset);
    const setActivePreset = useGameStore(s => s.setActivePreset);

    const presetCount = profile.presets || 2;
    const presets = Array.from({ length: presetCount }, (_, i) => i);

    const chosenBuild = (profile.build || 'Glass Cannon') as BuildType;
    // Hybrid is scored as the build its runs behave like (accountModels.effectiveBuild).
    const buildType = useMemo(() => effectiveBuild(chosenBuild, importedBattles), [chosenBuild, importedBattles]);
    const buildSupport = BUILD_SUPPORT[buildType] ?? BUILD_SUPPORT['Glass Cannon'];
    const isFarming = buildType === 'Farming';
    const isEhp = buildType === 'eHP';
    const goals = BUILD_GOALS[buildType] ?? [];
    const goal: OptGoal = savedGoal && goals.includes(savedGoal) ? savedGoal : goals[0] ?? 'damage';
    const shown = resultsGoal ?? goal;
    const blendMode = shown === 'blend';
    const pushWaves = pushGoalOf(buildType) === 'waves';
    const wavesMode = shown === 'waves' || (blendMode && pushWaves);
    const survivalMode = shown === 'survival' || (blendMode && !pushWaves);
    const metricLabel = {
        damage: 'eDPS', waves: 'waves', coins: 'coins', survival: 'survival', blend: 'coins and push',
    }[shown];

    // Run Length (waves) and Coins per Run (coins), from the saved runs that
    // match the chosen Battle Report (tournament or campaign, and its tier).
    const battleReportText = useGameStore(s => s.battleReportText);
    const battleReportChoice = useGameStore(s => s.battleReportChoice);
    const models = useMemo(
        () => runModels({ importedBattles, cardData, activePreset, battleReportText, battleReportChoice, profile, labData }),
        [importedBattles, cardData, activePreset, battleReportText, battleReportChoice, profile, labData],
    );
    const { run: runModel, coinsAt, worth } = models;
    // Waves for each step: pushing waves on the enemy-health model (Glass
    // Cannon), pushing survival on the enemy-attack model (eHP).
    const runFits = !!runModel && (wavesMode ? runModel.stat === 'health' : survivalMode && runModel.stat === 'attack');
    const runGains = (cat: OptCategory): StepRunGain[] | undefined => {
        if (!runFits || !runModel) return undefined;
        const path = results[cat] ?? [];
        const gains = path.map(c => (blendMode ? c.pushPct ?? 0 : c.scorePct));
        return pathRunGains(runModel, gains, coinsAt, path.map(c => c.skipPoints ?? 0), worth);
    };

    // ── Build snapshot from current store state ───────────────
    // Reads fresh state via getState() so a re-run triggered right after
    // applying an upgrade sees the just-committed store values (closures
    // captured at render time would be stale).
    const buildSnapshot = useCallback(
        (): OptimizerSnapshot => snapshotFromState(useGameStore.getState()), [],
    );

    // ── Run optimizer ─────────────────────────────────────────
    function runOptimizer() {
        setRunning(true);
        setShowMore(EMPTY_SHOW_MORE);

        setTimeout(() => {
            try {
                const snap = buildSnapshot();
                const tttData = calcTTT(
                    snap.presetIdx, snap.wsData, snap.labData,
                    snap.cardData, snap.uwData, snap.modBonuses,
                );
                const edps = calcTowerEDPS(
                    snap.uwData, snap.modBonuses, tttData.ttt,
                    snap.presetIdx, snap.wsData, snap.labData,
                    snap.cardData, snap.moduleState,
                    snap.relicData, snap.enhData,
                    snap.botData,
                );
                setCurrentEDPS(edps);
                setSmitePct(calcSmiteWaveHPFraction(snap.uwData) * 100);

                // TTT display stats — always shown regardless of build type
                const stats = calcTTTDisplayStats(
                    snap.presetIdx, snap.wsData, snap.labData,
                    snap.cardData, snap.uwData, snap.modBonuses,
                );
                setTTStats(stats);

                // Set the snapshot up for the goal: the calibrations it needs from
                // the chosen Battle Report, Run Length and Coins per Run.
                const st = useGameStore.getState();
                applyGoal(snap, goal, buildType, chosenReport(st), runModels(st), coinWeight);
                setResultsGoal(goal);
                const pushingWaves = snap.edpsMode === 'waves' || snap.blend?.push === 'waves';
                const pushingSurvival = snap.metric === 'ehp' || snap.blend?.push === 'ehp';
                // Pushing waves: the Enemy Health Level Skip coin upgrades, most skip per
                // coin first; pushing survival (eHP), the Enemy Attack Level Skip ones.
                const skipKind = pushingWaves ? 'health' : pushingSurvival && snap.skipWorth ? 'attack' : null;
                const workshop = snap.wsData[snap.presetIdx];
                setFreeNote(freeFillNote(filledInRun(workshop, snap.free, snap.wsUnlocked)));
                setSkipFreeNote(undefined);
                if (skipKind) {
                    const sources = skipSources(
                        skipKind, workshop, snap.labData, snap.enhData, snap.relicData, snap.modBonuses.subs ?? {},
                    );
                    // Only what the account can buy yet (engine/unlocks.ts).
                    const names = SKIP_NAMES[skipKind];
                    // Free upgrades take the workshop stat to its max: what's left to
                    // buy is the lab and enhancement, on top of that max.
                    const inRun = snap.free && workshop
                        ? statsInRun(workshop, snap.free, snap.wsUnlocked).find(s => s.stat === names.workshop) : undefined;
                    if (inRun?.filledAt != null) {
                        sources.workshop = inRun.end;
                        setSkipFreeNote(freeFillText(names.workshop, inRun.filledAt));
                    }
                    sources.labProgress = snap.labProgress;
                    sources.closed = {
                        workshop: !workshopOpen('utility', names.workshop, sources.workshop, snap.wsUnlocked),
                        lab: !labOpen(names.lab, sources.lab, snap.progress),
                    };
                    setSkipPath(skipUpgradePath(sources, SKIP_PATH_STEPS));
                } else {
                    setSkipPath([]);
                }
                setLocked(lockedNotes(snap, { stones: currencies.stones, medals: currencies.medals }));
                // Which Guardian chips to equip for the goal (free to swap).
                setChipSets(bestGuardianChips(snap));
                setFarmCalib(snap.farm ?? null);
                setEhpCalib(snap.ehp ?? null);
                setEdpsCalib(snap.edps ?? null);
                if (snap.edps) {
                    // Smite at this run's proc rate (not the 100-hit cap).
                    setSmitePct(Math.min(1, snap.edps.anchor.smite * snap.edps.smiteProcs) * 100);
                }

                // Only run the simulation for builds with verified scoring.
                if (buildSupport.ready) {
                    const newResults: Record<OptCategory, OptCandidate[]> = { ...EMPTY_RESULTS };
                    const steps = (cat: OptCategory) => OPT_PANELS.find(p => p.cat === cat)?.maxSteps ?? 50;
                    // Stones: one path across UW stats, UW+, Card Mastery and Assist.
                    newResults.stones = simulateStonePath(steps('stones'), snap);
                    for (const cat of CURRENCY_CATS) {
                        if (cat !== 'bots') newResults[cat] = simulateCategoryPath(cat, steps(cat), snap);
                    }
                    // Medals weigh bot levels against Event Shop trades, valued by
                    // what the stones and shards (after the ones you hold) buy next;
                    // shards in the type that gains most, each on its own slots.
                    const shardPaths = simulateShardPaths(steps('modules'), snap);
                    const cur = st.currencies;
                    const shardsHeld = {
                        cannon: cur.cannonShards ?? 0, armor: cur.armorShards ?? 0,
                        generator: cur.generatorShards ?? 0, core: cur.coreShards ?? 0,
                    };
                    setShardValues(shardTypeValues(shardPaths, shardsHeld));
                    newResults.bots = simulateMedalPath(
                        steps('bots'), snap, newResults.stones, cur.stones ?? 0, shardPaths, shardsHeld,
                    );
                    if (snap.blend) {
                        for (const cat of ['stones', ...CURRENCY_CATS] as OptCategory[]) {
                            newResults[cat] = attachParts(snap, newResults[cat]);
                        }
                    }
                    setResults(newResults);
                } else {
                    setResults(EMPTY_RESULTS);
                    setShardValues([]);
                }
            } catch (e) {
                console.error('Optimizer error:', e);
            } finally {
                setRunning(false);
            }
        }, 50);
    }

    // ── Write a candidate's target to the store ───────────────
    // Writes `level` for the stat/upgrade the candidate refers to, using
    // the same setters the manual tabs use. Applying uses c.toLv; undo
    // uses c.fromLv. Returns true if the write succeeded.
    // For UW+ unlock candidates, fromLv === -1 means "not unlocked":
    //   level -1 → un-unlock, level 0 → unlock at level 0.
    function writeCandidate(c: OptCandidate, level: number, undo = false): boolean {
        const st = useGameStore.getState();

        switch (c.category) {
            case 'uw': {
                const match = UWS.find(u => c.label.startsWith(u.n));
                if (!match) return false;
                const statIdx = match.s.findIndex(([sName]) => c.label.endsWith(sName));
                if (statIdx < 0) return false;
                st.setUWStat(match.a, statIdx, level);
                return true;
            }
            case 'uwp': {
                const match = UWS.find(u => c.label.startsWith(u.n));
                if (!match) return false;
                if (level < 0) {
                    st.setUWPlusOwned(match.a, false);
                    st.setUWPlusLevel(match.a, 0);
                } else if (c.fromLv === -1 && level === 0) {
                    st.setUWPlusOwned(match.a, true);
                    st.setUWPlusLevel(match.a, 0);
                } else {
                    st.setUWPlusLevel(match.a, level);
                }
                return true;
            }
            case 'mast': {
                // Stones unlock the mastery (fromLv −1 = locked); its level is the lab's.
                st.setCardMasteryUnlocked(c.label.replace(' Mastery', ''), level >= 0);
                return true;
            }
            case 'botplus': {
                // Bot+ unlocks account-wide; level 0 until medals raise it.
                const name = c.ref?.[0];
                if (!name) return false;
                st.setBotPlusOwned(name, level >= 0);
                return true;
            }
            case 'assist': {
                const type = c.label.split(' — ')[0].replace(/ Assist$/i, '').toLowerCase();
                const key = c.label.includes('Substat') ? 'subEff' : 'multEff';
                st.updateAssist(type, key, level);
                return true;
            }
            case 'labs': {
                st.setLabLevel(c.label, level);
                return true;
            }
            case 'workshop': {
                const parts = c.label.split(' — ');
                const wsCat = parts[0].replace('WS ', '').toLowerCase() as 'attack' | 'defense' | 'utility';
                const idx = (WS_STATS[wsCat] ?? []).findIndex(([n]) => n === parts[1]);
                if (idx < 0) return false;
                st.setWSStat(st.activePreset, wsCat, idx, level);
                return true;
            }
            case 'cards': {
                // A card slot row: the card goes into the preset (and the slot is bought).
                const card = c.ref?.[0];
                if (!card) return false;
                const preset = st.cardData.presets[st.activePreset] ?? [];
                st.setCardPreset(st.activePreset, undo ? preset.filter(n => n !== card) : [...preset, card]);
                st.setCardSlots(undo ? c.fromLv : c.toLv);
                return true;
            }
            case 'enhancements': {
                const parts = c.label.split(' — ');
                const enhCat = parts[0].replace('Enh ', '').toLowerCase();
                const idx = (WS_ENH[enhCat] ?? []).findIndex(([n]) => n === parts[1]);
                if (idx < 0) return false;
                st.setEnhLevel(enhCat, idx, level);
                return true;
            }
            case 'bots': {
                const [name, stat] = c.ref ?? [];
                if (!name || name === 'trade' || stat === undefined) return false;   // trades happen in game
                if (stat === 'plus') st.setBotPlusLevel(name, st.activePreset, level);
                else st.setBotMedal(name, st.activePreset, Number(stat), level);
                return true;
            }
            case 'guardian': {
                const [chip, stat] = (c.ref ?? []).map(Number);
                if (!Number.isInteger(chip) || !Number.isInteger(stat)) return false;
                st.setGuardianData(withChipLevel(st.guardianData, st.activePreset, chip, stat, level));
                return true;
            }
            case 'modules': {
                const [type, pos] = c.ref ?? [];
                if (!type || (pos !== 'main' && pos !== 'assist')) return false;
                st.setSlotLevel(type as ModuleType, pos, level);
                return true;
            }
            default:
                return false;
        }
    }

    // ── Equip a Guardian chip set (free in game) ──────────────
    function equipChips(set: ChipSet) {
        const st = useGameStore.getState();
        const g = st.guardianData;
        const preset = guardianPreset(g, st.activePreset);
        if (!g || !preset) return;
        const pi = Math.min(Math.max(0, g.presetFor[st.activePreset] ?? 0), g.presets.length - 1);
        const chips = [...set.chips.map(id => chipById(id).index), -1, -1, -1].slice(0, Math.max(3, preset.chips.length));
        st.setGuardianData({ ...g, presets: g.presets.map((p, i) => (i === pi ? { ...p, chips } : p)) });
        setAppliedMsg(`✓ Equipped: ${set.chips.map(id => chipById(id).name).join(' + ')} — swap them in game too`);
        runOptimizer();
    }

    // ── Apply a recommended upgrade to the actual tower ───────
    // Double-clicking a row writes the upgrade straight to the store,
    // pushes it onto the undo stack, then re-runs the optimizer.
    function applyCandidate(c: OptCandidate) {
        if (!writeCandidate(c, c.toLv)) return;
        setUndoStack(s => [...s, c]);
        setAppliedMsg(`✓ Applied: ${c.label} — ${c.subLabel}`);
        runOptimizer();
    }

    // ── Undo the most recent applied upgrade ──────────────────
    function undoLast() {
        if (!undoStack.length) return;
        const last = undoStack[undoStack.length - 1];
        if (writeCandidate(last, last.fromLv, true)) {
            setAppliedMsg(`↩ Undone: ${last.label} — ${last.subLabel}`);
            runOptimizer();
        }
        setUndoStack(s => s.slice(0, -1));
    }

    // ── UW and workshop exclusion toggles ─────────────────────
    const excludedUWs = profile.excludedUWs ?? [];
    function toggleUW(abbr: string) {
        const set = new Set(excludedUWs);
        if (set.has(abbr)) set.delete(abbr);
        else set.add(abbr);
        updateProfile({ excludedUWs: [...set] });
    }
    const excludedWs = profile.excludedWorkshop ?? [];
    function toggleWs(key: string) {
        const set = new Set(excludedWs);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        updateProfile({ excludedWorkshop: [...set] });
    }
    const filterOff = [
        excludedUWs.length > 0 && `${excludedUWs.length} UW${excludedUWs.length === 1 ? '' : 's'}`,
        excludedWs.length > 0 && `${excludedWs.length} stat${excludedWs.length === 1 ? '' : 's'}`,
    ].filter(Boolean).join(', ');

    // ── Gain color ────────────────────────────────────────────
    function gainColor(scorePct: number): string {
        if (scorePct >= OPT_GAIN_THRESHOLDS.high) return 'var(--ra)';
        if (scorePct >= OPT_GAIN_THRESHOLDS.med) return '#ff9800';
        return 'var(--rr)';
    }

    // ── Category label color ──────────────────────────────────
    function catStyle(cat: OptCategory): React.CSSProperties {
        const map: Record<OptCategory, { bg: string; color: string }> = {
            uw: { bg: 'rgba(0,230,118,.12)', color: 'var(--ra)' },
            uwp: { bg: 'rgba(147,51,234,.15)', color: 'var(--purple)' },
            mast: { bg: 'var(--gold-glow)', color: 'var(--gold)' },
            assist: { bg: 'rgba(79,195,247,.15)', color: 'var(--rr)' },
            botplus: { bg: 'rgba(231,76,60,.15)', color: '#e74c3c' },
            stones: { bg: 'var(--bg4)', color: 'var(--text-dim)' },
            workshop: { bg: 'var(--accent-glow)', color: 'var(--accent)' },
            labs: { bg: 'rgba(59,130,246,.15)', color: '#4fc3f7' },
            cards: { bg: 'var(--gold-glow)', color: 'var(--gold)' },
            enhancements: { bg: 'rgba(147,51,234,.15)', color: '#e040fb' },
            bots: { bg: 'rgba(231,76,60,.15)', color: '#e74c3c' },
            modules: { bg: 'rgba(79,195,247,.15)', color: '#4fc3f7' },
            guardian: { bg: 'var(--accent-glow)', color: 'var(--accent)' },
        };
        return {
            background: map[cat]?.bg ?? 'var(--bg4)',
            color: map[cat]?.color ?? 'var(--text-dim)',
        };
    }

    const hasResults = Object.values(results).some(arr => arr.length > 0);

    return (
        <div>
            {/* ── Apply toast ── */}
            {appliedMsg && (
                <div className="opt-apply-toast">
                    <span>{appliedMsg}</span>
                    {undoStack.length > 0 && appliedMsg.startsWith('✓') && (
                        <button className="opt-toast-undo" onClick={undoLast}>
                            Undo
                        </button>
                    )}
                </div>
            )}

            {/* ── Controls ── */}
            <div className="section" style={{ marginBottom: '12px' }}>
                <div className="section-body" style={{ padding: '10px 14px' }}>
                    <div className="flex-row" style={{ gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>

                        <div>
                            <span className="opt-control-label">Build</span>
                            <select
                                value={chosenBuild}
                                onChange={e => updateProfile({ build: e.target.value as BuildType })}
                                style={{ fontSize: '13px' }}
                            >
                                {Object.entries(BUILD_SUPPORT).map(([key, cfg]) => (
                                    <option key={key} value={key}>
                                        {cfg.label}{!cfg.ready ? ' (coming soon)' : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <span className="opt-control-label">Preset</span>
                            <select
                                value={activePreset}
                                onChange={e => setActivePreset(parseInt(e.target.value))}
                                style={{ fontSize: '13px' }}
                            >
                                {presets.map(i => (
                                    <option key={i} value={i}>{presetLabel(profile.presetNames, i)}</option>
                                ))}
                            </select>
                        </div>

                        {goals.length > 0 && (
                            <div>
                                <span className="opt-control-label">Goal</span>
                                <select
                                    value={goal}
                                    onChange={e => setSavedGoal(e.target.value as OptGoal)}
                                    style={{ fontSize: '13px' }}
                                    title="Every panel below ranks upgrades by this"
                                >
                                    {goals.map(g => (
                                        <option key={g} value={g}>
                                            {g === 'blend' && !pushWaves ? 'Coins and survival together' : GOAL_LABELS[g]}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {goal === 'blend' && (
                            <div className="opt-blend">
                                <span className="opt-control-label">Balance</span>
                                <span className="opt-blend-end">{pushWaves ? 'Push' : 'Survival'}</span>
                                <input
                                    type="range" min={0} max={100} step={10}
                                    value={Math.round(coinWeight * 100)}
                                    onChange={e => setCoinWeight(Number(e.target.value) / 100)}
                                    aria-label="How much coins count against pushing"
                                />
                                <span className="opt-blend-end">Coins</span>
                                <span className="opt-blend-val">{Math.round(coinWeight * 100)}% coins</span>
                            </div>
                        )}

                        <button
                            className="btn btn-dim"
                            onClick={undoLast}
                            disabled={undoStack.length === 0}
                            style={{ marginLeft: 'auto' }}
                            title="Undo the last applied upgrade"
                        >
                            ↩ Undo{undoStack.length > 0 ? ` (${undoStack.length})` : ''}
                        </button>

                        <button
                            className="btn btn-dim"
                            onClick={() => setShowUWFilter(true)}
                            title="Choose which UWs and workshop stats the optimizer suggests upgrades for"
                        >
                            ⚙ Filter{filterOff ? ` (${filterOff} off)` : ''}
                        </button>

                        <button
                            className="btn btn-accent"
                            onClick={runOptimizer}
                            disabled={running}
                        >
                            {running ? '⏳ Running...' : '▶ Run Optimizer'}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── UW Filter Modal ── */}
            {showUWFilter && (
                <div className="modal-overlay" onClick={() => setShowUWFilter(false)}>
                    <div className="modal-box" onClick={e => e.stopPropagation()}>
                        <div className="modal-head">
                            <span className="modal-title">Include in Optimizer</span>
                            <button className="btn btn-dim" onClick={() => setShowUWFilter(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p className="opt-row-explainer" style={{ marginTop: 0, marginBottom: '12px' }}>
                                Unchecked UWs are skipped — no stone (UW or UW+) upgrades will be suggested for them.
                            </p>
                            <div className="opt-filter-head">Ultimate Weapons</div>
                            <div className="uw-filter-list">
                                {UWS.map(uw => {
                                    const checked = !excludedUWs.includes(uw.a);
                                    return (
                                        <label key={uw.a} className="uw-filter-row">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleUW(uw.a)}
                                            />
                                            <span className="uw-filter-name">{uw.n}</span>
                                            <span className="uw-filter-abbr">{uw.a}</span>
                                        </label>
                                    );
                                })}
                            </div>
                            <div className="modal-actions" style={{ marginTop: '10px', justifyContent: 'flex-start' }}>
                                <button
                                    className="btn btn-dim"
                                    onClick={() => updateProfile({ excludedUWs: [] })}
                                >
                                    Select All
                                </button>
                                <button
                                    className="btn btn-dim"
                                    onClick={() => updateProfile({ excludedUWs: UWS.map(u => u.a) })}
                                >
                                    Clear All
                                </button>
                            </div>

                            {/* Workshop stats some builds keep low on purpose (an orb build's Range). */}
                            <div className="opt-filter-head">Workshop</div>
                            <p className="opt-row-explainer" style={{ marginTop: 0, marginBottom: '10px' }}>
                                Untick a stat you keep low on purpose (like Range on an orb build) and the coin
                                rankings won&apos;t suggest it.
                            </p>
                            {(['attack', 'defense', 'utility'] as const).map(sec => (
                                <div key={sec} className="opt-filter-sec">
                                    <div className="opt-filter-sub">{sec.charAt(0).toUpperCase() + sec.slice(1)}</div>
                                    <div className="uw-filter-list">
                                        {(WS_STATS[sec] ?? []).map(([stat]) => {
                                            const key = workshopKey(sec, stat);
                                            return (
                                                <label key={key} className="uw-filter-row">
                                                    <input type="checkbox" checked={!excludedWs.includes(key)} onChange={() => toggleWs(key)} />
                                                    <span className="uw-filter-name">{stat}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            <div className="modal-actions" style={{ marginTop: '16px', justifyContent: 'flex-start' }}>
                                <button
                                    className="btn btn-dim"
                                    onClick={() => updateProfile({ excludedWorkshop: [] })}
                                >
                                    Include all stats
                                </button>
                                <button
                                    className="btn btn-accent"
                                    onClick={() => setShowUWFilter(false)}
                                    style={{ marginLeft: 'auto' }}
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {chosenBuild === 'Hybrid' && (
                <div className="relics-note">
                    <strong>Hybrid — ranked as {buildType === 'eHP' ? 'eHP' : 'Glass Cannon'}.</strong>{' '}
                    {buildType === 'eHP'
                        ? 'Your recent deaths came from hits wearing your tower down, so enemy attack decides how far your runs get: upgrades are ranked for survival, like an eHP build.'
                        : importedBattles.length
                            ? 'Your recent deaths came from single hits far bigger than your tower heals (or your runs don’t record damage taken), so enemy health decides how far your runs get: upgrades are ranked for damage and push, like a Glass Cannon.'
                            : 'Import runs that ended in a death and the Optimizer reads how they end; until then it ranks like a Glass Cannon.'}
                    {' '}It follows your runs as they change (Optimizer → Run Length shows both views).
                </div>
            )}

            {/* ── Battle Report (calibrates every build) + build breakdown ── */}
            {buildSupport.ready && (
                <BattleReportPanel purpose={goal === 'coins' || goal === 'blend' ? 'farming' : goal === 'survival' ? 'ehp' : 'edps'} />
            )}
            {farmCalib && <EconomyStats calib={farmCalib} />}
            {ehpCalib && <EhpStats calib={ehpCalib} />}

            {/* ── TTT Stats Panel ── */}
            {ttStats && !isFarming && !isEhp && (
                <div className="section" style={{ marginBottom: '12px' }}>
                    <div className="section-head">
                        <h3>Tower Stats</h3>
                        <span className="s-badge">{presetLabel(profile.presetNames, activePreset)}</span>
                    </div>
                    <div className="section-body">
                        <div className="ttt-stats-grid">

                            <div className="stat-pill">
                                <span className="stat-pill-label">Range</span>
                                <span className="stat-pill-val">{ttStats.range.toFixed(1)}m</span>
                            </div>

                            <div className="stat-pill">
                                <span className="stat-pill-label">Total Slow</span>
                                <span className="stat-pill-val" style={{
                                    color: ttStats.cappedSlowPct >= 90 ? 'var(--gold)' : 'var(--text-bright)',
                                }}>
                                    {ttStats.cappedSlowPct.toFixed(1)}%
                                </span>
                            </div>

                            <div className="stat-pill">
                                <span className="stat-pill-label">CF Slow</span>
                                <span className="stat-pill-val">{ttStats.cfSlowPct.toFixed(1)}%</span>
                            </div>

                            <div className="stat-pill">
                                <span className="stat-pill-label">Slow Aura</span>
                                <span className="stat-pill-val">{ttStats.slowAuraPct.toFixed(1)}%</span>
                            </div>

                            <div className="stat-pill">
                                <span className="stat-pill-label">CF Uptime</span>
                                <span className="stat-pill-val" style={{
                                    color: ttStats.cfUptime >= 1 ? 'var(--gold)' : 'var(--text-bright)',
                                }}>
                                    {(ttStats.cfUptime * 100).toFixed(0)}%
                                </span>
                            </div>

                            <div className="stat-pill">
                                <span className="stat-pill-label">CF+ Path Mult</span>
                                <span className="stat-pill-val" style={{ color: 'var(--purple)' }}>
                                    {ttStats.cfPathMult.toFixed(2)}×
                                </span>
                            </div>

                            <div className="stat-pill">
                                <span className="stat-pill-label">Enemy Speed</span>
                                <span className="stat-pill-val">{ttStats.enemySpeed.toFixed(2)} m/s</span>
                            </div>

                            <div className="stat-pill">
                                <span className="stat-pill-label">TTT</span>
                                <span className="stat-pill-val green" style={{ fontSize: '15px' }}>
                                    {ttStats.ttt.toFixed(2)}s
                                </span>
                            </div>

                            {currentEDPS !== null && !edpsCalib && (
                                <div className="stat-pill" title="Model units — only the change between upgrades matters. Choose a run with damage data above to rank by your real damage.">
                                    <span className="stat-pill-label">eDPS (model)</span>
                                    <span className="stat-pill-val gold" style={{ fontSize: '15px' }}>
                                        {currentEDPS.toExponential(3)}
                                    </span>
                                </div>
                            )}

                            {smitePct > 0 && (
                                <div className="stat-pill" title={edpsCalib
                                    ? `CL+ Smite: % of each enemy's wave HP dealt, at ${edpsCalib.smiteProcs.toFixed(1)} smites per enemy in your run (100 max).`
                                    : "CL+ Smite: % of each enemy's wave HP dealt over 100 hits (assumes the hit cap is reached)."}>
                                    <span className="stat-pill-label">Smite (wave HP)</span>
                                    <span className="stat-pill-val" style={{ color: 'var(--purple)', fontSize: '15px' }}>
                                        {smitePct.toFixed(1)}%
                                    </span>
                                </div>
                            )}

                        </div>

                        <p className="ttt-explainer">
                            TTT (Time-To-Tower) is how long an enemy takes to cross your tower's range.
                            Longer TTT means more UW activations for SM, DW, ILM, PS, BH, and GT.
                            While Chrono Field is up, its slow (capped at 90%), Slow Aura and Chrono Loop (CF+) multiply; the CF+ figure is the extra time Chrono Loop's spiral adds.
                        </p>
                    </div>
                </div>
            )}

            {/* ── What the ranking counts ── */}
            {buildSupport.ready && hasResults && (
                <div className="opt-warning-banner">
                    <span className="opt-warning-icon">⚠️</span>
                    <div>
                        {shown === 'waves' && (<>
                            <strong>Ranked by how far your runs get</strong> — milestones and tournaments. Only flat
                            damage counts — Chain Lightning, Smart Missiles, Death Wave, Inner Land Mines, Poison
                            Swamp and tower shots. Orbs, Black Hole, Smite and Consume deal a share of enemy health,
                            so they don&apos;t fall behind as waves get harder, and the enemies that end Glass Cannon
                            runs ignore orbs and Black Hole. Enemy Health Level Skip counts as the damage that gains
                            the same waves. Waves come from Run Length and coins per run from Coins
                            per Run{runModel
                                    ? ` — from your last ${runModel.used.length} ${runModel.tournament ? 'tournament' : `tier ${runModel.tier}`} deaths (around W${runModel.typicalWave.toLocaleString()}), to match your chosen run`
                                    : ' — import runs that ended in a death to see them'}.
                                {runModel?.tournament && ' Tournaments have no coins per run here — they pay differently.'}
                        </>)}
                        {shown === 'damage' && (<>
                            <strong>Ranked for all damage (eDPS).</strong>{' '}
                            {edpsCalib
                                ? 'Gains are a share of all the damage in your chosen run, so sources stones can’t change (like orbs) keep their real weight.'
                                : 'Without a run that has damage data, gains come from the model alone and can over- or under-value some sources (Black Hole especially).'}
                            {' '}Coin income isn&apos;t counted — pick “More coins” or “Coins and push” for that.
                        </>)}
                        {shown === 'coins' && (<>
                            <strong>Ranked for coins per hour</strong>, at the same run length. Survival and damage
                            aren&apos;t counted — a farming setup still has to reach the waves you farm.
                        </>)}
                        {shown === 'survival' && (<>
                            <strong>Ranked for survival.</strong> Damage and coins aren&apos;t counted (thorns are
                            the exception). An eHP run ends where enemy attack outgrows what your tower can take, so
                            Enemy Attack Level Skip and the attack labs of the enemies that end your runs count as the
                            survival that gains the same waves.{' '}
                            {runFits && runModel
                                ? `Waves come from Run Length — your last ${runModel.used.length} tier ${runModel.tier} deaths (around W${runModel.typicalWave.toLocaleString()}).`
                                : 'Import runs that ended in a death to see waves.'}
                        </>)}
                        {shown === 'blend' && (<>
                            <strong>Ranked for coins and {pushWaves ? 'push' : 'survival'} together</strong>, at
                            {' '}{Math.round(coinWeight * 100)}% coins: each upgrade scores (coins per hour gain)
                            {' '}<sup>{Math.round(coinWeight * 100)}%</sup> × ({pushWaves ? 'push' : 'survival'} gain)
                            {' '}<sup>{100 - Math.round(coinWeight * 100)}%</sup>, so ones that help both rise to the
                            top. Each row shows both halves.{pushWaves && ' Push counts flat damage and level skip, as in “Push further”.'}
                        </>)}
                        {' '}Workshop stats count at the levels free upgrades take them to in your chosen run.
                        {' '}Stones and medals are ranked by gain per stone or medal, coins by gain per coin,
                        labs by gain per hour of research, shards per shard and gems per gem. Each step
                        builds on the ones above it.
                    </div>
                </div>
            )}

            {/* ── Build not yet supported ── */}
            {!buildSupport.ready && (
                <div className="empty-state" style={{ marginTop: '20px' }}>
                    <div className="icon">🚧</div>
                    <h3>{buildSupport.label} optimizer coming soon</h3>
                    <p>
                        {buildType} scoring requires its own dedicated formula set covering defensive
                        labs, modules, relics, and UW crowd-control contributions. This is being built
                        as its own project — for now, switch to <strong>Glass Cannon</strong> above to
                        see ranked upgrades, or check back soon.
                    </p>
                </div>
            )}

            {/* ── No results yet (GC, not run) ── */}
            {buildSupport.ready && !hasResults && !running && (
                <div className="empty-state" style={{ marginTop: '40px' }}>
                    <div className="icon">⚙️</div>
                    <h3>Ready to optimize</h3>
                    <p>
                        Fill in your UW, Workshop, Labs, Cards, and Modules tabs,
                        then click Run Optimizer to see your ranked upgrade path.
                    </p>
                </div>
            )}

            {/* ── Results ── */}
            {buildSupport.ready && hasResults && (
                <div>
                    <div className="opt-row-label">Stone Upgrades</div>
                    <p className="opt-row-explainer">
                        One ranked path across UW stats, UW+, Card Mastery, Assist modules
                        and Bot+ unlocks — since they all draw from the same stone pool, this is
                        the order that gets you the most {metricLabel} per stone spent.
                        <br />
                        <strong>💡 Double-click any upgrade to apply it to your tower.</strong>
                    </p>
                    {OPT_PANELS.filter(p => p.row === 1).map(panel => (
                        <OptPanel
                            key={panel.cat}
                            panel={panel}
                            candidates={results[panel.cat] ?? []}
                            locked={locked[panel.cat as keyof LockedNotes]}
                            note={panel.cat === 'workshop' ? freeNote : undefined}
                            runGains={runGains(panel.cat)}
                            blend={blendMode ? (pushWaves ? 'waves' : 'survival') : undefined}
                            showAll={showMore[panel.cat] ?? false}
                            onShowMore={() => setShowMore(s => ({ ...s, [panel.cat]: true }))}
                            gainColor={gainColor}
                            catStyle={catStyle}
                            onApply={applyCandidate}
                        />
                    ))}

                    {CURRENCY_PANELS.map(group => (
                        <div key={group.currency}>
                            <div className="opt-row-label" style={{ marginTop: '14px' }}>
                                {group.label}
                            </div>
                            {group.currency === 'bits' && chipSets.length > 1 && (
                                <ChipAdvice sets={chipSets} metric={metricLabel} onEquip={equipChips} />
                            )}
                            {group.currency === 'shards' && (
                                <ShardAdvice values={shardValues} metric={metricLabel} />
                            )}
                            {group.currency === 'coins' && runFits && skipPath.length > 0 && runModel && (
                                <SkipPanel path={skipPath} runModel={runModel} coinsAt={coinsAt} skipScale={conditionedSkip(1, models.conditions)} note={skipFreeNote} />
                            )}
                            {OPT_PANELS.filter(p => group.cats.includes(p.cat)).map(panel => (
                                <OptPanel
                                    key={panel.cat}
                                    panel={panel}
                                    candidates={results[panel.cat] ?? []}
                                    locked={locked[panel.cat as keyof LockedNotes]}
                                    note={panel.cat === 'workshop' ? freeNote : undefined}
                                    runGains={runGains(panel.cat)}
                                    blend={blendMode ? (pushWaves ? 'waves' : 'survival') : undefined}
                                    showAll={showMore[panel.cat] ?? false}
                                    onShowMore={() => setShowMore(s => ({ ...s, [panel.cat]: true }))}
                                    gainColor={gainColor}
                                    catStyle={catStyle}
                                    onApply={applyCandidate}
                                />
                            ))}
                            {group.currency === 'research' && results.labs.length > 0 && (
                                <CellsPanel topLab={results.labs[0]} cells={currencies.cells ?? 0} />
                            )}
                            {group.currency === 'medals' && (
                                <p className="opt-row-explainer">
                                    Medals also buy 150 Gems a trade. Trade prices reset each event; relics and
                                    cosmetics aren&apos;t ranked.
                                </p>
                            )}
                            {group.currency === 'gems' && (
                                <p className="opt-row-explainer">
                                    Card pulls are random (80% Common, 17% Rare, 3% Epic), so they aren&apos;t
                                    ranked; neither are lab slots, rushes or tickets.
                                </p>
                            )}
                        </div>
                    ))}

                    <div className="opt-construction" style={{ marginTop: '14px' }}>
                        <span className="opt-construction-icon">ℹ️</span>
                        <div>
                            <strong>Not ranked yet</strong>
                            <p>
                                Keys (the Vault) and Guild Tokens — the Guild Store sells gems, bits, cells, shards
                                and relics, so value tokens by what those buy above. Guardian chip slots aren&apos;t
                                ranked; which chips to equip is under Bits.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Elite Cells: lab boosts ───────────────────────────────────
// A boost speeds one lab slot. Cheap boosts give the most research per
// cell; the wiki's price per hour, and the extra lab-hours each buys.
function CellsPanel({ topLab, cells }: { topLab?: OptCandidate; cells: number }) {
    return (
        <div className="opt-section">
            <div className="opt-section-head">
                <span className="opt-section-title">Elite Cells — lab boosts</span>
            </div>
            <p className="opt-row-explainer" style={{ padding: '6px 12px 0' }}>
                Boost your top lab{topLab ? <> — <strong>{topLab.label}</strong></> : ''}. The cheapest boost gives
                the most research per cell; step up only when cells pile up.
                {cells > 0 && <> You have {formatGameNumber(cells)} cells.</>}
            </p>
            <div className="opt-cells">
                <span className="opt-cells-head">Boost</span>
                <span className="opt-cells-head">Cells / hour</span>
                <span className="opt-cells-head">Per extra lab hour</span>
                <span className="opt-cells-head">Hours you can run</span>
                {CELL_BOOSTS.map(([speed, perHour]) => (
                    <Fragment key={speed}>
                        <span>×{speed}</span>
                        <span>{formatGameNumber(perHour)}</span>
                        <span>{formatGameNumber(perHour / (speed - 1))}</span>
                        <span>{cells > 0 ? Math.floor(cells / perHour).toLocaleString() : '—'}</span>
                    </Fragment>
                ))}
            </div>
        </div>
    );
}

// ── Optimizer Panel Component ─────────────────────────────────
interface OptPanelProps {
    panel: typeof OPT_PANELS[number];
    candidates: OptCandidate[];
    locked?: string;              // what's left out until it's unlocked in the game
    note?: string;                // what free upgrades already reach
    showAll: boolean;
    onShowMore: () => void;
    gainColor: (score: number) => string;
    catStyle: (cat: OptCategory) => React.CSSProperties;
    onApply: (c: OptCandidate) => void;
    runGains?: StepRunGain[];     // waves mode: waves and coins per run each step adds
    blend?: 'waves' | 'survival'; // "coins and push": rows show both halves
}

const COST_UNIT: Record<OptCurrency, string> = {
    stones: '', coins: ' 🪙', research: ' 🔬', medals: ` ${MEDAL_SYMBOL}`, shards: ' shards', gems: ' 💎', bits: ' bits',
};
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
// Coin prices: whole coins below 1,000 (discounts leave fractions).
const coinsText = (v: number) => formatGameNumber(v < 1000 ? Math.round(v) : v);

// Short badges, so the name keeps its room on a phone.
const CAT_BADGE: Partial<Record<OptCategory, string>> = {
    workshop: 'WS', labs: 'LAB', enhancements: 'ENH', cards: 'CARD', bots: 'BOT', modules: 'MOD', guardian: 'GRD', botplus: 'BOT+',
};

const fmtWaves = (w: number) => (w < 10 ? w.toFixed(1) : Math.round(w).toLocaleString());

const SKIP_PATH_STEPS = 10;
const skipSource = (kind: SkipKind): Record<SkipUpgrade['source'], { badge: string; name: string }> => ({
    workshop: { badge: 'WS', name: SKIP_NAMES[kind].workshop },
    lab: { badge: 'LAB', name: SKIP_NAMES[kind].lab },
    enhancement: { badge: 'ENH', name: 'Enhancement — Enemy Level Skips' },
});

// Which Guardian chips to equip for the goal: the best few sets against
// the chips equipped now (optimizer.bestGuardianChips).
function ChipAdvice({ sets, metric, onEquip }: { sets: ChipSet[]; metric: string; onEquip: (s: ChipSet) => void }) {
    const best = sets[0];
    const names = (s: ChipSet) => s.chips.map(id => chipById(id).name).join(' + ');
    return (
        <div className="opt-section">
            <div className="opt-section-head">
                <span className="opt-section-title">Guardian chips to equip</span>
                <span className="s-badge">free to swap</span>
            </div>
            <p className="opt-row-explainer" style={{ padding: '6px 12px 0' }}>
                {best.current
                    ? `Your chips are already the best set for ${metric}.`
                    : `Best for ${metric}: ${names(best)}. Swapping chips costs nothing in game.`}
                {' '}Ally isn&apos;t counted (its overheal isn&apos;t modeled), and Fetch only for its coins.
            </p>
            {sets.slice(0, 4).map((s, idx) => (
                <div key={s.chips.join('+')} className="opt-row" onDoubleClick={() => { if (!s.current) onEquip(s); }}
                    title={s.current ? 'Equipped now' : 'Double-click to equip this set on the site'}>
                    <span className="opt-rank">#{idx + 1}</span>
                    <span className="opt-cat-badge">GRD</span>
                    <div className="opt-name-col">
                        <span className="opt-name">{names(s)}</span>
                        <span className="opt-sub">{s.current ? 'Equipped now' : 'Double-click to equip'}</span>
                    </div>
                    <span className="opt-gain">{s.current ? '—' : `${s.scorePct >= 0 ? '+' : ''}${s.scorePct.toFixed(2)}%`}</span>
                </div>
            ))}
        </div>
    );
}

// Each type's shards level only its own slots: what the shards held add
// along that type's path, and what the next 1,000 would — the type to pick
// for Event Shop trades and the Vault's Daily Mission Shard Type.
function ShardAdvice({ values, metric }: { values: ShardTypeValue[]; metric: string }) {
    const best = [...values].sort((a, b) => b.next1kPct - a.next1kPct)[0];
    if (!best || !(best.next1kPct > 0)) return null;
    const pct = (v: number) => (v > 0 ? `+${v.toFixed(v < 0.1 ? 3 : 2)}%` : '—');
    const name = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    return (
        <div className="opt-section">
            <div className="opt-section-head">
                <span className="opt-section-title">Your module shards</span>
                <span className="s-badge">next 1,000</span>
            </div>
            <p className="opt-row-explainer" style={{ padding: '6px 12px 0' }}>
                Each type&apos;s shards level only its own slots. Picking a type for Event Shop trades or the
                Vault&apos;s Daily Mission Shard Type? <strong>{name(best.type)}</strong> adds the most {metric} now.
                Modules → Shard plan shows which slot each type&apos;s shards should go to.
            </p>
            {values.map(v => (
                <div key={v.type} className="opt-row">
                    <ShardIcon kind={v.type} />
                    <div className="opt-name-col">
                        <span className="opt-name">{name(v.type)} Shards</span>
                        <span className="opt-sub">
                            {v.held <= 0 ? 'None saved'
                                : `Your ${v.held.toLocaleString()}: ${v.heldPct > 0 ? `${pct(v.heldPct)} ${metric}` : `no gain for ${metric}`}`}
                        </span>
                    </div>
                    <span className="opt-gain" style={{ color: v === best ? 'var(--ra)' : undefined }}>{pct(v.next1kPct)}</span>
                </div>
            ))}
        </div>
    );
}

// Enemy Health Level Skip (Glass Cannon waves mode) or Enemy Attack Level
// Skip (eHP survival): each point of skip slows how fast enemies get
// tougher, so it moves the death wave a long way. In a tournament the
// league's Skip Reduction and Skip Decay shrink each point (`skipScale`).
function SkipPanel({ path, runModel, coinsAt, skipScale, note }: {
    path: SkipUpgrade[];
    runModel: NonNullable<ReturnType<typeof buildRunLengthModel>>;
    coinsAt?: (wave: number) => number;
    skipScale: number;
    note?: string;
}) {
    const gains = pathSkipGains(runModel, path.map(u => u.points * skipScale), coinsAt);
    const rows = path.map((u, i) => ({ u, ...gains[i] }));
    const totalWaves = gains.reduce((sum, g) => sum + g.waves, 0);
    const attack = runModel.stat === 'attack';
    const source = skipSource(runModel.stat);
    return (
        <div className="opt-section">
            <div className="opt-section-head">
                <span className="opt-section-title">Enemy {attack ? 'Attack' : 'Health'} Level Skip</span>
                <span className="s-badge">+{fmtWaves(totalWaves)} waves</span>
            </div>
            <p className="opt-row-explainer" style={{ padding: '6px 12px 0' }}>
                Each point of skip chance slows how fast enemies {attack ? 'hit harder' : 'get tougher'}, so it moves
                your death wave a long way. Most skip per coin first; the enhancement multiplies the other sources, so
                its value grows with them.
            </p>
            {note && <p className="opt-row-explainer" style={{ padding: '6px 12px 0' }}>{note}</p>}
            {rows.map(({ u, waves, coins }, idx) => (
                <div key={`${u.source}-${u.to}`} className="opt-row">
                    <span className="opt-rank">#{idx + 1}</span>
                    <span className="opt-cat-badge">{source[u.source].badge}</span>
                    <div className="opt-name-col">
                        <span className="opt-name">{source[u.source].name}</span>
                        <span className="opt-sub">Lv {u.from} → {u.to} · +{u.points.toFixed(2)} skip points</span>
                        <span className="opt-waves">
                            +{fmtWaves(waves)} waves{coins !== null && <> · +{(coins * 100).toFixed(2)}% coins</>}
                        </span>
                    </div>
                    <span className="opt-cost">
                        {formatGameNumber(u.cost)}<span className="opt-cost-type"> 🪙</span>
                        {u.time && <span className="opt-sub" style={{ display: 'block' }}>{u.time}</span>}
                    </span>
                </div>
            ))}
        </div>
    );
}

function OptPanel({
    panel, candidates, locked, note, showAll, onShowMore, gainColor, catStyle, onApply, runGains, blend,
}: OptPanelProps) {
    const totalWaves = runGains?.reduce((s, g) => s + g.waves, 0) ?? 0;
    const visible = showAll
        ? candidates
        : candidates.slice(0, OPT_DEFAULT_SHOW);

    return (
        <div className="opt-section">
            <div className="opt-section-head">
                <span className="opt-section-title">{panel.label}</span>
                <span className="s-badge">
                    {candidates.length} upgrades{runGains && totalWaves > 0 ? ` · +${fmtWaves(totalWaves)} waves` : ''}
                </span>
            </div>

            {locked && candidates.length > 0 && <div className="opt-locked">🔒 {locked}</div>}
            {note && <p className="opt-row-explainer" style={{ padding: '6px 12px 0' }}>{note}</p>}
            {candidates.length === 0 ? (
                <div className="opt-empty">
                    {locked ? `🔒 ${locked}` : 'No upgrades available — all maxed or no data entered.'}
                </div>
            ) : (
                <>
                    {visible.map((c, idx) => (
                        <div
                            key={`${c.label}-${idx}`}
                            className="opt-row opt-row-applicable"
                            onDoubleClick={() => onApply(c)}
                            title="Double-click to apply this upgrade to your tower"
                        >
                            <span className="opt-rank">#{idx + 1}</span>
                            <span className={`opt-cat-badge${CAT_BADGE[c.category] ? ' opt-badge-panel' : ''}`} style={catStyle(c.category)}>
                                {CAT_BADGE[c.category] ?? c.category.toUpperCase()}
                            </span>
                            <div className="opt-name-col">
                                <span className="opt-name">{c.category === 'workshop' ? c.label.replace(/^WS /, '') : c.label}</span>
                                <span className="opt-sub">{c.subLabel}</span>
                                {c.freeFillsAt !== undefined && (
                                    <span className="opt-sub">Free upgrades max it by about {aboutWave(c.freeFillsAt)}</span>
                                )}
                                {blend && c.coinsPct !== undefined ? (
                                    <span className="opt-waves">
                                        {runGains?.[idx]
                                            ? `+${fmtWaves(runGains[idx].waves)} waves`
                                            : `${pct(c.pushPct ?? 0)} ${blend === 'waves' ? 'push' : 'survival'}`}
                                        {' · '}{pct(c.coinsPct)} coins/hr
                                    </span>
                                ) : !blend && runGains?.[idx] && (
                                    <span className="opt-waves">
                                        +{fmtWaves(runGains[idx].waves)} waves
                                        {runGains[idx].coins !== null && (
                                            <> · +{(runGains[idx].coins! * 100).toFixed(2)}% coins</>
                                        )}
                                    </span>
                                )}
                            </div>
                            {c.hours !== undefined ? (
                                <span className="opt-cost" title="Research time after your lab speed, and coins">
                                    {formatLabTime(c.hours)}<span className="opt-cost-type"> 🔬</span>
                                    {c.coins !== undefined && (
                                        <span className="opt-sub" style={{ display: 'block' }}>{coinsText(c.coins)} 🪙</span>
                                    )}
                                </span>
                            ) : (
                            <span className="opt-cost" title={c.costType !== 'stones' && !c.costKnown ? 'Cost not known — not ranked by price' : undefined}>
                                {c.costType === 'stones' ? c.cost.toLocaleString()
                                    : !c.costKnown ? '—' : c.cost === 0 ? 'Free' : coinsText(c.cost)}
                                {c.cost !== 0 && (
                                    <span className="opt-cost-type">
                                        {c.costType === 'stones' ? <img src={stoneIcon} alt="stones" className="cost-icon" /> : COST_UNIT[c.costType]}
                                    </span>
                                )}
                                {c.costType === 'shards' && c.coins !== undefined && (
                                    <span className="opt-sub" style={{ display: 'block' }}>{coinsText(c.coins)} 🪙</span>
                                )}
                            </span>
                            )}
                            <span className="opt-gain" style={{ color: gainColor(c.scorePct) }}>
                                {c.scorePct > 0 ? `+${c.scorePct.toFixed(3)}%` : '—'}
                            </span>
                        </div>
                    ))}

                    {!showAll && candidates.length > OPT_DEFAULT_SHOW && (
                        <div className="opt-show-more">
                            <button className="btn btn-dim" onClick={onShowMore}>
                                Show all {candidates.length} upgrades
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}