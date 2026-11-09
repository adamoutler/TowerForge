// ============================================================
//  TowerForge Companion — Theme picker (header)
//  Eight color themes; the palettes live in styles/variables.css and
//  everything else is mixed from them. The pick goes on
//  <html data-theme> and is remembered per browser (localStorage
//  tc_theme); index.html sets it before the page paints, so a reload
//  doesn't flash the default. Each swatch sets data-theme on itself,
//  so it shows its theme's real colors.
// ============================================================

import { useEffect, useState } from 'react';
import { trackEvent } from '../../analytics';

const KEY = 'tc_theme';
const DEFAULT_THEME = 'synthwave';

const THEMES: { id: string; name: string; colors: string }[] = [
    { id: 'synthwave', name: 'Synthwave', colors: 'Hot pink and electric violet' },
    { id: 'mint', name: 'Neon Mint', colors: 'Mint and violet' },
    { id: 'ember', name: 'Ember', colors: 'Amber and rose' },
    { id: 'acid', name: 'Acid', colors: 'Lime and aqua' },
    { id: 'crimson', name: 'Crimson', colors: 'Red and violet' },
    { id: 'ultraviolet', name: 'Ultraviolet', colors: 'Violet and electric blue' },
    { id: 'stealth', name: 'Stealth', colors: 'Silver and steel on graphite' },
    { id: 'royal', name: 'Royal Gold', colors: 'Gold and royal blue' },
];

function load(): string {
    try {
        const t = localStorage.getItem(KEY);
        return THEMES.some(x => x.id === t) ? t as string : DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
}

function apply(id: string): void {
    const root = document.documentElement;
    root.dataset.theme = id;
    // Phone browsers tint their address bar with theme-color.
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export default function ThemePicker() {
    const [theme, setTheme] = useState(load);
    const [open, setOpen] = useState(false);

    useEffect(() => { apply(theme); }, [theme]);

    // Esc closes the picker.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const pick = (id: string) => {
        if (id === theme) return;
        setTheme(id);
        try { localStorage.setItem(KEY, id); } catch { /* not remembered */ }
        trackEvent('Theme', { theme: id });
    };

    return (
        <>
            <button className="btn btn-dim thm-btn" onClick={() => setOpen(true)} title="Pick the site's colors" aria-label="Theme">
                🎨<span className="hdr-label"> Theme</span>
            </button>
            {open && (
                <div className="modal-overlay" onClick={() => setOpen(false)}>
                    <div className="modal-box thm-box" role="dialog" aria-label="Theme" onClick={e => e.stopPropagation()}>
                        <div className="modal-head">
                            <span className="modal-title">Theme</span>
                            <button className="btn btn-dim" onClick={() => setOpen(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p className="thm-intro">Pick the site's colors. It changes right away and this browser remembers it.</p>
                            <div className="thm-grid">
                                {THEMES.map(t => (
                                    <button
                                        key={t.id}
                                        data-theme={t.id}
                                        className={`thm-card ${t.id === theme ? 'on' : ''}`}
                                        aria-pressed={t.id === theme}
                                        onClick={() => pick(t.id)}
                                    >
                                        <span className="thm-logo">Tower<span>Forge</span></span>
                                        <span className="thm-line" />
                                        <span className="thm-chips" aria-hidden="true">
                                            <i className="thm-chip a" />
                                            <i className="thm-chip b" />
                                            <i className="thm-chip g" />
                                        </span>
                                        <span className="thm-name">{t.name}</span>
                                        <span className="thm-colors">{t.id === theme ? '✓ In use' : t.colors}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
