// ============================================================
//  TowerForge Companion — Ask AI: the account data it reads
//  The assistant (a small model running in the player's browser) can't
//  calculate anything itself, so every number it gives comes from here:
//  the same engine the Optimizer, What If and Tournament pages use,
//  written out as short plain text it can quote.
//   • accountSummary — always in its prompt;
//   • bestUpgrades — the Optimizer's next picks for a currency;
//   • whatIfChanges — What If for upgrades named in words ("max CL");
//   • levelsOf — current levels of upgrades named in words;
//   • tournamentOutlook — the Tournament page's estimate for this week;
//   • runsReport — the saved runs, with damage by source;
//   • tierOutlook — how far the same damage gets on another tier;
//   • labBoostsReport — the Labs page's Lab boosts and lab times;
//   • shardPlanReport — Modules → Shard plan, per type.
//  What If also has the What If page's tournament mode.
//  Pure functions — no store imports.
// ============================================================

import type { AppState, BuildType, League, OptCandidate, OptCategory, OptCurrency } from '../types/gameTypes';
import type { AccountState, GoalModels } from '../engine/accountModels';
import { applyGoal, chosenReport, effectiveBuild, runModels, snapshotFromState } from '../engine/accountModels';
import { bestGuardianChips, groupPath, mergeRepeats, simulateCategoryPath, simulateMedalPath, simulateShardPaths, simulateStonePath } from '../engine/optimizer';
import { changeCost, upgradeTargets, whatIf } from '../engine/whatIf';
import type { Change, Costs, UpgradeTarget } from '../engine/whatIf';
import { buildTournamentModel, heatOf, newestTournament, tournamentWhatIf, withTournamentBuild } from '../engine/tournamentModel';
import { leagueMoves, leagueStats, placed } from '../engine/tourneyHistory';
import type { Ticks } from '../engine/tournamentModel';
import { buildRunLengthModel, deathWave, killedBy, pathRunGains } from '../engine/runLength';
import { activeBattleReport, extraDamage, runKey } from '../engine/battleReport';
import type { BattleReport } from '../engine/battleReport';
import { defaultBattleIndex } from '../engine/gameExport';
import { DISSONANCE_TRACKS, TRACK_LABEL, TRACK_STAT, dissonanceFactor, hasDissonance, trackBoost } from '../engine/dissonance';
import { buildEdpsCalibration, edpsScore } from '../engine/edps';
import { formatGameNumber } from '../engine/gameNumbers';
import { formatLabTime } from '../engine/upgradeCosts';
import { activeLoadout } from '../engine/statHelpers';
import { lockedNotes } from '../engine/unlocks';
import { boostSettings, boostsForLabs, cellIncome, hoursOnHand, labHours, planLabBoosts } from '../engine/labBoosts';
import { labTimerLeft } from '../engine/labTimer';
import { planTypeShards } from '../engine/shardPlan';
import { buildRunModel, projectRun, runSettingsFromCards } from '../engine/runCoins';
import { labFinishAt } from '../engine/labTimer';
import { LABS, MAX_TIER, RELICS, UWS, UW_UNLOCK_COSTS, presetLabel } from '../constants/gameData';
import { VAULT_SECTIONS } from '../constants/vaultData';
import { vaultKeys, vaultLevel } from '../engine/vault';
import { activeChips } from '../engine/guardian';
import { CHIPS } from '../constants/guardianData';
import { GAME_LEAGUES } from '../constants/gameExportMaps';
import { BOTS_CONFIG, botsForPreset } from '../constants/botData';
import { RARITIES, rarityStars } from '../constants/moduleRarities';
import { BUILD_GOALS, GOAL_LABELS } from '../constants/optimizerConfig';
import type { OptGoal } from '../constants/optimizerConfig';
import { HEAT_CONDITIONS } from '../constants/tournamentData';

// Everything the tools read: the account plus a few things the pages keep.
export type AiAccount = AccountState & Pick<AppState,
    'currencies' | 'labsRunning' | 'tourneyLog' | 'tierWaves' | 'botLoadouts'> & Partial<Pick<AppState, 'tourneyRecords' | 'vaultLevels'>>;

// The Tournament page's settings (components/common/tourneySim.ts).
export interface AiTourneySettings {
    league: League;
    week: Ticks;
    recent: Ticks;
    preset?: number;
    loadout?: string;
}

export interface ToolResult {
    title: string;     // shown under the answer ("Looked at: …")
    text: string;      // what the model reads
    // What If's changes, for the answer's "Open in What If" button.
    whatIf?: { changes: Change[]; tournament: boolean };
}

const num = (v: number) => formatGameNumber(v < 1000 ? Math.round(v) : v);
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;
const buildOf = (s: AiAccount) => effectiveBuild(s.profile.build as BuildType, s.importedBattles);

// ── Account summary ───────────────────────────────────────────
// The labs named in the summary (the rest: the levels tool).
const KEY_LABS = ['Damage Lab', 'Attack Speed Lab', 'Critical Factor Lab', 'Super Crit Mult Lab', 'Health Lab',
    'Defense % Lab', 'Enemy HP Lvl Skip Lab', 'Enemy Atk Lvl Skip Lab', 'Coins/Kill Lab', 'Cash Bonus Lab'];

