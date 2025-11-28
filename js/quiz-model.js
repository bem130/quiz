// js/quiz-model.js
import { getQuizNameFromLocation, resolveQuizJsonFromEntry, resolveQuizJsonPath } from './config.js';

const ALLOWED_DATASET_TYPES = new Set(['table', 'factSentences', 'groups']);
const ALLOWED_FORMATS = new Set([
    'table_fill_choice',
    'table_matching',
    'sentence_fill_choice'
]);

function cloneData(value) {
    if (value == null) {
        return value;
    }
    return JSON.parse(JSON.stringify(value));
}

function normalizeMeta(json) {
    return {
        id: json.id || json.title || 'quiz',
        title: json.title || json.id || 'quiz',
        description: json.description || '',
        colorHue: json.color,
        version: json.version || 2
    };
}

function warnUnknownKeys(obj, allowedKeys, label) {
    Object.keys(obj || {}).forEach((key) => {
        if (!allowedKeys.has(key)) {
            console.warn(`[quiz] Unknown key in ${label}: ${key}`);
        }
    });
}

function convertTokenValue(tokenValue, options) {
    if (Array.isArray(tokenValue)) {
        return tokenValue.map((child) => convertTokenToV2(child, options));
    }
    if (tokenValue && typeof tokenValue === 'object' && tokenValue.type) {
        return convertTokenToV2(tokenValue, options);
    }
    return tokenValue;
}

function convertTokenToV2(token, options = {}) {
    if (!token || typeof token !== 'object') {
        return token;
    }

    if (token.type === 'hideruby' && options.allowHiderubyConversion !== false) {
        const converted = {
            ...token,
            type: 'hide',
            value: {
                type: 'ruby',
                base: token.base,
                ruby: token.ruby,
                styles: token.styles || []
            }
        };
        converted.value = convertTokenValue(converted.value, options);
        return converted;
    }

    const converted = {
        ...token
    };

    if (converted.type === 'hide' && options.convertHideField && !converted.value && converted.field) {
        converted.value = {
            type: 'key',
            field: converted.field,
            styles: converted.styles || []
        };
    }

    converted.value = convertTokenValue(converted.value, options);
    return converted;
}

function convertTokenArrayToV2(tokens, options = {}) {
    return (tokens || []).map((token) => convertTokenToV2(token, options));
}

function convertTipsToV2(tips, options = {}) {
    return (tips || []).map((tip) => ({
        ...tip,
        tokens: convertTokenArrayToV2(tip.tokens, options)
    }));
}

function convertEntitySetToDataSet(entitySet) {
    if (!entitySet || !entitySet.entities) {
        return {};
    }

    const id = entitySet.id || 'entity-set';
    const data = Object.entries(entitySet.entities).map(([entityId, value]) => ({
        id: entityId,
        ...(value || {})
    }));

    return {
        [id]: {
            type: 'table',
            idField: 'id',
            data
        }
    };
}

function convertDataSetsToV2(dataSets, options = {}) {
    const cloned = cloneData(dataSets || {});
    Object.entries(cloned).forEach(([id, ds]) => {
        if (ds && ds.type === 'factSentences' && Array.isArray(ds.sentences)) {
            ds.sentences = ds.sentences.map((sentence, idx) => ({
                ...sentence,
                id: sentence.id || `${id}_s${idx}`,
                tokens: convertTokenArrayToV2(sentence.tokens, options)
            }));
        }
    });
    return cloned;
}

function detectQuestionFormat(pattern) {
    if (pattern.questionFormat) {
        return pattern.questionFormat;
    }
    if (pattern.tokensFromData === 'sentences') {
        return 'sentence_fill_choice';
    }
    if (pattern.matchingSpec) {
        return 'table_matching';
    }
    return 'table_fill_choice';
}

function normalizePatterns(rawPatterns, dataSetId, convertOptions = {}) {
    return (rawPatterns || []).map((p, index) => ({
        id: p.id || `p_${index}`,
        label: p.label,
        questionFormat: detectQuestionFormat(p),
        dataSet: p.dataSet || dataSetId,
        tokens: convertTokenArrayToV2(p.tokens || [], convertOptions),
        entityFilter: p.entityFilter,
        tokensFromData: p.tokensFromData,
        matchingSpec: p.matchingSpec,
        tips: convertTipsToV2(p.tips || [], convertOptions)
    }));
}

