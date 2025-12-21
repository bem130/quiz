// js/menu-renderer.js
import { dom } from './dom-refs.js';
import { replaceContentString } from './quiz-renderer.js';

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
                : 'No questions in this selection.';
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

function getNodeCapacityStatus(node) {
    if (!node) return null;
    if (node._capacityStatus) return node._capacityStatus;
    if (!Array.isArray(node.children) || node.children.length === 0) {
        return null;
    }

    let hasPending = false;
    let hasError = false;
    let hasDone = false;

    node.children.forEach((child) => {
        const status = getNodeCapacityStatus(child);
        if (status === 'pending') hasPending = true;
        if (status === 'error') hasError = true;
        if (status === 'done') hasDone = true;
    });

    if (hasPending) return 'pending';
    if (hasError) return 'error';
    if (hasDone) return 'done';
    return null;
}

function getNodeCapacityValue(node) {
    if (!node) return 0;
    if (typeof node._capacity === 'number') return node._capacity;
    if (!Array.isArray(node.children) || node.children.length === 0) {
        return 0;
    }
    return node.children.reduce((sum, child) => sum + getNodeCapacityValue(child), 0);
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
            'w-full text-left rounded-xl border px-3 py-2 transition-colors app-list-button pr-[6em]',
            isCurrent ? 'app-list-button-active shadow-sm' : ''
        ].join(' ');

        const title = document.createElement('div');
        title.className = 'flex items-center gap-2';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'font-semibold text-sm';
        const labelValue = isLocal
            ? (hasDraftData ? (entry.label || 'Local draft') : 'Local draft (No data)')
            : (entry.label || entry.url);
        replaceContentString(labelSpan, labelValue);

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

        if (isLocal && !hasDraftData) {
            const helper = document.createElement('div');
            helper.className = 'mt-2 text-[11px] app-text-muted px-1';
            helper.textContent = 'You can try a quiz data by copying JSON to clipboard and clicking the update button.';
            wrapper.appendChild(helper);
        }

        if (entry.temporary) {
            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.dataset.addUrl = entry.url;
            addButton.className = 'absolute bottom-2 right-2 text-[11px] font-semibold app-link-accent';
            addButton.textContent = 'Add entry';
            wrapper.appendChild(addButton);
        }

        const actionContainer = document.createElement('div');
        actionContainer.className = 'absolute top-2 right-2 flex items-center gap-1';

        if (isLocal) {
            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.dataset.localDraftAction = 'edit';
            editButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-blue-500 transition-colors';
            editButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
            editButton.title = 'Edit Draft';
            actionContainer.appendChild(editButton);

            const updateButton = document.createElement('button');
            updateButton.type = 'button';
            updateButton.dataset.localDraftAction = 'update';
            updateButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-green-500 transition-colors';
            updateButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
            updateButton.title = 'Update from Clipboard';
            actionContainer.appendChild(updateButton);

            // const editButton = document.createElement('button');
            // editButton.type = 'button';
            // editButton.dataset.localDraftAction = 'edit';
            // editButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-blue-500 transition-colors';
            // editButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
            // editButton.title = 'Edit Draft';
            // actionContainer.appendChild(editButton);

            if (hasDraftData) {
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.dataset.localDraftAction = 'delete';
                deleteButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-red-500 transition-colors';
                deleteButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
                deleteButton.title = 'Delete Draft';
                actionContainer.appendChild(deleteButton);
            }
        } else {
            const shareButton = document.createElement('button');
            shareButton.type = 'button';
            shareButton.dataset.shareEntryUrl = entry.url;
            shareButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-blue-500 transition-colors';
            shareButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
            shareButton.title = 'Share this entry';
            actionContainer.appendChild(shareButton);

            const reloadButton = document.createElement('button');
            reloadButton.type = 'button';
            reloadButton.dataset.reloadEntryUrl = entry.url;
            reloadButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-green-500 transition-colors';
            reloadButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
            reloadButton.title = 'Reload this entry';
            actionContainer.appendChild(reloadButton);

            if (!entry.builtIn) {
                const removeButton = document.createElement('button');
                removeButton.type = 'button';
                removeButton.dataset.removeUrl = entry.url;
                removeButton.className = 'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-red-500 transition-colors';
                removeButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
                removeButton.title = 'Remove this entry';
                actionContainer.appendChild(removeButton);
            }
        }

        wrapper.appendChild(actionContainer);

        dom.entryList.appendChild(wrapper);
    });
}

