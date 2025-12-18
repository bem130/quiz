// js/main.js
import { initThemeFromStorage, toggleTheme, setSize, initAppHeightObserver } from './theme.js';
import { dom } from './dom-refs.js';
import { loadQuizDefinitionFromQuizEntry } from './quiz-model.js';
import { loadEntrySourceFromUrl } from './entry-model.js';
import {
    createDefaultEntrySources,
    getEntryUrlFromLocation,
    getQuizNameFromLocation,
    getModeIdFromLocation,
    loadEntrySourcesFromStorage,
    saveEntrySourcesToStorage
} from './config.js';
import { renderEntryMenu, renderQuizMenu } from './menu-renderer.js';
import { QuizEngine, NoQuestionsAvailableError, QUIZ_ENGINE_VERSION } from './quiz-engine.js';
import {
    clearLocalDraft,
    loadLocalDraftEntry,
    LOCAL_DRAFT_ENTRY_URL,
    updateLocalDraftFromText
} from './local-draft.js';
import {
    renderQuestion,
    renderProgress,
    showOptionFeedback,
    resetReviewList,
    addReviewItem,
    renderTips,
    resetTips,
    updateInlineBlank,
    showOptionFeedbackForAnswer,
    revealNextAnswerGroup,
    appendPatternPreviewToOptions,
    revealCorrectAnswerInPreviews,
    summarizeQuestion,
    summarizeAnswers,
    optionToText,
    resetResultList,
    addResultItem
} from './quiz-renderer.js';
import { selectAnswer, resetSelections } from './answer-state.js';
import { cloneQuestionForRetry } from './question-clone.js';
import {
    enqueueEntryCapacityTask,
    enqueueQuizCapacityTask,
    setCapacityRenderCallback,
    CAPACITY_MANAGER_VERSION
} from './capacity-manager.js';
import {
    findSourceInfo,
    addRubyBufferItem,
    buildRubyBufferItemFromDom,
    getRubyBufferSnapshot
} from './text-source-registry.js';
import { initUserManager } from './user-manager.js';
import { sessionCore } from './session-core.js';
import { getUserStats } from './storage/session-store.js';
import { makeQuestionKey } from './storage/schedule-store.js';
import { applyDistractorStrategy } from './distractor-strategy.js';
import {
    updateConfusionFromAttempt,
    getConfusionStatsForConcept
} from './storage/confusion-store.js';
import {
    updateConceptStatsFromAttempt,
    getConceptStatsMap
} from './storage/concept-stats.js';

let entrySources = [];
let currentEntry = null;
let currentQuiz = null;
let quizDef = null;
let engine = null;

let totalQuestions = 10;
let currentIndex = 0;
let currentScore = 0;
let currentQuestion = null;
let currentQuestionStage = null;
let hasAnswered = false;
let questionHistory = [];
let customQuestionSequence = null;
let useCustomQuestionSequence = false;
let questionStartTime = null;

// 現在選択中の modeId
let currentModeId = null;

// Current screen ("menu" | "quiz" | "result")
let currentScreen = 'menu';
const MENU_TABS = ['quizzes', 'mode', 'options'];
let activeMenuTab = 'quizzes';
let activeUser = null;
let pendingIdkState = null;
let currentUserStats = {
    totalAttempts: 0,
    correctAttempts: 0,
    weakAttempts: 0,
    idkCount: 0
};
let currentModeBehavior = 'study';

// Timer state
let quizStartTime = null;
let quizTimerId = null;
let quizFinishTime = null;

/** @type {BeforeInstallPromptEvent | null} */
let deferredInstallPrompt = null;
let hasPwaInstallPromptSupport = false;

const CACHE_PREFIX = 'quiz-app-shell-';
const CACHE_RECOVERY_FLAG_KEY = 'quiz-app-cache-recovery-attempted';
const WEAK_CORRECT_THRESHOLD_MS = 8000;
const CONFUSION_WEAK_THRESHOLD = 0.6;
const MAX_RECENT_RESPONSE_TIMES = 40;
let recentAnswerDurations = [];

function generateSessionSeed() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    const randomPart = Math.floor(Math.random() * 1e6)
        .toString(36)
        .padStart(4, '0');
    return `${Date.now().toString(36)}-${randomPart}`;
}

function updateQuestionStageLabel(stage) {
    currentQuestionStage = stage || null;
    if (!dom.questionStageLabel) {
        return;
    }
    if (!stage) {
        dom.questionStageLabel.textContent = '--';
        dom.questionStageLabel.dataset.stage = '';
        return;
    }
    dom.questionStageLabel.textContent = stage;
    dom.questionStageLabel.dataset.stage = stage.toLowerCase();
}

function resolveQuestionStage(question) {
    if (question && typeof question.__sessionStage === 'string') {
        return String(question.__sessionStage).toUpperCase();
    }
    if (currentModeBehavior === 'test') {
        return 'TEST';
    }
    if (useCustomQuestionSequence) {
        return 'CUSTOM';
    }
    if (!sessionCore.hasActiveRunner()) {
        return null;
    }
    return 'STUDY';
}

/**
 * Collect all quiz data URLs and send them to the Service Worker.
 */
function syncQuizDataUrlsToServiceWorker() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
        return;
    }

    const urls = new Set();
    if (Array.isArray(entrySources)) {
        entrySources.forEach((entry) => {
            if (entry.url) {
                try {
                    // Add entry URL (entry.php)
                    urls.add(new URL(entry.url, window.location.href).href);

                    // Add data URL if available (e.g. .json)
                    if (entry.dataUrl) {
                        urls.add(new URL(entry.dataUrl, window.location.href).href);
                    }
                } catch (e) {
                    // Ignore invalid URLs
                }
            }
        });
    }

    navigator.serviceWorker.controller.postMessage({
        type: 'UPDATE_QUIZ_DATA_URLS',
        urls: Array.from(urls)
    });
}

// Modal button wiring (global)
(function setupShareModalHandlers() {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    const closeBtn = document.getElementById('share-modal-close');
    const backdrop = document.getElementById('share-modal-backdrop');
    const copyBtn = document.getElementById('share-copy-button');
    const openBtn = document.getElementById('share-open-button');
    const input = document.getElementById('share-url-input');

    if (closeBtn) closeBtn.addEventListener('click', () => closeShareModal());
    if (backdrop) backdrop.addEventListener('click', () => closeShareModal());

    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            if (!input) return;
            try {
                await navigator.clipboard.writeText(input.value);
                copyBtn.textContent = 'Copied!';
                setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 1500);
            } catch (e) {
                console.warn('Copy failed', e);
            }
        });
    }

    if (openBtn) {
        openBtn.addEventListener('click', () => {
            if (!input) return;
            window.open(input.value, '_blank');
        });
    }

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeShareModal();
        }
    });
})();

// Context Menu for Source Info
(function setupTextContextMenu() {
    document.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const info = findSourceInfo(target);
        if (!info) {
            return;
        }

        // Prevent default menu for our tracked elements
        event.preventDefault();

        const rubyItem = buildRubyBufferItemFromDom(target, info);
        if (rubyItem) {
            // Ruby element -> Add to buffer
            addRubyBufferItem(rubyItem);
            console.log('[ruby-buffer] added', rubyItem);

            // Simple feedback
            const toast = document.createElement('div');
            toast.className = 'fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded shadow-lg text-xs z-50 animate-fade-in-up';
            toast.textContent = `Added to Ruby Buffer: ${rubyItem.baseText} (${rubyItem.rubyText})`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
            return;
        }

        // Normal text -> Copy info
        const payload = {
            file: info.file,
            line: info.line,
            column: info.column,
            endLine: info.endLine,
            endColumn: info.endColumn,
            dataSetId: info.dataSetId,
            rowId: info.rowId,
            field: info.field,
            tokenIndex: info.tokenIndex
        };
        console.log('[text-source]', payload);

        // Copy to clipboard or show prompt
        // For now, let's use prompt for easy copying
        // window.prompt('Source info (JSON):', JSON.stringify(payload, null, 2));

        // Or better, copy to clipboard silently and show toast
        navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
            const toast = document.createElement('div');
            toast.className = 'fixed bottom-4 right-4 bg-slate-800 text-white px-4 py-2 rounded shadow-lg text-xs z-50 animate-fade-in-up';
            toast.textContent = `Source info copied to clipboard`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        }).catch(err => {
            window.prompt('Source info (JSON):', JSON.stringify(payload, null, 2));
        });
    });
})();

/**
 * Reload the application with Service Worker update check.
 */
async function reloadApp() {
    if (!('serviceWorker' in navigator)) {
        window.location.reload();
        return;
    }

    const reg = await navigator.serviceWorker.getRegistration();

    if (!reg) {
        window.location.reload();
        return;
    }

    // Check for updates
    await reg.update();

    // If there's a waiting worker, skip waiting to activate it immediately
    if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }

    // Wait for controller change if a new worker is taking over
    if (reg.waiting || reg.installing) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
        });
    } else {
        // No update pending, just reload
        window.location.reload();
    }
}

/**
 * Force reload a specific entry.
 * @param {string} url - The entry URL to reload.
 */
async function reloadEntry(url) {
    const entry = entrySources.find((e) => e.url === url);
    if (!entry) return;

    // Show loading state (optional, can be handled by caller or global spinner)
    const button = document.querySelector(`button[data-reload-entry-url="${url}"]`);
    if (button) {
        const originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="animate-spin inline-block">↻</span>';

        try {
            // Force fetch with cache: 'reload' to bypass HTTP cache and update SW cache via Network First
            await fetch(entry.url, { cache: 'reload' });

            // If the entry has a separate dataUrl, fetch that too
            if (entry.dataUrl) {
                await fetch(entry.dataUrl, { cache: 'reload' });
            }

            // Refresh the entry data in the app
            const loaded = await loadEntrySourceFromUrl(entry.url);

            // Update the entry in the list
            const index = entrySources.findIndex((e) => e.url === url);
            if (index !== -1) {
                entrySources[index] = {
                    ...entrySources[index],
                    ...loaded,
                    label: loaded.label || entrySources[index].label,
                    updatedAt: Date.now() // Mark as updated
                };
                persistEntrySources();
                renderMenus();
            }

            // If this is the current entry, reload it
            if (currentEntry && currentEntry.url === url) {
                await applyEntrySelection(entrySources[index], getQuizNameFromLocation(), {
                    preserveModeFromUrl: true
                });
            }

        } catch (error) {
            console.error('[reloadEntry] Failed to reload entry:', error);
            alert('Failed to reload entry. Please check your connection.');
        } finally {
            button.disabled = false;
            button.innerHTML = originalText;
        }
    }
}

/**
 * Clear app-specific caches and unregister service workers, then reload.
 * This function is safe to call multiple times, but callers should avoid
 * creating reload loops (use sessionStorage guard for auto-recovery).
 */
async function clearAppCachesAndReload(reason = 'unknown') {
    console.info('[cache-clear] start:', { reason });

    try {
        // 1. Delete Cache Storage entries for this app
        if ('caches' in window) {
            const keys = await caches.keys();
            const appKeys = keys.filter((key) =>
                key.startsWith(CACHE_PREFIX)
            );

            await Promise.all(appKeys.map((key) => caches.delete(key)));
            console.info('[cache-clear] deleted caches:', appKeys);
        }

        // 2. Unregister service workers for this origin (quiz scope)
        if ('serviceWorker' in navigator &&
            navigator.serviceWorker.getRegistrations) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                const url = registration.active?.scriptURL || '';
                if (url.endsWith('/quiz/sw.php') || url.endsWith('/quiz/sw.js')) {
                    await registration.unregister();
                }
            }
            console.info('[cache-clear] unregistered service workers');
        }
    } catch (error) {
        console.error('[cache-clear] failed:', error);
    } finally {
        // 3. Reload the page
        window.location.reload();
    }
}

/**
 * Compare expected app version with module versions to surface cache mismatches early.
 */
