import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { Plugin, ResolvedConfig } from 'vite';
import { parseEntryJson, parseQuizJson } from '../src/core/schema.ts';
import { getRowValue } from '../src/core/model.ts';
import type { Row, RowValue, Token } from '../src/core/model.ts';
import { emitStaticSharePages } from './static-share-pages.ts';

export type PrecacheAsset = Readonly<{ url: string; sha256: string; size: number }>;
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function sourceFiles(directory: string): readonly string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        if (entry.name.startsWith('quality-rules-')) return [];
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Source symlink is not allowed: ${file}`);
        return entry.isDirectory() ? sourceFiles(file) : [file];
    });
}
/** 同じ公開入力と依存lockから、dirty treeでも同じ版を生成する。時刻は使わない。 */
export function applicationVersion(root = ROOT): string {
    const directories = ['src', 'public', 'data', 'icons'];
    const files = [
        ...directories.flatMap(directory => sourceFiles(path.join(root, directory))),
        ...['index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'scripts/build-assets.ts', 'scripts/static-share-pages.ts'].map(file => path.join(root, file)).filter(existsSync)
    ].sort((left, right) => {
        const a = path.relative(root, left).replaceAll(path.sep, '/');
        const b = path.relative(root, right).replaceAll(path.sep, '/');
        return a < b ? -1 : a > b ? 1 : 0;
    });
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(path.relative(root, file).replaceAll(path.sep, '/'));
        hash.update('\0'); hash.update(readFileSync(file)); hash.update('\0');
    }
    return `source-${hash.digest('hex').slice(0, 24)}`;
}
/** 公開entryのパスはrepo内data/*.jsonに限定し、OSやURLの解釈差を排除する。 */
export function entryPath(value: string): string {
    let decoded: string;
    try { decoded = decodeURIComponent(value); } catch { throw new Error(`Invalid encoded entry path: ${value}`); }
    if (/^[a-z][a-z\d+.-]*:/iu.test(decoded) || /[\\?#\0]/u.test(decoded) || decoded.startsWith('/')) throw new Error(`Unsafe entry path: ${value}`);
    const pieces = decoded.split('/').filter(piece => piece !== '.');
    if (pieces.some(piece => piece === '..' || piece === '' || piece.includes(':'))) throw new Error(`Unsafe entry path: ${value}`);
    const relative = pieces.join('/');
    if (!relative.startsWith('data/') || !relative.endsWith('.json')) throw new Error(`Entry must reference data JSON: ${value}`);
    return relative;
}
function outside(relative: string): boolean { return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative); }
async function copyPublicFile(root: string, output: string, relative: string): Promise<void> {
    const input = path.resolve(root, relative);
    const canonical = realpathSync(input);
    const relativeCanonical = path.relative(root, canonical);
    if (outside(relativeCanonical)) throw new Error(`Asset escapes repository: ${relative}`);
    const sourceRoot = path.join(root, relative.startsWith('data/') ? 'data' : 'icons');
    const sourceRelative = path.relative(sourceRoot, canonical);
    if (outside(sourceRelative)) throw new Error(`Asset escapes public source: ${relative}`);
    const target = path.resolve(output, relative);
    const outputRelative = path.relative(output, target);
    if (outside(outputRelative)) throw new Error(`Asset escapes output: ${relative}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(input, target);
}
function isTokenList(value: RowValue): value is readonly Token[] { return Array.isArray(value) && value.every((item: unknown) => !Array.isArray(item)); }
function isTokenMatrix(value: RowValue): value is readonly (readonly Token[])[] { return Array.isArray(value) && value.every((item: unknown) => Array.isArray(item)); }
function svgValueReferences(value: RowValue, row: Row, depth: number): readonly string[] {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [];
    if (isTokenMatrix(value)) return value.flatMap(tokens => svgReferences(tokens, row, depth));
    if (isTokenList(value)) return svgReferences(value, row, depth);
    return svgReferences([value], row, depth);
}
function svgReferences(tokens: readonly Token[], row: Row, depth = 0): readonly string[] {
    if (depth > 64) throw new Error('SVG reference nesting exceeds validated depth');
    return tokens.flatMap(token => {
        if (typeof token === 'string') return [];
        switch (token.type) {
            case 'svg': {
                if (token.source.kind === 'file') return [token.source.src];
                if (token.source.kind === 'inline') return [];
                const value = getRowValue(row, token.source.field);
                return value.kind === 'some' && typeof value.value === 'string' && !value.value.trimStart().startsWith('<') ? [value.value] : [];
            }
            case 'ruby': return [...svgReferences(token.base, row, depth + 1), ...svgReferences(token.ruby, row, depth + 1)];
            case 'key': case 'listkey': {
                const value = getRowValue(row, token.field);
                return [...(value.kind === 'some' ? svgValueReferences(value.value, row, depth + 1) : []),
                    ...(token.type === 'listkey' ? svgReferences(token.separatorTokens, row, depth + 1) : [])];
            }
            case 'hide': return svgReferences(token.value, row, depth + 1);
            case 'katex': case 'smiles': case 'br': case 'hr': return [];
        }
    });
}
export async function emitStaticData(root: string, output: string): Promise<readonly string[]> {
    const entry = parseEntryJson(await readFile(path.join(root, 'public/entry.json'), 'utf8'));
    if (!entry.ok) throw new Error(`Invalid static entry: ${JSON.stringify(entry.error)}`);
    const copied = new Set<string>();
    for (const name of entry.value.files) {
        const relative = entryPath(name);
        if (copied.has(relative)) throw new Error(`Duplicate resolved entry: ${relative}`);
        copied.add(relative);
        const quiz = parseQuizJson(await readFile(path.join(root, relative), 'utf8'));
        if (!quiz.ok) throw new Error(`Invalid static quiz ${relative}: ${JSON.stringify(quiz.error)}`);
        await copyPublicFile(root, output, relative);
        const references = [...new Set(quiz.value.table.flatMap(row => quiz.value.patterns.flatMap(pattern => [...svgReferences(pattern.tokens, row), ...pattern.tips.flatMap(tip => svgReferences(tip.tokens, row))])))];
        for (const reference of references) {
            const source = reference.trim();
            if (/^https?:\/\//u.test(source)) continue;
            const decodedReference = decodeURIComponent(source);
            if (/[\\?#\0]/u.test(decodedReference) || /^[a-z][a-z\d+.-]*:/iu.test(decodedReference) || decodedReference.startsWith('/')) throw new Error(`Unsafe SVG path: ${reference}`);
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), decodedReference));
            if (!resolved.startsWith('data/') || !resolved.endsWith('.svg')) throw new Error(`SVG escapes data: ${reference}`);
            await copyPublicFile(root, output, resolved);
        }
    }
    for (const icon of ['icon-192.svg', 'icon-512.svg']) await copyPublicFile(root, output, `icons/${icon}`);
    return [...copied];
}
export async function outputFiles(directory: string, prefix = ''): Promise<readonly string[]> {
    const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
    const lists = await Promise.all(entries.map(async entry => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error(`Output symlink is not allowed: ${relative}`);
        return entry.isDirectory() ? outputFiles(directory, relative) : [relative];
    }));
    return lists.flat().sort();
}
export async function inspectOutput(directory: string): Promise<readonly string[]> {
    const files = await outputFiles(directory);
    for (const file of files) {
        // upload-pages-artifact v5の既定tarはdot-file/directoryを除外する。
        // runtimeが取得する集合と実配信artifactを食い違わせない。
        if (file.split('/').some(part => part.startsWith('.'))) throw new Error(`Hidden file excluded by Pages artifact: ${file}`);
        if (/\.(?:php|ts|tsx|mjs|py|map)$/iu.test(file) || /(?:^|\/)(?:src|js|tests|scripts|node_modules|\.git|doc)(?:\/|$)/u.test(file) || file.includes('ogp-card')) throw new Error(`Development/server file in public output: ${file}`);
    }
    if (!files.includes('index.html') || !files.includes('entry.json') || !files.includes('manifest.webmanifest')) throw new Error('Static shell is incomplete');
    for (const htmlFile of files.filter(file => file.endsWith('.html'))) {
        const html = await readFile(path.join(directory, htmlFile), 'utf8');
        if (/\b(?:src|href)\s*=\s*["'][^"']*\.php(?:[?#][^"']*)?["']/iu.test(html)) throw new Error('PHP runtime reference in static HTML');
        for (const tag of html.match(/<(?:script|link)\b[^>]*>/giu) ?? []) {
            if ((/^<script/iu.test(tag) || /\brel\s*=\s*["']stylesheet["']/iu.test(tag)) && /\b(?:src|href)\s*=\s*["']https?:\/\//iu.test(tag)) {
                throw new Error('External runtime dependency in static HTML');
            }
        }
    }
    return files;
}
export async function precacheAssets(directory: string, base: string): Promise<readonly PrecacheAsset[]> {
    const files = (await inspectOutput(directory)).filter(file => file !== 'sw.js' && file !== 'precache-manifest.json' && file !== 'app-version.json');
    return Promise.all(files.map(async file => {
        const buffer = await readFile(path.join(directory, file));
        return { url: `${base}${file.split('/').map(encodeURIComponent).join('/')}`, sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.byteLength };
    }));
}
export function appAssetsPlugin(version: string): Plugin {
    let config: ResolvedConfig;
    return {
        name: 'quiz-static-assets', apply: 'build',
        configResolved(resolved) { config = resolved; },
        async closeBundle() {
            const output = path.resolve(config.root, config.build.outDir);
            const sources = await emitStaticData(config.root, output);
            await emitStaticSharePages(output, config.base, sources);
            const assets = await precacheAssets(output, config.base);
            await writeFile(path.join(output, 'app-version.json'), `${JSON.stringify({ version })}\n`, 'utf8');
            await writeFile(path.join(output, 'precache-manifest.json'), `${JSON.stringify({ version, assets }, null, 2)}\n`, 'utf8');
            await build({
                configFile: false, root: config.root, publicDir: false, base: config.base,
                define: { __APP_VERSION__: JSON.stringify(version), __PRECACHE__: JSON.stringify(assets) },
                build: {
                    target: 'es2022', outDir: output, emptyOutDir: false, sourcemap: false,
                    lib: { entry: path.join(config.root, 'src/service-worker.ts'), name: 'QuizServiceWorker', formats: ['iife'], fileName: () => 'sw.js' }
                }
            });
            await inspectOutput(output);
        }
    };
}
