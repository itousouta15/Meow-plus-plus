#include "itou/core.hpp"
#include <functional>

namespace itou {
const Json& primitiveTypes() {
  static const Json types = [] {
    Json t = Json::object();
    for (const auto& kind : {"any","number","string","boolean","null"}) t[kind] = primitive(kind);
    for (const auto& name : {"auto","自動","任意","任意值"}) t[name] = primitive("any");
    for (const auto& name : {"int","double","float","整數","浮點數","小數","數","數字"}) t[name] = primitive("number");
    for (const auto& name : {"bool","布林","布林值"}) t[name] = primitive("boolean");
    t["字串"] = primitive("string"); t["void"] = t["無值"] = t["空"] = primitive("null"); return t;
  }(); return types;
}
Json functionType(const Json& params, const Json& returns, Json variadic) { return Json{{"kind","function"},{"params",params},{"returns",returns},{"variadic",variadic}}; }
Json signature(const Json& node) { Json params = Json::array(); for (auto& p : node["params"]) params.push_back(annotation(p)); return functionType(params,annotation(node,"returnType")); }
std::string typeName(const Json& t) {
  if (t["kind"] != "function") return t["kind"];
  std::string text = "fn("; bool first = true;
  for (auto& p : t["params"]) { if (!first) text += ", "; first = false; text += typeName(p); }
  if (!t["variadic"].is_null()) text += (first ? "" : ", ") + std::string("...") + typeName(t["variadic"]);
  return text + ") -> " + typeName(t["returns"]);
}
bool acceptsArity(const Json& t, size_t n) { return t["variadic"].is_null() ? n == t["params"].size() : n >= t["params"].size(); }
bool assignable(const Json& a, const Json& b) {
  if (a["kind"] == "any" || b["kind"] == "any") return true;
  if (a["kind"] != b["kind"]) return false;
  if (a["kind"] != "function") return true;
  if (!b["variadic"].is_null() && (a["variadic"].is_null() || a["params"].size() > b["params"].size())) return false;
  if (b["variadic"].is_null() && !acceptsArity(a,b["params"].size())) return false;
  for (size_t i = 0; i < b["params"].size(); ++i) { const auto& accepted = i < a["params"].size() ? a["params"][i] : a["variadic"]; if (accepted.is_null() || !assignable(b["params"][i],accepted)) return false; }
  if (!b["variadic"].is_null() && !assignable(b["variadic"],a["variadic"])) return false;
  return assignable(a["returns"],b["returns"]);
}
const std::vector<std::string>& builtinNames() {
  static const std::vector<std::string> names{"print","喵","喵喵","len","喵長","str","喵字","number","喵數","type","喵型","sqrt","喵根","assert","喵驗","喵黏","喵重複","喵選","喵叫","讀行","讀","喵吃","讀數"}; return names;
}
Json builtinTypes() {
  Json t = Json::object(); auto any = primitive("any"), num = primitive("number"), str = primitive("string"), boolean = primitive("boolean"), nil = primitive("null");
  for (const auto& n : {"print","喵","喵喵"}) t[n] = functionType(Json::array(),nil,any);
  for (const auto& n : {"len","喵長"}) t[n] = functionType(Json::array({str}),num);
  for (const auto& n : {"str","喵字","type","喵型"}) t[n] = functionType(Json::array({any}),str);
  for (const auto& n : {"number","喵數"}) t[n] = functionType(Json::array({str}),num);
  for (const auto& n : {"sqrt","喵根"}) t[n] = functionType(Json::array({num}),num);
  for (const auto& n : {"assert","喵驗"}) t[n] = functionType(Json::array({boolean}),nil);
  t["喵黏"] = functionType(Json::array(),str,any); t["喵重複"] = functionType(Json::array({str,num}),str);
  t["喵選"] = functionType(Json::array({boolean,any,any}),any); t["喵叫"] = functionType(Json::array(),str);
  for (const auto& n : {"讀行","讀","喵吃","讀數"}) t[n] = functionType(Json::array(),any);
  return t;
}
Json checkProgram(Json& program) {
  Json builtins = Json::array(), functions = Json::array(); auto bt = builtinTypes(); for (auto& name : builtinNames()) builtins.push_back(bt[name]);
  std::vector<Json> scopes{builtins}; Json expected = primitive("any");
  auto compatible = [](const Json& a, const Json& b, const Json& span, const std::string& context) { if (!assignable(a,b)) fail(context+"：預期 "+typeName(b)+"，得到 "+typeName(a),span,"type"); };
  auto binding = [&](const Json& node) { return scopes[scopes.size()-1-node["address"]["depth"].get<size_t>()][node["address"]["slot"].get<size_t>()]; };
  struct Flow { bool normal = true, breaks = false, continues = false; };
  std::function<Flow(Json&)> visit;
  std::function<Json(Json&)> expression, functionBody;
  auto block = [&](Json& node, const Json& params) {
    Json local = Json::array(); for (size_t i = 0; i < node["layout"].size(); ++i) local.push_back(primitive("any"));
    for (size_t i = 0; i < params.size(); ++i) local[i] = annotation(params[i]);
    for (auto& s : node["body"]) {
      if (s["type"] == "Let") local[s["slot"].get<size_t>()] = annotation(s);
      if (s["type"] == "FunctionDecl") { auto slot = s["slot"].get<size_t>(); local[slot] = signature(s["fn"]); node["types"][slot] = local[slot]; }
    }
    scopes.push_back(local); Flow flow;
    for (auto& s : node["body"]) { auto next = visit(s); if (flow.normal) flow = {next.normal,flow.breaks || next.breaks,flow.continues || next.continues}; }
    scopes.pop_back(); return std::make_pair(flow,local);
  };
  functionBody = [&](Json& n) {
    Json old = expected; expected = annotation(n,"returnType"); auto fn = signature(n);
    functions.push_back(Json{{"name",n["name"]},{"type",typeName(fn)},{"span",n["span"]}});
    auto result = block(n["body"],n["params"]);
    if (result.first.normal) compatible(primitive("null"),expected,n["body"]["span"],"函式 '"+n["name"].get<std::string>()+"' 可能沒有回傳值");
    expected = old; return fn;
  };
  expression = [&](Json& n) -> Json {
    std::string t = n["type"];
    if (t == "Literal") return primitive(n["value"].is_null() ? "null" : n["value"].is_number() ? "number" : n["value"].is_string() ? "string" : "boolean");
    if (t == "Variable") return binding(n);
    if (t == "Assign" || t == "Update") {
      auto target = binding(n);
      if (n["address"]["depth"].get<size_t>() == scopes.size()-1) fail("無法指派內建函式 '"+n["name"].get<std::string>()+"'",n["nameSpan"],"type");
      if (t == "Update") { compatible(target,primitive("number"),n["span"],"運算子 '"+n["op"].get<std::string>()+"'"); return primitive("number"); }
      auto value = expression(n["value"]); compatible(value,target,n["value"]["span"],"指派給 '"+n["name"].get<std::string>()+"'"); return target["kind"] == "any" ? value : target;
    }
    if (t == "Function") return functionBody(n);
    std::string op = n.value("op",""); auto span = n.value("opSpan",n["span"]);
    if (t == "Unary") { auto e = primitive(op == "!" ? "boolean" : "number"); compatible(expression(n["value"]),e,span,"運算子 '"+op+"'"); return e; }
    if (t == "Logical") { compatible(expression(n["left"]),primitive("boolean"),span,"運算子 '"+op+"'"); compatible(expression(n["right"]),primitive("boolean"),span,"運算子 '"+op+"'"); return primitive("boolean"); }
    if (t == "Binary") {
      auto a = expression(n["left"]), b = expression(n["right"]);
      if (op == "==" || op == "!=") return primitive("boolean");
      if (op == "+") {
        auto valid = [](const Json& x) { return x["kind"] == "any" || x["kind"] == "number" || x["kind"] == "string"; };
        if (!valid(a) || !valid(b) || (a["kind"] != "any" && b["kind"] != "any" && a["kind"] != b["kind"])) fail("運算子 '+'：預期兩個數字或兩個字串，得到 "+typeName(a)+" 和 "+typeName(b),span,"type");
        return a["kind"] == "any" || b["kind"] == "any" ? primitive("any") : a;
      }
      compatible(a,primitive("number"),span,"運算子 '"+op+"'"); compatible(b,primitive("number"),span,"運算子 '"+op+"'");
      return primitive(op == "<" || op == "<=" || op == ">" || op == ">=" ? "boolean" : "number");
    }
    if (t == "Call") {
      auto callee = expression(n["callee"]); Json args = Json::array(); for (auto& a : n["args"]) args.push_back(expression(a));
      if (callee["kind"] == "any") return primitive("any");
      if (callee["kind"] != "function") fail("無法呼叫 "+typeName(callee),n["span"],"type");
      if (!acceptsArity(callee,args.size())) fail("呼叫預期 "+std::string(callee["variadic"].is_null() ? "" : "至少 ")+std::to_string(callee["params"].size())+" 個引數，得到 "+std::to_string(args.size()),n["span"],"type");
      for (size_t i = 0; i < args.size(); ++i) compatible(args[i],i < callee["params"].size() ? callee["params"][i] : callee["variadic"],n["args"][i]["span"],"第 "+std::to_string(i+1)+" 個引數");
      return callee["returns"];
    }
    throw std::logic_error("invalid expression " + t);
  };
  visit = [&](Json& n) -> Flow {
    std::string t = n["type"];
    if (t == "Let") compatible(expression(n["init"]),annotation(n),n["init"]["span"],"'"+n["name"].get<std::string>()+"' 的初始值");
    else if (t == "FunctionDecl") functionBody(n["fn"]);
    else if (t == "ExpressionStmt") expression(n["expression"]);
    else if (t == "StreamOut") { for (auto& value : n["values"]) expression(value); }
    else if (t == "StreamIn") {
      for (auto& target : n["targets"]) {
        if (target["address"]["depth"].get<size_t>() == scopes.size()-1) fail("無法指派內建函式 '"+target["name"].get<std::string>()+"'",target["span"],"type");
        auto type = binding(target); std::string kind = type["kind"];
        bool supported = n["mode"] == "line" ? kind == "any" || kind == "string" : kind == "any" || kind == "number" || kind == "string" || kind == "boolean";
        if (!supported) fail("喵in 不支援讀入 "+typeName(type),target["span"],"type");
      }
    }
    else if (t == "Block") return block(n,Json::array()).first;
    else if (t == "Return") { compatible(n["value"].is_null() ? primitive("null") : expression(n["value"]),expected,n["value"].is_null() ? n["span"] : n["value"]["span"],"回傳值"); return {false,false,false}; }
    else if (t == "Break") return {false,true,false};
    else if (t == "Continue") return {false,false,true};
    else if (t == "If") {
      compatible(expression(n["test"]),primitive("boolean"),n["test"]["span"],"if 條件"); auto a = visit(n["then"]), b = n["otherwise"].is_null() ? Flow{} : visit(n["otherwise"]);
      if (n["test"]["type"] == "Literal" && n["test"]["value"].is_boolean()) return n["test"]["value"].get<bool>() ? a : b;
      return {a.normal || b.normal,a.breaks || b.breaks,a.continues || b.continues};
    } else if (t == "While" || t == "For") {
      compatible(expression(n["test"]),primitive("boolean"),n["test"]["span"],"while 條件");
      if (n.contains("update") && !n["update"].is_null()) expression(n["update"]);
      auto body = visit(n["body"]); bool infinite = n["test"]["type"] == "Literal" && n["test"]["value"] == Json(true);
      return {infinite ? body.breaks : true,false,false};
    }
    return {};
  };
  auto result = block(program,Json::array()); Json globals = Json::array();
  for (size_t i = 0; i < program["layout"].size(); ++i) globals.push_back(Json{{"name",program["layout"][i]},{"type",typeName(result.second[i])}});
  return Json{{"ok",true},{"globals",globals},{"functions",functions}};
}
} // namespace itou
