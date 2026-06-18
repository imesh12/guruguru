# Kurukuru Monitor 導入・配備ガイド

## 1. 目的

本書は Kurukuru Monitor の導入、セットアップ、起動、更新、保守を行うための配備手順書です。対象読者は、システム管理者、インフラ担当者、現地導入担当者、保守担当エンジニアを想定しています。

## 2. システム要件

推奨要件は以下のとおりです。

- Windows 11
- Node.js 実行環境
- pnpm
- ネットワーク接続環境
- Google Maps または Mapbox の資格情報

補足事項は以下です。

- MediaMTX を利用する場合は、カメラ配信元と監視端末間の通信経路を事前確認してください。
- API サーバーとデスクトップを同一端末で動かすことも、別端末に分離することも可能です。

## 3. インストール

### リポジトリ取得

必要に応じて `origin` または `office` から取得します。

```powershell
git clone https://github.com/imesh12/guruguru.git
cd guruguru
```

または

```powershell
git clone http://192.168.1.40:3000/imesh/guruguru.git
cd guruguru
```

### 依存関係インストール

```powershell
corepack enable
corepack pnpm install
```

## 4. 設定

### 環境変数

代表的な環境変数は以下です。

- `API_PORT`
- `API_HOST`
- `API_AUTH_TOKEN`
- `VITE_API_BASE_URL`
- `VITE_MAP_PROVIDER`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_MAPBOX_ACCESS_TOKEN`
- `VITE_DEMO_MODE`

注意事項:

- `.env` ファイルや実運用トークンは Git にコミットしないでください。
- Google Maps / Mapbox のキーは導入先ごとに適切に払い出してください。

### 地図プロバイダー選択

`VITE_MAP_PROVIDER` により地図プロバイダーを切り替えます。

- `google`
- `mapbox`

### MediaMTX 設定

MediaMTX の設定ファイルは [mediamtx/mediamtx.yml](/C:/Users/cs_in/projects/kurukuru-monitor/mediamtx/mediamtx.yml) です。映像入力元、公開ポート、配信方式、必要な中継設定はこのファイルで管理します。

`mediamtx.exe` や他のバイナリは Git に含めない運用としてください。

## 5. 起動手順

### 開発起動

全体起動:

```powershell
corepack pnpm dev
```

API のみ:

```powershell
corepack pnpm --filter api dev
```

デスクトップのみ:

```powershell
corepack pnpm --filter desktop dev
```

補足:

- API は設定により `4000` または `4001` を利用します。
- デスクトップ起動前に API 側が到達可能であることを確認してください。

### MediaMTX

MediaMTX は別プロセスとして起動します。実行ファイルの配置方法やサービス化方式は導入先方針に従ってください。設定変更時は `mediamtx/mediamtx.yml` の整合性を必ず確認してください。

## 6. 本番ビルド

全体ビルド:

```powershell
corepack pnpm build
```

デスクトップのみビルド:

```powershell
corepack pnpm --filter desktop build
```

必要に応じて配布用パッケージ生成:

```powershell
corepack pnpm --filter desktop dist
```

注意事項:

- `apps/desktop/dist-new/`
- `apps/desktop/out/`
- `apps/desktop/dist/`

これらの生成物は成果物フォルダであり、Git にコミットしないでください。

## 7. 推奨配備レイアウト

Windows 端末への推奨配置例を以下に示します。

```text
C:\KurukuruMonitor
|- api
|- desktop
|- mediamtx
|- data
`- logs
```

用途の目安は以下です。

- `api`
  API 関連ファイル、設定、実行用バンドル
- `desktop`
  Electron デスクトップアプリ
- `mediamtx`
  MediaMTX 設定と実行ファイル配置先
- `data`
  SQLite やアプリ運用データ
- `logs`
  API、デスクトップ、配信系のログ保管先

## 8. 検証項目

導入後は以下を確認してください。

### API ヘルスチェック

- API が起動していること
- 認証付きエンドポイントにアクセスできること
- 必要な車両一覧、カメラ一覧、レイアウト取得が可能であること

### GPS データ確認

- 車両数が 0 のままになっていないこと
- Android または SE220 から位置が到達していること
- WebSocket 経由で位置変化が反映されること

### WebSocket 確認

- デスクトップが更新を継続受信すること
- 接続断後に再接続できること

### 地図表示確認

- Google Maps または Mapbox が正常表示されること
- API キー未設定で表示失敗していないこと
- Follow モードと 3D モードが利用できること

### 映像確認

- MediaMTX 経由でカメラ映像が再生できること
- ビデオウォールが正しいソースを表示していること

## 9. 更新手順

推奨アップグレード手順は以下です。

1. バックアップ取得
2. 最新ソース取得
3. 依存関係再インストール
4. 必要に応じて Prisma 関連処理実行
5. サービス再起動
6. API / 地図 / 映像 / WebSocket の再確認

Git 更新例:

```powershell
git pull
corepack pnpm install
```

Prisma 関連はルート `package.json` に以下のスクリプトがあります。

```powershell
corepack pnpm prisma:generate
corepack pnpm prisma:push
corepack pnpm prisma:migrate:dev
corepack pnpm db:seed
```

本番環境での適用可否は、現在の DB 運用方針に応じて判断してください。

## 10. バックアップ手順

バックアップ対象は以下です。

- SQLite データファイル
- `.env` 等の設定ファイル
- MediaMTX 設定ファイル
- 必要な運用ログ

最低限バックアップすべき項目:

- `prisma` / DB 実体の保存先
- `mediamtx/mediamtx.yml`
- API / デスクトップの環境設定

## 11. トラブルシューティング

### API が起動しない

- `API_PORT` 競合を確認してください。
- `.env` 設定漏れや依存未導入を確認してください。
- `corepack pnpm --filter api dev` 単独起動でエラー内容を切り分けてください。

### デスクトップが接続できない

- `VITE_API_BASE_URL` が正しいか確認してください。
- API が `127.0.0.1` / `localhost` / 指定 IP のどれで待受しているか確認してください。
- API トークンが有効か確認してください。

### 車両がオフラインに見える

- Android アプリまたは SE220 側の送信を確認してください。
- API の受信ログと WebSocket 配信状況を確認してください。
- ネットワーク断や車載端末停止を確認してください。

### 地図が表示されない

- Google Maps または Mapbox のキー設定を確認してください。
- `VITE_MAP_PROVIDER` と対応するキーが一致しているか確認してください。

### 映像が表示されない

- MediaMTX が起動しているか確認してください。
- ソース URL、ポート、ファイアウォール設定を確認してください。
- カメラ定義と MediaMTX 側の経路整合性を確認してください。

## 12. 補足

Windows 環境では、サービス化や自動起動のためにリポジトリ内の PowerShell スクリプトを活用できます。ルート `package.json` には次の配備補助スクリプトが存在します。

```powershell
corepack pnpm deploy:check
corepack pnpm deploy:start-api
corepack pnpm deploy:start-desktop
corepack pnpm deploy:install-tasks
corepack pnpm deploy:uninstall-tasks
```

本番導入時は、環境差分を整理したうえで段階導入することを推奨します。
