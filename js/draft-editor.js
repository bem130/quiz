import { saveDraft, getAllDrafts, getDraft } from './db.js';
import { parseJsonWithLoc } from './json-loc-parser.js';
import { buildDefinitionFromQuizFile, validateDefinition } from './quiz-model.js';
import { parseContentToSegments } from './ruby-parser.js';
import { renderSmilesInline } from './chem-renderer.js';

// The preview is a simple tree view of the JSON structure
// Users can click on any element to jump to its location in the editor

let editor = null;
let currentDraftPath = 'drafts/local-draft.json';
let lastParsedAst = null;
let lastSourceText = '';
let lastSourceMapCache = new Map();
let activePreviewTab = 'rendered';
let toolbarInitialized = false;
let previewTabsInitialized = false;

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
            theme: document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs',
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false
        });
    }

    // Theme sync
    const obs = new MutationObserver(() => {
        const isDark = document.documentElement.classList.contains('dark');
        monaco.editor.setTheme(isDark ? 'vs-dark' : 'vs');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });

    // Change listener
    editor.onDidChangeModelContent(() => {
        const val = editor.getValue();
        handleContentChange(val);
    });

    attachEditorToolbarHandlers();
    attachPreviewTabHandlers();
    await refreshPathList();
    await loadDraftByPath(currentDraftPath);
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

    updatePreview(jsonText);
}

function updatePreview(jsonText) {
    const renderedContainer = document.getElementById('draft-preview-rendered');
    const jsonContainer = document.getElementById('draft-preview-json');
    if (!renderedContainer || !jsonContainer) return;

    try {
        lastSourceText = jsonText;
        lastSourceMapCache = new Map();
        lastParsedAst = parseJsonWithLoc(jsonText);
        jsonContainer.textContent = jsonText;

        const definition = buildDefinitionFromQuizFile(lastParsedAst.value, 'draft', {
            title: lastParsedAst.value && lastParsedAst.value.title ? lastParsedAst.value.title : 'Preview'
        });

        renderedContainer.innerHTML = '';
        renderRenderedPreview(lastParsedAst.value, renderedContainer);
        setPreviewTab(activePreviewTab);

        try {
            validateDefinition(definition);
            setDraftStatus('Valid JSON', 'text-green-500');
        } catch (e) {
            setDraftStatus(`Invalid Schema: ${e.message}`, 'text-orange-500');
        }
    } catch (e) {
        // Parse error
        renderedContainer.innerHTML = '';
        jsonContainer.textContent = jsonText;
        setDraftStatus(`Syntax Error: ${e.message}`, 'text-red-500');
    }
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
                map[decodedIndex] = rawIndex;
                rawIndex += 6;
                decodedIndex += 1;
                continue;
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
            window.katex.render(text, span, {
                throwOnError: false,
                strict: false,
                errorColor: '#cc0000',
                displayMode: styles.includes('katex-block')
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

function appendTextWithOffsets(parent, text, node, baseIndex = 0, styles = []) {
    if (!text) return;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '\n') {
            parent.appendChild(document.createElement('br'));
            continue;
        }
        const span = createStyledSpan(ch, styles);
        const offset = node ? getOffsetForStringIndex(node, baseIndex + i) : null;
        attachJump(span, offset);
        parent.appendChild(span);
    }
}

function renderInlineSegments(parent, segments, node) {
    (segments || []).forEach((seg) => {
        if (!seg || !seg.kind) return;
        if (seg.kind === 'Plain') {
            appendTextWithOffsets(parent, seg.text || '', node, seg.range ? seg.range.start : 0);
            return;
        }
        if (seg.kind === 'Math') {
            const span = createStyledSpan(seg.tex || '', ['katex']);
            const offset = node && seg.range ? getOffsetForStringIndex(node, seg.range.start) : null;
            attachJump(span, offset);
            parent.appendChild(span);
        }
    });
}

function renderGlossSegment(parent, seg, node) {
    const glossSpan = document.createElement('span');
    glossSpan.className = 'gloss';

    const rubyEl = document.createElement('ruby');
    (seg.base || []).forEach((child) => {
        if (!child || !child.kind) return;
        if (child.kind === 'Annotated') {
            const rb = document.createElement('rb');
            renderInlineSegments(rb, child.base || [], node);
            const rt = document.createElement('rt');
            appendTextWithOffsets(rt, child.reading || '', node, child.rubyRange ? child.rubyRange.start : 0);
            rubyEl.appendChild(rb);
            rubyEl.appendChild(rt);
            return;
        }
        if (child.kind === 'Math') {
            const rb = document.createElement('rb');
            const span = createStyledSpan(child.tex || '', ['katex']);
            const offset = node && child.range ? getOffsetForStringIndex(node, child.range.start) : null;
            attachJump(span, offset);
            rb.appendChild(span);
            const rt = document.createElement('rt');
            rubyEl.appendChild(rb);
            rubyEl.appendChild(rt);
            return;
        }
        if (child.kind === 'Plain') {
            const rb = document.createElement('rb');
            appendTextWithOffsets(rb, child.text || '', node, child.range ? child.range.start : 0);
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
                    renderInlineSegments(rb, child.base || [], node);
                    const rt = document.createElement('rt');
                    appendTextWithOffsets(rt, child.reading || '', node, child.rubyRange ? child.rubyRange.start : 0);
                    ruby.appendChild(rb);
                    ruby.appendChild(rt);
                    altSpan.appendChild(ruby);
                    return;
                }
                if (child.kind === 'Math') {
                    const span = createStyledSpan(child.tex || '', ['katex']);
                    const offset = node && child.range ? getOffsetForStringIndex(node, child.range.start) : null;
                    attachJump(span, offset);
                    altSpan.appendChild(span);
                    return;
                }
                if (child.kind === 'Plain') {
                    appendTextWithOffsets(altSpan, child.text || '', node, child.range ? child.range.start : 0);
                }
            });
            altsWrapper.appendChild(altSpan);
        });
        glossSpan.appendChild(altsWrapper);
    }

    parent.appendChild(glossSpan);
}

