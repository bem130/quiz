# クイズ問題ファイル仕様 v2

この文書は、アミノ酸などの知識を扱う 4 択クイズ／マッチング問題のための **問題定義 JSON 仕様 v2** を定義します。

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
   table 型 DataSet から生成する **n 択穴埋め問題**（典型的には 4 択）
2. **table_matching**
   table 型 DataSet から生成する **マッチング問題（対応付け問題）**
3. **sentence_fill_choice**
   一問一答形式の文（factSentences）から生成する **n 択穴埋め問題**

共通ポリシー：

* 解答はすべて **ボタン選択式**（記述式はなし）
* 1 つの選択肢に対する正解は常に **1 つ**
* 部分点はなし（完全正解のみ）

### 1.2 ファイル種別

本仕様で扱う JSON ファイルは 2 種類です：

1. **Main Quiz File**

   * 実際にクイズとして読み込まれるメインファイル
   * `imports`, `dataSets`, `questionRules` を持つ
2. **Data Bundle File（import 用ファイル）**

   * 共通の `dataSets` をまとめた部品ファイル
   * 他のファイルから `imports` されることを前提とする

---

## 2. Main Quiz File

### 2.1 トップレベル構造

#### 記述

Main Quiz File のトップレベルは、次のフィールドを持つオブジェクトです：

```jsonc
{
  "title": "Amino Acid Master Quiz",      // 必須
  "description": "説明",                  // 必須
  "version": 2,                             // 推奨（仕様バージョン）

  "imports": ["hoge.json", "fuga.json"], // 任意

  "dataSets": {                             // 任意
    "alpha-amino-acids": { /* DataSet */ }
  },

  "questionRules": {                        // 必須
    "patterns": [ /* Pattern[] */ ],
    "modes": [ /* Mode[] or ModeGroup[] */ ]
  }
}
```

* `title`, `description` は 必須のメタ情報（UI 表示などに使用）
* `version` は**本仕様バージョン**を表す整数です

  * v2 仕様では **`2` を推奨**
  * 省略された場合は `2` と同等とみなして構いません
  * `2` 以外の値が指定されている場合は、少なくとも警告ログを出すことを推奨します
* `imports` は Data Bundle File への相対パス配列
* `dataSets` は、このファイル固有の DataSet 群
* `questionRules` は問題生成ルール

  * `modes` には **Mode（葉ノード）** と **ModeGroup（type: "modes"）** を混在させることができます。
  * ModeGroup を使うと、UI でツリー状にモードを並べるための情報を保持できます。

#### 処理

* Main Quiz File 読み込み時に、

  1. `imports` に指定されたファイルを順に読み込み、`dataSets` をマージ
  2. メインファイル自身の `dataSets` を最後に適用
  3. 完成した `dataSets` と `questionRules` を用いて問題生成を行う

---

## 3. Data Bundle File（import 用）

### 3.1 トップレベル構造と制限

#### 記述

Data Bundle File は、主に共通データを提供する目的で用いられます。トップレベルの構造は次の通りです：

```jsonc
{
  "title": "Common Amino Acid Data",  // 任意（メタ情報）
  "description": "...",               // 任意（メタ情報）
  "version": 2,                        // 任意（仕様バージョンの目安）

  "dataSets": {
    "alpha-amino-acids": { /* DataSet */ },
    "amino-common-groups": { /* DataSet */ }
  }
}
```

**禁止事項：**

* Data Bundle File には `imports` を書いてはいけません（ネスト import 禁止）
* `questionRules` も書いてはいけません（ロジック定義は Main にのみ）

#### 処理

* Main Quiz File の `imports` から参照されたときのみ読み込まれます。
* 読み込み時：

  * `imports` が存在した場合はエラー（ネスト禁止）
  * `dataSets` が存在しない、または不正な場合もエラー
  * 不明なキーは、実装に応じて無視または警告とします

---

