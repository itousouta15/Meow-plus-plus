import { Worker } from 'node:worker_threads';
import { executable } from './executable.js';

const binary = executable();
const memory = new SharedArrayBuffer(32 * 1024 * 1024);
const control = new Int32Array(memory, 0, 2);
const bytes = new Uint8Array(memory, 8);
const worker = new Worker(new URL('./transport-worker.js', import.meta.url), { workerData: { binary, memory } });
worker.unref();
const decoder = new TextDecoder();

export function request(message) {
  // JSON also intentionally strips host callbacks from the C++ wire protocol.
  const text = JSON.stringify(message);
  Atomics.store(control, 0, 0);
  worker.postMessage(text);
  const status = Atomics.wait(control, 0, 0, 120000);
  if (status === 'timed-out') throw new Error('C++ 核心回應逾時');
  const length = Atomics.load(control, 1);
  return JSON.parse(decoder.decode(bytes.subarray(0, length)));
}
