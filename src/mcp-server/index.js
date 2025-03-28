/**
 * Max 9 MCP Server
 * Claude DesktopとMax 9を連携するためのMCPサーバー実装
 * 
 * 基本的なMCPサーバー機能を提供し、OSCを介してMax 9と通信します
 */

const fastmcp = require('fastmcp');
const osc = require('node-osc');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// 設定ファイルの読み込み
dotenv.config();

// 定数定義
const MAX_OSC_IP = process.env.MAX_OSC_IP || '127.0.0.1';
const MAX_OSC_SEND_PORT = parseInt(process.env.MAX_OSC_SEND_PORT || '7400');
const MAX_OSC_RECEIVE_PORT = parseInt(process.env.MAX_OSC_RECEIVE_PORT || '7500');
const ACCESS_LEVEL = process.env.MAX_ACCESS_LEVEL || 'full'; // full, restricted, readonly
const CONNECTION_TIMEOUT = parseInt(process.env.CONNECTION_TIMEOUT || '5000'); // 接続タイムアウト（ミリ秒）
const MAX_RETRY_COUNT = parseInt(process.env.MAX_RETRY_COUNT || '3'); // 最大再試行回数
const RETRY_INTERVAL = parseInt(process.env.RETRY_INTERVAL || '10000'); // 再試行間隔（ミリ秒）
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL || '30000'); // ハートビート間隔（ミリ秒）

// FastMCPサーバーの初期化
const mcp = new fastmcp.FastMCP({
  name: "Max 9 MCP Server",
  description: "Claude DesktopからMax 9を操作するためのMCPサーバー"
});

// OSCクライアント初期化（Max 9へのメッセージ送信用）
let oscClient = null;

// Max 9のセッション状態を管理
const maxSession = {
  isConnected: false,
  patches: {},
  objects: {},
  parameters: {},
  connectionStatus: {
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    reconnectAttempts: 0,
    lastHeartbeatAt: null,
    errors: []
  }
};

// OSCサーバー初期化（Max 9からのメッセージ受信用）
let oscServer = null;

/**
 * OSCサーバーを起動
 * @param {number} retryCount 再試行回数
 */
