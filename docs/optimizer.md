# Optimizer — how upgrades are scored

Reference for `engine/optimizer.ts` and the build models it calls. Verified
facts about the UWs themselves are in [ultimate-weapons.md](ultimate-weapons.md);
module effects in [module-effects.md](module-effects.md).

## Goals (2026-10-18)

The Optimizer asks what the player wants, and every panel ranks by it
(`OptGoal` in constants/optimizerConfig.ts, set up by
`engine/accountModels.ts → applyGoal`):

| Goal | Score | Builds |
|---|---|---|
| Push further (milestones, tournaments) | flat damage × e^(skipWorth × skip%) | Glass Cannon |
| More damage | calibrated eDPS | Glass Cannon |
| More coins | coins per hour (`farming.ts`) | all |
| Survive longer | survival (`ehp.ts`) × e^(worth × attack skip%) × the killers' attack labs; waves on the enemy-attack model (2026-10-23) | eHP, Farming |
| Coins and push together | coins^w × push^(1 − w), w on a slider (default 50%) | all (push = waves for GC, survival otherwise) |

- **Hybrid** (2026-10-23, `accountModels.effectiveBuild`): scored as the
  build its runs behave like — eHP when the recent deaths came from hits
  wearing the tower down (damage taken ≈ healing), Glass Cannon when single
  hits far past its healing ended them (`runLength.oneHitEnds`) or the runs
  don't say. The Optimizer says which, and it follows the runs as they
  change. The same reading drives What If, Run Length's default view, the
  Tournament page and Ask AI.
- The blend is a weighted geometric mean, so an upgrade that helps both
  halves beats one that helps only one at the same price; rows show both
  halves (`attachParts`). The code's assumption: a 1% coin gain and a 1%
  push gain count the same at 50%.
- Tournaments use the push ranking. Their battle conditions scale enemies
  the same for every upgrade, so the order holds — an assumption, not
  checked against tournament runs.

## Every currency (2026-10-18)

What each currency buys (wiki Currencies page) and how it's ranked:

| Currency | Ranked | Price source |
|---|---|---|
| Stones | UW stats, UW+, card mastery unlocks, assist modules — one path | wiki (see ultimate-weapons.md) |
| Coins | workshop (per coin), enhancements (per coin) | game table via TheTowerSDK; discount labs |
| Lab time | labs (per hour of research) | SDK lab catalog; Labs Speed, relic, Labs Coin Discount |
| Module Shards | module slot levels, 5 at a time (per shard; coins shown); each type's held shards and next 1,000 (below) | SDK module tables + wiki level 1; Module Shard/Coin Cost labs (1% a level) |
| Medals | bot stat and Bot+ levels vs Event Shop trades (per medal) | bots: 100 + 40 × (L − 1) a level (wiki bot Cost pages, every bot); Bot+: 100 + 50 × (L − 1), Echoing Shot 100 + 200 × (L − 1); trades 40, 65, 90, 130, 175, 230, then 380 |
| Gems | card slots: the best owned card not in the preset, into a free slot or the next one bought (per gem) | wiki Cards: 50 → 10,000 gems, 22 slots |
| Elite Cells | not a path: a table of lab boosts (×1.5 at 15/h … ×8 at 1M/h) and the extra lab hours per cell, on the top lab; the boosts the player's cells keep up are on the Labs page (below) | wiki Currencies, Lab Upgrades |
| Bits | Guardian chip stats, each equipped chip's next level (per Bit); which chips to equip (free to swap: every owned set that fits the slots, scored for the goal, 2026-10-23 `bestGuardianChips`) | wiki Chips tables and TheTowerSDK guardian upgrades — matched at every level (`constants/guardianData.ts`) |
| Keys, Guild Tokens | not ranked (Vault, Guild Store) | — |

- **Medal trades** are worth what 15 stones / 250 shards buy next on their own
  paths (`pathGain`), after the ones already held. Shards come in the type
  the player picks (wiki Currency/Shards), so a shard trade takes the type
  whose own path (`simulateShardPaths`) gains most after that type's held
  shards, and says which ("Event Shop — 250 Core Shards"); the trade price
  climbs with every shard trade, whatever the type (one Event Shop item).
  Prices reset each event; the path assumes one event. 150-gem trades aren't
  valued (gems have no single use to price them).
- **Module shards by type** (2026-10-28): each type's shards level only that
  type's slots (wiki Currency/Shards, Modules), so the Module Shards section
  opens with "Your module shards": per type, what the shards held add along
  that type's own path and what the next 1,000 would — the type to pick for
  Event Shop trades and the Vault's Daily Mission Shard Type (Vault 1610).
  The "Module slot levels" list below still ranks all four types together
  by gain per shard. On the owner's export (2026-10-28) the pick follows the
  goal: Cannon for damage (Core close behind), Generator for coins, Armor
  for survival; the four per-type paths take 25–50 ms, less than the pooled
  one.
- **Shard plan** (Modules → Shard plan, `engine/shardPlan.ts`, 2026-10-28):
  per type, the main and assist levels its saved shards should buy, judged
  by the type's main effect alone (primary × assist at Mult Efficiency), so
  it needs no goal. Levels go in order of gain per shard, looking up to 25
  levels ahead so a cheap level just under a step-up (100, 200) counts with
  the dear ones it opens; when the best next level is out of reach the plan
  saves for it instead of spending on a weaker one. Checked on the owner's
  export: Armor's assist at 1% Mult Efficiency gives a quarter of what the
  main slot does a shard, so the plan buys main 216 and keeps 9,711 shards
  for main 217 (89 short) rather than put 7,175 into the assist; Cannon and
  Core assists at 201 give about 1.7× the main slot's gain a shard. Spending
  everything at once would get within 1% of the best split there is (test
  with 300K shards), but order matters as shards come in. Levels past a
  module's rarity cap are flagged (Restore refunds all a slot cost — wiki
  Modules). Not valued: the sub-effect slots a level reveals (101, 141, 161,
  241 — `MODULE_EFFECT_SLOT_UNLOCK`).
