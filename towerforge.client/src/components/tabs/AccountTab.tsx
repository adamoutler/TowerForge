// ============================================================
//  TowerForge Companion — Account Tab
//  Create an account / sign in, sync status, the player's share
//  codes, and passwords: a recovery code (shown once when it's made)
//  sets a new password when the old one is forgotten — accounts have
//  no email. Players without a code ask in the Discord; the site owner
//  can issue one (docs/accounts.md).
// ============================================================

import { useState } from 'react';
import { useAccountStore } from '../../store/useAccountStore';
import MySharesList from '../share/MySharesList';
import { DISCORD_URL } from '../../constants/community';

type Mode = 'register' | 'signin' | 'reset';

function formatSyncTime(ts: number | null): string {
    if (!ts) return '';
    const secs = Math.round((Date.now() - ts) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    return mins < 60 ? `${mins} min ago` : new Date(ts).toLocaleTimeString();
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
const fieldStyle = { display: 'block', width: '100%', marginTop: '4px' } as const;

// A recovery code the server just made: it can't be shown again.
function NewRecoveryCode({ code, onSaved }: { code: string; onSaved: () => void }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
        } catch { /* select it by hand */ }
    };
    return (
        <div className="acc-code-box" role="status">
            <strong>Your recovery code</strong>
            <code className="acc-code">{code}</code>
            <div className="acc-code-actions">
                <button className="btn btn-dim" onClick={() => void copy()}>{copied ? '✓ Copied' : 'Copy'}</button>
                <button className="btn btn-accent" onClick={onSaved}>I&apos;ve saved it</button>
            </div>
            <p>
                Save it somewhere safe — a password manager, or a note on another device. It&apos;s shown only now.
                If you ever forget your password: <em>Sign In → Forgot your password?</em> and this code sets a new one.
                Each code works once; you get a new one when you use it.
            </p>
        </div>
    );
}

