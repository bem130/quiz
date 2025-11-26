// js/main.js
import { initThemeFromStorage, toggleTheme, setSize, initAppHeightObserver } from './theme.js';
import { dom } from './dom-refs.js';
import { loadQuizDefinition } from './quiz-model.js';
import { loadQuizEntries } from './entry-model.js';
import { renderQuizMenu } from './menu-renderer.js';
import { QuizEngine } from './quiz-engine.js';
import {
    renderQuestionText,
    renderOptions,
    renderProgress,
    showOptionFeedback,
    resetReviewList,
    addReviewItem,
    renderTips,
    resetTips
} from './quiz-renderer.js';

let quizDef = null;
let quizEntries = [];
let engine = null;

let totalQuestions = 10;
let currentIndex = 0;
let currentScore = 0;
let currentQuestion = null;
let hasAnswered = false;

// 現在選択中の modeId
let currentModeId = null;

// 現在の画面状態 ("menu" | "quiz" | "result")
let currentScreen = 'menu';

// 画面切り替え: "menu" / "quiz" / "result"
function showScreen(name) {
    currentScreen = name;

    // メイン
    dom.mainMenu.classList.add('hidden');
    dom.mainQuiz.classList.add('hidden');

    // サイド（下半分だけ切り替える）
    dom.sideMenu.classList.add('hidden');
    dom.sideQuiz.classList.add('hidden');

    // ヘッダスコア
    dom.quizHeaderScore.classList.add('hidden');

    // 結果パネル
    dom.resultScreen.classList.add('hidden');

    if (name === 'menu') {
        dom.mainMenu.classList.remove('hidden');
        dom.sideMenu.classList.remove('hidden');
    } else if (name === 'quiz') {
        dom.mainQuiz.classList.remove('hidden');
        dom.sideQuiz.classList.remove('hidden');
        dom.quizHeaderScore.classList.remove('hidden');
    } else if (name === 'result') {
        dom.mainQuiz.classList.remove('hidden');
        dom.sideQuiz.classList.remove('hidden');
        dom.quizHeaderScore.classList.remove('hidden');
        dom.resultScreen.classList.remove('hidden');
    }
}

// Next ボタンと Space / Enter / 正答再クリックから共通で使う「次の問題へ」処理
function goToNextQuestion() {
    if (!hasAnswered) return;
    currentIndex += 1;
    loadNextQuestion();
}

