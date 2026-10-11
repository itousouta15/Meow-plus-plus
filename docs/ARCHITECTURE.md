# Implementation notes

## C++17 / WebAssembly core (0.3)

The production core lives in `native/include/itou/core.hpp` and `native/src/`:

| Component | Implementation |
| --- | --- |
| UTF-8 lexer with UTF-16 positions, C++/legacy parser, lexical resolver | `frontend.cpp` |
| Gradual types, structural signatures, return-flow analysis | `checker.cpp` |
| Source-mapped stack bytecode, disassembly | `compiler.cpp` |
| Values, cells, built-ins, budgets, runtime contracts | `runtime.cpp` |
| Independent tree evaluator / iterative stack VM | `interpreter.cpp` / `vm.cpp` |
| JSON API and isolated debug sessions | `api.cpp` |
| Standalone native CLI / Emscripten C export | `main.cpp` / `wasm.cpp` |

CMake builds `itou_core` and either the native `itou` executable or
`web/native/itou.js` + `itou.wasm`. nlohmann/json 3.11.3 provides plain-data ASTs,
prototype metadata and the host protocol; function values and environments are
native C++ objects, never serialized as cyclic JSON.

`src/index.js` is a synchronous host adapter. On Node.js a background Worker owns
a persistent `itou --protocol` subprocess. Requests travel as JSON lines and
responses use a 32 MiB shared buffer; `Atomics.wait` preserves the synchronous
API without blocking subprocess I/O. In the browser the adapter awaits one
Emscripten module at initialization, then calls `itou_request` synchronously.
The browser Worker installs its message handler *before* loading that module
so requests received during initialization are preserved. Each Worker/module
owns separate C++ session state. `VM.dispose()` releases a session immediately;
the host also registers a finalizer.

The C++ `Context` owns an arena of `unique_ptr<Environment>`. Closures hold
non-owning pointers into that arena, while function wrappers use `shared_ptr`.
This preserves escaping and recursive closures without environment/function
ownership cycles. Scopes are retained for the whole execution/debug session,
then all are freed together by RAII; there is no tracing collector during a run.
Long loops can therefore retain exited scopes until execution ends.

C++ `for` initializers are represented by a surrounding Block and a For node.
The compiler patches separate break and continue targets: continue unwinds
body scopes then executes update; break skips update. Prefix/postfix Update
nodes lower to LOAD, optionally DUP, CONST, BINARY, STORE, optionally POP.
Type-first main declarations add an automatic entry call after global code.
The Chinese entry name `主程式` has the same behavior as `main`. The lexer maps
`迴圈` / `對於` to for; the parser accepts `函式<整數(整數)>` alongside the
English structural function spelling. Both frontends reject multiple entries.

StreamIn/StreamOut statements implement `喵in`/`喵out` and their stderr/line-input
counterparts. READ consults the target environment's declared slot type; WRITE
serializes one value without adding whitespace. Context retains exact stdout and
stderr strings, plus completed stdout records and a pending fragment. HALT/end or
runtime failure publishes the final pending fragment; snapshots retain partial
stdout without inserting a newline. Stderr never enters stdout's record array.

`src/reference.js` exposes the earlier JavaScript implementation, extended with
the same syntax. It is a test oracle; CLI, public API and playground use C++.
The remaining sections describe the shared model and the reference modules.

## Frontend

`lexer.js` scans source while tracking UTF-16 offsets and line/column positions.
`parser.js` is recursive descent with explicit precedence levels, producing
plain-data AST nodes. Operator spans are retained separately from whole
expressions so a division error highlights `/`, not the entire return statement.

`resolver.js` creates one name-to-slot table per lexical scope. Variable reads
and writes become `{depth, slot, name}` addresses. Names are reserved before
resolving a block; runtime initialization is a separate concern. Function
boundaries reset loop depth, preventing a function nested inside a loop from
breaking the caller's loop.

Since 0.2, the parser also accepts optional primitive/structural function type
annotations. The resolver records slot-level runtime types. `typechecker.js`
checks lexical addresses against signatures, verifies operators/calls/returns,
and tracks normal/break/continue completion for return-flow analysis. It runs
automatically for annotated programs, or explicitly through `check(source)`.
The complete gradual-typing contract is documented in [TYPES.md](TYPES.md).

## Runtime cells and closures

An Environment is `{names, cells, types, parent}`. Cells start with a private sentinel
distinct from null. A closure keeps a strong reference to its defining
environment. Calls create a child environment for parameters and body bindings.
Both engines use the same primitive arithmetic, built-ins, environment cells,
diagnostics and budgets, but have separate control-flow implementations.

