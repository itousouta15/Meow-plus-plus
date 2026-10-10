import { LangError, fail } from './diagnostics.js';
import { Environment, Context, builtins, boolean, unary, binary, prepareCall, finishCall, globalValues, inspect } from './runtime.js';

export class VM {
  constructor(proto, options = {}) {
    this.proto = proto;
    this.context = new Context(options);
    this.globals = new Environment(proto.layout, builtins(this.context), proto.types);
    this.frames = [{ proto, ip: 0, env: this.globals, base: 0, callSpan: proto.span, id: 0 }];
    this.nextFrameId = 1;
    this.stack = [];
    this.done = false;
    this.error = null;
    this.lastInstruction = null;
  }
  get frame() { return this.frames.at(-1); }
  get location() {
    return this.error?.span ?? (!this.done ? this.frame?.proto.code[this.frame.ip]?.span : null) ?? this.lastInstruction?.span ?? this.proto.span;
  }
  pop() {
    if (this.stack.length === 0) throw new Error('VM stack underflow');
    return this.stack.pop();
  }
  peek() {
    if (this.stack.length === 0) throw new Error('VM stack underflow');
    return this.stack.at(-1);
  }
  step() {
    if (this.done) return false;
    const frame = this.frame;
    const instruction = frame.proto.code[frame.ip];
    if (!instruction) throw new Error('VM instruction pointer out of bounds');
    const { op, arg, span } = instruction;
    this.lastInstruction = instruction;
    try {
      this.context.tick(span);
      frame.ip++;
      switch (op) {
        case 'CONST': this.stack.push(frame.proto.constants[arg]); break;
        case 'POP': this.pop(); break;
        case 'DUP': this.stack.push(this.peek()); break;
        case 'LOAD': this.stack.push(frame.env.get(arg, span)); break;
        case 'STORE': this.stack[this.stack.length - 1] = frame.env.set(arg, this.peek(), span); break;
        case 'INIT': frame.env.initialize(arg, this.pop(), span); break;
        case 'ENTER': frame.env = new Environment(arg.names, frame.env, arg.types); break;
        case 'LEAVE': frame.env = frame.env.parent; break;
        case 'UNWIND': for (let i = 0; i < arg; i++) frame.env = frame.env.parent; break;
        case 'UNARY': this.stack.push(unary(arg, this.pop(), span)); break;
        case 'BINARY': {
          const right = this.pop(), left = this.pop();
          this.stack.push(binary(arg, left, right, span));
          break;
        }
        case 'BOOL': boolean(this.peek(), span); break;
        case 'JUMP': frame.ip = arg; break;
        case 'JUMP_FALSE': if (!boolean(this.pop(), span)) frame.ip = arg; break;
        case 'JUMP_TRUE': if (boolean(this.pop(), span)) frame.ip = arg; break;
        case 'CLOSURE':
          this.stack.push({ kind: 'function', engine: 'vm', name: arg.name, arity: arg.params.length, proto: arg, environment: frame.env,
            parameterTypes: arg.parameterTypes, returnType: arg.returnType });
          break;
        case 'CALL': {
          if (this.stack.length < arg + 1) throw new Error('VM call stack underflow');
          const arguments_ = this.stack.splice(this.stack.length - arg, arg);
          const call = prepareCall(this.pop(), arguments_, span);
          const { callee, args } = call;
          if (callee.kind === 'builtin') { this.stack.push(finishCall(call, callee.call(args, span), span)); break; }
          if (this.frames.length - 1 >= this.context.maxDepth) fail('呼叫深度超過上限', span, 'limit');
          const local = new Environment(callee.proto.layout, callee.environment, callee.proto.types);
          for (let i = 0; i < args.length; i++) local.initialize(i, args[i], span);
          this.frames.push({ proto: callee.proto, ip: 0, env: local, base: this.stack.length, callSpan: span, call, id: this.nextFrameId++ });
          break;
        }
        case 'RETURN': {
          const value = finishCall(frame.call, this.pop(), span);
          this.stack.length = frame.base;
          this.frames.pop();
          if (this.frames.length === 0) throw new Error('VM return from script');
          this.stack.push(value);
          break;
        }
        case 'HALT':
          if (this.frames.length !== 1 || this.stack.length !== 0) throw new Error('VM unbalanced stack at halt');
          this.done = true;
          break;
        default: throw new Error(`unknown opcode ${op}`);
      }
    } catch (error) {
      if (error instanceof LangError && error.frames.length === 0)
        error.frames = this.frames.slice(1).map(f => ({ name: f.proto.name, span: f.callSpan }));
      this.error = error;
      this.done = true;
      throw error;
    }
    return !this.done;
  }
  run() {
    while (!this.done) this.step();
    if (this.error) throw this.error;
    return { output: [...this.context.output], globals: globalValues(this.globals), steps: this.context.steps, engine: 'vm' };
  }
  // A source step stops at a line change, a call/return, or a backward jump.
  // This also makes progress observable for loops written on a single line.
  stepLine() {
    if (this.done) return this.snapshot();
    const line = this.location.line;
    const frameId = this.frame.id;
    let previousIp = this.frame.ip;
    do {
      this.step();
      if (this.done || this.frame.id !== frameId || this.location.line !== line || this.frame.ip <= previousIp) break;
      previousIp = this.frame.ip;
    } while (!this.done);
    return this.snapshot();
  }
  continue(breakpoints = new Set()) {
    // Always move beyond the currently paused position before re-checking.
    do { this.stepLine(); }
    while (!this.done && !breakpoints.has(this.location.line));
    return this.snapshot();
  }
  snapshot() {
    const scopes = [];
    let env = this.frame?.env;
    while (env?.parent) {
      scopes.push(env.snapshot());
      env = env.parent;
    }
    return {
      done: this.done,
      steps: this.context.steps,
      location: this.location,
      instruction: !this.done ? { index: this.frame.ip, op: this.frame.proto.code[this.frame.ip]?.op, functionId: this.frame.proto.id } : null,
      stack: this.stack.map(inspect),
      frames: this.frames.map(f => ({ name: f.proto.name, ip: f.ip, line: f.proto.code[f.ip]?.span.line ?? f.callSpan.line })),
      scopes,
      output: [...this.context.output],
      globals: globalValues(this.globals),
    };
  }
}
