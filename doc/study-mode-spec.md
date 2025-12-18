# 出題戦略 / IndexedDB 永続化 仕様書

## 1. 背景と現状整理

- 本アプリは `js/main.js:964` の `startQuiz()` でクイズを開始し、`js/main.js:1035` 以降の `loadNextQuestion()` が `quiz-engine` から都度問題を取得している。
- `js/quiz-engine.js:946` の `generateQuestion()` は、モードごとのパターン重みを考慮しつつも、基本的にはランダム抽選だけで出題する実装になっている。
- 回答履歴や学習状況はブラウザリロードで失われ、IndexedDB 等の永続ストレージは未使用。
- したがってユーザーごとに復習間隔を制御したり、テストモードの履歴を長期保存する道筋がない。

この仕様書では、上記の現状を踏まえて **学習モード向けのスケジューリング** と **テストモードの履歴保存** を実現するための新しいアーキテクチャを定義する。

## 2. 目標

1. ブラウザ内 JavaScript で完結する出題戦略エンジンを構築する。
2. IndexedDB にユーザーデータを保存し、複数ユーザー（`guest` を初期ユーザーとし、必要に応じてユーザを追加）を同一端末で切り替えられるようにする。
3. 同期機能を持たない代わりに、Import / Export で完全バックアップが可能な構造にする。
4. **学習モード**は Spaced Repetition + 混同補修を行い、**テストモード**は完全ランダム出題だが履歴を残す。

## 3. 全体構成

```
┌──────────────────────────────┐
│ Authed User (guest, others added via UI) │
└──────────────┬──────────────┘
               │
        ┌──────▼──────┐
        │ SessionCore │  ← startQuiz/loadNextQuestion/handleSelectOption をラップ
        └──────┬──────┘
               │
       ┌───────▼────────┐
       │ StudyEngine    │  学習モード：schedule / confusion 参照
       │ TestEngine     │  テストモード：ランダム抽選のみ
       └───────┬────────┘
               │
      ┌────────▼─────────┐
      │ IndexedDB (Dexie) │
      └───────────────────┘
```

- `SessionCore` は既存の `quiz-engine` と UI (`js/main.js`) の間に挟む薄い層で、セッション開始・問題取得・解答記録を司る。
- `StudyEngine` / `TestEngine` はモードごとの出題戦略を担当し、IndexedDB から必要なデータを取得する。
- IndexedDB は Dexie.js を利用し、Export/Import をサポートする。

## 4. IndexedDB 設計

Dexie 定義例（抜粋）:

```js
db.version(1).stores({
  users:          'userId, lastActiveAt',
  packages:       'packageId, subject, revision',
  questions:      'qid, packageId, conceptId, [packageId+conceptId]',
  schedule:       '[userId+qid], [userId+dueAt], [userId+state], userId',
  attempts:       '++attemptId, [userId+timestamp], [userId+mode+timestamp], [sessionId], [userId+qid]',
  sessions:       'sessionId, [userId+mode+startedAt]',
  confusion:      '[userId+conceptId+wrongConceptId], userId',
  concept_stats:  '[userId+conceptId], userId',
  app_meta:       'key'
});
```

### 4.1 users
- key: `userId` (`"guest"` by default; additional users created via UI)
- fields: `displayName`, `type`, `createdAt`, `lastActiveAt`, `settings`（フォントサイズ・テーマ等を将来的に移行）

### 4.2 packages
- key: `packageId`
- fields: `title`, `subject`, `revision`, `schemaVersion`, `importedAt`, `contentHash`

### 4.3 questions
- key: `qid = packageId + ":" + questionId`
- fields: `packageId`, `stem`, `options[]`, `correctOptionId`, `distractorPool[]`, `tags[]`, `conceptId`, `mediaRefs[]`, `updatedAt`
- indexes: `packageId`, `conceptId`
- `distractorPool[]` は「出題時に3つ抽選するための誤選択肢候補」。variant方式の問題は `distractorPool` を空にし、別フィールドで variant ID を参照する。

### 4.4 schedule（学習専用）
- key: `[userId, qid]`
  - `qid = packageId + "::" + patternId + "::" + questionId`
  - `patternId` が存在しない問題は `patternId = "global"` として扱い、同一問題でもパターンごとに独立したキューを持つ
- fields:
  - `patternId`: このスケジュール行が属する `patternId`
  - `questionKey`: 旧形式 `packageId + "::" + questionId`。スナップショット参照やマイグレーションに利用
  - `state`: `NEW | LEARNING | REVIEW | RELEARNING`
  - `dueAt`: `epochMs` number（UTC）
  - `dueAtFuzzed`: 直近に適用したゆらぎ係数
  - `intervalSec`, `ease`, `stepIndex`
  - `streak`, `lapses`, `lastAnswerMs`, `lastSeenAt`, `createdAt`
