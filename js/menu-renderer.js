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

        // Action buttons container (Top Right)
        const actionContainer = document.createElement('div');
        actionContainer.className = 'absolute top-2 right-2 flex items-center gap-1';

        // Share button
        const shareButton = document.createElement('button');
        shareButton.type = 'button';
        shareButton.dataset.shareEntryUrl = entry.url;
        shareButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-blue-500 transition-colors';
        shareButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
        shareButton.title = 'Share this entry';
        actionContainer.appendChild(shareButton);

        // Reload button
        const reloadButton = document.createElement('button');
        reloadButton.type = 'button';
        reloadButton.dataset.reloadEntryUrl = entry.url;
        reloadButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-green-500 transition-colors';
        reloadButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
        reloadButton.title = 'Reload this entry';
        actionContainer.appendChild(reloadButton);

        if (!entry.builtIn && !isLocal) {
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.dataset.removeUrl = entry.url;
            removeButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-red-500 transition-colors';
            removeButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
            removeButton.title = 'Remove this entry';
            actionContainer.appendChild(removeButton);
        }

        wrapper.appendChild(actionContainer);

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
            title.className = 'font-semibold mb-0.5 pr-8';
            title.textContent = entry.title || entry.id;

            const desc = document.createElement('div');
            desc.className =
                'text-[11px] app-text-main pr-8'; // Add padding for share button
            desc.textContent = entry.description || '';

            button.appendChild(title);
            button.appendChild(desc);

            // Share button for Quiz — place as absolute inside a relative wrapper
            const shareButton = document.createElement('button');
            shareButton.type = 'button';
            shareButton.dataset.shareQuizId = entry.id;
            shareButton.className = 'p-1.5 rounded-lg text-gray-400 hover:text-blue-500 transition-colors z-10';
            shareButton.style.position = 'absolute';
            shareButton.style.top = '8px';
            shareButton.style.right = '8px';
            shareButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
            shareButton.title = 'Share this quiz';

            const capacity = createCapacityElement(entry._capacityStatus, entry._capacity, 'quiz');

            // Wrapper keeps absolute positioning context
            const wrapper = document.createElement('div');
            wrapper.className = 'relative';
            wrapper.appendChild(button);
            wrapper.appendChild(shareButton);
            if (capacity) {
                wrapper.appendChild(capacity);
            }

            parentElement.appendChild(wrapper);
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