function assertVersionCompatibility() {
    const expectedVersion = window.APP_VERSION;

    // If server does not provide version, treat as "no versioning"
    if (!expectedVersion) {
        return true;
    }

    const mismatches = [];
    const components = [
        { name: 'quiz-engine', version: QUIZ_ENGINE_VERSION },
        { name: 'capacity-manager', version: CAPACITY_MANAGER_VERSION }
    ];

    for (const component of components) {
        if (!component.version || component.version !== expectedVersion) {
            mismatches.push(component);
        }
    }

    if (mismatches.length === 0) {
        return true;
    }

    console.error('[version-mismatch]', {
        expected: expectedVersion,
        mismatches
    });

    // Show message to the user
    if (dom.appDescription) {
        dom.appDescription.textContent =
            `アプリのコードとサーバのバージョンが一致していません。` +
            ` (expected: ${expectedVersion}) ` +
            `キャッシュ削除と再読み込みを試行します…`;
    }

    // Disable main actions
    if (dom.startButton) {
        dom.startButton.disabled = true;
    }
    if (dom.entryAddButton) {
        dom.entryAddButton.disabled = true;
    }

    // Auto recovery (guarded by sessionStorage to avoid loops)
    try {
        const alreadyTried =
            sessionStorage.getItem(CACHE_RECOVERY_FLAG_KEY) === '1';

        if (!alreadyTried) {
            sessionStorage.setItem(CACHE_RECOVERY_FLAG_KEY, '1');
            clearAppCachesAndReload('version-mismatch');
        } else {
            console.warn(
                '[version-mismatch] cache recovery already attempted in this session'
            );
        }
    } catch (error) {
        console.error('[version-mismatch] failed to access sessionStorage:', error);
    }

    return false;
}

/**
 * Update timer text with given elapsed seconds.
 * Format: mm:ss
 */
function updateQuizTimerDisplay(elapsedSeconds) {
    if (!dom.quizTimer) return;
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    dom.quizTimer.textContent = `${mm}:${ss}`;
}

/**
 * Reset timer state and display to 00:00.
 */
function resetQuizTimer() {
    quizStartTime = null;
    if (quizTimerId) {
        clearInterval(quizTimerId);
        quizTimerId = null;
    }
    updateQuizTimerDisplay(0);
}

/**
 * Start timer from zero.
 */
function startQuizTimer() {
    resetQuizTimer();
    quizStartTime = Date.now();
    quizTimerId = window.setInterval(() => {
        if (!quizStartTime) return;
        const elapsedMs = Date.now() - quizStartTime;
        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        updateQuizTimerDisplay(elapsedSeconds);
    }, 1000);
}

/**
 * Stop timer but keep current display value.
 */
function stopQuizTimer() {
    if (quizTimerId) {
        clearInterval(quizTimerId);
        quizTimerId = null;
    }
}

function formatIsoTimestamp(timestamp) {
    if (!timestamp) {
        return null;
    }
    return new Date(timestamp).toISOString();
}

function calculateAccuracy(correctCount, answeredCount) {
    if (answeredCount <= 0) {
        return 0;
    }
    return Math.round((correctCount / answeredCount) * 100);
}

function clampQuestionCount(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 10;
    }
    const clamped = Math.min(100, Math.max(5, numericValue));
    const adjusted = Math.round(clamped / 5) * 5;
    return Math.min(100, Math.max(5, adjusted));
}

/**
 * 判定可能な複数のシグナルを使って、PWA として起動しているかを検出する。
 */
function isRunningAsPwa() {
    const matchesDisplayMode = (query) => (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia(query).matches
    );

    const isStandaloneDisplay =
        matchesDisplayMode('(display-mode: standalone)') ||
        matchesDisplayMode('(display-mode: minimal-ui)') ||
        matchesDisplayMode('(display-mode: fullscreen)');

    const isIosStandalone =
        typeof window !== 'undefined' &&
        typeof window.navigator !== 'undefined' &&
        (window.navigator.standalone === true ||
            (window.clientInformation && window.clientInformation.standalone === true));

    const isFromAndroidApp =
        typeof document !== 'undefined' &&
        typeof document.referrer === 'string' &&
        document.referrer.includes('android-app://');

    return Boolean(isStandaloneDisplay || isIosStandalone || isFromAndroidApp);
}

/**
 * Result 画面の PWA インストール案内の表示可否を更新する。
 */
function tryUpdatePwaHintVisibility() {
    if (!dom.resultPwaHint || !dom.resultPwaInstallButton) {
        return;
    }

    const shouldShow =
        currentScreen === 'result' &&
        !isRunningAsPwa() &&
        deferredInstallPrompt !== null &&
        hasPwaInstallPromptSupport;

    dom.resultPwaInstallButton.disabled = !shouldShow;

    if (shouldShow) {
        dom.resultPwaHint.classList.remove('hidden');
    } else {
        dom.resultPwaHint.classList.add('hidden');
    }
}

window.addEventListener('beforeinstallprompt', (event) => {
    console.log('[pwa] beforeinstallprompt fired');
    event.preventDefault();
    deferredInstallPrompt = event;
    hasPwaInstallPromptSupport = true;
    tryUpdatePwaHintVisibility();
});

function updateQuestionCountLabel(value) {
    if (!dom.questionCountLabel) {
        return;
    }
    dom.questionCountLabel.textContent = `${value} 問`;
}

function syncQuestionCountInputs(value) {
    const normalized = clampQuestionCount(value);
    if (dom.questionCountSlider) {
        dom.questionCountSlider.value = normalized;
    }
    if (dom.questionCountInput) {
        dom.questionCountInput.value = normalized;
    }
    updateQuestionCountLabel(normalized);
}

function getConfiguredQuestionCount() {
    if (!dom.questionCountInput) {
        return 10;
    }
    return clampQuestionCount(dom.questionCountInput.value);
}

function getMenuTabElements(name) {
    switch (name) {
        case 'mode':
            return {
                button: dom.menuTabModeButton,
                panel: dom.menuTabModePanel
            };
        case 'options':
            return {
                button: dom.menuTabOptionsButton,
                panel: dom.menuTabOptionsPanel
            };
        case 'quizzes':
        default:
            return {
                button: dom.menuTabQuizzesButton,
                panel: dom.menuTabQuizzesPanel
            };
    }
}

