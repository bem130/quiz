// js/quiz-engine.js
import { evaluateFilter } from './filters.js';
import {
    getDataSet,
    getFilteredRows,
    randomChoice,
    pickN,
    shuffled,
    findGroupDefinition
} from './dataset-utils.js';

function resolveSubTokenValue(spec, row) {
    if (!spec) return '';
    if (spec.source === 'key') {
        return row && spec.field ? row[spec.field] ?? '' : '';
    }
    return spec.value ?? '';
}

function tokenTextFromToken(token, row) {
    if (Array.isArray(token)) {
        return token.map((t) => tokenTextFromToken(t, row)).join('');
    }
    if (!token) return '';
    if (token.type === 'text') {
        return token.value ?? '';
    }
    if (token.type === 'katex' || token.type === 'smiles') {
        if (token.value != null) {
            return String(token.value);
        }
        return row && token.field ? row[token.field] ?? '' : '';
    }
    if (token.type === 'key') {
        return row && token.field ? row[token.field] ?? '' : '';
    }
    if (token.type === 'ruby' || token.type === 'hideruby') {
        const baseText = resolveSubTokenValue(token.base, row);
        const rubyText = resolveSubTokenValue(token.ruby, row);
        return rubyText ? `${baseText}|${rubyText}` : baseText;
    }
    if (token.type === 'hide') {
        if (token.value) {
            return tokenTextFromToken(token.value, row);
        }
        if (token.field && row) {
            return row[token.field] ?? '';
        }
    }
    return '';
}

function tokenDisplayKey(token, row) {
    const text = tokenTextFromToken(token, row);
    if (text) {
        return text;
    }
    if (row) {
        return row.nameEnCap || row.nameEn || row.text || '';
    }
    return '';
}

function optionLabelTokens(token) {
    if (!token) return null;
    const answerMode = token.answer && token.answer.mode;
    if (answerMode === 'choice_ruby_pair') {
        if (token.type === 'hideruby' || token.type === 'ruby') {
            return [token];
        }
        if (token.type === 'hide' && token.value) {
            return Array.isArray(token.value) ? token.value : [token.value];
        }
    }
    if (token.type === 'hide') {
        if (token.value) {
            return Array.isArray(token.value) ? token.value : [token.value];
        }
        if (token.field) {
            return [
                {
                    type: 'key',
                    field: token.field,
                    styles: token.styles || []
                }
            ];
        }
    }
    if (token.type === 'key') {
        return [token];
    }
    return null;
}

function buildChoiceFromEntities(token, correctRow, poolRows, dataSetId) {
    const choiceCfg = (token.answer && token.answer.choice) || {};
    const ds = choiceCfg.distractorSource || {};
    const choiceCount =
        typeof token.answer?.choiceCount === 'number' && token.answer.choiceCount > 0
            ? token.answer.choiceCount
            : typeof ds.count === 'number'
                ? ds.count + 1
                : 4;
    const avoidSameId = ds.avoidSameId !== false;
    const avoidSameText = ds.avoidSameText !== false;
    const pool = Array.isArray(poolRows)
        ? poolRows.filter((row) => !ds.filter || evaluateFilter(row, ds.filter))
        : [];

    const correctKey = tokenDisplayKey(token, correctRow);
    const usedIds = new Set([correctRow.id]);
    const usedText = new Set([correctKey]);
    const distractors = [];
    let safety = 2000;
    while (distractors.length < choiceCount - 1 && safety > 0) {
        safety -= 1;
        const candidate = randomChoice(pool);
        if (!candidate) break;
        if (avoidSameId && usedIds.has(candidate.id)) continue;
        const key = tokenDisplayKey(token, candidate);
        if (avoidSameText && usedText.has(key)) continue;
        distractors.push(candidate);
        usedIds.add(candidate.id);
        usedText.add(key);
    }

    const optionEntities = [
        {
            entityId: correctRow.id,
            isCorrect: true,
            displayKey: correctKey,
            labelTokens: optionLabelTokens(token),
            dataSetId
        },
        ...distractors.map((row) => ({
            entityId: row.id,
            isCorrect: false,
            displayKey: tokenDisplayKey(token, row),
            labelTokens: optionLabelTokens(token),
            dataSetId
        }))
    ];

    const shuffledOptions = shuffled(optionEntities);
    const correctIndex = shuffledOptions.findIndex((o) => o.isCorrect);

    return {
        id: token.id || `ans_${correctRow.id}`,
        mode: 'choice_from_entities',
        token,
        options: shuffledOptions,
        correctIndex,
        userSelectedIndex: null,
        meta: {
            correctRowId: correctRow.id
        }
    };
}

