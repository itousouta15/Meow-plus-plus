// The public API uses the same C++ core on Node.js and in browser Workers.
// The JavaScript implementation in reference.js is an independent test oracle.
import { LangError, formatDiagnostic } from './diagnostics.js';
import { typeName, assignable } from './types.js';

export { LangError, formatDiagnostic, typeName, assignable };
const { request } = typeof process !== 'undefined' && process.versions?.node
  ? await import('./node/transport.js')
  : await import('./wasm-transport.js');

function invoke(message, options = {}) {
  const reply = request(message);
  for (const text of reply.error ? reply.output ?? [] : reply.result?.output ?? []) options.onOutput?.(text);
  if (reply.error) {
    const { phase, message, span, frames } = reply.error;
    if (phase === 'internal' && /must be|引擎必須/.test(message)) throw new TypeError(message);
    const error = new LangError(phase, message, span, frames);
    error.output = reply.output ?? [];
    error.stdout = reply.stdout ?? '';
    error.stderr = reply.stderr ?? '';
    error.state = reply.state;
    throw error;
  }
  return reply;
}
const sourceRequest = (type, source, options = {}) => {
  if (typeof source !== 'string') throw new TypeError('原始碼必須是字串');
  return invoke({ type, source, options }, options).result;
};
export const tokenize = source => sourceRequest('tokenize', source);
export const parse = source => sourceRequest('parse', source);
export const analyze = (source, options = {}) => sourceRequest('analyze', source, options);
export const check = source => sourceRequest('check', source);
export const compile = (source, options = {}) => sourceRequest('compile', source, options);
export function run(source, options = {}) { return sourceRequest('run', source, options); }
export const resolve = ast => invoke({ type: 'resolve', ast }).result;
export const compileAst = ast => invoke({ type: 'compile-ast', ast }).result;
export const disassemble = proto => invoke({ type: 'disassemble', proto }).result;
export function checkProgram(ast) {
  const reply = invoke({ type: 'check-program', ast });
  Object.assign(ast, reply.ast);
  return reply.result;
}
export function prototypes(root) {
  return [root, ...root.code.filter(ins => ins.op === 'CLOSURE').flatMap(ins => prototypes(ins.arg))];
}
const cleanup = new FinalizationRegistry(session => { try { request({ type: 'dispose', session }); } catch { /* process shutdown */ } });
export class VM {
  constructor(proto, options = {}) {
    this.proto = proto;
    this.options = options;
    this.context = { output: [], stdout: '', stderr: '', steps: 0 };
    this.emitted = 0;
    const reply = invoke({ type: 'debug', proto, options });
    this.session = reply.session;
    this.state = reply.result;
    cleanup.register(this, this.session, this);
  }
  get done() { return this.state.done; }
  get location() { return this.state.location; }
  update(state) {
    this.state = state;
    this.context.output = state.output;
    this.context.stdout = state.stdout;
    this.context.stderr = state.stderr;
    this.context.steps = state.steps;
    for (const text of state.output.slice(this.emitted)) this.options.onOutput?.(text);
    this.emitted = state.output.length;
    return state;
  }
  command(type, extra = {}) {
    try {
      const reply = invoke({ type, session: this.session, ...extra });
      this.update(reply.state ?? reply.result);
      return reply;
    } catch (error) { if (error.state) this.update(error.state); throw error; }
  }
  step() { return this.command('step-instruction').more; }
  stepLine() { return this.command('step-line').result; }
  continue(breakpoints = new Set()) { return this.command('continue', { breakpoints: [...breakpoints] }).result; }
  snapshot() { return this.state; }
  run() { return this.command('vm-run').result; }
  dispose() {
    if (this.session !== null) invoke({ type: 'dispose', session: this.session });
    cleanup.unregister(this);
    this.session = null;
  }
}
export class Interpreter {
  constructor(program, options = {}) { this.program = program; this.options = options; this.context = { output: [], steps: 0 }; }
  run() {
    const result = invoke({ type: 'interpret-ast', ast: this.program, options: this.options }, this.options).result;
    this.context = { output: result.output, stdout: result.stdout, stderr: result.stderr, steps: result.steps };
    return result;
  }
}
