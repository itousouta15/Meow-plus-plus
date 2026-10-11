#include "itou/core.hpp"
#include <iomanip>
#include <sstream>

namespace itou {
namespace {
class Compiler {
  struct Loop { size_t start; int scopeDepth; std::vector<size_t> breaks, continues; };
  int& nextId;
  int scopeDepth = 0;
  std::vector<Loop> loops;
  size_t emit(const std::string& op, Json arg, const Json& span) { proto["code"].push_back(Json{{"op",op},{"arg",arg},{"span",span}}); return proto["code"].size()-1; }
  void patch(size_t index) { proto["code"][index]["arg"] = proto["code"].size(); }
  void constant(const Json& value, const Json& span) {
    size_t i = 0; for (; i < proto["constants"].size(); ++i) if (proto["constants"][i] == value) break;
    if (i == proto["constants"].size()) proto["constants"].push_back(value);
    emit("CONST",i,span);
  }
  Json function(const Json& n) {
    Json params = Json::array(), types = Json::array(); for (auto& p : n["params"]) { params.push_back(p["name"]); types.push_back(annotation(p)); }
    Compiler child(n["name"],params,n["body"]["layout"],n["span"],nextId,n["body"]["types"],types,annotation(n,"returnType"));
    child.body(n["body"]["body"]); child.constant(nullptr,n["body"]["span"]); child.emit("RETURN",nullptr,n["body"]["span"]); return child.proto;
  }
  void statement(const Json& n) {
    std::string t = n["type"]; auto span = n["span"];
    if (t == "Let") { expression(n["init"]); emit("INIT",n["slot"],n["init"]["span"]); }
    else if (t == "ExpressionStmt") { expression(n["expression"]); emit("POP",nullptr,span); }
    else if (t == "StreamOut") { for (auto& value : n["values"]) { expression(value); emit("WRITE",n["channel"],value["span"]); } }
    else if (t == "StreamIn") { for (auto& target : n["targets"]) emit("READ",Json{{"address",target["address"]},{"mode",n["mode"]}},target["span"]); }
    else if (t == "Block") { emit("ENTER",Json{{"names",n["layout"]},{"types",n["types"]}},span); ++scopeDepth; body(n["body"]); --scopeDepth; emit("LEAVE",nullptr,span); }
    else if (t == "If") {
      expression(n["test"]); auto other = emit("JUMP_FALSE",nullptr,n["test"]["span"]); statement(n["then"]);
      if (!n["otherwise"].is_null()) { auto end = emit("JUMP",nullptr,span); patch(other); statement(n["otherwise"]); patch(end); } else patch(other);
    } else if (t == "While" || t == "For") {
      auto start = proto["code"].size(); expression(n["test"]); auto end = emit("JUMP_FALSE",nullptr,n["test"]["span"]);
      loops.push_back({start,scopeDepth,{},{}}); statement(n["body"]); auto loop = loops.back(); loops.pop_back();
      for (auto jump : loop.continues) patch(jump);
      if (n.contains("update") && !n["update"].is_null()) { expression(n["update"]); emit("POP",nullptr,n["update"]["span"]); }
      emit("JUMP",start,span); patch(end); for (auto jump : loop.breaks) patch(jump);
    } else if (t == "Break" || t == "Continue") {
      auto& loop = loops.back(); int unwind = scopeDepth-loop.scopeDepth; if (unwind > 0) emit("UNWIND",unwind,span);
      auto jump = emit("JUMP",nullptr,span); (t == "Break" ? loop.breaks : loop.continues).push_back(jump);
    } else if (t == "Return") { if (!n["value"].is_null()) expression(n["value"]); else constant(nullptr,span); emit("RETURN",nullptr,span); }
  }
  void expression(const Json& n) {
    std::string t = n["type"]; auto span = n["span"];
    if (t == "Literal") constant(n["value"],span);
    else if (t == "Variable") emit("LOAD",n["address"],span);
    else if (t == "Assign") { expression(n["value"]); emit("STORE",n["address"],n["nameSpan"]); }
    else if (t == "Update") {
      emit("LOAD",n["address"],n["nameSpan"]); if (!n["prefix"].get<bool>()) emit("DUP",nullptr,span);
      constant(1,span); emit("BINARY",n["op"] == "++" ? "+" : "-",span); emit("STORE",n["address"],n["nameSpan"]);
      if (!n["prefix"].get<bool>()) emit("POP",nullptr,span);
    } else if (t == "Unary") { expression(n["value"]); emit("UNARY",n["op"],n["opSpan"]); }
    else if (t == "Binary") { expression(n["left"]); expression(n["right"]); emit("BINARY",n["op"],n["opSpan"]); }
    else if (t == "Logical") {
      expression(n["left"]); emit("DUP",nullptr,n["opSpan"]); auto jump = emit(n["op"] == "and" ? "JUMP_FALSE" : "JUMP_TRUE",nullptr,n["opSpan"]);
      emit("POP",nullptr,n["opSpan"]); expression(n["right"]); emit("BOOL",nullptr,n["opSpan"]); patch(jump);
    } else if (t == "Function") emit("CLOSURE",function(n),span);
    else if (t == "Call") { expression(n["callee"]); for (auto& a : n["args"]) expression(a); emit("CALL",n["args"].size(),span); }
  }
public:
  Json proto;
  Compiler(const std::string& name, const Json& params, const Json& layout, const Json& span, int& ids, const Json& types, Json parameterTypes = Json::array(), Json returns = primitive("any")) : nextId(ids) {
    proto = Json{{"id",ids++},{"name",name},{"params",params},{"layout",layout},{"span",span},{"types",types},{"parameterTypes",parameterTypes},{"returnType",returns},{"constants",Json::array()},{"code",Json::array()}};
  }
  void body(const Json& statements) {
    for (auto& n : statements) if (n["type"] == "FunctionDecl") { emit("CLOSURE",function(n["fn"]),n["span"]); emit("INIT",n["slot"],n["span"]); }
    for (auto& n : statements) statement(n);
  }
  void halt(const Json& span) { emit("HALT",nullptr,span); }
};
} // namespace
Json compileAst(const Json& program) {
  int id = 0; Compiler compiler("<script>",Json::array(),program["layout"],program["span"],id,program["types"]);
  compiler.body(program["body"]); compiler.halt(program["span"]); return compiler.proto;
}
std::string disassemble(const Json& proto) {
  std::ostringstream out;
  out << "fn #" << proto["id"] << " " << proto["name"].get<std::string>() << "(";
  for (size_t i = 0; i < proto["params"].size(); ++i) { if (i) out << ", "; out << proto["params"][i].get<std::string>() << ": " << typeName(proto["parameterTypes"][i]); }
  out << ") -> " << typeName(proto["returnType"]) << "\n  slots: ";
  for (size_t i = 0; i < proto["layout"].size(); ++i) { if (i) out << ", "; out << proto["layout"][i].get<std::string>() << ": " << typeName(proto["types"][i]); }
  if (proto["layout"].empty()) out << "(none)";
  for (size_t i = 0; i < proto["code"].size(); ++i) {
    auto& ins = proto["code"][i]; std::string op = ins["op"]; const auto& arg = ins["arg"];
    out << "\n  " << std::setfill('0') << std::setw(4) << i << std::setfill(' ') << "  L" << std::left << std::setw(4) << ins["span"]["line"].get<int>() << " " << std::setw(12) << op << " " << std::right;
    if (op == "CONST") out << arg << " (" << proto["constants"][arg.get<size_t>()].dump() << ")";
    else if (op == "CLOSURE") out << "#" << arg["id"] << " " << arg["name"].get<std::string>();
    else if (op == "LOAD" || op == "STORE") out << arg["name"].get<std::string>() << " @ " << arg["depth"] << ":" << arg["slot"];
    else if (op == "ENTER") { for (size_t j = 0; j < arg["names"].size(); ++j) { if (j) out << ", "; out << arg["names"][j].get<std::string>() << ": " << typeName(arg["types"][j]); } }
    else if (!arg.is_null()) out << (arg.is_string() ? arg.get<std::string>() : arg.dump());
  }
  for (auto& ins : proto["code"]) if (ins["op"] == "CLOSURE") out << "\n\n" << disassemble(ins["arg"]);
  return out.str();
}
} // namespace itou
