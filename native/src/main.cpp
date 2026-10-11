#include "itou/core.hpp"
#include <fstream>
#include <filesystem>
#include <iostream>
#include <iterator>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace {
const char* usage = "喵++ 0.3.0 (C++ core)\n用法：itou [選項] <檔案.itou | ->\n"
  "  --engine vm|tree     執行引擎（預設：vm）\n"
  "  --check              只做名稱解析與靜態型別檢查\n"
  "  --no-typecheck       略過靜態檢查（執行期契約仍會生效）\n"
  "  --disassemble        輸出帶原始碼位置的 bytecode\n"
  "  --json               以 JSON 輸出結果或診斷\n"
  "  --max-steps N        執行步數上限\n"
  "  --help               顯示本說明\n";
bool redirected() {
#ifdef _WIN32
  return !_isatty(_fileno(stdin));
#else
  return !isatty(STDIN_FILENO);
#endif
}
std::string read(std::istream& stream) { return std::string(std::istreambuf_iterator<char>(stream),{}); }
}
int cli(int argc, char** argv) {
#ifdef _WIN32
  SetConsoleOutputCP(CP_UTF8);
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stderr), _O_BINARY);
#endif
  if (argc == 2 && std::string(argv[1]) == "--protocol") {
    std::string line;
    while (std::getline(std::cin,line)) {
      try { std::cout << itou::request(itou::Json::parse(line)).dump() << std::endl; }
      catch (const std::exception& e) { std::cout << itou::Json{{"error",{{"phase","internal"},{"message",e.what()}}}}.dump() << std::endl; }
    }
    return 0;
  }
  bool json = false, check = false, assembly = false, noCheck = false; std::string filename;
  itou::Json options = itou::Json::object();
  try {
    if (argc == 1) { std::cout << usage; return 0; }
    for (int i = 1; i < argc; ++i) {
      std::string arg = argv[i];
      if (arg == "--help" || arg == "-h") { std::cout << usage; return 0; }
      if (arg == "--json") json = true;
      else if (arg == "--check") check = true;
      else if (arg == "--disassemble") assembly = true;
      else if (arg == "--no-typecheck") noCheck = true;
      else if (arg == "--engine") { std::string value = ++i < argc ? argv[i] : ""; if (value != "tree" && value != "vm") throw std::invalid_argument("--engine 必須是 vm 或 tree"); options["engine"] = value; }
      else if (arg == "--max-steps") {
        std::string value = ++i < argc ? argv[i] : "";
        if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos) throw std::invalid_argument("--max-steps 必須是正的安全整數");
        unsigned long long n; try { n = std::stoull(value); } catch (...) { throw std::invalid_argument("--max-steps 必須是正的安全整數"); }
        if (!n || n > 9007199254740991ULL) throw std::invalid_argument("--max-steps 必須是正的安全整數"); options["maxSteps"] = n;
      } else if (arg != "-" && arg[0] == '-') throw std::invalid_argument("未知的選項 "+arg);
      else { if (!filename.empty()) throw std::invalid_argument("只接受一個輸入檔案"); filename = arg; }
    }
    if (filename.empty()) throw std::invalid_argument("缺少輸入檔案");
    if (check && assembly) throw std::invalid_argument("--check 與 --disassemble 不能併用");
    if (check && noCheck) throw std::invalid_argument("--check 與 --no-typecheck 不能併用");
  } catch (const std::exception& e) { std::cerr << e.what() << "\n" << usage; return 64; }
  std::string source, input;
  try {
    if (filename == "-") source = read(std::cin);
    else { std::ifstream file(std::filesystem::u8path(filename),std::ios::binary); if (!file) throw std::runtime_error("無法讀取檔案 "+filename); source = read(file); if (redirected()) input = read(std::cin); }
  } catch (const std::exception& e) { if (json) std::cout << itou::Json{{"error",{{"phase","io"},{"message",e.what()}}},{"output",itou::Json::array()}}.dump() << "\n"; else std::cerr << e.what() << "\n"; return 1; }
  options["input"] = input; if (noCheck) options["typecheck"] = false;
  auto reply = itou::request(itou::Json{{"type",check ? "check" : assembly ? "disassemble" : "run"},{"source",source},{"filename",filename},{"options",options}});
  if (reply.contains("error")) {
    if (json) std::cout << itou::Json{{"error",reply["error"]},{"output",reply["output"]},{"stdout",reply.value("stdout",std::string{})},{"stderr",reply.value("stderr",std::string{})}}.dump() << "\n";
    else { std::cout << reply.value("stdout",std::string{}); std::cerr << reply.value("stderr",std::string{}) << reply["formatted"].get<std::string>() << "\n"; } return 1;
  }
  auto result = reply["result"]; if (assembly) result = itou::Json{{"bytecode",result}};
  if (json) std::cout << result.dump() << "\n";
  else if (assembly) std::cout << result["bytecode"].get<std::string>() << "\n";
  else if (check) std::cout << "OK\n";
  else { std::cout << result["stdout"].get<std::string>(); std::cerr << result["stderr"].get<std::string>(); }
  return 0;
}

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
  std::vector<std::string> strings;
  strings.reserve(static_cast<size_t>(argc));
  for (int i = 0; i < argc; ++i) {
    int size = WideCharToMultiByte(CP_UTF8,0,argv[i],-1,nullptr,0,nullptr,nullptr);
    std::string text(static_cast<size_t>(size),'\0');
    WideCharToMultiByte(CP_UTF8,0,argv[i],-1,text.data(),size,nullptr,nullptr);
    text.pop_back(); strings.push_back(std::move(text));
  }
  std::vector<char*> arguments; for (auto& text : strings) arguments.push_back(text.data());
  return cli(argc,arguments.data());
}
#else
int main(int argc, char** argv) { return cli(argc,argv); }
#endif
