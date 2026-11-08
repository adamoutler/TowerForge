# Privacy and legal

What TowerForge keeps about players, what it loads from others, and what was
done on 2026-11-08 to meet the usual rules for a site like this. It's a
checklist, not legal advice; a lawyer should look at the Privacy page if the
site ever grows into a business.

The player-facing pages are `/privacy` (`components/tabs/PrivacyTab.tsx`) and
`/terms` (`TermsTab.tsx`), linked from the footer on every page and shared
link (`components/common/SiteFooter.tsx`). **When the site starts keeping or
sending something new, change the Privacy page and its date in the same
commit.**

## What the site keeps (checked 2026-11-08 in the code and on the server)

| What | Where | How long | Notes |
|---|---|---|---|
| Everything a player enters or imports, incl. the in-game `UserName` | browser `localStorage` (`tc_*`) | until cleared | never sent unless one of the rows below |
| Ask AI download, Debug log, 👍/👎 | browser (Cache Storage, localStorage) | until removed | `docs/ask-ai.md` |
| Account: username, PBKDF2 password hash, created date, a copy of the stats, recovery code hash | SQLite `/var/lib/towerforge` | until the player deletes it | no email; `POST /api/account/delete` (password asked again) deletes the user, cascading saves and recovery code, plus their shares and AI reports |
| Sign-in cookie `tf_session` | browser | 30 days, sliding | HttpOnly, Secure, SameSite Strict; the only cookie |
| Share links: the picked sections | SQLite `shares` | 90 days (`ShareStore.Lifetime`) | never the username or in-game name |
| Ask AI reports (only on Send) | SQLite `ai_reports` | 1 year (`AiReportStore.Lifetime`) | username if signed in |
| Visit counts (Umami) | PostgreSQL `umami` | kept as statistics | no cookies, no IP stored; session row holds browser, OS, device, screen, language, country/region/city; skips Do Not Track (`data-do-not-track`) |
| nginx access log: IP, time, request, user agent, referrer | `/var/log/nginx` | 14 days (logrotate daily, rotate 14) | the API's own logs hold no IPs |
| Rate limits per IP | API memory | a minute | never written down |

The server is OVHcloud in Warrenton, Virginia, US (checked with ipinfo from
the server, 2026-11-08).

## What a visit loads from others

Nothing since 2026-11-08:

- **Google Fonts** (Exo 2, JetBrains Mono) were fetched from Google on every
  page, which hands Google each visitor's IP; a Munich court found that
  breaks GDPR without consent (LG München I, 20 Jan 2022, 3 O 17493/20). They
  now come from towerforge.net (npm `@fontsource`, `src/styles/fonts.css`).
- **impact.com's tracking script** loaded on every page. Its own help pages
  say it needs consent in the EU, and on the live site it set no cookies and
  its queued calls never ran. Removed; kept in `ops/impact/` with what to do
  before putting it back. The `impact-site-verification` meta tag stays (it
  sends nothing).

Only on a player's own action: Ask AI's download (Hugging Face, GitHub), Link
downloading Google's adb (the dialog links Google's Android SDK terms), and
links out (Discord, YouTube, Twitch, the webstore, community sites).

## Laws and what answers them

| Rule | Why it applies | What answers it |
|---|---|---|
| GDPR / UK GDPR (EU, UK visitors) | players there use the site | Privacy page (what, why, how long, rights, legal bases, where), Download my data, Delete account, no third parties on a visit, Discord contact with a 30-day answer |
| ePrivacy (cookie consent) | cookies and device storage | only the sign-in cookie and storage the player asks for (both exempt); no tracking scripts, so no banner needed |
| CalOPPA and other US state privacy laws | the site earns from a creator code | a posted privacy policy; no selling or sharing; CCPA's own thresholds aren't met |
| COPPA | the game is played by kids | not aimed at children; no accounts under 13 (16 in some EU countries); a parent can have one deleted |
| FTC endorsement rules | the maker earns from creator code H3ll | the Profile line and Terms say so outright; Creator Codes gives the 5% / 8% |
| Trademark and copyright (Tech Tree Games) | game names and art | Tech Tree Games has given TowerForge a written OK to use the art (owner, 2026-11-08); "not affiliated, used with permission" line in the footer and Terms, and the licenses file |
| Open-source licenses (MIT, Apache-2.0, OFL) | bundled code, fonts and TheTowerSDK data | `third-party-licenses.txt`, written at build by `towerforge.client/licensesPlugin.ts` |
| EU AI Act art. 50 (from 2 Aug 2026) | Ask AI is a chatbot | the page says it's an AI and how it works |

Not needed for now: a cookie banner (nothing to consent to), a DMCA agent
(shares are stats, not uploads), an Impressum (the site is run from the US),
CCPA's notices (below its thresholds).

## Open items

- A contact email (e.g. privacy@towerforge.net) would be more usual than
  Discord for privacy requests.
- The Link exe and APK carry no license notice of their own; the site's
  licenses file lists what they bundle (.NET runtime, Shizuku API).
