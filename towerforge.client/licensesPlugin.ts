// ============================================================
//  TowerForge Companion — Third-party licenses (build step)
//  Writes third-party-licenses.txt next to index.html on every build:
//  each npm package the site's bundle uses, with its license text,
//  plus the code and data TowerForge ships that npm doesn't list
//  (TheTowerSDK's tables, the TowerForge Link apps' libraries). MIT,
//  Apache-2.0 and the fonts' Open Font License all ask for their
//  notice to travel with the copies; the bundler strips it from the
//  scripts, so it's collected here. The site footer links to it.
// ============================================================

import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

export const LICENSES_FILE = 'third-party-licenses.txt';

const MIT = (holder: string) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

// Shipped by TowerForge but not npm packages of the site. License texts
// checked 2026-11-08: TheTowerSDK's from its npm package (0.12.0),
// Shizuku API's from its GitHub repository and Maven POM, .NET's from
// dotnet/runtime.
const EXTRA = [
    {
        name: 'TheTowerSDK 0.12.0 (https://github.com/TmRxJD/TheTowerSDK)',
        used: 'The game\'s upgrade cost tables and relic list (constants/workshopCosts.ts, labCosts.ts, moduleCosts.ts, relicCatalog.ts).',
        text: MIT('2026 TmRxJD'),
    },
    {
        name: '.NET runtime (https://github.com/dotnet/runtime)',
        used: 'Built into TowerForge Link for Windows (TowerForgeLink.exe).',
        text: MIT('.NET Foundation and Contributors'),
    },
    {
        name: 'Shizuku API 13.1.5 (https://github.com/RikkaApps/Shizuku-API)',
        used: 'Built into TowerForge Link for Android (TowerForgeLink.apk).',
        text: MIT('2021 RikkaW'),
    },
    {
        name: 'Simple Icons (https://simpleicons.org)',
        used: 'The Discord logo in the header. CC0 1.0: no rights reserved.',
        text: '',
    },
];

const LICENSE_NAMES = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

interface Pkg { name: string; version: string; license: string; text: string }

// The package folder a module file sits in (scoped names included), or
// null for the site's own files.
function packageDir(id: string): string | null {
    const file = id.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0];
    const at = file.lastIndexOf('/node_modules/');
    if (at < 0) return null;
    const rest = file.slice(at + '/node_modules/'.length).split('/');
    const depth = rest[0].startsWith('@') ? 2 : 1;
    return file.slice(0, at) + '/node_modules/' + rest.slice(0, depth).join('/');
}

function readPackage(dir: string): Pkg | null {
    try {
        const json = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        const files = fs.readdirSync(dir).filter(f => LICENSE_NAMES.test(f)).sort();
        const text = files.map(f => fs.readFileSync(path.join(dir, f), 'utf-8').trim()).join('\n\n');
        const license = typeof json.license === 'string' ? json.license : json.license?.type ?? 'see the package';
        return { name: json.name, version: json.version, license, text };
    } catch {
        return null;
    }
}

export default function licensesPlugin(root: string): Plugin {
    return {
        name: 'towerforge-third-party-licenses',
        apply: 'build',
        generateBundle() {
            const dirs = new Set<string>();
            for (const id of this.getModuleIds()) {
                const dir = packageDir(id);
                if (dir) dirs.add(dir);
            }
            // Direct dependencies too, in case one only reaches the site
            // through a worker or a file the bundler copies.
            const own = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
            for (const name of Object.keys(own.dependencies ?? {})) dirs.add(path.join(root, 'node_modules', name).replace(/\\/g, '/'));

            const byName = new Map<string, Pkg>();
            for (const dir of dirs) {
                const pkg = readPackage(dir);
                if (pkg && pkg.name !== own.name) byName.set(`${pkg.name}@${pkg.version}`, pkg);
            }
            const pkgs = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

            const rule = '='.repeat(72);
            const parts = [
                'TowerForge (towerforge.net) — third-party software and data',
                '',
                'TowerForge is built with the open-source software and data below. Each one is',
                'listed with its license, as its license asks. The Tower, its names and its',
                'game art belong to Tech Tree Games; TowerForge is a fan-made site and isn\'t',
                'affiliated with or endorsed by Tech Tree Games.',
                '',
                ...pkgs.flatMap(p => [rule, `${p.name} ${p.version} — ${p.license}`, rule, '', p.text || `License: ${p.license} (no license file in the package).`, '']),
                ...EXTRA.flatMap(e => [rule, e.name, rule, '', e.used, ...(e.text ? ['', e.text] : []), '']),
            ];
            // The byte-order mark tells browsers it's UTF-8 (the server sends
            // .txt without a charset, and licenses carry © and dashes).
            this.emitFile({ type: 'asset', fileName: LICENSES_FILE, source: '﻿' + parts.join('\n') });
        },
    };
}
