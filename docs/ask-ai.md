# Ask AI (preview)

A chat tab where a player asks about their own account in plain words
("what should I spend my stones on?", "how many waves would maxing CL get
me?"). Started 2026-10-21 as a preview only the owner's account sees.

## How it works

- **The model runs in the player's browser**, on their graphics card, with
  [WebLLM](https://github.com/mlc-ai/web-llm) (`@mlc-ai/web-llm` 0.2.85,
  Apache-2.0) over WebGPU. Nothing is sent anywhere and it costs the site
  nothing. The weights download once from Hugging Face (`mlc-ai/…-MLC`) into
  the browser's Cache Storage (`webllm/model`, `webllm/config`,
  `webllm/wasm`); the compiled model library comes from
  `raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs`. "Remove download"
  deletes them (checked: storage use back to 0 MB).
- It runs in a web worker (`src/ai/aiWorker.ts`), so the page stays
  responsive. The model and the chat live outside the page
  (`src/ai/aiAssistant.ts`, a Zustand store), so switching tabs keeps them.
- **Models** (`src/ai/aiModels.ts`): Qwen3 4B (default, 2.3 GB), Qwen3 8B
  (4.6 GB), Qwen3 1.7B (1 GB) — download sizes from each model's
  `ndarray-cache.json`. The q4f16 build needs the GPU's `shader-f16`
  feature; without it the q4f32 build loads. Context raised from the
  prebuilt 4,096 to 8,192 tokens.
- **Two steps per question**, because a small model can't do the game's math:
  1. *Route*: the model answers in JSON (held to a schema by WebLLM's
     grammar) which data to look at — `upgrades` (a currency, a goal, which
     runs to score on and a budget),
     `what_if` (upgrades in the player's words and a level; campaign or
     tournament), `levels`, `runs` (campaign, tournament or any), `tier` (a
     tier number), `tournament`, `lab_boosts`, `shard_plan` (a module
     type), `guide` (keywords) or `none`. What the question itself settles is
     checked in code (`checked`): the tier, "… instead?", "what is X", "my
     runs", module shards alone, lab boosts. Qwen3 starts every reply
     with an empty `<think></think>`, which is stripped before parsing; when
     the JSON still can't be read, keywords pick (and the page says so).
  2. *Answer*: the site works the data out with the same engine the pages
     use (`src/ai/aiTools.ts`): the Optimizer's paths (with what the player
     can buy now and the picks cheapest first), What If (campaign, or the
     What If page's tournament mode — one shared setup,
     `tournamentModel.tournamentWhatIf`), current levels, the saved runs
     with damage by source (campaign against tournaments), another tier, the
     Tournament page's estimate, the Labs page's Lab boosts (and how long a
     named lab takes at each speed), Modules → Shard plan, and a BM25
     search over the game notes in `docs/` plus the battle conditions' texts
     (`src/ai/aiKnowledge.ts`). The model answers from that and an account
     summary, written out as it goes. "Looked at" under each answer shows
     the route and the exact data.
- Upgrades named in words: UW short names (CL, CF…), "+"/"plus" or the UW+
  name for UW+, "lab" picks labs over the workshop, a UW alone means all its
  stats; levels "max", "+N", "next" or a number.

- **Another tier** (`tierOutlook`): each of the last 5 campaign deaths'
  basic enemy health (Run Length), and the wave where the other tier's
  enemies reach it at that run's level skip (`runLength.deathWave`). Same
  tier gives the same waves back (within the 2–3 waves a health level
  lasts at 58% skip, tested). Health only — higher tiers' enemies also hit
  harder — so it's where the damage runs out. Owner's T18 deaths
  (W8,600–W9,322) → T19 about W6,400.
- Answers may link the site's pages (real addresses are in the prompt); a
  link opens the tab in place, so the model and the chat stay. Other links
  show as plain text.
- "Downloaded" is checked in Cache Storage directly (the first weight file);
  WebLLM's own check fetched every model's file list from Hugging Face on
  each visit. Remove download also deletes the file lists WebLLM leaves.
  The browser may keep counting the space for a while after.

## What players are told

