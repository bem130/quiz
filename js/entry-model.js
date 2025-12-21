// js/entry-model.js
import { updatePackageRevision } from './storage/package-store.js';

function normalizeFilePath(path) {
    if (!path) return '';
    return String(path).replace(/\\/g, '/').replace(/^\.?\//, '');
}

function stripJsonExtension(path) {
    return path.replace(/\.json$/i, '');
}

function extractFileLabel(path) {
    const normalized = stripJsonExtension(normalizeFilePath(path));
    const parts = normalized.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : normalized || 'quiz';
}

function makeNodeKey(type, path, patternId = null) {
    if (type === 'dir') {
        return `dir:${path || ''}`;
    }
    if (type === 'file') {
        return `file:${path}`;
    }
    if (type === 'pattern') {
        return `pattern:${path}::${patternId}`;
    }
    return '';
}

function buildSelectionTree(fileEntries) {
    const root = {
        type: 'dir',
        name: '',
        label: '',
        path: '',
        children: []
    };
    const nodeMap = new Map();

    function ensureDirNode(parent, segment, path) {
        if (!segment) {
            return parent;
        }
        let child = (parent.children || []).find(
            (node) => node.type === 'dir' && node.name === segment
        );

        if (!child) {
            child = {
                type: 'dir',
                name: segment,
                label: segment,
                path,
                children: []
            };
            child.key = makeNodeKey('dir', path);
            parent.children.push(child);
            nodeMap.set(child.key, child);
        }

        return child;
    }

    (fileEntries || []).forEach((file) => {
        if (!file || !file.normalizedPath) return;

        const segments = file.normalizedPath.split('/').filter(Boolean);
        const fileName = segments.pop() || file.normalizedPath;
        let parent = root;
        let currentPath = '';

        segments.forEach((segment) => {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            parent = ensureDirNode(parent, segment, currentPath);
        });

        const fileNode = {
            type: 'file',
            name: fileName,
            label: file.title || extractFileLabel(file.normalizedPath),
            path: file.normalizedPath,
            rawPath: file.path,
            description: file.description || '',
            patterns: file.patterns || [],
            children: []
        };
        fileNode.key = makeNodeKey('file', fileNode.path);
        fileNode.id = fileNode.key;
        fileNode.files = [file.path];
        nodeMap.set(fileNode.key, fileNode);
        parent.children.push(fileNode);

        (file.patterns || []).forEach((pattern) => {
            if (!pattern || !pattern.id) return;
            const patternNode = {
                type: 'pattern',
                name: pattern.id,
                label: pattern.label || pattern.id,
                description: pattern.description || '',
                path: fileNode.path,
                patternId: pattern.id,
                parentFile: fileNode
            };
            patternNode.key = makeNodeKey('pattern', fileNode.path, pattern.id);
            patternNode.id = patternNode.key;
            nodeMap.set(patternNode.key, patternNode);
            fileNode.children.push(patternNode);
        });
    });

    return { tree: root.children, nodeMap };
}

async function loadQuizFileMeta(filePath, baseUrl) {
    const normalizedPath = normalizeFilePath(filePath);
    const resolvedUrl = new URL(filePath, baseUrl).toString();
    const res = await fetch(resolvedUrl);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    try {
        await updatePackageRevision({ filePath, json, source: 'entry' });
    } catch (error) {
        console.warn('[entry] failed to update package revision', filePath, error);
    }
    const patterns = Array.isArray(json.patterns) ? json.patterns : [];

    return {
        path: filePath,
        normalizedPath,
        title: json.title || extractFileLabel(normalizedPath),
        description: json.description || '',
        patterns: patterns.map((pattern, idx) => ({
            id: pattern && pattern.id ? pattern.id : `p_${idx}`,
            label: pattern && pattern.label ? pattern.label : pattern && pattern.id ? pattern.id : `Pattern ${idx + 1}`,
            description: pattern && pattern.description ? pattern.description : ''
        }))
    };
}

/**
 * 指定したエントリ URL から情報を取得し、利用可否とクイズ一覧を返す。
 * @param {string} entryUrl - entry.php などの URL。
 * @returns {Promise<object>} EntrySource 互換のオブジェクト。
 */
export async function loadEntrySourceFromUrl(entryUrl) {
    const rawUrl = entryUrl;

    const baseResult = {
        url: rawUrl,
        label: rawUrl,
        available: false
    };

    let absoluteUrl;
    try {
        absoluteUrl = new URL(rawUrl, window.location.href).toString();
    } catch (e) {
        return {
            ...baseResult,
            errorMessage:
                'Invalid URL format. Please use an absolute http(s) URL or a relative path from this page.'
        };
    }

    const resultBase = {
        url: absoluteUrl,
        label: rawUrl,
        available: false
    };

    try {
        const res = await fetch(absoluteUrl);
        if (!res.ok) {
            return {
                ...resultBase,
                errorMessage: `HTTP ${res.status} ${res.statusText}`
            };
        }

        let json;
        try {
            json = await res.json();
        } catch (e) {
            return {
                ...resultBase,
                errorMessage:
                    'Response is not valid JSON. Please check the entry endpoint output.'
            };
        }

        const label =
            typeof json.label === 'string' && json.label.trim()
                ? json.label.trim()
                : rawUrl;

        const editorBasePath = (() => {
            const pathValue =
                typeof json.editorBasePath === 'string'
                    ? json.editorBasePath
                    : typeof json.editorPath === 'string'
                        ? json.editorPath
                        : '';
            return pathValue.trim() || null;
        })();
        const editorFileMap =
            json.editorFileMap && typeof json.editorFileMap === 'object' && !Array.isArray(json.editorFileMap)
                ? json.editorFileMap
                : null;

        const files = Array.isArray(json.files) ? json.files : null;
        if (!files) {
            return {
                ...resultBase,
                label,
                errorMessage:
                    'Invalid entry schema: "files" array is missing.'
            };
        }

        const baseUrl = new URL('.', absoluteUrl).toString();
        const fileEntries = [];
        const errors = [];

        for (const filePath of files) {
            if (!filePath) continue;
            try {
                const entry = await loadQuizFileMeta(filePath, baseUrl);
                fileEntries.push(entry);
            } catch (error) {
                console.warn('[entry] Failed to load quiz file:', filePath, error);
                errors.push(filePath);
            }
        }

        if (fileEntries.length === 0) {
            return {
                ...resultBase,
                label,
                errorMessage: 'No quiz files could be loaded from this entry.'
            };
        }

        const { tree, nodeMap } = buildSelectionTree(fileEntries);

        return {
            url: absoluteUrl,
            label,
            available: true,
            editorBasePath,
            editorFileMap,
            files: fileEntries,
            tree,
            nodeMap,
            _entryBaseUrl: baseUrl,
            loadErrors: errors
        };
    } catch (error) {
        return {
            ...resultBase,
            errorMessage:
                error instanceof Error ? error.message : String(error)
        };
    }
}

export { makeNodeKey, normalizeFilePath, stripJsonExtension };
