// ============================================================
//  TowerForge Companion — Unique Module Effects
//  The math for each unique module's effect, shared by the eDPS,
//  Farming and eHP models. A module's value is the one it runs at:
//  a primary module at its own rarity, an assist at the slot's
//  unlocked tier (ModBonuses.uniques). Values and mechanics are from
//  the wiki (Epic Module Unique Effect and the mechanic pages); how
//  often things happen comes from the player's Battle Report
//  (engine/runRates.ts).
//
//  Pure functions — no store imports.
// ============================================================

import type { LabData, ModBonuses } from '../types/gameTypes';

export const uniq = (mb: ModBonuses, name: string): number => mb.uniques?.[name] ?? 0;
export const hasUnique = (mb: ModBonuses, name: string): boolean => name in (mb.uniques ?? {});

// ── Cannon ────────────────────────────────────────────────────

// Amplifying Strike: ×5 tower damage for [x]s after each boss, elite or fleet
// kill, refreshed by the next one. With those kills arriving at rate λ, the
// buff is up whenever one happened in the last x seconds: uptime = 1 − e^(−λx).
export function amplifyingStrikeUptime(mb: ModBonuses): number {
    const dur = uniq(mb, 'Amplifying Strike');
    if (dur <= 0) return 0;
    return 1 - Math.exp(-(mb.run.bossFleetPerSec + mb.run.elitePerSec) * dur);
}
export const amplifyingStrikeMult = (mb: ModBonuses): number => 1 + 4 * amplifyingStrikeUptime(mb);

// Project Funding: tower damage × (1 + log10(cash) × [x]%), never below ×1 (wiki).
export function projectFundingMult(mb: ModBonuses): number {
    const pct = uniq(mb, 'Project Funding');
    return pct > 0 ? Math.max(1, 1 + mb.run.cashDigits * pct / 100) : 1;
}

// Being Annihilator: +[x]% Super Crit Chance, and a super crit makes the next
// 5 shots super crits. If q is the chance a shot super crits by itself, each
// one starts a 6-shot run, so the share of shots that super crit is 6q / (1 + 5q).
export const beingAnnihilatorBonus = (mb: ModBonuses): number => uniq(mb, 'Being Annihilator') / 100;
export function superCritShare(q: number, mb: ModBonuses): number {
    const p = Math.min(1, Math.max(0, q));
    return hasUnique(mb, 'Being Annihilator') ? (6 * p) / (1 + 5 * p) : p;
}

// Death Penalty: [x]% of enemies are marked when they spawn and die to their
// first hit, so the rest of the damage clears enemies 1 / (1 − x) as fast.
export function deathPenaltyMult(mb: ModBonuses): number {
    const p = Math.min(0.9, uniq(mb, 'Death Penalty') / 100);
    return p > 0 ? 1 / (1 - p) : 1;
}

// Gilded Sniper: [x]% of kills made outside an active coin bonus's area
// (Spotlight, Black Hole, Golden Bot) still get that bonus.
export const gildedSniperChance = (mb: ModBonuses): number => uniq(mb, 'Gilded Sniper') / 100;

// ── Armor ─────────────────────────────────────────────────────

// Shockwave: every 20s − 0.15s per Frequency level, plus Shockwave Frequency
// sub-effects, never faster than every 7s (wiki).
export function shockwaveInterval(mb: ModBonuses, wsFrequencyLevel: number): number {
    return Math.max(7, 20 - 0.15 * wsFrequencyLevel + (mb.subs['Shockwave Frequency'] ?? 0));
}

// Anti-Cube Portal: enemies take ×[x] damage for 7s after a shockwave hits
// them. Assumes the shockwave reaches the enemies the UWs are hitting.
export function antiCubePortalMult(mb: ModBonuses, wsFrequencyLevel: number): number {
    const x = uniq(mb, 'Anti-Cube Portal');
    if (x <= 1) return 1;
    return 1 + (x - 1) * Math.min(1, 7 / shockwaveInterval(mb, wsFrequencyLevel));
}

// Space Displacer: [x]% of land mines spawn as Inner Land Mines instead. Land
// mines drop from (land mine chance) of kills: 0.6% per level plus sub-effects (wiki).
export function spaceDisplacerMinesPerSec(mb: ModBonuses, wsLandMineChanceLevel: number): number {
    const x = uniq(mb, 'Space Displacer');
    if (x <= 0) return 0;
    const chance = Math.min(100, 0.6 * wsLandMineChanceLevel + (mb.subs['Land Mine Chance'] ?? 0)) / 100;
    return mb.run.killsPerSec * chance * x / 100;
}

// Sharp Fortitude: wall health and wall regen ×[x].
export const sharpFortitudeMult = (mb: ModBonuses): number => uniq(mb, 'Sharp Fortitude') || 1;

// Negative Mass Projector: each orb hit cuts that enemy's damage by [x]%,
// stacking to 50%, at the run's orb hits per enemy.
export function negativeMassReduction(mb: ModBonuses): number {
    const x = uniq(mb, 'Negative Mass Projector');
    return x > 0 ? Math.min(0.5, (x / 100) * mb.run.orbHitsPerEnemy) : 0;
}

// ── Generator ─────────────────────────────────────────────────

