// js/quiz-engine.js
import { getDataSet, getFilteredRows, randomChoice, shuffled } from './dataset-utils.js';
import { tokensToPlainText } from './text-utils.js';

const DEFAULT_MAX_CONSECUTIVE_SKIPS = 20;
const CHOICE_COUNT = 4;

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

function normalizeTokenArray(value) {
    if (value == null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    return [value];
}

function normalizeTokenMatrix(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((entry) => normalizeTokenArray(entry));
}

function resolveConceptIdFromRow(row) {
    if (!row) return null;
    if (row.conceptId != null) return row.conceptId;
    if (row.meta && row.meta.conceptId != null) return row.meta.conceptId;
    if (row.entityId != null) return row.entityId;
    if (row.id != null) return row.id;
    return null;
}

function replaceListKeyToken(tokens, listIndex, replacementTokens) {
    const head = tokens.slice(0, listIndex);
    const tail = tokens.slice(listIndex + 1);
    return head.concat(replacementTokens, tail);
}

function resolveHideValue(tokens, row) {
    const normalized = normalizeTokenArray(tokens);
    const listKeyIndex = normalized.findIndex(
        (token) => token && typeof token === 'object' && token.type === 'listkey'
    );

    if (listKeyIndex < 0) {
        const text = tokensToPlainText(normalized, row);
        return {
            listKeyIndex: null,
            answerTokens: normalized,
            correctSet: new Set([text])
        };
    }

    const listToken = normalized[listKeyIndex];
    const listEntries = normalizeTokenMatrix(row ? row[listToken.field] : null);

    if (!listEntries.length) {
        return {
            listKeyIndex,
            answerTokens: normalized,
            correctSet: new Set()
        };
    }

    const templates = listEntries.map((entryTokens) =>
        replaceListKeyToken(normalized, listKeyIndex, entryTokens)
    );

    const correctSet = new Set(
        templates.map((entryTokens) => tokensToPlainText(entryTokens, row))
    );

    const selected = randomChoice(listEntries);
    const answerTokens = replaceListKeyToken(normalized, listKeyIndex, selected);

    return {
        listKeyIndex,
        answerTokens,
        correctSet
    };
}

function buildOptionTokensForRow(baseTokens, listKeyIndex, row, correctSet) {
    if (listKeyIndex == null) {
        const text = tokensToPlainText(baseTokens, row);
        if (correctSet.has(text)) {
            return null;
        }
        return {
            tokens: baseTokens,
            text
        };
    }

    const listToken = baseTokens[listKeyIndex];
    const entries = normalizeTokenMatrix(row ? row[listToken.field] : null);
    if (!entries.length) {
        return null;
    }

    const candidates = entries
        .map((entryTokens) => {
            const expanded = replaceListKeyToken(baseTokens, listKeyIndex, entryTokens);
            return {
                tokens: expanded,
                text: tokensToPlainText(expanded, row)
            };
        })
        .filter((candidate) => !correctSet.has(candidate.text));

    if (!candidates.length) {
        return null;
    }

    return randomChoice(candidates);
}

function buildChoiceFromEntities(token, correctRow, poolRows, dataSetId) {
    const listResult = resolveHideValue(token.value, correctRow);
    if (listResult.correctSet.size === 0) {
        return null;
    }

    const baseTokens = normalizeTokenArray(token.value);
    const correctLabelTokens = listResult.answerTokens;
    const correctKey = tokensToPlainText(correctLabelTokens, correctRow);

    const groupField = token.answer && token.answer.distractorSource
        ? token.answer.distractorSource.groupField
        : null;
    const groupValue = groupField && correctRow ? correctRow[groupField] : null;

    const hasGroupFilter = groupField && groupValue != null;
    const pool = Array.isArray(poolRows)
        ? hasGroupFilter
            ? poolRows.filter((row) => {
                if (!row) return false;
                if (row.id === correctRow.id) return false;
                if (row[groupField] === groupValue) {
                    return false;
                }
                return true;
            })
            : poolRows
        : [];

    const usedIds = new Set([correctRow.id]);
    const usedText = new Set([correctKey]);
    const distractors = [];

    const maxAttempts = Math.max(40, pool.length * 4);
    let attempts = 0;

    if (hasGroupFilter) {
        while (distractors.length < CHOICE_COUNT - 1 && pool.length > 0 && attempts < maxAttempts) {
            attempts += 1;
            const index = Math.floor(Math.random() * pool.length);
            const candidate = pool[index];
            if (!candidate) {
                pool.splice(index, 1);
                continue;
            }

            if (usedIds.has(candidate.id)) {
                pool.splice(index, 1);
                continue;
            }

            const candidateTokens = buildOptionTokensForRow(
                baseTokens,
                listResult.listKeyIndex,
                candidate,
                listResult.correctSet
            );

            if (!candidateTokens) {
                pool.splice(index, 1);
                continue;
            }

            if (usedText.has(candidateTokens.text)) {
                pool.splice(index, 1);
                continue;
            }

            distractors.push({ row: candidate, labelTokens: candidateTokens.tokens, text: candidateTokens.text });
            usedIds.add(candidate.id);
            usedText.add(candidateTokens.text);
            pool.splice(index, 1);
        }
    } else {
        while (distractors.length < CHOICE_COUNT - 1 && pool.length > 0 && attempts < maxAttempts) {
            attempts += 1;
            const candidate = pool[Math.floor(Math.random() * pool.length)];
            if (!candidate) {
                continue;
            }
            if (usedIds.has(candidate.id)) {
                continue;
            }

            const candidateTokens = buildOptionTokensForRow(
                baseTokens,
                listResult.listKeyIndex,
                candidate,
                listResult.correctSet
            );

            if (!candidateTokens) {
                continue;
            }

            if (usedText.has(candidateTokens.text)) {
                continue;
            }

            distractors.push({ row: candidate, labelTokens: candidateTokens.tokens, text: candidateTokens.text });
            usedIds.add(candidate.id);
            usedText.add(candidateTokens.text);
        }
    }

    if (distractors.length === 0) {
        return null;
    }

    const options = shuffled([
        {
            entityId: correctRow.id,
            conceptId: resolveConceptIdFromRow(correctRow),
            isCorrect: true,
            displayKey: correctKey,
            labelTokens: correctLabelTokens,
            dataSetId
        },
        ...distractors.map((entry) => ({
            entityId: entry.row.id,
            conceptId: resolveConceptIdFromRow(entry.row),
            isCorrect: false,
            displayKey: entry.text,
            labelTokens: entry.labelTokens,
            dataSetId
        }))
    ]);

    const correctIndex = options.findIndex((o) => o.isCorrect);

    return {
        id: token.id || `ans_${correctRow.id}`,
        mode: 'choice_from_entities',
        token,
        options,
        correctIndex,
        userSelectedIndex: null,
        meta: {
            correctRowId: correctRow.id
        }
    };
}

function findHideToken(tokens) {
    const list = normalizeTokenArray(tokens);
    return list.find((token) => token && typeof token === 'object' && token.type === 'hide') || null;
}

function generateTableFillChoiceQuestion(pattern, dataSets) {
    const table = getDataSet(dataSets, pattern.dataSet);
    if (!table || table.type !== 'table') {
        return null;
    }

    const rows = getFilteredRows(table);
    if (!rows.length) return null;

    const correctRow = randomChoice(rows);
    if (!correctRow) return null;

    const hideToken = findHideToken(pattern.tokens || []);
    if (!hideToken || !hideToken.answer) return null;

    const answer = buildChoiceFromEntities(hideToken, correctRow, rows, pattern.dataSet);
    if (!answer) return null;

    return {
        id: `${pattern.id}::${correctRow.id}`,
        patternId: pattern.id,
        format: 'table_fill_choice',
        tokens: pattern.tokens || [],
        patternTips: pattern.tips || [],
        answers: [answer],
        meta: {
            dataSetId: pattern.dataSet,
            entityId: correctRow.id,
            patternId: pattern.id
        }
    };
}

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

    _estimatePatternCapacity(pattern) {
        const dataSet = getDataSet(this.dataSets, pattern.dataSet);
        if (!dataSet) {
            return 0;
        }

        if (dataSet.type === 'table') {
            const rows = getFilteredRows(dataSet);
            return rows.length;
        }

        return 0;
    }

    getPatternCapacity(patternId) {
        if (!patternId) {
            return 0;
        }
        const map = this._ensurePatternCapacityMap();
        return map.get(patternId) || 0;
    }

    getAllPatternCapacities() {
        return this._ensurePatternCapacityMap();
    }

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
    }

    setSinglePatternMode(patternId) {
        const pattern = this.patterns.find((p) => p.id === patternId);
        if (!pattern) {
            console.warn(`[quiz] Pattern not found: ${patternId}`);
            return;
        }

        this.currentMode = {
            id: `__pattern__${patternId}`,
            label: `Pattern: ${pattern.label || pattern.id}`,
            patternWeights: [{ patternId: pattern.id, weight: 1 }]
        };

        this.currentWeights = {
            list: [{ pattern, patternId: pattern.id, weight: 1, cumulative: 1 }],
            total: 1
        };
    }

    choosePattern() {
        const w = this.currentWeights;
        if (!w || !w.list.length || !w.total) {
            return randomChoice(this.patterns);
        }

        const r = Math.random() * w.total;
        const chosen = w.list.find((x) => r < x.cumulative);

        if (!chosen) {
            return randomChoice(this.patterns);
        }

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
            const q = generateTableFillChoiceQuestion(pattern, this.dataSets);
            if (q) return q;
            skips += 1;
        }
        throw new NoQuestionsAvailableError();
    }
}