The **How Ask AI works** panel at the top of the page (`components/tabs/AiAbout.tsx`,
opened by the intro's link or `towerforge.net/ai#how-it-works`) explains it
for players who aren't technical: what the model is, what it needs, the four
steps of an answer, what it's bad at, and everything kept on the device or
sent: the opt-in report's fields (`AiReport` in `ai/aiLog.ts`) and the
anonymous counts (`ai-answer`, docs/analytics.md). When what's sent changes,
change the panel too.

## Who sees it

**Everyone, since v2.0.0 (2026-10-29)** — the owner's decision to open it to
all players as a beta. The tab group no longer has `preview: 'ai'`, `/ai` is
in the sitemap, and anyone can send a report (signed out, without a name).
The `"ai"` list in `features.json` no longer matters; `"ai-admin"` still
opens the owner's AI reports panel. Until then it worked like this:

`TowerForge.Server/Data/PreviewFeatures.cs` reads `features.json` in the data
directory (`/var/lib/towerforge/features.json` on the server — never in the
repo, the usernames are private):

```json
{ "ai": ["SomeUser"] }
```

`/api/account/me`, `/login` and `/register` return `features` for the
account; the tab shows when it has `"ai"` (and always in development). A
hidden tab's address (`/ai`) opens the home page. Usernames match in any
case; the file is re-read when it changes (no restart); a broken file means
no previews. Checked 2026-10-21 against a local server with two made-up
test accounts. The gate hides the page; the code itself ships in the public
bundle (the repo is public anyway) and runs only on the visitor's machine.

### Opening the preview to testers

Only accounts in the server's `features.json` see Ask AI. Before more
players get it (it runs on their hardware, which is the risk):

1. Pick testers with different hardware: an NVIDIA and an AMD desktop, a
   laptop with a weaker GPU (it should use Qwen3 1.7B or 4B), and someone
   on Chrome or Edge on Android (WebGPU there varies by phone).
2. Add their site usernames to `/var/lib/towerforge/features.json` on the
   server (`{ "ai": ["owner", "tester1", …] }`) — read again on change, no
   restart. Usernames never go in the repo.
3. Ask them to use **Copy for a report** under any answer that's wrong: it
   copies the question, the answer, what it looked at, the model and the
   GPU — paste that into Discord. A "Not one of TowerForge's numbers" note
   under an answer is worth reporting too.
4. Add each reported question to `bench/benchQuestions.ts` (in the
   player's words) and rerun the bench before and after the fix.

## Debugging: the log, reports and counts (2026-10-29)

Three ways to see what goes wrong, from most private to least:

- **Debug log** (everyone with Ask AI, this device only): every question
  with its trace — the route and whether the wording or the model picked
  it, the data it looked at, the answer, numbers that aren't TowerForge's,
  route / first words / total time, model, 👍/👎 — the last 200 in
  `localStorage` (`tc_ai_log`, `ai/aiLog.ts`), shown under the chat
  (`components/tabs/AiDebug.tsx`). Filters for what's flagged (numbers
  not TowerForge's, route from keywords, no answer, error, slow > 45 s,
  👎); each entry can be asked again or copied as a test bench question
  (`benchSnippet` — correct its `expect` before adding it).
- **Reports** (opt-in, per answer): 👎 offers "Send this answer to
  TowerForge?", saying what it sends (question, answer, the data it looked
  at, model, GPU, version, a note) before anything goes; Send posts it to
  `/api/ai-reports` (signed in, the "ai" preview, 10 a minute, 128 KB;
  kept a year in `ai_reports`). The owner reads them on the **AI reports**
  panel (the `"ai-admin"` preview in `features.json`): Open / Fixed / All,
  the whole trace, Mark fixed, Delete, Copy as bench question. Checked
  2026-10-29 on the local server: signed out 401; an account without the
  previews 403 on all four; a report sent from the page arrives with
  exactly its 11 fields, marks fixed, filters.
- **Anonymous counts**: an `ai-answer` analytics event per answer (no
  words, docs/analytics.md) — which tool, wording or model, flagged or
  not, a time band, the model.

