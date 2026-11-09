// ============================================================
//  TowerForge Companion — Charity event banner
//  At the top of every page while "Waves of Kindness with The Tower"
//  runs (owner, 2026-11-09): what the event is, a Donate button and the
//  fundraiser page, both on Tiltify, saying plainly the money goes to
//  the charity and not to TowerForge, and the site maker's pledge for
//  their creator code. Calm, not a pop-up: a player can fold it to one
//  line (remembered in this browser), and it folds away with the
//  header while a page is scrolled. Gone on its own after the event
//  (constants/community.ts, CHARITY_EVENT).
// ============================================================

import { useRef, useState } from 'react';
import { CHARITY_EVENT, SITE_CREATOR_CODE, charityEventOn } from '../../constants/community';
import { trackEvent } from '../../analytics';
import { copyText } from './copyText';

const FOLDED_KEY = `tf-charity-${CHARITY_EVENT.id}`;

function readFolded(): boolean {
    try {
        return localStorage.getItem(FOLDED_KEY) === 'folded';
    } catch {
        return false;
    }
}

function saveFolded(folded: boolean) {
    try {
        if (folded) localStorage.setItem(FOLDED_KEY, 'folded');
        else localStorage.removeItem(FOLDED_KEY);
    } catch {
        // Private browsing: it just opens again next visit.
    }
}

const opened = (link: 'donate' | 'fundraiser') => () => trackEvent('Open charity link', { link });

export default function CharityBanner() {
    const [on] = useState(() => charityEventOn(Date.now()));
    const [folded, setFolded] = useState(readFolded);
    const [copied, setCopied] = useState(false);
    const codeRef = useRef<HTMLElement>(null);
    if (!on) return null;

    const fold = (next: boolean) => { setFolded(next); saveFolded(next); };

    async function copy() {
        if (!await copyText(SITE_CREATOR_CODE)) {
            if (codeRef.current) window.getSelection()?.selectAllChildren(codeRef.current);
            return;
        }
        setCopied(true);
        trackEvent('Copy creator code', { code: SITE_CREATOR_CODE, from: 'charity' });
        setTimeout(() => setCopied(false), 1500);
    }

    if (folded) {
        return (
            <aside className="chr-bar chr-folded" aria-label="Charity event">
                <span className="chr-heart" aria-hidden="true">♥</span>
                <span className="chr-line">
                    Charity event for {CHARITY_EVENT.cause}, until {CHARITY_EVENT.until}
                </span>
                <a className="chr-inline" href={CHARITY_EVENT.donateUrl} target="_blank" rel="noopener noreferrer"
                    onClick={opened('donate')}>Donate</a>
                <button type="button" className="chr-toggle" onClick={() => fold(false)} aria-expanded="false">
                    More
                </button>
            </aside>
        );
    }

    return (
        <aside className="chr-bar" aria-label="Charity event">
            <div className="chr-inner">
                <div className="chr-main">
                    <p className="chr-title">
                        <span className="chr-heart" aria-hidden="true">♥</span>
                        {CHARITY_EVENT.name}
                        <span className="chr-until"> · until {CHARITY_EVENT.until}</span>
                    </p>
                    <p className="chr-text">
                        A charity drive with Tech Tree Games for <strong>{CHARITY_EVENT.cause}</strong>{' '}
                        ({CHARITY_EVENT.program}). Donations go through Tiltify to the charity, not to TowerForge.
                    </p>
                    <p className="chr-pledge">
                        <strong>From TowerForge&apos;s maker:</strong> everything code{' '}
                        <code className="chr-code" ref={codeRef}>{SITE_CREATOR_CODE}</code> earns from today
                        through Sunday goes to {CHARITY_EVENT.pledgeCause} once it&apos;s paid out.{' '}
                        <button type="button" className="chr-copy" onClick={() => void copy()}
                            aria-label={`Copy creator code ${SITE_CREATOR_CODE}`}>
                            {copied ? '✓ Copied' : 'Copy code'}
                        </button>
                    </p>
                </div>
                <div className="chr-actions">
                    <a className="chr-donate" href={CHARITY_EVENT.donateUrl} target="_blank" rel="noopener noreferrer"
                        onClick={opened('donate')}>
                        Donate to the charity
                    </a>
                    <a className="chr-page" href={CHARITY_EVENT.fundraiserUrl} target="_blank" rel="noopener noreferrer"
                        onClick={opened('fundraiser')}>
                        Fundraiser page
                    </a>
                </div>
                <button type="button" className="chr-close" onClick={() => fold(true)} aria-expanded="true"
                    aria-label="Fold the charity banner to one line" title="Fold to one line">
                    ×
                </button>
            </div>
        </aside>
    );
}
