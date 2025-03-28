# Max 9 v8ui OSCブリッジ

Claude DesktopのMCPサーバーとMax 9を連携させるためのOSCブリッジ実装です。このコンポーネントは、Issue 2「Max 9 v8ui OSCブリッジの実装（JavaScript）」の成果物です。

## 機能概要

このOSCブリッジは以下の機能を提供します：

1. **OSC通信機能**：MCPサーバーとMax 9間の双方向通信
2. **パッチ操作**：新規パッチの作成、保存
3. **オブジェクト操作**：オブジェクトの作成、接続、パラメータ設定
4. **状態管理**：Max 9内部の状態をMCPサーバーと同期

## ファイル構成

- **mcp_osc_bridge.js**: v8ui環境で実行されるJavaScriptコード
- **mcp_osc_bridge.maxpat**: Max 9パッチファイル
- **.env**: OSC通信の設定ファイル

## インストール方法

1. `max-osc-bridge`ディレクトリをMax 9のPackagesディレクトリにコピーします
2. `.env`ファイルのIP・ポート設定を環境に合わせて変更します
3. Maxを起動し、`mcp_osc_bridge.maxpat`を開きます

## 使い方

1. Max 9を起動し、`mcp_osc_bridge.maxpat`を開きます
2. パッチ内の「script start」メッセージをクリックしてブリッジを起動します
3. MCPサーバー側から接続リクエストを送信します

## OSCメッセージフォーマット

### MCPサーバーからMax 9への送信メッセージ

| アドレス | 引数 | 説明 |
|---------|------|------|
| `/mcp/system/connection` | connection_status (int) | 接続要求 |
| `/mcp/system/status` | なし | 状態情報リクエスト |
| `/mcp/patch/create` | patch_id (string), patch_name (string) | 新規パッチ作成 |
| `/mcp/object/create` | patch_id (string), object_id (string), object_type (string), x (int), y (int) | オブジェクト作成 |
| `/mcp/object/connect` | source_id (string), source_outlet (int), target_id (string), target_inlet (int) | オブジェクト接続 |
| `/mcp/object/param` | object_id (string), param_name (string), param_value (any) | パラメータ設定 |
| `/mcp/patch/save` | patch_id (string), file_path (string) | パッチ保存 |

### Max 9からMCPサーバーへの送信メッセージ

| アドレス | 引数 | 説明 |
|---------|------|------|
| `/max/response/connected` | status (int) | 接続状態通知 |
| `/max/response/status` | patch_count (int), object_count (int) | 状態情報応答 |
| `/max/response/patchCreated` | patch_id (string), patch_name (string) | パッチ作成成功 |
| `/max/response/objectCreated` | patch_id (string), object_id (string), object_type (string), x (int), y (int) | オブジェクト作成成功 |
| `/max/response/objectConnected` | source_id (string), source_outlet (int), target_id (string), target_inlet (int) | オブジェクト接続成功 |
| `/max/response/paramSet` | object_id (string), param_name (string), param_value (any) | パラメータ設定成功 |
| `/max/response/patchSaved` | patch_id (string), file_path (string) | パッチ保存成功 |
| `/max/error/*` | error_message (string) | エラー通知 |
| `/max/params/*` | param_value (any) | パラメータ値変更通知 |

## エラーハンドリング

エラーが発生した場合、Max 9からMCPサーバーへ`/max/error/[操作名]`アドレスでエラーメッセージが送信されます。例えば、パッチ作成に失敗した場合は`/max/error/patchCreate`が送信されます。

## 開発者向け情報

v8ui環境でのJavaScript実行には制限があるため、このブリッジではv8uiとnode.scriptの両方の機能を活用しています：

- **v8ui**: UI操作、Maxオブジェクト操作
- **node.script**: OSC通信、ファイルIO操作

開発を継続する場合は、Max 9のJavaScript APIドキュメントを参照してください。