function buildChoiceUniqueProperty(token, correctRow, allRows, dataSetId) {
    const propertyFilter = token.answer && token.answer.propertyFilter;
    const choiceCount = token.answer && token.answer.choiceCount ? token.answer.choiceCount : 4;
    const matches = allRows.filter((row) => evaluateFilter(row, propertyFilter));
    if (!matches.find((row) => row.id === correctRow.id) || matches.length !== 1) {
        return null;
    }
    const distractorPool = allRows.filter(
        (row) => row.id !== correctRow.id && !evaluateFilter(row, propertyFilter)
    );
    if (distractorPool.length < choiceCount - 1) {
        return null;
    }
    const distractors = pickN(distractorPool, choiceCount - 1);
    const options = shuffled([
        {
            entityId: correctRow.id,
            isCorrect: true,
            displayKey: tokenDisplayKey(token, correctRow),
            labelTokens: optionLabelTokens(token),
            dataSetId
        },
        ...distractors.map((row) => ({
            entityId: row.id,
            isCorrect: false,
            displayKey: tokenDisplayKey(token, row),
            labelTokens: optionLabelTokens(token),
            dataSetId
        }))
    ]);
    const correctIndex = options.findIndex((o) => o.isCorrect);
    return {
        id: token.id || `ans_${correctRow.id}`,
        mode: 'choice_unique_property',
        token,
        options,
        correctIndex,
        userSelectedIndex: null,
        meta: {
            correctRowId: correctRow.id
        }
    };
}

function buildChoiceFromGroup(token, correctRow, dataSets, dataSetId, groupUsage) {
    const groupRef = token.answer.group || token.answer.groupId || token.group;
    const resolved = findGroupDefinition(dataSets, groupRef, dataSetId);
    if (!resolved || !resolved.group) return null;
    const groupId =
        (groupRef && typeof groupRef === 'object' && groupRef.groupId) ||
        (typeof groupRef === 'string' ? groupRef : '');
    const groupKey = `${resolved.dataSetId || dataSetId || 'groups'}::${groupId}`;
    const correctText = tokenTextFromToken(token, correctRow);
    const baseChoices = Array.isArray(resolved.group.choices) ? resolved.group.choices : [];
    const choices = baseChoices.includes(correctText)
        ? baseChoices.slice()
        : baseChoices.concat(correctText);
    let correctIndex = choices.findIndex((text) => text === correctText);
    if (correctIndex < 0) {
        correctIndex = choices.length - 1;
    }
    if (resolved.group.drawWithoutReplacement) {
        const used = groupUsage.get(groupKey) || new Set();
        const available = choices.map((_, idx) => idx).filter((idx) => !used.has(idx));
        if (!available.includes(correctIndex) && available.length > 0) {
            correctIndex = available[Math.floor(Math.random() * available.length)];
        }
        if (!available.length) {
            console.warn(`[quiz] Group ${groupKey} choices exhausted for drawWithoutReplacement.`);
        }
        used.add(correctIndex);
        groupUsage.set(groupKey, used);
    }
    const options = shuffled(
        choices.map((text, idx) => ({
            isCorrect: idx === correctIndex,
            label: text
        }))
    );
    const shuffledCorrect = options.findIndex((o) => o.isCorrect);
    return {
        id: token.id || `ans_${correctRow.id}`,
        mode: 'choice_from_group',
        token,
        options,
        correctIndex: shuffledCorrect,
        userSelectedIndex: null,
        meta: {
            correctRowId: correctRow.id
        }
    };
}

function buildAnswerPart(token, correctRow, rows, dataSets, dataSetId, groupUsage) {
    if (!token || !token.answer) return null;
    if (token.answer.mode === 'choice_unique_property') {
        return buildChoiceUniqueProperty(token, correctRow, rows, dataSetId);
    }
    if (token.answer.mode === 'choice_from_group') {
        return buildChoiceFromGroup(token, correctRow, dataSets, dataSetId, groupUsage);
    }
    return buildChoiceFromEntities(token, correctRow, rows, dataSetId);
}

function collectEligibleRowsForUniqueProperties(rows, tokens) {
    const propertyTokens = (tokens || []).filter(
        (t) => t && t.answer && t.answer.mode === 'choice_unique_property'
    );
    if (!propertyTokens.length) {
        return rows;
    }
    return rows.filter((row) => {
        return propertyTokens.every((token) => {
            const filter = token.answer.propertyFilter;
            const matches = rows.filter((r) => evaluateFilter(r, filter));
            return matches.length === 1 && matches[0].id === row.id;
        });
    });
}

function generateTableFillChoiceQuestion(pattern, dataSets) {
    const table = getDataSet(dataSets, pattern.dataSet);
    if (!table || table.type !== 'table') {
        return null;
    }
    const rows = getFilteredRows(table, pattern.entityFilter);
    const eligibleRows = collectEligibleRowsForUniqueProperties(rows, pattern.tokens || []);
    if (!eligibleRows.length) return null;
    const correctRow = randomChoice(eligibleRows);
    const answers = [];
    const groupUsage = new Map();
    (pattern.tokens || []).forEach((token) => {
        if (!token || !token.answer) return;
        const part = buildAnswerPart(
            token,
            correctRow,
            rows,
            dataSets,
            pattern.dataSet,
            groupUsage
        );
        if (part) {
            answers.push(part);
        }
    });
    if (!answers.length) return null;
    return {
        id: `q_${pattern.id}_${correctRow.id}`,
        patternId: pattern.id,
        format: 'table_fill_choice',
        tokens: pattern.tokens || [],
        patternTips: pattern.tips || [],
        answers,
        meta: {
            dataSetId: pattern.dataSet,
            entityId: correctRow.id
        }
    };
}