function setActiveMenuTab(name, options = {}) {
    const tabName = MENU_TABS.includes(name) ? name : 'quizzes';
    const shouldFocus = options.focus === true;
    activeMenuTab = tabName;

    MENU_TABS.forEach((candidate) => {
        const { button, panel } = getMenuTabElements(candidate);
        const isActive = candidate === tabName;

        if (button) {
            button.classList.toggle('menu-tab-button-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            button.tabIndex = isActive ? 0 : -1;
            if (isActive && shouldFocus) {
                button.focus();
            }
        }

        if (panel) {
            if (isActive) {
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
        }
    });
}

function updateSelectionSummary() {
    if (
        !dom.selectedQuizTitle ||
        !dom.selectedQuizDesc ||
        !dom.selectedModeTitle ||
        !dom.selectedModeDesc
    ) {
        return;
    }

    // Quiz summary
    let quizTitle = 'No quiz selected';
    let quizDesc = currentEntry ? 'Choose a quiz from the Quizzes tab.' : 'Add or select an entry to begin.';

    if (currentQuiz) {
        quizTitle = currentQuiz.title || currentQuiz.id || 'Selected quiz';
        if (currentQuiz.description) {
            quizDesc = currentQuiz.description;
        } else if (currentEntry) {
            const entryLabel = currentEntry.label || currentEntry.url || 'Current entry';
            quizDesc = `From ${entryLabel}`;
        } else {
            quizDesc = 'Ready to configure options.';
        }
    }

    dom.selectedQuizTitle.textContent = quizTitle;
    dom.selectedQuizDesc.textContent = quizDesc;

    // Mode summary
    let modeTitle = 'No mode selected';
    let modeDesc = 'Choose a mode from the Mode tab.';

    if (currentModeId) {
        if (currentModeId.startsWith('__pattern__')) {
            const patternId = currentModeId.replace('__pattern__', '');
            const pattern = quizDef && Array.isArray(quizDef.patterns)
                ? quizDef.patterns.find((p) => p.id === patternId)
                : null;
            modeTitle = pattern
                ? (pattern.label || `Pattern: ${pattern.id}`)
                : `Pattern: ${patternId}`;
            if (pattern && pattern.description) {
                modeDesc = pattern.description;
            } else if (engine && typeof engine.getPatternCapacity === 'function') {
                const cap = engine.getPatternCapacity(patternId);
                modeDesc = cap > 0
                    ? `~${cap} variations available.`
                    : 'No questions available for this pattern.';
            } else {
                modeDesc = 'Single-pattern preview.';
            }
        } else if (quizDef && Array.isArray(quizDef.modes)) {
            const mode = quizDef.modes.find((m) => m && m.id === currentModeId) || null;
            modeTitle = mode ? (mode.label || mode.id) : currentModeId;
            if (mode && mode.description) {
                modeDesc = mode.description;
            } else if (engine && typeof engine.estimateModeCapacity === 'function') {
                const capacity = engine.estimateModeCapacity(currentModeId);
                modeDesc = capacity > 0
                    ? `~${capacity} variations available.`
                    : 'No questions available for this mode.';
            } else {
                modeDesc = `Mode ID: ${currentModeId}`;
            }
        } else {
            modeTitle = 'Mode selected';
            modeDesc = 'Loading mode details...';
        }
    } else if (!currentQuiz) {
        modeDesc = 'Select a quiz first.';
    }

    dom.selectedModeTitle.textContent = modeTitle;
    dom.selectedModeDesc.textContent = modeDesc;
}

function resolveModeBehavior(mode) {
    if (!mode) return 'study';
    const meta =
        (mode.behavior || mode.modeType || mode.category || '').toString().toLowerCase();
    if (meta.includes('test')) {
        return 'test';
    }
    if (mode.id && mode.id.toLowerCase().includes('test')) {
        return 'test';
    }
    return 'study';
}

function handleActiveUserChange(user) {
    activeUser = user || null;
    updateActiveUserDisplays();
    refreshCurrentUserStats();
}

function updateActiveUserDisplays() {
    const label = activeUser
        ? activeUser.displayName || activeUser.userId
        : 'Guest';
    if (dom.sideUserLabel) {
        dom.sideUserLabel.textContent = label;
    }
    if (dom.quizUserLabel) {
        dom.quizUserLabel.textContent = label;
    }
    if (dom.resultUserLabel) {
        dom.resultUserLabel.textContent = `User: ${label}`;
    }
}

async function refreshCurrentUserStats() {
    if (!activeUser) {
        updateUserStatsDisplays(null);
        return;
    }
    try {
        const stats = await getUserStats(activeUser.userId);
        currentUserStats = stats;
        updateUserStatsDisplays(stats);
    } catch (error) {
        console.error('[stats] failed to load user stats', error);
        updateUserStatsDisplays(null);
    }
}

function updateUserStatsDisplays(statsInput) {
    const stats = statsInput || currentUserStats || {
        totalAttempts: 0,
        correctAttempts: 0,
        weakAttempts: 0,
        idkCount: 0
    };
    const total = stats.totalAttempts || 0;
    const correct = stats.correctAttempts || 0;
    const accuracy =
        total > 0 ? `${Math.round((correct / total) * 100)}%` : '--';
    const attemptsText = total > 0 ? `${total}` : '0';

    if (dom.quizLifetimeAccuracy) {
        dom.quizLifetimeAccuracy.textContent = accuracy;
    }
    if (dom.quizLifetimeAttempts) {
        dom.quizLifetimeAttempts.textContent = attemptsText;
    }
    if (dom.resultLifetimeAccuracy) {
        dom.resultLifetimeAccuracy.textContent = accuracy;
    }
    if (dom.resultTotalAttempts) {
        dom.resultTotalAttempts.textContent = attemptsText;
    }
}

function resolveQuestionIdentifier(question) {
    if (!question) return null;
    if (question.id) return question.id;
    if (question.meta && (question.meta.questionId || question.meta.id)) {
        return question.meta.questionId || question.meta.id;
    }
    return null;
}

function getActiveQuizIdentifier() {
    if (quizDef && quizDef.meta && quizDef.meta.id) {
        return quizDef.meta.id;
    }
    if (currentQuiz && currentQuiz.id) {
        return currentQuiz.id;
    }
    return 'quiz';
}

function extractOptionConceptId(option) {
    if (!option) return null;
    if (option.conceptId) return option.conceptId;
    if (option.meta && option.meta.conceptId) return option.meta.conceptId;
    if (option.entityId) return option.entityId;
    return null;
}

function buildAttemptSnapshot(question, meta) {
    const answers = Array.isArray(question && question.answers) ? question.answers : [];
    const firstAnswer = answers[0] || {};
    const options = Array.isArray(firstAnswer.options) ? firstAnswer.options : [];
    const dataSets = quizDef ? quizDef.dataSets : null;

    const optionSnapshots = options.map((option, index) => ({
        index,
        label: optionToText(option, dataSets, question),
        entityId: option && (option.entityId || option.id || null),
        conceptId: extractOptionConceptId(option),
        isCorrect:
            typeof firstAnswer.correctIndex === 'number'
                ? index === firstAnswer.correctIndex
                : null
    }));

    const selectedIndex =
        typeof firstAnswer.userSelectedIndex === 'number'
            ? firstAnswer.userSelectedIndex
            : null;
    const correctIndex =
        typeof firstAnswer.correctIndex === 'number'
            ? firstAnswer.correctIndex
            : null;
    const nearestIndex =
        typeof meta.nearestOptionIndex === 'number' ? meta.nearestOptionIndex : null;
    const correctOption =
        typeof correctIndex === 'number' ? optionSnapshots[correctIndex] : null;
    const selectedOption =
        typeof selectedIndex === 'number' ? optionSnapshots[selectedIndex] : null;
    const nearestOption =
        typeof nearestIndex === 'number' ? optionSnapshots[nearestIndex] : null;

    const quizIdentifier = getActiveQuizIdentifier();
    const resolvedQuestionId =
        resolveQuestionIdentifier(question) ||
        (question && question.id ? question.id : 'unknown');
    const questionKey = String(resolvedQuestionId);
    const compositeQid = makeQuestionKey(quizIdentifier, questionKey);

    return {
        questionId: questionKey,
        qid: compositeQid,
        packageId: quizIdentifier,
        patternId:
            (question && (question.patternId || (question.meta && question.meta.patternId))) ||
            null,
        dataSetId:
            question && question.meta && question.meta.dataSetId ? question.meta.dataSetId : null,
        options: optionSnapshots,
        selectedIndex,
        correctIndex,
        nearestOptionIndex: nearestIndex,
        correctConceptId: correctOption ? correctOption.conceptId : null,
        selectedConceptId: selectedOption ? selectedOption.conceptId : null,
        nearestConceptId: nearestOption ? nearestOption.conceptId : null,
        resultType: meta.resultType,
        correct: Boolean(meta.correct),
        answerMs: typeof meta.answerMs === 'number' ? meta.answerMs : null,
        timestamp: Date.now()
    };
}

async function persistAttemptRecord(question, meta) {
    if (!question) {
        return;
    }
    try {
        const snapshot = buildAttemptSnapshot(question, meta);
        const session = sessionCore.getCurrentSession();
        const userId = session
            ? session.userId
            : activeUser
                ? activeUser.userId || 'guest'
                : 'guest';
        const questionIndex =
            typeof meta.questionIndex === 'number' ? meta.questionIndex : null;
        if (session) {
            await sessionCore.recordAttempt({
                ...snapshot,
                userId,
                sessionId: session.sessionId || sessionCore.getSessionId()
            });
        }
        await Promise.all([
            updateConfusionFromAttempt(userId, snapshot),
            updateConceptStatsFromAttempt(userId, snapshot)
        ]);
        await sessionCore.submitAnswer({
            questionId: snapshot.questionId,
            resultType: snapshot.resultType,
            answerMs: snapshot.answerMs,
            questionIndex
        });
        await refreshCurrentUserStats();
    } catch (error) {
        console.error('[session] failed to log attempt', error);
    }
}

function recordAnswerDuration(answerMs) {
    if (
        typeof answerMs !== 'number' ||
        !Number.isFinite(answerMs) ||
        answerMs <= 0
    ) {
        return;
    }
    recentAnswerDurations.push(answerMs);
    if (recentAnswerDurations.length > MAX_RECENT_RESPONSE_TIMES) {
        recentAnswerDurations.shift();
    }
}

function getMedianAnswerDuration() {
    if (!recentAnswerDurations.length) {
        return null;
    }
    const sorted = [...recentAnswerDurations].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function isSlowAnswer(answerMs) {
    if (
        typeof answerMs !== 'number' ||
        !Number.isFinite(answerMs) ||
        answerMs <= 0
    ) {
        return false;
    }
    const median = getMedianAnswerDuration();
    if (!median) {
        return answerMs > WEAK_CORRECT_THRESHOLD_MS;
    }
    return answerMs > median * 1.5;
}

async function isConceptUncertain(question) {
    if (!question || !Array.isArray(question.answers)) {
        return false;
    }
    const answers = question.answers;
    const firstAnswer = answers[0];
    if (!firstAnswer || !Array.isArray(firstAnswer.options)) {
        return false;
    }
    const correctIndex =
        typeof firstAnswer.correctIndex === 'number'
            ? firstAnswer.correctIndex
            : null;
    if (correctIndex == null || !firstAnswer.options[correctIndex]) {
        return false;
    }
    const conceptId = extractOptionConceptId(
        firstAnswer.options[correctIndex]
    );
    if (conceptId == null) {
        return false;
    }
    const userId = activeUser ? activeUser.userId || 'guest' : 'guest';
    try {
        const statsMap = await getConceptStatsMap(userId, [conceptId]);
        const stats = statsMap.get(String(conceptId));
        return Boolean(
            stats &&
                typeof stats.uncertaintyEma === 'number' &&
                stats.uncertaintyEma >= 0.6
        );
    } catch (error) {
        console.warn('[quiz] failed to read concept stats for classify', error);
        return false;
    }
}

async function hasOnScreenConfusionRisk(question) {
    if (!question || !Array.isArray(question.answers)) {
        return false;
    }
    const answers = question.answers;
    const firstAnswer = answers[0];
    if (!firstAnswer || !Array.isArray(firstAnswer.options)) {
        return false;
    }
    const correctIndex =
        typeof firstAnswer.correctIndex === 'number'
            ? firstAnswer.correctIndex
            : null;
    if (correctIndex == null || !firstAnswer.options[correctIndex]) {
        return false;
    }
    const correctOption = firstAnswer.options[correctIndex];
    const correctConceptId = extractOptionConceptId(correctOption);
    if (correctConceptId == null) {
        return false;
    }
    const optionConcepts = firstAnswer.options
        .map((opt) => extractOptionConceptId(opt))
        .filter((cid) => cid != null)
        .map((cid) => String(cid));
    if (!optionConcepts.length) {
        return false;
    }
    const optionConceptSet = new Set(optionConcepts);
    const userId = activeUser ? activeUser.userId || 'guest' : 'guest';
    try {
        const confusions = await getConfusionStatsForConcept(
            userId,
            correctConceptId,
            { limit: 5 }
        );
        if (!confusions || !confusions.length) {
            return false;
        }
        return confusions.some(
            (entry) =>
                optionConceptSet.has(String(entry.wrongConceptId)) &&
                typeof entry.scoreCache === 'number' &&
                entry.scoreCache >= CONFUSION_WEAK_THRESHOLD
        );
    } catch (error) {
        console.warn('[quiz] failed to read confusion stats for classify', error);
        return false;
    }
}

async function classifyResult(selectionState, answerMs, question) {
    if (!selectionState || !selectionState.fullyCorrect) {
        return 'wrong';
    }
    const slow = isSlowAnswer(answerMs);
    const conceptUncertain = await isConceptUncertain(question);
    const confusionRisk = await hasOnScreenConfusionRisk(question);
    if (slow || conceptUncertain || confusionRisk) {
        return 'weak';
    }
    return 'strong';
}

function resetIdkState() {
    pendingIdkState = null;
    if (dom.idkFollowupPanel) {
        dom.idkFollowupPanel.classList.add('hidden');
    }
    if (dom.idkFollowupOptions) {
        dom.idkFollowupOptions.innerHTML = '';
    }
    if (dom.idkButton) {
        dom.idkButton.disabled = false;
    }
}

function startIdkFlow() {
    if (!currentQuestion || hasAnswered) return;
    if (!dom.idkFollowupPanel || !dom.idkFollowupOptions) {
        finalizeIdkResult(null).catch((error) => {
            console.error('[quiz] finalize IDK failed', error);
        });
        return;
    }
    pendingIdkState = { questionIndex: currentIndex };
    dom.idkFollowupOptions.innerHTML = '';
    const answer = currentQuestion.answers && currentQuestion.answers[0];
    const options = (answer && Array.isArray(answer.options)) ? answer.options : [];
    if (!options.length) {
        finalizeIdkResult(null).catch((error) => {
            console.error('[quiz] finalize IDK failed', error);
        });
        return;
    }
    options.forEach((option, index) => {
        const label = optionToText(option, quizDef ? quizDef.dataSets : null, currentQuestion);
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.idkOptionIndex = String(index);
        button.className = 'w-full text-left px-2 py-1 rounded-lg border app-border-subtle app-text-main hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors';
        button.textContent = `${String.fromCharCode(65 + index)}. ${label}`;
        dom.idkFollowupOptions.appendChild(button);
    });
    dom.idkFollowupPanel.classList.remove('hidden');
    if (dom.idkButton) {
        dom.idkButton.disabled = true;
    }
    if (dom.nextButton) {
        dom.nextButton.disabled = true;
    }
}

function completeIdk(nearestOptionIndex = null) {
    if (!pendingIdkState) {
        return;
    }
    finalizeIdkResult(
        typeof nearestOptionIndex === 'number' ? nearestOptionIndex : null
    ).catch((error) => {
        console.error('[quiz] finalize IDK failed', error);
    });
}

async function finalizeIdkResult(nearestOptionIndex) {
    if (!currentQuestion || hasAnswered) {
        resetIdkState();
        if (dom.nextButton) dom.nextButton.disabled = false;
        return;
    }
    hasAnswered = true;
    const answerMs = questionStartTime ? Date.now() - questionStartTime : null;
    questionStartTime = null;
    addReviewItem(currentQuestion, quizDef ? quizDef.dataSets : null, currentIndex + 1);
    const historyItem = {
        index: currentIndex + 1,
        question: currentQuestion,
        userAnswerSummary: 'Skipped (IDK)',
        correct: false,
        resultType: 'idk',
        nearestOptionIndex,
        answerMs
    };
    questionHistory.push(historyItem);

    showOptionFeedback(currentQuestion);
    appendPatternPreviewToOptions(currentQuestion, quizDef ? quizDef.dataSets : null);
    renderProgress(currentIndex, totalQuestions, currentScore);
    resetTips();

    if (dom.nextButton) {
        dom.nextButton.disabled = false;
    }
    resetIdkState();
    if (dom.idkButton) {
        dom.idkButton.disabled = true;
    }
    await persistAttemptRecord(currentQuestion, {
        resultType: 'idk',
        correct: false,
        nearestOptionIndex,
        answerMs,
        questionIndex: currentIndex
    });
}


function resolveRowForQuestion(question) {
    if (!question || !question.meta || !question.meta.dataSetId) return null;
    const ds = quizDef && quizDef.dataSets ? quizDef.dataSets[question.meta.dataSetId] : null;
    if (!ds) return null;
    if (ds.type === 'table' && Array.isArray(ds.data)) {
        return ds.data.find((row) => row.id === question.meta.entityId) || null;
    }
    if (ds.type === 'factSentences' && Array.isArray(ds.sentences)) {
        return ds.sentences.find((s) => s.id === question.meta.sentenceId) || null;
    }
    return null;
}

/**
 * メイン／サイド／結果表示を含めた画面の表示状態を切り替える。
 * @param {'menu' | 'quiz' | 'result'} name - 表示する画面の名前。
 */
function showScreen(name) {
    const previousScreen = currentScreen;
    currentScreen = name;

    if (name !== 'quiz') {
        updateQuestionStageLabel(null);
    } else if (currentQuestion) {
        updateQuestionStageLabel(resolveQuestionStage(currentQuestion));
    }

    if (name !== 'quiz') {
        resetIdkState();
    }

    // Main
    dom.mainMenu.classList.add('hidden');
    dom.mainQuiz.classList.add('hidden');
    if (dom.questionView) {
        dom.questionView.classList.remove('hidden');
    }

    // Side
    dom.sideMenu.classList.add('hidden');
    dom.sideQuiz.classList.add('hidden');

    // Header/score area (bottom bar center)
    dom.quizHeaderScore.classList.add('hidden');

    // Result panel
    dom.resultScreen.classList.add('hidden');
    if (dom.resultListPanel) {
        dom.resultListPanel.classList.add('hidden');
    }
    if (dom.mistakesPanel) {
        dom.mistakesPanel.classList.add('hidden');
    }
    if (dom.resultPwaHint) {
        dom.resultPwaHint.classList.add('hidden');
    }

    // Bottom buttons: hide by default
    if (dom.nextButton) {
        dom.nextButton.classList.add('hidden');
    }
    if (dom.interruptButton) {
        dom.interruptButton.classList.add('hidden');
    }
    if (dom.idkButton) {
        dom.idkButton.classList.add('hidden');
        dom.idkButton.disabled = true;
    }
    if (dom.idkFollowupPanel) {
        dom.idkFollowupPanel.classList.add('hidden');
    }

    if (name === 'menu') {
        dom.mainMenu.classList.remove('hidden');
        dom.sideMenu.classList.remove('hidden');
        if (previousScreen !== 'menu') {
            setActiveMenuTab('quizzes');
        } else {
            setActiveMenuTab(activeMenuTab || 'quizzes');
        }
        checkForUpdate();
    } else if (name === 'quiz') {
        dom.mainQuiz.classList.remove('hidden');
        dom.sideQuiz.classList.remove('hidden');
        dom.quizHeaderScore.classList.remove('hidden');
        if (dom.questionView) {
            dom.questionView.classList.remove('hidden');
        }
        if (dom.mistakesPanel) {
            dom.mistakesPanel.classList.remove('hidden');
        }
        if (dom.nextButton) {
            dom.nextButton.classList.remove('hidden');
        }
        if (dom.interruptButton) {
            dom.interruptButton.classList.remove('hidden');
        }
        if (dom.idkButton) {
            dom.idkButton.classList.remove('hidden');
            dom.idkButton.disabled = false;
        }
    } else if (name === 'result') {
        dom.mainQuiz.classList.remove('hidden');
        dom.sideQuiz.classList.remove('hidden');
        dom.quizHeaderScore.classList.remove('hidden');
        dom.resultScreen.classList.remove('hidden');
        if (dom.questionView) {
            dom.questionView.classList.add('hidden');
        }
        if (dom.resultListPanel) {
            dom.resultListPanel.classList.remove('hidden');
        }
        // In result screen: Next and interrupt remain hidden

        renderRubyBufferInResult();
    }
}

function renderRubyBufferInResult() {
    if (!dom.rubyBufferPanel || !dom.rubyBufferJson) return;

    const items = getRubyBufferSnapshot();
    if (!items || items.length === 0) {
        dom.rubyBufferPanel.classList.add('hidden');
        dom.rubyBufferJson.value = '';
        return;
    }

    dom.rubyBufferPanel.classList.remove('hidden');

    // Simplify for display
    const simplified = items.map((it) => ({
        file: it.file,
        range: it.range || null,
        base: it.baseText,
        ruby: it.rubyText
    }));

    dom.rubyBufferJson.value = JSON.stringify(simplified, null, 2);
}

function setStartButtonEnabled(enabled) {
    if (!dom.startButton) return;
    dom.startButton.disabled = !enabled;
    if (enabled) {
        dom.startButton.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        dom.startButton.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

function showModeMessage(message, tone = 'error') {
    if (!dom.modeMessage) return;
    dom.modeMessage.textContent = message;
    dom.modeMessage.classList.remove('hidden');
    dom.modeMessage.classList.remove('app-text-success', 'app-text-danger');
    if (tone === 'success') {
        dom.modeMessage.classList.add('app-text-success');
    } else {
        dom.modeMessage.classList.add('app-text-danger');
    }
}

function clearModeMessage() {
    if (!dom.modeMessage) return;
    dom.modeMessage.textContent = '';
    dom.modeMessage.classList.add('hidden');
}

/**
 * ボタンやキーボード操作から呼ばれる次の問題への遷移処理。
 */
async function goToNextQuestion() {
    if (!hasAnswered) return;
    currentIndex += 1;
    await loadNextQuestion();
}

/**
 * modeTree を深さ優先で走査し、最初の葉モード ID を取得する。
 * @param {Array<object>} nodes
 * @returns {string|null}
 */
function findFirstLeafModeId(nodes) {
    if (!Array.isArray(nodes)) {
        return null;
    }

    for (const node of nodes) {
        if (!node) {
            continue;
        }

        if (node.type === 'mode' && node.modeId) {
            return node.modeId;
        }

        if (node.type === 'modes') {
            const child = findFirstLeafModeId(node.children || node.value || []);
            if (child) {
                return child;
            }
        }
    }

    return null;
}

/**
 * 利用可能なモードの一覧を描画し、選択状態に応じてスタイルを更新する。
 */
function populateModeButtons() {
    dom.modeList.innerHTML = '';
    if (!quizDef || !quizDef.modes || quizDef.modes.length === 0) {
        return;
    }

    const modeById = new Map((quizDef.modes || []).map((mode) => [mode.id, mode]));

    const hasModeTree =
        Array.isArray(quizDef.modeTree) && quizDef.modeTree.length > 0;

    if (!currentModeId) {
        if (hasModeTree) {
            currentModeId =
                findFirstLeafModeId(quizDef.modeTree) ||
                (quizDef.modes[0] && quizDef.modes[0].id);
        } else {
            currentModeId = quizDef.modes[0].id;
        }
    }

    const modeTree = hasModeTree
        ? quizDef.modeTree
        : (quizDef.modes || []).map((mode) => ({ type: 'mode', modeId: mode.id }));

    renderModeNodes(modeTree, dom.modeList, modeById);
}

function renderModeNodes(nodes, parentElement, modeById) {
    (nodes || []).forEach((node) => {
        if (!node) {
            return;
        }

        if (node.type === 'modes') {
            const groupContainer = document.createElement('div');
            groupContainer.className = 'mb-2';

            const header = document.createElement('div');
            header.className =
                'px-2 py-1 text-[0.75rem] font-semibold app-text-muted';
            header.textContent = node.label || 'Group';
            groupContainer.appendChild(header);

            const childrenBox = document.createElement('div');
            childrenBox.className = 'pl-3 space-y-1';
            renderModeNodes(node.children || node.value || [], childrenBox, modeById);

            groupContainer.appendChild(childrenBox);
            parentElement.appendChild(groupContainer);
            return;
        }

        if (node.type !== 'mode') {
            return;
        }

        const mode = modeById.get(node.modeId);
        if (!mode) {
            return;
        }

        const isActive = mode.id === currentModeId;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors app-list-button pr-[3em] ' +
            (isActive ? 'app-list-button-active' : '');

        const title = document.createElement('div');
        title.className = 'font-semibold';
        title.textContent = mode.label || mode.id;
        btn.appendChild(title);

        if (mode.description) {
            const desc = document.createElement('div');
            desc.className = 'text-[0.8rem] app-text-muted';
            desc.textContent = mode.description;
            btn.appendChild(desc);
        }

        if (engine) {
            const capacity = engine.estimateModeCapacity(mode.id);
            const info = document.createElement('div');
            info.className = 'mt-0.5 text-[0.7rem] app-text-muted';
            info.textContent = capacity > 0
                ? `Available variations: ~${capacity}`
                : 'No questions available for this mode.';
            btn.appendChild(info);
        }

        btn.addEventListener('click', () => {
            currentModeId = mode.id;
            populateModeButtons();
            updateSelectionSummary();

            // モード変更を URL に反映
            const entryUrl = currentEntry ? currentEntry.url : null;
            const quizId = currentQuiz ? currentQuiz.id : null;
            updateLocationParams(entryUrl, quizId, currentModeId);
            setActiveMenuTab('options', { focus: true });
        });

        // Wrapper for relative positioning
        const wrapper = document.createElement('div');
        wrapper.className = 'relative';
        wrapper.appendChild(btn);

        // Share button
        const shareButton = document.createElement('button');
        shareButton.type = 'button';
        shareButton.dataset.shareModeId = mode.id;
        shareButton.className = 'absolute top-2 right-2 p-[0.3em] rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-blue-500 transition-colors z-10';
        shareButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
        shareButton.title = 'Share this mode';
        wrapper.appendChild(shareButton);

        parentElement.appendChild(wrapper);
    });
}

// --- フルスクリーン関連の補助処理 ---

/**
 * ドキュメントがフルスクリーン表示中かどうかを判定する。
 */
function isFullscreen() {
    return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    );
}

/**
 * アプリ全体をフルスクリーン表示に切り替える。
 */
function requestAppFullscreen() {
    const el = document.documentElement; // 画面全体をフルスクリーンにする
    if (el.requestFullscreen) {
        el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
        el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
        el.msRequestFullscreen();
    }
}

/**
 * フルスクリーン表示を終了させる。
 */
function exitAppFullscreen() {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
    }
}

/**
 * 現在のフルスクリーン状態に合わせてメニューのボタンラベルを更新する。
 */
function updateFullscreenButton() {
    if (!dom.menuFullscreenToggle) return;
    const active = isFullscreen();
    dom.menuFullscreenToggle.textContent = active ? 'Exit Full' : 'Full';
}

/**
 * フルスクリーン状態をトグルし、操作結果に応じてラベルを更新する。
 */
function toggleFullscreen() {
    try {
        if (isFullscreen()) {
            exitAppFullscreen();
        } else {
            requestAppFullscreen();
        }
    } catch (e) {
        console.error('[fullscreen] toggle failed:', e);
    } finally {
        // 状態が変わったあとにラベルを更新（Esc などにも対応するため、イベントも後で登録）
        setTimeout(updateFullscreenButton, 100);
    }
}


/**
 * 選択中のモードと出題数を基にクイズを初期化し、最初の問題を表示する。
 */
async function startQuiz() {
    if (!quizDef || !engine) {
        showModeMessage('クイズ定義を読み込めませんでした。');
        return;
    }

    const fallbackModeId =
        quizDef.modes && quizDef.modes.length > 0 ? quizDef.modes[0].id : null;
    const modeId = currentModeId || fallbackModeId;
    const quizIdValue = currentQuiz ? currentQuiz.id : null;
    const quizIdentifier = getActiveQuizIdentifier();

    const isPatternMode = modeId && modeId.startsWith('__pattern__');

    if (!modeId && !isPatternMode) {
        console.error('No mode available.');
        return;
    }

    const questionLimit = getConfiguredQuestionCount();
    console.log('[quiz][start] Starting quiz with mode:', {
        quizId: quizDef.meta.id,
        modeId,
        questionLimit
    });

    const modeCapacity = engine.estimateModeCapacity(modeId);
    console.log('[quiz][start] Estimated capacity for mode:', {
        modeId,
        modeCapacity
    });

    const n = getConfiguredQuestionCount();
    syncQuestionCountInputs(n);
    totalQuestions = n;

    currentIndex = 0;
    currentScore = 0;
    hasAnswered = false;
    customQuestionSequence = null;
    useCustomQuestionSequence = false;
    dom.nextButton.disabled = true;
    questionHistory = [];
    quizFinishTime = null;
    questionStartTime = null;
    recentAnswerDurations = [];

    if (!isPatternMode) {
        engine.setMode(modeId);
    }

    const sessionUser = activeUser || { userId: 'guest', displayName: 'Guest' };

    const modeDef = Array.isArray(quizDef.modes)
        ? quizDef.modes.find((m) => m && m.id === modeId)
        : null;
    currentModeBehavior = resolveModeBehavior(modeDef);
    const sessionSeed = generateSessionSeed();

    const entryUrl = currentEntry ? currentEntry.url : null;
    updateLocationParams(entryUrl, quizIdValue, modeId);

    try {
        await sessionCore.startSession({
            userId: sessionUser.userId || 'guest',
            userName: sessionUser.displayName || sessionUser.userId || 'Guest',
            quizId: quizIdentifier,
            quizTitle: quizDef.meta && quizDef.meta.title ? quizDef.meta.title : (currentQuiz ? currentQuiz.title : null),
            mode: modeId,
            config: {
                totalQuestions: n,
                questionCount: n
            },
            seed: sessionSeed,
            engine,
            quizDefinition: quizDef,
            modeBehavior: currentModeBehavior,
            questionCount: n,
            resolveQuestionId: resolveQuestionIdentifier
        });
    } catch (error) {
        console.error('[session] failed to start session', error);
    }

    renderProgress(currentIndex, totalQuestions, currentScore);
    resetReviewList();
    resetTips();
    resetResultList();
    if (dom.resultListPanel) {
        dom.resultListPanel.classList.add('hidden');
    }

    updateQuestionStageLabel(null);
    showScreen('quiz');
    startQuizTimer();
    await loadNextQuestion();
}

/**
 * 現在の進行状況に応じて次の問題を生成し、画面を更新する。
 */
async function loadNextQuestion() {
    resetIdkState();
    if (currentIndex >= totalQuestions) {
        showResult();
        return;
    }

    updateQuestionStageLabel(null);
    hasAnswered = false;
    dom.nextButton.disabled = true;

    // 前の問題の Tips をクリア
    resetTips();

    try {
        if (useCustomQuestionSequence && Array.isArray(customQuestionSequence)) {
            currentQuestion = customQuestionSequence[currentIndex];
            if (!currentQuestion) {
                updateQuestionStageLabel(null);
                showResult();
                return;
            }
        } else if (sessionCore.hasActiveRunner()) {
            currentQuestion = await sessionCore.nextQuestion({
                currentIndex,
                totalQuestions
            });
            if (!currentQuestion) {
                throw new NoQuestionsAvailableError();
            }
        } else {
            currentQuestion = engine.generateQuestion();
        }
    } catch (e) {
        if (e instanceof NoQuestionsAvailableError) {
            console.warn('[quiz] No questions available for current mode/filters');
            dom.questionText.textContent = 'No questions available. Please change the mode or filters.';
            dom.optionsContainer.innerHTML = '';
            dom.nextButton.disabled = true;
            updateQuestionStageLabel(null);
            return;
        }
        console.error('[quiz] Failed to generate question:', e);
        dom.questionText.textContent = 'Failed to generate question.';
        dom.optionsContainer.innerHTML = '';
        dom.nextButton.disabled = true;
        updateQuestionStageLabel(null);
        return;
    }
    if (!currentQuestion) {
        dom.questionText.textContent = 'No questions available.';
        dom.optionsContainer.innerHTML = '';
        dom.nextButton.disabled = true;
        updateQuestionStageLabel(null);
        return;
    }
    updateQuestionStageLabel(resolveQuestionStage(currentQuestion));
    const strategyUserId = activeUser ? activeUser.userId : 'guest';
    try {
        await applyDistractorStrategy(currentQuestion, {
            userId: strategyUserId,
            quizId: getActiveQuizIdentifier()
        });
    } catch (error) {
        console.warn('[distractor] strategy failed', error);
    }
    resetSelections(currentQuestion);
    questionStartTime = Date.now();

    renderQuestion(currentQuestion, quizDef.dataSets, handleSelectOption);
    renderProgress(currentIndex, totalQuestions, currentScore);
    if (dom.idkButton) {
        dom.idkButton.disabled = false;
    }
}

/**
 * 選択肢のクリックに応じて回答状態を更新し、採点とフィードバックを行う。
 * @param {number} answerIndex - 回答対象のパーツのインデックス。
 * @param {number} optionIndex - 選択された選択肢のインデックス。
 */
async function handleSelectOption(answerIndex, optionIndex) {
    resetIdkState();
    if (!currentQuestion || !Array.isArray(currentQuestion.answers)) return;

    // すでに採点済み（hasAnswered === true）の場合の挙動をここで制御
    if (hasAnswered) {
        const answers = currentQuestion.answers;
        const target = answers[answerIndex];
        if (!target) return;

        const lastSelectionIsCorrect = optionIndex === target.correctIndex;

        // 採点済みの状態では、正解ボタンを押したときだけ次の問題へ進める
        if (lastSelectionIsCorrect) {
            console.log('[quiz] correct option clicked after answered; goToNextQuestion');
            goToNextQuestion().catch((error) => {
                console.error('[quiz] failed to advance after correct click', error);
            });
        }
        return;
    }

    // ここからは採点前（hasAnswered === false）の通常処理
    // Check if the user is clicking the same option again
    const currentAnswer = currentQuestion.answers[answerIndex];
    if (currentAnswer && currentAnswer.userSelectedIndex === optionIndex) {
        // If it's the correct answer, proceed to the next blank
        if (optionIndex === currentAnswer.correctIndex) {
            revealNextAnswerGroup(answerIndex);
        }
        return;
    }

    const selectionState = selectAnswer(currentQuestion, answerIndex, optionIndex);

    // まずはこのパーツだけ本文の穴埋めとボタンを更新し、次のパーツを出す
    updateInlineBlank(currentQuestion, quizDef.dataSets, answerIndex);
    showOptionFeedbackForAnswer(currentQuestion, answerIndex);
    revealCorrectAnswerInPreviews(currentQuestion, quizDef.dataSets, answerIndex);

    // 未選択のパーツがある場合はスコア算出を保留する
    if (!selectionState.allSelected) {
        return;
    }

    // ここに来た時点で、全パーツに回答が入った
    hasAnswered = true;

    if (selectionState.fullyCorrect) {
        currentScore += 1;
    } else {
        addReviewItem(currentQuestion, quizDef.dataSets, currentIndex + 1);
    }

    // 全パーツのボタンに最終的なフィードバックを適用（枠・背景の緑/赤など）
    showOptionFeedback(currentQuestion);

    // 各ボタン内にパターン全文のプレビューを追記
    appendPatternPreviewToOptions(currentQuestion, quizDef.dataSets);

    // スコアなどの表示を更新
    renderProgress(currentIndex, totalQuestions, currentScore);

    const row = resolveRowForQuestion(currentQuestion);
    if (currentQuestion.patternTips && currentQuestion.patternTips.length && row) {
        renderTips(currentQuestion.patternTips, row, selectionState.fullyCorrect);
    } else {
        resetTips();
    }

    dom.nextButton.disabled = false;
    if (dom.idkButton) {
        dom.idkButton.disabled = true;
    }

    const answerMs = questionStartTime ? Date.now() - questionStartTime : null;
    questionStartTime = null;
    const resultKind = await classifyResult(
        selectionState,
        answerMs,
        currentQuestion
    );
    recordAnswerDuration(answerMs);
    const historyItem = {
        index: currentIndex + 1,
        question: currentQuestion, // question オブジェクトへの参照
        userAnswerSummary: summarizeAnswers(currentQuestion, quizDef.dataSets),
        correct: selectionState.fullyCorrect,
        resultType: resultKind === 'strong' ? 'correct' : resultKind,
        nearestOptionIndex: null,
        answerMs
    };
    questionHistory.push(historyItem);

    await persistAttemptRecord(currentQuestion, {
        resultType: resultKind === 'strong' ? 'correct' : resultKind,
        correct: selectionState.fullyCorrect,
        nearestOptionIndex: null,
        answerMs,
        questionIndex: currentIndex
    });
}

/**
 * クイズ結果を表示し、スコアの概要と画面状態を更新する。
 */
function showResult() {
    questionStartTime = null;
    // Stop timer when quiz is finished or interrupted
    stopQuizTimer();
    quizFinishTime = quizFinishTime || Date.now();
    updateQuestionStageLabel(null);

    dom.resultScore.textContent = `Score: ${currentScore} / ${totalQuestions}`;
    dom.resultTotal.textContent = `${totalQuestions}`;
    dom.resultCorrect.textContent = `${currentScore}`;
    const answeredCount = questionHistory.length;
    const accuracy = calculateAccuracy(currentScore, answeredCount);
    dom.resultAccuracy.textContent = `${accuracy}%`;
    const idkCount = questionHistory.filter(
        (item) => item && item.resultType === 'idk'
    ).length;
    const knownAttempts = answeredCount - idkCount;
    const knownAccuracy =
        knownAttempts > 0
            ? Math.round((currentScore / knownAttempts) * 100)
            : null;
    const idkRate =
        answeredCount > 0
            ? Math.round((idkCount / answeredCount) * 100)
            : 0;
    if (dom.resultKnownAccuracy) {
        dom.resultKnownAccuracy.textContent =
            knownAccuracy == null ? '--%' : `${knownAccuracy}%`;
    }
    if (dom.resultIdkRate) {
        dom.resultIdkRate.textContent = `${idkRate}%`;
    }

    // 結果画面では Tips を消す
    resetTips();

    resetResultList();
    questionHistory.forEach((item) =>
        addResultItem(item, quizDef.dataSets)
    );

    updateUserStatsDisplays(currentUserStats);
    showScreen('result');

    const summary = {
        totalQuestions,
        answeredQuestions: answeredCount,
        correctAnswers: currentScore,
        accuracyPercent: accuracy,
        knownAccuracyPercent: knownAccuracy,
        idkCount,
        idkRatePercent: idkRate,
        durationMs: quizStartTime ? quizFinishTime - quizStartTime : null,
        finishedAt: quizFinishTime
    };
    if (sessionCore.getSessionId()) {
        sessionCore.finishSession(summary).catch((error) => {
            console.error('[session] failed to finish session', error);
        });
    }

    tryUpdatePwaHintVisibility();
}

function buildResultExportObject() {
    const answeredCount = questionHistory.length;
    const finishTimestamp = quizFinishTime || Date.now();
    const elapsedSeconds = quizStartTime
        ? Math.round((finishTimestamp - quizStartTime) / 1000)
        : null;
    const dataSets = quizDef ? quizDef.dataSets : null;

    const meta = {
        quizId: currentQuiz ? currentQuiz.id : null,
        quizTitle: quizDef && quizDef.meta ? quizDef.meta.title : null,
        modeId: currentModeId,
        totalQuestions,
        answeredQuestions: answeredCount,
        correctAnswers: currentScore,
        accuracyPercent: calculateAccuracy(currentScore, answeredCount),
        startedAt: formatIsoTimestamp(quizStartTime),
        finishedAt: formatIsoTimestamp(finishTimestamp),
        elapsedSeconds
    };

    const questions = questionHistory.map((item) => {
        const question = item.question || {};
        const answers = (question.answers || []).map((ans) => {
            const hasAnswer = ans && typeof ans === 'object';
            const selectedIndex = hasAnswer && typeof ans.userSelectedIndex === 'number'
                ? ans.userSelectedIndex
                : null;
            const correctIndex = hasAnswer && typeof ans.correctIndex === 'number'
                ? ans.correctIndex
                : null;
            const optionList = hasAnswer && Array.isArray(ans.options)
                ? ans.options.map((opt, idx) => {
                    const label = optionToText(opt, dataSets, question);
                    const entityId = opt && Object.prototype.hasOwnProperty.call(opt, 'entityId')
                        ? opt.entityId
                        : null;
                    const optionDataSetId = opt && opt.dataSetId
                        ? opt.dataSetId
                        : question.meta && question.meta.dataSetId
                            ? question.meta.dataSetId
                            : null;
                    const hasCorrect = typeof correctIndex === 'number';
                    const hasSelected = typeof selectedIndex === 'number';
                    return {
                        index: idx,
                        label,
                        entityId,
                        dataSetId: optionDataSetId,
                        isCorrect: hasCorrect ? idx === correctIndex : null,
                        isSelected: hasSelected ? idx === selectedIndex : null
                    };
                })
                : [];

            const selectedLabel =
                typeof selectedIndex === 'number' && optionList[selectedIndex]
                    ? optionList[selectedIndex].label
                    : null;
            const correctLabel =
                typeof correctIndex === 'number' && optionList[correctIndex]
                    ? optionList[correctIndex].label
                    : null;

            return {
                selectedIndex,
                selectedLabel,
                correctIndex,
                correctLabel,
                isCorrect:
                    typeof selectedIndex === 'number' && typeof correctIndex === 'number'
                        ? selectedIndex === correctIndex
                        : false,
                options: optionList
            };
        });

        return {
            index: item.index,
            correct: item.correct,
            resultType: item.resultType || (item.correct ? 'correct' : 'incorrect'),
            idkNearestOptionIndex: typeof item.nearestOptionIndex === 'number' ? item.nearestOptionIndex : null,
            answerMs: typeof item.answerMs === 'number' ? item.answerMs : null,
            questionText: summarizeQuestion(question, dataSets),
            userAnswerSummary: item.userAnswerSummary,
            answers
        };
    });

    return { meta, questions };
}

async function copyResultToClipboard() {
    if (!navigator.clipboard) {
        console.warn('[result] Clipboard API is not available.');
        return;
    }
    try {
        const exportObject = buildResultExportObject();
        const text = JSON.stringify(exportObject, null, 2);
        await navigator.clipboard.writeText(text);
        console.log('[result] Copied result JSON to clipboard');
    } catch (error) {
        console.error('[result] Failed to copy result JSON:', error);
    }
}

async function retryMistakes() {
    if (!engine) {
        return;
    }
    const mistakes = questionHistory.filter((item) => item && item.correct === false);
    if (!Array.isArray(mistakes) || mistakes.length === 0) {
        return;
    }

    const sequence = mistakes.map((item) => {
        const cloned = cloneQuestionForRetry(item.question);
        if (!cloned) {
            return null;
        }
        resetSelections(cloned);
        return cloned;
    }).filter((item) => item !== null && item !== undefined);

    if (!Array.isArray(sequence) || sequence.length === 0) {
        return;
    }

    customQuestionSequence = sequence;
    useCustomQuestionSequence = true;
    totalQuestions = sequence.length;
    currentIndex = 0;
    currentScore = 0;
    hasAnswered = false;
    dom.nextButton.disabled = true;
    questionHistory = [];
    quizFinishTime = null;
    questionStartTime = null;

    renderProgress(currentIndex, totalQuestions, currentScore);
    resetReviewList();
    resetTips();
    resetResultList();
    if (dom.resultListPanel) {
        dom.resultListPanel.classList.add('hidden');
    }

    showScreen('quiz');
    startQuizTimer();
    await loadNextQuestion();
}

/**
 * 数字キーやスペースキーによる回答・遷移を有効化するキーボード操作を登録する。
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // 入力フィールドにフォーカスがあるときは邪魔しない
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea') {
            return;
        }

        if (currentScreen !== 'quiz') {
            return;
        }
        if (!currentQuestion) return;

        // 数字キー 1〜4 → 未回答パーツ（なければ先頭パーツ）に適用
        if (e.key >= '1' && e.key <= '4') {
            const answers = currentQuestion.answers || [];
            if (!answers.length) return;

            const targetIdx = answers.findIndex((ans) => ans.userSelectedIndex == null);
            const ansIndex = targetIdx >= 0 ? targetIdx : 0;
            const answer = answers[ansIndex];
            const index = Number(e.key) - 1;
            const optionsLen = (answer && answer.options && answer.options.length) || 0;
            if (index >= 0 && index < optionsLen) {
                e.preventDefault();
                handleSelectOption(ansIndex, index);
            }
            return;
        }

        // Space / Enter → 解答済みなら次の問題へ（Next と同じ）
        if (
            e.key === ' ' ||
            e.code === 'Space' ||
            e.key === 'Spacebar' ||
            e.key === 'Enter'
        ) {
            if (!hasAnswered) return;
            e.preventDefault();
            goToNextQuestion().catch((error) => {
                console.error('[quiz] failed to advance from keyboard', error);
            });
        }
    });
}

/**
 * デフォルトの entry (entry.php / ./entry.php) かどうかを判定する。
 * @param {string|null|undefined} entryUrl
 * @returns {boolean}
 */
function isDefaultEntryUrl(entryUrl) {
    if (!entryUrl) return false;

    // 完全一致チェック（保存されている値は 'entry.php' のはず）
    if (entryUrl === 'entry.php' || entryUrl === './entry.php') {
        return true;
    }

    // 念のため、絶対 URL に解決して比較しておく
    try {
        const defaultAbs = new URL('entry.php', window.location.href).href;
        const targetAbs = new URL(entryUrl, window.location.href).href;
        return defaultAbs === targetAbs;
    } catch (e) {
        return false;
    }
}

// quiz, mode, entry の順に URL パラメータを組み立てる。
// entry がデフォルト (entry.php / ./entry.php) のときは entry パラメータを省略する。
function updateLocationParams(entryUrl, quizId, modeId) {
    const params = new URLSearchParams();

    // 1. quiz
    if (quizId) {
        params.set('quiz', quizId);
    }

    // 2. mode
    if (modeId) {
        params.set('mode', modeId);
    }

    // 3. entry
    if (entryUrl && !isDefaultEntryUrl(entryUrl)) {
        // entry=./entry.php / entry.php はここで省略される
        // 値のエンコードは URLSearchParams に任せる
        params.set('entry', entryUrl);
    }

    const newQuery = params.toString();
    const newUrl =
        window.location.pathname +
        (newQuery ? `?${newQuery}` : '') +
        window.location.hash;

    window.history.replaceState(null, '', newUrl);
}

/**
 * Build a shareable absolute URL for given params.
 * entryUrl may be omitted or null to use default entry.
 */
function buildShareUrl({ entryUrl = null, quizId = null, modeId = null } = {}) {
    const params = new URLSearchParams();
    if (quizId) params.set('quiz', quizId);
    if (modeId) params.set('mode', modeId);
    if (entryUrl && !isDefaultEntryUrl(entryUrl)) params.set('entry', entryUrl);
    const newQuery = params.toString();
    return window.location.origin + window.location.pathname + (newQuery ? `?${newQuery}` : '') + window.location.hash;
}

// Share modal helpers
function openShareModal(url) {
    const modal = document.getElementById('share-modal');
    const input = document.getElementById('share-url-input');
    const img = document.getElementById('share-qr-image');
    if (!modal || !input || !img) return;
    input.value = url;
    // Generate QR code as data URL
    if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
        QRCode.toDataURL(url, { width: 300 })
            .then((dataUrl) => {
                img.src = dataUrl;
            })
            .catch((err) => {
                console.warn('QR generation failed', err);
                img.src = '';
            });
    } else {
        img.src = '';
    }
    modal.classList.remove('hidden');
}

function closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    modal.classList.add('hidden');
}


async function loadEntrySources() {
    const stored = loadEntrySourcesFromStorage();
    let sources;
    if (Array.isArray(stored) && stored.length > 0) {
        sources = stored;
    } else {
        sources = createDefaultEntrySources();
    }

    const requestedUrl = getEntryUrlFromLocation();
    if (requestedUrl && !sources.some((src) => src.url === requestedUrl)) {
        sources = [
            ...sources,
            {
                url: requestedUrl,
                label: requestedUrl,
                builtIn: false,
                temporary: true
            }
        ];
    }

    const filtered = sources.filter((entry) => entry.url !== LOCAL_DRAFT_ENTRY_URL);
    const localDraft = loadLocalDraftEntry();
    return [localDraft, ...filtered];
}

function persistEntrySources() {
    const permanent = entrySources.filter(
        (entry) => !entry.temporary && !entry.isLocal
    );
    saveEntrySourcesToStorage(permanent);
    syncQuizDataUrlsToServiceWorker();
}

async function refreshEntryAvailability(baseSources) {
    const results = await Promise.all(
        baseSources.map(async (source) => {
            if (source.isLocal) {
                return source;
            }
            const loaded = await loadEntrySourceFromUrl(source.url);
            return {
                ...source,
                ...loaded,
                label: loaded.label || source.label || source.url
            };
        })
    );
    return results;
}

function reloadLocalDraftEntry() {
    const withoutLocal = entrySources.filter((entry) => !entry.isLocal);
    const localDraft = loadLocalDraftEntry();
    entrySources = [localDraft, ...withoutLocal];
    syncQuizDataUrlsToServiceWorker();
    if (currentEntry && currentEntry.isLocal) {
        currentEntry = localDraft;
        currentQuiz = Array.isArray(localDraft.quizzes)
            ? localDraft.quizzes[0]
            : null;
    }
}

function selectEntryFromParams(sources) {
    const requested = getEntryUrlFromLocation();
    if (requested) {
        const requestedEntry = sources.find((entry) => entry.url === requested);
        if (requestedEntry) {
            return requestedEntry;
        }
    }

    const availableEntries = sources.filter((entry) => entry.available);
    if (availableEntries.length > 0) {
        return availableEntries[0];
    }

    return sources[0] || null;
}

function selectQuizFromEntry(entry, explicitQuizId) {
    if (!entry || !Array.isArray(entry.quizzes) || entry.quizzes.length === 0) {
        return null;
    }
    const requestedQuizId = explicitQuizId || getQuizNameFromLocation();
    if (requestedQuizId) {
        const requestedEntry = entry.quizzes.find((quiz) => quiz.id === requestedQuizId);
        if (requestedEntry) {
            return requestedEntry;
        }
    }
    return entry.quizzes[0];
}

/**
 * Check if the entry is a local draft.
 */
function isDraftEntry(entry) {
    return entry && entry.isLocal === true && entry.hasDraftData === true;
}

/**
 * Render read-only summary of the draft definition.
 */
function renderDraftSummary(definition, entry, engineInstance) {
    if (!dom.draftSummaryPanel || !dom.draftSummaryContent) return;

    if (!isDraftEntry(entry)) {
        dom.draftSummaryPanel.classList.add('hidden');
        return;
    }

    dom.draftSummaryPanel.classList.remove('hidden');

    // Updated At
    if (dom.draftSummaryUpdated && entry.updatedAt) {
        dom.draftSummaryUpdated.textContent = new Date(entry.updatedAt).toLocaleString();
    }

    const d = definition;
    const lines = [];

    // Meta
    lines.push(`<strong>Meta:</strong> ID=${d.meta.id}, Title=${d.meta.title}`);

    // DataSets
    if (d.dataSets) {
        const dsList = Object.values(d.dataSets).map(ds => {
            let info = `${ds.id} (${ds.type})`;
            if (ds.data) info += ` [${ds.data.length} rows]`;
            if (ds.sentences) info += ` [${ds.sentences.length} sentences]`;
            return info;
        }).join(', ');
        lines.push(`<strong>DataSets:</strong> ${dsList}`);
    }

    // Patterns
    if (d.patterns) {
        const pList = d.patterns.map(p => {
            const cap = engineInstance ? engineInstance.getPatternCapacity(p.id) : '?';
            return `${p.id} (fmt=${p.questionFormat}, cap=${cap})`;
        }).join('<br>');
        lines.push(`<strong>Patterns:</strong><div class="pl-2 text-xs text-gray-500">${pList}</div>`);
    }

    // Modes
    if (d.modes) {
        const mList = d.modes.map(m => {
            return `${m.id} (${m.label || ''})`;
        }).join(', ');
        lines.push(`<strong>Modes:</strong> ${mList}`);
    }

    dom.draftSummaryContent.innerHTML = lines.join('<br>');
}

/**
 * Render buttons to test individual patterns.
 */
function renderDraftPatternButtons(definition, engineInstance) {
    if (!dom.draftPatternList) return;

    // Header is the previous sibling of the list
    const header = dom.draftPatternList.previousElementSibling;

    if (!isDraftEntry(currentEntry)) {
        dom.draftPatternList.classList.add('hidden');
        if (header) header.classList.add('hidden');
        return;
    }

    dom.draftPatternList.classList.remove('hidden');
    if (header) header.classList.remove('hidden');

    dom.draftPatternList.innerHTML = '';

    if (!definition.patterns || definition.patterns.length === 0) {
        dom.draftPatternList.textContent = 'No patterns found.';
        return;
    }

    definition.patterns.forEach(pattern => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors app-list-button';

        const cap = engineInstance ? engineInstance.getPatternCapacity(pattern.id) : 0;
        if (cap === 0) {
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        }

        const title = document.createElement('div');
        title.className = 'font-semibold';
        title.textContent = pattern.label || pattern.id;
        btn.appendChild(title);

        const info = document.createElement('div');
        info.className = 'mt-0.5 text-[0.7rem] app-text-muted';
        info.textContent = `ID: ${pattern.id} | Cap: ${cap}`;
        btn.appendChild(info);

        btn.addEventListener('click', () => {
            handleDraftPatternSelection(pattern.id);
        });

        dom.draftPatternList.appendChild(btn);
    });
}

