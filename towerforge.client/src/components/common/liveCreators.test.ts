// Creators live now: what the site takes from the server's answer, and
// how long a stream has been on.

import { describe, expect, it } from 'vitest';
import { liveFor, readLive } from './liveCreators';

describe('live creators', () => {
    it('keeps streams that link to the stream on Twitch or YouTube, and drops the rest', () => {
        const live = readLive({
            checkedAt: '2026-11-09T18:00:00Z',
            live: [
                { code: 'H3ll', platform: 'twitch', url: 'https://www.twitch.tv/h3llxspawnerx', title: 'Tier 18 farming', startedAt: '2026-11-09T17:00:00Z', viewers: 12 },
                { code: 'flipstar', platform: 'youtube', url: 'https://www.youtube.com/watch?v=B6L9FOlTyzU', title: 'the forever stream', startedAt: '2026-11-09T17:39:57Z', viewers: null },
                { code: 'x', platform: 'youtube', url: 'https://evil.example/watch?v=1', title: 'nope' },
                { code: 'y', platform: 'kick', url: 'https://kick.com/y', title: 'nope' },
                { code: 'z', platform: 'twitch', url: 'javascript:alert(1)', title: 'nope' },
                null,
            ],
        });
        expect(live.map(s => s.code)).toEqual(['H3ll', 'flipstar']);
        expect(live[0].viewers).toBe(12);
        expect(live[1].viewers).toBeNull();
        expect(readLive(null)).toEqual([]);
        expect(readLive({ live: 'no' })).toEqual([]);
    });

    it('says how long a stream has been on', () => {
        const now = Date.parse('2026-11-09T18:30:00Z');
        expect(liveFor('2026-11-09T18:29:40Z', now)).toBe('1m');
        expect(liveFor('2026-11-09T18:05:00Z', now)).toBe('25m');
        expect(liveFor('2026-11-09T17:10:00Z', now)).toBe('1h 20m');
        expect(liveFor('2026-11-07T15:30:00Z', now)).toBe('2d 3h');
        expect(liveFor('', now)).toBe('');
    });
});
