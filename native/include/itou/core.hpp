#pragma once
#include <nlohmann/json.hpp>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace itou {
using Json = nlohmann::ordered_json;
struct Error : std::runtime_error {
  Json diagnostic;
  Error(std::string message, Json span = nullptr, std::string phase = "runtime")
    : std::runtime_error(message), diagnostic{{"phase", phase}, {"message", message}, {"span", span}, {"frames", Json::array()}} {}
};
[[noreturn]] inline void fail(const std::string& message, const Json& span, const std::string& phase = "runtime") { throw Error(message, span, phase); }
inline Json primitive(const std::string& kind) { return Json{{"kind", kind}}; }
inline Json annotation(const Json& node, const char* key = "annotation") { return node.contains(key) && !node[key].is_null() ? node[key] : primitive("any"); }
Json functionType(const Json& params, const Json& returns, Json variadic = nullptr);
Json signature(const Json& node);
std::string typeName(const Json& type);
bool assignable(const Json& actual, const Json& expected);
bool acceptsArity(const Json& type, size_t count);
const Json& primitiveTypes();
const std::vector<std::string>& builtinNames();
Json builtinTypes();
Json tokenize(const std::string& source);
Json parse(const std::string& source);
Json resolve(Json program);
Json checkProgram(Json& program);
Json analyze(const std::string& source, const Json& options = Json::object());
Json compileAst(const Json& program);
std::string disassemble(const Json& proto);
Json request(const Json& message);
std::string formatDiagnostic(const Json& error, const std::string& source, const std::string& filename);
size_t utf16Length(const std::string& text);

struct Environment;
struct Function;
struct Value {
  Json data = nullptr;
  std::shared_ptr<Function> function;
  bool pending = false;
  Value() = default;
  Value(Json value) : data(std::move(value)) {}
  explicit Value(std::shared_ptr<Function> fn) : function(std::move(fn)) {}
};
struct Function {
  std::string kind, name;
  int arity = 0;
  Json code, parameterTypes, returnType = primitive("any"), contract;
  Environment* environment = nullptr;
  std::shared_ptr<Function> target;
  int contractDepth = 0;
};
struct Environment {
  Json names, types;
  std::vector<Value> cells;
  Environment* parent;
  Environment(Json names, Environment* parent, Json types);
  Environment* ancestor(int depth);
  Value get(const Json& address, const Json& span);
  Value set(const Json& address, Value value, const Json& span);
  void initialize(size_t slot, Value value, const Json& span);
  Json snapshot() const;
};
struct Context {
  size_t steps = 0, maxSteps, maxDepth, maxOutput, outputSize = 0, readOffset = 0;
  Json output = Json::array();
  std::string input, stdoutText, stderrText, pendingOut;
  // One execution owns every environment. Closures refer into this arena, so
  // recursive closures do not form shared_ptr cycles; destruction frees all scopes.
  std::vector<std::unique_ptr<Environment>> environments;
  explicit Context(const Json& options);
  Environment* environment(Json names, Environment* parent = nullptr, Json types = Json::array());
  Environment* builtins();
  void tick(const Json& span);
  void emit(const std::string& text, const Json& span);
  void write(const std::string& channel, const std::string& text, const Json& span);
  void finishOutput();
  void extract(Environment* env, const Json& address, const std::string& mode, const Json& span);
  Value builtin(const std::string& name, const std::vector<Value>& args, const Json& span);
};
std::string typeOf(const Value& value);
std::string display(const Value& value);
std::string inspect(const Value& value);
bool boolean(const Value& value, const Json& span);
Value unary(const std::string& op, const Value& value, const Json& span);
Value binary(const std::string& op, const Value& a, const Value& b, const Json& span);
Value guardType(const Json& type, Value value, const Json& span);
Json globalValues(const Environment* env);
struct Call {
  std::shared_ptr<Function> callee;
  std::vector<Value> args;
  std::vector<Json> contracts;
  Json span;
};
Call prepareCall(Value callee, std::vector<Value> args, const Json& span);
Value finishCall(const Call& call, Value value, const Json& span);

class VM {
  struct Frame { Json proto; size_t ip = 0; Environment* env; size_t base = 0; Json callSpan; Call call; size_t id = 0; };
  Json proto_, lastSpan_, error_ = nullptr;
  std::vector<Frame> frames_;
  std::vector<Value> stack_;
  Environment* globals_;
  size_t nextId_ = 1;
  Value pop();
public:
  Context context;
  bool done = false;
  VM(Json proto, const Json& options = Json::object());
  Json location() const;
  bool step();
  Json run();
  Json stepLine();
  Json resume(const Json& breakpoints);
  Json snapshot() const;
};
class Interpreter {
  Json program_, calls_ = Json::array();
  Environment* globals_;
  struct Signal { std::string type; Value value; Json span; };
  Value closure(const Json& node, Environment* env);
  Signal body(const Json& statements, Environment* env);
  Signal statement(const Json& node, Environment* env);
  Value expression(const Json& node, Environment* env);
public:
  Context context;
  Interpreter(Json program, const Json& options = Json::object());
  Json run();
};
} // namespace itou
