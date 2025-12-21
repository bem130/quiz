import { saveDraft, getAllDrafts, getDraft } from './db.js';
import { parseJsonWithLoc } from './json-loc-parser.js';
import { buildDefinitionFromQuizFile, validateDefinition } from './quiz-model.js';
import { parseContentToSegments } from './ruby-parser.js';
import { renderSmilesInline } from './chem-renderer.js';
import { tokenizeKatex } from './katex-parser.js';

// Preview shows rendered output + JSON view with click-to-jump support.

let editor = null;
let currentDraftPath = 'drafts/local-draft.json';
let lastParsedAst = null;
let lastSourceText = '';
let lastSourceMapCache = new Map();
let activePreviewTab = 'rendered';
let activeRowIndex = null;
let activeCursorOffset = null;
let rubyGlossDecorations = null;
let jsonPreviewState = null;
let jsonCursorRaf = null;
let toolbarInitialized = false;
let previewTabsInitialized = false;
let explorerInitialized = false;
let parseTimer = null;
let renderTimer = null;
let validateTimer = null;
let jsonPreviewTimer = null;
let decorationsSchedule = null;
let pendingSourceText = '';
let lastParsedText = '';
let lastParseErrors = [];
let lastRenderedSnapshot = { text: null, rowIndex: null };
let lastDecorationSnapshot = { text: null, ast: null };
let lastValidatedText = null;
let jsonPreviewDirty = false;

const PARSE_DEBOUNCE_MS = 140;
const RENDER_DEBOUNCE_MS = 140;
const VALIDATE_DEBOUNCE_MS = 240;
const JSON_PREVIEW_DEBOUNCE_MS = 120;

function getMonacoTheme() {
    const theme = document.documentElement.dataset.theme;
    return theme === 'dark' || theme === 'black' ? 'vs-dark' : 'vs';
}

// Monaco Loader
function loadMonaco() {
    return new Promise((resolve) => {
        if (window.monaco) return resolve();
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js';
        script.onload = () => {
            require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
            require(['vs/editor/editor.main'], () => {
                resolve();
            });
        };
        document.body.appendChild(script);
    });
}

export async function initDraftEditor(containerId) {
    await loadMonaco();

    const container = document.getElementById(containerId);
    if (!container) return;

    const savedPath = window.localStorage
        ? window.localStorage.getItem('draftEditorPath')
        : null;
    if (savedPath) {
        currentDraftPath = savedPath;
    }

    if (!editor) {
        editor = monaco.editor.create(container, {
            value: '',
            language: 'json',
            theme: getMonacoTheme(),
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false
        });
    }

    if (!rubyGlossDecorations) {
        rubyGlossDecorations = editor.createDecorationsCollection([]);
    }

    // Theme sync
    const obs = new MutationObserver(() => {
        monaco.editor.setTheme(getMonacoTheme());
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    // Change listener
    editor.onDidChangeModelContent(() => {
        const val = editor.getValue();
        handleContentChange(val);
    });
    editor.onDidChangeCursorPosition(() => {
        const offset = getCurrentCursorOffset();
        handleCursorChange(offset);
    });

    attachEditorToolbarHandlers();
    attachExplorerHandlers();
    attachPreviewTabHandlers();
    await refreshPathList();
    await loadDraftByPath(currentDraftPath);
    setPreviewTab(activePreviewTab);
}

// Debounce save
let saveTimer = null;
function handleContentChange(jsonText) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveDraft({
            path: currentDraftPath,
            data: jsonText,
            updatedAt: new Date().toISOString()
        });
    }, 1000);

    pendingSourceText = jsonText;
    lastSourceText = jsonText;
    jsonPreviewDirty = true;
    scheduleParseUpdate();
}

function scheduleParseUpdate() {
    if (parseTimer) clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
        parseTimer = null;
        runParseUpdate(pendingSourceText);
    }, PARSE_DEBOUNCE_MS);
}

function runParseUpdate(jsonText) {
    lastSourceText = jsonText;
    lastSourceMapCache = new Map();

    let parsed = null;
    let parseErrors = [];
    try {
        parsed = parseJsonWithLoc(jsonText);
        parseErrors = parsed && Array.isArray(parsed.errors) ? parsed.errors : [];
    } catch (e) {
        parseErrors = [{ message: e.message || 'Unknown syntax error.' }];
    }

    lastParsedAst = parsed;
    lastParsedText = jsonText;
    lastParseErrors = parseErrors;
    activeCursorOffset = getCurrentCursorOffset();
    activeRowIndex = findTableRowIndexForOffset(lastParsedAst, activeCursorOffset);

    if (parseErrors.length) {
        setDraftStatus(`Syntax Error: ${parseErrors[0].message}`, 'app-text-danger');
    } else {
        setDraftStatus('Checking schema...', 'app-text-muted');
    }

    scheduleDecorations();
    if (activePreviewTab === 'rendered') {
        scheduleRenderedPreview();
    }
    scheduleValidation();
    if (activePreviewTab === 'json') {
        scheduleJsonPreview();
    }
}

function scheduleDecorations() {
    if (decorationsSchedule) {
        if (decorationsSchedule.type === 'idle') {
            window.cancelIdleCallback(decorationsSchedule.id);
        } else {
            clearTimeout(decorationsSchedule.id);
        }
        decorationsSchedule = null;
    }
    const run = () => {
        decorationsSchedule = null;
        updateRubyGlossDecorations();
    };
    if (window.requestIdleCallback) {
        decorationsSchedule = {
            type: 'idle',
            id: window.requestIdleCallback(run, { timeout: 200 })
        };
    } else {
        decorationsSchedule = { type: 'timeout', id: setTimeout(run, 120) };
    }
}

function scheduleRenderedPreview() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
        renderTimer = null;
        updateRenderedPreview();
    }, RENDER_DEBOUNCE_MS);
}

function updateRenderedPreview() {
    if (activePreviewTab !== 'rendered') return;
    const renderedContainer = document.getElementById('draft-preview-rendered');
    if (!renderedContainer) return;

    if (lastParsedText !== lastSourceText) {
        return;
    }

    if (!lastParsedAst || !lastParsedAst.value) {
        renderedContainer.innerHTML = '';
        return;
    }

    if (
        lastRenderedSnapshot.text === lastSourceText &&
        lastRenderedSnapshot.rowIndex === activeRowIndex
    ) {
        return;
    }

    renderedContainer.innerHTML = '';
    if (lastParseErrors && lastParseErrors.length) {
        const note = document.createElement('div');
        note.className = 'text-xs app-text-danger';
        note.textContent = 'Preview is based on recovered JSON and may be incomplete.';
        renderedContainer.appendChild(note);
    }
    renderRenderedPreview(lastParsedAst.value, renderedContainer, { rowIndex: activeRowIndex });
    lastRenderedSnapshot = { text: lastSourceText, rowIndex: activeRowIndex };
}

function scheduleValidation() {
    if (validateTimer) clearTimeout(validateTimer);
    if (lastParseErrors && lastParseErrors.length) {
        lastValidatedText = null;
        return;
    }
    validateTimer = setTimeout(() => {
        validateTimer = null;
        runValidation();
    }, VALIDATE_DEBOUNCE_MS);
}

function runValidation() {
    if (!lastParsedAst || !lastParsedAst.value) return;
    if (lastValidatedText === lastSourceText) return;
    lastValidatedText = lastSourceText;
    try {
        const definition = buildDefinitionFromQuizFile(lastParsedAst.value, 'draft', {
            title: lastParsedAst.value && lastParsedAst.value.title ? lastParsedAst.value.title : 'Preview'
        });
        validateDefinition(definition);
        setDraftStatus('Valid JSON', 'app-text-success');
    } catch (e) {
        setDraftStatus(`Invalid Schema: ${e.message}`, 'app-text-accent');
    }
}

function scheduleJsonPreview(immediate = false) {
    const jsonContainer = document.getElementById('draft-preview-json');
    if (!jsonContainer || activePreviewTab !== 'json') return;

    if (
        !jsonPreviewDirty &&
        jsonPreviewState &&
        jsonPreviewState.text === lastSourceText &&
        jsonPreviewState.container === jsonContainer
    ) {
        updateJsonCursor(activeCursorOffset);
        return;
    }

    if (jsonPreviewTimer) clearTimeout(jsonPreviewTimer);
    const delay = immediate ? 0 : JSON_PREVIEW_DEBOUNCE_MS;
    jsonPreviewTimer = setTimeout(() => {
        jsonPreviewTimer = null;
        if (activePreviewTab !== 'json') return;
        renderJsonPreview(lastSourceText || '', jsonContainer, activeCursorOffset);
        jsonPreviewDirty = false;
    }, delay);
}

