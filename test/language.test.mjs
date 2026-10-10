import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { run, analyze, tokenize, compile, disassemble, VM, LangError, formatDiagnostic } from '../src/index.js';

function both(source, expected) {
  const tree = run(source, { engine: 'tree' });
  const vm = run(source, { engine: 'vm' });
  assert.deepEqual(vm.output, tree.output);
  assert.deepEqual(vm.globals, tree.globals);
  if (expected) assert.deepEqual(vm.output, expected);
  return vm;
}

const cases = [
  ['precedence and finite decimal numbers', 'print(2 + 3 * 4, (2 + 3) * 4, -2 * -3, 1e2 / 4, 17 % 5);', ['14 20 6 25 2']],
  ['empty source', '', []],
  ['nested block comments', '/* outer /* inner */ outer */ print("a\\n\\u4f60"); // tail', ['a\n你']],
  ['strings and Unicode code points', 'print("a" + "b", len("你🙂"), type(null), number("-1.5e2"));', ['ab 2 null -150']],
  ['strict equality', 'print(1 == "1", 0 == -0, true != 1, null == null);', ['false true true true']],
  ['assignment is a value and evaluates left to right', 'let a = 0; let b = 0; print(a = b = 3, a, b); print((a = 2) + (a = 4), a);', ['3 3 3', '6 4']],
  ['short circuit has no right side effects', 'let x = 0; print(false and ((x = 1) == 1), true or ((x = 2) == 2), x);', ['false true 0']],
  ['block scope and shadowing', 'let x = 1; { let x = 2; { print(x); } } print(x);', ['2', '1']],
  ['closures mutate stable lexical cells', 'fn make(n) { return fn(x) { n = n + x; return n; }; } let a = make(10); let b = make(20); print(a(1), a(2), b(3), a(4));', ['11 13 23 17']],
  ['closure sees later initialization in its defining scope', 'let x = "outside"; { fn read() { return x; } let x = "inside"; print(read()); }', ['inside']],
  ['mutual recursion and declaration hoisting', 'print(even(10)); fn even(n) { if (n == 0) return true; return odd(n - 1); } fn odd(n) { if (n == 0) return false; return even(n - 1); }', ['true']],
  ['local recursive anonymous closure', 'let factorial = fn(n) { if (n < 2) return 1; return n * factorial(n - 1); }; print(factorial(7));', ['5040']],
  ['function identity and first-class built-ins', 'fn f() {} let g = f; let p = print; p(f == g, f == fn() {}, type(p), f());', ['true false function null']],
  ['nested break/continue unwind block scopes', 'let i = 0; let sum = 0; while (i < 8) { i = i + 1; { let hidden = i; if (i % 2 == 0) continue; if (i > 5) break; sum = sum + hidden; } } print(sum, i);', ['9 7']],
  ['nested loops target the nearest loop', 'let i = 0; let sum = 0; while (i < 3) { i = i + 1; let j = 0; while (true) { j = j + 1; if (j == 3) break; sum = sum + 1; } } print(sum);', ['6']],
  ['return from nested blocks and loops', 'fn f() { while (true) { { let n = 9; return n; } } } print(f());', ['9']],
  ['separate loop iterations capture separate local cells', 'let a = null; let b = null; let i = 0; while (i < 2) { let copy = i; if (i == 0) a = fn() { return copy; }; else b = fn() { return copy; }; i = i + 1; } print(a(), b());', ['0 1']],
];
for (const [name, source, expected] of cases) test(name, () => both(source, expected));

const errors = [
  ['print(1 / 0);', 'runtime', 'division by zero'],
  ['print(1 % 0);', 'runtime', 'remainder by zero'],
  ['print(1e308 * 1e308);', 'runtime', 'not finite'],
  ['if (1) print(2);', 'runtime', 'expected boolean'],
  ['print(true and 1);', 'runtime', 'expected boolean'],
  ['print(1 or true);', 'runtime', 'expected boolean'],
  ['print("a" + 2);', 'runtime', 'expected number'],
  ['print(-true);', 'runtime', 'expected number'],
  ['let x = x;', 'runtime', 'before initialization'],
  ['x = 1; let x = 2;', 'runtime', 'before initialization'],
  ['let x = 1; { print(x); let x = 2; }', 'runtime', 'before initialization'],
  ['print = 1;', 'runtime', 'cannot assign built-in'],
  ['len(1);', 'runtime', 'len expects string'],
  ['number(" 1");', 'runtime', 'decimal numeric string'],
  ['sqrt(-1);', 'runtime', 'not finite'],
  ['assert(false);', 'runtime', 'assertion failed'],
  ['let x = 1; x();', 'runtime', 'cannot call number'],
  ['fn f(x) { return x; } f();', 'runtime', 'expects 1 argument'],
  ['let x = 1; let x = 2;', 'resolve', 'duplicate binding'],
  ['fn f(x, x) {}', 'resolve', 'duplicate binding'],
  ['fn f(x) { let x = 1; }', 'resolve', 'duplicate binding'],
  ['print(missing);', 'resolve', 'undefined variable'],
  ['return 1;', 'resolve', 'only allowed inside a function'],
  ['break;', 'resolve', 'only allowed inside a loop'],
  ['while (true) { fn f() { continue; } break; }', 'resolve', 'only allowed inside a loop'],
  ['let x = 1', 'parse', "expected ';'"],
  ['(1 + 2) = 4;', 'parse', 'assignment target'],
  ['let x;', 'parse', 'require an initializer'],
  ['print("unterminated);', 'lex', 'unterminated string'],
  ['print("\\q");', 'lex', 'invalid string escape'],
  ['/* unfinished', 'lex', 'unterminated block comment'],
  ['print(1e999);', 'lex', 'must be finite'],
  ['print(1e+);', 'lex', 'expected digits in exponent'],
];
for (const [source, phase, message] of errors) {
  test(`matching diagnostic: ${source}`, () => {
    const diagnostics = [];
    for (const engine of ['tree', 'vm']) {
      assert.throws(() => run(source, { engine }), error => {
        assert.ok(error instanceof LangError);
        assert.equal(error.phase, phase);
        assert.ok(error.message.includes(message), error.message);
        diagnostics.push(error.toJSON());
        return true;
      });
    }
    assert.deepEqual(diagnostics[0], diagnostics[1]);
  });
}

