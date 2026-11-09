# 出題・学習・永続化の仕様

TypeScript／Web版の規範は [domain-contract.md](domain-contract.md) に統合した。学習状態、正誤分類、間隔、出題範囲、候補枯渇、due待ち、時間切れ、再挑戦の規則は同文書の第4・5節を参照する。

実装は `src/core/study.ts`、`quiz-engine.ts`、`session.ts` に分け、時刻と乱数状態を入力して次状態を返す。DOM・通信・IndexedDBは `src/web/` の境界で扱う。回答・schedule・統計・session集計の保存は一つのIndexedDBトランザクションで確定し、失敗はResultとして呼出元へ返す。

以前の文書にあったDexie、旧 `js/` のクラス分割、旧ID、固定guest ID、5択等の案は新構成の仕様として使用しない。旧サイトからのデータ移行も行わない。新サイト自身のバックアップは草稿・題庫・ユーザー・学習履歴・設定・取得済みSVGを含み、復元時に全レコードを検証してから置き換える。

検証は `tests/core/{study,quiz-engine,session,storage}.test.ts` と実ブラウザの `tests/e2e/application.spec.ts`、`pwa.spec.ts` で行う。純粋関数・模擬IndexedDBの成功を実ブラウザ・実機・公開環境の確認と同一視しない。