function getCurrentCursorOffset() {
    if (!editor) return null;
    const model = editor.getModel();
    if (!model) return null;
    const position = editor.getPosition();
    if (!position) return null;
    return model.getOffsetAt(position);
}

function handleCursorChange(offset) {
    activeCursorOffset = offset;
    const renderedContainer = document.getElementById('draft-preview-rendered');
    if (activePreviewTab === 'json') {
        scheduleJsonCursorUpdate();
    }
    if (!lastParsedAst || !renderedContainer) return;
    if (lastParsedText !== lastSourceText) return;
    if (!lastParsedAst.value) return;
    const nextRowIndex = findTableRowIndexForOffset(lastParsedAst, activeCursorOffset);
    if (nextRowIndex !== activeRowIndex) {
        activeRowIndex = nextRowIndex;
        if (activePreviewTab !== 'rendered') return;
        renderedContainer.innerHTML = '';
        if (lastParseErrors && lastParseErrors.length) {
            const note = document.createElement('div');
            note.className = 'text-xs app-text-danger';
            note.textContent = 'Preview is based on recovered JSON and may be incomplete.';
            renderedContainer.appendChild(note);
        }
        renderRenderedPreview(lastParsedAst.value, renderedContainer, { rowIndex: activeRowIndex });
        lastRenderedSnapshot = { text: lastSourceText, rowIndex: activeRowIndex };
    }
}

function scheduleJsonCursorUpdate() {
    if (jsonCursorRaf) return;
    jsonCursorRaf = window.requestAnimationFrame(() => {
        jsonCursorRaf = null;
        updateJsonCursor(activeCursorOffset);
    });
}

function findTableRowIndexForOffset(ast, offset) {
    if (!ast || offset == null) return null;
    const tableNode = findNodeByPath(ast, ['table']);
    if (!tableNode || tableNode.type !== 'Array') return null;
    for (let i = 0; i < tableNode.children.length; i += 1) {
        const rowNode = tableNode.children[i];
        if (!rowNode || !rowNode.loc) continue;
        if (offset >= rowNode.loc.start.offset && offset <= rowNode.loc.end.offset) {
            return i;
        }
    }
    return null;
}

function updateRubyGlossDecorations() {
    if (!editor || !rubyGlossDecorations) return;
    if (lastDecorationSnapshot.text === lastSourceText && lastDecorationSnapshot.ast === lastParsedAst) {
        return;
    }
    const model = editor.getModel();
    if (!model) return;
    const decorations = [];
    const stringNodes = lastParsedAst && lastParsedText === lastSourceText
        ? collectStringNodes(lastParsedAst, [])
        : scanStringNodesFromRaw(lastSourceText || '');

    const addDelimiterDecoration = (node, index, className) => {
        if (!node || index == null) return;
        const rawOffset = getOffsetForStringIndex(node, index);
        if (rawOffset == null) return;
        const startPos = model.getPositionAt(rawOffset);
        const endPos = model.getPositionAt(rawOffset + 1);
        decorations.push({
            range: new monaco.Range(
                startPos.lineNumber,
                startPos.column,
                endPos.lineNumber,
                endPos.column
            ),
            options: { inlineClassName: className }
        });
    };

    const addRangeDecoration = (node, startIndex, endIndex, className) => {
        if (!node || startIndex == null || endIndex == null) return;
        const rawRange = getRawRangeForStringIndices(node, startIndex, endIndex);
        if (!rawRange) return;
        const startPos = model.getPositionAt(rawRange.start);
        const endPos = model.getPositionAt(rawRange.end);
        decorations.push({
            range: new monaco.Range(
                startPos.lineNumber,
                startPos.column,
                endPos.lineNumber,
                endPos.column
            ),
            options: { inlineClassName: className }
        });
    };

    const addMathDecorations = (node, seg) => {
        if (!seg || !seg.range) return;
        const delimLen = seg.display ? 2 : 1;
        // Base decoration for math content ground color
        addRangeDecoration(node, seg.range.start, seg.range.end, 'katex-content');

        // Highlighting for opening delimiter
        addDelimiterDecoration(node, seg.range.start, 'katex-delimiter');
        if (delimLen === 2) addDelimiterDecoration(node, seg.range.start + 1, 'katex-delimiter');

        // Highlighting for closing delimiter
        addDelimiterDecoration(node, seg.range.end - delimLen, 'katex-delimiter');
        if (delimLen === 2) addDelimiterDecoration(node, seg.range.end - 1, 'katex-delimiter');

        const contentStart = seg.range.start + delimLen;
        const contentEnd = seg.range.end - delimLen;
        if (contentStart < contentEnd) {
            const tex = seg.tex || "";
            const internalSegments = tokenizeKatex(tex, contentStart);
            internalSegments.forEach((iseg) => {
                let className = null;
                if (iseg.kind === 'Command') className = 'katex-command';
                else if (iseg.kind === 'Brace') className = 'katex-brace';
                else if (iseg.kind === 'Symbol') className = 'katex-symbol';
                else if (iseg.kind === 'Comment') className = 'katex-comment';

                if (className) {
                    addRangeDecoration(node, iseg.start, iseg.end, className);
                }
            });
        }
    };

    const addRubyDecorations = (node, seg) => {
        if (!seg || !seg.range) return;
        if (seg.baseRange) addRangeDecoration(node, seg.baseRange.start, seg.baseRange.end, 'ruby-base-content');
        if (seg.openDelimRange) addRangeDecoration(node, seg.openDelimRange.start, seg.openDelimRange.end, 'ruby-delimiter');
        if (seg.slashRange) addRangeDecoration(node, seg.slashRange.start, seg.slashRange.end, 'ruby-delimiter');
        if (seg.closeDelimRange) addRangeDecoration(node, seg.closeDelimRange.start, seg.closeDelimRange.end, 'ruby-delimiter');

        if (Array.isArray(seg.base)) {
            seg.base.forEach(child => {
                if (child.kind === 'Math') addMathDecorations(node, child);
                else if (child.kind === 'Plain') addRangeDecoration(node, child.range.start, child.range.end, 'ruby-content');
                else if (child.kind === 'Escape') addRangeDecoration(node, child.range.start, child.range.end, 'json-escape');
                else if (child.kind === 'Annotated') addRubyDecorations(node, child);
            });
        }

        if (seg.rubyRange) {
            addRangeDecoration(node, seg.rubyRange.start, seg.rubyRange.end, 'ruby-content');
        }
    };

    const addGlossDecorations = (node, seg) => {
        if (!seg || !seg.range) return;
        if (seg.openDelimRange) addRangeDecoration(node, seg.openDelimRange.start, seg.openDelimRange.end, 'gloss-delimiter');
        if (Array.isArray(seg.slashRanges)) {
            seg.slashRanges.forEach(r => addRangeDecoration(node, r.start, r.end, 'gloss-delimiter'));
        }
        if (seg.closeDelimRange) addRangeDecoration(node, seg.closeDelimRange.start, seg.closeDelimRange.end, 'gloss-delimiter');

        addSegmentsToDecorations(node, seg.base, 'gloss-content', true);
        (seg.glosses || []).forEach(alt => addSegmentsToDecorations(node, alt, 'gloss-content'));
    };

    const addSegmentsToDecorations = (node, segments, defaultContentClass, isGlossBase = false) => {
        (segments || []).forEach(seg => {
            if (!seg || !seg.range) return;
            if (seg.kind === 'Annotated') addRubyDecorations(node, seg);
            else if (seg.kind === 'Gloss') addGlossDecorations(node, seg);
            else if (seg.kind === 'Math') addMathDecorations(node, seg);
            else if (seg.kind === 'Plain') {
                if (defaultContentClass) addRangeDecoration(node, seg.range.start, seg.range.end, defaultContentClass);
                if (isGlossBase) addRangeDecoration(node, seg.range.start, seg.range.end, 'gloss-base-content');
            } else if (seg.kind === 'Escape') {
                addRangeDecoration(node, seg.range.start, seg.range.end, 'json-escape');
            }
        });
    };

    stringNodes.forEach(node => {
        if (!node || typeof node.value !== 'string') return;
        const segments = parseContentToSegments(node.value);

        // Detect if there's any rich content (Ruby, Gloss, or Math)
        const hasRichContent = segments.some(seg =>
            seg.kind === 'Annotated' || seg.kind === 'Gloss' || seg.kind === 'Math'
        );

        if (hasRichContent) {
            // Apply rich string base color (white/theme-gray) to override default orange
            addRangeDecoration(node, 0, node.value.length, 'json-token-string-rich');
        }

        addSegmentsToDecorations(node, segments, null);
    });
    rubyGlossDecorations.set(decorations);
    lastDecorationSnapshot = { text: lastSourceText, ast: lastParsedAst };
}

