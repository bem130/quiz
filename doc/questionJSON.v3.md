# クイズ問題ファイル仕様 v3

この文書は、アミノ酸などの知識を扱う 4 択クイズのための **問題定義 JSON 仕様 v3** を定義します。

* 仕様パートでは、

  * **どう書くか（記述ルール）**
  * **エンジンがどう処理するか（処理ルール）**
    を分けて説明します。
* 例パートでは、実際の JSON 例を示します。

---

## 1. 全体概要

### 1.1 対象範囲

本仕様は、table から生成する **4 択穴埋め問題**（不足時は 3 択 / 2 択）のみをサポートします。

共通ポリシー：

* 解答はすべて **ボタン選択式**（記述式はなし）
* 1 つの選択肢に対する正解は常に **1 つ**
* 部分点はなし（完全正解のみ）

### 1.2 ファイル種別

v3 で扱う JSON ファイルは **1 種類のみ**です：

* **Quiz File（単一ファイル）**

  * `title`, `description`, `version`, `table`, `patterns` を持つ
  * `imports`, `dataSets`, `questionRules`, `modes` は **廃止**

### 1.3 問題ファイル一覧とメニュー生成（v3）

v3 では、**問題ファイルの選択肢をディレクトリ構造で生成**します。
エントリ（`entry.php` / `entry.py` など）は、**問題ファイル JSON のパスのみ**を返します。
クライアントはこのパス配列を基に木構造メニューを再帰的に組み立てます。

#### 記述（entry から返す JSON の最小形）

```jsonc
{
  "version": 3,
  "files": [
    "./data/quizzes/biology/amino/basic.json",
    "./data/quizzes/biology/amino/advanced.json",
    "./data/quizzes/chemistry/organic.json"
  ]
}
```

* `files` は **Quiz File へのパス配列**です（相対パス推奨）。
* パスは `/` 区切りで、クライアント側で OS に応じて解釈します。
* `files` は **再帰的にディレクトリを含む**形で列挙して構いません。

#### 処理（メニュー生成）

1. `files` の各パスを `/` で分割し、ディレクトリ階層の木を作成する。
2. パスの末尾（ファイル名）を **ファイルノード**として木に追加する。
3. ファイルノード配下に、その JSON の `patterns` を **葉ノード（pattern）**として追加する。
4. ユーザーは **任意の深度のノード**を選択できる。

**選択範囲の解釈：**

* ディレクトリノードを選ぶ → その配下にある **全ファイルの全 pattern** を出題対象にする。
* ファイルノードを選ぶ → そのファイルの **patterns 全体**を出題対象にする。
* pattern ノードを選ぶ → その pattern のみを出題対象にする（最小範囲）。

**複数ファイル選択時の扱い：**

* pattern の識別子は **ファイル単位でスコープ**されるとみなし、`(filePath, pattern.id)` の組で扱うことを推奨します。
* `table` は **ファイルごとに解決**し、ファイル間で混在させないことを推奨します。

**表示名の推奨：**

* ディレクトリノード：ディレクトリ名
* ファイルノード：ファイル名（拡張子除去）
* pattern ノード：`pattern.label`（未指定時は `pattern.id`）

---

## 2. Quiz File

### 2.1 トップレベル構造

#### 記述

Quiz File のトップレベルは、次のフィールドを持つオブジェクトです：

```jsonc
{
  "title": "Amino Acid Master Quiz",  // 必須
  "description": "説明",              // 必須
  "version": 3,                         // 推奨（仕様バージョン）

  "table": [ /* Row[] */ ],             // 必須
  "patterns": [ /* Pattern[] */ ]       // 必須
}
```

* `title`, `description` は必須のメタ情報（UI 表示などに使用）
* `version` は**本仕様バージョン**を表す整数です

  * v3 仕様では **`3` を推奨**
  * 省略された場合は `3` と同等とみなして構いません
  * `3` 以外の値が指定されている場合は、少なくとも警告ログを出すことを推奨します
* `table` は **1 ファイルに 1 つだけ**定義します（複数不可）
* `patterns` は問題生成ルールの集合です
* v3 では `imports` / `dataSets` / `questionRules` / `modes` を使用しません（存在する場合は警告または無視）

#### 処理

* Quiz File 読み込み時に、`table` と `patterns` を使用して問題生成を行います。

---

### 2.2 テキスト記法（v3）

#### 記述

v3 では、**UI 表示用の文字列フィールドのすべて**で ruby 記法と gloss 記法を利用できます。

* 対象となる主なフィールド例：

  * `title`, `description`
  * `label`（Pattern など）
  * 文字列トークンや Token の文字列値

