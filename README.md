# Quiz

TypeScriptで構成するWebクイズアプリ。公開先は `https://bem130.github.io/quiz/`、OGP画像生成は `https://bem130.com/quiz/ogp-card.php` とする。新サイトは新規データで開始し、旧サイトのデータ移行は行わない。

## 開発

Node.js 24.14.1を使用する。ソースとドキュメントはUTF-8。

```sh
npm ci
npm run dev
npm run check
npx playwright install chromium firefox webkit
npm run test:e2e
npm run test:pwa
```

開発URLは `http://127.0.0.1:5173/quiz/`。`npm run build` が `dist/` を生成し、`npm run preview` で本番形式を確認する。PHPサーバーや素のファイル配信はTypeScriptの開発経路として使用しない。

`src/core/` は入力検証・識別子・出題・学習・セッションの純粋な処理、`src/web/` はDOM・IndexedDB・通信・エディターを持つ。時刻・乱数はcoreへの入力とし、回答保存は一つのトランザクションが完了してから画面へ反映する。取得済みの題庫・SVG・草稿・ユーザー・学習履歴・設定を新形式バックアップで保存できる。

## 仕様と検証

- [設計・規範契約](doc/domain-contract.md)
- [TypeScript化の計画と変換棚卸し](doc/typescript-web-plan.md)
- [問題ファイルv3](doc/questionJSON.v3.md)、[ruby・gloss記法](doc/ruby.md)
- [SVG安全化と図のレイアウト](doc/svg-subset.md)
- [草稿エディター](doc/editor.md)、[開発補助CLI](doc/cli-usage.md)
- [草稿取込・Ruby Buffer・共有と出典](doc/web-tools.md)
- [配信範囲・更新・公開手順](doc/deployment.md)
- [OGP専用PHP配信と検証](doc/ogp.md)、[要件別の受け入れ状況](doc/acceptance.md)
- [全体計画と公開前の残件](https://github.com/bem130/quiz/issues/38)

型検査・単体検証・build・Chromium/Firefox/WebKitの検証はそれぞれ独立して実行する。iOS SafariとAndroid Chromeの実機確認、読み上げ、OGPのPHP/GD実環境確認は自動テストとは別に記録する。Pagesはソフトウェア検証完了後に手動workflowで公開し、実機確認は公開されたPages URLで行う。実機用の別経路は設けない。