function startOscServer(retryCount = 0) {
  console.log(`OSCサーバー起動試行 ${retryCount + 1}/${MAX_RETRY_COUNT}`);
  
  // 再試行回数の上限を確認
  if (retryCount >= MAX_RETRY_COUNT) {
    console.error(`最大再試行回数(${MAX_RETRY_COUNT})に達しました。再試行を中止します。`);
    maxSession.connectionStatus.errors.push({
      type: 'connection_retry_exceeded',
      message: `最大再試行回数(${MAX_RETRY_COUNT})に達しました`,
      timestamp: Date.now()
    });
    return;
  }
  
  // 既存のサーバーがあれば閉じる
  if (oscServer) {
    try {
      oscServer.close();
    } catch(e) {
      console.error(`既存OSCサーバーの終了時エラー: ${e.message}`);
    }
  }

  // 接続タイムアウトを設定
  const connectionTimeoutId = setTimeout(() => {
    console.error(`OSCサーバー接続タイムアウト`);
    maxSession.connectionStatus.errors.push({
      type: 'connection_timeout',
      message: '接続タイムアウト',
      timestamp: Date.now()
    });
    
    // 再試行をスケジュール
    maxSession.connectionStatus.reconnectAttempts++;
    setTimeout(() => startOscServer(retryCount + 1), RETRY_INTERVAL);
  }, CONNECTION_TIMEOUT);

  try {
    // 新しいOSCサーバーを作成
    oscServer = new osc.Server(MAX_OSC_RECEIVE_PORT, MAX_OSC_IP);
    
    console.log(`OSC受信サーバーを開始: ${MAX_OSC_IP}:${MAX_OSC_RECEIVE_PORT}`);
    
    // メッセージハンドラの登録
    oscServer.on('message', function(msg, rinfo) {
      // 最初のメッセージを受信したらタイムアウトをクリア
      clearTimeout(connectionTimeoutId);
      
      const address = msg[0];
      const args = msg.slice(1);
    
      console.log(`Max 9からの応答: ${address}`, args);
    
    // 各種レスポンスの処理
    if (address === '/max/response/connected') {
      const wasConnected = maxSession.isConnected;
      maxSession.isConnected = args[0] === 1;
      
      if (maxSession.isConnected) {
        maxSession.connectionStatus.lastConnectedAt = Date.now();
        maxSession.connectionStatus.reconnectAttempts = 0;
        
        // ハートビートの開始
        startHeartbeat();
      } else if (wasConnected) {
        // 切断を検出
        maxSession.connectionStatus.lastDisconnectedAt = Date.now();
        // 再接続をスケジュール
        scheduleReconnect();
      }
      
      console.log(`Max 9接続状態: ${maxSession.isConnected ? '接続' : '切断'}`);
    }
    
    // ハートビート応答またはピング応答の処理
    else if (address === '/max/pong') {
      maxSession.connectionStatus.lastHeartbeatAt = Date.now();
      if (this.debugMode) {
        console.log(`ハートビート受信: ${args[0] || ''}`);
      }
    } 
    else if (address === '/max/response/patchCreated') {
      const patchId = args[0];
      const patchName = args[1];
      maxSession.patches[patchId] = { name: patchName, objects: {} };
      console.log(`新しいパッチが作成されました: ${patchName} (ID: ${patchId})`);
    }
    else if (address === '/max/response/objectCreated') {
      const patchId = args[0];
      const objectId = args[1];
      const objectType = args[2];
      const x = args[3];
      const y = args[4];
      
      if (maxSession.patches[patchId]) {
        maxSession.patches[patchId].objects[objectId] = {
          type: objectType,
          position: { x, y }
        };
        maxSession.objects[objectId] = {
          patchId: patchId,
          type: objectType,
          position: { x, y }
        };
        console.log(`新しいオブジェクトが作成されました: ${objectType} (ID: ${objectId})`);
      }
    }
    else if (address.startsWith('/max/params/')) {
      const paramName = address.split('/').pop();
      const paramValue = args[0];
      maxSession.parameters[paramName] = paramValue;
      console.log(`パラメータが更新されました: ${paramName} = ${paramValue}`);
    }
    else if (address.startsWith('/max/error/')) {
      const errorType = address.split('/').pop();
      const errorMsg = args[0];
      console.error(`Max 9エラー (${errorType}): ${errorMsg}`);
    }
    });
    
    return true;
  } catch (error) {
    console.error(`OSCサーバー初期化エラー: ${error.message}`);
    maxSession.connectionStatus.errors.push({
      type: 'server_init_error',
      message: error.message,
      timestamp: Date.now()
    });
    
    // 再試行を計画
    setTimeout(() => startOscServer(retryCount + 1), RETRY_INTERVAL);
    return false;
  }
}

// ===== MCPツール定義 =====

/**
 * Max 9にOSC接続
 */
mcp.defineTool({
  name: 'connect_to_max',
  description: 'Max 9にOSC接続します',
  parameters: [
    { name: 'host', type: 'string', description: 'Maxが実行されているホスト', default: '127.0.0.1' },
    { name: 'port', type: 'integer', description: 'Maxが待ち受けているOSCポート', default: 7400 }
  ],
  handler: async (ctx, params) => {
    try {
      // OSCクライアントを初期化
      oscClient = new osc.Client(params.host, params.port);
      
      // 接続テストメッセージを送信
      oscClient.send('/mcp/system/connection', 1);
      
      // セッション状態を更新
      maxSession.isConnected = true;
      
      ctx.info(`Max 9にOSC接続しました: ${params.host}:${params.port}`);
      return `Max 9にOSC接続しました: ${params.host}:${params.port}`;
    } catch (error) {
      const errorMsg = `Max 9へのOSC接続に失敗しました: ${error.message}`;
      ctx.error(errorMsg);
      return errorMsg;
    }
  }
});