function collectStringNodes(node, list = []) {
    if (!node) return list;
    if (node.type === 'String') {
        list.push(node);
        return list;
    }
    if (node.type === 'Property') {
        collectStringNodes(node.key, list);
        collectStringNodes(node.value, list);
        return list;
    }
    if (node.type === 'Object' || node.type === 'Array') {
        (node.children || []).forEach(child => {
            collectStringNodes(child, list);
        });
    }
    return list;
}

function collectStringNodesWithMeta(node, list = []) {
    if (!node) return list;
    if (node.type === 'String') {
        list.push({ node, isKey: false });
        return list;
    }
    if (node.type === 'Property') {
        if (node.key && node.key.type === 'String') {
            list.push({ node: node.key, isKey: true });
        }
        collectStringNodesWithMeta(node.value, list);
        return list;
    }
    if (node.type === 'Object' || node.type === 'Array') {
        (node.children || []).forEach(child => {
            collectStringNodesWithMeta(child, list);
        });
    }
    return list;
}

function decodeJsonStringContent(rawText) {
    let decoded = '';
    const map = [];
    let rawIndex = 0;
    let decodedIndex = 0;

    while (rawIndex < rawText.length) {
        const ch = rawText[rawIndex];
        if (ch === '\\') {
            const next = rawText[rawIndex + 1];
            if (next === 'u' && rawIndex + 5 < rawText.length) {
                const hex = rawText.slice(rawIndex + 2, rawIndex + 6);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                    decoded += String.fromCharCode(parseInt(hex, 16));
                    map[decodedIndex] = rawIndex;
                    decodedIndex += 1;
                    rawIndex += 6;
                    continue;
                }
            }
            let decodedChar = next;
            if (next === 'n') decodedChar = '\n';
            else if (next === 'r') decodedChar = '\r';
            else if (next === 't') decodedChar = '\t';
            else if (next === 'b') decodedChar = '\b';
            else if (next === 'f') decodedChar = '\f';
            else if (next === '"') decodedChar = '"';
            else if (next === '\\') decodedChar = '\\';
            else if (next === '/') decodedChar = '/';

            if (next != null) {
                decoded += decodedChar;
                map[decodedIndex] = rawIndex;
                decodedIndex += 1;
                rawIndex += 2;
                continue;
            }
        }

        decoded += ch;
        map[decodedIndex] = rawIndex;
        decodedIndex += 1;
        rawIndex += 1;
    }

    return { decoded, map };
}

function scanStringNodesFromRaw(rawText) {
    const nodes = [];
    if (!rawText) return nodes;
    let inString = false;
    let escape = false;
    let start = 0;

    for (let i = 0; i < rawText.length; i += 1) {
        const ch = rawText[i];
        if (inString) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"') {
                const content = rawText.slice(start + 1, i);
                const { decoded, map } = decodeJsonStringContent(content);
                const node = {
                    type: 'String',
                    value: decoded,
                    loc: {
                        start: { offset: start },
                        end: { offset: i + 1 }
                    }
                };
                node.__rawMap = map;
                nodes.push(node);
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            start = i;
        }
    }

    if (inString && start < rawText.length - 1) {
        const content = rawText.slice(start + 1);
        const { decoded, map } = decodeJsonStringContent(content);
        const node = {
            type: 'String',
            value: decoded,
            loc: {
                start: { offset: start },
                end: { offset: rawText.length }
            }
        };
        node.__rawMap = map;
        nodes.push(node);
    }

    return nodes;
}

function appendPlainText(parent, text) {
    if (!text) return;
    parent.appendChild(document.createTextNode(text));
}

function appendCursorMarker(parent, cursorState) {
    if (!cursorState) return;
    const marker = document.createElement('span');
    marker.className = 'json-cursor';
    parent.appendChild(marker);
    cursorState.inserted = true;
    cursorState.element = marker;
}

function appendJsonToken(parent, text, startOffset, className, state) {
    if (!text) return;
    const span = document.createElement('span');
    if (className) {
        span.className = className;
    }
    span.textContent = text;
    parent.appendChild(span);
    if (state) {
        state.tokenRanges.push({
            start: startOffset,
            end: startOffset + text.length,
            element: span
        });
    }
}

function getTokenClass(tokenText, bracketDepth) {
    if (/^\s+$/.test(tokenText)) return null;
    if (/^[{}\[\]]$/.test(tokenText)) {
        const level = bracketDepth % 6;
        return `json-token-punct json-bracket-${level}`;
    }
    if (tokenText === ':' || tokenText === ',') return 'json-token-punct';
    if (tokenText === 'true' || tokenText === 'false') return 'json-token-boolean';
    if (tokenText === 'null') return 'json-token-null';
    if (/^-?\d/.test(tokenText)) return 'json-token-number';
    return null;
}

function appendJsonTextSegment(parent, text, startOffset, state) {
    if (!text) return;
    const tokenRegex = /\s+|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/g;
    let lastIndex = 0;
    let match;
    let bracketDepth = state && state.bracketDepth != null ? state.bracketDepth : 0;

    while ((match = tokenRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            appendJsonToken(
                parent,
                text.slice(lastIndex, match.index),
                startOffset + lastIndex,
                null,
                state
            );
        }
        const tokenText = match[0];

        // Update bracket depth
        if (tokenText === '{' || tokenText === '[') {
            const tokenClass = getTokenClass(tokenText, bracketDepth);
            appendJsonToken(
                parent,
                tokenText,
                startOffset + match.index,
                tokenClass,
                state
            );
            bracketDepth++;
        } else if (tokenText === '}' || tokenText === ']') {
            bracketDepth = Math.max(0, bracketDepth - 1);
            const tokenClass = getTokenClass(tokenText, bracketDepth);
            appendJsonToken(
                parent,
                tokenText,
                startOffset + match.index,
                tokenClass,
                state
            );
        } else {
            appendJsonToken(
                parent,
                tokenText,
                startOffset + match.index,
                getTokenClass(tokenText, bracketDepth),
                state
            );
        }
        lastIndex = match.index + tokenText.length;
    }
    if (lastIndex < text.length) {
        appendJsonToken(
            parent,
            text.slice(lastIndex),
            startOffset + lastIndex,
            null,
            state
        );
    }

    // Update state bracket depth
    if (state) {
        state.bracketDepth = bracketDepth;
    }
}

function getDecodedIndexForRawOffset(node, rawOffset) {
    if (!node || !node.loc) return null;
    const rawStart = node.loc.start.offset + 1;
    const rawEnd = node.loc.end.offset - 1;
    if (rawOffset == null || rawOffset < rawStart) return 0;
    if (rawOffset >= rawEnd) return (node.value || '').length;
    const map = getStringOffsetMap(node);
    if (!map || map.length === 0) {
        return Math.max(0, rawOffset - rawStart);
    }
    let index = 0;
    for (let i = 0; i < map.length; i += 1) {
        if (map[i] < rawOffset) {
            index = i + 1;
        } else {
            break;
        }
    }
    return index;
}

function appendJsonStringSegment(parent, node, isKey, state) {
    if (!node || !node.loc) return;
    const rawStart = node.loc.start.offset;
    const rawEnd = node.loc.end.offset;
    const rawValue = node.value != null ? String(node.value) : '';
    const segments = parseContentToSegments(rawValue);
    const hasRichContent = segments.some(
        (seg) => seg && (seg.kind === 'Annotated' || seg.kind === 'Gloss' || seg.kind === 'Math')
    );
    const stringClass = isKey
        ? 'json-token-string json-token-key'
        : `json-token-string${hasRichContent ? ' json-token-string-rich' : ''}`;
    appendJsonToken(parent, '"', rawStart, stringClass, state);

    const contentWrapper = document.createElement('span');
    contentWrapper.className = stringClass;
    renderStringValue(contentWrapper, rawValue, node, [], 'decoded', null, null, segments, true);
    parent.appendChild(contentWrapper);

    appendJsonToken(parent, '"', rawEnd - 1, stringClass, state);
}

