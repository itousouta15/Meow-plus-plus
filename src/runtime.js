import { fail } from './diagnostics.js';
import { ANY, typeName, sameType, acceptsArity } from './types.js';

export const UNINITIALIZED = Symbol('uninitialized');
export const builtinNames = ['print', 'len', 'str', 'number', 'type', 'sqrt', 'assert'];

export function typeOf(value) {
  if (value === null) return 'null';
  if (typeof value === 'object' && value?.kind) return 'function';
  return typeof value;
}
export function display(value) {
  if (value === UNINITIALIZED) return '<uninitialized>';
  if (value === null) return 'null';
  if (typeof value === 'object') return `<fn ${value.name}>`;
  return String(value);
}
export function inspect(value) {
  return typeof value === 'string' ? JSON.stringify(value) : display(value);
}
export function boolean(value, span) {
  if (typeof value !== 'boolean') fail(`expected boolean, got ${typeOf(value)}`, span);
  return value;
}
function numeric(value, span) {
  if (typeof value !== 'number') fail(`expected number, got ${typeOf(value)}`, span);
  return value;
}
function finite(value, span) {
  if (!Number.isFinite(value)) fail('numeric result is not finite', span);
  return value;
}

export function unary(op, value, span) {
  if (op === '!') return !boolean(value, span);
  if (op === '-') return finite(-numeric(value, span), span);
  throw new Error(`unknown unary operator ${op}`);
}
export function binary(op, a, b, span) {
  if (op === '==') return underlying(a) === underlying(b);
  if (op === '!=') return underlying(a) !== underlying(b);
  if (op === '+' && typeof a === 'string' && typeof b === 'string') {
    if (a.length + b.length > 65536) fail('string exceeds 65536 code units', span, 'limit');
    return a + b;
  }
  numeric(a, span); numeric(b, span);
  switch (op) {
    case '+': return finite(a + b, span);
    case '-': return finite(a - b, span);
    case '*': return finite(a * b, span);
    case '/': if (b === 0) fail('division by zero', span); return finite(a / b, span);
    case '%': if (b === 0) fail('remainder by zero', span); return finite(a % b, span);
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    default: throw new Error(`unknown binary operator ${op}`);
  }
}

function underlying(value) {
  while (value?.kind === 'contract') value = value.target;
  return value;
}

export function guardType(type, value, span) {
  if (type.kind === 'any') return value;
  if (type.kind !== 'function') {
    if (typeOf(value) !== type.kind) fail(`type contract: expected ${typeName(type)}, got ${typeOf(value)}`, span);
    return value;
  }
  if (typeOf(value) !== 'function') fail(`type contract: expected ${typeName(type)}, got ${typeOf(value)}`, span);
  if (value.arity !== null && !acceptsArity(type, value.arity))
    fail(`type contract: expected ${typeName(type)}, got function with ${value.arity} parameter(s)`, span);
  if (value.kind === 'contract' && sameType(value.contract, type)) return value;
  const depth = (value.contractDepth ?? 0) + 1;
  if (depth > 64) fail('function contract depth limit exceeded', span, 'limit');
  return { kind: 'contract', name: value.name, arity: type.params.length, target: value, contract: type, contractDepth: depth };
}

export class Environment {
  constructor(names, parent = null, types = []) {
    this.names = names;
    this.cells = names.map(() => UNINITIALIZED);
    this.parent = parent;
    this.types = names.map((_, i) => types[i] ?? ANY);
  }
  ancestor(depth) {
    let env = this;
    for (let i = 0; i < depth; i++) env = env.parent;
    if (!env) throw new Error('invalid lexical address');
    return env;
  }
  get(address, span) {
    const value = this.ancestor(address.depth).cells[address.slot];
    if (value === UNINITIALIZED) fail(`cannot access '${address.name}' before initialization`, span);
    return value;
  }
  set(address, value, span) {
    const env = this.ancestor(address.depth);
    if (env.cells[address.slot] === UNINITIALIZED) fail(`cannot assign '${address.name}' before initialization`, span);
    if (env.parent === null) fail(`cannot assign built-in '${address.name}'`, span);
    const guarded = guardType(env.types[address.slot], value, span);
    env.cells[address.slot] = guarded;
    return guarded;
  }
  initialize(slot, value, span) {
    if (this.cells[slot] !== UNINITIALIZED) throw new Error('binding initialized twice');
    this.cells[slot] = guardType(this.types[slot], value, span);
  }
  snapshot() {
    return this.names.map((name, index) => ({ name, value: inspect(this.cells[index]), type: this.cells[index] === UNINITIALIZED ? 'pending' : typeOf(this.cells[index]), declaredType: typeName(this.types[index]) }));
  }
}

