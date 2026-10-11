# 喵++ 0.3 language specification

## 中文語法與 C++ 風格結構

```text
整數 加上(整數 左邊, 整數 右邊) { 回傳 左邊 + 右邊; }
整數 主程式() {
  整數 總和 = 0;
  迴圈 (整數 索引 = 0; 索引 < 5; ++索引) {
    如果 (索引 == 2) 繼續;
    總和 += 加上(索引, 1);
  }
  喵out << 總和 << 喵endl;
  回傳 0;
}
```

中文是範例與遊樂場的主要寫法，英文可混用。型別在宣告名稱前面：

- `整數`／`浮點數`／`小數` 對應 `int`／`double`／`float`，共用 `number` 型別。
- `字串`、`布林`、`自動`／`任意`、`無值`／`空` 分別對應文字、布林、動態與空值型別。
- `函式<整數(整數)>` 等價於 `function<int(int)>` 或 `函式(數字) -> 數字`。
- 匿名函式可寫成 `[&](整數 數值) -> 整數 { 回傳 數值 + 1; }`。
- `整數 主程式()`／`無值 主程式()` 與英文 `main()` 一樣，在全域初始化後自動呼叫。
  主程式不得帶參數，同一份程式只能宣告一個入口；`主程式` 與 `main` 不可同時作為入口。
- `迴圈`／`對於` 是 `for`，`當` 是 `while`；`迴圈` 中的 `繼續` 會先執行更新部分。
- `且`／`或` 等價於 `&&`／`||`，採短路求值；`真`／`假`／`空` 是對應的常值。

數值與動態型別規則仍依喵++ 規格，詳見 [TYPES.md](TYPES.md)。以下英文規格也適用於等價的中文寫法。

## C++-style syntax

```cpp
int add(int a, int b) { return a + b; }
int main() {
  int sum = 0;
  for (int i = 0; i < 5; ++i) {
    if (i == 2) continue;
    sum += add(i, 1);
  }
  print(sum);
  return 0;
}
```

Type-first declarations and functions are the preferred spelling. Types include
`int` / `float` / `double` (all aliases of binary64 `number`), `bool` (`boolean`),
`string`, `void` (`null`) and `auto` (`any`, without initializer inference).
`function<int(int, int)>` is the structural equivalent of `fn(number, number) -> number`.
Lambdas use reference capture: `[&](int n) -> int { return n + 1; }`. The result
annotation can be omitted, in which case it is `any`. Captured cells remain valid
after their defining function returns; capture-by-value and explicit capture lists
are not supported.

A top-level type-first function named `main` is called automatically after global
initialization. It must take no parameters and return a numeric type or `void`.
Do not add a separate `main();` call unless you intend to execute it twice. Scripts
without main keep top-level execution. Main's return value is discarded.

`&&` / `||` are equivalent to `and` / `or`. Prefix/postfix `++` and `--` require a
variable and return the new/old value respectively. `+=`, `-=`, `*=`, `/=`, `%=`
also require a variable; they are right-associative assignments whose value is the
stored result. Operands are evaluated left-to-right.

`for (initializer; condition; update) statement` creates a scope around the
initializer and loop. Each part may be omitted; a missing condition is `true`.
The initializer is a variable declaration or expression statement. `continue`
runs update before rechecking the condition; `break` skips update. Each block
entered in an iteration has fresh cells. `for` accepts `迴圈` / `對於` as Chinese aliases.

The legacy spellings below remain accepted and can be mixed with C++ syntax.

## Grammar (abridged EBNF)