* 逆に、`id` や `type`、`field` など **識別子・キー用途の文字列**には使いません。
* 記法の詳細は `doc/ruby.md` を参照してください。
* KaTeX の数式記法は **文字列トークン**（`$...$` / `$$...$$`）および `katex` トークンでサポートします。

#### 処理

* 対象フィールドは ruby / gloss のパーサーで解釈し、HTML の ruby 表現として描画します。
* パーサー未対応環境では生文字列として表示しても構いませんが、可能な限り対応を推奨します。

---

## 3. Table 仕様

### 3.1 Table の構造

#### 記述

`table` は行オブジェクトの配列です：

```jsonc
"table": [
  {
    "id": "row_001",      // 必須、一意
    "nameJa": "...",     // 任意フィールド
    "definition": "..."  // 任意フィールド
  }
]
```

* 各行に `id: string` が必須
* それ以外のフィールドは自由に追加可能（`desc`, `mnemonic` などの補足情報も含む）

#### 処理

* `id` をキーとして内部 Map に変換して保持しても構いません。
* table を使った問題生成で利用されます。

### 3.2 選択肢グループ（任意）

#### 記述

「条件を満たす候補が複数あるが、選択肢には同時に 1 つだけ表示したい」場合は、
table 行に **選択肢グループ用のフィールド**を追加します。

```jsonc
{
  "id": "row_001",
  "choiceGroup": "acid",
  "nameJa": "...",
  "definition": "..."
}
```

* フィールド名は任意ですが、`choiceGroup` のように分かりやすい名前を推奨します。
* `hide.answer.distractorSource.groupField` で、このフィールド名を参照します。

#### 処理

* `groupField` が指定されている場合、正解行と同じグループ値を持つ行は誤答候補から除外されます。

---

### 3.3 複数正答（集合）の表現

#### 記述

「～に当てはまるものの 1 つを選べ」のように **正答が複数ある**場合は、
同じ条件を共有する複数行を用意し、`choiceGroup` で同一集合として扱います。

```jsonc
{
  "id": "set1",
  "conditionTokens": [ /* 条件文 */ ],
  "answersTokens": [
    [ /* 正答その1 */ ],
    [ /* 正答その2 */ ]
  ]
}
```

* `answersTokens`: **正答集合**（Token[][]）
* 正答が 1 つだけの行は `Token[]` または文字列のフィールドを用意し、`key` で参照します。
* 複数正答は `answersTokens` を使い、`listkey` で参照します。

#### listkey の表示（区切りは pattern 側で指定）

```jsonc
{ "type": "listkey", "field": "answersTokens", "separatorTokens": ["、"] }
```

* `separatorTokens` に「、」「・」などを指定して連結します。
* 区切りは table ではなく **pattern 側で指定**します。

#### 使い方（hide 側）

```jsonc
{
  "type": "hide",
  "id": "answer_main",
  "value": [{ "type": "listkey", "field": "answersTokens" }],
  "answer": {
    "mode": "choice_from_entities",
    "distractorSource": {
      "groupField": "choiceGroup"
    }
  }
}
```

* 必要であれば `choiceGroup` を付与し、同じ `choiceGroup` を持つ行が
  **誤答候補から除外**されるようにできます。

---

## 4. Patterns 構造

### 4.1 patterns トップレベル

#### 記述

```jsonc
"patterns": [ /* Pattern[] */ ]
```

#### 処理

* クイズ開始時に、ユーザーが選択した **ディレクトリ／ファイル／pattern** から出題対象となる Pattern 集合を決定します。
* エンジンは、決定された Pattern 集合から問題を生成します。
* 重み付け指定がないため、出題比重は **均等**とします（将来拡張の余地）。

---

### 4.2 Pattern

#### 記述

`Pattern` は 1 種類の問題の「ひな形」を定義します：

```jsonc
{
  "id": "p_abbr_to_name",
  "label": "略号 → 名前",

  "tokens": [ /* Token[] */ ],       // 必須

  "tips": [ /* TipBlock[] */ ]       // 任意
}
```

**ルール：**

* `tokens` は **必須**です。
* `tokens` の中に `hide` を含め、**4 択穴埋め問題**を定義します。

#### tips フィールド（TipBlock）の仕様

* `tips` は **解答後に表示する小ネタ・補足情報（トリビア）** を定義する配列です。
* 型は **`TipBlock[]`** です。
* `TipBlock` は次のようなオブジェクトです：

```jsonc
"tips": [
  {
    "id": "t_abbr_correct",
    "when": "after_correct",
    "tokens": [
      "🎉 正解！豆知識：\n",
      { "type": "key",  "field": "desc" },
      "\n\n",
      "語源メモ：\n",
      { "type": "key",  "field": "mnemonic" }
    ]
  }
]
```

