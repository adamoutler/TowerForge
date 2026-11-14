# Ultimate Weapons — verified mechanics

What the site's UW math is based on, checked against the game wiki (2026-10-16)
and a real account's battle history. Each UW lists what was verified, how the
model uses it, and what isn't modeled. Code: `engine/uwdps.ts` (damage),
`engine/ttt.ts` (Chrono Field, time-to-tower), `engine/edps.ts` (calibrated
Glass Cannon score), `engine/farming.ts` (coins), `constants/gameData.ts`
(tables). Tests: `engine/uwdps.test.ts`, `engine/calculations.test.ts`,
`engine/optimizer.test.ts`.

**Sources** — Fandom wiki pages `the-tower-idle-tower-defense.fandom.com/wiki/<Name>`
(Chain_Lightning, Smart_Missiles, Death_Wave, Chrono_Field, Inner_Land_Mines,
Golden_Tower, Poison_Swamp, Black_Hole, Spotlight, Slow_Aura, Modules,
Sub-Module_Effects) and the Tower Knowledge Hub
(`the-tower.notion.site`: Ultimate Weapons, Golden Combo (GT+), Card Mastery,
Assist Modules, Game Versions). Fandom blocks plain fetches (HTTP 402) and
Notion renders client-side, so both were read in a browser: on a fandom tab,
`fetch('/wiki/<Name>')` + `DOMParser` reads any page's tables.

## All UWs

- **Stat values and stone costs**: all 27 stats match the wiki level for
  level (`UW_STAT_VALUES`, `UW_STONE_COSTS`). The game added levels in 2025:
  Smart Missiles / Inner Land Mines / Poison Swamp Damage go to Lv 36,
  Spotlight Bonus to Lv 31, Spotlight Angle to Lv 61 (90°). Level 1 is free;
  reaching level L costs `costs[L − 2]`.
- **UW unlock costs** (by how many you own, Notion): 5, 50, 150, 300, 800,
  1250, 1750, 2400, 3000.
- **UW+ unlock costs** (global sequence, from the code — not on the wiki
  pages read; the 4th = 975 matched a real account): 500, 625, 750, 975,
  1250, 1650, 2200, 2900, 3800. UW+ only unlocks once all 9 UWs are owned.
- **UW+ level costs** — three groups (Notion tip, matches the tables):
  CF+ / BH+ / DW+ / SL+ start at 400 (400, 500, 610, 730, 860, 1000, 1150,
  1300, 1500, 1700, 1950, 2200, 2450, 2700); CL+ / SM+ / PS+ start at 300
  and scale faster (300, 375, 475, 600, 725, 925, 1150, 1450, 1800, 2200,
  2650, 3150, 3700, 4300); GT+ / ILM+ start at 300 and scale slower (300, 360,
  430, 510, 620, 750, 900, 1100, 1350, 1650, 2050, 2600, 3300, 4150).
  `upLvl` 0 = the level you get on unlock (wiki "level 0").
- **UW perks** (one each, no Standard Perk Bonus): CL damage ×2, SM +4
  missiles, DW +1 effect wave, CF +5s, ILM +6 mines (outside the wall), GT
  bonus ×1.5, PS radius ×1.5, BH +12s, SL bonus ×1.5. The model counts a UW
  perk unless it's banned.
- **Galaxy Compressor** cuts every UW cooldown except Poison Swamp's (the
  code's assumption, not checked on the wiki; `calcGCompCDReduction`, uses
  the active preset's package chance).
- **Multiverse Nexus**: Death Wave, Golden Tower and Black Hole share one
  cooldown.

## Chain Lightning (CL)

- Wiki: a % chance on each enemy hit to spawn N chain lightnings dealing a
  multiple of tower damage (crit and super crit count).
- Damage 2× → 7961× (32 levels), Quantity 1 → 5, Chance 5% → 27.5%.
- **Smite (CL+)**: every chain lightning has a chance equal to CL Chance to
  deal 0.0005× → 0.006× the current wave's enemy HP (12 levels), up to 100
  times per enemy.