/**
 * Max 9の状態情報を取得
 */
mcp.defineTool({
  name: 'get_max_status',
  description: 'Max 9の現在の状態情報を取得します',
  parameters: [],
  handler: async (ctx) => {
    if (!maxSession.isConnected || !oscClient) {
      ctx.warning('Max 9に接続されていません');
      return 'エラー: Max 9に接続されていません。先にconnect_to_maxを実行してください。';
    }
    
    try {
      // 状態情報リクエストを送信
      oscClient.send('/mcp/system/status', 1);
      
      // 現在のセッション状態を返す
      const status = {
        connected: maxSession.isConnected,
        patches_count: Object.keys(maxSession.patches).length,
        objects_count: Object.keys(maxSession.objects).length,
        parameters: maxSession.parameters
      };
      
      ctx.info('Max 9の状態情報を取得しました');
      return JSON.stringify(status, null, 2);
    } catch (error) {
      const errorMsg = `Max 9の状態情報取得に失敗しました: ${error.message}`;
      ctx.error(errorMsg);
      return errorMsg;
    }
  }
});

/**
 * 新しいMaxパッチを作成
 */
/**
 * 入力検証機能（共通ユーティリティ）
 * @param {string} value 検証する文字列
 * @param {string} fieldName フィールド名
 * @param {Object} options 検証オプション
 * @returns {string|null} エラーメッセージまたはnull
 */
