// ============================================================
//  TowerForge Companion — TowerForge Link setup
//  Opened from "Get from emulator or phone" (its ⚙, or when the
//  helper isn't running or reports a problem): getting the helper
//  past Windows' warning, then an emulator's one-time ADB setting, an
//  Android phone over Wi-Fi (Google's adb, pairing with the code on
//  the phone's Wireless debugging screen), or an iPhone backed up to
//  the PC, which Link reads the export out of (engine/linkClient.ts;
//  Link 0.3+). On a phone it's TowerForge Link for Android instead:
//  Shizuku, the app, and what the app reports (Shizuku, the export).
//  Every step links to the full guide (the Import Guide tab).
//  Checks what Link found every few seconds while open.
// ============================================================

import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { forgetPhoneLink, LINK_DOWNLOAD, LINK_DOWNLOAD_ANDROID, linkPhone, linkStatus } from '../engine/linkClient';
import { TAB_PATHS } from '../routes';
import { openGuide } from '../guideNav';
import type { LinkAction, LinkStatus } from '../engine/linkClient';
import { trackEvent } from '../analytics';

const SOURCE = 'https://github.com/mannypein/TowerForge/tree/main/TowerForge.Link';
const SHIZUKU = 'https://play.google.com/store/apps/details?id=moe.shizuku.privileged.api';
// Google offers Platform-Tools under its Android SDK License Agreement,
// which its own download page has people accept first.
const ANDROID_SDK_TERMS = 'https://developer.android.com/studio/terms';
const GUIDE = TAB_PATHS.importguide;
const POLL_MS = 4000;

interface Props {
    problem: string | null;     // the helper's own message, when it answered
    busy: boolean;
    onRetry: () => void;
    onClose: () => void;
}

type Where = 'emulator' | 'phone' | 'iphone';

const when = (unix: number) => new Date(unix * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
type Note = { ok: boolean; text: string } | null;

// Link answered, but too old for phones (0.2 and before have no `phone`).
const oldLink = (s: LinkStatus | null | undefined) => !!s && !s.phone && s.platform !== 'android';

// A phone or tablet: the Android app's steps instead of the PC's (unless
// it's a touchscreen PC whose TowerForge Link answered).
const touchDevice = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

const SHIZUKU_SAYS: Record<NonNullable<LinkStatus['android']>['shizuku'], string> = {
    ready: 'Shizuku is running and TowerForge Link may use it.',
    not_installed: 'Shizuku isn’t installed — open TowerForge Link and follow step 1.',
    not_running: 'Shizuku isn’t running (it stops when the phone restarts) — open Shizuku and tap Start.',
    no_permission: 'TowerForge Link isn’t allowed in Shizuku yet — open TowerForge Link and tap Allow.',
};

// A plain click opens the Import Guide here, at that part; a modified one, a new tab.
function GuideLink({ part, onClose, children }: { part: string; onClose: () => void; children: ReactNode }) {
    return (
        <a href={`${GUIDE}#${part}`} onClick={e => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onClose();
            openGuide(part);
        }}>{children}</a>
    );
}

