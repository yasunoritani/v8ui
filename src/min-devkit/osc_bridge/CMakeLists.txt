# OSC Bridge for Max/MSP
cmake_minimum_required(VERSION 3.10)

# プロジェクト名の設定
project(osc_bridge)

# Min-APIパスの設定
if (NOT DEFINED C74_MIN_API_DIR)
    # GitHubからクローンしたmin-devリポジトリを使用するが、相対パスで参照
    set(C74_MIN_API_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../min-dev/min-devkit/source/min-api")
    
    if(NOT EXISTS "${C74_MIN_API_DIR}")
        message(WARNING "Min-API not found at relative path: ${C74_MIN_API_DIR}")
        message(STATUS "Trying alternative relative paths...")
        
        # 代替パスを試す
        set(ALT_MIN_API_DIR "${CMAKE_SOURCE_DIR}/min-dev/min-devkit/source/min-api")
        if(EXISTS "${ALT_MIN_API_DIR}")
            set(C74_MIN_API_DIR "${ALT_MIN_API_DIR}")
            message(STATUS "Found Min-API at: ${C74_MIN_API_DIR}")
        else()
            message(FATAL_ERROR "Min-API not found in any expected location. Please set C74_MIN_API_DIR manually.")
        endif()
    else()
        message(STATUS "Using Min-API from relative path: ${C74_MIN_API_DIR}")
    endif()
endif()

# LLM-Max MCP連携プロジェクトのバージョン情報
set(OSC_BRIDGE_VERSION_MAJOR 1)
set(OSC_BRIDGE_VERSION_MINOR 1)
set(OSC_BRIDGE_VERSION_PATCH 0)
set(OSC_BRIDGE_VERSION "${OSC_BRIDGE_VERSION_MAJOR}.${OSC_BRIDGE_VERSION_MINOR}.${OSC_BRIDGE_VERSION_PATCH}")
message(STATUS "Building OSC Bridge v${OSC_BRIDGE_VERSION} for LLM-Max MCP Integration")

# Min-DevKitの構成スクリプトをインクルード
include(${C74_MIN_API_DIR}/script/min-pretarget.cmake)

#############################################################
# MAX EXTERNAL
#############################################################

# includeディレクトリ設定
include_directories( 
	"${C74_INCLUDES}"
	"${CMAKE_CURRENT_SOURCE_DIR}"
)

# ソースファイル設定 - Issue 19: Min-DevKitヘッダーの重複インクルード対応
# Min-DevKitの設計思想に従い、単一ファイル方式を采用する
# Min-DevKitヘッダー(c74_min.h)は各ソースファイルで一度だけインクルードされる必要がある

# Issue 27: WebSocket対応と LLM-Max MCP 連携の実装
# WebSocketクライアント/サーバー機能を追加し、MCPプロトコルをサポート

# 重複シンボル問題を避けるために個別の外部オブジェクトとしてビルド

# 1. OSC Bridge外部オブジェクト
add_library(
    ${PROJECT_NAME}
    MODULE
    osc_bridge.cpp
)

# 2. LLM MCP外部オブジェクト
add_library(
    llm_mcp
    MODULE
    llm.mcp.cpp
)

# llm_mcpの出力先を設定
set_target_properties(llm_mcp PROPERTIES
    FOLDER "Externals"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../../../externals"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../../../externals"
    SUFFIX ".mxo"
    PREFIX ""
)

# PkgInfoファイルを手動で生成してコピーする
add_custom_command(TARGET llm_mcp POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_SOURCE_DIR}/../../../externals/llm.mcp.mxo/Contents"
    COMMAND echo "BNDL????〜" > "${CMAKE_SOURCE_DIR}/../../../externals/llm.mcp.mxo/Contents/PkgInfo"
    COMMENT "Creating PkgInfo file for llm.mcp.mxo"
)

# C++17を有効化
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 両方のターゲットに明示的にC++17を設定
set_property(TARGET ${PROJECT_NAME} PROPERTY CXX_STANDARD 17)
set_property(TARGET llm_mcp PROPERTY CXX_STANDARD 17)

