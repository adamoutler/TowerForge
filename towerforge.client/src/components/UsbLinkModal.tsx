// ============================================================
//  TowerForge Companion — Unified Interactive Data Import Modal
//  Provides a compact 3-tab interactive switcher:
//    [TowerForge Link]  [WebUSB]  [TowerForge Link Python]
//  Connects directly from a Chromium desktop browser to a USB-attached
//  Android phone over WebUSB ADB (engine/usbLink.ts), displays a compact
//  horizontal stage pill strip across UsbConnectStage, manages IndexedDB vs.
//  ephemeral RAM-only RSA-2048 keys, renders concise OS-aware diagnostic
//  cards, and offers an interactive 3-step guide for towerforge-link.pyz.
// ============================================================

import { useEffect, useSyncExternalStore } from 'react';
import { trackEvent } from '../analytics';
import { setAutoImportOn } from '../engine/autoImport';
import {
    LINK_DOWNLOAD,
    LINK_DOWNLOAD_ANDROID,
    rememberedSource,
    rememberSource,
} from '../engine/linkClient';
import {
    diagnoseUsbError,
    LINUX_UDEV_RULE_FILENAME,
    LINUX_UDEV_RULE_URL,
    type UsbDiagnosis,
} from '../engine/usbDiagnose';
import {
    clearLastUsbConnectState,
    closeWebUsbSession,
    forgetUsbKeys,
    getActiveWebUsbDeviceName,
    getLastUsbConnectState,
    hasActiveWebUsbSession,
    LAST_USB_CONNECT_KEY,
    pullTowerForgeExportViaWebUsb,
    saveLastUsbConnectState,
    USB_CONNECT_STAGES,
    type LastUsbConnectMethod,
    type LastUsbConnectState,
    type UsbConnectStage,
    type UsbPullMetadata,
    type UsbPullOptions,
} from '../engine/usbLink';

export {
    clearLastUsbConnectState,
    getLastUsbConnectState,
    LAST_USB_CONNECT_KEY,
    saveLastUsbConnectState,
    type LastUsbConnectMethod,
    type LastUsbConnectState,
};
import {
    COMPANION_PY_DOWNLOAD_URL,
    COMPANION_PYZ_DOWNLOAD_URL,
    wsExport,
    wsKillAdbServer,
    type WsLinkRequestOptions,
} from '../engine/wsLinkClient';
import { openGuide } from '../guideNav';
import { TAB_PATHS } from '../routes';

export type UsbModalMode = 'link' | 'webusb' | 'python';
export type LinkTargetSubTab = 'emulator' | 'phone' | 'iphone';

export interface UsbLinkModalProps {
    onImport: (rawJson: string) => void;
    onClose?: () => void;
    initialMode?: UsbModalMode;
    onSwitchToLinkModal?: () => void;
    initialRememberDevice?: boolean;
    pullOptions?: UsbPullOptions;
    wsOptions?: WsLinkRequestOptions;
}

interface UsbStageDescriptor {
    stage: UsbConnectStage;
    shortLabel: string;
    detail: string;
}

const USB_STAGE_DESCRIPTORS: readonly UsbStageDescriptor[] = [
    {
        stage: 'idle',
        shortLabel: 'Ready',
        detail: 'Plug in your Android phone over USB with USB debugging enabled.',
    },
    {
        stage: 'requesting-device',
        shortLabel: 'Select',
        detail: 'Choose your Android phone in the browser WebUSB chooser popup.',
    },
    {
        stage: 'claiming-interface',
        shortLabel: 'Claim USB',
        detail: 'Claiming USB interface class 0xFF / subclass 0x42 / protocol 0x01.',
    },
    {
        stage: 'authenticating-rsa',
        shortLabel: 'RSA Auth',
        detail: 'Unlock your phone and tap "Allow" on the USB debugging RSA prompt.',
    },
    {
        stage: 'syncing-files',
        shortLabel: 'Sync',
        detail: 'Pulling tool_export.json over ADB Sync (bounded to 8 MiB).',
    },
    {
        stage: 'validating-payload',
        shortLabel: 'Validate',
        detail: 'Verifying JSON integrity before importing into TowerForge.',
    },
    {
        stage: 'done',
        shortLabel: 'Done',
        detail: 'Game data verified and imported into TowerForge.',
    },
    {
        stage: 'error',
        shortLabel: 'Alert',
        detail: 'See the diagnostic card below to resolve the USB connection issue.',
    },
] as const;

const ACTIVE_PIPELINE_STAGES: readonly UsbConnectStage[] = [
    'requesting-device',
    'claiming-interface',
    'authenticating-rsa',
    'syncing-files',
    'validating-payload',
];

const PYTHON_PY_SERVE_CMD = 'python3 ~/Downloads/towerforge-link.py';
const PYTHON_SERVE_CMD = 'python3 ~/Downloads/towerforge-link.pyz serve';
const PYTHON_PULL_CMD = 'python3 ~/Downloads/towerforge-link.pyz pull --pull-save';

