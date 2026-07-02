# Kurukuru Monitor v1.0 事前コード監査報告書

- 作成日: 2026-07-02
- 対象リポジトリ: `C:\Users\cs_in\projects\kurukuru-monitor`
- 監査目的: Ubuntu 本番配備前のセキュリティ・安定性・型安全性・一時コード残存・配備リスクの確認
- 監査条件: コード変更は行わず、現時点の作業ツリーを対象に確認

## Executive Summary

Kurukuru Monitor は、地図監視、GNSS 収集、カメラ監視、Electron デスクトップ、ブラウザ地図の主要機能が概ね揃っており、運用実証に近い段階にあります。一方で、v1.0 本番配備前に見過ごせない問題が複数残っています。

特に重大なのは、追跡対象ファイル内に実運用相当の RTSP 資格情報が残っていること、デスクトップ側 TypeScript 型チェックが通っていないこと、そして現在の作業ツリーが未コミット変更・未追跡ファイルを含む非再現状態であることです。これらは Ubuntu 本番導入前の停止条件に相当します。

結論として、現時点のコードベースは「機能的には試験運用可能だが、本番配備 Go 判定には未達」です。最低限、秘密情報除去、クリーンなリリースソース固定、デスクトップ型不整合整理、公開 API の露出方針整理を完了してから配備すべきです。

## Overall Deployment Readiness Score

**58 / 100**

評価内訳:

- 機能完成度: 78
- 運用・配備資材: 72
- 安定性: 68
- セキュリティ: 35
- リリース再現性: 38

## Blocking Issues

### 1. 追跡対象ファイルに秘密情報が残存

以下は本番配備前に必ず除去・ローテーションが必要です。

- `mediamtx/mediamtx.yml`
- `apps/desktop/mediamtx/mediamtx.yml`
- `prisma/seed.mjs`
- `docs/mediamtx-local-setup.md`
- `diff.txt`

確認内容:

- `mediamtx/*.yml` に RTSP URL 内の資格情報が平文で残存
- `prisma/seed.mjs` に既定カメラパスワード相当の値が残存
- `diff.txt` に資格情報を含む差分断片が残存
- ドキュメント中に秘密の実例値が残存

評価: **即時是正必須**

### 2. デスクトップ TypeScript 型チェック不合格

実行結果:

- `corepack pnpm --filter @kurukuru-monitor/api typecheck` : 成功
- `corepack pnpm --filter @kurukuru-monitor/desktop typecheck` : 失敗

主な失敗群:

- `window.electronAPI` の型定義と実装の乖離
- `getRuntimeConfig`
- `wallDebugLog`
- `reportCameraSessionState`
- `listPlaceMarkers`
- `onPlaceMarkersChanged`
- `createVehicle` / `updateVehicle` / `deleteVehicle`
- `createCamera` / `updateCamera` / `deleteCamera`
- `getCameraRuntimePlaybackConfig`
- `syncCameraLayout`
- `runRecoveryAction`

主な影響ファイル:

- `apps/desktop/src/pages/VideoWallPage.tsx`
- `apps/desktop/src/pages/SettingsPage.tsx`
- `apps/desktop/src/pages/CameraPlayerPage.tsx`
- `apps/desktop/src/hooks/usePlaceMarkers.ts`
- `apps/desktop/src/hooks/useRuntimeConfig.ts`
- `apps/desktop/src/hooks/useVehicleGpsFeed.ts`
- `apps/desktop/src/hooks/useWebRtcPlayer.ts`
- `apps/desktop/src/components/PlaceMarkerManagerSection.tsx`

評価: **本番リリース前のビルド品質ゲート未達**

### 3. 作業ツリーがクリーンでなく、再現可能リリース状態ではない

監査時点の `git status --short`:

- 変更済み:
  - `apps/api/src/server.ts`
  - `apps/desktop/electron/main.ts`
  - `apps/desktop/src/components/MapPanel.tsx`
  - `apps/desktop/src/hooks/usePlaceMarkers.ts`
  - `mediamtx/mediamtx.yml`
- 未追跡:
  - `apps/api/src/routes/place-markers.ts`
  - `apps/api/src/services/place-markers.ts`

意味:

- ブラウザ場所マーカー対応は未追跡 API ファイルに依存している
- クローンし直した環境では再現できない可能性がある
- Ubuntu 本番配備用ソースとして固定できない

評価: **本番導入前に整理必須**

## High Priority Issues

### 1. 無認証公開 API が運用情報を広く露出

