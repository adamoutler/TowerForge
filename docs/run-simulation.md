# Run simulator — research notes

Everything gathered (2026-10-17) for a simulator that plays a run wave by
wave, calibrated to the player's own battle history, to predict **how far a
run gets** and **coins / cells per run**, before and after an upgrade.

Status: **first piece built — the Enemy Stats page** (Optimizer → Enemy
Stats, `engine/enemyStats.ts`), which recreates the in-game Wave Info panel
and matches the checked screenshot digit for digit. **Step 1 of the
simulator — Coins per Run** (Optimizer → Coins per Run, `engine/runCoins.ts`):
plays a run wave by wave for kills and coins, tuned to one saved run, and
shows how well it predicts the player's other runs. Survival (how far a run
gets) and upgrades aren't in yet.

### Coins per run (step 1)

- Kills per wave = spawn rate (Wave Accelerator chart: 37 at wave 1000 → 56
  at 6500, earlier with mastery) × a per-player factor fitted to the tuning
  run's kills (stands for 3.25 per spawn tick × Enemy Balance × waves played).
  Intro Sprint waves pay nothing (default from the card in the current
  preset, editable).
- Coins = kill coins + Coins / Wave + Golden Combo and Critical Coin (shares
  of kill coins) + Wave Skip and fetch (shares of the rest), as the tuning run
  shows them; another tier scales by its coin multiplier.
- **Coins per kill: fixed per enemy (wiki), not × the wave (TheTowerSDK).**
  Owner's 16 T18 runs (2026-10-17): kills within ±2% for every run past
  W5000; coins 9.6% average off with fixed values vs 11.1% × wave (offline
  refit: × wave is worse at every Wave Accelerator setting; a wave-dependent
  enemy mix helps only slightly). Most of the remaining error is the account
  improving over the week — tuned on the newest run, Oct 10–11 runs come out
  +8%, Oct 16–17 within ±2%; same-day runs to similar waves differ ±5%.
  Two short runs (W3418 +46%, W4060 +29%) don't fit any rule — likely runs
  ended by hand or played differently.

### Upgrades → waves and coins (step 3)