export default function AccountTab() {
    const status = useAccountStore(s => s.status);
    const username = useAccountStore(s => s.username);
    const syncState = useAccountStore(s => s.syncState);
    const lastSyncedAt = useAccountStore(s => s.lastSyncedAt);
    const notice = useAccountStore(s => s.notice);
    const hasRecoveryCode = useAccountStore(s => s.hasRecoveryCode);
    const recoveryCode = useAccountStore(s => s.recoveryCode);
    const register = useAccountStore(s => s.register);
    const login = useAccountStore(s => s.login);
    const resetPassword = useAccountStore(s => s.resetPassword);
    const newRecoveryCode = useAccountStore(s => s.newRecoveryCode);
    const changePassword = useAccountStore(s => s.changePassword);
    const recoveryCodeSaved = useAccountStore(s => s.recoveryCodeSaved);
    const logout = useAccountStore(s => s.logout);

    const [mode, setMode] = useState<Mode>('register');
    const [user, setUser] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Signed in: change password.
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [nextAgain, setNextAgain] = useState('');
    const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

    const switchMode = (m: Mode) => { setMode(m); setError(null); setPassword(''); setConfirmPassword(''); };

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        if (mode !== 'signin' && password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        setBusy(true);
        try {
            if (mode === 'register') await register(user.trim(), password);
            else if (mode === 'reset') await resetPassword(user.trim(), code.trim(), password);
            else await login(user.trim(), password);
            setPassword('');
            setConfirmPassword('');
            setCode('');
        } catch (err) {
            setError(errorText(err, 'Something went wrong.'));
        } finally {
            setBusy(false);
        }
    }

    async function handleLogout() {
        if (!confirm('Sign out? Your stats stay saved in your account and will be removed from this device.')) return;
        setBusy(true);
        setError(null);
        try {
            await logout();
        } catch (err) {
            setError(errorText(err, 'Could not sign out.'));
        } finally {
            setBusy(false);
        }
    }

    async function handleNewCode() {
        if (hasRecoveryCode && !confirm('Make a new recovery code? Your old code stops working.')) return;
        setBusy(true);
        setError(null);
        try {
            await newRecoveryCode();
        } catch (err) {
            setError(errorText(err, 'Could not make a recovery code.'));
        } finally {
            setBusy(false);
        }
    }

    async function handleChangePassword(e: React.FormEvent) {
        e.preventDefault();
        setPwMessage(null);
        if (next !== nextAgain) {
            setPwMessage({ ok: false, text: 'The new passwords do not match.' });
            return;
        }
        setBusy(true);
        try {
            await changePassword(current, next);
            setCurrent('');
            setNext('');
            setNextAgain('');
            setPwMessage({ ok: true, text: 'Password changed. Use the new one next time you sign in.' });
        } catch (err) {
            setPwMessage({ ok: false, text: errorText(err, 'Could not change the password.') });
        } finally {
            setBusy(false);
        }
    }

    if (status === 'loading') {
        return <p style={{ padding: '14px', color: 'var(--text-dim)' }}>Checking your account…</p>;
    }

    // ── Signed in ──
    if (status === 'signedIn') {
        const syncText =
            syncState === 'saving' ? 'Saving…'
                : syncState === 'error' ? 'Couldn’t save the latest changes — will retry on your next edit.'
                    : lastSyncedAt ? `All changes saved to your account · ${formatSyncTime(lastSyncedAt)}`
                        : 'Your stats are saved to your account.';

        return (
            <div>
                {recoveryCode && <NewRecoveryCode code={recoveryCode} onSaved={recoveryCodeSaved} />}

                <div className="section" style={{ marginBottom: '10px' }}>
                    <div className="section-head"><h3>Account</h3></div>
                    <div className="section-body" style={{ padding: '10px 14px' }}>
                        <div className="flex-row">
                            <span style={{ fontSize: '14px' }}>
                                Signed in as <strong>{username}</strong>
                            </span>
                            <span style={{ flex: 1 }} />
                            <button className="btn btn-dim" onClick={handleLogout} disabled={busy}>
                                {busy ? 'Please wait…' : 'Sign Out'}
                            </button>
                        </div>
                        <p style={{
                            fontSize: '13px', marginTop: '8px',
                            color: syncState === 'error' ? 'var(--red, #e74c3c)' : 'var(--text-dim)',
                        }}>
                            {syncText}
                        </p>
                        {error && (
                            <p style={{ fontSize: '13px', color: 'var(--red, #e74c3c)', marginTop: '6px' }}>{error}</p>
                        )}
                    </div>
                </div>

                <div className="section" style={{ marginBottom: '10px' }}>
                    <div className="section-head"><h3>Password and recovery code</h3></div>
                    <div className="section-body acc-security">
                        <p className={hasRecoveryCode ? 'acc-ok' : 'acc-warn'}>
                            {hasRecoveryCode
                                ? 'Your account has a recovery code. If you lose it, make a new one here — the old one then stops working.'
                                : 'Your account doesn’t have a recovery code yet. Make one now, so a forgotten password doesn’t lock you out.'}
                        </p>
                        <button className="btn btn-accent" onClick={() => void handleNewCode()} disabled={busy}>
                            {hasRecoveryCode ? 'Make a new recovery code' : 'Make a recovery code'}
                        </button>

                        <form onSubmit={handleChangePassword} className="acc-form">
                            <h4>Change password</h4>
                            <label className="field-label">
                                Current password
                                <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
                                    autoComplete="current-password" required style={fieldStyle} />
                            </label>
                            <label className="field-label">
                                New password
                                <input type="password" value={next} onChange={e => setNext(e.target.value)}
                                    autoComplete="new-password" required minLength={8} style={fieldStyle} />
                            </label>
                            <label className="field-label">
                                New password again
                                <input type="password" value={nextAgain} onChange={e => setNextAgain(e.target.value)}
                                    autoComplete="new-password" required style={fieldStyle} />
                            </label>
                            {pwMessage && <p className={pwMessage.ok ? 'acc-ok' : 'acc-error'}>{pwMessage.text}</p>}
                            <div>
                                <button type="submit" className="btn btn-dim" disabled={busy}>Change Password</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div className="section">
                    <div className="section-head"><h3>My Share Codes</h3></div>
                    <div className="section-body" style={{ padding: '10px 14px' }}>
                        <MySharesList />
                    </div>
                </div>
            </div>
        );
    }

    // ── Signed out ──
    const intro = {
        register: 'An account saves your stats and keeps track of your share codes, so you can delete them early. Everything you’ve already entered on this device moves into your new account.',
        signin: 'Signing in loads the stats saved in your account onto this device, replacing what’s here now.',
        reset: 'Forgot your password? Your recovery code — the one shown when you made your account, or the newest one you made since — sets a new one. Signing in this way loads your account’s stats onto this device.',
    }[mode];

    return (
        <div>
            <div className="sub-tab-bar">
                <button className={`sub-tab-btn ${mode === 'register' ? 'active' : ''}`} onClick={() => switchMode('register')}>
                    ✨ Create Account
                </button>
                <button className={`sub-tab-btn ${mode !== 'register' ? 'active' : ''}`} onClick={() => switchMode('signin')}>
                    🔑 Sign In
                </button>
            </div>

            <div className="section">
                <div className="section-body" style={{ padding: '14px' }}>
                    {notice && (
                        <p style={{ fontSize: '13px', color: 'var(--gold)', marginBottom: '10px' }}>{notice}</p>
                    )}

                    {mode === 'reset' && <h3 className="acc-title">Set a new password</h3>}
                    <p style={{ fontSize: '13px', color: 'var(--text-dim)', marginBottom: '12px', lineHeight: 1.6 }}>{intro}</p>

                    <form onSubmit={handleSubmit} className="acc-form">
                        <label className="field-label">
                            Username
                            <input
                                value={user}
                                onChange={e => setUser(e.target.value)}
                                autoComplete="username"
                                required
                                minLength={3}
                                maxLength={24}
                                style={fieldStyle}
                            />
                        </label>
                        {mode === 'reset' && (
                            <label className="field-label">
                                Recovery code
                                <input
                                    value={code}
                                    onChange={e => setCode(e.target.value)}
                                    placeholder="XXXX-XXXX-XXXX-XXXX"
                                    autoComplete="off"
                                    autoCapitalize="characters"
                                    spellCheck={false}
                                    required
                                    className="acc-code-input"
                                    style={fieldStyle}
                                />
                            </label>
                        )}
                        <label className="field-label">
                            {mode === 'reset' ? 'New password' : 'Password'}
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                                required
                                minLength={mode === 'signin' ? undefined : 8}
                                style={fieldStyle}
                            />
                        </label>
                        {mode !== 'signin' && (
                            <label className="field-label">
                                {mode === 'reset' ? 'New password again' : 'Confirm Password'}
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    autoComplete="new-password"
                                    required
                                    style={fieldStyle}
                                />
                            </label>
                        )}

                        {mode === 'register' && (
                            <p style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
                                Usernames are 3–24 letters, numbers, _ or -. Passwords need 8+ characters. You&apos;ll
                                get a recovery code once your account is made — keep it, it resets a forgotten password.
                            </p>
                        )}
                        {mode === 'reset' && (
                            <p style={{ fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                                Spaces, dashes and capitals in the code don&apos;t matter. No recovery code? Ask in
                                our <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">Discord</a> — once
                                the site owner has checked the account is yours, they can give you one.
                            </p>
                        )}

                        {error && <p className="acc-error">{error}</p>}

                        <div className="acc-buttons">
                            <button type="submit" className="btn btn-accent" disabled={busy}>
                                {busy ? 'Please wait…' : mode === 'register' ? 'Create Account' : mode === 'reset' ? 'Set New Password' : 'Sign In'}
                            </button>
                            {mode === 'signin' && (
                                <button type="button" className="acc-link" onClick={() => switchMode('reset')}>
                                    Forgot your password?
                                </button>
                            )}
                            {mode === 'reset' && (
                                <button type="button" className="acc-link" onClick={() => switchMode('signin')}>
                                    Back to Sign In
                                </button>
                            )}
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