/**
 * Handle selection of a single pattern for testing.
 */
function handleDraftPatternSelection(patternId) {
    if (!engine) return;

    // Reset current mode ID to indicate special mode
    currentModeId = `__pattern__${patternId}`;

    // Configure engine
    engine.setSinglePatternMode(patternId);

    // Update UI to show selection
    const buttons = dom.draftPatternList.querySelectorAll('button');
    buttons.forEach(b => {
        if (b.textContent.includes(patternId)) {
            b.classList.add('app-list-button-active');
        } else {
            b.classList.remove('app-list-button-active');
        }
    });

    // Clear main mode selection
    if (dom.modeList) {
        const modeBtns = dom.modeList.querySelectorAll('button');
        modeBtns.forEach(b => b.classList.remove('app-list-button-active'));
    }

    // Update URL
    const entryUrl = currentEntry ? currentEntry.url : null;
    const quizId = currentQuiz ? currentQuiz.id : null;
    updateLocationParams(entryUrl, quizId, currentModeId);
    updateSelectionSummary();
    setActiveMenuTab('options', { focus: true });
}

async function loadCurrentQuizDefinition() {
    if (!currentQuiz) {
        quizDef = null;
        engine = null;
        setStartButtonEnabled(false);
        return;
    }
    try {
        dom.appDescription.textContent = 'Loading quiz definition...';
        clearModeMessage();
        const def = await loadQuizDefinitionFromQuizEntry(currentQuiz);
        quizDef = def.definition;
        engine = new QuizEngine(quizDef);
        currentModeBehavior = 'study';

        // URL から希望モードを取得し、このクイズで利用可能かチェック
        let requestedModeId = getModeIdFromLocation();
        const hasModes =
            quizDef.modes && Array.isArray(quizDef.modes) && quizDef.modes.length > 0;
        const hasModeTree =
            Array.isArray(quizDef.modeTree) && quizDef.modeTree.length > 0;

        if (!hasModes) {
            currentModeId = null;
        } else if (
            requestedModeId &&
            quizDef.modes.some((m) => m && m.id === requestedModeId)
        ) {
            // URL で指定されたモードがこのクイズに存在する場合
            currentModeId = requestedModeId;
        } else if (requestedModeId && requestedModeId.startsWith('__pattern__')) {
            // Draft pattern mode
            const patternId = requestedModeId.replace('__pattern__', '');
            const pattern = quizDef.patterns.find(p => p.id === patternId);
            if (pattern) {
                currentModeId = requestedModeId;
                engine.setSinglePatternMode(patternId);
            } else {
                currentModeId = quizDef.modes[0].id;
            }
        } else if (hasModeTree) {
            // 指定なし／存在しない場合は modeTree の最初の葉モードをデフォルトにする
            currentModeId =
                findFirstLeafModeId(quizDef.modeTree) ||
                (quizDef.modes[0] && quizDef.modes[0].id);
        } else {
            currentModeId = quizDef.modes[0].id;
        }

        // 決定した currentModeId でモードボタンを描画
        populateModeButtons();

        renderDraftSummary(quizDef, currentEntry, engine);
        renderDraftPatternButtons(quizDef, engine);

        // 最終的に使う entry / quiz / mode を URL に反映して正規化
        const entryUrl = currentEntry ? currentEntry.url : null;
        const quizId = currentQuiz ? currentQuiz.id : null;
        updateLocationParams(entryUrl, quizId, currentModeId);

        document.title = quizDef.meta.title || '4-choice Quiz';
        dom.appTitle.textContent = quizDef.meta.title || '4-choice Quiz';
        dom.appDescription.textContent = quizDef.meta.description || '';
        setStartButtonEnabled(true);
        updateSelectionSummary();
        showScreen('menu');
    } catch (error) {
        quizDef = null;
        engine = null;
        setStartButtonEnabled(false);
        dom.appDescription.textContent = 'Failed to load quiz definition.';
        showModeMessage('クイズ定義の読み込みに失敗しました。');
        updateSelectionSummary();
        console.error('[quiz] Failed to load quiz definition:', error);
    }
}