function normalizeModes(rawModes, patterns) {
    const patternIds = new Set((patterns || []).map((p) => p.id));
    const baseModes = (rawModes || []).map((m, idx) => ({
        id: m.id || `mode_${idx}`,
        label: m.label || m.id || `Mode ${idx + 1}`,
        description: m.description,
        patternWeights: (m.patternWeights || []).filter((pw) => patternIds.has(pw.patternId))
    }));

    if (baseModes.length === 0) {
        const weights = patterns.map((p) => ({ patternId: p.id, weight: 1 }));
        return [
            {
                id: 'default',
                label: 'Standard',
                description: 'Default mode',
                patternWeights: weights
            }
        ];
    }

    return baseModes;
}

function hasHideLikeToken(tokens) {
    return (tokens || []).some((token) => {
        if (!token) return false;
        if (token.type === 'hide' || token.type === 'hideruby') return true;
        if (Array.isArray(token.value) && hasHideLikeToken(token.value)) return true;
        if (token.value && token.value.type) {
            return hasHideLikeToken([token.value]);
        }
        return false;
    });
}

function validateGroupDefinition(dataSetId, groupId, group) {
    if (!group || typeof group !== 'object') {
        throw new Error(`Group ${groupId} in ${dataSetId} must be an object.`);
    }
    if (!Array.isArray(group.choices)) {
        throw new Error(`Group ${groupId} in ${dataSetId} must have a choices array.`);
    }
    if (group.drawWithoutReplacement != null && typeof group.drawWithoutReplacement !== 'boolean') {
        throw new Error(
            `Group ${groupId} in ${dataSetId} has invalid drawWithoutReplacement flag.`
        );
    }
}

function validateDataSets(dataSets) {
    const entries = Object.entries(dataSets || {});
    if (!entries.length) {
        throw new Error('Quiz definition must include at least one dataSet.');
    }

    entries.forEach(([id, ds]) => {
        if (!ds || typeof ds !== 'object') {
            throw new Error(`DataSet ${id} must be an object.`);
        }
        if (!ALLOWED_DATASET_TYPES.has(ds.type)) {
            throw new Error(`DataSet ${id} has unsupported type: ${ds.type}`);
        }
        if (ds.type === 'table') {
            if (!Array.isArray(ds.data)) {
                throw new Error(`Table DataSet ${id} must have a data array.`);
            }
            ds.data.forEach((row, idx) => {
                if (!row || row.id === undefined) {
                    throw new Error(`Table DataSet ${id} has row without id at index ${idx}.`);
                }
            });
        }
        if (ds.type === 'factSentences') {
            if (!Array.isArray(ds.sentences)) {
                throw new Error(`factSentences DataSet ${id} must have sentences array.`);
            }
            ds.sentences.forEach((sentence, idx) => {
                if (!sentence || sentence.id === undefined) {
                    throw new Error(`Sentence entry missing id in DataSet ${id} at index ${idx}.`);
                }
                if (!Array.isArray(sentence.tokens)) {
                    throw new Error(`Sentence ${sentence.id} in DataSet ${id} must have tokens array.`);
                }
            });
            if (ds.groups && typeof ds.groups === 'object') {
                Object.entries(ds.groups).forEach(([groupId, group]) => {
                    validateGroupDefinition(id, groupId, group);
                });
            }
        }
        if (ds.type === 'groups') {
            if (!ds.groups || typeof ds.groups !== 'object') {
                throw new Error(`groups DataSet ${id} must have groups object.`);
            }
            Object.entries(ds.groups).forEach(([groupId, group]) => {
                validateGroupDefinition(id, groupId, group);
            });
        }
    });
}

