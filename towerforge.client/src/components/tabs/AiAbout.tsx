// ============================================================
//  TowerForge Companion — Ask AI: how it works
//  A panel at the top of the Ask AI page, in plain words for players who
//  aren't technical: what the AI is, what it needs, how an answer is made,
//  what it's bad at, and everything it keeps on the device or sends —
//  the opt-in reports (ai/aiLog.ts reportOf) and the anonymous counts
//  (countAnswer in ai/aiAssistant.ts, docs/analytics.md). When what's
//  sent changes, change it here too.
// ============================================================

import type { ReactNode, RefObject } from 'react';
import { AI_MODELS } from '../../ai/aiModels';
import { DISCORD_URL } from '../../constants/community';
import { TAB_PATHS } from '../../routes';
import { useGameStore } from '../../store/useGameStore';

function ImportGuideLink({ children }: { children: ReactNode }) {
    return (
        <a href={TAB_PATHS.importguide} onClick={e => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            useGameStore.getState().setActiveTab('importguide');
        }}>{children}</a>
    );
}

// Where each thing is kept, who sees it and for how long.
const KEPT: { what: string; where: string; sent: boolean; who: string; long: string }[] = [
    { what: 'The AI download', where: 'Your browser', sent: false, who: 'Only you', long: 'Until you press Remove download' },
    { what: 'Your chat', where: 'Your browser', sent: false, who: 'Only you', long: 'Until you close or reload the page' },
    { what: 'The Debug log and your 👍/👎', where: 'Your browser', sent: false, who: 'Only you', long: 'Your last 200 questions, until you clear it' },
    { what: 'An answer you send (👎 → Send)', where: "TowerForge's server", sent: true, who: 'The person who runs TowerForge', long: 'Up to a year, then deleted' },
    { what: 'Anonymous counts', where: "TowerForge's visitor counter", sent: true, who: 'The person who runs TowerForge, as totals only', long: "Like the site's other visit counts" },
];

const FAQ: [string, ReactNode][] = [
    ['Does it cost anything?', 'No. It runs on your own computer, so there\'s nothing for anyone to pay for: no subscription and no limit on questions.'],
    ['Do I need a TowerForge account?', 'No, anyone can use it. If you\'re signed in when you send an answer, your username goes with it; if you\'re not, it\'s sent without a name.'],
    ['Can it see or change my game?', 'No. It only reads what\'s on TowerForge — the game data you imported or the levels you typed in. It has no way into the game and can\'t change anything there or on TowerForge.'],
    ['Why does it need a graphics card?', 'An AI does a huge number of small sums for every word it writes. A graphics card does thousands of them at once, so answers take seconds instead of minutes.'],
    ['Why is the first answer slow?', 'The first time, it downloads the AI. After that it starts in a few seconds, and most answers take 10 to 25 seconds. Questions TowerForge recognizes straight away are quicker.'],
    ['What does the ⚠ under an answer mean?', 'The answer has a number TowerForge didn\'t work out, so the AI may have added or rounded something itself. Open "Looked at" under the answer, or the page it names, to see the real number.'],
    ['What\'s "Think before answering"?', 'The AI thinks the question through before it answers. It takes about three times as long, and in our tests it wasn\'t better overall, so it\'s off unless you turn it on.'],
    ['What does "beta" mean?', 'It\'s new and still being improved. The answers people send and the anonymous counts show what goes wrong, so it can be fixed.'],
];

