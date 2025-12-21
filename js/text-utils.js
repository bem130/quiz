import { parseContentToSegments } from './ruby-parser.js';

function inlineSegmentsToPlainText(segments) {
    let text = '';
    (segments || []).forEach((segment) => {
        if (!segment || !segment.kind) return;
        if (segment.kind === 'Plain') {
            text += segment.text || '';
            return;
        }
        if (segment.kind === 'Math') {
            if (segment.tex) {
                text += segment.display ? `$$${segment.tex}$$` : `$${segment.tex}$`;
            }
        }
    });
    return text;
}

function contentSegmentsToPlainText(segments) {
    let text = '';
    (segments || []).forEach((segment) => {
        if (!segment || !segment.kind) return;
        if (segment.kind === 'Plain') {
            text += segment.text || '';
            return;
        }
        if (segment.kind === 'Annotated') {
            text += inlineSegmentsToPlainText(segment.base);
            return;
        }
        if (segment.kind === 'Gloss') {
            text += contentSegmentsToPlainText(segment.base || []);
            const glosses = (segment.glosses || [])
                .map((gloss) => contentSegmentsToPlainText(gloss || []))
                .filter((gloss) => gloss);
            if (glosses.length) {
                text += ` (${glosses.join(' / ')})`;
            }
            return;
        }
        if (segment.kind === 'Math') {
            if (segment.tex) {
                text += segment.display ? `$$${segment.tex}$$` : `$${segment.tex}$`;
            }
        }
    });
    return text;
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

function renderStringToken(value) {
    const raw = value != null ? String(value) : '';
    return contentSegmentsToPlainText(parseContentToSegments(raw));
}

export function resolveSubTokenValue(spec, row) {
    if (!spec) return '';
    if (typeof spec === 'string') {
        return spec;
    }
    if (spec.type === 'key') {
        const value = row && spec.field ? row[spec.field] : '';
        if (Array.isArray(value)) {
            return tokensToPlainText(value, row);
        }
        if (value && typeof value === 'object' && value.type) {
            return tokensToPlainText([value], row);
        }
        return value != null ? String(value) : '';
    }
    if (spec.value != null) {
        return String(spec.value);
    }
    return '';
}

export function tokensToPlainText(tokens, row) {
    let text = '';
    normalizeTokenArray(tokens).forEach((token) => {
        if (token == null) return;
        if (typeof token === 'string') {
            text += renderStringToken(token);
            return;
        }
        if (!token.type) return;
        if (token.type === 'key') {
            const value = token.field && row ? row[token.field] ?? '' : '';
            if (Array.isArray(value)) {
                text += tokensToPlainText(value, row);
                return;
            }
            if (value && typeof value === 'object' && value.type) {
                text += tokensToPlainText([value], row);
                return;
            }
            text += String(value ?? '');
            return;
        }
        if (token.type === 'listkey') {
            const entries = normalizeTokenMatrix(row ? row[token.field] : null);
            const separatorTokens = normalizeTokenArray(token.separatorTokens);
            const separatorText = separatorTokens.length
                ? tokensToPlainText(separatorTokens, row)
                : '';
            entries.forEach((entryTokens, idx) => {
                if (idx > 0) {
                    text += separatorText;
                }
                text += tokensToPlainText(entryTokens, row);
            });
            return;
        }
        if (token.type === 'katex') {
            const value = token.value != null ? token.value : token.field && row ? row[token.field] ?? '' : '';
            text += String(value ?? '');
            return;
        }
        if (token.type === 'smiles') {
            const value = token.value != null ? token.value : token.field && row ? row[token.field] ?? '' : '';
            text += String(value ?? '');
            return;
        }
        if (token.type === 'ruby') {
            text += resolveSubTokenValue(token.base, row);
            return;
        }
        if (token.type === 'hide') {
            if (token.value) {
                text += tokensToPlainText(token.value, row);
            }
            return;
        }
        if (token.type === 'br') {
            text += '\n';
        }
        if (token.type === 'hr') {
            text += '\n';
        }
    });
    return text.trim();
}

export function resolveQuestionContext(question, dataSets) {
    if (!question.meta || !question.meta.dataSetId) return null;
    const ds = dataSets[question.meta.dataSetId];
    if (!ds) return null;
    if (ds.type === 'table' && Array.isArray(ds.data)) {
        return ds.data.find((row) => row.id === question.meta.entityId) || null;
    }
    return null;
}

export function optionToText(option, dataSets, question) {
    if (!option) return '';
    if (option.label) return String(option.label);
    const sourceDataSetId = option.dataSetId || (question.meta && question.meta.dataSetId);
    const ds = sourceDataSetId && dataSets ? dataSets[sourceDataSetId] : null;
    const row = option.entityId && ds
        ? ds.type === 'table' && Array.isArray(ds.data)
            ? ds.data.find((r) => r.id === option.entityId)
            : null
        : null;
    if (option.labelTokens) {
        return tokensToPlainText(option.labelTokens, row);
    }
    if (option.displayKey) {
        return String(option.displayKey);
    }
    if (row && row.nameEnCap) {
        return String(row.nameEnCap);
    }
    return '';
}

export function summarizeQuestion(question, dataSets) {
    const contextRow = resolveQuestionContext(question, dataSets);
    return tokensToPlainText(question.tokens || [], contextRow);
}
