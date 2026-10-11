import test from 'node:test';
import assert from 'node:assert/strict';
import * as native from '../src/index.js';
import * as reference from '../src/reference.js';

function all(source, expected, options = {}) {
  const results = [];
  for (const api of [native, reference]) for (const engine of ['tree', 'vm']) {
    const result = api.run(source, { ...options, engine });
    assert.equal(result.stdout, expected.stdout);
    assert.equal(result.stderr, expected.stderr ?? '');
    if (expected.output) assert.deepEqual(result.output, expected.output);
    results.push(result);
  }
  for (const result of results) assert.deepEqual(result.globals, results[0].globals);
  return results[0];
}

test('喵out chains values without implicit spaces or newlines', () => {
  all('喵out << "答案：" << 42; 喵out << 喵endl << "喵" << 喵endl;', { stdout: '答案：42\n喵\n', output: ['答案：42', '喵'] });
  all('喵out << "沒有換行";', { stdout: '沒有換行', output: ['沒有換行'] });
  all('喵out << 喵endl << 喵endl;', { stdout: '\n\n', output: ['', ''] });
  all('整數 數值 = 0; 喵out << 數值++ << "," << ++數值 << 喵endl;', { stdout: '0,2\n' });
});

test('喵in extracts chained values by declared type into default-initialized variables', () => {
  const result = all(`整數 數量; 浮點數 值; 字串 名字; 布林 啟用;
    喵in >> 數量 >> 值 >> 名字 >> 啟用;
    喵out << 數量 << "," << 值 << "," << 名字 << "," << 啟用 << 喵endl;`,
  { stdout: '3,-4.5,喵,true\n' }, { input: '3 -4.5 喵 真' });
  assert.deepEqual(result.globals, { 數量: 3, 值: -4.5, 名字: '喵', 啟用: true });
  all('自動 動態 = 空; 喵in >> 動態; 喵out << 喵型(動態);', { stdout: 'string' }, { input: '42' });
  all('整數 數值; 字串 文字; 布林 條件; 喵out << 數值 << 文字 << 條件;', { stdout: '0false' });
  assert.throws(() => native.run('自動 數值;'), error => error.phase === 'parse');
});

test('喵getline preserves spaces and shares the cursor with 喵in and legacy reads', () => {
  all('字串 第一行; 字串 第二行; 喵getline(喵in, 第一行); 喵getline(喵in, 第二行); 喵out << 第一行 << "|" << 第二行;',
    { stdout: '你好 世界|下一行' }, { input: '你好 世界\r\n下一行' });
  all('整數 數值; 字串 剩餘; 喵in >> 數值; 喵getline(喵in, 剩餘); 喵out << 數值 << "[" << 剩餘 << "]" << 讀();',
    { stdout: '7[ 尾巴]下一個' }, { input: '7 尾巴\n下一個' });
  all('字串 空行; 喵getline(喵in, 空行); 喵out << "[" << 空行 << "]";', { stdout: '[]' }, { input: '\n' });
});

test('喵err and 喵log share stderr without mixing into stdout', () => {
  all('喵out << "結果"; 喵err << "錯誤" << 喵endl; 喵log << "紀錄"; 喵out << 喵endl;',
    { stdout: '結果\n', stderr: '錯誤\n紀錄', output: ['結果'] });
  all('cout << "相容" << endl; cerr << "錯"; clog << "誤";', { stdout: '相容\n', stderr: '錯誤' });
});

test('stream output interleaves with 喵 calls and preserves multiline print records', () => {
  all('喵out << "前綴："; 喵("答案", 42); 喵out << "最後";',
    { stdout: '前綴：答案 42\n最後', output: ['前綴：答案 42', '最後'] });
  all('喵("甲\\n乙"); 喵out << "丙\\n丁";', { stdout: '甲\n乙\n丙\n丁', output: ['甲\n乙', '丙', '丁'] });
});

test('stream extraction diagnostics match both engines and the independent reference', () => {
  for (const [source, input, phase] of [
    ['整數 數值; 喵in >> 數值;', '', 'runtime'],
    ['整數 數值; 喵in >> 數值;', '不是數字', 'runtime'],
    ['布林 條件; 喵in >> 條件;', '也許', 'runtime'],
    ['空 沒有; 喵in >> 沒有;', 'x', 'type'],
    ['整數 數值; 喵getline(喵in, 數值);', '1', 'type'],
    ['喵in >> 稍後; 整數 稍後;', '1', 'runtime'],
    ['整數 數值; 喵in >> 喵;', '1', 'type'],
    ['喵in >> 未宣告;', '1', 'resolve'],
    ['喵in >> (1 + 2);', '1', 'parse'],
    ['喵getline(喵out, 文字);', '', 'parse'],
  ]) {
    const diagnostics = [];
    for (const api of [native, reference]) for (const engine of ['tree', 'vm']) {
      assert.throws(() => api.run(source, { engine, input }), error => {
        assert.equal(error.phase, phase);
        diagnostics.push(error.toJSON());
        return true;
      });
    }
    for (const diagnostic of diagnostics) assert.deepEqual(diagnostic, diagnostics[0]);
  }
  for (const api of [native, reference]) assert.throws(() => api.run('空 沒有; 喵in >> 沒有;', { input: 'x', typecheck: false }), error => error.phase === 'runtime');
});

test('partial stream output and stderr survive runtime failure', () => {
  for (const api of [native, reference]) for (const engine of ['tree', 'vm']) {
    const output = [];
    assert.throws(() => api.run('喵err << "注意"; 喵out << "前" << 1 / 0;', { engine, onOutput: text => output.push(text) }), error => {
      assert.equal(error.phase, 'runtime');
      if (api === native) { assert.equal(error.stdout, '前'); assert.equal(error.stderr, '注意'); }
      return true;
    });
    assert.deepEqual(output, ['前']);
  }
});

test('stream I/O obeys output/string budgets and debug snapshots retain partial writes', () => {
  for (const api of [native, reference]) for (const engine of ['tree', 'vm']) {
    assert.throws(() => api.run('喵out << "123"; 喵err << "456";', { engine, maxOutput: 5 }), error => error.phase === 'limit');
    assert.throws(() => api.run('字串 文字; 喵in >> 文字;', { engine, input: 'x'.repeat(65537) }), error => error.phase === 'limit');
  }
  const vm = new native.VM(native.compile('喵out << "前";\n整數 數值;\n喵in >> 數值;\n喵out << 數值 << 喵endl;'), { input: '42' });
  try {
    const first = vm.continue(new Set([3]));
    assert.equal(first.stdout, '前');
    const end = vm.continue();
    assert.equal(end.stdout, '前42\n');
    assert.equal(end.done, true);
  } finally { vm.dispose(); }
});