// Recovery packages per second: the run's observed rate, scaled by any change
// in package chance; without a report, chance per wave ÷ wave length.
export function packagesPerSec(mb: ModBonuses, chancePct: number): number {
    const r = mb.run;
    if (r.source === 'report') {
        return r.pkgChanceAtRun > 0 ? r.packagesPerSec * (chancePct / r.pkgChanceAtRun) : r.packagesPerSec;
    }
    return Math.min(1, chancePct / 100) / r.waveSec;
}

// Galaxy Compressor: each package cuts every UW cooldown except Poison Swamp
// by [x]s, so a cooldown of CD seconds runs out in CD / (1 + x × package rate).
export function galaxyCompressorCD(cd: number, mb: ModBonuses, chancePct: number): number {
    const x = uniq(mb, 'Galaxy Compressor');
    return x > 0 ? cd / (1 + x * packagesPerSec(mb, chancePct)) : cd;
}

// Restorative Bonus: a package gives +50% attack speed for [x]s, then it
// decays over 60s (worth another 30 full seconds); the next package refreshes it.
export function restorativeBonusASMult(mb: ModBonuses, chancePct: number): number {
    const x = uniq(mb, 'Restorative Bonus');
    if (x <= 0) return 1;
    return 1 + 0.5 * Math.min(1, packagesPerSec(mb, chancePct) * (x + 30));
}

// Black Hole Digestor: +[x]% Coins/Kill Bonus for each free upgrade this wave
// (it triggers even when the upgrade has nothing left to raise — wiki). Its
// other line, no free upgrades on Range, is in engine/freeUpgrades.ts.
export function blackHoleDigestorMult(mb: ModBonuses, freeUpgradesPerWave: number): number {
    const x = uniq(mb, 'Black Hole Digestor');
    return x > 0 ? 1 + (x / 100) * freeUpgradesPerWave : 1;
}

// Singularity Harness: +[x]m bot range (Flame Bot's double damage isn't modeled).
export const singularityHarnessRange = (mb: ModBonuses): number => uniq(mb, 'Singularity Harness');

// ── Core ──────────────────────────────────────────────────────

// Multiverse Nexus: Death Wave, Golden Tower and Black Hole always fire
// together; the shared cooldown is the average of theirs ±[x]s.
export const multiverseNexusVariance = (mb: ModBonuses): number | null =>
    hasUnique(mb, 'Multiverse Nexus') ? uniq(mb, 'Multiverse Nexus') : null;

// Magnetic Hook: [x] Inner Land Mines at every boss and fleet enemy entering
// range, and at 25% of elites.
export function magneticHookMinesPerSec(mb: ModBonuses): number {
    const x = uniq(mb, 'Magnetic Hook');
    return x > 0 ? x * (mb.run.bossFleetPerSec + 0.25 * mb.run.elitePerSec) : 0;
}

// Primordial Collapse: one more Black Hole, and enemies inside a hole deal
// [x]% less damage (weighted by the run's share of kills inside holes).
export const primordialCollapseExtraHoles = (mb: ModBonuses): number => (hasUnique(mb, 'Primordial Collapse') ? 1 : 0);
export const primordialCollapseReduction = (mb: ModBonuses): number =>
    (uniq(mb, 'Primordial Collapse') / 100) * mb.run.bhShare;

// Harmony Conductor: poisoned enemies miss [x]% of their attacks, weighted by
// the run's share of enemies poisoned.
export const harmonyConductorReduction = (mb: ModBonuses): number =>
    (uniq(mb, 'Harmony Conductor') / 100) * mb.run.poisonedShare;

// Om Chip: the Spotlight follows bosses, and enemies near a lit boss take ×[x]
// damage. Assumes a quarter of enemies are near the boss while one is alive
// (each boss alive about one time-to-tower).
const OM_CHIP_NEAR_SHARE = 0.25;
export function omChipMult(mb: ModBonuses, refTTT: number, spotlightOwned: boolean): number {
    const x = uniq(mb, 'Om Chip');
    if (x <= 1 || !spotlightOwned) return 1;
    const bossUp = Math.min(1, mb.run.bossFleetPerSec * refTTT);
    return 1 + (x - 1) * bossUp * OM_CHIP_NEAR_SHARE;
}

// Chain Lightning shock (labs): CL shocks with chance s = 2.5% + 0.5%/level,
// and shocked enemies take ×m = 1.10 + 0.04/level damage (wiki). Without
// Dimension Core a shock doesn't stack. Dimension Core doubles the chance and
// the bonus and lets it stack up to [x]: ×(1 + 2(m − 1) × stacks). Stacks per
// enemy follow the run's Chain Lightning hits per enemy.
export function shockMult(mb: ModBonuses, labData: LabData, chainLightningOwned: boolean): number {
    if (!chainLightningOwned || (labData['CL-Shock(unlock)'] ?? 0) < 1) return 1;
    const s = 0.025 + 0.005 * (labData['CL-Shock Chance'] ?? 0);
    const m = 1.1 + 0.04 * (labData['CL-Shock Multiplier'] ?? 0);
    const hits = mb.run.clHitsPerEnemy;
    const maxStacks = uniq(mb, 'Dimension Core');
    if (maxStacks <= 0) return 1 + Math.min(1, hits * s) * (m - 1);
    return 1 + Math.min(maxStacks, hits * 2 * s) * 2 * (m - 1);
}

// Dimension Core: Chain Lightning has a 60% chance to also hit its first target.
export const dimensionCoreExtraHits = (mb: ModBonuses): number => (hasUnique(mb, 'Dimension Core') ? 0.6 : 0);
