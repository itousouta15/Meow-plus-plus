import { LangError, formatDiagnostic } from '../src/diagnostics.js';

// Install the message handler before asynchronous WebAssembly initialization.
// A message arriving during a module's top-level await otherwise has no handler.
let core = null;

let vm = null;
let source = '';
let filename = 'playground.itou';
let output = [];
self.onmessage = async event => {
  const message = event.data;
  try {
    core ??= import('../src/index.js');
    const { run, check, compile, disassemble, VM } = await core;
    if (message.source !== undefined) { source = message.source; filename = message.filename; output = []; }
    if (message.type === 'run') {
      vm?.dispose();
      vm = null;
      const result = run(source, { engine: message.engine, maxSteps: 1000000, input: message.input, onOutput: text => output.push(text) });
      self.postMessage({ id: message.id, type: 'result', result });
    } else if (message.type === 'check') {
      vm?.dispose();
      vm = null;
      self.postMessage({ id: message.id, type: 'checked', report: check(source) });
    } else if (message.type === 'compile') {
      vm?.dispose();
      vm = null;
      self.postMessage({ id: message.id, type: 'compiled', assembly: disassemble(compile(source)) });
    } else if (message.type === 'debug') {
      vm?.dispose();
      const code = compile(source);
      vm = new VM(code, { input: message.input });
      self.postMessage({ id: message.id, type: 'paused', state: vm.snapshot(), assembly: disassemble(code) });
    } else {
      if (!vm || vm.done) throw new Error('start a new debug session first');
      let state;
      if (message.type === 'step-line') state = vm.stepLine();
      else if (message.type === 'step-instruction') { vm.step(); state = vm.snapshot(); }
      else if (message.type === 'continue') state = vm.continue(new Set(message.breakpoints));
      else throw new Error(`unknown worker command ${message.type}`);
      self.postMessage({ id: message.id, type: 'paused', state });
    }
  } catch (error) {
    self.postMessage({ id: message.id, type: 'error', error: error instanceof LangError ? error.toJSON() : { phase: 'internal', message: error.message },
      formatted: error instanceof LangError ? formatDiagnostic(error, source, filename) : error.message,
      output: vm ? [...vm.context.output] : output,
      stdout: vm ? vm.context.stdout : error.stdout,
      stderr: vm ? vm.context.stderr : error.stderr, state: vm?.snapshot() });
  }
};
