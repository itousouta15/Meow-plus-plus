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

Identifiers are ASCII `[A-Za-z_][A-Za-z0-9_]*`, case-sensitive. Numbers are
decimal with optional fractional part and decimal exponent; `.5`, `1.`, hex,
NaN and infinity literals are not supported. Unary minus is an operator.

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
| `len(string)` | Count Unicode code-point iterations, not UTF-16 units or grapheme clusters |
| `str(value)` | Display representation: numbers/booleans/null/text, or `<fn name>` |
| `number(string)` | Parse a complete decimal numeric string; no whitespace, hex or implicit coercion |
| `type(value)` | `number`, `string`, `boolean`, `null`, or `function` |
| `sqrt(number)` | Finite square root; negative input is an error |
| `assert(boolean)` | Return null for true; error for false |

All except print have exactly one argument. User functions have exact arity.
The syntax allows at most 64 parameters and 64 arguments per call. Print's
representation is intended for humans; use the host API's JSON result for
structured output.

## Bounded execution

Both engines enforce a configurable step budget and a bounded call depth.
The tree engine charges AST visits; the VM charges bytecode instructions, so
the same numeric fuel can stop them at different points. Limits are runtime
errors in phase `limit`, not normal program return values. Parser and resolver
also bound source/token/tree nesting before execution.