function renderPlainJsonPreview(container, jsonText, state) {
    const frag = document.createDocumentFragment();
    appendJsonTextSegment(frag, jsonText, 0, state);
    container.appendChild(frag);
}

function buildJsonPreview(jsonText, container) {
    container.innerHTML = '';
    container.classList.add('json-preview');
    const state = {
        text: jsonText,
        container,
        tokenRanges: [],
        offsetMap: new Map(),
        cursorOverlay: null,
        bracketDepth: 0
    };
    if (!lastParsedAst || !lastParsedAst.loc || lastParsedText !== lastSourceText) {
        renderPlainJsonPreview(container, jsonText, state);
        return state;
    }

    const stringNodes = collectStringNodesWithMeta(lastParsedAst, []);
    stringNodes.sort((a, b) => a.node.loc.start.offset - b.node.loc.start.offset);

    const frag = document.createDocumentFragment();
    let cursor = 0;

    stringNodes.forEach((entry) => {
        const node = entry.node;
        if (!node || !node.loc) return;
        const start = node.loc.start.offset;
        const end = node.loc.end.offset;
        if (start < cursor) return;

        appendJsonTextSegment(frag, jsonText.slice(cursor, start), cursor, state);
        appendJsonStringSegment(frag, node, entry.isKey, state);
        cursor = end;
    });

    appendJsonTextSegment(frag, jsonText.slice(cursor), cursor, state);
    container.appendChild(frag);

    const offsetNodes = container.querySelectorAll('[data-source-offset]');
    offsetNodes.forEach((node) => {
        const offsetValue = node.dataset ? node.dataset.sourceOffset : null;
        if (!offsetValue) return;
        const offset = Number(offsetValue);
        if (!Number.isNaN(offset) && !state.offsetMap.has(offset)) {
            state.offsetMap.set(offset, node);
        }
    });

    return state;
}

function ensureJsonPreview(jsonText, container) {
    if (!jsonPreviewState || jsonPreviewState.text !== jsonText || jsonPreviewState.container !== container) {
        jsonPreviewState = buildJsonPreview(jsonText, container);
    }
    return jsonPreviewState;
}

function findTokenRangeByOffset(offset, ranges) {
    if (!ranges || !ranges.length) return null;
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const entry = ranges[mid];
        if (offset < entry.start) {
            high = mid - 1;
        } else if (offset > entry.end) {
            low = mid + 1;
        } else {
            return entry;
        }
    }
    return null;
}

function ensureJsonCursorOverlay(state) {
    if (!state.cursorOverlay) {
        const overlay = document.createElement('span');
        overlay.className = 'json-cursor-overlay';
        overlay.style.display = 'none';
        state.container.appendChild(overlay);
        state.cursorOverlay = overlay;
    }
    return state.cursorOverlay;
}

function positionCursorOverlay(overlay, container, rect) {
    const containerRect = container.getBoundingClientRect();
    const left = rect.left - containerRect.left + container.scrollLeft;
    const top = rect.top - containerRect.top + container.scrollTop;
    overlay.style.display = 'block';
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.height = `${rect.height || 16}px`;
}

function updateJsonCursor(offset) {
    if (!jsonPreviewState || activePreviewTab !== 'json') return;
    const state = jsonPreviewState;
    const container = state.container;
    if (!container) return;
    const overlay = ensureJsonCursorOverlay(state);
    if (offset == null) {
        overlay.style.display = 'none';
        return;
    }

    let target = state.offsetMap.get(offset);
    if (!target && offset > 0) {
        target = state.offsetMap.get(offset - 1);
    }

    if (target) {
        positionCursorOverlay(overlay, container, target.getBoundingClientRect());
        return;
    }

    const tokenEntry = findTokenRangeByOffset(offset, state.tokenRanges);
    if (!tokenEntry || !tokenEntry.element) {
        overlay.style.display = 'none';
        return;
    }

    const textNode = tokenEntry.element.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        const localOffset = Math.max(0, Math.min(textNode.length, offset - tokenEntry.start));
        const range = document.createRange();
        range.setStart(textNode, localOffset);
        range.setEnd(textNode, localOffset);
        const rects = range.getClientRects();
        const rect = rects[0] || tokenEntry.element.getBoundingClientRect();
        positionCursorOverlay(overlay, container, rect);
    } else {
        positionCursorOverlay(overlay, container, tokenEntry.element.getBoundingClientRect());
    }
}

function renderJsonPreview(jsonText, container, cursorOffset = null) {
    ensureJsonPreview(jsonText, container);
    updateJsonCursor(cursorOffset);
}

// Map rendered elements back to JSON location
function findNodeByPath(ast, path) {
    // path is array of keys/indices
    // e.g. ['patterns', 0, 'id']
    // We navigate the AST children.

    let current = ast;
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        if (!current.children) return null;

        if (current.type === 'Object') {
            const prop = current.children.find(c => c.key.value === key);
            if (!prop) return null;
            current = prop.value;
        } else if (current.type === 'Array') {
            if (typeof key !== 'number') return null;
            if (key >= current.children.length) return null;
            current = current.children[key];
        } else {
            return null;
        }
    }
    return current;
}

function attachJump(element, offset) {
    if (!element || offset == null) return;
    element.classList.add('cursor-pointer');
    element.dataset.sourceOffset = String(offset);
    element.addEventListener('click', (event) => {
        event.stopPropagation();
        jumpToOffset(offset);
    });
}

function getStringOffsetMap(node) {
    if (!node || node.type !== 'String' || !node.loc) return null;
    if (node.__rawMap) {
        return node.__rawMap;
    }
    const key = `${node.loc.start.offset}:${node.loc.end.offset}`;
    if (lastSourceMapCache.has(key)) {
        return lastSourceMapCache.get(key);
    }
    const raw = lastSourceText;
    const start = node.loc.start.offset;
    const end = node.loc.end.offset;
    const map = [];
    let rawIndex = start + 1;
    let decodedIndex = 0;

    while (rawIndex < end - 1) {
        const ch = raw[rawIndex];
        if (ch === '\\') {
            const next = raw[rawIndex + 1];
            if (next === 'u') {
                const hex = raw.slice(rawIndex + 2, rawIndex + 6);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                    map[decodedIndex] = rawIndex;
                    rawIndex += 6;
                    decodedIndex += 1;
                    continue;
                }
            }
            if (next) {
                map[decodedIndex] = rawIndex;
                rawIndex += 2;
                decodedIndex += 1;
                continue;
            }
        }
        map[decodedIndex] = rawIndex;
        rawIndex += 1;
        decodedIndex += 1;
    }

    lastSourceMapCache.set(key, map);
    return map;
}

function getRawRangeForStringIndices(node, startIndex, endIndex) {
    if (!node || !node.loc) return null;
    if (startIndex == null || endIndex == null) return null;
    if (node.type !== 'String') {
        return {
            start: node.loc.start.offset,
            end: node.loc.end.offset
        };
    }
    const map = getStringOffsetMap(node);
    const rawStart =
        map && map[startIndex] != null
            ? map[startIndex]
            : node.loc.start.offset + 1 + startIndex;
    let rawEnd;
    if (map) {
        if (map[endIndex] != null) {
            rawEnd = map[endIndex];
        } else if (endIndex >= map.length) {
            rawEnd = node.loc.end.offset - 1;
        } else {
            rawEnd = node.loc.start.offset + 1 + endIndex;
        }
    } else {
        rawEnd = node.loc.start.offset + 1 + endIndex;
    }
    if (rawEnd < rawStart) rawEnd = rawStart;
    return { start: rawStart, end: rawEnd };
}

function getOffsetForStringIndex(node, index) {
    if (!node || !node.loc) return null;
    if (node.type !== 'String') {
        return node.loc.start.offset;
    }
    const map = getStringOffsetMap(node);
    if (map && map[index] != null) {
        return map[index];
    }
    return node.loc.start.offset + 1 + index;
}

function getOffsetForIndex(node, index, mode) {
    if (!node || !node.loc) return null;
    if (mode === 'raw') {
        return node.loc.start.offset + 1 + index;
    }
    return getOffsetForStringIndex(node, index);
}