test('source spans and stack traces identify the failed operation', () => {
  const source = 'fn divide(a, b) {\n  return a / b;\n}\nfn caller() { return divide(1, 0); }\ncaller();';
  const errors = [];
  for (const engine of ['tree', 'vm']) {
    try { run(source, { engine }); assert.fail('expected failure'); }
    catch (error) {
      assert.ok(error instanceof LangError);
      assert.equal(error.span.line, 2);
      assert.equal(error.span.column, 12);
      assert.deepEqual(error.frames.map(f => f.name), ['caller', 'divide']);
      assert.match(formatDiagnostic(error, source, 'sample.itou'), /sample\.itou:2:12/);
      errors.push(error.toJSON());
    }
  }
  assert.deepEqual(errors[0], errors[1]);
});

test('execution, recursion, string and output limits terminate programs', () => {
  for (const engine of ['tree', 'vm']) {
    for (const [source, options, message] of [
      ['while (true) {}', { maxSteps: 100 }, 'steps'],
      ['fn recurse() { recurse(); } recurse();', { maxDepth: 12 }, 'call depth'],
      ['let s = "x"; while (true) { s = s + s; }', {}, 'string exceeds'],
      ['while (true) { print("xxxxxxxx"); }', { maxOutput: 30 }, 'output limit'],
    ]) {
      assert.throws(() => run(source, { engine, ...options }), error => error instanceof LangError && error.phase === 'limit' && error.message.includes(message));
    }
  }
});

test('malformed and deeply nested input yields a language diagnostic, never a JS stack overflow', () => {
  for (const source of ['('.repeat(300) + '1' + ')'.repeat(300) + ';', '1' + '+1'.repeat(500) + ';', 'let a = ' + '!'.repeat(400) + 'true;', '{'.repeat(300) + '}'.repeat(300)]) {
    assert.throws(() => analyze(source), error => error instanceof LangError && error.phase === 'limit');
  }
});

test('lexer line/column accounting includes CRLF, comments and escaped quotes', () => {
  const tokens = tokenize('// skip\r\nlet s = "a\\\"b";\r\nprint(s);');
  const print = tokens.find(t => t.value === 'print');
  assert.equal(print.span.line, 3);
  assert.equal(print.span.column, 1);
  assert.equal(tokens.find(t => t.kind === 'string').value, 'a"b');
});

test('example programs agree in both engines', () => {
  const folder = new URL('../examples/', import.meta.url);
  for (const name of readdirSync(folder).filter(name => name.endsWith('.itou') && name !== 'error.itou'))
    both(readFileSync(new URL(name, folder), 'utf8'));
});

test('bytecode is inspectable and instruction stepping matches normal execution', () => {
  const source = 'let n = 1;\nfn add(x) { return x + n; }\nprint(add(4));';
  const code = compile(source);
  const assembly = disassemble(code);
  assert.match(assembly, /CLOSURE/);
  assert.match(assembly, /n @ 1:0/);
  const vm = new VM(code);
  let steps = 0;
  while (!vm.done) { vm.step(); steps++; assert.ok(steps < 200); }
  assert.deepEqual(vm.snapshot().output, ['5']);
  assert.deepEqual(vm.snapshot().stack, []);
  assert.equal(vm.snapshot().scopes.length, 1);
});

test('source stepping and breakpoints work on calls, loops and captured variables', () => {
  const source = 'let n = 0;\nwhile (n < 3) {\n  n = n + 1;\n  print(n);\n}\nprint("done");';
  const vm = new VM(compile(source));
  const first = vm.continue(new Set([4]));
  assert.equal(first.location.line, 4);
  assert.equal(first.done, false);
  assert.ok(first.scopes.flat().some(v => v.name === 'n' && v.value === '1'));
  const second = vm.continue(new Set([4]));
  assert.equal(second.location.line, 4);
  assert.deepEqual(second.output, ['1']);
  vm.continue(new Set());
  assert.deepEqual(vm.snapshot().output, ['1', '2', '3', 'done']);
});

test('single-line infinite loop remains interruptible by source stepping', () => {
  const vm = new VM(compile('while (true) {}'), { maxSteps: 100 });
  const state = vm.stepLine();
  assert.equal(state.done, false);
  assert.ok(state.steps < 10);
});
