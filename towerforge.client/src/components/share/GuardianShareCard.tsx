// ============================================================
//  TowerForge Companion — Guardian Share Card
//  The Guardian preset a site preset uses, drawn like the game's
//  Guardian screen: the board with its chip slots (GuardianBoard), each
//  equipped chip with its three stats, and the chips owned. Fluid on
//  the shared-stats page; the Export Image poster over Reddit-shaped
//  pages (PosterPages).
// ============================================================

import type { Ref } from 'react';
import { RELEASED_CHIPS, SKIN_COIN_BONUS } from '../../constants/guardianData';
import { activeChips, guardianPreset } from '../../engine/guardian';
import type { GuardianData } from '../../types/gameTypes';
import GuardianBoard, { ChipTile } from '../common/GuardianBoard';
import { SHARE_COLORS, shareRootStyle } from './shareTheme';
import { ShareHeader, ShareFooter, ShareHeading } from './shareCommon';
import PosterPages from './PosterPages';
import type { PosterBlock } from './PosterPages';

export default function GuardianShareCard({ ref, guardian, preset, presetName, poster, onPages }: {
    ref?: Ref<HTMLDivElement>;
    guardian: GuardianData;
    preset: number;
    presetName?: string;
    poster?: boolean;
    onPages?: (count: number) => void;
}) {
    const p = guardianPreset(guardian, preset);
    const chips = activeChips(guardian, preset);
    const open = 1 + Math.min(2, Math.max(0, p?.extraSlots ?? 0));
    const skins = guardian.skinsOwned ?? 0;
    const title = 'Guardian';
    const subtitle = [presetName, p?.name].filter(Boolean).join(' · ') || 'Guardian';
    const label = (text: string) => <ShareHeading label={text} poster={poster} />;

    const board = p
        ? <GuardianBoard chips={p.chips.slice(0, open)} open={open} title={p.name} sub={`${skins} skins · +${(skins * SKIN_COIN_BONUS * 100).toFixed(1)}% coins`} />
        : <div style={{ fontSize: 18, color: SHARE_COLORS.dim }}>The Guardian isn&apos;t unlocked.</div>;
    const equipped = chips.length > 0 && (
        <div className="grdg-equipped">
            {chips.map(a => (
                <div key={a.chip.id} className="grdg-chip-card">
                    <div className="grdg-chip-card-head">
                        <ChipTile chip={a.chip} />
                        <span className="grdg-chip-text">{a.chip.text}</span>
                    </div>
                    <div className="grdg-stats">
                        {a.chip.stats.map((st, k) => {
                            const maxed = a.levels[k] >= st.max;
                            return (
                                <div key={st.name + k} className={`grdg-stat ${maxed ? 'max' : ''}`}>
                                    <span className="grdg-stat-name">{st.name}</span>
                                    <span className="grdg-stat-val">{st.fmt(a.values[k])}</span>
                                    <span className="grdg-stat-cost">{maxed ? 'Max' : `Lv ${a.levels[k]}/${st.max}`}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
    const owned = RELEASED_CHIPS.filter(c => guardian.chipsOwned[c.index]);
    const inventory = owned.length > 0 && (
        <div className="grdg-inv">
            {owned.map(c => <ChipTile key={c.id} chip={c} equipped={chips.some(a => a.chip.id === c.id)} />)}
        </div>
    );

    if (poster) {
        const blocks: PosterBlock[] = [
            { key: 'board', node: <div className="grdg-panel poster">{board}</div> },
            ...(equipped ? [{ key: 'eq:h', keepWithNext: true, node: label('Equipped chips') }, { key: 'eq', node: equipped }] : []),
            ...(inventory ? [{ key: 'inv:h', keepWithNext: true, node: label('Chips owned') }, { key: 'inv', node: inventory }] : []),
        ];
        return <PosterPages ref={ref} title={title} subtitle={subtitle} onPages={onPages} blocks={blocks} />;
    }

    return (
        <div ref={ref} style={shareRootStyle(false)}>
            <ShareHeader title={title} subtitle={subtitle} />
            <div className="grdg-panel" style={{ marginBottom: 16 }}>{board}</div>
            {equipped && <div style={{ marginBottom: 16 }}>{label('Equipped chips')}{equipped}</div>}
            {inventory && <div>{label('Chips owned')}{inventory}</div>}
            <ShareFooter />
        </div>
    );
}
