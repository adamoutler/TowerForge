import { fileURLToPath, URL } from 'node:url';

import { defineConfig, searchForWorkspaceRoot } from 'vite';
import plugin from '@vitejs/plugin-react';
import licensesPlugin from './licensesPlugin';
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { env } from 'process';

const baseFolder =
    env.APPDATA !== undefined && env.APPDATA !== ''
        ? `${env.APPDATA}/ASP.NET/https`
        : `${env.HOME}/.aspnet/https`;

const certificateName = "towerforge.client";
const certFilePath = path.join(baseFolder, `${certificateName}.pem`);
const keyFilePath = path.join(baseFolder, `${certificateName}.key`);

if (!fs.existsSync(baseFolder)) {
    fs.mkdirSync(baseFolder, { recursive: true });
}

if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
    if (0 !== child_process.spawnSync('dotnet', [
        'dev-certs',
        'https',
        '--export-path',
        certFilePath,
        '--format',
        'Pem',
        '--no-password',
    ], { stdio: 'inherit', }).status) {
        throw new Error("Could not create certificate.");
    }
}

// The site's version comes from package.json ("version") and shows in the header.
const appVersion: string = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version;

const target = env.ASPNETCORE_HTTPS_PORT ? `https://localhost:${env.ASPNETCORE_HTTPS_PORT}` :
    env.ASPNETCORE_URLS ? env.ASPNETCORE_URLS.split(';')[0] : 'https://localhost:7065';

// https://vitejs.dev/config/
export default defineConfig({
    // licensesPlugin: third-party-licenses.txt, linked from the site footer.
    plugins: [plugin(), licensesPlugin(fileURLToPath(new URL('.', import.meta.url)))],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
    },
    build: {
        rollupOptions: {
            output: {
                // pdf.js's worker ships as .mjs; nginx serves .mjs as a plain
                // download, which browsers won't run as a module worker. A .js
                // name gets the JavaScript type.
                assetFileNames: (asset) => asset.names?.some(n => n.endsWith('.mjs'))
                    ? 'assets/[name]-[hash].js'
                    : 'assets/[name]-[hash][extname]',
            },
        },
    },
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    server: {
        proxy: {
            '^/weatherforecast': {
                target,
                secure: false
            },
            '^/api/': {
                target,
                secure: false
            }
        },
        port: parseInt(env.DEV_SERVER_PORT || '58132'),
        // Ask AI bundles the game notes from the repo's docs/ folder.
        fs: {
            allow: [searchForWorkspaceRoot(process.cwd()), '../docs'],
        },
        https: {
            key: fs.readFileSync(keyFilePath),
            cert: fs.readFileSync(certFilePath),
        }
    }
})