- **Best levels for all a type's shards** (Shard plan, 2026-10-28): Restore
  puts a slot back to Lv 0 and gives back every shard and coin it cost, and
  the sub-effects a module revealed stay (the game keeps the highest level
  reached — wiki Modules, `MODULE_EFFECT_SLOT_UNLOCK`). So each card also
  splits every shard of the type — the ones in both slots' levels plus the
  ones saved — the best way there is: every main level the total reaches,
  the assist as high as the rest goes (exact; checked against every pair of
  levels in a test). It says which slot to Restore and the levels to buy
  back, and the coins it takes or gives back. **Checked on the owner's
  export:** for every type, shards in the levels (at today's prices, after
  the Module Shard Cost lab) + shards saved = shards earned in total
  (`Module…ShardsLifetime`) to within 27 — nothing else spends module
  shards, so the total is everything the player has. Owner's best splits:
  Armor 238 / 148 instead of 215 / 201 (+12.5% Tower Health on the plan —
  the assist runs at 1% Mult Efficiency), Cannon 213 / 210 (+2.95%), Core
  211 / 210 (+1.81%), Generator 224 / 194 (+0.43%). Assumption: Restore
  gives back what levels cost at today's prices (the totals above agree).
- **Bots**: only stats a model reads score — Amplify Bot (damage), Golden Bot
  (coins), and Bot Bot for whichever of the two runs: wiki, "increases the
  bonus of other bots in range", so without Amplify Bot it adds no tower damage
  (2026-11-01; the code used to add it anyway, from an old table). On coins it
  multiplies Golden Bot's Bonus over the share of its kills it overlaps, read
  from the run's `GoldenBotCoinsEarned` (game-export-format.md, Battle history);
  Bot Bot's uptime × range moves that share, the code's assumption. Flame and
  Thunder Bot aren't modeled, so
  their levels show no gain: battle reports record Flame Bot kills and hits
  and Thunder Bot stuns (TheTowerSDK's battle field list), but no bot
  damage, so there's no share of damage to calibrate them from; Thunder
  Bot's stuns would need a stun-uptime model in TTT. Flame Bot's Damage
  Reduction counts for survival since 2026-10-23 (below). Bot+ unlocks (1,250 stones each, once all five bots are owned) are in
  the stone path since 2026-10-23, scored by what the ability does at level
  0 — only Echoing Shot gains anything so far.
- **Bot+** (game v29, checked 2026-10-19): once all five bots are owned,
  each one's ability unlocks for 1,250 stones and then levels with medals —
  Wild Fire ×1.5 +0.1 to 20 levels, Titan Shock 5% +1% to 20, Bonus Cells
  ×1.25 +0.05 to 25, Echoing Shot 3 bullets +1 to 9, Maximum Power ×1.25
  +0.05 to 20 (level 0 = the unlock value). Level L costs 100 + 50 × (L − 1)
  medals, 100 + 200 × (L − 1) for Echoing Shot: 11,500 / 11,500 / 17,500 /
  8,100 / 11,500 to max. TheTowerSDK 0.12.0 (`data/bots`, the plus tier and
  `BOT_PLUS_*_V29`) and the "Total Medal Cost" rows of the wiki's bot pages
  agree on every number. Each preset keeps its own Bot+ level; the unlock is
  account-wide. Only Echoing Shot scores: "tower bullets within range count
  as N bullets", so tower shots × N — always on, like Amplify Bot's Bonus
  (the code's assumption). Not modeled: the wiki's 1/3 boost for Ultimate
  Weapon projectiles, and Maximum Power ("boosts the Bot+ abilities of other
  bots") — the SDK applies it to the part above 1, which isn't confirmed.
- **Card pulls** are random (80/17/3% by rarity), so stars aren't ranked;
  lab slots, rushes and tickets aren't either.
- Enhancement costs match every wiki level (the SDK prices up to 600 levels,
  the wiki and the site 400 — newer caps aren't confirmed).
- **Lab boosts** (Labs page, `engine/labBoosts.ts`, 2026-10-28): a boost
  is bought per lab slot for 1, 8 or 24 hours at a flat cells-an-hour rate
  (×1.5 15 … ×8 1,000,000; wiki Lab Upgrades and Currencies) and only ticks
  while the slot researches. Each step up costs more per unit of speed than
  the one below (30 cells an hour a unit for ×1 → ×1.5, 750,000 for ×7 →
  ×8), so the most research for the cells is every slot raised evenly, the
  lowest one step at a time — the wiki's "Most Efficient Speed Across 5
  Labs" table, which the ladder matches row for row (all 41, test). The plan
  is the highest even step the cells an hour keep up; spare cells run the
  next step's slot part of each day (24 × spare ÷ the step's extra cost),
  and the next three steps show how long the cells held last at each
  (held ÷ (cost − income)). Cells an hour come from the imported runs of
  the last 7 days: CellsEarned over RealTime, times the share of the time
  spent in a run — from the gaps between runs, as a run's BattleDate is
  when it **ended** (owner's export: each date is the one before plus the
  run's own RealTime, within a few minutes). Both can be typed over. Owner's
  export (2026-10-28): 30 runs, 203,653 cells an hour in a run, 91.6% of the
  time → 186,624 an hour → ×6 ×6 ×5 ×5 ×5 kept up (155,700) with the spare
  running a third ×6 about 15 hours a day; the owner runs ×6 ×6 ×6 ×5 ×5
  (203,800), which their 34.95M cells held keep going about 84 days. Lab
  times: a running lab's normal-speed time left (`labTimerLeft`) ÷ its boost
  — the fastest boosts on the labs with the most time left — and any lab's
  next level and the rest of it from the lab catalog after Labs Speed and
  the Lab Speed relic (`labLevelCost`). Lab slots: `LabsUnlocked` + 1 (see
  game-export-format.md).
- A lab's next level under way (`labProgress`, from the export's
  `ResearchPercentComplete`, checked against the timers: game-export-format.md):
  a part-done level costs only the time left everywhere times are shown, so it
  ranks higher per hour, marked "75% done". The level being researched right
  now isn't offered, since it's no longer a choice: the Optimizer offers the one
  after it, its gain from there and its full time. A stopped level keeps its
  coins, since stopping refunds them and restarting buys the lab again (owner,
  2026-10-31); a running one's are paid. The progress counts only for that
  level, so it stops counting once the lab's level changes.
- Dissonant Echo labs (`engine/dissonance.ts`; formula checked on the game's
  panel: game-export-format.md): each model multiplies its stat by Boost + Echo
  on the tier the chosen run was on, so the runs' calibration already holds
  today's boost and only the change counts. Attack on tower damage (and so the
  UWs built on it), UW on every UW's damage, Utility on kill coins, Defense on
  health, as TheTowerSDK's eDamage, eEcon and eHP have them; no screen shows
  this split, so it's the SDK's reading. A level adds (top − 1) × 0.5% × every
  other tier's share, so it's worth most on an account with many full tiers.
  On the owner's account (2026-10-31) they rank first for waves and coins and
  fourth for survival. In tournaments only Echo counts (owner, 2026-11-01), so a
  tournament run reads 1 + Echo over every tier. Ask AI's tier comparisons and
  Coins per Run's target tier count each tier's own boost.
- Module slot shards: SDK's table starts at level 2; the wiki's Modules/Cost
  gives level 1 as 7 shards + 10K coins, and its totals then match
  (3,136,095 shards to 300).
- Fixed 2026-10-18: the Critical Chance card counted even when not in the
  preset; like every card it now counts only while equipped.

## What If (2026-10-18)

`engine/whatIf.ts`, Optimizer → What If: any UW, UW+, workshop, lab,
enhancement, module slot or bot level set on a copy of the account. Each
score is calibrated on the account as it is (the chosen Battle Report) and
read on the copy: all damage, push (flat damage + skip), waves reached,
coins per run and per hour (Run Length, Coins per Run; GC), coin income at
the same wave, survival (not GC) — plus the cost in every currency.

- **Coins follow the run:** coins per run = Coins per Run's coins for a run
  to the new wave × the coin-bonus gain; coins per hour the same with its
  coins ÷ real time (later waves pay more per hour). "Coin income at the
  same wave" is the coin bonuses alone (`farming.coinRate`).
- **How it adds up** (`chain`): every link that moved — range, Chrono Field
  uptime, slow, Chrono Loop's extra path, time each enemy is in range; tower
  damage, attacks per second, crit multiplier; each damage source per enemy
  with its share of the run's damage; Smite procs (with CL+); level skip and
  the killers' health labs; each coin bonus's average factor
  (`farming.coinFactors`: 1 + coverage × (bonus − 1)).
- **Tournament mode (2026-10-20):** the build used for tournaments (site
  preset and module loadout, shared with the Tournament page) against the
  tournament deaths, calibrated on the newest tournament run under the
  conditions ticked for it (`GoalModels.calibConditions`) and scored under
  this week's (`conditions`, from where this week's run ends —
  `startWave`). A change that goes further meets stronger conditions
  (`conditionsAt`); where it ends is settled by halving
  (`tournamentModel.settleGain`: the gain only falls as the conditions
  climb, so repeating the read can swing back and forth). The chain reads
  time in range, tower and parts under those conditions and shows the hits
  armor lets through. No coins per run for tournaments.
- **What the waves show (2026-10-20):** "Waves gained" is the unrounded
  gain — the same number as a single change's own waves and the chain's
  sum (the wave reached is rounded). The chain reads the changes where runs
  end now; in a tournament, the stronger conditions further into the run
  are one link of their own ("Stronger battle conditions where the run now
  ends"), so an untouched source never shows a loss. Campaign mode always
  uses a campaign run: when the Optimizer's Battle Report is a tournament
  run, it falls back to the usual campaign run (Tournament mode is for
  tournaments).
- **Steps in the conditions (2026-10-20):** heat steps up at fixed waves
  (W100, 150, 200 …). A run that would cross a step it can't get over
  stops at it: settling keeps the furthest point the run is known to reach
  (`settleGain`, to a tenth of a wave) and the gain is capped there — never
  read past the step, where the stronger conditions would look like the
  upgrade's loss. "Push" is what the change itself does where runs end now;
  the waves also count the stronger conditions where the run then ends.
- **UW+ levels:** What If's UW+ levels run 1 … upMax + 1 (upLvl 0 …
  upMax), like the UW tab — Chrono Loop's top level is 14 (0.65 hidden
  slow). It stopped one short before 2026-10-20.
