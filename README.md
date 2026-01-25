# Slack Patch

Web版Slackで送信前メッセージをLLMで添削し、Before/After比較のポップアップで編集・送信できるChrome拡張機能です。

## 機能

- **ショートカット添削**: `Cmd+Enter` (Mac) / `Ctrl+Enter` (Windows/Linux) で添削開始
- **Before/After比較**: 元のテキストと添削後テキストを並べて表示
- **編集可能**: 添削後テキストはその場で編集可能
- **プリセット管理**: 複数のプロンプトプリセットを登録・切り替え可能
- **Shadow DOM**: Slack UIとのCSS衝突を回避

## インストール

### 開発版

1. リポジトリをクローン
   ```bash
   git clone https://github.com/sho-hata/slack-patch-chrome-extension.git
   cd slack-patch-chrome-extension
   ```

2. 依存関係をインストール
   ```bash
   pnpm install
   ```

3. ビルド
   ```bash
   pnpm build
   ```

4. Chrome拡張機能として読み込み
   - Chrome で `chrome://extensions` を開く
   - 「デベロッパーモード」を有効化
   - 「パッケージ化されていない拡張機能を読み込む」をクリック
   - `dist` フォルダを選択

## セットアップ

1. 拡張機能のオプションページを開く（拡張機能アイコンを右クリック → オプション）
2. OpenAI APIキーを入力
3. 使用するモデルを選択（デフォルト: gpt-4o-mini）
4. 必要に応じてプリセットを追加・編集

## 使い方

1. Web版Slack (`app.slack.com`) でメッセージを入力
2. `Cmd+Enter` (Mac) または `Ctrl+Enter` (Windows/Linux) を押す
3. 添削結果がモーダルで表示される
4. 必要に応じて添削後テキストを編集
5. 「Send」ボタンでSlackに送信、「Cancel」でキャンセル

## デフォルトプリセット

- **ビジネス文章校正**: 丁寧かつ簡潔に校正
- **カジュアル校正**: カジュアルな雰囲気を保ちつつ校正

## 開発

### 開発モード（ホットリロード）

```bash
pnpm dev
```

### ビルド

```bash
pnpm build
```

### プロジェクト構成

```
slack-patch-chrome-extension/
├── manifest.json           # Manifest V3設定
├── src/
│   ├── content/           # Content Script
│   │   ├── index.ts       # エントリポイント
│   │   ├── slack-dom.ts   # Slack DOM操作
│   │   ├── modal.ts       # モーダルUI
│   │   └── styles.css     # モーダルスタイル
│   ├── background/
│   │   └── service-worker.ts  # Service Worker (LLM API呼び出し)
│   ├── options/           # 設定画面
│   ├── types/             # 型定義
│   └── utils/             # ユーティリティ
├── icons/                 # 拡張アイコン
└── dist/                  # ビルド出力
```

## 対応フォーマット

Slackのリッチテキストフォーマットに対応しています:

| フォーマット   | 変換形式       | 対応状況 |
| -------------- | -------------- | -------- |
| **太字**       | `*text*`       | ✅        |
| *イタリック*   | `_text_`       | ✅        |
| `コード`       | `` `text` ``   | ✅        |
| ~~取り消し線~~ | `~text~`       | ✅        |
| コードブロック | ` ```text``` ` | ⚠️        |
| 引用ブロック   | `> text`       | ⚠️        |
| リンク         | `<URL\|text>`  | ✅        |
| 箇条書きリスト | `• item`       | ✅        |
| 番号付きリスト | `1. item`      | ✅        |
| 絵文字         | `:emoji:`      | ✅        |

## 制限事項

- 引用ブロック: 現在対応していません
- コードブロック: 現在対応していません

## 注意事項

- **プライバシー**: 入力したメッセージはOpenAI APIに送信されます。機密情報の取り扱いにご注意ください。
- **APIキー**: APIキーはローカルストレージに保存され、ページに露出しません。

## ライセンス

MIT