export function AiAbout({ id, panelRef }: { id: string; panelRef: RefObject<HTMLDetailsElement | null> }) {
    const [recommended] = AI_MODELS;
    return (
        <details className="section ai-dbg ai-about" id={id} ref={panelRef}>
            <summary className="section-head"><h3>How Ask AI works</h3><span className="s-badge">what it collects</span></summary>
            <div className="section-body ai-about-body">
                <ul className="ai-about-short">
                    <li>Ask AI answers questions about <strong>your</strong> The Tower account in plain words.</li>
                    <li>The AI runs <strong>on your own computer</strong>, not on a server somewhere. It&apos;s free and needs no account.</li>
                    <li>It doesn&apos;t do the math. TowerForge works out every number with the same tools as the Optimizer and What If pages, and the AI explains them.</li>
                    <li>Your questions and your account <strong>stay on your computer</strong>. Only two things ever leave it: an answer you choose to send, and anonymous counts with none of your words in them.</li>
                    <li>It&apos;s a beta and can get things wrong, so check anything important on the page it points you to.</li>
                </ul>

                <h4>What it is</h4>
                <p>
                    The &quot;AI&quot; is a <strong>language model</strong>: a program that has learned to read and write text.
                    This one is <strong>Qwen3</strong>, a free, open model made by the Qwen team at Alibaba. It isn&apos;t
                    ChatGPT, and it doesn&apos;t talk to ChatGPT or any other service while it works.
                </p>
                <p>
                    It knows your account from what&apos;s already on TowerForge: the game data you imported, or the levels
                    you typed in. It never connects to the game, can&apos;t log in anywhere and can&apos;t change anything.
                </p>

                <h4>What you need</h4>
                <ul>
                    <li>
                        <strong>A computer with Chrome or Edge.</strong> The AI thinks on your graphics card, through a
                        browser feature called WebGPU. Most gaming PCs and many laptops can do it; phones and tablets
                        usually can&apos;t yet. If yours can&apos;t, this page says so at the top.
                    </li>
                    <li>
                        <strong>A one-time download.</strong> The first time you press Start, your browser downloads the AI
                        from Hugging Face, the website where the model is published: {recommended.download} for
                        the recommended {recommended.label}, about the size of an HD movie. It&apos;s kept in your browser,
                        so next time it starts in a few seconds.
                    </li>
                    <li>
                        <strong>A size that suits your computer.</strong> The models under Model below are the same AI in
                        different sizes: a bigger one answers better but needs a stronger graphics card.
                    </li>
                </ul>

                <h4>How it answers a question</h4>
                <p>
                    Small AIs are good with words but bad at math, so the work is split: TowerForge does every
                    calculation, and the AI only picks what to look up and explains it. All four steps happen on your computer.
                </p>
                <ol className="ai-about-steps">
                    <li><strong>Read the question</strong>What kind of question is it — what to buy, &quot;what if I…&quot;, your runs, another tier? Plain ones TowerForge recognizes straight away; trickier ones the AI reads.<span>TowerForge or the AI</span></li>
                    <li><strong>Do the math</strong>TowerForge runs the same calculations as its own pages — Optimizer, What If, Run Length and the rest — on your account.<span>TowerForge</span></li>
                    <li><strong>Write the answer</strong>The AI gets those results and a short summary of your account, and writes the answer in plain words, told to use only those numbers.<span>The AI</span></li>
                    <li><strong>Check the numbers</strong>TowerForge checks every number in the answer. One it didn&apos;t work out itself gets a ⚠ under the answer.<span>TowerForge</span></li>
                </ol>
                <div className="ai-about-example">
                    <strong>For example</strong>, &quot;how many waves would maxing Chain Lightning damage get me?&quot; Step 1 sees
                    a &quot;what if&quot; question about Chain Lightning. Step 2 runs What If and gets, say, &quot;+4.2 waves, for
                    3,450 stones&quot;. Step 3 writes &quot;Maxing Chain Lightning damage would add about 4.2 waves…&quot;. Step 4
                    checks that 4.2 and 3,450 are TowerForge&apos;s numbers. (Made-up numbers, just for the example.)
                </div>
                <p>
                    Under each answer, <strong>Looked at</strong> shows everything TowerForge worked out for it, so you can see
                    where each number came from. When the answer tried some upgrades, <strong>Open in What If</strong> opens
                    them on the What If page.
                </p>

                <h4>What it&apos;s not good at</h4>
                <ul>
                    <li><strong>It can still be wrong.</strong> On our 94 test questions, about 9 in 10 answers were fully right.</li>
                    <li><strong>It sometimes invents a reason.</strong> Asked &quot;why&quot;, it can make up an explanation that sounds right.</li>
                    <li><strong>It only knows what TowerForge knows.</strong> If something isn&apos;t on TowerForge, the AI can&apos;t know it either.</li>
                    <li>
                        <strong>It needs your data.</strong> With nothing imported or typed in, it has little to go on — import
                        your game data first (the <ImportGuideLink>Import Guide</ImportGuideLink> shows how).
                    </li>
                </ul>

                <h4>Your data: what stays, and what&apos;s sent</h4>
                <p>Because the AI runs on your computer, your questions don&apos;t need to go anywhere. Here is everything Ask AI keeps or sends, with nothing left out.</p>

                <div className="ai-about-box stays">
                    <div className="ai-about-tag">Stays on your computer</div>
                    <ul>
                        <li><strong>The AI download</strong>, kept in your browser until you press Remove download.</li>
                        <li><strong>Your chat</strong>, gone when you close or reload the page, or press Clear.</li>
                        <li><strong>The Debug log</strong> at the bottom of this page: your last 200 questions, the answers, how long each took and your 👍/👎. Clear the log deletes it.</li>
                        <li><strong>Your account&apos;s numbers</strong>, read in your browser. They&apos;re never sent anywhere to get an answer.</li>
                    </ul>
                </div>

                <div className="ai-about-box sent">
                    <div className="ai-about-tag">Sent only if you press Send</div>
                    <p>
                        When you press 👎 under an answer, TowerForge asks whether to send it, and says what&apos;s in it.
                        Nothing is sent unless you press <strong>Send</strong>. What it sends:
                    </p>
                    <ul>
                        <li>your question and the AI&apos;s answer;</li>
                        <li>how TowerForge read the question, and what it looked up for it — which includes some of your account&apos;s numbers;</li>
                        <li>any numbers that got a ⚠;</li>
                        <li>the model, your kind of graphics card (like &quot;amd rdna-3&quot;) and the TowerForge version;</li>
                        <li>how long the answer took, and the note you type, if any;</li>
                        <li>your TowerForge username if you&apos;re signed in. If you&apos;re not, it&apos;s sent without a name.</li>
                    </ul>
                    <p>Only the person who runs TowerForge reads them, to fix what went wrong. They&apos;re deleted after a year.</p>
                </div>

                <div className="ai-about-box sent">
                    <div className="ai-about-tag">Sent by itself, without your words</div>
                    <p>
                        After each answer, TowerForge adds one to a few counters, to see which kinds of questions people ask
                        and where answers go wrong — without seeing anyone&apos;s questions. A count says only:
                    </p>
                    <ul>
                        <li>the kind of question, like &quot;what to buy&quot; or &quot;what if&quot;;</li>
                        <li>whether TowerForge or the AI worked out what was asked;</li>
                        <li>whether a number got a ⚠;</li>
                        <li>roughly how long it took: under 10 seconds, 10–20, 20–40, or over 40;</li>
                        <li>the model, and whether something broke.</li>
                    </ul>
                    <p>
                        Never your question, the answer, your account, your username or anything you typed. It&apos;s the same
                        visitor counter TowerForge uses for page visits: no cookies, on TowerForge&apos;s own server.
                    </p>
                </div>

                <h4>What Ask AI never collects</h4>
                <ul className="ai-about-never">
                    <li>Your questions or answers, unless you send one yourself.</li>
                    <li>Your game account, your game login, or anything from inside the game.</li>
                    <li>Your TowerForge password.</li>
                    <li>Your name, email or anything personal — TowerForge accounts don&apos;t even have an email.</li>
                    <li>Anything else on your computer. The AI only sees this page.</li>
                </ul>

                <h4>Where everything is kept</h4>
                <div className="ai-about-kept">
                    {KEPT.map(k => (
                        <div key={k.what} className="ai-about-row">
                            <div className="ai-about-what">{k.what}</div>
                            <div className={`ai-about-where ${k.sent ? 'sent' : 'stays'}`}>{k.where}</div>
                            <div className="ai-about-who">{k.who} · {k.long}</div>
                        </div>
                    ))}
                </div>
                <p>
                    <strong>The download:</strong> the first time, your browser fetches the AI from Hugging Face and the small
                    program that runs it from GitHub, the way any website loads a picture. They see a normal download, nothing
                    more — nothing is sent to them afterwards.
                </p>

                <h4>How to remove everything</h4>
                <ul>
                    <li><strong>Remove download</strong>, under Model, deletes the AI from your browser.</li>
                    <li><strong>Clear the log</strong>, in the Debug log, deletes your saved questions and 👍/👎.</li>
                    <li>Clearing your browser&apos;s data for towerforge.net removes all of it at once.</li>
                    <li>To have an answer you sent deleted, ask on the <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">TowerForge Discord</a>. Deleting your TowerForge account (Player → Account) deletes the ones you sent while signed in.</li>
                </ul>

                <h4>Questions people ask</h4>
                <div className="ai-about-faq">
                    {FAQ.map(([q, a]) => (
                        <details key={q}>
                            <summary>{q}</summary>
                            <p>{a}</p>
                        </details>
                    ))}
                </div>

                <h4>A few words explained</h4>
                <dl className="ai-about-words">
                    <dt>AI model</dt><dd>The program that reads and writes text. This one is Qwen3, a free, open one.</dd>
                    <dt>Graphics card</dt><dd>The part of your computer that draws games and video. Ask AI uses it to think quickly.</dd>
                    <dt>WebGPU</dt><dd>A browser feature that lets a website use your graphics card. Chrome and Edge on computers have it.</dd>
                    <dt>Your browser&apos;s storage</dt><dd>A private space where websites keep things on your computer, like the AI download and the Debug log. Other websites can&apos;t read it.</dd>
                    <dt>Hugging Face</dt><dd>A website where AI models are shared. Your browser downloads the AI from there.</dd>
                </dl>
            </div>
        </details>
    );
}
