#include "itou/core.hpp"
#include <cmath>
#include <cstdlib>
#include <functional>
#include <map>
#include <set>

namespace itou {
size_t utf16Length(const std::string& text) {
  size_t count = 0;
  for (unsigned char c : text) if ((c & 0xc0) != 0x80) count += c >= 0xf0 ? 2 : 1;
  return count;
}
Json tokenize(const std::string& source) {
  if (utf16Length(source) > 262144) fail("原始碼超過 256 Ki 個 UTF-16 碼元", nullptr, "limit");
  const std::set<std::string> keywords{"let","fn","if","else","while","for","return","break","continue","true","false","null","and","or"};
  const std::map<std::string,std::string> aliases{{"令","let"},{"設","let"},{"函式","fn"},{"函","fn"},{"如果","if"},{"若","if"},{"否則","else"},{"當","while"},{"迴圈","for"},{"對於","for"},{"回傳","return"},{"返回","return"},{"中斷","break"},{"跳出","break"},{"繼續","continue"},{"真","true"},{"假","false"},{"空","null"},{"且","and"},{"並且","and"},{"或","or"},{"或者","or"}};
  const std::set<std::string> pairs{"==","!=","<=",">=","->","&&","||","++","--","+=","-=","*=","/=","%=","<<",">>"};
  Json tokens = Json::array();
  size_t at = 0, offset = 0, line = 1, column = 1;
  auto location = [&]() { return Json{{"start",offset},{"end",offset},{"line",line},{"column",column}}; };
  auto advance = [&]() {
    unsigned char c = static_cast<unsigned char>(source[at++]);
    if (c == '\n') { ++line; column = 1; ++offset; }
    else if ((c & 0xc0) != 0x80) { size_t units = c >= 0xf0 ? 2 : 1; offset += units; column += units; }
    return c;
  };
  auto push = [&](std::string kind, Json value, Json span) {
    span["end"] = offset;
    tokens.push_back(Json{{"kind",kind},{"value",value},{"span",span}});
    if (tokens.size() > 50000) fail("原始碼的 token 數量過多", span, "limit");
  };
  auto digit = [&](size_t i) { return i < source.size() && source[i] >= '0' && source[i] <= '9'; };
  auto codepoint = [&](size_t i) -> unsigned {
    if (i >= source.size()) return 0;
    unsigned char c = source[i]; if (c < 128) return c;
    size_t width = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : 2;
    if (i+width > source.size()) return 0xfffd;
    unsigned value = c & (width == 4 ? 7 : width == 3 ? 15 : 31);
    for (size_t j = 1; j < width; ++j) value = (value << 6) | (static_cast<unsigned char>(source[i+j]) & 63);
    return value;
  };
  auto alpha = [&](size_t i) {
    if (i >= source.size()) return false;
    unsigned c = codepoint(i);
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' ||
      (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfa6d) || (c >= 0xfa70 && c <= 0xfad9) ||
      c == 0x3005 || c == 0x3007 || (c >= 0x3021 && c <= 0x3029) || (c >= 0x3038 && c <= 0x303b);
  };
  auto advanceCharacter = [&]() { advance(); while (at < source.size() && (static_cast<unsigned char>(source[at]) & 0xc0) == 0x80) advance(); };
  while (at < source.size()) {
    char c = source[at];
    unsigned cp = codepoint(at);
    if (cp == 0xa0 || cp == 0xfeff || cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp == 0x2028 || cp == 0x2029 || cp == 0x202f || cp == 0x205f || cp == 0x3000) { advanceCharacter(); continue; }
    if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' || c == '\v') { advance(); continue; }
    if (source.compare(at,2,"//") == 0) { while (at < source.size() && source[at] != '\n') advance(); continue; }
    Json span = location(); size_t start = at;
    if (source.compare(at,2,"/*") == 0) {
      advance(); advance(); int depth = 1;
      while (at < source.size() && depth > 0) {
        if (source.compare(at,2,"/*") == 0) { advance(); advance(); ++depth; }
        else if (source.compare(at,2,"*/") == 0) { advance(); advance(); --depth; }
        else advance();
      }
      if (depth) fail("區塊註解沒有結束",span,"lex");
      continue;
    }
    if (alpha(at)) {
      while (alpha(at) || digit(at)) advanceCharacter();
      std::string text = source.substr(start, at-start);
      push(keywords.count(text) ? text : aliases.count(text) ? aliases.at(text) : "identifier",text,span); continue;
    }
    if (digit(at)) {
      while (digit(at)) advance();
      if (at < source.size() && source[at] == '.' && digit(at+1)) { advance(); while (digit(at)) advance(); }
      if (at < source.size() && (source[at] == 'e' || source[at] == 'E')) {
        advance(); if (at < source.size() && (source[at] == '+' || source[at] == '-')) advance();
        if (!digit(at)) { span["end"] = offset; fail("指數部分缺少數字",span,"lex"); }
        while (digit(at)) advance();
      }
      double value = std::strtod(source.substr(start,at-start).c_str(),nullptr);
      if (!std::isfinite(value)) { span["end"] = offset; fail("數字常值必須是有限的",span,"lex"); }
      push("number",value,span); continue;
    }
    if (c == '"') {
      advance(); bool closed = false;
      while (at < source.size()) {
        if (source[at] == '"') { advance(); closed = true; break; }
        if (source[at] == '\n' || source[at] == '\r') fail("字串中出現換行；請使用 \\n",span,"lex");
        if (advance() == '\\' && at < source.size()) {
          if (source[at] == '\n' || source[at] == '\r') fail("字串中出現換行；請使用 \\n",span,"lex");
          advance();
        }
      }
      if (!closed) fail("字串沒有結束",span,"lex");
      Json value;
      try { value = Json::parse(source.substr(start,at-start)); } catch (...) { span["end"] = offset; fail("無效的字串跳脫序列（請使用 JSON 風格）",span,"lex"); }
      if (utf16Length(value.get<std::string>()) > 65536) fail("字串超過 65536 個碼元",span,"limit");
      push("string",value,span); continue;
    }
    std::string pair = source.substr(at,2);
    if (pairs.count(pair)) { advance(); advance(); push(pair == "&&" ? "and" : pair == "||" ? "or" : pair,pair,span); continue; }
    if (std::string("(){}[]&;,:+-*/%!=<>").find(c) != std::string::npos) { advance(); push(std::string(1,c),std::string(1,c),span); continue; }
    advanceCharacter(); span["end"] = offset; fail("未預期的字元 " + Json(source.substr(start,at-start)).dump(),span,"lex");
  }
  push("eof",nullptr,location()); return tokens;
}

namespace {
Json between(const Json& first, const Json& last) { Json span = first["span"]; span["end"] = last["span"]["end"]; return span; }
class Parser {
  Json tokens; size_t at = 0; int depth = 0;
  struct Guard { Parser& p; explicit Guard(Parser& p) : p(p) { if (++p.depth > 80) fail("語法巢狀層級過深",p.peek()["span"],"limit"); } ~Guard() { --p.depth; } };
  const Json& peek() const { return tokens[at]; }
  const Json& previous() const { return tokens[at-1]; }
  bool check(const std::string& kind) const { return peek()["kind"] == kind; }
  bool match(const std::string& kind) { if (!check(kind)) return false; ++at; return true; }
  bool match(std::initializer_list<const char*> kinds) { for (auto k : kinds) if (match(k)) return true; return false; }
  Json expect(const std::string& kind, std::string message = "") { if (match(kind)) return previous(); fail(message.empty() ? "預期 '"+kind+"'" : message,peek()["span"],"parse"); }
  Json typeAnnotation() {
    Guard guard(*this);
    if (((check("identifier") && peek()["value"] == "function") || check("fn")) && tokens[at+1]["kind"] == "<") {
      ++at; expect("<"); auto returns = typeAnnotation(); expect("("); Json params = Json::array();
      if (!check(")")) do { params.push_back(typeAnnotation()); if (params.size() > 64) fail("函式型別最多只允許 64 個參數",peek()["span"],"parse"); } while (match(","));
      expect(")"); expect(">"); return functionType(params,returns);
    }
    if (match("fn")) {
      expect("("); Json params = Json::array();
      if (!check(")")) do { params.push_back(typeAnnotation()); if (params.size() > 64) fail("函式型別最多只允許 64 個參數",peek()["span"],"parse"); } while (match(","));
      expect(")"); expect("->","函式回傳型別前預期 '->'"); return functionType(params,typeAnnotation());
    }
    Json token = peek();
    if (!match({"identifier","null"})) fail("預期型別註記",token["span"],"parse");
    std::string name = token["value"];
    if (!primitiveTypes().contains(name)) fail("未知的型別 '"+name+"'",token["span"],"type");
    return primitiveTypes()[name];
  }
  Json block(const Json& first) {
    Json body = Json::array(); while (!check("}") && !check("eof")) body.push_back(declaration());
    auto last = expect("}","預期 '}' 以結束區塊"); return Json{{"type","Block"},{"body",body},{"span",between(first,last)}};
  }
  Json functionBody(const Json& first, std::string name = "<anonymous>", Json leading = nullptr, bool cpp = false) {
    Guard guard(*this); expect("("); Json params = Json::array();
    if (!check(")")) do {
      Json ann = cpp ? typeAnnotation() : Json(nullptr); auto param = expect("identifier","預期參數名稱");
      if (ann.is_null() && match(":")) ann = typeAnnotation();
      params.push_back(Json{{"name",param["value"]},{"span",param["span"]},{"annotation",ann}});
      if (params.size() > 64) fail("最多只允許 64 個參數",param["span"],"parse");
    } while (match(","));
    expect(")"); Json returns = leading;
    if (returns.is_null() && match(cpp ? "->" : ":")) returns = typeAnnotation();
    Json body = block(expect("{","函式主體前預期 '{'"));
    return Json{{"type","Function"},{"name",name},{"params",params},{"returnType",returns},{"body",body},{"span",between(first,body)}};
  }
  Json declaration() {
    bool leadingType = (check("identifier") || check("null")) && primitiveTypes().contains(peek()["value"].get<std::string>()) && tokens[at+1]["kind"] == "identifier";
    bool callableType = ((check("identifier") && peek()["value"] == "function") || check("fn")) && tokens[at+1]["kind"] == "<";
    if (leadingType || callableType) {
      Json first = peek(), ann = typeAnnotation(), name = expect("identifier");
      if (check("(")) { auto fn = functionBody(first,name["value"],ann,true); return Json{{"type","FunctionDecl"},{"name",name["value"]},{"nameSpan",name["span"]},{"fn",fn},{"entry",name["value"] == "main" || name["value"] == "主程式"},{"span",fn["span"]}}; }
      if (check(";") && ann["kind"] != "any" && ann["kind"] != "function") {
        auto last = expect(";"); Json value = nullptr;
        if (ann["kind"] == "number") value = 0;
        else if (ann["kind"] == "string") value = "";
        else if (ann["kind"] == "boolean") value = false;
        return Json{{"type","Let"},{"name",name["value"]},{"nameSpan",name["span"]},{"annotation",ann},{"init",Json{{"type","Literal"},{"value",value},{"span",name["span"]}}},{"span",between(first,last)}};
      }
      expect("=","變數需要初始值：整數 名稱 = 值;"); auto init = expression(); auto last = expect(";");
      return Json{{"type","Let"},{"name",name["value"]},{"nameSpan",name["span"]},{"annotation",ann},{"init",init},{"span",between(first,last)}};
    }
    if (match("let")) {
      auto first = previous(), name = expect("identifier","預期變數名稱"); Json ann = match(":") ? typeAnnotation() : Json(nullptr);
      expect("=","變數需要初始值：令 名稱 = 值;"); auto init = expression(); auto last = expect(";");
      return Json{{"type","Let"},{"name",name["value"]},{"nameSpan",name["span"]},{"annotation",ann},{"init",init},{"span",between(first,last)}};
    }
    if (check("fn") && tokens[at+1]["kind"] == "identifier") {
      auto first = expect("fn"), name = expect("identifier"); auto fn = functionBody(first,name["value"]);
      return Json{{"type","FunctionDecl"},{"name",name["value"]},{"nameSpan",name["span"]},{"fn",fn},{"span",fn["span"]}};
    }
    return statement();
  }
  Json statement() {
    Guard guard(*this);
    if (check("identifier")) {
      std::string name = peek()["value"];
      bool output = name == "喵out" || name == "cout" || name == "喵err" || name == "cerr" || name == "喵log" || name == "clog";
      if (output && tokens[at+1]["kind"] == "<<") {
        auto first = tokens[at++]; Json values = Json::array();
        do {
          expect("<<");
          if (check("identifier") && (peek()["value"] == "喵endl" || peek()["value"] == "endl")) {
            auto token = tokens[at++]; values.push_back(Json{{"type","Literal"},{"value","\n"},{"span",token["span"]}});
          } else values.push_back(expression());
          if (values.size() > 64) fail("串流敘述最多只允許 64 個值",peek()["span"],"parse");
        } while (check("<<"));
        auto last = expect(";");
        return Json{{"type","StreamOut"},{"channel",name == "喵out" || name == "cout" ? "stdout" : "stderr"},{"values",values},{"span",between(first,last)}};
      }
      if ((name == "喵in" || name == "cin") && tokens[at+1]["kind"] == ">>") {
        auto first = tokens[at++]; Json targets = Json::array();
        do {
          expect(">>"); auto target = expect("identifier","喵in 的讀取目標必須是變數");
          targets.push_back(Json{{"type","Variable"},{"name",target["value"]},{"span",target["span"]}});
          if (targets.size() > 64) fail("串流敘述最多只允許 64 個值",peek()["span"],"parse");
        } while (check(">>"));
        auto last = expect(";"); return Json{{"type","StreamIn"},{"mode","token"},{"targets",targets},{"span",between(first,last)}};
      }
      if ((name == "喵getline" || name == "getline") && tokens[at+1]["kind"] == "(") {
        auto first = tokens[at++]; expect("("); auto stream = expect("identifier","喵getline 第一個參數必須是 喵in");
        if (stream["value"] != "喵in" && stream["value"] != "cin") fail("喵getline 第一個參數必須是 喵in",stream["span"],"parse");
        expect(","); auto target = expect("identifier","喵getline 的讀取目標必須是變數"); expect(")"); auto last = expect(";");
        return Json{{"type","StreamIn"},{"mode","line"},{"targets",Json::array({Json{{"type","Variable"},{"name",target["value"]},{"span",target["span"]}}})},{"span",between(first,last)}};
      }
    }
    if (match("{")) return block(previous());
    if (match("if")) {
      auto first = previous(); expect("("); auto test = expression(); expect(")"); auto then = statement(); Json other = match("else") ? statement() : Json(nullptr);
      return Json{{"type","If"},{"test",test},{"then",then},{"otherwise",other},{"span",between(first,other.is_null() ? then : other)}};
    }
    if (match("while")) {
      auto first = previous(); expect("("); auto test = expression(); expect(")"); auto body = statement();
      return Json{{"type","While"},{"test",test},{"body",body},{"span",between(first,body)}};
    }
    if (match("for")) {
      auto first = previous(); expect("("); Json init = match(";") ? Json(nullptr) : declaration();
      if (!init.is_null() && init["type"] != "Let" && init["type"] != "ExpressionStmt") fail("迴圈初始部分必須是變數宣告或運算式",init["span"],"parse");
      Json test = check(";") ? Json{{"type","Literal"},{"value",true},{"span",peek()["span"]}} : expression();
      expect(";"); Json update = check(")") ? Json(nullptr) : expression(); expect(")"); auto body = statement(); auto span = between(first,body);
      Json statements = Json::array(); if (!init.is_null()) statements.push_back(init);
      statements.push_back(Json{{"type","For"},{"test",test},{"update",update},{"body",body},{"span",span}});
      return Json{{"type","Block"},{"body",statements},{"span",span}};
    }
    if (match("return")) { auto first = previous(); Json value = check(";") ? Json(nullptr) : expression(); auto last = expect(";"); return Json{{"type","Return"},{"value",value},{"span",between(first,last)}}; }
    if (match({"break","continue"})) { auto first = previous(); auto last = expect(";"); return Json{{"type",first["kind"] == "break" ? "Break" : "Continue"},{"span",between(first,last)}}; }
    if (match(";")) return Json{{"type","Empty"},{"span",previous()["span"]}};
    auto expr = expression(); auto last = expect(";"); return Json{{"type","ExpressionStmt"},{"expression",expr},{"span",between(expr,last)}};
  }
  Json expression() {
    Guard guard(*this); auto left = binaryLevel(0);
    if (match({"=","+=","-=","*=","/=","%="})) {
      auto op = previous(); auto value = expression();
      if (left["type"] != "Variable") fail("賦值目標必須是變數",op["span"],"parse");
      if (op["kind"] != "=") value = Json{{"type","Binary"},{"left",left},{"op",op["kind"].get<std::string>().substr(0,1)},{"opSpan",op["span"]},{"right",value},{"span",between(left,value)}};
      return Json{{"type","Assign"},{"name",left["name"]},{"value",value},{"span",between(left,value)},{"nameSpan",left["span"]}};
    }
    return left;
  }
  Json binaryLevel(size_t level) {
    const std::vector<std::vector<std::string>> ops{{"or"},{"and"},{"==","!="},{"<","<=",">",">="},{"+","-"},{"*","/","%"}};
    if (level == ops.size()) return unaryExpr();
    auto node = binaryLevel(level+1);
    size_t count = 0;
    while (true) {
      bool found = false; for (auto& op : ops[level]) if (match(op)) { found = true; break; }
      if (!found) break;
      auto op = previous(); if (++count > 100) fail("語法樹過深",op["span"],"limit");
      auto right = binaryLevel(level+1);
      node = Json{{"type",level < 2 ? "Logical" : "Binary"},{"left",node},{"op",op["kind"]},{"opSpan",op["span"]},{"right",right},{"span",between(node,right)}};
    }
    return node;
  }
  Json update(const Json& value, const Json& op, bool prefix) {
    if (value["type"] != "Variable") fail("遞增／遞減目標必須是變數",op["span"],"parse");
    return Json{{"type","Update"},{"name",value["name"]},{"op",op["kind"]},{"prefix",prefix},{"nameSpan",value["span"]},{"span",prefix ? between(op,value) : between(value,op)}};
  }
  Json unaryExpr() {
    if (match({"++","--"})) { auto op = previous(); Guard guard(*this); return update(unaryExpr(),op,true); }
    if (match({"!","-"})) { auto op = previous(); Guard guard(*this); auto value = unaryExpr(); return Json{{"type","Unary"},{"op",op["kind"]},{"opSpan",op["span"]},{"value",value},{"span",between(op,value)}}; }
    auto node = primary();
    while (true) {
      if (match({"++","--"})) { node = update(node,previous(),false); continue; }
      if (!match("(")) break;
      Json args = Json::array();
      if (!check(")")) do { args.push_back(expression()); if (args.size() > 64) fail("最多只允許 64 個引數",peek()["span"],"parse"); } while (match(","));
      auto last = expect(")"); node = Json{{"type","Call"},{"callee",node},{"args",args},{"span",between(node,last)}};
    }
    return node;
  }
  Json primary() {
    if (match("[")) { auto first = previous(); expect("&","lambda 使用 [&] 捕獲外層變數"); expect("]"); return functionBody(first,"<anonymous>",nullptr,true); }
    if (match({"number","string"})) return Json{{"type","Literal"},{"value",previous()["value"]},{"span",previous()["span"]}};
    if (match({"true","false","null"})) return Json{{"type","Literal"},{"value",previous()["kind"] == "null" ? Json(nullptr) : Json(previous()["kind"] == "true")},{"span",previous()["span"]}};
    if (match("identifier")) return Json{{"type","Variable"},{"name",previous()["value"]},{"span",previous()["span"]}};
    if (match("fn")) return functionBody(previous());
    if (match("(")) { auto node = expression(); expect(")"); return node; }
    fail("預期一個運算式",peek()["span"],"parse");
  }
public:
  explicit Parser(Json tokens) : tokens(std::move(tokens)) {}
  Json program() {
    auto first = peek(); Json body = Json::array(); while (!check("eof")) body.push_back(declaration());
    Json entry = nullptr; for (auto& n : body) if (n["type"] == "FunctionDecl" && n.value("entry",false)) {
      if (!entry.is_null()) fail("只能宣告一個主程式入口（主程式或 main）",n["nameSpan"],"type");
      entry = n;
    }
    if (!entry.is_null()) {
      auto& fn = entry["fn"]; if (!fn["params"].empty() || (fn["returnType"]["kind"] != "number" && fn["returnType"]["kind"] != "null")) fail("主程式入口必須是 整數 主程式() 或 無值 主程式()（亦可使用 main）",entry["nameSpan"],"type");
      auto span = entry["nameSpan"];
      body.push_back(Json{{"type","ExpressionStmt"},{"expression",Json{{"type","Call"},{"callee",Json{{"type","Variable"},{"name",entry["name"]},{"span",span}}},{"args",Json::array()},{"span",span}}},{"span",span}});
    }
    return Json{{"type","Program"},{"body",body},{"span",between(first,peek())}};
  }
};
} // namespace
Json parse(const std::string& source) { return Parser(tokenize(source)).program(); }

Json resolve(Json program) {
  using Scope = std::map<std::string,size_t>;
  Scope builtins; for (const auto& name : builtinNames()) builtins[name] = builtins.size();
  std::vector<Scope> scopes{builtins}; int functions = 0, loops = 0, nesting = 0;
  program["hasTypeAnnotations"] = false;
  auto add = [](Scope& scope, const std::string& name, const Json& span) { if (scope.count(name)) fail("在此作用域重複宣告 '"+name+"'",span,"resolve"); size_t slot = scope.size(); scope[name] = slot; return slot; };
  auto address = [&](const std::string& name, const Json& span) {
    for (size_t i = scopes.size(); i-- > 0;) if (scopes[i].count(name)) return Json{{"depth",scopes.size()-1-i},{"slot",scopes[i][name]},{"name",name}};
    fail("未定義的變數 '"+name+"'",span,"resolve");
  };
  std::function<void(Json&)> visit;
  auto block = [&](Json& node, const Json& params) {
    Scope scope; Json names = Json::array(), types = Json::array();
    for (const auto& p : params) { add(scope,p["name"],p["span"]); names.push_back(p["name"]); types.push_back(annotation(p)); if (!p["annotation"].is_null()) program["hasTypeAnnotations"] = true; }
    for (auto& s : node["body"]) if (s["type"] == "Let" || s["type"] == "FunctionDecl") {
      s["slot"] = add(scope,s["name"],s["nameSpan"]); names.push_back(s["name"]); Json t = primitive("any");
      if (s["type"] == "Let" && !s["annotation"].is_null()) { t = s["annotation"]; program["hasTypeAnnotations"] = true; }
      if (s["type"] == "FunctionDecl") { auto& fn = s["fn"]; bool annotated = !fn["returnType"].is_null(); for (auto& p : fn["params"]) annotated = annotated || !p["annotation"].is_null(); if (annotated) t = signature(fn); }
      types.push_back(t);
    }
    node["layout"] = names; node["types"] = types; scopes.push_back(scope);
    for (auto& s : node["body"]) visit(s);
    scopes.pop_back();
  };
  visit = [&](Json& n) {
    if (++nesting > 160) fail("語法樹過深",n["span"],"limit");
    std::string t = n["type"];
    if (t == "Program" || t == "Block") block(n,Json::array());
    else if (t == "Let") visit(n["init"]);
    else if (t == "FunctionDecl") visit(n["fn"]);
    else if (t == "Function") {
      if (!n["returnType"].is_null()) program["hasTypeAnnotations"] = true;
      int old = loops; loops = 0; ++functions; block(n["body"],n["params"]); --functions; loops = old;
    } else if (t == "Variable" || t == "Assign" || t == "Update") {
      n["address"] = address(n["name"], t == "Variable" ? n["span"] : n["nameSpan"]); if (t == "Assign") visit(n["value"]);
    } else if (t == "ExpressionStmt") visit(n["expression"]);
    else if (t == "StreamOut") { for (auto& value : n["values"]) visit(value); }
    else if (t == "StreamIn") { for (auto& target : n["targets"]) visit(target); }
    else if (t == "Binary" || t == "Logical") { visit(n["left"]); visit(n["right"]); }
    else if (t == "Unary") visit(n["value"]);
    else if (t == "Call") { visit(n["callee"]); for (auto& a : n["args"]) visit(a); }
    else if (t == "If") { visit(n["test"]); visit(n["then"]); if (!n["otherwise"].is_null()) visit(n["otherwise"]); }
    else if (t == "While" || t == "For") { visit(n["test"]); if (n.contains("update") && !n["update"].is_null()) visit(n["update"]); ++loops; visit(n["body"]); --loops; }
    else if (t == "Return") { if (!functions) fail("回傳(return) 只能出現在函式內",n["span"],"resolve"); if (!n["value"].is_null()) visit(n["value"]); }
    else if (t == "Break" || t == "Continue") { if (!loops) fail(t == "Break" ? "中斷(break) 只能出現在迴圈內" : "繼續(continue) 只能出現在迴圈內",n["span"],"resolve"); }
    --nesting;
  };
  visit(program); return program;
}
Json analyze(const std::string& source, const Json& options) {
  Json ast = resolve(parse(source));
  if (options.value("typecheck",ast["hasTypeAnnotations"].get<bool>())) ast["typeReport"] = checkProgram(ast);
  return ast;
}
} // namespace itou
