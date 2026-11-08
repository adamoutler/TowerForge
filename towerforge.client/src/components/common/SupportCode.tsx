// ============================================================
//  TowerForge Companion — Support line (Profile page)
//  One quiet line at the foot of the Profile page with the site
//  maker's creator code and a copy button (owner, 2026-11-05: easy to
//  see, not in the way). How codes work is on the Creator Codes tab.
//  It says outright that the maker earns from the code (the FTC's
//  endorsement rules ask for a clear disclosure, 2026-11-08).
// ============================================================

import { useRef, useState } from 'react';
import { SITE_CREATOR_CODE } from '../../constants/community';
import { WEBSTORE_URL } from '../../constants/creatorCodes';
import { trackEvent } from '../../analytics';
import { copyText } from './copyText';

export default function SupportCode() {
    const [copied, setCopied] = useState(false);
    const codeRef = useRef<HTMLElement>(null);

    // If the browser won't copy, select the code so the player can.
    async function copy() {
        if (!await copyText(SITE_CREATOR_CODE)) {
            if (codeRef.current) window.getSelection()?.selectAllChildren(codeRef.current);
            return;
        }
        setCopied(true);
        trackEvent('Copy creator code', { code: SITE_CREATOR_CODE, from: 'profile' });
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        <aside className="sup-line" aria-label="Support TowerForge">
            <span className="sup-heart" aria-hidden="true">♥</span>
            <span className="sup-text">
                Enjoying TowerForge? Support it with its maker&apos;s creator code{' '}
                <code className="sup-code" ref={codeRef}>{SITE_CREATOR_CODE}</code>
                {' '}in the game&apos;s Settings or on the{' '}
                <a href={WEBSTORE_URL} target="_blank" rel="noopener noreferrer">webstore</a>:
                the maker gets a share of what you spend, at no extra cost to you.
            </span>
            <button className={`cc-copy ${copied ? 'done' : ''}`} onClick={() => void copy()}
                aria-label={`Copy creator code ${SITE_CREATOR_CODE}`}>
                {copied ? '✓ Copied' : 'Copy'}
            </button>
        </aside>
    );
}
