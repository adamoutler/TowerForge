# TowerForge Link — game data straight from an emulator, Android phone or iPhone backup

Players shouldn't have to hunt for `tool_export.json`. TowerForge Link is a
small Windows helper (`TowerForge.Link/`, .NET 8, one self-contained exe)
that reads the file off an emulator with the emulator's own adb — or, since
0.3, off an **Android phone on the same Wi-Fi** with Google's adb — and
hands it to towerforge.net open in the same PC's browser. The site's
**🖥 Get from emulator or phone** button and its **⚙** setup (next to
Import Game Data; hidden on phones and tablets) talk to it.

## Why a helper is needed

- The game writes the export to its own app folder:
  `/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json`
  (Unity's `persistentDataPath`; TheTowerSDK `save/access/path`). The game's
  export button saves it there silently.
- Android 11+ hides other apps' `Android/data` folders from browsers, file
  managers and even "All files access" apps, so players end up searching or
  can't reach it at all. adb (Android's debugging connection) can.
- A web page can't run programs or open connections to an emulator, so a
  local helper does that part.

## What the player does

Once (the setup dialog, `components/LinkModal.tsx`, walks through it and
shows what Link found, checked every 4 s while it's open):
1. Download `TowerForgeLink.exe` from the dialog (`/downloads/TowerForgeLink.exe`)
   and run it. **Unsigned for now** — Windows SmartScreen says "Windows
   protected your PC"; More info → Run anyway. The dialog says why (no paid
   publisher certificate yet) and links the source on GitHub; browsers may
   also call the download uncommon (Keep). Signing is a later step.
2. Emulator: turn on ADB. BlueStacks: Settings → Advanced → Android Debug
   Bridge (ADB). Phone: see "Android phones over Wi-Fi" below.
3. The first time, Chrome / Edge ask whether towerforge.net may talk to apps
   on this device (Local Network Access) — allow.

Each time: export in the game (or Auto export), then click **Get from
emulator or phone** — or leave **⟳ Auto import** on.

Analytics (2026-10-16 → 10-23, before this dialog): 38 visitors pressed the
button with Link not running and 8 ever imported through it — the dialog
was rewritten to get more of them through setup.

## What happens when they click

1. The page calls `GET http://localhost:47821/export` (`engine/linkClient.ts`).
   If nothing answers, the setup dialog (`components/LinkModal.tsx`) opens.
2. The helper finds the emulators (`Emulators.cs`) and picks one adb — the
   running emulator's own, so it doesn't fight the adb the emulator runs,
   else Android's platform-tools.
3. `adb connect 127.0.0.1:<port>` for each running emulator.
4. For each device adb lists: `adb ls` the game's folder (the file-transfer
   channel — gives size and modified time; no shell needed).
5. The newest `tool_export.json` — or the one from the source the player
   picked (`?source=`, below): `adb pull` into a temp file, read, delete.
6. The file goes back to the page with its time and emulator
   (`X-Export-Modified`, `X-Export-Source`, and `X-Export-Source-Id` from
   0.4); the page imports it exactly like a chosen file and says how old the
   export is.

### More than one emulator or phone (Link 0.4, 2026-10-25)

Before 0.4 the newest export always won, so a player with BlueStacks and
MuMu both open couldn't choose (the owner's report). Now the page first asks
`GET /sources`: one adb scan, nothing copied, every emulator, phone and
iPhone backup Link sees — `id` (`bluestacks:5555`, `mumuplayer:16384`,
`phone:<serial>`, `iphone-backup`), `name`, `kind`, `state` (`ready` with
`modified`, else `no_export`, `no_game`, `blocked`, `offline`,
`unauthorized`, `encrypted`) and Link's `message` for what's in the way. A
running emulator that gave adb no device at all (ADB off) is listed too, as
`offline`. With more than one, the site shows **Import from…**
(`components/LinkSourcePicker.tsx`): each with its export's age or the
message, the remembered or newest one picked; **Import** asks
`/export?source=<id>`. The pick is kept per browser (`tc_link_source`) and
Auto import passes it on every check. Older Links answer `/sources` with
404 and ignore `source` — the site falls back to the newest. Ids are the
emulator's name and adb port, so `emulator-5554` and `127.0.0.1:5555` (one
BlueStacks) are one source. Checked on the owner's PC: BlueStacks listed
ready, MuMu offline with its message, `?source=` honoured, `newerThan` still
answering 204.

