import { parseContentToSegments } from './ruby-parser.js';

function contentSegmentsToPlainText(segments) {
    let text = '';
    (segments || []).forEach((segment) => {
        if (!segment || !segment.kind) return;
        if (segment.kind === 'Plain') {
            text += segment.text || '';
            return;
        }
        if (segment.kind === 'Annotated') {
            text += segment.base || '';
            return;
        }
        if (segment.kind === 'Term') {
            text += contentSegmentsToPlainText(segment.children || []);
            if (segment.english) {
                text += ` (${segment.english})`;
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

export function resolveSubTokenValue(spec, row) {
    if (!spec) return '';
    const source = spec.source || spec.type || 'text';
    if (source === 'key') {
        return row && spec.field ? row[spec.field] ?? '' : '';
    }
    return spec.value ?? '';
}

export function tokensToPlainText(tokens, row) {
    let text = '';
    (tokens || []).forEach((token) => {
        if (!token || !token.type) return;
        if (token.type === 'text') {
            text += token.value ?? '';
            return;
        }
        if (token.type === 'content') {
            const raw = token.value != null ? String(token.value) : '';
            text += contentSegmentsToPlainText(parseContentToSegments(raw));
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
        if (token.type === 'ruby' || token.type === 'hideruby') {
            text += resolveSubTokenValue(token.base, row);
            return;
        }
        if (token.type === 'hide') {
            if (token.value) {
                if (Array.isArray(token.value)) {
                    text += tokensToPlainText(token.value, row);
                } else if (token.value && typeof token.value === 'object') {
                    text += tokensToPlainText([token.value], row);
                }
            } else if (token.field && row) {
                text += row[token.field] ?? '';
            }
            return;
        }
        if (token.type === 'group') {
            text += tokensToPlainText(token.value || [], row);
            return;
        }
        if (token.type === 'br') {
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
    if (ds.type === 'factSentences' && Array.isArray(ds.sentences)) {
        return ds.sentences.find((s) => s.id === question.meta.sentenceId) || null;
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
            : ds.type === 'factSentences' && Array.isArray(ds.sentences)
                ? ds.sentences.find((s) => s.id === option.entityId)
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
