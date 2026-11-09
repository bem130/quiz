import { err, ok } from '../core/result.ts';
import type { Result } from '../core/result.ts';

export function cachePrefix(scope: string): string { return `quiz-web:${encodeURIComponent(new URL(scope).pathname)}:`; }

/** 別アプリのcacheとIndexedDBには触れない。呼出側は安全なメニュー状態で再起動する。 */
export async function clearAppCache(scope: string, cacheStorage: Pick<CacheStorage, 'keys' | 'delete'>, workers: Readonly<{ getRegistrations(): Promise<readonly Readonly<{ scope: string; unregister(): Promise<boolean> }>[]> }>): Promise<Result<number, string>> {
    try {
        for (const registration of await workers.getRegistrations()) if (registration.scope === scope && !await registration.unregister()) return err('Service Workerの解除を完了できない。再試行できる。');
        let deleted = 0;
        for (const name of await cacheStorage.keys()) if (name.startsWith(cachePrefix(scope))) {
            if (!await cacheStorage.delete(name)) return err('アプリcacheの削除を完了できない。再試行できる。');
            deleted += 1;
        }
        return ok(deleted);
    } catch (error) { return err(error instanceof Error ? error.message : 'cacheを削除できない。'); }
}