## 4. imports と dataSets のマージ

### 4.1 パス解決

#### 記述

* `imports` に記述するパスは、**Main Quiz File と同じディレクトリからの相対パス**として解釈されます。

  * 例：`quiz/main.json` から `"../common/hoge.json"` など
* パス区切りには `/` を推奨し、実装側で OS に応じて解決します。

#### 処理

* Main Quiz File のフルパスからディレクトリを求め、そのディレクトリを基準として `imports` のパスを解決します。

### 4.2 dataSets のマージと名前衝突

#### 記述

* 同じ DataSet ID が複数ファイルに存在することは許されますが、その場合は **優先ルール** に従って上書きされます。

#### 処理

1. 空の `mergedDataSets` を用意
2. `imports` に列挙されたファイルを **先頭から順に** 読み込み、それぞれの `dataSets` を `mergedDataSets` にマージ

   * 同じ ID が既に存在する場合：

     * **後から import されたファイルが前のものを上書き**
     * `console.warn` で「どの ID がどのファイルによって上書きされたか」をログ出力
3. 最後に Main Quiz File 自身の `dataSets` を `mergedDataSets` に適用

   * 同じ ID が存在する場合：

     * **メインファイルの定義が最終的に上書き**
     * `console.warn` で上書きログ

最終的に、エンジン内部では `mergedDataSets` が唯一の DataSet 辞書として使われます。

---

## 5. DataSet 仕様

### 5.1 共通フィールド

#### 記述

DataSet は `dataSets[<id>]` に格納されるオブジェクトです。共通の基本構造：

```jsonc
{
  "type": "table" | "factSentences" | "groups",  // 必須
  "label": "表示名",                                // 任意
  "description": "説明",                           // 任意

  // type ごとの追加フィールド
}
```

#### 処理

* `type` によって DataSet の構造と利用方法を切り替えます。
* バリデーション時には、`type` ごとに必要なフィールドを確認します。

---

### 5.2 `type: "table"`（表データ）

#### 記述

`table` DataSet は、行の配列 `data` を持ちます：

```jsonc
{
  "type": "table",
  "label": "α amino acids",
  "data": [
    {
      "id": "gly",               // 必須、一意
      "nameEnCap": "Glycine",    // 任意フィールド
      "nameEn": "glycine",
      "nameJa": "グリシン",
      "code3": "Gly",
      "classJa": "非極性",
      "carboxylic": false,
      "smiles": "NCC(=O)O",
      "sideChainFormulaTex": "\\ce{-H}"
    },
    {
      "id": "asp",
      "nameEnCap": "Aspartic acid",
      "nameEn": "aspartic acid",
      "nameJa": "アスパラギン酸",
      "code3": "Asp",
      "classJa": "酸性",
      "carboxylic": true,
      "smiles": "NCC(C(=O)O)C(=O)O",
      "sideChainFormulaTex": "\\ce{-CH2CO2H}"
    }
  ]
}
```

* 各行に `id: string` が必須
* それ以外のフィールドは自由に追加可能（`desc`, `mnemonic` などの小ネタ用フィールドも含む）

#### 処理

* `id` をキーとして内部 Map に変換して保持しても構いません。
* `table_fill_choice` / `table_matching` で利用されます。
* `Filter`（`entityFilter` や後述の `propertyFilter`）の対象にもなります。

---

### 5.3 `type: "factSentences"`（一問一答文）

#### 記述

一問一答形式の文と、その文中で使用する Group をまとめた DataSet です：

```jsonc
{
  "type": "factSentences",

  "sentences": [
    {
      "id": "proline_structure",
      "tokens": [ /* Token[] */ ]
      // 必要に応じて desc, mnemonic などのフィールドを追加してもよい
    }
  ],

  "groups": {
    "bondGroup": { /* GroupDefinition */ },
    "ringGroup": { /* GroupDefinition */ }
  }
}
```

