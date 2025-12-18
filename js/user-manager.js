// js/user-manager.js
import { dom } from './dom-refs.js';
import {
    getAll as getAllFromStore,
    putValue,
    getAppMeta,
    setAppMeta,
    deleteValue
} from './storage/database.js';

const ACTIVE_USER_META_KEY = 'activeUserId';

let cachedUsers = [];
let activeUser = null;
let callbacks = {
    onActiveUserChange: null
};

export async function initUserManager(options = {}) {
    callbacks = {
        onActiveUserChange: options.onActiveUserChange || null
    };

    await ensureSeedUsers();
    await refreshUsers();
    attachHandlers();
}

export function getActiveUser() {
    return activeUser;
}

function attachHandlers() {
    if (dom.userList) {
        dom.userList.addEventListener('click', async (event) => {
            const target = /** @type {HTMLElement} */ (event.target);
            if (!target) return;

            const selectButton = target.closest('[data-user-id]');
            if (selectButton) {
                const userId = selectButton.getAttribute('data-user-id');
                if (userId) {
                    await setActiveUser(userId);
                }
                return;
            }

            const deleteButton = target.closest('[data-remove-user-id]');
            if (deleteButton) {
                const userId = deleteButton.getAttribute('data-remove-user-id');
                if (userId) {
                    await removeUser(userId);
                }
            }
        });
    }

    if (dom.userCreateForm) {
        dom.userCreateForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            await handleCreateUser();
        });
    }

    if (dom.userCreateButton) {
        dom.userCreateButton.addEventListener('click', async (event) => {
            event.preventDefault();
            await handleCreateUser();
        });
    }
}

async function ensureSeedUsers() {
    const users = await getAllFromStore('users');
    if (Array.isArray(users) && users.length > 0) {
        return;
    }

    const seedUsers = [
        { userId: 'guest', displayName: 'Guest', createdAt: Date.now(), lastActiveAt: Date.now(), isDefault: true },
        { userId: 'user1', displayName: 'User 1', createdAt: Date.now(), lastActiveAt: Date.now(), isDefault: true },
        { userId: 'user2', displayName: 'User 2', createdAt: Date.now(), lastActiveAt: Date.now(), isDefault: true }
    ];

    for (const user of seedUsers) {
        await putValue('users', user);
    }

    await setAppMeta(ACTIVE_USER_META_KEY, 'guest');
}

async function refreshUsers() {
    cachedUsers = await getAllFromStore('users');
    cachedUsers.sort((a, b) => {
        const nameA = (a.displayName || '').toLowerCase();
        const nameB = (b.displayName || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });

    const storedActiveId =
        (await getAppMeta(ACTIVE_USER_META_KEY)) ||
        (cachedUsers[0] ? cachedUsers[0].userId : null);

    if (storedActiveId) {
        const found = cachedUsers.find((user) => user.userId === storedActiveId);
        if (found) {
            activeUser = found;
        } else {
            activeUser = cachedUsers[0] || null;
            if (activeUser) {
                await setAppMeta(ACTIVE_USER_META_KEY, activeUser.userId);
            }
        }
    } else {
        activeUser = cachedUsers[0] || null;
        if (activeUser) {
            await setAppMeta(ACTIVE_USER_META_KEY, activeUser.userId);
        }
    }

    renderUsers();
    notifyActiveUserChange();
}

function renderUsers() {
    if (!dom.userList) return;
    dom.userList.innerHTML = '';

    if (!cachedUsers.length) {
        const empty = document.createElement('div');
        empty.className = 'text-xs app-text-muted';
        empty.textContent = 'No users yet.';
        dom.userList.appendChild(empty);
        return;
    }

    cachedUsers.forEach((user) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center gap-2';

        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.userId = user.userId;
        button.className = [
            'flex-1 text-left border rounded-xl px-3 py-2 text-xs flex items-center justify-between gap-3 transition-colors app-list-button',
            activeUser && activeUser.userId === user.userId ? 'app-list-button-active' : ''
        ].join(' ');

        const name = document.createElement('span');
        name.className = 'font-semibold app-text-strong text-sm';
        name.textContent = user.displayName || user.userId;
        button.appendChild(name);

        const meta = document.createElement('span');
        meta.className = 'text-[11px] app-text-muted';
        meta.textContent =
            activeUser && activeUser.userId === user.userId
                ? 'Active'
                : 'Switch';
        button.appendChild(meta);

        wrapper.appendChild(button);

        if (!user.isDefault && cachedUsers.length > 1) {
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.dataset.removeUserId = user.userId;
            removeButton.className =
                'text-[11px] app-text-danger hover:underline flex-shrink-0 px-2';
            removeButton.textContent = 'Remove';
            wrapper.appendChild(removeButton);
        }

        dom.userList.appendChild(wrapper);
    });
}

async function handleCreateUser() {
    if (!dom.userCreateInput) return;
    const value = dom.userCreateInput.value.trim();
    if (!value) {
        dom.userCreateInput.focus();
        return;
    }

    const newUserId = generateUserId(value);
    const now = Date.now();
    const userRecord = {
        userId: newUserId,
        displayName: value,
        createdAt: now,
        lastActiveAt: now,
        isDefault: false
    };

    await putValue('users', userRecord);
    dom.userCreateInput.value = '';
    await refreshUsers();
    await setActiveUser(newUserId);
}

function generateUserId(name) {
    const base = name
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 20) || 'user';
    let attempt = 1;
    let candidate = base;
    while (cachedUsers.some((user) => user.userId === candidate)) {
        attempt += 1;
        candidate = `${base}-${attempt}`;
    }
    return candidate;
}

async function setActiveUser(userId) {
    if (!userId) return;
    const next = cachedUsers.find((user) => user.userId === userId);
    if (!next) return;
    activeUser = next;
    await setAppMeta(ACTIVE_USER_META_KEY, userId);
    await markUserAsActive(userId);
    renderUsers();
    notifyActiveUserChange();
}

async function markUserAsActive(userId) {
    const user = cachedUsers.find((u) => u.userId === userId);
    if (!user) return;
    user.lastActiveAt = Date.now();
    await putValue('users', user);
}

async function removeUser(userId) {
    const target = cachedUsers.find((user) => user.userId === userId);
    if (!target || target.isDefault) {
        return;
    }
    if (
        activeUser &&
        activeUser.userId === userId &&
        cachedUsers.length <= 1
    ) {
        return;
    }
    await deleteValue('users', userId);
    await refreshUsers();
}

function notifyActiveUserChange() {
    if (typeof callbacks.onActiveUserChange === 'function') {
        callbacks.onActiveUserChange(activeUser);
    }
}
