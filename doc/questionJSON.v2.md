# クイズ問題ファイル仕様 version 2

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
   table 型 DataSet から生成する **4 択穴埋め問題**
2. **table_matching**
   table 型 DataSet から生成する **マッチング問題（対応付け問題）**
3. **sentence_fill_choice**
   一問一答形式の文（factSentences）から生成する **4 択穴埋め問題**

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
  "version": 2,                            // 推奨

  "imports": ["hoge.json", "fuga.json"], // 任意

  "dataSets": {                            // 任意
    "alpha-amino-acids": { /* DataSet */ }
  },

  "questionRules": {                       // 必須
    "patterns": [ /* Pattern[] */ ],
    "modes": [ /* Mode[] */ ]
  }
}
```

* `title`, `description` はメタ情報（UI 表示などに使用）
* `version` は仕様バージョン番号（本書では `2` を想定）
* `imports` は Data Bundle File へのパス配列
* `dataSets` は、このファイル固有の DataSet 群
* `questionRules` は問題生成ルール

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
  "title": "Common Amino Acid Data",  // 必須
  "description": "...",               // 必須
  "version": 1,                        // 任意

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

#### 処理

* Main Quiz File のフルパスからディレクトリを求め、そのディレクトリを基準として `imports` のパスを解決します。

### 4.2 dataSets のマージと名前衝突

#### 記述

* 同じ `dataSet` ID が複数ファイルに存在することは許されますが、その場合は **優先ルール** に従って上書きされます。

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
      "nameEnCap": "Glycine",     // 任意フィールド
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

* 行ごとに `id: string` が必須
* それ以外のフィールドは自由に追加可能です

#### 処理

* `id` をキーとして内部 Map に変換して保持しても構いません。
* `table_fill_choice` / `table_matching` で利用されます。
* `Filter`（`entityFilter`）の対象にもなります。

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

* Token の `hide.array` で `["groups", "acidBaseClass"]` のように参照されます。
* 一問一答用の DataSet 内に `groups` を持つ場合と同じ構造です。

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
  * v2 では主に `"choice"`（4 択候補）を使用
  * 将来的に `"multi"`, `"matching"` などの拡張を想定
* `drawWithoutReplacement?: boolean`

  * true の場合、**1 問の中でこの Group から同じ要素 index を複数の `hide` 正解に使用しない**
  * 例：「○○に該当するのは ___ と ___ である」のように、同じ Group から 2 箇所の穴埋めに異なる要素を割り当てたい場合に利用

#### 処理

* `choice_from_group` の `answer.mode` で選択肢の候補として利用されます。
* `drawWithoutReplacement: true` の場合：

  * 1 問生成中、同じ `groupId` について「すでに正解として使った `choices` の index」を記録し、別の `hide` の正解には同じ index を割り当てないようにします。

### 6.2 Group の参照パス（hide.array）

#### 記述

`hide` Token には、Group を参照するための `array` フィールドを指定できます：

```jsonc
{
  "type": "hide",
  "id": "bond",
  "value": "アミノ基",
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

  "entityFilter": { /* Filter */ },  // 任意

  "tokens": [ /* Token[] */ ],       // fill 系で使用
  "tokensFromData": "sentences",    // sentence_fill_choice で使用

  "matchingSpec": { /* matching 用 */ },

  "tips": [ /* 任意のヒント */ ]
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

    * table 行から 1 行を選び、その行をもとに **4 択穴埋め問題** を生成

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

    * DataSet の `sentences` から 1 文を選び、その `tokens` 中の `hide` に対して **4 択穴埋め問題** を生成

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

```jsonc
"modes": [
  {
    "id": "mix_all",
    "label": "総合モード",
    "patternWeights": [
      { "patternId": "p_abbr_to_name", "weight": 3 },
      { "patternId": "p_match_name_to_class", "weight": 2 },
      { "patternId": "p_fact_sentence_choice", "weight": 1 }
    ]
  }
]
```

* `id`: モード識別子
* `label`: 表示名
* `patternWeights`: 利用する Pattern とその出題比重

#### 処理

* クイズ開始時に、ユーザーがモードを選ぶか、デフォルトモードを使用します。
* モード内では `patternWeights` に基づいて Pattern を重み付きランダムで選択します。
* Pattern ごとに異なる `entityFilter` を設定しておくことで、

  * 例：

    * `p_abbr_to_name_acidic`（酸性アミノ酸のみ）
    * `p_abbr_to_name_all`（全アミノ酸）
  * のような Pattern を組み合わせたモードを簡単に作ることができます。

---

## 8. Token 仕様

### 8.1 共通

#### 記述

すべての Token は次の基本構造を持ちます：

```jsonc
{
  "type": "text" | "key" | "ruby" | "katex" | "smiles" | "hide" | "br",
  "styles": ["bold", "italic", "sans", "serif"] // 任意
}
```

#### 処理

* `type` に応じて描画ロジックを切り替えます。
* `styles` はフォントスタイルなどの装飾ヒントとして使用します。

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

### 8.3 `key`

#### 記述

```jsonc
{
  "type": "key",
  "field": "nameJa",
  "styles": ["bold"]
}
```

* `field`: table 行などから参照するフィールド名

#### 処理

* 現在のコンテキストが table 行であれば、`row[field]` を取得して表示します。

---

### 8.4 `ruby`

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

* `ruby.base` および `ruby.ruby` の内部には **`type: "hide"` を含めてはいけません**（ruby の中に更なる穴埋めを作ることは禁止）。
* 一方、`hide.value` に `type: "ruby"` を入れること（ruby 付きテキスト全体を1つの穴埋めとして扱うこと）は **許可** されます。

---

### 8.5 `katex`

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

---

### 8.6 `smiles`

#### 記述

```jsonc
{ "type": "smiles", "value": "CC(=O)O" }
// または
{ "type": "smiles", "field": "smiles" }
```

* `value`: SMILES 文字列を直接指定
* `field`: 行のフィールドから SMILES 文字列を取得

#### 処理

1. **RDKit** を用いて SMILES 文字列を分子構造データに変換
2. 変換結果を **Kekule.js** でレンダリングし、構造式として表示

---

### 8.7 `hide`（穴埋め）

#### 記述

```jsonc
{
  "type": "hide",
  "id": "name",
  "value": {
    "type": "key",
    "field": "nameJa"
  },
  "array": ["groups", "bondGroup"],   // 任意
  "answer": { /* AnswerSpec */ }
}
```

* `id`: 問題内でユニークな穴埋め識別子
* `value`: 本来表示されるべき内容を表す Token か Token 配列

  * 例：単一の `key`、`ruby`、または `text` + `key` の配列など
* `array?: string[]`: Group や他オブジェクトへの参照パス

  * v2 では主に `["groups", "groupId"]` を想定
* `answer: AnswerSpec`: この穴埋めの解答モードと選択肢生成ルール

#### 処理

* `value` から「正解表示」を生成し、`answer` に基づいて選択肢を構成します。
* 画面上では `value` を隠し、ユーザーにはボタン選択で答えさせます。

#### 制約

* `value` には **`Token` 1 つ、または `Token[]`** を指定できます。

  * 例：

    * `{"type":"key","field":"nameJa"}`
    * `[{"type":"key","field":"nameJa"},{"type":"text","value":"（"},...]`
* `value` の中に **`type: "hide"` を含めてはいけません**（穴埋めのネスト禁止）。
* `ruby` の内部にも `hide` を含めてはいけません。
* 一方、`hide.value` に `ruby` を含めることは許可されます（ruby 付きテキスト全体を1つの選択肢として扱う）。

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

| mode                             | 使用可能な questionFormat       | 用途                       |
| -------------------------------- | -------------------------- | ------------------------ |
| `"choice_from_entities"`         | `"table_fill_choice"`      | 表の行から正解＋誤答を選ぶ4択          |
| `"choice_unique_property"`       | `"table_fill_choice"`      | 特定プロパティを満たす行を1つだけ含む4択    |
| `"choice_from_group"`            | `"sentence_fill_choice"`   | Group の `choices` から作る4択 |
| `"matching_pairs_from_entities"` | `"table_matching"`（パターン全体） | 表から作るマッチング問題             |

**共通ポリシー：**

* すべてボタン選択（クリック／タップ）方式
* 1 つの選択肢に対する正解は 1 つのみ
* 部分点なし

#### 処理（概要）

* `choice_from_entities`

  * 対象行（正解）を 1 つ選び、同じ DataSet 内の他行から誤答候補を抽出
  * `distractorSource` 設定に従って候補数や重複制御を行う

* `choice_unique_property`

  * DataSet の行のうち、特定プロパティ（例：`carboxylic === true`）を満たす行を正解候補とする
  * 選択肢の中でこの条件を満たす行は 1 つだけになるように構成

* `choice_from_group`

  * `hide.array` で指定された GroupDefinition の `choices[]` から選択肢を生成
  * `hide.value` と一致する要素を正解とする
  * `drawWithoutReplacement` に従い、同じ Group を複数 `hide` で使う場合の重複使用を制御

* `matching_pairs_from_entities`

  * Pattern 単位で使用され、個々の `hide` とは独立して扱う
  * `matchingSpec` に基づき、table 行から複数行を選び、左側と右側のリストを構成（例：左＝名前、右＝分類）

---

## 10. Filter 仕様（entityFilter）

### 10.1 構文

#### 記述

Filter は `table` DataSet の行を絞り込むための構造です。論理演算と条件を組み合わせて記述します。

* 論理演算：

  * `{ "and": [ Filter, ... ] }`
  * `{ "or":  [ Filter, ... ] }`
  * `{ "not": Filter }`

* 条件：

  * `{ "exists": "fieldName" }`
  * `{ "eq":  { "field": "classJa", "value": "芳香族" } }`
  * `{ "neq": { "field": "classJa", "value": "芳香族" } }`
  * `{ "in":  { "field": "classJa", "values": ["極性", "塩基性"] } }`

> 注意：`nin` 演算子は使用せず、`not` と `in` の組み合わせで表現します。

#### 処理

* 再帰的に Filter を評価し、`true` を返した行だけを候補として残します。
* `table_fill_choice` と `table_matching` の両方で利用できます。

### 10.2 Filter 結果が少ない場合

#### 記述

* Filter や DataSet の内容、`answer.mode` の要求により、問題生成ができない場合があります：

  * 候補行が 0 件
  * 選択肢数が足りない

#### 処理

* 問題生成を **スキップ** として扱い、原因を `console.warn` でログ出力します。
* スキップが連続して `maxConsecutiveSkips` 回（例：20回）を超えた場合：

  * 「出題可能な問題がない」旨のエラーメッセージとともに結果画面を表示
  * クイズを終了（無限ループ防止）

---

## 11. 問題生成フロー（概要）

### 11.1 共通フロー

1. Mode を選択（ユーザー選択またはデフォルト）
2. Mode 内の `patternWeights` に基づいて Pattern を重み付きランダムで選択
3. Pattern の `questionFormat` に応じて処理を分岐：

   * `table_fill_choice`
   * `table_matching`
   * `sentence_fill_choice`
4. DataSet と Filter を適用して対象行または文を選ぶ
5. Token を展開し、`hide` から AnswerPart を生成するか、matchingSpec からマッチング問題を構成
6. 問題を表示し、ユーザーの解答を受け付ける

### 11.2 形式別の要点

* **table_fill_choice**

  * DataSet: `type: "table"`
  * `entityFilter` で対象行を絞る
  * ランダムに 1 行を選び、その行を文中に `key` / `ruby` / `katex` / `smiles` などで表示
  * `hide` 部分に対して `choice_from_entities` / `choice_unique_property` で 4 択を構成

* **table_matching**

  * DataSet: `type: "table"`
  * `entityFilter` で対象行を絞る
  * `matchingSpec` に従い複数行を選び、左右のリストを作成
  * UI 上で線引き／対応付けを行わせる

* **sentence_fill_choice**

  * DataSet: `type: "factSentences"`
  * `tokensFromData: "sentences"` で DataSet から 1 文を選ぶ
  * その文中に含まれる複数の `hide` がそれぞれ `choice_from_group` で 4 択を構成

---

## 12. 制約と設計ポリシー

* 解答はすべてボタン選択で行う（記述式はサポートしない）
* True/False 形式は、必要であれば 4 択問題として表現する（本仕様では専用モードを設けない）
* 部分点を導入せず、1 選択肢につき正解は 1 つのみとする
* 多言語対応は、ruby による二言語表記と、問題ファイル差し替えによって行う
* import のネストは不可（Data Bundle 内での `imports` 禁止）
* 選択肢の表示内容が重複しないよう、フィールド設計や `avoidSameText` などで制御する

---

# 第2部 例パート（サンプル）

> ※ここでは、代表的な例のみを簡略版として記載します。実際の実装では、この他にも Data Bundle や複数 Pattern を組み合わせた例を用意できます。

## A. table_fill_choice：略号 → 名前 4 択穴埋め

```jsonc
{
  "id": "p_abbr_to_name",
  "label": "略号 → 名前",
  "questionFormat": "table_fill_choice",
  "dataSet": "alpha-amino-acids",

  "tokens": [
    { "type": "text", "value": "略号 " },

    { "type": "key", "field": "code3", "styles": ["bold"] },

    { "type": "text", "value": " はどのアミノ酸か？ " },

    {
      "type": "hide",
      "id": "name",
      "value": { "type": "key", "field": "nameJa" },
      "answer": {
        "mode": "choice_from_entities",
        "distractorSource": {
          "from": "dataSet",
          "count": 3,
          "avoidSameId": true,
          "avoidSameText": true
        }
      }
    }
  ]
}
```

## B. table_matching：名前と分類の対応付け

```jsonc
{
  "id": "p_match_name_to_class",
  "label": "名前と分類の対応付け",
  "questionFormat": "table_matching",
  "dataSet": "alpha-amino-acids",

  "entityFilter": {
    "in": { "field": "classJa", "values": ["酸性", "塩基性", "非極性"] }
  },

  "tokens": [
    { "type": "text", "value": "アミノ酸の名前と分類を対応付けよ。" }
  ],

  "matchingSpec": {
    "mode": "matching_pairs_from_entities",
    "leftField": "nameJa",
    "rightField": "classJa",
    "count": 4
  }
}
```

## C. sentence_fill_choice：一問一答文からの 4 択穴埋め

```jsonc
{
  "type": "factSentences",
  "sentences": [
    {
      "id": "proline_structure",
      "tokens": [
        { "type": "text", "value": "側鎖が主鎖の" },
        {
          "type": "hide",
          "id": "bond",
          "value": "アミノ基",
          "array": ["groups", "bondGroup"],
          "answer": { "mode": "choice_from_group" }
        },
        { "type": "text", "value": "と結合して環構造" },
        {
          "type": "hide",
          "id": "ring",
          "value": "ピロリジン環",
          "array": ["groups", "ringGroup"],
          "answer": { "mode": "choice_from_group" }
        },
        { "type": "text", "value": "を作る。" }
      ]
    }
  ],
  "groups": {
    "bondGroup": {
      "choices": ["アミノ基", "カルボキシル基", "水酸基"],
      "mode": "choice",
      "drawWithoutReplacement": true
    },
    "ringGroup": {
      "choices": ["ピロリジン環", "ベンゼン環", "イミダゾール環"],
      "mode": "choice"
    }
  }
}
```
