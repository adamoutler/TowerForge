// ============================================================
//  TowerForge — one HTML file per page, for search and link previews
//  After the build, writes dist/<page>.html for every address
//  (/optimizer → optimizer.html): index.html with that page's title,
//  description, link-preview tags and canonical address
//  (src/routeMeta.ts). The app itself is the same; only the head
//  differs, so Discord, Reddit, X and search engines — which read the
//  head without running the app — see the page that was linked.
//  nginx serves them with try_files $uri $uri.html … (ops/nginx/towerforge-pages.md).
// ============================================================

import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { TAB_PATHS } from './src/routes';
import { pageHtml } from './src/routeMeta';
import type { TabName } from './src/types/gameTypes';

export default function routePagesPlugin(outDir: string): Plugin {
    return {
        name: 'towerforge-route-pages',
        apply: 'build',
        closeBundle() {
            const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
            for (const [tab, route] of Object.entries(TAB_PATHS) as [TabName, string][]) {
                if (route === '/') continue;
                fs.writeFileSync(path.join(outDir, `${route.slice(1)}.html`), pageHtml(index, tab));
            }
            // The home page's own head says the same as routeMeta, so the two never drift.
            fs.writeFileSync(path.join(outDir, 'index.html'), pageHtml(index, 'profile'));
        },
    };
}
