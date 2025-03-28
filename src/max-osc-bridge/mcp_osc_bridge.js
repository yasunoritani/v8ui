/**
 * Max 9 v8ui OSC Bridge
 * Claude DesktopのMCPサーバーとMax 9を接続するブリッジ実装
 * 
 * このスクリプトはMax 9内のv8ui環境で実行され、OSCを介してMCPサーバーと通信します
 */

// MCPブリッジコントローラークラス
class MCPBridge {
    constructor() {
        // 設定
        this.mcpServerIP = "127.0.0.1";
        this.mcpReceivePort = 7500;  // MCP側が受信するポート（Max側が送信するポート）
        this.mcpSendPort = 7400;    // MCP側が送信するポート（Max側が受信するポート）
        this.debugMode = true;
        this.connectionTimeout = 5000; // 接続タイムアウト時間（ミリ秒）
        this.reconnectInterval = 10000; // 再接続試行間隔（ミリ秒）

        // 状態管理
        this.isConnected = false;
        this.oscReceiver = null;
        this.oscSender = null;
        this.activePatchIds = {};
        this.activeObjects = {};
        this.lastError = null;
        this.reconnectAttempts = 0;
        this.lastPingTime = 0;
        
        // パッチャー参照（post出力用）
        this.patcher = max.patcher;
    }
    
    // 初期化関数 - Max 9起動時に呼び出される
    initialize() {
        try {
            // 設定の読み込み
            this.loadSettings();
            
            // OSC通信の初期化
            this.initOSC();
            
            // デバッグログ
            this.log("Max 9 v8ui OSCブリッジを初期化しました");
            this.log("MCPサーバーへの送信先: " + this.mcpServerIP + ":" + this.mcpReceivePort);
            this.log("MCPサーバーからの受信ポート: " + this.mcpSendPort);
            
            // MCPサーバーに接続通知を送信
            this.sendOSCMessage("/max/response/connected", 1);
            
            // 定期的な接続チェックを設定
            this.setupConnectionMonitoring();
            
            return "MCPブリッジ初期化完了";
        } catch (e) {
            this.error("初期化中に予期せぬエラーが発生しました: " + e.message);
            this.lastError = {
                type: "init_error",
                message: e.message,
                timestamp: Date.now()
            };
            
            // 初期化エラーからの回復を試みる
            this.scheduleReconnect();
            
            return "MCPブリッジ初期化に失敗しました: " + e.message;
        }
    }
    
    // 接続モニタリングの設定
    setupConnectionMonitoring() {
        // Max環境では遅延実行用にタスクを使用
        if (typeof max !== 'undefined' && max.schedule) {
            max.schedule(30000, () => this.checkConnection());
        }
    }
    
    // 接続状態をチェック
    checkConnection() {
        if (!this.isConnected) {
            this.log("接続が失われています。再接続を試みます...");
            this.reconnect();
            return;
        }
        
        // 前回のping送信から一定時間以上経過していれば新しいpingを送信
        const now = Date.now();
        if (now - this.lastPingTime > 25000) {
            this.lastPingTime = now;
            this.sendOSCMessage("/max/ping", now);
        }
        
        // 次のチェックをスケジュール
        if (typeof max !== 'undefined' && max.schedule) {
            max.schedule(30000, () => this.checkConnection());
        }
    }
    
    // 再接続を試行
    reconnect() {
        this.reconnectAttempts++;
        this.log(`再接続を試行します (${this.reconnectAttempts}回目)`);
        
        try {
            // OSC通信を再初期化
            this.initOSC();
            
            // 接続通知を送信
            this.sendOSCMessage("/max/response/connected", 1);
            
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.log("再接続に成功しました");
        } catch (e) {
            this.error("再接続に失敗しました: " + e.message);
            this.scheduleReconnect();
        }
    }
    
    // 再接続をスケジュール
    scheduleReconnect() {
        const delay = Math.min(this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts), 300000); // 最大5分
        
