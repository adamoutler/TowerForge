# Analytics — Umami (self-hosted)

Visitor stats for towerforge.net come from [Umami](https://umami.is), running on
the TowerForge VPS. It's cookieless (no consent banner) and the data stays on our
server. Set up 2026-10-16 with Umami v3.4.0.

## What's tracked

- Every page load (towerforge.net and share links), with referrer, country,
  device, browser and OS — Umami's standard, anonymous counts.
- Not from browsers that send Do Not Track (`data-do-not-track="true"` on the
  tag, since 2026-11-08; the live script reads it). The Privacy page
  (`/privacy`, docs/privacy.md) says what's counted; change it with this list.
- **Tab views**: since 2026-10-20 every tab has its own address
  (`towerforge.net/creators`, `/what-if`… — `src/routes.ts`), and the tracker
  counts each address change as a page view by itself (it wraps
  `history.pushState` / `replaceState`, checked in the live script). Before
  that, tab views were sent by hand as `/<tab id>` (`/whatif`, `/runcoins`,
  `/uw`…), so older stats use those names; the old names still open their tabs.
- **Events**: `Import game data` (and `(PDF)` / `(emulator)`) when a game
  export imports; `Emulator link …` when Get from emulator or phone fails; `Link download` (the setup dialog's download; `Link download (Android)` for the Android app there, and `Link download (guide)` / `Link download (Android, guide)` from the Import Guide, 2026-10-23) and `Link phone: adb / pair / connect / forget` (`… failed` when it didn't work, 2026-10-23);
  `Auto import on` / `off`; `Theme` with the theme picked (header picker,
  since 2026-10-22); `Open Discord` (the header's Discord link, since
  v1.26.1); `Copy creator code` and `Open creator link` on Creator Codes (`live: 1` for a live stream);
  `Open charity link` (`donate` / `fundraiser`) and `Copy creator code` (`from: charity`) on the
  charity event banner (2026-11-09 to 11-15). Import help (2026-11-13): `Import help` with
  `step` (`open`, `file`, `link`, `account`, `guide`) and `device` (`windows`, `mac`, `android`,
  `ios`, `other`; `from: link` when the file came from the Link dialog; `example` for "Just
  looking?"), and `Emulator link: started` when Link starts while its dialog is open and the site
  reads the export by itself. `Emulator link: opened the site` when TowerForge Link (0.5+,
  `?link=import`) or the Android app (`?link=android`) opened the site and it imported on load.
  `Example account` with `step` `try`, `leave`, or `import` (their own data replaced it — the
  number to watch), 2026-11-13. `Import game data (auto)` once a visit when Auto import brings
  data in (before, auto imports weren't counted at all), and `Auto import on` with `from: offer`
  when it was turned on from the one-time offer after a first Link import. `Install app` (`step`
  `shown` once a visit, `how`, `not now`, `accepted` / `dismissed` from Chrome's prompt,
  `installed`) and `Lab reminders` (`on`, `off`, `denied`), 2026-11-13. An installed app opens
  at `/?source=app`, so app visits show in the address.
- `ai-answer` (Ask AI, 2026-10-29): one per answer, with no question, answer
  or account in it — `tool` (the data it used), `picked` (wording, model or
  keywords), `flagged` (a number that isn't TowerForge's: yes/no), `time`
  (under 10 s, 10–20 s, 20–40 s, over 40 s), `model` (Qwen3-4B…) and
  `error: yes` when it failed (`countAnswer`, `src/ai/aiAssistant.ts`). The Ask
  AI page says so.
- Only from `towerforge.net` / `www.towerforge.net` (`data-domains` on the tag in
  `towerforge.client/index.html`), so dev and previews send nothing.
- Website ID: `06a68bc5-23dd-40b8-9f3f-7fa542b9ceca` (public — it's in the page).
- Session replays / heatmaps are off (`recorder_enabled = false`).

## On the server

| Piece | Where |
|---|---|
| Umami app | `/opt/umami/app` (user `umami`), git checkout of the release tag |
| Settings | `/opt/umami/app/.env` (DATABASE_URL, `BASE_PATH=/analytics`, APP_SECRET) — 600, never committed |
| Node 22 (Umami only) | `/opt/node22` — the system's Node 18 is too old for Umami 3 |
| Database | PostgreSQL 16, database and user `umami` (password only in the .env files) |
| Service | `umami.service` → `next start -H 127.0.0.1 -p 3000` |
| nginx | `/etc/nginx/sites-enabled/towerforge`: `/analytics/script.js` and `/analytics/api/send` proxy to it; the rest of `/analytics` returns 404 (backup of the previous config: `/etc/nginx/towerforge.bak-analytics`) |

Setup script: `ops/umami/setup.sh` (idempotent; run as `ubuntu`), nginx routes:
`ops/umami/nginx_add_routes.py`.

```bash
ssh ubuntu@towerforge.net sudo systemctl status umami
```

```bash
ssh ubuntu@towerforge.net sudo journalctl -u umami -n 50
```

## Opening the dashboard

The dashboard isn't public yet — Umami creates a login **admin / umami** that
must be changed first. Open it through an SSH tunnel:

```bash
ssh -L 3000:127.0.0.1:3000 ubuntu@towerforge.net
```

then browse to `http://localhost:3000/analytics`, log in, and change the
password (Settings → Profile). After that, the `location /analytics { return 404; }`
block in nginx can become a `proxy_pass http://127.0.0.1:3000;` like the others
to open the dashboard at `https://towerforge.net/analytics`.

## Updating Umami

Pick a new release tag, then on the server:

```bash
cd /opt/umami/app && sudo -u umami git fetch --depth 1 origin tag <tag> && sudo -u umami git checkout <tag>
```

```bash
sudo -u umami env HOME=/opt/umami PATH=/opt/node22/bin:/usr/bin:/bin bash -c 'cd /opt/umami/app && set -a && . ./.env && set +a && pnpm install --frozen-lockfile && pnpm build'
```

```bash
sudo systemctl restart umami
```

Check the release's Node / pnpm requirements first (`package.json` engines and
its dependencies' engines — Umami 3.4 needs Node ≥ 20.19 and pnpm 12.3.4).