function validateDefinition(definition) {
    if (!definition || typeof definition !== 'object') {
        throw new Error('Quiz definition is missing or invalid.');
    }

    if (!definition.dataSets || typeof definition.dataSets !== 'object') {
        throw new Error('Quiz definition must include dataSets.');
    }

    validateDataSets(definition.dataSets);

    if (!Array.isArray(definition.patterns) || definition.patterns.length === 0) {
        throw new Error('At least one pattern is required.');
    }

    definition.patterns.forEach((pattern) => {
        if (!ALLOWED_FORMATS.has(pattern.questionFormat)) {
            throw new Error(`Unsupported questionFormat: ${pattern.questionFormat}`);
        }
        const ds = definition.dataSets[pattern.dataSet];
        if (!ds) {
            throw new Error(`Pattern ${pattern.id} references missing dataSet ${pattern.dataSet}.`);
        }
        if (pattern.questionFormat === 'table_matching') {
            if (ds.type !== 'table') {
                throw new Error(`Pattern ${pattern.id} requires a table dataSet.`);
            }
            if (!pattern.matchingSpec) {
                throw new Error(`Pattern ${pattern.id} is missing matchingSpec.`);
            }
            return;
        }
        if (pattern.questionFormat === 'sentence_fill_choice') {
            if (ds.type !== 'factSentences') {
                throw new Error(`Pattern ${pattern.id} requires a factSentences dataSet.`);
            }
            if (pattern.tokensFromData !== 'sentences') {
                throw new Error(`Pattern ${pattern.id} must set tokensFromData to "sentences".`);
            }
            const hasHideInSentences = (ds.sentences || []).some((s) => hasHideLikeToken(s.tokens));
            if (!hasHideInSentences) {
                throw new Error(`factSentences dataSet ${pattern.dataSet} must include at least one hide token.`);
            }
            return;
        }
        if (ds.type !== 'table') {
            throw new Error(`Pattern ${pattern.id} requires a table dataSet.`);
        }
        if (!hasHideLikeToken(pattern.tokens)) {
            throw new Error(`Pattern ${pattern.id} must include at least one hide token.`);
        }
    });

    (definition.modes || []).forEach((mode) => {
        const weights = mode.patternWeights || [];
        weights.forEach((pw) => {
            const exists = definition.patterns.some((p) => p.id === pw.patternId);
            if (!exists) {
                console.warn(
                    `[quiz] Mode ${mode.id} references missing pattern ${pw.patternId}, ignoring.`
                );
            }
        });
    });

    return definition;
}

function convertToV2(json, options = {}) {
    const meta = normalizeMeta(json);
    if (json.version && json.version !== 2) {
        console.warn(`[quiz] Non-v2 version specified: ${json.version}`);
    }

    const treatAsV2 = json.version === 2 || !!json.dataSets || options.isBundle;
    const convertOptions = {
        allowHiderubyConversion: treatAsV2,
        convertHideField: treatAsV2
    };
    const patternsSource = json.questionRules?.patterns || json.patterns;
    const modesSource = json.questionRules?.modes || json.modes || [];

    if (json.dataSets) {
        const dataSets = convertDataSetsToV2(json.dataSets || {}, convertOptions);
        const patterns = normalizePatterns(patternsSource, null, convertOptions);
        const modes = normalizeModes(modesSource, patterns);
        warnUnknownKeys(
            json,
            new Set([
                'id',
                'title',
                'description',
                'version',
                'color',
                'imports',
                'dataSets',
                'questionRules',
                'patterns',
                'modes'
            ]),
            'quiz definition'
        );
        return validateDefinition({
            meta,
            dataSets,
            patterns,
            modes
        });
    }

    const dataSets = convertEntitySetToDataSet(json.entitySet || {});
    const dataSetId = Object.keys(dataSets)[0];
    const patterns = normalizePatterns(patternsSource, dataSetId, convertOptions);
    const modes = normalizeModes(modesSource, patterns);

    return validateDefinition({
        meta,
        dataSets,
        patterns,
        modes
    });
}

function mergeDataSets(target, source, label) {
    Object.entries(source || {}).forEach(([id, ds]) => {
        if (target[id]) {
            console.warn(`[quiz] DataSet ${id} overridden by ${label}`);
        }
        target[id] = cloneData(ds);
    });
}

function resolveImportUrl(mainPath, importPath) {
    const baseUrl = new URL(mainPath, window.location.href);
    return new URL(importPath, baseUrl).toString();
}

async function fetchJson(path) {
    const res = await fetch(path);
    if (!res.ok) {
        console.error('[quiz] fetch not OK for', path, res.status, res.statusText);
        throw new Error(`Failed to load quiz JSON: ${path}`);
    }
    return res.json();
}