function validateInput(value, fieldName, options = {}) {
  const {
    required = true,
    minLength = 0,
    maxLength = 1000,
    pattern = null,
    safeChars = true
  } = options;
  
  // 必須チェック
  if (required && (value === null || value === undefined || value === '')) {
    return `${fieldName}は必須です`;
  }
  
  // スキップ条件
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  // 文字列変換
  const strValue = String(value);
  
  // 長さチェック
  if (strValue.length < minLength) {
    return `${fieldName}は${minLength}文字以上である必要があります`;
  }
  
  if (strValue.length > maxLength) {
    return `${fieldName}は${maxLength}文字以下である必要があります`;
  }
  
  // パターンチェック
  if (pattern && !pattern.test(strValue)) {
    return `${fieldName}は無効な形式です`;
  }
  
  // 安全な文字のみを許可
  if (safeChars) {
    // インジェクション攻撃に使われる可能性のある危険な文字をチェック
    const dangerousChars = /[\\;|&$<>`"'\[\]{}()]/;
    if (dangerousChars.test(strValue)) {
      return `${fieldName}に無効な文字が含まれています`;
    }
  }
  
  return null;
}

/**
 * アクセスレベルの確認とエラーメッセージの生成
 * @param {string} requiredLevel 必要なアクセスレベル
 * @returns {string|null} エラーメッセージまたはnull
 */
function checkAccessLevel(requiredLevel) {
  const levels = {
    readonly: 0,
    restricted: 1,
    full: 2
  };
  
  const currentLevelValue = levels[ACCESS_LEVEL] || 0;
  const requiredLevelValue = levels[requiredLevel] || 0;
  
  if (currentLevelValue < requiredLevelValue) {
    return `エラー: 現在の設定(${ACCESS_LEVEL})ではこの操作は許可されていません。${requiredLevel}レベルが必要です。`;
  }
  
  return null;
}

mcp.defineTool({
  name: 'create_max_patch',
  description: '新しいMax 9パッチを作成します',
  parameters: [
    { name: 'name', type: 'string', description: '作成するパッチの名前' }
  ],
  handler: async (ctx, params) => {
    // 接続確認
    if (!maxSession.isConnected || !oscClient) {
      ctx.warning('Max 9に接続されていません');
      return 'エラー: Max 9に接続されていません。先にconnect_to_maxを実行してください。';
    }
    
    // 入力検証
    const nameError = validateInput(params.name, 'パッチ名', { 
      minLength: 1, 
      maxLength: 50,
      pattern: /^[\w\s\-\.]+$/
    });
    
    if (nameError) {
      ctx.warning(nameError);
      return `エラー: ${nameError}`;
    }
    
    try {
      // アクセスレベル確認
      const accessError = checkAccessLevel('restricted');
      if (accessError) {
        ctx.warning(accessError);
        return accessError;
      }
      
      // パッチ作成リクエストを送信
      const patchId = `patch_${Date.now()}`;
      oscClient.send('/mcp/patch/create', patchId, params.name);
      
      // 模擬的にセッション状態を更新（実際にはOSCレスポンスで更新される）
      maxSession.patches[patchId] = { name: params.name, objects: {} };
      
      ctx.info(`新しいパッチを作成しました: ${params.name}`);
      return `新しいパッチを作成しました: ${params.name} (ID: ${patchId})`;
    } catch (error) {
      const errorMsg = `パッチ作成に失敗しました: ${error.message}`;
      ctx.error(errorMsg);
      return errorMsg;
    }
  }
});

/**
 * 既存のパッチにオブジェクトを追加
 */
mcp.defineTool({
  name: 'add_object_to_patch',
  description: '既存のパッチにオブジェクトを追加します',
  parameters: [
    { name: 'patch_id', type: 'string', description: 'オブジェクトを追加するパッチのID' },
    { name: 'object_type', type: 'string', description: '追加するオブジェクトのタイプ' },
    { name: 'x', type: 'integer', description: 'オブジェクトのX座標', default: 100 },
    { name: 'y', type: 'integer', description: 'オブジェクトのY座標', default: 100 }
  ],
  handler: async (ctx, params) => {
    if (!maxSession.isConnected || !oscClient) {
      ctx.warning('Max 9に接続されていません');
      return 'エラー: Max 9に接続されていません。先にconnect_to_maxを実行してください。';
    }
    
    // パッチの存在確認
    if (!maxSession.patches[params.patch_id]) {
      return `エラー: パッチが見つかりません: ${params.patch_id}`;
    }
    
    try {
      // アクセスレベルチェック
      if (ACCESS_LEVEL === 'readonly') {
        return 'エラー: 現在の設定ではオブジェクトの追加は許可されていません (readonly)';
      }
      
      // オブジェクト追加リクエストを送信
      const objectId = `obj_${Date.now()}`;
      oscClient.send('/mcp/object/create', params.patch_id, objectId, params.object_type, params.x, params.y);
      
      // 模擬的にセッション状態を更新（実際にはOSCレスポンスで更新される）
      maxSession.patches[params.patch_id].objects[objectId] = {
        type: params.object_type,
        position: { x: params.x, y: params.y }
      };
      maxSession.objects[objectId] = {
        patchId: params.patch_id,
        type: params.object_type,
        position: { x: params.x, y: params.y }
      };
      
      ctx.info(`オブジェクトを追加しました: ${params.object_type}`);
      return `オブジェクトを追加しました: ${params.object_type} (ID: ${objectId})`;
    } catch (error) {
      const errorMsg = `オブジェクト追加に失敗しました: ${error.message}`;
      ctx.error(errorMsg);
      return errorMsg;
    }
  }
});

/**
 * オブジェクト間に接続を作成
 */
mcp.defineTool({
  name: 'connect_objects',
  description: '2つのオブジェクト間に接続を作成します',
  parameters: [
    { name: 'source_id', type: 'string', description: '接続元オブジェクトのID' },
    { name: 'destination_id', type: 'string', description: '接続先オブジェクトのID' },
    { name: 'outlet', type: 'integer', description: '接続元オブジェクトのアウトレット番号', default: 0 },
    { name: 'inlet', type: 'integer', description: '接続先オブジェクトのインレット番号', default: 0 }
  ],
  handler: async (ctx, params) => {
    if (!maxSession.isConnected || !oscClient) {
      ctx.warning('Max 9に接続されていません');
      return 'エラー: Max 9に接続されていません。先にconnect_to_maxを実行してください。';
    }
    
    // オブジェクトの存在確認
    if (!maxSession.objects[params.source_id]) {
      return `エラー: 接続元オブジェクトが見つかりません: ${params.source_id}`;
    }
    if (!maxSession.objects[params.destination_id]) {
      return `エラー: 接続先オブジェクトが見つかりません: ${params.destination_id}`;
    }
    
    try {
      // アクセスレベルチェック
      if (ACCESS_LEVEL === 'readonly') {
        return 'エラー: 現在の設定ではオブジェクトの接続は許可されていません (readonly)';
      }
      
      // 接続リクエストを送信
      oscClient.send('/mcp/object/connect', params.source_id, params.destination_id, params.outlet, params.inlet);
      
      ctx.info(`オブジェクト間の接続を作成しました: ${params.source_id}[${params.outlet}] -> ${params.destination_id}[${params.inlet}]`);
      return `オブジェクト間の接続を作成しました: ${params.source_id}[${params.outlet}] -> ${params.destination_id}[${params.inlet}]`;
    } catch (error) {
      const errorMsg = `オブジェクト接続に失敗しました: ${error.message}`;
      ctx.error(errorMsg);
      return errorMsg;
    }
  }
});

/**
 * オブジェクトのパラメータを設定
 */
mcp.defineTool({
  name: 'set_object_parameter',
  description: 'オブジェクトのパラメータを設定します',
  parameters: [
    { name: 'object_id', type: 'string', description: 'パラメータを設定するオブジェクトのID' },
    { name: 'param_name', type: 'string', description: 'パラメータ名' },
    { name: 'param_value', type: 'any', description: 'パラメータ値' }
  ],
  handler: async (ctx, params) => {
    if (!maxSession.isConnected || !oscClient) {
      ctx.warning('Max 9に接続されていません');
      return 'エラー: Max 9に接続されていません。先にconnect_to_maxを実行してください。';
    }
    
    // オブジェクトの存在確認
    if (!maxSession.objects[params.object_id]) {
      return `エラー: オブジェクトが見つかりません: ${params.object_id}`;
    }
    
    try {
      // アクセスレベルチェック
      if (ACCESS_LEVEL === 'readonly') {
        return 'エラー: 現在の設定ではパラメータの変更は許可されていません (readonly)';
      }
      
      // パラメータ設定リクエストを送信
      oscClient.send('/mcp/object/param', params.object_id, params.param_name, params.param_value);
      
      ctx.info(`オブジェクトのパラメータを設定しました: ${params.object_id}.${params.param_name} = ${params.param_value}`);
      return `オブジェクトのパラメータを設定しました: ${params.object_id}.${params.param_name} = ${params.param_value}`;
    } catch (error) {
      const errorMsg = `パラメータ設定に失敗しました: ${error.message}`;
      ctx.error(errorMsg);
      return errorMsg;
    }
  }
});

/**
 * パッチをファイルに保存
 */
mcp.defineTool({
  name: 'save_patch',
  description: 'パッチをファイルに保存します',
  parameters: [
    { name: 'patch_id', type: 'string', description: '保存するパッチのID' },
    { name: 'file_path', type: 'string', description: '保存先のファイルパス（省略時は自動生成）', optional: true }
  ],
  handler: async (ctx, params) => {
    if (!maxSession.isConnected || !oscClient) {
      ctx.warning('Max 9に接続されていません');
      return 'エラー: Max 9に接続されていません。先にconnect_to_maxを実行してください。';
    }
    
    // パッチの存在確認
    if (!maxSession.patches[params.patch_id]) {
      return `エラー: パッチが見つかりません: ${params.patch_id}`;
    }
    
    try {
      // アクセスレベルチェック
      if (ACCESS_LEVEL === 'readonly') {
        return 'エラー: 現在の設定ではパッチの保存は許可されていません (readonly)';
      }
      
      // パッチ名を取得
      const patchName = maxSession.patches[params.patch_id].name;
      
      // 保存先パスの決定
      let filePath = params.file_path;
      if (!filePath) {
        // パス省略時は自動生成（実際の実装ではユーザーのドキュメントフォルダなどを使用）
        filePath = `./${patchName.replace(/\s+/g, '_')}.maxpat`;
      }
      
      // 保存リクエストを送信
      oscClient.send('/mcp/patch/save', params.patch_id, filePath);
      
      ctx.info(`パッチを保存しました: ${patchName} -> ${filePath}`);
      return `パッチを保存しました: ${patchName} -> ${filePath}`;
    } catch (error) {
      const errorMsg = `パッチ保存に失敗しました: ${error.message}`;
      ctx.error(errorMsg);
      return errorMsg;
    }
  }
});

/**
 * シンプルなシンセサイザーパッチを自動生成
 */
mcp.defineTool({
  name: 'generate_simple_synth',
  description: 'シンプルなシンセサイザーパッチを自動生成します',
  parameters: [
    { name: 'patch_name', type: 'string', description: '作成するパッチの名前', default: 'MCPSynth' }
  ],
  handler: async (ctx, params) => {
    if (!maxSession.isConnected || !oscClient) {
      ctx.warning('Max 9に接続されていません');
      return 'エラー: Max 9に接続されていません。先にconnect_to_maxを実行してください。';
    }
    
    try {
      // アクセスレベルチェック
      if (ACCESS_LEVEL === 'readonly') {
        return 'エラー: 現在の設定ではパッチの生成は許可されていません (readonly)';
      }
      
      ctx.info(`シンプルなシンセサイザーパッチを生成中: ${params.patch_name}`);
      
      // パッチ作成
      const patchId = `patch_${Date.now()}`;
      oscClient.send('/mcp/patch/create', patchId, params.patch_name);
      
      // 模擬的にセッション状態を更新
      maxSession.patches[patchId] = { name: params.patch_name, objects: {} };
      
      // オブジェクト配置とセッション状態の更新を行う関数
      const addObject = (type, x, y) => {
        const objId = `obj_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        oscClient.send('/mcp/object/create', patchId, objId, type, x, y);
        
        maxSession.patches[patchId].objects[objId] = {
          type,
          position: { x, y }
        };
        maxSession.objects[objId] = {
          patchId,
          type,
          position: { x, y }
        };
        
        return objId;
      };
      
      // 少し遅延を入れてオブジェクトを追加（実際の実装では非同期処理を適切に扱う）
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 基本的なシンセパッチのオブジェクトを配置
      const oscId = addObject('cycle~', 100, 100);
      const gainId = addObject('gain~', 250, 100);
      const dacId = addObject('ezdac~', 400, 100);
      const freqId = addObject('flonum', 100, 50);
      const multiplyId = addObject('*~', 175, 100);
      
      // 少し遅延を入れてオブジェクトを接続
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // オブジェクト間を接続
      oscClient.send('/mcp/object/connect', oscId, multiplyId, 0, 0);
      oscClient.send('/mcp/object/connect', multiplyId, gainId, 0, 0);
      oscClient.send('/mcp/object/connect', gainId, dacId, 0, 0);
      oscClient.send('/mcp/object/connect', gainId, dacId, 0, 1);
      oscClient.send('/mcp/object/connect', freqId, oscId, 0, 0);
      
      // 初期パラメータを設定
      oscClient.send('/mcp/object/param', freqId, 'value', 440);
      oscClient.send('/mcp/object/param', gainId, 'value', 0.5);
      
      return `シンプルなシンセサイザーパッチを生成しました: ${params.patch_name} (ID: ${patchId})`;
    } catch (error) {
      const errorMsg = `シンセサイザーパッチの生成に失敗しました: ${error.message}`;
      ctx.error(errorMsg);
      return errorMsg;
    }
  }
});

