cmake_minimum_required(VERSION 3.20)
project(itouLang VERSION 0.3.0 LANGUAGES CXX)
if(POLICY CMP0135)
  cmake_policy(SET CMP0135 NEW)
endif()

include(FetchContent)
FetchContent_Declare(json URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz)
FetchContent_MakeAvailable(json)

add_library(itou_core
  native/src/frontend.cpp native/src/checker.cpp native/src/compiler.cpp
  native/src/runtime.cpp native/src/vm.cpp native/src/interpreter.cpp native/src/api.cpp)
target_include_directories(itou_core PUBLIC native/include)
target_link_libraries(itou_core PUBLIC nlohmann_json::nlohmann_json)
target_compile_features(itou_core PUBLIC cxx_std_17)
if(MSVC)
  target_compile_options(itou_core PUBLIC /utf-8 /W4 /EHsc)
else()
  target_compile_options(itou_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(EMSCRIPTEN)
  target_compile_options(itou_core PUBLIC -fwasm-exceptions)
  add_executable(itou_wasm native/src/wasm.cpp)
  target_link_libraries(itou_wasm PRIVATE itou_core)
  set_target_properties(itou_wasm PROPERTIES OUTPUT_NAME itou SUFFIX .js
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/web/native")
  target_link_options(itou_wasm PRIVATE
    -fwasm-exceptions
    --no-entry -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker,node
    -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=4194304
    "-sEXPORTED_FUNCTIONS=['_itou_request']" "-sEXPORTED_RUNTIME_METHODS=['ccall']")
else()
  add_executable(itou native/src/main.cpp)
  target_link_libraries(itou PRIVATE itou_core)
  if(MSVC)
    target_link_options(itou PRIVATE /STACK:8388608)
  endif()
  install(TARGETS itou RUNTIME DESTINATION bin)
endif()
