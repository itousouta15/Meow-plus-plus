import { parentPort, workerData } from 'node:worker_threads';
import { spawn } from 'node:child_process';

const control = new Int32Array(workerData.memory, 0, 2);
const bytes = new Uint8Array(workerData.memory, 8);
const encoder = new TextEncoder();
const child = spawn(workerData.binary, ['--protocol'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let buffer = '', failure = null;
function deliver(text) {
  const data = encoder.encode(text);
  if (data.length > bytes.length) { fail('C++ 核心回應超過 32 MiB'); return; }
  bytes.set(data);
  Atomics.store(control, 1, data.length);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
}
function fail(message) {
  failure = JSON.stringify({ error: { phase: 'internal', message }, output: [] });
  deliver(failure);
}
child.stdout.setEncoding('utf8');
child.stdout.on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); deliver(line); }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', data => fail(data.trim()));
child.on('error', error => fail(error.message));
child.on('exit', code => fail(`C++ 核心已結束（${code}）`));
child.stdin.on('error', error => fail(error.message));
parentPort.on('message', text => { if (failure) deliver(failure); else child.stdin.write(`${text}\n`); });