- **Why one level can buy more waves than the next:** enemy health rises
  in uneven steps (walls of 30–40% in one wave, then flat stretches), so a
  +10% damage step buys more waves where the next levels are flat. On the
  owner's T18 deaths (2026-10-20): +10% → 44 waves, +20% → 71, +40% → 104
  — smooth after the luck averaging, steeper first.

## Best module loadout — Tournament page (2026-10-18)

`engine/loadoutOptimizer.ts`, Optimizer → Tournament. Which owned modules
to equip, main and assist per type, for the most tournament waves (Glass
Cannon) or survival (other builds).

- **Calibrated on tournaments:** the newest tournament run is the Battle
  Report (its damage mix and run rates), and waves come from the tournament
  deaths on the tournament health curve (`runModels` with that run chosen),
  with the build used for tournaments (`engine/tournamentModel.ts`).
- **Search:** every owned module of a type is tried in the main slot and,
  once the slot is unlocked, the assist slot; one slot changes at a time and
  the best swap stays; up to 4 rounds, until nothing improves (coordinate
  ascent). A module can't sit in two slots. The score is `goalScore` — the
  same push score the Optimizer ranks by (flat damage × skip × killers'
  health labs), so main effects at the slot's level, substats at the assist
  slot's efficiency and the unique effects the model reads all count.
