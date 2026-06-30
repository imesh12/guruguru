# Kurukuru Monitor Production Deployment Package Plan

## 1. 目的

本書は、Kurukuru Monitor をクライアント環境へ本番導入するための配備パッケージ計画書である。
対象は以下の構成とする。

- Ubuntu PC 1: 主系本番サーバ
- Ubuntu PC 2: Cold/Warm Standby 待機系バックアップサーバ
- Windows PC 1: Electron 映像ウォール / カメラ Popout 用端末
- Windows PC 2: ブラウザ地図画面用端末

本フェーズでは、アプリ本体の runtime code は変更せず、配備方針、フォルダ構成、サービス構成、スクリプト責務、運用チェックリストを整理する。

## 2. 対象アーキテクチャ

### 2.1 役割分担

- Ubuntu PC 1
  - Fastify API
  - WebSocket 配信
  - MediaMTX
  - nginx
  - SQLite データ保存
  - ブラウザ向け static frontend 配信
- Ubuntu PC 2
  - Ubuntu PC 1 と同じ安定版構成を保持
  - 主系障害時のみ切替利用
  - 日次同期不要
- Windows PC 1
  - Electron デスクトップアプリ
  - 映像ウォール
  - 単一カメラ Popout
- Windows PC 2
  - Chrome / Edge
  - `#/operator/map` による browser map

### 2.2 基本方針

- Ubuntu PC 1 を常用本番系とする
- Ubuntu PC 2 は active-active ではなく待機系とする
- Ubuntu PC 2 には毎日の最新版反映を行わない
- Ubuntu PC 2 は主系検証済み stable release のみ手動反映する
- フェイルオーバー時に開発者常駐を不要とする

## 3. 必要サービス

本番構成で想定する主要サービスは以下のとおりである。

### 3.1 API / Fastify

- HTTP API 提供
- GPS / GNSS 取り込み
- WebSocket 配信
- 車両状態管理
- 管理者認証

### 3.2 MediaMTX

- カメラストリーム中継
- WebRTC / WHEP 配信
- RTSP 系カメラの統合

### 3.3 nginx

- static frontend 配信
- `/api` `/gps` `/ws` の reverse proxy
- ブラウザ地図画面の公開窓口

### 3.4 SQLite data directory

- 本番データ保存
- 設定・履歴の保持
- バックアップ対象

### 3.5 Static browser frontend

- Browser map 用 renderer build
- `http://<server>/#/operator/map` 公開

## 4. 必要ポート

推奨ポート整理:

- `80/tcp`
  - nginx / browser UI
- `4000/tcp`
  - API 直アクセス用
  - nginx 配下に統一できる場合は LAN 内限定でもよい
- `8889/tcp`
  - WHEP / WebRTC 系で必要な場合
- RTSP / カメラ関連ポート
  - カメラ構成および MediaMTX 設定に依存
- `5018/udp` または `5018/tcp`
  - SE220 NMEA PoC を有効化する場合

補足:

- 実運用時の公開ポートは最小化する
- 外部公開は想定せず、LAN 内利用を前提とする

## 5. 推奨フォルダ構成

Ubuntu サーバ上の推奨配置例:

```text
/opt/kurukuru-monitor/
  apps/
  data/
  logs/
  mediamtx/
  frontend/
  scripts/
  config/
  backups/
```

### 5.1 各ディレクトリの責務

- `apps/`
  - API 実行物
  - Electron 関連の配布用成果物管理元
- `data/`
  - SQLite
  - 実行時データ
  - 一時運用ファイル
- `logs/`
  - API / nginx / MediaMTX / 補助スクリプトログ
- `mediamtx/`
  - `mediamtx.yml`
  - MediaMTX 実行配置
- `frontend/`
  - browser map 用ビルド済み static files
- `scripts/`
  - install / update / backup / restore / health-check / failover-check
- `config/`
  - systemd unit 雛形
  - nginx conf
  - 補助設定テンプレート
