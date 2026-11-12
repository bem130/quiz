import { plainText } from './content.ts';
import { conceptId, patternId, questionId, rowId } from './identity.ts';
import type { ConceptId, PackageId, PatternId, QuestionId, Revision, RowId } from './identity.ts';
import { getRowValue as fieldValue } from './model.ts';
import type { HideToken, Pattern, QuizFile, Row, RowValue, Token } from './model.ts';
import type { Option } from './result.ts';
import { none, some } from './result.ts';
import { drawRandom, shuffle } from './random.ts';
import type { RandomState } from './random.ts';

export type AnswerVariant = Readonly<{
    id: string; conceptId: ConceptId; rowId: RowId; row: Row;
    tokens: readonly Token[]; text: string; comparisonKey: string;
}>;
/** pattern内で共有する索引。候補ごとに全poolを複製しない。 */
export type AnswerPool = Readonly<{
    variants: readonly AnswerVariant[];
    comparisonCounts: ReadonlyMap<string, number>;
    groupCounts: ReadonlyMap<string, ReadonlyMap<string, number>>;
    groupSizes: ReadonlyMap<string, number>;
}>;
export type QuestionCandidate = Readonly<{
    id: QuestionId; packageId: PackageId; revision: Revision; patternId: PatternId; conceptId: ConceptId;
    rowId: RowId; title: string; row: Row; pattern: Pattern;
    answers: readonly AnswerVariant[]; pool: AnswerPool; distractors: readonly AnswerVariant[];
}>;
export type QuestionOption = AnswerVariant & Readonly<{ isCorrect: boolean }>;
export type Question = Readonly<{
    id: QuestionId; packageId: PackageId; revision: Revision; patternId: PatternId; conceptId: ConceptId;
    title: string; row: Row; pattern: Pattern; options: readonly QuestionOption[];
    correctOptionId: string;
}>;
export type PreparedQuiz = Readonly<{
    packageId: PackageId; revision: Revision; title: string; candidates: readonly QuestionCandidate[];
    capacity: number; unavailable: readonly Readonly<{ patternId: string; rowId: string; reason: 'empty-answer' | 'no-distractor' | 'invalid-options' }>[];
    /** 性能検証用の実処理計数。利用者向け表示には使用しない。 */
    statistics: Readonly<{ sharedPools: number; indexVisits: number; rowChecks: number; capacityKeyChecks: number }>;
}>;
export type ConfusionPair = Readonly<{ conceptId: string; wrongConceptId: string; score: number }>;
export type DistractorStrategy = Readonly<{
    confusions: readonly ConfusionPair[];
    recentConceptIds: readonly string[];
}>;

