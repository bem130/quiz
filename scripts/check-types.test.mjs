import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const coreDirectory = path.join(repositoryRoot, 'src', 'core');

function runTool(relativeExecutable, args) {
    // shell を介さず、実際にインストールされた検査ツールを使用する。
    const result = spawnSync(
        process.execPath,
        [path.join(repositoryRoot, relativeExecutable), ...args],
        {
            cwd: repositoryRoot,
            encoding: 'utf8',
            timeout: 30_000,
            maxBuffer: 2 * 1024 * 1024
        }
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, '検査プロセスが強制終了していないこと');
    return result;
}

async function withFixtureDirectory(callback) {
    await mkdir(coreDirectory, { recursive: true });
    // 通常検査では除外する専用領域。負例側は実設定を継承して明示的に検査する。
    const directory = await mkdtemp(path.join(coreDirectory, 'quality-rules-'));
    try {
        await callback(directory);
    } finally {
        // 自動削除の対象を、このテストで生成した直下ディレクトリに限定する。
        assert.equal(path.dirname(directory), coreDirectory);
        assert.ok(path.basename(directory).startsWith('quality-rules-'));
        await rm(directory, { recursive: true, force: true });
    }
}

async function createTypeScriptConfig(directory, name, sourcePaths, configName) {
    const configPath = path.join(directory, `${name}.json`);
    await writeFile(configPath, JSON.stringify({
        extends: path.join(repositoryRoot, configName),
        compilerOptions: { noEmit: true },
        files: sourcePaths,
        include: [],
        exclude: []
    }), 'utf8');
    return configPath;
}

async function checkTypeScript(directory, name, source, configName) {
    const sourcePath = path.join(directory, `${name}.ts`);
    await writeFile(sourcePath, source, 'utf8');
    const configPath = await createTypeScriptConfig(directory, name, [sourcePath], configName);
    return runTool('node_modules/typescript/bin/tsc', [
        '--project', configPath, '--pretty', 'false'
    ]);
}

test('実際の TypeScript 設定が型安全性の負例を拒否する', async (context) => {
    await withFixtureDirectory(async (directory) => {
        // 正例も確認し、設定の読込失敗を負例の成功と取り違えない。
        await context.test('正しい core のコードは検査に成功する', async () => {
            const result = await checkTypeScript(directory, 'valid',
                'export const value: string = "valid";\n', 'tsconfig.core.json');
            assert.equal(result.status, 0, result.stdout + result.stderr);
        });

        const cases = [
            {
                name: 'null',
                description: 'strictNullChecks が null の代入を拒否する',
                source: 'export const value: string = null;\n',
                config: 'tsconfig.json',
                diagnostic: /TS2322/
            },
            {
                name: 'indexed',
                description: '未確認の配列アクセスを number として使用できない',
                source: 'export const value: number = [1][0];\n',
                config: 'tsconfig.json',
                diagnostic: /TS2322/
            },
            {
                name: 'optional',
                description: 'optional の欠損と undefined の代入を区別する',
                source: 'export const value: { amount?: number } = { amount: undefined };\n',
                config: 'tsconfig.json',
                diagnostic: /TS2375/
            },
            {
                name: 'dom',
                description: 'core は DOM 型へ依存できない',
                source: 'export const value = document.title;\n',
                config: 'tsconfig.core.json',
                diagnostic: /TS2584|TS2304/
            }
        ];

        for (const entry of cases) {
            await context.test(entry.description, async () => {
                const result = await checkTypeScript(directory, entry.name,
                    entry.source, entry.config);
                assert.notEqual(result.status, 0, '負例を型検査が拒否すること');
                assert.match(result.stdout + result.stderr, entry.diagnostic);
            });
        }
    });
});

test('実際の ESLint 設定が型検査だけでは防げない誤用を拒否する', async () => {
    await withFixtureDirectory(async (directory) => {
        const validPath = path.join(directory, 'valid-lint.ts');
        await writeFile(validPath,
            'export function identity(value: string): string { return value; }\n', 'utf8');
        const invalidPath = path.join(directory, 'invalid-lint.ts');
        await writeFile(invalidPath, `
export function unsafe(value: any): any { return value; }
export function asserted(value: string | undefined): string { return value!; }
export function unhandled(): void { Promise.resolve(1); }
export function incomplete(value: 'first' | 'second'): number {
    switch (value) {
        case 'first': return 1;
    }
    return 0;
}
`, 'utf8');
        const typeConfigPath = await createTypeScriptConfig(directory, 'lint-tsconfig',
            [validPath, invalidPath], 'tsconfig.json');
        const lintConfigPath = path.join(directory, 'eslint.config.mjs');
        const actualConfigUrl = pathToFileURL(path.join(repositoryRoot, 'eslint.config.mjs')).href;
        // 規則は実設定をそのまま使う。通常 tsconfig の除外領域を検査するため、
        // 型情報の取得先だけを実 tsconfig 継承の専用 project に変更する。
        await writeFile(lintConfigPath, `
import actualConfig from ${JSON.stringify(actualConfigUrl)};
export default [
    ...actualConfig,
    {
        files: ['src/core/quality-rules-*/**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: false,
                project: ${JSON.stringify(typeConfigPath)},
                tsconfigRootDir: ${JSON.stringify(repositoryRoot)}
            }
        }
    }
];
`, 'utf8');
        const lintArgs = ['--config', lintConfigPath, '--no-ignore', '--format', 'json'];
        const valid = runTool('node_modules/eslint/bin/eslint.js', [validPath, ...lintArgs]);
        assert.equal(valid.status, 0, valid.stdout + valid.stderr);
        const validResults = JSON.parse(valid.stdout);
        assert.equal(validResults.length, 1);
        assert.equal(validResults[0].messages.length, 0,
            '正例が無視対象ではなく、実際に lint されること');

        const invalid = runTool('node_modules/eslint/bin/eslint.js', [invalidPath, ...lintArgs]);
        assert.equal(invalid.status, 1, invalid.stdout + invalid.stderr);
        const results = JSON.parse(invalid.stdout);
        const rejectedRules = new Set(results.flatMap((result) =>
            result.messages.filter((message) => message.severity === 2)
                .map((message) => message.ruleId)));

        // 構文エラーや設定エラーではなく、意図した各規則で失敗したことを確認する。
        for (const rule of [
            '@typescript-eslint/no-explicit-any',
            '@typescript-eslint/no-non-null-assertion',
            '@typescript-eslint/no-floating-promises',
            '@typescript-eslint/switch-exhaustiveness-check'
        ]) {
            assert.ok(rejectedRules.has(rule), `${rule} が誤用を拒否すること`);
        }
    });
});