```ebnf
program     = declaration* EOF ;
declaration = "let" IDENT (":" type)? "=" expression ";"
            | type IDENT "=" expression ";"
            | type IDENT "(" (cppParameter ("," cppParameter)*)? ")" block
            | "fn" IDENT functionTail
            | statement ;
statement   = "{" declaration* "}"
            | "if" "(" expression ")" statement ("else" statement)?
             | "while" "(" expression ")" statement
             | "for" "(" (declaration | expression ";" | ";") expression? ";" expression? ")" statement
            | "return" expression? ";"
            | ("break" | "continue") ";"
            | expression ";" | ";" ;
parameter   = IDENT (":" type)? ;
cppParameter = type IDENT ;
block       = "{" declaration* "}" ;
functionTail = "(" (parameter ("," parameter)*)? ")" (":" type)? "{" declaration* "}" ;
type        = "number" | "string" | "boolean" | "null" | "any"
            | "int" | "float" | "double" | "bool" | "void" | "auto"
            | "function" "<" type "(" (type ("," type)*)? ")" ">"
            | "fn" "(" (type ("," type)*)? ")" "->" type ;
expression  = assignment ;
assignment  = logicalOr (("=" | "+=" | "-=" | "*=" | "/=" | "%=") assignment)? ;
logicalOr   = logicalAnd (("or" | "||") logicalAnd)* ;
logicalAnd  = equality (("and" | "&&") equality)* ;
equality    = comparison (("==" | "!=") comparison)* ;
comparison  = term (("<" | "<=" | ">" | ">=") term)* ;
term        = factor (("+" | "-") factor)* ;
factor      = unary (("*" | "/" | "%") unary)* ;
unary       = ("!" | "-" | "++" | "--") unary | call ;
call        = primary (("(" (expression ("," expression)*)? ")") | "++" | "--")* ;
primary     = NUMBER | STRING | "true" | "false" | "null" | IDENT
             | "(" expression ")" | "fn" functionTail ;
// primary also accepts "[&]" "(" cppParameter-list? ")" ("->" type)? block.
```

Semicolons are required after declarations and expression/return/break/continue
statements. Blocks and named function declarations do not need one. An empty
statement is allowed. `if` / `while` bodies are statements; put declarations
inside a block. `else` binds to the nearest unmatched `if`.

Identifiers are ASCII `[A-Za-z_][A-Za-z0-9_]*` or Han (`[A-Za-z_\p{Script=Han}][\p{Script=Han}A-Za-z0-9_]*`),
case-sensitive. Numbers are decimal with optional fractional part and decimal
exponent; `.5`, `1.`, hex, NaN and infinity literals are not supported. Unary
minus is an operator.

### 中文關鍵字

Every keyword has a Chinese alias; English and Chinese may be mixed freely.

| English | 中文 | English | 中文 |
| --- | --- | --- | --- |
| `let` | `令`、`設` | `return` | `回傳`、`返回` |
| `fn` | `函式`、`函` | `break` | `中斷`、`跳出` |
| `if` | `如果`、`若` | `continue` | `繼續` |
| `else` | `否則` | `true` | `真` |
| `while` | `當` | `false` | `假` |
| `and` | `且`、`並且` | `null` | `空` |
| `or` | `或`、`或者` | | |
| `for` | `迴圈`、`對於` | | |

型別名稱也接受中文：`整數`／`浮點數`／`小數`／`數`／`數字`（number）、`字串`（string）、`布林`／`布林值`
（boolean）、`無值`／`空`（null）、`自動`／`任意`／`任意值`（any）、`函式`（fn）。例如：

```text
函式 費式(第幾項: 數字): 數字 {
  若 (第幾項 < 2) { 回傳 第幾項; }
  回傳 費式(第幾項 - 1) + 費式(第幾項 - 2);
}
喵("費波那契：", 費式(10));
```

Strings use double quotes and JSON escapes (`\n`, `\t`, `\uXXXX`, etc.). Raw
newlines/control characters are rejected. Comments are `//` through end-of-line
and nested `/* ... */`. Source spans use UTF-16 offsets and 1-based line/column
positions, matching textarea selection offsets. CRLF is accepted.

## Gradual types

Type annotations are optional. Any annotation activates automatic static
checking for the complete program before execution. Unannotated variables,
parameters and result types remain `any`; there is no implicit let-type
inference. Named function declarations and built-ins have known signatures.
An unannotated program keeps its dynamic execution behavior unless the caller
explicitly requests a type check. See [TYPES.md](TYPES.md) for the full rules,
runtime contracts, higher-order function types and return-flow analysis.

`any` is static information, not a new runtime value kind. `type(value)` still
reports the actual primitive/function kind. Static checking does not replace
runtime arithmetic, initialization, fuel or dynamic-boundary checks.

