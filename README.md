# SNSインサイトレポート

Instagram・Facebook・TikTok・YouTubeショートの月次インサイトを取り込み、クライアント向けレポート（合算＋SNS別、先月比、AI考察・来月の提案）として公開するシステム。

| フォルダ | 中身 |
|---|---|
| `web/` | 管理ページ（`/admin`）とクライアント用ページ（`/r/<トークン>`）。React + Vite + Tailwind |
| `extension/` | Chrome拡張「SNSインサイト取込」。各管理画面から数値を読み取って管理ページに渡す |
| `functions/` | Cloud Functions。`generateInsight`（Claude Opus 5.5 で考察の下書きを作る） |
| `scripts/import_sheet.py` | 過去のスプレッドシート（xlsx）を取り込み用JSONに変換 |

Firebase プロジェクト: `take1-sns-insight`（Firestore は asia-northeast1）

## 月次の運用

1. クライアントのSNSにログインしている Chrome プロファイルで管理ページを開く
2. クライアント → 「新しいレポートを作成」：3つのURLを貼る（2回目以降は日付を入れて「URLを自動生成」でも可）
3. レポート画面で「取込開始」。専用タブが開き、各管理画面を自動で巡回する（数分）
   - 一覧のスクロールに Chrome のデバッガー機能を使うため、取込中は画面上部に「デバッグを開始しました」と出る
4. アカウント数値を確認・修正 →「AIで下書きを作成」→ 文章を直して「保存」
5. 「クライアント表示でプレビュー」で確認 →「公開する」→ クライアント用URLを共有

### 数値の定義

- 投稿ごとの数値：集計期間内に**公開した**投稿の、**取込時点までの累計**
- 期間の数値（総ビュー等）：各管理画面の期間合計。新規フォロワーはフォロー − フォロー解除の純増
- ストーリーズは投稿一覧に含めない
- TikTokの「動画視聴数」「フォロワー数」は画面上の丸めた値（例: 4.6万、1.8K）
- 過去シートから取り込んだ月はInstagramのみで、総ビューは投稿の合計（集計方法が違うため先月比は出さない）

## セットアップ

### Firebase（初回のみ・コンソールで）

1. 料金プランを **Blaze** に変更（Cloud Functions と Secret Manager に必要）
2. Firestore Database を作成（ロケーション `asia-northeast1`、本番環境モード）
3. Authentication → ログイン方法 → **Google** を有効化
4. Claude API キーを登録：`firebase functions:secrets:set ANTHROPIC_API_KEY`
5. デプロイ：`cd web && npm run build && cd .. && firebase deploy`

管理者メールアドレスは3か所で揃える：`web/src/firebase.ts`、`functions/src/index.ts`、`firestore.rules`。

### Chrome拡張

1. `chrome://extensions` → 右上「デベロッパーモード」をオン
2. 「パッケージ化されていない拡張機能を読み込む」→ `extension` フォルダを選択
3. クライアントごとの Chrome プロファイルそれぞれで同じ操作をする

管理ページのURLを変えたら `extension/manifest.json` の `content_scripts.matches` も直す。
各SNSの画面が変わって取込が失敗したら、直すのは基本的に `extension/src/scrape-lib.js`。

### 開発

```
cd web && npm install && npm run dev   # http://localhost:5173/admin 、デモは /demo
```

`web/.env.local` に Firebase の Web 設定（`.env.example` 参照）。