export default function LinkModal({ problem, busy, onRetry, onClose }: Props) {
    // undefined: not asked yet · null: Link isn't running.
    const [status, setStatus] = useState<LinkStatus | null | undefined>(undefined);
    const [where, setWhere] = useState<Where | null>(null);
    const [working, setWorking] = useState<string | null>(null);
    const [note, setNote] = useState<Note>(null);
    const [pairAddress, setPairAddress] = useState('');
    const [pairCode, setPairCode] = useState('');
    const [connectAddress, setConnectAddress] = useState('');

    useEffect(() => {
        let stop = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tick = async () => {
            const s = await linkStatus();
            if (stop) return;
            setStatus(s);
            timer = setTimeout(() => void tick(), POLL_MS);
        };
        void tick();
        return () => { stop = true; clearTimeout(timer); };
    }, []);

    // Esc closes.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // A paired phone or an iPhone backup opens on its own steps.
    const shown: Where = where ?? ((status?.phone?.paired ?? 0) > 0 ? 'phone'
        : (status?.iphoneBackups?.length ?? 0) > 0 && !status?.emulators.some(e => e.running) ? 'iphone' : 'emulator');
    const running = !!status;
    const phone = status?.phone;
    const backups = status?.iphoneBackups ?? [];
    const onPhone = !(status && status.platform !== 'android') && touchDevice();
    const app = status?.platform === 'android' ? status.android : undefined;

    const act = async (label: string, action: Parameters<typeof linkPhone>[0], params?: Record<string, string>) => {
        setWorking(label);
        setNote(null);
        const r: LinkAction = await linkPhone(action, params);
        setWorking(null);
        trackEvent(r.ok ? `Link phone: ${action}` : `Link phone: ${action} failed`);
        setNote(r.ok ? { ok: true, text: r.message }
            : r.reason === 'unreachable' ? { ok: false, text: 'TowerForge Link isn’t running on this PC — start it, then try again.' }
            : { ok: false, text: r.message });
        setStatus(await linkStatus());
        return r.ok;
    };

    const pair = async (e: FormEvent) => {
        e.preventDefault();
        if (await act('pair', 'pair', { address: pairAddress.trim(), code: pairCode.trim() })) setPairCode('');
    };
    const connect = async (e: FormEvent) => {
        e.preventDefault();
        await act('connect', 'connect', { address: connectAddress.trim() });
    };

    return (
        <div className="lnk-overlay" role="dialog" aria-modal="true" aria-labelledby="lnk-title" onClick={onClose}>
            <div className="lnk-modal" onClick={e => e.stopPropagation()}>
                <div className="lnk-head">
                    <h2 id="lnk-title">Get your data with TowerForge Link</h2>
                    <button className="lnk-close" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className="lnk-body">
                    {problem && <p className="lnk-problem">{problem}</p>}
                    <p className="lnk-lead">
                        {onPhone
                            ? <>TowerForge Link for Android brings the game&apos;s data export into this page on this phone — no
                                hunting for the file. It needs two free apps, set up once.</>
                            : <>TowerForge Link is a small Windows program that copies the game&apos;s data export from an emulator
                                on this PC — or an Android phone on the same Wi-Fi, or an iPhone backup — straight into this page.
                                No hunting for the file.</>}
                    </p>
                    <p className="lnk-sub lnk-first">
                        <GuideLink onClose={onClose} part={onPhone ? 'android-phone' : 'emulator'}>📖 The full step-by-step guide</GuideLink>
                        {' '}shows every screen and what to do when something goes wrong.
                    </p>

                    <div className={`lnk-status ${running ? 'on' : ''}`} role="status">
                        {status === undefined ? `Looking for TowerForge Link on this ${onPhone ? 'phone' : 'PC'}…`
                            : !status ? `TowerForge Link isn’t running on this ${onPhone ? 'phone' : 'PC'} yet — set it up below.`
                            : app ? <>
                                TowerForge Link for Android {status.version} is running · {SHIZUKU_SAYS[app.shizuku]}
                                {app.export === 'found' && app.exportModified ? ` Your export is from ${when(app.exportModified)}.` : ''}
                                {app.export === 'none' ? ' The game hasn’t exported yet: Settings → External Tools Export.' : ''}
                                {app.export === 'no_game' ? ' The Tower isn’t on this phone, or hasn’t been opened yet.' : ''}
                            </>
                            : <>
                                TowerForge Link {status.version} is running
                                {status.emulators.length > 0 && <> · found {status.emulators.map(e => `${e.name}${e.running ? ' (running)' : ''}`).join(', ')}</>}
                                {phone && phone.paired > 0 && <> · phone {phone.connected.length ? `connected: ${phone.connected.join(', ')}` : 'paired, not connected'}</>}
                                {backups.length > 0 && <> · iPhone backup{backups[0].backedUp ? ` from ${when(backups[0].backedUp)}` : ''}</>}
                            </>}
                    </div>

                    {onPhone ? (
                        <section className="lnk-sec">
                            {!app && <>
                                <h3>Set up TowerForge Link for Android (once)</h3>
                                <ol className="lnk-steps">
                                    <li>
                                        <strong>Install Shizuku</strong> (free) and start it with <em>Start via Wireless debugging</em>.
                                        <a className="btn btn-accent lnk-block" href={SHIZUKU} target="_blank" rel="noopener noreferrer">Shizuku on Google Play</a>
                                        <span className="lnk-sub">
                                            Shizuku lends TowerForge Link the access a computer would have — Android hides the
                                            game&apos;s export from other apps. Starting it the first time takes a pairing code;
                                            the <GuideLink onClose={onClose} part="android-phone">guide</GuideLink> shows every screen.
                                        </span>
                                    </li>
                                    <li>
                                        <strong>Install TowerForge Link for Android:</strong>
                                        <a className="btn btn-gold lnk-block" href={LINK_DOWNLOAD_ANDROID} download onClick={() => trackEvent('Link download (Android)')}>
                                            ⬇ Download the app
                                        </a>
                                        <span className="lnk-sub">
                                            Open the downloaded file and tap <em>Install</em>. Android asks to let your browser install
                                            apps the first time (Settings → <em>Allow from this source</em>), and Google Play Protect may
                                            say it doesn&apos;t know the app: tap <em>More details → Install anyway</em>.
                                        </span>
                                    </li>
                                    <li>
                                        <strong>Open TowerForge Link</strong> and do its five steps; then tap <em>Open towerforge.net</em> in it.
                                    </li>
                                </ol>
                            </>}
                            {app && app.shizuku === 'ready' && app.export === 'found' && (
                                <p className="lnk-done">All set — tap <em>Try again</em>, or turn on <em>⟳ Auto import</em>.</p>
                            )}
                            <p className="lnk-sub">
                                <strong>iPhone:</strong> iOS keeps the game&apos;s files to itself, so an iPhone needs a Windows PC: back
                                it up there and TowerForge Link reads the export from the backup (<GuideLink onClose={onClose} part="iphone">guide</GuideLink>).
                            </p>
                            <button className="lnk-forget" onClick={() => { forgetPhoneLink(); onClose(); }}>
                                Don&apos;t show the Link buttons on this phone
                            </button>
                        </section>
                    ) : !running && (
                        <section className="lnk-sec">
                            <h3>Set up TowerForge Link (once)</h3>
                            <ol className="lnk-steps">
                                <li>
                                    <a className="btn btn-gold" href={LINK_DOWNLOAD} download onClick={() => trackEvent('Link download')}>
                                        ⬇ Download TowerForge Link
                                    </a>
                                    <span className="lnk-sub">Windows 10 or 11, 12 MB, nothing to install.</span>
                                </li>
                                <li>
                                    Run it. Windows will probably say <em>“Windows protected your PC”</em>: click <em>More info</em>,
                                    then <em>Run anyway</em>.
                                    <span className="lnk-sub">
                                        Windows shows that for programs without a paid publisher certificate, which Link doesn&apos;t
                                        have yet. Link only reads the game&apos;s export file, and its code is public:{' '}
                                        <a href={SOURCE} target="_blank" rel="noopener noreferrer">see it on GitHub</a>. If your browser
                                        says the download is uncommon, choose <em>Keep</em>.
                                    </span>
                                </li>
                                <li>Leave its window open while you use the site (you can minimize it).</li>
                                <li>
                                    The first time, your browser asks to let towerforge.net talk to apps on this device —
                                    click <em>Allow</em>.
                                </li>
                            </ol>
                        </section>
                    )}
                    {oldLink(status) && (
                        <p className="lnk-problem">
                            This TowerForge Link ({status!.version}) can&apos;t reach phones.{' '}
                            <a href={LINK_DOWNLOAD} download>Download the new one</a>, close the old window and run the new one.
                        </p>
                    )}

                    {!onPhone && <div className="lnk-tabs" role="tablist">
                        <button role="tab" aria-selected={shown === 'emulator'} className={`lnk-tab ${shown === 'emulator' ? 'on' : ''}`} onClick={() => setWhere('emulator')}>
                            🖥 Emulator on this PC
                        </button>
                        <button role="tab" aria-selected={shown === 'phone'} className={`lnk-tab ${shown === 'phone' ? 'on' : ''}`} onClick={() => setWhere('phone')}>
                            📱 Android phone
                        </button>
                        <button role="tab" aria-selected={shown === 'iphone'} className={`lnk-tab ${shown === 'iphone' ? 'on' : ''}`} onClick={() => setWhere('iphone')}>
                             🍎 iPhone
                        </button>
                    </div>}

                    {onPhone ? null : shown === 'iphone' ? (
                        <section className="lnk-sec">
                            <p className="lnk-sub lnk-first">
                                iOS keeps the game&apos;s files to itself — no app or browser on the iPhone can open them — but
                                a backup of the iPhone to this PC includes them. Link reads the export out of your newest backup.
                            </p>
                            <ol className="lnk-steps">
                                <li>
                                    Install Apple&apos;s <strong>Apple Devices</strong> app (Microsoft Store, Windows 10 or 11), or iTunes.
                                </li>
                                <li>Connect the iPhone with a cable, unlock it and tap <em>Trust</em>.</li>
                                <li>In The Tower: Settings → External Tools Export, and export (or choose <em>Auto</em>).</li>
                                <li>
                                    In Apple Devices: <em>Back up all of the data on your iPhone to this computer</em> → <em>Back Up Now</em>.
                                    <span className="lnk-sub">
                                        Leave <em>Encrypt local backup</em> off — Link can&apos;t read encrypted backups yet (an
                                        encrypted backup also keeps saved passwords and Health data; an unencrypted one leaves them
                                        out). The first backup takes a while; later ones only add what changed.
                                    </span>
                                </li>
                                <li>
                                    Click <em>Try again</em>. With <em>⟳ Auto import</em> on, every new backup comes in by itself.
                                    <span className="lnk-sub">
                                        Tick <em>Show this iPhone when on Wi-Fi</em> (General) once, and you can back up without the cable.
                                    </span>
                                </li>
                            </ol>
                            {backups.length > 0 && (
                                <ul className="lnk-backups">
                                    {backups.map((b, i) => (
                                        <li key={i}>
                                            Backup{b.backedUp ? ` from ${when(b.backedUp)}` : ''}:{' '}
                                            {b.encrypted ? <span className="lnk-warn">encrypted — can&apos;t be read yet</span>
                                                : b.hasExport ? <span className="lnk-ok">✓ has your export{b.exportModified ? ` (${when(b.exportModified)})` : ''}</span>
                                                : <span className="lnk-warn">no export in it — export in the game, then back up again</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="lnk-sub">
                                <strong>On a Mac:</strong> Link is Windows-only for now. If you play The Tower on the Mac itself,
                                its export is in your Library: in Terminal, run{' '}
                                <code>cp &quot;$(find ~/Library/Containers -name tool_export.json 2&gt;/dev/null | head -1)&quot; ~/Desktop/</code>{' '}
                                to copy it to your Desktop, then use Import Game Data.
                            </p>
                        </section>
                    ) : shown === 'emulator' ? (
                        <section className="lnk-sec">
                            <ol className="lnk-steps">
                                <li>
                                    <strong>BlueStacks:</strong> Settings → Advanced → turn on <em>Android Debug Bridge (ADB)</em>,
                                    then close BlueStacks and open it again (once).
                                    <span className="lnk-sub">
                                        MuMu, LDPlayer, MEmu or Nox: turn on ADB in their settings (sometimes called “local
                                        connection” or “ADB debugging”), then restart them once.
                                    </span>
                                </li>
                                <li>In The Tower: Settings → External Tools Export, and export (or choose <em>Auto</em>).</li>
                                <li>Click <em>Try again</em> below. With <em>⟳ Auto import</em> on, the site then keeps up by itself.</li>
                            </ol>
                        </section>
                    ) : (
                        <section className="lnk-sec">
                            <p className="lnk-sub lnk-first">
                                For Android 11 or newer, with the phone and this PC on the same Wi-Fi. Link reads the export over
                                the phone&apos;s Wireless debugging — the same way it reads an emulator. <strong>No PC while you
                                play?</strong> TowerForge Link for Android does it on the phone itself:{' '}
                                <GuideLink onClose={onClose} part="android-phone">see the guide</GuideLink>.
                            </p>
                            <ol className="lnk-steps">
                                <li>
                                    <strong>Turn on Developer options</strong> (once): Settings → About phone → tap <em>Build number</em> 7 times.
                                    <span className="lnk-sub">Samsung: About phone → Software information → Build number.</span>
                                </li>
                                <li>
                                    <strong>Turn on Wireless debugging:</strong> Settings → Developer options → Wireless debugging → On
                                    (allow it on this Wi-Fi).
                                </li>
                                <li>
                                    <strong>Google&apos;s adb</strong> (once): Link needs Google&apos;s own adb to reach phones.
                                    {phone?.adbReady ? (
                                        <span className="lnk-ok"> ✓ Ready (adb {phone.adbVersion}).</span>
                                    ) : (
                                        <>
                                            <button className="btn btn-accent lnk-inline" disabled={!running || oldLink(status) || !!working}
                                                onClick={() => void act('adb', 'adb')}>
                                                {working === 'adb' ? '⏳ Downloading…' : '⬇ Get Google’s adb'}
                                            </button>
                                            <span className="lnk-sub">
                                                About 8 MB, straight from Google (Android SDK Platform-Tools), kept in Link&apos;s folder.
                                                Getting it means you accept <a href={ANDROID_SDK_TERMS} target="_blank" rel="noopener noreferrer">Google&apos;s terms for it</a>.
                                            </span>
                                        </>
                                    )}
                                </li>
                                <li>
                                    <strong>Pair</strong> (once): on the phone, tap <em>Pair device with pairing code</em> and type what it shows:
                                    <form className="lnk-form" onSubmit={e => void pair(e)}>
                                        <label className="lnk-field">
                                            <span>IP address &amp; port</span>
                                            <input type="text" inputMode="decimal" placeholder="192.168.1.23:37415" value={pairAddress}
                                                onChange={e => setPairAddress(e.target.value)} autoComplete="off" spellCheck={false} />
                                        </label>
                                        <label className="lnk-field lnk-code">
                                            <span>Wi-Fi pairing code</span>
                                            <input type="text" inputMode="numeric" placeholder="123456" maxLength={6} value={pairCode}
                                                onChange={e => setPairCode(e.target.value.replace(/\D/g, ''))} autoComplete="off" />
                                        </label>
                                        <button className="btn btn-accent" type="submit"
                                            disabled={!phone?.adbReady || !!working || !pairAddress.trim() || pairCode.length !== 6}>
                                            {working === 'pair' ? '⏳ Pairing…' : 'Pair'}
                                        </button>
                                    </form>
                                </li>
                                <li>
                                    <strong>Export:</strong> in The Tower, Settings → External Tools Export → <em>Auto</em>, and turn on
                                    <em> ⟳ Auto import</em> here — the site reads your phone every 30 seconds while you play.
                                    <span className="lnk-sub">
                                        Wireless debugging switches itself off when the phone restarts or changes Wi-Fi: switch it
                                        back on — no need to pair again.
                                    </span>
                                </li>
                            </ol>
                            {phone && phone.paired > 0 && phone.connected.length === 0 && (
                                <form className="lnk-form lnk-connect" onSubmit={e => void connect(e)}>
                                    <span className="lnk-sub lnk-first">
                                        Paired but not connected? With Wireless debugging on, type the <em>IP address &amp; port</em> at
                                        the top of its screen (not the pairing one):
                                    </span>
                                    <label className="lnk-field">
                                        <span>IP address &amp; port</span>
                                        <input type="text" inputMode="decimal" placeholder="192.168.1.23:41235" value={connectAddress}
                                            onChange={e => setConnectAddress(e.target.value)} autoComplete="off" spellCheck={false} />
                                    </label>
                                    <button className="btn btn-accent" type="submit" disabled={!!working || !connectAddress.trim()}>
                                        {working === 'connect' ? '⏳ Connecting…' : 'Connect'}
                                    </button>
                                </form>
                            )}
                            {phone && phone.paired > 0 && (
                                <button className="lnk-forget" onClick={() => void act('forget', 'forget')} disabled={!!working}>
                                    Forget paired phones
                                </button>
                            )}
                        </section>
                    )}

                    {note && <p className={note.ok ? 'lnk-done' : 'lnk-problem'} role="status">{note.text}</p>}

                    <p className="lnk-sub">
                        Your data goes from your emulator or phone to this page only; nothing is uploaded. Link only answers
                        towerforge.net, and only ever reads that one file.
                    </p>
                    <div className="lnk-actions">
                        <button className="btn btn-accent" onClick={onRetry} disabled={busy}>
                            {busy ? '⏳ Getting your data…' : '↻ Try again'}
                        </button>
                        <button className="btn btn-dim" onClick={onClose}>Close</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
