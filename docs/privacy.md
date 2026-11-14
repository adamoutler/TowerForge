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
| The example account's made-up player, and what the browser had before it | browser `localStorage` (`tf-example`, `tf-example-backup`) | until the player leaves the example or imports | made up (`store/exampleAccount.ts`); never uploaded — making an account waits until it's left |
| Ask AI download, Debug log, 👍/👎 | browser (Cache Storage, localStorage) | until removed | `docs/ask-ai.md` |
| Moments the player's imports found, What's new seen, reminders on | browser `localStorage` (`tf-moments`, `tf-seen-version`, `tf-lab-reminders`, `tf-tourney-reminders`) | moments 2 weeks or until closed | never sent (2026-11-14: `store/moments.ts`, `whatsNew.ts`); a moment's picture is made in the browser and only goes where the player saves or shares it |
| Account: username, PBKDF2 password hash, created date, a copy of the stats, recovery code hash | SQLite `/var/lib/towerforge` | until the player deletes it | no email; `POST /api/account/delete` (password asked again) deletes the user, cascading saves and recovery code, plus their shares and AI reports |
| Sign-in cookie `tf_session` | browser | 30 days, sliding | HttpOnly, Secure, SameSite Strict; the only cookie |
| Share links: the picked sections | SQLite `shares` | 90 days (`ShareStore.Lifetime`) | never the username or in-game name. Since 2026-11-14 a link (`/s/CODE`) has its own preview: the shared tier, best wave, league and build (from the Profile section, values checked against the game's) and which sections it holds, in the page's tags and a card drawn by the server (`/s/CODE/card.png`, kept in memory only) — what anyone with the link sees anyway. `noindex` |
| Ask AI reports (only on Send) | SQLite `ai_reports` | 1 year (`AiReportStore.Lifetime`) | username if signed in |
| Reminders (only after a "Remind me" and the browser's permission): `labs` and `tourney` (2026-11-14) | SQLite `push_reminders` | each until sent; a kind's on turning it off (all when neither is on); 45 days at most (`ReminderStore.Lifetime`) | the browser's push address and keys, lab names and finish times or the coming tournament days (six weeks, re-sent on a visit); no account, no IP. Delivered by the browser's push service (Google, Apple, Mozilla, Microsoft), encrypted end to end (RFC 8291), so the service can't read it |
| TowerForge's push key pair | `push-keys.json` in `/var/lib/towerforge` | kept | made on first start; signs reminders (VAPID); never in the repo |
| Visit counts (Umami) | PostgreSQL `umami` | kept as statistics | no cookies, no IP stored; session row holds browser, OS, device, screen, language, country/region/city; skips Do Not Track (`data-do-not-track`) |
| nginx access log: IP, time, request, user agent, referrer | `/var/log/nginx` | 14 days (logrotate daily, rotate 14) | the API's own logs hold no IPs |
| Rate limits per IP | API memory | a minute | never written down |
| Creators live now (stream title, start, viewers) | API memory | until the next check (2–4 min) | about the creators, not players; `docs/live-streams.md` |
| Creators' YouTube channel ids | `youtube-channels.json` in `/var/lib/towerforge` | looked up again after 30 days | public ids for the creators' @handles (YouTube's rules: refresh within 30 days) |

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

Installing the site as an app (2026-11-13: `manifest.webmanifest`, icons)
loads nothing from others. The service worker (`public/sw.js`) is registered
only when a player turns on lab reminders; it shows the notifications and
caches nothing.

Creator Codes' LIVE badges (2026-11-09) keep it that way: the browser asks
towerforge.net (`GET /api/creators/live`, every 2 minutes while a page is
open), and the server asks Twitch and YouTube, sending only the creators'
channel names and TowerForge's keys (`docs/live-streams.md`). The Privacy page
says the site uses YouTube API Services and links Google's Privacy Policy; the
Terms link YouTube's Terms of Service.

## Laws and what answers them

| Rule | Why it applies | What answers it |
|---|---|---|
| GDPR / UK GDPR (EU, UK visitors) | players there use the site | Privacy page (what, why, how long, rights, legal bases, where), Download my data, Delete account, no third parties on a visit, Discord contact with a 30-day answer |
| ePrivacy (cookie consent) | cookies and device storage | only the sign-in cookie and storage the player asks for (both exempt); no tracking scripts, so no banner needed |
| CalOPPA and other US state privacy laws | the site earns from a creator code | a posted privacy policy; no selling or sharing; CCPA's own thresholds aren't met |
| COPPA | the game is played by kids | not aimed at children; no accounts under 13 (16 in some EU countries); a parent can have one deleted |
| FTC endorsement rules | the maker earns from creator code H3ll | the Profile line and Terms say so outright; Creator Codes gives the 3% (in the game) / 5% (webstore) |
| Trademark and copyright (Tech Tree Games) | game names and art | Tech Tree Games has given TowerForge a written OK to use the art (owner, 2026-11-08); "not affiliated, used with permission" line in the footer and Terms, and the licenses file |
| Open-source licenses (MIT, Apache-2.0, OFL) | bundled code, fonts and TheTowerSDK data | `third-party-licenses.txt`, written at build by `towerforge.client/licensesPlugin.ts` |
| EU AI Act art. 50 (from 2 Aug 2026) | Ask AI is a chatbot | the page says it's an AI and how it works |
| ePrivacy / GDPR consent for notifications | lab reminders use the browser's push service | only after the player taps Remind me and the browser's own permission prompt; off deletes them |
| YouTube API Services Developer Policies | the LIVE badges use the YouTube Data API | Privacy: uses YouTube API Services + Google Privacy Policy link (III.A.2); Terms: YouTube Terms of Service link and agreement (III.A.1); "Live on YouTube" on each stream (III.F.2); channel ids refreshed within 30 days (III.E.4) |

Not needed for now: a cookie banner (nothing to consent to), a DMCA agent
(shares are stats, not uploads), an Impressum (the site is run from the US),
CCPA's notices (below its thresholds).

## Open items

- A contact email (e.g. privacy@towerforge.net) would be more usual than
  Discord for privacy requests.
- The Link exe and APK carry no license notice of their own; the site's
  licenses file lists what they bundle (.NET runtime, Shizuku API).
