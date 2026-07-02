# Kurukuru Monitor v1.0 リリース準備チェックリスト

## 1. 目的

本書は、Kurukuru Monitor を v1.0 として現場導入する前に、機能・運用・配備・安定性・障害切替の観点で最終確認を行うためのチェックリストである。

対象読者:

- クライアント担当者
- 現場運用責任者
- 導入担当エンジニア
- 保守担当者

## 2. v1.0 Feature Freeze Scope

v1.0 では、以下を機能凍結範囲とする。

- Electron デスクトップ運用
- Operator / Admin 権限制御
- 映像ウォール
- 単一再利用型カメラ Popout
- ブラウザ地図画面
- Google Maps / Mapbox 対応地図表示
- Follow / 3D 地図操作
- Android GPS 連携
- SE220 GNSS 連携
- WebSocket リアルタイム更新
- 基本的な Ubuntu 配備テンプレート
- バックアップ / 復元 / フェイルオーバー補助スクリプト

v1.0 の対象外:

- 大規模アーキテクチャ変更
- 自動フェイルオーバー
- active-active 構成
- 高可用 DB への移行
- 開発系 UI 再設計
- Google Roads API 再導入

## 3. 完了機能チェック

- [ ] Operator / Admin 権限制御が既定動作どおりである
- [ ] 管理者ログイン / ログアウトが動作する
- [ ] 映像ウォールが通常表示できる
- [ ] カメラダブルクリックで単一 Popout が開く
- [ ] 既存 Popout を再利用してカメラ切替できる
- [ ] ブラウザ地図画面 `#/operator/map` が表示できる
- [ ] ブラウザ地図画面が Electron 依存なしで動作する
- [ ] Follow ボタンが意図どおり有効 / 無効になる
- [ ] 3D ボタンが意図どおり有効 / 無効になる
- [ ] Google Maps provider が動作する
- [ ] Mapbox provider が必要時に動作する
- [ ] Place marker が必要要件どおり表示される
- [ ] WebSocket リアルタイム更新が動作する
- [ ] GNSS / GPS 更新が地図へ反映される

## 4. Deployment Assets Checklist

- [ ] `deployment/README.md` が存在する
- [ ] nginx テンプレートが存在する
- [ ] `kurukuru-api.service` が存在する
- [ ] `kurukuru-mediamtx.service` が存在する
- [ ] `health-check.sh` が存在する
- [ ] `failover-check.sh` が存在する
- [ ] `install.sh` が存在する
- [ ] `backup.sh` が存在する
- [ ] `restore.sh` が存在する
- [ ] すべてのテンプレートに秘密情報が含まれていない

## 5. Ubuntu PC 1 インストールチェック

- [ ] Ubuntu PC 1 に必要パッケージが導入済みである
- [ ] `/opt/kurukuru-monitor` が配置済みである
- [ ] `/etc/kurukuru-monitor/.env.production` が配置済みである
- [ ] `.env.production` に実運用値が設定済みである
- [ ] nginx 設定が配置済みである
- [ ] systemd unit が配置済みである
- [ ] API が起動する
- [ ] MediaMTX が起動する
- [ ] nginx が起動する
- [ ] browser frontend が配信される
- [ ] `/health` が応答する
- [ ] `/gps/latest` が応答する
- [ ] `/ws` が接続できる

## 6. Ubuntu PC 2 待機系チェック

- [ ] Ubuntu PC 2 に同じ stable release が配置されている
- [ ] Ubuntu PC 2 に同じ `.env.production` が配置されている
- [ ] Ubuntu PC 2 に同じ MediaMTX config がある
- [ ] Ubuntu PC 2 に同じ nginx config がある
- [ ] Ubuntu PC 2 に同じ systemd unit がある
- [ ] Ubuntu PC 2 は active-active 構成ではない
- [ ] Ubuntu PC 2 は毎日最新版更新されない運用である
- [ ] Ubuntu PC 2 は緊急時に数分で起動可能である
- [ ] `failover-check.sh` で readiness を確認できる

## 7. Windows PC 1 Electron チェック

- [ ] Electron アプリが起動する
- [ ] 映像ウォールが表示される
- [ ] カメラ一覧が表示される
- [ ] カメラ映像が再生される
- [ ] シングルカメラ Popout が動作する
- [ ] Popout が複数ウィンドウ化しない
- [ ] 管理者ログイン UI が期待どおり表示される
- [ ] Operator モードのメニュー制限が有効である
- [ ] Admin モードで必要メニューが表示される

## 8. Windows PC 2 Browser Map チェック

- [ ] `http://<server>/#/operator/map` で表示できる
- [ ] dashboard UI が表示されない
- [ ] admin UI が表示されない
- [ ] 地図が全画面運用できる
- [ ] 車両マーカーが表示される
- [ ] Follow / 3D 操作が利用できる
- [ ] WebSocket 更新が反映される
- [ ] `VITE_API_BASE_URL` が本番サーバ IP 前提で設定されている

## 9. Camera Popout Checklist

- [ ] ダブルクリックで Popout が開く
- [ ] Popout は 1 つだけ再利用される
- [ ] カメラ切替で既存 Popout の映像が切り替わる
- [ ] Popout が不要な管理 UI を表示しない
- [ ] 映像が黒点滅や再接続ループを起こさない
- [ ] Main Video Wall が Popout 操作で崩れない

## 10. GNSS Checklist