- Labs: Shock (unlock: 2.5% chance, ×1.10), Shock Chance +0.5%/lv (×30),
  Shock Multiplier +0.04/lv (×14); Chain Thunder (enemy damage −10% per 6%
  HP lost to CL, max 3%/lv ×30); Lightning Amplifier – Scatter.
- Model: Damage × Quantity × Chance × fire rate × tower damage × crit ×
  perk. Shock is a damage-taken multiplier on everything. Critical Chance
  card mastery is tower crit (in the crit multiplier), not CL chance.
- **Smite in the calibrated score**: the game counts each enemy once in
  `EnemiesHitByChainLightningThisRound`, so CL hits per enemy reached =
  shots fired × CL chance × chains ÷ enemies reached, and smites per enemy =
  that × CL chance (capped at 100). On a T18 ~W8600 farming run that's about
  4.5, far below the cap.
- **Smite and how far runs get** (2026-10-29): each proc is a share of the
  wave's *basic* enemy health ("X% the current wave HP", the game's text in
  TheTowerSDK's reference tables), the same share at every wave, and only
  orbs, Death Ray, Shockwave and Black Hole are what bosses and elites are
  immune to — so Smite takes a fixed part of a run-ending enemy's health
  and flat damage only has to take the rest. `edps.smiteLog`: on type k,
  h = smites × share ÷ (k's health multiple × its health lab), worth
  1 ÷ (1 − h) more flat damage against it, weighted by the run's deaths.
  Smites on a run-ending enemy = the run's average × basic speed ÷ its
  speed (it stays in range the whole way; **the code's assumption**). Before
  this the waves model left Smite out (What If: maxing Smite +36% damage,
  +0.0 waves on the owner's tournament account). The battle report's Chain
  Lightning damage includes Smite's (TheTowerSDK, unverified); the
  calibration takes Smite's estimated part out of CL's share.
- Not modeled: Chain Thunder (eHP), Lightning Amplifier – Scatter,
  multishot / bounce extra hits.

## Smart Missiles (SM)

- Wiki: N missiles every cooldown, tracking enemies, each a multiple of tower
  damage (crit counts). Damage 10× → 9219× (36 levels), Quantity 5 → 20,
  Cooldown 180s → 20s.
- **Cover Fire (SM+)**: one extra missile every 13s → 2s (12 levels).
- Labs: Despawn Time, Missile Amplifier (each hit on the same target adds
  2.5 → 38.5, additive), Explosion + Radius, Missile Barrage (manual, once a
  run) + Quantity + Recharge.
- Model: Damage × (Quantity × activations + Cover Fire missiles) × tower
  damage × crit.
- Not modeled: Missile Amplifier, explosion radius, Missile Barrage.

## Death Wave (DW) — reworked in v24.3

- Wiki: effect waves (count = "Effect Waves" stat, every ~4s, infinite range)
  hit every enemy, then a Death Wave with a damage pool that persists and
  carries over between activations until spent. Each effect-wave hit gives
  that enemy a damage amplifier against the Death Wave: 5× base, Damage
  Amplifier lab 6.5× → 50× (+1.5/level, 30 levels). Effect waves also give
  coins, max health (+0.05% per kill, cap from DW Health lab 525% → 1250%),
  cells, armor stripping.
- Damage 2× → 9119× (31 levels), Effect Waves 1 → 5, Cooldown 300s → 50s.
- **Kill Wall (DW+)**: each effect-wave hit adds X to the damage pool's
  multiplier: 3, 4, 6, 9, 13, 18, 24, 31, 39, 48, 58, 69, 81, 94, 108.
- Model: Damage × (1 + waves × amplifier) × (1 + waves × Kill Wall) ×
  activations × tower damage × crit (× a fixed 0.012 scale). Waves that land
  = min(effect waves, cooldown ÷ 4s).
- Not modeled: the pool carrying over, Kill Wall's dependence on how many
  enemies the waves hit (it scales with crowd size).

## Chrono Field (CF)

- Wiki: a field (tower range + CF Range lab 3m/level) that slows enemies.
  Speed Reduction 20% → 75% (12 levels) + module substat 3/8/11/15%, **capped
  at 90% on its own**. Duration 5s → 40s (+1s per CF Duration lab level ×30,
  +5s perk, substat 4/7/10s); Cooldown 180s → 60s (substat −4/−7/−10s).
  Fields don't stack — leftover time is wasted — so uptime = min(1,
  duration ÷ cooldown).
- **Chrono Loop (CF+)**: enemies inside the field spiral around the tower.
  Rotation 0.10 → 0.75 rad / 2s (14 levels); research (Priesten / yournicknm /
  Tremnen) puts the "hidden slow" on approach speed at 0.025, 0.05, 0.10, …,
  0.65 by level. Not a Speed Reduction stat, so not capped, but only inside
  an active field. Their formula (wiki AdvancedAnalysis, image "CF+speed",
  checked 2026-10-20): newEnemySpeed = enemySpeed × (1 + CF+ level × −0.05)
  — it matches the table at levels 1–13; the table's level 0 is 2.5% (the
  formula would give 0), and the site keeps the measured 2.5%. Test anchor in
  calculations.test.ts (speed 10 → 3.5 at level 13).
- **Slow Aura card** slows enemies in tower range and multiplies with Chrono
  Field (combined can pass 90%). Its mastery reduces enemy *attack* speed.
- Labs: Damage Reduction (unlock, 10%) + Reduction % (10.5% → 25%) while the
  field is up; CF Range.
- Model: time-to-tower = range ÷ (enemy speed × factor), factor = uptime ×
  (1 − CF)(1 − Slow Aura)(1 − Chrono Loop) + (1 − uptime)(1 − Slow Aura).
  eHP counts the damage reduction × uptime.

## Inner Land Mines (ILM)

- Wiki: N mines every cooldown that explode on contact for a multiple of
  tower damage as area damage (crit counts). **Cooldown hard capped at 37s.**
  Damage 10× → 9219× (36 levels), Quantity 3 → 6, Cooldown 200s → 50s.
  Perk: +6 mines outside the wall.
- **Charged Mine (ILM+)**: each mine's damage grows by ×0.5 → ×50.9 per
  second until it detonates; the charge never resets for a mine that's out.
- Labs: Blast Radius, Rotation Speed, Stun (2.4s), Chrono Jump (charge boost
  per enemy hit, needs ILM+).
- Model: Damage × (Quantity × activations [+ Space Displacer / Magnetic Hook
  mines]) × charge × tower damage × crit; cooldown ≥ 37s. Charge assumes a
  mine waits ~100s (about a boss interval).
- Not modeled: Chrono Jump, blast radius / stun.

## Golden Tower (GT)

- Wiki: while active, enemy kills give ×5.0 → ×21.0 cash and coins (21
  levels; GT Bonus lab +0.15/level to +3.75; perk ×1.5 on stat + lab).
  Duration 15s → 53s (39 levels, GT Duration lab +1s ×20), Cooldown 300s →
  100s.
- **Golden Combo (GT+)**, verified formula: bonus = (1 + 0.0003 × (level +
  1))^kills − 1 on the income earned during Golden Tower; only enemies that
  spawned during the activation count. 0.03% → 0.45% per kill.
- Golden Tower doesn't add damage — coins only (Farming model).

## Poison Swamp (PS)

- Wiki: a swamp that ticks every second for a multiple of tower damage (crit
  counts) while it lasts; poisoned enemies are 25% slower inside it. An enemy
  only takes damage from one swamp when swamps overlap.
- Damage 10× → 9219× (36 levels), Duration 30s → 100s, Cooldown 125s → 50s
  (not reduced by Galaxy Compressor). Perk: radius ×1.5.
- **Tick ramp** (wiki, from in-game hit text): every swamp ramps 50% a tick
  without PS+ — ticks 1×, 1.5×, 3×, 4.5×, 6×… (tick k ≥ 2 = (1 + r)(k − 1)).
  **Death Creep (PS+)** replaces r with 120% → 1110%.
- Labs: Radius +0.04/level ×30, Stun (5% chance, 1s) + Stun Chance (+2.5%) +
  Stun Time (+0.3s), Swamp Rend (+3% of applied rend per level, basics; the
  second lab adds enemy types).
- Model: Damage × coverage of tower range × duration × average tick × rend ×
  stun × activations × tower damage × crit.
- Not modeled: the 25% poisoned slow, overlap when duration > cooldown.

## Black Hole (BH)

- Wiki: pulls enemies in for a duration. **Its damage comes from the Black
  Hole Damage lab: 0.2% → 2% of the enemy's total health per second** (not
  tower damage; protectors don't reduce it). Size 30m → 70m, Duration 15s →
  38s (perk +12s), Cooldown 200s → 50s. Extra Black Hole lab adds a second
  hole opposite.
- **Permanent Black Hole** (always up). Without the Black Hole perk or
  Galaxy Compressor, the only way is the Black Hole substats on both Core
  module slots: two Ancestral Core modules, each with Black Hole – Duration
  and Black Hole – Cooldown, the second in the Core assist slot at 50%
  Substat Efficiency or more (44s against 44s). No lab, card, relic or
  Vault upgrade lengthens Black Hole or shortens its cooldown. Multiverse
  Nexus doesn't help: it makes the cooldown longer. (2026-11-09, from a
  player's question; TowerForge's arithmetic from the game's values, not
  checked in the game.) Why:
  - TowerForge counts its uptime as duration ÷ cooldown (`farming.ts`), so
    it's permanent once the duration reaches the cooldown. The stats alone
    stop at 38s against 50s, 12s short;
  - the Black Hole perk adds 12s (38 + 12 = 50);
  - Galaxy Compressor takes time off every UW cooldown as recovery packages
    are collected;
  - the Core substats: Black Hole – Duration +2 / +3 / +4s and Black Hole –
    Cooldown −2 / −3 / −4s (Legendary / Mythic / Ancestral). One Ancestral
    Core module with both: 42s against 46s, still 4s short. The assist slot
    adds its module's substats at the slot's Substat Efficiency (up to
    100%: 1% + 69 stone levels + 30 Assist Module lab levels);
  - Multiverse Nexus: Death Wave, Golden Tower and Black Hole share the
    average of their cooldowns (Golden Tower's is at least 100s), shifted
    by −10s at Ancestral, so Black Hole's gets longer;
  - the Extra Black Hole lab and Primordial Collapse add holes at the same
    time, not a longer one.
- **Consume (BH+)**: at the end of each activation, every enemy in it takes
  0.05× → 0.75× the current wave's HP.
- Spotlight doesn't multiply it (health-based).
- Model (calibrated score): reach = holes × uptime × size × lab %/s;
  Consume adds its share of enemy health on the kills made inside a Black
  Hole (98% of kills on a T18 farming run). The uncalibrated fallback still
  multiplies size by tower damage, which isn't how the game works.

## Spotlight (SL)

- Wiki: N lights of a given angle spin around the tower; enemies in them take
  ×8 → ×50 damage (31 levels; perk ×1.5). **It multiplies every damage source
  that isn't based on enemy health or wave stats** (so not Black Hole, Smite,
  Consume or orbs). Angle 30° → 90°, Quantity 1 → 4.
- **Light Range (SL+)**: the bonus gains 0.01× → 0.15× of damage per meter
  (tower range matters).
- Labs: Spotlight Missiles — the tower fires one missile every 19s (Lv 1) →
  2s (Lv 18), each dealing Smart Missiles' damage (14× without Smart
  Missiles); Spotlight Coin Bonus ×1.1 → ×3.0.
- Model: 1 + (bonus × perk + Light Range − 1) × (angle × quantity ÷ 360) on
  tower-damage sources.
