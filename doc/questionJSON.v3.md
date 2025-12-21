# クイズ問題ファイル仕様 v3

この文書は、アミノ酸などの知識を扱う 4 択クイズ／マッチング問題のための **問題定義 JSON 仕様 v3** を定義します。

* 仕様パートでは、

  * **どう書くか（記述ルール）**
  * **エンジンがどう処理するか（処理ルール）**
    を分けて説明します。
* 例パートでは、実際の JSON 例を示します。

---

## 1. 全体概要

### 1.1 対象範囲

本仕様は、次の 3 種類の問題形式をサポートします：

1. **table_fill_choice**
   table から生成する **n 択穴埋め問題**（典型的には 4 択）
2. **table_matching**
   table から生成する **マッチング問題（対応付け問題）**
3. **sentence_fill_choice**
   table の各行に持たせた文（tokens）から生成する **n 択穴埋め問題**

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
  * Token の `text.value` や `content.value`

* 逆に、`id` や `type`、`field` など **識別子・キー用途の文字列**には使いません。
* 記法は `content` の Gloss / Ruby と同一です（詳細は `doc/ruby.md` を参照）。
* KaTeX の数式記法は **`content` トークンのみ**でサポートします。

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
* `table_fill_choice` / `table_matching` / `sentence_fill_choice` のすべてで利用されます。
* `entityFilter` / `propertyFilter` の対象になります。

### 3.2 sentence_fill_choice 用の行

#### 記述

`questionFormat: "sentence_fill_choice"` では、`table` の各行に `tokens` を持たせます：

```jsonc
{
  "id": "row_sentence_01",
  "tokens": [ /* Token[] */ ]
  // 必要に応じて desc, mnemonic などのフィールドを追加してもよい
}
```

#### 処理

