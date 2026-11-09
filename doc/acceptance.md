# TypeScript／Web 化の受け入れ監査

## 基準と証拠の扱い

監査日: 2026-11-09。正本は [親 Issue #38](https://github.com/bem130/quiz/issues/38) と子 Issue #39〜#78、#80 である。#79 は初期開発基盤の PR である。各 Issue 本文を取得し、[PR #81](https://github.com/bem130/quiz/pull/81) の head `58793f4c0c706847c50f4d07e405fbbf4ea677b4` を基準に、作業ツリーの実装とテスト定義を照合した。並行作業中の旧実装撤去、OGP 対応、追加受け入れ検証は統合後の SHA で再確認する。

表の「根拠あり」は実装と検証定義の存在を表す。全チェック完了、同一 SHA の CI 成功、本番配信、実機確認を意味しない。本監査は全テストの再実行ではない。PR #81はmerge commit `58e6b2a1cca65096659259129f22e4f085007b92`でmainへ統合済み。検証head `429f241a51c27cf75dbb1b96c6ed8349998f85d7`のLinux CIはunit157件・通常ブラウザ114件・PWA6件と型・lint・buildが成功した。後続変更の最終SHAでは改めて全体を実行する。

基準 SHA `4453c61` の既存 37 テスト、fake-indexeddb、模擬 Cache Storage、合成 composition イベント、desktop WebKit は別の証拠である。iOS Safari、Android Chrome、OS の日本語 IME、画面キーボード、読み上げ、PHP/GD、公開先の CORS を確認済みと解釈しない。

新サイトは新規データで開始する。#69 はユーザー指示により対応しないとして終了した。旧データ・旧 ID・旧バックアップ・旧共有 URL の変換・救済と、旧サイトへの退避機能の配信は対象外である。#73 は GitHub 上で完了済み、残る Issue の close とチェック更新は統合担当が行う。

## 検査の再実行と環境

| 検査 | コマンド・設定 | 保証範囲 |
| --- | --- | --- |
| 型・静的検査 | `npm run typecheck`、`npm run lint`、[tsconfig](../tsconfig.json)、[core](../tsconfig.core.json)、[worker](../tsconfig.worker.json)、[ESLint](../eslint.config.mjs) | アプリ・純粋 core・worker の型境界。実ブラウザ挙動は別検証。 |
| unit・保存・build | `npm test`、[tests/core](../tests/core)、[型誤用テスト](../tests/types/katex-parser.test-d.ts) | 純粋遷移、schema、キー、模擬 DB の保存競合と復元、静的成果物。 |
| ブラウザ | `npm run test:e2e`、[設定](../playwright.config.ts) | Chromium／Firefox／WebKit の DOM、native IndexedDB、RDKit、Monaco。一部の通信・失敗・時刻・clipboard は制御する。 |
| 本番 PWA | `npm run build`、`npm run test:pwa`、[設定](../playwright.pwa.config.ts) | 実 HTTP 配信と Service Worker install／update、offline。公開ドメインの挙動は別検証。 |
| CI・公開 | [check.yml](../.github/workflows/check.yml)、[pages.yml](../.github/workflows/pages.yml)、[配信契約](deployment.md) | 検証専用 CI と main の手動公開を分離する。workflow の存在は実行済み証拠ではない。 |

担当検証では、PWA 6 ケースが 3 ブラウザで成功した。対象は `source-0e50974bdbaa5e43a1f0d6c6` の build と、compiled app の版・hashed entry 名を更新して全 hash と本物の worker を再生成した fixture である。独立した二つの release commit の実配信比較ではない。後続の core・Monaco・OGP・撤去変更を含む最終 build では再実行する。

## M0: 設計・検査基盤

| Issue・要件 | 実装とテストの根拠 | 判定・残件 |
| --- | --- | --- |
| #73 strict、固定依存、最小 CI | [package](../package.json)、[lockfile](../package-lock.json)、[katex-parser](../src/core/katex-parser.ts)、[unit](../tests/core/katex-parser.test.ts)、[型誤用](../tests/types/katex-parser.test-d.ts)、[計画](typescript-web-plan.md) | GitHub 上で完了。全体変換と実機は別ゲート。 |
| #74 型・状態・ID・Option／Result・DTO | [result](../src/core/result.ts)、[model](../src/core/model.ts)、[identity](../src/core/identity.ts)、[records](../src/core/records.ts)、[session](../src/core/session.ts)、[規範契約](domain-contract.md)、[identity unit](../tests/core/model-identity.test.ts) | UserId／SessionId／Revisionも役割別brandへ補強し、実行時guardと型誤用12件を追加。担当unit71件・型・lint成功、後続統合CI待ち。 |
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
| #43 枯渇・due 待ち・終了条件 | [session](../src/core/session.ts)、[application](../src/web/application.ts)、[session unit](../tests/core/session.test.ts)「due」「drain」「時間切れ」、[application E2E](../tests/e2e/application.spec.ts)「少数題庫」 | waiting／exhausted／drained／time／target を区別する根拠あり。時間切れ・due 待ち UI の専用 browser case は不足。 |
| #47 テスト重複禁止 | [session](../src/core/session.ts)、[session unit](../tests/core/session.test.ts)「既出を返さず枯渇」、[application E2E](../tests/e2e/application.spec.ts)「clean起動」 | 根拠あり。既出 fallback を廃止。 |
| #48 再学習と全状態遷移 | [study](../src/core/study.ts)、[規範契約](domain-contract.md)、[study unit](../tests/core/study.test.ts)「短期学習と再学習」「全状態×全回答」「Weak」 | 純粋遷移の全組合せと境界値を検証する根拠あり。 |
| #51 新 session での再挑戦 | [session](../src/core/session.ts)、[application](../src/web/application.ts)、[session unit](../tests/core/session.test.ts)「再挑戦」、[application E2E](../tests/e2e/application.spec.ts)「新規再挑戦」「遅い旧結果」 | 根拠あり。UI E2E は主にテスト由来であり、学習由来の再挑戦も補完する。 |
| #53 厳密 JSON と編集診断 | [schema](../src/core/schema.ts)、[editor](../src/web/editor.ts)、[schema unit](../tests/core/model-schema.test.ts)「数値・制御文字」、[editor E2E](../tests/e2e/editor.spec.ts)「JSON/schema」「sourceクリック」 | 不正 JSON の草稿保存と出題可能判定を区別する根拠あり。 |
| #54 重複 ID 拒否 | [schema](../src/core/schema.ts)、[schema unit](../tests/core/model-schema.test.ts)「重複する行・pattern・tip」 | 場所付き診断の根拠あり。pattern ID は明示必須。 |
| #55 容量と出題可能性 | [quiz-engine](../src/core/quiz-engine.ts)、[engine unit](../tests/core/quiz-engine.test.ts)「容量」「同じ表示」「listkey」「oracle」、[editor](../src/web/editor.ts) テンプレート | 誤答ゼロは不可、2〜4 択、正答集合・group 制約を共有する根拠あり。 |
| #56 更新時の容量再計算 | [application](../src/web/application.ts) readData／refreshData、[database](../src/web/storage/database.ts)、[quiz-engine](../src/core/quiz-engine.ts) prepareQuiz | 永続的な容量キャッシュを廃止し、現在 revision から再構築。同 URL の一時失敗→回復、草稿変更による容量増減の専用 browser 回帰は不足。 |
| #57 単一 decode | [application](../src/web/application.ts)、[network](../src/web/network.ts)、[application E2E](../tests/e2e/application.spec.ts)「entry URLのpercent」 | URLSearchParams と URL へ責務を限定する根拠あり。公開 redirect／CORS は #70。 |
| #58 同入力の再現性 | [random](../src/core/random.ts)、[session](../src/core/session.ts)、[records](../src/core/records.ts)、[random unit](../tests/core/random.test.ts)、[session unit](../tests/core/session.test.ts)「同じseed」「replay」、[replay unit](../tests/core/storage-replay.test.ts) | 候補順・revision・初期統計・設定も保存する根拠あり。グローバル乱数差し替えなし。 |
| #59 全候補からの誤答・補修 | [quiz-engine](../src/core/quiz-engine.ts)、[session](../src/core/session.ts)、[engine unit](../tests/core/quiz-engine.test.ts)「全pool」、[session unit](../tests/core/session.test.ts)「混同補修」「無関係な不確実度」 | 混同優先・coverage・random、同義正解・同 group 除外の根拠あり。 |

## M3: 静的配信・PWA・図

| Issue・要件 | 実装とテストの根拠 | 判定・残件 |
| --- | --- | --- |
| #61 必須資産と offline | [build-assets](../scripts/build-assets.ts)、[worker](../src/service-worker.ts)、[build unit](../tests/core/build-assets.test.ts)、[PWA E2E](../tests/e2e/pwa.spec.ts)「本番build」 | 同梱fonts／WASM／worker、完全offlineで草稿編集→保存→browserプロセス再起動→出題→回答保存をpersistent profileで検証。後続統合SHAで再実行する。 |
| #62 欠損・HTML fallback | [build-assets](../scripts/build-assets.ts)、[worker](../src/service-worker.ts)、[build unit](../tests/core/build-assets.test.ts)、[worker unit](../tests/core/service-worker.test.ts)「hash」「HTML」 | 手動一覧を廃止し、buildで存在・size・SHA-256を確定する。worker installは実応答のMIME・size・hashを検査する。正しいJS本文＋text/htmlを拒否して旧版とDBを保持し、再試行で回復するPWA回帰を追加した。公開先のHTTP headerは配信後に確認する。 |
| #63 再起動後のデータ分類 | [worker](../src/service-worker.ts)、[worker unit](../tests/core/service-worker.test.ts)「拡張子なし」「再起動」、[application E2E](../tests/e2e/application.spec.ts)「SVG資産」 | メモリ登録 URL に依存しない bounded cache の根拠あり。再起動 unit は新 harness による検証、実公開 CORS は別途。 |
| #64 更新 metadata・waiting・明示適用 | [worker](../src/service-worker.ts)、[application](../src/web/application.ts)、[worker unit](../tests/core/service-worker.test.ts)、[PWA E2E](../tests/e2e/pwa.spec.ts)「旧版から新版」 | 回答保存中・dirty草稿・複数tab・旧hashedasset保持、install integrity失敗／sw404／旧lazyhash欠落とmanualreload復旧をnative workerで検証。後続統合CI待ち。 |
| #65 hash と版統一 | [vite.config](../vite.config.ts)、[build-assets](../scripts/build-assets.ts)、[worker](../src/service-worker.ts)、[build unit](../tests/core/build-assets.test.ts)「同一version」、[PWA E2E](../tests/e2e/pwa.spec.ts) | 決定的versionとhashedmoduleの一致、改変assetのinstall拒否、旧tabと新workerの共存、欠落後の明示reload復旧を検証。公開先での更新確認は別に行う。 |
| #66 静的 entry と同梱題庫 | [entry](../public/entry.json)、[build-assets](../scripts/build-assets.ts)、[サンプル](../data/sample)、[build unit](../tests/core/build-assets.test.ts)、[application E2E](../tests/e2e/application.spec.ts) | 3 サンプル・5 pattern、schema・参照先・unsafe path・SVG copy の根拠あり。公開 /quiz/ は未確認。 |
| #67 静的正本・全 TS・重複撤去 | [index](../index.html)、[main](../src/main.ts)、[vite](../vite.config.ts)、[manifest](../public/manifest.webmanifest)、[worker](../src/service-worker.ts)、[build unit](../tests/core/build-assets.test.ts) | 旧35moduleを含む56ファイルを撤去。scripts/check-sources.tsでUTF-8・旧正本残存・TypeScript検査を迂回する手書きappを機械監査。最終対応表と旧37テストの代替を記録。後続統合CI待ち。 |
| #68 clean install・CI・手動配信 | [package](../package.json)、[check](../.github/workflows/check.yml)、[Pages](../.github/workflows/pages.yml)、[配信契約](deployment.md)、[build unit](../tests/core/build-assets.test.ts) | 実装あり。最終 SHA の Linux CI と再現 build 結果を追記する。本番は #78。 |
| #80 SVG subset・SMILES・保存と図配置 | [model](../src/core/model.ts)、[schema](../src/core/schema.ts)、[svg](../src/web/svg.ts)、[content](../src/web/content.ts)、[editor](../src/web/editor.ts)、[SVG 契約](svg-subset.md)、[SVG E2E](../tests/e2e/svg.spec.ts)、[editor E2E](../tests/e2e/editor.spec.ts)、[application E2E](../tests/e2e/application.spec.ts)「SVG資産」 | 悪意 XML・参照増幅・geometry／gradient／clip・ID 分離、実 RDKit、狭幅／文字拡大、backup 復元後の再検証の根拠あり。role=img と alt は実機読み上げの代替ではない。 |

## M4: 公開条件と除外範囲

| Issue・要件 | 実装とテストの根拠 | 判定・残件 |
| --- | --- | --- |
| #69 旧データ移行 | [計画](typescript-web-plan.md)、[規範](domain-contract.md) | 対応しないとして終了。新サイトの schema upgrade／backup は #46。 |
| #70 外部 CORS・redirect・MIME | [network](../src/web/network.ts)、[application](../src/web/application.ts)、[application E2E](../tests/e2e/application.spec.ts)「外部entry共有」「外部entryが失敗」 | network.spec.tsの別origin実HTTPサーバーでredirect・entry／JSON CORS許可／拒否・HTML誤応答を3browser計12件検証。公開ドメインの応答は公開後に別記録。 |
| #71 OGP と両 host の範囲 | [ogp-card.php](../ogp-card.php)、[PHP unit](../tests/ogp/unit.php)、[OGP test](../tests/ogp/ogp.test.mjs)、[index](../index.html) | PHP専用bundle・固定Regular font/OFL・metadata・手順を用意し、ローカル生PHP/GDの5テストと画像目視が成功。bem130.com更新はユーザー主導。live確認は独立追跡しアプリ公開を待たせない。 |
| #72 全体受け入れ | [application](../tests/e2e/application.spec.ts)、[editor](../tests/e2e/editor.spec.ts)、[svg](../tests/e2e/svg.spec.ts)、[PWA](../tests/e2e/pwa.spec.ts)、[設定](../playwright.config.ts) | PWAはnative DB upgrade・install/register/MIME失敗・旧版保持を含む10ケース×3browserを定義。共有範囲7ケース×3browser、標準入力とMonaco初期化8ケース×3browserも統合対象とする。最終SHAの全体CIと公開先確認を別途記録し、実機・実IME・画面キーボード・読み上げはPages公開後に確認する。 |
| #78 本番公開 | [Pages](../.github/workflows/pages.yml)、[配信契約](deployment.md)、本書 | 本番未実施。OGPのユーザー更新は独立作業として公開の前提から外す。アプリ本体の検証条件を満たし次第、自主的に更新する。 |

## ソフトウェア検証・公開・公開後の残件

1. 最終 SHA の clean install、型・lint・全 unit・build・全 browser・PWA と公開資産一覧を記録する。旧実装撤去と OGP 統合後も同じ成果物を検証する。
2. #74の後続型修正と#76の公式validator比較を最終SHAの検査対象へ含める。比較の正本は規範契約第7節。
3. 完全offlineの草稿編集→保存→browser再起動→出題→回答保存は担当7ケースで検証済み。最終統合SHAでも実行し、未取得外部データの利用不可と併せて記録する。
4. dirty更新・install失敗・旧asset欠落・native DB upgrade・時間切れ・due待ち・学習再挑戦・容量変更／回復の専用browser回帰を実装し担当検証が成功。後続統合CIで同じsourceと成果物へ結び付ける。
5. ユーザー指示によりPagesを先に公開し、そのURLでiOS Safari／Android Chrome、touch、画面キーボード、実IME、フォーカス、読み上げを確認する。別の実機用URLは設けず、desktopや合成イベントで代替しない。
6. 実配信元一覧とPages originからのCORS／redirect／MIMEを確認する。bem130.comの更新とlive OGP確認はユーザー主導の#71で独立追跡し、アプリ公開を待たせない。
7. #72のソフトウェア検証後に #78 の手動公開を実行し、正規URL、初回起動、保存・再起動、offline、更新、rollbackを公開SHAに結び付ける。実機確認は公開後の #72、OGPはユーザー主導の #71 へ残す。

残件を解消したら、対象 SHA、環境、コマンドまたは操作、期待結果と実結果を追記する。未検証の行を一律に完了へ置き換えない。

## 監査後の #74 修正

基準 SHA の監査で見つかった UserId／SessionId／Revision の不足を後続変更で補った。[identity](../src/core/identity.ts) に役割別 brand と非空 UserId／SessionId の constructor／guard、[schema](../src/core/schema.ts) に strict schema と canonical v3 JSON の一致を確認する Revision constructor／guard を追加した。UUID 形式や表示名の形式を新たな必須条件にはしない。

[records](../src/core/records.ts)、[session](../src/core/session.ts)、[study](../src/core/study.ts)、[quiz-engine](../src/core/quiz-engine.ts)、[保存境界](../src/web/storage/validation.ts) へ適用した。[domain 型誤用検査](../tests/types/domain-contract.test-d.ts) は ID の取り違え、未検証の文字列、readonly 正本の変更、DOM の保存 DTO への混入、null による内部欠損を拒否する。[identity unit](../tests/core/model-identity.test.ts) と [schema unit](../tests/core/model-schema.test.ts) は空 ID、非 canonical・不正 schema の revision を実行時に拒否する。

この後続変更の担当検証は関連 unit 71 件成功。application／CLI の接続変更、最終 SHA の全型検査・lint・CI と実ブラウザの再確認を統合担当が記録する。