async function loadDataBundle(mainJson, mainPath) {
    const imports = Array.isArray(mainJson.imports) ? mainJson.imports : [];
    const mergedDataSets = {};

    for (const relPath of imports) {
        const url = resolveImportUrl(mainPath, relPath);
        const importedJson = await fetchJson(url);
        if (importedJson.imports) {
            throw new Error(`Nested imports are not allowed: ${relPath}`);
        }
        if (importedJson.questionRules) {
            throw new Error(`Import file should not contain questionRules: ${relPath}`);
        }
        if (!importedJson.dataSets || typeof importedJson.dataSets !== 'object') {
            throw new Error(`Import file missing dataSets: ${relPath}`);
        }
        mergeDataSets(mergedDataSets, importedJson.dataSets, url);
    }

    mergeDataSets(mergedDataSets, mainJson.dataSets || {}, mainPath);
    const mergedJson = {
        ...mainJson,
        dataSets: mergedDataSets
    };
    return convertToV2(mergedJson, { isBundle: true });
}

/**
 * URL の指定とエントリ一覧を突き合わせて使用するクイズ ID を決定する。
 *
 * - URL パラメータがエントリ一覧に存在する場合はそれを優先
 * - 見つからなければ先頭のエントリをデフォルトとして採用
 * - エントリが空で URL だけある場合は URL の値をそのまま利用（互換性用）
 * @param {Array<object>} entries - クイズエントリの配列。
 * @returns {string} 使用するクイズの ID。
 */
function selectQuizIdFromEntries(entries) {
    const requested = getQuizNameFromLocation();

    if (Array.isArray(entries) && entries.length > 0) {
        const hasRequested =
            requested && entries.some((entry) => entry && entry.id === requested);
        if (hasRequested) {
            console.log(
                '[quiz] selectQuizIdFromEntries: using requested quiz id =',
                requested
            );
            return requested;
        }

        const fallbackId = entries[0].id;
        console.log(
            '[quiz] selectQuizIdFromEntries: requested id not found, fallback to first entry id =',
            fallbackId
        );
        return fallbackId;
    }

    if (requested) {
        console.log(
            '[quiz] selectQuizIdFromEntries: no entries, using requested id =',
            requested
        );
        return requested;
    }

    throw new Error(
        'No quiz entries are available and no quiz id was specified in the URL.'
    );
}

/**
 * エントリから実際に読み込む JSON パスを決定する。
 * 優先順位:
 *  1. entry.dir があれば: dir/<quizId>.json とみなす（dir は必ず "data/" で始まること）
 *  2. entry.file があれば: そのまま使う（file も必ず "data/" で始まること）
 *  3. どちらも無ければ null
 *
 * これで:
 *  - PHP 環境: entry.php から "dir": "data/quizzes" → data/quizzes/<id>.json
 *  - 非 PHP: entry.json から "file": "data/sample/xxx.json" → そのまま data/sample/xxx.json
 */
function resolvePathFromEntry(entry, quizId) {
    const resolved = resolveQuizJsonFromEntry(entry);
    if (!resolved) {
        console.warn(
            '[quiz] resolvePathFromEntry: entry has no dir/file for quizId =',
            quizId,
            'entry =',
            entry
        );
        return null;
    }

    if (!resolved.startsWith('data/')) {
        const msg = `[quiz] Invalid path for quiz "${quizId}": "${resolved}" (must start with "data/")`;
        console.error(msg);
        throw new Error(msg);
    }

    console.log('[quiz] resolvePathFromEntry: using entry-based path =', resolved);
    return resolved;
}

/**
 * エントリ情報を基にクイズ定義 JSON を取得し、アプリで扱いやすい形に整形する。
 * @param {Array<object>} entries - クイズエントリの配列。
 * @returns {Promise<object>} 整形されたクイズ定義オブジェクト。
 */
export async function loadQuizDefinition(entries) {
    const quizName = selectQuizIdFromEntries(entries);
    const entry = Array.isArray(entries)
        ? entries.find((e) => e && e.id === quizName)
        : null;

    let path = resolvePathFromEntry(entry, quizName);

    // entries からパスが解決できなかった場合のみ、従来の data/quizzes/<id>.json にフォールバック
    if (!path) {
        path = resolveQuizJsonPath(quizName);
        console.warn(
            '[quiz] loadQuizDefinition: falling back to resolveQuizJsonPath =',
            path
        );
    }

    console.log('[quiz] loadQuizDefinition quizName =', quizName);
    console.log('[quiz] resolved JSON path =', path);

    const json = await fetchJson(path);
    console.log('[quiz] loaded quiz JSON keys =', Object.keys(json || {}));

    const useBundle = json && json.dataSets;
    const definition = useBundle ? await loadDataBundle(json, path) : convertToV2(json);

    return {
        quizName,
        definition
    };
}

export { convertToV2, validateDefinition };