- [ ] Android GPS 連携が動作する
- [ ] SE220 連携が必要環境で動作する
- [ ] `/gps/latest` に最新位置が反映される
- [ ] WebSocket で地図にリアルタイム更新される
- [ ] GNSS stale 表示が必要時に確認できる
- [ ] duplicate sample 時に過剰な地図ジャンプが起きない
- [ ] source 情報が想定どおり記録される

## 11. Backup / Restore Checklist

- [ ] `backup.sh` が archive を作成できる
- [ ] backup archive が安全な場所に保管される
- [ ] backup archive に秘密情報が含まれることが周知されている
- [ ] `restore.sh` が preview mode で展開できる
- [ ] `restore.sh --apply` が対話確認付きで動作する
- [ ] `.env.production` が自動上書きされない
- [ ] service restart が手動であることが運用者に共有されている

## 12. Failover Rehearsal Checklist

- [ ] Ubuntu PC 1 障害時の切替手順が紙面化されている
- [ ] Option B または Option C の方式が確定している
- [ ] Ubuntu PC 1 停止または切離し手順が明確である
- [ ] Ubuntu PC 2 起動手順が明確である
- [ ] IP 引継ぎまたは DNS 切替手順が明確である
- [ ] 切替後に API health を確認できる
- [ ] 切替後に browser map を確認できる
- [ ] 切替後に video wall を確認できる
- [ ] 開発者不在でも手順実行できる

## 13. 24 / 48 / 72 Hour Stability Test Checklist

### 13.1 24 時間試験

- [ ] API が継続稼働する
- [ ] MediaMTX が継続稼働する
- [ ] nginx が継続稼働する
- [ ] browser map が継続表示できる
- [ ] video wall が継続表示できる
- [ ] メモリリークや異常 CPU 使用が顕著でない

### 13.2 48 時間試験

- [ ] GNSS / GPS 更新が継続する
- [ ] WebSocket 再接続異常がない
- [ ] camera popout が安定利用できる
- [ ] ログ肥大化が許容範囲である
- [ ] バックアップ取得が問題なく行える

### 13.3 72 時間試験

- [ ] 主系サーバが長時間稼働に耐える
- [ ] 待機系サーバの起動確認ができる
- [ ] 日次運用フローに支障がない
- [ ] 異常終了やサービス停止がない
- [ ] オペレータから重大な UX 問題報告がない

## 14. Known Issues

- [ ] 既知問題一覧が整理されている
- [ ] v1.0 出荷を止める問題と、既知の軽微問題が分類されている
- [ ] 文字コードや一部ドキュメント表記の揺れが把握されている
- [ ] 今後改善項目が別途 backlog 化されている

## 15. Go / No-Go Criteria

### Go 条件

- [ ] 主系 Ubuntu PC 1 が本番構成で正常稼働する
- [ ] 待機系 Ubuntu PC 2 が stable fallback として起動可能である
- [ ] Windows PC 1 の Electron 運用が安定している
- [ ] Windows PC 2 の browser map が安定している
- [ ] camera popout が要求どおり動作する
- [ ] GNSS / GPS 更新が実運用で確認できる
- [ ] backup / restore / failover rehearsal が完了している
- [ ] 24 時間以上の安定試験で重大障害が出ていない
- [ ] クライアント承認と運用手順共有が完了している

### No-Go 条件

- [ ] 主系サーバの継続稼働に重大不安がある
- [ ] browser map または video wall のどちらかが業務利用不可
- [ ] GNSS / GPS 更新が業務要件を満たさない
- [ ] 待機系切替が数分で実行できない
- [ ] backup または restore が未検証
- [ ] 運用手順が現場へ共有されていない

## 16. 最終判定欄

- 判定日:
- 判定者:
- 結論:
  - [ ] Go
  - [ ] Conditional Go
  - [ ] No-Go
- 備考:

## 17. Map UI Final Polish

- [ ] 不要なトップ左情報カードを削除済み
- [ ] 地図上の車両マーカー文言を「車両名 + 状態」のみへ簡素化済み
- [ ] マーカー文言から `UPDATED` / `GNSS STALE` / 受信時刻 / 技術調査文字列を除去済み
- [ ] 右下の車両詳細パネルは変更していない

## 18. Production Map Data Cleanup

- [ ] 一時的な Kawachinagano テストルートを削除済み
- [ ] 開発用の一時ルートポリラインを削除済み
- [ ] 本番地図データのみを残す構成へ整理済み

## 19. 2026-07-02 Security Remediation Update

- [x] `mediamtx/mediamtx.yml` の追跡中 RTSP 資格情報をプレースホルダへ置換済み
- [x] `apps/desktop/mediamtx/mediamtx.yml` の追跡中 RTSP 資格情報をプレースホルダへ置換済み
- [x] `prisma/seed.mjs` の既定カメラ認証情報をプレースホルダへ置換済み
- [x] `docs/mediamtx-local-setup.md` の実環境例をプレースホルダへ置換済み
- [x] `diff.txt` を削除済み
- [x] `blue_print.txt` を削除済み
- [x] `route.txt` を削除済み
- [ ] 過去に露出した秘密情報のローテーションを完了
- [x] デスクトップ TypeScript typecheck の既存型負債を解消

補足:

- `apps/desktop/src/demo/kawachinagano-demo-routes.ts` と `apps/desktop/src/hooks/useDemoVehicleLocations.ts` は、デモ専用経路として残置しています
- 本番デフォルト動作では利用されませんが、将来不要が確定した段階で削除を推奨します

### Typecheck Status

- [x] `corepack pnpm --filter @kurukuru-monitor/desktop typecheck`
- [x] `corepack pnpm --filter @kurukuru-monitor/api typecheck`