- **Waves:** the total gain goes through `pathRunGains` with the skip
  points the swap adds. Each swap is also shown on its own from the current
  loadout; swaps multiply, so those don't add up to the total.
- **What it can't see:** a module whose value is outside the push score
  (armor for Glass Cannon, coin modules) is never moved for waves.
  Battle conditions differ week to week and past tournaments mix them; the
  result is for an average week of the player's own tournaments.
- "Save as a loadout" adds (or replaces) a loadout named "Best for
  tournaments"; the equipped loadout doesn't change.
- **This week's conditions:** with conditions ticked on the page, the
  search scores under them at the heat of the wave the run ends
  (`OptimizerSnapshot.conditions`, applied in `getScore`; the calibration is
  built under the last tournament's ticked conditions in `applyGoal`), so a
  module that answers one — Chrono Field duration against shorter UWs — is
  worth more that week. A loadout that goes much further is re-read at the
  stronger heat there (settled by halving). See
  [run-simulation.md](run-simulation.md) §3.
- **Tournament Battle Report anywhere:** the league's fixed conditions
  (Skip Reduction - Multiply, Skip Decay; profile league) scale every skip point in the
  Optimizer (waves score, Enemy Health Level Skip panel), What If and the
  module search — in Legend a skip point adds ×0.45 of what it would on a
  campaign run.

## Guardian (2026-10-19)

`engine/guardian.ts`, Gear → Guardian. The chips the Guardian runs for a
preset (its Guardian preset via the game's global preset; slots = 1 +
bought) and what the counted ones do:
- **Scout** — while active (duration ÷ cooldown of the time), enemies
  count as Range Bonus × farther for Damage/Meter. Damage/Meter adds
  DPM × distance to tower damage (wiki: Damage × DPM% × range), so tower
  shots get 1 + DPM × d × (1 + uptime × (bonus − 1)), d = half the range
  (the code's assumption). Damage/Meter itself is now in the tower-shot
  part too, so its workshop, lab and enhancement levels score.
- **Bounty** — tags Targets enemies per cooldown, at most the non-Common
  ~80% of kills (T18 W6000 spawn mix); each pays × Multiplier: kill coins
  × (1 + tagged share × (Multiplier − 1)). Coins per tagged kill = an
  average kill (assumption).
- **Summon** — 2 enemies a second while active: kills × (1 + 2 × duration
  ÷ cooldown ÷ kills per second); each pays an average kill (assumption).
  Its Cash Bonus is in-run cash — not counted (AFK).
- **Fetch** — finds per second = find chance × (1 + double find) ÷
  cooldown. The run's fetched coins (`GuardianCoinsFetched`) are their own
  share of its coins and scale with finds; the loot (gems, medals, shards,
  modules) is shown per hour from the run.
- **Skins** — +0.6% coins each, always on (wiki).
- **Attack** (2026-10-20) — every cooldown it hits Targets of the most
  hurt enemies for Percentage of the health they've lost (half on bosses;
  wiki). The run's `GuardianDamage` (the Attack chip is the Guardian's
  only damage) is its share of the run's damage, scaled by Percentage ×
  Targets ÷ Cooldown and by the health its targets have lost, which the
  rest of the damage takes off: × the rest of the score for damage, × the
  flat sources for run length (it keeps pace with flat damage, so it
  counts with it). The code's assumption: its targets are about as hurt as
  in the run. Without Guardian damage in the chosen run, Attack can't be
  scored (the Guardian tab says so). In the owner's tournament runs it was
  0.01–0.04% of the damage, so its levels rank low there.
- **Ally** — not counted (coverage.md says why).

The Bits panel ranks each equipped chip's next stat level per Bit for the
goal; slots (200 / 300 Bits) and which chips to equip are left to the
player. What If takes the equipped chips' levels too.

## Chance mechanics and variance (2026-10-18)

Everything chance-based is counted at its average:
- Crit and super crit (crit multiplier), Chain Lightning chance and chains,
  Smite procs (≤ 100 per enemy), Consume.
- **Multishot, Bounce Shot, Rapid Fire** (`towerDamage.calcProjectileFactors`,
  added 2026-10-18): Chain Lightning procs "on enemy hit" (wiki), so
  every extra projectile hit is another chance for it; tower shots and
  Smite gain the same way. Expected values from the wiki's workshop values
  plus module substats:
  - Multishot: 1 + m(T − 1) projectiles per attack.
  - Bounce Shot: 1 + b + … + b^N hits per projectile.
  - Rapid Fire: ×(1 + 3U), uptime U = rAD/(1 + rAD).

  The code's assumptions:
  - Every extra projectile and bounce finds an enemy (a full field late in a push).
  - Each bounce rolls the chance again.
  - Rapid Fire doesn't re-trigger while it's active.