Problems come back as a message for the player (HTTP 409 with `error` and
`message`), shown in the dialog: emulator not running, ADB off (BlueStacks
wording includes where the switch is), no export yet, game not installed,
phone asking to allow USB debugging.

## Auto import (2026-10-21, Link 0.2)

The game (29.1.3+) can export by itself every time it saves (Settings →
tap the player ID 5 times → External Tools Export → Auto; the option stays
hidden until those taps). The header's **⟳ Auto import** toggle
(`components/common/AutoImport.tsx`, off until the player turns it on,
remembered per browser) keeps the site in step while it's open:

- Every 30 s while the page is visible it asks
  `GET /export?newerThan=<file time of the last export it read>`. Link 0.2
  answers **204** (no body, nothing copied, nothing in its window) when the
  file isn't newer; older Links ignore the parameter and send the file.
- The game saves often during a run, so a newer export is imported right
  away only when it has a run the site doesn't have yet; otherwise at most
  every 10 minutes (currencies, levels), so a signed-in account isn't
  re-saved after every game save. A skipped export is read again once the
  10 minutes are up (`engine/autoImport.ts`, tested).
- Imports quietly: a short note, no pop-up. It waits for the account to
  load first, so a signed-in account's saved stats don't land on top of it.
- If Link isn't running when it's turned on, the setup dialog opens; later
  the button turns gold and its tooltip says why.

**Link opens the site (0.5, 2026-11-13).** When Link starts and no towerforge.net
page asks it anything within 6 seconds (the setup dialog asks every 4 s), it
opens `https://towerforge.net/?link=import` in the default browser, and the site
imports on load (after a signed-in account has loaded): starting Link is the
whole job. A page that is asking means the site is open, so Link doesn't open
another tab and that page brings the data in. Started again while a copy runs,
it opens the site instead of only saying so, then closes. `--no-browser` turns
it off; `--site <url>` opens another address (testing). The Android app's
"Open towerforge.net" (`?link=android`) imports on load the same way. Checked
2026-11-13: a test copy on port 47999 with a site page asking every second
logged "towerforge.net is open and asking" and opened nothing; the site at
`?link=import` asked Link at once (with two sources it showed "Import from…")
and tidied the address. Opening the browser itself wasn't run on the owner's
PC (it would open a tab there); it's Windows' standard open-this-address call.

The setup dialog itself (`components/LinkModal.tsx`, 2026-11-13: half the PC
players who met "Link isn't running" left without importing, Umami, 30 days):
it asks Link for its status every 4 s, and when Link goes from not running to
running it reads the export by itself (event `Emulator link: started`), so
starting Link is the only step. While Link isn't running it also offers the
file itself ("Skip Link: Choose the file"). On a Mac or Linux it shows the
ways that work there (the Mac Terminal line, the Import Guide) instead of the
Windows download, and on an iPhone or iPad the computer-backup ways instead of
the Android app. Checked in the preview with Link's answers blocked, then let
through: the dialog asked for `/sources` and `/export` by itself.

Checked 2026-10-21 against a stand-in Link with a made-up export: first
import on turning it on, a mid-run save skipped, a finished run imported at
the next ask, and the gold state when Link stopped. Link 0.2 itself checked
on BlueStacks: 204 for the same time, the file for an older one.

## Safety

- Listens on 127.0.0.1 only; nothing off the PC can reach it.
- Answers only `https://towerforge.net` / `www` and the local dev servers
  (`localhost:5173`, `localhost:4174`); other sites are refused, and the
  browser wouldn't let them read the answer anyway.
- Checks the `Host` header, so a site pointing its own name at 127.0.0.1
  (DNS rebinding) gets nothing.
- It reads that one file and nothing else. The phone actions (0.3) only
  download Google's adb from Google, or pair / connect with an address on a
  home network (10.x, 172.16–31.x, 192.168.x, 169.254.x) and a 6-digit code;
  anything else is refused before adb runs. It can't run other adb commands
  for anyone.