// `tourney`: the question is about tournaments, so the cards, modules, bots
// and Guardian chips are the tournament build (the preset and module
// loadout chosen on the Tournament page). Otherwise a player's farming
// chips (Fetch, Bounty…) read as their tournament setup — the first
// player report (2026-10-30): "It doesn't look at my tournament setup."
export function accountSummary(s: AiAccount, now = Date.now(), tourney?: AiTourneySettings): string {
    const p = s.profile;
    const lines: string[] = [];
    const setup = tourney ? withTournamentBuild(s, tourney.preset, tourney.loadout) : s;
    lines.push(`Build: ${p.build || 'Glass Cannon (not set on the Profile page, so TowerForge assumes it)'}. Highest tier reached: ${p.highestTier ? `T${p.highestTier}` : 'unknown'}`
        + `${p.completedTier ? ` (completed T${p.completedTier})` : ''}. League: ${p.league || 'unknown'}`
        + `${p.currentLeague && p.currentLeague !== p.league ? ` (this week: ${p.currentLeague})` : ''}.`);
    const best = Object.entries(s.tierWaves ?? {}).map(([t, w]) => [Number(t), Number(w)] as const)
        .filter(([, w]) => w > 0).sort((a, b) => b[0] - a[0]).slice(0, 4);
    if (best.length) lines.push(`Best waves: ${best.map(([t, w]) => `T${t} W${w.toLocaleString()}`).join(', ')}.`);

    const c = s.currencies;
    if (c) lines.push(`Holding: ${num(c.coins)} coins, ${c.stones.toLocaleString()} stones, ${c.gems.toLocaleString()} gems, `
        + `${c.medals.toLocaleString()} medals, ${c.bits.toLocaleString()} bits.`);

    const uws = UWS.filter(u => s.uwData.data[u.a]?.own).map(u => {
        const d = s.uwData.data[u.a]!;
        const stats = u.s.map(([name, max], i) => `${name} ${d.sv[i] ?? 1}/${max}`).join(', ');
        const plus = d.upOwn ? `; ${u.up} (UW+) ${(d.upLvl ?? 0) + 1}/${u.upMax + 1}` : '';
        return `${u.n} (${stats}${plus})`;
    });
    lines.push(uws.length ? `Ultimate Weapons: ${uws.join('; ')}.` : 'Ultimate Weapons: none owned.');

    if (tourney) {
        lines.push(tourney.preset !== undefined || tourney.loadout !== undefined
            ? 'The cards, modules, bots and Guardian chips below are their tournament build, chosen on the Tournament page.'
            : 'No tournament build is chosen on the Tournament page, so the cards, modules, bots and Guardian chips below are the ones they have on now.');
    }
    const presetIdx = setup.activePreset;
    const cards = s.cardData.presets?.[presetIdx] ?? [];
    if (cards.length) {
        lines.push(`Cards in ${presetLabel(p.presetNames, presetIdx)}: ${cards.map(n => {
            const e = s.cardData.data[n];
            return e ? `${n} ${e.s}★${e.mu ? ` (mastery ${e.m})` : ''}` : n;
        }).join(', ')}.`);
    }

    const lo = activeLoadout(setup.moduleState);
    if (lo) {
        const mods = (['cannon', 'armor', 'generator', 'core'] as const).map(type => {
            const m = s.moduleState.library.find(x => x.id === lo.slots[type]?.main);
            const lv = s.moduleState.slotLevels?.[type]?.main ?? 0;
            const stars = rarityStars(m?.rarity);
            const rarity = stars ? `Ancestral ${stars}★` : RARITIES.find(r => r.k === m?.rarity)?.label ?? m?.rarity;
            const subs = (m?.subs ?? []).filter(x => x.effect).map(x => `${x.effect} ${x.rar}`);
            return m ? `${type}: ${m.name} (${rarity}, slot Lv ${lv}${subs.length ? `; substats ${subs.join(', ')}` : ''})` : `${type}: empty`;
        });
        lines.push(`Modules equipped: ${mods.join('; ')}.`);
    }

    const presetBots = botsForPreset(s.botData, setup.activePreset);
    const bots = BOTS_CONFIG.filter(b => presetBots[b.name]?.owned).map(b => {
        const e = presetBots[b.name]!;
        const lv = b.stats.map((st, i) => `${st.label} ${e.medals?.[i] ?? 0}/${st.values.length}`).join(', ');
        return `${b.name} (${lv}${e.plusLv ? `; Bot+ ${e.plusLv}/${b.plusMax}` : ''})`;
    });
    if (bots.length) lines.push(`Bots: ${bots.join('; ')}.`);

    const running = (s.labsRunning ?? []).filter(l => l.lab);
    if (running.length) {
        lines.push(`Labs researching: ${running.map(l => {
            const lv = l.toLevel ?? (s.labData[l.lab!] ?? 0) + 1;
            const done = labFinishAt(l);
            const left = done ? Math.max(0, (done - now) / 3600000) : null;
            return `${l.lab} to Lv ${lv}${left !== null ? (left > 0 ? ` (${formatLabTime(left)} left)` : ' (done)') : ''}`;
        }).join('; ')}.`);
    }

    // Labs: how many, and the main ones (any lab's level: the levels tool).
    const labs = LABS.flatMap(g => g.l).filter(([n]) => (s.labData[n] ?? 0) > 0);
    if (labs.length) {
        const maxed = labs.filter(([n, max]) => (s.labData[n] ?? 0) >= max).length;
        const key = KEY_LABS.flatMap(n => {
            const max = labs.find(([x]) => x === n)?.[1];
            return max ? [`${n} ${s.labData[n]}/${max}`] : [];
        });
        lines.push(`Labs: ${labs.length} researched, ${maxed} maxed${key.length ? `; ${key.join(', ')}` : ''}.`);
    }
    // Campaign only: whether Dissonant Boosts count in tournaments isn't confirmed.
    const farmRun = s.importedBattles[defaultBattleIndex(s.importedBattles)];
    if (!tourney && farmRun && hasDissonance(s.dissonanceWaves)) {
        const waves = s.dissonanceWaves;
        const tracks = DISSONANCE_TRACKS.map(t => `${TRACK_LABEL[t]} ×${trackBoost(waves, t, farmRun.tier, s.labData).total.toFixed(2)} on ${TRACK_STAT[t]}`);
        lines.push(`Dissonant Boosts on T${farmRun.tier}, where they farm: ${tracks.join(', ')}; each tier has its own.`);
    }
    const relics = Object.values(RELICS).flat().filter(([k]) => (s.relicData?.[k] ?? 0) !== 0)
        .map(([k, name, , , unit]) => `${name} ${s.relicData[k] > 0 && unit !== 's' ? '+' : ''}${s.relicData[k]}${unit}`);
    if (relics.length) lines.push(`Relic bonuses: ${relics.join(', ')}.`);
    const vault = s.vaultLevels ?? {};
    const bought = VAULT_SECTIONS.flatMap(sec => sec.upgrades).filter(u => vaultLevel(vault, u) > 0);
    if (bought.length) {
        const maxedV = bought.filter(u => vaultLevel(vault, u) >= u.costs.length).length;
        lines.push(`Vault: ${bought.length} upgrades bought (${maxedV} maxed), ${vaultKeys(vault).spent.toLocaleString()} keys spent: `
            + `${bought.map(u => `${u.name} ${vaultLevel(vault, u) >= u.costs.length ? 'max' : `${vaultLevel(vault, u)}/${u.costs.length}`}`).join(', ')}.`);
    }
    const chips = activeChips(s.guardianData, setup.activePreset);
    if (chips.length) {
        lines.push(`Guardian chips equipped: ${chips.map(a => `${a.chip.name} (${a.chip.stats.map((st, k) => `${st.name} ${a.levels[k]}/${st.max}`).join(', ')})`).join('; ')}.`);
    }

    const runs = [...s.importedBattles].sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 5);
    if (runs.length) {
        lines.push(`Recent runs (newest first): ${runs.map(r => {
            const by = killedBy(r);
            return `${r.tournament ? 'tournament' : `T${r.tier}`} W${r.wave.toLocaleString()}`
                + `${by ? `, killed by ${by}` : by === null ? ', ended early' : ''}`
                + `${!r.tournament && r.coinsPerHour ? `, ${num(r.coinsPerHour)} coins/h` : ''}`;
        }).join('; ')}.`);
    }
    return lines.join('\n');
}

// ── Best upgrades ─────────────────────────────────────────────
export type AiCurrency = 'any' | OptCurrency;

const CURRENCY_CATS: Record<OptCurrency, OptCategory[]> = {
    stones: ['stones'], coins: ['workshop', 'enhancements'], research: ['labs'], shards: ['modules'],
    medals: ['bots'], gems: ['cards'], bits: ['guardian'],
};
const CURRENCY_NAMES: Record<OptCurrency, string> = {
    stones: 'stones', coins: 'coins (workshop and enhancements)', research: 'lab research', shards: 'Module Shards',
    medals: 'medals (bots)', gems: 'gems (card slots)', bits: 'bits (Guardian chips)',
};
const PICKS = 6;

// What the player holds of a currency (null: not tracked, e.g. lab time).
function held(s: AiAccount, c: OptCurrency): number | null {
    const cur = s.currencies;
    if (!cur) return null;
    return { stones: cur.stones, coins: cur.coins, medals: cur.medals, gems: cur.gems, bits: cur.bits, shards: null, research: null }[c];
}

// What the player holds buys, in the Optimizer's order: the model can't add
// costs up, and two picks it can afford one by one may be more than it holds
// together. Module shards go by type (each type only levels its own slots).
const SHARD_TYPES = ['cannon', 'armor', 'generator', 'core'] as const;
function holdLine(s: AiAccount, cur: OptCurrency, picks: OptCandidate[]): string | null {
    const c = s.currencies;
    if (!c || !picks.length) return null;
    const label = (p: OptCandidate) => `${p.label} ${p.subLabel}`;
    if (cur === 'shards') {
        const left: Record<string, number> = Object.fromEntries(SHARD_TYPES.map(t => [t, c[`${t}Shards`] ?? 0]));
        const typeOf = (p: OptCandidate) => SHARD_TYPES.find(t => p.label.toLowerCase().startsWith(t));
        const now: string[] = [];
        const short: string[] = [];
        for (const p of picks) {
            const t = typeOf(p);
            if (!t || p.costKnown === false) continue;
            if (p.cost <= left[t]) { left[t] -= p.cost; now.push(label(p)); }
            else short.push(`${label(p)} needs ${num(p.cost - left[t])} more ${t} shards`);
        }
        return `Shards you hold: ${SHARD_TYPES.map(t => `${t} ${num(c[`${t}Shards`] ?? 0)}`).join(', ')}.`
            + (now.length ? ` They buy now: ${now.join('; ')}.` : ' They don\'t cover any of these yet.')
            + (short.length ? ` Not yet: ${short.join('; ')}.` : '');
    }
    const have = held(s, cur);
    if (have === null) return null;
    const name = CURRENCY_NAMES[cur].split(' (')[0];
    let left = have;
    const now: OptCandidate[] = [];
    for (const p of picks) {
        if (p.costKnown === false || p.cost > left) break;
        left -= p.cost;
        now.push(p);
    }
    const next = picks[now.length];
    if (!now.length) return `The ${amountText(cur, have)} ${name} you hold don't cover the best next buy yet: it needs ${amountText(cur, Math.max(0, picks[0].cost - have))} more.`;
    return `With the ${amountText(cur, have)} ${name} you hold now: buy ${now.map(label).join('; ')} — ${amountText(cur, have - left)} ${name}, leaving ${amountText(cur, left)}.`
        + (next && next.costKnown !== false ? ` The next one, ${label(next)}, needs ${amountText(cur, next.cost - left)} more.` : '');
}

// A price against what's held, said outright (a small model reads "costs
// 50, you hold 160" as short).
const enoughText = (cost: number, have: number, unit: string) =>
    `you hold ${have.toLocaleString()}, ${have >= cost ? 'enough for it' : `${(cost - have).toLocaleString()} ${unit} short`}`;

// What the Optimizer leaves out for a currency — the note the Optimizer
// page shows (engine/unlocks.ts): a new UW or bot isn't ranked.
function unrankedNote(s: AiAccount, snap: ReturnType<typeof snapshotFromState>, cur: OptCurrency): string | undefined {
    const notes = lockedNotes(snap, { stones: s.currencies?.stones, medals: s.currencies?.medals });
    return cur === 'stones' ? notes.stones : cur === 'medals' ? notes.bots : undefined;
}

// The goal the Optimizer page uses for this build (its saved one when it fits).
export function goalFor(build: BuildType, wanted?: string): OptGoal {
    const goals = BUILD_GOALS[build] ?? [];
    return wanted && goals.includes(wanted as OptGoal) ? wanted as OptGoal : goals[0] ?? 'damage';
}

