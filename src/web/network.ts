import { err, ok } from '../core/result.ts';
import type { Result } from '../core/result.ts';

export type NetworkError = Readonly<{ kind: 'invalid-url' | 'network' | 'http' | 'too-large'; detail: string }>;
export function resolveHttpUrl(path: string, base: string): Result<string, NetworkError> {
    try {
        const url = new URL(path, base);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return err({ kind: 'invalid-url', detail: path });
        url.hash = '';
        return ok(url.href);
    } catch { return err({ kind: 'invalid-url', detail: path }); }
}

/** JSON/SVGを上限付きで読む。取得URLはredirect後の参照解決にも使う。 */
export async function fetchText(url: string, limit = 5_000_000): Promise<Result<Readonly<{ text: string; url: string }>, NetworkError>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
        const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
        if (!response.ok) return err({ kind: 'http', detail: String(response.status) });
        const body = response.body;
        if (!body) return ok({ text: '', url: response.url });
        const reader = body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let size = 0;
        let text = '';
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > limit) { await reader.cancel(); return err({ kind: 'too-large', detail: String(limit) }); }
            text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        return ok({ text, url: response.url });
    } catch (error) { return err({ kind: 'network', detail: error instanceof Error ? error.message : '取得失敗' }); }
    finally { clearTimeout(timeout); }
}
