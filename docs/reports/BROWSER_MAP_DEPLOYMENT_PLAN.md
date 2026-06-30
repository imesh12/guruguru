# Kurukuru Monitor Browser Map Deployment Plan

## 1. 概要

本書は、Kurukuru Monitor のブラウザ向け地図画面を LAN 内の別 PC から利用するための配備前提と運用手順を整理した技術メモである。

現状の実装では、React Router の `#/operator/map` ルートを利用することで、Electron 固有 UI を介さずに地図画面のみをブラウザ表示できる。

想定利用:

- Windows PC #1: Electron デスクトップアプリで映像ウォール運用
- Windows PC #2: Chrome / Edge で地図画面のみ表示
- Ubuntu PC #1: API / 将来の静的配信ホスト
- Ubuntu PC #2: バックアップサーバ

## 2. 現在の実装確認

### 2.1 ルート構成

現行フロントエンドには以下のブラウザ向け地図ルートが存在する。

- 開発 URL: `http://<dev-pc-ip>:5173/#/operator/map`
- 本番想定 URL:
  - `http://<ubuntu-main-ip>/#/operator/map`
  - または履歴ベース配信を導入する場合 `http://<ubuntu-main-ip>/operator/map`

### 2.2 画面特性

`#/operator/map` は `MapPage` を直接表示するため、以下の条件を満たす。

- ダッシュボードメニューを表示しない
- 管理者ログイン UI を表示しない
- 設定画面・システム状態画面を表示しない
- 地図、車両マーカー、追従操作、3D 操作のみを利用する構成

### 2.3 Electron 依存回避

ブラウザ利用時は `window.electronAPI` を前提にしないよう、以下の動作となっている。

- Runtime config は `VITE_API_BASE_URL` を優先して使用
- Electron preload が無い場合でもクラッシュしない
- Place marker は Electron IPC が無い場合、空配列で安全にフォールバック
- API ベース URL から WebSocket URL を自動組み立て

## 3. 推奨 URL と環境変数

### 3.1 開発時 URL

- 同一 PC: `http://127.0.0.1:5173/#/operator/map`
- LAN 内別 PC: `http://<dev-pc-ip>:5173/#/operator/map`

### 3.2 本番時 URL

静的配信を Ubuntu サーバで行う場合の推奨 URL:

- `http://<ubuntu-main-ip>/#/operator/map`

将来、history fallback を導入する場合:

- `http://<ubuntu-main-ip>/operator/map`

### 3.3 必須環境変数

ブラウザ配信では、`VITE_API_BASE_URL` を `127.0.0.1` のままにせず、実際にブラウザ PC から到達可能なサーバ IP に設定する必要がある。

推奨例:

```env
VITE_API_BASE_URL="http://<ubuntu-main-ip>:4000"
```

補足:

- `127.0.0.1` はブラウザを開いた端末自身を指す
- 別 PC から閲覧する場合は Ubuntu メインサーバの LAN IP を使用する

## 4. LAN 接続要件

### 4.1 必要ポート

最低限、以下の通信を許可する。

- API: `4000/tcp`
- 開発用 Vite サーバ: `5173/tcp`
- 本番用静的配信: `80/tcp` または `443/tcp`
- WebSocket: API 側 `/ws/vehicles`

### 4.2 ファイアウォール要件

開発検証時:

- 開発 PC の Windows Firewall で `5173/tcp` を許可
- API サーバ側で `4000/tcp` を許可

本番時:

- Ubuntu サーバ側で `80/tcp` と `4000/tcp` を許可
- リバースプロキシ構成時は `/ws` の Upgrade ヘッダを許可

## 5. 本番配信の推奨構成

### 5.1 推奨方式

本番では Electron 開発サーバをそのまま公開せず、レンダラーをビルドして Ubuntu 上で静的配信する方式を推奨する。

推奨構成:

- React / Vite ビルド成果物を生成
- nginx で静的配信
- Fastify API は `4000` 番ポートで継続稼働
- nginx から API / WebSocket を同一ホストで中継

### 5.2 推奨リバースプロキシ方針

概念構成:

```text
/api -> http://127.0.0.1:4000
/ws  -> http://127.0.0.1:4000
/    -> renderer static files
```

メリット:

- ブラウザ配布先に単一 URL を提示しやすい
- `VITE_API_BASE_URL` を相対パス設計へ拡張しやすい
- WebSocket 配信先を同一オリジンに寄せやすい

本フェーズでは nginx 実装までは行わず、配備計画のみを推奨とする。

## 6. Operator PC #2 利用手順

1. Chrome または Edge を起動する
2. 指定 URL を開く
3. `#/operator/map` を表示する
4. `F11` で全画面表示にする
5. 地図上で車両追従・3D 表示が必要な場合は既存マップコントロールを利用する

推奨運用:

- ブラウザは専用ウィンドウで常時表示
- OS スリープを無効化
- 自動更新やポップアップ通知を抑制

## 7. 手動確認手順

### 7.1 開発 PC 上での確認

API 起動:

```powershell
corepack pnpm --filter @kurukuru-monitor/api dev
```

レンダラー起動:

```powershell
corepack pnpm --filter @kurukuru-monitor/desktop dev
```

開発 PC の IP 確認:

```powershell
ipconfig
```

同一 PC 確認:

- `http://127.0.0.1:5173/#/operator/map`

### 7.2 別 PC からの確認

- `http://<dev-pc-ip>:5173/#/operator/map`

確認項目:

- 地図が表示される
- `getRuntimeConfig` エラーが出ない
- 車両マーカーが表示される
- 数秒以内に WebSocket 接続表示が安定する
- 最新位置が更新される
- `F11` 全画面で実運用イメージになる

## 8. トラブルシュート

### 8.1 地図は表示されるが車両マーカーが出ない

確認点:

- `VITE_API_BASE_URL` が `127.0.0.1` のままになっていないか
- API サーバの `4000` ポートに別 PC から到達できるか
- `/gps/latest` がブラウザ PC から取得できるか
- WebSocket `/ws/vehicles` が遮断されていないか

### 8.2 `getRuntimeConfig` undefined エラー

想定原因:

- ブラウザ向けビルドに旧コードが残っている
- 開発サーバが再起動されていない

対応:

- フロントエンド開発サーバ再起動
- ブラウザキャッシュ消去
- 最新ブランチ反映確認

### 8.3 WebSocket が接続されない

確認点:

- `VITE_API_BASE_URL` のホスト名/IP が別 PC から到達可能か
- `ws://` / `wss://` の生成先が API 実サーバと一致しているか
- API サーバの `/ws/vehicles` が稼働しているか
- Windows / Ubuntu firewall が Upgrade 通信を阻害していないか

### 8.4 Google Maps が表示されない

確認点:

- `VITE_MAP_PROVIDER=google` が正しいか
- `VITE_GOOGLE_MAPS_API_KEY` が設定されているか
- Google Maps API の HTTP referrer 制限が配信 URL と一致しているか

### 8.5 Mapbox が表示されない

確認点:

- `VITE_MAP_PROVIDER=mapbox` が正しいか
- `VITE_MAPBOX_ACCESS_TOKEN` が設定されているか

## 9. 本番配備に向けた推奨事項

### 9.1 現段階の推奨

- 開発検証は `5173` で LAN 公開
- 本番は nginx 静的配信 + API reverse proxy を採用
- ブラウザ PC では Chrome / Edge のみを利用
- `VITE_API_BASE_URL` は Ubuntu メインサーバ IP を明示設定

### 9.2 今後の拡張候補

- `/api` `/ws` 相対パス化
- HTTPS 化
- nginx の history fallback 整備
- Operator 用専用ショートカット URL 提供
- 監視用 kiosk モード起動手順の標準化

## 10. 結論

現行実装は、LAN 内ブラウザ向け地図専用画面として既に基本要件を満たしている。

残作業は主に以下である。

- `VITE_API_BASE_URL` を本番サーバ IP 前提で整理
- LAN 越しの手動確認
- nginx を前提にした静的配信設計

したがって、Phase 3 は「機能実装」よりも「配備方式と接続確認」の段階に入っていると判断できる。
