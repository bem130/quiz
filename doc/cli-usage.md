# CLI ツールの使い方

Web アプリと同じクイズ定義・問題生成ロジックを利用する CLI を用意しています。問題ファイル、pattern ID、出題数を指定すると、問題文・選択肢・Tips を表示します。

## 事前準備

Node.js 24.14.1（24系）を利用し、`npm ci` を実行してください。CLIはブラウザとは別の製品ではなく、同じ純粋なschema・出題エンジンを確認する開発補助です。DOM、IndexedDB、画像描画は実行しません。

```sh
npm run cli -- --file <path/to/quiz.json> --pattern <patternId> --count <number>
```

例: サンプルの v3 クイズから 2 問を生成する場合:

```sh
npm run cli -- --file data/sample/math-v3.json --pattern p_def_to_term --count 2
```

## オプション

- `--file` / `-f`: v3 クイズ定義 JSON のパスまたは URL。
- `--pattern` / `-p`: 出題に使う pattern のファイル内 `id`。内部の正規化済みPatternIdも指定可能です。旧 `file::id` 形式は対象外です。
- `--count` / `-c`: 表示する問題数。pattern のキャパシティを超える場合は上限まで自動で切り詰めます。
- `--seed`: 再現用の文字列。省略時は `quiz-cli`。題庫・pattern・seedが同じなら問題と選択肢の順序が一致します。

## 出力内容

- 問題文（改行を含むテキスト形式）
- 一つの解答欄の選択肢（正解には `[正解]` を付与）
- pattern に定義された Tips（テキスト化して表示）

入力はWeb版と同じv3検証を通します。出題不能、未知のpattern、不正JSON、取得失敗は終了コード1です。SVG・SMILESは代替テキストで表示するため、レイアウトと安全化の検証には実ブラウザを使ってください。
