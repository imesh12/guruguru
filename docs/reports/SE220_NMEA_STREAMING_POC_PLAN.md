# SE220 NMEA Streaming PoC Plan

## Executive Summary

Kurukuru Monitor では SE220 の `get_gnss_info.cgi` を用いた HTTPS ポーリングが既に動作していますが、実測では `routerGnssTime` が約 7〜8 秒間隔でしか進まず、1 秒単位の高頻度追従には不十分です。バックエンドの `receivedAt` は 1.4〜2.4 秒程度で更新され続けているため、Kurukuru Monitor 側のポーリング自体よりも、**SE220 側が API に載せる GNSS スナップショット更新周期** が主な制約になっている可能性が高いと判断できます。

このため、SE220 が NMEA0183 を UDP または TCP で 1Hz 近く送信できるなら、**HTTP ポーリングを fallback、NMEA ストリーミングを primary real-time feed** にする構成が最も有力です。本書は、その PoC を安全に進めるための技術計画です。

## 1. Why HTTP Polling Is Not Enough

`get_gnss_info.cgi` の問題は、HTTP の通信速度ではなく、返却される GNSS サンプル自体の更新頻度です。

確認済み事項:

- API リクエストは成功している
- request latency は概ね `400–1400ms`
- effective polling interval は概ね `1.4–2.4s`
- `receivedAt` は比較的短い間隔で更新される
- しかし `routerGnssTime` は約 `7–8s` ごとにしか進まない

その結果:

- オペレーター画面では「更新 1 秒前」と見えても
- 実際の GNSS サンプルは `GNSS age 8.1s` のように古い

つまり、**通信 freshness** と **位置 freshness** が分離しており、HTTP ポーリングだけでは strict real-time tracking を満たせません。

## 2. Evidence From Observed `routerGnssTime`

既存調査と実測で、以下のような時刻進行が確認されています。

```text
07:09:52
07:10:01
07:10:09
07:10:17
07:10:25
07:10:33
07:10:41
07:10:49
```

また `/gps/latest` 上でも同様に、

- `receivedAt` は数秒以内に更新
- `duplicateSample=true` が連続
- `routerGnssTime` が 7〜8 秒ごとにしか変わらない

というパターンが見えています。

結論:

- Kurukuru Monitor の poll request は通っている
- 返ってくる GNSS 値が古い
- よって、**SE220 HTTP API はリアルタイム feed ではなく latest snapshot に近い** とみなすべきです

## 3. Existing NMEA Receiver Capabilities

既存実装から、Kurukuru Monitor にはすでに SE220 の NMEA0183 を受ける receiver が存在します。

対象ファイル:

- [apps/api/src/services/se220-receiver.ts](/C:/Users/cs_in/projects/kurukuru-monitor/apps/api/src/services/se220-receiver.ts)
- [apps/api/src/server.ts](/C:/Users/cs_in/projects/kurukuru-monitor/apps/api/src/server.ts)
- [apps/api/src/services/gps-state.ts](/C:/Users/cs_in/projects/kurukuru-monitor/apps/api/src/services/gps-state.ts)

実装済み能力:

- UDP mode
- TCP mode
- NMEA line parsing
- `RMC` 系 sentence 解析
- `GGA` 系 sentence 解析
- source IP / receiver id による vehicle mapping
- `GpsStateService.ingest()` への直接投入
- API 起動時の receiver start / stop

対応 sentence:

- `$GPRMC`
- `$GNRMC`
- `$GPGGA`
- `$GNGGA`

このため、PoC の前提条件として **Kurukuru Monitor 側に大きな新規基盤追加は不要** です。

## 4. Current Receiver Behavior Summary

### UDP mode

- `dgram.createSocket('udp4')`
- `0.0.0.0:<SE220_RECEIVER_PORT>` で bind
- 受信 datagram を行分割
- 各行を `handleNmeaLine()` へ投入

### TCP mode

