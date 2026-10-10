import { performance } from 'node:perf_hooks';
import { run } from '../src/index.js';

const sources = {
  dynamic: 'fn sum(n) { let i = 0; let total = 0; while (i < n) { total = total + i; i = i + 1; } return total; } print(sum(5000));',
  annotated: 'fn sum(n: number): number { let i: number = 0; let total: number = 0; while (i < n) { total = total + i; i = i + 1; } return total; } print(sum(5000));',
};
const results = [];
for (const engine of ['tree', 'vm']) {
  const modes = Object.keys(sources);
  for (let warmup = 0; warmup < 5; warmup++) {
    for (const mode of warmup % 2 ? [...modes].reverse() : modes) run(sources[mode], { engine });
  }
  const timings = Object.fromEntries(modes.map(mode => [mode, []]));
  const steps = {};
  // Counterbalance order: do not run all dynamic samples before all annotated
  // ones, which would give the latter more host-JIT warm-up for shared helpers.
  for (let sample = 0; sample < 20; sample++) {
    for (const mode of sample % 2 ? [...modes].reverse() : modes) {
      const start = performance.now();
      const result = run(sources[mode], { engine });
      timings[mode].push(performance.now() - start);
      if (result.output.join('\n') !== '12497500') throw new Error('type benchmark result mismatch');
      steps[mode] = result.steps;
    }
  }
  for (const mode of modes) {
    const times = timings[mode];
    times.sort((a, b) => a - b);
    results.push({ engine, mode, samples: times.length, median_ms: (times[9] + times[10]) / 2, p95_ms: times[18], steps: steps[mode] });
  }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, includes_frontend: true,
  sample_order: 'alternating-pairs', warmup_runs_per_mode: 5, results }, null, 2));