function costText(c: OptCandidate): string {
    if (c.costType === 'research') {
        return c.hours !== undefined ? `${formatLabTime(c.hours)} of research${c.coins ? ` and ${num(c.coins)} coins` : ''}` : '';
    }
    if (c.costKnown === false) return '';
    const unit = { stones: 'stones', coins: 'coins', medals: 'medals', shards: 'shards', gems: 'gems', bits: 'bits', research: '' }[c.costType];
    return c.cost > 0 ? `${num(c.cost)} ${unit}` : 'free';
}

// An amount of a currency in the player's words: "1500 stones", "1.5k stones", "10T coins".
const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15 };
export function budgetIn(q: string): number {
    const m = /(\d[\d,]*(?:\.\d+)?)\s*([kmbtq])?\s*(?:more\s+)?(stones?|coins?|medals?|gems?|shards?|bits?)\b/i.exec(q);
    if (!m) return 0;
    // The game's q is quadrillion and Q quintillion.
    const n = Number(m[1].replace(/,/g, '')) * (m[2] === 'Q' ? 1e18 : m[2] ? SUFFIX[m[2].toLowerCase()] : 1);
    return Number.isFinite(n) ? n : 0;
}

// What the player asked for beyond the currency.
export interface UpgradeAsk {
    // The goal came from the question (not the Optimizer page's).
    goalAsked?: boolean;
    // What they have or will have to spend, in the asked currency ("I'm
    // about to get 1500 stones"); 0 or missing: none named.
    budget?: number;
    // "tournament": scored on tournament runs (the newest one, its league's
    // battle conditions) with the Tournament page's build; "campaign": on a
    // campaign run; "any": the run chosen on the Optimizer page.
    runs?: AiRunKind;
    tourney?: AiTourneySettings;
}

// The account the picks are scored on, and a line saying which runs.
function scoredOn(s: AiAccount, ask: UpgradeAsk): { account: AiAccount; note: string } {
    const chosen = activeBattleReport(s.battleReportText, s.importedBattles, s.battleReportChoice);
    if (ask.runs === 'tournament') {
        const idx = newestTournament(s);
        if (idx < 0) return { account: s, note: 'There are no tournament runs saved yet, so these are scored on the run chosen on the Optimizer page.' };
        const t = ask.tourney;
        const account: AiAccount = { ...s, ...withTournamentBuild(s, t?.preset, t?.loadout), battleReportText: '', battleReportChoice: idx };
        return { account, note: `Scored for tournaments: on your tournament runs (newest: W${s.importedBattles[idx].wave.toLocaleString()}), with the tournament build set on the Tournament page.` };
    }
    if (ask.runs === 'campaign' && chosen?.tournament) {
        const idx = defaultBattleIndex(s.importedBattles);
        if (idx >= 0 && !s.importedBattles[idx].tournament) {
            return { account: { ...s, battleReportText: '', battleReportChoice: idx }, note: `Scored on your campaign runs (T${s.importedBattles[idx].tier}).` };
        }
    }
    return { account: s, note: chosen ? `Scored on ${chosen.tournament ? 'your tournament runs' : `your campaign runs (T${chosen.tier})`}, the run chosen on the Optimizer page.` : '' };
}

// Waves each row adds, like the Optimizer page: Run Length on the scored
// runs. `inOrder`: the rows are one path (each on top of the ones before);
// otherwise each row on its own.
function rowWaves(rows: OptCandidate[], models: GoalModels, inOrder: boolean): number[] {
    const run = models.run!;
    const gains = (r: OptCandidate[]) => pathRunGains(run, r.map(c => c.scorePct), undefined, r.map(c => c.skipPoints ?? 0), models.worth);
    return inOrder ? gains(rows).map(g => g.waves) : rows.map(c => gains([c])[0].waves);
}

const amountText = (cur: OptCurrency, v: number) => (cur === 'coins' ? num(v) : Math.round(v).toLocaleString());

const wavesText = (w: number) => `${w >= 0 ? '+' : '−'}${Math.abs(w) >= 10 ? Math.round(Math.abs(w)) : Math.abs(w).toFixed(1)} waves`;

export function bestUpgrades(s: AiAccount, currency: AiCurrency, goalWanted?: string, ask: UpgradeAsk = {}): ToolResult {
    const build = buildOf(s);
    const goal = goalFor(build, goalWanted);
    const askedFor = ask.goalAsked && goalWanted && goalWanted !== goal ? (GOAL_LABELS as Record<string, string>)[goalWanted] ?? goalWanted : null;
    const { account, note } = scoredOn(s, ask);
    const snap = snapshotFromState(account);
    const models = runModels(account);
    applyGoal(snap, goal, build, chosenReport(account), models);
    // Pushing waves (Glass Cannon) or survival (eHP) with Run Length: gains
    // read in waves, like the Optimizer page.
    const inWaves = !!models.run && (goal === 'waves' ? models.run.stat === 'health' : goal === 'survival' && models.run.stat === 'attack');
    const wanted: OptCurrency[] = currency === 'any' ? ['stones', 'coins', 'research'] : [currency];
    const metric = { damage: 'damage', waves: 'push (damage toward waves)', coins: 'coins per hour', survival: 'survival', blend: 'coins and push' }[goal];
    const budget = ask.budget && ask.budget > 0 ? ask.budget : null;
    const parts: string[] = [`Goal: ${GOAL_LABELS[goal]}. ${inWaves ? 'Each pick shows the waves it adds' : `Each pick's gain is in ${metric}`}, in the order the Optimizer would buy them.`];
    if (note) parts.push(note);
    if (askedFor) parts.push(`They asked about ${askedFor.toLowerCase()}, which TowerForge doesn't score for a ${build} build: these picks are for ${GOAL_LABELS[goal].toLowerCase()} instead.`);
    let stones: OptCandidate[] | null = null;
    for (const cur of wanted) {
        // The stone path is one path in buy order; the others are lists.
        let raw: OptCandidate[] = [];
        const inOrder = cur === 'stones';
        if (cur === 'stones') raw = stones = simulateStonePath(budget ? 150 : 60, snap);
        else if (cur === 'medals') {
            stones ??= simulateStonePath(40, snap);
            const c = s.currencies;
            raw = simulateMedalPath(PICKS, snap, stones, c?.stones ?? 0, simulateShardPaths(20, snap), {
                cannon: c?.cannonShards ?? 0, armor: c?.armorShards ?? 0, generator: c?.generatorShards ?? 0, core: c?.coreShards ?? 0,
            });
        } else {
            for (const cat of CURRENCY_CATS[cur]) raw.push(...simulateCategoryPath(cat, 30, snap));
            raw.sort((a, b) => b.scorePerCost - a.scorePerCost);
        }
        const name = CURRENCY_NAMES[cur].split(' (')[0];
        const gainText = (rows: OptCandidate[], waves: number[] | null, i: number) =>
            waves ? wavesText(waves[i]) : pct(rows[i].scorePct);

        // A budget: the path cut where it runs out (costs must be known).
        if (budget && raw.some(c => c.cost > 0 && c.costKnown !== false)) {
            let spent = 0;
            const fits: OptCandidate[] = [];
            for (const c of raw) {
                if (c.costKnown === false || spent + c.cost > budget) break;
                spent += c.cost;
                fits.push(c);
            }
            // Each upgrade's levels in the plan read as one row ("23% → 29%"),
            // even when the path takes turns between two upgrades.
            const plan = inOrder ? groupPath(fits, fits.length) : fits;
            const waves = inWaves && plan.length ? rowWaves(plan, models, inOrder) : null;
            const next = raw[fits.length];
            if (!plan.length) {
                parts.push(`Plan for ${amountText(cur, budget)} ${name}: nothing fits — the best next ${name} buy, ${next.label} ${next.subLabel}, costs ${costText(next)}.`);
            } else {
                parts.push(`Plan for ${amountText(cur, budget)} ${name} (the Optimizer's path, cut where the ${name} run out${inOrder ? '; each upgrade\'s levels together' : ''}):\n`
                    + plan.map((c, i) => `${i + 1}. ${c.label} ${c.subLabel} — ${gainText(plan, waves, i)}; costs ${costText(c)}`).join('\n'));
                const total = waves ? wavesText(waves.reduce((a, w) => a + w, 0)) : null;
                parts.push(`Headline: with ${amountText(cur, budget)} ${name}, buy ${plan.map(c => `${c.label} ${c.subLabel}`).join('; ')} — ${amountText(cur, spent)} ${name} in all${total ? `, about ${total}` : ''}.`
                    + (next ? ` The next buy after that is ${next.label} ${next.subLabel} for ${costText(next)}.`
                        : ` That's everything the Optimizer scores for ${name}: ${amountText(cur, budget - spent)} ${name} would be left.`));
            }
            continue;
        }

        const path = inOrder ? mergeRepeats(raw) : raw;
        const picks = path.slice(0, PICKS);
        const waves = inWaves && picks.length ? rowWaves(picks, models, inOrder) : null;
        if (picks[0]) parts.push(`Headline: the best next ${name} buy is ${picks[0].label} ${picks[0].subLabel}${costText(picks[0]) ? ` for ${costText(picks[0])}` : ''} (${gainText(picks, waves, 0)}).`);
        const rows = picks.map((c, i) => {
            const cost = costText(c);
            return `${i + 1}. ${c.label} ${c.subLabel} — ${gainText(picks, waves, i)}${cost ? `; costs ${cost}` : ''}`;
        });
        const unranked = unrankedNote(s, snap, cur);
        parts.push(`Next ${CURRENCY_NAMES[cur]}:\n${rows.length ? rows.join('\n')
            : `nothing the Optimizer can score for this goal.${unranked ? '' : ' The upgrades this currency buys don\'t change what this goal measures on this account.'}`}`);
        if (unranked) parts.push(unranked);
        const hold = holdLine(s, cur, picks);
        if (hold) parts.push(hold);
        // Costs compared by the site: small models misread K, M, B, T, q, Q…
        const priced = picks.filter(c => c.cost > 0 && c.costKnown !== false);
        if (priced.length > 1) {
            const cheap = [...priced].sort((a, b) => a.cost - b.cost);
            // Worded so that echoing it reads naturally ("Cheapest first:" was quoted as a list).
            parts.push(`In order of cost, lowest first: ${cheap.map(c => `${c.label} ${c.subLabel} (${costText(c)})`).join('; ')}.`);
        }
    }
    const scope = [ask.runs === 'tournament' && 'tournaments', budget && `${amountText(wanted[0], budget)} to spend`].filter(Boolean).join(', ');
    return { title: `Optimizer — ${wanted.map(c => CURRENCY_NAMES[c].split(' (')[0]).join(', ')}${scope ? ` (${scope})` : ''}`, text: parts.join('\n') };
}

// ── Finding upgrades named in words ───────────────────────────
// Players write "CL", "chrono field duration", "damage lab", "CF+"…
const STOP = new Set(['the', 'my', 'a', 'an', 'of', 'to', 'and', 'level', 'levels', 'lvl', 'lv', 'upgrade', 'upgrades', 'stat', 'max', 'maxed', 'maxing', 'uw', 'uws']);
const ABBR: Record<string, string> = Object.fromEntries(UWS.map(u => [u.a.toLowerCase(), u.n.toLowerCase()]));
Object.assign(ABBR, { gc: 'golden combo', dr: 'death ray', ws: 'workshop', cc: 'critical chance', cf: 'chrono field', 'ehp': 'health' });

export function wordsOf(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9+]+/)) {
        const w = raw.replace(/\+$/, '');
        if (!w || STOP.has(w)) continue;
        if (raw.endsWith('+')) out.push('+');
        out.push(...(ABBR[w] ?? w).split(' '));
    }
    return out;
}

