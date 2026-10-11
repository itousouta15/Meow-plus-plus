#include "itou/core.hpp"

namespace itou {
Interpreter::Interpreter(Json program, const Json& options) : program_(std::move(program)), context(options) { globals_ = context.environment(program_["layout"],context.builtins(),program_["types"]); }
Value Interpreter::closure(const Json& n, Environment* env) {
  auto fn = std::make_shared<Function>(); fn->kind = "function"; fn->name = n["name"]; fn->arity = static_cast<int>(n["params"].size()); fn->code = n; fn->environment = env; fn->parameterTypes = signature(n)["params"]; fn->returnType = annotation(n,"returnType"); return Value(fn);
}
Interpreter::Signal Interpreter::body(const Json& statements, Environment* env) {
  for (auto& n : statements) if (n["type"] == "FunctionDecl") env->initialize(n["slot"].get<size_t>(),closure(n["fn"],env),n["span"]);
  for (auto& n : statements) { auto signal = statement(n,env); if (!signal.type.empty()) return signal; } return {};
}
Interpreter::Signal Interpreter::statement(const Json& n, Environment* env) {
  context.tick(n["span"]); std::string t = n["type"];
  if (t == "Let") env->initialize(n["slot"].get<size_t>(),expression(n["init"],env),n["init"]["span"]);
  else if (t == "Block") return body(n["body"],context.environment(n["layout"],env,n["types"]));
  else if (t == "ExpressionStmt") expression(n["expression"],env);
  else if (t == "StreamOut") { for (auto& value : n["values"]) context.write(n["channel"],display(expression(value,env)),value["span"]); }
  else if (t == "StreamIn") { for (auto& target : n["targets"]) { context.tick(target["span"]); context.extract(env,target["address"],n["mode"],target["span"]); } }
  else if (t == "If") { if (boolean(expression(n["test"],env),n["test"]["span"])) return statement(n["then"],env); if (!n["otherwise"].is_null()) return statement(n["otherwise"],env); }
  else if (t == "While" || t == "For") {
    while (boolean(expression(n["test"],env),n["test"]["span"])) {
      auto signal = statement(n["body"],env); if (signal.type == "Return") return signal; if (signal.type == "Break") break;
      if (n.contains("update") && !n["update"].is_null()) expression(n["update"],env);
    }
  } else if (t == "Return") return {"Return",n["value"].is_null() ? Value{} : expression(n["value"],env),n["span"]};
  else if (t == "Break" || t == "Continue") return {t,{},nullptr};
  return {};
}
Value Interpreter::expression(const Json& n, Environment* env) {
  context.tick(n["span"]); std::string t = n["type"]; auto span = n["span"];
  if (t == "Literal") return Value(n["value"]);
  if (t == "Variable") return env->get(n["address"],span);
  if (t == "Assign") return env->set(n["address"],expression(n["value"],env),n["nameSpan"]);
  if (t == "Update") { auto old = env->get(n["address"],n["nameSpan"]); auto value = env->set(n["address"],binary(n["op"] == "++" ? "+" : "-",old,Value(1),span),n["nameSpan"]); return n["prefix"].get<bool>() ? value : old; }
  if (t == "Unary") return unary(n["op"],expression(n["value"],env),n["opSpan"]);
  if (t == "Binary") { auto a = expression(n["left"],env), b = expression(n["right"],env); return binary(n["op"],a,b,n["opSpan"]); }
  if (t == "Logical") { bool a = boolean(expression(n["left"],env),n["opSpan"]); if ((n["op"] == "and" && !a) || (n["op"] == "or" && a)) return Value(a); return Value(boolean(expression(n["right"],env),n["opSpan"])); }
  if (t == "Function") return closure(n,env);
  if (t == "Call") {
    auto target = expression(n["callee"],env); std::vector<Value> args; for (auto& a : n["args"]) args.push_back(expression(a,env)); auto call = prepareCall(target,args,span); auto fn = call.callee;
    if (fn->kind == "builtin") return finishCall(call,context.builtin(fn->name,call.args,span),span);
    if (calls_.size() >= context.maxDepth) fail("呼叫深度超過上限",span,"limit"); calls_.push_back(Json{{"name",fn->name},{"span",span}});
    try {
      auto& b = fn->code["body"]; auto* local = context.environment(b["layout"],fn->environment,b["types"]);
      for (size_t i = 0; i < args.size(); ++i) local->initialize(i,call.args[i],span);
      auto signal = body(b["body"],local); auto value = finishCall(call,signal.value,signal.type.empty() ? b["span"] : signal.span); calls_.erase(calls_.end()-1); return value;
    } catch (Error& error) { if (error.diagnostic["frames"].empty()) error.diagnostic["frames"] = calls_; calls_.erase(calls_.end()-1); throw; }
  }
  throw std::logic_error("invalid expression " + t);
}
Json Interpreter::run() { body(program_["body"],globals_); context.finishOutput(); return Json{{"output",context.output},{"stdout",context.stdoutText},{"stderr",context.stderrText},{"globals",globalValues(globals_)},{"steps",context.steps},{"engine","tree"}}; }
} // namespace itou
