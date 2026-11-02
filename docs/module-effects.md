# Module Effects in the Calculations

How each module's **unique effect** enters the eDPS (Glass Cannon), Coins (Farming) and Survival (eHP) models.

- **Code:** `towerforge.client/src/engine/moduleEffects.ts`.
- **On-screen summary:** each module card on the Modules tab shows `UNIQUE_EFFECT_MODEL` (`constants/moduleData.ts`).
- **Sources:** values and mechanics come from the wiki (*Epic Module Unique Effect*, *Shockwave*, *Land Mine*, *Free Upgrades*, *Chain Lightning* shock labs). How often things happen comes from the player's battle report (`engine/runRates.ts`).

## Which tier counts

- **Primary module:** its own rarity's value (Ancestral ★ counts as Ancestral).
- **Assist module:** the assist slot's unlocked tier (`UniqueEffectEfficiencyLevel` 0 Epic … 3 Ancestral), never above the module's own.
- **Checked on cards:** Being Annihilator as a Legendary assist shows 7%; Galaxy Compressor as a Mythic assist shows −17s.

## Run rates (battle report)

Taken from the game's battle history (imported file) or defaults when there's none:

| Rate | Source field(s) | Example (T18 farm run, 8299 waves) |
|---|---|---|
| Boss + fleet kills/s | `TotalBoss` + `TotalCommanders/Saboteurs/Overcharges` ÷ `GameTime` | 0.0083 |
| Elite kills/s | `TotalElites` ÷ `GameTime` | 0.069 |
| Kills/s | `TotalEnemies` ÷ `GameTime` | 9.03 |
| Packages/s | `RecoveryPackages` ÷ `GameTime`, scaled by any change in package chance | 0.0287 |
| Cash digits | log10(`CashEarned`) | 10.6 |
| Chain Lightning hits per enemy | `EnemiesHitByChainLightningThisRound` ÷ enemies | 0.71 |
| Share poisoned | `EnemiesHitByPoisonSwampThisRound` ÷ enemies | 0.23 |
| Share of kills in a Black Hole | `DestroyedInBlackhole` ÷ enemies | 0.98 |
| Orb hits per enemy | `OrbHits` ÷ enemies | 0.88 |

A pasted battle report (as opposed to an imported one) doesn't include boss/elite counts, cash or hit counts, so those rates fall back to defaults. Re-import the game file after an update so stored battles carry the new fields.

## Effects