In the JavaScript reference, cycles such as `environment → named function →
environment` are reclaimed by JavaScript GC. The production C++ ownership model
is described above.

Typed cells guard initialization and assignment. Function values crossing a
typed boundary are wrapped with parameter/result contracts; wrappers retain
the target's identity for equality and are not extra language call frames.
`prepareCall` guards inputs, and `finishCall` guards the declared result plus
enclosing higher-order contracts. Assignments return the guarded value, which
prevents an assignment expression from bypassing a function contract.

## Tree interpreter

`interpreter.js` recursively evaluates AST expressions. Statements return
explicit return/break/continue completion records. Function calls build lexical
environments and capture source call frames for diagnostics. The execution
budget is charged at each evaluated expression and statement.

## Bytecode compiler and VM

Each function prototype contains parameter/result types, names, local-slot layout, a constant
pool, and source-mapped instructions. Bytecode is an inspectable in-memory
instruction representation, not a stable binary on-disk format.

| Opcode | Stack/control effect |
| --- | --- |
| CONST, LOAD, CLOSURE | Push a constant, lexical value, or environment-capturing closure |
| INIT | Guard and pop a value into a previously uninitialized local cell |
| READ | Extract a token/line using the target cell's declared type, then assign through its guard |
| WRITE | Pop/display one value and write to the selected stdout/stderr stream |
| STORE | Guard/store the top value to a lexical cell; leave the guarded value on the stack |
| POP, DUP | Discard or duplicate the top value |
| UNARY, BINARY | Consume operand(s), check types, push result |
| BOOL | Validate the top value without consuming it |
| ENTER, LEAVE, UNWIND | Create/leave lexical scopes (UNWIND is used before break/continue) |
| JUMP | Set the current instruction pointer |
| JUMP_FALSE, JUMP_TRUE | Pop and validate a boolean, conditionally jump |
| CALL | Consume callee/arguments, apply input contracts, invoke a built-in or push a frame |
| RETURN | Apply result contracts, restore the caller's stack base and push the result |
| HALT | Finish the script; assert balanced operand/call stacks |

`and`/`or` compile to DUP + conditional jump + POP + right operand + BOOL.
This preserves short-circuit effects while checking both evaluated operands.

Each VM frame stores prototype, instruction pointer, current environment,
operand-stack base and source call location. User-language recursion consumes
VM frames rather than JavaScript recursive calls. RETURN resets the operand
stack to the frame's base, even from nested lexical blocks.

The production VM likewise uses explicit C++ frames; the production tree engine
uses bounded C++ recursion. MSVC builds reserve an 8 MiB native stack and the
WebAssembly module reserves a 4 MiB stack for the bounded frontend/evaluator.
The Wasm build uses `-fwasm-exceptions` so exceptions unwind within WebAssembly
rather than through JavaScript invoke wrappers; the browser must support Wasm
exception handling. Frontend guards are shared by native and Wasm builds.

## Debugging

The VM exposes `step()`, `stepLine()`, `continue(breakpoints)` and `snapshot()`.
Snapshots contain the next instruction/source location, operand stack,
lexical environments and call frames. Values are rendered into plain data so
closure/environment cycles do not cross the Worker messaging boundary.

Source steps stop on a different line, a changed frame identity, or a backward
jump. Continue advances beyond the current pause before testing breakpoints,
so resuming a breakpoint does not immediately stop at the same instruction.
Hoisted function initialization appears at its source declaration's line;
execution order need not follow textual line order.

## Browser integration

The static server exposes only `web/`, `src/` and `examples/`; it does not accept
program execution requests. The browser uses a module Worker for compilation
and WebAssembly execution. The server provides `application/wasm` and permits
WebAssembly compilation in CSP through `wasm-unsafe-eval`. Stop terminates that Worker. The UI renders source/output/errors
with text nodes, persists source locally, and virtualizes gutter rows so large
files do not create one DOM node for every line.

Editing during a debug session invalidates that session. A new execution has
a fresh worker, global environment and output. Local storage is convenience
persistence; downloaded `.itou` files are the portable artifact.

## Verification boundary

Hand-written semantic tests are the reference for shared primitives and lexical
rules. Differential tests compare two separate execution paths for control
flow, scope unwinding, stack behavior and observable effects. Generated tests
use fixed seeds and bounded loops; no test success is treated as a proof of
language correctness or an OS-level isolation guarantee.