function renderSegments(parent, segments, node) {
    (segments || []).forEach((seg) => {
        if (!seg || !seg.kind) return;
        if (seg.kind === 'Plain') {
            appendTextWithOffsets(parent, seg.text || '', node, seg.range ? seg.range.start : 0);
            return;
        }
        if (seg.kind === 'Math') {
            const span = createStyledSpan(seg.tex || '', ['katex']);
            const offset = node && seg.range ? getOffsetForStringIndex(node, seg.range.start) : null;
            attachJump(span, offset);
            parent.appendChild(span);
            return;
        }
        if (seg.kind === 'Annotated') {
            const rubyEl = document.createElement('ruby');
            const rb = document.createElement('rb');
            renderInlineSegments(rb, seg.base || [], node);
            const rt = document.createElement('rt');
            appendTextWithOffsets(rt, seg.reading || '', node, seg.rubyRange ? seg.rubyRange.start : 0);
            rubyEl.appendChild(rb);
            rubyEl.appendChild(rt);
            parent.appendChild(rubyEl);
            return;
        }
        if (seg.kind === 'Gloss') {
            renderGlossSegment(parent, seg, node);
        }
    });
}

function renderStringValue(parent, value, node, styles = []) {
    const raw = value != null ? String(value) : '';
    if (!raw) return;
    const segments = parseContentToSegments(raw);
    if (styles && styles.length) {
        const wrapper = document.createElement('span');
        applyStyles(wrapper, styles);
        renderSegments(wrapper, segments, node);
        parent.appendChild(wrapper);
        return;
    }
    renderSegments(parent, segments, node);
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

    const span = createStyledSpan(String(value ?? ''), ['katex', ...(token.styles || [])]);
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
    status.className = `text-xs ${cls}`;
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
}

function renderRenderedPreview(rawValue, container) {
    if (!rawValue || typeof rawValue !== 'object') {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-gray-500';
        empty.textContent = 'No renderable content.';
        container.appendChild(empty);
        return;
    }

    const title = rawValue.title || 'Untitled quiz';
    const description = rawValue.description || '';

    const header = document.createElement('div');
    header.className = 'rounded-lg border app-border-subtle p-3 bg-white dark:bg-slate-900';

    const titleEl = document.createElement('div');
    titleEl.className = 'text-sm font-semibold';
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
    const previewRow = table[0] || null;
    const previewRowPath = previewRow ? ['table', 0] : null;

    if (!previewRow) {
        const note = document.createElement('div');
        note.className = 'text-xs text-orange-500';
        note.textContent = 'Table rows are missing. Previews that depend on row data may be empty.';
        container.appendChild(note);
    } else {
        const note = document.createElement('div');
        note.className = 'text-[11px] app-text-muted';
        note.textContent = `Preview row: ${previewRow.id || 'row_1'} (first row)`;
        container.appendChild(note);
    }

    if (!patterns.length) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-gray-500';
        empty.textContent = 'No patterns found.';
        container.appendChild(empty);
        return;
    }

    patterns.forEach((pattern, index) => {
        const section = document.createElement('div');
        section.className = 'rounded-lg border app-border-subtle p-3 bg-white dark:bg-slate-900';

        const label = document.createElement('div');
        label.className = 'text-xs font-semibold';
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
