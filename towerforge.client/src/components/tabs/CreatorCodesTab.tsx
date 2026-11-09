// ============================================================
//  TowerForge Companion — Creator Codes Tab
//  Every content creator's code in one list: search by code, name or
//  what they're known for, copy a code with one tap, and open their
//  channels. The YouTube button is the creator's profile picture.
//  The site maker's code is pinned first, marked "Made TowerForge"
//  (owner, 2026-11-05). A creator streaming The Tower right now gets a
//  LIVE badge and their stream, and moves up under it (owner,
//  2026-11-09; only Tower streams — the server checks, see
//  common/liveCreators.ts). During the charity event the maker's card
//  carries their pledge (constants/community.ts, CHARITY_EVENT).
// ============================================================

import { useMemo, useState } from 'react';
import { CREATORS, CREATOR_SITES, WEBSTORE_URL, creatorSlug } from '../../constants/creatorCodes';
import type { CreatorLink, CreatorSite } from '../../constants/creatorCodes';
import { CHARITY_EVENT, SITE_CREATOR_CODE, charityEventOn } from '../../constants/community';
import { trackEvent } from '../../analytics';
import { copyText } from '../common/copyText';
import { liveFor, useLiveCreators } from '../common/liveCreators';
import type { LiveStream } from '../common/liveCreators';

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

const LIVE_ON: Record<LiveStream['platform'], string> = { twitch: 'Twitch', youtube: 'YouTube' };

export default function CreatorCodesTab() {
    const [search, setSearch] = useState('');
    const [copied, setCopied] = useState<string | null>(null);
    const [onlyLive, setOnlyLive] = useState(false);
    const live = useLiveCreators();
    // The maker's pledge on their card while the charity event runs.
    const [charity] = useState(() => charityEventOn(Date.now()));

    const streamsOf = useMemo(() => {
        const by = new Map<string, LiveStream[]>();
        for (const s of live) by.set(s.code, [...(by.get(s.code) ?? []), s]);
        return by;
    }, [live]);
    const liveCount = streamsOf.size;
    const liveOnly = onlyLive && liveCount > 0;

    // The site maker's code stays first; creators live now come next.
    const ordered = useMemo(() => [
        ...ORDERED.filter(c => c.code === SITE_CREATOR_CODE),
        ...ORDERED.filter(c => c.code !== SITE_CREATOR_CODE && streamsOf.has(c.code)),
        ...ORDERED.filter(c => c.code !== SITE_CREATOR_CODE && !streamsOf.has(c.code)),
    ], [streamsOf]);

    const q = fold(search.trim());
    const shown = ordered.filter(c => (!q || SEARCH_TEXT.get(c)!.includes(q)) && (!liveOnly || streamsOf.has(c.code)));

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
        <div className="cc-page">
            <section className="relics-note cc-note" aria-label="How creator codes work">
                <p>
                    <strong>Support a creator:</strong> enter their code in the game&apos;s Settings or on
                    the <a href={WEBSTORE_URL} target="_blank" rel="noopener noreferrer">webstore</a>. They
                    get a share of what you spend, at no extra cost to you.
                </p>
                <div className="cc-terms">
                    <div className="stat-pill"><span className="stat-pill-label">In the game</span><span className="stat-pill-val">3%</span></div>
                    <div className="stat-pill"><span className="stat-pill-label">Webstore</span><span className="stat-pill-val">5%</span></div>
                    <div className="stat-pill"><span className="stat-pill-label">Code lasts</span><span className="stat-pill-val">30 days</span></div>
                </div>
            </section>

            <div className="modg-filters">
                <input
                    type="text"
                    className="search-bar"
                    style={{ margin: 0, flex: 1, minWidth: '160px' }}
                    placeholder="🔍  Search creators…"
                    aria-label="Search by code, name or what they do"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                {liveCount > 0 && (
                    <button
                        type="button"
                        className="cc-live-filter"
                        aria-pressed={liveOnly}
                        title="Creators streaming The Tower right now"
                        onClick={() => setOnlyLive(v => !v)}
                    >
                        <span className="cc-live-dot" aria-hidden="true" />
                        {liveCount} live now
                    </button>
                )}
                <span className="cc-count">{q || liveOnly ? `${shown.length} of ${CREATORS.length}` : CREATORS.length} creators</span>
            </div>

            {shown.length === 0 && <div className="cc-empty">No creator matches “{search.trim()}”.</div>}

            <div className="cc-grid">
                {shown.map(c => {
                    const links = [...c.links].sort(byFixedOrder);
                    const avatar = AVATARS[creatorSlug(c.code)];
                    // The code-list name, when it isn't just the name above it.
                    const showPlayer = !plain(c.name).includes(plain(c.player));
                    const ours = c.code === SITE_CREATOR_CODE;
                    const streams = streamsOf.get(c.code) ?? [];
                    return (
                        <div key={c.code} className={`cc-card ${ours ? 'cc-ours' : ''} ${streams.length ? 'cc-is-live' : ''}`}>
                            {(ours || streams.length > 0) && (
                                <div className="cc-tags">
                                    {ours && <span className="cc-ours-tag">Made TowerForge</span>}
                                    {streams.length > 0 && (
                                        <span className="cc-live-tag" title="Streaming The Tower right now">
                                            <span className="cc-live-dot" aria-hidden="true" />Live
                                        </span>
                                    )}
                                </div>
                            )}
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
                            {ours && charity && (
                                <div className="cc-pledge">
                                    <span aria-hidden="true">♥ </span>Everything this code earns through {CHARITY_EVENT.until} goes to{' '}
                                    {CHARITY_EVENT.pledgeCause}.
                                </div>
                            )}
                            {streams.map(s => {
                                const on = liveFor(s.startedAt);
                                return (
                                    <a
                                        key={s.url}
                                        className="cc-stream"
                                        data-site={s.platform}
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => trackEvent('Open creator link', { code: c.code, site: s.platform, live: 1 })}
                                    >
                                        <span className="cc-stream-where">
                                            Live on {LIVE_ON[s.platform]}
                                            {on && <> · {on}</>}
                                            {s.viewers !== null && <> · {s.viewers.toLocaleString()} watching</>}
                                        </span>
                                        {s.title && <span className="cc-stream-title">{s.title}</span>}
                                        <span className="cc-stream-watch">Watch on {LIVE_ON[s.platform]}</span>
                                    </a>
                                );
                            })}
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
