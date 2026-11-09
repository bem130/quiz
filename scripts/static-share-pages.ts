import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { plainText } from '../src/core/content.ts';
import { parseQuizJson } from '../src/core/schema.ts';

export type StaticSharePage = Readonly<{ source: string; path: string }>;
function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function isCharsetMeta(tag: string): boolean {
    for (const attribute of tag.slice(5, -1).matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu)) {
        const name = attribute[1]?.toLowerCase();
        const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
        if (name === 'charset' || (name === 'http-equiv' && value.toLowerCase() === 'content-type')) return true;
    }
    return false;
}
function boundedText(value: string, maximum: number): string {
    const text = Array.from(value, character => {
        const code = character.charCodeAt(0);
        return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127 ? ' ' : character;
    }).join('').trim();
    return Array.from(text).slice(0, maximum).join('');
}
function individualHtml(html: string, title: string, description: string, canonical: string): string {
    const image = new URL('https://bem130.com/quiz/ogp-card.php');
    image.searchParams.set('title', boundedText(title, 240)); image.searchParams.set('description', boundedText(description, 1200));
    const names = new Set(['description', 'og:title', 'og:description', 'og:url', 'og:image', 'twitter:title', 'twitter:description', 'twitter:url', 'twitter:image']);
    const cleaned = html.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/giu, '').replace(/<(?:meta|link)\b[^>]*>/giu, tag => {
        const attribute = /\b(?:name|property)\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1];
        if (attribute !== undefined && names.has(attribute.toLowerCase())) return '';
        return /^<link\b/iu.test(tag) && /\brel\s*=\s*["']canonical["']/iu.test(tag) ? '' : tag;
    });
    const tags = [
        `<title>${escapeHtml(title)}</title>`,
        `<link rel="canonical" href="${escapeHtml(canonical)}">`,
        ...[['name', 'description', description], ['property', 'og:title', title], ['property', 'og:description', description],
            ['property', 'og:url', canonical], ['property', 'og:image', image.href], ['name', 'twitter:title', title],
            ['name', 'twitter:description', description], ['name', 'twitter:url', canonical], ['name', 'twitter:image', image.href]]
            .map(([attribute, name, value]) => {
                if (attribute === undefined || name === undefined || value === undefined) throw new Error('Invalid share metadata');
                return `<meta ${attribute}="${name}" content="${escapeHtml(value)}">`;
            })
    ].join('\n');
    return cleaned.replace(/<\/head\s*>/iu, () => `${tags}\n</head>`);
}

/** queryでは変化しないPagesの初期HTMLに、公開題庫ごとの共有metadataを持たせる。 */
export async function emitStaticSharePages(output: string, base: string, sources: readonly string[]): Promise<void> {
    if (!base.startsWith('/') || !base.endsWith('/') || /[?#<>"'\\]/u.test(base)) throw new Error('Invalid static share base');
    const pages: readonly StaticSharePage[] = sources.map(source => ({ source, path: `share/${source.slice(0, -5)}.html` }));
    const registry = escapeHtml(JSON.stringify({ version: 1, base, pages }));
    const shell = await readFile(path.join(output, 'index.html'), 'utf8');
    if (!/<head\b[^>]*>/iu.test(shell) || !/<\/head\s*>/iu.test(shell)) throw new Error('Static share shell requires head');
    if (/<base\b/iu.test(shell) || /name\s*=\s*["']quiz-share-pages["']/iu.test(shell)) throw new Error('Static share shell already contains registry/base');
    const withoutCharset = shell.replace(/<meta\b[^>]*>/giu, tag => isCharsetMeta(tag) ? '' : tag);
    const html = withoutCharset.replace(/<head\b[^>]*>/iu, head => `${head}\n<meta charset="UTF-8">\n<base href="${escapeHtml(base)}">\n<meta name="quiz-share-pages" content="${registry}">`);
    await writeFile(path.join(output, 'index.html'), html, 'utf8');
    for (const page of pages) {
        const quiz = parseQuizJson(await readFile(path.join(output, page.source), 'utf8'));
        if (!quiz.ok) throw new Error(`Invalid share quiz: ${page.source}`);
        const title = plainText(quiz.value.title);
        const description = plainText(quiz.value.description);
        const canonical = `https://bem130.github.io${base}${page.path.split('/').map(encodeURIComponent).join('/')}`;
        const target = path.join(output, page.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, individualHtml(html, title, description, canonical), 'utf8');
    }
}