function renderMenus() {
    renderEntryMenu(entrySources, currentEntry);
    renderQuizMenu(currentEntry && currentEntry.available ? currentEntry.quizzes : [], currentQuiz);
}

setCapacityRenderCallback(() => {
    renderMenus();
});

async function applyEntrySelection(entry, desiredQuizId, options = {}) {
    const preserveModeFromUrl = options.preserveModeFromUrl === true;

    currentEntry = entry;
    currentQuiz = null;
    quizDef = null;
    engine = null;
    currentModeId = null;
    dom.modeList.innerHTML = '';

    // Clear Draft UI
    if (dom.draftSummaryPanel) dom.draftSummaryPanel.classList.add('hidden');
    if (dom.draftPatternList) {
        dom.draftPatternList.classList.add('hidden');
        const header = dom.draftPatternList.previousElementSibling;
        if (header) header.classList.add('hidden');
    }

    setStartButtonEnabled(false);
    renderMenus();
    updateSelectionSummary();

    if (!entry) {
        setStartButtonEnabled(false);
        showModeMessage('エントリが選択されていません。');
        dom.appDescription.textContent = 'No entry selected.';

        const modeToKeep = preserveModeFromUrl ? getModeIdFromLocation() : null;
        updateLocationParams(null, null, modeToKeep);
        return;
    }

    if (!entry.available) {
        setStartButtonEnabled(false);
        showModeMessage('この entry にはアクセスできません。');
        dom.appDescription.textContent = entry.errorMessage || 'Entry is unavailable.';

        const modeToKeep = preserveModeFromUrl ? getModeIdFromLocation() : null;
        updateLocationParams(entry.url, null, modeToKeep);
        return;
    }

    if (!Array.isArray(entry.quizzes) || entry.quizzes.length === 0) {
        setStartButtonEnabled(false);
        showModeMessage('この entry に利用可能なクイズがありません。');
        dom.appDescription.textContent = 'No quizzes available for this entry.';

        const modeToKeep = preserveModeFromUrl ? getModeIdFromLocation() : null;
        updateLocationParams(entry.url, null, modeToKeep);
        return;
    }

    const quiz = selectQuizFromEntry(entry, desiredQuizId);
    currentQuiz = quiz;
    updateSelectionSummary();

    (entry.quizzes || []).forEach((quizEntry) => {
        enqueueQuizCapacityTask(entry, quizEntry);
    });
    enqueueEntryCapacityTask(entry);

    renderMenus();

    const modeToKeep = preserveModeFromUrl ? getModeIdFromLocation() : null;
    updateLocationParams(entry.url, quiz ? quiz.id : null, modeToKeep);

    await loadCurrentQuizDefinition();
}

