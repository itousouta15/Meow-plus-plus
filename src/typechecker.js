import { fail } from './diagnostics.js';
import { builtinNames } from './runtime.js';
import { ANY, NUMBER, STRING, BOOLEAN, NULL, signature, typeName, builtinTypes, assignable, acceptsArity } from './types.js';

export function checkProgram(program) {
  const scopes = [builtinNames.map(name => builtinTypes[name])];
  const functions = [];
  let expectedReturn = ANY;
  const compatible = (actual, expected, span, context) => {
    if (!assignable(actual, expected))
      fail(`${context}：預期 ${typeName(expected)}，得到 ${typeName(actual)}`, span, 'type');
  };
  const binding = node => scopes[scopes.length - 1 - node.address.depth][node.address.slot];
  const normal = () => ({ normal: true, breaks: false, continues: false });
  const merge = (a, b) => ({ normal: a.normal || b.normal, breaks: a.breaks || b.breaks, continues: a.continues || b.continues });

  const block = (node, params = []) => {
    const local = node.layout.map(() => ANY);
    params.forEach((param, i) => { local[i] = param.annotation ?? ANY; });
    for (const statement of node.body) {
      if (statement.type === 'Let') local[statement.slot] = statement.annotation ?? ANY;
      if (statement.type === 'FunctionDecl') {
        local[statement.slot] = signature(statement.fn);
        // A checked declaration has a known callable type even if its params
        // are any. Preserve that boundary when reassigned from dynamic data.
        node.types[statement.slot] = local[statement.slot];
      }
    }
    scopes.push(local);
    let flow = normal();
    try {
      for (const statement of node.body) {
        const next = visit(statement); // Also check unreachable source.
        if (flow.normal) flow = { normal: next.normal, breaks: flow.breaks || next.breaks, continues: flow.continues || next.continues };
      }
    } finally { scopes.pop(); }
    return { flow, local };
  };
  const functionBody = node => {
    const previous = expectedReturn;
    expectedReturn = node.returnType ?? ANY;
    const fn = signature(node);
    functions.push({ name: node.name, type: typeName(fn), span: node.span });
    try {
      const { flow } = block(node.body, node.params);
      if (flow.normal) compatible(NULL, expectedReturn, node.body.span, `函式 '${node.name}' 可能沒有回傳值`);
    } finally { expectedReturn = previous; }
    return fn;
  };
  const expression = node => {
    switch (node.type) {
      case 'Literal': return node.value === null ? NULL : typeof node.value === 'number' ? NUMBER : typeof node.value === 'string' ? STRING : BOOLEAN;
      case 'Variable': return binding(node);
      case 'Assign': {
        const target = binding(node);
        const value = expression(node.value);
        if (node.address.depth === scopes.length - 1) fail(`無法指派內建函式 '${node.name}'`, node.nameSpan, 'type');
        compatible(value, target, node.value.span, `指派給 '${node.name}'`);
        return target.kind === 'any' ? value : target;
      }
      case 'Function': return functionBody(node);
      case 'Unary': {
        const expected = node.op === '!' ? BOOLEAN : NUMBER;
        compatible(expression(node.value), expected, node.opSpan, `運算子 '${node.op}'`);
        return expected;
      }
      case 'Logical':
        compatible(expression(node.left), BOOLEAN, node.opSpan, `運算子 '${node.op}'`);
        compatible(expression(node.right), BOOLEAN, node.opSpan, `運算子 '${node.op}'`);
        return BOOLEAN;
      case 'Binary': {
        const left = expression(node.left), right = expression(node.right);
        if (node.op === '==' || node.op === '!=') return BOOLEAN;
        if (node.op === '+') {
          if (![left, right].every(type => ['any', 'number', 'string'].includes(type.kind)) ||
              (left.kind !== 'any' && right.kind !== 'any' && left.kind !== right.kind))
            fail(`運算子 '+'：預期兩個數字或兩個字串，得到 ${typeName(left)} 和 ${typeName(right)}`, node.opSpan, 'type');
          return left.kind === 'any' || right.kind === 'any' ? ANY : left;
        }
        compatible(left, NUMBER, node.opSpan, `運算子 '${node.op}'`);
        compatible(right, NUMBER, node.opSpan, `運算子 '${node.op}'`);
        return ['<', '<=', '>', '>='].includes(node.op) ? BOOLEAN : NUMBER;
      }
      case 'Call': {
        const callee = expression(node.callee);
        const args = node.args.map(expression);
        if (callee.kind === 'any') return ANY;
        if (callee.kind !== 'function') fail(`無法呼叫 ${typeName(callee)}`, node.span, 'type');
        if (!acceptsArity(callee, args.length))
          fail(`呼叫預期 ${callee.variadic ? '至少 ' : ''}${callee.params.length} 個引數，得到 ${args.length}`, node.span, 'type');
        args.forEach((arg, i) => compatible(arg, callee.params[i] ?? callee.variadic, node.args[i].span, `第 ${i + 1} 個引數`));
        return callee.returns;
      }
      default: throw new Error(`type checker: invalid expression ${node.type}`);
    }
  };
  const visit = node => {
    switch (node.type) {
      case 'Let': compatible(expression(node.init), node.annotation ?? ANY, node.init.span, `'${node.name}' 的初始值`); return normal();
      case 'FunctionDecl': functionBody(node.fn); return normal();
      case 'Empty': return normal();
      case 'ExpressionStmt': expression(node.expression); return normal();
      case 'Block': return block(node).flow;
      case 'Return':
        compatible(node.value ? expression(node.value) : NULL, expectedReturn, node.value?.span ?? node.span, '回傳值');
        return { normal: false, breaks: false, continues: false };
      case 'Break': return { normal: false, breaks: true, continues: false };
      case 'Continue': return { normal: false, breaks: false, continues: true };
      case 'If': {
        compatible(expression(node.test), BOOLEAN, node.test.span, 'if 條件');
        const left = visit(node.then), right = node.otherwise ? visit(node.otherwise) : normal();
        return node.test.type === 'Literal' && typeof node.test.value === 'boolean' ? (node.test.value ? left : right) : merge(left, right);
      }
      case 'While': {
        compatible(expression(node.test), BOOLEAN, node.test.span, 'while 條件');
        const body = visit(node.body);
        return { normal: node.test.type === 'Literal' && node.test.value === true ? body.breaks : true, breaks: false, continues: false };
      }
      default: throw new Error(`type checker: invalid statement ${node.type}`);
    }
  };
  const { local } = block(program);
  return { ok: true, globals: program.layout.map((name, i) => ({ name, type: typeName(local[i]) })), functions };
}
