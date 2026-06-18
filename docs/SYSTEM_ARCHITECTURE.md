# Kurukuru Monitor システムアーキテクチャ

## 1. システム概要

Kurukuru Monitor は、車両の現在位置、運行状況、映像監視を一元的に扱うリアルタイム車両監視・運行支援プラットフォームです。現場の車両、GPS 端末、ネットワーク機器、映像配信基盤、デスクトップ監視アプリケーションを連携させ、オペレーターが地図・映像・状態情報を同一画面系で把握できる構成を採用しています。

主な機能は次のとおりです。

- リアルタイム GPS 監視
- Android GPS Tracker 連携
- SE220 GNSS ルーター連携
- ライブ地図表示
- 車両 Follow モード
- 3D マップ表示
- Place Marker 管理
- カメラ監視
- WebRTC 動画配信
- 複数車両の同時運行監視

## 2. 高レベルアーキテクチャ

全体構成は [docs/architecture/architecture.drawio](/C:/Users/cs_in/projects/kurukuru-monitor/docs/architecture/architecture.drawio) を参照してください。

Kurukuru Monitor は、以下の主要コンポーネントで構成されます。

- Android GPS Tracker
  現場車両から 1 秒単位の位置情報や追跡状態を送信するモバイル端末です。
- SE220 Router
  GNSS 情報を直接取得できるルーター系機器であり、車両搭載側の代替または補完ソースとして利用されます。
- Fastify API Server
  GPS 取り込み、状態集約、認証、リアルタイム配信、システム管理 API を担います。
- SQLite
  Prisma 経由でアクセスされる軽量データストアであり、車両、カメラ、レイアウト、位置履歴などを保持します。
- WebSocket Layer
  API サーバーからデスクトップへ車両更新を即時配信するリアルタイム通知層です。
- MediaMTX
  RTSP 系映像ソースを中継し、WebRTC/WHEP 等でデスクトップへ配信するストリーミング基盤です。
- Electron Desktop Client
  オペレーター向け監視アプリケーションです。地図、車両一覧、カメラ映像、設定画面を統合します。
- Google Maps
  地図表示プロバイダーの一つで、Follow 表示や 3D マップ表現を提供します。
- Mapbox
  Google Maps と並行してサポートされる地図プロバイダーです。

## 3. コンポーネント設計

### API Server

API サーバーの責務は次のとおりです。

- GPS データ受信
- 車両状態管理
- 位置情報の集約と正規化
- WebSocket ブロードキャスト
- カメラ設定配信
- システム状態レポート

実装上は Fastify をベースに、HTTP ルート、位置管理サービス、GPS 状態管理、WebSocket 配信、システムハートビート処理を組み合わせた構成になっています。デスクトップアプリと Android/外部デバイスの間に位置する中核コンポーネントです。

### Desktop Application

デスクトップアプリケーションの責務は次のとおりです。

- 地図表示
- ビデオウォール表示
- 車両追跡
- オペレーター操作
- 設定管理

Electron をシェルとし、React ベースの UI を搭載しています。Google Maps / Mapbox の切り替え、Follow モード、3D 表示、Place Marker、映像監視などを統合し、監視員が日常運用で使用するフロントエンドを提供します。

### MediaMTX

MediaMTX の責務は次のとおりです。

- ストリーム中継
- WebRTC/WHEP 配信
- カメラソース管理

カメラや映像ソースを RTSP 等で受け取り、低遅延視聴に向けた配信経路を提供します。Kurukuru Monitor 本体の車両位置監視とは分離した責務で動作し、映像レイヤーを独立して維持できる構成です。

## 4. データフロー

### GPS 系データフロー

`GPS Device / Router -> API -> Database -> WebSocket -> Desktop`

1. Android GPS Tracker または SE220 Router が位置情報を API サーバーへ送信します。
2. API サーバーは入力データを検証し、必要な正規化を行います。
3. 最新位置や履歴情報は SQLite に保存され、関連する状態情報が更新されます。
4. API サーバーは更新内容を WebSocket でデスクトップへ配信します。
5. Electron Desktop Client は受信した車両情報を地図 UI に反映します。

### 映像系データフロー

`Camera -> MediaMTX -> Desktop`

1. 車載または拠点側カメラの映像が MediaMTX に入力されます。
2. MediaMTX が映像を中継し、WebRTC/WHEP などの形式で配信可能な状態にします。
3. Electron Desktop Client が配信 URL またはセッション情報を利用して映像を表示します。

## 5. データベース設計

Kurukuru Monitor は Prisma + SQLite を採用しています。SQLite は単一ファイル型で扱いやすく、現行構成ではローカルまたは小規模拠点サーバー向けの運用に適しています。Prisma は型安全なアクセス層として機能し、API からのデータ操作を整理しています。

Prisma スキーマ上で確認できる主なエンティティは次のとおりです。

- `Vehicle`
  車両基本情報
- `Camera`
  車両または拠点に紐づくカメラ設定
- `LayoutConfig`
  画面レイアウト設定
- `LayoutSlot`
  ビデオウォール等の表示スロット設定
- `GpsPoint`
  受信 GPS 点情報
- `VehicleRoutePoint`
  車両ルートまたは履歴点
- `SystemEvent`
  システムイベント記録
- `AppSetting`
  アプリケーション設定
- `FieldTestSession`
  現地試験セッション
- `FieldTestItem`
  現地試験項目

現行パッチ方針では、車両監視や運用改善のために広範なスキーマ変更は前提としていません。

## 6. ネットワークポート

確認できる範囲では、API は環境により `4000` または `4001` を利用します。MediaMTX のポートは設定依存ですが、ローカル構成では RTSP / WebRTC / HLS / 管理 API の各ポートが個別に割り当てられる前提です。

現時点での運用文書上の推奨表記は以下です。

- API: `4000` / `4001`
- MediaMTX: configurable

環境ごとに実ポートが異なる可能性があるため、本番導入時は `.env` と `mediamtx/mediamtx.yml` を必ず確認してください。

## 7. セキュリティ

Kurukuru Monitor の基本的なセキュリティ観点は次のとおりです。

- API トークン認証
  管理系 API や保護対象エンドポイントは API トークンにより制御します。
- 環境変数管理
  API URL、認証トークン、地図 API キーなどは環境変数で注入します。
- シークレット管理
  `.env`、トークン、外部サービス資格情報は Git にコミットしない運用を徹底します。
- ネットワーク分離推奨
  API、MediaMTX、DB ファイル、監視端末は閉域または制限されたネットワーク上で運用することを推奨します。

追加推奨事項は以下です。

- デスクトップ端末と API サーバー間の疎通制御
- Windows Defender / ファイアウォール例外の明示管理
- 本番トークンの定期ローテーション
- 露出済みシークレットが疑われる場合の即時無効化

## 8. 将来アーキテクチャ

将来的な拡張候補は次のとおりです。

- Linux 配備
- 中央集約サーバー構成
- クラウド配備
- 高可用性構成
- PostgreSQL への移行

特に SQLite は小規模導入や現場配備に向きますが、長期的な多拠点展開や冗長化要件を考慮する場合、PostgreSQL 等への移行を視野に入れる余地があります。ただし現時点では、既存の軽量構成を維持しつつ安定運用を優先する方針が適しています。
