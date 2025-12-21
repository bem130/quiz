// js/quiz-model.js
import { parseJsonWithLoc } from './json-loc-parser.js';

const ALLOWED_TOKEN_TYPES = new Set([
    'key',
    'listkey',
    'ruby',
    'katex',
    'smiles',
    'hide',
    'br',
    'hr'
]);

function resolveRuntimeUrl(path, baseUrl = null) {
    if (!path) {
        return null;
    }

    if (baseUrl) {
        return new URL(path, baseUrl);
    }

    return new URL(path, RUNTIME_BASE_URL);
}

function readablePathFromUrl(urlObj) {
    if (!urlObj) return '';
    return urlObj.protocol === 'file:' ? urlObj.pathname : urlObj.toString();
}

function deriveQuizNameFromPath(path) {
    try {
        const url = resolveRuntimeUrl(path);
        const pathname = url.pathname || '';
        const fileName = pathname.split('/').filter(Boolean).pop() || 'quiz';
        return decodeURIComponent(fileName.replace(/\.json$/i, '')) || 'quiz';
    } catch (e) {
        return 'quiz';
    }
}

const RUNTIME_BASE_URL = (() => {
    if (typeof window !== 'undefined' && window.location && window.location.href) {
        return window.location.href;
    }
    if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
        const normalized = process.cwd().replace(/\\/g, '/');
        return normalized.endsWith('/') ? `file://${normalized}` : `file://${normalized}/`;
    }
    return 'file:///';
})();

function normalizeTokenArray(value) {
    if (value == null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value;
    }
    return [value];
}

function isTokenObject(token) {
    return token && typeof token === 'object' && !Array.isArray(token);
}

function hasHideToken(token) {
    if (!token) return false;
    if (typeof token === 'string') return false;
    if (Array.isArray(token)) {
        return token.some((child) => hasHideToken(child));
    }
    if (!isTokenObject(token)) return false;
    if (token.type === 'hide') return true;
    if (token.type === 'ruby') {
        return hasHideToken(token.base) || hasHideToken(token.ruby);
    }
    if (token.type === 'listkey' && token.separatorTokens) {
        return hasHideToken(token.separatorTokens);
    }
    if (token.type === 'hide' && token.value) {
        return hasHideToken(token.value);
    }
    return false;
}

function assertNoHideToken(token, label) {
    if (hasHideToken(token)) {
        throw new Error(`Token at ${label} must not include hide tokens.`);
    }
}

function validateToken(token, label) {
    if (token == null) {
        return;
    }
    if (typeof token === 'string') {
        return;
    }
    if (!isTokenObject(token)) {
        throw new Error(`Token at ${label} must be a string or object.`);
    }
    if (!token.type) {
        throw new Error(`Token at ${label} is missing type.`);
    }
    if (!ALLOWED_TOKEN_TYPES.has(token.type)) {
        throw new Error(`Token at ${label} has unsupported type: ${token.type}`);
    }

    if (token.type === 'key') {
        if (!token.field || typeof token.field !== 'string') {
            throw new Error(`Key token at ${label} requires a field.`);
        }
    }

    if (token.type === 'listkey') {
        if (!token.field || typeof token.field !== 'string') {
            throw new Error(`ListKey token at ${label} requires a field.`);
        }
        if (token.separatorTokens != null) {
            const separators = normalizeTokenArray(token.separatorTokens);
            separators.forEach((child, idx) => validateToken(child, `${label}.separatorTokens[${idx}]`));
        }
    }

    if (token.type === 'ruby') {
        if (!token.base || !token.ruby) {
            throw new Error(`Ruby token at ${label} requires base and ruby.`);
        }
        assertNoHideToken(token.base, `${label}.base`);
        assertNoHideToken(token.ruby, `${label}.ruby`);
    }

    if (token.type === 'hide') {
        if (!token.id || typeof token.id !== 'string') {
            throw new Error(`Hide token at ${label} requires an id.`);
        }
        if (token.field != null) {
            throw new Error(`Hide token at ${label} must use value (field is not supported in v3).`);
        }
        if (!token.answer || token.answer.mode !== 'choice_from_entities') {
            throw new Error(`Hide token at ${label} must use answer.mode "choice_from_entities".`);
        }
        const answer = token.answer || {};
        if (answer.choiceCount != null) {
            throw new Error(`Hide token at ${label} must not include answer.choiceCount (v3 fixed to 4 choices).`);
        }
        if (answer.avoidSameId != null || answer.avoidSameText != null) {
            throw new Error(`Hide token at ${label} must not include avoidSameId/avoidSameText (v3 default behavior).`);
        }
        if (answer.distractorSource != null) {
            if (!isTokenObject(answer.distractorSource)) {
                throw new Error(`Hide token at ${label} has invalid distractorSource.`);
            }
            const { groupField, ...rest } = answer.distractorSource;
            if (groupField != null && typeof groupField !== 'string') {
                throw new Error(`Hide token at ${label} distractorSource.groupField must be a string.`);
            }
            const extraKeys = Object.keys(rest);
            if (extraKeys.length > 0) {
                throw new Error(`Hide token at ${label} distractorSource has unsupported keys: ${extraKeys.join(', ')}`);
            }
        }
        const values = normalizeTokenArray(token.value);
        if (!values.length) {
            throw new Error(`Hide token at ${label} must have a non-empty value array.`);
        }
        values.forEach((child, idx) => {
            if (hasHideToken(child)) {
                throw new Error(`Hide token at ${label}.value[${idx}] must not include nested hide tokens.`);
            }
            validateToken(child, `${label}.value[${idx}]`);
        });
    }

    if ((token.type === 'katex' || token.type === 'smiles') && token.value == null && !token.field) {
        throw new Error(`Token at ${label} of type ${token.type} requires value or field.`);
    }
}

