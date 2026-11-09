# 静的ビルドと GitHub Pages 公開

## 配信先と対象

アプリ本体の配信先は `https://bem130.github.io/quiz/` である。ビルドの base path は `/quiz/` に固定する。OGP 画像生成の `https://bem130.com/quiz/ogp-card.php` は別配信として維持し、`dist` へ PHP をコピーしない。

旧サイトの ID、保存データ、バックアップ、共有 URL の移行・互換維持は行わない。新サイトは新規データで開始する。新サイト自身の保存、バックアップ、復元はアプリ側の契約で検証する。

公開物は `dist` だけである。リポジトリ全体や作業ディレクトリを公開しない。公開用に `index.php`、`entry.php`、`manifest.php`、`sw.php` を実行するサーバーは不要である。

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

PHP、TypeScript source、開発スクリプト、テスト、source map、`ogp-card.php` が成果物へ混入した場合は失敗させる。HTML に残る PHP 実行参照と外部 CDN の script／stylesheet 依存も拒否する。OGP の画像 URL や canonical のようなメタ情報は外部実行依存とは区別する。

## 版の契約

`src/`、`public/`、`data/`、`icons/` とビルド設定・依存 lock 等の入力内容から決定的な版を作る。現在時刻や実行ごとの乱数は用いない。検査用の一時 `quality-rules-*` ディレクトリは入力に含めない。

同じ版をページの `__APP_VERSION__`、生成した `sw.js`、`app-version.json` の `version` に使用する。module がページの版を読んで自身の版と称する検査は行わない。worker の precache は成果物そのものの hash で検証する。

`app-version.json` は更新確認用であり、Service Worker の Cache First に入れない。更新取得では HTTP cache も bypass する。offline で取得できない場合は旧 metadata を新しい確認結果として返さない。

## PWA とキャッシュ

登録先は `${import.meta.env.BASE_URL}sw.js` とする。manifest の start_url と scope は同じアプリの相対パスにする。Cache Storage の名前には登録 scope を含め、同一 origin にある別の Pages アプリのキャッシュを削除しない。

install 時は全 precache 資産について HTTP 成功、バイト数、SHA-256 を検査する。存在しない JS の代わりに HTML が 200 で返った場合も拒否する。一件でも失敗したらその版の不完全な shell cache を破棄し、以前の版は保持する。

新しい worker は install 後に勝手に `skipWaiting` しない。UI は利用者へ更新を知らせ、学習中・回答保存中・草稿の未保存変更がある間は適用を拒否する。適用可能な状態で利用者が選択した時だけ、待機 worker へ次の message を送る。

```ts
registration.waiting.postMessage({ type: 'SKIP_WAITING' });
```

更新前の tab が遅延 import する旧 hashed asset を破壊しない。アプリの window client がある間は旧 shell cache を保持する。全 window client がなくなった後の activate で、このアプリの旧 shell cache だけを削除する。

静的資産はキャッシュを優先する。完全 URL と build 時の hash を確認して保存した shell に限り、配信サーバーの `Vary: Origin` を無視して照合する。更新前の hashed asset は旧 shell も照合し、fetch の destination が空でも新しい配信先の 404 に置き換えない。JSON、SVG、既知の静的資産でない fetch は Network First とし、worker のメモリ上の URL 登録一覧に依存しない。worker 再起動後も同じ分類を適用する。利用可能な正常応答だけを保存し、offline・timeout・一時的なサーバー障害では取得済みデータへ fallback する。未取得データに HTML shell を返して JSON と誤認させない。

動的データ cache は最大 32 件、一件 4 MiB とする。JSON または SVG の Content-Type を持つ応答を対象とし、private／no-store、opaque、失敗応答は保存しない。上限超過や保存領域の制約がある場合も正常なオンライン応答は利用できるが、キャッシュ保存できたとは扱わない。キャッシュは新サイトの完全バックアップの代わりではない。

同梱資産と正常に保持できた題庫・草稿を用いた offline 起動、出題、編集、保存、SMILES 表示を検証する。未取得の外部題庫と SVG は利用不可を表示する。Cache Storage の実行環境ごとの容量・退避条件はブラウザで別途検証する。

## 本番公開

`.github/workflows/check.yml` は検証用であり公開しない。`.github/workflows/pages.yml` は `workflow_dispatch` による手動公開だけを定義する。push や pull request を本番公開の契機にしない。

実際の公開は [#72](https://github.com/bem130/quiz/issues/72) と他の必須 Issue の受け入れ完了後、[#78](https://github.com/bem130/quiz/issues/78) で行う。GitHub Pages の source を GitHub Actions に設定し、main の検証済み SHA を対象とする。必要に応じて `github-pages` environment の承認設定をリポジトリ側で行う。

手動実行時は main を選択し、`confirm_publish` に `publish` と入力する。workflow は clean install、型検査・lint・テスト・build、Chromium／Firefox／WebKit の受け入れ検証を行い、成功した `dist` だけを upload して配信する。公開 action は公式 release の commit SHA に固定する。

本書と workflow を追加したことは、Pages 設定の変更や公開実行を意味しない。公開後は正規 URL、初回起動、保存と再起動、version 更新、offline、外部 source の CORS、OGP を実際の配信先で確認する。

問題が発生した場合は、最後に受け入れを確認した SHA の静的成果物を再配信する。保存データは配信成果物とは分けて保持し、キャッシュ削除で IndexedDB を消さない。旧サイトの復旧や旧データ変換を rollback の前提にしない。

## 現在の検証範囲

専有テストでは決定的な版、unsafe path の拒否、fonts／WASM／worker を含む precache、公開混入の拒否、同梱題庫の検証、実 Vite build の page／worker／metadata の版一致を確認する。worker は模擬 Cache Storage で integrity、明示更新、再起動後の offline fallback、metadata bypass、旧 tab 保護、件数上限を検証する。

実ブラウザの PWA 検証は `npm run test:pwa` で実行する。既存 `dist` を本物の HTTP server で配信し、同梱題庫・SVG・fonts・WASM・editor worker の precache と offline 起動・編集を確認する。更新用 fixture はその `dist` からページの版と hashed entry 名を更新し、全資産の hash と本物の worker を再生成して作る。旧版から新版への waiting、明示適用、実際の IndexedDB transaction で保持した回答保存中の保護、別 tab の学習継続、offline での旧 hashed asset 取得を確認する。ブラウザ結果の出力先は他の E2E と分けた TEMP 内の `quiz-pwa-test-results` とする。

この検証は二つの独立したリリース commit の比較ではない。実機の退避条件・容量、GitHub Actions、公開先、PHP/GD の結果は別に記録する。

## 公式資料

- [Vite JavaScript API](https://vite.dev/guide/api-javascript.html)
- [Vite build options](https://vite.dev/config/build-options.html)
- [Service Worker skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting)
- [GitHub Pages の deploy action](https://github.com/actions/deploy-pages)