無認証または LAN 前提で公開されている経路:

- `GET /gps/latest`
- `GET /gps/vehicles-meta`
- `GET /api/place-markers`
- `GET /system/status`
- `GET /health`
- `GET /health/deep`
- `GET /ws/vehicles`

懸念:

- `gps/latest` は現在位置を返す
- `gps/vehicles-meta` は車両名と色設定を返す
- `place-markers` は施設地点情報を返す
- `system/status` は watchdog 状態、GPU、mpv 件数、カメラ状態を返す
- `health/deep` は DB URL、MediaMTX 到達性、内部ポート情報を返す

現状は「LAN 内運用」前提なら運用可能ですが、Ubuntu 本番では nginx / ファイアウォール / VLAN / 端末制限のいずれかで公開面を制限すべきです。

### 2. `CREDENTIAL_ENCRYPTION_KEY` が本番でも必須化されていない

`apps/api/src/services/camera-credentials.ts` では、鍵未設定時に警告のみで継続します。  
そのため本番でもカメラパスワードが平文保存されうる設計です。

評価: **本番前に強制化推奨**

### 3. systemd サービス定義の堅牢化不足

`deployment/systemd/kurukuru-api.service` の懸念:

- `ExecStart=/usr/bin/env pnpm ...` で `pnpm` 依存
- `NODE_ENV=production` 明示なし
- `After=network-online.target` ではなく `network.target`
- `Restart=always` はあるが、起動前チェックや依存待ちが弱い
- `UMask`, `NoNewPrivileges`, `ProtectSystem`, `ProtectHome` 等の hardening なし

現状でも動作は可能ですが、本番常駐サービスとしては補強余地が大きいです。

### 4. `health/deep` が内部情報を過剰に返す

`apps/api/src/routes/health.ts` の `/health/deep` は以下を返します。

- Database URL
- MediaMTX API URL
- WHEP host / port
- critical table 情報

監視用には有用ですが、無認証公開のままにすべきではありません。

## Medium Priority Issues

### 1. Video Wall に旧 fullscreen 実装の残骸がある

`apps/desktop/src/pages/VideoWallPage.tsx` には以下が残存しています。

- `fullscreenCameraId` state
- fullscreen 用 grid 分岐
- fullscreen 関連 bounds 比較

一方で `setFullscreenCameraId(...)` に非 null を設定する経路は見当たらず、現在はポップアウト方式に移行済みです。  
実害は限定的ですが、保守性を下げています。

### 2. Kawachinagano デモルート資材がまだ追跡中

残存ファイル:

- `apps/desktop/src/demo/kawachinagano-demo-routes.ts`
- `apps/desktop/src/hooks/useDemoVehicleLocations.ts`

本番で `VITE_DEMO_GPS_LOOP` を使わなければ動作影響は限定的ですが、v1.0 配備パッケージとしては混乱要因です。

### 3. `blue_print.txt`, `diff.txt`, `route.txt` が追跡中

これらは設計メモ / 差分断片 / 作業残骸の性質が強く、本番配備物・監査対象ソースとしてはノイズです。

### 4. place marker ブラウザ対応がポーリング依存

ブラウザ側 `usePlaceMarkers()` は Electron IPC が無い場合、API を 5 秒周期で再取得します。  
機能上は問題ありませんが、リアルタイム同期としては WebSocket 連携より一段劣ります。

## Low Priority Issues

### 1. 管理者セッションが `sessionStorage` 保存

`apps/desktop/src/auth/AdminAuthContext.tsx` は admin session token を `sessionStorage` に保持します。  
同一ブラウザセッション内での扱いとしては実用的ですが、XSS 耐性は Cookie + HttpOnly より弱いです。

### 2. browser map 用に無認証メタデータ API が増加

`/gps/vehicles-meta` はブラウザ地図用に妥当ですが、公開経路が増えるため将来的には Operator 用公開 API 群を明示的に分離した方がよいです。

## Security Findings

### 重大

1. 追跡ファイル内に RTSP 認証情報が残存
2. seed データに既定パスワード相当値が残存
3. 差分ファイル・補助文書に秘密情報断片が残存

### 高

1. `/health/deep` 無認証公開
2. `/system/status` 無認証公開
3. `CREDENTIAL_ENCRYPTION_KEY` 未設定でも本番起動継続

### 中

1. 管理者セッショントークンは `sessionStorage` 保存
2. `ALLOW_INSECURE_ADMIN_PASSWORD=true` を設定すると `plain:` ハッシュが有効になる

