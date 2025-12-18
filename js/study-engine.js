// js/study-engine.js
import {
    ensureScheduleEntry,
    updateScheduleAfterResult,
    listDueScheduleEntries,
    makeQuestionKey,
    deleteScheduleEntryByKey
} from './storage/schedule-store.js';
import {
    saveQuestionSnapshot,
    getQuestionSnapshotByKey,
    findQuestionsByConcept
} from './storage/question-store.js';
import {
    getTopConfusionPairs,
    markConfusionPairScheduled
} from './storage/confusion-store.js';
import { getUncertainConcepts } from './storage/concept-stats.js';

const MAX_GENERATOR_ATTEMPTS = 80;
const LARGE_BACKLOG_THRESHOLD = 80;
const NEW_RATIO = 0.1;
const TARGETED_MIN_SCORE = 0.6;
const TARGETED_QUEUE_LIMIT = 12;
const DUE_FETCH_LIMIT = 120;
const DUE_REFRESH_INTERVAL_MS = 4000;

function shuffleList(list) {
    const arr = Array.isArray(list) ? [...list] : [];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = arr[i];
        arr[i] = arr[j];
        arr[j] = temp;
    }
    return arr;
}

function normalizeConceptId(value) {
    if (value == null) {
        return null;
    }
    try {
        return String(value);
    } catch (error) {
        return null;
    }
}

function resolveOptionConceptId(option) {
    if (!option || typeof option !== 'object') {
        return null;
    }
    if (option.conceptId != null) {
        return normalizeConceptId(option.conceptId);
    }
    if (option.meta && option.meta.conceptId != null) {
        return normalizeConceptId(option.meta.conceptId);
    }
    if (option.entityId != null) {
        return normalizeConceptId(option.entityId);
    }
    return null;
}