- indexes: `[userId, dueAt]`, `[userId, state]`

### 4.5 attempts（全モード）
- key: `attemptId` (auto increment)
- fields: `userId`, `qid`, `packageId`, `mode ("learn"|"test")`, `sessionId`, `timestamp`, `chosenOptionId`, `correct`, `answerMs`, `isWeakCorrect`, `optionsOrder[]`, `optionConcepts[]`, `idkNearestOptionId`, `idkNearestConceptId`
  - `optionConcepts[]` は各選択肢の `conceptId` を `optionsOrder[]` と同じ順番で格納。confusion の分母計算に使う。
  - `idkNearest*` は IDK を押した後に「最も近いと感じた選択肢」を任意入力した場合のみ保存。

### 4.6 sessions
- key: `sessionId`
- fields: `userId`, `mode`, `startedAt`, `endedAt`, `seed`, `config`, `summary`

### 4.7 confusion
- key: `[userId, conceptId, wrongConceptId]`
- fields: `shownCount`, `chosenCount`, `idkNearCount`, `scoreCache`, `lastUpdatedAt`, `recentSessions`, `lastShownAt`
- `scoreCache` は後述の確率式で計算した値をキャッシュしておき、インクリメント毎に更新する。
- `wrongConceptId` は誤って選んだ選択肢の概念 ID（`conceptId`）。問題改訂や選択肢シャッフルに強い。

### 4.8 concept_stats
- key: `[userId, conceptId]`
- fields: `uncertaintyEma`, `recentIdk`, `lastUpdatedAt`
- `uncertaintyEma` は IDK や Weak 判定の EMA。`recentIdk` は短期での IDK 回数を抑制フラグに使う。

### 4.9 app_meta
- key: `"meta"`
- fields: `dbVersion`, `lastExportAt`, `lastImportAt`, `appVersion`

## 5. 学習モード仕様

### 5.1 スケジューリング状態

| state      | 用途                     | 初期 interval | 備考 |
|------------|--------------------------|---------------|------|
| NEW        | 未出題                   | -             | `dueAt = now` でキュー入り |
| LEARNING   | 短期学習ステップ         | `2m → 15m → 1d` | `stepIndex` で進行 |
| REVIEW     | 長期復習                 | 直前の `intervalSec` | SRS サイクル |
| RELEARNING | ミス後の短期ステップ     | `10m → 1d`    | `lapses`++ |

共通フィールド:
- `ease`: 初期 2.5、下限 1.3、上限 2.8
- `intervalSec`: 次回間隔、最小 30 秒
- `streak`: 連続正解数
- `lapses`: 間違い回数
- `lastAnswerMs`: 最近回答時間
- `dueAtFuzzed`: 適用済みのゆらぎ係数（`1.0` が基準）

### 5.2 判定（Strong / Weak / Incorrect）

`handleSelectOption()`（`js/main.js:1188`）で正誤判定した後、以下の追加判定を入れる:
- `answerMs` > 個人中央値 * 1.5
- `confusion(correctConcept, chosenConcept)` がしきい値を超える

上記のいずれかを満たす正解は **Weak Correct** とみなす。

### 5.3 更新ルール

| 結果            | 処理内容 |
|-----------------|-----------|
| Strong Correct  | `intervalSec *= ease`, `ease += 0.02`, `state = REVIEW`, `streak++` |
| Weak Correct    | `intervalSec *= max(1.2, 0.7 * ease)`, `ease -= 0.02`, `state = REVIEW`, `streak++` |
| Incorrect       | `state = RELEARNING`, `stepIndex = 0`, `intervalSec = max(60, intervalSec * 0.2)`, `ease -= 0.08`, `streak = 0`, `lapses++` |

`ease` は `[1.3, 2.8]` に clamp。`dueAt = now + intervalSec` の計算時に後述の Fuzz を掛ける。将来的には「目標保持率（desired retention）」スライダーを追加し、`intervalSec` に係数を掛けることで負荷調整を行う余地を残す。

### 5.3.1 Fuzz（ゆらぎ）の適用

- `intervalSec < 86400`（24h未満）の場合は Fuzz を適用しない。
- `intervalSec >= 86400` の場合は `factor = 1 + random(-0.05, +0.05)` を掛けて `dueAt` を決定する。
- さらに確率 `ε = 0.05` で `factor = 1` を強制し、完全に揃う日も混ぜる。
- 適用した `factor` を `dueAtFuzzed` に保持し、次の interval 計算時に逆算できるようにする。
- ※ 今後、週未満のレビューにも弱い Fuzz（±2% など）を段階的に導入して負荷平準化を図る余地がある。

