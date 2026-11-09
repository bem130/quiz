# TypeScript／Web 化の受け入れ監査

## 基準と証拠の扱い

更新日: 2026-11-10（JST）。正本は [親 Issue #38](https://github.com/bem130/quiz/issues/38) と子 Issue #39〜#78、#80 である。2026-11-09の初回監査はPR #81の実装とテスト定義を照合した。その後の修正・旧実装撤去・OGP準備・公開後のPWA修正を含む公開SHA `54491c85ad0b14e0091053a3d2a6ef0c093b30b1` の証拠へ更新した。

表の「根拠あり」は実装と検証定義の存在を表す。公開版のCI・配信・公開ブラウザの実績は次節に分けて記録する。これらを実機確認の代替にしない。初期基盤から旧テスト撤去まで検査集合が変わっているため、過去のunit件数との大小で検証範囲を判断しない。旧37テストの代替は [変換棚卸し](typescript-web-plan.md) を参照する。

基準 SHA `4453c61` の既存37テスト、fake-indexeddb、模擬Cache Storage、合成compositionイベント、desktop WebKitは別の証拠である。公開CORSとPHP/GDはそれぞれ次節の環境で検証した。iOS Safari、Android Chrome、実IME、画面キーボード、読み上げとbem130.comの配備確認は未完了である。

新サイトは新規データで開始する。#69はユーザー指示により対応しないとして終了した。旧データ・旧ID・旧バックアップ・旧共有URLの変換・救済と、旧サイトへの退避機能の配信は対象外である。M0〜M3と #70/#78は完了。M4では #71/#72 と親 #38 をopenで維持する。

## 初回受け入れ済み版の検証記録

この節はSHA `54491c85` の記録である。後続の公開SHAと個別共有ページの検証は #78/#71 に追記し、初回の証拠を書き換えない。

| 対象 | 環境・結果・追跡先 |
| --- | --- |
| 修正CI | head `77b2333144c70c3e0ab87d65a1d4a91dde6ff0d8` の [run42642767277](https://github.com/bem130/quiz/actions/runs/42642767277)。locked clean install、UTF-8/source監査、型・lint・unit137件・build、通常ブラウザ198件、PWA30件、独立PHP 8.3/GDの5件が成功。 |
| Pages配信 | merge SHA `54491c85ad0b14e0091053a3d2a6ef0c093b30b1` の [run42644286243](https://github.com/bem130/quiz/actions/runs/42644286243)。同じdistのunit137件・通常ブラウザ198件・PWA30件を通過して配信。公開先は https://bem130.github.io/quiz/ 、versionは `source-3012db61c02e061112d3dbdb`。 |
| artifactと実配信 | 公開82ファイルのSHA-256とMIMEがartifactと一致。precache79参照が全てartifactに存在し、size/hashも一致。artifact.tarのSHA-256は `f9687e3d5553dc49aac494343bb2ed805b2d17e0f545b174d7b2ef35c35ca38c`。詳細は [#78](https://github.com/bem130/quiz/issues/78)。 |
| 公開PWA・保存 | 上記公開URLを直接使うdesktop Chromium／Firefox／WebKitでnative worker制御、SVG／RDKit SMILES、回答・標準入力の草稿保存、実browser再起動、offline起動・編集・出題・回答保存・再保存後の再起動保持が成功。草稿revision更新でその草稿の旧回答を無効化し、他題庫の回答を保持することも確認。予期しないpage errorと外部runtime依存は0。 |
| 公開CORS | 同じ公開版の3ブラウザで、raw GitHubのentry／JSON／SVG実GET、既存httpbinのGET応答をentryとする2題庫追加、SVG3選択肢、回答保存、失敗後の題庫・選択保持を確認。302→200のtransport redirectは題庫schema正例と分けて確認。HTTP200/no-ACAO拒否時のWebKit診断3件は対象URL・拒否phase・requestfailedと照合し、予期しないエラーは0。詳細は [#70](https://github.com/bem130/quiz/issues/70)。 |

初回公開SHA `7cba49f` は、Pages artifactから除外された `.vite/manifest.json` がprecacheに残り、worker installが失敗した。[PR #84](https://github.com/bem130/quiz/pull/84) で不要なVite manifest生成を停止し、隠し出力をbuildで拒否する回帰を追加した。初回版は受け入れ不合格でありrollback候補にしない。上表の修正版を既知の正常版とする。

公開ブラウザの補助証拠はローカルの `tmp/pages-fixed-assets-receipt.json`、`tmp/pages-smoke-bEXZxY/report.json`、`tmp/pages-cors-summary-54491c8.json` に保持する。これらはGit管理外であり、clean cloneへ同梱される成果物ではない。CI・公開runとIssueの記録を共有可能な正本とし、途中の失敗結果と最終合格を区別する。

## 検査の再実行と環境

| 検査 | コマンド・設定 | 保証範囲 |
| --- | --- | --- |
| 型・静的検査 | `npm run typecheck`、`npm run lint`、[tsconfig](../tsconfig.json)、[core](../tsconfig.core.json)、[worker](../tsconfig.worker.json)、[ESLint](../eslint.config.mjs) | アプリ・純粋 core・worker の型境界。実ブラウザ挙動は別検証。 |
| unit・保存・build | `npm test`、[tests/core](../tests/core)、[型誤用テスト](../tests/types/katex-parser.test-d.ts) | 純粋遷移、schema、キー、模擬 DB の保存競合と復元、静的成果物。 |
| ブラウザ | `npm run test:e2e`、[設定](../playwright.config.ts) | Chromium／Firefox／WebKit の DOM、native IndexedDB、RDKit、Monaco。一部の通信・失敗・時刻・clipboard は制御する。 |
| 本番 PWA | `npm run build`、`npm run test:pwa`、[設定](../playwright.pwa.config.ts) | 実 HTTP 配信と Service Worker install／update、offline。公開ドメインの挙動は別検証。 |
| CI・公開 | [check.yml](../.github/workflows/check.yml)、[pages.yml](../.github/workflows/pages.yml)、[配信契約](deployment.md) | 検証専用 CI と main の手動公開を分離する。workflow の存在は実行済み証拠ではない。 |

公開版のPWA30件は10ケース×3ブラウザである。更新回帰はcompiled appの版・hashed entry名を更新し、全hashと本物のworkerを再生成するfixtureを使う。独立した二つのrelease commitの実配信比較ではない。公開版の実GET・native worker・offline・保存・再起動は上表の別証拠である。

## M0: 設計・検査基盤

| Issue・要件 | 実装とテストの根拠 | 判定・残件 |
| --- | --- | --- |
| #73 strict、固定依存、最小 CI | [package](../package.json)、[lockfile](../package-lock.json)、[katex-parser](../src/core/katex-parser.ts)、[unit](../tests/core/katex-parser.test.ts)、[型誤用](../tests/types/katex-parser.test-d.ts)、[計画](typescript-web-plan.md) | GitHub 上で完了。全体変換と実機は別ゲート。 |
| #74 型・状態・ID・Option／Result・DTO | [result](../src/core/result.ts)、[model](../src/core/model.ts)、[identity](../src/core/identity.ts)、[records](../src/core/records.ts)、[session](../src/core/session.ts)、[規範契約](domain-contract.md)、[identity unit](../tests/core/model-identity.test.ts) | UserId／SessionId／Revisionも役割別brandへ補強し、実行時guardと型誤用検査を追加。公開版の全型・unit・browser CIに含めて成功。 |
| #75 純粋本体と副作用、遅い結果の隔離 | [session](../src/core/session.ts)、[study](../src/core/study.ts)、[application](../src/web/application.ts)、[content](../src/web/content.ts)、[session unit](../tests/core/session.test.ts)、[application E2E](../tests/e2e/application.spec.ts) | 固定した session と生成番号で非同期結果を照合する根拠あり。全体監査は #67／#72。 |
| #76 unknown 検証、保存形式、変換計画・CLI | [schema](../src/core/schema.ts)、[保存検証](../src/web/storage/validation.ts)、[network](../src/web/network.ts)、[schema unit](../tests/core/model-schema.test.ts)、[CLI](../scripts/cli.ts)、[計画](typescript-web-plan.md) | unknown入力境界、保存形式、CLIを実装。規範契約第7節にZod／Valibotの公式比較・サイズの限界・手実装の欠点と再評価条件を記録。全変換は #67。 |

## M1: データ保全・保存整合性

| Issue・要件 | 実装とテストの根拠 | 判定・残件 |
| --- | --- | --- |
| #39 固定回答文脈と保存中操作 | [session](../src/core/session.ts)、[application](../src/web/application.ts)、[session unit](../tests/core/session.test.ts)「保存待ち」、[application E2E](../tests/e2e/application.spec.ts)「保存待ちの連打」「回答保存失敗」 | 根拠あり。保存中の Next／中断を拒否し、問題・ユーザー・session・操作 ID を固定。 |
| #40 草稿切替・閉じる・移動・削除 | [editor](../src/web/editor.ts)、[database](../src/web/storage/database.ts)、[editor E2E](../tests/e2e/editor.spec.ts)「A→B」「保存失敗」「フォルダ」「別タブ」、[version unit](../tests/core/storage-draft-version.test.ts) | 根拠あり。harness は実 Monaco と DB を使うが遅延・失敗は制御する。 |
| #41 可逆キーと復習更新 | [identity](../src/core/identity.ts)、[study](../src/core/study.ts)、[database](../src/web/storage/database.ts)、[identity unit](../tests/core/model-identity.test.ts)、[storage unit](../tests/core/storage.test.ts)「回答・調度・統計」 | 根拠あり。ID を独立項目に持ち、旧区切りキーを分解しない。 |
| #44 完全出典と revision | [network](../src/web/network.ts)、[identity](../src/core/identity.ts)、[application](../src/web/application.ts) loadEntry、[identity unit](../tests/core/model-identity.test.ts)「完全出典URL」 | 根拠あり。redirect 後の完全 URL と canonical v3 JSON を使用。実外部配信は #70。 |
| #45 検証成功後の更新 | [application](../src/web/application.ts) loadEntry、[database](../src/web/storage/database.ts) replacePackage、[storage unit](../tests/core/storage.test.ts)「無効な題庫更新」「遅れて届いた旧題庫」 | 無効な入力で履歴を削除しない根拠あり。 |
| #46 完全 backup と復元 UI | [types](../src/web/storage/types.ts)、[保存検証](../src/web/storage/validation.ts)、[database](../src/web/storage/database.ts)、[application](../src/web/application.ts)、[storage unit](../tests/core/storage.test.ts)「全データ」「容量エラー」「別タブ」、[application E2E](../tests/e2e/application.spec.ts)「完全backup」「SVG資産」 | 単一の新規 DB の allowlist store を transaction で置換。草稿・ユーザー・履歴・設定・entry・取得済み SVG を含む根拠あり。容量不足は模擬注入であり、実機の容量枯渇は未検証。 |
| #49 題庫ごとの概念スコープ | [identity](../src/core/identity.ts)、[quiz-engine](../src/core/quiz-engine.ts)、[保存検証](../src/web/storage/validation.ts)、[identity unit](../tests/core/model-identity.test.ts) | PackageId を含め、別題庫で暗黙共有しない根拠あり。 |
| #50 session／attempt の参照整合性 | [database](../src/web/storage/database.ts)、[保存検証](../src/web/storage/validation.ts)、[storage unit](../tests/core/storage.test.ts)「無効な題庫更新」「sessionの初期入力」 | 更新対象題庫のattempt／schedule／統計を除去し、残る回答でsession集計を再計算する。replayの初期snapshotは保持。後続storage-scope.test.tsの2題庫混合sessionで一方更新／削除時の他方レコード完全保持と全削除を検証。 |
| #52 ユーザー ID と削除 | [application](../src/web/application.ts)、[database](../src/web/storage/database.ts) deleteUser、[storage unit](../tests/core/storage.test.ts)「ユーザー削除」、[application E2E](../tests/e2e/application.spec.ts)「同名ユーザー」 | UUID を新規発行し、関連記録を同一 transaction で削除する根拠あり。復元は全体置換。 |
| #60 起動失敗と再試行 | [application](../src/web/application.ts) boot、[database](../src/web/storage/database.ts) openQuizStorage、[application E2E](../tests/e2e/application.spec.ts)「保存領域初期化」、[storage unit](../tests/core/storage.test.ts)「API不存在」 | データを自動削除せずエラーと再試行を表示する根拠あり。 |
| #77 原子的・冪等な回答保存 | [session](../src/core/session.ts)、[database](../src/web/storage/database.ts) commitAnswer、[storage unit](../tests/core/storage.test.ts)「再送」「競合」「session終了」、[application E2E](../tests/e2e/application.spec.ts)「同じ操作IDで再試行」 | transaction complete が成功基準となる根拠あり。失敗・容量不足の模擬注入と native transaction の証拠を区別する。 |

## M2: 出題・学習・編集

| Issue・要件 | 実装とテストの根拠 | 判定・残件 |
| --- | --- | --- |
| #42 許可 pattern 範囲 | [session](../src/core/session.ts)、[session unit](../tests/core/session.test.ts)「選択pattern範囲」「期限に達した復習」、[storage unit](../tests/core/storage.test.ts)「session候補範囲外」 | 根拠あり。旧問題 snapshot キャッシュからの出題は廃止。UI は pattern 集合を選び、旧 mode の重み設定は保持しない。 |
| #43 枯渇・due 待ち・終了条件 | [session](../src/core/session.ts)、[application](../src/web/application.ts)、[session unit](../tests/core/session.test.ts)「due」「drain」「時間切れ」、[application E2E](../tests/e2e/application.spec.ts)「少数題庫」、[study E2E](../tests/e2e/study.spec.ts)「時間指定」「dueまで待ち」 | waiting／exhausted／drained／time／targetを区別。時間切れ・due待ちUIの専用回帰も公開版の全browser CIで成功。 |
| #47 テスト重複禁止 | [session](../src/core/session.ts)、[session unit](../tests/core/session.test.ts)「既出を返さず枯渇」、[application E2E](../tests/e2e/application.spec.ts)「clean起動」 | 根拠あり。既出 fallback を廃止。 |
| #48 再学習と全状態遷移 | [study](../src/core/study.ts)、[規範契約](domain-contract.md)、[study unit](../tests/core/study.test.ts)「短期学習と再学習」「全状態×全回答」「Weak」 | 純粋遷移の全組合せと境界値を検証する根拠あり。 |
| #51 新 session での再挑戦 | [session](../src/core/session.ts)、[application](../src/web/application.ts)、[session unit](../tests/core/session.test.ts)「再挑戦」、[application E2E](../tests/e2e/application.spec.ts)「新規再挑戦」「遅い旧結果」、[study E2E](../tests/e2e/study.spec.ts)「学習の間違い再挑戦」 | テストと学習の再挑戦を新sessionで開始し、元sessionと遅い旧結果から隔離する回帰が公開版の全browser CIで成功。 |
| #53 厳密 JSON と編集診断 | [schema](../src/core/schema.ts)、[editor](../src/web/editor.ts)、[schema unit](../tests/core/model-schema.test.ts)「数値・制御文字」、[editor E2E](../tests/e2e/editor.spec.ts)「JSON/schema」「sourceクリック」 | 不正 JSON の草稿保存と出題可能判定を区別する根拠あり。 |
| #54 重複 ID 拒否 | [schema](../src/core/schema.ts)、[schema unit](../tests/core/model-schema.test.ts)「重複する行・pattern・tip」 | 場所付き診断の根拠あり。pattern ID は明示必須。 |
| #55 容量と出題可能性 | [quiz-engine](../src/core/quiz-engine.ts)、[engine unit](../tests/core/quiz-engine.test.ts)「容量」「同じ表示」「listkey」「oracle」、[editor](../src/web/editor.ts) テンプレート | 誤答ゼロは不可、2〜4 択、正答集合・group 制約を共有する根拠あり。 |
| #56 更新時の容量再計算 | [application](../src/web/application.ts) readData／refreshData、[database](../src/web/storage/database.ts)、[quiz-engine](../src/core/quiz-engine.ts) prepareQuiz、[study E2E](../tests/e2e/study.spec.ts)「同URLの容量増減」 | 永続的な容量キャッシュを廃止し、現在revisionから再構築。同URLの容量増減・不正schema・取得失敗・有効版保持・回復の専用回帰が公開版の全browser CIで成功。 |
| #57 単一 decode | [application](../src/web/application.ts)、[network](../src/web/network.ts)、[application E2E](../tests/e2e/application.spec.ts)「entry URLのpercent」 | URLSearchParams と URL へ責務を限定する根拠あり。公開 redirect／CORS は #70。 |
| #58 同入力の再現性 | [random](../src/core/random.ts)、[session](../src/core/session.ts)、[records](../src/core/records.ts)、[random unit](../tests/core/random.test.ts)、[session unit](../tests/core/session.test.ts)「同じseed」「replay」、[replay unit](../tests/core/storage-replay.test.ts) | 候補順・revision・初期統計・設定も保存する根拠あり。グローバル乱数差し替えなし。 |
| #59 全候補からの誤答・補修 | [quiz-engine](../src/core/quiz-engine.ts)、[session](../src/core/session.ts)、[engine unit](../tests/core/quiz-engine.test.ts)「全pool」、[session unit](../tests/core/session.test.ts)「混同補修」「無関係な不確実度」 | 混同優先・coverage・random、同義正解・同 group 除外の根拠あり。 |

## M3: 静的配信・PWA・図

| Issue・要件 | 実装とテストの根拠 | 判定・残件 |
| --- | --- | --- |
| #61 必須資産と offline | [build-assets](../scripts/build-assets.ts)、[worker](../src/service-worker.ts)、[build unit](../tests/core/build-assets.test.ts)、[PWA E2E](../tests/e2e/pwa.spec.ts)「本番build」 | 同梱fonts／WASM／workerと、完全offlineの草稿編集→保存→browserプロセス再起動→出題→回答保存を公開版CIと公開Pagesのpersistent profileで検証済み。 |
| #62 欠損・HTML fallback | [build-assets](../scripts/build-assets.ts)、[worker](../src/service-worker.ts)、[build unit](../tests/core/build-assets.test.ts)、[worker unit](../tests/core/service-worker.test.ts)「hash」「HTML」 | buildで存在・size・SHA-256を確定し、Pagesで除外される隠し出力を拒否。workerは実応答MIME・size・hashを検査する。誤MIME拒否・旧版/DB保持・再試行回復のCIと、修正版公開79参照/82fileの実照合・install成功を確認済み。 |
| #63 再起動後のデータ分類 | [worker](../src/service-worker.ts)、[worker unit](../tests/core/service-worker.test.ts)「拡張子なし」「再起動」、[application E2E](../tests/e2e/application.spec.ts)「SVG資産」 | メモリ登録 URL に依存しない bounded cache の根拠あり。再起動 unit は新 harness による検証、実公開 CORS は別途。 |
| #64 更新 metadata・waiting・明示適用 | [worker](../src/service-worker.ts)、[application](../src/web/application.ts)、[worker unit](../tests/core/service-worker.test.ts)、[PWA E2E](../tests/e2e/pwa.spec.ts)「旧版から新版」 | 回答保存中・dirty草稿・複数tab・旧hashedasset保持、install/register/MIME失敗、旧lazyhash欠落とmanualreload復旧をnative workerで検証し、公開版の全PWA CIが成功。実機の更新操作は #72 に残す。 |
| #65 hash と版統一 | [vite.config](../vite.config.ts)、[build-assets](../scripts/build-assets.ts)、[worker](../src/service-worker.ts)、[build unit](../tests/core/build-assets.test.ts)「同一version」、[PWA E2E](../tests/e2e/pwa.spec.ts) | 決定的versionとhashedmoduleの一致、改変assetのinstall拒否、旧tabと新workerの共存、欠落後の明示reload復旧を検証。公開先での更新確認は別に行う。 |
| #66 静的 entry と同梱題庫 | [entry](../public/entry.json)、[build-assets](../scripts/build-assets.ts)、[サンプル](../data/sample)、[build unit](../tests/core/build-assets.test.ts)、[application E2E](../tests/e2e/application.spec.ts) | 3サンプル・5pattern、schema・参照先・unsafe path・SVG copyを検証。公開 `/quiz/` の3browserで読込・SVG表示・出題・保存も成功。 |
| #67 静的正本・全 TS・重複撤去 | [index](../index.html)、[main](../src/main.ts)、[vite](../vite.config.ts)、[manifest](../public/manifest.webmanifest)、[worker](../src/service-worker.ts)、[build unit](../tests/core/build-assets.test.ts) | 旧35moduleを含む56ファイルを撤去。UTF-8・旧正本残存・型検査を迂回する手書きappのsource監査が公開版CIで成功。最終対応表と旧37テストの代替を記録済み。 |
| #68 clean install・CI・手動配信 | [package](../package.json)、[check](../.github/workflows/check.yml)、[Pages](../.github/workflows/pages.yml)、[配信契約](deployment.md)、[build unit](../tests/core/build-assets.test.ts) | 公開版のlocked clean install・全CIと手動Pages build/deployが成功。公開artifactとprecacheの全参照を実配信へ照合した。 |
| #80 SVG subset・SMILES・保存と図配置 | [model](../src/core/model.ts)、[schema](../src/core/schema.ts)、[svg](../src/web/svg.ts)、[content](../src/web/content.ts)、[editor](../src/web/editor.ts)、[SVG 契約](svg-subset.md)、[SVG E2E](../tests/e2e/svg.spec.ts)、[editor E2E](../tests/e2e/editor.spec.ts)、[application E2E](../tests/e2e/application.spec.ts)「SVG資産」 | 悪意 XML・参照増幅・geometry／gradient／clip・ID 分離、実 RDKit、狭幅／文字拡大、backup 復元後の再検証の根拠あり。role=img と alt は実機読み上げの代替ではない。 |

## M4: 公開条件と除外範囲

| Issue・要件 | 実装とテストの根拠 | 判定・残件 |
| --- | --- | --- |
| #69 旧データ移行 | [計画](typescript-web-plan.md)、[規範](domain-contract.md) | 対応しないとして終了。新サイトの schema upgrade／backup は #46。 |
| #70 外部 CORS・redirect・MIME | [network](../src/web/network.ts)、[application](../src/web/application.ts)、[network E2E](../tests/e2e/network.spec.ts)、[shared scope E2E](../tests/e2e/shared-scope.spec.ts) | 実HTTPの許可/拒否/redirectと共有範囲をCIで検証。公開Pages originでも外部2題庫・SVG・保存・失敗後の保持とtransport redirectを全3browserで確認し、#70を完了。 |
| #71 OGP と両 host の範囲 | [ogp-card.php](../ogp-card.php)、[PHP unit](../tests/ogp/unit.php)、[OGP test](../tests/ogp/ogp.test.mjs)、[index](../index.html) | PHP専用bundle・固定Regular font/OFL・metadata・手順を用意し、ローカル生PHP/GDの5テストと画像目視が成功。bem130.com更新はユーザー主導。live確認は独立追跡しアプリ公開を待たせない。 |
| #72 全体受け入れ | [application](../tests/e2e/application.spec.ts)、[editor](../tests/e2e/editor.spec.ts)、[native editor](../tests/e2e/editor-native.spec.ts)、[svg](../tests/e2e/svg.spec.ts)、[PWA](../tests/e2e/pwa.spec.ts)、[実機手順](mobile-acceptance.md) | 通常198件・PWA30件と公開3browser検証が成功。共有範囲・標準入力・Monaco初期化も含む。実機・実IME・画面キーボード・touch・読み上げは未確認のためopenを維持する。 |
| #78 本番公開 | [Pages](../.github/workflows/pages.yml)、[配信契約](deployment.md)、本書 | 公開SHA `54491c85` と公開後検証を記録して完了。実機は #72、ユーザー主導のOGP配備/live確認は #71 に残す。 |

## 公開後の残件

ソフトウェア検証とPages公開・公開originの確認は上表のSHAで完了した。#74の型補強、#76のvalidator比較、dirty更新・install失敗・旧asset欠落・native DB upgrade・時間切れ・due待ち・学習再挑戦・容量変更と回復の回帰も同じCIへ含めた。

- #72: 公開PagesでiOS Safari／Android Chrome、touch、画面キーボード、実IME、フォーカス、読み上げ、OS中断・復帰、QR、端末上のbackup／復元を確認する。[実機手順](mobile-acceptance.md) の端末別結果表へ記録する。待機版の確認は次の通常更新時に行い、待機版がなければ未実施とする。別の実機用URLや確認専用リリースは設けない。
- #71: 同梱題庫ごとの静的OGP HTMLと共有導線を追加し、公開先で確認する。bem130.comの配備と、その後の公開PHP/PNG/日本語画像確認はユーザー主導で進める。Pagesのソフトウェア検証やローカルPHP/GD成功で実配備済みとはしない。
- #38: 上記結果が揃うまで親計画の全体完了を保留する。

本番rollbackは実行していない。[配信手順](deployment.md) と既知の正常版を準備したことを、rollback実施の証拠に置き換えない。残件を解消したら、対象SHA、環境、操作、期待結果と実結果を追記する。

## 監査後の #74 修正

基準 SHA の監査で見つかった UserId／SessionId／Revision の不足を後続変更で補った。[identity](../src/core/identity.ts) に役割別 brand と非空 UserId／SessionId の constructor／guard、[schema](../src/core/schema.ts) に strict schema と canonical v3 JSON の一致を確認する Revision constructor／guard を追加した。UUID 形式や表示名の形式を新たな必須条件にはしない。

[records](../src/core/records.ts)、[session](../src/core/session.ts)、[study](../src/core/study.ts)、[quiz-engine](../src/core/quiz-engine.ts)、[保存境界](../src/web/storage/validation.ts) へ適用した。[domain 型誤用検査](../tests/types/domain-contract.test-d.ts) は ID の取り違え、未検証の文字列、readonly 正本の変更、DOM の保存 DTO への混入、null による内部欠損を拒否する。[identity unit](../tests/core/model-identity.test.ts) と [schema unit](../tests/core/model-schema.test.ts) は空 ID、非 canonical・不正 schema の revision を実行時に拒否する。

この後続変更も公開版の全型検査・lint・unit137件・通常browser198件・PWA30件へ含め、上表のCIと公開後検証で確認した。初期の担当検証と最終統合結果を別記録として保持する。