function validateTokens(tokens, label) {
    const list = normalizeTokenArray(tokens);
    list.forEach((token, idx) => validateToken(token, `${label}[${idx}]`));
}

function countHideTokens(tokens) {
    let count = 0;
    normalizeTokenArray(tokens).forEach((token) => {
        if (!token || typeof token === 'string') return;
        if (token.type === 'hide') {
            count += 1;
        }
    });
    return count;
}

function validatePattern(pattern, label) {
    if (!pattern || typeof pattern !== 'object') {
        throw new Error(`Pattern ${label} must be an object.`);
    }
    if (pattern.questionFormat != null) {
        throw new Error(`Pattern ${label} must not include questionFormat (v3 only supports table_fill_choice).`);
    }
    if (pattern.tokensFromData != null) {
        throw new Error(`Pattern ${label} must not include tokensFromData (v3 uses table only).`);
    }
    if (pattern.entityFilter != null) {
        throw new Error(`Pattern ${label} must not include entityFilter (filters are removed in v3).`);
    }
    if (pattern.matchingSpec != null) {
        throw new Error(`Pattern ${label} must not include matchingSpec (matching is removed in v3).`);
    }
    if (!Array.isArray(pattern.tokens)) {
        throw new Error(`Pattern ${label} must include tokens array.`);
    }

    validateTokens(pattern.tokens, `${label}.tokens`);

    const hideCount = countHideTokens(pattern.tokens);
    if (hideCount !== 1) {
        throw new Error(`Pattern ${label} must include exactly one hide token.`);
    }

    if (Array.isArray(pattern.tips)) {
        pattern.tips.forEach((tip, idx) => {
            if (!tip || typeof tip !== 'object') {
                throw new Error(`Tip ${label}.tips[${idx}] must be an object.`);
            }
            if (!Array.isArray(tip.tokens)) {
                throw new Error(`Tip ${label}.tips[${idx}] must include tokens array.`);
            }
            if (countHideTokens(tip.tokens) > 0) {
                throw new Error(`Tip ${label}.tips[${idx}] must not include hide tokens.`);
            }
            validateTokens(tip.tokens, `${label}.tips[${idx}].tokens`);
        });
    }
}

function validateTable(table, label) {
    if (!Array.isArray(table)) {
        throw new Error(`Table ${label} must be an array.`);
    }
    const seenIds = new Set();
    table.forEach((row, idx) => {
        if (!row || typeof row !== 'object') {
            throw new Error(`Table row at ${label}[${idx}] must be an object.`);
        }
        if (row.id == null || row.id === '') {
            throw new Error(`Table row at ${label}[${idx}] is missing id.`);
        }
        if (typeof row.id !== 'string') {
            throw new Error(`Table row at ${label}[${idx}] id must be a string.`);
        }
        if (seenIds.has(row.id)) {
            throw new Error(`Table row id "${row.id}" is duplicated.`);
        }
        seenIds.add(row.id);
    });
}