The Ask AI page's privacy text says all three. The local test also caught
the number check flagging "40" and "180" (the notes' "40s" and "180s" are
seconds; the game's "s" is sextillion): `numbersIn` now reads a number
with a lowercase s both ways.

To turn on the reports panel on the server: add the owner's username
under `"ai-admin"` in `/var/lib/towerforge/features.json` (next to "ai").

## Added 2026-10-29

- **Number check on every answer** (`aiCheck.ts`, shared with the bench):
  numbers in the answer that aren't in the data or the question show under
  it — "⚠ Not one of TowerForge's numbers: 9.8M".
- **Which tier to farm** (`farmTiersReport`): coins an hour on the tier
  farmed and the ones around it, up to the highest unlocked — waves from
  the enemy health where the runs ended, coins from Coins per Run's model.
- **Guardian chips** (`guardianReport`): the Optimizer's chip picker for the
  goal and for coins; equal sets read "just as good".
- **Open in What If**: an answer whose What If tried changes has a button
  that opens the What If page with them (and the mode) filled in
  (`components/common/whatIfHandoff.ts`).
- **Measured campaign / tournament differences** in the runs data (CL
  reach, shots per enemy, what ended the runs, the conditions ticked), the
  only reasons the answer may give.
- **Quick routing** (`quickRoute`): questions whose wording settles the
  data skip the model's step 1 — 41 of the bench's 94 asks; never
  follow-ups or anything that could be a What If.
- **Copy for a report** under each answer, and new suggested questions.

## What was checked (2026-10-21, RX 7800 XT, Qwen3 4B)

- Download 2.3 GB at ~60 MB/s; loading from the browser's storage ~15 s.
- First words ~10 s after asking, full answers 25–40 s; with "Think before
  answering" ~70 s.
- Without guards the 4B copied numbers from its own earlier answer (said
  +1,042 waves for CF+ when the data said +42.4). Fixes: it never sees its
  earlier answers (only the earlier questions), every tool result starts
  with a one-sentence `Headline:` to quote, temperature 0.2. After that the
  numbers matched the data.
- Explanations of mechanics are the weak spot: without thinking it muddled
  Fast's Ultimate ("enemies are slower"); with thinking it was right.

## The owner's first questions (Qwen3 8B, 2026-10-21)

What went wrong, and what changed:

- "Why is my Chain Lightning weak in tournaments?" went to the game notes
  and got a generic answer with a made-up link (towerforge.com). Now: the
  `runs` tool. On the owner's runs CL is 12% of the damage on T18 and about
  10% in tournaments (Orbs 71% / 51%, Death Ray 26% in tournaments), so CL
  is a small share in both.
- "How far would I get on T19?" was sent to What If ("T18 → max"). Now: the
  `tier` tool.
- "Cheapest way to improve": it called 61.00K coins dearer than 4.67Q. Now
  the prompt lists the letters in order and the data has a "Cheapest first"
  line, worked out by the site.
- "Increase my coins with coins and stones" kept the Optimizer's saved goal
  (damage). Now the router sets goal "coins" (an example says so), and
  "any" currency when two are named.
- "PS" was read as "Power Stones". The site now says stones, like the game.
- It read levels like "Damage 13/32" as damage; the prompt says they're
  levels.

## "1500 stones for tournaments" (2026-10-23)

"I am about to get 1500 stones, what is my best course of action to improve
my tournament progress?" got Generator Assist Substat Eff "Lv 14 → 70"
(+12,349%, 7.64K stones) as "the best use of your 1500 stones". Three things
were wrong, none of them the Optimizer's ranking itself:

- **Campaign scoring for a tournament question.** The upgrades tool always
  used the run chosen on the Optimizer page. On the owner's campaign runs
  (around W9,000) a point of Enemy Health Level Skip is worth e^0.54 in
  damage, and the Generator assist's Enemy HP Level Skip substat (8% at
  Substat Eff) makes that slot the top stone pick (+0.08 skip points per 1%).
  On tournament runs (around W100) a point is worth e^0.055 and the picks
  are Cannon and Core assist instead. Now the router fills `runs` for
  upgrades too ("tournament" when they ask about tournaments): the picks are
  scored on the newest tournament run, its league's conditions and the
  Tournament page's build (`scoredOn` in `aiTools.ts`), and the data says
  which runs it used.
- **The budget was ignored.** The router now fills `budget` (the amount
  they have or will have; the number in the question wins over the model's,
  `budgetIn`). With a budget the tool gives "Plan for N stones": the
  Optimizer's path cut where the stones run out, each upgrade's levels as
  one row, the total and the next buy after it. The prompt says to answer
  with that plan.
