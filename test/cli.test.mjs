import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/itou.mjs', import.meta.url));
function invoke(args, input = '') {
  const result = spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return result;
}
test('CLI executes stdin through both engines', () => {
  for (const engine of ['tree', 'vm']) {
    const result = invoke(['--engine', engine, '-'], 'print("你好", 6 * 7);');
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '你好 42\n');
  }
});
test('CLI structured results, bytecode and static checks', () => {
  const result = invoke(['--json', '-'], 'let n = 3; print(n);');
  assert.deepEqual(JSON.parse(result.stdout).output, ['3']);
  assert.equal(invoke(['--check', '-'], 'while (true) {}').stdout, 'OK\n');
  assert.match(invoke(['--disassemble', '-'], 'print(1 + 2);').stdout, /BINARY/);
});
test('CLI preserves output before errors and reports source location', () => {
  const result = invoke(['--json', '-'], 'print("before"); print(1 / 0);');
  assert.equal(result.status, 1);
  const value = JSON.parse(result.stdout);
  assert.deepEqual(value.output, ['before']);
  assert.equal(value.error.phase, 'runtime');
  const text = invoke(['-'], 'print(1 / 0);');
  assert.match(text.stderr, /:1:9: runtime: division by zero/);
});
test('CLI rejects bad arguments and enforces fuel', () => {
  assert.equal(invoke(['--engine', 'bad', '-']).status, 64);
  assert.equal(invoke(['--max-steps', '-1', '-']).status, 64);
  assert.equal(invoke(['--max-steps', '100', '-'], 'while (true) {}').status, 1);
  assert.equal(invoke(['does-not-exist.itou']).status, 1);
});
test('CLI checks and reports structural types without running the program', () => {
  const checked = invoke(['--check', '--json', '-'], 'fn f(n: number): number { return n; } while (true) {}');
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).globals[0].type, 'fn(number) -> number');
  const failure = invoke(['--check', '--json', '-'], 'let n: number = "x";');
  assert.equal(failure.status, 1);
  assert.equal(JSON.parse(failure.stdout).error.phase, 'type');
});
test('CLI static override preserves runtime type contracts', () => {
  const result = invoke(['--no-typecheck', '--json', '-'], 'let n: number = "x";');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.phase, 'runtime');
  assert.equal(invoke(['--check', '--no-typecheck', '-']).status, 64);
});
