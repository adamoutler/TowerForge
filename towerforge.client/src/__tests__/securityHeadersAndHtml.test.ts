/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const clientRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(clientRoot, '..');

const indexHtmlPath = path.join(clientRoot, 'index.html');
const nginxConfPath = path.join(repoRoot, 'docker', 'nginx.conf');
const dockerfilePath = path.join(repoRoot, 'Dockerfile');

describe('TOWERFORGE-13: Hardened Origin, CSP, Permissions-Policy & Container Build Invariants', () => {
    it('1. index.html contains zero occurrences of impactcdn.com or external <script src="http..."> tags', () => {
        const html = fs.readFileSync(indexHtmlPath, 'utf-8');

        expect(html.toLowerCase()).not.toContain('impactcdn.com');
        expect(html.toLowerCase()).not.toContain('impactcdn');
        expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i);
        expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=\s*["']\/\//i);
    });

    it('2. docker/nginx.conf includes Permissions-Policy with usb=(self)', () => {
        const nginxConf = fs.readFileSync(nginxConfPath, 'utf-8');

        expect(nginxConf).toMatch(/add_header\s+Permissions-Policy\s+"usb=\(self\)"\s+always\s*;/);
    });

    it('3. docker/nginx.conf includes Content-Security-Policy permitting localhost/127.0.0.1:47821 HTTP & WS in connect-src and blocking object-src', () => {
        const nginxConf = fs.readFileSync(nginxConfPath, 'utf-8');

        expect(nginxConf).toContain('Content-Security-Policy');
        expect(nginxConf).toContain("default-src 'self'");
        expect(nginxConf).toContain("script-src 'self'");

        const connectSrcMatch = nginxConf.match(/connect-src\s+([^;]+);/);
        expect(connectSrcMatch).not.toBeNull();
        const connectSrc = connectSrcMatch![1];
        expect(connectSrc).toContain("'self'");
        expect(connectSrc).toContain('http://localhost:47821');
        expect(connectSrc).toContain('http://127.0.0.1:47821');
        expect(connectSrc).toContain('ws://localhost:47821');
        expect(connectSrc).toContain('ws://127.0.0.1:47821');

        expect(nginxConf).toContain("object-src 'none'");
        expect(nginxConf).toContain("base-uri 'self'");
        expect(nginxConf).toContain("frame-ancestors 'none'");
        expect(nginxConf).toMatch(/add_header\s+X-Content-Type-Options\s+"nosniff"\s+always\s*;/);
        expect(nginxConf).toMatch(/add_header\s+Referrer-Policy\s+"no-referrer"\s+always\s*;/);
        expect(nginxConf).toContain('/downloads/towerforge-link.py');
        expect(nginxConf).toContain('/downloads/towerforge-link.pyz');
        expect(nginxConf).toContain('/downloads/TowerForgeLink.apk');
        expect(nginxConf).toContain('location ^~ /downloads/');
        expect(nginxConf).toContain('try_files $uri =404;');
        expect(nginxConf).toContain('/linux/51-android-adb-uaccess.rules');
        expect(nginxConf).toContain('Content-Disposition');
        expect(nginxConf).toContain('attachment');
    });

    it('4. Dockerfile uses multi-stage build, builds towerforge-link.py & .pyz via build_pyz.py, and serves static assets via nginx:1.27-alpine', () => {
        const dockerfile = fs.readFileSync(dockerfilePath, 'utf-8');

        const fromStages = dockerfile
            .split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => /^FROM\s+/i.test(line));
        expect(fromStages.length).toBeGreaterThanOrEqual(2);
        expect(fromStages[0]).toMatch(/^FROM\s+node:22/i);
        expect(fromStages[fromStages.length - 1]).toMatch(/^FROM\s+nginx:1\.27-alpine\b/i);

        expect(dockerfile).toContain('npm ci');
        expect(dockerfile).toContain('build_pyz.py');
        expect(dockerfile).toContain('npm run build');
        expect(dockerfile).toContain('docker/nginx.conf');
        expect(dockerfile).toContain('/etc/nginx/conf.d/default.conf');
        expect(dockerfile).toContain('/usr/share/nginx/html');
    });
});
