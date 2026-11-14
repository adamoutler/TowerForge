// ============================================================
//  TowerForge Companion — Privacy page (/privacy)
//  What the site keeps about a player, where, for how long, and how
//  to get it or remove it, in plain words. Written 2026-11-08 from the
//  code and the server (docs/privacy.md has what was checked and the
//  laws it answers: GDPR / UK GDPR, CalOPPA and the US state laws,
//  COPPA). When the site starts keeping or sending something new,
//  change this page and its date in the same commit.
// ============================================================

import { DISCORD_URL } from '../../constants/community';
import { TAB_PATHS } from '../../routes';
import { downloadBackup } from '../common/downloadBackup';

export const PRIVACY_UPDATED = 'November 14, 2026';

export default function PrivacyTab() {
    return (
        <article className="lgl-page">
            <h2>Privacy</h2>
            <p className="lgl-date">Last updated {PRIVACY_UPDATED}</p>
            <p>
                TowerForge is a free, fan-made companion site for The Tower, run by one player. This page says what
                TowerForge keeps about you, where it&apos;s kept, for how long, and how to get it or remove it.
            </p>

            <div className="lgl-short">
                <h3>The short version</h3>
                <ul>
                    <li>What you enter or import stays in your browser, unless you make an account, make a share link, send an Ask AI answer or turn on reminders.</li>
                    <li>No ads. TowerForge never sells or shares your data, and sets no tracking cookies.</li>
                    <li>A normal visit loads nothing from other companies: the site, its fonts and its visitor counter all come from towerforge.net.</li>
                    <li>Visits are counted without cookies, and IP addresses aren&apos;t kept with the counts.</li>
                    <li>You can download your data and delete your account at any time.</li>
                </ul>
            </div>

            <h3>In your browser</h3>
            <p>
                Everything you enter or import — your game progress from the export (including your in-game player
                name if the export has one), runs, presets, modules, settings and theme — is kept in your
                browser&apos;s storage on this device. It isn&apos;t sent to TowerForge unless you do one of the things
                below. Ask AI&apos;s download, chat log and 👍/👎 are kept in your browser too
                (<a href={`${TAB_PATHS.ai}#how-it-works`}>how Ask AI works</a>).
            </p>
            <p>To remove it, clear your browser&apos;s site data for towerforge.net.</p>

            <h3>If you make an account</h3>
            <p>An account saves your stats on TowerForge&apos;s server so they follow you to other devices. It keeps:</p>
            <ul>
                <li>your username and the date the account was made;</li>
                <li>your password and recovery code, scrambled (hashed) so they can&apos;t be read — not even by TowerForge;</li>
                <li>a copy of your stats (everything listed under &quot;In your browser&quot; except Ask AI);</li>
                <li>the share links you made while signed in.</li>
            </ul>
            <p>
                Accounts have no email address. Signing in sets one cookie, <code>tf_session</code>, that keeps you
                signed in for 30 days (renewed while you use the site). It&apos;s the only cookie TowerForge sets, and
                it does nothing else.
            </p>
            <p>
                The account is kept until you delete it: <a href={TAB_PATHS.account}>Player → Account → Delete
                account</a> deletes it with everything tied to it — your stats, recovery code, share links and any Ask
                AI answers you sent.
            </p>

            <h3>Share links</h3>
            <p>
                A share link sends the parts of your stats you pick (Player → Share) to TowerForge&apos;s server, and
                anyone with the link can see them. It never includes your username or your in-game player name.
                Share links are deleted after 90 days. To delete one sooner: Player → Account → My Share Codes. A link
                made without an account joins your account if you make one on the same device; or ask on Discord.
            </p>
            <p>
                When a share link is posted on Discord, Reddit, X or elsewhere, that site fetches its preview from
                TowerForge: a picture and a line with the shared tier, best wave, league and build (only when you shared
                your Profile) and which parts you shared. Search engines are asked not to list share links.
            </p>
            <p>
                <strong>Compare with my tower</strong> on a share link puts your own stats next to the shared ones in your
                browser; nothing of yours is sent. The pictures you make (a moment, your week, your year, your trophy
                shelf, Me vs a friend) are drawn in your browser and only go where you save or share them.
            </p>

            <h3>Ask AI answers you send</h3>
            <p>
                Only when you press <strong>Send</strong> on an answer: the question, the answer, what TowerForge looked
                up for it (some of your stats), the model, your kind of graphics card, the site&apos;s version, how long
                it took and your note — with your username if you&apos;re signed in. Only the person who runs TowerForge reads them, to fix what went
                wrong. They&apos;re deleted after a year, or with your account; to have one deleted sooner, ask on
                Discord.
            </p>

            <h3>Reminders (only if you turn them on)</h3>
            <p>
                When you tap a <strong>🔔 Remind me</strong> button and your browser asks to allow notifications, your browser gives
                TowerForge a push address at its own push service (Google, Apple, Mozilla or Microsoft, depending on the
                browser). TowerForge&apos;s server keeps that address with what to remind you of: for labs, the names and
                finish times of the labs you were researching at your last import; for tournaments, the coming tournament
                days (six weeks ahead, sent again when you visit). It sends a notification at each. The notification is
                encrypted, so the push service only carries it and can&apos;t read it. Each reminder is deleted once it&apos;s
                sent; turning a kind off (the same button) deletes the rest of that kind, and anything left is deleted after 45 days.
                No account and nothing else about you.
            </p>

            <h3>Kept in your browser only</h3>
            <p>
                Besides your stats, your browser keeps a few things for TowerForge that never leave it: the moments your
                imports found (a new best wave and the like: on Profile for two weeks or until you close them, on the trophy
                shelf for a year), a share link you opened before importing (to offer it back), which version&apos;s
                What&apos;s new you&apos;ve seen, whether reminders are on, and your theme.
            </p>

            <h3>Visit counts</h3>
            <p>
                TowerForge counts visits with <a href="https://umami.is" target="_blank" rel="noopener noreferrer">Umami</a>,
                running on TowerForge&apos;s own server — no cookies, and nothing goes to another company. For each
                visit it records the page, the page you came from, your browser, system, device type, screen size and
                language, and your country, region and city, worked out from your IP address. The IP address itself
                isn&apos;t kept. It also counts a few actions, without anything you typed: importing, TowerForge Link
                steps, which way in the import help you pick, trying the example account, adding the site to your home screen, turning reminders on or off, the kind of moment an import found, making a share picture (a moment, your week, your year, the trophy shelf, a comparison) and comparing on a share link, seeing or closing What&apos;s new, the theme you pick, copying a creator code, opening a creator&apos;s channel or stream or the charity event&apos;s links, and the kind of each Ask AI question. These counts
                show which pages people use and what breaks; they&apos;re kept as statistics and can&apos;t be tied to
                you.
            </p>
            <p>If your browser sends <em>Do Not Track</em>, your visits aren&apos;t counted.</p>

            <h3>Server logs</h3>
            <p>
                Like nearly every website, TowerForge&apos;s web server logs each request: your IP address, the time,
                the address asked for, your browser and the page you came from. The logs are used only to keep the
                site working and safe (finding errors, stopping attacks and abuse) and are deleted after 14 days.
            </p>

            <h3>Other services</h3>
            <p>A normal visit contacts no one but towerforge.net. Other services only see you when you choose:</p>
            <ul>
                <li><strong>Ask AI&apos;s download:</strong> your browser fetches the AI from Hugging Face and its small program from GitHub, the way any download works. They see your IP address and the file, nothing more.</li>
                <li><strong>TowerForge Link:</strong> the Windows app downloads Google&apos;s adb from Google when you press <em>Get Google&apos;s adb</em>.</li>
                <li><strong>Lab reminders</strong> (if you turn them on): your browser&apos;s push service delivers them, encrypted (above).</li>
                <li><strong>Links</strong> to Discord, YouTube, Twitch, Tiltify (the charity event), the game&apos;s webstore and other community sites: their own privacy policies apply once you open them.</li>
            </ul>
            <p>
                <strong>Who&apos;s live on Creator Codes:</strong> every few minutes TowerForge&apos;s server asks Twitch
                and YouTube which creators on the list are streaming The Tower. It sends them only the creators&apos;
                channel names and TowerForge&apos;s own keys, never anything about you; your browser asks towerforge.net,
                not them, and only contacts Twitch or YouTube when you open a stream. For YouTube this uses YouTube API
                Services, so Google&apos;s{' '}
                <a href="https://www.google.com/policies/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>{' '}
                covers YouTube&apos;s side.
            </p>
            <p>
                TowerForge reads only the export file the game writes for tools. It never signs in to your game
                account or reads your game save.
            </p>

            <h3>TowerForge Link</h3>
            <p>
                The Link apps (Windows and Android) run on your own device. They read only the game&apos;s export file,
                answer only towerforge.net in a browser on that same device, and send nothing to TowerForge&apos;s
                server. The <a href={TAB_PATHS.importguide}>Import Guide</a> says how to remove them.
            </p>

            <h3>Where it&apos;s kept and how it&apos;s protected</h3>
            <p>
                Accounts, share links, sent answers, lab reminders, visit counts and logs are on TowerForge&apos;s server in the United
                States (OVHcloud, Virginia). If you live elsewhere, making an account or a share link sends that data to
                the US. The site is HTTPS-only, passwords and recovery codes are hashed, and only the person who runs
                TowerForge can reach the server.
            </p>

            <h3>Children</h3>
            <p>
                TowerForge works without an account, and isn&apos;t made for children. Please don&apos;t make an
                account if you&apos;re under 13, or under the age your country sets for agreeing to this yourself (up to
                16 in some European countries) without a parent&apos;s OK. If a parent tells us their child made one,
                we&apos;ll delete it.
            </p>

            <h3>Your choices and rights</h3>
            <ul>
                <li><strong>Get a copy:</strong> <button type="button" className="lgl-inline-btn" onClick={downloadBackup}>Download my data</button> saves everything TowerForge holds for you on this device (the same as your account&apos;s copy when you&apos;re signed in) as a file.</li>
                <li><strong>Correct it:</strong> change anything on its page; a signed-in account saves the change.</li>
                <li><strong>Delete it:</strong> Player → Account → Delete account, and your browser&apos;s site data.</li>
                <li><strong>Anything else</strong> — a question, a share link or sent answer to remove, or a request about your data: ask on <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">TowerForge&apos;s Discord</a>. You&apos;ll get an answer within 30 days.</li>
            </ul>
            <p>
                <strong>In the EU, the UK and Switzerland</strong>, TowerForge keeps account, share and reminder data to give you
                what you asked for, sent answers because you chose to send them, and visit counts and logs for its
                legitimate interest in keeping the site working and safe. You may object to any of it, and you can
                complain to your data protection authority.
            </p>
            <p>
                <strong>In California and other US states</strong>: TowerForge doesn&apos;t sell or share personal
                information, shows no ads, and keeps no sensitive information. You won&apos;t be treated differently for
                using your rights.
            </p>

            <h3>Changes</h3>
            <p>
                When this page changes, its date above changes, and anything important is in the site&apos;s patch
                notes.
            </p>

            <p className="lgl-foot">
                See also the <a href={TAB_PATHS.terms}>Terms of use</a>. Questions: <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">TowerForge&apos;s Discord</a>.
            </p>
        </article>
    );
}