// ===== MCPリソース定義 =====

/**
 * Max 9のドキュメンテーション情報を提供するリソース
 */
mcp.defineResource({
  name: 'max_documentation',
  description: 'Max 9のドキュメンテーション情報',
  handler: async (ctx) => {
    // Max 9の主要なオブジェクトとそのドキュメントを返す
    return {
      objects: [
        {
          name: 'cycle~',
          description: 'サイン波オシレーター',
          category: 'MSP',
          inlets: [
            { index: 0, type: 'signal/float', description: '周波数(Hz)' }
          ],
          outlets: [
            { index: 0, type: 'signal', description: 'オーディオ出力' }
          ]
        },
        {
          name: 'gain~',
          description: 'オーディオ信号のゲイン調整',
          category: 'MSP',
          inlets: [
            { index: 0, type: 'signal', description: 'オーディオ入力' }
          ],
          outlets: [
            { index: 0, type: 'signal', description: 'オーディオ出力' }
          ]
        },
        {
          name: 'ezdac~',
          description: 'オーディオ出力（スピーカー）',
          category: 'MSP',
          inlets: [
            { index: 0, type: 'signal', description: '左チャンネル入力' },
            { index: 1, type: 'signal', description: '右チャンネル入力' }
          ],
          outlets: []
        },
        // 他のオブジェクトも同様に追加
      ]
    };
  }
});

