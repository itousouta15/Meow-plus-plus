export const ANY = Object.freeze({ kind: 'any' });
export const NUMBER = Object.freeze({ kind: 'number' });
export const STRING = Object.freeze({ kind: 'string' });
export const BOOLEAN = Object.freeze({ kind: 'boolean' });
export const NULL = Object.freeze({ kind: 'null' });
export const primitiveTypes = Object.freeze({
  any: ANY, number: NUMBER, string: STRING, boolean: BOOLEAN, null: NULL,
  任意: ANY, 任意值: ANY,
  數: NUMBER, 數字: NUMBER,
  字串: STRING,
  布林: BOOLEAN, 布林值: BOOLEAN,
  空: NULL,
});

export function functionType(params, returns, variadic = null) {
  return { kind: 'function', params, returns, variadic };
}
export function signature(node) {
  return functionType(node.params.map(param => param.annotation ?? ANY), node.returnType ?? ANY);
}
export function annotatedFunction(node) {
  return node.returnType != null || node.params.some(param => param.annotation != null);
}
export function typeName(type) {
  if (type.kind !== 'function') return type.kind;
  const params = type.params.map(typeName);
  if (type.variadic) params.push(`...${typeName(type.variadic)}`);
  return `fn(${params.join(', ')}) -> ${typeName(type.returns)}`;
}
export function sameType(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'function') return true;
  return a.params.length === b.params.length && !!a.variadic === !!b.variadic &&
    (!a.variadic || sameType(a.variadic, b.variadic)) &&
    a.params.every((param, i) => sameType(param, b.params[i])) && sameType(a.returns, b.returns);
}
export function acceptsArity(type, count) {
  return type.variadic ? count >= type.params.length : count === type.params.length;
}
// Gradual assignability: any crosses a runtime-checked boundary. Function
// parameters are contravariant and results covariant, including higher-order
// signatures. No implicit primitive conversions or union types are provided.
export function assignable(actual, expected) {
  if (actual.kind === 'any' || expected.kind === 'any') return true;
  if (actual.kind !== expected.kind) return false;
  if (actual.kind !== 'function') return true;
  if (expected.variadic && (!actual.variadic || actual.params.length > expected.params.length)) return false;
  if (!expected.variadic && !acceptsArity(actual, expected.params.length)) return false;
  for (let i = 0; i < expected.params.length; i++) {
    const accepted = actual.params[i] ?? actual.variadic;
    if (!accepted || !assignable(expected.params[i], accepted)) return false;
  }
  if (expected.variadic && !assignable(expected.variadic, actual.variadic)) return false;
  return assignable(actual.returns, expected.returns);
}

export const builtinTypes = Object.freeze({
  print: functionType([], NULL, ANY),
  喵: functionType([], NULL, ANY),
  喵喵: functionType([], NULL, ANY),
  len: functionType([STRING], NUMBER),
  喵長: functionType([STRING], NUMBER),
  str: functionType([ANY], STRING),
  喵字: functionType([ANY], STRING),
  number: functionType([STRING], NUMBER),
  喵數: functionType([STRING], NUMBER),
  type: functionType([ANY], STRING),
  喵型: functionType([ANY], STRING),
  sqrt: functionType([NUMBER], NUMBER),
  喵根: functionType([NUMBER], NUMBER),
  assert: functionType([BOOLEAN], NULL),
  喵驗: functionType([BOOLEAN], NULL),
  喵黏: functionType([], STRING, ANY),
  喵重複: functionType([STRING, NUMBER], STRING),
  喵選: functionType([BOOLEAN, ANY, ANY], ANY),
  喵叫: functionType([], STRING),
});
