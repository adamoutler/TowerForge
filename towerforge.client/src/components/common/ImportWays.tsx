// ============================================================
//  TowerForge Companion — Ways to bring the game's data in
//  The ways that work on this device, best first, for the Import help
//  (ImportSheet) and the first-visit guide (WelcomeGuide):
//    Windows — TowerForge Link (emulator, Android over Wi-Fi, iPhone
//              backups), or the file;
//    Mac     — one Terminal line copies the export of The Tower on the
//              Mac to the Desktop; an iPhone through a Finder backup;
//    Android — TowerForge Link for Android (Shizuku): Android 11+ hides
//              the game's folder from the file picker;
//    iPhone  — nothing on the phone can open the export, so a computer
//              backup, or an account that was filled on another device.
//  Signed out, it offers signing in: an account carries the stats from
//  the device that imported. docs/towerforge-link.md has why each way.
// ============================================================

import { useState } from 'react';
import type { ChangeEvent, MouseEvent, ReactNode } from 'react';
import { TAB_PATHS } from '../../routes';
import { trackEvent } from '../../analytics';
import { copyText } from './copyText';
import { MAC_EXPORT_COMMAND } from './importDevice';
import type { ImportDevice } from './importDevice';

interface Props {
    device: ImportDevice;
    signedIn: boolean;
    onImportFile: (e: ChangeEvent<HTMLInputElement>) => void;
    onLink: () => void;                 // Windows: read it with Link · Android: set up Link for Android
    onGuide: (part: string) => void;    // the Import Guide, at that part
    onSignIn: () => void;
    foot?: boolean;                     // the "export first / Import Guide" line (the welcome guide has its own)
    onExample?: () => void;             // "Just looking?": the example account (empty pages only)
}

const ACCEPT = '.json,application/json,.pdf,application/pdf';

export default function ImportWays({ device, signedIn, onImportFile, onLink, onGuide, onSignIn, foot = true, onExample }: Props) {
    const [copied, setCopied] = useState(false);
    const count = (step: string) => trackEvent('Import help', { step, device });

    const guide = (part: string, text: ReactNode) => (
        <a href={`${TAB_PATHS.importguide}#${part}`} onClick={(e: MouseEvent) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            count('guide');
            onGuide(part);
        }}>{text}</a>
    );

    const file = (label: string) => (
        <label className="btn btn-gold imp-btn">
            📄 {label}
            <input type="file" accept={ACCEPT} hidden onChange={e => { count('file'); onImportFile(e); }} />
        </label>
    );

    const link = (label: string) => (
        <button type="button" className="btn btn-primary imp-btn" onClick={() => { count('link'); onLink(); }}>{label}</button>
    );

    async function copyCommand() {
        if (await copyText(MAC_EXPORT_COMMAND)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    }

    return (
        <div className="imp-ways">
            {device === 'windows' && <>
                <div className="imp-way imp-best">
                    <p><strong>Play on an emulator on this PC, or on a phone?</strong> TowerForge Link, a small Windows
                        helper, reads the export for you. Set it up once; after that it&apos;s one click, or automatic.</p>
                    {link('🖥 Get it with TowerForge Link')}
                </div>
                <div className="imp-way">
                    <p><strong>Already have <code>tool_export.json</code> on this PC?</strong> A PDF of it works too.</p>
                    {file('Choose the file')}
                </div>
            </>}

            {device === 'mac' && <>
                <div className="imp-way imp-best">
                    <p><strong>The Tower on this Mac:</strong> paste this line into Terminal (⌘ Space, “Terminal”) to copy
                        the export to your Desktop, then choose it below.</p>
                    <div className="imp-cmd">
                        <code>{MAC_EXPORT_COMMAND}</code>
                        <button type="button" className="imp-copy" onClick={() => void copyCommand()}>{copied ? '✓ Copied' : 'Copy'}</button>
                    </div>
                    {file('Choose the file')}
                </div>
                <div className="imp-way">
                    <p><strong>On an iPhone:</strong> back it up to this Mac in Finder, then copy the file out of the
                        backup ({guide('mac', 'how')}). TowerForge Link, the one-click helper, is Windows-only for now.</p>
                </div>
            </>}

            {device === 'android' && <>
                <div className="imp-way imp-best">
                    <p><strong>The game keeps its export in its own folder</strong>, which Android hides from other apps and
                        from the file picker. <strong>TowerForge Link for Android</strong> (free, with the Shizuku app)
                        brings it into this page. Set it up once; after that it&apos;s one tap.</p>
                    {link('📱 Set up TowerForge Link for Android')}
                </div>
                <div className="imp-way">
                    <p><strong>Have a Windows PC?</strong> TowerForge Link there can read this phone over Wi-Fi
                        ({guide('android-pc', 'how')}). <strong>Copied the file out already</strong> (Android 10 or older,
                        or a file manager that opens <code>Android/data</code>)?</p>
                    {file('Choose the file')}
                </div>
            </>}

            {device === 'ios' && <>
                <div className="imp-way imp-best">
                    <p><strong>iOS keeps the game&apos;s export inside the game.</strong> Nothing on the iPhone (Files,
                        Safari or another app) can open it, so it comes out through a computer:</p>
                    <ul className="imp-list">
                        <li><strong>A Windows PC:</strong> back the iPhone up there, and TowerForge Link reads the export
                            from the backup ({guide('iphone', 'step by step')}).</li>
                        <li><strong>A Mac:</strong> back it up in Finder and copy the file out ({guide('mac', 'how')}).</li>
                    </ul>
                </div>
                <div className="imp-way">
                    <p><strong>Got <code>tool_export.json</code> onto this iPhone</strong> (AirDrop, Files)?</p>
                    {file('Choose the file')}
                </div>
            </>}

            {device === 'other' && <>
                <div className="imp-way imp-best">
                    <p><strong>Get <code>tool_export.json</code> onto this device</strong> ({guide('igd-top', 'how, for each device')}),
                        then choose it. TowerForge Link, the one-click helper, is Windows-only for now.</p>
                    {file('Choose the file')}
                </div>
            </>}

            {!signedIn && (
                <div className="imp-way imp-account">
                    <p><strong>Imported on another device?</strong> Sign in to your TowerForge account there and here, and
                        your stats come with you{device === 'ios' ? ': import on a computer, check them on your iPhone' : ''}.</p>
                    <button type="button" className="btn btn-dim imp-btn" onClick={() => { count('account'); onSignIn(); }}>
                        👤 Sign in or make an account
                    </button>
                </div>
            )}

            {onExample && (
                <p className="imp-try">
                    <strong>Just looking?</strong>{' '}
                    <button type="button" className="imp-try-btn" onClick={() => { count('example'); onExample(); }}>
                        Try an example account
                    </button>{' '}
                    first: a made-up player fills every page.
                </p>
            )}

            {foot && (
                <p className="imp-foot">
                    First time? In the game, export your data first: Settings → <strong>External Tools Export</strong>.
                    Stuck, or on another device? The {guide('igd-top', 'Import Guide')} shows every way, screen by screen.
                </p>
            )}
        </div>
    );
}