function applyStyles(element, styles = []) {
    if (!styles || !styles.length) return;
    if (styles.includes('bold')) element.classList.add('font-semibold');
    if (styles.includes('italic')) element.classList.add('italic');
    if (styles.includes('serif')) element.classList.add('font-serif');
    if (styles.includes('sans')) element.classList.add('font-sans');
    if (styles.includes('muted')) element.classList.add('app-text-muted');
}

function createStyledSpan(text, styles = []) {
    const span = document.createElement('span');
    if (styles.includes('katex') && window.katex) {
        try {
            const isBlock = styles.includes('katex-block');
            const finalTex = (!isBlock && !text.includes('\\displaystyle'))
                ? '\\displaystyle ' + text
                : text;

            window.katex.render(finalTex, span, {
                throwOnError: false,
                strict: false,
                errorColor: '#cc0000',
                displayMode: isBlock
            });
            return span;
        } catch (e) {
            span.textContent = text;
        }
    }
    span.textContent = text;
    applyStyles(span, styles);
    return span;
}

function appendTextWithOffsets(
    parent,
    text,
    node,
    baseIndex = 0,
    styles = [],
    offsetMode = 'decoded',
    cursorState = null,
    cursorIndex = null
) {
    if (!text) return;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '\n') {
            if (cursorState && !cursorState.inserted && cursorIndex === baseIndex + i) {
                appendCursorMarker(parent, cursorState);
            }
            parent.appendChild(document.createElement('br'));
            continue;
        }
        if (cursorState && !cursorState.inserted && cursorIndex === baseIndex + i) {
            appendCursorMarker(parent, cursorState);
        }
        const span = createStyledSpan(ch, styles);
        const offset = node ? getOffsetForIndex(node, baseIndex + i, offsetMode) : null;
        attachJump(span, offset);
        parent.appendChild(span);
    }
    if (cursorState && !cursorState.inserted && cursorIndex === baseIndex + text.length) {
        appendCursorMarker(parent, cursorState);
    }
}

function renderInlineSegments(parent, segments, node, offsetMode = 'decoded', cursorState = null, cursorIndex = null, isJsonPreview = false) {
    (segments || []).forEach((seg) => {
        if (!seg || !seg.kind) return;
        if (seg.kind === 'Plain') {
            appendTextWithOffsets(
                parent,
                seg.text || '',
                node,
                seg.range ? seg.range.start : 0,
                [],
                offsetMode,
                cursorState,
                cursorIndex
            );
            return;
        }
        if (seg.kind === 'Math') {
            if (
                cursorState &&
                !cursorState.inserted &&
                cursorIndex != null &&
                seg.range &&
                cursorIndex >= seg.range.start &&
                cursorIndex <= seg.range.end
            ) {
                appendCursorMarker(parent, cursorState);
            }
            const styles = ['katex'];
            if (seg.display && !isJsonPreview) styles.push('katex-block');
            const span = createStyledSpan(seg.tex || '', styles);
            const offset = node && seg.range ? getOffsetForIndex(node, seg.range.start, offsetMode) : null;
            attachJump(span, offset);
            parent.appendChild(span);
            return;
        }
        if (seg.kind === 'Escape') {
            if (isJsonPreview) {
                const span = document.createElement('span');
                span.className = 'json-token-escape';
                span.textContent = seg.text;
                parent.appendChild(span);
            } else {
                parent.appendChild(document.createElement('br'));
            }
            return;
        }
    });
}

function renderGlossSegment(parent, seg, node, offsetMode = 'decoded', cursorState = null, cursorIndex = null, isJsonPreview = false) {
    const glossSpan = document.createElement('span');
    glossSpan.className = 'gloss';

    const rubyEl = document.createElement('ruby');
    (seg.base || []).forEach((child) => {
        if (!child || !child.kind) return;
        if (child.kind === 'Annotated') {
            const rb = document.createElement('rb');
            renderInlineSegments(rb, child.base || [], node, offsetMode, cursorState, cursorIndex, isJsonPreview);
            const rt = document.createElement('rt');
            appendTextWithOffsets(
                rt,
                child.reading || '',
                node,
                child.rubyRange ? child.rubyRange.start : 0,
                [],
                offsetMode,
                cursorState,
                cursorIndex
            );
            rubyEl.appendChild(rb);
            rubyEl.appendChild(rt);
            return;
        }
        if (child.kind === 'Math') {
            if (
                cursorState &&
                !cursorState.inserted &&
                cursorIndex != null &&
                child.range &&
                cursorIndex >= child.range.start &&
                cursorIndex <= child.range.end
            ) {
                appendCursorMarker(rubyEl, cursorState);
            }
            const styles = ['katex'];
            if (child.display && !isJsonPreview) styles.push('katex-block');
            const span = createStyledSpan(child.tex || '', styles);
            const offset = node && child.range ? getOffsetForIndex(node, child.range.start, offsetMode) : null;
            attachJump(span, offset);
            rb.appendChild(span);
            return;
        }
        if (child.kind === 'Plain') {
            const rb = document.createElement('rb');
            if (isJsonPreview) {
                rb.classList.add('json-gloss-base');
            }
            appendTextWithOffsets(
                rb,
                child.text || '',
                node,
                child.range ? child.range.start : 0,
                [],
                offsetMode,
                cursorState,
                cursorIndex
            );
            const rt = document.createElement('rt');
            rubyEl.appendChild(rb);
            rubyEl.appendChild(rt);
        }
    });
    glossSpan.appendChild(rubyEl);

    if (seg.glosses && seg.glosses.length) {
        const altsWrapper = document.createElement('span');
        altsWrapper.className = 'gloss-alts';
        seg.glosses.forEach((gloss) => {
            const altSpan = document.createElement('span');
            altSpan.className = 'gloss-alt';
            (gloss || []).forEach((child) => {
                if (!child || !child.kind) return;
                if (child.kind === 'Annotated') {
                    const ruby = document.createElement('ruby');
                    const rb = document.createElement('rb');
                    renderInlineSegments(rb, child.base || [], node, offsetMode, cursorState, cursorIndex, isJsonPreview);
                    const rt = document.createElement('rt');
                    appendTextWithOffsets(
                        rt,
                        child.reading || '',
                        node,
                        child.rubyRange ? child.rubyRange.start : 0,
                        [],
                        offsetMode,
                        cursorState,
                        cursorIndex
                    );
                    ruby.appendChild(rb);
                    ruby.appendChild(rt);
                    altSpan.appendChild(ruby);
                    return;
                }
                if (child.kind === 'Math') {
                    if (
                        cursorState &&
                        !cursorState.inserted &&
                        cursorIndex != null &&
                        child.range &&
                        cursorIndex >= child.range.start &&
                        cursorIndex <= child.range.end
                    ) {
                        appendCursorMarker(altSpan, cursorState);
                    }
                    const span = createStyledSpan(child.tex || '', ['katex']);
                    const offset = node && child.range ? getOffsetForIndex(node, child.range.start, offsetMode) : null;
                    attachJump(span, offset);
                    altSpan.appendChild(span);
                    return;
                }
                if (child.kind === 'Plain') {
                    appendTextWithOffsets(
                        altSpan,
                        child.text || '',
                        node,
                        child.range ? child.range.start : 0,
                        [],
                        offsetMode,
                        cursorState,
                        cursorIndex
                    );
                }
            });
            altsWrapper.appendChild(altSpan);
        });
        glossSpan.appendChild(altsWrapper);
    }
    parent.appendChild(glossSpan);
}