- `backups/`
  - DB バックアップ
  - 設定バックアップ
  - 復旧用アーカイブ

## 6. 配備スクリプト計画

本フェーズでは複雑なスクリプトはまだ実装しない。
まずは責務を固定し、将来の自動化方針を整理する。

### 6.1 `scripts/install.sh`

責務:

- ディレクトリ作成
- 必要パッケージ導入案内
- systemd unit 配置
- nginx conf 配置
- 初回 build / 配置案内
- `.env.production` 配置確認

### 6.2 `scripts/update.sh`

責務:

- 安定版パッケージ差し替え
- frontend 更新
- API 更新
- service restart
- バージョン記録

### 6.3 `scripts/backup.sh`

責務:

- SQLite バックアップ
- `.env.production` を除く安全な設定バックアップ
- MediaMTX config バックアップ
- 任意でログ退避

### 6.4 `scripts/restore.sh`

責務:

- 指定バックアップから復旧
- DB 復元
- 設定復元
- service restart

### 6.5 `scripts/health-check.sh`

責務:

- API 応答確認
- WebSocket 到達性補助確認
- MediaMTX / nginx / systemd 状態確認
- `/gps/latest` の基本確認

### 6.6 `scripts/failover-check.sh`

責務:

- Ubuntu PC 2 の待機系検証
- `.env.production` 配置確認
- nginx / MediaMTX / API 設定一致確認
- 待機系起動前点検

## 7. systemd unit 提案

### 7.1 `kurukuru-api.service`

草案:

```ini
[Unit]
Description=Kurukuru Monitor API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kurukuru-monitor/apps/api
EnvironmentFile=/opt/kurukuru-monitor/config/.env.production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
User=kurukuru
Group=kurukuru

[Install]
WantedBy=multi-user.target
```

### 7.2 `kurukuru-mediamtx.service`

草案:

```ini
[Unit]
Description=Kurukuru Monitor MediaMTX
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kurukuru-monitor/mediamtx
ExecStart=/opt/kurukuru-monitor/mediamtx/mediamtx /opt/kurukuru-monitor/mediamtx/mediamtx.yml
Restart=always
RestartSec=5
User=kurukuru
Group=kurukuru

[Install]
WantedBy=multi-user.target
```

### 7.3 `kurukuru-health-check.timer`（任意）

用途:

- 定期的に `health-check.sh` を実行
- API / nginx / MediaMTX の最低限監視
- ログ記録

## 8. nginx 構成提案

シンプル構成案:

```nginx
server {
    listen 80;
    server_name _;

    root /opt/kurukuru-monitor/frontend;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /gps/ {
        proxy_pass http://127.0.0.1:4000/gps/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:4000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

補足:

- hash route の `/#/operator/map` は nginx 側で特別な rewrite を要しない
- 将来 history routing に切り替える場合も `try_files` が有効
- `/api` `/gps` `/ws` を同一 origin に揃えることでブラウザ運用を簡略化できる

## 9. 環境変数戦略

### 9.1 基本方針

- `.env.production` は本番秘密ファイルとしてローカル配置し、Git へ commit しない
- `.env.production.example` は安全なテンプレートとして維持する
- 実値は主系・待機系とも同一 stable config を基本とする

### 9.2 主要変数

- `DATABASE_URL`
- `API_HOST`
- `API_PORT`
- `API_BASE_URL`
- `VITE_API_BASE_URL`
- `API_TOKEN`
- `CREDENTIAL_ENCRYPTION_KEY`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_SESSION_SECRET`
- `MEDIAMTX_CONFIG_PATH`
- `GPS_PROVIDER`
- `SE220_*`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_MAPBOX_ACCESS_TOKEN`

## 10. バックアップサーバ戦略

### 10.1 基本方針

- Ubuntu PC 2 は Ubuntu PC 1 と同じ stable release version を維持する
- Ubuntu PC 2 に毎日の feature update は不要
- Ubuntu PC 2 への更新は、Ubuntu PC 1 で検証済み stable release のみ手動反映する
- Ubuntu PC 2 には同じ `.env.production` と MediaMTX config を置く
- 緊急フェイルオーバーは開発者介入なしで実施できる状態を目標とする

