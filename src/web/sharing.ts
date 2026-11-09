import QRCode from 'qrcode';
import { err, none, ok, some } from '../core/result.ts';
import type { Option, Result } from '../core/result.ts';
import { isPatternId } from '../core/identity.ts';
import type { PatternId } from '../core/identity.ts';
import { resolveHttpUrl } from './network.ts';

export function shareUrl(base: string, selected: readonly string[], entries: readonly string[]): string {
    const url = new URL(base);
    url.searchParams.set('scope', JSON.stringify(selected));
    const valid = [...new Set(entries.flatMap((entry) => { const value = resolveHttpUrl(entry, base); return value.ok ? [value.value] : []; }))];
    if (valid.length) url.searchParams.set('entries', JSON.stringify(valid));
    else url.searchParams.delete('entries');
    return url.href;
}
export function sharedEntries(query: URLSearchParams, base: string): Result<readonly string[], string> {
    const raw = query.get('entries');
    let value: unknown = [];
    if (raw !== null) {
        try { value = JSON.parse(raw); } catch { return err('共有URLのentriesが不正なJSONである。保存済み題庫は保持している。'); }
    }
    if (!Array.isArray(value) || value.length > 50) return err('共有URLのentriesは50件以内のURL配列で指定する。保存済み題庫は保持している。');
    const input: unknown[] = value.map((entry: unknown) => entry);
    if (query.has('entry')) input.unshift(query.get('entry'));
    const entries: string[] = [];
    for (const entry of input) {
        if (typeof entry !== 'string' || !entry.trim()) return err('共有URLに不正なentry URLがある。保存済み題庫は保持している。');
        const parsed = resolveHttpUrl(entry, base);
        if (!parsed.ok) return err('共有URLのentryはHTTP(S)で指定する。保存済み題庫は保持している。');
        if (!entries.includes(parsed.value)) {
            if (entries.length === 50) return err('共有URLのentryは合計50件以内で指定する。保存済み題庫は保持している。');
            entries.push(parsed.value);
        }
    }
    return ok(entries);
}

/** 一部だけ採用せず、形式と全IDの利用可能性を確認してから選択へ渡す。 */
export function sharedScope(raw: string | null, available: ReadonlySet<PatternId>): Result<Option<readonly PatternId[]>, string> {
    if (raw === null) return ok(none);
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return err('共有URLのscopeが不正なJSONである。現在の出題範囲は保持した。'); }
    if (!Array.isArray(value)) return err('共有URLのscopeはpattern IDの配列で指定する。現在の出題範囲は保持した。');
    const selected: PatternId[] = [];
    for (const id of value) {
        if (typeof id !== 'string' || !isPatternId(id)) return err('共有URLのscopeに不正なpattern IDがある。現在の出題範囲は保持した。');
        if (!available.has(id)) return err('共有URLのscopeに利用できないpatternがある。取得状況を確認して範囲を選び直せる。現在の出題範囲は保持した。');
        if (!selected.includes(id)) selected.push(id);
    }
    return ok(some(selected));
}
export async function shareQr(url: string): Promise<Result<string, string>> {
    try { return ok(await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 360, color: { dark: '#000000ff', light: '#ffffffff' } })); }
    catch { return err('URLが長いためQRを作成できない。共有URLをコピーできる。'); }
}
