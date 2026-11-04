// ============================================================
//  TowerForge Companion — Tower Art
//  The neon tower drawn in the middle of the module board
//  (decoration; layout in constants/moduleBoard). Used by the
//  Modules tab and the shared-stats Modules card; TowerShape alone
//  (120 × 190 units) is the tower in the home page's battle scene.
// ============================================================

export function TowerShape() {
    return (
        <g fill="none" strokeWidth="3" strokeLinejoin="round">
            <g style={{ stroke: 'var(--accent)' }}>
                <path d="M38 22 L82 22 L88 34 L88 62 L32 62 L32 34 Z" />
                <path d="M12 34 L32 34 L32 48 L12 48 Z" />
                <path d="M44 62 L76 62 L78 76 L42 76 Z" />
                <path d="M42 76 L78 76 L96 150 L24 150 Z" />
            </g>
            <g style={{ stroke: 'var(--accent-2)' }}>
                <path d="M48 32 L72 32 L72 52 L48 52 Z" />
                <path d="M54 88 L66 88 L72 140 L48 140 Z" />
                <path d="M24 150 L32 178 L48 178 L52 150 M68 150 L72 178 L88 178 L96 150" />
            </g>
        </g>
    );
}

export default function TowerArt() {
    return (
        <svg viewBox="0 0 120 190" className="modg-tower" aria-hidden="true">
            <TowerShape />
        </svg>
    );
}
