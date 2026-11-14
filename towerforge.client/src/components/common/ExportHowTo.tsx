// ============================================================
//  TowerForge Companion — Where the game's export is
//  The Tower hides External Tools Export: tap your player ID at the
//  bottom left of Settings 5 times to bring it up (owner, 2026-11-13,
//  game 29.1.4 — the site's "Settings → External Tools Export" alone
//  left players looking for a button that isn't there). The picture is
//  the owner's Settings screen with the ID ringed and its digits
//  blurred (assets/import/settings-player-id.png; game art used with
//  Tech Tree Games' OK).
// ============================================================

import settingsId from '../../assets/import/settings-player-id.png';

const ALT = 'The Tower’s Settings screen: your player ID is at the bottom left, ringed in gold — tap it 5 times.';

// Folded under "Show me where" (the first-visit guide, the import help).
export default function ExportHowTo() {
    return (
        <details className="exp-how">
            <summary>Show me where</summary>
            <ExportPicture />
        </details>
    );
}

// Open, with a caption (the Import Guide's step 0).
export function ExportPicture() {
    return (
        <figure className="exp-fig">
            <img src={settingsId} alt={ALT} width={196} height={340} loading="lazy" />
            <figcaption>
                In Settings, tap your player ID (bottom left) 5 times to bring up <strong>External Tools Export</strong>.
            </figcaption>
        </figure>
    );
}
