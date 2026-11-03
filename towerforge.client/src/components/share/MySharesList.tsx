// ============================================================
//  TowerForge Companion — My Share Codes
//  Lists the signed-in player's active share codes with open,
//  copy, and early-delete actions.
// ============================================================

import { useEffect, useState } from 'react';
import { listShares } from '../../engine/accountApi';
import type { AccountShare } from '../../engine/accountApi';
import { deleteShare, shareUrl } from '../../engine/shareApi';
import { useAccountStore } from '../../store/useAccountStore';

const SECTION_LABELS: Record<string, string> = {
    profile: 'Profile',
    uw: 'UWs',
    cards: 'Cards',
    bots: 'Bots',
    modules: 'Modules',
    workshop: 'Workshop',
    labs: 'Labs',
    relics: 'Relics',
    guardian: 'Guardian',
};

function daysLeft(expiresAt: string): number {
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
}

export default function MySharesList() {
    const sharesVersion = useAccountStore(s => s.sharesVersion);
    const [shares, setShares] = useState<AccountShare[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        listShares()
            .then(list => { if (!cancelled) { setShares(list); setError(null); } })
            .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your share codes.'); });
        return () => { cancelled = true; };
    }, [sharesVersion]);

    async function handleCopy(code: string) {
        try {
            await navigator.clipboard.writeText(shareUrl(code));
            setCopied(code);
        } catch {
            setError('Copy failed. Open the link and copy it from the address bar.');
        }
    }

    async function handleDelete(code: string) {
        if (!confirm(`Delete share code ${code}? Anyone with the link will no longer be able to open it.`)) return;
        try {
            await deleteShare(code);
            setShares(prev => prev?.filter(s => s.code !== code) ?? prev);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete the share.');
        }
    }

    if (error) {
        return <p style={{ fontSize: '13px', color: 'var(--red, #e74c3c)' }}>{error}</p>;
    }
    if (!shares) {
        return <p style={{ fontSize: '13px', color: 'var(--text-dim)' }}>Loading your share codes…</p>;
    }
    if (shares.length === 0) {
        return (
            <p style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
                No active share codes. Create one on the Share tab.
            </p>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {shares.map(share => (
                <div key={share.code} className="flex-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
                    <strong style={{ letterSpacing: '2px', fontFamily: 'var(--font-mono)', minWidth: '100px' }}>
                        {share.code}
                    </strong>
                    <span style={{ fontSize: '13px', color: 'var(--text-dim)', flex: 1, minWidth: '160px' }}>
                        {share.sections.map(s => SECTION_LABELS[s] ?? s).join(' · ') || '—'}
                        {' · '}expires in {daysLeft(share.expiresAt)} days
                    </span>
                    <a className="btn btn-dim" href={shareUrl(share.code)} target="_blank" rel="noreferrer">
                        Open
                    </a>
                    <button className="btn btn-dim" onClick={() => handleCopy(share.code)}>
                        {copied === share.code ? '✓ Copied' : 'Copy Link'}
                    </button>
                    <button className="btn btn-dim" onClick={() => handleDelete(share.code)}>
                        Delete
                    </button>
                </div>
            ))}
        </div>
    );
}