* `TipBlock` フィールド：

  * `id: string`

    * Pattern 内で一意な Tips の識別子（ログやデバッグ用）
  * `when?: "after_answer" | "after_correct" | "after_incorrect"`

    * **表示タイミング**を指定します。
    * 省略時は `"after_answer"` とみなします。

      * `"after_answer"`: 正解・不正解に関わらず解答後に表示
      * `"after_correct"`: 正解時のみ表示
      * `"after_incorrect"`: 不正解時のみ表示
  * `tokens: Token[]`

    * 実際に表示される小ネタテキストを Token 配列で表現します。

#### 処理

* エンジンは table から 1 行を選び、`tokens` を展開して各 `hide` から Answer を生成します。

---

## 5. Token 仕様

### 5.1 共通

#### 記述

Token は **文字列**または次のオブジェクト形式です：

```jsonc
{
  "type": "key" | "listkey" | "ruby" | "katex" | "smiles" | "hide" | "br" | "hr",
  "styles": ["bold", "italic", "sans", "serif"] // 任意
}
```

#### 処理

* 文字列トークンは旧 `content` と同等に扱います。
* オブジェクトトークンは `type` に応じて描画ロジックを切り替えます。
* `styles` はフォントスタイルなどの装飾ヒントとして使用します。
* v3 では上記 4 種類のスタイル名のみを正式サポートとし、それ以外の値は無視して構いません（将来拡張用）。

---

### 5.2 文字列トークン

#### 記述

```jsonc
"略号 "
"[日本語/にほんご]と{英語/English}"
"$a^2 + b^2 = c^2$"
```

* 文字列は Ruby / Gloss / KaTeX 記法を含めてよい
* 文字列中の改行（`\n`）は `<br>` 相当として表示します

#### 処理

* 文字列を解析し、Ruby タグや KaTeX レンダリングを適用して表示します。
* 旧 `content` と同様に、柔軟な表現が可能です。

---

### 5.3 `br` / `hr`

#### 記述

```jsonc
{ "type": "br" }
{ "type": "hr" }
```

* `br` は改行
* `hr` は区切り線（水平線）

#### 処理

* `br` は `<br>` 相当の改行として表示します。
* `hr` は `<hr>` 相当の区切り線として表示します。

---

### 5.4 `key`

#### 記述

```jsonc
{
  "type": "key",
  "field": "nameJa",
  "styles": ["bold"]
}
```

* `field`: 現在の行（table の 1 行）から参照するフィールド名
* `Token[][]` を参照する場合は `listkey` を使用します。

#### 処理

* 現在のコンテキストが table 行であれば `row[field]` を取得して表示します。
* 指定フィールドが存在しない場合：

  * 値は空文字列として扱うか、その Pattern をスキップするかは実装ポリシーですが、
  * 少なくとも警告ログを出すことを推奨します。

---

### 5.5 `listkey`

#### 記述

```jsonc
{
  "type": "listkey",
  "field": "answersTokens",
  "separatorTokens": ["、"]
}
```

* `field`: `Token[][]` を格納した table フィールド名
* `separatorTokens`: 要素どうしを連結する区切り Token 配列（省略可）
  * 文字列トークンを使うのが簡潔です。

#### 処理

* 通常の表示では、`Token[][]` の各要素を順に描画し、`separatorTokens` で連結します。
* `hide.value` の中で使われた場合は、配列から **1 要素を選んで**正答として扱います。

---

### 5.6 `ruby`

#### 記述

```jsonc
{
  "type": "ruby",
  "base": { "type": "key", "field": "nameEnCap" },
  "ruby": { "type": "key", "field": "nameJa" }
}
```

* `base`: 本体（英語名など）
* `ruby`: ルビ（日本語名など）

#### 処理

* HTML の ruby 表現などで表示します：

  * `<ruby><rb>Glycine</rb><rt>グリシン</rt></ruby>` のような形

#### 制約

* `ruby.base` および `ruby.ruby` の内部には **`type: "hide"` を含めてはいけません**
  （ruby の中に更なる穴埋めを作ることは禁止）。
* 一方、`hide.value` の配列の中に `type: "ruby"` の Token を 1 要素として含めること
  （ruby 付きテキスト全体を 1 つの穴埋めとして扱うこと）は **許可** されます。

---

### 5.7 `katex`

#### 記述

```jsonc
{ "type": "katex", "value": "\\int_a^b f(x)\\,dx" }
```

* KaTeX 用の数式文字列を直接指定します。