* `sentences`: 一問一答の文を表す配列

  * 各要素は `id` と `tokens`（Token 配列）を持つ
  * 必要に応じて `desc`, `mnemonic` などの補足情報フィールドを持たせてもよい
* `groups`: その DataSet 内で使う `GroupDefinition` の集合（任意）

#### 処理

* `questionFormat: "sentence_fill_choice"` の Pattern で使用されます。
* Pattern 側で `tokensFromData: "sentences"` と指定することで、この DataSet の `sentences` から 1 件を選び、その `tokens` を問題文として使用します。
* `choice_from_group` の `answer.mode` で、`groups` 内の Group を参照して選択肢を生成します。

---

### 5.4 `type: "groups"`（共通グループ集）

#### 記述

複数の問題で共通して使用される選択肢グループをまとめる DataSet です：

```jsonc
{
  "type": "groups",
  "label": "Common groups",
  "groups": {
    "acidBaseClass": {
      "choices": ["酸性アミノ酸", "塩基性アミノ酸", "中性アミノ酸"],
      "mode": "choice"
    }
  }
}
```

#### 処理

* v2 では主に、`factSentences` 型 DataSet 内の `groups` を参照対象とし、`type: "groups"` DataSet は今後の拡張用として位置付けます。
* 参照スキームは `hide.array` の仕様に従います（同一 DataSet 内の `groups` を起点とする）。

---

## 6. Groups 仕様

### 6.1 GroupDefinition

#### 記述

`GroupDefinition` は次のようなオブジェクトです：

```jsonc
{
  "choices": ["アミノ基", "カルボキシル基", "水酸基"],
  "mode": "choice",
  "drawWithoutReplacement": true
}
```

* `choices: string[]`

  * 選択肢候補一覧（v2 では文字列配列を想定）
* `mode: string`

  * この Group の用途を示すメタ情報
  * v2 では主に `"choice"`（n 択候補）を使用
* `drawWithoutReplacement?: boolean`

  * true の場合、**1 問の中でこの Group から同じ要素 index を複数の `hide` 正解に使用しない**
  * 例：「○○に該当するのは ___ と ___ である」のように、同じ Group から 2 箇所の穴埋めに異なる要素を割り当てたい場合に利用

#### 処理

* `choice_from_group` の `answer.mode` で選択肢の候補として利用されます。
* `drawWithoutReplacement: true` の場合：

  * **1 問生成中に限り**、同じ `groupId` について「すでに正解として使った `choices` の index」を記録し、別の `hide` の正解には同じ index を割り当てないようにします。
  * 問題をまたぐ重複制御は行いません（v2 では規定しない）。

### 6.2 Group の参照パス（hide.array）

#### 記述

`hide` Token には、Group を参照するための `array` フィールドを指定できます：

```jsonc
{
  "type": "hide",
  "id": "bond",
  "value": [
    { "type": "text", "value": "アミノ基" }
  ],
  "array": ["groups", "bondGroup"],
  "answer": { "mode": "choice_from_group" }
}
```

* `array` は、**同じ DataSet 内のオブジェクトを辿るためのパス**です。
* v2 では `"groups"` を起点とする 2 要素配列を想定します：

  * `array: ["groups", "bondGroup"]` → `dataSet.groups["bondGroup"]`

#### 処理

1. Pattern から `dataSet` を特定
2. その DataSet オブジェクトを起点に、`array` の各要素を順に辿る：

   * `ref = dataSet`
   * `for segment in array: ref = ref[segment]`
3. 最終的な `ref` が `GroupDefinition` であることを確認
4. `choice_from_group` の候補として `ref.choices` を使用

---

## 7. QuestionRules 構造

### 7.1 QuestionRules トップレベル

#### 記述

```jsonc
"questionRules": {
  "patterns": [ /* Pattern[] */ ],
  "modes": [ /* Mode[] */ ]
}
```