### 所見

- `ADMIN_PASSWORD_HASH` 自体の実装は比較的妥当です
  - `sha256:` と `scrypt:` をサポート
  - 文字列比較は timing-safe 比較使用
- `ADMIN_SESSION_SECRET` も HMAC 署名に使われており、未設定時は admin auth 非構成扱い
- `API_TOKEN` は管理 API 保護に利用されるが、ブラウザ地図向け公開 API は保護対象外

## Stability Findings

### 良好な点

- WebSocket は切断時に HTTP fallback を試みる
- `useVehicleGpsFeed` は age 更新とアニメーションを分離しており、通常の GPS 更新には比較的強い
- SE220 直ポーリングは `Promise.all` で各ターゲット並列、かつ target ごとに `inFlight` 制御あり
- Camera popout は専用 route に分離され、主画面との責務分離はできている
- ブラウザ地図の `window.electronAPI` 非依存 fallback は概ね整理済み

### 注意点

- SE220 ルータ側 GNSS サンプルが 7–8 秒更新の可能性があり、1 秒ポーリングでも位置鮮度は保証されない
- browser place markers / vehicle colors は browser fallback 実装に依存し、現状は dirty worktree 依存部分がある
- map 初期センタリングは改善済みだが、最初の API 取得が大きく遅延した場合の UX リスクは残る
- `systemd` の `Restart=always` はあるが、依存サービス待ち・環境不備時の原因切り分けは弱い

## Typecheck Findings

### API

- `corepack pnpm --filter @kurukuru-monitor/api typecheck`
- 結果: **成功**

### Desktop

- `corepack pnpm --filter @kurukuru-monitor/desktop typecheck`
- 結果: **失敗**

### Blocking before deployment

- `window.electronAPI` 型定義が renderer 側利用に追従していない
- 新規機能追加のたびに型安全性が崩れる状態
- リリース前の変更検証が難しい

### Non-blocking existing type debt

- `unknown` のまま state へ流し込んでいる箇所
- callback parameter の暗黙 `any`
- 一部 old route / player page の補助型不足

### Recommended cleanup after deployment

- `global.d.ts` と `preload.ts` を単一ソース化
- IPC contract 型を shared package に切り出し
- `CameraPlayerPage`, `SettingsPage`, `VideoWallPage` の `unknown` を解消

## Dead Code / Temporary Code Findings

- `apps/desktop/src/demo/kawachinagano-demo-routes.ts`
- `apps/desktop/src/hooks/useDemoVehicleLocations.ts`
- `blue_print.txt`
- `diff.txt`
- `route.txt`
- `VideoWallPage.tsx` の dead fullscreen state

補足:

- `CameraPlayerPage.tsx` 自体は route `/camera/:cameraId` でまだ利用されているため dead code とは断定しません
- `CameraPopoutPage.tsx` は現在の popout 実装で使用中です

## Production Deployment Risks

### デモ当日に失敗しうる項目

- MediaMTX の RTSP 到達不可
- Google Maps / Mapbox key 未設定
- `VITE_API_BASE_URL` が LAN 到達可能 URL でない
- place marker / vehicle color の browser fallback 実装が dirty worktree 非反映状態

### 再起動後に失敗しうる項目

- `pnpm` PATH 未解決により systemd API サービス起動失敗
- `.env.production` 未配置または不整合
- nginx 未有効化
- MediaMTX binary / path 不一致

### ネットワーク変更時に失敗しうる項目

- browser map が `127.0.0.1` 向きのまま
- SE220 public/private IP 変更で direct polling 失敗
- Google Maps referrer 制限不一致

### GNSS 停滞時に起きること

- backend heartbeat は新しいが router GNSS sample は stale
- UI は「更新 1 秒前」でも「GNSS stale」を示しうる
- これは実装不具合ではなく、SE220 側更新頻度制約の可能性が高い

### RTSP 不達時に起きること

- wall / popout で reconnect / offline 表示
- `system/status` 側に camera offline が反映
- MediaMTX 設定再生成は行われても映像復旧は保証されない

## Recommended Fixes Before Ubuntu Deployment

