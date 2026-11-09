import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const textExtensions = new Set(['.ts', '.js', '.mjs', '.css', '.html', '.json', '.md', '.php', '.svg', '.yml', '.yaml', '.txt', '.webmanifest']);
async function files(directory: string): Promise<readonly string[]> {
    const output: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Source symlink is not allowed: ${name}`);
        if (entry.isDirectory()) output.push(...await files(name));
        else if (entry.isFile()) output.push(name);
    }
    return output;
}

/** TypeScriptの対象外に手書きアプリや旧正本が残っていないことも検査する。 */
async function check(): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true });
    const selected: string[] = entries.filter(entry => entry.isFile()).map(entry => path.join(root, entry.name));
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (['src', 'scripts', 'tests', 'doc', 'data', 'icons', 'public', '.github', 'js', 'css'].includes(entry.name)) selected.push(...await files(path.join(root, entry.name)));
    }
    let checked = 0;
    for (const name of selected) {
        const relative = path.relative(root, name).replaceAll('\\', '/');
        const extension = path.extname(name).toLowerCase();
        if (relative.startsWith('js/') || relative.startsWith('css/') ||
            ['index.php', 'entry.php', 'config.php', 'manifest.php', 'manifest.webmanifest', 'sw.php', 'sw.js', 'cli.mjs', 'verify-json-parser.mjs', 'server.py', 'script.py', '.htaccess'].includes(relative)) throw new Error(`Superseded application source remains: ${relative}`);
        if (relative.startsWith('src/') && !['.ts', '.css'].includes(extension)) throw new Error(`Application source outside TypeScript checks: ${relative}`);
        if (relative.startsWith('public/') && ['.js', '.mjs', '.ts', '.php', '.html'].includes(extension)) throw new Error(`Executable public source bypasses the build: ${relative}`);
        if (extension === '.php' && !relative.startsWith('tests/ogp/') && relative !== 'ogp-card.php') throw new Error(`Unexpected PHP source: ${relative}`);
        if (!textExtensions.has(extension)) continue;
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(name));
        if (relative.startsWith('src/') && /(?:from\s*|import\s*\()\s*['"]\.[^'"]*\.m?js(?:['"?])/u.test(text)) throw new Error(`Local JavaScript bypasses type checks: ${relative}`);
        checked += 1;
    }
    console.log(`Source audit passed: ${checked} UTF-8 text files; application source is TypeScript/CSS.`);
}

await check();
