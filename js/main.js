// js/main.js
import { initThemeFromStorage, toggleTheme } from './theme.js';
import { dom } from './dom-refs.js';
import { loadQuizDefinition } from './quiz-model.js';
import { loadQuizEntries } from './entry-model.js';
import { renderQuizMenu } from './menu-renderer.js';
import { QuizEngine } from './quiz-engine.js';
import { renderQuestionText, renderOptions, renderProgress, showOptionFeedback } from './quiz-renderer.js';

let quizDef = null;
let quizEntries = [];
let engine = null;

let totalQuestions = 10;
let currentIndex = 0;
let currentScore = 0;
let currentQuestion = null;
let hasAnswered = false;

function showScreen(name) {
    dom.startScreen.classList.add('hidden');
    dom.quizScreen.classList.add('hidden');
    dom.resultScreen.classList.add('hidden');

    if (name === 'start') dom.startScreen.classList.remove('hidden');
    if (name === 'quiz') dom.quizScreen.classList.remove('hidden');
    if (name === 'result') dom.resultScreen.classList.remove('hidden');
}

function populateModeSelect() {
    dom.modeSelect.innerHTML = '';
    quizDef.modes.forEach((mode, idx) => {
        const opt = document.createElement('option');
        opt.value = mode.id;
        opt.textContent = mode.label || mode.id;
        if (idx === 0) opt.selected = true;
        dom.modeSelect.appendChild(opt);
    });
}

function startQuiz() {
    const modeId = dom.modeSelect.value;
    const n = parseInt(dom.questionCountInput.value, 10);
    totalQuestions = Number.isFinite(n) && n > 0 ? n : 10;

    currentIndex = 0;
    currentScore = 0;
    hasAnswered = false;
    dom.nextButton.disabled = true;

    engine.setMode(modeId);
    renderProgress(currentIndex, totalQuestions, currentScore);
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

    currentQuestion = engine.generateQuestion();
    const entity = quizDef.entitySet.entities[currentQuestion.entityId];

    renderQuestionText(currentQuestion.patternTokens, entity, true);
    renderOptions(currentQuestion, quizDef.entitySet, handleSelectOption);
    renderProgress(currentIndex, totalQuestions, currentScore);
}

function handleSelectOption(selectedIndex) {
    if (hasAnswered) return;
    hasAnswered = true;

    const correctIndex = currentQuestion.answer.correctIndex;
    if (selectedIndex === correctIndex) {
        currentScore += 1;
    }
    showOptionFeedback(currentQuestion, selectedIndex);
    renderProgress(currentIndex, totalQuestions, currentScore);

    dom.nextButton.disabled = false;
}

function showResult() {
    dom.resultScore.textContent = `${currentScore} / ${totalQuestions}`;
    showScreen('result');
}

async function bootstrap() {
    initThemeFromStorage();

    dom.themeToggle.addEventListener('click', () => {
        toggleTheme();
    });

    try {
        const [def, entries] = await Promise.all([
            loadQuizDefinition(),
            loadQuizEntries()
        ]);
        quizDef = def;
        quizEntries = entries;

        // set header
        document.title = quizDef.meta.title || '4-choice Quiz';
        dom.appTitle.textContent = quizDef.meta.title || '4-choice Quiz';
        dom.appDescription.textContent = quizDef.meta.description || '';

        // menu list
        renderQuizMenu(quizEntries);

        // engine
        engine = new QuizEngine(quizDef);
        populateModeSelect();

        // UI event handlers
        dom.startButton.addEventListener('click', startQuiz);
        dom.nextButton.addEventListener('click', () => {
            if (!hasAnswered) return;
            currentIndex += 1;
            loadNextQuestion();
        });

        dom.retryButton.addEventListener('click', () => {
            // retry same quiz with same mode & question count
            currentIndex = 0;
            currentScore = 0;
            hasAnswered = false;
            dom.nextButton.disabled = true;
            showScreen('quiz');
            loadNextQuestion();
        });

        dom.backToMenuButton.addEventListener('click', () => {
            showScreen('start');
        });

        showScreen('start');
    } catch (e) {
        console.error(e);
        dom.appDescription.textContent = 'Failed to load quiz definition.';
    }
}

bootstrap();