// Mode ボタン生成
function populateModeButtons() {
    dom.modeList.innerHTML = '';
    if (!quizDef.modes || quizDef.modes.length === 0) {
        return;
    }

    if (!currentModeId) {
        currentModeId = quizDef.modes[0].id;
    }

    quizDef.modes.forEach((mode) => {
        const isActive = mode.id === currentModeId;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors ' +
            (isActive
                ? 'border-emerald-400 dark:border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-100'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800');

        const title = document.createElement('div');
        title.className = 'font-semibold';
        title.textContent = mode.label || mode.id;
        btn.appendChild(title);

        if (mode.description) {
            const desc = document.createElement('div');
            desc.className = 'text-[0.8rem] text-slate-500 dark:text-slate-400';
            desc.textContent = mode.description;
            btn.appendChild(desc);
        }

        btn.addEventListener('click', () => {
            currentModeId = mode.id;
            populateModeButtons();
        });

        dom.modeList.appendChild(btn);
    });
}

function startQuiz() {
    const fallbackModeId =
        quizDef.modes && quizDef.modes.length > 0 ? quizDef.modes[0].id : null;
    const modeId = currentModeId || fallbackModeId;

    if (!modeId) {
        console.error('No mode available.');
        return;
    }

    const n = parseInt(dom.questionCountInput.value, 10);
    totalQuestions = Number.isFinite(n) && n > 0 ? n : 10;

    currentIndex = 0;
    currentScore = 0;
    hasAnswered = false;
    dom.nextButton.disabled = true;

    engine.setMode(modeId);
    renderProgress(currentIndex, totalQuestions, currentScore);
    resetReviewList();
    resetTips();

    showScreen('quiz');
    loadNextQuestion();
}

function loadNextQuestion() {
    if (currentIndex >= totalQuestions) {
        showResult();
        return;
    }

    hasAnswered = false;
    dom.nextButton.disabled = true;

    // 前の問題の Tips をクリア
    resetTips();

    currentQuestion = engine.generateQuestion();

    // 複数回答用に、ユーザーの穴埋め回答配列を常に初期化しておく
    currentQuestion.userFillAnswers = [];

    const entity = quizDef.entitySet.entities[currentQuestion.entityId];

    renderQuestionText(currentQuestion.patternTokens, entity, true);
    renderOptions(currentQuestion, quizDef.entitySet, handleSelectOption);
    renderProgress(currentIndex, totalQuestions, currentScore);
}

function handleSelectOption(selectedIndex) {
    if (!currentQuestion) return;

    const correctIndex = currentQuestion.answer.correctIndex;

    // 既に答えたあとに「正答のボタン」を再度押したら、そのまま次の問題へ
    if (hasAnswered) {
        if (selectedIndex === correctIndex) {
            goToNextQuestion();
        }
        return;
    }

    // まだ答えていないときの通常処理
    hasAnswered = true;

    // --- 複数回答: fill_in_blank の採点 ---
    let fillCorrect = true;

    // 常に配列として扱えるように保証
    if (!Array.isArray(currentQuestion.userFillAnswers)) {
        currentQuestion.userFillAnswers = [];
    } else {
        currentQuestion.userFillAnswers.length = 0;
    }

    if (currentQuestion.fillBlanks && currentQuestion.fillBlanks.length > 0) {
        const inputs = dom.questionText.querySelectorAll('input[data-fill-blank="1"]');

        // 複数の穴埋めに対して、1つでも違えば fillCorrect = false
        currentQuestion.fillBlanks.forEach((fb, idx) => {
            const input = inputs[idx];
            const userRaw = input ? input.value : '';
            const user = (userRaw || '').trim();
            currentQuestion.userFillAnswers.push(user);

            const correctText = (fb.correctText || '').trim();
            if (user !== correctText) {
                fillCorrect = false;
            }
        });
    }

    const isChoiceCorrect = selectedIndex === correctIndex;
    // 「複数回答」の全体正解: choice も fill も全部正しい
    const isFullyCorrect = isChoiceCorrect && fillCorrect;

    if (isFullyCorrect) {
        currentScore += 1;
    } else {
        // 誤答の index も Mistakes に渡す
        addReviewItem(
            currentQuestion,
            quizDef.entitySet,
            currentIndex + 1,
            selectedIndex
        );
    }

    showOptionFeedback(currentQuestion, selectedIndex);
    renderProgress(currentIndex, totalQuestions, currentScore);

    // Tips 表示（正誤に応じて）
    const entity = quizDef.entitySet.entities[currentQuestion.entityId];
    if (currentQuestion.patternTips && currentQuestion.patternTips.length && entity) {
        renderTips(currentQuestion.patternTips, entity, isFullyCorrect);
    } else {
        resetTips();
    }

    dom.nextButton.disabled = false;
}

function showResult() {
    dom.resultScore.textContent = `${currentScore} / ${totalQuestions}`;

    // 結果画面では Tips を消す
    resetTips();

    showScreen('result');
}

// キーボード操作のセットアップ
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

        // 数字キー 1〜4 → 選択肢 0〜3
        if (e.key >= '1' && e.key <= '4') {
            const index = Number(e.key) - 1;
            const optionsLen = currentQuestion.answer.options.length;
            if (index >= 0 && index < optionsLen) {
                e.preventDefault();
                handleSelectOption(index);
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

async function bootstrap() {
    initThemeFromStorage();
    initAppHeightObserver();

    try {
        const [def, entries] = await Promise.all([
            loadQuizDefinition(),
            loadQuizEntries()
        ]);
        quizDef = def;
        quizEntries = entries;

        document.title = quizDef.meta.title || '4-choice Quiz';
        dom.appTitle.textContent = quizDef.meta.title || '4-choice Quiz';
        dom.appDescription.textContent = quizDef.meta.description || '';

        renderQuizMenu(quizEntries);

        engine = new QuizEngine(quizDef);
        populateModeButtons();

        // 共通 Settings エリアのボタン
        if (dom.menuThemeToggle) {
            dom.menuThemeToggle.addEventListener('click', () => {
                toggleTheme();
            });
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

        // クイズ開始 / 進行系
        dom.startButton.addEventListener('click', startQuiz);

        dom.nextButton.addEventListener('click', () => {
            goToNextQuestion();
        });

        dom.retryButton.addEventListener('click', () => {
            currentIndex = 0;
            currentScore = 0;
            hasAnswered = false;
            dom.nextButton.disabled = true;
            resetTips();
            showScreen('quiz');
            loadNextQuestion();
        });

        dom.backToMenuButton.addEventListener('click', () => {
            showScreen('menu');
        });

        setupKeyboardShortcuts();
        showScreen('menu');
    } catch (e) {
        console.error(e);
        dom.appDescription.textContent = 'Failed to load quiz definition.';
    }
}

bootstrap();
