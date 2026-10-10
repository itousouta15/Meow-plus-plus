import { performance } from 'node:perf_hooks';
import { run } from '../src/index.js';

const source = `fn sum(n) { let i = 0; let result = 0; while (i < n) { result = result + i; i = i + 1; } return result; } print(sum(5000));`;
const results = [];
for (const engine of ['tree', 'vm']) {
  for (let i = 0; i < 3; i++) run(source, { engine });
  const times = [];
  let steps;
  for (let sample = 0; sample < 10; sample++) {
    const start = performance.now();
    const result = run(source, { engine });
    times.push(performance.now() - start);
    if (result.output[0] !== '12497500') throw new Error('benchmark result mismatch');
    steps = result.steps;
  }
  times.sort((a, b) => a - b);
  results.push({ engine, samples: times.length, median_ms: (times[4] + times[5]) / 2, p95_ms: times[9], steps });
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, includes_frontend: true, results }, null, 2));
