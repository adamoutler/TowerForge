// ============================================================
//  TowerForge Companion — The account, ready to score
//  Builds the optimizer's snapshot from the saved account and sets it up
//  for a goal: the calibrations that goal needs (damage by source, coins,
//  survival), Run Length for waves, and coins for a run to any wave.
//  Shared by the Optimizer and the What If page so both score the same.
//  Pure functions — no store imports.
// ============================================================

import type { AppState, BuildType } from '../types/gameTypes';
import type { OptimizerSnapshot } from './optimizer';
import type { OptGoal } from '../constants/optimizerConfig';
import { pushGoalOf } from '../constants/optimizerConfig';
import { activeBattleReport } from './battleReport';
import type { BattleReport } from './battleReport';
import { readActiveModuleBonuses } from './modBonuses';
import { runRatesFrom } from './runRates';
import { packageChancePct } from './ttt';
import { enhForPreset } from './statHelpers';
import { botsForPreset } from '../constants/botData';
import { buildFarmCalibration } from './farming';
import { buildEhpCalibration } from './ehp';
import { buildEdpsCalibration } from './edps';
import { buildRunLengthModel, killerMix, oneHitEnds, skipWorth } from './runLength';
import type { RunLengthModel, RunStat } from './runLength';
import { buildRunModel, projectRun, runSettingsFromCards } from './runCoins';
import type { RunProjection } from './runCoins';
import { defaultBattleIndex } from './gameExport';
import { TOURNAMENT_TIER, hasDissonance } from './dissonance';
import { conditioned, leagueConditions } from './battleConditions';
import type { TourneyConditions } from './battleConditions';
import { LEAGUE_HEAT } from '../constants/tournamentData';

export type AccountState = Pick<AppState,
    'activePreset' | 'profile' | 'perkData' | 'wsData' | 'enhData' | 'labData' | 'cardData' | 'uwData'
    | 'relicData' | 'botData' | 'moduleState' | 'battleReportText' | 'importedBattles' | 'battleReportChoice'>
    & Partial<Pick<AppState, 'guardianData' | 'vaultLevels' | 'tierWaves' | 'labProgress' | 'dissonanceWaves'>>;

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// The chosen Battle Report (calibrates damage, coins and survival).
export const chosenReport = (s: AccountState): BattleReport | null =>
    activeBattleReport(s.battleReportText, s.importedBattles, s.battleReportChoice);

// The account as the optimizer scores it, for the active preset.
export function snapshotFromState(s: AccountState): OptimizerSnapshot {
    // Dissonant Boosts at the tier the model calibrates on; a tournament run
    // counts Echo alone.
    const run = chosenReport(s);
    const boostTier = run?.tournament ? TOURNAMENT_TIER : run?.tier || s.profile.highestTier || 0;
    const dissonance = hasDissonance(s.dissonanceWaves) && (run?.tournament || boostTier > 0)
        ? { waves: copy(s.dissonanceWaves), tier: boostTier }
        : undefined;
    // Run rates (boss/elite kills, packages, cash…) from the chosen report
    // drive several unique module effects.
    const modBonuses = readActiveModuleBonuses(
        s.moduleState, s.perkData, s.labData, s.cardData, runRatesFrom(chosenReport(s)),
    );
    // The report's package rate belongs to today's package chance.
    modBonuses.run = {
        ...modBonuses.run,
        pkgChanceAtRun: packageChancePct(s.activePreset, s.wsData, s.labData, s.cardData, modBonuses),
    };
    return {
        presetIdx: s.activePreset,
        wsData: copy(s.wsData),
        enhData: copy(enhForPreset(s.enhData, s.activePreset)),
        labData: copy(s.labData),
        labProgress: s.labProgress ? copy(s.labProgress) : undefined,
        dissonance,
        cardData: copy(s.cardData),
        perkData: copy(s.perkData),
        uwData: copy(s.uwData),
        relicData: copy(s.relicData),
        modBonuses,
        moduleState: copy(s.moduleState),
        botData: botsForPreset(s.botData, s.activePreset),
        guardian: s.guardianData ? copy(s.guardianData) : undefined,
        excludedUWs: [...(s.profile.excludedUWs ?? [])],
        excludedWorkshop: [...(s.profile.excludedWorkshop ?? [])],
        vault: s.vaultLevels ? { ...s.vaultLevels } : undefined,
        progress: { tierWaves: { ...(s.tierWaves ?? {}) }, completedTier: s.profile.completedTier || 0 },
        wsUnlocked: s.profile.wsUnlocked ? { ...s.profile.wsUnlocked } : undefined,
        metric: metricOf(effectiveBuild(s.profile.build, s.importedBattles)),
    };
}

const metricOf = (build: BuildType): OptimizerSnapshot['metric'] =>
    (build === 'Farming' ? 'coins' : build === 'eHP' ? 'ehp' : 'edps');

