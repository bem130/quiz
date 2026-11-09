import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { packageIdentity } from '../src/core/identity.ts';
import { prepareQuiz, generateQuestion, tokensToText } from '../src/core/quiz-engine.ts';
import { seedRandom, shuffle } from '../src/core/random.ts';
import { parseQuizJson, serializeQuiz } from '../src/core/schema.ts';
import { err, ok } from '../src/core/result.ts';
import type { Result } from '../src/core/result.ts';

type Arguments = Readonly<{ file: string; pattern: string; count: number; seed: string }>;
function parseArgs(input: readonly string[]): Result<Arguments, string> {
    let file = ''; let pattern = ''; let count = 0; let seed = 'quiz-cli';
    for (let i = 0; i < input.length; i += 2) {
        const flag = input.at(i); const value = input.at(i + 1);
        if (!flag || !value) return err('各オプションには値が必要である。');
        switch (flag) {
            case '--file': case '-f': file = value; break;
            case '--pattern': case '-p': pattern = value; break;
            case '--count': case '-c': count = Number(value); break;
            case '--seed': seed = value; break;
            default: return err(`未対応のオプション: ${String(flag)}`);
        }
    }
    return file && pattern && Number.isInteger(count) && count > 0 && count <= 10_000
        ? ok({ file, pattern, count, seed }) : err('file・patternと1〜10000の整数countを指定する。');
}
function usage(): void {
    console.log('npm run cli -- --file <quiz.json> --pattern <patternId> --count <number> [--seed <seed>]');
}
async function main(): Promise<void> {
    if (process.argv.includes('--help') || process.argv.includes('-h')) { usage(); return; }
    const args = parseArgs(process.argv.slice(2));
    if (!args.ok) { usage(); console.error(args.error); process.exitCode = 1; return; }
    let text: string;
    let source: string;
    if (/^https?:\/\//u.test(args.value.file)) {
        const url = new URL(args.value.file);
        if (url.username || url.password) throw new Error('認証情報を含むURLは使用できない。');
        url.hash = '';
        const response = await fetch(url, { signal: AbortSignal.timeout(20_000), credentials: 'omit' });
        if (!response.ok) throw new Error(`題庫取得失敗: HTTP ${response.status}`);
        text = await response.text(); source = response.url;
    } else {
        source = path.resolve(args.value.file);
        text = await readFile(source, 'utf8');
    }
    if (Buffer.byteLength(text, 'utf8') > 5_000_000) throw new Error('題庫の上限は5MBである。');
    const quiz = parseQuizJson(text);
    if (!quiz.ok) throw new Error(`${quiz.error.path}: ${quiz.error.detail}`);
    const identity = packageIdentity(/^https?:/u.test(source) ? { kind: 'remote', url: source } : { kind: 'draft', id: `cli:${source}` });
    if (!identity.ok) throw new Error(identity.error.detail);
    const prepared = prepareQuiz(quiz.value, identity.value, serializeQuiz(quiz.value));
    const candidates = prepared.candidates.filter((candidate) => candidate.pattern.id === args.value.pattern || candidate.patternId === args.value.pattern);
    if (!candidates.length) throw new Error('指定patternが存在しないか、異なる誤選択肢を生成できない。');
    const ordered = shuffle(candidates, seedRandom(args.value.seed));
    let random = ordered.state;
    const selected = ordered.items.slice(0, args.value.count);
    console.log(`${quiz.value.title}\n出題数: ${selected.length} / 容量: ${candidates.length}\nseed: ${args.value.seed}\n`);
    for (const [index, candidate] of selected.entries()) {
        const generated = generateQuestion(candidate, random, { confusions: [], recentConceptIds: [] });
        if (generated.kind === 'none') throw new Error('生成可能な候補と実際の生成結果が一致しない。');
        const question = generated.value.question;
        random = generated.value.random;
        console.log(`=== 問題 ${index + 1} ===`);
        console.log(tokensToText(question.pattern.tokens.map((token) => typeof token !== 'string' && token.type === 'hide' ? '＿＿＿' : token), question.row));
        for (const [optionIndex, option] of question.options.entries()) console.log(`  (${optionIndex + 1}) ${option.text}${option.isCorrect ? ' [正解]' : ''}`);
        for (const tip of question.pattern.tips) console.log(`Tips: ${tokensToText(tip.tokens, question.row)}`);
        console.log('');
    }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'CLIの実行に失敗した。'); process.exitCode = 1; });