- Level skip is deterministic over a run; wave skip, Golden Combo and
  Gilded Sniper are averaged in the coin model.

Not valued yet — **Death Defy, Energy Shield, Second Wind, the wall, Nuke /
Demon Mode automation**. Their current levels are inside the death point
(Run Length is calibrated on real deaths), but raising them isn't scored.
How it would work: Death Defy ignores a killing hit with its chance, and
then Energy Shield, Second Wind and the rest take one each (wiki: Death Defy,
Activation Priority). So a run survives K/(1 − p) killing hits on average,
where K is the charges behind Death Defy + 1. The missing piece is how fast
killing hits pile up per wave near the end. Battle reports log Death Defy
procs, Energy Shield hits absorbed and Second Wind uses per run
(TheTowerSDK's battle field list); one end-of-run recording would give the
rate.

Variance: the waves are the average over the last 5 deaths, each averaged
over ±10% luck. What If shows each change's own waves and the spread
across those deaths (`runLength.wavesSpread`). It also says how far apart
the runs themselves ended, so a gain smaller than that is clearly something
seen over several runs. The breakdown splits the waves between the links
by the log of each part: flat damage (by what each source added), skip and
the killers' health labs. A change's own waves and its part of a combined
gain can differ, because changes work on each other.

## Every damage source in a run (2026-10-18)

Battle reports record more damage sources than the 11 the site parsed by name;
TheTowerSDK's run field list has Flame Bot, Death Ray, Spotlight, Electrons,
Guardian and Attack chip damage too. They're read from each run's stored
fields by the words in their names (`battleReport.extraDamage`), shown in the
Battle Report breakdown, Flame Bot is calibrated as flat damage and the
Guardian's damage as the Attack chip's (see edps.ts). The rest stay in the
fixed share. The same name matching reads
what saved each run (`runSavers`) and what it dropped (`runDrops`); the exact
export names aren't confirmed, so the pages show the field names they found.

## Damage is per enemy pass (2026-10-18)

Owner's point: Chrono Field+ deals no damage but makes everything else deal
more. Before this, only the cooldown UWs (SM, DW, ILM, PS, BH) gained from a
longer time to tower (their activations during an enemy's pass); Chain
Lightning and tower shots were per second, so CF, CF+, Slow Aura and range
did nothing for them. Now both scores (`edpsScore`, `edpsSurvivalScore`)
multiply Chain Lightning and tower shots by time in range ÷ the anchor's,
and Smite procs per enemy scale with CL chance² × chains × attacks per
second × time in range. The code's model, not checked in game: an enemy
takes damage for as long as it's in range, so a 31% slower enemy (Slow Aura
7★) takes 1 ÷ 0.69 = 1.45× the damage on its way in. Consequence to watch:
range and slows are now worth much more for pushing than before.

## Orbs and Death Ray against the enemies that end runs (2026-10-22)

The waves score (`edps.reachLog`, in `wavesScore` next to the killers'
health labs; What If line "Stopped by orbs and Death Ray") counts orbs and
Death Ray for runs that end to enemies they can touch.

- **Facts:** orbs destroy what they touch except bosses, elites, fleets and
  enemies a Protector shields (TheTowerSDK knowledge "orb", wiki Orbs).
  The owner's T18 W9,107 run (29.1.3 export): 1,387,746 enemies, 13.8k of
  them bosses and elites; `DestroyedByOrbs` 976,135 (70%),
  `DestroyedByChainLightning` 378,534, `OrbHits` 1,259,470 — about one orb
  hit per enemy orbs can touch. Orbs dealt 71% of the damage. The owner's
  Ranged enemies come within the orbs (owner, 2026-10-22). The owner's last
  five T18 deaths: Ray, Ray, Tank, Tank, Overcharge.
- **Model (the code's, not checked against runs yet):** an enemy orbs can
  touch gets past with chance e^−λ, λ = −ln(1 − share destroyed ÷ share
  touchable) from the run (capped at 95%), the same for Death Ray. λ grows
  with the time each enemy is in range (CF, CF+, Slow Aura; Fast's Ultimate
  against it); Orb / Death Ray Resistance makes a touch take x% of health,
  λ × x (against the run's); Tank's Ultimate makes tanks immune. A run that
  ends to a touchable enemy (Basic, Fast, Tank, Ranged; share w of the
  deaths) ends when enough get past: the pressure on the tower is how many
  get past × how long each lasts, so it counts as 1 ÷ (1 − w + w·L) more
  damage, L = the share getting past against the run's. Small changes: w ×
  fewer getting past; never more than 1 ÷ (1 − w) (runs then end to the
  other enemies).
- **Owner's account (2026-10-22):** CF+ 5 → 6 +60 waves (+20 of them this),
  5 → 8 +149 (+50), 5 → 14 +428 (+136: orbs stop 71% → 94% of what they
  can touch, time in range 13.2 s → 30.2 s); CL max +520; both +1,002.
  CF+ hasn't been upgraded since, so the jump isn't checked yet.
- **Orb count, speed and size (2026-10-23, `engine/orbs.ts`):** λ also
  grows with how often orbs pass an enemy, orbs × rotations a minute × Orb
  Size. Wiki Orbs page (read 2026-10-23): Orb Speed 0.4 + 0.15 a workshop
  level (0.55 at 1 … 6.10 at 38, rotations a minute), the Orb Speed lab +0.1
  a level (+2.0 at 20), the Orb Speed relic × (1 + its %), an armor's Orb
  Speed substat added; Orbs +1 a workshop level (4), the orb perk +1 a pick
  (2), an armor's Orbs substat; Orb Size enhancement ×1 + 0.01 a level (×3);
  the Extra Orb card one more orb at the workshop speed + its value, Extra
  Extra Orbs +1/+2 at −5% speed a level. The code's assumptions: the orb
  perk counts as taken (it isn't on the Perks tab yet), size and the extra
  orbs count like workshop orbs, the Vault's +2 orbs isn't counted (its save
  id isn't mapped).
- **eHP (2026-10-23):** the same touches decide how many enemies reach an
  eHP tower: reaching = (1 − touchable) + touchable·e^−λ, and survival ×
  reaching then ÷ reaching now (`ehp.orbReachRatio`).
- **Death Ray (2026-10-23):** its touches follow beam time (the card: 2.3–4.9 s
  by stars) × (1 + the Double Death Ray lab's 1% a level of a second beam,
  wiki Death Ray). Its mastery isn't counted.
- **Not counted yet:** per-type speed (tanks spend
  longer among the orbs than fast enemies), Sentry Protocol's mini orbs.

## What a newer account is offered (2026-10-26)

The owner's new MuMu account (Tier 1, best wave 26, 224 coins) was offered
Multishot, Rapid Fire, Damage Lab and a 0 → 400 Damage enhancement it can't
buy. `engine/unlocks.ts` now decides what's open, and the Optimizer (and
its skip panel) offers only that:
- **Workshop:** a stat's group must be bought (`UpgradeTierUnlocked`, import
  notes) — group 0 is free; a stat with levels is open.
- **Labs:** the Labs open at Tier 1, wave 30 (a milestone — TheTowerSDK's
  `data/milestones`), then each lab at its own milestone (the LABS table's
  tier/wave, compared with the best wave on that tier). Checked against the
  game's milestone lists, 25 labs' milestones in that table were wrong and
  fixed (gameData.ts LABS header). Inner Land Mine's Chrono Jump also needs
  Inner Land Mine. The Labs tab uses the same rule and says when the Labs
  open.
- **Enhancements:** need the Workshop Enhancement lab (Tier 12, wave 60).
- Nothing is hidden when it isn't known (an account typed in by hand: no
  tier waves, no workshop groups).
Each panel says what it leaves out (`lockedNotes`): the next workshop group
per section to buy in the game, the Labs' or Enhancements' milestone, and
why Stones, Modules (Tier 2, wave 90), Bots or the Guardian are empty. The
card slot step reads "Buy card slot N". Checked on that account's export in
the browser (desktop and 375 px) and on the owner's maxed one (nothing
left out there).

### A new UW or bot isn't ranked (2026-10-28)

The Ask AI test bench's early account (T5, only Golden Tower, no bots) got
"nothing worth buying" for its stones and medals: the stone path only
levels UWs already owned, the medal path only bots already owned. Valuing
an unlock was tried on the bench's made-up accounts by owning the UW (all
stats at Lv 1, and at Lv 6) or the bot (Lv 0) and scoring the goal:

