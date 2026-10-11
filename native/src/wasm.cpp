#include "itou/core.hpp"
#include <emscripten/emscripten.h>

// The returned buffer belongs to the module and is valid until the next call.
// Each browser Worker owns a module instance, including its debug sessions.
extern "C" EMSCRIPTEN_KEEPALIVE const char* itou_request(const char* input) {
  static std::string output;
  try { output = itou::request(itou::Json::parse(input)).dump(); }
  catch (const std::exception& error) { output = itou::Json{{"error",{{"phase","internal"},{"message",error.what()}}}}.dump(); }
  return output.c_str();
}