function isTokenObject(value: RowValue): value is Exclude<Token, string> {
    return typeof value === 'object' && !Array.isArray(value);
}
function isTokenList(value: RowValue): value is readonly Token[] {
    return Array.isArray(value) && value.every((item: unknown) => !Array.isArray(item));
}
function isTokenMatrix(value: RowValue): value is readonly (readonly Token[])[] {
    return Array.isArray(value) && value.every((item: unknown) => Array.isArray(item));
}
function valueToText(value: RowValue, row: Row, comparison: boolean, depth: number): string {
    if (typeof value === 'string') return plainText(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (isTokenMatrix(value)) return value.map((tokens) => tokensToText(tokens, row, comparison, depth + 1)).join(' / ');
    if (isTokenList(value)) return tokensToText(value, row, comparison, depth + 1);
    return tokensToText([value], row, comparison, depth + 1);
}

/** 表示用テキスト。ruby/glossと画像のaltをUIと同じ規則で解釈する。 */
export function tokensToText(tokens: readonly Token[], row: Row, comparison = false, depth = 0): string {
    if (depth > 64) return '';
    return tokens.map((token): string => {
        if (typeof token === 'string') return plainText(token);
        switch (token.type) {
            case 'key': {
                const value = fieldValue(row, token.field);
                return value.kind === 'some' ? valueToText(value.value, row, comparison, depth) : '';
            }
            case 'listkey': {
                const value = fieldValue(row, token.field);
                const separator = tokensToText(token.separatorTokens, row, comparison, depth + 1);
                return value.kind === 'some' && isTokenMatrix(value.value)
                    ? value.value.map((entry) => tokensToText(entry, row, comparison, depth + 1)).join(separator)
                    : '';
            }
            case 'ruby': return tokensToText(token.base, row, comparison, depth + 1);
            case 'katex':
            case 'smiles': {
                if (token.source.kind === 'literal') return token.source.value;
                const value = fieldValue(row, token.source.field);
                return value.kind === 'some' && typeof value.value === 'string' ? value.value : '';
            }
            case 'svg': {
                let source: string;
                switch (token.source.kind) {
                    case 'inline': source = token.source.value; break;
                    case 'file': source = token.source.src; break;
                    case 'field': {
                        const value = fieldValue(row, token.source.field);
                        source = value.kind === 'some' && typeof value.value === 'string' ? value.value : '';
                        break;
                    }
                }
                return comparison ? `${plainText(token.alt)}\uFFFC${source}` : plainText(token.alt);
            }
            case 'hide': return tokensToText(token.value, row, comparison, depth + 1);
            case 'br':
            case 'hr': return '\n';
        }
    }).join('');
}

/** listkeyの全正答候補を列挙し、選択肢にも展開済みtokenを保持する。 */
function expandAnswers(tokens: readonly Token[], row: Row, depth = 0): readonly (readonly Token[])[] {
    if (depth > 64) return [];
    let combinations: readonly (readonly Token[])[] = [[]];
    for (const token of tokens) {
        let alternatives: readonly (readonly Token[])[] = [[token]];
        if (typeof token !== 'string' && token.type === 'listkey') {
            const value = fieldValue(row, token.field);
            alternatives = value.kind === 'some' && isTokenMatrix(value.value)
                ? value.value.flatMap((entry) => expandAnswers(entry, row, depth + 1)) : [];
        } else if (typeof token !== 'string' && token.type === 'key') {
            const value = fieldValue(row, token.field);
            if (value.kind === 'some' && isTokenList(value.value)) {
                alternatives = expandAnswers(value.value, row, depth + 1);
            } else if (value.kind === 'some' && isTokenObject(value.value)) {
                alternatives = expandAnswers([value.value], row, depth + 1);
            }
        }
        combinations = combinations.flatMap((head) => alternatives.map((tail) => [...head, ...tail]));
    }
    return combinations;
}

function findHide(pattern: Pattern): Option<HideToken> {
    for (const token of pattern.tokens) {
        if (typeof token !== 'string' && token.type === 'hide') return { kind: 'some', value: token };
    }
    return { kind: 'none' };
}

function variantFor(packageId: PackageId, row: Row, tokens: readonly Token[]): AnswerVariant {
    const scopedRow = rowId(packageId, row.id);
    const comparisonKey = tokensToText(tokens, row, true).trim();
    return {
        id: JSON.stringify([scopedRow, comparisonKey]),
        conceptId: conceptId(packageId, row.conceptId.kind === 'some' ? row.conceptId.value : row.id),
        rowId: scopedRow, row, tokens, text: tokensToText(tokens, row).trim(), comparisonKey
    };
}

function variantsFor(packageId: PackageId, row: Row, hide: HideToken): readonly AnswerVariant[] {
    const variants: AnswerVariant[] = [];
    const seen = new Set<string>();
    for (const tokens of expandAnswers(hide.value, row)) {
        const variant = variantFor(packageId, row, tokens);
        if (variant.comparisonKey.length === 0 || seen.has(variant.comparisonKey)) continue;
        seen.add(variant.comparisonKey);
        variants.push(variant);
    }
    return variants;
}

/**
 * 生成可能なpattern×rowを確定し、その件数を容量として返す。
 * 正答集合と同一の候補、同一行、同一groupは誤選択肢へ含めない。
 * revisionの異なるprepared値を再利用しないことは境界側の契約である。
 */
export function prepareQuiz(quiz: QuizFile, packageId: PackageId, revision: Revision): PreparedQuiz {
    const candidates: QuestionCandidate[] = [];
    const unavailable: { patternId: string; rowId: string; reason: 'empty-answer' | 'no-distractor' | 'invalid-options' }[] = [];
    let sharedPools = 0; let indexVisits = 0; let rowChecks = 0; let capacityKeyChecks = 0;
    for (const pattern of quiz.patterns) {
        const hide = findHide(pattern);
        if (hide.kind === 'none') continue;
        const scopedPattern = patternId(packageId, pattern.id);
        if (hide.value.answer.mode === 'choice_from_field') {
            const field = hide.value.answer.field;
            for (const row of quiz.table) {
                rowChecks += 1;
                const answers = variantsFor(packageId, row, hide.value);
                const value = fieldValue(row, field);
                const variants = value.kind === 'some' && isTokenMatrix(value.value)
                    ? value.value.map(tokens => variantFor(packageId, row, tokens)) : [];
                indexVisits += variants.length;
                capacityKeyChecks += variants.length;
                const answer = answers.at(0);
                const correct = answer === undefined ? [] : variants.filter(option => option.comparisonKey === answer.comparisonKey);
                if (answer === undefined || answers.length !== 1 || variants.length < 2 || variants.length > 4 ||
                    variants.some(option => option.comparisonKey.length === 0) ||
                    new Set(variants.map(option => option.comparisonKey)).size !== variants.length || correct.length !== 1) {
                    unavailable.push({ patternId: scopedPattern, rowId: row.id, reason: 'invalid-options' });
                    continue;
                }
                const pool: AnswerPool = { variants, comparisonCounts: new Map(variants.map(option => [option.comparisonKey, 1])), groupCounts: new Map(), groupSizes: new Map() };
                sharedPools += 1;
                candidates.push({
                    id: questionId(packageId, pattern.id, row.id), packageId, revision, patternId: scopedPattern,
                    conceptId: conceptId(packageId, row.conceptId.kind === 'some' ? row.conceptId.value : row.id),
                    rowId: rowId(packageId, row.id), title: quiz.title, row, pattern,
                    answers: correct, pool, distractors: variants.filter(option => option.comparisonKey !== answer.comparisonKey)
                });
            }
            continue;
        }
        const rows = quiz.table.map((row) => ({ row, variants: variantsFor(packageId, row, hide.value) }));
        const allVariants = rows.flatMap((entry) => entry.variants);
        const comparisonCounts = new Map<string, number>();
        const groupCounts = new Map<string, Map<string, number>>();
        const groupSizes = new Map<string, number>();
        const group = hide.value.answer.groupField;
        for (const variant of allVariants) {
            indexVisits += 1;
            comparisonCounts.set(variant.comparisonKey, (comparisonCounts.get(variant.comparisonKey) ?? 0) + 1);
            if (group.kind === 'none') continue;
            const value = fieldValue(variant.row, group.value);
            if (value.kind === 'none') continue;
            const groupKey = JSON.stringify(value.value);
            let counts = groupCounts.get(groupKey);
            if (counts === undefined) { counts = new Map(); groupCounts.set(groupKey, counts); }
            counts.set(variant.comparisonKey, (counts.get(variant.comparisonKey) ?? 0) + 1);
            groupSizes.set(groupKey, (groupSizes.get(groupKey) ?? 0) + 1);
        }
        const pool: AnswerPool = { variants: allVariants, comparisonCounts, groupCounts, groupSizes };
        sharedPools += 1;
        for (const entry of rows) {
            rowChecks += 1;
            const correctKeys = new Set(entry.variants.map((variant) => variant.comparisonKey));
            const ownGroup: Option<RowValue> = group.kind === 'some' ? fieldValue(entry.row, group.value) : { kind: 'none' };
            const groupKey = ownGroup.kind === 'some' ? some(JSON.stringify(ownGroup.value)) : none;
            const ownCounts = groupKey.kind === 'some' ? groupCounts.get(groupKey.value) : undefined;
            let available = allVariants.length - (groupKey.kind === 'some' ? groupSizes.get(groupKey.value) ?? 0 : 0);
            // 自分の行の全variantはcorrectKeysに含まれる。差集合の数を索引だけで求める。
            for (const key of correctKeys) {
                capacityKeyChecks += 1;
                available -= (comparisonCounts.get(key) ?? 0) - (ownCounts?.get(key) ?? 0);
            }
            const isDistractor = (variant: AnswerVariant): boolean => {
                if (variant.row.id === entry.row.id || correctKeys.has(variant.comparisonKey)) return false;
                if (group.kind === 'none' || ownGroup.kind === 'none') return true;
                const otherGroup = fieldValue(variant.row, group.value);
                return otherGroup.kind === 'none' || JSON.stringify(otherGroup.value) !== JSON.stringify(ownGroup.value);
            };
            if (entry.variants.length === 0 || available <= 0) {
                unavailable.push({ patternId: scopedPattern, rowId: entry.row.id,
                    reason: entry.variants.length === 0 ? 'empty-answer' : 'no-distractor' });
                continue;
            }
            candidates.push({
                id: questionId(packageId, pattern.id, entry.row.id), packageId, revision,
                patternId: scopedPattern, conceptId: conceptId(packageId,
                    entry.row.conceptId.kind === 'some' ? entry.row.conceptId.value : entry.row.id),
                rowId: rowId(packageId, entry.row.id), title: quiz.title, row: entry.row, pattern,
                answers: entry.variants, pool,
                // 全rowごとの巨大なpool複製を保持せず、生成時だけ共有variantから導出する。
                get distractors() { return allVariants.filter(isDistractor); }
            });
        }
    }
    return { packageId, revision, title: quiz.title, candidates, capacity: candidates.length, unavailable,
        statistics: { sharedPools, indexVisits, rowChecks, capacityKeyChecks } };
}

/** 元候補を変更せず、混同・coverage・randomの各役割で全poolから選ぶ。 */
export function generateQuestion(
    candidate: QuestionCandidate,
    initial: RandomState,
    strategy: DistractorStrategy = { confusions: [], recentConceptIds: [] }
): Option<Readonly<{ question: Question; random: RandomState }>> {
    const hide = findHide(candidate.pattern);
    if (hide.kind === 'some' && hide.value.answer.mode === 'choice_from_field') {
        const answer = candidate.answers.at(0);
        if (answer === undefined) return none;
        const options = shuffle(candidate.pool.variants.map(option => ({ ...option, isCorrect: option.comparisonKey === answer.comparisonKey })), initial);
        return some({ question: {
            id: candidate.id, packageId: candidate.packageId, revision: candidate.revision,
            patternId: candidate.patternId, conceptId: candidate.conceptId, title: candidate.title,
            row: candidate.row, pattern: candidate.pattern, options: options.items, correctOptionId: answer.id
        }, random: options.state });
    }
    const answers = shuffle(candidate.answers, initial);
    const answer = answers.items.at(0);
    if (answer === undefined) return { kind: 'none' };
    let random = answers.state;
    const picked: AnswerVariant[] = [];
    const usedText = new Set<string>();
    const usedRows = new Set<string>();
    const pool = candidate.distractors;
    const remaining = (): readonly AnswerVariant[] => pool.filter((option) =>
        !usedText.has(option.comparisonKey) && !usedRows.has(option.rowId));
    const take = (pool: readonly AnswerVariant[]): void => {
        const ordered = shuffle(pool, random);
        random = ordered.state;
        const option = ordered.items.at(0);
        if (option !== undefined) {
            picked.push(option); usedText.add(option.comparisonKey); usedRows.add(option.rowId);
        }
    };
    const recent = new Set(strategy.recentConceptIds);
    const pairs = strategy.confusions.filter((pair) => pair.conceptId === candidate.conceptId &&
        !recent.has(pair.wrongConceptId)).sort((left, right) => right.score - left.score);
    const top = pairs.at(0);
    if (top !== undefined) {
        const decision = drawRandom(random);
        random = decision.state;
        if (decision.value < Math.min(0.75, Math.max(0, 0.15 + 0.7 * top.score))) {
            take(remaining().filter((option) => option.conceptId === top.wrongConceptId));
        }
    }
    const novel = remaining().filter((option) => !strategy.recentConceptIds.includes(option.conceptId));
    take(novel.length > 0 ? novel : remaining());
    while (picked.length < 3 && remaining().length > 0) take(remaining());
    if (picked.length === 0) return { kind: 'none' };
    const options = shuffle([
        { ...answer, isCorrect: true }, ...picked.map((option) => ({ ...option, isCorrect: false }))
    ], random);
    return { kind: 'some', value: {
        question: {
            id: candidate.id, packageId: candidate.packageId, revision: candidate.revision,
            patternId: candidate.patternId, conceptId: candidate.conceptId, title: candidate.title,
            row: candidate.row, pattern: candidate.pattern, options: options.items, correctOptionId: answer.id
        },
        random: options.state
    } };
}
