// ============================================================
//  TowerForge Companion — Analytics
//  Cookieless visit and event counts with Umami, self-hosted on
//  the TowerForge server (towerforge.net/analytics). The tracker
//  tag in index.html only reports from towerforge.net, so local
//  dev and previews send nothing. No personal data is sent.
//
//  Each tab has its own address (routes.ts), so the tracker's own
//  page views — it counts every address change — show which tabs
//  people use. Before 2026-10-20 tabs had no address and were
//  reported as "/<tab id>" (/whatif, /runcoins…).
// ============================================================

type Props = Record<string, unknown>;

interface Umami {
    track(payload?: (props: Props) => Props): void;
    track(event: string, data?: Record<string, string | number>): void;
}

// No window in tests (or during a build): nothing to count.
const umami = (): Umami | undefined =>
    (typeof window === 'undefined' ? undefined : (window as unknown as { umami?: Umami }).umami);

export function trackEvent(name: string, data?: Record<string, string | number>): void {
    umami()?.track(name, data);
}