Optimizer → Rank by → "How far runs get (waves)" (Glass Cannon, calibrated
eDPS). Ranks stone upgrades by **flat damage** only (`edpsSurvivalScore`:
CL, SM, DW, ILM, PS, tower shots, each by its share of the run's damage),
because orbs, Black Hole and Consume take a share of an enemy's
health (orbs destroy what they touch) and don't fall behind as enemies get
tougher. Smite does too, but it reaches the enemies that end runs, so its
share of their health counts as flat damage they no longer need (2026-10-29,
[ultimate-weapons.md](ultimate-weapons.md) Chain Lightning). Bosses, elites and fleets are immune to orbs, Death Ray and BH —
but runs also end to Tanks and Ranged, which aren't: for those, orbs and
Death Ray stopping more of them counts too (2026-10-22, [optimizer.md](optimizer.md)
"Orbs and Death Ray against the enemies that end runs"). Each step's gain compounds
along the path and becomes waves (`pathRunGains` → Run Length) and coins per
run (Coins per Run). Totals far past the current death wave are rough.
- **Run-to-run luck on path rows** (code's assumption): along a path the
  death wave is averaged over ±10% damage (9 points), as a run's limit varies
  a little with luck. Without it, single small steps showed 0 waves short of
  a health wall and a whole wall once across it. Whole-path totals barely
  change; the Run Length page itself is unaveraged.
- **Workshop and labs** (2026-10-18): ranked the same way — workshop by gain
  per coin, labs by gain per hour of research ([optimizer.md](optimizer.md)
  has the cost sources). Enemy Health Level Skip is folded in at
  `skipWorth`: the log of the damage factor that gains the waves one skip
  point does, measured over +50% damage and 2 points (≈ +90% damage a point
  near W8300 at 58% skip).

**Enemy Health Level Skip** (same mode, `engine/levelSkip.ts`): chance =
(workshop 0.05%/level + lab 0.1%/level + relic + module substats) ×
enhancement (×1 + 0.01/level), capped at 100% before the tier's battle
conditions subtract a fixed amount — so an upgrade adds to the real chance
exactly what it adds here. A 10-step path of the most skip points per coin
(workshop and lab prices from the shared cost tables after the player's
discount labs and lab speed — they match the wiki's skip tables; all 60
enhancement levels from the wiki, less its discount lab), each step turned
into waves (`pathSkipGains`) and coins per run. Lab time isn't weighed in
this panel — it's shown next to the cost; the Labs panel weighs it.

### Run length, eHP (2026-10-23)

`engine/runLength.ts` with `stat: 'attack'`, Run Length's eHP view, the
Optimizer's survival rows, What If. An eHP tower takes the hits, so a run
ends where enemy **attack** outgrows what it can take (health, overheal,
wall, healing, Defense %, Chrono Field and module damage cuts, thorns — the
survival score, [optimizer.md](optimizer.md)). Same model as Glass Cannon on
the basic enemy's attack at the run's attack level (wave − AttackLevelSkips,
the panel's footer rule) and Enemy Attack Level Skip: more survival moves the
death wave to where enemy attack has grown by the same factor.

Checked on the saved runs of the site's eHP accounts (7 accounts, 158
deaths, read on the server for totals only — no names, nothing kept):
- **What blocks the damage:** Defense % took 50–94% of raw incoming damage;
  **Defense Absolute under 1%** at these waves (so it barely matters late);
  Chrono Field, Chain Thunder (to 19%), Flame Bot (to 47%) and Primordial
  Collapse (29–42%) mattered for some. These cuts were read with Defense %
  first; with it last (section 6, 2026-11-01) the lower layers' are smaller.
  Healing: packages, wall regen, and **lifesteal 20–30%** for lower-tier
  players (now counted, `ehp.ts`).
- **Attack holds steady at death:** runs on one tier with the same build die
  within ±16–30% of enemy attack (e.g. sd 0.05–0.11 in log10), and across
  tiers too where the deaths are eHP-like — one account's long runs on
  T7–T12 died at enemy attack 10^13.1–10^13.3 while enemy health at death
  differed by thousands of times.
- **Two kinds of eHP death.** Where damage taken ≈ the run's healing (×1),
  hits wore the tower down — the attack model fits. Where damage taken was
  ~10⁶× healing, single hits far past any pool ended the run, as in a Glass
  Cannon run (enemy health decides; one-tier-predicts-another was better on
  health there). `oneHitEnds` flags it (median > 100×) and Run Length says
  so; the player can switch the view.
- **Deaths left out:** eHP histories have many short runs (tries at a higher
  tier, a different build). The eHP model drops deaths under 60% of the
  recent ones' median wave, and the default tier is the one with the most
  waves played to a death (both builds), not the most deaths.
- Typical numbers (T10–T18, W8000–9500, 30–60% attack skip): +10% survival
  ≈ 80–110 waves; +1 point of attack skip ≈ 120–240 waves (worth +14–24%
  survival).
- Not checked: how far a single upgrade really moves an eHP death (needs
  runs before and after a known upgrade); the tournament attack curve (eHP
  tournament waves aren't shown).

### Run length, Glass Cannon (step 2)

`engine/runLength.ts`, Optimizer → Run Length. Owner plays GC: one enemy hit
takes all of the tower's health (Death Defy, Energy Shield and the wall
absorb a few), so a run ends where enemies get too tough to kill before
they arrive — enemy health ÷ tower damage crosses a fixed point (enemy speed
is capped by then).
- Enemy health at death = basic enemy at the run's own stat level (wave −
  HealthLevelSkips), by the confirmed formula; ratios only, so perks/labs that
  scale every enemy cancel.
- **Enemy health has walls:** at some levels several bands step together and
  health jumps 30–40% in one wave. At a 58% skip rate a big one sits near
  W8571 (level 3600 = 4 × 900, where the 900-wave band, ×1.15 growth and
  ×1.03/200 steps coincide); the owner's deaths at W8500/W8501 sit just under it.
  So each recent death is moved separately at its own skip rate and the
  moves averaged (an averaged limit can land on a wall and make small
  gains read as 0 waves).
- Near W8300 at 58% skip: +10% damage ≈ +50 waves; +1 point of effective
  health level skip ≈ +200 waves (83 fewer enemy levels). Attack level skip
  doesn't matter for GC (any hit is lethal). Past the nearest wall damage
  buys less: +50% ≈ 130 waves, +100% ≈ 225 (the test runs in
  runLength.test.ts), so a point of skip ≈ +90% damage over that range.
- **KilledBy, to confirm:** the owner's in-game battle reports show W8100
  Ray, W8200 Tank, W8500 Vampire, W8501 Overcharge and W5125 blank (run ended
  by hand). The page decodes the stored numbers with the SDK order (2 Tank,
  6 Vampire, 9 Ray, 12 Overcharge; 99 = none) — if it shows the same names
  for those runs, the order is confirmed. Facts below say where they
come from. "SDK" = TheTowerSDK (below); "wiki" = the Fandom wiki; "GV" = the
Game Vault wiki. Where sources disagree it says so (see [Disagreements](#disagreements-to-settle)).
Game version at the time: **v29.1**.

---

## Sources

| Source | What it is | Licence / use |
|---|---|---|
| **TheTowerSDK** — github.com/TmRxJD/TheTowerSDK, npm `thetowersdk` 0.12.0 (commit `d73c9f5`, 2026-10-17) | TypeScript library by TmRxJD (jdevo; Official Discord moderator, runs the-tower-run-tracker.com). Game data tables for v29.1, a save/export reader, and the formulas: enemy wave scaling, spawning, level skip, elites/fleets, wave-panel values, workshop curves, damage-reduction stack, thorns, range, targeting, perks, battle conditions & tournament heat, Golden Combo, wave skip, per-wave coin / cell / shard simulation. Ships a sourced knowledge graph (320 facts with "traps") in `dist/knowledge/knowledge-graph.v1.json`. Its data tables are transcribed from the game; its formulas are partly the game's own and partly fitted — each docblock says which. | **MIT.** One runtime dependency (zod, MIT). README asks tools built on its Effective Paths ports to credit the Effective Paths team (creator code SHEETLORD). Pin an exact version (pre-1.0, exports may move). |
| **tower-idle-toolkit** by skye — github.com/tower-idle-toolkit | Older (2023, unmaintained) toolkit; worked out the enemy-scaling structure the SDK still uses. | ISC. Superseded by the SDK. |
| **Fandom wiki** — the-tower-idle-tower-defense.fandom.com | 527 pages. Enemies, Tiers, battle conditions, overheat, cash, interest, free upgrades, packages, wall, perks, labs. A full text copy was read for this; not committed. | CC BY-SA. Starting point; the game wins. |
| **Game Vault wiki** — the-tower-idle-tower-defense.game-vault.net | Second wiki; a few extra details (boss spawn timing). | — |
| **Tower Knowledge Hub** (Notion, by J Plays) — the-tower.notion.site | Guides, the Death Wave kill-wall calculator (eike23). | — |
| **Effective Paths sheet** (Mattew / QuietFanta / Bisse …) | The community upgrade-value spreadsheet; the SDK ports its maths. | — |
| Community tools | thetower.lol (tournament results), Project Rend (stats tracker), the-tower-run-tracker.com, mytower.app, thetower.tools. | Reference only. |
| **Reddit** (r/TheTowerGame) | **Not reachable from this setup** (Reddit blocks the research tools and the built-in browser). Could be read through the owner's own Chrome if needed. | — |

**Recommendation:** build on the SDK (as a pinned npm dependency, or by
porting the specific functions with credit) for enemy stats, spawning, level
skip, battle conditions and the economy; build the **fight** itself (does the
tower kill fast enough, how much damage reaches it, when it dies) and the
**calibration** ourselves — no public source models those.

---

## Checked against the game (owner's account)

**Wave Info panel, Tier 18 wave 6000** (screenshot, 2026-10-17; the panel
shows stats after level skips, enemy labs and the run's perks):

| Row | Health | Attack | Speed | Mass | Spawn % |
|---|---|---|---|---|---|
| Basic | 4.02aa | 484.82Q | 6.72 | 40.95 | 18 |
| Fast | 3.81aa | 484.82Q | 23.05 | 40.95 | 24 |
| Tank | 18.19aa | 484.82Q | 4.03 | 198.90 | 22 |
| Ranged | 4.02aa | 1.45s | 8.06 | 40.95 | 21 |
| Boss | 19.40aa | 484.82Q | 4.03 | 507.00 | 100 |
| Protector | 2.41aa | 484.82Q | 2.69 | 81.90 | 15 |
| Vampire | 8.04aa | 484.82Q | 2.69 | 7800 | 100 |
| Scatter | 8.04aa | 242.41Q | 4.03 | 7800 | 100 |
| Ray | 4.02aa | 484.82Q | 2.69 | 19500 | 100 |
| Saboteur | 80.48aa | 0 | 14.11 | 39000 | 0 |
| Commander | 80.48aa | 0 | 1.34 | 39000 | 0 |
| Overcharge | 79.19aa | 3.31T | 1.34 | 39000 | 0 |

Footer: wave timer 26 s, cooldown 4 s, protector radius 15.19 m, protector
damage reduction **55%**, active enemies 53 (spawn rate 56), enemy attack
levels skipped 3465, health levels skipped 3474.

What it proves:
- **Stat level = wave − levels skipped** (health 6000 − 3474 = 2526, attack
  2535), as the SDK says.
- **The base formula is exact.** health(2526, T18) = 8.943e36 and
  damage(2535, T18) = 1.9393e20 from the SDK constants (my Python port,
  scratch). The panel = formula × **0.45** for health (the "Enemy HP −50%"
  trade-off perk at −55% with the Improve Trade-off Perks lab) and × **2.5**
  for attack (the "enemies slower, ×2.5 damage" trade-off perk). Basic
  4.0244aa → shows 4.02aa; Saboteur ×20 → 80.49aa vs 80.48aa; Overcharge
  attack = wave-1 damage 1.324T × 2.5 = 3.31T ✓; Ranged ×3 (ranged trade-off
  perk) = 1.45s ✓; Scatter attack ×0.5 ✓; Ray attack ×1 on the panel.
- **A 3.8-minute ×1 recording (T18 W6196 → 6206)** matched the formula at
  every wave to the displayed digit: health 6.39aa (level 2608) → 6.63 (2610)
  → 6.64 (2611) → 6.65 (2612); attack 590.90Q (2618) → 591.37 (2619) → 593.12
  (2620) → 593.60 (2621) → 594.07 (2622). The game **truncates** to 2
  decimals (6.638 shows 6.63). Skip rate over those waves ≈ 58%.
- **Number suffixes:** aa = 1e36 (wiki Common Abbreviations: … S 1e24, O
  1e27, N 1e30, D 1e33, aa 1e36, ab 1e39 …). The site's parser was fixed to
  match (it had o, d, U, D for 1e27–1e39).
- **Type rules:** Fast 3.81 = basic × (1 − Fast Health lab); Tank = ×5 × its
  lab (18.19 ⇒ −9.6%, 24 levels); Protector ×0.6; Vampire/Scatter ×2; Ray ×1;
  fleets ×20 with no lab except Overcharge's (−1.6%). Common enemy health lab
  = 0 on this account (Basic equals Saboteur ÷ 20).
- **Speeds** relative to Basic: Fast 3.43 (≈ ×3.9 × Fast Speed lab), Tank 0.60,
  Ranged 1.20, Protector/Vampire/Ray 0.40, Scatter 0.60, Saboteur 2.10,
  Commander/Overcharge 0.20 — the wiki table is right. Boss shows 0.60 =
  wiki 0.4 × 1.5 (boss trade-off perk speeds bosses up).
- **Mass** ratios match the SDK exactly (Tank 4.857, Boss 12.38, Protector 2,
  elites 190.5, Ray 476, fleets 952).
- **Spawn mix at T18 W6000:** basic 18 / fast 24 / tank 22 / ranged 21 /
  protector 15%.
- **Boss row:** 19.40aa = base × 20 × 0.45 (enemy HP perk) × (1 − 0.7 ×
  1.05) × 0.91 (Boss Health lab 30). The Boss Health trade-off gets **half**
  the Improve Trade-Off Perks bonus (wiki), so −73.5%, not −77%.
- **The game cuts big numbers off at 2 decimals** (3.8151aa shows 3.81aa,
  19.4096aa shows 19.40aa); plain decimals like speed are rounded (2.688
  shows 2.69). The site's `formatGameNumber` now cuts off the same way.
- **Fast speed** is ×3.9 × (1 − 0.4% × Fast Enemy Speed lab) from wave 750
  (wiki) — 23.06 vs the game's 23.05, so the 3.9 is slightly rounded.
- **Spawn mix (Basic–Protector)** at T18 W6000 doesn't match the SDK's
  formula (it gives 41/16/15/14/14). The SDK's fast:tank:ranged ratios
  (3.294 : 3.019 : 2.881) are right; the game uses the tier weight of tier
  20 (7.285) — a guess is tier + 1 per 3000 waves. Not shown on the page
  until more screenshots confirm the rule.
- **Wave cycle measured: 28.0 s** of real time per wave at the game's ×1.0
  (8 cycles, ±0.5 s; spawn bar fills ~24 s then the 4 s cooldown) vs the
  nominal 26 + 4 = 30 s — the game runs ~7% faster than its timers say.
  10 wave numbers passed in 8 cycles (Wave Skip).
- The tower sat at its overheal cap (289T of 17.5T max) the whole clip, so
  enemy attack cadence can't be read from it.

**End of a T18 push (owner's recording, 2026-10-19):** the last ~90 s of a
Glass Cannon run at ×6.3 (BlueStacks), W8875 → death at **W8898** (new
best). End screen: Killed By **Tank**, "Death defied 8 times". Read frame
by frame (1 s, and 0.25 s around the hits):

| Video | Wave | What happened |
|---|---|---|
| 0–26 s | 8875–8880 | Wall up and regenerating (200T → 297T, ≈3.7T per real second); tower health flat at its overheal cap; Energy Shield full (3 charges) |
| 26.5 s | 8880 | **Wall breaks** ("Rebuilding") |
| 31.3–32.3 s | 8881 | **Energy Shield blocks three hits** in about one real second (charges 3 → 0) |
| 32.6 s | 8881 | Another hit: health 288T → **8.99T = 51% of max** with a red 10 s timer — **Second Wind** (revive at 50%, invincibility; wiki card table) |
| 35 s | 8886 | Wall back (62T) |
| 35–86 s | 8886–8895 | Energy Shield stays empty — no charge back in ~17 waves (the card's recharge is 8–20 min) |
| 86.5 s | 8895 | **Wall breaks** again; Tanks packed around the tower |
| ≈89.7 s | 8898 | Next hit kills the tower (Second Wind already used, shield empty) |

What it proves:
- **Any hit is lethal.** The site's enemy attack at W8881 T18, at the ~58%
  attack skip of the owner's recent runs, is ~3.7e21 (~9e21 with the ×2.5
  speed perk); the tower's health is 2.9e14
  even overhealed. So for Glass Cannon only the wall and the run savers stop
  a hit — health, regen and Defense don't — as the model assumes.
- **Overheal cap = 16.5 × max health:** 288.8–289.6T on a 17.53T tower (the
  workshop Max Recovery at max, 1.5 + 0.03 × 500). Health tops up ~28.7T at
  each new wave (packages) back to the cap.
- **Second Wind revives at 50% of max health** (8.99T of 17.53T, plus a regen
  tick); the wall bar showed its 10 s timer and the wall was back when it ran
  out (the card rebuilds the wall).
- **The end comes in bursts.** Enemies (Tanks here) pile up around the tower
  once damage can't kill them; when the wall breaks, killing hits arrive
  seconds apart (at least five within ~10 game seconds at W8880–81: the wall,
  three shield charges, Second Wind). Two bursts ~15 waves apart ended this
  run. So at the very end a Death Defy save buys seconds, not waves — it has
  to win several rolls in a row. The waves Death Defy buys come from the
  earlier, single leaks (this run's 8 procs all landed before W8875 or were
  invisible inside the bursts — a Death Defy proc doesn't show on screen).
- **Wall at the end:** each break let the hits through; it took ~5.5 real s
  (~35 game s) to rebuild plus Second Wind's timer the first time. Its
  health (~250–300T) is irrelevant against ~1e21 hits — it blocks one hit
  per rebuild. Wall Rebuild matters for GC; Wall Health doesn't.

**How runs are played:** most players run AFK — so the default is no
in-run cash spending (only free upgrades and perks change stats mid-run).

## 1. Run structure and timing

- **Wave = spawn phase + cooldown.** 26 s spawning + 9 s cooldown at ×1 speed
  (wiki Gameplay). Tournament: 13 s spawning, cooldown halved (SDK
  `uptime/compute`). Wave Accelerator card shortens the cooldown (min 4 s at
  max), its mastery speeds up spawn-rate growth.
- **Game speed:** lab up to ×5, perk to ×6.25 — but "×5 behaves closer to ×4,
  6.25 closer to ×5" (wiki). Use the battle report's `GameTime` / `RealTime`
  ratio for the real figure. All in-run timers run on game time.
- **Spawning (SDK, v29):** the spawn timer ticks every **0.125 s**; each tick
  makes 3 gated basic-enemy attempts + a double-spawn roll — calibrated
  against a real save as **3.25 enemies per tick**. The master spawn gate
  (0–100) comes from the Wave Accelerator chart; each new wave adds
  `tier / 2.85` to the double-spawn chance. Functions:
  `expectedEnemiesPerWaveFromAccount`, `killsPerWaveFromSpawnContext`.
- **On-screen caps:** 120 normal, 10 bosses, elites 8 per type (+20 scatter
  splits), fleets 10 each + 30 escorts in their own pool since v28.3 (wiki).
  SDK states 150 total = 120 normal / 20 elite / 10 boss. Caps bound both
  damage-per-second and coins-per-wave.
- **Enemy level up:** every wave each enemy stat "levels up" unless an Enemy
  Level Skip fires (section 4).

## 2. Enemy stats

### Base health and damage per wave and tier
SDK `mechanics/waves/base-empirical-scaling.ts` + constants in
`scaling-regression-profile.ts` (structure from skye's toolkit):

```
health(w, t) = ⌊ M(w) × G(w) × (a·w^e + b·w + c) × P(t) ⌋
  M(w) = 1 + Σ kᵢ·⌊w / dᵢ⌋           12 banded terms (d = 5, 10, 25, 50, 60, 72, 83, 94, 100, 107, 200, 900)
  G(w) = Π rᵢ^⌊w / dᵢ⌋               growth chain (1.035 per 30 waves … 1.15 per 1024)
  campaign: a = 0.05, b = 0.8, c = 1.5, e = 2.13 + tier add-on
            (T10 +0.01, T11 +0.02, T12 +0.10, T13 +0.22, T14 +0.36, T15+ +0.51)
  P(t) = tier pressure: T1 1, T2 20, T3 60, T4 120, T5 240, T6 480, T7 960,
         T8 1920, T9 5760, T10 40320, T11 2.62e6, T12 1.57e9 … T21 4.97e30,
         then ×1200 per tier to T24.
```
Damage has the same shape with its **own** bands (7), chain, exponent
(2.007 + smaller add-ons), a tier attenuation divisor from T10, and extra
growth terms above T6. **Tournaments use different exponents** (and
×1.004 per wave, ×1.65 per 100 waves on health) — a different curve, not a
tweak. Both formulas step at band boundaries; don't smooth them.

Accuracy: one SDK file says these constants are the game's own, checked with
exact equality across 21 tiers × 34 waves × 8 contexts; another says "fitted,
close but not exact at extreme waves". **Confirmed exact on our account** at
T18 (see "Checked against the game") — more tiers and a tournament wave still
to check.

### Per-type multipliers (relative to the wave's basic enemy)

| Enemy | Health | Damage | Speed (wiki) | Coins (base) | Cash | Notes |
|---|---|---|---|---|---|---|
| Basic | ×1 | ×1 | ×1 | 1 (SDK) / 0 (wiki) | ×1 | |
| Fast | ×1 | ×1 | ×2.1 (→ ~×3.9 from w750) | 2 | ×1.5 | |
| Tank | ×5 | ×1 | ×0.6 | 4 | ×3 | |
| Ranged | ×1 | ×1 | ×1.2 | 2 | ×1.5 | shoots from range |
| Protector | ×0.6 | ×1 | ×0.4 | 3 | ×1.5 | enemies in its radius take ×0.6 damage and can't be insta-killed; thorns −60% in range; T2+; 1 per wave max with a cooldown of 10 waves (9 from T4, 8 from T7, 7 from T10); cap 10 (or 8) |
| Boss | ×20 | ×1 | ×0.4 (wiki) / ×0.3 (SDK, GV) | 5 | ×5 | every 10 waves T1–13; T14 9, T15 8, T16 7, T17 6, T18+ 5. T1–6 spawns at a fixed point of the wave, T7+ at a random 5–75% (GV). Immune to orbs (except Orb Boss Hit lab), death ray, shockwave, black hole. Drops: common module 2%, rare 0.5%, reroll shards 15% (before labs). |
| Vampire (elite) | ×2 | — | ×0.4 | 4 | ×3 | drains 2% of tower **max** health per second, can't be changed by perks/modifiers, disables tower regen and lifesteal (not wall regen) while draining |
| Ray (elite) | ×1 | ×2 | ×0.4 | 4 | ×3 | charges 30 s then fires; immune to knockback |
| Scatter (elite) | ×2 | ×1 | ×0.6 | 4 | ×3 | splits 4 times into 2 (1, ¼, 1/9, 1/16 of basic health); one split drops cells |
| Saboteur (fleet) | ×20 | 0 | ×2.1 | 4 | ×3 | each tower hit lowers a random UW 1 level (to 0 = disabled) until it dies; can't break the wall |
| Commander (fleet) | ×20 | — | ×0.2 | 4 | ×3 | pulses ×1.15 health/mass/speed to nearby enemies, max 8 stacks, not bosses (wiki; SDK says "2× aura") |
| Overcharge (fleet) | ×20 | ×1 locked to **wave 1** of the tier | ×0.2 | 4 | ×3 | returning projectile, ×1.4 per consecutive hit; fires once more on death |

Elites and fleets: immune to orbs, death ray, shockwave, black hole (fleets
also knockback and BH pull); fleets take 50% from CF / swamp stun / mine
stun, 85% thorns resistance (and thorns hit % of their *current* health).
Fleets attack slowly at wave 1, full rate from wave 4000.

**Shared rules** (wiki, SDK): each **melee** hit is 4% stronger than that
enemy's previous one (×1.04^hits; not ranged shots, ray or vampire). An enemy
alive 3+ waves after spawning loses **50% of its coin value**. Mass +4% per
wave alive (weakens knockback). Speed grows +0.03%/wave above wave 100 (cap
×12), mass +0.1%/wave above 4000 (SDK wave-panel constants).

**Enemy research labs:** −0.4% health or attack per level (30 levels, −12%)
for common/fast/tank/ranged/ray/vampire/scatter; boss and protector −0.3%/level
(−9%); protector damage reduction −0.3%/level (20 levels); fast speed
−0.4%/level; ranged range −0.5%/level; v29 fleet labs (Overcharge exponent
1.4 − 0.005·lvl, Commander radius, Saboteur speed).

### Enemy mix (which types spawn)
Not fully known. Normal spawn chances sum to 100% each wave and Basic is the
remainder; fast/tank/ranged chances grow with a tier weight table (SDK
`WAVE_INFO_TIER_SPAWN_WEIGHT_TABLE`, 1.04 … 8.89). The SDK's own notes say
the shipped composition table is wrong, and give one measured T21 round:
**basic 19.9%, fast 28.3%, tank 26.7%, ranged 25.2%** of kills. Battle
reports count kills per type, so the mix can be **calibrated per player**.

### Elite and fleet schedules
- **Elites:** chance per wave rises through bands 1, 4, 9, 16 … 100% (squares,
  shared by the 3 types; the game shows ⅓ of it per type). Single-elite
  bands open at waves 500/1000/1500/2000/3000 … 8000 on T1, ×0.9 per tier
  through T15; T16–24 is a separate block (also ×0.9 within it). A second
  elite per wave opens from wave 8000 on T1 (same pattern). Enemy Balance
  mastery adds double-spawn chance. SDK `eliteSpawnChanceAtWave`. Three cells
  (row 1, T22–24) are missing in the chart.
- **Fleets:** T14 first at w2495 then every 1000; T15 1495/750; T16 995/500;
  T17 495/250; T18 95/100; T19 45/50; T20 from w5 every 10 waves (1 fleet);
  T21 2 fleets; T22 2 (SDK) or 3 (wiki); T23–24 3. Lower tiers: from wave
  15000 on T1, 250 waves earlier per tier, then every 100 waves. Each fleet
  brings 10–15 escorts (Overcharge + Ranged, Commander + Tank, Saboteur + Fast).
  Wave Skip doesn't skip a fleet. Drops: 80% reroll shards (1080 at ≤T14 …
  2750 at T24), 5% each module-shard type (5 → 25 by spawn wave).

## 3. Tiers, battle conditions, tournaments

- **Coin multiplier by tier:** 1, 1.8, 2.6, 3.4, 4.2, 5, 5.8, 6.6, 7.5, 8.7,
  10.3, 12.2, 14.7, 17.6, 21.3, 25.2, 29.1, 33, 40, 48, 60, 72, 86, 103
  (T22–24 confirmed in game by the SDK author, v28.3).
- **Battle conditions from T14** (fixed per tier, wiki Tiers table): More
  Bosses, Orb / Death Ray / Thorns / Plasma Cannon resistance, ELS "Skip
  Reduction – Subtract" (2.5% at T14 → 42.5% at T24), Knockback resistance,
  Armored Enemies (blocks the first 10 → 95 hits), and the enemy "Ultimates"
  (Protector, Tank, Ray, Scatter, Vampire, Fast, Boss overheal, Mass
  Enforcement, Saboteur through-wall, Commander, Overcharge scaling) phasing in
  from T16–T24. Battle-condition labs reduce them. SDK
  `battle-conditions/config.ts` holds the per-tier set.
- **Overheat** (campaign, after clearing w4500 once): from wave 15000 on T1,
  250 earlier per tier, 10000 from T21 — Skip Decay 1%/wave and an extra
  fleet every 100 waves.
- **Tournament run length (2026-10-18):** the site's enemy health has the
  SDK's tournament branch (`baseEnemyHealth(…, tournament)`): body
  0.465·w^e + 5.84·w + 1.5, ×1.004 a wave, ×1.65 per hundred waves past 100.
  The SDK's two tournament exponents (2.308, 2.408) sit behind contradictory
  switch names; its code path gives a league tournament 2.408 — the code's
  choice, unconfirmed. Run Length keeps campaign and tournament deaths apart,
  and the Optimizer and What If measure waves against the deaths matching
  the chosen Battle Report (tournament, or the run's tier). Owner's report:
  a tournament run near W135 was shown +40 waves for one substat level,
  because waves came from campaign deaths near W8300.
- **Tournaments:** different scaling curve (above); league conditions and
  "heat" that ramps with wave (SDK `tournament-heat-bc.ts`); Legend adds Damage
  Decay / Health Decay from w1500 and More Elites from w2000.
- **Tournament battle conditions (checked 2026-10-18):**
  - Leagues (enemy scaling "tier +"): Copper T1+, Silver T3+, Gold T5+,
    Platinum T8+, Champion T12+, Legend T17+, Mythic T23+ (wiki, SDK).
  - **Fixed per league, in every tournament** (wiki Tiers page, "Tournament
    Overheat", v28):
    | League | More Bosses | Skip Reduction - Multiply | Skip Decay |
    |---|---|---|---|
    | Copper | every 10 waves | — | — |
    | Silver | every 9 | — | — |
    | Gold | every 8 | ×0.9 | 1% every 80 waves |
    | Platinum | every 7 | ×0.75 | 1% every 60 waves |
    | Champion | every 6 | ×0.6 | 1% every 40 waves |
    | Legend | every 5 | ×0.45 | 1% every 20 waves |
    | Mythic | every 4 (SDK) | ×0.3 (SDK, v29 game data) | not known |
    Legend also: More Fleets from W1000 (one every 100 waves), Damage Decay
    −35 levels / 10 waves and Health Decay −50 levels / 10 waves from W1500,
    More Elites from W2000 (one every 5 waves). From Platinum up, Death Defy
    Down or Energy Shields Down (one of the two) ramps like the others.
  - **Random conditions:** 1 a week in Silver … 5 in Legend, 6 in Mythic.
  - **Heat — how strong they are by wave:** "v26 BCs and Heat", a Google
    Sheet crowdsourced in game by the J Plays Discord (Cdcooper13, LTK,
    RichardSz, AshDs, Summer, Gorgar), linked from the Tower Knowledge Hub
    (the-tower.notion.site, "Battle Conditions & Heat Info by Tournament Wave
    Count"). Values step up at W0, 20, 40, 60, 80, 100, 150, 200 … 500, 600 …
    1000 and hold between steps; full strength at W1000. Champion and Legend
    share one ramp; Platinum's resistances, Armored Enemies, Enemy Speed and
    Enemy Attack Speed climb more gently (e.g. Orb Resistance at W100: 20%
    damage in Legend, 30% in Platinum). The full table is in
    `constants/tournamentData.ts`. Examples at W100 (Legend): UW Durations
    −3s, Boss's Ultimate +30%, Enemy Speed +90%, Armored Enemies 15 hits;
    at W1000: −10s, +100%, +198%, 100 hits.
  - **Cross-check:** TheTowerSDK's heat table (`TOURNAMENT_HEAT_WAVE_TABLE`,
    read from game code) has the same wave steps, and its two columns are
    exactly the sheet's Thorns Resistance for Legend and Platinum.
  - **Disagreements:** the SDK says Silver uses the gentler column and Gold
    and up the steep one; the sheet shows Platinum on the gentle ramp. The
    site follows the sheet (it was measured in game) — Silver and Gold use
    Platinum's ramp, Mythic Legend's: the code's assumption. The v26 sheet
    also has a ramping Enemy Level Skip condition (−1% → −33%); v28 replaced
    it with the fixed Multiply and Decay above, and the SDK finds no skip
    subtract in any v29 league. The wiki's older "ELS 10/20/30/50%" for
    Gold … Legend is from before v28.
  - **Skip Decay** reduces the chance by 1% every N waves, cumulatively. The
    SDK applies it as a multiplier (`applySkipDecay`: chance × (1 − 1%·steps));
    whether the game takes points off instead isn't confirmed. The site uses
    the SDK's form, averaged over the run.
  - **Battle-condition labs** weaken conditions: BC Reduction 2%/level (10
    levels), each condition's own lab 1%/level (Group 2: 20 levels; Groups
    3–4: 10), added together (SDK `getTotalBcModifierFraction`). The SDK gives
    Skip Reduction - Multiply no lab of its own, so only BC Reduction counts
    there.
  - **Enemy Speed** (Tower Knowledge Hub tip): it makes enemies reach their
    top speed sooner — around W800–900 instead of ~W1200 in a tournament.
    Read with the in-game text ("x% faster") and a speed cap, that's the same
    thing: x% faster until the cap. The site counts it as x% faster (time in
    range ÷ (1 + x)); the cap isn't known, so past ~W800 it counts too much.
  - **Fast's Ultimate (in-game card, owner, 2026-10-21):** "Level 5 — Fasts
    buff up to 1 nearby enemies to match their speed". The sheet has 1 at
    W0–W20, then 2, 2, 3 … 10 by W1000; that fits value = level ÷ 10 rounded
    up with the level 5 higher each heat step (5, 10 … 95) — the code's
    reading, one card seen. Slow enemies near a Fast come in at its speed —
    the owner sees it "most of the time" (2026-10-21). Counted in waves: a
    buffed enemy that ends runs gets speed ÷ Fast's speed of its usual time
    in range (Overcharge 0.2/2.1), buffed 1 − 0.4^x of the time (60% at up
    to 1, 94% at 3 — the code's estimate from that), weighted geometrically
    over the killer mix (`battleConditions.fastUltimateTime`). On the
    owner's tournament runs (half Overcharge, half Ranged) it costs about 21
    waves against a week without it.
  - The battle history doesn't record which conditions a run had (nor does
    29.1.3's export: `TournamentRecords` is empty on TTG's test file). The
    player ticks each run's on the Tournament page (store `tourneyLog`).
  - Per-run fields that measure what conditions act on (owner's tournament
    run, W135, Legend): `DestroyedByOrbs` 653 of 1242 enemies (53%),
    `DestroyedByDeathRay` 202 (16%), `ProjectilesCount` 104,329 (84 shots an
    enemy), and `TotalBasic` / `TotalFast` / `TotalTank` / … per type.
- **Tournament simulator (2026-10-18, Optimizer → Tournament,
  `engine/battleConditions.ts`, `engine/tournamentModel.ts`):** pick the
  league and the build used for tournaments (a site preset and module
  loadout); tick this week's random conditions. Each condition's strength
  comes from the heat table at the wave the run ends (settled: the
  conditions move the end, which moves their strength), less the player's
  labs (a resistance's labs weaken what it takes away: left = 100 − (100 −
  x)(1 − cut), from the SDK's modifier fraction). The model is calibrated on
  the newest tournament run under the conditions ticked for it; waves = the
  change in the push score from those to this week's, through the
  tournament deaths (`runWavesChange`, luck-averaged).
- **What each condition does (2026-10-20, all the code's model on top of
  the sources above):**
  - UW Durations: seconds off CF/GT/PS/BH through their duration bonus.
  - Boss's Ultimate: boss health, weighted by how often bosses end runs.
  - Enemy Speed: enemy speed × (1 + x) → time in range (see above).
  - Armored Enemies: an enemy ignores its first x hits, so x ÷ (hits it
    takes) of the flat damage on it is lost (at least 5% still lands). Hits
    it takes = the run's shots × bounces × (1 + CL chance × chains) ÷
    enemies, × the run-ending enemies' health against the average enemy's
    (bosses ×20, tanks ×5 …, weighted by how often each ends runs), × how
    much faster the tower hits now. More hits a second make it matter less.
  - More Enemies, Orb / Death Ray Resistance, Tank's and Basic's Ultimate:
    a "crowd" — how many enemies' worth single-target fire (tower shots,
    Chain Lightning, Smart Missiles) has to cover: + x% (More Enemies);
    + the run's orb (Death Ray) kill share × (1 − what's left) — the enemies
    they used to destroy keep the rest of their health; Tank's Ultimate gives
    tanks boss immunities (+ tanks' share × what orbs and Death Ray still
    destroy; their stop in range isn't counted); Basic's Ultimate turns basics
    into a fast, tank, ranged, boss or protector at x% each (wiki list) —
    their extra health over the average enemy's. Targeted fire ÷ crowd; area
    damage isn't shared.
  - Death Defy Down: points off the Death Defy chance (the code's reading —
    the sheet's 30% at W1000 is the workshop's most). Energy Shields Down:
    recharge × (1 + x), so shield saves ÷ (1 + x). Both shown as the killing
    hits a run survives (`runSavers.savedHits`); waves don't include saves.
  - Fast's Ultimate: see above (slow killers come in at Fast speed).
  - No effect on a Glass Cannon run (said on the page): Enemy Attack Speed,
    Thorns, Ranged's Ultimate (a hit ends the run or uses a save),
    Protector's Ultimate (Black Hole isn't in flat damage); Plasma Cannon
    and Knockback aren't modeled.
  - The league's fixed Skip Reduction and Skip Decay are in every
    tournament, so they don't move this week's end — but they shrink what a
    skip upgrade adds, which the Optimizer, What If and the module search
    count whenever a tournament run is the Battle Report
    (`GoalModels.conditions`, from the profile's league).

## 4. Enemy Level Skip (deterministic)

- What it is: Enemy Level Skip makes enemies weaker. Without it, enemy
  health (and attack) goes up one level every wave. Each time a level skip
  happens, that wave's increase is skipped, so every later enemy has less
  health (or attack) and the run goes further. It doesn't skip waves — that's
  Wave Skip, a different upgrade. Battle reports count both
  (`HealthLevelSkips`, `AttackLevelSkips`; `WavesSkipped`).
- Workshop 0.05%/level, 699 levels → 35%; lab +2%; relics +2%; module
  substats; Enemy Level Skips enhancement ×1.01 … ×1.6. Separate for Health
  and Attack.
- **Not random since v26:** a 50% chance skips exactly every other wave. The
  SDK models it as credit that accumulates each wave and redeems a skip when
  credit is **strictly > 1**.
- Order (SDK): sum sources → × enhancement → clamp 0..1 → − Skip Reduction
  (subtract) → × Skip Reduction (multiply) → − Skip Decay, each floored at 0.
- Wave Skip processes ELS once per skipped wave.
- Big level reductions have diminishing returns: up to 100 count in full,
  above that `400 − 300·e^(−⌊(n−100)/1500⌋)`, truncated (flat from 101 to 1599).

## 5. The tower — offense

Most of this already exists in `engine/` (eDPS, UWs — see
[ultimate-weapons.md](ultimate-weapons.md)). New or more exact from the SDK:
- **Workshop Damage closed form** (SDK `workshop/damage.ts`, checked against
  all 6001 table rows): `3 + 2.8L + 0.077L² + Σ cᵢ(L − Tᵢ)^pᵢ` over bands at
  L 999/1499/1999/2499/2999/3499/3999 (p 2.10 → 2.34, c 0.08 → 0.20). The
  Damage Decay battle condition subtracts levels before this. In-run levels
  above 6000 (free upgrades with Infinity Threshold): Health and Regen keep
  their level-6000 base × Damage(L)/Damage(6000). In the site since 2026-11-01
  (`calcWorkshopDamageBase`, anchors in calculations.test.ts); it used 1.054^L
  until then, 30 to 70 times too steep past Lv 1000.
- **Attack speed:** (workshop × lab × card + module substat) × enhancement;
  not linear shots/second — diminishing returns at medium speed and above 40.
- **Range:** soft-capped (`computeMaxDistance`); multishot uses the range
  stat, normal fire the drawn ring. Targeting priorities, bounce and
  multishot rules in `combat/multishot-bounce.ts`.
- **Orbs** instantly kill most normal enemies they touch (not bosses,
  elites, fleets; "Orb Resistance" BC turns that into % of health). Up to
  12 + 3 orbs; speed in rotations/minute.
- **Land mines:** chance per kill to drop (to 30%), damage % of tower damage
  using average crit — `LM% × dmg × (1 + CF·CC) × (1 + SCM·SCC·CC)`.
- **Thorns:** % of the enemy's max health when it hits the tower (wiki;
  bosses half; fleets 85% resist, current health) — the SDK calls it a share
  of the enemy's contact damage (see disagreements).
- **Lifesteal:** % of projectile damage dealt (to 4.46%), can't heal past max.

## 6. The tower — defense and survival

- **Damage taken, in order:** Chrono Field damage reduction → Chain Thunder →
  Flame Bot → Primordial Collapse → Negative Mass Projector → Defense %
  (linear, hard cap 98%) → what lands. Read from the battle reports' blocked
  lines (2026-11-01, `engine/damageLayers.ts`, evidence in
  [game-export-format.md](game-export-format.md)); the SDK has Defense % first,
  which the lines rule out. Where Defense Absolute sits is unread: its line is
  about 0 late.
- **Workshop curves:** Health Regen, recovery amount/max, orb speed closed
  forms in `workshop/defense-stats.ts`.
- **Recovery packages:** chance per wave (6% base → 30% workshop; up to 82%
  with lab 4%, card 33%, Ancestral substat 15%); each heals 14% → 134% of max
  health, and can overheal up to ×16.5 (Max Recovery). Applied on spawn.
- **Wall:** health 20% → 200% of tower health (+enhancement ×5, labs);
  rebuild 600 s base, −2 s/level, hard cap 150 s; pushes enemies out on
  rebuild; wall regen = % of tower regen; wall thorns; invincibility lab.
- **Death prevention is a chain, not independent chances:** Death Defy
  (0.4%/level → 30%, 40% cap all sources) → Energy Shield (card; fires on
  **any** hit, recharges) → Second Wind (card) → Demon Mode → Nuke (the last
  two only with their vault automation). Each fires only if nothing earlier did.
- **Vampire drain** ignores defenses' modifiers and switches off regen.

## 7. In-run progression

- **Cash:** start $80 (+$5/level Starting Cash lab, to $575). Enemy cash
  value $1, +$1 every 10 waves to wave 200, then +$1 every 20 waves; × type
  multiplier (table above). Cash/Wave from wave 2. Interest = (cash +
  CPW × cash bonus) × interest% after Cash/Wave; cap $50 → $15,000 (lab) →
  ×7 enhancement = $105,000/wave.
- **In-run upgrades:** workshop levels (coins) are where each stat starts;
  cash buys more levels during the run, reset after. **How much a player
  buys depends on how they play** (AFK vs active) — a modelling choice.
- **Free upgrades:** each wave, per Attack/Defense/Utility: 0.5%/level → 49.5%
  + card + perk + substats, × enhancement (to ×2); over 100% can give 2;
  never picks a maxed stat; rolls again for each skipped wave. Infinity
  Threshold (generator unique) adds 1000–4000 extra free-upgrade levels for
  Damage / Health / Regen. Checked on the owner's runs (2026-11-01): a long
  run's count is exactly the room its workshop leaves, in-run levels are the
  workshop's plus the free upgrades, and Range isn't filled while Black Hole
  Digestor is equipped, in a main or assist slot: its text says "Free
  Upgrades can not increase Tower Range" (wiki's Epic Module Unique Effect
  page; the owner, 2026-11-02; game-export-format.md, "Free upgrades"). Already in the scores:
  `engine/freeUpgrades.ts`.
- **Perks:** a pick every N waves: `N = trunc((base − Waves Required lab) ×
  (1 − 0.20 × perks × (1 + SPB/100)))`, base 200 → 250 after 20 perks, 300
  after 30, 350 after 40. Pools: 15 standard / 9 UW / 10 trade-off, drawn
  65/20/15%. Caps: 5 for most, 3 Bounce Shot & Wave Requirement, 2 Orbs, 1
  for UW and trade-off perks. Exact stacking/routing in SDK `perks/benefit.ts`.
  Which perks get taken depends on the player's Auto Pick ranking.
- **Wave Skip:** a skipped wave pays ×1.1 of the previous wave's coins, cash
  and cells (×1.1ⁿ for a chain), rolls free upgrades and ELS per skipped
  wave, and doesn't skip fleets.

## 8. Economy

Already modelled relative to a battle report in `engine/farming.ts`. The SDK
adds a per-wave simulator (`simulateWaveEconRows`): expected kills, coins,
cells and shards per wave from spawn yield, drop rates and coin multipliers,
including wave skip, Golden Combo (`goldenComboMultiplier`, float32 like the
game), interest, intro sprint, fetch, generator modules. Coin decay and the
type mix are the two things it says it doesn't fully capture.

## 9. What a battle report gives us (for calibration)

`BattleHistory` in the export keeps **the last 5 runs only**, ~150 run
totals each (no per-wave timeline). Useful ones: tier, wave, game/real
time, coins (by source: kills, waves, wave skip, Golden Combo/GT, BH, SL,
DW, orbs, crit coin, fetch), cash, interest, cells, shards, **kills per
type** (basic, fast, tank, ranged, boss, protector, vampire, ray, scatter,
saboteur, commander, overcharge), kills and damage per source, enemies hit
per source, **damage taken** (tower, wall, while berserked), **blocked** by
Defense %, Defense Absolute, CF, Chain Thunder, Flame Bot, Primordial
Collapse, NMP, **healing** (regen, wall regen, lifesteal, packages, Death
Wave), death defies / second winds / energy-shield absorbs / nukes / demon
modes, recovery packages, free upgrades (per category), upgrades bought,
**enemy health / attack levels skipped**, waves skipped, largest Golden
Combo / wave skip / ILM charge / SM stack, and `KilledBy` (code, meaning
unknown).

**Since 2026-10-17 the site keeps the history:** each import adds its runs
to the ones already stored (`mergeBattles`, same run = same tier, wave and
times; the fresh copy wins), every plain field of each run is kept in
`raw`, oldest → newest, newest 100 kept.

`KilledBy` = the enemy type that ended the run (owner). SDK save order:
0 Basic, 1 Fast, 2 Tank, 3 Boss, 4 Ranged, 5 Protector, 6 Vampire, 7 Scatter,
8 Scatter (split), 9 Ray, 10 Saboteur, 11 Commander, 12 Overcharge;
−1 / 99 / 255 = no killer (quit). 99 matches our wave-1 test runs; the rest
still need one run where the killer is known.

## 10. Gaps — not documented anywhere reachable

1. **How often enemies attack** (seconds between melee hits; ranged fire rate
   and range), **base movement speed** (m/s), **spawn distance** and tower
   size. Needed to turn "enemies alive" into "damage per second at the tower".
   Plan: fit one "incoming pressure" factor per player from the reports'
   damage-taken + blocked totals; or measure from a short ×1-speed recording.
2. **Enemy type mix** by wave/tier (only averages). Plan: calibrate from
   per-type kill counts.
3. **How a player spends cash in-run and which perks they take.**
4. ~~Exactness of the health/damage formula~~ — confirmed at T18; other
   tiers and tournaments still to check.
5. **Per-wave data** — reports are run totals; a run's shape (when damage
   taken rises) is invisible. Death wave + totals constrain it.
6. `KilledBy` codes.

## Proposed design (not built)

1. **Wave loop** (in a Web Worker): for each wave — enemy levels after ELS
   credit, spawn count by type (calibrated mix), boss / elite / fleet /
   protector schedule, battle conditions for the tier; tower stats after
   workshop + in-run levels + free upgrades + perks so far; UW uptime.
2. **Fight per wave:** time each type takes to die vs. the tower's eDPS
   (orbs / BH / DW / CL… by their real share, as `edps.ts` does), so enemies
   that survive pile up (caps), keep heating up, lose coin value; damage
   that reaches the tower goes through the defense stack, against regen,
   lifesteal, packages, wall; lethal hits go through the death-prevention
   chain. Death wave = first wave the tower can't survive.
3. **Economy per wave:** SDK-style coins / cells / shards, with coin decay
   and the calibrated mix.
4. **Calibration:** fit a few free factors (incoming pressure, effective
   damage, coin scale, enemy mix) so a chosen battle report is reproduced —
   death wave, damage taken / blocked, coins, kills per type.
5. **Backtest:** run every stored report through it and show the error
   (predicted vs. real death wave and coins) on the page.
6. **What-if:** apply an upgrade, re-run, show Δ waves and Δ coins per run;
   feed the optimizer.

## Needed from the owner

- **Wave Info screenshots** (tap the wave counter in a run): T18 W6000 done.
  Still useful: other waves on T18 (e.g. 100, 1000, 3000) for the spawn mix by
  wave, another tier, a tournament wave, and which trade-off perks were active
  (to pin the boss row).
- **More battle history:** the site now keeps every imported run; import
  after several runs (farming, pushing, tournament) until there are 15–30.
- **How runs are played:** mostly AFK (owner). Still useful: game speed used,
  Auto Pick perk ranking, which UWs are on auto.
- ~~A recording of the end of a push~~ — done (2026-10-19, above): any hit is
  lethal; the end comes in bursts after the wall breaks.
- **When Death Defy fires across a run:** in one push, open the in-run stats
  at a few waves (e.g. W4000, 6000, 7000, 8000, and after the first wall
  break) and note "Death defied", Energy Shield and Second Wind. That gives
  how often killing hits come and where — what Death Defy in waves needs.
- KilledBy: the W8898 run ended by **Tank** (end screen). After importing it,
  Run Length should show "Tank" for that run — that confirms the order on a
  fourth run.
- Decision: use `thetowersdk` as a pinned dependency (with credits on the
  site) or port its formulas.

## Disagreements to settle

| Topic | Says | Other source says |
|---|---|---|
| Basic enemy coins | 1 (SDK) | 0 (wiki table) |
| Tank speed | **×0.6 (wiki) — confirmed in game** | ×0.5 (SDK summary), ×0.336 (SDK wave-panel ratio) |
| Boss speed | ×0.4 (wiki) — in game 0.6 with a boss-speed perk, consistent | ×0.3 (SDK, GV) |
| Commander / Overcharge speed | **×0.2 (wiki) — confirmed** | 0.5× / 1× (SDK summary) |
| Protector damage cut | ×0.6 taken / "40% less" (wiki, SDK) | "60% reduced" (GV); **the panel shows 55%** on an account with some Protector DR lab — favours ~60% base |
| Protector cap | 10 (wiki Protector entry) | 8 (wiki Normal section, GV) |
| Commander buff | ×1.15 per pulse, 8 stacks (wiki) | "2× aura" (SDK summary) |
| T22 fleets per spawn | 3 (wiki) | 2 (SDK) |
| Thorns | % of enemy max health (wiki) | share of enemy contact damage (SDK) |
| Perk Wave Requirement | −25% (wiki table) | −20% (wiki worked example, SDK) |
| Energy Shield BC | longer recharge (wiki) | shorter duration (SDK lab text) |
| Wave base formula | **exact (SDK scaler) — confirmed** at T18 W6000 and W6196–6206 | fitted/approximate (SDK constants file) |
| Wave cycle | 26 s + cooldown (wiki, SDK) | **28.0 s measured** at ×1.0 with a 4 s cooldown (~7% faster) |
| Defense % among the damage layers | first (SDK) | **last, by the battle reports' blocked lines** (section 6) |
