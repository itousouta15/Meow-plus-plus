import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as native from '../src/index.js';
import * as reference from '../src/reference.js';

function engines(source, output) {
  const results = [];
  for (const api of [native, reference]) for (const engine of ['tree', 'vm']) {
    const result = api.run(source, { engine });
    assert.deepEqual(result.output, output);
    results.push(result.globals);
  }
  for (const globals of results) assert.deepEqual(globals, results[0]);
}

test('C++ declarations, automatic main entry and logical short circuit', () => {
  engines(`int twice(int n) { return n * 2; }
    int main() {
      int n = 0;
      bool b = false && (++n == 1) || true;
      print(twice(21), n, b);
      return 0;
    }`, ['42 0 true']);
  assert.throws(() => native.check('int main(int n) { return n; }'), error => error.phase === 'type');
});

test('for continue executes update, break skips it, and initializer scope is local', () => {
  engines(`int n = 0; int total = 0;
    for (int i = 0; i < 8; ++i) {
      { if (i == 2) continue; if (i == 5) break; total += i; }
      ++n;
    }
    print(total, n);
    for (n = 0; ; n += 1) { if (n == 3) break; }
    print(n);`, ['8 4', '3']);
  assert.throws(() => native.run('for (int i = 0; i < 1; ++i) {} print(i);'), error => error.phase === 'resolve');
});

test('prefix, postfix and compound assignment have expression values and stable order', () => {
  engines('int n = 2; print(n++, ++n, n--, --n); print(n += 5, n *= 2, n /= 7, n %= 2);', ['2 4 4 2', '7 14 2 0']);
  engines('int i = 0; int sum = 0; for (; i < 3; i++) { for (int j = 0; j < 4; ++j) { if (j == 1) continue; sum += 1; } } print(i, sum);', ['3 9']);
});

test('structural C++ function types and escaping reference-capture lambdas', () => {
  engines(`function<int(int)> counter(int start) {
      int value = start;
      return [&](int step) -> int { value += step; return value; };
    }
    int apply(function<int(int)> f, int n) { return f(n); }
    auto f = counter(10);
    print(apply(f, 1), f(5));`, ['11 16']);
  engines(`auto a = null; auto b = null;
    for (int i = 0; i < 2; ++i) {
      int copy = i;
      if (i == 0) a = [&]() -> int { return copy; };
      else b = [&]() -> int { return copy; };
    }
    print(a(), b());`, ['0 1']);
});

test('C++ types reject invalid initialization, mutation and returns before execution', () => {
  for (const source of ['int n = "bad";', 'bool b = true; b++;', 'int f() { return "bad"; }', 'void f() { return 1; }', 'int f(int n) { return n; } f(false);']) {
    for (const api of [native, reference]) assert.throws(() => api.run(source), error => error.phase === 'type');
  }
  assert.throws(() => native.run('int n = "bad";', { typecheck: false }), error => error.phase === 'runtime');
  engines('double n = 5 / 2; float f = n; string s = "x"; print(n, f, s);', ['2.5 2.5 x']);
});

test('C++ frontend and bytecode agree with the independent JavaScript reference', () => {
  const directory = new URL('../examples/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.itou'))) {
    const source = readFileSync(new URL(name, directory), 'utf8');
    assert.deepEqual(native.tokenize(source), reference.tokenize(source), name);
    assert.deepEqual(native.analyze(source), reference.analyze(source), name);
    assert.deepEqual(native.compile(source), reference.compile(source), name);
  }
});

test('independent VM sessions preserve state, errors and cleanup', () => {
  const a = new native.VM(native.compile('int n = 1; print(n);'));
  const b = new native.VM(native.compile('int n = 2; print(n);'));
  try {
    a.step(); b.step();
    assert.deepEqual(a.run().output, ['1']);
    assert.deepEqual(b.run().output, ['2']);
    const failed = new native.VM(native.compile('print("before"); print(1 / 0);'));
    try {
      assert.throws(() => failed.run(), error => error.phase === 'runtime');
      assert.equal(failed.done, true);
      assert.deepEqual(failed.snapshot().output, ['before']);
    } finally { failed.dispose(); }
  } finally { a.dispose(); b.dispose(); }
});

test('UTF-16 diagnostic spans match the editor after Unicode strings', () => {
  const source = 'string s = "你🙂";\nprint(s);\nint n = "bad";';
  assert.deepEqual(native.tokenize(source), reference.tokenize(source));
  for (const api of [native, reference]) assert.throws(() => api.run(source), error => {
    assert.equal(error.span.line, 3);
    assert.equal(error.span.start, source.indexOf('"bad"'));
    return error.phase === 'type';
  });
});
test('native decimal underflow, BOM and Unicode whitespace match the reference', () => {
  engines('\ufeffint\u3000n = 1e-999; print(n, number("-1e-999"));', ['0 0']);
  for (const api of [native, reference]) assert.throws(() => api.run('int café = 1;'), error => error.phase === 'lex');
});

test('Chinese type-first main, loops and mixed English keywords execute in all engines', () => {
  engines(`整數 平方(整數 數值) { 回傳 數值 * 數值; }
    整數 主程式() {
      整數 總和 = 0;
      迴圈 (整數 索引 = 1; 索引 <= 5; ++索引) {
        如果 (索引 == 3) 繼續;
        總和 += 平方(索引);
      }
      布林 完成 = 真 且 總和 == 46 或 假;
      喵(總和, 完成);
      回傳 0;
    }`, ['46 true']);
  engines('無值 主程式() { 浮點數 值 = 2.5; 小數 副本 = 值; 自動 動態 = 副本; 空 沒有 = 空; 對於 (int 索引 = 0; 索引 < 1; ++索引) 喵(動態, 沒有); }', ['2.5 null']);
});

test('Chinese structural function types nest and coexist with legacy fn annotations', () => {
  engines(`函式<函式<整數(整數)>(整數)> 工廠 = [&](整數 起始) -> 函式<整數(整數)> {
      回傳 [&](整數 增量) -> 整數 { 起始 += 增量; 回傳 起始; };
    };
    函式<整數(整數)> 計數 = 工廠(10);
    令 同一隻: 函式(數字) -> 數字 = 計數;
    喵(計數(1), 同一隻(5));`, ['11 16']);
});

test('Chinese entry points enforce signatures and reject ambiguous dual entries', () => {
  for (const api of [native, reference]) for (const source of [
    '整數 主程式(整數 參數) { 回傳 參數; }',
    '字串 主程式() { 回傳 "喵"; }',
    '整數 主程式() { 回傳 0; } int main() { return 0; }',
  ]) assert.throws(() => api.run(source), error => error.phase === 'type');
});
