// ============================================================
//  TowerForge Companion — Moments on Profile
//  What the player's last imports did that's worth showing off (a new
//  tier, a best wave, a promotion, a best tournament finish or wave, a
//  new UW or UW+: engine/moments.ts), each with Share picture: a
//  square image in the game's wave-counter style with towerforge.net
//  on it (share/RecapPictures), through the Export Images window (save,
//  or the phone's share menu → Reddit, Discord, Photos). Shown two weeks
//  or until closed; every one stays on the trophy shelf's list
//  (store/moments.ts).
// ============================================================

import { MOMENT_ICON } from '../../engine/moments';
import { closeMoment, useMoments } from '../../store/moments';
import { useShareMoment } from '../share/useSharePicture';

export default function Moments() {
    const moments = useMoments();
    const { shareMoment, offscreen } = useShareMoment();
    if (!moments.length) return null;
    const [first, ...more] = moments;

    return (
        <section className="mom" aria-label="What your imports did">
            <div className="mom-main">
                <span className="mom-title"><span aria-hidden="true">{MOMENT_ICON[first.kind]}</span> {first.title}</span>
                <div className="mom-row">
                    <div className="home-counter mom-counter">
                        <span className="home-counter-label">{first.label}</span>
                        <span className="home-counter-val">{first.value}</span>
                    </div>
                    <div className="mom-side">
                        {first.detail && <span className="mom-detail">{first.detail}</span>}
                        <button type="button" className="btn btn-accent" onClick={() => shareMoment(first)}>📸 Share picture</button>
                    </div>
                </div>
                <button type="button" className="home-install-close mom-close" onClick={() => closeMoment(first.id)} aria-label={`Close: ${first.title}`}>✕</button>
            </div>
            {more.length > 0 && (
                <ul className="mom-more">
                    {more.map(m => (
                        <li key={m.id}>
                            <span aria-hidden="true">{MOMENT_ICON[m.kind]}</span>
                            <span className="mom-more-text"><strong>{m.title}</strong> {m.value} <span className="mom-detail">{m.label}{m.detail ? `, ${m.detail.charAt(0).toLowerCase()}${m.detail.slice(1)}` : ''}</span></span>
                            <button type="button" className="home-now-link home-now-btn" onClick={() => shareMoment(m)}>📸 Share</button>
                            <button type="button" className="home-install-close" onClick={() => closeMoment(m.id)} aria-label={`Close: ${m.title}`}>✕</button>
                        </li>
                    ))}
                </ul>
            )}
            {offscreen}
        </section>
    );
}