- **A compounded percentage.** Back-to-back levels merge into one row, and
  56 steps of +6.6% compound to +12,349% — true in the "damage toward
  waves" scale, meaningless to read. Pushing waves with Run Length, the rows
  now give waves, like the Optimizer page (`pathRunGains`). Merged assist
  rows read "14% → 70%", not "Lv 14 → 70".

Checked on the owner's export: 1,500 stones for tournaments = Cannon Assist
Substat Eff 23% → 31%, Core Assist Substat Eff 32% → 39%, Cannon Assist Mult
Eff 49% → 53% (1,488 stones, about +5.7 tournament waves); for campaign
pushing, Generator Assist Substat Eff 14% → 32% (1,431 stones).

## Test bench (2026-10-28)

A repeatable test of the real model, so a change to the prompts or the tools
is measured, not guessed. Files in `towerforge.client/src/ai/bench/`:

- `benchAccounts.ts` — three made-up accounts written as the game's export, so
  they go through Import Game Data like a player's file: **early** (T5, Silver,
  only Golden Tower, no modules or bots, no level skips), **mid** (T11, Gold,
  five UWs, Legendary modules, two bots, eHP, two tournament runs) and **late**
  (T18, Legend, every UW and UW+, Ancestral modules with assists, four bots,
  Glass Cannon, tournament records). Levels are a share of each max, varied per
  upgrade; never a real export.
- `benchQuestions.ts` — 39 questions in players' words (typos, "stonez", short
  names, follow-ups), 78 asks over the three accounts. Each names the data step
  1 should pick (tool, currency, goal, runs, budget, tier, the upgrades named).
- `benchGrade.ts` — grading without a second model: the route; every number in
  the answer found in the data, the account summary or the question (game
  letters and rounding allowed; the rest listed to read by hand); the data's
  headline carried (first pick, plan, What If gain, other tier's wave); only
  towerforge.net page links; no code words or the data's own section names.
- `runBench.ts` — the runner. On the dev server (`npm run dev`), in the
  browser's console:

  ```js
  const b = await import('/src/ai/bench/runBench.ts');
  b.runBench({});              // all three accounts; { accounts: ['late'], ids: ['stones'] } for some
  b.benchSummary();            // progress, scores, failures
  ```

  It starts the model chosen on the Ask AI page and replaces this browser's
  TowerForge data with each account (use a browser without data to keep).
  Results stay in the tab's session storage; a reload (any edit to a file the
  page imports, docs included, since the game notes are imported) stops the
  run, and `runBench({ resume: true })` asks only what's left. Don't edit the
  client while it runs.

Qwen3 4B on the RX 7800 XT: 78 asks in about 20 minutes, 9–29 s an answer.

| Run | Pass | Route | Headline | Unverified numbers |
|---|---|---|---|---|
| 1 — before the fixes | 73% | 83% | 88% | 2 answers |
| 2 — tools, prompts, routing | 87% | 92% | 91% | 5 |
| 3 — costs said as costs, "enough for it", tier estimate first | 85% | 90% | 93% | 4 |
| 4 — route checked in code (tier, "instead", "what is") | 86% | 96% | 90% | 5 |
| 4b — "my runs", tidy-up, tier headline alone (the 18 asks those touch) | 100% | 100% | 100% | 0 |
| 5 — lab boosts, shard plan, tournament What If (90 asks; 85 asked) | 86% | 89% | 94% | 2 |
| 5b — the new tools kept to their questions in code (22 asks) | 95% | 100% | 100% | 0 |
| 6 — number check, farm tier, Guardian, What If links, measured reasons, quick routing (94 asks) | 94% | 100% | 95% | 4 |
| 6b — the cost line reworded, "the data shows" tidied (17 asks) | 100% | 100% | 100% | 1 |

