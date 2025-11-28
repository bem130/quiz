// js/quiz-model.js
import { getQuizNameFromLocation, resolveQuizJsonPath } from './config.js';

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

function normalizePatterns(rawPatterns, dataSetId) {
    return (rawPatterns || []).map((p, index) => ({
        id: p.id || `p_${index}`,
        label: p.label,
        questionFormat: detectQuestionFormat(p),
        dataSet: p.dataSet || dataSetId,
        tokens: p.tokens || [],
        entityFilter: p.entityFilter,
        tokensFromData: p.tokensFromData,
        matchingSpec: p.matchingSpec,
        tips: p.tips || []
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

function validateDefinition(definition) {
    if (!definition || typeof definition !== 'object') {
        throw new Error('Quiz definition is missing or invalid.');
    }

    if (!definition.dataSets || typeof definition.dataSets !== 'object') {
        throw new Error('Quiz definition must include dataSets.');
    }

    if (!Array.isArray(definition.patterns) || definition.patterns.length === 0) {
        throw new Error('At least one pattern is required.');
    }

    const allowedFormats = new Set([
        'table_fill_choice',
        'table_matching',
        'sentence_fill_choice'
    ]);

    definition.patterns.forEach((pattern) => {
        if (!allowedFormats.has(pattern.questionFormat)) {
            throw new Error(`Unsupported questionFormat: ${pattern.questionFormat}`);
        }
        if (pattern.questionFormat === 'sentence_fill_choice') {
            const ds = definition.dataSets[pattern.dataSet];
            if (!ds || ds.type !== 'factSentences') {
                throw new Error(`Pattern ${pattern.id} requires a factSentences dataSet.`);
            }
        } else {
            const ds = definition.dataSets[pattern.dataSet];
            if (!ds || ds.type !== 'table') {
                throw new Error(`Pattern ${pattern.id} requires a table dataSet.`);
            }
        }
        if (pattern.questionFormat === 'table_matching' && !pattern.matchingSpec) {
            throw new Error(`Pattern ${pattern.id} is missing matchingSpec.`);
        }
    });

    return definition;
}

function convertToV2(json) {
    const baseMeta = {
        id: json.id || json.title || 'quiz',
        title: json.title || json.id || 'quiz',
        description: json.description || '',
        colorHue: json.color
    };

    if (json.dataSets) {
        const patterns = normalizePatterns(
            json.questionRules?.patterns || json.patterns,
            null
        );
        const modes = normalizeModes(json.questionRules?.modes || json.modes || [], patterns);
        return validateDefinition({
            meta: baseMeta,
            dataSets: json.dataSets || {},
            patterns,
            modes
        });
    }

    const dataSets = convertEntitySetToDataSet(json.entitySet || {});
    const dataSetId = Object.keys(dataSets)[0];
    const patterns = normalizePatterns(json.questionRules?.patterns || json.patterns, dataSetId);
    const modes = normalizeModes(json.questionRules?.modes || json.modes || [], patterns);

    return validateDefinition({
        meta: baseMeta,
        dataSets,
        patterns,
        modes
    });
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
    if (!entry) {
        return null;
    }

    if (typeof entry.dir === 'string') {
        const dir = entry.dir;
        if (!dir.startsWith('data/')) {
            const msg = `[quiz] Invalid dir for quiz "${quizId}": "${dir}" (must start with "data/")`;
            console.error(msg);
            throw new Error(msg);
        }
        const normalizedDir = dir.replace(/\/+$/, '');
        const path = `${normalizedDir}/${quizId}.json`;
        console.log(
            '[quiz] resolvePathFromEntry: using dir-based path =',
            path
        );
        return path;
    }

    if (typeof entry.file === 'string') {
        const file = entry.file;
        if (!file.startsWith('data/')) {
            const msg = `[quiz] Invalid file for quiz "${quizId}": "${file}" (must start with "data/")`;
            console.error(msg);
            throw new Error(msg);
        }
        console.log(
            '[quiz] resolvePathFromEntry: using file-based path =',
            file
        );
        return file;
    }

    console.warn(
        '[quiz] resolvePathFromEntry: entry has no dir/file for quizId =',
        quizId,
        'entry =',
        entry
    );
    return null;
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

    const res = await fetch(path);
    console.log(
        '[quiz] fetch quiz JSON status =',
        res.status,
        res.statusText
    );

    if (!res.ok) {
        console.error('[quiz] fetch not OK for', path);
        throw new Error(`Failed to load quiz JSON: ${path}`);
    }

    const json = await res.json();
    console.log(
        '[quiz] loaded quiz JSON keys =',
        Object.keys(json || {})
    );

    return {
        quizName,
        definition: convertToV2(json)
    };
}