- iPhone backups (0.3) are only read, never changed: one file found by its
  documented name, nothing else in the backup is opened.
- The data goes emulator, phone or backup → helper → browser. Nothing is
  uploaded.

## Emulators

| Emulator | adb | Port(s) | Checked |
|---|---|---|---|
| BlueStacks 5 (and MSI / CN builds) | `HD-Adb.exe` in the install folder (registry `HKLM\SOFTWARE\BlueStacks_nxt` → `InstallDir`) | `bst.instance.*.adb_port` in `bluestacks.conf` (`UserDefinedDir`), usually 5555 | ✅ 5.22, Pie64 (Android 9), 2026-10-19 |
| MuMu Player 6 (and 12) | `nx_main\adb.exe` in `C:\Program Files\Netease\MuMuPlayer` (MuMu 12: `MuMuPlayer-12.0\shell`); `MuMuManager.exe` beside it when adb can't reach an instance | each instance's `vms\<instance>\configs\vm_config.json` → `vm.nat.port_forward.adb.host_port` (16384 for the first), name in `extra_config.json` `playerName`, number from the folder (`…-0`); else 16384 (+32 per instance), 7555 | ✅ 6.8.5 (Android 15, Hyper-V), 2026-10-25: install, config, port, and the export read through `MuMuManager.exe` (Link 0.4.1) — 134,366 bytes, the file's own size; through adb not yet (its port stayed shut, below) |
| LDPlayer 9 | `C:\LDPlayer\LDPlayer9\adb.exe` | 5555, 5557, … | from guides |
| MEmu | `Microvirt\MEmu\adb.exe` | 21503, 21513, … | from guides |
| Nox | `Nox\bin\nox_adb.exe` | 62001, 62025, … | from guides |
| Phone over Wi-Fi (Android 11+) | Google's adb ≥ 1.0.41 (Link's own copy, the SDK or `PATH`) | wireless debugging's, found by mDNS | error paths, download and status ✅ 2026-10-23; a real phone not yet |
| Phone on USB | Android platform-tools (`PATH` or `%LOCALAPPDATA%\Android\Sdk`) | — | not yet |

BlueStacks notes (5.22):
- `bst.enable_adb_access` in `bluestacks.conf` is the Settings switch. With
  it off, adb connects and lists the device but every command is closed.
- Switched on in the file while BlueStacks ran, it applied within a few
  minutes without a restart; the helper's message says to wait a minute or
  restart.
- adb also finds it as `emulator-5554` on its own; both serials are the same
  emulator.
- Instances (`bst.instance.<id>.display_name`) can share one adb port — only
  one runs at a time; a name is added to the source only when instances use
  different ports.

Installed somewhere else (Link 0.4.2, 2026-10-26): a player's MuMu
Player ran on screen while Link said "No Android emulator found yet" — Link
looked only in the usual folders, and the installers let players pick any
folder or drive. `InstallSearch.cs` also asks Windows' list of installed apps
(the registry's Uninstall entries: InstallLocation, DisplayIcon's folder,
for names containing MuMu / LDPlayer / 雷电模拟器 / MEmu / Nox) and the
emulator's running programs (their full path, `QueryFullProcessImageName`,
no admin needed), then looks for the emulator's own adb in those folders and
a few above. MuMu's install folder is the one with `MuMuManager.exe` beside
its adb — not just adb and `vms`: MuMu 6's `nx_device\15.0` has both (a base
image) and its device runs from there. Link's window now prints each
emulator's folder ("Found MuMu Player (running) — …\nx_main"), so a
screenshot shows which install it uses. Checked on the owner's PC with
`TOWERFORGE_LINK_NO_DEFAULTS=1` (skip the usual folders) and `=2` (also skip
the app list: running programs only): MuMu found in the right folder and its
export read, both ways and with the usual folders.

