// js/test-engine.js
export class TestSessionRunner {
    constructor(options) {
        this.baseEngine = options.engine;
        this.resolveQuestionId =
            typeof options.resolveQuestionId === 'function'
                ? options.resolveQuestionId
                : () => null;
        this.seenQuestionIds = new Set();
        this.questionCount = 0;
    }

    async start(config) {
        this.questionCount = config.questionCount || 10;
        this.seenQuestionIds.clear();
    }

    async nextQuestion() {
        for (let attempt = 0; attempt < 80; attempt++) {
            const question = this.baseEngine.generateQuestion();
            if (!question) continue;
            const questionId = this.resolveQuestionId(question);
            if (!questionId || !this.seenQuestionIds.has(questionId)) {
                if (questionId) {
                    this.seenQuestionIds.add(questionId);
                }
                return question;
            }
        }
        return this.baseEngine.generateQuestion();
    }

    async recordResult() {
        // Test mode does not alter schedules.
    }
}