async function handleEntryClick(url) {
    const target = entrySources.find((entry) => entry.url === url);
    if (!target) return;
    const quizParam = getQuizNameFromLocation();
    await applyEntrySelection(target, quizParam);
}

async function handleQuizClick(quizId) {
    if (!currentEntry || !currentEntry.available) return;
    const target = currentEntry.quizzes.find((quiz) => quiz.id === quizId);
    if (!target) return;
    currentQuiz = target;
    updateSelectionSummary();
    renderMenus();
    // クイズを変更したので、モードは一旦未確定(null)にしておく
    updateLocationParams(currentEntry.url, target.id, null);
    await loadCurrentQuizDefinition();
    setActiveMenuTab('mode', { focus: true });
}

async function addEntryFromUrl(url) {
    const existingPermanent = entrySources.find(
        (entry) => entry.url === url && !entry.temporary
    );
    if (existingPermanent) {
        await applyEntrySelection(existingPermanent, getQuizNameFromLocation(), {
            preserveModeFromUrl: true
        });
        return;
    }

    const temporary = entrySources.find(
        (entry) => entry.url === url && entry.temporary
    );

    if (temporary && temporary.available && Array.isArray(temporary.quizzes)) {
        const permanent = {
            ...temporary,
            temporary: false,
            builtIn: false
        };
        entrySources = entrySources.filter((entry) => entry.url !== url);
        entrySources = [...entrySources, permanent];
        persistEntrySources();
        renderMenus();
        await applyEntrySelection(permanent, getQuizNameFromLocation(), {
            preserveModeFromUrl: true
        });
        return;
    }

    const base = { url, label: url, builtIn: false };
    const loaded = await loadEntrySourceFromUrl(url);
    const merged = {
        ...base,
        ...loaded,
        label: loaded.label || base.label,
        temporary: false
    };
    entrySources = entrySources.filter((entry) => entry.url !== url);
    entrySources = [...entrySources, merged];
    persistEntrySources();
    renderMenus();

    await applyEntrySelection(merged, getQuizNameFromLocation(), {
        preserveModeFromUrl: true
    });
}