Run 6 (2026-10-29): quick-routed answers took 15.4 s on average (41 asks)
against 23.9 s for the ones the model routed (53). Reading the answers:
the Guardian answer first said "keep your current setup (Attack, Bounty,
Fetch)" — the data listed whole tied sets and a "keep what you have there"
line; it now says the swap ("swap Fetch for Scout (+0.97%)") and the bench
checks the chip put in (`noHeadline` for "which chips am I using", which
asks what's on now). The tournament-reason answer now quotes the measured
shares (Death Wave 20%, Orbs 44%) instead of inventing a cause.

Run 5 (2026-10-29): the two new tools pulled old questions to them on every
account — "what should I research next in the labs" → lab_boosts, "card
slots with my gems" → shard_plan, "where should my medals go" → none. Fixed
in `checked`: lab_boosts only for boost / speed / cells / time questions,
shard_plan only when shards are named, a named currency with spending words
gets its picks.

**Thinking ("Think before answering") on the 4B**, the 16 weak-spot asks
(tournament reasons, mechanics, leagues, stones with nothing to buy,
survival, lab boosts) on the mid and late accounts, read side by side: no
better. Mechanics answers about the same (level skip right in both); it
still invents tournament reasons ("enemy composition differences" for CL
11% vs 14%); it adds its own mistakes ("upgrade Chain Lightning (next UW)"
on an account that owns it, the boosts it can't afford read as the plan);
about 70 s an answer against 25 s. Thinking stays off by default.

**Qwen3 8B** (2026-10-29): the app's browser pane caps a site's storage at
about 5.9 GB in all and kept counting the removed 4B's 2.13 GB, so it ran in
the owner's Chrome (Claude in Chrome, 10.7 GB quota; the download and the
made-up accounts were removed afterwards). All 90 asks with every guard:

| Model | Pass | Route | Headline | Unverified | Time |
|---|---|---|---|---|---|
| Qwen3 8B | 92% | 97% | 90% | 2 answers | 30 s an answer, 45 min |
| Qwen3 4B (run 5, before the last guards) | 86% | 89% | 94% | 2 | 21–25 s |

Read side by side, the 8B quotes the data where the 4B garbles it: the lab
boosts exactly ("×5, ×5, ×5, ×5, ×4" — the 4B said "×5 for all labs"),
"TowerForge can't predict if you'll move up" for leagues, the shard plan and
tournament What If word for word. Both still invent a reason for Chain
Lightning's smaller tournament share. Its misses: "research next in the
labs" kept currency "any" (now set from the question in code, for both),
and the eHP What If answers leave out the damage gain. On the RX 7800 XT the
8B is about as fast (download 4.6 GB, about 82 s from nothing to the first
answer). The 4B stays the default — half the download, runs on 4 GB cards —
and the model picker now says the 8B is the more accurate one.

Runs 3 and 4 traded fixes for regressions: each new example moved other
questions ("what tier am I on" → none pulled "move up a league" and "what is
enemy level skip" there too). What held was settling things in code from the
question itself (`checked` in `aiAssistant.ts`): the tier only from a number
in the question (none = the next tier), "… instead?" keeps only upgrades the
question names, "what is X" without "I/my" goes to the notes, "my runs" to
the runs. `tidy` takes "based on the data provided" out of the answer.

Still weak after run 4 (the 4B's limits, not fixed by prompts): it invents
reasons when the data has none ("tournament enemies are more resilient" for
a lower Chain Lightning share), and it still adds generic advice when the
data says nothing is worth buying.

What run 1 found (reading every answer, not just the scores), and the fix:

- **Step 1 picked the wrong data** for "how do I get more coins" (game notes),
  "how do I survive longer" (none), "what's my workshop damage level" (notes)
  on all three accounts; every runs question was read as tournaments; "I have
  2.4B coins, what should I buy" set the goal to coins; "… instead?" kept the
  earlier upgrade; "max Smite" became "SM". Fix: examples for each, the UW and
  UW+ names, "write upgrades in the player's words", and the same three in the
  keyword fallback.
- **Asking about a UW the player doesn't own** matched a lab with its name
  ("maxing Death Wave" → DW-Health lab, "+0.0 waves"). Now `missingUw` says
  it isn't unlocked and what the next UW costs.
- **"+0.0 waves" as the headline** when the waves don't move: an eHP build's
  waves come from survival, so +614% damage read as worthless. Now the
  headline says what changes and why (eHP: TowerForge measures survival).
- **It couldn't add up**: "buy both" for two card slots costing 700 gems with
  420 held; "+9.8M" for 444.78M → 453.58M. Now the site writes what the
  currency held buys in the Optimizer's order (shards by type) and every
  coin change.
- **Costs read as gains** ("will yield 2.16M coins", "would generate 5.67M
  coins"): every row and What If now says "costs".
- **"Which UW does the most damage?" → Golden Tower** (it does none). The runs
  data now names the owned UWs with no damage of their own (Golden Tower,
  Chrono Field) and the ones under 1%, and puts campaign and tournament
  shares side by side.
- **Tournaments**: "move up to Champion" for a Legend player, "no battle
  conditions this week" for none ticked, a best rank with the wrong date.
  Now the league order and the next league, "none ticked yet", and the best
  rank with its date are written out.
- **"Nothing left worth buying"** with no reason (early and eHP stones, early
  medals) — the model then made advice up. Now the data gives the reason.
- **Mechanics**: enemy level skip explained as Wave Skip, Death Penalty's x
  as damage reduction. The notes gave only formulas; `run-simulation.md` §4
  now says what level skip is and `module-effects.md` what Death Penalty's x
  is.
- **Answers pointed at the data** ("see the Cheapest first list", "the
  [T10 → T11] section") and invented reasons ("tournament enemies use
  strategies"). New answer rules: no data section names, no arithmetic, no
  buys beyond what's held, reasons only from the data or notes, only Tower
  questions (it wrote a poem).

Gaps the bench showed that aren't the assistant's:

- **The Optimizer doesn't score unlocking a new UW or a bot** — so the early
  account got nothing for stones and medals. It can't be scored from the
  run (docs/optimizer.md, "A new UW or bot isn't ranked"); the Stones and
  Bots panels and the assistant now give the next one's price against what's
  held. The eHP account's empty stone and medal lists weren't a gap: Chrono
  Field adds survival only with the CF-Dmg Reduction lab, and Flame Bot's
  cut is measured from the run's `FlameBotBlocked` (the made-up runs had
  none).
- **Smite on the late account**: maxing it is +0.51% damage but +0.0 waves
  (push +0.00%). Health-based damage (Smite, Consume) may be undervalued for
  pushing; worth checking against a real account's What If.

## Player reports

Answers players sent with 👎 → Send (the AI reports panel). Their names and
numbers stay in the panel, never here; the question goes into the bench.

**1. "What should I do to perform better and get more keys in the Legend
tournament?"** (2026-10-30, v2.0.1; 53 s.) The route was right (upgrades,
any currency, waves, tournament runs), but the answer read as farming
advice: "boosts to your farming efficiency", and the Guardian chips it
named (Summon, Fetch, Bounty) were the farming preset's. The player's note:
it doesn't look at their tournament setup, and they don't farm in
tournaments. Three causes:

- The account summary always showed the preset and module loadout on now —
  the farming ones. A tournament question's summary now shows the
  tournament build chosen on the Tournament page (`accountSummary`'s
  `tourney`, `withTournamentBuild`), and says so, or that none is chosen.
- The data was only the Optimizer's picks. "Do better in tournaments" with
  no currency or amount now gets the picks for tournament runs *and* the
  Tournament outlook (league, recent waves and ranks, this week), whether
  the route picked the upgrades or the Tournament tool (`lookUp`). The
  outlook also says TowerForge doesn't know each rank's rewards (keys), so
  an answer about keys doesn't guess.
- A new answer rule: a tournament question is about tournament waves and
  rank, never farming. A league or bracket named ("in the Legend
  tournament", "my Champion bracket") reads as a tournament question
  (`TOURNEY_WORDS`; not Gold or Mythic, which are also golden things and a
  rarity).

Bench question `tourney-keys` (mid and late, must not say "farm"). Rerun of
the tournament questions on the 4B (2026-10-30): 9 of 9 pass. On the late
account (Legend, Glass Cannon) the answer now gives the tournament picks
with their waves and costs (Chrono Field Cooldown +5.8 waves for 178
stones, WS Attack Critical Chance +25 waves, Range Lab +3.1 waves), every
number TowerForge's, in 57 s. Still weak: it calls more than one pick "the
best next stones buy", it doesn't use the ranks it was given (average 16.6
over the last 10, best 12), and on the mid account (an eHP build in Gold,
where TowerForge doesn't score tournament waves) it padded the answer with
levels from the summary and called Legend a "tier".

**2–4. Three reports sent on 2026-11-09** (copied as bench questions by
the owner). Each went to the wrong data; the fixes are in code
(`checked`, `wordsOf`) and in the notes, checked on the bench accounts
without the model (`aiAssistant.test.ts`, `aiTools*.test.ts`):

- *"How do I get a permanent Black Hole in tournaments without perks and
  the Galaxy Compressor?"* — routed `none`, so the model answered from its
  own memory. The notes didn't say it either: `ultimate-weapons.md` now has
  a "Permanent Black Hole" paragraph (38s against 50s; what closes the 12s:
  the perk, Galaxy Compressor, or Core module BH Duration / Cooldown
  substats on the main and assist slots; not Multiverse Nexus). A `none`
  that asks how to do something with a game thing by name (a UW, UW+,
  unique module, perks, labs, cards…) now goes to the notes, which find
  the Black Hole section first. Bench `bh-permanent`.
- *"Could you recommend a total build set to maximize coins per hour?"* —
  routed `none`. Earning coins said any way ("maximize coins", "coins per
  hour") is now the coin picks, and coins *an hour* or farming also gets
  which tier to farm. Bench `coins-build`.
- *"My coin/wave workshop is maxed out so it gave the wrong information. I
  am asking specifically on the research lab…"* — a follow-up. Two causes:
  "coin/wave lab" matched the workshop's Coin/Wave (its name has "coin",
  the lab's "Coins"), so the first answer was about the workshop; and this
  question got the coin picks. Words now read one and many the same
  (`wordsOf`), and a lab named in full, when the question isn't asking what
  to buy, gets What If on that lab. Bench `coin-wave-lab`. On the bench
  accounts maxing the Coins/Wave Lab shows +0 coins: its gain scales the
  share of coins a run measured from Coins/Wave, and the made-up runs have
  none; a real export has it.

What the reports themselves showed (the owner sent the answers too):

- The Black Hole answer took 87 s to route and 185 s in all on that
  player's GPU, and said "it's not possible" from Cooldown 16/16 alone.
- The coins question never ran: `ModelNotLoadedError` in 0.0 s on the 8B.
  When the graphics card drops the model (sleep, a driver reset) WebLLM
  unloads it in the worker while the page still reads "ready", so every
  question failed at once. Now that error loads the model again and asks
  once more ("The model stopped — loading it again…"); checked by
  unloading the model under a ready page: it reloaded in 5 s and answered
  once, with no duplicate message. Its bench line's `none` was only the
  missing route.
- The Coins/Wave answer said "the Coin/Wave Lab is already maxed (99/99)":
  the summary lists the Coins/**Kill** Lab, which was 99/99. With What If
  on the right lab the 4B still said "maxed" — the question says the
  workshop's is — until the headline led with where the upgrade is ("Coins/
  Wave Lab is level 21 of 99 now, not maxed.") and a rule said maxed means
  both numbers equal. A coins-only What If's headline is now coins, not
  "+0.00% damage and +0.00% survival".

Rerun on Qwen3 4B (2026-11-09, the three questions plus the What If,
farm-tier and more-coins questions on mid and late; 26 asks over two runs):
route 100%, headline 100%. Read by hand: Coins/Wave now "not maxed (21 of
99)" with its cost; the coins build gives the coin picks and the best
tier; the Black Hole answer leads with the two Core modules and "avoid
Multiverse Nexus", but the 4B still adds "use the Black Hole perk" though
the question rules it out, and one answer invented a page link. The 4B
picked the tier comparison for the coins build (`farm_tier`), so a
`farm_tier` route for a question that never says "tier" now gets the coin
picks with the tiers.

## Download size

The two WebLLM scripts (the worker and the page's copy) are ~6 MB each.
Since 2026-10-22 nginx compresses JavaScript, CSS, JSON and SVG
(`ops/nginx/towerforge-gzip.conf`, installed in `/etc/nginx/conf.d/`): each
AI script goes out as ~2.1 MB, the main bundle 359 KB → 111 KB. The model
itself (Hugging Face) is already compressed weights.

## Not done yet

- Guardian chip and module substat *advice* (the summary lists them; no
  tool ranks them yet), relics and the Vault beyond the summary.
- `TournamentRecords` (every tournament's wave and rank, 29.1.3) as a tool
  once the fields are confirmed.
- Learning over time: today it knows what the docs and the engine know;
  "smarter" means better notes and tools, not training.
