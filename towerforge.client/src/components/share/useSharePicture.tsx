// ============================================================
//  TowerForge Companion — Share picture button's helper
//  share(picture, file, label): draws the picture (a BrandPoster) off
//  screen, then opens the Export Images window on it (save on a
//  computer, the phone's share menu → Reddit, Discord, Photos). Render
//  `offscreen` somewhere on the page. useShareMoment: the same for a
//  moment's square picture (RecapPictures).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { openExportDialog } from './exportImages';
import { SHARE_OFFSCREEN_STYLE } from './shareTheme';
import type { Moment } from '../../engine/moments';
import { MomentPicture } from './RecapPictures';
import { trackEvent } from '../../analytics';

export function useSharePicture() {
    const [job, setJob] = useState<{ picture: ReactNode; file: string; label: string; n: number } | null>(null);
    const host = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const node = host.current?.firstElementChild as HTMLElement | null;
        if (job && node) openExportDialog(node, job.file, job.label);
    }, [job]);

    const share = useCallback((picture: ReactNode, file: string, label: string) =>
        setJob(j => ({ picture, file, label, n: (j?.n ?? 0) + 1 })), []);

    const offscreen = job
        ? <div ref={host} key={job.n} style={SHARE_OFFSCREEN_STYLE} aria-hidden="true">{job.picture}</div>
        : null;
    return { share, offscreen };
}

const momentFile = (m: Moment) => `towerforge-${m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export function useShareMoment() {
    const { share, offscreen } = useSharePicture();
    const shareMoment = useCallback((m: Moment) => {
        share(<MomentPicture moment={m} />, momentFile(m), m.title);
        trackEvent('Moment', { step: 'share', kind: m.kind });
    }, [share]);
    return { shareMoment, offscreen };
}
