# Creators live now

Creator Codes shows a red **LIVE** badge on a creator who is streaming The
Tower right now, with the stream's title, how long it's been on, the viewer
count and a "Watch on Twitch / YouTube" button. Live creators move up under
the site maker's pinned code, a "N live now" button filters to them, and the
⭐ Creators tab gets a red dot. Owner's request, 2026-11-09: only Tower
streams, never another game.

## How it works

```
Twitch Helix ─┐                           (every 2 min)
              ├─ LiveStreamService ─ GET /api/creators/live ─ browser (every 2 min while open)
YouTube ──────┘   (TowerForge.Server)      (cached 60 s)
```

- **The server asks, the browser doesn't.** Visitors' browsers only talk to
  towerforge.net (`components/common/liveCreators.ts`); Twitch or YouTube see
  a visitor only when they open a stream. The server sends those platforms the
  channel names and TowerForge's keys, nothing about visitors.
- **Channels**: `TowerForge.Server/creator-channels.json`, written from
  `creatorCodes.ts` by `npm run creator-channels`; `creatorCodes.test.ts`
  fails when it's out of step. YouTube links must be `@handle` channel
  addresses and Twitch links `twitch.tv/<login>`.
- **Keys**: `stream-keys.json` in the data directory (`/var/lib/towerforge` on
  the server, owner-only, never in the repo). The owner's copy is
  `%USERPROFILE%\.towerforge\stream-keys.json`, beside the Android signing key.
  The server reads it again when it changes; without it the badges are off.

  ```json
  { "LiveStreams": { "TwitchClientId": "…", "TwitchClientSecret": "…", "YouTubeApiKey": "…" } }
  ```

  Install or replace on the VPS (from the repo root, PowerShell):

  ```
  scp $env:USERPROFILE\.towerforge\stream-keys.json <vps>:/tmp/stream-keys.json
  ssh <vps> "sudo install -o towerforge -g towerforge -m 600 /tmp/stream-keys.json /var/lib/towerforge/stream-keys.json && rm /tmp/stream-keys.json"
  ```

### Twitch

An app access token (client credentials, about 60 days), then one
`helix/streams?user_login=…` request for every channel (up to 100) every
2 minutes. A stream counts only in **The Tower – Idle Tower Defense**
category, game id **867147028** (IGDB 206923). Checked 2026-11-09: it's the
category on jplaysone's and the owner's channels and on the 24/7 Tower stream
that was live. Twitch has nine games named "The Tower"; the others are
different games.

### YouTube

YouTube's "is this channel live" search (`search.list eventType=live`) costs
100 of the 10,000 free daily quota units a call, about 4 checks a day for
24 channels. Instead, every 4 minutes:

1. Each channel's public feed, `youtube.com/feeds/videos.xml?channel_id=…`
   (free), for its 5 newest videos. A live stream is in it from when it's
   scheduled or starts: on 2026-11-09 Flipstar's and Zaerdin's live streams
   were the newest entries, published within a minute of going live.
2. `videos.list?part=snippet,liveStreamingDetails` for those videos, 50 a
   call (1 unit): `liveBroadcastContent == "live"` is live now;
   `actualStartTime` and `concurrentViewers` (missing when hidden) come from
   it.

That's 3 units a check, about 1,100 a day. The @handles are turned into
channel ids once (`channels.list?forHandle=`, 1 unit each), kept in
`youtube-channels.json` in the data directory and looked up again after 30
days, as YouTube's rules ask (Developer Policies III.E.4). The key goes in the
`X-Goog-Api-Key` header, not the address, and `System.Net.Http.HttpClient`
logs only warnings (`appsettings.json`): .NET 8 logs full request addresses
at Information, which put the key in the log in the first local test.

**Tower only.** The Data API has no game field, so `StreamCheck.IsTowerYouTube`
reads the words: a stream counts when its title says The Tower or something
only Tower streams say (tourney, a league, T18, tier 24, milestone, UW,
modules, labs, relics, disco), or its tags or its description's **first line**
name the game, and the title doesn't name another game (WoW, Minecraft, Call
of Duty…). Lower description lines don't count: a World of Warcraft stream's
footer had `#thetower`.

Checked on the creators' last 190 streams (2026-11-09, from their feeds):

| | Streams |
|---|---|
| Shown | 161 |
| Left out, another game (WoW ×8, Call of Duty ×2, Minecraft ×3, one of them "Minecraft/The Tower") | 13 |
| Left out, Tower streams whose titles don't say it ("Late night streaming." and the like ×11 on one channel, "Strom Live Stream", "Crowbarzero is live!" ×2, "Vs Skye", "2 for 2 in Mythic?") | 16 |

Missing a stream with a bare title is the price of never showing another game.
A creator who wants to show up can name the game or the tournament in the
title. The cases are tests in `TowerForge.Server.Tests/StreamCheckTests.cs`
(`dotnet test TowerForge.Server.Tests`).

## Channels added for this (2026-11-09)

Twitch links found in the creators' own YouTube stream descriptions ("Follow
me on Twitch …"): Spartan (`atspartangaming`), Flipstar (`mrflipstarstower`),
Kohyal (`kohyal_studios`), Kryntos (`kryntos`). The owner's own:
`h3llxspawnerx`.

## Checked end to end (2026-11-09)

The local server (`towerforge-server-local`) with the real keys: Flipstar's
24/7 Tower stream showed on Twitch and YouTube; Zaerdin's World of Warcraft
stream, live at the same time, was left out. The page was checked at 375 px
and desktop with that answer and with a made-up one (the site maker's card
live, three creators live, the filter on).

## Rules that apply

- **YouTube API Services** (Developer Policies): the Privacy page says the
  site uses YouTube API Services and links Google's Privacy Policy (III.A.2);
  the Terms link YouTube's Terms of Service and say using the site means
  agreeing to them (III.A.1); a stream shown says "Live on YouTube" and opens
  on YouTube (III.F.2); stored API data (channel ids) is refreshed within 30
  days, stream data is only in memory (III.E.4).
- **Twitch Developer Agreement**: public stream data shown with a link to the
  channel.
- The badges add nothing that loads from another site on a normal visit
  (`docs/privacy.md`).