### 5.4 キュー優先度

1. `LEARNING/RELEARNING` で `dueAt <= now`
2. `REVIEW` で `dueAt <= now`
3. `TARGETED_REPAIR`（混同補修）
4. `NEW`

`TARGETED_REPAIR` は混同スコア上位ペアを参照し、以下の問題を抽出:
- 誤選択肢が正解となる問題
- 正解選択肢と誤選択肢が同時に選択肢に並ぶ問題

抽出比率の初期値: `REVIEW : REPAIR : NEW = 6 : 3 : 1`。`REVIEW` の未消化が多い（例: due が 80 以上）場合は NEW を 0 に抑制。
同一混同ペアは 1 セッションで最大 2 回まで投入し、投入時に `conf *= 0.9` してヒステリシスを持たせる。

> **pattern 単位のモード管理**  
> モードは「どの pattern が出題対象か」を定義する。`StudyEngine` はモードに紐づく pattern セットを先に算出し、`schedule` から due を取得する際も `patternId` でフィルタする。これにより、`RELEARNING` や `REVIEW` の出題は同一 pattern 内に閉じた形で維持され、別モードで共有されている問題でも pattern を跨いだ復習が起こらない。

### 5.5 遅延リトライ

誤答を出した同一問題は、「次の 3〜7 問後」に再投入する。`SessionCore` で短期バッファを持ち、指定間隔まで再出題しない。バッファに積まれた問題は `questions` ストアのスナップショットから再取得し、`StudyEngine` に再抽選させずに即座に返す。これにより、既に `seenQuestionKeys` に入っている問題でも確実に再出題でき、無限ループや長時間のリトライ待ちを防ぐ。

### 5.6 終了条件

セッション設定で下記から選択:
- `questionCount`: 出題数で終了
- `durationMs`: タイムアップ
- `drainDue`: `LEARNING/RELEARNING/REVIEW` で `dueAt <= now` が空になるまで

### 5.7 4択＋「分からない」ボタンでの評価

UI では 4 つの選択肢と `I don't know`（IDK）ボタンを並列に表示し、入力を次表の 5 区分へマッピングする。IDK を押した際は任意で「最も近いと思った選択肢」を追加で選んでもらい、評価には影響させず `idkNearest*` として保存して confusion 推定の補助に使う。

| 入力                             | 判定カテゴリ   | スケジュール反映                                           |
|----------------------------------|----------------|------------------------------------------------------------|
| 正解かつ回答時間が速い           | Strong Correct | `interval *= ease`、`ease += 0.02`                         |
| 正解だが遅い／混同スコアが高い   | Weak Correct   | `interval *= max(1.2, 0.7*ease)`、`ease -= 0.02`          |
| 選択肢を誤った                   | Wrong          | `interval = max(60, interval*0.2)`、`ease -= 0.08`、`state = RELEARNING`, `lapses++` |
| IDK を押した                     | IDK            | `interval = max(60, interval*0.35)`、`ease -= 0.04`、`state = RELEARNING`, `lapses` 変更なし |
| タイムアウト（時間超過で未回答） | Timeout        | Wrong と同じ扱い                                           |

- `streak < 2` の期間は Strong/Weak でも `interval = min(interval, 86400)` を上限とし、当てただけで伸びすぎるのを抑制。
- IDK では `confusion` を更新しないが、`concept_stats.uncertaintyEma = 0.9*ema + 0.1` を適用。Strong Correct 時は `ema *= 0.85`。
- IDK 後に「最も近い選択肢」を入力してもらうことで、分からない状態でも部分知識（概念の近さ）を記録でき、混同推定の質が上がる。

### 5.8 Uncertainty を用いた補助

- `concept_stats.uncertaintyEma >= 0.6` の概念は `TARGETED_REPAIR` の優先度を 1 段階引き上げる。
- 同閾値を超えた概念については、別問題を `REVIEW` キューに 2 件まで注入し早期に潰す。
- `uncertaintyEma < 0.4` まで低下したら優先度を通常に戻す。

## 6. テストモード仕様

- 出題は `questions` ストアからランダム抽出（同一セッション内の重複禁止）。
- セッション開始時に `seed` を生成し、再現性を確保。
- 学習用 `schedule` には触れず、`attempts` と `sessions` のみ更新。
- 層化抽選を行いたい場合は `tags` や `conceptId` で重み付けする拡張余地を残す。
- 結果表示では `overallAccuracy = correct/total`、`knownAccuracy = correct/(total-idk)`、`idkRate = idk/total` を併記して IDK の有無による解釈差を小さくする。

