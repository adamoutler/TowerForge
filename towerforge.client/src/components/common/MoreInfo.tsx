// ============================================================
//  TowerForge Companion — More info
//  A long explanation folded under a one-line summary, so a page
//  shows its numbers first and the "how this works" text only when a
//  player asks for it (owner, 2026-11-02: the site felt overwhelming).
//  A native <details>, so it opens with a tap or Enter and needs no state.
//  Styles: .more-info in styles/app.css.
// ============================================================

import type { ReactNode } from 'react';

export default function MoreInfo({ summary, children }: { summary: string; children: ReactNode }) {
    return (
        <details className="more-info">
            <summary>{summary}</summary>
            <div className="more-info-body">{children}</div>
        </details>
    );
}