### 10.2 推奨切替方針

- 第一推奨: Same IP Manual Takeover
- 第二推奨: DNS / Local Name Switch

## 11. 運用チェックリスト

### 11.1 Fresh Install Checklist

- Ubuntu 基本パッケージ導入確認
- Node.js / nginx / MediaMTX 配置確認
- `/opt/kurukuru-monitor/` 配置確認
- `.env.production` 配置確認
- DB / data / logs directory 権限確認
- API 起動確認
- MediaMTX 起動確認
- nginx 起動確認
- browser map 表示確認

### 11.2 Daily Startup Check

- API 稼働確認
- MediaMTX 稼働確認
- browser map 表示確認
- video wall 表示確認
- GPS 更新確認
- camera 再生確認

### 11.3 Before Demo Check

- 主系サーバの起動状態確認
- Windows PC 1 の Electron 起動確認
- Windows PC 2 の browser map 表示確認
- follow / 3D 操作確認
- camera popout 確認
- 管理者ログイン確認

### 11.4 Emergency Failover Check

- Ubuntu PC 1 障害確認
- Ubuntu PC 1 停止または切離し
- Ubuntu PC 2 起動
- 本番 IP または DNS 切替
- API health 確認
- browser map 確認
- video wall 確認

### 11.5 Restore Check

- バックアップファイルの存在確認
- SQLite restore 手順確認
- `.env.production` 整合確認
- MediaMTX config 復元確認
- service restart 後の動作確認

## 12. 推奨する次段階

本書に基づく次の実装ステップとしては、以下を推奨する。

1. Ubuntu 配備用ディレクトリ構成を固定する
2. nginx conf 雛形と systemd unit 雛形を `config/` へ追加する
3. `scripts/health-check.sh` の最小版から作る
4. `install.sh` と `backup.sh` の最小版を作る
5. 主系 Ubuntu PC で dry-run 配備確認を行う

現時点では、最初の実装対象として `health-check.sh` と nginx / systemd 雛形の追加が最も安全で効果が高い。

## 13. Initial Deployment Assets Created

初期配備アセットとして、以下のテンプレートおよび確認スクリプトを追加した。

- `deployment/README.md`
  - 配備フォルダの目的、配置先、手動導入手順の概要
- `deployment/nginx/kurukuru-monitor.conf`
  - browser frontend 配信と `/api` `/gps` `/ws` `/health` の proxy 雛形
- `deployment/systemd/kurukuru-api.service`
  - Fastify API 用 systemd 雛形
- `deployment/systemd/kurukuru-mediamtx.service`
  - MediaMTX 用 systemd 雛形
- `deployment/scripts/health-check.sh`
  - API / vehicle locations / WHEP port の基本確認
- `deployment/scripts/failover-check.sh`
  - 待機系サーバ readiness の基本確認

想定用途:

- Ubuntu 主系サーバへの初回導入準備
- Ubuntu 待機系サーバへの同一 stable release 展開
- nginx / systemd の配備土台
- 本番前の基本疎通確認

## 14. Initial Install and Backup Scripts

追加した初期スクリプト:

- `deployment/scripts/install.sh`
  - Ubuntu の基本ディレクトリ作成
  - nginx / systemd / helper scripts の配置
  - nginx 設定テスト
  - systemd daemon-reload
  - ただし service start は行わない
- `deployment/scripts/backup.sh`
  - `data`
  - `mediamtx.yml`
  - `.env.production`
  - `/var/log/kurukuru-monitor`
  を対象としたローカルバックアップ作成

設計方針:

- 破壊的な処理を入れない
- `.env.production` を上書きしない
- backup の自動削除を行わない
- upload や外部送信を行わない
- 本番前に内容確認しやすい小さなテンプレートに留める