const KIND_WORDS: Record<UpgradeTarget['kind'], string> = {
    uw: 'ultimate weapon', uwp: 'ultimate weapon plus +', workshop: 'workshop', lab: 'lab labs research',
    enhancement: 'enhancement enhancements', module: 'module modules slot', bot: 'bot bots', guardian: 'guardian chip chips',
};

// Upgrades matching the words best. "CL" alone means every Chain Lightning
// stat; a UW+ needs a "+" or "plus" (or its own name, e.g. Smite).
export function findTargets(targets: UpgradeTarget[], query: string): UpgradeTarget[] {
    // Only words some upgrade has count ("how many waves would maxing CL get
    // me" is about CL).
    const vocab = new Set(targets.flatMap(t => wordsOf(`${t.label} ${t.group} ${KIND_WORDS[t.kind]}`)));
    const q = wordsOf(query).filter(w => vocab.has(w));
    if (!q.length) return [];
    const scored = targets.map(t => {
        const words = new Set(wordsOf(`${t.label} ${t.group} ${KIND_WORDS[t.kind]}`));
        const name = new Set(wordsOf(t.label));
        let hit = 0;
        for (const w of q) if (words.has(w)) hit += name.has(w) ? 1 : 0.4;
        // A UW+ when it's asked for ("+", "plus" or its own name), else the UW.
        const plusWanted = q.includes('+') || q.includes('plus');
        const upWords = t.kind === 'uwp' ? wordsOf(t.label.split(' — ')[1] ?? '') : [];
        const namesUp = upWords.length > 0 && upWords.every(w => q.includes(w));
        const fit = (t.kind === 'uwp' && !plusWanted && !namesUp) || (t.kind === 'uw' && plusWanted) ? -0.5 : 0;
        // Its whole name asked for ("Damage" lab over "Super Crit Damage");
        // workshop before labs unless labs are named (both have "Damage").
        const exact = [...name].every(w => q.includes(w)) ? 0.1 : 0;
        const order = t.kind === 'workshop' ? 0.05 : 0;
        return { t, score: hit / q.length + fit + exact + order };
    }).filter(x => x.score > 0.45).sort((a, b) => b.score - a.score);
    if (!scored.length) return [];
    const top = scored[0];
    // All of one UW's stats when no stat was named.
    const sameUw = scored.filter(x => x.t.kind === 'uw' && top.t.kind === 'uw'
        && x.t.key.split('|')[0] === top.t.key.split('|')[0] && Math.abs(x.score - top.score) < 0.03);
    return sameUw.length > 1 ? sameUw.map(x => x.t) : [top.t];
}

// A UW or UW+ named in the words that this account doesn't own: What If
// can't try it, and the words would otherwise match a lab ("maxing Death
// Wave" → the DW-Health lab) and read "+0.0 waves".
export function missingUw(s: AiAccount, words: string): string | null {
    const w = wordsOf(words);
    if (w.includes('lab') || w.includes('labs') || w.includes('research')) return null;
    for (const u of UWS) {
        const d = s.uwData.data[u.a];
        const namesUw = wordsOf(u.n).every(x => w.includes(x));
        const namesPlus = wordsOf(u.up).every(x => w.includes(x)) || (namesUw && (w.includes('+') || w.includes('plus')));
        if (namesPlus && !d?.upOwn) {
            return `${u.up} (${u.n}'s UW+) isn't unlocked on this account yet${d?.own ? '' : `, and neither is ${u.n}`}: it adds nothing until you unlock it.`;
        }
        if (namesUw && !d?.own) {
            const next = UW_UNLOCK_COSTS[UWS.filter(x => s.uwData.data[x.a]?.own).length];
            return `${u.n} isn't unlocked on this account yet: you don't own it, so it adds nothing until you unlock it.`
                + (next ? ` Your next Ultimate Weapon costs ${next.toLocaleString()} stones: ${enoughText(next, s.currencies?.stones ?? 0, 'stones')}.` : '');
        }
    }
    return null;
}

// "max", "+5", "next", "20" → a level for the target.
export function levelFor(t: UpgradeTarget, level: string): number | null {
    const l = level.trim().toLowerCase();
    if (!l || l === 'max' || l === 'maxed' || l === 'maximum') return t.max;
    if (l === 'next') return Math.min(t.max, t.current + 1);
    const rel = /^\+\s*(\d+)$/.exec(l);
    if (rel) return Math.min(t.max, t.current + Number(rel[1]));
    const abs = /(\d+)/.exec(l);
    return abs ? Math.max(0, Math.min(t.max, Number(abs[1]))) : null;
}

// ── Levels ────────────────────────────────────────────────────
export function levelsOf(s: AiAccount, query: string): ToolResult {
    const targets = upgradeTargets(snapshotFromState(s));
    const found = findTargets(targets, query);
    const text = found.length
        ? found.map(t => `${t.label} (${t.group}): level ${t.current} of ${t.max}`).join('\n')
        : `No upgrade on this account matches "${query}".`;
    return { title: 'Current levels', text };
}

// ── What If ───────────────────────────────────────────────────
export interface AiChangeAsk { upgrade: string; level: string }

const COSTS: [OptCurrency, (v: number) => string][] = [
    ['coins', v => `${num(v)} coins`], ['stones', v => `${v.toLocaleString()} stones`],
    ['research', v => `${formatLabTime(v)} of research`], ['medals', v => `${v.toLocaleString()} medals`],
    ['shards', v => `${num(v)} Module Shards`], ['bits', v => `${v.toLocaleString()} bits`],
];
const costsText = (c: Costs) => COSTS.filter(([k]) => (c[k] ?? 0) > 0).map(([k, f]) => f(c[k]!)).join(', ') || 'free';

interface WhatIfSetup { base: ReturnType<typeof snapshotFromState>; models: GoalModels; report: ReturnType<typeof chosenReport> }

function campaignSetup(s: AiAccount): WhatIfSetup {
    // What If's campaign mode: the chosen report, or the usual campaign run
    // when that's a tournament run.
    const campaign: AccountState = chosenReport(s)?.tournament
        ? { ...s, battleReportText: '', battleReportChoice: defaultBattleIndex(s.importedBattles) }
        : s;
    return { base: snapshotFromState(campaign), models: runModels(campaign), report: chosenReport(campaign) };
}

