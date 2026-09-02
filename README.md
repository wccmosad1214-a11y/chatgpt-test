# Gemini チャット Webアプリ

Gemini APIと会話できるシンプルなチャットWebアプリです。同じ画面内で会話履歴を引き継いで質問でき、Geminiの回答はコピーボタンでコピーできます。画像を1枚添付して質問することもできます。

## 主な機能

- 同じ画面内で過去の会話履歴を引き継いでGeminiと会話できる(直近20メッセージまでをGeminiへ送信)
- Geminiの各回答にコピーボタンを表示
- 画像を1枚(JPEG・PNG・WebP、最大5MB)添付して、文章と一緒にGeminiへ質問できる
- スマートフォン(iPhoneなど)でも使いやすいレスポンシブデザイン

## 起動方法

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、値を設定してください。

```bash
cp .env.example .env
```

`.env` の中身:

```
GEMINI_API_KEY=（あなたのGemini APIキーを入力してください。この値は絶対にGitHubにコミットしないでください）
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
```

- `GEMINI_API_KEY`: 必須。[Google AI Studio](https://aistudio.google.com/) などで取得したAPIキーを入力してください。
- `GEMINI_MODEL`: 省略可。未設定の場合は `gemini-2.5-flash` が使われます(既存の接続テスト `gemini-test.mjs` と同じデフォルトです)。
- `PORT`: 省略可。未設定の場合は `3000` 番ポートで起動します。

`.env` ファイルは `.gitignore` に登録されているため、GitHubにはアップロードされません。

### 3. サーバーの起動

```bash
npm start
```

起動後、ブラウザで [http://localhost:3000](http://localhost:3000) を開いてください。

## APIキーの取り扱いについて

Gemini APIキーはサーバー側(`server.js` が実行されるNode.jsプロセス内)でのみ使用され、HTMLやブラウザ向けのJavaScriptには一切含まれません。ブラウザからは `/api/chat` というサーバー内のエンドポイントを経由してGeminiに問い合わせる仕組みになっています。

## 制限事項

- 添付できる画像は1枚のみ、形式はJPEG・PNG・WebP、サイズは5MBまでです。
- 会話履歴は直近20メッセージまでがGeminiへ送信されます(それより古いメッセージは画面には残りますが、Geminiへの問い合わせには含まれません)。
- 会話履歴はブラウザのタブを開いている間だけメモリ上に保持されます。ページを再読み込みすると履歴はリセットされます。

## 既存ファイルについて

`gemini-test.mjs` と `.github/workflows/gemini-test.yml` は、既存のGemini API接続テスト用のファイルです。本Webアプリの追加にあたって変更していません。