#### 処理

* クイズ開始時に `modes` から出題モードが選択され、
* 各モードが `patterns` を重み付きで利用して問題を生成します。

---

### 7.2 Pattern

#### 記述

`Pattern` は 1 種類の問題の「ひな形」を定義します：

```jsonc
{
  "id": "p_abbr_to_name",
  "label": "略号 → 名前",

  "questionFormat": "table_fill_choice" | "table_matching" | "sentence_fill_choice",

  "dataSet": "alpha-amino-acids",  // 使用する DataSet ID

  "entityFilter": { /* Filter */ },  // 任意（table 系）

  "tokens": [ /* Token[] */ ],       // fill 系で使用
  "tokensFromData": "sentences",   // sentence_fill_choice で使用

  "matchingSpec": { /* matching 用 */ },

  "tips": [ /* TipBlock[] */ ]       // 任意
}
```

**questionFormat ごとのルール：**

* `"table_fill_choice"`

  * 必須：

    * `dataSet`（`type: "table"`）
    * `tokens`（文と `hide` を含む Token 配列）
  * 任意：

    * `entityFilter`
  * 役割：

    * table 行から 1 行を選び、その行をもとに **n 択穴埋め問題** を生成

* `"table_matching"`

  * 必須：

    * `dataSet`（`type: "table"`）
    * `matchingSpec`（マッチング設定）
  * 任意：

    * `entityFilter`（出題対象とする行の絞り込み）
    * `tokens`（問題文用のテキスト；`hide` は通常使用しない）
  * 役割：

    * table 行から複数行を選び、左右を対応付けさせる **マッチング問題** を生成

* `"sentence_fill_choice"`

  * 必須：

    * `dataSet`（`type: "factSentences"`）
    * `tokensFromData: "sentences"`
  * 役割：

    * DataSet の `sentences` から 1 文を選び、その `tokens` 中の `hide` に対して **n 択穴埋め問題** を生成

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

* 用途：

  * アミノ酸なら：

    * 「最も単純なアミノ酸で、不斉炭素を持たない」
    * 「名前の語源はギリシャ語の **glykys（甘い）**」
    * 「Tyrosine はチーズ（tyros）に由来」など

  * 覚えやすくするための情報・語源・臨床的な小話などを入れることを想定します。

  * **解答前のヒントではなく、「答え合わせの後に読む小ネタ」** です。

* `TipBlock.tokens` 内では、**問題文と同様の Token 記法**が使用できます。

  * 使用可能な `type`：`"text"`, `"key"`, `"ruby"`, `"katex"`, `"smiles"`, `"br"`
  * `styles` も通常どおり使用可能です。

* **制約：**

  * `tips` 内では **`type: "hide"` は使用できません。**

    * 小ネタの中に新たな穴埋めを作ることは v2 ではサポートしません。
  * `ruby` の中にも `hide` を含めてはいけません（8.4 節と同じ制約）。

* 表示ルール（推奨）：

  * 1 回の解答後に **実際に画面に表示される `TipBlock` は 0〜1 個** とすることを推奨します。

    * `tips` 配列には `when` が異なる `TipBlock` を複数定義して構いません。
    * 例：`after_correct` 用と `after_incorrect` 用を 1 個ずつ定義し、

      * 正解時 → `after_correct` を 1 つ表示
      * 不正解時 → `after_incorrect` を 1 つ表示
  * どのタイミングでどの `TipBlock` を表示するかの詳細はエンジン側の UI 実装に委ねられます。

    * 例：問題を解いたあとで「解説を表示」ボタンを押すと Tips が展開される、など。

#### 処理

* エンジンは Pattern ごとに `questionFormat` を読み取り、問題生成ルートを切り替えます：

  * `table_fill_choice` → `tokens` を展開し、各 `hide` から Answer を生成
  * `table_matching` → `matchingSpec` に従いマッチング問題を構成
  * `sentence_fill_choice` → DataSet の `sentences` から 1 件を選択し、その `tokens` を使用