// What If's tournament mode, as on the What If page (tournamentWhatIf): the
// tournament build on the newest tournament run, under this week's battle
// conditions ticked on the Tournament page. null without a tournament run.
function tournamentSetup(s: AiAccount, sim: AiTourneySettings): WhatIfSetup | null {
    const idx = newestTournament(s);
    if (idx < 0) return null;
    const entry = s.tourneyLog?.[runKey(s.importedBattles[idx])];
    const league = (sim.league || s.profile.currentLeague || s.profile.league || '') as League;
    const last: Ticks = entry ? Object.fromEntries(entry.conditions.map(k => [k, true])) : sim.recent;
    const lastLeague = (entry?.league || league) as League;
    const t = buildTournamentModel(s, { league, week: sim.week, last, lastLeague, preset: sim.preset, loadout: sim.loadout }, buildOf(s));
    return t ? tournamentWhatIf(t, sim.week, last, lastLeague) : null;
}

// `tourney`: What If for tournaments (the question asked about them).
export function whatIfChanges(s: AiAccount, asks: AiChangeAsk[], tourney?: AiTourneySettings): ToolResult {
    const build = buildOf(s);
    const inTourney = tourney ? tournamentSetup(s, tourney) : null;
    const { base, models, report } = inTourney ?? campaignSetup(s);
    const targets = upgradeTargets(base);
    const changes: Change[] = [];
    const notes: string[] = [];
    if (tourney && !inTourney) notes.push('There are no tournament runs saved yet, so this is for campaign runs.');
    for (const ask of asks.slice(0, 4)) {
        const missing = missingUw(s, ask.upgrade);
        if (missing) { notes.push(missing); continue; }
        const found = findTargets(targets, ask.upgrade);
        if (!found.length) { notes.push(`Couldn't find "${ask.upgrade}" on this account.`); continue; }
        for (const t of found) {
            const lv = levelFor(t, ask.level);
            if (lv === null) { notes.push(`Didn't understand level "${ask.level}" for ${t.label}.`); continue; }
            if (lv === t.current) { notes.push(`${t.label} is already level ${t.current}${t.current === t.max ? ' (max)' : ''}.`); continue; }
            changes.push({ kind: t.kind, key: t.key, level: lv });
            notes.push(`${t.label}: ${t.current} → ${lv} (max ${t.max}), costs ${costsText(changeCost(base, t, lv))}.`);
        }
    }
    // Nothing to try (a UW not owned): that is the answer, so it's the headline.
    if (!changes.length) return { title: 'What If', text: notes.length ? `Headline: ${notes.join('\n')}` : 'No change to try.' };
    const r = whatIf(base, changes, targets, build, report, models);
    const out: string[] = [];
    // One sentence to quote (small models copy numbers best from a sentence).
    const asked = (a: AiChangeAsk) => (/^\+\s*\d+$/.test(a.level.trim()) ? `${a.upgrade} ${a.level.trim()} levels`
        : /\d/.test(a.level) ? `${a.upgrade} to level ${/\d+/.exec(a.level)![0]}` : `maxing ${a.upgrade}`);
    const what = asks.map(asked).join(' and ');
    const cost = costsText(r.costs);
    // Under a tenth of a wave reads "+0.0 waves": lead with what does change.
    const flat = !!r.waves && Math.abs(r.waves.gained) < 0.05;
    if (r.waves && !flat) {
        out.push(`Headline: ${what} gives about ${r.waves.gained >= 0 ? '+' : ''}${r.waves.gained.toFixed(1)} ${inTourney ? 'tournament waves this week' : 'waves'} (runs end around W${r.waves.from.toLocaleString()} now, W${r.waves.to.toLocaleString()} after). It costs ${cost}.`);
    } else if (r.waves) {
        out.push(`Headline: ${what} doesn't change where your runs end (about +0.0 waves; they end around W${r.waves.from.toLocaleString()}): it gives ${pct(r.damagePct)} damage`
            + `${r.survivalPct !== null ? ` and ${pct(r.survivalPct)} survival` : ''}. It costs ${cost}.`);
    } else {
        out.push(`Headline: ${what} gives ${pct(r.survivalPct ?? r.damagePct)} ${r.survivalPct !== null ? 'survival' : 'damage'}. It costs ${cost}.`);
    }
    // eHP runs end when enemies out-damage the tower's health (Run Length on attack).
    if (build === 'eHP' && (!r.waves || flat) && Math.abs(r.damagePct) >= 0.05 && Math.abs(r.survivalPct ?? 0) < 0.05) {
        out.push(`Why: with an eHP build, TowerForge measures how far runs go by survival (they end when enemies out-damage your health), so damage alone doesn't move it (this adds ${pct(r.damagePct)} damage).`);
    }
    out.push(...notes, inTourney
        ? `Details (tournaments: the tournament build set on the Tournament page, this week's battle conditions ticked there; damage measured on your tournament run that ended at W${report?.wave.toLocaleString() ?? '?'}):`
        : `Details (campaign runs; damage measured on your T${report?.tier ?? '?'} run that ended at W${report?.wave.toLocaleString() ?? '?'}):`);
    out.push(`All damage ${pct(r.damagePct)}.`);
    if (build === 'Glass Cannon') out.push(`Push (flat damage + level skip) ${pct(r.pushPct)}.`);
    if (r.spread) out.push(`Run to run: ${r.spread.min.toFixed(1)} to ${r.spread.max.toFixed(1)} waves across the last ${r.spread.runs} runs.`);
    // The change worked out here: small models subtract wrong.
    const change = (c: { from: number; to: number }) => `${num(c.from)} → ${num(c.to)} (${c.to >= c.from ? '+' : '−'}${num(Math.abs(c.to - c.from))})`;
    if (r.coinsRun) out.push(`Coins per run: ${change(r.coinsRun)}.`);
    if (r.coinsHour) out.push(`Coins per hour: ${change(r.coinsHour)}.`);
    if (r.survivalPct !== null) out.push(`Survival (eHP) ${pct(r.survivalPct)}.`);
    const links = r.chain.filter(l => l.waves !== undefined && Math.abs(l.waves) >= 0.05)
        .sort((a, b) => Math.abs(b.waves!) - Math.abs(a.waves!)).slice(0, 4);
    if (links.length) out.push(`Where the waves come from: ${links.map(l => `${l.label} ${l.waves! >= 0 ? '+' : ''}${l.waves!.toFixed(1)}`).join('; ')}.`);
    out.push(`Total cost: ${costsText(r.costs)}.`);
    return { title: inTourney ? 'What If — tournament' : 'What If', text: out.join('\n'), whatIf: { changes, tournament: !!inTourney } };
}

// ── Tournament ────────────────────────────────────────────────
export function tournamentOutlook(s: AiAccount, sim: AiTourneySettings): ToolResult {
    const idx = newestTournament(s);
    if (idx < 0) return { title: 'Tournament', text: 'No tournament runs in the imported battle history yet.' };
    const build = buildOf(s);
    const calib = s.importedBattles[idx];
    const entry = s.tourneyLog?.[runKey(calib)];
    const league = (sim.league || s.profile.currentLeague || s.profile.league || '') as League;
    const last: Ticks = entry ? Object.fromEntries(entry.conditions.map(k => [k, true])) : sim.recent;
    const lastLeague = (entry?.league || league) as League;
    const account: AccountState = { ...s, battleReportText: '', battleReportChoice: idx };
    const model = buildTournamentModel(account, { league, week: sim.week, last, lastLeague, preset: sim.preset, loadout: sim.loadout }, build);
    const names = (t: Ticks) => Object.entries(t).filter(([, on]) => on)
        .map(([k]) => HEAT_CONDITIONS.find(c => c.key === k)?.name ?? k);
    // The order spelled out: small models put Champion above Legend.
    const at = GAME_LEAGUES.indexOf(league as typeof GAME_LEAGUES[number]);
    const up = at >= 0 ? GAME_LEAGUES[at + 1] : undefined;
    const out: string[] = [`League: ${league || 'unknown'}.${at >= 0 ? ` Leagues from lowest to highest: ${GAME_LEAGUES.join(', ')}; ${up ? `the next one up is ${up}, so ${league} isn't the highest` : `${league} is the highest`}.` : ''}`];
    const runs = s.importedBattles.filter(b => b.tournament).sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).slice(0, 5);
    out.push(`Recent tournament runs: ${runs.map(r => {
        const by = killedBy(r);
        const e = s.tourneyLog?.[runKey(r)];
        return `W${r.wave.toLocaleString()}${by ? ` (killed by ${by})` : ''}${e?.conditions.length ? ` with ${names(Object.fromEntries(e.conditions.map(k => [k, true]))).join(', ')}` : ''}`;
    }).join('; ')}.`);
    const week = names(sim.week);
    out.push(week.length
        ? `This week's battle conditions (ticked on the Tournament page): ${week.join(', ')}.`
        : 'This week\'s battle conditions aren\'t known: none are ticked on the Tournament page yet, so the estimate below leaves them out.');
    if (model?.settle && model.run) {
        const zero = model.settle(last, heatOf(lastLeague));
        const shift = model.settle(sim.week) - zero;
        out.push(`Runs usually end around W${model.run.typicalWave.toLocaleString()}; with this week's conditions, around W${Math.round(model.run.typicalWave + shift).toLocaleString()} (${shift >= 0 ? '+' : ''}${shift.toFixed(1)} waves).`);
    } else if (build !== 'Glass Cannon') {
        out.push('Waves for tournaments are only estimated for Glass Cannon builds so far.');
    }
    // Every tournament played (the game's records, 29.1.3+).
    const recs = s.tourneyRecords ?? [];
    if (recs.length) {
        const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
        out.push(`Tournament history: ${recs.length} tournaments since ${day(recs[0].date)}. Waves only compare within a league. Rank 1 is the top of the bracket.`);
        for (const st of leagueStats(recs).reverse()) {
            out.push(`- ${st.league}: ${st.count} tournaments (${day(st.first)} to ${day(st.last)}), best W${st.bestWave.toLocaleString()}, `
                + `average of the last 10 W${Math.round(st.recentWave ?? 0).toLocaleString()}, best rank ${st.bestRank ?? '—'}, `
                + `average rank of the last 10 ${st.recentRank?.toFixed(1) ?? '—'}.`);
        }
        // The best rank with its tournament (the newest when tied).
        const best = recs.filter(placed).reduce<typeof recs[number] | null>((b, r) => (!b || r.rank <= b.rank ? r : b), null);
        if (best) out.push(`Best rank ever: ${best.rank}, in ${best.league} on ${day(best.date)} (W${best.wave.toLocaleString()}).`);
        const moves = leagueMoves(recs).slice(-3).map(m => `${m.up ? 'up to' : 'down to'} ${m.to} on ${day(m.date)}`);
        if (moves.length) out.push(`Last league moves: ${moves.join('; ')}.`);
        out.push(`Last 8 tournaments: ${recs.slice(-8).map(r => `${day(r.date)} ${r.league} W${r.wave.toLocaleString()} ${placed(r) ? `rank ${r.rank}` : '(not placed yet)'}`).join('; ')}.`);
    }
    // Asked for more keys, the answer says this rather than guess.
    out.push('TowerForge doesn\'t know the rewards for each rank (keys and the rest), so it can\'t say how many a rank gives.');
    return { title: 'Tournament', text: out.join('\n') };
}