- Chain Lightning, Smart Missiles, Death Wave, Inner Land Mines, Poison
  Swamp and Black Hole score **0%** for waves: their damage is calibrated
  from the run's damage share, and a UW never run with has none.
- **Spotlight** scores +92% at Lv 1 and +836% at Lv 6 (it multiplies the
  damage that *is* measured), Black Hole +195% for coins on the late
  account — far from what one new UW at Lv 1 does.
- The uncalibrated formula model (no run) gives Infinity on the early
  account (no damage UW to compare with) and 0% / +17% / +92% on the late
  one.
- Bots at Lv 0 score 0% for every goal (Golden Bot's coins and Amplify
  Bot's damage come from what they did in the run too).

So unlocks aren't scored: a ranking would put Spotlight first every time
and never Chain Lightning. Instead the Stones and Bots panels say so with
the price against what's held (`lockedNotes`, held stones and medals): "The
next costs 50 stones (you hold 160, enough for it)". UW unlock prices are
`UW_UNLOCK_COSTS` (checked in game); bot prices `BOT_UNLOCK_MEDALS` — 150,
300, 600, 900, 1,200 medals by bots owned, from the wiki's Currency page
(the owner confirmed they match the game, 2026-10-29). Ask AI reads the same notes. Ranking them would
need a separate estimate per UW and bot that doesn't come from the run.

Not a gap, though it looked like one on the bench's eHP account: Chrono
Field upgrades add survival only once the CF-Dmg Reduction lab is unlocked
(the game's rule; the Labs panel offers that lab), and Flame Bot's cut is
measured from the run's `FlameBotBlocked` (the made-up runs had none).

## Paths

- **Stone path** (`simulateStonePath`): UW stats, UW+, card mastery unlocks
  and assist modules ranked together by gain per stone — one shared stone
  pool. Greedy: buy the best, re-score, repeat.
- **Coin / research paths**:
  - Since 2026-10-18, for every build: workshop by gain per coin, from the
    game's cost table after the Workshop Discount lab (stats over 300
    levels move 10 levels a step); labs by gain per hour of research, since
    lab slots run out before coins do. The other currencies: see Every
    currency above.
  - Shown in blocks of 10 steps, one row per stat or lab in each, so
    one-level steps that take turns (Crit Chance, Crit Factor, Crit Chance…)
    read as "Crit Chance 40 → 45, Crit Factor 40 → 44".
- Paths skip anything worth under `GC_SCORING.minGainPct` (0.001%).

## Build scores (all relative: the player's current setup = 1)

- **Glass Cannon** — `engine/edps.ts`, calibrated by the chosen run's damage
  by source (imported battle history has it; pasted reports only if they
  include damage lines). Each source counts for its real share of damage:
  - CL, SM (+ Spotlight Missiles), DW, ILM, PS scale with their modeled
    eDPS, including core module UW damage, the Ultimate Damage relic,
    Spotlight and damage-taken effects;
  - Black Hole scales with its reach (holes × uptime × size × BH Damage lab)
    because it deals % of enemy health;
  - tower shots / rend / land mines scale with tower damage × crit × attack
    speed × Spotlight;
  - orbs, thorns and the rest are fixed — so on a farming run where orbs do
    ~88% of the damage, a +20% Chain Lightning upgrade is worth ~+2%;
  - Smite and Consume add a share of enemy health (total damage ≈ total
    enemy health): Smite at the run's proc rate, Consume on kills inside a
    Black Hole.
  Without damage data the old uncalibrated model is used (its absolute eDPS
  isn't meaningful; the tab says so).
- **Glass Cannon, ranked by waves** (Rank by → "How far runs get") —
  `edpsSurvivalScore`: only the flat-damage sources (CL, SM, DW, ILM, PS,
  tower shots), renormalised to their share of the run's damage; orbs, Black
  Hole and Consume deal a share of enemy health so they don't move the
  death wave. Smite does move it (2026-10-29, `smiteLog`): it reaches the
  bosses, elites and fleets that end runs, and its share of their health is
  flat damage they no longer need ([ultimate-weapons.md](ultimate-weapons.md)). Gains become waves and coins per run through Run Length and
  Coins per Run ([run-simulation.md](run-simulation.md)).
  - Enemy Health Level Skip (workshop stat and lab) is scored too: the skip
    chance counts as the flat damage that gains the same waves
    (`runLength.skipWorth`, score × e^(worth × skip%)). In the owner-like test
    runs (T18 ~W8300, 58% skip) one point of skip ≈ 205 waves ≈ +90% damage.
    That rate uses +50% damage, past the nearest health wall; the first +10%
    alone can buy more (53 waves there), which is why small probes mislead.
  - On the rows, a step's skip moves the death wave as skip (not as its
    damage equivalent), so the skip lab shows the same waves in the Labs
    panel as in the Enemy Health Level Skip panel.
  - Enemy health labs (2026-10-18): each type's lab (−0.4% health a level,
    −0.3% for Boss and Protector — values from Enemy Stats, which matches the
    in-game Wave Info panel) counts as that much more damage against its
    type, weighted by the share of the model's recent deaths that type
    caused (`killerMix`, from KilledBy): push × Π (1 ÷ health left)^share.
    The weighting is the code's assumption; runs without a recorded killer
    don't count, and with no killers the labs aren't scored. They're slow
    and costly per level (Ray Health Lv 1: 212.5q coins, 4d 12h), so they
    rank behind cheap labs until those are maxed.
