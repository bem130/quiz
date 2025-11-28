// js/quiz-engine.js
import { evaluateFilter } from './filters.js';
import { getDataSet, getFilteredRows, randomChoice, pickN, shuffled } from './dataset-utils.js';

function tokenDisplayKey(token, row) {
    if (!token || !row) return '';
    if (token.type === 'hideruby') {
        const base = token.base || {};
        const ruby = token.ruby || {};
        const baseText = base.source === 'key' ? row[base.field] : base.value;
        const rubyText = ruby.source === 'key' ? row[ruby.field] : ruby.value;
        return `${baseText || ''}|||${rubyText || ''}`;
    }
    if (token.field && typeof row[token.field] === 'string') {
        return row[token.field];
    }
    if (token.value) {
        return token.value;
    }
    return row.nameEnCap || row.nameEn || '';
}

function optionLabelTokens(token) {
    if (!token) return null;
    const answerMode = token.answer && token.answer.mode;
    if (
        answerMode === 'choice_ruby_pair' &&
        (token.type === 'hideruby' || token.type === 'ruby')
    ) {
        return [token];
    }
    if (token.type === 'hide' && token.field) {
        return [
            {
                type: 'key',
                field: token.field,
                styles: token.styles || []
            }
        ];
    }
    if (token.type === 'key') {
        return [token];
    }
    return null;
}

function buildChoiceFromEntities(token, correctRow, poolRows) {
    const choiceCfg = (token.answer && token.answer.choice) || {};
    const ds = choiceCfg.distractorSource || {};
    const count = typeof ds.count === 'number' ? ds.count : 3;
    const avoidSameId = ds.avoidSameId !== false;
    const avoidSameText = ds.avoidSameText !== false;

    const correctKey = tokenDisplayKey(token, correctRow);
    const usedIds = new Set([correctRow.id]);
    const usedText = new Set([correctKey]);
    const distractors = [];
    let safety = 2000;
    while (distractors.length < count && safety > 0) {
        safety -= 1;
        const candidate = randomChoice(poolRows);
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
            labelTokens: optionLabelTokens(token)
        },
        ...distractors.map((row) => ({
            entityId: row.id,
            isCorrect: false,
            displayKey: tokenDisplayKey(token, row),
            labelTokens: optionLabelTokens(token)
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

function buildChoiceUniqueProperty(token, correctRow, allRows) {
    const propertyFilter = token.answer && token.answer.propertyFilter;
    const choiceCount = token.answer && token.answer.choiceCount ? token.answer.choiceCount : 4;
    if (!evaluateFilter(correctRow, propertyFilter)) {
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
            labelTokens: optionLabelTokens(token)
        },
        ...distractors.map((row) => ({
            entityId: row.id,
            isCorrect: false,
            displayKey: tokenDisplayKey(token, row),
            labelTokens: optionLabelTokens(token)
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

function resolveGroupFromToken(token, dataSets, dataSetId) {
    if (!token || !Array.isArray(token.array)) return null;
    const root = getDataSet(dataSets, dataSetId);
    let ref = root;
    for (const segment of token.array) {
        if (ref && Object.prototype.hasOwnProperty.call(ref, segment)) {
            ref = ref[segment];
        } else {
            ref = null;
            break;
        }
    }
    if (ref && Array.isArray(ref.choices)) {
        return ref;
    }
    return null;
}

function buildChoiceFromGroup(token, correctRow, dataSets, dataSetId) {
    const group = resolveGroupFromToken(token, dataSets, dataSetId);
    if (!group) return null;
    const correctText = token.value || (token.field ? correctRow[token.field] : '');
    const baseChoices = group.choices || [];
    const choices = baseChoices.includes(correctText)
        ? baseChoices.slice()
        : baseChoices.concat(correctText);
    const options = shuffled(
        choices.map((text) => ({
            isCorrect: text === correctText,
            label: text
        }))
    );
    const correctIndex = options.findIndex((o) => o.isCorrect);
    return {
        id: token.id || `ans_${correctRow.id}`,
        mode: 'choice_from_group',
        token,
        options,
        correctIndex,
        userSelectedIndex: null,
        meta: {
            correctRowId: correctRow.id
        }
    };
}

function buildAnswerPart(token, correctRow, rows, dataSets, dataSetId) {
    if (!token || !token.answer) return null;
    if (token.answer.mode === 'choice_unique_property') {
        return buildChoiceUniqueProperty(token, correctRow, rows);
    }
    if (token.answer.mode === 'choice_from_group') {
        return buildChoiceFromGroup(token, correctRow, dataSets, dataSetId);
    }
    return buildChoiceFromEntities(token, correctRow, rows);
}

function generateTableFillChoiceQuestion(pattern, dataSets) {
    const table = getDataSet(dataSets, pattern.dataSet);
    if (!table || table.type !== 'table') {
        return null;
    }
    const rows = getFilteredRows(table, pattern.entityFilter);
    if (!rows.length) return null;
    const correctRow = randomChoice(rows);
    const answers = [];
    (pattern.tokens || []).forEach((token) => {
        if (!token || !token.answer) return;
        const part = buildAnswerPart(token, correctRow, rows, dataSets, pattern.dataSet);
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
    const sentence = randomChoice(dataSet.sentences || []);
    if (!sentence) return null;
    const answers = [];
    (sentence.tokens || []).forEach((token) => {
        if (!token || !token.answer) return;
        const part = buildAnswerPart(token, token, dataSet.sentences || [], dataSets, pattern.dataSet);
        if (part) {
            answers.push(part);
        }
    });
    if (!answers.length) return null;
    return {
        id: `q_${pattern.id}_${sentence.id}`,
        patternId: pattern.id,
        format: 'sentence_fill_choice',
        tokens: sentence.tokens || [],
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