// ── Runs ──────────────────────────────────────────────────────
// Damage by source as shares of the run's damage (under 1% left out).
export function damageShares(r: BattleReport): [string, number][] {
    const d = r.damage;
    if (!d || d.total <= 0) return [];
    const x = extraDamage(r);
    const parts: [string, number][] = [
        ['Chain Lightning', d.chainLightning], ['Orbs', d.orbs], ['Death Ray', x.deathRay], ['Black Hole', d.blackHole],
        ['Tower shots', d.projectiles], ['Smart Missiles', d.smartMissiles], ['Death Wave', d.deathWave],
        ['Inner Land Mines', d.innerLandMines], ['Poison Swamp', d.poisonSwamp], ['Spotlight', x.spotlight],
        ['Flame Bot', x.flameBot], ['Guardian', x.guardian], ['Electrons', x.electrons],
        ['Thorns', d.thorns], ['Land Mines', d.landMines], ['Rend Armor', d.rendArmor],
    ];
    return parts.map(([n, v]) => [n, v / d.total] as [string, number])
        .filter(([, share]) => share >= 0.01).sort((a, b) => b[1] - a[1]);
}

const sharesText = (shares: [string, number][]) =>
    shares.map(([n, v]) => `${n} ${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`).join(', ');

// The average share of each source over several runs.
function averageShares(runs: BattleReport[]): [string, number][] {
    const withDamage = runs.filter(r => r.damage && r.damage.total > 0);
    if (!withDamage.length) return [];
    const sum = new Map<string, number>();
    for (const r of withDamage) for (const [n, v] of damageShares(r)) sum.set(n, (sum.get(n) ?? 0) + v / withDamage.length);
    return [...sum.entries()].filter(([, v]) => v >= 0.01).sort((a, b) => b[1] - a[1]);
}

export type AiRunKind = 'any' | 'campaign' | 'tournament';