- **Farming** — `engine/farming.ts`, calibrated by the run's coin breakdown
  and "killed with effect active" coverage. Golden Combo uses the wiki's
  compounding formula.
- **eHP** — `engine/ehp.ts`, calibrated by recovery packages and thorns
  kills; lifesteal and Death Wave healing at the chosen run's rate
  (2026-10-23 — they follow the tower's damage, so defense upgrades don't
  move them, but they dilute a regen upgrade; on eHP players' runs lifesteal
  was a fifth to a third of all healing). **Chrono Field, Flame Bot and
  Chain Thunder** (2026-10-23, reread 2026-11-01, `engine/damageLayers.ts`):
  the run shows what each cut — blocked ÷ what reached it, with Defense %
  last ([game-export-format.md](game-export-format.md)); against what the
  upgrade gives (Chrono Field lab × uptime; Flame Bot Damage Reduction 20%
  + 3% a level, the bot table; Chain Thunder 3% a lab level, at most 90%)
  that's the share of hits it covers, and a higher level cuts that share
  more. On the owner's T18 runs Chrono Field covers 72% of hits and Chain
  Thunder 75%, which made the next Chain Thunder level +2.8% survival, where
  the old reading (capped by CL's share of the damage) made it 0. **Defense %
  perks** count at 5 picks, but when a run's Defense % line falls a whole
  pick or more short, that many fewer (`defPicksShort`, the code's reading;
  not from a run whose damage never reached the tower's health pool). The
  Optimizer's Survival panel lists each cut as "What blocked the damage in
  this run".
  Not modeled: Slow Aura mastery (enemy attack speed).
- **eHP, in waves** (2026-10-23) — survival moves the death wave on the
  enemy-attack model (Run Length, `stat: 'attack'`; evidence in
  [run-simulation.md](run-simulation.md) "Run length, eHP"):
  - Enemy Attack Level Skip (workshop, lab, relic, module substat; the
    Enemy Level Skips enhancement multiplies it too) counts as the survival
    that gains the same waves: survival × e^(worth × attack skip%), worth =
    `skipWorth` on the attack model. On eHP players' saved runs one point
    was worth +14–24% survival (120–240 waves near W8000–9500), which puts
    the attack-skip workshop stat at the top of most eHP coin paths.
  - Enemy attack labs (−0.4% a level, −0.3% for Boss) of the types that
    ended the recent runs, by their share: × Π (1 ÷ attack left)^share. The
    code's assumption, like the health labs for Glass Cannon — every type
    hits an eHP tower, and the one that landed the last hit stands for them.
  - Rows show waves and coins per run (`pathRunGains`); Coins has an Enemy
    Attack Level Skip panel; What If shows waves reached, run-to-run spread
    and a Survival group in "How it adds up". Tournaments: no eHP waves (the
    tournament attack curve isn't known).

## Stone rules (verified)

- **Card mastery**: stones only unlock a mastery, at its level-0 value; levels
  1–9 come from that card's lab (1.1q → 10q coins, 20 → 104 days each). The
  optimizer offers unlocks only, never re-buys. Unlock costs (Notion Card
  Mastery page): 500 Cash / Free Upgrades; 750 Damage, Attack Speed, Health,
  Health Regen, Range, Critical Chance, Fortress, Extra Orb, Death Ray,
  Energy Net, Berserker, Ultimate Crit, Nuke; 1000 Slow Aura, Enemy Balance,
  Extra Defense, Critical Coin, Wave Skip, Land Mine Stun, Recovery Package
  Chance, Super Tower, Second Wind, Demon Mode, Energy Shield, Wave
  Accelerator; 1250 Coins, Plasma Cannon, Intro Sprint. (Cells and Area of
  Effect aren't on that page.) Land Mine Stun mastery is 2.7% per level.
- **Assist modules** (Fandom Modules page + player): unlock 1000, then
  Legendary 1000, Mythic 1200, Ancestral 1400 (4,600). Efficiency starts at
  1%; the k-th stone level costs 15 + 3k.
  - Main Effect: stones to 100% (16,038 stones), Assist Mult lab +30% → 130%.
  - Substats: stones to 70% (8,073 stones), Assist Substat lab +30% → 100%.
  - An assist module's main effect counts as 1 + (×value − 1) × efficiency
    (multiplicative since v27.1). Hard caps still apply (98% defense, 90% CF
    slow, 150s wall rebuild, 7s shockwave, 37s ILM cooldown).
  - Its substats count at Substat Efficiency (value × eff%). A Generator
    assist with Enemy HP Level Skip adds 1% of that substat per 1% of
    efficiency (8% Ancestral → +0.08 skip points), and since 2026-10-23 the
    step carries those points (`skipPoints`) so its waves count them as
    skip, like the workshop's Enemy HP Level Skip. Skip is worth far more on
    long campaign runs than in tournaments (owner's account: e^0.54 a point
    at W9,000, e^0.055 at W100), so this slot leads the stone path for
    campaign pushing and drops out for tournaments.
- **Primary modules** run at 100%. The labs added in the latest update
  (unlocked T23 W500, one per type, +1%/level, 30 levels) take them to 130%:
  1 + (×value − 1) × (1 + lab%). Site names `Primary-<Type> Mult`; their game
  lab numbers aren't known yet.
- UW stat / UW+ costs: see [ultimate-weapons.md](ultimate-weapons.md).

## Workshop and lab costs (checked 2026-10-18)

Source: TheTowerSDK 0.12.0 (MIT, npm `thetowersdk`) — `data/workshop/table.json`
(the game's own workshop table: value, cash and coins at every level) and
`data/labs/catalog.data.js` (every lab's coins and time per level, which its
author checks against the community Effective Paths sheet). Generated into
`constants/workshopCosts.ts` and `constants/labCosts.ts` by
`npm run upgrade-costs -- <unpacked package>` (scripts/upgrade-costs.mjs).

- **Workshop vs the wiki** (every row of every Fandom cost page): 46 of 48
  stats match level for level (cost of level L = table entry L − 1; e.g.
  Super Crit Chance 50K at Lv 1, 355.49B at Lv 100; Damage 5.10T at Lv 6000,
  816.09T in all; Enemy Health Level Skip 3.72B to Lv 10). Two don't:
  - Rend Armor Mult: the wiki's table is a row-for-row copy of Rend Armor
    Chance's. The game table's Mult costs run up to ~30× higher late
    (Lv 299: 595q vs the wiki's 19.83q). We use the game table — unconfirmed
    in game.
  - Wall Health: the game table costs more from Lv 100 on (Lv 100: 56.4M vs
    31.91M; Lv 1800: 108T vs 23.48T). The eHP model still uses the wiki's
    curve (`WS_WALL_HEALTH`); Glass Cannon doesn't score walls. One in-game
    price would settle which is right.
- **Labs vs the wiki** (2,695 rows): times match everywhere except Death Wave
  Armor Stripping (wiki "10d 10h 52m", catalog "10:53:00" — one of them
  dropped the days). Costs match except single-row differences in Battle
  Condition Reduction, Cash Bonus, Double Death Ray, Labs Coin Discount,
  Protector Health/Radius, Recovery Package Max, Super Crit Chance (Lv 31:
  8.77B vs 8.70B) and Super Tower Bonus. We use the catalog. Max levels
  differ for Swamp Rend – Additional Enemies (site 11, catalog 9; levels
  10–11 have no price, so they're never recommended).
- **Discounts** (wiki lab pages): Workshop Attack/Defense/Utility Discount
  0.5% a level (49.5% at 99); Labs Coin Discount 0.3% a level (29.7% at 99);
  Enhancement Coin Discount 0.3% a level (30% at 100); Labs Speed ×(1 + 2% a
  level), times the Lab Speed relic, but not for its own research (the
  relic does count there). Gem speed-ups and the Vault's enhancement
  discount aren't counted.

## Battle history facts used for calibration

- `EnemiesHitBy…ThisRound` counts each enemy once (a run with 11M shots had
  662k enemies hit by projectiles).
- T18 ~W8600 farming run (39h game time): orbs 88% of damage, CL 9%, BH 2.4%;
  Golden Combo 47.5% of coins; 98% of kills inside a Black Hole; CL hits per
  enemy reached ≈ 15, smites ≈ 4.5.