MuMu Player 6.8.5 notes (the owner's PC, 2026-10-25):
- Running (`MuMuNxDevice`, `MuMuManager.exe info -v all` →
  `player_state: start_finished`, `adb_port: 16384`), yet nothing listened on
  16384: `adb connect` was refused, and `MuMuManager.exe adb -v 0 -c connect`
  answered "vm not ready, can not connect adb". The instance's
  `customer_config.json` had ADB debugging on "local connect"; whether a
  restart after the setting or another switch is needed isn't known yet.
  The owner then set Settings → **Developer options** → **ADB debug** to
  "Enable local & remote connection" (the setting's real name; the instance
  restarted, `shell_config.json` `adb_debug.mode` 0 → 2): still nothing on
  16384, the manager still "vm not ready" — yet inside, `sys.boot_completed`
  1 and `init.svc.adbd` running. MuMu's host side never opened the port.
- **Link 0.4.1 reads it anyway** (`MuMuShell.cs`): `MuMuManager.exe sh -v <n>
  -c <command>` reaches the instance without adb (it runs as root inside).
  When an instance gives adb no device, Link runs `stat -c '%s %Y'` on the
  export for its size and time, and `cat <export> | base64` to read it —
  base64 because the manager passes text, and the decoded bytes were the
  file exactly (size for size, `{`…`}`; a plain `base64 <file>` printed
  nothing there, `cat … | base64` works). Fixed commands on that one path; no
  input from the site reaches them. Only when MuMu's manager can't reach the
  instance either does Link say "MuMu Player is running but isn't letting
  TowerForge Link connect…".
- MuMu's adb is 1.0.41, BlueStacks' HD-Adb 1.0.36: running one kills the
  other's server ("adb server version doesn't match"). Link uses one adb (the
  first running emulator's) for every emulator, which connects to both.
- Link reads MuMu's config files for ports and names, and runs
  `MuMuManager.exe` only for the two commands above.

## Building and shipping

- `dotnet publish TowerForge.Link -c Release -o <folder>` → `TowerForgeLink.exe`
  (~11.8 MB with Link 0.3, trimmed, single file, no .NET install needed).
- `deploy.ps1` publishes it into `towerforge.client/dist/downloads/` after the
  site build, so it ships with every deploy.
- Version: `<Version>` in `TowerForge.Link.csproj` (shown in its window and
  `/status`).

## Android phones over Wi-Fi (2026-10-23, Link 0.3)

For Android 11+ players with a PC: Link reads the phone the same way it
reads an emulator, over the phone's **Wireless debugging**, so the game's
Auto export plus the site's Auto import keep the site up to date while they
play on the phone. Phone and PC must be on the same Wi-Fi.

The player (the dialog's "Android phone" tab):
1. Developer options: Settings → About phone → tap Build number 7 times
   (Samsung: About phone → Software information).
2. Settings → Developer options → **Wireless debugging** → on.
3. **Get Google's adb** (once): emulators ship old adbs that can't pair
   (BlueStacks 5.22: 1.0.36; pairing needs 1.0.41, platform-tools 30+).
   Link uses one already on the PC (its own copy, the Android SDK folder,
   `PATH`), else downloads Google's package from
   `dl.google.com/android/repository/platform-tools-latest-windows.zip` and
   keeps `adb.exe`, its two DLLs and the notice in
   `%LOCALAPPDATA%\TowerForgeLink\platform-tools\` (`PlatformTools.cs`).
4. **Pair** (once): on the phone, *Pair device with pairing code*; the
   address and 6-digit code are typed in the dialog → `adb pair`. adb keeps
   the pairing (its key on the PC, the PC in the phone's list).
5. In the game: External Tools Export → Auto; on the site: Auto import.

Each time after (`Phones.cs`): before looking for the export Link runs
`adb mdns services`, connects to every `_adb-tls-connect._tcp` it lists (and
the last address that worked), then reads the file exactly as from an
emulator (`adb ls` + `adb pull` of the same path — adb's shell user can read
`Android/data`, which is why it works where apps and browsers can't).
Remembered in `%LOCALAPPDATA%\TowerForgeLink\phones.txt`: the phones paired
through Link and their last address, never the code.

Endpoints (POST, from towerforge.net only, one at a time with export reads):
`/phone/adb`, `/phone/pair?address=&code=`, `/phone/connect?address=`,
`/phone/forget`. `/status` gains `phone: { adbReady, adbVersion, paired,
connected: [model…] }` (missing before 0.3, so the dialog tells 0.1/0.2
users to update). With no phone paired, Link behaves exactly as 0.2
(emulator's own adb).

Checked 2026-10-23 on the owner's PC (the published, trimmed exe on a spare
port, then on 47821 with the site): `/status` with BlueStacks; other sites
refused; preflight allows POST; an internet address, a bad code and a phone
action without Google's adb each refused with the player's message; Google's
adb downloaded (1.9 s, adb 1.0.41) and reported ready; pairing and
connecting to an address with no phone fail after 20 s / 8 s with the
player's message and nothing remembered; adb's mDNS discovery runs (no
phones advertising); `/export?newerThan=` still answers 204 from BlueStacks.
**Not checked yet: a real phone** — pairing, mDNS reconnect after a phone
restart, and reading `Android/data` on Android 13–15.

Limits:
- Wireless debugging switches itself off when the phone restarts or leaves
  the Wi-Fi; switching it back on is enough (no new pairing).
- Guest networks and some routers block devices from seeing each other
  (client isolation) or block mDNS; the dialog's **Connect** field takes the
  address from the top of the Wireless debugging screen instead.
- Google's adb and an emulator's own adb fight over the adb server (port
  5037; each restarts it on a version mismatch). With a phone paired Link
  uses Google's for emulators too, so it doesn't flip back and forth.

## iPhone (2026-10-23)

iOS keeps the game's files in its sandbox: no app on the iPhone, no browser
and no Files app can open them, and the game has no share button for the
export (owner, 2026-10-23). What does reach them:

| Route | Status |
|---|---|
| **Backup to a Windows PC** — Link reads the export out of the newest iPhone backup | ✅ built (Link 0.3, `IPhoneBackups.cs`); checked on made-up backups, a real iPhone backup not yet |
| Link starts the backup itself (libimobiledevice `idevicebackup2`) | next — one click, or automatic over Wi-Fi |
| The game running on an Apple-silicon Mac — the export is on disk | instructions on the site (Terminal copy) |
| Backup to a Mac (Finder) | same backup format; Link is Windows-only for now |
| The iPhone alone | needs the game to expose the file (below) |

**Backups.** A backup of the iPhone to a computer (Apple Devices app or
iTunes: "Back up all of the data on your iPhone to this computer") includes
the game's `Documents` folder — players already pull the save out of it
("Applications/com.TechTreeGames.TheTower/Documents/playerInfo.dat" in
backup viewers, [the-tower-unified-tools](https://github.com/SFleet89/the-tower-unified-tools)),
and the game writes `tool_export.json` next to it (Unity's
`persistentDataPath`).
- Folders: `%USERPROFILE%\Apple\MobileSync\Backup` (Apple Devices app,
  iTunes from the Microsoft Store) and `%APPDATA%\Apple Computer\MobileSync\Backup`
  (iTunes from apple.com) — Apple's support page; one folder per device.
- Layout (iOS 10+): each file is stored as `<first 2 of id>/<id>`, the id
  being SHA-1 of `"<domain>-<relativePath>"`, here
  `AppDomain-com.TechTreeGames.TheTower` + `Documents/tool_export.json` →
  `86/86a2a853851a70370eaab58ebfa39a3ee733885b`. `Manifest.db` (SQLite)
  maps them; Link computes the id instead (no SQLite in the exe), and also
  tries `domain/path` and the old flat layout.
- `Info.plist` (XML) gives "Device Name" and "Last Backup Date"; an
  unencrypted backup's `Manifest.db` starts `SQLite format 3\0`, an
  encrypted one doesn't.
- **Encrypted backups** ("Encrypt local backup") can't be read yet: it takes
  the backup password (PBKDF2 → keybag → per-file AES keys; open-source
  readers exist, e.g. iOSbackup). The dialog says to leave encryption off and
  what that means (encrypted backups also keep saved passwords and Health
  data).
- Hands-free: with "Show this iPhone when on Wi-Fi" the backup needs no
  cable; iTunes syncs (and backs up) by itself when iTunes is open, the
  iPhone is charging and both are on the same Wi-Fi (Bonjour on). Auto
  import picks up each new backup.
- The newest export wins between an emulator / Android phone and the
  backups. `/status` lists the backups (`iphoneBackups`: when, encrypted,
  has the export). `--backups <folder>` points Link at a test folder.

Checked 2026-10-23 with made-up backups (an `Info.plist`, a
`Manifest.db` header, a made-up export at the hashed path): `/status`
listed it; `/export` returned exactly that file as "your iPhone backup from
Oct 23, 13:05"; `?newerThan=` its time → 204; an encrypted one is reported
encrypted and skipped; the site imported it through the dialog's Try again.
**Not checked: a real iPhone backup** — the next step is one player backing
up to a Windows PC with Link running.

Lesson from that test: Link reads the newest export of all sources, and
BlueStacks' Auto export kept writing the owner's real one — test with a
made-up export dated ahead of it (or `?newerThan=`), never by importing
whatever Link finds into the preview browser.

**Link starting the backup** (next): libimobiledevice's `idevicebackup2`
(LGPL-2.1, Windows builds in MSYS2) runs the device's backup service over
USB or Wi-Fi sync, through Apple's Mobile Device Service from the Apple
Devices app. Link could then offer "Back up and import" and keep an iPhone
in step without opening Apple Devices.

**The game on a Mac** (the iPad build on Apple silicon): its files are in
`~/Library/Containers/<random id>/Data/Documents/` (fan toolkit above). The
dialog gives a Terminal line that copies `tool_export.json` to the Desktop.

**The iPhone alone** needs Tech Tree Games: either a "Share" button for the
export (iOS share sheet), or two keys in the game's `Info.plist` —
`UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` = YES — which
show the game's Documents folder in the Files app ("On My iPhone → The
Tower"; a Unity developer confirmed both keys are needed). Then the site's
Import Game Data could open the export in Safari straight from Files, and an
iOS Shortcut ("When The Tower is closed") could even pass it along. (The
keys would also expose `playerInfo.dat`; a share button exposes only the
export.)

## Phone only, no PC: TowerForge Link for Android (2026-10-23, app 0.1.0)

Most visitors are on phones (61%, 2026-10-16 → 10-23; only 6% of them
imported, against 20% on PCs). For Android players without a PC,
`TowerForge.Link.Android/` (Java, no AndroidX, ~110 KB APK) does on the
phone what Link does on a PC — a web page alone can't open `Android/data`.
The player-facing steps, screen by screen, are the Import Guide tab
(`/import-guide#android-phone`, `components/tabs/ImportGuideTab.tsx`).

How it works:
1. **Reading the file — Shizuku** (free, Google Play, `moe.shizuku.privileged.api`;
   API `dev.rikka.shizuku:api`/`provider` 13.1.5). Shizuku runs a service
   with adb's shell rights, started on the phone through Wireless debugging
   (Android 11+; it pairs through its own notification, no PC). The app
   binds a Shizuku *UserService* (`ExportReaderService`, running as the
   shell user) through the AIDL `IExportReader`: `state()` (0 ok, 1 no game
   folder, 2 no export, 3 unreadable), `modified()` and `open()`, which hands
   back a read-only `ParcelFileDescriptor` of
   `/storage/emulated/0/Android/data/com.TechTreeGames.TheTower/files/tool_export.json`.
   `ShizukuReader` binds on the main thread and waits; a bind that never
   answers is retried after 15 s. After each phone restart the player opens
   Shizuku and taps Start (Wireless debugging needs Wi-Fi; no new pairing).
2. **Talking to the site — the same API as Link.** `LinkService`, a
   foreground service (type `specialUse`, notification "TowerForge Link is
   on" with Stop), runs `LinkServer` on `127.0.0.1:47821`: `/status` and
   `/export?newerThan=` with the same Origin allow list, Host check, CORS,
   Private Network Access preflight and 204-when-not-newer as the Windows
   Link. `/status` says `"platform":"android"` and
   `"android":{"shizuku":"ready|not_installed|not_running|no_permission","export":"found|none|no_game|unreadable","exportModified":…}`;
   `/export` errors are `shizuku_missing`, `shizuku_off`,
   `shizuku_permission`, `no_game`, `no_export`, `copy_failed`, `bad_file`,
   each with a plain message. `X-Export-Source` is "your phone".
3. **The app's screen** (`MainActivity`, built in code, Synthwave colors) is
   a five-step checklist that turns green as it goes: install Shizuku (Play
   link) → start it (opens Shizuku) → Allow (Shizuku's own prompt, "Allow
   all the time") → the export found (opens The Tower) → Start Link (asks
   for notifications on Android 13+). Then **Open towerforge.net** opens
   `https://towerforge.net/?link=android`.
4. **The site on the phone.** The emulator/phone button and Auto import stay
   hidden on touch screens unless the phone opened the site from the app
   once: `?link=android` sets localStorage `tc_link_phone`
   (`engine/linkClient.ts` `phoneLinkRemembered`), which adds
   `html.tf-phone-link` and shows them. (Asking `127.0.0.1` on every phone
   visit would make Chrome ask every phone visitor about local network
   access, so the site doesn't.) The ⚙ setup shows the phone's steps and
   what the app reports; "Don't show the Link buttons on this phone" forgets
   it. A touchscreen PC whose Windows Link answers keeps the PC steps. Auto
   import checks again the moment the page becomes visible, so switching
   from the game to the browser brings the newest export in.
5. **Shipping.** `deploy.ps1` builds the signed release APK into
   `downloads/TowerForgeLink.apk` (step 2c) and stops if the signing key is
   missing. nginx needs `ops/nginx/towerforge-types.conf` for the APK's type
   (Debian's `mime.types` has no `apk`). Google Play later (developer
   account, review, a privacy policy page).

**Tested** (2026-10-23) on BlueStacks 5 (Android 9, x86_64) with Shizuku
13.6.0 started through adb (`libshizuku.so`), debug and signed release
builds: the checklist turned green step by step; through `adb forward`,
`/status` answered `shizuku: ready, export: found`, another origin got 403,
the preflight 204 with `Allow-Private-Network`, `?newerThan=` (future) 204,
the full export 200 starting with `{`; with Shizuku stopped `/export` said
`shizuku_off` (409), and after Start it re-bound by itself. Not yet tried on
a real phone (Android 11+, Wireless debugging pairing, Doze) — owner to
test. The site side was checked in the preview at 375 px with Link answers
faked in the page.

### Building the Android app

- Toolchain (not in the repo, ~1.5 GB): `%LOCALAPPDATA%\TowerForgeBuild\`
  — `jdk17` (Temurin 17), `android-sdk` (cmdline-tools as `latest`,
  `platforms;android-35`, `build-tools;35.0.0`, `platform-tools`), `gradle`
  (8.10.2). The new `sdkmanager.bat` splits arguments at `;`, so install
  packages with `--package_file=<file>` (one per line).
- `TowerForge.Link.Android\build.ps1` (Gradle wrapper, AGP 8.7.3,
  compileSdk/targetSdk 35, minSdk 28): no flags → signed release APK;
  `-Debug`; `-Out <file.apk>` copies it; `-NewKey` creates the signing key
  once.
- **Signing key:** `%USERPROFILE%\.towerforge\link-android.jks` and
  `link-android-signing.properties` (created 2026-10-23; certificate
  SHA-256 `e4c7e411…bd648f`). Never in the repo. Back the folder up:
  Android installs an update only when it's signed with the same key.
- Version: `versionCode` / `versionName` in `app/build.gradle` (shown in
  `/status`).
- Considered and ruled out: the Storage Access Framework (Android 11+ won't
  grant `Android/data`), "All files access" (still excludes
  `Android/data`), root. Later: the app doing the Wireless-debugging pairing
  itself (as LADB does; libadb-android, Apache 2.0) to drop the Shizuku
  step.

## Later

- Code signing (SmartScreen warning), e.g. Azure Trusted Signing.
- The Android app on Google Play; Link starting iPhone backups; reading
  encrypted iPhone backups; a Mac build of Link.
- A "Connect phone" button using WebUSB adb in Chrome / Edge, for phones on
  USB without installing anything.
