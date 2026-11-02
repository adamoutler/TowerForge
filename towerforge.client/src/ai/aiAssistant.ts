// ============================================================
//  TowerForge Companion — Ask AI: the assistant
//  A small open model (aiModels.ts) running in the player's own browser
//  with WebLLM on the graphics card (WebGPU): nothing is sent anywhere,
//  and it costs the site nothing. Downloaded once into the browser's
//  storage, loaded onto the graphics card when the page starts it.
//
//  Small models can't do the game's math and don't know the game well,
//  so each question takes two steps:
//   1. Route — the model picks which data answers it (JSON, held to a
//      schema): the Optimizer's next picks, What If for named upgrades
//      (campaign or tournament), current levels, the saved runs, another
//      tier, the tournament estimate, lab boosts, the shard plan, or the
//      game notes. What the question itself settles is checked in code.
//   2. Answer — the site works that data out (aiTools.ts, the same
//      engine the pages use) and the model answers from it and the
//      account summary, written out as it goes.
//  Kept outside the page, so the model and the chat survive switching tabs.
// ============================================================

import { create } from 'zustand';
import type { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { AI_MODELS, CONTEXT_TOKENS, modelByKey } from './aiModels';
import type { AiModel } from './aiModels';
import {
    accountSummary, bestUpgrades, farmTiersReport, guardianReport, labBoostsReport, levelsOf, runsReport, shardPlanReport, tierOutlook,
    tournamentOutlook, whatIfChanges,
} from './aiTools';
import type { AiAccount, AiChangeAsk, AiCurrency, AiRunKind, AiTourneySettings, ToolResult } from './aiTools';
import { budgetIn, wordsOf } from './aiTools';
import { TAB_PATHS } from '../routes';
import { UWS } from '../constants/gameData';
import { notesText, searchNotes } from './aiKnowledge';
import { unverifiedNumbers } from './aiCheck';
import { addToLog } from './aiLog';
import { trackEvent } from '../analytics';

export interface AiMessage {
    role: 'user' | 'assistant';
    text: string;
    looked?: ToolResult[];     // the data the answer was written from
    route?: string;            // what step 1 asked for (shown with the data)
    routed?: RouteChoice;      // the same, as read (the test bench checks it)
    status?: string;           // while it works ("Reading your account…")
    unchecked?: string[];      // numbers in the answer that aren't TowerForge's (aiCheck)
    id?: string;               // the answer's debug log entry (aiLog)
    done?: boolean;
}

// What a question is asked with (read fresh from the stores each time).
export interface AiContext {
    account: AiAccount;
    tourney: AiTourneySettings;
    goal?: string;             // the Optimizer page's goal
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface AiStore {
    modelKey: string;
    status: Status;
    progress: { pct: number; text: string } | null;
    error: string | null;
    loadedId: string | null;   // the WebLLM model id on the graphics card
    cached: Record<string, boolean>;
    messages: AiMessage[];
    busy: boolean;
    think: boolean;            // let Qwen3 think before answering (slower, often better)

    chooseModel: (key: string) => void;
    setThink: (on: boolean) => void;
    checkCache: () => Promise<void>;
    start: () => Promise<void>;
    stopModel: () => Promise<void>;
    removeModel: (key: string) => Promise<void>;
    ask: (question: string, ctx: AiContext) => Promise<void>;
    interrupt: () => void;
    clearChat: () => void;
}

const MODEL_KEY = 'tc_ai_model';
const readModel = () => { try { return localStorage.getItem(MODEL_KEY); } catch { return null; } };

let engine: WebWorkerMLCEngine | null = null;
let worker: Worker | null = null;

// ── Graphics card ─────────────────────────────────────────────
interface GpuAdapter { features: { has(f: string): boolean } }
interface Gpu { requestAdapter(o?: { powerPreference?: string }): Promise<GpuAdapter | null> }
const gpuOf = () => (navigator as Navigator & { gpu?: Gpu }).gpu;

export const hasWebGpu = () => !!gpuOf();

// ── The download ──────────────────────────────────────────────
// WebLLM keeps the weights in Cache Storage under their Hugging Face
// addresses (…/mlc-ai/<model id>/resolve/main/params_shard_N.bin). Looked
// up here directly: WebLLM's own check fetches each model's file list.
const MODEL_CACHE = 'webllm/model';
const isOf = (url: string, id: string) => url.includes(`/mlc-ai/${id}/`);

async function cachedUrls(): Promise<string[]> {
    try { return (await (await caches.open(MODEL_CACHE)).keys()).map(r => r.url); } catch { return []; }
}

// The model build this graphics card can run (16-bit floats or not).
async function modelIdFor(m: AiModel): Promise<string> {
    const adapter = await gpuOf()?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No graphics card answered (WebGPU found no adapter).');
    return adapter.features.has('shader-f16') ? m.f16 : m.f32;
}

// ── Step 1: route ─────────────────────────────────────────────
export interface Route {
    tool: 'upgrades' | 'what_if' | 'levels' | 'runs' | 'tier' | 'farm_tier' | 'tournament' | 'lab_boosts' | 'shard_plan' | 'guardian' | 'guide' | 'none';
    currency: AiCurrency;
    goal: 'default' | 'waves' | 'damage' | 'coins' | 'survival' | 'cells';
    changes: AiChangeAsk[];
    search: string;
    runs: AiRunKind;
    tier: number;
    budget: number;
}

// The UWs' short names and UW+ names, for both steps ("SM" for Smite and
// "Power Scaling" for PS were read without them).
const UW_NAMES = `UW short names: ${UWS.map(u => `${u.a} ${u.n}`).join(', ')}. UW+ names: ${UWS.map(u => `${u.up} (${u.a}+)`).join(', ')}.`;

const ROUTE_SCHEMA = JSON.stringify({
    type: 'object',
    properties: {
        tool: { type: 'string', enum: ['upgrades', 'what_if', 'levels', 'runs', 'tier', 'farm_tier', 'tournament', 'lab_boosts', 'shard_plan', 'guardian', 'guide', 'none'] },
        currency: { type: 'string', enum: ['any', 'stones', 'coins', 'research', 'shards', 'medals', 'gems', 'bits'] },
        goal: { type: 'string', enum: ['default', 'waves', 'damage', 'coins', 'survival', 'cells'] },
        changes: {
            type: 'array', maxItems: 4,
            items: {
                type: 'object',
                properties: { upgrade: { type: 'string' }, level: { type: 'string' } },
                required: ['upgrade', 'level'],
            },
        },
        search: { type: 'string' },
        runs: { type: 'string', enum: ['any', 'campaign', 'tournament'] },
        tier: { type: 'integer' },
        budget: { type: 'number' },
    },
    required: ['tool', 'currency', 'goal', 'changes', 'search', 'runs', 'tier', 'budget'],
});

const ROUTE_PROMPT = `You pick the data that answers a player's question about their account in the mobile game The Tower (idle tower defense). Reply with JSON only.
tool:
- "upgrades": what to upgrade or spend on next, and how to get more coins, push further or survive longer. currency: stones (UWs, UW+, card mastery, assist modules), coins (workshop, enhancements), research (labs), shards (module slots; questions only about shards go to shard_plan), medals (bots), gems (card slots), bits (Guardian chips), or any. goal: waves, damage, coins, survival, or default. runs: tournament when they ask about tournaments, campaign for farming or tiers, else any. budget: how much of that currency they say they have or are about to get (1500 for "I'm about to get 1500 stones"), else 0.
- "what_if": what specific upgrades would do (waves, damage, coins, cost), or whether one is worth it. changes: each upgrade in the player's words and the level: "max", "+N" (N more levels) or a level number. runs: tournament when they ask about tournament waves, else any.
- "levels": the player's current level of specific upgrades. search: the upgrade names.
- "runs": the player's past runs: waves, what killed them, coins, damage by source (which UW or weapon did the damage), campaign against tournaments. runs: tournament only when the question says tournaments, else any.
- "tier": how far the player would get on another tier (farming or pushing a higher tier). tier: that tier's number, 0 for "the next tier".
- "tournament": tournaments: this week's battle conditions, how far tournament runs should get, past tournaments' waves and ranks, leagues.
- "lab_boosts": speeding labs up with cells: which boost (×1.5 to ×8) their labs can keep, what boosts cost in cells, how long the labs being researched or a named lab take. search: the lab named, else "".
- "shard_plan": spending Module Shards on module slot levels (main and assist slots): what to level, the best levels for all their shards, Restore. search: the type (cannon, armor, generator or core), else "".
- "farm_tier": which tier to farm for the most coins an hour (comparing tiers).
- "guardian": which Guardian chips to equip.
- "guide": how a game mechanic works or how TowerForge calculates something. search: a few keywords.
- "none": greetings, questions the account overview answers (their tier, best waves, what they own), and requests that have nothing to do with The Tower (a poem, a joke).
currency is what they want to spend; "any" when they name more than one (coins and stones) or none.
goal is "coins" when they want to earn more coins (not when they only say how many coins they have to spend), "waves" to push further, "survival" to survive longer.
${UW_NAMES}
Write each upgrade in the player's own words: never shorten a name yourself.
After an earlier question, changes hold only what the new question asks about ("… instead?" drops the earlier upgrade).
Unused fields: currency "any", goal "default", changes [], search "", runs "any", tier 0, budget 0.
Examples:
"what should I spend my stones on" → {"tool":"upgrades","currency":"stones","goal":"default","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"I'm about to get 1500 stones, how do I do better in tournaments" → {"tool":"upgrades","currency":"stones","goal":"waves","changes":[],"search":"","runs":"tournament","tier":0,"budget":1500}
"how do I place higher in my Champion bracket" → {"tool":"upgrades","currency":"any","goal":"waves","changes":[],"search":"","runs":"tournament","tier":0,"budget":0}
"I have 2.4B coins, what should I buy in the workshop" → {"tool":"upgrades","currency":"coins","goal":"default","changes":[],"search":"","runs":"any","tier":0,"budget":2400000000}
"how do I get more coins" → {"tool":"upgrades","currency":"any","goal":"coins","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"how do I survive longer" → {"tool":"upgrades","currency":"any","goal":"survival","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"how many waves would maxing CL and CF+ get me" → {"tool":"what_if","currency":"any","goal":"default","changes":[{"upgrade":"CL","level":"max"},{"upgrade":"CF+","level":"max"}],"search":"","runs":"any","tier":0,"budget":0}
"is 10 more levels of the damage lab worth it" → {"tool":"what_if","currency":"any","goal":"default","changes":[{"upgrade":"damage lab","level":"+10"}],"search":"","runs":"any","tier":0,"budget":0}
"is PS worth it" → {"tool":"what_if","currency":"any","goal":"default","changes":[{"upgrade":"PS","level":"max"}],"search":"","runs":"any","tier":0,"budget":0}
"what's my workshop damage level" → {"tool":"levels","currency":"any","goal":"default","changes":[],"search":"workshop damage","runs":"any","tier":0,"budget":0}
"what tier am I on" → {"tool":"none","currency":"any","goal":"default","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"am I going to move up a league" → {"tool":"tournament","currency":"any","goal":"default","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"what is enemy level skip" → {"tool":"guide","currency":"any","goal":"default","changes":[],"search":"enemy level skip","runs":"any","tier":0,"budget":0}
Earlier question "how many waves would maxing DW get me", then "and CF instead?" → {"tool":"what_if","currency":"any","goal":"default","changes":[{"upgrade":"CF","level":"max"}],"search":"","runs":"any","tier":0,"budget":0}
"what speed should I boost my labs to" → {"tool":"lab_boosts","currency":"any","goal":"default","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"how long until my damage lab is maxed" → {"tool":"lab_boosts","currency":"any","goal":"default","changes":[],"search":"damage lab","runs":"any","tier":0,"budget":0}
"which tier should I farm for coins" → {"tool":"farm_tier","currency":"any","goal":"default","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"which guardian chips should I use" → {"tool":"guardian","currency":"any","goal":"default","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"how should I spend my armor shards" → {"tool":"shard_plan","currency":"any","goal":"default","changes":[],"search":"armor","runs":"any","tier":0,"budget":0}
"how many tournament waves would maxing CL get me" → {"tool":"what_if","currency":"any","goal":"default","changes":[{"upgrade":"CL","level":"max"}],"search":"","runs":"tournament","tier":0,"budget":0}
"what keeps killing me" → {"tool":"runs","currency":"any","goal":"default","changes":[],"search":"","runs":"any","tier":0,"budget":0}
"why is my chain lightning weak in tournaments" → {"tool":"runs","currency":"any","goal":"default","changes":[],"search":"","runs":"tournament","tier":0,"budget":0}
"how far would I get farming T19" → {"tool":"tier","currency":"any","goal":"default","changes":[],"search":"","runs":"any","tier":19,"budget":0}
"how does Fast's Ultimate work" → {"tool":"guide","currency":"any","goal":"default","changes":[],"search":"Fast's Ultimate","runs":"any","tier":0,"budget":0}`;


// A tournament question: the word, or a league or bracket ("… in the
// Legend tournament", "my Champion bracket"). Not Gold or Mythic, which
// are also golden things and a rarity.
const TOURNEY_WORDS = /tourn|\bleagues?\b|\bbrackets?\b|\b(copper|silver|platinum|champion|legend)\b/i;

// When the model's JSON can't be read: the same choice from keywords.
function guessRoute(q: string): Route {
    const l = q.toLowerCase();
    const base: Route = { tool: 'none', currency: 'any', goal: 'default', changes: [], search: '', runs: 'any', tier: 0, budget: budgetIn(q) };
    const spend = /upgrade|spend|next|should i|priorit|\bbuy\b|best (way|use|course)/.test(l);
    const tier = /\bt(?:ier)?\s?(\d{1,2})\b/.exec(l);
    if (tier && /farm|get to|make it|how far|move up|push/.test(l)) return { ...base, tool: 'tier', tier: Number(tier[1]) };
    if (/\bruns?\b|history|damage (by|from)|killed/.test(l)) return { ...base, tool: 'runs', runs: /tourn/.test(l) ? 'tournament' : 'any' };
    if (TOURNEY_WORDS.test(l) || /battle condition/.test(l)) {
        if (spend) return { ...base, tool: 'upgrades', currency: currencyIn(l), goal: 'waves', runs: 'tournament' };
        return { ...base, tool: 'tournament' };
    }
    if (/what if|would .*(max|level)|\bmax(ing)?\b/.test(l)) return { ...base, tool: 'what_if', changes: [{ upgrade: q, level: 'max' }] };
    if (/\bboost/.test(l) && /\blabs?\b/.test(l)) return { ...base, tool: 'lab_boosts', search: q };
    if (/\bshards?\b/.test(l) && !/\bstones?\b|\bcoins?\b/.test(l)) return { ...base, tool: 'shard_plan', search: q };
    if (/\b(more|earn|make)\b.*\bcoins?\b|\bincome\b/.test(l)) return { ...base, tool: 'upgrades', goal: 'coins' };
    if (/surviv|stay alive|keep dying/.test(l)) return { ...base, tool: 'upgrades', goal: 'survival' };
    if (/\bmore\b.*\bcells?\b/.test(l)) return { ...base, tool: 'upgrades', goal: 'cells' };
    if (/what level|\blevel (is|of)\b|\bmy .+ level\b/.test(l)) return { ...base, tool: 'levels', search: q };
    if (spend) return { ...base, tool: 'upgrades', currency: currencyIn(l) };
    if (/how (does|do|is)|what (is|does)|why/.test(l)) return { ...base, tool: 'guide', search: q };
    return base;
}

const currencyIn = (l: string): AiCurrency => (['stones', 'coins', 'research', 'shards', 'medals', 'gems', 'bits'] as const)
    .find(c => l.includes(c.replace(/s$/, ''))) ?? 'any';

export type RouteChoice = Route & { guessed?: boolean; quick?: boolean };

// Questions whose wording settles the data, routed without the model (its
// step 1 takes a few seconds before the answer starts). Strict: anything
// that could be a What If ("max", "worth", "would", "if") or names a tier
// number goes to the model; so does everything not matched here.
export function quickRoute(q: string): RouteChoice | null {
    const l = q.toLowerCase().trim();
    if (/\b(if|max|maxing|maxed|worth|would|vs|versus|instead|compare|better)\b|\bt(?:ier)?\s?\d/.test(l)) return null;
    const base: RouteChoice = { tool: 'none', currency: 'any', goal: 'default', changes: [], search: '', runs: TOURNEY_WORDS.test(l) ? 'tournament' : 'any', tier: 0, budget: budgetIn(q), quick: true };
    if (/^(hi|hey|hello|thanks|thank you|ty)\b[\s!.?]*$/.test(l)) return { ...base, runs: 'any' };
    if (/^what tier am i (on|at)\b/.test(l)) return { ...base, runs: 'any' };
    const cur = (['stones', 'medals', 'gems', 'bits'] as const).find(c => new RegExp(`\\b${c.slice(0, -1)}s?\\b`).test(l));
    if (cur && /\b(spend|use|buy|go|upgrade|put)\b/.test(l) && !/\bshards?\b/.test(l)) return { ...base, tool: 'upgrades', currency: cur, goal: base.runs === 'tournament' ? 'waves' : 'default' };
    if (/\b(cannon|armor|generator|core|module) shards?\b/.test(l)) return { ...base, tool: 'shard_plan', search: (/\b(cannon|armor|generator|core)\b/.exec(l) ?? [''])[0], runs: 'any' };
    if (/\bboost/.test(l) && /\blabs?\b/.test(l)) return { ...base, tool: 'lab_boosts', runs: 'any' };
    if (/\b(which|best|what) tier\b.*\bfarm\b/.test(l)) return { ...base, tool: 'farm_tier', runs: 'any' };
    if (/\bguardian\b.*\bchips?\b|\bchips?\b.*\bguardian\b/.test(l) && /\b(should|best|equip|use)\b/.test(l)) return { ...base, tool: 'guardian', runs: 'any' };
    if (/\bwhat keeps killing me\b|\bwhat (killed|kills) me\b|\b(most|more) damage in my runs\b/.test(l)) return { ...base, tool: 'runs' };
    const level = /^what(?:'s| is) (?:the )?level (?:of )?(?:is )?my (.+?)\??$|^what level is my (.+?)\??$|^what(?:'s| is) my (.+?) level\??$/.exec(l);
    if (level) return { ...base, tool: 'levels', search: level[1] ?? level[2] ?? level[3], runs: 'any' };
    if (/^(how (does|do)|what (is|are|does)) /.test(l) && !/\b(i|my|me|am|i'm)\b/.test(l)) return { ...base, tool: 'guide', search: q, runs: 'any' };
    return null;
}

// Qwen3 starts every reply with its (here empty) <think></think>.
export function readRoute(raw: string, q: string): RouteChoice {
    try {
        const body = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
        const r = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) as Partial<Route>;
        if (!r.tool) return { ...guessRoute(q), guessed: true };
        return checked({
            tool: r.tool, currency: r.currency ?? 'any', goal: r.goal ?? 'default',
            changes: Array.isArray(r.changes) ? r.changes.filter(c => c?.upgrade) : [], search: r.search ?? '',
            runs: r.runs ?? 'any', tier: Number(r.tier) || 0,
            // The amount in the question itself wins: small models drop or round it.
            budget: budgetIn(q) || Math.max(0, Number(r.budget) || 0),
        }, q);
    } catch {
        return { ...guessRoute(q), guessed: true };
    }
}

// What the question itself settles, over the model's reading (the test
// bench's misses: "the next tier up" read as tier 1, "… instead?" keeping
// the earlier upgrade, "what is enemy level skip" sent nowhere).
function checked(r: Route, q: string): Route {
    const out = { ...r };
    // A league named is a tournament question ("… in the Legend tournament"),
    // and the Tournament tool is always about tournament runs.
    if (out.tool === 'tournament' || (['upgrades', 'what_if'].includes(out.tool) && TOURNEY_WORDS.test(q))) out.runs = 'tournament';
    // A tier is only the one the question names; none named = the next one.
    if (out.tool === 'tier') out.tier = Number(/\bt(?:ier)?\s?(\d{1,2})\b/i.exec(q)?.[1]) || 0;
    // "… in my runs", "what keeps killing me": the saved runs.
    if (/\bmy (last |recent )?runs?\b|\bkill(s|ed|ing) me\b/i.test(q) && !['upgrades', 'what_if', 'tier'].includes(out.tool)) {
        out.tool = 'runs';
        out.runs = /tourn/i.test(q) ? 'tournament' : 'any';
    }
    // "… instead?": only the upgrades this question names.
    if (/\binstead\b/i.test(q) && out.changes.length > 1) {
        const asked = new Set(wordsOf(q));
        const kept = out.changes.filter(c => wordsOf(c.upgrade).some(w => w !== '+' && asked.has(w)));
        out.changes = kept.length ? kept : out.changes.slice(-1);
    }
    // Which tier to farm, and Guardian chips: their own tools.
    if (/\b(which|best|what) tier\b.*\bfarm|\bfarm\b.*\b(which|best|what) tier\b|\btier\b.*\b(most|more) coins\b/i.test(q) && !/\bt(?:ier)?\s?\d/i.test(q)) {
        out.tool = 'farm_tier';
    }
    // Advice only: "which chips am I using" is the account summary's.
    if (/\bchips?\b/i.test(q) && /\b(equip|use|best|should|recommend)\b/i.test(q) && !['what_if', 'levels'].includes(out.tool)) out.tool = 'guardian';
    // Module shards alone, or boosting labs: their own pages' plans.
    if (out.tool === 'upgrades' && out.currency === 'shards') out.tool = 'shard_plan';
    if (out.tool !== 'lab_boosts' && /\bboost/i.test(q) && /\blabs?\b/i.test(q)) out.tool = 'lab_boosts';
    // …and only those: "what should I research next" is the labs' picks,
    // "card slots with my gems" the gem picks (the bench sent them there).
    if (out.tool === 'lab_boosts' && !/boost|speed|cells?|how long|finish|faster|time|hours?|days?/i.test(q)) {
        out.tool = 'upgrades';
        out.currency = 'research';
    }
    if (out.tool === 'shard_plan' && !/\bshards?\b/i.test(q)) out.tool = 'upgrades';
    // Where a named currency should go ("where should my medals go"): its picks.
    const named = (['stones', 'coins', 'medals', 'gems', 'bits'] as const).find(c => new RegExp(`\\b${c.slice(0, -1)}s?\\b`, 'i').test(q));
    if (named && /\b(spend|go|use|buy|upgrade|should|best|worth)\b/i.test(q) && ['none', 'guide', 'shard_plan', 'lab_boosts', 'upgrades'].includes(out.tool)
        && !/\bshards?\b/i.test(q) && (out.tool !== 'upgrades' || out.currency === 'any' || out.currency === 'shards')) {
        out.tool = 'upgrades';
        out.currency = named;
    }
    // "What should I research next in the labs": lab research (the 8B kept
    // the currency "any").
    if (out.tool === 'upgrades' && out.currency === 'any' && !named && /\bresearch\b|\blabs?\b/i.test(q) && out.goal === 'default') {
        out.currency = 'research';
    }
    // "What is X?" about the game (not their account) goes to the notes.
    if (out.tool === 'none' && /^\s*(what|how|why)\s+(is|are|does|do)\b/i.test(q) && !/\b(i|my|me|am|i'm)\b/i.test(q)) {
        out.tool = 'guide';
        out.search ||= q;
    }
    return out;
}

const routeText = (r: RouteChoice) => [
    r.tool,
    r.tool === 'upgrades' && `${r.currency}${r.goal !== 'default' ? `, goal ${r.goal}` : ''}${r.runs !== 'any' ? `, ${r.runs} runs` : ''}${r.budget ? `, budget ${r.budget.toLocaleString()}` : ''}`,
    r.tool === 'what_if' && r.changes.map(c => `${c.upgrade} → ${c.level}`).join('; '),
    (r.tool === 'levels' || r.tool === 'guide') && r.search && `"${r.search}"`,
    r.tool === 'runs' && r.runs,
    r.tool === 'tier' && `T${r.tier || '?'}`,
    r.tool === 'what_if' && r.runs === 'tournament' && 'tournament',
    (r.tool === 'lab_boosts' || r.tool === 'shard_plan') && r.search && `"${r.search}"`,
    r.guessed && '(from keywords: the model’s choice couldn’t be read)',
    r.quick && '(from the question’s wording)',
].filter(Boolean).join(' · ');

// ── Step 2: the data ──────────────────────────────────────────
// "What should I do to perform better and get more keys in the Legend
// tournament?" (the first player report): the picks scored for tournament
// runs and where the player stands — league, waves and ranks, this week —
// whether the route chose the picks or the Tournament tool.
const ADVICE_WORDS = /\b(what should i|how (do|can|could) i|improve|do better|perform better|upgrade|spend|buy|focus|get more)\b/i;
const tourneyPicks = (route: Route, ctx: AiContext) => bestUpgrades(ctx.account, route.currency,
    route.goal === 'default' ? 'waves' : route.goal, { budget: route.budget, runs: 'tournament', tourney: ctx.tourney, goalAsked: route.goal !== 'default' });

export function lookUp(route: Route, question: string, ctx: AiContext): ToolResult[] {
    const { account } = ctx;
    switch (route.tool) {
        case 'upgrades':
            // A currency or an amount to spend asks for its picks alone.
            if (route.runs === 'tournament' && route.currency === 'any' && !route.budget) return [tourneyPicks(route, ctx), tournamentOutlook(account, ctx.tourney)];
            return [bestUpgrades(account, route.currency, route.goal === 'default' ? ctx.goal : route.goal,
                { budget: route.budget, runs: route.runs, tourney: ctx.tourney, goalAsked: route.goal !== 'default' })];
        case 'what_if': {
            const asks = route.changes.length ? route.changes : [{ upgrade: question, level: 'max' }];
            // Each on its own when there are several (to compare), then together.
            const tourney = route.runs === 'tournament' ? ctx.tourney : undefined;
            const each = asks.length > 1 ? asks.map(a => whatIfChanges(account, [a], tourney)) : [];
            const together = whatIfChanges(account, asks, tourney);
            return asks.length > 1
                ? [...each.map((r, i) => ({ ...r, title: `What If — ${asks[i].upgrade}` })), { ...together, title: 'What If — all together' }]
                : [together];
        }
        case 'levels':
            return [levelsOf(account, route.search || question)];
        case 'runs':
            return [runsReport(account, route.runs)];
        case 'tier':
            return [tierOutlook(account, route.tier)];
        case 'tournament':
            if (ADVICE_WORDS.test(question)) return [tourneyPicks(route, ctx), tournamentOutlook(account, ctx.tourney)];
            return [tournamentOutlook(account, ctx.tourney), runsReport(account, 'tournament')];
        case 'lab_boosts':
            return [labBoostsReport(account, `${route.search} ${question}`)];
        case 'farm_tier':
            return [farmTiersReport(account)];
        case 'guardian':
            return [guardianReport(account, route.goal === 'default' ? ctx.goal : route.goal)];
        case 'shard_plan':
            return [shardPlanReport(account, `${route.search} ${question}`)];
        case 'guide': {
            const found = searchNotes(`${route.search} ${question}`);
            return [{ title: `Game notes — ${found.map(p => p.heading).slice(0, 2).join(', ') || 'nothing found'}`, text: found.length ? notesText(found) : 'No notes matched.' }];
        }
        default:
            return [];
    }
}

// The pages the answer may point to, with their real addresses.
const PAGE_LINKS = ([
    ['Optimizer', 'optimizer'], ['What If', 'whatif'], ['Tournament', 'tournament'], ['Run Length', 'runlength'],
    ['Coins per Run', 'runcoins'], ['Enemy Stats', 'enemies'], ['Labs', 'labs'], ['Workshop', 'workshop'],
] as const).map(([name, tab]) => `${name} https://towerforge.net${TAB_PATHS[tab]}`).join(', ');

const ANSWER_PROMPT = `You are TowerForge's assistant for the mobile idle tower defense game The Tower (by Tech Tree Games). You answer the player's questions about their own account from the data below, which TowerForge worked out from their game data.
Rules:
- Only use numbers that are in the data, copied exactly. When the data has a "Headline:" line, start from it. When it has a "Plan for" list, answer with that plan in its order: those buys fit what the player has to spend, so never suggest a buy outside it as something they can afford. Gains given in waves stay in waves. Never make up levels, costs, waves or percentages. If the data doesn't answer the question, say so and name the TowerForge page that does (Optimizer, What If, Tournament, Run Length, Coins per Run, Enemy Stats).
- Don't add or subtract numbers yourself: use the changes the data gives. A cost is what the player pays, never something they get.
- When the data says what the player can buy with what they hold now, follow it: never tell them to buy more than that.
- When the data says there's nothing worth buying, say so with the reason it gives; don't suggest other buys instead.
- Give only reasons, mechanics and enemy behavior that the data or the game notes state. When they don't say why, say TowerForge can't tell why rather than guessing, and don't add advice the data doesn't give. Asked why something differs between campaign and tournaments, give the measured differences the data lists and nothing else.
- A question about tournaments is about tournament waves and rank: don't call the picks farming or coin advice, and don't tell them to farm.
- Write it in your own words: never name the data's own sections or labels ("Headline", "Plan for", titles in [brackets]) and don't mention "the data".
- Only help with The Tower and TowerForge: for anything else, say in one sentence that you can only help with their Tower account.
- Use the game's own words: stones, Ultimate Weapons (UWs), UW+, labs, workshop, enhancements, cards, modules, bots, Bot+, Guardian, tiers, waves. ${UW_NAMES}
- Be brief and direct: answer first in a sentence or two, then a few short bullet points if they help.
- If the data says an upgrade couldn't be found, or doesn't have the answer, say so plainly and don't guess.
- Game notes are TowerForge's own notes: explain them in plain words and leave out code names and file names.
- In the account, "Damage 13/32" is an upgrade's level (13 of 32), not damage dealt.
- Big numbers use the game's letters, smallest to largest: K (thousand), M (million), B (billion), T (trillion), q (quadrillion), Q (quintillion), s, S, O, N, D, then aa, ab… So 61.00K is far less than 4.67Q, and q is less than Q. When the data lists picks "in order of cost, lowest first", use that to compare costs.
- To point to a page, use these addresses exactly (no others): ${PAGE_LINKS}.`;

// Anonymous counts for the owner's analytics (Umami, towerforge.net only):
// which data an answer used, whether its wording or the model picked it,
// flagged numbers, time and model — never the question, the answer or
// the account. docs/analytics.md.
function countAnswer(route: RouteChoice | null, unchecked: number, ms: number, model: string | null, error: boolean): void {
    const secs = ms / 1000;
    trackEvent('ai-answer', {
        tool: route?.tool ?? 'error',
        picked: route?.quick ? 'wording' : route?.guessed ? 'keywords' : 'model',
        flagged: unchecked > 0 ? 'yes' : 'no',
        time: secs < 10 ? 'under 10 s' : secs < 20 ? '10–20 s' : secs < 40 ? '20–40 s' : 'over 40 s',
        model: (model ?? '?').replace(/-q4f\d+_1-MLC$/, ''),
        ...(error ? { error: 'yes' } : {}),
    });
}

// Rough token count (about 3.5 characters a token for this text).
const tokens = (s: string) => Math.ceil(s.length / 3.5);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
// "Based on the data provided, …": the player never sees "the data", and
// the answer rules alone don't stop a small model saying it.
export const tidy = (s: string) => s
    // "Based on [your current progress and] the data provided, you…" → "You…"
    .replace(/(^|[.!?]\s+|\n\s*)(?:based on|according to) (?:[^,.\n]{0,40} and )?(?:the|your) data(?: provided| above| given| shown)?,\s*(\w)/gi,
        (_, start: string, c: string) => `${start}${c.toUpperCase()}`)
    .replace(/,?\s+(?:based on|according to) (?:the|your) data(?: provided| above| given| shown)?(?=[.,;])/gi, '')
    // "However, the data shows that maxing…" → "However, maxing…"
    .replace(/\bthe data (?:shows|says|indicates) that\s+/gi, '')
    // …and without "that": "the data shows it" → "TowerForge's numbers show it".
    .replace(/\bthe data (shows|says|indicates)\b/gi, (_, verb: string) => `TowerForge's numbers ${verb.replace(/s$/, '')}`);
const visible = (s: string) => tidy(s.replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/<think>[\s\S]*$/, '').trimStart());

export const useAiStore = create<AiStore>((set, get) => {
    const patchLast = (patch: Partial<AiMessage>) => set(s => ({
        messages: s.messages.map((m, i) => (i === s.messages.length - 1 ? { ...m, ...patch } : m)),
    }));

    return {
        modelKey: modelByKey(readModel()).key,
        status: 'idle',
        progress: null,
        error: null,
        loadedId: null,
        cached: {},
        messages: [],
        busy: false,
        think: false,

        chooseModel: (key) => {
            try { localStorage.setItem(MODEL_KEY, key); } catch { /* not remembered */ }
            set({ modelKey: modelByKey(key).key });
        },
        setThink: (on) => set({ think: on }),

        // Which models are already downloaded (both builds count).
        checkCache: async () => {
            const urls = await cachedUrls();
            set({
                cached: Object.fromEntries(AI_MODELS.map(m => [m.key,
                    urls.some(u => (isOf(u, m.f16) || isOf(u, m.f32)) && u.endsWith('/params_shard_0.bin'))])),
            });
        },

        start: async () => {
            if (get().status === 'loading') return;
            const model = modelByKey(get().modelKey);
            set({ status: 'loading', error: null, progress: { pct: 0, text: 'Starting…' } });
            try {
                const id = await modelIdFor(model);
                if (engine && get().loadedId !== id) await get().stopModel();
                if (!engine) {
                    const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
                    worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' });
                    engine = await CreateWebWorkerMLCEngine(worker, id, {
                        initProgressCallback: r => set({ progress: { pct: r.progress, text: r.text } }),
                    }, { context_window_size: CONTEXT_TOKENS });
                }
                set({ status: 'ready', loadedId: id, progress: null });
                void get().checkCache();
            } catch (e) {
                worker?.terminate();
                engine = null;
                worker = null;
                set({ status: 'error', loadedId: null, progress: null, error: e instanceof Error ? e.message : String(e) });
            }
        },

        // Frees the graphics card (the download stays).
        stopModel: async () => {
            try { await engine?.unload(); } catch { /* worker already gone */ }
            worker?.terminate();
            engine = null;
            worker = null;
            set({ status: 'idle', loadedId: null, busy: false });
        },

        // Deletes a model's download from this browser.
        removeModel: async (key) => {
            const m = modelByKey(key);
            const loaded = get().loadedId;
            if (loaded === m.f16 || loaded === m.f32) await get().stopModel();
            const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
            for (const id of [m.f16, m.f32]) {
                try { await deleteModelAllInfoInCache(id); } catch { /* wasn't there */ }
            }
            // WebLLM leaves each build's file list (tensor-cache.json) behind.
            try {
                const cache = await caches.open(MODEL_CACHE);
                for (const req of await cache.keys()) if (isOf(req.url, m.f16) || isOf(req.url, m.f32)) await cache.delete(req);
            } catch { /* storage unavailable */ }
            await get().checkCache();
        },

        ask: async (question, ctx) => {
            const q = question.trim();
            if (!q || !engine || get().busy) return;
            // Earlier questions only: a small model copies its own earlier
            // answers' numbers into new ones, so it never sees them.
            const earlier = get().messages.filter(m => m.role === 'user').slice(-2).map(m => clip(m.text, 300));
            const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            set(s => ({
                busy: true,
                messages: [...s.messages, { role: 'user', text: q, done: true },
                    { role: 'assistant', id, text: '', status: 'Working out what to look at…' }],
            }));
            // The trace for the debug log (this device only) and the
            // anonymous counts (no text): what was picked, how long each step took.
            const t0 = performance.now();
            let routeMs = 0;
            let firstMs: number | null = null;
            let traced: { route: RouteChoice | null; looked: ToolResult[] } = { route: null, looked: [] };
            const finish = (text: string, unchecked: string[], error?: string) => {
                const timings = { routeMs, firstMs, totalMs: Math.round(performance.now() - t0) };
                addToLog({
                    id, time: Date.now(), question: q, routed: traced.route, route: traced.route ? routeText(traced.route) : '',
                    looked: traced.looked, answer: text, unchecked, timings, model: get().loadedId, think: get().think, ...(error ? { error } : {}),
                });
                countAnswer(traced.route, unchecked.length, timings.totalMs, get().loadedId, !!error);
            };
            try {
                // Follow-ups ("and CF+ instead?") read with the question before.
                const asked = earlier.length ? `Earlier question, for context: ${earlier[earlier.length - 1]}\nQuestion: ${q}` : q;
                // A question its wording settles skips the model's step 1 (a
                // follow-up never does: it needs the question before).
                const quick = earlier.length ? null : quickRoute(q);
                const route = quick ?? readRoute((await engine.chat.completions.create({
                    messages: [{ role: 'system', content: ROUTE_PROMPT }, { role: 'user', content: asked }],
                    temperature: 0, max_tokens: 200,
                    response_format: { type: 'json_object', schema: ROUTE_SCHEMA },
                    extra_body: { enable_thinking: false },
                })).choices[0]?.message?.content ?? '', q);
                routeMs = quick ? 0 : Math.round(performance.now() - t0);
                traced = { route, looked: [] };

                patchLast({ status: 'Reading your account…' });
                await new Promise(r => setTimeout(r, 30));   // let the page show it
                const looked = lookUp(route, q, ctx);
                traced = { route, looked };
                // A tournament question sees the tournament build, not the farming one.
                const summary = accountSummary(ctx.account, Date.now(), route.runs === 'tournament' || route.tool === 'tournament' ? ctx.tourney : undefined);
                let data = looked.map(r => `[${r.title}]\n${r.text}`).join('\n\n');
                // Keep everything inside the context with room for the answer.
                const answerTokens = get().think ? 2048 : 900;
                const context = earlier.length ? `\n\n[Earlier questions in this chat]\n${earlier.join('\n')}` : '';
                const room = CONTEXT_TOKENS - answerTokens - tokens(ANSWER_PROMPT) - tokens(summary) - tokens(context) - 300;
                if (tokens(data) > room) data = clip(data, Math.floor(room * 3.5));

                const system = `${ANSWER_PROMPT}\n\n[The player's account]\n${summary}${data ? `\n\n${data}` : ''}${context}`;
                patchLast({ looked, route: routeText(route), routed: route, status: get().think ? 'Thinking…' : 'Writing…' });
                const stream = await engine.chat.completions.create({
                    messages: [{ role: 'system', content: system }, { role: 'user', content: q }],
                    stream: true, temperature: 0.2, top_p: 0.8, max_tokens: answerTokens,
                    extra_body: { enable_thinking: get().think },
                });
                let raw = '';
                for await (const chunk of stream) {
                    raw += chunk.choices[0]?.delta?.content ?? '';
                    const shown = visible(raw);
                    if (shown && firstMs === null) firstMs = Math.round(performance.now() - t0);
                    patchLast({ text: shown, status: shown ? undefined : 'Thinking…' });
                }
                const text = visible(raw) || '(No answer — try asking another way.)';
                const unchecked = unverifiedNumbers(text, [summary, ...looked.map(r => r.text)].join('\n'), q);
                patchLast({ text, status: undefined, done: true, ...(unchecked.length ? { unchecked } : {}) });
                finish(text, unchecked);
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e);
                const text = `Something went wrong: ${error}`;
                patchLast({ text, status: undefined, done: true });
                finish(text, [], error);
            } finally {
                set({ busy: false });
            }
        },

        interrupt: () => { void engine?.interruptGenerate(); },
        clearChat: () => { if (!get().busy) set({ messages: [] }); },
    };
});
