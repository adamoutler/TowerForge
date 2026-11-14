// The charity event's links and dates, so a typo or a wrong end date
// shows up before it reaches the site.

import { describe, expect, it } from 'vitest';
import { CHARITY_EVENT, charityEventOn } from './community';

describe('charity event', () => {
    it('links only to the fundraiser on Tiltify', () => {
        expect(new URL(CHARITY_EVENT.donateUrl).hostname).toBe('donate.tiltify.com');
        expect(new URL(CHARITY_EVENT.fundraiserUrl).hostname).toBe('tiltify.com');
        expect(CHARITY_EVENT.fundraiserUrl).toMatch(/children/);   // the cause Tiltify names
    });

    it('shows through the end of Sunday, Nov 15 (US Eastern), and not after', () => {
        expect(charityEventOn(Date.parse('2026-11-09T20:00:00Z'))).toBe(true);
        expect(charityEventOn(Date.parse('2026-11-15T23:59:00-05:00'))).toBe(true);
        expect(charityEventOn(Date.parse('2026-11-16T00:00:00-05:00'))).toBe(false);
    });
});