#### 処理

* `value` を KaTeX としてレンダリングします。

---

### 5.8 `smiles`

#### 記述

```jsonc
{ "type": "smiles", "value": "NCC(=O)O" }
```

* SMILES 文字列を指定します。

#### 処理

* 実装側で化学構造描画に利用します（存在しない場合は生文字列表示でもよい）。

---

### 5.9 `hide`

#### 記述

`hide` は穴埋め部分の定義です：

```jsonc
{
  "type": "hide",
  "id": "h1",                  // 必須
  "value": [ /* Token[] */ ],  // 必須
  "answer": { /* Answer */ }   // 必須
}
```

* `id`: その問題内で一意な識別子
* `value`: 正答テキストを表す Token 配列
* `answer`: 出題方式（選択肢生成ルール）

#### 処理

* 画面上では `value` の代わりに空欄（あるいは下線）を表示します。
* 正解は `value` から生成されます。
* `value` に `listkey` が含まれる場合、`Token[][]` から **1 要素を選んで**正解とします。

#### 制約

* `hide` の内部（`value` 内）にさらに `hide` を含めることは **禁止** です。

---

## 6. Answer 仕様

### 6.1 AnswerPart の概念

#### 記述

* 1 つの `hide` ごとに 1 つの AnswerPart が存在します。
* AnswerPart には、少なくとも次の情報が含まれます（実装依存）：

  * `id`: 対応する `hide.id`
  * `mode`: 解答モード
  * `options`: 選択肢配列
  * `correctIndex`: 正解選択肢の index
  * `userSelectedIndex`: ユーザーが選んだ index（実行時）

#### 処理

* 採点時には `correctIndex` と `userSelectedIndex` を比較し、正解・不正解を判定します。
* 本仕様では部分点を考慮しないため、複数 AnswerPart がある問題も「すべて正解なら問題正解」として扱う運用が可能です（実装ポリシーによる）。

---

### 6.2 `answer.mode` 一覧（v3）

#### 記述

v3 で使用する `answer.mode` は次の 1 種類です：

| mode                     | 用途                         |
| ------------------------ | -------------------------- |
| `"choice_from_entities"` | 表の行から正解＋誤答を選ぶ 4 択          |

**共通ポリシー：**

* すべてボタン選択（クリック／タップ）方式
* 1 つの選択肢に対する正解は 1 つのみ
* 部分点なし

### 6.3 `choice_from_entities`

#### 記述

```jsonc
"answer": {
  "mode": "choice_from_entities",
  "distractorSource": {
    "groupField": "choiceGroup"
  }
}
```

* 選択肢数は **原則 4 択**で固定です（指定しない）。
  * 誤答候補が足りない場合は **3 択 / 2 択にフォールバック**します。
* `distractorSource`: 誤答候補の取り方を指定するオブジェクト

  * `groupField?: string`:

    * 値が指定された場合、`row[groupField]` を **選択肢グループ**として扱います。
    * 正解行と同じグループ値を持つ行は誤答候補から除外されます。
    * 「条件を満たす候補が複数あるが、選択肢には同時に 1 つだけ表示したい」場合に使用します。

#### 処理

1. table 全体の行集合から、現在の問題で使用している **正解行** `correctRow` を 1 行特定する。
2. `hide.value` から正解を決める：

   * `key` → `row[field]` の Token[] をそのまま正解とする。
   * `listkey` → `row[field]` の Token[][] から **1 要素を選んで**正解とする。
3. **正解集合** `correctSet` を作る：

   * `listkey` の場合は `Token[][]` の各要素をレンダリングした表示テキスト集合。
   * `key` の場合は正解 1 つのみを集合に含める。
4. 誤答候補行集合 `rowsCandidates` を作る：

   * `row.id === correctRow.id` の行は除外。
   * `groupField` が指定され、`correctRow[groupField]` が定義されている場合は、
     `row[groupField] === correctRow[groupField]` の行を除外。
5. `rowsCandidates` から誤答候補を選ぶ：

   * `key` の場合は、その行の表示テキストが `correctSet` と一致する候補を除外。
   * `listkey` の場合は、**`correctSet` に含まれない要素**から 1 つ選び、候補とする。
     * 候補を選べない行は除外。
6. 正解 1 つ + 誤答候補を最大 3 つ選び、ランダムシャッフルして選択肢を作る。
   * 誤答が足りない場合は **3 択 / 2 択にフォールバック**する。

#### スキップ条件

* 利用可能な誤答候補が 0 件の場合 → 問題生成をスキップします。

---

## 7. 例（v3）

`data/sample/math-v3.json` を参照してください。