/**
 * 特定のパッチの詳細情報を提供するリソース
 */
mcp.defineResource({
  name: 'patch_info',
  description: 'パッチの詳細情報',
  parameters: [
    { name: 'patch_id', type: 'string', description: '情報を取得するパッチのID' }
  ],
  handler: async (ctx, params) => {
    if (!maxSession.patches[params.patch_id]) {
      throw new Error(`パッチが見つかりません: ${params.patch_id}`);
    }
    
    return maxSession.patches[params.patch_id];
  }
});

// ===== メイン実行 =====

/**
 * 試験モードを有効にする
 * @param {boolean} enabled 有効/無効
 */
function enableTestMode(enabled = true) {
  global.testMode = enabled;
  console.log(`試験モード: ${enabled ? '有効' : '無効'}`);
  
  if (enabled) {
    // 試験用のタイマーを開始
    global.testTimer = setInterval(() => {
      // 接続テスト
      if (maxSession.isConnected && oscClient) {
        console.log('試験モード: Max接続テスト中...');
        try {
          oscClient.send('/mcp/ping', Date.now());
        } catch (e) {
          console.error(`試験モードエラー: ${e.message}`);
        }
      }
    }, 60000); // 1分間隔
  } else if (global.testTimer) {
    clearInterval(global.testTimer);
  }
}

