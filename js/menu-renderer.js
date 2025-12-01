// js/menu-renderer.js
import { dom } from './dom-refs.js';

function createCapacityElement(status, capacityValue, context) {
    if (!status) {
        return null;
    }

    const text = document.createElement('div');
    if (status === 'pending') {
        text.className = 'mt-0.5 text-[11px] app-text-muted';
        text.textContent = 'Calculating questions...';
        return text;
    }

    if (status === 'done') {
        text.className = 'mt-0.5 text-[11px] app-text-muted';
        if (capacityValue && capacityValue > 0) {
            text.textContent = context === 'entry'
                ? `~${capacityValue} questions available`
                : `~${capacityValue} questions`;
        } else {
            text.textContent = context === 'entry'
                ? 'No questions available in this entry.'
                : 'No questions in this quiz.';
        }
        return text;
    }

    if (status === 'error') {
        text.className = 'mt-0.5 text-[11px] app-text-danger';
        text.textContent = 'Failed to estimate questions.';
        return text;
    }

    return null;
}

/**
 * エントリ一覧を描画する。
 * @param {Array<object>} entrySources - EntrySource 配列。
 * @param {object|null} currentEntry - 現在選択中のエントリ。
 */
export function renderEntryMenu(entrySources, currentEntry) {
    if (!dom.entryList) return;
    dom.entryList.innerHTML = '';

    const list = Array.isArray(entrySources) ? entrySources : [];
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-xs app-text-muted';
        empty.textContent = 'No entries available.';
        dom.entryList.appendChild(empty);
        return;
    }

    list.forEach((entry) => {
        const isCurrent = currentEntry && currentEntry.url === entry.url;
        const isLocal = Boolean(entry.isLocal);
        const hasDraftData = Boolean(entry.hasDraftData);
        const wrapper = document.createElement('div');
        wrapper.className = 'relative';

        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.entryUrl = entry.url;
        button.className = [
            'w-full text-left rounded-xl border px-3 py-2 transition-colors app-list-button',
            isCurrent ? 'app-list-button-active shadow-sm' : ''
        ].join(' ');

        const title = document.createElement('div');
        title.className = 'flex items-center gap-2';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'font-semibold text-sm';
        labelSpan.textContent = isLocal
            ? (hasDraftData ? (entry.label || 'Local draft') : '下書き（データなし）')
            : (entry.label || entry.url);

        const status = document.createElement('span');
        status.className = 'text-[11px] font-semibold';
        if (entry.available) {
            status.classList.add('app-text-success');
            status.textContent = isLocal ? '✓ Local draft ready' : '✓ Available';
        } else {
            status.classList.add('app-text-danger');
            status.textContent = isLocal ? 'Draft unavailable' : '× Unavailable';
        }

        title.appendChild(labelSpan);
        if (entry.temporary) {
            const tempBadge = document.createElement('span');
            tempBadge.className = 'ml-2 inline-flex items-center text-[10px] app-pill app-pill-warning app-pill-compact';
            tempBadge.textContent = 'Temporary';
            title.appendChild(tempBadge);
        }
        title.appendChild(status);

        const urlText = document.createElement('div');
        urlText.className = 'text-[11px] app-text-muted break-all';
        urlText.textContent = entry.url;

        button.appendChild(title);
        button.appendChild(urlText);

        if (isLocal && entry.updatedAt) {
            const updated = document.createElement('div');
            updated.className = 'text-[11px] app-text-muted';
            updated.textContent = `Updated at ${new Date(entry.updatedAt).toLocaleString()}`;
            button.appendChild(updated);
        }

        const capacity = createCapacityElement(entry._capacityStatus, entry._capacity, 'entry');
        if (capacity) {
            button.appendChild(capacity);
        }

        if (!entry.available && entry.errorMessage) {
            const error = document.createElement('div');
            error.className = 'mt-1 text-[11px] app-text-danger';
            error.textContent = entry.errorMessage;
            button.appendChild(error);
        }

        wrapper.appendChild(button);

        if (isLocal) {
            const actionRow = document.createElement('div');
            actionRow.className = 'mt-2 flex flex-wrap gap-2';

            const updateButton = document.createElement('button');
            updateButton.type = 'button';
            updateButton.dataset.localDraftAction = 'update';
            updateButton.className = 'text-[11px] font-semibold app-link-accent';
            updateButton.textContent = 'クリップボードから更新';
            actionRow.appendChild(updateButton);

            if (hasDraftData) {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.dataset.localDraftAction = 'delete';
                deleteButton.className = 'text-[11px] font-semibold app-link-danger';
                deleteButton.textContent = '削除';
                actionRow.appendChild(deleteButton);
            }

            if (!hasDraftData) {
                const helper = document.createElement('div');
                helper.className = 'text-[11px] app-text-muted';
                helper.textContent = 'クリップボードのJSONを下書きとして取り込めます。';
                actionRow.appendChild(helper);
            }

            wrapper.appendChild(actionRow);
        }

        if (entry.temporary) {
            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.dataset.addUrl = entry.url;
            addButton.className = 'absolute bottom-2 right-2 text-[11px] font-semibold app-link-accent';
            addButton.textContent = 'Add entry';
            wrapper.appendChild(addButton);
        }

        // Reload button (for all entries except maybe local draft if it doesn't make sense, but let's allow it for consistency or at least for remote/built-in)
        // Actually, for local draft (isLocal), "reload" might not mean much if it's from storage, but if it has a URL it might.
        // But the requirement emphasizes "Network First" for quiz data.
        // Let's add it for everything.
        const reloadButton = document.createElement('button');
        reloadButton.type = 'button';
        reloadButton.dataset.reloadEntryUrl = entry.url;
        reloadButton.className = 'absolute top-2 right-12 text-[11px] app-link-accent'; // Positioned to the left of Remove (right-2)
        reloadButton.innerHTML = '&#x21bb;'; // Clockwise Open Circle Arrow or similar. Or just "Reload" text if space permits.
        reloadButton.title = 'Reload this entry';
        // If there is no remove button (builtIn), we can move it to right-2
        if (entry.builtIn || entry.isLocal) {
            reloadButton.className = 'absolute top-2 right-2 text-[11px] app-link-accent';
        }
        wrapper.appendChild(reloadButton);

        if (!entry.builtIn && !isLocal) {
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.dataset.removeUrl = entry.url;
            removeButton.className = 'absolute top-2 right-2 text-[11px] app-link-danger';
            removeButton.textContent = 'Remove';
            wrapper.appendChild(removeButton);
        }

        dom.entryList.appendChild(wrapper);
    });
}

