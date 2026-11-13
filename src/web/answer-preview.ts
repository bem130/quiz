import type { Pattern } from '../core/model.ts';

/** 行同士の対応は通常択一でも示し、固定選択肢では空欄補完だけを示す。 */
export function answerPreviewEnabled(pattern: Pattern): boolean {
    return pattern.tokens.some(token => typeof token !== 'string' && token.type === 'hide' &&
        (token.display === 'inline' || token.answer.mode === 'choice_from_entities'));
}
