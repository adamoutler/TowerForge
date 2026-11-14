// ============================================================
//  TowerForge Companion — Trophy shelf (Profile)
//  What the account has done, as trophies (engine/trophies.ts: highest
//  tier and wave, highest league and best finish there, first places,
//  top-3 finishes, promotions, tournaments, UWs), with Share picture;
//  under it every moment this browser's imports found in the last year
//  (store/moments.ts), each with its own picture. Styles: trophy- in
//  tabs.css.
// ============================================================

import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { useMomentLog } from '../../store/moments';
import { MOMENT_ICON } from '../../engine/moments';
import { trophies } from '../../engine/trophies';
import { ShelfPicture } from '../share/RecapPictures';
import { useShareMoment, useSharePicture } from '../share/useSharePicture';
import { trackEvent } from '../../analytics';

const SHOWN_MOMENTS = 4;
const SHOWN_TROPHIES = 6;
const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function TrophyShelf({ example }: { example: boolean }) {
    const profile = useGameStore(s => s.profile);
    const tierWaves = useGameStore(s => s.tierWaves);
    const tourneyRecords = useGameStore(s => s.tourneyRecords);
    const uws = useGameStore(s => s.uwData.data);
    const log = useMomentLog();
    const [all, setAll] = useState(false);
    const [allTrophies, setAllTrophies] = useState(false);
    const { share, offscreen } = useSharePicture();
    const { shareMoment, offscreen: momentOffscreen } = useShareMoment();
    const shelf = useMemo(() => trophies({ highestTier: profile.highestTier, tierWaves, league: profile.league, tourneyRecords, uws }),
        [profile.highestTier, profile.league, tierWaves, tourneyRecords, uws]);
    const moments = example ? [] : log;

    if (shelf.length < 2) return null;
    const shareShelf = () => {
        share(<ShelfPicture shelf={shelf} now={Date.now()} />, 'towerforge-trophy-shelf', 'Trophy shelf');
        trackEvent('Trophy shelf', { step: 'share', trophies: shelf.length });
    };

    return (
        <section className="trophy" aria-labelledby="trophy-title">
            <div className="trophy-head">
                <h3 id="trophy-title" className="home-week-title">Trophy shelf</h3>
                <button type="button" className="home-now-link home-now-btn" onClick={shareShelf}>📸 Share picture</button>
            </div>
            <ul className="trophy-grid">
                {(allTrophies ? shelf : shelf.slice(0, SHOWN_TROPHIES)).map(t => (
                    <li key={t.id} className="trophy-item">
                        <span className="trophy-icon" aria-hidden="true">{t.icon}</span>
                        <span className="trophy-text">
                            <span className="trophy-value">{t.value}</span>
                            <span className="trophy-title">{t.title}</span>
                            {t.note && <span className="trophy-note">{t.note}</span>}
                        </span>
                    </li>
                ))}
            </ul>
            {shelf.length > SHOWN_TROPHIES && (
                <button type="button" className="trophy-all" onClick={() => setAllTrophies(a => !a)}>
                    {allTrophies ? 'Show fewer' : `Show all ${shelf.length} trophies`}
                </button>
            )}
            {moments.length > 0 && (
                <>
                    <h4 className="trophy-sub">Moments from your imports</h4>
                    <ul className="trophy-moments">
                        {(all ? moments : moments.slice(0, SHOWN_MOMENTS)).map(m => (
                            <li key={m.id}>
                                <span aria-hidden="true">{MOMENT_ICON[m.kind]}</span>
                                <span className="trophy-moment-text"><strong>{m.title}</strong> {m.value} <span className="trophy-note">{m.label}, {dateText(m.at)}</span></span>
                                <button type="button" className="home-now-link home-now-btn" onClick={() => shareMoment(m)} aria-label={`Share picture: ${m.title}`}>📸</button>
                            </li>
                        ))}
                    </ul>
                    {moments.length > SHOWN_MOMENTS && (
                        <button type="button" className="trophy-all" onClick={() => setAll(a => !a)}>
                            {all ? 'Show fewer' : `Show all ${moments.length}`}
                        </button>
                    )}
                </>
            )}
            {offscreen}
            {momentOffscreen}
        </section>
    );
}