async function addEntryFromInput() {
    if (!dom.entryUrlInput) return;
    const value = dom.entryUrlInput.value.trim();
    if (!value) return;
    dom.entryUrlInput.value = '';
    await addEntryFromUrl(value);
}

async function removeEntry(url) {
    const target = entrySources.find((entry) => entry.url === url);
    if (!target || target.builtIn) return;
    entrySources = entrySources.filter((entry) => entry.url !== url);
    persistEntrySources();
    const nextEntry = selectEntryFromParams(entrySources);
    await applyEntrySelection(nextEntry, getQuizNameFromLocation());
}

async function handleLocalDraftUpdate() {
    try {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            throw new Error('クリップボードへアクセスできません。');
        }
        const text = await navigator.clipboard.readText();
        updateLocalDraftFromText(text);
        reloadLocalDraftEntry();
        renderMenus();
        persistEntrySources();
        const localEntry = entrySources.find((entry) => entry.isLocal) || null;
        await applyEntrySelection(localEntry, getQuizNameFromLocation(), {
            preserveModeFromUrl: true
        });
    } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
    }
}

async function handleLocalDraftDelete() {
    if (!confirm('ローカル下書きを削除しますか？')) {
        return;
    }
    clearLocalDraft();
    reloadLocalDraftEntry();
    renderMenus();
    persistEntrySources();

    if (currentEntry && currentEntry.isLocal) {
        const nextEntry = entrySources.find((entry) => !entry.isLocal && entry.available)
            || entrySources.find((entry) => !entry.isLocal)
            || entrySources[0]
            || null;
        await applyEntrySelection(nextEntry, getQuizNameFromLocation());
    }
}