* `entityFilter` は `table_fill_choice` / `table_matching` の両方で任意に利用でき、

  * 同じ DataSet に対しても Pattern ごとに異なる Filter を設定することで、

    * 「酸性アミノ酸だけ」「芳香族だけ」「全体」など、**分野別 Pattern** を簡単に作ることができます。

---

### 7.3 Mode（出題モード）

#### 記述

Mode 定義には **2 種類のノード**を混在させられます。

1. **Mode（葉ノード）**: クリック可能なモードそのもの
2. **ModeGroup（type: "modes"）**: UI 表示用のグループノード

Mode は従来通りの構造で定義します。

```jsonc
{
  "id": "mix_all",
  "label": "総合モード",
  "description": "全パターンを均等に出題", // 任意
  "patternWeights": [
    { "patternId": "p_abbr_to_name",         "weight": 3 },
    { "patternId": "p_match_name_to_class",  "weight": 2 },
    { "patternId": "p_fact_sentence_choice", "weight": 1 }
  ]
}
```

ModeGroup は次のように書きます。

```jsonc
{
  "type": "modes",
  "label": "分野別",              // 必須（表示名）
  "description": "分野別モード", // 任意
  "value": [
    /* 子要素（Mode or ModeGroup） */
  ]
}
```

Mode と ModeGroup を混在させた例：

```jsonc
"modes": [
  {
    "type": "modes",
    "label": "ミックス",
    "value": [
      { "id": "mix_basic", "label": "ミックス（基礎）", "patternWeights": [/* ... */] },
      { "id": "mix_adv",   "label": "ミックス（応用）", "patternWeights": [/* ... */] }
    ]
  },
  {
    "type": "modes",
    "label": "分野別",
    "value": [
      { "id": "climate", "label": "気候", "patternWeights": [/* ... */] },
      { "id": "agri",    "label": "農業", "patternWeights": [/* ... */] }
    ]
  },
  { "id": "quick", "label": "クイック", "patternWeights": [/* ... */] }
]
```

この JSON から、UI では「ミックス」「分野別」の見出し配下に子モードがぶら下がるツリー状のメニューを描画できます。

#### 処理

* 変換層では、`questionRules.modes` から **2 つの構造**を生成します。

  1. `definition.modes`: Mode（葉）だけを集めたフラット配列（従来どおりエンジンが参照）
  2. `definition.modeTree`: UI 用のツリー情報（ModeGroup と `{ type: "mode", modeId }` の組み合わせ）

* ModeGroup を使わずにフラット配列を渡した場合は、ツリーも自動的に 1 階層で生成されます。
* モードが 1 つも定義されていない場合は、全 Pattern を均等に出題する `id: "default"` のモードが自動生成され、`modeTree` もその 1 件を指す構造になります。
* クイズエンジンは従来通り **`definition.modes` と `patternWeights` のみ**を用いて出題を行います。`modeTree` は UI 表示専用です。

---

## 8. Token 仕様

### 8.1 共通

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
* v2 では上記 4 種類のスタイル名のみを正式サポートとし、それ以外の値は無視して構いません（将来拡張用）。

---

### 8.2 `text` / `br`

#### 記述

```jsonc
{ "type": "text", "value": "略号 " }
{ "type": "br" }
```

* `text` は固定文字列
* `br` は改行

#### 処理

* `text.value` をそのまま表示
* `br` は `<br>` 相当の改行として表示

---

### 8.3 `content`（リッチテキスト）

#### 記述

```jsonc
{
  "type": "content",
  "value": "[数学/すうがく]B：[等比数列/とうひすうれつ]の[漸化式/ぜんかしき]"
}
```

* `value`: 特殊な記法を含む文字列
* `block`: `true` の場合、全体を `<div>` で囲み、ブロック要素として扱います（省略時は `false` = インライン）。