* エンジンは `table` から 1 行を選び、その `tokens` を問題文として使用します。

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

  "questionFormat": "table_fill_choice" | "table_matching" | "sentence_fill_choice",

  "entityFilter": { /* Filter */ },  // 任意

  "tokens": [ /* Token[] */ ],       // table_fill_choice で使用

  "matchingSpec": { /* matching 用 */ },

  "tips": [ /* TipBlock[] */ ]       // 任意
}
```

**questionFormat ごとのルール：**

* `"table_fill_choice"`

  * 必須：

    * `tokens`（文と `hide` を含む Token 配列）
  * 任意：

    * `entityFilter`
  * 役割：

    * table 行から 1 行を選び、その行をもとに **n 択穴埋め問題** を生成

* `"table_matching"`

  * 必須：

    * `matchingSpec`（マッチング設定）
  * 任意：

    * `entityFilter`（出題対象とする行の絞り込み）
    * `tokens`（問題文用のテキスト；`hide` は通常使用しない）
  * 役割：

    * table 行から複数行を選び、左右を対応付けさせる **マッチング問題** を生成

* `"sentence_fill_choice"`

  * 必須：

    * table 行に `tokens` が存在すること
  * 役割：

    * table の 1 行から `tokens` を取り出し、その `tokens` 中の `hide` に対して **n 択穴埋め問題** を生成

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
      { "type": "text", "value": "🎉 正解！豆知識：" },
      { "type": "br" },
      { "type": "key",  "field": "desc" },
      { "type": "br" },
      { "type": "text", "value": "語源メモ：" },
      { "type": "br" },
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

* エンジンは Pattern ごとに `questionFormat` を読み取り、問題生成ルートを切り替えます：

  * `table_fill_choice` → `tokens` を展開し、各 `hide` から Answer を生成
  * `table_matching` → `matchingSpec` に従いマッチング問題を構成
  * `sentence_fill_choice` → table 行の `tokens` を使用
* `entityFilter` は `table_fill_choice` / `table_matching` の両方で任意に利用でき、

  * 同じ table に対しても Pattern ごとに異なる Filter を設定することで、

    * 「酸性アミノ酸だけ」「芳香族だけ」「全体」など、**分野別 Pattern** を簡単に作ることができます。

---

## 5. Token 仕様

### 5.1 共通

#### 記述

すべての Token は次の基本構造を持ちます：

```jsonc
{
  "type": "text" | "content" | "key" | "ruby" | "katex" | "smiles" | "hide" | "br",
  "styles": ["bold", "italic", "sans", "serif"] // 任意
}
```

#### 処理

* `type` に応じて描画ロジックを切り替えます。
* `styles` はフォントスタイルなどの装飾ヒントとして使用します。
* v3 では上記 4 種類のスタイル名のみを正式サポートとし、それ以外の値は無視して構いません（将来拡張用）。

---

### 5.2 `text` / `br`

#### 記述

```jsonc
{ "type": "text", "value": "略号 " }
{ "type": "br" }
```

* `text` は固定文字列（Ruby / Gloss 記法を含めてよい）
* `br` は改行

#### 処理

* `text.value` は Ruby / Gloss を解釈して表示（v3 では全テキストで有効）
* `br` は `<br>` 相当の改行として表示

---

### 5.3 `content`（リッチテキスト）

#### 記述

```jsonc
{
  "type": "content",
  "value": "[数学/すうがく]B：[等比数列/とうひすうれつ]の[漸化式/ぜんかしき]"
}
```

* `value`: 特殊な記法を含む文字列
* `block`: `true` の場合、全体を `<div>` で囲み、ブロック要素として扱います（省略時は `false` = インライン）。
* v3 では Ruby / Gloss 記法は `text` 系の文字列でも使えますが、**数式やブロック表示が必要な場合は `content` を使用**します。

#### 記法ルール

1. **Gloss（用語/併記）**: `{Base/Alt1/Alt2}` の形式で記述します。

   * ベース部分（Base）には Ruby 記法を含めることができます。
   * 併記部分（Alt1/Alt2...）は省略可能で、複数言語の併記もできます。
   * 併記部分はベースの下に 1 行で並べ、長い場合は折り返します。

   * 例: `{[漸化式/ぜんかしき]/recurrence relation}`

     → `<span class="gloss"><ruby><rb>漸化式</rb><rt>ぜんかしき</rt></ruby><span class="gloss-alts"><span class="gloss-alt">recurrence relation</span></span></span>`

   * 例: `{専門用語}` → `<span class="gloss"><ruby><rb>専門用語</rb><rt></rt></ruby></span>`

   * 併記部分でも Ruby 記法を使用できます（例: `{[台湾/たいわん]/[台灣/Taiwan]}`）。

   * `{` `}` `/` を文字として使いたい場合は `\` でエスケープします（例: `\{`, `\}`, `\/`）。

2. **Ruby（ルビ）**: `[Base/Reading]` の形式で記述します。
   * 例: `[漢字/かんじ]` → `<ruby><rb>漢字</rb><rt>かんじ</rt></ruby>`
   * `[` `]` `/` を文字として使いたい場合は `\` でエスケープします（例: `\[`, `\]`, `\/`）。

3. **KaTeX（数式）**: `$` で囲むとインライン数式、`$$` で囲むとブロック数式になります。
   * 例: `$a_n = a_1 r^{n-1}$` → インライン数式
   * 例: `$$ \sum_{k=1}^n k $$` → ブロック数式

#### 処理

* パーサーが `value` を解析し、Ruby タグや KaTeX レンダリングを適用して表示します。
* `text` トークンよりも柔軟な表現が可能です。
* `block: true` が指定された場合、生成される HTML 要素が `div` となり、スタイル適用時にブロックとして振る舞います。

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

#### 処理

* 現在のコンテキストが table 行であれば `row[field]` を取得して表示します。
* 指定フィールドが存在しない場合：

  * 値は空文字列として扱うか、その Pattern をスキップするかは実装ポリシーですが、
  * 少なくとも警告ログを出すことを推奨します。

---

### 5.5 `ruby`

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

### 5.6 `katex`

#### 記述

```jsonc
{ "type": "katex", "value": "\\int_a^b f(x)\\,dx" }
```

* KaTeX 用の数式文字列を直接指定します。

#### 処理

* `value` を KaTeX としてレンダリングします。

---

### 5.7 `smiles`

#### 記述

```jsonc
{ "type": "smiles", "value": "NCC(=O)O" }
```

* SMILES 文字列を指定します。

#### 処理

* 実装側で化学構造描画に利用します（存在しない場合は生文字列表示でもよい）。

---

### 5.8 `hide`

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

v3 で使用する `answer.mode` は次の 3 種類です：

| mode                             | 使用可能な questionFormat              | 用途                         |
| -------------------------------- | --------------------------------- | -------------------------- |
| `"choice_from_entities"`         | `"table_fill_choice"`, `"sentence_fill_choice"` | 表の行から正解＋誤答を選ぶ n 択          |
| `"choice_unique_property"`       | `"table_fill_choice"`, `"sentence_fill_choice"` | 特定プロパティを満たす行を 1 つだけ含む n 択  |
| `"matching_pairs_from_entities"` | `"table_matching"`（Pattern 全体で使用） | 表から作るマッチング問題（hide では使わない）  |

**共通ポリシー：**

* すべてボタン選択（クリック／タップ）方式
* 1 つの選択肢に対する正解は 1 つのみ
* 部分点なし

> `"matching_pairs_from_entities"` は **Pattern の `matchingSpec` 専用**モードであり、`hide.answer.mode` として使用することはありません。

---

### 6.3 `choice_from_entities`

#### 記述

```jsonc
"answer": {
  "mode": "choice_from_entities",
  "choiceCount": 4,
  "distractorSource": {
    "scope": "filtered",
    "count": 3,
    "avoidSameId": true,
    "avoidSameText": true
  }
}
```

* `choiceCount`: 実際に表示する選択肢の個数（正解 + 誤答）
* `distractorSource`: 誤答候補の取り方を指定するオブジェクト

  * `scope?: "filtered" | "all"`

    * 誤答候補をどの範囲から取るかを指定します。
    * 省略時は `"filtered"` とみなします。
    * `"filtered"`:

      * Pattern の `entityFilter` を適用した **出題対象行集合** をもとに誤答候補を選びます。
    * `"all"`:

      * table 全体の行集合をもとに誤答候補を選びます。
  * `count`: 誤答候補として必要な行数
  * `avoidSameId`: 正解行と同じ `id` を持つ行を誤答候補から除外するか
  * `avoidSameText`: 正解表示と同じテキストを持つ候補を除外するか（同じ表示内容の選択肢を避ける）

#### 処理

1. Pattern の `entityFilter` を table に適用し、**出題対象行集合** `rowsFiltered` を得る。
2. `rowsFiltered` から、現在の問題で使用している **正解行** `correctRow` を 1 行特定する。
3. 誤答候補の母集合 `rowsForDistractors` を決める：

   * `distractorSource.scope === "all"` の場合：

     * table 全体の行集合 `rowsAll` を用いる（`entityFilter` 未適用）。
   * それ以外（省略または `"filtered"`）の場合：

     * `rowsFiltered` を用いる。
4. `rowsForDistractors` から、以下のフィルタを適用して **誤答候補集合** `rowsCandidates` を得る：

   * `avoidSameId === true` の場合：

     * `row.id === correctRow.id` の行を除外。
   * `avoidSameText === true` の場合：

     * `hide.value` をレンダリングしたテキストと同じ表示になる候補を除外。

       * ここでの「表示テキスト」は、`hide.value` の Token 配列を実際に描画したときの文字列を想定。
5. `rowsCandidates` から、`distractorSource.count` 行をランダムに選び、誤答候補とする。
6. 正解 1 行 + 誤答候補行を 1 つの配列にし、ランダムシャッフルして `choiceCount` 個の選択肢として使用する。

#### `choiceCount` と `distractorSource.count` の関係

* 基本ルール：

  * `choiceCount` 個の選択肢のうち、1 つが正解で残りは誤答とする。
  * `distractorSource.count` を省略した場合は、`choiceCount - 1` とみなしてよい。
* `distractorSource.count + 1 !== choiceCount` の場合：

  * 実装側で `choiceCount` を優先し、`min(choiceCount - 1, distractorSource.count)` 個の誤答を採用することを推奨。
  * 不整合があった場合は `console.warn` などで警告を出すとよい。

#### スキップ条件

* 利用可能な誤答候補が必要数（`distractorSource.count`）未満の場合 → 問題生成をスキップします。

---

### 6.4 `choice_unique_property`

#### 記述

特定のプロパティ条件を満たす行が **選択肢中でちょうど 1 行だけ**になるような問題を作るモードです。

```jsonc
"answer": {
  "mode": "choice_unique_property",
  "choiceCount": 4,
  "propertyFilter": {
    "eq": { "field": "carboxylic", "value": true }
  }
}
```

* `propertyFilter`: 行に対する条件（`Filter` と同じ構造）

#### 処理

1. `entityFilter` を table に適用し、候補行集合 `rows` を得る。
2. `propertyFilter` を `rows` に適用し、

   * 条件を満たす行集合 `rowsTrue`
   * 条件を満たさない行集合 `rowsFalse`
   を得る。
3. `rowsTrue` から 1 行を正解として選び、`rowsFalse` から誤答候補を選ぶ。

#### 一意性の厳密条件

* `choice_unique_property` という名前どおり、**選択肢中で `propertyFilter` を満たす行は必ず 1 行だけ**でなければなりません。
* したがって、`rowsTrue.length === 1` の場合のみ問題を生成する、という運用も考えられますが、

  * v3 では、「候補全体では複数存在していても、選択肢として採用するのは 1 行だけ」という挙動を正とします。
  * ただし、`rowsTrue.length === 0` の場合や `rowsFalse.length < choiceCount - 1` の場合はスキップします。

---

### 6.5 `matchingSpec` の仕様

#### 記述

`questionFormat: "table_matching"` の Pattern で使用されます：

```jsonc
"matchingSpec": {
  "mode": "matching_pairs_from_entities",

  "leftField": "nameJa",
  "rightField": "classJa",

  "count": 4,

  "shuffle": {
    "left": false,
    "right": true
  }
}
```

* `mode`: 現時点では `"matching_pairs_from_entities"` のみサポート。
* `leftField`: 左側リストに表示するフィールド名。
* `rightField`: 右側リストに表示するフィールド名。
* `count`: 何組のペアを出題するか。
* `shuffle`:

  * `left: boolean` （省略時 `false`）
  * `right: boolean`（省略時 `true`）
  * 左右どちらをシャッフルするかを制御する。

#### 処理

1. `entityFilter` を table に適用し、候補行 `rows` を得る。
2. `rows.length < count` の場合 → 出題不可能 → スキップ。
3. `rows` から `count` 行をランダムに選び、`selected` とする。
4. `leftList` を作成：

   * 基本は `selected` の順番どおりに `leftField` を取り出す。
   * `shuffle.left === true` の場合は、`selected` の順自体をシャッフルしてから `leftField` を生成。
5. `rightList` を作成：

   * `selected` の `rightField` を取り出した配列を作る。

---

## 7. Filter 仕様

### 7.1 Filter トップレベル

#### 記述

Filter は `entityFilter` や `propertyFilter` で使用される条件式です：

```jsonc
{ "eq": { "field": "classJa", "value": "酸性" } }
```

複数条件は `and` / `or` / `not` で組み合わせます。

---

### 7.2 Filter の種類

#### `eq` / `neq`

```jsonc
{ "eq":  { "field": "carboxylic", "value": true } }
{ "neq": { "field": "classJa", "value": "酸性" } }
```

* `row[field] === value` / `row[field] !== value` で評価。

#### `in` / `notIn`

```jsonc
{ "in":    { "field": "classJa", "values": ["酸性", "塩基性"] } }
{ "notIn": { "field": "classJa", "values": ["中性"] } }
```

* `row[field]` が集合に含まれるかで評価。

#### `exists`

```jsonc
{ "exists": { "field": "mnemonic" } }
```

* 指定フィールドが存在するかで評価。

#### `and` / `or` / `not`

```jsonc
{ "and": [ { /* Filter */ }, { /* Filter */ } ] }
{ "or":  [ { /* Filter */ }, { /* Filter */ } ] }
{ "not": { /* Filter */ } }
```

* `and`: すべて true のとき true
* `or`: いずれか true のとき true
* `not`: 逆転

#### 処理

* `entityFilter` は table から出題対象行を絞り込みます。
* `propertyFilter` は Answer 生成時に使用されます。

---

## 8. 例（v3）

`data/sample/math-v3.json` を参照してください。
