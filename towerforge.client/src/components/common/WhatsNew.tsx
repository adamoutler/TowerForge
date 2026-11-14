// ============================================================
//  TowerForge Companion — What's new (Profile, footer)
//  WhatsNewCard: on Profile, once, the releases a returning visitor
//  hasn't seen (whatsNew.ts), until closed. WhatsNewList: every entry,
//  from the footer's "What's new". Styles: wnew- in tabs.css.
// ============================================================

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { WHATS_NEW, markSeen, seenVersion, unseen } from '../../whatsNew';
import type { WhatsNewEntry } from '../../whatsNew';
import { TAB_PATHS } from '../../routes';
import type { TabName } from '../../types/gameTypes';
import { trackEvent } from '../../analytics';

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
const dateText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

function Items({ entry, onOpen }: { entry: WhatsNewEntry; onOpen?: (tab: TabName) => void }) {
    return (
        <ul className="wnew-items">
            {entry.items.map((it, i) => (
                <li key={i}>
                    {it.text}
                    {it.tab && (
                        <> <a href={TAB_PATHS[it.tab]} onClick={e => { if (onOpen && plainClick(e)) { e.preventDefault(); onOpen(it.tab!); } }}>{it.link ?? 'Open'}</a></>
                    )}
                </li>
            ))}
        </ul>
    );
}

let counted = false;

export function WhatsNewCard({ onOpen }: { onOpen: (tab: TabName) => void }) {
    const [entries, setEntries] = useState(() => unseen(WHATS_NEW, seenVersion(), __APP_VERSION__));
    useEffect(() => {
        if (entries.length && !counted) {
            counted = true;
            trackEvent('Whats new', { step: 'shown', version: __APP_VERSION__ });
        }
    }, [entries.length]);
    if (!entries.length) return null;
    const close = () => {
        markSeen();
        setEntries([]);
        trackEvent('Whats new', { step: 'closed', version: __APP_VERSION__ });
    };
    return (
        <section className="wnew" aria-labelledby="wnew-title">
            <h3 id="wnew-title" className="wnew-title">✨ New in TowerForge</h3>
            {entries.map(e => (
                <div key={e.version} className="wnew-entry">
                    {entries.length > 1 && <span className="wnew-ver">v{e.version}, {dateText(e.date)}</span>}
                    <Items entry={e} onOpen={tab => { close(); onOpen(tab); }} />
                </div>
            ))}
            <div className="wnew-actions">
                <button type="button" className="btn btn-dim" onClick={close}>Got it</button>
            </div>
        </section>
    );
}

export function WhatsNewList({ onClose, onOpen }: { onClose: () => void; onOpen?: (tab: TabName) => void }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-box" role="dialog" aria-modal="true" aria-label="What's new in TowerForge" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <span className="modal-title">✨ What&apos;s new</span>
                    <button className="btn btn-dim" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className="modal-body">
                    {WHATS_NEW.map(e => (
                        <div key={e.version} className="wnew-entry">
                            <span className="wnew-ver">v{e.version}, {dateText(e.date)}</span>
                            <Items entry={e} onOpen={onOpen && (tab => { onClose(); onOpen(tab); })} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
