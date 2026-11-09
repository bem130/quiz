# ローカル問題の編集

新しい Web アプリの編集器は `src/web/editor.ts` が提供する。Monaco Editor で JSON を編集し、問題プレビューと JSON プレビューを同じ草稿から導出する。草稿は問題として不正な編集中の JSON も含めて保存する。出題可能な題庫への登録時には、別途 strict JSON と v3 schema の検証が必要である。

## 操作

草稿のパス欄には `drafts/example.json` のような相対パスを指定する。「新規ファイル」は出題を試せる二行の v3 テンプレートを作成し、「新規フォルダ」は空フォルダを作成する。ファイルの `.json` は省略時に補う。絶対パス、`.`、`..`、空のパス区切りは受け付けない。このパスはブラウザの保存領域内の名前であり、端末のファイルシステムのパスではない。

草稿一覧はパスから親フォルダを導出し、空フォルダも表示する。選択した項目は名前変更、移動、削除ができる。フォルダの移動・削除は対象レコード全件の version と集合を一つの transaction で検証するため、別タブで子が追加・変更された場合も部分反映せず競合を返す。

通常の編集は入力が落ち着いてから自動保存する。「保存・再試行」は保存結果を再確認する。別タブとの競合で元のパスへ保存できない場合は、パス欄を新しい名前へ変更して「別名で保存」で編集内容を残せる。既存の別ファイルを上書きする操作にはしない。

行とパターンの選択でプレビュー対象を切り替える。ruby、gloss、数式、SMILES、SVG は Web アプリと共通の描画処理を使う。危険な SVG は安全化処理で拒否する。問題プレビューの文字や JSON プレビューの値をクリックすると対応する編集位置へ移動する。本文の行フィールドはその行の値へ、pattern 内の直接 token は token の位置へ移動する。JSON プレビューは元の構文を保持しつつ文字列の表示記法を描画し、カーソルを含む文字列を強調する。

## 保存と失敗時の契約

保存の正本は現在の buffer であり、編集中の `text` と保存済みの `savedText` を区別する。保存要求にはその時点の path、text、expectedVersion を固定する。要求を直列化し、IndexedDB の transaction commit の成功を待って保存済み version を更新する。保存中に入力が進んだ場合は、新しい text を次の保存要求で扱う。

別ファイルを開く、名前変更、移動、削除、編集器を閉じる操作は、未保存 buffer の flush が成功した後だけ実行する。失敗時は元ファイルと入力内容を保持し、エラーと再試行手段を表示する。元の競合を解消せず上書き保存することはしない。IME の変換中は保存とファイル切替を留め、確定後に検証と保存を再開する。

ページを離れる時点で未保存の入力があればブラウザの確認を要求する。ただし端末やブラウザの強制終了で未 commit の編集を保証するものではない。UI の「編集を閉じる」は必ず commit を待つ。

非同期の画像取得と化学描画はプレビューの世代を検査する。草稿、行、パターンが変わった後に古い応答が完了しても、新しいプレビューへ差し戻さない。

## 呼び出し側との契約

`mountDraftEditor(host, storage, { onClose, onSaved })` は初期化結果を `Result<EditorController, EditorError>` として返す。呼び出し側は専用の host を保持し、外側のメニュー再描画で編集中 DOM を破棄しない。

`EditorController.flush()` は保存 commit を待つ。`isDirty()` は保存済み text との差と IME の未確定入力を検出し、変換中にアプリ更新で再読み込みしないためにも使う。`dispose()` は timer、Monaco model、イベント購読、theme observer を破棄するため、呼び出し側は flush 成功後にだけ呼ぶ。UI の閉じる処理は flush 成功後に `onClose` を呼ぶ。`onSaved` は commit 後の通知であり、親画面の一覧や容量を再計算する契機にできる。

空フォルダは `DraftRecord.id` が `/` で終わり、`text` が空文字のレコードである。題庫一覧の構築ではこのレコードを問題 JSON として解釈しない。

## 配信と検証

Monaco `0.57.0` は npm の ESM を使用し、editor worker と JSON worker を Vite の `?worker` import で生成する。CDN の AMD loader や実行時の外部 worker 配信には依存しない。[Monaco 公式の Vite 統合](https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md#using-vite)と採用版の package exports を確認している。`src/web/monaco.ts` に API、JSON contribution、worker と初期化順を集約し、全言語を含む root entry は読み込まない。検証 harness も同じ adapter を使う。

採用版の JSON 機能は、遅延読み込みされる `internal/common/workers.js` を通して editor contribution の service を登録する。APIだけを先に初期化すると、その後の登録が初期化済み service collection に入らず、再 open 時に未登録 service のエラーになる。このため adapter は同じ worker module を静的に読み込み、初回 editor 作成前に登録を完了させる。JSON worker は通常どおり動作させる。

[公式 README](https://github.com/microsoft/monaco-editor/blob/main/README.md#installing)では型定義以外の配布内部にリリース間の互換性保証を設けていない。[公式 small ESM 例](https://github.com/microsoft/monaco-editor/blob/main/samples/browser-esm-webpack-small/index.js)と同様の選択読み込みにも、この制約が適用される。内部パスへの依存を adapter に限定し、バージョンを固定する。更新時には型検査と build に加え、三つのブラウザで再 open・JSON worker・実行時エラーの回帰検証を行い、配信物に不要な言語 worker が増えていないことを確認する。

`tests/e2e/editor.spec.ts` は実 IndexedDB と Monaco を用い、即時ファイル切替、保存失敗、再 open、不正 JSON、IME の合成イベント、安全な SVG と古い非同期応答、source jump を検証する。検証専用 HTML と harness はテスト側に置き、通常の配信 entry から import しない。

自動化した合成イベントの成功と、実端末での日本語 IME・画面キーボード・読み上げの確認は区別する。Monaco と worker の同梱だけでは、Service Worker によるオフライン編集の検証完了とはしない。オフライン起動と worker 資産のキャッシュは PWA の受け入れ検証で確認する。