#### 記法ルール

1. **Gloss（用語/併記）**: `{Base/Alt1/Alt2}` の形式で記述します。

   * ベース部分（Base）には Ruby 記法を含めることができます。

   * 併記部分（Alt1/Alt2...）は省略可能で、複数言語の併記もできます。

   * 例: `{[漸化式/ぜんかしき]/recurrence relation}` 

     → `<span class="gloss"><ruby><rb>漸化式</rb><rt>ぜんかしき</rt></ruby><span class="gloss-alt">recurrence relation</span></span>`

   * 例: `{専門用語}` → `<span class="gloss"><ruby><rb>専門用語</rb><rt></rt></ruby></span>`

   * 併記部分でも Ruby 記法を使用できます（例: `{[台湾/たいわん]/[台灣/Táiwān]}`）。

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

### 8.4 `key`

#### 記述

```jsonc
{
  "type": "key",
  "field": "nameJa",
  "styles": ["bold"]
}
```

* `field`: table 行や sentence オブジェクトから参照するフィールド名

#### 処理

* 現在のコンテキストが table 行であれば `row[field]` を、`sentence_fill_choice` であれば `sentence[field]` を取得して表示します。
* 指定フィールドが存在しない場合：

  * 値は空文字列として扱うか、その Pattern をスキップするかは実装ポリシーですが、
  * 少なくとも警告ログを出すことを推奨します。

---

### 8.5 `ruby`

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

  * 例：`value: [ { "type": "ruby", "base": ..., "ruby": ... } ]` のように、
    ruby 全体を 1 要素の Token として持たせることができます。
* **推奨**: 新しいコンテンツでは `content` トークンの使用を推奨します。

---

### 8.6 `katex`

#### 記述

```jsonc
{ "type": "katex", "value": "\\ce{-CH3}" }
// または
{ "type": "katex", "field": "sideChainFormulaTex" }
```

* `value`: TeX 文字列を直接指定
* `field`: 行のフィールドから TeX 文字列を取得

#### 処理

* `value` または `row[field]` を **KaTeX** でレンダリングして表示します。
* `content` トークン内の `$` 記法でも代用可能です。

---

### 8.6 `smiles`

#### 記述

```jsonc
{ "type": "smiles", "value": "CC(=O)O", "maxHeightEm": 3.0 }
```

* `value`: SMILES 文字列を直接指定
* `field`: 行のフィールドから SMILES 文字列を取得
* `maxHeightEm`: 描画時の最大高さ（em 単位）。省略時はデフォルト値（例: 2.0）が使用されます。

#### 処理

1. **RDKit** を用いて SMILES 文字列を分子構造データに変換
2. 変換結果を **Kekule.js** でレンダリングし、構造式として表示
3. `maxHeightEm` 等の指定に従い、サイズを調整して描画します。

---

### 8.7 `hide`（穴埋め）

#### 記述

```jsonc
{
  "type": "hide",
  "id": "name",
  "value": [
    {
      "type": "key",
      "field": "nameJa"
    }
  ],
  "array": ["groups", "bondGroup"],   // 任意
  "answer": { /* AnswerSpec */ }
}
```

* `id`: 問題内でユニークな穴埋め識別子

* `value: Token[]`:

  * 本来表示されるべき内容を表す **Token 配列** です。
  * 配列の長さは **1 以上** である必要があります（空配列は無効）。
  * 例：

    * 単一の `key` を穴埋めにしたい場合：

      ```jsonc
      "value": [
        { "type": "key", "field": "nameJa" }
      ]
      ```

    * `text` + `key` のような複合表示をまとめて隠したい場合：

      ```jsonc
      "value": [
        { "type": "text", "value": "側鎖は " },
        { "type": "key",  "field": "sideChainFormulaTex" }
      ]
      ```

    * `ruby` 全体を 1 つの穴埋めにしたい場合：

      ```jsonc
      "value": [
        {
          "type": "ruby",
          "base": { "type": "key", "field": "nameEnCap" },
          "ruby": { "type": "key", "field": "nameJa" }
        }
      ]
      ```

