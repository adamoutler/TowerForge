// ============================================================
//  TowerForge Companion — Terms of use (/terms)
//  The few rules for using the site, in plain words: it's a free
//  fan-made guide (not Tech Tree Games'), its numbers are estimates,
//  accounts and share links must not be misused, Link and Ask AI come
//  as they are, and the creator code earns the site's maker a share.
//  Written 2026-11-08 (docs/privacy.md).
// ============================================================

import { DISCORD_URL, SITE_CREATOR_CODE } from '../../constants/community';
import { TAB_PATHS } from '../../routes';

export const TERMS_UPDATED = 'November 9, 2026';

export default function TermsTab() {
    return (
        <article className="lgl-page">
            <h2>Terms of use</h2>
            <p className="lgl-date">Last updated {TERMS_UPDATED}</p>
            <p>
                By using TowerForge (towerforge.net, TowerForge Link and Ask AI) you agree to these terms. They&apos;re
                short; please read them.
            </p>

            <h3>A fan-made site</h3>
            <p>
                TowerForge is a free companion for The Tower, made by a player. It isn&apos;t affiliated with, endorsed
                by or run by Tech Tree Games. The Tower, its names and its game art belong to Tech Tree Games and are
                used here with their permission; TowerForge will take down anything Tech Tree Games asks it to.
            </p>

            <h3>The numbers are estimates</h3>
            <p>
                TowerForge models the game from what players and the community have measured. The game changes, and
                the models can be wrong or out of date. Its suggestions are advice, not promises: what you spend in
                the game (coins, gems, stones or real money) is your own decision.
            </p>

            <h3>Accounts</h3>
            <ul>
                <li>Pick a username that isn&apos;t offensive and doesn&apos;t pretend to be someone else.</li>
                <li>Keep your password and recovery code safe: accounts have no email, so they&apos;re the only way back in.</li>
                <li>You can delete your account at any time (Player → Account).</li>
                <li>TowerForge may remove an account or share link that breaks these terms.</li>
            </ul>

            <h3>Share links</h3>
            <p>
                Anyone with a share link can see what it holds, so share only your own stats. You&apos;re responsible
                for where you post it.
            </p>

            <h3>Don&apos;t misuse the site</h3>
            <p>
                Don&apos;t try to get into other players&apos; accounts, attack or overload the site, get around its
                limits, or use it to break the game&apos;s own terms. Copies of the site must not present themselves as
                TowerForge.
            </p>

            <h3>TowerForge Link and Ask AI</h3>
            <p>
                TowerForge Link reads the game&apos;s export file using your device&apos;s debugging features (ADB,
                Shizuku), which you turn on and can turn off at any time. Ask AI runs a language model on your own
                computer; its answers can be wrong, so check the numbers it flags. Both are offered as they are.
            </p>

            <h3>Creator codes</h3>
            <p>
                When you use creator code <strong>{SITE_CREATOR_CODE}</strong> in the game or on its webstore, the person
                who runs TowerForge gets a share of what you spend, at no extra cost to you. The other codes on{' '}
                <a href={TAB_PATHS.creators}>Creator Codes</a> earn for those creators.
            </p>
            <p>
                Creator Codes shows which creators are live using YouTube API Services and Twitch&apos;s API. By using
                TowerForge you agree to be bound by the{' '}
                <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>.
            </p>

            <h3>No warranty</h3>
            <p>
                TowerForge is provided &quot;as is&quot;, without warranties of any kind. As far as the law allows, the
                person who runs TowerForge isn&apos;t liable for losses from using it — including lost game progress,
                data, purchases or device problems. Some places don&apos;t allow these limits, so they may not all apply
                to you.
            </p>

            <h3>Changes</h3>
            <p>
                These terms may change; the date above shows when they last did, and anything important is in the
                site&apos;s patch notes. Using the site after a change means you accept the new terms.
            </p>

            <p className="lgl-foot">
                How your data is handled: <a href={TAB_PATHS.privacy}>Privacy</a>. Questions: <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">TowerForge&apos;s Discord</a>.
            </p>
        </article>
    );
}