function questionIncludesConcept(question, conceptId) {
    const normalized = normalizeConceptId(conceptId);
    if (!question || normalized == null) {
        return false;
    }
    const answers = Array.isArray(question.answers) ? question.answers : [];
    for (const answer of answers) {
        const options = Array.isArray(answer && answer.options)
            ? answer.options
            : [];
        for (const option of options) {
            if (resolveOptionConceptId(option) === normalized) {
                return true;
            }
        }
    }
    return false;
}

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
        this.learningDue = new Set();
        this.relearningDue = new Set();
        this.reviewDue = new Set();
        this.newQuota = 0;
        this.drainDueMode = false;
        this.backlogSize = 0;
        this.priorityServed = {
            review: 0,
            repair: 0,
            new: 0
        };
        this.targetedQueue = [];
        this.targetedPairUsage = new Map();
        this.lastDueRefreshAt = 0;
    }

    async start(config) {
        this.userId = config.userId;
        this.quizId = config.quizId;
        this.questionCount = config.questionCount || 10;
        this.drainDueMode = Boolean(config && config.drainDue);
        this.seenQuestionKeys.clear();
        this.learningDue.clear();
        this.relearningDue.clear();
        this.reviewDue.clear();
        this.priorityServed = {
            review: 0,
            repair: 0,
            new: 0
        };
        this.targetedQueue = [];
        if (this.targetedPairUsage) {
            this.targetedPairUsage.clear();
        } else {
            this.targetedPairUsage = new Map();
        }
        this.lastDueRefreshAt = 0;
        await this._refreshDueBuckets({ force: true });

        const backlogHeavy = this.backlogSize >= LARGE_BACKLOG_THRESHOLD;
        const plannedNew = Math.max(
            1,
            Math.round(this.questionCount * NEW_RATIO)
        );
        this.newQuota = this.drainDueMode ? 0 : backlogHeavy ? 0 : plannedNew;
        await this._prepareTargetedQueue();
    }

    _updateBacklogCounts() {
        this.backlogSize =
            this.learningDue.size +
            this.relearningDue.size +
            this.reviewDue.size;
    }

    _classifyBucket(questionKey) {
        if (this.learningDue.has(questionKey)) return 'learning';
        if (this.relearningDue.has(questionKey)) return 'relearning';
        if (this.reviewDue.has(questionKey)) return 'review';
        return 'new';
    }

    _stageFromBucket(bucket) {
        switch (bucket) {
            case 'learning':
                return 'LEARNING';
            case 'relearning':
                return 'RELEARNING';
            case 'review':
                return 'REVIEW';
            case 'new':
                return 'NEW';
            default:
                return 'STUDY';
        }
    }

    _bucketSet(bucket) {
        if (bucket === 'learning') return this.learningDue;
        if (bucket === 'relearning') return this.relearningDue;
        if (bucket === 'review') return this.reviewDue;
        return null;
    }

    _addDueEntries(entries, bucketSet) {
        if (!Array.isArray(entries) || !bucketSet) {
            return;
        }
        entries.forEach((entry) => {
            if (!entry || !entry.qid) {
                return;
            }
            if (this.seenQuestionKeys.has(entry.qid)) {
                return;
            }
            bucketSet.add(entry.qid);
        });
    }

    async _refreshDueBuckets({ force = false } = {}) {
        if (!this.userId) {
            return;
        }
        const now = Date.now();
        if (!force && this.lastDueRefreshAt && now - this.lastDueRefreshAt < DUE_REFRESH_INTERVAL_MS) {
            return;
        }
        let dueOverview;
        try {
            dueOverview = await listDueScheduleEntries(this.userId, this.quizId, {
                now,
                perStateLimit: DUE_FETCH_LIMIT
            });
        } catch (error) {
            console.warn('[study-engine] failed to refresh due buckets', error);
            return;
        }

        this.lastDueRefreshAt = now;
        if (dueOverview) {
            this._addDueEntries(dueOverview.learning, this.learningDue);
            this._addDueEntries(dueOverview.relearning, this.relearningDue);
            this._addDueEntries(dueOverview.review, this.reviewDue);
            this._updateBacklogCounts();
        }
    }

    _setQuestionStage(question, stage) {
        if (!question || typeof question !== 'object' || !stage) {
            return;
        }
        try {
            Object.defineProperty(question, '__sessionStage', {
                value: stage,
                writable: true,
                configurable: true,
                enumerable: false
            });
        } catch (error) {
            question.__sessionStage = stage;
        }
    }

    _bucketMatchesPriority(bucket, priority) {
        if (this.drainDueMode && bucket === 'new') {
            return false;
        }
        if (priority === 'any') {
            return true;
        }
        if (priority === 'urgent') {
            return bucket === 'learning' || bucket === 'relearning';
        }
        if (priority === 'review') {
            return bucket === 'review';
        }
        if (priority === 'new') {
            return bucket === 'new';
        }
        return true;
    }

    _consumeBucket(questionKey, bucket) {
        if (bucket === 'learning') {
            this.learningDue.delete(questionKey);
        } else if (bucket === 'relearning') {
            this.relearningDue.delete(questionKey);
        } else if (bucket === 'review') {
            this.reviewDue.delete(questionKey);
        }
        this._updateBacklogCounts();
    }

    async _attemptGenerateWithPriority(priority) {
        for (let attempt = 0; attempt < MAX_GENERATOR_ATTEMPTS; attempt += 1) {
            const question = this.baseEngine.generateQuestion();
            if (!question) {
                continue;
            }
            const questionId = this.resolveQuestionId(question);
            if (!questionId) {
                continue;
            }
            const questionKey = makeQuestionKey(this.quizId, questionId);
            if (this.seenQuestionKeys.has(questionKey)) {
                continue;
            }
            const bucket = this._classifyBucket(questionKey);
            if (this.drainDueMode && bucket === 'new') {
                continue;
            }
            if (!this._bucketMatchesPriority(bucket, priority)) {
                continue;
            }

            await ensureScheduleEntry(this.userId, this.quizId, questionId);
            await saveQuestionSnapshot(this.quizId, questionId, question);
            this.seenQuestionKeys.add(questionKey);
            this._consumeBucket(questionKey, bucket);
            if (bucket === 'new' && this.newQuota > 0) {
                this.newQuota -= 1;
            }
            this._setQuestionStage(question, this._stageFromBucket(bucket));
            return question;
        }
        return null;
    }

    async _attemptLoadFromBucket(bucket) {
        const bucketSet = this._bucketSet(bucket);
        if (!bucketSet || bucketSet.size === 0) {
            return null;
        }
        for (const questionKey of [...bucketSet]) {
            try {
                const snapshot = await getQuestionSnapshotByKey(questionKey);
                if (snapshot) {
                    this.seenQuestionKeys.add(questionKey);
                    this._consumeBucket(questionKey, bucket);
                    this._setQuestionStage(
                        snapshot,
                        this._stageFromBucket(bucket)
                    );
                    return snapshot;
                }
                await deleteScheduleEntryByKey(this.userId, questionKey);
                this._consumeBucket(questionKey, bucket);
            } catch (error) {
                console.warn('[study-engine] failed to load question snapshot', {
                    bucket,
                    questionKey,
                    error
                });
                try {
                    await deleteScheduleEntryByKey(this.userId, questionKey);
                } catch (cleanupError) {
                    console.warn('[study-engine] failed to drop invalid schedule entry', cleanupError);
                }
                this._consumeBucket(questionKey, bucket);
            }
        }
        return null;
    }

    _removeQuestionFromAllBuckets(questionKey) {
        if (!questionKey) {
            return;
        }
        let removed = false;
        if (this.learningDue.delete(questionKey)) {
            removed = true;
        }
        if (this.relearningDue.delete(questionKey)) {
            removed = true;
        }
        if (this.reviewDue.delete(questionKey)) {
            removed = true;
        }
        if (removed) {
            this._updateBacklogCounts();
        }
    }

    async _ensureScheduleRecordForStoredQuestion(record) {
        if (
            !this.userId ||
            !this.quizId ||
            !record ||
            !record.questionId
        ) {
            return;
        }
        try {
            await ensureScheduleEntry(
                this.userId,
                this.quizId,
                record.questionId
            );
        } catch (error) {
            console.warn('[study-engine] failed to ensure schedule for stored question', {
                quizId: this.quizId,
                questionId: record.questionId,
                error
            });
        }
    }

    async _injectReviewQuestion(record) {
        if (
            !record ||
            !record.questionKey ||
            this.seenQuestionKeys.has(record.questionKey) ||
            this.reviewDue.has(record.questionKey)
        ) {
            return false;
        }
        await this._ensureScheduleRecordForStoredQuestion(record);
        this.reviewDue.add(record.questionKey);
        this._updateBacklogCounts();
        return true;
    }

    async _prepareTargetedQueue() {
        if (!this.userId || !this.quizId) {
            this.targetedQueue = [];
            return;
        }
        const queue = [];
        const seenKeys = new Set();

        try {
            const confusionPairs = await getTopConfusionPairs(this.userId, {
                minScore: TARGETED_MIN_SCORE,
                limit: 5
            });
            for (const pair of confusionPairs) {
                const wrongConceptQuestions = await findQuestionsByConcept(
                    this.quizId,
                    pair.wrongConceptId,
                    { limit: 2 }
                );
                for (const record of wrongConceptQuestions) {
                    if (!record || !record.question || !record.questionKey) {
                        continue;
                    }
                    if (seenKeys.has(record.questionKey)) {
                        continue;
                    }
                    seenKeys.add(record.questionKey);
                    queue.push({
                        type: 'confusion',
                        key: `conf:${pair.conceptId}:${pair.wrongConceptId}`,
                        pair,
                        question: record.question,
                        questionKey: record.questionKey
                    });
                }
                const cooccurring = await findQuestionsByConcept(
                    this.quizId,
                    pair.conceptId,
                    { limit: 4 }
                );
                for (const record of cooccurring) {
                    if (
                        !record ||
                        !record.question ||
                        !record.questionKey ||
                        seenKeys.has(record.questionKey)
                    ) {
                        continue;
                    }
                    if (
                        !questionIncludesConcept(
                            record.question,
                            pair.wrongConceptId
                        )
                    ) {
                        continue;
                    }
                    seenKeys.add(record.questionKey);
                    queue.push({
                        type: 'confusion',
                        key: `conf:${pair.conceptId}:${pair.wrongConceptId}`,
                        pair,
                        question: record.question,
                        questionKey: record.questionKey
                    });
                }
            }
        } catch (error) {
            console.warn('[study-engine] failed to collect confusion targets', error);
        }

        try {
            const uncertainConcepts = await getUncertainConcepts(this.userId, {
                minScore: TARGETED_MIN_SCORE,
                limit: 4
            });
            for (const concept of uncertainConcepts) {
                const records = await findQuestionsByConcept(
                    this.quizId,
                    concept.conceptId,
                    { limit: 2 }
                );
                let reviewInjected = 0;
                for (const record of records) {
                    if (!record || !record.question || !record.questionKey) {
                        continue;
                    }
                    if (seenKeys.has(record.questionKey)) {
                        continue;
                    }
                    seenKeys.add(record.questionKey);
                    queue.push({
                        type: 'uncertainty',
                        key: `unc:${concept.conceptId}`,
                        conceptId: concept.conceptId,
                        question: record.question,
                        questionKey: record.questionKey
                    });
                    if (reviewInjected < 2) {
                        const injected = await this._injectReviewQuestion(record);
                        if (injected) {
                            reviewInjected += 1;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('[study-engine] failed to collect uncertainty targets', error);
        }

        this.targetedQueue = shuffleList(queue).slice(0, TARGETED_QUEUE_LIMIT);
        if (this.targetedPairUsage) {
            this.targetedPairUsage.clear();
        }
    }

    _choosePriorityType(skipTypes = new Set()) {
        const candidates = [];
        if (this.reviewDue.size > 0 && !skipTypes.has('review')) {
            candidates.push('review');
        }
        if (this.targetedQueue.length > 0 && !skipTypes.has('repair')) {
            candidates.push('repair');
        }
        if (
            (this.newQuota > 0 || this.backlogSize === 0) &&
            !skipTypes.has('new')
        ) {
            candidates.push('new');
        }
        if (!candidates.length) {
            return null;
        }
        const ratioTargets = {
            review: 6,
            repair: 3,
            new: 1
        };
        let chosen = candidates[0];
        let bestScore = Infinity;
        candidates.forEach((type) => {
            const desired = ratioTargets[type] || 1;
            const served = this.priorityServed[type] || 0;
            const score = served / desired;
            if (score < bestScore) {
                bestScore = score;
                chosen = type;
            }
        });
        return chosen;
    }

    async _registerTargetedUsage(entry, questionKey) {
        this._removeQuestionFromAllBuckets(questionKey);
        if (!entry || !entry.key) {
            return;
        }
        const count = (this.targetedPairUsage.get(entry.key) || 0) + 1;
        this.targetedPairUsage.set(entry.key, count);
        if (entry.type === 'confusion' && entry.pair) {
            try {
                await markConfusionPairScheduled(
                    this.userId,
                    entry.pair.conceptId,
                    entry.pair.wrongConceptId
                );
            } catch (error) {
                console.warn('[study-engine] failed to mark confusion repair', error);
            }
        }
        if (count >= 2) {
            this.targetedQueue = this.targetedQueue.filter(
                (item) => item && item.key !== entry.key
            );
        }
    }

    async _popTargetedQuestion() {
        while (this.targetedQueue.length > 0) {
            const entry = this.targetedQueue.shift();
            if (!entry || !entry.question) {
                continue;
            }
            const questionId = this.resolveQuestionId(entry.question);
            if (!questionId) {
                continue;
            }
            const questionKey = makeQuestionKey(this.quizId, questionId);
            if (this.seenQuestionKeys.has(questionKey)) {
                continue;
            }
            try {
                await ensureScheduleEntry(this.userId, this.quizId, questionId);
            } catch (error) {
                console.warn('[study-engine] failed to ensure schedule entry for targeted question', error);
                continue;
            }
            this.seenQuestionKeys.add(questionKey);
            this.priorityServed.repair = (this.priorityServed.repair || 0) + 1;
            await this._registerTargetedUsage(entry, questionKey);
            this._setQuestionStage(entry.question, 'REPAIR');
            return entry.question;
        }
        return null;
    }

    async nextQuestion() {
        await this._refreshDueBuckets();
        const urgentBuckets = [];
        if (this.learningDue.size > 0) {
            urgentBuckets.push('learning');
        }
        if (this.relearningDue.size > 0) {
            urgentBuckets.push('relearning');
        }
        for (const bucket of urgentBuckets) {
            const urgentQuestion = await this._attemptLoadFromBucket(bucket);
            if (urgentQuestion) {
                this.priorityServed.review = (this.priorityServed.review || 0) + 1;
                return urgentQuestion;
            }
        }

        const attemptedTypes = new Set();
        while (true) {
            const type = this._choosePriorityType(attemptedTypes);
            if (!type) {
                break;
            }
            if (type === 'review') {
                const reviewQuestion = await this._attemptLoadFromBucket('review');
                if (reviewQuestion) {
                    this.priorityServed.review = (this.priorityServed.review || 0) + 1;
                    return reviewQuestion;
                }
                attemptedTypes.add('review');
                continue;
            }
            if (type === 'repair') {
                const targeted = await this._popTargetedQuestion();
                if (targeted) {
                    return targeted;
                }
                attemptedTypes.add('repair');
                continue;
            }
            if (type === 'new') {
                const newQuestion = await this._attemptGenerateWithPriority('new');
                if (newQuestion) {
                    this.priorityServed.new = (this.priorityServed.new || 0) + 1;
                    return newQuestion;
                }
                this.newQuota = 0;
                attemptedTypes.add('new');
            }
        }

        const priorities = [];
        if (this.learningDue.size > 0 || this.relearningDue.size > 0) {
            priorities.push('urgent');
        }
        if (this.reviewDue.size > 0) {
            priorities.push('review');
        }
        if (!this.drainDueMode && (this.newQuota > 0 || this.backlogSize === 0)) {
            priorities.push('new');
        }
        priorities.push('any');

        for (const priority of priorities) {
            const question = await this._attemptGenerateWithPriority(priority);
            if (question) {
                if (priority === 'new') {
                    this.priorityServed.new = (this.priorityServed.new || 0) + 1;
                } else {
                    this.priorityServed.review = (this.priorityServed.review || 0) + 1;
                }
                return question;
            }
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
