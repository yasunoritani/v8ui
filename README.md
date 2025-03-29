# Max 9 - Claude Desktop MCP 連携プロジェクト

## 1. プロジェクト概要

### 1.1 目的
Max 9とClaude Desktop（AIアシスタント）を連携させるカスタムMCP（Model Context Protocol）サーバーを開発し、自然言語によるMax 9の操作と制御を可能にする。これにより創造的なワークフローの向上と音楽・マルチメディア制作の効率化を実現する。

### 1.2 背景
MCPはAnthropicが開発したオープンプロトコルで、LLM（大規模言語モデル）と外部システムの連携を可能にする。Max 9は高度な音楽・マルチメディア制作環境であり、OSC機能とV8 JavaScriptエンジン（v8ui）を備えている。この両者を連携させることで、自然言語インターフェースを通じたMax 9の高度な操作が可能となる。

## 2. システム要件

### 2.1 機能要件

#### 基本機能
- Claude DesktopからMax 9への接続・認証
- パッチの作成・開閉・保存
- オブジェクトの作成・配置・編集
- オブジェクト間の接続管理
- パラメータの設定・調整
- パッチの実行制御（開始・停止）
- エラー報告と状態通知

#### 拡張機能
- パッチテンプレートの作成と適用
- 複雑なルーティング設定の自動化
- Max状態のスナップショット機能
- 高度なDSP処理の設定支援
- ユーザープリファレンスの学習と適用

### 2.2 技術要件

#### アーキテクチャ
- **3層アーキテクチャ**による実装
  - **MCPサーバー層**: node.scriptベースのMCPサーバー（FastMCPフレームワーク活用）
  - **通信層**: OSCプロトコルによるMax-MCP間の双方向通信
  - **Max実行層**: v8uiによるMax操作のブリッジ実装

#### 必須コンポーネント
- MCPサーバー（Node.js/FastMCP実装）
- OSC通信モジュール
- Max 9用v8uiブリッジ
- エラーハンドリングシステム
- 状態管理機構

#### パフォーマンス要件
- 最大遅延時間: 500ms以内（コマンド実行）
- 同時処理可能なコマンド数: 10
- リカバリー時間: 接続断から3秒以内

### 2.3 セキュリティ要件
- 環境変数によるアクセスレベル制御（full/restricted/readonly）
- OSCメッセージのバリデーション
- 破壊的操作に対する確認メカニズム
- ローカル実行環境のセキュリティ保護

## 3. 実装詳細

### 3.1 MCPツールセット
以下のカテゴリに分類したMCPツール群を実装：

1. **セッション管理**
   - 接続確立/切断
   - 状態確認
   - 環境設定

2. **パッチ操作**
   - 新規パッチ作成
   - パッチ保存
   - パッチ読み込み
   - 実行制御

3. **オブジェクト操作**
   - オブジェクト作成
   - オブジェクト配置
   - プロパティ設定
   - 接続管理

4. **パラメータ制御**
   - 値設定/取得
   - オートメーション
   - マッピング設定

### 3.2 OSC通信仕様
- **基本アドレスパターン**: `/mcp/[カテゴリ]/[アクション]`
- **引数形式**: `[引数1] [引数2]...`
- **応答アドレス**: `/max/response/[元コマンドID]`
- **エラー通知**: `/max/error/[元コマンドID]`
- **パラメータ同期**: `param.osc`オブジェクトを活用した双方向パラメータ同期

### 3.3 実装アプローチ
- **MCPサーバー**: node.script環境でのFastMCPフレームワーク活用
- **OSCブリッジ**: v8ui環境でのJavaScript実装
- **認証メカニズム**: 環境変数による設定と制御

```json
// MCPサーバー設定例
{
  "mcpServers": {
    "max9-mcp": {
      "command": "node",
      "args": ["max9-mcp-server.js"],
      "env": {
        "MAX_HOST": "127.0.0.1", 
        "MAX_OSC_PORT": "7400",
        "MAX_ACCESS_LEVEL": "full"
      }
    }
  }
}
```

## 4. 開発計画

### 4.1 フェーズ分割

#### フェーズ1: 基盤構築
- MCPサーバープロトタイプ開発
- 基本的なOSCブリッジ実装
- 接続テストと検証

#### フェーズ2: 基本機能実装
- 基本操作セットの実装（パッチ作成、オブジェクト操作）
- エラーハンドリング機構の実装
- 基本的なフィードバック機能

#### フェーズ3: 拡張機能開発
- パラメータ同期メカニズムの実装
- テンプレート機能の開発
- 高度な状態管理機能

#### フェーズ4: 統合・テスト
- エンドツーエンドテスト
- パフォーマンス最適化
- ドキュメント作成

### 4.2 リスク管理
- **技術的リスク**: OSC通信の遅延・不安定性
  - 対策: バッファリングと再試行メカニズム
- **機能的リスク**: 複雑なMax操作の正確な変換
  - 対策: 段階的実装と徹底したテスト
- **統合リスク**: Claude Desktop - MCP - Max間の連携不具合
  - 対策: モジュール分割とインターフェース明確化

## 5. 成果物

### 5.1 ソフトウェアコンポーネント
- **Max-MCPサーバー**: Node.jsベースのMCPサーバー
- **Max-OSCブリッジ**: v8uiで実装されたOSC通信レイヤー
- **サンプルパッチ**: テスト用Maxパッチセット

### 5.2 ドキュメント
- **APIリファレンス**: MCPツールと対応するMax操作の詳細説明
- **実装ガイド**: 拡張方法と実装パターン
- **ユーザーガイド**: 使用方法と例示

## 6. 評価基準

- **機能完全性**: 要件に定義されたすべての機能の実装
- **応答性**: コマンド実行時間が500ms以内
- **安定性**: エラー発生率5%未満、自動リカバリー成功率95%以上
- **使いやすさ**: 自然言語指示の70%以上が正確に実行される
- **拡張性**: 新機能追加時の既存コードの変更が最小限で済む設計

## 7. ライセンス情報

### Min-DevKitライセンス

本プロジェクトでは**[Min-DevKit](https://github.com/Cycling74/min-devkit)**を使用しています。

Min-DevKitはMITライセンスの下で提供されています：

```
The MIT License

Copyright 2018, The Min-DevKit Authors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

本プロジェクトではC++ベースのアーキテクチャ実装と平行して、Min-DevKitフレームワークを活用した統合オーケストレーターやその他のコンポーネントを開発しています。
