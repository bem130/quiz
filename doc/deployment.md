# 静的ビルドと GitHub Pages 公開

## 配信先と対象

アプリ本体の配信先は `https://bem130.github.io/quiz/` である。ビルドの base path は `/quiz/` に固定する。OGP 画像生成の `https://bem130.com/quiz/ogp-card.php` は別配信として維持し、`dist` へ PHP をコピーしない。

bem130.comの更新はユーザー主導で行う。開発側が用意するOGP専用bundle、配置手順、配信後の確認項目は [ogp.md](ogp.md) に記載する。

旧サイトの ID、保存データ、バックアップ、共有 URL の移行・互換維持は行わない。新サイトは新規データで開始する。新サイト自身の保存、バックアップ、復元はアプリ側の契約で検証する。

公開物は `dist` だけである。リポジトリ全体や作業ディレクトリを公開しない。公開用に `index.php`、`entry.php`、`manifest.php`、`sw.php` を実行するサーバーは不要である。

2026-11-10（JST）の初回受け入れ済み版はSHA `54491c85ad0b14e0091053a3d2a6ef0c093b30b1`、version `source-3012db61c02e061112d3dbdb`、[Pages run42644286243](https://github.com/bem130/quiz/actions/runs/42644286243) である。公開後の3browser、82file、79precache、CORSの結果は [受け入れ記録](acceptance.md) に保持する。後続の公開状態は [#78](https://github.com/bem130/quiz/issues/78) を参照する。実機とbem130.comの配備確認は未完了である。

## 開発と検証

Node.js の固定版と lockfile を用い、次を実行する。

```sh
npm ci
npm run dev
npm run check
npm run preview
```

`npm run dev` は TypeScript の開発サーバーであり、`npm run preview` は生成済み `dist` の確認用である。PWA の install、offline、更新を確認する際は、本番ビルドを `http://localhost` または HTTPS で配信する。生の `server.py` や PHP から TypeScript source を直接配信する方法は新構成の開発経路ではない。

型検査、lint、core テスト、静的ビルド、実ブラウザ、モバイル実機、OGP の PHP/GD 環境を別々の証拠として記録する。ローカル build 成功は GitHub Actions、GitHub Pages、実機での動作確認を意味しない。

## 静的データと成果物

`public/entry.json` を問題一覧の正本とする。初期一覧には `data/sample/math-v3.json`、`data/sample/multi-answer-v3.json`、`data/sample/svg-v3.json` を含める。ビルドでは各参照を解決し、strict JSON、v3 schema、識別子、参照の整合性を検証してからコピーする。

公開 entry はリポジトリ内 `data/` 配下の相対 JSON だけを参照する。絶対パス、外部 URL、`..`、Windows の区切り文字、クエリ、fragment、エンコードによる脱出を拒否する。外部 entry は利用時の通信境界で扱い、ビルド時に任意の外部入力を取得しない。

同梱題庫の SVG file 参照は題庫ファイルを基準に解決し、`data/` の外へ出る参照を拒否する。行フィールドや token 配列を経由する SVG 参照も収集する。SVG の構造検証と XML の安全化は別であり、配信した SVG を無条件で DOM へ挿入しない。

ビルド成果物にはアプリの JS/CSS、KaTeX のフォント、RDKit の WASM、Monaco の worker 等を含める。`scripts/build-assets.ts` は出力全体を走査し、各資産の URL、SHA-256、バイト数を `precache-manifest.json` へ記録する。一覧を人手で更新して import の追加を追いかけない。

Viteのbackend連携用manifestはruntimeで参照しないため生成しない。固定版upload-pages-artifactの既定値は隠しファイル・ディレクトリを除外するので、出力のdot-pathをbuildで拒否する。受信artifact内の各ファイルが配信先と一致するだけでなく、precacheの全参照がartifactに存在しsize/hashも一致することを確認する。初回公開で欠落した `.vite/manifest.json` は [PR #84](https://github.com/bem130/quiz/pull/84) で修正した。

PHP、TypeScript source、開発スクリプト、テスト、source map、`ogp-card.php` が成果物へ混入した場合は失敗させる。HTML に残る PHP 実行参照と外部 CDN の script／stylesheet 依存も拒否する。OGP の画像 URL や canonical のようなメタ情報は外部実行依存とは区別する。

## 版の契約

`src/`、`public/`、`data/`、`icons/` とビルド設定・依存 lock 等の入力内容から決定的な版を作る。現在時刻や実行ごとの乱数は用いない。検査用の一時 `quality-rules-*` ディレクトリは入力に含めない。

同じ版をページの `__APP_VERSION__`、生成した `sw.js`、`app-version.json` の `version` に使用する。module がページの版を読んで自身の版と称する検査は行わない。worker の precache は成果物そのものの hash で検証する。

`app-version.json` は更新確認用であり、Service Worker の Cache First に入れない。更新取得では HTTP cache も bypass する。offline で取得できない場合は旧 metadata を新しい確認結果として返さない。

## PWA とキャッシュ

登録先は `${import.meta.env.BASE_URL}sw.js` とする。manifest の start_url と scope は同じアプリの相対パスにする。Cache Storage の名前には登録 scope を含め、同一 origin にある別の Pages アプリのキャッシュを削除しない。

install時は全precache資産についてHTTP成功、拡張子に対応するMIME、バイト数、SHA-256を検査する。存在しないJSの代わりのHTMLや、正しいJS本文をtext/htmlで返す配信も拒否する。一件でも失敗したらその版の不完全なshell cacheを破棄し、以前の版は保持する。

新しい worker は install 後に勝手に `skipWaiting` しない。UI は利用者へ更新を知らせ、学習中・回答保存中・草稿の未保存変更がある間は適用を拒否する。適用可能な状態で利用者が選択した時だけ、待機 worker へ次の message を送る。

```ts
registration.waiting.postMessage({ type: 'SKIP_WAITING' });
```

更新前の tab が遅延 import する旧 hashed asset を破壊しない。アプリの window client がある間は旧 shell cache を保持する。全 window client がなくなった後の activate で、このアプリの旧 shell cache だけを削除する。

静的資産はキャッシュを優先する。完全 URL と build 時の hash を確認して保存した shell に限り、配信サーバーの `Vary: Origin` を無視して照合する。更新前の hashed asset は旧 shell も照合し、fetch の destination が空でも新しい配信先の 404 に置き換えない。JSON、SVG、既知の静的資産でない fetch は Network First とし、worker のメモリ上の URL 登録一覧に依存しない。worker 再起動後も同じ分類を適用する。利用可能な正常応答だけを保存し、offline・timeout・一時的なサーバー障害では取得済みデータへ fallback する。未取得データに HTML shell を返して JSON と誤認させない。

動的データ cache は最大 32 件、一件 4 MiB とする。JSON または SVG の Content-Type を持つ応答を対象とし、private／no-store、opaque、失敗応答は保存しない。上限超過や保存領域の制約がある場合も正常なオンライン応答は利用できるが、キャッシュ保存できたとは扱わない。キャッシュは新サイトの完全バックアップの代わりではない。

同梱資産と正常に保持できた題庫・草稿を用いた offline 起動、出題、編集、保存、SMILES 表示を検証する。未取得の外部題庫と SVG は利用不可を表示する。Cache Storage の実行環境ごとの容量・退避条件はブラウザで別途検証する。

## 配信元の棚卸しと #70 の確認順

2026-11-09時点の公開entryは同梱3題庫だけを参照する。旧bem130.comのdataを新サイトから取得する設定はない。旧データ移行を追加せず、既定起動と任意の外部entryを区別して次の範囲を検証する。

| 配信物・入力 | 現在の出典と解決規則 | 確認する責務 |
| --- | --- | --- |
| 既定entry | アプリと同一originの `/quiz/entry.json` | 配信した同じartifactのJSONを実GETし、一覧・3題庫・5patternを読み込む。 |
| 同梱題庫 | `/quiz/data/sample/math-v3.json`、`multi-answer-v3.json`、`svg-v3.json` | entryのURL基準で解決する。同一originのため外部CORS許可は不要だが、200、MIME、本文、schemaと実出題を確認する。 |
| 同梱図 | 題庫基準の `/quiz/data/sample/figures/circle.svg` と題庫内inline SVG | ファイルは実GET後にsanitizeして表示する。inline SVGとXML namespaceのURIは外部データのfetch先ではない。 |
| 描画・編集依存 | 同じbuildに含めたKaTeX fonts、RDKit WASM、Monaco workers、JS/CSS | CDN実行依存を追加しない。HTTPS上の実読込、worker／WASM初期化、PWA install、offlineを確認する。 |
| 利用者が追加する外部entry・題庫・SVG | HTTP(S) URLを正規化し、entryの参照は取得後の最終URL、SVGの相対参照は題庫URLを基準に解決する | 配信者がentryだけでなく参照先JSON・SVGとredirect経路も公開し、必要なCORS許可を設定する。アプリはcredentialsを送らず、本文を検証してから保存する。 |
| ローカル草稿・backup | 新サイトのIndexedDB、利用者が明示して選択したファイル | 外部entryの失敗時も使用可能にする。CORS許可のない配信元からは、配信者側の設定変更または明示的なローカル取り込みを使う。アプリ側でCORSを迂回するproxyやサーバー認証情報を要求しない。 |
| OGP | `https://bem130.com/quiz/ogp-card.php` の独立した画像サービス | アプリのentry／題庫配信元に数えない。ユーザー主導の配備後に #71 で確認し、アプリ本体の公開を待たせない。 |

外部entryの読込は [network.ts](../src/web/network.ts) の `credentials: 'omit'` を用いる。CORSのoriginはscheme・host・portの組であり、Pages側は `https://bem130.github.io`、preview側はその一時hostである。`/quiz/` はoriginの一部ではない。資格情報なしの公開データは `Access-Control-Allow-Origin: *` または要求originへの明示許可で共有できる。origin別に応答する場合は `Vary: Origin` も必要となる。[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)・[Access-Control-Allow-Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Allow-Origin)

公開HTTPSアプリから使う外部配信元は、redirect先と参照先もHTTPSで提供する。APIのHTTP(S) URL受理と、HTTPSページから実際にfetchできることを混同しない。HTTPへの混在取得はブラウザで拒否され得るため、CORSヘッダーだけで解決したとは扱わない。[mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)

### 公開前: #70 の事前確認と #72

1. 候補SHAを固定し、clean install・CI・browser検証済みbuildの `dist` と `app-version.json`、資産hash一覧を保存する。同じ成果物を `/quiz/` のまま開発・CIの検証用serverで確認する。2026-11-09のユーザー指示以後、実機用の別公開経路は設けない。
2. 新規browser profileでpreviewを開き、既定entry・全同梱題庫・circle.svgの実GET、MIME、最終URL、本文と選択画面、出題、保存・再起動を確認する。JS/CSS/fonts/WASM/workers、service workerのscopeとinstall、offlineも同じbuildで確認する。
3. 任意外部entryの機能は、アプリpreviewとは**別のHTTPS origin**へ置いた非機密の実データで確認する。許可ありのentry→JSON→SVG、実HTTP 200だがCORS許可なしの読込拒否、redirect後の相対参照と題庫IDを含める。許可ありは本文を読んで実出題・図表示まで、拒否時は通信失敗表示と取得済み題庫・草稿の保持まで確認する。
4. 結果へアプリSHA／version、preview URL、データ配信先、日時、browser、要求・最終URL、実GETのstatus／MIME／CORS設定、UI結果を記録する。ブラウザ側から読めない失敗応答はserver log／network記録と突き合わせる。`route.fulfill`／`route.abort`、curlだけの成功、HEAD、404のCORSヘッダーは、公開HTTPSの正常本文をブラウザで利用できた証拠にしない。

初回の公開前確認で使ったCloudflare Quick Tunnelは停止済みである。一時URLを実機確認やrollback先へ再利用しない。実機は公開Pagesで確認する。公開後の外部CORS検証には既存公開GET endpointと公開SHAのraw GitHub資産を使い、新しいアプリ公開経路を作らなかった。同一origin内のfixtureだけで外部CORSを確認したとは扱わない。

previewでの許可が本番originの許可を保証するわけではない。外部配信者のallowlistがpreview originだけを許可している場合、本番 `https://bem130.github.io` の確認は未実施である。この違いを残したまま、#72は上記事前確認の合格を評価する。#70の「公開前確認」と下記「本番後確認」を分け、#70全体のcloseをPages切替前に要求して実質循環を作らない。

### Pages切替後: #78 の本番確認

1. 上記事前確認と #72 のソフトウェア検証を満たした成果物を #78 で配信する。実機確認はそのPages URLで公開後に行う。公開SHA、workflow run、最終URL、versionとasset hashの一致を記録する。検査時と異なるbuildを配信した場合は、その成果物を再検証する。
2. `https://bem130.github.io/quiz/` の新規profileから、既定entry・3題庫・図・WASM／worker、保存・再起動、PWA scope、offline、更新を再確認する。一時previewでの成功をこの実配信確認へ置き換えない。
3. 外部entryの許可・拒否・redirectを、同じ実データ配信先とPagesの実originから再確認する。公開時に採用する外部データ配信元を追加した場合は、そのentry・JSON・SVGを全て確認する。現時点の既定起動には外部題庫配信元がないことも棚卸し結果として記録する。
4. 本番だけで失敗した場合は正常な空一覧と区別して記録する。同梱・ローカル機能を維持し、配信設定修正または直前の検証済み新サイト版へのrollbackを判断する。#70の本番後項目と #78 を、実結果が揃ってから完了にする。

これは本番確認の削除や任意外部entry機能の縮小ではなく、切替前に確認可能な条件と切替後にしか確認できない条件の実行順である。iOS Safari／Android Chromeの実機、画面キーボード、OSのIME、読み上げは引き続き未実施項目として保持する。desktopや一時HTTPS配信だけで代替しない。

## 本番公開

`.github/workflows/check.yml` は検証用であり公開しない。`.github/workflows/pages.yml` は `workflow_dispatch` による手動公開だけを定義する。push や pull request を本番公開の契機にしない。

実際の公開は [#72](https://github.com/bem130/quiz/issues/72) のソフトウェア検証とM0〜M3の完了後、[#78](https://github.com/bem130/quiz/issues/78) で先行して行う。実機確認は公開Pagesへ引き継ぐ。GitHub Pages の source を GitHub Actions に設定し、main の検証済み SHA を対象とする。必要に応じて `github-pages` environment の承認設定をリポジトリ側で行う。

手動実行時は main を選択し、`confirm_publish` に `publish` と入力する。workflow は clean install、型検査・lint・テスト・build、Chromium／Firefox／WebKit の受け入れ検証を行い、成功した `dist` だけを upload して配信する。公開 action は公式 release の commit SHA に固定する。

本書と workflow を追加したことは、Pages 設定の変更や公開実行を意味しない。公開後は正規 URL、初回起動、保存と再起動、version 更新、offline、外部 source の CORS を実際の配信先で確認する。OGPはユーザーによるサーバー更新後の #71 で独立して確認し、未更新を #72／#78 の前提にしない。

問題が発生した場合は、最後に受け入れを確認した SHA の静的成果物を再配信する。保存データは配信成果物とは分けて保持し、キャッシュ削除で IndexedDB を消さない。旧サイトの復旧や旧データ変換を rollback の前提にしない。

rollback時は、実公開の受け入れに成功した「Publish Pages (manual)」runと公開SHAを #78 の記録から特定する。deploy jobの成功だけで選ばない。再実行可能な期間内であれば、`gh run rerun <受け入れ済みrunのID> --repo bem130/quiz` で同じSHA・refの検査と配信を再実行する。GitHubは再実行に元のSHA/refを使用し、再実行の期間制限があるため、実行前に [公式の再実行条件](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs) を確認する。期間外の場合は該当変更のrevertを新しいPRとして検査し、mainから手動配信する。

現時点の最初の受け入れ済み版はSHA `54491c85`／run `42644286243` である。初回SHA `7cba49f`／run `42639746799` はdeploy成功後にPWA install不合格を確認したのでrollback候補にしない。本番rollbackそのものは未実施である。

配信後は学習・編集の保存を済ませ、待機workerを明示適用して再読み込みし、`app-version.json` と公開資産・主要操作を確認する。初回公開で直前の新サイト版がない場合は、その事実を記録し、未検証の旧サイトへ戻さない。既定の保存領域は保持し、復旧のためにブラウザの「サイトデータをすべて削除」を無条件に案内しない。

## 現在の検証範囲

専有テストでは決定的な版、unsafe path の拒否、fonts／WASM／worker を含む precache、公開混入の拒否、同梱題庫の検証、実 Vite build の page／worker／metadata の版一致を確認する。worker は模擬 Cache Storage で integrity、明示更新、再起動後の offline fallback、metadata bypass、旧 tab 保護、件数上限を検証する。

実ブラウザの PWA 検証は `npm run test:pwa` で実行する。既存 `dist` を本物の HTTP server で配信し、同梱題庫・SVG・fonts・WASM・editor worker の precache と offline 起動・編集を確認する。更新用 fixture はその `dist` からページの版と hashed entry 名を更新し、全資産の hash と本物の worker を再生成して作る。旧版から新版への waiting、明示適用、実際の IndexedDB transaction で保持した回答保存中の保護、別 tab の学習継続、offline での旧 hashed asset 取得を確認する。ブラウザ結果の出力先は他の E2E と分けた TEMP 内の `quiz-pwa-test-results` とする。

この検証は二つの独立したリリース commit の比較ではない。実機の退避条件・容量、GitHub Actions、公開先、PHP/GD の結果は別に記録する。

## 公式資料

- [Vite JavaScript API](https://vite.dev/guide/api-javascript.html)
- [Vite build options](https://vite.dev/config/build-options.html)
- [Service Worker skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting)
- [GitHub Pages の deploy action](https://github.com/actions/deploy-pages)