function renderQuizTreeNodes(nodes, parentElement, currentSelectionKey) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        return;
    }

    const sortedNodes = [...nodes].sort((a, b) => {
        const aLabel = (a.label || a.name || '').toString();
        const bLabel = (b.label || b.name || '').toString();
        return aLabel.localeCompare(bLabel, 'ja');
    });

    sortedNodes.forEach((node) => {
        if (node.type === 'dir') {
            const isActive = currentSelectionKey && node.key === currentSelectionKey;

            const wrapper = document.createElement('div');
            wrapper.className = 'relative';

            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.selectionId = node.key;
            button.className = [
                'w-full text-left rounded-xl border px-3 py-2 text-xs transition-colors app-list-button',
                isActive ? 'app-list-button-active' : ''
            ].join(' ');

            const title = document.createElement('div');
            title.className = 'font-semibold mb-0.5 pr-[3em]';
            replaceContentString(title, node.label || node.name || 'Group');
            button.appendChild(title);

            wrapper.appendChild(button);

            const shareButton = document.createElement('button');
            shareButton.type = 'button';
            shareButton.dataset.shareSelectionId = node.key;
            shareButton.className = 'p-[0.3em] rounded-lg text-gray-400 hover:text-blue-500 transition-colors z-10';
            shareButton.style.position = 'absolute';
            shareButton.style.top = '8px';
            shareButton.style.right = '8px';
            shareButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
            shareButton.title = 'Share this selection';
            wrapper.appendChild(shareButton);

            const capacity = createCapacityElement(
                getNodeCapacityStatus(node),
                getNodeCapacityValue(node),
                'quiz'
            );
            if (capacity) {
                wrapper.appendChild(capacity);
            }

            parentElement.appendChild(wrapper);

            const container = document.createElement('div');
            container.className = 'ml-3 space-y-1';
            parentElement.appendChild(container);

            renderQuizTreeNodes(node.children || [], container, currentSelectionKey);
            return;
        }

        if (node.type === 'file') {
            const isActive = currentSelectionKey && node.key === currentSelectionKey;

            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.selectionId = node.key;
            button.className = [
                'w-full text-left rounded-xl border px-3 py-2 text-xs transition-colors app-list-button',
                isActive ? 'app-list-button-active' : ''
            ].join(' ');

            const title = document.createElement('div');
            title.className = 'font-semibold mb-0.5 pr-[3em]';
            replaceContentString(title, node.label || node.name);

            const desc = document.createElement('div');
            desc.className = 'text-[11px] app-text-main pr-[3em]';
            replaceContentString(desc, node.description || '');

            button.appendChild(title);
            button.appendChild(desc);

            const wrapper = document.createElement('div');
            wrapper.className = 'relative';
            wrapper.appendChild(button);

            const shareButton = document.createElement('button');
            shareButton.type = 'button';
            shareButton.dataset.shareSelectionId = node.key;
            shareButton.className = 'p-[0.3em] rounded-lg text-gray-400 hover:text-blue-500 transition-colors z-10';
            shareButton.style.position = 'absolute';
            shareButton.style.top = '8px';
            shareButton.style.right = '8px';
            shareButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
            shareButton.title = 'Share this selection';
            wrapper.appendChild(shareButton);

            const capacity = createCapacityElement(node._capacityStatus, node._capacity, 'quiz');
            if (capacity) {
                wrapper.appendChild(capacity);
            }

            parentElement.appendChild(wrapper);

            // Patterns are intentionally hidden in the quizzes menu.
        }
    });
}

/**
 * クイズ一覧をサイドメニューに描画し、選択状態を示す。
 * @param {object|null} entry - 現在の entry.
 * @param {object|null} currentSelection - 現在選択中のノード。
 */
export function renderQuizMenu(entry, currentSelection) {
    dom.quizList.innerHTML = '';

    if (!entry || !entry.available) {
        const empty = document.createElement('div');
        empty.className = 'text-xs app-text-muted';
        empty.textContent = 'No quizzes for this entry.';
        dom.quizList.appendChild(empty);
        return;
    }

    const tree = Array.isArray(entry.tree) ? entry.tree : [];
    if (tree.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-xs app-text-muted';
        empty.textContent = 'No quiz files available.';
        dom.quizList.appendChild(empty);
        return;
    }

    const currentKey = currentSelection && currentSelection.key ? currentSelection.key : null;
    renderQuizTreeNodes(tree, dom.quizList, currentKey);
}
