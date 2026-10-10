import test from 'node:test';
import assert from 'node:assert/strict';
import { run, LangError } from '../src/index.js';

function random(seed) {
  let state = seed >>> 0;
  return n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
}

// Generate bounded programs with nested arithmetic, recursion, closure updates,
// branching and scope-unwinding. Compare observables, not implementation steps.
test('500 seeded generated programs agree between tree interpreter and bytecode VM', () => {
  const pick = random(0x1a70cafe);
  const expr = (depth = 0) => {
    if (depth >= 3 || pick(3) === 0) return String(pick(19) - 9);
    return `(${expr(depth + 1)} ${['+', '-', '*'][pick(3)]} ${expr(depth + 1)})`;
  };
  for (let sample = 0; sample < 500; sample++) {
    const count = pick(12) + 1;
    const skip = pick(4) + 2;
    const limit = pick(5) + 1;
    const source = `
      fn make(seed) {
        let n = seed;
        return fn(delta) { n = n + delta; return n; };
      }
      fn fold(n) { if (n <= 0) return 0; return n + fold(n - 1); }
      let counter = make(${expr()});
      let total = 0;
      let i = 0;
      while (i < ${count}) {
        i = i + 1;
        { let copy = i;
          if (i % ${skip} == 0) continue;
          let j = 0;
          while (true) { j = j + 1; if (j > ${limit}) break; total = total + j; }
          total = total + counter(copy) + ${expr()};
        }
      }
      print(total, counter(0), fold(${pick(9)}), ${expr()});
      print((total < 0 and i > 0) or total >= 0);
    `;
    const tree = run(source, { engine: 'tree' });
    const vm = run(source, { engine: 'vm' });
    assert.deepEqual(vm.output, tree.output, `sample ${sample}\n${source}`);
    assert.deepEqual(vm.globals, tree.globals, `sample ${sample}\n${source}`);
  }
});

test('seeded malformed sources fail only with structured diagnostics', () => {
  const pick = random(20261010);
  const parts = ['let', 'fn', 'if', 'while', 'return', 'break', '(', ')', '{', '}', ';', '=', '+', '!', '1', 'x', '"s"', 'null'];
  for (let sample = 0; sample < 300; sample++) {
    const source = Array.from({ length: pick(30) + 1 }, () => parts[pick(parts.length)]).join(' ');
    const outcomes = ['tree', 'vm'].map(engine => {
      try { return { output: run(source, { engine, maxSteps: 1000 }).output }; }
      catch (error) { assert.ok(error instanceof LangError, `${source}\n${error.stack}`); return error.toJSON(); }
    });
    assert.deepEqual(outcomes[0], outcomes[1], source);
  }
});
