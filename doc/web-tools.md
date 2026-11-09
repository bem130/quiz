# 草稿取込・共有・読みと出典

全画面共通のヘッダーには現在の配色とライト／ダークの切替ボタンがある。切替は問題への回答、回答の保存、草稿の未保存テキストやカーソルを保ったまま適用する。設定は端末内へ保存し、次回起動時に復元する。保存に失敗した場合は画面への適用と保存結果を区別して知らせる。メニューの「配色を切替」では従来のブラックも選べる。SVG・化学構造式は作者の色を維持するため白い面に表示する。

メニューの「JSONを新規草稿へ取り込む」では、クリップボードから読み込むか、入力欄へ手動で貼り付ける。ブラウザがclipboard読取を拒否しても貼付欄を利用できる。保存時にstrict JSONとv3 schemaを検証し、新規パスだけへ保存する。同名草稿があれば競合として拒否し、入力内容を残す。編集中の不正JSONを保存する操作は草稿エディターが担当する。

出題範囲はpattern、題庫、出典URLまたは草稿パスから導出したフォルダで選択できる。フォルダの範囲はその配下の題庫に属する出題可能patternであり、別originの同名フォルダを混在させない。共有URLには新サイトのscopeと問題一覧URLを保持する。ローカル草稿のJSON自体はURLへ含めず、端末間で草稿を渡す場合は完全バックアップ等を別に使用する。

「共有URL・QRを表示」ではURLを選択・コピーでき、同じURLのQRを端末内で生成する。QRはnpmの固定版qrcodeをViteへ同梱し、CDNや外部画像生成APIへ送信しない。URLがQR容量を超える場合はURLのコピーを利用できる。[qrcode公式のbrowser bundlerとPromise API](https://github.com/soldair/node-qrcode#browser)を使用する。

問題と結果の「読みの収集・出典」には、表示したrubyを収集するボタンがある。touch、Tab＋Enterでも操作できる。rubyの右クリックも同じ収集処理を通す。同じ設問の同じ語と読みは重複収集せず、Web側がsessionごとに一つのRuby Bufferを保持する。結果のJSONと専用コピーへ含め、新しいsession・再挑戦では空から開始する。IndexedDBの学習記録とは別の、そのsession画面内の補助データである。

出典コピーは題庫のsource URLまたは草稿パス、package/question/row/pattern IDとJSONPathを返す。実際の元JSONの改行位置を保持していないため、推測したline/columnは出力しない。

entryに`editorBasePath`があれば、絶対ローカルパスとentryに列挙した相対JSONファイルだけからfilemapを作る。相対脱出、制御文字、UNC、任意scheme、query/fragmentを拒否する。対応する出典にはローカルパスを明示した`vscode://file/`リンクを表示し、利用者がクリックした場合だけOSへ渡す。[VS Codeの公式URL形式](https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls)を用いる。VS CodeのインストールやOSのprotocol関連付けは任意であり、通常のWeb操作や出典コピーには不要である。

「offline cacheを削除して再起動」はメニューから確認後に実行する。新サイトのscopeに完全一致するService Workerと、そのscopeを含む`quiz-web:`のcacheだけを対象とする。別アプリのcache、IndexedDBの草稿・ユーザー・学習記録・設定・SVG資産は保持する。cacheを消した後の初回起動には通信が必要である。学習中・草稿編集中・保存中はこの操作を提供しない。

単体検証は`tests/core/web-tools.test.ts`、実UIの検証は`tests/e2e/app-tools.spec.ts`に分ける。実ブラウザで生成したQR画像の表示と、実機のカメラによる読取り、OSからVS Codeを起動する確認は別の証拠として扱う。
