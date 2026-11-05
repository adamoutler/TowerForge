// ============================================================
//  TowerForge Companion — Creator Codes Tab
//  Every content creator's code in one list: search by code, name or
//  what they're known for, copy a code with one tap, and open their
//  channels. The YouTube button is the creator's profile picture.
//  The site maker's code is pinned first, marked "Made TowerForge"
//  (owner, 2026-11-05).
// ============================================================

import { useState } from 'react';
import { CREATORS, CREATOR_SITES, WEBSTORE_URL, creatorSlug } from '../../constants/creatorCodes';
import type { CreatorLink, CreatorSite } from '../../constants/creatorCodes';
import { SITE_CREATOR_CODE } from '../../constants/community';
import { trackEvent } from '../../analytics';
import { copyText } from '../common/copyText';

const SITES = Object.keys(CREATOR_SITES) as CreatorSite[];

// Fancy-letter names (𝓥𝓒𝓜𝓸𝓶𝓸) fold to plain letters, so "vcmomo" finds them.
const fold = (s: string) => s.normalize('NFKC').toLowerCase();
const plain = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, '');
const SEARCH_TEXT = new Map(CREATORS.map(c => [c, fold([c.code, c.name, c.player, c.about ?? ''].join(' '))]));

// The site maker's code first, the rest in list order.
const ORDERED = [
    ...CREATORS.filter(c => c.code === SITE_CREATOR_CODE),
    ...CREATORS.filter(c => c.code !== SITE_CREATOR_CODE),
];

// Links in site order; a website shows its address unless it has a label.
const byFixedOrder = (a: CreatorLink, b: CreatorLink) => SITES.indexOf(a.site) - SITES.indexOf(b.site);
const linkLabel = (l: CreatorLink) =>
    l.label ?? (l.site === 'website' ? new URL(l.url).hostname.replace(/^www\./, '') : CREATOR_SITES[l.site]);

// YouTube profile pictures by code slug (saved by scripts/fetch-creator-avatars.mjs).
const AVATARS: Record<string, string> = Object.fromEntries(
    Object.entries(import.meta.glob('../../assets/creators/*.{jpg,png,webp}', { eager: true, import: 'default' }) as Record<string, string>)
        .map(([path, url]) => [path.split('/').pop()!.replace(/\.\w+$/, ''), url]),
);

export default function CreatorCodesTab() {
    const [search, setSearch] = useState('');
    const [copied, setCopied] = useState<string | null>(null);

    const q = fold(search.trim());
    const shown = q ? ORDERED.filter(c => SEARCH_TEXT.get(c)!.includes(q)) : ORDERED;

    // Copies a code; if the browser won't, selects it on screen so the
    // player can copy it themselves.
    async function copy(code: string, codeEl: Element | null) {
        if (!await copyText(code)) {
            if (codeEl) window.getSelection()?.selectAllChildren(codeEl);
            return;
        }
        setCopied(code);
        trackEvent('Copy creator code', { code });
        setTimeout(() => setCopied(c => (c === code ? null : c)), 1500);
    }

    return (
        <div>
            <div className="relics-note cc-note">
                <strong>Support a creator:</strong> enter their code in the game&apos;s Settings, or on
                the <a href={WEBSTORE_URL} target="_blank" rel="noopener noreferrer">webstore</a>.
                They get 5% of what you spend in the game and 8% on the webstore, at no extra cost
                to you. A code stays active for 30 days.
            </div>

            <div className="modg-filters">
                <input
                    type="text"
                    className="search-bar"
                    style={{ margin: 0, flex: 1, minWidth: '160px' }}
                    placeholder="🔍  Search code, name or what they do..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <span className="cc-count">{shown.length} of {CREATORS.length} creators</span>
            </div>

            {shown.length === 0 && <div className="cc-empty">No creator matches “{search.trim()}”.</div>}

            <div className="cc-grid">
                {shown.map(c => {
                    const links = [...c.links].sort(byFixedOrder);
                    const avatar = AVATARS[creatorSlug(c.code)];
                    // The code-list name, when it isn't just the name above it.
                    const showPlayer = !plain(c.name).includes(plain(c.player));
                    const ours = c.code === SITE_CREATOR_CODE;
                    return (
                        <div key={c.code} className={`cc-card ${ours ? 'cc-ours' : ''}`}>
                            {ours && <span className="cc-ours-tag">Made TowerForge</span>}
                            <div className="cc-top">
                                <span className="cc-code">{c.code}</span>
                                <button
                                    className={`cc-copy ${copied === c.code ? 'done' : ''}`}
                                    onClick={e => copy(c.code, e.currentTarget.previousElementSibling)}
                                    aria-label={`Copy creator code ${c.code}`}
                                >
                                    {copied === c.code ? '✓ Copied' : 'Copy'}
                                </button>
                            </div>
                            <div className="cc-player">{c.name}</div>
                            {(showPlayer || c.playerId) && (
                                <div className="cc-meta">
                                    {showPlayer && <span>{c.player}</span>}
                                    {c.playerId && <span className="cc-id">ID {c.playerId}</span>}
                                </div>
                            )}
                            {c.about && <div className="cc-about">{c.about}</div>}
                            {links.length > 0 && (
                                <div className="cc-links">
                                    {links.map(l => (
                                        l.site === 'youtube' && avatar ? (
                                            <a
                                                key={l.url}
                                                className="cc-avatar"
                                                href={l.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title={`${c.name} on YouTube`}
                                                aria-label={`${c.name} on YouTube`}
                                                onClick={() => trackEvent('Open creator link', { code: c.code, site: l.site })}
                                            >
                                                <img src={avatar} alt="" width={44} height={44} loading="lazy" />
                                            </a>
                                        ) : (
                                            <a
                                                key={l.url}
                                                className="cc-link"
                                                data-site={l.site}
                                                href={l.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={() => trackEvent('Open creator link', { code: c.code, site: l.site })}
                                            >
                                                {linkLabel(l)}
                                            </a>
                                        )
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
