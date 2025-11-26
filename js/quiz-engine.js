// js/quiz-engine.js

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export class QuizEngine {
    constructor(definition) {
        this.meta = definition.meta;
        this.entitySet = definition.entitySet;
        this.patterns = definition.patterns;
        this.modes = definition.modes;
        this.entities = this.entitySet.entities || {};
        this.entityIds = Object.keys(this.entities);
        this.patternMap = new Map(this.patterns.map(p => [p.id, p]));
        this.currentMode = null;
        this.currentWeights = [];
    }

    setMode(modeId) {
        const mode = this.modes.find(m => m.id === modeId) || this.modes[0];
        this.currentMode = mode;
        const weights = mode.patternWeights || [];
        const list = [];
        let sum = 0;
        for (const pw of weights) {
            const p = this.patternMap.get(pw.patternId);
            if (!p) continue;
            sum += pw.weight;
            list.push({ pattern: p, cumulative: sum });
        }
        this.currentWeights = { list, total: sum };
    }

    _choosePattern() {
        const w = this.currentWeights;
        if (!w || !w.list.length || !w.total) {
            // fallback: random from all patterns
            return randomChoice(this.patterns);
        }
        const r = Math.random() * w.total;
        return w.list.find(x => r < x.cumulative).pattern;
    }

    _getRubyDisplayKey(hiderubyToken, entity) {
        const base = hiderubyToken.base;
        const ruby = hiderubyToken.ruby;
        const baseText = base.source === 'key'
            ? (entity[base.field] ?? '')
            : (base.value ?? '');
        const rubyText = ruby.source === 'key'
            ? (entity[ruby.field] ?? '')
            : (ruby.value ?? '');
        return `${baseText}|||${rubyText}`;
    }

    generateQuestion() {
        if (this.entityIds.length === 0 || this.patterns.length === 0) {
            throw new Error('No entities or patterns available');
        }

        const pattern = this._choosePattern();
        const entityId = randomChoice(this.entityIds);
        const entity = this.entities[entityId];

        // 採点対象となる hideruby を探す（今は1つを想定）
        const hiderubyToken = (pattern.tokens || []).find(
            t => t.type === 'hideruby' && t.answer && t.answer.mode === 'choice_ruby_pair'
        );
        if (!hiderubyToken) {
            throw new Error(`Pattern ${pattern.id} has no usable hideruby answer`);
        }

        const correctEntityId = entityId;
        const correctDisplayKey = this._getRubyDisplayKey(hiderubyToken, entity);

        const choiceCfg = hiderubyToken.answer.choice || {};
        const count = choiceCfg.distractorSource?.count ?? 3;
        const avoidSameId = !!choiceCfg.distractorSource?.avoidSameId;
        const avoidSameText = !!choiceCfg.distractorSource?.avoidSameText;

        const distractorIds = [];
        const usedIds = new Set([correctEntityId]);
        const usedTextKeys = new Set([correctDisplayKey]);

        // ダミー候補をランダムに選ぶ
        const pool = this.entityIds.slice();
        let safety = 1000;
        while (distractorIds.length < count && safety-- > 0) {
            const candidateId = randomChoice(pool);
            if (avoidSameId && candidateId === correctEntityId) continue;
            if (usedIds.has(candidateId)) continue;

            const candidateEntity = this.entities[candidateId];
            const key = this._getRubyDisplayKey(hiderubyToken, candidateEntity);
            if (avoidSameText && usedTextKeys.has(key)) continue;

            distractorIds.push(candidateId);
            usedIds.add(candidateId);
            usedTextKeys.add(key);
        }

        const optionEntities = [
            { entityId: correctEntityId, isCorrect: true, displayKey: correctDisplayKey },
            ...distractorIds.map(id => ({
                entityId: id,
                isCorrect: false,
                displayKey: this._getRubyDisplayKey(hiderubyToken, this.entities[id])
            }))
        ];

        // シャッフル
        for (let i = optionEntities.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [optionEntities[i], optionEntities[j]] = [optionEntities[j], optionEntities[i]];
        }

        const correctIndex = optionEntities.findIndex(o => o.isCorrect);

        return {
            patternId: pattern.id,
            patternTokens: pattern.tokens,
            entityId,
            answer: {
                type: 'choice_ruby_pair',
                hiderubyToken,
                options: optionEntities,
                correctIndex
            }
        };
    }
}