function attachMenuHandlers() {
    const tabButtons = [
        ['quizzes', dom.menuTabQuizzesButton],
        ['mode', dom.menuTabModeButton],
        ['options', dom.menuTabOptionsButton]
    ];
    tabButtons.forEach(([name, button]) => {
        if (button) {
            button.addEventListener('click', () => {
                setActiveMenuTab(name);
            });
        }
    });
    setActiveMenuTab(activeMenuTab || 'quizzes');

    if (dom.menuThemeToggle) {
        dom.menuThemeToggle.addEventListener('click', () => {
            toggleTheme();
        });
    }

    if (dom.questionCountSlider) {
        dom.questionCountSlider.addEventListener('input', (event) => {
            syncQuestionCountInputs(event.target.value);
        });
    }

    if (dom.questionCountInput) {
        dom.questionCountInput.addEventListener('input', (event) => {
            syncQuestionCountInputs(event.target.value);
        });
    }

    if (dom.menuFullscreenToggle) {
        dom.menuFullscreenToggle.addEventListener('click', () => {
            toggleFullscreen();
        });

        document.addEventListener('fullscreenchange', updateFullscreenButton);
        document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
        document.addEventListener('mozfullscreenchange', updateFullscreenButton);
        document.addEventListener('MSFullscreenChange', updateFullscreenButton);

        updateFullscreenButton();
    }

    if (dom.menuSizeXXSmall) {
        dom.menuSizeXXSmall.addEventListener('click', () => setSize('xxs'));
    }
    if (dom.menuSizeXSmall) {
        dom.menuSizeXSmall.addEventListener('click', () => setSize('xs'));
    }
    if (dom.menuSizeSmall) {
        dom.menuSizeSmall.addEventListener('click', () => setSize('s'));
    }
    if (dom.menuSizeMedium) {
        dom.menuSizeMedium.addEventListener('click', () => setSize('m'));
    }
    if (dom.menuSizeLarge) {
        dom.menuSizeLarge.addEventListener('click', () => setSize('l'));
    }
    if (dom.menuSizeXLarge) {
        dom.menuSizeXLarge.addEventListener('click', () => setSize('xl'));
    }
    if (dom.menuSizeXXLarge) {
        dom.menuSizeXXLarge.addEventListener('click', () => setSize('xxl'));
    }

    const appReloadButton = document.getElementById('app-reload-button');
    if (appReloadButton) {
        appReloadButton.addEventListener('click', () => {
            reloadApp();
        });
    }

    if (dom.cacheClearButton) {
        dom.cacheClearButton.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to clear the cache and reload?')) {
                return;
            }
            if (dom.cacheClearStatus) {
                dom.cacheClearStatus.textContent = 'Clearing...';
            }
            dom.cacheClearButton.disabled = true;
            await clearAppCachesAndReload('manual-trigger');
        });
    }

    dom.startButton.addEventListener('click', () => {
        startQuiz().catch((error) => {
            console.error('[quiz] failed to start quiz', error);
        });
    });

    dom.nextButton.addEventListener('click', () => {
        goToNextQuestion().catch((error) => {
            console.error('[quiz] failed to load next question', error);
        });
    });

    if (dom.interruptButton) {
        dom.interruptButton.addEventListener('click', () => {
            console.log('[quiz] Interrupt button clicked');
            if (currentScreen === 'quiz') {
                showResult();
            }
        });
    }

    if (dom.retryButton) {
        dom.retryButton.addEventListener('click', () => {
            console.log('[result] Retry button clicked');
            startQuiz().catch((error) => {
                console.error('[result] failed to restart quiz', error);
            });
        });
    }

    if (dom.retryMistakesButton) {
        dom.retryMistakesButton.addEventListener('click', () => {
            console.log('[result] Retry mistakes button clicked');
            retryMistakes().catch((error) => {
                console.error('[result] failed to retry mistakes', error);
            });
        });
    }

    if (dom.copyResultButton) {
        dom.copyResultButton.addEventListener('click', () => {
            console.log('[result] Copy result button clicked');
            copyResultToClipboard();
        });
    }

    if (dom.backToMenuButton) {
        dom.backToMenuButton.addEventListener('click', () => {
            console.log('[result] Back-to-menu button clicked');
            resetReviewList();
            resetTips();
            resetQuizTimer();
            showScreen('menu');
        });
    }

    if (dom.idkButton) {
        dom.idkButton.addEventListener('click', () => {
            startIdkFlow();
        });
    }

    if (dom.idkFollowupOptions) {
        dom.idkFollowupOptions.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const btn = target.closest('[data-idk-option-index]');
            if (!btn) return;
            const index = Number(btn.getAttribute('data-idk-option-index'));
            if (!Number.isNaN(index)) {
                completeIdk(index);
            }
        });
    }

    if (dom.idkFollowupSkip) {
        dom.idkFollowupSkip.addEventListener('click', () => {
            completeIdk(null);
        });
    }

    if (dom.resultPwaInstallButton) {
        dom.resultPwaInstallButton.addEventListener('click', async () => {
            console.log('[pwa] install button clicked');

            if (!deferredInstallPrompt) {
                console.log('[pwa] no deferred install prompt available');
                tryUpdatePwaHintVisibility();
                return;
            }

            dom.resultPwaInstallButton.disabled = true;

            try {
                await deferredInstallPrompt.prompt();
                const choice = await deferredInstallPrompt.userChoice;
                console.log('[pwa] userChoice:', choice);
            } catch (error) {
                console.error('[pwa] install prompt failed:', error);
            } finally {
                deferredInstallPrompt = null;
                tryUpdatePwaHintVisibility();
            }
        });
    }

    if (dom.entryList) {
        dom.entryList.addEventListener('click', async (event) => {
            let target = event.target;
            // Handle text nodes (e.g. clicking on label text)
            while (target && !(target instanceof Element)) {
                target = target.parentNode;
            }
            if (!target) return;

            const localDraftButton = target.closest('[data-local-draft-action]');
            if (localDraftButton) {
                event.stopPropagation();
                const action = localDraftButton.dataset.localDraftAction;
                if (action === 'update') {
                    await handleLocalDraftUpdate();
                } else if (action === 'delete') {
                    await handleLocalDraftDelete();
                }
                return;
            }
            // Share entry
            const shareEntryButton = target.closest('[data-share-entry-url]');
            if (shareEntryButton) {
                event.stopPropagation();
                const shareEntryUrl = shareEntryButton.dataset.shareEntryUrl;
                // Build URL: entry only
                const url = buildShareUrl({ entryUrl: shareEntryUrl });
                openShareModal(url);
                return;
            }
            const addButton = target.closest('[data-add-url]');
            if (addButton) {
                event.stopPropagation();
                const addUrl = addButton.dataset.addUrl;
                if (addUrl) {
                    await addEntryFromUrl(addUrl);
                }
                return;
            }
            const removeButton = target.closest('[data-remove-url]');
            if (removeButton) {
                event.stopPropagation();
                const removeUrl = removeButton.dataset.removeUrl;
                if (removeUrl) {
                    await removeEntry(removeUrl);
                }
                return;
            }
            const entryButton = target.closest('[data-entry-url]');
            if (entryButton) {
                const entryUrl = entryButton.dataset.entryUrl;
                if (entryUrl) {
                    await handleEntryClick(entryUrl);
                }
                return;
            }
            const reloadButton = target.closest('[data-reload-entry-url]');
            if (reloadButton) {
                event.stopPropagation();
                const reloadUrl = reloadButton.dataset.reloadEntryUrl;
                if (reloadUrl) {
                    await reloadEntry(reloadUrl);
                }
                return;
            }
        });
    }

    if (dom.quizList) {
        dom.quizList.addEventListener('click', async (event) => {
            let target = event.target;
            while (target && !(target instanceof Element)) {
                target = target.parentNode;
            }
            if (!target) return;

            // Share quiz button
            const shareQuizButton = target.closest('[data-share-quiz-id]');
            if (shareQuizButton) {
                event.stopPropagation();
                const quizId = shareQuizButton.dataset.shareQuizId;
                const entryUrl = currentEntry ? currentEntry.url : null;
                const url = buildShareUrl({ entryUrl, quizId });
                openShareModal(url);
                return;
            }

            const quizId = target.dataset.quizId;
            if (quizId) {
                await handleQuizClick(quizId);
            } else if (target.closest('[data-quiz-id]')) {
                const button = target.closest('[data-quiz-id]');
                if (button && button.dataset.quizId) {
                    await handleQuizClick(button.dataset.quizId);
                }
            }
        });
    }

    if (dom.modeList) {
        dom.modeList.addEventListener('click', (event) => {
            let target = event.target;
            while (target && !(target instanceof Element)) {
                target = target.parentNode;
            }
            if (!target) return;

            // Share mode button
            const shareModeButton = target.closest('[data-share-mode-id]');
            if (shareModeButton) {
                event.stopPropagation();
                const modeId = shareModeButton.dataset.shareModeId;
                const entryUrl = currentEntry ? currentEntry.url : null;
                const quizId = currentQuiz ? currentQuiz.id : null;
                const url = buildShareUrl({ entryUrl, quizId, modeId });
                openShareModal(url);
                return;
            }
        });
    }

    if (dom.entryAddButton) {
        dom.entryAddButton.addEventListener('click', () => {
            addEntryFromInput();
        });
    }
}

/**
 * Remove outdated service worker registrations that used the legacy sw.js entry point.
 */
async function unregisterLegacyServiceWorkers() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistrations) {
        return;
    }

    try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
            if (registration.active && registration.active.scriptURL.endsWith('/quiz/sw.js')) {
                await registration.unregister();
            }
        }
    } catch (error) {
        console.warn('[pwa] Failed to unregister legacy service workers:', error);
    }
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    window.addEventListener('load', () => {
        const swUrl = typeof window.APP_SERVICE_WORKER_URL === 'string'
            ? window.APP_SERVICE_WORKER_URL
            : '/quiz/sw.php';

        navigator.serviceWorker
            .register(swUrl)
            .then(() => unregisterLegacyServiceWorkers())
            .catch((error) => {
                console.error('[pwa] Service worker registration failed:', error);
            });
    });
}

/**
 * アプリ初期化完了を示すクラスを body に付与する。
 */
function markAppReady() {
    const body = document.body;
    if (!body) {
        return;
    }

    body.classList.remove('app-loading');
    body.classList.add('app-ready');
}

/**
 * Check for application updates.
 */
async function checkForUpdate() {
    if (currentScreen !== 'menu') return;

    try {
        // Bypass cache to get the latest manifest
        const response = await fetch('manifest.php', { cache: 'no-store' });
        if (!response.ok) return;
        const json = await response.json();
        const serverVersion = json.app_version;
        const currentVersion = window.APP_VERSION;

        if (serverVersion && currentVersion && serverVersion !== currentVersion) {
            console.info('[update] new version available:', { serverVersion, currentVersion });
            if (dom.updateNotificationBanner) {
                dom.updateNotificationBanner.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.warn('[update] check failed', e);
    }
}

// Set up update notification handlers
(function setupUpdateNotificationHandlers() {
    if (!dom.updateNotificationBanner) return;

    if (dom.updateNotificationClose) {
        dom.updateNotificationClose.addEventListener('click', () => {
            dom.updateNotificationBanner.classList.add('hidden');
        });
    }

    if (dom.updateNotificationReload) {
        dom.updateNotificationReload.addEventListener('click', () => {
            window.location.reload();
        });
    }

    if (dom.updateNotificationLater) {
        dom.updateNotificationLater.addEventListener('click', () => {
            dom.updateNotificationBanner.classList.add('hidden');
        });
    }
})();

// Check when tab becomes visible
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkForUpdate();
    }
});

/**
 * アプリ起動時の初期化処理。データ読込、UI 初期化、イベント登録をまとめる。
 */
async function bootstrap() {
    const isVersionOk = assertVersionCompatibility();
    if (!isVersionOk) {
        // Show app frame so that error text is visible
        markAppReady();
        return;
    }

    initThemeFromStorage();
    initAppHeightObserver();
    syncQuestionCountInputs(dom.questionCountInput ? dom.questionCountInput.value : 10);
    registerServiceWorker();
    await initUserManager({
        onActiveUserChange: handleActiveUserChange
    });
    updateActiveUserDisplays();

    try {
        entrySources = await loadEntrySources();
        entrySources = await refreshEntryAvailability(entrySources);
        persistEntrySources();
        syncQuizDataUrlsToServiceWorker();

        const initialEntry = selectEntryFromParams(entrySources);
        renderMenus();
        attachMenuHandlers();
        setupKeyboardShortcuts();
        showScreen('menu');

        await applyEntrySelection(initialEntry, getQuizNameFromLocation(), {
            preserveModeFromUrl: true
        });

        // Initial update check
        checkForUpdate();
    } catch (e) {
        console.error('[bootstrap] failed to initialize app:', e);
        dom.appDescription.textContent =
            'Failed to load quiz definition.';
    } finally {
        markAppReady();
        tryUpdatePwaHintVisibility();
    }
}

bootstrap();
