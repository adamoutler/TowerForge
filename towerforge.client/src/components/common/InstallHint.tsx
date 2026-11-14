// ============================================================
//  TowerForge Companion — "Add TowerForge to your home screen"
//  One quiet line on Profile, only after the player's own import has
//  worked on this device (never on a first visit), not when it's open
//  as the app already, and gone for good once dismissed. Chrome and
//  Edge: Add opens their install prompt. Elsewhere it says where the
//  browser keeps it (installApp.ts). On an iPhone the home-screen app
//  is also what lab reminders need.
// ============================================================

import { useEffect, useState } from 'react';
import { fileImportWorkedHere, linkImportWorkedHere, thisImportDevice } from './importDevice';
import { hideInstallHint, installHintHidden, promptInstall, runningAsApp, useCanPromptInstall } from './installApp';
import { trackEvent } from '../../analytics';

let countedThisVisit = false;

export default function InstallHint() {
    const [device] = useState(thisImportDevice);
    const canPrompt = useCanPromptInstall();
    const [shown, setShown] = useState(() => !installHintHidden() && !runningAsApp() && (fileImportWorkedHere() || linkImportWorkedHere()));
    const [how, setHow] = useState(false);
    const phone = device === 'ios' || device === 'android';
    const visible = shown && (phone || canPrompt);

    useEffect(() => {
        if (visible && !countedThisVisit) {
            countedThisVisit = true;
            trackEvent('Install app', { step: 'shown', device });
        }
    }, [visible, device]);

    if (!visible) return null;

    const add = async () => {
        if (canPrompt) {
            if (await promptInstall()) setShown(false);
        } else {
            setHow(true);
            trackEvent('Install app', { step: 'how', device });
        }
    };
    const dismiss = () => {
        hideInstallHint();
        setShown(false);
        trackEvent('Install app', { step: 'not now', device });
    };

    return (
        <aside className="home-install" aria-label="Add TowerForge to your home screen">
            <span className="home-install-icon" aria-hidden="true">📲</span>
            <span className="home-install-text">
                <strong>Add TowerForge to your {phone ? 'home screen' : 'apps'}</strong> — one tap back to your numbers
                {device === 'ios' ? ', and lab reminders on iPhone' : ''}.
                {how && (
                    <span className="home-install-how">
                        {device === 'ios'
                            ? 'In Safari, tap Share (the square with the arrow), then Add to Home Screen.'
                            : 'In your browser’s menu (⋮), tap Add to Home screen or Install app.'}
                    </span>
                )}
            </span>
            {!how && <button type="button" className="home-now-link home-now-btn" onClick={() => void add()}>{canPrompt ? 'Add' : 'How'}</button>}
            <button type="button" className="home-install-close" onClick={dismiss} aria-label="Not now">✕</button>
        </aside>
    );
}