/**
 * 現在のシステム状態情報を返す
 * @returns {Object} 状態情報
 */
function getSystemStatus() {
  return {
    server: {
      startTime: global.serverStartTime,
      uptime: Date.now() - global.serverStartTime,
      accessLevel: ACCESS_LEVEL,
      testMode: global.testMode || false
    },
    connection: {
      isConnected: maxSession.isConnected,
      lastConnectedAt: maxSession.connectionStatus.lastConnectedAt,
      reconnectAttempts: maxSession.connectionStatus.reconnectAttempts,
      errorCount: maxSession.connectionStatus.errors.length
    },
    resources: {
      patchCount: Object.keys(maxSession.patches || {}).length,
      objectCount: Object.keys(maxSession.objects || {}).length,
      memoryUsage: process.memoryUsage()
    }
  };
}

/**
 * アプリケーションの初期化と起動
 */
async function main() {
  console.log('Max 9 MCPサーバーを起動しています...');
  
  // サーバー起動時間を記録
  global.serverStartTime = Date.now();
  
  // OSCサーバーを起動
  startOscServer();
  
  // 必要に応じて試験モードを有効にする
  if (process.env.TEST_MODE === 'true') {
    enableTestMode(true);
  }
  
  // MCPサーバーを起動
  await mcp.start();
  
  console.log(`Max 9 MCPサーバーが起動しました (ポート: ${mcp.port})`);
  console.log(`OSC設定: ${MAX_OSC_IP}:${MAX_OSC_SEND_PORT} (送信), ${MAX_OSC_RECEIVE_PORT} (受信)`);
  console.log(`アクセスレベル: ${ACCESS_LEVEL}`);
  
  // システムステータスを表示
  console.log('\nシステムステータス:', JSON.stringify(getSystemStatus(), null, 2));
}