        if (typeof max !== 'undefined' && max.schedule) {
            this.log(`${delay / 1000}秒後に再接続を試みます`);
            max.schedule(delay, () => this.reconnect());
        }
    }

    // 設定ファイルの読み込み
    loadSettings() {
        try {
            // ここでMax環境から設定値を読み込む
            // 実際の実装では、max.getattr()などを使ってパッチから値を取得する
            if (typeof max !== 'undefined' && max.getenv) {
                this.mcpServerIP = max.getenv("MCP_OSC_IP") || this.mcpServerIP;
                this.mcpReceivePort = parseInt(max.getenv("MCP_RECEIVE_PORT")) || this.mcpReceivePort;
                this.mcpSendPort = parseInt(max.getenv("MCP_SEND_PORT")) || this.mcpSendPort;
                this.debugMode = (max.getenv("DEBUG_MODE") === "true") || this.debugMode;
            }
        } catch (e) {
            this.error("設定読み込みエラー: " + e.message);
        }
    }
    
    // OSC通信の初期化
    initOSC() {
        try {
            // Max APIを使用して正しいOSCオブジェクトを作成
            
            // パッチャーが存在するか確認
            if (!this.patcher) {
                this.patcher = max.patcher;
                if (!this.patcher) {
                    this.error("パッチャーにアクセスできません");
                    return false;
                }
            }
            
            // 既存のオブジェクトがあれば削除（リソース解放）
            if (this.oscReceiver) {
                this.patcher.remove(this.oscReceiver);
                this.oscReceiver = null;
            }
            if (this.oscSender) {
                this.patcher.remove(this.oscSender);
                this.oscSender = null;
            }
            
            // 新しいOSCオブジェクトを作成
            this.oscReceiver = this.patcher.newdefault(100, 100, "udpreceive", this.mcpSendPort);
            this.oscSender = this.patcher.newdefault(100, 150, "udpsend", this.mcpServerIP, this.mcpReceivePort);
            
            if (!this.oscReceiver || !this.oscSender) {
                this.error("OSCオブジェクトの作成に失敗しました");
                return false;
            }
            
            // 接続確立
            this.oscSender.message("connect");
            
            this.isConnected = true;
            this.log("OSC通信を初期化しました");
            return true;
        } catch (e) {
            this.error("OSC通信の初期化に失敗しました: " + e.message);
            this.lastError = {
                type: "osc_init_error",
                message: e.message,
                timestamp: Date.now()
            };
            return false;
        }
    }
    
    // OSCメッセージを送信
    sendOSCMessage(address, ...args) {
        if (!this.oscSender || !this.isConnected) {
            this.error("OSC送信できません: 接続されていません");
            this.lastError = {
                type: "osc_send_error",
                message: "OSC送信できません: 接続されていません",
                timestamp: Date.now()
            };
            
            // 接続が失われている場合は再接続を試みる
            this.scheduleReconnect();
            return false;
        }
        
        try {
            // 引数の検証
            const validArgs = args.map(arg => {
                // 数値、文字列、Boolean型のみ許可
                if (typeof arg === 'number' || typeof arg === 'string' || typeof arg === 'boolean') {
                    return arg;
                } else if (arg === null || arg === undefined) {
                    return '';
                } else {
                    // オブジェクトや配列は文字列に変換
                    return String(arg);
                }
            });
            
            // v8ui環境でのOSC送信方法
            let messageArray = [address].concat(validArgs);
            this.oscSender.message("send", messageArray);
            
            if (this.debugMode) {
                this.log("送信 OSC: " + address + " " + validArgs.join(" "));
            }
            return true;
        } catch (e) {
            this.error("OSCメッセージ送信エラー: " + e.message);
            this.lastError = {
                type: "osc_send_error",
                message: e.message,
                timestamp: Date.now()
            };
            return false;
        }
    }
    
    // OSCメッセージ受信ハンドラ
    oscMessageHandler(address, ...args) {
        try {
            // 最後の受信時刻を記録（接続監視用）
            this.lastReceiveTime = Date.now();
            
            if (this.debugMode) {
                this.log("受信 OSC: " + address + " " + args.join(" "));
            }
            
            // pingに対する応答
            if (address === "/mcp/ping") {
                this.sendOSCMessage("/max/pong", args[0] || Date.now());
                return;
            }
            
            // 接続状況の更新
            if (!this.isConnected && address !== "/mcp/system/connection") {
                this.log("接続が再確立されました");
                this.isConnected = true;
                this.reconnectAttempts = 0;
            }
            
            // MCPからのメッセージを処理
            switch (address) {
                case "/mcp/system/connection":
                    this.handleConnectionMessage(args);
                    break;
                case "/mcp/system/status":
                    this.handleStatusRequest();
                    break;
                case "/mcp/patch/create":
                    this.handleCreatePatch(args);
                    break;
                case "/mcp/object/create":
                    this.handleCreateObject(args);
                    break;
                case "/mcp/object/connect":
                    this.handleConnectObjects(args);
                    break;
                case "/mcp/object/param":
                    this.handleSetParameter(args);
                    break;
                case "/mcp/patch/save":
                    this.handleSavePatch(args);
                    break;
                default:
                    this.log("未処理のOSCメッセージ: " + address);
                    break;
            }
        } catch (e) {
            this.error("OSCメッセージ処理エラー: " + e.message);
            this.lastError = {
                type: "osc_handle_error",
                message: e.message,
                address: address,
                args: args,
                timestamp: Date.now()
            };
        }
    }
    
    // 接続メッセージの処理
    handleConnectionMessage(args) {
        const connectionStatus = args[0];
        this.log("MCPサーバーからの接続要求: " + connectionStatus);
        
        // 接続成功の応答を返す
        this.sendOSCMessage("/max/response/connected", 1);
    }
    
    // 状態リクエストの処理
    handleStatusRequest() {
        this.log("MCPサーバーからの状態リクエスト");
        
        // 現在のパッチとオブジェクトの数を送信
        const patchCount = Object.keys(this.activePatchIds).length;
        const objectCount = Object.keys(this.activeObjects).length;
        
        this.sendOSCMessage("/max/response/status", patchCount, objectCount);
        
        // 各パッチの情報を送信
        for (var patchId in this.activePatchIds) {
            this.sendOSCMessage("/max/response/patch", patchId, this.activePatchIds[patchId].name);
        }
    }
    
    // 新規パッチ作成の処理
    handleCreatePatch(args) {
        if (!args || args.length < 1) {
            this.error("パッチ作成に必要な引数が不足しています");
            this.sendOSCMessage("/max/error/patchCreate", "パッチIDが指定されていません");
            return;
        }
        
        const patchId = String(args[0]);
        const patchName = args[1] ? String(args[1]) : "Untitled";
        
        this.log("新規パッチ作成リクエスト: " + patchName + " (ID: " + patchId + ")");
        
        // 既存のパッチIDをチェック
        if (this.activePatchIds[patchId]) {
            this.log("既存のパッチIDです: " + patchId + "\u3002パッチの再利用を行います。");
            this.sendOSCMessage("/max/response/patchCreated", patchId, patchName);
            return;
        }
        
        try {
            // 新規パッチを作成
            var newPatcher = new max.Patcher();
            
            if (!newPatcher) {
                throw new Error("パッチャーオブジェクトの作成に失敗しました");
            }
            
            // パッチ情報を記録
            this.activePatchIds[patchId] = {
                name: patchName,
                maxPatch: newPatcher,
                objects: {},
                connections: [],
                createdAt: Date.now()
            };
            
            // 成功応答を送信
            this.sendOSCMessage("/max/response/patchCreated", patchId, patchName);
            
            // パッチ数の記録（パフォーマンスチェック用）
            this.patchCount = Object.keys(this.activePatchIds).length;
            if (this.patchCount > 10) {
                this.log("警告: パッチ数が多い場合はメモリ使用量に注意してください (現在: " + this.patchCount + ")");
            }
            
        } catch (e) {
            this.error("パッチ作成エラー: " + e.message);
            this.lastError = {
                type: "patch_create_error",
                message: e.message,
                patchId: patchId,
                patchName: patchName,
                timestamp: Date.now()
            };
            this.sendOSCMessage("/max/error/patchCreate", "パッチ作成に失敗しました: " + e.message);
        }
    }
    
    // オブジェクト作成の処理
    handleCreateObject(args) {
        if (!args || args.length < 3) {
            this.error("オブジェクト作成に必要な引数が不足しています");
            this.sendOSCMessage("/max/error/objectCreate", "パッチID、オブジェクトID、オブジェクトタイプが必要です");
            return;
        }
        
        const patchId = String(args[0]);
        const objectId = String(args[1]);
        const objectType = String(args[2]);
        const x = args[3] ? parseInt(args[3]) : 100;
        const y = args[4] ? parseInt(args[4]) : 100;
        
        // 入力妥当性のチェック
        if (!objectType || objectType.trim() === "") {
            this.error("無効なオブジェクトタイプです");
            this.sendOSCMessage("/max/error/objectCreate", "無効なオブジェクトタイプです");
            return;
        }
        
        this.log("オブジェクト作成リクエスト: " + objectType + " (ID: " + objectId + ")");
        
        // パッチが存在するかチェック
        if (!this.activePatchIds[patchId]) {
            this.error("パッチが見つかりません: " + patchId);
            this.sendOSCMessage("/max/error/objectCreate", "パッチが見つかりません: " + patchId);
            return;
        }
        
        // 既存のオブジェクトIDをチェック
        if (this.activeObjects[objectId]) {
            this.log("警告: 既存のオブジェクトIDです: " + objectId + "\u3002古いオブジェクトを削除します");
            
            try {
                // 古いオブジェクトを削除してメモリリークを防止
                const oldPatchId = this.activeObjects[objectId].patchId;
                if (this.activePatchIds[oldPatchId] && this.activePatchIds[oldPatchId].maxPatch) {
                    this.activePatchIds[oldPatchId].maxPatch.remove(this.activeObjects[objectId].object);
                }
                delete this.activePatchIds[oldPatchId].objects[objectId];
                delete this.activeObjects[objectId];
            } catch (cleanupErr) {
                this.log("古いオブジェクトの削除中にエラーが発生しました: " + cleanupErr.message);
            }
        }
        
        try {
            var patch = this.activePatchIds[patchId].maxPatch;
            
            if (!patch) {
                throw new Error("パッチャー参照が無効です");
            }
            
            // オブジェクトを作成
            var newObj = patch.newdefault(x, y, objectType);
            
            if (!newObj) {
                throw new Error("オブジェクトの作成に失敗しました: " + objectType);
            }
            
            // オブジェクト情報を記録
            this.activePatchIds[patchId].objects[objectId] = newObj;
            this.activeObjects[objectId] = {
                patchId: patchId,
                type: objectType,
                object: newObj,
                position: { x, y },
                createdAt: Date.now()
            };
            
            // オブジェクト数のチェック（パフォーマンス監視）
            const objectCount = Object.keys(this.activeObjects).length;
            if (objectCount > 100) {
                this.log("警告: オブジェクト数が多い場合はメモリ使用量とパフォーマンスに注意してください (現在: " + objectCount + ")");
                
                // 古いオブジェクトの清掃を検討するかどうかをログに記録
                if (objectCount > 200) {
                    this.log("パフォーマンス向上のために使用されていないオブジェクトの清掃が推奨されます");
                }
            }
            
            // 成功応答を送信
            this.sendOSCMessage("/max/response/objectCreated", patchId, objectId, objectType, x, y);
        } catch (e) {
            this.error("オブジェクト作成エラー: " + e.message);
            this.lastError = {
                type: "object_create_error",
                message: e.message,
                patchId: patchId,
                objectId: objectId,
                objectType: objectType,
                timestamp: Date.now()
            };
            this.sendOSCMessage("/max/error/objectCreate", "オブジェクト作成に失敗しました: " + e.message);
        }
    }
    
    // オブジェクト接続の処理
    handleConnectObjects(args) {
        if (!args || args.length < 3) {
            this.error("オブジェクト接続に必要な引数が不足しています");
            this.sendOSCMessage("/max/error/objectConnect", "ソースID、ターゲットIDが必要です");
            return;
        }
        
        const sourceId = String(args[0]);
        const sourceOutlet = args[1] !== undefined ? parseInt(args[1]) : 0;
        const targetId = String(args[2]);
        const targetInlet = args[3] !== undefined ? parseInt(args[3]) : 0;
        
        // 入力妥当性のチェック
        if (sourceOutlet < 0 || targetInlet < 0) {
            this.error("アウトレット/インレット番号は負数にできません");
            this.sendOSCMessage("/max/error/objectConnect", "アウトレット/インレット番号は負数にできません");
            return;
        }
        
        this.log("オブジェクト接続リクエスト: " + sourceId + "[" + sourceOutlet + "] -> " + targetId + "[" + targetInlet + "]");
        
        // オブジェクトの存在確認
        if (!this.activeObjects[sourceId]) {
            this.error("ソースオブジェクトが見つかりません: " + sourceId);
            this.sendOSCMessage("/max/error/objectConnect", "ソースオブジェクトが見つかりません: " + sourceId);
            return;
        }
        
        if (!this.activeObjects[targetId]) {
            this.error("ターゲットオブジェクトが見つかりません: " + targetId);
            this.sendOSCMessage("/max/error/objectConnect", "ターゲットオブジェクトが見つかりません: " + targetId);
            return;
        }
        
        try {
            const sourcePatchId = this.activeObjects[sourceId].patchId;
            const targetPatchId = this.activeObjects[targetId].patchId;
            
            // 同一パッチ内での接続か確認
            if (sourcePatchId !== targetPatchId) {
                this.error("異なるパッチ間の接続はサポートされていません");
                this.sendOSCMessage("/max/error/objectConnect", "異なるパッチ間の接続はサポートされていません");
                return;
            }
            
            const patch = this.activePatchIds[sourcePatchId].maxPatch;
            if (!patch) {
                throw new Error("パッチャー参照が無効です");
            }
            
            // オブジェクト参照が有効か確認
            const sourceObj = this.activeObjects[sourceId].object;
            const targetObj = this.activeObjects[targetId].object;
            
            if (!sourceObj || !targetObj) {
                throw new Error("オブジェクト参照が無効です");
            }
            
            // 重複接続の確認
            const connections = this.activePatchIds[sourcePatchId].connections || [];
            const connectionExists = connections.some(conn => 
                conn.sourceId === sourceId && 
                conn.sourceOutlet === sourceOutlet && 
                conn.targetId === targetId && 
                conn.targetInlet === targetInlet
            );
            
            if (connectionExists) {
                this.log("警告: 既に接続が存在します。重複接続を回避します");
                this.sendOSCMessage("/max/response/objectConnected", sourceId, sourceOutlet, targetId, targetInlet);
                return;
            }
            
            // オブジェクトを接続
            patch.connect(sourceObj, sourceOutlet, targetObj, targetInlet);
            
            // 接続情報を記録
            if (!this.activePatchIds[sourcePatchId].connections) {
                this.activePatchIds[sourcePatchId].connections = [];
            }
            
            this.activePatchIds[sourcePatchId].connections.push({
                sourceId,
                sourceOutlet,
                targetId,
                targetInlet,
                timestamp: Date.now()
            });
            
            // 成功応答を送信
            this.sendOSCMessage("/max/response/objectConnected", sourceId, sourceOutlet, targetId, targetInlet);
        } catch (e) {
            this.error("オブジェクト接続エラー: " + e.message);
            this.lastError = {
                type: "object_connect_error",
                message: e.message,
                sourceId,
                targetId,
                timestamp: Date.now()
            };
            this.sendOSCMessage("/max/error/objectConnect", "オブジェクト接続に失敗しました: " + e.message);
        }
    }
    
    // パラメータ設定の処理
    handleSetParameter(args) {
        if (!args || args.length < 3) {
            this.error("パラメータ設定に必要な引数が不足しています");
            this.sendOSCMessage("/max/error/paramSet", "オブジェクトID、パラメータ名、パラメータ値が必要です");
            return;
        }
        
        const objectId = String(args[0]);
        const paramName = String(args[1]);
        const paramValue = args[2]; // 型変換しない（様々な型を使用するため）
        
        // 入力妥当性のチェック
        if (!paramName || paramName.trim() === "") {
            this.error("無効なパラメータ名です");
            this.sendOSCMessage("/max/error/paramSet", "無効なパラメータ名です");
            return;
        }
        
        this.log("パラメータ設定リクエスト: " + objectId + "." + paramName + " = " + paramValue);
        
        // オブジェクトの存在確認
        if (!this.activeObjects[objectId]) {
            this.error("オブジェクトが見つかりません: " + objectId);
            this.sendOSCMessage("/max/error/paramSet", "オブジェクトが見つかりません: " + objectId);
            return;
        }
        
        try {
            const obj = this.activeObjects[objectId].object;
            
            if (!obj) {
                throw new Error("オブジェクト参照が無効です");
            }
            
            // パラメータを設定
            obj.setattr(paramName, paramValue);
            
            // このオブジェクトのパラメータ履歴を記録
            if (!this.activeObjects[objectId].parameters) {
                this.activeObjects[objectId].parameters = {};
            }
            
            this.activeObjects[objectId].parameters[paramName] = {
                value: paramValue,
                updatedAt: Date.now()
            };
            
            // 成功応答を送信
            this.sendOSCMessage("/max/response/paramSet", objectId, paramName, paramValue);
            
            // パラメータ変更通知を送信
            this.sendOSCMessage("/max/params/" + paramName, paramValue);
            
            // パッチIDとオブジェクトタイプを含む拡張通知を送信
            const patchId = this.activeObjects[objectId].patchId;
            const objectType = this.activeObjects[objectId].type;
            this.sendOSCMessage("/max/params/extended", patchId, objectId, objectType, paramName, paramValue);
            
        } catch (e) {
            this.error("パラメータ設定エラー: " + e.message);
            this.lastError = {
                type: "param_set_error",
                message: e.message,
                objectId: objectId,
                paramName: paramName,
                paramValue: paramValue,
                timestamp: Date.now()
            };
            this.sendOSCMessage("/max/error/paramSet", "パラメータ設定に失敗しました: " + e.message);
        }
    }
    
    // パッチ保存の処理
    handleSavePatch(args) {
        if (!args || args.length < 2) {
            this.error("パッチ保存に必要な引数が不足しています");
            this.sendOSCMessage("/max/error/patchSave", "パッチIDとファイルパスが必要です");
            return;
        }
        
        const patchId = String(args[0]);
        const filePath = String(args[1]);
        
        // ファイルパスの妥当性チェック
        if (!filePath || filePath.trim() === "") {
            this.error("無効なファイルパスです");
            this.sendOSCMessage("/max/error/patchSave", "無効なファイルパスです");
            return;
        }
        
        this.log("パッチ保存リクエスト: " + patchId + " -> " + filePath);
        
        // パッチの存在確認
        if (!this.activePatchIds[patchId]) {
            this.error("パッチが見つかりません: " + patchId);
            this.sendOSCMessage("/max/error/patchSave", "パッチが見つかりません: " + patchId);
            return;
        }
        
        try {
            const patch = this.activePatchIds[patchId].maxPatch;
            
            if (!patch) {
                throw new Error("パッチャー参照が無効です");
            }
            
            // ファイル形式のチェック
            if (!filePath.toLowerCase().endsWith('.maxpat')) {
                this.log("警告: ファイル名に.maxpat拡張子がありません。自動付加は行われません");
            }
            
            // パッチを保存
            patch.filepath = filePath;
            patch.save();
            
            // パッチ情報を更新
            this.activePatchIds[patchId].filePath = filePath;
            this.activePatchIds[patchId].lastSaved = Date.now();
            
            // 成功応答を送信
            this.sendOSCMessage("/max/response/patchSaved", patchId, filePath);
            
            // パッチの進捗状況通知
            const objectCount = Object.keys(this.activePatchIds[patchId].objects).length;
            const connectionCount = this.activePatchIds[patchId].connections ? this.activePatchIds[patchId].connections.length : 0;
            
            this.sendOSCMessage("/max/status/patchSaved", patchId, this.activePatchIds[patchId].name, 
                                objectCount, connectionCount, filePath);
        } catch (e) {
            this.error("パッチ保存エラー: " + e.message);
            this.lastError = {
                type: "patch_save_error",
                message: e.message,
                patchId: patchId,
                filePath: filePath,
                timestamp: Date.now()
            };
            this.sendOSCMessage("/max/error/patchSave", "パッチ保存に失敗しました: " + e.message);
        }
    }
    
    // ヘルパー関数：ログ出力
    log(message) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] MCP-Bridge: ${message}`;
        
        if (typeof max !== 'undefined' && max.post) {
            max.post(formattedMessage);
        } else if (this.patcher) {
            this.patcher.message("post", formattedMessage);
        }
        
        // ログ履歴の保存（監視用）
        this.storeLogMessage('info', message);
    }
    
    // ヘルパー関数：警告出力
    warning(message) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] MCP-Bridge-WARNING: ${message}`;
        
        if (typeof max !== 'undefined' && max.post) {
            max.post(formattedMessage);
        } else if (this.patcher) {
            this.patcher.message("post", formattedMessage);
        }
        
        // ログ履歴の保存（監視用）
        this.storeLogMessage('warning', message);
    }
    
    // ヘルパー関数：エラー出力
    error(message) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] MCP-Bridge-ERROR: ${message}`;
        
        if (typeof max !== 'undefined' && max.error) {
            max.error(formattedMessage);
        } else if (this.patcher) {
            this.patcher.message("error", formattedMessage);
        }
        
        // ログ履歴の保存（監視用）
        this.storeLogMessage('error', message);
        
        // OSC経由でエラーを通知（接続が有効な場合のみ）
        if (this.isConnected && this.oscSender) {
            try {
                this.sendOSCMessage("/max/system/error", message);
            } catch (e) {
                // エラー通知中のエラーは無視
            }
        }
    }
    
    // ログメッセージを内部に保存
    storeLogMessage(level, message) {
        if (!this.logHistory) {
            this.logHistory = [];
        }
        
        // ログ履歴の最大サイズを制限
        if (this.logHistory.length >= 100) {
            this.logHistory.shift(); // 古いログを削除
        }
        
        this.logHistory.push({
            timestamp: Date.now(),
            level: level,
            message: message
        });
    }
    
    // 監視用ログの取得
    getLogHistory() {
        return this.logHistory || [];
    }
    
    // v8ui環境から利用できるインターフェースメソッド
    init() {
        this.initialize();
        return "MCPブリッジ初期化完了";
    }
    
    // OSCメッセージを受信した際に呼び出されるエントリポイント
    // v8uiからの呼び出し用
    onOscMessage(address, ...args) {
        this.oscMessageHandler(address, ...args);
    }
}

// グローバルインスタンスの作成
const mcpBridge = new MCPBridge();

// Max 9へのエクスポート
exports.init = () => mcpBridge.init();
exports.onOscMessage = (address, ...args) => mcpBridge.onOscMessage(address, ...args);
