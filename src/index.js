import { parse } from './parser.js';
import { resolve } from './resolver.js';
import { compileAst } from './compiler.js';
import { Interpreter } from './interpreter.js';
import { VM } from './vm.js';
import { checkProgram } from './typechecker.js';

export { tokenize } from './lexer.js';
export { parse } from './parser.js';
export { resolve } from './resolver.js';
export { compileAst, disassemble, prototypes } from './compiler.js';
export { Interpreter } from './interpreter.js';
export { VM } from './vm.js';
export { LangError, formatDiagnostic } from './diagnostics.js';
export { checkProgram } from './typechecker.js';
export { typeName, assignable } from './types.js';

export function analyze(source, options = {}) {
  const ast = resolve(parse(source));
  if (options.typecheck === true || (options.typecheck !== false && ast.hasTypeAnnotations)) ast.typeReport = checkProgram(ast);
  return ast;
}
export function check(source) { return analyze(source, { typecheck: true }).typeReport; }
export function compile(source, options = {}) { return compileAst(analyze(source, options)); }
export function run(source, options = {}) {
  const ast = analyze(source, options);
  const engine = options.engine ?? 'vm';
  if (engine === 'tree') return new Interpreter(ast, options).run();
  if (engine === 'vm') return new VM(compileAst(ast), options).run();
  throw new TypeError("engine must be 'tree' or 'vm'");
}
