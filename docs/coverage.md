# What the site models — and what's missing

The whole game, system by system, against what TowerForge models (written 2026-10-18; rows updated as systems are added, last reviewed 2026-10-23).
✅ modeled · ◐ partly · ✗ not yet. "Calibrated" means the player's own battle
reports set the baseline, so even unmodeled effects are already in it; only
*changing* them isn't valued. Details of each model: [optimizer.md](optimizer.md),
[run-simulation.md](run-simulation.md), [ultimate-weapons.md](ultimate-weapons.md),
[module-effects.md](module-effects.md).

## Damage

| System | Status | Notes |
|---|---|---|
| Tower damage, attack speed, crit, super crit, Damage/Meter, range | ✅ | towerDamage.ts; workshop, labs, cards, masteries, enhancements, relics, modules. Damage/Meter on tower shots since 2026-10-19 (1 + DPM × distance, shots at half the range on average — the code's assumption); before that it only fed Spotlight+ |
| Multishot, Bounce Shot, Rapid Fire | ✅ | Averages (2026-10-18); give Chain Lightning, tower shots and Smite more hits |
| Rend Armor | ◐ | In the tower-shots share; Rend chance/mult upgrades aren't modeled on their own. Not worth it yet: on the site's saved runs (2026-10-23, 278 runs past W1000) Rend dealt a median 0.02% of Glass Cannon damage (most 0.4%), tower shots under 1.5% — its upgrades wouldn't move a ranking. Wiki: chance 0.1% a level (30%), +0.001× a stack (0.3×), stacks to 800% (Rend Armor Max lab to 1550%), the enhancement multiplies all three to ×5 |
| All 9 UWs + UW+ | ✅ | uwdps.ts; Golden Tower for coins only |
| Flame Bot | ✅ | From the run's FlameBotDamage (2026-10-18): ×Damage × tower damage × crits ÷ cooldown; burn stacks and Wild Fire (Bot+) not modeled. Its Damage Reduction counts for eHP survival (2026-10-23), by the share of hits the run shows it covering |
| Amplify Bot, Bot Bot | ✅ | Tower damage multiplier; Bot Bot only with Amplify Bot running (2026-11-01). Bot Bot on Golden Bot's coins: see Economy |
| Echoing Shot (Amplify Bot+) | ◐ | Its 1,250-stone unlock is in the stone path (2026-10-23). Since 2026-10-19: tower shots × the bullets each counts as (3 + level, up to 12), always on like Amplify Bot's Bonus (uptime and range aren't modeled). The wiki's 1/3 boost for UW projectiles isn't modeled |
| Bonus Cells (Golden Bot+) | ◐ | For the More Elite Cells goal and What If's cells (2026-11-02, cells.ts): ×1.25 … ×2.50 (wiki) on the run's share of kills in Golden Bot's range, which follows its uptime × range. That elites die there as often as other enemies is the code's assumption; Maximum Power on it isn't counted |
| Other Bot+ abilities: Wild Fire, Titan Shock, Maximum Power | ✗ | Levels entered or imported (v29 tables, 2026-10-19) but not valued: Wild Fire's Enflamed bonus lasts by Flame Bot damage, Titan Shock needs enemy attack speed, and how Maximum Power boosts the other abilities (whole value or the part above 1) isn't confirmed |
| Death Ray card | ◐ | Read from runs and shown; kills what it touches (not bosses or protected enemies), so it isn't flat damage. Since 2026-10-23 its touches follow beam time (card stars) × (1 + Double Death Ray chance, 1% a lab level — wiki), for Glass Cannon waves and for eHP (fewer enemies reach the tower). Its mastery isn't counted (effect not documented) |
| Guardian Attack chip | ◐ | From the run's GuardianDamage (2026-10-20): scales with Percentage × Targets ÷ Cooldown and with the health the rest of the damage takes off (it hits a share of lost health), so it counts for damage and run length. Assumes its targets are about as hurt as in the run; the boss half-damage mix stays as in the run |
| Electrons, Spotlight damage | ◐ | Read from runs and shown, kept fixed |
| Guardian (2026-10-19) | ◐ | Gear → Guardian; imported from the export (chips, presets, slots, skins). Scout → tower shots through Damage/Meter; Attack → its share of the run's damage (row above); Bounty, Summon → kill coins; Fetch → its coins and loot by finds per second; skins +0.6% coins each. Ally (overheal past Max Recovery) not counted — how it combines with the usual cap isn't confirmed |
| Orbs, thorns, land mines | ◐ | Fixed share for damage; orbs and thorns modeled for coins / survival. Waves (2026-10-22): orbs and Death Ray stopping more of the run-ending enemies they can touch (Tank, Ranged…) as enemies stay in range longer; orb count, speed and size since 2026-10-23 (orbs.ts, wiki values), for eHP too (fewer enemies reach the tower). Vault Orbs (Power, +1/+2) and Sentry Protocol not counted |
| Demon Mode, Plasma Cannon, Berserker, Super Tower | ◐ | Berserker and Super Tower in the model; Demon Mode and Plasma Cannon aren't |
| Protectors' damage reduction (55%) | ◐ | Inside the calibration; the Protector labs aren't valued |

