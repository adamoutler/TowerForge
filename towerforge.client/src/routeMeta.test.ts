// Each page's title and description: every address has them, and the
// build's page files carry them in their head (for search and link previews).

import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import { TAB_PATHS } from './routes';
import { ROUTE_META, pageHtml, pageTitle } from './routeMeta';
import type { TabName } from './types/gameTypes';

describe('page titles and descriptions', () => {
    it('has a title and a short description for every address', () => {
        for (const tab of Object.keys(TAB_PATHS) as TabName[]) {
            const m = ROUTE_META[tab];
            expect(m.title, tab).toBeTruthy();
            expect(m.description.length, tab).toBeGreaterThan(40);
            expect(m.description.length, tab).toBeLessThanOrEqual(170);
        }
        expect(pageTitle('optimizer')).toBe('Optimizer — TowerForge');
    });

    it('writes a page\'s own head into index.html', () => {
        const html = pageHtml(indexHtml, 'optimizer');
        expect(html).toContain('<title>Optimizer — TowerForge</title>');
        expect(html).toContain(`<meta name="description" content="${ROUTE_META.optimizer.description}" />`);
        expect(html).toContain('<meta property="og:title" content="Optimizer — TowerForge" />');
        expect(html).toContain('<meta property="og:url" content="https://towerforge.net/optimizer" />');
        expect(html).toContain('<link rel="canonical" href="https://towerforge.net/optimizer" />');
        expect(html).toContain('<meta name="twitter:title" content="Optimizer — TowerForge" />');
        // An apostrophe in a description stays readable; quotes can't break the tag.
        expect(pageHtml(indexHtml, 'labs')).toContain('what\'s researching');
        expect(pageHtml(indexHtml, 'profile')).toContain('<link rel="canonical" href="https://towerforge.net/" />');
    });
});
