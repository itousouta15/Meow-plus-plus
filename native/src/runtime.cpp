#include "itou/core.hpp"
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <regex>

namespace itou {
std::string typeOf(const Value& v) { return v.function ? "function" : v.data.is_null() ? "null" : v.data.is_boolean() ? "boolean" : v.data.is_number() ? "number" : "string"; }
std::string display(const Value& v) {
  if (v.pending) return "<uninitialized>";
  if (v.function) return "<fn " + v.function->name + ">";
  if (v.data.is_string()) return v.data.get<std::string>();
  if (!v.data.is_number()) return v.data.dump();
  double n = v.data.get<double>(); if (n == 0) return "0";
  char buffer[64]; auto result = std::to_chars(buffer,buffer+sizeof(buffer),n);
  std::string text(buffer,result.ptr);
  auto exp = text.find('e');
  if (exp != std::string::npos && std::abs(n) >= 1e-6 && std::abs(n) < 1e21) {
    int power = std::stoi(text.substr(exp+1)); std::string digits = text.substr(0,exp); bool negative = digits[0] == '-';
    if (negative) digits.erase(0,1);
    auto dot = digits.find('.'); int position = static_cast<int>(dot == std::string::npos ? digits.size() : dot) + power;
    if (dot != std::string::npos) digits.erase(dot,1);
    if (position <= 0) digits = "0." + std::string(-position,'0') + digits;
    else if (position >= static_cast<int>(digits.size())) digits += std::string(position-digits.size(),'0');
    else digits.insert(static_cast<size_t>(position),".");
    text = (negative ? "-" : "") + digits;
  } else if (exp != std::string::npos) {
    int power = std::stoi(text.substr(exp+1)); text = text.substr(0,exp) + "e" + (power >= 0 ? "+" : "") + std::to_string(power);
  }
  return text;
}
std::string inspect(const Value& v) { return !v.function && v.data.is_string() ? v.data.dump() : display(v); }
bool boolean(const Value& v, const Json& span) { if (v.function || !v.data.is_boolean()) fail("預期 boolean，得到 "+typeOf(v),span); return v.data.get<bool>(); }
static double numeric(const Value& v, const Json& span) { if (v.function || !v.data.is_number()) fail("預期 number，得到 "+typeOf(v),span); return v.data.get<double>(); }
static Value finite(double n, const Json& span) { if (!std::isfinite(n)) fail("數值結果不是有限的",span); return Value(n); }
Value unary(const std::string& op, const Value& v, const Json& span) { return op == "!" ? Value(!boolean(v,span)) : finite(-numeric(v,span),span); }
static std::shared_ptr<Function> underlying(std::shared_ptr<Function> fn) { while (fn && fn->kind == "contract") fn = fn->target; return fn; }
Value binary(const std::string& op, const Value& a, const Value& b, const Json& span) {
  if (op == "==" || op == "!=") { bool same = typeOf(a) == typeOf(b) && (a.function ? underlying(a.function) == underlying(b.function) : a.data == b.data); return Value(op == "==" ? same : !same); }
  if (op == "+" && typeOf(a) == "string" && typeOf(b) == "string") {
    std::string text = a.data.get<std::string>() + b.data.get<std::string>(); if (utf16Length(text) > 65536) fail("字串超過 65536 個碼元",span,"limit"); return Value(text);
  }
  double x = numeric(a,span), y = numeric(b,span);
  if (op == "+") return finite(x+y,span);
  if (op == "-") return finite(x-y,span);
  if (op == "*") return finite(x*y,span);
  if (op == "/" || op == "%") { if (y == 0) fail(op == "/" ? "除以零" : "對零取餘數",span); return finite(op == "/" ? x/y : std::fmod(x,y),span); }
  if (op == "<") return Value(x < y);
  if (op == "<=") return Value(x <= y);
  if (op == ">") return Value(x > y);
  if (op == ">=") return Value(x >= y);
  throw std::logic_error("unknown binary operator");
}
Value guardType(const Json& type, Value value, const Json& span) {
  if (type["kind"] == "any") return value;
  if (type["kind"] != typeOf(value)) fail("型別契約：預期 "+typeName(type)+"，得到 "+typeOf(value),span);
  if (type["kind"] != "function") return value;
  auto fn = value.function;
  if (fn->arity >= 0 && !acceptsArity(type,static_cast<size_t>(fn->arity))) fail("型別契約：預期 "+typeName(type)+"，得到有 "+std::to_string(fn->arity)+" 個參數的函式",span);
  if (fn->kind == "contract" && fn->contract == type) return value;
  if (fn->contractDepth >= 64) fail("函式契約巢狀深度超過上限",span,"limit");
  auto wrapper = std::make_shared<Function>(); wrapper->kind = "contract"; wrapper->name = fn->name;
  wrapper->arity = static_cast<int>(type["params"].size()); wrapper->target = fn; wrapper->contract = type; wrapper->contractDepth = fn->contractDepth+1; return Value(wrapper);
}
Environment::Environment(Json names, Environment* parent, Json types) : names(std::move(names)), types(std::move(types)), parent(parent) {
  cells.resize(this->names.size()); for (auto& v : cells) v.pending = true;
  while (this->types.size() < cells.size()) this->types.push_back(primitive("any"));
}
Environment* Environment::ancestor(int depth) { auto* env = this; while (depth-- > 0 && env) env = env->parent; if (!env) throw std::logic_error("invalid lexical address"); return env; }
Value Environment::get(const Json& a, const Json& span) {
  auto value = ancestor(a["depth"])->cells.at(a["slot"].get<size_t>());
  if (value.pending) fail("在初始化前無法存取 '"+a["name"].get<std::string>()+"'",span); return value;
}
Value Environment::set(const Json& a, Value value, const Json& span) {
  auto* env = ancestor(a["depth"]); auto slot = a["slot"].get<size_t>();
  if (env->cells.at(slot).pending) fail("在初始化前無法指派 '"+a["name"].get<std::string>()+"'",span);
  if (!env->parent) fail("無法指派內建函式 '"+a["name"].get<std::string>()+"'",span);
  value = guardType(env->types[slot],value,span); env->cells[slot] = value; return value;
}
void Environment::initialize(size_t slot, Value value, const Json& span) {
  if (!cells.at(slot).pending) throw std::logic_error("binding initialized twice"); cells[slot] = guardType(types[slot],value,span);
}
Json Environment::snapshot() const {
  Json out = Json::array(); for (size_t i = 0; i < cells.size(); ++i) out.push_back(Json{{"name",names[i]},{"value",inspect(cells[i])},{"type",cells[i].pending ? "pending" : typeOf(cells[i])},{"declaredType",typeName(types[i])}}); return out;
}
Json globalValues(const Environment* env) {
  Json out = Json::object(); for (size_t i = 0; i < env->cells.size(); ++i) { auto& v = env->cells[i]; out[env->names[i].get<std::string>()] = v.pending || v.function ? Json(display(v)) : v.data; } return out;
}
Context::Context(const Json& o) : maxSteps(o.value("maxSteps",size_t(1000000))), maxDepth(o.value("maxDepth",size_t(100))), maxOutput(o.value("maxOutput",size_t(100000))), input(o.value("input",std::string{})) {
  for (const auto& name : {"maxSteps","maxDepth","maxOutput"}) if (o.contains(name) && (!o[name].is_number_integer() || o[name].get<double>() < 1 || o[name].get<double>() > 9007199254740991.0)) throw std::invalid_argument(std::string(name)+" must be a positive safe integer");
  if (maxDepth > 100) throw std::invalid_argument("maxDepth must be at most 100");
}
Environment* Context::environment(Json names, Environment* parent, Json types) { environments.push_back(std::make_unique<Environment>(names,parent,types)); return environments.back().get(); }
Environment* Context::builtins() {
  Json names = builtinNames(), types = builtinTypes(); auto* env = environment(names);
  for (size_t i = 0; i < names.size(); ++i) {
    std::string name = names[i]; auto fn = std::make_shared<Function>(); fn->kind = "builtin"; fn->name = name;
    fn->arity = types[name]["variadic"].is_null() ? static_cast<int>(types[name]["params"].size()) : -1;
    env->initialize(i,Value(fn),nullptr);
  }
  return env;
}
void Context::tick(const Json& span) { if (++steps > maxSteps) fail("執行超過 "+std::to_string(maxSteps)+" 步",span,"limit"); }
void Context::emit(const std::string& text, const Json& span) {
  size_t size = utf16Length(text)+1; if (outputSize + size > maxOutput) fail("輸出超過上限",span,"limit");
  stdoutText += text + "\n"; output.push_back(pendingOut + text); pendingOut.clear(); outputSize += size;
}
void Context::write(const std::string& channel, const std::string& text, const Json& span) {
  size_t size = utf16Length(text); if (outputSize + size > maxOutput) fail("輸出超過上限",span,"limit");
  outputSize += size;
  if (channel == "stderr") { stderrText += text; return; }
  stdoutText += text;
  size_t start = 0, end;
  while ((end = text.find('\n',start)) != std::string::npos) {
    output.push_back(pendingOut + text.substr(start,end-start)); pendingOut.clear(); start = end+1;
  }
  pendingOut += text.substr(start);
}
void Context::finishOutput() { if (!pendingOut.empty()) { output.push_back(pendingOut); pendingOut.clear(); } }
void Context::extract(Environment* env, const Json& address, const std::string& mode, const Json& span) {
  env->get(address,span); // Reject access before declaration, before consuming input.
  auto* target = env->ancestor(address["depth"]);
  if (!target->parent) fail("無法指派內建函式 '"+address["name"].get<std::string>()+"'",span);
  std::string kind = target->types[address["slot"].get<size_t>()]["kind"];
  bool supported = mode == "line" ? kind == "any" || kind == "string" : kind == "any" || kind == "number" || kind == "string" || kind == "boolean";
  if (!supported) fail("喵in 不支援讀入 "+typeName(target->types[address["slot"].get<size_t>()]),span);
  auto value = builtin(mode == "line" ? "讀行" : "讀",{},span);
  if (value.data.is_null()) fail("喵in 輸入不足",span);
  std::string text = value.data;
  if (utf16Length(text) > 65536) fail("字串超過 65536 個碼元",span,"limit");
  if (kind == "number") {
    static const std::regex decimal("^-?(?:[0-9]+(?:\\.[0-9]+)?)(?:[eE][+-]?[0-9]+)?$");
    if (!std::regex_match(text,decimal)) fail("喵in 預期數字，得到 '"+text+"'",span);
    value = finite(std::strtod(text.c_str(),nullptr),span);
  } else if (kind == "boolean") {
    if (text == "true" || text == "真" || text == "1") value = Value(Json(true));
    else if (text == "false" || text == "假" || text == "0") value = Value(Json(false));
    else fail("喵in 預期布林值，得到 '"+text+"'",span);
  }
  env->set(address,value,span);
}
Value Context::builtin(const std::string& name, const std::vector<Value>& a, const Json& span) {
  if (name == "print" || name == "喵" || name == "喵喵" || name == "喵黏") {
    std::string text = name == "喵喵" ? "喵～ " : ""; for (size_t i = 0; i < a.size(); ++i) { if (i && name != "喵黏") text += " "; text += display(a[i]); }
    if (name == "喵黏") { if (utf16Length(text) > 65536) fail("字串超過 65536 個碼元",span,"limit"); return Value(text); }
    emit(text,span); return {};
  }
  if (name == "len" || name == "喵長") {
    if (typeOf(a[0]) != "string") fail("len 預期字串，得到 "+typeOf(a[0]),span);
    size_t count = 0; for (unsigned char c : a[0].data.get<std::string>()) if ((c & 0xc0) != 0x80) ++count; return Value(count);
  }
  if (name == "str" || name == "喵字") return Value(display(a[0]));
  if (name == "type" || name == "喵型") return Value(typeOf(a[0]));
  if (name == "sqrt" || name == "喵根") return finite(std::sqrt(numeric(a[0],span)),span);
  if (name == "assert" || name == "喵驗") { if (!boolean(a[0],span)) fail("斷言失敗",span); return {}; }
  static const std::regex decimal("^-?(?:[0-9]+(?:\\.[0-9]+)?)(?:[eE][+-]?[0-9]+)?$");
  auto number = [&](const std::string& text) { return finite(std::strtod(text.c_str(),nullptr),span); };
  if (name == "number" || name == "喵數") { if (typeOf(a[0]) != "string" || !std::regex_match(a[0].data.get<std::string>(),decimal)) fail("number 預期十進位數字字串",span); return number(a[0].data); }
  if (name == "喵重複") {
    if (typeOf(a[0]) != "string") fail("喵重複 預期字串，得到 "+typeOf(a[0]),span);
    if (typeOf(a[1]) != "number") fail("喵重複 的次數必須是非負整數",span);
    double times = a[1].data; if (times < 0 || std::floor(times) != times) fail("喵重複 的次數必須是非負整數",span);
    std::string text = a[0].data; if (utf16Length(text) * times > 65536) fail("字串超過 65536 個碼元",span,"limit");
    if (text.empty()) return Value(""); std::string result; for (size_t i = 0; i < static_cast<size_t>(times); ++i) result += text; return Value(result);
  }
  if (name == "喵選") return boolean(a[0],span) ? a[1] : a[2];
  if (name == "喵叫") return Value("喵～");
  if (name == "讀行") {
    if (readOffset >= input.size()) return {};
    size_t end = input.find('\n',readOffset); if (end == std::string::npos) end = input.size(); std::string line = input.substr(readOffset,end-readOffset); if (!line.empty() && line.back() == '\r') line.pop_back(); readOffset = end+1; return Value(line);
  }
  if (name == "讀" || name == "喵吃" || name == "讀數") {
    auto whitespace = [](unsigned char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; };
    while (readOffset < input.size() && whitespace(input[readOffset])) ++readOffset;
    if (readOffset >= input.size()) return {};
    size_t start = readOffset; while (readOffset < input.size() && !whitespace(input[readOffset])) ++readOffset;
    std::string token = input.substr(start,readOffset-start); if (name != "讀數") return Value(token);
    if (!std::regex_match(token,decimal)) fail("讀數 預期數字，得到 '"+token+"'",span); return number(token);
  }
  throw std::logic_error("unknown builtin");
}
Call prepareCall(Value value, std::vector<Value> args, const Json& span) {
  Call call; call.span = span;
  auto check = [&](const std::shared_ptr<Function>& fn) { if (!fn) fail("無法呼叫 "+typeOf(value),span); if (fn->arity >= 0 && static_cast<size_t>(fn->arity) != args.size()) fail(fn->name+" 預期 "+std::to_string(fn->arity)+" 個引數，得到 "+std::to_string(args.size()),span); };
  auto fn = value.function;
  while (fn && fn->kind == "contract") { check(fn); for (size_t i = 0; i < args.size(); ++i) args[i] = guardType(fn->contract["params"][i],args[i],span); call.contracts.push_back(fn->contract["returns"]); fn = fn->target; }
  check(fn); if (fn->kind == "function") for (size_t i = 0; i < args.size(); ++i) args[i] = guardType(fn->parameterTypes[i],args[i],span);
  call.callee = fn; call.args = std::move(args); return call;
}
Value finishCall(const Call& call, Value value, const Json& span) {
  value = guardType(call.callee->returnType,value,span); for (size_t i = call.contracts.size(); i-- > 0;) value = guardType(call.contracts[i],value,call.span); return value;
}
} // namespace itou
