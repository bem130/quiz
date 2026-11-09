import QRCode from 'qrcode';
import { err, ok } from '../core/result.ts';
import type { Result } from '../core/result.ts';
import { resolveHttpUrl } from './network.ts';

export function shareUrl(base: string, selected: readonly string[], entries: readonly string[]): string {
    const url = new URL(base);
    url.searchParams.set('scope', JSON.stringify(selected));
    const valid = [...new Set(entries.flatMap((entry) => { const value = resolveHttpUrl(entry, base); return value.ok ? [value.value] : []; }))];
    if (valid.length) url.searchParams.set('entries', JSON.stringify(valid));
    else url.searchParams.delete('entries');
    return url.href;
}
export function sharedEntries(query: URLSearchParams, base: string): readonly string[] {
    const raw = query.get('entries');
    if (!raw) return [];
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(value) || value.length > 50) return [];
    return [...new Set(value.flatMap((entry: unknown) => { if (typeof entry !== 'string') return []; const parsed = resolveHttpUrl(entry, base); return parsed.ok ? [parsed.value] : []; }))];
}
export async function shareQr(url: string): Promise<Result<string, string>> {
    try { return ok(await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 360, color: { dark: '#000000ff', light: '#ffffffff' } })); }
    catch { return err('URLが長いためQRを作成できない。共有URLをコピーできる。'); }
}
