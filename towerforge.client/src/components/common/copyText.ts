// ============================================================
//  TowerForge Companion — Copy to clipboard
//  For creator codes (Creator Codes tab, the Profile page's support
//  line). navigator.clipboard is missing or blocked in some in-app
//  browsers (the ones Discord and Reddit open links in), so it falls
//  back to the older copy command.
// ============================================================

export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const box = document.createElement('textarea');
        box.value = text;
        box.setAttribute('readonly', '');
        box.style.position = 'fixed';
        box.style.opacity = '0';
        document.body.appendChild(box);
        box.select();
        let ok: boolean;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        box.remove();
        return ok;
    }
}