## How long enemies are in range (time to tower)

| System | Status | Notes |
|---|---|---|
| Range, Chrono Field slow and uptime, Chrono Loop (CF+), Slow Aura | ✅ | ttt.ts; every source counts per enemy pass (2026-10-18) |
| Thunder Bot stun and linger | ✗ | Wiki: stun on a cooldown, half as effective on bosses and elites, linger slow after. Needs where the bot sits and how its area meets the tower's range |
| Poison Swamp / Inner Land Mine / Land Mine stuns, Energy Net | ✗ | Stuns weaken on the same enemy ("stun debt", TheTowerSDK); needs in-game timings |
| Knockback, Shockwave | ✗ | Push = force ÷ enemy mass, and mass grows with waves (wiki, SDK); weak on late-wave elites, but unmeasured |

## Enemies and how far a run gets

| System | Status | Notes |
|---|---|---|
| Health/damage per wave and tier, elites, fleets, bosses, speeds | ✅ | enemyStats.ts — matches the in-game Wave Info panel at T18 |
| Enemy Level Skip (health and attack) | ✅ | levelSkip.ts; workshop (at the level free upgrades take it to), lab, enhancement, relic, substats |
| Enemy health labs | ✅ | By how often each type ends your runs (KilledBy) |
| Enemy mix of normal types | ◐ | Not confirmed; doesn't change the push ranking |
| Run length (Glass Cannon) | ✅ | runLength.ts — your last 5 deaths, luck-averaged, with the spread shown |
| Run length for tanky builds | ✅ | eHP (2026-10-23): runs end where enemy attack outgrows survival — Run Length's eHP view, waves on the Optimizer's survival rows and in What If, Enemy Attack Level Skip and enemy attack labs scored. Checked on eHP players' saved runs (run-simulation.md); campaign only, and runs that end to single huge hits are flagged as Glass Cannon-like |
| Death Defy, Energy Shield, Second Wind, Demon Mode / Nuke automation | ◐ | Counts read from each run ("Saved by", 2026-10-18); Death Defy valued as killing hits survived (exact chance math), not yet as waves. A recording of a push's end (2026-10-19) showed the last hits come in bursts once the wall breaks, so Death Defy's waves come from earlier leaks — needs when in a run it fires |
| Wall | ◐ | eHP only. For Glass Cannon at the end of a push the wall blocks one hit per rebuild (any hit is lethal, ~1e21 vs ~3e14 health — recording 2026-10-19), so Wall Rebuild matters and Wall Health doesn't; not modeled yet |
| Tournaments and battle conditions | ◐ | Tournament waves from your tournament deaths on the tournament health curve; Tournament page: every condition's strength by wave (heat) and each league's fixed conditions. In waves (2026-10-20): UW Durations, Boss's Ultimate, Enemy Speed, Armored Enemies, More Enemies, Orb / Death Ray Resistance, Tank's, Basic's and Fast's Ultimate, Skip Reduction, Skip Decay; Death Defy Down and Energy Shields Down as killing hits survived; the rest have no effect on a Glass Cannon run (why on the page). Each run's conditions ticked once and kept (the export doesn't record them); the build used for tournaments; best module loadout for the week; no coins per run for tournaments. Tournaments → History (2026-10-21): every tournament from the export's TournamentRecords — waves and rank over time by league, league moves, per-league numbers. Model details: run-simulation.md §3 |
| Dissonant Boosts | ◐ | Imported and shown on Tiers (2026-10-31), formula checked on the game's panel (game-export-format.md). The Echo labs are valued on damage, UW damage, coins and health; comparing tiers counts each tier's own boost; Dissonant Runs stay out of calibration; in tournaments only Echo counts (owner, 2026-11-01). Which run to play next isn't ranked; the panel shows what filling the farm tier's track to W5,000 gives |

## Economy

| System | Status | Notes |
|---|---|---|
| Coins per kill and wave, tier multiplier, Golden Tower / Combo, Black Hole, Spotlight, Death Wave, Golden Bot coin bonuses, Wave Skip, Critical Coin | ✅ | farming.ts + runCoins.ts, calibrated on your runs. Checked against the game's coin lines (2026-11-01): within 1% on Golden Tower, Black Hole, Spotlight and Death Wave, 5% on Orbs. Golden Bot now counts Bot Bot, overlap read from the run |
| Coins per run and per hour as runs get longer | ✅ | Coins per Run projection |
| Cells, gems, medals, reroll and module shards per run | ◐ | Read from your runs (2026-10-18, Coins per Run page). Elite cells in What If (2026-10-23, cells.ts): the run's cells per elite = (k × Cells/Kill Bonus + Cells card) × card mastery (wiki Currencies), so the enhancement, card and mastery lab move the right part, at the same waves. Golden Bot+ Bonus Cells too since 2026-11-02, on the elites in Golden Bot's range. The DW cell lab stays in k (not valued). The same sum is the Optimizer's "More Elite Cells" goal (2026-11-01), at the same waves |
| Guardian fetch | ✅ | In the run drops; its coins are a separate share of the run's coins, scaled by the Fetch chip's finds per second |
| Free upgrades in a run | ✅ | Since 2026-11-01 (freeUpgrades.ts): scores read the levels a run reaches, from the chosen run's free upgrade counts, so workshop rows on stats they fill gain next to nothing. Checked against the room each owner's workshop leaves (game-export-format.md). Rolls shared evenly among stats with room is the code's assumption. The Free Upgrade stats themselves aren't valued, and locks (`UpgradesLockedFreeUpgrades`) aren't read |
| In-run cash, interest, perks picked in a run | ✗ | The site assumes AFK runs; the calibration includes what you usually pick |

