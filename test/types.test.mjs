import test from 'node:test';
import assert from 'node:assert/strict';
import { run, check, compile, VM, LangError } from '../src/index.js';

function both(source, expected, options = {}) {
  const tree = run(source, { ...options, engine: 'tree' });
  const vm = run(source, { ...options, engine: 'vm' });
  assert.deepEqual(vm.output, tree.output);
  assert.deepEqual(vm.globals, tree.globals);
  if (expected) assert.deepEqual(vm.output, expected);
}
function sameError(source, phase, message, options = {}) {
  const diagnostics = [];
  for (const engine of ['tree', 'vm']) {
    assert.throws(() => run(source, { ...options, engine }), error => {
      assert.ok(error instanceof LangError, error.stack);
      assert.equal(error.phase, phase, error.message);
      assert.match(error.message, message);
      diagnostics.push(error.toJSON());
      return true;
    });
  }
  assert.deepEqual(diagnostics[0], diagnostics[1]);
}

test('primitive annotations, nullable values and strict conditions', () => {
  both('let n: number = 2; let s: string = "hello"; let b: boolean = n < 3; let nothing: null = null; if (b) print(s, n, nothing);', ['hello 2 null']);
});
test('typed closures retain mutable captured cells and structural function types', () => {
  both('fn make(start: number): fn(number) -> number { let n: number = start; return fn(step: number): number { n = n + step; return n; }; } let count: fn(number) -> number = make(10); print(count(1), count(2));', ['11 13']);
});
test('typed recursion, mutual recursion, and higher-order calls', () => {
  both('fn even(n: number): boolean { if (n == 0) return true; return odd(n - 1); } fn odd(n: number): boolean { if (n == 0) return false; return even(n - 1); } fn apply(f: fn(number) -> boolean, n: number): boolean { return f(n); } print(apply(even, 8));', ['true']);
});
test('function contracts preserve identity and can adapt variadic built-ins', () => {
  both('let dynamic = fn(x) { return x; }; let f: fn(number) -> number = dynamic; let g: fn(number) -> number = dynamic; print(f == g, f == dynamic); let printer: fn(number) -> null = print; printer(42);', ['true true', '42']);
});
test('unannotated source keeps dynamic semantics; explicit check analyzes it', () => {
  both('let x = 1; x = "now a string"; print(x);', ['now a string']);
  assert.throws(() => check('print("x" + 1);'), error => error.phase === 'type');
  sameError('print("x" + 1);', 'runtime', /expected number/);
});
test('check returns signatures without executing source effects', () => {
  const report = check('fn add(a: number, b: number): number { return a + b; } let name: string = "itou"; while (true) {}');
  assert.equal(report.ok, true);
  assert.deepEqual(report.globals, [{ name: 'add', type: 'fn(number, number) -> number' }, { name: 'name', type: 'string' }]);
  assert.equal(report.functions[0].type, 'fn(number, number) -> number');
});

const staticErrors = [
  ['let n: number = "x";', /initializer.*expected number, got string/],
  ['let n: number = 1; n = false;', /assignment.*expected number, got boolean/],
  ['fn f(n: number): number { return n; } f("x");', /argument 1.*expected number, got string/],
  ['fn f(n: number): number { return n; } f();', /expects 1 argument/],
  ['fn f(): number { return "x"; }', /return value.*expected number, got string/],
  ['fn f(flag: boolean): number { if (flag) return 1; }', /may fall through.*got null/],
  ['fn f(): number { while (true) { break; } }', /may fall through/],
  ['let f: fn(number) -> number = fn(x: string): number { return len(x); };', /initializer.*fn/],
  ['let f: fn(fn(number) -> number) -> number = fn(g: fn(string) -> number): number { return g("x"); };', /initializer.*fn/],
  ['let flag: number = 1; if (flag) print(1);', /if condition.*boolean/],
  ['let flag: string = "x"; while (flag) {}', /while condition.*boolean/],
  ['let n: number = 2; print(n + "x");', /two numbers or two strings/],
  ['let n: number = 2; print(n and true);', /expected boolean/],
  ['let n: number = 2; n();', /cannot call number/],
  ['let n: Missing = 1;', /unknown type 'Missing'/],
  ['let n: any = 1; print = fn() {};', /cannot assign built-in/],
];
for (const [source, message] of staticErrors) test(`static diagnostic: ${source}`, () => sameError(source, 'type', message));