function normalizeFileKey(path) {
    if (!path) return '';
    const normalized = String(path).replace(/\\/g, '/').replace(/^\.?\//, '');
    return normalized.replace(/\.json$/i, '');
}

function normalizeSourcePath(path) {
    if (!path) return '';
    return String(path).replace(/\\/g, '/').replace(/^\.?\//, '');
}

function defineHiddenProperty(target, key, value) {
    if (!target || typeof target !== 'object') return;
    Object.defineProperty(target, key, {
        value,
        writable: true,
        configurable: true
    });
}

function buildSourceLocation(loc, filePath, extraInfo = null) {
    if (!loc || !loc.start) return null;
    const base = {
        file: filePath,
        line: loc.start.line,
        column: loc.start.column,
        endLine: loc.end ? loc.end.line : loc.start.line,
        endColumn: loc.end ? loc.end.column : loc.start.column
    };
    if (extraInfo && typeof extraInfo === 'object') {
        return { ...base, ...extraInfo };
    }
    return base;
}

function findNodeByPath(ast, path) {
    let current = ast;
    for (let i = 0; i < path.length; i += 1) {
        const key = path[i];
        if (!current || !current.children) return null;
        if (current.type === 'Object') {
            const prop = current.children.find((child) => child.key && child.key.value === key);
            if (!prop) return null;
            current = prop.value;
            continue;
        }
        if (current.type === 'Array') {
            if (typeof key !== 'number') return null;
            if (key >= current.children.length) return null;
            current = current.children[key];
            continue;
        }
        return null;
    }
    return current;
}

function attachTokenObjectLoc(token, ast, path, filePath, extraInfo = null) {
    if (!token || typeof token !== 'object' || Array.isArray(token)) return;
    const node = findNodeByPath(ast, path);
    if (node && node.loc) {
        defineHiddenProperty(token, '_loc', buildSourceLocation(node.loc, filePath, extraInfo));
    }

    if (token.value != null) {
        const valuePath = [...path, 'value'];
        if (Array.isArray(token.value)) {
            attachTokenArrayLocs(token.value, ast, valuePath, filePath, extraInfo);
        } else if (typeof token.value === 'object') {
            attachTokenObjectLoc(token.value, ast, valuePath, filePath, extraInfo);
        }
    }
    if (token.base != null) {
        const basePath = [...path, 'base'];
        if (Array.isArray(token.base)) {
            attachTokenArrayLocs(token.base, ast, basePath, filePath, extraInfo);
        } else if (typeof token.base === 'object') {
            attachTokenObjectLoc(token.base, ast, basePath, filePath, extraInfo);
        }
    }
    if (token.ruby != null) {
        const rubyPath = [...path, 'ruby'];
        if (Array.isArray(token.ruby)) {
            attachTokenArrayLocs(token.ruby, ast, rubyPath, filePath, extraInfo);
        } else if (typeof token.ruby === 'object') {
            attachTokenObjectLoc(token.ruby, ast, rubyPath, filePath, extraInfo);
        }
    }
    if (token.separatorTokens != null) {
        const sepPath = [...path, 'separatorTokens'];
        if (Array.isArray(token.separatorTokens)) {
            attachTokenArrayLocs(token.separatorTokens, ast, sepPath, filePath, extraInfo);
        } else if (typeof token.separatorTokens === 'object') {
            attachTokenObjectLoc(token.separatorTokens, ast, sepPath, filePath, extraInfo);
        }
    }
}

function attachTokenArrayLocs(tokens, ast, path, filePath, extraInfo = null) {
    if (!Array.isArray(tokens)) return;
    const locMap = [];
    tokens.forEach((token, idx) => {
        const tokenPath = [...path, idx];
        const node = findNodeByPath(ast, tokenPath);
        if (node && node.loc) {
            locMap[idx] = buildSourceLocation(node.loc, filePath, extraInfo);
        }
        if (token && typeof token === 'object') {
            if (Array.isArray(token)) {
                attachTokenArrayLocs(token, ast, tokenPath, filePath, extraInfo);
            } else {
                attachTokenObjectLoc(token, ast, tokenPath, filePath, extraInfo);
            }
        }
    });
    defineHiddenProperty(tokens, '__locMap', locMap);
}

function attachTableRowLocs(table, ast, filePath) {
    if (!Array.isArray(table)) return;
    table.forEach((row, rowIndex) => {
        if (!row || typeof row !== 'object') return;
        const rowPath = ['table', rowIndex];
        const rowLocMap = {};
        Object.keys(row).forEach((field) => {
            const fieldPath = [...rowPath, field];
            const node = findNodeByPath(ast, fieldPath);
            const extraInfo = {
                rowId: row.id,
                field
            };
            if (node && node.loc) {
                rowLocMap[field] = buildSourceLocation(node.loc, filePath, extraInfo);
            }
            const value = row[field];
            if (Array.isArray(value)) {
                attachTokenArrayLocs(value, ast, fieldPath, filePath, extraInfo);
            } else if (value && typeof value === 'object' && value.type) {
                attachTokenObjectLoc(value, ast, fieldPath, filePath, extraInfo);
            }
        });
        defineHiddenProperty(row, '__locMap', rowLocMap);
    });
}

function attachQuizSourceLocations(json, ast, filePath) {
    if (!json || !ast || typeof json !== 'object') return;
    const sourcePath = normalizeSourcePath(filePath);
    const patterns = Array.isArray(json.patterns) ? json.patterns : [];
    patterns.forEach((pattern, index) => {
        if (!pattern) return;
        if (Array.isArray(pattern.tokens)) {
            attachTokenArrayLocs(pattern.tokens, ast, ['patterns', index, 'tokens'], sourcePath);
        }
        if (Array.isArray(pattern.tips)) {
            pattern.tips.forEach((tip, tipIndex) => {
                if (tip && Array.isArray(tip.tokens)) {
                    attachTokenArrayLocs(
                        tip.tokens,
                        ast,
                        ['patterns', index, 'tips', tipIndex, 'tokens'],
                        sourcePath
                    );
                }
            });
        }
    });
    if (Array.isArray(json.table)) {
        attachTableRowLocs(json.table, ast, sourcePath);
    }
}

function buildMeta({ id, title, description, version }) {
    return {
        id: id || title || 'quiz',
        title: title || id || 'quiz',
        description: description || '',
        version: version || 3
    };
}

function buildModesFromPatterns(patterns) {
    const weights = patterns.map((p) => ({ patternId: p.id, weight: 1 }));
    const allMode = {
        id: 'all',
        label: 'All patterns',
        description: 'All available patterns.',
        patternWeights: weights
    };

    const patternModes = patterns.map((pattern) => ({
        id: `pattern::${pattern.id}`,
        label: pattern.label || pattern.localId || pattern.id,
        description: pattern.description || '',
        patternWeights: [{ patternId: pattern.id, weight: 1 }]
    }));

    const modeTree = [
        { type: 'mode', modeId: allMode.id },
        {
            type: 'modes',
            label: 'Patterns',
            description: 'Choose a single pattern',
            children: patternModes.map((mode) => ({ type: 'mode', modeId: mode.id }))
        }
    ];

    return {
        modes: [allMode, ...patternModes],
        modeTree
    };
}

function normalizePattern(pattern, fileKey, dataSetId, index) {
    const id = pattern.id || `p_${index}`;
    return {
        id: `${fileKey}::${id}`,
        localId: id,
        label: pattern.label || id,
        description: pattern.description || '',
        dataSet: dataSetId,
        tokens: normalizeTokenArray(pattern.tokens || []),
        tips: Array.isArray(pattern.tips) ? pattern.tips : [],
        _sourceFile: fileKey
    };
}

function normalizeQuizFile(json, fileKey) {
    if (!json || typeof json !== 'object') {
        throw new Error('Quiz definition is missing or invalid.');
    }

    const version = json.version != null ? json.version : 3;
    if (version !== 3) {
        console.warn(`[quiz] Non-v3 version specified: ${version}`);
    }

    const unsupportedFields = ['imports', 'dataSets', 'questionRules', 'modes'];
    unsupportedFields.forEach((field) => {
        if (json[field] != null) {
            throw new Error(`Quiz file uses unsupported field "${field}" in v3.`);
        }
    });

    if (typeof json.title !== 'string' || !json.title.trim()) {
        throw new Error('Quiz file title is required.');
    }
    if (typeof json.description !== 'string' || !json.description.trim()) {
        throw new Error('Quiz file description is required.');
    }

    const table = json.table;
    validateTable(table, 'table');

    if (!Array.isArray(json.patterns) || json.patterns.length === 0) {
        throw new Error('At least one pattern is required.');
    }

    json.patterns.forEach((pattern, idx) => {
        validatePattern(pattern, `patterns[${idx}]`);
    });

    const dataSetId = `file:${fileKey}`;
    const dataSet = {
        type: 'table',
        idField: 'id',
        data: json.table
    };

    const patterns = json.patterns.map((pattern, index) =>
        normalizePattern(pattern, fileKey, dataSetId, index)
    );

    return {
        meta: buildMeta({
            id: json.id || fileKey,
            title: json.title || fileKey,
            description: json.description || '',
            version
        }),
        dataSetId,
        dataSet,
        patterns
    };
}

export function buildDefinitionFromQuizFile(json, fileKey, overrides = {}) {
    const normalizedKey = normalizeFileKey(fileKey || overrides.fileKey || 'quiz');
    const file = normalizeQuizFile(json, normalizedKey);
    const { modes, modeTree } = buildModesFromPatterns(file.patterns);
    return validateDefinition({
        meta: buildMeta({
            id: overrides.id || file.meta.id,
            title: overrides.title || file.meta.title,
            description: overrides.description || file.meta.description,
            version: file.meta.version
        }),
        dataSets: { [file.dataSetId]: file.dataSet },
        patterns: file.patterns,
        modes,
        modeTree
    });
}

function filterDefinitionByPatternIds(definition, patternIds) {
    if (!definition || !Array.isArray(patternIds) || patternIds.length === 0) {
        return definition;
    }
    const allowed = new Set(patternIds.map((id) => String(id)));
    const filteredPatterns = (definition.patterns || []).filter((pattern) => allowed.has(pattern.id));
    const { modes, modeTree } = buildModesFromPatterns(filteredPatterns);
    return validateDefinition({
        ...definition,
        patterns: filteredPatterns,
        modes,
        modeTree
    });
}

function validateDefinition(definition) {
    if (!definition || typeof definition !== 'object') {
        throw new Error('Quiz definition is missing or invalid.');
    }

    if (!definition.meta || typeof definition.meta !== 'object') {
        throw new Error('Quiz definition must include meta.');
    }
    if (typeof definition.meta.title !== 'string' || !definition.meta.title.trim()) {
        throw new Error('Quiz definition meta.title is required.');
    }
    if (typeof definition.meta.description !== 'string' || !definition.meta.description.trim()) {
        throw new Error('Quiz definition meta.description is required.');
    }

    if (!definition.dataSets || typeof definition.dataSets !== 'object') {
        throw new Error('Quiz definition must include dataSets.');
    }

    if (!Array.isArray(definition.patterns) || definition.patterns.length === 0) {
        throw new Error('At least one pattern is required.');
    }

    definition.patterns.forEach((pattern, idx) => {
        validatePattern(pattern, `patterns[${idx}]`);
        if (!definition.dataSets[pattern.dataSet]) {
            throw new Error(`Pattern ${pattern.id} references missing dataSet ${pattern.dataSet}.`);
        }
    });

    if (!Array.isArray(definition.modes) || definition.modes.length === 0) {
        const { modes, modeTree } = buildModesFromPatterns(definition.patterns);
        definition.modes = modes;
        definition.modeTree = modeTree;
    }

    return definition;
}

async function fetchJson(path, baseUrl = null) {
    const url = resolveRuntimeUrl(path, baseUrl);
    if (!url) {
        throw new Error('Quiz path is required to load definition.');
    }

    if (url.protocol === 'file:') {
        const [{ readFile }, { fileURLToPath }] = await Promise.all([
            import('node:fs/promises'),
            import('node:url')
        ]);
        const filePath = fileURLToPath(url);
        const rawText = await readFile(filePath, 'utf8');
        const json = JSON.parse(rawText);
        const ast = parseJsonWithLoc(rawText);
        return { json, url, ast };
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
        console.error('[quiz] fetch not OK for', path, res.status, res.statusText);
        throw new Error(`Failed to load quiz JSON: ${path}`);
    }
    const rawText = await res.text();
    const json = JSON.parse(rawText);
    const ast = parseJsonWithLoc(rawText);
    return { json, url, ast };
}

async function loadQuizFiles(filePaths, baseUrl, metaOverrides = {}) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
        throw new Error('Quiz definition requires at least one file.');
    }

    const dataSets = {};
    const patterns = [];
    const fileMetas = [];

    for (const filePath of filePaths) {
        const normalizedKey = normalizeFileKey(filePath);
        const { json, ast } = await fetchJson(filePath, baseUrl);
        attachQuizSourceLocations(json, ast, filePath);
        const file = normalizeQuizFile(json, normalizedKey);
        dataSets[file.dataSetId] = file.dataSet;
        patterns.push(...file.patterns);
        fileMetas.push(file.meta);
    }

    if (patterns.length === 0) {
        throw new Error('At least one pattern is required.');
    }

    const meta = buildMeta({
        id: metaOverrides.id || metaOverrides.title,
        title: metaOverrides.title,
        description: metaOverrides.description,
        version: 3
    });

    if (!meta.title || meta.title === 'quiz') {
        meta.title = metaOverrides.title || patterns[0].label || 'Quiz';
    }
    if (!meta.description || !meta.description.trim()) {
        if (fileMetas.length === 1 && fileMetas[0] && fileMetas[0].description) {
            meta.description = fileMetas[0].description;
        } else {
            meta.description = `Combined quiz files (${fileMetas.length})`;
        }
    }

    const { modes, modeTree } = buildModesFromPatterns(patterns);

    return validateDefinition({
        meta,
        dataSets,
        patterns,
        modes,
        modeTree
    });
}