* `array?: string[]`: Group や他オブジェクトへの参照パス

  * v2 では主に `["groups", "groupId"]` を想定

* `answer: AnswerSpec`: この穴埋めの解答モードと選択肢生成ルール

#### 処理

* `value` から「正解表示」を生成し、`answer` に基づいて選択肢を構成します。
* 画面上では `value` の内容を隠し、ユーザーにはボタン選択で答えさせます。
* 採点ロジックは、`hide` ごとに 1 つの AnswerPart を持ち、
  `answer.mode` に従って正解・不正解を判定します（9.1 節参照）。

#### 制約

* `value` には **必ず `Token[]`（Token の配列）** を指定します。

  * 「1 つの `key` だけ」の場合も、長さ 1 の配列とします。
* `value` の配列内には、直接・間接を問わず **`type: "hide"` の Token を含めてはいけません**（穴埋めのネスト禁止）。

  * 例：`value` 内に `ruby` があり、その `ruby.base` や `ruby.ruby` の中に `hide` が含まれている、といった形も禁止です。
* `ruby` の内部にも `hide` を含めてはいけません（8.4 節と同様）。
* ただし、`hide.value` の配列に `ruby` Token を含めること自体は許可されます
  （ruby 付きテキスト全体を 1 つの穴埋めとして扱う）。

---

## 9. Answer 仕様

### 9.1 AnswerPart の概念

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

### 9.2 `answer.mode` 一覧（v2）

#### 記述

v2 で使用する `answer.mode` は次の 4 種類です：

| mode                             | 使用可能な questionFormat              | 用途                         |
| -------------------------------- | --------------------------------- | -------------------------- |
| `"choice_from_entities"`         | `"table_fill_choice"`             | 表の行から正解＋誤答を選ぶ n 択          |
| `"choice_unique_property"`       | `"table_fill_choice"`             | 特定プロパティを満たす行を 1 つだけ含む n 択  |
| `"choice_from_group"`            | `"sentence_fill_choice"`          | Group の `choices` から作る n 択 |
| `"matching_pairs_from_entities"` | `"table_matching"`（Pattern 全体で使用） | 表から作るマッチング問題（hide では使わない）  |

**共通ポリシー：**

* すべてボタン選択（クリック／タップ）方式
* 1 つの選択肢に対する正解は 1 つのみ
* 部分点なし

> `"matching_pairs_from_entities"` は **Pattern の `matchingSpec` 専用**モードであり、`hide.answer.mode` として使用することはありません。

---

### 9.3 `choice_from_entities`

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
      * 「同じグループ内だけから誤答を取りたい」場合に向きます。
    * `"all"`:

      * Pattern が参照している DataSet 全体（`type: "table"`）をもとに誤答候補を選びます。
      * 正解行は `entityFilter` 適用後の行から選びますが、誤答候補はフィルタ前の全行から取ることができます。
      * 「全体から紛らわしいものを拾いたい」場合に向きます。
  * `count`: 誤答候補として必要な行数
  * `avoidSameId`: 正解行と同じ `id` を持つ行を誤答候補から除外するか
  * `avoidSameText`: 正解表示と同じテキストを持つ候補を除外するか（同じ表示内容の選択肢を避ける）

#### 処理

1. Pattern が参照している DataSet（`type: "table"`）に `entityFilter` を適用し、**出題対象行集合** `rowsFiltered` を得る。
2. `rowsFiltered` から、現在の問題で使用している **正解行** `correctRow` を 1 行特定する。
3. 誤答候補の母集合 `rowsForDistractors` を決める：

   * `distractorSource.scope === "all"` の場合：

     * DataSet 全体の行集合 `rowsAll` を用いる（`entityFilter` 未適用）。
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