// What the runs show differs between campaign and tournament runs — the
// only reasons the answer may give for a share that changes (a small
// model otherwise invents some: "tournament enemies are more resilient").
// Measured, not a full why: what Chain Lightning reached, shots per enemy,
// what ended the runs, and the battle conditions ticked for the tournament
// runs with how TowerForge counts each.
function tourneyDifferences(s: AiAccount, camp: BattleReport[], tour: BattleReport[]): string[] {
    const avg = (rs: BattleReport[], f: (r: BattleReport) => number | null) => {
        const v = rs.map(f).filter((x): x is number => x !== null && Number.isFinite(x));
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const share = (v: number | null) => (v === null ? 'not recorded' : `${Math.round(v * 100)}%`);
    const per = (v: number | null) => (v === null ? 'not recorded' : v.toFixed(1));
    const reach = (r: BattleReport) => (r.totalEnemies > 0 && (r.clHits ?? 0) > 0 ? Math.min(1, r.clHits! / r.totalEnemies) : null);
    const shots = (r: BattleReport) => (r.totalEnemies > 0 && (r.projectileCount ?? 0) > 0 ? r.projectileCount! / r.totalEnemies : null);
    const killers = (rs: BattleReport[]) => {
        const n = new Map<string, number>();
        for (const r of rs) { const k = killedBy(r); if (k) n.set(k, (n.get(k) ?? 0) + 1); }
        const total = [...n.values()].reduce((a, b) => a + b, 0);
        return total ? [...n].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${Math.round(c / total * 100)}%`).join(', ') : 'not recorded';
    };
    const out = ['What TowerForge can see that differs between your campaign and tournament runs (measured; the runs don\'t record more of the why):'];
    out.push(`- Enemies Chain Lightning reached: ${share(avg(camp, reach))} campaign, ${share(avg(tour, reach))} tournaments.`);
    out.push(`- Tower shots per enemy: ${per(avg(camp, shots))} campaign, ${per(avg(tour, shots))} tournaments.`);
    out.push(`- What ended the runs: campaign ${killers(camp)}; tournaments ${killers(tour)}.`);
    const ticked = [...new Set(tour.flatMap(r => s.tourneyLog?.[runKey(r)]?.conditions ?? []))];
    const conds = ticked.flatMap(k => HEAT_CONDITIONS.filter(c => c.key === k));
    out.push(conds.length
        ? `- Battle conditions ticked for your tournament runs: ${conds.map(c => `${c.name} (${c.how ?? c.text})`).join('; ')}`
        : '- Battle conditions: none ticked for your tournament runs on the Tournament page, so TowerForge doesn\'t know which they had.');
    return out;
}

// UWs with no damage of their own (docs/ultimate-weapons.md).
const NO_DAMAGE: Partial<Record<string, string>> = {
    GT: 'it multiplies the coins from kills while it\'s active',
    CF: 'it slows enemies',
};

export function runsReport(s: AiAccount, kind: AiRunKind = 'any'): ToolResult {
    const all = [...s.importedBattles].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
    if (!all.length) return { title: 'Your runs', text: 'No runs saved yet: import your game data to add your battle history.' };
    const tourney = all.filter(r => r.tournament);
    const campaign = all.filter(r => !r.tournament);
    const out: string[] = [`Saved runs: ${all.length} (${campaign.length} campaign, ${tourney.length} tournament). Each import adds the game's latest runs.`];
    // Where the damage comes from, campaign against tournaments.
    const farmTier = campaign.length ? [...campaign.reduce((m, r) => m.set(r.tier, (m.get(r.tier) ?? 0) + 1), new Map<number, number>())]
        .sort((a, b) => b[1] - a[1])[0][0] : null;
    const cSh = farmTier !== null ? averageShares(campaign.filter(r => r.tier === farmTier && r.wave > 100).slice(0, 5)) : [];
    const tSh = averageShares(tourney.filter(r => r.wave > 10).slice(0, 5));
    if (cSh.length && tSh.length) {
        // Side by side, so "weaker in tournaments" is read off, not guessed.
        const share = (sh: [string, number][], n: string) => {
            const v = sh.find(([x]) => x === n)?.[1];
            return v === undefined ? 'under 1%' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
        };
        const names = [...new Set([...cSh, ...tSh].map(([n]) => n))];
        out.push(`Damage by source, last campaign runs on T${farmTier} against last tournament runs: ${names.map(n => `${n} ${share(cSh, n)} campaign, ${share(tSh, n)} tournaments`).join('; ')}.`);
        out.push(...tourneyDifferences(s, campaign.filter(r => r.tier === farmTier && r.wave > 100).slice(0, 5), tourney.filter(r => r.wave > 10).slice(0, 5)));
    } else if (cSh.length) {
        out.push(`Damage by source, last campaign runs on T${farmTier}: ${sharesText(cSh)}.`);
    } else if (tSh.length) {
        out.push(`Damage by source, last tournament runs: ${sharesText(tSh)}.`);
    }
    // UWs the player owns that aren't in the damage: say why, so "which UW
    // does the most damage" isn't answered with one that does none.
    const sources = new Set([...cSh, ...tSh].map(([n]) => n));
    const owned = UWS.filter(u => s.uwData.data[u.a]?.own);
    const noDamage = owned.filter(u => NO_DAMAGE[u.a]).map(u => `${u.n} (${NO_DAMAGE[u.a]})`);
    const small = owned.filter(u => !NO_DAMAGE[u.a] && !sources.has(u.n)).map(u => u.n);
    if (noDamage.length) out.push(`Ultimate Weapons you own that deal no damage of their own: ${noDamage.join(', ')}.`);
    if (small.length && (cSh.length || tSh.length)) out.push(`Ultimate Weapons you own under 1% of the damage in these runs: ${small.join(', ')}.`);
    const list = (kind === 'tournament' ? tourney : kind === 'campaign' ? campaign : all).slice(0, 12);
    out.push(`${kind === 'any' ? 'Newest runs' : `Newest ${kind} runs`}:`);
    for (const r of list) {
        const by = killedBy(r);
        const sh = damageShares(r).slice(0, 4);
        out.push(`- ${r.date}: ${r.tournament ? 'tournament' : `T${r.tier}`} W${r.wave.toLocaleString()}`
            + `${by ? `, killed by ${by}` : by === null ? ', ended by the player' : ''}`
            + `${r.realTimeSec ? `, ${formatLabTime(r.realTimeSec / 3600)}` : ''}`
            + `${!r.tournament && r.coinsPerHour ? `, ${num(r.coinsPerHour)} coins/h` : ''}`
            + `${sh.length ? `; damage: ${sharesText(sh)}` : ''}`);
    }
    return { title: `Your runs${kind === 'any' ? '' : ` — ${kind}`}`, text: out.join('\n') };
}

// ── Another tier ──────────────────────────────────────────────
// Each tier has its own Dissonant Boosts: what another tier's do to damage and
// coins against the tier the runs were on. 1s without Dissonance data.
function tierBoosts(s: AiAccount, from: number, run: BattleReport | undefined) {
    const waves = s.dissonanceWaves;
    if (!hasDissonance(waves)) return { damage: () => 1, coins: () => 1, note: '' };
    const snap = snapshotFromState(s);
    const at = (tier: number) => ({ ...snap, dissonance: { waves, tier } });
    const calib = run ? buildEdpsCalibration(at(from), run) : null;
    return {
        damage: (tier: number) => (calib ? edpsScore(at(tier), calib) / edpsScore(at(from), calib) : dissonanceFactor(at(tier), 'attack') / dissonanceFactor(at(from), 'attack')),
        coins: (tier: number) => dissonanceFactor(at(tier), 'utility') / dissonanceFactor(at(from), 'utility'),
        note: " Each tier's own Dissonant Boosts are counted, on damage and on coins.",
    };
}

// Your last campaign deaths: the basic enemy's health where each run ended
// (Run Length), and the wave a run on another tier reaches that health with
// the same damage and the same level skip. Health only — enemies on a higher
// tier also hit harder, so it's where the damage runs out, not a promise.
export function tierOutlook(s: AiAccount, target: number): ToolResult {
    const model = buildRunLengthModel(s.importedBattles);
    if (!model) return { title: 'Another tier', text: 'No campaign deaths with level skips saved yet, so there is nothing to measure from.' };
    const to = Math.max(1, Math.min(24, Math.round(target || model.tier + 1)));
    const boosts = tierBoosts(s, model.tier, model.used[0].run);
    const waves = model.used.map(d => deathWave(d.enemyHealth! * boosts.damage(to), to, Math.max(0, 1 - d.healthLevel! / d.run.wave)));
    const avg = Math.round(waves.reduce((a, w) => a + w, 0) / waves.length);
    const from = model.used.map(d => d.run.wave);
    const out = [
        // The estimate alone in the headline: given a range, the model quotes an end of it.
        `Headline: runs on T${to} would end around W${avg.toLocaleString()}.`,
        `From the damage and level skip of your last ${from.length} deaths on T${model.tier} (W${Math.min(...from).toLocaleString()}–W${Math.max(...from).toLocaleString()}); each death alone gives W${Math.min(...waves).toLocaleString()} to W${Math.max(...waves).toLocaleString()}.`,
        `How: each death's basic enemy health on T${model.tier}, and the wave where T${to} enemies reach the same health. Only health is compared: enemies on higher tiers also hit harder, and coins per wave are higher.`,
        ...model.used.map((d, i) => `- T${model.tier} W${d.run.wave.toLocaleString()} → T${to} W${waves[i].toLocaleString()}`),
    ];
    return { title: `T${model.tier} → T${to}`, text: out.join('\n') };
}

// ── Lab boosts ────────────────────────────────────────────────
// The Labs page's Lab boosts (engine/labBoosts.ts): cells an hour from the
// runs, the fastest even boosts they keep up on every lab slot, what the
// cells held keep going above that, each lab being researched at its
// boost, and how long a lab named in the question takes at each speed.
const speedsText = (speeds: number[]) => speeds.map(v => (v > 1 ? `×${v}` : 'no boost')).join(', ');
const cellsText = (v: number) => (v < 1e6 ? Math.round(v).toLocaleString() : num(v));
const hoursText = (h: number) => (h === Infinity ? 'for good' : h >= 48 ? `${Math.floor(h / 24).toLocaleString()} days` : `${Math.floor(h)} hours`);

export function labBoostsReport(s: AiAccount, query = '', now = Date.now()): ToolResult {
    const running = (s.labsRunning ?? []).filter(l => l.lab);
    const income = cellIncome(s.importedBattles);
    const set = boostSettings(s.profile, income, running.length);
    const out: string[] = [];
    if (set.budget <= 0) {
        out.push('Headline: TowerForge doesn\'t know how many cells you make yet: import game data with runs that record cells (or type cells an hour on the Labs page), and it works out the boosts they keep up.');
    } else {
        const plan = planLabBoosts(set.budget, set.slots);
        const held = s.currencies?.cells ?? 0;
        out.push(`Headline: with about ${cellsText(set.budget)} cells an hour, your ${set.slots} lab${set.slots > 1 ? 's' : ''} can all run at ${speedsText(plan.best.speeds)} — the fastest even boosts those cells keep up, ${cellsText(plan.best.cellsPerHour)} cells an hour.`);
        out.push(`Cells an hour: ${cellsText(set.perRunHour)} while in a run × ${set.hoursPerDay.toFixed(1)} hours a day in runs${income ? ` (from your last ${income.runs} runs)` : ''}.`);
        if (plan.part) out.push(`Spare: ${cellsText(plan.spare)} cells an hour, enough for one lab at ×${plan.part.speed} for ${plan.part.hoursPerDay.toFixed(1)} hours a day.`);
        if (plan.higher.length) {
            out.push(`Faster than that costs more than you make; the ${cellsText(held)} cells you hold keep each going for a while: ${plan.higher.map(h =>
                `${speedsText(h.speeds)} for ${cellsText(h.cellsPerHour)} cells an hour, kept going ${hoursText(hoursOnHand(h.cellsPerHour, set.budget, held))}`).join('; ')}.`);
        }
        if (running.length) {
            const left = running.map(l => labTimerLeft(l, now) ?? 0);
            const boosts = boostsForLabs(left, plan.best.speeds);
            out.push(`Labs researching (the fastest boost on the one with the most time left): ${running.map((l, i) => {
                const lv = l.toLevel ?? (s.labData[l.lab!] ?? 0) + 1;
                if (left[i] <= 0) return `${l.lab} Lv ${lv} is done`;
                return `${l.lab} Lv ${lv}: ${formatLabTime(left[i] / 3600)} left${boosts[i] > 1 ? `, ${formatLabTime(left[i] / 3600 / boosts[i])} at ×${boosts[i]}` : ''}`;
            }).join('; ')}.`);
        }
    }
    // A lab named in the question: its next level and the rest, at each speed.
    const lab = query ? findTargets(upgradeTargets(snapshotFromState(s)).filter(t => t.kind === 'lab'), query)[0] : undefined;
    if (lab) {
        const hours = labHours(lab.key, s.labData, s.relicData, s.labProgress);
        if (!hours) out.push(`${lab.label} is maxed (level ${lab.current}).`);
        else {
            const at = (h: number | null) => (h === null ? 'unknown' : [1, 2, 4, 6, 8]
                .map(v => `${formatLabTime(h / v)} ${v > 1 ? `at ×${v}` : 'unboosted'}`).join(', '));
            const next = hours.done > 0 ? `the next level is ${Math.floor(hours.done * 100)}% done and takes ${at(hours.next)} more` : `the next level takes ${at(hours.next)}`;
            out.push(`${lab.label} (level ${hours.cur} of ${hours.max}): ${next}; all ${hours.max - hours.cur} levels left take ${at(hours.toMax)}.`);
        }
    }
    return { title: 'Lab boosts', text: out.join('\n') };
}

// ── Module shard plan ─────────────────────────────────────────
// Modules → Shard plan (engine/shardPlan.ts): each type's saved shards on
// its own main and assist slot, in order of gain per shard, and the best
// levels for every shard of the type (Restore moves them).
const SHARD_TYPE_NAMES = ['cannon', 'armor', 'generator', 'core'] as const;
const capital = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function shardPlanReport(s: AiAccount, query = ''): ToolResult {
    const l = query.toLowerCase();
    const asked = SHARD_TYPE_NAMES.filter(t => l.includes(t));
    const types = asked.length ? asked : SHARD_TYPE_NAMES;
    const plans = types.map(t => planTypeShards(s.moduleState, s.labData, t, s.currencies?.[`${t}Shards`] ?? 0)).filter(p => p.main.module);
    if (!plans.length) return { title: 'Shard plan', text: 'Headline: no module is equipped in these slots, so there\'s nothing for the shards to level.' };
    const slot = (name: string, p: { module: { name: string } | null; from: number; to: number }) =>
        `${name} slot (${p.module?.name ?? 'empty'}) Lv ${p.from}${p.to !== p.from ? ` → ${p.to}` : ' (no change)'}`;
    const out: string[] = [];
    const top = [...plans].sort((a, b) => b.gainPct - a.gainPct)[0];
    out.push(`Headline: ${asked.length === 1 ? `your ${top.type} shards` : `of your shards, ${top.type} gain the most`}: ${slot('main', top.main)}${top.assist ? `, ${slot('assist', top.assist)}` : ''}`
        + ` — ${top.shards.toLocaleString()} shards and ${num(top.coins)} coins for +${top.gainPct.toFixed(2)}% on the ${top.type} main effect.`);
    for (const p of plans) {
        out.push(`${capital(p.type)}: ${p.saved.toLocaleString()} shards saved. Plan: ${slot('main', p.main)}${p.assist ? `; ${slot('assist', p.assist)}` : '; assist slot locked'}`
            + ` — costs ${p.shards.toLocaleString()} shards and ${num(p.coins)} coins, +${p.gainPct.toFixed(2)}% on the main effect, ${p.left.toLocaleString()} shards left.`);
        if (p.next) out.push(`  Save next for: ${p.next.pos} slot Lv ${p.next.from} → ${p.next.to}, ${p.next.shards.toLocaleString()} shards for +${p.next.gainPct.toFixed(2)}%.`);
        for (const c of p.pastCap) {
            out.push(`  The ${c.pos} slot is ${c.levels} levels past its module's rarity cap: those levels add nothing (Restore gives back ${c.shards.toLocaleString()} shards and ${num(c.coins)} coins).`);
        }
        if (p.best && p.best.vsPlanPct > 0.005) {
            out.push(`  Best levels for all ${Math.round(p.best.total).toLocaleString()} ${p.type} shards (in both slots' levels and saved): main Lv ${p.best.main}, assist Lv ${p.best.assist}, +${p.best.vsPlanPct.toFixed(2)}% over the plan`
                + `${p.best.restore.length ? ` — Restore the ${p.best.restore.join(' and ')} slot in the game first (it gives every shard and coin back), then level back up` : ''}`
                + `${p.best.coins > 0 ? `; ${num(p.best.coins)} coins more` : ''}.`);
        }
    }
    out.push('Each type\'s shards only level its own slots; levels past a module\'s rarity cap add nothing.');
    return { title: `Shard plan${asked.length === 1 ? ` — ${asked[0]}` : ''}`, text: out.join('\n') };
}

// ── Which tier to farm ────────────────────────────────────────
// Coins an hour on the tier farmed now and the ones around it (up to the
// highest unlocked): where runs would end on each (Run Length: the enemy
// health of the last deaths, as for another tier), and coins a run, run
// time and coins an hour at that wave (Coins per Run's model of the runs,
// engine/runCoins.ts). Health only, as for another tier.
export function farmTiersReport(s: AiAccount): ToolResult {
    const runLength = buildRunLengthModel(s.importedBattles);
    const tuning = defaultBattleIndex(s.importedBattles);
    const settings = runSettingsFromCards(s.cardData, s.activePreset);
    const coins = tuning >= 0 ? buildRunModel(s.importedBattles, tuning, settings) : null;
    if (!runLength || !coins) {
        return { title: 'Which tier to farm', text: 'Headline: TowerForge needs campaign runs with level skips and coins in your battle history to compare tiers: import your game data after a few runs.' };
    }
    const unlocked = Math.max(runLength.tier, s.profile.highestTier ?? runLength.tier);
    const tiers = [runLength.tier - 1, runLength.tier, runLength.tier + 1, runLength.tier + 2]
        .filter(t => t >= 1 && t <= Math.min(MAX_TIER, unlocked));
    const boosts = tierBoosts(s, runLength.tier, runLength.used[0].run);
    const rows = tiers.map(tier => {
        const waves = runLength.used.map(d => (tier === runLength.tier ? d.run.wave
            : deathWave(d.enemyHealth! * boosts.damage(tier), tier, Math.max(0, 1 - d.healthLevel! / d.run.wave))));
        const wave = Math.round(waves.reduce((a, w) => a + w, 0) / waves.length);
        return projectRun(coins.calibration, settings, wave, tier, boosts.coins(tier));
    });
    const best = rows.reduce((a, r) => (r.coinsPerHour > a.coinsPerHour ? r : a));
    const now = rows.find(r => r.tier === runLength.tier)!;
    const row = (r: typeof rows[number]) => `T${r.tier}: runs end around W${r.wave.toLocaleString()}, ${num(r.coins)} coins a run in ${formatLabTime(r.hours)}, ${num(r.coinsPerHour)} coins an hour`;
    const vs = best.tier === now.tier ? 'the tier you farm now' : `${((best.coinsPerHour / now.coinsPerHour - 1) * 100).toFixed(0)}% more an hour than T${now.tier}, where you farm now`;
    return {
        title: `Which tier to farm (T${tiers[0]}–T${tiers[tiers.length - 1]})`,
        text: [
            `Headline: for coins an hour, T${best.tier} is your best tier to farm — about ${num(best.coinsPerHour)} coins an hour, ${vs}.`,
            ...rows.map(row),
            `How: each tier's waves from the enemy health where your last ${runLength.used.length} runs on T${runLength.tier} ended, and coins from Coins per Run's model of your runs at that wave and tier.`
                + ' Only enemy health is compared: enemies on higher tiers also hit harder, so runs there may end sooner.'
                + boosts.note
                + (unlocked < runLength.tier + 2 ? ` Tiers past T${unlocked} aren't unlocked yet.` : ''),
        ].join('\n'),
    };
}

// ── Guardian chips ────────────────────────────────────────────
// The Optimizer's chip picker (optimizer.bestGuardianChips): every set of
// owned chips that fits the preset's slots, scored for a goal at the chips'
// levels now, against the set equipped. Swapping chips is free in game.
export function guardianReport(s: AiAccount, goalWanted?: string): ToolResult {
    const equipped = activeChips(s.guardianData, s.activePreset);
    if (!s.guardianData?.unlocked) {
        return { title: 'Guardian chips', text: 'Headline: the Guardian isn\'t unlocked on this account yet (the game\'s Guild → Guardian).' };
    }
    const build = buildOf(s);
    const goal = goalFor(build, goalWanted);
    const goals = [...new Set<OptGoal>([goal, ...(BUILD_GOALS[build] ?? []).filter(g => g === 'coins')])];
    const name = (id: string) => CHIPS.find(c => c.id === id)?.name ?? id;
    const setText = (ids: string[]) => ids.map(name).join(', ');
    const out: string[] = [];
    goals.forEach((g, i) => {
        const snap = snapshotFromState(s);
        applyGoal(snap, g, build, chosenReport(s), runModels(s));
        const sets = bestGuardianChips(snap);
        if (!sets.length) return;
        const best = sets[0];
        const label = GOAL_LABELS[g].toLowerCase();
        // The change itself ("swap Fetch for Scout"): sets that tie list the
        // fewest swaps first, and a list of whole sets was read wrong by the
        // 4B ("keep your current setup").
        const now = equipped.map(a => a.chip.id);
        const take = best.chips.filter(id => !now.includes(id));
        const drop = now.filter(id => !best.chips.includes(id));
        const change = !take.length ? '' : drop.length ? `swap ${setText(drop)} for ${setText(take)}` : `add ${setText(take)}`;
        const verdict = best.current || best.scorePct <= 0.005 || !change
            ? `keep the chips you have on (${setText(now)}): they're already the best for ${label}`
            : `for ${label}, ${change} (${pct(best.scorePct)}), so you run ${setText(best.chips)}`;
        out.push(i === 0 ? `Headline: ${verdict}.` : `${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}.`);
        const tied = sets.slice(1).filter(x => Math.abs(x.scorePct - best.scorePct) < 0.005);
        const after = sets.slice(1 + tied.length, 4 + tied.length).slice(0, 3);
        if (after.length) out.push(`  Next best for ${label}: ${after.map(x => `${setText(x.chips)} ${pct(x.scorePct)}`).join('; ')}.`);
    });
    if (!out.length) return { title: 'Guardian chips', text: 'Headline: no chips owned that fit the Guardian\'s slots yet.' };
    out.push('Swapping chips is free in the game. Scored at the chips\' levels now: Attack and Scout count for damage and waves, Bounty, Summon and Fetch for coins; Ally isn\'t counted yet.');
    return { title: 'Guardian chips', text: out.join('\n') };
}