test('static failure happens before earlier print statements execute', () => {
  const output = [];
  assert.throws(() => run('print("must not run");\nlet n: number = "x";', { onOutput: text => output.push(text) }), error => {
    assert.equal(error.phase, 'type');
    assert.equal(error.span.line, 2);
    assert.equal(error.span.column, 17);
    return true;
  });
  assert.deepEqual(output, []);
});
test('return analysis handles both branches, infinite loops and unreachable breaks', () => {
  both('fn choose(b: boolean): number { if (b) return 1; else return 2; } fn loop(): number { while (true) { return 3; break; } } fn empty(): null {} print(choose(false), loop(), empty());', ['2 3 null']);
  assert.equal(check('fn diverge(): number { while (true) { while (true) { break; } } }').ok, true);
  assert.throws(() => check('fn f(b: boolean): number { while (true) { if (b) break; } }'), error => error.phase === 'type');
});

const boundaries = [
  ['let dynamic = "x"; let n: number = dynamic;', /expected number, got string/],
  ['let n: number = 1; let dynamic = "x"; n = dynamic;', /expected number, got string/],
  ['fn f(n: number): number { return n; } let dynamic = "x"; f(dynamic);', /expected number, got string/],
  ['fn f(): number { let dynamic = "x"; return dynamic; } f();', /expected number, got string/],
  ['let dynamic = fn(n) { return "x"; }; let f: fn(number) -> number = dynamic; f(1);', /expected number, got string/],
  ['let dynamic = fn(n) { return n; }; let f: fn(number) -> number = dynamic; let arg = "x"; f(arg);', /expected number, got string/],
  ['let dynamic = fn() { return 1; }; let f: fn(number) -> number = dynamic;', /function with 0 parameter/],
  ['let f: fn(number) -> number = fn(n: number): number { return n; }; let dynamic = fn(n) { return "x"; }; (f = dynamic)(1);', /expected number, got string/],
  ['fn use(f: fn(number) -> number): number { return f(1); } let dynamic = fn(n) { return "x"; }; use(dynamic);', /expected number, got string/],
  ['fn make(): fn(number) -> number { let dynamic = fn(n) { return "x"; }; return dynamic; } make()(1);', /expected number, got string/],
  ['let marker: number = 1; fn f() { return 1; } let dynamic = 5; f = dynamic;', /expected fn\(\) -> any, got number/],
];
for (const [source, message] of boundaries) test(`runtime gradual boundary: ${source}`, () => sameError(source, 'runtime', message));

test('runtime contracts remain enabled when static checking is explicitly skipped', () => {
  sameError('let n: number = "x";', 'runtime', /type contract/, { typecheck: false });
  sameError('fn f(): number {} f();', 'runtime', /expected number, got null/, { typecheck: false });
  sameError('fn f(n: number): number { return n; } f("x");', 'runtime', /expected number, got string/, { typecheck: false });
});
test('untyped named functions remain dynamic until static checking is requested', () => {
  both('fn f() {} f = 5; print(f);', ['5']);
  sameError('fn f() {} let dynamic = 5; f = dynamic;', 'runtime', /type contract/, { typecheck: true });
});
test('repeated mixed function contracts are bounded rather than growing without limit', () => {
  sameError('let f: any = fn(x) { return x; }; let i: number = 0; while (i < 100) { let strict: fn(number) -> number = f; let loose: fn(any) -> any = strict; f = loose; i = i + 1; }', 'limit', /contract depth/);
});
test('type nesting is bounded and unknown prototype-like type names are rejected', () => {
  assert.throws(() => check('let x: ' + 'fn() -> '.repeat(250) + 'number = null;'), error => error instanceof LangError && error.phase === 'limit');
  assert.throws(() => check('let x: __proto__ = null;'), error => error instanceof LangError && error.phase === 'type');
});
test('VM debug snapshots preserve declared types after stepping', () => {
  const vm = new VM(compile('let n: number = 3; print(n);'));
  vm.step(); vm.step();
  assert.deepEqual(vm.snapshot().scopes[0][0], { name: 'n', value: '3', type: 'number', declaredType: 'number' });
});
test('200 generated annotated programs agree across both execution engines', () => {
  let seed = 20261010;
  const pick = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let sample = 0; sample < 200; sample++) {
    const start = pick(40), count = pick(15) + 1, delta = pick(8) + 1;
    both(`fn make(n: number): fn(number) -> number { return fn(d: number): number { n = n + d; return n; }; }
      let f: fn(number) -> number = make(${start}); let i: number = 0; let total: number = 0;
      while (i < ${count}) { i = i + 1; if (i % 3 == 0) continue; total = total + f(${delta}); }
      fn apply(g: fn(number) -> number, x: number): number { return g(x); }
      print(total, apply(f, 0));`);
  }
});
