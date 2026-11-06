// ============================================================
//  TowerForge Companion — Stats Share Card
//  A share card of named values in groups — Profile, Workshop, Labs,
//  Relics, Guardian (components/share/shareSections.ts builds them):
//  each group a heading and a grid of tiles, maxed values in gold.
//  Fluid on the shared-stats page. As the Export Image poster the
//  tiles are bigger, `columns` across with the level beside the
//  value, and a long section goes on over Reddit-shaped pages
//  (PosterPages), a cut group repeating its heading.
// ============================================================

import type { Ref } from 'react';
import { SHARE_COLORS, shareRootStyle, shareTileStyle } from './shareTheme';
import { ShareHeader, ShareFooter, ShareHeading } from './shareCommon';
import PosterPages from './PosterPages';
import type { PosterBlock } from './PosterPages';

export interface StatTile {
    name: string;
    value: string;
    note?: string;       // under the value (levels, "equipped")
    maxed?: boolean;     // drawn in gold
}

export interface StatGroup {
    label: string;
    note?: string;       // next to the heading
    tiles: StatTile[];
}

// The poster's tile: name, then the value with its level beside it.
function PosterTile({ t }: { t: StatTile }) {
    return (
        <div style={{ ...shareTileStyle(t.maxed), padding: '10px 12px' }}>
            <div style={{ fontSize: 16, color: SHARE_COLORS.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.name}
            </div>
            <div style={{ marginTop: 3, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0 8px' }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: t.maxed ? SHARE_COLORS.gold : SHARE_COLORS.text, overflowWrap: 'anywhere' }}>
                    {t.value}
                </span>
                {t.note && <span style={{ fontSize: 14, color: SHARE_COLORS.dim, whiteSpace: 'nowrap' }}>{t.note}</span>}
            </div>
        </div>
    );
}

// The groups as poster blocks: a heading, then its tiles a row at a time.
function statBlocks(groups: StatGroup[], columns: number): PosterBlock[] {
    return groups.filter(g => g.tiles.length > 0).flatMap(group => {
        const rows: StatTile[][] = [];
        for (let i = 0; i < group.tiles.length; i += columns) rows.push(group.tiles.slice(i, i + columns));
        return [
            { key: `${group.label}:h`, node: <ShareHeading label={group.label} note={group.note} poster />, keepWithNext: true },
            ...rows.map((row, r): PosterBlock => ({
                key: `${group.label}:${r}`,
                node: (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 10 }}>
                        {row.map(t => <PosterTile key={t.name} t={t} />)}
                    </div>
                ),
                cont: <ShareHeading label={group.label} note="continued" poster />,
            })),
        ];
    });
}

export default function StatsShareCard({ ref, title, subtitle, groups, empty, poster, columns = 4, onPages }: {
    ref?: Ref<HTMLDivElement>;
    title: string;
    subtitle: string;
    groups: StatGroup[];
    empty?: string;      // shown when no group has a tile
    poster?: boolean;
    columns?: number;    // tiles across on the poster
    onPages?: (count: number) => void;
}) {
    const shown = groups.filter(g => g.tiles.length > 0);
    const emptyNote = <div style={{ fontSize: poster ? 20 : 16, color: SHARE_COLORS.dim }}>{empty ?? 'Nothing to show yet.'}</div>;

    if (poster) {
        const blocks = statBlocks(shown, columns);
        return (
            <PosterPages ref={ref} title={title} subtitle={subtitle} onPages={onPages}
                blocks={blocks.length > 0 ? blocks : [{ key: 'empty', node: emptyNote }]} />
        );
    }

    return (
        <div ref={ref} style={shareRootStyle(false)}>
            <ShareHeader title={title} subtitle={subtitle} />

            {shown.map(group => (
                <div key={group.label} style={{ marginBottom: 20 }}>
                    <ShareHeading label={group.label} note={group.note} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
                        {group.tiles.map(t => (
                            <div key={t.name} style={{ ...shareTileStyle(t.maxed), padding: '8px 10px' }}>
                                <div style={{ fontSize: 13, color: SHARE_COLORS.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {t.name}
                                </div>
                                <div style={{ marginTop: 2, fontSize: 17, fontWeight: 700, color: t.maxed ? SHARE_COLORS.gold : SHARE_COLORS.text, overflowWrap: 'anywhere' }}>
                                    {t.value}
                                </div>
                                {t.note && <div style={{ marginTop: 1, fontSize: 12, color: SHARE_COLORS.dim }}>{t.note}</div>}
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {shown.length === 0 && emptyNote}

            <ShareFooter />
        </div>
    );
}
