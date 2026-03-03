# 請求書リマインダー Slack ボット

請求書の送付期日が近づいたら Slack DM で通知してくれるボットです。

## 機能

- 専用チャンネルのボタンからリマインダーを登録（送付先・期日）
- 期日の **3日前から当日**（および期日超過後）まで毎朝 DM で通知
- DM 内の「✅ 送付完了」ボタンを押すと通知が止まる

## 技術スタック

| レイヤー | 採用技術 |
|---|---|
| フレームワーク | Next.js 14 (App Router) |
| ホスティング | Vercel (Hobby プラン) |
| Slack SDK | @slack/web-api |
| データストア | Upstash Redis |
| スケジューラー | cron-job.org |

## ディレクトリ構成

```
app/
  api/
    cron/notify/route.ts        # 日次通知（cron-job.org から呼び出し）
    setup/route.ts              # 初回セットアップ（チャンネルにボタン投稿）
    slack/interactions/route.ts # Slack インタラクション受信
lib/
  redis.ts       # Upstash Redis クライアント
  reminders.ts   # リマインダー CRUD
  slack.ts       # Slack WebClient・署名検証
types/
  reminder.ts    # 型定義
```

## セットアップ

### 1. 環境変数

`.env.local.example` をコピーして `.env.local` を作成し、各値を入力します。

```bash
# Mac / Linux
cp .env.local.example .env.local

# Windows
copy .env.local.example .env.local
```

| 変数名 | 説明 | 取得元 |
|---|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth トークン（`xoxb-...`） | Slack App 管理画面 |
| `SLACK_SIGNING_SECRET` | 署名検証用シークレット | Slack App 管理画面 |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis の REST URL | Upstash ダッシュボード |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis の REST トークン | Upstash ダッシュボード |
| `CRON_SECRET` | cron・setup エンドポイントの認証トークン | 自分で生成（例: `openssl rand -hex 32`） |
| `REMINDER_CHANNEL_ID` | 専用チャンネルの ID（`C` から始まる） | Slack チャンネル詳細 |

### 2. Slack App の作成

> Interactivity の Request URL はVercelデプロイ（Step 3）後に設定します。

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From Scratch**
2. **Interactivity & Shortcuts** → Interactivity を **On** にして Request URL を設定（Step 3 のデプロイ後）:
   ```
   https://{your-app}.vercel.app/api/slack/interactions
   ```
3. **OAuth & Permissions** → Bot Token Scopes に以下を追加:
   - `chat:write`
   - `im:write`
   - `pins:write`
4. **Install to Workspace**（ワークスペース管理者が実施）
5. 発行された Bot Token と Signing Secret を環境変数に設定

### 3. Vercel へデプロイ

```bash
npm install
npx vercel --prod
```

Vercel ダッシュボードの **Settings → Deployment Protection** で **Vercel Authentication を Disabled** にします（Slack からのリクエストを通すため）。

### 4. 専用チャンネルの準備

1. Slack でチャンネルを作成（例: `#請求書リマインダー`）
2. チャンネルに Bot を招待: `/invite @Bot名`
3. チャンネル ID を `REMINDER_CHANNEL_ID` に設定

### 5. 初期セットアップ（一度だけ）

チャンネルにボタンメッセージを投稿・ピン留めします。

```bash
# Windows
curl.exe -X POST https://{your-app}.vercel.app/api/setup -H "Authorization: Bearer {CRON_SECRET}"

# Mac / Linux
curl -X POST https://{your-app}.vercel.app/api/setup -H "Authorization: Bearer {CRON_SECRET}"
```

### 6. cron-job.org の設定

[cron-job.org](https://cron-job.org) で以下の設定で Cronjob を作成します。

| 項目 | 設定値 |
|---|---|
| URL | `https://{your-app}.vercel.app/api/cron/notify` |
| メソッド | POST |
| スケジュール | 毎日 00:00 UTC（= 09:00 JST） |
| ヘッダー | `Authorization: Bearer {CRON_SECRET}` |

## ローカル開発

```bash
npm install
npm run dev
```

Slack からローカルへリクエストを届けるには [ngrok](https://ngrok.com) を使用します。

```bash
npx ngrok http 3000
# 発行された URL を Slack App の Interactivity Request URL に一時設定
```