/**
 * クイズエントリ配列をディレクトリ構造のツリーに変換する。
 * @param {Array<object>} entries
 * @returns {Array<object>} root-level nodes
 */
function buildQuizTree(entries) {
    const root = {
        type: 'dir',
        name: '',
        label: '',
        children: []
    };

    function ensureDirNode(parent, segment) {
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
                children: []
            };
            parent.children.push(child);
        }

        return child;
    }

    (entries || []).forEach((entry) => {
        if (!entry) {
            return;
        }

        const rawDir = typeof entry.dir === 'string' ? entry.dir : '';
        const normalized = rawDir
            .replace(/^[.\/]+/, '')
            .replace(/\/+$/, '');

        const segments = normalized ? normalized.split('/') : [];
        let parent = root;

        segments.forEach((segment) => {
            parent = ensureDirNode(parent, segment);
        });

        parent.children.push({
            type: 'quiz',
            quiz: entry
        });
    });

    return root.children;
}

/**
 * ツリーノードの hierarchy スコアを計算する。
 * @param {object} node
 * @returns {number}
 */
function getQuizNodeHierarchyScore(node) {
    if (!node) {
        return 0;
    }

    if (node.type === 'quiz') {
        const quiz = node.quiz;
        if (quiz && typeof quiz.hierarchy === 'number') {
            return quiz.hierarchy;
        }
        return 0;
    }

    if (node.type === 'dir') {
        const children = node.children || [];
        let maxScore = 0;
        for (const child of children) {
            const score = getQuizNodeHierarchyScore(child);
            if (score > maxScore) {
                maxScore = score;
            }
        }
        return maxScore;
    }

    return 0;
}

/**
 * ツリーノードの表示ラベルを取得する（ソートのサブキーとして利用）。
 * @param {object} node
 * @returns {string}
 */
function getQuizNodeLabel(node) {
    if (!node) {
        return '';
    }

    if (node.type === 'quiz') {
        const quiz = node.quiz;
        if (!quiz) {
            return '';
        }
        return (quiz.title || quiz.id || '') + '';
    }

    if (node.type === 'dir') {
        return (node.label || node.name || '') + '';
    }

    return '';
}

/**
 * クイズツリーを再帰的に描画する。
 * @param {Array<object>} nodes
 * @param {HTMLElement} parentElement
 * @param {object|null} currentQuiz
 */
function renderQuizTreeNodes(nodes, parentElement, currentQuiz) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return;
    }

    const sortedNodes = [...nodes].sort((a, b) => {
        const aScore = getQuizNodeHierarchyScore(a);
        const bScore = getQuizNodeHierarchyScore(b);
        if (aScore !== bScore) {
            return bScore - aScore;
        }

        const aLabel = getQuizNodeLabel(a);
        const bLabel = getQuizNodeLabel(b);
        return aLabel.localeCompare(bLabel, 'ja');
    });

    sortedNodes.forEach((node) => {
        if (node.type === 'dir') {
            const header = document.createElement('div');
            header.className =
                'mt-2 text-[11px] font-semibold app-text-muted';
            header.textContent = node.label || node.name || 'Group';
            parentElement.appendChild(header);

            const container = document.createElement('div');
            container.className = 'ml-3 space-y-1';
            parentElement.appendChild(container);

            renderQuizTreeNodes(node.children || [], container, currentQuiz);
            return;
        }

        if (node.type === 'quiz') {
            const entry = node.quiz;
            if (!entry) {
                return;
            }

            const isCurrent =
                currentQuiz && currentQuiz.id === entry.id;

            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.quizId = entry.id;
            button.className = [
                'w-full text-left rounded-xl border px-3 py-2 text-xs transition-colors app-list-button',
                isCurrent ? 'app-list-button-active' : ''
            ].join(' ');

            const title = document.createElement('div');
            title.className = 'font-semibold mb-0.5';
            title.textContent = entry.title || entry.id;

            const desc = document.createElement('div');
            desc.className =
                'text-[11px] app-text-main';
            desc.textContent = entry.description || '';

            button.appendChild(title);
            button.appendChild(desc);

            const capacity = createCapacityElement(entry._capacityStatus, entry._capacity, 'quiz');
            if (capacity) {
                button.appendChild(capacity);
            }

            parentElement.appendChild(button);
        }
    });
}

/**
 * クイズ一覧をサイドメニューに描画し、選択状態を示す。
 * @param {Array<object>} entries - 表示するクイズエントリの配列。
 * @param {object|null} currentQuiz - 現在選択中のクイズエントリ。
 */
export function renderQuizMenu(entries, currentQuiz) {
    dom.quizList.innerHTML = '';

    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-xs app-text-muted';
        empty.textContent = 'No quizzes for this entry.';
        dom.quizList.appendChild(empty);
        return;
    }

    const tree = buildQuizTree(list);
    renderQuizTreeNodes(tree, dom.quizList, currentQuiz);
}