- `net.createServer()`
- `0.0.0.0:<SE220_RECEIVER_PORT>` で listen
- 受信 buffer を改行で分割
- 各行を `handleNmeaLine()` へ投入

### Vehicle mapping

- `SE220_VEHICLE_MAP` を JSON で受け取る
- 基本は source IP を key に vehicle id を決定
- envelope に `receiver=...;` が付く場合は `receiver:<id>` マッピングも可能

### Integration path

現在の NMEA receiver は `GpsStateService` に直接流し込む構造です。

```text
SE220 NMEA UDP/TCP
  -> Se220Receiver
  -> parseNmeaLine / handleNmeaLine
  -> GpsStateService.ingest()
  -> /gps/latest
  -> /ws/vehicles
  -> Desktop map
```

## 5. UDP Mode Plan

PoC の第一候補は UDP です。

理由:

- 設定が比較的簡単
- ルーター側実装でよくある
- 1Hz 連続送信に向く
- 接続維持が不要

PoC 手順:

1. Kurukuru Monitor API 側で UDP receiver を有効化
2. `SE220_RECEIVER_PORT=5018` など専用ポートを使用
3. SE220 側で NMEA UDP 送信先を API PC の IP + `5018/udp` に設定
4. `RMC` と `GGA` を有効にする
5. `/gps/latest` とログで freshness を比較する

期待:

- `source` が NMEA 受信系に変わる
- `receivedAt` がほぼ 1 秒ごとに進む
- `duplicateSample` が HTTP より減る
- `routerGnssTime` に相当する freshness がより短くなる

## 6. TCP Mode Plan

UDP でうまくいかない場合の第二候補が TCP です。

理由:

- ルーターによっては TCP push のみ安定する場合がある
- packet loss を避けたい場合に有利

PoC 手順:

1. Kurukuru Monitor API 側で `SE220_RECEIVER_MODE="tcp"`
2. `SE220_RECEIVER_PORT=5018`
3. SE220 側で NMEA TCP 送信先を API PC に設定
4. 改行区切りの live stream が流れるか確認

注意:

- TCP は stateful なので、切断時の再接続 behavior を観察する
- firewall 例外は `5018/tcp` が必要

## 7. Required SE220 Router Settings

PoC 前にルーターで確認したい項目:

- GNSS / GPS 機能が有効
- NMEA output が有効
- Output transport:
  - UDP もしくは TCP
- Destination host:
  - Kurukuru Monitor API が動いている PC の IP
- Destination port:
  - `5018`
- Sentence selection:
  - `RMC`
  - `GGA`
- Send interval:
  - 可能なら `1 second`
- Source binding / receiver ID:
  - 必要に応じて識別可能な設定

UI 名称は機種や firmware により異なる可能性がありますが、次の用語を探してください。

- GPS settings
- GNSS settings
- NMEA settings
- Location output
- Tracking output
- UDP reporting
- TCP reporting
- Telemetry settings

## 8. Required Firewall / Network Settings

### API PC 側

- UDP mode:
  - inbound `5018/udp` を許可
- TCP mode:
  - inbound `5018/tcp` を許可

### Router 側

- API PC へ到達できる経路が必要
- NAT 越えや閉域構成なら送信先 IP を再確認

### Office / Field Network

- 車両ルーターから API PC へ到達できること
- 片方向 push だけでよいか、疎通確認用に双方向が必要か確認

## 9. Expected NMEA Sentences

PoC で最低限見たい sentence:

- `RMC`
  - 時刻
  - 緯度経度
  - speed
  - heading
- `GGA`
  - 時刻
  - 緯度経度
  - fix quality

既存 receiver 実装では:

- `RMC` は speed / heading も取れる
- `GGA` は座標中心で、quality > 0 のとき有効

推奨:

- まずは `RMC + GGA`
- sentence が多すぎるとノイズになるため、PoC 初期は必要最小限にする

## 10. How To Compare NMEA Freshness vs HTTP Polling

PoC の重要点は、HTTP と NMEA の比較です。

### 比較指標

