// Checks on the creator list, so a typo when adding a creator or a
// link shows up before it reaches the site.

import { describe, expect, it } from 'vitest';
import { CREATORS, CREATOR_SITES, creatorChannels, creatorLink, creatorSlug } from './creatorCodes';
import type { CreatorSite } from './creatorCodes';
// The server's copy, read as text so the type-check needs nothing from Node.
import channelsJson from '../../../TowerForge.Server/creator-channels.json?raw';

// The address each link should point at, per site.
const HOSTS: Record<CreatorSite, RegExp> = {
    youtube: /^(www\.)?youtube\.com$/,
    twitch: /^(www\.)?twitch\.tv$/,
    kick: /^(www\.)?kick\.com$/,
    tiktok: /^(www\.)?tiktok\.com$/,
    discord: /^(discord\.gg|(www\.)?discord\.com)$/,
    reddit: /^(www\.)?reddit\.com$/,
    x: /^(www\.)?(x|twitter)\.com$/,
    github: /^(www\.)?github\.com$/,
    website: /./,
};

describe('creator codes', () => {
    it('has every creator once, with a code and names', () => {
        const codes = CREATORS.map(c => c.code.toLowerCase());
        expect(new Set(codes).size).toBe(codes.length);
        for (const c of CREATORS) {
            expect(c.code.trim()).toBe(c.code);
            expect(c.code).not.toBe('');
            expect(c.name.trim()).not.toBe('');
            expect(c.player.trim()).not.toBe('');
            if (c.playerId !== undefined) expect(c.playerId).toMatch(/^[0-9A-F]{1,16}$/);
            if (c.about !== undefined) expect(c.about).not.toMatch(/https?:/);   // links go in links
        }
    });

    it('lists creators by code, A to Z', () => {
        const codes = CREATORS.map(c => c.code);
        expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    });

    it('links each creator only to https pages on the named site', () => {
        for (const c of CREATORS) {
            for (const { site, url } of c.links) {
                expect(Object.keys(CREATOR_SITES)).toContain(site);
                const u = new URL(url);
                expect(u.protocol, `${c.code} ${site}`).toBe('https:');
                expect(u.hostname, `${c.code} ${site}`).toMatch(HOSTS[site]);
            }
            // One YouTube channel per creator (it's their picture button).
            expect(c.links.filter(l => l.site === 'youtube').length).toBeLessThanOrEqual(1);
        }
    });

    it('has a profile picture for every YouTube link, and no leftovers', () => {
        // Missing one? Run "npm run creator-avatars".
        const pictures = Object.keys(import.meta.glob('../assets/creators/*.{jpg,png,webp}'))
            .map(path => path.split('/').pop()!.replace(/\.\w+$/, '')).sort();
        const youtube = CREATORS.filter(c => creatorLink(c, 'youtube')).map(c => creatorSlug(c.code)).sort();
        expect(pictures).toEqual(youtube);
    });

    it('gives the server every YouTube and Twitch channel to check for live streams', () => {
        // Out of step? Run "npm run creator-channels".
        const file = JSON.parse(channelsJson);
        expect(file.creators).toEqual(creatorChannels(CREATORS));
        // Each link must be a channel the server can look up.
        for (const c of CREATORS) {
            const yt = creatorLink(c, 'youtube');
            if (yt) expect(yt, c.code).toMatch(/^https:\/\/www\.youtube\.com\/@[\w.-]+$/);
            const tw = creatorLink(c, 'twitch');
            if (tw) expect(tw, c.code).toMatch(/^https:\/\/www\.twitch\.tv\/[a-z0-9_]+$/);
        }
    });
});
