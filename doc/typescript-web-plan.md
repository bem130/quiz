# TypeScript／Web 再構成計画

## 目的と対象範囲

アプリ本体を TypeScript／Web 限定で再構成し、`https://bem130.github.io/quiz/` で動作させる。OGP 画像生成の `https://bem130.com/quiz/ogp-card.php` は維持する。計画の正本は [親 Issue #38](https://github.com/bem130/quiz/issues/38) と各個別 Issue であり、本書は実装時の契約と変換対象を整理する。

旧サイトのデータ移行・救済は行わず、新サイトは新規データで開始する。旧 ID、旧バックアップ、旧共有 URL の互換維持、旧サイトへの退避ツール配信を対象に含めない。旧データ移行の [#69](https://github.com/bem130/quiz/issues/69) は対応しないとして終了した。新サイト自身の保存と将来のバックアップ・復元は [#46](https://github.com/bem130/quiz/issues/46) の対象である。

Rust 化、WASI、ネイティブアプリ、新しい実行プラットフォームへの対応は行わない。CLIは `scripts/cli.ts` へ再構成し、Webと同じschema・出題エンジンを確認する開発補助として維持する。別製品の実装へ範囲を広げない。

## 現在の変換範囲

`src/main.ts` は `src/web/application.ts` を起動し、旧 `js/main.js` を読み込まない。型検査は `allowJs: false` とし、アプリ・純粋core・workerの3環境を検査する。旧JSの一対一の拡張子変更ではなく、schema/identity/content、出題・学習・session、IndexedDB、DOM・通信・エディター・SVGへ責務をまとめ直した。

以下の「初期開発基盤」「段階移行中の検査範囲」は、PR #79時点の記録である。旧JS・PHPの重複ファイルと旧テストは撤去し、後述の最終対応表に統合先と回帰検証を記録する。監査で見つかった補助機能は新しいWeb境界で実装し、操作と検証を別記する。実機確認はPages公開後、OGP確認はユーザーのサーバー更新後に独立して追跡する。新アプリの検査成功だけで #67・#72 全体を完了扱いにしない。

## 設計指針の適用

[設計指針](https://zenn.dev/bem130/articles/1b352797de94e7) と [補足例](https://zenn.dev/bem130/articles/2595256f3d43bb) を参照する。記事中のツール、設定、ディレクトリ構成は採用済みの仕様とはしない。公式仕様、依存互換性、既存機能、検査能力、配信容量、保守性を確認して選定する。

Web 限定でも、機能本体と DOM・保存・通信の責務を分離する。一方、他プラットフォームへの移植だけを目的とした抽象層、package 分割、階層は導入しない。型付けのためだけの拡張子変更や無検証の型断言で既存の不整合を隠さない。

## 正本、派生値、状態遷移

問題定義、セッション、回答、草稿の各データについて、正本を一つに定める。画面表示、正答率、残り候補数、出題容量は正本から導出する派生値として扱い、独立した可変コピーを更新し続ける構成を避ける。

セッションの開始、出題、回答確定、保存待ち、終了、失敗など、同時に成立しない状態は判別可能 union で表す。学習状態と結果種別の組合せは遷移表で定義する。未回答なのに回答保存済みである状態や、終了済みセッションへ新規回答する状態を通常の型として作らない。

回答処理にはセッション ID、問題 ID、回答番号、ユーザー ID、操作 ID を固定して渡す。非同期処理の完了時に現在のグローバル変数から回答対象を再取得しない。遅れて到着した結果を適用できるか、固定した同一性と現在状態から判定する。回答の原子的・冪等な保存と再試行は [#77](https://github.com/bem130/quiz/issues/77) で検証する。

問題・pattern・題庫・概念・ユーザー・セッション・revision の識別子は役割を型で区別する。区切り文字を含む文字列の位置に意味を依存させず、出典と局所 ID の契約を明示する。新規データの識別方式を設計し、旧キーの変換処理は追加しない。

## 機能本体と副作用の境界

依存方向は、Web の調整処理から機能本体への一方向を基本とする。機能本体は DOM、IndexedDB、`fetch`、ページのグローバル状態を参照しない。

| 責務 | 契約 |
| --- | --- |
| 出題・採点・学習更新 | 定義、現在状態、入力から結果と次状態を返す。時刻と乱数の入力を明示する。 |
| URL・JSON・保存データの解釈 | 外部値を `unknown` として受け、構文、schema、参照関係、一意性を検証してから機能本体へ渡す。 |
| DOM・描画 | 検証済みデータを表示し、利用者の操作を型付き入力へ変換する。DOM 要素は表示層が所有する。 |
| IndexedDB・設定・バックアップ | 保存形式の検証、トランザクション、読み書きの成否を扱う。保存成功は要求の成功通知ではなく commit を基準にする。 |
| 通信 | URL 解決、HTTP、CORS、応答検証を扱い、失敗を通常の空題庫と区別する。 |
| 時刻・乱数 | 実環境で値を取得し、機能本体へ入力する。同じ入力と状態に対する再現性を確保し、`Math.random` 全体を一時的に差し替えない。 |
| Service Worker | ビルド成果物、題庫取得、offline、更新の契約を扱う。セッションや保存中操作を無視して強制更新しない。 |

すべての関数を一度に純粋化する作業は M0 の完了条件としない。M0 で境界契約と最小の実機能を検証し、各機能の変換・修正時に適用する。

## 保存 DTO と DOM の分離

保存 DTO は JSON または IndexedDB に保存するための version 付きデータであり、画面用の状態とは別の型にする。保存 DTO に DOM 要素、イベント、描画 widget、関数、タイマー、キャッシュ済みの画面参照を含めない。

問題定義と回答記録は、表示用の `_answerGroups` 等のプロパティを後付けするオブジェクトとして共有しない。描画層の参照は表示層の専用状態に持つ。DTO と検証済み domain 値の変換を明示し、汎用 clone や `JSON.stringify` の偶然の挙動を保存仕様としない。

外部のバックアップや保存領域から読み込んだ値も検証する。書き出した値を同じ形式へ復元できること、失敗時に既存データを壊さないこと、二重操作で回答や集計が重複しないことを検証する。新サイトの将来の schema 更新方針は定めるが、旧サイトの形式への互換対応は行わない。

## 欠損、失敗、表示

内部で意味を持つ欠損は `Option`、想定内の失敗は `Result` の判別可能 union で表す。DOM API の `null`、ライブラリ由来の `undefined`、例外、未検証 JSON は最小の境界で変換する。`any`、非 null 断言、無検証の cast で境界を通過させない。

エラー値には種別と必要な文脈を持たせ、日本語メッセージ、色、通知の表示とは分離する。表示側も全エラー種別の処理漏れを検出できる構成とする。未取得データ、出題候補の枯渇、保存待ち、通信失敗は別の結果として扱う。

ライブラリ選定前に、プロジェクト全体へ特定の Option／Result ライブラリや schema ライブラリを固定しない。内部契約は [#74](https://github.com/bem130/quiz/issues/74)、外部入力と変換方針は [#76](https://github.com/bem130/quiz/issues/76) で確定する。

## 初期開発基盤

[#73](https://github.com/bem130/quiz/issues/73) の初期選定は Vite と vanilla TypeScript とする。UI framework の導入は前提にしない。Node.js `24.14.1`、TypeScript `6.0.3`、ESLint `10.14.0`、typescript-eslint `8.72.1` を基準とし、実際の固定版と依存解決の正本は `package.json` と lockfile とする。

typescript-eslint `8.72.1` の配布 metadata が指定する TypeScript peer 範囲は `>=4.8.4 <6.1.0`、ESLint は `^8.57.0 || ^9.0.0 || ^10.0.0` である。更新時も採用版の peer 関係と実際の検査を確認する。新しい版であることだけを更新理由としない。

### minimatch の依存選定記録

2026-11-09 の初期依存調査では、開発依存の minimatch `10.2.6` が [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) の対象だった。修正版は `11.0.1` である。ただし [11 系の変更履歴](https://raw.githubusercontent.com/isaacs/minimatch/v11.0.1/changelog.md) には `makeRe`、`regexp`、`matchOne` 等の削除と一部の一致規則変更があり、単純な patch 更新とは扱わない。

調査した利用元は ESLint `10.14.0`、`@eslint/config-array` `0.23.5`、`@typescript-eslint/typescript-estree` `8.72.1` である。利用箇所は `Minimatch` の生成、`match`、`pattern` と `minimatch` 関数を使用し、削除された API の利用はなかった。`11.0.1` の Node 要件にも実行環境は適合する。隔離した一時環境から module 解決だけを差し替えた比較では、両版が同じ 5 ファイルを lint 対象として返し、双方ともエラー・警告は 0 件だった。この比較は lockfile 更新後の全検査や `npm audit` 成功を意味しない。

初期対応は、上記 3 利用元に限定して minimatch `11.0.1` を固定する override とする。互換性を確認していない全利用元への一括 override や、監査ツールの提案だけを根拠とする検査基盤の downgrade は行わない。依存更新時には利用 API、glob の一致規則、engine、override の適用範囲を再確認し、lint の対象列挙と検査結果が意図せず変わらないことを検証する。上流が修正版へ正式対応したら override の要否を再評価する。これは更新時の契約であり、上記の日付と版は調査時点の記録である。

TypeScript の `strict` に加え、配列・辞書アクセス、任意プロパティ、戻り値、例外の取り扱いを厳しく検査する。型情報を使う lint で unsafe な操作、未処理 Promise、非網羅分岐を検出する。Vite の build と型検査は別の検査である。設定を有効にしただけで全既存コードが検査済みになったとは扱わない。

PR #79の初期エントリ `src/main.ts` は旧 `js/main.js` を読み込んでいたため、その時点の型検査成功はアプリ全体の TypeScript 化完了ではなかった。最小の実機能 `src/core/katex-parser.ts` と旧利用箇所をつないだ `js/katex-parser.js` の一時ブリッジは、最終構成では撤去した。

開発と本番ビルドは Vite を経由する。生の PHP 配信や `server.py` では TypeScript の import を変換できないため、新構成の開発には `npm run dev` を使用する。初期段階で PHP 経路の動作を確認したとは報告しない。

## 段階移行中の検査範囲

| 検査 | 初期対象と解釈 |
| --- | --- |
| アプリ用 TypeScript | `src/**/*.ts`、`tests/core/**/*.ts`、`tests/types/**/*.ts`、`vite.config.ts` を対象とする。 |
| 純粋 core 用 TypeScript | `src/core/**/*.ts` を対象とし、DOM 型と Node 型の自動混入を避ける。 |
| 型情報付き lint | 新しい TypeScript を対象とする。旧 JavaScript が通過しても lint 済みとは数えない。 |
| 既存 JavaScript | 移行中は `allowJs: true`、`checkJs: false` で併存する。型検査保証の対象外として本書の一覧で追跡する。 |
| 既存テスト | 既存の動作証拠として継続実行する。新しい TypeScript の型契約や実ブラウザの証拠を代替しない。 |
| 新規 core テスト | 実機能の正常値、境界値、性質とエラーを検査する。誤用が型検査で拒否されることも確認する。 |
| 本番 build | module 解決と静的成果物を確認する。型検査、実行時検証、offline、実機操作の証拠とは分ける。 |

純粋 core の DOM／Node 非依存は compiler の型環境と import 制約の両方で確認する。型環境から DOM を外すだけで副作用がすべて禁止されるとは解釈しない。許可する入力、戻り値、依存を契約とテストで確認する。

M0 は上記の検査、実機能、型誤用検査、最小 CI が実行できる状態を完了条件とする。全旧 JavaScript の移行は要求しない。M3 の [#67](https://github.com/bem130/quiz/issues/67) と M4 の [#72](https://github.com/bem130/quiz/issues/72) で、全手書きアプリ module の変換、ブリッジ撤去、型検査範囲を最終監査する。

## 全 JavaScript module の最終対応表

基準は `4453c61ac21bc9e6bb37ce57aa0896aa8defcf7a` の `js/` 配下35 moduleとする。全35ファイルと一時ブリッジを撤去し、新runtime・CLI・テストは旧moduleをimportしない。旧機能の未移行差分は別途明示する。一対一の拡張子変更や旧DTO互換層は設けない。統合先のcore/webは `src/core/`・`src/web/`、検証先のcore/e2eは `tests/core/`・`tests/e2e/` を指す。

| 撤去したmodule | TypeScriptの統合先・契約 | 主な検証 |
| --- | --- | --- |
| `js/answer-state.js` | core/sessionの回答・保存待ち・確定状態 | core/session、e2e/application |
| `js/capacity-manager.js` | core/quiz-engineの実候補数とWebの選択範囲 | core/quiz-engine、e2e/application |
| `js/chem-renderer.js` | web/contentのRDKit境界、web/svg | e2e/svg |
| `js/config.js` | web/networkのURL検証、applicationの設定DTO | core/model-identity、e2e/application |
| `js/dataset-utils.js` | core/quiz-engineの共有索引、core/randomの明示状態 | core/quiz-engine、core/random |
| `js/db.js` | web/storage/databaseの草稿CASとcommit | core/storage、core/storage-draft-version、e2e/editor |
| `js/distractor-strategy.js` | core/quiz-engineの全pool混同・coverage抽選 | core/quiz-engine、core/session |
| `js/dom-refs.js` | web/applicationとeditorが専用DOMを所有 | e2e/application、e2e/editor |
| `js/draft-editor.js` | web/editor、monaco adapter、直列化保存・preview | e2e/editor |
| `js/entry-model.js` | core/schema、web/networkの出典・通信境界 | core/model-schema、e2e/application |
| `js/json-loc-parser.js` | JSON.parseのstrict判定とeditorの型付きsource range | core/model-schema、e2e/editor |
| `js/katex-parser.js` | core/katex-parser。一時ブリッジ撤去 | core/katex-parser、tests/types/katex-parser.test-d.ts |
| `js/local-draft.js` | web/editor、draft-importとstorage。旧localStorage互換は対象外 | core/storage、core/web-tools、e2e/editor・app-tools |
| `js/main.js` | src/main、web/application、core/session、storageとWeb補助helperへ責務分離 | core/session、e2e/application・app-tools |
| `js/menu-renderer.js` | web/applicationの題庫・範囲・容量とfolder選択、sharingのQR | e2e/application・app-tools |
| `js/question-clone.js` | core/sessionのreadonly historyと新session再挑戦 | core/session、e2e/application |
| `js/quiz-engine.js` | core/quiz-engineの全候補・共通容量・全正答除外 | core/quiz-engine |
| `js/quiz-model.js` | core/model、schema、identityの検証済みv3 | core/model-schema、core/model-identity |
| `js/quiz-renderer.js` | web/contentとapplication。domainへDOMを後付けしない | e2e/application、e2e/svg |
| `js/quiz-types.js` | core/model、records、result、sessionの判別union・ID | core/model-identity、scripts/check-types.test.mjs |
| `js/ruby-parser.js` | core/contentの純粋parserとWeb DOM描画 | core/content、e2e/editor |
| `js/session-core.js` | core/sessionの状態正本、storageの冪等commitAnswer | core/session、core/storage、e2e/application |
| `js/study-engine.js` | core/studyとsessionのdue/new/repair/retry | core/study、core/session |
| `js/test-engine.js` | core/sessionの範囲・既出排除・枯渇終了・replay | core/session、core/storage-replay |
| `js/text-source-registry.js` | editor内source range、web/source-toolsの出典・session Ruby Buffer | e2e/editor・app-tools |
| `js/text-utils.js` | core/content.plainText、quiz-engine.tokensToText、Question.row | core/content、core/text-projection |
| `js/theme.js` | applicationのtheme/font/scale設定、editor theme反映 | e2e/application、e2e/editor |
| `js/user-manager.js` | applicationとstorageのユーザー生成・切替・cascade削除 | core/storage、e2e/application |
| `js/storage/concept-stats.js` | core/recordsとcommitAnswer内の原子的EMA更新 | core/storage、core/session |
| `js/storage/confusion-store.js` | core/recordsとcommitAnswer内の混同更新 | core/storage、core/quiz-engine |
| `js/storage/database.js` | web/storage/database、validation、generation保護 | core/storage、core/storage-draft-version、core/storage-replay |
| `js/storage/package-store.js` | storage.replacePackageのrevision CASと削除整合性 | core/storage |
| `js/storage/question-store.js` | DOM付きcacheを撤去、canonical revision＋questionIdsから再構築 | core/session、core/storage-replay |
| `js/storage/schedule-store.js` | core/studyの純粋遷移とcommitAnswerのCAS | core/study、core/storage |
| `js/storage/session-store.js` | core/recordsのsession/replayとstorageの回答・集計commit | core/storage、core/storage-replay、e2e/application |

### 旧テスト37件の代替監査

旧 `tests/*.mjs` の7ファイル・37件を撤去した。旧moduleを呼ぶテストの成功を新実装の証拠に数えない。

| 旧テスト | 件数 | 新実装で保持する意味と検証先 |
| --- | ---: | --- |
| capacity-manager | 3 | 重複patternを二重加算せず出題不能行を数えない。core/quiz-engine・session、e2e/application。旧の空tokensを容量へ数える前提は採用しない。 |
| local-draft | 3 | 不正JSON保持、空状態、保存・再openはcore/storageとe2e/editor。clipboard新規取込はcore/web-tools・e2e/app-tools。旧localStorage形式は対象外。 |
| question-clone | 2 | 任意objectからDOM/関数を除去する汎用cloneは廃止。DOMを持たないreadonly Question/historyと新sessionへの再挑戦をcore/sessionとe2e/applicationで検証。 |
| quiz-engine | 4 | 2〜4択、全正答除外、範囲、容量はcore/quiz-engine・session。全組合せoracleと大規模共有索引も検証。 |
| quiz-model | 5 | v3、出典ID、重複row、sample、questionFormat/answer.choiceCount拒否はcore/model-schema・model-identity・text-projection。 |
| ruby-examples | 15 | doc/ruby.mdの各言語・ruby/gloss/math・HTML wrapperの全15例をcore/contentへ移植済み。 |
| text-utils | 5 | hide/key/br/listkey/glossのplain化をcore/text-projectionへ追加。row探索はQuestion.rowの明示保持とcore/quiz-engineの整合性検証へ置換。 |

`verify-json-parser.mjs` の値・位置検査はstrict構文のcore/model-schemaとeditorのsource jump E2Eへ置換した。新 `scripts/check-types.test.mjs` と `tests/ogp/` は撤去対象に含めない。

### PHP・配信・開発補助の撤去

旧 `index.php`、`entry.php`、`config.php`、`manifest.php`、root `manifest.webmanifest`、`sw.js`、`sw.php`、`.htaccess`、旧 `css/` を撤去した。HTMLはroot `index.html`、manifestは `public/manifest.webmanifest`、CSSは `src/web/app.css`、data配置は `scripts/build-assets.ts`、Service Workerは `src/service-worker.ts` が正本である。生成物だけをdistへ配信する。`ogp-card.php` と別配信資産は維持する。

旧 `cli.mjs` は `scripts/cli.ts` へ、生配信 `server.py` はVite dev/previewへ置換した。`script.py` はソース連結用の旧調査補助で、新アプリ・CI・buildから参照されないため撤去した。data、icons、v1/v2の文書は削除していない。

### 補助機能の差分解消と受け入れの残件

監査でclipboard取込、Ruby Buffer、sourceコピーと任意VS Codeリンク、共有QR、folder単位選択・共有、scope限定cache削除の差分を発見し、新しいWeb実装へ追加した。draft-importはstrict v3検証と新規作成CAS、source-toolsは検証済みlocal filemapと明示操作、sharingは同梱QRと新共有scope、cache-resetはアプリのscopeだけを操作する。詳細は[補助操作の契約](web-tools.md)に記載する。

core/web-toolsの4件とe2e/app-toolsの3ブラウザ15件で、取込拒否時の貼付け・非上書き、右クリックとキーボードでruby収集・新session初期化、出典コピーと検証済みリンク、QR表示・clean環境へのfolder範囲復元、別scope cacheと同一ユーザーIDの保持を確認した。Fullscreen、数字1〜4で回答、Space/Enterで次問も移行済みで、入力欄・IME・保存待ちには割り込まない。旧50%・65%を含む文字サイズ設定も保持する。

その後、遅いclipboard応答が読取待ち中の新入力を上書きしないガードを追加し、同ケースを3ブラウザで追加検証した。保存完了時も、保存要求後に進んだ取込欄の入力を初期化しない。この段階では上記15件と追加3件を分けて記録した。後続の公開版ではこれらを通常browser198件の統合CIへ含めて再実行しており、最終証拠は [受け入れ記録](acceptance.md) に記載する。

QRの実機カメラ読取、OSからVS Codeを起動する操作、物理touch・IME・読み上げは、ブラウザ自動化と別の確認事項である。元raw JSONの改行位置を保持していないsourceコピーはJSONPathを使い、偽のline/columnを作らない。新サイトの実装へ旧DB・旧共有URL互換を戻してはいない。

実ブラウザ・実機・OGP維持先の確認と公開切替も後述のゲートで別に判定する。

## 開発・公開のゲート

M0 で契約と最小機能、M1 でデータ整合性、M2 で出題・編集機能、M3 で静的成果物と PWA を整える。M0 の完了条件に M1〜M3 の全変換完了を戻さない。初期 CI と各機能の回帰検証は開発中から継続する。

[#68](https://github.com/bem130/quiz/issues/68) は検証経路と配信手順を整備する段階であり、本番配信を有効化しない。開発・CIで [#72](https://github.com/bem130/quiz/issues/72) のソフトウェア検証を確認し、必要なIssueの完了後に [#78](https://github.com/bem130/quiz/issues/78) でPagesを先に公開する。実機確認は公開Pagesで行い、別経路を設けない。

新規プロファイルからの起動・保存・再起動・新形式バックアップ復元、保存中の更新、複数タブ、通信・保存失敗を検証する。offline の保証対象は正常取得済み題庫と草稿とし、未取得の外部データは利用不可を明示する。型検査と build の成功を PWA や offline 動作の証拠にはしない。

Chromium、Firefox、WebKit の実ブラウザ検証と、iOS Safari・Android Chrome の最小実機確認を区別する。IME、画面キーボード、フォーカス、タッチ、読み上げ、狭幅画面の確認結果と未実施項目を記録する。OGP の PHP/GD、フォント、日本語描画は維持先の実環境で確認する。旧サイトのデータ救済や復旧を公開条件へ追加しない。

## 公式資料

- [TypeScript: strict](https://www.typescriptlang.org/tsconfig/strict.html)
- [TypeScript: noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
- [TypeScript: exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
- [Vite: TypeScript は変換のみで型検査を行わない](https://vite.dev/guide/features.html#typescript)
- [typescript-eslint の package metadata](https://registry.npmjs.org/typescript-eslint/8.72.1)

参照情報はツールの更新で変わる。固定版の設定・lockfile・実行結果と合わせて確認する。