## Values and operators

- Numbers are finite IEEE-754 binary64 values, including signed zero. Arithmetic
  overflow and division/remainder by zero are errors. Integer precision follows
  binary64; this is not an arbitrary-precision integer language.
- Strings are immutable Unicode text, stored as UTF-8 in the C++ core. Limits
  and source offsets count UTF-16 units for host/editor compatibility. `+` concatenates two strings, or
  adds two numbers. Mixed operands are errors.
- Other arithmetic/comparison operators require numbers. Remainder follows
  JavaScript's signed remainder, so `-5 % 3` is `-2`.
- `==` / `!=` compare primitive values without coercion; different types are
  unequal. Function equality is identity; `0 == -0` is true.
- Conditions and logical operands must be booleans. `and`/`or` short-circuit
  left-to-right and return booleans; there is no generic truthiness.
- Evaluation order is left-to-right, including callee then arguments. Assignment
  is right-associative and produces the assigned value.
- A function returns `null` if it reaches its end or executes `return;`.

## Scope and initialization

Each program/block/function invocation has lexical cells. All local `let` and
named-function bindings are reserved at scope entry; named functions are
initialized immediately, enabling calls before their declarations and mutual
recursion. Let bindings remain uninitialized until the declaration executes.

Accessing or assigning a reserved but uninitialized cell is a runtime error:

```text
let x = "outer";
{
  print(x);       // error: inner x is not initialized; does NOT read outer x
  let x = "inner";
}
```

Closure addresses are fixed by the resolver. A closure referring to a later let
binding succeeds when called after initialization and fails if called before it:

```text
fn read() { return value; }
let value = 42;
print(read());  // 42
```

Bindings are mutable; closures capture shared cells, not copied values. A block
entered on different loop iterations creates different cells. Function
parameters and its outer body share one scope, so redeclaring a parameter there
is an error. Nested blocks may shadow it. Duplicate declarations in one scope
are static errors. Built-ins are in a separate outer scope: they may be
shadowed but not reassigned. Undeclared names are rejected even in dead branches.

`return` is legal only in functions; `break` and `continue` only in an enclosing
loop of the same function. `break` exits the nearest loop. `continue` jumps to
the while condition or the for update. Return/break/continue discard exited local scopes.

## Built-ins

### 喵串流（C++ 風格）

| 名稱 | 英文等價拼法 | 敘述 |
| --- | --- | --- |
| `喵in` | `cin` | `喵in >> 數值 >> 文字;` |
| `喵out` | `cout` | `喵out << "答案：" << 數值 << 喵endl;` |
| `喵err` | `cerr` | 將串接內容寫入標準錯誤 |
| `喵log` | `clog` | 同樣寫入標準錯誤，用於紀錄訊息 |
| `喵endl` | `endl` | 在輸出串流中插入換行 |
| `喵getline` | `getline` | `喵getline(喵in, 文字);`，讀入剩餘一整行 |

串流是敘述語法，不能當成一般函式值，也不需要 `std::`。`<<`／`>>` 在串流
敘述中是輸出／輸入分隔符，不是位元位移運算子。每份串流敘述最多 64 個值／目標。
串流輸出依序求值，不插入隱含分隔；只有 `喵endl` 或字串內的換行會換行。
標準輸出與標準錯誤共用輸出資源上限，兩者內容由 API／CLI 分開回傳。

`喵in` 的目標必須是已宣告的可修改變數，依宣告型別轉換：數字接受完整的有限
十進位 token，字串接受一個非空白 token，布林接受 `真`／`假`、`true`／`false`
或 `1`／`0`。`任意`／`自動` 讀入字串。函式或空值型別不能作為輸入目標。
關閉靜態檢查後，這些限制仍會在執行期檢查。

`喵getline` 的目標只接受字串或任意型別，保留行內空白並去掉結尾 LF／CRLF。
`喵in`、`喵getline` 與 `讀行`／`讀` 共用輸入游標；讀完數字後立刻讀整行時，
會先取得同一行的剩餘內容（可能是空字串）。檔尾／無效輸入會回報執行期錯誤，
不提供 C++ 的 failbit 狀態或互動式終端讀取。