1. `mediamtx/*.yml`, `prisma/seed.mjs`, `diff.txt`, 関連 docs から秘密情報を除去し、露出済み資格情報をローテーションする
2. クリーンな release branch / tag を作成し、未コミット・未追跡ファイルに依存しない状態へ固定する
3. `corepack pnpm --filter @kurukuru-monitor/desktop typecheck` を通す
4. `/health/deep` と `/system/status` を少なくとも LAN 制限または admin token 制限にする
5. `CREDENTIAL_ENCRYPTION_KEY` を本番必須化する
6. systemd service を hardening し、`pnpm` 依存と `NODE_ENV=production` を明示する
7. `blue_print.txt`, `diff.txt`, `route.txt`, demo route 資材の扱いを整理し、本番配備物から外す

## Safe To Deploy Decision

**No-Go**

理由:

- 追跡対象に秘密情報が残存
- デスクトップ型チェック不合格
- 作業ツリーが dirty で再現可能リリース状態ではない

ただし、上記 Blocking Issues を解消した後であれば、現行アーキテクチャのまま Ubuntu 本番配備へ進むことは十分現実的です。

## Final Go / No-Go Checklist

### Go 判定前の必須条件

- [ ] `mediamtx/*.yml` から実資格情報を除去済み
- [ ] `prisma/seed.mjs` の既定秘密値を除去または無効化済み
- [ ] `diff.txt`, `blue_print.txt`, `route.txt` の要否整理済み
- [ ] 露出済み RTSP / API / 管理者秘密情報をローテーション済み
- [ ] `corepack pnpm --filter @kurukuru-monitor/api typecheck` 成功
- [ ] `corepack pnpm --filter @kurukuru-monitor/desktop typecheck` 成功
- [ ] release 用 commit / tag を切り、dirty worktree ではない
- [ ] `/health/deep` と `/system/status` の公開方針を決定済み
- [ ] `CREDENTIAL_ENCRYPTION_KEY` を本番で必須設定済み
- [ ] Ubuntu 用 `.env.production` を本番値で作成済み
- [ ] nginx / systemd / MediaMTX の起動確認済み
- [ ] Browser Map を別 PC から確認済み
- [ ] Camera popout を別モニタ運用で確認済み
- [ ] backup / restore / failover-check 実施済み

### 条件付きで後回し可能

- [ ] fullscreen 残骸コード整理
- [ ] browser place marker の push 同期化
- [ ] demo route ファイル完全削除
- [ ] IPC 型定義の shared 化

## Appendix: 実行コマンド

```bash
corepack pnpm --filter @kurukuru-monitor/api typecheck
corepack pnpm --filter @kurukuru-monitor/desktop typecheck
git status --short
git diff --stat
git ls-files "*.env" "*.example"
git ls-files | rg "diff.txt|blue_print.txt|kawachinagano|route.txt|mediamtx.yml|seed.mjs|CameraPopoutPage.tsx|CameraPlayerPage.tsx"
rg -n "TODO|FIXME|TEMP|DEBUG|DEMO|Kawachinagano|Osaka|DEFAULT_MAP_CENTER|API_TOKEN|ADMIN_PASSWORD_HASH|ADMIN_SESSION_SECRET|VITE_GOOGLE_MAPS_API_KEY|VITE_MAPBOX_ACCESS_TOKEN|rtsp://|password|secret|CREDENTIAL_ENCRYPTION_KEY" -S .
```

## 2026-07-02 Remediation Update

本監査で Blocking 扱いとしていたうち、以下は是正済みです。

- `mediamtx/mediamtx.yml` の追跡中 RTSP 資格情報をプレースホルダへ置換
- `apps/desktop/mediamtx/mediamtx.yml` の追跡中 RTSP 資格情報をプレースホルダへ置換
- `prisma/seed.mjs` の既定カメラ認証情報をプレースホルダへ置換
- `docs/mediamtx-local-setup.md` の実環境ホスト・認証例をプレースホルダへ置換
- `diff.txt` を削除
- `blue_print.txt` を削除
- `route.txt` を削除

今回あえて残したもの:

- `apps/desktop/src/demo/kawachinagano-demo-routes.ts`
- `apps/desktop/src/hooks/useDemoVehicleLocations.ts`

理由:

- これらは本番デフォルト動作では使用されず、`VITE_DEMO_GPS_LOOP` を有効化した場合のみ利用されるデモ支援コードです
- 現時点で削除するとデモ検証フローを別途組み替える必要があり、v1.0 配備直前の変更としては安全性が低いため、今回は「残置するが本番では無効」を採用しています

継続必須事項:

- 既に露出済みの RTSP 認証情報、API token、管理者系秘密情報は必ずローテーションすること
- 置換済みプレースホルダは「漏えい防止」であり、「過去露出の無効化」ではない