export interface GoalModels {
    run: RunLengthModel | null;        // Run Length, from the deaths in the history
    // Tournament runs: the league's fixed battle conditions (Skip Reduction,
    // Skip Decay), which every tournament has — so a skip upgrade adds less.
    conditions?: TourneyConditions;
    // What If's tournament mode: the conditions the calibration run had
    // (scores are calibrated under them), the wave the run ends under
    // `conditions`, and the conditions at any wave — they get stronger as a
    // run goes on, so a run that goes further meets stronger ones.
    calibConditions?: TourneyConditions;
    startWave?: number;
    conditionsAt?: (wave: number) => TourneyConditions;
    worth: number;                     // skipWorth (0 without Run Length)
    coinsAt?: (wave: number) => number; // coins for a run to a wave (Coins per Run)
    projectAt?: (wave: number) => RunProjection;   // coins and real time for a run to a wave
}

// Run Length and Coins per Run, from the saved battle history, matching
// the chosen run: a tournament run is measured against your tournament
// deaths on the tournament curve (and has no Coins per Run — tournaments
// pay differently), a campaign run against deaths on its own tier.
// What ends a build's runs: enemy health for Glass Cannon (any hit is
// lethal), enemy attack for builds that push survival (eHP, Farming).
export const runStatOf = (build: BuildType | '' | undefined): RunStat =>
    build && pushGoalOf(build) === 'survival' ? 'attack' : 'health';

// Hybrid builds are scored as the build their runs behave like (2026-10-23):
// Glass Cannon when the recent deaths end to single hits far past what the
// tower heals (enemy health decides, runLength.oneHitEnds), eHP when hits
// wear the tower down (enemy attack decides). Without deaths that say
// (none saved, or exports before damage taken was recorded): Glass Cannon.
// Every other build is itself; no build set reads as Glass Cannon.
export function effectiveBuild(build: BuildType | '' | undefined, battles: BattleReport[]): BuildType {
    if (build !== 'Hybrid') return (build || 'Glass Cannon') as BuildType;
    const model = buildRunLengthModel(battles, { stat: 'attack' });
    return model && oneHitEnds(model) === false ? 'eHP' : 'Glass Cannon';
}

export function runModels(s: Pick<AccountState, 'importedBattles' | 'cardData' | 'activePreset'
    | 'battleReportText' | 'battleReportChoice'> & Partial<Pick<AccountState, 'profile' | 'labData'>>): GoalModels {
    const chosen = activeBattleReport(s.battleReportText, s.importedBattles, s.battleReportChoice);
    const tournament = !!chosen?.tournament;
    const run = buildRunLengthModel(s.importedBattles, {
        tournament, tier: chosen?.tier, stat: runStatOf(effectiveBuild(s.profile?.build, s.importedBattles)),
    });
    const settings = runSettingsFromCards(s.cardData, s.activePreset);
    const coinModel = tournament ? null
        : buildRunModel(s.importedBattles, defaultBattleIndex(s.importedBattles), settings);
    const projectAt = coinModel && run
        ? (wave: number) => projectRun(coinModel.calibration, settings, wave, run.tier)
        : undefined;
    const heat = LEAGUE_HEAT.find(l => l.league === s.profile?.league);
    return {
        run,
        conditions: tournament && run && heat ? leagueConditions(heat, run.typicalWave, s.labData ?? {}) : undefined,
        worth: run ? skipWorth(run) : 0,
        coinsAt: projectAt ? (wave: number) => projectAt(wave).coins : undefined,
        projectAt,
    };
}

// Sets the snapshot up to score `goal` (coinWeight is how much coins count
// in "coins and push", 0–1).
export function applyGoal(
    snap: OptimizerSnapshot, goal: OptGoal, build: BuildType, report: BattleReport | null,
    models: GoalModels, coinWeight = 0.5,
): void {
    const pushWaves = pushGoalOf(build) === 'waves';
    // Calibrated under the battle conditions the run had.
    const cal = conditioned({ ...snap, conditions: models.calibConditions ?? snap.conditions ?? models.conditions });
    const wantsWaves = goal === 'waves' || (goal === 'blend' && pushWaves);
    const wantsEhp = goal === 'survival' || (goal === 'blend' && !pushWaves);
    snap.farm = goal === 'coins' || goal === 'blend' ? buildFarmCalibration(cal, report) : undefined;
    snap.ehp = wantsEhp ? buildEhpCalibration(cal, report) : undefined;
    snap.edps = goal === 'damage' || wantsWaves ? buildEdpsCalibration(cal, report) ?? undefined : undefined;
    snap.metric = goal === 'coins' ? 'coins' : wantsEhp && goal !== 'blend' ? 'ehp' : 'edps';
    // Waves need damage by source; without it eDPS stands in.
    snap.edpsMode = wantsWaves && snap.edps ? 'waves' : 'damage';
    snap.blend = goal === 'blend' ? { push: pushWaves ? 'waves' : 'ehp', coinWeight } : undefined;
    // Level skip and the killers' labs count when the run model matches the
    // push: enemy health for waves, enemy attack for survival.
    const runFits = !!models.run && (wantsWaves ? models.run.stat === 'health' : wantsEhp && models.run.stat === 'attack');
    snap.skipWorth = runFits ? models.worth : undefined;
    snap.killers = runFits ? killerMix(models.run!) : undefined;
    // Set before the calibration by the Tournament page; else the league's own.
    snap.conditions = snap.conditions ?? models.conditions;
}
