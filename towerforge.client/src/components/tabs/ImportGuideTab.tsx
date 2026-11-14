// ============================================================
//  TowerForge Companion — Import Guide
//  Every way to get the game's data export (tool_export.json) into
//  the site, step by step, with what each screen says: a file on any
//  device, an emulator on a PC (TowerForge Link), an Android phone with
//  a PC (Wi-Fi) or alone (TowerForge Link for Android + Shizuku), an
//  iPhone (a backup on a Windows PC), a Mac; then every message Link
//  can show and what to do, and the safety questions.
//  Sections are addressable (guideNav.ts, /import-guide#android-phone).
//  How each route works underneath: docs/towerforge-link.md.
// ============================================================

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { LINK_DOWNLOAD, LINK_DOWNLOAD_ANDROID } from '../../engine/linkClient';
import { GUIDE_EVENT, takeGuideSection } from '../../guideNav';
import { trackEvent } from '../../analytics';
import { TAB_PATHS } from '../../routes';

const SHIZUKU_PLAY = 'https://play.google.com/store/apps/details?id=moe.shizuku.privileged.api';
const SHIZUKU_GUIDE = 'https://shizuku.rikka.app/guide/setup/';
const SOURCE = 'https://github.com/mannypein/TowerForge';

// Opening the page at a part jumps there; a link on the page glides.
function scrollTo(id: string, glide = true) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: glide ? 'smooth' : 'auto', block: 'start' });
}

const CHOICES: { id: string; icon: string; title: string; what: string }[] = [
    { id: 'file', icon: '📄', title: 'I already have the file', what: 'Any phone, tablet or computer.' },
    { id: 'emulator', icon: '🖥', title: 'I play on an emulator on my PC', what: 'BlueStacks, LDPlayer, MuMu, MEmu or Nox on Windows.' },
    { id: 'android-phone', icon: '📱', title: 'I play on an Android phone (no PC needed)', what: 'TowerForge Link for Android, on the phone itself.' },
    { id: 'android-pc', icon: '📶', title: 'I play on an Android phone and have a Windows PC', what: 'The PC reads the phone over Wi-Fi.' },
    { id: 'iphone', icon: '🍎', title: 'I play on an iPhone', what: 'Needs a Windows PC: the export comes from a backup.' },
    { id: 'mac', icon: '💻', title: 'I play on a Mac', what: 'The game on the Mac itself, or an iPhone with a Mac.' },
    { id: 'troubleshooting', icon: '🛠', title: 'Something went wrong', what: 'Every message, and what to do about it.' },
    { id: 'faq', icon: '❓', title: 'Is it safe? What does it read?', what: 'Privacy, removing everything, other questions.' },
];

// ── Building blocks ─────────────────────────────────────────────
function Section({ id, icon, title, lead, children }: { id: string; icon: string; title: string; lead?: ReactNode; children: ReactNode }) {
    return (
        <section id={id} className="igd-sec">
            <h2><span aria-hidden="true">{icon}</span> {title}</h2>
            {lead && <p className="igd-lead">{lead}</p>}
            {children}
            <button className="igd-top" onClick={() => scrollTo('igd-top')}>↑ Back to “Which one is you?”</button>
        </section>
    );
}

const Part = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="igd-part">
        <h3>{title}</h3>
        {children}
    </div>
);

const Steps = ({ children }: { children: ReactNode }) => <ol className="igd-steps">{children}</ol>;

const Need = ({ items }: { items: ReactNode[] }) => (
    <div className="igd-need">
        <strong>You need:</strong>
        <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
);

const Box = ({ kind, children }: { kind: 'tip' | 'warn' | 'why' | 'again'; children: ReactNode }) => (
    <div className={`igd-box igd-${kind}`}>
        <strong>{{ tip: '💡 Tip', warn: '⚠️ Heads up', why: 'ℹ️ Why', again: '🔁 Every time after this' }[kind]}</strong>
        <div>{children}</div>
    </div>
);

// What a screen or message says, word for word.
const Says = ({ children }: { children: ReactNode }) => <q className="igd-says">{children}</q>;

const Go = ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={`#${to}`} onClick={e => { e.preventDefault(); scrollTo(to); }}>{children}</a>
);

function Download({ href, label, event }: { href: string; label: string; event: string }) {
    return <a className="btn btn-gold igd-dl" href={href} download onClick={() => trackEvent(event)}>⬇ {label}</a>;
}

