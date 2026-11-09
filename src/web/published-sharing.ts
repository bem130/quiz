import { err, none, ok, some } from '../core/result.ts';
import type { Option, Result } from '../core/result.ts';

export type PublishedPage = Readonly<{ source: string; url: string }>;
export type PublishedPages = Readonly<{ base: string; pages: readonly PublishedPage[] }>;
export type SharePackages = readonly Readonly<{ source: string; patternIds: readonly string[] }>[];

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function relativePath(value: unknown, prefix: string, suffix: string): Option<string> {
    if (typeof value !== 'string' || !value.startsWith(prefix) || !value.endsWith(suffix) || value.includes('\\') ||
        Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return none;
    const parts = value.split('/');
    if (parts.some(part => !part || part.startsWith('.'))) return none;
    try { return some(parts.map(part => encodeURIComponent(part)).join('/')); }
    catch { return none; }
}

/** repo相対の生pathを一度だけsegment encodeする。URLやpercent escapeとして解釈しない。 */
export function publishedPages(raw: string | null, appBase: string): Result<Option<PublishedPages>, string> {
    if (raw === null) return ok(none);
    const invalid = (): Result<Option<PublishedPages>, string> => err('同梱題庫の共有ページ情報が不正である。共通ページから利用できる。');
    try {
        const base = new URL(appBase);
        const value: unknown = JSON.parse(raw);
        if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash || !base.pathname.endsWith('/') ||
            !object(value) || value['version'] !== 1 || value['base'] !== base.pathname || !Array.isArray(value['pages'])) return invalid();
        const pages: PublishedPage[] = [];
        for (const item of value['pages']) {
            if (!object(item)) return invalid();
            const source = relativePath(item['source'], 'data/', '.json');
            const page = relativePath(item['path'], 'share/data/', '.html');
            if (source.kind === 'none' || page.kind === 'none' || typeof item['source'] !== 'string' || item['path'] !== `share/${item['source'].slice(0, -5)}.html`) return invalid();
            const sourceUrl = new URL(source.value, base); const pageUrl = new URL(page.value, base);
            if (sourceUrl.origin !== base.origin || pageUrl.origin !== base.origin || !sourceUrl.pathname.startsWith(base.pathname) || !pageUrl.pathname.startsWith(base.pathname) ||
                pages.some(previous => previous.source === sourceUrl.href || previous.url === pageUrl.href)) return invalid();
            pages.push({ source: sourceUrl.href, url: pageUrl.href });
        }
        return ok(some({ base: base.href, pages }));
    } catch { return invalid(); }
}

export function currentPublishedPage(pages: PublishedPages, url: string): Option<PublishedPage> {
    const incoming = new URL(url); incoming.search = ''; incoming.hash = '';
    const page = pages.pages.find(item => item.url === incoming.href);
    return page === undefined ? none : some(page);
}

/** 全選択が一つの公開題庫に属する時だけ題庫別HTMLを利用する。 */
export function publishedShareTarget(pages: PublishedPages, selected: readonly string[], packages: SharePackages): Option<PublishedPage> {
    if (!selected.length) return none;
    for (const page of pages.pages) {
        const source = packages.find(item => item.source === page.source);
        if (source !== undefined && selected.every(id => source.patternIds.includes(id))) return some(page);
    }
    return none;
}