## 7. UI / アプリ連携

### 7.1 既存コードとの接続点

| 処理 | 既存関数 | 変更案 |
|------|----------|--------|
| セッション開始 | `startQuiz()` (`js/main.js:964`) | `SessionCore.start({ mode, config })` を呼び出し、返却された `sessionId` を保持 |
| 問題取得 | `loadNextQuestion()` (`js/main.js:1011`) | 現行の `engine.generateQuestion()` ではなく `SessionCore.nextQuestion()` を await |
| 回答処理 | `handleSelectOption()` (`js/main.js:1072`) | 正誤決定後に `SessionCore.submitAnswer()` を呼び出し、スケジュール/履歴を更新 |
| 終了処理 | `showResult()` 他 | `SessionCore.finish()` を呼び出し、`sessions` のサマリを確定 |

### 7.2 新規モジュール（例）

- `js/storage/db.js`: Dexie 初期化と Export/Import。
- `js/study-engine.js`: 学習モードの優先順位計算、混同補修ロジック。
- `js/test-engine.js`: テストモードのランダム抽選。
- `js/session-core.js`: UI とエンジンの橋渡し。

これらは ES Module として既存の `js/main.js` に読み込む。ビルドなしでも動くモジュール構成を維持する。

## 8. 混同補修 (confusion) 詳細

### 8.1 更新ルール（条件付き確率ベース）

- 該当概念 `c` の問題で誤概念 `w` が選択肢に **表示された**回数を `shownCount` とし、誤答で実際に `w` が選ばれた回数を `chosenCount` とする。
- IDK で「最も近い選択肢」として `w` が選ばれた場合は `idkNearCount++` する（部分知識の指標）。
- スコア（混同確率）は `p(c→w) = (chosenCount + idkNearCount*0.25 + a) / (shownCount + a + b)` で計算する。初期値例: `a = 1`, `b = 3`。
- 誤答時は `shownCount++`, `chosenCount++`。表示されただけなら `shownCount++` のみ。
- `scoreCache` を更新し、`p(c→w) >= 0.6` をしきい値に Targeted Repair 候補へ入れる。

### 8.2 適用方法

1. 強い混同ペア `(conceptA, conceptB)` を抽出。
2. `conceptB` が正解になる問題を優先キューへ挿入。
3. `conceptA` と `conceptB` が同時に選択肢に登場する問題を追加。
4. キュー投入後は `scoreCache *= 0.9`、`recentSessions++` し、過剰再出題を防止。
5. ディストラクタ抽出時に役割分担を使って `conceptB` を「出やすいが絶対ではない」確率で挿入する。

#### 8.2.1 ディストラクタ役割分担

- 誤選択肢スロットを 3 つに分ける。
  1. **Confusion枠**: `prob = clamp(0.15 + 0.7*p(c→w*), 0, 0.75)` で最頻混同 `w*` を挿入。クールダウン中 (`lastShownAt` が直近3問内) ならスキップ。
  2. **Coverage枠**: 最近出ていない概念からランダム選択（学習範囲を広げる）。
  3. **Random枠**: 完全ランダム。
- `distractorPool` が空の場合は variant の選択肢セットを同様のロジックで選ぶ。

#### 8.2.2 混同ペア上限とヒステリシス

- 同一混同ペアを補修キューに入れるのは 1 セッション最大 2 回。
- 補修投入時に `recentSessions++`、セッション終了時に `recentSessions *= 0.8`。
- `recentSessions >= 2` のペアは次セッションまで補修候補から除外する。

## 9. Import / Export

- Dexie の Export/Import アドオンを利用し、`Blob` で丸ごとダンプする。
- オプションで Web Crypto API (`SubtleCrypto.encrypt`) による AES-GCM 暗号化を提供。
- Export/Import のメタ情報は `app_meta` に `lastExportAt`, `lastImportAt` として記録。

## 10. 実装フェーズ提案

1. **Phase 1** – IndexedDB 基盤と `questions/schedule/attempts` を導入し、学習モードの基本 SRS を実装。
2. **Phase 2** – `sessions` と `test-engine` を追加し、テストモードを既存 UI と統合。
3. **Phase 3** – `confusion` ストアと Targeted Repair を導入、Weak/Strong 判定ロジックを `handleSelectOption()` に組み込む。
4. **Phase 4** – Import/Export UI、複数ユーザー UI、暗号化オプション、advanced analytics を追加。

各フェーズで `js/main.js` の既存ハンドラにフックを追加することで、段階的に移行できる。

---

この仕様を基に、学習効率を高める出題戦略と永続化ファウンデーションを段階的に実装できる。