interface UsbModalInternalState {
    mode: UsbModalMode;
    linkSubTab: LinkTargetSubTab;
    stage: UsbConnectStage;
    lastActiveStage: UsbConnectStage;
    rememberDevice: boolean;
    diagnosis: UsbDiagnosis | null;
    metadata: UsbPullMetadata | null;
    statusNote: { ok: boolean; text: string } | null;
    copiedCommand: string | null;
    isForgettingKeys: boolean;
    isWorkingCompanion: boolean;
    autoRetryAttempted: boolean;
}

const DEFAULT_MODAL_STATE: UsbModalInternalState = {
    mode: 'webusb',
    linkSubTab: 'emulator',
    stage: 'idle',
    lastActiveStage: 'idle',
    rememberDevice: true,
    diagnosis: null,
    metadata: null,
    statusNote: null,
    copiedCommand: null,
    isForgettingKeys: false,
    isWorkingCompanion: false,
    autoRetryAttempted: false,
};

const modalStatesBySession = new WeakMap<object, UsbModalInternalState>();
const modalListeners = new Set<() => void>();

function subscribeUsbLinkModalState(listener: () => void): () => void {
    modalListeners.add(listener);
    return () => {
        modalListeners.delete(listener);
    };
}

function getSessionState(
    sessionKey: object,
    initialRememberDevice = true,
    initialMode: UsbModalMode = 'webusb',
): UsbModalInternalState {
    const existing = modalStatesBySession.get(sessionKey);
    if (existing) {
        return existing;
    }
    const lastConnect = getLastUsbConnectState();
    const resolvedMode: UsbModalMode =
        !hasActiveWebUsbSession() &&
        lastConnect &&
        !lastConnect.lastFailed &&
        (lastConnect.method === 'webusb' || lastConnect.method === 'python')
            ? lastConnect.method
            : initialMode;
    const created: UsbModalInternalState = {
        ...DEFAULT_MODAL_STATE,
        mode: resolvedMode,
        rememberDevice: initialRememberDevice,
        autoRetryAttempted: false,
    };
    modalStatesBySession.set(sessionKey, created);
    return created;
}

function updateSessionState(
    sessionKey: object,
    patch: Partial<UsbModalInternalState>,
    initialRememberDevice = true,
    initialMode: UsbModalMode = 'webusb',
): void {
    const current = getSessionState(sessionKey, initialRememberDevice, initialMode);
    modalStatesBySession.set(sessionKey, {
        ...current,
        ...patch,
    });
    for (const listener of modalListeners) {
        listener();
    }
}

function isStageBusy(stage: UsbConnectStage): boolean {
    return (ACTIVE_PIPELINE_STAGES as readonly string[]).includes(stage);
}

function safeTrackEvent(name: string): void {
    if (typeof window !== 'undefined') {
        trackEvent(name);
    }
}

function getStepVisualState(
    stepStage: UsbConnectStage,
    currentStage: UsbConnectStage,
    lastActiveStage: UsbConnectStage,
): 'completed' | 'active' | 'error' | 'pending' {
    if (stepStage === 'error') {
        return currentStage === 'error' ? 'error' : 'pending';
    }
    if (currentStage === 'done') {
        return 'completed';
    }
    const order = USB_CONNECT_STAGES.indexOf(stepStage);
    const pivotStage = currentStage === 'error' ? lastActiveStage : currentStage;
    const pivotIndex = USB_CONNECT_STAGES.indexOf(pivotStage);

    if (currentStage === 'error' && stepStage === pivotStage) {
        return 'error';
    }
    if (order < pivotIndex) {
        return 'completed';
    }
    if (order === pivotIndex) {
        return 'active';
    }
    return 'pending';
}

