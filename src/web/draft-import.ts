import { parseQuizJson } from '../core/schema.ts';
import { err, ok } from '../core/result.ts';
import type { Result } from '../core/result.ts';
import type { DraftRecord } from '../core/records.ts';
import type { QuizStorage } from './storage/database.ts';

/** Clipboardと手動貼付けは同じstrict v3検証と新規作成CASを通す。 */
export async function importDraft(storage: Pick<QuizStorage, 'saveDraft'>, path: string, text: string, now: number): Promise<Result<DraftRecord, string>> {
    const parts = path.trim().replaceAll('\\', '/').split('/');
    if (parts.length === 0 || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':') || Array.from(part).some((character) => character.charCodeAt(0) < 32))) return err('草稿の相対パスを指定する。');
    const normalized = parts.join('/');
    const id = normalized.endsWith('.json') ? normalized : `${normalized}.json`;
    const quiz = parseQuizJson(text);
    if (!quiz.ok) return err(`v3問題JSONが不正: ${quiz.error.path} ${quiz.error.detail}`);
    const saved = await storage.saveDraft({ id, text, updatedAt: now, expectedVersion: 0 });
    return saved.ok ? ok(saved.value) : err(saved.error.message);
}
