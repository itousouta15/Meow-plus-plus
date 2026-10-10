# itouLang 0.2 language specification

## Grammar (abridged EBNF)

```ebnf
program     = declaration* EOF ;
declaration = "let" IDENT (":" type)? "=" expression ";"
            | "fn" IDENT functionTail
            | statement ;
statement   = "{" declaration* "}"
            | "if" "(" expression ")" statement ("else" statement)?
            | "while" "(" expression ")" statement
            | "return" expression? ";"
            | ("break" | "continue") ";"
            | expression ";" | ";" ;
parameter   = IDENT (":" type)? ;
functionTail = "(" (parameter ("," parameter)*)? ")" (":" type)? "{" declaration* "}" ;
type        = "number" | "string" | "boolean" | "null" | "any"
            | "fn" "(" (type ("," type)*)? ")" "->" type ;
expression  = assignment ;
assignment  = logicalOr ("=" assignment)? ;  // left side must be a variable
logicalOr   = logicalAnd ("or" logicalAnd)* ;
logicalAnd  = equality ("and" equality)* ;
equality    = comparison (("==" | "!=") comparison)* ;
comparison  = term (("<" | "<=" | ">" | ">=") term)* ;
term        = factor (("+" | "-") factor)* ;
factor      = unary (("*" | "/" | "%") unary)* ;
unary       = ("!" | "-") unary | call ;
call        = primary ("(" (expression ("," expression)*)? ")")* ;
primary     = NUMBER | STRING | "true" | "false" | "null" | IDENT
            | "(" expression ")" | "fn" functionTail ;
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

型別名稱也接受中文：`數`／`數字`（number）、`字串`（string）、`布林`／`布林值`
（boolean）、`空`（null）、`任意`／`任意值`（any）、`函式`（fn）。例如：

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
- Strings are immutable JavaScript strings. `+` concatenates two strings, or
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
its condition. Return/break/continue discard exited local scopes.

## Built-ins

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
