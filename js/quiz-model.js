// js/quiz-model.js
import { getQuizNameFromLocation } from './config.js';

const ALLOWED_DATASET_TYPES = new Set(['table', 'factSentences', 'groups']);
const ALLOWED_FORMATS = new Set([
    'table_fill_choice',
    'table_matching',
    'sentence_fill_choice'
]);
const ALLOWED_TOKEN_TYPES = new Set([
    'text',
    'key',
    'ruby',
    'hide',
    'katex',
    'smiles',
    'br'
]);

function normalizeTokenArray(value) {
    if (!value) {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    return [value];
}

function assertNoHideInRubyPart(part, label) {
    if (!part) return;
    const candidates = normalizeTokenArray(part.value);
    if (candidates.some((child) => child && (child.type === 'hide' || child.type === 'hideruby'))) {
        throw new Error(`Ruby token ${label} must not include hide tokens.`);
    }
}

function validateToken(token, label) {
    if (!token || typeof token !== 'object') {
        throw new Error(`Token at ${label} must be an object.`);
    }
    if (!token.type) {
        throw new Error(`Token at ${label} is missing type.`);
    }
    if (!ALLOWED_TOKEN_TYPES.has(token.type)) {
        throw new Error(`Token at ${label} has unsupported type: ${token.type}`);
    }

    if (token.type === 'ruby') {
        assertNoHideInRubyPart(token.base, `${label}.base`);
        assertNoHideInRubyPart(token.ruby, `${label}.ruby`);
    }

    if (token.type === 'hide') {
        const values = normalizeTokenArray(token.value);
        if (!values.length) {
            throw new Error(`Hide token at ${label} must have a non-empty value array.`);
        }
        values.forEach((child, idx) => validateToken(child, `${label}.value[${idx}]`));
    }

    if ((token.type === 'katex' || token.type === 'smiles') && token.value == null && !token.field) {
        throw new Error(`Token at ${label} of type ${token.type} requires value or field.`);
    }
}

function validateTokens(tokens, label) {
    (tokens || []).forEach((token, idx) => {
        validateToken(token, `${label}[${idx}]`);
    });
}

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
    if (converted.type === 'hide' && converted.value && !Array.isArray(converted.value)) {
        converted.value = [converted.value];
    }
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
    const flatModes = [];

    function normalizeNodeList(nodes) {
        const result = [];
        (nodes || []).forEach((node, idx) => {
            if (!node) {
                return;
            }

            if (node.type === 'modes') {
                const group = {
                    type: 'modes',
                    label: node.label || `Group ${idx + 1}`,
                    description: node.description,
                    children: normalizeNodeList(node.value || node.children || [])
                };
                result.push(group);
                return;
            }

            const modeId = node.id || `mode_${flatModes.length}`;
            const mode = {
                id: modeId,
                label: node.label || node.id || `Mode ${flatModes.length + 1}`,
                description: node.description,
                patternWeights: (node.patternWeights || []).filter((pw) => {
                    const exists = patternIds.has(pw.patternId);
                    if (!exists) {
                        console.warn(
                            `[quiz] Mode ${modeId} references missing pattern ${pw.patternId}, ignoring during normalization.`
                        );
                    }
                    return exists;
                })
            };
            flatModes.push(mode);
            result.push({ type: 'mode', modeId });
        });
        return result;
    }

    const tree = normalizeNodeList(rawModes || []);

    if (flatModes.length === 0) {
        const weights = patterns.map((p) => ({ patternId: p.id, weight: 1 }));
        const defaultMode = {
            id: 'default',
            label: 'Standard',
            description: 'Default mode',
            patternWeights: weights
        };
        return {
            modes: [defaultMode],
            modeTree: [{ type: 'mode', modeId: defaultMode.id }]
        };
    }

    const modeTree = tree.length > 0 ? tree : flatModes.map((mode) => ({ type: 'mode', modeId: mode.id }));

    return { modes: flatModes, modeTree };
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

function validateDataSets(dataSets, options = {}) {
    const entries = Object.entries(dataSets || {});
    if (!entries.length) {
        if (options.allowEmpty) {
            return;
        }
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
                validateTokens(sentence.tokens, `dataSets.${id}.sentences[${idx}].tokens`);
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

function validateDefinition(definition, options = {}) {
    if (!definition || typeof definition !== 'object') {
        throw new Error('Quiz definition is missing or invalid.');
    }

    if (!definition.dataSets || typeof definition.dataSets !== 'object') {
        throw new Error('Quiz definition must include dataSets.');
    }

    validateDataSets(definition.dataSets, { allowEmpty: options.allowEmptyDataSets });

    if (!Array.isArray(definition.patterns) || definition.patterns.length === 0) {
        throw new Error('At least one pattern is required.');
    }

    definition.patterns.forEach((pattern) => {
        if (!ALLOWED_FORMATS.has(pattern.questionFormat)) {
            throw new Error(`Unsupported questionFormat: ${pattern.questionFormat}`);
        }
        validateTokens(pattern.tokens, `patterns.${pattern.id}.tokens`);
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
    const modesSource =
        json.questionRules?.modeTree ||
        json.modeTree ||
        json.questionRules?.modes ||
        json.modes ||
        [];

    const dataSets = json.dataSets
        ? convertDataSetsToV2(json.dataSets || {}, convertOptions)
        : convertEntitySetToDataSet(json.entitySet || {});
    const dataSetId = Object.keys(dataSets)[0];
    const patterns = normalizePatterns(patternsSource, dataSetId, convertOptions);
    
    let modes = [];
    let modeTree = [];

    if (!options.skipModeNormalization) {
        const result = normalizeModes(modesSource, patterns);
        modes = result.modes;
        modeTree = result.modeTree;
    }

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
            'modes',
            'modeTree', // Added modeTree to allowed keys
            'entitySet'
        ]),
        'quiz definition'
    );

    const definition = {
        meta,
        dataSets,
        patterns,
        modes,
        modeTree
    };

    if (options.skipValidation) {
        return definition;
    }

    return validateDefinition(definition, {
        allowEmptyDataSets: options.allowEmptyDataSets
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

function mergePatterns(target, source, label) {
    const existing = new Map((target || []).map((pattern) => [pattern.id, pattern]));
    (source || []).forEach((pattern) => {
        if (existing.has(pattern.id)) {
            console.warn(`[quiz] Pattern ${pattern.id} overridden by ${label}`);
            const index = target.findIndex((p) => p.id === pattern.id);
            target.splice(index, 1, pattern);
            return;
        }
        target.push(pattern);
    });
}

function mergeModes(target, source, label) {
    const existing = new Map((target || []).map((mode) => [mode.id, mode]));
    (source || []).forEach((mode) => {
        if (existing.has(mode.id)) {
            console.warn(`[quiz] Mode ${mode.id} overridden by ${label}`);
            const index = target.findIndex((m) => m.id === mode.id);
            target.splice(index, 1, mode);
            return;
        }
        target.push(mode);
    });
}

function resolveImportUrl(mainPath, importPath) {
    const absoluteMainUrl = new URL(mainPath, window.location.href);
    const directoryUrl = new URL('.', absoluteMainUrl);
    return new URL(importPath, directoryUrl).toString();
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
    const visited = new Set();
    // Pass skipModeNormalization: true to defer mode processing
    const merged = convertToV2(mainJson, { skipValidation: true, isBundle: true, skipModeNormalization: true });
    merged.dataSets = merged.dataSets || {};
    merged.patterns = merged.patterns || [];
    merged.modes = merged.modes || [];
    // Store raw modes for later normalization
    let accumulatedRawModes = mainJson.questionRules?.modeTree ||
        mainJson.modeTree ||
        mainJson.questionRules?.modes ||
        mainJson.modes ||
        [];

    const mainUrl = new URL(mainPath, window.location.href).toString();
    visited.add(mainUrl);

    async function processImports(json, currentPath) {
        const imports = Array.isArray(json.imports) ? json.imports : [];
        for (const relPath of imports) {
            const url = resolveImportUrl(currentPath, relPath);
            if (visited.has(url)) {
                throw new Error(`Circular import detected: ${url}`);
            }
            visited.add(url);

            console.log('[quiz] loading import bundle:', url);
            const importedJson = await fetchJson(url);
            // Also skip mode normalization for imports
            const importedDefinition = convertToV2(importedJson, { skipValidation: true, isBundle: true, skipModeNormalization: true });
            if (!importedDefinition.dataSets || Object.keys(importedDefinition.dataSets).length === 0) {
                throw new Error(`Import file must include at least one dataSet: ${url}`);
            }

            mergeDataSets(merged.dataSets, importedDefinition.dataSets, url);
            mergePatterns(merged.patterns, importedDefinition.patterns, url);
            // We don't merge normalized modes anymore, we collect raw modes if needed,
            // but typically modes are defined in the main file.
            // If imports HAVE modes, we might want to merge them, but 'modes' array is now empty/partial.
            // Let's assume imports might contribute modes too.
            const importedRawModes = importedJson.questionRules?.modeTree ||
                importedJson.modeTree ||
                importedJson.questionRules?.modes ||
                importedJson.modes ||
                [];
            
            if (importedRawModes.length > 0) {
                 // Simple concatenation of raw mode trees is tricky. 
                 // For now, let's assume modes are primarily in the root or we just append them.
                 // But wait, mergeModes expects normalized modes.
                 // If we want to support modes in imports, we should collect them.
                 // However, the current logic was merging *normalized* modes.
                 // Let's stick to the plan: normalize at the end.
                 if (Array.isArray(accumulatedRawModes)) {
                     accumulatedRawModes = accumulatedRawModes.concat(importedRawModes);
                 }
            }

            await processImports(importedJson, url);
        }
    }

    await processImports(mainJson, mainUrl);

    if (!merged.dataSets || Object.keys(merged.dataSets).length === 0) {
        throw new Error('Quiz definition must include at least one dataSet.');
    }

    // NOW normalize modes with the full set of patterns
    const { modes, modeTree } = normalizeModes(accumulatedRawModes, merged.patterns);
    merged.modes = modes;
    merged.modeTree = modeTree;

    return validateDefinition(merged);
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
 * エントリ定義に基づいてクイズ JSON の URL を解決する。
 * @param {object} entry - クイズエントリ。
 * @returns {string|null} 解決された URL。要素不足の場合は null。
 */
export function resolveQuizJsonFromEntry(entry) {
    if (!entry) {
        return null;
    }

    const base = entry._entryBaseUrl
        ? new URL('.', entry._entryBaseUrl)
        : new URL('.', window.location.href);

    if (typeof entry.file === 'string' && entry.file) {
        return new URL(entry.file, base).toString();
    }

    if (typeof entry.dir === 'string' && entry.dir && entry.id) {
        const trimmed = entry.dir.replace(/\/+$/, '');
        const relative = `${trimmed}/${entry.id}.json`;
        return new URL(relative, base).toString();
    }

    return null;
}

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

    console.log('[quiz] resolvePathFromEntry: using entry-based path =', resolved);
    return resolved;
}

async function loadQuizDefinitionInternal(quizName, path) {
    const json = await fetchJson(path);
    const hasImports = Array.isArray(json?.imports) && json.imports.length > 0;
    const useBundle = json && json.version === 2 && hasImports;
    const definition = useBundle ? await loadDataBundle(json, path) : convertToV2(json);

    return {
        quizName,
        definition
    };
}

/**
 * クイズエントリ配列からクイズ定義を読み込む（互換 API）。
 * @param {Array<object>} entries - クイズエントリの配列。
 * @returns {Promise<object>} 整形されたクイズ定義オブジェクト。
 */
export async function loadQuizDefinition(entries) {
    const quizName = selectQuizIdFromEntries(entries);
    const entry = Array.isArray(entries)
        ? entries.find((e) => e && e.id === quizName)
        : null;

    const path = resolvePathFromEntry(entry, quizName);
    if (!path) {
        throw new Error('Failed to resolve quiz JSON path from entry.');
    }

    return loadQuizDefinitionInternal(quizName, path);
}

/**
 * 個別のクイズエントリからクイズ定義を読み込む。
 * @param {object} quizEntry - 読み込むクイズエントリ。
 * @returns {Promise<object>} 整形されたクイズ定義オブジェクト。
 */
export async function loadQuizDefinitionFromQuizEntry(quizEntry) {
    if (!quizEntry) {
        throw new Error('Quiz entry is required to load definition.');
    }
    if (quizEntry.inlineDefinition) {
        const definition = JSON.parse(JSON.stringify(quizEntry.inlineDefinition));
        validateDefinition(definition);
        return {
            quizName: quizEntry.id,
            definition
        };
    }
    const path = resolveQuizJsonFromEntry(quizEntry);
    if (!path) {
        throw new Error('Failed to resolve quiz JSON path from entry.');
    }
    return loadQuizDefinitionInternal(quizEntry.id, path);
}

export { convertToV2, validateDefinition, resolveImportUrl };
