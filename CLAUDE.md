# TowerForge

Companion web app for the mobile game **The Tower** (by Tech Tree Games), live at
https://towerforge.net. Players enter or import their account (workshop, labs, cards,
UWs, modules, bots, relics…) and the site models damage, eHP and coin farming and
suggests what to upgrade next.

## Layout

- `towerforge.client/` — React 19 + TypeScript + Vite, state in Zustand (`src/store/useGameStore.ts`, saved to localStorage under `tc_*` keys).
  - `src/engine/` — calculations and the game-export importer. **Pure functions, no store imports.**
  - `src/constants/` — game data tables (`gameData.ts`, `moduleData.ts`, `botData.ts`, `vaultData.ts` — the Vault's upgrades by vault id), the export index maps (`gameExportMaps.ts`), and the Creator Codes list (`creatorCodes.ts` — add a creator's link only when it's confirmed as theirs; the site maker's own code is `SITE_CREATOR_CODE` in `community.ts`, shown quietly at the foot of Profile and pinned first on Creator Codes). `workshopCosts.ts`, `labCosts.ts`, `moduleCosts.ts` and `relicCatalog.ts` are generated from TheTowerSDK — don't edit them by hand.
  - `src/components/tabs/` — one component per tab; styles in `tabs.css`, theme tokens in `src/styles/variables.css`: eight themes (players pick one with the header's Theme button, `components/common/ThemePicker.tsx`), each a palette on `[data-theme]` that the panels, lines and glows are mixed from — new CSS uses those tokens, never a theme's own colors.
  - `src/routes.ts` — each tab's address (`/creators`, `/what-if`…; Profile is `/`). The address follows the open tab and the tab bar's entries are links. The server sends unknown paths to `index.html` (nginx `try_files`), so a new tab only needs a path here — never one the server uses (`/api`, `/analytics`, `/assets`, `/downloads`).
  - `src/assets/{modules,bots,cards,chips,uws,vault}/` — game icons, looked up in `constants/gameIcons.ts` (modules and bots by slug; cards, chips, UWs and Vault upgrades matched to the asset folder's file names there — Cash has no card icon yet). Cards, UWs, Guardian and Vault are drawn like the game's screens by shared components (`components/common/GameCard`, `UWPanel`, `GuardianBoard`, `VaultRow`) that the tabs and the share images both use, in the game's own colors (sampled from screenshots) rather than theme tokens.
  - `src/ai/` — Ask AI (public beta since v2.0.0): an open model in the player's browser (WebLLM, WebGPU) that answers from the engine's numbers and the docs. How it works and what was checked: `docs/ask-ai.md`.
- `TowerForge.Server/` — ASP.NET Core 8 API (accounts, saves, share links). On the server its data lives in `/var/lib/towerforge` (SQLite), outside the deploy folder. Accounts have no email: forgotten passwords are reset with recovery codes, and the owner can issue one with `ops/accounts/recovery-code.sh` (how it works and what was checked: `docs/accounts.md`). Preview tabs show only for the accounts listed in `/var/lib/towerforge/features.json` (`{ "feature": ["username"] }`) — usernames stay on the server, never in the repo. Ask AI was one until v2.0.0 and is now public; `"ai-admin"` there opens the owner's AI reports panel on Ask AI (answers players chose to send: `AiReportsController`, table `ai_reports`; docs/ask-ai.md "Debugging").
- `TowerForge.Link/` — TowerForge Link, a small Windows helper (.NET 8, one exe) that reads `tool_export.json` off an emulator with its adb, an Android phone over Wi-Fi with Google's adb (0.3, wireless debugging), or the newest iPhone backup on the PC (0.3), for the site's "Get from emulator or phone" button and Auto import. With more than one emulator or phone, the site asks which (0.4: `/sources`, `components/LinkSourcePicker.tsx`). How it works, safety and emulator ports: `docs/towerforge-link.md`. `deploy.ps1` publishes it to `downloads/TowerForgeLink.exe`.
- `TowerForge.Link.Android/` — TowerForge Link for Android (Java, one small APK): reads the export on the phone itself through Shizuku and answers the site in the phone's browser with the same API as the Windows Link. Signed with a key kept outside the repo (`%USERPROFILE%\.towerforge`, back it up — updates need the same key); `deploy.ps1` builds it to `downloads/TowerForgeLink.apk`. How it works, how it was tested and its build toolchain: `docs/towerforge-link.md`.
- The home page (Profile, `/`) opens on `components/tabs/ProfileHome.tsx` once there's data: the tower in its range ring with enemies walking in, tier and best wave in the game's wave-counter style, progress dials that open their tabs, and what's ticking (next lab to finish, last tournament, data age) — counted in `engine/accountProgress.ts`. The profile settings fold away below it.
- The **Career** tab (`/career`, `engine/career.ts`): income and spending between imports (`incomeLog`: the game's "this cycle" counters and lifetime totals at each export), lifetime totals, the yearly recap, best per tier, modules (with the game's substat bans and auto reroll picks), research history, run records. **Run in Progress** on Profile (`engine/liveRun.ts`) reads the game's `…ThisRound` counters like a finished run, plus the levels and perks the run has picked up.
- The **Import Guide** tab (`/import-guide`, `components/tabs/ImportGuideTab.tsx`) walks players through every import route, screen by screen, and maps every message Link shows to a fix. When an import step, a Link message or a download changes, update it too; `guideNav.ts` opens it at a section from other pages.
- `docs/game-export-format.md` — field-by-field notes on the game's `tool_export.json` and how each mapping was confirmed. `docs/module-effects.md` — unique module formulas and assumptions.
- `docs/analytics.md` — Umami visitor analytics (self-hosted on the VPS at /analytics): what's tracked, where it runs, how to open the dashboard and update it. Setup scripts in `ops/umami/`. nginx compresses text files with `ops/nginx/towerforge-gzip.conf` sets how long browsers keep files with `ops/nginx/towerforge-cache.conf` (`index.html` revalidated every visit, so a deploy shows at once; hashed `/assets/` kept a year) and adds the APK's file type with `ops/nginx/towerforge-types.conf` — all installed in `/etc/nginx/conf.d/`, steps in their headers.
- `docs/ultimate-weapons.md` — every UW and UW+ mechanic checked against the wiki (values, costs, labs, perks) and how the model uses it. `docs/optimizer.md` — the Optimizer's goals and how each scores upgrades, what every currency is ranked by and where its prices come from, the What If page, calibration from battle reports, and the verified stone rules (card mastery, assist modules, primary module labs).
- `docs/coverage.md` — the whole game, system by system, against what the site models (✅/◐/✗), and what each gap needs. Update it when a system gets modeled.
- `docs/run-simulation.md` — research for the planned run simulator: enemy scaling, spawning, elites/fleets, battle conditions, level skip, in-run cash/perks/free upgrades, survival, what battle reports hold, the gaps, and the disagreements between sources. TheTowerSDK (MIT, npm `thetowersdk`) is the main formula source.

## Commands

Run from `towerforge.client/` unless noted.

| What | Command |
|---|---|
| Dev server | `npm run dev` |
| Tests | `npm test` (Vitest; `npm run test:watch` to rerun on save) |
| Type-check + build | `npm run build` (`tsc -b` also checks the test files) |
| Lint | `npx eslint <files>` |
| Deploy (repo root) | `powershell -ExecutionPolicy Bypass -File deploy.ps1` (new features) or `... deploy.ps1 -Bump patch` (fixes only) — bumps the version, runs the tests first and stops if any fail (the bump is undone), then commits "Release vX.Y.Z", tags and pushes. Add the release to `CHANGELOG.md` |
| Import game icons (repo root) | `powershell -ExecutionPolicy Bypass -File import-icons.ps1` — trims, centers and resizes PNGs from `Desktop\Tower-Forge-Assets` |
| Creator profile pictures | `npm run creator-avatars` — downloads each YouTube-linked creator's picture into `src/assets/creators/`; run after adding a YouTube link to `creatorCodes.ts` (a test fails until you do) |
| Cost tables | `npm run upgrade-costs -- <unpacked thetowersdk package>` — rewrites `workshopCosts.ts`, `labCosts.ts` and `moduleCosts.ts` (steps in the script header) |
| Link preview image | `powershell -ExecutionPolicy Bypass -File scripts\og-image.ps1` — redraws `public/og-image.png`, the card Discord/Reddit/X show for a towerforge.net link (index.html's `og:` tags). `public/robots.txt` and `public/sitemap.xml` sit beside it (`routes.test.ts` keeps the sitemap in step with `routes.ts`) |
| Relic catalog | `npm run relic-catalog -- <unpacked thetowersdk package>` — rewrites `relicCatalog.ts` (each export relic slot's relic and bonus); rerun when the game adds relics |
| TowerForge Link exe (repo root) | `dotnet publish TowerForge.Link -c Release -o <folder>` — one self-contained `TowerForgeLink.exe` (unsigned for now) |
| TowerForge Link for Android (repo root) | `powershell -ExecutionPolicy Bypass -File TowerForge.Link.Android\build.ps1 [-Debug] [-Out <file.apk>]` — Java 17 and the Android SDK from `%LOCALAPPDATA%\TowerForgeBuild\` (setup in `docs/towerforge-link.md`) |

`npx eslint src` is clean (2026-11-02); keep it that way.

## Rules

- **Commit and push every finished change to GitHub without asking** (owner's standing request): once a change works and the tests pass, commit it with a clear message and push to `main`. Scan the staged files first (see the next rule).
- **Ask before you deploy** to towerforge.net. Approval covers one deploy, not later ones.
- **This repo is public.** Never commit secrets or a player's personal data. Scan staged files before every push.
  - Commits use the owner's GitHub noreply address (already set in this repo's git config).
- **Never ship or commit a real game export.** Don't copy one into `public/`, tests, fixtures or docs. Tests build a made-up export with `src/test/makeExport.ts`.
- **Before deploying:** check `towerforge.client/public/` for `__test_export*` files and personal data.
- **Never sign in to players' game accounts or pull game cloud saves.** The site's old "Cloud Pull" was removed for good (2026-10-23, owner's decision): game data comes only from the game's own export. Don't run the Save Tool's login or pull scripts, and don't create accounts on the production site.
- **Game data only goes in when it's confirmed.** Map an export index only after checking it against a real account (or in-game screenshots), and note how in `docs/game-export-format.md`. Anything unconfirmed keeps what the player entered. Wiki values are a starting point; the in-game screen wins.
- When a formula is checked against an in-game number, add that number as a test anchor (see `src/engine/calculations.test.ts`).
- **Write down what you verify.** Game mechanics checked against the wiki or the game go in `docs/ultimate-weapons.md` / `docs/optimizer.md` / `docs/run-simulation.md` (with the source), so they don't have to be looked up again. Say when something is the code's assumption rather than verified.
- Reading the wiki: Fandom (`the-tower-idle-tower-defense.fandom.com`) blocks plain fetches and Notion (`the-tower.notion.site`) renders client-side — read both in the browser; on a fandom tab, `fetch('/wiki/<Name>')` + `DOMParser` reads any page's tables.

## Conventions

- Match the surrounding code: each file opens with a header comment block, and comments explain the game mechanic or why, not what the code does.
- New CSS goes in `tabs.css` with a short prefix per feature (`modg-` modules, `botg-` bots). Colors come from tokens in `variables.css` or the nearby block.
- Every tab must work at phone width (375px) with no sideways scrolling.
- Keep pages readable and calm (owner, 2026-11-02: the site felt cramped and overwhelming): text 13px or more (12px only for small caps labels), stats as `.stat-pill` tiles (label over value), a page's "how this works" paragraph in `components/common/PageIntro` and other long explanations in `MoreInfo` (both folded until opened). The game-screen drawings and share images (`gcard-`, `uwg-`, `grdg-`, `vltg-`, `botg-`, `modg-`, `cardg-`, `shr-`) keep their own sizes. Only the page area (`main.tab-content`) scrolls; once a page is scrolled the header and currency bar fold away (`.is-compact` on `.app-shell`, App.tsx) and a new page opens at its top.
- Player-facing text uses the game's own words (stat names, rarities, "preset", "Bot+").
- The site's version lives only in `towerforge.client/package.json`; Vite injects it as `__APP_VERSION__` for the header. **Every deploy bumps it** — `deploy.ps1` does it (minor for features, `-Bump patch` for fixes), commits "Release vX.Y.Z" and tags `vX.Y.Z`. Each release gets a line in `CHANGELOG.md`.

## Checking UI changes

Build (`npm run build`), then start `towerforge-preview` from `.claude/launch.json` (serves `dist/` on port 4174). Put made-up data into localStorage (`tc_profile`, `tc_modules`, `tc_bots`, …), check desktop and phone widths, then remove the test data.

Share links and accounts need the API: start `towerforge-server-local` instead (the server with `dist/` on port 5099, a throwaway database in `TowerForge.Server/bin/local-test-data` — delete it afterwards). Anonymous shares need no account: POST a made-up payload to `/api/shares` and open `/?share=<code>`. Export Image opens the Export Images window (`components/share/exportImages.ts`): each poster page (`[data-poster-page]`, `PosterPages.tsx`, at most 4:5 tall so Reddit shows it whole) becomes a PNG (`posterImages.ts`, its own SVG loader because WebKit's `img.decode()` can fail on SVG). Computers download them; phones get Save or share (the share menu → Photos or Reddit) and press-and-hold.

## Environment notes

- Windows: PowerShell 5.1 and Git Bash. For multi-line file edits from the shell, write a Python script to a temp file and run it with `python -I`. Heredocs that pipe into `python3 -` work for short patches.
- Pillow isn't installed. Image work uses PowerShell `System.Drawing` (see `import-icons.ps1`).

## TowerForge Link 2 Architecture & Security

TowerForge Link 2 provides three independent, self-contained paths for importing `tool_export.json` (and optional `playerInfo.dat` save backups) from *The Tower* into the web application across Windows, macOS, Linux, and Android:

### Three Import Paths & Module Boundaries

1. **Path 1 — Existing `"🖥 Get from emulator or phone"` Button (Untouched Wire Contract on `:47821`)**
   - **Frontend Modules:** `towerforge.client/src/engine/linkClient.ts`, `towerforge.client/src/components/LinkModal.tsx`, `towerforge.client/src/components/LinkSourcePicker.tsx`, and `towerforge.client/src/components/common/AutoImport.tsx`.
   - **Contract Fixtures:** `towerforge.client/src/engine/__tests__/linkClient.contract.test.ts` and `docs/contracts/link-v1-openapi.json` lock byte-for-byte parity with `TowerForge.Link/LinkServer.cs` on `http://localhost:47821` (`GET /`, `GET /status`, `GET /sources`, `GET /export[?newerThan=&source=]`, and `POST /phone/{adb,pair,connect,forget}`).
   - **Backends:** Served by `TowerForge.Link` (`TowerForgeLink.exe`) on Windows, `TowerForge.Link.Android` (`TowerForgeLink.apk` + Shizuku) on Android, and `towerforge-link-py` (`towerforge-link.pyz`) on macOS and Linux.

2. **Path 2 — `"🔌 Connect USB phone"` WebUSB Direct (`navigator.usb` + Tango ADB 2.x)**
   - **Frontend Modules:**
     - `towerforge.client/src/engine/usbTangoLoader.ts` — Lazy-loads exact-pinned `@yume-chan/adb@2.6.4`, `@yume-chan/adb-daemon-webusb@2.3.2`, and `@yume-chan/adb-credential-web@2.1.0` into an isolated async Rollup chunk (`vendor-webusb`) so zero bytes are added to the initial bundle.
     - `towerforge.client/src/engine/usbLink.ts` — WebUSB ADB state machine filtering for ADB interfaces (`classCode: 0xff, subclassCode: 0x42, protocolCode: 0x01`), ephemeral RSA-2048 session key generation + SHA-256 fingerprint computation + zero-fill key cleanup, 30-second authorization timeout, bounded 8 MiB `sync.lstat`/`sync.read` pull with mid-write `mtime` re-verification, and optional `playerInfo.dat` backup download (`usbDownloadPlayerInfo`).
     - `towerforge.client/src/engine/usbDiagnose.ts` — Cross-tab Web Locks (`navigator.locks` `'towerforge-usb'`) contention detector, OS error classifier distinguishing `device.open()` `SecurityError`/`Access denied` from `claimInterface()` `DeviceBusyError` (`Unable to claim interface`), and optional `GET http://127.0.0.1:47821/usb/owner` enrichment.
     - `towerforge.client/src/components/UsbLinkModal.tsx` — Step-by-step WebUSB connection modal displaying live RSA key fingerprints, `adb kill-server` conflict remediation, and platform-specific instructions.
     - `towerforge.client/public/linux/51-android-adb-uaccess.rules` — Downloadable Linux `udev` rule (`SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ENV{ID_USB_INTERFACES}=="*:ff4201:*", TAG+="uaccess"`) granting active local seat users access to Android ADB USB interfaces without root or `plugdev` group changes.

3. **Path 3 — `towerforge-link-py` Python 3.10+ Stdlib Companion (`towerforge-link.pyz`)**
   - **Companion Package (`towerforge-link-py/towerforge_link/`):** 100% Python 3.10+ standard library (zero third-party runtime PyPI dependencies), packaged as a reproducible `.pyz` zipapp at `towerforge.client/public/downloads/towerforge-link.pyz`:
     - `adb_finder.py` / `adb.py` & `adb_runner.py` — Deterministic `adb` binary locator (`PATH`, Android SDK `platform-tools`, Homebrew, `/usr/bin/adb`) with `os.stat` permission/ownership guards (rejects world/group-writable binaries), argv-only `subprocess.Popen(..., shell=False)`, sanitized environment, process-group timeout kills (`os.killpg`), and strict `SERIAL_RE` (`^[A-Za-z0-9._:-]{1,128}$`) validation.
     - `security.py` & `http_server.py` / `server.py` — `ThreadingHTTPServer` bound strictly to `127.0.0.1:47821` (`allow_reuse_address = False`, 8-socket concurrency semaphore, 30-minute idle auto-shutdown).
     - `sources.py` / `discovery.py` — Multi-source discovery across USB phones, Wireless Debugging phones, Waydroid (`192.168.240.112:5555`), Android Studio AVDs (`emulator-*`), Genymotion, BlueStacks Air, and the macOS Apple Silicon native container (`~/Library/Containers/<UUID>/Data/Documents/tool_export.json`).
     - `exporter.py` — Pulls `tool_export.json` and `playerInfo.dat` (`--pull-save`) into a `0700` temporary directory with an 8 MiB size cap (`413 Payload Too Large`), `204 No Content` `newerThan` semantics, mid-write `mtime` retry, and `X-Export-Modified` / `X-Export-Source` / `X-Export-Source-Id` headers.
     - `wireless.py` / `phones.py` — Implements `/phone/adb`, `/phone/pair`, `/phone/connect`, and `/phone/forget` with literal RFC1918 IPv4 validation, 6-digit pairing code checks, token-bucket rate limiting, and `0600` `phones.json` persistence.
     - `usb_owner.py` — Implements `GET /usb/owner?vid=&pid=&serial=` using Linux `sysfs` + same-UID `/proc/<pid>/fd` inspection and macOS `ioreg` + `lsof` so the browser can identify which local process (`adb`, Android Studio, `scrcpy`) holds the USB interface.
     - `ws.py` & `towerforge.client/src/engine/wsLinkClient.ts` — Restricted RFC 6455 `/ws` JSON-RPC endpoint (`<= 4 KiB` frames, allowlisted methods `status`, `sources`, `export`, `usb_owner` only; never a raw ADB socket relay).
   - **In-App Documentation:** `towerforge.client/src/components/tabs/ImportGuideTab.tsx` (and `towerforge.client/src/components/ImportGuideTab.tsx`) provides addressable `#usb` and `#linux-macos` sections (`guideNav.ts`).

### Security Controls

- **Loopback Origin, Host & Private Network Access (PNA) Enforcement:** `towerforge-link-py` validates `Host` (`localhost:47821` or `127.0.0.1:47821`) and `Origin` (`https://towerforge.net`, `https://towerforge.hackedyour.info`, `https://thetower.hackedyour.info`, `http://localhost:*`, `http://127.0.0.1:*`), and responds to `OPTIONS` preflights with `Access-Control-Allow-Private-Network: true` and `Vary: Origin, Access-Control-Request-Private-Network`.
- **Linux `/proc/net/tcp` Same-UID Peer Verification:** On Linux, `security.py` inspects `/proc/net/tcp` for every accepted loopback connection and rejects sockets whose owning UID does not match `os.getuid()` (`403 Forbidden`).
- **Subprocess & Filesystem Hardening:** All `adb` invocations use `shell=False`, a stripped environment (`PATH`, `HOME`, `ANDROID_ADB_SERVER_PORT`, `TMPDIR`), validated device serials (`SERIAL_RE`), and `0700` temporary directories.
- **8 MiB Bounded Transfers:** Both `usbLink.ts` (WebUSB sync stream) and `exporter.py` (companion HTTP/CLI pull) enforce a strict `8 MiB` (`8,388,608` bytes) ceiling before and during streaming.
- **Ephemeral WebUSB RSA-2048 Keys:** `usbLink.ts` generates an ephemeral RSA-2048 key pair per session by default, zeroes the PKCS#8 `Uint8Array` buffer on disconnect, and calls `device.raw.forget()` in `finally`.
- **CSP & Permissions-Policy:** Third-party tracking scripts (`utt.impactcdn.com`) are removed. Nginx enforces `Permissions-Policy: usb=(self), geolocation=(), microphone=(), camera=()` and a strict `Content-Security-Policy` (`script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self' http://localhost:47821 http://127.0.0.1:47821 ws://localhost:47821 ws://127.0.0.1:47821`).
- **Repository Hygiene:** This repository uses `CLAUDE.md` exclusively; zero `GEMINI.md` files are permitted anywhere in the repository tree.

### Containerized Dev & Test Commands (`docker-compose.dev.yml`)

| Task | Command |
|---|---|
| Start dev container stack | `docker compose -f docker-compose.dev.yml up -d` |
| Frontend unit tests (Vitest) | `docker exec -w /workspace/towerforge.client towerforge-dev npx vitest run` |
| Frontend type-check & production build | `docker exec -w /workspace/towerforge.client towerforge-dev npm run build` |
| Python companion unit tests (Pytest) | `docker exec -w /workspace towerforge-dev pytest towerforge-link-py/tests` |
| Build `towerforge-link.pyz` zipapp | `docker exec -w /workspace towerforge-dev python3 towerforge-link-py/packaging/build_zipapp.py` |
| Playwright Chromium E2E suite | `docker exec -w /workspace/towerforge.client towerforge-dev npx playwright test` |