型別前置的基本變數可寫成 `整數 數值;`、`字串 文字;`、`布林 條件;`、`空 值;`，
分別在宣告執行時初始化為 `0`、`""`、`假`、`空`。這是喵++ 的預設初始化，
不是 C++ 的未初始化值；`自動`／函式型別與舊式 `令` 宣告仍需給初始值。

### 一般內建函式

| Function | Contract |
| --- | --- |
| `print(...values)` | Display values separated by one space; emit one output line; return null |
| `喵(...values)` | `print` 的別名，輸出完全相同 |
| `喵喵(...values)` | 和 `print` 相同，但每行輸出加上「喵～ 」前綴 |
| `len(string)` | Count Unicode code-point iterations, not UTF-16 units or grapheme clusters |
| `喵長(string)` | `len` 的別名 |
| `str(value)` | Display representation: numbers/booleans/null/text, or `<fn name>` |
| `喵字(value)` | `str` 的別名 |
| `number(string)` | Parse a complete decimal numeric string; no whitespace, hex or implicit coercion |
| `喵數(string)` | `number` 的別名 |
| `type(value)` | `number`, `string`, `boolean`, `null`, or `function` |
| `喵型(value)` | `type` 的別名 |
| `sqrt(number)` | Finite square root; negative input is an error |
| `喵根(number)` | `sqrt` 的別名 |
| `assert(boolean)` | Return null for true; error for false |
| `喵驗(boolean)` | `assert` 的別名 |
| `喵黏(...values)` | 把每個值的顯示字串直接串接（不加分隔），回傳字串 |
| `喵重複(string, number)` | 將字串重複非負整數次；結果上限 65536 個碼元 |
| `喵選(boolean, any, any)` | 條件為真回傳第二個值，否則回傳第三個（三元運算） |
| `喵叫()` | 回傳字串 `喵～` |
| `讀行()` | 讀入下一行（去除結尾 `\n`／`\r\n`），檔尾回傳 null |
| `讀()`／`喵吃()` | 讀入下一個以空白分隔的 token，檔尾回傳 null |
| `讀數()` | 讀入下一個 token 並解析為數字；非數字為錯誤，檔尾回傳 null |

`喵` 家族全為確定性內建，兩個引擎共用同一份實作。`print`、`喵`、`喵喵`、
`喵黏` 接受可變數量的引數；其餘為固定引數數量。使用者函式的引數數量必須完全相符。
The syntax allows at most 64 parameters and 64 arguments per call. Print's
representation is intended for humans; use the host API's JSON result for
structured output.

## 輸入（標準輸入）

`讀行`／`讀`／`喵吃`／`讀數` 從 host 提供的輸入字串讀取，共用同一個游標（可混用：
`讀行` 前進一行，`讀` 略過空白取到下一個 token）。檔尾一律回傳 `null`，方便用
`while` 或 `if` 判斷。host 未提供輸入時，預設為空字串。

- 嵌入 API：`run(source, { input: "..." })` 或 `new VM(bytecode, { input })`。
- CLI：檔案模式會自動讀取管線／重導向的標準輸入；`-`（程式來自 stdin）時不做輸入。
- 遊樂場：「標準輸入」欄位提供整份測資，執行／除錯各自從開頭讀取。

```text
// echo.itou：讀一行，回聲。
令 台詞 = 讀行();
若 (台詞 == 空) { 喵("喵？沒有輸入。"); } 否則 { 喵("喵～", 台詞); }
```

## Bounded execution

Both engines enforce a configurable step budget and a bounded call depth.
The tree engine charges AST visits; the VM charges bytecode instructions, so
the same numeric fuel can stop them at different points. Limits are runtime
errors in phase `limit`, not normal program return values. Parser and resolver
also bound source/token/tree nesting before execution.

The parser allows at most 80 guarded nesting levels and at most 100 consecutive
operators at one binary precedence level. These portable limits apply to native,
WebAssembly and the JavaScript reference; nesting limits are language diagnostics
rather than host stack-overflow errors.