/**
 * ハートビートを開始
 */
function startHeartbeat() {
  // 既存のハートビートタイマーをクリア
  if (global.heartbeatTimer) {
    clearInterval(global.heartbeatTimer);
  }
  
  // 新しいハートビートタイマーを設定
  global.heartbeatTimer = setInterval(() => {
    if (maxSession.isConnected && oscClient) {
      try {
        // ハートビートメッセージを送信
        oscClient.send('/mcp/ping', Date.now());
        
        // 最後のハートビートもチェック
        const now = Date.now();
        const lastHeartbeatAt = maxSession.connectionStatus.lastHeartbeatAt;
        
        // 長時間ハートビートがない場合は切断と判断
        if (lastHeartbeatAt && (now - lastHeartbeatAt > HEARTBEAT_INTERVAL * 2)) {
          console.error(`ハートビートが長時間受信されていません。接続が切断された可能性があります。`);
          maxSession.isConnected = false;
          maxSession.connectionStatus.lastDisconnectedAt = now;
          scheduleReconnect();
        }
      } catch (error) {
        console.error(`ハートビート送信エラー: ${error.message}`);
        maxSession.connectionStatus.errors.push({
          type: 'heartbeat_error',
          message: error.message,
          timestamp: Date.now()
        });
      }
    }
  }, HEARTBEAT_INTERVAL);
  
  console.log(`ハートビートモニタリングを開始 (${HEARTBEAT_INTERVAL}ms間隔)`);
}

/**
 * 再接続をスケジュール
 */
function scheduleReconnect() {
  // 再接続試行回数をインクリメント
  maxSession.connectionStatus.reconnectAttempts++;
  
  // 指数関数的なバックオフ
  const delay = Math.min(
    RETRY_INTERVAL * Math.pow(1.5, maxSession.connectionStatus.reconnectAttempts - 1),
    300000 // 最大5分
  );
  
  console.log(`${delay / 1000}秒後に再接続を試行します...`);
  
  // タイマーをセット
  setTimeout(() => {
    // 再接続試行
    console.log('再接続を試行します...');
    
    try {
      // OSCクライアントを再接続
      if (oscClient) {
        oscClient.close();
      }
      
      oscClient = new osc.Client(MAX_OSC_IP, MAX_OSC_SEND_PORT);
      oscClient.send('/mcp/system/connection', 1);
      
      // OSCサーバーも再起動
      startOscServer(maxSession.connectionStatus.reconnectAttempts);
      
      console.log('再接続リクエストを送信しました');
    } catch (error) {
      console.error(`再接続試行エラー: ${error.message}`);
      maxSession.connectionStatus.errors.push({
        type: 'reconnect_error',
        message: error.message,
        timestamp: Date.now()
      });
      
      // 失敗した場合は後で再試行
      scheduleReconnect();
    }
  }, delay);
}

// アプリケーションを起動
main().catch(error => {
  console.error('サーバー起動エラー:', error);
  process.exit(1);
});
