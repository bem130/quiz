// js/quiz-engine.js

/**
 * 配列からランダムに 1 要素を選ぶためのユーティリティ。
 * @template T
 * @param {Array<T>} arr - 対象の配列。
 * @returns {T} 配列からランダムに選ばれた要素。
 */
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * クイズ定義から問題生成とモード切り替えを管理するエンジン。
 */
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
            // フォールバック: パターン全体からランダム
            return randomChoice(this.patterns);
        }
        const r = Math.random() * w.total;
        return w.list.find(x => r < x.cumulative).pattern;
    }

    _getRubyDisplayKey(hiderubyToken, entity) {
        const base = hiderubyToken.base;
        const ruby = hiderubyToken.ruby;
        const baseText =
            base.source === 'key'
                ? (entity[base.field] ?? '')
                : (base.value ?? '');
        const rubyText =
            ruby.source === 'key'
                ? (entity[ruby.field] ?? '')
                : (ruby.value ?? '');
        return `${baseText}|||${rubyText}`;
    }

    /**
     * hide / hideruby 問題で、選択肢の「テキスト同一性」を判定するためのキー
     * - hideruby: 英語＋ルビを連結
     * - hide   : token.field の値（例: sideChainFormulaTex）
     */
    _getTokenDisplayKey(token, entity) {
        if (!entity) return '';

        if (token.type === 'hideruby') {
            return this._getRubyDisplayKey(token, entity);
        }

        if (token.field && typeof entity[token.field] === 'string') {
            return entity[token.field];
        }

        // フォールバック: 英語名
        return entity.nameEnCap || entity.nameEn || '';
    }

    /**
     * 選択肢ラベル用の Token 配列を、回答トークンから生成する。
     *
     * - choice_ruby_pair + hideruby/ruby:
     *     → token 自体をそのままラベルとして使う（base/ruby の field 情報を entity で解決）
     * - hide（sideChain など）:
     *     → 選択肢では隠さず表示したいので type: "key" に変換
     * - その他: null を返し、レンダラ側のフォールバック（英語名）に任せる
     */
    _getOptionLabelTokensFromToken(token) {
        if (!token) return null;

        const answerMode = token.answer && token.answer.mode;

        // 英語＋ルビペア選択肢（今回の main ケース）
        if (
            answerMode === 'choice_ruby_pair' &&
            (token.type === 'hideruby' || token.type === 'ruby')
        ) {
            return [token];
        }

        // hide されたフィールドを、そのまま文字列として選択肢に出したいケース
        if (token.type === 'hide' && token.field) {
            return [{
                type: 'key',
                field: token.field,
                styles: token.styles || []
            }];
        }

        // 素の key トークンをそのまま使うケース
        if (token.type === 'key') {
            return [token];
        }

        return null;
    }

    /**
     * Pattern + Entity から Question を生成する。
     * すべての回答パーツは answers[] に統一される。
     *
     * answers[] 例:
     * {
     *   id: "answer_sidechain",
     *   mode: "fill_in_blank", // ただし処理上は choice と同じ
     *   token,                 // 元の token（hide / hideruby）
     *   options: [{ entityId, isCorrect, displayKey, labelTokens }],
     *   correctIndex: 0,
     *   userSelectedIndex: null
     * }
     */
    generateQuestion() {
        if (this.entityIds.length === 0 || this.patterns.length === 0) {
            throw new Error('No entities or patterns available');
        }

        const pattern = this._choosePattern();
        const entityId = randomChoice(this.entityIds);
        const entity = this.entities[entityId];

        const answers = [];

        (pattern.tokens || []).forEach((token, idx) => {
            if (!token || !token.answer) return;

            // 正解は「今選ばれた entity」
            const correctEntityId = entityId;
            const correctDisplayKey = this._getTokenDisplayKey(token, entity);

            // ラベル用 Token を決定
            const labelTokens = this._getOptionLabelTokensFromToken(token);

            // distractor 設定（なければデフォルト 3 個）
            const choiceCfg = token.answer.choice || {};
            const ds = choiceCfg.distractorSource || {};
            const count = typeof ds.count === 'number' ? ds.count : 3;
            const avoidSameId = ds.avoidSameId !== false;       // デフォルト true
            const avoidSameText = ds.avoidSameText !== false;   // デフォルト true

            const distractorIds = [];
            const usedIds = new Set([correctEntityId]);
            const usedTextKeys = new Set([correctDisplayKey]);

            const pool = this.entityIds.slice();
            let safety = 1000;
            while (distractorIds.length < count && safety-- > 0) {
                const candidateId = randomChoice(pool);
                if (avoidSameId && candidateId === correctEntityId) continue;
                if (usedIds.has(candidateId)) continue;

                const candidateEntity = this.entities[candidateId];
                const key = this._getTokenDisplayKey(token, candidateEntity);
                if (avoidSameText && usedTextKeys.has(key)) continue;

                distractorIds.push(candidateId);
                usedIds.add(candidateId);
                usedTextKeys.add(key);
            }

            const optionEntities = [
                {
                    entityId: correctEntityId,
                    isCorrect: true,
                    displayKey: correctDisplayKey,
                    labelTokens
                },
                ...distractorIds.map(id => ({
                    entityId: id,
                    isCorrect: false,
                    displayKey: this._getTokenDisplayKey(token, this.entities[id]),
                    labelTokens
                }))
            ];

            // シャッフル
            for (let i = optionEntities.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [optionEntities[i], optionEntities[j]] = [optionEntities[j], optionEntities[i]];
            }

            const correctIndex = optionEntities.findIndex(o => o.isCorrect);

            answers.push({
                id: token.id || `ans_${idx}`,
                mode: token.answer.mode || 'choice',
                token,
                options: optionEntities,
                correctIndex,
                userSelectedIndex: null
            });
        });

        if (!answers.length) {
            throw new Error(`Pattern ${pattern.id} has no tokens with answer`);
        }

        return {
            patternId: pattern.id,
            patternTokens: pattern.tokens,
            patternTips: pattern.tips || [],
            entityId,
            answers
        };
    }
}
