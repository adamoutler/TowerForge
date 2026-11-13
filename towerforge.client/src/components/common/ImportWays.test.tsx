// The import help offers each device the ways that work there: Link on
// Windows, the Android app on Android, a computer backup on an iPhone
// (no Link button: nothing on the phone can reach the export), the
// Terminal line on a Mac — and signing in only when signed out.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ImportWays from './ImportWays';
import type { ImportDevice } from './importDevice';

const html = (device: ImportDevice, signedIn = false) => renderToStaticMarkup(
    <ImportWays device={device} signedIn={signedIn} onImportFile={() => {}} onLink={() => {}} onGuide={() => {}} onSignIn={() => {}} />,
);

describe('import help', () => {
    it('offers each device the ways that work there', () => {
        expect(html('windows')).toMatch(/Get it with TowerForge Link/);
        expect(html('android')).toMatch(/Set up TowerForge Link for Android/);
        expect(html('mac')).toMatch(/find ~\/Library\/Containers -name tool_export.json/);
        const ios = html('ios');
        expect(ios).toMatch(/Nothing on the iPhone/);
        expect(ios).toMatch(/A Windows PC:/);
        expect(ios).not.toMatch(/TowerForge Link for Android|Get it with TowerForge Link/);
        expect(ios).toMatch(/import on a computer, check them on your iPhone/);
        for (const d of ['windows', 'mac', 'android', 'ios', 'other'] as const) expect(html(d)).toMatch(/Choose the file/);
    });

    it('offers signing in only when signed out', () => {
        expect(html('ios')).toMatch(/Sign in or make an account/);
        expect(html('ios', true)).not.toMatch(/Sign in or make an account/);
    });
});
