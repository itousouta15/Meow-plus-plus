import { fail } from './diagnostics.js';
import { ANY, typeName, sameType, acceptsArity } from './types.js';

export const UNINITIALIZED = Symbol('uninitialized');
export const builtinNames = [
  'print', '喵', '喵喵',
  'len', '喵長',
  'str', '喵字',
  'number', '喵數',
  'type', '喵型',
  'sqrt', '喵根',
  'assert', '喵驗',
  '喵黏', '喵重複', '喵選', '喵叫',
  '讀行', '讀', '喵吃', '讀數',
];

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
  if (typeof value !== 'boolean') fail(`預期 boolean，得到 ${typeOf(value)}`, span);
  return value;
}
function numeric(value, span) {
  if (typeof value !== 'number') fail(`預期 number，得到 ${typeOf(value)}`, span);
  return value;
}
function finite(value, span) {
  if (!Number.isFinite(value)) fail('數值結果不是有限的', span);
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
    if (a.length + b.length > 65536) fail('字串超過 65536 個碼元', span, 'limit');
    return a + b;
  }
  numeric(a, span); numeric(b, span);
  switch (op) {
    case '+': return finite(a + b, span);
    case '-': return finite(a - b, span);
    case '*': return finite(a * b, span);
    case '/': if (b === 0) fail('除以零', span); return finite(a / b, span);
    case '%': if (b === 0) fail('對零取餘數', span); return finite(a % b, span);
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
    if (typeOf(value) !== type.kind) fail(`型別契約：預期 ${typeName(type)}，得到 ${typeOf(value)}`, span);
    return value;
  }
  if (typeOf(value) !== 'function') fail(`型別契約：預期 ${typeName(type)}，得到 ${typeOf(value)}`, span);
  if (value.arity !== null && !acceptsArity(type, value.arity))
    fail(`型別契約：預期 ${typeName(type)}，得到有 ${value.arity} 個參數的函式`, span);
  if (value.kind === 'contract' && sameType(value.contract, type)) return value;
  const depth = (value.contractDepth ?? 0) + 1;
  if (depth > 64) fail('函式契約巢狀深度超過上限', span, 'limit');
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
    if (value === UNINITIALIZED) fail(`在初始化前無法存取 '${address.name}'`, span);
    return value;
  }
  set(address, value, span) {
    const env = this.ancestor(address.depth);
    if (env.cells[address.slot] === UNINITIALIZED) fail(`在初始化前無法指派 '${address.name}'`, span);
    if (env.parent === null) fail(`無法指派內建函式 '${address.name}'`, span);
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
    this.stdout = '';
    this.stderr = '';
    this.pendingOut = '';
    this.outputSize = 0;
    this.onOutput = options.onOutput ?? (() => {});
    this.input = typeof options.input === 'string' ? options.input : '';
    this.readOffset = 0;
  }
  tick(span) {
    if (++this.steps > this.maxSteps) fail(`執行超過 ${this.maxSteps} 步`, span, 'limit');
  }
  emit(text, span) {
    if (this.outputSize + text.length + 1 > this.maxOutput) fail('輸出超過上限', span, 'limit');
    this.stdout += text + '\n';
    const line = this.pendingOut + text;
    this.pendingOut = '';
    this.output.push(line);
    this.outputSize += text.length + 1;
    this.onOutput(line);
  }
  write(channel, text, span) {
    if (this.outputSize + text.length > this.maxOutput) fail('輸出超過上限', span, 'limit');
    this.outputSize += text.length;
    if (channel === 'stderr') { this.stderr += text; return; }
    this.stdout += text;
    const parts = (this.pendingOut + text).split('\n');
    this.pendingOut = parts.pop();
    for (const line of parts) { this.output.push(line); this.onOutput(line); }
  }
  finishOutput() {
    if (this.pendingOut) { this.output.push(this.pendingOut); this.onOutput(this.pendingOut); this.pendingOut = ''; }
  }
  extract(env, address, mode, span) {
    env.get(address, span);
    const target = env.ancestor(address.depth);
    if (!target.parent) fail(`無法指派內建函式 '${address.name}'`, span);
    const type = target.types[address.slot];
    const supported = mode === 'line' ? ['any', 'string'] : ['any', 'number', 'string', 'boolean'];
    if (!supported.includes(type.kind)) fail(`喵in 不支援讀入 ${typeName(type)}`, span);
    let value = mode === 'line' ? this.readLine() : this.readToken();
    if (value === null) fail('喵in 輸入不足', span);
    if (value.length > 65536) fail('字串超過 65536 個碼元', span, 'limit');
    if (type.kind === 'number') {
      if (!/^-?(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?$/.test(value)) fail(`喵in 預期數字，得到 '${value}'`, span);
      value = finite(Number(value), span);
    } else if (type.kind === 'boolean') {
      if (['true', '真', '1'].includes(value)) value = true;
      else if (['false', '假', '0'].includes(value)) value = false;
      else fail(`喵in 預期布林值，得到 '${value}'`, span);
    }
    env.set(address, value, span);
  }
  readLine() {
    if (this.readOffset >= this.input.length) return null;
    let end = this.input.indexOf('\n', this.readOffset);
    if (end === -1) end = this.input.length;
    let line = this.input.slice(this.readOffset, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    this.readOffset = end + 1;
    return line;
  }
  readToken() {
    let i = this.readOffset;
    while (i < this.input.length && /\s/.test(this.input[i])) i++;
    if (i >= this.input.length) { this.readOffset = this.input.length; return null; }
    const start = i;
    while (i < this.input.length && !/\s/.test(this.input[i])) i++;
    this.readOffset = i;
    return this.input.slice(start, i);
  }
}

export function builtins(context) {
  const env = new Environment(builtinNames);
  const print = { arity: null, call: (args, span) => { context.emit(args.map(display).join(' '), span); return null; } };
  const len = { arity: 1, call: ([value], span) => {
    if (typeof value !== 'string') fail(`len 預期字串，得到 ${typeOf(value)}`, span);
    return [...value].length;
  } };
  const str = { arity: 1, call: ([value]) => display(value) };
  const number = { arity: 1, call: ([value], span) => {
    if (typeof value !== 'string' || !/^-?(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?$/.test(value))
      fail('number 預期十進位數字字串', span);
    return finite(Number(value), span);
  } };
  const type = { arity: 1, call: ([value]) => typeOf(value) };
  const sqrt = { arity: 1, call: ([value], span) => finite(Math.sqrt(numeric(value, span)), span) };
  const assert = { arity: 1, call: ([value], span) => {
    if (!boolean(value, span)) fail('斷言失敗', span);
    return null;
  } };
  const readLine = () => {
    return context.readLine();
  };
  const readToken = () => {
    return context.readToken();
  };
  const readNumber = span => {
    const token = readToken();
    if (token === null) return null;
    if (!/^-?(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?$/.test(token)) fail(`讀數 預期數字，得到 '${token}'`, span);
    return finite(Number(token), span);
  };
  const 讀行 = { arity: 0, call: () => readLine() };
  const 讀 = { arity: 0, call: () => readToken() };
  const 讀數 = { arity: 0, call: (_args, span) => readNumber(span) };
  const functions = {
    print, 喵: print,
    喵喵: { arity: null, call: (args, span) => { context.emit(`喵～ ${args.map(display).join(' ')}`, span); return null; } },
    len, 喵長: len,
    str, 喵字: str,
    number, 喵數: number,
    type, 喵型: type,
    sqrt, 喵根: sqrt,
    assert, 喵驗: assert,
    喵黏: { arity: null, call: args => args.map(display).join('') },
    喵重複: { arity: 2, call: ([text, times], span) => {
      if (typeof text !== 'string') fail(`喵重複 預期字串，得到 ${typeOf(text)}`, span);
      if (typeof times !== 'number' || !Number.isInteger(times) || times < 0) fail('喵重複 的次數必須是非負整數', span);
      if (text.length * times > 65536) fail('字串超過 65536 個碼元', span, 'limit');
      return text.repeat(times);
    } },
    喵選: { arity: 3, call: ([condition, whenTrue, whenFalse], span) => boolean(condition, span) ? whenTrue : whenFalse },
    喵叫: { arity: 0, call: () => '喵～' },
    讀行, 讀, 喵吃: 讀, 讀數,
  };
  for (let i = 0; i < builtinNames.length; i++) {
    const name = builtinNames[i];
    env.initialize(i, { kind: 'builtin', name, ...functions[name] });
  }
  return env;
}

export function checkCall(callee, args, span) {
  if (!callee || typeof callee !== 'object' || !['function', 'builtin', 'contract'].includes(callee.kind))
    fail(`無法呼叫 ${typeOf(callee)}`, span);
  if (callee.arity !== null && callee.arity !== args.length)
    fail(`${callee.name} 預期 ${callee.arity} 個引數，得到 ${args.length}`, span);
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
