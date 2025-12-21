# CLI ツールの使い方

Web アプリと同じクイズ定義・問題生成ロジックを利用する CLI を用意しています。問題ファイル、pattern ID、出題数を指定すると、問題文・選択肢・Tips を表示します。

## 事前準備

Node.js 18 以降を利用してください。プロジェクト直下で次のコマンドを実行すると CLI を呼び出せます。

```sh
npm run cli -- --file <path/to/quiz.json> --pattern <patternId> --count <number>
```

例: サンプルの v3 クイズから 2 問を生成する場合:

```sh
npm run cli -- --file data/sample/math-v3.json --pattern p_def_to_term --count 2
```

## オプション

- `--file` / `-f`: v3 クイズ定義 JSON のパスまたは URL。
- `--pattern` / `-p`: 出題に使う pattern の ID（ファイル内の `id` か `file::id` のどちらでも指定可能）。
- `--count` / `-c`: 表示する問題数。pattern のキャパシティを超える場合は上限まで自動で切り詰めます。

## 出力内容

- 問題文（改行を含むテキスト形式）
- 各解答枠の選択肢（正解には `[正解]` を付与）
- pattern に定義された Tips（テキスト化して表示。存在しない場合は `Tips: なし`）