### 9.4 `choice_unique_property`

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

* `choiceCount`: 選択肢数（n 択）
* `propertyFilter`: 特定プロパティ条件を表す Filter 構造

  * 後述の Filter 仕様と同じ構文を使用

#### 処理（概要）

1. Pattern が参照している DataSet（`type: "table"`）に `entityFilter` を適用し、候補行集合 `rows` を得る。
2. `rows` を `propertyFilter` で 2 つに分ける：

   * `rowsTrue`  : `propertyFilter` が `true` となる行
   * `rowsFalse` : `propertyFilter` が `false` となる行
3. 問題を生成するには、次を満たす必要があります：

   * `rowsTrue.length >= 1`（正解候補が少なくとも 1 行）
   * `rowsFalse.length >= choiceCount - 1`（誤答候補が十分にある）
4. 正解候補行を 1 行だけランダムに選び、`correctRow` とする。
5. 誤答候補 `rowsFalse` から `choiceCount - 1` 行をランダムに選び、正解 `correctRow` と合わせてシャッフルし、選択肢とする。

#### 一意性の厳密条件

* `choice_unique_property` という名前どおり、**選択肢中で `propertyFilter` を満たす行は必ず 1 行だけ**でなければなりません。
* したがって、`rowsTrue.length === 1` の場合のみ問題を生成する、という運用も考えられますが、

  * v2 では、「候補全体では複数存在していても、選択肢として採用するのは 1 行だけ」という挙動を正とします。
  * ただし、`rowsTrue.length === 0` の場合や `rowsFalse.length < choiceCount - 1` の場合はスキップします。

---

### 9.5 `matchingSpec` の仕様

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

1. `entityFilter` を DataSet に適用し、候補行 `rows` を得る。
2. `rows.length < count` の場合 → 出題不可能 → スキップ。
3. `rows` から `count` 行をランダムに選び、`selected` とする。
4. `leftList` を作成：

   * 基本は `selected` の順番どおりに `leftField` を取り出す。
   * `shuffle.left === true` の場合は、`selected` の順自体をシャッフルしてから `leftField` を生成。
5. `rightList` を作成：

   * `selected` の `rightField` を取り出した配列を作る。

---

## D. sentence_fill_choice：一問一答文からの n 択穴埋め（Pattern ＋ tips）

上記 DataSet を用いる `sentence_fill_choice` 用 Pattern です。正答時と誤答時で表示する小ネタを切り替えています。

```jsonc
{
  "id": "p_proline_sentence_with_trivia",
  "label": "Proline の構造（一問一答＋小ネタ）",
  "questionFormat": "sentence_fill_choice",
  "dataSet": "proline-facts",

  "tokensFromData": "sentences",

  "tips": [
    {
      "id": "t_proline_correct",
      "when": "after_correct",
      "tokens": [
        { "type": "text", "value": "🎉 正解！Proline のポイント：" },
        { "type": "br" },
        { "type": "key",  "field": "desc" },
        { "type": "br" },
        { "type": "text", "value": "語源・イメージメモ：" },
        { "type": "br" },
        { "type": "key",  "field": "mnemonic" }
      ]
    },
    {
      "id": "t_proline_incorrect",
      "when": "after_incorrect",
      "tokens": [
        { "type": "text", "value": "残念！ここで Proline を覚えておこう：" },
        { "type": "br" },
        { "type": "key",  "field": "desc" },
        { "type": "br" },
        { "type": "text", "value": "語源・イメージメモ：" },
        { "type": "br" },
        { "type": "key",  "field": "mnemonic" }
      ]
    }
  ]
}
```

この Pattern では：

* 解答後には、正解・不正解に応じて `tips` 内の TipBlock のどちらか 1 つが表示され、`desc` と `mnemonic` を使った小ネタが表示されます。
