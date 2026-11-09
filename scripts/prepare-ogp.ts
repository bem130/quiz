import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEntryJson, parseQuizJson } from '../src/core/schema.ts';
import { plainText } from '../src/core/content.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const COMMIT = 'f8d157532fbfaeda587e826d4cd5b21a49186f7c';
const FILES = [
    { source: 'Sans/SubsetOTF/JP/NotoSansJP-Regular.otf', target: 'fonts/NotoSansJP-Regular.otf', sha256: 'dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073' },
    { source: 'Sans/LICENSE', target: 'fonts/OFL.txt', sha256: '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2' }
] as const;

export function ogpMetadata(title: string, description: string): Readonly<{ title: string; description: string }> {
    const projected = { title: plainText(title), description: plainText(description) };
    const invalid = [...projected.title + projected.description].some(character => {
        const code = character.codePointAt(0);
        return code === undefined || code <= 8 || code === 11 || code === 12 ||
            (code >= 14 && code <= 31) || code === 127 || (code >= 0xD800 && code <= 0xDFFF);
    });
    if ([...projected.title].length > 240 || [...projected.description].length > 1200 || invalid) throw new Error('OGP metadata exceeds text/Unicode contract.');
    return projected;
}
async function readUtf8(file: string): Promise<string> {
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file));
}
function outside(relative: string): boolean { return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative); }

/** PHP配信専用。Pagesのdist/public内や任意の既存ディレクトリは出力先にしない。 */
export async function prepareOgp(output = path.join(ROOT, 'tmp/ogp-dist')): Promise<void> {
    const target = path.resolve(output);
    const relative = path.relative(path.join(ROOT, 'tmp'), target);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('OGP output must be a directory under repository tmp/.');
    await mkdir(path.join(ROOT, 'tmp'), { recursive: true });
    const tmp = await realpath(path.join(ROOT, 'tmp'));
    if (outside(path.relative(await realpath(ROOT), tmp))) throw new Error('OGP tmp/ symlink escapes repository.');
    // 先に既存祖先を調べ、junction越しに外へmkdirしてから拒否することを防ぐ。
    let ancestor = target;
    for (;;) {
        try {
            if (outside(path.relative(tmp, await realpath(ancestor)))) throw new Error('OGP output symlink escapes tmp/.');
            break;
        } catch (error) {
            if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
            const parent = path.dirname(ancestor);
            if (parent === ancestor) throw new Error('OGP output ancestor unavailable.', { cause: error });
            ancestor = parent;
        }
    }
    await mkdir(target, { recursive: true });
    const actual = await realpath(target);
    const actualRelative = path.relative(tmp, actual);
    if (actualRelative === '' || actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) throw new Error('OGP output symlink escapes tmp/.');
    if ((await readdir(actual)).length !== 0) throw new Error('OGP output must be empty; choose a fresh tmp/ directory.');
    // 入力は管理されたローカルentryだけ。HTTPメタデータ取得や利用者URLの実行はしない。
    const entry = parseEntryJson(await readUtf8(path.join(ROOT, 'public/entry.json')));
    if (!entry.ok) throw new Error('Invalid public/entry.json.');
    const metadata = new Map<string, Readonly<{ title: string; description: string }>>();
    for (const item of entry.value.files) {
        const relativeFile = item.replace(/^\.\//u, '');
        if (!/^data\/[A-Za-z0-9_./-]+\.json$/u.test(relativeFile) || relativeFile.split('/').includes('..')) throw new Error(`Unsafe local metadata path: ${item}`);
        const source = await realpath(path.join(ROOT, relativeFile));
        const sourceRelative = path.relative(await realpath(path.join(ROOT, 'data')), source);
        if (sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative)) throw new Error(`Metadata source escapes data/: ${item}`);
        const quiz = parseQuizJson(await readUtf8(source));
        if (!quiz.ok) throw new Error(`Invalid quiz metadata source: ${item}`);
        const id = path.basename(source, '.json');
        if (!/^[A-Za-z0-9_-]{1,80}$/u.test(id) || metadata.has(id)) throw new Error(`Invalid/duplicate quiz ID: ${id}`);
        metadata.set(id, ogpMetadata(quiz.value.title, quiz.value.description));
    }
    await mkdir(path.join(actual, 'fonts'), { recursive: true });
    for (const file of FILES) {
        const url = `https://raw.githubusercontent.com/notofonts/noto-cjk/${COMMIT}/${file.source}`;
        console.log(`Download pinned OGP dependency: ${url}`);
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`SHA-256 mismatch: ${file.target}`);
        await writeFile(path.join(actual, file.target), bytes);
    }
    await copyFile(path.join(ROOT, 'ogp-card.php'), path.join(actual, 'ogp-card.php'));
    await writeFile(path.join(actual, 'metadata.json'), JSON.stringify(Object.fromEntries(metadata), null, 2) + '\n', 'utf8');
    console.log(`Prepared PHP-only bundle: ${actual}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.length > 3) throw new Error('Usage: node scripts/prepare-ogp.ts [tmp/output-directory]');
    await prepareOgp(process.argv[2]);
}