# macOS固有の設定
if(APPLE)
    # テスト用に一時的にarm64のみにする
    # 注意: Issue 18ではユニバーサルバイナリサポートが必要
    # テスト完了後に元に戻す必要あり
    set(CMAKE_OSX_ARCHITECTURES "arm64" CACHE STRING "Build architectures for Mac OS X" FORCE)
    message(STATUS "テスト用に現在arm64のみをビルドしています")
    
    # Max 8.2+に対応したデプロイメントターゲット
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13" CACHE STRING "Minimum OS X deployment version" FORCE)
    
    # M4L環境用の最適化設定
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fvisibility=hidden -fvisibility-inlines-hidden")
    
    # アーキテクチャの確認メッセージ
    message(STATUS "Building for architectures: ${CMAKE_OSX_ARCHITECTURES}")
endif()

# OSCPackライブラリの設定
# 環境変数またはリポジトリ内の場所から探索
if(DEFINED ENV{OSCPACK_ROOT})
    set(OSCPACK_ROOT_DIR $ENV{OSCPACK_ROOT})
elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../../oscpack")
    set(OSCPACK_ROOT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oscpack")
else()
    message(FATAL_ERROR "oscpack library not found. Please set OSCPACK_ROOT environment variable.")
endif()

# oscpackライブラリの設定
include_directories("${OSCPACK_ROOT_DIR}")

# oscpackライブラリパスの候補 - build_universalを優先的に検索
set(OSCPACK_LIB_CANDIDATES
    "${OSCPACK_ROOT_DIR}/build_universal/liboscpack.a"  # 優先度最高（ユニバーサルビルド）
    "${OSCPACK_ROOT_DIR}/build/liboscpack.a"
    "${OSCPACK_ROOT_DIR}/lib/liboscpack.a"
    "${OSCPACK_ROOT_DIR}/build/oscpack.lib"
    "${OSCPACK_ROOT_DIR}/lib/oscpack.lib"
)

# 実際のライブラリパスを探索
foreach(CANDIDATE ${OSCPACK_LIB_CANDIDATES})
    if(EXISTS "${CANDIDATE}")
        set(OSCPACK_LIB "${CANDIDATE}")
        break()
    endif()
endforeach()

# OSCpackをプリリンクするためにターゲットに追加
if(DEFINED OSCPACK_LIB)
    message(STATUS "Using oscpack library: ${OSCPACK_LIB}")
    
    # ユニバーサルビルドのチェック（macOSのみ）
    if(APPLE AND OSCPACK_LIB MATCHES "build_universal/liboscpack.a")
        message(STATUS "Using universal build of oscpack library")
    elseif(APPLE)
        message(WARNING "Not using the universal build of oscpack library. This may cause architecture compatibility issues.")
        message(WARNING "Run 'oscpack/build_universal.sh' to create a universal binary.")
    endif()
    
    # 両方のターゲットにOSCpackをリンク
    target_link_libraries(${PROJECT_NAME} PUBLIC "${OSCPACK_LIB}")
    target_link_libraries(llm_mcp PUBLIC "${OSCPACK_LIB}")
else()
    message(STATUS "Using generic oscpack library")
    target_link_libraries(${PROJECT_NAME} PUBLIC "oscpack")
    target_link_libraries(llm_mcp PUBLIC "oscpack")
endif()

# macOS固有のリンクオプション
if(APPLE)
    # OSC Bridge用のフレームワークリンク
    target_link_libraries(${PROJECT_NAME} PUBLIC
        "-framework CoreFoundation"
        "-framework CoreAudio"
    )
    
    # LLM MCP用のフレームワークリンク
    target_link_libraries(llm_mcp PUBLIC
        "-framework CoreFoundation"
        "-framework CoreAudio"
    )
endif()

# コンパイル定義
target_compile_definitions(${PROJECT_NAME} PRIVATE
    MCP_OSC_VERSION="1.0.0"
    _CRT_SECURE_NO_WARNINGS
    NOMINMAX
)

# osc_bridge向けのMin-DevKitの後処理スクリプトを実行
include(${C74_MIN_API_DIR}/script/min-posttarget.cmake)

# llm_mcp向けの後処理
# 現在のproject nameを保存
set(CURRENT_PROJECT ${PROJECT_NAME})
# 一時的にllm_mcpをプロジェクト名に設定
set(PROJECT_NAME llm_mcp)

# llm_mcpのバンドル設定を拡張 (よりシンプルな設定に変更)
set_target_properties(llm_mcp PROPERTIES
    BUNDLE TRUE
    BUNDLE_EXTENSION "mxo"
    OUTPUT_NAME "llm.mcp"
    PREFIX ""
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../../../externals"
    MACOSX_BUNDLE TRUE
    MACOSX_BUNDLE_BUNDLE_NAME "llm.mcp"
)

# llm_mcpターゲットに必要な追加ライブラリをリンク
target_link_libraries(llm_mcp PRIVATE
    ${CMAKE_THREAD_LIBS_INIT}
    "${LIBWEBSOCKETS_LIB}"
)

# アーキテクチャ固有の設定を追加
if(APPLE)
    # リンクエラーを避けるために必要なフラグを追加
    target_link_options(llm_mcp PRIVATE
        "-Wl,-undefined,dynamic_lookup"
    )
    
    # シンボルが見つからない場合にエラーを出さないようにする
    set_target_properties(llm_mcp PROPERTIES 
        LINK_FLAGS "-Wl,-flat_namespace,-undefined,suppress"
    )
endif()

# LLM MCP用のコンパイル定義を設定
set_target_properties(llm_mcp PROPERTIES
    COMPILE_DEFINITIONS "MCP_WEBSOCKET_SUPPORT=1;MCP_VERSION=\"${OSC_BRIDGE_VERSION}\";LWS_LIBRARY_VERSION=\"${LIBWEBSOCKETS_VERSION}\""
)

# 元のプロジェクト名を復元
set(PROJECT_NAME ${CURRENT_PROJECT})

#############################################################
# WebSocketサポートの設定
#############################################################

# WebSocketサポートの設定
message(STATUS "Configuring WebSocket support for LLM-Max MCP Integration")

# ビルドアーキテクチャの検出
set(CURRENT_ARCH ${CMAKE_SYSTEM_PROCESSOR})
message(STATUS "Current architecture: ${CURRENT_ARCH}")

# WebSocketライブラリの依存関係を検索
find_package(PkgConfig REQUIRED)

# nlohmann-jsonライブラリを検索
find_package(nlohmann_json QUIET)
if(nlohmann_json_FOUND)
    message(STATUS "Found nlohmann-json via find_package")
else()
    find_path(NLOHMANN_JSON_INCLUDE_DIRS nlohmann/json.hpp
        PATH_SUFFIXES include
        PATHS
            /usr/local
            /usr
            /opt
            /opt/homebrew
    )
    if(NLOHMANN_JSON_INCLUDE_DIRS)
        message(STATUS "Found nlohmann-json include directory: ${NLOHMANN_JSON_INCLUDE_DIRS}")
    else()
        message(FATAL_ERROR "nlohmann-json library not found, please install it using your package manager")
    endif()
endif()

# ヘッダーインクルードディレクトリを追加
target_include_directories(${PROJECT_NAME} PRIVATE "/opt/homebrew/include")
target_include_directories(llm_mcp PRIVATE "/opt/homebrew/include")

# libwebsocketsライブラリを検索
find_library(LIBWEBSOCKETS_LIB websockets HINTS /opt/homebrew/lib /usr/local/lib)
if(LIBWEBSOCKETS_LIB)
    message(STATUS "Found libwebsockets: ${LIBWEBSOCKETS_LIB}")
    find_path(LIBWEBSOCKETS_INCLUDE_DIR libwebsockets.h
        PATH_SUFFIXES include
        PATHS
            /usr/local
            /usr
            /opt
            /opt/homebrew
    )
    if(NOT LIBWEBSOCKETS_INCLUDE_DIR)
        message(FATAL_ERROR "libwebsockets.h not found")
    endif()
else()
    message(FATAL_ERROR "libwebsockets library not found, please install it using your package manager (e.g., brew install libwebsockets)")
endif()

# アーキテクチャに基づいたlibwebsocketsのパスを追加
if(CURRENT_ARCH STREQUAL "arm64")
    message(STATUS "ARM64 architecture detected, adding homebrew path for ARM64")
    list(APPEND CMAKE_PREFIX_PATH "/opt/homebrew/opt/libwebsockets")
    link_directories("/opt/homebrew/lib")
elseif(CURRENT_ARCH STREQUAL "x86_64")
    message(STATUS "x86_64 architecture detected, adding homebrew path for Intel")
    list(APPEND CMAKE_PREFIX_PATH "/usr/local/opt/libwebsockets")
    link_directories("/usr/local/lib") 
else()
    message(WARNING "Unknown architecture: ${CURRENT_ARCH}, using default paths")
endif()

# pthread（スレッドライブラリ）をリンク
find_package(Threads REQUIRED)
target_link_libraries(${PROJECT_NAME} PUBLIC ${CMAKE_THREAD_LIBS_INIT})
target_link_libraries(llm_mcp PUBLIC ${CMAKE_THREAD_LIBS_INIT})

# llm_mcpターゲットに必要なライブラリをリンク
target_link_libraries(llm_mcp PRIVATE
    ${CMAKE_THREAD_LIBS_INIT}
    "${LIBWEBSOCKETS_LIB}"
)

# アーキテクチャ固有の必要な設定
if(APPLE)
    # リンクエラーを避けるために必要なフラグを追加
    target_link_options(llm_mcp PRIVATE
        "-Wl,-undefined,dynamic_lookup"
    )
    
    # アーキテクチャの一部だけで利用可能なライブラリを使用する場合の特別処理
    message(STATUS "Setting special link flags for handling single-architecture libraries in universal build")
    
    # シンボルが見つからない場合にエラーを出さないようにする
    set_target_properties(llm_mcp PROPERTIES 
        LINK_FLAGS "-Wl,-flat_namespace,-undefined,suppress"
    )
endif()

# OSCメッセージをJSON化してWebSocket経由で送信する実装に切り替え
# ネイティブのWebSocketの代わりに外部インターフェースを使用
message(STATUS "Using native OSC over JSON for WebSocket MCP support")
message(STATUS "Added LLM MCP connector for Claude Desktop API integration")

# WebSocketヘッダーファイルのリスト
set(WEBSOCKET_HEADERS
    "${CMAKE_CURRENT_SOURCE_DIR}/mcp.websocket_client.hpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/mcp.websocket_server.hpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/mcp.websocket_mcp_handler.hpp"
)

# WebSocketヘッダーの存在確認
foreach(HEADER ${WEBSOCKET_HEADERS})
    if(EXISTS "${HEADER}")
        message(STATUS "Found WebSocket header: ${HEADER}")
    else()
        message(WARNING "WebSocket header not found: ${HEADER}")
    endif()
endforeach()

# OSC BridgeとLLM MCPの両方に共通のコンパイル定義
# 各ターゲットごとに設定を適用

# OSC Bridge用の設定
set_target_properties(${PROJECT_NAME} PROPERTIES
    COMPILE_DEFINITIONS "MCP_WEBSOCKET_SUPPORT=1;MCP_VERSION=\"${OSC_BRIDGE_VERSION}\";LWS_LIBRARY_VERSION=\"${LIBWEBSOCKETS_VERSION}\""
)

# LLM MCP用の設定
set_target_properties(llm_mcp PROPERTIES
    COMPILE_DEFINITIONS "MCP_WEBSOCKET_SUPPORT=1;MCP_VERSION=\"${OSC_BRIDGE_VERSION}\";LWS_LIBRARY_VERSION=\"${LIBWEBSOCKETS_VERSION}\""
)

# WebSocketヘッダーの依存関係を設定
set_source_files_properties(osc_bridge.cpp PROPERTIES OBJECT_DEPENDS "${WEBSOCKET_HEADERS}")
set_source_files_properties(mcp.llm_mcp.cpp PROPERTIES OBJECT_DEPENDS "${WEBSOCKET_HEADERS}")

#############################################################
# テスト環境（Issue 24: Min-DevKit依存分離）
#############################################################

# テストタイプのオプション設定
option(BUILD_OSC_BRIDGE_TESTS "Build OSC Bridge test suite with Min-DevKit integration" OFF)
option(BUILD_OSC_BRIDGE_STANDALONE_TESTS "Build standalone OSC Bridge tests without Min-DevKit dependency" OFF)

# Issue 24: Min-DevKit依存のテスト環境（従来）
if(BUILD_OSC_BRIDGE_TESTS)
    message(STATUS "Building OSC Bridge tests with Min-DevKit integration")
    
    # Min-DevKit依存のテストファイル
    set(MIN_DEVKIT_TEST_FILES
        tests/standalone_test.cpp
        # Issue 24: これらのテストはMin-DevKit依存なしバージョンに移行中
        # tests/error_recovery_test.cpp
        # tests/simple_test.cpp
        # tests/extended_types_test.cpp
        # tests/m4l_lifecycle_test.cpp
        # tests/multi_instance_test.cpp
        # tests/performance_test.cpp
    )
    
    # Catch2のインストール
    include(FetchContent)
    FetchContent_Declare(
        Catch2
        GIT_REPOSITORY https://github.com/catchorg/Catch2.git
        GIT_TAG v2.13.8 # M4L環境との互換性確認済み
    )
    FetchContent_MakeAvailable(Catch2)
    
    # Catch2の検出とインクルード
    set(Catch2_SOURCE_DIR "${catch2_SOURCE_DIR}")
    set(Catch2_INCLUDE_DIR "${catch2_SOURCE_DIR}/single_include")
    
    # テスト実行ファイルの設定
    add_executable(test_osc_bridge ${MIN_DEVKIT_TEST_FILES})
    
    # インクルードディレクトリを明示的に追加
    target_include_directories(test_osc_bridge PRIVATE
        "${Catch2_INCLUDE_DIR}"
        "${Catch2_INCLUDE_DIR}/catch2"
        "${catch2_SOURCE_DIR}/include"
    )
    
    # OSCpackとリンク
    if(DEFINED OSCPACK_LIB)
        target_link_libraries(test_osc_bridge PRIVATE "${OSCPACK_LIB}")
    else()
        target_link_libraries(test_osc_bridge PRIVATE "oscpack")
    endif()
    
    # テストバイナリの出力先を設定
    set_target_properties(test_osc_bridge PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tests"
    )
endif()

# Issue 24: Min-DevKit非依存のスタンドアロンテスト環境（新規）
if(BUILD_OSC_BRIDGE_STANDALONE_TESTS)
    message(STATUS "Building standalone OSC Bridge tests without Min-DevKit dependency")
    
    # tests/ディレクトリのCMakeListsを使用してスタンドアロンテストをビルド
    add_subdirectory(tests)
endif()

# どちらのテストも有効でない場合の情報表示
if(NOT BUILD_OSC_BRIDGE_TESTS AND NOT BUILD_OSC_BRIDGE_STANDALONE_TESTS)
    message(STATUS "OSC Bridge tests are disabled. To enable tests, use one of the following options:")
    message(STATUS "  -DBUILD_OSC_BRIDGE_TESTS=ON             # Min-DevKit統合テスト")
    message(STATUS "  -DBUILD_OSC_BRIDGE_STANDALONE_TESTS=ON  # Min-DevKit非依存のスタンドアロンテスト")
endif()
