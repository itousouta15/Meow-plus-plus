#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { executable } from '../src/node/executable.js';

try {
  const child = spawnSync(executable(), process.argv.slice(2), { stdio: 'inherit' });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
