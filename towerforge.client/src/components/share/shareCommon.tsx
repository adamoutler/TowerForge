// ============================================================
//  TowerForge Companion — Share Image Shared Pieces
//  Header, footer and group heading shared by every poster-style
//  share image: the TowerForge wordmark as the site's logo writes it
//  (TOWER in white, FORGE in pink), and the logo's pink → violet as
//  the rule under the title and the mark beside each heading.
// ============================================================

import { SHARE_COLORS, SHARE_GRADIENT } from './shareTheme';

export function ShareHeader({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <div style={{ marginBottom: 'clamp(14px, 2.2cqw, 24px)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 3 }}>
                TOWER<span style={{ color: SHARE_COLORS.accent }}>FORGE</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2px 16px', marginTop: 4 }}>
                <div style={{ fontSize: 'clamp(26px, 3.5cqw, 38px)', fontWeight: 700 }}>{title}</div>
                <div style={{ fontSize: 'clamp(13px, 1.6cqw, 17px)', color: SHARE_COLORS.dim }}>{subtitle}</div>
            </div>
            <div style={{ height: 3, marginTop: 14, borderRadius: 2, background: SHARE_GRADIENT }} />
        </div>
    );
}

export function ShareFooter() {
    return (
        <div style={{ marginTop: 'clamp(14px, 2.2cqw, 24px)', paddingTop: 12, borderTop: `1px solid ${SHARE_COLORS.border}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 14, color: SHARE_COLORS.dim }}>
            <span>Made with TowerForge Companion</span>
            <span style={{ color: SHARE_COLORS.accent, fontWeight: 600 }}>towerforge.net</span>
        </div>
    );
}

// A group's heading (Attack, Best wave by tier, Harmony — Cards…): the
// label with the brand mark beside it, and a note after it. The poster
// spaces blocks itself, so it has room above instead of below.
export function ShareHeading({ label, note, poster }: { label: string; note?: string; poster?: boolean }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 10px', marginBottom: poster ? 0 : 8, paddingTop: poster ? 8 : 0 }}>
            <span style={{ width: 4, height: poster ? 24 : 19, flexShrink: 0, borderRadius: 2, background: `linear-gradient(180deg, ${SHARE_COLORS.accent}, ${SHARE_COLORS.accent2})` }} />
            <span style={{ fontSize: poster ? 23 : 18, fontWeight: 700, color: SHARE_COLORS.text }}>{label}</span>
            {note && <span style={{ fontSize: poster ? 16 : 13, color: SHARE_COLORS.dim }}>{note}</span>}
        </div>
    );
}
