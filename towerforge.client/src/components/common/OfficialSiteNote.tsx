// ============================================================
//  TowerForge Companion — "This is a copy" note
//  A copy of the site hosted on another address keeps this note at
//  the top (owner, 2026-11-07), so players know it isn't the
//  official site and can open the same page on towerforge.net. Data
//  a player enters stays with the address they entered it on, so the
//  note says so. Nothing shows on towerforge.net or while developing
//  (constants/officialSite.ts).
// ============================================================

import { isOfficialHost, OFFICIAL_ORIGIN } from '../../constants/officialSite';

export default function OfficialSiteNote() {
    if (isOfficialHost(window.location.hostname)) return null;
    return (
        <div className="ofc-note" role="note">
            <span>
                <strong>This is a copy of TowerForge, not the official site.</strong>{' '}
                What you enter here stays on this copy.
            </span>
            <a className="ofc-link" href={OFFICIAL_ORIGIN + window.location.pathname}>Open towerforge.net</a>
        </div>
    );
}