## Spending

| Currency | Status | Notes |
|---|---|---|
| Coins: workshop, enhancements | ✅ | Game cost tables, discount labs |
| Lab time | ✅ | Per hour of research; lab speed and relic; a part-done level costs the time left, and the level being researched isn't offered (2026-10-31) |
| Stones: UWs, UW+, masteries, assist modules | ✅ | Bot+ (1,250 stones) not offered |
| Medals: bots, Bot+, Event Shop trades | ✅ | Bots and Bot+ levels (to v29's 20–25, 2026-10-19) only where a model reads the stat — Echoing Shot among the Bot+ abilities |
| Module Shards: slot levels | ✅ | Shard cost lab; level caps by rarity. Each type's shards on its own slots: Modules → Shard plan (main vs assist, what to save for, and the best levels for every shard of the type — Restore gives them back) and the Optimizer's per-type value for Event Shop trades and the Vault's daily-mission pick (2026-10-28). Sub-effect slots that levels reveal aren't valued |
| Gems: card slots | ✅ | Card pulls random; lab slots and rushes not ranked |
| Elite Cells: lab boosts | ✅ | Labs page (2026-10-28): cells an hour and time in a run from the last 7 days of runs, the even boosts they keep up on every lab slot (the wiki's table), spare cells, how long the cells held last at higher steps, and each running lab's finish at its boost; any lab's next level and the rest of it at each speed. The Optimizer's table stays. Which labs deserve the faster boosts isn't weighed by value — the longest ones get them |
| Bits: Guardian chips | ✅ | Optimizer Bits panel: each equipped chip's next level per Bit (wiki and SDK tables; 2026-10-19). Which chips to equip: every owned set that fits the slots, scored for the goal (2026-10-23; swapping is free). Slots aren't ranked |
| Unlock progress (what a newer account can buy) | ✅ | Workshop groups bought, the Labs (T1 W30) and each lab's milestone, enhancements (Workshop Enhancement lab): the Optimizer offers only what's open and says what it leaves out (engine/unlocks.ts, 2026-10-26). A new UW or bot isn't ranked (the models measure each from the player's runs): the Stones and Bots panels give the next one's price against what's held instead (2026-10-28, docs/optimizer.md). Card masteries wait for Tier 16, wave 100 (2026-11-02). Card slots only offer cards you own, so a card's own milestone can't matter there; the Cards tab counts the ones still to unlock. The wiki's Cards page has the Cells card at Tier 4, wave 40, but TheTowerSDK's milestone tracks have only 25 Gems there, so the site keeps Cells open until a player's milestone screen settles it |
| Keys (Vault), Guild Tokens | ◐ | The whole Vault on Upgrades → Vault (2026-10-25): Harmony, Power and Enemy, every upgrade's effect and key costs, the levels and unlocked sections imported and editable, keys spent and left — costs checked against the owner's TotalKeysSpent. Counted in the models: Bot Range (bots) and Additional Card Slot (card slots). **Not counted yet:** the Power tab's stat bonuses (damage, health, UW damage, coins…) and the Enemy tab's weaker enemies — how each combines with the workshop, labs and relics needs one in-game stat checked per kind |

## What it would take to close the biggest gaps

1. **Death Defy in waves:** when in a run it fires. The end-of-push
   recording (2026-10-19) showed the last hits come in bursts after the wall
   breaks — saves there buy seconds — so what's needed is the in-run stats
   ("Death defied") at a few waves of one push.
2. **Stuns and knockback:** the wave an elite gets stunned or pushed, and
   for how long or how far, at your waves (a short recording).
3. **Cells from upgrades:** the Cells/Kill Bonus enhancement, the Cells card
   and Golden Bot+ Bonus Cells are valued (the More Elite Cells goal). The
   Death Wave cell lab needs its share of a run's cells, which runs don't
   record.
4. **Vault:** in-game values for the trees you own. Guardian: how Ally's Max Recovery combines with the usual overheal cap, and two runs at different Attack levels to check that its damage follows Percentage × Targets ÷ Cooldown.
