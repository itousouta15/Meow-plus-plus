#include "itou/core.hpp"
#include <algorithm>

namespace itou {
VM::VM(Json proto, const Json& options) : proto_(std::move(proto)), lastSpan_(proto_["span"]), context(options) {
  globals_ = context.environment(proto_["layout"],context.builtins(),proto_["types"]);
  frames_.push_back({proto_,0,globals_,0,proto_["span"],{},0});
}
Value VM::pop() { if (stack_.empty()) throw std::logic_error("VM stack underflow"); auto v = stack_.back(); stack_.pop_back(); return v; }
Json VM::location() const {
  if (!error_.is_null() && !error_["span"].is_null()) return error_["span"];
  if (!done && !frames_.empty()) { auto& f = frames_.back(); if (f.ip < f.proto["code"].size()) return f.proto["code"][f.ip]["span"]; }
  return lastSpan_;
}
bool VM::step() {
  if (done) return false;
  auto& f = frames_.back(); auto ins = f.proto["code"].at(f.ip); auto span = ins["span"], arg = ins["arg"]; std::string op = ins["op"]; lastSpan_ = span;
  try {
    context.tick(span); ++f.ip;
    if (op == "CONST") stack_.emplace_back(f.proto["constants"][arg.get<size_t>()]);
    else if (op == "POP") pop();
    else if (op == "DUP") stack_.push_back(stack_.back());
    else if (op == "LOAD") stack_.push_back(f.env->get(arg,span));
    else if (op == "STORE") stack_.back() = f.env->set(arg,stack_.back(),span);
    else if (op == "INIT") f.env->initialize(arg.get<size_t>(),pop(),span);
    else if (op == "WRITE") context.write(arg,display(pop()),span);
    else if (op == "READ") context.extract(f.env,arg["address"],arg["mode"],span);
    else if (op == "ENTER") f.env = context.environment(arg["names"],f.env,arg["types"]);
    else if (op == "LEAVE") f.env = f.env->parent;
    else if (op == "UNWIND") for (int i = 0; i < arg.get<int>(); ++i) f.env = f.env->parent;
    else if (op == "UNARY") stack_.push_back(unary(arg,pop(),span));
    else if (op == "BINARY") { auto b = pop(), a = pop(); stack_.push_back(binary(arg,a,b,span)); }
    else if (op == "BOOL") boolean(stack_.back(),span);
    else if (op == "JUMP") f.ip = arg.get<size_t>();
    else if (op == "JUMP_FALSE" || op == "JUMP_TRUE") { if (boolean(pop(),span) == (op == "JUMP_TRUE")) f.ip = arg.get<size_t>(); }
    else if (op == "CLOSURE") {
      auto fn = std::make_shared<Function>(); fn->kind = "function"; fn->name = arg["name"]; fn->arity = static_cast<int>(arg["params"].size()); fn->code = arg; fn->environment = f.env; fn->parameterTypes = arg["parameterTypes"]; fn->returnType = arg["returnType"]; stack_.emplace_back(fn);
    } else if (op == "CALL") {
      size_t count = arg.get<size_t>(); std::vector<Value> args(count); for (size_t i = count; i-- > 0;) args[i] = pop(); auto call = prepareCall(pop(),args,span);
      if (call.callee->kind == "builtin") stack_.push_back(finishCall(call,context.builtin(call.callee->name,call.args,span),span));
      else {
        if (frames_.size()-1 >= context.maxDepth) fail("呼叫深度超過上限",span,"limit");
        auto& proto = call.callee->code; auto* local = context.environment(proto["layout"],call.callee->environment,proto["types"]);
        for (size_t i = 0; i < args.size(); ++i) local->initialize(i,call.args[i],span);
        frames_.push_back({proto,0,local,stack_.size(),span,call,nextId_++});
      }
    } else if (op == "RETURN") {
      auto value = finishCall(f.call,pop(),span); stack_.resize(f.base); frames_.pop_back(); if (frames_.empty()) throw std::logic_error("VM return from script"); stack_.push_back(value);
    } else if (op == "HALT") { if (frames_.size() != 1 || !stack_.empty()) throw std::logic_error("VM unbalanced stack at halt"); context.finishOutput(); done = true; }
    else throw std::logic_error("unknown opcode " + op);
  } catch (Error& error) {
    context.finishOutput();
    if (error.diagnostic["frames"].empty()) for (size_t i = 1; i < frames_.size(); ++i) error.diagnostic["frames"].push_back(Json{{"name",frames_[i].proto["name"]},{"span",frames_[i].callSpan}});
    error_ = error.diagnostic; done = true; throw;
  }
  return !done;
}
Json VM::run() { while (!done) step(); if (!error_.is_null()) throw Error(error_["message"],error_["span"],error_["phase"]); return Json{{"output",context.output},{"stdout",context.stdoutText},{"stderr",context.stderrText},{"globals",globalValues(globals_)},{"steps",context.steps},{"engine","vm"}}; }
Json VM::stepLine() {
  if (done) return snapshot(); auto line = location()["line"]; auto id = frames_.back().id; size_t ip = frames_.back().ip;
  do { step(); if (done || frames_.back().id != id || location()["line"] != line || frames_.back().ip <= ip) break; ip = frames_.back().ip; } while (!done); return snapshot();
}
Json VM::resume(const Json& breakpoints) { do { stepLine(); } while (!done && std::find(breakpoints.begin(),breakpoints.end(),location()["line"]) == breakpoints.end()); return snapshot(); }
Json VM::snapshot() const {
  Json scopes = Json::array(), frames = Json::array(), stack = Json::array();
  if (!frames_.empty()) for (auto* env = frames_.back().env; env && env->parent; env = env->parent) scopes.push_back(env->snapshot());
  for (auto& f : frames_) frames.push_back(Json{{"name",f.proto["name"]},{"ip",f.ip},{"line",f.ip < f.proto["code"].size() ? f.proto["code"][f.ip]["span"]["line"] : f.callSpan["line"]}});
  for (auto& v : stack_) stack.push_back(inspect(v));
  Json instruction = nullptr; if (!done) { auto& f = frames_.back(); instruction = Json{{"index",f.ip},{"op",f.proto["code"][f.ip]["op"]},{"functionId",f.proto["id"]}}; }
  return Json{{"done",done},{"steps",context.steps},{"location",location()},{"instruction",instruction},{"stack",stack},{"frames",frames},{"scopes",scopes},{"output",context.output},{"stdout",context.stdoutText},{"stderr",context.stderrText},{"globals",globalValues(globals_)}};
}
} // namespace itou
