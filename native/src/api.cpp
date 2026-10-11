#include "itou/core.hpp"
#include <map>
#include <sstream>

namespace itou {
namespace {
std::map<size_t,std::unique_ptr<VM>> sessions;
size_t nextSession = 1;
}
std::string formatDiagnostic(const Json& error, const std::string& source, const std::string& filename) {
  std::ostringstream out; auto span = error["span"];
  if (span.is_null()) return error["phase"].get<std::string>()+": "+error["message"].get<std::string>();
  int line = span["line"], column = span["column"];
  out << filename << ":" << line << ":" << column << ": " << error["phase"].get<std::string>() << ": " << error["message"].get<std::string>();
  std::istringstream lines(source); std::string text; for (int i = 0; i < line; ++i) if (!std::getline(lines,text)) break;
  out << "\n" << text << "\n" << std::string(static_cast<size_t>(column-1),' ') << "^";
  for (auto& frame : error["frames"]) out << "\n  at " << frame["name"].get<std::string>() << " (" << filename << ":" << frame["span"]["line"] << ":" << frame["span"]["column"] << ")";
  return out.str();
}
Json request(const Json& m) {
  std::string type = m.value("type","run"), source = m.value("source",std::string{}), filename = m.value("filename",std::string("playground.itou"));
  Json options = m.value("options",Json::object()); Json output = Json::array(); VM* active = nullptr;
  std::unique_ptr<VM> runner; std::unique_ptr<Interpreter> tree;
  try {
    if (type == "tokenize") return Json{{"result",tokenize(source)}};
    if (type == "parse") return Json{{"result",parse(source)}};
    if (type == "resolve") return Json{{"result",resolve(m["ast"])}};
    if (type == "analyze") return Json{{"result",analyze(source,options)}};
    if (type == "check-program") { auto ast = m["ast"]; auto report = checkProgram(ast); return Json{{"result",report},{"ast",ast}}; }
    if (type == "check") { options["typecheck"] = true; return Json{{"result",analyze(source,options)["typeReport"]}}; }
    if (type == "compile") return Json{{"result",compileAst(analyze(source,options))}};
    if (type == "compile-ast") return Json{{"result",compileAst(m["ast"])}};
    if (type == "disassemble") return Json{{"result",disassemble(m.contains("proto") ? m["proto"] : compileAst(analyze(source,options)))}};
    if (type == "run") {
      auto ast = analyze(source,options); std::string engine = options.value("engine",std::string("vm"));
      if (engine == "tree") { tree = std::make_unique<Interpreter>(ast,options); return Json{{"result",tree->run()}}; }
      if (engine != "vm") throw std::invalid_argument("引擎必須是 'tree' 或 'vm'");
      runner = std::make_unique<VM>(compileAst(ast),options); active = runner.get(); return Json{{"result",runner->run()}};
    }
    if (type == "interpret-ast") { tree = std::make_unique<Interpreter>(m["ast"],options); return Json{{"result",tree->run()}}; }
    if (type == "debug") {
      // Compile before replacing the old session: failed source cannot leave a
      // partially initialized VM. Sessions are explicitly released by the host.
      auto proto = m.contains("proto") ? m["proto"] : compileAst(analyze(source,options));
      size_t id = nextSession++; sessions[id] = std::make_unique<VM>(proto,options);
      return Json{{"session",id},{"result",sessions[id]->snapshot()},{"assembly",disassemble(proto)}};
    }
    size_t id = m.at("session").get<size_t>();
    auto found = sessions.find(id); if (found == sessions.end()) throw std::invalid_argument("start a new debug session first"); active = found->second.get();
    if (type == "dispose") { sessions.erase(found); return Json{{"result",nullptr}}; }
    if (type == "snapshot") return Json{{"result",active->snapshot()}};
    if (type == "step-instruction") { bool more = active->step(); return Json{{"result",active->snapshot()},{"more",more}}; }
    if (type == "step-line") return Json{{"result",active->stepLine()}};
    if (type == "continue") return Json{{"result",active->resume(m.value("breakpoints",Json::array()))}};
    if (type == "vm-run") return Json{{"result",active->run()},{"state",active->snapshot()}};
    throw std::invalid_argument("unknown command " + type);
  } catch (const Error& error) {
    Context* context = active ? &active->context : tree ? &tree->context : nullptr;
    if (context) { context->finishOutput(); output = context->output; }
    Json result{{"error",error.diagnostic},{"formatted",formatDiagnostic(error.diagnostic,source,filename)},{"output",output},{"stdout",context ? context->stdoutText : ""},{"stderr",context ? context->stderrText : ""}};
    if (active) result["state"] = active->snapshot(); return result;
  } catch (const std::exception& error) {
    return Json{{"error",Json{{"phase","internal"},{"message",error.what()},{"span",nullptr},{"frames",Json::array()}}},{"formatted",error.what()},{"output",output}};
  }
}
} // namespace itou
