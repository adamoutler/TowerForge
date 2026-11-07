// ============================================================
//  TowerForge Companion — Game number format
//  The Tower writes big numbers with letter suffixes: K, M, B, T,
//  q, Q, s, S, O, N, D, then aa, ab, ac … (1e36, 1e39, 1e42 …).
//  Case matters (q ≠ Q, s ≠ S). Source: the wiki's Common
//  Abbreviations table; aa = 1e36 confirmed on the in-game Wave
//  Info panel (T18 W6000 enemy health 4.02aa, see run-simulation.md).
// ============================================================

const NAMED: [string, number][] = [
    ['K', 1e3], ['M', 1e6], ['B', 1e9], ['T', 1e12], ['q', 1e15], ['Q', 1e18],
    ['s', 1e21], ['S', 1e24], ['O', 1e27], ['N', 1e30], ['D', 1e33],
];
// aa, ab … az continue in steps of a thousand from 1e36.
const LETTERED: [string, number][] = Array.from({ length: 26 }, (_, i) =>
    [`a${String.fromCharCode(97 + i)}`, Number(`1e${36 + 3 * i}`)]);

// Largest first, for formatting.
const SUFFIXES: [string, number][] = [...NAMED, ...LETTERED].reverse();
const SUFFIX_VALUE: Record<string, number> = Object.fromEntries(SUFFIXES);

// "3.05Q" → 3.05e18, "$791.44B" → 7.9144e11, "4.02aa" → 4.02e36, "1,234" → 1234,
// "1248681 [100.0%]" → 1248681. Returns NaN for text it doesn't understand.
export function parseGameNumber(raw: string): number {
    const m = raw.trim().replace(/^\$/, '').replace(/,/g, '').match(/^(-?[\d.]+)\s*([A-Za-z]*)/);
    if (!m) return NaN;
    const base = parseFloat(m[1]);
    if (!m[2]) return base;
    const mult = SUFFIX_VALUE[m[2]];
    return mult ? base * mult : NaN;
}

// 3.05e18 → "3.05Q"; small numbers keep up to 2 decimals without trailing zeros.
// Like the game, a suffixed number is cut off at 2 decimals, not rounded
// (3.8151aa shows 3.81aa — checked on the Wave Info panel).
export function formatGameNumber(n: number): string {
    if (!Number.isFinite(n)) return '0';
    const abs = Math.abs(n);
    for (const [suffix, value] of SUFFIXES) {
        if (abs >= value) {
            const cut = Math.floor((abs / value) * 100 * (1 + 1e-12)) / 100;   // tiny nudge for float noise
            return `${n < 0 ? '-' : ''}${cut.toFixed(2)}${suffix}`;
        }
    }
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}
