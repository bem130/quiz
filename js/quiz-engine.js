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
import { resolveSubTokenValue, tokensToPlainText } from './text-utils.js';

const DEFAULT_MAX_CONSECUTIVE_SKIPS = 20;
/**
 * Build version of quiz-engine module for runtime compatibility checks.
 * Use window.APP_VERSION when running in a browser so that the module
 * version automatically matches the server-side app version.
 */
export const QUIZ_ENGINE_VERSION =
    typeof window !== 'undefined' && window.APP_VERSION
        ? window.APP_VERSION
        : 'dev';

export class NoQuestionsAvailableError extends Error {
    constructor(message = 'No questions available for the selected mode or filters.') {
        super(message);
        this.name = 'NoQuestionsAvailableError';
    }
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
    if (token.type === 'content') {
        return token.value != null ? String(token.value) : '';
    }
    if (token.type === 'key') {
        if (!row || !token.field) return '';

        const value = row[token.field];

        // 1) 配列 → 各要素を tokenTextFromToken でたどる
        if (Array.isArray(value)) {
            return value
                .map((child) => tokenTextFromToken(child, row))
                .join('')
                .trim();
        }

        // 2) 単一トークンオブジェクト
        if (value && typeof value === 'object' && value.type) {
            return tokenTextFromToken(value, row).trim();
        }

        // 3) 文字列 / number
        return value != null ? String(value) : '';
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

function normalizeGroupChoice(rawChoice, row) {
    if (rawChoice == null) return null;

    // 1) Already an array of tokens
    if (Array.isArray(rawChoice)) {
        return {
            label: tokensToPlainText(rawChoice, row),
            labelTokens: rawChoice
        };
    }

    // 2) Single token object (text, katex, key, etc.)
    if (typeof rawChoice === 'object' && rawChoice.type) {
        return {
            label: tokenTextFromToken(rawChoice, row),
            labelTokens: [rawChoice]
        };
    }

    // 3) Primitive → use as plain text (legacy behavior)
    return {
        label: String(rawChoice),
        labelTokens: null
    };
}

function resolveConceptIdFromRow(row) {
    if (!row) return null;
    if (row.conceptId != null) return row.conceptId;
    if (row.meta && row.meta.conceptId != null) return row.meta.conceptId;
    if (row.entityId != null) return row.entityId;
    if (row.id != null) return row.id;
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

    // Debug: summary of choice config
    try {
        console.debug('[quiz][buildChoiceFromEntities] choiceCount:', choiceCount, 'avoidSameId:', avoidSameId, 'avoidSameText:', avoidSameText, 'correctKey:', JSON.stringify(correctKey), 'tokenType:', token && token.type);
        if (token && token.answer && token.answer.choice && token.answer.choice.distractorSource) {
            console.debug('[quiz][buildChoiceFromEntities] distractorSource:', token.answer.choice.distractorSource);
        }
    } catch (e) {}
    const distractors = [];
    let safety = 2000;
    while (distractors.length < choiceCount - 1 && safety > 0) {
        safety -= 1;
        const candidate = randomChoice(pool);
        if (!candidate) {
            try {
                console.debug('[quiz][buildChoiceFromEntities] candidate: null - pool exhausted or randomChoice returned falsy');
            } catch (e) {}
            break;
        }

        // compute key early for logging
        let key = '';
        try {
            key = tokenDisplayKey(token, candidate);
        } catch (e) {
            key = '';
        }

        try {
            console.debug('[quiz][buildChoiceFromEntities] trying candidate:', candidate && candidate.id, 'key:', JSON.stringify(key));
        } catch (e) {}

        if (avoidSameId && usedIds.has(candidate.id)) {
            try {
                console.debug('[quiz][buildChoiceFromEntities] skip candidate (same id):', candidate && candidate.id);
            } catch (e) {}
            continue;
        }

        if (avoidSameText && usedText.has(key)) {
            try {
                console.debug('[quiz][buildChoiceFromEntities] skip candidate (same text):', candidate && candidate.id, 'key:', JSON.stringify(key));
            } catch (e) {}
            continue;
        }

        distractors.push(candidate);
        usedIds.add(candidate.id);
        usedText.add(key);
        try {
            console.debug('[quiz][buildChoiceFromEntities] accepted distractor:', candidate && candidate.id, 'currentDistractors:', distractors.map((d) => d && d.id));
        } catch (e) {}
    }

    // Debug: log distractor discovery
    try {
        console.debug('[quiz][buildChoiceFromEntities] tokenId:', token && token.id, 'dataSetId:', dataSetId, 'correctRowId:', correctRow && correctRow.id, 'poolSize:', pool.length);
        console.debug('[quiz][buildChoiceFromEntities] distractors count:', distractors.length, 'ids:', distractors.map((d) => d && d.id));
    } catch (e) {
        // ignore logging errors
    }

    const optionEntities = [
        {
            entityId: correctRow.id,
            conceptId: resolveConceptIdFromRow(correctRow),
            isCorrect: true,
            displayKey: correctKey,
            labelTokens: optionLabelTokens(token),
            dataSetId
        },
        ...distractors.map((row) => ({
            entityId: row.id,
            conceptId: resolveConceptIdFromRow(row),
            isCorrect: false,
            displayKey: tokenDisplayKey(token, row),
            labelTokens: optionLabelTokens(token),
            dataSetId
        }))
    ];

    // Debug: dump option entities (lightweight view)
    try {
        console.debug('[quiz][buildChoiceFromEntities] optionEntities (pre-shuffle):', optionEntities.map((o) => ({
            entityId: o && o.entityId,
            isCorrect: !!(o && o.isCorrect),
            displayKey: o && o.displayKey
        })));
    } catch (e) {}

    const shuffledOptions = shuffled(optionEntities);
    const correctIndex = shuffledOptions.findIndex((o) => o.isCorrect);

    try {
        console.debug('[quiz][buildChoiceFromEntities] shuffledOptions:', shuffledOptions.map((o) => ({ entityId: o && o.entityId, isCorrect: !!(o && o.isCorrect), displayKey: o && o.displayKey })), 'correctIndex:', correctIndex);
    } catch (e) {}

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
            conceptId: resolveConceptIdFromRow(correctRow),
            isCorrect: true,
            displayKey: tokenDisplayKey(token, correctRow),
            labelTokens: optionLabelTokens(token),
            dataSetId
        },
        ...distractors.map((row) => ({
            entityId: row.id,
            conceptId: resolveConceptIdFromRow(row),
            isCorrect: false,
            displayKey: tokenDisplayKey(token, row),
            labelTokens: optionLabelTokens(token),
            dataSetId
        }))
    ]);
    const correctIndex = options.findIndex((o) => o.isCorrect);
    try {
        console.debug('[quiz][buildChoiceUniqueProperty] tokenId:', token && token.id, 'dataSetId:', dataSetId, 'correctRowId:', correctRow && correctRow.id);
        console.debug('[quiz][buildChoiceUniqueProperty] distractors count:', distractors.length, 'ids:', distractors.map((d) => d && d.id));
        console.debug('[quiz][buildChoiceUniqueProperty] options:', options.map((o) => ({ entityId: o && o.entityId, isCorrect: !!(o && o.isCorrect), displayKey: o && o.displayKey })), 'correctIndex:', correctIndex);
    } catch (e) {}
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

    // 正答の「テキストキー」を、従来通り tokenTextFromToken から取る
    const correctText = tokenTextFromToken(token, correctRow);

    // ① group.choices をすべて正規化（string / token どちらもOK）
    const rawBaseChoices = Array.isArray(resolved.group.choices)
        ? resolved.group.choices
        : [];

    const baseChoices = rawBaseChoices
        .map((c) => normalizeGroupChoice(c, correctRow))
        .filter((c) => c && typeof c.label === 'string');

    // ② group にすでに正答が含まれているかどうかを判定
    let correctIndex = baseChoices.findIndex((c) => c.label === correctText);
    let choices = baseChoices;

    if (correctIndex < 0) {
        // group 側に正答が無い場合は、従来通り末尾に追加
        let labelTokens = null;

        // hide トークン側に value があれば、それをそのまま labelTokens に使う
        if (token.value) {
            labelTokens = Array.isArray(token.value) ? token.value : [token.value];
        }

        choices = baseChoices.concat({
            label: correctText,
            labelTokens
        });
        correctIndex = choices.length - 1;
    }

    // ③ drawWithoutReplacement が指定されている場合は、
    //    「どの choice を正答にするか」の index だけを調整する
    if (resolved.group.drawWithoutReplacement) {
        const used = groupUsage.get(groupKey) || new Set();
        const available = choices
            .map((_, idx) => idx)
            .filter((idx) => !used.has(idx));

        if (!available.includes(correctIndex) && available.length > 0) {
            // まだ使われていない index からランダムに正答を選び直す
            correctIndex = available[Math.floor(Math.random() * available.length)];
        }

        if (!available.length) {
            console.warn(
                `[quiz] Group ${groupKey} choices exhausted for drawWithoutReplacement.`
            );
        }

        used.add(correctIndex);
        groupUsage.set(groupKey, used);
    }

    // ④ options を生成
    const options = shuffled(
        choices.map((choice, idx) => ({
            isCorrect: idx === correctIndex,
            entityId: idx === correctIndex ? correctRow.id : null,
            conceptId: idx === correctIndex ? resolveConceptIdFromRow(correctRow) : null,
            label: choice.label,
            labelTokens: choice.labelTokens || null
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

    const rawSpec = pattern.matchingSpec || {};

    // count: spec.count / spec.pairCount のどちらでも指定できるようにする
    const count =
        (typeof rawSpec.count === 'number' && rawSpec.count > 0
            ? rawSpec.count
            : typeof rawSpec.pairCount === 'number' && rawSpec.pairCount > 0
                ? rawSpec.pairCount
                : 4);

    const leftField = rawSpec.leftField || 'left';
    const rightField = rawSpec.rightField || 'right';

    // シャッフル設定は複数の書き方に対応
    const shuffleLeft =
        (rawSpec.shuffle && rawSpec.shuffle.left) ||
        rawSpec.shuffleLeft ||
        false;

    const shuffleRight =
        (rawSpec.shuffle && rawSpec.shuffle.right) ||
        rawSpec.shuffleRight ||
        false;

    const rows = getFilteredRows(table, pattern.entityFilter);
    if (rows.length < count) return null;

    // --------------------------------------------------
    // 1:1 対応を作るために、右側の値が重複しないように行を選ぶ
    // --------------------------------------------------
    const shuffledRows = shuffled(rows);
    const selected = [];
    const usedRightValues = new Set();

    for (const row of shuffledRows) {
        const val = row[rightField];
        if (val == null) continue;
        if (usedRightValues.has(val)) {
            continue;
        }
        selected.push(row);
        usedRightValues.add(val);
        if (selected.length === count) break;
    }

    // 指定数揃わなければ、このパターンではマッチングを作らない
    if (selected.length < count) {
        console.warn(
            '[quiz][table_matching] 1:1 対応を作れなかったのでスキップします:',
            {
                patternId: pattern.id,
                rightField,
                requestedCount: count,
                uniqueRightCount: usedRightValues.size
            }
        );
        return null;
    }

    // 左側だけシャッフルするかどうか
    const leftList = shuffleLeft ? shuffled(selected) : selected.slice();

    // 右側は「選ばれた行の rightField」だけを使う（1:1）
    const rightValues = selected.map((row) => row[rightField]);
    const shuffledRight = shuffleRight ? shuffled(rightValues) : rightValues;

    // 右側フィールドが "Tex" で終わるなら KaTeX 用とみなす
    const isTexField =
        typeof rightField === 'string' && /tex$/i.test(rightField);

    const answers = leftList.map((row) => {
        const correctText = row[rightField];
        const options = shuffledRight.map((value) => {
            const isCorrect = value === correctText;
            const base = {
                id: `${pattern.id}_${row.id}_${String(value)}`,
                label: String(value),
                isCorrect
            };

            if (isTexField) {
                // KaTeX 用フィールドのときは labelTex として扱う
                base.labelTex = String(value);
                delete base.label;
            }

            return base;
        });

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
        id: pattern.id,
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

    // Map token ID to answer index for group processing
    const tokenIdToAnswerIndex = new Map();

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
            const idx = answers.length;
            answers.push(part);
            if (token.id) {
                tokenIdToAnswerIndex.set(token.id, idx);
            }
        }
    });
    if (!answers.length) return null;

    // Process unordered answer groups
    let unorderedAnswerGroups = [];
    if (Array.isArray(sentence.unorderedAnswerGroups)) {
        unorderedAnswerGroups = sentence.unorderedAnswerGroups
            .map((groupIds) => {
                if (!Array.isArray(groupIds)) return null;
                const indices = groupIds
                    .map((id) => tokenIdToAnswerIndex.get(id))
                    .filter((idx) => typeof idx === 'number');
                return indices.length >= 2 ? indices : null;
            })
            .filter((g) => g !== null);
    }

    return {
        id: `q_${pattern.id}_${sentence.id}`,
        patternId: pattern.id,
        format: 'sentence_fill_choice',
        tokens: questionTokens,
        patternTips: pattern.tips || [],
        answers,
        meta: {
            dataSetId: pattern.dataSet,
            sentenceId: sentence.id,
            unorderedAnswerGroups: unorderedAnswerGroups.length > 0 ? unorderedAnswerGroups : undefined
        }
    };
}

const GENERATORS = {
    table_fill_choice: generateTableFillChoiceQuestion,
    table_matching: generateTableMatchingQuestion,
    sentence_fill_choice: generateSentenceFillChoiceQuestion
};

export class QuizEngine {
    constructor(definition, options = {}) {
        this.meta = definition.meta || {};
        this.dataSets = definition.dataSets || {};
        this.patterns = definition.patterns || [];
        this.modes = definition.modes || [];
        this.currentMode = null;
        this.currentWeights = { list: [], total: 0 };
        this.maxConsecutiveSkips =
            typeof options.maxConsecutiveSkips === 'number'
                ? options.maxConsecutiveSkips
                : DEFAULT_MAX_CONSECUTIVE_SKIPS;
        this._patternCapacityCache = null;
    }

    /**
     * Build and cache the per-pattern capacity map for the current quiz definition.
     * @returns {Map<string, number>}
     */
    _ensurePatternCapacityMap() {
        if (this._patternCapacityCache) {
            return this._patternCapacityCache;
        }

        const map = new Map();
        for (const pattern of this.patterns) {
            if (!pattern || !pattern.id) {
                continue;
            }
            map.set(pattern.id, this._estimatePatternCapacity(pattern));
        }
        this._patternCapacityCache = map;
        return map;
    }

    /**
     * Estimate how many questions a single pattern can generate.
     * @param {object} pattern
     * @returns {number}
     */
    _estimatePatternCapacity(pattern) {
        const dataSet = getDataSet(this.dataSets, pattern.dataSet);
        if (!dataSet) {
            return 0;
        }

        if (dataSet.type === 'table') {
            const rows = getFilteredRows(dataSet, pattern.entityFilter);
            const spec = pattern.matchingSpec || {};
            const pairCount =
                typeof spec.pairCount === 'number' && spec.pairCount > 0
                    ? spec.pairCount
                    : typeof spec.count === 'number' && spec.count > 0
                        ? spec.count
                        : 0;

            if (pattern.questionFormat === 'table_matching' && pairCount > 0) {
                return Math.floor(rows.length / pairCount);
            }
            return rows.length;
        }

        if (dataSet.type === 'factSentences' && pattern.tokensFromData === 'sentences') {
            const sentences = getFilteredRows(
                { data: dataSet.sentences || [] },
                pattern.entityFilter
            );
            return sentences.length;
        }

        return 0;
    }

    /**
     * Retrieve capacity for a specific pattern id.
     * @param {string} patternId
     * @returns {number}
     */
    getPatternCapacity(patternId) {
        if (!patternId) {
            return 0;
        }
        const map = this._ensurePatternCapacityMap();
        return map.get(patternId) || 0;
    }

    /**
     * Return the cached pattern capacity map.
     * @returns {Map<string, number>}
     */
    getAllPatternCapacities() {
        return this._ensurePatternCapacityMap();
    }

    /**
     * Estimate how many questions can be generated for the specified mode.
     * This heuristic counts eligible rows in datasets after applying filters
     * and returns a rough availability total.
     * @param {string} modeId
     * @returns {number}
     */
    estimateModeCapacity(modeId) {
        const mode = this.modes.find((m) => m.id === modeId);
        if (!mode || !Array.isArray(mode.patternWeights)) {
            return 0;
        }

        const capacities = this._ensurePatternCapacityMap();
        const uniqueIds = new Set();

        for (const pw of mode.patternWeights) {
            if (pw && pw.patternId) {
                uniqueIds.add(pw.patternId);
            }
        }

        let total = 0;
        for (const id of uniqueIds) {
            total += capacities.get(id) || 0;
        }

        return total;
    }

    setMode(modeId) {
        const mode = this.modes.find((m) => m.id === modeId) || this.modes[0];
        this.currentMode = mode;

        // Fallback: if mode has no patternWeights, use uniform weights across all patterns.
        const rawWeights = (mode && Array.isArray(mode.patternWeights))
            ? mode.patternWeights
            : this.patterns.map((p) => ({ patternId: p.id, weight: 1 }));

        const list = [];
        let sum = 0;

        for (const pw of rawWeights) {
            if (!pw || !pw.patternId || typeof pw.weight !== 'number' || pw.weight <= 0) {
                continue;
            }
            const pattern = this.patterns.find((p) => p.id === pw.patternId);
            if (!pattern) {
                continue;
            }
            sum += pw.weight;
            list.push({
                pattern,
                patternId: pattern.id,
                weight: pw.weight,
                cumulative: sum
            });
        }

        if (list.length === 0 || sum <= 0) {
            console.warn('[quiz][mode] No valid patternWeights for mode. Falling back to uniform.', {
                requestedModeId: modeId,
                resolvedModeId: mode && mode.id,
                availablePatternIds: this.patterns.map((p) => p.id)
            });

            const uniformList = [];
            let uniformSum = 0;
            for (const pattern of this.patterns) {
                uniformSum += 1;
                uniformList.push({
                    pattern,
                    patternId: pattern.id,
                    weight: 1,
                    cumulative: uniformSum
                });
            }
            this.currentWeights = { list: uniformList, total: uniformSum };
            return;
        }

        this.currentWeights = { list, total: sum };

        console.log('[quiz][mode] Mode configured:', {
            modeId: mode && mode.id,
            modeLabel: mode && mode.label,
            totalWeight: sum,
            patternWeights: list.map((entry) => ({
                patternId: entry.patternId,
                patternLabel: entry.pattern.label,
                weight: entry.weight,
                cumulative: entry.cumulative
            }))
        });
    }

    /**
     * Set the engine to a special mode that only uses a single pattern.
     * This is used for testing patterns individually in Draft mode.
     * @param {string} patternId
     */
    setSinglePatternMode(patternId) {
        const pattern = this.patterns.find((p) => p.id === patternId);
        if (!pattern) {
            console.warn(`[quiz] Pattern not found: ${patternId}`);
            return;
        }

        // Create a synthetic mode for this pattern
        this.currentMode = {
            id: `__pattern__${patternId}`,
            label: `Pattern: ${pattern.label || pattern.id}`,
            patternWeights: [{ patternId: pattern.id, weight: 1 }]
        };

        // Set weights to 100% for this pattern
        const list = [{
            pattern,
            patternId: pattern.id,
            weight: 1,
            cumulative: 1
        }];

        this.currentWeights = { list, total: 1 };
        console.log(`[quiz] Set single pattern mode: ${patternId}`);
    }

    choosePattern() {
        const w = this.currentWeights;
        if (!w || !w.list.length || !w.total) {
            const pattern = randomChoice(this.patterns);
            console.warn('[quiz][pattern] Using uniform fallback pattern choice:', {
                modeId: this.currentMode && this.currentMode.id,
                patternId: pattern && pattern.id,
                patternLabel: pattern && pattern.label
            });
            return pattern;
        }

        const r = Math.random() * w.total;
        const chosen = w.list.find((x) => r < x.cumulative);

        if (!chosen) {
            const pattern = randomChoice(this.patterns);
            console.warn('[quiz][pattern] No pattern matched random value, using uniform fallback:', {
                modeId: this.currentMode && this.currentMode.id,
                randomValue: r,
                totalWeight: w.total
            });
            return pattern;
        }

        console.log('[quiz][pattern] Pattern chosen:', {
            modeId: this.currentMode && this.currentMode.id,
            patternId: chosen.pattern.id,
            patternLabel: chosen.pattern.label,
            randomValue: r,
            totalWeight: w.total,
            weights: w.list.map((entry) => ({
                patternId: entry.pattern.id,
                cumulative: entry.cumulative
            }))
        });

        return chosen.pattern;
    }

    generateQuestion() {
        if (!this.patterns.length) {
            throw new Error('No patterns available');
        }
        let skips = 0;
        while (skips < this.maxConsecutiveSkips) {
            const pattern = this.choosePattern();
            if (!pattern) {
                skips += 1;
                continue;
            }
            const generator = GENERATORS[pattern.questionFormat];
            if (!generator) {
                skips += 1;
                continue;
            }
            const q = generator(pattern, this.dataSets);
            if (q) return q;
            skips += 1;
        }
        throw new NoQuestionsAvailableError();
    }
}
