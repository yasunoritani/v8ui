# OSC Bridge Tests CMake設定
cmake_minimum_required(VERSION 3.10)

# プロジェクト名
project(osc_bridge_tests)

# C++17を有効化
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ルートディレクトリからの相対パス
get_filename_component(ROOT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../.." ABSOLUTE)

# GitHub Actions環境のチェック
if(DEFINED ENV{GITHUB_WORKSPACE})
    set(GITHUB_ROOT_DIR "$ENV{GITHUB_WORKSPACE}")
    message(STATUS "Running in GitHub Actions environment: ${GITHUB_ROOT_DIR}")
    set(ROOT_DIR "${GITHUB_ROOT_DIR}")
endif()

# oscpackライブラリへのパス
set(OSCPACK_ROOT_DIR "${ROOT_DIR}/oscpack")
message(STATUS "Using OSCPACK_ROOT_DIR: ${OSCPACK_ROOT_DIR}")

# oscpackのインクルードパス
include_directories(
    "${OSCPACK_ROOT_DIR}" 
    "${CMAKE_CURRENT_SOURCE_DIR}/.."
)

# Catch2のダウンロード
include(FetchContent)
FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG v2.13.8
)
FetchContent_MakeAvailable(Catch2)

# Catch2のインクルードパス
set(Catch2_SOURCE_DIR "${catch2_SOURCE_DIR}")
set(Catch2_INCLUDE_DIR "${catch2_SOURCE_DIR}/single_include")

include_directories(
    "${Catch2_INCLUDE_DIR}"
    "${Catch2_INCLUDE_DIR}/catch2"
    "${catch2_SOURCE_DIR}/include"
)

# テストソースファイル
set(TEST_SOURCES
    standalone_test.cpp
    error_recovery_test_new.cpp
    # Issue 26で有効化したテストファイル
    extended_types_test_new.cpp  # スタンドアロン対応に更新
    m4l_lifecycle_test_new.cpp
    multi_instance_test_new.cpp  # スタンドアロン対応に更新
    performance_test_new.cpp     # スタンドアロン対応に更新
)

# メインのテスト実行ファイル
add_executable(test_osc_bridge_standalone ${TEST_SOURCES})

# oscpackライブラリパスの候補 - build_universalを優先的に検索
set(OSCPACK_LIB_CANDIDATES
    "${OSCPACK_ROOT_DIR}/build_universal/liboscpack.a"  # 優先度最高（ユニバーサルビルド）
    "${OSCPACK_ROOT_DIR}/build/liboscpack.a"
    "${OSCPACK_ROOT_DIR}/lib/liboscpack.a"
    "${ROOT_DIR}/src/min-devkit/osc_bridge/../../../oscpack/build_universal/liboscpack.a" # 代替パス（GitHub Actions環境用）
    "${ROOT_DIR}/oscpack/build/liboscpack.a"
    "${OSCPACK_ROOT_DIR}/build/oscpack.lib"
    "${OSCPACK_ROOT_DIR}/lib/oscpack.lib"
)

# 調査用: 存在するファイルのリスト表示
foreach(CANDIDATE ${OSCPACK_LIB_CANDIDATES})
    if(EXISTS "${CANDIDATE}")
        message(STATUS "Found oscpack candidate: ${CANDIDATE}")
    else()
        message(STATUS "Missing oscpack candidate: ${CANDIDATE}")
    endif()
endforeach()

# 実際のライブラリパスを探索
foreach(CANDIDATE ${OSCPACK_LIB_CANDIDATES})
    if(EXISTS "${CANDIDATE}")
        set(OSCPACK_LIB "${CANDIDATE}")
        break()
    endif()
endforeach()

# OSCpackライブラリとリンク
if(DEFINED OSCPACK_LIB)
    message(STATUS "Using oscpack library: ${OSCPACK_LIB}")
    if(APPLE)
        # macOS環境ではAファイルを直接リンク
        target_link_libraries(test_osc_bridge_standalone PRIVATE "${OSCPACK_LIB}")
    else()
        # パスが設定されている場合は、ファイルの存在確認
        target_link_libraries(test_osc_bridge_standalone PRIVATE "${OSCPACK_LIB}")
        # ディレクトリをリンクパスに追加
        get_filename_component(OSCPACK_LIB_DIR "${OSCPACK_LIB}" DIRECTORY)
        target_link_directories(test_osc_bridge_standalone PRIVATE "${OSCPACK_LIB_DIR}")
    endif()
else()
    # ディレクトリブラリ検索パスを追加
    if(EXISTS "${OSCPACK_ROOT_DIR}/build")
        message(STATUS "Adding oscpack build directory to link path: ${OSCPACK_ROOT_DIR}/build")
        target_link_directories(test_osc_bridge_standalone PRIVATE "${OSCPACK_ROOT_DIR}/build")
    endif()
    if(EXISTS "${ROOT_DIR}/oscpack/build")
        message(STATUS "Adding oscpack build directory to link path: ${ROOT_DIR}/oscpack/build")
        target_link_directories(test_osc_bridge_standalone PRIVATE "${ROOT_DIR}/oscpack/build")
    endif()
    
    message(STATUS "Using generic oscpack library")
    target_link_libraries(test_osc_bridge_standalone PRIVATE "oscpack")
endif()

# マルチスレッド対応のライブラリとリンク
find_package(Threads REQUIRED)
target_link_libraries(test_osc_bridge_standalone PRIVATE Threads::Threads)

# macOS固有のリンクオプション
if(APPLE)
    target_link_libraries(test_osc_bridge_standalone PRIVATE
        "-framework CoreFoundation"
    )
endif()

# テストバイナリの出力先を設定
set_target_properties(test_osc_bridge_standalone PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/tests"
)

# テストの実行
enable_testing()
add_test(NAME osc_bridge_tests COMMAND test_osc_bridge_standalone)