function renderSegments(parent, segments, node, offsetMode = 'decoded', cursorState = null, cursorIndex = null, isJsonPreview = false) {
    (segments || []).forEach((seg) => {
        if (!seg || !seg.kind) return;
        if (seg.kind === 'Plain') {
            appendTextWithOffsets(
                parent,
                seg.text || '',
                node,
                seg.range ? seg.range.start : 0,
                [],
                offsetMode,
                cursorState,
                cursorIndex
            );
            return;
        }
        if (seg.kind === 'Math') {
            if (
                cursorState &&
                !cursorState.inserted &&
                cursorIndex != null &&
                seg.range &&
                cursorIndex >= seg.range.start &&
                cursorIndex <= seg.range.end
            ) {
                appendCursorMarker(parent, cursorState);
            }
            const styles = ['katex'];
            if (seg.display && !isJsonPreview) styles.push('katex-block');
            const span = createStyledSpan(seg.tex || '', styles);
            const offset = node && seg.range ? getOffsetForIndex(node, seg.range.start, offsetMode) : null;
            attachJump(span, offset);
            parent.appendChild(span);
            return;
        }
        if (seg.kind === 'Annotated') {
            const cursorInSegment =
                cursorState &&
                !cursorState.inserted &&
                cursorIndex != null &&
                seg.range &&
                cursorIndex >= seg.range.start &&
                cursorIndex <= seg.range.end;
            const cursorInBase =
                cursorInSegment &&
                seg.baseRange &&
                cursorIndex >= seg.baseRange.start &&
                cursorIndex <= seg.baseRange.end;
            const cursorInRuby =
                cursorInSegment &&
                seg.rubyRange &&
                cursorIndex >= seg.rubyRange.start &&
                cursorIndex <= seg.rubyRange.end;
            if (cursorInSegment && !cursorInBase && !cursorInRuby) {
                appendCursorMarker(parent, cursorState);
            }
            const rubyEl = document.createElement('ruby');
            const rb = document.createElement('rb');

            if (isJsonPreview) {
                rb.classList.add('json-ruby-base');
            }

            renderInlineSegments(rb, seg.base || [], node, offsetMode, cursorState, cursorIndex, isJsonPreview);
            const rt = document.createElement('rt');
            appendTextWithOffsets(
                rt,
                seg.reading || '',
                node,
                seg.rubyRange ? seg.rubyRange.start : 0,
                [],
                offsetMode,
                cursorState,
                cursorIndex
            );
            rubyEl.appendChild(rb);
            rubyEl.appendChild(rt);
            parent.appendChild(rubyEl);
            return;
        }
        if (seg.kind === 'Gloss') {
            const cursorInSegment =
                cursorState &&
                !cursorState.inserted &&
                cursorIndex != null &&
                seg.range &&
                cursorIndex >= seg.range.start &&
                cursorIndex <= seg.range.end;
            if (cursorInSegment && seg.base && seg.base.length) {
                const inBase = seg.base.some(
                    (child) =>
                        child.range &&
                        cursorIndex >= child.range.start &&
                        cursorIndex <= child.range.end
                );
                if (!inBase) {
                    appendCursorMarker(parent, cursorState);
                }
            } else if (cursorInSegment) {
                appendCursorMarker(parent, cursorState);
            }
            renderGlossSegment(parent, seg, node, offsetMode, cursorState, cursorIndex, isJsonPreview);
            return;
        }
        if (seg.kind === 'Escape') {
            if (isJsonPreview) {
                const span = document.createElement('span');
                span.className = 'json-token-escape';
                span.textContent = seg.text;
                parent.appendChild(span);
            } else {
                parent.appendChild(document.createElement('br'));
            }
            return;
        }
    });
}