export default function UsbLinkModal({
    onImport,
    onClose = () => undefined,
    initialMode = 'webusb',
    onSwitchToLinkModal,
    initialRememberDevice = true,
    pullOptions,
    wsOptions,
}: UsbLinkModalProps) {
    const state = useSyncExternalStore(
        subscribeUsbLinkModalState,
        () => getSessionState(onImport, initialRememberDevice, initialMode),
        () => getSessionState(onImport, initialRememberDevice, initialMode),
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const busy = isStageBusy(state.stage);

    const handleSelectMode = (nextMode: UsbModalMode) => {
        updateSessionState(
            onImport,
            {
                mode: nextMode,
                statusNote: null,
            },
            initialRememberDevice,
            initialMode,
        );
    };

    const handleSelectLinkSubTab = (subTab: LinkTargetSubTab) => {
        updateSessionState(
            onImport,
            { linkSubTab: subTab },
            initialRememberDevice,
            initialMode,
        );
    };

    const handleRememberChange = (checked: boolean) => {
        updateSessionState(
            onImport,
            {
                rememberDevice: checked,
                statusNote: null,
            },
            initialRememberDevice,
            initialMode,
        );
    };

    const handleForgetKeys = async () => {
        updateSessionState(
            onImport,
            {
                isForgettingKeys: true,
                statusNote: null,
            },
            initialRememberDevice,
            initialMode,
        );
        try {
            await forgetUsbKeys();
            clearLastUsbConnectState();
            setAutoImportOn(false);
            if (rememberedSource()?.startsWith('webusb:')) {
                rememberSource(null);
            }
            safeTrackEvent('USB Link: forget keys');
            updateSessionState(
                onImport,
                {
                    isForgettingKeys: false,
                    statusNote: {
                        ok: true,
                        text: 'Cleared saved USB RSA keys from this browser (IndexedDB and session memory).',
                    },
                },
                initialRememberDevice,
                initialMode,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            updateSessionState(
                onImport,
                {
                    isForgettingKeys: false,
                    statusNote: {
                        ok: false,
                        text: `Could not clear USB keys: ${msg}`,
                    },
                },
                initialRememberDevice,
                initialMode,
            );
        }
    };

    const handleCopyCommand = async (cmd: string) => {
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(cmd);
            }
            updateSessionState(onImport, { copiedCommand: cmd }, initialRememberDevice, initialMode);
        } catch {
            updateSessionState(onImport, { copiedCommand: cmd }, initialRememberDevice, initialMode);
        }
    };

    const handleConnect = async () => {
        const currentRemember = getSessionState(onImport, initialRememberDevice, initialMode).rememberDevice;
        updateSessionState(
            onImport,
            {
                stage: 'idle',
                lastActiveStage: 'idle',
                diagnosis: null,
                metadata: null,
                statusNote: null,
                copiedCommand: null,
            },
            initialRememberDevice,
            initialMode,
        );

        try {
            let connectedSerial: string | null = null;
            const pullResult: unknown = await pullTowerForgeExportViaWebUsb({
                ...pullOptions,
                rememberDevice: currentRemember,
                keepConnectionOpen: pullOptions?.keepConnectionOpen ?? currentRemember,
                onStageChange: (nextStage) => {
                    updateSessionState(
                        onImport,
                        {
                            stage: nextStage,
                            ...(nextStage !== 'error' ? { lastActiveStage: nextStage } : {}),
                        },
                        initialRememberDevice,
                        initialMode,
                    );
                    pullOptions?.onStageChange?.(nextStage);
                },
                onMetadata: (meta) => {
                    connectedSerial = meta.serial || null;
                    updateSessionState(onImport, { metadata: meta }, initialRememberDevice, initialMode);
                    pullOptions?.onMetadata?.(meta);
                },
            });

            if (currentRemember) {
                rememberSource(`webusb:${connectedSerial || 'device'}`);
            }

            const rawJson =
                typeof pullResult === 'string'
                    ? pullResult
                    : pullResult &&
                        typeof pullResult === 'object' &&
                        typeof (pullResult as { rawJson?: unknown }).rawJson === 'string'
                      ? (pullResult as { rawJson: string }).rawJson
                      : String(pullResult ?? '');

            saveLastUsbConnectState({ method: 'webusb', lastFailed: false });
            setAutoImportOn(true);

            updateSessionState(
                onImport,
                {
                    stage: 'done',
                    lastActiveStage: 'done',
                    diagnosis: null,
                    statusNote: {
                        ok: true,
                        text: 'Successfully pulled tool_export.json over WebUSB.',
                    },
                },
                initialRememberDevice,
                initialMode,
            );
            safeTrackEvent('USB Link: import success');
            onImport(rawJson);
        } catch (err) {
            saveLastUsbConnectState({ method: 'webusb', lastFailed: true });
            setAutoImportOn(false);
            const diagnosis = await diagnoseUsbError(err);
            safeTrackEvent(`USB Link error: ${diagnosis.kind}`);
            updateSessionState(
                onImport,
                {
                    stage: 'error',
                    diagnosis,
                },
                initialRememberDevice,
                initialMode,
            );
        }
    };

    const handleKillAdbAndRetry = async () => {
        updateSessionState(
            onImport,
            {
                isWorkingCompanion: true,
                statusNote: null,
            },
            initialRememberDevice,
            initialMode,
        );
        try {
            await wsKillAdbServer(wsOptions);
            safeTrackEvent('USB Link: ws adb.kill_server');
            updateSessionState(
                onImport,
                {
                    isWorkingCompanion: false,
                },
                initialRememberDevice,
                initialMode,
            );
            await handleConnect();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            updateSessionState(
                onImport,
                {
                    isWorkingCompanion: false,
                    statusNote: {
                        ok: false,
                        text: `Could not stop local ADB server via Python Companion (/ws): ${msg}`,
                    },
                },
                initialRememberDevice,
                initialMode,
            );
        }
    };

    const handleCompanionWsExport = async () => {
        updateSessionState(
            onImport,
            {
                isWorkingCompanion: true,
                statusNote: null,
            },
            initialRememberDevice,
            initialMode,
        );
        try {
            const result = await wsExport(undefined, wsOptions);
            saveLastUsbConnectState({ method: 'python', lastFailed: false });
            setAutoImportOn(true);
            updateSessionState(
                onImport,
                {
                    stage: 'done',
                    lastActiveStage: 'done',
                    diagnosis: null,
                    isWorkingCompanion: false,
                    statusNote: {
                        ok: true,
                        text: 'Successfully imported game export via Python Companion (/ws).',
                    },
                },
                initialRememberDevice,
                initialMode,
            );
            safeTrackEvent('USB Link: ws companion import success');
            onImport(result.data);
        } catch (err) {
            saveLastUsbConnectState({ method: 'python', lastFailed: true });
            setAutoImportOn(false);
            const msg = err instanceof Error ? err.message : String(err);
            updateSessionState(
                onImport,
                {
                    isWorkingCompanion: false,
                    statusNote: {
                        ok: false,
                        text: `Could not import via Python Companion (/ws): ${msg}`,
                    },
                },
                initialRememberDevice,
                initialMode,
            );
        }
    };

    if (!state.autoRetryAttempted) {
        state.autoRetryAttempted = true;
        const lastConnect = getLastUsbConnectState();
        if (
            !hasActiveWebUsbSession() &&
            lastConnect &&
            !lastConnect.lastFailed &&
            (lastConnect.method === 'webusb' || lastConnect.method === 'python')
        ) {
            if (lastConnect.method === 'webusb') {
                queueMicrotask(() => {
                    void handleConnect();
                });
            } else if (lastConnect.method === 'python') {
                queueMicrotask(() => {
                    void handleCompanionWsExport();
                });
            }
        }
    }

    const handleOpenGuide = (part: string, e: React.MouseEvent<HTMLAnchorElement>) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
            return;
        }
        e.preventDefault();
        onClose();
        openGuide(part);
    };

    const { diagnosis } = state;
    const showUdevLink =
        Boolean(diagnosis?.udevRuleUrl) || diagnosis?.kind === 'linux-udev-permission-denied';
    const udevRuleHref = diagnosis?.udevRuleUrl ?? LINUX_UDEV_RULE_URL;
    const showCompanionFallback =
        Boolean(diagnosis?.companionDownloadUrl) ||
        diagnosis?.kind === 'webusb-unsupported' ||
        diagnosis?.kind === 'adb-server-owning-interface';
    const companionDownloadHref =
        diagnosis?.companionDownloadUrl ?? COMPANION_PYZ_DOWNLOAD_URL;

    return (
        <div
            className="lnk-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="usb-lnk-title"
            data-testid="usb-link-modal"
            onClick={onClose}
        >
            <div className="lnk-modal" onClick={(e) => e.stopPropagation()}>
                <div className="lnk-head">
                    <h2 id="usb-lnk-title">Get your data with</h2>
                    <div
                        className="lnk-mode-tabs"
                        role="tablist"
                        aria-label="Get your data with"
                        data-testid="get-data-mode-tabs"
                    >
                        <button
                            type="button"
                            role="tab"
                            aria-selected={state.mode === 'link'}
                            className={`lnk-mode-tab ${state.mode === 'link' ? 'on' : ''}`}
                            data-testid="mode-tab-link"
                            onClick={() => handleSelectMode('link')}
                        >
                            TowerForge Link
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={state.mode === 'webusb'}
                            className={`lnk-mode-tab ${state.mode === 'webusb' ? 'on' : ''}`}
                            data-testid="mode-tab-webusb"
                            onClick={() => handleSelectMode('webusb')}
                        >
                            WebUSB
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={state.mode === 'python'}
                            className={`lnk-mode-tab ${state.mode === 'python' ? 'on' : ''}`}
                            data-testid="mode-tab-python"
                            onClick={() => handleSelectMode('python')}
                        >
                            TowerForge Link Python
                        </button>
                    </div>
                    <button
                        type="button"
                        className="lnk-close"
                        onClick={onClose}
                        aria-label="Close"
                        data-testid="usb-modal-close-btn"
                    >
                        ✕
                    </button>
                </div>

                <div className="lnk-body">
                    {state.mode === 'webusb' && (
                        <div data-testid="mode-pane-webusb">
                            {/* ── Concise Interactive 3-Step Guide ── */}
                            <div className="lnk-compact-guide" data-testid="webusb-interactive-guide">
                                <ol className="lnk-steps lnk-steps-compact">
                                    <li>
                                        <strong>Phone:</strong> Enable <em>Developer options → USB debugging</em> and plug in via USB.
                                    </li>
                                    <li>
                                        <strong>Connect:</strong> Click <strong>Connect USB Phone</strong> below, pick your phone, and tap <em>Allow</em> on screen.
                                    </li>
                                    <li>
                                        <strong>Conflict with <code>adb</code>?</strong> If HTTP Toolkit, Android Studio, or a background service keeps <code>adb</code> running, switch to{' '}
                                        <button
                                            type="button"
                                            className="lnk-inline-tab-btn"
                                            data-testid="guide-switch-to-python-btn"
                                            onClick={() => handleSelectMode('python')}
                                        >
                                            TowerForge Link Python
                                        </button>
                                        .
                                    </li>
                                </ol>
                                <div className="lnk-guide-links">
                                    <a
                                        href={`${TAB_PATHS.importguide}#usb`}
                                        onClick={(e) => handleOpenGuide('usb', e)}
                                    >
                                        📖 Direct USB Connect &amp; Linux udev guide →
                                    </a>
                                    <a
                                        href={`${TAB_PATHS.importguide}#linux-macos`}
                                        onClick={(e) => handleOpenGuide('linux-macos', e)}
                                    >
                                        📖 Python Companion guide →
                                    </a>
                                </div>
                            </div>

                            {/* ── Compact Horizontal Progress Strip for UsbConnectStage ── */}
                            <section
                                className="lnk-sec"
                                aria-label="USB Connection Progress"
                                data-testid="usb-progress-stepper"
                                data-current-stage={state.stage}
                            >
                                <div
                                    className={`lnk-status ${state.stage === 'done' ? 'on' : ''}`}
                                    role="status"
                                    data-testid="usb-stage-banner"
                                    style={{ marginBottom: '4px', padding: '6px 10px', fontSize: '13px' }}
                                >
                                    <strong>Stage:</strong>{' '}
                                    <code data-testid="usb-current-stage">{state.stage}</code>
                                    {state.metadata && (
                                        <span>
                                            {' '}
                                            · {state.metadata.deviceName} ({state.metadata.byteLength.toLocaleString()}{' '}
                                            bytes)
                                        </span>
                                    )}
                                    {hasActiveWebUsbSession() && (
                                        <span data-testid="usb-session-active-badge">
                                            {' '}
                                            · ● Session Open
                                            {getActiveWebUsbDeviceName()
                                                ? ` (${getActiveWebUsbDeviceName()})`
                                                : ''}
                                        </span>
                                    )}
                                </div>

                                <ol className="lnk-stage-pills">
                                    {USB_STAGE_DESCRIPTORS.map((item) => {
                                        const stepState = getStepVisualState(
                                            item.stage,
                                            state.stage,
                                            state.lastActiveStage,
                                        );
                                        const icon =
                                            stepState === 'completed'
                                                ? '✓'
                                                : stepState === 'error'
                                                  ? '✕'
                                                  : stepState === 'active'
                                                    ? '●'
                                                    : '○';
                                        return (
                                            <li
                                                key={item.stage}
                                                className="lnk-stage-pill"
                                                data-testid={`usb-stage-${item.stage}`}
                                                data-stage={item.stage}
                                                data-step-state={stepState}
                                                title={`${item.shortLabel}: ${item.detail}`}
                                            >
                                                <span aria-hidden="true">{icon}</span>
                                                <span>{item.shortLabel}</span>
                                            </li>
                                        );
                                    })}
                                </ol>
                            </section>

                            {/* ── Compact Single-Row Credential Controls ── */}
                            <section className="lnk-sec" data-testid="usb-credential-controls">
                                <div
                                    style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '8px',
                                        padding: '6px 10px',
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                        background: 'var(--bg3)',
                                        fontSize: '13px',
                                    }}
                                >
                                    <label
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '7px',
                                            cursor: busy ? 'default' : 'pointer',
                                            fontWeight: 600,
                                        }}
                                        title="When unchecked, generates a single-session RSA-2048 key in RAM only."
                                    >
                                        <input
                                            type="checkbox"
                                            checked={state.rememberDevice}
                                            disabled={busy}
                                            data-testid="remember-usb-device-checkbox"
                                            onChange={(e) => handleRememberChange(e.target.checked)}
                                        />
                                        <span>Remember this computer on my phone (IndexedDB)</span>
                                    </label>

                                    <button
                                        type="button"
                                        className="btn btn-dim"
                                        style={{ padding: '3px 8px', fontSize: '11.5px' }}
                                        data-testid="forget-usb-keys-btn"
                                        disabled={busy || state.isForgettingKeys}
                                        onClick={handleForgetKeys}
                                    >
                                        Forget USB Keys
                                    </button>
                                </div>
                            </section>

                            {/* ── Compact Diagnostic Remediation Card ── */}
                            {diagnosis && (
                                <section
                                    className="lnk-problem"
                                    role="alert"
                                    data-testid="usb-diagnosis-card"
                                    data-diagnosis-kind={diagnosis.kind}
                                    style={{ marginTop: '8px', padding: '10px 12px', fontSize: '13px' }}
                                >
                                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                        <h3
                                            data-testid="usb-diagnosis-title"
                                            style={{ margin: 0, fontSize: '14px', color: 'var(--gold)' }}
                                        >
                                            ⚠ {diagnosis.title}
                                        </h3>
                                        {diagnosis.ownerHolder && (
                                            <span
                                                data-testid="usb-diagnosis-holder"
                                                style={{ fontSize: '12px', color: 'var(--text-dim)' }}
                                            >
                                                Holder: <code>{diagnosis.ownerHolder.comm}</code> (PID{' '}
                                                <code>{diagnosis.ownerHolder.pid}</code>)
                                            </span>
                                        )}
                                    </div>

                                    <p data-testid="usb-diagnosis-summary" style={{ margin: '0 0 6px', lineHeight: 1.4 }}>
                                        {diagnosis.summary}
                                    </p>

                                    {diagnosis.commands.length > 0 && (
                                        <div
                                            data-testid="usb-diagnosis-commands"
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '4px',
                                                marginBottom: '8px',
                                            }}
                                        >
                                            {diagnosis.commands.map((cmd, idx) => (
                                                <div
                                                    key={cmd}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        gap: '8px',
                                                        padding: '4px 8px',
                                                        background: 'var(--bg4)',
                                                        border: '1px solid var(--border)',
                                                        borderRadius: '4px',
                                                    }}
                                                >
                                                    <code
                                                        style={{
                                                            fontFamily: 'var(--font-mono)',
                                                            fontSize: '11.5px',
                                                            overflowWrap: 'anywhere',
                                                        }}
                                                    >
                                                        {cmd}
                                                    </code>
                                                    <button
                                                        type="button"
                                                        className="btn btn-dim"
                                                        style={{ padding: '2px 7px', fontSize: '11px' }}
                                                        data-testid={`copy-usb-cmd-btn-${idx}`}
                                                        onClick={() => handleCopyCommand(cmd)}
                                                    >
                                                        {state.copiedCommand === cmd ? '✓ Copied' : 'Copy'}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {showUdevLink && (
                                        <div style={{ marginBottom: '8px' }}>
                                            <a
                                                className="btn btn-gold"
                                                style={{ display: 'inline-block', textDecoration: 'none' }}
                                                href={udevRuleHref}
                                                download={LINUX_UDEV_RULE_FILENAME}
                                                data-testid="usb-udev-rule-link"
                                            >
                                                ⬇ Download {LINUX_UDEV_RULE_FILENAME}
                                            </a>
                                        </div>
                                    )}

                                    {showCompanionFallback && (
                                        <div
                                            data-testid="usb-companion-fallback"
                                            style={{
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: '6px',
                                                marginBottom: '8px',
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className="btn btn-accent"
                                                data-testid="switch-to-python-tab-btn"
                                                onClick={() => handleSelectMode('python')}
                                            >
                                                🐍 Use TowerForge Link Python
                                            </button>
                                            <a
                                                className="btn btn-dim"
                                                style={{ textDecoration: 'none' }}
                                                href={companionDownloadHref}
                                                download="towerforge-link.pyz"
                                                data-testid="download-companion-pyz-link"
                                            >
                                                ⬇ Download Python Companion (towerforge-link.pyz)
                                            </a>
                                            <button
                                                type="button"
                                                className="btn btn-gold"
                                                data-testid="ws-companion-export-btn"
                                                disabled={busy || state.isWorkingCompanion}
                                                onClick={handleCompanionWsExport}
                                            >
                                                Import via Python Companion (/ws)
                                            </button>
                                        </div>
                                    )}

                                    <div className="lnk-actions" style={{ marginTop: '6px' }}>
                                        {diagnosis.kind === 'adb-server-owning-interface' && (
                                            <button
                                                type="button"
                                                className="btn btn-primary"
                                                data-testid="ws-kill-adb-retry-btn"
                                                disabled={busy || state.isWorkingCompanion}
                                                onClick={handleKillAdbAndRetry}
                                            >
                                                Stop Local ADB Server &amp; Retry USB
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="btn btn-accent"
                                            data-testid="retry-usb-connect-btn"
                                            disabled={busy || state.isWorkingCompanion}
                                            onClick={handleConnect}
                                        >
                                            Retry USB Connect
                                        </button>
                                    </div>
                                </section>
                            )}

                            {state.statusNote && (
                                <p
                                    className={state.statusNote.ok ? 'lnk-done' : 'lnk-problem'}
                                    role="status"
                                    data-testid="usb-status-note"
                                    style={{ marginTop: '8px' }}
                                >
                                    {state.statusNote.text}
                                </p>
                            )}

                            <div className="lnk-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        data-testid="usb-connect-primary-btn"
                                        disabled={busy}
                                        onClick={handleConnect}
                                    >
                                        Connect USB Phone
                                    </button>
                                    {hasActiveWebUsbSession() && (
                                        <button
                                            type="button"
                                            className="btn btn-dim"
                                            data-testid="usb-disconnect-btn"
                                            disabled={busy}
                                            onClick={async () => {
                                                await closeWebUsbSession();
                                                updateSessionState(
                                                    onImport,
                                                    {
                                                        stage: 'idle',
                                                        lastActiveStage: 'idle',
                                                        statusNote: {
                                                            ok: true,
                                                            text: 'Disconnected active WebUSB session.',
                                                        },
                                                    },
                                                    initialRememberDevice,
                                                    initialMode,
                                                );
                                            }}
                                        >
                                            Disconnect USB
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="btn btn-dim"
                                        onClick={onClose}
                                    >
                                        Close
                                    </button>
                                </div>
                                <span className="lnk-sub" style={{ margin: 0, fontSize: '12px' }}>
                                    100% local in-browser ADB Sync.
                                </span>
                            </div>
                        </div>
                    )}

                    {state.mode === 'python' && (
                        <div data-testid="mode-pane-python">
                            <p className="lnk-lead" style={{ fontSize: '13.5px', marginBottom: '8px' }}>
                                Uses your system <code>adb</code> on Linux, macOS, or Windows — works even when{' '}
                                <code>adb</code> is kept alive by HTTP Toolkit, Android Studio, or background services (no{' '}
                                <code>adb kill-server</code> needed).
                            </p>

                            <ol className="lnk-steps lnk-steps-compact">
                                <li>
                                    <strong>Download companion</strong> (Python 3.9+ stdlib only — plain-text{' '}
                                    <code>.py</code> or compressed <code>.pyz</code>):
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '5px' }}>
                                        <a
                                            className="btn btn-gold"
                                            style={{ display: 'inline-block', textDecoration: 'none' }}
                                            href={COMPANION_PY_DOWNLOAD_URL}
                                            download="towerforge-link.py"
                                            data-testid="download-companion-py-link"
                                        >
                                            ⬇ Download towerforge-link.py
                                        </a>
                                        <a
                                            className="btn btn-dim"
                                            style={{ display: 'inline-block', textDecoration: 'none' }}
                                            href={COMPANION_PYZ_DOWNLOAD_URL}
                                            download="towerforge-link.pyz"
                                            data-testid="download-companion-pyz-link"
                                        >
                                            ⬇ Download towerforge-link.pyz
                                        </a>
                                    </div>
                                </li>
                                <li>
                                    <strong>Start the local companion</strong> in a terminal (listens on{' '}
                                    <code>127.0.0.1:47821</code>):
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '8px',
                                            marginTop: '5px',
                                            padding: '5px 8px',
                                            background: 'var(--bg4)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '4px',
                                        }}
                                    >
                                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                                            {PYTHON_PY_SERVE_CMD}
                                        </code>
                                        <button
                                            type="button"
                                            className="btn btn-dim"
                                            style={{ padding: '2px 8px', fontSize: '11px' }}
                                            data-testid="copy-python-py-cmd-btn"
                                            onClick={() => handleCopyCommand(PYTHON_PY_SERVE_CMD)}
                                        >
                                            {state.copiedCommand === PYTHON_PY_SERVE_CMD ? '✓ Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '8px',
                                            marginTop: '4px',
                                            padding: '5px 8px',
                                            background: 'var(--bg4)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '4px',
                                        }}
                                    >
                                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                                            {PYTHON_SERVE_CMD}
                                        </code>
                                        <button
                                            type="button"
                                            className="btn btn-dim"
                                            style={{ padding: '2px 8px', fontSize: '11px' }}
                                            data-testid="copy-python-serve-cmd-btn"
                                            onClick={() => handleCopyCommand(PYTHON_SERVE_CMD)}
                                        >
                                            {state.copiedCommand === PYTHON_SERVE_CMD ? '✓ Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '8px',
                                            marginTop: '4px',
                                            padding: '4px 8px',
                                            background: 'var(--bg3)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '4px',
                                        }}
                                    >
                                        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                                            Or pull a file directly:{' '}
                                            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--text-bright)' }}>
                                                {PYTHON_PULL_CMD}
                                            </code>
                                        </span>
                                        <button
                                            type="button"
                                            className="btn btn-dim"
                                            style={{ padding: '2px 8px', fontSize: '11px' }}
                                            data-testid="copy-python-pull-cmd-btn"
                                            onClick={() => handleCopyCommand(PYTHON_PULL_CMD)}
                                        >
                                            {state.copiedCommand === PYTHON_PULL_CMD ? '✓ Copied' : 'Copy'}
                                        </button>
                                    </div>
                                </li>
                                <li>
                                    <strong>Import your game data</strong> directly into this tab:
                                    <div style={{ marginTop: '5px' }}>
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            data-testid="ws-companion-export-btn"
                                            disabled={busy || state.isWorkingCompanion}
                                            onClick={handleCompanionWsExport}
                                        >
                                            {state.isWorkingCompanion ? '⏳ Importing…' : '⚡ Import via Python Companion (/ws)'}
                                        </button>
                                    </div>
                                </li>
                            </ol>

                            {state.statusNote && (
                                <p
                                    className={state.statusNote.ok ? 'lnk-done' : 'lnk-problem'}
                                    role="status"
                                    data-testid="usb-status-note"
                                    style={{ marginTop: '8px' }}
                                >
                                    {state.statusNote.text}
                                </p>
                            )}

                            <div className="lnk-guide-links">
                                <a
                                    href={`${TAB_PATHS.importguide}#linux-macos`}
                                    onClick={(e) => handleOpenGuide('linux-macos', e)}
                                >
                                    📖 Full Linux &amp; macOS Python Companion Guide →
                                </a>
                                <a
                                    href={`${TAB_PATHS.importguide}#usb`}
                                    onClick={(e) => handleOpenGuide('usb', e)}
                                >
                                    📖 Direct WebUSB Guide →
                                </a>
                            </div>

                            <div className="lnk-actions">
                                <button
                                    type="button"
                                    className="btn btn-dim"
                                    onClick={onClose}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    )}

                    {state.mode === 'link' && (
                        <div data-testid="mode-pane-link">
                            <p className="lnk-lead" style={{ fontSize: '13.5px', marginBottom: '8px' }}>
                                Reads <code>tool_export.json</code> from Windows emulators, Android phones over Wi-Fi or Shizuku, or iPhone backups.
                            </p>

                            <div className="lnk-tabs" role="tablist" aria-label="Device type" style={{ marginBottom: '8px' }}>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={state.linkSubTab === 'emulator'}
                                    className={`lnk-tab ${state.linkSubTab === 'emulator' ? 'on' : ''}`}
                                    data-testid="link-subtab-emulator"
                                    onClick={() => handleSelectLinkSubTab('emulator')}
                                >
                                    🖥 Emulator
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={state.linkSubTab === 'phone'}
                                    className={`lnk-tab ${state.linkSubTab === 'phone' ? 'on' : ''}`}
                                    data-testid="link-subtab-phone"
                                    onClick={() => handleSelectLinkSubTab('phone')}
                                >
                                    📱 Android Wi-Fi / App
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={state.linkSubTab === 'iphone'}
                                    className={`lnk-tab ${state.linkSubTab === 'iphone' ? 'on' : ''}`}
                                    data-testid="link-subtab-iphone"
                                    onClick={() => handleSelectLinkSubTab('iphone')}
                                >
                                    🍎 iPhone
                                </button>
                            </div>

                            {state.linkSubTab === 'emulator' && (
                                <ol className="lnk-steps lnk-steps-compact">
                                    <li>
                                        <strong>Download &amp; run helper:</strong>{' '}
                                        <a
                                            className="btn btn-gold"
                                            style={{ display: 'inline-block', textDecoration: 'none', marginLeft: '4px' }}
                                            href={LINK_DOWNLOAD}
                                            download
                                            data-testid="download-windows-link-btn"
                                        >
                                            ⬇ TowerForge Link (Windows)
                                        </a>
                                    </li>
                                    <li>
                                        <strong>Enable ADB in your emulator:</strong> BlueStacks / MuMu / LDPlayer / MEmu / Nox → Settings → turn on <em>ADB</em> and restart once.
                                    </li>
                                    <li>
                                        <strong>Export in game:</strong> In The Tower, open <em>Settings → External Tools Export</em>.
                                    </li>
                                </ol>
                            )}

                            {state.linkSubTab === 'phone' && (
                                <ol className="lnk-steps lnk-steps-compact">
                                    <li>
                                        <strong>On the phone itself (no PC):</strong> Install Shizuku +{' '}
                                        <a
                                            className="btn btn-gold"
                                            style={{ display: 'inline-block', textDecoration: 'none', marginLeft: '4px' }}
                                            href={LINK_DOWNLOAD_ANDROID}
                                            download
                                            data-testid="download-android-link-btn"
                                        >
                                            ⬇ TowerForge Link for Android
                                        </a>
                                    </li>
                                    <li>
                                        <strong>Or over Wi-Fi to a Windows PC:</strong> Enable <em>Developer options → Wireless debugging</em> and pair inside the full setup window.
                                    </li>
                                    <li>
                                        <strong>Or over USB cable:</strong> Use the{' '}
                                        <button
                                            type="button"
                                            className="lnk-inline-tab-btn"
                                            onClick={() => handleSelectMode('webusb')}
                                        >
                                            WebUSB
                                        </button>{' '}
                                        or{' '}
                                        <button
                                            type="button"
                                            className="lnk-inline-tab-btn"
                                            onClick={() => handleSelectMode('python')}
                                        >
                                            TowerForge Link Python
                                        </button>{' '}
                                        tabs above.
                                    </li>
                                </ol>
                            )}

                            {state.linkSubTab === 'iphone' && (
                                <ol className="lnk-steps lnk-steps-compact">
                                    <li>
                                        <strong>Install Apple Devices</strong> (Microsoft Store on Windows) and connect your iPhone.
                                    </li>
                                    <li>
                                        <strong>Export &amp; back up:</strong> Export in The Tower, then run an <em>unencrypted</em> local backup in Apple Devices.
                                    </li>
                                    <li>
                                        <strong>Run TowerForge Link:</strong> It automatically reads your newest iPhone backup.
                                    </li>
                                </ol>
                            )}

                            <div className="lnk-guide-links">
                                <a
                                    href={`${TAB_PATHS.importguide}#${state.linkSubTab === 'phone' ? 'android-phone' : state.linkSubTab}`}
                                    onClick={(e) => handleOpenGuide(state.linkSubTab === 'phone' ? 'android-phone' : state.linkSubTab, e)}
                                >
                                    📖 Full step-by-step Import Guide →
                                </a>
                            </div>

                            <div className="lnk-actions">
                                {onSwitchToLinkModal && (
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        data-testid="open-full-link-modal-btn"
                                        onClick={onSwitchToLinkModal}
                                    >
                                        ⚙ Open Live Status &amp; Wi-Fi Pairing
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="btn btn-dim"
                                    onClick={onClose}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