- `receivedAt`
- `source`
- `routerGnssTime` または NMEA sentence time
- `duplicateSample`
- `requestDurationMs`
- `routerSampleAgeMs`

### 比較方法

1. HTTP direct polling を有効のまま残す
2. NMEA receiver を有効化する
3. 片方ずつ / 並行でログを比較する
4. Desktop 上の marker movement と freshness 表示も観察する

期待する差:

- HTTP:
  - `receivedAt` は進む
  - でも `routerGnssTime` は 7〜8 秒刻み
- NMEA:
  - sentence time も `receivedAt` も 1 秒前後で進むなら勝ち

## 11. Rollback Plan

PoC が失敗した場合も、現在の direct polling を維持して戻せるようにします。

ロールバック手順:

1. `SE220_RECEIVER_ENABLED="false"`
2. `SE220_DIRECT_POLLING_ENABLED="true"` を維持
3. API 再起動
4. `/gps/latest` で `source=rooster-se220-direct` を確認

このため、**HTTP polling は fallback として常に残す** 方針が安全です。

## 12. Recommended `.env` Examples

### UDP PoC Example

```env
SE220_RECEIVER_ENABLED="true"
SE220_RECEIVER_MODE="udp"
SE220_RECEIVER_PORT="5018"
SE220_DIRECT_POLLING_ENABLED="true"
SE220_VEHICLE_MAP="{\"router-public-or-private-ip\":\"vehicle-id\"}"
```

### TCP PoC Example

```env
SE220_RECEIVER_ENABLED="true"
SE220_RECEIVER_MODE="tcp"
SE220_RECEIVER_PORT="5018"
SE220_DIRECT_POLLING_ENABLED="true"
SE220_VEHICLE_MAP="{\"router-public-or-private-ip\":\"vehicle-id\"}"
```

### Notes

- direct polling は残す
- Android GPS support は無効化しない
- 実運用 credential は `.env` 以外へ出さない

## 13. Test Commands

### Start API

```powershell
corepack pnpm --filter @kurukuru-monitor/api dev
```

### Windows Firewall / port confirmation

UDP listening 確認:

```powershell
netstat -ano | findstr :5018
```

TCP listening 確認:

```powershell
netstat -ano | findstr :5018
```

### Check latest GPS

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4000/gps/latest"
```

### Compare source / gnssTime / receivedAt / routerSampleAgeMs

```powershell
(Invoke-RestMethod -Uri "http://127.0.0.1:4000/gps/latest").vehicles |
  Select-Object vehicleId, source, receivedAt,
    @{Name="routerGnssTime";Expression={$_.investigation.routerGnssTime}},
    @{Name="routerSampleAgeMs";Expression={$_.investigation.routerSampleAgeMs}},
    @{Name="duplicateSample";Expression={$_.investigation.duplicateSample}}
```

### Continuous comparison

```powershell
while ($true) {
  (Invoke-RestMethod -Uri "http://127.0.0.1:4000/gps/latest").vehicles |
    Select-Object vehicleId, source, receivedAt,
      @{Name="routerGnssTime";Expression={$_.investigation.routerGnssTime}},
      @{Name="routerSampleAgeMs";Expression={$_.investigation.routerSampleAgeMs}},
      @{Name="duplicateSample";Expression={$_.investigation.duplicateSample}}
  Start-Sleep -Seconds 2
}
```

## 14. Final Recommendation

最終推奨は次のとおりです。

- **HTTP polling は fallback**
- **NMEA UDP/TCP streaming は primary real-time feed**

前提条件:

- SE220 が 1Hz 近い NMEA output を出せること
- API PC へ UDP/TCP 送信できること

PoC の評価基準:

- HTTP の 7〜8 秒刻みより明確に新鮮か
- duplicate sample が大幅に減るか
- map follow が自然に見えるか
- 運用上の firewall / routing が許容範囲か

NMEA が 1Hz 相当で流れるなら、Kurukuru Monitor の strict real-time 改善としては **最優先で採用すべき候補** です。