async function loadQuizDefinitionInternal(quizName, path, baseUrl = null) {
    const { json, url, ast } = await fetchJson(path, baseUrl);
    attachQuizSourceLocations(json, ast, path);
    const fileKey = normalizeFileKey(path);
    const file = normalizeQuizFile(json, fileKey);

    const { modes, modeTree } = buildModesFromPatterns(file.patterns);

    const definition = validateDefinition({
        meta: buildMeta({
            id: file.meta.id || quizName,
            title: file.meta.title || quizName,
            description: file.meta.description || '',
            version: file.meta.version
        }),
        dataSets: { [file.dataSetId]: file.dataSet },
        patterns: file.patterns,
        modes,
        modeTree
    });

    return {
        quizName,
        definition,
        sourcePath: readablePathFromUrl(url)
    };
}

export async function loadQuizDefinitionFromPath(path) {
    if (!path) {
        throw new Error('Quiz path is required to load definition.');
    }

    const quizName = deriveQuizNameFromPath(path);
    return loadQuizDefinitionInternal(quizName, path);
}

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

    const baseUrl = quizEntry._entryBaseUrl || null;
    if (Array.isArray(quizEntry.files) && quizEntry.files.length > 0) {
        let definition = await loadQuizFiles(quizEntry.files, baseUrl, {
            id: quizEntry.id,
            title: quizEntry.title,
            description: quizEntry.description
        });
        if (quizEntry.patternKey) {
            definition = filterDefinitionByPatternIds(definition, [quizEntry.patternKey]);
        } else if (quizEntry.patternId && quizEntry.filePath) {
            const fileKey = normalizeFileKey(quizEntry.filePath);
            definition = filterDefinitionByPatternIds(definition, [`${fileKey}::${quizEntry.patternId}`]);
        } else if (Array.isArray(quizEntry.patternIds) && quizEntry.patternIds.length > 0) {
            definition = filterDefinitionByPatternIds(definition, quizEntry.patternIds);
        }
        return {
            quizName: quizEntry.id,
            definition
        };
    }

    throw new Error('Quiz entry is missing file information.');
}

export { validateDefinition };
