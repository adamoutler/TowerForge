// ============================================================
//  TowerForge Companion — Page intro
//  A page's name in one line, with its "how this page works" paragraph
//  folded under it (owner, 2026-11-02: the site felt overwhelming, and
//  every page opened on a paragraph). Notes that tell a player what to
//  do next, like "import your runs", stay plain .relics-note boxes.
//  Styles: .page-intro in components/tabs/tabs.css.
// ============================================================

import type { ReactNode } from 'react';

export default function PageIntro({ title, children }: { title: ReactNode; children: ReactNode }) {
    return (
        <details className="relics-note page-intro">
            <summary>
                <strong>{title}</strong>
                <span className="page-intro-more">How this page works</span>
            </summary>
            <div className="page-intro-body">{children}</div>
        </details>
    );
}
