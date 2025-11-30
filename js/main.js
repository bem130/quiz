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
    summarizeQuestion,
    summarizeAnswers,
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

let entrySources = [];
let currentEntry = null;
let currentQuiz = null;
let quizDef = null;
let engine = null;

let totalQuestions = 10;
let currentIndex = 0;
let currentScore = 0;
let currentQuestion = null;
let hasAnswered = false;
let questionHistory = [];
let customQuestionSequence = null;
let useCustomQuestionSequence = false;

// 現在選択中の modeId
let currentModeId = null;

// Current screen ("menu" | "quiz" | "result")
let currentScreen = 'menu';

// Timer state
let quizStartTime = null;
let quizTimerId = null;
let quizFinishTime = null;

/** @type {BeforeInstallPromptEvent | null} */
let deferredInstallPrompt = null;
let hasPwaInstallPromptSupport = false;

/**
 * Compare expected app version with module versions to surface cache mismatches early.
 */
function assertVersionCompatibility() {
    const expectedVersion = window.APP_VERSION;

    if (!expectedVersion) {
        return;
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

    if (mismatches.length > 0) {
        console.error('[version-mismatch]', {
            expected: expectedVersion,
            mismatches
        });
    }
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
    currentScreen = name;

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

    if (name === 'menu') {
        dom.mainMenu.classList.remove('hidden');
        dom.sideMenu.classList.remove('hidden');
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
    }
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
function goToNextQuestion() {
    if (!hasAnswered) return;
    currentIndex += 1;
    loadNextQuestion();
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

    if (!currentModeId) {
        currentModeId = quizDef.modes[0].id;
    }

    const modeTree =
        (Array.isArray(quizDef.modeTree) && quizDef.modeTree.length > 0)
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
            'w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors ' +
            (isActive
                ? 'border-emerald-400 dark:border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-100'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 app-text-strong hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800');

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

            // モード変更を URL に反映
            const entryUrl = currentEntry ? currentEntry.url : null;
            const quizId = currentQuiz ? currentQuiz.id : null;
            updateLocationParams(entryUrl, quizId, currentModeId);
        });

        parentElement.appendChild(btn);
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
function startQuiz() {
    if (!quizDef || !engine) {
        showModeMessage('クイズ定義を読み込めませんでした。');
        return;
    }

    const fallbackModeId =
        quizDef.modes && quizDef.modes.length > 0 ? quizDef.modes[0].id : null;
    const modeId = currentModeId || fallbackModeId;

    if (!modeId) {
        console.error('No mode available.');
        return;
    }

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

    engine.setMode(modeId);

    // 使用するモードを URL に保存
    const entryUrl = currentEntry ? currentEntry.url : null;
    const quizId = currentQuiz ? currentQuiz.id : null;
    updateLocationParams(entryUrl, quizId, modeId);

    renderProgress(currentIndex, totalQuestions, currentScore);
    resetReviewList();
    resetTips();
    resetResultList();
    if (dom.resultListPanel) {
        dom.resultListPanel.classList.add('hidden');
    }

    showScreen('quiz');
    startQuizTimer();
    loadNextQuestion();
}

/**
 * 現在の進行状況に応じて次の問題を生成し、画面を更新する。
 */
function loadNextQuestion() {
    if (currentIndex >= totalQuestions) {
        showResult();
        return;
    }

    hasAnswered = false;
    dom.nextButton.disabled = true;

    // 前の問題の Tips をクリア
    resetTips();

    try {
        if (useCustomQuestionSequence && Array.isArray(customQuestionSequence)) {
            currentQuestion = customQuestionSequence[currentIndex];
            if (!currentQuestion) {
                showResult();
                return;
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
            return;
        }
        console.error('[quiz] Failed to generate question:', e);
        dom.questionText.textContent = 'Failed to generate question.';
        dom.optionsContainer.innerHTML = '';
        dom.nextButton.disabled = true;
        return;
    }
    resetSelections(currentQuestion);

    renderQuestion(currentQuestion, quizDef.dataSets, handleSelectOption);
    renderProgress(currentIndex, totalQuestions, currentScore);
}

/**
 * 選択肢のクリックに応じて回答状態を更新し、採点とフィードバックを行う。
 * @param {number} answerIndex - 回答対象のパーツのインデックス。
 * @param {number} optionIndex - 選択された選択肢のインデックス。
 */
function handleSelectOption(answerIndex, optionIndex) {
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
            goToNextQuestion();
        }
        return;
    }

    // ここからは採点前（hasAnswered === false）の通常処理
    const selectionState = selectAnswer(currentQuestion, answerIndex, optionIndex);

    // まずはこのパーツだけ本文の穴埋めとボタンを更新し、次のパーツを出す
    updateInlineBlank(currentQuestion, quizDef.dataSets, answerIndex);
    showOptionFeedbackForAnswer(currentQuestion, answerIndex);
    revealNextAnswerGroup(answerIndex);

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

    const historyItem = {
        index: currentIndex + 1,
        question: currentQuestion, // question オブジェクトへの参照
        userAnswerSummary: summarizeAnswers(currentQuestion, quizDef.dataSets),
        correct: selectionState.fullyCorrect
    };
    questionHistory.push(historyItem);

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
}

/**
 * クイズ結果を表示し、スコアの概要と画面状態を更新する。
 */
function showResult() {
    // Stop timer when quiz is finished or interrupted
    stopQuizTimer();
    quizFinishTime = quizFinishTime || Date.now();

    dom.resultScore.textContent = `Score: ${currentScore} / ${totalQuestions}`;
    dom.resultTotal.textContent = `${totalQuestions}`;
    dom.resultCorrect.textContent = `${currentScore}`;
    const answeredCount = questionHistory.length;
    const accuracy = calculateAccuracy(currentScore, answeredCount);
    dom.resultAccuracy.textContent = `${accuracy}%`;

    // 結果画面では Tips を消す
    resetTips();

    resetResultList();
    questionHistory.forEach((item) =>
        addResultItem(item, quizDef.dataSets)
    );

    showScreen('result');

    tryUpdatePwaHintVisibility();
}

function buildResultExportObject() {
    const answeredCount = questionHistory.length;
    const finishTimestamp = quizFinishTime || Date.now();
    const elapsedSeconds = quizStartTime
        ? Math.round((finishTimestamp - quizStartTime) / 1000)
        : null;

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
            const selectedIndex = ans ? ans.userSelectedIndex : null;
            const correctIndex = ans ? ans.correctIndex : null;
            const selectedLabel =
                ans && Array.isArray(ans.options) && ans.options[selectedIndex]
                    ? ans.options[selectedIndex].label
                    : null;
            const correctLabel =
                ans && Array.isArray(ans.options) && ans.options[correctIndex]
                    ? ans.options[correctIndex].label
                    : null;

            return {
                selectedIndex,
                selectedLabel,
                correctIndex,
                correctLabel,
                isCorrect: ans ? selectedIndex === correctIndex : false
            };
        });

        return {
            index: item.index,
            correct: item.correct,
            questionText: summarizeQuestion(question, quizDef ? quizDef.dataSets : null),
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

function retryMistakes() {
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

    renderProgress(currentIndex, totalQuestions, currentScore);
    resetReviewList();
    resetTips();
    resetResultList();
    if (dom.resultListPanel) {
        dom.resultListPanel.classList.add('hidden');
    }

    showScreen('quiz');
    startQuizTimer();
    loadNextQuestion();
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
            goToNextQuestion();
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

    return sources;
}

function persistEntrySources() {
    const permanent = entrySources.filter((entry) => !entry.temporary);
    saveEntrySourcesToStorage(permanent);
}

async function refreshEntryAvailability(baseSources) {
    const results = await Promise.all(
        baseSources.map(async (source) => {
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

        // URL から希望モードを取得し、このクイズで利用可能かチェック
        let requestedModeId = getModeIdFromLocation();
        if (
            !quizDef.modes ||
            !Array.isArray(quizDef.modes) ||
            quizDef.modes.length === 0
        ) {
            currentModeId = null;
        } else if (
            requestedModeId &&
            quizDef.modes.some((m) => m && m.id === requestedModeId)
        ) {
            // URL で指定されたモードがこのクイズに存在する場合
            currentModeId = requestedModeId;
        } else {
            // 指定なし／存在しない場合は先頭モードをデフォルトにする
            currentModeId = quizDef.modes[0].id;
        }

        // 決定した currentModeId でモードボタンを描画
        populateModeButtons();

        // 最終的に使う entry / quiz / mode を URL に反映して正規化
        const entryUrl = currentEntry ? currentEntry.url : null;
        const quizId = currentQuiz ? currentQuiz.id : null;
        updateLocationParams(entryUrl, quizId, currentModeId);

        document.title = quizDef.meta.title || '4-choice Quiz';
        dom.appTitle.textContent = quizDef.meta.title || '4-choice Quiz';
        dom.appDescription.textContent = quizDef.meta.description || '';
        setStartButtonEnabled(true);
        showScreen('menu');
    } catch (error) {
        quizDef = null;
        engine = null;
        setStartButtonEnabled(false);
        dom.appDescription.textContent = 'Failed to load quiz definition.';
        showModeMessage('クイズ定義の読み込みに失敗しました。');
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
    setStartButtonEnabled(false);
    renderMenus();

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
    renderMenus();
    // クイズを変更したので、モードは一旦未確定(null)にしておく
    updateLocationParams(currentEntry.url, target.id, null);
    await loadCurrentQuizDefinition();
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

function attachMenuHandlers() {
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

    dom.startButton.addEventListener('click', startQuiz);

    dom.nextButton.addEventListener('click', () => {
        goToNextQuestion();
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
            startQuiz();
        });
    }

    if (dom.retryMistakesButton) {
        dom.retryMistakesButton.addEventListener('click', () => {
            console.log('[result] Retry mistakes button clicked');
            retryMistakes();
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
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const addButton = target.closest('[data-add-url]');
            if (addButton && addButton instanceof HTMLElement) {
                const addUrl = addButton.dataset.addUrl;
                if (addUrl) {
                    await addEntryFromUrl(addUrl);
                }
                return;
            }
            const removeButton = target.closest('[data-remove-url]');
            if (removeButton && removeButton instanceof HTMLElement) {
                const removeUrl = removeButton.dataset.removeUrl;
                if (removeUrl) {
                    await removeEntry(removeUrl);
                }
                return;
            }
            const entryButton = target.closest('[data-entry-url]');
            if (entryButton && entryButton instanceof HTMLElement) {
                const entryUrl = entryButton.dataset.entryUrl;
                if (entryUrl) {
                    await handleEntryClick(entryUrl);
                }
            }
        });
    }

    if (dom.quizList) {
        dom.quizList.addEventListener('click', async (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
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
 * アプリ起動時の初期化処理。データ読込、UI 初期化、イベント登録をまとめる。
 */
async function bootstrap() {
    assertVersionCompatibility();
    initThemeFromStorage();
    initAppHeightObserver();
    syncQuestionCountInputs(dom.questionCountInput ? dom.questionCountInput.value : 10);
    registerServiceWorker();

    try {
        entrySources = await loadEntrySources();
        entrySources = await refreshEntryAvailability(entrySources);
        persistEntrySources();

        const initialEntry = selectEntryFromParams(entrySources);
        renderMenus();
        attachMenuHandlers();
        setupKeyboardShortcuts();
        showScreen('menu');

        await applyEntrySelection(initialEntry, getQuizNameFromLocation(), {
            preserveModeFromUrl: true
        });
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
