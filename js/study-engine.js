// js/study-engine.js
import {
    ensureScheduleEntry,
    updateScheduleAfterResult,
    listScheduleEntriesForQuiz,
    makeQuestionKey
} from './storage/schedule-store.js';

const MAX_GENERATOR_ATTEMPTS = 60;

export class StudySessionRunner {
    constructor(options) {
        this.baseEngine = options.engine;
        this.resolveQuestionId =
            typeof options.resolveQuestionId === 'function'
                ? options.resolveQuestionId
                : () => null;
        this.quizDefinition = options.quizDefinition || null;
        this.userId = null;
        this.quizId = null;
        this.questionCount = 0;
        this.seenQuestionKeys = new Set();
        this.dueQuestionKeys = new Set();
        this.newQuota = 0;
    }

    async start(config) {
        this.userId = config.userId;
        this.quizId = config.quizId;
        this.questionCount = config.questionCount || 10;
        this.seenQuestionKeys.clear();

        const scheduleOverview = await listScheduleEntriesForQuiz(
            this.userId,
            this.quizId
        );
        const now = Date.now();
        this.dueQuestionKeys = new Set(
            []
                .concat(scheduleOverview.learning || [])
                .concat(scheduleOverview.relearning || [])
                .concat(scheduleOverview.review || [])
                .filter((entry) => entry && entry.dueAt <= now)
                .map((entry) => entry.qid)
        );

        const backlogSize = this.dueQuestionKeys.size;
        this.newQuota = Math.max(
            1,
            Math.floor((this.questionCount - backlogSize) * 0.3)
        );
    }

    async nextQuestion() {
        for (let attempt = 0; attempt < MAX_GENERATOR_ATTEMPTS; attempt++) {
            const question = this.baseEngine.generateQuestion();
            if (!question) {
                continue;
            }
            const questionId = this.resolveQuestionId(question);
            if (!questionId) {
                return question;
            }
            const questionKey = makeQuestionKey(this.quizId, questionId);
            if (this.seenQuestionKeys.has(questionKey)) {
                continue;
            }
            const isDue = this.dueQuestionKeys.has(questionKey);
            if (!isDue && this.dueQuestionKeys.size > 0) {
                continue;
            }
            if (!isDue && this.newQuota <= 0 && this.dueQuestionKeys.size === 0) {
                // Allow overflow new when no due items remain.
            } else if (!isDue && this.newQuota <= 0) {
                continue;
            }

            await ensureScheduleEntry(this.userId, this.quizId, questionId);
            this.seenQuestionKeys.add(questionKey);
            if (isDue) {
                this.dueQuestionKeys.delete(questionKey);
            } else if (this.newQuota > 0) {
                this.newQuota -= 1;
            }
            return question;
        }

        return null;
    }

    async recordResult(result) {
        if (!result || !result.questionId) {
            return;
        }
        await updateScheduleAfterResult({
            userId: this.userId,
            quizId: this.quizId,
            questionId: result.questionId,
            resultType: result.resultType,
            answerMs: result.answerMs
        });
    }
}
