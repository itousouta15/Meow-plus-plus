import { fail } from './diagnostics.js';
import { builtinNames } from './runtime.js';
import { ANY, signature, annotatedFunction } from './types.js';

// Resolve names to lexical (depth, slot) addresses. Both execution engines use
// these stable cells, including declarations that are not initialized yet.
export function resolve(program) {
  program.hasTypeAnnotations = false;
  const scopes = [new Map(builtinNames.map((name, slot) => [name, slot]))];
  let functionDepth = 0, loopDepth = 0, nesting = 0;
  const add = (scope, name, span) => {
    if (scope.has(name)) fail(`在此作用域重複宣告 '${name}'`, span, 'resolve');
    const slot = scope.size;
    scope.set(name, slot);
    return slot;
  };
  const address = (name, span) => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].has(name)) return { depth: scopes.length - 1 - i, slot: scopes[i].get(name), name };
    }
    fail(`未定義的變數 '${name}'`, span, 'resolve');
  };
  const block = (node, params = []) => {
    const scope = new Map();
    for (const param of params) add(scope, param.name, param.span);
    for (const statement of node.body) {
      if (statement.type === 'Let' || statement.type === 'FunctionDecl')
        statement.slot = add(scope, statement.name, statement.nameSpan);
    }
    node.layout = [...scope.keys()];
    node.types = node.layout.map(() => ANY);
    params.forEach((param, index) => {
      node.types[index] = param.annotation ?? ANY;
      if (param.annotation) program.hasTypeAnnotations = true;
    });
    for (const statement of node.body) {
      if (statement.type === 'Let' && statement.annotation) {
        node.types[statement.slot] = statement.annotation;
        program.hasTypeAnnotations = true;
      }
      if (statement.type === 'FunctionDecl' && annotatedFunction(statement.fn)) node.types[statement.slot] = signature(statement.fn);
    }
    scopes.push(scope);
    try { for (const statement of node.body) visit(statement); }
    finally { scopes.pop(); }
  };
  const visit = node => {
    if (++nesting > 160) fail('語法樹過深', node.span, 'limit');
    try {
      switch (node.type) {
        case 'Program': case 'Block': block(node); break;
        case 'Let': visit(node.init); break;
        case 'FunctionDecl': visit(node.fn); break;
        case 'Function': {
          if (node.returnType) program.hasTypeAnnotations = true;
          const previousLoops = loopDepth;
          loopDepth = 0; functionDepth++;
          try { block(node.body, node.params); }
          finally { functionDepth--; loopDepth = previousLoops; }
          break;
        }
        case 'Variable': node.address = address(node.name, node.span); break;
        case 'Assign': node.address = address(node.name, node.nameSpan); visit(node.value); break;
        case 'Literal': case 'Empty': break;
        case 'ExpressionStmt': visit(node.expression); break;
        case 'Binary': case 'Logical': visit(node.left); visit(node.right); break;
        case 'Unary': visit(node.value); break;
        case 'Call': visit(node.callee); for (const arg of node.args) visit(arg); break;
        case 'If': visit(node.test); visit(node.then); if (node.otherwise) visit(node.otherwise); break;
        case 'While':
          visit(node.test); loopDepth++;
          try { visit(node.body); } finally { loopDepth--; }
          break;
        case 'Return':
          if (functionDepth === 0) fail('回傳(return) 只能出現在函式內', node.span, 'resolve');
          if (node.value) visit(node.value);
          break;
        case 'Break': case 'Continue':
          if (loopDepth === 0) fail(`${node.type === 'Break' ? '中斷(break)' : '繼續(continue)'} 只能出現在迴圈內`, node.span, 'resolve');
          break;
        default: throw new Error(`unknown AST node ${node.type}`);
      }
    } finally { nesting--; }
  };
  visit(program);
  return program;
}
