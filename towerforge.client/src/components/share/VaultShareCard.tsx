// ============================================================
//  TowerForge Companion — Vault Share Card
//  The Vault upgrades bought, as the game's Vault rows (VaultRow), by
//  tab and section — what each gives and its level. Fluid on the
//  shared-stats page; the Export Image poster has two rows across over
//  Reddit-shaped pages (PosterPages).
// ============================================================

import type { Ref } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { VAULT_SECTIONS, VAULT_TREES } from '../../constants/vaultData';
import { vaultKeys, vaultLevel } from '../../engine/vault';
import VaultRow from '../common/VaultRow';
import { SHARE_COLORS, shareRootStyle } from './shareTheme';
import { ShareHeader, ShareFooter, ShareHeading } from './shareCommon';
import PosterPages from './PosterPages';
import type { PosterBlock } from './PosterPages';

const COLS = 2;

// The sections with something bought: "Harmony — Cards", "Enemy — Simple · Basic".
function boughtGroups(levels: Record<string, number>) {
    return VAULT_SECTIONS.map(s => ({
        key: `${s.group}-${s.enemy ?? ''}`,
        label: `${VAULT_TREES.find(t => t.id === s.tree)?.label ?? s.tree} — ${s.name}${s.enemy ? ` · ${s.enemy}` : ''}`,
        fallback: s.enemy?.[0],
        upgrades: s.upgrades.filter(u => vaultLevel(levels, u) > 0),
    })).filter(g => g.upgrades.length > 0);
}

// `snapshot`: someone else's Vault levels (a shared link); else the store's.
export default function VaultShareCard({ ref, snapshot, poster, onPages }: {
    ref?: Ref<HTMLDivElement>;
    snapshot?: Record<string, number>;
    poster?: boolean;
    onPages?: (count: number) => void;
}) {
    const storeLevels = useGameStore(s => s.vaultLevels);
    const levels = snapshot ?? storeLevels;
    const groups = boughtGroups(levels);
    const keys = vaultKeys(levels);
    const all = VAULT_SECTIONS.flatMap(s => s.upgrades);
    const maxed = all.filter(u => vaultLevel(levels, u) >= u.costs.length).length;
    const title = 'Vault';
    const subtitle = `${keys.spent.toLocaleString()} keys spent · ${maxed}/${all.length} upgrades max`;
    const empty = <div style={{ fontSize: poster ? 20 : 16, color: SHARE_COLORS.dim }}>Nothing bought in the Vault yet.</div>;

    if (poster) {
        const blocks: PosterBlock[] = groups.flatMap(g => {
            const rows: PosterBlock[] = [];
            for (let i = 0; i < g.upgrades.length; i += COLS) {
                rows.push({
                    key: `${g.key}:${i}`,
                    node: (
                        <div className="vltg-rows poster" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
                            {g.upgrades.slice(i, i + COLS).map(u => <VaultRow key={u.id} u={u} level={vaultLevel(levels, u)} fallback={g.fallback} />)}
                        </div>
                    ),
                    cont: <ShareHeading label={g.label} note="continued" poster />,
                });
            }
            return [{ key: `${g.key}:h`, keepWithNext: true, node: <ShareHeading label={g.label} poster /> }, ...rows];
        });
        return <PosterPages ref={ref} title={title} subtitle={subtitle} onPages={onPages} blocks={blocks.length ? blocks : [{ key: 'empty', node: empty }]} />;
    }

    return (
        <div ref={ref} style={shareRootStyle(false)}>
            <ShareHeader title={title} subtitle={subtitle} />
            {groups.map(g => (
                <div key={g.key} style={{ marginBottom: 18 }}>
                    <ShareHeading label={g.label} />
                    <div className="vltg-rows">
                        {g.upgrades.map(u => <VaultRow key={u.id} u={u} level={vaultLevel(levels, u)} fallback={g.fallback} />)}
                    </div>
                </div>
            ))}
            {groups.length === 0 && empty}
            <ShareFooter />
        </div>
    );
}
