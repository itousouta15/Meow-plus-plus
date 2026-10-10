import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.m?js$/.test(entry.name) ? [path] : [];
  });
}
let count = 0;
for (const file of ['src', 'web', 'bin', 'tools', 'test', 'e2e'].flatMap(name => files(join(root, name)))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(relative(root, file), result.stderr); process.exit(1); }
  count++;
}
console.log(`Syntax checked ${count} JavaScript modules.`);
