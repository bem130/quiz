# TypeScript／Web 再構成計画

## 目的と対象範囲

アプリ本体を TypeScript／Web 限定で再構成し、`https://bem130.github.io/quiz/` で動作させる。OGP 画像生成の `https://bem130.com/quiz/ogp-card.php` は維持する。計画の正本は [親 Issue #38](https://github.com/bem130/quiz/issues/38) と各個別 Issue であり、本書は実装時の契約と変換対象を整理する。

旧サイトのデータ移行・救済は行わず、新サイトは新規データで開始する。旧 ID、旧バックアップ、旧共有 URL の互換維持、旧サイトへの退避ツール配信を対象に含めない。旧データ移行の [#69](https://github.com/bem130/quiz/issues/69) は対応しないとして終了した。新サイト自身の保存と将来のバックアップ・復元は [#46](https://github.com/bem130/quiz/issues/46) の対象である。

Rust 化、WASI、ネイティブアプリ、新しい実行プラットフォームへの対応は行わない。既存の `cli.mjs` は開発補助として現状維持し、別製品の実装へ範囲を広げない。

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

初期エントリは `src/main.ts` とする。段階移行中は旧 `js/main.js` を読み込むため、このエントリだけの型検査成功をアプリ全体の TypeScript 化完了とはしない。最小の実機能は `src/core/katex-parser.ts` へ移し、`js/katex-parser.js` の一時ブリッジを介して既存利用箇所から呼び出す。

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

## 全 JavaScript module の変換棚卸し

基準は `4453c61ac21bc9e6bb37ce57aa0896aa8defcf7a` の `js/` 配下 35 module とする。各行は変換の主担当 Issue と関連する修正を示す。分割・統合は可能だが、移行先と撤去の確認を残す。表の「未変換」は型検査対象でない既存実装を意味する。TypeScript エントリから読み込まれるだけでは変換済みとしない。

| 基準 module | 主担当・関連 Issue | 初期状態・移行責務 |
| --- | --- | --- |
| `js/answer-state.js` | #74、#75、#39 | 未変換。回答状態と純粋な更新・採点を分離する。 |
| `js/capacity-manager.js` | #55、#56、#67 | 未変換。容量の派生値と revision 付きキャッシュを扱う。 |
| `js/chem-renderer.js` | #61、#67 | 未変換。化学描画の Web／ライブラリ境界を扱う。 |
| `js/config.js` | #57、#76、#67 | 未変換。URL と設定を検証して内部値へ変換する。 |
| `js/dataset-utils.js` | #55、#58、#75 | 未変換。候補操作と明示的な乱数入力を分離する。 |
| `js/db.js` | #40、#46、#77 | 未変換。草稿の保存 DTO、commit、失敗を扱う。 |
| `js/distractor-strategy.js` | #59、#58、#49 | 未変換。候補選択と統計・乱数の入力契約を扱う。 |
| `js/dom-refs.js` | #75、#67 | 未変換。DOM 参照と欠損を Web 境界に閉じ込める。 |
| `js/draft-editor.js` | #40、#53、#75、#67 | 未変換。未保存変更の正本と表示状態を分ける。 |
| `js/entry-model.js` | #44、#45、#66、#76 | 未変換。出典解決、検証済み定義、通信を分離する。 |
| `js/json-loc-parser.js` | #53、#76 | 未変換。構文の受理条件と位置付き診断を統一する。 |
| `js/katex-parser.js` | #73 | `src/core/katex-parser.ts` へ変換する最小機能。一時ブリッジは #67 で撤去する。 |
| `js/local-draft.js` | #40、#46、#76 | 未変換。草稿 DTO と検証済み題庫の変換を扱う。 |
| `js/main.js` | #39、#75、#77、#67 | 未変換。`src/main.ts` の初期エントリは旧実装を利用する。調整・状態・副作用を段階分離する。 |
| `js/menu-renderer.js` | #75、#67 | 未変換。派生値の表示と型付き操作入力を扱う。 |
| `js/question-clone.js` | #51、#75、#67 | 未変換。再挑戦の domain データと DOM のコピーを分離する。 |
| `js/quiz-engine.js` | #42、#43、#47、#55、#58 | 未変換。出題可能性、許可範囲、候補枯渇を純粋な結果として扱う。 |
| `js/quiz-model.js` | #54、#76、#44 | 未変換。題庫 schema、識別子、検証済み定義の契約を扱う。 |
| `js/quiz-renderer.js` | #39、#75、#67 | 未変換。問題本体と DOM 参照を分離する。 |
| `js/quiz-types.js` | #74 | 未変換。状態・識別子・結果の型契約へ整理する。 |
| `js/ruby-parser.js` | #67、#72 | 未変換。ruby／gloss 構文と描画入力の契約を維持して変換する。 |
| `js/session-core.js` | #39、#43、#51、#77 | 未変換。セッションの正本、回答同一性、保存・終了を扱う。 |
| `js/study-engine.js` | #41、#43、#48、#59 | 未変換。学習状態、候補、時刻、再試行を整理する。 |
| `js/test-engine.js` | #42、#47、#58 | 未変換。出題範囲・重複禁止・再現性を扱う。 |
| `js/text-source-registry.js` | #75、#67 | 未変換。DOM の出典参照を表示層で所有する。 |
| `js/text-utils.js` | #75、#67 | 未変換。文字列表現の純粋な変換を扱う。 |
| `js/theme.js` | #76、#67 | 未変換。設定の検証と DOM への反映を分ける。 |
| `js/user-manager.js` | #52、#60、#74 | 未変換。ユーザー ID、設定、保存と画面を分離する。 |
| `js/storage/concept-stats.js` | #49、#77 | 未変換。概念のスコープと回答更新の整合性を扱う。 |
| `js/storage/confusion-store.js` | #49、#59、#77 | 未変換。混同統計 DTO と更新を扱う。 |
| `js/storage/database.js` | #46、#60、#77 | 未変換。新サイトの DB、トランザクション、復元境界を扱う。 |
| `js/storage/package-store.js` | #44、#45、#50 | 未変換。題庫の識別・revision・検証後の更新確定を扱う。 |
| `js/storage/question-store.js` | #42、#44、#75 | 未変換。表示状態を含まない問題 DTO を保存する。 |
| `js/storage/schedule-store.js` | #41、#48、#77 | 未変換。純粋な学習遷移と保存を分離する。 |
| `js/storage/session-store.js` | #51、#77 | 未変換。回答とセッション集計の原子的・冪等な更新を扱う。 |

`sw.js`、`sw.php` は [#67](https://github.com/bem130/quiz/issues/67) で生成元と配信責務を統一する。ビルド後の JavaScript は配信成果物であり、手書きアプリ module の未変換とは区別する。`cli.mjs`、`verify-json-parser.mjs`、既存 `tests/*.mjs` は開発補助・検証コードとして別に扱い、アプリ本体の型検査完了の件数へ含めない。

## 開発・公開のゲート

M0 で契約と最小機能、M1 でデータ整合性、M2 で出題・編集機能、M3 で静的成果物と PWA を整える。M0 の完了条件に M1〜M3 の全変換完了を戻さない。初期 CI と各機能の回帰検証は開発中から継続する。

[#68](https://github.com/bem130/quiz/issues/68) は検証経路と配信手順を整備する段階であり、本番配信を有効化しない。隔離した環境で [#72](https://github.com/bem130/quiz/issues/72) の受け入れを確認し、必要な Issue の完了後に [#78](https://github.com/bem130/quiz/issues/78) で公開を切り替える。

新規プロファイルからの起動・保存・再起動・新形式バックアップ復元、保存中の更新、複数タブ、通信・保存失敗を検証する。offline の保証対象は正常取得済み題庫と草稿とし、未取得の外部データは利用不可を明示する。型検査と build の成功を PWA や offline 動作の証拠にはしない。

Chromium、Firefox、WebKit の実ブラウザ検証と、iOS Safari・Android Chrome の最小実機確認を区別する。IME、画面キーボード、フォーカス、タッチ、読み上げ、狭幅画面の確認結果と未実施項目を記録する。OGP の PHP/GD、フォント、日本語描画は維持先の実環境で確認する。旧サイトのデータ救済や復旧を公開条件へ追加しない。

## 公式資料

- [TypeScript: strict](https://www.typescriptlang.org/tsconfig/strict.html)
- [TypeScript: noUncheckedIndexedAccess](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
- [TypeScript: exactOptionalPropertyTypes](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
- [Vite: TypeScript は変換のみで型検査を行わない](https://vite.dev/guide/features.html#typescript)
- [typescript-eslint の package metadata](https://registry.npmjs.org/typescript-eslint/8.72.1)

参照情報はツールの更新で変わる。固定版の設定・lockfile・実行結果と合わせて確認する。