// ── The guide ───────────────────────────────────────────────────
export default function ImportGuideTab() {
    // Open at the section a link asked for (or the address's #part).
    useEffect(() => {
        const first = takeGuideSection() ?? (window.location.hash ? window.location.hash.slice(1) : null);
        const t = first ? window.setTimeout(() => scrollTo(first, false), 80) : undefined;
        const onAsk = (e: Event) => window.setTimeout(() => scrollTo((e as CustomEvent<string>).detail, false), 80);
        window.addEventListener(GUIDE_EVENT, onAsk);
        return () => { window.clearTimeout(t); window.removeEventListener(GUIDE_EVENT, onAsk); };
    }, []);

    return (
        <div className="igd">
            <div id="igd-top" className="igd-head">
                <h1>Import Guide</h1>
                <p>
                    Bring your account from The Tower into TowerForge — workshop, labs, cards, Ultimate Weapons, modules,
                    bots, relics, Guardian, your recent runs and your tournaments — in one go, instead of typing it in. Pick
                    the line that matches how you play; every step is spelled out, with what each screen says.
                </p>
            </div>

            <h2 className="igd-choose-title">Which one is you?</h2>
            <div className="igd-choices">
                {CHOICES.map(c => (
                    <a key={c.id} className="igd-choice" href={`#${c.id}`} onClick={e => { e.preventDefault(); scrollTo(c.id); }}>
                        <span className="igd-choice-icon" aria-hidden="true">{c.icon}</span>
                        <strong>{c.title}</strong>
                        <span>{c.what}</span>
                    </a>
                ))}
            </div>

            {/* ── Step zero ── */}
            <Section id="export" icon="0️⃣" title="First, everyone: make the game export your data"
                lead="TowerForge reads a file the game writes for tools like this one. Whatever device you use, start here.">
                <Steps>
                    <li>Make sure The Tower is up to date (the export came with update <strong>29.1.3</strong>).</li>
                    <li>In The Tower, open <strong>Settings</strong> and find <strong>External Tools Export</strong>.</li>
                    <li>
                        <strong>Export your data now</strong>, or — better — turn on <strong>Auto</strong>: the game then writes
                        the file again every time it saves, so TowerForge always gets your newest numbers.
                    </li>
                </Steps>
                <Box kind="why">
                    The game saves the export as a file named <code>tool_export.json</code> in its own folder. On Android that’s
                    <code>Android/data/com.TechTreeGames.TheTower/files/</code>; on an iPhone it’s inside the app, where only a
                    computer backup can reach it. The sections below show how to get it from there to TowerForge.
                </Box>
            </Section>

            {/* ── A file ── */}
            <Section id="file" icon="📄" title="I already have the file (any device)"
                lead="If tool_export.json (or a PDF of it) is already on the device you’re using, this takes ten seconds.">
                <Steps>
                    <li>Open towerforge.net on that device.</li>
                    <li>
                        Click <strong>⬆ Import Game Data</strong> at the top of the page (on a phone it’s the gold <strong>⬆ Import</strong>).
                        It shows the ways in for your device; tap <strong>📄 Choose the file</strong>. (Once a file import has worked
                        on that device, the button opens the file picker straight away.)
                    </li>
                    <li>Pick <code>tool_export.json</code> (on a phone it’s usually in <em>Downloads</em>).</li>
                    <li>
                        A message lists everything that came in: <Says>✓ Imported from your game data:</Says> followed by
                        currencies, tiers, workshop, labs, cards, Ultimate Weapons, modules, bots, relics, Guardian and battles.
                    </li>
                </Steps>
                <Box kind="tip">
                    A PDF of the export works too (some phones turn the file into a PDF when you share it): pick the PDF in step
                    3. It reads slower, and the site warns that a PDF might miss something.
                </Box>
                <Box kind="why">
                    Everything stays in this browser. To keep it on other devices too, create a free account on the
                    <strong> Player → Account</strong> page — your stats then follow you.
                </Box>
            </Section>

            {/* ── Emulator ── */}
            <Section id="emulator" icon="🖥" title="An emulator on my PC (BlueStacks, LDPlayer, MuMu, MEmu, Nox)"
                lead="TowerForge Link, a small Windows program, copies the export from your emulator into the site — one click, or by itself with Auto import.">
                <Need items={[
                    'A Windows 10 or 11 PC with your emulator and The Tower on it.',
                    'Chrome, Edge or Firefox on the same PC.',
                    'About 5 minutes, once.',
                ]} />

                <Part title="Part 1 — Get TowerForge Link (once)">
                    <Download href={LINK_DOWNLOAD} label="Download TowerForge Link for Windows" event="Link download (guide)" />
                    <Steps>
                        <li>
                            Click the button above (or, on any page, the <strong>⚙</strong> next to <strong>Get from emulator or
                            phone</strong> → <strong>Download TowerForge Link</strong>). The file is <code>TowerForgeLink.exe</code>, about 12 MB.
                        </li>
                        <li>
                            Your browser may warn that the file <Says>isn’t commonly downloaded</Says>.
                            <ul>
                                <li><strong>Chrome:</strong> open the downloads list (the ⬇ at the top right) and click <strong>Keep</strong>.</li>
                                <li><strong>Edge:</strong> click <strong>…</strong> next to the download → <strong>Keep</strong> → <strong>Show more</strong> → <strong>Keep anyway</strong>.</li>
                            </ul>
                        </li>
                        <li>
                            Open the file. Windows will most likely show a blue box: <Says>Windows protected your PC</Says> /
                            <Says>Microsoft Defender SmartScreen prevented an unrecognized app from starting</Says>. Click
                            <strong> More info</strong>, then <strong>Run anyway</strong>.
                        </li>
                        <li>
                            A black window titled <strong>TowerForge Link</strong> opens and lists what it found, for example
                            <Says>Found BlueStacks (running) — Android Debug Bridge on</Says>. <strong>Leave this window open</strong>
                            while you use the site — you can minimize it. Closing it stops Link.
                        </li>
                        <li>
                            A few seconds later Link (0.5 and newer) opens towerforge.net and your data comes straight in. Was the
                            site already open, asking for Link? Then it brings the data in there instead.
                        </li>
                    </Steps>
                    <Box kind="why">
                        Windows shows that warning for any program without a paid publisher certificate, which TowerForge Link
                        doesn’t have yet. Link only reads the game’s export file, only answers towerforge.net, and its code is
                        public: <a href={SOURCE} target="_blank" rel="noopener noreferrer">see it on GitHub</a>.
                    </Box>
                    <Box kind="tip">
                        Move <code>TowerForgeLink.exe</code> somewhere you’ll find it again (Desktop or Documents) — Windows only
                        asks “Run anyway” the first time.
                    </Box>
                </Part>

                <Part title="Part 2 — Turn on ADB in your emulator (once)">
                    <p>ADB is the connection Link uses to read the file. Most emulators have a switch for it:</p>
                    <ul className="igd-list">
                        <li>
                            <strong>BlueStacks 5:</strong> open BlueStacks → <strong>Settings</strong> (the ⚙ in the side bar) →
                            <strong> Advanced</strong> → turn on <strong>Android Debug Bridge (ADB)</strong> → <strong>Save
                            changes</strong>. Then close BlueStacks completely and open it again.
                        </li>
                        <li>
                            <strong>LDPlayer:</strong> <strong>Settings</strong> → <strong>Other settings</strong> → <strong>ADB
                            debugging</strong> → <strong>Open local connection</strong> → <strong>Save</strong>, then restart LDPlayer.
                        </li>
                        <li>
                            <strong>MuMu Player:</strong> nothing to turn on — TowerForge Link (0.4.1 and newer) reads the file
                            through MuMu’s own manager, even when MuMu’s ADB port is shut. If Link still says MuMu isn’t letting
                            it connect: MuMu → <strong>Settings</strong> → <strong>Developer options</strong> → <strong>ADB
                            debug</strong> → <strong>Enable local connection</strong>, then close MuMu completely and open it again.
                        </li>
                        <li>
                            <strong>MEmu, Nox:</strong> ADB is usually on already. If Link says the emulator refused the
                            connection, look in the emulator’s settings for an <strong>ADB</strong> option, turn it on and restart it.
                        </li>
                    </ul>
                </Part>

                <Part title="Part 3 — Import">
                    <Steps>
                        <li>In The Tower (in the emulator), export your data — <Go to="export">step 0</Go>.</li>
                        <li>On towerforge.net, on the same PC, click <strong>🖥 Get from emulator or phone</strong> at the top.</li>
                        <li>
                            The first time, the browser asks something like <Says>towerforge.net wants to access other apps and
                            services on this device</Says> — click <strong>Allow</strong>. (That’s how the page talks to Link.)
                        </li>
                        <li>
                            More than one emulator running (say BlueStacks and MuMu), or a phone too? Link (0.4 and newer) asks
                            <Says>Import from…</Says> and lists each with when it last exported, or what’s in the way. Pick one and
                            click <strong>Import</strong> — the site remembers it, and Auto import reads from it too.
                        </li>
                        <li>
                            Done: the message says where it came from, for example <Says>Read from BlueStacks, exported 2 minutes
                            ago</Says>.
                        </li>
                    </Steps>
                </Part>

                <Part title="Part 4 — Let it keep up by itself (optional)">
                    <Steps>
                        <li>In the game, set External Tools Export to <strong>Auto</strong>.</li>
                        <li>On the site, click <strong>⟳ Auto import off</strong> so it says <strong>⟳ Auto import on</strong>.</li>
                    </Steps>
                    <p>
                        While the page is open, it checks every 30 seconds. A finished run comes in right away; other changes
                        (coins, levels) about every 10 minutes. If something’s in the way, the button turns gold — point at it to
                        see why.
                    </p>
                </Part>

                <Box kind="again">
                    Export in the game, then start TowerForge Link: it opens towerforge.net and brings your data in (Link 0.5 and
                    newer). Already running? Click <strong>Get from emulator or phone</strong> — or leave Auto import on.
                </Box>
            </Section>

            {/* ── Android, phone only ── */}
            <Section id="android-phone" icon="📱" title="An Android phone — no PC needed (TowerForge Link for Android)"
                lead={<>Android hides the game’s folder from every other app and from the browser. Two free apps get around
                    that on the phone itself: <strong>Shizuku</strong> lends apps the access a computer would have, and
                    <strong> TowerForge Link for Android</strong> uses it to hand the export to towerforge.net in your browser.</>}>
                <Need items={[
                    'An Android 11 or newer phone with The Tower.',
                    'Wi-Fi (Wireless debugging only works on Wi-Fi — not mobile data).',
                    'About 10 minutes, once.',
                ]} />

                <Part title="Part 1 — Turn on Developer options (once)">
                    <p>Developer options are a hidden settings page. Unlock it by tapping the build number 7 times:</p>
                    <ul className="igd-list">
                        <li><strong>Google Pixel and most phones:</strong> Settings → <strong>About phone</strong> → tap <strong>Build number</strong> 7 times.</li>
                        <li><strong>Samsung:</strong> Settings → <strong>About phone</strong> → <strong>Software information</strong> → tap <strong>Build number</strong> 7 times.</li>
                        <li><strong>Xiaomi, Redmi, POCO:</strong> Settings → <strong>About phone</strong> → tap <strong>OS version</strong> (or <strong>MIUI version</strong>) 7 times.</li>
                        <li><strong>OnePlus, OPPO, Realme:</strong> Settings → <strong>About device</strong> → <strong>Version</strong> → tap <strong>Build number</strong> 7 times.</li>
                    </ul>
                    <p>Enter your PIN if asked. The phone says <Says>You are now a developer!</Says></p>
                    <p>
                        Where Developer options are afterwards — Pixel: Settings → <strong>System</strong> → <strong>Developer
                        options</strong>; Samsung: at the very bottom of Settings; Xiaomi: Settings → <strong>Additional
                        settings</strong>; OnePlus/OPPO: Settings → <strong>System settings</strong>.
                    </p>
                </Part>

                <Part title="Part 2 — Install and start Shizuku (once)">
                    <a className="btn btn-accent igd-dl" href={SHIZUKU_PLAY} target="_blank" rel="noopener noreferrer">Shizuku on Google Play</a>
                    <Steps>
                        <li>Install <strong>Shizuku</strong> from Google Play (by <em>Xingchen &amp; Rikka</em>) and open it.</li>
                        <li>Connect to Wi-Fi. In Shizuku, under <strong>Start via Wireless debugging</strong>, tap <strong>Pairing</strong>. If it asks to send notifications, allow it — the pairing happens in a notification.</li>
                        <li>
                            Open <strong>Settings → Developer options → Wireless debugging</strong> and turn it <strong>on</strong>
                            (tap <strong>Allow</strong> on <Says>Allow wireless debugging on this network?</Says>). Then tap
                            <strong> Pair device with pairing code</strong>: a 6-digit <strong>Wi-Fi pairing code</strong> appears.
                        </li>
                        <li>
                            Without closing that screen, pull down the notifications. In Shizuku’s notification tap <strong>Enter
                            pairing code</strong>, type the 6 digits and send. Shizuku says the pairing worked.
                        </li>
                        <li>Go back to Shizuku and tap <strong>Start</strong>. After a few seconds the top of Shizuku says it’s <strong>running</strong>.</li>
                    </Steps>
                    <Box kind="tip">
                        If the code screen closes when you pull down the notifications, open Settings and Shizuku side by side
                        (split screen) and try again. Shizuku’s own guide, with pictures:{' '}
                        <a href={SHIZUKU_GUIDE} target="_blank" rel="noopener noreferrer">shizuku.rikka.app/guide/setup</a>.
                    </Box>
                </Part>

                <Part title="Part 3 — Install TowerForge Link for Android (once)">
                    <Download href={LINK_DOWNLOAD_ANDROID} label="Download TowerForge Link for Android" event="Link download (Android, guide)" />
                    <Steps>
                        <li>
                            On the phone, tap the button above (this page works on the phone). The file is
                            <code> TowerForgeLink.apk</code>, well under 1 MB. If Chrome says the file might be harmful, tap
                            <strong> Download anyway</strong>.
                        </li>
                        <li>
                            Tap the finished download (<strong>Open</strong>). Android says <Says>For your security, your phone
                            currently isn’t allowed to install unknown apps from this source</Says>: tap <strong>Settings</strong>,
                            turn on <strong>Allow from this source</strong>, go back, and tap <strong>Install</strong>.
                        </li>
                        <li>
                            Google Play Protect may say it doesn’t know the app (<Says>Unsafe app blocked</Says> or <Says>App scan
                            recommended</Says>): tap <strong>More details</strong> → <strong>Install anyway</strong>.
                        </li>
                        <li>Tap <strong>Open</strong>.</li>
                    </Steps>
                    <Box kind="why">
                        TowerForge Link for Android isn’t on Google Play yet, so Android treats it like any app from outside the
                        store. It only reads the game’s export file, only answers towerforge.net on this phone, and never
                        uploads anything — its code is public on <a href={SOURCE} target="_blank" rel="noopener noreferrer">GitHub</a>.
                    </Box>
                </Part>

                <Part title="Part 4 — The app’s five steps (once)">
                    <p>TowerForge Link shows a checklist; each step turns green when it’s done.</p>
                    <Steps>
                        <li><strong>Install Shizuku</strong> — already done in Part 2.</li>
                        <li><strong>Start Shizuku</strong> — already done in Part 2.</li>
                        <li><strong>Allow TowerForge Link in Shizuku</strong> — tap <strong>Allow</strong>. Shizuku asks <Says>Allow TowerForge Link to access Shizuku?</Says> — tap <strong>Allow all the time</strong>.</li>
                        <li>
                            <strong>Export your data in The Tower</strong> — tap <strong>Open The Tower</strong>, then Settings →
                            External Tools Export → <strong>Auto</strong>. Back in TowerForge Link it says
                            <Says>Found your export from …</Says>
                        </li>
                        <li>
                            <strong>Turn on TowerForge Link</strong> — tap <strong>Start Link</strong> (allow notifications if asked).
                            A notification <Says>TowerForge Link is on</Says> stays while it runs.
                        </li>
                    </Steps>
                    <p>Then tap <strong>Open towerforge.net</strong> at the bottom of the app: the site opens and brings your data in right away.</p>
                </Part>

                <Part title="Part 5 — Import on the site">
                    <Steps>
                        <li>
                            The site opens in your browser and reads your export straight away. The first time, the browser asks to let
                            towerforge.net <Says>access other apps and services on this device</Says> — tap <strong>Allow</strong>.
                        </li>
                        <li>
                            Later, <strong>Get from emulator or phone</strong> at the top reads it again, and <strong>⟳ Auto
                            import</strong> keeps up by itself. (Those buttons show on phones that opened the site from the app.)
                        </li>
                        <li>
                            Turn on <strong>⟳ Auto import</strong>: from then on, each time you switch from the game to the
                            browser, the site checks for a newer export and brings it in.
                        </li>
                    </Steps>
                </Part>

                <Box kind="again">
                    While you play, keep TowerForge Link on. <strong>After the phone restarts</strong> Shizuku and Link stop:
                    connect to Wi-Fi, open <strong>Shizuku → Start</strong> (turn Wireless debugging back on if it asks — no new
                    pairing), then open <strong>TowerForge Link → Start Link</strong>.
                </Box>
                <Box kind="tip">
                    If your phone stops Link in the background, give it unrestricted battery: Settings → Apps → TowerForge Link →
                    Battery → <strong>Unrestricted</strong> (the name differs a little by phone).
                </Box>
                <Box kind="tip">
                    Android 9 or 10? TowerForge Link for Android works there too, but Shizuku can only be started from a
                    computer on those versions — see <a href={SHIZUKU_GUIDE} target="_blank" rel="noopener noreferrer">Shizuku’s guide</a>,
                    or use <Go to="android-pc">Android + PC</Go>.
                </Box>
            </Section>

            {/* ── Android + PC ── */}
            <Section id="android-pc" icon="📶" title="An Android phone and a Windows PC (over Wi-Fi)"
                lead="TowerForge Link on your PC reads the phone over its Wireless debugging — no cable, no app on the phone. Great if you keep the site open on a computer while you play on the phone.">
                <Need items={[
                    'An Android 11 or newer phone with The Tower.',
                    'A Windows 10 or 11 PC with TowerForge Link (Part 1 of the emulator section).',
                    'The phone and the PC on the same Wi-Fi.',
                ]} />
                <Part title="Part 1 — TowerForge Link on the PC (once)">
                    <p>Exactly as in <Go to="emulator">the emulator section, Part 1</Go>: download it, click past Windows’ warning, leave its window open.</p>
                </Part>
                <Part title="Part 2 — Developer options and Wireless debugging on the phone (once)">
                    <Steps>
                        <li>Unlock Developer options — see <Go to="android-phone">Android phone, Part 1</Go>.</li>
                        <li>
                            Settings → Developer options → <strong>Wireless debugging</strong> → <strong>on</strong> →
                            <strong> Allow</strong> on <Says>Allow wireless debugging on this network?</Says>
                        </li>
                    </Steps>
                </Part>
                <Part title="Part 3 — Pair the phone with the PC (once)">
                    <Steps>
                        <li>On the PC, on towerforge.net, click the <strong>⚙</strong> next to <strong>Get from emulator or phone</strong> and open the <strong>📱 Android phone</strong> tab.</li>
                        <li>
                            Click <strong>Get Google’s adb</strong> (the first time only — about 8 MB, straight from Google). It says
                            <Says>✓ Ready</Says>.
                        </li>
                        <li>
                            On the phone, in Wireless debugging, tap <strong>Pair device with pairing code</strong>. It shows a
                            <strong> Wi-Fi pairing code</strong> (6 digits) and an <strong>IP address &amp; Port</strong> (like
                            <code>192.168.1.23:37415</code>).
                        </li>
                        <li>
                            On the PC, type both into the boxes and click <strong>Pair</strong>. Keep the phone’s pairing screen open
                            until the site says <Says>Paired and connected</Says>. The phone now lists the PC under <strong>Paired devices</strong>.
                        </li>
                    </Steps>
                </Part>
                <Part title="Part 4 — Import">
                    <Steps>
                        <li>In The Tower on the phone, export your data — <Go to="export">step 0</Go> (Auto is best).</li>
                        <li>On the PC, click <strong>Get from emulator or phone</strong> (allow the browser’s question the first time), or turn on <strong>⟳ Auto import</strong>.</li>
                    </Steps>
                </Part>
                <Box kind="again">
                    Wireless debugging switches itself off when the phone restarts or changes Wi-Fi. Turn it back on (Developer
                    options → Wireless debugging) — no new pairing — with TowerForge Link running on the PC.
                </Box>
                <Box kind="tip">
                    Not connecting by itself? Some routers hide devices from each other. In the ⚙ setup’s Android tab, type the
                    <strong> IP address &amp; Port</strong> shown at the top of the phone’s Wireless debugging screen (not the pairing
                    one) under <strong>Connect</strong>. Guest Wi-Fi networks usually block this completely.
                </Box>
                <Box kind="tip">
                    Turning Wireless debugging on gets quicker with a tile: Developer options → <strong>Quick settings developer
                    tiles</strong> → <strong>Wireless debugging</strong>.
                </Box>
            </Section>

            {/* ── Android by hand ── */}
            <Section id="android-file" icon="🗂" title="An Android phone, by hand"
                lead="If your phone’s file manager can open the game’s folder, you can copy the file yourself.">
                <Steps>
                    <li>Export in the game (<Go to="export">step 0</Go>).</li>
                    <li>In your file manager, open <code>Android → data → com.TechTreeGames.TheTower → files</code>.</li>
                    <li>Copy <code>tool_export.json</code> to <strong>Downloads</strong>.</li>
                    <li>On towerforge.net tap <strong>⬆ Import</strong> at the top → <strong>📄 Choose the file</strong>, and pick it from Downloads.</li>
                </Steps>
                <Box kind="warn">
                    Android 11 and newer block most file managers from that folder. If yours can’t open it, use
                    <Go to="android-phone"> TowerForge Link for Android</Go> instead — it was made for exactly that.
                </Box>
            </Section>

            {/* ── iPhone ── */}
            <Section id="iphone" icon="🍎" title="An iPhone (with a Windows PC)"
                lead="An iPhone keeps the game’s files to itself — no app, browser or Files app can open them. But a backup of the iPhone to a computer includes them, and TowerForge Link reads the export out of your newest backup.">
                <Need items={[
                    'A Windows 10 or 11 PC with TowerForge Link (Part 1 of the emulator section).',
                    'Apple’s free Apple Devices app (or iTunes).',
                    'The iPhone’s cable, for the first time.',
                ]} />
                <Part title="Part 1 — TowerForge Link on the PC (once)">
                    <p>As in <Go to="emulator">the emulator section, Part 1</Go>.</p>
                </Part>
                <Part title="Part 2 — Apple Devices (once)">
                    <Steps>
                        <li>On the PC, open the <strong>Microsoft Store</strong>, search for <strong>Apple Devices</strong> and click <strong>Get</strong>. (Already have iTunes? That works too.)</li>
                        <li>Plug in the iPhone and unlock it. On the iPhone tap <strong>Trust</strong> on <Says>Trust This Computer?</Says> and enter your passcode.</li>
                        <li>In Apple Devices, select your iPhone in the side bar, then <strong>General</strong>.</li>
                        <li>Under <strong>Backups</strong>, choose <strong>Back up all of the data on your iPhone to this computer</strong>.</li>
                        <li>
                            Make sure <strong>Encrypt local backup</strong> is <strong>off</strong> (if it’s on, untick it — it asks
                            for the backup password).
                        </li>
                    </Steps>
                    <Box kind="why">
                        TowerForge Link can’t read encrypted backups yet. An encrypted backup also keeps saved passwords, Wi-Fi
                        settings and Health data; an unencrypted one leaves those out and keeps the rest (apps, photos, messages)
                        on your PC. Your choice — TowerForge only ever opens the one game file.
                    </Box>
                </Part>
                <Part title="Part 3 — Back up and import">
                    <Steps>
                        <li>In The Tower on the iPhone, export your data — <Go to="export">step 0</Go>. Do this <em>before</em> backing up.</li>
                        <li>In Apple Devices click <strong>Back Up Now</strong> and wait until it finishes (the first backup can take 10 minutes or more; later ones only add what changed).</li>
                        <li>
                            On towerforge.net, on the same PC, click <strong>Get from emulator or phone</strong> (allow the browser’s
                            question the first time). It says <Says>Read from your iPhone backup from …</Says>
                        </li>
                    </Steps>
                </Part>
                <Part title="Part 4 — No cable (optional)">
                    <Steps>
                        <li>With the iPhone plugged in once: Apple Devices → <strong>General</strong> → tick <strong>Show this iPhone when on Wi-Fi</strong> → <strong>Apply</strong>.</li>
                        <li>From then on <strong>Back Up Now</strong> works over Wi-Fi when the PC and iPhone are on the same network.</li>
                    </Steps>
                    <p>
                        With iTunes instead: tick <strong>Sync with this iPhone over Wi-Fi</strong>. iTunes then backs up by itself
                        when it’s open, the iPhone is charging and both are on the same Wi-Fi — and with <strong>⟳ Auto import</strong>
                        on, each new backup comes into the site by itself.
                    </p>
                </Part>
                <Box kind="again">
                    Export in the game → <strong>Back Up Now</strong> → <strong>Get from emulator or phone</strong> (or let Auto import pick it up).
                </Box>
                <Box kind="tip">
                    The ⚙ setup’s <strong>🍎 iPhone</strong> tab lists the backups Link sees and whether each one has your export.
                </Box>
            </Section>

            {/* ── Mac ── */}
            <Section id="mac" icon="💻" title="A Mac"
                lead="TowerForge Link runs on Windows only for now, but a Mac can still get the file to the site.">
                <Part title="The Tower running on the Mac itself (Apple silicon)">
                    <Steps>
                        <li>In The Tower on the Mac, export your data — <Go to="export">step 0</Go>.</li>
                        <li>Open <strong>Terminal</strong> (press ⌘ Space, type “Terminal”, press Return).</li>
                        <li>
                            Paste this line and press Return — it copies the export to your Desktop:
                            <pre className="igd-code">cp &quot;$(find ~/Library/Containers -name tool_export.json 2&gt;/dev/null | head -1)&quot; ~/Desktop/</pre>
                        </li>
                        <li>On towerforge.net click <strong>⬆ Import Game Data</strong> → <strong>📄 Choose the file</strong>, and pick <code>tool_export.json</code> on your Desktop. (The ⬆ Import help on a Mac shows this Terminal line with a Copy button.)</li>
                    </Steps>
                </Part>
                <Part title="An iPhone with a Mac">
                    <Steps>
                        <li>Export in the game, then plug in the iPhone and open <strong>Finder</strong> → your iPhone → <strong>General</strong>.</li>
                        <li>Choose <strong>Back up all of the data on your iPhone to this Mac</strong>, leave <strong>Encrypt local backup</strong> off, and click <strong>Back Up Now</strong>.</li>
                        <li>
                            Open the backup with an iPhone backup viewer app and save
                            <code> Applications → com.TechTreeGames.TheTower → Documents → tool_export.json</code>, then use
                            <strong> ⬆ Import Game Data</strong>. (Or back up to a Windows PC and let TowerForge Link do it — <Go to="iphone">iPhone section</Go>.)
                        </li>
                    </Steps>
                </Part>
            </Section>

            {/* ── Troubleshooting ── */}
            <Section id="troubleshooting" icon="🛠" title="Something went wrong"
                lead="TowerForge Link always says what’s wrong in plain words. Find the message here:">
                <div className="igd-table-wrap">
                    <table className="igd-table">
                        <thead><tr><th>The site or Link says…</th><th>What to do</th></tr></thead>
                        <tbody>
                            <tr><td><Says>TowerForge Link isn’t running on this PC</Says></td><td>Open <code>TowerForgeLink.exe</code> and leave its window open (only one copy can run at a time): with the dialog still open, the site sees Link start and reads your export by itself. Have the file already? <strong>Skip Link: 📄 Choose the file</strong> in the same dialog.</td></tr>
                            <tr><td>The page can’t reach Link although it’s running</td><td>The browser was told not to let the site talk to apps on this device. Click the icon left of the address (🔒 or ⓘ) → <strong>Site settings</strong> → allow <strong>Local network access</strong> (or “apps on device”), then reload.</td></tr>
                            <tr><td><Says>No Android emulator found on this PC</Says></td><td>Install or start your emulator — or, for a phone, see <Go to="android-pc">Android + PC</Go> or <Go to="iphone">iPhone</Go>. Installed in another folder or drive? Get TowerForge Link 0.4.2 or newer: it finds emulators wherever they're installed, and its window lists each one it found with its folder.</td></tr>
                            <tr><td><Says>Your emulator isn’t running</Says> / <Says>… is running but didn’t answer</Says></td><td>Start the emulator and wait until its home screen shows, then try again.</td></tr>
                            <tr><td><Says>BlueStacks is blocking the connection</Says></td><td>BlueStacks → Settings → Advanced → <strong>Android Debug Bridge (ADB)</strong> on → Save, then close BlueStacks fully and reopen it.</td></tr>
                            <tr><td><Says>BlueStacks has Android Debug Bridge turned on but hasn’t applied it yet</Says></td><td>Wait a minute, or close BlueStacks fully and open it again.</td></tr>
                            <tr><td><Says>The emulator refused the connection</Says></td><td>Turn on ADB in the emulator’s settings and restart it (<Go to="emulator">Part 2</Go>).</td></tr>
                            <tr><td><Says>MuMu Player is running but isn’t letting TowerForge Link connect</Says></td><td>Get TowerForge Link 0.4.1 or newer (it reads MuMu without ADB). Still there? MuMu → Settings → Developer options → <strong>ADB debug</strong> → Enable local connection, then close MuMu fully and reopen it. Just started? Wait a minute and try again.</td></tr>
                            <tr><td>It reads the wrong emulator (BlueStacks instead of MuMu…)</td><td>Get TowerForge Link 0.4 or newer: with more than one, it asks <Says>Import from…</Says>. An emulator listed but greyed out says why it can’t be read.</td></tr>
                            <tr><td><Says>The emulator or phone you picked isn’t answering</Says></td><td>Start it (or reconnect the phone), then try again — or click <strong>Get from emulator or phone</strong> and pick another.</td></tr>
                            <tr><td><Says>… has no data export yet</Says> / <Says>The Tower hasn’t exported your data yet</Says></td><td>In the game: Settings → External Tools Export → export, or turn on Auto (<Go to="export">step 0</Go>).</td></tr>
                            <tr><td><Says>The Tower isn’t installed on …, or hasn’t been opened yet</Says></td><td>Open The Tower once on that device, then export.</td></tr>
                            <tr><td><Says>Your phone isn’t connected</Says></td><td>On the phone, turn Wireless debugging back on (it turns off after a restart or a Wi-Fi change), same Wi-Fi as the PC. Still nothing? Use <strong>Connect</strong> in the ⚙ setup (<Go to="android-pc">tip</Go>).</td></tr>
                            <tr><td><Says>The phone said the code was wrong</Says></td><td>Codes are single-use: tap <strong>Pair device with pairing code</strong> again and type the new code.</td></tr>
                            <tr><td><Says>Couldn’t reach the phone to pair</Says></td><td>Same Wi-Fi as the PC? Pairing screen still open? Typed the address and port exactly (numbers, a colon, then the port)?</td></tr>
                            <tr><td><Says>Phones need Google’s adb first</Says></td><td>Click <strong>Get Google’s adb</strong> in the ⚙ setup’s Android tab.</td></tr>
                            <tr><td><Says>This TowerForge Link … can’t reach phones</Says></td><td>Download the new TowerForge Link, close the old window, run the new one.</td></tr>
                            <tr><td><Says>Your phone is asking whether to allow USB debugging</Says></td><td>Tap <strong>Allow</strong> on the phone (tick “Always allow from this computer”).</td></tr>
                            <tr><td><Says>Your iPhone backup is encrypted</Says></td><td>Apple Devices → General → untick <strong>Encrypt local backup</strong>, then <strong>Back Up Now</strong> (<Go to="iphone">why</Go>).</td></tr>
                            <tr><td><Says>Your newest iPhone backup doesn’t have the game’s data export</Says></td><td>Export in the game first, then back up again.</td></tr>
                            <tr><td><Says>Shizuku isn’t running</Says></td><td>It stops when the phone restarts: Wi-Fi on → open Shizuku → <strong>Start</strong>.</td></tr>
                            <tr><td><Says>TowerForge Link isn’t allowed to use Shizuku yet</Says></td><td>Open TowerForge Link and tap <strong>Allow</strong> (step 3).</td></tr>
                            <tr><td><Says>Shizuku isn’t installed</Says></td><td>Install Shizuku from Google Play (<Go to="android-phone">Part 2</Go>).</td></tr>
                            <tr><td>On a phone, the <strong>Get from emulator or phone</strong> button isn’t there</td><td>Open the site with <strong>Open towerforge.net</strong> in TowerForge Link once — that tells the site this phone has Link.</td></tr>
                            <tr><td><Says>Import failed — this isn’t a game data export or a TowerForge backup</Says></td><td>Pick <code>tool_export.json</code> itself (not <code>playerInfo.dat</code>, which is the game’s save, not the export).</td></tr>
                            <tr><td><strong>⟳ Auto import</strong> is gold</td><td>Something’s in the way — point at (or long-press) the button to read why; usually Link isn’t running.</td></tr>
                            <tr><td>The site shows old numbers</td><td>The game only writes the export when you export (or on each save with Auto). Export again, then import.</td></tr>
                        </tbody>
                    </table>
                </div>
                <p>Still stuck? Ask in our Discord (the blue button at the top) — tell us your device and the exact message.</p>
            </Section>

            {/* ── FAQ ── */}
            <Section id="faq" icon="❓" title="Questions">
                <Part title="Is it safe?">
                    <p>
                        TowerForge Link (Windows and Android) reads exactly one file — the export the game writes for tools — and
                        never changes anything on your device or in the game. It only answers towerforge.net on the same device,
                        nothing on your network or the internet can reach it, and it uploads nothing. Its code is public on
                        <a href={SOURCE} target="_blank" rel="noopener noreferrer"> GitHub</a>.
                    </p>
                </Part>
                <Part title="Where does my data go?">
                    <p>
                        What you import stays in this browser. It only goes to TowerForge&apos;s server if you make an account
                        (Player → Account), so your stats follow you to other devices, or a share link (Player → Share), which
                        shows only what you pick. The site also counts visits, without cookies.
                        The <a href={TAB_PATHS.privacy}>Privacy</a> page has the details.
                    </p>
                </Part>
                <Part title="Why does Android need Shizuku?">
                    <p>
                        Since Android 11, apps can’t open other apps’ folders — not even file managers. Shizuku is a widely used,
                        free, open-source tool that lends apps you allow the same access a computer gets over USB. TowerForge Link
                        uses it for one thing: reading the game’s export. You can stop Shizuku at any time.
                    </p>
                </Part>
                <Part title="How do I remove everything?">
                    <ul className="igd-list">
                        <li><strong>Windows:</strong> close TowerForge Link and delete <code>TowerForgeLink.exe</code>; to remove Google’s adb and paired phones too, delete the folder <code>%LOCALAPPDATA%\TowerForgeLink</code>.</li>
                        <li><strong>Android:</strong> uninstall TowerForge Link and Shizuku, then turn off Wireless debugging (and Developer options, at the top of that page).</li>
                        <li><strong>iPhone:</strong> in Apple Devices, General → <strong>Manage Backups</strong> deletes old backups.</li>
                        <li><strong>The site:</strong> clear your browser’s site data for towerforge.net; with an account, Player → Account → <strong>Delete account</strong> first.</li>
                    </ul>
                </Part>
                <Part title="Can I do it without any of this?">
                    <p>Yes — every tab can be filled in by hand. Importing just saves you the typing and keeps it exact.</p>
                </Part>
            </Section>
        </div>
    );
}