| Module | Counted in | Formula |
|---|---|---|
| Amplifying Strike | eDPS | Tower damage × (1 + 4u), u = 1 − e^(−λ·x), λ = boss + elite + fleet kills/s. Your run: 86.5% → ×4.46. |
| Being Annihilator | eDPS | +x% super crit chance; share of shots that super crit = 6q ÷ (1 + 5q) (each super crit forces 5 more). |
| Death Penalty | eDPS | x% of enemies (5% Epic → 15% Ancestral) are marked when they spawn and die to their first hit, so the rest of the damage only has to kill the other (1 − x): × 1 ÷ (1 − x), x at most 90%. |
| Project Funding | eDPS | Tower damage × (1 + log10(cash) × x%), never below ×1 (wiki). |
| Anti-Cube Portal | eDPS | × (1 + (x − 1) × min(1, 7s ÷ shockwave interval)); interval = 20s − 0.15s/level + sub-effects, min 7s. *Assumes the shockwave reaches the enemies the UWs hit.* |
| Space Displacer | eDPS | Extra Inner Land Mines/s = kills/s × land mine chance (0.6%/level + subs) × x%, each dealing ILM damage (with Charged Mine). |
| Magnetic Hook | eDPS | Extra Inner Land Mines/s = x × (boss + fleet kills/s + 25% of elite kills/s). |
| Galaxy Compressor | eDPS · Coins | Every UW cooldown except Poison Swamp: CD ÷ (1 + x × packages/s). |
| Restorative Bonus | eDPS | Attack speed × (1 + 0.5 × min(1, packages/s × (x + 30s))) — 50% for x s, then a 60s decay worth 30s. Feeds Chain Lightning. |
| Multiverse Nexus | eDPS · Coins | DW/GT/BH share one cooldown: average of (stat + Cooldown subs) + x, then Galaxy Compressor. Your setup: 41.6s. |
| Dimension Core | eDPS | Chain Lightning +0.6 hits per proc (hits its target 60%). Shock (labs: 2.5% + 0.5%/lvl chance, ×1.10 + 0.04/lvl): all damage × (1 + min(x, hits × 2s) × 2(m − 1)); without Dimension Core × (1 + min(1, hits × s)(m − 1)). |
| Om Chip | eDPS | × (1 + (x − 1) × min(1, boss kills/s × time-to-tower) × 25%). *Assumes a quarter of enemies are near a lit boss.* |
| Primordial Collapse | eDPS · eHP | +1 Black Hole (BH damage and farming coverage). eHP: damage that lands × (1 − x% × share of kills in holes). |
| Black Hole Digestor | Coins | Also keeps free upgrades off Range while equipped, which its text doesn't say (the owner, 2026-11-01; `engine/freeUpgrades.ts`). Kill coins × (1 + x% × free upgrades per wave). Free upgrades/wave = Σ over Attack/Defense/Utility of (0.5%/level + card + perk + subs) × enhancement, × (1 + Wave Skip). Your setup: ~6.2/wave → +62%. *Assumes the bonus multiplies the Coins/Kill bonus.* |
| Gilded Sniper | Coins | For Spotlight, Black Hole and Golden Bot: coverage c → c + (uptime − c) × x%. Observed coverage has the current value removed first, so changes re-apply cleanly. |
| Singularity Harness | Coins | +x m Golden Bot range (Flame Bot double damage not modeled). |
| Sharp Fortitude | eHP | Wall health and wall regen × x. |
| Harmony Conductor | eHP | Damage that lands × (1 − x% × share poisoned). |
| Negative Mass Projector | eHP | Damage that lands × (1 − min(50%, x% × orb hits per enemy)). |
| Wormhole Redirector | — | Not counted: eHP already assumes packages keep the Max Recovery overheal topped up. |
| Astral Deliverance | — | Not counted: boosts bounce-shot projectiles; eDPS scores UW damage. |
| Havoc Bringer | — | Not counted: rend armor isn't modeled. |
| Shrink Ray | — | Not counted: enemy mass / knockback isn't modeled. |
| Orbital Augment | — | Not counted: electrons deal % of enemy health (like CL Smite), not tower damage. |
| Sentry Protocol | — | Not counted: orbs aren't modeled. |
| Pulsar Harvester | — | Not counted: enemy level reductions aren't modeled. |
| Infinity Threshold | — | Not counted: upgrade values past the normal level cap aren't known. Values 1000 / 2000 / 3000 / 4000 levels. |

## Other module fixes in the same pass

- **Cannon substats now count:**
  - Crit Chance (+points, crit capped at 100%).
  - Crit Factor and Super Crit Multi (added to the workshop value).
  - Super Crit Chance (+points).
  - Attack Speed, using the in-game formula (WS × Lab × Card + sub) × Enhancement.
- **UW damage sub-effects add to the UW's damage multiplier:** CL, SM, DW, ILM, PS. CL's used to multiply (×251 for +250x). Black Hole Size subs now count too.
- **Generator coin effects in farming:**
  - The generator main effect (Coin Bonus ×, primary × assist) multiplies kill and wave coins.
  - Coins/Kill and Coins/Wave subs add to the workshop values.
- **Package chance:**
  - Package Chance subs count as percent (they were added as 0.15 instead of 15).
  - eHP's Recovery Package Chance card is found (it was looked up under the wrong name).
- **Removed stand-ins:**
  - Harmony Conductor as ×2 Poison Swamp damage.
  - Singularity Harness as ×1.25 Black Hole damage.
  - Dimension Core as ×0.4 Chain Lightning without it.
  - Space Displacer as ×1.5 ILM.
- **Assist slots** are scored in every build's metric: armor for eHP, generator for coins, cannon and core for eDPS.