export class Context {
  constructor(options = {}) {
    this.maxSteps = options.maxSteps ?? 1000000;
    this.maxDepth = options.maxDepth ?? 100;
    this.maxOutput = options.maxOutput ?? 100000;
    for (const [name, value] of [['maxSteps', this.maxSteps], ['maxDepth', this.maxDepth], ['maxOutput', this.maxOutput]]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`);
    }
    if (this.maxDepth > 100) throw new TypeError('maxDepth must be at most 100');
    this.steps = 0;
    this.output = [];
    this.outputSize = 0;
    this.onOutput = options.onOutput ?? (() => {});
  }
  tick(span) {
    if (++this.steps > this.maxSteps) fail(`execution exceeded ${this.maxSteps} steps`, span, 'limit');
  }
  emit(text, span) {
    if (this.outputSize + text.length + 1 > this.maxOutput) fail('output limit exceeded', span, 'limit');
    this.output.push(text);
    this.outputSize += text.length + 1;
    this.onOutput(text);
  }
}

export function builtins(context) {
  const env = new Environment(builtinNames);
  const functions = {
    print: { arity: null, call: (args, span) => { context.emit(args.map(display).join(' '), span); return null; } },
    len: { arity: 1, call: ([value], span) => {
      if (typeof value !== 'string') fail(`len expects string, got ${typeOf(value)}`, span);
      return [...value].length;
    } },
    str: { arity: 1, call: ([value]) => display(value) },
    number: { arity: 1, call: ([value], span) => {
      if (typeof value !== 'string' || !/^-?(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?$/.test(value))
        fail('number expects a decimal numeric string', span);
      return finite(Number(value), span);
    } },
    type: { arity: 1, call: ([value]) => typeOf(value) },
    sqrt: { arity: 1, call: ([value], span) => finite(Math.sqrt(numeric(value, span)), span) },
    assert: { arity: 1, call: ([value], span) => {
      if (!boolean(value, span)) fail('assertion failed', span);
      return null;
    } },
  };
  for (let i = 0; i < builtinNames.length; i++) {
    const name = builtinNames[i];
    env.initialize(i, { kind: 'builtin', name, ...functions[name] });
  }
  return env;
}

export function checkCall(callee, args, span) {
  if (!callee || typeof callee !== 'object' || !['function', 'builtin', 'contract'].includes(callee.kind))
    fail(`cannot call ${typeOf(callee)}`, span);
  if (callee.arity !== null && callee.arity !== args.length)
    fail(`${callee.name} expects ${callee.arity} argument(s), got ${args.length}`, span);
}

export function prepareCall(callee, args, span) {
  const contracts = [];
  while (callee?.kind === 'contract') {
    checkCall(callee, args, span);
    args = args.map((arg, i) => guardType(callee.contract.params[i], arg, span));
    contracts.push(callee.contract.returns);
    callee = callee.target;
  }
  checkCall(callee, args, span);
  if (callee.kind === 'function') args = args.map((arg, i) => guardType(callee.parameterTypes[i], arg, span));
  return { callee, args, contracts, span };
}

export function finishCall(call, value, returnSpan) {
  value = guardType(call.callee.returnType ?? ANY, value, returnSpan);
  for (let i = call.contracts.length - 1; i >= 0; i--) value = guardType(call.contracts[i], value, call.span);
  return value;
}

export function globalValues(environment) {
  return Object.fromEntries(environment.names.map((name, i) => {
    const value = environment.cells[i];
    return [name, value === UNINITIALIZED || (value !== null && typeof value === 'object') ? display(value) : value];
  }));
}
