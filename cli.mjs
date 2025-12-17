#!/usr/bin/env node
import process from 'node:process';
import { loadQuizDefinitionFromPath } from './js/quiz-model.js';
import { QuizEngine, NoQuestionsAvailableError } from './js/quiz-engine.js';
import { optionToText, resolveQuestionContext, tokensToPlainText } from './js/text-utils.js';

function printUsage() {
    console.log('Usage: node cli.mjs --file <quiz.json> --pattern <patternId> --count <number>');
    console.log('Options:');
    console.log('  --file, -f     Quiz definition JSON path or URL');
    console.log('  --pattern, -p  Pattern ID to generate questions from');
    console.log('  --count, -c    Number of questions to display');
}

function parseArgs(argv) {
    const args = { count: 0 };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--file' || arg === '-f') {
            args.file = argv[i + 1];
            i += 1;
        } else if (arg === '--pattern' || arg === '-p') {
            args.pattern = argv[i + 1];
            i += 1;
        } else if (arg === '--count' || arg === '-c') {
            const value = parseInt(argv[i + 1], 10);
            args.count = Number.isFinite(value) ? value : 0;
            i += 1;
        } else if (arg === '--help' || arg === '-h') {
            args.help = true;
        }
    }
    return args;
}

function formatQuestion(question, definition) {
    const contextRow = resolveQuestionContext(question, definition.dataSets);
    const text = tokensToPlainText(question.tokens || [], contextRow);
    const answers = (question.answers || []).map((answer, answerIndex) => {
        const options = (answer.options || []).map((option, optionIndex) => {
            const label = optionToText(option, definition.dataSets, question) || '-';
            const correctMark = option.isCorrect ? ' [正解]' : '';
            return `    (${optionIndex + 1}) ${label}${correctMark}`;
        });
        return [`  解答${answerIndex + 1}:`, ...options].join('\n');
    });

    const tips = (question.patternTips || [])
        .map((tip, idx) => {
            const tipText = tokensToPlainText(tip.tokens || [], contextRow);
            return tipText ? `  (${idx + 1}) ${tipText}` : null;
        })
        .filter(Boolean);

    const tipSection = tips.length > 0 ? ['Tips:', ...tips].join('\n') : 'Tips: なし';

    return [text, answers.join('\n'), tipSection].filter(Boolean).join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printUsage();
        return;
    }

    if (!args.file || !args.pattern || !args.count) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    const { definition } = await loadQuizDefinitionFromPath(args.file);
    const engine = new QuizEngine(definition);
    const targetPattern = engine.patterns.find((p) => p && p.id === args.pattern);
    if (!targetPattern) {
        console.error(`指定された pattern が見つかりません: ${args.pattern}`);
        process.exitCode = 1;
        return;
    }

    engine.setSinglePatternMode(args.pattern);
    const capacity = engine.getPatternCapacity(args.pattern);
    if (capacity <= 0) {
        console.error('指定された pattern では生成可能な問題がありません。');
        process.exitCode = 1;
        return;
    }

    const total = Math.min(args.count, capacity);
    console.log(`ファイル: ${args.file}`);
    console.log(`pattern: ${args.pattern} (最大${capacity}問)`);
    console.log(`出題数: ${total}問`);
    console.log('');

    for (let i = 0; i < total; i += 1) {
        try {
            const question = engine.generateQuestion();
            console.log(`=== 問題 ${i + 1} ===`);
            console.log(formatQuestion(question, definition));
            console.log('');
        } catch (error) {
            if (error instanceof NoQuestionsAvailableError) {
                console.error('これ以上生成可能な問題がありません。');
            } else {
                console.error('問題生成中にエラーが発生しました:', error.message);
            }
            process.exitCode = 1;
            break;
        }
    }
}

main().catch((error) => {
    console.error('実行時エラー:', error);
    process.exitCode = 1;
});