function generateTableMatchingQuestion(pattern, dataSets) {
    const table = getDataSet(dataSets, pattern.dataSet);
    if (!table || table.type !== 'table') {
        return null;
    }
    const spec = pattern.matchingSpec || {};
    const count = spec.count || 4;
    const leftField = spec.leftField || 'left';
    const rightField = spec.rightField || 'right';
    const rows = getFilteredRows(table, pattern.entityFilter);
    if (rows.length < count) return null;
    const selected = pickN(rows, count);
    const leftList = spec.shuffle && spec.shuffle.left ? shuffled(selected) : selected.slice();
    const rightValues = selected.map((row) => row[rightField]);
    const shuffledRight = spec.shuffle && spec.shuffle.right ? shuffled(rightValues) : rightValues;
    const answers = leftList.map((row) => {
        const correctText = row[rightField];
        const options = shuffledRight.map((text) => ({
            label: text,
            isCorrect: text === correctText
        }));
        const correctIndex = options.findIndex((o) => o.isCorrect);
        return {
            id: `${pattern.id}_${row.id}_match`,
            mode: 'matching_pairs_from_entities',
            options,
            correctIndex,
            userSelectedIndex: null,
            meta: {
                leftText: row[leftField],
                rightText: correctText
            }
        };
    });
    return {
        id: `q_${pattern.id}_match`,
        patternId: pattern.id,
        format: 'table_matching',
        tokens: pattern.tokens || [],
        patternTips: pattern.tips || [],
        answers,
        meta: {
            dataSetId: pattern.dataSet
        }
    };
}

function generateSentenceFillChoiceQuestion(pattern, dataSets) {
    const dataSet = getDataSet(dataSets, pattern.dataSet);
    if (!dataSet || dataSet.type !== 'factSentences') {
        return null;
    }
    if (pattern.tokensFromData !== 'sentences') {
        return null;
    }
    const sentences = getFilteredRows({ data: dataSet.sentences || [] }, pattern.entityFilter);
    if (!sentences.length) return null;
    const sentence = randomChoice(sentences);
    if (!sentence) return null;
    const answers = [];
    const groupUsage = new Map();
    const sentenceTokens = sentence.tokens || [];
    const questionTokens = (pattern.tokens && pattern.tokens.length)
        ? (pattern.tokens || []).concat(sentenceTokens)
        : sentenceTokens;
    sentenceTokens.forEach((token) => {
        if (!token || !token.answer) return;
        const part = buildAnswerPart(
            token,
            sentence,
            dataSet.sentences || [],
            dataSets,
            pattern.dataSet,
            groupUsage
        );
        if (part) {
            answers.push(part);
        }
    });
    if (!answers.length) return null;
    return {
        id: `q_${pattern.id}_${sentence.id}`,
        patternId: pattern.id,
        format: 'sentence_fill_choice',
        tokens: questionTokens,
        patternTips: pattern.tips || [],
        answers,
        meta: {
            dataSetId: pattern.dataSet,
            sentenceId: sentence.id
        }
    };
}

const GENERATORS = {
    table_fill_choice: generateTableFillChoiceQuestion,
    table_matching: generateTableMatchingQuestion,
    sentence_fill_choice: generateSentenceFillChoiceQuestion
};

export class QuizEngine {
    constructor(definition) {
        this.meta = definition.meta || {};
        this.dataSets = definition.dataSets || {};
        this.patterns = definition.patterns || [];
        this.modes = definition.modes || [];
        this.currentMode = null;
        this.currentWeights = { list: [], total: 0 };
    }

    setMode(modeId) {
        const mode = this.modes.find((m) => m.id === modeId) || this.modes[0];
        this.currentMode = mode;
        const weights = (mode && mode.patternWeights) || [];
        const list = [];
        let sum = 0;
        for (const pw of weights) {
            const pattern = this.patterns.find((p) => p.id === pw.patternId);
            if (!pattern) continue;
            sum += pw.weight;
            list.push({ pattern, cumulative: sum });
        }
        this.currentWeights = { list, total: sum };
    }

    choosePattern() {
        const w = this.currentWeights;
        if (!w || !w.list.length || !w.total) {
            return randomChoice(this.patterns);
        }
        const r = Math.random() * w.total;
        return w.list.find((x) => r < x.cumulative).pattern;
    }

    generateQuestion() {
        if (!this.patterns.length) {
            throw new Error('No patterns available');
        }
        let attempts = 0;
        while (attempts < 50) {
            attempts += 1;
            const pattern = this.choosePattern();
            if (!pattern) continue;
            const generator = GENERATORS[pattern.questionFormat];
            if (!generator) continue;
            const q = generator(pattern, this.dataSets);
            if (q) return q;
        }
        throw new Error('Failed to generate question after multiple attempts');
    }
}
