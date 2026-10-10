import { run, check, compile, disassemble, VM, LangError, formatDiagnostic } from '../src/index.js';

let vm = null;
let source = '';
let filename = 'playground.itou';
let output = [];
self.onmessage = event => {
  const message = event.data;
  try {
    if (message.source !== undefined) { source = message.source; filename = message.filename; output = []; }
    if (message.type === 'run') {
      vm = null;
      const result = run(source, { engine: message.engine, maxSteps: 1000000, onOutput: text => output.push(text) });
      self.postMessage({ id: message.id, type: 'result', result });
    } else if (message.type === 'check') {
      vm = null;
      self.postMessage({ id: message.id, type: 'checked', report: check(source) });
    } else if (message.type === 'compile') {
      vm = null;
      self.postMessage({ id: message.id, type: 'compiled', assembly: disassemble(compile(source)) });
    } else if (message.type === 'debug') {
      const code = compile(source);
      vm = new VM(code);
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
      output: vm ? [...vm.context.output] : output, state: vm?.snapshot() });
  }
};