function renderStringValue(
    parent,
    value,
    node,
    styles = [],
    offsetMode = 'decoded',
    cursorState = null,
    cursorIndex = null,
    segmentsOverride = null,
    isJsonPreview = false
) {
    const raw = value != null ? String(value) : '';
    if (!raw) return [];
    const segments = segmentsOverride || parseContentToSegments(raw);
    if (styles && styles.length) {
        const wrapper = document.createElement('span');
        applyStyles(wrapper, styles);
        renderSegments(wrapper, segments, node, offsetMode, cursorState, cursorIndex, isJsonPreview);
        parent.appendChild(wrapper);
        return segments;
    }
    renderSegments(parent, segments, node, offsetMode, cursorState, cursorIndex, isJsonPreview);
    return segments;
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

function renderTokensWithSource(parent, tokens, options = {}) {
    const list = normalizeTokenArray(tokens);
    list.forEach((token, index) => {
        const tokenPath = options.tokenPath ? [...options.tokenPath, index] : null;
        renderTokenObject(parent, token, {
            ...options,
            tokenPath
        });
    });
}

function renderTokenObject(parent, token, options) {
    if (token == null) return;
    const node = options.tokenPath ? findNodeByPath(lastParsedAst, options.tokenPath) : null;

    if (typeof token === 'string') {
        renderStringValue(parent, token, node, options.styles || []);
        return;
    }

    if (!token.type) return;

    if (token.type === 'br') {
        const br = document.createElement('br');
        attachJump(br, node && node.loc ? node.loc.start.offset : null);
        parent.appendChild(br);
        return;
    }

    if (token.type === 'hr') {
        const hr = document.createElement('hr');
        hr.className = 'my-2 border-t app-border-subtle';
        attachJump(hr, node && node.loc ? node.loc.start.offset : null);
        parent.appendChild(hr);
        return;
    }

    if (token.type === 'key') {
        renderKeyToken(parent, token, node, options);
        return;
    }

    if (token.type === 'listkey') {
        renderListKeyToken(parent, token, node, options);
        return;
    }

    if (token.type === 'ruby') {
        renderRubyToken(parent, token, node, options);
        return;
    }

    if (token.type === 'hide') {
        if (!options.showHideValue) {
            const span = document.createElement('span');
            span.className = 'inline-block min-w-[2.5rem] border-b app-border-strong mx-1 pb-0.5';
            span.textContent = ' ';
            attachJump(span, node && node.loc ? node.loc.start.offset : null);
            parent.appendChild(span);
            return;
        }
        const valuePath = options.tokenPath ? [...options.tokenPath, 'value'] : null;
        if (Array.isArray(token.value)) {
            renderTokensWithSource(parent, token.value, {
                ...options,
                tokenPath: valuePath
            });
        } else if (token.value) {
            renderTokenObject(parent, token.value, {
                ...options,
                tokenPath: valuePath
            });
        }
        return;
    }

    if (token.type === 'katex') {
        renderKatexToken(parent, token, node, options);
        return;
    }

    if (token.type === 'smiles') {
        renderSmilesToken(parent, token, node, options);
    }
}

function renderKeyToken(parent, token, node, options) {
    const field = token.field;
    const row = options.row;
    const rowPath = options.rowPath;
    const fieldPath = rowPath ? [...rowPath, field] : null;
    const fieldNode = fieldPath ? findNodeByPath(lastParsedAst, fieldPath) : null;
    const value = row && field ? row[field] : '';

    if (Array.isArray(value)) {
        if (token.styles && token.styles.length) {
            const wrapper = document.createElement('span');
            applyStyles(wrapper, token.styles);
            renderTokensWithSource(wrapper, value, {
                ...options,
                tokenPath: fieldPath
            });
            parent.appendChild(wrapper);
        } else {
            renderTokensWithSource(parent, value, {
                ...options,
                tokenPath: fieldPath
            });
        }
        return;
    }
    if (value && typeof value === 'object' && value.type) {
        if (token.styles && token.styles.length) {
            const wrapper = document.createElement('span');
            applyStyles(wrapper, token.styles);
            renderTokenObject(wrapper, value, {
                ...options,
                tokenPath: fieldPath
            });
            parent.appendChild(wrapper);
        } else {
            renderTokenObject(parent, value, {
                ...options,
                tokenPath: fieldPath
            });
        }
        return;
    }
    renderStringValue(parent, value != null ? String(value) : '', fieldNode || node, token.styles || []);
}

function renderListKeyToken(parent, token, node, options) {
    const field = token.field;
    const row = options.row;
    const rowPath = options.rowPath;
    const fieldPath = rowPath ? [...rowPath, field] : null;
    const entries = Array.isArray(row && field ? row[field] : null) ? row[field] : [];

    const separatorTokens = normalizeTokenArray(token.separatorTokens);
    const separatorPath = options.tokenPath ? [...options.tokenPath, 'separatorTokens'] : null;
    const separatorIsArray = Array.isArray(token.separatorTokens);

    entries.forEach((entryTokens, index) => {
        if (index > 0 && separatorTokens.length) {
            if (separatorIsArray) {
                renderTokensWithSource(parent, separatorTokens, {
                    ...options,
                    tokenPath: separatorPath
                });
            } else if (separatorPath) {
                renderTokenObject(parent, separatorTokens[0], {
                    ...options,
                    tokenPath: separatorPath
                });
            } else {
                renderTokenObject(parent, separatorTokens[0], options);
            }
        }
        renderTokensWithSource(parent, entryTokens, {
            ...options,
            tokenPath: fieldPath ? [...fieldPath, index] : null
        });
    });
}

function resolveSubTokenSource(spec, specPath, options) {
    const row = options.row;
    const rowPath = options.rowPath;

    if (typeof spec === 'string') {
        return {
            type: 'string',
            value: spec,
            node: specPath ? findNodeByPath(lastParsedAst, specPath) : null
        };
    }

    if (spec && typeof spec === 'object') {
        if (spec.type === 'key') {
            const field = spec.field;
            const fieldPath = rowPath ? [...rowPath, field] : null;
            const fieldNode = fieldPath ? findNodeByPath(lastParsedAst, fieldPath) : null;
            const value = row && field ? row[field] : '';
            if (Array.isArray(value)) {
                return { type: 'tokens', value, node: fieldNode, path: fieldPath };
            }
            if (value && typeof value === 'object' && value.type) {
                return { type: 'token', value, node: fieldNode, path: fieldPath };
            }
            return { type: 'string', value, node: fieldNode };
        }
        if (spec.value != null) {
            return {
                type: 'string',
                value: spec.value,
                node: specPath ? findNodeByPath(lastParsedAst, specPath) : null
            };
        }
    }

    return { type: 'string', value: '', node: specPath ? findNodeByPath(lastParsedAst, specPath) : null };
}

function renderRubyToken(parent, token, node, options) {
    const rubyEl = document.createElement('ruby');

    const basePath = options.tokenPath ? [...options.tokenPath, 'base'] : null;
    const rubyPath = options.tokenPath ? [...options.tokenPath, 'ruby'] : null;
    const baseSource = resolveSubTokenSource(token.base, basePath, options);
    const rubySource = resolveSubTokenSource(token.ruby, rubyPath, options);

    const rb = document.createElement('rb');
    if (baseSource.type === 'tokens') {
        renderTokensWithSource(rb, baseSource.value, {
            ...options,
            tokenPath: baseSource.path
        });
    } else if (baseSource.type === 'token') {
        renderTokenObject(rb, baseSource.value, {
            ...options,
            tokenPath: baseSource.path
        });
    } else {
        renderStringValue(rb, baseSource.value, baseSource.node);
    }

    const rt = document.createElement('rt');
    if (rubySource.type === 'tokens') {
        renderTokensWithSource(rt, rubySource.value, {
            ...options,
            tokenPath: rubySource.path
        });
    } else if (rubySource.type === 'token') {
        renderTokenObject(rt, rubySource.value, {
            ...options,
            tokenPath: rubySource.path
        });
    } else {
        renderStringValue(rt, rubySource.value, rubySource.node);
    }

    rubyEl.appendChild(rb);
    rubyEl.appendChild(rt);
    attachJump(rubyEl, node && node.loc ? node.loc.start.offset : null);
    parent.appendChild(rubyEl);
}

function renderKatexToken(parent, token, node, options) {
    const row = options.row;
    const rowPath = options.rowPath;
    let valueNode = node && node.loc ? node : null;
    let value = '';

    if (token.value != null) {
        value = token.value;
        valueNode = options.tokenPath ? findNodeByPath(lastParsedAst, [...options.tokenPath, 'value']) : node;
    } else if (token.field && row) {
        value = row[token.field] ?? '';
        const fieldPath = rowPath ? [...rowPath, token.field] : null;
        valueNode = fieldPath ? findNodeByPath(lastParsedAst, fieldPath) : node;
    }

    const styles = ['katex', ...(token.styles || [])];
    if (token.block) styles.push('katex-block');
    const span = createStyledSpan(String(value ?? ''), styles);
    attachJump(span, valueNode && valueNode.loc ? valueNode.loc.start.offset : null);
    parent.appendChild(span);
}

function renderSmilesToken(parent, token, node, options) {
    const row = options.row;
    const rowPath = options.rowPath;
    let valueNode = node && node.loc ? node : null;
    let value = '';

    if (token.value != null) {
        value = token.value;
        valueNode = options.tokenPath ? findNodeByPath(lastParsedAst, [...options.tokenPath, 'value']) : node;
    } else if (token.field && row) {
        value = row[token.field] ?? '';
        const fieldPath = rowPath ? [...rowPath, token.field] : null;
        valueNode = fieldPath ? findNodeByPath(lastParsedAst, fieldPath) : node;
    }

    const span = document.createElement('span');
    span.className = 'inline-block';
    span.dataset.smiles = String(value ?? '');
    attachJump(span, valueNode && valueNode.loc ? valueNode.loc.start.offset : null);
    parent.appendChild(span);
    renderSmilesInline(span, String(value ?? ''), {});
}

export function jumpToPath(path) {
    if (!lastParsedAst || !editor) return;
    const node = findNodeByPath(lastParsedAst, path);
    if (node) {
        jumpToOffset(node.loc.start.offset);
    }
}

function jumpToOffset(offset) {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const position = model.getPositionAt(offset);
    editor.revealPositionInCenter(position);
    editor.setPosition(position);
    editor.focus();
}

function setDraftStatus(text, cls) {
    const status = document.getElementById('draft-status');
    if (!status) return;
    status.textContent = text;
    status.className = `text-[11px] ${cls}`;
}

function attachPreviewTabHandlers() {
    if (previewTabsInitialized) return;
    previewTabsInitialized = true;
    const renderedButton = document.getElementById('draft-preview-tab-rendered');
    const jsonButton = document.getElementById('draft-preview-tab-json');

    if (renderedButton) {
        renderedButton.addEventListener('click', () => {
            setPreviewTab('rendered');
        });
    }
    if (jsonButton) {
        jsonButton.addEventListener('click', () => {
            setPreviewTab('json');
        });
    }
}

function setPreviewTab(tab) {
    activePreviewTab = tab;
    const renderedButton = document.getElementById('draft-preview-tab-rendered');
    const jsonButton = document.getElementById('draft-preview-tab-json');
    const renderedContainer = document.getElementById('draft-preview-rendered');
    const jsonContainer = document.getElementById('draft-preview-json');

    if (renderedButton) {
        renderedButton.classList.toggle('app-surface-overlay', tab === 'rendered');
    }
    if (jsonButton) {
        jsonButton.classList.toggle('app-surface-overlay', tab === 'json');
    }
    if (renderedContainer) {
        renderedContainer.classList.toggle('hidden', tab !== 'rendered');
    }
    if (jsonContainer) {
        jsonContainer.classList.toggle('hidden', tab !== 'json');
    }
    if (tab === 'json' && jsonContainer) {
        scheduleJsonPreview(true);
    }
    if (tab === 'rendered') {
        scheduleRenderedPreview();
    }
}

function renderRenderedPreview(rawValue, container, options = {}) {
    if (!rawValue || typeof rawValue !== 'object') {
        const empty = document.createElement('div');
        empty.className = 'text-xs app-text-muted';
        empty.textContent = 'No renderable content.';
        container.appendChild(empty);
        return;
    }

    const title = rawValue.title || 'Untitled quiz';
    const description = rawValue.description || '';

    const header = document.createElement('div');
    header.className = 'rounded-lg border app-border-subtle p-3 app-surface-card';

    const titleEl = document.createElement('div');
    titleEl.className = 'text-sm font-semibold app-text-strong';
    const titleNode = findNodeByPath(lastParsedAst, ['title']);
    renderStringValue(titleEl, title, titleNode);
    header.appendChild(titleEl);

    if (description) {
        const descEl = document.createElement('div');
        descEl.className = 'mt-1 text-xs app-text-muted';
        const descNode = findNodeByPath(lastParsedAst, ['description']);
        renderStringValue(descEl, description, descNode);
        header.appendChild(descEl);
    }

    container.appendChild(header);

    const patterns = Array.isArray(rawValue.patterns) ? rawValue.patterns : [];
    const table = Array.isArray(rawValue.table) ? rawValue.table : [];
    const rowIndex = Number.isInteger(options.rowIndex) ? options.rowIndex : null;
    const previewRow = rowIndex != null ? table[rowIndex] : null;
    const previewRowPath = previewRow ? ['table', rowIndex] : null;

    if (!table.length) {
        const note = document.createElement('div');
        note.className = 'text-xs app-text-danger';
        note.textContent = 'Table rows are missing. Add a row to preview questions.';
        container.appendChild(note);
        return;
    }

    if (rowIndex == null || !previewRow) {
        const note = document.createElement('div');
        note.className = 'text-xs app-text-muted';
        note.textContent = 'Move the cursor inside a table row to preview this question.';
        container.appendChild(note);
        return;
    }

    const note = document.createElement('div');
    note.className = 'text-[11px] app-text-muted';
    note.textContent = `Preview row: ${previewRow.id || `row_${rowIndex + 1}`} (from cursor)`;
    container.appendChild(note);

    if (!patterns.length) {
        const empty = document.createElement('div');
        empty.className = 'text-xs app-text-muted';
        empty.textContent = 'No patterns found.';
        container.appendChild(empty);
        return;
    }

    patterns.forEach((pattern, index) => {
        const section = document.createElement('div');
        section.className = 'rounded-lg border app-border-subtle p-3 app-surface-card';

        const label = document.createElement('div');
        label.className = 'text-xs font-semibold app-text-strong';
        const labelNode = pattern.label ? findNodeByPath(lastParsedAst, ['patterns', index, 'label']) : null;
        if (pattern.label) {
            renderStringValue(label, pattern.label, labelNode);
        } else {
            label.textContent = pattern.id || `Pattern ${index + 1}`;
        }
        section.appendChild(label);

        if (pattern.description) {
            const desc = document.createElement('div');
            desc.className = 'mt-1 text-[11px] app-text-muted';
            const descNode = findNodeByPath(lastParsedAst, ['patterns', index, 'description']);
            renderStringValue(desc, pattern.description, descNode);
            section.appendChild(desc);
        }

        const tokens = Array.isArray(pattern.tokens) ? pattern.tokens : [];
        const tokenPath = ['patterns', index, 'tokens'];

        const blankTitle = document.createElement('div');
        blankTitle.className = 'mt-2 text-[11px] font-semibold app-text-muted';
        blankTitle.textContent = 'Question (blank)';
        section.appendChild(blankTitle);

        const blankBody = document.createElement('div');
        blankBody.className = 'mt-1 text-sm leading-relaxed';
        renderTokensWithSource(blankBody, tokens, {
            row: previewRow,
            rowPath: previewRowPath,
            tokenPath,
            showHideValue: false
        });
        section.appendChild(blankBody);

        const filledTitle = document.createElement('div');
        filledTitle.className = 'mt-3 text-[11px] font-semibold app-text-muted';
        filledTitle.textContent = 'Question (filled)';
        section.appendChild(filledTitle);

        const filledBody = document.createElement('div');
        filledBody.className = 'mt-1 text-sm leading-relaxed';
        renderTokensWithSource(filledBody, tokens, {
            row: previewRow,
            rowPath: previewRowPath,
            tokenPath,
            showHideValue: true
        });
        section.appendChild(filledBody);

        if (Array.isArray(pattern.tips) && pattern.tips.length > 0) {
            const tipsTitle = document.createElement('div');
            tipsTitle.className = 'mt-3 text-[11px] font-semibold app-text-muted';
            tipsTitle.textContent = 'Tips';
            section.appendChild(tipsTitle);

            pattern.tips.forEach((tip, tipIndex) => {
                const tipRow = document.createElement('div');
                tipRow.className = 'mt-1 text-xs';
                renderTokensWithSource(tipRow, tip.tokens || [], {
                    row: previewRow,
                    rowPath: previewRowPath,
                    tokenPath: ['patterns', index, 'tips', tipIndex, 'tokens'],
                    showHideValue: true
                });
                section.appendChild(tipRow);
            });
        }

        container.appendChild(section);
    });
}

function getPathInput() {
    return document.getElementById('draft-path-input');
}

function attachEditorToolbarHandlers() {
    if (toolbarInitialized) return;
    toolbarInitialized = true;
    const loadButton = document.getElementById('draft-path-load-button');
    const newButton = document.getElementById('draft-path-new-button');
    const pathInput = getPathInput();

    if (loadButton) {
        loadButton.addEventListener('click', async () => {
            if (!pathInput) return;
            const path = pathInput.value.trim();
            if (!path) return;
            await loadDraftByPath(path);
        });
    }

    if (newButton) {
        newButton.addEventListener('click', async () => {
            if (!pathInput) return;
            const path = pathInput.value.trim() || 'drafts/new-draft.json';
            await createNewDraft(path);
        });
    }
}

function attachExplorerHandlers() {
    if (explorerInitialized) return;
    explorerInitialized = true;
    const refreshButton = document.getElementById('draft-explorer-refresh');
    if (refreshButton) {
        refreshButton.addEventListener('click', async () => {
            await refreshPathList();
        });
    }
}

function buildPathTree(paths) {
    const root = { name: '', type: 'folder', children: new Map() };
    paths.forEach((path) => {
        if (!path) return;
        const parts = path.split('/').filter(Boolean);
        let current = root;
        parts.forEach((part, index) => {
            const isFile = index === parts.length - 1;
            if (isFile) {
                current.children.set(part, { name: part, type: 'file', path });
                return;
            }
            if (!current.children.has(part)) {
                current.children.set(part, { name: part, type: 'folder', children: new Map() });
            }
            current = current.children.get(part);
        });
    });
    return root;
}

function renderExplorerNodes(container, node) {
    const entries = Array.from(node.children.values());
    entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    entries.forEach((entry) => {
        if (entry.type === 'folder') {
            const details = document.createElement('details');
            details.open = true;
            details.className = 'group';

            const summary = document.createElement('summary');
            summary.className = 'cursor-pointer select-none py-1 text-[11px] app-text-strong';
            summary.textContent = entry.name;
            details.appendChild(summary);

            const childContainer = document.createElement('div');
            childContainer.className = 'ml-3 border-l app-border-subtle pl-2 space-y-1';
            renderExplorerNodes(childContainer, entry);
            details.appendChild(childContainer);

            container.appendChild(details);
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'w-full text-left px-2 py-1 rounded app-text-main hover:app-text-strong hover:app-surface-overlay transition';
        button.textContent = entry.name;
        button.dataset.path = entry.path;
        button.title = entry.path;
        if (entry.path === currentDraftPath) {
            button.classList.add('font-semibold', 'app-surface-overlay');
        }
        button.addEventListener('click', async () => {
            await loadDraftByPath(entry.path);
        });
        container.appendChild(button);
    });
}

function renderDraftExplorer(drafts) {
    const container = document.getElementById('draft-explorer-list');
    if (!container) return;
    container.innerHTML = '';
    if (!drafts || drafts.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-[11px] app-text-muted';
        empty.textContent = 'No local drafts yet.';
        container.appendChild(empty);
        return;
    }
    const tree = buildPathTree(
        drafts.map((draft) => draft && draft.path).filter(Boolean)
    );
    renderExplorerNodes(container, tree);
}

async function refreshPathList() {
    const list = document.getElementById('draft-path-list');
    if (!list) return;
    list.innerHTML = '';
    const drafts = await getAllDrafts();
    drafts.forEach((draft) => {
        if (!draft || !draft.path) return;
        const option = document.createElement('option');
        option.value = draft.path;
        list.appendChild(option);
    });
    renderDraftExplorer(drafts);
}

function buildDefaultDraft(path) {
    const title = path ? path.split('/').pop().replace(/\.json$/i, '') : 'Local Draft';
    return JSON.stringify(
        {
            title: `${title} (draft)`,
            description: 'Local draft preview for v3.',
            version: 3,
            table: [
                {
                    id: 'row_1',
                    term: 'Sample term',
                    definition: 'Sample definition'
                }
            ],
            patterns: [
                {
                    id: 'p1',
                    label: 'Definition -> Term',
                    tokens: [
                        'Definition: ',
                        { type: 'key', field: 'definition' },
                        ' / Term: ',
                        {
                            type: 'hide',
                            id: 'answer_main',
                            value: [{ type: 'key', field: 'term' }],
                            answer: { mode: 'choice_from_entities' }
                        }
                    ]
                }
            ]
        },
        null,
        2
    );
}

async function loadDraftByPath(path) {
    currentDraftPath = path;
    if (window.localStorage) {
        window.localStorage.setItem('draftEditorPath', currentDraftPath);
    }

    const pathInput = getPathInput();
    if (pathInput) {
        pathInput.value = currentDraftPath;
    }

    const existing = await getDraft(path);
    const initialValue =
        existing && (existing.data || existing.content)
            ? (existing.data || existing.content)
            : buildDefaultDraft(path);
    editor.setValue(initialValue);
    handleContentChange(initialValue);
    const drafts = await getAllDrafts();
    renderDraftExplorer(drafts);
}

async function createNewDraft(path) {
    const initialValue = buildDefaultDraft(path);
    await saveDraft({
        path,
        data: initialValue,
        updatedAt: new Date().toISOString()
    });
    await refreshPathList();
    await loadDraftByPath(path);
}
